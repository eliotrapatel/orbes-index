/**
 * Add-ons on orders (macro scope of 2026-10-20, K48 D1 and D2; plan MACRO M3 §4.1, §4.2 and §4.5, step M3.10;
 * services/order-addons.ts), on the services as createContext wires them:
 *
 *  - chosen on a LIVE hold (`items`), refused beyond 3 (ADDON_LIMIT), beyond what is available (ADDON_OUT_OF_STOCK),
 *    without a price in the release's currency or set aside (ADDON_NOT_OFFERED); carried onto the sale's first order at
 *    PAY, one left out when none is left (NONE_LEFT), never blocking the sale; the choices then deleted; the entry reads
 *    them before and after; never a product row, never an ownership, the tier unchanged;
 *  - a draw's place held (SELECTED) and a salon request: chosen, carried at CONFIRMED and ACCEPTED, cleared at LAPSED;
 *    the salon's units in the model's base currency, the piece's price then entered in it (ORDER_ADDON_CURRENCY);
 *  - YOUR ORDERS: what can be added now, added before PAID (an ADD_ON_ITEM line of the invoice at PAID), after PAID (a
 *    supplementary invoice), removed after PAID (a credit note for its line); refused once packing starts, on a welcome
 *    gift, a size exchange and a Shopify order, without a currency, closed, for a locked account;
 *  - staff add and remove until SHIPPED;
 *  - the life: cancel releases, ship moves −1 per unit, a return takes them back (`returned_to_stock`), a size exchange
 *    leaves them with the collector (billed again on its EXCHANGE order), a location change moves them or is refused
 *    (ORDER_ADDON_NOT_AT_LOCATION);
 *  - packing: one checklist line per add-on, the parcel's weight with each unit's;
 *  - the journal `order.addon.add` / `.remove`, the order CSV's line items, the account's export.
 * The routes are test/api/account-orders.test.ts's, admin-orders.test.ts's, the-club's, live's and salon's.
 * CI: test/services/order-addons.test.ts on PostgreSQL > two orders take the last unit of an add-on at once.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { addonWindow, setChoices } from '../../src/server/services/order-addons.js';
import { tierOf } from '../../src/server/services/club.js';
import { ensureSku, stockLevel } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { scanIntoParcel } from '../support/fulfil.js';
import { jpegPhoto } from '../support/images.js';
import { accountOfTier, createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { poolDraw } from '../support/draws.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('add-ons on orders (plan MACRO M3 §4.2, D1 and D2)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let france: string;
  let logistics: string;
  let colissimo: string;
  /** POLISHING CLOTH (EUR 15, 20 g), CHAIN EXTENDER (EUR 30, 15 g), SPARE STRAP (EUR 25, no weight), TRAVEL POUCH (CHF only). */
  let cloth: { id: string; skuId: string };
  let extender: { id: string; skuId: string };
  let strap: { id: string; skuId: string };
  let pouch: { id: string; skuId: string };

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
    const make = async (name: string, skuCode: string, prices: Record<string, number>, weightG: number | null) => {
      const a = await ctx.services.addons.create({ name, skuCode, prices, weightG }, admin);
      return { id: a.id, skuId: a.sku.id };
    };
    cloth = await make('POLISHING CLOTH', 'ADD-CLOTH', { EUR: 1500 }, 20);
    extender = await make('CHAIN EXTENDER', 'ADD-EXT', { EUR: 3000 }, 15);
    strap = await make('SPARE STRAP', 'ADD-STRAP', { EUR: 2500 }, null);
    pouch = await make('TRAVEL POUCH', 'ADD-POUCH', { CHF: 2000 }, 30);
    await countIn(cloth.skuId, france, 20);
    await countIn(extender.skuId, france, 1);
    await countIn(strap.skuId, france, 5);
    await countIn(pouch.skuId, france, 5);
  });
  afterAll(async () => {
    await ctx?.close();
    await t?.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  const orders = () => ctx.services.orders;
  const addons = () => ctx.services.orderAddons;
  function countIn(skuId: string, locationId: string, n: number) {
    return ctx.services.stock.adjust({ skuId, locationId, delta: n, note: 'Counted.' }, admin);
  }
  const available = async (skuId: string, locationId = france) => (await stockLevel(t.db, skuId, locationId)).available;
  const onHand = async (skuId: string, locationId = france) => (await stockLevel(t.db, skuId, locationId)).onHand;
  const unitsOf = (orderId: string) => t.db.selectFrom('order_addon_items').selectAll().where('order_id', '=', orderId).orderBy('added_at').orderBy('id').execute();
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const invoicesOf = (orderId: string) => t.db.selectFrom('invoices').selectAll().where('order_id', '=', orderId).orderBy('issued_at').orderBy('kind', 'desc').orderBy('sequence').execute();
  const linesOf = (i: { lines: unknown }) => (i.lines as { kind: string; label: string; amountMinor: number }[]).map((l) => [l.kind, l.label, l.amountMinor]);
  const eventsOf = (orderId: string) => t.db.selectFrom('order_events').select(['action', 'details']).where('order_id', '=', orderId).orderBy('id').execute();

  /** Each sale in a size of its own, so that a piece counted in serves its order, never an older one waiting. */
  let sizes = 60;
  /** A LIVE sale as a collector lives it, its catalogue add-ons chosen at the hold (`before` runs between the choice and PAY). */
  async function liveSale(o: { items?: { addonId: string; units: number }[]; before?: () => Promise<void>; price?: number; quantity?: number } = {}) {
    const quantity = o.quantity ?? 1;
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: String(sizes++), stock: 5 }], perAccount: quantity, ...(o.price !== undefined ? { priceMinor: o.price } : {}) });
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    const held = o.items ? await f.live.setAddons(a.id, r.id, [], a.actor, o.items) : null;
    if (o.before) await o.before();
    const confirmed = await f.live.confirm(a.id, r.id, a.actor);
    const entry = await t.db.selectFrom('live_entries').selectAll().where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const rows = await t.db.selectFrom('orders').selectAll().where('live_entry_id', '=', entry.id).orderBy('piece').execute();
    return { release: r, account: a, entry, orders: rows, held, confirmed };
  }

  /** A salon request accepted with its add-ons chosen (in the model's base currency), its order. */
  async function salonOrder(items: { addonId: string; units: number }[], o: { modelId?: string; before?: () => Promise<void> } = {}) {
    const account = await createAccount(t.db);
    const request = await t.db.insertInto('shop_requests').values({ account_id: account.id, model_id: o.modelId ?? f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    if (items.length) await inTransaction(t.db, (tx) => setChoices(tx, { shopRequestId: request.id }, items, { locationId: france, currency: 'EUR' }, clock.now()));
    if (o.before) await o.before();
    clock.advance(1000);
    const closed = await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const order = await t.db.selectFrom('orders').selectAll().where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    return { account, request, closed, order };
  }

  /** The piece that fulfils a paid order holding one in stock, bound by the packing scan (as orders.test.ts). */
  async function linkPiece(orderId: string) {
    const o = await orderRow(orderId);
    if (o.product_id !== null || o.reservation !== 'STOCK' || o.status !== 'PAID') return;
    const sku = await t.db.selectFrom('skus').select(['size_label']).where('id', '=', o.sku_id!).executeTakeFirstOrThrow();
    const { product } = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: o.model_id, ...(sku.size_label !== null ? { variant: sku.size_label } : {}), material: '925 STERLING SILVER' }, admin);
    await ctx.services.logistics.countIn(o.sku_id!, { productRefs: [product.productId], note: 'On the shelf.' }, admin);
    await scanIntoParcel(ctx, orderId, { pieces: { [orderId]: product.productId } }, admin);
  }

  /** Packed through the agent's steps (every line ticked) and shipped. */
  async function packAndShip(orderId: string) {
    await linkPiece(orderId);
    await ctx.services.logistics.setPhoto(orderId, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, admin, null);
    const view = await ctx.services.logistics.parcel(orderId, null);
    await ctx.services.logistics.checkPacked(orderId, { ticked: view.checklist.filter((l) => !l.byScan).map((l) => l.key) }, admin, null);
    await ctx.services.logistics.ship(orderId, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin, null);
  }

  /** A piece of the order's SKU counted in, so the order holds STOCK. */
  async function stockFor(orderId: string) {
    const o = await orderRow(orderId);
    if (o.sku_id && o.reservation !== 'STOCK') await countIn(o.sku_id, o.location_id, 1);
  }

  // ── LIVE ─────────────────────────────────────────────────────────────────

  it('LIVE: chosen at the hold (each checked), carried at PAY onto the first order, one left out when none is left; the choices deleted; never a piece, an ownership nor the tier', async () => {
    let refusals: unknown[] = [];
    const before = { cloth: await available(cloth.skuId), extender: await available(extender.skuId) };
    const sale = await liveSale({
      quantity: 2,
      items: [
        { addonId: cloth.id, units: 2 },
        { addonId: extender.id, units: 1 },
      ],
      before: async () => {
        const e = (await t.db.selectFrom('live_entries').select(['drop_id', 'account_id']).where('status', '=', 'SECURED').executeTakeFirstOrThrow());
        const actor: Actor = { type: 'account', id: e.account_id };
        refusals = [
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [], actor, [{ addonId: cloth.id, units: 4 }])),
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [], actor, [{ addonId: extender.id, units: 2 }])),
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [], actor, [{ addonId: pouch.id, units: 1 }])),
        ];
        // Its view while held: the choice, its prices and the total, and what is offered (the pouch is priced in CHF only).
        const view = (await f.live.entry(e.account_id, e.drop_id))!;
        expect(view.addonItems).toEqual([
          { addonId: cloth.id, name: 'POLISHING CLOTH', line: null, units: 2, priceMinor: 1500 },
          { addonId: extender.id, name: 'CHAIN EXTENDER', line: null, units: 1, priceMinor: 3000 },
        ]);
        expect(view.totalMinor).toBe(2 * 505_000 + 2 * 1500 + 3000);
        expect(view.addonOffer.map((a) => [a.name, a.maxUnits])).toEqual([
          ['POLISHING CLOTH', 3],
          ['CHAIN EXTENDER', 1],
          ['SPARE STRAP', 3],
        ]);
        // Nothing is held before PAY.
        expect(await available(cloth.skuId)).toBe(before.cloth);
        // The last extender goes elsewhere meanwhile: it is left out at PAY, never blocking it.
        await ctx.services.stock.adjust({ skuId: extender.skuId, locationId: france, delta: -1, note: 'Damaged.' }, admin);
      },
    });
    expect(refusals).toEqual([
      { code: 'ADDON_LIMIT', status: 409, message: 'At most 3 of each add-on on an order.' },
      { code: 'ADDON_OUT_OF_STOCK', status: 409, message: 'CHAIN EXTENDER could not be added: none left.' },
      { code: 'ADDON_NOT_OFFERED', status: 409, message: 'TRAVEL POUCH is not offered here.' },
    ]);
    expect(sale.confirmed.addonsLeftOut).toEqual([{ addonId: extender.id, name: 'CHAIN EXTENDER', units: 1, reason: 'NONE_LEFT' }]);
    const [first, second] = sale.orders;
    // On the first order only, each unit held at the release's location at its price.
    expect((await unitsOf(first!.id)).map((u) => [u.addon_id, u.status, u.price_minor, u.currency, u.added_by_type, u.added_by, u.location_id])).toEqual([
      [cloth.id, 'HELD', 1500, 'EUR', 'PURCHASE', null, france],
      [cloth.id, 'HELD', 1500, 'EUR', 'PURCHASE', null, france],
    ]);
    expect(await unitsOf(second!.id)).toEqual([]);
    expect(await available(cloth.skuId)).toBe(before.cloth - 2);
    expect(await t.db.selectFrom('addon_choices').select('id').where('live_entry_id', '=', sale.entry.id).execute()).toEqual([]);
    // The entry after PAY reads what its order carries.
    expect((await f.live.entry(sale.account.id, sale.release.id))!.addonItems).toEqual([{ addonId: cloth.id, name: 'POLISHING CLOTH', line: null, units: 2, priceMinor: 1500 }]);
    // Its journal and audit entries.
    const journal = await t.db.selectFrom('event_journal').select(['type', 'payload']).where('entity_id', '=', first!.id).where('type', '=', 'order.addon.add').execute();
    expect(journal.map((j) => (j.payload as { addon: unknown }).addon)).toEqual([
      { addonId: cloth.id, units: 2, unitIds: expect.any(Array), priceMinor: 1500, currency: 'EUR', by: 'purchase' },
    ]);
    const confirm = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.confirm').where('target_id', '=', sale.release.id).executeTakeFirstOrThrow();
    expect(confirm.details).toMatchObject({ addonsLeftOut: [{ addonId: extender.id, units: 1, reason: 'NONE_LEFT' }] });
    // No identity: never a product row, never an ownership; the tier reads pieces only.
    expect(await t.db.selectFrom('products').select('id').where('sku_id', 'in', [cloth.skuId, extender.skuId]).execute()).toEqual([]);
    expect((await tierOf(t.db, sale.account.id, clock.now())).tier).toBe(0);
    await countIn(extender.skuId, france, 3);
  });

  // ── YOUR ORDERS ──────────────────────────────────────────────────────────

  it('YOUR ORDERS: offered and added before PAID (lines of the invoice at PAID), after PAID (a supplementary invoice), removed after PAID (a credit note for its line); the order reads them', async () => {
    const { account, orders: [o] } = await liveSale();
    const offer = await addons().offerForAccount(account.id, o!.id);
    expect(offer).toMatchObject({ canAdd: true, reason: null, paid: false, currency: 'EUR' });
    expect(offer.offer.map((a) => [a.name, a.priceMinor, a.maxUnits])).toEqual([
      ['POLISHING CLOTH', 1500, 3],
      ['CHAIN EXTENDER', 3000, 3],
      ['SPARE STRAP', 2500, 3],
    ]);
    await addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 2 }, account.actor);
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 2 }, account.actor))).toMatchObject({ code: 'ADDON_LIMIT', status: 409 });
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: pouch.id, units: 1 }, account.actor))).toMatchObject({ code: 'ADDON_NOT_OFFERED', status: 409 });
    expect((await addons().offerForAccount(account.id, o!.id)).offer.find((a) => a.addonId === cloth.id)!.maxUnits).toBe(1);
    const read = await orders().accountOrder(account.id, o!.id);
    expect(read.addonItems).toEqual([{ addonId: cloth.id, name: 'POLISHING CLOTH', units: 2, priceMinor: 1500, currency: 'EUR', canRemove: true }]);
    expect(read.canAddAddons).toBe(true);
    // PAID: its two units are lines of the invoice.
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    const [invoice] = await invoicesOf(o!.id);
    expect(linesOf(invoice!)).toEqual([
      ['PIECE', `MONOLITHE · SIZE ${(await orderRow(o!.id)).size_label}`, 505_000],
      ['ADD_ON_ITEM', 'POLISHING CLOTH', 1500],
      ['ADD_ON_ITEM', 'POLISHING CLOTH', 1500],
    ]);
    expect(invoice!.total_minor).toBe(508_000);
    // After PAID, an extender: its own supplementary invoice, named on the unit.
    clock.advance(MINUTE);
    await addons().addForAccount(account.id, o!.id, { addonId: extender.id, units: 1 }, account.actor);
    const docs = await invoicesOf(o!.id);
    const supplement = docs.find((d) => d.supplements_invoice_id === invoice!.id)!;
    expect(linesOf(supplement)).toEqual([['ADD_ON_ITEM', 'CHAIN EXTENDER', 3000]]);
    expect((await unitsOf(o!.id)).find((u) => u.addon_id === extender.id)!.invoice_id).toBe(supplement.id);
    expect((await addons().offerForAccount(account.id, o!.id)).paid).toBe(true);
    // Removed after PAID: one credit note for its two lines, on the order's invoice; the extender's on its supplement.
    clock.advance(MINUTE);
    await addons().removeForAccount(account.id, o!.id, cloth.id, account.actor);
    await addons().removeForAccount(account.id, o!.id, extender.id, account.actor);
    const notes = (await invoicesOf(o!.id)).filter((d) => d.kind === 'CREDIT_NOTE');
    expect(notes.map((n) => [n.credit_scope, n.credits_invoice_id, linesOf(n)])).toEqual([
      ['LINES', invoice!.id, [['ADD_ON_ITEM', 'POLISHING CLOTH', 1500], ['ADD_ON_ITEM', 'POLISHING CLOTH', 1500]]],
      ['LINES', supplement.id, [['ADD_ON_ITEM', 'CHAIN EXTENDER', 3000]]],
    ]);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['REMOVED', 'REMOVED', 'REMOVED']);
    expect((await orders().accountOrder(account.id, o!.id)).addonItems).toEqual([]);
    expect(await refusal(addons().removeForAccount(account.id, o!.id, cloth.id, account.actor))).toMatchObject({ code: 'ADDON_NOT_FOUND', status: 404 });
    expect((await eventsOf(o!.id)).filter((e) => e.action.startsWith('order.addon.')).map((e) => [e.action, (e.details as { by: string }).by])).toEqual([
      ['order.addon.add', 'collector'],
      ['order.addon.add', 'collector'],
      ['order.addon.remove', 'collector'],
      ['order.addon.remove', 'collector'],
    ]);
    // Another account's order is not found.
    const other = await createAccount(t.db);
    expect(await refusal(addons().addForAccount(other.id, o!.id, { addonId: cloth.id, units: 1 }, other.actor))).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
  });

  it('YOUR ORDERS: none once packing starts, closed, without a currency, on a welcome gift, a size exchange or a Shopify order, beyond the stock, for a locked account', async () => {
    const { account, orders: [o] } = await liveSale();
    const extenders = await available(extender.skuId);
    if (extenders !== 1) await ctx.services.stock.adjust({ skuId: extender.skuId, locationId: france, delta: 1 - extenders, note: 'Counted.' }, admin);
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: extender.id, units: 2 }, account.actor))).toEqual({ code: 'ADDON_OUT_OF_STOCK', status: 409, message: 'CHAIN EXTENDER could not be added: none left.' });
    await countIn(extender.skuId, france, 4);
    // Packing begun (once paid).
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    await t.db.updateTable('orders').set({ packing_started_at: clock.now() }).where('id', '=', o!.id).execute();
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 1 }, account.actor))).toMatchObject({ code: 'ORDER_PACKING_STARTED', status: 409 });
    expect(await addons().offerForAccount(account.id, o!.id)).toEqual({ canAdd: false, reason: 'PACKING_STARTED', paid: true, currency: 'EUR', offer: [] });
    // A Shopify order.
    await t.db.updateTable('orders').set({ packing_started_at: null, shopify_order_id: '4501' }).where('id', '=', o!.id).execute();
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 1 }, account.actor))).toEqual({ code: 'ADDON_NOT_OFFERED', status: 409, message: 'Add-ons are not offered on this order.' });
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(false);
    await t.db.updateTable('orders').set({ shopify_order_id: null }).where('id', '=', o!.id).execute();
    // A locked account.
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', account.id).execute();
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 1 }, account.actor))).toMatchObject({ code: 'ACCOUNT_LOCKED', status: 403 });
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', account.id).execute();
    // Closed.
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    expect(await refusal(addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 1 }, account.actor))).toMatchObject({ code: 'ORDER_CLOSED', status: 409 });
    // A salon order whose currency is not entered yet takes none from YOUR ORDERS.
    const salon = await salonOrder([]);
    expect(await refusal(addons().addForAccount(salon.account.id, salon.order.id, { addonId: cloth.id, units: 1 }, salon.account.actor))).toMatchObject({ code: 'ADDON_NOT_OFFERED', status: 409 });
    expect((await addons().offerForAccount(salon.account.id, salon.order.id)).reason).toBe('NO_CURRENCY');
    expect((await addons().offerForAccount(account.id, o!.id)).reason).toBe('CLOSED');
    // A welcome gift and a size exchange: none (a size exchange's own case is the exchange test's).
    for (const channel of ['GIFT', 'EXCHANGE'] as const) {
      expect(addonWindow({ channel, status: 'PAID', packing_started_at: null, shopify_order_id: null, currency: 'EUR' })).toBe('NOT_OFFERED');
    }
  });

  // ── Staff ────────────────────────────────────────────────────────────────

  it('staff add and remove until SHIPPED, packing begun or not; a unit removed by its id; cancel releases what it held', async () => {
    const { orders: [o] } = await liveSale();
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    await t.db.updateTable('orders').set({ packing_started_at: clock.now() }).where('id', '=', o!.id).execute();
    const before = await available(strap.skuId);
    await addons().addForStaff(o!.id, { addonId: strap.id, units: 2 }, admin);
    const view = await orders().get(o!.id);
    expect(view.addonItems.map((u) => [u.addon.name, u.skuCode, u.status, u.addedBy.type, u.addedBy.id, u.location.name])).toEqual([
      ['SPARE STRAP', 'ADD-STRAP', 'HELD', 'STAFF', admin.id, 'FRANCE WAREHOUSE'],
      ['SPARE STRAP', 'ADD-STRAP', 'HELD', 'STAFF', admin.id, 'FRANCE WAREHOUSE'],
    ]);
    expect(await available(strap.skuId)).toBe(before - 2);
    await addons().removeForStaff(o!.id, view.addonItems[0]!.id, admin);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['REMOVED', 'HELD']);
    expect(await refusal(addons().removeForStaff(o!.id, view.addonItems[0]!.id, admin))).toMatchObject({ code: 'ADDON_NOT_FOUND', status: 404 });
    expect(await refusal(addons().addForStaff(o!.id, { addonId: strap.id, units: 1 }, { type: 'account', id: o!.account_id }))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    // Cancelled: the unit held is cancelled with it, the stock free again.
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'CANCELLED', note: 'The client withdrew.' }, admin);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['REMOVED', 'CANCELLED']);
    expect(await available(strap.skuId)).toBe(before);
    expect(await refusal(addons().addForStaff(o!.id, { addonId: strap.id, units: 1 }, admin))).toMatchObject({ code: 'ORDER_CLOSED', status: 409 });
  });

  // ── Packing, shipping, returning ─────────────────────────────────────────

  it('packed with the order (one checklist line per add-on, its weight in the parcel\'s), shipped −1 per unit, returned with returned_to_stock, credited in full', async () => {
    const { account, orders: [o] } = await liveSale({ items: [{ addonId: cloth.id, units: 2 }] });
    await countIn(extender.skuId, france, 1);
    clock.advance(1000);
    await addons().addForStaff(o!.id, { addonId: extender.id, units: 1 }, admin);
    await stockFor(o!.id);
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    // The model packs at 40 g in a box of 100 g.
    const box = await ctx.services.boxes.create({ name: `CUBE ${o!.id.slice(0, 4)}`, insideLengthMm: 120, insideWidthMm: 100, insideHeightMm: 40, emptyWeightG: 100 }, admin);
    await ctx.services.catalog.setModelPacking(f.modelId, { boxId: box.id, packedWeightG: 40 }, admin);
    await linkPiece(o!.id);
    const parcel = await ctx.services.logistics.parcel(o!.id, null);
    expect(parcel.checklist.filter((l) => l.key.startsWith('addon-item:')).map((l) => [l.key, l.label])).toEqual([
      [`addon-item:${o!.id}:${cloth.id}`, 'Add-on: POLISHING CLOTH × 2'],
      [`addon-item:${o!.id}:${extender.id}`, 'Add-on: CHAIN EXTENDER × 1'],
    ]);
    expect(parcel.orders[0]!.addonItems).toEqual([
      { name: 'POLISHING CLOTH', units: 2 },
      { name: 'CHAIN EXTENDER', units: 1 },
    ]);
    expect(parcel.packing.weightG).toBe(100 + 40 + 2 * 20 + 15);
    // A line left unticked: not packed.
    await ctx.services.logistics.setPhoto(o!.id, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, admin, null);
    expect(await refusal(ctx.services.logistics.checkPacked(o!.id, { ticked: parcel.checklist.filter((l) => !l.byScan && l.key !== `addon-item:${o!.id}:${cloth.id}`).map((l) => l.key) }, admin, null))).toMatchObject({ code: 'PACKING_INCOMPLETE' });
    const before = { cloth: await onHand(cloth.skuId), extender: await onHand(extender.skuId) };
    await packAndShip(o!.id);
    expect((await t.db.selectFrom('shipments').select('weight_g').where('order_id', '=', o!.id).executeTakeFirstOrThrow()).weight_g).toBe(195);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['SHIPPED', 'SHIPPED', 'SHIPPED']);
    expect([await onHand(cloth.skuId), await onHand(extender.skuId)]).toEqual([before.cloth - 2, before.extender - 1]);
    const moves = await t.db.selectFrom('stock_movements').select(['reason', 'delta', 'order_addon_item_id', 'product_id']).where('order_id', '=', o!.id).where('order_addon_item_id', 'is not', null).execute();
    expect(moves.map((m) => [m.reason, m.delta, m.product_id])).toEqual([
      ['SHIPPED', -1, null],
      ['SHIPPED', -1, null],
      ['SHIPPED', -1, null],
    ]);
    // Returned (a refund): the extender not to be sold again, the cloths back to stock at the return's location.
    clock.advance(MINUTE);
    const extenderUnit = (await unitsOf(o!.id)).find((u) => u.addon_id === extender.id)!;
    await orders().returnOrder(o!.id, { outcome: 'RESTOCKED', locationId: logistics, note: 'Returned.', addonsOut: [extenderUnit.id] }, admin);
    expect((await unitsOf(o!.id)).map((u) => [u.addon_id, u.status, u.returned_to_stock])).toEqual([
      [cloth.id, 'RETURNED', true],
      [cloth.id, 'RETURNED', true],
      [extender.id, 'RETURNED', false],
    ]);
    expect(await onHand(cloth.skuId, logistics)).toBe(2);
    expect(await onHand(extender.skuId, logistics)).toBe(0);
    // Its invoice credited in full, the add-on lines with it.
    const full = (await invoicesOf(o!.id)).find((d) => d.kind === 'CREDIT_NOTE')!;
    expect(full.credit_scope).toBe('FULL');
    expect(linesOf(full).filter((l) => l[0] === 'ADD_ON_ITEM')).toEqual([
      ['ADD_ON_ITEM', 'POLISHING CLOTH', 1500],
      ['ADD_ON_ITEM', 'POLISHING CLOTH', 1500],
      ['ADD_ON_ITEM', 'CHAIN EXTENDER', 3000],
    ]);
    // The account's export and the order CSV.
    const exported = (await ctx.services.owners.exportData(account.id, admin)).orders.find((x) => x.reference === `OR-${o!.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`)!;
    expect(exported.addonItems.map((u) => [u.name, u.status])).toEqual([
      ['POLISHING CLOTH', 'RETURNED'],
      ['POLISHING CLOTH', 'RETURNED'],
      ['CHAIN EXTENDER', 'RETURNED'],
    ]);
    const day = o!.reserved_at.toISOString().slice(0, 10);
    const csv = (await ctx.services.shopify.orderCsv({ from: day, to: day }, { email: (e) => e, buyer: (b) => b })).body;
    expect(csv).toContain('"POLISHING CLOTH","15.00","ADD-CLOTH","true"');
    expect(csv).toContain('"CHAIN EXTENDER","30.00","ADD-EXT","true"');
  });

  it('a size exchange leaves the add-ons with the collector: its EXCHANGE order bills them again, as its original\'s return credits them', async () => {
    const { orders: [o] } = await liveSale({ items: [{ addonId: cloth.id, units: 1 }] });
    await stockFor(o!.id);
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    await packAndShip(o!.id);
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'DELIVERED' }, admin);
    const to = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '54'));
    await countIn(to, france, 1);
    const opened = await ctx.services.orderCases.open(o!.id, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: to, note: 'Too small.' }, admin);
    await ctx.services.orderCases.receive(opened.id, { pieceState: 'OK' }, admin, null);
    clock.advance(MINUTE);
    const decided = await ctx.services.orderCases.decide(opened.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged.' }, admin, { admin: true });
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['SHIPPED']);
    const exchange = decided.case.decision!.exchangeOrder!.id;
    const [invoice] = (await invoicesOf(exchange)).filter((d) => d.kind === 'INVOICE');
    expect(linesOf(invoice!).filter((l) => l[0] === 'ADD_ON_ITEM')).toEqual([['ADD_ON_ITEM', 'POLISHING CLOTH', 1500]]);
    expect(await addons().offerForAccount((await orderRow(exchange)).account_id, exchange)).toMatchObject({ canAdd: false, reason: 'NOT_OFFERED' });
  });

  // ── Location ─────────────────────────────────────────────────────────────

  it('a location change moves the units held with the order, or is refused when the new location has none (ORDER_ADDON_NOT_AT_LOCATION)', async () => {
    const { orders: [o] } = await liveSale({ items: [{ addonId: cloth.id, units: 1 }] });
    const there = await available(cloth.skuId, logistics);
    if (there > 0) await ctx.services.stock.adjust({ skuId: cloth.skuId, locationId: logistics, delta: -there, note: 'Moved.' }, admin);
    expect(await refusal(orders().changeLocation(o!.id, logistics, admin))).toEqual({
      code: 'ORDER_ADDON_NOT_AT_LOCATION',
      status: 409,
      message: 'POLISHING CLOTH is not in stock at the new location: move its stock there first, or remove the add-on.',
    });
    expect((await orderRow(o!.id)).location_id).toBe(france);
    await countIn(cloth.skuId, logistics, 1);
    const atLogistics = await available(cloth.skuId, logistics);
    await orders().changeLocation(o!.id, logistics, admin);
    expect((await unitsOf(o!.id)).map((u) => u.location_id)).toEqual([logistics]);
    expect(await available(cloth.skuId, logistics)).toBe(atLogistics - 1);
  });

  // ── A draw's place held ──────────────────────────────────────────────────

  it('a draw: chosen on a SELECTED entry of a priced draw, carried at CONFIRMED; none chosen before the place is held; a lapsed place clears them', async () => {
    const T = new Date(clock.now().getTime() + HOUR);
    const d = await poolDraw(f.drops, t.db, { modelId: f.modelId, title: 'A priced draw', quantity: 2, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0, priceMinor: 480_000, currency: 'EUR' }, admin);
    const a = await createAccount(t.db);
    const b = await createAccount(t.db);
    clock.set(new Date(T.getTime() + MINUTE));
    await f.drops.enter(a.id, d.id, a.actor);
    await f.drops.enter(b.id, d.id, b.actor);
    expect(await refusal(f.drops.setAddonChoices(a.id, d.id, [{ addonId: cloth.id, units: 1 }], a.actor))).toMatchObject({ code: 'DROP_ENTRY_NOT_SELECTED', status: 409 });
    expect((await f.drops.entryFor(a.id, d.id)).addons).toBeNull();
    clock.set(new Date(T.getTime() + 2 * HOUR));
    await f.drops.draw(d.id, admin);
    const held = await f.drops.setAddonChoices(a.id, d.id, [{ addonId: cloth.id, units: 3 }], a.actor);
    expect(held.addons).toMatchObject({ currency: 'EUR', chosen: [{ addonId: cloth.id, name: 'POLISHING CLOTH', units: 3, priceMinor: 1500 }] });
    await f.drops.setAddonChoices(b.id, d.id, [{ addonId: strap.id, units: 1 }], b.actor);
    const entries = await t.db.selectFrom('drop_entries').select(['id', 'account_id']).where('drop_id', '=', d.id).execute();
    const ea = entries.find((e) => e.account_id === a.id)!.id;
    const eb = entries.find((e) => e.account_id === b.id)!.id;
    // Confirm shows the choices; the order then carries them.
    const listed = await f.drops.entries(d.id, {}, { page: 1, pageSize: 10 });
    expect(listed.items.find((e) => e.id === ea)!.addonChoices.map((c) => [c.name, c.units])).toEqual([['POLISHING CLOTH', 3]]);
    const confirmed = await f.drops.confirm(d.id, ea, null, admin);
    expect(confirmed.addonsLeftOut).toBeUndefined();
    const order = await t.db.selectFrom('orders').selectAll().where('drop_entry_id', '=', ea).executeTakeFirstOrThrow();
    expect((await unitsOf(order.id)).map((u) => [u.addon_id, u.price_minor, u.currency])).toEqual([
      [cloth.id, 1500, 'EUR'],
      [cloth.id, 1500, 'EUR'],
      [cloth.id, 1500, 'EUR'],
    ]);
    expect(await t.db.selectFrom('addon_choices').select('id').where('drop_entry_id', '=', ea).execute()).toEqual([]);
    // The other place lapses: its choice goes.
    clock.set(new Date(T.getTime() + 2 * HOUR + 49 * HOUR));
    await f.drops.lapse(d.id, eb, null, admin);
    expect(await t.db.selectFrom('addon_choices').select('id').where('drop_entry_id', '=', eb).execute()).toEqual([]);
  });

  // ── A salon request ──────────────────────────────────────────────────────

  it('a salon request: carried at ACCEPTED in the model\'s base currency, one left out when none is left; the piece\'s price then entered in that currency', async () => {
    await t.db.updateTable('models').set({ base_price_minor: 400_000, base_currency: 'EUR' }).where('id', '=', f.modelId).execute();
    await countIn(extender.skuId, france, 1);
    const { order, closed } = await salonOrder([{ addonId: strap.id, units: 1 }, { addonId: extender.id, units: 1 }], {
      // The last extender goes elsewhere before Client Services accepts: it is left out, never blocking the sale.
      before: async () => {
        const left = await available(extender.skuId);
        await ctx.services.stock.adjust({ skuId: extender.skuId, locationId: france, delta: -left, note: 'Moved.' }, admin);
      },
    });
    expect(closed.addonsLeftOut).toEqual([{ addonId: extender.id, name: 'CHAIN EXTENDER', units: 1, reason: 'NONE_LEFT' }]);
    expect(order.currency).toBeNull();
    expect((await unitsOf(order.id)).map((u) => [u.addon_id, u.currency, u.status])).toEqual([[strap.id, 'EUR', 'HELD']]);
    expect(await refusal(orders().setTerms(order.id, { priceMinor: 400_000, currency: 'GBP' }, admin))).toEqual({
      code: 'ORDER_ADDON_CURRENCY',
      status: 409,
      message: 'The add-ons on this order are priced in EUR: enter its price in EUR, or remove them first.',
    });
    await orders().setTerms(order.id, { priceMinor: 400_000, currency: 'EUR' }, admin);
    await countIn(extender.skuId, france, 3);
  });
});
