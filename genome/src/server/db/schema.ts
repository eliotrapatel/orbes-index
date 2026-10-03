/**
 * Kysely types for the ORBES database. Mirrors migrations/0001_initial.ts
 * and the later migrations (0002–0015) column for column (snake_case, no CamelCasePlugin) so raw SQL, types and
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

export const PRODUCT_STATUSES = [
  'ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED',
  'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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
}

/**
 * An account's entry in a drop (migration 0015, P-R03): one per account and drop, reactivated rather than deleted and
 * inserted again. `tier`, `seniority` and `rank` are written by the draw; `respond_by` by the draw or an offer to the
 * next of the waiting list; `handled_by`, `handled_at` and `note` by the console. id, drop_id, account_id and
 * created_at never change.
 */
export interface DropEntriesTable {
  id: Generated<string>;
  drop_id: string;
  account_id: string;
  created_at: TimestampDefault;
  status: WithDefault<DropEntryStatus>;
  tier: number | null;                 // smallint 0..3, the club's tier at the draw (0: no piece held)
  seniority: number | null;            // smallint ≥ 0, full years since the account's first ownership, at the draw
  rank: number | null;                 // int ≥ 1, the entry's place in the draw's order
  respond_by: TimestampNullable;
  handled_by: string | null;           // admin_users.id
  handled_at: TimestampNullable;
  note: string | null;                 // ≤ 500 characters, the console's
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
