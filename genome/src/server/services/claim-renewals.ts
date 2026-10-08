/**
 * NEW CLAIM CODE (plan NEXT LOT of 2026-10-07, §3.4; migration 0034, table claim_code_renewals): a new claim code for a
 * piece not registered yet whose card was lost. A claim code is kept only as its scrypt hash (claim-codes.ts), so the
 * old one cannot be shown again: OPERATOR and ADMIN make a new one, and the old one stops working at once.
 *
 *   situation  what the console's piece page offers (`claimCode`), the rules in this order: a current ownership gives
 *              REGISTERED; no claim code (RESERVED included) NO_CLAIM_CODE; a status in NOT_PRINTABLE NOT_PRINTABLE; no
 *              ACTIVE code NO_ACTIVE_CODE (the card draws the ORBES CODE: re-issue it first); an open order SOLD; a sale
 *              outside an order SOLD_IN_STORE (its warranty started by a sale, with no order returned or cancelled
 *              with the piece since); anything else IN_STOCK (no buyer exists to send the code to).
 *   renew      IN_STOCK: the code is answered once, to the staff member who pressed, for its card to print (a STAFF row,
 *              SHOWN). SOLD: the code is sealed (AES-256-GCM, its own HKDF key) for the buyer of the piece's open order,
 *              who reads it once in YOUR ORDERS (a BUYER row, WAITING); staff never see it. SOLD_IN_STORE is refused
 *              (409 CLAIM_CODE_SOLD_IN_STORE: question 8 of the plan, answer (b), until the owner answers; its answer
 *              (a), a STAFF row shown to staff, is the constructor's `soldInStore: 'STAFF'`). The dialog's situation and
 *              the latest renewal it saw are sent back (`expect`, `after`): a piece sold, registered or given a new code
 *              meanwhile answers 409 CLAIM_CODE_SITUATION_CHANGED, so a code meant for a buyer is never shown to staff.
 *              A code still waiting is withdrawn (RENEWED_AGAIN): only the latest ever shows.
 *   reveal     the buyer's one reading (POST, no-store): READ, its sealed copy wiped; or 409 CLAIM_CODE_UNAVAILABLE, the
 *              row withdrawn when the piece's code changed since (SUPERSEDED), the piece was registered (REGISTERED) or
 *              the key no longer opens it (UNREADABLE); a piece not printable (LOST…) or an order not open leaves it
 *              waiting. The reading is final once the server has answered.
 *   newCard    the buyer's new 79t card (the plan's `buyerCard`; named so that the collector's routes never name a buyer), while the code is read, the order open and the piece unregistered and
 *              printable: through CertificateService, which checks the code against the hash.
 *   hooks      `withdrawOnCancel` (orders.ts `step()` CANCELLED, every cancellation): a current BUYER code (WAITING or
 *              READ) is replaced by an UNSHOWN code nobody sees, so a code the ex-buyer read stops working too, and the
 *              piece reads "no card registers this piece" (`cardNeeded`); `withdrawWaiting` (a return, a registration).
 *
 * Lock order: the piece, then its order, then the renewal rows (as returns and registrations); scrypt runs before the
 * transaction. No code, sealed or clear, ever reaches an audit entry, an event, a journal line, a log or an error.
 * Audited `claim_code.renew`, `claim_code.read` (by the account) and `claim_code.withdraw`, each targeting the piece.
 */
import { randomUUID } from 'node:crypto';
import { fromBase64Url, utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey, openText, seal, SecretboxError } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import type { ClaimCodeRenewalRow as ClaimRenewalRow, ClaimRenewalKind, ClaimRenewalStatus, ClaimRenewalWithdrawnReason, OrderRow, OrderStatus, ProductRow } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import type { CertificateService } from './certificates.js';
import { generateClaimCode, hashClaimCode } from './claim-codes.js';
import type { RenderedCertificates } from '../render/certificate.js';
import { NOT_PRINTABLE } from './issuance.js';
import { requireProduct } from './lifecycle.js';
import { orderReference } from './orders.js';
import { readActingAccount } from './ownership.js';

/** HKDF `info` of the key that seals a buyer's new claim code (plan NEXT LOT §1.1 (f)). */
export const CLAIM_REVEAL_KEY_INFO = 'orbes/claim-code-reveal/v1';
/** The staff member's reason: 1 to 500 characters once trimmed (claim_code_renewals_reason_check). */
export const CLAIM_RENEWAL_REASON_MAX = 500;

/** The steps of an order that hold its piece for its buyer (orders_product_key): RESERVED, PAID, SHIPPED, DELIVERED. */
const OPEN_ORDER_STATUSES: readonly OrderStatus[] = Object.freeze(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED']);

/** Whom a new claim code is made for: a piece with no buyer, a sold piece's buyer, a piece sold outside an order. */
export const CLAIM_SITUATIONS = ['IN_STOCK', 'SOLD', 'SOLD_IN_STORE'] as const;
export type ClaimSituation = (typeof CLAIM_SITUATIONS)[number];

/** Why New claim code is not offered for a piece. */
export type ClaimRefusal = 'REGISTERED' | 'NO_CLAIM_CODE' | 'NOT_PRINTABLE' | 'NO_ACTIVE_CODE' | 'SOLD_IN_STORE';

/**
 * Question 8 of the plan: a piece sold outside an order (the sale mode, a warranty started by hand). 'REFUSE' (answer
 * (b), built until the owner answers): staff never see a code a buyer is owed. 'STAFF' (answer (a)): shown once to staff.
 */
export type SoldInStoreRule = 'REFUSE' | 'STAFF';

/** HKDF-SHA256 key that seals a buyer's new claim code, from KEY_ENCRYPTION_KEY or COOKIE_SECRET (as the TOTP seeds'). */
export function deriveClaimRevealKey(config: Pick<AppConfig, 'keys' | 'cookieSecret'>): Uint8Array {
  const ikm = config.keys.encryptionKey ? fromBase64Url(config.keys.encryptionKey) : utf8(config.cookieSecret);
  return deriveSubkey(ikm, CLAIM_REVEAL_KEY_INFO, { salt: 'ORBES' });
}

/** The AAD that binds a sealed code to its own row. */
export const claimRevealAad = (r: { id: string; order_id: string | null; account_id: string | null }) => `claim-renewal:${r.id}:${r.order_id ?? ''}:${r.account_id ?? ''}`;

/** One new claim code as the console lists it (`New claim codes`): never its code, sealed or clear. */
export interface ClaimRenewalRecord {
  id: string;
  at: Date;
  /** The staff member's email; null for the system. */
  by: string | null;
  kind: ClaimRenewalKind;
  order: { id: string; reference: string } | null;
  status: ClaimRenewalStatus;
  readAt: Date | null;
  withdrawnAt: Date | null;
  withdrawnReason: ClaimRenewalWithdrawnReason | null;
  reason: string | null;
}

/** The piece page's `claimCode` (GET /api/admin/products/:productId). */
export interface ClaimCodeSituation {
  renewable: ClaimSituation | null;
  refusal: ClaimRefusal | null;
  /** The piece's open order. */
  order: { id: string; reference: string } | null;
  /** The newest renewal (the dialog sends it back as `after`). */
  lastRenewalId: string | null;
  /** The piece's current code is an UNSHOWN one: no card registers it (its order was cancelled). */
  cardNeeded: boolean;
  /** Newest first. */
  renewals: ClaimRenewalRecord[];
}

/** The order page's `claimCode` (GET /api/admin/orders/:id): the order's newest buyer code, never the code. */
export interface OrderClaimCode {
  status: ClaimRenewalStatus;
  madeAt: Date;
  readAt: Date | null;
  withdrawnAt: Date | null;
  withdrawnReason: ClaimRenewalWithdrawnReason | null;
  /** No card registers the piece: its current code is the UNSHOWN one made when this or another order was cancelled. */
  cardNeeded: boolean;
  /** The order of that UNSHOWN code, when `cardNeeded`. */
  cardNeededOrder: { id: string; reference: string } | null;
}

/** An order's `claimCode` in YOUR ORDERS: status and date only, never the code. */
export interface AccountOrderClaimCode {
  status: 'WAITING';
  madeAt: Date;
}

/** What `renew` answers: the code itself only when it is shown to staff. */
export interface ClaimRenewal {
  claimCode?: string;
  renewal: ClaimRenewalRecord;
}

export interface ClaimRenewInput {
  reason: unknown;
  expect: unknown;
  after: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Errors ─────────────────────────────────────────────────────────────────

const NO_ACTIVE_CODE_MESSAGE = 'This piece has no active code: re-issue its code first, then make a new claim code.';
export const claimSituationChanged = () =>
  conflict('CLAIM_CODE_SITUATION_CHANGED', 'This piece changed meanwhile (sold, registered or given a new claim code). Reload its page and try again.');
export const claimCodeUnavailable = () => conflict('CLAIM_CODE_UNAVAILABLE', 'This claim code can no longer be shown. ORBES Client Services can assist you.');
export const claimCardUnavailable = () => conflict('CLAIM_CARD_UNAVAILABLE', 'Your new card can no longer be saved here. ORBES Client Services can assist you.');
const soldInStore = () => conflict('CLAIM_CODE_SOLD_IN_STORE', 'This piece was sold at a point of sale: a new claim code is not made for it.');
export const orderChanged = () => conflict('ORDER_CHANGED', 'The order changed meanwhile. Try again.');
const orderNotFound = () => notFound('Order', 'ORDER_NOT_FOUND');

/** The refusal's own error, as `renew` answers it. */
function refusalError(r: ClaimRefusal): DomainError {
  switch (r) {
    case 'REGISTERED':
      return new DomainError('ALREADY_REGISTERED', 409, 'This piece is registered to its owner: its claim code has been used.');
    case 'NO_CLAIM_CODE':
      return new DomainError('NO_CLAIM_SECRET', 422, 'This piece was issued without a claim code.');
    case 'NOT_PRINTABLE':
      return new DomainError('PRODUCT_NOT_PRINTABLE', 409, 'No certificate card can be printed for this piece in its current state.');
    case 'NO_ACTIVE_CODE':
      return conflict('NO_ACTIVE_CODE', NO_ACTIVE_CODE_MESSAGE);
    case 'SOLD_IN_STORE':
      return soldInStore();
  }
}

// ── Reads (any connection or transaction) ──────────────────────────────────

/** The piece's open order (RESERVED, PAID, SHIPPED or DELIVERED), at most one (orders_product_key). */
async function openOrderOf(db: Db, productUuid: string, opts: { forUpdate?: boolean } = {}): Promise<OrderRow | undefined> {
  let q = db.selectFrom('orders').selectAll().where('product_id', '=', productUuid).where('status', 'in', OPEN_ORDER_STATUSES);
  if (opts.forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

async function isRegistered(db: Db, productUuid: string): Promise<boolean> {
  return (await db.selectFrom('ownership').select('id').where('product_id', '=', productUuid).where('ended_at', 'is', null).executeTakeFirst()) !== undefined;
}

/**
 * A piece sold outside an order (rule 5): its warranty started, its latest activation a sale (not SHIP's, `via:
 * 'ship'`), and since that activation no order of it RETURNED, nor CANCELLED with the piece bound to it. The caller has
 * already found no open order. A started warranty alone is not a sale: a piece back in stock keeps it.
 */
async function soldOutsideOrder(db: Db, p: ProductRow): Promise<boolean> {
  const w = await db.selectFrom('warranties').select(['start_date', 'updated_at']).where('product_id', '=', p.id).executeTakeFirst();
  if (!w?.start_date) return false;
  const activation = await db
    .selectFrom('audit_logs')
    .select(['occurred_at', 'details'])
    .where('target_type', '=', 'product')
    .where('target_id', '=', p.product_id)
    .where('action', '=', 'warranty.activate')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (activation && (activation.details as { via?: unknown } | null)?.via === 'ship') return false;
  const since = activation?.occurred_at ?? w.updated_at;
  const ended = await db
    .selectFrom('orders')
    .select('id')
    .where('product_id', '=', p.id)
    .where((eb) => eb.or([eb.and([eb('status', '=', 'RETURNED'), eb('returned_at', '>=', since)]), eb.and([eb('status', '=', 'CANCELLED'), eb('cancelled_at', '>=', since)])]))
    .executeTakeFirst();
  return ended === undefined;
}

/** The situation's rules 1 to 6 (§3.4.6), on the piece as `db` reads it. */
async function judge(db: Db, p: ProductRow, rule: SoldInStoreRule): Promise<{ renewable: ClaimSituation | null; refusal: ClaimRefusal | null; order: OrderRow | undefined }> {
  const refused = (refusal: ClaimRefusal) => ({ renewable: null, refusal, order: undefined });
  if (await isRegistered(db, p.id)) return refused('REGISTERED');
  if (p.claim_secret_hash === null) return refused('NO_CLAIM_CODE');
  if (NOT_PRINTABLE.has(p.status)) return refused('NOT_PRINTABLE');
  const active = await db.selectFrom('codes').select('id').where('product_id', '=', p.id).where('status', '=', 'ACTIVE').executeTakeFirst();
  if (!active) return refused('NO_ACTIVE_CODE');
  const order = await openOrderOf(db, p.id);
  if (order) return { renewable: 'SOLD', refusal: null, order };
  if (await soldOutsideOrder(db, p)) return rule === 'STAFF' ? { renewable: 'SOLD_IN_STORE', refusal: null, order: undefined } : refused('SOLD_IN_STORE');
  return { renewable: 'IN_STOCK', refusal: null, order: undefined };
}

/** A piece's renewals, newest first, with their authors' emails. */
async function renewalsOf(db: Db, productUuid: string): Promise<(ClaimRenewalRow & { email: string | null })[]> {
  return db
    .selectFrom('claim_code_renewals as r')
    .leftJoin('admin_users as a', 'a.id', 'r.created_by')
    .selectAll('r')
    .select('a.email')
    .where('r.product_id', '=', productUuid)
    .orderBy('r.created_at', 'desc')
    .orderBy('r.id', 'desc')
    .execute();
}

function recordOf(r: ClaimRenewalRow & { email?: string | null }): ClaimRenewalRecord {
  return {
    id: r.id,
    at: r.created_at,
    by: r.email ?? null,
    kind: r.kind,
    order: r.order_id ? { id: r.order_id, reference: orderReference(r.order_id) } : null,
    status: r.status,
    readAt: r.read_at,
    withdrawnAt: r.withdrawn_at,
    withdrawnReason: r.withdrawn_reason,
    reason: r.reason,
  };
}

/** The order page's `claimCode`: the order's newest BUYER code, and whether no card registers its piece. Null without one. */
export async function orderClaimCode(db: Db, orderId: string): Promise<OrderClaimCode | null> {
  const r = await db
    .selectFrom('claim_code_renewals')
    .selectAll()
    .where('order_id', '=', orderId)
    .where('kind', '=', 'BUYER')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!r) return null;
  const current = await db
    .selectFrom('claim_code_renewals as c')
    .innerJoin('products as p', (j) => j.onRef('p.id', '=', 'c.product_id').onRef('p.claim_secret_hash', '=', 'c.claim_hash'))
    .select(['c.kind', 'c.order_id'])
    .where('c.product_id', '=', r.product_id)
    .executeTakeFirst();
  const cardNeeded = current?.kind === 'UNSHOWN';
  return {
    status: r.status,
    madeAt: r.created_at,
    readAt: r.read_at,
    withdrawnAt: r.withdrawn_at,
    withdrawnReason: r.withdrawn_reason,
    cardNeeded,
    cardNeededOrder: cardNeeded && current?.order_id ? { id: current.order_id, reference: orderReference(current.order_id) } : null,
  };
}

/**
 * The orders of an account whose buyer's new claim code waits (YOUR ORDERS' `claimCode`): a WAITING row for the order and
 * the account, still the piece's code, the order open, the piece unregistered and printable. A code a lifecycle change
 * hides (LOST, for example) shows again once the piece is back: nothing is withdrawn for it.
 */
export async function waitingClaimCodes(db: Db, accountId: string, orderIds?: readonly string[]): Promise<Map<string, AccountOrderClaimCode>> {
  if (orderIds && orderIds.length === 0) return new Map();
  let q = db
    .selectFrom('claim_code_renewals as r')
    .innerJoin('products as p', (j) => j.onRef('p.id', '=', 'r.product_id').onRef('p.claim_secret_hash', '=', 'r.claim_hash'))
    .innerJoin('orders as o', (j) => j.onRef('o.id', '=', 'r.order_id').onRef('o.account_id', '=', 'r.account_id'))
    .select(['r.order_id', 'r.created_at'])
    .where('r.account_id', '=', accountId)
    .where('r.status', '=', 'WAITING')
    .where('o.status', 'in', OPEN_ORDER_STATUSES)
    .where('p.status', 'not in', [...NOT_PRINTABLE])
    .where((eb) => eb.not(eb.exists(eb.selectFrom('ownership as w').select('w.id').whereRef('w.product_id', '=', 'r.product_id').where('w.ended_at', 'is', null))));
  if (orderIds) q = q.where('r.order_id', 'in', [...orderIds]);
  const rows = await q.execute();
  return new Map(rows.map((r) => [r.order_id!, { status: 'WAITING' as const, madeAt: r.created_at }]));
}

// ── Hooks (inside the caller's transaction) ─────────────────────────────────

/**
 * The fresh hashes an order cancellation needs (`step()` CANCELLED), made before its transaction (scrypt never runs under
 * the locks): one per piece of `orderIds` whose current code is a buyer's (WAITING or READ), of a code nobody ever sees.
 * The caller locks those pieces first, before the orders.
 */
export async function peekClaimRenewals(db: Db, orderIds: readonly string[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('claim_code_renewals as r')
    .innerJoin('products as p', (j) => j.onRef('p.id', '=', 'r.product_id').onRef('p.claim_secret_hash', '=', 'r.claim_hash'))
    .select('r.product_id')
    .where('r.order_id', 'in', [...orderIds])
    .where('r.kind', '=', 'BUYER')
    .where('r.status', 'in', ['WAITING', 'READ'])
    .execute();
  const hashes = new Map<string, string>();
  for (const r of rows) if (!hashes.has(r.product_id)) hashes.set(r.product_id, await hashClaimCode(generateClaimCode()));
  return hashes;
}

/** Lock pieces FOR UPDATE in id order (before their orders: the lock order of returns and registrations). */
export async function lockPieces(tx: Db, productUuids: Iterable<string>): Promise<void> {
  const ids = [...new Set(productUuids)].sort();
  if (ids.length) await tx.selectFrom('products').select('id').where('id', 'in', ids).orderBy('id').forUpdate().execute();
}

/**
 * An order moved to CANCELLED (`step()`): its waiting buyer code is withdrawn (ORDER_CANCELLED, its sealed copy wiped);
 * when the piece's current code is that buyer's (WAITING or READ), an UNSHOWN code replaces it, its fresh hash taken from
 * `claimHashes` (prepared before the transaction, `peekClaimRenewals`), so a code the ex-buyer read stops working too;
 * 409 ORDER_CHANGED when none was prepared for it. A READ row stays READ: its reading is history. Audited
 * `claim_code.withdraw` (returned in `notes`).
 */
export async function withdrawOnCancel(tx: Db, order: OrderRow, claimHashes: ReadonlyMap<string, string>, actor: Actor, now: Date, notes: AuditRecordInput[]): Promise<void> {
  const rows = await tx
    .selectFrom('claim_code_renewals as r')
    .innerJoin('products as p', 'p.id', 'r.product_id')
    .selectAll('r')
    .select(['p.product_id as piece', 'p.claim_secret_hash'])
    .where('r.order_id', '=', order.id)
    .where('r.kind', '=', 'BUYER')
    .where('r.status', 'in', ['WAITING', 'READ'])
    .orderBy('r.created_at')
    .orderBy('r.id')
    .execute();
  if (rows.length === 0) return;
  const current = rows.filter((r) => r.claim_hash === r.claim_secret_hash);
  for (const r of current) if (!claimHashes.has(r.product_id)) throw orderChanged();
  await tx.selectFrom('claim_code_renewals').select('id').where('id', 'in', rows.map((r) => r.id)).forUpdate().execute();
  for (const r of rows) {
    const isCurrent = r.claim_hash === r.claim_secret_hash;
    if (r.status === 'WAITING') {
      await tx
        .updateTable('claim_code_renewals')
        .set({ status: 'WITHDRAWN', withdrawn_at: now, withdrawn_reason: 'ORDER_CANCELLED', sealed_code: null })
        .where('id', '=', r.id)
        .execute();
    }
    let unshownRenewalId: string | null = null;
    if (isCurrent) {
      const hash = claimHashes.get(r.product_id)!;
      unshownRenewalId = (
        await tx
          .insertInto('claim_code_renewals')
          .values({
            product_id: r.product_id,
            kind: 'UNSHOWN',
            status: 'UNSHOWN',
            order_id: order.id,
            claim_hash: hash,
            created_by: actor.type === 'admin' ? actor.id! : null,
            created_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await tx.updateTable('products').set({ claim_secret_hash: hash, updated_at: now }).where('id', '=', r.product_id).execute();
    }
    if (r.status === 'WAITING' || unshownRenewalId) {
      notes.push({
        actor,
        action: 'claim_code.withdraw',
        targetType: 'product',
        targetId: r.piece,
        details: { renewalId: r.id, reason: 'order_cancelled', orderId: order.id, ...(unshownRenewalId ? { unshownRenewalId } : {}) },
      });
    }
  }
}

/**
 * A piece's waiting buyer code withdrawn (a return: ORDER_RETURNED; a registration: REGISTERED, a safety net, a reading
 * normally comes first), its sealed copy wiped; its piece held by the caller. Returns the audit entries to write.
 */
export async function withdrawWaiting(tx: Db, productUuid: string, reason: 'ORDER_RETURNED' | 'REGISTERED', actor: Actor, now: Date): Promise<AuditRecordInput[]> {
  const rows = await tx
    .updateTable('claim_code_renewals')
    .set({ status: 'WITHDRAWN', withdrawn_at: now, withdrawn_reason: reason, sealed_code: null })
    .where('product_id', '=', productUuid)
    .where('status', '=', 'WAITING')
    .returning(['id', 'order_id'])
    .execute();
  if (rows.length === 0) return [];
  const piece = await tx.selectFrom('products').select('product_id').where('id', '=', productUuid).executeTakeFirstOrThrow();
  return rows.map((r) => ({
    actor,
    action: 'claim_code.withdraw',
    targetType: 'product',
    targetId: piece.product_id,
    details: { renewalId: r.id, reason: reason.toLowerCase(), orderId: r.order_id },
  }));
}

/** The latest renewal of a piece, for the claim-code attempt count (ownership.ts checkClaimCode): failures count since it. */
export async function latestRenewalAt(db: Db, productUuid: string): Promise<Date | null> {
  const r = await db.selectFrom('claim_code_renewals').select('created_at').where('product_id', '=', productUuid).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  return r?.created_at ?? null;
}

/** Every new claim code made for the account's orders (its export, the right of access): dates and statuses, never the code. */
export async function accountClaimCodes(db: Db, accountId: string): Promise<{ order: string; madeAt: Date; status: ClaimRenewalStatus; readAt: Date | null }[]> {
  const rows = await db
    .selectFrom('claim_code_renewals')
    .select(['order_id', 'created_at', 'status', 'read_at'])
    .where('account_id', '=', accountId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ order: orderReference(r.order_id!), madeAt: r.created_at, status: r.status, readAt: r.read_at }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface ClaimRenewalServiceDeps {
  db: Db;
  audit: AuditService;
  /** The buyer's card (79t), drawn after the claim code is checked against the piece's hash. */
  certificates: Pick<CertificateService, 'render'>;
  /** 32-byte key sealing a buyer's code (deriveClaimRevealKey). */
  revealKey: Uint8Array;
  clock?: Clock;
  /** Question 8 (a piece sold outside an order): 'REFUSE' until the owner answers. */
  soldInStore?: SoldInStoreRule;
}

function assertOperator(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES Client Services makes a new claim code.');
}

function assertAccount(accountId: unknown): asserts accountId is string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw forbidden();
}

function knownOrder(orderId: unknown): string {
  if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) throw orderNotFound();
  return orderId.toLowerCase();
}

function cleanRenewReason(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError('A reason is required.');
  const s = v.trim();
  if (s.length > CLAIM_RENEWAL_REASON_MAX) throw validationError(`The reason has at most ${CLAIM_RENEWAL_REASON_MAX} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) throw validationError('The reason contains invalid characters.');
  return s;
}

export class ClaimRenewalService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly certificates: Pick<CertificateService, 'render'>;
  private readonly revealKey: Uint8Array;
  private readonly clock: Clock;
  private readonly soldInStore: SoldInStoreRule;

  constructor(deps: ClaimRenewalServiceDeps) {
    if (!(deps.revealKey instanceof Uint8Array) || deps.revealKey.length !== 32) throw new RangeError('revealKey must be 32 bytes');
    this.db = deps.db;
    this.audit = deps.audit;
    this.certificates = deps.certificates;
    this.revealKey = deps.revealKey;
    this.clock = deps.clock ?? systemClock;
    this.soldInStore = deps.soldInStore ?? 'REFUSE';
  }

  /** The piece page's `claimCode` (404 PRODUCT_NOT_FOUND): what New claim code may do, and the piece's renewals. */
  async situation(productRef: string): Promise<ClaimCodeSituation> {
    const p = await requireProduct(this.db, productRef);
    const s = await judge(this.db, p, this.soldInStore);
    const rows = await renewalsOf(this.db, p.id);
    const current = rows.find((r) => r.claim_hash === p.claim_secret_hash);
    return {
      renewable: s.renewable,
      refusal: s.refusal,
      order: s.order ? { id: s.order.id, reference: orderReference(s.order.id) } : null,
      lastRenewalId: rows[0]?.id ?? null,
      cardNeeded: current?.kind === 'UNSHOWN',
      renewals: rows.map(recordOf),
    };
  }

  /**
   * NEW CLAIM CODE (OPERATOR). `expect` is the situation the dialog showed, `after` the newest renewal it saw (null for
   * none). IN_STOCK (and SOLD_IN_STORE with answer (a)): `{ claimCode, renewal }`, the code shown once. SOLD:
   * `{ renewal }`, the code sealed for the buyer. The old code stops at once (a registration under way gets 409
   * REGISTRATION_CONFLICT).
   */
  async renew(productRef: string, input: ClaimRenewInput, actor: Actor): Promise<ClaimRenewal> {
    assertOperator(actor);
    const reason = cleanRenewReason(input?.reason);
    const expect = input?.expect;
    if (typeof expect !== 'string' || !(CLAIM_SITUATIONS as readonly string[]).includes(expect)) throw validationError('Unknown situation.');
    const after = input?.after ?? null;
    if (after !== null && (typeof after !== 'string' || !UUID_RE.test(after))) throw validationError('Unknown renewal.');
    // The new code and its hash before the transaction: scrypt never runs under the locks.
    const code = generateClaimCode();
    const hash = await hashClaimCode(code);
    const r = await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // The piece, then its open order (as returns and registrations).
      const p = await requireProduct(tx, productRef, { forUpdate: true });
      await openOrderOf(tx, p.id, { forUpdate: true });
      const s = await judge(tx, p, this.soldInStore);
      if (s.refusal) throw refusalError(s.refusal);
      const latest = await tx.selectFrom('claim_code_renewals').select('id').where('product_id', '=', p.id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
      if (s.renewable !== expect || (latest?.id ?? null) !== (after === null ? null : (after as string).toLowerCase())) throw claimSituationChanged();
      const notes: AuditRecordInput[] = [];
      // A code still waiting is withdrawn: only the latest ever shows.
      const replaced = await tx
        .updateTable('claim_code_renewals')
        .set({ status: 'WITHDRAWN', withdrawn_at: now, withdrawn_reason: 'RENEWED_AGAIN', sealed_code: null })
        .where('product_id', '=', p.id)
        .where('status', '=', 'WAITING')
        .returning(['id', 'order_id'])
        .executeTakeFirst();
      const id = randomUUID();
      const forBuyer = s.renewable === 'SOLD';
      const order = s.order;
      const row = await tx
        .insertInto('claim_code_renewals')
        .values({
          id,
          product_id: p.id,
          kind: forBuyer ? 'BUYER' : 'STAFF',
          status: forBuyer ? 'WAITING' : 'SHOWN',
          order_id: forBuyer ? order!.id : null,
          account_id: forBuyer ? order!.account_id : null,
          claim_hash: hash,
          sealed_code: forBuyer ? seal(this.revealKey, code, claimRevealAad({ id, order_id: order!.id, account_id: order!.account_id })) : null,
          reason,
          created_by: actor.id!,
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx.updateTable('products').set({ claim_secret_hash: hash, updated_at: now }).where('id', '=', p.id).execute();
      notes.push({
        actor,
        action: 'claim_code.renew',
        targetType: 'product',
        targetId: p.product_id,
        details: {
          renewalId: id,
          for: forBuyer ? 'BUYER' : 'STAFF',
          ...(forBuyer ? { orderId: order!.id, accountId: order!.account_id } : {}),
          ...(s.renewable === 'SOLD_IN_STORE' ? { soldInStore: true } : {}),
          reason,
          ...(replaced ? { replacedRenewalId: replaced.id } : {}),
        },
      });
      if (replaced) {
        notes.push({ actor, action: 'claim_code.withdraw', targetType: 'product', targetId: p.product_id, details: { renewalId: replaced.id, reason: 'renewed_again', orderId: replaced.order_id } });
      }
      for (const n of notes) await this.audit.record(n, tx);
      const email = (await tx.selectFrom('admin_users').select('email').where('id', '=', actor.id!).executeTakeFirst())?.email ?? null;
      return { renewal: recordOf({ ...row, email }), shown: !forBuyer };
    });
    return r.shown ? { claimCode: code, renewal: r.renewal } : { renewal: r.renewal };
  }

  /** YOUR ORDERS' `claimCode` of each order of the account: status and date only. */
  async forOrders(accountId: string): Promise<Map<string, AccountOrderClaimCode>> {
    assertAccount(accountId);
    return waitingClaimCodes(this.db, accountId.toLowerCase());
  }

  /**
   * The buyer's one reading of their new claim code (SHOW THE CODE): `{ claimCode, productId }`. 403 ACCOUNT_LOCKED; 404
   * ORDER_NOT_FOUND for another account's order or an unknown one; 409 CLAIM_CODE_UNAVAILABLE when nothing waits or it
   * can no longer be shown (the row withdrawn: SUPERSEDED, REGISTERED, UNREADABLE; left waiting for a piece not printable
   * or an order not open). Final once answered: the sealed copy is wiped.
   */
  async reveal(accountId: string, orderId: string, actor: Actor): Promise<{ claimCode: string; productId: string }> {
    assertAccount(accountId);
    const account = accountId.toLowerCase();
    const id = knownOrder(orderId);
    const peek = await this.db.selectFrom('orders').select(['id', 'product_id']).where('id', '=', id).where('account_id', '=', account).executeTakeFirst();
    if (!peek) throw orderNotFound();
    const outcome = await inTransaction(this.db, async (tx): Promise<{ ok: true; code: string; productId: string } | { ok: false }> => {
      const now = this.clock();
      // The account first (a LOCKED account waits for an unlock: its code keeps waiting), then the piece, the order, the row.
      await readActingAccount(tx, account);
      if (peek.product_id === null) return { ok: false };
      const p = await requireProduct(tx, peek.product_id, { forUpdate: true });
      const o = await tx.selectFrom('orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!o || o.account_id !== account) throw orderNotFound();
      if (o.product_id !== p.id) return { ok: false };
      const row = await tx
        .selectFrom('claim_code_renewals')
        .selectAll()
        .where('order_id', '=', id)
        .where('account_id', '=', account)
        .where('status', '=', 'WAITING')
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.product_id !== p.id) return { ok: false };
      const withdraw = async (reason: ClaimRenewalWithdrawnReason) => {
        await tx.updateTable('claim_code_renewals').set({ status: 'WITHDRAWN', withdrawn_at: now, withdrawn_reason: reason, sealed_code: null }).where('id', '=', row.id).execute();
        await this.audit.record({ actor, action: 'claim_code.withdraw', targetType: 'product', targetId: p.product_id, details: { renewalId: row.id, reason: reason.toLowerCase(), orderId: id } }, tx);
        return { ok: false as const };
      };
      if (row.claim_hash !== p.claim_secret_hash) return withdraw('SUPERSEDED');
      if (await isRegistered(tx, p.id)) return withdraw('REGISTERED');
      // A lifecycle change (LOST…) or an order not open leaves it waiting: it shows again once the piece is back, and a
      // cancellation or a return withdraws it through its own hook.
      if (NOT_PRINTABLE.has(p.status) || !OPEN_ORDER_STATUSES.includes(o.status)) return { ok: false };
      let code: string;
      try {
        code = openText(this.revealKey, row.sealed_code!, claimRevealAad(row));
      } catch (e) {
        if (e instanceof SecretboxError) return withdraw('UNREADABLE');
        throw e;
      }
      await tx.updateTable('claim_code_renewals').set({ status: 'READ', read_at: now, sealed_code: null }).where('id', '=', row.id).execute();
      await this.audit.record({ actor, action: 'claim_code.read', targetType: 'product', targetId: p.product_id, details: { renewalId: row.id, orderId: id } }, tx);
      return { ok: true, code, productId: p.product_id };
    });
    if (!outcome.ok) throw claimCodeUnavailable();
    return { claimCode: outcome.code, productId: outcome.productId };
  }

  /**
   * The buyer's new certificate card (SAVE YOUR NEW CARD): the 79t card, one page, through CertificateService (the code
   * checked against the hash: 422 CLAIM_CODE_MISMATCH; one render at a time per account: 429 RATE_LIMITED), audited
   * `certificate.render` with `{ orderId, by: 'buyer' }`. Only while the order's newest buyer code is READ and still the
   * piece's, the order open, the piece unregistered and printable: 409 CLAIM_CARD_UNAVAILABLE otherwise.
   */
  async newCard(accountId: string, orderId: string, claimCode: unknown, actor: Actor): Promise<RenderedCertificates> {
    assertAccount(accountId);
    const account = accountId.toLowerCase();
    const id = knownOrder(orderId);
    if (typeof claimCode !== 'string' || claimCode.trim() === '') throw validationError('The claim code is required.');
    const o = await this.db.selectFrom('orders').select(['id', 'status', 'product_id']).where('id', '=', id).where('account_id', '=', account).executeTakeFirst();
    if (!o) throw orderNotFound();
    await readActingAccount(this.db, account);
    if (o.product_id === null || !OPEN_ORDER_STATUSES.includes(o.status)) throw claimCardUnavailable();
    const p = await requireProduct(this.db, o.product_id);
    const row = await this.db
      .selectFrom('claim_code_renewals')
      .select(['status', 'claim_hash'])
      .where('order_id', '=', id)
      .where('account_id', '=', account)
      .where('kind', '=', 'BUYER')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row || row.status !== 'READ' || row.claim_hash !== p.claim_secret_hash || NOT_PRINTABLE.has(p.status) || (await isRegistered(this.db, p.id))) throw claimCardUnavailable();
    return this.certificates.render([{ productId: p.product_id, claimCode }], { format: 'pdf', layout: 'card', context: { orderId: id, by: 'buyer' } }, actor);
  }
}
