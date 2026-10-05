/**
 * Kysely types for the ORBES database. Mirrors migrations/0001_initial.ts
 * and the later migrations (0002–0022) column for column (snake_case, no CamelCasePlugin) so raw SQL, types and
 * the migration read the same.
 *
 * Driver-normalised value types (configured in connection.ts, identical on
 * pg and PGlite):
 *   timestamptz → Date
 *   date        → 'YYYY-MM-DD' string (no timezone shifting)
 *   bigint/int8 → number (values here are < 2^53; an unsafe value would arrive as a BigInt, never silently rounded)
 *   bytea       → plain Uint8Array (never Buffer); use toBytes() on anything read through other paths
 *   jsonb       → parsed JSON on read; WRITE AS JSON TEXT (string) — see jsonText(). pg would
 *                 otherwise serialise a top-level JS array as a Postgres array literal.
 *   smallint[] / text[] → number[] / string[]
 *
 * The enumerations below are the exact value sets of the CHECK constraints in
 * the migration (a test asserts they match).
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { ActorType } from '../types.js';

// ── Enumerations ───────────────────────────────────────────────────────────

/**
 * RESERVED (migration 0022, L6): an ORBES identity reserved for a piece to make, printed on the atelier's work sheet but
 * not issued; /verify answers it as an unknown code. Never written in product_status_history (PRODUCT_HISTORY_STATUSES):
 * its lifecycle starts when the atelier issues it, or when its order is cancelled (RETIRED).
 */
export const PRODUCT_STATUSES = [
  'RESERVED', 'ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED',
  'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** The statuses product_status_history records (its CHECKs, those of migration 0001): every status but RESERVED. */
export const PRODUCT_HISTORY_STATUSES = PRODUCT_STATUSES.filter((s): s is Exclude<ProductStatus, 'RESERVED'> => s !== 'RESERVED');

export const OWNERSHIP_STATES = ['UNREGISTERED', 'REGISTERED', 'OWNED', 'TRANSFER_PENDING'] as const;
export type OwnershipState = (typeof OWNERSHIP_STATES)[number];

export const KEY_STATUSES = ['ACTIVE', 'RETIRED', 'REVOKED'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const CODE_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVOKED'] as const;
export type CodeStatus = (typeof CODE_STATUSES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'LOCKED', 'DELETED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** RETAIL (migration 0008): a seller's account, ranked under AUDITOR, limited to the sale mode (A-08). */
export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR', 'RETAIL'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
/**
 * The roles an ADMIN may give from the console (create a staff account, change a role). ADMIN
 * itself is granted from the shell only (scripts/admin.ts), where the second factor is enrolled
 * out of band (SECURITY-MODEL §3.3).
 */
export const STAFF_ROLES = ['OPERATOR', 'AUDITOR', 'RETAIL'] as const satisfies readonly AdminRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SESSION_SUBJECT_TYPES = ['account', 'admin'] as const;
export type SessionSubjectType = (typeof SESSION_SUBJECT_TYPES)[number];

export const ACQUIRED_VIA = ['FIRST_REGISTRATION', 'TRANSFER', 'RESALE', 'ADMIN'] as const;
export type AcquiredVia = (typeof ACQUIRED_VIA)[number];

export const TRANSFER_STATUSES = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const SERVICE_TYPES = ['INSPECTION', 'CLEANING', 'POLISH', 'RESIZE', 'REPAIR', 'REPLACEMENT', 'AUTHENTICATION'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/**
 * SALE_ACTIVATION (migration 0008): the token of a sale lookup, used up by the warranty activation it allows.
 * TRANSFER_ACCEPT (migration 0011, F-03): the token of a signed-in reader's scan of a piece whose transfer is pending,
 * used up by the acceptance of that transfer, by that account.
 */
export const SCAN_TOKEN_PURPOSES = ['FIRST_REGISTRATION', 'SALE_ACTIVATION', 'TRANSFER_ACCEPT'] as const;
export type ScanTokenPurpose = (typeof SCAN_TOKEN_PURPOSES)[number];

export const SCAN_EVENT_TYPES = ['VERIFY', 'REGISTER', 'TRANSFER', 'ADMIN_TEST'] as const;
export type ScanEventType = (typeof SCAN_EVENT_TYPES)[number];

/** The scans counted in scan_daily_stats (migration 0009): every event type but the staff's ADMIN_TEST. */
export const SCAN_STAT_EVENT_TYPES = ['VERIFY', 'REGISTER', 'TRANSFER'] as const;
export type ScanStatEventType = (typeof SCAN_STAT_EVENT_TYPES)[number];

export const GENOME_CHECKS = ['MATCH', 'MISMATCH', 'NOT_PROVIDED', 'INCONCLUSIVE'] as const;
export type GenomeCheck = (typeof GENOME_CHECKS)[number];

/** Public verification states (contract §2.4). Constrains authentication_events.state. */
export const VERIFICATION_STATES = [
  'AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED',
  'SUSPICIOUS_ACTIVITY', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

export const REVOCATION_TARGET_TYPES = ['CODE', 'PRODUCT', 'KEY'] as const;
export type RevocationTargetType = (typeof REVOCATION_TARGET_TYPES)[number];

/**
 * Where a model stands in the lookbook (models.lookbook, migration 0014, P-R02): HIDDEN (the default), PUBLIC (listed for
 * everyone) or RESERVED (listed for the owners of a piece only: unlisted, not confidential).
 */
export const LOOKBOOK_STATES = ['HIDDEN', 'PUBLIC', 'RESERVED'] as const;
export type LookbookState = (typeof LOOKBOOK_STATES)[number];

/**
 * An entry of a drop (drop_entries.status, migration 0015, P-R03): ENTERED, then WITHDRAWN by its account (an entry
 * again sets the same row back to ENTERED), or, by the draw, SELECTED (a place held until respond_by) or WAITLISTED
 * (its rank); then CONFIRMED (the sale concluded by ORBES Client Services) or LAPSED (after respond_by).
 */
export const DROP_ENTRY_STATUSES = ['ENTERED', 'SELECTED', 'WAITLISTED', 'CONFIRMED', 'LAPSED', 'WITHDRAWN'] as const;
export type DropEntryStatus = (typeof DROP_ENTRY_STATUSES)[number];

/**
 * A post of the owners' circle (circle_posts.kind, migration 0016, P-X01): a NOTE (text and photographs), an INVITATION
 * (an event, answered YES or NO, within its capacity) or a POLL (2 to 6 options, one vote per account).
 */
export const CIRCLE_POST_KINDS = ['NOTE', 'INVITATION', 'POLL'] as const;
export type CirclePostKind = (typeof CIRCLE_POST_KINDS)[number];

/** An account's answer to an invitation of the circle (circle_rsvps.answer, migration 0016, P-X01). */
export const CIRCLE_RSVP_ANSWERS = ['YES', 'NO'] as const;
export type CircleRsvpAnswer = (typeof CIRCLE_RSVP_ANSWERS)[number];

/**
 * The tiers of the collectors' club (club_tiers.tier, migration 0018, P-X04), in order: 1 TITANE, 2 PLATINE,
 * 3 PALLADIUM, reached at 1, 3 and 5 pieces held now (services/club.ts CLUB_TIER_THRESHOLDS).
 */
export const CLUB_TIER_NAMES = ['TITANE', 'PLATINE', 'PALLADIUM'] as const;
export type ClubTierName = (typeof CLUB_TIER_NAMES)[number];

/**
 * A request for a model of the private salon (shop_requests.status, migration 0020, P-X08): OPEN until the console
 * closes it with a note (or the account is locked), then CLOSED.
 */
export const SHOP_REQUEST_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ShopRequestStatus = (typeof SHOP_REQUEST_STATUSES)[number];

/**
 * The kind of a drop (drops.mode, migration 0021): a DRAW (P-R03, the default: a waiting list, then a draw by tier) or a
 * LIVE RELEASE (an instant drop lived in real time: a room, a line at T0, a turn, a hold, PAY).
 */
export const DROP_MODES = ['DRAW', 'LIVE'] as const;
export type DropMode = (typeof DROP_MODES)[number];

/**
 * How a LIVE RELEASE ended (drops.ended_reason, migration 0021): SOLD_OUT (every piece confirmed), CLOSED (at
 * `closes_at`) or ENDED (by an ADMIN).
 */
export const LIVE_END_REASONS = ['SOLD_OUT', 'CLOSED', 'ENDED'] as const;
export type LiveEndReason = (typeof LIVE_END_REASONS)[number];

/**
 * An entry of a LIVE RELEASE (live_entries.status, migration 0021): WAITING in the room before T0, QUEUED in the line,
 * TURN (hold the seal), SECURED (the seal held: press PAY), CONFIRMED (PAY pressed); or out of it: MISSED (the turn ran
 * out), EXPIRED (the hold ran out or was freed), RELEASED (given back), LEFT, REMOVED (by the console), ENDED (by the
 * end of the release).
 */
export const LIVE_ENTRY_STATUSES = ['WAITING', 'QUEUED', 'TURN', 'SECURED', 'CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'LEFT', 'REMOVED', 'ENDED'] as const;
export type LiveEntryStatus = (typeof LIVE_ENTRY_STATUSES)[number];

/** How ORBES Client Services concluded a confirmed reservation of a LIVE RELEASE (live_entries.resolution, migration 0021). */
export const LIVE_RESOLUTIONS = ['CONCLUDED', 'CANCELLED'] as const;
export type LiveResolution = (typeof LIVE_RESOLUTIONS)[number];

/**
 * How a request of the private salon was closed (shop_requests.outcome, migration 0022): ACCEPTED (the sale concluded:
 * an order follows) or DECLINED. NULL for a request closed before 0022.
 */
export const SHOP_REQUEST_OUTCOMES = ['ACCEPTED', 'DECLINED'] as const;
export type ShopRequestOutcome = (typeof SHOP_REQUEST_OUTCOMES)[number];

/**
 * The channel an order comes from (orders.channel, migration 0022): an entry of a LIVE RELEASE CONFIRMED, an entry of a
 * draw confirmed by Client Services, a request of the private salon closed as ACCEPTED.
 */
export const ORDER_CHANNELS = ['LIVE', 'DRAW', 'SALON'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/**
 * The steps of an order (orders.status, migration 0022): RESERVED → PAID → SHIPPED → DELIVERED; CANCELLED from RESERVED
 * or PAID; RETURNED from SHIPPED or DELIVERED (services/orders.ts ORDER_TRANSITIONS).
 */
export const ORDER_STATUSES = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** What an order RESERVED or PAID holds at its location (orders.reservation, migration 0022): a piece in stock, or a piece to make. */
export const ORDER_RESERVATIONS = ['STOCK', 'BENCH'] as const;
export type OrderReservation = (typeof ORDER_RESERVATIONS)[number];

/**
 * Why the stock of a SKU moved at a location (stock_movements.reason, migration 0022): a piece finished by the atelier
 * (+1), a count corrected (±), the two halves of a transfer, an order shipped (−1) or returned to stock (+1).
 */
export const STOCK_MOVEMENT_REASONS = ['PRODUCED', 'ADJUSTED', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHIPPED', 'RETURNED'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** A piece to make at the atelier (bench_items.status, migration 0022): TO_MAKE → IN_PROGRESS → DONE, or CANCELLED. */
export const BENCH_ITEM_STATUSES = ['TO_MAKE', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type BenchItemStatus = (typeof BENCH_ITEM_STATUSES)[number];

/** Where a returned order's piece goes (returns.outcome, migration 0022): back to stock at a location, or to the archive. */
export const RETURN_OUTCOMES = ['RESTOCKED', 'ARCHIVED'] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

/** An invoice, or the credit note that follows one (invoices.kind, migration 0022). */
export const INVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** The image types media_objects stores (migration 0012): the console uploads JPEG or WebP only (F-04). */
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

/** Where the customer saw or bought the piece of a reported scan (scan_reports.channel, migration 0004). */
export const REPORT_CHANNELS = ['BOUTIQUE', 'ONLINE', 'PRIVATE', 'OTHER'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** A case of the console's Cases queue (scan_reports.status). */
export const REPORT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ── Column helpers ─────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** timestamptz NOT NULL without default. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** timestamptz NOT NULL DEFAULT now(). */
type TimestampDefault = ColumnType<Date, Date | string | undefined, Date | string>;
/** timestamptz NULL. */
type TimestampNullable = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** date NULL, as 'YYYY-MM-DD'. */
type DateNullable = ColumnType<string | null, string | null | undefined, string | null>;
/** jsonb NOT NULL (with or without default): read parsed, write JSON text. */
type Jsonb<T, HasDefault extends boolean = false> = ColumnType<
  T,
  HasDefault extends true ? string | undefined : string,
  string
>;
/** jsonb NULL. */
type JsonbNullable<T> = ColumnType<T | null, string | null | undefined, string | null>;
/** NOT NULL with a server default (Generated<> but still updatable). */
type WithDefault<T> = ColumnType<T, T | undefined, T>;

// ── Tables ─────────────────────────────────────────────────────────────────

export interface CategoriesTable {
  id: number;                          // smallint PK, immutable 5-bit index 1..31 (never generated)
  code: string;                        // char(1) A–Z, immutable
  name: string;
  warranty_months: WithDefault<number>;
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
}

export interface CollectionsTable {
  id: Generated<string>;
  name: string;
  created_at: TimestampDefault;
}

export interface ModelsTable {
  id: Generated<string>;
  collection_id: string | null;
  category_id: number;
  name: string;
  type: string;
  sku_prefix: string;
  default_material: string | null;
  care_instructions: string | null;
  /** Offered for new products (migration 0010); an inactive model's pieces verify as before. category_id and sku_prefix never change. */
  active: WithDefault<boolean>;
  /** Migration 0012: the model's reference photograph (media_objects.sha256), shown on the authentic results of its pieces. */
  image_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0014 (P-R02): the address of its lookbook sheet, /verify/lookbook/<slug>; unique; fixed once published_at is set. */
  slug: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0014: HIDDEN (default), PUBLIC or RESERVED; a model shown has its slug. */
  lookbook: WithDefault<LookbookState>;
  /** Migration 0014: plain paragraphs, ≤ 4 000 characters. */
  story: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0014: one `Label: value` line per specification, ≤ 1 000 characters. */
  specs: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0014: when the model first left HIDDEN; never cleared. */
  published_at: TimestampNullable;
  /** Migration 0019 (P-R06): when an ADMIN discontinued the model (then never active); NULL while it is not, cleared when reinstated. */
  discontinued_at: TimestampNullable;
  /** Migration 0019: admin_users.id of who discontinued it; NULL for a script, and with discontinued_at. */
  discontinued_by: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0020 (P-X08): the price THE PRIVATE SALON shows for a RESERVED model, 1..60 characters; NULL: none. */
  price_label: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0020: the lowest tier a RESERVED model is shown to, 1 TITANE (default), 2 PLATINE, 3 PALLADIUM. */
  private_min_tier: WithDefault<number>;
  /** Migration 0022 (N2): the model's base price in minor units, with `base_currency` (both or neither); releases keep their own. */
  base_price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  base_currency: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0022 (M6): the model's care guide, 1..8 000 characters. */
  care_guide: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
}

/**
 * The gallery of a model's lookbook sheet (migration 0014, P-R02): at most 8 photographs (positions 1–8, unique per
 * model), each a media_objects row; `alt` NULL is the sheet's default alternative text. The reference photograph
 * (models.image_sha256) is the cover, not a row here. model_id, sha256, created_by and created_at never change.
 */
export interface ModelImagesTable {
  model_id: string;
  sha256: string;                      // media_objects.sha256
  position: number;                    // smallint 1..8
  alt: string | null;                  // ≤ 200 characters
  created_by: string | null;           // admin_users.id; null when a script stored it
  created_at: TimestampDefault;
}

export interface ProductsTable {
  id: Generated<string>;
  product_id: string;                  // canonical O26-J-00184
  packed_identity: number;             // bigint, u32
  year: number;
  category_id: number;
  serial: number;
  sku: string;
  model_id: string;
  collection_id: string | null;
  variant: string | null;
  material: string;
  production_batch: string | null;
  production_date: DateNullable;
  status: WithDefault<ProductStatus>;
  ownership_state: WithDefault<OwnershipState>;
  auth_policy: WithDefault<string>;
  claim_secret_hash: string | null;
  /** Migration 0012: the photograph of this piece (media_objects.sha256), taken at issuance and shown on its authentic results. */
  photo_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0022: its SKU (skus.id, of its model); NULL until linked. */
  sku_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

export interface ProductStatusHistoryTable {
  id: Generated<string>;
  product_id: string;
  from_status: ProductStatus | null;
  to_status: ProductStatus;
  reason: string | null;
  actor_type: ActorType;
  actor_id: string | null;
  created_at: TimestampDefault;
}

export interface GenomesTable {
  id: Generated<string>;
  product_id: string;
  genome_version: number;
  genome_id: string;                   // canonical product id string
  value: number;                       // bigint, u32
  glyphs: number[];                    // smallint[8], 0..15
  pattern: string;                     // glyph ids joined by '·'
  fingerprint: string;                 // G1-XXXX-XXXX
  created_at: TimestampDefault;
}

export interface CryptographicKeysTable {
  key_id: number;                      // smallint PK 1..255 (assigned by KeyService)
  kid: string;
  algorithm: WithDefault<'Ed25519'>;
  public_key: Uint8Array;              // 32 bytes
  status: KeyStatus;
  provider: string;
  provider_ref: string;                // reference only, never a secret
  created_at: TimestampDefault;
  activated_at: TimestampNullable;
  retired_at: TimestampNullable;
  revoked_at: TimestampNullable;
  compromised_at: TimestampNullable;
  revocation_reason: string | null;
}

export interface CodesTable {
  id: Generated<string>;
  product_id: string;
  genome_id: string;                   // FK → genomes.id (uuid)
  key_id: number;
  code_version: number;
  issue: number;
  issued_day: number;
  nonce: Uint8Array;                   // 4 bytes
  payload: Uint8Array;                 // 13 bytes
  signature: Uint8Array;               // 64 bytes
  payload_hash: Uint8Array;            // sha256(payload), 32 bytes
  status: WithDefault<CodeStatus>;
  revoked_at: TimestampNullable;
  revocation_reason: string | null;
  created_at: TimestampDefault;
}

export interface AccountsTable {
  id: Generated<string>;
  email: string;
  email_normalized: string;
  password_hash: string;
  display_name: string | null;
  country: string | null;              // char(2)
  status: WithDefault<AccountStatus>;
  /** Consecutive wrong passwords in the throttle window (migration 0002). */
  failed_logins: WithDefault<number>;
  /** Start of the current throttle window, null when there is no recent failure. */
  failed_logins_since: TimestampNullable;
  /** After an assisted recovery, new transfers out of the account are paused until then (migration 0005). */
  transfers_frozen_until: TimestampNullable;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * A one-time recovery code issued by an ADMIN of ORBES Client Services (migration 0005): scrypt hash only,
 * 30 minutes, used once; one open (neither used nor revoked) per account.
 */
export interface AccountRecoveryCodesTable {
  id: Generated<string>;
  account_id: string;
  code_hash: string;                   // scrypt$15$8$1$<salt>$<hash> of the canonical 12-character code
  created_by: string;                  // admin_users.id
  created_at: TimestampDefault;
  expires_at: Timestamp;
  used_at: TimestampNullable;
  revoked_at: TimestampNullable;
}

export interface AdminUsersTable {
  id: Generated<string>;
  email_normalized: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  totp_secret_enc: string | null;
  failed_logins: WithDefault<number>;
  locked_until: TimestampNullable;
  disabled_at: TimestampNullable;
  /** Migration 0006: a temporary password (set by an ADMIN) must be replaced before the console can be used. */
  password_change_required: WithDefault<boolean>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

export interface SessionsTable {
  id_hash: Uint8Array;                 // sha256 of the random token, 32 bytes
  subject_type: SessionSubjectType;
  subject_id: string;
  csrf_token: string;
  mfa_passed: WithDefault<boolean>;
  created_at: TimestampDefault;
  expires_at: Timestamp;
  last_seen_at: TimestampDefault;
  ip_hash: string | null;
  user_agent: string | null;
}

export interface OwnershipTable {
  id: Generated<string>;
  product_id: string;
  account_id: string;
  acquired_via: AcquiredVia;
  verified: WithDefault<boolean>;
  started_at: TimestampDefault;
  ended_at: TimestampNullable;
  ended_reason: string | null;
}

export interface OwnershipTransfersTable {
  id: Generated<string>;
  product_id: string;
  from_account_id: string;
  to_account_id: string | null;
  token_hash: Uint8Array;
  status: WithDefault<TransferStatus>;
  created_at: TimestampDefault;
  expires_at: Timestamp;
  completed_at: TimestampNullable;
}

/**
 * A shareable ownership certificate (migration 0013, F-06): a link to the live record of a piece, created by its
 * current owner. Only SHA-256 of the link's 32-byte token is stored. Bound to the piece and to the ownership period
 * it was created in; at most 90 days; withdrawn by its owner (`revoked_at`); never deleted.
 */
export interface OwnershipCertificatesTable {
  id: Generated<string>;
  token_hash: Uint8Array;              // sha256 of the 32 token bytes, 32 bytes, unique
  product_id: string;
  ownership_id: string;                // ownership.id of the period the certificate was created in
  created_at: TimestampDefault;
  expires_at: Timestamp;               // ≤ created_at + 90 days
  revoked_at: TimestampNullable;
}

/** Points of sale (migration 0008), chosen from a list when a warranty starts; made inactive, never deleted. */
export interface RetailersTable {
  id: Generated<string>;
  name: string;
  city: string | null;
  country: string | null;              // char(2)
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

export interface WarrantiesTable {
  id: Generated<string>;
  product_id: string;
  purchase_date: DateNullable;
  /** Free text (history and API callers); the name shown comes from retailer_id first. */
  retailer: string | null;
  /** Migration 0008: the point of sale, from the register. */
  retailer_id: string | null;
  country: string | null;
  start_date: DateNullable;
  duration_months: number;
  end_date: DateNullable;
  voided_at: TimestampNullable;
  void_reason: string | null;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

export interface ServiceRecordsTable {
  id: Generated<string>;
  product_id: string;
  type: ServiceType;
  status: WithDefault<ServiceStatus>;
  location: string | null;
  notes: string | null;
  opened_at: TimestampDefault;
  closed_at: TimestampNullable;
  performed_by: string | null;
}

export interface ScanTokensTable {
  id_hash: Uint8Array;                 // sha256 of the token, 32 bytes
  product_id: string;
  scan_event_id: string;
  purpose: ScanTokenPurpose;
  expires_at: Timestamp;
  used_at: TimestampNullable;
  created_at: TimestampDefault;
}

export interface ScanEventsTable {
  id: Generated<string>;
  occurred_at: TimestampDefault;
  code_id: string | null;
  product_id: string | null;
  packed_identity: number | null;      // bigint
  event_type: ScanEventType;
  device_hash: string | null;
  session_hash: string | null;
  account_id: string | null;
  /** Migration 0008: the console user behind an ADMIN_TEST scan (a sale lookup, or /verify with a console session: S-07); null otherwise. */
  admin_id: string | null;
  ip_hash: string | null;
  country: string | null;              // char(2)
  region: string | null;
  lat: number | null;                  // real, rounded to 1 decimal
  lon: number | null;
  user_agent_family: string | null;
  client_metrics: JsonbNullable<JsonObject>;
  result_state: string;
  latency_ms: number | null;
}

/**
 * Daily scan statistics (migration 0009): the scans of one complete UTC day by country, state and
 * event type. Anonymous, written by housekeeping (services/scan-stats.ts), kept after the scan history is purged.
 */
export interface ScanDailyStatsTable {
  day: string;                         // date 'YYYY-MM-DD' (UTC)
  country: string;                     // char(2), 'ZZ' when unknown
  result_state: VerificationState;
  event_type: ScanStatEventType;
  n: number;                           // integer >= 0
}

export interface AuthenticationEventsTable {
  id: Generated<string>;
  scan_event_id: string;
  code_id: string | null;
  product_id: string | null;
  key_id: number | null;               // no FK: unknown key ids are recorded too
  signature_valid: boolean;
  genome_check: GenomeCheck;
  state: VerificationState;
  reasons: WithDefault<string[]>;
  risk_score: number;
  authenticators: Jsonb<JsonValue, true>;
  created_at: TimestampDefault;
}

export interface AnomaliesTable {
  id: Generated<string>;
  product_id: string | null;
  code_id: string | null;
  type: string;
  severity: AnomalySeverity;
  risk_score: number;
  details: Jsonb<JsonObject, true>;
  status: WithDefault<AnomalyStatus>;
  occurrences: WithDefault<number>;
  first_seen_at: TimestampDefault;
  last_seen_at: TimestampDefault;
  resolved_by: string | null;
  resolved_at: TimestampNullable;
  resolution_note: string | null;
}

/**
 * A customer's report on a scan that was not authentic (migration 0004): where the piece was seen
 * or bought, and the case staff follow up. One per scan; purged with the scan.
 */
export interface ScanReportsTable {
  id: Generated<string>;
  scan_event_id: string;
  channel: ReportChannel;
  place: string | null;                // ≤ 200 characters, free text (personal data)
  note: string | null;                 // ≤ 500 characters, free text (personal data)
  created_at: TimestampDefault;
  status: WithDefault<ReportStatus>;
  handled_by: string | null;           // admin_users.id, set when CLOSED
  handled_at: TimestampNullable;
  resolution_note: string | null;      // ≤ 2 000 characters
}

/**
 * A stored photograph (migration 0012, F-04): keyed by the hex SHA-256 of its bytes, JPEG or WebP of at most
 * 1 MiB with EXIF and XMP stripped; never updated. Used by models.image_sha256 and products.photo_sha256.
 */
export interface MediaObjectsTable {
  sha256: string;                      // lower-case hex SHA-256 of `bytes` (CHECK)
  mime: MediaMimeType;
  bytes: Uint8Array;                   // ≤ 1 048 576
  width: number;                       // 1..4096
  height: number;                      // 1..4096
  created_by: string | null;           // admin_users.id; null when a script stored it
  created_at: TimestampDefault;
}

/**
 * A drop (migration 0015, P-R03): a release of a model in `quantity` pieces, entered from /verify by ORBES accounts,
 * then drawn by tier, seniority and a seed committed at creation. Its state (DRAFT, UPCOMING, OPEN, CLOSED, DRAWN,
 * CANCELLED) is computed from its dates (services/drops.ts `dropState`). The seed is sealed (`seed_enc`) and committed
 * (`seed_hash`, its SHA-256) at creation, both immutable; `seed` is written by the draw only, which reveals it.
 */
export interface DropsTable {
  id: Generated<string>;
  model_id: string;
  title: string;                       // 1..120 characters
  description: ColumnType<string | null, string | null | undefined, string | null>; // ≤ 2 000 characters
  quantity: number;                    // int ≥ 1
  opens_at: Timestamp;
  closes_at: Timestamp;                // > opens_at
  /** How long a place drawn is held (drop_entries.respond_by): 1..336 hours, 48 by default. */
  purchase_window_hours: WithDefault<number>;
  /**
   * The early access (migration 0017, P-X02): how long before `opens_at` an account PLATINE or PALLADIUM reserves a
   * place directly, first come, first served, within `quantity`: 0..336 hours, 48 by default; 0, none.
   */
  early_access_hours: WithDefault<number>;
  published_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  /** secretbox `v1.<iv>.<ciphertext>` of the 32-byte seed, the drop's id as associated data; never changes. */
  seed_enc: string;
  /** SHA-256 of the seed, 32 bytes, public from the publication on; never changes. */
  seed_hash: Uint8Array;
  /** The 32-byte seed in clear, written by the draw only (sha256(seed) = seed_hash). */
  seed: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  drawn_at: TimestampNullable;
  created_by: string | null;           // admin_users.id; null when a script created it
  created_at: TimestampDefault;
  /** Migration 0021: DRAW (the default) or LIVE. The columns below are required for LIVE and NULL for DRAW, but where said. */
  mode: WithDefault<DropMode>;
  /** Who may enter a LIVE RELEASE: 0 (any account) to 3 (PALLADIUM); narrowed by live_access_models and access_collection_id. */
  live_min_tier: ColumnType<number | null, number | null | undefined, number | null>;
  /** The line at T0 by tier first, then the seed. */
  tier_priority: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  /** The room opens that long before `opens_at` (T0): 1..60 minutes. */
  room_opens_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  /** To hold the seal once it is one's turn: 10..300 seconds. */
  turn_seconds: ColumnType<number | null, number | null | undefined, number | null>;
  /** To press PAY once the seal is held: 1..60 minutes. */
  pay_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  /** Pieces per person: 1..5. */
  per_account: ColumnType<number | null, number | null | undefined, number | null>;
  /** The price of a piece in minor units (cents), ≥ 0. */
  price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  /** ISO 4217, three capital letters. */
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  /** The staged reveals: NULL announce_at is the publication; a NULL stage is the announcement; in order, before the room. */
  announce_at: TimestampNullable;
  silhouette_at: TimestampNullable;
  name_at: TimestampNullable;
  photo_at: TimestampNullable;
  /** An uploaded silhouette (media_objects.sha256); without one, the seal. */
  silhouette_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  /** The owners of a piece of this collection may enter (with live_access_models: of either). */
  access_collection_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The quantity as the announcement says it, 1..40 characters (« 25 PIECES »). */
  quantity_line: ColumnType<string | null, string | null | undefined, string | null>;
  /** A pause in progress since then: no new turn, the deadlines frozen. */
  paused_at: TimestampNullable;
  /** Every pause of the release, in milliseconds (bigint, NOT NULL DEFAULT 0; 0 for a DRAW). */
  paused_ms_total: WithDefault<number>;
  /** When the end began (SOLD_OUT, CLOSED at closes_at, ENDED by an ADMIN), with its reason. */
  ended_at: TimestampNullable;
  ended_reason: ColumnType<LiveEndReason | null, LiveEndReason | null | undefined, LiveEndReason | null>;
  /** SHA-256 of the boutique board's link secret, 32 bytes, unique; with the time it was issued. */
  board_token_hash: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  board_token_issued_at: TimestampNullable;
  /** Migration 0022: the release's default location (stock_locations.id); NULL: the default location. */
  stock_location_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * An account's entry in a drop (migration 0015, P-R03): one per account and drop, reactivated rather than deleted and
 * inserted again. `tier`, `seniority` and `rank` are written by the draw; `respond_by` by the draw or an offer to the
 * next of the waiting list; `handled_by`, `handled_at` and `note` by the console. id, drop_id, account_id and
 * created_at never change. A direct reservation of the early access (P-X02) is an entry SELECTED at once, with its
 * `respond_by`, the `tier` and `seniority` of the moment of the request, and no `rank` (the draw ranks only ENTERED).
 */
export interface DropEntriesTable {
  id: Generated<string>;
  drop_id: string;
  account_id: string;
  created_at: TimestampDefault;
  status: WithDefault<DropEntryStatus>;
  tier: number | null;                 // smallint 0..3, the club's tier at the draw (0: no piece held), or at a direct reservation
  seniority: number | null;            // smallint ≥ 0, full years since the account's first ownership, at the draw (or reservation)
  rank: number | null;                 // int ≥ 1, the entry's place in the draw's order
  respond_by: TimestampNullable;
  handled_by: string | null;           // admin_users.id
  handled_at: TimestampNullable;
  note: string | null;                 // ≤ 500 characters, the console's
}

/**
 * A post of the owners' circle (migration 0016, P-X01), published for the accounts whose tier reaches `min_tier`. An
 * INVITATION has its `event_at` (and may have a place and a capacity), a POLL its 2 to 6 `poll_options`; no other kind
 * has either. id, kind, created_by and created_at never change.
 */
export interface CirclePostsTable {
  id: Generated<string>;
  kind: CirclePostKind;
  title: string;                       // 1..120 characters
  body: ColumnType<string | null, string | null | undefined, string | null>; // plain paragraphs, ≤ 6 000 characters
  /** The lowest tier that reads it: 1 TITANE (the default), 2 PLATINE, 3 PALLADIUM. */
  min_tier: WithDefault<number>;
  /** INVITATION only: the time of the event. */
  event_at: TimestampNullable;
  event_place: ColumnType<string | null, string | null | undefined, string | null>; // INVITATION only, ≤ 200 characters
  /** INVITATION only: the places answered YES at most; null: no limit. */
  capacity: ColumnType<number | null, number | null | undefined, number | null>;
  /** POLL only: 2 to 6 options. */
  poll_options: ColumnType<string[] | null, string[] | null | undefined, string[] | null>;
  drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** https only, ≤ 500 characters; its host one of the service's list (services/circle.ts CIRCLE_LINK_HOSTS). */
  external_url: ColumnType<string | null, string | null | undefined, string | null>;
  /** Shown in the circle while set; null: a draft, or withdrawn. */
  published_at: TimestampNullable;
  created_by: string | null;           // admin_users.id; null when a script created it
  created_at: TimestampDefault;
}

/** The photographs of a circle post (migration 0016, P-X01): at most 4, positions 1–4; post_id, sha256, created_by and created_at never change. */
export interface CirclePostImagesTable {
  post_id: string;
  sha256: string;                      // media_objects.sha256
  position: number;                    // smallint 1..4
  alt: string | null;                  // ≤ 200 characters; null: the post's default
  created_by: string | null;           // admin_users.id
  created_at: TimestampDefault;
}

/** An account's answer to an invitation of the circle (migration 0016, P-X01): one per account and post, changed in place. */
export interface CircleRsvpsTable {
  post_id: string;
  account_id: string;
  answer: CircleRsvpAnswer;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/** An account's vote in a poll of the circle (migration 0016, P-X01): one per account and post, final. */
export interface CirclePollVotesTable {
  post_id: string;
  account_id: string;
  option_index: number;                // smallint 0..5, the index of its option in circle_posts.poll_options
  created_at: TimestampDefault;
}

/** The visits of the circle per UTC day (migration 0016, P-X01): a count, and no account. */
export interface CircleDailyVisitsTable {
  day: string;                         // date 'YYYY-MM-DD' (UTC)
  visits: WithDefault<number>;         // integer >= 0
}

/**
 * The words of a tier's benefits as the console changed them (migration 0018, P-X04): at most one row per tier, none
 * inserted; without a row the tier reads its default words (services/club.ts CLUB_TIER_DEFAULT_BENEFITS). `tier` never
 * changes.
 */
export interface ClubTiersTable {
  tier: ClubTierName;
  benefits: string;                    // what the tier adds to the ones below it, one per line, 1..600 characters
  updated_by: string | null;           // admin_users.id; null when a script wrote it
  updated_at: TimestampDefault;
}

/**
 * A request for a model of the private salon (migration 0020, P-X08): at most one OPEN per account and model. `note` is
 * the account's words (≤ 500 characters); `handled_by`, `handled_at` and `resolution_note` the console's when it closes
 * it (a lock closes it without a note). id, account_id, model_id, created_at and note never change.
 */
export interface ShopRequestsTable {
  id: Generated<string>;
  account_id: string;
  model_id: string;
  note: string | null;                 // ≤ 500 characters, the account's
  status: WithDefault<ShopRequestStatus>;
  created_at: TimestampDefault;
  handled_by: string | null;           // admin_users.id
  handled_at: TimestampNullable;
  resolution_note: string | null;      // ≤ 2 000 characters, the console's
  /** Migration 0022: ACCEPTED (an order follows) or DECLINED, set when CLOSED; NULL for one closed before. */
  outcome: ColumnType<ShopRequestOutcome | null, ShopRequestOutcome | null | undefined, ShopRequestOutcome | null>;
}

/**
 * A size of a LIVE RELEASE (migration 0021): 1 to 24 per drop (`position`), a `label` of 1..12 characters unique per
 * drop, its `stock` (≥ 0). The release's quantity is the sum of its stock. id and drop_id never change.
 */
export interface DropSizesTable {
  id: Generated<string>;
  drop_id: string;
  label: string;
  position: number;                    // smallint 1..24
  stock: number;                       // integer 0..10 000
  /** Migration 0022: the SKU on sale (skus.id, the release's model in this size); NULL until linked. */
  sku_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * An account's entry in a LIVE RELEASE (migration 0021): one per account and drop, in a size of that drop, for 1..5
 * pieces; each status carries the columns it requires (the CHECKs of the migration). id, drop_id and account_id never
 * change.
 */
export interface LiveEntriesTable {
  id: Generated<string>;
  drop_id: string;
  account_id: string;
  size_id: string;                     // drop_sizes.id of the same drop
  quantity: number;                    // smallint 1..5
  status: WithDefault<LiveEntryStatus>;
  /** The club's tier at entry, read again for the line at T0 (0: no piece held). */
  tier: number;
  /** The place in the line, unique per drop; NULL before it (WAITING). */
  position: ColumnType<number | null, number | null | undefined, number | null>;
  joined_at: TimestampDefault;
  queued_at: TimestampNullable;
  turn_at: TimestampNullable;
  turn_expires_at: TimestampNullable;
  /** SHA-256 of the turn's secret (services/live.ts liveTurnToken), 32 bytes. */
  turn_token_hash: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  /** The press of the seal, on the server's clock. */
  press_started_at: TimestampNullable;
  /** From the press to the secure, in milliseconds, ≥ 1 400. */
  gesture_ms: ColumnType<number | null, number | null | undefined, number | null>;
  secured_at: TimestampNullable;
  hold_expires_at: TimestampNullable;
  confirmed_at: TimestampNullable;
  /** When the entry left for good (MISSED, EXPIRED, RELEASED, LEFT, REMOVED, ENDED). */
  ended_at: TimestampNullable;
  let_in_by: ColumnType<string | null, string | null | undefined, string | null>;   // admin_users.id
  removed_by: ColumnType<string | null, string | null | undefined, string | null>;  // admin_users.id
  removed_at: TimestampNullable;
  handled_by: ColumnType<string | null, string | null | undefined, string | null>;  // admin_users.id
  handled_at: TimestampNullable;
  resolution: ColumnType<LiveResolution | null, LiveResolution | null | undefined, LiveResolution | null>;
  resolution_note: ColumnType<string | null, string | null | undefined, string | null>; // ≤ 500 characters, the console's
  /** Keyed SHA-256 of the entry's network prefix, 32 bytes; erased 30 days after the release's end. */
  network_hash: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  country: ColumnType<string | null, string | null | undefined, string | null>;     // two capital letters
}

/** The models whose owners may enter a LIVE RELEASE (migration 0021). */
export interface LiveAccessModelsTable {
  drop_id: string;
  model_id: string;
}

/** An add-on offered at the reveal of a LIVE RELEASE (migration 0021): at most 6 per drop. id and drop_id never change. */
export interface LiveAddonsTable {
  id: Generated<string>;
  drop_id: string;
  label: string;                       // 1..40 characters
  line: string | null;                 // ≤ 120 characters
  price_minor: number;                 // ≥ 0, per piece
  position: number;                    // smallint 1..6
}

/** An add-on an entry chose, with its price at the time (migration 0021). */
export interface LiveEntryAddonsTable {
  entry_id: string;
  addon_id: string;
  price_minor: number;
}

/** I'LL BE THERE (migration 0021): one per account and drop, with a size of that drop. */
export interface LiveInterestTable {
  drop_id: string;
  account_id: string;
  size_id: string;
  created_at: TimestampDefault;
}

/** A host message of a LIVE RELEASE (migration 0021): 1..140 characters, never changed. */
export interface LiveMessagesTable {
  id: Generated<string>;
  drop_id: string;
  text: string;
  created_by: string | null;           // admin_users.id; null when a script wrote it
  created_at: TimestampDefault;
}

/** The turn and pay windows of one tier, overriding the release's (migration 0021): at least one of the two. */
export interface LiveTierWindowsTable {
  drop_id: string;
  tier: number;                        // smallint 0..3
  turn_seconds: number | null;         // 10..300
  pay_minutes: number | null;          // 1..60
}

/**
 * A place where pieces are kept (migration 0022, L8): FRANCE WAREHOUSE and LOGISTICS WAREHOUSE from the first boot, more
 * added by the console. `is_default`: draws and the private salon's orders go there when nothing else names a location
 * (one at most). id and created_at never change.
 */
export interface StockLocationsTable {
  id: Generated<string>;
  name: string;                        // 1..60 characters, unique whatever the case
  is_default: WithDefault<boolean>;
  /** The Shopify location it will be (decimal), unique. */
  shopify_location_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
}

/**
 * A model in one size (migration 0022): one per model and size label (NULL: one size), its code and its future Shopify
 * ids. No stock column: the stock is the ledger's (stock_movements). id, model_id, size_label and created_at never change.
 */
export interface SkusTable {
  id: Generated<string>;
  model_id: string;
  size_label: string | null;           // 1..100 characters
  code: string;                        // the model's SKU prefix and the size (issuance.ts deriveSku), unique
  shopify_product_id: ColumnType<string | null, string | null | undefined, string | null>;
  shopify_variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
}

/**
 * The stock ledger (migration 0022): a delta of a SKU at a location and why, append-only. The balance of a (SKU,
 * location) is the sum of its deltas (services/stock.ts).
 */
export interface StockMovementsTable {
  id: Generated<number>;               // bigint identity: the ledger's order
  sku_id: string;
  location_id: string;
  delta: number;                       // ±1..10 000, never 0
  reason: StockMovementReason;
  order_id: ColumnType<string | null, string | null | undefined, string | null>;
  product_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The two halves of a transfer share it. */
  transfer_id: ColumnType<string | null, string | null | undefined, string | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  actor_type: ActorType;
  actor_id: string | null;
  created_at: TimestampDefault;
}

/** A minimum of a SKU at a location (migration 0022, L2): below it, the atelier is told what to make. */
export interface SkuThresholdsTable {
  sku_id: string;
  location_id: string;
  minimum: number;                     // 1..10 000
  updated_by: string | null;           // admin_users.id
  updated_at: TimestampDefault;
}

/** A carrier (migration 0022, M1): its tracking link, https with `{tracking}` where the number goes. id and created_at never change. */
export interface CarriersTable {
  id: Generated<string>;
  name: string;                        // 1..60 characters, unique whatever the case
  tracking_url: string;
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
}

/** An add-on of an order, as it was sold (orders.addons). */
export interface OrderAddonSnapshot {
  [key: string]: JsonValue;
  /** live_addons.id of the release's add-on. */
  id: string;
  label: string;
  /** Per piece, in the order's currency. */
  priceMinor: number;
}

/**
 * An order (migration 0022, E5): one per piece sold, from its channel's source, step by step; each status with the
 * columns it requires (the CHECKs of the migration). Its identity (id, channel, source, release, account, model,
 * reserved_at) never changes. The buyer's name and address are personal data: never in the audit log nor the journal.
 */
export interface OrdersTable {
  id: Generated<string>;
  channel: OrderChannel;
  live_entry_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The piece of a LIVE entry, 1..its quantity; 1 for the other channels. */
  piece: WithDefault<number>;
  drop_entry_id: ColumnType<string | null, string | null | undefined, string | null>;
  shop_request_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The release of a LIVE or DRAW order; NULL for the private salon. */
  drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  account_id: string;
  model_id: string;
  size_label: ColumnType<string | null, string | null | undefined, string | null>;
  /** A SKU of the model; NULL while a draw's or a salon's size is not entered. */
  sku_id: ColumnType<string | null, string | null | undefined, string | null>;
  price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  addons: Jsonb<OrderAddonSnapshot[], true>;
  surprise: ColumnType<string | null, string | null | undefined, string | null>;
  engraving_text: ColumnType<string | null, string | null | undefined, string | null>;
  buyer_name: ColumnType<string | null, string | null | undefined, string | null>;
  buyer_address: ColumnType<string | null, string | null | undefined, string | null>;
  status: WithDefault<OrderStatus>;
  reserved_at: TimestampDefault;
  paid_at: TimestampNullable;
  shipped_at: TimestampNullable;
  delivered_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  returned_at: TimestampNullable;
  location_id: string;
  /** What it holds at its location while RESERVED or PAID; NULL otherwise. */
  reservation: ColumnType<OrderReservation | null, OrderReservation | null | undefined, OrderReservation | null>;
  carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  tracking_number: ColumnType<string | null, string | null | undefined, string | null>;
  /** The value insured, in the order's currency. */
  declared_value_minor: ColumnType<number | null, number | null | undefined, number | null>;
  /** The piece that fulfils it. */
  product_id: ColumnType<string | null, string | null | undefined, string | null>;
  shopify_order_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/** An order's history (migration 0022), append-only: each change as its audit action, the status after it, a note, who. */
export interface OrderEventsTable {
  id: Generated<number>;               // bigint identity
  order_id: string;
  action: string;                      // order.create, order.pay…
  status: OrderStatus;
  note: ColumnType<string | null, string | null | undefined, string | null>; // ≤ 500 characters
  details: Jsonb<JsonObject, true>;
  actor_type: ActorType;
  actor_id: string | null;
  created_at: TimestampDefault;
}

/**
 * A piece to make at the atelier (migration 0022, G1), for an order or for the stock, with its ORBES identity reserved
 * at creation (L6). id, order_id, sku_id, drop_id, product_id and created_at never change.
 */
export interface BenchItemsTable {
  id: Generated<string>;
  order_id: ColumnType<string | null, string | null | undefined, string | null>;
  sku_id: string;
  /** Where the finished piece goes; it moves with its order. */
  location_id: string;
  drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Its reserved identity (products.id, RESERVED until issued). */
  product_id: string;
  status: WithDefault<BenchItemStatus>;
  engraving_text: ColumnType<string | null, string | null | undefined, string | null>;
  surprise: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
  started_at: TimestampNullable;
  done_at: TimestampNullable;
  cancelled_at: TimestampNullable;
}

/** An order returned (migration 0022, M5): back to stock at a location, or to the archive. Never changed. */
export interface ReturnsTable {
  id: Generated<string>;
  order_id: string;
  outcome: ReturnOutcome;
  location_id: ColumnType<string | null, string | null | undefined, string | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id
  created_at: TimestampDefault;
}

/** An invoice or a credit note (migration 0022, M7), numbered per kind and year, its content as issued. Never changed. */
export interface InvoicesTable {
  id: Generated<string>;
  kind: InvoiceKind;
  year: number;
  sequence: number;
  order_id: string;
  credits_invoice_id: ColumnType<string | null, string | null | undefined, string | null>;
  issuer: Jsonb<JsonObject>;
  buyer: Jsonb<JsonObject>;
  lines: Jsonb<JsonValue[]>;
  currency: string;
  subtotal_minor: number;
  vat_rate_bp: ColumnType<number | null, number | null | undefined, number | null>;
  vat_minor: ColumnType<number | null, number | null | undefined, number | null>;
  total_minor: number;
  issued_at: TimestampDefault;
}

/**
 * The event journal (migration 0022, N1): every change of an order, the stock, a piece or an invoice, written once in
 * the change's transaction; replayed in order of id. Only `consumed_by` changes; never deleted.
 */
export interface EventJournalTable {
  id: Generated<number>;               // bigint identity
  type: string;                        // dotted lowercase: order.pay, stock.move…
  entity_type: string;
  entity_id: string;
  payload: Jsonb<JsonObject>;
  created_at: TimestampDefault;
  consumed_by: WithDefault<string[]>;
}

/** The delays after which an order stands out (migration 0022, M3), in days; one row at most, none inserted. */
export interface OrderAlertSettingsTable {
  id: WithDefault<number>;             // always 1
  reserved_days: WithDefault<number>;
  ready_days: WithDefault<number>;
  shipped_days: WithDefault<number>;
  unregistered_days: WithDefault<number>;
  updated_by: string | null;
  updated_at: TimestampDefault;
}

export interface RevocationsTable {
  id: Generated<string>;
  target_type: RevocationTargetType;
  target_id: string;
  reason_code: string;
  reason: string | null;
  created_by: string;
  created_at: TimestampDefault;
  lifted_at: TimestampNullable;
  lifted_by: string | null;
}

export interface AuditLogsTable {
  id: Generated<number>;               // bigserial (allocated explicitly by AuditService)
  occurred_at: Timestamp;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Jsonb<JsonObject, true>;
  ip_hash: string | null;
  prev_hash: Uint8Array;               // 32 bytes
  hash: Uint8Array;                    // 32 bytes
}

/** Read-only view: flat product fields for admin lists and exports. */
export interface ProductOverviewView {
  id: string;
  product_id: string;
  packed_identity: number;
  sku: string;
  category_id: number;
  category_code: string;
  category: string;
  collection: string | null;
  model: string;
  model_type: string;
  variant: string | null;
  material: string;
  production_batch: string | null;
  production_date: string | null;
  genome_id: string | null;
  genome_version: number | null;
  genome_pattern: string | null;
  genome_fingerprint: string | null;
  code_id: string | null;
  code_version: number | null;
  code_issue: number | null;
  status: ProductStatus;
  warranty_start: string | null;
  warranty_end: string | null;
  ownership_state: OwnershipState;
  created_at: Date;
  updated_at: Date;
}

export interface Database {
  categories: CategoriesTable;
  collections: CollectionsTable;
  models: ModelsTable;
  model_images: ModelImagesTable;
  products: ProductsTable;
  product_status_history: ProductStatusHistoryTable;
  genomes: GenomesTable;
  cryptographic_keys: CryptographicKeysTable;
  codes: CodesTable;
  accounts: AccountsTable;
  account_recovery_codes: AccountRecoveryCodesTable;
  admin_users: AdminUsersTable;
  sessions: SessionsTable;
  ownership: OwnershipTable;
  ownership_transfers: OwnershipTransfersTable;
  ownership_certificates: OwnershipCertificatesTable;
  retailers: RetailersTable;
  warranties: WarrantiesTable;
  service_records: ServiceRecordsTable;
  scan_tokens: ScanTokensTable;
  scan_events: ScanEventsTable;
  scan_daily_stats: ScanDailyStatsTable;
  authentication_events: AuthenticationEventsTable;
  anomalies: AnomaliesTable;
  scan_reports: ScanReportsTable;
  media_objects: MediaObjectsTable;
  drops: DropsTable;
  drop_entries: DropEntriesTable;
  circle_posts: CirclePostsTable;
  circle_post_images: CirclePostImagesTable;
  circle_rsvps: CircleRsvpsTable;
  circle_poll_votes: CirclePollVotesTable;
  circle_daily_visits: CircleDailyVisitsTable;
  club_tiers: ClubTiersTable;
  shop_requests: ShopRequestsTable;
  drop_sizes: DropSizesTable;
  live_entries: LiveEntriesTable;
  live_access_models: LiveAccessModelsTable;
  live_addons: LiveAddonsTable;
  live_entry_addons: LiveEntryAddonsTable;
  live_interest: LiveInterestTable;
  live_messages: LiveMessagesTable;
  live_tier_windows: LiveTierWindowsTable;
  stock_locations: StockLocationsTable;
  skus: SkusTable;
  stock_movements: StockMovementsTable;
  sku_thresholds: SkuThresholdsTable;
  carriers: CarriersTable;
  orders: OrdersTable;
  order_events: OrderEventsTable;
  bench_items: BenchItemsTable;
  returns: ReturnsTable;
  invoices: InvoicesTable;
  event_journal: EventJournalTable;
  order_alert_settings: OrderAlertSettingsTable;
  revocations: RevocationsTable;
  audit_logs: AuditLogsTable;
  product_overview: ProductOverviewView;
}

// ── Row aliases ────────────────────────────────────────────────────────────

export type CategoryRow = Selectable<CategoriesTable>;
export type NewCategory = Insertable<CategoriesTable>;
export type CollectionRow = Selectable<CollectionsTable>;
export type NewCollection = Insertable<CollectionsTable>;
export type ModelRow = Selectable<ModelsTable>;
export type NewModel = Insertable<ModelsTable>;
export type ModelImageRow = Selectable<ModelImagesTable>;
export type NewModelImage = Insertable<ModelImagesTable>;
export type ProductRow = Selectable<ProductsTable>;
export type NewProduct = Insertable<ProductsTable>;
export type ProductUpdate = Updateable<ProductsTable>;
export type ProductStatusHistoryRow = Selectable<ProductStatusHistoryTable>;
export type NewProductStatusHistory = Insertable<ProductStatusHistoryTable>;
export type GenomeRow = Selectable<GenomesTable>;
export type NewGenome = Insertable<GenomesTable>;
export type KeyRow = Selectable<CryptographicKeysTable>;
export type NewKey = Insertable<CryptographicKeysTable>;
export type KeyUpdate = Updateable<CryptographicKeysTable>;
export type CodeRow = Selectable<CodesTable>;
export type NewCode = Insertable<CodesTable>;
export type CodeUpdate = Updateable<CodesTable>;
export type AccountRow = Selectable<AccountsTable>;
export type NewAccount = Insertable<AccountsTable>;
export type AccountUpdate = Updateable<AccountsTable>;
export type AccountRecoveryCodeRow = Selectable<AccountRecoveryCodesTable>;
export type NewAccountRecoveryCode = Insertable<AccountRecoveryCodesTable>;
export type AdminUserRow = Selectable<AdminUsersTable>;
export type NewAdminUser = Insertable<AdminUsersTable>;
export type AdminUserUpdate = Updateable<AdminUsersTable>;
export type SessionRow = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type OwnershipRow = Selectable<OwnershipTable>;
export type NewOwnership = Insertable<OwnershipTable>;
export type OwnershipTransferRow = Selectable<OwnershipTransfersTable>;
export type NewOwnershipTransfer = Insertable<OwnershipTransfersTable>;
export type OwnershipCertificateRow = Selectable<OwnershipCertificatesTable>;
export type NewOwnershipCertificate = Insertable<OwnershipCertificatesTable>;
export type RetailerRow = Selectable<RetailersTable>;
export type NewRetailer = Insertable<RetailersTable>;
export type RetailerUpdate = Updateable<RetailersTable>;
export type WarrantyRow = Selectable<WarrantiesTable>;
export type NewWarranty = Insertable<WarrantiesTable>;
export type WarrantyUpdate = Updateable<WarrantiesTable>;
export type ServiceRecordRow = Selectable<ServiceRecordsTable>;
export type NewServiceRecord = Insertable<ServiceRecordsTable>;
export type ScanTokenRow = Selectable<ScanTokensTable>;
export type NewScanToken = Insertable<ScanTokensTable>;
export type ScanEventRow = Selectable<ScanEventsTable>;
export type NewScanEvent = Insertable<ScanEventsTable>;
export type ScanDailyStatsRow = Selectable<ScanDailyStatsTable>;
export type AuthenticationEventRow = Selectable<AuthenticationEventsTable>;
export type NewAuthenticationEvent = Insertable<AuthenticationEventsTable>;
export type AnomalyRow = Selectable<AnomaliesTable>;
export type NewAnomaly = Insertable<AnomaliesTable>;
export type AnomalyUpdate = Updateable<AnomaliesTable>;
export type ScanReportRow = Selectable<ScanReportsTable>;
export type NewScanReport = Insertable<ScanReportsTable>;
export type MediaObjectRow = Selectable<MediaObjectsTable>;
export type NewMediaObject = Insertable<MediaObjectsTable>;
export type DropRow = Selectable<DropsTable>;
export type NewDrop = Insertable<DropsTable>;
export type DropUpdate = Updateable<DropsTable>;
export type DropEntryRow = Selectable<DropEntriesTable>;
export type NewDropEntry = Insertable<DropEntriesTable>;
export type CirclePostRow = Selectable<CirclePostsTable>;
export type NewCirclePost = Insertable<CirclePostsTable>;
export type CirclePostUpdate = Updateable<CirclePostsTable>;
export type CirclePostImageRow = Selectable<CirclePostImagesTable>;
export type CircleRsvpRow = Selectable<CircleRsvpsTable>;
export type CirclePollVoteRow = Selectable<CirclePollVotesTable>;
export type ClubTierRow = Selectable<ClubTiersTable>;
export type DropSizeRow = Selectable<DropSizesTable>;
export type LiveEntryRow = Selectable<LiveEntriesTable>;
export type LiveEntryUpdate = Updateable<LiveEntriesTable>;
export type LiveAddonRow = Selectable<LiveAddonsTable>;
export type LiveMessageRow = Selectable<LiveMessagesTable>;
export type LiveTierWindowRow = Selectable<LiveTierWindowsTable>;
export type StockLocationRow = Selectable<StockLocationsTable>;
export type SkuRow = Selectable<SkusTable>;
export type StockMovementRow = Selectable<StockMovementsTable>;
export type CarrierRow = Selectable<CarriersTable>;
export type OrderRow = Selectable<OrdersTable>;
export type OrderUpdate = Updateable<OrdersTable>;
export type OrderEventRow = Selectable<OrderEventsTable>;
export type BenchItemRow = Selectable<BenchItemsTable>;
export type EventJournalRow = Selectable<EventJournalTable>;
export type RevocationRow = Selectable<RevocationsTable>;
export type NewRevocation = Insertable<RevocationsTable>;
export type AuditLogRow = Selectable<AuditLogsTable>;
export type ProductOverviewRow = Selectable<ProductOverviewView>;

// ── Value helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a bytea value to a plain Uint8Array. connection.ts already makes
 * both drivers return Uint8Array; this covers Buffers from other code paths
 * and Postgres hex text ('\x0102…', e.g. from row_to_json or ::text casts).
 */
export function toBytes(v: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof v === 'string') {
    if (!/^\\x(?:[0-9a-fA-F]{2})*$/.test(v)) throw new TypeError('toBytes: expected Postgres bytea hex text (\\x…)');
    const out = new Uint8Array((v.length - 2) / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(v.slice(2 + 2 * i, 4 + 2 * i), 16);
    return out;
  }
  if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
  if (v instanceof Uint8Array) {
    // Copy Buffers (and other subclasses): they may be views on a shared pool slab.
    return v.constructor === Uint8Array ? v : new Uint8Array(v);
  }
  throw new TypeError('toBytes: unsupported value');
}

/**
 * Serialise a value for a jsonb column. Rejects what Postgres jsonb cannot
 * store faithfully (non-finite numbers, BigInt, NUL characters) instead of
 * letting the insert fail with a driver-specific error.
 */
export function jsonText(value: unknown): string {
  const s = JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('jsonText: non-finite number');
    if (typeof v === 'bigint') throw new TypeError('jsonText: BigInt is not JSON');
    return v;
  });
  if (s === undefined) throw new TypeError('jsonText: value is not JSON-serialisable');
  if (s.includes('\\u0000')) throw new TypeError('jsonText: NUL characters cannot be stored in jsonb');
  return s;
}
