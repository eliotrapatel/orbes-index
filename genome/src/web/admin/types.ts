/**
 * JSON shapes of the admin API (PLATFORM-CONTRACTS §3), as the browser sees
 * them: dates arrive as ISO strings, byte fields as hex/base64url strings.
 *
 * The enum lists mirror src/server/db/schema.ts. They are duplicated rather
 * than imported because server modules are Node-only and must never enter
 * the browser bundle; test/web/admin.model.test.ts asserts they stay equal.
 */

/** RESERVED: an identity reserved for a piece to make (the atelier's work sheet), not issued yet. */
export const PRODUCT_STATUSES = [
  'RESERVED', 'ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED',
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

/** Where a model stands in the lookbook (P-R02, models.lookbook): HIDDEN, PUBLIC (everyone) or RESERVED (the owners of a piece). */
export const LOOKBOOK_STATES = ['HIDDEN', 'PUBLIC', 'RESERVED'] as const;
export type LookbookState = (typeof LOOKBOOK_STATES)[number];

/** A drop's state (P-R03), computed by the server from its dates: DRAFT until published, CANCELLED before its draw only. */
export const DROP_STATES = ['DRAFT', 'UPCOMING', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED'] as const;
export type DropState = (typeof DROP_STATES)[number];

/** An entry of a drop (P-R03, drop_entries.status). */
export const DROP_ENTRY_STATUSES = ['ENTERED', 'SELECTED', 'WAITLISTED', 'CONFIRMED', 'LAPSED', 'WITHDRAWN'] as const;
export type DropEntryStatus = (typeof DROP_ENTRY_STATUSES)[number];

/** A post of the owners' circle (P-X01, circle_posts.kind): a NOTE, an INVITATION (answered YES or NO) or a POLL. */
export const CIRCLE_POST_KINDS = ['NOTE', 'INVITATION', 'POLL'] as const;
export type CirclePostKind = (typeof CIRCLE_POST_KINDS)[number];

/** An answer to an invitation of the circle (P-X01, circle_rsvps.answer). */
export const CIRCLE_RSVP_ANSWERS = ['YES', 'NO'] as const;
export type CircleRsvpAnswer = (typeof CIRCLE_RSVP_ANSWERS)[number];

/** The tiers of the club (P-X04, club_tiers.tier), in order: 1 TITANE, 2 PLATINE, 3 PALLADIUM (1, 3 and 5 pieces held now). */
export const CLUB_TIER_NAMES = ['TITANE', 'PLATINE', 'PALLADIUM'] as const;
export type ClubTierName = (typeof CLUB_TIER_NAMES)[number];

/** A request of the private salon (P-X08, shop_requests.status): OPEN until the console closes it with a note. */
export const SHOP_REQUEST_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ShopRequestStatus = (typeof SHOP_REQUEST_STATUSES)[number];

/** How a request of the private salon was closed (shop_requests.outcome): ACCEPTED, an order follows, or DECLINED. */
export const SHOP_REQUEST_OUTCOMES = ['ACCEPTED', 'DECLINED'] as const;
export type ShopRequestOutcome = (typeof SHOP_REQUEST_OUTCOMES)[number];

/** Where an order comes from (orders.channel): a LIVE RELEASE, a draw, the private salon. */
export const ORDER_CHANNELS = ['LIVE', 'DRAW', 'SALON'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** The steps of an order (orders.status): RESERVED → PAID → SHIPPED → DELIVERED, or CANCELLED, or RETURNED. */
export const ORDER_STATUSES = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** What an order RESERVED or PAID holds at its location (orders.reservation): a piece in stock, or a piece to make. */
export const ORDER_RESERVATIONS = ['STOCK', 'BENCH'] as const;
export type OrderReservation = (typeof ORDER_RESERVATIONS)[number];

/** Why the stock moved (stock_movements.reason). */
export const STOCK_MOVEMENT_REASONS = ['PRODUCED', 'ADJUSTED', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHIPPED', 'RETURNED'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** A piece to make at the atelier (bench_items.status). */
export const BENCH_ITEM_STATUSES = ['TO_MAKE', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type BenchItemStatus = (typeof BENCH_ITEM_STATUSES)[number];

/** Where a returned order's piece goes (returns.outcome). */
export const RETURN_OUTCOMES = ['RESTOCKED', 'ARCHIVED'] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

/** An invoice, or its credit note (invoices.kind). */
export const INVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** The kind of a drop (drops.mode): a DRAW (P-R03) or a LIVE RELEASE, lived in real time. */
export const DROP_MODES = ['DRAW', 'LIVE'] as const;
export type DropMode = (typeof DROP_MODES)[number];

/** How a LIVE RELEASE ended (drops.ended_reason): every piece confirmed, at its close, or by an ADMIN. */
export const LIVE_END_REASONS = ['SOLD_OUT', 'CLOSED', 'ENDED'] as const;
export type LiveEndReason = (typeof LIVE_END_REASONS)[number];

/** An entry of a LIVE RELEASE (live_entries.status): in the room, in the line, its turn, secured, confirmed, or out of it. */
export const LIVE_ENTRY_STATUSES = ['WAITING', 'QUEUED', 'TURN', 'SECURED', 'CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'LEFT', 'REMOVED', 'ENDED'] as const;
export type LiveEntryStatus = (typeof LIVE_ENTRY_STATUSES)[number];

/** How ORBES Client Services concluded a confirmed reservation of a LIVE RELEASE (live_entries.resolution). */
export const LIVE_RESOLUTIONS = ['CONCLUDED', 'CANCELLED'] as const;
export type LiveResolution = (typeof LIVE_RESOLUTIONS)[number];

/** Where a LIVE RELEASE stands (services/live.ts livePhase): HIDDEN is published, announced later. */
export const LIVE_PHASES = ['DRAFT', 'HIDDEN', 'ANNOUNCED', 'ROOM', 'LIVE', 'ENDED', 'CANCELLED'] as const;
export type LivePhase = (typeof LIVE_PHASES)[number];

/** The currencies a LIVE RELEASE is priced in (services/live-console.ts LIVE_CURRENCIES). */
export const LIVE_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'] as const;
export type LiveCurrency = (typeof LIVE_CURRENCIES)[number];

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
/** A staff document of the console (GET /api/admin/documents). */
export interface StaffDocumentSummary {
  id: string;
  title: string;
  summary: string;
  lang: 'fr' | 'en';
}

export interface StaffDocument {
  id: string;
  title: string;
  lang: 'fr' | 'en';
  markdown: string;
}

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
  /** The model's reference photograph (F-04): `/api/v1/media/<sha256>`, shown on the authentic results of its pieces; null without one. */
  imageUrl: string | null;
  /** Pieces issued with this model: their public result reads its name, care instructions and collection. */
  products: number;
  /** Its place in the lookbook (P-R02). */
  lookbook: LookbookState;
  /** The address of its sheet, /verify/lookbook/<slug>; null until named; fixed once `publishedAt` is set. */
  slug: string | null;
  /** Plain paragraphs, ≤ 4 000 characters. */
  story: string | null;
  /** One `Label: value` line per specification, ≤ 1 000 characters. */
  specs: string | null;
  /** When it first left HIDDEN; null while it never has. */
  publishedAt: Iso | null;
  /** When an ADMIN discontinued it (P-R06): inactive, and said DISCONTINUED with this year on /verify; null while it is not. */
  discontinuedAt: Iso | null;
  /** P-X08: the price THE PRIVATE SALON shows while the model is RESERVED; null: none. */
  priceLabel: string | null;
  /** P-X08: the lowest tier it is shown to while RESERVED: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  privateMinTier: number;
  /** The gallery of its sheet, in its order (the reference photograph is the cover, apart). */
  gallery: GalleryImage[];
  createdAt: Iso;
}

/** One photograph of a model's lookbook gallery (P-R02). */
export interface GalleryImage {
  sha256: string;
  /** `/api/v1/media/<sha256>`. */
  url: string;
  /** null: the sheet says "The MONOLITHE RING model, photographed by ORBES". */
  alt: string | null;
  position: number;
}

/** POST and DELETE /api/admin/products/:productId/photo (F-04): the piece and the URL of its photograph. */
export interface ProductPhoto {
  productId: string;
  photoUrl: string | null;
}

/** PATCH /api/admin/models/:id: never the category nor the SKU prefix. '' clears the material, the care or the collection. */
export interface ModelChange {
  name?: string;
  defaultMaterial?: string;
  careInstructions?: string;
  collectionId?: string;
  active?: boolean;
  /** The lookbook (P-R02): '' clears the slug (never published), the story or the specifications. */
  lookbook?: LookbookState;
  slug?: string;
  story?: string;
  specs?: string;
  /** THE PRIVATE SALON (P-X08): '' clears the price. */
  priceLabel?: string;
  privateMinTier?: number;
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
    model: { id: string; name: string; type: string; skuPrefix: string; care: string | null; imageUrl: string | null };
    collection: string | null;
    /** The piece's own photograph (F-04), taken at issuance; null without one. */
    photoUrl: string | null;
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
  /** P-X04: the account's tier in the club now (level 0 and name null: none), the pieces it counts, the full years since its first ownership. */
  tier: { level: 0 | 1 | 2 | 3; name: ClubTierName | null; pieces: number; seniority: number };
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
  /** The account's links to ownership certificates the lock withdrew. */
  certificatesRevoked: number;
  /** The account's entries in drops not drawn yet the lock withdrew (P-R03). */
  dropEntriesWithdrawn: number;
  /** The account's open requests of the private salon the lock closed (P-X08). */
  shopRequestsClosed: number;
  /** The account's open entries in the LIVE RELEASES the lock removed. */
  liveEntriesRemoved: number;
  /** The account's interest in LIVE RELEASES not opened yet the lock withdrew. */
  liveInterestWithdrawn: number;
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

// ── The Club: drops (P-R03) ────────────────────────────────────────────────

/** A drop as the console reads it (GET /api/admin/drops, /:id): never its sealed seed, nor the seed before the draw. */
export interface Drop {
  id: string;
  title: string;
  description: string | null;
  model: { id: string; name: string; type: string; active: boolean };
  quantity: number;
  opensAt: Iso;
  closesAt: Iso;
  /** How long a place drawn is held, in hours (1 to 336). */
  purchaseWindowHours: number;
  /** P-X02: the early access before the opening, in hours (0, none, to 336). */
  earlyAccessHours: number;
  /** When PLATINE and PALLADIUM may reserve a place directly (from the publication at the earliest); null without an early access. */
  earlyAccessOpensAt: Iso | null;
  state: DropState;
  publishedAt: Iso | null;
  cancelledAt: Iso | null;
  drawnAt: Iso | null;
  createdAt: Iso;
  createdBy: { id: string; email: string } | null;
  /** SHA-256 of the seed, hexadecimal: committed at creation, published with the drop. */
  seedHash: string;
  /** The seed, once drawn. */
  seed: string | null;
  entries: Record<DropEntryStatus, number>;
  /** P-X02: of the entries SELECTED or CONFIRMED, those reserved directly during the early access. */
  reserved: number;
}

/** POST /api/admin/drops; any field of PATCH /api/admin/drops/:id while a DRAFT (the description only once published). */
export interface DropInput {
  modelId: string;
  title: string;
  description?: string | null;
  quantity: number;
  opensAt: Iso;
  closesAt: Iso;
  purchaseWindowHours?: number;
  /** P-X02: hours of early access (48 when omitted, 0 for none). */
  earlyAccessHours?: number;
}

export type DropChange = Partial<DropInput>;

/** An entry of a drop (GET /api/admin/drops/:id/entries): the email masked for an AUDITOR. */
export interface DropEntry {
  id: string;
  accountId: string;
  email: string;
  status: DropEntryStatus;
  enteredAt: Iso;
  tier: number | null;
  seniority: number | null;
  rank: number | null;
  respondBy: Iso | null;
  /** P-X02: a place reserved directly during the early access (its tier and seniority those of its request, no rank). */
  reserved: boolean;
  handledBy: { id: string; email: string } | null;
  handledAt: Iso | null;
  note: string | null;
}

/** POST /api/admin/drops/:id/draw. */
export interface DrawOutcome {
  drop: Drop;
  entries: number;
  places: number;
  selected: number;
  waitlisted: number;
}

// ── The Club: the LIVE RELEASES ────────────────────────────────────────────

/** A LIVE RELEASE in the console's list (GET /api/admin/live). */
export interface LiveCard {
  id: string;
  title: string;
  model: { id: string; name: string; type: string; active: boolean };
  phase: LivePhase;
  /** Ended, no turn or hold left. */
  over: boolean;
  announcedAt: Iso | null;
  roomOpensAt: Iso;
  /** T0. */
  opensAt: Iso;
  closesAt: Iso;
  quantity: number;
  quantityLine: string;
  priceMinor: number;
  currency: LiveCurrency;
  endedReason: LiveEndReason | null;
  entries: Record<LiveEntryStatus, number>;
  interest: number;
}

/** A LIVE RELEASE as the console reads and edits it (GET /api/admin/live/:id): every setting, never its sealed seed. */
export interface LiveRelease extends LiveCard {
  description: string | null;
  /** Its settings still change: neither announced nor cancelled. */
  editable: boolean;
  roomOpensMinutes: number;
  turnSeconds: number;
  payMinutes: number;
  perAccount: number;
  minTier: number;
  tierPriority: boolean;
  access: { models: { id: string; name: string }[]; collection: { id: string; name: string } | null; text: string };
  sizes: { id: string; label: string; stock: number }[];
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  tierWindows: { tier: number; turnSeconds: number | null; payMinutes: number | null }[];
  /** As set: null, at the publication; a null stage, at the announcement. */
  announceAt: Iso | null;
  silhouetteAt: Iso | null;
  nameAt: Iso | null;
  photoAt: Iso | null;
  /** Once published: when each stage is revealed. */
  stages: { silhouetteAt: Iso; nameAt: Iso; photoAt: Iso } | null;
  silhouette: { sha256: string; url: string } | null;
  boardLink: { issuedAt: Iso } | null;
  circlePosts: { id: string; publishedAt: Iso | null }[];
  publishedAt: Iso | null;
  cancelledAt: Iso | null;
  pausedAt: Iso | null;
  pausedMs: number;
  endedAt: Iso | null;
  createdAt: Iso;
  createdBy: { id: string; email: string } | null;
  seedHash: string;
}

/** POST /api/admin/live: every setting (the defaults for those left out); PATCH: any of them until the announcement. */
export interface LiveSettings {
  modelId: string;
  title: string;
  description?: string | null;
  opensAt: Iso;
  closesAt: Iso;
  roomOpensMinutes?: number;
  turnSeconds?: number;
  payMinutes?: number;
  perAccount?: number;
  priceMinor: number;
  currency?: LiveCurrency;
  minTier?: number;
  tierPriority?: boolean;
  accessModelIds?: string[];
  accessCollectionId?: string | null;
  sizes: { id?: string | null; label: string; stock: number }[];
  quantityLine?: string | null;
  addons?: { id?: string | null; label: string; line?: string | null; priceMinor: number }[];
  announceAt?: Iso | null;
  silhouetteAt?: Iso | null;
  nameAt?: Iso | null;
  photoAt?: Iso | null;
  tierWindows?: { tier: number; turnSeconds?: number | null; payMinutes?: number | null }[];
}

export type LiveSettingsChange = Partial<LiveSettings>;

/** An entry of a LIVE RELEASE as the console reads it: the email masked for an AUDITOR; deadlines as they stand now. */
export interface LiveEntry {
  id: string;
  accountId: string;
  email: string;
  status: LiveEntryStatus;
  size: { id: string; label: string };
  quantity: number;
  tier: number;
  position: number | null;
  joinedAt: Iso;
  turnAt: Iso | null;
  turnExpiresAt: Iso | null;
  securedAt: Iso | null;
  holdExpiresAt: Iso | null;
  confirmedAt: Iso | null;
  endedAt: Iso | null;
  /** From the press of the seal to the secure, in milliseconds. */
  gestureMs: number | null;
  letIn: boolean;
}

/** A size on the live board: its pieces and its people. */
export interface LiveBoardSize {
  id: string;
  label: string;
  stock: number;
  left: number;
  held: number;
  sold: number;
  waiting: number;
  line: number;
  turns: number;
  secured: number;
  confirmed: number;
  missed: number;
  expired: number;
  interest: number;
}

/** The live board (GET /api/admin/live/:id/board, and the `console` events of its stream). */
export interface LiveBoard {
  id: string;
  phase: LivePhase;
  paused: boolean;
  pausedAt: Iso | null;
  over: boolean;
  endedAt: Iso | null;
  endedReason: LiveEndReason | null;
  roomOpensAt: Iso;
  opensAt: Iso;
  closesAt: Iso;
  quantity: number;
  quantityLine: string;
  totals: Omit<LiveBoardSize, 'id' | 'label'> & { inRoom: number; released: number; departed: number; removed: number; ended: number };
  sizes: LiveBoardSize[];
  message: { text: string; at: Iso } | null;
  /** The open entries by place, then arrival (the first 200). */
  line: LiveEntry[];
  lineTotal: number;
  /** The live alerts, from T0 while the release runs (services/live-insights.ts). */
  alerts: LiveAlert[];
  /** The live sell-out forecast, from T0 until the end. */
  sellOut: LiveSellOut | null;
}

/** The release's state after a live control (pause, resume, extend, add pieces, end). */
export interface LiveState {
  id: string;
  roomOpensAt: Iso;
  opensAt: Iso;
  closesAt: Iso;
  pausedAt: Iso | null;
  pausedMs: number;
  endedAt: Iso | null;
  endedReason: LiveEndReason | null;
  quantity: number;
  quantityLine: string;
  sizes: { id: string; label: string; stock: number }[];
}

// ── The Club: the LIVE RELEASES' intelligence (services/live-insights.ts) ──

/** The three live alerts (LIVE_ALERT_KINDS), in the order the board shows them. */
export const LIVE_ALERT_KINDS = ['SIZE_SOLD_OUT', 'MISSED_WAVE', 'LINE_STALLED'] as const;
export type LiveAlertKind = (typeof LIVE_ALERT_KINDS)[number];

export interface LiveAlert {
  kind: LiveAlertKind;
  size: { id: string; label: string } | null;
  since: Iso;
  text: string;
  reasoning: string[];
}

export type LiveSellOutOutlook = 'SOLD_OUT' | 'SELLS_OUT' | 'LINE_SHORT' | 'CLOSE_FIRST' | 'NO_PACE';

export interface LiveSizeSellOut {
  size: { id: string; label: string };
  stock: number;
  remaining: number;
  outlook: LiveSellOutOutlook;
  at: Iso | null;
  expectedLeft: number | null;
  /** Pieces secured a minute. */
  pace: number;
  reasoning: string[];
}

export interface LiveSellOut {
  outlook: LiveSellOutOutlook | 'PARTIAL';
  at: Iso | null;
  expectedLeft: number;
  windowMs: number;
  secureRate: number;
  payRate: number;
  sizes: LiveSizeSellOut[];
  reasoning: string[];
}

/** GET /api/admin/live/:id/forecast: the room expected at T0. */
export interface LiveAudienceForecast {
  low: number;
  high: number;
  expected: number;
  basis: 'INTEREST' | 'ELIGIBLE' | 'NONE';
  interest: number;
  eligible: number;
  /** By tier, 0 (none) to 3 (PALLADIUM). */
  eligibleByTier: number[];
  inRoom: number | null;
  capacity: number;
  aboveCapacity: boolean;
  pastReleases: number;
  reasoning: string[];
}

/** GET /api/admin/live/:id/plan: the release planner. */
export interface LiveReleasePlan {
  forecast: LiveAudienceForecast;
  demandPerPerson: number;
  pastReleases: number;
  quantity: number | null;
  sizes: { id: string; label: string; stock: number; interest: number; collectors: number; suggested: number | null }[];
  otherSizes: { label: string; collectors: number }[];
  eligibleByTier: number[];
  modelType: string;
  reasoning: string[];
}

/** GET /api/admin/live/:id/radar: the demand radar, before T0. */
export interface LiveDemandRadar {
  roomOpen: boolean;
  formed: boolean;
  inRoom: number;
  stock: number;
  interest: number;
  pressure: number | null;
  sizes: {
    id: string;
    label: string;
    stock: number;
    interest: number;
    inRoom: number;
    roomPieces: number;
    demand: number;
    pressure: number | null;
    sellsOut: boolean;
    sellOutAt: Iso | null;
    expectedSold: number;
    addPieces: number | null;
  }[];
  byTier: { tier: number; interest: number; inRoom: number }[];
  conversion: number;
  sellOutAt: Iso | null;
  quantityLine: string;
  reasoning: string[];
}

export const LIVE_BOT_SIGNS = ['NEW_ACCOUNT', 'NETWORK', 'GESTURE_FLOOR', 'GESTURE_REPEAT'] as const;
export type LiveBotSign = (typeof LIVE_BOT_SIGNS)[number];

/** GET /api/admin/live/:id/bots: the bot radar; the emails masked for an AUDITOR. */
export interface LiveBotRadar {
  entries: number;
  flagged: number;
  bySign: Record<LiveBotSign, number>;
  networks: { group: number; entries: number }[];
  items: {
    entryId: string;
    accountId: string;
    email: string;
    status: LiveEntryStatus;
    size: { id: string; label: string };
    tier: number;
    position: number | null;
    open: boolean;
    signs: LiveBotSign[];
    network: number | null;
    reasons: string[];
  }[];
  reasoning: string[];
}

export type LiveFunnelStep = 'INTEREST' | 'ROOM' | 'TURN' | 'SECURED' | 'CONFIRMED' | 'CONCLUDED';

/** GET /api/admin/live/:id/report: the release report. */
export interface LiveReleaseReport {
  id: string;
  title: string;
  final: boolean;
  endedReason: LiveEndReason | null;
  opensAt: Iso;
  endedAt: Iso | null;
  sellOutMs: number | null;
  pausedMs: number;
  currency: LiveCurrency;
  quantityLine: string;
  funnel: { step: LiveFunnelStep; people: number; share: number | null }[];
  sizes: {
    id: string;
    label: string;
    stock: number;
    added: number;
    confirmedPieces: number;
    sellOutMs: number | null;
    unservedPeople: number;
    unservedPieces: number;
    missed: number;
    expired: number;
    released: number;
    nextDemand: number;
  }[];
  byTier: { tier: number; entries: number; turns: number; secured: number; confirmed: number; missed: number; expired: number }[];
  missed: number;
  expired: number;
  released: number;
  addons: { id: string; label: string; reservations: number; pieces: number; revenueMinor: number }[];
  /** The confirmed reservations ORBES Client Services cancelled, left out of the revenue. */
  cancelled: { reservations: number; pieces: number };
  piecesRevenueMinor: number;
  addonsRevenueMinor: number;
  additions: { at: Iso; sizeId: string; size: string; pieces: number; before: number; after: number }[];
  conversion: number;
  next: { quantity: number; sizes: { label: string; pieces: number }[] };
  reasoning: string[];
}

export interface LiveConversionRow {
  entered: number;
  secured: number;
  confirmed: number;
  conversion: number | null;
}

/** GET /api/admin/live/:id/collectors: the collector insights; the emails masked for an AUDITOR. */
export interface LiveCollectorInsights {
  byTier: (LiveConversionRow & { tier: number })[];
  byCountry: (LiveConversionRow & { country: string | null })[];
  repeat: LiveConversionRow;
  firstTime: LiveConversionRow;
  unsecured: {
    total: number;
    items: { entryId: string; accountId: string; email: string; tier: number; size: string; status: LiveEntryStatus; position: number | null; country: string | null }[];
  };
  reasoning: string[];
}

/** A release in the comparison (GET /api/admin/live/:id/comparison). */
export interface LiveComparedRelease {
  id: string;
  title: string;
  current: boolean;
  opensAt: Iso;
  endedReason: LiveEndReason | null;
  currency: LiveCurrency;
  priceMinor: number;
  stock: number;
  added: number;
  interest: number;
  room: number;
  presentAtT0: number;
  turns: number;
  secured: number;
  confirmedPieces: number;
  sellThrough: number | null;
  sellOutMs: number | null;
  missedShare: number | null;
  expired: number;
  conversion: number;
  piecesRevenueMinor: number;
  addonsRevenueMinor: number;
}

export interface LiveReleaseComparison {
  releases: LiveComparedRelease[];
  reasoning: string[];
}

// ── The Club: the circle (P-X01) ───────────────────────────────────────────

/** A photograph of a post of the circle (4 at most). */
export interface CirclePhoto {
  sha256: string;
  /** `/api/v1/media/<sha256>`. */
  url: string;
  /** null: the post's default (its title). */
  alt: string | null;
  position: number;
}

/** A post as the console reads it (GET /api/admin/circle/posts, /:id); the list leaves its body out. */
export interface CirclePost {
  id: string;
  kind: CirclePostKind;
  title: string;
  /** Plain paragraphs; absent from the list, null without one. */
  body?: string | null;
  /** The lowest tier that reads it: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  minTier: number;
  eventAt: Iso | null;
  eventPlace: string | null;
  /** The places answered YES at most; null: no limit. */
  capacity: number | null;
  pollOptions: string[] | null;
  drop: { id: string; title: string; state: DropState } | null;
  model: { id: string; name: string; type: string; lookbook: LookbookState; slug: string | null } | null;
  externalUrl: string | null;
  published: boolean;
  publishedAt: Iso | null;
  createdAt: Iso;
  createdBy: { id: string; email: string } | null;
  photos: CirclePhoto[];
  answers: Record<CircleRsvpAnswer, number>;
  /** A poll's votes by option; null for another kind. */
  results: { counts: number[]; total: number } | null;
}

/** POST /api/admin/circle/posts: a post of `kind`, with the fields of its kind. */
export interface CirclePostInput {
  kind: CirclePostKind;
  title: string;
  body?: string | null;
  minTier?: number;
  eventAt?: Iso | null;
  eventPlace?: string | null;
  capacity?: number | null;
  pollOptions?: string[] | null;
  dropId?: string | null;
  modelId?: string | null;
  externalUrl?: string | null;
}

/** PATCH /api/admin/circle/posts/:id: any field but the kind; null clears an optional one. */
export type CirclePostChange = Partial<Omit<CirclePostInput, 'kind'>>;

/** An answer to an invitation (GET /api/admin/circle/posts/:id/answers): the email masked for an AUDITOR. */
export interface CircleAnswer {
  accountId: string;
  email: string;
  answer: CircleRsvpAnswer;
  createdAt: Iso;
  answeredAt: Iso;
}

/** GET /api/admin/analytics/circle: the members of the club by tier now, the visits of the circle by day. */
export interface CircleStats {
  from: string;
  to: string;
  days: number;
  members: { TITANE: number; PLATINE: number; PALLADIUM: number; total: number };
  visits: { total: number; daily: { day: string; visits: number }[] };
}

// ── The Club: the private salon's requests (P-X08) ─────────────────────────

/** A request of the private salon (P-X08; GET /api/admin/club/requests): the client's email masked for an AUDITOR. */
export interface ShopRequest {
  id: string;
  status: ShopRequestStatus;
  createdAt: Iso;
  /** The client's words; null without a note. */
  note: string | null;
  account: { id: string; email: string };
  model: { id: string; name: string; type: string; slug: string | null; priceLabel: string | null };
  handledBy: { id: string; email: string } | null;
  handledAt: Iso | null;
  /** What was done; null while open, or closed with a lock of the account. */
  resolutionNote: string | null;
  /** ACCEPTED (an order was created) or DECLINED once closed; null while open, or closed before the orders. */
  outcome: ShopRequestOutcome | null;
}

// ── The Club: the tiers (P-X04) ────────────────────────────────────────────

/** One tier of GET /api/admin/club/tiers (and PATCH /api/admin/club/tiers/:tier). */
export interface ClubTierSheet {
  tier: ClubTierName;
  level: 1 | 2 | 3;
  /** The pieces held now it starts from: a constant of the code. */
  pieces: number;
  /** Its words now, one benefit per line: the console's, or the default ones. */
  benefits: string;
  defaultBenefits: string;
  /** The console changed its words. */
  edited: boolean;
  updatedAt: Iso | null;
}

// ── Orders (plan LIVE RELEASE+, routes/admin/orders.ts) ───────────────────

/** Why an order stands out (M3): RESERVED too long, READY but not shipped, SHIPPED not delivered, DELIVERED not registered. */
export const ORDER_LATE_RULES = ['RESERVED', 'READY', 'SHIPPED', 'UNREGISTERED'] as const;
export type OrderLateRule = (typeof ORDER_LATE_RULES)[number];

/** The currencies an order is priced in (services/orders.ts ORDER_CURRENCIES). */
export const ORDER_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'] as const;
export type OrderCurrency = (typeof ORDER_CURRENCIES)[number];

/** An order's time in its step and whether it is late (services/fulfilment.ts orderTiming). */
export interface OrderTiming {
  since: Iso;
  dueAt: Iso | null;
  rule: OrderLateRule | null;
  late: boolean;
}

/** An order on the board (GET /api/admin/orders): the email masked for an AUDITOR. */
export interface OrderCard {
  id: string;
  /** OR- and the first eight figures of its id. */
  reference: string;
  /** A LIVE reservation's LR- reference, as the collector holds it; null for the other channels. */
  sourceReference: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  release: { id: string; title: string } | null;
  account: { id: string; email: string };
  model: { id: string; name: string };
  sizeLabel: string | null;
  skuCode: string | null;
  addons: { label: string }[];
  surprise: string | null;
  engraving: boolean;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
  bench: { status: BenchItemStatus } | null;
  piece: string | null;
  shipment: { carrier: string; trackingNumber: string } | null;
  timing: OrderTiming;
}

export interface OrderBoardColumn {
  status: OrderStatus;
  total: number;
  late: number;
  items: OrderCard[];
}

/** The delays after which an order stands out (M3), in days. */
export interface OrderAlertDelays {
  reservedDays: number;
  readyDays: number;
  shippedDays: number;
  unregisteredDays: number;
}

export interface OrderAlertSettings extends OrderAlertDelays {
  updatedAt: Iso | null;
  updatedBy: { id: string; email: string } | null;
}

export interface OrderBoard {
  now: Iso;
  delays: OrderAlertSettings;
  columns: OrderBoardColumn[];
  releases: { id: string; title: string }[];
  locations: { id: string; name: string }[];
}

/** The board's filters (its query). */
export interface OrderBoardFilters {
  channel?: OrderChannel;
  dropId?: string;
  locationId?: string;
  late?: boolean;
  q?: string;
}

/** An order as its page reads it (the buyer masked for an AUDITOR: `J*** D***`, the address `***`). */
export interface OrderView {
  id: string;
  reference: string;
  channel: OrderChannel;
  source: { liveEntryId: string | null; piece: number; dropEntryId: string | null; shopRequestId: string | null };
  release: { id: string; title: string } | null;
  accountId: string;
  model: { id: string; name: string };
  sizeLabel: string | null;
  skuId: string | null;
  priceMinor: number | null;
  currency: OrderCurrency | null;
  addons: { id: string; label: string; priceMinor: number }[];
  surprise: string | null;
  engravingText: string | null;
  buyer: { name: string | null; address: string | null };
  status: OrderStatus;
  reservedAt: Iso;
  paidAt: Iso | null;
  shippedAt: Iso | null;
  deliveredAt: Iso | null;
  cancelledAt: Iso | null;
  returnedAt: Iso | null;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
  bench: { id: string; status: BenchItemStatus; productId: string } | null;
  shipment: { carrier: { id: string; name: string }; trackingNumber: string; trackingUrl: string; declaredValueMinor: number | null } | null;
  productId: string | null;
  shopifyOrderId: string | null;
  /** Its return (RETURNED): where the piece went, the note, whether ORBES took its buyer's ownership back. */
  return: { outcome: ReturnOutcome; location: { id: string; name: string } | null; note: string; at: Iso; ownershipReclaimed: boolean } | null;
  /** Its invoice and credit note, in order of issue. */
  invoices: OrderDocument[];
  events: { action: string; status: OrderStatus; note: string | null; at: Iso; actor: { type: string; id: string | null } }[];
}

/** An invoice or a credit note of an order, as its page lists it. */
export interface OrderDocument {
  id: string;
  kind: InvoiceKind;
  number: string;
  issuedAt: Iso;
  currency: OrderCurrency;
  totalMinor: number;
}

/** GET /api/admin/orders/:id: the order, its collector, its timing, its piece, who changed it. */
export interface OrderDetail {
  order: OrderView;
  sourceReference: string | null;
  account: { id: string; email: string };
  timing: OrderTiming;
  piece: { productId: string; status: ProductStatus; registered: boolean } | null;
  actors: Record<string, string>;
  delays: OrderAlertDelays;
}

/** POST /api/admin/orders/:id/transition. */
export type OrderTransitionInput =
  | { to: 'PAID'; note?: string }
  | { to: 'SHIPPED'; carrierId: string; trackingNumber: string; declaredValueMinor?: number | null; note?: string }
  | { to: 'DELIVERED'; note?: string }
  | { to: 'CANCELLED'; note: string };

/** POST /api/admin/orders/:id/return (choice 20): back to stock at a location, or to the archive, with a note. */
export type OrderReturnInput = { outcome: 'RESTOCKED'; locationId: string; note: string } | { outcome: 'ARCHIVED'; note: string };

/** The order after its return, and the claim code of its piece's new card when ORBES took its buyer's ownership back (shown once). */
export interface OrderReturned extends OrderDetail {
  productId: string;
  claimCode?: string;
}

// ── Invoices (routes/admin/invoices.ts) ───────────────────────────────────

/** An invoice or a credit note (the buyer masked for an AUDITOR). */
export interface Invoice {
  id: string;
  kind: InvoiceKind;
  number: string;
  issuedAt: Iso;
  order: { id: string; reference: string };
  credits: { id: string; number: string } | null;
  creditedBy: { id: string; number: string } | null;
  issuer: { name: string; address: string[] };
  buyer: { name: string | null; address: string | null; email: string | null };
  lines: { kind: 'PIECE' | 'ADDON'; label: string; detail: string | null; amountMinor: number }[];
  currency: OrderCurrency;
  subtotalMinor: number;
  vatRateBp: number | null;
  vatMinor: number | null;
  totalMinor: number;
}

/** GET /api/admin/invoices: a month's documents and their totals per currency. */
export interface InvoiceList {
  month: string;
  /** The month now (UTC, the server's): the latest the page offers. */
  currentMonth: string;
  items: Invoice[];
  totals: { currency: OrderCurrency; invoiced: number; credited: number; net: number }[];
}

/** The Invoices page's filters (its query). */
export interface InvoiceFilters {
  month?: string;
  kind?: InvoiceKind;
  q?: string;
}

/** PATCH /api/admin/orders/:id/terms: only the terms that change. */
export interface OrderTermsChange {
  sizeLabel?: string | null;
  priceMinor?: number | null;
  currency?: OrderCurrency | null;
  engravingText?: string | null;
}

// ── Locations and carriers (routes/admin/logistics.ts) ───────────────────

export interface StockLocation {
  id: string;
  name: string;
  isDefault: boolean;
  shopifyLocationId: string | null;
}

export interface Carrier {
  id: string;
  name: string;
  /** https, with {tracking} where the number goes. */
  trackingUrl: string;
  active: boolean;
}

// ── The atelier (routes/admin/atelier.ts) ─────────────────────────────────

/** What the list of pieces to make shows. */
export const BENCH_VIEWS = ['OPEN', 'DONE', 'CANCELLED', 'ALL'] as const;
export type BenchView = (typeof BENCH_VIEWS)[number];

export interface SkuRef {
  id: string;
  code: string;
  model: { id: string; name: string };
  sizeLabel: string | null;
}

export interface StockLevel {
  onHand: number;
  reserved: number;
  available: number;
}

export interface AtelierStockRow extends StockLevel {
  sku: SkuRef;
  location: { id: string; name: string };
  toMake: number;
  minimum: number | null;
  suggestion: number;
}

export interface AtelierStock {
  rows: AtelierStockRow[];
  skus: SkuRef[];
  locations: { id: string; name: string; isDefault: boolean }[];
}

/** Whom pieces to make are for. */
export type BenchOrigin = { kind: 'RELEASE'; release: { id: string; title: string } } | { kind: 'SALON' } | { kind: 'STOCK' };

export interface BenchItem {
  id: string;
  status: BenchItemStatus;
  createdAt: Iso;
  startedAt: Iso | null;
  doneAt: Iso | null;
  cancelledAt: Iso | null;
  piece: { id: string; reference: string; status: ProductStatus; material: string; signed: boolean };
  order: { id: string; reference: string; status: OrderStatus; channel: OrderChannel } | null;
  origin: BenchOrigin;
  sku: SkuRef;
  location: { id: string; name: string };
  engravingText: string | null;
  surprise: string | null;
  addons: string[];
}

export interface BenchGroup {
  origin: BenchOrigin;
  sku: SkuRef;
  counts: Record<BenchItemStatus, number>;
  items: BenchItem[];
}

export interface BenchList {
  groups: BenchGroup[];
  total: number;
  releases: { id: string; title: string }[];
}

/** The list's filters (its query). */
export interface BenchFilters {
  view?: BenchView;
  /** A release's id, SALON or STOCK. */
  origin?: string;
  skuId?: string;
  locationId?: string;
}

/** A work sheet (POST /api/admin/atelier/sheets, OPERATOR): its code's data to draw at print size. */
export interface WorkSheet {
  benchItemId: string;
  status: BenchItemStatus;
  reference: string;
  code: { codeId: string; data: string; glyphs: number[] };
  model: string;
  sizeLabel: string | null;
  skuCode: string;
  addons: string[];
  engravingText: string | null;
  surprise: string | null;
  release: string | null;
  order: { reference: string; channel: OrderChannel } | null;
  location: string;
  createdAt: Iso;
}

export interface WorkSheets {
  printedAt: Iso;
  sheets: WorkSheet[];
}

/** POST /api/admin/atelier/bench/:id/done: what the atelier says of the finished piece. */
export interface IssueBenchInput {
  material?: string;
  productionBatch?: string;
  productionDate?: string;
  withClaimSecret: boolean;
}

export interface IssuedBenchItem {
  item: BenchItem;
  productId: string;
  codeId: string;
  /** Shown once. */
  claimCode?: string;
}
