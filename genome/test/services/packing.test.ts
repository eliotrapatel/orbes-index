/**
 * Packing and shipping (plan NEXT LOT of 2026-10-07, §3.5.6.6 and §3.5.6.8, step 5.9; services/logistics.ts and
 * services/parcels.ts), on the services as createContext wires them:
 *
 *  - To ship: an unpaid or AWAITING order never listed; a parcel (an order and the orders travelling with it) listed only
 *    when every order left to ship is paid and holds its piece; LATE after 5 days on the agent's list, counted from the
 *    parcel's latest ready time; on ORBES's board an order ready but waiting for the rest of its parcel is not LATE; a
 *    parcel whose first order was cancelled is still keyed by it, with its address; the agent's own locations only;
 *  - Start packing: refused until paid and in stock, refused without a delivery address, its country included (Ship too);
 *    `packing_started_at` set;
 *  - ADDRESS CHANGED (step 6.7): from the order's address columns, by Client Services or by the collector, on the list and
 *    the parcel, until it ships; the warranty started at SHIP in the delivery country;
 *  - the scan: not ORBES, another model/variant/size, a Generator piece never counted in, a piece in another order, a
 *    piece shipped or registered: refused; success binds the piece to its order; every piece scanned: DONE;
 *  - the photo: its type checked by its bytes, at most 1 MiB, EXIF removed; replaced until packed;
 *  - Packed: every line, every card, the photo; Ship refused before; a parcel of 3 ships whole, a declared value per
 *    order from ORBES staff (refused from the agent); the warranty started at SHIP once (question 14), a warranty started
 *    by hand left as it is; Mark delivered; delivered by a registration;
 *  - one order of a parcel cancelled while packing: the shipment cancelled, the others keep their pieces and their
 *    packing start, a new shipment opens and the scan accepts the piece already bound;
 *  - a parcel moves whole when one of its orders changes location, refused once a piece is bound; a parcel left split
 *    across locations is not listed and Start packing answers PACKING_LOCATIONS_SPLIT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packAndShip, stockPieces, type StockedPiece } from '../support/fulfil.js';
import { exifTiff, jpegMarkers, jpegPhoto, jpegSegment, withJpegSegments } from '../support/images.js';
import { createAccount, createLiveRelease, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('packing and shipping (plan NEXT LOT §3.5.6.8)', () => {
  let h: Harness;
  let catalog: Catalog;
  let f: LiveFixture;
  let admin: Actor;
  let agent: Actor;
  let france: string;
  let logistics: string;
  let colissimo: string;
  const scope = () => new Set([france]);

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    f = await liveFixtureOn(h.ctx, h.clock);
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    const locations = await h.t.db.selectFrom('stock_locations').select(['id', 'name']).execute();
    france = locations.find((l) => l.name === 'FRANCE WAREHOUSE')!.id;
    logistics = locations.find((l) => l.name === 'LOGISTICS WAREHOUSE')!.id;
    agent = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] })).id };
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const lg = () => h.ctx.services.logistics;
  const orders = () => h.ctx.services.orders;
  const db = () => h.t.db;
  const skuOf = (label: string) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, label));
  const row = (id: string) => db().selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const stock = async (skuId: string, count: number, forOrderIds?: string[]) => {
    const out = await stockPieces(h.ctx, { skuId, locationId: france, count, material: '925 STERLING SILVER', ...(forOrderIds ? { forOrderIds } : {}) }, admin);
    for (const p of out) issued.set(p.uuid, p);
    return out;
  };
  const scanOf = (p: Pick<StockedPiece, 'data'>) => ({ code: p.data });
  const pay = async (id: string) => {
    h.clock.advance(MINUTE);
    await orders().transition(id, { to: 'PAID' }, admin);
  };
  const buyer = (id: string) => orders().setBuyer(id, { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, admin);

  /** A salon order of the size at FRANCE WAREHOUSE, priced; paid when asked. */
  async function salonOrder(size: string, opts: { paid?: boolean } = {}): Promise<string> {
    const account = await createAccount(db());
    const request = await db().insertInto('shop_requests').values({ account_id: account.id, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(MINUTE);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const id = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: size, priceMinor: 420_000, currency: 'EUR' }, admin);
    if (opts.paid) await pay(id);
    return id;
  }

  /** A LIVE sale of `quantity` pieces of a size (52 by default): one parcel, its orders by piece (the first keys it). */
  async function liveSale(quantity: number, size = '52'): Promise<string[]> {
    const account = await createAccount(db());
    const opensAt = new Date(h.clock.now().getTime() + HOUR);
    const r = await createLiveRelease(f, { modelId: catalog.modelId, opensAt, sizes: [{ label: size, stock: 5 }], perAccount: quantity, priceMinor: 480_000 });
    h.clock.set(new Date(opensAt.getTime() - MINUTE));
    await f.live.enter(account.id, r.id, { sizeId: r.sizes[0]!.id, quantity }, account.actor);
    h.clock.set(opensAt);
    await f.live.advance(r.id);
    const token = (await f.live.entry(account.id, r.id))!.turn!.token!;
    await f.live.press(account.id, r.id, token);
    h.clock.advance(1500);
    await f.live.secure(account.id, r.id, token, account.actor);
    await f.live.confirm(account.id, r.id, account.actor);
    const entry = await db().selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', account.id).executeTakeFirstOrThrow();
    return (await db().selectFrom('orders').select('id').where('live_entry_id', '=', entry.id).orderBy('piece').execute()).map((o) => o.id);
  }

  /** A piece's scannable code and claim code, as issued (the claim code from the pieces this file stocked). */
  const issued = new Map<string, StockedPiece>();
  async function pieceOf(uuid: string): Promise<StockedPiece> {
    const known = issued.get(uuid);
    if (known) return known;
    throw new Error(`pieceOf: ${uuid} was not stocked by this file`);
  }
  const listed = async (s: ReadonlySet<string> | null = null) => (await lg().parcels(s)).toShip;

  it('lists a parcel only once every order left in it is paid and holds its piece, the oldest ready first; LATE after 5 days from its latest ready time; never LATE on the board while it waits for the rest of its parcel', async () => {
    const s52 = await skuOf('52');
    const parcel = await liveSale(3);
    // Unpaid: never listed, though nothing holds yet.
    expect((await listed()).map((p) => p.id)).not.toContain(parcel[0]);
    for (const id of parcel) await pay(id);
    expect((await Promise.all(parcel.map(row))).map((o) => o.reservation)).toEqual(['AWAITING', 'AWAITING', 'AWAITING']);
    expect((await listed()).map((p) => p.id)).not.toContain(parcel[0]);
    // Two of its three pieces in stock: still waiting for the third.
    h.clock.advance(MINUTE);
    await stock(s52, 2);
    // The three were reserved at once: two of them served (by their ids), the third still waits.
    const holds = await Promise.all(parcel.map(row));
    expect(holds.map((o) => o.reservation).sort()).toEqual(['AWAITING', 'STOCK', 'STOCK']);
    const third = holds.find((o) => o.reservation === 'AWAITING')!.id;
    expect((await listed()).map((p) => p.id)).not.toContain(parcel[0]);
    // An unpaid order holding its piece is never listed either.
    const unpaid = await salonOrder('52');
    expect((await row(unpaid)).reservation).toBe('AWAITING');
    // Six days on ORBES's board: the two ready orders are not LATE, their parcel waits for its third piece.
    h.clock.advance(6 * DAY);
    const board = await h.ctx.services.fulfilment.board({});
    const cards = board.columns.find((c) => c.status === 'PAID')!.items.filter((c) => parcel.includes(c.id));
    expect(cards.map((c) => [c.reservation, c.waitingForParcel, c.timing.late, c.timing.rule]).sort()).toEqual([
      ['AWAITING', false, false, null],
      ['STOCK', true, false, null],
      ['STOCK', true, false, null],
    ]);
    // The third piece arrives: the parcel is listed, ready since then.
    h.clock.advance(HOUR);
    const servedAt = h.clock.now();
    await stock(s52, 1, [third]);
    const rows = await listed();
    const p = rows.find((r) => r.id === parcel[0])!;
    expect(p).toMatchObject({ reference: expect.stringMatching(/^OR-/), others: 2, step: 'READY_TO_PACK', late: false, engraving: false, location: { id: france, name: 'FRANCE WAREHOUSE' } });
    expect(p.readySince.getTime()).toBe(servedAt.getTime());
    expect(p.pieces.map((x) => [x.model, x.sizeLabel])).toEqual([
      ['MONOLITHE', '52'],
      ['MONOLITHE', '52'],
      ['MONOLITHE', '52'],
    ]);
    // The agent of FRANCE WAREHOUSE sees it; an agent of another location does not.
    expect((await listed(scope())).map((r) => r.id)).toContain(parcel[0]);
    expect((await listed(new Set([logistics]))).map((r) => r.id)).not.toContain(parcel[0]);
    // LATE 5 days after its latest ready time, not before; the board reads it per parcel too.
    h.clock.set(new Date(servedAt.getTime() + 5 * DAY));
    expect((await listed()).find((r) => r.id === parcel[0])!.late).toBe(false);
    h.clock.advance(MINUTE);
    expect((await listed()).find((r) => r.id === parcel[0])!.late).toBe(true);
    const later = (await h.ctx.services.fulfilment.board({})).columns.find((c) => c.status === 'PAID')!.items.filter((c) => parcel.includes(c.id));
    expect(later.map((c) => [c.waitingForParcel, c.timing.late])).toEqual([
      [false, true],
      [false, true],
      [false, true],
    ]);
    expect((await lg().parcel(parcel[1]!, null)).id).toBe(parcel[0]);
    // Another location's agent: 404.
    expect(await refusal(lg().parcel(parcel[0]!, new Set([logistics])))).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    await orders().transition(unpaid, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });

  it('starts packing once every order is paid and holds its piece and the address is entered; then scans, refusing any card that is not a piece in stock of the size', async () => {
    const s54 = await skuOf('54');
    const s56 = await skuOf('56');
    const id = await salonOrder('54');
    expect(await refusal(lg().startPacking(id, agent, scope()))).toMatchObject({ code: 'PACKING_NOT_READY', status: 409 });
    await pay(id);
    expect(await refusal(lg().startPacking(id, agent, scope()))).toMatchObject({ code: 'PACKING_NOT_READY' });
    const [right] = await stock(s54, 1, [id]);
    expect(await refusal(lg().startPacking(id, agent, scope()))).toEqual({ code: 'ORDER_ADDRESS_MISSING', status: 409, message: 'This order has no delivery address yet.' });
    await buyer(id);
    expect(await refusal(lg().startPacking(id, agent, new Set([logistics])))).toMatchObject({ code: 'ORDER_NOT_FOUND', status: 404 });
    // A scan before Start packing.
    expect(await refusal(lg().scanCard(id, scanOf(right!), agent, {}, scope()))).toMatchObject({ code: 'PACKING_NOT_STARTED', status: 409 });
    h.clock.advance(MINUTE);
    const started = await lg().startPacking(id, agent, scope());
    expect(started.step).toBe('PACKING');
    expect(started.shipTo).toEqual({ name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: 'FR', phone: '+33 6 12 34 56 78' });
    // Its first address: no ADDRESS CHANGED.
    expect(started.addressChanged).toBeNull();
    expect((await row(id)).packing_started_at).toEqual(h.clock.now());
    // Again: nothing changes.
    expect((await lg().startPacking(id, agent, scope())).shipment!.id).toBe(started.shipment!.id);
    expect(started.checklist.map((l) => [l.key.split(':')[0], l.label, l.byScan])).toEqual([
      ['piece', 'The right piece: its card scanned', true],
      ['card', 'The card, its claim code visible', false],
      ['box', 'The box and the pouch', false],
    ]);
    // Not an ORBES code.
    expect(await refusal(lg().scanCard(id, { code: 'AAAAAAAA' }, agent, {}, scope()))).toEqual({
      code: 'PACKING_SCAN_NOT_ORBES',
      status: 422,
      message: 'This card did not verify as an ORBES code. Put it aside and tell ORBES.',
    });
    // Another size.
    const [other] = await stock(s56, 1);
    expect(await refusal(lg().scanCard(id, scanOf(other!), agent, {}, scope()))).toEqual({
      code: 'PACKING_SCAN_OTHER_PIECE',
      status: 409,
      message: 'This card is MONOLITHE · 56. This order needs MONOLITHE · 54: take a piece of that model, variant and size.',
    });
    // A Generator piece of the size, never counted in.
    const loose = await h.ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: catalog.modelId, variant: '54', material: '925 STERLING SILVER' }, admin);
    expect(await refusal(lg().scanCard(id, { code: loose.code.data }, agent, {}, scope()))).toEqual({
      code: 'PACKING_SCAN_NOT_IN_STOCK',
      status: 409,
      message: `${loose.product.productId} is not a piece in stock (it is registered, shipped, in another order, retired, or not counted in). Put it aside and tell ORBES.`,
    });
    // The right piece: bound to the order.
    const scanned = await lg().scanCard(id, scanOf(right!), agent, {}, scope());
    expect(scanned.piece.productId).toBe(right!.productId);
    expect(scanned.piece.sku.sizeLabel).toBe('54');
    expect((await row(id)).product_id).toBe(right!.uuid);
    expect(scanned.parcel.orders[0]!.piece).toEqual({ productId: right!.productId, scanned: true });
    expect(scanned.parcel.checklist.find((l) => l.byScan)!.ticked).toBe(true);
    const events = await db().selectFrom('order_events').select(['action', 'details']).where('order_id', '=', id).where('action', 'in', ['order.link', 'order.pack.scan']).orderBy('id').execute();
    expect(events.map((e) => [e.action, e.details.productId])).toEqual([
      ['order.link', right!.uuid],
      ['order.pack.scan', right!.uuid],
    ]);
    expect(events[0]!.details.via).toBe('scan');
    // The staff scan names the login.
    const scan = await db().selectFrom('scan_events').select(['event_type', 'admin_id']).where('id', '=', events[1]!.details.scanId as string).executeTakeFirstOrThrow();
    expect(scan).toEqual({ event_type: 'ADMIN_TEST', admin_id: agent.id });
    // The same card again changes nothing; another piece of the size: every piece is scanned.
    await lg().scanCard(id, scanOf(right!), agent, {}, scope());
    const [spare] = await stock(s54, 1);
    expect(await refusal(lg().scanCard(id, scanOf(spare!), agent, {}, scope()))).toMatchObject({ code: 'PACKING_SCAN_DONE', status: 409 });
    // A piece bound in another parcel being packed is not in stock.
    const second = await salonOrder('54', { paid: true });
    await buyer(second);
    expect((await row(second)).reservation).toBe('STOCK');
    await lg().startPacking(second, agent, scope());
    expect(await refusal(lg().scanCard(second, scanOf(right!), agent, {}, scope()))).toMatchObject({ code: 'PACKING_SCAN_NOT_IN_STOCK' });
    await orders().transition(second, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });

  it('takes the photo by its bytes (JPEG or WebP, at most 1 MiB, EXIF removed), replaced until packed; Packed needs every line, every card and the photo; Ship needs Packed', async () => {
    const s58 = await skuOf('58');
    const id = await salonOrder('58', { paid: true });
    const [piece] = await stock(s58, 1, [id]);
    await buyer(id);
    await lg().startPacking(id, agent, scope());
    // Ship and Packed before anything.
    expect(await refusal(lg().ship(id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, agent, scope()))).toEqual({ code: 'ORDER_NOT_PACKED', status: 409, message: 'Pack the parcel and check it before it ships.' });
    const all = (await lg().parcel(id, scope())).checklist.filter((l) => !l.byScan).map((l) => l.key);
    expect(await refusal(lg().checkPacked(id, { ticked: all }, agent, scope()))).toEqual({
      code: 'PACKING_INCOMPLETE',
      status: 422,
      message: 'Tick every line, scan every card and add the photo before it is packed.',
    });
    await lg().scanCard(id, scanOf(piece!), agent, {}, scope());
    // The photo: a PNG sent as a JPEG, bytes that are no image, over 1 MiB: refused.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await refusal(lg().setPhoto(id, { mime: 'image/jpeg', bytes: png }, agent, scope()))).toEqual({ code: 'PACKING_PHOTO_INVALID', status: 422, message: 'The photo could not be read: take it again.' });
    expect(await refusal(lg().setPhoto(id, { mime: 'image/webp', bytes: jpegPhoto(8, 8) }, agent, scope()))).toMatchObject({ code: 'PACKING_PHOTO_INVALID' });
    expect(await refusal(lg().setPhoto(id, { mime: 'image/jpeg', bytes: new Uint8Array(1_048_577) }, agent, scope()))).toMatchObject({ code: 'PACKING_PHOTO_INVALID', status: 422 });
    // A JPEG with its EXIF: kept without it.
    const withExif = withJpegSegments(jpegPhoto(24, 16), [jpegSegment(0xe1, exifTiff(1))]);
    expect(jpegMarkers(withExif)).toContain('e1');
    const view = await lg().setPhoto(id, { mime: 'image/jpeg', bytes: withExif }, agent, scope());
    expect(view.shipment!.photo).toBe(true);
    const photo = await lg().photo(view.shipment!.id, scope());
    expect(photo.mime).toBe('image/jpeg');
    expect(jpegMarkers(photo.bytes)).not.toContain('e1');
    expect(await refusal(lg().photo(view.shipment!.id, new Set([logistics])))).toMatchObject({ code: 'SHIPMENT_NOT_FOUND', status: 404 });
    const audited = await db().selectFrom('audit_logs').select('details').where('action', '=', 'order.pack.photo').where('target_id', '=', id).executeTakeFirstOrThrow();
    expect(audited.details).toMatchObject({ shipmentId: view.shipment!.id, sha256: photo.sha256, bytes: photo.bytes.length });
    // Replaced, then a line left unticked.
    await lg().setPhoto(id, { mime: 'image/jpeg', bytes: jpegPhoto(20, 20) }, agent, scope());
    expect(await refusal(lg().checkPacked(id, { ticked: all.filter((k) => k !== 'box') }, agent, scope()))).toMatchObject({ code: 'PACKING_INCOMPLETE' });
    const packed = await lg().checkPacked(id, { ticked: all }, agent, scope());
    expect(packed.step).toBe('PACKED');
    expect((await db().selectFrom('shipments').select('checklist').where('id', '=', packed.shipment!.id).executeTakeFirstOrThrow()).checklist.map((l) => l.key)).toEqual([`piece:${id}`, `card:${id}`, 'box']);
    // Packed: the photo no longer changes.
    expect(await refusal(lg().setPhoto(id, { mime: 'image/jpeg', bytes: jpegPhoto(8, 8) }, agent, scope()))).toMatchObject({ code: 'PACKING_PACKED', status: 409 });
    // Ship refuses a parcel whose address was cleared meanwhile.
    await orders().setBuyer(id, { name: null, address: null }, admin);
    expect(await refusal(lg().ship(id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, agent, scope()))).toMatchObject({ code: 'ORDER_ADDRESS_MISSING', status: 409 });
    await buyer(id);
    // The agent never declares a value; it ships.
    expect(await refusal(lg().ship(id, { carrierId: colissimo, trackingNumber: '6A12345678901', declaredValues: [{ orderId: id, minor: 420_000 }] }, agent, scope()))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    h.clock.advance(MINUTE);
    const shipped = await lg().ship(id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, agent, scope());
    expect(shipped.step).toBe('SHIPPED');
    expect(shipped.shipment).toMatchObject({ carrier: { id: colissimo, name: 'Colissimo' }, trackingNumber: '6A12345678901', trackingUrl: expect.stringContaining('6A12345678901') });
    expect(await row(id)).toMatchObject({ status: 'SHIPPED', carrier_id: colissimo, tracking_number: '6A12345678901', declared_value_minor: null, reservation: null });
    // Its warranty started at SHIP, on the shipping day, with no point of sale, in the delivery address's country
    // (question 14 as built, §3.5.6.8b).
    const w = await db().selectFrom('warranties').select(['start_date', 'retailer_id', 'retailer', 'country']).where('product_id', '=', piece!.uuid).executeTakeFirstOrThrow();
    expect(w).toEqual({ start_date: h.clock.now().toISOString().slice(0, 10), retailer_id: null, retailer: null, country: 'FR' });
    expect((await db().selectFrom('products').select('status').where('id', '=', piece!.uuid).executeTakeFirstOrThrow()).status).toBe('ACTIVATED');
    const activation = await db().selectFrom('audit_logs').select('details').where('action', '=', 'warranty.activate').where('target_id', '=', piece!.productId).execute();
    expect(activation.map((a) => [a.details.via, a.details.orderId])).toEqual([['ship', id]]);
    // On its way, then delivered by the agent.
    expect((await lg().parcels(scope())).onItsWay.map((r) => r.id)).toContain(id);
    expect(await refusal(lg().markDelivered(id, agent, new Set([logistics])))).toMatchObject({ code: 'ORDER_NOT_FOUND' });
    h.clock.advance(DAY);
    const delivered = await lg().markDelivered(id, agent, scope());
    expect(delivered.step).toBe('DELIVERED');
    expect((await row(id)).status).toBe('DELIVERED');
    expect((await lg().parcels(scope())).onItsWay.map((r) => r.id)).not.toContain(id);
    expect(delivered.history.map((e) => [e.action, e.by])).toEqual([
      ['order.pack.start', 'LOGISTICS'],
      ['order.pack.scan', 'LOGISTICS'],
      ['order.pack.photo', 'LOGISTICS'],
      ['order.pack.photo', 'LOGISTICS'],
      ['order.pack.check', 'LOGISTICS'],
      ['order.ship', 'LOGISTICS'],
      ['order.deliver', 'LOGISTICS'],
    ]);
    // The agent's view carries no price, email, account nor release.
    const text = JSON.stringify(delivered);
    for (const word of ['price', 'Minor', 'email', 'account', 'release', 'drop']) expect(text).not.toContain(word);
  });

  it('ships a parcel of three whole, with ORBES staff\'s declared value per order; a warranty started by hand is left as it is, and a registration delivers', async () => {
    const parcel = await liveSale(3);
    for (const id of parcel) await pay(id);
    const s52 = await skuOf('52');
    await stock(s52, 3, parcel);
    // A warranty started by hand before Ship (the runbook's former step): left as it is.
    await packAndShip(
      h.ctx,
      parcel[0]!,
      {
        carrierId: colissimo,
        trackingNumber: '6A00000000003',
        beforeShip: async () => {
          const bound = (await row(parcel[1]!)).product_id!;
          await h.ctx.services.warranty.activate(bound, { purchaseDate: '2026-11-01', retailer: 'ORBES PARIS', country: 'FR' }, admin);
        },
      },
      admin,
    );
    const rows = await Promise.all(parcel.map(row));
    expect(rows.map((o) => [o.status, o.tracking_number, o.carrier_id])).toEqual(Array(3).fill(['SHIPPED', '6A00000000003', colissimo]));
    expect(new Set(rows.map((o) => o.product_id)).size).toBe(3);
    const moved = await db().selectFrom('stock_movements').select(['delta', 'order_id']).where('reason', '=', 'SHIPPED').where('order_id', 'in', parcel).execute();
    expect(moved.map((m) => m.delta)).toEqual([-1, -1, -1]);
    const kept = await db().selectFrom('warranties').select(['start_date', 'retailer']).where('product_id', '=', rows[1]!.product_id!).executeTakeFirstOrThrow();
    expect(kept).toEqual({ start_date: '2026-11-01', retailer: 'ORBES PARIS' });
    // packAndShip scans its size's first pieces in stock by serial: the pieces bound, whichever they are.
    const bound = await db().selectFrom('products').select(['id', 'product_id']).where('id', 'in', rows.map((o) => o.product_id!)).execute();
    const started = await db().selectFrom('audit_logs').select(['target_id', 'details']).where('action', '=', 'warranty.activate').where('target_id', 'in', bound.map((p) => p.product_id)).execute();
    expect(started.filter((a) => a.details.via === 'ship').map((a) => a.details.orderId).sort()).toEqual([parcel[0], parcel[2]].sort());
    // The fixture's address was entered on the parcel's first order, with its country (§1.1 (d)).
    expect(rows[0]).toMatchObject({ buyer_name: 'Test buyer', buyer_address: '1 rue de Test\n75001 Paris', buyer_country: 'FR' });
    // Its buyer registers a piece: that order is delivered; the parcel once all three are.
    const account = rows[0]!.account_id;
    const piece = await pieceOf(rows[0]!.product_id!);
    const scan = await h.ctx.services.verification.verify({ code: piece.data }, {});
    h.clock.advance(MINUTE);
    await h.ctx.services.ownership.registerFirst(account, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, { type: 'account', id: account });
    expect((await row(parcel[0]!)).status).toBe('DELIVERED');
    const shipment = (await lg().parcel(parcel[0]!, null)).shipment!;
    expect(shipment.status).toBe('SHIPPED');
    for (const id of parcel.slice(1)) await orders().transition(id, { to: 'DELIVERED' }, admin);
    expect((await lg().parcel(parcel[0]!, null)).shipment!.status).toBe('DELIVERED');
    // A registered piece, or a shipped one, is never a piece in stock.
    const next = await salonOrder('52', { paid: true });
    await buyer(next);
    await stock(s52, 1, [next]);
    await lg().startPacking(next, admin, null);
    expect(await refusal(lg().scanCard(next, scanOf(piece), admin, {}, null))).toMatchObject({ code: 'PACKING_SCAN_NOT_IN_STOCK' });
    const shippedPiece = await pieceOf(rows[2]!.product_id!);
    expect(await refusal(lg().scanCard(next, scanOf(shippedPiece), admin, {}, null))).toMatchObject({ code: 'PACKING_SCAN_NOT_IN_STOCK' });

    // ORBES staff declare a value per order of a parcel, in its currency.
    const two = await liveSale(2);
    for (const id of two) await pay(id);
    await stock(s52, 2, two);
    await buyer(two[0]!);
    await lg().startPacking(two[0]!, admin, null);
    for (const id of two) {
      const free = await db()
        .selectFrom('products as p')
        .select(['p.id'])
        .where('p.sku_id', '=', s52)
        .where('p.stock_entered_at', 'is not', null)
        .where('p.ownership_state', '=', 'UNREGISTERED')
        .where('p.status', '=', 'ISSUED')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('orders as x').select('x.id').whereRef('x.product_id', '=', 'p.id').where('x.status', 'not in', ['CANCELLED', 'RETURNED']))))
        .orderBy('p.product_id')
        .executeTakeFirstOrThrow();
      const code = await db().selectFrom('codes').select('id').where('product_id', '=', free.id).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow();
      const data = await h.ctx.services.issuance.verifiedActiveCode(code.id);
      await lg().scanCard(two[0]!, { code: Buffer.from(data.data).toString('base64url') }, admin, {}, null);
      void id;
    }
    await lg().setPhoto(two[0]!, { mime: 'image/jpeg', bytes: jpegPhoto(8, 8) }, admin, null);
    const keys = (await lg().parcel(two[0]!, null)).checklist.filter((l) => !l.byScan).map((l) => l.key);
    await lg().checkPacked(two[0]!, { ticked: keys }, admin, null);
    await lg().ship(two[0]!, { carrierId: colissimo, trackingNumber: '6A00000000004', declaredValues: [{ orderId: two[0]!, minor: 480_000 }, { orderId: two[1]!, minor: 300_000 }] }, admin, null);
    expect((await Promise.all(two.map(row))).map((o) => o.declared_value_minor)).toEqual([480_000, 300_000]);
    await orders().transition(next, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });

  it('one order of a parcel cancelled while packing: the shipment is cancelled, the others keep their pieces and their packing start, a new shipment opens and their scan is accepted again', async () => {
    const parcel = await liveSale(2, '60');
    for (const id of parcel) await pay(id);
    const s52 = await skuOf('60');
    const pieces = await stock(s52, 2, parcel);
    await buyer(parcel[0]!);
    const first = await lg().startPacking(parcel[0]!, agent, scope());
    const startedAt = (await row(parcel[0]!)).packing_started_at;
    for (const p of pieces) await lg().scanCard(parcel[0]!, scanOf(p), agent, {}, scope());
    const kept = (await row(parcel[0]!)).product_id!;
    // A waiting order of the size, older than nothing: the piece freed serves it.
    const waiting = await salonOrder('60', { paid: true });
    expect((await row(waiting)).reservation).toBe('AWAITING');
    h.clock.advance(MINUTE);
    await orders().transition(parcel[1]!, { to: 'CANCELLED', note: 'The client withdrew one piece.' }, admin);
    const old = await db().selectFrom('shipments').select(['status', 'cancelled_at']).where('id', '=', first.shipment!.id).executeTakeFirstOrThrow();
    expect(old.status).toBe('CANCELLED');
    const items = await db().selectFrom('shipment_items').select(['order_id', 'product_id']).where('shipment_id', '=', first.shipment!.id).execute();
    expect(items.find((i) => i.order_id === parcel[1])!.product_id).toBeNull();
    expect(items.find((i) => i.order_id === parcel[0])!.product_id).toBe(kept);
    expect((await row(waiting)).reservation).toBe('STOCK');
    expect(await row(parcel[0]!)).toMatchObject({ product_id: kept, packing_started_at: startedAt, reservation: 'STOCK' });
    // Listed again, keyed by its first order; a new shipment; the bound piece scanned again.
    expect((await listed()).find((r) => r.id === parcel[0])).toMatchObject({ others: 0, step: 'READY_TO_PACK' });
    const again = await lg().startPacking(parcel[0]!, agent, scope());
    expect(again.shipment!.id).not.toBe(first.shipment!.id);
    expect(again.orders.map((o) => o.orderId)).toEqual([parcel[0]]);
    const keptPiece = pieces.find((p) => p.uuid === kept)!;
    expect((await lg().scanCard(parcel[0]!, scanOf(keptPiece), agent, {}, scope())).parcel.orders[0]!.piece).toEqual({ productId: keptPiece.productId, scanned: true });
    await orders().transition(waiting, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });

  it('keeps a parcel keyed by its first order when that order is cancelled, with its address, and ships the others', async () => {
    const parcel = await liveSale(2, '62');
    for (const id of parcel) await pay(id);
    await buyer(parcel[0]!);
    await orders().transition(parcel[0]!, { to: 'CANCELLED', note: 'The client kept one piece only.' }, admin);
    const s52 = await skuOf('62');
    await stock(s52, 1, [parcel[1]!]);
    const p = (await listed()).find((r) => r.id === parcel[0])!;
    expect(p).toMatchObject({ others: 0, shipTo: { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: 'FR' } });
    await packAndShip(h.ctx, parcel[1]!, { carrierId: colissimo, trackingNumber: '6A00000000005' }, admin);
    expect((await row(parcel[1]!)).status).toBe('SHIPPED');
    expect((await db().selectFrom('shipments').select(['order_id', 'status']).where('order_id', '=', parcel[0]!).execute()).map((s) => s.status)).toEqual(['SHIPPED']);
  });

  it('moves a parcel whole when one of its orders changes location (§3.5.6.6), so it is listed and packed there; refuses once a piece is bound; Start packing names a parcel split across locations', async () => {
    const parcel = await liveSale(2, '64');
    for (const id of parcel) await pay(id);
    const s64 = await skuOf('64');
    await stock(s64, 2, parcel);
    await buyer(parcel[0]!);
    expect((await listed()).find((r) => r.id === parcel[0])).toMatchObject({ location: { id: france } });
    // The follower moved to LOGISTICS WAREHOUSE: its first order goes with it, both waiting there for stock.
    h.clock.advance(MINUTE);
    const moved = await orders().changeLocation(parcel[1]!, logistics, admin);
    expect(moved.location.id).toBe(logistics);
    expect((await Promise.all(parcel.map(row))).map((o) => [o.location_id, o.reservation, o.status])).toEqual([
      [logistics, 'AWAITING', 'PAID'],
      [logistics, 'AWAITING', 'PAID'],
    ]);
    const audits = await db().selectFrom('audit_logs').select(['target_id', 'details']).where('action', '=', 'order.location').where('target_id', 'in', parcel).execute();
    expect(audits.map((a) => a.target_id).sort()).toEqual([...parcel].sort());
    expect(audits.find((a) => a.target_id === parcel[0])!.details).toMatchObject({ fromLocationId: france, toLocationId: logistics, movedWith: parcel[1] });
    expect((await listed()).map((r) => r.id)).not.toContain(parcel[0]);
    // Stock arrives at LOGISTICS WAREHOUSE: the parcel is listed there, never split.
    const there = await stockPieces(h.ctx, { skuId: s64, locationId: logistics, count: 2, material: '925 STERLING SILVER', forOrderIds: parcel }, admin);
    expect((await listed()).find((r) => r.id === parcel[0])).toMatchObject({ others: 1, step: 'READY_TO_PACK', location: { id: logistics } });
    // A parcel left split across two locations (written before this rule): not listed, and Start packing says why.
    await db().updateTable('orders').set({ location_id: france }).where('id', '=', parcel[1]!).execute();
    expect((await listed()).map((r) => r.id)).not.toContain(parcel[0]);
    expect(await refusal(lg().startPacking(parcel[0]!, admin, null))).toEqual({
      code: 'PACKING_LOCATIONS_SPLIT',
      status: 409,
      message: 'The orders of this parcel are served from different locations: ORBES serves them from one location before it is packed.',
    });
    // ORBES serves it from one location again: only the order elsewhere moves.
    h.clock.advance(MINUTE);
    await orders().changeLocation(parcel[0]!, logistics, admin);
    expect((await Promise.all(parcel.map(row))).map((o) => [o.location_id, o.reservation])).toEqual([
      [logistics, 'STOCK'],
      [logistics, 'STOCK'],
    ]);
    await expect(orders().changeLocation(parcel[1]!, logistics, admin)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const started = await lg().startPacking(parcel[0]!, admin, null);
    expect(started.step).toBe('PACKING');
    await lg().scanCard(parcel[0]!, scanOf(there[0]!), admin, {}, null);
    // A piece bound to one order: neither order of the parcel moves.
    for (const id of parcel) expect(await refusal(orders().changeLocation(id, france, admin))).toMatchObject({ code: 'ORDER_PIECE_LINKED', status: 409 });
    for (const id of [...parcel].reverse()) await orders().transition(id, { to: 'CANCELLED', note: 'Test over.' }, admin);
  });

  it('needs the delivery country to pack (§1.1 (d)); shows ADDRESS CHANGED, with when and by whom, once the address is replaced after it was first entered, on the list and the parcel, until it ships (step 6.7)', async () => {
    const s64 = await skuOf('64');
    const id = await salonOrder('64', { paid: true });
    await stock(s64, 1, [id]);
    const account = (await row(id)).account_id;
    const collector: Actor = { type: 'account', id: account };
    // A name and an address of before, without a country: not enough to pack; the phone is not needed.
    await orders().setBuyer(id, { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris' }, admin);
    expect(await refusal(lg().startPacking(id, agent, scope()))).toMatchObject({ code: 'ORDER_ADDRESS_MISSING', status: 409 });
    expect((await listed(scope())).find((r) => r.id === id)).toMatchObject({ addressChanged: false, shipTo: { country: null } });
    expect((await lg().parcel(id, scope())).addressChanged).toBeNull();
    // The country entered by Client Services: the address replaced after it was first entered.
    h.clock.advance(MINUTE);
    await orders().setBuyer(id, { name: 'Ada Martin', address: '4 rue du Bac\n75007 Paris', country: 'FR' }, admin);
    const staffAt = h.clock.now();
    expect((await listed(scope())).find((r) => r.id === id)).toMatchObject({ addressChanged: true, shipTo: { country: 'FR' } });
    expect((await lg().parcel(id, scope())).addressChanged).toEqual({ at: staffAt, by: 'STAFF' });
    // The collector changes it before packing: by the collector now.
    h.clock.advance(MINUTE);
    await orders().setAddress(account, id, { address: { name: 'Ada Martin', address: '12 quai de Conti\n75006 Paris', country: 'FR', phone: '+33 6 98 76 54 32' } }, collector);
    const view = await lg().parcel(id, scope());
    expect(view.addressChanged).toEqual({ at: h.clock.now(), by: 'COLLECTOR' });
    expect(view.shipTo).toEqual({ name: 'Ada Martin', address: '12 quai de Conti\n75006 Paris', country: 'FR', phone: '+33 6 98 76 54 32' });
    // Packing starts: the collector no longer changes it; Client Services still does, and the mark follows.
    h.clock.advance(MINUTE);
    await lg().startPacking(id, agent, scope());
    expect(await refusal(orders().setAddress(account, id, { address: { name: 'Ada Martin', address: '1 rue de Rivoli\n75001 Paris', country: 'FR', phone: '+33 6 98 76 54 32' } }, collector))).toEqual({
      code: 'ORDER_PACKING_STARTED',
      status: 409,
      message: 'Packing has begun: write to ORBES Client Services to change this order.',
    });
    h.clock.advance(MINUTE);
    await orders().setBuyer(id, { name: 'Ada Martin', address: '1 rue de Rivoli\n75001 Paris' }, admin);
    expect((await lg().parcel(id, scope())).addressChanged).toEqual({ at: h.clock.now(), by: 'STAFF' });
    // Shipped: the mark no longer shows on the parcel.
    await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A00000000006' }, admin);
    expect((await lg().parcel(id, scope())).addressChanged).toBeNull();
  });
});
