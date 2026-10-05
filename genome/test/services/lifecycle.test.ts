import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import { AuditService } from '../../src/server/services/audit.js';
import {
  allowedFrom,
  computeReturnStack,
  isTransitionAllowed,
  LifecycleService,
  orderHistory,
  RETURN_TO_PREVIOUS,
  returnTargetFromHistory,
  TRANSITIONS,
  type HistoryStep,
} from '../../src/server/services/lifecycle.js';
import { PRODUCT_STATUSES, type ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import type { Db } from '../../src/server/db/connection.js';

const admin: Actor = { type: 'admin', id: '7d0c3c2e-8a51-4c1e-9d55-0f6f7cbd1a01' };

async function expectDomainError(p: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

// ── Fixtures (direct inserts: the lifecycle must not depend on issuance) ──

let serialCounter = 0;
async function seedCatalog(db: Db): Promise<string> {
  await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 }).execute();
  const model = await db
    .insertInto('models')
    .values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON-RING' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return model.id;
}

async function seedProduct(db: Db, modelId: string, at: Date, reserved = false): Promise<{ id: string; productId: string }> {
  const serial = ++serialCounter;
  const productId = `O26-J-${String(serial).padStart(5, '0')}`;
  const row = await db
    .insertInto('products')
    .values({
      product_id: productId,
      packed_identity: (26 << 25) | (1 << 20) | serial,
      year: 2026,
      category_id: 1,
      serial,
      sku: `MON-RING-${serial}`,
      model_id: modelId,
      material: '925 STERLING SILVER',
      ...(reserved ? { status: 'RESERVED' as const } : {}),
      created_at: at,
      updated_at: at,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  // A RESERVED identity has no history yet (migration 0022: it starts when the atelier issues it).
  if (reserved) return { id: row.id, productId };
  // Issuance writes the initial history row (NULL → ISSUED).
  await db
    .insertInto('product_status_history')
    .values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: at })
    .execute();
  return { id: row.id, productId };
}

/** Canonical path from ISSUED to each status, and the return target it leaves behind. */
const PATHS: Record<Exclude<ProductStatus, 'RESERVED'>, ProductStatus[]> = {
  ISSUED: [],
  ACTIVATED: ['ACTIVATED'],
  REGISTERED: ['ACTIVATED', 'REGISTERED'],
  OWNED: ['ACTIVATED', 'OWNED'],
  TRANSFERRED: ['ACTIVATED', 'OWNED', 'TRANSFERRED'],
  SERVICED: ['ACTIVATED', 'OWNED', 'SERVICED'],
  RESOLD: ['ACTIVATED', 'RESOLD'],
  LOST: ['ACTIVATED', 'REGISTERED', 'LOST'],
  STOLEN: ['ACTIVATED', 'OWNED', 'STOLEN'],
  COUNTERFEIT_FLAGGED: ['ACTIVATED', 'COUNTERFEIT_FLAGGED'],
  REVOKED: ['ACTIVATED', 'OWNED', 'REVOKED'],
  RETIRED: ['RETIRED'],
};
const PATH_RETURN: Partial<Record<ProductStatus, ProductStatus>> = {
  SERVICED: 'OWNED',
  LOST: 'REGISTERED',
  STOLEN: 'OWNED',
  COUNTERFEIT_FLAGGED: 'ACTIVATED',
  REVOKED: 'OWNED',
};

describe('state machine data (contract §2.6)', () => {
  it('has a row for every status and only valid targets', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...PRODUCT_STATUSES].sort());
    for (const targets of Object.values(TRANSITIONS)) {
      for (const t of targets) expect(PRODUCT_STATUSES).toContain(t);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });

  it('matches the contract table exactly', () => {
    const incident = ['RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'];
    // A reserved identity leaves through the atelier or its order's cancellation, never a transition; nothing enters it.
    expect(TRANSITIONS.RESERVED).toEqual([]);
    for (const targets of Object.values(TRANSITIONS)) expect(targets).not.toContain('RESERVED');
    expect(TRANSITIONS.ISSUED).toEqual(['ACTIVATED', 'SERVICED', ...incident]);
    expect(TRANSITIONS.ACTIVATED).toEqual(['REGISTERED', 'OWNED', 'SERVICED', 'RESOLD', ...incident]);
    expect(TRANSITIONS.REGISTERED).toEqual(['OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD', ...incident]);
    expect(TRANSITIONS.OWNED).toEqual(['TRANSFERRED', 'SERVICED', 'RESOLD', ...incident]);
    expect(TRANSITIONS.TRANSFERRED).toEqual(['OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD', ...incident]);
    expect(TRANSITIONS.SERVICED).toEqual(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'RESOLD', ...incident]);
    expect(TRANSITIONS.RESOLD).toEqual(['REGISTERED', 'OWNED', 'SERVICED', ...incident]);
    expect(RETURN_TO_PREVIOUS.SERVICED).toEqual(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'RESOLD']);
    for (const s of ['LOST', 'STOLEN'] as const) {
      expect([...TRANSITIONS[s]].sort()).toEqual([...RETURN_TO_PREVIOUS[s]!, 'RETIRED', 'REVOKED'].sort());
      expect(RETURN_TO_PREVIOUS[s]).not.toContain('LOST');
      expect(RETURN_TO_PREVIOUS[s]).not.toContain('STOLEN');
    }
    expect([...TRANSITIONS.COUNTERFEIT_FLAGGED].sort()).toEqual([...RETURN_TO_PREVIOUS.COUNTERFEIT_FLAGGED!, 'REVOKED', 'RETIRED'].sort());
    expect(TRANSITIONS.REVOKED).toEqual([]);
    expect(TRANSITIONS.RETIRED).toEqual([]);
    expect(Object.isFrozen(TRANSITIONS) && Object.isFrozen(TRANSITIONS.OWNED)).toBe(true);
  });

  it('only allows a return move towards the computed previous status', () => {
    expect(isTransitionAllowed('SERVICED', 'OWNED', 'OWNED')).toBe(true);
    expect(isTransitionAllowed('SERVICED', 'REGISTERED', 'OWNED')).toBe(false);
    expect(isTransitionAllowed('SERVICED', 'OWNED', null)).toBe(false);
    expect(isTransitionAllowed('SERVICED', 'LOST', null)).toBe(true);
    expect(isTransitionAllowed('LOST', 'ISSUED', 'ISSUED')).toBe(true);
    expect(allowedFrom('STOLEN', 'TRANSFERRED')).toEqual(['TRANSFERRED', 'RETIRED', 'REVOKED']);
    expect(allowedFrom('OWNED', null)).toEqual(TRANSITIONS.OWNED);
  });
});

describe('history replay (pure)', () => {
  const steps = (...pairs: [ProductStatus | null, ProductStatus][]): HistoryStep[] => pairs.map(([from, to]) => ({ from, to }));

  it('tracks nested suspensions', () => {
    const h = steps([null, 'ISSUED'], ['ISSUED', 'ACTIVATED'], ['ACTIVATED', 'OWNED'], ['OWNED', 'SERVICED'], ['SERVICED', 'STOLEN'], ['STOLEN', 'REVOKED']);
    expect(computeReturnStack(h)).toEqual(['OWNED', 'SERVICED', 'STOLEN']);
    expect(returnTargetFromHistory(h, 'REVOKED')).toBe('STOLEN');
    const h2 = [...h, ...steps(['REVOKED', 'STOLEN'])];
    expect(returnTargetFromHistory(h2, 'STOLEN')).toBe('SERVICED');
    const h3 = [...h2, ...steps(['STOLEN', 'SERVICED'])];
    expect(returnTargetFromHistory(h3, 'SERVICED')).toBe('OWNED');
    expect(computeReturnStack([...h3, ...steps(['SERVICED', 'OWNED'])])).toEqual([]);
  });

  it('a non-return exit to a normal status ends the episode', () => {
    const h = steps([null, 'ISSUED'], ['ISSUED', 'ACTIVATED'], ['ACTIVATED', 'SERVICED'], ['SERVICED', 'OWNED'], ['OWNED', 'LOST']);
    expect(returnTargetFromHistory(h, 'LOST')).toBe('OWNED');
  });

  it('refuses to guess when the history does not end in the current status', () => {
    expect(returnTargetFromHistory([], 'SERVICED')).toBeNull();
    expect(returnTargetFromHistory(steps([null, 'ISSUED'], ['ISSUED', 'LOST']), 'STOLEN')).toBeNull();
    expect(returnTargetFromHistory(steps([null, 'ISSUED']), 'ISSUED')).toBeNull();
  });

  it('orders same-millisecond rows by chaining from → to', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    const rows = [
      { id: 'c', from: 'OWNED' as const, to: 'SERVICED' as const, at: t },
      { id: 'a', from: null, to: 'ISSUED' as const, at: t },
      { id: 'b', from: 'ACTIVATED' as const, to: 'OWNED' as const, at: t },
      { id: 'z', from: 'ISSUED' as const, to: 'ACTIVATED' as const, at: t },
    ];
    expect(orderHistory(rows).map((r) => r.id)).toEqual(['a', 'z', 'b', 'c']);
  });
});

describe('LifecycleService', () => {
  let t: TestDb;
  let lifecycle: LifecycleService;
  let audit: AuditService;
  let modelId: string;
  const clock = createManualClock('2026-03-01T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
    modelId = await seedCatalog(t.db);
  });
  afterAll(() => t.close());

  async function productIn(status: ProductStatus) {
    // RESERVED comes before ISSUED: an identity reserved for a piece to make (migration 0022), seeded as such.
    if (status === 'RESERVED') return seedProduct(t.db, modelId, clock.now(), true);
    const p = await seedProduct(t.db, modelId, clock.now());
    for (const step of PATHS[status]) {
      clock.advance(1000);
      await lifecycle.transition(p.productId, step, { reason: 'fixture' }, admin);
    }
    return p;
  }

  describe('every allowed transition succeeds; every other one fails with 409', () => {
    for (const from of PRODUCT_STATUSES) {
      const returnTarget = PATH_RETURN[from] ?? null;
      for (const to of PRODUCT_STATUSES) {
        const allowed = TRANSITIONS[from].includes(to) && (!RETURN_TO_PREVIOUS[from]?.includes(to) || to === returnTarget);
        it(`${from} → ${to}: ${allowed ? 'allowed' : 'refused'}`, async () => {
          const p = await productIn(from);
          if (allowed) {
            const change = await lifecycle.transition(p.productId, to, { reason: 'table test' }, admin);
            expect(change).toMatchObject({ id: p.id, productId: p.productId, from, to, reason: 'table test' });
            const row = await t.db.selectFrom('products').select('status').where('id', '=', p.id).executeTakeFirstOrThrow();
            expect(row.status).toBe(to);
          } else {
            const e = await expectDomainError(lifecycle.transition(p.productId, to, {}, admin), 'TRANSITION_NOT_ALLOWED', 409);
            // Public message never names statuses; the detail is internal.
            expect(e.publicMessage).not.toMatch(new RegExp(`${from}|${to}`));
            const row = await t.db.selectFrom('products').select('status').where('id', '=', p.id).executeTakeFirstOrThrow();
            expect(row.status).toBe(from);
          }
        });
      }
    }
  });

  it('writes history, an audit entry and returns the change', async () => {
    const p = await productIn('ISSUED');
    clock.set('2026-03-02T08:00:00.000Z');
    const change = await lifecycle.transition(p.id, 'ACTIVATED', { reason: '  sold in Paris  ' }, admin);
    expect(change.at.toISOString()).toBe('2026-03-02T08:00:00.000Z');
    expect(change.reason).toBe('sold in Paris');
    const history = await lifecycle.history(p.productId);
    expect(history.map((h) => [h.from, h.to])).toEqual([[null, 'ISSUED'], ['ISSUED', 'ACTIVATED']]);
    expect(history[1]).toMatchObject({ actorType: 'admin', actorId: admin.id, reason: 'sold in Paris' });
    const entries = await audit.list({ action: 'product.transition', targetId: p.productId });
    expect(entries.items[0]).toMatchObject({ actorType: 'admin', details: { from: 'ISSUED', to: 'ACTIVATED', reason: 'sold in Paris' } });
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('keeps history strictly ordered when the clock does not move', async () => {
    const p = await productIn('ISSUED');
    for (const s of ['ACTIVATED', 'OWNED', 'SERVICED', 'OWNED', 'SERVICED', 'LOST', 'SERVICED', 'OWNED'] as const) {
      await lifecycle.transition(p.productId, s, {}, admin);
    }
    const history = await lifecycle.history(p.productId);
    expect(history.map((h) => h.to)).toEqual(['ISSUED', 'ACTIVATED', 'OWNED', 'SERVICED', 'OWNED', 'SERVICED', 'LOST', 'SERVICED', 'OWNED']);
    for (let i = 1; i < history.length; i++) expect(history[i].at.getTime()).toBeGreaterThan(history[i - 1].at.getTime());
  });

  it('SERVICED returns only to the pre-service status', async () => {
    const p = await productIn('ACTIVATED');
    await lifecycle.transition(p.productId, 'REGISTERED', {}, admin);
    await lifecycle.transition(p.productId, 'SERVICED', {}, admin);
    expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['REGISTERED', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);
    for (const wrong of ['ACTIVATED', 'OWNED', 'TRANSFERRED', 'RESOLD'] as const) {
      await expectDomainError(lifecycle.transition(p.productId, wrong, {}, admin), 'TRANSITION_NOT_ALLOWED', 409);
    }
    expect((await lifecycle.transition(p.productId, 'REGISTERED', {}, admin)).to).toBe('REGISTERED');
  });

  it('ISSUED → SERVICED (pre-sale inspection / QA) returns to ISSUED only, and is reported as pre-sale', async () => {
    const p = await productIn('ISSUED');
    expect(await lifecycle.isPreSaleService(p.id)).toBe(false);
    await lifecycle.transition(p.productId, 'SERVICED', { reason: 'QA inspection' }, admin);
    expect(await lifecycle.isPreSaleService(p.id)).toBe(true);
    expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['ISSUED', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);
    await expectDomainError(lifecycle.transition(p.productId, 'ACTIVATED', {}, admin), 'TRANSITION_NOT_ALLOWED', 409);
    expect((await lifecycle.transition(p.productId, 'ISSUED', { reason: 'QA passed' }, admin)).to).toBe('ISSUED');
    expect(await lifecycle.isPreSaleService(p.id)).toBe(false);
    // An after-sale service is not pre-sale.
    const sold = await productIn('SERVICED');
    expect(await lifecycle.isPreSaleService(sold.id)).toBe(false);
  });

  it('LOST/STOLEN recover to the previous non-incident status, even across a revocation', async () => {
    const p = await productIn('OWNED');
    await lifecycle.transition(p.productId, 'SERVICED', {}, admin);
    await lifecycle.transition(p.productId, 'STOLEN', { reason: 'stolen from the workshop' }, admin);
    expect(await lifecycle.previousStatus(p.productId)).toBe('SERVICED');
    await lifecycle.transition(p.productId, 'REVOKED', { reason: 'police report' }, admin);
    expect(await lifecycle.previousStatus(p.productId)).toBe('STOLEN');
    await lifecycle.reinstate(p.productId, 'recovered by police', admin);
    expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['SERVICED', 'RETIRED', 'REVOKED']);
    await lifecycle.transition(p.productId, 'SERVICED', { reason: 'recovered' }, admin);
    expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['OWNED', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);
    await lifecycle.transition(p.productId, 'OWNED', { reason: 'service done' }, admin);
    expect(await lifecycle.previousStatus(p.productId)).toBeNull();
  });

  it('COUNTERFEIT_FLAGGED clears to the previous status only', async () => {
    const p = await productIn('RESOLD');
    await lifecycle.transition(p.productId, 'COUNTERFEIT_FLAGGED', {}, admin);
    await expectDomainError(lifecycle.transition(p.productId, 'OWNED', {}, admin), 'TRANSITION_NOT_ALLOWED', 409);
    expect((await lifecycle.transition(p.productId, 'RESOLD', { reason: 'false alarm' }, admin)).to).toBe('RESOLD');
  });

  it('REVOKED: transition() refuses everything, reinstate() restores the pre-revocation status and lifts the revocation', async () => {
    const p = await productIn('SERVICED');
    await lifecycle.transition(p.productId, 'REVOKED', { reason: 'code leaked', revocationReasonCode: 'CODE_LEAK' }, admin);
    const rev = await t.db.selectFrom('revocations').selectAll().where('target_id', '=', p.productId).execute();
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ target_type: 'PRODUCT', reason_code: 'CODE_LEAK', reason: 'code leaked', created_by: `admin:${admin.id}`, lifted_at: null });

    for (const to of PRODUCT_STATUSES) {
      await expectDomainError(lifecycle.transition(p.productId, to, {}, admin), 'TRANSITION_NOT_ALLOWED', 409);
    }
    expect(await lifecycle.snapshot(p.productId)).toEqual({ status: 'REVOKED', allowed: [], returnTo: 'SERVICED', canReinstate: true });

    await expectDomainError(lifecycle.reinstate(p.productId, 'bad\u0000', admin), 'VALIDATION_FAILED', 400);
    clock.advance(60_000);
    const change = await lifecycle.reinstate(p.productId, 'revocation was an error', admin);
    expect(change).toMatchObject({ from: 'REVOKED', to: 'SERVICED' });
    const lifted = await t.db.selectFrom('revocations').selectAll().where('target_id', '=', p.productId).executeTakeFirstOrThrow();
    expect(lifted.lifted_at?.toISOString()).toBe(clock.now().toISOString());
    expect(lifted.lifted_by).toBe(`admin:${admin.id}`);
    const entries = await audit.list({ action: 'product.reinstate', targetId: p.productId });
    expect(entries.total).toBe(1);
    // Back in SERVICED, the original pre-service status is still the return target.
    expect(await lifecycle.previousStatus(p.productId)).toBe('OWNED');
  });

  it('defaults the revocation reason code from the previous status', async () => {
    const a = await productIn('COUNTERFEIT_FLAGGED');
    await lifecycle.transition(a.productId, 'REVOKED', {}, admin);
    const b = await productIn('ISSUED');
    await lifecycle.transition(b.productId, 'REVOKED', {}, admin);
    const codes = await t.db.selectFrom('revocations').select(['target_id', 'reason_code']).where('target_id', 'in', [a.productId, b.productId]).execute();
    expect(Object.fromEntries(codes.map((c) => [c.target_id, c.reason_code]))).toEqual({ [a.productId]: 'COUNTERFEIT', [b.productId]: 'ADMIN_DECISION' });
  });

  it('reinstate refuses products that are not revoked; the reason is optional', async () => {
    const p = await productIn('OWNED');
    await expectDomainError(lifecycle.reinstate(p.productId, 'why not', admin), 'NOT_REVOKED', 409);
    const r = await productIn('REVOKED');
    expect(await lifecycle.reinstate(r.productId, undefined, admin)).toMatchObject({ from: 'REVOKED', to: 'OWNED', reason: null });
  });

  it('refuses return moves when the history cannot tell the previous status', async () => {
    const p = await productIn('ISSUED');
    // Status changed outside the service: the history no longer ends in the current status.
    await t.db.updateTable('products').set({ status: 'SERVICED' }).where('id', '=', p.id).execute();
    expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);
    await expectDomainError(lifecycle.transition(p.productId, 'ACTIVATED', {}, admin), 'PREVIOUS_STATUS_UNKNOWN', 409);
    await t.db.updateTable('products').set({ status: 'REVOKED' }).where('id', '=', p.id).execute();
    await expectDomainError(lifecycle.reinstate(p.productId, 'test', admin), 'PREVIOUS_STATUS_UNKNOWN', 409);
  });

  it('validates input and resolves products by uuid or canonical id', async () => {
    const p = await productIn('ISSUED');
    await expectDomainError(lifecycle.transition(p.productId, 'NOPE' as ProductStatus, {}, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(lifecycle.transition(p.productId, 'ACTIVATED', { reason: 'x'.repeat(1001) }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(lifecycle.transition(p.productId, 'ACTIVATED', { reason: 'bad\u0000' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(
      lifecycle.transition(p.productId, 'REVOKED', { revocationReasonCode: 'lower case' }, admin),
      'VALIDATION_FAILED',
      400,
    );
    await expectDomainError(lifecycle.transition('O26-J-99999', 'ACTIVATED', {}, admin), 'PRODUCT_NOT_FOUND', 404);
    await expectDomainError(lifecycle.transition('not a product', 'ACTIVATED', {}, admin), 'PRODUCT_NOT_FOUND', 404);
    await expectDomainError(lifecycle.history('00000000-0000-4000-8000-000000000000'), 'PRODUCT_NOT_FOUND', 404);
    expect((await lifecycle.transition(p.productId.toLowerCase(), 'ACTIVATED', {}, admin)).to).toBe('ACTIVATED');
    expect((await lifecycle.transition(p.id.toUpperCase(), 'OWNED', {}, admin)).to).toBe('OWNED');
  });

  it('rolls back status, history and audit together when the caller transaction fails', async () => {
    const p = await productIn('ISSUED');
    const before = (await audit.head())?.id;
    await expect(
      t.db.transaction().execute(async (trx) => {
        await lifecycle.transition(p.productId, 'ACTIVATED', {}, admin, trx);
        throw new Error('caller failed');
      }),
    ).rejects.toThrow('caller failed');
    const row = await t.db.selectFrom('products').select('status').where('id', '=', p.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('ISSUED');
    expect((await lifecycle.history(p.productId)).length).toBe(1);
    expect((await audit.head())?.id).toBe(before);
  });
});
