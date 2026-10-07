/**
 * Wire types of the public verification API, as the browser sees them
 * (PLATFORM-CONTRACTS §2.4, §3). Declared here rather than imported from
 * src/server so the web bundle never depends on server modules; a type-level
 * test (test/web/verify.types.test.ts) keeps the two in step.
 *
 * Dates arrive as ISO strings (JSON).
 */

export type VerificationState =
  | 'AUTHENTIC'
  | 'AUTHENTIC_FIRST_REGISTRATION'
  | 'AUTHENTIC_REGISTERED'
  | 'AUTHENTIC_OWNERSHIP_VERIFIED'
  | 'SUSPICIOUS_ACTIVITY'
  | 'REVOKED'
  | 'UNKNOWN'
  | 'INVALID_SIGNATURE'
  | 'MALFORMED_CODE';

export const VERIFICATION_STATES: readonly VerificationState[] = [
  'AUTHENTIC',
  'AUTHENTIC_FIRST_REGISTRATION',
  'AUTHENTIC_REGISTERED',
  'AUTHENTIC_OWNERSHIP_VERIFIED',
  'SUSPICIOUS_ACTIVITY',
  'REVOKED',
  'UNKNOWN',
  'INVALID_SIGNATURE',
  'MALFORMED_CODE',
];

export type Assurance = 'CODE' | 'CODE_ONLY' | 'CODE_AND_HARDWARE';
export type WarrantyStatus = 'NOT_STARTED' | 'ACTIVE' | 'EXPIRED' | 'VOID';

export interface VerifyInput {
  code: string;
  genome?: { glyphs: (number | null)[]; confidence?: number[] };
  client?: { rsErrors?: number; rsErasures?: number; moduleSizePx?: number; decodeMs?: number; source?: 'camera' | 'upload' };
}

export interface VerifyOutcome {
  state: VerificationState;
  scanId: string;
  verifiedAt: string;
  title: string;
  message: string;
  notice?: 'UNUSUAL_ACTIVITY';
  verification?: {
    signature: 'VALID';
    keyId: number;
    codeVersion: string;
    genomeVersion: string;
    issuedAt: string;
    issue: number;
    assurance: Assurance;
    hardwareProofRequired?: boolean;
  };
  product?: {
    productId: string;
    category: { code: string; name: string };
    collection?: string;
    model: string;
    /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), when it has one. */
    modelVariant?: string;
    type: string;
    /** The piece's free-text field set at issuance: its size (SIZE), as written. */
    variant?: string;
    material: string;
    createdYear: number;
    productionDate?: string;
    care?: string;
    /** The model's reference photograph (F-04): `/api/v1/media/<sha256>`. Authentic results only; never the piece's own (decision 9). */
    imageUrl?: string;
    /** Its model's sheet in the lookbook (P-R02): the `<slug>` of `/verify/lookbook/<slug>`, when the model is PUBLIC there. */
    lookbook?: string;
    /** The year its model was discontinued (P-R06): « DISCONTINUED · <year> » under the product lines. Authentic results only. */
    discontinuedYear?: number;
  };
  genome?: { id: string; version: string; fingerprint: string; glyphs: number[]; ids: string[] };
  warranty?: { status: WarrantyStatus; startDate?: string; endDate?: string };
  ownership?: { registered: boolean; you: boolean; transferPending?: boolean };
  registration?: { token: string; expiresAt: string; claimCodeRequired: boolean };
  /**
   * F-03: this scan's transfer window, for the transfer code of this piece (POST /api/v1/ownership/transfers/accept).
   * Only for a signed-in reader who is not the owner, while a transfer of the piece is pending.
   */
  transfer?: { token: string; expiresAt: string };
  /** A staff scan (S-07): this browser is signed in to the ORBES console. No report, no registration. */
  staffScan?: true;
}

/**
 * GET /api/v1/client-services: how ORBES Client Services is reached, and where SUBSCRIBE of ORBES Care leads (P-M02,
 * CARE_SUBSCRIBE_URL); `{}` when nothing is configured.
 */
export interface ClientServices {
  email?: string;
  phone?: string;
  hours?: string;
  /** An https:// page, opened in a new tab from the CARE tab of MY PIECES; absent: "Subscriptions open soon". */
  careSubscribeUrl?: string;
}

/** Where the customer saw or bought the piece of a result that was not authentic (POST /api/v1/reports). */
export type ReportChannel = 'BOUTIQUE' | 'ONLINE' | 'PRIVATE' | 'OTHER';

export const REPORT_CHANNELS: readonly ReportChannel[] = ['BOUTIQUE', 'ONLINE', 'PRIVATE', 'OTHER'];

/** POST /api/v1/reports: attached to the scan, within 24 hours of it. */
export interface ReportInput {
  scanId: string;
  channel: ReportChannel;
  /** The boutique, the website, the city (≤ 200 characters). */
  where?: string;
  /** ≤ 500 characters. */
  note?: string;
}

export interface AccountInfo {
  email: string;
  displayName: string | null;
}

export interface SessionInfo {
  account: AccountInfo;
  csrfToken: string;
}

/** POST /api/v1/account/recover (C-04): no session is opened; new transfers out of the account are paused until then. */
export interface RecoveryResult {
  ok: true;
  transfersPausedUntil: string;
}

export interface OwnershipConfirmation {
  productId: string;
  verified: boolean;
  since: string;
}

export interface TransferOffer {
  transferCode: string;
  expiresAt: string;
}

/** What an owner declares in MY PIECES (POST /api/v1/ownership/incidents). */
export type IncidentType = 'LOST' | 'STOLEN';

export const INCIDENT_TYPES: readonly IncidentType[] = ['LOST', 'STOLEN'];

/** One piece of GET /api/v1/account/products (API §10.5): the signed-in owner's own view, no internal status. */
export interface OwnedPiece {
  productId: string;
  category: { code: string; name: string };
  collection: string | null;
  model: string;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), or null. */
  modelVariant?: string | null;
  type: string;
  /** The piece's free-text field set at issuance: its size (SIZE), as written. */
  variant: string | null;
  material: string;
  createdYear: number;
  acquiredVia: 'FIRST_REGISTRATION' | 'TRANSFER' | 'RESALE' | 'ADMIN';
  verified: boolean;
  since: string;
  transfer: { pending: boolean; expiresAt?: string };
  /** LOST or STOLEN while the piece is reported, else null. */
  incident: IncidentType | null;
  /** A LOST its owner reported: PIECE FOUND withdraws it (POST /api/v1/ownership/incidents/resolve). */
  incidentResolvable: boolean;
  /**
   * REPORT LOST / STOLEN may be offered: false while the piece is reported, and for a piece the server would refuse to
   * report (revoked, retired or flagged: 409 INCIDENT_NOT_ALLOWED). MY PIECES then points to ORBES Client Services.
   */
  incidentReportable: boolean;
  inService: boolean;
  /**
   * A link to an ownership certificate may be created (F-06): false while the piece is reported lost or stolen, or
   * revoked or retired, where creation is refused (409 CERTIFICATE_NOT_ALLOWED). MY PIECES then leaves the section out.
   */
  certificateAllowed: boolean;
  /** `version` is an integer here (1), `pattern` the glyph ids joined by "·". */
  genome: { id: string; version: number; fingerprint: string; glyphs: number[]; pattern: string } | null;
  warranty: { status: WarrantyStatus; startDate?: string; endDate?: string };
  /** The model's reference photograph (F-04): `/api/v1/media/<sha256>`, or null; never the piece's own (decision 9). */
  imageUrl: string | null;
  /** NOCTURNE N3, N6: its model's lookbook sheet (`<slug>`) when the model is PUBLIC there, or RESERVED and the account's tier reaches it, else null. */
  lookbook?: string | null;
  /** The model's care instructions (P-M02, the CARE tab of MY PIECES); null: the general care text of /verify. */
  care: string | null;
  /**
   * NOCTURNE, addition 2: where the piece comes from, its order of this account and the release it was sold in; null
   * for a piece without one (a boutique sale). Absent from a server before it: nothing is said.
   */
  origin?: PieceOrigin | null;
}

/** Where a piece of the account comes from (OwnedPiece.origin). */
export interface PieceOrigin {
  /** The release it was sold in and when it took place (a draw: drawn; a LIVE RELEASE: its T0); null for the private salon. */
  release: { id: string; mode: 'DRAW' | 'LIVE'; at: string } | null;
  /** ORDER OR-…, where it was sold, its step now and when it reached it. */
  order: { reference: string; channel: OrderChannel; status: OrderStatus; at: string };
}

/** One after-sales service of a piece (GET /api/v1/products/:productId/service-history), without staff notes. */
export interface ServiceRecord {
  id: string;
  type: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  location: string | null;
  openedAt: string;
  closedAt: string | null;
}

/** A shipment of a yearly care (BP-19 T6): its carrier, its tracking number and link, when it left. */
export interface CareShipment {
  carrier: { id: string; name: string };
  tracking: string;
  trackingUrl: string;
  at: string;
}

export type CareRequestStatus = 'REQUESTED' | 'LABEL_SENT' | 'RECEIVED' | 'RETURNING' | 'DONE' | 'CANCELLED';

/** A yearly care request of the account's, as it reads it. */
export interface CareRequestView {
  id: string;
  status: CareRequestStatus;
  year: number;
  requestedAt: string;
  returnName: string;
  returnAddress: string;
  /** The prepaid label, and whether its PDF can still be downloaded. */
  label: (CareShipment & { pdf: boolean }) | null;
  receivedAt: string | null;
  return: CareShipment | null;
  doneAt: string | null;
  cancelledAt: string | null;
}

/** GET /api/v1/account/products/:productId/care: the yearly care of a piece for the account (BP-19 T6). */
export interface PieceCare {
  year: number;
  tier: string | null;
  /** Pieces a year: a number (0: none), or ALL. */
  allowance: number | 'ALL';
  used: number;
  request: CareRequestView | null;
  reason: 'AVAILABLE' | 'NOT_INCLUDED' | 'USED' | 'PIECE_DONE' | 'UNAVAILABLE';
  /** The buyer name and address of the account's last order, to prefill the request's form; null without one. */
  addressHint?: { name: string; address: string } | null;
}

/** POST /api/v1/ownership/incidents. */
export interface IncidentReport {
  productId: string;
  type: IncidentType;
  reportedAt: string;
}

/** POST /api/v1/ownership/incidents/resolve: a loss withdrawn by the owner who reported it. */
export interface IncidentResolution {
  productId: string;
  type: 'LOST';
  resolvedAt: string;
}

/** POST /api/v1/ownership/certificates (F-06): the link to a certificate of the piece, shown once. */
export interface CertificateOffer {
  id: string;
  productId: string;
  /** The link's token: 52 Crockford base32 characters, the fragment of `url`. */
  token: string;
  /** `{origin}/verify/c#{token}`. */
  url: string;
  createdAt: string;
  expiresAt: string;
}

/** One open link of GET /api/v1/ownership/certificates: not withdrawn, not expired, of a piece the account owns. */
export interface OwnerCertificate {
  id: string;
  productId: string;
  createdAt: string;
  expiresAt: string;
  /** False once the piece has been reported lost or stolen since the link was created: it shows NO LONGER VALID. */
  valid: boolean;
}

/** The piece as an ownership certificate shows it: never a name, an email or an account. */
export interface CertificatePiece {
  productId: string;
  category: { code: string; name: string };
  collection: string | null;
  model: string;
  type: string;
  variant: string | null;
  material: string;
  createdYear: number;
  genome: { id: string; version: number; fingerprint: string; glyphs: number[]; pattern: string } | null;
  /** The year its model was discontinued (P-R06), or null. */
  discontinuedYear: number | null;
}

/** POST /api/v1/certificates/lookup (F-06): the record read now, or NO_LONGER_VALID; an unknown or withdrawn link is a 404. */
export type CertificateLookup =
  | {
      status: 'VALID';
      checkedAt: string;
      certificate: { issuedAt: string; expiresAt: string };
      piece: CertificatePiece;
      /** `since`: the day the ownership began, YYYY-MM-DD. */
      ownership: { verified: boolean; since: string };
      warranty: { status: WarrantyStatus; startDate?: string; endDate?: string };
      incidentReported: false;
    }
  | { status: 'NO_LONGER_VALID'; checkedAt: string };

/** A file the server sends as an attachment (the certificate's PDF). */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** THE PRIVATE SALON locked below the account's tier (plan NOCTURNE, screen 5): the lowest tier that opens it, and its pieces. */
export interface SalonOpening {
  level: 2 | 3;
  name: ClubTierName;
  /** The pieces held it starts from. */
  pieces: number;
}

/**
 * GET /api/v1/club/lookbook (P-X08): THE PRIVATE SALON's models the account's tier reaches; when it reaches none, what
 * opens the salon (`opensAt`, never a model), null when nothing above the account's tier is offered.
 */
export interface ClubLookbook {
  models: LookbookCard[];
  opensAt: SalonOpening | null;
}

/** One model of the lookbook's lists (P-R02: GET /api/v1/lookbook, GET /api/v1/club/lookbook): no story. */
export interface LookbookCard {
  slug: string;
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  /** The model's reference photograph, else the first of its gallery: `/api/v1/media/<sha256>`, or null. */
  imageUrl: string | null;
  /** P-X08, THE PRIVATE SALON's cards only (GET /api/v1/club/lookbook): the price shown, or null. */
  priceLabel?: string | null;
  /** P-X08: the lowest tier the model is shown to, 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  minTier?: number;
  /** NOCTURNE N1: this model's own dot among its variants (its label and colour), or null. */
  variant?: VariantDot | null;
  /** NOCTURNE N1: the dots of its group shown in this list, the main model first; empty for a model alone. */
  variants?: LookbookCardVariant[];
  /** NOCTURNE N3: the latest first shown of its models in this list (NOW leads with the newest), or null. */
  publishedAt?: string | null;
  /** NOCTURNE N3 (addition 8): the sizes of its models, from their SKUs (`16`, `17`, `18`); none in one size. */
  sizes?: string[];
}

/** A model's dot among its variants (NOCTURNE N1): its label (« Steel ») and colour (#RRGGBB). */
export interface VariantDot {
  label: string;
  swatch: string;
}

/** One dot of an entry of the lookbook's lists (NOCTURNE N1): a model of the group by the address of its sheet. */
export interface LookbookCardVariant extends VariantDot {
  slug: string;
  name: string;
  type: string;
  imageUrl: string | null;
  priceLabel?: string | null;
  minTier?: number;
  /** NOCTURNE N3: when it was first shown, or null. */
  publishedAt?: string | null;
}

/** A model of a sheet's group (NOCTURNE N1): what the sheet switches to with its dot. */
export interface LookbookSheetVariant extends VariantDot {
  slug: string;
  /** The model whose address was asked. */
  selected: boolean;
  lookbook: 'PUBLIC' | 'RESERVED';
  name: string;
  type: string;
  collection: string | null;
  coverUrl: string | null;
  gallery: { url: string; alt: string | null }[];
  /** NOCTURNE N6: its own story (each variant may have its own); absent from a server before N6: the sheet's. */
  story?: string | null;
  specs: { label: string; value: string }[];
  care: string | null;
  discontinuedYear: number | null;
  salon?: { priceLabel: string | null; minTier: number; request?: ShopRequest | null };
}

/** An account's request for a model of the private salon (P-X08), as its sheet and REQUEST THIS PIECE give it. */
export interface ShopRequest {
  id: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  /** The model requested: what WRITE TO ORBES CLIENT SERVICES attaches on its sheet (CS-01). */
  modelId: string;
}

/** A model's sheet (P-R02: GET /api/v1/lookbook/:slug, or the club's for an owner). */
export interface LookbookSheet {
  slug: string;
  /** RESERVED: shown to the owners of a piece only, through the club. */
  lookbook: 'PUBLIC' | 'RESERVED';
  name: string;
  type: string;
  category: { code: string; name: string };
  collection: string | null;
  /** The reference photograph, shown first, or null. */
  coverUrl: string | null;
  /** The gallery, in its order; `alt` null: the sheet says what it shows. */
  gallery: { url: string; alt: string | null }[];
  /** Plain paragraphs (shared/lookbook.ts storyParagraphs), or null. */
  story: string | null;
  specs: { label: string; value: string }[];
  /** The model's care instructions; null: the general care text. */
  care: string | null;
  /** The year the model was discontinued (P-R06), or null. */
  discontinuedYear: number | null;
  /**
   * P-X08, a RESERVED sheet read through the club (THE PRIVATE SALON): its price (or null), the lowest tier it is shown
   * to, and the account's open request (null: none, REQUEST THIS PIECE is offered).
   */
  salon?: { priceLabel: string | null; minTier: number; request?: ShopRequest | null };
  /** NOCTURNE N1: this model's own dot among its variants, or null. */
  variant?: VariantDot | null;
  /** NOCTURNE N1: the dots of its group the reader may see, the main model first, this one `selected`; empty for a model alone. */
  variants?: LookbookSheetVariant[];
  /** NOCTURNE N3 (addition 8): the sizes of the models of its group, from their SKUs; none in one size. */
  sizes?: string[];
}

/** A release's state as the public reads it (P-R03): a DRAFT is never sent. */
export type DropState = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'DRAWN' | 'CANCELLED';

export const DROP_STATES: readonly DropState[] = ['UPCOMING', 'OPEN', 'CLOSED', 'DRAWN', 'CANCELLED'];

/** An entry's status (P-R03): ENTERED, WITHDRAWN; drawn SELECTED or WAITLISTED; then CONFIRMED or LAPSED. */
export type DropEntryStatus = 'ENTERED' | 'SELECTED' | 'WAITLISTED' | 'CONFIRMED' | 'LAPSED' | 'WITHDRAWN';

export const DROP_ENTRY_STATUSES: readonly DropEntryStatus[] = ['ENTERED', 'SELECTED', 'WAITLISTED', 'CONFIRMED', 'LAPSED', 'WITHDRAWN'];

/** The model of a release: `lookbook` is the `<slug>` of its sheet when the model is PUBLIC in the lookbook. */
export interface DropModel {
  name: string;
  type: string;
  collection: string | null;
  /** The model's reference photograph: `/api/v1/media/<sha256>`, or null. */
  imageUrl: string | null;
  lookbook: string | null;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), or null. */
  variant?: string | null;
}

/** One release of GET /api/v1/drops (P-R03). */
export interface DropCard {
  id: string;
  title: string;
  state: DropState;
  model: DropModel;
  quantity: number;
  opensAt: string;
  closesAt: string;
  /** P-X02: PALLADIUM's hours of early access before `opensAt` (0: none). */
  earlyAccessHours: number;
  /** BP-19 T3: PLATINE's hours (PALLADIUM's for a release published before the windows by tier). */
  earlyAccessPlatineHours?: number;
  /** When PALLADIUM may reserve a place directly, the first; null without an early access. */
  earlyAccessOpensAt: string | null;
  /** BP-19 T3: when PLATINE may; null without one for PLATINE. */
  earlyAccessPlatineOpensAt?: string | null;
  /** Whether direct reservations are open now, from PALLADIUM's time (the server's clock). */
  earlyAccessOpen: boolean;
  /** BP-19 T3: whether PLATINE's are open now. */
  earlyAccessPlatineOpen?: boolean;
  /** NOCTURNE (addition 5): the price of a piece in minor units with its currency; null for both when ORBES gave none. */
  priceMinor?: number | null;
  currency?: string | null;
}

/** A release's page (GET /api/v1/drops/:id): the seed's SHA-256 from the publication, the seed itself once drawn. */
export interface DropSheet extends DropCard {
  description: string | null;
  purchaseWindowHours: number;
  publishedAt: string;
  cancelledAt: string | null;
  drawnAt: string | null;
  /** SHA-256 of the seed, 64 hexadecimal characters. */
  seedHash: string;
  /** The 32-byte seed in hexadecimal, once drawn; null before. */
  seed: string | null;
  /** P-X02: the places reserved directly during the early access, held or sold; at `quantity`, the release is full (0 once drawn). */
  reserved: number;
}

/** One entry of a drawn release (GET /api/v1/drops/:id/entries): never its account. `tier` 0 is no tier. */
export interface DrawEntry {
  id: string;
  tier: number;
  seniority: number;
  rank: number;
}

/** A release of THE RELEASES' PAST (GET /api/v1/releases/past, plan LIVE RELEASE+ choice 5): what was announced, no end figure. */
export interface PastRelease {
  id: string;
  kind: 'LIVE' | 'DRAW';
  /** The release's title; a LIVE RELEASE's null when it ended before its name's stage. */
  title: string | null;
  /** `variant` (NOCTURNE N1): the model's label among its variants, from the name's stage; null otherwise. */
  model: { name: string | null; type: string | null; collection: string | null; variant?: string | null };
  /** `/api/v1/media/<sha256>`, or null. */
  imageUrl: string | null;
  /** The opening: a LIVE RELEASE's T0, a draw's opening of its entries. */
  opensAt: string;
  /** The quantity as announced (« 25 PIECES »). */
  quantityLine: string;
}

/** A page of GET /api/v1/releases/past, the newest first. */
export interface PastReleasesPage {
  items: PastRelease[];
  page: number;
  pageSize: number;
  total: number;
}

/** The releases the signed-in account took part in (GET /api/v1/account/participation). */
export interface Participation {
  /** « You have taken part in N releases ». */
  count: number;
  /** Each release once, an after-room's under the release it follows; `secured`: a piece secured there. */
  releases: { id: string; secured: boolean }[];
}

/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11; GET /api/v1/live/:id/question, GET
 * /api/v1/account/questions, PUT /api/v1/live/:id/answer): asked for 7 days from the release's end, on its end page to
 * those who took part without a piece (TOOK_PART), in MY PIECES to those who said I'LL BE THERE and did not come
 * (INTEREST); `answer` the position of the answer chosen, from 1, or null.
 */
export interface AccountQuestion {
  dropId: string;
  /** The model's name once revealed: how MY PIECES names the release; null when it ended before its name. */
  name: string | null;
  opensAt: string;
  text: string;
  answers: string[];
  answer: number | null;
  closesAt: string;
  asked: 'TOOK_PART' | 'INTEREST';
}

/** A page of GET /api/v1/drops/:id/entries, by rank. */
export interface DrawEntriesPage {
  items: DrawEntry[];
  page: number;
  pageSize: number;
  total: number;
}

/** One entry of the signed-in account (GET /api/v1/club/status, POST …/enter and …/withdraw): its id is the one the draw publishes. */
export interface ClubEntry {
  id: string;
  dropId: string;
  title: string;
  state: DropState;
  status: DropEntryStatus;
  enteredAt: string;
  rank: number | null;
  respondBy: string | null;
  /** P-X02: a place reserved directly during the early access, not drawn. */
  reserved: boolean;
  opensAt: string;
  closesAt: string;
  drawnAt: string | null;
}

/** A tier of the club by name: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
export type ClubTierName = 'TITANE' | 'PLATINE' | 'PALLADIUM';

/** P-X04: the tier after the account's: the pieces it starts from, how many more the account needs, what it adds. */
export interface ClubNextTier {
  level: 1 | 2 | 3;
  name: ClubTierName;
  pieces: number;
  missing: number;
  benefits: string[];
}

/**
 * GET /api/v1/club/status (P-R03): the account's tier now (0: no piece; TITANE, PLATINE, PALLADIUM), and its entries;
 * P-X04: the benefits of its tier and of those below it (lowest first), and the next tier (null at PALLADIUM);
 * plan NEXT-NINE (BP-19 T1): the pieces each tier starts from, TITANE first ([1, 5, 10]), whose last sets the meter.
 */
export interface ClubStatus {
  tier: { level: 0 | 1 | 2 | 3; name: ClubTierName | null };
  pieces: number;
  seniority: number;
  benefits: string[];
  next: ClubNextTier | null;
  tierThresholds: number[];
  entries: ClubEntry[];
}

/** A post of the owners' circle (P-X01): a NOTE, an INVITATION (answered YES or NO) or a POLL (one vote). */
export type CirclePostKind = 'NOTE' | 'INVITATION' | 'POLL';

export const CIRCLE_POST_KINDS: readonly CirclePostKind[] = ['NOTE', 'INVITATION', 'POLL'];

/** An answer to an invitation of the circle. */
export type CircleAnswer = 'YES' | 'NO';

export const CIRCLE_ANSWERS: readonly CircleAnswer[] = ['YES', 'NO'];

/** A photograph of a post: `/api/v1/media/<sha256>`; `alt` null, the post's default. */
export interface CirclePhoto {
  url: string;
  alt: string | null;
}

/** One post of the feed (GET /api/v1/club/circle): never its body. */
export interface CircleCard {
  id: string;
  kind: CirclePostKind;
  title: string;
  /** The lowest tier that reads it: 1 TITANE, 2 PLATINE, 3 PALLADIUM. */
  minTier: number;
  /** An invitation's experience of the tier program (plan NEXT-NINE, BP-19 T7), shown above its title; null otherwise. */
  experience?: 'MEMBERS_EVENING' | 'LAUNCH_PREVIEW' | 'PARTNER_EXPERIENCE' | null;
  publishedAt: string;
  cover: CirclePhoto | null;
  eventAt: string | null;
  eventPlace: string | null;
  /** The reader's answer to an invitation, null without one. */
  answer: CircleAnswer | null;
  /** Whether the reader voted in a poll. */
  voted: boolean;
  /** NOCTURNE (addition 6): an invitation's places (`placesLeft` of `capacity`, null without a limit) and whether answers are open. */
  invitation?: { capacity: number | null; placesLeft: number | null; open: boolean } | null;
}

/** A page of the feed. */
export interface CircleFeed {
  items: CircleCard[];
  page: number;
  pageSize: number;
  total: number;
}

/** A post (GET /api/v1/club/circle/:id, and the answer to POST …/rsvp and …/vote). */
export interface CirclePost extends CircleCard {
  body: string | null;
  photos: CirclePhoto[];
  invitation: { eventAt: string; place: string | null; capacity: number | null; placesLeft: number | null; open: boolean } | null;
  /** `results` only once the reader voted. */
  poll: { options: string[]; vote: number | null; results: { counts: number[]; total: number } | null } | null;
  links: {
    drop: { id: string; title: string } | null;
    model: { slug: string; name: string; type: string } | null;
    external: { url: string; host: string } | null;
  };
}

// ── The LIVE RELEASES (plan of 2026-10-04; GET /api/v1/live…, services/live-room.ts) ─────────────────────────────────

/** Where an announced LIVE RELEASE stands for the public: announced, its room open, live; or over (its page only). */
export type LivePhase = 'ANNOUNCED' | 'ROOM' | 'LIVE';

/** The ways a LIVE RELEASE ends. */
export type LiveEndReason = 'SOLD_OUT' | 'CLOSED' | 'ENDED';

export const LIVE_END_REASONS: readonly LiveEndReason[] = ['SOLD_OUT', 'CLOSED', 'ENDED'];

/** An entry's status in a LIVE RELEASE (live_entries.status). */
export type LiveEntryStatus = 'WAITING' | 'QUEUED' | 'TURN' | 'SECURED' | 'CONFIRMED' | 'MISSED' | 'EXPIRED' | 'RELEASED' | 'LEFT' | 'REMOVED' | 'ENDED';

export const LIVE_ENTRY_STATUSES: readonly LiveEntryStatus[] = ['WAITING', 'QUEUED', 'TURN', 'SECURED', 'CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'LEFT', 'REMOVED', 'ENDED'];

/** A stage of the staged reveals: the silhouette, the name, the photograph. */
export type LiveRevealStage = 'SILHOUETTE' | 'NAME' | 'PHOTO';

/** A LIVE RELEASE in THE RELEASES (GET /api/v1/live): each stage only from its time (null before). */
export interface LiveCard {
  id: string;
  kind: 'LIVE';
  phase: LivePhase;
  revealed: { silhouette: boolean; name: boolean; photo: boolean };
  stages: { silhouetteAt: string; nameAt: string; photoAt: string };
  /** The calendar of the reveals still to come, in order: each stage that will show something, and its time. */
  reveals: { stage: LiveRevealStage; at: string }[];
  title: string | null;
  name: string | null;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), from the name's stage; null otherwise. */
  variant?: string | null;
  type: string | null;
  collection: string | null;
  silhouetteUrl: string | null;
  imageUrl: string | null;
  lookbook: string | null;
  announcedAt: string;
  roomOpensAt: string;
  /** T0. */
  opensAt: string;
  closesAt: string;
  priceMinor: number;
  currency: string;
  /** The quantity as the console wrote it (« 25 PIECES »). */
  quantityLine: string;
  perAccount: number;
  /** The lowest tier allowed (0 any account), and every rule in words after « for » (joined by « or » when any one is enough). */
  access: { minTier: number; text: string };
  /** A surprise in every box: the page says so, never what. */
  surprise: boolean;
  /** I'LL BE THERE: how many accounts said so (public). */
  interest: number;
}

/**
 * A LIVE RELEASE's page (GET /api/v1/live/:id) while it is announced, in its room, or live; ENDED while a turn or a
 * hold still runs to its deadline after the end.
 */
export interface LiveSheet extends Omit<LiveCard, 'phase'> {
  phase: LivePhase | 'ENDED';
  description: string | null;
  sizes: { id: string; label: string; stock: number }[];
  addons: { id: string; label: string; line: string | null; priceMinor: number }[];
  roomOpensMinutes: number;
  turnSeconds: number;
  payMinutes: number;
  tierPriority: boolean;
  /** An after-room's page (GET /api/v1/live/:id/after-room): the release it follows; absent on a release's own. */
  afterRoom?: AfterRoomOf;
}

/**
 * A LIVE RELEASE's page once it is over, in its final state (plan LIVE RELEASE+, decision 30): what was announced, each
 * part from its stage, its opening and its quantity line; never an end figure.
 */
export interface LiveEndedSheet {
  id: string;
  kind: 'LIVE';
  phase: 'ENDED';
  title: string | null;
  name: string | null;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), from the name's stage; null otherwise. */
  variant?: string | null;
  type: string | null;
  collection: string | null;
  description: string | null;
  silhouetteUrl: string | null;
  imageUrl: string | null;
  lookbook: string | null;
  /** T0. */
  opensAt: string;
  /** The quantity line as announced (« 25 PIECES »). */
  quantityLine: string;
  afterRoom?: AfterRoomOf;
}

/** The release an after-room follows (plan LIVE RELEASE+, choice 2): its page is read through that release's. */
export interface AfterRoomOf {
  parentId: string;
}

/**
 * The second door (an entry's `afterRoom`): on an entry the release's sell-out ENDED while in its line, from the sell-out
 * until the after-room ends, when the door appears and when it closes; the entry's own, nobody else's.
 */
export interface AfterRoomDoor {
  opensAt: string;
  closesAt: string;
}

/** The banner of /verify and MY PIECES (GET /api/v1/live/next): the release live now, else the room open, else the next. */
export interface LiveBanner {
  id: string;
  phase: LivePhase;
  /** The model's name from its stage; null before. */
  name: string | null;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), from the name's stage; null otherwise. */
  variant?: string | null;
  /** When the name is (or was) revealed. */
  nameAt: string;
  roomOpensAt: string;
  opensAt: string;
  closesAt: string;
}

/**
 * The boutique board (POST /api/v1/live/:id/board, and its stream's `board` events): the countdown, the door, the
 * pieces left overall, the piece by stage; never a person, never the room's count, a host message nor a size.
 */
export interface LiveBoard {
  id: string;
  phase: LivePhase | 'ENDED';
  paused: boolean;
  over: boolean;
  roomOpensAt: string;
  opensAt: string;
  closesAt: string;
  quantity: number;
  quantityLine: string;
  left: number;
  release: { revealed: { silhouette: boolean; name: boolean; photo: boolean }; name: string | null; silhouetteUrl: string | null; imageUrl: string | null };
}

/** A size in the room: its stock, the pieces free now, and those in a turn or held that may return. */
export interface LiveRoomSize {
  id: string;
  label: string;
  stock: number;
  left: number;
  held: number;
}

/** The room as its viewers read it (the stream's `room` event, without its `now`; the state's `room`). */
export interface LiveRoom {
  id: string;
  phase: LivePhase | 'ENDED';
  paused: boolean;
  /** Ended, and no turn or hold left. */
  over: boolean;
  endedReason: LiveEndReason | null;
  roomOpensAt: string;
  opensAt: string;
  closesAt: string;
  inRoom: number;
  line: number;
  quantity: number;
  quantityLine: string;
  left: number;
  held: number;
  sizes: LiveRoomSize[];
  message: { text: string; at: string } | null;
}

/** The signed-in account's entry in a release (the stream's `you` event, the state's `entry`, every action's answer). */
export interface LiveEntry {
  id: string;
  dropId: string;
  status: LiveEntryStatus;
  size: { id: string; label: string };
  quantity: number;
  tier: number;
  /** The place in the line; null before T0. */
  position: number | null;
  /** While QUEUED: the entries of its size before it. */
  ahead: number | null;
  joinedAt: string;
  /** Its deadline as it stands now; the secret only while it is TURN. */
  turn: { at: string; expiresAt: string; token: string | null } | null;
  hold: { securedAt: string; expiresAt: string } | null;
  confirmedAt: string | null;
  endedAt: string | null;
  letIn: boolean;
  addons: { id: string; label: string; priceMinor: number }[];
  currency: string;
  priceMinor: number;
  totalMinor: number;
  /** ENDED by the sell-out while in the line: the after-room's door; null otherwise. */
  afterRoom?: AfterRoomDoor | null;
}

/** The account against the release's rules now. */
export interface LiveAccess {
  allowed: boolean;
  tier: number;
  /** The rule it lacks (the first, or with OR the release's first), null when allowed. */
  missing: 'TIER' | 'PIECE' | 'PARTICIPATION' | 'SEGMENT' | null;
  /** The releases it has taken part in, when the release counts them; null otherwise. */
  participations: number | null;
}

/** I'LL BE THERE, with a size. */
export interface LiveInterest {
  dropId: string;
  size: { id: string; label: string };
  since: string;
}

/** GET /api/v1/live/:id/state: the server's time, the room, the account's standing, entry and interest. */
export interface LiveState {
  now: string;
  room: LiveRoom;
  access: LiveAccess;
  entry: LiveEntry | null;
  interest: LiveInterest | null;
}

/** An entry of the account in MY PIECES (GET /api/v1/live/mine), with its release, each part from its stage. */
export interface LiveAccountEntry {
  release: {
    id: string;
    phase: 'DRAFT' | 'CANCELLED' | 'HIDDEN' | LivePhase | 'ENDED';
    endedReason: LiveEndReason | null;
    title: string | null;
    name: string | null;
    /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), from the name's stage; null otherwise. */
    variant?: string | null;
    imageUrl: string | null;
    opensAt: string;
    closesAt: string;
    /** An after-room's: the release it follows; null otherwise. */
    afterRoomOf: string | null;
  };
  entry: LiveEntry;
}

/** The channel an order was sold through (plan LIVE RELEASE+, choice 6): a LIVE RELEASE, a draw, the private salon. */
export type OrderChannel = 'LIVE' | 'DRAW' | 'SALON' | 'GIFT';
/** The server's order (ORDER_CHANNELS in db/schema.ts). */
export const ORDER_CHANNELS: readonly OrderChannel[] = ['LIVE', 'DRAW', 'SALON', 'GIFT'];

/** An order's step: RESERVED → PAID → SHIPPED → DELIVERED, or CANCELLED, or RETURNED. */
export type OrderStatus = 'RESERVED' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
/** The server's order (ORDER_STATUSES in db/schema.ts). */
export const ORDER_STATUSES: readonly OrderStatus[] = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'];

/**
 * One order of the account in MY PIECES (GET /api/v1/account/orders), one per piece: its steps and their times, the
 * model, the size, the add-ons and the price as sold; once shipped, the carrier and the tracking number with its link.
 */
export interface AccountOrder {
  id: string;
  /** `OR-` and the first eight figures of its id: what ORBES Client Services finds it by. */
  reference: string;
  channel: OrderChannel;
  /** The release it was sold in; null for the private salon. */
  release: string | null;
  model: string;
  /** NOCTURNE N1: the model's label among its variants (« Blue »: MONOLITHE in blue), or null. */
  modelVariant?: string | null;
  /** null while ORBES Client Services has not entered it; `{ label: null }`: one size. */
  size: { label: string | null } | null;
  /** null, with the currency, while ORBES Client Services has not entered it. */
  priceMinor: number | null;
  currency: string | null;
  /** Each at its price per piece. */
  addons: { label: string; priceMinor: number }[];
  /**
   * BP-19 T4: its shipping (STANDARD or EXPRESS, the fee in its currency, the tier that made it free) and, travelling
   * with another order, that order's reference (which carries the fee); null or absent: no shipping.
   */
  shipping?: { service: 'STANDARD' | 'EXPRESS' | null; minor: number | null; benefit: 2 | 3 | null; withOrder: string | null } | null;
  /** BP-19: the reference of the order it travels with (a welcome gift's), or null; absent from a server before it. */
  withOrder?: string | null;
  /** BP-19 T5: a welcome gift's tier (PLATINE, PALLADIUM); null for any other order. */
  giftTier?: 'PLATINE' | 'PALLADIUM' | null;
  /** BP-19 T5: the credit taken off it, in its currency; 0 for none. */
  creditMinor?: number;
  status: OrderStatus;
  reservedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  returnedAt: string | null;
  shipment: { carrier: string; trackingNumber: string; trackingUrl: string } | null;
  /** Its documents (M6), each read by its own route. Absent from a server before them: none. */
  documents?: AccountOrderDocuments;
  /** NOCTURNE, addition 3: its model's cover photograph (`/api/v1/media/<sha256>`), or null; absent from a server before it. */
  imageUrl?: string | null;
}

/** The documents of an order (plan LIVE RELEASE+, M6). */
export interface AccountOrderDocuments {
  /** Its invoice (PDF), once paid. */
  invoice: { number: string; issuedAt: string } | null;
  /** The credit note that cancels it (PDF), once cancelled after it was paid, or returned. */
  creditNote: { number: string; issuedAt: string } | null;
  /** The model's care guide: for an order neither cancelled nor returned. */
  careGuide: boolean;
  /** Its ownership certificate (PDF), once its piece is registered to this account. */
  certificate: boolean;
}

/** GET /api/v1/account/orders/:id/care-guide: the model's own words, or null for the house's general care text. */
export interface OrderCareGuide {
  model: string;
  text: string | null;
}

// ── MESSAGES (plan NEXT-NINE, CS-01; API §10.17) ─────────────────────────

/** What a message concerns (client_messages.context_kind). */
export type MessageContextKind = 'PIECE' | 'ORDER' | 'RELEASE' | 'SCAN' | 'MODEL';

/** What the collector attaches to a message: a kind and its id; `about` WARRANTY for the warranty tab's scan only. */
export interface MessageContextInput {
  kind: MessageContextKind;
  id: string;
  about?: 'WARRANTY';
}

/** A message of the account's conversation (GET /api/v1/account/messages): staff are never named. */
export interface AccountMessage {
  id: string;
  from: 'YOU' | 'ORBES_CLIENT_SERVICES';
  body: string;
  at: string;
  /** On the collector's own messages: what it concerned, and its place in the app (null for a scan). */
  concerning: { kind: MessageContextKind; label: string; path: string | null } | null;
}

export interface AccountThread {
  messages: AccountMessage[];
  unread: boolean;
}
