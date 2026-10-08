/**
 * Order cases (plan NEXT LOT of 2026-10-07, §1.1 (b) and §3.5.6.7, step 5.10; services/order-cases.ts), on the services
 * as createContext wires them. The collector's own requests (§3.6.D) join this file with step 6.9.
 *
 * Parcel problems:
 *  - back to sender → the agent records it → RESHIP: its pieces back in stock, still bound, packed again; their
 *    warranties kept;
 *  - lost → ADMIN only; the pieces revoked; the reshipment ahead of the queue (`queue_first`);
 *  - damaged → refused before the agent records it back; then back to stock (at the location ORBES chose, with a new
 *    claim code shown once to staff, which registers the piece, while the card the collector saw no longer does) or
 *    archived (ADMIN) as ORBES chooses; the reshipment ahead of the queue;
 *  - a parcel paid and shipped long ago, back to sender or lost, then reshipped from stock: on To ship, ready from the
 *    decision, not LATE;
 *  - a damaged parcel never back: its order case cancelled, the shipment SHIPPED again, then reported lost;
 *  - refund → a credit note, the piece serving the next order, and a new claim code waiting on its piece replaced
 *    (§3.4's hook in `step()`);
 *  - a parcel reported lost whose piece its buyer registers meanwhile: its case cancelled, never revoked.
 * Returns and exchanges opened by Client Services:
 *  - open (one open per order; an exchange's size in stock only; after the 14 days too), received OK or DAMAGED;
 *  - decide refund (back to stock with a new claim code; the archive ADMIN), exchange (an EXCHANGE order PAID with its
 *    invoice naming SIZE EXCHANGE, the original's credit note; the original's credit carried onto it, the balance
 *    unchanged); the packing photo kept while a return is open;
 *  - a return on a parcel shipped and never marked delivered: once decided, the parcel DELIVERED, off On its way, its
 *    photo erased 14 days later;
 *  - cancel the order case.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { verifyClaimCode } from '../../src/server/services/claim-codes.js';
import { linesOf } from '../../src/server/services/invoices.js';
import { REGISTERED_BY_BUYER } from '../../src/server/services/orders.js';
import { purgePackingPhotos } from '../../src/server/services/parcels.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { creditBalances } from '../../src/server/services/tier-grants.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Catalog, type Harness } from '../api/support.js';
import { packAndShip, stockPieces, type StockedPiece } from '../support/fulfil.js';
import { createAccount, holdPieces } from '../support/live.js';

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

describe('order cases (plan NEXT LOT §3.5.6.7)', () => {
  let h: Harness;
  let catalog: Catalog;
  let operator: Actor;
  let admin: Actor;
  let agent: Actor;
  let france: string;
  let warehouse: string;
  let colissimo: string;
  let size = 40;
  const issued = new Map<string, StockedPiece>();

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-11-03T09:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    operator = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    admin = { type: 'admin', id: (await createAdmin(h.ctx, 'ADMIN')).id };
    france = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    warehouse = (await h.t.db.selectFrom('stock_locations').select('id').where('name', '=', 'LOGISTICS WAREHOUSE').executeTakeFirstOrThrow()).id;
    agent = { type: 'admin', id: (await createAdmin(h.ctx, 'LOGISTICS', { stockLocationIds: [france] })).id };
    colissimo = (await h.t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => h?.close());

  const cases = () => h.ctx.services.orderCases;
  const orders = () => h.ctx.services.orders;
  const db = () => h.t.db;
  const scope = () => new Set([france]);
  const row = (id: string) => db().selectFrom('orders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const product = (uuid: string) => db().selectFrom('products').selectAll().where('id', '=', uuid).executeTakeFirstOrThrow();
  const skuOf = (label: string) => h.ctx.db.transaction().execute((tx) => ensureSku(tx, catalog.modelId, label));
  const freshSize = () => String((size += 2));
  const stock = async (skuId: string, count: number, forOrderIds?: string[]) => {
    const out = await stockPieces(h.ctx, { skuId, locationId: france, count, ...(forOrderIds ? { forOrderIds } : {}) }, operator);
    for (const p of out) issued.set(p.uuid, p);
    return out;
  };

  /** A salon order of a size, priced (for `accountId`, a new account by default), with credit taken off it; paid when asked. */
  async function salonOrder(label: string, opts: { paid?: boolean; accountId?: string; creditMinor?: number } = {}): Promise<string> {
    const accountId = opts.accountId ?? (await createAccount(db())).id;
    const request = await db().insertInto('shop_requests').values({ account_id: accountId, model_id: catalog.modelId, created_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    h.clock.advance(MINUTE);
    await h.ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, operator);
    const id = (await db().selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: label, priceMinor: 420_000, currency: 'EUR' }, operator);
    if (opts.creditMinor) await orders().applyCredit(id, opts.creditMinor, operator);
    if (opts.paid) {
      h.clock.advance(MINUTE);
      await orders().transition(id, { to: 'PAID' }, operator);
    }
    return id;
  }

  /** A paid order of a size of its own, its piece stocked, packed and shipped by the agent's steps. */
  async function shippedOrder(label = freshSize(), opts: { accountId?: string; creditMinor?: number } = {}): Promise<{ id: string; skuId: string; piece: StockedPiece }> {
    const skuId = await skuOf(label);
    const id = await salonOrder(label, { paid: true, ...opts });
    await stock(skuId, 1, [id]);
    await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A12345678901' }, operator);
    return { id, skuId, piece: issued.get((await row(id)).product_id!)! };
  }

  const caseOf = async (orderId: string) => (await cases().forOrder(orderId))[0]!;

  describe('parcel problems', () => {
    it('back to sender: the agent records it, ORBES reships: the pieces back in stock still bound, packed again, their warranties kept', async () => {
      const { id, skuId, piece } = await shippedOrder();
      const started = (await db().selectFrom('warranties').select('start_date').where('product_id', '=', piece.uuid).executeTakeFirstOrThrow()).start_date;
      // Only a shipped parcel; one case at a time.
      const reported = await cases().report(id, { kind: 'BACK_TO_SENDER', note: 'Returned by the carrier: address unknown.' }, agent, scope());
      expect(reported).toMatchObject({ kind: 'BACK_TO_SENDER', status: 'OPEN', openedBy: 'CLIENT_SERVICES', shipment: { orders: [{ id }] } });
      expect((await db().selectFrom('shipments').select('status').where('order_id', '=', id).executeTakeFirstOrThrow()).status).toBe('BACK_TO_SENDER');
      expect(await refusal(cases().report(id, { kind: 'LOST', note: 'Again.' }, agent, scope()))).toMatchObject({ code: 'SHIPMENT_NOT_FOUND', status: 404 });
      expect((await cases().toReceive(scope())).map((c) => c.id)).toContain(reported.id);
      expect(await refusal(cases().decide(reported.id, { decision: 'RESHIP' }, operator, { admin: false }))).toEqual({ code: 'ORDER_CASE_NOT_RECEIVED', status: 409, message: 'The agent records the parcel before you decide.' });
      h.clock.advance(DAY);
      const received = await cases().receive(reported.id, { pieceState: 'OK' }, agent, scope());
      expect(received.received).toMatchObject({ pieceState: 'OK', note: null });
      expect(await refusal(cases().receive(reported.id, { pieceState: 'OK' }, agent, scope()))).toMatchObject({ code: 'ORDER_CASE_RECEIVED' });
      const decided = await cases().decide(reported.id, { decision: 'RESHIP' }, operator, { admin: false });
      expect(decided.case).toMatchObject({ status: 'CLOSED', decision: { outcome: 'RESHIP', pieceTo: 'RESTOCKED' } });
      expect(await row(id)).toMatchObject({ status: 'PAID', reservation: 'STOCK', product_id: piece.uuid, shipped_at: null, carrier_id: null, tracking_number: null, queue_first: false });
      const back = await db().selectFrom('stock_movements').select(['delta', 'reason']).where('order_id', '=', id).orderBy('id').execute();
      expect(back.map((m) => [m.reason, m.delta])).toEqual([
        ['SHIPPED', -1],
        ['RETURNED', 1],
      ]);
      expect((await h.ctx.services.logistics.parcels(scope())).toShip.map((p) => p.id)).toContain(id);
      // Packed and shipped again: the scan takes the piece still bound (ACTIVATED), its warranty left as it is.
      await packAndShip(h.ctx, id, { carrierId: colissimo, trackingNumber: '6A00000000002' }, operator);
      expect(await row(id)).toMatchObject({ status: 'SHIPPED', product_id: piece.uuid, tracking_number: '6A00000000002' });
      expect((await db().selectFrom('warranties').select('start_date').where('product_id', '=', piece.uuid).executeTakeFirstOrThrow()).start_date).toBe(started);
      const activations = await db().selectFrom('audit_logs').select('id').where('action', '=', 'warranty.activate').where('target_id', '=', piece.productId).execute();
      expect(activations).toHaveLength(1);
      const audit = await db().selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', id).where('action', 'in', ['order.case.open', 'order.case.receive', 'order.case.decide']).orderBy('id').execute();
      expect(audit.map((a) => a.action)).toEqual(['order.case.open', 'order.case.receive', 'order.case.decide']);
      expect(JSON.stringify(audit)).not.toContain('address unknown');
    });

    it('lost: decided by an ADMIN only, its pieces revoked, the reshipment served ahead of an older waiting order', async () => {
      const label = freshSize();
      const older = await salonOrder(freshSize(), { paid: true });
      const { id, skuId, piece } = await shippedOrder(label);
      // An older order now waits for the same size.
      await orders().setTerms(older, { sizeLabel: label }, operator);
      expect((await row(older)).reservation).toBe('AWAITING');
      const lost = await cases().report(id, { kind: 'LOST', note: 'No scan for 12 days.' }, operator, null);
      expect(await refusal(cases().receive(lost.id, { pieceState: 'OK' }, agent, scope()))).toMatchObject({ code: 'ORDER_CASE_NOT_RECEIVABLE' });
      expect(await refusal(cases().decide(lost.id, { decision: 'RESHIP' }, operator, { admin: false }))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await cases().decide(lost.id, { decision: 'RESHIP', note: 'Another piece.' }, admin, { admin: true });
      expect((await product(piece.uuid)).status).toBe('REVOKED');
      expect(await row(id)).toMatchObject({ status: 'PAID', reservation: 'AWAITING', product_id: null, queue_first: true });
      // One piece arrives: the reshipment takes it, ahead of the older order.
      await stock(skuId, 1);
      expect((await row(id)).reservation).toBe('STOCK');
      expect((await row(older)).reservation).toBe('AWAITING');
      expect((await caseOf(id)).decision).toMatchObject({ outcome: 'RESHIP', pieceTo: 'REVOKED' });
      await orders().transition(older, { to: 'CANCELLED', note: 'Test over.' }, operator);
    });

    it('damaged: decided once back, the piece to stock or to the archive (ADMIN) as ORBES chooses; the reshipment ahead of the queue', async () => {
      const { id, skuId, piece } = await shippedOrder();
      const damaged = await cases().report(id, { kind: 'DAMAGED', note: 'The box arrived crushed.' }, agent, scope());
      expect(await refusal(cases().decide(damaged.id, { decision: 'RESHIP', pieceTo: 'RESTOCKED' }, operator, { admin: false }))).toMatchObject({ code: 'ORDER_CASE_NOT_RECEIVED' });
      await cases().receive(damaged.id, { pieceState: 'DAMAGED', note: 'Scratched.' }, agent, scope());
      expect(await refusal(cases().decide(damaged.id, { decision: 'RESHIP', pieceTo: 'ARCHIVED' }, operator, { admin: false }))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await refusal(cases().decide(damaged.id, { decision: 'RESHIP' }, operator, { admin: false }))).toMatchObject({ code: 'VALIDATION_FAILED' });
      // Back to stock at the location ORBES chose (not the order's): the piece freed (RESOLD), counted there; the
      // reshipment, at the order's location, waits first in line.
      const hashBefore = (await product(piece.uuid)).claim_secret_hash;
      const decided = await cases().decide(damaged.id, { decision: 'RESHIP', pieceTo: 'RESTOCKED', locationId: warehouse }, operator, { admin: false });
      expect(await product(piece.uuid)).toMatchObject({ status: 'RESOLD' });
      const back = await db().selectFrom('stock_movements').select(['location_id', 'reason', 'delta']).where('order_id', '=', id).where('reason', '=', 'RETURNED').execute();
      expect(back).toEqual([{ location_id: warehouse, reason: 'RETURNED', delta: 1 }]);
      expect(await row(id)).toMatchObject({ status: 'PAID', reservation: 'AWAITING', product_id: null, queue_first: true, location_id: france });
      const levels = (await h.ctx.services.logistics.stock({ modelId: catalog.modelId })).rows.filter((r) => r.sku.id === skuId);
      expect(levels.find((r) => r.location.id === warehouse)).toMatchObject({ onHand: 1, reserved: 0 });
      expect(levels.find((r) => r.location.id === france)).toMatchObject({ onHand: 0, reserved: 0 });
      // The card the collector saw in the crushed box no longer registers the piece: a new claim code nobody sees.
      expect((await product(piece.uuid)).claim_secret_hash).not.toBe(hashBefore);
      const reship = await db().selectFrom('audit_logs').select('details').where('action', '=', 'order.reship').where('target_id', '=', id).executeTakeFirstOrThrow();
      expect(reship.details).toMatchObject({ claimCodeReissued: true });
      const buyer = (await row(id)).account_id;
      const scan = await h.ctx.services.verification.verify({ code: piece.data }, {});
      expect(await refusal(h.ctx.services.ownership.registerFirst(buyer, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, { type: 'account', id: buyer }))).toMatchObject({ code: 'CLAIM_CODE_INVALID' });
      // Its new claim code, shown once to staff in the answer so its new card is printed: it registers the piece.
      expect(decided.claimCodes?.map((x) => x.productId)).toEqual([piece.productId]);
      const fresh = decided.claimCodes![0]!.claimCode;
      expect(await verifyClaimCode(fresh, (await product(piece.uuid)).claim_secret_hash!)).toBe(true);
      expect(await verifyClaimCode(piece.claimCode!, (await product(piece.uuid)).claim_secret_hash!)).toBe(false);
      const nextBuyer = (await createAccount(db())).id;
      const again = await h.ctx.services.verification.verify({ code: piece.data }, {});
      h.clock.advance(MINUTE);
      await h.ctx.services.ownership.registerFirst(nextBuyer, { registrationToken: again.registration!.token, claimCode: fresh }, { type: 'account', id: nextBuyer });
      expect(await db().selectFrom('ownership').select('account_id').where('product_id', '=', piece.uuid).where('ended_at', 'is', null).executeTakeFirstOrThrow()).toEqual({ account_id: nextBuyer });
      // Another damaged parcel archived by an ADMIN: the piece retired, the reshipment waits first in line.
      const second = await shippedOrder();
      const c2 = await cases().report(second.id, { kind: 'DAMAGED', note: 'Crushed.' }, agent, scope());
      await cases().receive(c2.id, { pieceState: 'DAMAGED' }, agent, scope());
      expect((await cases().decide(c2.id, { decision: 'RESHIP', pieceTo: 'ARCHIVED' }, admin, { admin: true })).claimCodes).toBeUndefined();
      expect((await product(second.piece.uuid)).status).toBe('RETIRED');
      expect(await row(second.id)).toMatchObject({ reservation: 'AWAITING', queue_first: true });
    });

    it('a lost parcel refunded by an ADMIN, and a damaged one refunded with its piece back to stock: cancelled with their credit notes', async () => {
      const lost = await shippedOrder();
      const c1 = await cases().report(lost.id, { kind: 'LOST', note: 'No news.' }, operator, null);
      await cases().decide(c1.id, { decision: 'REFUND' }, admin, { admin: true });
      expect(await row(lost.id)).toMatchObject({ status: 'CANCELLED', reservation: null, product_id: null });
      expect((await product(lost.piece.uuid)).status).toBe('REVOKED');
      expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', lost.id).orderBy('issued_at').orderBy('kind', 'desc').execute()).map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
      const damaged = await shippedOrder();
      const c2 = await cases().report(damaged.id, { kind: 'DAMAGED', note: 'Crushed.' }, agent, scope());
      await cases().receive(c2.id, { pieceState: 'OK' }, agent, scope());
      const hashBefore = (await product(damaged.piece.uuid)).claim_secret_hash;
      const refunded = await cases().decide(c2.id, { decision: 'REFUND', pieceTo: 'RESTOCKED' }, operator, { admin: false });
      expect(await row(damaged.id)).toMatchObject({ status: 'CANCELLED', product_id: null });
      expect((await product(damaged.piece.uuid)).status).toBe('RESOLD');
      expect((await product(damaged.piece.uuid)).claim_secret_hash).not.toBe(hashBefore);
      expect(refunded.claimCodes?.map((x) => x.productId)).toEqual([damaged.piece.productId]);
      expect(await verifyClaimCode(refunded.claimCodes![0]!.claimCode, (await product(damaged.piece.uuid)).claim_secret_hash!)).toBe(true);
      const level = (await h.ctx.services.logistics.stock({ modelId: catalog.modelId })).rows.find((r) => r.sku.id === damaged.skuId && r.location.id === france)!;
      expect([level.onHand, level.reserved]).toEqual([1, 0]);
    });

    it('a damaged parcel that never comes back: its case cancelled, the shipment SHIPPED again, then reported lost', async () => {
      const { id } = await shippedOrder();
      const damaged = await cases().report(id, { kind: 'DAMAGED', note: 'Crushed, kept by the carrier.' }, agent, scope());
      const cancelled = await cases().cancel(damaged.id, { note: 'The parcel never came back: reported lost.' }, operator);
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelled: { note: 'The parcel never came back: reported lost.' } });
      expect((await db().selectFrom('shipments').select('status').where('order_id', '=', id).executeTakeFirstOrThrow()).status).toBe('SHIPPED');
      expect(await refusal(cases().cancel(damaged.id, { note: 'Again.' }, operator))).toMatchObject({ code: 'ORDER_CASE_CLOSED', status: 409 });
      const lost = await cases().report(id, { kind: 'LOST', note: 'Never came back.' }, operator, null);
      expect(lost.status).toBe('OPEN');
    });

    it('a parcel paid and shipped long ago, back to sender or lost, then reshipped from stock: on To ship, ready from the decision, not LATE', async () => {
      // Both paid and shipped 8 days ago.
      const back = await shippedOrder();
      const lost = await shippedOrder();
      await stock(lost.skuId, 1);
      h.clock.advance(8 * DAY);
      // Back to sender: its piece back in stock, still bound, ready again from the decision.
      const c1 = await cases().report(back.id, { kind: 'BACK_TO_SENDER', note: 'Address unknown.' }, agent, scope());
      await cases().receive(c1.id, { pieceState: 'OK' }, agent, scope());
      h.clock.advance(MINUTE);
      const decidedAt = h.clock.now();
      await cases().decide(c1.id, { decision: 'RESHIP' }, operator, { admin: false });
      // Lost: a piece in stock taken at once (ahead of the queue), ready from the decision too.
      const c2 = await cases().report(lost.id, { kind: 'LOST', note: 'No scan for 8 days.' }, operator, null);
      h.clock.advance(MINUTE);
      const lostDecidedAt = h.clock.now();
      await cases().decide(c2.id, { decision: 'RESHIP' }, admin, { admin: true });
      expect(await row(lost.id)).toMatchObject({ status: 'PAID', reservation: 'STOCK', queue_first: true });
      const listed = (await h.ctx.services.logistics.parcels(scope())).toShip;
      expect(listed.find((p) => p.id === back.id)).toMatchObject({ readySince: decidedAt, late: false });
      expect(listed.find((p) => p.id === lost.id)).toMatchObject({ readySince: lostDecidedAt, late: false });
      // The order page reads the same: not late, ready from the decision.
      expect((await h.ctx.services.fulfilment.detail(lost.id)).timing).toMatchObject({ rule: 'READY', late: false });
      // Five days after the decisions, LATE.
      h.clock.advance(5 * DAY + MINUTE);
      const later = (await h.ctx.services.logistics.parcels(scope())).toShip;
      expect([back.id, lost.id].map((id) => later.find((p) => p.id === id)?.late)).toEqual([true, true]);
      for (const id of [back.id, lost.id]) await orders().transition(id, { to: 'CANCELLED', note: 'Test over.' }, operator);
    });

    it('refund: the order cancelled with a credit note, its piece serving the next order, a new claim code waiting on its piece replaced', async () => {
      const label = freshSize();
      const { id, piece } = await shippedOrder(label);
      // Its buyer's new claim code (§3.4), waiting on the order.
      await h.ctx.services.claimRenewals.renew(piece.productId, { reason: 'Card lost in the post.', expect: 'SOLD', after: null }, operator);
      const renewal = await db().selectFrom('claim_code_renewals').select(['id', 'status']).where('product_id', '=', piece.uuid).executeTakeFirstOrThrow();
      expect(renewal.status).toBe('WAITING');
      const before = (await product(piece.uuid)).claim_secret_hash;
      const next = await salonOrder(label, { paid: true });
      expect((await row(next)).reservation).toBe('AWAITING');
      const back = await cases().report(id, { kind: 'BACK_TO_SENDER', note: 'Refused by the collector.' }, agent, scope());
      await cases().receive(back.id, { pieceState: 'OK' }, agent, scope());
      await cases().decide(back.id, { decision: 'REFUND', note: 'Refunded at the client\'s request.' }, operator, { admin: false });
      expect(await row(id)).toMatchObject({ status: 'CANCELLED', reservation: null });
      expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', id).orderBy('issued_at').orderBy('kind', 'desc').execute()).map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
      expect((await row(next)).reservation).toBe('STOCK');
      expect((await product(piece.uuid)).status).toBe('RESOLD');
      expect((await db().selectFrom('claim_code_renewals').select('status').where('id', '=', renewal.id).executeTakeFirstOrThrow()).status).toBe('WITHDRAWN');
      expect((await product(piece.uuid)).claim_secret_hash).not.toBe(before);
      await orders().transition(next, { to: 'CANCELLED', note: 'Test over.' }, operator);
    });

    it('a parcel reported lost whose piece its buyer registers meanwhile: its case cancelled, the piece never revoked', async () => {
      const { id, piece } = await shippedOrder();
      const lost = await cases().report(id, { kind: 'LOST', note: 'No news.' }, agent, scope());
      const account = (await row(id)).account_id;
      const scan = await h.ctx.services.verification.verify({ code: piece.data }, {});
      h.clock.advance(MINUTE);
      await h.ctx.services.ownership.registerFirst(account, { registrationToken: scan.registration!.token, claimCode: piece.claimCode! }, { type: 'account', id: account });
      expect((await row(id)).status).toBe('DELIVERED');
      expect(await cases().get(lost.id)).toMatchObject({ status: 'CANCELLED', cancelled: { note: REGISTERED_BY_BUYER } });
      expect((await product(piece.uuid)).status).not.toBe('REVOKED');
      expect((await db().selectFrom('shipments').select('status').where('order_id', '=', id).executeTakeFirstOrThrow()).status).toBe('DELIVERED');
    });
  });

  describe('returns and exchanges opened by Client Services', () => {
    it('opens a return on a shipped or delivered order only, one at a time, after the 14 days too; decided back to stock with a new claim code, the archive an ADMIN\'s', async () => {
      const unshipped = await salonOrder(freshSize(), { paid: true });
      expect(await refusal(cases().open(unshipped, { kind: 'RETURN', reason: 'SIZE', note: 'Too small.' }, operator))).toMatchObject({ code: 'ORDER_TRANSITION_NOT_ALLOWED', status: 409 });
      const { id, piece } = await shippedOrder();
      await h.ctx.services.logistics.markDelivered(id, agent, scope());
      // Delivered 30 days ago: Client Services may still open it (question 20 as built).
      h.clock.advance(30 * DAY);
      const opened = await cases().open(id, { kind: 'RETURN', reason: 'NOT_AS_EXPECTED', note: 'The client wrote in MESSAGES.' }, operator);
      expect(opened).toMatchObject({ kind: 'RETURN', status: 'OPEN', reason: 'NOT_AS_EXPECTED', openedBy: 'CLIENT_SERVICES', exchange: null, shipment: null });
      expect(await refusal(cases().open(id, { kind: 'RETURN', reason: 'SIZE', note: 'Again.' }, operator))).toEqual({ code: 'ORDER_CASE_OPEN', status: 409, message: 'A request is already open for this order.' });
      expect(await refusal(cases().decide(opened.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, operator, { admin: false }))).toMatchObject({ code: 'ORDER_CASE_NOT_RECEIVED' });
      await cases().receive(opened.id, { pieceState: 'OK' }, agent, scope());
      expect(await refusal(cases().decide(opened.id, { decision: 'REFUND', pieceTo: 'ARCHIVED', note: 'Archived.' }, operator, { admin: false }))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await refusal(cases().decide(opened.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'x' }, operator, { admin: false }))).toMatchObject({ code: 'VALIDATION_FAILED' });
      const decided = await cases().decide(opened.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, operator, { admin: false });
      expect(decided.claimCode).toMatch(/^[A-Z0-9-]+$/);
      expect(decided.productId).toBe(piece.productId);
      expect(await row(id)).toMatchObject({ status: 'RETURNED' });
      expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', id).orderBy('issued_at').orderBy('kind', 'desc').execute()).map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
      expect((await product(piece.uuid)).status).toBe('RESOLD');
      expect(decided.case.decision).toMatchObject({ outcome: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' });
      // The decision's words stay on the case and the return, never on the order's event.
      const event = await db().selectFrom('order_events').select(['note', 'details']).where('order_id', '=', id).where('action', '=', 'order.return').executeTakeFirstOrThrow();
      expect(event.note).toBeNull();
      expect(event.details).toMatchObject({ caseId: opened.id, noted: true });
      expect((await db().selectFrom('returns').select('note').where('order_id', '=', id).executeTakeFirstOrThrow()).note).toBe('Refunded.');
    });

    it('opens a size exchange for a size in stock only; decided: an EXCHANGE order PAID with its invoice naming SIZE EXCHANGE, the original credited', async () => {
      const { id } = await shippedOrder();
      const other = freshSize();
      const otherSku = await skuOf(other);
      expect(await refusal(cases().open(id, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: otherSku, note: 'One size up.' }, operator))).toEqual({
        code: 'EXCHANGE_SIZE_NOT_IN_STOCK',
        status: 409,
        message: 'This size is no longer in stock. Choose another.',
      });
      await stock(otherSku, 1);
      const opened = await cases().open(id, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: otherSku, note: 'One size up.' }, operator);
      expect(opened.exchange).toEqual({ skuId: otherSku, sizeLabel: other, available: 1 });
      await cases().receive(opened.id, { pieceState: 'OK' }, agent, scope());
      const decided = await cases().decide(opened.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged.' }, operator, { admin: false });
      const exchange = decided.case.decision!.exchangeOrder!;
      const x = await row(exchange.id);
      // The original's delivery address (plan NEXT LOT §3.6.B, step 6.7: where the first piece went, entered by Client
      // Services at its creation; the fixture's, entered before it shipped).
      expect(x).toMatchObject({ channel: 'EXCHANGE', exchange_of_order_id: id, status: 'PAID', sku_id: otherSku, size_label: other, price_minor: 420_000, currency: 'EUR', reservation: 'STOCK' });
      expect(x).toMatchObject({ buyer_name: 'Test buyer', buyer_address: '1 rue de Test\n75001 Paris', buyer_country: 'FR', buyer_phone: null, address_by: 'STAFF', address_at: x.reserved_at, address_changed_at: null });
      const invoice = await db().selectFrom('invoices').select(['kind', 'lines']).where('order_id', '=', exchange.id).executeTakeFirstOrThrow();
      expect(linesOf(invoice.lines as unknown[])[0]).toMatchObject({ kind: 'PIECE', label: `MONOLITHE · SIZE ${other}`, detail: 'SIZE EXCHANGE' });
      expect((await db().selectFrom('invoices').select('kind').where('order_id', '=', id).orderBy('issued_at').orderBy('kind', 'desc').execute()).map((i) => i.kind)).toEqual(['INVOICE', 'CREDIT_NOTE']);
      const audited = await db().selectFrom('audit_logs').select('details').where('action', '=', 'order.exchange').where('target_id', '=', id).executeTakeFirstOrThrow();
      expect(audited.details).toMatchObject({ exchangeOrderId: exchange.id, skuId: otherSku });
    });

    it('an exchange of an order paid partly with credit: the credit carried onto the EXCHANGE order, the balance unchanged, its invoice the original\'s total', async () => {
      // An account of 5 pieces (PLATINE), its grants made; 3 000 of its credit taken off the order before it is paid.
      const a = await createAccount(db());
      await holdPieces(db(), a.id, 5, catalog.modelId, { year: 2024 });
      await h.ctx.services.tierGrants.ensure(a.id);
      const balance = async () => (await creditBalances(db(), a.id)).reduce((n, c) => n + c.balanceMinor, 0);
      const start = await balance();
      const { id } = await shippedOrder(freshSize(), { accountId: a.id, creditMinor: 3_000 });
      expect(await balance()).toBe(start - 3_000);
      await h.ctx.services.logistics.markDelivered(id, agent, scope());
      const other = freshSize();
      const otherSku = await skuOf(other);
      await stock(otherSku, 1);
      const opened = await cases().open(id, { kind: 'EXCHANGE', reason: 'SIZE', exchangeSkuId: otherSku, note: 'One size up.' }, operator);
      await cases().receive(opened.id, { pieceState: 'OK' }, agent, scope());
      const decided = await cases().decide(opened.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged.' }, operator, { admin: false });
      const exchange = decided.case.decision!.exchangeOrder!.id;
      // The balance does not grow: what the return gave back, the exchange took again.
      expect(await balance()).toBe(start - 3_000);
      const usesOf = (orderId: string) => db().selectFrom('credit_uses').select(['grant_id', 'amount_minor', 'released_reason']).where('order_id', '=', orderId).orderBy('applied_at').execute();
      const original = await usesOf(id);
      expect(original.map((u) => [u.amount_minor, u.released_reason])).toEqual([[3_000, 'RETURNED']]);
      expect((await usesOf(exchange)).map((u) => [u.grant_id, u.amount_minor, u.released_reason])).toEqual([[original[0]!.grant_id, 3_000, null]]);
      // Its invoice carries the same CREDIT line and the original's total; the original's credit note mirrors its invoice.
      const invoiceOf = (orderId: string, kind: 'INVOICE' | 'CREDIT_NOTE') => db().selectFrom('invoices').select(['lines', 'total_minor']).where('order_id', '=', orderId).where('kind', '=', kind).executeTakeFirstOrThrow();
      const paid = await invoiceOf(id, 'INVOICE');
      const exchanged = await invoiceOf(exchange, 'INVOICE');
      expect(paid.total_minor).toBe(420_000 - 3_000);
      expect(exchanged.total_minor).toBe(paid.total_minor);
      expect(linesOf(exchanged.lines as unknown[]).filter((l) => l.kind === 'CREDIT')).toEqual(linesOf(paid.lines as unknown[]).filter((l) => l.kind === 'CREDIT'));
      expect((await invoiceOf(id, 'CREDIT_NOTE')).total_minor).toBe(paid.total_minor);
      const applied = await db().selectFrom('audit_logs').select('details').where('action', '=', 'order.credit.apply').where('target_id', '=', exchange).executeTakeFirstOrThrow();
      expect(applied.details).toMatchObject({ amountMinor: 3_000, currency: 'EUR', exchangeOfOrderId: id });
    });

    it('a return opened on a parcel shipped and never marked delivered: once decided, the parcel DELIVERED, off On its way, its photo erased 14 days later', async () => {
      const { id } = await shippedOrder();
      const shippedAt = (await row(id)).shipped_at!;
      const onItsWay = async () => (await h.ctx.services.logistics.parcels(scope())).onItsWay.map((p) => p.id);
      expect(await onItsWay()).toContain(id);
      h.clock.advance(3 * DAY);
      const opened = await cases().open(id, { kind: 'RETURN', reason: 'SIZE', note: 'Too small, sent back.' }, operator);
      await cases().receive(opened.id, { pieceState: 'OK' }, agent, scope());
      await cases().decide(opened.id, { decision: 'REFUND', pieceTo: 'RESTOCKED', note: 'Refunded.' }, operator, { admin: false });
      const decidedAt = h.clock.now();
      expect((await row(id)).status).toBe('RETURNED');
      const shipment = await db().selectFrom('shipments').select(['id', 'status', 'delivered_at', 'photo_sha256']).where('order_id', '=', id).executeTakeFirstOrThrow();
      expect(shipment.status).toBe('DELIVERED');
      expect(shipment.photo_sha256).not.toBeNull();
      expect(new Date(shipment.delivered_at!).getTime()).toBe(decidedAt.getTime());
      expect(new Date(shipment.delivered_at!).getTime()).toBeGreaterThanOrEqual(new Date(shippedAt).getTime());
      expect(await onItsWay()).not.toContain(id);
      // Mark delivered no longer applies to it.
      expect(await refusal(h.ctx.services.logistics.markDelivered(id, agent, scope()))).toMatchObject({ status: 409 });
      // The photo follows the delivered parcel's keeping: 14 days after.
      const photo = () => db().selectFrom('shipments').select('photo_sha256').where('id', '=', shipment.id).executeTakeFirstOrThrow();
      h.clock.set(new Date(decidedAt.getTime() + 14 * DAY - MINUTE));
      await purgePackingPhotos(db(), h.clock.now());
      expect((await photo()).photo_sha256).toBe(shipment.photo_sha256);
      h.clock.set(new Date(decidedAt.getTime() + 14 * DAY + MINUTE));
      await purgePackingPhotos(db(), h.clock.now());
      expect((await photo()).photo_sha256).toBeNull();
    });

    it('keeps the packing photo while a return opened in the 14 days is open, then erases it once decided; cancels an order case', async () => {
      const { id } = await shippedOrder();
      await h.ctx.services.logistics.markDelivered(id, agent, scope());
      const delivered = h.clock.now();
      h.clock.advance(2 * DAY);
      const opened = await cases().open(id, { kind: 'RETURN', reason: 'DAMAGED', note: 'A scratch.' }, operator);
      h.clock.set(new Date(delivered.getTime() + 20 * DAY));
      const shipment = await db().selectFrom('shipments').select(['id', 'photo_sha256']).where('order_id', '=', id).executeTakeFirstOrThrow();
      await purgePackingPhotos(db(), h.clock.now());
      expect((await db().selectFrom('shipments').select('photo_sha256').where('id', '=', shipment.id).executeTakeFirstOrThrow()).photo_sha256).toBe(shipment.photo_sha256);
      const cancelled = await cases().cancel(opened.id, { note: 'The client kept the piece.' }, operator);
      expect(cancelled.status).toBe('CANCELLED');
      await purgePackingPhotos(db(), h.clock.now());
      expect((await db().selectFrom('shipments').select('photo_sha256').where('id', '=', shipment.id).executeTakeFirstOrThrow()).photo_sha256).toBeNull();
      // A new request can open once the first is ended.
      expect((await cases().open(id, { kind: 'RETURN', reason: 'OTHER', note: 'Changed their mind.' }, operator)).status).toBe('OPEN');
    });
  });
});
