/**
 * OwnerService — the console's customer sheet for ORBES Client Services
 * (A-06; API §16.2 and §16.11–16.13, SECURITY-MODEL §3.3 and §3.6).
 *
 *   list     GET  /api/admin/owners (AUDITOR): every account, newest first; or
 *            one account by its exact email (`?email=`, normalised as at sign-in);
 *            or the accounts behind a REF (`?ref=`): the reference the verify
 *            app prints under every result (the first 8 hexadecimal characters
 *            of the scan's id) finds the scan, its piece, the piece's current
 *            owner and the account that scanned it, if one was signed in.
 *   sheet    GET  /api/admin/owners/:id (AUDITOR): the account, its tier in
 *            the club now (P-X04: services/club.ts `tierOf`), the pieces it
 *            owns and owned (`ownership`), its transfers in progress and its 20
 *            latest scans (`scan_events.account_id`). The client sheet (plan
 *            LIVE RELEASE+, N4) adds the releases it took part in with the
 *            pieces it secured in each (services/participation.ts), its
 *            answers to the questions after (services/question.ts), its
 *            interest (I'LL BE THERE) and what became of it, the segments it
 *            belongs to now (services/segments.ts, read live) and the notes
 *            ORBES Client Services wrote on its orders, draw entries, requests
 *            of the private salon and LIVE reservations; its orders and their
 *            steps are the fulfilment's (services/fulfilment.ts `forAccount`,
 *            joined by the route).
 *   lock     POST /api/admin/owners/:id/lock (ADMIN): status LOCKED, in one
 *            transaction with every session of the account revoked, its
 *            pending transfers cancelled, its open links to ownership
 *            certificates withdrawn, its open entries in the drops withdrawn
 *            (P-R03), its open requests of the private salon closed (P-X08),
 *            its open entries in the LIVE RELEASES removed and its interest in
 *            those not opened yet withdrawn (services/live.ts) and its open
 *            recovery code revoked.
 *            Sign-in is then refused (403 ACCOUNT_LOCKED) until it is
 *            unlocked, and a recovery code cannot be issued. Audited
 *            `account.lock`.
 *   unlock   POST /api/admin/owners/:id/unlock (ADMIN): back to ACTIVE. Audited
 *            `account.unlock`.
 *   export   GET  /api/admin/owners/:id/export (ADMIN): everything the registry
 *            holds about the account, for a request under the right of access,
 *            including the links to ownership certificates it created (never
 *            their tokens), its entries in the drops (P-R03), its answers to
 *            the circle's invitations and its votes in its polls (P-X01), its
 *            requests of the private salon (P-X08), its entries in the LIVE
 *            RELEASES with their add-ons and its interest in them, its orders
 *            with their steps, the buyer's name and address Client Services
 *            entered and the engraving text (plan LIVE RELEASE+), its messages
 *            with ORBES Client Services and their answers (plan NEXT-NINE,
 *            CS-01: never who answered), and every audit entry that names it,
 *            as target or as actor. Audited `account.export` with counts only.
 *
 * The sheet links the account's conversation with ORBES Client Services
 * (`messages`, plan NEXT-NINE CS-01): its id and status, null when it never
 * wrote. A lock leaves the conversation as it is: staff can still answer it.
 *
 * GROWTH (plan NEXT-NINE, BP-29): the sheet carries the account's lifetime value
 * per currency (`lifetimeValue`, services/growth.ts collectorValue), the rule of
 * COLLECTORS BY VALUE.
 *
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01; services/guarantees.ts): the
 * sheet lists the account's guarantees (`guarantees`), each with its note; the
 * export carries every one, shown to the client or not, with its notes, the
 * grant's and the revocation's (the right of access). A lock unbinds a guarantee from the entries it withdraws or
 * removes and never revokes it.
 *
 * The one-time recovery code of the sheet is AccountRecoveryService's (C-04),
 * not a second mechanism. Emails are masked for an AUDITOR by the routes
 * (routes/admin/serialize.ts `clientEmail`): the service returns them as stored.
 *
 * Lock order: the account row, its open certificate links, the drops of its
 * open entries (FOR SHARE, as ENTER and WITHDRAW), its open requests of the
 * private salon, the LIVE RELEASES of its open entries (FOR UPDATE, as every
 * action on them) and those entries, then the products of its
 * pending transfers (OwnershipService.cancelPendingTransfersFrom), as in an
 * assisted recovery.
 * The audit log is permanent: entries name the account id, never its email.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import type { AccountStatus, AcquiredVia, ClaimRenewalStatus, ClientConversationStatus, JsonObject, OwnershipState, ProductStatus, ReportChannel, TransferStatus } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type ActorType, type Clock, type Page, type PageRequest } from '../types.js';
import { recoveryThrottledUntil } from './account-recovery.js';
import type { AuditService } from './audit.js';
import { normalizeEmail } from './auth.js';
import { accountCircleData, type ExportedCircleAnswer, type ExportedCircleVote } from './circle.js';
import { tierName, tierOf, type ClubTier, type ClubTierName } from './club.js';
import { accountDropEntries, auditWithdrawnEntries, withdrawAccountEntries, type ExportedDropEntry } from './drops.js';
import { accountCareRequests, careThisYear, type CareAllowance, type ExportedCareRequest } from './care.js';
import { accountGuaranteesForStaff, exportedGuarantees, type AdminGuarantee, type ExportedGuarantee } from './guarantees.js';
import { exportedSizes, type ExportedSize } from './sizes.js';
import { exportedAddresses, type ExportedAddress } from './addresses.js';
import { collectorValue, type LifetimeValue } from './growth.js';
import { accountGrants, accountTierGrants, creditBalances, type ExportedTierGrant } from './tier-grants.js';
import { accountConversation, accountMessages, type ExportedMessage } from './messages.js';
import { accountLiveData, auditRemovedLiveEntries, removeAccountLiveEntries, type ExportedLiveEntry, type ExportedLiveInterest } from './live.js';
import { participatedReleases, releasesTakenPart } from './participation.js';
import { accountReleaseAnswers, type ExportedReleaseAnswer } from './question.js';
import { memberSegments } from './segments.js';
import { accountOrders, orderReference, type ExportedOrder } from './orders.js';
import { accountClaimCodes } from './claim-renewals.js';
import type { OwnershipService } from './ownership.js';
import { accountShopRequests, auditClosedShopRequests, closeAccountShopRequests, type ExportedShopRequest } from './salon.js';
import { accountCertificates, auditWithdrawnCertificates, withdrawAccountCertificates, type AccountCertificate } from './ownership-certificates.js';
import type { SessionService } from './sessions.js';

/** Latest scans shown on an owner's sheet. */
export const OWNER_SHEET_SCANS = 20;
/** Scans a REF can match: 8 hexadecimal characters are 32 bits, so more than one is rare. */
export const REFERENCE_MATCH_LIMIT = 20;
/** Bound of each list of an export (scans, activity); beyond it the export says it was truncated. */
export const EXPORT_LIST_LIMIT = 50_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `REF 1A2B3C4D`, `1a2b3c4d`, or a whole scan id. */
const REFERENCE_RE = /^(?:REF[\s:#-]*)?([0-9a-f]{8})(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

/** The REF the verify app prints under a result: the first 8 characters of the scan id, upper case. */
export function scanReference(scanId: string): string {
  return scanId.slice(0, 8).toUpperCase();
}

/**
 * A REF as staff type it (`REF 1A2B3C4D`, any case, or the whole scan id): the scan-id range it stands for,
 * or undefined when it is not one.
 */
export function parseScanReference(input: unknown): { from: string; to: string } | undefined {
  if (typeof input !== 'string') return undefined;
  const m = REFERENCE_RE.exec(input.trim());
  if (!m) return undefined;
  const head = m[1].toLowerCase();
  if (m[2]) {
    const id = `${head}${m[2].toLowerCase()}`;
    return { from: id, to: id };
  }
  return { from: `${head}-0000-0000-0000-000000000000`, to: `${head}-ffff-ffff-ffff-ffffffffffff` };
}

export interface OwnerSummary {
  id: string;
  /** As stored; the routes mask it for an AUDITOR. */
  email: string;
  displayName: string | null;
  country: string | null;
  status: AccountStatus;
  createdAt: Date;
  /** Pieces owned now. */
  products: number;
  /** Pieces ever owned. */
  productsEver: number;
  /** After an assisted recovery, new transfers out of the account are refused until then (72 hours). */
  transfersPausedUntil: Date | null;
  /** The expiry of the open recovery code, while it can still be used. */
  recoveryCodeExpiresAt: Date | null;
  /**
   * After 5 wrong guesses at the open code within an hour (C-04), it is refused without being checked until then;
   * null otherwise. A new code starts with the whole budget.
   */
  recoveryCodeThrottledUntil: Date | null;
}

/** A scan found by its REF, with the accounts it leads to. */
export interface ReferenceMatch {
  scanId: string;
  reference: string;
  occurredAt: Date;
  eventType: string;
  state: string;
  /** Canonical id of the scanned piece, null for a code the registry does not know. */
  productId: string | null;
  /** The account signed in when it scanned, if any. */
  scannedBy: string | null;
  /** The piece's current owner, if any. */
  ownerId: string | null;
}

export interface OwnerList extends Page<OwnerSummary> {
  /** Only for a `ref` search: the scans the REF names, newest first. */
  scans?: ReferenceMatch[];
}

export interface OwnerListFilter {
  email?: string;
  ref?: string;
}

export interface OwnedPiece {
  productId: string;
  model: string;
  type: string;
  material: string;
  variant: string | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  acquiredVia: AcquiredVia;
  verified: boolean;
  since: Date;
  /** Null while the account owns it. */
  until: Date | null;
  endedReason: string | null;
}

export interface TransferInProgress {
  id: string;
  productId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AccountScan {
  id: string;
  reference: string;
  occurredAt: Date;
  eventType: string;
  state: string;
  productId: string | null;
  country: string | null;
}

/** A release a collector took part in (participation.ts), and the pieces it secured there (its after-room's included). */
export interface ClientRelease {
  id: string;
  kind: 'LIVE' | 'DRAW';
  title: string;
  opensAt: Date;
  /** Pieces secured: its LIVE entries CONFIRMED (their quantity), its draw entry CONFIRMED; 0: it took part. */
  secured: number;
}

/** A collector's I'LL BE THERE for a LIVE RELEASE, and what became of it. */
export interface ClientInterest {
  dropId: string;
  title: string;
  size: string;
  since: Date;
  opensAt: Date;
  /** UPCOMING before its T0; CAME when it had a place in the line; DID_NOT_COME otherwise; CANCELLED with the release. */
  outcome: 'UPCOMING' | 'CAME' | 'DID_NOT_COME' | 'CANCELLED';
}

/** A note ORBES Client Services wrote about one of the collector's dealings, with what it is about and who wrote it. */
export interface ClientNote {
  at: Date;
  /** An order's step (its reference), a draw's entry, a request of the private salon closed (its model), a LIVE reservation concluded. */
  about: 'ORDER' | 'DRAW' | 'SALON' | 'LIVE';
  /** What it concerns: the order's OR- reference, the release's title, the model's name. */
  subject: string;
  /** The order, for an ORDER note. */
  orderId: string | null;
  text: string;
  /** The console user who wrote it, by email; null for a script. */
  by: string | null;
}

export interface OwnerSheet {
  owner: OwnerSummary;
  /** P-X04: the account's tier in the club now (0 and null: none), the pieces it counts and the full years since its first ownership. */
  tier: { level: ClubTier; name: ClubTierName | null; pieces: number; seniority: number };
  /** Owned now first, then owned before; newest first within each. */
  pieces: OwnedPiece[];
  /** Transfers offered by the account and still open. */
  transfers: TransferInProgress[];
  /** The OWNER_SHEET_SCANS latest scans made while signed in to the account. */
  scans: AccountScan[];
  /** N4: the releases it took part in, the latest first; `count` of them, `secured` the pieces secured in all. */
  releases: { count: number; secured: number; items: ClientRelease[] };
  /** N4: its answers to the questions after the LIVE RELEASES, the latest first. */
  answers: ExportedReleaseAnswer[];
  /** N4: its I'LL BE THERE, the latest release first. */
  interest: ClientInterest[];
  /** N4: the segments it belongs to now, by name. */
  segments: { id: string; name: string }[];
  /** N4: Client Services' notes on its orders, entries and requests, the latest first. */
  notes: ClientNote[];
  /** CS-01: the account's conversation with ORBES Client Services, its status; null when it never wrote. */
  messages: { conversationId: string; status: ClientConversationStatus } | null;
  /** BP-19 T10: the account's Club block (ownerClub). */
  club: OwnerClub;
  /** IN-01: the house's guarantees granted to the account, the open ones first (services/guarantees.ts). */
  guarantees: AdminGuarantee[];
  /**
   * BP-29: the account's lifetime value per currency, by GROWTH's rule (services/growth.ts collectorValue): its app
   * orders at their invoiced price after credit notes, and its pieces registered from elsewhere at their model's price.
   * Empty: no priced piece.
   */
  lifetimeValue: LifetimeValue;
}

/** BP-19 T10: what the tier program gave the account and what is in use (the console's Club block). */
export interface OwnerClub {
  tier: ClubTierName | null;
  /** Its grants, PLATINE's first: a credit with what is left and until when; a gift, pending, with an order, or delivered. */
  grants: {
    tier: ClubTierName;
    kind: 'GIFT' | 'CREDIT';
    grantedAt: Date;
    amountMinor: number | null;
    balanceMinor: number | null;
    currency: string | null;
    expiresAt: Date | null;
    gift: { state: 'PENDING' | 'WITH_ORDER' | 'DELIVERED'; orderId: string | null; orderReference: string | null } | null;
  }[];
  /** Its yearly care of the year, and the open request (a link to it); null when its tier gives none and none is open. */
  careThisYear: { year: number; used: number; allowance: CareAllowance; open: { id: string; productId: string } | null } | null;
}

export interface LockOutcome {
  sessionsRevoked: number;
  /** Ids of the pending transfers the lock cancelled. */
  transfersCancelled: string[];
  /** The open recovery code the lock revoked (0 or 1). */
  recoveryCodesRevoked: number;
  /** The account's links to ownership certificates the lock withdrew (F-06). */
  certificatesRevoked: number;
  /** The account's entries in drops not drawn yet the lock withdrew (P-R03). */
  dropEntriesWithdrawn: number;
  /** The account's open requests of the private salon the lock closed (P-X08). */
  shopRequestsClosed: number;
  /** The account's open entries in the LIVE RELEASES the lock removed. */
  liveEntriesRemoved: number;
  /** The account's interest (I'LL BE THERE) in LIVE RELEASES not opened yet the lock withdrew. */
  liveInterestWithdrawn: number;
}

/**
 * An ownership period as the export gives it. A piece the account owns now keeps its status and ownership state,
 * in the public vocabulary (a piece flagged as counterfeit reads REVOKED, BRAND §4.1); a piece it owned before carries
 * neither: they now describe the next owner (a LOST or STOLEN declaration, a transfer under way), not this account.
 */
export type ExportedPiece = Omit<OwnedPiece, 'status' | 'ownershipState'> & { status?: ProductStatus; ownershipState?: OwnershipState };

/** The status of a piece the account owns, as its export names it: no internal flag reaches the customer. */
export function exportedStatus(status: ProductStatus): ProductStatus {
  return status === 'COUNTERFEIT_FLAGGED' ? 'REVOKED' : status;
}

/** The answer to a request under the right of access: what the registry holds about one account. */
export interface AccountExport {
  format: 'orbes.account-export';
  version: 1;
  exportedAt: Date;
  account: {
    id: string;
    email: string;
    displayName: string | null;
    country: string | null;
    status: AccountStatus;
    createdAt: Date;
    updatedAt: Date;
    transfersPausedUntil: Date | null;
  };
  pieces: ExportedPiece[];
  transfers: { id: string; productId: string; direction: 'OUT' | 'IN'; status: TransferStatus; createdAt: Date; expiresAt: Date; completedAt: Date | null }[];
  scans: {
    reference: string;
    occurredAt: Date;
    eventType: string;
    state: string;
    productId: string | null;
    country: string | null;
    region: string | null;
    lat: number | null;
    lon: number | null;
    /** The browser family of the scan, e.g. `Safari/iOS` (never the whole user agent). */
    userAgentFamily: string | null;
    /** What the app measured while decoding (corrections, module size, decode time, camera or upload), as stored. */
    clientMetrics: JsonObject | null;
    /** The customer's answer to WHERE DID YOU SEE OR BUY THIS PIECE? on that scan (C-02). */
    report: { channel: ReportChannel; place: string | null; note: string | null; createdAt: Date } | null;
  }[];
  sessions: { createdAt: Date; lastSeenAt: Date; expiresAt: Date; userAgent: string | null }[];
  recoveryCodes: { createdAt: Date; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }[];
  /**
   * The links to ownership certificates the account created (F-06), in its current and past ownership periods, oldest
   * first: the piece, creation, expiry, withdrawal (by the owner, or with a lock or an assisted recovery) and the state
   * a reader of the link meets now. Never the token.
   */
  certificates: AccountCertificate[];
  /**
   * The account's entries in the drops (P-R03), oldest first: the release, the status, the entry's id (the one a
   * drawn release publishes with its tier, seniority and rank), the end of a place held and the note ORBES Client
   * Services added on its conclusion; never who concluded it.
   */
  dropEntries: ExportedDropEntry[];
  /** The account's answers to the invitations of the circle (P-X01), oldest first: the post, YES or NO, when. */
  circleAnswers: ExportedCircleAnswer[];
  /** The account's votes in the polls of the circle (P-X01), oldest first: the post, the option and its words, when. */
  circleVotes: ExportedCircleVote[];
  /**
   * The account's requests of the private salon (P-X08), oldest first: the model, the account's note, the status, when,
   * and the note ORBES Client Services added on closing it; never who closed it.
   */
  shopRequests: ExportedShopRequest[];
  /**
   * The account's entries in the LIVE RELEASES, oldest first: the release, the size and quantity, the status, its place,
   * the times of its turn, its gesture and its hold, its add-ons with their prices, its country, and the note ORBES
   * Client Services added on concluding it; never who let it in, removed it or concluded it.
   */
  liveEntries: ExportedLiveEntry[];
  /** The account's interest in the LIVE RELEASES (I'LL BE THERE), oldest first: the release, the size, since when. */
  liveInterest: ExportedLiveInterest[];
  /** The account's answers to the questions after the LIVE RELEASES (plan LIVE RELEASE+), oldest first: the release, the question, the answer, when. */
  releaseAnswers: ExportedReleaseAnswer[];
  /**
   * The account's orders (plan LIVE RELEASE+), oldest first: the channel and release, the model, size, price and
   * add-ons, the engraving text, the delivery address (name, lines, country and phone), each step with its time and
   * note, the carrier and the tracking number; never who handled it, nor where the piece is kept.
   */
  orders: ExportedOrder[];
  /**
   * The account's messages with ORBES Client Services (plan NEXT-NINE, CS-01), oldest first: its words with what each
   * concerned, and the answers, signed ORBES Client Services; never who answered.
   */
  messages: ExportedMessage[];
  /**
   * The account's yearly care requests (plan NEXT-NINE, BP-19 T6), oldest first: the piece, the year and the tier, each
   * step's time, and the name and address the piece returns to as the collector gave them; never who handled it.
   */
  careRequests: ExportedCareRequest[];
  /**
   * The house's guarantees granted to the account (plan NEXT-NINE, IN-01), oldest first: every one, shown to the client
   * or not, with Client Services' notes, the grant's and the revocation's (the right of access requires them); never who granted it.
   */
  guarantees: ExportedGuarantee[];
  /** The sizes the account saved in YOUR SIZES (plan NEXT-NINE, AC-01): each kind's value in its unit, and when it was saved. */
  sizes: ExportedSize[];
  /**
   * The delivery addresses the account saved in YOUR ADDRESSES (plan NEXT LOT §3.6.B), oldest first: each one's name,
   * lines, country, phone, whether it is the default, and when it was saved and changed.
   */
  addresses: ExportedAddress[];
  /**
   * The new claim codes ORBES Client Services made for the account's orders (plan NEXT LOT §3.4), oldest first: the
   * order, when it was made, where it stands and when it was read; never the code, sealed or clear, nor who made it.
   */
  claimCodes: { order: string; madeAt: Date; status: ClaimRenewalStatus; readAt: Date | null }[];
  /**
   * The tiers' grants of the account (plan NEXT-NINE, BP-19 T5), oldest first: each welcome GIFT (its model once an
   * order carries it) and each CREDIT with its amount, currency, expiry, balance and uses (the order, the amount, when
   * taken off and given back, and why); never who applied or released them.
   */
  tierGrants: ExportedTierGrant[];
  /**
   * Every audit entry that names the account, oldest first: those about it (sign-ins, password changes, recovery,
   * lock) and those it made (pieces registered, claim codes tried, transfers, incidents declared, reports on scans).
   */
  activity: {
    occurredAt: Date;
    action: string;
    by: ActorType;
    /** The piece the entry was about, by its canonical id. */
    productId: string | null;
    /** The scan the entry was about, by its REF (never its whole id). */
    reference: string | null;
    /** The status the entry gave the piece: LOST or STOLEN for a declared incident, the one it returned to for a loss withdrawn by its owner, the new one for a change of status. */
    status: string | null;
  }[];
  /** Lists cut at EXPORT_LIST_LIMIT entries (empty when complete). */
  truncated: ('scans' | 'activity')[];
  /** What the registry holds but cannot give back in a readable form. */
  notIncluded: string[];
}

export const EXPORT_NOT_INCLUDED: readonly string[] = Object.freeze([
  'The password and the recovery codes, stored only as one-way scrypt hashes.',
  'The links to ownership certificates: only a one-way SHA-256 of their token is stored.',
  'The IP address and device cookie behind each scan, session and audit entry: never stored; only keyed one-way pseudonyms (HMAC) are kept, which identify nothing on their own.',
  'The network behind each entry of a LIVE RELEASE: only a keyed one-way hash of its prefix is kept, and erased 30 days after the release.',
]);

export interface OwnerServiceDeps {
  db: Db;
  audit: AuditService;
  sessions: SessionService;
  ownership: OwnershipService;
  clock?: Clock;
}

type Scope = { kind: 'all' } | { kind: 'email'; normalized: string } | { kind: 'ids'; ids: string[] };

function assertStaff(actor: Actor, what: string): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden(`Only an ORBES admin can ${what}.`);
}

function assertAccountId(accountId: string): void {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
}

export class OwnerService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly sessions: SessionService;
  private readonly ownership: OwnershipService;
  private readonly clock: Clock;

  constructor(deps: OwnerServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.sessions = deps.sessions;
    this.ownership = deps.ownership;
    this.clock = deps.clock ?? systemClock;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /** Every account, one email, or the accounts behind a REF (see the file header). Never both filters. */
  async list(filter: OwnerListFilter, page: PageRequest): Promise<OwnerList> {
    if (filter.email !== undefined && filter.ref !== undefined) throw validationError('Search by email or by REF, not both.');
    if (filter.email !== undefined) {
      const email = normalizeEmail(filter.email);
      if (!email) throw validationError('Enter the whole email address of the account.');
      return this.summaries({ kind: 'email', normalized: email.normalized }, page);
    }
    if (filter.ref !== undefined) {
      const range = parseScanReference(filter.ref);
      if (!range) throw validationError('A REF is the 8 characters (0–9, A–F) printed after REF under a result.');
      const scans = await this.referenceMatches(range);
      const ids = [...new Set(scans.flatMap((s) => [s.scannedBy, s.ownerId]).filter((id): id is string => id !== null))];
      return { ...(await this.summaries({ kind: 'ids', ids }, page)), scans };
    }
    return this.summaries({ kind: 'all' }, page);
  }

  /** The account's Club block (BP-19 T10): its grants with their balances and gifts, its yearly care of the year. */
  private async ownerClub(accountId: string, tier: ClubTier, now: Date): Promise<OwnerClub> {
    const [grants, balances, care] = await Promise.all([accountGrants(this.db, accountId), creditBalances(this.db, accountId), careThisYear(this.db, accountId, now)]);
    const giftIds = grants.filter((g) => g.kind === 'GIFT').map((g) => g.id);
    const giftOrders = giftIds.length
      ? await this.db.selectFrom('orders').select(['gift_grant_id', 'status', 'with_order_id']).where('gift_grant_id', 'in', giftIds).where('status', '<>', 'CANCELLED').execute()
      : [];
    return {
      tier: tierName(tier),
      grants: grants
        .slice()
        .sort((a, b) => a.tier - b.tier || (a.kind < b.kind ? 1 : -1))
        .map((g) => {
          const balance = balances.find((b) => b.grantId === g.id);
          const order = giftOrders.find((o) => o.gift_grant_id === g.id);
          return {
            tier: tierName(g.tier as ClubTier)!,
            kind: g.kind,
            grantedAt: g.granted_at,
            amountMinor: g.amount_minor,
            balanceMinor: balance ? balance.balanceMinor : null,
            currency: g.currency,
            expiresAt: g.expires_at,
            gift:
              g.kind === 'GIFT'
                ? {
                    state: !order ? 'PENDING' : order.status === 'DELIVERED' || order.status === 'RETURNED' ? 'DELIVERED' : 'WITH_ORDER',
                    orderId: order?.with_order_id ?? null,
                    orderReference: order?.with_order_id ? orderReference(order.with_order_id) : null,
                  }
                : null,
          };
        }),
      careThisYear: care.allowance === 0 && !care.open ? null : { year: care.year, used: care.used, allowance: care.allowance, open: care.open },
    };
  }

  /** One account's sheet: the account, its pieces, its transfers in progress and its latest scans. */
  async sheet(accountId: string): Promise<OwnerSheet> {
    assertAccountId(accountId);
    const found = await this.summaries({ kind: 'ids', ids: [accountId] }, { page: 1, pageSize: 1 });
    const owner = found.items[0];
    if (!owner) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const now = this.clock();
    const [standing, pieces, transfers, scans, client, conversation] = await Promise.all([
      tierOf(this.db, owner.id, now),
      this.pieces(this.db, owner.id),
      this.db
        .selectFrom('ownership_transfers as t')
        .innerJoin('products as p', 'p.id', 't.product_id')
        .select(['t.id', 'p.product_id', 't.created_at', 't.expires_at'])
        .where('t.from_account_id', '=', owner.id)
        .where('t.status', '=', 'PENDING')
        .where('t.expires_at', '>', now)
        .orderBy('t.created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('scan_events as s')
        .leftJoin('products as p', 'p.id', 's.product_id')
        .select(['s.id', 's.occurred_at', 's.event_type', 's.result_state', 's.country', 'p.product_id'])
        .where('s.account_id', '=', owner.id)
        .orderBy('s.occurred_at', 'desc')
        .orderBy('s.id')
        .limit(OWNER_SHEET_SCANS)
        .execute(),
      this.client(owner.id, now),
      accountConversation(this.db, owner.id),
    ]);
    const club = await this.ownerClub(owner.id, standing.tier, now);
    const guarantees = await accountGuaranteesForStaff(this.db, owner.id, now);
    const lifetimeValue = await collectorValue(this.db, owner.id);
    return {
      ...client,
      owner,
      tier: { level: standing.tier, name: tierName(standing.tier), pieces: standing.pieces, seniority: standing.seniority },
      club,
      pieces,
      transfers: transfers.map((t) => ({ id: t.id, productId: t.product_id, createdAt: t.created_at, expiresAt: t.expires_at })),
      scans: scans.map((s) => ({
        id: s.id,
        reference: scanReference(s.id),
        occurredAt: s.occurred_at,
        eventType: s.event_type,
        state: s.result_state,
        productId: s.product_id ?? null,
        country: s.country?.trim() ?? null,
      })),
      messages: conversation,
      guarantees,
      lifetimeValue,
    };
  }

  /** N4: what the client sheet adds to the account's (see the file header). */
  private async client(accountId: string, now: Date): Promise<Pick<OwnerSheet, 'releases' | 'answers' | 'interest' | 'segments' | 'notes'>> {
    const [took, answers, interest, segments, notes] = await Promise.all([
      this.releases(accountId, now),
      accountReleaseAnswers(this.db, accountId),
      this.interest(accountId, now),
      this.segmentsOf(accountId, now),
      this.notes(accountId),
    ]);
    return { releases: took, answers: answers.reverse(), interest, segments, notes };
  }

  /** The releases taken part in, the latest first, with the pieces secured in each (an after-room's in its release). */
  private async releases(accountId: string, now: Date): Promise<OwnerSheet['releases']> {
    const took = await releasesTakenPart(this.db, accountId, now);
    if (took.length === 0) return { count: 0, secured: 0, items: [] };
    const ids = took.map((t) => t.id);
    const [drops, live, draw] = await Promise.all([
      this.db.selectFrom('drops').select(['id', 'mode', 'title', 'opens_at']).where('id', 'in', ids).execute(),
      this.db
        .selectFrom('live_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select([sql<string>`coalesce(d.parent_drop_id, d.id)`.as('release_id'), (eb) => eb.fn.sum<number>('e.quantity').as('n')])
        .where('e.account_id', '=', accountId)
        .where('e.status', '=', 'CONFIRMED')
        .groupBy(sql`coalesce(d.parent_drop_id, d.id)`)
        .execute(),
      this.db
        .selectFrom('drop_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select(['e.drop_id as release_id', (eb) => eb.fn.countAll<number>().as('n')])
        .where('e.account_id', '=', accountId)
        .where('e.status', '=', 'CONFIRMED')
        .where('d.mode', '=', 'DRAW')
        .groupBy('e.drop_id')
        .execute(),
    ]);
    const securedIn = new Map<string, number>();
    for (const r of [...live, ...draw]) securedIn.set(r.release_id, (securedIn.get(r.release_id) ?? 0) + Number(r.n));
    const items = drops
      .map((d): ClientRelease => ({ id: d.id, kind: d.mode === 'LIVE' ? 'LIVE' : 'DRAW', title: d.title, opensAt: d.opens_at, secured: securedIn.get(d.id) ?? 0 }))
      .sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime() || a.id.localeCompare(b.id));
    return { count: items.length, secured: items.reduce((n, r) => n + r.secured, 0), items };
  }

  /** Its I'LL BE THERE, the latest release first, and whether it came. */
  private async interest(accountId: string, now: Date): Promise<ClientInterest[]> {
    const rows = await this.db
      .selectFrom('live_interest as i')
      .innerJoin('drops as d', 'd.id', 'i.drop_id')
      .innerJoin('drop_sizes as s', 's.id', 'i.size_id')
      .select(['i.drop_id', 'd.title', 'd.opens_at', 'd.cancelled_at', 's.label', 'i.created_at'])
      .where('i.account_id', '=', accountId)
      .orderBy('d.opens_at', 'desc')
      .orderBy('i.drop_id')
      .execute();
    if (rows.length === 0) return [];
    const came = await participatedReleases(this.db, accountId, now);
    return rows.map((r) => ({
      dropId: r.drop_id,
      title: r.title,
      size: r.label,
      since: r.created_at,
      opensAt: r.opens_at,
      outcome: r.cancelled_at !== null ? 'CANCELLED' : r.opens_at.getTime() > now.getTime() ? 'UPCOMING' : came.has(r.drop_id) ? 'CAME' : 'DID_NOT_COME',
    }));
  }

  /** The segments it belongs to now, by name (each read live, as a release's access rule reads it). */
  private async segmentsOf(accountId: string, now: Date): Promise<{ id: string; name: string }[]> {
    const all = await this.db.selectFrom('segments').select(['id', 'name']).orderBy('name').orderBy('id').execute();
    if (all.length === 0) return [];
    const member = await memberSegments(this.db, accountId, all.map((x) => x.id), now);
    return all.filter((x) => member.has(x.id)).map((x) => ({ id: x.id, name: x.name }));
  }

  /** Client Services' notes on the account's orders, draw entries, requests of the private salon and LIVE reservations. */
  private async notes(accountId: string): Promise<ClientNote[]> {
    const [orders, draws, requests, live] = await Promise.all([
      this.db
        .selectFrom('order_events as e')
        .innerJoin('orders as o', 'o.id', 'e.order_id')
        .select(['e.order_id', 'e.note', 'e.created_at', 'e.actor_type', 'e.actor_id'])
        .where('o.account_id', '=', accountId)
        .where('e.note', 'is not', null)
        .execute(),
      this.db
        .selectFrom('drop_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select(['d.title', 'e.note', 'e.handled_at', 'e.created_at', 'e.handled_by'])
        .where('e.account_id', '=', accountId)
        .where('e.note', 'is not', null)
        .execute(),
      this.db
        .selectFrom('shop_requests as r')
        .innerJoin('models as m', 'm.id', 'r.model_id')
        .select(['m.name', 'r.resolution_note', 'r.handled_at', 'r.created_at', 'r.handled_by'])
        .where('r.account_id', '=', accountId)
        .where('r.resolution_note', 'is not', null)
        .execute(),
      this.db
        .selectFrom('live_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select(['d.title', 'e.resolution_note', 'e.handled_at', 'e.joined_at', 'e.handled_by'])
        .where('e.account_id', '=', accountId)
        .where('e.resolution_note', 'is not', null)
        .execute(),
    ]);
    const adminIds = [
      ...new Set(
        [
          ...orders.filter((o) => o.actor_type === 'admin').map((o) => o.actor_id),
          ...draws.map((d) => d.handled_by),
          ...requests.map((r) => r.handled_by),
          ...live.map((l) => l.handled_by),
        ].filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
      ),
    ];
    const admins = adminIds.length ? await this.db.selectFrom('admin_users').select(['id', 'email']).where('id', 'in', adminIds).execute() : [];
    const by = (id: string | null | undefined) => (id ? (admins.find((a) => a.id === id)?.email ?? null) : null);
    const notes: ClientNote[] = [
      ...orders.map((o) => ({ at: o.created_at, about: 'ORDER' as const, subject: orderReference(o.order_id), orderId: o.order_id, text: o.note!, by: o.actor_type === 'admin' ? by(o.actor_id) : null })),
      ...draws.map((d) => ({ at: d.handled_at ?? d.created_at, about: 'DRAW' as const, subject: d.title, orderId: null, text: d.note!, by: by(d.handled_by) })),
      ...requests.map((r) => ({ at: r.handled_at ?? r.created_at, about: 'SALON' as const, subject: r.name, orderId: null, text: r.resolution_note!, by: by(r.handled_by) })),
      ...live.map((l) => ({ at: l.handled_at ?? l.joined_at, about: 'LIVE' as const, subject: l.title, orderId: null, text: l.resolution_note!, by: by(l.handled_by) })),
    ];
    return notes.sort((a, b) => b.at.getTime() - a.at.getTime() || a.subject.localeCompare(b.subject));
  }

  // ── Lock ─────────────────────────────────────────────────────────────────

  /**
   * Lock an ACTIVE account (an ADMIN of ORBES Client Services): every session ends, the pending transfers
   * it offered are cancelled, its open certificate links are withdrawn, its open entries in the drops withdrawn, its
   * open requests of the private salon closed, its open entries in the LIVE RELEASES removed and its interest in those
   * not opened yet withdrawn, and its open recovery code is revoked, in one transaction.
   * 409 ACCOUNT_ALREADY_LOCKED, ACCOUNT_NOT_ACTIVE (deleted).
   */
  async lock(accountId: string, actor: Actor): Promise<LockOutcome> {
    assertStaff(actor, 'lock an account');
    assertAccountId(accountId);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const account = await tx.selectFrom('accounts').select(['id', 'status']).where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (account.status === 'LOCKED') throw conflict('ACCOUNT_ALREADY_LOCKED', 'This account is already locked.');
      if (account.status !== 'ACTIVE') throw conflict('ACCOUNT_NOT_ACTIVE', 'Only an active account can be locked.');
      await tx.updateTable('accounts').set({ status: 'LOCKED', updated_at: now }).where('id', '=', account.id).execute();
      const sessionsRevoked = await this.sessions.revokeAllForSubject('account', account.id, {}, tx);
      // A code issued before the lock may be the takeover itself (a fooled identity check, THREAT-MODEL U):
      // it does not outlive the lock. After the unlock, Client Services issues a new one if the client needs it.
      const revoked = await tx
        .updateTable('account_recovery_codes')
        .set({ revoked_at: now })
        .where('account_id', '=', account.id)
        .where('used_at', 'is', null)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', now)
        .returning('id')
        .execute();
      const recoveryCodesRevoked = revoked.length;
      // Links to ownership certificates created by whoever held the account stop showing the record (THREAT-MODEL Y).
      const certificates = await withdrawAccountCertificates(tx, account.id, now);
      // Its entries in drops not drawn yet leave their draw (P-R03): the drops FOR SHARE, as ENTER and WITHDRAW take them.
      const entries = await withdrawAccountEntries(tx, account.id);
      // Its open requests of the private salon are closed (P-X08): ORBES Client Services does not follow them up.
      const shopRequests = await closeAccountShopRequests(tx, account.id, actor, now);
      // Its open entries in the LIVE RELEASES leave them (REMOVED), its interest in those not opened yet is withdrawn.
      const live = await removeAccountLiveEntries(tx, account.id, actor, now);
      // Last of the writes: it audits each cancellation, and no row is locked after the audit chain's lock.
      const transfersCancelled = await this.ownership.cancelPendingTransfersFrom(tx, account.id, actor, 'account_locked');
      await auditWithdrawnCertificates(this.audit, tx, actor, certificates, 'account_locked');
      await auditWithdrawnEntries(this.audit, tx, actor, entries, 'account_locked');
      await auditClosedShopRequests(this.audit, tx, actor, shopRequests, 'account_locked');
      await auditRemovedLiveEntries(this.audit, tx, actor, live, 'account_locked');
      const certificatesRevoked = certificates.length;
      const dropEntriesWithdrawn = entries.length;
      const shopRequestsClosed = shopRequests.length;
      const liveEntriesRemoved = live.entries.length;
      const liveInterestWithdrawn = live.interest.length;
      await this.audit.record(
        {
          actor,
          action: 'account.lock',
          targetType: 'account',
          targetId: account.id,
          details: {
            sessionsRevoked,
            transfersCancelled: transfersCancelled.length,
            recoveryCodesRevoked,
            certificatesRevoked,
            dropEntriesWithdrawn,
            shopRequestsClosed,
            liveEntriesRemoved,
            liveInterestWithdrawn,
          },
        },
        tx,
      );
      return { sessionsRevoked, transfersCancelled, recoveryCodesRevoked, certificatesRevoked, dropEntriesWithdrawn, shopRequestsClosed, liveEntriesRemoved, liveInterestWithdrawn };
    });
  }

  /** Unlock a LOCKED account: it signs in again. 409 ACCOUNT_NOT_LOCKED. */
  async unlock(accountId: string, actor: Actor): Promise<void> {
    assertStaff(actor, 'unlock an account');
    assertAccountId(accountId);
    await inTransaction(this.db, async (tx) => {
      const account = await tx.selectFrom('accounts').select(['id', 'status']).where('id', '=', accountId).forUpdate().executeTakeFirst();
      if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (account.status !== 'LOCKED') throw conflict('ACCOUNT_NOT_LOCKED', 'This account is not locked.');
      await tx.updateTable('accounts').set({ status: 'ACTIVE', updated_at: this.clock() }).where('id', '=', account.id).execute();
      await this.audit.record({ actor, action: 'account.unlock', targetType: 'account', targetId: account.id }, tx);
    });
  }

  // ── Right of access ──────────────────────────────────────────────────────

  /** Everything the registry holds about the account, readable (see AccountExport). Audited `account.export`. */
  async exportData(accountId: string, actor: Actor): Promise<AccountExport> {
    assertStaff(actor, 'export an account');
    assertAccountId(accountId);
    return inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const a = await tx.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
      if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      // One after the other: the transaction holds a single connection.
      const pieces = await this.pieces(tx, a.id);
      const transfers = await tx
        .selectFrom('ownership_transfers as t')
        .innerJoin('products as p', 'p.id', 't.product_id')
        .select(['t.id', 'p.product_id', 't.from_account_id', 't.status', 't.created_at', 't.expires_at', 't.completed_at'])
        .where((eb) => eb.or([eb('t.from_account_id', '=', a.id), eb('t.to_account_id', '=', a.id)]))
        .orderBy('t.created_at')
        .execute();
      const scans = await tx
        .selectFrom('scan_events as s')
        .leftJoin('products as p', 'p.id', 's.product_id')
        .leftJoin('scan_reports as r', 'r.scan_event_id', 's.id')
        .select([
          's.id',
          's.occurred_at',
          's.event_type',
          's.result_state',
          's.country',
          's.region',
          's.lat',
          's.lon',
          's.user_agent_family',
          's.client_metrics',
          'p.product_id',
          'r.channel',
          'r.place',
          'r.note',
          'r.created_at as report_created_at',
        ])
        .where('s.account_id', '=', a.id)
        .orderBy('s.occurred_at')
        .orderBy('s.id')
        .limit(EXPORT_LIST_LIMIT + 1)
        .execute();
      const sessions = await tx
        .selectFrom('sessions')
        .select(['created_at', 'last_seen_at', 'expires_at', 'user_agent'])
        .where('subject_type', '=', 'account')
        .where('subject_id', '=', a.id)
        .orderBy('created_at')
        .execute();
      const codes = await tx
        .selectFrom('account_recovery_codes')
        .select(['created_at', 'expires_at', 'used_at', 'revoked_at'])
        .where('account_id', '=', a.id)
        .orderBy('created_at')
        .execute();
      // Withdrawn ones too: a withdrawal by a lock is audited with the ADMIN as actor and the piece as target, so the
      // activity below does not name the account for it.
      const certificates = await accountCertificates(tx, a.id, now);
      const dropEntries = await accountDropEntries(tx, a.id);
      const circle = await accountCircleData(tx, a.id);
      const shopRequests = await accountShopRequests(tx, a.id);
      const live = await accountLiveData(tx, a.id);
      const releaseAnswers = await accountReleaseAnswers(tx, a.id);
      const orders = await accountOrders(tx, a.id);
      const messages = await accountMessages(tx, a.id);
      const careRequests = await accountCareRequests(tx, a.id);
      const guarantees = await exportedGuarantees(tx, a.id);
      const sizes = await exportedSizes(tx, a.id);
      const addresses = await exportedAddresses(tx, a.id);
      const claimCodes = await accountClaimCodes(tx, a.id);
      const tierGrants = await accountTierGrants(tx, a.id);
      // Every entry that names the account: about it (target), or made by it (actor: claim codes tried, incidents
      // declared, transfers, reports on scans). audit_logs has no index on the actor, so this reads the whole log:
      // accepted for a rare ADMIN request (DATABASE §5.21).
      const activity = await tx
        .selectFrom('audit_logs')
        .select([
          'occurred_at',
          'action',
          'actor_type',
          'target_type',
          'target_id',
          // The status an entry gave a piece; nothing else of `details`, which can name staff or other accounts.
          sql<string | null>`CASE
            WHEN target_type = 'product' AND action IN ('product.transition', 'product.reinstate') THEN details->>'to'
            WHEN target_type = 'product' AND action = 'ownership.incident' THEN details->>'type'
            WHEN target_type = 'product' AND action = 'ownership.incident.resolve' THEN details->>'to'
          END`.as('status'),
        ])
        .where((eb) =>
          eb.or([
            eb.and([eb('target_type', '=', 'account'), eb('target_id', '=', a.id)]),
            eb.and([eb('actor_type', '=', 'account'), eb('actor_id', '=', a.id)]),
          ]),
        )
        .orderBy('id')
        .limit(EXPORT_LIST_LIMIT + 1)
        .execute();
      const truncated: AccountExport['truncated'] = [];
      if (scans.length > EXPORT_LIST_LIMIT) truncated.push('scans');
      if (activity.length > EXPORT_LIST_LIMIT) truncated.push('activity');
      const out: AccountExport = {
        format: 'orbes.account-export',
        version: 1,
        exportedAt: now,
        account: {
          id: a.id,
          email: a.email,
          displayName: a.display_name,
          country: a.country?.trim() ?? null,
          status: a.status,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
          transfersPausedUntil: a.transfers_frozen_until && a.transfers_frozen_until.getTime() > now.getTime() ? a.transfers_frozen_until : null,
        },
        pieces: pieces.map(({ status, ownershipState, ...period }) => (period.until === null ? { ...period, status: exportedStatus(status), ownershipState } : period)),
        transfers: transfers.map((t) => ({
          id: t.id,
          productId: t.product_id,
          direction: t.from_account_id === a.id ? ('OUT' as const) : ('IN' as const),
          // A PENDING row past its expiry reads EXPIRED, as everywhere else.
          status: t.status === 'PENDING' && t.expires_at.getTime() <= now.getTime() ? 'EXPIRED' : t.status,
          createdAt: t.created_at,
          expiresAt: t.expires_at,
          completedAt: t.completed_at,
        })),
        scans: scans.slice(0, EXPORT_LIST_LIMIT).map((s) => ({
          reference: scanReference(s.id),
          occurredAt: s.occurred_at,
          eventType: s.event_type,
          state: s.result_state,
          productId: s.product_id ?? null,
          country: s.country?.trim() ?? null,
          region: s.region,
          lat: s.lat,
          lon: s.lon,
          userAgentFamily: s.user_agent_family,
          clientMetrics: s.client_metrics ?? null,
          report: s.channel ? { channel: s.channel, place: s.place ?? null, note: s.note ?? null, createdAt: s.report_created_at! } : null,
        })),
        sessions: sessions.map((s) => ({ createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, userAgent: s.user_agent })),
        recoveryCodes: codes.map((c) => ({ createdAt: c.created_at, expiresAt: c.expires_at, usedAt: c.used_at, revokedAt: c.revoked_at })),
        certificates,
        dropEntries,
        circleAnswers: circle.answers,
        circleVotes: circle.votes,
        shopRequests,
        liveEntries: live.entries,
        liveInterest: live.interest,
        releaseAnswers,
        orders,
        messages,
        careRequests,
        guarantees,
        sizes,
        addresses,
        claimCodes,
        tierGrants,
        activity: activity.slice(0, EXPORT_LIST_LIMIT).map((e) => ({
          occurredAt: e.occurred_at,
          action: e.action,
          by: e.actor_type,
          productId: e.target_type === 'product' ? e.target_id : null,
          // A scan by its REF: its whole id is never handed over.
          reference: e.target_type === 'scan' && e.target_id !== null ? scanReference(e.target_id) : null,
          status: e.status ?? null,
        })),
        truncated,
        notIncluded: [...EXPORT_NOT_INCLUDED],
      };
      await this.audit.record(
        {
          actor,
          action: 'account.export',
          targetType: 'account',
          targetId: a.id,
          details: {
            pieces: out.pieces.length,
            transfers: out.transfers.length,
            scans: out.scans.length,
            sessions: out.sessions.length,
            recoveryCodes: out.recoveryCodes.length,
            certificates: out.certificates.length,
            dropEntries: out.dropEntries.length,
            circleAnswers: out.circleAnswers.length,
            circleVotes: out.circleVotes.length,
            shopRequests: out.shopRequests.length,
            liveEntries: out.liveEntries.length,
            liveInterest: out.liveInterest.length,
            releaseAnswers: out.releaseAnswers.length,
            orders: out.orders.length,
            messages: out.messages.length,
            careRequests: out.careRequests.length,
            guarantees: out.guarantees.length,
            sizes: out.sizes.length,
            addresses: out.addresses.length,
            claimCodes: out.claimCodes.length,
            tierGrants: out.tierGrants.length,
            activity: out.activity.length,
            ...(truncated.length ? { truncated } : {}),
          },
        },
        tx,
      );
      return out;
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Accounts with their counts, the end of a transfer pause and an open recovery code's expiry, newest first. */
  private async summaries(scope: Scope, page: PageRequest): Promise<OwnerList> {
    if (scope.kind === 'ids' && scope.ids.length === 0) return makePage([], 0, page);
    const now = this.clock();
    const scoped = this.db
      .selectFrom('accounts as a')
      .$if(scope.kind === 'email', (qb) => qb.where('a.email_normalized', '=', (scope as { normalized: string }).normalized))
      .$if(scope.kind === 'ids', (qb) => qb.where('a.id', 'in', (scope as { ids: string[] }).ids));
    const total = await scoped.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await scoped
      .leftJoin('ownership as o', 'o.account_id', 'a.id')
      .select([
        'a.id',
        'a.email',
        'a.display_name',
        'a.country',
        'a.status',
        'a.created_at',
        'a.transfers_frozen_until',
        sql<number>`count(o.id) FILTER (WHERE o.ended_at IS NULL)`.as('current_products'),
        sql<number>`count(o.id)`.as('total_products'),
        // The open recovery code, while it can still be used (one at most per account).
        sql<Date | null>`(SELECT r.expires_at FROM account_recovery_codes r
                           WHERE r.account_id = a.id AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ${now})`.as('recovery_expires_at'),
        sql<string | null>`(SELECT r.id FROM account_recovery_codes r
                             WHERE r.account_id = a.id AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ${now})`.as('recovery_code_id'),
      ])
      .groupBy(['a.id', 'a.email', 'a.display_name', 'a.country', 'a.status', 'a.created_at', 'a.transfers_frozen_until'])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    const throttled = await recoveryThrottledUntil(
      this.db,
      rows.flatMap((r) => (r.recovery_code_id ? [{ accountId: r.id, codeId: r.recovery_code_id }] : [])),
      now,
    );
    return makePage(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        country: r.country?.trim() ?? null,
        status: r.status,
        createdAt: r.created_at,
        products: Number(r.current_products),
        productsEver: Number(r.total_products),
        // After an assisted recovery: new transfers out of the account are refused until then.
        transfersPausedUntil: r.transfers_frozen_until && r.transfers_frozen_until.getTime() > now.getTime() ? r.transfers_frozen_until : null,
        recoveryCodeExpiresAt: r.recovery_expires_at === null ? null : new Date(r.recovery_expires_at),
        recoveryCodeThrottledUntil: (r.recovery_code_id && throttled.get(r.recovery_code_id)) || null,
      })),
      Number(total.n),
      page,
    );
  }

  /** The scans a REF names, with the account that scanned and the piece's current owner. */
  private async referenceMatches(range: { from: string; to: string }): Promise<ReferenceMatch[]> {
    const rows = await this.db
      .selectFrom('scan_events as s')
      .leftJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('ownership as o', (j) => j.onRef('o.product_id', '=', 's.product_id').on('o.ended_at', 'is', null))
      .select(['s.id', 's.occurred_at', 's.event_type', 's.result_state', 's.account_id', 'p.product_id', 'o.account_id as owner_id'])
      .where('s.id', '>=', range.from)
      .where('s.id', '<=', range.to)
      .orderBy('s.occurred_at', 'desc')
      .orderBy('s.id')
      .limit(REFERENCE_MATCH_LIMIT)
      .execute();
    return rows.map((r) => ({
      scanId: r.id,
      reference: scanReference(r.id),
      occurredAt: r.occurred_at,
      eventType: r.event_type,
      state: r.result_state,
      productId: r.product_id ?? null,
      scannedBy: r.account_id,
      ownerId: r.owner_id ?? null,
    }));
  }

  /** Every ownership period of the account: owned now first, then before; newest first within each. */
  private async pieces(db: Db, accountId: string): Promise<OwnedPiece[]> {
    const rows = await db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .select([
        'p.product_id',
        'm.name as model',
        'm.type',
        'p.material',
        'p.variant',
        'p.status',
        'p.ownership_state',
        'o.acquired_via',
        'o.verified',
        'o.started_at',
        'o.ended_at',
        'o.ended_reason',
      ])
      .where('o.account_id', '=', accountId)
      .orderBy('o.started_at', 'desc')
      .orderBy('o.id')
      .execute();
    const pieces = rows.map((r) => ({
      productId: r.product_id,
      model: r.model,
      type: r.type,
      material: r.material,
      variant: r.variant,
      status: r.status,
      ownershipState: r.ownership_state,
      acquiredVia: r.acquired_via,
      verified: r.verified,
      since: r.started_at,
      until: r.ended_at,
      endedReason: r.ended_reason,
    }));
    // Stable: the newest-first order holds within the current and the past pieces.
    return [...pieces.filter((p) => p.until === null), ...pieces.filter((p) => p.until !== null)];
  }
}
