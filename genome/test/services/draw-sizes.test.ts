/**
 * Sizes in draws, like a LIVE RELEASE (plan NEXT LOT §3.6.F, step 6.2; services/drops.ts, guarantees.ts, orders.ts):
 *
 *  - a draw is created with its sizes and their pieces, each one of the model's sizes, its quantity their sum: at most 24
 *    sizes with pieces (a necklace declares more), 10 000 pieces at most, a quantity given refused, a draft changed the
 *    same way, audited with its sizes; a DRAFT of before this lot, without sizes, is never published;
 *  - the account's entry read with the size YOUR SIZES suggests (GET /api/v1/club/drops/:id/entry's service);
 *  - ENTER in a size, CHANGE SIZE while entries are open, WITHDRAW keeping the size, RESERVE per size (DROP_SIZE_FULL);
 *  - the draw per size, checked from what the page publishes (the seed proof); the guaranteed entries per size, in
 *    pieces; OFFER NEXT per size; a draw without sizes drawn exactly as before;
 *  - a draw's order takes its entry's size and SKU at once.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { drawOrder, type AdminDrop, type DrawSizeInput } from '../../src/server/services/drops.js';
import { defaultLocationId } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { poolDraw, withDrawSizes } from '../support/draws.js';
import { stockPieces } from '../support/fulfil.js';
import { accountOfTier, createAccount, createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('sizes in draws (plan NEXT LOT §3.6.F)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const drops = () => ctx.services.drops;
  const at = (ms: number) => new Date(clock.now().getTime() + ms);
  const auditsOf = (targetId: string, action: string) =>
    t.db.selectFrom('audit_logs').select('details').where('target_id', '=', targetId).where('action', '=', action).orderBy('id').execute();

  /** A model of `type` (its kind the same) whose sizes `labels` are declared, each its own SKU. */
  async function sizedModel(labels: readonly string[], type: 'RING' | 'NECKLACE' = 'RING'): Promise<string> {
    const prefix = `DSZ-${randomUUID().slice(0, 8)}`;
    const id = (
      await t.db
        .insertInto('models')
        .values({ category_id: 1, name: `SIZED ${prefix}`, type, sku_prefix: prefix, size_type: type, size_kind: type })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    for (const l of labels) await t.db.insertInto('skus').values({ model_id: id, size_label: l, code: `${prefix}-${l}` }).execute();
    return id;
  }

  /** A draw of `modelId` in `sizes`, opening in `opensIn` for `hours` hours, published unless asked otherwise. */
  async function sizedDraw(modelId: string, sizes: DrawSizeInput[], o: { opensIn?: number; hours?: number; early?: number; published?: boolean; window?: number } = {}): Promise<AdminDrop> {
    const opensAt = at(o.opensIn ?? HOUR);
    const d = await drops().create(
      {
        modelId,
        title: 'MONOLITHE — A DRAW IN SIZES',
        sizes,
        opensAt,
        closesAt: new Date(opensAt.getTime() + (o.hours ?? 2) * HOUR),
        earlyAccessHours: o.early ?? 0,
        earlyAccessPlatineHours: o.early ?? 0,
        ...(o.window !== undefined ? { purchaseWindowHours: o.window } : {}),
      },
      admin,
    );
    if (o.published !== false) await drops().publish(d.id, admin);
    return drops().get(d.id);
  }
  const sizeId = (d: AdminDrop, label: string) => d.sizes.find((s) => s.label === label)!.id;

  it('creates and changes a draw with its sizes: each one of the model\'s, 0 left out, at most 24 with pieces and 10 000 pieces, the quantity their sum; a quantity given or no size refused; audited', async () => {
    const ring = await sizedModel(['50', '52', '54', '56']);
    const opensAt = at(HOUR);
    const base = { modelId: ring, title: 'A DRAW', opensAt, closesAt: new Date(opensAt.getTime() + HOUR) };
    // Worded refusals, nothing written.
    const refused = async (input: Record<string, unknown>, message: string) => {
      const e = await rejects(drops().create({ ...base, ...input } as never, admin), 'VALIDATION_FAILED', 400);
      expect(e.publicMessage).toBe(message);
    };
    await refused({}, 'A release has 1 to 24 sizes with pieces.');
    await refused({ sizes: [] }, 'A release has 1 to 24 sizes with pieces.');
    await refused({ sizes: [{ label: '52', pieces: 0 }] }, 'A release has 1 to 24 sizes with pieces.');
    await refused({ quantity: 3, sizes: [{ label: '52', pieces: 3 }] }, 'A draw’s pieces are given per size.');
    await refused({ sizes: [{ label: '52', pieces: 6_000 }, { label: '54', pieces: 4_001 }] }, 'A release has at most 10 000 pieces.');
    await refused({ sizes: [{ label: '52', pieces: 1 }, { label: '52', pieces: 2 }] }, 'The size 52 is listed twice.');
    await refused({ sizes: [{ label: '52', pieces: 10_001 }] }, 'A size has 0 to 10000 pieces.');
    // A size the model does not declare: SIZE_NOT_DECLARED, its sizes listed.
    await rejects(drops().create({ ...base, sizes: [{ label: '58', pieces: 1 }] }, admin), 'SIZE_NOT_DECLARED', 400);
    // A necklace declares more than 24 lengths: 25 with pieces refused, worded, 24 accepted, the others at 0 left out.
    const lengths = Array.from({ length: 30 }, (_, i) => String(40 + i));
    const necklace = await sizedModel(lengths, 'NECKLACE');
    const sent = (n: number) => lengths.map((label, i) => ({ label, pieces: i < n ? 1 : 0 }));
    const e = await rejects(drops().create({ ...base, modelId: necklace, sizes: sent(25) }, admin), 'VALIDATION_FAILED', 400);
    expect(e.publicMessage).toBe('A release has 1 to 24 sizes with pieces.');
    const wide = await drops().create({ ...base, modelId: necklace, sizes: sent(24) }, admin);
    expect([wide.quantity, wide.sizes.length]).toEqual([24, 24]);
    expect(await t.db.selectFrom('drops').select('id').where('title', '=', 'A DRAW').execute()).toHaveLength(1);

    // Created: its sizes in the order given, the zero left out, its quantity their sum, each linked to its SKU.
    const d = await drops().create({ ...base, sizes: [{ label: '50', pieces: 0 }, { label: '52', pieces: 3 }, { label: 'SIZE 54', pieces: 5 }] }, admin);
    expect(d.quantity).toBe(8);
    expect(d.sizes.map((s) => [s.label, s.pieces, s.entered, s.held, s.waitlisted])).toEqual([
      ['52', 3, 0, 0, 0],
      ['54', 5, 0, 0, 0],
    ]);
    const skus = await t.db.selectFrom('drop_sizes as s').innerJoin('skus as k', 'k.id', 's.sku_id').select(['s.label', 'k.size_label']).where('s.drop_id', '=', d.id).orderBy('s.position').execute();
    expect(skus).toEqual([
      { label: '52', size_label: '52' },
      { label: '54', size_label: '54' },
    ]);
    expect((await auditsOf(d.id, 'drop.create'))[0]!.details).toMatchObject({ quantity: 8, sizes: [{ label: '52', pieces: 3 }, { label: '54', pieces: 5 }] });
    // A DRAFT changes its sizes (the quantity follows), audited before and after; a quantity is refused.
    await rejects(drops().update(d.id, { quantity: 9 }, admin), 'VALIDATION_FAILED', 400);
    const changed = await drops().update(d.id, { sizes: [{ label: '52', pieces: 2 }, { label: '56', pieces: 4 }] }, admin);
    expect([changed.quantity, changed.sizes.map((s) => [s.label, s.pieces])]).toEqual([6, [['52', 2], ['56', 4]]]);
    expect((await auditsOf(d.id, 'drop.update'))[0]!.details).toEqual({
      before: { sizes: [{ label: '52', pieces: 3 }, { label: '54', pieces: 5 }], quantity: 8 },
      after: { sizes: [{ label: '52', pieces: 2 }, { label: '56', pieces: 4 }], quantity: 6 },
    });
    // The same sizes again change nothing, and nothing is audited.
    await drops().update(d.id, { sizes: [{ label: '52', pieces: 2 }, { label: '56', pieces: 4 }] }, admin);
    expect(await auditsOf(d.id, 'drop.update')).toHaveLength(1);
    await drops().publish(d.id, admin);
    expect((await auditsOf(d.id, 'drop.publish'))[0]!.details).toMatchObject({ sizes: [{ label: '52', pieces: 2 }, { label: '56', pieces: 4 }] });
    await rejects(drops().update(d.id, { sizes: [{ label: '52', pieces: 9 }] }, admin), 'DROP_PUBLISHED', 409);
    // The public page: each size's pieces, nothing reserved, nothing full.
    expect((await drops().sheet(d.id)).sizes).toEqual([
      { id: sizeId(changed, '52'), label: '52', pieces: 2, reserved: 0, full: false },
      { id: sizeId(changed, '56'), label: '56', pieces: 4, reserved: 0, full: false },
    ]);
  });

  it('never publishes a DRAFT of before this lot, which has no sizes, until it is given its sizes', async () => {
    const old = await poolDraw(drops(), t.db, { modelId: f.modelId, title: 'A DRAFT OF BEFORE', quantity: 3, opensAt: at(HOUR), closesAt: at(2 * HOUR) }, admin, { publish: false });
    expect(old.sizes).toEqual([]);
    const e = await rejects(drops().publish(old.id, admin), 'DROP_SIZES_REQUIRED', 409);
    expect(e.publicMessage).toBe('Give the release its sizes and their pieces before publishing it.');
    // Its model has no size type yet: no sizes to give it until the Catalogue gives the model its own (§5.1 #20).
    await rejects(drops().update(old.id, { sizes: [{ label: 'ONE SIZE', pieces: 3 }] }, admin), 'DROP_MODEL_SIZES_MISSING', 409);
    await withDrawSizes(t.db, f.modelId, ['ONE SIZE'], async () => {
      await drops().update(old.id, { sizes: [{ label: 'ONE SIZE', pieces: 3 }] }, admin);
      expect((await drops().publish(old.id, admin)).state).toBe('UPCOMING');
    });
  });

  it('checks a draw\'s stock per size at its location, as a LIVE RELEASE\'s (plan NEXT LOT §3.5.4.3): the pieces in stock, those that will wait for supplier stock, each size\'s SKU; 404 for a LIVE RELEASE', async () => {
    const ring = await sizedModel(['52', '54']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 2 }, { label: '54', pieces: 1 }], { published: false });
    const sku = async (label: string) => (await t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', label).executeTakeFirstOrThrow()).id;
    const location = await defaultLocationId(t.db);
    await stockPieces(ctx, { skuId: await sku('54'), locationId: location, count: 1, material: '925 STERLING SILVER' }, admin);
    const check = await drops().feasibility(d.id);
    expect(check.location?.id).toBe(location);
    expect(check.sizes.map((l) => [l.label, l.onSale, l.fromStock, l.short, l.skuId])).toEqual([
      ['52', 2, 0, 2, await sku('52')],
      ['54', 1, 1, 0, await sku('54')],
    ]);
    expect([check.short, check.afterRoom, check.warnings]).toEqual([2, null, ['52: 0 in stock, 2 will wait for supplier stock.']]);
    const live = await createLiveRelease(f, { opensAt: at(24 * HOUR) });
    await rejects(drops().feasibility(live.id), 'DROP_NOT_FOUND', 404);
    await rejects(drops().feasibility(randomUUID()), 'DROP_NOT_FOUND', 404);
  });

  it('takes no draw on a model with no size type, whose sizes would be made up: refused at the creation, at a change of model or of sizes, and at the publication (DROP_MODEL_SIZES_MISSING), nothing written', async () => {
    const typeless = await createModel(t.db, 'NO TYPE');
    const opensAt = at(HOUR);
    const base = { title: 'A DRAW', opensAt, closesAt: new Date(opensAt.getTime() + HOUR) };
    const missing = await rejects(drops().create({ ...base, modelId: typeless, sizes: [{ label: '52', pieces: 2 }] }, admin), 'DROP_MODEL_SIZES_MISSING', 409);
    expect(missing.publicMessage).toBe('No sizes yet: give this model its size type and its sizes in the Catalogue.');
    expect(await t.db.selectFrom('drops').select('id').where('model_id', '=', typeless).execute()).toEqual([]);
    expect(await t.db.selectFrom('skus').select('id').where('model_id', '=', typeless).execute()).toEqual([]);
    const ring = await sizedModel(['52']);
    const d = await drops().create({ ...base, modelId: ring, sizes: [{ label: '52', pieces: 2 }] }, admin);
    await rejects(drops().update(d.id, { modelId: typeless }, admin), 'DROP_MODEL_SIZES_MISSING', 409);
    await rejects(drops().update(d.id, { modelId: typeless, sizes: [{ label: '52', pieces: 2 }] }, admin), 'DROP_MODEL_SIZES_MISSING', 409);
    expect((await drops().get(d.id)).model.id).toBe(ring);
    expect(await t.db.selectFrom('skus').select('id').where('model_id', '=', typeless).execute()).toEqual([]);
    // A draft whose model has lost its type below the service (a type is never cleared through it): not published.
    await t.db.updateTable('models').set({ size_type: null }).where('id', '=', ring).execute();
    await rejects(drops().publish(d.id, admin), 'DROP_MODEL_SIZES_MISSING', 409);
    expect((await drops().get(d.id)).state).toBe('DRAFT');
  });

  it('reads the account\'s entry and the size YOUR SIZES suggests among the draw\'s sizes with pieces; 404 for an unknown or unpublished draw', async () => {
    const ring = await sizedModel(['52', '54', '56']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 1 }, { label: '54', pieces: 0 }, { label: '56', pieces: 2 }]);
    const draft = await sizedDraw(ring, [{ label: '52', pieces: 1 }], { published: false });
    const a = await createAccount(t.db);
    for (const id of [randomUUID(), 'nope', draft.id]) await rejects(drops().entryFor(a.id, id), 'DROP_NOT_FOUND', 404);
    expect(await drops().entryFor(a.id, d.id)).toEqual({ entry: null, savedSize: null });
    // A saved ring size of 56 suggests 56; one of 54 (no pieces in it) suggests nothing.
    await t.db.insertInto('account_sizes').values({ account_id: a.id, kind: 'RING', value_mm: 56 }).execute();
    expect((await drops().entryFor(a.id, d.id)).savedSize).toEqual({ id: sizeId(d, '56'), label: '56' });
    await t.db.updateTable('account_sizes').set({ value_mm: 54 }).where('account_id', '=', a.id).execute();
    expect((await drops().entryFor(a.id, d.id)).savedSize).toBeNull();
    clock.set(at(HOUR + MINUTE));
    await drops().enter(a.id, d.id, a.actor, { sizeId: sizeId(d, '52') });
    expect((await drops().entryFor(a.id, d.id)).entry).toMatchObject({ status: 'ENTERED', size: { id: sizeId(d, '52'), label: '52' } });
  });

  it('enters in a size, changes it while entries are open, keeps it when withdrawn and asks it again; refusals', async () => {
    const ring = await sizedModel(['52', '54', '56']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 2 }, { label: '54', pieces: 1 }, { label: '56', pieces: 0 }]);
    const pool = await poolDraw(drops(), t.db, { modelId: f.modelId, title: 'ONE POOL', quantity: 2, opensAt: at(HOUR), closesAt: at(2 * HOUR) }, admin);
    const a = await createAccount(t.db);
    const b = await createAccount(t.db);
    // Not open yet: as before.
    await rejects(drops().enter(a.id, d.id, a.actor, { sizeId: sizeId(d, '52') }), 'DROP_NOT_OPEN', 409);
    clock.set(at(HOUR + MINUTE));
    await rejects(drops().enter(a.id, d.id, a.actor), 'DROP_SIZE_REQUIRED', 400);
    await rejects(drops().enter(a.id, d.id, a.actor, { sizeId: randomUUID() }), 'DROP_SIZE_UNKNOWN', 404);
    await rejects(drops().enter(a.id, d.id, a.actor, { sizeId: 'nope' }), 'DROP_SIZE_UNKNOWN', 404);
    // A size of another draw, and a size given to a draw without sizes.
    await rejects(drops().enter(a.id, pool.id, a.actor, { sizeId: sizeId(d, '52') }), 'DROP_SIZE_UNKNOWN', 404);
    expect((await drops().enter(a.id, pool.id, a.actor)).size).toBeNull();
    const entered = await drops().enter(a.id, d.id, a.actor, { sizeId: sizeId(d, '52') });
    expect(entered).toMatchObject({ status: 'ENTERED', size: { id: sizeId(d, '52'), label: '52' } });
    expect((await auditsOf(d.id, 'drop.enter'))[0]!.details).toEqual({ entryId: entered.id, sizeId: sizeId(d, '52') });
    // Change size: the same size again changes nothing; another is audited with the size before.
    await drops().changeSize(a.id, d.id, { sizeId: sizeId(d, '52') }, a.actor);
    expect(await auditsOf(d.id, 'drop.size')).toEqual([]);
    expect((await drops().changeSize(a.id, d.id, { sizeId: sizeId(d, '54') }, a.actor)).size).toEqual({ id: sizeId(d, '54'), label: '54' });
    expect((await auditsOf(d.id, 'drop.size'))[0]!.details).toEqual({ entryId: entered.id, sizeId: sizeId(d, '54'), before: sizeId(d, '52') });
    await rejects(drops().changeSize(b.id, d.id, { sizeId: sizeId(d, '54') }, b.actor), 'DROP_NOT_ENTERED', 409);
    await rejects(drops().changeSize(a.id, pool.id, { sizeId: sizeId(d, '54') }, a.actor), 'DROP_SIZE_UNKNOWN', 404);
    // A size every piece of which is reserved stays open to an entry: the draw ranks a waiting list in each size.
    expect((await drops().enter(b.id, d.id, b.actor, { sizeId: sizeId(d, '54') })).status).toBe('ENTERED');
    // Withdrawn: the size is kept (the app preselects it), entering again asks it again.
    expect((await drops().withdraw(a.id, d.id, a.actor)).size).toEqual({ id: sizeId(d, '54'), label: '54' });
    await rejects(drops().changeSize(a.id, d.id, { sizeId: sizeId(d, '52') }, a.actor), 'DROP_NOT_ENTERED', 409);
    await rejects(drops().enter(a.id, d.id, a.actor), 'DROP_SIZE_REQUIRED', 400);
    expect((await drops().enter(a.id, d.id, a.actor, { sizeId: sizeId(d, '52') })).size).toEqual({ id: sizeId(d, '52'), label: '52' });
    // Entries closed: no change of size.
    clock.set(at(2 * HOUR));
    await rejects(drops().changeSize(a.id, d.id, { sizeId: sizeId(d, '54') }, a.actor), 'DROP_NOT_OPEN', 409);
  });

  it('reserves a place per size during the early access (DROP_SIZE_FULL, its size named), the place keeping its size; full sizes on the page', async () => {
    const ring = await sizedModel(['52', '54']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 1 }, { label: '54', pieces: 2 }], { opensIn: 10 * HOUR, early: 48 });
    const [p1, p2, p3] = [await accountOfTier(f, 2), await accountOfTier(f, 3), await accountOfTier(f, 2)];
    await rejects(drops().reserve(p1.id, d.id, p1.actor), 'DROP_SIZE_REQUIRED', 400);
    const placed = await drops().reserve(p1.id, d.id, p1.actor, { sizeId: sizeId(d, '52') });
    expect(placed).toMatchObject({ status: 'SELECTED', reserved: true, size: { id: sizeId(d, '52'), label: '52' } });
    expect((await auditsOf(d.id, 'drop.reserve'))[0]!.details).toMatchObject({ entryId: placed.id, sizeId: sizeId(d, '52') });
    const e = await rejects(drops().reserve(p2.id, d.id, p2.actor, { sizeId: sizeId(d, '52') }), 'DROP_SIZE_FULL', 409);
    expect(e.publicMessage).toBe('Every piece in size 52 has been reserved.');
    expect((await drops().reserve(p2.id, d.id, p2.actor, { sizeId: sizeId(d, '54') })).size?.label).toBe('54');
    const sheet = await drops().sheet(d.id);
    expect(sheet.sizes.map((s) => [s.label, s.pieces, s.reserved, s.full])).toEqual([
      ['52', 1, 1, true],
      ['54', 2, 1, false],
    ]);
    expect(sheet).toMatchObject({ reserved: 2, full: false });
    // A place reserved directly keeps its size, once entries open.
    clock.set(at(10 * HOUR + MINUTE));
    await rejects(drops().changeSize(p1.id, d.id, { sizeId: sizeId(d, '54') }, p1.actor), 'DROP_SIZE_FIXED', 409);
    expect((await drops().enter(p3.id, d.id, p3.actor, { sizeId: sizeId(d, '52') })).status).toBe('ENTERED');
  });

  it('reserves with the house\'s guarantee only where its size can serve its pieces: a shown one refused in a size too small (DROP_GUARANTEE_SIZE_FULL, never DROP_SIZE_FULL), a hidden one given an ordinary place', async () => {
    const ring = await sizedModel(['52', '54']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 2 }, { label: '54', pieces: 6 }], { opensIn: 10 * HOUR, early: 48 });
    const [shown, hidden] = [await accountOfTier(f, 2), await accountOfTier(f, 3)];
    await ctx.services.guarantees.grant(shown.id, { scope: 'RELEASE', targetId: d.id, pieces: 3, validUntil: '2026-12-31', visible: true }, admin);
    await ctx.services.guarantees.grant(hidden.id, { scope: 'RELEASE', targetId: d.id, pieces: 3, validUntil: '2026-12-31', visible: false }, admin);
    // 52 has its 2 pieces free, the guarantee 3: the size is not full, the guarantee cannot be given there.
    const e = await rejects(drops().reserve(shown.id, d.id, shown.actor, { sizeId: sizeId(d, '52') }), 'DROP_GUARANTEE_SIZE_FULL', 409);
    expect(e.publicMessage).toBe('Your guaranteed place cannot be given in this size: choose another size.');
    expect((await drops().sheet(d.id)).sizes.find((s) => s.label === '52')).toMatchObject({ reserved: 0, full: false });
    // Hidden: an ordinary place of 1 piece in 52, as any PLATINE or PALLADIUM account's; its guarantee unused.
    expect(await drops().reserve(hidden.id, d.id, hidden.actor, { sizeId: sizeId(d, '52') })).toMatchObject({ status: 'SELECTED', reserved: true, guaranteed: false, pieces: 1, size: { label: '52' } });
    const row = await t.db.selectFrom('drop_entries').select(['guarantee_id', 'pieces']).where('account_id', '=', hidden.id).where('drop_id', '=', d.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ guarantee_id: null, pieces: 1 });
    expect((await t.db.selectFrom('house_guarantees').select('status').where('account_id', '=', hidden.id).where('covered_drop_id', '=', d.id).executeTakeFirstOrThrow()).status).toBe('ACTIVE');
    // The shown holder in 54, which serves its 3 pieces.
    expect(await drops().reserve(shown.id, d.id, shown.actor, { sizeId: sizeId(d, '54') })).toMatchObject({ status: 'SELECTED', guaranteed: true, pieces: 3, size: { label: '54' } });
  });

  it('draws per size, as the page lets anyone check from the seed: ranked once, each size filled in that order after its reservations and its guaranteed places; OFFER NEXT per size; the order takes the size and its SKU', async () => {
    const ring = await sizedModel(['16', '17', '18']);
    const d = await sizedDraw(ring, [{ label: '16', pieces: 3 }, { label: '17', pieces: 5 }, { label: '18', pieces: 4 }], { opensIn: 10 * HOUR, early: 48 });
    const sizes = { '16': sizeId(d, '16'), '17': sizeId(d, '17'), '18': sizeId(d, '18') } as const;
    // Two places reserved directly in 17 during the early access.
    for (let i = 0; i < 2; i++) {
      const p = await accountOfTier(f, 2);
      await drops().reserve(p.id, d.id, p.actor, { sizeId: sizes['17'] });
    }
    // A guarantee of 2 pieces shown to a PLATINE holder, who reserves with it in 16 during the early access: its size's
    // RESERVED counts it, and the guaranteed list (once drawn) says so, so the page never counts it twice.
    const reserver = await accountOfTier(f, 2);
    await ctx.services.guarantees.grant(reserver.id, { scope: 'RELEASE', targetId: d.id, pieces: 2, validUntil: '2026-12-31', visible: true }, admin);
    expect(await drops().reserve(reserver.id, d.id, reserver.actor, { sizeId: sizes['16'] })).toMatchObject({ status: 'SELECTED', reserved: true, guaranteed: true, pieces: 2, size: { label: '16' } });
    // A guarantee of 3 pieces shown to its holder, entered in 18: it takes 3 of 18's places, not 1.
    const holder = await accountOfTier(f, 1);
    await ctx.services.guarantees.grant(holder.id, { scope: 'RELEASE', targetId: d.id, pieces: 3, validUntil: '2026-12-31', visible: true }, admin);
    clock.set(at(10 * HOUR + MINUTE));
    await drops().enter(holder.id, d.id, holder.actor, { sizeId: sizes['18'] });
    // Twenty entries of every tier spread over the sizes: 16 gets 8, 17 gets 7, 18 gets 5.
    const spread: (keyof typeof sizes)[] = [...Array<'16'>(8).fill('16'), ...Array<'17'>(7).fill('17'), ...Array<'18'>(5).fill('18')];
    const accounts: string[] = [];
    for (const [i, label] of spread.entries()) {
      const a = await accountOfTier(f, (i % 4) as 0 | 1 | 2 | 3);
      accounts.push(a.id);
      await drops().enter(a.id, d.id, a.actor, { sizeId: sizes[label] });
    }
    clock.set(at(2 * HOUR));
    const out = await drops().draw(d.id, admin);
    expect(out.sizes.map((s) => [s.label, s.places, s.selected, s.waitlisted])).toEqual([
      ['16', 1, 1, 7],
      ['17', 3, 3, 4],
      ['18', 1, 1, 4],
    ]);
    expect([out.entries, out.selected, out.waitlisted, out.guaranteed, out.guaranteedPieces]).toEqual([20, 5, 15, 1, 3]);
    expect((await auditsOf(d.id, 'drop.draw'))[0]!.details).toMatchObject({ sizes: out.sizes.map((s) => ({ sizeId: s.id, label: s.label, places: s.places, selected: s.selected, waitlisted: s.waitlisted })) });

    // The seed proof: the page's seed, sizes and entries give every status.
    const sheet = await drops().sheet(d.id);
    const listed = (await drops().drawEntries(d.id, { page: 1, pageSize: 100 })).items;
    const seed = Uint8Array.from(Buffer.from(sheet.seed!, 'hex'));
    const recomputed = drawOrder(listed.map((e) => ({ id: e.id, tier: e.tier as 0 | 1 | 2 | 3, seniority: e.seniority })), seed);
    expect(recomputed.map((e) => [e.id, e.rank])).toEqual(listed.map((e) => [e.id, e.rank]));
    // A size's places: its pieces, less its places reserved directly, less its guaranteed places not reserved (those its
    // RESERVED already counts), from the page alone.
    const left = new Map(sheet.sizes.map((s) => [s.id, s.pieces - s.reserved - sheet.guaranteed.filter((g) => g.size?.id === s.id && !g.reserved).reduce((n, g) => n + g.pieces, 0)]));
    expect(sheet.sizes.map((s) => [s.label, s.reserved])).toEqual([
      ['16', 2],
      ['17', 2],
      ['18', 0],
    ]);
    const expected = new Map<string, string>();
    for (const e of listed) {
      const n = left.get(e.size!.id)!;
      expected.set(e.id, n >= 1 ? 'SELECTED' : 'WAITLISTED');
      if (n >= 1) left.set(e.size!.id, n - 1);
    }
    const statuses = await t.db.selectFrom('drop_entries').select(['id', 'status']).where('id', 'in', listed.map((e) => e.id)).execute();
    for (const s of statuses) expect(s.status, s.id).toBe(expected.get(s.id));
    const reservedWith = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', reserver.id).executeTakeFirstOrThrow();
    const drawnWith = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', holder.id).executeTakeFirstOrThrow();
    expect(sheet.guaranteed).toEqual(
      [
        { id: reservedWith.id, pieces: 2, size: { id: sizes['16'], label: '16' }, reserved: true },
        { id: drawnWith.id, pieces: 3, size: { id: sizes['18'], label: '18' }, reserved: false },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    // Each keeps its rank, one ranking across the sizes.
    expect(listed.map((e) => e.rank)).toEqual(listed.map((_, i) => i + 1));

    // The console's counts per size, its entries per size.
    const counted = await drops().get(d.id);
    expect(counted.sizes.map((s) => [s.label, s.pieces, s.reserved, s.entered, s.held, s.waitlisted])).toEqual([
      ['16', 3, 2, 0, 3, 7],
      ['17', 5, 2, 0, 5, 4],
      ['18', 4, 0, 0, 4, 4],
    ]);
    const in17 = await drops().entries(d.id, { sizeId: sizes['17'] }, { page: 1, pageSize: 50 });
    expect(in17.total).toBe(9);
    expect(in17.items.every((e) => e.size?.label === '17')).toBe(true);
    await rejects(drops().entries(d.id, { sizeId: randomUUID() }, { page: 1, pageSize: 50 }), 'DROP_SIZE_UNKNOWN', 404);

    // OFFER NEXT: per size, the size required; a full size has no place to offer; a place lapsed gives one back in its size.
    await rejects(drops().offerNext(d.id, admin), 'DROP_SIZE_REQUIRED', 400);
    await rejects(drops().offerNext(d.id, admin, { sizeId: sizes['16'] }), 'DROP_FULL', 409);
    // The place drawn in 16 (beside the one reserved there with the guarantee) lapses.
    const held16 = (await drops().entries(d.id, { sizeId: sizes['16'], status: 'SELECTED' }, { page: 1, pageSize: 50 })).items.filter((e) => e.rank !== null);
    expect(held16).toHaveLength(1);
    clock.set(at(49 * HOUR));
    await drops().lapse(d.id, held16[0]!.id, null, admin);
    const next16 = (await drops().entries(d.id, { sizeId: sizes['16'], status: 'WAITLISTED' }, { page: 1, pageSize: 50 })).items[0]!;
    const offered = await drops().offerNext(d.id, admin, { sizeId: sizes['16'] });
    expect([offered.id, offered.status, offered.size?.label]).toEqual([next16.id, 'SELECTED', '16']);
    expect((await auditsOf(d.id, 'drop.entry.offer'))[0]!.details).toMatchObject({ entryId: next16.id, sizeId: sizes['16'] });
    await rejects(drops().offerNext(d.id, admin, { sizeId: sizes['16'] }), 'DROP_FULL', 409);

    // CONFIRMED: its order in the entry's size, with its SKU, held or waiting for stock at once.
    const confirmed = await drops().confirm(d.id, offered.id, null, admin);
    const order = await t.db.selectFrom('orders').select(['size_label', 'sku_id', 'reservation']).where('drop_entry_id', '=', confirmed.id).executeTakeFirstOrThrow();
    const sku16 = await t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', '16').executeTakeFirstOrThrow();
    expect(order).toEqual({ size_label: '16', sku_id: sku16.id, reservation: 'AWAITING' });
    // The guaranteed entry: one order per piece, all in its size.
    const held = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', holder.id).executeTakeFirstOrThrow();
    await drops().confirm(d.id, held.id, null, admin);
    const sku18 = await t.db.selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', '18').executeTakeFirstOrThrow();
    expect((await t.db.selectFrom('orders').select(['size_label', 'sku_id']).where('drop_entry_id', '=', held.id).orderBy('piece').execute())).toEqual([
      { size_label: '18', sku_id: sku18.id },
      { size_label: '18', sku_id: sku18.id },
      { size_label: '18', sku_id: sku18.id },
    ]);
  });

  it('binds the house\'s guarantee only where its size can serve its pieces: a shown one refused in a size too small, a hidden one leaving an ordinary entry; a guarantee set aside later binds only an entry whose size serves it', async () => {
    const ring = await sizedModel(['52', '54']);
    const d = await sizedDraw(ring, [{ label: '52', pieces: 2 }, { label: '54', pieces: 4 }], { opensIn: 2 * HOUR, hours: 4 });
    const shown = await accountOfTier(f, 0);
    const hidden = await accountOfTier(f, 0);
    const late = await accountOfTier(f, 0);
    await ctx.services.guarantees.grant(shown.id, { scope: 'RELEASE', targetId: d.id, pieces: 3, validUntil: '2026-12-31', visible: true }, admin);
    await ctx.services.guarantees.grant(hidden.id, { scope: 'RELEASE', targetId: d.id, pieces: 3, validUntil: '2026-12-31', visible: false }, admin);
    clock.set(at(2 * HOUR + MINUTE));
    const e = await rejects(drops().enter(shown.id, d.id, shown.actor, { sizeId: sizeId(d, '52') }), 'DROP_GUARANTEE_SIZE_FULL', 409);
    expect(e.publicMessage).toBe('Your guaranteed place cannot be given in this size: choose another size.');
    expect(await drops().enter(shown.id, d.id, shown.actor, { sizeId: sizeId(d, '54') })).toMatchObject({ guaranteed: true, pieces: 3 });
    // Hidden: an ordinary entry in 52 (no mark for its holder); 54 can no longer serve 3 more pieces either.
    expect(await drops().enter(hidden.id, d.id, hidden.actor, { sizeId: sizeId(d, '52') })).toMatchObject({ guaranteed: false, pieces: 1 });
    expect((await t.db.selectFrom('drop_entries').select('guarantee_id').where('account_id', '=', hidden.id).where('drop_id', '=', d.id).executeTakeFirstOrThrow()).guarantee_id).toBeNull();
    expect((await drops().changeSize(hidden.id, d.id, { sizeId: sizeId(d, '54') }, hidden.actor)).pieces).toBe(1);
    // The shown holder moves to 52: refused, its guarantee kept in 54.
    await rejects(drops().changeSize(shown.id, d.id, { sizeId: sizeId(d, '52') }, shown.actor), 'DROP_GUARANTEE_SIZE_FULL', 409);
    // A guarantee granted once an entry waits: bound only where the size serves it (52 holds 2 pieces, the guarantee 3).
    const big = await sizedDraw(ring, [{ label: '52', pieces: 2 }, { label: '54', pieces: 6 }], { opensIn: -MINUTE, hours: 2 });
    await drops().enter(late.id, big.id, late.actor, { sizeId: sizeId(big, '52') });
    await ctx.services.guarantees.grant(late.id, { scope: 'RELEASE', targetId: big.id, pieces: 3, validUntil: '2026-12-31', visible: true }, admin);
    expect((await t.db.selectFrom('drop_entries').select('guarantee_id').where('account_id', '=', late.id).where('drop_id', '=', big.id).executeTakeFirstOrThrow()).guarantee_id).toBeNull();
    const fits = await accountOfTier(f, 0);
    await drops().enter(fits.id, big.id, fits.actor, { sizeId: sizeId(big, '54') });
    const g = await ctx.services.guarantees.grant(fits.id, { scope: 'RELEASE', targetId: big.id, pieces: 2, validUntil: '2026-12-31', visible: true }, admin);
    expect((await t.db.selectFrom('drop_entries').select(['guarantee_id', 'pieces']).where('account_id', '=', fits.id).where('drop_id', '=', big.id).executeTakeFirstOrThrow())).toEqual({ guarantee_id: g.guarantee.id, pieces: 2 });
  });

  it('draws a draw without sizes, one published before this lot, exactly as before: one pool, its orders\' size to be entered', async () => {
    const d = await poolDraw(drops(), t.db, { modelId: f.modelId, title: 'ONE POOL OF BEFORE', quantity: 2, opensAt: at(HOUR), closesAt: at(2 * HOUR) }, admin);
    clock.set(at(HOUR + MINUTE));
    const entrants = [await accountOfTier(f, 0), await accountOfTier(f, 1), await accountOfTier(f, 2), await accountOfTier(f, 3)];
    for (const a of entrants) await drops().enter(a.id, d.id, a.actor);
    clock.set(at(2 * HOUR));
    const out = await drops().draw(d.id, admin);
    expect([out.places, out.selected, out.waitlisted, out.sizes]).toEqual([2, 2, 2, []]);
    const sheet = await drops().sheet(d.id);
    expect(sheet.sizes).toEqual([]);
    const listed = (await drops().drawEntries(d.id, { page: 1, pageSize: 10 })).items;
    const recomputed = drawOrder(listed.map((e) => ({ id: e.id, tier: e.tier as 0 | 1 | 2 | 3, seniority: e.seniority })), Uint8Array.from(Buffer.from(sheet.seed!, 'hex')));
    expect(recomputed.map((e) => e.id)).toEqual(listed.map((e) => e.id));
    const statuses = new Map((await t.db.selectFrom('drop_entries').select(['id', 'status']).where('drop_id', '=', d.id).execute()).map((r) => [r.id, r.status]));
    expect(listed.map((e) => statuses.get(e.id))).toEqual(['SELECTED', 'SELECTED', 'WAITLISTED', 'WAITLISTED']);
    expect(listed.every((e) => e.size === null)).toBe(true);
    // OFFER NEXT takes no size; one named is unknown here.
    await rejects(drops().offerNext(d.id, admin, { sizeId: randomUUID() }), 'DROP_SIZE_UNKNOWN', 404);
    const first = await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('rank', '=', 1).executeTakeFirstOrThrow();
    await drops().confirm(d.id, first.id, null, admin);
    expect(await t.db.selectFrom('orders').select(['size_label', 'sku_id']).where('drop_entry_id', '=', first.id).executeTakeFirstOrThrow()).toEqual({ size_label: null, sku_id: null });
  });
});
