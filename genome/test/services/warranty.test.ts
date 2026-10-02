import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import { AuditService } from '../../src/server/services/audit.js';
import { LifecycleService } from '../../src/server/services/lifecycle.js';
import { RetailerService } from '../../src/server/services/retailers.js';
import {
  addMonthsClamped,
  computeWarrantyStatus,
  parseCalendarDate,
  utcDate,
  WarrantyService,
} from '../../src/server/services/warranty.js';
import type { ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';

const admin: Actor = { type: 'admin', id: '0e2b7e24-3f3a-4f0e-8d7a-5b1e2f9c0a11' };

async function expectDomainError(p: Promise<unknown>, code: string, status: number) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
}

describe('warranty date arithmetic (UTC, clamped)', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2024-02-29', 48, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-05-20', 24, '2028-05-20'],
    ['2026-05-20', 0, '2026-05-20'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', -13, '2024-12-15'],
  ])('%s + %i months = %s', (start, months, end) => {
    expect(addMonthsClamped(start, months)).toBe(end);
  });

  it('rejects impossible dates', () => {
    expect(parseCalendarDate('2026-02-29')).toBeUndefined();
    expect(parseCalendarDate('2024-02-29')).toBe('2024-02-29');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-01', '26-01-01', '2026-01-01T00:00:00Z', 20260101, null]) {
      expect(parseCalendarDate(bad)).toBeUndefined();
    }
    expect(() => addMonthsClamped('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addMonthsClamped('2026-02-01', 1.5)).toThrow(RangeError);
  });

  it('takes "today" in UTC', () => {
    // 23:30 in New York on Jan 31 is already Feb 1 in UTC.
    expect(utcDate(new Date('2026-01-31T23:30:00-05:00'))).toBe('2026-02-01');
    expect(utcDate(new Date('2026-02-01T00:30:00+02:00'))).toBe('2026-01-31');
  });

  it('computes the status, end date inclusive', () => {
    const w = { start_date: '2026-01-10', end_date: '2028-01-10', voided_at: null, duration_months: 24 };
    expect(computeWarrantyStatus(null, '2026-01-01')).toBe('NOT_STARTED');
    expect(computeWarrantyStatus({ ...w, start_date: null, end_date: null }, '2026-01-01')).toBe('NOT_STARTED');
    expect(computeWarrantyStatus(w, '2026-01-09')).toBe('NOT_STARTED');
    expect(computeWarrantyStatus(w, '2026-01-10')).toBe('ACTIVE');
    expect(computeWarrantyStatus(w, '2028-01-10')).toBe('ACTIVE');
    expect(computeWarrantyStatus(w, '2028-01-11')).toBe('EXPIRED');
    expect(computeWarrantyStatus({ ...w, voided_at: new Date() }, '2026-06-01')).toBe('VOID');
    expect(computeWarrantyStatus({ ...w, voided_at: new Date() }, '2025-01-01')).toBe('VOID');
    expect(computeWarrantyStatus({ ...w, duration_months: 0, end_date: '2026-01-10' }, '2026-01-10')).toBe('EXPIRED');
  });
});

describe('WarrantyService', () => {
  let t: TestDb;
  let audit: AuditService;
  let lifecycle: LifecycleService;
  let warranty: WarrantyService;
  let modelId: string;
  let shortModelId: string;
  let serial = 0;
  const clock = createManualClock('2026-06-15T10:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    lifecycle = new LifecycleService({ db: t.db, audit, clock: clock.now });
    warranty = new WarrantyService({ db: t.db, audit, lifecycle, clock: clock.now });
    await t.db
      .insertInto('categories')
      .values([
        { id: 1, code: 'J', name: 'Jewelry', warranty_months: 24 },
        { id: 2, code: 'L', name: 'Leather', warranty_months: 1 },
        { id: 3, code: 'Z', name: 'No warranty', warranty_months: 0 },
      ])
      .execute();
    modelId = (await t.db.insertInto('models').values({ category_id: 1, name: 'MONOLITHE', type: 'RING', sku_prefix: 'MON' }).returning('id').executeTakeFirstOrThrow()).id;
    shortModelId = (await t.db.insertInto('models').values({ category_id: 2, name: 'ATLAS', type: 'WALLET', sku_prefix: 'ATL' }).returning('id').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => t.close());

  async function product(opts: { category?: 1 | 2 | 3; path?: ProductStatus[] } = {}) {
    const cat = opts.category ?? 1;
    const code = { 1: 'J', 2: 'L', 3: 'Z' }[cat];
    const s = ++serial;
    const productId = `O26-${code}-${String(s).padStart(5, '0')}`;
    const row = await t.db
      .insertInto('products')
      .values({
        product_id: productId,
        packed_identity: (26 << 25) | (cat << 20) | s,
        year: 2026,
        category_id: cat,
        serial: s,
        sku: `SKU-${s}`,
        model_id: cat === 2 ? shortModelId : modelId,
        material: 'SILVER',
        created_at: clock.now(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('product_status_history')
      .values({ product_id: row.id, from_status: null, to_status: 'ISSUED', actor_type: 'system', created_at: clock.now() })
      .execute();
    for (const step of opts.path ?? []) await lifecycle.transition(productId, step, {}, admin);
    return { id: row.id, productId };
  }

  const statusOf = async (id: string) => (await t.db.selectFrom('products').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  describe('activate', () => {
    it('starts the warranty on the purchase date for the category months and moves ISSUED → ACTIVATED', async () => {
      const p = await product();
      const { warranty: w, statusChange } = await warranty.activate(p.productId, { purchaseDate: '2026-06-01', retailer: ' ORBES Paris ', country: 'fr' }, admin);
      expect(w).toMatchObject({
        productId: p.productId,
        purchaseDate: '2026-06-01',
        startDate: '2026-06-01',
        endDate: '2028-06-01',
        durationMonths: 24,
        retailer: 'ORBES Paris',
        country: 'FR',
        status: 'ACTIVE',
        voidedAt: null,
      });
      expect(statusChange).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED' });
      expect(await statusOf(p.id)).toBe('ACTIVATED');
      const history = await lifecycle.history(p.productId);
      expect(history.at(-1)).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED', reason: 'warranty activated' });
      const entries = await audit.list({ action: 'warranty.activate', targetId: p.productId });
      expect(entries.items[0].details).toMatchObject({ startDate: '2026-06-01', endDate: '2028-06-01', durationMonths: 24, country: 'FR' });
      expect(await warranty.summary(p.productId)).toEqual({ status: 'ACTIVE', startDate: '2026-06-01', endDate: '2028-06-01' });
    });

    it('defaults the purchase date to today (UTC) and clamps month ends', async () => {
      clock.set('2026-01-31T22:00:00.000Z');
      const p = await product({ category: 2 });
      const { warranty: w } = await warranty.activate(p.productId, {}, admin);
      expect(w).toMatchObject({ purchaseDate: '2026-01-31', startDate: '2026-01-31', endDate: '2026-02-28', durationMonths: 1 });
      clock.set('2026-06-15T10:00:00.000Z');
    });

    it('refuses a second activation, voided warranties and non-activatable statuses', async () => {
      const p = await product();
      await warranty.activate(p.productId, { purchaseDate: '2026-06-01' }, admin);
      await expectDomainError(warranty.activate(p.productId, {}, admin), 'WARRANTY_ALREADY_ACTIVATED', 409);

      const v = await product();
      await warranty.void(v.productId, 'grey market', admin);
      await expectDomainError(warranty.activate(v.productId, {}, admin), 'WARRANTY_VOID', 409);

      for (const path of [['REVOKED'], ['LOST'], ['COUNTERFEIT_FLAGGED'], ['RETIRED']] as ProductStatus[][]) {
        const x = await product({ path });
        await expectDomainError(warranty.activate(x.productId, {}, admin), 'WARRANTY_ACTIVATION_NOT_ALLOWED', 409);
        expect(await statusOf(x.id)).toBe(path[0]);
      }
    });

    it('refuses a piece in a pre-sale service (ISSUED → SERVICED) until the service is closed; an after-sale service is no obstacle', async () => {
      // Started there, the warranty would run while closing the service brings the piece back to ISSUED, unsold.
      const pre = await product();
      const svc = await warranty.openService(pre.productId, { type: 'INSPECTION' }, admin);
      await expectDomainError(warranty.activate(pre.productId, {}, admin), 'WARRANTY_ACTIVATION_NOT_ALLOWED', 409);
      expect(await statusOf(pre.id)).toBe('SERVICED');
      expect(await t.db.selectFrom('warranties').select('id').where('product_id', '=', pre.id).execute()).toEqual([]);
      await warranty.completeService(svc.id, {}, admin);
      const sold = await warranty.activate(pre.productId, { purchaseDate: '2026-06-14' }, admin);
      expect(sold.statusChange).toMatchObject({ from: 'ISSUED', to: 'ACTIVATED' });

      const after = await product({ path: ['ACTIVATED'] });
      await warranty.openService(after.productId, { type: 'CLEANING' }, admin);
      const r = await warranty.activate(after.productId, { purchaseDate: '2026-06-14' }, admin);
      expect(r.statusChange).toBeNull();
      expect(r.warranty.status).toBe('ACTIVE');
      expect(await statusOf(after.id)).toBe('SERVICED');
    });

    it('starts the warranty without a status change when the product is already past ISSUED', async () => {
      const p = await product({ path: ['ACTIVATED', 'OWNED'] });
      const r = await warranty.activate(p.productId, { purchaseDate: '2026-06-10' }, admin);
      expect(r.statusChange).toBeNull();
      expect(r.warranty.status).toBe('ACTIVE');
      expect(await statusOf(p.id)).toBe('OWNED');
    });

    it('fills in a NOT_STARTED row created earlier (e.g. at issuance)', async () => {
      const p = await product();
      await t.db.insertInto('warranties').values({ product_id: p.id, duration_months: 24 }).execute();
      expect(await warranty.status(p.productId)).toBe('NOT_STARTED');
      const { warranty: w } = await warranty.activate(p.productId, { purchaseDate: '2026-06-14' }, admin);
      expect(w.status).toBe('ACTIVE');
      expect(await t.db.selectFrom('warranties').select('id').where('product_id', '=', p.id).execute()).toHaveLength(1);
    });

    it('names the point of sale from the register (A-08): its name is shown, its country is the default purchase country', async () => {
      const retailers = new RetailerService({ db: t.db, audit, clock: clock.now });
      const shop = await retailers.create({ name: 'ORBES Paris', city: 'Paris', country: 'fr' }, admin);
      const p = await product();
      const { warranty: w } = await warranty.activate(p.productId, { purchaseDate: '2026-06-01', retailerId: shop.id }, admin);
      expect(w).toMatchObject({ retailer: 'ORBES Paris', retailerId: shop.id, country: 'FR', status: 'ACTIVE' });
      // (The sale mode's activation, with its scan, is in test/api/admin-sale.test.ts.)
      const entry = (await audit.list({ action: 'warranty.activate', targetId: p.productId })).items[0];
      expect(entry.details).toMatchObject({ retailer: 'ORBES Paris', retailerId: shop.id, country: 'FR' });
      // A given country wins; a rename shows everywhere the point of sale is named.
      const q = await product();
      expect((await warranty.activate(q.productId, { retailerId: shop.id, country: 'MC' }, admin)).warranty.country).toBe('MC');
      await retailers.update(shop.id, { name: 'ORBES Paris — Saint-Honoré' }, admin);
      expect((await warranty.get(p.productId))?.retailer).toBe('ORBES Paris — Saint-Honoré');
      expect((await warranty.list({}, { page: 1, pageSize: 200 })).items.find((x) => x.productId === q.productId)?.retailer).toBe('ORBES Paris — Saint-Honoré');
      // The old free text stays readable where no point of sale was chosen.
      const r = await product();
      expect((await warranty.activate(r.productId, { retailer: 'Atelier Rive Gauche' }, admin)).warranty).toMatchObject({ retailer: 'Atelier Rive Gauche', retailerId: null });

      // An inactive or unknown point of sale is refused, and nothing is written.
      await retailers.update(shop.id, { active: false }, admin);
      const s = await product();
      await expectDomainError(warranty.activate(s.productId, { retailerId: shop.id }, admin), 'RETAILER_INACTIVE', 409);
      await expectDomainError(warranty.activate(s.productId, { retailerId: '00000000-0000-4000-8000-000000000000' }, admin), 'RETAILER_NOT_FOUND', 404);
      expect(await warranty.get(s.productId)).toBeNull();
      expect(await statusOf(s.id)).toBe('ISSUED');
      // The void and extend results keep the name.
      await retailers.update(shop.id, { active: true }, admin);
      expect((await warranty.extend(p.productId, 6, admin)).retailer).toBe('ORBES Paris — Saint-Honoré');
      expect((await warranty.void(q.productId, 'test', admin)).retailer).toBe('ORBES Paris — Saint-Honoré');
    });

    it('validates input', async () => {
      const p = await product();
      await expectDomainError(warranty.activate(p.productId, { purchaseDate: '2026-02-30' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.activate(p.productId, { purchaseDate: '2026-06-17' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.activate(p.productId, { purchaseDate: '1999-12-31' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.activate(p.productId, { country: 'FRA' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.activate(p.productId, { retailer: 'x'.repeat(201) }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.activate('O26-J-99999', {}, admin), 'PRODUCT_NOT_FOUND', 404);
      // Tomorrow (UTC) is tolerated for shops ahead of UTC.
      expect((await warranty.activate(p.productId, { purchaseDate: '2026-06-16' }, admin)).warranty.status).toBe('NOT_STARTED');
    });
  });

  describe('status over time', () => {
    it('is NOT_STARTED without a warranty, ACTIVE through the end date, then EXPIRED', async () => {
      const p = await product();
      expect(await warranty.status(p.productId)).toBe('NOT_STARTED');
      expect(await warranty.summary(p.productId)).toEqual({ status: 'NOT_STARTED' });
      expect(await warranty.get(p.productId)).toBeNull();
      await warranty.activate(p.productId, { purchaseDate: '2026-06-15' }, admin);
      expect(await warranty.status(p.productId, new Date('2028-06-15T23:59:59.999Z'))).toBe('ACTIVE');
      expect(await warranty.status(p.productId, new Date('2028-06-16T00:00:00.000Z'))).toBe('EXPIRED');
      expect(await warranty.status(p.productId, new Date('2026-06-14T23:59:59.999Z'))).toBe('NOT_STARTED');
    });

    it('a 0-month category gives no coverage', async () => {
      const p = await product({ category: 3 });
      const { warranty: w } = await warranty.activate(p.productId, { purchaseDate: '2026-06-15' }, admin);
      expect(w).toMatchObject({ durationMonths: 0, endDate: '2026-06-15', status: 'EXPIRED' });
    });
  });

  describe('void / extend', () => {
    it('voids an active warranty once', async () => {
      const p = await product();
      await warranty.activate(p.productId, { purchaseDate: '2026-06-01' }, admin);
      const w = await warranty.void(p.productId, 'unauthorised modification', admin);
      expect(w).toMatchObject({ status: 'VOID', voidReason: 'unauthorised modification' });
      expect(w.voidedAt?.toISOString()).toBe(clock.now().toISOString());
      await expectDomainError(warranty.void(p.productId, 'again', admin), 'WARRANTY_ALREADY_VOID', 409);
      await expectDomainError(warranty.void(p.productId, 'x'.repeat(1001), admin), 'VALIDATION_FAILED', 400);
      expect((await audit.list({ action: 'warranty.void', targetId: p.productId })).total).toBe(1);
    });

    it('voids before activation by creating the row', async () => {
      const p = await product();
      const w = await warranty.voidWarranty(p.productId, undefined, admin);
      expect(w).toMatchObject({ status: 'VOID', startDate: null, durationMonths: 24, voidReason: null });
    });

    it('extends from the start date so month-end clamping does not compound', async () => {
      const p = await product({ category: 2 });
      await warranty.activate(p.productId, { purchaseDate: '2026-01-31' }, admin);
      const w = await warranty.extend(p.productId, 1, admin);
      expect(w).toMatchObject({ durationMonths: 2, startDate: '2026-01-31', endDate: '2026-03-31' });
      const entries = await audit.list({ action: 'warranty.extend', targetId: p.productId });
      expect(entries.items[0].details).toMatchObject({ months: 1, previousEndDate: '2026-02-28', endDate: '2026-03-31' });
    });

    it('can revive an expired warranty by extension', async () => {
      const p = await product({ category: 2 });
      await warranty.activate(p.productId, { purchaseDate: '2026-03-01' }, admin);
      expect(await warranty.status(p.productId)).toBe('EXPIRED');
      expect((await warranty.extend(p.productId, 12, admin)).status).toBe('ACTIVE');
    });

    it('refuses to extend a warranty that is not started or void, and bad month counts', async () => {
      const a = await product();
      await expectDomainError(warranty.extend(a.productId, 12, admin), 'WARRANTY_NOT_STARTED', 409);
      const b = await product();
      await warranty.activate(b.productId, {}, admin);
      await warranty.void(b.productId, 'fraud', admin);
      await expectDomainError(warranty.extend(b.productId, 12, admin), 'WARRANTY_VOID', 409);
      for (const bad of [0, -1, 1.5, 121, Number.NaN]) {
        await expectDomainError(warranty.extend(b.productId, bad, admin), 'VALIDATION_FAILED', 400);
      }
    });
  });

  describe('service records', () => {
    it('open moves to SERVICED; complete returns to the pre-service status', async () => {
      const p = await product({ path: ['ACTIVATED', 'OWNED'] });
      const s = await warranty.openService(p.productId, { type: 'POLISH', location: 'Paris atelier', notes: 'minor scratches' }, admin);
      expect(s).toMatchObject({ productId: p.productId, type: 'POLISH', status: 'OPEN', location: 'Paris atelier', notes: 'minor scratches', closedAt: null });
      expect(s.performedBy).toBe(`admin:${admin.id}`);
      expect(await statusOf(p.id)).toBe('SERVICED');

      clock.advance(3 * 86_400_000);
      const done = await warranty.completeService(s.id, { notes: 'polished, inspected' }, admin);
      expect(done.service).toMatchObject({ status: 'COMPLETED', notes: 'minor scratches\n\npolished, inspected' });
      expect(done.service.closedAt?.toISOString()).toBe(clock.now().toISOString());
      expect(done.statusChange).toMatchObject({ from: 'SERVICED', to: 'OWNED' });
      expect(await statusOf(p.id)).toBe('OWNED');
      expect((await audit.list({ action: 'service.complete', targetId: p.productId })).items[0].details).toMatchObject({ serviceId: s.id, returnedTo: 'OWNED' });

      await expectDomainError(warranty.completeService(s.id, {}, admin), 'SERVICE_NOT_OPEN', 409);
      expect((await warranty.services(p.productId)).map((x) => x.status)).toEqual(['COMPLETED']);
    });

    it('returns to every possible pre-service status', async () => {
      const paths: ProductStatus[][] = [['ACTIVATED'], ['ACTIVATED', 'REGISTERED'], ['ACTIVATED', 'OWNED', 'TRANSFERRED'], ['ACTIVATED', 'RESOLD']];
      for (const path of paths) {
        const p = await product({ path });
        const s = await warranty.openService(p.productId, { type: 'INSPECTION' }, admin);
        expect((await warranty.completeService(s.id, {}, admin)).statusChange?.to).toBe(path.at(-1));
      }
    });

    it('cancel also returns the product and records why', async () => {
      const p = await product({ path: ['ACTIVATED', 'REGISTERED'] });
      const s = await warranty.openService(p.productId, { type: 'RESIZE' }, admin);
      const r = await warranty.cancelService(s.id, { reason: 'client withdrew' }, admin);
      expect(r.service).toMatchObject({ status: 'CANCELLED', notes: 'Cancelled: client withdrew' });
      expect(r.statusChange?.to).toBe('REGISTERED');
      await expectDomainError(warranty.cancelService(s.id, { reason: 'again' }, admin), 'SERVICE_NOT_OPEN', 409);
    });

    it('closing leaves the status alone when the product moved on during the service', async () => {
      const p = await product({ path: ['ACTIVATED', 'OWNED'] });
      const s = await warranty.openService(p.productId, { type: 'REPAIR' }, admin);
      await lifecycle.transition(p.productId, 'STOLEN', { reason: 'stolen from the workshop' }, admin);
      const r = await warranty.completeService(s.id, {}, admin);
      expect(r.statusChange).toBeNull();
      expect(r.service.status).toBe('COMPLETED');
      expect(await statusOf(p.id)).toBe('STOLEN');
      // Recovery still leads back through SERVICED to the pre-service status.
      expect(await lifecycle.allowedTransitions(p.productId)).toEqual(['SERVICED', 'RETIRED', 'REVOKED']);
    });

    it('opens a pre-sale inspection from ISSUED and returns the piece to ISSUED when it completes', async () => {
      const a = await product();
      const svc = await warranty.openService(a.productId, { type: 'INSPECTION', notes: 'QA before shipping' }, admin);
      expect((await t.db.selectFrom('products').select('status').where('product_id', '=', a.productId).executeTakeFirstOrThrow()).status).toBe('SERVICED');
      const closed = await warranty.completeService(svc.id, {}, admin);
      expect(closed.statusChange?.to).toBe('ISSUED');
    });

    it('refuses to open a service while already SERVICED', async () => {
      const b = await product({ path: ['ACTIVATED'] });
      await warranty.openService(b.productId, { type: 'CLEANING' }, admin);
      await expectDomainError(warranty.openService(b.productId, { type: 'CLEANING' }, admin), 'TRANSITION_NOT_ALLOWED', 409);
      expect(await warranty.services(b.productId)).toHaveLength(1);
    });

    it('validates service input', async () => {
      const p = await product({ path: ['ACTIVATED'] });
      await expectDomainError(warranty.openService(p.productId, { type: 'PAINT' as 'POLISH' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.openService(p.productId, { type: 'POLISH', location: 'a\u0007b' }, admin), 'VALIDATION_FAILED', 400);
      await expectDomainError(warranty.completeService('not-a-uuid', {}, admin), 'SERVICE_NOT_FOUND', 404);
      await expectDomainError(warranty.completeService('00000000-0000-4000-8000-000000000000', {}, admin), 'SERVICE_NOT_FOUND', 404);
      await expectDomainError(warranty.cancelService('00000000-0000-4000-8000-000000000000', { reason: '' }, admin), 'VALIDATION_FAILED', 400);
    });
  });

  it('lists warranties filtered by computed status', async () => {
    const pending = await product();
    await t.db.insertInto('warranties').values({ product_id: pending.id, duration_months: 24 }).execute();
    const all = await warranty.list({}, { page: 1, pageSize: 200 });
    expect(all.total).toBeGreaterThan(5);
    for (const status of ['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID'] as const) {
      const page = await warranty.list({ status }, { page: 1, pageSize: 200 });
      expect(page.total).toBeGreaterThan(0);
      expect(page.items.every((w) => w.status === status)).toBe(true);
    }
    const sum = (await Promise.all((['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID'] as const).map((s) => warranty.list({ status: s })))).reduce((n, p) => n + p.total, 0);
    expect(sum).toBe(all.total);
    const page2 = await warranty.list({}, { page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: all.total });
    expect(page2.items).toHaveLength(2);
    await expectDomainError(warranty.list({ status: 'BROKEN' as 'VOID' }), 'VALIDATION_FAILED', 400);
  });
});
