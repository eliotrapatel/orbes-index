/**
 * The atelier (plan LIVE RELEASE+ of 2026-10-04, step S2: choices 8, 14 and 15, The console → Atelier), on the services
 * as createContext wires them:
 *
 *  - the stock per SKU and location (on hand, reserved, available), the pieces made for the stock, each minimum and what
 *    it suggests (enough to reach it), confirmed into pieces to make whose ORBES identities are reserved at once (L6);
 *  - the pieces to make per release (the private salon's and the stock's apart), model and size; the CSV of what to make;
 *  - TO MAKE → IN PROGRESS → DONE, exactly; a piece for the stock cancelled (its identity retired, its sheet's code
 *    revoked), an order's never (the order is);
 *  - the work sheets: the reference and the ORBES code of the reserved identity, signed for the sheet, which /verify
 *    still answers as unknown; issuing the piece confirms that identity: the same code then verifies;
 *  - DONE issues the piece: ISSUED with its material and claim code, in the ledger (PRODUCED), linked to its order (the
 *    order then holds it in stock and ships), each change journaled and audited; a piece picked from the stock for an
 *    order holding one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { BENCH_TRANSITIONS, suggestedPieces, WORK_SHEETS_MAX } from '../../src/server/services/atelier.js';
import { verifyClaimCode } from '../../src/server/services/claim-codes.js';
import { RESERVED_MATERIAL_PENDING } from '../../src/server/services/issuance.js';
import { ensureSku, stockLevel } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
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

describe('the atelier (plan LIVE RELEASE+, S2)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let france: string;
  let logistics: string;
  let colissimo: string;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-01T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    const locations = await t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const atelier = () => ctx.services.atelier;
  const skuOf = (sizeLabel: string | null, modelId = f.modelId) => inTransaction(t.db, (tx) => ensureSku(tx, modelId, sizeLabel));
  const receive = (skuId: string, locationId: string, n: number) => ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Pieces counted at the atelier.' }, admin);
  const productRow = (id: string) => t.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const benchRow = (id: string) => t.db.selectFrom('bench_items').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const journalOf = (entityId: string) => t.db.selectFrom('event_journal').select(['type', 'payload']).where('entity_id', '=', entityId).orderBy('id').execute();
  const auditsOf = (targetId: string, action?: string) =>
    t.db
      .selectFrom('audit_logs')
      .select(['action', 'details'])
      .where('target_id', '=', targetId)
      .$if(action !== undefined, (q) => q.where('action', '=', action!))
      .orderBy('id')
      .execute();

  /** A request of the private salon closed as ACCEPTED, its size entered: its order. */
  async function salonOrder(size: string | null, modelId = f.modelId) {
    const accountId = (await createAccount(t.db)).id;
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(1000);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = await t.db.selectFrom('orders').selectAll().where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    await ctx.services.orders.setTerms(order.id, { sizeLabel: size, priceMinor: 480_000, currency: 'EUR' }, admin);
    return orderRow(order.id);
  }

  /** A LIVE sale confirmed (PAY): its release and its one order. */
  async function liveSale(label: string, addons?: { label: string; priceMinor: number }[]) {
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label, stock: 3 }], addons });
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity: 1 }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    if (r.addons.length) await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const order = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).executeTakeFirstOrThrow();
    return { release: r, account: a, order };
  }

  const benchOfOrder = (orderId: string) => t.db.selectFrom('bench_items').selectAll().where('order_id', '=', orderId).orderBy('created_at').executeTakeFirstOrThrow();

  describe('the stock, its minimums and their suggestions (L2)', () => {
    it('suggests enough pieces to reach the minimum: minimum − available − already being made, never below 0', () => {
      expect(suggestedPieces(null, 0, 0)).toBe(0);
      expect(suggestedPieces(5, 2, 1)).toBe(2);
      expect(suggestedPieces(3, 4, 0)).toBe(0);
      expect(suggestedPieces(2, -1, 0)).toBe(3);
    });

    it('reads every SKU at every location it concerns, sets and removes a minimum (audited stock.threshold), and confirms a suggestion into pieces to make for the stock, each identity reserved', async () => {
      const model = await createModel(t.db, 'HALO');
      const s52 = await skuOf('52', model);
      const s54 = await skuOf('54', model);
      await receive(s52, france, 3);
      // A reservation of one of them: on hand 3, reserved 1, available 2.
      const held = await salonOrder('52', model);
      expect(held.reservation).toBe('STOCK');
      await atelier().setThreshold({ skuId: s52, locationId: france, minimum: 5 }, admin);
      await atelier().setThreshold({ skuId: s54, locationId: logistics, minimum: 2 }, admin);
      const before = await atelier().stock({ modelId: model });
      // Every offered size at every location, 0 included (plan NEXT LOT §3.3, step 3.5).
      expect(before.rows.map((r) => [r.sku.sizeLabel, r.location.name, r.onHand, r.reserved, r.available, r.toMake, r.minimum, r.suggestion])).toEqual([
        ['52', 'FRANCE WAREHOUSE', 3, 1, 2, 0, 5, 3],
        ['52', 'LOGISTICS WAREHOUSE', 0, 0, 0, 0, null, 0],
        ['54', 'FRANCE WAREHOUSE', 0, 0, 0, 0, null, 0],
        ['54', 'LOGISTICS WAREHOUSE', 0, 0, 0, 0, 2, 2],
      ]);
      expect(before.skus.filter((k) => k.model.id === model).map((k) => k.sizeLabel)).toEqual(['52', '54']);
      expect(before.locations.map((l) => [l.name, l.isDefault])).toEqual([
        ['FRANCE WAREHOUSE', true],
        ['LOGISTICS WAREHOUSE', false],
      ]);
      expect((await auditsOf(s52, 'stock.threshold'))[0]!.details).toEqual({ locationId: france, from: null, to: 5 });
      await rejects(atelier().setThreshold({ skuId: s52, locationId: france, minimum: 5 }, admin), 'VALIDATION_FAILED', 400);
      await rejects(atelier().setThreshold({ skuId: s52, locationId: france, minimum: 0 }, admin), 'VALIDATION_FAILED', 400);

      // Confirmed with 2 of the 3 suggested: two pieces to make for the stock, the suggestion now 1.
      clock.advance(MINUTE);
      const made = await atelier().makeForStock({ skuId: s52, locationId: france, quantity: 2 }, admin);
      expect(made.map((b) => [b.status, b.order, b.origin, b.location.name, b.sku.sizeLabel, b.piece.status, b.piece.signed])).toEqual([
        ['TO_MAKE', null, { kind: 'STOCK' }, 'FRANCE WAREHOUSE', '52', 'RESERVED', false],
        ['TO_MAKE', null, { kind: 'STOCK' }, 'FRANCE WAREHOUSE', '52', 'RESERVED', false],
      ]);
      for (const b of made) {
        expect((await journalOf(b.id)).map((j) => j.type)).toEqual(['bench.create']);
        expect((await auditsOf(b.id, 'bench.create'))[0]!.details).toMatchObject({ orderId: null, skuId: s52, locationId: france, productId: b.piece.reference });
        expect(await t.db.selectFrom('codes').select('id').where('product_id', '=', b.piece.id).execute()).toEqual([]);
      }
      const after = await atelier().stock({ modelId: model, locationId: france });
      expect(after.rows.map((r) => [r.sku.sizeLabel, r.toMake, r.suggestion])).toEqual([
        ['52', 2, 1],
        ['54', 0, 0],
      ]);
      await rejects(atelier().makeForStock({ skuId: s52, locationId: france, quantity: 51 }, admin), 'VALIDATION_FAILED', 400);
      await rejects(atelier().makeForStock({ skuId: s52, locationId: '00000000-0000-4000-8000-000000000000', quantity: 1 }, admin), 'STOCK_LOCATION_NOT_FOUND', 404);

      // Removed: the row stays, an offered size at 0, without a minimum.
      await atelier().setThreshold({ skuId: s54, locationId: logistics, minimum: null }, admin);
      expect((await atelier().stock({ modelId: model, locationId: logistics })).rows.map((r) => [r.sku.sizeLabel, r.minimum])).toEqual([
        ['52', null],
        ['54', null],
      ]);
      expect((await auditsOf(s54, 'stock.threshold')).at(-1)!.details).toEqual({ locationId: logistics, from: 2, to: null });
    });
  });

  describe('declared sizes in the stock (plan NEXT LOT §3.3, step 3.5)', () => {
    const setAside = (modelId: string, skuId: string) => ctx.services.sizes.removeSize(modelId, skuId, admin);
    const rowsOf = async (modelId: string) =>
      (await atelier().stock({ modelId })).rows.map((r) => [r.sku.sizeLabel, r.location.name, r.onHand, r.reserved, r.minimum, r.suggestion, r.sku.setAside]);

    it('lists every offered size of an active model at every location at 0, and offers only those sizes in its choices', async () => {
      const model = await createModel(t.db, 'ARC');
      await ctx.services.sizes.declare(model, { sizeType: 'RING', ticked: ['50', '52'] }, admin);
      expect(await rowsOf(model)).toEqual([
        ['50', 'FRANCE WAREHOUSE', 0, 0, null, 0, false],
        ['50', 'LOGISTICS WAREHOUSE', 0, 0, null, 0, false],
        ['52', 'FRANCE WAREHOUSE', 0, 0, null, 0, false],
        ['52', 'LOGISTICS WAREHOUSE', 0, 0, null, 0, false],
      ]);
      // A model with no type: its sizes, as they are, at 0 too.
      const typeless = await createModel(t.db, 'BAND');
      await skuOf('7', typeless);
      expect(await rowsOf(typeless)).toEqual([
        ['7', 'FRANCE WAREHOUSE', 0, 0, null, 0, false],
        ['7', 'LOGISTICS WAREHOUSE', 0, 0, null, 0, false],
      ]);
    });

    it('keeps a set-aside size only where something remains, marked setAside; it takes no new minimum nor piece to make, and its minimum suggests nothing', async () => {
      const model = await createModel(t.db, 'CREST');
      await ctx.services.sizes.declare(model, { sizeType: 'RING', ticked: ['50', '52', '54'] }, admin);
      const [s50, s52, s54] = (await t.db.selectFrom('skus').select(['id', 'size_label']).where('model_id', '=', model).execute())
        .sort((a, b) => a.size_label!.localeCompare(b.size_label!))
        .map((k) => k.id);
      // 52: two pieces at FRANCE and a minimum of 4 at LOGISTICS, then set aside.
      await receive(s52!, france, 2);
      await atelier().setThreshold({ skuId: s52!, locationId: logistics, minimum: 4 }, admin);
      // 54: counted in and out again (its movements sum to 0), with nothing else, then set aside.
      await receive(s54!, france, 1);
      await ctx.services.stock.adjust({ skuId: s54!, locationId: france, delta: -1, note: 'Counted again.' }, admin);
      expect((await setAside(model, s52!)).outcome).toBe('SET_ASIDE');
      expect((await setAside(model, s54!)).outcome).toBe('SET_ASIDE');
      expect(await rowsOf(model)).toEqual([
        ['50', 'FRANCE WAREHOUSE', 0, 0, null, 0, false],
        ['50', 'LOGISTICS WAREHOUSE', 0, 0, null, 0, false],
        ['52', 'FRANCE WAREHOUSE', 2, 0, null, 0, true],
        // Its minimum stays shown, and no longer suggests anything.
        ['52', 'LOGISTICS WAREHOUSE', 0, 0, 4, 0, true],
      ]);
      const stock = await atelier().stock({ modelId: model });
      expect(stock.skus.filter((k) => k.model.id === model).map((k) => [k.sizeLabel, k.setAside])).toEqual([['50', false]]);

      const refused = await rejects(atelier().setThreshold({ skuId: s52!, locationId: france, minimum: 2 }, admin), 'SIZE_SET_ASIDE', 409);
      expect(refused.message).toBe('Size 52 of CREST is set aside. Reinstate it on the model’s page to offer it again.');
      await rejects(atelier().makeForStock({ skuId: s52!, locationId: france, quantity: 1 }, admin), 'SIZE_SET_ASIDE', 409);
      expect(await t.db.selectFrom('bench_items').select('id').where('sku_id', '=', s52!).execute()).toEqual([]);
      // Its minimum is still removed; the row then goes where nothing else remains.
      await atelier().setThreshold({ skuId: s52!, locationId: logistics, minimum: null }, admin);
      expect((await rowsOf(model)).filter((r) => r[0] === '52')).toEqual([['52', 'FRANCE WAREHOUSE', 2, 0, null, 0, true]]);
      // Still corrected and transferred from its own row.
      await ctx.services.stock.transfer({ skuId: s52!, fromLocationId: france, toLocationId: logistics, quantity: 1 }, admin);
      expect((await rowsOf(model)).filter((r) => r[0] === '52')).toEqual([
        ['52', 'FRANCE WAREHOUSE', 1, 0, null, 0, true],
        ['52', 'LOGISTICS WAREHOUSE', 1, 0, null, 0, true],
      ]);
      // Reinstated: offered again, at every location, and a minimum taken again.
      await ctx.services.sizes.reinstateSize(model, s54!, admin);
      expect((await rowsOf(model)).filter((r) => r[0] === '54').map((r) => [r[1], r[2], r[6]])).toEqual([
        ['FRANCE WAREHOUSE', 0, false],
        ['LOGISTICS WAREHOUSE', 0, false],
      ]);
      await atelier().setThreshold({ skuId: s54!, locationId: france, minimum: 1 }, admin);
      expect(s50).toBeDefined();
    });

    it('lists an inactive model\'s sizes only where something remains', async () => {
      const model = await createModel(t.db, 'DUSK');
      const s50 = await skuOf('50', model);
      await skuOf('52', model);
      await receive(s50, logistics, 1);
      await t.db.updateTable('models').set({ active: false }).where('id', '=', model).execute();
      expect(await rowsOf(model)).toEqual([['50', 'LOGISTICS WAREHOUSE', 1, 0, null, 0, false]]);
    });
  });

  describe('the pieces to make', () => {
    it('lists the pieces to make for the stock by model and size, with their counts; an order creates none any more (plan NEXT LOT §3.5: it waits for supplier stock); the CSV says what to make', async () => {
      const model = await createModel(t.db, 'ORBIT');
      const first = await liveSale('48');
      clock.advance(HOUR);
      const second = await liveSale('50', [{ label: 'ENGRAVING', priceMinor: 15_000 }]);
      await ctx.services.orders.setTerms(second.order.id, { engravingText: 'A. & L.' }, admin);
      const salon = await salonOrder('56', model);
      expect([first.order.reservation, second.order.reservation, salon.reservation]).toEqual(['AWAITING', 'AWAITING', 'AWAITING']);
      for (const o of [first.order, second.order, salon]) expect(await t.db.selectFrom('bench_items').select('id').where('order_id', '=', o.id).execute(), o.id).toEqual([]);
      const stockSku = await skuOf('58', model);
      await atelier().makeForStock({ skuId: stockSku, locationId: logistics, quantity: 1 }, admin);
      const list = await atelier().bench({});
      const mine = list.groups.filter((g) => (g.origin.kind === 'RELEASE' ? [first.release.id, second.release.id].includes(g.origin.release.id) : g.sku.model.id === model));
      expect(mine.map((g) => [g.origin.kind === 'RELEASE' ? g.origin.release.id : g.origin.kind, g.sku.sizeLabel, g.counts.TO_MAKE, g.items.length])).toEqual([['STOCK', '58', 1, 1]]);
      expect(list.releases.map((r) => r.id)).not.toContain(first.release.id);
      // Narrowed: one release, the salon's (none), the stock's, one SKU.
      expect((await atelier().bench({ origin: first.release.id })).groups).toEqual([]);
      expect((await atelier().bench({ origin: 'SALON', skuId: salon.sku_id! })).groups).toEqual([]);
      expect((await atelier().bench({ origin: 'STOCK', skuId: stockSku })).groups.map((g) => g.items[0]!.location.name)).toEqual(['LOGISTICS WAREHOUSE']);
      expect((await atelier().bench({ view: 'DONE', origin: 'STOCK', skuId: stockSku })).groups).toEqual([]);

      const csv = await atelier().benchCsv({ origin: 'STOCK', skuId: stockSku });
      expect(csv.filename).toMatch(/^ORBES-atelier-\d{4}-\d{2}-\d{2}\.csv$/);
      const lines = csv.body.trim().split('\r\n');
      expect(lines[0]).toBe('"for","model","size","sku","location","piece","status","order","channel","add-ons","engraving","surprise","created at","started at","done at"');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('"58"');
      expect(lines[1]!.startsWith('"FOR STOCK"')).toBe(true);
      expect((await atelier().benchCsv({ origin: second.release.id })).body.trim().split('\r\n')).toHaveLength(1);
    });

    it('moves exactly TO MAKE → IN PROGRESS → DONE; a piece for the stock is cancelled (its identity retired, its sheet\'s code revoked), an order\'s never', async () => {
      expect(BENCH_TRANSITIONS).toEqual({ TO_MAKE: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['DONE', 'CANCELLED'], DONE: [], CANCELLED: [] });
      const sku = await skuOf('60');
      const [a, b] = await atelier().makeForStock({ skuId: sku, locationId: france, quantity: 2 }, admin);
      await rejects(atelier().done(a!.id, { material: '925 STERLING SILVER' }, admin), 'BENCH_STEP_NOT_ALLOWED', 409);
      clock.advance(MINUTE);
      const started = await atelier().start(a!.id, admin);
      expect([started.status, started.startedAt]).toEqual(['IN_PROGRESS', clock.now()]);
      await rejects(atelier().start(a!.id, admin), 'BENCH_STEP_NOT_ALLOWED', 409);
      expect((await journalOf(a!.id)).map((j) => j.type)).toEqual(['bench.create', 'bench.start']);
      expect((await auditsOf(a!.id, 'bench.start')).length).toBe(1);

      // The second one's sheet printed, then the piece cancelled: retired, its code revoked.
      const [sheet] = await atelier().sheets({ benchItemIds: [b!.id] }, admin);
      clock.advance(MINUTE);
      const cancelled = await atelier().cancel(b!.id, admin);
      expect([cancelled.status, cancelled.piece.status]).toEqual(['CANCELLED', 'RETIRED']);
      const code = await t.db.selectFrom('codes').selectAll().where('id', '=', sheet!.code.codeId).executeTakeFirstOrThrow();
      expect([code.status, code.revocation_reason]).toEqual(['REVOKED', 'Reserved identity retired: its piece to make was cancelled']);
      expect(await t.db.selectFrom('revocations').select(['target_type', 'reason_code']).where('target_id', '=', code.id).execute()).toEqual([{ target_type: 'CODE', reason_code: 'CODE_REVOKED' }]);
      expect((await ctx.services.verification.verify({ code: sheet!.code.data }, {})).state).not.toBe('AUTHENTIC');
      expect((await journalOf(b!.id)).map((j) => j.type)).toEqual(['bench.create', 'bench.cancel']);
      expect((await auditsOf(b!.id, 'bench.cancel'))[0]!.details).toMatchObject({ retired: true });
      await rejects(atelier().cancel(b!.id, admin), 'BENCH_STEP_NOT_ALLOWED', 409);
      await rejects(atelier().start(b!.id, admin), 'BENCH_STEP_NOT_ALLOWED', 409);

      // An order no longer gets a piece to make (plan NEXT LOT §3.5): it waits for supplier stock.
      const o = await salonOrder('61');
      expect(o.reservation).toBe('AWAITING');
      expect(await t.db.selectFrom('bench_items').select('id').where('order_id', '=', o.id).execute()).toEqual([]);
      await rejects(atelier().start('00000000-0000-4000-8000-000000000000', admin), 'BENCH_ITEM_NOT_FOUND', 404);
      await rejects(atelier().start(a!.id, { type: 'account', id: o.account_id }), 'FORBIDDEN', 403);
    });
  });

  describe('the work sheets and the piece issued (L6)', () => {
    it('signs the reserved identity\'s code for its sheet (/verify answers it as unknown), and issuing the piece confirms that identity: the same code verifies, the piece in stock', async () => {
      const sku = await skuOf('62');
      const [item] = await atelier().makeForStock({ skuId: sku, locationId: logistics, quantity: 1 }, admin);
      const [sheet] = await atelier().sheets({ origin: 'STOCK', skuId: sku }, admin);
      expect(sheet).toMatchObject({ benchItemId: item!.id, reference: item!.piece.reference, sizeLabel: '62', model: 'MONOLITHE', order: null, release: null, location: 'LOGISTICS WAREHOUSE', addons: [] });
      expect(sheet!.code.data).toMatch(/^[A-Za-z0-9_-]{100,}$/);
      expect(sheet!.code.glyphs.length).toBeGreaterThan(0);
      const product = await productRow(item!.piece.id);
      expect(product.status).toBe('RESERVED');
      expect(await t.db.selectFrom('product_status_history').select('id').where('product_id', '=', product.id).execute()).toEqual([]);
      expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'code.sign').where('target_id', '=', product.product_id).executeTakeFirstOrThrow()).details).toMatchObject({ reserved: true, issue: 1 });
      const sheetAudit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'bench.sheet').orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(sheetAudit.details).toEqual({ benchItemIds: [item!.id], productIds: [product.product_id], signed: 1 });
      const unknown = await ctx.services.verification.verify({ code: sheet!.code.data }, {});
      expect(unknown.state).toBe('UNKNOWN');
      expect(unknown.product).toBeUndefined();
      // A second print signs nothing new: the same code.
      const [again] = await atelier().sheets({ benchItemIds: [item!.id] }, admin);
      expect(again!.code).toEqual(sheet!.code);
      expect(await t.db.selectFrom('codes').select('id').where('product_id', '=', product.id).execute()).toHaveLength(1);

      // The material is still to be confirmed (the model names none): DONE asks for it.
      expect(product.material).toBe(RESERVED_MATERIAL_PENDING);
      await atelier().start(item!.id, admin);
      await rejects(atelier().done(item!.id, {}, admin), 'VALIDATION_FAILED', 400);
      await rejects(atelier().done(item!.id, { material: '925 STERLING SILVER', productionDate: '2099-01-01' }, admin), 'VALIDATION_FAILED', 400);
      clock.advance(MINUTE);
      const before = await stockLevel(t.db, sku, logistics);
      const issued = await atelier().done(item!.id, { material: '925 STERLING SILVER', productionBatch: 'B-11', productionDate: '2026-11-01' }, admin);
      expect(issued).toMatchObject({ productId: product.product_id, codeId: sheet!.code.codeId, item: { status: 'DONE', doneAt: clock.now(), piece: { status: 'ISSUED', signed: true } } });
      expect(issued.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      const done = await productRow(product.id);
      expect([done.status, done.material, done.production_batch, done.ownership_state]).toEqual(['ISSUED', '925 STERLING SILVER', 'B-11', 'UNREGISTERED']);
      expect(await verifyClaimCode(issued.claimCode!, done.claim_secret_hash!)).toBe(true);
      expect(await t.db.selectFrom('product_status_history').select(['from_status', 'to_status', 'reason']).where('product_id', '=', product.id).execute()).toEqual([{ from_status: null, to_status: 'ISSUED', reason: 'Product issued' }]);
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: before.onHand + 1, reserved: before.reserved, available: before.available + 1 });
      expect(await t.db.selectFrom('stock_movements').select(['reason', 'delta', 'order_id', 'location_id']).where('product_id', '=', product.id).execute()).toEqual([
        { reason: 'PRODUCED', delta: 1, order_id: null, location_id: logistics },
      ]);
      expect((await journalOf(product.id)).map((j) => [j.type, j.payload.status])).toEqual([
        ['product.reserve', 'RESERVED'],
        ['product.issue', 'ISSUED'],
      ]);
      expect((await journalOf(item!.id)).map((j) => j.type)).toEqual(['bench.create', 'bench.start', 'bench.done']);
      expect((await auditsOf(product.product_id, 'product.issue'))[0]!.details).toMatchObject({ productId: product.product_id, codeId: sheet!.code.codeId, reserved: true, benchItemId: item!.id, orderId: null, claimSecret: true });
      // The code of the sheet now verifies as the piece.
      expect((await ctx.services.verification.verify({ code: sheet!.code.data }, {})).state).toBe('AUTHENTIC');
      await rejects(atelier().done(item!.id, { material: '925 STERLING SILVER' }, admin), 'BENCH_STEP_NOT_ALLOWED', 409);
      await rejects(atelier().sheets({ benchItemIds: [item!.id] }, admin), 'BENCH_NOT_OPEN', 409);
      await rejects(atelier().sheets({ benchItemIds: [] }, admin), 'VALIDATION_FAILED', 400);
      await rejects(atelier().sheets({ benchItemIds: Array.from({ length: WORK_SHEETS_MAX + 1 }, () => item!.id) }, admin), 'VALIDATION_FAILED', 400);
    });

    it('a piece finished for the stock enters it and serves the order waiting for it there; linked from the stock, the order holds it and ships it', async () => {
      const sale = await liveSale('64', [{ label: 'GIFT BOX', priceMinor: 0 }]);
      expect(sale.order.reservation).toBe('AWAITING');
      await ctx.services.orders.transition(sale.order.id, { to: 'PAID' }, admin);
      // Not ready to ship while it waits for supplier stock.
      await rejects(ctx.services.orders.transition(sale.order.id, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, admin), 'ORDER_NOT_READY', 409);
      const [item] = await atelier().makeForStock({ skuId: sale.order.sku_id!, locationId: sale.order.location_id, quantity: 1 }, admin);
      await atelier().start(item!.id, admin);
      clock.advance(MINUTE);
      const issued = await atelier().done(item!.id, { material: '925 STERLING SILVER', withClaimSecret: false }, admin);
      expect(issued.claimCode).toBeUndefined();
      const p = await productRow(item!.piece.id);
      expect([p.status, p.claim_secret_hash, p.stock_entered_at]).toEqual(['ISSUED', null, clock.now()]);
      // It entered the stock and served the order waiting there, by the system; the piece itself is bound later.
      let o = await orderRow(sale.order.id);
      expect([o.product_id, o.reservation, o.status]).toEqual([null, 'STOCK', 'PAID']);
      const served = await t.db.selectFrom('order_events').select(['action', 'status', 'actor_type', 'details']).where('order_id', '=', o.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(served).toMatchObject({ action: 'order.serve', status: 'PAID', actor_type: 'system', details: { reservation: 'STOCK' } });
      expect(await t.db.selectFrom('stock_movements').select(['reason', 'order_id']).where('product_id', '=', p.id).execute()).toEqual([{ reason: 'PRODUCED', order_id: null }]);
      clock.advance(MINUTE);
      await atelier().linkFromStock(o.id, p.product_id, admin);
      o = await orderRow(sale.order.id);
      expect([o.product_id, o.reservation]).toEqual([p.id, 'STOCK']);
      expect((await auditsOf(o.id, 'order.link'))[0]!.details).toMatchObject({ from: 'PAID', to: 'PAID', productId: p.id, via: 'stock' });
      expect(await stockLevel(t.db, o.sku_id!, o.location_id)).toMatchObject({ reserved: 1 });
      expect((await ctx.services.orders.get(o.id)).productId).toBe(p.product_id);
      // Shipped now: the piece leaves the ledger.
      clock.advance(MINUTE);
      await ctx.services.orders.transition(o.id, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
      expect(await t.db.selectFrom('stock_movements').select(['reason', 'delta']).where('order_id', '=', o.id).orderBy('id').execute()).toEqual([{ reason: 'SHIPPED', delta: -1 }]);
      // A location changed once the piece is linked: refused, the piece is transferred instead.
      const other = await liveSale('66');
      const piece = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '66', material: '925 STERLING SILVER' }, admin);
      await atelier().linkFromStock(other.order.id, piece.product.productId, admin);
      await rejects(ctx.services.orders.changeLocation(other.order.id, logistics, admin), 'ORDER_PIECE_LINKED', 409);
      // An order cancelled after its piece was linked: the piece stays in stock, free.
      clock.advance(MINUTE);
      await ctx.services.orders.transition(other.order.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
      const freed = await orderRow(other.order.id);
      expect(await stockLevel(t.db, freed.sku_id!, freed.location_id)).toMatchObject({ onHand: 1, reserved: 0, available: 1 });
      expect((await productRow(piece.product.id)).status).toBe('ISSUED');
    });
  });

  describe('a piece picked from the stock (Interconnection)', () => {
    it('links an issued piece of the order\'s SKU, never registered nor taken, to an order holding one in stock', async () => {
      const model = await createModel(t.db, 'ARC');
      const sku = await skuOf('70', model);
      const otherSku = await skuOf('72', model);
      // Two pieces made in advance (the generator), counted in stock at FRANCE.
      const issue = (variant: string) => ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: model, variant, material: '925 STERLING SILVER' }, admin);
      const a = await issue('70');
      const b = await issue('70');
      const c = await issue('72');
      await receive(sku, france, 2);
      await receive(otherSku, france, 1);
      const o = await salonOrder('70', model);
      expect(o.reservation).toBe('STOCK');
      await rejects(atelier().linkFromStock(o.id, c.product.productId, admin), 'PIECE_OTHER_SKU', 409);
      await rejects(atelier().linkFromStock(o.id, 'O26-J-99999', admin), 'PRODUCT_NOT_FOUND', 404);
      // A piece registered by someone is no piece in stock.
      await t.db.insertInto('ownership').values({ product_id: b.product.id, account_id: (await createAccount(t.db)).id, acquired_via: 'ADMIN' }).execute();
      await rejects(atelier().linkFromStock(o.id, b.product.productId, admin), 'PIECE_NOT_IN_STOCK', 409);
      clock.advance(MINUTE);
      const linked = await atelier().linkFromStock(o.id, a.product.productId.toLowerCase(), admin);
      expect([linked.productId, linked.reservation]).toEqual([a.product.productId, 'STOCK']);
      const event = await t.db.selectFrom('order_events').select(['action', 'details']).where('order_id', '=', o.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(event).toEqual({ action: 'order.link', details: { productId: a.product.id, via: 'stock', reservation: 'STOCK' } });
      await rejects(atelier().linkFromStock(o.id, a.product.productId, admin), 'ORDER_PIECE_LINKED', 409);
      // The same piece for another order: taken.
      const second = await salonOrder('70', model);
      await rejects(atelier().linkFromStock(second.id, a.product.productId, admin), 'PIECE_TAKEN', 409);
      // An order waiting for supplier stock may take a piece too, never one fulfilling another order.
      const third = await salonOrder('70', model);
      expect(third.reservation).toBe('AWAITING');
      await rejects(atelier().linkFromStock(third.id, a.product.productId, admin), 'PIECE_TAKEN', 409);
      expect((await orderRow(third.id)).reservation).toBe('AWAITING');
    });

    it('takes a piece for an order waiting for supplier stock: counted in with the order when none is available there, taken from what is available otherwise, the piece counted once', async () => {
      const model = await createModel(t.db, 'ORBIT');
      const sku = await skuOf('74', model);
      const issue = () => ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: model, variant: '74', material: '925 STERLING SILVER' }, admin);
      const movementsOf = (productUuid: string) => t.db.selectFrom('stock_movements').select(['reason', 'delta', 'order_id', 'location_id', 'note']).where('product_id', '=', productUuid).execute();

      // Nothing in stock: the order waits for supplier stock.
      const first = await salonOrder('74', model);
      expect(first.reservation).toBe('AWAITING');
      // A piece issued in the Generator, never counted in the stock: counted in with the order, entering the stock.
      const g = await issue();
      expect(await movementsOf(g.product.id)).toEqual([]);
      clock.advance(MINUTE);
      const linked = await atelier().linkFromStock(first.id, g.product.productId, admin);
      expect([linked.productId, linked.reservation]).toEqual([g.product.productId, 'STOCK']);
      expect(await movementsOf(g.product.id)).toEqual([
        { reason: 'PRODUCED', delta: 1, order_id: first.id, location_id: first.location_id, note: 'A finished piece never counted in the stock, counted in with the order it fulfils.' },
      ]);
      expect((await productRow(g.product.id)).stock_entered_at).toEqual(clock.now());
      expect(await stockLevel(t.db, sku, first.location_id)).toEqual({ onHand: 1, reserved: 1, available: 0 });
      const event = await t.db.selectFrom('order_events').select(['action', 'details']).where('order_id', '=', first.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(event).toEqual({ action: 'order.link', details: { productId: g.product.id, via: 'stock', reservation: 'STOCK' } });

      // A piece counted in by a correction after the order began waiting: the correction serves it, then the piece is
      // taken from what is available, once.
      const second = await salonOrder('74', model);
      expect(second.reservation).toBe('AWAITING');
      const k = await issue();
      await receive(sku, france, 1);
      expect((await orderRow(second.id)).reservation).toBe('STOCK');
      await atelier().linkFromStock(second.id, k.product.productId, admin);
      expect(await movementsOf(k.product.id)).toEqual([]);
      expect(await stockLevel(t.db, sku, france)).toEqual({ onHand: 2, reserved: 2, available: 0 });

      // A piece the ledger counts, none available at the order's location: refused, nothing changes.
      clock.advance(MINUTE);
      await ctx.services.orders.transition(first.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
      const holder = await salonOrder('74', model);
      expect(holder.reservation).toBe('STOCK');
      const waiting = await salonOrder('74', model);
      expect(waiting.reservation).toBe('AWAITING');
      await rejects(atelier().linkFromStock(waiting.id, g.product.productId, admin), 'STOCK_NOT_AVAILABLE', 409);
      expect((await orderRow(waiting.id)).reservation).toBe('AWAITING');
      // The order holding it in stock takes it.
      expect((await atelier().linkFromStock(holder.id, g.product.productId, admin)).productId).toBe(g.product.productId);
    });
  });
});
