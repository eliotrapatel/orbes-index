/**
 * OwnershipService — first registration, transfers, confirmation and
 * incident reports, and their withdrawal by the owner (contract §2.7).
 *
 * Ownership is bookkeeping about a product; it never touches cryptographic
 * identity (products' identity columns, genomes and codes are untouched).
 *
 * Guards, all enforced inside one transaction with the product row locked:
 * - First registration needs a fresh single-use scan token bound to the
 *   product (minted by a successful verification) and, when the product
 *   ships with a claim secret, the matching claim code. Claim-code attempts
 *   are limited to 5 failures per product per rolling hour (then 429); the
 *   failures are recorded as audit entries, so the limit holds across server
 *   instances and restarts, and attempts are serialised per product so it
 *   is exact under concurrency.
 * - One current owner per product (also a partial UNIQUE index) and one
 *   pending transfer per product (likewise).
 * - Only the current owner can start, cancel or report, and withdraw a loss
 *   they reported themselves (a theft stays with ORBES Client Services); the
 *   recipient of a transfer cannot be the current owner; expired transfers
 *   cannot be accepted.
 * - A transfer is accepted for the piece the recipient scanned (F-03): the
 *   code must be that piece's (409 TRANSFER_PRODUCT_MISMATCH otherwise, which
 *   names no piece), and the TRANSFER_ACCEPT token of the recipient's scan of
 *   it is used up in the acceptance's transaction, for that piece and that
 *   account, so no transfer completes without a scan of the piece it hands
 *   over. `requireScannedPiece` false (TRANSFER_ACCEPT_REQUIRE_PRODUCT=false)
 *   makes both optional, for an acceptance assisted by ORBES Client Services;
 *   whichever is given is still checked.
 *
 * Transfer codes are 12 Crockford base32 characters (60 bits), shown once
 * as XXXX-XXXX-XXXX; only HMAC-SHA256 of the canonical form under a server
 * key (HKDF from COOKIE_SECRET, info `orbes/transfer-code/v1`) is stored: a
 * deterministic value is needed to look the transfer up, and the key keeps a
 * leaked table from being brute-forced offline.
 *
 * Error messages are public (account routes) and never reveal internal
 * product statuses.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { utf8 } from '../../core/bytes.js';
import type { AppConfig } from '../config.js';
import { deriveSubkey } from '../crypto/secretbox.js';
import { inTransaction, type Db } from '../db/connection.js';
import type { AccountStatus, AcquiredVia, OwnershipRow, OwnershipState, OwnershipTransferRow, ProductRow, ProductStatus, TransferStatus } from '../db/schema.js';
import { DomainError, forbidden, notFound, tooManyRequests, validationError } from '../errors.js';
import { systemClock, SYSTEM_ACTOR, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { formatGrouped, normalizeClaimCode, normalizeCrockford, randomCrockford, verifyClaimCode } from './claim-codes.js';
import { findProduct, loadStatusHistory, requireProduct, returnTargetOf, TRANSITIONS, type LifecycleService, type StatusChange } from './lifecycle.js';
import { mediaUrl } from './media.js';
import { consumeScanToken, inspectScanToken, TRANSFER_TOKEN_TTL_MS, type ScanTokenFailure, type ScanTokenResult } from './scan-tokens.js';
import { computeWarrantyStatus, utcDate, type WarrantySummary } from './warranty.js';

export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TRANSFER_CODE_LENGTH = 12;
export const CLAIM_ATTEMPT_LIMIT = 5;
export const CLAIM_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
/** Audit action whose entries count towards the claim-code attempt limit. */
export const CLAIM_FAILED_ACTION = 'ownership.claim_failed';

/**
 * Statuses in which an unowned product can be registered (same set as verification step 10), except a
 * SERVICED piece whose service started before sale (ISSUED → SERVICED, see LifecycleService.isPreSaleService).
 */
export const REGISTRABLE_STATUSES: readonly ProductStatus[] = Object.freeze(['ACTIVATED', 'RESOLD', 'SERVICED']);
/** Statuses in which an owner can hand a product over. */
export const TRANSFERABLE_STATUSES: readonly ProductStatus[] = Object.freeze(['REGISTERED', 'OWNED', 'TRANSFERRED']);
/**
 * Statuses that end every ownership certificate created before the piece entered them, and in which none can be
 * created (F-06, OwnershipCertificateService; `certificateAllowed` of the owner's list).
 */
export const CERTIFICATE_ENDING_STATUSES: readonly ProductStatus[] = Object.freeze(['LOST', 'STOLEN', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED']);
export const INCIDENT_TYPES = ['LOST', 'STOLEN'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/**
 * Whether the owner may report a piece in `status` LOST or STOLEN (`reportIncident`; `incidentReportable` of the
 * owner's list): the lifecycle allows both from it (TRANSITIONS), and it is not REVOKED (which only reinstate()
 * leaves). Not from REVOKED, RETIRED or COUNTERFEIT_FLAGGED, nor from a LOST or STOLEN already reported.
 */
export function incidentReportable(status: ProductStatus): boolean {
  return status !== 'REVOKED' && INCIDENT_TYPES.every((t) => TRANSITIONS[status].includes(t));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** HKDF `info` of the transfer-code HMAC key (derived from COOKIE_SECRET). */
export const TRANSFER_CODE_KEY_INFO = 'orbes/transfer-code/v1';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RegisterFirstInput {
  registrationToken: string;
  claimCode?: string | null;
}

/** What the recipient of a transfer sends (POST /api/v1/ownership/transfers/accept, F-03). */
export interface AcceptTransferInput {
  /** The transfer code the owner gave, any accepted spelling. */
  transferCode: string;
  /** The piece the recipient scanned (canonical id or uuid): the code must be this piece's. */
  productId?: string | null;
  /** The TRANSFER_ACCEPT token of the recipient's scan of that piece (VerifyOutcome.transfer.token). */
  transferToken?: string | null;
}

export interface OwnershipResult {
  /** Canonical product id. */
  productId: string;
  accountId: string;
  acquiredVia: AcquiredVia;
  verified: boolean;
  ownershipState: OwnershipState;
  since: Date;
  statusChange: StatusChange | null;
}

export interface TransferOffer {
  /** XXXX-XXXX-XXXX, shown once; only its hash is stored. */
  transferCode: string;
  expiresAt: Date;
}

export interface CurrentOwner {
  accountId: string;
  acquiredVia: AcquiredVia;
  verified: boolean;
  since: Date;
  transferPending: boolean;
}

export interface OwnedProduct {
  productId: string;
  category: { code: string; name: string };
  collection: string | null;
  model: string;
  type: string;
  variant: string | null;
  material: string;
  createdYear: number;
  acquiredVia: AcquiredVia;
  verified: boolean;
  since: Date;
  transfer: { pending: boolean; expiresAt?: Date };
  /** LOST or STOLEN while the product is currently reported (by its owner or by ORBES Client Services), else null. */
  incident: IncidentType | null;
  /**
   * The owner may withdraw the report (`resolveIncident`, PIECE FOUND in MY PIECES): a LOST they declared
   * themselves. A STOLEN, or a LOST recorded by ORBES Client Services, stays with Client Services.
   */
  incidentResolvable: boolean;
  /**
   * The owner may report the piece LOST or STOLEN (`reportIncident`, REPORT LOST / STOLEN in MY PIECES): false while
   * it is reported, and for a piece revoked, retired or flagged (`incidentReportable`), where the report answers 409
   * INCIDENT_NOT_ALLOWED. Names no status: MY PIECES points to ORBES Client Services instead.
   */
  incidentReportable: boolean;
  inService: boolean;
  /**
   * The owner may create a link to an ownership certificate of the piece (F-06): false in a status that ends them
   * (CERTIFICATE_ENDING_STATUSES: reported lost or stolen, revoked, flagged or retired), where creation answers 409
   * CERTIFICATE_NOT_ALLOWED. Names no status: MY PIECES only leaves the action out.
   */
  certificateAllowed: boolean;
  genome: { id: string; version: number; fingerprint: string; glyphs: number[]; pattern: string } | null;
  warranty: WarrantySummary;
  /** The model's reference photograph and the piece's own (F-04): `/api/v1/media/<sha256>`, or null. */
  imageUrl: string | null;
  photoUrl: string | null;
  /** The model's care instructions (P-M02, the CARE tab of MY PIECES); null: the general care text of /verify. */
  care: string | null;
}

export interface OwnershipHistoryEntry {
  id: string;
  accountId: string;
  email: string;
  displayName: string | null;
  acquiredVia: AcquiredVia;
  verified: boolean;
  startedAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
}

export interface TransferRecord {
  id: string;
  fromAccountId: string;
  toAccountId: string | null;
  /** Effective status: a PENDING row past its expiry reads EXPIRED. */
  status: TransferStatus;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Server key for transfer-code lookups: HKDF-SHA256 from COOKIE_SECRET with
 * info `orbes/transfer-code/v1`. Rotating COOKIE_SECRET invalidates pending
 * transfer codes (owners start a new transfer).
 */
export function deriveTransferCodeKey(config: Pick<AppConfig, 'cookieSecret'>): Uint8Array {
  return deriveSubkey(utf8(config.cookieSecret), TRANSFER_CODE_KEY_INFO, { salt: 'ORBES' });
}

/**
 * Lookup value of a transfer code (any accepted spelling): HMAC-SHA256 of the
 * canonical code under the server key, or undefined when malformed.
 * Deterministic, so `token_hash` stays a unique index lookup; keyed, so a
 * leaked `ownership_transfers` table cannot be brute-forced offline (60 bits).
 */
export function hashTransferCode(code: unknown, key: Uint8Array): Uint8Array | undefined {
  const canonical = normalizeCrockford(code, TRANSFER_CODE_LENGTH);
  if (canonical === undefined) return undefined;
  return new Uint8Array(createHmac('sha256', key).update(canonical, 'utf8').digest());
}

export function ownershipStateFor(current: { verified: boolean } | undefined | null, transferPending: boolean): OwnershipState {
  if (!current) return 'UNREGISTERED';
  if (transferPending) return 'TRANSFER_PENDING';
  return current.verified ? 'OWNED' : 'REGISTERED';
}

function assertAccountId(accountId: unknown): asserts accountId is string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw validationError('Invalid account.');
}

function tokenError(reason: ScanTokenFailure): DomainError {
  switch (reason) {
    case 'USED':
      return new DomainError('REGISTRATION_TOKEN_USED', 409, 'This registration link has already been used. Please scan the product again.');
    case 'EXPIRED':
      return new DomainError('REGISTRATION_TOKEN_EXPIRED', 410, 'This registration link has expired. Please scan the product again.');
    default:
      return new DomainError('REGISTRATION_TOKEN_INVALID', 400, 'This registration link is not valid. Please scan the product again.', {
        detail: reason,
      });
  }
}

/**
 * Refusals of the transfer token (F-03). Every reason that is not "used" or "expired" (unknown, malformed, another
 * purpose, another piece, another account's scan) reads the same: scan the piece again.
 */
function transferTokenError(reason: ScanTokenFailure | 'WRONG_ACCOUNT'): DomainError {
  switch (reason) {
    case 'USED':
      return new DomainError('TRANSFER_TOKEN_USED', 409, 'This scan has already been used. Scan the piece again, then enter its transfer code.');
    case 'EXPIRED':
      return new DomainError(
        'TRANSFER_TOKEN_EXPIRED',
        410,
        `This scan is more than ${TRANSFER_TOKEN_TTL_MS / 60_000} minutes old. Scan the piece again, then enter its transfer code.`,
      );
    default:
      return new DomainError('TRANSFER_TOKEN_INVALID', 400, 'This scan cannot be used to receive this piece. Scan the piece again, then enter its transfer code.', {
        detail: reason,
      });
  }
}

/** No scan of the piece came with the code (F-03): the recipient scans it, signed in, first. */
const transferScanRequired = () =>
  new DomainError('TRANSFER_SCAN_REQUIRED', 400, 'Scan this piece while signed in to your ORBES account, then enter its transfer code.');

/** The code is another piece's (F-03). The answer names no piece: neither the one scanned nor the one the code hands over. */
const transferProductMismatch = () =>
  new DomainError('TRANSFER_PRODUCT_MISMATCH', 409, 'This transfer code is not for this piece. Check the code with the owner of this piece.');

/**
 * The transfer token of a scan, checked (`inspect`) or used up (`consume`, in the acceptance's transaction): a
 * TRANSFER_ACCEPT token bound to `productUuid` (when given) whose scan event names `accountId`. A refusal of
 * `consume` inside the transaction rolls the use back with it.
 */
async function checkTransferToken(
  db: Db,
  token: string,
  opts: { accountId: string; productUuid?: string; now: Date; consume: boolean },
): Promise<Extract<ScanTokenResult, { ok: true }>> {
  const check = { purpose: 'TRANSFER_ACCEPT' as const, now: opts.now, ...(opts.productUuid !== undefined ? { productId: opts.productUuid } : {}) };
  const r = opts.consume ? await consumeScanToken(db, token, check) : await inspectScanToken(db, token, check);
  if (!r.ok) throw transferTokenError(r.reason);
  // Bound to the account whose scan earned it: a token seen by anyone else is worthless.
  const scan = await db.selectFrom('scan_events').select('account_id').where('id', '=', r.scanEventId).executeTakeFirst();
  if (!scan || scan.account_id === null || scan.account_id.toLowerCase() !== opts.accountId.toLowerCase()) throw transferTokenError('WRONG_ACCOUNT');
  return r;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 72 hours after an assisted recovery (TRANSFER_FREEZE_MS), new transfers out of the account are refused. */
export const transfersPaused = (until: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${until.getUTCDate()} ${MONTHS[until.getUTCMonth()]} ${until.getUTCFullYear()}, ${pad(until.getUTCHours())}:${pad(until.getUTCMinutes())} UTC`;
  return new DomainError(
    'TRANSFERS_PAUSED',
    409,
    `After the recovery of its password, transfers from this account are paused until ${when}. ORBES Client Services can assist you.`,
  );
};

const alreadyRegistered = () => new DomainError('ALREADY_REGISTERED', 409, 'This product is already registered to an owner.');
const registrationNotAllowed = (status: ProductStatus) =>
  new DomainError('REGISTRATION_NOT_ALLOWED', 409, 'This product cannot be registered at this time.', { detail: `status ${status}` });
export const notOwner = () => new DomainError('NOT_OWNER', 403, 'Only the current owner can do this.');
const noIncident = () => new DomainError('NO_INCIDENT', 409, 'This piece is not reported lost.');
/** A report the lifecycle would refuse (revoked, retired, flagged, or already reported): said of the piece, never with its status. */
const incidentNotAllowed = (status: ProductStatus) =>
  new DomainError('INCIDENT_NOT_ALLOWED', 409, 'This piece cannot be reported here. ORBES Client Services can assist you.', { detail: `status ${status}` });
const incidentNotResolvable = () =>
  new DomainError('INCIDENT_NOT_RESOLVABLE', 409, 'Only a loss you reported yourself can be withdrawn here. ORBES Client Services can assist you.');

/**
 * Whether the product's LOST status is `accountId`'s own declaration (`reportIncident`): the last step of its
 * status history moved it to LOST, by that account. A LOST recorded by ORBES Client Services (a staff
 * transition) is not, nor is a STOLEN: those are withdrawn by staff, once they have checked the piece.
 */
async function lostDeclaredBy(db: Db, product: Pick<ProductRow, 'id' | 'status'>, accountId: string): Promise<boolean> {
  if (product.status !== 'LOST') return false;
  const last = (await loadStatusHistory(db, product.id)).at(-1);
  return last !== undefined && last.to === 'LOST' && last.actorType === 'account' && last.actorId === accountId;
}

/**
 * Lock a product for an owner-only customer action. An unknown id answers exactly like a product
 * the caller does not own: product ids are sequential, so "not found" vs "not yours" would let any
 * account enumerate the issued serials (production volumes per category and year).
 */
export async function lockForOwnerAction(tx: Db, productId: string): Promise<ProductRow> {
  const p = await findProduct(tx, productId, { forUpdate: true });
  if (!p) throw notOwner();
  return p;
}

/**
 * The acting account's row, read FOR SHARE before any product is locked (lock order account → product, as
 * in the recovery and the lock). A request already on its way when ORBES Client Services locked the account
 * (A-06: the lock ends the sessions, but the session guard ran before it) is refused here: the lock still
 * in progress is waited for, and one that starts now waits for this request.
 */
export async function readActingAccount(tx: Db, accountId: string): Promise<{ status: AccountStatus; transfers_frozen_until: Date | null } | undefined> {
  const account = await tx.selectFrom('accounts').select(['status', 'transfers_frozen_until']).where('id', '=', accountId).forShare().executeTakeFirst();
  if (account?.status === 'LOCKED') throw customerAccountLocked();
  return account;
}

// ── Service ────────────────────────────────────────────────────────────────

export class OwnershipService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;
  private readonly transferKey: Uint8Array;
  private readonly requireScannedPiece: boolean;

  /**
   * `transferKey`: 32-byte HMAC key for transfer codes (deriveTransferCodeKey; the context always passes it).
   * Without it a random per-instance key is used, which only suits single-instance tests.
   * `requireScannedPiece` (default true; TRANSFER_ACCEPT_REQUIRE_PRODUCT, F-03): an acceptance must name the scanned
   * piece and carry the transfer token of that scan; false makes both optional (an acceptance assisted by ORBES
   * Client Services).
   */
  constructor(deps: { db: Db; audit: AuditService; lifecycle: LifecycleService; clock?: Clock; transferKey?: Uint8Array; requireScannedPiece?: boolean }) {
    const key = deps.transferKey ?? new Uint8Array(randomBytes(32));
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError('transferKey must be 32 bytes');
    this.transferKey = key;
    this.db = deps.db;
    this.audit = deps.audit;
    this.lifecycle = deps.lifecycle;
    this.clock = deps.clock ?? systemClock;
    this.requireScannedPiece = deps.requireScannedPiece ?? true;
  }

  /**
   * Register the first owner of a product, authorised by a registration
   * token from a fresh scan and, when the product has one, its claim code.
   * Verified (claim code matched) → OWNED; otherwise REGISTERED.
   */
  async registerFirst(accountId: string, input: RegisterFirstInput, actor: Actor): Promise<OwnershipResult> {
    assertAccountId(accountId);
    const token = input?.registrationToken;
    if (typeof token !== 'string' || token.length === 0) throw validationError('A registration token is required.');
    const claimInput = input.claimCode ?? null;
    if (claimInput !== null && typeof claimInput !== 'string') throw validationError('Invalid claim code.');

    // Pre-checks without side effects: cheap answers before any scrypt work.
    const peek = await inspectScanToken(this.db, token, { now: this.clock() });
    if (!peek.ok) throw tokenError(peek.reason);
    await this.requireActiveAccount(this.db, accountId);
    const product = await requireProduct(this.db, peek.productId);
    if (await this.currentOwnership(this.db, product.id)) throw alreadyRegistered();
    if (!(await this.registrable(this.db, product))) throw registrationNotAllowed(product.status);

    let verified = false;
    if (product.claim_secret_hash !== null) {
      if (claimInput === null || claimInput.trim() === '') {
        throw new DomainError('CLAIM_CODE_REQUIRED', 400, 'This product requires the claim code supplied with it.');
      }
      await this.checkClaimCode(product, claimInput, actor);
      verified = true;
    }

    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // The account again, under a share lock and before the product (lock order account → product): a lock by ORBES
      // Client Services that committed during the checks above (the claim code's scrypt included) refuses this
      // registration rather than giving a piece to a LOCKED account.
      await this.readActiveAccount(tx, accountId);
      const p = await requireProduct(tx, product.id, { forUpdate: true });
      // The claim secret could have been replaced (code re-issue) between the check and the lock.
      if (p.claim_secret_hash !== product.claim_secret_hash) {
        throw new DomainError('REGISTRATION_CONFLICT', 409, 'The product changed during registration. Please try again.');
      }
      const consumed = await consumeScanToken(tx, token, { now, productId: p.id });
      if (!consumed.ok) throw tokenError(consumed.reason);
      if (await this.currentOwnership(tx, p.id)) throw alreadyRegistered();
      if (!(await this.registrable(tx, p))) throw registrationNotAllowed(p.status);

      await tx
        .insertInto('ownership')
        .values({ product_id: p.id, account_id: accountId, acquired_via: 'FIRST_REGISTRATION', verified, started_at: now })
        .execute();
      const ownershipState = ownershipStateFor({ verified }, false);
      const statusChange = await this.lifecycle.applyForService(
        tx,
        p,
        verified ? 'OWNED' : 'REGISTERED',
        { reason: 'first registration', via: 'ownership.registerFirst', ownershipState, registrationFromService: true },
        actor,
      );
      await this.audit.record(
        {
          actor,
          action: 'ownership.register',
          targetType: 'product',
          targetId: p.product_id,
          details: { accountId, verified, acquiredVia: 'FIRST_REGISTRATION', scanEventId: consumed.scanEventId },
        },
        tx,
      );
      return { productId: p.product_id, accountId, acquiredVia: 'FIRST_REGISTRATION', verified, ownershipState, since: now, statusChange };
    });
  }

  /**
   * The current owner offers the product to someone else: returns a one-time transfer code (7 days).
   * Refused with 409 TRANSFERS_PAUSED for 72 hours after an assisted recovery of the account
   * (`accounts.transfers_frozen_until`, AccountRecoveryService). The account row is read FOR SHARE
   * before the product is locked (lock order account → product, as in the recovery), so a transfer
   * started while a recovery commits waits for it and sees the pause.
   */
  async initiateTransfer(accountId: string, productId: string, actor: Actor): Promise<TransferOffer> {
    assertAccountId(accountId);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // Locked by ORBES Client Services while this request was on its way (the lock ends the sessions, A-06).
      const account = await readActingAccount(tx, accountId);
      if (account?.transfers_frozen_until && account.transfers_frozen_until.getTime() > now.getTime()) throw transfersPaused(account.transfers_frozen_until);
      const p = await lockForOwnerAction(tx, productId);
      const current = await this.currentOwnership(tx, p.id);
      if (!current || current.account_id !== accountId) throw notOwner();
      await this.expireStale(tx, p, now);
      if (await this.pendingTransfer(tx, p.id)) {
        throw new DomainError('TRANSFER_ALREADY_PENDING', 409, 'A transfer is already pending for this product. Cancel it first.');
      }
      if (!TRANSFERABLE_STATUSES.includes(p.status)) {
        throw new DomainError('TRANSFER_NOT_ALLOWED', 409, 'This product cannot be transferred at this time.', { detail: `status ${p.status}` });
      }

      const canonical = randomCrockford(TRANSFER_CODE_LENGTH);
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_MS);
      const transfer = await tx
        .insertInto('ownership_transfers')
        .values({
          product_id: p.id,
          from_account_id: accountId,
          token_hash: hashTransferCode(canonical, this.transferKey)!,
          status: 'PENDING',
          created_at: now,
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('products').set({ ownership_state: 'TRANSFER_PENDING', updated_at: now }).where('id', '=', p.id).execute();
      await this.audit.record(
        {
          actor,
          action: 'ownership.transfer.initiate',
          targetType: 'product',
          targetId: p.product_id,
          details: { transferId: transfer.id, fromAccountId: accountId, expiresAt },
        },
        tx,
      );
      return { transferCode: formatGrouped(canonical), expiresAt };
    });
  }

  /**
   * The recipient redeems a transfer code: ownership moves, `verified` carries over, status → TRANSFERRED.
   *
   * F-03: the code must be the code of the piece the recipient scanned (`productId`), else 409
   * TRANSFER_PRODUCT_MISMATCH, which names no piece; and the TRANSFER_ACCEPT token of that scan
   * (`transferToken`) is used up in the acceptance's transaction, for the same piece and the same account
   * (refusals TRANSFER_TOKEN_INVALID, _EXPIRED, _USED; none sent: TRANSFER_SCAN_REQUIRED). Both are required
   * unless `requireScannedPiece` is false (an acceptance assisted by ORBES Client Services), and whichever is
   * given is checked. The token is checked before the code is read, so trying piece ids against a code
   * needs a scan of each: nothing is learnt about the piece a code hands over without the piece's own scan.
   */
  async acceptTransfer(accountId: string, input: AcceptTransferInput, actor: Actor): Promise<OwnershipResult> {
    assertAccountId(accountId);
    const tokenHash = hashTransferCode(input?.transferCode, this.transferKey);
    if (!tokenHash) throw validationError('The transfer code is not valid.');
    const productRef = input.productId ?? null;
    const scanToken = input.transferToken ?? null;
    if (productRef !== null && typeof productRef !== 'string') throw validationError('Invalid piece.');
    if (scanToken !== null && typeof scanToken !== 'string') throw validationError('Invalid scan.');
    if (this.requireScannedPiece && productRef === null) throw validationError('The scanned piece is required.');
    if (this.requireScannedPiece && scanToken === null) throw transferScanRequired();
    await this.requireActiveAccount(this.db, accountId);

    // The piece the recipient scanned: the one named, else the one of the scan's token (an assisted acceptance may name none).
    let pieceUuid: string | null = null;
    // An unknown id names no piece: no scan can be of it, and no code hands it over. Without a scan token (an assisted
    // acceptance) it is refused only once the code has been read, as the id of another piece is: answered at once, it
    // would tell any account which ids exist (product ids are sequential: production volumes, as lockForOwnerAction).
    let unknownPiece = false;
    if (productRef !== null) {
      const named = await findProduct(this.db, productRef);
      if (!named && scanToken !== null) throw transferTokenError('WRONG_PRODUCT');
      if (named) pieceUuid = named.id;
      else unknownPiece = true;
    }
    if (scanToken !== null) {
      const peek = await checkTransferToken(this.db, scanToken, { accountId, now: this.clock(), consume: false, ...(pieceUuid !== null ? { productUuid: pieceUuid } : {}) });
      pieceUuid = peek.productId;
    }

    const found = await this.db.selectFrom('ownership_transfers').selectAll().where('token_hash', '=', tokenHash).executeTakeFirst();
    if (!found) throw notFound('Transfer', 'TRANSFER_NOT_FOUND');
    // Another piece's code says nothing more about itself: not its state, nor which piece it hands over. An unknown id
    // gets the same answer as the id of another piece, for any code.
    if (unknownPiece || (pieceUuid !== null && found.product_id !== pieceUuid)) throw transferProductMismatch();
    if (found.status === 'PENDING' && found.expires_at.getTime() <= this.clock().getTime()) {
      // Record the expiry (committed) before refusing, so the product leaves TRANSFER_PENDING.
      await inTransaction(this.db, async (tx) => {
        const p = await requireProduct(tx, found.product_id, { forUpdate: true });
        await this.expireStale(tx, p, this.clock());
      });
      throw transferClosedError('EXPIRED');
    }
    if (found.status !== 'PENDING') throw transferClosedError(found.status);

    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // The recipient's account again, under a share lock and before the product (as registerFirst): a lock that
      // committed since the check above refuses the acceptance.
      await this.readActiveAccount(tx, accountId);
      const p = await requireProduct(tx, found.product_id, { forUpdate: true });
      const t = await tx.selectFrom('ownership_transfers').selectAll().where('id', '=', found.id).forUpdate().executeTakeFirstOrThrow();
      if (t.status !== 'PENDING') throw transferClosedError(t.status);
      if (t.expires_at.getTime() <= now.getTime()) throw transferClosedError('EXPIRED');
      // The scan of this piece by this account, used up with the acceptance (a refusal below rolls the use back).
      const scan = scanToken !== null ? await checkTransferToken(tx, scanToken, { accountId, productUuid: p.id, now, consume: true }) : null;

      const current = await this.currentOwnership(tx, p.id);
      if (current && current.account_id === accountId) {
        throw new DomainError('CANNOT_ACCEPT_OWN_TRANSFER', 409, 'You already own this product.');
      }
      if (!current || current.account_id !== t.from_account_id) {
        // Ownership changed by other means (e.g. client services) since the code was issued.
        throw new DomainError('TRANSFER_STALE', 409, 'This transfer is no longer valid.', { detail: 'sender is no longer the owner' });
      }
      if (!TRANSFERABLE_STATUSES.includes(p.status)) {
        throw new DomainError('TRANSFER_NOT_ALLOWED', 409, 'This product cannot be transferred at this time.', { detail: `status ${p.status}` });
      }

      const endedAt = now < current.started_at ? current.started_at : now;
      await tx.updateTable('ownership').set({ ended_at: endedAt, ended_reason: 'TRANSFERRED_OUT' }).where('id', '=', current.id).execute();
      await tx
        .insertInto('ownership')
        .values({ product_id: p.id, account_id: accountId, acquired_via: 'TRANSFER', verified: current.verified, started_at: endedAt })
        .execute();
      await tx
        .updateTable('ownership_transfers')
        .set({ status: 'ACCEPTED', to_account_id: accountId, completed_at: now })
        .where('id', '=', t.id)
        .execute();
      const ownershipState = ownershipStateFor(current, false);
      const statusChange = await this.lifecycle.applyForService(
        tx,
        p,
        'TRANSFERRED',
        { reason: 'ownership transfer', via: 'ownership.acceptTransfer', ownershipState },
        actor,
      );
      await this.audit.record(
        {
          actor,
          action: 'ownership.transfer.accept',
          targetType: 'product',
          targetId: p.product_id,
          // The scan the acceptance used (F-03); null for an acceptance assisted by ORBES Client Services without one.
          details: { transferId: t.id, fromAccountId: current.account_id, toAccountId: accountId, verified: current.verified, scanEventId: scan?.scanEventId ?? null },
        },
        tx,
      );
      return { productId: p.product_id, accountId, acquiredVia: 'TRANSFER', verified: current.verified, ownershipState, since: endedAt, statusChange };
    });
  }

  /** The owner withdraws a pending transfer. */
  async cancelTransfer(accountId: string, productId: string, actor: Actor): Promise<void> {
    assertAccountId(accountId);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const p = await lockForOwnerAction(tx, productId);
      const pending = await this.pendingTransfer(tx, p.id);
      // Strangers learn nothing (not even whether a transfer is pending): ownership is checked first.
      if (!pending) {
        const current = await this.currentOwnership(tx, p.id);
        if (!current || current.account_id !== accountId) throw notOwner();
        throw notFound('Pending transfer', 'NO_PENDING_TRANSFER');
      }
      if (pending.from_account_id !== accountId) throw notOwner();
      await tx.updateTable('ownership_transfers').set({ status: 'CANCELLED', completed_at: now }).where('id', '=', pending.id).execute();
      const current = await this.currentOwnership(tx, p.id);
      await tx.updateTable('products').set({ ownership_state: ownershipStateFor(current, false), updated_at: now }).where('id', '=', p.id).execute();
      await this.audit.record(
        { actor, action: 'ownership.transfer.cancel', targetType: 'product', targetId: p.product_id, details: { transferId: pending.id } },
        tx,
      );
    });
  }

  /**
   * Cancel every pending transfer offered by an account (the assisted recovery of its password, C-04, and
   * the lock by ORBES Client Services, A-06): a transfer code handed out by whoever held the account must
   * not complete afterwards. Runs inside the caller's transaction, which already holds the account row.
   *
   * Two passes, so that no row lock is ever requested after the transaction has taken the audit chain's
   * lock (AuditService.record holds it until commit), as in every other product mutation (row first, audit
   * last): first each product is locked in product order (lock order account → products, and products
   * always in the same order) and its pending transfer re-read and cancelled, so one accepted meanwhile is
   * left as it is; then one `ownership.transfer.cancel` is recorded per cancelled transfer, with `reason`,
   * like a cancellation by the owner. Returns the ids of the transfers cancelled. The caller audits after.
   */
  async cancelPendingTransfersFrom(tx: Db, accountId: string, actor: Actor, reason: string): Promise<string[]> {
    assertAccountId(accountId);
    const pending = await tx
      .selectFrom('ownership_transfers')
      .select(['id', 'product_id'])
      .where('from_account_id', '=', accountId)
      .where('status', '=', 'PENDING')
      .orderBy('product_id')
      .orderBy('created_at')
      .execute();
    const cancelled: { transferId: string; productId: string }[] = [];
    for (const t of pending) {
      const now = this.clock();
      const p = await requireProduct(tx, t.product_id, { forUpdate: true });
      const r = await tx
        .updateTable('ownership_transfers')
        .set({ status: 'CANCELLED', completed_at: now })
        .where('id', '=', t.id)
        .where('status', '=', 'PENDING')
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) continue;
      const current = await this.currentOwnership(tx, p.id);
      await tx.updateTable('products').set({ ownership_state: ownershipStateFor(current, false), updated_at: now }).where('id', '=', p.id).execute();
      cancelled.push({ transferId: t.id, productId: p.product_id });
    }
    // Every row lock is taken: the audit chain's lock can be held from here to the commit.
    for (const c of cancelled) {
      await this.audit.record(
        { actor, action: 'ownership.transfer.cancel', targetType: 'product', targetId: c.productId, details: { transferId: c.transferId, reason } },
        tx,
      );
    }
    return cancelled.map((c) => c.transferId);
  }

  /** Client services reviewed proof of purchase: the owner becomes verified; REGISTERED → OWNED. */
  async confirmOwnership(productId: string, actor: Actor): Promise<OwnershipResult> {
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const p = await requireProduct(tx, productId, { forUpdate: true });
      const current = await this.currentOwnership(tx, p.id);
      if (!current) throw new DomainError('NO_OWNER', 409, 'This product has no registered owner.');
      if (current.verified) throw new DomainError('ALREADY_VERIFIED', 409, 'This ownership is already verified.');
      await tx.updateTable('ownership').set({ verified: true }).where('id', '=', current.id).execute();
      const ownershipState = ownershipStateFor({ verified: true }, (await this.pendingTransfer(tx, p.id)) !== undefined);
      let statusChange: StatusChange | null = null;
      if (p.status === 'REGISTERED') {
        statusChange = await this.lifecycle.applyForService(
          tx,
          p,
          'OWNED',
          { reason: 'ownership confirmed', via: 'ownership.confirm', ownershipState },
          actor,
        );
      } else {
        await tx.updateTable('products').set({ ownership_state: ownershipState, updated_at: now }).where('id', '=', p.id).execute();
      }
      await this.audit.record(
        { actor, action: 'ownership.confirm', targetType: 'product', targetId: p.product_id, details: { accountId: current.account_id } },
        tx,
      );
      return {
        productId: p.product_id,
        accountId: current.account_id,
        acquiredVia: current.acquired_via,
        verified: true,
        ownershipState,
        since: current.started_at,
        statusChange,
      };
    });
  }

  /**
   * The owner reports the product LOST or STOLEN; any pending transfer is cancelled. Only from a status that allows
   * it (`incidentReportable`): a piece revoked, retired, flagged or already reported answers 409 INCIDENT_NOT_ALLOWED,
   * which points to ORBES Client Services.
   */
  async reportIncident(accountId: string, productId: string, type: IncidentType, actor: Actor): Promise<StatusChange> {
    assertAccountId(accountId);
    if (!INCIDENT_TYPES.includes(type)) throw validationError('Incident type must be LOST or STOLEN.');
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      // Locked by ORBES Client Services while this request was on its way (A-06): refused, as a transfer is.
      await readActingAccount(tx, accountId);
      const p = await lockForOwnerAction(tx, productId);
      const current = await this.currentOwnership(tx, p.id);
      if (!current || current.account_id !== accountId) throw notOwner();
      // Checked here rather than left to the lifecycle, whose refusal is worded for staff ("this product").
      if (!incidentReportable(p.status)) throw incidentNotAllowed(p.status);
      const pending = await this.pendingTransfer(tx, p.id);
      if (pending) {
        // A transfer code in a thief's hands must not complete the theft.
        await tx.updateTable('ownership_transfers').set({ status: 'CANCELLED', completed_at: now }).where('id', '=', pending.id).execute();
      }
      const change = await this.lifecycle.applyForService(
        tx,
        p,
        type,
        { reason: `reported ${type.toLowerCase()} by owner`, via: 'ownership.reportIncident', ownershipState: ownershipStateFor(current, false) },
        actor,
      );
      await this.audit.record(
        {
          actor,
          action: 'ownership.incident',
          targetType: 'product',
          targetId: p.product_id,
          details: { type, ...(pending ? { cancelledTransferId: pending.id } : {}) },
        },
        tx,
      );
      return change;
    });
  }

  /**
   * The owner found a piece they had reported LOST (PIECE FOUND, MY PIECES): the piece returns to the status it
   * held before the loss (`returnTargetOf`, applied by `applyForService` in this transaction), so its scans read
   * as before and it can be transferred again. Only the current owner, and only a LOST they declared
   * themselves (`lostDeclaredBy`): a STOLEN, or a LOST recorded by ORBES Client Services, stays with Client
   * Services (409 INCIDENT_NOT_RESOLVABLE), so whoever takes over an account after a theft cannot make the
   * stolen piece read as clean. A piece that is not reported answers 409 NO_INCIDENT. Strangers learn nothing:
   * ownership is checked first, and an unknown id answers as a piece of someone else (NOT_OWNER).
   */
  async resolveIncident(accountId: string, productId: string, actor: Actor): Promise<StatusChange> {
    assertAccountId(accountId);
    return inTransaction(this.db, async (tx) => {
      // Locked by ORBES Client Services while this request was on its way (A-06): refused, as a declaration is.
      await readActingAccount(tx, accountId);
      const p = await lockForOwnerAction(tx, productId);
      const current = await this.currentOwnership(tx, p.id);
      if (!current || current.account_id !== accountId) throw notOwner();
      if (p.status !== 'LOST' && p.status !== 'STOLEN') throw noIncident();
      if (!(await lostDeclaredBy(tx, p, accountId))) throw incidentNotResolvable();
      const target = await returnTargetOf(tx, p);
      if (target === null) throw incidentNotResolvable();
      const change = await this.lifecycle.applyForService(
        tx,
        p,
        target,
        { reason: 'found by owner', via: 'ownership.resolveIncident', ownershipState: ownershipStateFor(current, false) },
        actor,
      );
      await this.audit.record(
        { actor, action: 'ownership.incident.resolve', targetType: 'product', targetId: p.product_id, details: { type: 'LOST', to: target } },
        tx,
      );
      return change;
    });
  }

  /** The current owner of a product, or null (used by verification to recognise the owner). */
  async currentOwner(productId: string): Promise<CurrentOwner | null> {
    const p = await requireProduct(this.db, productId);
    const current = await this.currentOwnership(this.db, p.id);
    if (!current) return null;
    const pending = await this.pendingTransfer(this.db, p.id);
    return {
      accountId: current.account_id,
      acquiredVia: current.acquired_via,
      verified: current.verified,
      since: current.started_at,
      transferPending: pending !== undefined && pending.expires_at.getTime() > this.clock().getTime(),
    };
  }

  /**
   * Products the account currently owns, newest acquisition first, with genome and warranty summary. `productUuid`
   * narrows the list to one piece (products.id): the live record an ownership certificate shows (F-06).
   */
  async listForAccount(accountId: string, opts: { productUuid?: string } = {}): Promise<OwnedProduct[]> {
    assertAccountId(accountId);
    const now = this.clock();
    let query = this.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .innerJoin('categories as c', 'c.id', 'p.category_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .leftJoin('collections as col', (j) => j.on((eb) => eb('col.id', '=', eb.fn.coalesce('p.collection_id', 'm.collection_id'))))
      .select([
        'p.id as uuid', 'p.product_id', 'p.status', 'p.variant', 'p.material', 'p.year',
        'c.code as category_code', 'c.name as category_name', 'm.name as model_name', 'm.type as model_type', 'col.name as collection_name',
        'm.image_sha256', 'p.photo_sha256', 'm.care_instructions',
        'o.acquired_via', 'o.verified', 'o.started_at',
      ])
      .where('o.account_id', '=', accountId)
      .where('o.ended_at', 'is', null);
    if (opts.productUuid !== undefined) query = query.where('p.id', '=', opts.productUuid);
    const rows = await query.orderBy('o.started_at', 'desc').orderBy('p.product_id').execute();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.uuid);

    const [genomes, warranties, transfers] = await Promise.all([
      this.db.selectFrom('genomes').selectAll().where('product_id', 'in', ids).orderBy('genome_version', 'desc').execute(),
      this.db.selectFrom('warranties').selectAll().where('product_id', 'in', ids).execute(),
      this.db
        .selectFrom('ownership_transfers')
        .select(['product_id', 'expires_at'])
        .where('product_id', 'in', ids)
        .where('status', '=', 'PENDING')
        .where('expires_at', '>', now)
        .execute(),
    ]);
    // A loss the owner declared themselves is theirs to withdraw (PIECE FOUND): read from the status history.
    const resolvable = new Set(
      (await Promise.all(rows.map(async (r) => ((await lostDeclaredBy(this.db, { id: r.uuid, status: r.status }, accountId)) ? r.uuid : null)))).filter(
        (x): x is string => x !== null,
      ),
    );
    const today = utcDate(now);
    return rows.map((r) => {
      const g = genomes.find((x) => x.product_id === r.uuid);
      const w = warranties.find((x) => x.product_id === r.uuid);
      const t = transfers.find((x) => x.product_id === r.uuid);
      const ws = computeWarrantyStatus(w, today);
      return {
        productId: r.product_id,
        category: { code: r.category_code.trim(), name: r.category_name },
        collection: r.collection_name,
        model: r.model_name,
        type: r.model_type,
        variant: r.variant,
        material: r.material,
        createdYear: r.year,
        acquiredVia: r.acquired_via,
        verified: r.verified,
        since: r.started_at,
        transfer: t ? { pending: true, expiresAt: t.expires_at } : { pending: false },
        incident: r.status === 'LOST' || r.status === 'STOLEN' ? r.status : null,
        incidentResolvable: resolvable.has(r.uuid),
        incidentReportable: incidentReportable(r.status),
        inService: r.status === 'SERVICED',
        certificateAllowed: !CERTIFICATE_ENDING_STATUSES.includes(r.status),
        genome: g ? { id: g.genome_id, version: g.genome_version, fingerprint: g.fingerprint, glyphs: g.glyphs, pattern: g.pattern } : null,
        warranty: {
          status: ws,
          ...(w?.start_date ? { startDate: w.start_date } : {}),
          ...(w?.end_date ? { endDate: w.end_date } : {}),
        },
        imageUrl: mediaUrl(r.image_sha256),
        photoUrl: mediaUrl(r.photo_sha256),
        care: r.care_instructions,
      };
    });
  }

  /** Admin: every ownership period and transfer of a product, oldest first. */
  async history(productId: string): Promise<{ owners: OwnershipHistoryEntry[]; transfers: TransferRecord[] }> {
    const p = await requireProduct(this.db, productId);
    const now = this.clock();
    const [owners, transfers] = await Promise.all([
      this.db
        .selectFrom('ownership as o')
        .innerJoin('accounts as a', 'a.id', 'o.account_id')
        .select(['o.id', 'o.account_id', 'a.email', 'a.display_name', 'o.acquired_via', 'o.verified', 'o.started_at', 'o.ended_at', 'o.ended_reason'])
        .where('o.product_id', '=', p.id)
        .orderBy('o.started_at', 'asc')
        .orderBy('o.ended_at', 'asc')
        .execute(),
      this.db.selectFrom('ownership_transfers').selectAll().where('product_id', '=', p.id).orderBy('created_at', 'asc').execute(),
    ]);
    return {
      owners: owners.map((o) => ({
        id: o.id,
        accountId: o.account_id,
        email: o.email,
        displayName: o.display_name,
        acquiredVia: o.acquired_via,
        verified: o.verified,
        startedAt: o.started_at,
        endedAt: o.ended_at,
        endedReason: o.ended_reason,
      })),
      transfers: transfers.map((t) => toTransferRecord(t, now)),
    };
  }

  /** Housekeeping: mark every overdue PENDING transfer EXPIRED and fix the products' ownership_state. */
  async expireStaleTransfers(): Promise<number> {
    const now = this.clock();
    const due = await this.db
      .selectFrom('ownership_transfers')
      .select('product_id')
      .where('status', '=', 'PENDING')
      .where('expires_at', '<=', now)
      .execute();
    let n = 0;
    for (const { product_id } of due) {
      n += await inTransaction(this.db, async (tx) => {
        const p = await requireProduct(tx, product_id, { forUpdate: true });
        return this.expireStale(tx, p, now);
      });
    }
    return n;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Check a claim code under the per-product attempt limit. Attempts for one
   * product are serialised by the product row lock; a failure is committed
   * (as an audit entry) before the error is thrown.
   */
  private async checkClaimCode(product: ProductRow, claimCode: string, actor: Actor): Promise<void> {
    if (normalizeClaimCode(claimCode) === undefined) {
      // Cannot match any code, so it reveals nothing and is not counted as a guess.
      throw new DomainError('CLAIM_CODE_MALFORMED', 400, 'The claim code format is not valid (XXXX-XXXX-XXXX).');
    }
    const failed = await inTransaction(this.db, async (tx) => {
      const p = await requireProduct(tx, product.id, { forUpdate: true });
      const now = this.clock();
      const since = new Date(now.getTime() - CLAIM_ATTEMPT_WINDOW_MS);
      const recent = await tx
        .selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('target_type', '=', 'product')
        .where('target_id', '=', p.product_id)
        .where('action', '=', CLAIM_FAILED_ACTION)
        .where('occurred_at', '>', since)
        .executeTakeFirstOrThrow();
      if (Number(recent.n) >= CLAIM_ATTEMPT_LIMIT) {
        throw tooManyRequests('Too many claim codes have been tried for this piece within the hour. Please try again later. ORBES Client Services can assist you.');
      }
      if (p.claim_secret_hash !== null && (await verifyClaimCode(claimCode, p.claim_secret_hash))) return false;
      await this.audit.record(
        { actor, action: CLAIM_FAILED_ACTION, targetType: 'product', targetId: p.product_id, details: { attempt: Number(recent.n) + 1 } },
        tx,
      );
      return true;
    });
    if (failed) throw new DomainError('CLAIM_CODE_INVALID', 403, 'The claim code does not match this product.');
  }

  /** Open for first registration: a registrable status, and not a pre-sale service (ISSUED → SERVICED). */
  private async registrable(db: Db, product: ProductRow): Promise<boolean> {
    if (!REGISTRABLE_STATUSES.includes(product.status)) return false;
    return !(product.status === 'SERVICED' && (await this.lifecycle.isPreSaleService(product.id, db)));
  }

  private async currentOwnership(db: Db, productUuid: string): Promise<OwnershipRow | undefined> {
    return db.selectFrom('ownership').selectAll().where('product_id', '=', productUuid).where('ended_at', 'is', null).executeTakeFirst();
  }

  private async pendingTransfer(db: Db, productUuid: string): Promise<OwnershipTransferRow | undefined> {
    return db.selectFrom('ownership_transfers').selectAll().where('product_id', '=', productUuid).where('status', '=', 'PENDING').executeTakeFirst();
  }

  /** Expire this product's overdue pending transfer (caller holds the product lock). Returns how many expired. */
  private async expireStale(tx: Db, p: ProductRow, now: Date): Promise<number> {
    const expired = await tx
      .updateTable('ownership_transfers')
      .set({ status: 'EXPIRED', completed_at: now })
      .where('product_id', '=', p.id)
      .where('status', '=', 'PENDING')
      .where('expires_at', '<=', now)
      .returning('id')
      .execute();
    if (expired.length === 0) return 0;
    if (p.ownership_state === 'TRANSFER_PENDING') {
      const state = ownershipStateFor(await this.currentOwnership(tx, p.id), false);
      await tx.updateTable('products').set({ ownership_state: state, updated_at: now }).where('id', '=', p.id).execute();
      p.ownership_state = state;
    }
    for (const t of expired) {
      await this.audit.record(
        { actor: SYSTEM_ACTOR, action: 'ownership.transfer.expire', targetType: 'product', targetId: p.product_id, details: { transferId: t.id } },
        tx,
      );
    }
    return expired.length;
  }

  private async requireActiveAccount(db: Db, accountId: string): Promise<void> {
    const a = await db.selectFrom('accounts').select('status').where('id', '=', accountId).executeTakeFirst();
    if (!a || a.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
  }

  /** In the write transaction: LOCKED answers 403 ACCOUNT_LOCKED (readActingAccount), any other non-ACTIVE state 403 FORBIDDEN. */
  private async readActiveAccount(tx: Db, accountId: string): Promise<void> {
    const a = await readActingAccount(tx, accountId);
    if (!a || a.status !== 'ACTIVE') throw forbidden('This account cannot perform this action.');
  }
}

function transferClosedError(status: TransferStatus | 'EXPIRED'): DomainError {
  switch (status) {
    case 'EXPIRED':
      return new DomainError('TRANSFER_EXPIRED', 410, 'This transfer code has expired. Ask the owner for a new one.');
    case 'CANCELLED':
      return new DomainError('TRANSFER_CANCELLED', 410, 'This transfer was cancelled by the owner.');
    case 'ACCEPTED':
      return new DomainError('TRANSFER_ALREADY_ACCEPTED', 409, 'This transfer code has already been used.');
    default:
      return notFound('Transfer', 'TRANSFER_NOT_FOUND');
  }
}

function toTransferRecord(t: OwnershipTransferRow, now: Date): TransferRecord {
  const status: TransferStatus = t.status === 'PENDING' && t.expires_at.getTime() <= now.getTime() ? 'EXPIRED' : t.status;
  return {
    id: t.id,
    fromAccountId: t.from_account_id,
    toAccountId: t.to_account_id,
    status,
    createdAt: t.created_at,
    expiresAt: t.expires_at,
    completedAt: t.completed_at,
  };
}
