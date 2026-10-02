/**
 * Interface copy of the verification app (statuses, guidance, problems).
 *
 * Voice: brief, calm, factual, in the house style: uppercase tracked titles,
 * sentence-case explanations. No exclamation marks, no blame. Nothing here
 * says an object is genuine: a code proves an ORBES-issued identity, not the
 * physical piece (the result copy itself comes from the server).
 */
import { ApiError } from './api.js';
import type { ScanHint } from './capture.js';
import type { VerificationState } from './types.js';

export const STATUS = Object.freeze({
  starting: 'PREPARING CAMERA…',
  scanning: 'SCANNING…',
  reading: 'READING PHOTO…',
  verifying: 'VERIFYING…',
  found: 'ORBES CODE FOUND',
});

export const HINTS: Readonly<Record<Exclude<ScanHint, null>, string>> = Object.freeze({
  align: 'Place the whole code inside the orbit',
  steady: 'Hold steady — in even light',
  // Never "move closer": phones that cannot focus close (iPhone Pro, ≈ 20 cm) only blur.
  distance: 'Hold about 20 cm away',
  zoom: 'Zoom in',
});

export const SCAN_GUIDE = 'Align the ORBES CODE within the orbit';

export type ProblemKind =
  | 'camera-denied'
  | 'camera-missing'
  | 'camera-in-use'
  | 'camera-insecure'
  | 'camera-unsupported'
  | 'camera-failed'
  | 'scan-timeout'
  | 'upload-unreadable'
  | 'upload-invalid'
  | 'decoder-failed'
  | 'network'
  | 'rate-limited'
  | 'server';

/** What a problem screen offers. */
export type ProblemAction = 'retry-scan' | 'upload' | 'retry-verify' | 'home';

export interface ProblemCopy {
  title: string;
  message: string;
  primary: ProblemAction;
  secondary?: ProblemAction;
}

export const ACTION_LABELS: Readonly<Record<ProblemAction, string>> = Object.freeze({
  'retry-scan': 'SCAN AGAIN',
  upload: 'UPLOAD A PHOTO',
  'retry-verify': 'TRY AGAIN',
  home: 'RETURN',
});

export const PROBLEMS: Readonly<Record<ProblemKind, Readonly<ProblemCopy>>> = Object.freeze({
  'camera-denied': {
    title: 'CAMERA ACCESS DECLINED',
    message: 'To scan, allow camera access for this page in your browser settings. You may also upload a photo of the ORBES CODE.',
    primary: 'upload',
    secondary: 'retry-scan',
  },
  'camera-missing': {
    title: 'NO CAMERA AVAILABLE',
    message: 'No camera could be found on this device. Upload a photo of the ORBES CODE instead.',
    primary: 'upload',
    secondary: 'home',
  },
  'camera-in-use': {
    title: 'CAMERA UNAVAILABLE',
    message: 'The camera is in use by another application. Close it, then try again — or upload a photo of the ORBES CODE.',
    primary: 'retry-scan',
    secondary: 'upload',
  },
  'camera-insecure': {
    title: 'SECURE CONNECTION REQUIRED',
    message: 'The camera can only be used over a secure connection. Open this page from its https:// address, or upload a photo of the ORBES CODE.',
    primary: 'upload',
    secondary: 'home',
  },
  'camera-unsupported': {
    title: 'CAMERA NOT SUPPORTED',
    message: 'This browser cannot use the camera here. Upload a photo of the ORBES CODE, or open this page in Safari or Chrome.',
    primary: 'upload',
    secondary: 'home',
  },
  'camera-failed': {
    title: 'CAMERA UNAVAILABLE',
    message: 'The camera could not be started. Please try again, or upload a photo of the ORBES CODE.',
    primary: 'retry-scan',
    secondary: 'upload',
  },
  'scan-timeout': {
    title: 'NO ORBES CODE FOUND',
    message: 'Hold the camera 10 to 20 cm from the code, in soft even light, with the whole code inside the orbit.',
    primary: 'retry-scan',
    secondary: 'upload',
  },
  'upload-unreadable': {
    title: 'NO ORBES CODE FOUND',
    message: 'No ORBES CODE could be read in this photo. Choose a sharp, well-lit photo in which the whole code is visible.',
    primary: 'upload',
    secondary: 'retry-scan',
  },
  'upload-invalid': {
    title: 'PHOTO NOT READABLE',
    message: 'This file could not be opened as a photo. Choose a JPEG, PNG or HEIC image.',
    primary: 'upload',
    secondary: 'home',
  },
  'decoder-failed': {
    title: 'SCANNER UNAVAILABLE',
    message: 'The scanner could not be started in this browser. Please reload the page and try again.',
    primary: 'home',
  },
  network: {
    title: 'CONNECTION INTERRUPTED',
    message: 'The ORBES verification service could not be reached. Check your connection, then try again.',
    primary: 'retry-verify',
    secondary: 'home',
  },
  'rate-limited': {
    title: 'A MOMENT, PLEASE',
    message: 'Many verifications were requested from this connection. Please wait a minute, then try again.',
    primary: 'retry-verify',
    secondary: 'home',
  },
  server: {
    title: 'VERIFICATION UNAVAILABLE',
    message: 'The verification could not be completed just now. Please try again in a moment.',
    primary: 'retry-verify',
    secondary: 'home',
  },
});

export interface CameraEnvironment {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
}

/**
 * Classify a getUserMedia failure (DOMException names differ slightly across
 * browsers and versions; legacy names are included).
 */
export function classifyCameraError(err: unknown, env: CameraEnvironment): ProblemKind {
  if (!env.isSecureContext) return 'camera-insecure';
  if (!env.hasGetUserMedia) return 'camera-unsupported';
  const name = err && typeof err === 'object' && typeof (err as { name?: unknown }).name === 'string' ? (err as { name: string }).name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'camera-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'camera-missing';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'camera-in-use';
    case 'TypeError':
      return 'camera-unsupported';
    default:
      return 'camera-failed';
  }
}

/** The problem screen for a failed /api/v1/verify call. */
export function problemForApiError(e: unknown): ProblemKind {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'network';
    if (e.status === 429) return 'rate-limited';
  }
  return 'server';
}

/** Client-side mirror of the server's titles, used only if a response lacks one. */
export const FALLBACK_TITLES: Readonly<Record<VerificationState, string>> = Object.freeze({
  AUTHENTIC: 'AUTHENTIC',
  AUTHENTIC_FIRST_REGISTRATION: 'AUTHENTIC — FIRST REGISTRATION',
  AUTHENTIC_REGISTERED: 'AUTHENTIC — REGISTERED',
  AUTHENTIC_OWNERSHIP_VERIFIED: 'AUTHENTIC — OWNERSHIP VERIFIED',
  SUSPICIOUS_ACTIVITY: 'UNUSUAL ACTIVITY DETECTED',
  REVOKED: 'REVOKED',
  UNKNOWN: 'UNKNOWN ORBES CODE',
  INVALID_SIGNATURE: 'INVALID SIGNATURE',
  MALFORMED_CODE: 'UNREADABLE CODE',
});

/**
 * ORBES Client Services, where a result asks the customer to contact it (BRAND-DESIGN-SYSTEM
 * §4.2): a text link opens an email prefilled with the facts Client Services needs, the
 * scan reference first. Never "Contact support" (§4.5).
 */
export const CONTACT = Object.freeze({
  action: 'CONTACT ORBES CLIENT SERVICES',
  /** Accessible name of the phone link, ahead of the number. */
  call: 'Call ORBES Client Services,',
  /** Labels of the facts under the customer's own words in the prefilled email. */
  reference: 'REFERENCE',
  result: 'RESULT',
  warranty: 'WARRANTY',
  verified: 'VERIFIED',
});

/**
 * A 429 when a piece is registered with its claim code: too many claim codes tried for this piece
 * (by anyone, within the hour, SECURITY-MODEL §3.8), or too many requests from this connection.
 * Either way the wait can be up to an hour, longer than the scan's registration window, so the
 * line says so and names who helps.
 */
export const CLAIM_HELD =
  'Too many claim codes have been tried for this piece. Registration is held for up to an hour: please try again later. ORBES Client Services can assist you.';

/**
 * OWNERSHIP tab of a piece ORBES has not sold yet (AUTHENTIC: still in stock, or in a pre-sale
 * service). A piece is sold when ORBES or an authorised retailer starts its warranty (the sale
 * mode, A-08, or the console): until then it has not been handed over, which a buyer should know (S-07).
 */
export const NOT_DELIVERED_NOTE =
  'This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been.';

/**
 * OWNERSHIP tab of a piece open for its first registration, scanned from a browser signed in to the
 * ORBES console: the server recorded a staff scan and offered no registration (S-07).
 */
export const STAFF_SCAN_NOTE =
  'This browser is signed in to the ORBES console, so this scan was recorded as a staff test and registration is not offered. To register a piece of your own, scan it in a browser that is not signed in to the console.';

/** The honest limit of a code-based verification, shown under every positive result. */
export const ASSURANCE_NOTE =
  'This verification confirms an identity issued and signed by ORBES and its registry record. A printed code alone cannot prove that an object is genuine; ORBES Client Services can inspect a piece on request.';

export const DEFAULT_CARE =
  'Store this piece on its own, away from humidity, perfume and cosmetics. Wipe it with a soft, dry cloth after wearing. ORBES Client Services offers inspection, cleaning and polishing.';

