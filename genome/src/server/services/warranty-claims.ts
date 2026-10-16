/**
 * The warranty claims (plan ORBES CARE of 2026-10-15, §2(c) « Warranty claims », step 1.6; migration 0048): a claim is
 * a normal message. The collector writes to ORBES Client Services; Client Services open the claim from that conversation
 * in the console, send a prepaid label, receive the piece, decide and ship. Nothing in the app starts or feeds a claim
 * (answer 3); the collector follows it in the piece's ORBES CARE tab (answer 9, `forCollector`). Every step and every
 * outcome is an OPERATOR's (answer 11): the rules guard the claim, not the role.
 *
 *   basis        WARRANTY at opening is stored as the piece's own warranty kind, read under the piece's lock (its
 *                warranty row's `lifetime`, else its model's choice): LIFETIME or TWO_YEARS, never chosen by staff and
 *                never changed afterwards, even when the model's choice changes (answers 10, 12). LEGAL is the legal
 *                guarantee of conformity (D1), within 2 years of delivery (the delivered order's date, else the
 *                warranty's start), claimed by the buyer (the account of the piece's order; for a boutique sale, the
 *                receipt's facts in the note; a buyer without an ORBES account has no conversation, the note required).
 *   open         from the conversation (its account is the claimant): for the ORBES warranty the piece's registered
 *                owner now (its open ownership), else 409 CLAIM_NOT_REGISTERED (answer 3: only the registered owner who
 *                wrote). The piece must be able to go IN SERVICE at receipt: REVOKED, RETIRED, COUNTERFEIT_FLAGGED,
 *                SERVICED (another service open) and RESERVED are refused (409 CLAIM_NOT_ALLOWED); a LOST or STOLEN
 *                piece only to be refused from OPEN (`label` refuses it). One live claim per piece (409 CLAIM_OPEN), none
 *                while its PRIVATE CARE is under way (409 CARE_OPEN) nor while a transfer offer of it is pending
 *                (409 CLAIM_NOT_ALLOWED, detail `transfer pending`, as PRIVATE CARE is UNAVAILABLE then) nor while an
 *                order of it has a return or an exchange not ended (409 CLAIM_NOT_ALLOWED, detail `return pending`: the
 *                return would take the piece from its claimant; services/orders.ts refuses a return while a claim is
 *                live, 409 CLAIM_OPEN). `root_product_id`: the original piece (the root of
 *                the claim whose replacement this piece is, else the piece). Audited `warranty.claim.open` (never the
 *                note, never an email).
 *   label        OPEN → LABEL_SENT: the prepaid label's PDF (2 MiB, as PRIVATE CARE's), its carrier and tracking; the
 *                piece checked again. Uploaded through PRIVATE CARE's label path (routes/admin/care.ts), the only one the
 *                edge lets carry a body over 64 KB.
 *   receive      LABEL_SENT → RECEIVED: an INSPECTION record opened at ORBES (WarrantyService.openService), the piece IN
 *                SERVICE, in the same transaction. Only the claim closes that record (`/api/admin/services/:id/complete`
 *                refuses it).
 *   moveToLegal  a received 2-year claim whose piece can be neither repaired nor replaced continues under the legal
 *                guarantee (409 CLAIM_NOT_LEGAL when it does not apply; a boutique sale's receipt written in the note
 *                given with this step, the claim's own note not counting): the claim CANCELLED (its label and receipt times
 *                kept, its record handed over) and a LEGAL claim RECEIVED continuing it, with the same INSPECTION record
 *                (nothing is sent again). Audited `warranty.claim.legal`.
 *   decide       RECEIVED (a refusal also from OPEN), the claim's row FOR UPDATE and its step checked under the lock (409
 *                CLAIM_STEP for the second of two decisions). The outcome and the reason must be the basis's
 *                (WARRANTY_CLAIM_OUTCOMES_BY_BASIS, WARRANTY_CLAIM_REFUSALS_BY_BASIS: 422 CLAIM_OUTCOME_NOT_ALLOWED);
 *                the ORBES warranty's remedies need a warranty ACTIVE at opening; under the lifetime warranty the free
 *                replacement (a replacement or a credit of value) is given once per original purchase (409
 *                CLAIM_FREE_USED, `warranty_claims_free_once` the last guard) and the part credit only after it.
 *                  REPLACEMENT     an ISSUED identity of the same SKU (no SKU on either: the same model and variant;
 *                                  another size of the same model with `otherSize`), never sold, registered, bound to
 *                                  an order nor with a warranty started or voided; the old piece REVOKED `REPLACED` and
 *                                  its record completed → DECIDED (the new piece ships).
 *                  VALUE_CREDIT    a WARRANTY grant of the piece's value, its model no longer made (answer 4: 422
 *                                  CLAIM_OUTCOME_NOT_ALLOWED while it is made); the old piece REVOKED `REPLACED` → DONE.
 *                  PART_CREDIT     a WARRANTY grant of THE PROGRAM's percent of the value → DECIDED (the piece goes back).
 *                  REPAIR          → DECIDED (the piece goes back repaired).
 *                  PRICE_REDUCTION the amount (at most the price paid) → DECIDED; paid back by the seller.
 *                  REFUND          the price paid; the old piece REVOKED `REFUNDED` → DONE; paid back by the seller (an
 *                                  ORBES order: its RETURN case, decided to the archive, draws the credit note).
 *                  REFUSED         a reason of the basis's list → DECIDED (the piece goes back), or DONE from OPEN.
 *                A piece REVOKED by its claim has its warranty voided in the same transaction (WarrantyService.void, the
 *                revocation's reason, audited `warranty.void`): its identity closed, MY PIECES no longer reads it covered.
 *                The piece's value (D11): the price ORBES sold it at (its order's, else its original's), else its
 *                model's base price, in that currency; entered by the staff member deciding only when none is found, in
 *                THE PROGRAM's credit currency. A credit is valid 12 months (WARRANTY_CREDIT_VALIDITY_MONTHS). Audited
 *                `warranty.claim.decide` and, for a grant, `club.grant`.
 *   ship         DECIDED → DONE: the new piece (its warranty started today, of its own model's kind, no service record
 *                on it, via `warranty_claim`), or the piece back (its record completed, the piece back to its status).
 *                A replacement's identity may be chosen again at shipment (`replacementProductId`, checked as at the
 *                decision): the one kept aside may have gone to an order since. Audited `warranty.claim.ship`.
 *   cancel       OPEN or LABEL_SENT, with a note (the collector never sent the piece, or withdrew). The closing note
 *                is always kept whole: when it does not fit beside the claim's own note, the earlier one is cut to fit
 *                (ending « … »), so a claim can always be closed. Audited `warranty.claim.cancel`.
 *
 * While a claim is OPEN or LABEL_SENT a transfer offer is refused (409 CLAIM_OPEN, services/ownership.ts); RECEIVED and
 * DECIDED are refused by the piece's SERVICED status. PRIVATE CARE is UNAVAILABLE while a claim is live
 * (services/care.ts). The label's PDF is erased 30 days after the claim ends (`eraseCareLabels`). The collector's view
 * and the right-of-access export never carry `note`, `opened_by`, `decided_by` nor any staff email.
 *
 * Lock order: the conversation, then the claimant's account, then the piece (open); the claim, then its account (decide,
 * moveToLegal), then its piece, then the replacement (every step). The account FOR KEY SHARE (`lockAccount`) before any
 * piece, as the house's order account → product (PRIVATE CARE's request takes the account FOR UPDATE, then the piece).
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  WARRANTY_CLAIM_LIVE_STATUSES,
  WARRANTY_CLAIM_OUTCOMES,
  WARRANTY_CLAIM_OUTCOMES_BY_BASIS,
  WARRANTY_CLAIM_REFUSALS,
  WARRANTY_CLAIM_REFUSALS_BY_BASIS,
  WARRANTY_CLAIM_STATUSES,
  type ClientConversationStatus,
  type HouseCurrency,
  type ProductRow,
  type WarrantyClaimBasis,
  type WarrantyClaimOutcome,
  type WarrantyClaimRefusal,
  type WarrantyClaimRow,
  type WarrantyClaimStatus,
} from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { CARE_ADDRESS_LIMITS, CARE_OPEN_STATUSES, checkLabelPdf, shipments, type CareShipment } from './care.js';
import { readProgram } from './club-program.js';
import { findProduct, TRANSITIONS, type LifecycleService } from './lifecycle.js';
import { addUtcMonths } from './tier-grants.js';
import { addMonthsClamped, computeWarrantyStatus, utcDate, type WarrantyService, type WarrantyStatus } from './warranty.js';

/** A warranty credit is valid this long from its decision (D5; the terms state it). */
export const WARRANTY_CREDIT_VALIDITY_MONTHS = 12;
/** The legal guarantee of conformity: 2 years from delivery (D1). */
export const LEGAL_GUARANTEE_MONTHS = 24;
/** A claim's note: 1 to 500 characters, staff only (as PRIVATE CARE's). */
export const CLAIM_NOTE_MAX = CARE_ADDRESS_LIMITS.note;
/** The collector's ORBES CARE tab shows a claim ended (DONE or CANCELLED) this long after its end. */
export const CLAIM_SHOWN_AFTER_END_MS = 30 * 86_400_000;
/** Where the claim's INSPECTION record is done (as PRIVATE CARE's, plan ORBES CARE answer 7). */
export const CLAIM_LOCATION = 'ORBES';

/** What staff open a claim under: the piece's ORBES warranty (its kind read from the piece) or the legal guarantee. */
export type ClaimOpenBasis = 'WARRANTY' | 'LEGAL';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKING_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,39}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** An order still standing: its piece sold through it (orders_product_key, migration 0022). */
const SOLD_ORDER_STATUSES = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED'] as const;
/** A piece can be claimed only when it can go IN SERVICE at receipt; LOST and STOLEN only to be refused from OPEN. */
const ONLY_REFUSED: readonly string[] = ['LOST', 'STOLEN'];
/** The outcomes after which ORBES keeps the piece (D9): the claim is DONE at the decision. */
const KEPT: readonly WarrantyClaimOutcome[] = ['VALUE_CREDIT', 'REFUND'];
/** The ORBES warranty's remedies, which need a warranty ACTIVE when the claim was opened. */
const REMEDIES: readonly WarrantyClaimOutcome[] = ['REPLACEMENT', 'REPAIR', 'VALUE_CREDIT', 'PART_CREDIT'];
/** The free replacement under the lifetime warranty (answer 4): `warranty_claims_free_once`. */
const FREE: readonly WarrantyClaimOutcome[] = ['REPLACEMENT', 'VALUE_CREDIT'];

// ── Errors ─────────────────────────────────────────────────────────────────

export const claimNotFound = () => notFound('Warranty claim', 'WARRANTY_CLAIM_NOT_FOUND');
export const claimStep = () => conflict('CLAIM_STEP', 'This warranty claim is not at that step.');
export const claimOpen = () => conflict('CLAIM_OPEN', 'A warranty claim is already under way for this piece.');
export const claimNotRegistered = () => conflict('CLAIM_NOT_REGISTERED', 'Only the registered owner of a piece can claim under its warranty.');
export const claimFreeUsed = () => conflict('CLAIM_FREE_USED', 'The free replacement of this piece has already been used.');
const claimNotAllowed = (status: string) => conflict('CLAIM_NOT_ALLOWED', 'The status of this piece does not allow a warranty claim.', `status ${status}`);
const transferPending = () =>
  conflict('CLAIM_NOT_ALLOWED', 'A transfer of this piece is pending: it can be claimed once the transfer is accepted, cancelled or expired.', 'transfer pending');
const returnPending = () =>
  conflict('CLAIM_NOT_ALLOWED', 'A return of this piece’s order is under way: it can be claimed once the return is decided or cancelled.', 'return pending');
const claimNotLegal = (detail: string) => conflict('CLAIM_NOT_LEGAL', 'The legal guarantee does not apply to this claim.', detail);
const outcomeNotAllowed = (message: string) => new DomainError('CLAIM_OUTCOME_NOT_ALLOWED', 422, message);
const replacementNotAllowed = (message: string, detail?: string) => conflict('CLAIM_REPLACEMENT_NOT_ALLOWED', message, detail);
const careUnderWay = () => conflict('CARE_OPEN', 'The PRIVATE CARE of this piece is under way: complete or cancel it first.');

// ── Shapes ─────────────────────────────────────────────────────────────────

/** An amount in minor units and its currency. */
export interface ClaimAmount {
  amountMinor: number;
  currency: string;
}

/** A claim as its collector reads it in the piece's ORBES CARE tab (answer 9): never a note nor who handled it. */
export interface CollectorClaim {
  id: string;
  status: WarrantyClaimStatus;
  basis: WarrantyClaimBasis;
  openedAt: Date;
  /** The prepaid label: its shipment, and whether its PDF can still be downloaded. */
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: Date | null;
  outcome: WarrantyClaimOutcome | null;
  refusalReason: WarrantyClaimRefusal | null;
  /** A credit of value or a part credit: its amount and when it expires. */
  credit: (ClaimAmount & { expiresAt: Date }) | null;
  /** A price reduction's or a refund's amount (the legal guarantee). */
  value: ClaimAmount | null;
  decidedAt: Date | null;
  /** The new piece, or the piece back. */
  return: CareShipment | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
}

/** A row of the console's Claims tab. */
export interface ClaimBoardRow {
  id: string;
  status: WarrantyClaimStatus;
  basis: WarrantyClaimBasis;
  outcome: WarrantyClaimOutcome | null;
  openedAt: Date;
  piece: { productId: string; model: string };
  /** The claimant; null for a legal claim of a buyer without an account. */
  account: { id: string; email: string } | null;
}

/** A claim as the console reads it (GET /api/admin/warranty-claims/:id). */
export interface ClaimSheet extends ClaimBoardRow {
  rootProductId: string;
  /** The piece's registered owner now, or null. */
  registeredOwner: { id: string; email: string } | null;
  conversation: { conversationId: string; status: ClientConversationStatus } | null;
  openedBy: { id: string; email: string };
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: Date | null;
  serviceRecordId: string | null;
  refusalReason: WarrantyClaimRefusal | null;
  value: ClaimAmount | null;
  creditPercent: number | null;
  grant: (ClaimAmount & { id: string; expiresAt: Date }) | null;
  replacement: { productId: string } | null;
  otherSize: boolean;
  decidedAt: Date | null;
  decidedBy: { id: string; email: string } | null;
  return: CareShipment | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  /** Staff only: never shown to the collector nor written in the audit log. */
  note: string | null;
  /** The 2-year claim this LEGAL claim continues, and the LEGAL claim continuing this one. */
  continues: string | null;
  continuedBy: string | null;
  /** The piece's warranty now: its kind and status. */
  warranty: { lifetime: boolean; status: WarrantyStatus; startDate: string | null; endDate: string | null };
  /** Whether the piece's model is no longer made (models.discontinued_at). */
  modelDiscontinued: boolean;
  /** Lifetime claims: whether the free replacement of the original purchase is still available, else the claim that used it. */
  freeReplacement: { available: true } | { available: false; claimId: string; decidedAt: Date } | null;
  /** The last day the legal guarantee applies (2 years from delivery, else from the warranty's start); null without either. */
  legalUntil: string | null;
  /**
   * What a decision may be now, from the basis and the free replacement: its outcomes and refusal reasons; the piece's
   * value a credit comes from (D11) and the price paid a refund or a price reduction comes from (null: entered by staff).
   */
  decision: { outcomes: WarrantyClaimOutcome[]; refusalReasons: WarrantyClaimRefusal[]; value: ClaimAmount | null; paid: ClaimAmount | null; creditPercent: number };
}

/** A claim of the console's piece page (its Warranty claims table). */
export interface PieceClaimRow {
  id: string;
  status: WarrantyClaimStatus;
  basis: WarrantyClaimBasis;
  outcome: WarrantyClaimOutcome | null;
  openedAt: Date;
  decidedAt: Date | null;
}

/** A piece's warranty claims as the console's piece page reads them (GET /api/admin/products/:productId, plan ORBES CARE §2(b)). */
export interface PieceClaims {
  /** The piece's warranty kind now: its own row's, else its model's choice (what a claim under the ORBES warranty records). */
  lifetime: boolean;
  /** Whether its model is no longer made (models.discontinued_at). */
  modelDiscontinued: boolean;
  /** The last day the legal guarantee applies (2 years from delivery, else from the warranty's start); null without either. */
  legalUntil: string | null;
  /** A lifetime piece only: the free replacement of its original purchase, still available or the claim that used it. */
  freeReplacement: { available: true } | { available: false; claimId: string; decidedAt: Date } | null;
  /** Its claims, newest first. */
  items: PieceClaimRow[];
  /** The INSPECTION records its claims opened: each is closed by its claim only, never from the piece page. */
  serviceIds: string[];
}

/** A claim in the account's right-of-access export: its facts, never its note nor who handled it. */
export interface ExportedWarrantyClaim {
  id: string;
  productId: string;
  basis: WarrantyClaimBasis;
  status: WarrantyClaimStatus;
  openedAt: Date;
  labelAt: Date | null;
  receivedAt: Date | null;
  outcome: WarrantyClaimOutcome | null;
  refusalReason: WarrantyClaimRefusal | null;
  value: ClaimAmount | null;
  creditPercent: number | null;
  replacementProductId: string | null;
  decidedAt: Date | null;
  returnShippedAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
}

export interface OpenClaimInput {
  /** The collector's conversation; null only for a legal claim of a buyer without an ORBES account. */
  conversationId: string | null;
  productId: string;
  basis: ClaimOpenBasis;
  note?: string | null;
}

export interface DecideClaimInput {
  outcome: WarrantyClaimOutcome;
  refusalReason?: WarrantyClaimRefusal | null;
  /** REPLACEMENT: the replacement's ORBES identity (its id or uuid). */
  replacementProductId?: string | null;
  /** REPLACEMENT: another size of the same model, as the client asked. */
  otherSize?: boolean;
  /** The piece's value when none is found (a credit, a refund); a price reduction's amount. In minor units. */
  valueMinor?: number | null;
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** The outcomes and refusal reasons a basis allows (the CHECKs of migration 0048). */
export function claimRules(basis: WarrantyClaimBasis): { outcomes: readonly WarrantyClaimOutcome[]; refusalReasons: readonly WarrantyClaimRefusal[] } {
  return { outcomes: WARRANTY_CLAIM_OUTCOMES_BY_BASIS[basis], refusalReasons: WARRANTY_CLAIM_REFUSALS_BY_BASIS[basis] };
}

/**
 * The outcomes of a decision now: the basis's, under the lifetime warranty the free replacement or, once used, the part
 * credit; the credit of the piece's value only when its model is no longer made (answer 4).
 */
export function decisionOutcomes(basis: WarrantyClaimBasis, freeAvailable: boolean, modelDiscontinued: boolean): WarrantyClaimOutcome[] {
  return WARRANTY_CLAIM_OUTCOMES_BY_BASIS[basis].filter((o) => {
    if (basis !== 'LIFETIME') return true;
    if (o === 'VALUE_CREDIT') return freeAvailable && modelDiscontinued;
    if (FREE.includes(o)) return freeAvailable;
    if (o === 'PART_CREDIT') return !freeAvailable;
    return true;
  });
}

/** A part credit: THE PROGRAM's percent of the value, rounded down. */
export function partCredit(valueMinor: number, percent: number): number {
  return Math.floor((valueMinor * percent) / 100);
}

/** The later of two instants: a step never before the one it follows (the CHECK `warranty_claims_times`). */
function notBefore(now: Date, before: Date | null | undefined): Date {
  return before && now.getTime() < before.getTime() ? before : now;
}

function claimId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw claimNotFound();
  return id.toLowerCase();
}

function adminIdOf(actor: Actor): string | null {
  return actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null;
}

function cleanNote(v: unknown, required: boolean, message = 'Write a note.'): string | null {
  const s = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
  if (s === '') {
    if (required) throw validationError(message);
    return null;
  }
  if (s.length > CLAIM_NOTE_MAX) throw validationError('A note is limited to 500 characters.');
  if (CONTROL.test(s)) throw validationError('The note contains invalid characters.');
  return s;
}

const NOTE_SEPARATOR = '\n\n';
const NOTE_CUT = '…';

/**
 * A note added to the claim's own: both kept, within the 500 characters of the column. With `cut` (CLOSE, whose note
 * is required), the added note is kept whole and the earlier one is cut to fit, ending « … » (dropped when not even
 * one character of it fits), so a claim opened with a long note can always be closed.
 */
function withNote(before: string | null, added: string | null, cut = false): string | null {
  if (added === null) return before;
  if (before === null) return added;
  const both = `${before}${NOTE_SEPARATOR}${added}`;
  if (both.length <= CLAIM_NOTE_MAX) return both;
  if (!cut) throw validationError('The notes of a claim are limited to 500 characters in all.');
  const room = CLAIM_NOTE_MAX - added.length - NOTE_SEPARATOR.length - NOTE_CUT.length;
  // Never half of a character written in two UTF-16 units (an unpaired surrogate is not valid text).
  let kept = before.slice(0, Math.max(0, room));
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  kept = kept.trimEnd();
  return kept === '' ? added : `${kept}${NOTE_CUT}${NOTE_SEPARATOR}${added}`;
}

function cleanTracking(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!TRACKING_RE.test(t)) throw validationError('A tracking number has 3 to 40 letters and digits.');
  return t;
}

function modelName(name: string, variantLabel: string | null): string {
  return variantLabel ? `${name} IN ${variantLabel.toUpperCase()}` : name;
}

// ── Reading ────────────────────────────────────────────────────────────────

/** The live claim of a piece (OPEN, LABEL_SENT, RECEIVED or DECIDED), or undefined. */
export async function liveClaimOf(db: Db, productUuid: string): Promise<{ id: string; status: WarrantyClaimStatus } | undefined> {
  return db.selectFrom('warranty_claims').select(['id', 'status']).where('product_id', '=', productUuid).where('status', 'in', [...WARRANTY_CLAIM_LIVE_STATUSES]).executeTakeFirst();
}

/**
 * The piece's latest claim for the account, as its ORBES CARE tab shows it: null without one, or when it ended (DONE or
 * CANCELLED) more than 30 days ago. A 2-year claim moved to the legal guarantee and the LEGAL claim continuing it share
 * their opening: the LEGAL one is shown.
 */
export async function collectorClaim(db: Db, accountId: string, productUuid: string, now: Date): Promise<CollectorClaim | null> {
  const r = await db
    .selectFrom('warranty_claims as c')
    .leftJoin('tier_grants as g', 'g.id', 'c.grant_id')
    .select([
      'c.id', 'c.status', 'c.basis', 'c.opened_at', 'c.label_carrier_id', 'c.label_tracking', 'c.label_at', sql<boolean>`c.label_pdf IS NOT NULL`.as('has_pdf'),
      'c.received_at', 'c.outcome', 'c.refusal_reason', 'c.value_minor', 'c.currency', 'c.decided_at', 'c.return_carrier_id', 'c.return_tracking', 'c.return_shipped_at',
      'c.done_at', 'c.cancelled_at', 'g.amount_minor as grant_minor', 'g.currency as grant_currency', 'g.expires_at as grant_expires_at',
    ])
    .where('c.account_id', '=', accountId)
    .where('c.product_id', '=', productUuid)
    .orderBy('c.opened_at', 'desc')
    .orderBy(sql`c.continues_claim_id IS NULL`)
    .orderBy('c.id')
    .limit(1)
    .executeTakeFirst();
  if (!r) return null;
  const ended = r.status === 'DONE' ? r.done_at : r.status === 'CANCELLED' ? r.cancelled_at : null;
  if (ended && now.getTime() - ended.getTime() > CLAIM_SHOWN_AFTER_END_MS) return null;
  const s = await shipments(db, r);
  const legalRemedy = r.outcome === 'PRICE_REDUCTION' || r.outcome === 'REFUND';
  return {
    id: r.id,
    status: r.status,
    basis: r.basis,
    openedAt: r.opened_at,
    label: s.label ? { ...s.label, pdf: r.has_pdf } : null,
    receivedAt: r.received_at,
    outcome: r.outcome,
    refusalReason: r.refusal_reason,
    credit: r.grant_minor !== null && r.grant_currency !== null && r.grant_expires_at !== null ? { amountMinor: r.grant_minor, currency: r.grant_currency, expiresAt: r.grant_expires_at } : null,
    value: legalRemedy && r.value_minor !== null && r.currency !== null ? { amountMinor: r.value_minor, currency: r.currency } : null,
    decidedAt: r.decided_at,
    return: s.back,
    doneAt: r.done_at,
    cancelledAt: r.cancelled_at,
  };
}

/** Every warranty claim of an account, oldest first: its right-of-access export (never the note nor who handled it). */
export async function accountWarrantyClaims(db: Db, accountId: string): Promise<ExportedWarrantyClaim[]> {
  const rows = await db
    .selectFrom('warranty_claims as c')
    .innerJoin('products as p', 'p.id', 'c.product_id')
    .leftJoin('products as n', 'n.id', 'c.replacement_product_id')
    .select([
      'c.id', 'p.product_id', 'c.basis', 'c.status', 'c.opened_at', 'c.label_at', 'c.received_at', 'c.outcome', 'c.refusal_reason', 'c.value_minor', 'c.currency',
      'c.credit_percent', 'n.product_id as replacement', 'c.decided_at', 'c.return_shipped_at', 'c.done_at', 'c.cancelled_at',
    ])
    .where('c.account_id', '=', accountId)
    .orderBy('c.opened_at')
    .orderBy('c.id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    basis: r.basis,
    status: r.status,
    openedAt: r.opened_at,
    labelAt: r.label_at,
    receivedAt: r.received_at,
    outcome: r.outcome,
    refusalReason: r.refusal_reason,
    value: r.value_minor !== null && r.currency !== null ? { amountMinor: r.value_minor, currency: r.currency } : null,
    creditPercent: r.credit_percent,
    replacementProductId: r.replacement,
    decidedAt: r.decided_at,
    returnShippedAt: r.return_shipped_at,
    doneAt: r.done_at,
    cancelledAt: r.cancelled_at,
  }));
}

/** The order a piece was sold through (one standing order per piece), with its buyer, price and delivery. */
async function saleOf(db: Db, productUuid: string) {
  return db
    .selectFrom('orders')
    .select(['id', 'account_id', 'price_minor', 'currency', 'status', 'delivered_at'])
    .where('product_id', '=', productUuid)
    .where('status', 'in', [...SOLD_ORDER_STATUSES])
    .orderBy('reserved_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/** The price paid for the piece: its order's, else its original's (a replacement is never sold), when it has one. */
async function pricePaid(db: Db, productUuid: string, rootUuid: string): Promise<ClaimAmount | null> {
  for (const id of productUuid === rootUuid ? [productUuid] : [productUuid, rootUuid]) {
    const o = await saleOf(db, id);
    if (o && o.price_minor !== null && o.price_minor > 0 && o.currency !== null) return { amountMinor: o.price_minor, currency: o.currency };
  }
  return null;
}

/** The piece's value (D11): the price paid, else its model's base price (a variant's, else its main model's); null when none. */
async function pieceValue(db: Db, product: Pick<ProductRow, 'id' | 'model_id'>, rootUuid: string): Promise<ClaimAmount | null> {
  const paid = await pricePaid(db, product.id, rootUuid);
  if (paid) return paid;
  const m = await db
    .selectFrom('models as m')
    .leftJoin('models as mm', 'mm.id', 'm.variant_of')
    .select(['m.base_price_minor', 'm.base_currency', 'mm.base_price_minor as main_minor', 'mm.base_currency as main_currency'])
    .where('m.id', '=', product.model_id)
    .executeTakeFirst();
  if (m?.base_price_minor && m.base_currency) return { amountMinor: m.base_price_minor, currency: m.base_currency };
  if (m?.main_minor && m.main_currency) return { amountMinor: m.main_minor, currency: m.main_currency };
  return null;
}

/** The legal guarantee's last day: 2 years from the delivered order's date, else from the warranty's start; null without either. */
async function legalUntil(db: Db, productUuid: string): Promise<string | null> {
  const o = await saleOf(db, productUuid);
  const w = await db.selectFrom('warranties').select('start_date').where('product_id', '=', productUuid).executeTakeFirst();
  const from = o?.delivered_at ? utcDate(o.delivered_at) : (w?.start_date ?? null);
  return from ? addMonthsClamped(from, LEGAL_GUARANTEE_MONTHS) : null;
}

/** The buyer of the piece: the account of its order, else of its original's order; null for a boutique sale. */
async function buyerOf(db: Db, productUuid: string, rootUuid: string): Promise<string | null> {
  for (const id of productUuid === rootUuid ? [productUuid] : [productUuid, rootUuid]) {
    const o = await saleOf(db, id);
    if (o) return o.account_id;
  }
  return null;
}

/** Whether the legal guarantee applies: within its 2 years, claimed by the buyer (a boutique sale: the receipt in the note). */
async function assertLegal(db: Db, productUuid: string, rootUuid: string, accountId: string | null, note: string | null, today: string): Promise<void> {
  const until = await legalUntil(db, productUuid);
  if (until === null) throw claimNotLegal('no delivery nor warranty start for this piece');
  if (today > until) throw claimNotLegal('more than 2 years after delivery');
  const buyer = await buyerOf(db, productUuid, rootUuid);
  if (buyer === null) {
    if (note === null) throw validationError('Write the receipt of the boutique sale in the note.');
    return;
  }
  if (accountId === null) throw claimNotLegal('the piece was sold through an ORBES order: open the claim from its buyer’s conversation');
  if (buyer !== accountId) throw claimNotLegal('the claimant is not the buyer');
}

/** The piece's warranty kind now: its own row's, else its model's choice. */
async function warrantyKind(db: Db, product: Pick<ProductRow, 'id' | 'model_id'>): Promise<boolean> {
  const w = await db.selectFrom('warranties').select('lifetime').where('product_id', '=', product.id).forShare().executeTakeFirst();
  if (w) return w.lifetime;
  const m = await db.selectFrom('models').select('warranty_lifetime').where('id', '=', product.model_id).forShare().executeTakeFirstOrThrow();
  return m.warranty_lifetime;
}

/**
 * The ORBES warranty's status on the day the claim was opened, read as the claim's basis (a lifetime claim never ends). A
 * 2-year claim whose model was switched to Lifetime since has lost its row's end date (`warranties_kind`): it is rebuilt
 * from the start and the months, as a switch back to 2 years gives it (D17), so the claim keeps its fixed basis.
 */
async function statusAtOpening(db: Db, claim: Pick<WarrantyClaimRow, 'product_id' | 'basis' | 'opened_at'>): Promise<WarrantyStatus> {
  const w = await db.selectFrom('warranties').selectAll().where('product_id', '=', claim.product_id).executeTakeFirst();
  if (!w) return 'NOT_STARTED';
  const voidedBefore = w.voided_at !== null && w.voided_at.getTime() <= claim.opened_at.getTime();
  const lifetime = claim.basis === 'LIFETIME';
  const endDate = !lifetime && w.start_date !== null && w.end_date === null ? addMonthsClamped(w.start_date, w.duration_months) : w.end_date;
  return computeWarrantyStatus({ ...w, voided_at: voidedBefore ? w.voided_at : null, lifetime, end_date: endDate }, utcDate(claim.opened_at));
}

/**
 * The claim's account FOR KEY SHARE, the lock its foreign key takes on a claim's insert or a grant's anyway, taken before
 * the piece (lock order account → product): taken after it, by that insert, it crossed PRIVATE CARE's request, which
 * holds the account FOR UPDATE and waits for the piece, and PostgreSQL broke the deadlock by failing one of them.
 */
async function lockAccount(tx: Db, accountId: string): Promise<void> {
  await tx.selectFrom('accounts').select('id').where('id', '=', accountId).forKeyShare().execute();
}

/** The claim that used the free replacement of a root under the lifetime warranty, if any. */
async function freeUsedBy(db: Db, rootUuid: string): Promise<{ id: string; decided_at: Date } | undefined> {
  const r = await db
    .selectFrom('warranty_claims')
    .select(['id', 'decided_at'])
    .where('root_product_id', '=', rootUuid)
    .where('basis', '=', 'LIFETIME')
    .where('outcome', 'in', [...FREE])
    .executeTakeFirst();
  return r ? { id: r.id, decided_at: r.decided_at! } : undefined;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface WarrantyClaimServiceDeps {
  db: Db;
  audit: AuditService;
  warranty: WarrantyService;
  lifecycle: LifecycleService;
  clock?: Clock;
}

export class WarrantyClaimService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly warranty: WarrantyService;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;

  constructor(deps: WarrantyClaimServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.warranty = deps.warranty;
    this.lifecycle = deps.lifecycle;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The collector ────────────────────────────────────────────────────────

  /** The piece's latest claim for the account (its ORBES CARE tab, with the care status), or null. See collectorClaim. */
  async forCollector(accountId: string, productRef: string): Promise<CollectorClaim | null> {
    const product = await findProduct(this.db, productRef);
    if (!product) return null;
    return collectorClaim(this.db, accountId, product.id, this.clock());
  }

  /** The claim's prepaid label, for its own account only (404 otherwise, and once erased). */
  async labelPdf(accountId: string, id: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    const cid = claimId(id);
    const r = await this.db
      .selectFrom('warranty_claims as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .select(['c.account_id', 'c.label_pdf', 'p.product_id'])
      .where('c.id', '=', cid)
      .executeTakeFirst();
    if (!r || r.account_id !== accountId || !r.label_pdf) throw claimNotFound();
    return { contentType: 'application/pdf', body: r.label_pdf, filename: `ORBES-WARRANTY-CLAIM-${r.product_id}-LABEL.pdf` };
  }

  // ── The console ──────────────────────────────────────────────────────────

  /** Whether a claim has this id (the shared label upload path, routes/admin/care.ts). */
  async has(id: string): Promise<boolean> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return false;
    return (await this.db.selectFrom('warranty_claims').select('id').where('id', '=', id.toLowerCase()).executeTakeFirst()) !== undefined;
  }

  /** The Claims tab (GET /api/admin/warranty-claims): the claims under way first, then the others, newest first; `status` optional. */
  async list(filter: { status?: WarrantyClaimStatus }, page: PageRequest): Promise<Page<ClaimBoardRow>> {
    if (filter.status !== undefined && !WARRANTY_CLAIM_STATUSES.includes(filter.status)) throw validationError('Unknown claim status.');
    let q = this.db
      .selectFrom('warranty_claims as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .leftJoin('accounts as a', 'a.id', 'c.account_id');
    if (filter.status) q = q.where('c.status', '=', filter.status);
    const live = sql.join(WARRANTY_CLAIM_LIVE_STATUSES.map((s) => sql.lit(s)));
    const [rows, count] = await Promise.all([
      q
        .select(['c.id', 'c.status', 'c.basis', 'c.outcome', 'c.opened_at', 'p.product_id', 'm.name', 'm.variant_label', 'a.id as account_id', 'a.email'])
        .orderBy(sql`CASE WHEN c.status IN (${live}) THEN 0 ELSE 1 END`)
        .orderBy('c.opened_at', 'desc')
        .orderBy('c.id')
        .limit(page.pageSize)
        .offset(pageOffset(page))
        .execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return makePage(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        basis: r.basis,
        outcome: r.outcome,
        openedAt: r.opened_at,
        piece: { productId: r.product_id, model: modelName(r.name, r.variant_label) },
        account: r.account_id && r.email ? { id: r.account_id, email: r.email } : null,
      })),
      Number(count.n),
      page,
    );
  }

  /**
   * A piece's claims for its console page (plan ORBES CARE §2(b) « The piece page »): its warranty kind now, its model
   * discontinued or not, the legal guarantee's last day, the free replacement read from its original purchase (a lifetime
   * piece only), its claims newest first and the INSPECTION records they opened. `productUuid` is the piece's row id.
   */
  async forPiece(productUuid: string): Promise<PieceClaims> {
    const db = this.db;
    const p = await db
      .selectFrom('products as p')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .leftJoin('warranties as w', 'w.product_id', 'p.id')
      .select(['m.warranty_lifetime', 'm.discontinued_at', 'w.lifetime'])
      .where('p.id', '=', productUuid)
      .executeTakeFirstOrThrow();
    const lifetime = p.lifetime ?? p.warranty_lifetime;
    const rows = await db
      .selectFrom('warranty_claims')
      .select(['id', 'status', 'basis', 'outcome', 'opened_at', 'decided_at', 'service_record_id'])
      .where('product_id', '=', productUuid)
      .orderBy('opened_at', 'desc')
      .orderBy(sql`continues_claim_id IS NULL`)
      .orderBy('id')
      .execute();
    let freeReplacement: PieceClaims['freeReplacement'] = null;
    if (lifetime) {
      const replaced = await db.selectFrom('warranty_claims').select('root_product_id').where('replacement_product_id', '=', productUuid).executeTakeFirst();
      const used = await freeUsedBy(db, replaced?.root_product_id ?? productUuid);
      freeReplacement = used ? { available: false, claimId: used.id, decidedAt: used.decided_at } : { available: true };
    }
    return {
      lifetime,
      modelDiscontinued: p.discontinued_at !== null,
      legalUntil: await legalUntil(db, productUuid),
      freeReplacement,
      items: rows.map((r) => ({ id: r.id, status: r.status, basis: r.basis, outcome: r.outcome, openedAt: r.opened_at, decidedAt: r.decided_at })),
      serviceIds: rows.flatMap((r) => (r.service_record_id ? [r.service_record_id] : [])),
    };
  }

  /** A claim as the console reads it (GET /api/admin/warranty-claims/:id). */
  async sheet(id: string): Promise<ClaimSheet> {
    const cid = claimId(id);
    const db = this.db;
    const r = await db
      .selectFrom('warranty_claims as c')
      .innerJoin('products as p', 'p.id', 'c.product_id')
      .innerJoin('products as root', 'root.id', 'c.root_product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .innerJoin('admin_users as ob', 'ob.id', 'c.opened_by')
      .leftJoin('admin_users as db_', 'db_.id', 'c.decided_by')
      .leftJoin('accounts as a', 'a.id', 'c.account_id')
      .leftJoin('client_conversations as v', 'v.id', 'c.conversation_id')
      .leftJoin('tier_grants as g', 'g.id', 'c.grant_id')
      .leftJoin('products as n', 'n.id', 'c.replacement_product_id')
      .selectAll('c')
      .select([
        sql<boolean>`c.label_pdf IS NOT NULL`.as('has_pdf'),
        'p.product_id as serial', 'p.model_id', 'root.product_id as root_serial', 'm.name', 'm.variant_label', 'm.discontinued_at', 'ob.email as opened_email',
        'db_.email as decided_email', 'a.email', 'v.status as conversation_status', 'g.amount_minor as grant_minor', 'g.currency as grant_currency',
        'g.expires_at as grant_expires_at', 'n.product_id as replacement_serial',
      ])
      .where('c.id', '=', cid)
      .executeTakeFirst();
    if (!r) throw claimNotFound();
    const now = this.clock();
    const s = await shipments(db, r);
    const owner = await db
      .selectFrom('ownership as o')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .select(['a.id', 'a.email'])
      .where('o.product_id', '=', r.product_id)
      .where('o.ended_at', 'is', null)
      .executeTakeFirst();
    const w = await db.selectFrom('warranties').selectAll().where('product_id', '=', r.product_id).executeTakeFirst();
    const continuedBy = await db.selectFrom('warranty_claims').select('id').where('continues_claim_id', '=', r.id).executeTakeFirst();
    const used = r.basis === 'LIFETIME' ? await freeUsedBy(db, r.root_product_id) : undefined;
    const freeAvailable = used === undefined;
    const program = await readProgram(db);
    return {
      id: r.id,
      status: r.status,
      basis: r.basis,
      outcome: r.outcome,
      openedAt: r.opened_at,
      piece: { productId: r.serial, model: modelName(r.name, r.variant_label) },
      account: r.account_id && r.email ? { id: r.account_id, email: r.email } : null,
      rootProductId: r.root_serial,
      registeredOwner: owner ? { id: owner.id, email: owner.email } : null,
      conversation: r.conversation_id && r.conversation_status ? { conversationId: r.conversation_id, status: r.conversation_status } : null,
      openedBy: { id: r.opened_by, email: r.opened_email },
      label: s.label ? { ...s.label, pdf: r.has_pdf } : null,
      receivedAt: r.received_at,
      serviceRecordId: r.service_record_id,
      refusalReason: r.refusal_reason,
      value: r.value_minor !== null && r.currency !== null ? { amountMinor: r.value_minor, currency: r.currency } : null,
      creditPercent: r.credit_percent,
      grant: r.grant_id && r.grant_minor !== null && r.grant_currency !== null && r.grant_expires_at !== null ? { id: r.grant_id, amountMinor: r.grant_minor, currency: r.grant_currency, expiresAt: r.grant_expires_at } : null,
      replacement: r.replacement_serial ? { productId: r.replacement_serial } : null,
      otherSize: r.other_size,
      decidedAt: r.decided_at,
      decidedBy: r.decided_by ? { id: r.decided_by, email: r.decided_email ?? '' } : null,
      return: s.back,
      doneAt: r.done_at,
      cancelledAt: r.cancelled_at,
      note: r.note,
      continues: r.continues_claim_id,
      continuedBy: continuedBy?.id ?? null,
      warranty: {
        lifetime: w?.lifetime ?? false,
        status: computeWarrantyStatus(w ?? null, utcDate(now)),
        startDate: w?.start_date ?? null,
        endDate: w?.end_date ?? null,
      },
      modelDiscontinued: r.discontinued_at !== null,
      freeReplacement: r.basis !== 'LIFETIME' ? null : used === undefined ? { available: true } : { available: false, claimId: used.id, decidedAt: used.decided_at },
      legalUntil: await legalUntil(db, r.product_id),
      decision: {
        outcomes: decisionOutcomes(r.basis, freeAvailable, r.discontinued_at !== null),
        refusalReasons: [...WARRANTY_CLAIM_REFUSALS_BY_BASIS[r.basis]],
        value: await pieceValue(db, { id: r.product_id, model_id: r.model_id }, r.root_product_id),
        paid: await pricePaid(db, r.product_id, r.root_product_id),
        creditPercent: program.warrantyCreditPercent,
      },
    };
  }

  /** Open a claim (POST /api/admin/warranty-claims, OPERATOR). See the header. */
  async open(input: OpenClaimInput, actor: Actor): Promise<ClaimSheet> {
    const by = this.staff(actor);
    if (input.basis !== 'WARRANTY' && input.basis !== 'LEGAL') throw validationError('Choose the ORBES warranty or the legal guarantee.');
    const conversationId = input.conversationId === null ? null : claimRef(input.conversationId, () => notFound('Conversation', 'CONVERSATION_NOT_FOUND'));
    // The ORBES warranty is claimed by its registered owner, who wrote: a claim without a conversation is a legal one.
    if (conversationId === null && input.basis !== 'LEGAL') throw claimNotRegistered();
    const note = cleanNote(input.note, conversationId === null, 'Write the receipt of the boutique sale in the note.');
    const now = this.clock();
    const id = await inTransaction(this.db, async (tx) => {
      let accountId: string | null = null;
      if (conversationId !== null) {
        const v = await tx.selectFrom('client_conversations').select(['id', 'account_id']).where('id', '=', conversationId).forShare().executeTakeFirst();
        if (!v) throw notFound('Conversation', 'CONVERSATION_NOT_FOUND');
        accountId = v.account_id;
        await lockAccount(tx, accountId);
      }
      const product = await findProduct(tx, input.productId, { forUpdate: true });
      if (!product) throw notFound('Product', 'PRODUCT_NOT_FOUND');
      if (!ONLY_REFUSED.includes(product.status) && (product.status === 'COUNTERFEIT_FLAGGED' || !TRANSITIONS[product.status].includes('SERVICED'))) {
        throw claimNotAllowed(product.status);
      }
      if (await liveClaimOf(tx, product.id)) throw claimOpen();
      const care = await tx.selectFrom('care_requests').select('id').where('product_id', '=', product.id).where('status', 'in', [...CARE_OPEN_STATUSES]).executeTakeFirst();
      if (care) throw careUnderWay();
      // A transfer offer pending (an expired one can no longer be accepted): the piece could pass to its recipient while
      // the claim carries on for the one who offered it (answer 3; §2(c): the return never goes to a former owner).
      const offer = await tx.selectFrom('ownership_transfers').select('id').where('product_id', '=', product.id).where('status', '=', 'PENDING').where('expires_at', '>', now).executeTakeFirst();
      if (offer) throw transferPending();
      // A return or an exchange of the piece's order not ended: its decision would take the piece back from the claimant.
      const back = await tx
        .selectFrom('order_cases as k')
        .innerJoin('orders as o', 'o.id', 'k.order_id')
        .select('k.id')
        .where('o.product_id', '=', product.id)
        .where('k.kind', 'in', ['RETURN', 'EXCHANGE'])
        .where('k.status', 'in', ['OPEN', 'RECEIVED'])
        .executeTakeFirst();
      if (back) throw returnPending();
      const replaced = await tx.selectFrom('warranty_claims').select('root_product_id').where('replacement_product_id', '=', product.id).executeTakeFirst();
      const root = replaced?.root_product_id ?? product.id;
      let basis: WarrantyClaimBasis;
      if (input.basis === 'WARRANTY') {
        const owner = await tx.selectFrom('ownership').select('account_id').where('product_id', '=', product.id).where('ended_at', 'is', null).executeTakeFirst();
        if (!owner || owner.account_id !== accountId) throw claimNotRegistered();
        basis = (await warrantyKind(tx, product)) ? 'LIFETIME' : 'TWO_YEARS';
      } else {
        await assertLegal(tx, product.id, root, accountId, note, utcDate(now));
        basis = 'LEGAL';
      }
      const row = await tx
        .insertInto('warranty_claims')
        .values({ product_id: product.id, root_product_id: root, account_id: accountId, conversation_id: conversationId, basis, status: 'OPEN', opened_at: now, opened_by: by, note })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch((e: unknown) => {
          if (isUniqueViolation(e, 'warranty_claims_open_once')) throw claimOpen();
          throw e;
        });
      await this.audit.record(
        { actor, action: 'warranty.claim.open', targetType: 'warranty_claim', targetId: row.id, details: { claimId: row.id, productId: product.product_id, basis, ...(accountId ? { accountId } : {}) } },
        tx,
      );
      return row.id;
    });
    return this.sheet(id);
  }

  /** SEND LABEL (POST /api/admin/care/:id/label with a claim's id, OPERATOR): the prepaid label → LABEL_SENT. */
  async label(id: string, input: { pdf: unknown; carrierId: unknown; tracking: unknown }, actor: Actor): Promise<ClaimSheet> {
    const pdf = checkLabelPdf(input.pdf);
    const tracking = cleanTracking(input.tracking);
    return this.step(id, ['OPEN'], actor, 'warranty.claim.label', async (tx, c, now) => {
      const product = await this.piece(tx, c.product_id);
      if (!TRANSITIONS[product.status].includes('SERVICED') || product.status === 'COUNTERFEIT_FLAGGED' || ONLY_REFUSED.includes(product.status)) throw claimNotAllowed(product.status);
      const carrier = await this.activeCarrier(tx, input.carrierId);
      await tx
        .updateTable('warranty_claims')
        .set({ status: 'LABEL_SENT', label_pdf: pdf, label_carrier_id: carrier, label_tracking: tracking, label_at: notBefore(now, c.opened_at) })
        .where('id', '=', c.id)
        .execute();
      return { carrierId: carrier, bytes: pdf.byteLength };
    });
  }

  /** RECEIVED BY ORBES (OPERATOR): the INSPECTION record opened, the piece IN SERVICE, in the same transaction. */
  async receive(id: string, actor: Actor): Promise<ClaimSheet> {
    return this.step(id, ['LABEL_SENT'], actor, 'warranty.claim.receive', async (tx, c, now) => {
      const record = await this.warranty.openService(c.product_id, { type: 'INSPECTION', location: CLAIM_LOCATION, notes: null, performedBy: CLAIM_LOCATION }, actor, tx);
      await tx
        .updateTable('warranty_claims')
        .set({ status: 'RECEIVED', received_at: notBefore(now, c.label_at), service_record_id: record.id })
        .where('id', '=', c.id)
        .execute();
      return { serviceId: record.id };
    });
  }

  /** CLOSE (OPERATOR, a note): OPEN or LABEL_SENT, the collector never sent the piece or withdrew → CANCELLED. */
  async cancel(id: string, input: { note?: unknown }, actor: Actor): Promise<ClaimSheet> {
    const added = cleanNote(input?.note, true)!;
    return this.step(id, ['OPEN', 'LABEL_SENT'], actor, 'warranty.claim.cancel', async (tx, c, now) => {
      const note = withNote(c.note, added, true);
      await tx
        .updateTable('warranty_claims')
        .set({ status: 'CANCELLED', cancelled_at: notBefore(now, c.label_at ?? c.opened_at), note })
        .where('id', '=', c.id)
        .execute();
      // Never the note itself in the audit: only that the earlier one was cut.
      const shortened = c.note !== null && note !== `${c.note}${NOTE_SEPARATOR}${added}`;
      return { from: c.status, ...(shortened ? { noteShortened: true } : {}) };
    });
  }

  /**
   * MOVE TO THE LEGAL GUARANTEE (POST /api/admin/warranty-claims/:id/legal, OPERATOR): a received 2-year claim continues
   * as a LEGAL claim, the piece staying with ORBES under the same INSPECTION record. Returns the LEGAL claim.
   */
  async moveToLegal(id: string, input: { note?: unknown }, actor: Actor): Promise<ClaimSheet> {
    this.staff(actor);
    const cid = claimId(id);
    const added = cleanNote(input?.note, false);
    const legalId = await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('warranty_claims').selectAll().where('id', '=', cid).forUpdate().executeTakeFirst();
      if (!c) throw claimNotFound();
      if (c.basis !== 'TWO_YEARS') throw claimNotLegal('only a 2-year claim moves to the legal guarantee');
      if (c.status !== 'RECEIVED') throw claimStep();
      const note = withNote(c.note, added);
      if (c.account_id !== null) await lockAccount(tx, c.account_id);
      // A boutique sale's receipt: in the note given now (the claim's own note was written for the 2-year warranty).
      await assertLegal(tx, c.product_id, c.root_product_id, c.account_id, added, utcDate(this.clock()));
      const now = notBefore(this.clock(), c.received_at);
      // The 2-year claim first, so that `warranty_claims_open_once` and the UNIQUE record hold for the LEGAL one.
      await tx.updateTable('warranty_claims').set({ status: 'CANCELLED', cancelled_at: now, service_record_id: null }).where('id', '=', c.id).execute();
      const legal = await tx
        .insertInto('warranty_claims')
        .values({
          product_id: c.product_id,
          root_product_id: c.root_product_id,
          account_id: c.account_id,
          conversation_id: c.conversation_id,
          basis: 'LEGAL',
          status: 'RECEIVED',
          opened_at: c.opened_at,
          opened_by: c.opened_by,
          label_pdf: c.label_pdf,
          label_carrier_id: c.label_carrier_id,
          label_tracking: c.label_tracking,
          label_at: c.label_at,
          received_at: c.received_at,
          service_record_id: c.service_record_id,
          note,
          continues_claim_id: c.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const p = await tx.selectFrom('products').select('product_id').where('id', '=', c.product_id).executeTakeFirstOrThrow();
      await this.audit.record(
        { actor, action: 'warranty.claim.legal', targetType: 'warranty_claim', targetId: legal.id, details: { claimId: legal.id, continues: c.id, productId: p.product_id } },
        tx,
      );
      return legal.id;
    });
    return this.sheet(legalId);
  }

  /** DECIDE (POST /api/admin/warranty-claims/:id/decide, OPERATOR). See the header. */
  async decide(id: string, input: DecideClaimInput, actor: Actor): Promise<ClaimSheet> {
    const outcome = input?.outcome;
    if (!WARRANTY_CLAIM_OUTCOMES.includes(outcome)) throw validationError('Choose an outcome.');
    const reason = input.refusalReason ?? null;
    if (outcome === 'REFUSED' && (reason === null || !WARRANTY_CLAIM_REFUSALS.includes(reason))) throw validationError('Choose the reason of the refusal.');
    if (outcome !== 'REFUSED' && reason !== null) throw validationError('A reason is given with a refusal only.');
    const entered = input.valueMinor ?? null;
    if (entered !== null && (!Number.isInteger(entered) || entered < 1 || entered > 100_000_000)) throw validationError('An amount is a whole number of cents, from 1.');
    const otherSize = input.otherSize === true;
    if (otherSize && outcome !== 'REPLACEMENT') throw validationError('Another size is chosen with a replacement only.');
    return this.step(id, outcome === 'REFUSED' ? ['OPEN', 'RECEIVED'] : ['RECEIVED'], actor, 'warranty.claim.decide', async (tx, c, now, by) => {
      // Its account before its piece: a credit's grant references the account.
      if (c.account_id !== null) await lockAccount(tx, c.account_id);
      const rules = claimRules(c.basis);
      if (!rules.outcomes.includes(outcome)) throw outcomeNotAllowed('This warranty does not allow that outcome.');
      if (reason !== null && !rules.refusalReasons.includes(reason)) throw outcomeNotAllowed('This warranty does not allow that reason of refusal.');
      if (c.basis !== 'LEGAL' && REMEDIES.includes(outcome) && (await statusAtOpening(tx, c)) !== 'ACTIVE') {
        throw outcomeNotAllowed('The warranty of this piece was not active when the claim was opened: only a refusal is possible.');
      }
      if (c.basis === 'LIFETIME' && (FREE.includes(outcome) || outcome === 'PART_CREDIT')) {
        const used = await freeUsedBy(tx, c.root_product_id);
        if (FREE.includes(outcome) && used) throw claimFreeUsed();
        if (outcome === 'PART_CREDIT' && !used) throw outcomeNotAllowed('The free replacement of this piece is still available: replace it, or give the credit of its value.');
      }
      const product = await this.piece(tx, c.product_id);
      // A credit of the piece's value only when its model is no longer made (answer 4), read under the piece's lock.
      if (outcome === 'VALUE_CREDIT') {
        const m = await tx.selectFrom('models').select('discontinued_at').where('id', '=', product.model_id).forShare().executeTakeFirstOrThrow();
        if (m.discontinued_at === null) throw outcomeNotAllowed('This model is still made: replace the piece with the same piece, new.');
      }
      const program = await readProgram(tx);
      const decidedAt = notBefore(now, c.received_at ?? c.opened_at);
      const details: Record<string, unknown> = { basis: c.basis, outcome, ...(reason ? { refusalReason: reason } : {}) };
      const set: Partial<{
        status: WarrantyClaimStatus;
        value_minor: number;
        currency: HouseCurrency;
        credit_percent: number;
        grant_id: string;
        replacement_product_id: string;
        other_size: boolean;
        done_at: Date;
      }> = {};

      // The value a credit, a refund or a price reduction comes from (D11).
      const known = outcome === 'VALUE_CREDIT' || outcome === 'PART_CREDIT' ? await pieceValue(tx, product, c.root_product_id) : outcome === 'REFUND' || outcome === 'PRICE_REDUCTION' ? await pricePaid(tx, product.id, c.root_product_id) : null;
      let value: ClaimAmount | null = null;
      if (outcome === 'VALUE_CREDIT' || outcome === 'PART_CREDIT' || outcome === 'REFUND') {
        if (known && entered !== null) throw validationError('The value of this piece is known: it is not entered.');
        if (!known && entered === null) throw validationError('Enter the value of this piece.');
        value = known ?? { amountMinor: entered!, currency: program.creditCurrency };
      } else if (outcome === 'PRICE_REDUCTION') {
        if (entered === null) throw validationError('Enter the amount of the price reduction.');
        if (known && entered > known.amountMinor) throw validationError('A price reduction is at most the price paid.');
        value = { amountMinor: entered, currency: known?.currency ?? program.creditCurrency };
      } else if (entered !== null) {
        throw validationError('An amount is entered with a credit, a price reduction or a refund only.');
      }
      if (value) {
        set.value_minor = value.amountMinor;
        set.currency = value.currency as HouseCurrency;
        details.valueMinor = value.amountMinor;
        details.currency = value.currency;
      }

      // A warranty credit: a grant of kind WARRANTY, no tier, valid 12 months, in the value's currency.
      if (outcome === 'VALUE_CREDIT' || outcome === 'PART_CREDIT') {
        const amount = outcome === 'PART_CREDIT' ? partCredit(value!.amountMinor, program.warrantyCreditPercent) : value!.amountMinor;
        if (amount < 1) throw validationError('The credit would be nothing: enter the value of this piece again.');
        if (c.account_id === null) throw outcomeNotAllowed('A credit is given to an account.');
        const expiresAt = addUtcMonths(decidedAt, WARRANTY_CREDIT_VALIDITY_MONTHS);
        const grant = await tx
          .insertInto('tier_grants')
          .values({ account_id: c.account_id, tier: null, kind: 'WARRANTY', granted_at: decidedAt, amount_minor: amount, currency: value!.currency, expires_at: expiresAt })
          .returning('id')
          .executeTakeFirstOrThrow();
        set.grant_id = grant.id;
        if (outcome === 'PART_CREDIT') set.credit_percent = program.warrantyCreditPercent;
        details.grantId = grant.id;
        if (outcome === 'PART_CREDIT') details.creditPercent = program.warrantyCreditPercent;
        await this.audit.record(
          {
            actor,
            action: 'club.grant',
            targetType: 'account',
            targetId: c.account_id,
            details: { grantId: grant.id, kind: 'WARRANTY', claimId: c.id, amountMinor: amount, currency: value!.currency, expiresAt: expiresAt.toISOString() },
          },
          tx,
        );
      }

      if (outcome === 'REPLACEMENT') {
        const next = await this.replacementFor(tx, product, input.replacementProductId, otherSize);
        set.replacement_product_id = next.id;
        set.other_size = otherSize;
        details.replacement = next.product_id;
        if (otherSize) details.otherSize = true;
      }

      // ORBES keeps the piece (a replacement, a credit of value, a refund): its identity closed, its record completed.
      if (outcome === 'REPLACEMENT' || outcome === 'VALUE_CREDIT' || outcome === 'REFUND') {
        const code = outcome === 'REFUND' ? 'REFUNDED' : 'REPLACED';
        const why = outcome === 'REPLACEMENT' ? `Replaced under warranty by ${details.replacement as string}` : outcome === 'REFUND' ? 'Refunded under the legal guarantee' : 'Replaced under warranty by a credit of its value';
        await this.lifecycle.transition(product.id, 'REVOKED', { reason: why, revocationReasonCode: code }, actor, tx);
        await this.closeRecord(tx, c.service_record_id, actor);
        // Its identity closed, its warranty too (terms art. 11): MY PIECES no longer reads it as covered.
        const w = await tx.selectFrom('warranties').select('voided_at').where('product_id', '=', product.id).executeTakeFirst();
        if (!w?.voided_at) await this.warranty.void(product.id, why, actor, tx);
      }

      set.status = c.status === 'OPEN' || KEPT.includes(outcome) ? 'DONE' : 'DECIDED';
      if (set.status === 'DONE') set.done_at = decidedAt;
      try {
        await tx
          .updateTable('warranty_claims')
          .set({ ...set, outcome, refusal_reason: reason, decided_at: decidedAt, decided_by: by })
          .where('id', '=', c.id)
          .execute();
      } catch (e) {
        if (isUniqueViolation(e, 'warranty_claims_free_once')) throw claimFreeUsed();
        if (isUniqueViolation(e, 'warranty_claims_replacement_product_id_key')) throw replacementNotAllowed('This identity is already the replacement of another claim.');
        throw e;
      }
      return details;
    });
  }

  /**
   * SHIP (OPERATOR): the new piece, or the piece back, with its carrier and tracking → DONE. A replacement's identity
   * may be chosen again here (`replacementProductId`), checked as at the decision, when the one kept aside can no
   * longer be it.
   */
  async ship(id: string, input: { carrierId: unknown; tracking: unknown; replacementProductId?: unknown }, actor: Actor): Promise<ClaimSheet> {
    const tracking = cleanTracking(input?.tracking);
    const again = input?.replacementProductId ?? null;
    return this.step(id, ['DECIDED'], actor, 'warranty.claim.ship', async (tx, c, now) => {
      if (again !== null && c.outcome !== 'REPLACEMENT') throw validationError('A replacement’s identity is given with a replacement only.');
      const carrier = await this.activeCarrier(tx, input.carrierId);
      const at = notBefore(now, c.decided_at);
      const details: Record<string, unknown> = { carrierId: carrier, outcome: c.outcome };
      if (c.outcome === 'REPLACEMENT') {
        // The new piece: checked again (it stayed ISSUED since the decision), its warranty started today, of its own model's kind.
        let next: ProductRow;
        if (again === null) {
          next = await this.piece(tx, c.replacement_product_id!);
          await this.assertReplaceable(tx, next);
        } else {
          // Chosen again: of the claimed piece's SKU (or its model, the client having asked for another size), never sold.
          const claimed = await this.piece(tx, c.product_id);
          next = await this.replacementFor(tx, claimed, again, c.other_size === true, c.id);
          if (next.id !== c.replacement_product_id) {
            const before = await tx.selectFrom('products').select('product_id').where('id', '=', c.replacement_product_id!).executeTakeFirstOrThrow();
            await tx
              .updateTable('warranty_claims')
              .set({ replacement_product_id: next.id })
              .where('id', '=', c.id)
              .execute()
              .catch((e: unknown) => {
                if (isUniqueViolation(e, 'warranty_claims_replacement_product_id_key')) throw replacementNotAllowed('This identity is already the replacement of another claim.');
                throw e;
              });
            // The old piece's revocation, and its warranty's void reason, name the identity that replaces it.
            await tx
              .updateTable('revocations')
              .set({ reason: `Replaced under warranty by ${next.product_id}` })
              .where('target_type', '=', 'PRODUCT')
              .where('target_id', '=', claimed.product_id)
              .where('reason_code', '=', 'REPLACED')
              .where('lifted_at', 'is', null)
              .execute();
            await tx
              .updateTable('warranties')
              .set({ void_reason: `Replaced under warranty by ${next.product_id}`, updated_at: now })
              .where('product_id', '=', claimed.id)
              .where('void_reason', '=', `Replaced under warranty by ${before.product_id}`)
              .execute();
            details.replacedReplacement = before.product_id;
          }
        }
        const old = await tx.selectFrom('warranties').select('country').where('product_id', '=', c.product_id).executeTakeFirst();
        const started = await this.warranty.activate(next.id, { country: old?.country ?? null }, actor, { tx, via: { via: 'warranty_claim', claimId: c.id } });
        details.replacement = next.product_id;
        details.lifetime = started.warranty.lifetime;
      } else {
        // The piece back: its INSPECTION record completed, the piece back to its status.
        await this.closeRecord(tx, c.service_record_id, actor);
      }
      await tx
        .updateTable('warranty_claims')
        .set({ status: 'DONE', return_carrier_id: carrier, return_tracking: tracking, return_shipped_at: at, done_at: at })
        .where('id', '=', c.id)
        .execute();
      return details;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private staff(actor: Actor): string {
    const by = adminIdOf(actor);
    if (by === null) throw forbidden('Only ORBES Client Services handle warranty claims.');
    return by;
  }

  /** A staff step: the claim FOR UPDATE at one of `from`, the change, the audit entry; then the sheet read again. */
  private async step(
    id: string,
    from: readonly WarrantyClaimStatus[],
    actor: Actor,
    action: string,
    apply: (tx: Db, c: WarrantyClaimRow, now: Date, by: string) => Promise<Record<string, unknown>>,
  ): Promise<ClaimSheet> {
    const by = this.staff(actor);
    const cid = claimId(id);
    await inTransaction(this.db, async (tx) => {
      const c = await tx.selectFrom('warranty_claims').selectAll().where('id', '=', cid).forUpdate().executeTakeFirst();
      if (!c) throw claimNotFound();
      if (!from.includes(c.status)) throw claimStep();
      const details = await apply(tx, c, this.clock(), by);
      const p = await tx.selectFrom('products').select('product_id').where('id', '=', c.product_id).executeTakeFirstOrThrow();
      await this.audit.record({ actor, action, targetType: 'warranty_claim', targetId: cid, details: { claimId: cid, productId: p.product_id, ...details } }, tx);
    });
    return this.sheet(cid);
  }

  private async piece(tx: Db, productUuid: string): Promise<ProductRow> {
    const p = await findProduct(tx, productUuid, { forUpdate: true });
    if (!p) throw notFound('Product', 'PRODUCT_NOT_FOUND');
    return p;
  }

  /** The claim's INSPECTION record completed when still open (the piece takes back its status, unless revoked). */
  private async closeRecord(tx: Db, serviceId: string | null, actor: Actor): Promise<void> {
    if (!serviceId) return;
    const open = await tx.selectFrom('service_records').select('status').where('id', '=', serviceId).executeTakeFirst();
    if (open?.status === 'OPEN') await this.warranty.completeService(serviceId, { notes: null }, actor, tx);
  }

  /** The replacement's identity, FOR UPDATE: ISSUED, of the claimed piece's SKU (or of its model with `otherSize`), never sold. */
  private async replacementFor(tx: Db, claimed: ProductRow, ref: unknown, otherSize: boolean, claimId: string | null = null): Promise<ProductRow> {
    if (typeof ref !== 'string' || ref.trim() === '') throw validationError('Enter the ORBES identity of the replacement.');
    const next = await findProduct(tx, ref.trim(), { forUpdate: true });
    if (!next) throw notFound('Product', 'PRODUCT_NOT_FOUND');
    if (next.id === claimed.id) throw replacementNotAllowed('The replacement is another identity than the piece claimed.');
    const sameSku = claimed.sku_id === null && next.sku_id === null ? claimed.model_id === next.model_id && claimed.variant === next.variant : claimed.sku_id !== null && claimed.sku_id === next.sku_id;
    if (!sameSku) {
      if (next.model_id !== claimed.model_id) throw replacementNotAllowed('The replacement is a piece of the same model.', `model ${next.model_id}`);
      if (!otherSize) throw replacementNotAllowed('The replacement is another size: choose « Another size, as the client asked ».', `sku ${next.sku_id ?? 'none'}`);
    }
    const taken = await tx.selectFrom('warranty_claims').select('id').where('replacement_product_id', '=', next.id).executeTakeFirst();
    if (taken && taken.id !== claimId) throw replacementNotAllowed('This identity is already the replacement of another claim.');
    await this.assertReplaceable(tx, next);
    return next;
  }

  /** An identity a replacement may be: ISSUED, no ownership, no standing order, no warranty started nor voided. */
  private async assertReplaceable(tx: Db, next: ProductRow): Promise<void> {
    const no = (detail: string) => replacementNotAllowed('The replacement is an ISSUED identity never sold, registered nor bound to an order.', detail);
    if (next.status !== 'ISSUED') throw no(`status ${next.status}`);
    const owned = await tx.selectFrom('ownership').select('id').where('product_id', '=', next.id).executeTakeFirst();
    if (owned) throw no('an ownership');
    const order = await tx.selectFrom('orders').select('id').where('product_id', '=', next.id).where('status', 'in', [...SOLD_ORDER_STATUSES]).executeTakeFirst();
    if (order) throw no('an order');
    const w = await tx.selectFrom('warranties').select(['start_date', 'voided_at']).where('product_id', '=', next.id).executeTakeFirst();
    if (w?.start_date || w?.voided_at) throw no('a warranty started or voided');
  }

  private async activeCarrier(tx: Db, carrierId: unknown): Promise<string> {
    if (typeof carrierId !== 'string' || !UUID_RE.test(carrierId)) throw validationError('Choose a carrier.');
    const c = await tx.selectFrom('carriers').select(['id', 'active']).where('id', '=', carrierId.toLowerCase()).executeTakeFirst();
    if (!c || !c.active) throw validationError('Choose an active carrier.');
    return c.id;
  }
}

function claimRef(id: unknown, missing: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw missing();
  return id.toLowerCase();
}

