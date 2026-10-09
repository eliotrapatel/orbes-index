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

/**
 * RETAIL (A-08): a seller's account, under AUDITOR, that sees the sale mode only. LOGISTICS (plan NEXT LOT §3.5): a person
 * at the logistics agent, ranked with RETAIL, that sees the Logistics page of its own locations only.
 */
export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Roles the Team page gives (create, change role; LOGISTICS with its locations); ADMIN is granted from the shell only. */
export const STAFF_ROLES = ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** YEARLY_CARE (BP-19 T6): opened by the yearly care's flow only; the product page's dialog never offers it. */
export const SERVICE_TYPES = ['INSPECTION', 'CLEANING', 'POLISH', 'RESIZE', 'REPAIR', 'REPLACEMENT', 'AUTHENTICATION', 'YEARLY_CARE'] as const;
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

/** The tiers of the club (P-X04, club_tiers.tier), in order: 1 TITANE, 2 PLATINE, 3 PALLADIUM (1, 5 and 10 pieces held now). */
export const CLUB_TIER_NAMES = ['TITANE', 'PLATINE', 'PALLADIUM'] as const;
export type ClubTierName = (typeof CLUB_TIER_NAMES)[number];

/** A request of the private salon (P-X08, shop_requests.status): OPEN until the console closes it with a note. */
export const SHOP_REQUEST_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ShopRequestStatus = (typeof SHOP_REQUEST_STATUSES)[number];

/** How a request of the private salon was closed (shop_requests.outcome): ACCEPTED, an order follows, or DECLINED. */
export const SHOP_REQUEST_OUTCOMES = ['ACCEPTED', 'DECLINED'] as const;
export type ShopRequestOutcome = (typeof SHOP_REQUEST_OUTCOMES)[number];

/** A conversation of the Messages board (CS-01, client_conversations.status): the client wrote last, answered, or closed. */
export const CLIENT_CONVERSATION_STATUSES = ['TO_ANSWER', 'ANSWERED', 'CLOSED'] as const;
export type ClientConversationStatus = (typeof CLIENT_CONVERSATION_STATUSES)[number];

/** Who wrote a message (client_messages.author): the client, or a member of ORBES Client Services. */
export const CLIENT_MESSAGE_AUTHORS = ['COLLECTOR', 'STAFF'] as const;
export type ClientMessageAuthor = (typeof CLIENT_MESSAGE_AUTHORS)[number];

/** What a client's message concerns (client_messages.context_kind): a piece, an order, a release, a scan, a model. */
export const CLIENT_MESSAGE_CONTEXTS = ['PIECE', 'ORDER', 'RELEASE', 'SCAN', 'MODEL'] as const;
export type ClientMessageContext = (typeof CLIENT_MESSAGE_CONTEXTS)[number];

/** The free shipping a tier gives (club_program_settings.shipping_free_*, BP-19 T2): none, standard or express. */
export const SHIPPING_FREE_LEVELS = ['NONE', 'STANDARD', 'EXPRESS'] as const;
export type ShippingFreeLevel = (typeof SHIPPING_FREE_LEVELS)[number];

/** How a piece is delivered (shipping_rates.service). */
export const SHIPPING_SERVICES = ['STANDARD', 'EXPRESS'] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];

/** The house's currencies (shipping_rates.currency, club_program_settings.credit_currency). */
export const HOUSE_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'] as const;
export type HouseCurrency = (typeof HOUSE_CURRENCIES)[number];

/** The channels a tier's credit is taken off (club_program_settings.credit_channels). */
export const CREDIT_CHANNELS = ['DRAW', 'LIVE', 'SALON'] as const;
export type CreditChannel = (typeof CREDIT_CHANNELS)[number];

/** Why a credit taken off an order was given back (credit_uses.released_reason, BP-19 T5). */
export const CREDIT_RELEASE_REASONS = ['REMOVED', 'CANCELLED', 'RETURNED'] as const;
export type CreditReleaseReason = (typeof CREDIT_RELEASE_REASONS)[number];

/** The steps of a yearly care (care_requests.status, BP-19 T6). */
export const CARE_REQUEST_STATUSES = ['REQUESTED', 'LABEL_SENT', 'RECEIVED', 'RETURNING', 'DONE', 'CANCELLED'] as const;
export type CareRequestStatus = (typeof CARE_REQUEST_STATUSES)[number];

/** What THE HOUSE'S GUARANTEE covers (house_guarantees.scope, IN-01): a chosen release, the next of a model, of a collection. */
export const GUARANTEE_SCOPES = ['RELEASE', 'MODEL', 'COLLECTION'] as const;
export type GuaranteeScope = (typeof GUARANTEE_SCOPES)[number];

/** A guarantee as stored (house_guarantees.status, IN-01). */
export const GUARANTEE_STATUSES = ['ACTIVE', 'USED', 'EXPIRED', 'REVOKED'] as const;
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number];

/** Which saved size preselects a model's size (models.size_kind, AC-01): a ring, a bracelet, a wrist, a necklace. */
export const SIZE_KINDS = ['RING', 'BRACELET', 'WRIST', 'NECKLACE'] as const;
export type SizeKind = (typeof SIZE_KINDS)[number];

/** A model's size type (models.size_type, plan NEXT LOT §3.3): ring, bracelet, necklace, watch or one size; null: to give. */
export const SIZE_TYPES = ['RING', 'BRACELET', 'NECKLACE', 'WATCH', 'ONE_SIZE'] as const;
export type SizeType = (typeof SIZE_TYPES)[number];

/** A new claim code (claim_code_renewals, plan NEXT LOT §3.4): shown once to staff, sealed for the buyer, or made unseen. */
export const CLAIM_RENEWAL_KINDS = ['STAFF', 'BUYER', 'UNSHOWN'] as const;
export type ClaimRenewalKind = (typeof CLAIM_RENEWAL_KINDS)[number];
export const CLAIM_RENEWAL_STATUSES = ['SHOWN', 'UNSHOWN', 'WAITING', 'READ', 'WITHDRAWN'] as const;
export type ClaimRenewalStatus = (typeof CLAIM_RENEWAL_STATUSES)[number];
export const CLAIM_RENEWAL_WITHDRAWN_REASONS = ['RENEWED_AGAIN', 'ORDER_CANCELLED', 'ORDER_RETURNED', 'REGISTERED', 'UNREADABLE', 'SUPERSEDED'] as const;
export type ClaimRenewalWithdrawnReason = (typeof CLAIM_RENEWAL_WITHDRAWN_REASONS)[number];

/** What an invitation of the circle is (circle_posts.experience, BP-19 T7). */
export const CIRCLE_EXPERIENCES = ['MEMBERS_EVENING', 'LAUNCH_PREVIEW', 'PARTNER_EXPERIENCE'] as const;
export type CircleExperience = (typeof CIRCLE_EXPERIENCES)[number];

/** Where an order comes from (orders.channel): a LIVE RELEASE, a draw, the private salon, a welcome gift (BP-19 T5), a size exchange (plan NEXT LOT §3.5). */
export const ORDER_CHANNELS = ['LIVE', 'DRAW', 'SALON', 'GIFT', 'EXCHANGE'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** The steps of an order (orders.status): RESERVED → PAID → SHIPPED → DELIVERED, or CANCELLED, or RETURNED. */
export const ORDER_STATUSES = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** What an order RESERVED or PAID holds at its location (orders.reservation): a piece in stock, or nothing yet, waiting for supplier stock (Awaiting stock). */
export const ORDER_RESERVATIONS = ['STOCK', 'AWAITING'] as const;
export type OrderReservation = (typeof ORDER_RESERVATIONS)[number];

/** Why the stock moved (stock_movements.reason). */
export const STOCK_MOVEMENT_REASONS = ['PRODUCED', 'ADJUSTED', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHIPPED', 'RETURNED', 'RECEIVED'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** A piece to make at the atelier (bench_items.status). */
export const BENCH_ITEM_STATUSES = ['TO_MAKE', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type BenchItemStatus = (typeof BENCH_ITEM_STATUSES)[number];

/** A parcel's steps (shipments.status, plan NEXT LOT §3.5). */
export const SHIPMENT_STATUSES = ['PACKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'BACK_TO_SENDER', 'LOST', 'DAMAGED', 'CANCELLED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** An order case: a return, a size exchange, a parcel problem (order_cases, plan NEXT LOT §1.1 (b)). */
export const ORDER_CASE_KINDS = ['RETURN', 'EXCHANGE', 'BACK_TO_SENDER', 'LOST', 'DAMAGED'] as const;
export type OrderCaseKind = (typeof ORDER_CASE_KINDS)[number];
export const ORDER_CASE_OPENERS = ['account', 'admin'] as const;
export const ORDER_CASE_REASONS = ['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER'] as const;
export type OrderCaseReason = (typeof ORDER_CASE_REASONS)[number];
export const ORDER_CASE_STATUSES = ['OPEN', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type OrderCaseStatus = (typeof ORDER_CASE_STATUSES)[number];
export const ORDER_CASE_PIECE_STATES = ['OK', 'DAMAGED'] as const;
export const ORDER_CASE_OUTCOMES = ['REFUND', 'EXCHANGE', 'RESHIP'] as const;
export const ORDER_CASE_PIECE_DESTINATIONS = ['RESTOCKED', 'ARCHIVED', 'REVOKED'] as const;

/** Where a returned order's piece goes (returns.outcome). */
export const RETURN_OUTCOMES = ['RESTOCKED', 'ARCHIVED'] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

/** An invoice, or its credit note (invoices.kind). */
export const INVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** What a credit note credits (invoices.credit_scope, plan NEXT LOT §3.6.C): what remains of its invoice, or single lines. */
export const CREDIT_SCOPES = ['FULL', 'LINES'] as const;
export type CreditScope = (typeof CREDIT_SCOPES)[number];

/** Who entered an order's delivery address or engraving (orders.address_by, engraving_by, plan NEXT LOT §3.6.B): the collector or Client Services. */
export const ADDRESS_SOURCES = ['COLLECTOR', 'STAFF'] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/** Who set a profile's date of birth, or saved it last (account_profiles.birth_date_by, updated_by, plan CUSTOMER INTELLIGENCE §3.1): the collector or Client Services. */
export const PROFILE_SOURCES = ['COLLECTOR', 'STAFF'] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

/** A collector's tastes (account_tastes.kind, plan CUSTOMER INTELLIGENCE §3.2): a favourite piece (a type) or finish (a variant's label). */
export const TASTE_KINDS = ['PIECE', 'FINISH'] as const;
export type TasteKind = (typeof TASTE_KINDS)[number];

/** Where a console link leads in the app (links.destination, plan CUSTOMER INTELLIGENCE §3.4 A.6): a release and a model's sheet name theirs. */
export const LINK_DESTINATIONS = ['NOW', 'RELEASES', 'RELEASE', 'COLLECTION', 'MODEL', 'CLUB', 'HOW'] as const;
export type LinkDestination = (typeof LINK_DESTINATIONS)[number];

/** A source of visits (acquisition_sources.kind, plan CUSTOMER INTELLIGENCE §3.4 A.5): BEFORE reads « Before tracking », STAFF « Console device ». */
export const SOURCE_KINDS = ['LINK', 'CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

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

/** How the access rules of a LIVE RELEASE combine (drops.access_combine): every rule met, or any one of them. */
export const ACCESS_COMBINES = ['AND', 'OR'] as const;
export type AccessCombine = (typeof ACCESS_COMBINES)[number];

/** The criteria of a segment (services/segments.ts SEGMENT_CRITERIA), by the four groups of choice 27, in order. */
export const SEGMENT_CRITERIA = {
  RELEASES: ['PARTICIPATIONS', 'TOOK_PART', 'SECURED', 'SECURED_IN'],
  CLUB: ['TIER', 'OWNS_MODEL', 'OWNS_COLLECTION'],
  PROFILE: ['SIZE', 'COUNTRY'],
  SIGNALS: ['INTEREST', 'ANSWER', 'ACTIVE'],
} as const;
export type SegmentCriterionGroup = keyof typeof SEGMENT_CRITERIA;
export const SEGMENT_RULE_KINDS = [...SEGMENT_CRITERIA.RELEASES, ...SEGMENT_CRITERIA.CLUB, ...SEGMENT_CRITERIA.PROFILE, ...SEGMENT_CRITERIA.SIGNALS] as const;
export type SegmentRuleKind = (typeof SEGMENT_RULE_KINDS)[number];
/** A group of a segment matches ALL of its rules, or ANY. */
export const SEGMENT_MATCHES = ['ALL', 'ANY'] as const;
export type SegmentMatch = (typeof SEGMENT_MATCHES)[number];

/** A criterion of a segment; `not`: the collectors it does not match. */
export type SegmentRule = { not?: boolean } & (
  | { kind: 'PARTICIPATIONS'; min: number }
  | { kind: 'TOOK_PART'; dropId: string }
  | { kind: 'SECURED'; min: number }
  | { kind: 'SECURED_IN'; dropId: string }
  | { kind: 'TIER'; tiers: number[] }
  | { kind: 'OWNS_MODEL'; modelIds: string[] }
  | { kind: 'OWNS_COLLECTION'; collectionIds: string[] }
  | { kind: 'SIZE'; sizes: string[] }
  | { kind: 'COUNTRY'; countries: string[] }
  | { kind: 'INTEREST'; dropId: string | null }
  | { kind: 'ANSWER'; dropId: string; answer: number }
  | { kind: 'ACTIVE'; days: number }
);

/** A segment's rule tree: ALL or ANY of its criteria and groups of criteria (one level down). */
export interface SegmentGroup {
  match: SegmentMatch;
  rules: (SegmentRule | SegmentGroup)[];
}

/** A segment (GET /api/admin/segments, /:id): its rule tree, its members now and what uses it. */
export interface Segment {
  id: string;
  name: string;
  criteria: SegmentGroup;
  count: number;
  usedBy: { releases: { id: string; title: string }[]; posts: { id: string; title: string }[] };
  createdAt: Iso;
  createdBy: { id: string; email: string } | null;
  updatedAt: Iso;
}

/** A segment as a release's access rule or a post's audience chooses it (GET /api/admin/segments/names). */
export type SegmentName = Pick<Segment, 'id' | 'name'>;

/** What the builder names (GET /api/admin/segments/options). */
export interface SegmentOptions {
  releases: { id: string; title: string; mode: DropMode; opensAt: Iso; answers: string[] | null }[];
  /** `variant` (NOCTURNE N1): the model's label among its variants, or null. */
  models: { id: string; name: string; type: string; variant?: string | null }[];
  collections: { id: string; name: string }[];
  sizes: string[];
  countries: string[];
}

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
  /** A LOGISTICS login's locations (plan NEXT LOT §3.5.6.1), sorted; empty for every other role. */
  stockLocationIds: string[];
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
  /** N2: its base price in minor units with its currency (both or neither): the Shopify product export's price. */
  basePriceMinor: number | null;
  baseCurrency: string | null;
  /** M6: its care guide, shown in MY PIECES with each order of the model; null: its care instructions stand in. */
  careGuide: string | null;
  /** N2: its Shopify product id once pasted back (null: not linked), the sizes the export gives it, those linked. */
  shopify: { productId: string | null; variants: number; linked: number };
  /** NOCTURNE N1: the main model it is a variant of (its id, name and label), or null. */
  variantOf: { id: string; name: string; label: string | null } | null;
  /** N1: its label among its model's dots (« Steel ») and the dot's colour (#RRGGBB); null for both on a model alone. */
  variantLabel: string | null;
  variantSwatch: string | null;
  /** N1: a main model's variants, in the order they were added; none for a variant, nor for a model alone. */
  variants: ModelVariant[];
  /** Plan NEXT LOT §3.3: its size type (null: to give), and how many of its declared sizes are offered. */
  sizeType: SizeType | null;
  sizesOffered: number;
  createdAt: Iso;
  /**
   * Plan NEXT-NINE, BP-34 (Pairs well with), on a model read alone: the models its sheet ends with, in their order, as
   * picked on its main model (a variant's: its main model's, read only); absent from the list.
   */
  pairs?: ModelPair[];
  /** BP-34: what the sheet shows when no pick is shown, as an owner of the highest tier reads it; empty: nothing. */
  pairsFallback?: { name: string; label: string | null }[];
}

/** Whether a model's sheet shows a pair (BP-34), as the server says it (services/catalog.ts ModelPairRecord). */
export type PairShown = 'EVERYONE' | 'SALON' | 'HIDDEN' | 'DISCONTINUED';
export const PAIR_SHOWN: readonly PairShown[] = Object.freeze(['EVERYONE', 'SALON', 'HIDDEN', 'DISCONTINUED']);

/** A model picked for PAIRS WELL WITH (BP-34): its place, the model, its place in the lookbook, whether it is shown. */
export interface ModelPair {
  position: number;
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  lookbook: LookbookState;
  slug: string | null;
  shown: PairShown;
}

/** NOCTURNE N1: a variant of a model, as its main model's page lists it (VARIANTS). */
export interface ModelVariant {
  id: string;
  name: string;
  label: string | null;
  swatch: string | null;
  skuPrefix: string;
  imageUrl: string | null;
  lookbook: LookbookState;
  slug: string | null;
  active: boolean;
}

/** POST /api/admin/models/:id/variants (N1, ADD A VARIANT): its label, colour and SKU prefix; the main model's own label and colour while it has none. */
export interface VariantInput {
  label: string;
  swatch: string;
  skuPrefix: string;
  mainLabel?: string;
  mainSwatch?: string;
  /** Plan NEXT LOT §3.3 item 6: its size type, when its main model has none yet (required then). */
  sizeType?: SizeType;
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
  /** N2: the base price with its currency, sent together; null for both clears it. */
  basePriceMinor?: number | null;
  baseCurrency?: OrderCurrency | null;
  /** M6: '' clears the care guide. */
  careGuide?: string;
  /** NOCTURNE N1: its label and dot's colour, sent together; null for both clears them (a model alone only). */
  variantLabel?: string | null;
  variantSwatch?: string | null;
}

/** N2: a size of a model as the Shopify product export gives it, and its variant id once pasted back. */
export interface ShopifyVariant {
  /** null: one size. */
  size: string | null;
  sku: string;
  /** Its SKU exists (a model never issued nor sold has none yet: it is made when its id is pasted). */
  known: boolean;
  variantId: string | null;
}

/** GET /api/admin/models/:id/shopify: the model's Shopify product, its handle, its sizes and their ids. */
export interface ShopifyProduct {
  model: { id: string; name: string; skuPrefix: string };
  handle: string;
  productId: string | null;
  variants: ShopifyVariant[];
}

/** PUT /api/admin/models/:id/shopify: the ids pasted back (a number, or the address of its page in Shopify's admin). */
export interface ShopifyLink {
  productId: string | null;
  variants: { size: string | null; variantId: string | null }[];
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
  /** The model's label among its variants (NEXT LOT §3.1: « Steel »), or null for a model without one. */
  modelVariant: string | null;
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
    /** `variant`: the model's label among its variants (NEXT LOT §3.1: « Steel »), or null for a model without one. */
    model: { id: string; name: string; type: string; variant: string | null; skuPrefix: string; care: string | null; imageUrl: string | null };
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
  /** NEW CLAIM CODE (plan NEXT LOT §3.4): what New claim code may do for the piece, and its new claim codes; never a code. */
  claimCode: ClaimCodeSituation;
}

/** Whom a new claim code is made for (services/claim-renewals.ts CLAIM_SITUATIONS). */
export type ClaimSituation = 'IN_STOCK' | 'SOLD' | 'SOLD_IN_STORE';
/** Why New claim code is not offered for a piece. */
export type ClaimRefusal = 'REGISTERED' | 'NO_CLAIM_CODE' | 'NOT_PRINTABLE' | 'NO_ACTIVE_CODE' | 'SOLD_IN_STORE';

/** One new claim code of a piece (`New claim codes`): never its code. */
export interface ClaimRenewalRecord {
  id: string;
  at: Iso;
  /** The staff member's email; null for the system. */
  by: string | null;
  kind: ClaimRenewalKind;
  order: { id: string; reference: string } | null;
  status: ClaimRenewalStatus;
  readAt: Iso | null;
  withdrawnAt: Iso | null;
  withdrawnReason: ClaimRenewalWithdrawnReason | null;
  reason: string | null;
}

/** The product page's `claimCode` (GET /api/admin/products/:productId). */
export interface ClaimCodeSituation {
  renewable: ClaimSituation | null;
  refusal: ClaimRefusal | null;
  /** The piece's open order. */
  order: { id: string; reference: string } | null;
  /** The newest new claim code: the dialog sends it back as `after`. */
  lastRenewalId: string | null;
  /** No card registers the piece: its current code is an UNSHOWN one, made when its order was cancelled. */
  cardNeeded: boolean;
  /** Newest first. */
  renewals: ClaimRenewalRecord[];
}

/** POST /api/admin/products/:productId/claim-code: the code itself only for a piece in stock (shown once). */
export interface ClaimRenewal {
  claimCode?: string;
  renewal: ClaimRenewalRecord;
}

/** The order page's `claimCode` (GET /api/admin/orders/:id): the order's newest new claim code for its buyer. */
export interface OrderClaimCode {
  status: ClaimRenewalStatus;
  madeAt: Iso;
  readAt: Iso | null;
  withdrawnAt: Iso | null;
  withdrawnReason: ClaimRenewalWithdrawnReason | null;
  cardNeeded: boolean;
  cardNeededOrder: { id: string; reference: string } | null;
}

/** The order page's `claimCard`: no card registers the order's piece (its current code UNSHOWN), and the order it was made for. */
export interface OrderClaimCard {
  cardNeeded: boolean;
  cardNeededOrder: { id: string; reference: string } | null;
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
  /** BP-19 T10: the Club block: its grants (a credit and what is left, a gift and where it is), its yearly care of the year. */
  club: OwnerClub;
  pieces: OwnedPiece[];
  transfers: { id: string; productId: string; createdAt: Iso; expiresAt: Iso }[];
  scans: { id: string; reference: string; occurredAt: Iso; eventType: string; state: string; productId: string | null; country: string | null }[];
  /** N4: its orders, the latest first, each with its steps' times and its timing. */
  orders: ClientOrder[];
  /** N4: the releases it took part in, the latest first; `count` of them, `secured` the pieces secured in all. */
  releases: { count: number; secured: number; items: ClientRelease[] };
  /** N4: its answers to the questions after, the latest first. */
  answers: ClientAnswer[];
  /** N4: its I'LL BE THERE, the latest release first. */
  interest: ClientInterest[];
  /** N4: the segments it belongs to now. */
  segments: { id: string; name: string }[];
  /** N4: Client Services' notes on its orders, entries and requests, the latest first. */
  notes: ClientNote[];
  /** CS-01: the client's conversation with ORBES Client Services and its status; null when the client never wrote. */
  messages: { conversationId: string; status: ClientConversationStatus } | null;
  /** IN-01: the house's guarantees granted to the client, the open ones first. */
  guarantees: Guarantee[];
  /** BP-29: the client's lifetime value per currency, by GROWTH's rule; empty when no priced piece is counted. */
  lifetimeValue: LifetimeValue;
  /** CUSTOMER INTELLIGENCE §3.6 C.4.2: what the client gave in YOUR PROFILE; withheld in part for an AUDITOR. */
  profile: ClientProfile;
  /** §3.6 C.4.3: ORBES Client Services' tags on the client, in the order they were added. */
  tags: string[];
  /** §3.6 C.4.3: ORBES Client Services' private notes, the 50 newest, and how many there are. */
  privateNotes: PrivateNotes;
  /** §3.0 (d): the client's email is a console login's: left out of the Collectors page and the export. */
  teamAccount: boolean;
}

/** IN-01: a guarantee's state, computed by the server (never stored). */
export const GUARANTEE_STATES = ['WAITING', 'SET_ASIDE', 'ENTERED', 'USED', 'EXPIRED', 'REVOKED'] as const;
export type GuaranteeState = (typeof GUARANTEE_STATES)[number];

/** IN-01: a guarantee on the client sheet (GET /api/admin/owners/:id `guarantees`). */
export interface Guarantee {
  id: string;
  accountId: string;
  scope: GuaranteeScope;
  /** A model (its label among its variants), a collection, or a release (its title). */
  target: { kind: GuaranteeScope; id: string; name: string; variant: string | null };
  pieces: number;
  /** The last instant it covers a release opening: the end of a day in Paris. */
  validUntil: Iso;
  visible: boolean;
  note: string | null;
  status: GuaranteeStatus;
  state: GuaranteeState;
  /** The release it is set aside for, or was used in. */
  release: { id: string; title: string; mode: DropMode } | null;
  entryId: string | null;
  grantedAt: Iso;
  grantedBy: { id: string; email: string } | null;
  updatedAt: Iso | null;
  updatedBy: { id: string; email: string } | null;
  usedAt: Iso | null;
  closedAt: Iso | null;
  closedReason: 'USED' | 'RELEASE_ENDED' | 'RELEASE_CANCELLED' | 'REVOKED' | null;
  revokeNote: string | null;
}

/** IN-01: POST /api/admin/owners/:id/guarantees. */
export interface GuaranteeInput {
  scope: GuaranteeScope;
  targetId: string;
  pieces: number;
  /** A calendar day, YYYY-MM-DD (Paris). */
  validUntil: string;
  visible: boolean;
  note: string | null;
}

/** IN-01: PATCH /api/admin/guarantees/:id. */
export type GuaranteeChange = Partial<Pick<GuaranteeInput, 'pieces' | 'validUntil' | 'visible' | 'note'>>;

/** IN-01: the answer to a grant: the guarantee, and the release it was set aside for at once (null: it waits). */
export interface GuaranteeGrant {
  guarantee: Guarantee;
  setAsideFor: { id: string; title: string } | null;
}

/** IN-01: a guarantee on a release's page (GET /api/admin/drops/:id/guarantees), the email masked for an AUDITOR. */
export interface ReleaseGuarantee {
  id: string;
  account: { id: string; email: string };
  pieces: number;
  visible: boolean;
  state: GuaranteeState;
  entry: { id: string; status: string } | null;
  validUntil: Iso;
  grantedAt: Iso;
}

/** IN-01: the Grant dialog's defaults (Orders → Settings, House guarantee). */
export interface GuaranteeSettings {
  validDays: number;
  pieces: number;
  visible: boolean;
  /** Today in Paris plus `validDays`: the dialog's starting date. */
  defaultValidUntil: string;
  updatedAt: Iso | null;
  updatedBy: { id: string; email: string } | null;
}

/** N4: an order on the client sheet: the board's card (without the collector) and the time it reached each step. */
export interface ClientOrder extends Omit<OrderCard, 'account'> {
  priceMinor: number | null;
  currency: string | null;
  steps: { reservedAt: Iso; paidAt: Iso | null; shippedAt: Iso | null; deliveredAt: Iso | null; cancelledAt: Iso | null; returnedAt: Iso | null };
}

/** N4: a release taken part in, and the pieces secured there (its after-room's included; 0: took part). */
export interface ClientRelease {
  id: string;
  kind: 'LIVE' | 'DRAW';
  title: string;
  opensAt: Iso;
  secured: number;
}

/** N4: an answer to a release's question after: its position (from 1) and its words. */
export interface ClientAnswer {
  dropId: string;
  title: string;
  question: string;
  answer: number;
  answerText: string | null;
  answeredAt: Iso;
}

/** N4: an I'LL BE THERE, and what became of it. */
export interface ClientInterest {
  dropId: string;
  title: string;
  size: string;
  since: Iso;
  opensAt: Iso;
  outcome: 'UPCOMING' | 'CAME' | 'DID_NOT_COME' | 'CANCELLED';
}

/** N4: a note of Client Services: what it is about, its words, who wrote it. */
export interface ClientNote {
  at: Iso;
  about: 'ORDER' | 'DRAW' | 'SALON' | 'LIVE';
  /** The order's OR- reference, the release's title, the model's name. */
  subject: string;
  orderId: string | null;
  text: string;
  by: string | null;
}

/** CUSTOMER INTELLIGENCE §3.0 (h): what the role does not read of the client's Profile (an AUDITOR: all five). */
export type ClientProfileWithheld = 'birthDate' | 'phone' | 'city' | 'address' | 'instagram';
/** The age bands staff read (src/shared/profile-rules.ts AGE_BANDS). */
export type ClientAgeBand = 'under18' | '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65plus';
/** A favourite piece or finish; one the collection no longer offers is `retired`. */
export interface ClientTaste {
  key: string;
  label: string;
  swatch?: string;
  retired: boolean;
}

/**
 * The client sheet's Profile (GET /api/admin/owners/:id `profile`, and the answer of PUT …/profile, …/birth-date and
 * …/default-address; services/profiles.ts StaffProfileView). For an AUDITOR the date of birth, the age, the phone, the
 * city, the Instagram and the address are null and named in `withheld`; the age band is given to every role.
 */
export interface ClientProfile {
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  /** 'YYYY-MM-DD'. */
  birthDate: string | null;
  ageBand: ClientAgeBand | null;
  age: number | null;
  birthDateBy: 'COLLECTOR' | 'STAFF' | null;
  birthDateAt: Iso | null;
  /** The client's one entry, kept after Client Services removed the date. */
  birthDateCollectorAt: Iso | null;
  /** The country picked for its code, and the number in E.164. */
  phone: { country: string; number: string } | null;
  city: string | null;
  instagram: string | null;
  heard: { optionId: string; label: string; other: string | null; setAside: boolean; at: Iso } | null;
  tastes: { pieces: ClientTaste[]; finishes: ClientTaste[] };
  /** The default address of YOUR ADDRESSES: its name, its lines as typed, its country and phone. */
  address: { name: string; lines: string; country: string; phone: string } | null;
  /** The saved addresses besides the default. */
  otherAddresses: number;
  completion: { percent: number; missing: ('NAME' | 'COUNTRY' | 'BIRTH_DATE' | 'CITY' | 'ADDRESS' | 'PHONE' | 'INSTAGRAM' | 'PIECES' | 'FINISHES' | 'HEARD')[] };
  /** Sent back with each edit: 409 PROFILE_CHANGED when the client saved in between. */
  version: number;
  updatedBy: 'COLLECTOR' | 'STAFF' | null;
  updatedAt: Iso | null;
  withheld: ClientProfileWithheld[];
  teamAccount: boolean;
}

/** PUT /api/admin/owners/:id/profile: the profile without the date of birth, with the `version` read. */
export interface ClientProfileInput {
  version: number;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  city: string | null;
  phone: { country: string; number: string } | null;
  instagram: string | null;
  heard: { optionId: string; other?: string | null } | null;
  tastes: { pieces: string[]; finishes: string[] };
}

/**
 * GET /api/admin/owners/:id/profile: what Edit the profile opens on (plan CUSTOMER INTELLIGENCE §3.6 C.4.2): the Profile
 * and the choices offered now (services/profiles.ts `options`): the collection's pieces and finishes, the answers offered.
 */
export interface ClientProfileEdit {
  profile: ClientProfile;
  options: {
    pieces: { key: string; label: string }[];
    finishes: { key: string; label: string; swatch: string }[];
    heard: { id: string; label: string; other: boolean }[];
  };
}

/** A private note of ORBES Client Services on the client sheet (services/client-notes.ts). */
export interface PrivateNote {
  id: string;
  text: string;
  at: Iso;
  /** The writer's console email; null for a script. */
  by: string | null;
  /** The writer's console id: its writer or an ADMIN removes it. */
  byId: string | null;
}

/** The private notes not removed, the newest first, and how many there are. */
export interface PrivateNotes {
  items: PrivateNote[];
  total: number;
}

/** GET /api/admin/tags: a tag in use and how many clients carry it (the three starting examples with 0 while none is). */
export interface TagSuggestion {
  tag: string;
  accounts: number;
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
  /** `variant` (NOCTURNE N1): the model's label among its variants, or null. */
  model: { id: string; name: string; type: string; active: boolean; variant: string | null };
  quantity: number;
  opensAt: Iso;
  closesAt: Iso;
  /** How long a place drawn is held, in hours (1 to 336). */
  purchaseWindowHours: number;
  /** P-X02: PALLADIUM's early access before the opening, in hours (0, none, to 336). */
  earlyAccessHours: number;
  /** BP-19 T3: PLATINE's, never more than PALLADIUM's. */
  earlyAccessPlatineHours: number;
  /** NOCTURNE (addition 5): its price in minor units with its currency, or null for both (none): its orders take it. */
  priceMinor: number | null;
  currency: string | null;
  /** When PALLADIUM may reserve a place directly (from the publication at the earliest); null without an early access. */
  earlyAccessOpensAt: Iso | null;
  /** BP-19 T3: when PLATINE may; null without one for PLATINE. */
  earlyAccessPlatineOpensAt: Iso | null;
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
  /** P-X02: of the entries SELECTED or CONFIRMED, those reserved directly during the early access (the guaranteed apart). */
  reserved: number;
  /** IN-01: the house's guarantees set aside for the release or used in it. */
  guaranteed: { places: number; pieces: number };
  /** IN-01: the pieces of the places held or sold. */
  heldPieces: number;
  /** IN-01: the entries waiting for the draw with the house's guarantee: selected first, for their pieces. */
  guaranteedEntered: { places: number; pieces: number };
  /** Plan NEXT LOT §3.6.F: its sizes with their counts, in order; [] for a draw without sizes (one published before). */
  sizes: DrawSize[];
}

/** A draw's size as the console reads it (plan NEXT LOT §3.6.F): its pieces, then its entries counted. */
export interface DrawSize {
  id: string;
  label: string;
  pieces: number;
  /** The pieces reserved directly in it, held or sold. */
  reserved: number;
  /** Its entries waiting for the draw. */
  entered: number;
  /** The pieces held or sold in it. */
  held: number;
  /** Its waiting list. */
  waitlisted: number;
  /** IN-01: the pieces of its guaranteed entries waiting. */
  guaranteedEntered: number;
}

/** A draw's size and its pieces as the console sends them (plan NEXT LOT §3.6.F): 0 leaves it out. */
export interface DrawSizeInput {
  label: string;
  pieces: number;
}

/** POST /api/admin/drops; any field of PATCH /api/admin/drops/:id while a DRAFT (the description only once published). */
export interface DropInput {
  modelId: string;
  title: string;
  description?: string | null;
  /** Plan NEXT LOT §3.6.F: its sizes and their pieces; its quantity is their sum (a quantity is no longer sent). */
  sizes: DrawSizeInput[];
  opensAt: Iso;
  closesAt: Iso;
  purchaseWindowHours?: number;
  /** P-X02: PALLADIUM's hours of early access (THE PROGRAM's when omitted, 0 for none). */
  earlyAccessHours?: number;
  /** BP-19 T3: PLATINE's hours, never more than PALLADIUM's (THE PROGRAM's when omitted). */
  earlyAccessPlatineHours?: number;
  /** NOCTURNE (addition 5): its price in minor units with its currency, together; null for both: none. */
  priceMinor?: number | null;
  currency?: OrderCurrency | null;
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
  /** IN-01: the entry uses the house's guarantee (GUARANTEED: no rank, no tier). */
  guaranteed: boolean;
  /** IN-01: the pieces of its place. */
  pieces: number;
  /** Plan NEXT LOT §3.6.F: its size; null in a draw without sizes. */
  size: { id: string; label: string } | null;
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
  /** IN-01: the guaranteed places selected first, and their pieces. */
  guaranteed: number;
  guaranteedPieces: number;
  /** Plan NEXT LOT §3.6.F: per size, the places drawn, the entries selected and waitlisted; [] for a draw without sizes. */
  sizes: { id: string; label: string; places: number; selected: number; waitlisted: number }[];
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
  /** Who may enter: models, collection, releases taken part in, a segment, how they combine, and the rule as the public reads it. */
  access: {
    models: { id: string; name: string }[];
    collection: { id: string; name: string } | null;
    minParticipations: number | null;
    segment: { id: string; name: string } | null;
    combine: AccessCombine;
    text: string;
  };
  /** A surprise in every box: on or off, its description (internal). */
  surprise: { enabled: boolean; text: string | null };
  /** Where its orders hold or make their pieces (plan LIVE RELEASE+, choice 16): as set (null: the default), and the one it means. */
  locationId: string | null;
  location: { id: string; name: string } | null;
  /** The question after (choice 11), its answers counted; null for an after-room. */
  question: LiveQuestion | null;
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
  /** Its after-room, set or opened (plan LIVE RELEASE+, choice 2); null without one, and for an after-room. */
  afterRoom: LiveAfterRoom | null;
  /** An after-room's own page: the release it follows; null for a release. */
  afterRoomOf: { id: string; title: string } | null;
  /** IN-01: the house's guarantees set aside for the release or used in it. */
  guaranteed: { places: number; pieces: number };
}

/** Where the question after stands: never asked (OFF), until the release's end (WAITING), the week after it (OPEN), CLOSED. */
export const LIVE_QUESTION_STATES = ['OFF', 'WAITING', 'OPEN', 'CLOSED'] as const;
export type LiveQuestionState = (typeof LIVE_QUESTION_STATES)[number];

/** The question after a release in the console (services/question.ts AdminQuestion). */
export interface LiveQuestion {
  text: string;
  answers: string[];
  /** Rewritten for the release (false: the default question). */
  custom: boolean;
  enabled: boolean;
  state: LiveQuestionState;
  opensAt: Iso | null;
  closesAt: Iso | null;
  /** Asked on the end page (took part, no piece) and in MY PIECES (I'LL BE THERE, never came). */
  asked: { tookPart: number; interest: number };
  answered: number;
  tally: { answer: number; label: string; count: number }[];
}

/** A size against the stock (GET /api/admin/live/:id/feasibility, services/release-stock.ts). */
export interface LiveFeasibilityLine {
  sizeId: string;
  label: string;
  onSale: number;
  available: number;
  fromStock: number;
  short: number;
  /** Its SKU and supplier (plan NEXT LOT §3.5.4.3), for Add to supplier order. */
  skuId?: string | null;
  /** Its SKU in words, the variant included: MONOLITHE · BLUE · 52. */
  skuWords?: string | null;
  supplier?: { id: string; name: string } | null;
  /** Already ordered for its SKU to the location: still expected on supplier orders on their way, and held by a draft. */
  ordered?: { expected: number; inDraft: number } | null;
}

/** The feasibility check before publishing (plan LIVE RELEASE+, choice 12): warnings, never a refusal. */
export interface LiveFeasibility {
  location: { id: string; name: string } | null;
  sizes: LiveFeasibilityLine[];
  afterRoom: LiveFeasibilityLine[] | null;
  short: number;
  warnings: string[];
  reasoning: string[];
}

/** The size mix a new release is proposed (GET /api/admin/live/size-mix, choice 13). */
export interface LiveSizeMix {
  model: { id: string; name: string };
  location: { id: string; name: string };
  sizes: { label: string; stock: number; fromStock: number; fromDemand: number }[];
  quantity: number;
  inStock: number;
  planned: number | null;
  reasoning: string[];
  /** Plan NEXT LOT §3.3: the model's offered sizes (empty for a model with no size type). */
  offered: string[];
}

/** An hour of the day, Paris time, in the best time to open. */
export interface BestTimeHour {
  hour: number;
  signIns: number;
  scans: number;
  activity: number;
  byTier: number[];
  past: { releases: number; present: number };
}

/** The best time to open (GET /api/admin/live/:id/best-time, /api/admin/analytics/best-time; choice 10). */
export interface BestTime {
  days: number;
  from: Iso;
  to: Iso;
  minTier: number;
  country: string | null;
  hours: BestTimeHour[];
  countries: { country: string; activity: number; peakHour: number }[];
  total: number;
  suggested: { hour: number; activity: number; share: number } | null;
  release: { hour: number; activity: number; share: number } | null;
  pastReleases: number;
  reasoning: string[];
}

/** Where an after-room stands: waiting for the sell-out, opening at its time, open, over, or never opened. */
export const AFTER_ROOM_STATES = ['WAITING', 'OPENS', 'OPEN', 'OVER', 'NOT_OPENED'] as const;
export type AfterRoomState = (typeof AFTER_ROOM_STATES)[number];

/** Why an after-room never opened: nobody left in the line at the sell-out, no sell-out, its release cancelled. */
export type AfterRoomSkip = 'NO_GUESTS' | 'NOT_SOLD_OUT' | 'CANCELLED';

/** A release's after-room in the console (services/live-console.ts AdminAfterRoom). */
export interface LiveAfterRoom {
  id: string;
  model: { id: string; name: string; type: string; active: boolean };
  priceMinor: number;
  currency: string;
  sizes: { id: string; label: string; stock: number }[];
  quantity: number;
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  delayMinutes: number;
  lengthMinutes: number;
  state: AfterRoomState;
  phase: LivePhase;
  opensAt: Iso | null;
  closesAt: Iso | null;
  endedReason: LiveEndReason | null;
  skipped: AfterRoomSkip | null;
  guests: number;
  entries: Record<LiveEntryStatus, number>;
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
  minParticipations?: number | null;
  accessSegmentId?: string | null;
  accessCombine?: AccessCombine;
  surpriseEnabled?: boolean;
  surpriseText?: string | null;
  sizes: { id?: string | null; label: string; stock: number }[];
  quantityLine?: string | null;
  addons?: { id?: string | null; label: string; line?: string | null; priceMinor: number }[];
  announceAt?: Iso | null;
  silhouetteAt?: Iso | null;
  nameAt?: Iso | null;
  photoAt?: Iso | null;
  tierWindows?: { tier: number; turnSeconds?: number | null; payMinutes?: number | null }[];
  /** The after-room: its own model, price, sizes and stock, add-ons, delay and length; null: none. */
  afterRoom?: LiveAfterRoomSettings | null;
  /** Where its orders hold or make their pieces; null: the default location. */
  stockLocationId?: string | null;
  /** The question after: on by default; its words and answers (both, or null for the default question). */
  questionEnabled?: boolean;
  questionText?: string | null;
  questionAnswers?: string[] | null;
}

/** An after-room's own settings (the rest is its release's). */
export interface LiveAfterRoomSettings {
  modelId: string;
  priceMinor: number;
  sizes: { id?: string | null; label: string; stock: number }[];
  addons?: { id?: string | null; label: string; line?: string | null; priceMinor: number }[];
  delayMinutes?: number;
  lengthMinutes?: number;
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
  /** IN-01: the entry uses the house's guarantee: first in line in its size. */
  guaranteed: boolean;
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
  /** An invitation's experience of the tier program (BP-19 T7): its tier is then THE PROGRAM's; null otherwise. */
  experience: CircleExperience | null;
  eventAt: Iso | null;
  eventPlace: string | null;
  /** The places answered YES at most; null: no limit. */
  capacity: number | null;
  pollOptions: string[] | null;
  drop: { id: string; title: string; state: DropState } | null;
  model: { id: string; name: string; type: string; lookbook: LookbookState; slug: string | null } | null;
  externalUrl: string | null;
  /** Read by this segment's members only (among its tiers); null: by its tiers. */
  segment: { id: string; name: string } | null;
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
  segmentId?: string | null;
  /** An invitation's experience (BP-19 T7); its tier then THE PROGRAM's. */
  experience?: CircleExperience | null;
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
  /** AC-01: the size the client asked; null: not given (not sure yet, or one size). */
  size: string | null;
  account: { id: string; email: string };
  model: { id: string; name: string; type: string; slug: string | null; priceLabel: string | null };
  handledBy: { id: string; email: string } | null;
  handledAt: Iso | null;
  /** What was done; null while open, or closed with a lock of the account. */
  resolutionNote: string | null;
  /** ACCEPTED (an order was created) or DECLINED once closed; null while open, or closed before the orders. */
  outcome: ShopRequestOutcome | null;
}

// ── A model's Sizes (plan NEXT-NINE, AC-01; plan NEXT LOT §3.3) ────────────

/**
 * A declared size of a model (its SKU) and the measures it fits, in whole millimetres of its size kind (null: its label
 * is read); where it stands (plan NEXT LOT §3.3).
 */
export interface ModelSizeRow {
  skuId: string;
  /** null: ONE SIZE. */
  label: string | null;
  code: string;
  fitMinMm: number | null;
  fitMaxMm: number | null;
  /** When it was set aside; null: offered. */
  setAsideAt: Iso | null;
  /** Its label reads as a size of its type's list (ONE SIZE for a watch or a model of one size); true without a type. */
  onList: boolean;
  /** The list's label another declared size reads as too, when this one's label is not the list's own; else null. */
  sameAs: string | null;
  /** Something uses it: removing it sets it aside. */
  used: boolean;
  /** The orders waiting for supplier stock in this size (from H2); 0 before. */
  awaiting: number;
}

/** GET /api/admin/models/:id/sizes: its size type and kind, what a variant without either reads, its type's list, its declared sizes. */
export interface ModelSizes {
  modelId: string;
  sizeType: SizeType | null;
  sizeKind: SizeKind | null;
  inherited: { sizeKind: SizeKind; from: string } | null;
  /** Its type's sizes to tick; empty without a type, and for a watch or a model of one size. */
  list: string[];
  sizes: ModelSizeRow[];
  offered: number;
  setAside: number;
  /** Its supplier, a variant's main model's when it has none, and its sizes' own (plan NEXT LOT §3.5.4.5). */
  supplier: ModelSupplier;
}

// ── SUPPLIERS (plan NEXT LOT §3.5.6.2) ─────────────────────────────────────

/** Migration 0036 (plan NEXT LOT §3.5): a supplier order's steps, a reception's, a card's erasure, a return to a supplier, a proposed count. */
export const SUPPLIER_ORDER_STATUSES = ['DRAFT', 'SENT', 'EXPECTED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];
export const RECEPTION_STATUSES = ['TO_CONFIRM', 'SENT_BACK', 'CONFIRMED'] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];
export const CARD_ERASED_REASONS = ['ATTACHED', 'REPLACED', 'REGISTERED', 'UNREADABLE'] as const;
export type CardErasedReason = (typeof CARD_ERASED_REASONS)[number];
export const SUPPLIER_RETURN_STATUSES = ['TO_RETURN', 'RETURNED'] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];
export const SUPPLIER_RETURN_SETTLEMENTS = ['REPLACEMENT', 'CREDIT'] as const;
export type SupplierReturnSettlement = (typeof SUPPLIER_RETURN_SETTLEMENTS)[number];
export const STOCK_CORRECTION_STATUSES = ['TO_APPROVE', 'APPROVED', 'DECLINED'] as const;
export type StockCorrectionStatus = (typeof STOCK_CORRECTION_STATUSES)[number];

/** A supplier named on a model's page. */
export interface SupplierRef {
  id: string;
  name: string;
  active: boolean;
}

/** A model's supplier: its own, or a variant's main model's; and each size's own, by SKU id (absent: the model's). */
export interface ModelSupplier {
  own: SupplierRef | null;
  inherited: (SupplierRef & { from: string }) | null;
  sizes: Record<string, SupplierRef>;
}

/** GET /api/admin/suppliers: a supplier, with how many models name it. */
export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string | null;
  note: string | null;
  active: boolean;
  models: number;
  createdAt: Iso;
}

/** POST /api/admin/suppliers and PATCH …/:id: the fields given (null or '' clears an optional one). */
export interface SupplierInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  currency?: string | null;
  note?: string | null;
  active?: boolean;
}

/** PUT /api/admin/models/:id/supplier: the model's supplier (null: none) and its sizes' own by SKU id (null: the model's). */
export interface ModelSupplierChange {
  supplierId?: string | null;
  sizes?: Record<string, string | null>;
}

/** A supplier order's line (ORBES's page; prices in the order's currency, in hundredths). */
export interface SupplierOrderLine {
  id: string;
  sku: LogisticsSku;
  quantity: number;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  received: number;
  rejected: number;
  credited: number;
  restCancelled: number;
  expected: number;
  /** For a draft's line: what the sent orders of this size to this location still owe. */
  expectedElsewhere: number;
}

/** GET /api/admin/supplier-orders/:id: a supplier order as ORBES's page reads it. */
export interface SupplierOrderDetail {
  id: string;
  reference: string;
  status: SupplierOrderStatus;
  supplier: { id: string; name: string; active: boolean; currency: string | null };
  location: { id: string; name: string; address: string | null };
  currency: string | null;
  shippingMinor: number | null;
  /** YYYY-MM-DD. */
  expectedOn: string | null;
  note: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  sentAt: Iso | null;
  supplierConfirmedAt: Iso | null;
  receivedAt: Iso | null;
  restCancelled: { at: Iso; note: string } | null;
  invoice: { number: string; amountMinor: number; date: string; paidAt: Iso | null } | null;
  lines: SupplierOrderLine[];
  /** The confirmed reception lines with no order line (« Not on the order »). */
  extras: { sku: LogisticsSku; received: number; rejected: number; notes: string[] }[];
  receptions: { id: string; status: ReceptionStatus; countedAt: Iso; accepted: number; rejected: number; confirmedAt: Iso | null; confirmedBy: string | null }[];
  returns: { id: string; sku: LogisticsSku; quantity: number; status: SupplierReturnStatus; returnedAt: Iso | null; settlement: SupplierReturnSettlement | null; creditMinor: number | null; settledAt: Iso | null; note: string | null }[];
  pieces: { ordered: number; received: number; expected: number };
  linesTotalMinor: number | null;
  totalMinor: number | null;
  history: { action: string; at: Iso; by: string | null }[];
}

/** GET /api/admin/supplier-orders: a supplier order in the list. */
export interface SupplierOrderListItem {
  id: string;
  reference: string;
  status: SupplierOrderStatus;
  supplier: { id: string; name: string };
  location: { id: string; name: string };
  pieces: { ordered: number; received: number };
  currency: string | null;
  totalMinor: number | null;
  expectedOn: string | null;
  invoice: { number: string; paid: boolean } | null;
  createdAt: Iso;
}

/** GET /api/admin/supplier-orders/proposal: what is missing, per supplier and location (« The console proposes »). */
export interface SupplierOrderProposal {
  groups: {
    supplier: { id: string; name: string } | null;
    location: { id: string; name: string };
    draft: { id: string; reference: string } | null;
    rows: { sku: LogisticsSku; waiting: number; underMinimum: number; expected: number; inDraft: number; toOrder: number }[];
    toOrder: number;
  }[];
  toOrder: number;
}

/** PATCH /api/admin/supplier-orders/:id: a draft's lines (the list becomes its lines), currency, shipping, expected date, note. */
export interface SupplierDraftChange {
  lines?: { skuId: string; quantity: number; unitPriceMinor?: number | null }[];
  currency?: string | null;
  shippingMinor?: number | null;
  expectedOn?: string | null;
  note?: string | null;
}

/** PUT /api/admin/models/:id/sizes: its size type, the sizes ticked, its kind (a model with no type; null: none), its sizes' fits. */
export interface ModelSizesChange {
  sizeType?: SizeType;
  ticked?: string[];
  sizeKind?: SizeKind | null;
  fits?: { skuId: string; fitMinMm: number | null; fitMaxMm: number | null }[];
}

/** POST /api/admin/models/:id/sizes/:skuId/remove: removed (its SKU deleted) or set aside, and the section. */
export interface ModelSizeRemoved {
  outcome: 'REMOVED' | 'SET_ASIDE';
  sizes: ModelSizes;
}

// ── MESSAGES (plan NEXT-NINE, CS-01) ───────────────────────────────────────

/** What a client's message concerns, with the ids its link needs (GET /api/admin/messages, …/:id). */
export interface MessageConcerns {
  kind: ClientMessageContext;
  /** The label the server wrote when the client sent it, in capitals: `MONOLITHE · O26-J-00184`. */
  label: string;
  productId: string | null;
  orderId: string | null;
  dropId: string | null;
  dropMode: 'DRAW' | 'LIVE' | null;
  modelId: string | null;
  shopRequestId: string | null;
  /** The scan while the scan retention keeps it; null once cleared (the REF stays). */
  scanEventId: string | null;
  scanRef: string | null;
}

/** A row of the Messages board: the client's email masked for an AUDITOR. */
export interface ConversationRow {
  id: string;
  account: { id: string; email: string };
  tier: { level: 0 | 1 | 2 | 3; name: ClubTierName | null };
  /** PALLADIUM or PLATINE, the tier read now; null below the priority tier. */
  priority: ClubTierName | null;
  concerns: MessageConcerns | null;
  moreConcerns: number;
  lastMessage: { author: ClientMessageAuthor; excerpt: string; at: Iso };
  waitingSince: Iso | null;
  status: ClientConversationStatus;
  answeredBy: { id: string; email: string } | null;
  /** The client's open yearly care (BP-19 T6): `Yearly care · O26-J-00184`, a link to its page; null without one. */
  care: { id: string; serial: string } | null;
}

/** GET /api/admin/messages: a page of the board and the count To answer. */
export interface ConversationPage extends Paged<ConversationRow> {
  toAnswer: number;
}

/** A message of a conversation, its author named for the console. */
export interface ConversationMessage {
  id: string;
  author: ClientMessageAuthor;
  admin: { id: string; email: string } | null;
  body: string;
  at: Iso;
  concerns: MessageConcerns | null;
}

/** GET /api/admin/messages/:id. */
export interface Conversation extends Omit<ConversationRow, 'concerns' | 'moreConcerns' | 'lastMessage'> {
  createdAt: Iso;
  closedAt: Iso | null;
  closedBy: { id: string; email: string } | null;
  messages: ConversationMessage[];
}

/** GET /api/admin/messages/summary: the sidebar's badge. */
export interface MessagesSummary {
  toAnswer: number;
  priority: number;
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

/** THE PROGRAM (plan NEXT-NINE, BP-19 T2; GET and PUT /api/admin/club/program). */
export interface ClubProgram {
  earlyAccessPalladiumHours: number;
  earlyAccessPlatineHours: number;
  shippingFreePlatine: ShippingFreeLevel;
  shippingFreePalladium: ShippingFreeLevel;
  carePiecesPlatine: number;
  /** null: every piece. */
  carePiecesPalladium: number | null;
  /** 0: off. */
  messagesPriorityMinTier: 0 | 2 | 3;
  giftPlatineModelId: string | null;
  giftPalladiumModelId: string | null;
  creditPlatineMinor: number;
  creditPalladiumMinor: number;
  creditCurrency: HouseCurrency;
  creditValidityMonths: number;
  creditChannels: CreditChannel[];
  experienceMembersEveningMinTier: 1 | 2 | 3;
  experienceLaunchPreviewMinTier: 1 | 2 | 3;
  experiencePartnerMinTier: 1 | 2 | 3;
}

/** A model a welcome gift may be. */
export interface GiftModel {
  id: string;
  name: string;
  active: boolean;
  discontinued: boolean;
  sizes: number;
  available: number;
  imageUrl: string | null;
}

export interface ClubProgramSheet extends ClubProgram {
  gifts: { platine: GiftModel | null; palladium: GiftModel | null };
  giftOptions: GiftModel[];
  /** What each tier's program says, as /verify shows it. */
  lines: Record<ClubTierName, string[]>;
  updatedAt: Iso | null;
  updatedBy: { id: string; email: string } | null;
}

/** One rate of SHIPPING (Orders → Settings). */
export interface ShippingRate {
  currency: HouseCurrency;
  service: ShippingService;
  feeMinor: number;
}

export interface ShippingRatesSheet {
  items: (ShippingRate & { updatedAt: Iso; updatedBy: { id: string; email: string } | null })[];
}

/**
 * ENGRAVING (plan NEXT LOT §3.6.C; GET /api/admin/orders/engraving-prices): the engraving's price per currency, in minor
 * units, null where none is set (no engraving offered in that currency), for the orders without their release's
 * ENGRAVING add-on; who set them last, and when.
 */
export interface EngravingPricesSheet {
  prices: Record<HouseCurrency, number | null>;
  updatedAt: Iso | null;
  updatedBy: { id: string; email: string } | null;
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
  piece: string | null;
  shipment: { carrier: string; trackingNumber: string } | null;
  timing: OrderTiming;
  /** Its piece is ready but its parcel waits for another order's (plan NEXT LOT §3.5.6.6): never LATE meanwhile. */
  waitingForParcel?: boolean;
  /** Its order case not ended (plan NEXT LOT §3.6.D): its return or size exchange, or its parcel's problem; null without one. */
  orderCase?: { kind: OrderCaseKind } | null;
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
  /** Its variant's label (BLUE), or null: the packing slip's Piece reads MONOLITHE · BLUE (plan NEXT LOT §3.5.3). */
  model: { id: string; name: string; variant: string | null };
  sizeLabel: string | null;
  skuId: string | null;
  priceMinor: number | null;
  currency: OrderCurrency | null;
  addons: { id: string; label: string; priceMinor: number }[];
  surprise: string | null;
  engravingText: string | null;
  /** Plan NEXT LOT §3.6.C: the price its engraving took from the settings (null: the release's add-on, or one of before), and who typed it. */
  engravingMinor?: number | null;
  engravingBy?: AddressSource | null;
  /** The delivery address (plan NEXT LOT §3.6.B: with its country, ISO 3166-1 alpha-2, and phone, withheld from an AUDITOR). */
  buyer: { name: string | null; address: string | null; country?: string | null; phone?: string | null };
  /** Who entered the delivery address and when, and when it was replaced after it was first entered (ADDRESS CHANGED). */
  addressBy?: AddressSource | null;
  addressAt?: Iso | null;
  addressChangedAt?: Iso | null;
  status: OrderStatus;
  reservedAt: Iso;
  paidAt: Iso | null;
  shippedAt: Iso | null;
  deliveredAt: Iso | null;
  cancelledAt: Iso | null;
  returnedAt: Iso | null;
  location: { id: string; name: string };
  reservation: OrderReservation | null;
  shipment: { carrier: { id: string; name: string }; trackingNumber: string; trackingUrl: string; declaredValueMinor: number | null } | null;
  productId: string | null;
  shopifyOrderId: string | null;
  /** BP-19 T4: its shipping (service, fee, the tier that made it free), all null for none. */
  shipping: { service: ShippingService | null; minor: number | null; benefit: 2 | 3 | null };
  /** BP-19: the order it travels with, and once that order has shipped its carrier and tracking number (SHIP WITH ITS ORDER). */
  withOrder: { id: string; reference: string; shipment: { carrierId: string; trackingNumber: string } | null } | null;
  /**
   * BP-19 T5: the welcome gifts travelling with it (not cancelled; PLATINE's and PALLADIUM's when both tiers are reached
   * at once), by tier, then oldest first: each its order, model, step, whether its size is to be chosen, and its tier.
   */
  gifts: { id: string; reference: string; model: string; status: OrderStatus; sizeToChoose: boolean; tier: 2 | 3 }[];
  /** BP-19 T5, on a GIFT order: its tier, and while its size is to be chosen, its model's sizes with the pieces available. */
  /** …and (AC-01) the client's saved size, a hint only: the matching size's label or the saved measure; null without one. */
  giftOf: { tier: 2 | 3; sizes: { skuId: string; label: string | null; available: number }[]; savedSize: string | null } | null;
  /** BP-19 T5: the client's credit usable now, and the credit taken off this order (released or not). */
  credit: {
    available: { grantId: string; tier: 2 | 3; balanceMinor: number; currency: string; expiresAt: Iso }[];
    applied: { id: string; grantId: string; tier: 2 | 3; amountMinor: number; appliedAt: Iso; releasedAt: Iso | null; releasedReason: CreditReleaseReason | null }[];
  };
  /** Its return (RETURNED): where the piece went, the note, whether ORBES took its buyer's ownership back. */
  /** Its note null for an AUDITOR when the return was decided from an order case (ORBES's decision's words). */
  return: { outcome: ReturnOutcome; location: { id: string; name: string } | null; note: string | null; at: Iso; ownershipReclaimed: boolean } | null;
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
  /** NEW CLAIM CODE (plan NEXT LOT §3.4): the order's newest new claim code made for its buyer, or null; never the code. */
  claimCode: OrderClaimCode | null;
  /** Whether a card registers the order's piece, read from the piece (with or without a new claim code of the order's own). */
  claimCard: OrderClaimCard;
  /** Its order cases, the newest first (plan NEXT LOT §3.5.4.4; every note withheld from an AUDITOR). */
  orderCases: OrderCaseRecord[];
  /** Once shipped: the model's other sizes an exchange may take, those in stock at its location selectable. */
  exchangeSizes: { skuId: string; label: string; available: number; selectable: boolean }[];
}

/** An order case (plan NEXT LOT §1.1 (b)): a return, a size exchange, a parcel problem. */
export interface OrderCaseRecord {
  id: string;
  order: { id: string; reference: string };
  kind: OrderCaseKind;
  status: OrderCaseStatus;
  openedBy: 'COLLECTOR' | 'CLIENT_SERVICES';
  openedAt: Iso;
  reason: OrderCaseReason | null;
  note: string | null;
  exchange: { skuId: string; sizeLabel: string; available: number } | null;
  shipment: { id: string; orders: { id: string; reference: string }[] } | null;
  messageId: string | null;
  /** The collector's conversation its request was written into (plan NEXT LOT §3.6.D); null without one. */
  conversationId?: string | null;
  received: { at: Iso; pieceState: 'OK' | 'DAMAGED'; note: string | null } | null;
  decision: { at: Iso; outcome: 'REFUND' | 'EXCHANGE' | 'RESHIP'; pieceTo: 'RESTOCKED' | 'ARCHIVED' | 'REVOKED' | null; exchangeOrder: { id: string; reference: string } | null; note: string | null } | null;
  cancelled: { at: Iso; note: string | null } | null;
}

/** POST /api/admin/order-cases/:id/decide: the case, and the claim code of a piece back to stock (shown once). */
export interface OrderCaseDecided {
  case: OrderCaseRecord;
  productId?: string;
  claimCode?: string;
  claimCodes?: { productId: string; claimCode: string }[];
}

/** POST /api/admin/orders/:id/transition. */
export type OrderTransitionInput =
  | { to: 'PAID'; note?: string }
  | { to: 'SHIPPED'; carrierId: string; trackingNumber: string; declaredValueMinor?: number | null; note?: string }
  | { to: 'DELIVERED'; note?: string }
  | { to: 'CANCELLED'; note: string };


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
  /** BP-19: a SHIPPING, a CREDIT (negative) and a welcome GIFT line beside the piece and its add-ons. */
  lines: { kind: 'PIECE' | 'ADDON' | 'SHIPPING' | 'CREDIT' | 'GIFT'; label: string; detail: string | null; amountMinor: number }[];
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
  /** BP-19 T4: the shipping, with its fee, or null for both. */
  shippingService?: ShippingService | null;
  shippingMinor?: number | null;
}

// ── Locations and carriers (routes/admin/locations.ts) ───────────────────

export interface StockLocation {
  id: string;
  name: string;
  isDefault: boolean;
  shopifyLocationId: string | null;
  /** Its postal address (plan NEXT LOT §3.5): the supplier order's « Deliver to », a return's address; null while none. */
  address: string | null;
}

export interface Carrier {
  id: string;
  name: string;
  /** https, with {tracking} where the number goes. */
  trackingUrl: string;
  active: boolean;
}

// ── LOGISTICS (plan NEXT LOT §3.5.3 and §3.5.4.1; routes/admin/logistics.ts) ─

/** A SKU's level at a location (a transfer's answer, POST /api/admin/logistics/transfers). */
export interface StockLevel {
  onHand: number;
  reserved: number;
  available: number;
}

/** A size as Logistics and the supplier orders name it: its model, the model's variant, its size and its SKU code. */
export interface LogisticsSku {
  id: string;
  code: string;
  model: { id: string; name: string };
  /** The variant's label (BLUE) of a variant model; null otherwise. */
  variant: string | null;
  /** Null: one size. */
  sizeLabel: string | null;
  setAside: boolean;
}

/** A location of the request's scope (the agent's own, or every one for ORBES staff), the default first. */
export interface LogisticsLocation {
  id: string;
  name: string;
  isDefault: boolean;
}

/** GET /api/admin/logistics/stock: a size at a location. `expected`, `toOrder` and `unbacked` are ORBES staff's only. */
export interface LogisticsStockRow {
  sku: LogisticsSku;
  location: { id: string; name: string };
  onHand: number;
  reserved: number;
  available: number;
  /** Orders waiting for a piece of this size there (Awaiting stock). */
  waiting: number;
  minimum: number | null;
  expected?: number;
  toOrder?: number;
  /** The size's pieces counted without an ORBES identity behind them, every location together (NO PIECE · n). */
  unbacked?: number;
}

export interface LogisticsStock {
  rows: LogisticsStockRow[];
  /** Every offered size: what a correction, a transfer, a minimum or a count in may name. */
  skus: LogisticsSku[];
  locations: LogisticsLocation[];
  /** ORBES staff's only: how many sizes have pieces counted that no identity backs. */
  unbackedSizes?: number;
}

/** A stock correction: the agent's waits for ORBES (TO_APPROVE); ORBES staff's is applied at once (APPROVED). */
export interface StockCorrection {
  id: string;
  sku: LogisticsSku;
  location: { id: string; name: string };
  delta: number;
  reason: string;
  status: StockCorrectionStatus;
  proposedAt: Iso;
  decidedAt: Iso | null;
  decisionNote: string | null;
}

/** GET /api/admin/logistics/corrections: the newest first, and how many wait for ORBES (the tab's counter). */
export interface StockCorrections {
  items: StockCorrection[];
  toApprove: number;
}

/** A parcel's step on the agent's list (plan NEXT LOT §3.5.3). */
export type ParcelStep = 'NOT_READY' | 'READY_TO_PACK' | Exclude<ShipmentStatus, 'CANCELLED'>;

/** A parcel on the agent's To ship list: an order and the orders travelling with it. */
export interface ToShipRow {
  id: string;
  reference: string;
  /** The other orders travelling in it ('+ 2 pieces'). */
  others: number;
  location: { id: string; name: string };
  readySince: Iso;
  late: boolean;
  pieces: { model: string; variant: string | null; sizeLabel: string | null }[];
  addons: string[];
  engraving: boolean;
  shipTo: { name: string | null; address: string | null; country: string | null };
  step: 'READY_TO_PACK' | 'PACKING' | 'PACKED';
  addressChanged: boolean;
}

/** A parcel on its way. */
export interface OnItsWayRow {
  id: string;
  reference: string;
  location: { id: string; name: string };
  shippedAt: Iso;
  carrier: { id: string; name: string };
  trackingNumber: string;
  trackingUrl: string;
}

/** One order of a parcel as the agent packs it: never a price. */
export interface ParcelPiece {
  orderId: string;
  reference: string;
  status: OrderStatus;
  model: string;
  variant: string | null;
  sizeLabel: string | null;
  skuCode: string | null;
  /** The add-ons' labels only. */
  addons: string[];
  engraving: string | null;
  surprise: string | null;
  /** The piece bound by its packing scan, and whether it is scanned in the current shipment. */
  piece: { productId: string; scanned: boolean } | null;
}

/** A line of the packing checklist: ticked by hand, or (`byScan`) only by the card's scan. */
export interface ChecklistLine {
  key: string;
  label: string;
  byScan: boolean;
  ticked: boolean;
}

/** Who made a change of a parcel, as its history says it: a role, never a name. */
export type ParcelActor = 'ORBES' | 'LOGISTICS' | 'COLLECTOR' | 'SYSTEM';

/** GET /api/admin/logistics/orders/:id: a parcel as the agent and ORBES read it. No price, email, account nor release. */
export interface ShippingOrderView {
  /** The parcel's key: its first order. */
  id: string;
  reference: string;
  location: { id: string; name: string };
  step: ParcelStep;
  readySince: Iso | null;
  late: boolean;
  orders: ParcelPiece[];
  shipTo: { name: string | null; address: string | null; country: string | null; phone: string | null };
  /** ADDRESS CHANGED: when and by whom the address was replaced; null until then. */
  addressChanged: { at: Iso; by: 'COLLECTOR' | 'STAFF' } | null;
  shipment: {
    id: string;
    status: ShipmentStatus;
    packingStartedAt: Iso;
    packedAt: Iso | null;
    shippedAt: Iso | null;
    deliveredAt: Iso | null;
    photo: boolean;
    carrier: { id: string; name: string } | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
  checklist: ChecklistLine[];
  history: { action: string; at: Iso; by: ParcelActor; order: string }[];
  /** The active carriers, for Ship (the agent never reads the carriers' route). */
  carriers: { id: string; name: string }[];
}

/** POST …/packing/scan: the piece the card named, and the parcel after it. */
export interface PackingScan {
  piece: { productId: string; sku: LogisticsSku };
  parcel: ShippingOrderView;
}

/** GET /api/admin/logistics/orders: To ship and On its way, and the scope's locations (the Location filter). */
export interface ParcelsBoard {
  toShip: ToShipRow[];
  onItsWay: OnItsWayRow[];
  locations: LogisticsLocation[];
}

/** A supplier order's line as a reception counts against it: never a price. */
export interface ReceptionOrderLine {
  lineId: string;
  sku: LogisticsSku;
  ordered: number;
  /** What its CONFIRMED receptions brought in, good or not. */
  alreadyReceived: number;
  expected: number;
}

/** GET …/receptions/supplier-order and …/receptions/lines/:id: an open supplier order's lines, without a price. */
export interface ReceptionOrder {
  id: string;
  reference: string;
  supplierName: string;
  location: { id: string; name: string };
  /** YYYY-MM-DD. */
  expectedOn: string | null;
  lines: ReceptionOrderLine[];
  /** The sizes « Add a piece not on this order » offers. */
  offered: LogisticsSku[];
}

/** A run of a reception's cards (fixed by serial): its cards, those still sealed, those printed. */
export interface CardRun {
  run: number;
  cards: number;
  sealed: number;
  printed: number;
}

/** A reception as the Logistics page reads it. */
export interface ReceptionView {
  id: string;
  supplierOrder: { id: string; reference: string };
  /** ORBES staff's; null for the agent (the name shows on the reception page from its lines). */
  supplierName: string | null;
  location: { id: string; name: string };
  status: ReceptionStatus;
  deliveryNote: string | null;
  note: string | null;
  countedAt: Iso;
  sentBack: { at: Iso; note: string } | null;
  confirmedAt: Iso | null;
  lines: { id: string; sku: LogisticsSku; onOrder: boolean; accepted: number; rejected: number; issued: number; note: string | null }[];
  accepted: number;
  rejected: number;
  issuing: { issued: number; accepted: number; done: boolean };
  cards: { sealed: number; printed: number; erased: Partial<Record<CardErasedReason, number>>; attachedAt: Iso | null; runs: { sheet: CardRun[]; card: CardRun[] } };
}

/** Rejected pieces waiting to go back to their supplier. */
export interface SupplierReturnItem {
  id: string;
  supplierOrder: { id: string; reference: string };
  sku: LogisticsSku;
  quantity: number;
  status: SupplierReturnStatus;
  /** Where the rejected pieces wait: their reception's location. */
  location: { id: string; name: string };
}

/** A supplier order on its way to a location (ORBES staff only). */
export interface ExpectedSupplierOrder {
  id: string;
  reference: string;
  supplierName: string;
  location: { id: string; name: string };
  expectedOn: string | null;
  piecesExpected: number;
}

/** GET /api/admin/logistics/receptions: the Receptions tab. */
export interface ReceptionsBoard {
  toConfirm: ReceptionView[];
  cardsToPrint: ReceptionView[];
  backToSupplier: SupplierReturnItem[];
  /** ORBES staff only. */
  expected?: ExpectedSupplierOrder[];
  /** The active carriers, for Sent back. */
  carriers: { id: string; name: string }[];
  /** The tab's counter. */
  count: number;
}

/** A reception's count, as recorded or recorded again. */
export interface ReceptionInput {
  lines: { skuId: string; accepted: number; rejected: number; note?: string | null }[];
  deliveryNote?: string | null;
  note?: string | null;
}

/** GET /api/admin/logistics/order-cases: a parcel the agent expects back (no note, no price, no account). */
export interface CaseToReceive {
  id: string;
  order: { id: string; reference: string };
  kind: OrderCaseKind;
  pieces: { model: string; variant: string | null; sizeLabel: string | null }[];
  openedAt: Iso;
  location: { id: string; name: string };
}

// ── The yearly care (plan NEXT-NINE, BP-19 T6) ─────────────────────────────

/** BP-19 T10: what the tier program gave an account and what is in use (GET /api/admin/owners/:id `club`). */
export interface OwnerClub {
  tier: ClubTierName | null;
  grants: {
    tier: ClubTierName;
    kind: 'GIFT' | 'CREDIT';
    grantedAt: Iso;
    amountMinor: number | null;
    balanceMinor: number | null;
    currency: string | null;
    expiresAt: Iso | null;
    gift: { state: 'PENDING' | 'WITH_ORDER' | 'DELIVERED'; orderId: string | null; orderReference: string | null } | null;
  }[];
  careThisYear: { year: number; used: number; allowance: number | 'ALL'; open: { id: string; productId: string } | null } | null;
}

/** A shipment of a yearly care: its carrier, its tracking number and link, when it left. */
export interface CareShipment {
  carrier: { id: string; name: string };
  tracking: string;
  trackingUrl: string;
  at: Iso;
}

/** A row of the Yearly care board (GET /api/admin/care): the client's email masked for an AUDITOR. */
export interface CareRow {
  id: string;
  status: CareRequestStatus;
  requestedAt: Iso;
  year: number;
  /** The tier the account held when it asked. */
  tier: ClubTierName;
  piece: { productId: string; model: string };
  account: { id: string; email: string };
}

/** GET /api/admin/care/:id: the return name and address masked for an AUDITOR. */
export interface CareSheet extends CareRow {
  returnName: string;
  returnAddress: string;
  /** The prepaid label: its shipment, and whether its PDF is still kept. */
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: Iso | null;
  serviceRecordId: string | null;
  return: CareShipment | null;
  doneAt: Iso | null;
  cancelledAt: Iso | null;
  cancelledBy: 'account' | 'admin' | null;
  note: string | null;
  handledBy: { id: string; email: string } | null;
  conversation: { conversationId: string; status: ClientConversationStatus } | null;
}

// ── GROWTH (plan NEXT-NINE, BP-29; services/growth.ts, API §16.31) ─────────

/** The windows of GROWTH, in months (services/growth.ts GROWTH_WINDOWS); the page opens on the first. */
export const GROWTH_WINDOWS = [12, 24] as const;
export type GrowthWindowMonths = (typeof GROWTH_WINDOWS)[number];
/** Where a counted piece came from (services/growth.ts PIECE_SOURCES). */
export const PIECE_SOURCES = ['LIVE', 'DRAW', 'SALON', 'POINT_OF_SALE', 'ELSEWHERE'] as const;
export type PieceSource = (typeof PIECE_SOURCES)[number];
/** The funnel's steps, in order (services/growth.ts FUNNEL_STEPS). */
export const FUNNEL_STEPS = ['scans', 'accounts', 'owners', 'buyers', 'platine', 'palladium'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
/** The time to the second piece, by bucket (services/growth.ts SECOND_PIECE_BUCKETS). */
export const SECOND_PIECE_BUCKETS = ['MONTH', 'THREE_MONTHS', 'SIX_MONTHS', 'YEAR', 'LATER'] as const;
export type SecondPieceBucket = (typeof SECOND_PIECE_BUCKETS)[number];

/** A group of collectors' lifetime values; amounts null under three collectors. */
export interface GrowthLtvGroup {
  key: string | null;
  label: string | null;
  collectors: number;
  totalMinor: number | null;
  averageMinor: number | null;
  medianMinor: number | null;
}

export interface GrowthRevenueMonth {
  month: string;
  orders: number;
  invoicedMinor: number;
  creditedMinor: number;
  netMinor: number;
}

/** A group of the revenue; its amount null under three collectors. */
export interface GrowthRevenueGroup {
  key: string | null;
  label: string | null;
  collectors: number;
  orders: number;
  netMinor: number | null;
}

/** GET /api/admin/growth: it names no account. */
export interface GrowthReport {
  window: { months: GrowthWindowMonths; from: string; to: string; list: string[]; currency: HouseCurrency; currencies: HouseCurrency[]; generatedAt: Iso };
  ltv: {
    perCollector: { collectors: number; totalMinor: number; averageMinor: number | null; medianMinor: number | null; topTenthFromMinor: number | null };
    unpricedPieces: number;
    byTier: GrowthLtvGroup[];
    byCountry: GrowthLtvGroup[];
    byFirstModel: GrowthLtvGroup[];
    byChannel: GrowthLtvGroup[];
  };
  repeat: {
    collectors: number;
    withSecond: number;
    rate: number | null;
    medianDays: number | null;
    buckets: Record<SecondPieceBucket, number>;
    /** The newest month first; `within` per mark (1, 3, 6, 12 months), null while not reached. */
    cohorts: { month: string; collectors: number; within: (number | null)[]; toDate: number }[];
  };
  funnel: {
    thresholds: number[];
    totals: Record<FunnelStep, number>;
    /** The newest month first. */
    months: { month: string; counts: Record<FunnelStep, number> }[];
    clubNow: { TITANE: number; PLATINE: number; PALLADIUM: number; total: number };
  };
  revenue: {
    /** The newest month first. */
    months: GrowthRevenueMonth[];
    total: Omit<GrowthRevenueMonth, 'month'>;
    byChannel: GrowthRevenueGroup[];
    byCountry: GrowthRevenueGroup[];
    byModel: GrowthRevenueGroup[];
  };
}

/** A row of COLLECTORS BY VALUE (GET /api/admin/growth/collectors): the email masked for an AUDITOR. */
export interface GrowthCollector {
  accountId: string;
  email: string;
  tier: ClubTierName | null;
  country: string | null;
  pieces: number;
  valueMinor: number;
  firstPieceAt: Iso;
}

export interface GrowthCollectors {
  currency: HouseCurrency;
  currencies: HouseCurrency[];
  page: number;
  pageSize: number;
  total: number;
  items: GrowthCollector[];
}

/** A release of Latest releases (GET /api/admin/growth/releases). */
export interface GrowthRelease {
  id: string;
  mode: DropMode;
  title: string;
  opensAt: Iso;
  pieces: number;
  sold: number;
  /** LIVE: from T0 to its last piece confirmed, when every piece was. */
  sellOutMs: number | null;
  /** DRAW: its entries. */
  entries: number | null;
}

/** The client sheet's Lifetime value: per currency. */
export type LifetimeValue = { currency: string; valueMinor: number }[];

// ── Test entrants and the server's status (plan TEST ENTRANTS, 2026-10-07) ──

/** A test's release: a draw or a LIVE RELEASE (test_runs.mode). */
export const TEST_RUN_MODES = ['DRAW', 'LIVE'] as const;
export type TestRunMode = (typeof TEST_RUN_MODES)[number];

/**
 * A test (test_runs.status): RUNNING, its test entrants acting; DONE, every one has acted (a draw's test waits there for
 * the staff draw); STOPPED by STOP; INTERRUPTED by a restart; ENDED by END TEST, its clean-up done. Only RUNNING blocks
 * a new test.
 */
export const TEST_RUN_STATUSES = ['RUNNING', 'DONE', 'STOPPED', 'INTERRUPTED', 'ENDED'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

/** How the test entrants arrive: all at once, evenly over a number of seconds, or spread from now until T0 (LIVE). */
export type TestArrivalMode = 'all' | 'burst' | 'before';

/** The settings of one press of SEND TEST ENTRANTS or ADD MORE, without its phrase. */
export interface TestRunSettings {
  /** Test entrants per tier: 1 to 1 000 in all per press. */
  tiers: { none: number; titane: number; platine: number; palladium: number };
  /** `seconds` for a burst (1 to 3 600); `interestPct`: the share that says I'LL BE THERE first (LIVE). */
  arrival: { mode: TestArrivalMode; seconds?: number; interestPct: number };
  /**
   * LIVE: the shares that PAY, RELEASE MY PLACE, miss their turn or LEAVE (100 in all), the seal held `holdSeconds`
   * (1.5 to 10). A draw: the share that withdraws after entering, the PLATINE and PALLADIUM that reserve during the early
   * access, and the share of the places drawn that confirm by themselves.
   */
  behaviour: { payPct: number; releasePct: number; missPct: number; leavePct: number; holdSeconds: number; withdrawPct: number; reservePct: number; confirmPct: number };
  /** LIVE: the size (a size's id; null, one at random), the pieces (1 to 5; null, at random) and the share that adds add-ons. */
  choices: { size: string | null; quantity: number | null; addOnsPct: number };
  /** Each test entrant drawn within: its seniority (years), its account's age (days), a country of the list (none: none), and the share on one shared network. */
  profile: { seniorityMin: number; seniorityMax: number; accountAgeDaysMin: number; accountAgeDaysMax: number; countries: string[]; sharedNetworkPct: number };
}

/** One press of a run as the server keeps it (test_runs.settings, oldest first): its settings, when, and how many it sent. */
export interface TestRunPress extends TestRunSettings {
  at?: Iso;
  entrants?: number;
}

/** POST /api/admin/drops/:id/test-runs (ADMIN): SEND TEST ENTRANTS, the phrase typed with the settings. */
export interface TestRunInput extends TestRunSettings {
  phrase: string;
}

/** POST /api/admin/test-runs/:id/add (ADMIN): ADD MORE, the same body; the groups left out keep the run's last settings. */
export type TestRunAddInput = Pick<TestRunInput, 'phrase' | 'tiers'> & Partial<Omit<TestRunSettings, 'tiers'>>;

/** One tier's test entrants in a run, by what they did. */
export interface TestRunTier {
  tier: number;
  label: 'NO TIER' | 'TITANE' | 'PLATINE' | 'PALLADIUM';
  entered: number;
  inRoom: number;
  selected: number;
  confirmed: number;
  lapsed: number;
  released: number;
  missed: number;
  left: number;
  withdrawn: number;
}

/** A test entrant holding a place (a draw's SELECTED, a LIVE turn or hold): CONFIRM, and RELEASE on a LIVE RELEASE. */
export interface TestRunSelected {
  accountId: string;
  email: string;
  tier: number;
  status: string;
  respondBy: Iso | null;
  orderRef: string | null;
  canConfirm: boolean;
  canRelease: boolean;
}

/** One check of a TEST REPORT, computed at END TEST before the clean-up: passed or failed, said in one plain line. */
export interface TestReportCheck {
  id: string;
  label: string;
  pass: boolean;
  line: string;
}

/**
 * A TEST REPORT: its five checks (one entry per account, the draw's order, no two places, the stock, the orders), how
 * many passed, and the test's peaks while it ran.
 */
export interface TestReport {
  at?: Iso;
  checks: TestReportCheck[];
  passed?: number;
  total?: number;
  peaks?: TestRunPeaks | null;
}

/** The test's own running maxima while it was RUNNING (memory, CPU, response time, loop delay, connections, errors). */
export type TestRunPeaks = Record<string, unknown>;

/** GET /api/admin/drops/:id/test-runs/current: a run with what its test entrants did. */
export interface TestRunView {
  id: string;
  dropId: string;
  mode: TestRunMode;
  status: TestRunStatus;
  createdAt: Iso;
  endedAt: Iso | null;
  /** The email of the ADMIN who sent it. */
  createdBy: string;
  /** The settings of each press, oldest first (ADD MORE appends one); one press's settings are read alike. */
  settings: TestRunPress[] | TestRunPress;
  /** Test entrants sent, every press together. */
  entrants: number;
  byTier: TestRunTier[];
  /** The release's entries: the real ones, the test ones and all of them. */
  release: { real: number; test: number; total: number };
  /** At most 500. */
  selected: TestRunSelected[];
  /** The runner's last 20 errors, oldest first (a 429 refused, a route's refusal). */
  errors: { at: Iso; message: string }[];
  report: TestReport | null;
  peaks: TestRunPeaks | null;
}

/** GET /api/admin/drops/:id/test-runs: the release's tests, newest first. */
export interface TestRunSummary {
  id: string;
  status: TestRunStatus;
  createdAt: Iso;
  endedAt: Iso | null;
  createdBy: string;
  entrants: number;
  checksPassed: number | null;
  checksTotal: number | null;
  report: TestReport | null;
  peaks?: TestRunPeaks | null;
}

/** GET /api/admin/test-runs/active: the RUNNING test, whatever its release (the Drops tab). */
export interface ActiveTestRun {
  id: string;
  dropId: string;
  dropName: string;
  mode: TestRunMode;
  status: TestRunStatus;
  entrants: number;
}

/** One sample of the server's status, every 2 s; a value the server cannot read here (macOS, PGlite) is null. */
export interface SystemSample {
  at: Iso;
  /** The app's container (cgroup v2): memory now, its limit and peak; CPU in cores, its limit, the share throttled; processes. */
  app: { memBytes: number | null; memLimitBytes: number | null; memPeakBytes: number | null; cpuCores: number | null; cpuLimitCores: number | null; throttledPct: number | null; pids: number | null; pidsMax: number | null };
  /** The server: memory available of its total, swap used, load over 1 and 5 minutes, CPU busy, the disk `/` used. */
  host: { memAvailableBytes: number | null; memTotalBytes: number | null; swapUsedBytes: number | null; load1: number | null; load5: number | null; cpuPct: number | null; diskUsedPct: number | null };
  /** The app's Node process: its heap and its limit, resident and external memory, the event loop's delay and busy share. */
  node: { heapUsedBytes: number | null; heapLimitBytes: number | null; rssBytes: number | null; externalBytes: number | null; loopDelayP50Ms: number | null; loopDelayP99Ms: number | null; loopUtilPct: number | null };
  /** The LIVE streams open now, the releases and the accounts they follow. */
  live: { streams: number | null; releases: number | null; accounts: number | null };
  /** The app's pool (its connections, idle, requests waiting) and the database's (connections of its maximum, active, waiting). */
  db: { poolTotal: number | null; poolIdle: number | null; poolWaiting: number | null; connections: number | null; maxConnections: number | null; active: number | null; waiting: number | null };
  /** Over the last 60 s: requests a second, the response time's p95, the 5xx answered and the 429 refused. */
  http: { rps: number | null; p95Ms: number | null; errors5xx: number | null; refused429: number | null };
}

/**
 * The recorded visitor data's bytes as last measured (plan CUSTOMER INTELLIGENCE §3.4 A.10.7, the daily `intelligence
 * sizes` figures): in all, then views, devices, visits, conversions, wishes and profiles.
 */
export interface VisitorData {
  at: Iso;
  totalBytes: number;
  viewsBytes: number;
  devicesBytes: number;
  visitsBytes: number;
  conversionsBytes: number;
  wishesBytes: number;
  profilesBytes: number;
}

/**
 * GET /api/admin/system/status (AUDITOR): the latest sample and the last 10 minutes (300 samples, oldest first); the
 * visitor data as last measured (null: not read).
 */
export interface SystemStatus {
  now: Iso;
  latest: SystemSample | null;
  history: SystemSample[];
  visitorData: VisitorData | null;
}

/**
 * An answer to « How did you hear about ORBES? » (plan CUSTOMER INTELLIGENCE §3.1 P.10; GET /api/admin/heard-options,
 * API §16.38): its words, Other or not, offered (`active`) or set aside, its place, and how many counted collectors gave it.
 */
export interface HeardOptionView {
  id: string;
  label: string;
  other: boolean;
  active: boolean;
  position: number;
  given?: number;
}

// ── Links (plan CUSTOMER INTELLIGENCE §3.4 A.10; API §16.35; services/links.ts, services/acquisition-report.ts) ──

/** A channel of links (GET /api/admin/link-channels): its name, its place, how many links name it (archived ones included). */
export interface LinkChannelView {
  id: string;
  name: string;
  position: number;
  links: number;
}

/** A console link (services/links.ts LinkView): its short address and the direct one, where it leads, its cost. */
export interface LinkView {
  id: string;
  code: string;
  name: string;
  channel: { id: string; name: string };
  destination: LinkDestination;
  dropId: string | null;
  modelId: string | null;
  cost: { minor: number; currency: HouseCurrency } | null;
  note: string | null;
  address: string;
  directAddress: string;
  archivedAt: Iso | null;
  createdBy: { id: string; email: string };
  createdAt: Iso;
  updatedAt: Iso;
}

/** What the New link dialog offers (GET /api/admin/links/destinations). */
export interface LinkDestinations {
  releases: { id: string; title: string; mode: 'DRAW' | 'LIVE'; opensAt: Iso; model: string }[];
  models: { id: string; name: string; variantLabel: string | null; variantOf: string | null; slug: string | null }[];
}

/** What a source brought in under one attribution. */
export interface LinkResults {
  signups: number;
  entries: number;
  purchases: number;
  revenueMinor: number;
}

/** A row's figures: visits once, then the first link (discovery) and the last link (conversion) side by side. */
export interface LinkFigures {
  visits: number;
  firstVisits: number;
  first: LinkResults;
  last: LinkResults;
}

/** RETURN, SINCE MADE: revenue in the cost's currency since the link was made, divided by its cost. */
export interface LinkReturn {
  revenueMinor: number;
  costMinor: number;
  currency: HouseCurrency;
  ratio: number | null;
}

export interface LinkReturns {
  first: LinkReturn;
  last: LinkReturn;
}

export interface LinkReportRow {
  link: LinkView;
  sourceId: number | null;
  figures: LinkFigures;
  returns: LinkReturns | null;
}

export interface LinkChannelGroup {
  channel: { id: string; name: string; position: number };
  figures: LinkFigures;
  cost: { minor: number; currency: HouseCurrency } | null;
  returns: LinkReturns | null;
  links: LinkReportRow[];
}

export interface LinkCampaignRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  sourceIds: number[];
  variants: number;
  content: string | null;
  term: string | null;
  figures: LinkFigures;
}

export interface LinkCampaignGroup {
  utmSource: string | null;
  figures: LinkFigures;
  rows: LinkCampaignRow[];
}

export interface LinkSiteRow {
  site: string;
  sourceId: number;
  figures: LinkFigures;
}

export interface LinkSourceLine {
  kind: SourceKind;
  figures: LinkFigures;
}

export const LINKS_VIEWS = ['links', 'campaigns', 'sites'] as const;
export type LinksView = (typeof LINKS_VIEWS)[number];

/** GET /api/admin/links: the period's figures on one of the three views, the lines without one, the TOTAL. */
export interface LinksReport {
  view: LinksView;
  period: { from: string | null; to: string | null };
  currency: HouseCurrency;
  currencies: HouseCurrency[];
  archived: boolean;
  trackingStartedAt: Iso | null;
  channels: LinkChannelGroup[];
  campaigns: LinkCampaignGroup[];
  sites: LinkSiteRow[];
  without: LinkSourceLine[];
  total: LinkFigures;
}

/** A day of one link: its visits, first visits, and sign-ups as the first link and as the last. */
export interface LinkDay {
  day: string;
  visits: number;
  firstVisits: number;
  signupsFirst: number;
  signupsLast: number;
}

/** GET /api/admin/links/:id: one link, its figures, its days and its return. */
export interface LinkReport {
  link: LinkView;
  destinationGone: boolean;
  period: { from: string | null; to: string | null };
  currency: HouseCurrency;
  currencies: HouseCurrency[];
  figures: LinkFigures;
  returns: LinkReturns | null;
  days: LinkDay[];
}

export const LINK_ATTRIBUTIONS = ['first', 'last'] as const;
export type LinkAttribution = (typeof LINK_ATTRIBUTIONS)[number];
export const LINK_MEASURES = ['signups', 'entries', 'purchases', 'revenue'] as const;
export type LinkMeasure = (typeof LINK_MEASURES)[number];

/** A collector behind a figure (GET /api/admin/acquisition/collectors), the email masked for an AUDITOR. */
export interface LinkFigureCollector {
  accountId: string;
  email: string;
  country: string | null;
  signedUpAt: Iso;
  entries: number;
  purchases: number;
  revenueMinor: number;
}

export interface LinkFigureCollectors {
  items: LinkFigureCollector[];
  total: number;
  page: number;
  pageSize: number;
  currency: HouseCurrency;
}

/** POST /api/admin/links (PATCH takes the same fields but `code`): what the New link and Edit dialogs send. */
export interface LinkInput {
  name: string;
  channelId: string;
  destination: LinkDestination;
  dropId?: string | null;
  modelId?: string | null;
  code?: string | null;
  cost?: { minor: number; currency: HouseCurrency } | null;
  note?: string | null;
}
