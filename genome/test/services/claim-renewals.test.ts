/**
 * NEW CLAIM CODE (plan NEXT LOT of 2026-10-07, §3.4, step 4.2), on the services as createContext wires them:
 *
 *  - a piece with no buyer: its new claim code answered once to the staff member (a STAFF row), the old code no longer
 *    registering it, the new one does;
 *  - a sold piece (its open order): the code sealed for the buyer (a BUYER row, WAITING), never in the answer nor in clear
 *    in the database; read once by its buyer (READ), refused to anyone else; the buyer's card and REGISTER THIS PIECE;
 *  - every refusal (registered, no claim code, not printable, RESERVED, no ACTIVE code, a sale outside an order), and the
 *    situations (a sale mode or a warranty started by hand: SOLD_IN_STORE; back from a return or a cancelled order:
 *    IN_STOCK);
 *  - the reading's refusals row by row; `expect` and `after`; a code replaced twice; a cancellation (UNSHOWN, a code read
 *    stops working, `cardNeeded`); a return; a registration racing a renewal; a changed key; a LOCKED account; the attempt
 *    count restarting after a renewal; and no audit entry ever holding a code.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { openText } from '../../src/server/crypto/secretbox.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { claimRevealAad, ClaimRenewalService, deriveClaimRevealKey } from '../../src/server/services/claim-renewals.js';
import { verifyClaimCode } from '../../src/server/services/claim-codes.js';
import { reserveIdentity } from '../../src/server/services/issuance.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { createManualClock, type Actor, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createAccount, liveFixtureOn, type LiveFixture } from '../support/live.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

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

describe('NEW CLAIM CODE (plan NEXT LOT §3.4)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: LiveFixture;
  let admin: Actor;
  let france: string;
  let colissimo: string;
  let sizeSeq = 40;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock('2026-11-02T09:00:00.000Z');
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await liveFixtureOn(ctx, clock);
    admin = f.admin;
    france = (await t.db.selectFrom('stock_locations').select('id').where('name', '=', 'FRANCE WAREHOUSE').executeTakeFirstOrThrow()).id;
    colissimo = (await t.db.selectFrom('carriers').select('id').where('name', '=', 'Colissimo').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await ctx.close();
    await t.close();
  });

  const renewals = () => ctx.services.claimRenewals;
  const orders = () => ctx.services.orders;
  const productRow = (id: string) => t.db.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const rowsOf = (productUuid: string) => t.db.selectFrom('claim_code_renewals').selectAll().where('product_id', '=', productUuid).orderBy('created_at').orderBy('id').execute();
  const allAudit = async () => JSON.stringify(await t.db.selectFrom('audit_logs').selectAll().execute());
  const allRows = async () => JSON.stringify(await t.db.selectFrom('claim_code_renewals').selectAll().execute());
  const compact = (code: string) => code.replace(/-/g, '');
  /** Neither spelling of the code anywhere in `text`. */
  const holdsNot = (text: string, code: string) => {
    expect(text).not.toContain(code);
    expect(text).not.toContain(compact(code));
  };

  /** A piece of a fresh size issued with its claim code, counted in stock at FRANCE WAREHOUSE. */
  async function stockPiece(opts: { withClaimSecret?: boolean } = {}) {
    const size = String(sizeSeq++);
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, size));
    await ctx.services.stock.adjust({ skuId: sku, locationId: france, delta: 1, note: 'Counted in.' }, admin);
    const p = await ctx.services.issuance.issueProduct({ categoryCode: 'J', modelId: f.modelId, variant: size, material: '925 STERLING SILVER', withClaimSecret: opts.withClaimSecret ?? true }, admin);
    return { size, sku, ...p };
  }
  type Piece = Awaited<ReturnType<typeof stockPiece>>;

  /** A private salon's order of `buyer` for `piece`, priced and sized, the piece linked; PAID, then SHIPPED unless told. */
  async function soldOrder(buyer: string, piece: Piece, upTo: 'RESERVED' | 'PAID' | 'SHIPPED' = 'SHIPPED') {
    const request = await t.db.insertInto('shop_requests').values({ account_id: buyer, model_id: f.modelId, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    clock.advance(MINUTE);
    await ctx.services.salon.close(request.id, { note: 'The sale is concluded.', outcome: 'ACCEPTED' }, admin);
    const id = (await t.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await orders().setTerms(id, { sizeLabel: piece.size, priceMinor: 420_000, currency: 'EUR' }, admin);
    await ctx.services.atelier.linkFromStock(id, piece.product.productId, admin);
    if (upTo === 'RESERVED') return id;
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'PAID' }, admin);
    if (upTo === 'PAID') return id;
    clock.advance(MINUTE);
    await orders().transition(id, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678901' }, admin);
    return id;
  }

  /** The buyer's scan, then a registration with `claimCode` (the warranty started first unless told). */
  async function scanAndRegister(accountId: string, piece: Piece, claimCode: string, activate = false) {
    if (activate) await ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    const scan = await ctx.services.verification.verify({ code: piece.code.data }, {});
    clock.advance(MINUTE);
    return ctx.services.ownership.registerFirst(accountId, { registrationToken: scan.registration!.token, claimCode }, { type: 'account', id: accountId });
  }

  /** The waiting code opened with the server's key, as only the buyer's reading may (for the tests that need it unread). */
  async function sealedCodeOf(productUuid: string): Promise<string> {
    const row = await t.db.selectFrom('claim_code_renewals').selectAll().where('product_id', '=', productUuid).where('status', '=', 'WAITING').executeTakeFirstOrThrow();
    return openText(deriveClaimRevealKey(testConfig()), row.sealed_code!, claimRevealAad(row));
  }

  const situation = (piece: Piece) => renewals().situation(piece.product.productId);
  const renewFor = async (piece: Piece, expect: string, reason = 'Card lost at the warehouse.') =>
    renewals().renew(piece.product.productId, { reason, expect, after: (await situation(piece)).lastRenewalId }, admin);

  it('in stock: the code is answered once to staff, the hash changes, the old code no longer registers the piece, the new one does', async () => {
    const piece = await stockPiece();
    const before = await productRow(piece.product.id);
    const s = await situation(piece);
    expect(s).toEqual({ renewable: 'IN_STOCK', refusal: null, order: null, lastRenewalId: null, cardNeeded: false, renewals: [] });
    clock.advance(MINUTE);
    const r = await renewals().renew(piece.product.productId, { reason: '  Card damaged in its box.  ', expect: 'IN_STOCK', after: null }, admin);
    expect(r.claimCode).toMatch(CODE_RE);
    expect(r.renewal).toMatchObject({ kind: 'STAFF', status: 'SHOWN', order: null, reason: 'Card damaged in its box.', at: clock.now(), readAt: null, withdrawnAt: null, withdrawnReason: null });
    expect(r.renewal.by).toMatch(/@orbes\.test$/);
    const after = await productRow(piece.product.id);
    expect(after.claim_secret_hash).not.toBe(before.claim_secret_hash);
    expect(await verifyClaimCode(r.claimCode!, after.claim_secret_hash!)).toBe(true);
    const [row] = await rowsOf(piece.product.id);
    expect(row).toMatchObject({ kind: 'STAFF', status: 'SHOWN', order_id: null, account_id: null, sealed_code: null, claim_hash: after.claim_secret_hash, created_by: admin.id });
    // Audited, never the code.
    const audit = await t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', piece.product.productId).where('action', 'like', 'claim_code.%').execute();
    expect(audit).toEqual([{ action: 'claim_code.renew', details: { renewalId: row!.id, for: 'STAFF', reason: 'Card damaged in its box.' } }]);
    holdsNot(await allAudit(), r.claimCode!);
    holdsNot(await allRows(), r.claimCode!);
    // The situation lists it; the next press must name it.
    expect((await situation(piece)).lastRenewalId).toBe(row!.id);
    // The old card no longer registers the piece; the new code does.
    const buyer = await createAccount(t.db);
    await rejects(scanAndRegister(buyer.id, piece, piece.claimCode!, true), 'CLAIM_CODE_INVALID', 403);
    const reg = await scanAndRegister(buyer.id, piece, r.claimCode!);
    expect(reg).toMatchObject({ productId: piece.product.productId, verified: true });
  });

  it('sold: the code waits sealed for the buyer, nowhere in clear; read once by its buyer only; then its card and REGISTER THIS PIECE', async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    const other = await createAccount(t.db);
    const orderId = await soldOrder(buyer.id, piece);
    const s = await situation(piece);
    expect(s).toMatchObject({ renewable: 'SOLD', refusal: null, order: { id: orderId, reference: expect.stringMatching(/^OR-[0-9A-F]{8}$/) } });
    clock.advance(MINUTE);
    const r = await renewFor(piece, 'SOLD');
    expect(r).not.toHaveProperty('claimCode');
    expect(r.renewal).toMatchObject({ kind: 'BUYER', status: 'WAITING', order: { id: orderId } });
    const [row] = await rowsOf(piece.product.id);
    expect(row).toMatchObject({ kind: 'BUYER', status: 'WAITING', order_id: orderId, account_id: buyer.id });
    expect(row!.sealed_code).toMatch(/^v1\./);
    expect((await productRow(piece.product.id)).claim_secret_hash).toBe(row!.claim_hash);
    const storedBefore = (await allRows()) + (await allAudit());
    // YOUR ORDERS: the order says a code waits, with its date; never the code.
    expect((await orders().forAccount(buyer.id)).find((o) => o.id === orderId)!.claimCode).toEqual({ status: 'WAITING', madeAt: clock.now() });
    expect((await renewals().forOrders(buyer.id)).get(orderId)).toEqual({ status: 'WAITING', madeAt: clock.now() });
    expect((await orders().forAccount(other.id)).length).toBe(0);
    // Another account's reading: 404, the code still waiting.
    await rejects(renewals().reveal(other.id, orderId, other.actor), 'ORDER_NOT_FOUND', 404);
    // The buyer reads it once.
    clock.advance(MINUTE);
    const read = await renewals().reveal(buyer.id, orderId, buyer.actor);
    expect(read).toEqual({ claimCode: expect.stringMatching(CODE_RE), productId: piece.product.productId });
    holdsNot(storedBefore, read.claimCode);
    expect((await rowsOf(piece.product.id))[0]).toMatchObject({ status: 'READ', read_at: clock.now(), sealed_code: null });
    const readAudit = await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'actor_id', 'details']).where('action', '=', 'claim_code.read').where('target_id', '=', piece.product.productId).execute();
    expect(readAudit).toEqual([{ action: 'claim_code.read', actor_type: 'account', actor_id: buyer.id, details: { renewalId: row!.id, orderId } }]);
    // Then never again.
    await rejects(renewals().reveal(buyer.id, orderId, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    expect((await orders().forAccount(buyer.id)).find((o) => o.id === orderId)!.claimCode).toBeNull();
    // Its new card, with the code read: the 79t card, audited as the buyer's.
    await rejects(renewals().newCard(other.id, orderId, read.claimCode, other.actor), 'ORDER_NOT_FOUND', 404);
    await rejects(renewals().newCard(buyer.id, orderId, piece.claimCode!, buyer.actor), 'CLAIM_CODE_MISMATCH', 422);
    const card = await renewals().newCard(buyer.id, orderId, read.claimCode, buyer.actor);
    expect(card.contentType).toBe('application/pdf');
    const renders = await t.db.selectFrom('audit_logs').select(['action', 'actor_type', 'details']).where('action', 'like', 'certificate.render%').where('actor_id', '=', buyer.id).orderBy('id').execute();
    expect(renders.map((a) => [a.action, a.actor_type])).toEqual([
      ['certificate.render_refused', 'account'],
      ['certificate.render', 'account'],
    ]);
    expect(renders[1]!.details).toMatchObject({ productIds: [piece.product.productId], orderId, by: 'buyer', format: 'pdf', layout: 'card' });
    // REGISTER THIS PIECE: the code, no scan; the order DELIVERED by itself; audited `via: 'order'`.
    await ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    await rejects(ctx.services.ownership.registerFromOrder(other.id, orderId, read.claimCode, other.actor), 'ORDER_NOT_FOUND', 404);
    clock.advance(MINUTE);
    const reg = await ctx.services.ownership.registerFromOrder(buyer.id, orderId, read.claimCode, buyer.actor);
    expect(reg).toMatchObject({ productId: piece.product.productId, accountId: buyer.id, verified: true, acquiredVia: 'FIRST_REGISTRATION' });
    expect((await t.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('DELIVERED');
    const registered = await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'ownership.register').where('target_id', '=', piece.product.productId).executeTakeFirstOrThrow();
    expect(registered.details).toEqual({ accountId: buyer.id, verified: true, acquiredVia: 'FIRST_REGISTRATION', via: 'order', orderId });
    // Registered: no card and no new code any more.
    await rejects(renewals().newCard(buyer.id, orderId, read.claimCode, buyer.actor), 'CLAIM_CARD_UNAVAILABLE', 409);
    expect(await situation(piece)).toMatchObject({ renewable: null, refusal: 'REGISTERED' });
    await rejects(renewFor(piece, 'SOLD'), 'ALREADY_REGISTERED', 409);
    holdsNot((await allAudit()) + (await allRows()), read.claimCode);
  });

  it("the buyer's card after the ORBES CODE is revoked: 409 CLAIM_CARD_UNAVAILABLE in the collector's words, never the console's; the renderer's staff refusals answered the same", async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    const orderId = await soldOrder(buyer.id, piece);
    await renewFor(piece, 'SOLD');
    const { claimCode } = await renewals().reveal(buyer.id, orderId, buyer.actor);
    await ctx.services.issuance.revokeCode(piece.code.id, 'Label damaged.', admin);
    const e = await rejects(renewals().newCard(buyer.id, orderId, claimCode, buyer.actor), 'CLAIM_CARD_UNAVAILABLE', 409);
    expect(e.publicMessage).toBe('Your new card can no longer be saved here. ORBES Client Services can assist you.');
    // Re-issued: the card is drawn again.
    await ctx.services.issuance.reissueCode(piece.product.productId, 'New label.', admin);
    expect((await renewals().newCard(buyer.id, orderId, claimCode, buyer.actor)).contentType).toBe('application/pdf');
    // A refusal the renderer finds itself (a code revoked meanwhile, an integrity check): the collector's sentence; a
    // code that does not match and a render already running pass unchanged.
    const throwing = (err: DomainError) =>
      new ClaimRenewalService({
        db: t.db,
        audit: ctx.audit,
        certificates: { render: () => Promise.reject(err) } as unknown as AppContext['services']['certificates'],
        revealKey: deriveClaimRevealKey(testConfig()),
        clock: clock.now,
      });
    for (const code of ['NO_ACTIVE_CODE', 'CODE_INTEGRITY', 'PRODUCT_NOT_PRINTABLE', 'ALREADY_REGISTERED', 'NO_CLAIM_SECRET']) {
      const staff = new DomainError(code, 409, `Staff words for ${code}.`);
      const mapped = await rejects(throwing(staff).newCard(buyer.id, orderId, claimCode, buyer.actor), 'CLAIM_CARD_UNAVAILABLE', 409);
      expect(mapped.publicMessage).not.toContain('Staff words');
    }
    await rejects(throwing(new DomainError('CLAIM_CODE_MISMATCH', 422, 'No match.')).newCard(buyer.id, orderId, claimCode, buyer.actor), 'CLAIM_CODE_MISMATCH', 422);
    await rejects(throwing(new DomainError('RATE_LIMITED', 429, 'Wait.')).newCard(buyer.id, orderId, claimCode, buyer.actor), 'RATE_LIMITED', 429);
    holdsNot(await allAudit(), claimCode);
  });

  it('REGISTER THIS PIECE: refused on an order not shipped; a wrong code counted under the attempt limit; the right one registers', async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    const orderId = await soldOrder(buyer.id, piece, 'PAID');
    await renewFor(piece, 'SOLD');
    const { claimCode } = await renewals().reveal(buyer.id, orderId, buyer.actor);
    await ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    // Not shipped: the piece has not arrived.
    const e = await rejects(ctx.services.ownership.registerFromOrder(buyer.id, orderId, claimCode, buyer.actor), 'REGISTRATION_NOT_ALLOWED', 409);
    expect(e.internal?.detail).toBe('order PAID');
    await rejects(ctx.services.ownership.registerFromOrder(buyer.id, orderId, '', buyer.actor), 'CLAIM_CODE_REQUIRED', 400);
    clock.advance(MINUTE);
    await orders().transition(orderId, { to: 'SHIPPED', carrierId: colissimo, trackingNumber: '6A12345678902' }, admin);
    // Five wrong codes, then the limit, as at a scan.
    for (let i = 0; i < 5; i++) await rejects(ctx.services.ownership.registerFromOrder(buyer.id, orderId, piece.claimCode!, buyer.actor), 'CLAIM_CODE_INVALID', 403);
    await rejects(ctx.services.ownership.registerFromOrder(buyer.id, orderId, claimCode, buyer.actor), 'RATE_LIMITED', 429);
    clock.advance(HOUR + MINUTE);
    await ctx.services.ownership.registerFromOrder(buyer.id, orderId, claimCode, buyer.actor);
    expect((await t.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('DELIVERED');
    holdsNot(await allAudit(), claimCode);
  });

  it('every refusal: registered, no claim code, not printable, RESERVED, no ACTIVE code (accepted again once re-issued), a sale outside an order', async () => {
    // Registered.
    const owned = await stockPiece();
    const owner = await createAccount(t.db);
    await scanAndRegister(owner.id, owned, owned.claimCode!, true);
    expect(await situation(owned)).toMatchObject({ renewable: null, refusal: 'REGISTERED' });
    await rejects(renewFor(owned, 'IN_STOCK'), 'ALREADY_REGISTERED', 409);
    // Issued without a claim code.
    const bare = await stockPiece({ withClaimSecret: false });
    expect(await situation(bare)).toMatchObject({ renewable: null, refusal: 'NO_CLAIM_CODE' });
    await rejects(renewFor(bare, 'IN_STOCK'), 'NO_CLAIM_SECRET', 422);
    // Not printable: LOST.
    const lost = await stockPiece();
    await ctx.services.lifecycle.transition(lost.product.id, 'LOST', { reason: 'Not found at the count.' }, admin);
    expect(await situation(lost)).toMatchObject({ renewable: null, refusal: 'NOT_PRINTABLE' });
    await rejects(renewFor(lost, 'IN_STOCK'), 'PRODUCT_NOT_PRINTABLE', 409);
    // RESERVED: an identity with no claim code yet.
    const sku = await inTransaction(t.db, (tx) => ensureSku(tx, f.modelId, '39'));
    const reserved = await inTransaction(t.db, (tx) => reserveIdentity(tx, { modelId: f.modelId, skuId: sku, sizeLabel: '39' }, clock.now()));
    expect(await renewals().situation(reserved.productId)).toMatchObject({ renewable: null, refusal: 'NO_CLAIM_CODE' });
    await rejects(renewals().renew(reserved.productId, { reason: 'x', expect: 'IN_STOCK', after: null }, admin), 'NO_CLAIM_SECRET', 422);
    // No ACTIVE code: revoked, then re-issued.
    const revoked = await stockPiece();
    await ctx.services.issuance.revokeCode(revoked.code.id, 'Label damaged.', admin);
    expect(await situation(revoked)).toMatchObject({ renewable: null, refusal: 'NO_ACTIVE_CODE' });
    const noActive = await rejects(renewFor(revoked, 'IN_STOCK'), 'NO_ACTIVE_CODE', 409);
    expect(noActive.publicMessage).toBe('This piece has no active code: re-issue its code first, then make a new claim code.');
    await ctx.services.issuance.reissueCode(revoked.product.productId, 'New label.', admin);
    expect(await situation(revoked)).toMatchObject({ renewable: 'IN_STOCK', refusal: null });
    expect((await renewFor(revoked, 'IN_STOCK')).claimCode).toMatch(CODE_RE);
    // A sale outside an order (question 8, answer (b) until the owner answers): refused; answer (a): shown to staff.
    const sold = await stockPiece();
    await ctx.services.warranty.activate(sold.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    expect(await situation(sold)).toMatchObject({ renewable: null, refusal: 'SOLD_IN_STORE', order: null });
    const inStore = await rejects(renewFor(sold, 'SOLD_IN_STORE'), 'CLAIM_CODE_SOLD_IN_STORE', 409);
    expect(inStore.publicMessage).toBe('This piece was sold at a point of sale: a new claim code is not made for it.');
    const answerA = new ClaimRenewalService({ db: t.db, audit: ctx.audit, certificates: ctx.services.certificates, revealKey: deriveClaimRevealKey(testConfig()), clock: clock.now, soldInStore: 'STAFF' });
    expect(await answerA.situation(sold.product.productId)).toMatchObject({ renewable: 'SOLD_IN_STORE', refusal: null });
    const a = await answerA.renew(sold.product.productId, { reason: 'Card lost by the buyer.', expect: 'SOLD_IN_STORE', after: null }, admin);
    expect(a.claimCode).toMatch(CODE_RE);
    expect(a.renewal).toMatchObject({ kind: 'STAFF', status: 'SHOWN' });
    // Nothing written by the refusals.
    for (const p of [owned, bare, lost]) expect(await rowsOf(p.product.id)).toEqual([]);
    // A bad request: no reason, an unknown situation.
    await rejects(renewals().renew(revoked.product.productId, { reason: ' ', expect: 'IN_STOCK', after: null }, admin), 'VALIDATION_FAILED', 400);
    await rejects(renewals().renew(revoked.product.productId, { reason: 'x'.repeat(501), expect: 'IN_STOCK', after: null }, admin), 'VALIDATION_FAILED', 400);
    await rejects(renewals().renew(revoked.product.productId, { reason: 'x', expect: 'LOST', after: null }, admin), 'VALIDATION_FAILED', 400);
    await rejects(renewals().renew(revoked.product.productId, { reason: 'x', expect: 'IN_STOCK', after: null }, owner.actor), 'FORBIDDEN', 403);
  });

  it('a sale in the sale mode is SOLD_IN_STORE; a piece back from a return or a cancelled order, its warranty still started, is IN_STOCK', async () => {
    // The sale mode: a staff scan, then the point of sale.
    const sold = await stockPiece();
    const shop = await ctx.services.retailers.create({ name: `ORBES SHOP ${sizeSeq}`, country: 'FR' }, admin);
    const scan = await ctx.services.sale.lookup({ code: sold.code.data }, admin);
    await ctx.services.sale.activate({ token: scan.sale!.token, retailerId: shop.id }, admin);
    expect(await situation(sold)).toMatchObject({ renewable: null, refusal: 'SOLD_IN_STORE' });
    // Back from a return: no buyer.
    const returned = await stockPiece();
    const buyer = await createAccount(t.db);
    const first = await soldOrder(buyer.id, returned);
    await ctx.services.warranty.activate(returned.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    expect(await situation(returned)).toMatchObject({ renewable: 'SOLD' });
    clock.advance(MINUTE);
    await orders().returnOrder(first, { outcome: 'RESTOCKED', locationId: france, note: 'Returned unworn.' }, admin);
    expect(await t.db.selectFrom('warranties').select('start_date').where('product_id', '=', returned.product.id).executeTakeFirstOrThrow()).toEqual({ start_date: '2026-11-02' });
    expect(await situation(returned)).toMatchObject({ renewable: 'IN_STOCK', refusal: null, order: null });
    // Back from a cancelled order it was bound to.
    const cancelled = await stockPiece();
    const second = await soldOrder(buyer.id, cancelled, 'PAID');
    await ctx.services.warranty.activate(cancelled.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    clock.advance(MINUTE);
    await orders().transition(second, { to: 'CANCELLED', note: 'The buyer changed their mind.' }, admin);
    expect(await situation(cancelled)).toMatchObject({ renewable: 'IN_STOCK', refusal: null });
  });

  it('expect and after: a piece sold, or given a new code, since the dialog answers 409 CLAIM_CODE_SITUATION_CHANGED', async () => {
    const piece = await stockPiece();
    const shown = await situation(piece);
    const buyer = await createAccount(t.db);
    await soldOrder(buyer.id, piece, 'RESERVED');
    // Sold between the dialog and the press: never shown to staff.
    const e = await rejects(renewals().renew(piece.product.productId, { reason: 'Card lost.', expect: shown.renewable, after: shown.lastRenewalId }, admin), 'CLAIM_CODE_SITUATION_CHANGED', 409);
    expect(e.publicMessage).toBe('This piece changed meanwhile (sold, registered or given a new claim code). Reload its page and try again.');
    const first = await renewals().renew(piece.product.productId, { reason: 'Card lost.', expect: 'SOLD', after: null }, admin);
    // A second press from the same dialog (after: null) is refused; one naming the first replaces it.
    await rejects(renewals().renew(piece.product.productId, { reason: 'Card lost.', expect: 'SOLD', after: null }, admin), 'CLAIM_CODE_SITUATION_CHANGED', 409);
    expect((await rowsOf(piece.product.id)).map((r) => r.status)).toEqual(['WAITING']);
    expect(first.renewal.status).toBe('WAITING');
  });

  it('replaced twice: each waiting code withdrawn RENEWED_AGAIN, only the latest waits and reads', async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    const orderId = await soldOrder(buyer.id, piece);
    const a = await renewFor(piece, 'SOLD');
    clock.advance(MINUTE);
    const b = await renewFor(piece, 'SOLD', 'The buyer did not receive it.');
    clock.advance(MINUTE);
    const c = await renewFor(piece, 'SOLD');
    const rows = await rowsOf(piece.product.id);
    expect(rows.map((r) => [r.id, r.status, r.withdrawn_reason, r.sealed_code === null])).toEqual([
      [a.renewal.id, 'WITHDRAWN', 'RENEWED_AGAIN', true],
      [b.renewal.id, 'WITHDRAWN', 'RENEWED_AGAIN', true],
      [c.renewal.id, 'WAITING', null, false],
    ]);
    const audits = await t.db.selectFrom('audit_logs').select(['action', 'details']).where('target_id', '=', piece.product.productId).where('action', 'like', 'claim_code.%').orderBy('id').execute();
    expect(audits.map((x) => x.action)).toEqual(['claim_code.renew', 'claim_code.renew', 'claim_code.withdraw', 'claim_code.renew', 'claim_code.withdraw']);
    expect(audits[1]!.details).toMatchObject({ renewalId: b.renewal.id, replacedRenewalId: a.renewal.id });
    expect(audits[2]!.details).toEqual({ renewalId: a.renewal.id, reason: 'renewed_again', orderId });
    const read = await renewals().reveal(buyer.id, orderId, buyer.actor);
    expect(await verifyClaimCode(read.claimCode, (await productRow(piece.product.id)).claim_secret_hash!)).toBe(true);
    expect((await situation(piece)).renewals.map((r) => r.status)).toEqual(['READ', 'WITHDRAWN', 'WITHDRAWN']);
  });

  it('the reading row by row: SUPERSEDED, REGISTERED, a LOST piece left waiting (read once it is back), UNREADABLE with a changed key, a LOCKED account', async () => {
    const buyer = await createAccount(t.db);
    // The piece's code changed by another path: withdrawn SUPERSEDED.
    const superseded = await stockPiece();
    const o1 = await soldOrder(buyer.id, superseded);
    await renewFor(superseded, 'SOLD');
    await t.db.updateTable('products').set({ claim_secret_hash: (await productRow(superseded.product.id)).claim_secret_hash + 'x' }).where('id', '=', superseded.product.id).execute();
    await rejects(renewals().reveal(buyer.id, o1, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    expect((await rowsOf(superseded.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'SUPERSEDED', sealed_code: null });
    // Registered meanwhile (a safety net: registered by hand here): withdrawn REGISTERED.
    const registered = await stockPiece();
    const o2 = await soldOrder(buyer.id, registered);
    await renewFor(registered, 'SOLD');
    await t.db.insertInto('ownership').values({ product_id: registered.product.id, account_id: buyer.id, acquired_via: 'FIRST_REGISTRATION', verified: false, started_at: clock.now() }).execute();
    await rejects(renewals().reveal(buyer.id, o2, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    expect((await rowsOf(registered.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'REGISTERED' });
    // LOST: refused, left waiting; once the piece is back, read once.
    const lost = await stockPiece();
    const o3 = await soldOrder(buyer.id, lost);
    await renewFor(lost, 'SOLD');
    await ctx.services.lifecycle.transition(lost.product.id, 'LOST', { reason: 'Parcel lost.' }, admin);
    expect((await orders().forAccount(buyer.id)).find((o) => o.id === o3)!.claimCode).toBeNull();
    await rejects(renewals().reveal(buyer.id, o3, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    expect((await rowsOf(lost.product.id))[0]).toMatchObject({ status: 'WAITING' });
    await ctx.services.lifecycle.transition(lost.product.id, 'ISSUED', { reason: 'Found.' }, admin);
    expect((await orders().forAccount(buyer.id)).find((o) => o.id === o3)!.claimCode).toMatchObject({ status: 'WAITING' });
    expect((await renewals().reveal(buyer.id, o3, buyer.actor)).claimCode).toMatch(CODE_RE);
    // A changed key: UNREADABLE.
    const rekeyed = await stockPiece();
    const o4 = await soldOrder(buyer.id, rekeyed);
    await renewFor(rekeyed, 'SOLD');
    const otherKey = new ClaimRenewalService({ db: t.db, audit: ctx.audit, certificates: ctx.services.certificates, revealKey: new Uint8Array(32).fill(7), clock: clock.now });
    await rejects(otherKey.reveal(buyer.id, o4, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    expect((await rowsOf(rekeyed.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'UNREADABLE', sealed_code: null });
    expect(
      (await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'claim_code.withdraw').where('target_id', '=', rekeyed.product.productId).executeTakeFirstOrThrow()).details,
    ).toMatchObject({ reason: 'unreadable', orderId: o4 });
    // A LOCKED account: 403, the code keeps waiting for an unlock.
    const locked = await createAccount(t.db);
    const piece = await stockPiece();
    const o5 = await soldOrder(locked.id, piece);
    await renewFor(piece, 'SOLD');
    await t.db.updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', locked.id).execute();
    await rejects(renewals().reveal(locked.id, o5, locked.actor), 'ACCOUNT_LOCKED', 403);
    expect((await rowsOf(piece.product.id))[0]).toMatchObject({ status: 'WAITING' });
    await t.db.updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', locked.id).execute();
    expect((await renewals().reveal(locked.id, o5, locked.actor)).claimCode).toMatch(CODE_RE);
  });

  it('a cancellation: a waiting code withdrawn ORDER_CANCELLED, a code read stops working, an UNSHOWN code nobody sees, and the piece needs a card', async () => {
    const buyer = await createAccount(t.db);
    // Read, then cancelled: the read code no longer matches.
    const piece = await stockPiece();
    const orderId = await soldOrder(buyer.id, piece, 'PAID');
    await renewFor(piece, 'SOLD');
    const { claimCode } = await renewals().reveal(buyer.id, orderId, buyer.actor);
    clock.advance(MINUTE);
    await orders().transition(orderId, { to: 'CANCELLED', note: 'The card was lost before packing.' }, admin);
    const after = await productRow(piece.product.id);
    expect(await verifyClaimCode(claimCode, after.claim_secret_hash!)).toBe(false);
    const rows = await rowsOf(piece.product.id);
    expect(rows.map((r) => [r.kind, r.status, r.order_id, r.account_id])).toEqual([
      ['BUYER', 'READ', orderId, buyer.id],
      ['UNSHOWN', 'UNSHOWN', orderId, null],
    ]);
    expect(rows[1]).toMatchObject({ claim_hash: after.claim_secret_hash, created_by: admin.id, reason: null, sealed_code: null });
    const s = await situation(piece);
    expect(s).toMatchObject({ renewable: 'IN_STOCK', cardNeeded: true });
    expect(s.renewals[0]).toMatchObject({ kind: 'UNSHOWN', status: 'UNSHOWN', order: { id: orderId } });
    expect((await t.db.selectFrom('audit_logs').select('details').where('action', '=', 'claim_code.withdraw').where('target_id', '=', piece.product.productId).executeTakeFirstOrThrow()).details).toEqual({
      renewalId: rows[0]!.id,
      reason: 'order_cancelled',
      orderId,
      unshownRenewalId: rows[1]!.id,
    });
    // A new code for the piece's box: the card is needed no more.
    await renewFor(piece, 'IN_STOCK');
    expect((await situation(piece)).cardNeeded).toBe(false);
    // Waiting, then cancelled: withdrawn ORDER_CANCELLED, its sealed copy wiped.
    const waiting = await stockPiece();
    const o2 = await soldOrder(buyer.id, waiting, 'RESERVED');
    await renewFor(waiting, 'SOLD');
    clock.advance(MINUTE);
    await orders().transition(o2, { to: 'CANCELLED', note: 'Cancelled at the buyer’s request.' }, admin);
    expect((await rowsOf(waiting.product.id)).map((r) => [r.kind, r.status, r.withdrawn_reason, r.sealed_code])).toEqual([
      ['BUYER', 'WITHDRAWN', 'ORDER_CANCELLED', null],
      ['UNSHOWN', 'UNSHOWN', null, null],
    ]);
    await rejects(renewals().reveal(buyer.id, o2, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    holdsNot(await allAudit(), claimCode);
  });

  it('a return: a waiting code withdrawn ORDER_RETURNED; RESTOCKED, the staff\'s new code works; ARCHIVED, the piece retired', async () => {
    const buyer = await createAccount(t.db);
    const restocked = await stockPiece();
    const o1 = await soldOrder(buyer.id, restocked);
    await renewFor(restocked, 'SOLD');
    clock.advance(MINUTE);
    const r = await orders().returnOrder(o1, { outcome: 'RESTOCKED', locationId: france, note: 'Returned unworn.' }, admin);
    expect((await rowsOf(restocked.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'ORDER_RETURNED', sealed_code: null });
    expect(await verifyClaimCode(r.claimCode!, (await productRow(restocked.product.id)).claim_secret_hash!)).toBe(true);
    expect(await situation(restocked)).toMatchObject({ renewable: 'IN_STOCK', cardNeeded: false });
    await rejects(renewals().reveal(buyer.id, o1, buyer.actor), 'CLAIM_CODE_UNAVAILABLE', 409);
    const archived = await stockPiece();
    const o2 = await soldOrder(buyer.id, archived);
    await renewFor(archived, 'SOLD');
    clock.advance(MINUTE);
    await orders().returnOrder(o2, { outcome: 'ARCHIVED', note: 'Damaged beyond repair.' }, admin);
    expect((await rowsOf(archived.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'ORDER_RETURNED' });
    expect(await situation(archived)).toMatchObject({ refusal: 'NOT_PRINTABLE' });
  });

  it('a registration racing a renewal gets REGISTRATION_CONFLICT; a registration withdraws a code still waiting (REGISTERED)', async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    const ownership = ctx.services.ownership as unknown as { checkClaimCode: (...a: unknown[]) => Promise<void> };
    const real = ownership.checkClaimCode.bind(ownership);
    const spy = vi.spyOn(ownership, 'checkClaimCode').mockImplementation(async (...args: unknown[]) => {
      await real(...args);
      // Staff press New claim code between the code's check and the registration's lock (its warranty started by hand
      // for the registration: a sale outside an order, shown to staff with question 8's answer (a)).
      const answerA = new ClaimRenewalService({ db: t.db, audit: ctx.audit, certificates: ctx.services.certificates, revealKey: deriveClaimRevealKey(testConfig()), clock: clock.now, soldInStore: 'STAFF' });
      await answerA.renew(piece.product.productId, { reason: 'Card lost.', expect: 'SOLD_IN_STORE', after: null }, admin);
    });
    try {
      await rejects(scanAndRegister(buyer.id, piece, piece.claimCode!, true), 'REGISTRATION_CONFLICT', 409);
    } finally {
      spy.mockRestore();
    }
    expect(await t.db.selectFrom('ownership').select('id').where('product_id', '=', piece.product.id).execute()).toEqual([]);
    // A sold piece registered with its waiting code (read from the sealed copy, as the buyer's reading would).
    const sold = await stockPiece();
    const orderId = await soldOrder(buyer.id, sold);
    await renewFor(sold, 'SOLD');
    const code = await sealedCodeOf(sold.product.id);
    await scanAndRegister(buyer.id, sold, code, true);
    expect((await rowsOf(sold.product.id))[0]).toMatchObject({ status: 'WITHDRAWN', withdrawn_reason: 'REGISTERED', sealed_code: null });
    expect((await t.db.selectFrom('orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('DELIVERED');
    holdsNot(await allAudit(), code);
  });

  it('the attempt count restarts after a renewal: the old code\'s failures no longer count against the new one', async () => {
    const piece = await stockPiece();
    const buyer = await createAccount(t.db);
    await ctx.services.warranty.activate(piece.product.id, { purchaseDate: '2026-11-02', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    for (let i = 0; i < 5; i++) await rejects(scanAndRegister(buyer.id, piece, 'AAAA-AAAA-AAAA'), 'CLAIM_CODE_INVALID', 403);
    await rejects(scanAndRegister(buyer.id, piece, piece.claimCode!), 'RATE_LIMITED', 429);
    // Within the same hour: a new code, five fresh attempts.
    const answerA = new ClaimRenewalService({ db: t.db, audit: ctx.audit, certificates: ctx.services.certificates, revealKey: deriveClaimRevealKey(testConfig()), clock: clock.now, soldInStore: 'STAFF' });
    clock.advance(MINUTE);
    const r = await answerA.renew(piece.product.productId, { reason: 'Card lost.', expect: 'SOLD_IN_STORE', after: null }, admin);
    clock.advance(MINUTE);
    await rejects(scanAndRegister(buyer.id, piece, 'AAAA-AAAA-AAAA'), 'CLAIM_CODE_INVALID', 403);
    expect(await scanAndRegister(buyer.id, piece, r.claimCode!)).toMatchObject({ verified: true });
  });
});
