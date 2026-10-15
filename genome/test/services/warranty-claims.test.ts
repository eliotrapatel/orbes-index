/**
 * The warranty claims (plan ORBES CARE of 2026-10-15, §2(c) « Warranty claims », §2(f) « New tests », step 1.6;
 * services/warranty-claims.ts, migration 0048), on the services as createContext wires them, every step taken by an
 * OPERATOR (answer 11):
 *
 *  - the basis is read from the piece (a lifetime piece's claim is LIFETIME, a 2-year piece's TWO_YEARS), never from the
 *    request, and a model switched after opening leaves an open claim's basis as it was;
 *  - only the registered owner who wrote claims under the ORBES warranty (a conversation of another account is refused
 *    CLAIM_NOT_REGISTERED); the legal guarantee is the buyer's (the order's account, registered or not; a buyer
 *    without an account, the note required), within 2 years of delivery;
 *  - `open` refuses REVOKED, RETIRED, COUNTERFEIT_FLAGGED, SERVICED; a LOST piece only to be refused (`label` refuses
 *    it); one live claim per piece; none while PRIVATE CARE is under way, and PRIVATE CARE UNAVAILABLE while a claim is;
 *  - the lifetime warranty: the free replacement once per root (a replacement's claim gets only the part credit; a LEGAL
 *    replacement leaves it available), never REPAIR nor WARRANTY_ENDED; the replacement's checks (status, SKU and
 *    `otherSize`, model, ownership, order, warranty); the old piece REVOKED `REPLACED`; the new warranty started by
 *    `ship`, of its model's kind, no service record on it; VALUE_CREDIT and PART_CREDIT grants (amount, currency of the
 *    value, 12 months, usable at any tier); a staff-entered value in THE PROGRAM's currency when none is found;
 *  - the 2-year warranty: REPAIR, REPLACEMENT or REFUSED only, its five reasons, no counter, an EXPIRED warranty refused
 *    WARRANTY_ENDED; `moveToLegal` to a LEGAL claim with the same record;
 *  - the legal guarantee: PRICE_REDUCTION (at most the price paid) and REFUND (REVOKED `REFUNDED`), its three reasons,
 *    never a credit (the service and the CHECK);
 *  - the INSPECTION record left open while ORBES holds a piece that goes back (a transfer refused then), completed by
 *    `ship`; a transfer offer refused CLAIM_OPEN while OPEN or LABEL_SENT;
 *  - `forCollector` and the export never carry the note nor who handled the claim; the audit never holds the note; the
 *    label served to its own account only and erased 30 days after the claim ends; GROWTH counts no replacement as a sale.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packIdentity } from '../../src/core/identity.js';
import type { HouseCurrency, ProductStatus } from '../../src/server/db/schema.js';
import { DomainError } from '../../src/server/errors.js';
import { eraseCareLabels } from '../../src/server/services/care.js';
import { purchaseRows } from '../../src/server/services/growth.js';
import { creditBalances, usableAt } from '../../src/server/services/tier-grants.js';
import { decisionOutcomes, partCredit, WARRANTY_CREDIT_VALIDITY_MONTHS, type ClaimSheet, type DecideClaimInput } from '../../src/server/services/warranty-claims.js';
import { addMonthsClamped } from '../../src/server/services/warranty.js';
import { ensureSku } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';
import { createAccount, holdPieces } from '../support/live.js';

const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1'));
const NOTE = 'Staff note WQZ: the client called on Tuesday.';
const TODAY = '2026-10-15';

/** The error a call throws, as its code (and the message, for the words that matter). */
async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return { code: e.code, status: e.httpStatus, message: e.publicMessage };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('warranty claims (plan ORBES CARE, step 1.6)', () => {
  let h: Harness;
  let operator: Actor;
  let carrierId: string;
  let category: number;
  let location: string;
  let serial = 70_000;
  /** A lifetime model and a 2-year model, each with sizes 52 and 54; a model with no base price. */
  const models = { life: '', two: '', unpriced: '' };
  const skus: Record<string, { s52: string; s54: string }> = {};

  const svc = () => h.ctx.services.warrantyClaims;
  const db = () => h.t.db;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-15T09:00:00.000Z');
    const catalog = await seedCatalog(h.ctx);
    category = (await h.ctx.categories.getByCode('J'))!.index;
    operator = { type: 'admin', id: (await createAdmin(h.ctx, 'OPERATOR')).id };
    carrierId = (await db().selectFrom('carriers').select('id').where('active', '=', true).orderBy('name').executeTakeFirstOrThrow()).id;
    location = (await db().selectFrom('stock_locations').select('id').executeTakeFirstOrThrow()).id;
    const model = async (name: string, lifetime: boolean, price: number | null) => {
      const m = await db()
        .insertInto('models')
        .values({
          category_id: category,
          collection_id: null,
          name,
          type: 'RING',
          sku_prefix: `${name.slice(0, 3)}-${randomUUID().slice(0, 6).toUpperCase()}`,
          default_material: '925 STERLING SILVER',
          warranty_lifetime: lifetime,
          base_price_minor: price,
          base_currency: price === null ? null : 'EUR',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      skus[m.id] = { s52: await ensureSku(db(), m.id, '52'), s54: await ensureSku(db(), m.id, '54') };
      return m.id;
    };
    models.life = await model('ECLIPSE', true, 45_000);
    models.two = await model('SATCHEL', false, 30_000);
    models.unpriced = await model('HALO', true, null);
    void catalog;
  });
  afterAll(() => h?.close());

  /** A collector with a conversation of MESSAGES (the claim's place). */
  async function collector() {
    const a = await createAccount(db());
    const v = await db().insertInto('client_conversations').values({ account_id: a.id, status: 'ANSWERED', last_message_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow();
    return { id: a.id, conversationId: v.id, actor: a.actor };
  }

  /**
   * A piece of `model`: held by `owner` (an open ownership) or by nobody; its status; its warranty started on `start`
   * (2 years: its end date from the category's 24 months), or none; its size 52 by default.
   */
  async function piece(modelId: string, o: { owner?: string | null; status?: ProductStatus; start?: string | null; size?: 52 | 54 | null; voided?: boolean } = {}) {
    serial += 1;
    const lifetime = modelId !== models.two;
    const p = await db()
      .insertInto('products')
      .values({
        // Serials of 2025: those of 2026 are holdPieces' (test/support/live.ts, the next after the highest).
        product_id: `O25-J-${String(serial).padStart(5, '0')}`,
        packed_identity: packIdentity({ year: 2025, categoryIndex: category, serial }),
        year: 2025,
        category_id: category,
        serial,
        sku: `CLAIM-${serial}`,
        model_id: modelId,
        sku_id: o.size === null ? null : o.size === 54 ? skus[modelId]!.s54 : skus[modelId]!.s52,
        material: '925 STERLING SILVER',
        status: o.status ?? (o.owner ? 'OWNED' : 'ISSUED'),
        ownership_state: o.owner ? 'OWNED' : 'UNREGISTERED',
      })
      .returning(['id', 'product_id'])
      .executeTakeFirstOrThrow();
    if (o.owner) await db().insertInto('ownership').values({ product_id: p.id, account_id: o.owner, acquired_via: 'FIRST_REGISTRATION', started_at: new Date('2026-03-01T10:00:00Z') }).execute();
    const start = o.start === undefined ? (o.owner ? '2026-03-01' : null) : o.start;
    if (start !== null || o.voided) {
      await db()
        .insertInto('warranties')
        .values({
          product_id: p.id,
          purchase_date: start,
          start_date: start,
          duration_months: 24,
          end_date: start && !lifetime ? addMonthsClamped(start, 24) : null,
          lifetime,
          country: 'FR',
          voided_at: o.voided ? new Date('2026-04-01T10:00:00Z') : null,
          void_reason: o.voided ? 'Altered' : null,
        })
        .execute();
    }
    return { id: p.id, serial: p.product_id };
  }

  /** The piece sold to `accountId` through an ORBES order (SALON), DELIVERED on `delivered` at `price` in `currency`. */
  async function sell(accountId: string, productId: string, modelId: string, o: { price?: number; currency?: HouseCurrency; delivered?: string } = {}) {
    const delivered = new Date(`${o.delivered ?? '2026-03-01'}T12:00:00Z`);
    const request = await db().insertInto('shop_requests').values({ account_id: accountId, model_id: modelId, status: 'CLOSED', created_at: delivered, handled_at: delivered, outcome: 'ACCEPTED' }).returning('id').executeTakeFirstOrThrow();
    const at = (h: number) => new Date(delivered.getTime() - h * 3_600_000);
    await db()
      .insertInto('orders')
      .values({
        channel: 'SALON',
        account_id: accountId,
        model_id: modelId,
        shop_request_id: request.id,
        price_minor: o.price ?? 45_000,
        currency: o.currency ?? 'EUR',
        status: 'DELIVERED',
        reserved_at: at(72),
        paid_at: at(48),
        shipped_at: at(24),
        carrier_id: carrierId,
        tracking_number: 'SALE-123',
        delivered_at: delivered,
        location_id: location,
        product_id: productId,
      })
      .execute();
  }

  const open = (c: { conversationId: string | null }, p: { serial: string }, basis: 'WARRANTY' | 'LEGAL' = 'WARRANTY', note: string | null = NOTE) =>
    svc().open({ conversationId: c.conversationId, productId: p.serial, basis, note }, operator);
  const label = (id: string) => svc().label(id, { pdf: PDF, carrierId, tracking: '6A12345678901' }, operator);
  const receive = (id: string) => svc().receive(id, operator);
  const decide = (id: string, input: DecideClaimInput) => svc().decide(id, input, operator);
  const ship = (id: string) => svc().ship(id, { carrierId, tracking: '6A99999999999' }, operator);
  /** A claim opened, its label sent and the piece received. */
  async function received(c: { conversationId: string | null }, p: { serial: string }, basis: 'WARRANTY' | 'LEGAL' = 'WARRANTY'): Promise<ClaimSheet> {
    const s = await open(c, p, basis);
    await label(s.id);
    return receive(s.id);
  }
  const status = async (id: string) => (await db().selectFrom('products').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;
  const record = async (serviceId: string) => (await db().selectFrom('service_records').select(['status', 'type', 'location']).where('id', '=', serviceId).executeTakeFirstOrThrow());
  /** A replacement registered to its claimant (the card in the box), as the scan and claim code would. */
  async function register(productId: string, accountId: string) {
    await db().updateTable('products').set({ status: 'OWNED', ownership_state: 'OWNED' }).where('id', '=', productId).execute();
    await db().insertInto('ownership').values({ product_id: productId, account_id: accountId, acquired_via: 'FIRST_REGISTRATION', started_at: h.clock.now() }).execute();
  }

  it('reads the basis from the piece, never from the request; a model switched after opening leaves the claim’s basis as it was', async () => {
    const c = await collector();
    const life = await piece(models.life, { owner: c.id });
    const two = await piece(models.two, { owner: c.id });
    const a = await open(c, life);
    expect(a).toMatchObject({ basis: 'LIFETIME', status: 'OPEN', account: { id: c.id }, registeredOwner: { id: c.id }, conversation: { conversationId: c.conversationId }, freeReplacement: { available: true }, note: NOTE });
    expect(a.decision.outcomes).toEqual(['REPLACEMENT', 'VALUE_CREDIT', 'REFUSED']);
    const b = await open(c, two);
    expect(b).toMatchObject({ basis: 'TWO_YEARS', freeReplacement: null });
    expect(b.decision).toMatchObject({ outcomes: ['REPLACEMENT', 'REPAIR', 'REFUSED'], refusalReasons: ['LOST', 'THEFT_REPORTED', 'NO_FAULT_FOUND', 'WARRANTY_ENDED', 'WARRANTY_VOID'] });
    // The model switched to 2 years (its pieces' warranties rewritten): the open claim keeps LIFETIME.
    const admin = { type: 'admin' as const, id: (await createAdmin(h.ctx, 'ADMIN')).id };
    const m = await db().insertInto('models').values({ category_id: category, collection_id: null, name: 'ORBIT', type: 'RING', sku_prefix: `ORB-${randomUUID().slice(0, 6).toUpperCase()}`, default_material: '925 STERLING SILVER', warranty_lifetime: true }).returning('id').executeTakeFirstOrThrow();
    skus[m.id] = { s52: await ensureSku(db(), m.id, '52'), s54: await ensureSku(db(), m.id, '54') };
    const orbit = await piece(m.id, { owner: c.id });
    const opened = await open(c, orbit);
    expect(opened.basis).toBe('LIFETIME');
    await h.ctx.services.catalog.setWarranty(m.id, false, admin);
    const after = await svc().sheet(opened.id);
    expect(after.basis).toBe('LIFETIME');
    expect(after.warranty.lifetime).toBe(false);
    // A claim on a piece of the switched model opened now is TWO_YEARS.
    const later = await piece(m.id, { owner: c.id });
    await db().updateTable('warranties').set({ lifetime: false, end_date: '2028-03-01' }).where('product_id', '=', later.id).execute();
    expect((await open(c, later)).basis).toBe('TWO_YEARS');
  });

  it('only the registered owner who wrote claims under the ORBES warranty', async () => {
    const owner = await collector();
    const other = await collector();
    const p = await piece(models.life, { owner: owner.id });
    expect(await refusal(open(other, p))).toEqual({ code: 'CLAIM_NOT_REGISTERED', status: 409, message: 'Only the registered owner of a piece can claim under its warranty.' });
    expect((await refusal(open({ conversationId: null }, p))).code).toBe('CLAIM_NOT_REGISTERED');
    // A piece sold to a buyer who never registered it: the ORBES warranty needs registration.
    const unregistered = await piece(models.life, { start: '2026-09-01' });
    await sell(other.id, unregistered.id, models.life, { delivered: '2026-09-01' });
    expect((await refusal(open(other, unregistered))).code).toBe('CLAIM_NOT_REGISTERED');
    // ... the legal guarantee does not: the order's buyer claims it.
    expect(await open(other, unregistered, 'LEGAL')).toMatchObject({ basis: 'LEGAL', account: { id: other.id }, registeredOwner: null });
  });

  it('the legal guarantee: the order’s buyer, or a buyer without an account (the note required), within 2 years of delivery', async () => {
    const buyer = await collector();
    const stranger = await collector();
    const sold = await piece(models.life, { owner: buyer.id });
    await sell(buyer.id, sold.id, models.life, { delivered: '2025-11-02' });
    expect((await refusal(open(stranger, sold, 'LEGAL'))).code).toBe('CLAIM_NOT_LEGAL');
    // A piece sold through an order is claimed from its buyer's conversation, never without an account.
    expect((await refusal(open({ conversationId: null }, sold, 'LEGAL'))).code).toBe('CLAIM_NOT_LEGAL');
    expect((await open(buyer, sold, 'LEGAL')).legalUntil).toBe('2027-11-02');
    // More than 2 years after delivery.
    const old = await piece(models.two, { owner: buyer.id, start: '2024-01-10' });
    await sell(buyer.id, old.id, models.two, { delivered: '2024-01-10' });
    expect((await refusal(open(buyer, old, 'LEGAL'))).code).toBe('CLAIM_NOT_LEGAL');
    // A boutique sale (no order): a buyer without an account, the receipt in the note, required.
    const boutique = await piece(models.two, { start: '2026-06-01' });
    expect((await refusal(open({ conversationId: null }, boutique, 'LEGAL', null))).code).toBe('VALIDATION_FAILED');
    const s = await open({ conversationId: null }, boutique, 'LEGAL', 'Receipt 4471, boutique Paris, 1 June 2026, € 300.');
    expect(s).toMatchObject({ basis: 'LEGAL', account: null, conversation: null, note: 'Receipt 4471, boutique Paris, 1 June 2026, € 300.' });
  });

  it('open refuses a piece that cannot go IN SERVICE; a LOST piece is opened only to be refused; one live claim per piece', async () => {
    const c = await collector();
    for (const s of ['REVOKED', 'RETIRED', 'COUNTERFEIT_FLAGGED', 'SERVICED'] as const) {
      const p = await piece(models.life, { owner: c.id, status: s });
      expect(await refusal(open(c, p)), s).toMatchObject({ code: 'CLAIM_NOT_ALLOWED', status: 409 });
    }
    const lost = await piece(models.life, { owner: c.id, status: 'LOST' });
    const a = await open(c, lost);
    expect((await refusal(label(a.id))).code).toBe('CLAIM_NOT_ALLOWED');
    expect((await refusal(receive(a.id))).code).toBe('CLAIM_STEP');
    expect((await refusal(decide(a.id, { outcome: 'REPLACEMENT', replacementProductId: 'O26-J-00001' }))).code).toBe('CLAIM_STEP');
    const done = await decide(a.id, { outcome: 'REFUSED', refusalReason: 'LOST' });
    expect(done).toMatchObject({ status: 'DONE', outcome: 'REFUSED', refusalReason: 'LOST', receivedAt: null, label: null });
    // One live claim per piece.
    const p = await piece(models.life, { owner: c.id });
    await open(c, p);
    expect(await refusal(open(c, p))).toMatchObject({ code: 'CLAIM_OPEN', status: 409 });
  });

  it('PRIVATE CARE and a claim never run at once; a transfer is refused while the claim is OPEN or LABEL_SENT, then by the piece IN SERVICE', async () => {
    const c = await collector();
    await holdPieces(db(), c.id, 5, models.life);
    const p = await piece(models.life, { owner: c.id });
    const q = await piece(models.life, { owner: c.id });
    // PRIVATE CARE under way: no claim.
    await h.ctx.services.care.request(c.id, q.serial, { name: 'Camille Martin', address: '12 rue de la Paix\n75002 Paris' }, c.actor);
    expect(await refusal(open(c, q))).toMatchObject({ code: 'CARE_OPEN', status: 409 });
    // A claim under way: PRIVATE CARE UNAVAILABLE.
    expect((await h.ctx.services.care.status(c.id, p.serial)).reason).toBe('AVAILABLE');
    const s = await open(c, p);
    expect((await h.ctx.services.care.status(c.id, p.serial)).reason).toBe('UNAVAILABLE');
    expect((await refusal(h.ctx.services.care.request(c.id, p.serial, { name: 'Camille Martin', address: '12 rue de la Paix' }, c.actor))).code).toBe('CARE_UNAVAILABLE');
    expect(await refusal(h.ctx.services.ownership.initiateTransfer(c.id, p.serial, c.actor))).toEqual({
      code: 'CLAIM_OPEN',
      status: 409,
      message: "This piece's warranty claim is under way: it can be transferred once the claim ends.",
    });
    await label(s.id);
    expect((await refusal(h.ctx.services.ownership.initiateTransfer(c.id, p.serial, c.actor))).code).toBe('CLAIM_OPEN');
    await receive(s.id);
    expect((await refusal(h.ctx.services.ownership.initiateTransfer(c.id, p.serial, c.actor))).code).toBe('TRANSFER_NOT_ALLOWED');
    // Closed by Client Services (the collector withdrew): the transfer and PRIVATE CARE come back.
    const other = await piece(models.life, { owner: c.id });
    const t = await open(c, other);
    expect((await svc().cancel(t.id, { note: 'The client withdrew.' }, operator))).toMatchObject({ status: 'CANCELLED', note: `${NOTE}\n\nThe client withdrew.` });
    expect((await h.ctx.services.ownership.initiateTransfer(c.id, other.serial, c.actor)).transferCode).toBeTruthy();
  });

  it('the lifetime warranty: a replacement of the same SKU, checked; the old piece REVOKED REPLACED; the new warranty started by ship', async () => {
    const c = await collector();
    const p = await piece(models.life, { owner: c.id });
    await sell(c.id, p.id, models.life, { price: 52_000, currency: 'GBP' });
    const s = await received(c, p);
    expect(s).toMatchObject({ status: 'RECEIVED', label: { tracking: '6A12345678901', pdf: true } });
    expect(await status(p.id)).toBe('SERVICED');
    expect(await record(s.serviceRecordId!)).toEqual({ status: 'OPEN', type: 'INSPECTION', location: 'ORBES' });
    // The replacement's checks.
    const other54 = await piece(models.life, { size: 54 });
    const otherModel = await piece(models.two);
    const sold = await piece(models.life, { owner: (await collector()).id });
    const ordered = await piece(models.life);
    await sell((await collector()).id, ordered.id, models.life);
    await db().updateTable('products').set({ status: 'ISSUED' }).where('id', '=', ordered.id).execute();
    const started = await piece(models.life, { start: '2026-09-01' });
    const voided = await piece(models.life, { start: null, voided: true });
    const notIssued = await piece(models.life, { status: 'ACTIVATED' });
    expect((await refusal(decide(s.id, { outcome: 'REPLACEMENT', replacementProductId: p.serial }))).code).toBe('CLAIM_REPLACEMENT_NOT_ALLOWED');
    expect(await refusal(decide(s.id, { outcome: 'REPLACEMENT', replacementProductId: other54.serial }))).toMatchObject({ code: 'CLAIM_REPLACEMENT_NOT_ALLOWED', message: 'The replacement is another size: choose « Another size, as the client asked ».' });
    expect(await refusal(decide(s.id, { outcome: 'REPLACEMENT', replacementProductId: otherModel.serial, otherSize: true }))).toMatchObject({ code: 'CLAIM_REPLACEMENT_NOT_ALLOWED', message: 'The replacement is a piece of the same model.' });
    for (const x of [sold, ordered, started, voided, notIssued]) {
      expect((await refusal(decide(s.id, { outcome: 'REPLACEMENT', replacementProductId: x.serial }))).code, x.serial).toBe('CLAIM_REPLACEMENT_NOT_ALLOWED');
    }
    expect((await refusal(decide(s.id, { outcome: 'REPLACEMENT' }))).code).toBe('VALIDATION_FAILED');
    // Accepted with « Another size », audited.
    const d = await decide(s.id, { outcome: 'REPLACEMENT', replacementProductId: other54.serial, otherSize: true });
    expect(d).toMatchObject({ status: 'DECIDED', outcome: 'REPLACEMENT', replacement: { productId: other54.serial }, otherSize: true, decidedBy: { id: operator.id }, freeReplacement: { available: false, claimId: s.id } });
    expect(await status(p.id)).toBe('REVOKED');
    const revocation = await db().selectFrom('revocations').select(['reason_code', 'reason']).where('target_id', '=', p.serial).executeTakeFirstOrThrow();
    expect(revocation).toEqual({ reason_code: 'REPLACED', reason: `Replaced under warranty by ${other54.serial}` });
    expect((await record(s.serviceRecordId!)).status).toBe('COMPLETED');
    const audit = await db().selectFrom('audit_logs').select('details').where('action', '=', 'warranty.claim.decide').where('target_id', '=', s.id).executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ claimId: s.id, productId: p.serial, basis: 'LIFETIME', outcome: 'REPLACEMENT', replacement: other54.serial, otherSize: true });
    // Shipped: the new piece's warranty starts today, lifetime (its model's), no service record on it.
    const shipped = await ship(s.id);
    expect(shipped).toMatchObject({ status: 'DONE', return: { tracking: '6A99999999999' } });
    const w = await db().selectFrom('warranties').select(['start_date', 'end_date', 'lifetime', 'country']).where('product_id', '=', other54.id).executeTakeFirstOrThrow();
    expect(w).toEqual({ start_date: TODAY, end_date: null, lifetime: true, country: 'FR' });
    expect(await status(other54.id)).toBe('ACTIVATED');
    expect(await db().selectFrom('service_records').select('id').where('product_id', '=', other54.id).execute()).toEqual([]);
    const activation = await db().selectFrom('audit_logs').select('details').where('action', '=', 'warranty.activate').where('target_id', '=', other54.serial).executeTakeFirstOrThrow();
    expect(activation.details).toMatchObject({ via: 'warranty_claim', claimId: s.id, lifetime: true });

    // The replacement registered: its claims share the original's root, the free replacement is used: only the part credit.
    await register(other54.id, c.id);
    const again = await received(c, other54);
    expect(again).toMatchObject({ rootProductId: p.serial, freeReplacement: { available: false, claimId: s.id } });
    expect(again.decision.outcomes).toEqual(['PART_CREDIT', 'REFUSED']);
    const fresh = await piece(models.life, { size: 54 });
    expect(await refusal(decide(again.id, { outcome: 'REPLACEMENT', replacementProductId: fresh.serial, otherSize: true }))).toMatchObject({ code: 'CLAIM_FREE_USED', status: 409 });
    expect((await refusal(decide(again.id, { outcome: 'VALUE_CREDIT' }))).code).toBe('CLAIM_FREE_USED');
    // The part credit: 30 % of the price ORBES sold the original at, in its currency (GBP), valid 12 months.
    const part = await decide(again.id, { outcome: 'PART_CREDIT' });
    expect(part).toMatchObject({ status: 'DECIDED', value: { amountMinor: 52_000, currency: 'GBP' }, creditPercent: 30, grant: { amountMinor: partCredit(52_000, 30), currency: 'GBP' } });
    expect(part.grant!.amountMinor).toBe(15_600);
    const grant = await db().selectFrom('tier_grants').selectAll().where('id', '=', part.grant!.id).executeTakeFirstOrThrow();
    expect(grant).toMatchObject({ account_id: c.id, kind: 'WARRANTY', tier: null, amount_minor: 15_600, currency: 'GBP', birthday_on: null });
    expect(grant.expires_at?.toISOString()).toBe('2027-10-15T09:00:00.000Z');
    expect(WARRANTY_CREDIT_VALIDITY_MONTHS).toBe(12);
    const balances = await creditBalances(db(), c.id);
    const warrantyCredit = balances.find((b) => b.kind === 'WARRANTY')!;
    expect(warrantyCredit).toMatchObject({ tier: null, currency: 'GBP' });
    for (const tier of [0, 1, 2, 3]) expect(usableAt(warrantyCredit, tier)).toBe(true);
    // The piece goes back: its record stays open, the piece IN SERVICE, no transfer; shipped, it is back.
    expect((await record(again.serviceRecordId!)).status).toBe('OPEN');
    expect(await status(other54.id)).toBe('SERVICED');
    expect((await refusal(h.ctx.services.ownership.initiateTransfer(c.id, other54.serial, c.actor))).code).toBe('TRANSFER_NOT_ALLOWED');
    await ship(again.id);
    expect((await record(again.serviceRecordId!)).status).toBe('COMPLETED');
    expect(await status(other54.id)).toBe('OWNED');
    const clubGrant = await db().selectFrom('audit_logs').select(['actor_type', 'details']).where('action', '=', 'club.grant').where('target_id', '=', c.id).executeTakeFirstOrThrow();
    expect(clubGrant).toMatchObject({ actor_type: 'admin', details: { grantId: part.grant!.id, kind: 'WARRANTY', claimId: again.id, amountMinor: 15_600, currency: 'GBP' } });
    // GROWTH: the replacement's registration is no sale.
    const purchases = await sql<{ ref: string }>`SELECT ref::text FROM (${purchaseRows(c.id)}) x`.execute(db());
    const refs = purchases.rows.map((r) => r.ref);
    const ownershipOfReplacement = await db().selectFrom('ownership').select('id').where('product_id', '=', other54.id).executeTakeFirstOrThrow();
    expect(refs).not.toContain(ownershipOfReplacement.id);
  });

  it('the lifetime warranty: a credit of the piece’s value (DONE at once, the piece kept), never REPAIR nor WARRANTY_ENDED; a value entered only when none is found', async () => {
    const c = await collector();
    const p = await piece(models.life, { owner: c.id });
    const s = await received(c, p);
    expect((await refusal(decide(s.id, { outcome: 'PART_CREDIT' }))).code).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    for (const outcome of ['REPAIR', 'PRICE_REDUCTION', 'REFUND'] as const) {
      expect(await refusal(decide(s.id, { outcome, valueMinor: outcome === 'REPAIR' ? null : 100 })), outcome).toMatchObject({ code: 'CLAIM_OUTCOME_NOT_ALLOWED', status: 422 });
    }
    expect((await refusal(decide(s.id, { outcome: 'REFUSED', refusalReason: 'WARRANTY_ENDED' }))).code).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    // The model's base price (no order): known, so never entered.
    expect((await refusal(decide(s.id, { outcome: 'VALUE_CREDIT', valueMinor: 1_000 }))).code).toBe('VALIDATION_FAILED');
    const d = await decide(s.id, { outcome: 'VALUE_CREDIT' });
    expect(d).toMatchObject({ status: 'DONE', value: { amountMinor: 45_000, currency: 'EUR' }, grant: { amountMinor: 45_000, currency: 'EUR' }, doneAt: d.decidedAt, return: null });
    expect(await status(p.id)).toBe('REVOKED');
    expect((await db().selectFrom('revocations').select('reason_code').where('target_id', '=', p.serial).executeTakeFirstOrThrow()).reason_code).toBe('REPLACED');
    expect((await record(s.serviceRecordId!)).status).toBe('COMPLETED');
    // No value found (no order, no base price): entered, in THE PROGRAM's credit currency.
    const q = await piece(models.unpriced, { owner: c.id });
    const t = await received(c, q);
    expect(await refusal(decide(t.id, { outcome: 'VALUE_CREDIT' }))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Enter the value of this piece.' });
    expect(t.decision.value).toBeNull();
    expect(await decide(t.id, { outcome: 'VALUE_CREDIT', valueMinor: 38_000 })).toMatchObject({ value: { amountMinor: 38_000, currency: 'EUR' }, grant: { amountMinor: 38_000, currency: 'EUR' } });
  });

  it('the 2-year warranty: REPAIR, REPLACEMENT or REFUSED only, its five reasons, no free-replacement counter, an EXPIRED warranty refused WARRANTY_ENDED', async () => {
    const c = await collector();
    const p = await piece(models.two, { owner: c.id });
    const s = await received(c, p);
    for (const outcome of ['VALUE_CREDIT', 'PART_CREDIT', 'PRICE_REDUCTION', 'REFUND'] as const) {
      expect((await refusal(decide(s.id, { outcome, valueMinor: outcome === 'PRICE_REDUCTION' ? 100 : null }))).code, outcome).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    }
    for (const reason of ['SCRATCHED', 'DAMAGED_ON_PURPOSE', 'DAMAGED_BY_SOMEONE_ELSE', 'ALTERED_OUTSIDE_ORBES'] as const) {
      expect((await refusal(decide(s.id, { outcome: 'REFUSED', refusalReason: reason }))).code, reason).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    }
    // REPAIR: the record open until the piece is shipped back.
    expect(await decide(s.id, { outcome: 'REPAIR' })).toMatchObject({ status: 'DECIDED', outcome: 'REPAIR', grant: null, value: null });
    expect(await status(p.id)).toBe('SERVICED');
    expect((await record(s.serviceRecordId!)).status).toBe('OPEN');
    expect(await ship(s.id)).toMatchObject({ status: 'DONE' });
    expect(await status(p.id)).toBe('OWNED');
    // No counter: two replacements on one root.
    const r1 = await received(c, p);
    const n1 = await piece(models.two);
    await decide(r1.id, { outcome: 'REPLACEMENT', replacementProductId: n1.serial });
    await ship(r1.id);
    const w = await db().selectFrom('warranties').select(['start_date', 'end_date', 'lifetime']).where('product_id', '=', n1.id).executeTakeFirstOrThrow();
    expect(w).toEqual({ start_date: TODAY, end_date: '2028-10-15', lifetime: false });
    await register(n1.id, c.id);
    const r2 = await received(c, n1);
    expect(r2).toMatchObject({ basis: 'TWO_YEARS', rootProductId: p.serial, freeReplacement: null });
    const n2 = await piece(models.two);
    expect(await decide(r2.id, { outcome: 'REPLACEMENT', replacementProductId: n2.serial })).toMatchObject({ status: 'DECIDED', outcome: 'REPLACEMENT' });
    // An EXPIRED warranty (ended before the claim was opened): no remedy, refused WARRANTY_ENDED.
    const old = await piece(models.two, { owner: c.id, start: '2024-01-10' });
    const e = await received(c, old);
    expect(await refusal(decide(e.id, { outcome: 'REPAIR' }))).toMatchObject({ code: 'CLAIM_OUTCOME_NOT_ALLOWED', message: 'The warranty of this piece was not active when the claim was opened: only a refusal is possible.' });
    expect(await decide(e.id, { outcome: 'REFUSED', refusalReason: 'WARRANTY_ENDED' })).toMatchObject({ status: 'DECIDED', refusalReason: 'WARRANTY_ENDED' });
    expect(await ship(e.id)).toMatchObject({ status: 'DONE' });
  });

  it('the legal guarantee: a price reduction (at most the price paid) and a refund (REVOKED REFUNDED); three reasons; never a credit', async () => {
    const c = await collector();
    const p = await piece(models.two, { owner: c.id, start: '2026-05-01' });
    await sell(c.id, p.id, models.two, { price: 30_000, delivered: '2026-05-01' });
    const s = await received(c, p, 'LEGAL');
    expect(s.decision.outcomes).toEqual(['REPLACEMENT', 'REPAIR', 'PRICE_REDUCTION', 'REFUND', 'REFUSED']);
    for (const outcome of ['VALUE_CREDIT', 'PART_CREDIT'] as const) expect((await refusal(decide(s.id, { outcome }))).code).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    for (const reason of ['LOST', 'THEFT_REPORTED', 'SCRATCHED', 'ALTERED_OUTSIDE_ORBES', 'WARRANTY_ENDED', 'WARRANTY_VOID'] as const) {
      expect((await refusal(decide(s.id, { outcome: 'REFUSED', refusalReason: reason }))).code, reason).toBe('CLAIM_OUTCOME_NOT_ALLOWED');
    }
    expect(await refusal(decide(s.id, { outcome: 'PRICE_REDUCTION', valueMinor: 30_001 }))).toMatchObject({ code: 'VALIDATION_FAILED', message: 'A price reduction is at most the price paid.' });
    expect(await decide(s.id, { outcome: 'PRICE_REDUCTION', valueMinor: 9_000 })).toMatchObject({ status: 'DECIDED', value: { amountMinor: 9_000, currency: 'EUR' }, grant: null });
    expect((await record(s.serviceRecordId!)).status).toBe('OPEN');
    await ship(s.id);
    expect(await status(p.id)).toBe('OWNED');
    // The CHECK refuses a credit on a legal claim too.
    await expect(db().updateTable('warranty_claims').set({ outcome: 'PART_CREDIT' }).where('id', '=', s.id).execute()).rejects.toThrow();
    // A refund: the price paid, the piece kept and REVOKED REFUNDED, DONE at once.
    const t = await received(c, p, 'LEGAL');
    const r = await decide(t.id, { outcome: 'REFUND' });
    expect(r).toMatchObject({ status: 'DONE', outcome: 'REFUND', value: { amountMinor: 30_000, currency: 'EUR' }, grant: null });
    expect(await status(p.id)).toBe('REVOKED');
    expect((await db().selectFrom('revocations').select('reason_code').where('target_id', '=', p.serial).executeTakeFirstOrThrow()).reason_code).toBe('REFUNDED');
    // A legal replacement never uses the lifetime warranty's free replacement.
    const life = await piece(models.life, { owner: c.id, start: '2026-05-01' });
    await sell(c.id, life.id, models.life, { delivered: '2026-05-01' });
    const l = await received(c, life, 'LEGAL');
    const n = await piece(models.life);
    await decide(l.id, { outcome: 'REPLACEMENT', replacementProductId: n.serial });
    await ship(l.id);
    await register(n.id, c.id);
    const after = await received(c, n);
    expect(after).toMatchObject({ basis: 'LIFETIME', rootProductId: life.serial, freeReplacement: { available: true } });
    expect(after.decision.outcomes).toEqual(decisionOutcomes('LIFETIME', true));
    expect(await decide(after.id, { outcome: 'VALUE_CREDIT' })).toMatchObject({ status: 'DONE', outcome: 'VALUE_CREDIT' });
  });

  it('moveToLegal: a received 2-year claim continues as a LEGAL claim with the same record, then refunded; refused outside the legal guarantee', async () => {
    const buyer = await collector();
    const p = await piece(models.two, { owner: buyer.id, start: '2026-04-01' });
    await sell(buyer.id, p.id, models.two, { price: 30_000, delivered: '2026-04-01' });
    const s = await received(buyer, p);
    expect(s.basis).toBe('TWO_YEARS');
    const legal = await svc().moveToLegal(s.id, { note: 'No longer made: neither repaired nor replaced.' }, operator);
    expect(legal).toMatchObject({ basis: 'LEGAL', status: 'RECEIVED', continues: s.id, serviceRecordId: s.serviceRecordId, receivedAt: s.receivedAt, label: { tracking: '6A12345678901' } });
    const old = await svc().sheet(s.id);
    expect(old).toMatchObject({ status: 'CANCELLED', serviceRecordId: null, receivedAt: s.receivedAt, continuedBy: legal.id });
    expect(await status(p.id)).toBe('SERVICED');
    expect((await record(s.serviceRecordId!)).status).toBe('OPEN');
    // The collector reads the LEGAL one, still with ORBES.
    expect(await svc().forCollector(buyer.id, p.serial)).toMatchObject({ id: legal.id, basis: 'LEGAL', status: 'RECEIVED' });
    expect(await decide(legal.id, { outcome: 'REFUND' })).toMatchObject({ status: 'DONE', value: { amountMinor: 30_000, currency: 'EUR' } });
    expect((await record(s.serviceRecordId!)).status).toBe('COMPLETED');
    const audit = await db().selectFrom('audit_logs').select('details').where('action', '=', 'warranty.claim.legal').executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ claimId: legal.id, continues: s.id, productId: p.serial });

    // Refused: more than 2 years after delivery; a claimant who is not the buyer; a lifetime claim; before RECEIVED.
    const old2 = await piece(models.two, { owner: buyer.id, start: '2024-02-01' });
    await sell(buyer.id, old2.id, models.two, { delivered: '2024-02-01' });
    expect((await refusal(svc().moveToLegal((await received(buyer, old2)).id, {}, operator))).code).toBe('CLAIM_NOT_LEGAL');
    const holder = await collector();
    const resold = await piece(models.two, { owner: holder.id, start: '2026-04-01' });
    await sell(buyer.id, resold.id, models.two, { delivered: '2026-04-01' });
    expect((await refusal(svc().moveToLegal((await received(holder, resold)).id, {}, operator))).code).toBe('CLAIM_NOT_LEGAL');
    const life = await piece(models.life, { owner: buyer.id });
    expect((await refusal(svc().moveToLegal((await received(buyer, life)).id, {}, operator))).code).toBe('CLAIM_NOT_LEGAL');
    const early = await piece(models.two, { owner: buyer.id });
    expect((await refusal(svc().moveToLegal((await open(buyer, early)).id, {}, operator))).code).toBe('CLAIM_STEP');
  });

  it('forCollector and the export carry no note nor who handled the claim; the audit never holds the note; the label is the account’s own, erased 30 days after', async () => {
    const c = await collector();
    const other = await collector();
    const p = await piece(models.life, { owner: c.id });
    const s = await received(c, p);
    const view = await svc().forCollector(c.id, p.serial);
    expect(view).toMatchObject({ id: s.id, status: 'RECEIVED', basis: 'LIFETIME', label: { pdf: true }, outcome: null, credit: null, value: null });
    const text = JSON.stringify(view);
    for (const k of ['note', 'openedBy', 'decidedBy', 'opened_by', 'decided_by', NOTE, operator.id!]) expect(text).not.toContain(k);
    expect(await svc().forCollector(other.id, p.serial)).toBeNull();
    // The credit shows with its expiry.
    await decide(s.id, { outcome: 'VALUE_CREDIT' });
    expect((await svc().forCollector(c.id, p.serial))!.credit).toEqual({ amountMinor: 45_000, currency: 'EUR', expiresAt: new Date('2027-10-15T09:00:00.000Z') });
    const exported = await h.ctx.services.owners.exportData(c.id, operator);
    expect(exported.warrantyClaims).toEqual([expect.objectContaining({ id: s.id, productId: p.serial, basis: 'LIFETIME', status: 'DONE', outcome: 'VALUE_CREDIT', value: { amountMinor: 45_000, currency: 'EUR' } })]);
    const exportedText = JSON.stringify(exported.warrantyClaims);
    for (const k of ['note', 'openedBy', 'decidedBy', NOTE, operator.id!]) expect(exportedText).not.toContain(k);
    const audits = await db().selectFrom('audit_logs').select('details').where('action', 'like', 'warranty.claim.%').execute();
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) expect(JSON.stringify(a.details)).not.toContain('Staff note');
    // The label: its own account only; erased 30 days after the claim ended, and the claim no longer shown then.
    expect((await svc().labelPdf(c.id, s.id)).filename).toBe(`ORBES-WARRANTY-CLAIM-${p.serial}-LABEL.pdf`);
    expect((await refusal(svc().labelPdf(other.id, s.id))).code).toBe('WARRANTY_CLAIM_NOT_FOUND');
    const before = h.clock.now();
    try {
      h.clock.set(new Date(before.getTime() + 31 * 86_400_000).toISOString());
      expect(await eraseCareLabels(db(), h.clock.now())).toBeGreaterThanOrEqual(1);
      expect((await refusal(svc().labelPdf(c.id, s.id))).code).toBe('WARRANTY_CLAIM_NOT_FOUND');
      expect(await svc().forCollector(c.id, p.serial)).toBeNull();
    } finally {
      h.clock.set(before.toISOString());
    }
  });

  it('every step is Client Services’ (an OPERATOR is enough), and nobody else’s; the Claims tab lists the claims under way first', async () => {
    const c = await collector();
    const p = await piece(models.life, { owner: c.id });
    expect(await refusal(svc().open({ conversationId: c.conversationId, productId: p.serial, basis: 'WARRANTY' }, c.actor))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const s = await open(c, p);
    expect((await refusal(svc().decide(s.id, { outcome: 'REFUSED', refusalReason: 'LOST' }, c.actor))).code).toBe('FORBIDDEN');
    expect((await refusal(svc().sheet(randomUUID()))).code).toBe('WARRANTY_CLAIM_NOT_FOUND');
    const page = await svc().list({}, { page: 1, pageSize: 200 });
    const firstEnded = page.items.findIndex((r) => r.status === 'DONE' || r.status === 'CANCELLED');
    const lastLive = page.items.map((r) => ['OPEN', 'LABEL_SENT', 'RECEIVED', 'DECIDED'].includes(r.status)).lastIndexOf(true);
    expect(firstEnded === -1 || lastLive < firstEnded).toBe(true);
    expect((await svc().list({ status: 'OPEN' }, { page: 1, pageSize: 200 })).items.every((r) => r.status === 'OPEN')).toBe(true);
    // Two decisions at once on one claim: the second reads its step taken (see warranty-claims-concurrency.test.ts).
    const q = await piece(models.life, { owner: c.id });
    const r = await received(c, q);
    const [a, b] = await Promise.allSettled([decide(r.id, { outcome: 'VALUE_CREDIT' }), decide(r.id, { outcome: 'VALUE_CREDIT' })]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
  });
});
