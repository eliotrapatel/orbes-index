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
  /** Subject of the email under FORGOTTEN PASSWORD? (C-04). */
  recoverySubject: 'ORBES — FORGOTTEN PASSWORD',
});

/**
 * The password of an ORBES account (C-04, API §10.7 and §10.8), in the OWNERSHIP panel. There is no email
 * channel: a customer who forgot it contacts ORBES Client Services, who check their identity and give a
 * one-time recovery code (30 minutes); the new password then ends every session of the account, cancels
 * its pending transfers and pauses new ones for 72 hours. CHANGE PASSWORD sits beside SIGN OUT for now
 * (it moves to the customer's pieces with F-01).
 */
export const ACCOUNT_PASSWORD = Object.freeze({
  forgotten: 'FORGOTTEN PASSWORD?',
  forgottenTitle: 'FORGOTTEN PASSWORD',
  forgottenLead:
    'ORBES Client Services can help you set a new password. After checking your identity, they give you a one-time recovery code, valid for 30 minutes.',
  haveCode: 'I HAVE A RECOVERY CODE',
  backToSignIn: 'BACK TO SIGN IN',
  recoverTitle: 'SET A NEW PASSWORD',
  recoverLead: 'Enter the email of your ORBES account, the recovery code given by ORBES Client Services and a new password.',
  recoveryCode: 'RECOVERY CODE',
  recoveryCodeHint: 'Given by ORBES Client Services. It works once.',
  codeIncomplete: 'Enter the 12 characters of your recovery code.',
  newPassword: 'NEW PASSWORD',
  currentPassword: 'CURRENT PASSWORD',
  recover: 'SET NEW PASSWORD',
  /** After a recovery: every session ended, so the customer signs in again; `until` is in their own time zone. */
  recovered: (until: string) =>
    `Your password has been changed: sign in with it. For your security, every session of your account has ended, its pending transfers were cancelled and new transfers are paused until ${until}.`,
  change: 'CHANGE PASSWORD',
  changeLead: 'Enter your current password, then a new one. Your other sessions will end; you stay signed in here.',
  cancel: 'CANCEL',
  changed: 'Your password has been changed. Your other sessions have ended.',
});

/**
 * The question under the contact of ORBES Client Services on every result that was not authentic
 * (C-02, API §8.5): where the piece was seen or bought, kept with the scan's reference for ORBES
 * Client Services and its Cases queue. Optional, never an accusation (§4.5: no "fake", no
 * "counterfeit"). The customer's words are personal data: the note's hint asks for no contact details.
 */
export const REPORT = Object.freeze({
  title: 'WHERE DID YOU SEE OR BUY THIS PIECE?',
  lead: 'Optional. Your answer stays with this reference, for ORBES Client Services.',
  channels: Object.freeze({ BOUTIQUE: 'BOUTIQUE', ONLINE: 'ONLINE', PRIVATE: 'PRIVATE SALE', OTHER: 'OTHER' }),
  place: 'PLACE (OPTIONAL)',
  placeHint: 'The name of the boutique, the website or the city.',
  note: 'NOTE (OPTIONAL)',
  noteHint: 'Please leave out your name and contact details.',
  send: 'SEND ANSWER',
  sent: 'THANK YOU',
  /** After sending: the reference the answer is kept with. */
  kept: (reference: string) => (reference ? `Your answer is kept with reference ${reference}.` : 'Your answer is kept with this scan.'),
});

/**
 * A 429 when a piece is registered with its claim code: too many claim codes tried for this piece
 * (by anyone, within the hour, SECURITY-MODEL §3.8), or too many requests from this connection.
 * Either way the wait can be up to an hour, longer than the scan's registration window, so the
 * line says so and names who helps.
 */
export const CLAIM_HELD =
  'Too many claim codes have been tried for this piece. Registration is held for up to an hour: please try again later. ORBES Client Services can assist you.';

/** The honest limit of a code-based verification, shown under every positive result. */
export const ASSURANCE_NOTE =
  'This verification confirms an identity issued and signed by ORBES and its registry record. A printed code alone cannot prove that an object is genuine; ORBES Client Services can inspect a piece on request.';

/** The CARE tab of a piece whose model has no care instructions (shared with the console's care preview). */
export { DEFAULT_CARE } from '../shared/care.js';

