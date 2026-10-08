/**
 * Returns (plan LIVE RELEASE+ of 2026-10-04, step S4: choice 20, Interconnection → RETURNED), on the services as
 * createContext wires them:
 *
 *  - a return opened by Client Services, from SHIPPED or DELIVERED only, with a note: back to stock at a chosen location
 *    (the ledger's RETURNED, +1) or to the archive;
 *  - a piece its buyer had registered: ORBES takes the ownership back (it ends RETURNED, `returns.ownership_id`; a
 *    transfer pending is cancelled; the certificate links end); back to stock, the piece is RESOLD and not registered,
 *    with a new claim code shown once (the old one no longer registers it): it can be picked from the stock for
 *    another order and registered by its next buyer; archived, it is RETIRED;
 *  - a piece never registered: back to stock still ISSUED, with a new claim code shown once (its buyer kept the card
 *    that left with it: the old code no longer registers it), or retired;
 *  - a piece whose record is reported (LOST) does not go back to stock, but may be archived;
 *  - every return: one event, its audit entries (`order.return`, `ownership.reclaim`, `invoice.credit`,
 *    `product.transition`) and journal entries, a credit note for its invoice; MY PIECES says RETURNED, with the credit
 *    note and without the certificate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { verifyClaimCode } from '../../src/server/services/claim-codes.js';
import { ensureSku, stockLevel } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { countPiecesIn, packAndShip, scanIntoParcel } from '../support/fulfil.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';

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

describe('returns (plan LIVE RELEASE+, S4)', () => {
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
    clock = createManualClock('2026-11-02T09:00:00.000Z');
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

  const orders = () => ctx.services.orders;
  const orderRow = (id: string) => t.db.selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const productRow = (id: string) => t.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const skuOf = (size: string) => inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, size));
  const auditsOf = (targetId: string) => t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', targetId).orderBy('id').execute();

  /** A piece of the size issued in advance with its claim code, counted in stock at FRANCE WAREHOUSE. */
  async function stockPiece(size: string) {
    const sku = await skuOf(size);
    const p = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: size, material: '925 STERLING SILVER', withClaimSecret: true }, admin);
    await countPiecesIn(ctx, { skuId: sku, locationId: france, productRefs: [p.product.productId] }, admin);
    return { sku, ...p };
  }

  /** A private salon's order of `buyer`, priced and sized, paid, its piece packed and shipped through the agent's steps. */
  async function shippedOrder(buyer: string, piece: Awaited<ReturnType<typeof stockPiece>>, size: string) {
    const request = await t.db.insertInto('shop_requests').values({ account_id: buyer, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: size, priceMinor: 480_000, currency: 'EUR' }, admin);
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'PAID' }, admin);
    clock.advance(MINUTE);
    await packAndShip(ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901', pieces: { [id]: piece.product.productId } }, admin);
    return id;
  }

  /** The buyer scans the piece and registers it with its claim code (its warranty started at SHIP, or at the sale). */
  async function register(accountId: string, codeData: string, claimCode: string, productUuid: string, activate = true) {
    const started = (await t.db.selectFrom('warranties').select('start_date').where('product_id', '=', productUuid).executeTakeFirst())?.start_date;
    if (activate && !started) await ctx.services.warranty.activate(productUuid, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    const scan = await ctx.services.verification.verify({ code: codeData }, {});
    clock.advance(MINUTE);
    return ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode }, { type: 'account', id: accountId });
  }

  it('opens only from SHIPPED or DELIVERED, with a note and where the piece goes', async () => {
    const piece = await stockPiece('60');
    const buyer = await createAccount(t.db);
    const request = await t.db.insertInto('shop_requests').values({ account_id: buyer.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: '60', priceMinor: 480_000, currency: 'EUR' }, admin);
    await rejects(orders().returnOrder(id, { outcome: 'ARCHIVED', note: 'Never shipped.' }, admin), 'ORDER_TRANSITION_NOT_ALLOWED', 409);
    await orders().transition(id, { to: 'PAID' }, admin);
    await scanIntoParcel(ctx, id, { pieces: { [id]: piece.product.productId } }, admin);
    await rejects(orders().returnOrder(id, { outcome: 'ARCHIVED', note: 'Never shipped.' }, admin), 'ORDER_TRANSITION_NOT_ALLOWED', 409);
    await packAndShip(ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    await rejects(orders().returnOrder(id, { outcome: 'RESTOCKED', note: 'x' }, admin), 'STOCK_LOCATION_NOT_FOUND', 404);
    await rejects(orders().returnOrder(id, { outcome: 'RESTOCKED', locationId: '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', note: 'x' }, admin), 'STOCK_LOCATION_NOT_FOUND', 404);
    await rejects(orders().returnOrder(id, { outcome: 'ARCHIVED', locationId: france, note: 'x' }, admin), 'VALIDATION_FAILED', 400);
    await rejects(orders().returnOrder(id, { outcome: 'LOST' as 'ARCHIVED', note: 'x' }, admin), 'VALIDATION_FAILED', 400);
    await rejects(orders().returnOrder(id, { outcome: 'ARCHIVED', note: ' ' }, admin), 'VALIDATION_FAILED', 400);
    await rejects(orders().returnOrder(id, { outcome: 'ARCHIVED', note: 'x' }, buyer.actor), 'FORBIDDEN', 403);
    expect((await orderRow(id)).status).toBe('SHIPPED');
    expect(await t.db.selectFrom('returns').select('id').where('order_id', '=', id).execute()).toEqual([]);
  });

  it('back to stock, a piece never registered: counted again where Client Services chose, RESOLD (its warranty started at SHIP) with a new claim code (the old card no longer registers it), picked again for another order', async () => {
    const piece = await stockPiece('61');
    const buyer = await createAccount(t.db);
    const id = await shippedOrder(buyer.id, piece, '61');
    const before = await productRow(piece.product.id);
    expect(await stockLevel(t.db, piece.sku, france)).toEqual({ onHand: 0, reserved: 0, available: 0 });
    clock.advance(MINUTE);
    const r = await orders().returnOrder(id, { outcome: 'RESTOCKED', locationId: logistics, note: 'Returned unworn, in its box.' }, admin);
    expect(r.claimCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(r.productId).toBe(piece.product.productId);
    expect(r.order).toMatchObject({ status: 'RETURNED', returnedAt: clock.now() });
    expect(r.order.return).toEqual({ outcome: 'RESTOCKED', location: { id: logistics, name: 'LOGISTICS WAREHOUSE' }, note: 'Returned unworn, in its box.', at: clock.now(), ownershipReclaimed: false });
    expect(await stockLevel(t.db, piece.sku, logistics)).toEqual({ onHand: 1, reserved: 0, available: 1 });
    const [moved] = await t.db.selectFrom('stock_movements').selectAll().where('order_id', '=', id).where('reason', '=', 'RETURNED').execute();
    expect(moved).toMatchObject({ sku_id: piece.sku, location_id: logistics, delta: 1, product_id: piece.product.id, note: 'Returned unworn, in its box.', actor_id: admin.id });
    const after = await productRow(piece.product.id);
    // Shipped, its warranty started (plan NEXT LOT question 14): back in stock, ready to be sold again.
    expect([before.status, after.status, after.ownership_state]).toEqual(['ACTIVATED', 'RESOLD', 'UNREGISTERED']);
    // Its buyer kept the card that left with it: its code no longer registers it, the new one does.
    expect(after.claim_secret_hash).not.toBe(before.claim_secret_hash);
    expect(await verifyClaimCode(piece.claimCode!, after.claim_secret_hash!)).toBe(false);
    expect(await verifyClaimCode(r.claimCode!, after.claim_secret_hash!)).toBe(true);
    expect(await t.db.selectFrom('returns').select(['outcome', 'location_id', 'ownership_id']).where('order_id', '=', id).execute()).toEqual([{ outcome: 'RESTOCKED', location_id: logistics, ownership_id: null }]);
    // Its audit: the return, its credit note; nothing about an ownership.
    expect((await auditsOf(id)).map((a) => a.action)).toContain('order.return');
    expect((await auditsOf(id)).at(-1)!.details).toMatchObject({ from: 'SHIPPED', to: 'RETURNED', outcome: 'RESTOCKED', locationId: logistics, ownershipReclaimed: false, claimCodeReissued: true, noted: true });
    expect((await auditsOf(piece.product.productId)).map((a) => a.action)).not.toContain('ownership.reclaim');
    expect(JSON.stringify(await t.db.selectFrom('audit_logs').select('details').execute())).not.toContain(r.claimCode!);
    // Picked again from the stock for another collector's order.
    const next = await createAccount(t.db);
    const request = await t.db.insertInto('shop_requests').values({ account_id: next.id, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const second = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().changeLocation(second, logistics, admin);
    await orders().setTerms(second, { sizeLabel: '61', priceMinor: 480_000, currency: 'EUR' }, admin);
    expect((await orderRow(second)).reservation).toBe('STOCK');
    await orders().transition(second, { to: 'PAID' }, admin);
    await scanIntoParcel(ctx, second, { pieces: { [second]: piece.product.productId } }, admin);
    expect((await orderRow(second)).product_id).toBe(piece.product.id);
  });

  it('back to stock, a piece its buyer registered: ORBES takes the ownership back, the piece RESOLD and unregistered with a new claim code shown once; its next buyer registers it with that code', async () => {
    const piece = await stockPiece('62');
    const buyer = await createAccount(t.db);
    const id = await shippedOrder(buyer.id, piece, '62');
    await register(buyer.id, piece.code.data, piece.claimCode!, piece.product.id);
    expect((await orderRow(id)).status).toBe('DELIVERED');
    expect((await productRow(piece.product.id)).status).toBe('OWNED');
    // The buyer had shared a certificate link and offered the piece to someone: both end with the return.
    const offer = await ctx.services.ownershipCertificates.create(buyer.id, piece.product.productId, {}, buyer.actor);
    await ctx.services.ownership.initiateTransfer(buyer.id, piece.product.productId, buyer.actor);
    const owner = await t.db.selectFrom('ownership').selectAll().where('product_id', '=', piece.product.id).where('ended_at', 'is', null).executeTakeFirstOrThrow();
    const oldHash = (await productRow(piece.product.id)).claim_secret_hash!;

    clock.advance(MINUTE);
    const r = await orders().returnOrder(id, { outcome: 'RESTOCKED', locationId: france, note: 'Returned within the delay.' }, admin);
    expect(r.claimCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(r.order.return).toMatchObject({ outcome: 'RESTOCKED', ownershipReclaimed: true });
    // The ownership ended RETURNED, recorded with the return; the transfer cancelled; the link no longer valid.
    expect(await t.db.selectFrom('ownership').select(['ended_at', 'ended_reason']).where('id', '=', owner.id).executeTakeFirstOrThrow()).toEqual({ ended_at: clock.now(), ended_reason: 'RETURNED' });
    expect(await t.db.selectFrom('ownership').select('id').where('product_id', '=', piece.product.id).where('ended_at', 'is', null).execute()).toEqual([]);
    expect((await t.db.selectFrom('returns').select('ownership_id').where('order_id', '=', id).executeTakeFirstOrThrow()).ownership_id).toBe(owner.id);
    expect((await t.db.selectFrom('ownership_transfers').select('status').where('product_id', '=', piece.product.id).execute()).map((x) => x.status)).toEqual(['CANCELLED']);
    expect((await ctx.services.ownershipCertificates.lookup(offer.token)).status).toBe('NO_LONGER_VALID');
    // The piece: ready to be sold again, not registered, its new claim code the only one that registers it.
    const p = await productRow(piece.product.id);
    expect([p.status, p.ownership_state]).toEqual(['RESOLD', 'UNREGISTERED']);
    expect(p.claim_secret_hash).not.toBe(oldHash);
    expect(await verifyClaimCode(r.claimCode!, p.claim_secret_hash!)).toBe(true);
    expect(await verifyClaimCode(piece.claimCode!, p.claim_secret_hash!)).toBe(false);
    expect(await stockLevel(t.db, piece.sku, france)).toEqual({ onHand: 1, reserved: 0, available: 1 });
    // Audited: the return, ORBES taking the ownership back (the account by id; the code never), the transfer, the piece.
    const audits = await auditsOf(piece.product.productId);
    const reclaim = audits.find((a) => a.action === 'ownership.reclaim')!;
    expect(reclaim.details).toEqual({ accountId: buyer.id, orderId: id, outcome: 'RESTOCKED', claimCodeReissued: true });
    expect(audits.find((a) => a.action === 'ownership.transfer.cancel')!.details).toMatchObject({ reason: 'order_returned' });
    expect(audits.filter((a) => a.action === 'product.transition').at(-1)!.details).toMatchObject({ from: 'OWNED', to: 'RESOLD', via: 'order.return' });
    expect(JSON.stringify(await t.db.selectFrom('audit_logs').select('details').execute())).not.toContain(r.claimCode!);
    expect((await auditsOf(id)).at(-1)!.details).toMatchObject({ to: 'RETURNED', ownershipReclaimed: true, claimCodeReissued: true, pieceStatus: 'RESOLD' });
    // The journal: the order, the piece, the credit note.
    const journal = await t.db.selectFrom('event_journal').select(['type', 'entity_id', 'payload']).where('created_at', '=', clock.now()).orderBy('id').execute();
    expect(journal.map((j) => j.type)).toEqual(['stock.move', 'order.return', 'invoice.credit', 'product.transition']);
    expect(journal.at(-1)!.payload).toMatchObject({ productId: piece.product.productId, status: 'RESOLD' });

    // MY PIECES: the order RETURNED with its invoice and credit note; no certificate, no care guide.
    const [mine] = (await orders().forAccount(buyer.id)).filter((o) => o.id === id);
    expect(mine!.status).toBe('RETURNED');
    expect(mine!.documents).toEqual({
      invoice: { number: expect.stringMatching(/^INV-2026-\d{6}$/), issuedAt: expect.any(Date) },
      creditNote: { number: expect.stringMatching(/^CN-2026-\d{6}$/), issuedAt: clock.now() },
      others: [],
      careGuide: false,
      certificate: false,
    });
    expect((await ctx.services.ownership.listForAccount(buyer.id)).map((x) => x.productId)).not.toContain(piece.product.productId);

    // Sold again: picked from the stock for its next buyer, shipped, registered with the new code only.
    const next = await createAccount(t.db);
    const second = await shippedOrder(next.id, { ...piece, claimCode: r.claimCode }, '62');
    await rejects(register(next.id, piece.code.data, piece.claimCode!, piece.product.id, false), 'CLAIM_CODE_INVALID', 403);
    await register(next.id, piece.code.data, r.claimCode!, piece.product.id, false);
    expect((await orderRow(second)).status).toBe('DELIVERED');
    expect((await ctx.services.ownership.currentOwner(piece.product.productId))?.accountId).toBe(next.id);
    const [theirs] = (await orders().forAccount(next.id)).filter((o) => o.id === second);
    expect(theirs!.documents.certificate).toBe(true);
  });

  it('a piece returned, then bought again by the same account: only the order that holds it now offers its certificate', async () => {
    const piece = await stockPiece('66');
    const buyer = await createAccount(t.db);
    const first = await shippedOrder(buyer.id, piece, '66');
    await register(buyer.id, piece.code.data, piece.claimCode!, piece.product.id);
    clock.advance(MINUTE);
    const r = await orders().returnOrder(first, { outcome: 'RESTOCKED', locationId: france, note: 'Returned within the delay.' }, admin);
    // Bought again, registered again by the same account with the new code: its ownership is open once more.
    const again = await shippedOrder(buyer.id, { ...piece, claimCode: r.claimCode }, '66');
    await register(buyer.id, piece.code.data, r.claimCode!, piece.product.id, false);
    expect((await ctx.services.ownership.currentOwner(piece.product.productId))?.accountId).toBe(buyer.id);
    const mine = new Map((await orders().forAccount(buyer.id)).map((o) => [o.id, o]));
    expect([mine.get(first)!.status, mine.get(first)!.documents.certificate]).toEqual(['RETURNED', false]);
    expect([mine.get(again)!.status, mine.get(again)!.documents.certificate]).toEqual(['DELIVERED', true]);
    await rejects(ctx.services.ownershipCertificates.orderCertificatePdf(buyer.id, first), 'CERTIFICATE_NOT_AVAILABLE', 409);
    expect((await ctx.services.ownershipCertificates.orderCertificatePdf(buyer.id, again)).contentType).toBe('application/pdf');
  });

  it('to the archive, a piece its buyer registered: ORBES takes the ownership back and the piece is retired; no claim code, nothing back in stock', async () => {
    const piece = await stockPiece('63');
    const buyer = await createAccount(t.db);
    const id = await shippedOrder(buyer.id, piece, '63');
    await register(buyer.id, piece.code.data, piece.claimCode!, piece.product.id);
    clock.advance(MINUTE);
    const r = await orders().returnOrder(id, { outcome: 'ARCHIVED', note: 'Damaged: kept in the archive.' }, admin);
    expect(r.claimCode).toBeUndefined();
    expect(r.order.return).toEqual({ outcome: 'ARCHIVED', location: null, note: 'Damaged: kept in the archive.', at: clock.now(), ownershipReclaimed: true });
    const p = await productRow(piece.product.id);
    expect([p.status, p.ownership_state]).toEqual(['RETIRED', 'UNREGISTERED']);
    expect(await t.db.selectFrom('ownership').select('id').where('product_id', '=', piece.product.id).where('ended_at', 'is', null).execute()).toEqual([]);
    expect(await t.db.selectFrom('stock_movements').select('id').where('order_id', '=', id).where('reason', '=', 'RETURNED').execute()).toEqual([]);
    expect(await stockLevel(t.db, piece.sku, france)).toEqual({ onHand: 0, reserved: 0, available: 0 });
    expect((await auditsOf(piece.product.productId)).find((a) => a.action === 'ownership.reclaim')!.details).toMatchObject({ outcome: 'ARCHIVED', claimCodeReissued: false });
    // /verify answers the piece as retired.
    const scan = await ctx.services.verification.verify({ code: piece.code.data }, {});
    expect(scan.registration).toBeUndefined();
  });

  it('to the archive, a piece never registered: retired; a piece reported lost goes back to stock only once its record is settled, and may be archived', async () => {
    const quiet = await stockPiece('64');
    const id = await shippedOrder((await createAccount(t.db)).id, quiet, '64');
    await orders().returnOrder(id, { outcome: 'ARCHIVED', note: 'Kept by the house.' }, admin);
    expect((await productRow(quiet.product.id)).status).toBe('RETIRED');

    const lost = await stockPiece('65');
    const buyer = await createAccount(t.db);
    const second = await shippedOrder(buyer.id, lost, '65');
    await register(buyer.id, lost.code.data, lost.claimCode!, lost.product.id);
    await ctx.services.ownership.reportIncident(buyer.id, lost.product.productId, 'LOST', buyer.actor);
    expect((await productRow(lost.product.id)).status).toBe('LOST');
    await rejects(orders().returnOrder(second, { outcome: 'RESTOCKED', locationId: france, note: 'Found and returned.' }, admin), 'ORDER_RETURN_NOT_RESTOCKABLE', 409);
    // Nothing changed: still the buyer's, still DELIVERED, nothing counted.
    expect((await orderRow(second)).status).toBe('DELIVERED');
    expect((await ctx.services.ownership.currentOwner(lost.product.productId))?.accountId).toBe(buyer.id);
    expect(await stockLevel(t.db, lost.sku, france)).toEqual({ onHand: 0, reserved: 0, available: 0 });
    await orders().returnOrder(second, { outcome: 'ARCHIVED', note: 'Found damaged.' }, admin);
    expect((await productRow(lost.product.id)).status).toBe('RETIRED');
    // A return is opened once.
    await rejects(orders().returnOrder(second, { outcome: 'ARCHIVED', note: 'Again.' }, admin), 'ORDER_TRANSITION_NOT_ALLOWED', 409);
  });
});
