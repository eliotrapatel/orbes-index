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
    type: string;
    variant?: string;
    material: string;
    createdYear: number;
    productionDate?: string;
    care?: string;
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

/** GET /api/v1/client-services: how ORBES Client Services is reached; `{}` when nothing is configured. */
export interface ClientServices {
  email?: string;
  phone?: string;
  hours?: string;
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
  type: string;
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
  inService: boolean;
  /**
   * A link to an ownership certificate may be created (F-06): false while the piece is reported lost or stolen, or
   * revoked or retired, where creation is refused (409 CERTIFICATE_NOT_ALLOWED). MY PIECES then leaves the section out.
   */
  certificateAllowed: boolean;
  /** `version` is an integer here (1), `pattern` the glyph ids joined by "·". */
  genome: { id: string; version: number; fingerprint: string; glyphs: number[]; pattern: string } | null;
  warranty: { status: WarrantyStatus; startDate?: string; endDate?: string };
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
