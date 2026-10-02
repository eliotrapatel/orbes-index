/**
 * JSON shapes of the admin API (PLATFORM-CONTRACTS §3), as the browser sees
 * them: dates arrive as ISO strings, byte fields as hex/base64url strings.
 *
 * The enum lists mirror src/server/db/schema.ts. They are duplicated rather
 * than imported because server modules are Node-only and must never enter
 * the browser bundle; test/web/admin.model.test.ts asserts they stay equal.
 */

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

/** RETAIL (A-08): a seller's account, under AUDITOR, that sees the sale mode only. */
export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR', 'RETAIL'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Roles the Team page gives (create, change role); ADMIN is granted from the shell only. */
export const STAFF_ROLES = ['OPERATOR', 'AUDITOR', 'RETAIL'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SERVICE_TYPES = ['INSPECTION', 'CLEANING', 'POLISH', 'RESIZE', 'REPAIR', 'REPLACEMENT', 'AUTHENTICATION'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const VERIFICATION_STATES = [
  'AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED',
  'SUSPICIOUS_ACTIVITY', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** The scans the daily statistics count (server: SCAN_STAT_EVENT_TYPES): staff scans (ADMIN_TEST) never. */
export const SCAN_STAT_EVENT_TYPES = ['VERIFY', 'REGISTER', 'TRANSFER'] as const;
export type ScanStatEventType = (typeof SCAN_STAT_EVENT_TYPES)[number];

/** Counterfeit signals: the states of a code ORBES did not issue, or not for this scan (server: services/scan-stats.ts). */
export const SIGNAL_STATES = ['INVALID_SIGNATURE', 'UNKNOWN', 'MALFORMED_CODE', 'SUSPICIOUS_ACTIVITY'] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

/** Orders of the anomalies list (server: ANOMALY_SORTS); the types themselves come from GET /api/admin/anomalies/summary. */
export const ANOMALY_SORTS = ['severity', 'risk', 'lastSeen'] as const;
export type AnomalySort = (typeof ANOMALY_SORTS)[number];

export const REVOCATION_TARGET_TYPES = ['CODE', 'PRODUCT', 'KEY'] as const;
export type RevocationTargetType = (typeof REVOCATION_TARGET_TYPES)[number];

/** Where the customer saw or bought the piece of a reported scan (scan_reports.channel). */
export const REPORT_CHANNELS = ['BOUTIQUE', 'ONLINE', 'PRIVATE', 'OTHER'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** A case of the Cases queue (scan_reports.status). */
export const REPORT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const WARRANTY_STATUSES = ['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** Authenticator kinds a product policy may combine (contract §2.11); only PRINTED_CODE is implemented. */
export const AUTH_POLICY_KINDS = ['PRINTED_CODE', 'SECURE_NFC', 'SECURE_ELEMENT', 'TAMPER_EVIDENT'] as const;

/** Colourways, named as in the core and the artifact API (classic = black on white, the reference). */
export const ARTIFACT_THEMES = ['classic', 'inverted', 'ivory'] as const;
export type ArtifactTheme = (typeof ARTIFACT_THEMES)[number];
export type ArtifactFormat = 'svg' | 'png' | 'pdf';

type Iso = string;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Items<T> {
  items: T[];
}

// ── Auth ───────────────────────────────────────────────────────────────────

export interface AdminProfile {
  id: string;
  email: string;
  role: AdminRole;
  totpEnabled: boolean;
  /** Signed in with a temporary password: the console shows only the password change until it is replaced. */
  passwordChangeRequired: boolean;
}

/** GET /api/admin/admins (ADMIN only). */
export interface AdminUser extends AdminProfile {
  locked: boolean;
  disabled: boolean;
  createdAt: Iso;
}

/** POST /api/admin/admins: the new staff account and its temporary password, shown once. */
export interface StaffCreated {
  admin: AdminUser;
  temporaryPassword: string;
}

/** GET /api/admin/admins/:id/sessions (never a token). */
export interface AdminSessionInfo {
  createdAt: Iso;
  lastSeenAt: Iso;
  expiresAt: Iso;
  mfaPassed: boolean;
  userAgent: string | null;
  /** The session of the ADMIN looking at the list. */
  current: boolean;
}

export interface AdminSession {
  admin: AdminProfile;
  csrfToken: string;
  mfaPassed: boolean;
  mfaRequired: boolean;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardData {
  generatedAt: Iso;
  products: { total: number; byStatus: Record<ProductStatus, number> };
  scans: { last24h: number; last7d: number };
  anomalies: { open: number; openBySeverity: Record<AnomalySeverity, number> };
  activeKey: { keyId: number; kid: string; activatedAt: Iso | null } | null;
  recentEvents: {
    scanId: string;
    occurredAt: Iso;
    eventType: string;
    state: string;
    productId: string | null;
    country: string | null;
  }[];
}

// ── Analytics ──────────────────────────────────────────────────────────────

/** GET /api/admin/analytics: the daily scan statistics of a window of complete UTC days (API §16.16). */
export interface AnalyticsData {
  /** `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  days: number;
  /** The last day the statistics cover (yesterday, UTC). */
  through: string;
  total: number;
  byState: Record<VerificationState, number>;
  byEventType: Record<ScanStatEventType, number>;
  signals: Record<SignalState, number> & { total: number };
  /** Every day of the window, oldest first. */
  daily: { day: string; total: number; byState: Record<VerificationState, number> }[];
  /** Countries with scans, most first; `ZZ` when the location is unknown. */
  countries: AnalyticsCountry[];
}

export interface AnalyticsCountry {
  country: string;
  total: number;
  signals: number;
  byState: Record<VerificationState, number>;
}

// ── Catalogue ──────────────────────────────────────────────────────────────

export interface Category {
  index: number;
  code: string;
  name: string;
  warrantyMonths: number;
  active: boolean;
  createdAt: Iso;
  /** Pieces issued in the category: a deactivation leaves them verifying as before. */
  products: number;
}

export interface Collection {
  id: string;
  name: string;
  models: number;
  /** Issued pieces whose public result names this collection (their own, else their model's). */
  products: number;
  createdAt: Iso;
}

export interface Model {
  id: string;
  name: string;
  type: string;
  skuPrefix: string;
  category: { index: number; code: string; name: string };
  collection: { id: string; name: string | null } | null;
  defaultMaterial: string | null;
  careInstructions: string | null;
  /** Offered for new products (the generator hides an inactive model; the server refuses it, 409 MODEL_INACTIVE). */
  active: boolean;
  /** Pieces issued with this model: their public result reads its name, care instructions and collection. */
  products: number;
  createdAt: Iso;
}

/** PATCH /api/admin/models/:id: never the category nor the SKU prefix. '' clears the material, the care or the collection. */
export interface ModelChange {
  name?: string;
  defaultMaterial?: string;
  careInstructions?: string;
  collectionId?: string;
  active?: boolean;
}

// ── Products, genomes, codes ───────────────────────────────────────────────

export interface ProductOverview {
  id: string;
  productId: string;
  sku: string;
  category: string;
  categoryCode: string;
  collection: string | null;
  model: string;
  modelType: string;
  variant: string | null;
  material: string;
  productionBatch: string | null;
  productionDate: string | null;
  genomeId: string | null;
  genomePattern: string | null;
  genomeFingerprint: string | null;
  codeId: string | null;
  codeVersion: number | null;
  codeIssue: number | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface ProductJson {
  id: string;
  productId: string;
  packedIdentity: number;
  year: number;
  categoryIndex: number;
  categoryCode: string;
  serial: number;
  sku: string;
  modelId: string;
  collectionId: string | null;
  variant: string | null;
  material: string;
  productionBatch: string | null;
  productionDate: string | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  authPolicy: string;
  hasClaimSecret: boolean;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface GenomeJson {
  id: string;
  productId: string;
  version: number;
  versionLabel: string;
  value: number;
  glyphs: number[];
  ids: string[];
  pattern: string;
  fingerprint: string;
  createdAt: Iso;
}

export interface CodeJson {
  id: string;
  productId: string;
  keyId: number;
  codeVersion: number;
  issue: number;
  issuedDay: number;
  issuedAt: string;
  nonce: string;
  payloadHash: string;
  status: CodeStatus;
  revokedAt: Iso | null;
  revocationReason: string | null;
  createdAt: Iso;
  /** In the codes registry only (GET /api/admin/codes): a print sheet accepts it (ACTIVE, of a product that may still be printed). */
  printable?: boolean;
}

/** Filters of the codes registry (GET /api/admin/codes and /api/admin/codes/ids). Dates are UTC days, both included. */
export interface CodeFilters {
  productionBatch?: string;
  modelId?: string;
  status?: string;
  issuedFrom?: string;
  issuedTo?: string;
}

/** GET /api/admin/codes/ids: the printable (ACTIVE) codes of a filter, at most 1 000, in identity order. */
export interface CodeIds {
  ids: string[];
  total: number;
  truncated: boolean;
}

/** OPERATOR responses (issue, re-issue) carry the scannable base64url data once. */
export interface IssuedCodeJson extends CodeJson {
  data: string;
}

export type LiveCodeCheck = { valid: true; keyStatus: string } | { valid: false; reason: string; keyStatus: string | null };

export interface IssueResponse {
  product: ProductJson;
  genome: GenomeJson;
  code: IssuedCodeJson;
  claimCode?: string;
}

export interface IssueInput {
  categoryCode: string;
  modelId: string;
  material: string;
  year?: number;
  collectionId?: string;
  sku?: string;
  variant?: string;
  productionBatch?: string;
  productionDate?: string;
  serial?: number;
  withClaimSecret?: boolean;
  authPolicy?: string;
}

/** POST /api/admin/products/batch: what every piece shares (an issue body without variant, SKU and serial). */
export type IssueBatchTemplate = Omit<IssueInput, 'variant' | 'sku' | 'serial'>;

/** What changes from one piece of a batch to the next. */
export type IssueBatchItem = Pick<IssueInput, 'variant' | 'sku' | 'serial'>;

/** One piece of a batch, in the order sent: signed (its claim code shown once), refused, or never attempted. */
export type IssueBatchLine =
  | { index: number; status: 'ISSUED'; productId: string; codeId: string; serial: number; sku: string; variant: string | null; claimCode?: string }
  | { index: number; status: 'FAILED'; error: { code: string; message: string } }
  | { index: number; status: 'SKIPPED' };

export interface IssueBatchResponse {
  issued: number;
  failed: number;
  skipped: number;
  items: IssueBatchLine[];
}

export interface StatusHistoryEntry {
  id: string;
  from: ProductStatus | null;
  to: ProductStatus;
  reason: string | null;
  actorType: string;
  actorId: string | null;
  at: Iso;
}

export interface StatusChange {
  id: string;
  productId: string;
  from: ProductStatus;
  to: ProductStatus;
  reason: string | null;
  at: Iso;
}

export interface LifecycleSnapshot {
  status: ProductStatus;
  allowed: ProductStatus[];
  returnTo: ProductStatus | null;
  canReinstate: boolean;
}

export interface CurrentOwner {
  accountId: string;
  acquiredVia: string;
  verified: boolean;
  since: Iso;
  transferPending: boolean;
}

export interface OwnershipHistoryEntry {
  id: string;
  accountId: string;
  email: string;
  displayName: string | null;
  acquiredVia: string;
  verified: boolean;
  startedAt: Iso;
  endedAt: Iso | null;
  endedReason: string | null;
}

export interface TransferRecord {
  id: string;
  fromAccountId: string;
  toAccountId: string | null;
  status: string;
  createdAt: Iso;
  expiresAt: Iso;
  completedAt: Iso | null;
}

export interface WarrantyRecord {
  productId: string;
  purchaseDate: string | null;
  /** The point of sale's name: from the register when `retailerId` is set, else the free text of older records. */
  retailer: string | null;
  /** The point of sale in the register (A-08), or null. */
  retailerId: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number;
  voidedAt: Iso | null;
  voidReason: string | null;
  status: WarrantyStatus;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface ServiceRecord {
  id: string;
  productId: string;
  type: ServiceType;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  location: string | null;
  notes: string | null;
  openedAt: Iso;
  closedAt: Iso | null;
  performedBy: string | null;
}

export interface AnomalyRecord {
  id: string;
  productId: string | null;
  productUuid: string | null;
  codeId: string | null;
  type: string;
  severity: AnomalySeverity;
  riskScore: number;
  details: Record<string, unknown>;
  status: AnomalyStatus;
  occurrences: number;
  firstSeenAt: Iso;
  lastSeenAt: Iso;
  resolvedBy: string | null;
  resolvedAt: Iso | null;
  resolutionNote: string | null;
  /** The console user whose triage decision is the latest (acknowledged, resolved, dismissed or reopened). */
  actorEmail: string | null;
  /** In GET /api/admin/anomalies and …/:id/context: what customers said about the scans that took part in it (null: nobody). */
  reports?: AnomalyReports | null;
}

/** A customer's report on a scan, as the scans and anomalies lists show it. */
export interface ReportSummary {
  id: string;
  channel: ReportChannel;
  place: string | null;
  note: string | null;
  status: ReportStatus;
  createdAt: Iso;
}

export interface AnomalyReports {
  count: number;
  open: number;
  latest: ReportSummary;
}

/** A case of the Cases queue: the report, its scan, the anomaly the scan took part in, its piece. */
export interface CaseRecord extends ReportSummary {
  scanId: string;
  handledBy: { id: string; email: string } | null;
  handledAt: Iso | null;
  resolutionNote: string | null;
  scan: { occurredAt: Iso; state: string; productId: string | null; country: string | null; region: string | null };
  anomaly: { id: string; type: string; severity: AnomalySeverity; status: AnomalyStatus } | null;
}

/** Filters and order of GET /api/admin/anomalies, as kept in the view's URL. */
export interface AnomalyFilters {
  /** One anomaly (a case's link to the anomaly its scan took part in). */
  id?: string;
  status?: string;
  severity?: string;
  type?: string;
  productId?: string;
  sort?: string;
}

/** GET /api/admin/anomalies/summary. */
export interface AnomalySummary {
  /** OPEN findings by severity. */
  open: Record<AnomalySeverity, number>;
  /** OPEN HIGH + CRITICAL: the badge on Anomalies. */
  attention: number;
  /** Every type the server can record. */
  types: string[];
}

export interface AnomalyScan {
  id: string;
  occurredAt: Iso;
  eventType: string;
  state: string;
  country: string | null;
  region: string | null;
  deviceHash: string | null;
  userAgentFamily: string | null;
  riskScore: number | null;
  /** The scan that last raised the finding (details.scanEventId). */
  trigger: boolean;
  /** The customer's report on this scan and the state of its case (null: none). */
  report: { id: string; channel: ReportChannel; place: string | null; status: ReportStatus } | null;
}

/** GET /api/admin/anomalies/:id/context: the scans around one finding. */
export interface AnomalyContext {
  anomaly: AnomalyRecord;
  window: { from: Iso; to: Iso };
  scans: { total: number; truncated: boolean; items: AnomalyScan[] };
  countries: { country: string | null; scans: number }[];
  devices: number;
  trigger: AnomalyScan | null;
  code: { id: string; issue: number; status: CodeStatus } | null;
  product: { productId: string; lifecycle: LifecycleSnapshot } | null;
}

export interface ProductDetail {
  product: ProductJson & {
    category: { index: number; code: string; name: string };
    model: { id: string; name: string; type: string; skuPrefix: string; care: string | null };
    collection: string | null;
  };
  genome: GenomeJson | null;
  genomes: GenomeJson[];
  codes: (CodeJson & { verification: LiveCodeCheck })[];
  scans: { count: number; lastAt: Iso | null };
  ownership: { current: CurrentOwner | null; owners: OwnershipHistoryEntry[]; transfers: TransferRecord[] };
  warranty: WarrantyRecord | null;
  services: ServiceRecord[];
  anomalies: AnomalyRecord[];
  statusHistory: StatusHistoryEntry[];
  lifecycle: LifecycleSnapshot;
}

// ── Registries ─────────────────────────────────────────────────────────────

export interface ScanRecord {
  id: string;
  occurredAt: Iso;
  eventType: string;
  state: string;
  productId: string | null;
  codeId: string | null;
  packedIdentity: number | null;
  accountId: string | null;
  /** The console user behind a staff scan (ADMIN_TEST: the sale mode, or /verify in a browser signed in to the console), by email. */
  adminEmail: string | null;
  deviceHash: string | null;
  country: string | null;
  region: string | null;
  lat: number | null;
  lon: number | null;
  userAgentFamily: string | null;
  clientMetrics: Record<string, unknown> | null;
  latencyMs: number | null;
  authentication: {
    signatureValid: boolean;
    genomeCheck: string;
    keyId: number | null;
    reasons: string[];
    riskScore: number;
    authenticators: unknown;
  } | null;
  /** The customer's report on this scan and the state of its case (null: none). */
  report: ReportSummary | null;
}

export interface OwnerRecord {
  id: string;
  /** In clear for OPERATOR and ADMIN, masked (`j***@example.com`) for an AUDITOR. */
  email: string;
  displayName: string | null;
  country: string | null;
  status: string;
  createdAt: Iso;
  products: number;
  productsEver: number;
  /** After an assisted recovery, new transfers out of the account are refused until then (72 hours). */
  transfersPausedUntil: Iso | null;
  /** The expiry of the open recovery code, while it can still be used. */
  recoveryCodeExpiresAt: Iso | null;
  /** After 5 wrong guesses at the open code within an hour, it is refused without being checked until then. */
  recoveryCodeThrottledUntil: Iso | null;
}

/** A scan found by the REF printed under a result, with the accounts it leads to. */
export interface ReferenceMatch {
  scanId: string;
  reference: string;
  occurredAt: Iso;
  eventType: string;
  state: string;
  productId: string | null;
  /** The account signed in when it scanned, if any. */
  scannedBy: string | null;
  /** The piece's current owner, if any. */
  ownerId: string | null;
}

/** GET /api/admin/owners: `scans` only for a search by REF. */
export interface OwnerList extends Paged<OwnerRecord> {
  scans?: ReferenceMatch[];
}

export interface OwnedPiece {
  productId: string;
  model: string;
  type: string;
  material: string;
  variant: string | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  acquiredVia: string;
  verified: boolean;
  since: Iso;
  /** Null while the account owns it. */
  until: Iso | null;
  endedReason: string | null;
}

/** GET /api/admin/owners/:id: the owner's sheet. */
export interface OwnerSheet {
  owner: OwnerRecord;
  pieces: OwnedPiece[];
  transfers: { id: string; productId: string; createdAt: Iso; expiresAt: Iso }[];
  scans: { id: string; reference: string; occurredAt: Iso; eventType: string; state: string; productId: string | null; country: string | null }[];
}

/** POST /api/admin/owners/:id/lock. */
export interface OwnerLock {
  status: 'LOCKED';
  sessionsRevoked: number;
  transfersCancelled: number;
  /** The open recovery code the lock revoked (0 or 1). */
  recoveryCodesRevoked: number;
}

/** POST /api/admin/owners/:id/recovery-code: the code, in this response only. */
export interface RecoveryCode {
  /** XXXX-XXXX-XXXX (12 Crockford base32 characters). */
  recoveryCode: string;
  expiresAt: Iso;
}

export interface RevocationRecord {
  id: string;
  targetType: RevocationTargetType;
  targetId: string;
  reasonCode: string;
  reason: string | null;
  createdBy: string;
  createdAt: Iso;
  liftedAt: Iso | null;
  liftedBy: string | null;
}

export interface KeyJson {
  keyId: number;
  kid: string;
  alg: string;
  publicKey: string;
  status: KeyStatus;
  provider: string;
  createdAt: Iso;
  activatedAt: Iso | null;
  retiredAt: Iso | null;
  revokedAt: Iso | null;
  compromisedAt: Iso | null;
  revocationReason: string | null;
}

export interface AuditEntry {
  id: number;
  occurredAt: Iso;
  actorType: 'admin' | 'account' | 'system';
  actorId: string | null;
  /** The console user's email when the actor is an admin (read at display time; the log keeps ids). */
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** The console user's email when the target is an admin (the Team page's actions). */
  targetEmail: string | null;
  details: Record<string, unknown>;
  ipHash: string | null;
  prevHash: string;
  hash: string;
}

// ── Points of sale and the sale mode (A-08) ────────────────────────────────

/** GET /api/admin/retailers: the register a warranty's point of sale is chosen from. */
export interface Retailer {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  active: boolean;
  createdAt: Iso;
  updatedAt: Iso;
}

export const SALE_REFUSALS = ['NOT_AUTHENTIC', 'WARRANTY_ACTIVE', 'WARRANTY_VOID', 'ALREADY_REGISTERED', 'NOT_FOR_SALE'] as const;
export type SaleRefusal = (typeof SALE_REFUSALS)[number];

/** POST /api/admin/sale/lookup: the piece behind a scanned code and, when it can be sold, a 10-minute token. */
export interface SaleLookup {
  scanId: string;
  state: VerificationState;
  piece: {
    productId: string;
    status: ProductStatus;
    category: { code: string; name: string };
    collection: string | null;
    model: string;
    type: string;
    variant: string | null;
    material: string;
    createdYear: number;
    registered: boolean;
    warranty: { status: WarrantyStatus; startDate: string | null; endDate: string | null };
  } | null;
  sale: { token: string; expiresAt: Iso } | null;
  refusal: { code: SaleRefusal; message: string } | null;
}

/** POST /api/admin/sale/activate. */
export interface SaleActivation {
  warranty: WarrantyRecord;
  statusChange: StatusChange | null;
  scanId: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBadId?: number;
  head: { id: number; hash: string } | null;
}
