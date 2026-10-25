/**
 * Kysely types for the ORBES database. Mirrors migrations/0001_initial.ts
 * and the later migrations (0002–0023) column for column (snake_case, no CamelCasePlugin) so raw SQL, types and
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
 * not issued; /verify answers it as an unknown code. Never written in product_status_history (PRODUCT_HISTORY_STATUSES).
 * No identity is reserved any more (plan NEXT LOT §3.5, the atelier removed in step 5.13): those already reserved stay
 * as they are, reserved and unused (§3.5.8).
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

/**
 * RETAIL (migration 0008): a seller's account, ranked under AUDITOR, limited to the sale mode (A-08). LOGISTICS
 * (migration 0035, plan NEXT LOT §3.5): a person at the logistics agent, ranked with RETAIL, limited to the Logistics
 * routes of its own locations (admin_user_locations).
 */
export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
/**
 * The roles an ADMIN may give from the console (create a staff account, change a role; a LOGISTICS
 * login with its locations, plan NEXT LOT §3.5.6.1). ADMIN itself is granted from the shell only (scripts/admin.ts), where the second factor is enrolled
 * out of band (SECURITY-MODEL §3.3).
 */
export const STAFF_ROLES = ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const satisfies readonly AdminRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const SESSION_SUBJECT_TYPES = ['account', 'admin'] as const;
export type SessionSubjectType = (typeof SESSION_SUBJECT_TYPES)[number];

export const ACQUIRED_VIA = ['FIRST_REGISTRATION', 'TRANSFER', 'RESALE', 'ADMIN'] as const;
export type AcquiredVia = (typeof ACQUIRED_VIA)[number];

export const TRANSFER_STATUSES = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** YEARLY_CARE (migration 0028, BP-19 T6): the record the yearly care opens at the atelier; only the care flow opens one. */
export const SERVICE_TYPES = ['INSPECTION', 'CLEANING', 'POLISH', 'RESIZE', 'REPAIR', 'REPLACEMENT', 'AUTHENTICATION', 'YEARLY_CARE'] as const;
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
 * 3 PALLADIUM, reached at 1, 5 and 10 pieces held now (services/club.ts CLUB_TIER_THRESHOLDS).
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
 * draw confirmed by Client Services, a request of the private salon closed as ACCEPTED; since migration 0027 (BP-19 T5),
 * a welcome GIFT, its own order at price 0 travelling with the order it was added to.
 */
export const ORDER_CHANNELS = ['LIVE', 'DRAW', 'SALON', 'GIFT', 'EXCHANGE'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/**
 * The steps of an order (orders.status, migration 0022): RESERVED → PAID → SHIPPED → DELIVERED; CANCELLED from RESERVED
 * or PAID; RETURNED from SHIPPED or DELIVERED (services/orders.ts ORDER_TRANSITIONS).
 */
export const ORDER_STATUSES = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * What an order RESERVED or PAID holds at its location (orders.reservation, migration 0022; since 0037, plan NEXT LOT
 * §3.5): a piece in stock, or nothing yet, waiting for supplier stock (AWAITING, never shown to the collector).
 */
export const ORDER_RESERVATIONS = ['STOCK', 'AWAITING'] as const;
export type OrderReservation = (typeof ORDER_RESERVATIONS)[number];

/**
 * Why the stock of a SKU moved at a location (stock_movements.reason, migration 0022): a piece finished by the atelier
 * (+1), a count corrected (±), the two halves of a transfer, an order shipped (−1) or returned to stock (+1); since
 * migration 0036 (plan NEXT LOT §3.5) RECEIVED (+n, a reception line's pieces, issued and entering the stock).
 */
export const STOCK_MOVEMENT_REASONS = ['PRODUCED', 'ADJUSTED', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHIPPED', 'RETURNED', 'RECEIVED'] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** A piece to make at the atelier (bench_items.status, migration 0022): TO_MAKE → IN_PROGRESS → DONE, or CANCELLED. */
export const BENCH_ITEM_STATUSES = ['TO_MAKE', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type BenchItemStatus = (typeof BENCH_ITEM_STATUSES)[number];

/**
 * A parcel's steps (shipments.status, migration 0037, plan NEXT LOT §3.5): PACKING → PACKED → SHIPPED → DELIVERED; the
 * kind of a parcel problem once shipped (BACK_TO_SENDER, LOST, DAMAGED); or CANCELLED (an order of it cancelled while
 * packing).
 */
export const SHIPMENT_STATUSES = ['PACKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'BACK_TO_SENDER', 'LOST', 'DAMAGED', 'CANCELLED'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** An order case's kind (order_cases.kind, migration 0037, plan NEXT LOT §1.1 (b)): a return, a size exchange, a parcel problem. */
export const ORDER_CASE_KINDS = ['RETURN', 'EXCHANGE', 'BACK_TO_SENDER', 'LOST', 'DAMAGED'] as const;
export type OrderCaseKind = (typeof ORDER_CASE_KINDS)[number];

/** Who opened an order case (order_cases.opened_by_type): the collector, or staff. */
export const ORDER_CASE_OPENERS = ['account', 'admin'] as const;
export type OrderCaseOpener = (typeof ORDER_CASE_OPENERS)[number];

/** Why a return or an exchange is asked (order_cases.reason). */
export const ORDER_CASE_REASONS = ['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER'] as const;
export type OrderCaseReason = (typeof ORDER_CASE_REASONS)[number];

/** An order case's steps (order_cases.status): OPEN → RECEIVED → CLOSED, or CANCELLED. */
export const ORDER_CASE_STATUSES = ['OPEN', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;
export type OrderCaseStatus = (typeof ORDER_CASE_STATUSES)[number];

/** The piece as the agent found it back (order_cases.piece_state). */
export const ORDER_CASE_PIECE_STATES = ['OK', 'DAMAGED'] as const;
export type OrderCasePieceState = (typeof ORDER_CASE_PIECE_STATES)[number];

/** ORBES's decision (order_cases.outcome): a refund, the other size, another piece shipped. */
export const ORDER_CASE_OUTCOMES = ['REFUND', 'EXCHANGE', 'RESHIP'] as const;
export type OrderCaseOutcome = (typeof ORDER_CASE_OUTCOMES)[number];

/** Where a case's piece went (order_cases.piece_to): back to stock, to the archive, or revoked (a lost parcel). */
export const ORDER_CASE_PIECE_DESTINATIONS = ['RESTOCKED', 'ARCHIVED', 'REVOKED'] as const;
export type OrderCasePieceDestination = (typeof ORDER_CASE_PIECE_DESTINATIONS)[number];

/** Where a returned order's piece goes (returns.outcome, migration 0022): back to stock at a location, or to the archive. */
export const RETURN_OUTCOMES = ['RESTOCKED', 'ARCHIVED'] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

/** An invoice, or the credit note that follows one (invoices.kind, migration 0022). */
export const INVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/**
 * What a credit note credits (invoices.credit_scope, migration 0039, plan NEXT LOT §3.6.C): FULL, what remains of its
 * invoice (every credit note of before), or LINES, single lines (an engraving removed after PAID).
 */
export const CREDIT_SCOPES = ['FULL', 'LINES'] as const;
export type CreditScope = (typeof CREDIT_SCOPES)[number];

/**
 * Who entered an order's delivery address or its engraving (orders.address_by, orders.engraving_by, migration 0039, plan
 * NEXT LOT §3.6.B and §3.6.C): the COLLECTOR, in YOUR ORDERS, or ORBES Client Services (STAFF).
 */
export const ADDRESS_SOURCES = ['COLLECTOR', 'STAFF'] as const;
export type AddressSource = (typeof ADDRESS_SOURCES)[number];

/**
 * Who set a profile's date of birth, or saved it last (account_profiles.birth_date_by, updated_by, migration 0040, plan
 * CUSTOMER INTELLIGENCE §3.1 P.3.2): the COLLECTOR, in YOUR PROFILE, or ORBES Client Services (STAFF).
 */
export const PROFILE_SOURCES = ['COLLECTOR', 'STAFF'] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

/**
 * A collector's tastes (account_tastes.kind, migration 0040, plan CUSTOMER INTELLIGENCE §3.2 W.3): a favourite piece (a
 * type of the catalogue, « RING ») or a favourite finish (a variant's label, « Gold »).
 */
export const TASTE_KINDS = ['PIECE', 'FINISH'] as const;
export type TasteKind = (typeof TASTE_KINDS)[number];

/**
 * The page codes of a view (collector_views.page, migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), code → name.
 * Permanent: a code is never reused nor renumbered; the migration's CHECK takes the range 1..VIEW_PAGE_MAX. SCAN (1) is
 * written by the server at each scan, never sent by the app. Never recorded: the scan screens themselves, a LIVE
 * RELEASE's boutique board, the password screen.
 */
export const VIEW_PAGES = {
  1: 'SCAN',
  2: 'NOW',
  3: 'RESULT',
  4: 'MY_PIECES',
  5: 'MY_ORDERS',
  6: 'MY_RELEASES',
  7: 'PIECE',
  8: 'CERTIFICATE',
  9: 'COLLECTION',
  10: 'MODEL',
  11: 'CLUB',
  12: 'RELEASES',
  13: 'RELEASE',
  14: 'LIVE',
  15: 'AFTER_ROOM',
  16: 'HOW',
  17: 'CIRCLE',
  18: 'POST',
  19: 'ACCOUNT',
  20: 'MESSAGES',
  21: 'SIGN_IN',
  22: 'SIGN_UP',
  23: 'SIZES',
  24: 'ADDRESSES',
  25: 'PROFILE',
  26: 'WISHLIST',
} as const;
export type ViewPageCode = keyof typeof VIEW_PAGES;
export type ViewPage = (typeof VIEW_PAGES)[ViewPageCode];
/** The highest page code the migration's CHECK takes (collector_views.page, collector_view_totals.page 1..60; view_daily_stats.page 0..60, 0 the day's marker). */
export const VIEW_PAGE_MAX = 60;
/** name → code, the inverse of VIEW_PAGES. */
export const VIEW_PAGE_CODES = Object.freeze(
  Object.fromEntries(Object.entries(VIEW_PAGES).map(([code, name]) => [name, Number(code)])),
) as { readonly [P in ViewPage]: ViewPageCode };

/**
 * A remembered device's class (tracking_devices, device_daily_stats, migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6
 * and T.8.1, http/device-class.ts): its kind, its system, its browser, where the page was opened (a browser, an app's
 * built-in browser, the home screen) and that app.
 */
export const DEVICE_KINDS = ['PHONE', 'TABLET', 'COMPUTER', 'UNKNOWN'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const DEVICE_SYSTEMS = ['IOS', 'ANDROID', 'MACOS', 'WINDOWS', 'CHROMEOS', 'LINUX', 'OTHER'] as const;
export type DeviceSystem = (typeof DEVICE_SYSTEMS)[number];
export const DEVICE_BROWSERS = ['SAFARI', 'CHROME', 'FIREFOX', 'EDGE', 'SAMSUNG', 'OPERA', 'WEBVIEW', 'OTHER'] as const;
export type DeviceBrowser = (typeof DEVICE_BROWSERS)[number];
export const OPENED_IN = ['BROWSER', 'IN_APP', 'HOME_SCREEN'] as const;
export type OpenedIn = (typeof OPENED_IN)[number];
export const IN_APPS = ['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'THREADS', 'SNAPCHAT', 'PINTEREST', 'LINKEDIN', 'GOOGLE', 'WECHAT', 'LINE', 'OTHER'] as const;
export type InApp = (typeof IN_APPS)[number];
/** device_daily_stats.in_app: an app of IN_APPS, or NONE (opened outside an app). */
export type InAppOrNone = InApp | 'NONE';

/**
 * How a device was first linked to an account (tracking_device_accounts.first_via, migration 0042, plan CUSTOMER
 * INTELLIGENCE §3.3 T.8.4): at a sign-up, at a sign-in, or on a visit already signed in (SESSION).
 */
export const LINK_VIAS = ['SIGN_UP', 'SIGN_IN', 'SESSION'] as const;
export type LinkVia = (typeof LINK_VIAS)[number];

/**
 * Where a console link leads (links.destination, migration 0043, §3.4 A.6): NOW, THE RELEASES, a release (drop_id), THE
 * COLLECTION, a model's sheet (model_id), THE CLUB, HOW RELEASES WORK; LANDING (0050, F3), theorbes.com's founding list.
 */
export const LINK_DESTINATIONS = ['NOW', 'RELEASES', 'RELEASE', 'COLLECTION', 'MODEL', 'CLUB', 'HOW', 'LANDING'] as const;
export type LinkDestination = (typeof LINK_DESTINATIONS)[number];

/**
 * A source of visits (acquisition_sources.kind, migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.5): a console link, a
 * campaign's utm_ tags, a referring site, a direct arrival; BEFORE (« Before tracking ») and STAFF (« Console device »)
 * are never the result of an arrival.
 */
export const SOURCE_KINDS = ['LINK', 'CAMPAIGN', 'SITE', 'DIRECT', 'BEFORE', 'STAFF'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Who wrote a collector's first source (account_sources.set_by, migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.4,
 * A.8): the sign-up's attach, the sign-in's check, or the job's safety net.
 */
export const SOURCE_SET_BY = ['SIGN_UP', 'SIGN_IN', 'JOB'] as const;
export type SourceSetBy = (typeof SOURCE_SET_BY)[number];

/**
 * What a conversion records (acquisition_conversions.kind, migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.5): a
 * sign-up (ref_id the account), a draw entry, a LIVE RELEASE entry, an order.
 */
export const CONVERSION_KINDS = ['SIGNUP', 'DRAW_ENTRY', 'LIVE_ENTRY', 'ORDER'] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

/**
 * How the access rules of a LIVE RELEASE combine (drops.access_combine, migration 0023): every rule met (AND), or any
 * one of them (OR). NULL on a LIVE drop: AND.
 */
export const ACCESS_COMBINES = ['AND', 'OR'] as const;
export type AccessCombine = (typeof ACCESS_COMBINES)[number];

/**
 * A conversation between a collector and ORBES Client Services (client_conversations.status, migration 0025): TO_ANSWER
 * (the collector wrote last), ANSWERED, or CLOSED by staff. Writing again reopens it. The collector never sees it.
 */
export const CLIENT_CONVERSATION_STATUSES = ['TO_ANSWER', 'ANSWERED', 'CLOSED'] as const;
export type ClientConversationStatus = (typeof CLIENT_CONVERSATION_STATUSES)[number];

/** Who wrote a message (client_messages.author, migration 0025): the collector, or a staff member of Client Services. */
export const CLIENT_MESSAGE_AUTHORS = ['COLLECTOR', 'STAFF'] as const;
export type ClientMessageAuthor = (typeof CLIENT_MESSAGE_AUTHORS)[number];

/**
 * What a collector's message concerns (client_messages.context_kind, migration 0025): a piece, an order, a release, a
 * scan or a model (with its salon request). NULL on a STAFF message and on one written from MESSAGES.
 */
export const CLIENT_MESSAGE_CONTEXTS = ['PIECE', 'ORDER', 'RELEASE', 'SCAN', 'MODEL'] as const;
export type ClientMessageContext = (typeof CLIENT_MESSAGE_CONTEXTS)[number];

/**
 * The free shipping a tier of the club gives on every order (club_program_settings.shipping_free_platine and
 * `_palladium`, migration 0026, BP-19 T2/T4): none, standard or express.
 */
export const SHIPPING_FREE_LEVELS = ['NONE', 'STANDARD', 'EXPRESS'] as const;
export type ShippingFreeLevel = (typeof SHIPPING_FREE_LEVELS)[number];

/** How an order's piece is delivered (shipping_rates.service, migration 0026; orders.shipping_service, migration 0027). */
export const SHIPPING_SERVICES = ['STANDARD', 'EXPRESS'] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];

/**
 * The currencies of the house (shipping_rates.currency and club_program_settings.credit_currency, migration 0026): those
 * an order is priced in (services/orders.ts ORDER_CURRENCIES).
 */
export const HOUSE_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'] as const;
export type HouseCurrency = (typeof HOUSE_CURRENCIES)[number];

/** The channels a tier's credit may be taken off (club_program_settings.credit_channels, migration 0026): a draw, a LIVE RELEASE, the private salon. */
export const CREDIT_CHANNELS = ['DRAW', 'LIVE', 'SALON'] as const;
export type CreditChannel = (typeof CREDIT_CHANNELS)[number];

/**
 * What an invitation of the circle is (circle_posts.experience, migration 0026, BP-19 T7): the members' evening, a launch
 * preview or a partner experience, each from the tier THE PROGRAM names; NULL for any other post.
 */
export const CIRCLE_EXPERIENCES = ['MEMBERS_EVENING', 'LAUNCH_PREVIEW', 'PARTNER_EXPERIENCE'] as const;
export type CircleExperience = (typeof CIRCLE_EXPERIENCES)[number];

/**
 * What an account received on reaching a tier (tier_grants.kind, migration 0027, BP-19 T5): its welcome gift, its credit;
 * and, with no tier, its birthday credit (BIRTHDAY, migration 0045, plan CUSTOMER INTELLIGENCE §3.5 SB.4) and a credit
 * decided on a lifetime warranty claim (WARRANTY, migration 0048, plan ORBES CARE §2(c)).
 */
export const TIER_GRANT_KINDS = ['GIFT', 'CREDIT', 'BIRTHDAY', 'WARRANTY'] as const;
export type TierGrantKind = (typeof TIER_GRANT_KINDS)[number];

/**
 * The acts of a collector the engagement score reads (account_scores.last_act_kind, migration 0046, plan CUSTOMER
 * INTELLIGENCE §3.5 SB.3.1), in the order that settles two acts at the same instant: a scan of an ORBES CODE, a draw
 * entry, a LIVE RELEASE entry, I'LL BE THERE, an order, a piece registered.
 */
export const SCORE_ACT_KINDS = ['SCAN', 'DRAW', 'LIVE', 'INTEREST', 'ORDER', 'REGISTRATION'] as const;
export type ScoreActKind = (typeof SCORE_ACT_KINDS)[number];

/** The house's currencies the score converts to euros (account_scores.other_currencies): every one but EUR. */
export const SCORE_OTHER_CURRENCIES = ['GBP', 'USD', 'CHF'] as const;
export type ScoreOtherCurrency = (typeof SCORE_OTHER_CURRENCIES)[number];

/**
 * The steps of a yearly care (care_requests.status, migration 0028, BP-19 T6): asked for, its prepaid label sent, the
 * piece at the atelier, on its way back, done; or cancelled before it is shipped back.
 */
export const CARE_REQUEST_STATUSES = ['REQUESTED', 'LABEL_SENT', 'RECEIVED', 'RETURNING', 'DONE', 'CANCELLED'] as const;
export type CareRequestStatus = (typeof CARE_REQUEST_STATUSES)[number];

/** Who cancelled a yearly care (care_requests.cancelled_by): the collector's account, or ORBES. */
export const CARE_CANCELLED_BY = ['account', 'admin'] as const;
export type CareCancelledBy = (typeof CARE_CANCELLED_BY)[number];

/**
 * What a warranty claim is made under (warranty_claims.basis, migration 0048, plan ORBES CARE §2(c), answer 10): the
 * piece's ORBES warranty, LIFETIME or TWO_YEARS (its kind read at opening, `warranties.lifetime`, never chosen by staff),
 * or the legal guarantee of conformity (LEGAL).
 */
export const WARRANTY_CLAIM_BASES = ['LIFETIME', 'TWO_YEARS', 'LEGAL'] as const;
export type WarrantyClaimBasis = (typeof WARRANTY_CLAIM_BASES)[number];

/**
 * The steps of a warranty claim (warranty_claims.status, migration 0048): opened by Client Services, its prepaid label
 * sent, the piece received by ORBES, decided, done; or cancelled before any decision.
 */
export const WARRANTY_CLAIM_STATUSES = ['OPEN', 'LABEL_SENT', 'RECEIVED', 'DECIDED', 'DONE', 'CANCELLED'] as const;
export type WarrantyClaimStatus = (typeof WARRANTY_CLAIM_STATUSES)[number];

/** A claim still under way, at most one per piece (`warranty_claims_open_once`'s predicate, migration 0048). */
export const WARRANTY_CLAIM_LIVE_STATUSES: readonly WarrantyClaimStatus[] = Object.freeze(['OPEN', 'LABEL_SENT', 'RECEIVED', 'DECIDED']);

/**
 * A warranty claim's outcome (warranty_claims.outcome, migration 0048): the same piece, new; a credit of its value (the
 * model no longer made); a part credit (THE PROGRAM's percent, after the free replacement); a repair; a price reduction
 * or a refund (the legal guarantee); or a refusal with its reason.
 */
export const WARRANTY_CLAIM_OUTCOMES = ['REPLACEMENT', 'VALUE_CREDIT', 'PART_CREDIT', 'REPAIR', 'PRICE_REDUCTION', 'REFUND', 'REFUSED'] as const;
export type WarrantyClaimOutcome = (typeof WARRANTY_CLAIM_OUTCOMES)[number];

/**
 * Why a warranty claim is refused (warranty_claims.refusal_reason, migration 0048): the exclusions of the lifetime
 * warranty (lost, theft reported, scratched, damaged on purpose or by someone else, altered or repaired outside ORBES),
 * no fault found, the warranty ended (2 years) or void.
 */
export const WARRANTY_CLAIM_REFUSALS = [
  'LOST', 'THEFT_REPORTED', 'SCRATCHED', 'DAMAGED_ON_PURPOSE', 'DAMAGED_BY_SOMEONE_ELSE', 'ALTERED_OUTSIDE_ORBES', 'NO_FAULT_FOUND', 'WARRANTY_ENDED', 'WARRANTY_VOID',
] as const;
export type WarrantyClaimRefusal = (typeof WARRANTY_CLAIM_REFUSALS)[number];

/**
 * Each basis's outcomes (`warranty_claims_basis_outcome`, answer 10 and D1), in WARRANTY_CLAIM_OUTCOMES' order: the
 * lifetime warranty a replacement or a credit, never a repair; the 2-year warranty a repair or a replacement, never a
 * credit; the legal guarantee its remedies, never a credit.
 */
export const WARRANTY_CLAIM_OUTCOMES_BY_BASIS: Readonly<Record<WarrantyClaimBasis, readonly WarrantyClaimOutcome[]>> = Object.freeze({
  LIFETIME: Object.freeze(['REPLACEMENT', 'VALUE_CREDIT', 'PART_CREDIT', 'REFUSED'] as const),
  TWO_YEARS: Object.freeze(['REPLACEMENT', 'REPAIR', 'REFUSED'] as const),
  LEGAL: Object.freeze(['REPLACEMENT', 'REPAIR', 'PRICE_REDUCTION', 'REFUND', 'REFUSED'] as const),
});

/**
 * Each basis's refusal reasons (`warranty_claims_basis_refusal`), in WARRANTY_CLAIM_REFUSALS' order: the lifetime
 * warranty never ends; the 2-year warranty covers manufacturing defects only (no accident exclusion applies to it); the
 * ORBES warranty's exclusions never defeat a conformity claim (the lawyer confirms the list).
 */
export const WARRANTY_CLAIM_REFUSALS_BY_BASIS: Readonly<Record<WarrantyClaimBasis, readonly WarrantyClaimRefusal[]>> = Object.freeze({
  LIFETIME: Object.freeze(['LOST', 'THEFT_REPORTED', 'SCRATCHED', 'DAMAGED_ON_PURPOSE', 'DAMAGED_BY_SOMEONE_ELSE', 'ALTERED_OUTSIDE_ORBES', 'NO_FAULT_FOUND', 'WARRANTY_VOID'] as const),
  TWO_YEARS: Object.freeze(['LOST', 'THEFT_REPORTED', 'NO_FAULT_FOUND', 'WARRANTY_ENDED', 'WARRANTY_VOID'] as const),
  LEGAL: Object.freeze(['DAMAGED_ON_PURPOSE', 'DAMAGED_BY_SOMEONE_ELSE', 'NO_FAULT_FOUND'] as const),
});

/**
 * What THE HOUSE'S GUARANTEE covers (house_guarantees.scope, migration 0029, IN-01): a chosen release, the next release of
 * a model (a main model's covers its variants), or the next release of a collection.
 */
export const GUARANTEE_SCOPES = ['RELEASE', 'MODEL', 'COLLECTION'] as const;
export type GuaranteeScope = (typeof GUARANTEE_SCOPES)[number];

/**
 * A guarantee as stored (house_guarantees.status): ACTIVE (waiting, set aside or entered: computed, never stored), USED
 * at the draw, a direct reservation or a LIVE turn, EXPIRED with its release, REVOKED by Client Services.
 */
export const GUARANTEE_STATUSES = ['ACTIVE', 'USED', 'EXPIRED', 'REVOKED'] as const;
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number];

/** Why a guarantee closed (house_guarantees.closed_reason): used, its release ended or cancelled, revoked. */
export const GUARANTEE_CLOSED_REASONS = ['USED', 'RELEASE_ENDED', 'RELEASE_CANCELLED', 'REVOKED'] as const;
export type GuaranteeClosedReason = (typeof GUARANTEE_CLOSED_REASONS)[number];

/**
 * The sizes a collector saves in YOUR SIZES (account_sizes.kind, migration 0030, AC-01), and which of them preselects a
 * model's size (models.size_kind): a ring size, a bracelet size, a wrist (for watches) and a necklace length.
 */
export const SIZE_KINDS = ['RING', 'BRACELET', 'WRIST', 'NECKLACE'] as const;
export type SizeKind = (typeof SIZE_KINDS)[number];

/**
 * A model's size type (models.size_type, migration 0033, plan NEXT LOT §3.3): what its sizes are ticked from in the
 * Catalogue (services/sizes.ts standardSizes): ring sizes, bracelet sizes, necklace lengths, or a single SKU (WATCH,
 * ONE_SIZE). NULL: 'To give'.
 */
export const SIZE_TYPES = ['RING', 'BRACELET', 'NECKLACE', 'WATCH', 'ONE_SIZE'] as const;
export type SizeType = (typeof SIZE_TYPES)[number];

/**
 * A new claim code (claim_code_renewals.kind, migration 0034, plan NEXT LOT §3.4): shown once to STAFF (a piece with no
 * buyer), sealed for the BUYER of the piece's open order, or UNSHOWN (made when that order was cancelled, seen by no one).
 */
export const CLAIM_RENEWAL_KINDS = ['STAFF', 'BUYER', 'UNSHOWN'] as const;
export type ClaimRenewalKind = (typeof CLAIM_RENEWAL_KINDS)[number];

/** Where a new claim code stands (claim_code_renewals.status): STAFF is SHOWN, UNSHOWN is UNSHOWN, BUYER WAITING → READ or WITHDRAWN. */
export const CLAIM_RENEWAL_STATUSES = ['SHOWN', 'UNSHOWN', 'WAITING', 'READ', 'WITHDRAWN'] as const;
export type ClaimRenewalStatus = (typeof CLAIM_RENEWAL_STATUSES)[number];

/**
 * Why a buyer's new claim code was withdrawn (claim_code_renewals.withdrawn_reason): a newer code, its order cancelled or
 * returned, the piece registered, a key that no longer opens it, the piece's code changed by another path.
 */
export const CLAIM_RENEWAL_WITHDRAWN_REASONS = ['RENEWED_AGAIN', 'ORDER_CANCELLED', 'ORDER_RETURNED', 'REGISTERED', 'UNREADABLE', 'SUPERSEDED'] as const;
export type ClaimRenewalWithdrawnReason = (typeof CLAIM_RENEWAL_WITHDRAWN_REASONS)[number];

/**
 * A supplier order (supplier_orders.status, migration 0036, plan NEXT LOT §3.5): DRAFT → SENT → EXPECTED (the supplier
 * confirmed it, optional) → PARTLY_RECEIVED → RECEIVED; CANCELLED when the rest is cancelled with nothing accepted.
 */
export const SUPPLIER_ORDER_STATUSES = ['DRAFT', 'SENT', 'EXPECTED', 'PARTLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUSES)[number];

/** A reception (receptions.status, migration 0036): counted, waiting for ORBES; sent back to be counted again; confirmed. */
export const RECEPTION_STATUSES = ['TO_CONFIRM', 'SENT_BACK', 'CONFIRMED'] as const;
export type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

/** Why a card's sealed claim code was erased (card_prints.erased_reason, migration 0036). */
export const CARD_ERASED_REASONS = ['ATTACHED', 'REPLACED', 'REGISTERED', 'UNREADABLE'] as const;
export type CardErasedReason = (typeof CARD_ERASED_REASONS)[number];

/** Rejected pieces of a reception (supplier_returns.status, migration 0036): to send back, then sent back. */
export const SUPPLIER_RETURN_STATUSES = ['TO_RETURN', 'RETURNED'] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

/** The supplier's answer to pieces sent back (supplier_returns.settlement, migration 0036): new pieces, or a credit. */
export const SUPPLIER_RETURN_SETTLEMENTS = ['REPLACEMENT', 'CREDIT'] as const;
export type SupplierReturnSettlement = (typeof SUPPLIER_RETURN_SETTLEMENTS)[number];

/** A count proposed by the agent (stock_corrections.status, migration 0036): until ORBES approves or declines it. */
export const STOCK_CORRECTION_STATUSES = ['TO_APPROVE', 'APPROVED', 'DECLINED'] as const;
export type StockCorrectionStatus = (typeof STOCK_CORRECTION_STATUSES)[number];

/** Why a credit taken off an order was given back (credit_uses.released_reason, migration 0027): removed, the order cancelled or returned. */
export const CREDIT_RELEASE_REASONS = ['REMOVED', 'CANCELLED', 'RETURNED'] as const;
export type CreditReleaseReason = (typeof CREDIT_RELEASE_REASONS)[number];

/**
 * A run of test entrants (test_runs.status, migration 0024_z): RUNNING (its bots acting) → DONE (every bot has acted)
 * → ENDED (END TEST, its clean-up done); STOPPED by STOP, INTERRUPTED by a restart while it ran. Only RUNNING blocks a
 * new test.
 */
export const TEST_RUN_STATUSES = ['RUNNING', 'DONE', 'STOPPED', 'INTERRUPTED', 'ENDED'] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

/** The image types media_objects stores (migration 0012): the console uploads JPEG or WebP only (F-04). */
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/webp'] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

/** Where the customer saw or bought the piece of a reported scan (scan_reports.channel, migration 0004). */
export const REPORT_CHANNELS = ['BOUTIQUE', 'ONLINE', 'PRIVATE', 'OTHER'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** A case of the console's Cases queue (scan_reports.status). */
export const REPORT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * The pace of a LIVE RELEASE (drops.pace_batch and drops.pace_minutes, migration 0049, W4): X buyers admitted every Y
 * minutes, counted across the whole release; X from 1 to 5 000, Y from 1 to 60. Neither: no pace, everyone admitted at T0.
 */
export const LIVE_PACE_BATCH = Object.freeze({ min: 1, max: 5000 } as const);
export const LIVE_PACE_MINUTES = Object.freeze({ min: 1, max: 60 } as const);
/**
 * ONE QUEUE (drops.pace_hold_minutes, migration 0058, lot Q1): the hold after the opening, in minutes, 0 to 120; 0, no
 * hold. Everyone waits it, guarantees included, before the first batch; only with a pace.
 */
export const LIVE_HOLD_MINUTES = Object.freeze({ min: 0, max: 120 } as const);

/** A pre-registration's first name, in characters (preregistrations.first_name, migration 0050, F2): 1 to 80. */
export const FOUNDING_FIRST_NAME_MAX = 80;

/**
 * The emails (email_templates.kind, email_outbox.kind, migration 0051, macro scope E0; lot M1 plan §4.2), each with its
 * own switch, off by default: E1 the founding announcement, E2 the new release notice (opt-in), E3 the password reset,
 * E4 the platform order's confirmation (PAID), shipping and delivery, and E5's five: the order cancelled, a draw's place
 * drawn, a place offered from the waiting list, a warranty claim's label and a PRIVATE CARE label. House messages (E6)
 * stay in the app: no kind.
 */
export const EMAIL_KINDS = [
  'FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE', 'PASSWORD_RESET', 'ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'DRAW_SELECTED',
  'DRAW_OFFERED', 'WARRANTY_LABEL', 'CARE_LABEL',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** An email in the outbox (email_outbox.status, migration 0051): to send, sent, given up after its retries, or cancelled. */
export const EMAIL_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** How a recovery code was issued (account_recovery_codes.issued_via, migration 0051, E3): by Client Services, or by email. */
export const RECOVERY_ISSUED_VIA = ['STAFF', 'EMAIL'] as const;
export type RecoveryIssuedVia = (typeof RECOVERY_ISSUED_VIA)[number];

/** An email's words, in characters (migration 0051): a template's subject and body, an outbox row's subject, key and last error. */
export const EMAIL_TEMPLATE_SUBJECT_MAX = 150;
export const EMAIL_TEMPLATE_BODY_MAX = 5000;
export const EMAIL_SUBJECT_MAX = 300;
export const EMAIL_DEDUPE_MAX = 200;
export const EMAIL_ERROR_MAX = 300;

/**
 * The automatic house messages (house_moment_settings.moment, house_deliveries.moment, migration 0052, macro scope D24
 * M1; lot M2 plan §1.2), each with its own switch, off by default: a) the day after a first registration, b) the
 * birthday credit opened, c) a credit ending in 7 days, d) PRIVATE CARE becoming available, e) one year of ownership of
 * a piece, f) 90 days without a visit.
 */
export const HOUSE_MOMENTS = ['FIRST_REGISTRATION', 'BIRTHDAY_CREDIT', 'CREDIT_EXPIRING', 'PRIVATE_CARE', 'OWNERSHIP_YEAR', 'NINETY_DAYS'] as const;
export type HouseMoment = (typeof HOUSE_MOMENTS)[number];

/** A custom house message (house_messages.status, migration 0052, M2): written, scheduled, sent (then never changed) or cancelled. */
export const HOUSE_MESSAGE_STATUSES = ['DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED'] as const;
export type HouseMessageStatus = (typeof HOUSE_MESSAGE_STATUSES)[number];

/** Where a house delivery comes from (house_deliveries.source, migration 0052): a moment (its words rendered) or a custom message. */
export const HOUSE_DELIVERY_SOURCES = ['MOMENT', 'CUSTOM'] as const;
export type HouseDeliverySource = (typeof HOUSE_DELIVERY_SOURCES)[number];

/**
 * House messages' words, in characters (migration 0052): the title (one line) and words the console writes, a moment's or
 * a custom message's; an audience's name written at sending; a moment's title and words as delivered, placeholders
 * rendered (a model's name in {piece} has no bound of its own, so the service clips its rendering to these); a key.
 */
export const HOUSE_TITLE_MAX = 80;
export const HOUSE_BODY_MAX = 2000;
export const HOUSE_AUDIENCE_LABEL_MAX = 80;
export const HOUSE_DELIVERED_TITLE_MAX = 400;
export const HOUSE_DELIVERED_BODY_MAX = 8000;
export const HOUSE_DEDUPE_MAX = 200;

/**
 * A WORN photograph (worn_photos.status, migration 0053, macro scope D31 G1 and G2; lot M2 plan §2.1): in review, published
 * on the model's sheet, refused by staff, withdrawn by its owner, taken down by staff, or ended when its piece left its
 * owner. Only PENDING and PUBLISHED keep the photograph's bytes; at most one of them per piece.
 */
export const WORN_STATUSES = ['PENDING', 'PUBLISHED', 'REFUSED', 'WITHDRAWN', 'TAKEN_DOWN', 'ENDED'] as const;
export type WornStatus = (typeof WORN_STATUSES)[number];

/** The statuses in which a WORN photograph is live (its bytes kept; `worn_photos_live_once`: one per piece). */
export const WORN_LIVE_STATUSES = ['PENDING', 'PUBLISHED'] as const satisfies readonly WornStatus[];

/**
 * Why staff refuse or take down a WORN photograph (worn_photos.refusal, migration 0053, G2), shown to its owner in words:
 * the piece not clearly visible, the photograph not sharp enough, a photograph that cannot be shown in WORN.
 */
export const WORN_REFUSALS = ['PIECE_NOT_VISIBLE', 'QUALITY', 'NOT_SUITABLE'] as const;
export type WornRefusal = (typeof WORN_REFUSALS)[number];

/**
 * A WORN photograph's bounds (migration 0053, G1), as media/image.ts sanitizes every image: its bytes and sides, at most;
 * the credit's first name, at most, as account_profiles.first_name holds it (migration 0040).
 */
export const WORN_PHOTO_MAX_BYTES = 1_048_576;
export const WORN_PHOTO_MAX_SIDE = 4096;
export const WORN_CREDIT_FIRST_NAME_MAX = 50;

/**
 * Standard boxes and packed weights (migration 0054, macro scope D16 B1 and B2; lot M3 plan §1.1): a box's name and inside
 * sides, its empty weight and cost, at most; a model's packed weight (the piece as it is packed, with its pouch and card,
 * without the box), a parcel's weight and what its unknown weight lists, at most.
 */
export const BOX_NAME_MAX = 60;
export const BOX_INSIDE_MM_MAX = 2000;
export const BOX_EMPTY_WEIGHT_G_MAX = 30_000;
export const BOX_COST_MINOR_MAX = 100_000_000;
export const PACKED_WEIGHT_G_MAX = 30_000;
export const SHIPMENT_WEIGHT_G_MAX = 100_000;
export const SHIPMENT_WEIGHT_MISSING_MAX = 64;

/**
 * The certificate card 79t, flat (render/certificate.ts CERTIFICATE_CARD, 95 × 62 mm): every box takes it, its longer
 * inside side at least `long` and its shorter at least `short` (`boxes_card_fits`, migration 0054, B1).
 */
export const CERTIFICATE_CARD_MM = Object.freeze({ long: 95, short: 62 });

/**
 * Add-ons (migration 0056, macro scope K48 D1 and D2; lot M3 plan §4.2): an add-on's name and line, weight, position and
 * price, at most; the units of one add-on chosen or on one order, at most (3).
 */
export const ADDON_NAME_MAX = 40;
export const ADDON_LINE_MAX = 120;
export const ADDON_WEIGHT_G_MAX = 30_000;
export const ADDON_POSITION_MAX = 10_000;
export const ADDON_PRICE_MINOR_MAX = 100_000_000;
export const ADDON_UNITS_MAX = 3;
/**
 * ADD-ONS ONE SYSTEM (migration 0059, lot Q2): an add-on is a PRODUCT (real stock, 0056's) or a SERVICE (no stock count,
 * no supplier, no warehouse: engraving, gift wrapping), fixed at its creation.
 */
export const ADDON_KINDS = ['PRODUCT', 'SERVICE'] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];
/** A release's pick of add-ons (drop_addons.position, migration 0059): positions 1 to 100, no other cap. */
export const ADDON_PICK_POSITION_MAX = 100;
/**
 * The engraving's most characters (addon_items.text_max, migration 0059): 1 to 20; 20, the house's
 * ENGRAVING_COLLECTOR_MAX, is its ceiling and its default.
 */
export const ADDON_TEXT_MAX = Object.freeze({ min: 1, max: 20 } as const);
/** The engraving's words chosen before the order (addon_choices.text, migration 0059), at most, as orders.engraving_text. */
export const ADDON_CHOICE_TEXT_MAX = 120;
/**
 * What a catalogue add-on was converted from (addon_conversions.source, migration 0060, lot Q2): a LIVE release's own
 * add-on (`live_addons`, 0021) or Orders → Settings' engraving price (`engraving_prices`, 0039).
 */
export const ADDON_CONVERSION_SOURCES = ['LIVE_ADDON', 'ENGRAVING_PRICES'] as const;
export type AddonConversionSource = (typeof ADDON_CONVERSION_SOURCES)[number];
/**
 * A unit of an add-on on an order (order_addon_items.status, migration 0056): HELD (in stock at its location) →
 * SHIPPED → RETURNED, or REMOVED (taken off before packing) or CANCELLED (with its order).
 */
export const ORDER_ADDON_STATUSES = ['HELD', 'SHIPPED', 'REMOVED', 'CANCELLED', 'RETURNED'] as const;
export type OrderAddonStatus = (typeof ORDER_ADDON_STATUSES)[number];
/** Who added a unit (order_addon_items.added_by_type): at the PURCHASE (from the choice), the COLLECTOR in YOUR ORDERS, or STAFF. */
export const ORDER_ADDON_ADDED_BY = ['PURCHASE', 'COLLECTOR', 'STAFF'] as const;
export type OrderAddonAddedBy = (typeof ORDER_ADDON_ADDED_BY)[number];
/** What a hold of `stock_holds` is (migration 0056): an order's piece, or an add-on's unit. */
export const STOCK_HOLD_KINDS = ['PIECE', 'ADD_ON'] as const;

/**
 * THE SET (migration 0057, macro scope K44 T1 to T4; lot M3 plan §5.2): a set's name, at most, and its code (its
 * reference and future Shopify handle); its pieces, 2 to 4 distinct models (`set_models.position` 1..4); its base price
 * and a set sale's price, at most; a release's sizes, at most 24 per piece, so 96 on a set's (`drop_sizes.position`).
 */
export const SET_NAME_MAX = 60;
export const SET_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;
export const SET_PIECES_MIN = 2;
export const SET_PIECES_MAX = 4;
export const SET_PRICE_MINOR_MAX = 100_000_000;
export const DROP_SIZE_POSITION_MAX = 96;
/**
 * An order's piece, at most (`orders.piece`, migration 0057; 5 before): a set sale's orders of a LIVE entry are numbered
 * across its sets (T4: up to LIVE_PER_ACCOUNT.max sets of up to SET_PIECES_MAX pieces); every other order's stays 1..5.
 */
export const ORDER_PIECE_MAX = 20;
export type StockHoldKind = (typeof STOCK_HOLD_KINDS)[number];

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
  /**
   * Migration 0024 (plan NOCTURNE, N1): the main model of a variant, or NULL. Never chained (a variant's main model is
   * never a variant; a model with variants never becomes one), never its own.
   */
  variant_of: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0024: its name among its model's dots (« Steel »), 1..40 characters; required on a variant and on a model with variants; unique within them. */
  variant_label: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0024: the dot's colour, `#RRGGBB` in capitals, with its label (both or neither). */
  variant_swatch: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0030 (AC-01): which saved size of a collector preselects its size; NULL: none, or on a variant its main model's. */
  size_kind: ColumnType<SizeKind | null, SizeKind | null | undefined, SizeKind | null>;
  /**
   * Migration 0033 (plan NEXT LOT §3.3): its size type; NULL: 'To give' (its sizes work as before until it has one).
   * Once given, `size_kind` is derived from it (`models_size_type_kind`: WATCH the wrist, ONE_SIZE none).
   */
  size_type: ColumnType<SizeType | null, SizeType | null | undefined, SizeType | null>;
  /**
   * Migration 0035 (plan NEXT LOT §3.5): the supplier that makes its pieces (suppliers.id); NULL: none, or on a variant
   * its main model's. A size may name its own (skus.supplier_id).
   */
  supplier_id: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 0048 (plan ORBES CARE, answer 12): its warranty, LIFETIME (true) or 2 years (false: manufacturing defects
   * only, for its category's `warranty_months`). The column's default is false (a model written by plain SQL); the
   * service's default for a new model is Lifetime. Every model of before was backfilled true.
   */
  warranty_lifetime: WithDefault<boolean>;
  /**
   * Migration 0054 (macro scope D16 B1): the box its pieces are packed in (boxes.id); NULL: none, or on a variant its
   * main model's.
   */
  box_id: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 0054 (B2): the piece as it is packed, with its pouch and card, without the box, 1..30 000 g; NULL: unknown,
   * or on a variant its main model's.
   */
  packed_weight_g: ColumnType<number | null, number | null | undefined, number | null>;
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
  /**
   * Migration 0012: the photograph of this piece (media_objects.sha256), taken at issuance. Since plan NOCTURNE
   * (decision 9) the console's only: kept for staff, never shown nor sent to a collector.
   */
  photo_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0022: its SKU (skus.id, of its model); NULL until linked. */
  sku_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0036 (plan NEXT LOT §3.5): the reception line that issued it (reception_lines.id); NULL otherwise. */
  reception_line_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0036: when it first entered the stock (a reception, or its PRODUCED movement, backfilled); never cleared. */
  stock_entered_at: TimestampNullable;
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
  /** The Shopify customer it will be, matched by email once the store exists (migration 0022, N3; decimal, unique). */
  shopify_customer_id: string | null;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * A one-time recovery code issued by an ADMIN of ORBES Client Services (migration 0005): scrypt hash only,
 * 30 minutes, used once; one open (neither used nor revoked) per account. From migration 0051 (E3) a code may also be
 * sent by email at the collector's request: `issued_via` EMAIL, by no one (`created_by` NULL exactly then).
 */
export interface AccountRecoveryCodesTable {
  id: Generated<string>;
  account_id: string;
  code_hash: string;                   // scrypt$15$8$1$<salt>$<hash> of the canonical 12-character code
  created_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id; NULL exactly when sent by email
  issued_via: WithDefault<RecoveryIssuedVia>; // STAFF (DEFAULT) or EMAIL
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
  /**
   * Migration 0048 (plan ORBES CARE, answer 12): the piece's warranty kind, copied from its model, following a later
   * change of it; a lifetime warranty has no end date (`warranties_lifetime_open`), its `duration_months` kept. Never NULL
   * once written; optional on insert: the trigger `warranties_kind` copies the model's choice into a row inserted
   * without it, and clears the end date of a lifetime row.
   */
  lifetime: ColumnType<boolean, boolean | undefined, boolean>;
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
  /**
   * The model the release sells; since migration 0057 (THE SET, T1) NULL on a set's release, which names its set instead
   * (`drops_one_offer`: exactly one of the two).
   */
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0057 (T1): the set the release sells (sets.id), or NULL on a model's; a set's release is never an after-room. */
  set_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  /**
   * Migration 0026 (BP-19 T3): PLATINE's early access, 0..336 hours, never longer than `early_access_hours`, which is
   * then PALLADIUM's; NULL: from the same time as PALLADIUM (every drop published before). NULL on a LIVE RELEASE.
   */
  early_access_platine_hours: ColumnType<number | null, number | null | undefined, number | null>;
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
  /** Migration 0021: DRAW (the default) or LIVE. The columns below are required for LIVE and NULL for DRAW, but where said (a draw's price, 0024). */
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
  /**
   * The price of a piece in minor units (cents), ≥ 0. Migration 0024 (plan NOCTURNE, addition 5): a DRAW may carry one
   * too, with its currency (both or neither), which the orders of its entries take.
   */
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
  /**
   * Migration 0023, LIVE only (NULL for a DRAW). An after-room (A3): the release it follows, one per release; a DRAFT
   * until the parent's sell-out, then published for the guests remembered at it, or cancelled.
   */
  parent_drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** An after-room's: opens 1..60 minutes after the parent's sell-out (10 by default), open 5..120 minutes (15). */
  after_room_delay_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  after_room_length_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  /** A4: one surprise in every box, its description internal (1..500 characters, required once enabled); false for an after-room. */
  surprise_enabled: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  surprise_text: ColumnType<string | null, string | null | undefined, string | null>;
  /** A5: the releases (1..100) a collector has taken part in to enter. */
  min_participations: ColumnType<number | null, number | null | undefined, number | null>;
  /** N5: the segment whose members may enter (segments.id); from migration 0050 (F4) a DRAW's too, never an after-room's. */
  access_segment_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** How every access rule of the release combines; NULL: AND. */
  access_combine: ColumnType<AccessCombine | null, AccessCombine | null | undefined, AccessCombine | null>;
  /** G4: the question after; its text (1..120 characters) and answers (2..6) both or neither (neither: the default); false for an after-room. */
  question_enabled: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  question_text: ColumnType<string | null, string | null | undefined, string | null>;
  question_answers: ColumnType<string[] | null, string[] | null | undefined, string[] | null>;
  /**
   * Migration 0049 (W4), LIVE only and never on an after-room: the pace, X buyers admitted every Y minutes
   * (LIVE_PACE_BATCH, LIVE_PACE_MINUTES), both or neither; neither, no pace (everyone admitted at T0).
   */
  pace_batch: ColumnType<number | null, number | null | undefined, number | null>;
  pace_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  /** The pace's own pause in progress since then (the release's PAUSE holds it too); only with a pace. */
  pace_paused_at: TimestampNullable;
  /** When the next batch is due; only with a pace. */
  pace_next_at: TimestampNullable;
  /** The batches admitted so far (int ≥ 0, NOT NULL DEFAULT 0); above 0 only with a pace. */
  pace_batches: WithDefault<number>;
  /**
   * Migration 0058 (ONE QUEUE, lot Q1): the hold after the opening, in minutes (LIVE_HOLD_MINUTES, smallint NOT NULL
   * DEFAULT 0; 0, no hold); above 0 only with a pace.
   */
  pace_hold_minutes: WithDefault<number>;
  /**
   * Migration 0058 (ONE QUEUE, lot Q1, step Q1.2): the batches of `pace_batches` given by NEXT BATCH NOW (int NOT NULL
   * DEFAULT 0, 0 to `pace_batches`); the hold lasts while every batch given is one of them.
   */
  pace_extra_batches: WithDefault<number>;
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
  /** Migration 0029 (IN-01): the house's guarantee this entry uses, once each; a guaranteed entry is never ranked nor tiered. */
  guarantee_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0029: the pieces of its place, 1..5; above 1 only with a guarantee. */
  pieces: WithDefault<number>;
  /**
   * Migration 0038 (plan NEXT LOT §3.6.F): the size the entry chose, a drop_sizes row of the same drop; NULL in a draw
   * without sizes (one published before this lot keeps one pool). The service requires one in a draw that has sizes.
   */
  size_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  /** Migration 0023 (N5): shown to a segment's members only (segments.id); null: to the tier. */
  segment_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0026 (BP-19 T7): what an INVITATION is (the members' evening, a launch preview, a partner experience); null otherwise. */
  experience: ColumnType<CircleExperience | null, CircleExperience | null | undefined, CircleExperience | null>;
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
  /** Migration 0030 (AC-01): the size asked with REQUEST THIS PIECE, one of the model's (1..100 characters); NULL: not sure yet, or one size. Never changes. */
  size_label: ColumnType<string | null, string | null | undefined, never>;
}

/**
 * A size of a LIVE RELEASE (migration 0021), and since 0038 of a DRAW (plan NEXT LOT §3.6.F): 1 to 24 per drop
 * (`position`), a `label` of 1..12 characters unique per drop, its `stock` (≥ 0; a draw's size: its pieces). The
 * release's quantity is the sum of its stock. id and drop_id never change. Since 0057 (THE SET, T1) a set's release
 * gives its sizes per piece (`piece`, 1..24 each, positions 1..96), a label once per piece; id, drop_id and piece never
 * change.
 */
export interface DropSizesTable {
  id: Generated<string>;
  drop_id: string;
  /** Migration 0057: the set's piece (set_models.position, 1..4) on a set's release; NULL on a model's. */
  piece: ColumnType<number | null, number | null | undefined, number | null>;
  label: string;
  position: number;                    // smallint 1..96 (1..24 per piece)
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
  /** Migration 0029 (IN-01): the house's guarantee this entry uses (first in line in its size), once each. */
  guarantee_id: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 0049 (W4): admitted to take a turn, at its batch's logical time (or its place's time with no pace), with
   * its batch (int ≥ 0: 0 with no pace, or by LET IN before the first batch); both or neither, only with a place.
   */
  admitted_at: TimestampNullable;
  admitted_batch: ColumnType<number | null, number | null | undefined, number | null>;
}

/** The models whose owners may enter a LIVE RELEASE (migration 0021). */
export interface LiveAccessModelsTable {
  drop_id: string;
  model_id: string;
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
  /**
   * Migration 0035 (plan NEXT LOT §3.5): its postal address, 1..500 characters, trimmed, line breaks kept (a supplier
   * order's « Deliver to », a return address); NULL: none yet.
   */
  address: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * The locations a LOGISTICS login works at (migration 0035, plan NEXT LOT §3.5.6.1): one row per login and location,
 * only for LOGISTICS logins (services/auth.ts keeps the rule: at least one, deleted when the role changes away).
 */
export interface AdminUserLocationsTable {
  admin_user_id: string;
  stock_location_id: string;
  created_at: TimestampDefault;
  /** admin_users.id of the ADMIN who tied it; NULL for the shell. */
  created_by: string | null;
}

/**
 * A country a location serves (migration 0055, macro scope K11 Z1; lot M3 plan §3.2): when staff order a model by size, a
 * collector counts at the location that serves their country (their default address's, else their profile's); a country
 * no location serves counts at the default location. One location per country at most (`country`, ISO 3166-1 alpha-2,
 * is the key); a country moved changes its location, never itself. updated_at is stamped on every update.
 */
export interface StockLocationCountriesTable {
  country: ColumnType<string, string, never>; // ^[A-Z]{2}$
  location_id: string; // stock_locations.id
  /** admin_users.id of the ADMIN who set it last; NULL for a script. */
  updated_by: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: TimestampDefault;
}

/**
 * A supplier ORBES orders its pieces from (migration 0035, plan NEXT LOT §3.5): its name (1..120, unique whatever the
 * case), its contact, the currency it bills in, a note, `active` (an inactive supplier stays on its orders and is
 * offered for no new draft). Never deleted. id, created_at and created_by never change.
 */
export interface SuppliersTable {
  id: Generated<string>;
  name: string;
  contact_name: ColumnType<string | null, string | null | undefined, string | null>;   // ≤ 120
  email: ColumnType<string | null, string | null | undefined, string | null>;          // ≤ 254
  phone: ColumnType<string | null, string | null | undefined, string | null>;          // ≤ 40
  address: ColumnType<string | null, string | null | undefined, string | null>;        // ≤ 500, line breaks kept
  /** An ISO 4217 code (^[A-Z]{3}$); the service accepts only those with two decimals. */
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>;           // ≤ 1 000
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
  created_by: ColumnType<string | null, string | null | undefined, never>;
}

type NullableText = ColumnType<string | null, string | null | undefined, string | null>;
type NullableAdmin = ColumnType<string | null, string | null | undefined, string | null>;

/**
 * A supplier order (migration 0036, plan NEXT LOT §3.5.5.2): what ORBES orders from a supplier, delivered to a location.
 * Each status with its times (the `supplier_orders_*` CHECKs); its reference `SO-` + the id's first eight hex figures.
 * id, supplier_id, location_id, created_at and created_by never change.
 */
export interface SupplierOrdersTable {
  id: Generated<string>;
  supplier_id: string;
  location_id: string;
  status: WithDefault<SupplierOrderStatus>;
  /** Three capitals; required once SENT. */
  currency: NullableText;
  /** Hundredths, 0..100 000 000; NULL: no shipping cost. */
  shipping_minor: ColumnType<number | null, number | null | undefined, number | null>;
  /** 'YYYY-MM-DD'; required once SENT. */
  expected_on: DateNullable;
  note: NullableText;
  sent_at: TimestampNullable;
  sent_by: NullableAdmin;
  supplier_confirmed_at: TimestampNullable;
  supplier_confirmed_by: NullableAdmin;
  received_at: TimestampNullable;
  rest_cancelled_at: TimestampNullable;
  rest_cancelled_by: NullableAdmin;
  rest_cancelled_note: NullableText;
  /** The supplier's invoice: number, amount and date, all three or none. */
  invoice_number: NullableText;
  invoice_minor: ColumnType<number | null, number | null | undefined, number | null>;
  invoice_date: DateNullable;
  invoice_paid_at: TimestampNullable;
  invoice_paid_by: NullableAdmin;
  created_at: TimestampDefault;
  created_by: ColumnType<string | null, string | null | undefined, never>;
  updated_at: TimestampDefault;
}

/** A line of a supplier order (migration 0036): a SKU once per order, its quantity and price, and what came of it. */
export interface SupplierOrderLinesTable {
  id: Generated<string>;
  supplier_order_id: string;
  sku_id: string;
  quantity: number;                    // 1..10 000
  /** Hundredths; NULL until set (required to send). */
  unit_price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  accepted_quantity: WithDefault<number>;
  rejected_quantity: WithDefault<number>;
  credited_quantity: WithDefault<number>;
  rest_cancelled_quantity: WithDefault<number>;
  created_at: TimestampDefault;
}

/** A delivery counted against its supplier order (migration 0036): TO_CONFIRM, SENT_BACK, CONFIRMED; one open per order. */
export interface ReceptionsTable {
  id: Generated<string>;
  supplier_order_id: string;
  location_id: string;
  status: WithDefault<ReceptionStatus>;
  delivery_note: NullableText;         // ≤ 60
  note: NullableText;                  // ≤ 1 000
  counted_at: TimestampDefault;
  counted_by: NullableAdmin;
  sent_back_at: TimestampNullable;
  sent_back_by: NullableAdmin;
  sent_back_note: NullableText;
  confirmed_at: TimestampNullable;
  confirmed_by: NullableAdmin;
  /** Every identity of the reception issued. */
  issued_at: TimestampNullable;
  cards_attached_at: TimestampNullable;
  cards_attached_by: NullableAdmin;
  created_at: TimestampDefault;
}

/** A SKU of a reception (migration 0036): pieces accepted and rejected, the identities issued so far, the agent's note. */
export interface ReceptionLinesTable {
  id: Generated<string>;
  reception_id: string;
  sku_id: string;
  /** NULL: a piece not on the supplier order. */
  supplier_order_line_id: ColumnType<string | null, string | null | undefined, never>;
  accepted: WithDefault<number>;
  rejected: WithDefault<number>;
  /** 0..accepted. */
  issued: WithDefault<number>;
  note: NullableText;                  // ≤ 500
}

/** A piece issued by a reception and its claim code, sealed until its card is attached (migration 0036). */
export interface CardPrintsTable {
  product_id: string;
  reception_id: string;
  /** AES-256-GCM, HKDF info 'orbes/card-claim-codes/v1', AAD 'card:<product id>'; NULL exactly once erased. */
  sealed_claim_code: NullableText;
  printed_count: WithDefault<number>;
  last_printed_at: TimestampNullable;
  erased_at: TimestampNullable;
  erased_reason: ColumnType<CardErasedReason | null, CardErasedReason | null | undefined, CardErasedReason | null>;
}

/** Rejected pieces of a reception, sent back to their supplier, and its answer (migration 0036). */
export interface SupplierReturnsTable {
  id: Generated<string>;
  supplier_order_id: string;
  reception_id: string;
  sku_id: string;
  quantity: number;                    // 1..10 000
  status: WithDefault<SupplierReturnStatus>;
  returned_at: TimestampNullable;
  returned_by: NullableAdmin;
  carrier_id: NullableText;
  tracking_number: NullableText;
  settlement: ColumnType<SupplierReturnSettlement | null, SupplierReturnSettlement | null | undefined, SupplierReturnSettlement | null>;
  /** Hundredths, with a CREDIT only. */
  credit_minor: ColumnType<number | null, number | null | undefined, number | null>;
  settled_at: TimestampNullable;
  settled_by: NullableAdmin;
  note: NullableText;                  // ≤ 500
  created_at: TimestampDefault;
}

/** A count proposed by the agent, applied once ORBES approves it (migration 0036). Never deleted. */
export interface StockCorrectionsTable {
  id: Generated<string>;
  sku_id: string;
  location_id: string;
  delta: number;                       // ±1..10 000, never 0
  reason: string;                      // 1..500
  status: WithDefault<StockCorrectionStatus>;
  proposed_by: ColumnType<string | null, string | null | undefined, never>;
  proposed_at: TimestampDefault;
  decided_by: NullableAdmin;
  decided_at: TimestampNullable;
  decision_note: NullableText;         // ≤ 500; required when DECLINED
  /** The ledger's movement, exactly when APPROVED. */
  movement_id: ColumnType<number | null, number | null | undefined, number | null>;
}

/**
 * A model in one size (migration 0022): one per model and size label (NULL: one size), its code and its future Shopify
 * ids. No stock column: the stock is the ledger's (stock_movements). id, model_id, size_label and created_at never change.
 * Since migration 0033 (plan NEXT LOT §3.3) a model's sizes are declared in the Catalogue; removed when unused,
 * otherwise set aside (services/sizes.ts SKU_USES).
 */
export interface SkusTable {
  id: Generated<string>;
  /**
   * The model this SKU is a size of; NULL for an add-on's SKU (migration 0056: exactly one of model_id and addon_id,
   * `skus_owner`). Named by its owner through services/sku-owner.ts (`skuOwnerOf`, `skuRefs`).
   */
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0056 (D1): the add-on this SKU is (addon_items.id, one SKU per add-on); NULL for a model's size. No size, no fit. */
  addon_id: ColumnType<string | null, string | null | undefined, string | null>;
  size_label: string | null;           // 1..100 characters
  code: string;                        // the model's SKU prefix and the size (issuance.ts deriveSku), unique
  shopify_product_id: ColumnType<string | null, string | null | undefined, string | null>;
  shopify_variant_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
  /** Migration 0030 (AC-01): the measures this size fits, in its model's size kind's whole millimetres, both or neither (min ≤ max, 1..1 000); NULL: its label is read. */
  fit_min_mm: ColumnType<number | null, number | null | undefined, number | null>;
  fit_max_mm: ColumnType<number | null, number | null | undefined, number | null>;
  /** Migration 0033: when the size was set aside (no longer offered for new releases, supplier orders or the salon); NULL: offered. */
  set_aside_at: TimestampNullable;
  /** Migration 0033: admin_users.id of who set it aside; NULL for a script, never without set_aside_at (`skus_set_aside`). */
  set_aside_by: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0035 (plan NEXT LOT §3.5): the size's own supplier (suppliers.id), over its model's; NULL: its model's. */
  supplier_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * A size a collector saved in YOUR SIZES (migration 0030, AC-01): one per account and kind, in whole millimetres (the
 * French ring size itself, or centimetres × 10), within its kind's range and step (`account_sizes_value`). A cleared
 * size is a deleted row.
 */
export interface AccountSizesTable {
  account_id: string;
  kind: SizeKind;
  value_mm: number;
  updated_at: TimestampDefault;
}

/**
 * YOUR ADDRESSES (migration 0039, plan NEXT LOT §3.6.B): a collector's saved delivery addresses, at most 5, one of them
 * the default (put on each new order). The collector's own data: a removed address is a deleted row.
 */
export interface AccountAddressesTable {
  id: Generated<string>;
  account_id: string;
  name: string;
  /** The lines as typed, line breaks kept. */
  address: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** With its country code: +33 6 12 34 56 78. */
  phone: string;
  is_default: WithDefault<boolean>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * An answer to « How did you hear about ORBES? » (migration 0040, plan CUSTOMER INTELLIGENCE §3.1 P.3.2), edited by an
 * ADMIN on the console's Sign-up page: never deleted, only set aside (`active` false); exactly one Other, with its text
 * field. Its id and Other mark never change.
 */
export interface HeardOptionsTable {
  id: Generated<string>;
  /** 1 to 40 characters, trimmed, unique whatever the case. */
  label: string;
  is_other: WithDefault<boolean>;
  /** 1 to 100, the order offered; Other last. */
  position: number;
  /** Offered at sign-up and in YOUR PROFILE; false once set aside. */
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * A collector's profile (migration 0040, plan CUSTOMER INTELLIGENCE §3.1 P.3.2): one row per account that has given
 * anything, beside `accounts` (whose `country` stays the profile's country and `display_name` « First Last »). Written by
 * ProfileService only.
 */
export interface AccountProfilesTable {
  account_id: string;
  first_name: ColumnType<string | null, string | null | undefined, string | null>;
  last_name: ColumnType<string | null, string | null | undefined, string | null>;
  /** E.164: + and 7 to 15 digits; with `phone_country`, or neither. */
  phone: ColumnType<string | null, string | null | undefined, string | null>;
  /** The country picked for the phone's code (+1 and +44 are shared). */
  phone_country: ColumnType<string | null, string | null | undefined, string | null>;
  /** 'YYYY-MM-DD', from 1900-01-01; with `birth_date_by` and `birth_date_at`, or none of them. */
  birth_date: DateNullable;
  birth_date_by: ColumnType<ProfileSource | null, ProfileSource | null | undefined, ProfileSource | null>;
  birth_date_at: TimestampNullable;
  /** When the collector entered a date of birth, its one time: written once, never cleared. */
  birth_date_collector_at: TimestampNullable;
  city: ColumnType<string | null, string | null | undefined, string | null>;
  /** The username, lower case, no @. */
  instagram: ColumnType<string | null, string | null | undefined, string | null>;
  heard_option_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Other's words, only with an option. */
  heard_other: ColumnType<string | null, string | null | undefined, string | null>;
  /** When the question was first answered. */
  heard_at: TimestampNullable;
  /** +1 on every save (the 409 PROFILE_CHANGED of two saves at once). */
  version: WithDefault<number>;
  updated_by: WithDefault<ProfileSource>;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * A collector's favourite piece or finish (migration 0040, plan CUSTOMER INTELLIGENCE §3.2 W.3), chosen in YOUR PROFILE
 * from the catalogue: its key (trimmed, single spaces, in capitals) and its label as it read when chosen. An unticked
 * choice is a deleted row.
 */
export interface AccountTastesTable {
  account_id: string;
  kind: TasteKind;
  value_key: string;
  label: string;
  created_at: TimestampDefault;
}

/**
 * A collector's wish (migration 0041, plan CUSTOMER INTELLIGENCE §3.2 W.3): the heart on one model's sheet, that dot (a
 * main model or a variant). Open while `removed_at` is NULL; one open wish per account and model. Never edited but for
 * `removed_at` (set on removal, cleared by the 10-minute re-add); removed rows are purged 13 months later, once their
 * Paris month is counted. Written by WishlistService only.
 */
export interface AccountWishesTable {
  account_id: string;
  model_id: string;
  added_at: TimestampDefault;
  removed_at: TimestampNullable;
}

/**
 * The wishes of one model in one Paris month (migration 0041, plan CUSTOMER INTELLIGENCE §3.2 W.7), counted collectors
 * only, kept for good: what outlives the 13 months of raw rows.
 */
export interface ModelWishMonthsTable {
  /** 'YYYY-MM-DD', the first day of a Paris month. */
  month: string;
  model_id: string;
  /** Wishes added that month. */
  added: number;
  /** Wishes removed that month. */
  removed: number;
  /** Wishes open at the month's last instant. */
  wished_end: number;
  counted_at: TimestampDefault;
}

/** A Paris month the wish summary holds (migration 0041, plan CUSTOMER INTELLIGENCE §3.2 W.7), with or without a row. */
export interface WishMonthsCountedTable {
  /** 'YYYY-MM-DD', the first day of a Paris month. */
  month: string;
  counted_at: TimestampDefault;
}

/**
 * A place from the connection (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6): a country, with or without a city,
 * once each (`geo_places_key`, NULLS NOT DISTINCT). Never deleted. Written by PlaceService.idOf only.
 */
export interface GeoPlacesTable {
  id: Generated<number>;               // integer identity (GENERATED ALWAYS)
  country: string;                     // char(2), ISO 3166-1 alpha-2
  city: string | null;                 // 1..80 characters, trimmed; NULL: the country alone
}

/**
 * A remembered device (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6, §3.0 (b)): one row per `__Host-orbes_device`
 * cookie, by its pseudonym (never the id). Its class, the account last linked (with when, both or neither), its last
 * place, its console mark, its first and last sight. `id`, `device_hash` and `first_seen_at` never change.
 */
export interface TrackingDevicesTable {
  id: Generated<number>;               // integer identity (GENERATED ALWAYS)
  device_hash: string;                 // 43 characters, pseudonymize(IP_HASH_PEPPER, 'device', id), as scan_events.device_hash
  kind: WithDefault<DeviceKind>;
  os: WithDefault<DeviceSystem>;
  browser: WithDefault<DeviceBrowser>;
  opened_in: WithDefault<OpenedIn>;
  /** The app whose built-in browser opened the page; set exactly when opened_in is IN_APP. */
  in_app: ColumnType<InApp | null, InApp | null | undefined, InApp | null>;
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
  linked_at: TimestampNullable;
  last_place_id: ColumnType<number | null, number | null | undefined, number | null>;
  /** Set once a console session is seen on the device: its views are never recorded. */
  staff_at: TimestampNullable;
  first_seen_at: TimestampDefault;
  last_seen_at: TimestampDefault;
  /**
   * Migration 0043 (plan CUSTOMER INTELLIGENCE §3.4 A.6 item 4): the source of the device's first arrival
   * (acquisition_sources.id), set once; NULL while it made none (a device seen only through a scan), read as Direct.
   */
  first_source_id: ColumnType<number | null, number | null | undefined, number | null>;
}

/** Every account a device was linked to (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), kept for good. */
export interface TrackingDeviceAccountsTable {
  device_id: number;
  account_id: string;
  first_via: LinkVia;
  first_linked_at: Timestamp;
  last_linked_at: Timestamp;
  links: WithDefault<number>;          // integer >= 1
}

/**
 * The raw views and scans (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), kept 13 months then folded into
 * collector_view_totals. `page` is a code of VIEW_PAGES (1 = SCAN, with no duration); `subject` a model, a release or a
 * post, and `place_id` a geo_places id, neither with a foreign key (a log).
 */
export interface CollectorViewsTable {
  id: Generated<number>;               // bigint identity (GENERATED ALWAYS)
  at: Timestamp;                       // when the view began (server clock)
  device_id: number;
  account_id: string | null;
  page: number;                        // smallint 1..60, VIEW_PAGES
  subject: string | null;
  seconds: number;                     // smallint 0..10 800; 1 or more but for a SCAN
  place_id: number | null;
}

/**
 * The anonymous daily totals of the views (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), by Paris day, page,
 * subject (the nil uuid: none) and country ('ZZ' unknown), kept for good. Page 0 is the day's marker row, all counts 0.
 */
export interface ViewDailyStatsTable {
  day: string;                         // date 'YYYY-MM-DD' (a Paris day)
  page: number;                        // smallint 0..60
  subject: WithDefault<string>;        // uuid, '00000000-0000-0000-0000-000000000000' for none
  country: string;                     // char(2)
  views: number;
  seconds: number;
  devices: number;                     // distinct devices that day for that row
  signed_in_views: number;             // 0..views
}

/** The devices of each Paris day (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), anonymous, kept for good. */
export interface DeviceDailyStatsTable {
  day: string;                         // date 'YYYY-MM-DD' (a Paris day)
  country: string;                     // char(2)
  kind: DeviceKind;
  os: DeviceSystem;
  browser: DeviceBrowser;
  opened_in: OpenedIn;
  in_app: InAppOrNone;
  devices: number;
  new_devices: number;                 // 0..devices
  signed_in_devices: number;           // 0..devices
}

/** A collector's places from the connection (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6), by Paris days, kept for good. */
export interface CollectorPlacesTable {
  account_id: string;
  place_id: number;
  days: number;                        // Paris days with at least one view or scan from there, >= 1
  first_day: string;                   // date 'YYYY-MM-DD'
  last_day: string;                    // date 'YYYY-MM-DD', >= first_day
}

/** The per-collector summary of what is past 13 months (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10). */
export interface CollectorViewTotalsTable {
  account_id: string;
  page: number;                        // smallint 1..60
  subject: WithDefault<string>;        // uuid, the nil uuid for none
  views: number;
  seconds: number;                     // bigint
  first_at: Timestamp;
  last_at: Timestamp;
}

/** The per-collector summary by Paris month (migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6, T.10). */
export interface CollectorViewMonthsTable {
  account_id: string;
  month: string;                       // date 'YYYY-MM-DD', the first day of a Paris month
  views: number;
  seconds: number;                     // bigint
  scans: number;
  active_days: number;                 // smallint 0..31
}

/**
 * One row (id 1, migration 0042, plan CUSTOMER INTELLIGENCE §3.3 T.6 table 10, T.11): the recording's start and the
 * past scans' backfill keyset watermark (both or neither) and its end. Inserted by TrackingService.prepare at the first
 * boot, never by the migration.
 */
export interface TrackingStateTable {
  id: WithDefault<number>;             // smallint, always 1
  started_at: Timestamp;
  scans_after_at: TimestampNullable;
  scans_after_id: ColumnType<string | null, string | null | undefined, string | null>;
  scans_backfilled_at: TimestampNullable;
}

/** A channel the console's links are grouped by (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 1). */
export interface LinkChannelsTable {
  id: Generated<string>;
  name: string;                        // 1..40 characters, trimmed; unique whatever its case
  position: WithDefault<number>;       // smallint 0..999
  created_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id; NULL for a preset
  created_at: TimestampDefault;
}

/**
 * A console link, `verify.theorbes.com/go/<code>` (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 2). `id`,
 * `code`, `created_by` and `created_at` never change (`links_immutable`); a release or a model is named exactly when
 * the destination is one; the cost and its currency both or neither; archived with who did it, both or neither.
 */
export interface LinksTable {
  id: Generated<string>;
  code: string;                        // 3..32: lower-case letters, figures, dashes, no dash at either end
  name: string;                        // 1..80 characters, trimmed
  channel_id: string;
  destination: LinkDestination;
  drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  cost_minor: ColumnType<number | null, number | null | undefined, number | null>; // bigint 0..100 000 000 000
  cost_currency: ColumnType<HouseCurrency | null, HouseCurrency | null | undefined, HouseCurrency | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>; // ≤ 500 characters
  archived_at: TimestampNullable;
  archived_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: string;
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/**
 * Each distinct source of visits once (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 3), by its key: `L:<link
 * id>`, `C:<source>␟<medium>␟<campaign>␟<content>␟<term>` (␟ U+001F), `S:<host>`, `DIRECT`, `BEFORE`, `STAFF`. Exactly
 * the columns of its kind; the tags trimmed and in lower case.
 */
export interface AcquisitionSourcesTable {
  id: Generated<number>;               // integer identity (GENERATED ALWAYS)
  kind: SourceKind;
  link_id: ColumnType<string | null, string | null | undefined, string | null>;
  utm_source: ColumnType<string | null, string | null | undefined, string | null>;
  utm_medium: ColumnType<string | null, string | null | undefined, string | null>;
  utm_campaign: ColumnType<string | null, string | null | undefined, string | null>;
  utm_content: ColumnType<string | null, string | null | undefined, string | null>;
  utm_term: ColumnType<string | null, string | null | undefined, string | null>;
  site: ColumnType<string | null, string | null | undefined, string | null>;
  key: string;                         // ≤ 600 characters, unique
  created_at: TimestampDefault;
}

/**
 * A visit (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 5): one device from one source on one Paris day,
 * its repeats in `arrivals`; never a DIRECT source. Kept 13 months, then summarised in acquisition_daily.
 */
export interface AcquisitionTouchesTable {
  id: Generated<number>;               // bigint identity (GENERATED ALWAYS)
  device_id: number;
  source_id: number;
  day: string;                         // date 'YYYY-MM-DD' (a Paris day)
  first_at: Timestamp;
  last_at: Timestamp;                  // >= first_at
  arrivals: WithDefault<number>;       // integer >= 1
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/** A collector's first source, kept for good (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 6). */
export interface AccountSourcesTable {
  account_id: string;
  first_source_id: number;
  first_seen_at: Timestamp;
  set_at: Timestamp;
  set_by: SourceSetBy;
}

/**
 * A sign-up, draw entry, LIVE entry or order with its last link (migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6
 * item 7), written once and never changed; `ref_id` names the account or the row of its table (no foreign key).
 */
export interface AcquisitionConversionsTable {
  id: Generated<number>;               // bigint identity (GENERATED ALWAYS)
  kind: ConversionKind;
  ref_id: string;
  account_id: string;
  at: Timestamp;                       // the act's moment (§3.4 A.5)
  last_source_id: number;
  created_at: TimestampDefault;
}

/** The visits by source and Paris day once the raw rows are gone, kept for good (migration 0043, §3.4 A.6 item 8). */
export interface AcquisitionDailyTable {
  source_id: number;
  day: string;                         // date 'YYYY-MM-DD' (a Paris day)
  visits: number;
  first_visits: number;
  arrivals: number;
}

/**
 * One address on the founding list (migration 0050, macro scope F2 and F3), from the theorbes.com form: the address once
 * by its lookup key, a first name (1..FOUNDING_FIRST_NAME_MAX) and a country, the consent's time and LEGAL_VERSION,
 * where the person came from (never NULL: DIRECT when nothing), the ORBES account with the same address once matched
 * (both or neither), and the unsubscribe that keeps the row. Its identity, address, consent, source and creation never
 * change (`preregistrations_immutable_identity`); removal on request deletes it.
 */
export interface PreregistrationsTable {
  id: Generated<string>;
  email: string;                       // as typed, trimmed, ≤ 254 characters
  email_normalized: string;            // the lookup key, unique
  first_name: string;                  // 1..80 characters, trimmed, no control character nor < >
  country: string;                     // two capital letters
  consent_at: Timestamp;
  consent_version: string;             // the LEGAL_VERSION shown, 'YYYY-MM-DD'
  source_id: number;                   // acquisition_sources.id
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
  matched_at: TimestampNullable;
  unsubscribed_at: TimestampNullable;
  created_at: TimestampDefault;
}

/**
 * The console's wording and switch of one email kind (migration 0051, E0): no row is the default (off, the default
 * words); `subject` or `body` NULL is that part's default words. Written by the console only.
 */
export interface EmailTemplatesTable {
  kind: EmailKind;
  enabled: WithDefault<boolean>;       // DEFAULT false
  subject: ColumnType<string | null, string | null | undefined, string | null>; // 1..150 characters, trimmed, one line
  body: ColumnType<string | null, string | null | undefined, string | null>;    // 1..5 000 characters
  updated_by: string;                  // admin_users.id
  updated_at: TimestampDefault;
}

/**
 * One email (migration 0051, E0), written in the transaction of the act that causes it, once per `dedupe_key`, rendered
 * at enqueue; its kind, key, recipient, address, subject, words and creation never change
 * (`email_outbox_immutable_content`). For an account or a pre-registration, at most one (neither: the console's test).
 * `sent_at` exactly when SENT; `settled_at` exactly when no longer QUEUED (the 90 days of the purge count from it); a
 * FAILED row has its `last_error`, never the credentials.
 */
export interface EmailOutboxTable {
  id: Generated<string>;
  kind: EmailKind;
  dedupe_key: string;                  // 1..200 characters, unique
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
  preregistration_id: ColumnType<string | null, string | null | undefined, string | null>;
  to_address: string;                  // ≤ 254 characters, trimmed
  subject: string;                     // 1..300 characters, trimmed, one line
  body_text: string;
  body_html: string;
  not_before: TimestampDefault;
  status: WithDefault<EmailStatus>;    // DEFAULT QUEUED
  attempts: WithDefault<number>;       // smallint ≥ 0
  last_error: ColumnType<string | null, string | null | undefined, string | null>; // ≤ 300 characters
  created_at: TimestampDefault;
  sent_at: TimestampNullable;
  settled_at: TimestampNullable;
}

/** A collector's email choices (migration 0051, E2): the new release notices, opt-in (DEFAULT false). */
export interface EmailPreferencesTable {
  account_id: string;
  release_notices: WithDefault<boolean>;
  changed_at: TimestampDefault;
}

/** One row (id 1, migration 0051, E2): the release notices' watermark. Written by the sender, never by the migration. */
export interface EmailStateTable {
  id: WithDefault<number>;             // smallint, always 1
  releases_until: Timestamp;
}

/**
 * The console's switch and words of one house moment (migration 0052, D24 M1): no row is the default (off, the default
 * words); `title` or `body` NULL is that part's default words. `enabled_at` is set exactly while enabled, moved to now at
 * each switch-on: a moment delivers only what falls due from then on. Written by the console only.
 */
export interface HouseMomentSettingsTable {
  moment: HouseMoment;
  enabled: WithDefault<boolean>;       // DEFAULT false
  enabled_at: TimestampNullable;       // exactly while enabled
  title: ColumnType<string | null, string | null | undefined, string | null>; // 1..80 characters, trimmed, one line
  body: ColumnType<string | null, string | null | undefined, string | null>;  // 1..2 000 characters
  updated_by: string;                  // admin_users.id
  updated_at: TimestampDefault;
}

/**
 * A custom house message (migration 0052, D24 M2), to a segment or a tier and above (exactly one while DRAFT or
 * SCHEDULED). `send_at` exactly while SCHEDULED or SENT; `sent_at` and `reach` exactly when SENT, with `audience_label`;
 * `cancelled_at` and `cancelled_by` exactly when CANCELLED; `sent_by` on a SCHEDULED or SENT message, none on a DRAFT.
 * Once SENT nothing changes but the segment's id, which may only be cleared; only a DRAFT is deleted.
 */
export interface HouseMessagesTable {
  id: Generated<string>;
  title: string;                       // 1..80 characters, trimmed, one line
  body: string;                        // 1..2 000 characters, plain paragraphs
  status: WithDefault<HouseMessageStatus>; // DEFAULT DRAFT
  audience_segment_id: ColumnType<string | null, string | null | undefined, string | null>; // segments.id
  audience_min_tier: ColumnType<number | null, number | null | undefined, number | null>;   // 1 TITANE, 2 PLATINE, 3 PALLADIUM: this tier and above
  audience_label: ColumnType<string | null, string | null | undefined, string | null>;      // ≤ 80 characters, written at sending
  send_at: TimestampNullable;
  sent_at: TimestampNullable;
  reach: ColumnType<number | null, number | null | undefined, number | null>; // ≥ 0, exactly when SENT
  sent_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id: who scheduled or sent it
  cancelled_at: TimestampNullable;
  cancelled_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id
  created_by: string;                  // admin_users.id
  created_at: TimestampDefault;
  updated_by: string;                  // admin_users.id
  updated_at: TimestampDefault;
}

/**
 * One house message an account received (migration 0052, D24 M1 to M4), once per `dedupe_key`. A MOMENT holds its
 * `moment`, its `title` and `body` rendered at delivery and, for a first registration or a year of ownership, the
 * piece's `piece_ref`; a CUSTOM names its `house_message_id` only (its words are the message's). Every column but
 * `read_at` never changes; never deleted.
 */
export interface HouseDeliveriesTable {
  id: Generated<string>;
  account_id: string;
  source: HouseDeliverySource;
  moment: ColumnType<HouseMoment | null, HouseMoment | null | undefined, HouseMoment | null>;
  house_message_id: ColumnType<string | null, string | null | undefined, string | null>;
  title: ColumnType<string | null, string | null | undefined, string | null>; // MOMENT: ≤ 400 characters, one line
  body: ColumnType<string | null, string | null | undefined, string | null>;  // MOMENT: ≤ 8 000 characters
  piece_ref: ColumnType<string | null, string | null | undefined, string | null>; // O26-J-00184, for a) and e)
  dedupe_key: string;                  // 1..200 characters, unique
  delivered_at: TimestampDefault;
  read_at: TimestampNullable;          // never before delivered_at
}

/**
 * A photograph an owner sent from their piece for WORN (migration 0053, D31 G1 to G3): the piece, the period of ownership
 * it was sent in, its sender and the piece's model at sending. The photograph (bytes, type, hash, sides) is present
 * exactly while PENDING or PUBLISHED, erased otherwise and never replaced. The credit (first name, country, the Instagram
 * name only when chosen) and the consent (time and LEGAL_VERSION) are written at sending and never change. `refusal`
 * exactly when REFUSED or TAKEN_DOWN; `reviewed_by`/`reviewed_at` once published, refused or taken down; `published_at`
 * once published, kept after; `ended_at` exactly when settled. The status only moves forward; a settled row never
 * changes; never deleted.
 */
export interface WornPhotosTable {
  id: Generated<string>;
  product_id: string;                  // products.id
  ownership_id: string;                // ownership.id: the period it was sent in
  account_id: string;                  // accounts.id: its sender
  model_id: string;                    // models.id: the sheet it appears on
  photo: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>; // 1..1 048 576 bytes, while live
  photo_mime: ColumnType<MediaMimeType | null, MediaMimeType | null | undefined, MediaMimeType | null>;
  photo_sha256: ColumnType<string | null, string | null | undefined, string | null>; // hex SHA-256 of `photo`
  width: ColumnType<number | null, number | null | undefined, number | null>;   // 1..4096
  height: ColumnType<number | null, number | null | undefined, number | null>;  // 1..4096
  credit_first_name: string;           // 1..50 characters, trimmed, no control character nor < >
  credit_country: string;              // two capital letters
  credit_instagram: ColumnType<string | null, string | null | undefined, string | null>; // ^[a-z0-9._]{1,30}$, when chosen
  consent_at: Timestamp;
  consent_version: string;             // the LEGAL_VERSION shown, YYYY-MM-DD
  status: WithDefault<WornStatus>;     // DEFAULT PENDING
  refusal: ColumnType<WornRefusal | null, WornRefusal | null | undefined, WornRefusal | null>;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id
  reviewed_at: TimestampNullable;
  published_at: TimestampNullable;
  ended_at: TimestampNullable;
  created_at: TimestampDefault;
}

/**
 * One row (id 1, migration 0043, plan CUSTOMER INTELLIGENCE §3.4 A.6 item 9): the recording's start (« Before tracking »
 * before it) and the job's watermarks. Inserted by AcquisitionService.prepare at the first boot, never by the migration.
 */
export interface AcquisitionStateTable {
  id: WithDefault<number>;             // smallint, always 1
  tracking_started_at: Timestamp;
  conversions_until: Timestamp;
  catch_up_on: DateNullable;           // the last Paris day the daily catch-up ran
  daily_until: DateNullable;           // the last Paris day summarised
}

/**
 * A private note of ORBES Client Services on a client (migration 0044, plan CUSTOMER INTELLIGENCE §3.6 C.8 item 1),
 * never shown to the client and never in the right-of-access export. Never edited: only its removal (`removed_at` with
 * `removed_by`, once) changes it. `created_by` NULL: written by a script. Written by ClientNoteService only, and by
 * ProfileService.setBirthDateByStaff for the reason of a date of birth changed.
 */
export interface AccountNotesTable {
  id: Generated<string>;
  account_id: string;
  body: string;
  created_by: string | null;
  created_at: TimestampDefault;
  removed_at: TimestampNullable;
  removed_by: string | null;
}

/**
 * A tag of ORBES Client Services on a client (migration 0044, plan CUSTOMER INTELLIGENCE §3.6 C.8 item 2): in capitals,
 * 1 to 32 characters, once per account; a removed tag is a deleted row. At most 20 per account (ClientNoteService).
 */
export interface AccountTagsTable {
  account_id: string;
  tag: string;
  created_by: string | null;
  created_at: TimestampDefault;
}

/**
 * The engagement score of an account (migration 0046, plan CUSTOMER INTELLIGENCE §3.5 SB.3.2): the current one only,
 * staff only, never shown to the collector nor in the right-of-access export. The score is the sum of its five parts;
 * each part is kept with the figure behind it. Written by the daily job alone (services/engagement.ts), which rewrites
 * a row only when a value changed (`changed_at`) and removes a DELETED account's.
 */
export interface AccountScoresTable {
  account_id: string;
  /** The version of the code's formula that made the row (ENGAGEMENT_FORMULA), 1 or more. */
  formula: number;
  score: number;                       // smallint 0..100, the sum of the five parts
  recency_points: number;              // 0..25
  frequency_points: number;            // 0..20
  spend_points: number;                // 0..25
  speed_points: number;                // 0..10
  attendance_points: number;           // 0..20
  /** The latest act in the 12 months and its kind, both or neither. */
  last_act_at: TimestampNullable;
  last_act_kind: ColumnType<ScoreActKind | null, ScoreActKind | null | undefined, ScoreActKind | null>;
  active_days: number;                 // 0..366 Paris days with an act
  spend_eur_minor: number;             // bigint ≥ 0, the purchases of the 12 months in euro cents
  purchases: number;                   // the purchases in the 12 months
  unpriced: number;                    // of which without a known price, ≤ purchases
  /** The currencies converted to euros at the code's rates, among GBP, USD, CHF. */
  other_currencies: WithDefault<ScoreOtherCurrency[]>;
  /** The median minutes from a release's opening to the entry; NULL exactly when `speed_releases` is 0. */
  speed_minutes: ColumnType<number | null, number | null | undefined, number | null>;
  speed_releases: number;
  releases_taken: number;              // ≤ releases_open
  releases_open: number;
  changed_at: Timestamp;
}

/**
 * A day's run of the engagement score (migration 0046, §3.5 SB.3.2), one row per Paris day: the job's claim, then, once
 * finished, the accounts scored, the rows changed and the counted collectors per band of ten (0–9 … 90–100), kept for
 * good as the history of the score spread.
 */
export interface EngagementRunsTable {
  day: string;                         // date 'YYYY-MM-DD' (a Paris day)
  formula: number;
  started_at: Timestamp;
  finished_at: TimestampNullable;
  accounts: ColumnType<number | null, number | null | undefined, number | null>;
  changed: ColumnType<number | null, number | null | undefined, number | null>;
  /** Ten counts, the bands 0–9 to 90–100; NULL until the run is finished. */
  bands: ColumnType<number[] | null, number[] | null | undefined, number[] | null>;
  duration_ms: ColumnType<number | null, number | null | undefined, number | null>;
}

/**
 * The monthly history of a counted collector (migration 0047, plan CUSTOMER INTELLIGENCE §3.6 C.8 item 3, C.10): one
 * element per Paris month from `first_month` to `last_month`, at most 36: the engagement score at the month's end
 * (NULL: not measured), the tier held at its end (0..3) and whether the collector was active in it. Written by the
 * housekeeping job `collectorHistory` (services/collector-history.ts) only.
 */
export interface CollectorHistoryTable {
  account_id: string;
  first_month: string;                 // date 'YYYY-MM-01' (a Paris month)
  scores: ColumnType<(number | null)[], (number | null)[] | undefined, (number | null)[]>;
  tiers: ColumnType<number[], number[] | undefined, number[]>;
  active: ColumnType<boolean[], boolean[] | undefined, boolean[]>;
  last_month: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * A model's pairs (migration 0031, plan NEXT-NINE BP-34, PAIRS WELL WITH): the models its sheet shows at its very end,
 * in their order (`position` 1..3), each once, never itself. Set on a main model or a model alone (services/catalog.ts
 * setPairs: 0, 2 or 3 rows, never a model of its own variant group).
 */
export interface ModelPairsTable {
  model_id: string;
  position: number;
  paired_model_id: string;
  created_at: TimestampDefault;
  created_by: string | null;
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
  /** Migration 0036: the reception line a RECEIVED movement brings in, exactly for RECEIVED (`stock_movements_received`). */
  reception_line_id: ColumnType<string | null, string | null | undefined, never>;
  /** Migration 0056 (D2): the add-on's unit a SHIPPED or RETURNED movement moves, with its order and SKU; never with a piece. */
  order_addon_item_id: ColumnType<string | null, string | null | undefined, never>;
}

/** A minimum of a SKU at a location (migration 0022, L2): below it, the atelier is told what to make. */
export interface SkuThresholdsTable {
  sku_id: string;
  location_id: string;
  minimum: number;                     // 1..10 000
  updated_by: string | null;           // admin_users.id
  updated_at: TimestampDefault;
}

/**
 * A standard box (migration 0054, macro scope D16 B1; lot M3 plan §1.1): its name (1..60, unique whatever the case), its
 * inside sides (1..2 000 mm each, taking the 95 × 62 mm certificate card flat in either orientation, `boxes_card_fits`),
 * its empty weight (1..30 000 g) and its cost with its currency (both or neither), `active` (a box set aside is offered
 * for no model nor parcel; a shipment keeps the one it used). id, created_at and created_by never change.
 */
export interface BoxesTable {
  id: Generated<string>;
  name: string;
  inside_length_mm: number;
  inside_width_mm: number;
  inside_height_mm: number;
  empty_weight_g: number;
  cost_minor: ColumnType<number | null, number | null | undefined, number | null>; // bigint 0..100 000 000
  /** An ISO 4217 code (^[A-Z]{3}$), with cost_minor. */
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
  created_by: ColumnType<string | null, string | null | undefined, never>; // admin_users.id; NULL for a script
  updated_at: TimestampDefault;
}

/**
 * An add-on (migration 0056, macro scope K48 D1; lot M3 plan §4.1): a catalogue item with real stock, sold with a piece,
 * its name (1..40, unique whatever the case, as the collector reads it) and line (1..120), its supplier and weight
 * (1..30 000 g), the order it is offered in, `active` (set aside when false, never deleted) and its Shopify product (S5).
 * No ORBES CODE, no identity, never counted toward the tier. Its SKU is a `skus` row with `addon_id`. id, created_at
 * and created_by never change.
 */
export interface AddonItemsTable {
  id: Generated<string>;
  name: string;
  line: ColumnType<string | null, string | null | undefined, string | null>;
  supplier_id: ColumnType<string | null, string | null | undefined, string | null>; // suppliers.id
  weight_g: ColumnType<number | null, number | null | undefined, number | null>;
  position: WithDefault<number>;       // 0..10 000
  active: WithDefault<boolean>;
  shopify_product_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
  created_by: ColumnType<string | null, string | null | undefined, never>; // admin_users.id; NULL for a script
  updated_at: TimestampDefault;
  /**
   * Migration 0059 (ADD-ONS ONE SYSTEM, lot Q2): PRODUCT (DEFAULT) or SERVICE (no supplier, no stock, its unit held
   * nowhere: `addon_items_service_plain`), fixed at its creation.
   */
  kind: ColumnType<AddonKind, AddonKind | undefined, never>;
  /** Migration 0059: the moments it is offered at (DEFAULT true each): a LIVE hold, a draw's place held, the salon, YOUR ORDERS until packing. */
  offer_live: WithDefault<boolean>;
  offer_draw: WithDefault<boolean>;
  offer_salon: WithDefault<boolean>;
  offer_orders: WithDefault<boolean>;
  /** Migration 0059: the engraving, whose collector types its words (a SERVICE only; one active at a time). */
  engraving: WithDefault<boolean>;
  /** Migration 0059: the engraving's most characters (ADDON_TEXT_MAX, DEFAULT 20), read on the engraving only. */
  text_max: WithDefault<number>;
}

/**
 * A release's pick of add-ons (migration 0059, ADD-ONS ONE SYSTEM, lot Q2): the add-ons a release offers at its purchase
 * moments, in its order (`position` 1..ADDON_PICK_POSITION_MAX, once per release). Its release and add-on never change.
 * YOUR ORDERS never reads it.
 */
export interface DropAddonsTable {
  drop_id: ColumnType<string, string, never>;
  addon_id: ColumnType<string, string, never>;
  position: number;                    // 1..100
}

/**
 * What was converted into a catalogue add-on (migration 0060, lot Q2, D5): one row per release add-on (`source`
 * LIVE_ADDON, `source_id` its old id, `drop_id` its release) and one per currency of Orders → Settings' engraving price
 * (ENGRAVING_PRICES, neither); `currency` the source's and `price_minor` the price it gave its add-on in it (NULL: none).
 * Never changed; read by Catalogue → Add-ons ("Converted from…") and by 0060's `down`.
 */
export interface AddonConversionsTable {
  id: Generated<string>;
  source: AddonConversionSource;
  source_id: string | null;
  drop_id: string | null;
  addon_id: string;
  currency: string | null;
  price_minor: number | null;
  converted_at: TimestampDefault;
}

/** An add-on's price in a house currency (migration 0056, D1): no row, not offered in that currency. */
export interface AddonItemPricesTable {
  addon_id: ColumnType<string, string, never>;
  currency: ColumnType<HouseCurrency, HouseCurrency, never>;
  price_minor: number;                 // 0..100 000 000
  updated_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id
  updated_at: TimestampDefault;
}

/**
 * A unit of an add-on on an order (migration 0056, D1 and D2): its add-on's SKU held at `location_id` while HELD, its
 * price and currency when added (kept), its state with its times (`order_addon_items_status_times`), who added it
 * (PURCHASE: no one named; COLLECTOR: their account; STAFF: an admin, NULL for a script), `returned_to_stock` with
 * RETURNED only, its supplementary invoice and its Shopify line item. Identity, price and addition never change.
 */
export interface OrderAddonItemsTable {
  id: Generated<string>;
  order_id: ColumnType<string, string, never>;
  addon_id: ColumnType<string, string, never>;
  sku_id: ColumnType<string, string, never>; // the add-on's SKU (skus.addon_id = addon_id)
  /** Where it is held; NULL for a SERVICE's unit (migration 0059, `order_addon_items_kind_guard`), never for a PRODUCT's. */
  location_id: ColumnType<string | null, string | null, string | null>;
  price_minor: ColumnType<number, number, never>;
  currency: ColumnType<HouseCurrency, HouseCurrency, never>;
  status: WithDefault<OrderAddonStatus>;
  added_at: ColumnType<Date, Date | string | undefined, never>;
  removed_at: TimestampNullable;
  shipped_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  returned_at: TimestampNullable;
  added_by_type: ColumnType<OrderAddonAddedBy, OrderAddonAddedBy, never>;
  added_by: ColumnType<string | null, string | null | undefined, never>;
  returned_to_stock: ColumnType<boolean | null, boolean | null | undefined, boolean | null>;
  invoice_id: ColumnType<string | null, string | null | undefined, string | null>;
  shopify_line_item_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * An add-on chosen before the order exists (migration 0056, D2): on exactly one LIVE entry, draw entry or salon request
 * (`addon_choices_owner`), 1..3 units, once per owner and add-on; carried onto the order at its creation, then deleted.
 */
export interface AddonChoicesTable {
  id: Generated<string>;
  live_entry_id: ColumnType<string | null, string | null | undefined, never>;
  drop_entry_id: ColumnType<string | null, string | null | undefined, never>;
  shop_request_id: ColumnType<string | null, string | null | undefined, never>;
  addon_id: ColumnType<string, string, never>;
  units: number;                       // 1..3
  chosen_at: TimestampDefault;
  /** Migration 0059: the engraving's words before the order (1..120, trimmed; the engraving's choice only); NULL: none. */
  text: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * A set (migration 0057, macro scope K44 T1; lot M3 plan §5.2): 2 to 4 models sold together at one price, as its own
 * release. Its name (1..60, unique whatever the case), code (its reference and future Shopify handle, unique), base
 * price and currency (both or neither, as a model's; a release carries its own), `active` (set aside when false, never
 * deleted) and its one Shopify product (S5). id, created_at and created_by never change.
 */
export interface SetsTable {
  id: Generated<string>;
  name: string;
  code: string;
  base_price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  base_currency: ColumnType<string | null, string | null | undefined, string | null>;
  active: WithDefault<boolean>;
  shopify_product_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
  created_by: ColumnType<string | null, string | null | undefined, never>; // admin_users.id; NULL for a script
  updated_at: TimestampDefault;
}

/** A set's piece (migration 0057, T1): its position 1..4 and its model (a model or a variant), each model once per set. */
export interface SetModelsTable {
  set_id: string;
  position: number;                    // smallint 1..4
  model_id: string;
}

/**
 * The size a set release's entry chose for one piece (migration 0057, T1): a draw entry's (`drop_entry_sizes`) or a LIVE
 * entry's (`live_entry_sizes`), a size of its release and of that piece; entry, release and piece never change.
 */
export interface EntrySizesTable {
  entry_id: ColumnType<string, string, never>;
  drop_id: ColumnType<string, string, never>;
  piece: ColumnType<number, number, never>; // 1..4
  size_id: string;                     // drop_sizes.id of the same release and piece
}

/** The size I'LL BE THERE chose for one piece of a set's LIVE (migration 0057, T1); release, account and piece never change. */
export interface LiveInterestSizesTable {
  drop_id: ColumnType<string, string, never>;
  account_id: ColumnType<string, string, never>;
  piece: ColumnType<number, number, never>; // 1..4
  size_id: string;
}

/**
 * A set sold (migration 0057, T1 and T2): its set, its release (NULL for a sale on the future Shopify store, S2), its
 * account, the one price and currency (both or neither), its Shopify line item (S5); one order per piece names it.
 * id, set, release, account and creation never change.
 */
export interface SetSalesTable {
  id: Generated<string>;
  set_id: ColumnType<string, string, never>;
  drop_id: ColumnType<string | null, string | null | undefined, never>;
  account_id: ColumnType<string, string, never>;
  price_minor: ColumnType<number | null, number | null | undefined, number | null>;
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  shopify_line_item_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * Read-only view (migration 0056): every hold on stock from one source, the orders' (`orders.reservation` STOCK or
 * AWAITING, kind PIECE, `id` the order's) and the add-on units HELD (as STOCK, kind ADD_ON, `id` the unit's).
 */
export interface StockHoldsView {
  sku_id: string;
  location_id: string;
  reservation: OrderReservation;
  reserved_at: Date;
  kind: StockHoldKind;
  id: string;
}

/** A carrier (migration 0022, M1): its tracking link, https with `{tracking}` where the number goes. id and created_at never change. */
export interface CarriersTable {
  id: Generated<string>;
  name: string;                        // 1..60 characters, unique whatever the case
  tracking_url: string;
  active: WithDefault<boolean>;
  created_at: TimestampDefault;
}

/**
 * A release add-on of an order, as it was sold before lot Q2 (orders.addons): history, read by its invoices, credit
 * notes, exchanges and exports (N15); no order writes it since, and migration 0060 converted the release add-ons.
 */
export interface OrderAddonSnapshot {
  [key: string]: JsonValue;
  /** The release add-on's id then (live_addons.id, a table migration 0060 dropped). */
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
  /** The piece of a LIVE entry, 1..its quantity (1..its sets × the set's pieces on a set sale's, migration 0057); 1 for the other channels. */
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
  /**
   * Migration 0027 (BP-19 T4, T5): the order it travels with (a GIFT order, the 2nd to 5th piece of a LIVE entry), never
   * changed; a GIFT order's grant.
   */
  with_order_id: ColumnType<string | null, string | null | undefined, string | null>;
  gift_grant_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Its shipping, both or neither (NULL: none, as before): the service and the fee in its currency; the tier that made it free (2, 3), at 0 only. */
  shipping_service: ColumnType<ShippingService | null, ShippingService | null | undefined, ShippingService | null>;
  shipping_minor: ColumnType<number | null, number | null | undefined, number | null>;
  shipping_benefit: ColumnType<number | null, number | null | undefined, number | null>;
  /** Migration 0037 (plan NEXT LOT §3.5): a reshipment served ahead of the oldest-first queue (a parcel lost or damaged). */
  queue_first: WithDefault<boolean>;
  /** An EXCHANGE order's original (unique, never changed). */
  exchange_of_order_id: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 0057 (THE SET, T2): the set sale this order is a piece of (set_sales.id, of the order's account) and that
   * piece (set_models.position, 1..4), both or neither, never changed; an EXCHANGE order joins it in its piece's place.
   */
  set_sale_id: ColumnType<string | null, string | null | undefined, string | null>;
  set_piece: ColumnType<number | null, number | null | undefined, number | null>;
  /** Start packing: set on every order of a parcel, never cleared (the collector's address and engraving lock). */
  packing_started_at: TimestampNullable;
  /**
   * Migration 0039 (plan NEXT LOT §3.6.B): the delivery address's country (ISO 3166-1 alpha-2) and phone, who entered it
   * (both or neither with `address_at`) and when it was replaced after it was first entered (ADDRESS CHANGED). Never on
   * an order travelling with another: it is delivered to that order's address.
   */
  buyer_country: ColumnType<string | null, string | null | undefined, string | null>;
  buyer_phone: ColumnType<string | null, string | null | undefined, string | null>;
  address_by: ColumnType<AddressSource | null, AddressSource | null | undefined, AddressSource | null>;
  address_at: TimestampNullable;
  address_changed_at: TimestampNullable;
  /**
   * Migration 0039 (§3.6.C): the price an engraving was taken at (the setting's then; NULL for the release's add-on and
   * for one of before), and who typed its words (present exactly with them).
   */
  engraving_minor: ColumnType<number | null, number | null | undefined, number | null>;
  engraving_by: ColumnType<AddressSource | null, AddressSource | null | undefined, AddressSource | null>;
}

/**
 * A parcel (migration 0037, plan NEXT LOT §3.5.5.3): its first order and the orders travelling with it, packed and shipped
 * by the agent. Its photo is internal only, erased 14 days after delivery.
 */
export interface ShipmentsTable {
  id: Generated<string>;
  order_id: string;
  location_id: string;
  status: WithDefault<ShipmentStatus>;
  packing_started_at: TimestampDefault;
  packing_started_by: string | null;
  /** The checklist's lines ticked: [{ key, label }]. */
  checklist: Jsonb<{ key: string; label: string }[], true>;
  photo: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  photo_mime: ColumnType<string | null, string | null | undefined, string | null>;
  photo_sha256: ColumnType<string | null, string | null | undefined, string | null>;
  photo_erased_at: TimestampNullable;
  packed_at: TimestampNullable;
  packed_by: ColumnType<string | null, string | null | undefined, string | null>;
  carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  tracking_number: ColumnType<string | null, string | null | undefined, string | null>;
  shipped_at: TimestampNullable;
  shipped_by: ColumnType<string | null, string | null | undefined, string | null>;
  delivered_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  created_at: TimestampDefault;
  /** Migration 0054 (macro scope D16 B1): the box chosen while packing, or the one suggested, written at PACKED (boxes.id). */
  box_id: ColumnType<string | null, string | null | undefined, string | null>;
  /**
   * Migration 0054 (B2): the parcel's weight, 1..100 000 g, written at PACKED: the box's empty weight plus each piece's
   * packed weight (and each add-on's). NULL before PACKED, and when unknown.
   */
  weight_g: ColumnType<number | null, number | null | undefined, number | null>;
  /** Migration 0054: what was missing at PACKED when the weight is unknown (model names, « box »), 1..64 entries; never with weight_g. */
  weight_missing: ColumnType<string[] | null, string[] | null | undefined, string[] | null>;
}

/** An order of a parcel, and the piece its packing scan bound (migration 0037). */
export interface ShipmentItemsTable {
  shipment_id: string;
  order_id: string;
  product_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** No foreign key: the scans' retention clears it. */
  scan_event_id: ColumnType<string | null, string | null | undefined, string | null>;
  scanned_at: TimestampNullable;
}

/**
 * An order case (migration 0037, plan NEXT LOT §1.1 (b)): a return, a size exchange or a parcel problem. Its note is the
 * client's or staff's words: personal data, never in the audit log, the events nor the journal. Never deleted.
 */
export interface OrderCasesTable {
  id: Generated<string>;
  order_id: string;
  shipment_id: ColumnType<string | null, string | null | undefined, string | null>;
  kind: OrderCaseKind;
  opened_by_type: OrderCaseOpener;
  opened_by_id: string;
  opened_at: TimestampDefault;
  reason: ColumnType<OrderCaseReason | null, OrderCaseReason | null | undefined, OrderCaseReason | null>;
  note: ColumnType<string | null, string | null | undefined, string | null>;
  exchange_sku_id: ColumnType<string | null, string | null | undefined, string | null>;
  exchange_size_label: ColumnType<string | null, string | null | undefined, string | null>;
  message_id: ColumnType<string | null, string | null | undefined, string | null>;
  status: WithDefault<OrderCaseStatus>;
  received_at: TimestampNullable;
  received_by: ColumnType<string | null, string | null | undefined, string | null>;
  piece_state: ColumnType<OrderCasePieceState | null, OrderCasePieceState | null | undefined, OrderCasePieceState | null>;
  receive_note: ColumnType<string | null, string | null | undefined, string | null>;
  outcome: ColumnType<OrderCaseOutcome | null, OrderCaseOutcome | null | undefined, OrderCaseOutcome | null>;
  piece_to: ColumnType<OrderCasePieceDestination | null, OrderCasePieceDestination | null | undefined, OrderCasePieceDestination | null>;
  exchange_order_id: ColumnType<string | null, string | null | undefined, string | null>;
  decision_note: ColumnType<string | null, string | null | undefined, string | null>;
  closed_at: TimestampNullable;
  closed_by: ColumnType<string | null, string | null | undefined, string | null>;
  cancelled_at: TimestampNullable;
  cancelled_by: ColumnType<string | null, string | null | undefined, string | null>;
  cancel_note: ColumnType<string | null, string | null | undefined, string | null>;
  /** Migration 0057 (THE SET, T3): the cases of one set's return, opened and decided together (RETURN only), never changed. */
  group_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  note: string;
  /** The ownership ORBES took back (ended by the return) when the buyer had registered the piece. */
  ownership_id: ColumnType<string | null, string | null | undefined, string | null>;
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
  /** Migration 0039 (plan NEXT LOT §3.6.C): a supplementary INVOICE's main invoice (an engraving added after PAID). */
  supplements_invoice_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** A credit note's scope: FULL (what remains) or LINES (single lines); NULL on an invoice. */
  credit_scope: ColumnType<CreditScope | null, CreditScope | null | undefined, CreditScope | null>;
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

/**
 * The club's program (migration 0026, BP-19 T2): the figures of the tiers' benefits set in the console's THE PROGRAM;
 * one row at most (`id` 1), none inserted: the defaults are the columns' (services/club-program.ts DEFAULT_PROGRAM).
 */
export interface ClubProgramSettingsTable {
  id: WithDefault<number>;             // always 1
  /** A new draw's early access by default, in hours before entries open to everyone: PALLADIUM 4, PLATINE 2 (≤ PALLADIUM's); 0..336. */
  early_access_palladium_hours: WithDefault<number>;
  early_access_platine_hours: WithDefault<number>;
  shipping_free_platine: WithDefault<ShippingFreeLevel>;
  shipping_free_palladium: WithDefault<ShippingFreeLevel>;
  /** Pieces cared for a year, 0..20 or NULL, every piece: PLATINE NULL (migration 0048, plan ORBES CARE: PRIVATE CARE for every piece from PLATINE; 1 before), PALLADIUM NULL. */
  care_pieces_platine: WithDefault<number | null>;
  care_pieces_palladium: ColumnType<number | null, number | null | undefined, number | null>;
  /** The Messages board's priority from this tier: 2 PLATINE, 3 PALLADIUM, 0 off. */
  messages_priority_min_tier: WithDefault<number>;
  /** The welcome gift of each tier: a model of the catalogue (models.id), or none. */
  gift_platine_model_id: ColumnType<string | null, string | null | undefined, string | null>;
  gift_palladium_model_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The credit of each tier in minor units (0: none), its currency, its validity in months, the channels it is taken off. */
  credit_platine_minor: WithDefault<number>;
  credit_palladium_minor: WithDefault<number>;
  credit_currency: WithDefault<HouseCurrency>;
  credit_validity_months: WithDefault<number>;
  credit_channels: WithDefault<CreditChannel[]>;
  /** The lowest tier (1..3) invited to each experience of the circle. */
  experience_members_evening_min_tier: WithDefault<number>;
  experience_launch_preview_min_tier: WithDefault<number>;
  experience_partner_min_tier: WithDefault<number>;
  /** The birthday credit (migration 0045, §3.5 SB.4): given or not (true), its amount in minor units of `credit_currency` (2000, 1..100 000 000), its days from the birthday (30, 1..365). */
  birthday_credit_on: WithDefault<boolean>;
  birthday_credit_minor: WithDefault<number>;
  birthday_credit_days: WithDefault<number>;
  /** The credit of an accepted lifetime warranty claim once the free replacement is used, in percent of the piece's value (migration 0048, plan ORBES CARE: 30, 1..100). */
  warranty_credit_percent: WithDefault<number>;
  updated_by: string | null;
  updated_at: TimestampDefault;
}

/**
 * What an account received on reaching a tier (migration 0027, BP-19 T5): its welcome gift and its credit, once per tier
 * and per account, ever (`tier_grants_once`); its birthday credits (BIRTHDAY, no tier, migration 0045), once per
 * birthday (`tier_grants_birthday_key`); and the credits decided on its lifetime warranty claims (WARRANTY, no tier,
 * migration 0048, each named by its claim's `grant_id`). Never deleted, its identity and amount never changed.
 */
export interface TierGrantsTable {
  id: Generated<string>;
  account_id: string;
  tier: ColumnType<number | null, number | null | undefined, number | null>;   // 2 PLATINE, 3 PALLADIUM; NULL on a BIRTHDAY or WARRANTY grant
  kind: TierGrantKind;
  granted_at: TimestampDefault;
  /** A CREDIT's, a BIRTHDAY or a WARRANTY grant's amount (1..100 000 000 minor units), currency and expiry; NULL on a GIFT. */
  amount_minor: ColumnType<number | null, number | null | undefined, number | null>;
  currency: ColumnType<string | null, string | null | undefined, string | null>;
  expires_at: TimestampNullable;
  /** A GIFT's model as given, set each time it is attached to an order; NULL on a CREDIT. */
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** A BIRTHDAY grant's birthday, the Paris day 'YYYY-MM-DD' it was given for; NULL on every other kind (migration 0045). */
  birthday_on: DateNullable;
}

/** A credit taken off an order (migration 0027): released (removed, cancelled, returned) or open; never deleted. */
export interface CreditUsesTable {
  id: Generated<string>;
  grant_id: string;
  order_id: string;
  amount_minor: number;                // > 0
  applied_by: string | null;           // admin_users.id
  applied_at: TimestampDefault;
  released_at: TimestampNullable;
  released_reason: ColumnType<CreditReleaseReason | null, CreditReleaseReason | null | undefined, CreditReleaseReason | null>;
  released_by: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * A yearly care asked for from a piece (migration 0028, BP-19 T6): its steps, the address the piece returns to
 * (personal data, never in the audit log), its prepaid label (a PDF, erased 30 days after the request ends) and the
 * YEARLY_CARE record it opened. Never deleted; its identity, year, tier and address never change.
 */
export interface CareRequestsTable {
  id: Generated<string>;
  account_id: string;
  product_id: string;
  year: number;                        // 2026..2099, UTC
  tier: number;                        // 2 PLATINE, 3 PALLADIUM, at the request
  status: ColumnType<CareRequestStatus, CareRequestStatus | undefined, CareRequestStatus>;
  requested_at: TimestampDefault;
  return_name: string;                 // 1..200 trimmed
  return_address: string;              // 1..1000 trimmed
  label_pdf: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  label_carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  label_tracking: ColumnType<string | null, string | null | undefined, string | null>;
  label_at: TimestampNullable;
  service_record_id: ColumnType<string | null, string | null | undefined, string | null>;
  received_at: TimestampNullable;
  return_carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  return_tracking: ColumnType<string | null, string | null | undefined, string | null>;
  return_shipped_at: TimestampNullable;
  done_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  cancelled_by: ColumnType<CareCancelledBy | null, CareCancelledBy | null | undefined, CareCancelledBy | null>;
  /** Staff only: 1..500 characters. */
  note: ColumnType<string | null, string | null | undefined, string | null>;
  handled_by: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * A warranty claim (migration 0048, plan ORBES CARE §2(c)): opened by Client Services from the claimant's conversation
 * (or, for a legal claim of a buyer without an account, from the piece with the receipt in `note`), on the piece's
 * warranty kind read at opening or the legal guarantee (`basis`, never changed); its prepaid label (a PDF, erased 30 days
 * after the claim ends), the INSPECTION record its receipt opened, the decision (its outcome as its basis allows, a
 * refusal's reason, a value and its currency, a part credit's percent, the WARRANTY grant, the replacement piece), the
 * return. One live claim per piece; one free replacement per original purchase under the lifetime warranty
 * (`root_product_id`). Never deleted; who claims what, on which basis, opened when and by whom never change.
 */
export interface WarrantyClaimsTable {
  id: Generated<string>;
  product_id: string;
  /** The original piece: the claimed piece, or the root of the claim whose replacement it is. */
  root_product_id: string;
  /** The claimant (the registered owner for the ORBES warranty) and the conversation it was opened from; both NULL only on a LEGAL claim of a buyer without an account. */
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
  conversation_id: ColumnType<string | null, string | null | undefined, string | null>;
  basis: WarrantyClaimBasis;
  status: ColumnType<WarrantyClaimStatus, WarrantyClaimStatus | undefined, WarrantyClaimStatus>;
  opened_at: TimestampDefault;
  opened_by: string;                   // admin_users.id
  label_pdf: ColumnType<Uint8Array | null, Uint8Array | null | undefined, Uint8Array | null>;
  label_carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  label_tracking: ColumnType<string | null, string | null | undefined, string | null>;
  label_at: TimestampNullable;
  service_record_id: ColumnType<string | null, string | null | undefined, string | null>;
  received_at: TimestampNullable;
  outcome: ColumnType<WarrantyClaimOutcome | null, WarrantyClaimOutcome | null | undefined, WarrantyClaimOutcome | null>;
  refusal_reason: ColumnType<WarrantyClaimRefusal | null, WarrantyClaimRefusal | null | undefined, WarrantyClaimRefusal | null>;
  /** The value a credit, a price reduction or a refund is computed from or amounts to, 1..100 000 000 minor units, with its currency. */
  value_minor: ColumnType<number | null, number | null | undefined, number | null>;
  currency: ColumnType<HouseCurrency | null, HouseCurrency | null | undefined, HouseCurrency | null>;
  /** A PART_CREDIT's percent (THE PROGRAM's `warranty_credit_percent` at the decision), 1..100. */
  credit_percent: ColumnType<number | null, number | null | undefined, number | null>;
  grant_id: ColumnType<string | null, string | null | undefined, string | null>;
  replacement_product_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** A replacement of another size of the same model, chosen by the staff member deciding. */
  other_size: WithDefault<boolean>;
  decided_at: TimestampNullable;
  decided_by: ColumnType<string | null, string | null | undefined, string | null>;
  return_carrier_id: ColumnType<string | null, string | null | undefined, string | null>;
  return_tracking: ColumnType<string | null, string | null | undefined, string | null>;
  return_shipped_at: TimestampNullable;
  done_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  /** Staff only: 1..500 characters; never shown to the collector nor written in the audit log. */
  note: ColumnType<string | null, string | null | undefined, string | null>;
  /** A LEGAL claim continuing a 2-year claim moved to the legal guarantee after receipt. */
  continues_claim_id: ColumnType<string | null, string | null | undefined, string | null>;
}

/**
 * THE HOUSE'S GUARANTEE (migration 0029, IN-01): a place granted by Client Services to one account at a chosen release or
 * the next release of a model or collection, for 1..5 pieces, valid for a release opening by `valid_until`, shown to the
 * client or not; set aside for a release (`covered_drop_id`), then USED, EXPIRED or REVOKED. Its identity, target and
 * grant never change. Its computed state (waiting, set aside, entered) is never stored (services/guarantees.ts).
 */
export interface HouseGuaranteesTable {
  id: Generated<string>;
  account_id: string;
  scope: GuaranteeScope;
  drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  model_id: ColumnType<string | null, string | null | undefined, string | null>;
  collection_id: ColumnType<string | null, string | null | undefined, string | null>;
  pieces: WithDefault<number>;         // 1..5
  valid_until: Timestamp;
  visible: WithDefault<boolean>;
  /** For Client Services: 1..500 characters; never shown in the app nor in the audit log, in the client's export. */
  note: ColumnType<string | null, string | null | undefined, string | null>;
  covered_drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  covered_at: TimestampNullable;
  status: ColumnType<GuaranteeStatus, GuaranteeStatus | undefined, GuaranteeStatus>;
  used_at: TimestampNullable;
  used_drop_id: ColumnType<string | null, string | null | undefined, string | null>;
  closed_at: TimestampNullable;
  closed_reason: ColumnType<GuaranteeClosedReason | null, GuaranteeClosedReason | null | undefined, GuaranteeClosedReason | null>;
  revoked_by: ColumnType<string | null, string | null | undefined, string | null>;
  revoke_note: ColumnType<string | null, string | null | undefined, string | null>;
  /** admin_users.id; NULL for a script. */
  granted_by: ColumnType<string | null, string | null | undefined, string | null>;
  granted_at: TimestampDefault;
  updated_by: ColumnType<string | null, string | null | undefined, string | null>;
  updated_at: TimestampNullable;
}

/** The Grant dialog's defaults (migration 0029, Orders → Settings, House guarantee): one row at most (`id` 1), none inserted. */
export interface GuaranteeSettingsTable {
  id: WithDefault<number>;             // always 1
  valid_days: WithDefault<number>;     // 1..730, 90
  pieces: WithDefault<number>;         // 1..5, 1
  visible: WithDefault<boolean>;       // true
  updated_by: string | null;
  updated_at: TimestampDefault;
}

/** What an order's delivery costs below the free shipping of the tiers (migration 0026), per currency and service; optional, none inserted. */
export interface ShippingRatesTable {
  currency: HouseCurrency;
  service: ShippingService;
  fee_minor: number;                   // 0..100 000 000
  updated_by: string | null;
  updated_at: TimestampDefault;
}

/**
 * The guests of an after-room (migration 0023, A3): the parent's entries still WAITING or QUEUED at its sell-out, each
 * with its place in the after-room's line (their order in the parent's), remembered once; never changed.
 */
export interface AfterRoomGuestsTable {
  /** The after-room (drops.id of the child release). */
  drop_id: string;
  /** The parent's entry (live_entries.id), unique. */
  entry_id: string;
  position: number;                    // ≥ 1, unique per after-room
  remembered_at: Timestamp;
}

/** A collector's answer to a release's question after (migration 0023, G4): one per account and release, changeable. */
export interface ReleaseAnswersTable {
  drop_id: string;
  account_id: string;
  /** The position of the answer chosen, 1..6. */
  answer: number;
  answered_at: TimestampDefault;
}

/** A saved group of collectors (migration 0023, N5): its name (unique whatever the case) and its rule tree. */
export interface SegmentsTable {
  id: Generated<string>;
  name: string;                        // 1..60 characters
  criteria: Jsonb<JsonObject>;
  created_by: string | null;           // admin_users.id
  created_at: TimestampDefault;
  updated_at: TimestampDefault;
}

/** The sign-ins and scans per whole UTC hour, country (ZZ unknown) and tier (migration 0023, G3): aggregates, no account. */
export interface ActivityHourlyTable {
  hour: Timestamp;
  country: string;
  tier: number;                        // 0..3
  sign_ins: WithDefault<number>;
  scans: WithDefault<number>;
}

/**
 * A collector's conversation with ORBES Client Services (migration 0025, CS-01): one per account. `waiting_since` is set
 * exactly while TO_ANSWER, `closed_at` and `closed_by` exactly while CLOSED. id, account_id and created_at never change.
 */
export interface ClientConversationsTable {
  id: Generated<string>;
  account_id: string;
  status: WithDefault<ClientConversationStatus>;
  /** The staff member who answers it (admin_users.id), or null. */
  answered_by: string | null;
  waiting_since: TimestampNullable;
  last_message_at: Timestamp;
  /** Up to when the collector has read the answers; null before the first reading. */
  collector_read_at: TimestampNullable;
  closed_at: TimestampNullable;
  closed_by: string | null;            // admin_users.id
  created_at: TimestampDefault;
}

/**
 * A message of a conversation (migration 0025, CS-01): the collector's words or a staff member's answer, plain text, with
 * what a collector's message concerns (a snapshot label and the row it names). Never changed (but `scan_event_id`,
 * cleared by the scan retention), never deleted.
 */
export interface ClientMessagesTable {
  id: Generated<string>;
  conversation_id: string;
  author: ClientMessageAuthor;
  /** The staff member, exactly on a STAFF message (admin_users.id). */
  admin_id: string | null;
  body: string;                        // 1..4 000 characters once trimmed (a collector's: 2 000)
  context_kind: ClientMessageContext | null;
  context_label: string | null;        // 1..120 characters, exactly with context_kind
  product_id: string | null;
  order_id: string | null;
  drop_id: string | null;
  model_id: string | null;
  shop_request_id: string | null;
  /** The scan (scan_events.id, no foreign key): cleared when the scan retention deletes the scan. */
  scan_event_id: string | null;
  /** The scan's REF, 8 capital hex characters: kept after the scan is deleted. */
  scan_ref: string | null;
  created_at: TimestampDefault;
}

/**
 * The pool of test accounts (migration 0024_z, TEST ENTRANTS): the tier and seniority the club reads for each instead of
 * its pieces (services/club.ts clubStandings), set by the press that sends it.
 */
export interface TestEntrantsTable {
  account_id: string;
  tier: WithDefault<number>;           // 0..3
  seniority: WithDefault<number>;      // 0..50 full years
  created_at: TimestampDefault;
}

/** A test of a release (migration 0024_z): its presses' settings, its bots counted, its report and peaks. */
export interface TestRunsTable {
  id: Generated<string>;
  drop_id: string;
  mode: DropMode;
  status: WithDefault<TestRunStatus>;
  /** Each press (START, then each ADD MORE), oldest first: its time, its bots and its settings. */
  settings: Jsonb<JsonValue[]>;
  entrants: number;                    // 0..5000
  created_by: string;                  // admin_users.id
  created_at: TimestampDefault;
  ended_at: TimestampNullable;
  ended_by: ColumnType<string | null, string | null | undefined, string | null>; // admin_users.id
  /** The TEST REPORT, computed at END TEST before the clean-up. */
  report: JsonbNullable<JsonObject>;
  /** The test's running maxima while it ran (services/system-status.ts). */
  peaks: JsonbNullable<JsonObject>;
}

/** A bot of a run (migration 0024_z): its network, what it was drawn to do, what it did; a draw's confirmation due. */
export interface TestRunEntrantsTable {
  run_id: string;
  account_id: string;
  /** Its /24 in 100.64.0.0/10 (RFC 6598). */
  network: string;
  plan: Jsonb<JsonObject>;
  outcome: ColumnType<string | null, string | null | undefined, string | null>;
  confirm_due_at: TimestampNullable;
  updated_at: TimestampDefault;
}

/**
 * A new claim code (migration 0034, plan NEXT LOT §3.4): one row per code made by New claim code, or made unseen when a
 * sold piece's order was cancelled. Its identity, target, hash, reason and author never change; it is never deleted. The
 * code itself is never stored, except sealed while a buyer's code waits (`sealed_code`, exactly while WAITING).
 */
export interface ClaimCodeRenewalsTable {
  id: Generated<string>;
  product_id: string;
  kind: ClaimRenewalKind;
  /** BUYER and UNSHOWN: the order it was made for; NULL for STAFF. */
  order_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** BUYER: the order's account at the time; NULL otherwise. */
  account_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** The scrypt hash this row wrote into products.claim_secret_hash: the piece's current code while the two are equal. */
  claim_hash: string;
  /** The buyer's code sealed (crypto/secretbox.ts, AAD `claim-renewal:<id>:<order_id>:<account_id>`), exactly while WAITING. */
  sealed_code: ColumnType<string | null, string | null | undefined, string | null>;
  status: ClaimRenewalStatus;
  read_at: TimestampNullable;
  withdrawn_at: TimestampNullable;
  withdrawn_reason: ColumnType<ClaimRenewalWithdrawnReason | null, ClaimRenewalWithdrawnReason | null | undefined, ClaimRenewalWithdrawnReason | null>;
  /** The staff member's reason, 1..500 characters; NULL exactly for UNSHOWN. Kept in the audit log too. */
  reason: ColumnType<string | null, string | null | undefined, string | null>;
  /** admin_users.id; NULL for the system. */
  created_by: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: TimestampDefault;
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
  live_interest: LiveInterestTable;
  live_messages: LiveMessagesTable;
  live_tier_windows: LiveTierWindowsTable;
  stock_locations: StockLocationsTable;
  admin_user_locations: AdminUserLocationsTable;
  stock_location_countries: StockLocationCountriesTable;
  suppliers: SuppliersTable;
  supplier_orders: SupplierOrdersTable;
  supplier_order_lines: SupplierOrderLinesTable;
  receptions: ReceptionsTable;
  reception_lines: ReceptionLinesTable;
  card_prints: CardPrintsTable;
  supplier_returns: SupplierReturnsTable;
  stock_corrections: StockCorrectionsTable;
  skus: SkusTable;
  stock_movements: StockMovementsTable;
  sku_thresholds: SkuThresholdsTable;
  carriers: CarriersTable;
  boxes: BoxesTable;
  addon_items: AddonItemsTable;
  addon_item_prices: AddonItemPricesTable;
  order_addon_items: OrderAddonItemsTable;
  addon_choices: AddonChoicesTable;
  drop_addons: DropAddonsTable;
  addon_conversions: AddonConversionsTable;
  sets: SetsTable;
  set_models: SetModelsTable;
  drop_entry_sizes: EntrySizesTable;
  live_entry_sizes: EntrySizesTable;
  live_interest_sizes: LiveInterestSizesTable;
  set_sales: SetSalesTable;
  orders: OrdersTable;
  order_events: OrderEventsTable;
  bench_items: BenchItemsTable;
  shipments: ShipmentsTable;
  shipment_items: ShipmentItemsTable;
  order_cases: OrderCasesTable;
  returns: ReturnsTable;
  invoices: InvoicesTable;
  event_journal: EventJournalTable;
  order_alert_settings: OrderAlertSettingsTable;
  club_program_settings: ClubProgramSettingsTable;
  shipping_rates: ShippingRatesTable;
  tier_grants: TierGrantsTable;
  credit_uses: CreditUsesTable;
  care_requests: CareRequestsTable;
  warranty_claims: WarrantyClaimsTable;
  house_guarantees: HouseGuaranteesTable;
  guarantee_settings: GuaranteeSettingsTable;
  account_sizes: AccountSizesTable;
  account_addresses: AccountAddressesTable;
  heard_options: HeardOptionsTable;
  account_profiles: AccountProfilesTable;
  account_tastes: AccountTastesTable;
  account_wishes: AccountWishesTable;
  model_wish_months: ModelWishMonthsTable;
  wish_months_counted: WishMonthsCountedTable;
  geo_places: GeoPlacesTable;
  tracking_devices: TrackingDevicesTable;
  tracking_device_accounts: TrackingDeviceAccountsTable;
  collector_views: CollectorViewsTable;
  view_daily_stats: ViewDailyStatsTable;
  device_daily_stats: DeviceDailyStatsTable;
  collector_places: CollectorPlacesTable;
  collector_view_totals: CollectorViewTotalsTable;
  collector_view_months: CollectorViewMonthsTable;
  tracking_state: TrackingStateTable;
  link_channels: LinkChannelsTable;
  links: LinksTable;
  acquisition_sources: AcquisitionSourcesTable;
  acquisition_touches: AcquisitionTouchesTable;
  account_sources: AccountSourcesTable;
  acquisition_conversions: AcquisitionConversionsTable;
  acquisition_daily: AcquisitionDailyTable;
  acquisition_state: AcquisitionStateTable;
  preregistrations: PreregistrationsTable;
  email_templates: EmailTemplatesTable;
  email_outbox: EmailOutboxTable;
  email_preferences: EmailPreferencesTable;
  email_state: EmailStateTable;
  house_moment_settings: HouseMomentSettingsTable;
  house_messages: HouseMessagesTable;
  house_deliveries: HouseDeliveriesTable;
  worn_photos: WornPhotosTable;
  account_notes: AccountNotesTable;
  account_tags: AccountTagsTable;
  account_scores: AccountScoresTable;
  engagement_runs: EngagementRunsTable;
  collector_history: CollectorHistoryTable;
  model_pairs: ModelPairsTable;
  after_room_guests: AfterRoomGuestsTable;
  release_answers: ReleaseAnswersTable;
  segments: SegmentsTable;
  activity_hourly: ActivityHourlyTable;
  client_conversations: ClientConversationsTable;
  client_messages: ClientMessagesTable;
  test_entrants: TestEntrantsTable;
  test_runs: TestRunsTable;
  test_run_entrants: TestRunEntrantsTable;
  claim_code_renewals: ClaimCodeRenewalsTable;
  revocations: RevocationsTable;
  audit_logs: AuditLogsTable;
  product_overview: ProductOverviewView;
  stock_holds: StockHoldsView;
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
export type SetRow = Selectable<SetsTable>;
export type SetSaleRow = Selectable<SetSalesTable>;
export type LiveEntryRow = Selectable<LiveEntriesTable>;
export type LiveEntryUpdate = Updateable<LiveEntriesTable>;
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
export type ShipmentRow = Selectable<ShipmentsTable>;
export type ShipmentItemRow = Selectable<ShipmentItemsTable>;
export type OrderCaseRow = Selectable<OrderCasesTable>;
export type EventJournalRow = Selectable<EventJournalTable>;
export type AfterRoomGuestRow = Selectable<AfterRoomGuestsTable>;
export type ReleaseAnswerRow = Selectable<ReleaseAnswersTable>;
export type SegmentRow = Selectable<SegmentsTable>;
export type ActivityHourlyRow = Selectable<ActivityHourlyTable>;
export type ClientConversationRow = Selectable<ClientConversationsTable>;
export type ClientMessageRow = Selectable<ClientMessagesTable>;
export type ClubProgramSettingsRow = Selectable<ClubProgramSettingsTable>;
export type ShippingRateRow = Selectable<ShippingRatesTable>;
export type AccountAddressRow = Selectable<AccountAddressesTable>;
export type HeardOptionRow = Selectable<HeardOptionsTable>;
export type AccountProfileRow = Selectable<AccountProfilesTable>;
export type AccountTasteRow = Selectable<AccountTastesTable>;
export type AccountWishRow = Selectable<AccountWishesTable>;
export type ModelWishMonthRow = Selectable<ModelWishMonthsTable>;
export type GeoPlaceRow = Selectable<GeoPlacesTable>;
export type TrackingDeviceRow = Selectable<TrackingDevicesTable>;
export type TrackingDeviceAccountRow = Selectable<TrackingDeviceAccountsTable>;
export type CollectorViewRow = Selectable<CollectorViewsTable>;
export type NewCollectorView = Insertable<CollectorViewsTable>;
export type ViewDailyStatsRow = Selectable<ViewDailyStatsTable>;
export type DeviceDailyStatsRow = Selectable<DeviceDailyStatsTable>;
export type CollectorPlaceRow = Selectable<CollectorPlacesTable>;
export type CollectorViewTotalRow = Selectable<CollectorViewTotalsTable>;
export type CollectorViewMonthRow = Selectable<CollectorViewMonthsTable>;
export type TrackingStateRow = Selectable<TrackingStateTable>;
export type LinkChannelRow = Selectable<LinkChannelsTable>;
export type LinkRow = Selectable<LinksTable>;
export type AcquisitionSourceRow = Selectable<AcquisitionSourcesTable>;
export type AcquisitionTouchRow = Selectable<AcquisitionTouchesTable>;
export type AccountSourceRow = Selectable<AccountSourcesTable>;
export type AcquisitionConversionRow = Selectable<AcquisitionConversionsTable>;
export type AcquisitionDailyRow = Selectable<AcquisitionDailyTable>;
export type AcquisitionStateRow = Selectable<AcquisitionStateTable>;
export type AccountNoteRow = Selectable<AccountNotesTable>;
export type AccountTagRow = Selectable<AccountTagsTable>;
export type AccountScoreRow = Selectable<AccountScoresTable>;
export type EngagementRunRow = Selectable<EngagementRunsTable>;
export type CollectorHistoryRow = Selectable<CollectorHistoryTable>;
export type TierGrantRow = Selectable<TierGrantsTable>;
export type CreditUseRow = Selectable<CreditUsesTable>;
export type CareRequestRow = Selectable<CareRequestsTable>;
export type WarrantyClaimRow = Selectable<WarrantyClaimsTable>;
export type HouseGuaranteeRow = Selectable<HouseGuaranteesTable>;
export type GuaranteeSettingsRow = Selectable<GuaranteeSettingsTable>;
export type TestEntrantRow = Selectable<TestEntrantsTable>;
export type TestRunRow = Selectable<TestRunsTable>;
export type TestRunEntrantRow = Selectable<TestRunEntrantsTable>;
export type SupplierRow = Selectable<SuppliersTable>;
export type SupplierOrderRow = Selectable<SupplierOrdersTable>;
export type SupplierOrderLineRow = Selectable<SupplierOrderLinesTable>;
export type ReceptionRow = Selectable<ReceptionsTable>;
export type ReceptionLineRow = Selectable<ReceptionLinesTable>;
export type CardPrintRow = Selectable<CardPrintsTable>;
export type SupplierReturnRow = Selectable<SupplierReturnsTable>;
export type StockCorrectionRow = Selectable<StockCorrectionsTable>;
export type ClaimCodeRenewalRow = Selectable<ClaimCodeRenewalsTable>;
export type NewClaimCodeRenewal = Insertable<ClaimCodeRenewalsTable>;
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
