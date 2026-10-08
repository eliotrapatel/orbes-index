/**
 * A LIVE RELEASE and the stock (plan LIVE RELEASE+, choices 12, 13 and 16; services/release-stock.ts, live-console.ts,
 * live-insights.ts), with known figures:
 *
 *  - the feasibility check (K5): per size, the pieces on sale against the pieces available at the release's location
 *    (on hand less what orders hold) and the pieces being made for the stock there; the after-room's sizes from what
 *    the release's leave; a warning per size, never a refusal; recorded with the publication;
 *  - the release's location: the default one until the console names another, checked, audited;
 *  - the size mix (L1): the sizes in stock at the location first, then the planner's demand where it exceeds the stock;
 *  - a one-size release sells the SKU of the pieces without a variant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { feasibilityCheck, sizeMix } from '../../src/server/services/release-stock.js';
import { ensureSku, sizeLabelOf } from '../../src/server/services/stock.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, createModel, liveFixtureOn, type LiveFixture } from '../support/live.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function rejects(p: Promise<unknown>, code: string, status?: number): Promise<DomainError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e, String(e)).toBeInstanceOf(DomainError);
  expect((e as DomainError).code).toBe(code);
  if (status !== undefined) expect((e as DomainError).httpStatus).toBe(status);
  return e as DomainError;
}

describe('the arithmetic (pure)', () => {
  const loc = { id: 'L', name: 'FRANCE WAREHOUSE' };

  it('feasibility: the stock, the after-room from what the release leaves; the rest will wait for supplier stock (plan NEXT LOT §3.5)', () => {
    const supply = new Map([
      ['k52', { available: 4 }],
      ['k54', { available: 0 }],
    ]);
    const r = feasibilityCheck({
      location: loc,
      sizes: [
        { sizeId: 's52', label: '52', skuId: 'k52', onSale: 3 },
        { sizeId: 's54', label: '54', skuId: 'k54', onSale: 5 },
        { sizeId: 's56', label: '56', skuId: null, onSale: 1 },
      ],
      afterRoom: [{ sizeId: 'a52', label: '52', skuId: 'k52', onSale: 3 }],
      supply,
    });
    expect(r.sizes).toEqual([
      { sizeId: 's52', label: '52', onSale: 3, available: 4, fromStock: 3, short: 0 },
      { sizeId: 's54', label: '54', onSale: 5, available: 0, fromStock: 0, short: 5 },
      { sizeId: 's56', label: '56', onSale: 1, available: 0, fromStock: 0, short: 1 },
    ]);
    // The after-room's 52 takes the one piece the release's 52 left: two will wait.
    expect(r.afterRoom).toEqual([{ sizeId: 'a52', label: '52', onSale: 3, available: 1, fromStock: 1, short: 2 }]);
    expect(r.short).toBe(8);
    // The owner's sentence: « 52: 12 in stock, 13 will wait for supplier stock. »
    expect(r.warnings).toEqual(['54: 0 in stock, 5 will wait for supplier stock.', '56: 0 in stock, 1 will wait for supplier stock.', 'THE AFTER-ROOM · 52: 1 in stock, 2 will wait for supplier stock.']);
    expect(r.reasoning.join(' ')).not.toMatch(/atelier|to make|made to order/i);
    expect(r.reasoning.at(-1)).toBe('8 pieces of the 12 pieces on sale would wait for supplier stock once sold, the oldest orders first. It does not hold the release back: it can be published as it is.');
    // Everything covered: no warning.
    const covered = feasibilityCheck({ location: loc, sizes: [{ sizeId: 's52', label: '52', skuId: 'k52', onSale: 4 }], afterRoom: null, supply });
    expect(covered).toMatchObject({ short: 0, warnings: [], afterRoom: null });
    expect(covered.reasoning.at(-1)).toBe('Every one of the 4 pieces on sale is in stock.');
  });

  it('size mix: the stock first; the planner’s extra pieces where its demand exceeds the stock, largest remainder', () => {
    const base = { model: { id: 'm', name: 'MONOLITHE' }, location: loc, stock: [{ label: '54', available: 1 }, { label: '52', available: 4 }] };
    // The planner expects 12: 52 3, 54 5, 56 4. The stock holds 5: 7 more, where demand exceeds it (54 by 4, 56 by 4):
    // 3.5 each, the earlier size taking the remainder.
    const r = sizeMix({ ...base, planned: 12, demand: [{ label: '52', pieces: 3 }, { label: '54', pieces: 5 }, { label: '56', pieces: 4 }] });
    expect(r.sizes).toEqual([
      { label: '52', fromStock: 4, fromDemand: 0, stock: 4 },
      { label: '54', fromStock: 1, fromDemand: 4, stock: 5 },
      { label: '56', fromStock: 0, fromDemand: 3, stock: 3 },
    ]);
    expect(r).toMatchObject({ quantity: 12, inStock: 5, planned: 12 });
    expect(r.reasoning.slice(0, 3)).toEqual([
      'In stock at FRANCE WAREHOUSE: 52: 4, 54: 1, offered first.',
      'The planner expects 12 pieces, 7 more than the stock: shared by how far its demand exceeds the stock in each size (54: 4, 56: 4), the largest remainders rounded up; made to order once sold.',
      'Proposed: 52 = 4, 54 = 5, 56 = 3 (12 pieces). You keep the last word.',
    ]);
    // The stock covers the planner: the stock as it is.
    expect(sizeMix({ ...base, planned: 3, demand: [{ label: '56', pieces: 3 }] }).sizes.map((s) => [s.label, s.stock])).toEqual([['52', 4], ['54', 1]]);
    // No planner: the stock as it is.
    const alone = sizeMix({ ...base, planned: null, demand: [] });
    expect(alone.sizes.map((s) => [s.label, s.stock])).toEqual([['52', 4], ['54', 1]]);
    expect(alone.reasoning[1]).toBe('The planner has no basis yet (no past release, no audience to forecast): nothing is added to the stock.');
    // Nothing in stock, no size told apart: nothing proposed.
    const empty = sizeMix({ model: base.model, location: loc, stock: [], planned: 10, demand: [] });
    expect(empty.sizes).toEqual([]);
    expect(empty.reasoning).toContain('Nothing to propose: the sizes stay as you set them.');
    // Labels in their natural order; one too long for a release left out.
    const order = sizeMix({ ...base, stock: [{ label: '104', available: 1 }, { label: '9', available: 1 }, { label: 'TOO LONG LABEL', available: 2 }], planned: null, demand: [] });
    expect(order.sizes.map((s) => s.label)).toEqual(['9', '104']);
    expect(order.reasoning).toContain('Left out, their labels longer than a release\'s 12 characters: TOO LONG LABEL.');
  });

  it('size mix: a size whatever its case is one, named as the stock names it', () => {
    // The stock's SKU says Small; the planner's demand says SMALL and medium: one size Small, its own label kept.
    const r = sizeMix({
      model: { id: 'm', name: 'MONOLITHE' },
      location: loc,
      stock: [{ label: 'Small', available: 2 }],
      planned: 6,
      demand: [{ label: 'SMALL', pieces: 4 }, { label: 'medium', pieces: 2 }],
    });
    expect(r.sizes).toEqual([
      { label: 'medium', fromStock: 0, fromDemand: 2, stock: 2 },
      { label: 'Small', fromStock: 2, fromDemand: 2, stock: 4 },
    ]);
    expect(r.reasoning.slice(0, 3)).toEqual([
      'In stock at FRANCE WAREHOUSE: Small: 2, offered first.',
      'The planner expects 6 pieces, 4 more than the stock: shared by how far its demand exceeds the stock in each size (medium: 2, Small: 2), the largest remainders rounded up; made to order once sold.',
      'Proposed: medium = 2, Small = 4 (6 pieces). You keep the last word.',
    ]);
  });

  it('reads ONE SIZE, whatever its case, as the model in one size', () => {
    expect(sizeLabelOf('ONE SIZE')).toBeNull();
    expect(sizeLabelOf(' one size ')).toBeNull();
    expect(sizeLabelOf('')).toBeNull();
    expect(sizeLabelOf('52')).toBe('52');
  });
});

describe('the release and the stock', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let france: string;
  let logistics: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    const locations = await t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const skuOf = (sizeLabel: string | null, modelId = f.modelId) => inTransaction(t.db, (tx) => ensureSku(tx, modelId, sizeLabel));
  const receive = (skuId: string, locationId: string, n: number) => ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Pieces counted at the atelier.' }, f.admin);
  const settings = (o: Record<string, unknown> = {}) => ({
    modelId: f.modelId,
    title: 'STOCK',
    opensAt: new Date('2026-11-03T18:00:00Z'),
    closesAt: new Date('2026-11-03T19:00:00Z'),
    priceMinor: 480_000,
    sizes: [{ label: '52', stock: 6 }, { label: '54', stock: 4 }, { label: '56', stock: 2 }],
    ...o,
  });

  it('proposes the sizes in stock at a location, then checks a release against its location’s stock, warning only', async () => {
    const [k52, k54] = [await skuOf('52'), await skuOf('54')];
    await receive(k52, france, 5);
    await receive(k54, france, 1);
    await receive(k52, logistics, 10);
    await receive(k54, logistics, 3);
    // Two pieces of 54 being made for the stock at FRANCE WAREHOUSE (not on hand: never in the mix, nor in the check).
    await ctx.services.atelier.makeForStock({ skuId: k54, locationId: france, quantity: 2 }, f.admin);

    // The size mix: no past release, the planner has no basis; the stock at each location as it is.
    const mix = await ctx.services.liveInsights.sizeMix(f.modelId, null);
    expect(mix).toMatchObject({ location: { id: france, name: 'FRANCE WAREHOUSE' }, inStock: 6, planned: null, quantity: 6 });
    expect(mix.sizes.map((s) => [s.label, s.stock])).toEqual([['52', 5], ['54', 1]]);
    const there = await ctx.services.liveInsights.sizeMix(f.modelId, logistics);
    expect(there.sizes.map((s) => [s.label, s.stock])).toEqual([['52', 10], ['54', 3]]);
    await rejects(ctx.services.liveInsights.sizeMix('00000000-0000-4000-8000-000000000009', null), 'MODEL_NOT_FOUND', 404);
    await rejects(ctx.services.liveInsights.sizeMix(f.modelId, '00000000-0000-4000-8000-000000000009'), 'STOCK_LOCATION_NOT_FOUND', 404);

    // A sale of an earlier release holds one piece of 52 at FRANCE WAREHOUSE: 4 available there now.
    const earlier = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + HOUR), sizes: [{ label: '52', stock: 1 }] });
    const buyer = await accountOfTier(f, 0);
    clock.set(new Date(clock.now().getTime() + HOUR - MINUTE));
    await f.live.enter(buyer.id, earlier.id, { sizeId: earlier.sizes[0]!.id }, buyer.actor);
    clock.advance(MINUTE);
    await f.live.advance(earlier.id);
    const token = (await f.live.entry(buyer.id, earlier.id))!.turn!.token!;
    await f.live.press(buyer.id, earlier.id, token);
    clock.advance(1500);
    await f.live.secure(buyer.id, earlier.id, token, buyer.actor);
    await f.live.confirm(buyer.id, earlier.id, buyer.actor);
    expect(await t.db.selectFrom('orders').select(['reservation', 'location_id']).where('drop_id', '=', earlier.id).execute()).toEqual([{ reservation: 'STOCK', location_id: france }]);

    // The release: 52 × 6, 54 × 4, 56 × 2, at the default location; its after-room 52 × 1, 54 × 1 of the same model.
    clock.set('2026-11-01T12:00:00Z');
    const r = await ctx.services.liveConsole.create(settings({ afterRoom: { modelId: f.modelId, priceMinor: 300_000, sizes: [{ label: '52', stock: 1 }, { label: '54', stock: 1 }] } }), f.admin);
    expect(r).toMatchObject({ locationId: null, location: { id: france, name: 'FRANCE WAREHOUSE' } });
    const here = await ctx.services.liveConsole.feasibility(r.id);
    expect(here.location).toEqual({ id: france, name: 'FRANCE WAREHOUSE' });
    expect(here.sizes.map((l) => [l.label, l.onSale, l.available, l.fromStock, l.short])).toEqual([
      ['52', 6, 4, 4, 2],
      ['54', 4, 1, 1, 3],
      ['56', 2, 0, 0, 2],
    ]);
    expect(here.afterRoom!.map((l) => [l.label, l.onSale, l.available, l.short])).toEqual([
      ['52', 1, 0, 1],
      ['54', 1, 0, 1],
    ]);
    expect(here.short).toBe(9);
    expect(here.warnings[0]).toBe('52: 4 in stock, 2 will wait for supplier stock.');

    // At LOGISTICS WAREHOUSE: 52 covered by its 10, 54 by 3 of its 3, the after-room's 52 by what is left.
    const moved = await ctx.services.liveConsole.update(r.id, { stockLocationId: logistics }, f.admin);
    expect(moved).toMatchObject({ locationId: logistics, location: { id: logistics, name: 'LOGISTICS WAREHOUSE' } });
    const update = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.update').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(update.details).toEqual({ before: { stockLocationId: null }, after: { stockLocationId: logistics } });
    await rejects(ctx.services.liveConsole.update(r.id, { stockLocationId: '00000000-0000-4000-8000-000000000009' }, f.admin), 'STOCK_LOCATION_NOT_FOUND', 404);
    const there2 = await ctx.services.liveConsole.feasibility(r.id);
    expect([...there2.sizes, ...there2.afterRoom!].map((l) => [l.label, l.short])).toEqual([
      ['52', 0],
      ['54', 1],
      ['56', 2],
      ['52', 0],
      ['54', 1],
    ]);
    expect(there2.short).toBe(4);
    await rejects(ctx.services.liveConsole.feasibility(r.afterRoom!.id), 'LIVE_AFTER_ROOM', 409);

    // Published all the same: the check recorded with the publication.
    const published = await ctx.services.liveConsole.publish(r.id, {}, f.admin);
    expect(published.publishedAt).not.toBeNull();
    const publish = await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', r.id).where('action', '=', 'drop.live.publish').executeTakeFirstOrThrow();
    expect(publish.details).toMatchObject({ locationId: logistics, waitForStock: 4, shortSizes: ['54:1', '56:2', 'AFTER-ROOM 54:1'] });
    expect(publish.details).not.toHaveProperty('toMakeToOrder');
  });

  it('finds a model’s SKU in a size whatever the case the size is typed in', async () => {
    const vest = await createModel(t.db, 'VEST', null, 'VEST');
    const small = await skuOf('Small', vest);
    expect(await skuOf('SMALL', vest)).toBe(small);
    expect(await skuOf(' small ', vest)).toBe(small);
    expect(await t.db.selectFrom('skus').select('size_label').where('model_id', '=', vest).execute()).toEqual([{ size_label: 'Small' }]);
    // A release in SMALL sells that SKU: the mix names it Small, the release's size draws on its stock.
    await receive(small, france, 2);
    const mix = await ctx.services.liveInsights.sizeMix(vest, france);
    expect(mix.sizes.map((s) => [s.label, s.fromStock])).toEqual([['Small', 2]]);
    clock.set('2026-11-01T12:00:00Z');
    const r = await ctx.services.liveConsole.create(settings({ modelId: vest, sizes: [{ label: 'SMALL', stock: 2 }] }), f.admin);
    expect((await t.db.selectFrom('drop_sizes').select('sku_id').where('drop_id', '=', r.id).executeTakeFirstOrThrow()).sku_id).toBe(small);
    expect((await ctx.services.liveConsole.feasibility(r.id)).sizes.map((l) => [l.label, l.available, l.short])).toEqual([['SMALL', 2, 0]]);
  });

  it('sells a one-size model’s pieces without a variant under ONE SIZE', async () => {
    const pendant = await createModel(t.db, 'PENDANT', null, 'PENDANT');
    const one = await skuOf(null, pendant);
    await receive(one, france, 2);
    const mix = await ctx.services.liveInsights.sizeMix(pendant, france);
    // Its two pieces without a variant, offered as ONE SIZE (the planner, now with a past release, may add to them).
    expect(mix.sizes.map((s) => [s.label, s.fromStock])).toEqual([['ONE SIZE', 2]]);
    clock.set('2026-11-01T12:00:00Z');
    const r = await ctx.services.liveConsole.create(settings({ modelId: pendant, sizes: [{ label: 'ONE SIZE', stock: 3 }] }), f.admin);
    const check = await ctx.services.liveConsole.feasibility(r.id);
    expect(check.sizes.map((l) => [l.label, l.available, l.short])).toEqual([['ONE SIZE', 2, 1]]);
    expect((await t.db.selectFrom('drop_sizes').select('sku_id').where('drop_id', '=', r.id).executeTakeFirstOrThrow()).sku_id).toBe(one);
  });
});
