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
 *  - staff add and remove until the parcel is packed (409 PACKING_PACKED after; a tick at × 2 no longer counts at × 3),
 *    ship then moving exactly the units packed;
 *  - the life: cancel releases, ship moves −1 per unit, a return takes them back (`returned_to_stock`), a size exchange
 *    leaves them with the collector (billed again on its EXCHANGE order), a location change moves them or is refused
 *    (ORDER_ADDON_NOT_AT_LOCATION); a parcel problem brings them back (back to sender: to stock, then held or freed;
 *    lost: held again without stock, named when short, or gone when refunded);
 *  - packing: one checklist line per add-on, the parcel's weight with each unit's;
 *  - the journal `order.addon.add` / `.remove`, the order CSV's line items, the account's export (its units and the
 *    choices not on an order yet);
 *  - ONE OFFER RULE (lot Q2, step Q2.3; D3, D8, N8): a LIVE hold and a draw's place held offer what their release picked,
 *    in its order, with their switch on; the salon and YOUR ORDERS their switch alone (an order of an ended release, an
 *    add-on its release never picked, one created after it locked: all offered until packing); staff neither; refusals
 *    name the switch or the pick; a choice switched off before PAY is left out (NOT_OFFERED); the engraving one on an
 *    order, its words with its choice only (its most characters, the house's set), never in ADD AN ADD-ON;
 *  - under concurrency (PGlite always; PostgreSQL with ORBES_TEST_POSTGRES_URL, a pool of 8): two orders take the last
 *    unit of an add-on at once, added or carried: one holds it, the other is told none is left.
 * The routes are test/api/account-orders.test.ts's, admin-orders.test.ts's, the-club's, live's and salon's.
 * CI: test/services/order-addons.test.ts on PostgreSQL > two orders take the last unit of an add-on at once.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, inTransaction, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { accountAddonOpen, addonOffer, addonWindow, setChoices } from '../../src/server/services/order-addons.js';
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
  /**
   * A LIVE sale as a collector lives it, its catalogue add-ons chosen at the hold (`before` runs between the choice and
   * PAY). Lot Q2, step Q2.3: its release picks `pick`, by default the four of the catalogue and any other it chooses.
   * Step Q2.4 (N1): a hold chooses rows, one unit per piece; `units` above one is written on the choice as a fixture (an
   * order holding several of one add-on, as YOUR ORDERS gives one), carried as many on each piece's order.
   */
  async function liveSale(o: { items?: { addonId: string; units?: number; text?: string }[]; before?: () => Promise<void>; price?: number; quantity?: number; pick?: string[] } = {}) {
    const quantity = o.quantity ?? 1;
    const opensAt = new Date(clock.now().getTime() + HOUR);
    const pick = o.pick ?? [...new Set([cloth.id, extender.id, strap.id, pouch.id, ...(o.items ?? []).map((i) => i.addonId)])];
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: String(sizes++), stock: 5 }], perAccount: quantity, addonIds: pick, ...(o.price !== undefined ? { priceMinor: o.price } : {}) });
    const a = await accountOfTier(f, 0);
    clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(a.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, a.actor);
    clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(a.id, r.id))!.turn!.token!;
    await f.live.press(a.id, r.id, token);
    clock.advance(1500);
    await f.live.secure(a.id, r.id, token, a.actor);
    let held = o.items ? await f.live.setAddons(a.id, r.id, o.items.map((i) => ({ addonId: i.addonId, ...(i.text !== undefined ? { text: i.text } : {}) })), a.actor) : null;
    const entryId = (await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', a.id).executeTakeFirstOrThrow()).id;
    for (const i of o.items ?? []) if ((i.units ?? 1) > 1) await t.db.updateTable('addon_choices').set({ units: i.units! }).where('live_entry_id', '=', entryId).where('addon_id', '=', i.addonId).execute();
    if (o.items?.some((i) => (i.units ?? 1) > 1)) held = (await f.live.entry(a.id, r.id))!;
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

  it('LIVE: rows chosen at the hold (each checked for one unit per piece), carried at PAY one unit on each piece\'s order, the last unit to the first order and the rest left out; the choices deleted; never a piece, an ownership nor the tier', async () => {
    let refusals: unknown[] = [];
    const before = { cloth: await available(cloth.skuId), strap: await available(strap.skuId) };
    const sale = await liveSale({
      quantity: 2,
      items: [{ addonId: cloth.id }],
      before: async () => {
        const e = (await t.db.selectFrom('live_entries').select(['drop_id', 'account_id']).where('status', '=', 'SECURED').executeTakeFirstOrThrow());
        const actor: Actor = { type: 'account', id: e.account_id };
        refusals = [
          // N1: two pieces take two units; one extender is left.
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [{ addonId: extender.id }], actor)),
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [{ addonId: pouch.id }], actor)),
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [{ addonId: cloth.id }, { addonId: cloth.id }], actor)),
        ];
        await f.live.setAddons(e.account_id, e.drop_id, [{ addonId: cloth.id }, { addonId: strap.id }], actor);
        // Its view while held: the rows, one unit per piece at its price, and the total; what is offered: a row each, a
        // product only while one per piece is left (the extender is not; the pouch is priced in CHF only).
        const view = (await f.live.entry(e.account_id, e.drop_id))!;
        expect(view.addonItems).toEqual([
          { addonId: cloth.id, name: 'POLISHING CLOTH', line: null, units: 2, priceMinor: 1500, text: null },
          { addonId: strap.id, name: 'SPARE STRAP', line: null, units: 2, priceMinor: 2500, text: null },
        ]);
        expect(view.totalMinor).toBe(2 * (505_000 + 1500 + 2500));
        expect(view.addonOffer.map((a) => [a.name, a.maxUnits])).toEqual([
          ['POLISHING CLOTH', 1],
          ['SPARE STRAP', 1],
        ]);
        // Nothing is held before PAY.
        expect(await available(cloth.skuId)).toBe(before.cloth);
        // All but one strap go elsewhere meanwhile: the first piece's order takes it, the other is left out at PAY, never blocking it.
        await ctx.services.stock.adjust({ skuId: strap.skuId, locationId: france, delta: -(before.strap - 1), note: 'Damaged.' }, admin);
      },
    });
    expect(refusals).toEqual([
      { code: 'ADDON_OUT_OF_STOCK', status: 409, message: 'CHAIN EXTENDER could not be added: none left.' },
      { code: 'ADDON_NOT_OFFERED', status: 409, message: 'TRAVEL POUCH is not offered here.' },
      { code: 'VALIDATION_FAILED', status: 400, message: 'Each add-on is chosen once, with its units.' },
    ]);
    expect(sale.confirmed.addonsLeftOut).toEqual([{ addonId: strap.id, name: 'SPARE STRAP', units: 1, reason: 'NONE_LEFT' }]);
    const [first, second] = sale.orders;
    // One unit on each piece's order, held at the release's location at its price; the last strap on the first.
    const rowsOf = async (id: string) => (await unitsOf(id)).map((u) => [u.addon_id, u.status, u.price_minor, u.currency, u.added_by_type, u.added_by, u.location_id]);
    expect((await rowsOf(first!.id)).sort()).toEqual(
      [
        [cloth.id, 'HELD', 1500, 'EUR', 'PURCHASE', null, france],
        [strap.id, 'HELD', 2500, 'EUR', 'PURCHASE', null, france],
      ].sort(),
    );
    expect(await rowsOf(second!.id)).toEqual([[cloth.id, 'HELD', 1500, 'EUR', 'PURCHASE', null, france]]);
    // No snapshot: the add-ons are units (D2, N15).
    expect([first!.addons, second!.addons]).toEqual([[], []]);
    expect(await available(cloth.skuId)).toBe(before.cloth - 2);
    expect(await available(strap.skuId)).toBe(0);
    expect(await t.db.selectFrom('addon_choices').select('id').where('live_entry_id', '=', sale.entry.id).execute()).toEqual([]);
    // The entry after PAY reads what its orders carry, as sold.
    const after = (await f.live.entry(sale.account.id, sale.release.id))!.addonItems;
    expect([...after].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { addonId: cloth.id, name: 'POLISHING CLOTH', line: null, units: 2, priceMinor: 1500, text: null },
      { addonId: strap.id, name: 'SPARE STRAP', line: null, units: 1, priceMinor: 2500, text: null },
    ]);
    expect((await f.live.entry(sale.account.id, sale.release.id))!.totalMinor).toBe(2 * 505_000 + 2 * 1500 + 2500);
    // Its journal and audit entries: one addition per order and add-on.
    const journal = await t.db.selectFrom('event_journal').select(['type', 'payload']).where('entity_id', '=', second!.id).where('type', '=', 'order.addon.add').execute();
    expect(journal.map((j) => (j.payload as { addon: unknown }).addon)).toEqual([
      { addonId: cloth.id, units: 1, unitIds: expect.any(Array), priceMinor: 1500, currency: 'EUR', by: 'purchase' },
    ]);
    const confirm = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.confirm').where('target_id', '=', sale.release.id).executeTakeFirstOrThrow();
    expect(confirm.details).toMatchObject({ addonsLeftOut: [{ addonId: strap.id, units: 1, reason: 'NONE_LEFT' }] });
    const chose = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.addons').where('target_id', '=', sale.release.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect((chose.details as { items: unknown }).items).toEqual([
      { addonId: cloth.id, units: 1 },
      { addonId: strap.id, units: 1 },
    ]);
    // No identity: never a product row, never an ownership; the tier reads pieces only.
    expect(await t.db.selectFrom('products').select('id').where('sku_id', 'in', [cloth.skuId, strap.skuId]).execute()).toEqual([]);
    expect((await tierOf(t.db, sale.account.id, clock.now())).tier).toBe(0);
    await countIn(strap.skuId, france, 5);
    await countIn(extender.skuId, france, 2);
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
    // ADD AN ADD-ON only while one is available for the order now (§4.1, §4.4): the CLOTH alone offered, until the
    // order holds 3 of it; then none offered at all.
    const others = (await t.db.selectFrom('addon_items').select('id').where('active', '=', true).where('id', '!=', cloth.id).execute()).map((a) => a.id);
    await t.db.updateTable('addon_items').set({ active: false }).where('id', 'in', others).execute();
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(true);
    await addons().addForAccount(account.id, o!.id, { addonId: cloth.id, units: 3 }, account.actor);
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(false);
    await addons().removeForAccount(account.id, o!.id, cloth.id, account.actor);
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(true);
    await t.db.updateTable('addon_items').set({ active: false }).where('id', '=', cloth.id).execute();
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(false);
    await t.db.updateTable('addon_items').set({ active: true }).where('id', 'in', [cloth.id, ...others]).execute();
    expect((await orders().accountOrder(account.id, o!.id)).canAddAddons).toBe(true);
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

  it('staff add and remove while packing has begun or not; a unit removed by its id; cancel releases what it held', async () => {
    const { orders: [o] } = await liveSale();
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    await t.db.updateTable('orders').set({ packing_started_at: clock.now() }).where('id', '=', o!.id).execute();
    const before = await available(strap.skuId);
    await addons().addForStaff(o!.id, { addonId: strap.id, units: 2 }, admin);
    const view = await orders().get(o!.id);
    expect(view.addonItems.map((u) => [u.addon.name, u.skuCode, u.status, u.addedBy.type, u.addedBy.id, u.location?.name])).toEqual([
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

  it('staff change the add-ons until the parcel is packed: a line ticked at × 2 no longer counts at × 3; once packed, add and remove are refused (409 PACKING_PACKED) and ship moves exactly the packed units', async () => {
    const { orders: [o] } = await liveSale({ items: [{ addonId: cloth.id, units: 2 }] });
    await stockFor(o!.id);
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    await linkPiece(o!.id);
    await ctx.services.logistics.setPhoto(o!.id, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, admin, null);
    const stale = (await ctx.services.logistics.parcel(o!.id, null)).checklist.filter((l) => !l.byScan).map((l) => l.key);
    expect(stale).toContain(`addon-item:${o!.id}:${cloth.id}:2`);
    // While PACKING, staff may still add: the page ticked at × 2 no longer packs the parcel.
    clock.advance(1000);
    await addons().addForStaff(o!.id, { addonId: cloth.id, units: 1 }, admin);
    expect(await refusal(ctx.services.logistics.checkPacked(o!.id, { ticked: stale }, admin, null))).toMatchObject({ code: 'PACKING_INCOMPLETE' });
    const fresh = (await ctx.services.logistics.parcel(o!.id, null)).checklist.filter((l) => !l.byScan).map((l) => l.key);
    expect(fresh).toContain(`addon-item:${o!.id}:${cloth.id}:3`);
    await ctx.services.logistics.checkPacked(o!.id, { ticked: fresh }, admin, null);
    const packed = await t.db.selectFrom('shipments').select(['status', 'checklist']).where('order_id', '=', o!.id).executeTakeFirstOrThrow();
    expect(packed.status).toBe('PACKED');
    expect((packed.checklist as { key: string; label: string }[]).filter((l) => l.key.startsWith('addon-item:'))).toEqual([{ key: `addon-item:${o!.id}:${cloth.id}:3`, label: 'Add-on: POLISHING CLOTH × 3' }]);
    // Packed: the sealed parcel never changes.
    const held = await unitsOf(o!.id);
    expect(await refusal(addons().addForStaff(o!.id, { addonId: strap.id, units: 1 }, admin))).toMatchObject({ code: 'PACKING_PACKED', status: 409 });
    expect(await refusal(addons().removeForStaff(o!.id, held[0]!.id, admin))).toMatchObject({ code: 'PACKING_PACKED', status: 409 });
    expect(await addons().offerForStaff(o!.id)).toMatchObject({ canAdd: false, reason: 'PACKED', offer: [] });
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['HELD', 'HELD', 'HELD']);
    // Shipped: exactly the three units packed leave the ledger.
    const before = await onHand(cloth.skuId);
    clock.advance(MINUTE);
    await ctx.services.logistics.ship(o!.id, { carrierId: colissimo, trackingNumber: '6A12345678902' }, admin, null);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['SHIPPED', 'SHIPPED', 'SHIPPED']);
    expect(await onHand(cloth.skuId)).toBe(before - 3);
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
      [`addon-item:${o!.id}:${cloth.id}:2`, 'Add-on: POLISHING CLOTH × 2'],
      [`addon-item:${o!.id}:${extender.id}:1`, 'Add-on: CHAIN EXTENDER × 1'],
    ]);
    expect(parcel.orders[0]!.addonItems).toEqual([
      { name: 'POLISHING CLOTH', units: 2 },
      { name: 'CHAIN EXTENDER', units: 1 },
    ]);
    expect(parcel.packing.weightG).toBe(100 + 40 + 2 * 20 + 15);
    // A line left unticked: not packed.
    await ctx.services.logistics.setPhoto(o!.id, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, admin, null);
    expect(await refusal(ctx.services.logistics.checkPacked(o!.id, { ticked: parcel.checklist.filter((l) => !l.byScan && l.key !== `addon-item:${o!.id}:${cloth.id}:2`).map((l) => l.key) }, admin, null))).toMatchObject({ code: 'PACKING_INCOMPLETE' });
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

  // ── Parcel problems ──────────────────────────────────────────────────────

  it('parcel problems: back to sender brings the units back to stock, held again (RESHIP) or freed (REFUND); a lost parcel reshipped holds new ones (no movement, the units beyond the stock named, −1 again at the next ship) or, refunded, leaves them gone', async () => {
    const bag = await ctx.services.addons.create({ name: 'GIFT BAG', skuCode: 'ADD-BAG', prices: { EUR: 1000 }, weightG: 10 }, admin);
    const sku = bag.sku.id;
    await countIn(sku, france, 2);
    const level = async () => [await onHand(sku), await available(sku)];
    const moves = async (orderId: string) =>
      (await t.db.selectFrom('stock_movements').select(['reason', 'delta', 'order_addon_item_id']).where('order_id', '=', orderId).where('order_addon_item_id', 'is not', null).orderBy('id').execute()).map((m) => [
        m.reason,
        m.delta,
        m.order_addon_item_id,
      ]);
    const shippedSale = async () => {
      const { orders: [o] } = await liveSale({ items: [{ addonId: bag.id, units: 1 }] });
      await stockFor(o!.id);
      clock.advance(MINUTE);
      await orders().transition(o!.id, { to: 'PAID' }, admin);
      await packAndShip(o!.id);
      const [unit] = await unitsOf(o!.id);
      expect(unit!.status).toBe('SHIPPED');
      return { id: o!.id, unit: unit!.id };
    };
    const cases = () => ctx.services.orderCases;

    // Back to sender, refunded: RETURNED +1, held again, then cancelled with its order: the stock free again.
    const a = await shippedSale();
    expect(await level()).toEqual([1, 1]);
    const ca = await cases().report(a.id, { kind: 'BACK_TO_SENDER', note: 'Address unknown.' }, admin, null);
    await cases().receive(ca.id, { pieceState: 'OK' }, admin, null);
    clock.advance(MINUTE);
    const da = await cases().decide(ca.id, { decision: 'REFUND' }, admin, { admin: false });
    expect(da.addonsShort).toBeUndefined();
    expect((await orderRow(a.id)).status).toBe('CANCELLED');
    expect((await unitsOf(a.id)).map((u) => [u.status, u.shipped_at])).toEqual([['CANCELLED', null]]);
    expect(await moves(a.id)).toEqual([
      ['SHIPPED', -1, a.unit],
      ['RETURNED', 1, a.unit],
    ]);
    expect(await level()).toEqual([2, 2]);

    // Back to sender, reshipped: RETURNED +1 and held again, to pack with its order.
    const b = await shippedSale();
    const cb = await cases().report(b.id, { kind: 'BACK_TO_SENDER', note: 'Refused.' }, admin, null);
    await cases().receive(cb.id, { pieceState: 'OK' }, admin, null);
    clock.advance(MINUTE);
    expect((await cases().decide(cb.id, { decision: 'RESHIP' }, admin, { admin: false })).addonsShort).toBeUndefined();
    expect((await unitsOf(b.id)).map((u) => [u.status, u.shipped_at, u.location_id])).toEqual([['HELD', null, france]]);
    expect(await moves(b.id)).toEqual([
      ['SHIPPED', -1, b.unit],
      ['RETURNED', 1, b.unit],
    ]);
    expect(await level()).toEqual([2, 1]);
    clock.advance(MINUTE);
    await orders().transition(b.id, { to: 'CANCELLED', note: 'Test over.' }, admin);
    expect(await level()).toEqual([2, 2]);

    // Lost, reshipped when none is left: a new unit held with no movement (the first is gone with the parcel), the
    // stock below zero, named in the answer and the order's event; counted in, then −1 again at the next ship.
    const c = await shippedSale();
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: -1, note: 'Damaged.' }, admin);
    expect(await level()).toEqual([0, 0]);
    const cc = await cases().report(c.id, { kind: 'LOST', note: 'No scan for 12 days.' }, admin, null);
    clock.advance(MINUTE);
    const dc = await cases().decide(cc.id, { decision: 'RESHIP', note: 'Another piece.' }, admin, { admin: true });
    expect(dc.addonsShort).toEqual([{ orderId: c.id, addonId: bag.id, name: 'GIFT BAG', units: 1 }]);
    const reship = (await eventsOf(c.id)).find((e) => e.action === 'order.reship')!;
    expect(reship.details).toMatchObject({ addonsShort: [{ addonId: bag.id, units: 1 }] });
    expect((await unitsOf(c.id)).map((u) => [u.id, u.status, u.shipped_at])).toEqual([[c.unit, 'HELD', null]]);
    expect(await moves(c.id)).toEqual([['SHIPPED', -1, c.unit]]);
    expect(await level()).toEqual([0, -1]);
    await countIn(sku, france, 1);
    expect(await level()).toEqual([1, 0]);
    await stockFor(c.id);
    clock.advance(MINUTE);
    await packAndShip(c.id);
    expect((await unitsOf(c.id)).map((u) => u.status)).toEqual(['SHIPPED']);
    expect(await moves(c.id)).toEqual([
      ['SHIPPED', -1, c.unit],
      ['SHIPPED', -1, c.unit],
    ]);
    expect(await level()).toEqual([0, 0]);

    // Lost, refunded: its unit stays SHIPPED (gone with the parcel) on the cancelled order, no movement back.
    await countIn(sku, france, 1);
    const d = await shippedSale();
    const cd = await cases().report(d.id, { kind: 'LOST', note: 'No news.' }, admin, null);
    clock.advance(MINUTE);
    await cases().decide(cd.id, { decision: 'REFUND', note: 'Refunded.' }, admin, { admin: true });
    expect((await orderRow(d.id)).status).toBe('CANCELLED');
    expect((await unitsOf(d.id)).map((u) => u.status)).toEqual(['SHIPPED']);
    expect(await moves(d.id)).toEqual([['SHIPPED', -1, d.unit]]);
    expect(await level()).toEqual([0, 0]);
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
    // The account's export names the choice while it is not on an order yet.
    expect((await ctx.services.owners.exportData(a.id, admin)).addonChoices).toEqual([{ on: 'DRAW_ENTRY', sourceId: ea, addon: 'POLISHING CLOTH', units: 3, text: null, chosenAt: expect.any(Date) }]);
    const confirmed = await f.drops.confirm(d.id, ea, null, admin);
    expect(confirmed.addonsLeftOut).toBeUndefined();
    expect((await ctx.services.owners.exportData(a.id, admin)).addonChoices).toEqual([]);
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

  // ── A service (lot Q2, step Q2.2; D4, D8, D9, N14) ──────────────────────

  it('a service\'s units are held nowhere: chosen and carried without stock or lock, added in YOUR ORDERS and by staff, packed on its own line (its weight when it has one), shipped and returned without a movement (returned_to_stock false), invoiced, credited and exported as a product\'s', async () => {
    const wrap = await ctx.services.addons.create({ kind: 'SERVICE', name: 'GIFT WRAPPING', skuCode: 'ADD-WRAP', prices: { EUR: 1500 }, weightG: 40 }, admin);
    const card = await ctx.services.addons.create({ kind: 'SERVICE', name: 'GREETING CARD', skuCode: 'ADD-CARD', prices: { EUR: 500 } }, admin);
    const movesOf = (orderId: string) => t.db.selectFrom('stock_movements').select(['reason', 'delta']).where('order_id', '=', orderId).where('order_addon_item_id', 'is not', null).execute();
    let offered: [string, number][] = [];
    const sale = await liveSale({
      items: [{ addonId: wrap.id, units: 2 }],
      pick: [wrap.id, card.id],
      before: async () => {
        const e = await t.db.selectFrom('live_entries').select(['drop_id', 'account_id']).where('status', '=', 'SECURED').executeTakeFirstOrThrow();
        offered = (await f.live.entry(e.account_id, e.drop_id))!.addonOffer.filter((a) => a.addonId === wrap.id || a.addonId === card.id).map((a) => [a.name, a.maxUnits]);
      },
    });
    // No count: a row each at the hold (one unit per piece, N1), whatever any location holds.
    expect(offered).toEqual([
      ['GIFT WRAPPING', 1],
      ['GREETING CARD', 1],
    ]);
    const [o] = sale.orders;
    expect(sale.confirmed.addonsLeftOut ?? []).toEqual([]);
    expect((await unitsOf(o!.id)).map((u) => [u.addon_id, u.status, u.price_minor, u.added_by_type, u.location_id])).toEqual([
      [wrap.id, 'HELD', 1500, 'PURCHASE', null],
      [wrap.id, 'HELD', 1500, 'PURCHASE', null],
    ]);
    // YOUR ORDERS offers what is left within three; staff add one held nowhere too.
    expect((await addons().offerForAccount(sale.account.id, o!.id)).offer.filter((a) => a.addonId === wrap.id || a.addonId === card.id).map((a) => [a.name, a.maxUnits])).toEqual([
      ['GIFT WRAPPING', 1],
      ['GREETING CARD', 3],
    ]);
    clock.advance(1000);
    await addons().addForStaff(o!.id, { addonId: card.id, units: 1 }, admin);
    expect((await orders().get(o!.id)).addonItems.map((u) => [u.addon.name, u.skuCode, u.location])).toEqual([
      ['GIFT WRAPPING', 'ADD-WRAP', null],
      ['GIFT WRAPPING', 'ADD-WRAP', null],
      ['GREETING CARD', 'ADD-CARD', null],
    ]);
    // Held nowhere: the stock never sees them.
    expect(await t.db.selectFrom('stock_holds').select('id').where('sku_id', 'in', [wrap.sku.id, card.sku.id]).execute()).toEqual([]);
    await stockFor(o!.id);
    clock.advance(MINUTE);
    await orders().transition(o!.id, { to: 'PAID' }, admin);
    const [invoice] = (await invoicesOf(o!.id)).filter((d) => d.kind === 'INVOICE');
    expect(linesOf(invoice!).filter((l) => l[0] === 'ADD_ON_ITEM')).toEqual([
      ['ADD_ON_ITEM', 'GIFT WRAPPING', 1500],
      ['ADD_ON_ITEM', 'GIFT WRAPPING', 1500],
      ['ADD_ON_ITEM', 'GREETING CARD', 500],
    ]);
    // Packed: one line per add-on; the wrapping's weight counted, the card without one never missing.
    const box = await ctx.services.boxes.create({ name: `WRAP ${o!.id.slice(0, 4)}`, insideLengthMm: 120, insideWidthMm: 100, insideHeightMm: 40, emptyWeightG: 100 }, admin);
    await ctx.services.catalog.setModelPacking(f.modelId, { boxId: box.id, packedWeightG: 40 }, admin);
    await linkPiece(o!.id);
    const parcel = await ctx.services.logistics.parcel(o!.id, null);
    expect(parcel.checklist.filter((l) => l.key.startsWith('addon-item:')).map((l) => l.label)).toEqual(['Add-on: GIFT WRAPPING × 2', 'Add-on: GREETING CARD × 1']);
    expect(parcel.packing.weightG).toBe(100 + 40 + 2 * 40);
    await packAndShip(o!.id);
    expect((await unitsOf(o!.id)).map((u) => u.status)).toEqual(['SHIPPED', 'SHIPPED', 'SHIPPED']);
    expect((await t.db.selectFrom('shipments').select('weight_g').where('order_id', '=', o!.id).executeTakeFirstOrThrow()).weight_g).toBe(220);
    // Returned: back with the order, never to stock.
    clock.advance(MINUTE);
    await orders().returnOrder(o!.id, { outcome: 'RESTOCKED', locationId: logistics, note: 'Returned.', addonsOut: [] }, admin);
    expect((await unitsOf(o!.id)).map((u) => [u.status, u.returned_to_stock, u.location_id])).toEqual([
      ['RETURNED', false, null],
      ['RETURNED', false, null],
      ['RETURNED', false, null],
    ]);
    expect(await movesOf(o!.id)).toEqual([]);
    const full = (await invoicesOf(o!.id)).find((d) => d.kind === 'CREDIT_NOTE')!;
    expect(linesOf(full).filter((l) => l[0] === 'ADD_ON_ITEM').map((l) => l[1])).toEqual(['GIFT WRAPPING', 'GIFT WRAPPING', 'GREETING CARD']);
    // Exported as line items, not shipped (S5).
    const day = o!.reserved_at.toISOString().slice(0, 10);
    const csv = (await ctx.services.shopify.orderCsv({ from: day, to: day }, { email: (e) => e, buyer: (b) => b })).body;
    expect(csv).toContain('"GIFT WRAPPING","15.00","ADD-WRAP","false"');
    expect(csv).toContain('"GREETING CARD","5.00","ADD-CARD","false"');

    // Another sale: its unit stays held nowhere when the order changes location, comes back held nowhere when a lost
    // parcel is reshipped (never short), and is cancelled with its order.
    const other = (await liveSale({ items: [{ addonId: wrap.id, units: 1 }] })).orders[0]!;
    await orders().changeLocation(other.id, logistics, admin);
    expect((await unitsOf(other.id)).map((u) => [u.status, u.location_id])).toEqual([['HELD', null]]);
    await stockFor(other.id);
    clock.advance(MINUTE);
    await orders().transition(other.id, { to: 'PAID' }, admin);
    await packAndShip(other.id);
    const lost = await ctx.services.orderCases.report(other.id, { kind: 'LOST', note: 'No scan for 12 days.' }, admin, null);
    clock.advance(MINUTE);
    expect((await ctx.services.orderCases.decide(lost.id, { decision: 'RESHIP', note: 'Another piece.' }, admin, { admin: true })).addonsShort).toBeUndefined();
    expect((await unitsOf(other.id)).map((u) => [u.status, u.shipped_at, u.location_id])).toEqual([['HELD', null, null]]);
    clock.advance(MINUTE);
    await orders().transition(other.id, { to: 'CANCELLED', note: 'Test over.' }, admin);
    expect((await unitsOf(other.id)).map((u) => u.status)).toEqual(['CANCELLED']);
    expect(await movesOf(other.id)).toEqual([]);
    expect(await t.db.selectFrom('stock_movements').select('id').where('sku_id', 'in', [wrap.sku.id, card.sku.id]).execute()).toEqual([]);
  });

  // ── ONE OFFER RULE (lot Q2, step Q2.3; D3, D8, N8) ───────────────────────

  /** A service offered at the moments given only, priced in euros. */
  const onlyAt = (name: string, skuCode: string, at: { live?: boolean; draw?: boolean; salon?: boolean; orders?: boolean }) =>
    ctx.services.addons.create({ kind: 'SERVICE', name, skuCode, prices: { EUR: 1000 }, offeredAt: { live: false, draw: false, salon: false, orders: false, ...at } }, admin);
  const names = (offer: { name: string }[]) => offer.map((a) => a.name);
  const securedEntry = () => t.db.selectFrom('live_entries').select(['id', 'drop_id', 'account_id']).where('status', '=', 'SECURED').executeTakeFirstOrThrow();

  it('one offer rule: a LIVE hold and a draw\'s place held offer what their release picked, in its order, with their switch on; the salon and YOUR ORDERS their switch alone; staff neither; a choice refused names the switch or the pick, and one switched off before PAY is left out', async () => {
    const liveOnly = await onlyAt('BOX FOR LIVE', 'ADD-Q23-LIVE', { live: true });
    const drawOnly = await onlyAt('BOX FOR DRAWS', 'ADD-Q23-DRAW', { draw: true });
    const salonOnly = await onlyAt('BOX FOR THE SALON', 'ADD-Q23-SALON', { salon: true });
    const ordersOnly = await onlyAt('BOX FOR ORDERS', 'ADD-Q23-ORDERS', { orders: true });
    const mine = new Set([liveOnly.id, drawOnly.id, salonOnly.id, ordersOnly.id]);

    // LIVE: the release picks the LIVE box first, the cloth, and the draws' box (a pick never turns a switch on).
    let offered: string[] = [];
    let refused: unknown[] = [];
    const sale = await liveSale({
      pick: [liveOnly.id, cloth.id, drawOnly.id],
      items: [{ addonId: liveOnly.id }],
      before: async () => {
        const e = await securedEntry();
        const actor: Actor = { type: 'account', id: e.account_id };
        offered = names((await f.live.entry(e.account_id, e.drop_id))!.addonOffer);
        refused = [
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [{ addonId: drawOnly.id }], actor)),
          await refusal(f.live.setAddons(e.account_id, e.drop_id, [{ addonId: strap.id }], actor)),
        ];
        await f.live.setAddons(e.account_id, e.drop_id, [{ addonId: liveOnly.id }, { addonId: cloth.id }], actor);
        // Its LIVE switch turned off before PAY: left out, never blocking it.
        await ctx.services.addons.update(liveOnly.id, { offeredAt: { live: false } }, admin);
      },
    });
    expect(offered).toEqual(['BOX FOR LIVE', 'POLISHING CLOTH']);
    expect(refused).toEqual([
      { code: 'ADDON_NOT_OFFERED', status: 409, message: 'BOX FOR DRAWS is not offered in a LIVE RELEASE.' },
      { code: 'ADDON_NOT_OFFERED', status: 409, message: 'SPARE STRAP is not one of this release’s add-ons.' },
    ]);
    expect(sale.confirmed.addonsLeftOut).toEqual([{ addonId: liveOnly.id, name: 'BOX FOR LIVE', units: 1, reason: 'NOT_OFFERED' }]);
    expect((await unitsOf(sale.orders[0]!.id)).map((u) => u.addon_id)).toEqual([cloth.id]);
    await ctx.services.addons.update(liveOnly.id, { offeredAt: { live: true } }, admin);

    // A draw: its pick, in its order (the draws' box first), with its DRAW switch on.
    const T = new Date(clock.now().getTime() + HOUR);
    const d = await poolDraw(
      f.drops,
      t.db,
      { modelId: f.modelId, title: 'A draw that picks', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0, priceMinor: 480_000, currency: 'EUR', addonIds: [drawOnly.id, cloth.id] },
      admin,
    );
    const a = await createAccount(t.db);
    clock.set(new Date(T.getTime() + MINUTE));
    await f.drops.enter(a.id, d.id, a.actor);
    clock.set(new Date(T.getTime() + 2 * HOUR));
    await f.drops.draw(d.id, admin);
    expect(names((await f.drops.entryFor(a.id, d.id)).addons!.offer)).toEqual(['BOX FOR DRAWS', 'POLISHING CLOTH']);
    expect(await refusal(f.drops.setAddonChoices(a.id, d.id, [{ addonId: liveOnly.id, units: 1 }], a.actor))).toEqual({ code: 'ADDON_NOT_OFFERED', status: 409, message: 'BOX FOR LIVE is not offered in a release with a draw.' });
    expect(await refusal(f.drops.setAddonChoices(a.id, d.id, [{ addonId: strap.id, units: 1 }], a.actor))).toEqual({ code: 'ADDON_NOT_OFFERED', status: 409, message: 'SPARE STRAP is not one of this release’s add-ons.' });
    expect((await f.drops.setAddonChoices(a.id, d.id, [{ addonId: drawOnly.id, units: 2 }], a.actor)).addons!.chosen.map((c) => [c.name, c.units])).toEqual([['BOX FOR DRAWS', 2]]);

    // The salon: its switch alone (every M3 add-on, and its own box; no release, no pick).
    const salonOffer = names(await addonOffer(t.db, { moment: 'SALON', dropId: null, locationId: france, currency: 'EUR' }));
    expect(salonOffer).toContain('BOX FOR THE SALON');
    expect(salonOffer).toContain('SPARE STRAP');
    expect(salonOffer.filter((n) => n.startsWith('BOX FOR'))).toEqual(['BOX FOR THE SALON']);
    const r = await t.db.insertInto('shop_requests').values({ account_id: a.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    expect(await refusal(inTransaction(t.db, (tx) => setChoices(tx, { shopRequestId: r.id }, [{ addonId: liveOnly.id, units: 1 }], { locationId: france, currency: 'EUR' }, clock.now())))).toEqual({
      code: 'ADDON_NOT_OFFERED',
      status: 409,
      message: 'BOX FOR LIVE is not offered in the private salon.',
    });
    await inTransaction(t.db, (tx) => setChoices(tx, { shopRequestId: r.id }, [{ addonId: salonOnly.id, units: 1 }], { locationId: france, currency: 'EUR' }, clock.now()));

    // YOUR ORDERS: its switch alone (the release's pick is never read); staff are bound by neither.
    const o = sale.orders[0]!;
    const yours = (await addons().offerForAccount(sale.account.id, o.id)).offer;
    expect(yours.filter((x) => mine.has(x.addonId)).map((x) => x.name)).toEqual(['BOX FOR ORDERS']);
    expect(await refusal(addons().addForAccount(sale.account.id, o.id, { addonId: liveOnly.id, units: 1 }, sale.account.actor))).toEqual({
      code: 'ADDON_NOT_OFFERED',
      status: 409,
      message: 'BOX FOR LIVE is not offered in YOUR ORDERS.',
    });
    const staff = (await addons().offerForStaff(o.id)).offer;
    expect(staff.filter((x) => mine.has(x.addonId)).map((x) => x.name).sort()).toEqual(['BOX FOR DRAWS', 'BOX FOR LIVE', 'BOX FOR ORDERS', 'BOX FOR THE SALON']);
    await addons().addForStaff(o.id, { addonId: salonOnly.id, units: 1 }, admin);
    // No collector payload names a switch, a pick or a kind.
    for (const x of [...yours, ...staff]) expect(Object.keys(x).sort()).toEqual(['addonId', 'currency', 'engraving', 'line', 'maxUnits', 'name', 'priceMinor']);
    for (const id of mine) await ctx.services.addons.setAside(id, admin);
  });

  it('YOUR ORDERS follows its switch alone (N8): an order of an ended release, before packing, is still offered every add-on with its YOUR ORDERS switch on, one its release never picked and one created after the release locked included', async () => {
    const sale = await liveSale({ pick: [cloth.id] });
    const o = sale.orders[0]!;
    // The release ends; an add-on for YOUR ORDERS only is created afterwards.
    await t.db.updateTable('drops').set({ ended_at: clock.now(), ended_reason: 'ENDED' }).where('id', '=', sale.release.id).execute();
    const late = await onlyAt('A CARD IN YOUR WORDS', 'ADD-Q23-LATE', { orders: true });
    const offer = await addons().offerForAccount(sale.account.id, o.id);
    expect(offer).toMatchObject({ canAdd: true, reason: null });
    expect(names(offer.offer)).toEqual(expect.arrayContaining(['POLISHING CLOTH', 'SPARE STRAP', 'A CARD IN YOUR WORDS']));
    expect((await accountAddonOpen(t.db, [o])).has(o.id)).toBe(true);
    await addons().addForAccount(sale.account.id, o.id, { addonId: strap.id, units: 1 }, sale.account.actor);
    clock.advance(1000);
    await addons().addForAccount(sale.account.id, o.id, { addonId: late.id, units: 1 }, sale.account.actor);
    expect((await unitsOf(o.id)).map((u) => [u.addon_id, u.added_by_type])).toEqual([
      [strap.id, 'COLLECTOR'],
      [late.id, 'COLLECTOR'],
    ]);
    await ctx.services.addons.setAside(late.id, admin);
  });

  it('the engraving: one on an order (offered at 1, a second refused), its words with its choice only, at most its most characters of the house\'s set, never in the audit log; left out of ADD AN ADD-ON, staff add it', async () => {
    const engraving = await ctx.services.addons.create(
      { kind: 'SERVICE', name: 'ENGRAVING', skuCode: 'ADD-Q23-ENGRAVING', engraving: true, textMax: 12, prices: { EUR: 4000 }, offeredAt: { live: true, draw: false, salon: false, orders: true } },
      admin,
    );
    let offer: { name: string; maxUnits: number; engraving: boolean; textMax?: number }[] = [];
    let refused: unknown[] = [];
    let stored: unknown[] = [];
    const sale = await liveSale({
      pick: [engraving.id, cloth.id],
      before: async () => {
        const e = await securedEntry();
        const actor: Actor = { type: 'account', id: e.account_id };
        offer = (await f.live.entry(e.account_id, e.drop_id))!.addonOffer;
        const choose = (items: { addonId: string; text?: string | null }[]) => f.live.setAddons(e.account_id, e.drop_id, items, actor);
        refused = [
          await refusal(choose([{ addonId: engraving.id }, { addonId: engraving.id, text: 'M. B.' }])),
          await refusal(choose([{ addonId: cloth.id, text: 'M. B.' }])),
          await refusal(choose([{ addonId: engraving.id, text: 'ABCDEFGHIJKLM' }])),
          await refusal(choose([{ addonId: engraving.id, text: 'M@B' }])),
        ];
        await choose([{ addonId: engraving.id, text: '  M.   B. ' }]);
        stored.push((await t.db.selectFrom('addon_choices').select('text').where('live_entry_id', '=', e.id).executeTakeFirstOrThrow()).text);
        await choose([{ addonId: engraving.id, text: '' }]);
        stored.push((await t.db.selectFrom('addon_choices').select('text').where('live_entry_id', '=', e.id).executeTakeFirstOrThrow()).text);
        await choose([{ addonId: engraving.id, text: 'ÉLODIE & M.' }]);
        // The hold reads its words back (its own), one unit per piece.
        expect((await f.live.entry(e.account_id, e.drop_id))!.addonItems).toEqual([{ addonId: engraving.id, name: 'ENGRAVING', line: null, units: 1, priceMinor: 4000, text: 'ÉLODIE & M.' }]);
        // The account's export carries the words of its SECURED hold (review of lot Q2: its right of access).
        expect((await ctx.services.owners.exportData(e.account_id, admin)).addonChoices).toEqual([
          { on: 'LIVE_ENTRY', sourceId: e.id, addon: 'ENGRAVING', units: 1, text: 'ÉLODIE & M.', chosenAt: expect.any(Date) },
        ]);
      },
    });
    expect(offer.map((x) => [x.name, x.maxUnits, x.engraving, x.textMax])).toEqual([
      ['ENGRAVING', 1, true, 12],
      ['POLISHING CLOTH', 1, false, undefined],
    ]);
    expect(refused).toEqual([
      { code: 'VALIDATION_FAILED', status: 400, message: 'Each add-on is chosen once, with its units.' },
      { code: 'VALIDATION_FAILED', status: 400, message: 'Only the engraving takes words.' },
      { code: 'VALIDATION_FAILED', status: 400, message: 'Up to 12 characters: letters, figures, spaces and . & ’ -' },
      { code: 'VALIDATION_FAILED', status: 400, message: 'Up to 12 characters: letters, figures, spaces and . & ’ -' },
    ]);
    expect(stored).toEqual(['M. B.', null]);
    const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.addons').where('target_id', '=', sale.release.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ items: [{ addonId: engraving.id, units: 1, text: true }] });
    expect(JSON.stringify(audit.details)).not.toContain('ÉLODIE');
    // Carried at PAY: one unit, held nowhere, its words on the order that carries it (step Q2.4, D25), never logged.
    const o = sale.orders[0]!;
    expect((await unitsOf(o.id)).map((u) => [u.addon_id, u.location_id])).toEqual([[engraving.id, null]]);
    expect(await t.db.selectFrom('orders').select(['engraving_text', 'engraving_by', 'engraving_minor']).where('id', '=', o.id).executeTakeFirstOrThrow()).toEqual({ engraving_text: 'ÉLODIE & M.', engraving_by: 'COLLECTOR', engraving_minor: null });
    expect(JSON.stringify(await t.db.selectFrom('audit_logs').select('details').where('target_id', '=', sale.release.id).execute())).not.toContain('ÉLODIE');
    // YOUR ORDERS: never in ADD AN ADD-ON (its own ENGRAVING); staff may add it, one on an order.
    expect((await addons().offerForAccount(sale.account.id, o.id)).offer.some((x) => x.engraving)).toBe(false);
    expect(await refusal(addons().addForAccount(sale.account.id, o.id, { addonId: engraving.id, units: 1 }, sale.account.actor))).toMatchObject({ code: 'ADDON_NOT_OFFERED', status: 409 });
    expect((await addons().offerForStaff(o.id)).offer.some((x) => x.addonId === engraving.id)).toBe(false);
    expect(await refusal(addons().addForStaff(o.id, { addonId: engraving.id, units: 1 }, admin))).toEqual({ code: 'ADDON_LIMIT', status: 409, message: 'At most one ENGRAVING on an order.' });
    const other = (await liveSale({ pick: [cloth.id] })).orders[0]!;
    expect((await addons().offerForStaff(other.id)).offer.find((x) => x.addonId === engraving.id)).toMatchObject({ maxUnits: 1, engraving: true, textMax: 12 });
    await addons().addForStaff(other.id, { addonId: engraving.id, units: 1 }, admin);
    // Review of lot Q2: the engraving or not, as its units were sold (409 ADDON_ENGRAVING_FIXED), both ways: YOUR ORDERS,
    // the parcel and the invoices read each unit by it; free again once its units are removed.
    expect(await refusal(ctx.services.addons.update(engraving.id, { engraving: false }, admin))).toEqual({
      code: 'ADDON_ENGRAVING_FIXED',
      status: 409,
      message: 'This add-on is on orders as the engraving: it stays the engraving. Set it aside to stop offering it.',
    });
    await ctx.services.addons.setAside(engraving.id, admin);
    expect((await ctx.services.addons.get(engraving.id)).engraving).toBe(true);
    const note = await ctx.services.addons.create({ kind: 'SERVICE', name: 'A NOTE IN THE BOX', skuCode: 'ADD-Q2R-NOTE', prices: { EUR: 500 }, offeredAt: { live: false, draw: false, salon: false, orders: true } }, admin);
    await addons().addForStaff(other.id, { addonId: note.id, units: 1 }, admin);
    expect(await refusal(ctx.services.addons.update(note.id, { engraving: true }, admin))).toEqual({
      code: 'ADDON_ENGRAVING_FIXED',
      status: 409,
      message: 'This add-on is on orders: it never becomes the engraving. Create the engraving as a new service.',
    });
    expect((await ctx.services.addons.get(note.id)).engraving).toBe(false);
    await addons().removeForStaff(other.id, (await unitsOf(other.id)).find((u) => u.addon_id === note.id)!.id, admin);
    expect((await ctx.services.addons.update(note.id, { engraving: true }, admin)).engraving).toBe(true);
    await ctx.services.addons.setAside(note.id, admin);
  });

  it('LIVE: the release\'s add-ons offered change after its announcement (review of lot Q2): an add-on created then is picked, audited, and offered at the next reading of a hold; the one unpicked is no longer offered', async () => {
    const offered: string[][] = [];
    const late = await ctx.services.addons.create({ kind: 'SERVICE', name: 'A LATE CARD', skuCode: 'ADD-Q2R-LATE', prices: { EUR: 900 }, offeredAt: { live: true, draw: false, salon: false, orders: false } }, admin);
    try {
      const sale = await liveSale({
        pick: [cloth.id],
        before: async () => {
          const e = await securedEntry();
          offered.push(names((await f.live.entry(e.account_id, e.drop_id))!.addonOffer));
          // Announced (published at once): the settings are fixed, the pick is not.
          expect(await refusal(f.liveConsole.update(e.drop_id, { addonIds: [late.id] }, admin))).toMatchObject({ code: 'LIVE_ANNOUNCED', status: 409 });
          await f.liveConsole.setAddonPick(e.drop_id, { addonIds: [late.id] }, admin);
          offered.push(names((await f.live.entry(e.account_id, e.drop_id))!.addonOffer));
        },
      });
      expect(offered).toEqual([['POLISHING CLOTH'], ['A LATE CARD']]);
      const audit = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'drop.live.update').where('target_id', '=', sale.release.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
      expect(audit.details).toEqual({ before: { addonIds: [{ id: cloth.id, name: 'POLISHING CLOTH' }] }, after: { addonIds: [{ id: late.id, name: 'A LATE CARD' }] } });
      // Ended: its pick no longer changes (409 LIVE_ENDED).
      await t.db.updateTable('drops').set({ ended_at: clock.now(), ended_reason: 'ENDED' }).where('id', '=', sale.release.id).execute();
      expect(await refusal(f.liveConsole.setAddonPick(sale.release.id, { addonIds: [cloth.id] }, admin))).toMatchObject({ code: 'LIVE_ENDED', status: 409 });
    } finally {
      await ctx.services.addons.setAside(late.id, admin);
    }
  });
});

// ── Under concurrency ──────────────────────────────────────────────────────

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

/** PGlite always (it serialises the transactions); PostgreSQL with ORBES_TEST_POSTGRES_URL (a pool of 8: true parallelism). */
const BACKENDS: { name: string; skip: boolean; open(): Promise<{ db: Db; close(): Promise<void> }> }[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const root = createDb(adminUrl!);
      const name = `orbes_addons_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(root);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(root);
          await closeDb(root);
        },
      };
    },
  },
];

/** Every outcome of calls made together: 'ok' or the code of the refusal. */
async function together(calls: (() => Promise<unknown>)[]): Promise<string[]> {
  const settled = await Promise.allSettled(calls.map((c) => c()));
  return settled.map((x) => {
    if (x.status === 'fulfilled') return 'ok';
    if (x.reason instanceof DomainError) return x.reason.code;
    throw x.reason;
  });
}

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`add-ons under concurrency, on ${backend.name}`, () => {
    let handle: Awaited<ReturnType<(typeof BACKENDS)[number]['open']>>;
    let ctx: AppContext;
    let clock: ManualClock;
    let f: LiveFixture;
    let france: string;

    beforeAll(async () => {
      handle = await backend.open();
      clock = createManualClock('2026-12-06T09:00:00.000Z');
      ctx = await createContext(testConfig(), { db: handle.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
      f = await liveFixtureOn(ctx, clock);
      france = (await handle.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
      await handle.db.updateTable('models').set({ base_price_minor: 400_000, base_currency: 'EUR' }).where('id', '=', f.modelId).execute();
    });
    afterAll(async () => {
      await ctx?.close();
      await handle?.close();
    });

    /** A salon request with its choices (in EUR), from a new account. */
    async function request(items: { addonId: string; units: number }[]) {
      const account = await createAccount(handle.db);
      const r = await handle.db.insertInto('shop_requests').values({ account_id: account.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
      if (items.length) await inTransaction(handle.db, (tx) => setChoices(tx, { shopRequestId: r.id }, items, { locationId: france, currency: 'EUR' }, clock.now()));
      return { account, id: r.id };
    }
    const lastUnit = async (code: string) => {
      const a = await ctx.services.addons.create({ name: `LAST ${code}`, skuCode: `ADD-LAST-${code}`, prices: { EUR: 1500 }, weightG: 10 }, f.admin);
      await ctx.services.stock.adjust({ skuId: a.sku.id, locationId: france, delta: 1, note: 'Counted.' }, f.admin);
      return { id: a.id, skuId: a.sku.id };
    };
    const heldUnits = (skuId: string) => handle.db.selectFrom('order_addon_items').select('order_id').where('sku_id', '=', skuId).where('status', '=', 'HELD').execute();

    it('two orders take the last unit of an add-on at once: one holds it, the other is told none is left', async () => {
      // Added together in YOUR ORDERS: one ok, the other 409 ADDON_OUT_OF_STOCK.
      const added = await lastUnit('A');
      const buyers = [await request([]), await request([])];
      await ctx.services.salon.close(buyers[0]!.id, { note: 'Sold.', outcome: 'ACCEPTED' }, f.admin);
      await ctx.services.salon.close(buyers[1]!.id, { note: 'Sold.', outcome: 'ACCEPTED' }, f.admin);
      const ids: string[] = [];
      for (const b of buyers) {
        const id = (await handle.db.selectFrom('orders').select('id').where('shop_request_id', '=', b.id).executeTakeFirstOrThrow()).id;
        await ctx.services.orders.setTerms(id, { priceMinor: 400_000, currency: 'EUR' }, f.admin);
        ids.push(id);
      }
      clock.advance(MINUTE);
      const outcomes = await together(buyers.map((b, i) => () => ctx.services.orderAddons.addForAccount(b.account.id, ids[i]!, { addonId: added.id, units: 1 }, b.account.actor)));
      expect([...outcomes].sort()).toEqual(['ADDON_OUT_OF_STOCK', 'ok']);
      expect((await heldUnits(added.skuId)).map((u) => u.order_id)).toEqual([ids[outcomes.indexOf('ok')]]);
      expect(await stockLevel(handle.db, added.skuId, france)).toEqual({ onHand: 1, reserved: 1, available: 0 });

      // Carried together at ACCEPTED: one holds it, the other's sale goes on with it left out (NONE_LEFT).
      const carried = await lastUnit('B');
      const requests = [await request([{ addonId: carried.id, units: 1 }]), await request([{ addonId: carried.id, units: 1 }])];
      clock.advance(MINUTE);
      const closed = await Promise.all(requests.map((r) => ctx.services.salon.close(r.id, { note: 'Sold.', outcome: 'ACCEPTED' }, f.admin)));
      expect(closed.map((c) => c.addonsLeftOut ?? []).flat()).toEqual([{ addonId: carried.id, name: 'LAST B', units: 1, reason: 'NONE_LEFT' }]);
      expect(await heldUnits(carried.skuId)).toHaveLength(1);
      expect(await stockLevel(handle.db, carried.skuId, france)).toEqual({ onHand: 1, reserved: 1, available: 0 });
      expect(await handle.db.selectFrom('addon_choices').select('id').where('shop_request_id', 'in', requests.map((r) => r.id)).execute()).toEqual([]);
    });
  });
}
