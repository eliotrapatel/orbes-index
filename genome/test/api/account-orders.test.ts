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
    const d = await f.drops.create({ modelId: f.modelId, title: 'MONOLITHE — RELEASE I', quantity: 1, opensAt: T, closesAt: new Date(T.getTime() + HOUR), earlyAccessHours: 0 }, f.admin);
    await f.drops.publish(d.id, f.admin);
    h.clock.set(new Date(T.getTime() + MINUTE));
    await f.drops.enter(mineId, d.id, actor);
    h.clock.set(new Date(T.getTime() + 2 * HOUR));
    await f.drops.draw(d.id, f.admin);
    const entry = (await h.ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).executeTakeFirstOrThrow()).id;
    await f.drops.confirm(d.id, entry, 'Sold by phone.', f.admin);
    ids.draw = (await h.ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry).executeTakeFirstOrThrow()).id;

    // The private salon: terms, buyer and engraving entered; paid, made at the atelier, shipped, delivered.
    ids.delivered = await salonOrder(mineId);
    await orders().setTerms(ids.delivered, { sizeLabel: '54', priceMinor: 490_000, currency: 'EUR', engravingText: 'A. & L.' }, f.admin);
    await orders().setBuyer(ids.delivered, { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' }, f.admin);
    await step(ids.delivered, { to: 'PAID', note: 'Paid by transfer.' });
    const bench = await h.ctx.db.selectFrom('bench_items').select('id').where('order_id', '=', ids.delivered).executeTakeFirstOrThrow();
    await h.ctx.services.atelier.start(bench.id, f.admin);
    await h.ctx.services.atelier.done(bench.id, { material: '925 STERLING SILVER' }, f.admin);
    await step(ids.delivered, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A 1234 5678 901', declaredValueMinor: 470_123 });
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
      documents: { invoice: null, creditNote: null, careGuide: true, certificate: false },
      // NOCTURNE, addition 3: its model's photograph; none taken yet.
      imageUrl: null,
      // Plan NEXT LOT §3.4: no new claim code waits for it.
      claimCode: null,
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
      documents: { invoice: { number: expect.stringMatching(/^INV-2026-\d{6}$/), issuedAt: delivered.paidAt }, creditNote: null, careGuide: true, certificate: false },
      imageUrl: null,
      claimCode: null,
    });
    for (const k of ['reservedAt', 'paidAt', 'shippedAt', 'deliveredAt']) expect(delivered[k], k).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(delivered.reservedAt)).toBeLessThan(Date.parse(delivered.paidAt));
    expect(Date.parse(delivered.paidAt)).toBeLessThan(Date.parse(delivered.shippedAt));
    expect(Date.parse(delivered.shippedAt)).toBeLessThan(Date.parse(delivered.deliveredAt));
    // Cancelled after it was paid: both times.
    expect(byId.get(ids.cancelled)).toMatchObject({ status: 'CANCELLED', priceMinor: 300_000, currency: 'EUR', size: null, paidAt: expect.any(String), cancelledAt: expect.any(String), shippedAt: null, shipment: null });
  });

  it('never says the house\'s side of an order: where it is served from, what it holds, the surprise, the buyer, the engraving\'s words, the value declared, the notes, who handled it', async () => {
    await h.ctx.db.updateTable('orders').set({ surprise: 'A silk pouch' }).where('id', '=', ids.live1).execute();
    const res = await mine.get('/api/v1/account/orders');
    const list = (safeJson(res) as { orders: Json[] }).orders;
    for (const o of list) {
      expect(Object.keys(o).sort()).toEqual(
        ['addons', 'cancelledAt', 'channel', 'claimCode', 'creditMinor', 'currency', 'deliveredAt', 'documents', 'giftTier', 'id', 'imageUrl', 'model', 'modelVariant', 'paidAt', 'priceMinor', 'reference', 'release', 'reservedAt', 'returnedAt', 'shipment', 'shippedAt', 'shipping', 'size', 'status', 'withOrder'].sort(),
      );
      expect(Object.keys(o.documents).sort()).toEqual(['careGuide', 'certificate', 'creditNote', 'invoice']);
      for (const a of o.addons) expect(Object.keys(a).sort()).toEqual(['label', 'priceMinor']);
    }
    for (const secret of ['A silk pouch', 'Jane', 'Paix', 'A. & L.', '470123', 'WAREHOUSE', 'transfer', 'withdrew', 'Sold by phone', f.admin.id, 'BENCH', 'STOCK', 'O26-J-']) {
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
