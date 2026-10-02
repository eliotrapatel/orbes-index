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
