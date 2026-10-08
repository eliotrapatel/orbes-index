/**
 * MY PIECES' orders over HTTP (plan LIVE RELEASE+, step S3; GET /api/v1/account/orders), with real sessions:
 *
 *  - an account session only (401, no-store, without one), rate group `api`;
 *  - the account's own orders, every channel: a LIVE RELEASE's two pieces with their add-on, a draw's order whose size
 *    and price ORBES Client Services has still to enter, a private salon's order paid, made, shipped and delivered, one
 *    cancelled after it was paid; the latest first, the pieces of one sale in their order;
 *  - each with its steps and their times, the model, the size, the add-ons and the price; once shipped the carrier and
 *    the tracking number with its link;
 *  - a piece's origin is the order that fulfils it, never one CANCELLED or RETURNED that keeps its link;
 *  - never another account's order, and never the house's side of one: its location, what it holds, the surprise, the
 *    buyer's details, the engraving's words, the value declared, the notes, who handled it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderReference, type OrderTransitionInput } from '../../src/server/services/orders.js';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { jpegPhoto } from '../support/images.js';
import { createLiveRelease, holdPieces, liveFixtureOn, type LiveFixture } from '../support/live.js';
import { accountClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';
import { countPiecesIn, packAndShip, stockPieces } from '../support/fulfil.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { poolDraw } from '../support/draws.js';

type Json = Record<string, any>;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('MY PIECES: the account\'s orders (GET /api/v1/account/orders)', () => {
  let h: Harness;
  let f: LiveFixture;
  let colissimo: string;
  let mine: Client;
  let mineId: string;
  let other: Client;
  let otherId: string;
  /** The account's orders as created: the LIVE pieces 1 and 2, the draw, the salon's delivered and cancelled ones. */
  const ids: Record<'live1' | 'live2' | 'draw' | 'delivered' | 'cancelled', string> = { live1: '', live2: '', draw: '', delivered: '', cancelled: '' };
  let otherOrder: string;

  const accountId = async (email: string) => (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', email).executeTakeFirstOrThrow()).id;
  const orders = () => h.ctx.services.orders;
  const step = (id: string, input: OrderTransitionInput) => {
    h.clock.advance(MINUTE);
    return orders().transition(id, input, f.admin);
  };

  /** A request of the private salon closed as ACCEPTED by Client Services: its order. */
  async function salonOrder(account: string): Promise<string> {
    h.clock.advance(MINUTE);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: account, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    return (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-09T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    colissimo = (await h.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    const a = await accountClient(h);
    mine = a.client;
    mineId = await accountId(a.email);
    const b = await accountClient(h);
    other = b.client;
    otherId = await accountId(b.email);

    // A LIVE RELEASE: two pieces in size 52, with the engraving, PAY.
    const opensAt = new Date(h.clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 5 }], perAccount: 2, priceMinor: 480_000, addons: [{ label: 'Engraving', priceMinor: 25_000 }] });
    await h.ctx.db.updateTable('drops').set({ title: 'MONOLITHE — LIVE' }).where('id', '=', r.id).execute();
    const actor = { type: 'account' as const, id: mineId };
    h.clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(mineId, r.id, { sizeId: r.sizes[0]!.id, quantity: 2 }, actor);
    h.clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(mineId, r.id))!.turn!.token!;
    await f.live.press(mineId, r.id, token);
    h.clock.advance(1500);
    await f.live.secure(mineId, r.id, token, actor);
    await f.live.setAddons(mineId, r.id, r.addons.map((x) => x.id), actor);
    await f.live.confirm(mineId, r.id, actor);
    const live = await h.ctx.db.selectFrom('orders').select('id').where('account_id', '=', mineId).where('channel', '=', 'LIVE').orderBy('piece').execute();
    [ids.live1, ids.live2] = live.map((o) => o.id) as [string, string];

    // A draw: the account's entry drawn, then confirmed by Client Services; its size and price to be entered.
    h.clock.advance(HOUR);
    const T = new Date(h.clock.now().getTime() + HOUR);
    const d = await poolDraw(f.drops, f.db, { modelId: f.modelId, title: 'MONOLITHE — RELEASE I', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0 }, f.admin);
    h.clock.set(new Date(T.getTime() + MINUTE));
    await f.drops.enter(mineId, d.id, actor);
    h.clock.set(new Date(T.getTime() + 2 * HOUR));
    await f.drops.draw(d.id, f.admin);
    const entry = (await h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).executeTakeFirstOrThrow()).id;
    await f.drops.confirm(d.id, entry, 'Sold by phone.', f.admin);
    ids.draw = (await h.ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry).executeTakeFirstOrThrow()).id;

    // The private salon: terms, buyer and engraving entered; paid, its piece taken from the stock, shipped, delivered.
    ids.delivered = await salonOrder(mineId);
    await orders().setTerms(ids.delivered, { sizeLabel: '54', priceMinor: 490_000, currency: 'EUR', engravingText: 'A. & L.' }, f.admin);
    await orders().setBuyer(ids.delivered, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' }, f.admin);
    await step(ids.delivered, { to: 'PAID', note: 'Paid by transfer.' });
    const held = await h.ctx.db.selectFrom('orders').select(['sku_id', 'location_id']).where('id', '=', ids.delivered).executeTakeFirstOrThrow();
    await stockPieces(h.ctx, { skuId: held.sku_id!, locationId: held.location_id, count: 1, material: '925 STERLING SILVER', forOrderIds: [ids.delivered] }, f.admin);
    h.clock.advance(MINUTE);
    await packAndShip(h.ctx, ids.delivered, { carrierId: colissimo, trackingNumber: '6A 1234 5678 901', declaredValueMinor: 470_123 }, f.admin);
    await step(ids.delivered, { to: 'DELIVERED' });

    // Another, paid then cancelled.
    ids.cancelled = await salonOrder(mineId);
    await orders().setTerms(ids.cancelled, { priceMinor: 300_000, currency: 'EUR' }, f.admin);
    await step(ids.cancelled, { to: 'PAID' });
    await step(ids.cancelled, { to: 'CANCELLED', note: 'The client withdrew.' });

    // The other account's.
    otherOrder = await salonOrder(otherId);
  }, 120_000);
  afterAll(() => h?.close());

  it('needs an account session: 401, never stored', async () => {
    const res = await h.client().get('/api/v1/account/orders');
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe('UNAUTHORIZED');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('lists the account\'s own orders, every channel, the latest first, the pieces of one sale in their order; never stored', async () => {
    const res = await mine.get('/api/v1/account/orders');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const list = (safeJson(res) as { orders: Json[] }).orders;
    expect(list.map((o) => o.id)).toEqual([ids.cancelled, ids.delivered, ids.draw, ids.live1, ids.live2]);
    expect(list.map((o) => [o.channel, o.status])).toEqual([
      ['SALON', 'CANCELLED'],
      ['SALON', 'DELIVERED'],
      ['DRAW', 'RESERVED'],
      ['LIVE', 'RESERVED'],
      ['LIVE', 'RESERVED'],
    ]);
    expect(list.map((o) => o.reference)).toEqual(list.map((o) => orderReference(o.id)));
    // The other account reads its own only.
    const theirs = (safeJson(await other.get('/api/v1/account/orders')) as { orders: Json[] }).orders;
    expect(theirs.map((o) => o.id)).toEqual([otherOrder]);
    expect(list.map((o) => o.id)).not.toContain(otherOrder);
  });

  it('says each order\'s steps and their times, the model, the size, the add-ons and the price; once shipped, the carrier and the tracking link', async () => {
    const list = (safeJson(await mine.get('/api/v1/account/orders')) as { orders: Json[] }).orders;
    const byId = new Map(list.map((o) => [o.id, o]));
    const row = (id: string) => h.ctx.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const times = async (id: string) => {
      const o = await row(id);
      return { reservedAt: iso(o.reserved_at), paidAt: iso(o.paid_at), shippedAt: iso(o.shipped_at), deliveredAt: iso(o.delivered_at), cancelledAt: iso(o.cancelled_at), returnedAt: iso(o.returned_at) };
    };

    // A LIVE RELEASE's piece: its release, its size, its price and the add-on as sold.
    expect(byId.get(ids.live1)).toEqual({
      id: ids.live1,
      reference: orderReference(ids.live1),
      channel: 'LIVE',
      release: 'MONOLITHE — LIVE',
      model: 'MONOLITHE',
      // NOCTURNE N1: its label among its variants; none for a model alone.
      modelVariant: null,
      size: { label: '52' },
      priceMinor: 480_000,
      currency: 'EUR',
      addons: [{ label: 'Engraving', priceMinor: 25_000 }],
      // BP-19 T4: an account below PLATINE, no rate set: no shipping, as before.
      shipping: null,
      // BP-19 T5: travelling with no order, not a welcome gift, no credit taken off it.
      withOrder: null,
      giftTier: null,
      creditMinor: 0,
      status: 'RESERVED',
      ...(await times(ids.live1)),
      shipment: null,
      // Not paid yet: no invoice; its care guide (step S4, M6).
      documents: { invoice: null, creditNote: null, others: [], careGuide: true, certificate: false },
      // NOCTURNE, addition 3: its model's photograph; none taken yet.
      imageUrl: null,
      // Plan NEXT LOT §3.4: no new claim code waits for it.
      claimCode: null,
      // Plan NEXT LOT §3.6.B: no delivery address yet (the account saved none); its own order, the address open to change.
      address: null,
      addressOf: null,
      // Plan NEXT LOT §3.6.C: its release sold the engraving as an add-on ('Engraving'): its words only, no second price.
      engraving: null,
      engravingOffer: { priceMinor: null, included: true, maxLength: 20 },
      editable: { address: true, engraving: true },
      // Plan NEXT LOT §3.6.A, §3.6.D: not paid, not in preparation; no delivery problem, no return to ask, no case.
      preparingAt: null,
      deliveryIssue: false,
      returnable: null,
      case: null,
    });
    // A draw's: its size and price still to be entered.
    expect(byId.get(ids.draw)).toMatchObject({ channel: 'DRAW', release: 'MONOLITHE — RELEASE I', model: 'MONOLITHE', size: null, priceMinor: null, currency: null, addons: [], status: 'RESERVED', paidAt: null, shipment: null });
    // The salon's, delivered: every step with its time; the carrier and the number with its link (spaces left out).
    const delivered = byId.get(ids.delivered)!;
    expect(delivered).toEqual({
      id: ids.delivered,
      reference: orderReference(ids.delivered),
      channel: 'SALON',
      release: null,
      model: 'MONOLITHE',
      modelVariant: null,
      size: { label: '54' },
      priceMinor: 490_000,
      currency: 'EUR',
      addons: [],
      shipping: null,
      withOrder: null,
      giftTier: null,
      creditMinor: 0,
      status: 'DELIVERED',
      ...(await times(ids.delivered)),
      shipment: { carrier: 'Colissimo', trackingNumber: '6A 1234 5678 901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901' },
      // Paid: its invoice (step S4, M6); its piece not registered by the account: no certificate yet.
      documents: { invoice: { number: expect.stringMatching(/^INV-2026-\d{6}$/), issuedAt: delivered.paidAt }, creditNote: null, others: [], careGuide: true, certificate: false },
      imageUrl: null,
      claimCode: null,
      // Plan NEXT LOT §3.6.B: its delivery address, as Client Services entered it (the country added to pack it); no
      // longer open to change once shipped.
      address: { name: 'Jane Doe', lines: '1 rue de la Paix\n75002 Paris', country: 'FR', phone: null },
      addressOf: null,
      // Plan NEXT LOT §3.6.C: the words Client Services entered, now the collector's to read, with no price (none set).
      engraving: { text: 'A. & L.', priceMinor: null },
      engravingOffer: { priceMinor: null, included: false, maxLength: 20 },
      editable: { address: false, engraving: false },
      // Plan NEXT LOT §3.6.A: in preparation from the moment its piece came into stock (after its payment), kept once
      // shipped and delivered; §3.6.D: delivered, a return or an exchange may be asked for 14 days.
      preparingAt: (await h.ctx.db.selectFrom('order_events').select('created_at').where('order_id', '=', ids.delivered).where('action', '=', 'order.serve').executeTakeFirstOrThrow()).created_at.toISOString(),
      deliveryIssue: false,
      returnable: { until: new Date(Date.parse(delivered.deliveredAt) + 14 * 24 * HOUR).toISOString(), sizes: expect.any(Array) },
      case: null,
    });
    for (const k of ['reservedAt', 'paidAt', 'shippedAt', 'deliveredAt']) expect(delivered[k], k).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(delivered.reservedAt)).toBeLessThan(Date.parse(delivered.paidAt));
    expect(Date.parse(delivered.paidAt)).toBeLessThan(Date.parse(delivered.shippedAt));
    expect(Date.parse(delivered.shippedAt)).toBeLessThan(Date.parse(delivered.deliveredAt));
    // Cancelled after it was paid: both times.
    expect(byId.get(ids.cancelled)).toMatchObject({ status: 'CANCELLED', priceMinor: 300_000, currency: 'EUR', size: null, paidAt: expect.any(String), cancelledAt: expect.any(String), shippedAt: null, shipment: null });
  });

  it('never says the house\'s side of an order: where it is served from, what it holds, the surprise, the value declared, the notes, who handled it (its delivery address and its engraving are the collector\'s own since plan NEXT LOT §3.6.B and §3.6.C)', async () => {
    await h.ctx.db.updateTable('orders').set({ surprise: 'A silk pouch' }).where('id', '=', ids.live1).execute();
    const res = await mine.get('/api/v1/account/orders');
    const list = (safeJson(res) as { orders: Json[] }).orders;
    for (const o of list) {
      expect(Object.keys(o).sort()).toEqual(
        ['addons', 'address', 'addressOf', 'cancelledAt', 'case', 'channel', 'claimCode', 'creditMinor', 'currency', 'deliveredAt', 'deliveryIssue', 'documents', 'editable', 'engraving', 'engravingOffer', 'giftTier', 'id', 'imageUrl', 'model', 'modelVariant', 'paidAt', 'preparingAt', 'priceMinor', 'reference', 'release', 'reservedAt', 'returnable', 'returnedAt', 'shipment', 'shippedAt', 'shipping', 'size', 'status', 'withOrder'].sort(),
      );
      expect(Object.keys(o.documents).sort()).toEqual(['careGuide', 'certificate', 'creditNote', 'invoice', 'others']);
      for (const a of o.addons) expect(Object.keys(a).sort()).toEqual(['label', 'priceMinor']);
    }
    // The delivery address and the engraving's words are the collector's own (plan NEXT LOT §3.6.B, §3.6.C), never who
    // entered them.
    for (const secret of ['A silk pouch', '470123', 'WAREHOUSE', 'transfer', 'withdrew', 'Sold by phone', f.admin.id, 'BENCH', 'STOCK', 'O26-J-', 'STAFF', 'COLLECTOR']) {
      expect(res.body, secret).not.toContain(secret);
    }
  });

  it('carries the cover photograph of each order\'s model, never a piece\'s own (plan NOCTURNE, addition 3)', async () => {
    const image = (await h.ctx.services.media.setModelImage(f.modelId, { mime: 'image/jpeg', bytes: jpegPhoto(400, 400) }, SYSTEM_ACTOR)).url;
    const list = (safeJson(await mine.get('/api/v1/account/orders')) as { orders: Json[] }).orders;
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) expect(o.imageUrl).toBe(image);
    expect(image).toMatch(/^\/api\/v1\/media\/[0-9a-f]{64}$/);
  });

  it('says where a piece of the account comes from: its order, its step and its release; nothing for another account, nor for a piece without one (addition 2)', async () => {
    const piece = (await h.ctx.db.selectFrom('orders').select('product_id').where('id', '=', ids.delivered).executeTakeFirstOrThrow()).product_id!;
    const order = await h.ctx.db.selectFrom('orders').selectAll().where('id', '=', ids.delivered).executeTakeFirstOrThrow();
    await h.ctx.db.insertInto('ownership').values({ product_id: piece, account_id: mineId, acquired_via: 'FIRST_REGISTRATION', verified: true, started_at: h.clock.now() }).execute();
    const products = (safeJson(await mine.get('/api/v1/account/products')) as { products: Json[] }).products;
    const held = products.find((p) => p.origin);
    // The private salon's order: no release; its reference, its step and when it reached it.
    expect(held?.origin).toEqual({ release: null, order: { reference: orderReference(ids.delivered), channel: 'SALON', status: 'DELIVERED', at: order.delivered_at!.toISOString() } });
    // Passed on to another account: that account sees no order of the first one.
    await h.ctx.db.updateTable('ownership').set({ ended_at: h.clock.now(), ended_reason: 'TRANSFER' }).where('product_id', '=', piece).where('account_id', '=', mineId).execute();
    await h.ctx.db.insertInto('ownership').values({ product_id: piece, account_id: otherId, acquired_via: 'TRANSFER', verified: true, started_at: h.clock.now() }).execute();
    const theirs = (safeJson(await other.get('/api/v1/account/products')) as { products: Json[] }).products;
    expect(theirs.map((p) => p.origin)).toEqual([null]);
    expect(JSON.stringify(theirs)).not.toContain(orderReference(ids.delivered));
  });

  it('names a draw\'s release by when it was drawn, a LIVE RELEASE\'s by its T0, each with its id (addition 2)', async () => {
    const [drawPiece, livePiece, boutique] = await holdPieces(h.ctx.db, mineId, 3, f.modelId);
    await h.ctx.db.updateTable('orders').set({ product_id: drawPiece! }).where('id', '=', ids.draw).execute();
    await h.ctx.db.updateTable('orders').set({ product_id: livePiece! }).where('id', '=', ids.live2).execute();
    const draw = await h.ctx.db.selectFrom('orders as o').innerJoin('drops as d', 'd.id', 'o.drop_id').select(['d.id', 'd.drawn_at']).where('o.id', '=', ids.draw).executeTakeFirstOrThrow();
    const live = await h.ctx.db.selectFrom('orders as o').innerJoin('drops as d', 'd.id', 'o.drop_id').select(['d.id', 'd.opens_at', 'o.reserved_at']).where('o.id', '=', ids.live2).executeTakeFirstOrThrow();
    const owned = await h.ctx.services.ownership.listForAccount(mineId);
    const originOf = async (uuid: string) => {
      const pid = (await h.ctx.db.selectFrom('products').select('product_id').where('id', '=', uuid).executeTakeFirstOrThrow()).product_id;
      return owned.find((p) => p.productId === pid)!.origin;
    };
    expect(await originOf(drawPiece!)).toEqual({ release: { id: draw.id, mode: 'DRAW', at: draw.drawn_at }, order: { reference: orderReference(ids.draw), channel: 'DRAW', status: 'RESERVED', at: expect.any(Date) } });
    expect(await originOf(livePiece!)).toEqual({ release: { id: live.id, mode: 'LIVE', at: live.opens_at }, order: { reference: orderReference(ids.live2), channel: 'LIVE', status: 'RESERVED', at: live.reserved_at } });
    // A boutique sale: no order, nothing said.
    expect(await originOf(boutique!)).toBeNull();
  });

  it('never takes as a piece\'s origin an order CANCELLED or RETURNED, which keeps its link but no longer fulfils it (addition 2)', async () => {
    const productIdOf = async (uuid: string) => (await h.ctx.db.selectFrom('products').select('product_id').where('id', '=', uuid).executeTakeFirstOrThrow()).product_id;
    // CANCELLED: the order keeps its piece (lot E); the same piece reaches the account another way (a boutique).
    const [kept] = await holdPieces(h.ctx.db, mineId, 1, f.modelId);
    await h.ctx.db.updateTable('orders').set({ product_id: kept! }).where('id', '=', ids.cancelled).execute();
    // RETURNED once delivered: ORBES takes the piece back (its link kept), then it is registered to the account again.
    const returned = (await h.ctx.db.selectFrom('orders').select('product_id').where('id', '=', ids.delivered).executeTakeFirstOrThrow()).product_id!;
    await orders().returnOrder(ids.delivered, { outcome: 'ARCHIVED', note: 'Returned to the house.' }, f.admin);
    h.clock.advance(MINUTE);
    await h.ctx.db.insertInto('ownership').values({ product_id: returned, account_id: mineId, acquired_via: 'FIRST_REGISTRATION', verified: true, started_at: h.clock.now() }).execute();
    const linked = await h.ctx.db.selectFrom('orders').select(['id', 'status', 'product_id']).where('id', 'in', [ids.cancelled, ids.delivered]).orderBy('status').execute();
    expect(linked).toEqual([
      { id: ids.cancelled, status: 'CANCELLED', product_id: kept },
      { id: ids.delivered, status: 'RETURNED', product_id: returned },
    ]);
    const products = (safeJson(await mine.get('/api/v1/account/products')) as { products: Json[] }).products;
    for (const uuid of [kept!, returned]) {
      const pid = await productIdOf(uuid);
      const p = products.find((x) => x.productId === pid);
      expect(p, pid).toBeDefined();
      expect(p!.origin, pid).toBeNull();
    }
    expect(JSON.stringify(products)).not.toContain(orderReference(ids.cancelled));
    expect(JSON.stringify(products)).not.toContain(orderReference(ids.delivered));
  });
});

/**
 * NEW CLAIM CODE on an order (plan NEXT LOT of 2026-10-07, §3.4, step 4.3; API §10.20), with real sessions: the order's
 * `claimCode` (status and date only); the one reading (POST, no-store, CSRF, 401 signed out, 404 for another account's
 * order); the buyer's new card (the code in the body, its refusals); REGISTER THIS PIECE (no-store, rate group `auth`).
 */
describe('NEW CLAIM CODE on an order (POST /api/v1/account/orders/:id/claim-code, …/claim-card.pdf, …/register)', () => {
  let h: Harness;
  let f: LiveFixture;
  let mine: Client;
  let mineId: string;
  let other: Client;
  let orderId: string;
  let productId: string;
  let productUuid: string;

  beforeAll(async () => {
    const { inTransaction } = await import('../../src/server/db/connection.js');
    const { ensureSku } = await import('../../src/server/services/stock.js');
    h = await createHarness();
    h.clock.set('2026-11-10T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    const a = await accountClient(h);
    mine = a.client;
    mineId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', a.email).executeTakeFirstOrThrow()).id;
    other = (await accountClient(h)).client;
    const france = (await h.ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const colissimo = (await h.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    const sku = await inTransaction(h.ctx.db, (tx) => ensureSku(tx, f.modelId, '52'));
    const piece = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: '52', material: '925 STERLING SILVER', withClaimSecret: true }, f.admin);
    await countPiecesIn(h.ctx, { skuId: sku, locationId: france, productRefs: [piece.product.productId] }, f.admin);
    productId = piece.product.productId;
    productUuid = piece.product.id;
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: mineId, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    orderId = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(orderId, { sizeLabel: '52', priceMinor: 420_000, currency: 'EUR' }, f.admin);
    await h.ctx.services.orders.transition(orderId, { to: 'PAID' }, f.admin);
    // Packed and shipped through the agent's steps: SHIP starts its warranty (question 14).
    await packAndShip(h.ctx, orderId, { carrierId: colissimo, trackingNumber: '6A12345678901', pieces: { [orderId]: productId } }, f.admin);
    h.clock.advance(MINUTE);
    await h.ctx.services.claimRenewals.renew(productId, { reason: 'Card lost.', expect: 'SOLD', after: null }, f.admin);
  }, 120_000);
  afterAll(() => h?.close());

  const url = (what: string, id = orderId) => `/api/v1/account/orders/${id}/${what}`;
  let code = '';

  it('says on the order that a new claim code waits, with its date only', async () => {
    const list = (safeJson(await mine.get('/api/v1/account/orders')) as { orders: Json[] }).orders;
    const o = list.find((x) => x.id === orderId)!;
    expect(o.claimCode).toEqual({ status: 'WAITING', madeAt: h.clock.now().toISOString() });
    expect(Object.keys(o.claimCode).sort()).toEqual(['madeAt', 'status']);
  });

  it('reads it once: signed out 401, without its CSRF token 403, another account\'s order 404; then 200, never stored; then 409', async () => {
    const signedOut = await h.client().post(url('claim-code'));
    expect(signedOut.statusCode).toBe(401);
    expect((await mine.post(url('claim-code'), undefined, { noCsrf: true })).statusCode).toBe(403);
    const theirs = await other.post(url('claim-code'));
    expect([theirs.statusCode, errorOf(theirs).code]).toEqual([404, 'ORDER_NOT_FOUND']);
    expect((await mine.post(url('claim-code'), { x: 1 })).statusCode).toBe(400);
    const res = await mine.post(url('claim-code'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = safeJson(res) as { claimCode: string; productId: string };
    expect(body).toEqual({ claimCode: expect.stringMatching(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/), productId });
    code = body.claimCode;
    const again = await mine.post(url('claim-code'));
    expect([again.statusCode, errorOf(again)]).toEqual([409, { code: 'CLAIM_CODE_UNAVAILABLE', message: 'This claim code can no longer be shown. ORBES Client Services can assist you.' }]);
    expect((safeJson(await mine.get('/api/v1/account/orders')) as { orders: Json[] }).orders.find((x) => x.id === orderId)!.claimCode).toBeNull();
  });

  it('saves the new card with the code in the body: refused without it, with a wrong one, for another account; a PDF never stored', async () => {
    expect((await mine.post(url('claim-card.pdf'), {})).statusCode).toBe(400);
    const wrong = await mine.post(url('claim-card.pdf'), { claimCode: 'AAAA-AAAA-AAAA' });
    expect([wrong.statusCode, errorOf(wrong).code]).toEqual([422, 'CLAIM_CODE_MISMATCH']);
    expect((await other.post(url('claim-card.pdf'), { claimCode: code })).statusCode).toBe(404);
    const res = await mine.post(url('claim-card.pdf'), { claimCode: code });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="/);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('REGISTER THIS PIECE: another account\'s order 404; the code registers the piece, never stored; the card no longer offered', async () => {
    expect((await other.post(url('register'), { claimCode: code })).statusCode).toBe(404);
    expect((await mine.post(url('register'), { claimCode: code }, { noCsrf: true })).statusCode).toBe(403);
    const res = await mine.post(url('register'), { claimCode: code });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(safeJson(res)).toEqual({ productId, verified: true, since: h.clock.now().toISOString() });
    expect((await h.ctx.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('DELIVERED');
    const card = await mine.post(url('claim-card.pdf'), { claimCode: code });
    expect([card.statusCode, errorOf(card).code]).toEqual([409, 'CLAIM_CARD_UNAVAILABLE']);
    // The code is never in an audit entry, nor in any URL the app calls (they carry the order's id only).
    const audit = JSON.stringify(await h.ctx.db.selectFrom('audit_logs').selectAll().execute());
    expect(audit).not.toContain(code);
    expect(audit).not.toContain(code.replace(/-/g, ''));
  });
});

describe('YOUR ADDRESSES and an order\'s delivery address over HTTP (plan NEXT LOT §3.6.B; API §10.21)', () => {
  let h: Harness;
  let f: LiveFixture;
  let mine: Client;
  let mineId: string;
  let other: Client;
  let orderId: string;
  const PARIS = { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-10T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    const a = await accountClient(h);
    mine = a.client;
    mineId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', a.email.toLowerCase()).executeTakeFirstOrThrow()).id;
    other = (await accountClient(h)).client;
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: mineId, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    orderId = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  }, 60_000);
  afterAll(() => h?.close());

  it('needs an account session (401), the CSRF token and the same origin on every write, a strict body; never stored', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/account/addresses'],
      ['POST', '/api/v1/account/addresses'],
      ['PUT', `/api/v1/account/orders/${orderId}/address`],
    ] as const) {
      expect((await h.client().request(method, url, { body: PARIS })).statusCode, url).toBe(401);
    }
    expect(errorOf(await mine.post('/api/v1/account/addresses', PARIS, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.post('/api/v1/account/addresses', PARIS, { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { address: PARIS }, noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.post('/api/v1/account/addresses', { ...PARIS, email: 'x@example.com' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await mine.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { address: PARIS, addressId: orderId } })).code).toBe('VALIDATION_FAILED');
    const empty = await mine.get('/api/v1/account/addresses');
    expect(empty.headers['cache-control']).toBe('no-store');
    expect(safeJson(empty)).toEqual({ addresses: [], defaultCountry: null });
  });

  it('adds, edits, makes default and removes an address; the server\'s words for a refusal; never another account\'s', async () => {
    const created = await mine.post('/api/v1/account/addresses', PARIS);
    expect(created.statusCode).toBe(201);
    const first = (safeJson(created) as Json).addresses[0];
    expect(first).toEqual({ id: expect.any(String), ...PARIS, isDefault: true });
    const refused = await mine.post('/api/v1/account/addresses', { ...PARIS, country: 'XX' });
    expect([refused.statusCode, errorOf(refused).code, errorOf(refused).message]).toEqual([400, 'VALIDATION_FAILED', 'Choose a country.']);
    h.clock.advance(1000);
    const second = ((safeJson(await mine.post('/api/v1/account/addresses', { ...PARIS, name: 'J. Doe', isDefault: true })) as Json).addresses as Json[]).find((x) => x.name === 'J. Doe')!;
    expect(second.isDefault).toBe(true);
    const edited = await mine.request('PUT', `/api/v1/account/addresses/${first.id}`, { body: { ...PARIS, phone: '+33 6 00 00 00 00' } });
    expect(edited.statusCode).toBe(200);
    expect(((safeJson(edited) as Json).addresses as Json[]).find((x) => x.id === first.id)!.phone).toBe('+33 6 00 00 00 00');
    expect((await other.request('PUT', `/api/v1/account/addresses/${first.id}`, { body: PARIS })).statusCode).toBe(404);
    expect((await other.post(`/api/v1/account/addresses/${first.id}/default`)).statusCode).toBe(404);
    expect((await other.request('DELETE', `/api/v1/account/addresses/${first.id}`)).statusCode).toBe(404);
    expect((await mine.post(`/api/v1/account/addresses/${first.id}/default`)).statusCode).toBe(204);
    expect((await mine.request('DELETE', `/api/v1/account/addresses/${second.id}`)).statusCode).toBe(204);
    expect(((safeJson(await mine.get('/api/v1/account/addresses')) as Json).addresses as Json[]).map((x) => [x.id, x.isDefault])).toEqual([[first.id, true]]);
  });

  it('sets an order\'s delivery address from a saved one or a new one, answering the order; another account\'s order 404', async () => {
    const saved = ((safeJson(await mine.get('/api/v1/account/addresses')) as Json).addresses as Json[])[0];
    const res = await mine.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { addressId: saved.id } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((safeJson(res) as Json).order).toMatchObject({ id: orderId, address: { name: saved.name, lines: saved.address, country: 'FR', phone: saved.phone }, addressOf: null, editable: { address: true } });
    const fresh = await mine.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { address: { ...PARIS, name: 'Jane Martin' }, save: true } });
    expect((safeJson(fresh) as Json).order.address.name).toBe('Jane Martin');
    expect(((safeJson(await mine.get('/api/v1/account/addresses')) as Json).addresses as Json[]).map((x) => x.name)).toContain('Jane Martin');
    const theirs = await other.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { address: PARIS } });
    expect([theirs.statusCode, errorOf(theirs).code]).toEqual([404, 'ORDER_NOT_FOUND']);
    const bad = await mine.request('PUT', `/api/v1/account/orders/${orderId}/address`, { body: { address: { ...PARIS, phone: '0612' } } });
    expect([bad.statusCode, errorOf(bad).message]).toEqual([400, 'Enter a phone number with its country code.']);
  });

  it('sets and removes an order\'s engraving (plan NEXT LOT §3.6.C; API §10.22): the CSRF token, the server\'s words, the order back; its other documents by their number', async () => {
    const op = { type: 'admin' as const, id: f.admin.id };
    await h.ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: 3_000, GBP: null, USD: null, CHF: null } }, op);
    await h.ctx.services.orders.setTerms(orderId, { sizeLabel: '58', priceMinor: 420_000, currency: 'EUR' }, op);
    const url = `/api/v1/account/orders/${orderId}/engraving`;
    expect((await h.client().request('PUT', url, { body: { text: 'J.M.' } })).statusCode).toBe(401);
    expect(errorOf(await mine.request('PUT', url, { body: { text: 'J.M.' }, noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.request('DELETE', url, { noCsrf: true })).code).toBe('CSRF_FAILED');
    const bad = await mine.request('PUT', url, { body: { text: 'J.M.!' } });
    expect([bad.statusCode, errorOf(bad).message]).toEqual([400, 'Up to 20 characters: letters, figures, spaces and . & ’ -']);
    expect(errorOf(await mine.request('PUT', url, { body: { text: 'J.M.', price: 0 } })).code).toBe('VALIDATION_FAILED');
    const set = await mine.request('PUT', url, { body: { text: 'J.M.' } });
    expect(set.statusCode).toBe(200);
    expect(set.headers['cache-control']).toBe('no-store');
    expect((safeJson(set) as Json).order).toMatchObject({ id: orderId, engraving: { text: 'J.M.', priceMinor: 3_000 }, engravingOffer: { priceMinor: 3_000, included: false, maxLength: 20 } });
    expect((await other.request('PUT', url, { body: { text: 'J.M.' } })).statusCode).toBe(404);
    // Paid, then removed: a credit note for its line, listed and read by its number.
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(orderId, { to: 'PAID' }, op);
    const removed = await mine.request('DELETE', url);
    expect(removed.statusCode).toBe(200);
    const order = (safeJson(removed) as Json).order;
    expect(order.engraving).toBeNull();
    expect(order.documents.others).toEqual([{ kind: 'CREDIT_NOTE', number: expect.stringMatching(/^CN-2026-\d{6}$/), issuedAt: expect.any(String) }]);
    const doc = await mine.get(`/api/v1/account/orders/${orderId}/documents/${order.documents.others[0].number}`);
    expect(doc.statusCode).toBe(200);
    expect(doc.headers['content-type']).toBe('application/pdf');
    expect(doc.headers['cache-control']).toBe('no-store');
    expect((await other.get(`/api/v1/account/orders/${orderId}/documents/${order.documents.others[0].number}`)).statusCode).toBe(404);
    expect((await mine.get(`/api/v1/account/orders/${orderId}/documents/INV-2026-999999`)).statusCode).toBe(404);
    await h.ctx.services.clubProgram.setEngravingPrices({ prices: { EUR: null, GBP: null, USD: null, CHF: null } }, op);
  });
});

describe('IN PREPARATION, a delivery problem and a return asked from YOUR ORDERS (plan NEXT LOT §3.6.A, §3.6.D, step 6.9)', () => {
  let h: Harness;
  let f: LiveFixture;
  let mine: Client;
  let mineId: string;
  let other: Client;
  let colissimo: string;
  let france: string;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-12T09:00:00.000Z');
    f = await liveFixtureOn(h.ctx, h.clock);
    colissimo = (await h.ctx.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
    france = (await h.ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
    const a = await accountClient(h);
    mine = a.client;
    mineId = (await h.ctx.db.selectFrom('accounts').select('id').where('email_normalized', '=', a.email.toLowerCase()).executeTakeFirstOrThrow()).id;
    other = (await accountClient(h)).client;
  }, 60_000);
  afterAll(() => h?.close());

  const orderOf = async (id: string) => ((safeJson(await mine.get('/api/v1/account/orders')) as { orders: Json[] }).orders).find((o) => o.id === id)!;
  async function paidSalon(size: string): Promise<string> {
    h.clock.advance(MINUTE);
    const request = await h.ctx.db.insertInto('shop_requests').values({ account_id: mineId, model_id: f.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    await h.ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, f.admin);
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await h.ctx.services.orders.setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, f.admin);
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(id, { to: 'PAID' }, f.admin);
    return id;
  }

  it('reads IN PREPARATION from the later of the payment and the piece taken in stock, null while it waits, kept once shipped, delivered and returned; null for an order cancelled while waiting', async () => {
    const id = await paidSalon('58');
    expect(await h.ctx.db.selectFrom('orders').select('reservation').where('id', '=', id).executeTakeFirstOrThrow()).toEqual({ reservation: 'AWAITING' });
    const waiting = await orderOf(id);
    expect(waiting).toMatchObject({ status: 'PAID', preparingAt: null, deliveryIssue: false });
    // Never says it waits, nor where, nor what it holds.
    for (const word of ['AWAITING', 'STOCK', 'WAREHOUSE', 'reservation', 'LATE']) expect(JSON.stringify(waiting)).not.toContain(word);
    h.clock.advance(MINUTE);
    const sku = (await h.ctx.db.selectFrom('orders').select('sku_id').where('id', '=', id).executeTakeFirstOrThrow()).sku_id!;
    await stockPieces(h.ctx, { skuId: sku, locationId: france, count: 1, material: '925 STERLING SILVER', forOrderIds: [id] }, f.admin);
    const served = (await h.ctx.db.selectFrom('order_events').select('created_at').where('order_id', '=', id).where('action', '=', 'order.serve').executeTakeFirstOrThrow()).created_at;
    const paidAt = (await h.ctx.db.selectFrom('orders').select('paid_at').where('id', '=', id).executeTakeFirstOrThrow()).paid_at!;
    expect(served.getTime()).toBeGreaterThan(paidAt.getTime());
    expect((await orderOf(id)).preparingAt).toBe(served.toISOString());
    // Shipped: kept. A parcel reported lost: a delivery problem until its order case ends.
    h.clock.advance(MINUTE);
    await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, f.admin);
    expect(await orderOf(id)).toMatchObject({ status: 'SHIPPED', preparingAt: served.toISOString(), deliveryIssue: false });
    const lost = await h.ctx.services.orderCases.report(id, { kind: 'LOST', note: 'The carrier lost track of it.' }, f.admin, null);
    expect((await orderOf(id)).deliveryIssue).toBe(true);
    await h.ctx.services.orderCases.cancel(lost.id, { note: 'Found by the carrier.' }, f.admin);
    expect((await orderOf(id)).deliveryIssue).toBe(false);
    // Delivered, then returned: kept.
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(id, { to: 'DELIVERED' }, f.admin);
    expect((await orderOf(id)).preparingAt).toBe(served.toISOString());
    // An order holding its piece from its creation: in preparation from its payment.
    const sku62 = await h.ctx.db.transaction().execute((tx) => ensureSku(tx, f.modelId, '62'));
    await stockPieces(h.ctx, { skuId: sku62, locationId: france, count: 1, material: '925 STERLING SILVER' }, f.admin);
    const ready = await paidSalon('62');
    const readyPaid = (await h.ctx.db.selectFrom('orders').select('paid_at').where('id', '=', ready).executeTakeFirstOrThrow()).paid_at!;
    expect((await orderOf(ready)).preparingAt).toBe(readyPaid.toISOString());
    // An order cancelled while waiting: never reached.
    const waits = await paidSalon('60');
    expect((await orderOf(waits)).preparingAt).toBeNull();
    h.clock.advance(MINUTE);
    await h.ctx.services.orders.transition(waits, { to: 'CANCELLED', note: 'The client withdrew.' }, f.admin);
    expect(await orderOf(waits)).toMatchObject({ status: 'CANCELLED', preparingAt: null });
  });

  it('asks for a return over HTTP: a session, the CSRF token and the same origin, a strict body; 201 the order with its case; another account\'s order 404', async () => {
    const id = (await h.ctx.db.selectFrom('orders').select('id').where('account_id', '=', mineId).where('status', '=', 'DELIVERED').executeTakeFirstOrThrow()).id;
    const url = `/api/v1/account/orders/${id}/case`;
    const body = { kind: 'RETURN', reason: 'SIZE', note: 'Too large.' };
    expect((await h.client().post(url, body)).statusCode).toBe(401);
    expect(errorOf(await mine.post(url, body, { noCsrf: true })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.post(url, body, { origin: 'https://evil.example' })).code).toBe('CSRF_FAILED');
    expect(errorOf(await mine.post(url, { ...body, kind: 'LOST' })).code).toBe('VALIDATION_FAILED');
    expect(errorOf(await mine.post(url, { ...body, price: 1 })).code).toBe('VALIDATION_FAILED');
    expect((await other.post(url, body)).statusCode).toBe(404);
    const res = await mine.post(url, body);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const order = (safeJson(res) as Json).order;
    expect(order).toMatchObject({ id, returnable: null, case: { kind: 'RETURN', status: 'OPEN', sizeLabel: null, outcome: null, exchangeOrder: null } });
    expect(JSON.stringify(order)).not.toContain('Too large');
    const again = await mine.post(url, body);
    expect([again.statusCode, errorOf(again).code]).toEqual([409, 'ORDER_CASE_OPEN']);
    // Its message, in MESSAGES, the collector's own.
    const thread = safeJson(await mine.get('/api/v1/account/messages')) as Json;
    expect(thread.messages.at(-1)).toMatchObject({ from: 'YOU', body: 'RETURN REQUESTED — The size does not fit.\n\nToo large.', concerning: { kind: 'ORDER' } });
    // Decided: RETURNED, IN PREPARATION kept, the case CLOSED on the card.
    h.clock.advance(MINUTE);
    const c = await h.ctx.db.selectFrom('order_cases').select('id').where('order_id', '=', id).where('kind', '=', 'RETURN').executeTakeFirstOrThrow();
    await h.ctx.services.orderCases.receive(c.id, { pieceState: 'OK' }, f.admin, null);
    await h.ctx.services.orderCases.decide(c.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, f.admin, { admin: true });
    expect(await orderOf(id)).toMatchObject({ status: 'RETURNED', preparingAt: expect.any(String), case: { status: 'CLOSED', outcome: 'REFUND' } });
  });
});
