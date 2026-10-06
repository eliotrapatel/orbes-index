/**
 * Orders, the stock and the event journal (plan LIVE RELEASE+ of 2026-10-04, step S1; migration 0022), on the services
 * as createContext wires them:
 *
 *  - the first boot: FRANCE WAREHOUSE (the default) and LOGISTICS WAREHOUSE, the four carriers, once; the pieces and the
 *    sizes on sale linked to their SKUs; the orders of the sales committed without them, the LIVE resolution mapped;
 *  - every channel creates its orders: a LIVE entry CONFIRMED (one per piece), a draw's entry confirmed by Client
 *    Services, a request of the private salon closed as ACCEPTED;
 *  - what an order holds: a piece in stock, or a piece to make with its ORBES identity reserved (L6: /verify answers it
 *    as unknown); moved with the order's location; released, or cancelled and its identity retired (never reused);
 *  - exactly the legal steps, each one event, one audit entry and one journal entry, in its transaction; SHIPPED with
 *    its carrier and number, the piece leaving the ledger; DELIVERED by itself at the buyer's registration; RETURNED;
 *  - the ledger's balances, transfers as paired movements; the journal replayed to the state, read once per reader;
 *  - the buyer's details: never in the audit log, the events nor the journal, exported to the account.
 * The race for a SKU's last piece is test/services/orders-concurrency.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { ORDER_STATUSES, type JsonObject, type OrderStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { acknowledgeJournal, readJournal, replayJournal, stockKey, type JournalEntry } from '../../src/server/services/journal.js';
import { ORDER_CURRENCIES, ORDER_TRANSITIONS, benchPayload, orderPayload, orderReference, trackingLink, type OrderTransitionInput } from '../../src/server/services/orders.js';
import { LIVE_CURRENCIES } from '../../src/server/services/live-console.js';
import { CARRIER_PRESETS, ensureSku, stockBalances, stockLevel } from '../../src/server/services/stock.js';
import { createManualClock, SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

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

describe('orders, the stock and the journal (plan LIVE RELEASE+, S1)', () => {
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

  // ── helpers ──────────────────────────────────────────────────────────────

  const orders = () => ctx.services.orders;
  const stock = () => ctx.services.stock;
  const skuOf = (sizeLabel: string | null, modelId = f.modelId) => inTransaction(t.db, (tx) => ensureSku(tx, modelId, sizeLabel));
  /** `n` pieces of a SKU entered at a location (a count corrected by Client Services). */
  const receive = (skuId: string, locationId: string, n: number) => stock().adjust({ skuId, locationId, delta: n, note: 'Pieces counted at the atelier.' }, admin);
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const eventsOf = (orderId: string) => t.db.selectFrom('order_events').selectAll().where('order_id', '=', orderId).orderBy('id').execute();
  const journalOf = (entityId: string) => t.db.selectFrom('event_journal').selectAll().where('entity_id', '=', entityId).orderBy('id').execute();
  const auditsOf = (targetId: string, action?: string) =>
    t.db
      .selectFrom('audit_logs')
      .select(['action', 'actor_type', 'actor_id', 'details'])
      .where('target_id', '=', targetId)
      .$if(action !== undefined, (q) => q.where('action', '=', action!))
      .orderBy('id')
      .execute();
  const benchOf = (orderId: string) => t.db.selectFrom('bench_items').selectAll().where('order_id', '=', orderId).orderBy('created_at').execute();
  const productRow = (id: string) => t.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  /** A LIVE sale as a collector lives it: entered before T0, the line at T0, the seal held, PAY. */
  async function liveSale(o: { quantity?: number; sizes?: { label: string; stock: number }[]; size?: number; addons?: { label: string; priceMinor: number }[]; locationId?: string } = {}) {
    const quantity = o.quantity ?? 1;
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: o.sizes ?? [{ label: '52', stock: 5 }], perAccount: Math.max(1, quantity), addons: o.addons });
    if (o.locationId) await t.db.updateTable('drops').set({ stock_location_id: o.locationId }).where('id', '=', r.id).execute();
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[o.size ?? 0]!.id, quantity }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    if (r.addons.length) await f.live.setAddons(a.id, r.id, r.addons.map((x) => x.id), a.actor);
    await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').selectAll().where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const rows = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).orderBy('piece').execute();
    return { release: r, account: a, entry, orders: rows };
  }

  /** A request of the private salon closed as ACCEPTED by Client Services: its order, its size and price entered when given. */
  async function salonOrder(o: { size?: string | null; priceMinor?: number; accountId?: string; modelId?: string } = {}) {
    const accountId = o.accountId ?? (await createAccount(t.db)).id;
    const request = await t.db.insertInto('shop_requests').values({ account_id: accountId, model_id: o.modelId ?? f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(1000);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = await t.db.selectFrom('orders').selectAll().where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    if (o.size !== undefined || o.priceMinor !== undefined) {
      await orders().setTerms(order.id, { ...(o.size !== undefined ? { sizeLabel: o.size } : {}), ...(o.priceMinor !== undefined ? { priceMinor: o.priceMinor, currency: 'EUR' } : {}) }, admin);
    }
    return orderRow(order.id);
  }

  /**
   * The piece that fulfils an order holding one in stock, linked before it ships (step S2): a piece of its SKU issued
   * in advance, picked from the stock by the atelier. Nothing when the order has its piece, or holds none in stock.
   */
  async function linkPiece(orderId: string) {
    const o = await orderRow(orderId);
    if (o.product_id !== null || o.reservation !== 'STOCK') return;
    const sku = await t.db.selectFrom('skus').select(['model_id', 'size_label']).where('id', '=', o.sku_id!).executeTakeFirstOrThrow();
    const { product } = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: sku.model_id, ...(sku.size_label !== null ? { variant: sku.size_label } : {}), material: '925 STERLING SILVER' }, admin);
    await ctx.services.atelier.linkFromStock(orderId, product.productId, admin);
  }

  /** Move an order through steps (each valid for it), its piece linked before it ships. */
  async function walk(orderId: string, steps: OrderStatus[]) {
    for (const s of steps) {
      clock.advance(MINUTE);
      if (s === 'SHIPPED') await linkPiece(orderId);
      await stepTo(orderId, s);
    }
    return orderRow(orderId);
  }
  const inputFor = (to: OrderStatus): OrderTransitionInput =>
    to === 'SHIPPED' ? { to, carrierId: colissimo, trackingNumber: '6A12345678901' } : to === 'CANCELLED' ? { to, note: 'The client withdrew.' } : ({ to } as OrderTransitionInput);
  /** One step: a return is opened on its own (archived here), every other step is a transition. */
  const stepTo = (orderId: string, to: OrderStatus) =>
    to === 'RETURNED' ? orders().returnOrder(orderId, { outcome: 'ARCHIVED', note: 'Returned to the house.' }, admin).then((r) => r.order) : orders().transition(orderId, inputFor(to), admin);

  // ── the first boot ───────────────────────────────────────────────────────

  describe('the first boot', () => {
    it('creates FRANCE WAREHOUSE (the default), LOGISTICS WAREHOUSE and the four carriers once, never again, a renamed one included; audited stock.setup', async () => {
      const locations = await t.db.selectFrom('stock_locations').select(['name', 'is_default', 'shopify_location_id']).orderBy('created_at').orderBy('name').execute();
      expect(locations).toEqual([
        { name: 'FRANCE WAREHOUSE', is_default: true, shopify_location_id: null },
        { name: 'LOGISTICS WAREHOUSE', is_default: false, shopify_location_id: null },
      ]);
      const carriers = await t.db.selectFrom('carriers').select(['name', 'tracking_url', 'active']).orderBy('name').execute();
      expect(carriers.map((c) => c.name)).toEqual(['Chronopost', 'Colissimo', 'DHL Express', 'UPS']);
      for (const c of carriers) {
        expect(c.active).toBe(true);
        expect(c.tracking_url).toMatch(/^https:\/\/[^\s]+\{tracking\}/);
      }
      expect(CARRIER_PRESETS.map((c) => c.name)).toEqual(['Colissimo', 'Chronopost', 'DHL Express', 'UPS']);
      const [setup] = await t.db.selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'stock.setup').execute();
      expect(setup).toEqual({ actor_type: 'system', details: { locations: ['FRANCE WAREHOUSE', 'LOGISTICS WAREHOUSE'], carriers: ['Colissimo', 'Chronopost', 'DHL Express', 'UPS'] } });
      // A later boot creates nothing, even after a location was renamed and a carrier set aside.
      await t.db.updateTable('stock_locations').set({ name: 'PARTNER STOCK' }).where('id', '=', logistics).execute();
      await t.db.updateTable('carriers').set({ active: false }).where('name', '=', 'UPS').execute();
      expect(await orders().prepare()).toMatchObject({ locations: [], carriers: [] });
      expect((await t.db.selectFrom('stock_locations').select('name').orderBy('name').execute()).map((l) => l.name)).toEqual(['FRANCE WAREHOUSE', 'PARTNER STOCK']);
      expect(await t.db.selectFrom('carriers').select('id').execute()).toHaveLength(4);
      expect(await t.db.selectFrom('audit_logs').select('id').where('action', '=', 'stock.setup').execute()).toHaveLength(1);
      await t.db.updateTable('stock_locations').set({ name: 'LOGISTICS WAREHOUSE' }).where('id', '=', logistics).execute();
      await t.db.updateTable('carriers').set({ active: true }).where('name', '=', 'UPS').execute();
    });

    it('links the pieces and the sizes on sale written without their SKU, one SKU per model and size (one size included), its code the model\'s prefix and the size', async () => {
      const model = await t.db
        .insertInto('models')
        .values({ category_id: 1, name: 'HALO', type: 'RING', sku_prefix: 'HAL-RG', default_material: '925 STERLING SILVER' })
        .returning('id')
        .executeTakeFirstOrThrow();
      // As the previous image writes them: issued pieces and a release's sizes, no SKU.
      const top = Number((await t.db.selectFrom('products').select((eb) => eb.fn.max('serial').as('s')).where('category_id', '=', 1).where('year', '=', 2026).executeTakeFirstOrThrow()).s ?? 0);
      const pieces: string[] = [];
      for (const [i, variant] of (['52', ' 52 ', null, '54'] as const).entries()) {
        const serial = top + 1 + i;
        pieces.push(
          (
            await t.db
              .insertInto('products')
              .values({
                product_id: `O26-J-${String(serial).padStart(5, '0')}`,
                packed_identity: (26 << 25) | (1 << 20) | serial,
                year: 2026,
                category_id: 1,
                serial,
                sku: 'HAL-RG',
                model_id: model.id,
                variant,
                material: '925 STERLING SILVER',
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
        );
      }
      const r = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + 24 * HOUR), sizes: [{ label: '52', stock: 1 }, { label: '56', stock: 1 }], modelId: model.id, published: false });
      const prepared = await orders().prepare();
      expect(prepared.linked).toEqual({ products: 4, sizes: 2 });
      const skus = await t.db.selectFrom('skus').select(['id', 'size_label', 'code']).where('model_id', '=', model.id).orderBy('code').execute();
      expect(skus.map((s) => [s.size_label, s.code])).toEqual([
        [null, 'HAL-RG'],
        ['52', 'HAL-RG-52'],
        ['54', 'HAL-RG-54'],
        ['56', 'HAL-RG-56'],
      ]);
      const skuOfLabel = (label: string | null) => skus.find((s) => s.size_label === label)!.id;
      expect((await Promise.all(pieces.map(productRow))).map((p) => p.sku_id)).toEqual([skuOfLabel('52'), skuOfLabel('52'), skuOfLabel(null), skuOfLabel('54')]);
      expect((await t.db.selectFrom('drop_sizes').select(['label', 'sku_id']).where('drop_id', '=', r.id).orderBy('position').execute()).map((s) => s.sku_id)).toEqual([
        skuOfLabel('52'),
        skuOfLabel('56'),
      ]);
      // Idempotent; a piece issued now carries its SKU from the start.
      expect((await orders().prepare()).linked).toEqual({ products: 0, sizes: 0 });
      const issued = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: model.id, variant: '54', material: '925 STERLING SILVER' }, admin);
      expect((await productRow(issued.product.id)).sku_id).toBe(skuOfLabel('54'));
    });

    it('creates the orders of the sales committed before them: a LIVE entry CONFIRMED (its resolution mapped: CONCLUDED paid, CANCELLED cancelled holding nothing) and a draw\'s entry CONFIRMED, once', async () => {
      // Three confirmed reservations, as the previous image leaves them: no order; one concluded, one cancelled.
      const r = await createLiveRelease(f, { opensAt: new Date(clock.now().getTime() + HOUR), sizes: [{ label: '58', stock: 6 }], perAccount: 2 });
      const T = new Date(clock.now().getTime() + HOUR);
      const asBefore = async (quantity: number, resolution: 'CONCLUDED' | 'CANCELLED' | null, position: number) => {
        const a = await createAccount(t.db);
        const at = (s: number) => new Date(T.getTime() + s * 1000);
        return (
          await t.db
            .insertInto('live_entries')
            .values({
              drop_id: r.id,
              account_id: a.id,
              size_id: r.sizes[0]!.id,
              quantity,
              status: 'CONFIRMED',
              tier: 0,
              position,
              joined_at: at(-60),
              queued_at: at(0),
              turn_at: at(1),
              turn_expires_at: at(31),
              turn_token_hash: new Uint8Array(32).fill(position),
              press_started_at: at(2),
              gesture_ms: 1500,
              secured_at: at(4),
              hold_expires_at: at(304),
              confirmed_at: at(10),
              ...(resolution ? { resolution, handled_at: at(20), handled_by: admin.id!, resolution_note: resolution === 'CANCELLED' ? 'The client withdrew.' : null } : {}),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      };
      const open = await asBefore(2, null, 1);
      const concluded = await asBefore(1, 'CONCLUDED', 2);
      const cancelled = await asBefore(1, 'CANCELLED', 3);
      const draw = await f.drops.create({ modelId: f.modelId, title: 'A draw before the orders', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0 }, admin);
      const drawer = await createAccount(t.db);
      const drawEntry = (
        await t.db
          .insertInto('drop_entries')
          .values({ drop_id: draw.id, account_id: drawer.id, created_at: clock.now(), status: 'CONFIRMED', tier: 0, seniority: 0, rank: 1, respond_by: new Date(T.getTime() + 2 * HOUR), handled_by: admin.id!, handled_at: new Date(T.getTime() + HOUR) })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      clock.set(new Date(T.getTime() + 2 * HOUR));
      expect((await orders().prepare()).orders).toBe(5);
      const of = (entryId: string) => t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entryId).orderBy('piece').execute();
      expect((await of(open)).map((o) => [o.piece, o.status, o.reservation])).toEqual([
        [1, 'RESERVED', 'BENCH'],
        [2, 'RESERVED', 'BENCH'],
      ]);
      expect((await of(concluded)).map((o) => [o.status, o.reservation, o.paid_at?.toISOString()])).toEqual([['PAID', 'BENCH', clock.now().toISOString()]]);
      const [gone] = await of(cancelled);
      // A cancellation before the orders creates its order holding nothing, then cancels it: no identity is reserved for it.
      expect([gone!.status, gone!.reservation]).toEqual(['CANCELLED', null]);
      expect(await benchOf(gone!.id)).toEqual([]);
      expect((await eventsOf(gone!.id)).map((e) => [e.action, e.status, e.note])).toEqual([
        ['order.create', 'RESERVED', null],
        ['order.cancel', 'CANCELLED', 'The client withdrew.'],
      ]);
      const [drawn] = await t.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', drawEntry).execute();
      expect(drawn).toMatchObject({ channel: 'DRAW', drop_id: draw.id, account_id: drawer.id, status: 'RESERVED', sku_id: null, reservation: null });
      // RESERVED when the sale was made (the entry's confirmation, the draw's handling), in their history too; the
      // steps mapped at boot, now.
      const sold = new Date(T.getTime() + 10_000);
      for (const o of [...(await of(open)), ...(await of(concluded)), gone!]) {
        expect(o.reserved_at, o.id).toEqual(sold);
        expect((await eventsOf(o.id))[0]!.created_at, o.id).toEqual(sold);
      }
      expect([gone!.cancelled_at, (await eventsOf(gone!.id))[1]!.created_at]).toEqual([clock.now(), clock.now()]);
      expect(drawn!.reserved_at).toEqual(new Date(T.getTime() + HOUR));
      expect((await orders().get(drawn!.id)).events.map((e) => [e.status, e.at])).toEqual([['RESERVED', new Date(T.getTime() + HOUR)]]);
      // Audited by the system, marked as made at boot.
      expect((await auditsOf(gone!.id)).map((a) => [a.action, a.actor_type, (a.details as JsonObject).backfill])).toEqual([
        ['order.create', 'system', true],
        ['order.cancel', 'system', true],
      ]);
      // Once: a second boot creates none.
      expect((await orders().prepare()).orders).toBe(0);
    });
  });

  // ── every channel ────────────────────────────────────────────────────────

  describe('every channel creates its orders', () => {
    it('a LIVE entry CONFIRMED: one order per piece, the release\'s size, price and currency, the add-ons as sold, RESERVED at the release\'s location, in PAY\'s transaction', async () => {
      const sale = await liveSale({ quantity: 2, addons: [{ label: 'ENGRAVING', priceMinor: 15_000 }, { label: 'GIFT BOX', priceMinor: 5_000 }], locationId: logistics });
      expect(sale.orders).toHaveLength(2);
      const sku = sale.orders[0]!.sku_id!;
      expect((await t.db.selectFrom('drop_sizes').select('sku_id').where('id', '=', sale.entry.size_id).executeTakeFirstOrThrow()).sku_id).toBe(sku);
      for (const [i, o] of sale.orders.entries()) {
        expect(o).toMatchObject({
          channel: 'LIVE',
          live_entry_id: sale.entry.id,
          piece: i + 1,
          drop_id: sale.release.id,
          account_id: sale.account.id,
          model_id: f.modelId,
          size_label: '52',
          sku_id: sku,
          price_minor: 505_000,
          currency: 'EUR',
          status: 'RESERVED',
          location_id: logistics,
          reservation: 'BENCH',
          surprise: null,
          buyer_name: null,
        });
        expect(o.addons).toEqual(sale.release.addons.map((a) => ({ id: a.id, label: a.label, priceMinor: a.priceMinor })));
        expect(o.reserved_at.toISOString()).toBe(sale.entry.confirmed_at!.toISOString());
        // Audited as the collector's, in the transaction of PAY.
        expect((await auditsOf(o.id, 'order.create'))[0]).toMatchObject({ actor_type: 'account', actor_id: sale.account.id, details: { channel: 'LIVE', liveEntryId: sale.entry.id, piece: i + 1, to: 'RESERVED', reservation: 'BENCH' } });
      }
      // The CSV and board of the LIVE release are untouched; a reference for each order.
      expect(orderReference(sale.orders[0]!.id)).toMatch(/^OR-[0-9A-F]{8}$/);
    });

    it('a draw\'s entry confirmed by Client Services: its order, RESERVED at the drop\'s location, held once its size is entered', async () => {
      const T = new Date(clock.now().getTime() + HOUR);
      const d = await f.drops.create({ modelId: f.modelId, title: 'A draw', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0 }, admin);
      await t.db.updateTable('drops').set({ stock_location_id: logistics }).where('id', '=', d.id).execute();
      await f.drops.publish(d.id, admin);
      const a = await createAccount(t.db);
      clock.set(new Date(T.getTime() + MINUTE));
      await f.drops.enter(a.id, d.id, a.actor);
      clock.set(new Date(T.getTime() + 2 * HOUR));
      const drawn = await f.drops.draw(d.id, admin);
      const entryId = (await t.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).executeTakeFirstOrThrow()).id;
      expect(drawn).toBeDefined();
      await f.drops.confirm(d.id, entryId, 'Sold by phone.', admin);
      const [o] = await t.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', entryId).execute();
      expect(o).toMatchObject({ channel: 'DRAW', drop_id: d.id, account_id: a.id, status: 'RESERVED', location_id: logistics, sku_id: null, size_label: null, price_minor: null, reservation: null });
      // Client Services enters its size and price: it then holds a piece of that size (none in stock: one to make).
      clock.advance(MINUTE);
      const view = await orders().setTerms(o!.id, { sizeLabel: '50', priceMinor: 480_000, currency: 'EUR' }, admin);
      expect(view).toMatchObject({ sizeLabel: '50', priceMinor: 480_000, currency: 'EUR', reservation: 'BENCH', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' } });
      expect(view.bench?.productId).toMatch(/^O26-J-\d{5}$/);
      expect((await auditsOf(o!.id, 'order.terms'))[0]!.details).toMatchObject({ fields: ['price', 'size'], reservation: 'BENCH' });
    });

    it('a request of the private salon closed as ACCEPTED: its order at the default location; DECLINED: none', async () => {
      const o = await salonOrder();
      expect(o).toMatchObject({ channel: 'SALON', drop_id: null, model_id: f.modelId, status: 'RESERVED', location_id: france, sku_id: null, reservation: null });
      const declined = await t.db.insertInto('shop_requests').values({ account_id: (await createAccount(t.db)).id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      await ctx.services.salon.close(declined.id, { note: 'The client chose another piece.', outcome: 'DECLINED' }, admin);
      expect(await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', declined.id).execute()).toEqual([]);
    });
  });

  // ── what an order holds ──────────────────────────────────────────────────

  describe('what an order holds', () => {
    it('a piece in stock when one is available at its location; otherwise a piece to make, its ORBES identity reserved at once (RESERVED, its genome and warranty, no code, no history)', async () => {
      const sku = await skuOf('60');
      await receive(sku, france, 1);
      const first = await salonOrder({ size: '60' });
      expect([first.reservation, first.location_id]).toEqual(['STOCK', france]);
      expect(await stockLevel(t.db, sku, france)).toEqual({ onHand: 1, reserved: 1, available: 0 });
      // The last piece is taken: the next order of that size has it made.
      const second = await salonOrder({ size: '60' });
      expect(second.reservation).toBe('BENCH');
      const [bench] = await benchOf(second.id);
      expect(bench).toMatchObject({ status: 'TO_MAKE', sku_id: sku, location_id: france, order_id: second.id, drop_id: null, engraving_text: null });
      const identity = await productRow(bench!.product_id);
      expect(identity).toMatchObject({ status: 'RESERVED', ownership_state: 'UNREGISTERED', claim_secret_hash: null, model_id: f.modelId, variant: '60', sku_id: sku, year: 2026 });
      expect(identity.product_id).toMatch(/^O26-J-\d{5}$/);
      expect(await t.db.selectFrom('genomes').select('genome_id').where('product_id', '=', identity.id).execute()).toEqual([{ genome_id: identity.product_id }]);
      expect(await t.db.selectFrom('warranties').select(['start_date']).where('product_id', '=', identity.id).execute()).toEqual([{ start_date: null }]);
      expect(await t.db.selectFrom('codes').select('id').where('product_id', '=', identity.id).execute()).toEqual([]);
      expect(await t.db.selectFrom('product_status_history').select('id').where('product_id', '=', identity.id).execute()).toEqual([]);
      expect((await auditsOf(bench!.id, 'bench.create'))[0]!.details).toMatchObject({ orderId: second.id, productId: identity.product_id, skuId: sku });
      expect((await journalOf(identity.id)).map((j) => [j.type, (j.payload as JsonObject).status])).toEqual([['product.reserve', 'RESERVED']]);
      // The identities follow one another, as an issue's serial: the next one is the next serial.
      const third = await salonOrder({ size: '60' });
      const next = await productRow((await benchOf(third.id))[0]!.product_id);
      expect(next.serial).toBe(identity.serial + 1);
    });

    it('/verify answers a RESERVED identity as an unknown code, naming no piece and raising no finding', async () => {
      const issued = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '62', material: '925 STERLING SILVER' }, admin);
      // An identity reserved with its code signed (the atelier's work sheet): not issued yet.
      await t.db.updateTable('products').set({ status: 'RESERVED' }).where('id', '=', issued.product.id).execute();
      const anomalies = await t.db.selectFrom('anomalies').select('id').execute();
      const out = await ctx.services.verification.verify({ code: issued.code.data }, {});
      expect(out.state).toBe('UNKNOWN');
      for (const k of ['product', 'genome', 'warranty', 'ownership', 'registration', 'verification'] as const) expect(out[k], k).toBeUndefined();
      const scan = await t.db.selectFrom('scan_events').select(['id', 'product_id', 'code_id', 'result_state']).where('id', '=', out.scanId).executeTakeFirstOrThrow();
      expect([scan.product_id, scan.code_id, scan.result_state]).toEqual([null, null, 'UNKNOWN']);
      expect(await t.db.selectFrom('authentication_events').select(['reasons', 'product_id']).where('scan_event_id', '=', scan.id).executeTakeFirstOrThrow()).toEqual({ reasons: ['PRODUCT_NOT_REGISTERED'], product_id: null });
      expect(await t.db.selectFrom('anomalies').select('id').execute()).toHaveLength(anomalies.length);
      // Issued, the same code verifies.
      await t.db.updateTable('products').set({ status: 'ISSUED' }).where('id', '=', issued.product.id).execute();
      expect((await ctx.services.verification.verify({ code: issued.code.data }, {})).state).toBe('AUTHENTIC');
    });

    it('changing its location moves what it holds: a piece to make goes there; a piece in stock is released and taken again there, or made for it', async () => {
      const sku = await skuOf('64');
      await receive(sku, logistics, 1);
      // FRANCE has none: a piece to make. Moved to LOGISTICS, the piece to make goes there, its identity kept.
      const a = await salonOrder({ size: '64' });
      expect([a.location_id, a.reservation]).toEqual([france, 'BENCH']);
      const [bench] = await benchOf(a.id);
      clock.advance(MINUTE);
      expect(await orders().changeLocation(a.id, logistics, admin)).toMatchObject({ location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, reservation: 'BENCH', bench: { id: bench!.id } });
      expect(await benchOf(a.id)).toEqual([expect.objectContaining({ id: bench!.id, location_id: logistics, status: 'TO_MAKE', product_id: bench!.product_id })]);
      expect((await journalOf(bench!.id)).map((j) => j.type)).toEqual(['bench.create', 'bench.move']);
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: 1, reserved: 0, available: 1 });
      // An order served from LOGISTICS, its size entered: it holds the piece there. Moved to FRANCE, the piece is
      // released at LOGISTICS and one is made for FRANCE.
      const b = await salonOrder();
      await orders().changeLocation(b.id, logistics, admin);
      clock.advance(MINUTE);
      expect((await orders().setTerms(b.id, { sizeLabel: '64' }, admin)).reservation).toBe('STOCK');
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: 1, reserved: 1, available: 0 });
      clock.advance(MINUTE);
      const moved = await orders().changeLocation(b.id, france, admin);
      expect([moved.location.id, moved.reservation, moved.bench?.productId]).toEqual([france, 'BENCH', expect.stringMatching(/^O26-J-\d{5}$/)]);
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: 1, reserved: 0, available: 1 });
      expect((await auditsOf(b.id, 'order.location')).at(-1)!.details).toMatchObject({ from: 'RESERVED', to: 'RESERVED', fromLocationId: logistics, toLocationId: france, reservation: 'BENCH' });
      expect((await auditsOf(b.id)).map((x) => x.action)).toEqual(['order.create', 'order.location', 'order.terms', 'order.location']);
      // Refused for its own location, an unknown one, or once the order is over.
      await rejects(orders().changeLocation(b.id, france, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().changeLocation(b.id, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', admin), 'STOCK_LOCATION_NOT_FOUND', 404);
      await orders().transition(a.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
      await rejects(orders().changeLocation(a.id, france, admin), 'ORDER_CLOSED', 409);
    });

    it('CANCELLED releases its piece in stock, or cancels its piece to make and retires its identity, whose serial is never reused', async () => {
      const sku = await skuOf('68');
      await receive(sku, france, 1);
      const inStock = await salonOrder({ size: '68' });
      const toMake = await salonOrder({ size: '68' });
      expect([inStock.reservation, toMake.reservation]).toEqual(['STOCK', 'BENCH']);
      clock.advance(MINUTE);
      await orders().transition(inStock.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
      expect(await stockLevel(t.db, sku, france)).toEqual({ onHand: 1, reserved: 0, available: 1 });
      const [bench] = await benchOf(toMake.id);
      clock.advance(MINUTE);
      const view = await orders().transition(toMake.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
      expect([view.status, view.reservation, view.bench]).toEqual(['CANCELLED', null, null]);
      expect(await benchOf(toMake.id)).toEqual([expect.objectContaining({ status: 'CANCELLED', cancelled_at: clock.now() })]);
      const retired = await productRow(bench!.product_id);
      expect(retired.status).toBe('RETIRED');
      expect(await t.db.selectFrom('product_status_history').select(['from_status', 'to_status', 'reason', 'actor_type']).where('product_id', '=', retired.id).execute()).toEqual([
        { from_status: null, to_status: 'RETIRED', reason: 'Reserved identity retired: its order was cancelled', actor_type: 'admin' },
      ]);
      expect((await journalOf(retired.id)).map((j) => j.type)).toEqual(['product.reserve', 'product.retire']);
      // Its serial stays taken: the next identity takes the one after.
      const after = await salonOrder({ size: '70' });
      expect((await productRow((await benchOf(after.id))[0]!.product_id)).serial).toBeGreaterThan(retired.serial);
      // A note is required; once cancelled, nothing moves it.
      await rejects(orders().transition(after.id, { to: 'CANCELLED', note: '  ' } as OrderTransitionInput, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().transition(toMake.id, { to: 'PAID' }, admin), 'ORDER_TRANSITION_NOT_ALLOWED', 409);
    });
  });

  // ── the steps ────────────────────────────────────────────────────────────

  describe('the steps', () => {
    /** How an order reaches each status from RESERVED. */
    const PATHS: Record<OrderStatus, OrderStatus[]> = {
      RESERVED: [],
      PAID: ['PAID'],
      SHIPPED: ['PAID', 'SHIPPED'],
      DELIVERED: ['PAID', 'SHIPPED', 'DELIVERED'],
      CANCELLED: ['CANCELLED'],
      RETURNED: ['PAID', 'SHIPPED', 'RETURNED'],
    };

    it('the table is the plan\'s: RESERVED → PAID | CANCELLED; PAID → SHIPPED | CANCELLED; SHIPPED → DELIVERED | RETURNED; DELIVERED → RETURNED', () => {
      expect(ORDER_TRANSITIONS).toEqual({
        RESERVED: ['PAID', 'CANCELLED'],
        PAID: ['SHIPPED', 'CANCELLED'],
        SHIPPED: ['DELIVERED', 'RETURNED'],
        DELIVERED: ['RETURNED'],
        CANCELLED: [],
        RETURNED: [],
      });
      expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
      expect(ORDER_CURRENCIES).toEqual(LIVE_CURRENCIES);
    });

    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const allowed = ORDER_TRANSITIONS[from].includes(to);
        it(`${from} → ${to}: ${allowed ? 'allowed, one event, one audit entry and one journal entry' : 'refused, nothing written'}`, async () => {
          const sku = await skuOf('72');
          await receive(sku, france, 1);
          const o = await walk((await salonOrder({ size: '72', priceMinor: 480_000 })).id, PATHS[from]);
          expect(o.status).toBe(from);
          if (to === 'SHIPPED') await linkPiece(o.id);
          const before = { events: (await eventsOf(o.id)).length, journal: (await journalOf(o.id)).length, audit: (await auditsOf(o.id)).length };
          clock.advance(MINUTE);
          if (allowed) {
            const view = await stepTo(o.id, to);
            expect(view.status).toBe(to);
            const events = await eventsOf(o.id);
            const journal = await journalOf(o.id);
            const audit = await auditsOf(o.id);
            expect([events.length, journal.length, audit.length]).toEqual([before.events + 1, before.journal + 1, before.audit + 1]);
            const action = { PAID: 'order.pay', SHIPPED: 'order.ship', DELIVERED: 'order.deliver', CANCELLED: 'order.cancel', RETURNED: 'order.return' }[to as Exclude<OrderStatus, 'RESERVED'>];
            expect([events.at(-1)!.action, events.at(-1)!.status, journal.at(-1)!.type, audit.at(-1)!.action]).toEqual([action, to, action, action]);
            expect(audit.at(-1)!.details).toMatchObject({ from, to });
            expect(journal.at(-1)!.payload).toEqual(orderPayload(await orderRow(o.id)));
            const stamp = { PAID: 'paid_at', SHIPPED: 'shipped_at', DELIVERED: 'delivered_at', CANCELLED: 'cancelled_at', RETURNED: 'returned_at' }[to as Exclude<OrderStatus, 'RESERVED'>] as 'paid_at';
            expect((await orderRow(o.id))[stamp]).toEqual(clock.now());
          } else {
            await rejects(stepTo(o.id, to), to === 'RESERVED' ? 'VALIDATION_FAILED' : 'ORDER_TRANSITION_NOT_ALLOWED');
            expect((await orderRow(o.id)).status).toBe(from);
            expect({ events: (await eventsOf(o.id)).length, journal: (await journalOf(o.id)).length, audit: (await auditsOf(o.id)).length }).toEqual(before);
          }
        });
      }
    }

    it('SHIPPED needs an active carrier, a tracking number and its piece in stock at its location, linked to it: the piece leaves the ledger; the tracking link', async () => {
      const sku = await skuOf('74');
      // A piece still to make does not ship.
      const toMake = await walk((await salonOrder({ size: '74', priceMinor: 480_000 })).id, ['PAID']);
      expect(toMake.reservation).toBe('BENCH');
      await rejects(orders().transition(toMake.id, inputFor('SHIPPED'), admin), 'ORDER_NOT_READY', 409);
      // A piece in stock at its location (LOGISTICS) ships.
      await receive(sku, logistics, 1);
      const ready = await salonOrder({ priceMinor: 480_000 });
      await orders().changeLocation(ready.id, logistics, admin);
      await orders().setTerms(ready.id, { sizeLabel: '74' }, admin);
      const o = await walk(ready.id, ['PAID']);
      expect(o.reservation).toBe('STOCK');
      // In stock but not yet linked to its piece: it does not ship (the atelier picks the piece first).
      await rejects(orders().transition(o.id, inputFor('SHIPPED'), admin), 'ORDER_PIECE_NOT_LINKED', 409);
      expect((await orderRow(o.id)).status).toBe('PAID');
      await linkPiece(o.id);
      const linked = await orderRow(o.id);
      for (const [input, code] of [
        [{ to: 'SHIPPED', carrierId: colissimo, trackingNumber: 'x' }, 'VALIDATION_FAILED'],
        [{ to: 'SHIPPED', carrierId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', trackingNumber: '6A12345678901' }, 'CARRIER_NOT_FOUND'],
        [{ to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901', declaredValueMinor: -1 }, 'VALIDATION_FAILED'],
      ] as const) {
        await rejects(orders().transition(o.id, input as OrderTransitionInput, admin), code);
      }
      await t.db.updateTable('carriers').set({ active: false }).where('id', '=', colissimo).execute();
      await rejects(orders().transition(o.id, inputFor('SHIPPED'), admin), 'CARRIER_NOT_FOUND', 404);
      await t.db.updateTable('carriers').set({ active: true }).where('id', '=', colissimo).execute();
      clock.advance(MINUTE);
      const view = await orders().transition(o.id, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A 1234 5678 901', declaredValueMinor: 480_000 }, admin);
      expect(view.shipment).toEqual({
        carrier: { id: colissimo, name: 'Colissimo' },
        trackingNumber: '6A 1234 5678 901',
        trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901',
        declaredValueMinor: 480_000,
      });
      expect(view.reservation).toBeNull();
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: 0, reserved: 0, available: 0 });
      const [moved] = await t.db.selectFrom('stock_movements').selectAll().where('order_id', '=', o.id).execute();
      expect(moved).toMatchObject({ sku_id: sku, location_id: logistics, delta: -1, reason: 'SHIPPED', product_id: linked.product_id, actor_type: 'admin', actor_id: admin.id });
      expect(linked.product_id).not.toBeNull();
      expect((await auditsOf(o.id, 'order.ship'))[0]!.details).toMatchObject({ from: 'PAID', to: 'SHIPPED', carrierId: colissimo, declaredValueMinor: 480_000 });
      expect(trackingLink('https://track.example/{tracking}?x=1', 'AB 12/3')).toBe('https://track.example/AB12%2F3?x=1');
    });

    it('RETURNED, with a note: back to stock at a location (+1, the return recorded), or to the archive', async () => {
      const sku = await skuOf('78');
      await receive(sku, france, 2);
      const back = await walk((await salonOrder({ size: '78', priceMinor: 480_000 })).id, ['PAID', 'SHIPPED', 'DELIVERED']);
      const archived = await walk((await salonOrder({ size: '78', priceMinor: 480_000 })).id, ['PAID', 'SHIPPED']);
      await rejects(orders().returnOrder(back.id, { outcome: 'RESTOCKED', note: 'Returned unworn.' }, admin), 'STOCK_LOCATION_NOT_FOUND', 404);
      await rejects(orders().returnOrder(back.id, { outcome: 'ARCHIVED', locationId: logistics, note: 'Returned unworn.' }, admin), 'VALIDATION_FAILED', 400);
      // A return is opened on its own, never as a transition.
      await rejects(orders().transition(back.id, { to: 'RETURNED' } as unknown as OrderTransitionInput, admin), 'VALIDATION_FAILED', 400);
      // A return opens with a note, as a cancellation does.
      for (const note of [undefined, null, '  ']) await rejects(orders().returnOrder(back.id, { outcome: 'RESTOCKED', locationId: logistics, note: note as string }, admin), 'VALIDATION_FAILED', 400);
      clock.advance(MINUTE);
      await orders().returnOrder(back.id, { outcome: 'RESTOCKED', locationId: logistics, note: 'Returned unworn.' }, admin);
      await orders().returnOrder(archived.id, { outcome: 'ARCHIVED', note: 'Damaged in transit.' }, admin);
      expect(await stockLevel(t.db, sku, logistics)).toEqual({ onHand: 1, reserved: 0, available: 1 });
      expect(await stockLevel(t.db, sku, france)).toEqual({ onHand: 0, reserved: 0, available: 0 });
      const returns = await t.db.selectFrom('returns').select(['order_id', 'outcome', 'location_id', 'note', 'created_by']).where('order_id', 'in', [back.id, archived.id]).orderBy('created_at').orderBy('outcome', 'desc').execute();
      expect(returns).toEqual([
        { order_id: back.id, outcome: 'RESTOCKED', location_id: logistics, note: 'Returned unworn.', created_by: admin.id },
        { order_id: archived.id, outcome: 'ARCHIVED', location_id: null, note: 'Damaged in transit.', created_by: admin.id },
      ]);
    });

    it('only ORBES Client Services (or the system) moves an order; an unknown order is 404; an order is paid once priced', async () => {
      const unpriced = await salonOrder();
      await rejects(orders().transition(unpriced.id, { to: 'PAID' }, admin), 'ORDER_PRICE_MISSING', 409);
      expect((await orderRow(unpriced.id)).status).toBe('RESERVED');
      const o = await salonOrder({ priceMinor: 480_000 });
      await rejects(orders().transition(o.id, { to: 'PAID' }, { type: 'account', id: o.account_id }), 'FORBIDDEN', 403);
      await rejects(orders().transition('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', { to: 'PAID' }, admin), 'ORDER_NOT_FOUND', 404);
      await rejects(orders().transition(o.id, { to: 'LOST' } as unknown as OrderTransitionInput, admin), 'VALIDATION_FAILED', 400);
      expect((await orders().transition(o.id, { to: 'PAID' }, SYSTEM_ACTOR)).status).toBe('PAID');
    });

    it('what Client Services enters: a draw\'s or a salon\'s size and price (a LIVE order\'s are its release\'s), the engraving text on the order and its piece to make', async () => {
      const sale = await liveSale();
      const live = sale.orders[0]!;
      await rejects(orders().setTerms(live.id, { sizeLabel: '54' }, admin), 'ORDER_TERMS_FIXED', 409);
      await rejects(orders().setTerms(live.id, { priceMinor: 1, currency: 'EUR' }, admin), 'ORDER_TERMS_FIXED', 409);
      clock.advance(MINUTE);
      const view = await orders().setTerms(live.id, { engravingText: 'A. & B. — 2026' }, admin);
      expect(view.engravingText).toBe('A. & B. — 2026');
      expect((await benchOf(live.id))[0]!.engraving_text).toBe('A. & B. — 2026');
      const audit = (await auditsOf(live.id, 'order.terms'))[0]!;
      expect(audit.details).toMatchObject({ fields: ['engraving'] });
      expect(JSON.stringify(audit.details)).not.toContain('2026');
      expect(JSON.stringify((await journalOf(live.id)).at(-1)!.payload)).not.toContain('A. & B.');
      // Its piece to make journals the change too: engraved, never the words; cleared, no longer engraved.
      const bench = (await benchOf(live.id))[0]!;
      expect(live.reservation).toBe('BENCH');
      const engraved = (await journalOf(bench.id)).at(-1)!;
      expect([engraved.type, engraved.payload]).toEqual(['bench.engrave', benchPayload(bench)]);
      expect(engraved.payload).toMatchObject({ engraving: true });
      expect(JSON.stringify(engraved.payload)).not.toContain('A. & B.');
      clock.advance(MINUTE);
      await orders().setTerms(live.id, { engravingText: null }, admin);
      expect((await journalOf(bench.id)).map((j) => [j.type, (j.payload as JsonObject).engraving])).toEqual([
        ['bench.create', false],
        ['bench.engrave', true],
        ['bench.engrave', false],
      ]);
      // A salon order: price and currency together, in the house's currencies, before it is paid.
      const o = await salonOrder();
      await rejects(orders().setTerms(o.id, { priceMinor: 480_000 }, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().setTerms(o.id, { priceMinor: 480_000, currency: 'JPY' }, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().setTerms(o.id, {}, admin), 'VALIDATION_FAILED', 400);
      await orders().setTerms(o.id, { priceMinor: 480_000, currency: 'EUR' }, admin);
      await walk(o.id, ['PAID']);
      await rejects(orders().setTerms(o.id, { priceMinor: 1, currency: 'EUR' }, admin), 'ORDER_PAID', 409);
      // One size, said as such: the model's one-size SKU.
      const one = await salonOrder({ size: null });
      expect((await t.db.selectFrom('skus').select('size_label').where('id', '=', one.sku_id!).executeTakeFirstOrThrow()).size_label).toBeNull();
      // Typed ONE SIZE: the same, stored as one size. Its SKU named again in another spelling is no change: the piece
      // to make it holds stays, its reserved identity too.
      const typed = await salonOrder({ size: 'ONE SIZE', modelId: (await t.db.insertInto('models').values({ category_id: 1, name: 'CHAIN', type: 'PENDANT', sku_prefix: 'CHN-PD' }).returning('id').executeTakeFirstOrThrow()).id });
      expect([typed.size_label, typed.reservation]).toEqual([null, 'BENCH']);
      const typedBench = await t.db.selectFrom('bench_items').select(['id', 'status', 'product_id']).where('order_id', '=', typed.id).executeTakeFirstOrThrow();
      await rejects(orders().setTerms(typed.id, { sizeLabel: 'one size' }, admin), 'VALIDATION_FAILED', 400);
      expect(await t.db.selectFrom('bench_items').select(['id', 'status', 'product_id']).where('order_id', '=', typed.id).execute()).toEqual([typedBench]);
      // A size in another case is its SKU's: Small names the SKU of SMALL, and the order says it as the SKU does.
      const small = await salonOrder({ size: 'SMALL' });
      const smaller = await salonOrder({ size: 'small' });
      expect([smaller.sku_id, smaller.size_label]).toEqual([small.sku_id, 'SMALL']);
      const smallBench = await t.db.selectFrom('bench_items').select('id').where('order_id', '=', small.id).executeTakeFirst();
      await rejects(orders().setTerms(small.id, { sizeLabel: 'Small' }, admin), 'VALIDATION_FAILED', 400);
      expect(await orderRow(small.id)).toMatchObject({ size_label: 'SMALL', sku_id: small.sku_id });
      expect(await t.db.selectFrom('bench_items').select('id').where('order_id', '=', small.id).executeTakeFirst()).toEqual(smallBench);
    });
  });

  // ── the buyer ────────────────────────────────────────────────────────────

  describe('the buyer\'s details', () => {
    it('are entered by Client Services at any step, never in the audit log, the order\'s events nor the journal; exported to the account under the right of access with its orders', async () => {
      const sale = await liveSale();
      const o = sale.orders[0]!;
      const name = 'Ada Zurbaran-Quill';
      const address = '12 rue Imaginaire\n75003 Paris\nFrance';
      clock.advance(MINUTE);
      const view = await orders().setBuyer(o.id, { name, address }, admin);
      expect(view.buyer).toEqual({ name, address });
      await rejects(orders().setBuyer(o.id, { name, address }, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().setBuyer(o.id, { name: 'x'.repeat(201), address }, admin), 'VALIDATION_FAILED', 400);
      await rejects(orders().setBuyer(o.id, { name: 'Ada\nZ', address }, admin), 'VALIDATION_FAILED', 400);
      const audit = await auditsOf(o.id, 'order.buyer');
      expect(audit.map((a) => a.details)).toEqual([{ from: 'RESERVED', to: 'RESERVED', fields: ['name', 'address'], cleared: false }]);
      const everything = JSON.stringify([
        await t.db.selectFrom('audit_logs').select('details').execute(),
        await t.db.selectFrom('order_events').select(['note', 'details']).execute(),
        await t.db.selectFrom('event_journal').select('payload').execute(),
      ]);
      expect(everything).not.toContain('Zurbaran');
      expect(everything).not.toContain('Imaginaire');
      expect((await journalOf(o.id)).at(-1)!.payload).toMatchObject({ buyer: true });
      // The right of access gives them back to their account, with the order's steps; never who handled it.
      const exported = await ctx.services.owners.exportData(sale.account.id, admin);
      expect(exported.orders).toEqual([
        expect.objectContaining({
          reference: orderReference(o.id),
          channel: 'LIVE',
          release: 'LIVE',
          model: 'MONOLITHE',
          size: '52',
          priceMinor: 505_000,
          currency: 'EUR',
          buyer: { name, address },
          status: 'RESERVED',
          carrier: null,
          history: [
            { status: 'RESERVED', at: o.reserved_at, note: null },
            { status: 'RESERVED', at: clock.now(), note: null },
          ],
        }),
      ]);
      expect(Object.keys(exported.orders[0]!).sort()).toEqual([
        'addons', 'buyer', 'cancelledAt', 'carrier', 'channel', 'currency', 'deliveredAt', 'engravingText', 'history', 'invoices', 'model', 'modelVariant', 'paidAt', 'priceMinor', 'reference',
        'release', 'reservedAt', 'returnedAt', 'shippedAt', 'size', 'status', 'trackingNumber',
      ]);
      expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'account.export').where('target_id', '=', sale.account.id).executeTakeFirstOrThrow()).details).toMatchObject({ orders: 1 });
      expect(exported.orders[0]!.invoices).toEqual([]);
      // Paid: its invoice issued to the buyer then. The buyer changed since: the export gives the order's buyer as it is
      // now and each document as issued, its buyer (the account's email at issue too) and its lines.
      clock.advance(MINUTE);
      await orders().transition(o.id, { to: 'PAID' }, admin);
      clock.advance(MINUTE);
      const moved = { name: 'Ada Quill', address: '3 rue Neuve\n75004 Paris\nFrance' };
      await orders().setBuyer(o.id, moved, admin);
      const later = (await ctx.services.owners.exportData(sale.account.id, admin)).orders[0]!;
      expect(later.buyer).toEqual(moved);
      expect(later.invoices).toEqual([
        {
          number: expect.stringMatching(/^INV-\d{4}-\d{6}$/),
          kind: 'INVOICE',
          issuedAt: expect.any(Date),
          currency: 'EUR',
          totalMinor: 505_000,
          buyer: { name, address, email: sale.account.email },
          lines: expect.any(Array),
        },
      ]);
      expect(later.invoices[0]!.lines.length).toBeGreaterThan(0);
      for (const l of later.invoices[0]!.lines) expect(Object.keys(l).sort()).toEqual(['amountMinor', 'detail', 'label']);
      expect(later.invoices[0]!.lines.reduce((n, l) => n + l.amountMinor, 0)).toBe(505_000);
      // Cleared: both gone from the order.
      clock.advance(MINUTE);
      expect((await orders().setBuyer(o.id, { name: null, address: null }, admin)).buyer).toEqual({ name: null, address: null });
      expect((await auditsOf(o.id, 'order.buyer')).at(-1)!.details).toMatchObject({ cleared: true });
    });
  });

  // ── the ledger ───────────────────────────────────────────────────────────

  describe('the stock ledger', () => {
    it('derives on hand, reserved and available per SKU and location; a transfer is two movements paired; an adjustment or a transfer never takes a reserved piece', async () => {
      const model = await t.db.insertInto('models').values({ category_id: 1, name: 'ORBIT', type: 'PENDANT', sku_prefix: 'ORB-PD' }).returning('id').executeTakeFirstOrThrow();
      const sku = await skuOf(null, model.id);
      await receive(sku, france, 3);
      const held = await salonOrder({ size: null, modelId: model.id });
      expect(held.reservation).toBe('STOCK');
      clock.advance(MINUTE);
      const moved = await stock().transfer({ skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 2, note: 'To the logistics partner.' }, admin);
      expect([moved.from, moved.to]).toEqual([
        { onHand: 1, reserved: 1, available: 0 },
        { onHand: 2, reserved: 0, available: 2 },
      ]);
      const halves = await t.db.selectFrom('stock_movements').select(['location_id', 'delta', 'reason', 'transfer_id', 'note']).where('transfer_id', '=', moved.transferId).orderBy('id').execute();
      expect(halves).toEqual([
        { location_id: france, delta: -2, reason: 'TRANSFER_OUT', transfer_id: moved.transferId, note: 'To the logistics partner.' },
        { location_id: logistics, delta: 2, reason: 'TRANSFER_IN', transfer_id: moved.transferId, note: 'To the logistics partner.' },
      ]);
      expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'stock.transfer').where('target_id', '=', sku).executeTakeFirstOrThrow()).details).toEqual({
        transferId: moved.transferId,
        from: france,
        to: logistics,
        quantity: 2,
        noted: true,
      });
      // The reserved piece stays: nothing more leaves FRANCE.
      await rejects(stock().transfer({ skuId: sku, fromLocationId: france, toLocationId: logistics, quantity: 1 }, admin), 'STOCK_NOT_AVAILABLE', 409);
      await rejects(stock().adjust({ skuId: sku, locationId: france, delta: -1, note: 'Counted.' }, admin), 'STOCK_NOT_AVAILABLE', 409);
      await rejects(stock().adjust({ skuId: sku, locationId: logistics, delta: -3, note: 'Counted.' }, admin), 'STOCK_NOT_AVAILABLE', 409);
      await rejects(stock().adjust({ skuId: sku, locationId: logistics, delta: -1, note: ' ' }, admin), 'VALIDATION_FAILED', 400);
      await rejects(stock().adjust({ skuId: sku, locationId: logistics, delta: 0, note: 'Counted.' }, admin), 'VALIDATION_FAILED', 400);
      await rejects(stock().transfer({ skuId: sku, fromLocationId: logistics, toLocationId: logistics, quantity: 1 }, admin), 'VALIDATION_FAILED', 400);
      await stock().adjust({ skuId: sku, locationId: logistics, delta: -2, note: 'Two pieces damaged.' }, admin);
      expect((await stockBalances(t.db, { skuId: sku })).map((b) => [b.location.name, b.onHand, b.reserved, b.available])).toEqual([
        ['FRANCE WAREHOUSE', 1, 1, 0],
        ['LOGISTICS WAREHOUSE', 0, 0, 0],
      ]);
      expect((await stock().balances({ modelId: model.id }))[0]!.sku).toEqual({ id: sku, code: 'ORB-PD', modelId: model.id, model: 'ORBIT', sizeLabel: null });
    });

    it('stays consistent through a random run of receipts, transfers, adjustments, orders, steps and moves: on hand the sum of the movements, never below what is reserved', async () => {
      const model = await t.db.insertInto('models').values({ category_id: 1, name: 'SPIRAL', type: 'RING', sku_prefix: 'SPI-RG' }).returning('id').executeTakeFirstOrThrow();
      const sizes = ['48', '50'];
      const skus = await Promise.all(sizes.map((s) => skuOf(s, model.id)));
      const places = [france, logistics];
      let seed = 0x5eed;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const open: string[] = [];
      for (let i = 0; i < 60; i++) {
        clock.advance(MINUTE);
        const sku = rnd(2);
        const place = places[rnd(2)]!;
        try {
          switch (rnd(7)) {
            case 0:
              await receive(skus[sku]!, place, 1 + rnd(3));
              break;
            case 1:
              await stock().transfer({ skuId: skus[sku]!, fromLocationId: place, toLocationId: places.find((p) => p !== place)!, quantity: 1 + rnd(2) }, admin);
              break;
            case 2:
              await stock().adjust({ skuId: skus[sku]!, locationId: place, delta: -1, note: 'Counted.' }, admin);
              break;
            case 3:
              open.push((await salonOrder({ size: sizes[sku]!, modelId: model.id, priceMinor: 480_000 })).id);
              break;
            case 4:
              if (open.length) await orders().changeLocation(open[rnd(open.length)]!, place, admin);
              break;
            case 5:
              if (open.length) await orders().transition(open.splice(rnd(open.length), 1)[0]!, { to: 'CANCELLED', note: 'Random.' }, admin);
              break;
            case 6:
              if (open.length) {
                const id = open[rnd(open.length)]!;
                const o = await orderRow(id);
                if (o.status === 'RESERVED') await orders().transition(id, { to: 'PAID' }, admin);
                else if (o.reservation === 'STOCK') {
                  await linkPiece(id);
                  await orders().transition(id, inputFor('SHIPPED'), admin);
                  open.splice(open.indexOf(id), 1);
                }
              }
              break;
          }
        } catch (e) {
          // Refusals are part of the run (nothing available, the same location): never anything else.
          expect(e, String(e)).toBeInstanceOf(DomainError);
          expect(['STOCK_NOT_AVAILABLE', 'VALIDATION_FAILED', 'ORDER_NOT_READY']).toContain((e as DomainError).code);
        }
        for (const [k, skuId] of skus.entries()) {
          for (const loc of places) {
            const level = await stockLevel(t.db, skuId, loc);
            const sum = await t.db.selectFrom('stock_movements').select((eb) => eb.fn.coalesce(eb.fn.sum<number>('delta'), eb.lit(0)).as('n')).where('sku_id', '=', skuId).where('location_id', '=', loc).executeTakeFirstOrThrow();
            expect(level.onHand, `${sizes[k]} ${loc}`).toBe(Number(sum.n));
            expect(level.reserved).toBeLessThanOrEqual(level.onHand);
            expect(level.available).toBeGreaterThanOrEqual(0);
          }
        }
      }
      // Every order RESERVED or PAID holds exactly one thing, and its piece to make is the open one.
      const holding = await t.db.selectFrom('orders').select(['id', 'reservation', 'status']).where('model_id', '=', model.id).where('status', 'in', ['RESERVED', 'PAID']).execute();
      for (const o of holding) {
        const benches = (await benchOf(o.id)).filter((b) => b.status === 'TO_MAKE' || b.status === 'IN_PROGRESS');
        expect(benches.length, o.id).toBe(o.reservation === 'BENCH' ? 1 : 0);
        expect(o.reservation).not.toBeNull();
      }
    });
  });

  // ── the journal ──────────────────────────────────────────────────────────

  describe('the event journal', () => {
    async function everything(): Promise<JournalEntry[]> {
      const all: JournalEntry[] = [];
      for (let after = 0; ; ) {
        const page = await readJournal(t.db, { afterId: after, limit: 200 });
        if (!page.length) return all;
        all.push(...page);
        after = page.at(-1)!.id;
      }
    }

    it('writes each change of an order or a piece once, in order; replayed from its start, it gives back every order, piece to make, piece and stock', async () => {
      const replayed = replayJournal(await everything());
      const rows = await t.db.selectFrom('orders').selectAll().execute();
      expect(rows.length).toBeGreaterThan(20);
      for (const o of rows) {
        expect(replayed.orders.get(o.id), o.id).toEqual(orderPayload(o));
        const events = await eventsOf(o.id);
        expect((await journalOf(o.id)).map((j) => j.type), o.id).toEqual(events.map((e) => e.action));
      }
      expect([...replayed.orders.keys()].sort()).toEqual(rows.map((o) => o.id).sort());
      for (const b of await t.db.selectFrom('bench_items').selectAll().execute()) {
        expect(replayed.benchItems.get(b.id), b.id).toEqual(benchPayload(b));
      }
      expect(replayed.products.size).toBeGreaterThan(10);
      for (const p of await t.db.selectFrom('products').select(['id', 'status']).where('id', 'in', [...replayed.products.keys()]).execute()) {
        expect(replayed.products.get(p.id)!.status, p.id).toBe(p.status);
      }
      // A piece's entries: one per change of its status (each with its history row), and its reservation if it had one.
      const pieceEntries = await t.db.selectFrom('event_journal').select(['entity_id', 'type']).where('entity_type', '=', 'product').execute();
      const history = await t.db.selectFrom('product_status_history').select('product_id').execute();
      const reserved = await t.db.selectFrom('bench_items').select('product_id').execute();
      const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>());
      expect(count(pieceEntries.filter((e) => e.type !== 'product.reserve'), (e) => e.entity_id)).toEqual(count(history, (h) => h.product_id));
      expect(count(pieceEntries.filter((e) => e.type === 'product.reserve'), (e) => e.entity_id)).toEqual(count(reserved, (b) => b.product_id));
      for (const e of await everything()) if (e.entityType === 'product') expect(Object.keys(e.payload).sort()).toEqual(['at', 'id', 'modelId', 'productId', 'sizeLabel', 'skuId', 'status']);
      const balances = await stockBalances(t.db);
      for (const b of balances) expect(replayed.stock.get(stockKey(b.sku.id, b.location.id)) ?? 0, `${b.sku.code} ${b.location.name}`).toBe(b.onHand);
      // Nothing personal in it: no buyer, no engraving text.
      for (const e of await everything()) {
        expect(Object.keys(e.payload)).not.toContain('buyerName');
        expect(Object.keys(e.payload)).not.toContain('engravingText');
      }
    });

    it('is read by each connection in turn: what it has not consumed, acknowledged once, never changed otherwise', async () => {
      const first = await readJournal(t.db, { unconsumedBy: 'shopify', limit: 5 });
      expect(first).toHaveLength(5);
      expect(await acknowledgeJournal(t.db, 'shopify', first.map((e) => e.id))).toBe(5);
      expect(await acknowledgeJournal(t.db, 'shopify', first.map((e) => e.id))).toBe(0);
      const next = await readJournal(t.db, { unconsumedBy: 'shopify', limit: 5 });
      expect(next.map((e) => e.id)).not.toContain(first[0]!.id);
      expect((await readJournal(t.db, { unconsumedBy: 'accountant', limit: 1 }))[0]!.id).toBe(first[0]!.id);
      expect((await readJournal(t.db, { afterId: first[0]!.id - 1, limit: 1 }))[0]!.consumedBy).toEqual(['shopify']);
      await rejects(readJournal(t.db, { unconsumedBy: 'Shopify!' }), 'VALIDATION_FAILED');
      await rejects(readJournal(t.db, { limit: 1001 }), 'VALIDATION_FAILED');
      await rejects(acknowledgeJournal(t.db, 'shopify', [0]), 'VALIDATION_FAILED');
    });
  });

  // ── after the atelier links a piece (step S2) ────────────────────────────

  describe('once a piece is linked to its order', () => {
    it('DELIVERED by itself when its buyer registers the piece linked to it while SHIPPED; never another account, never before SHIPPED', async () => {
      const buyer = await createAccount(t.db);
      const sku = await skuOf('76');
      await receive(sku, france, 3);
      const issue = () => ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '76', material: '925 STERLING SILVER', withClaimSecret: true }, admin);
      // Its warranty activated at the sale, the piece registered by its buyer.
      const register = async (accountId: string, p: Awaited<ReturnType<typeof issue>>) => {
        await ctx.services.warranty.activate(p.product.id, { purchaseDate: '2026-11-01', retailer: 'ORBES PARIS', country: 'FR' }, admin);
        const scan = await ctx.services.verification.verify({ code: p.code.data }, {});
        return ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode: p.claimCode! }, { type: 'account', id: accountId });
      };
      // The atelier picks each order's piece from the stock before it ships. Registered by another account, or before
      // the order is shipped, nothing changes.
      const [p1, p2, p3] = [await issue(), await issue(), await issue()];
      const linkedTo = async (p: Awaited<ReturnType<typeof issue>>, steps: OrderStatus[]) => {
        const o = await walk((await salonOrder({ size: '76', accountId: buyer.id, priceMinor: 480_000 })).id, ['PAID']);
        await ctx.services.atelier.linkFromStock(o.id, p.product.productId, admin);
        return walk(o.id, steps);
      };
      const shipped = await linkedTo(p1, ['SHIPPED']);
      const other = await linkedTo(p3, ['SHIPPED']);
      const paid = await linkedTo(p2, []);
      expect([shipped.product_id, other.product_id, paid.product_id]).toEqual([p1.product.id, p3.product.id, p2.product.id]);
      const stranger = await createAccount(t.db);
      clock.advance(MINUTE);
      await register(stranger.id, p3);
      await register(buyer.id, p2);
      expect([(await orderRow(other.id)).status, (await orderRow(paid.id)).status]).toEqual(['SHIPPED', 'PAID']);
      clock.advance(MINUTE);
      await register(buyer.id, p1);
      const delivered = await orderRow(shipped.id);
      expect([delivered.status, delivered.delivered_at]).toEqual(['DELIVERED', clock.now()]);
      expect((await eventsOf(shipped.id)).at(-1)).toMatchObject({ action: 'order.deliver', status: 'DELIVERED', actor_type: 'account', actor_id: buyer.id, details: { by: 'registration' } });
      expect((await auditsOf(shipped.id, 'order.deliver'))[0]).toMatchObject({ actor_type: 'account', details: { from: 'SHIPPED', to: 'DELIVERED', by: 'registration' } });
      expect((await journalOf(shipped.id)).at(-1)!.type).toBe('order.deliver');
      expect((await t.db.selectFrom('ownership').select('account_id').where('product_id', '=', p1.product.id).where('ended_at', 'is', null).executeTakeFirstOrThrow()).account_id).toBe(buyer.id);
    });

  });
});
