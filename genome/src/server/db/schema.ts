/**
 * Kysely types for the ORBES database. Mirrors migrations/0001_initial.ts
 * and the later migrations (0002–0004) column for column (snake_case, no CamelCasePlugin) so raw SQL, types and
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

export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

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

export const SCAN_TOKEN_PURPOSES = ['FIRST_REGISTRATION'] as const;
export type ScanTokenPurpose = (typeof SCAN_TOKEN_PURPOSES)[number];

export const SCAN_EVENT_TYPES = ['VERIFY', 'REGISTER', 'TRANSFER', 'ADMIN_TEST'] as const;
export type ScanEventType = (typeof SCAN_EVENT_TYPES)[number];

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
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
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

export interface WarrantiesTable {
  id: Generated<string>;
  product_id: string;
  purchase_date: DateNullable;
  retailer: string | null;
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
  products: ProductsTable;
  product_status_history: ProductStatusHistoryTable;
  genomes: GenomesTable;
  cryptographic_keys: CryptographicKeysTable;
  codes: CodesTable;
  accounts: AccountsTable;
  admin_users: AdminUsersTable;
  sessions: SessionsTable;
  ownership: OwnershipTable;
  ownership_transfers: OwnershipTransfersTable;
  warranties: WarrantiesTable;
  service_records: ServiceRecordsTable;
  scan_tokens: ScanTokensTable;
  scan_events: ScanEventsTable;
  authentication_events: AuthenticationEventsTable;
  anomalies: AnomaliesTable;
  scan_reports: ScanReportsTable;
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
export type AdminUserRow = Selectable<AdminUsersTable>;
export type NewAdminUser = Insertable<AdminUsersTable>;
export type AdminUserUpdate = Updateable<AdminUsersTable>;
export type SessionRow = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type OwnershipRow = Selectable<OwnershipTable>;
export type NewOwnership = Insertable<OwnershipTable>;
export type OwnershipTransferRow = Selectable<OwnershipTransfersTable>;
export type NewOwnershipTransfer = Insertable<OwnershipTransfersTable>;
export type WarrantyRow = Selectable<WarrantiesTable>;
export type NewWarranty = Insertable<WarrantiesTable>;
export type WarrantyUpdate = Updateable<WarrantiesTable>;
export type ServiceRecordRow = Selectable<ServiceRecordsTable>;
export type NewServiceRecord = Insertable<ServiceRecordsTable>;
export type ScanTokenRow = Selectable<ScanTokensTable>;
export type NewScanToken = Insertable<ScanTokensTable>;
export type ScanEventRow = Selectable<ScanEventsTable>;
export type NewScanEvent = Insertable<ScanEventsTable>;
export type AuthenticationEventRow = Selectable<AuthenticationEventsTable>;
export type NewAuthenticationEvent = Insertable<AuthenticationEventsTable>;
export type AnomalyRow = Selectable<AnomaliesTable>;
export type NewAnomaly = Insertable<AnomaliesTable>;
export type AnomalyUpdate = Updateable<AnomaliesTable>;
export type ScanReportRow = Selectable<ScanReportsTable>;
export type NewScanReport = Insertable<ScanReportsTable>;
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
