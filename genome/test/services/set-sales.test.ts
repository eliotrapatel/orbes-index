/**
 * THE SET sold (macro scope of 2026-10-20, K44 T1 to T3; plan MACRO M3 §5.1, §5.2 and §5.5, step M3.14;
 * services/set-sales.ts), the core driven through `ordersForSetSale` directly (no flow creates a set's release before
 * M3.15 and M3.16: the set's draw and its entry are written here as those steps will write them), on the services as
 * createContext wires them:
 *
 *  - the shares (`setShares`): by the pieces' base prices in the sale's currency, equally without one (or in another
 *    currency), each floored, the remainder on the first; the set sale and one order per piece, its piece's model, size
 *    and SKU, its share as its price, in one parcel (every order travelling with the first), the shipping and a release
 *    add-on on the first only; a draw entry's set through orders.ts `orderForDrawEntry` the same, with its welcome gift;
 *  - T2: each piece bound by the scan of its own card at packing, registered by its buyer, the tier counting every piece;
 *  - each piece's invoice its share with « Part of THE SET <name> »; YOUR ORDERS' `set` (its name, one price, its pieces);
 *  - cancelled whole: one order cancelled cancels the set's others, refused once a piece has shipped (409 SET_SHIPPED);
 *    a size exchange's EXCHANGE order, made after the set shipped, cancelled alone;
 *  - returned whole (T3): a RETURN asked on one piece opens one for every piece as one group (the collector's one
 *    message), decided together once every piece is back (409 SET_RETURN_NOT_RECEIVED before), each piece's
 *    destination its own, each order's credit note; a group cancelled together; a direct return refused (409
 *    SET_RETURN_WHOLE, and for an exchange case of one piece decided REFUND); a size exchange of one piece keeps the set
 *    (its EXCHANGE order joins the set sale);
 *  - the account's export: its set sales, each order's set, an entry's size per piece.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { tierOf } from '../../src/server/services/club.js';
import { orderForDrawEntry, orderReference } from '../../src/server/services/orders.js';
import { parcelOrders } from '../../src/server/services/parcels.js';
import { ordersForSetSale, setShares, type SetSaleInput } from '../../src/server/services/set-sales.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';
import { giveSizes } from '../support/draws.js';
import { packAndShip, stockPieces, type StockedPiece } from '../support/fulfil.js';
import { createAccount } from '../support/live.js';

const MINUTE = 60_000;
const DAY = 86_400_000;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('setShares (§15 note 11)', () => {
  it('shares by the base prices when every piece has one, else equally; floored, the remainder on the first', () => {
    expect(setShares(100_000, [60_000, 30_000])).toEqual([66_667, 33_333]);
    expect(setShares(90_000, [60_000, 30_000])).toEqual([60_000, 30_000]);
    expect(setShares(100_000, [null, 30_000, 10_000])).toEqual([33_334, 33_333, 33_333]);
    expect(setShares(100_000, [0, 0])).toEqual([50_000, 50_000]);
    expect(setShares(7, [1, 1, 1, 1])).toEqual([4, 1, 1, 1]);
    expect(setShares(100_000_000, [100_000_000, 99_999_999, 3])).toEqual([50_000_000, 49_999_999, 1]);
    for (const [price, bases] of [[123_457, [1, 2, 3]], [1, [5, 5]], [0, [3, 7]]] as const) expect(setShares(price, bases).reduce((t, x) => t + x, 0)).toBe(price);
  });
});

describe('the set sold (plan MACRO M3 §5.2, T1 to T3)', () => {
  let h: Harness;
  let category: number;
  let operator: Actor;
  let admin: Actor;
  let france: string;
  let colissimo: string;
  /** THE PAIR: HALO (a ring, EUR 600) and LINEA (a necklace, EUR 300), and its published draw at EUR 1 000.00. */
  let ring: string;
  let chain: string;
  let set: { id: string; name: string };
  let draw: string;
  let ring52: string;
  let ring54: string;
  let chain45: string;
  let rank = 0;
  const issued = new Map<string, StockedPiece>();

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    await seedCatalog(h.ctx);
    category = (await h.ctx.categories.getByCode('J'))!.index;
    operator = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    ring = await model('HALO', ['52', '54'], 'RING', [60_000, 'EUR']);
    chain = await model('LINEA', ['45', '50'], 'NECKLACE', [30_000, 'EUR']);
    set = await h.ctx.services.sets.create({ name: 'The Pair', code: 'THE-PAIR', modelIds: [ring, chain], basePriceMinor: 100_000, baseCurrency: 'EUR' }, operator);
    const d = await setDraw(set.id, 100_000, 'EUR', [
      [1, '52'],
      [1, '54'],
      [2, '45'],
      [2, '50'],
    ]);
    draw = d.id;
    [ring52, ring54, chain45] = [d.sizes[0]!, d.sizes[1]!, d.sizes[2]!];
    // A STANDARD rate in EUR, so that the sale's first order carries a fee and the other travels with it.
    await h.ctx.services.clubProgram.setShippingRates([{ currency: 'EUR', service: 'STANDARD', feeMinor: 2000 }], admin);
  });
  afterAll(() => h?.close());

  const db = () => h.t.db;
  const orders = () => h.ctx.services.orders;
  const cases = () => h.ctx.services.orderCases;
  const row = (id: string) => db().selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  async function model(name: string, labels: string[], type: string, price: [number, string] | null): Promise<string> {
    const m = await db()
      .insertInto('models')
      .values({
        category_id: category,
        name,
        type,
        sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 6).toUpperCase()}`,
        default_material: '925 STERLING SILVER',
        base_price_minor: price?.[0] ?? null,
        base_currency: price?.[1] ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await giveSizes(db(), m.id, labels, type === 'NECKLACE' ? 'NECKLACE' : 'RING');
    return m.id;
  }

  /** A published draw of a set, its sizes per piece (5 pieces each), as M3.15 will write one. */
  async function setDraw(setId: string, price: number | null, currency: string | null, sizes: [number, string][]): Promise<{ id: string; sizes: string[] }> {
    const d = await db()
      .insertInto('drops')
      .values({
        set_id: setId,
        title: `THE PAIR DRAW ${randomUUID().slice(0, 4)}`,
        quantity: 5,
        opens_at: new Date('2026-11-01T10:00:00Z'),
        closes_at: new Date('2026-11-02T10:00:00Z'),
        published_at: new Date('2026-10-30T10:00:00Z'),
        price_minor: price,
        currency,
        seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
        seed_hash: new Uint8Array(32),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const ids: string[] = [];
    for (const [i, [piece, label]] of sizes.entries()) {
      ids.push((await db().insertInto('drop_sizes').values({ drop_id: d.id, piece, label, position: i + 1, stock: 5 }).returning('id').executeTakeFirstOrThrow()).id);
    }
    return { id: d.id, sizes: ids };
  }

  /** A CONFIRMED entry of the set's draw with its size per piece, as M3.15 will write one. */
  async function entry(accountId: string, sizes: { piece: number; sizeId: string }[], dropId = draw): Promise<string> {
    const now = h.clock.now();
    const e = await db()
      .insertInto('drop_entries')
      .values({ drop_id: dropId, account_id: accountId, status: 'CONFIRMED', tier: 0, seniority: 0, rank: ++rank, respond_by: now, handled_at: now })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db().insertInto('drop_entry_sizes').values(sizes.map((s) => ({ entry_id: e.id, drop_id: dropId, piece: s.piece, size_id: s.sizeId }))).execute();
    return e.id;
  }

  /** One set sold through the core, its audit entries written. */
  async function sell(o: Partial<SetSaleInput> & { accountId?: string; sizes?: { piece: number; sizeId: string }[] } = {}) {
    const accountId = o.accountId ?? (await createAccount(db())).id;
    const sizes = o.sizes ?? [
      { piece: 1, sizeId: ring52 },
      { piece: 2, sizeId: chain45 },
    ];
    const dropEntryId = await entry(accountId, sizes, o.dropId ?? draw);
    return inTransaction(db(), async (tx) => {
      const r = await ordersForSetSale(
        tx,
        {
          setId: set.id,
          dropId: draw,
          accountId,
          source: { channel: 'DRAW', dropEntryId },
          sizes,
          priceMinor: 100_000,
          currency: 'EUR',
          locationId: france,
          ...o,
        },
        operator,
        h.clock.now(),
      );
      for (const n of r.notes) await h.ctx.audit.record(n, tx);
      return { ...r, accountId, entryId: dropEntryId };
    });
  }

  /** The set's orders paid, their pieces stocked, packed in one parcel and shipped; each piece's card kept. */
  async function shipSet(orderIds: string[]): Promise<void> {
    for (const id of orderIds) await orders().transition(id, { to: 'PAID' }, operator);
    for (const id of orderIds) {
      const o = await row(id);
      for (const p of await stockPieces(h.ctx, { skuId: o.sku_id!, locationId: france, count: 1, forOrderIds: [id] }, operator)) issued.set(p.uuid, p);
    }
    await packAndShip(h.ctx, orderIds[0]!, { carrierId: colissimo, trackingNumber: '6A12345678901' }, operator);
  }

  /** The buyer registers each piece of the set with the card in its box (T2): its order DELIVERED. */
  async function register(accountId: string, orderIds: string[]): Promise<void> {
    for (const id of orderIds) {
      const piece = issued.get((await row(id)).product_id!)!;
      const scan = await h.ctx.services.verification.verify({ code: piece.data }, {});
      h.clock.advance(MINUTE);
      await h.ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, { type: 'account', id: accountId });
    }
  }

  it('makes the set sale and one order per piece, its share its price, in one parcel, the shipping and a release add-on on the first', async () => {
    const sold = await sell({ addons: [{ id: randomUUID(), label: 'GIFT BOX', priceMinor: 1500 }], surprise: 'A note inside.' });
    expect(sold.sale).toMatchObject({ set_id: set.id, drop_id: draw, account_id: sold.accountId, price_minor: 100_000, currency: 'EUR', shopify_line_item_id: null });
    const [first, second] = sold.orders;
    expect(sold.orders.map((o) => [o.channel, o.drop_entry_id, o.piece, o.set_sale_id, o.set_piece, o.model_id, o.size_label, o.price_minor, o.currency])).toEqual([
      ['DRAW', sold.entryId, 1, sold.sale.id, 1, ring, '52', 66_667, 'EUR'],
      ['DRAW', sold.entryId, 2, sold.sale.id, 2, chain, '45', 33_333, 'EUR'],
    ]);
    // Each its piece's model's SKU in that size; the release's sizes linked to them.
    const skus = await db().selectFrom('skus').select(['id', 'model_id', 'size_label']).where('id', 'in', [first!.sku_id!, second!.sku_id!]).execute();
    expect(skus.map((k) => [k.model_id, k.size_label]).sort()).toEqual([[chain, '45'], [ring, '52']].sort());
    expect((await db().selectFrom('drop_sizes').select('sku_id').where('id', '=', ring52).executeTakeFirstOrThrow()).sku_id).toBe(first!.sku_id);
    // One parcel: the second travels with the first, its shipping the first's service at 0; the add-on on the first.
    expect(second!.with_order_id).toBe(first!.id);
    expect([first!.shipping_service, first!.shipping_minor, second!.shipping_service, second!.shipping_minor]).toEqual(['STANDARD', 2000, 'STANDARD', 0]);
    expect(first!.addons.map((a) => a.label)).toEqual(['GIFT BOX']);
    expect(second!.addons).toEqual([]);
    expect([first!.surprise, second!.surprise]).toEqual(['A note inside.', 'A note inside.']);
    expect((await parcelOrders(db(), first!.id)).map((o) => o.id)).toEqual([first!.id, second!.id]);
    // Audited set.sale; each order.create names the set sale.
    const audit = await db().selectFrom('audit_logs').select('details').where('action', '=', 'set.sale').where('target_id', '=', set.id).orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ setSaleId: sold.sale.id, dropId: draw, priceMinor: 100_000, currency: 'EUR', orders: [first!.id, second!.id], shares: [66_667, 33_333] });
    const events = await db().selectFrom('order_events').select(['order_id', 'details']).where('action', '=', 'order.create').where('order_id', 'in', [first!.id, second!.id]).orderBy('id').execute();
    expect(events.map((e) => (e.details as { setSaleId: string; setPiece: number }).setPiece)).toEqual([1, 2]);
    expect(events.every((e) => (e.details as { setSaleId: string }).setSaleId === sold.sale.id)).toBe(true);
    // The console's order page (plan MACRO M3 §5.3): « Part of THE SET », its one price and every order of the sale; none on another order.
    const view = await orders().get(second!.id);
    expect(view.set).toEqual({
      saleId: sold.sale.id,
      setId: set.id,
      name: set.name,
      priceMinor: 100_000,
      currency: 'EUR',
      piece: 2,
      orders: [
        { id: first!.id, reference: orderReference(first!.id), piece: 1, channel: 'DRAW', status: 'RESERVED', model: 'HALO', variant: null, sizeLabel: '52', priceMinor: 66_667, currency: 'EUR' },
        { id: second!.id, reference: orderReference(second!.id), piece: 2, channel: 'DRAW', status: 'RESERVED', model: expect.any(String), variant: null, sizeLabel: '45', priceMinor: 33_333, currency: 'EUR' },
      ],
    });
    await orders().transition(first!.id, { to: 'CANCELLED', note: 'Test over.' }, operator);
  });

  it('shares equally without a base price in the sale\'s currency; a draw without a price leaves each order\'s to enter', async () => {
    const other = await model('NOVA', ['18'], 'BRACELET', [20_000, 'CHF']);
    const trio = await h.ctx.services.sets.create({ name: 'The Trio', code: 'TRIO', modelIds: [ring, chain, other], basePriceMinor: 100_000, baseCurrency: 'EUR' }, operator);
    const d = await setDraw(trio.id, null, null, [
      [1, '52'],
      [2, '45'],
      [3, '18'],
    ]);
    const accountId = (await createAccount(db())).id;
    const sizes = d.sizes.map((sizeId, i) => ({ piece: i + 1, sizeId }));
    const entryId = await entry(accountId, sizes, d.id);
    const priced = await inTransaction(db(), (tx) => ordersForSetSale(tx, { setId: trio.id, dropId: d.id, accountId, source: { channel: 'DRAW', dropEntryId: entryId }, sizes, priceMinor: 100_000, currency: 'EUR', locationId: france }, operator, h.clock.now()));
    // NOVA's base price is in CHF: no proportion holds, so equally, the remainder on the first.
    expect(priced.orders.map((o) => o.price_minor)).toEqual([33_334, 33_333, 33_333]);
    // A test's database is one connection: what the transaction needs is written before it.
    const acc = (await createAccount(db())).id;
    const e2 = await entry(acc, sizes, d.id);
    const unpriced = await inTransaction(db(), (tx) =>
      ordersForSetSale(tx, { setId: trio.id, dropId: d.id, accountId: acc, source: { channel: 'DRAW', dropEntryId: e2 }, sizes, priceMinor: null, currency: null, locationId: france }, operator, h.clock.now()),
    );
    expect(unpriced.sale).toMatchObject({ price_minor: null, currency: null });
    expect(unpriced.orders.map((o) => [o.price_minor, o.currency, o.set_piece])).toEqual([[null, null, 1], [null, null, 2], [null, null, 3]]);
    // A size not of its piece, or a piece without one, is the caller's error: nothing is written.
    const e3 = await entry((await createAccount(db())).id, sizes, d.id);
    await expect(inTransaction(db(), (tx) => ordersForSetSale(tx, { setId: trio.id, dropId: d.id, accountId: accountId, source: { channel: 'DRAW', dropEntryId: e3 }, sizes: [{ piece: 1, sizeId: d.sizes[1]! }, { piece: 2, sizeId: d.sizes[1]! }, { piece: 3, sizeId: d.sizes[2]! }], priceMinor: 1, currency: 'EUR', locationId: france }, operator, h.clock.now()))).rejects.toThrow(/piece 1 has no size/);
    await expect(inTransaction(db(), (tx) => ordersForSetSale(tx, { setId: trio.id, dropId: d.id, accountId: accountId, source: { channel: 'DRAW', dropEntryId: e3 }, sizes: sizes.slice(0, 2), priceMinor: 1, currency: 'EUR', locationId: france }, operator, h.clock.now()))).rejects.toThrow(/piece 3 has no size/);
    expect(await db().selectFrom('orders').select('id').where('drop_entry_id', '=', e3).execute()).toEqual([]);
    // Cancelled whole, so that no order of these sizes waits ahead of the next tests'.
    await orders().transition(priced.orders[0]!.id, { to: 'CANCELLED', note: 'Test over.' }, operator);
    await orders().transition(unpriced.orders[2]!.id, { to: 'CANCELLED', note: 'Test over.' }, operator);
    expect((await db().selectFrom('orders').select('status').where('set_sale_id', 'in', [priced.sale.id, unpriced.sale.id]).execute()).map((o) => o.status)).toEqual(Array(6).fill('CANCELLED'));
  });

  it('a set\'s draw entry confirmed makes its set sale through orderForDrawEntry: its pieces in the sizes it chose, idempotent', async () => {
    const accountId = (await createAccount(db())).id;
    const entryId = await entry(accountId, [
      { piece: 1, sizeId: ring54 },
      { piece: 2, sizeId: chain45 },
    ]);
    const made = await inTransaction(db(), (tx) => orderForDrawEntry(tx, entryId, operator, h.clock.now()));
    expect(made.orders.map((o) => [o.set_piece, o.size_label, o.price_minor])).toEqual([[1, '54', 66_667], [2, '45', 33_333]]);
    expect(made.order!.id).toBe(made.orders[0]!.id);
    expect((await inTransaction(db(), (tx) => orderForDrawEntry(tx, entryId, operator, h.clock.now()))).orders).toEqual([]);
    expect(await db().selectFrom('set_sales').select('id').where('account_id', '=', accountId).execute()).toHaveLength(1);
    await orders().transition(made.orders[1]!.id, { to: 'CANCELLED', note: 'Test over.' }, operator);
  });

  it('is cancelled whole: one order cancelled cancels the set\'s others; refused once a piece has shipped (409 SET_SHIPPED)', async () => {
    const sold = await sell();
    const [first, second] = sold.orders;
    await orders().transition(first!.id, { to: 'PAID' }, operator);
    await orders().transition(second!.id, { to: 'CANCELLED', note: 'The client changed their mind.' }, operator);
    expect((await row(first!.id)).status).toBe('CANCELLED');
    expect((await row(second!.id)).status).toBe('CANCELLED');
    // The paid one credited by its own credit note.
    expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', first!.id).orderBy('issued_at').orderBy('kind', 'desc').execute()).map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
    const shipped = await sell();
    await shipSet(shipped.orders.map((o) => o.id));
    expect(await refusal(orders().transition(shipped.orders[1]!.id, { to: 'CANCELLED', note: 'Too late.' }, operator))).toEqual({
      code: 'SET_SHIPPED',
      status: 409,
      message: 'A piece of this set has shipped: a set is cancelled whole, never in part.',
    });
    expect((await Promise.all(shipped.orders.map((o) => row(o.id)))).map((o) => o.status)).toEqual(['SHIPPED', 'SHIPPED']);
  });

  it('T2: each piece bound by its own card\'s scan, registered by its buyer; the tier counts every piece; its invoices say « Part of THE SET »; YOUR ORDERS groups it', async () => {
    const buyer = await createAccount(db());
    const sold = await sell({ accountId: buyer.id });
    const ids = sold.orders.map((o) => o.id);
    await shipSet(ids);
    const [a, b] = await Promise.all(ids.map(row));
    expect(a!.product_id).not.toBeNull();
    expect(b!.product_id).not.toBeNull();
    expect(a!.product_id).not.toBe(b!.product_id);
    expect((await tierOf(db(), buyer.id, h.clock.now())).pieces).toBe(0);
    await register(buyer.id, ids);
    expect((await Promise.all(ids.map(row))).map((o) => o.status)).toEqual(['DELIVERED', 'DELIVERED']);
    expect((await tierOf(db(), buyer.id, h.clock.now())).pieces).toBe(2);
    // Each piece's invoice: its share, the set named beneath it; the shipping on the first only.
    const lines = async (id: string) => (await db().selectFrom('invoices').select('lines').where('order_id', '=', id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).lines as { kind: string; label: string; detail: string | null; amountMinor: number }[];
    const title = (await db().selectFrom('drops').select('title').where('id', '=', draw).executeTakeFirstOrThrow()).title;
    expect(await lines(ids[0]!)).toEqual([
      { kind: 'PIECE', label: 'HALO · SIZE 52', detail: `DRAW · ${title} · Part of THE SET The Pair`, amountMinor: 66_667 },
      { kind: 'SHIPPING', label: 'SHIPPING · STANDARD', detail: null, amountMinor: 2000 },
    ]);
    expect(await lines(ids[1]!)).toEqual([{ kind: 'PIECE', label: 'LINEA · SIZE 45', detail: `DRAW · ${title} · Part of THE SET The Pair`, amountMinor: 33_333 }]);
    // YOUR ORDERS: each piece names its set, the one price and its pieces in order.
    const mine = await orders().forAccount(buyer.id);
    expect(mine.filter((o) => o.set !== null).map((o) => [o.id, o.set])).toEqual([
      [ids[0], { saleId: sold.sale.id, name: 'The Pair', priceMinor: 100_000, currency: 'EUR', piece: 1, pieces: ids }],
      [ids[1], { saleId: sold.sale.id, name: 'The Pair', priceMinor: 100_000, currency: 'EUR', piece: 2, pieces: ids }],
    ]);
  });

  it('T3: a RETURN on one piece returns the set: one group, decided together once every piece is back, each piece its own destination', async () => {
    const buyer = await createAccount(db());
    const sold = await sell({ accountId: buyer.id });
    const ids = sold.orders.map((o) => o.id);
    await shipSet(ids);
    await register(buyer.id, ids);
    // Client Services' direct return of one piece is refused: a set is returned whole, as a group of cases.
    expect(await refusal(orders().returnOrder(ids[0]!, { outcome: 'RESTOCKED', locationId: france, note: 'Back.' }, operator))).toEqual({
      code: 'SET_RETURN_WHOLE',
      status: 409,
      message: 'A set is returned whole: open the return of the set as an order case.',
    });
    h.clock.advance(DAY);
    const caseId = await cases().request(buyer.id, ids[1]!, { kind: 'RETURN', reason: 'NOT_AS_EXPECTED', note: 'Not for me.' }, buyer.actor);
    const opened = await cases().get(caseId);
    expect(opened.group).toMatchObject({ cases: [{ order: { id: ids[0] }, status: 'OPEN', received: false }, { id: caseId, order: { id: ids[1] }, status: 'OPEN', received: false }] });
    const group = opened.group!;
    const rows = await db().selectFrom('order_cases').selectAll().where('group_id', '=', group.id).orderBy('opened_at').execute();
    expect(rows.map((c) => [c.kind, c.reason, c.opened_by_type, c.note])).toEqual([
      ['RETURN', 'NOT_AS_EXPECTED', 'account', 'Not for me.'],
      ['RETURN', 'NOT_AS_EXPECTED', 'account', 'Not for me.'],
    ]);
    // One message for the set, written once and named on each case.
    expect(new Set(rows.map((c) => c.message_id)).size).toBe(1);
    const message = await db().selectFrom('client_messages').select('body').where('id', '=', rows[0]!.message_id!).executeTakeFirstOrThrow();
    expect(message.body).toBe('RETURN OF THE SET The Pair REQUESTED — The piece is not as I expected.\n\nNot for me.');
    // Another request on either piece: a case is open.
    expect(await refusal(cases().request(buyer.id, ids[0]!, { kind: 'RETURN', reason: 'SIZE' }, buyer.actor))).toMatchObject({ code: 'ORDER_CASE_OPEN' });
    // Decided together once every piece is back.
    const scope = null;
    await cases().receive(group.cases[0]!.id, { pieceState: 'OK' }, operator, scope);
    expect(await refusal(cases().decide(group.cases[0]!.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Returned.' }, operator, { admin: false }))).toEqual({
      code: 'SET_RETURN_NOT_RECEIVED',
      status: 409,
      message: 'Every piece of the set is received before ORBES decides its return.',
    });
    expect(await refusal(cases().decide(caseId, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Returned.' }, operator, { admin: false }))).toMatchObject({ code: 'SET_RETURN_NOT_RECEIVED' });
    await cases().receive(caseId, { pieceState: 'DAMAGED' }, operator, scope);
    // The archive is an ADMIN's, for any piece of the group.
    const pieces = [{ caseId, pieceTo: 'ARCHIVED' as const }];
    expect(await refusal(cases().decide(group.cases[0]!.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Returned.', pieces }, operator, { admin: false }))).toMatchObject({ code: 'FORBIDDEN' });
    const decided = await cases().decide(group.cases[0]!.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: france, note: 'Returned whole.', pieces }, admin, { admin: true });
    expect(decided.group).toEqual([
      { caseId: group.cases[0]!.id, productId: expect.any(String), pieceTo: 'RESTOCKED' },
      { caseId, productId: expect.any(String), pieceTo: 'ARCHIVED' },
    ]);
    expect(decided.claimCodes).toHaveLength(1);
    expect((await Promise.all(ids.map(row))).map((o) => o.status)).toEqual(['RETURNED', 'RETURNED']);
    expect((await db().selectFrom('order_cases').select(['status', 'outcome', 'piece_to']).where('group_id', '=', group.id).orderBy('opened_at').execute()).map((c) => [c.status, c.outcome, c.piece_to])).toEqual([
      ['CLOSED', 'REFUND', 'RESTOCKED'],
      ['CLOSED', 'REFUND', 'ARCHIVED'],
    ]);
    // Each order credited in full; the archived piece retired, the other back on sale; the tier no longer counts them.
    for (const id of ids) expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', id).execute()).map((i) => i.kind).sort()).toEqual(['CREDIT_NOTE', 'INVOICE']);
    const products = await db().selectFrom('products').select(['id', 'status']).where('id', 'in', (await Promise.all(ids.map(row))).map((o) => o.product_id!)).execute();
    expect(products.map((p) => p.status).sort()).toEqual(['RESOLD', 'RETIRED']);
    expect((await tierOf(db(), buyer.id, h.clock.now())).pieces).toBe(0);
    expect(await db().selectFrom('audit_logs').select('details').where('action', '=', 'order.case.decide').where('target_id', 'in', ids).execute()).toHaveLength(2);
  });

  it('T3: Client Services opens a set\'s return as a group too, and cancelling one case ends the group', async () => {
    const buyer = await createAccount(db());
    const sold = await sell({ accountId: buyer.id });
    const ids = sold.orders.map((o) => o.id);
    await shipSet(ids);
    const c = await cases().open(ids[0]!, { kind: 'RETURN', reason: 'OTHER', note: 'Asked by phone.' }, operator);
    expect(c.group!.cases.map((x) => x.order.id)).toEqual(ids);
    await cases().cancel(c.group!.cases[1]!.id, { note: 'The client kept it.' }, operator);
    expect((await db().selectFrom('order_cases').select('status').where('group_id', '=', c.group!.id).execute()).map((x) => x.status)).toEqual(['CANCELLED', 'CANCELLED']);
    // A size exchange of one piece stays a case of its own: its EXCHANGE order joins the set sale in its place.
    const sizes = await db().selectFrom('skus').select('id').where('model_id', '=', ring).where('size_label', '=', '54').executeTakeFirstOrThrow();
    for (const p of await stockPieces(h.ctx, { skuId: sizes.id, locationId: france, count: 1 }, operator)) issued.set(p.uuid, p);
    h.clock.advance(DAY);
    const ex = await cases().open(ids[0]!, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: sizes.id, note: 'One size up.' }, operator);
    expect(ex.group).toBeNull();
    await cases().receive(ex.id, { pieceState: 'OK' }, operator, null);
    // Refunding the exchange would return one piece alone: a set is returned whole.
    expect(await refusal(cases().decide(ex.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, operator, { admin: false }))).toEqual({
      code: 'SET_RETURN_WHOLE',
      status: 409,
      message: 'A set is returned whole: open the return of the set as an order case.',
    });
    expect((await row(ids[0]!)).status).toBe('SHIPPED');
    const done = await cases().decide(ex.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged.' }, operator, { admin: false });
    const exchange = await row(done.case.decision!.exchangeOrder!.id);
    expect([exchange.channel, exchange.set_sale_id, exchange.set_piece, exchange.size_label, exchange.price_minor]).toEqual(['EXCHANGE', sold.sale.id, 1, '54', 66_667]);
    const mine = await orders().forAccount(buyer.id);
    expect(mine.find((o) => o.id === exchange.id)!.set).toMatchObject({ saleId: sold.sale.id, piece: 1, pieces: [ids[0], exchange.id, ids[1]] });
    // Its invoice names the set too.
    const lines = (await db().selectFrom('invoices').select('lines').where('order_id', '=', exchange.id).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow()).lines as { kind: string; detail: string | null }[];
    expect(lines.find((l) => l.kind === 'PIECE')!.detail).toContain('SIZE EXCHANGE');
    expect(lines.find((l) => l.kind === 'PIECE')!.detail).toContain('Part of THE SET The Pair');
    // The set has shipped: its EXCHANGE order is cancelled alone (§15 note 12 is the set's cancellation before shipping).
    await orders().transition(exchange.id, { to: 'CANCELLED', note: 'The new size cannot be made.' }, operator);
    expect((await row(exchange.id)).status).toBe('CANCELLED');
    expect((await Promise.all(ids.map(row))).map((o) => o.status)).toEqual(['RETURNED', 'SHIPPED']);
  });

  it('the account\'s export lists its set sales, each order\'s set and an entry\'s size per piece', async () => {
    const buyer = await createAccount(db());
    const sold = await sell({ accountId: buyer.id });
    const out = await h.ctx.services.owners.exportData(buyer.id, admin);
    expect(out.setSales).toEqual([{ set: 'The Pair', release: expect.stringContaining('THE PAIR DRAW'), priceMinor: 100_000, currency: 'EUR', soldAt: expect.any(Date), orders: sold.orders.map((o) => expect.stringMatching(/^[0-9A-Z-]+$/)) }]);
    expect(out.orders.map((o) => o.set).sort((a, b) => a!.piece - b!.piece)).toEqual([
      { name: 'The Pair', piece: 1, salePriceMinor: 100_000, saleCurrency: 'EUR', saleOrders: out.setSales[0]!.orders },
      { name: 'The Pair', piece: 2, salePriceMinor: 100_000, saleCurrency: 'EUR', saleOrders: out.setSales[0]!.orders },
    ]);
    expect(out.dropEntries.find((e) => e.entryId === sold.entryId)!.sizes).toEqual([
      { piece: 1, size: '52' },
      { piece: 2, size: '45' },
    ]);
  });
});
