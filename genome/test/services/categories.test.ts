import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../support/db.js';
import { CategoryRegistry } from '../../src/server/services/categories.js';
import { AuditService } from '../../src/server/services/audit.js';
import { DomainError } from '../../src/server/errors.js';
import { createManualClock, type Actor } from '../../src/server/types.js';
import { formatProductId, packIdentity, parseProductId } from '../../src/core/identity.js';

const admin: Actor = { type: 'admin', id: 'admin-1' };

async function expectDomainError(p: Promise<unknown>, code: string, status: number) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  expect((e as DomainError).httpStatus).toBe(status);
}

describe('CategoryRegistry', () => {
  let t: TestDb;
  let audit: AuditService;
  let registry: CategoryRegistry;
  const clock = createManualClock('2026-02-01T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    audit = new AuditService({ db: t.db, clock: clock.now });
    registry = new CategoryRegistry({ db: t.db, audit, clock: clock.now });
  });
  afterAll(() => t.close());

  it('requires load() before the synchronous resolver is used', async () => {
    const fresh = new CategoryRegistry({ db: t.db, audit });
    expect(() => fresh.resolver()).toThrow(/load\(\)/);
    expect(await fresh.load()).toEqual([]);
    expect(fresh.resolver().byCode('J')).toBeUndefined();
  });

  it('assigns the lowest free index, starting at 1', async () => {
    await registry.load();
    const j = await registry.create({ code: 'J', name: 'Jewelry' }, admin);
    const l = await registry.create({ code: ' l ', name: '  Leather goods ', warrantyMonths: 12 }, admin);
    expect(j).toMatchObject({ index: 1, code: 'J', name: 'Jewelry', warrantyMonths: 24, active: true });
    expect(j.createdAt.toISOString()).toBe('2026-02-01T09:00:00.000Z');
    expect(l).toMatchObject({ index: 2, code: 'L', name: 'Leather goods', warrantyMonths: 12 });
  });

  it('fills gaps left by explicitly seeded indices', async () => {
    // A seed script may insert fixed indices directly; allocation must skip them and fill holes.
    await t.db.insertInto('categories').values({ id: 4, code: 'W', name: 'Watches' }).execute();
    await registry.load();
    expect((await registry.create({ code: 'A', name: 'Accessories' }, admin)).index).toBe(3);
    expect((await registry.create({ code: 'B', name: 'Bags' }, admin)).index).toBe(5);
  });

  it('resolves codes and indices synchronously for core identity functions', () => {
    const resolver = registry.resolver();
    expect(resolver.byCode('J')).toEqual({ code: 'J', index: 1, name: 'Jewelry' });
    expect(resolver.byIndex(4)).toEqual({ code: 'W', index: 4, name: 'Watches' });
    expect(resolver.byCode('Z')).toBeUndefined();
    expect(resolver.byIndex(31)).toBeUndefined();

    const id = parseProductId('O26-L-00184', resolver);
    expect(id).toEqual({ year: 2026, categoryIndex: 2, serial: 184 });
    expect(formatProductId(id, resolver)).toBe('O26-L-00184');
    expect(packIdentity(id)).toBe((26 << 25) | (2 << 20) | 184);
  });

  it('the resolver handed out earlier sees categories created later', async () => {
    const resolver = registry.resolver();
    await registry.create({ code: 'C', name: 'Cufflinks' }, admin);
    expect(resolver.byCode('C')?.index).toBe(6);
  });

  it('rejects duplicate codes and invalid input', async () => {
    await expectDomainError(registry.create({ code: 'J', name: 'Again' }, admin), 'CATEGORY_CODE_TAKEN', 409);
    await expectDomainError(registry.create({ code: 'j', name: 'Again' }, admin), 'CATEGORY_CODE_TAKEN', 409);
    await expectDomainError(registry.create({ code: 'JJ', name: 'X' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: '1', name: 'X' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'É', name: 'X' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'Q', name: '   ' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'Q', name: 'x'.repeat(65) }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'Q', name: 'bad\u0007name' }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'Q', name: 'Q', warrantyMonths: -1 }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(registry.create({ code: 'Q', name: 'Q', warrantyMonths: 1.5 }, admin), 'VALIDATION_FAILED', 400);
    await expectDomainError(
      registry.create({ code: 'Q', name: 'Q', extra: true } as unknown as { code: string; name: string }, admin),
      'VALIDATION_FAILED',
      400,
    );
    expect((await registry.list()).map((c) => c.code)).toEqual(['J', 'L', 'A', 'W', 'B', 'C']);
  });

  it('never changes an index: deactivation keeps it resolvable and reserved', async () => {
    const off = await registry.setActive('L', false, admin);
    expect(off).toMatchObject({ index: 2, code: 'L', active: false });
    expect(registry.resolver().byCode('L')?.index).toBe(2); // historical products still verify
    expect((await registry.list({ activeOnly: true })).map((c) => c.code)).not.toContain('L');
    const next = await registry.create({ code: 'D', name: 'Diamonds' }, admin);
    expect(next.index).toBe(7); // index 2 is not reused
    const on = await registry.setActive('L', true, admin);
    expect(on.active).toBe(true);
    // The state it already has: nothing changes, nothing is audited (the next test reads the whole audit trail).
    expect(await registry.setActive('L', true, admin)).toMatchObject({ code: 'L', active: true });
    await expectDomainError(registry.setActive('Z', false, admin), 'CATEGORY_NOT_FOUND', 404);
  });

  it('writes an audit entry per mutation, on a valid chain', async () => {
    const page = await audit.list({ targetType: 'category' }, { page: 1, pageSize: 200 });
    const actions = page.items.map((e) => `${e.action}:${e.targetId}`).reverse();
    expect(actions).toEqual([
      'category.create:J',
      'category.create:L',
      'category.create:A',
      'category.create:B',
      'category.create:C',
      'category.deactivate:L',
      'category.create:D',
      'category.activate:L',
    ]);
    expect(page.items.at(-1)?.details).toEqual({ index: 1, code: 'J', name: 'Jewelry', warrantyMonths: 24 });
    expect(page.items.every((e) => e.actorType === 'admin' && e.actorId === 'admin-1')).toBe(true);
    expect((await audit.verifyChain()).ok).toBe(true);
  });

  it('getByCode/getByIndex reload on a cache miss (category created by another instance)', async () => {
    const other = new CategoryRegistry({ db: t.db, audit });
    await other.load();
    await other.create({ code: 'E', name: 'Eyewear' }, admin);
    expect(registry.resolver().byCode('E')).toBeUndefined(); // stale until reload
    expect((await registry.getByCode('E'))?.index).toBe(8);
    expect(registry.resolver().byCode('E')?.index).toBe(8);
    expect((await registry.getByIndex(8))?.code).toBe('E');
    expect(await registry.getByIndex(30)).toBeUndefined();
  });
});

describe('CategoryRegistry allocation limits and concurrency', () => {
  let t: TestDb;
  let registry: CategoryRegistry;

  beforeEach(async () => {
    t = await createTestDb();
    registry = new CategoryRegistry({ db: t.db, audit: new AuditService({ db: t.db }) });
    await registry.load();
    return () => t.close();
  });

  it('concurrent creates get distinct indices', async () => {
    const codes = 'ABCDEFGHIJ'.split('');
    const created = await Promise.all(codes.map((code) => registry.create({ code, name: `Cat ${code}` }, admin)));
    expect(created.map((c) => c.index).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('at most 26 categories exist: one per letter (indices 27..31 stay unreachable)', async () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const code of letters) await registry.create({ code, name: `Cat ${code}` }, admin);
    const all = await registry.list();
    expect(all.map((c) => c.index)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    await expectDomainError(registry.create({ code: 'A', name: 'dup' }, admin), 'CATEGORY_CODE_TAKEN', 409);
  });
});
