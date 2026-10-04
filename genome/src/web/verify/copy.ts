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
  /** The piece an email from MY PIECES is about (F-01). */
  piece: 'PIECE',
});

/**
 * The password of an ORBES account (C-04, API §10.7 and §10.8). There is no email channel: a customer who
 * forgot it contacts ORBES Client Services (FORGOTTEN PASSWORD?, under every sign-in form), who check their
 * identity and give a one-time recovery code (30 minutes); the new password then ends every session of the
 * account, cancels its pending transfers and pauses new ones for 72 hours. Signed in, CHANGE PASSWORD is in
 * MY PIECES (F-01), on the account line at the foot of the page, beside SIGN OUT.
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
    `Your password has been changed: sign in with it. For your security, every session of your account has ended, its pending transfers were cancelled, its certificate links were withdrawn and new transfers are paused until ${until}.`,
  change: 'CHANGE PASSWORD',
  changeLead: 'Enter your current password, then a new one. Your other sessions will end; you stay signed in here.',
  cancel: 'CANCEL',
  changed: 'Your password has been changed. Your other sessions have ended.',
});

/**
 * MY PIECES (F-01, /verify/pieces, API §10.5–§10.6 and §11.5–§11.6): the signed-in owner's pieces, each on its
 * ivory plate with its GENOME, then OWNERSHIP · WARRANTY · SERVICE. An owner whose piece is gone declares it
 * here without scanning it (REPORT LOST / STOLEN, confirmed); a loss they declared themselves, they withdraw
 * (PIECE FOUND); a theft, or a loss ORBES Client Services recorded, Client Services withdraw once they have
 * checked the piece. The words LOST and STOLEN name the owner's own declaration, on their own account's
 * page: never a word of a public result, which says UNUSUAL ACTIVITY (BRAND §4.5).
 */
export const PIECES = Object.freeze({
  title: 'MY PIECES',
  /** The link of the landing and of the OWNERSHIP panel's account line. */
  link: 'MY PIECES',
  lead: 'The pieces registered to your ORBES account.',
  signInLead: 'Sign in to see the pieces registered to your ORBES account. A piece lost or stolen can be reported here, without scanning it.',
  empty: 'No piece is registered to your ORBES account yet. Scan a piece, then register it from the OWNERSHIP tab of its result.',
  loading: 'ONE MOMENT…',
  loadFailed: 'Your pieces could not be shown just now.',
  retry: 'TRY AGAIN',
  scan: 'SCAN ORBES CODE',
  tabs: Object.freeze({ ownership: 'OWNERSHIP', warranty: 'WARRANTY', service: 'SERVICE' }),
  status: Object.freeze({ yours: 'REGISTERED TO YOU', lost: 'REPORTED LOST', stolen: 'REPORTED STOLEN', transfer: 'TRANSFER PENDING', service: 'IN SERVICE' }),
  acquired: Object.freeze({ FIRST_REGISTRATION: 'FIRST REGISTRATION', TRANSFER: 'TRANSFER', RESALE: 'RESALE', ADMIN: 'ORBES CLIENT SERVICES' }),
  verified: 'VERIFIED',
  unverified: 'NOT YET VERIFIED',
  unverifiedNote: 'ORBES Client Services may ask for a proof of purchase to verify your ownership.',
  transferPending: (until: string) =>
    until ? `A transfer of this piece is pending until ${until}. You may cancel it at any time before it is accepted.` : 'A transfer of this piece is pending. You may cancel it at any time before it is accepted.',
  cancelTransfer: 'CANCEL TRANSFER',
  transferCancelled: 'The transfer has been cancelled.',
  inService: 'This piece is with ORBES for a service. Its history is under SERVICE.',
  report: 'REPORT LOST / STOLEN',
  reportLead: 'If this piece is lost or stolen, report it here: every scan of its code will then show UNUSUAL ACTIVITY to whoever checks it, and it can no longer be transferred.',
  reportTitle: 'REPORT LOST / STOLEN',
  /** Accessible name of the LOST · STOLEN choice. */
  reportChoice: 'What happened to this piece',
  lost: 'LOST',
  stolen: 'STOLEN',
  reportHow: Object.freeze({
    LOST: 'Once you find it, you withdraw the report yourself, here: PIECE FOUND.',
    STOLEN: 'Once it is recovered, ORBES Client Services check the piece and withdraw the report.',
  }),
  reportEffect: 'Every scan of its code will show UNUSUAL ACTIVITY to whoever checks it, and any pending transfer of this piece is cancelled.',
  chooseFirst: 'Choose LOST or STOLEN.',
  confirmReport: 'CONFIRM REPORT',
  reported: Object.freeze({
    LOST: 'This piece is now reported lost. Every scan of its code shows UNUSUAL ACTIVITY.',
    STOLEN: 'This piece is now reported stolen. Every scan of its code shows UNUSUAL ACTIVITY.',
  }),
  /** A piece the server would refuse to report (revoked, retired or flagged: `incidentReportable` false). */
  notReportable: 'A loss or a theft of this piece cannot be reported here: tell ORBES Client Services.',
  lostByYou: 'Every scan of its code shows UNUSUAL ACTIVITY until you tell ORBES that it has been found.',
  found: 'PIECE FOUND',
  foundTitle: 'PIECE FOUND',
  foundLead: 'Confirm with the password of your ORBES account that this piece is back with you. Its scans will read as before, and it can be transferred again.',
  /** The account's password, typed again: a session alone does not withdraw a report. */
  foundPassword: 'PASSWORD',
  foundPasswordMissing: 'Enter the password of your ORBES account.',
  confirmFound: 'CONFIRM',
  resolved: 'This piece is no longer reported lost.',
  withClientServices: Object.freeze({
    LOST: 'ORBES Client Services recorded this piece as lost: every scan of its code shows UNUSUAL ACTIVITY. They withdraw the report once they have checked the piece.',
    STOLEN: 'Every scan of its code shows UNUSUAL ACTIVITY. Once the piece is recovered, ORBES Client Services check it and withdraw the report.',
  }),
  cancel: 'CANCEL',
  services: 'SERVICE HISTORY',
  noService: 'No service has been recorded for this piece.',
  serviceFailed: 'The service history could not be shown just now.',
  serviceStatus: Object.freeze({ OPEN: 'IN PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' }),
  // The ownership certificate (F-06), in the OWNERSHIP tab of a piece that is not reported lost or stolen.
  certificateTitle: 'OWNERSHIP CERTIFICATE',
  certificateLead:
    'Share a link to a certificate of this piece with a buyer or an insurer: its GENOME, your ownership and its date, the warranty, and that no loss or theft is reported. It never shows your name or your email, and it stops being valid if the piece changes hands or is reported lost or stolen.',
  createCertificate: 'CREATE CERTIFICATE',
  /** Accessible name of the 7 DAYS · 30 DAYS · 90 DAYS choice. */
  certificateValidity: 'How long the link stays valid',
  certificateDays: Object.freeze({ 7: '7 DAYS', 30: '30 DAYS', 90: '90 DAYS' }),
  certificateHow: 'Anyone who has the link sees the certificate, read live, until it expires or you withdraw it. You can have up to ten at a time for this piece.',
  confirmCertificate: 'CREATE LINK',
  certificateLink: 'CERTIFICATE LINK',
  certificateUntil: (until: string) => `VALID UNTIL ${until}`,
  certificateShown: 'This link is shown once: copy it now. ORBES cannot show it again.',
  copyLink: 'COPY LINK',
  copied: 'The link has been copied.',
  copyFailed: 'The link could not be copied: select it, then copy it.',
  openLink: 'OPEN LINK',
  /** One open link of the piece: when it was created, until when it is valid. */
  certificateLine: (created: string, until: string) => `CREATED ${created} · VALID UNTIL ${until}`,
  certificateEnded: (created: string) => `CREATED ${created} · NO LONGER VALID`,
  withdraw: 'WITHDRAW',
  withdrawn: 'The link has been withdrawn: it no longer leads to the certificate.',
  certificatesFailed: 'Your certificate links could not be shown just now.',
});

/**
 * THE CLUB'S TIERS (P-X04, at the head of MY PIECES): the account's tier, TITANE, PLATINE or PALLADIUM (1, 3 and 5
 * pieces held now, never a revoked one), its name in the display face and its pieces in the reading face, the benefits
 * of the tier and of those below it (the server's words, set by ORBES), and the way to the next tier. An account that
 * holds no piece reads what its first one opens.
 */
export const TIER = Object.freeze({
  /** The section's label, and its accessible name. */
  label: 'YOUR TIER',
  /** Before the first tier: the section names the club. */
  noneLabel: 'THE CLUB',
  /** Under the tier's name, in the reading face. */
  pieces: (n: number) => `${n} ${Number(n) === 1 ? 'piece' : 'pieces'} held`,
  /** The heading of the way to the next tier. */
  next: (tier: string) => `NEXT: ${tier}`,
  /** How many more pieces reach it, and from how many it starts. */
  nextWay: (tier: string, missing: number, from: number) =>
    `${missing} more ${Number(missing) === 1 ? 'piece registered to your account opens' : 'pieces registered to your account open'} ${tier}, from ${from} pieces held. It adds:`,
  /** An account without a tier: what its first piece opens. */
  first: (tier: string) => `A piece registered to your ORBES account opens ${tier}, the first tier of the club:`,
  /** PALLADIUM: no tier above. */
  top: 'PALLADIUM is the highest tier of the club.',
  /** Shown when MY PIECES lists more pieces than the tier counts: a piece revoked or retired by ORBES counts for none. */
  counted: 'A piece revoked or retired by ORBES counts for no tier.',
});

/**
 * The ownership certificate's own page (F-06, /verify/c#…): what a buyer or an insurer reads when an owner shares
 * the link. It attests a record, not the object it is shown with: never AUTHENTIC, never a name or an email.
 */
export const CERTIFICATE = Object.freeze({
  title: 'OWNERSHIP CERTIFICATE',
  loading: 'ONE MOMENT…',
  state: Object.freeze({ valid: 'VALID', ended: 'NO LONGER VALID', unknown: 'NOT FOUND' }),
  lead: Object.freeze({
    valid:
      'What the ORBES registry records about this piece, read just now. It attests this record, not the object it is shown with: to check an object, scan its ORBES CODE.',
    ended: 'This certificate has expired, or the record of its piece has changed since it was issued. Ask the owner of the piece for a new certificate.',
    unknown: 'This link does not lead to a certificate: it may be incomplete, or withdrawn by its owner. Ask the owner of the piece for a new link.',
  }),
  failed: 'The certificate could not be checked just now.',
  retry: 'TRY AGAIN',
  record: 'THE RECORD',
  certificate: 'THIS CERTIFICATE',
  rows: Object.freeze({
    ownership: 'OWNERSHIP',
    since: 'SINCE',
    warranty: 'WARRANTY',
    incidents: 'LOSS OR THEFT',
    checked: 'CHECKED',
    issued: 'ISSUED',
    validUntil: 'VALID UNTIL',
  }),
  verified: 'VERIFIED',
  unverified: 'REGISTERED · NOT YET VERIFIED',
  noIncident: 'NONE REPORTED',
  note: 'A certificate names no owner. It stops being valid once the piece changes hands or a loss or theft is reported, and when it expires.',
  pdf: 'DOWNLOAD PDF',
  pdfFailed: 'The PDF could not be prepared just now. Please try again in a moment.',
  scan: 'SCAN ORBES CODE',
  verifyOnly: 'VERIFY ONLY AT THEORBES.COM/VERIFY',
});

/**
 * RECEIVING THIS PIECE, in the OWNERSHIP tab of a piece registered to someone else (F-03, API §11.3): the transfer
 * code is accepted for the piece scanned only, with that scan. The server gives the scan's transfer window (15
 * minutes) to a signed-in reader who is not the owner while a transfer of the piece is pending; a reader who signs
 * in after the scan verifies the piece again (VERIFY AGAIN, the same code), and a window that has closed asks for
 * a new scan (SCAN AGAIN). The window is the scan's: never a "token" to the customer (BRAND §4.5).
 */
export const RECEIVING = Object.freeze({
  title: 'RECEIVING THIS PIECE',
  lead: 'If its owner has given you a transfer code, enter it to register this piece in your name.',
  signIn: 'Sign in or create an ORBES account to receive it.',
  ownerHint: 'If this piece is already registered to you, sign in and scan it again to see it as its owner.',
  /** Signed in, and a transfer is pending, but this scan was made signed out: it carries no transfer window. */
  verifyAgainLead: 'To receive this piece, verify it again now that you are signed in.',
  verifyAgain: 'VERIFY AGAIN',
  /** No transfer of the piece is pending: there is no code to enter for it. */
  noTransfer: 'No transfer of this piece is pending. Once its owner has created a transfer code, scan this piece again to receive it.',
  /** Signed in with no transfer pending: an owner who scanned signed out, then signed in, reaches the owner view. */
  ownerAgain: 'If this piece is registered to you, verify it again to see it as its owner.',
  /** The time the window of this scan closes, as REGISTRATION OPEN UNTIL. */
  until: (time: string) => `RECEIVING OPEN UNTIL ${time}`,
  closed: 'The window to receive this piece from this scan has closed. Scan the code again to receive it.',
  code: 'TRANSFER CODE',
  codeHint: 'Created by its owner in their ORBES account.',
  codeIncomplete: 'Enter the 12 characters of the transfer code.',
  submit: 'RECEIVE THIS PIECE',
  /**
   * S-07: this browser is signed in to the ORBES console, so the scan was recorded as a staff test, which earns no
   * window to receive the piece; scanning it again here would be another staff test.
   */
  staffScan:
    'This browser is signed in to the ORBES console, so this scan was recorded as a staff test and receiving this piece is not offered. To receive a piece of your own, scan it in a browser that is not signed in to the console.',
  /** The section of an UNUSUAL ACTIVITY result that offers the form (F-03, as DO YOU HOLD THE CERTIFICATE CARD?). */
  cardTitle: 'DO YOU HOLD A TRANSFER CODE?',
  cardText: 'If the owner of this piece has given you a transfer code, you may receive it in your ORBES account with that code.',
  underReview: 'While its activity is reviewed, this piece can be received only with the transfer code its owner gave you.',
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
 * What a form of the OWNERSHIP panel and the report on a scan say when the request fails without a message of the
 * server's, written once for both: the network, then the rate limit. A refusal the server explains (a 4xx) reads as
 * the server wrote it; a 5xx has a sentence of its own in each form.
 */
export const REQUEST_ERRORS = Object.freeze({
  network: 'The ORBES service could not be reached. Check your connection, then try again.',
  rateLimited: 'Too many attempts. Please wait a moment, then try again.',
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

/**
 * The photographs above the GENOME of an authentic result (F-04): the piece's own, taken by ORBES at issuance, then
 * its model's reference photograph. They show what ORBES registered under this identity, for the customer to compare
 * with the piece in hand: a code copied onto another object would not match them. Nothing here says the object is
 * genuine (§4.6).
 */
export const PHOTOS = Object.freeze({
  /** The section's accessible name. */
  label: 'Photographs of this piece',
  /** Its name in MY PIECES, where each piece of the list has its own (F-01). */
  labelOf: (productId: string) => `Photographs of ${productId}`,
  piece: 'THIS PIECE',
  model: 'THE MODEL',
  pieceAlt: (productId: string) => `This piece, ${productId}, photographed by ORBES at issuance`,
  modelAlt: (model: string, type: string) => `The ${[model, type].filter((x) => x.length > 0).join(' ')} model, photographed by ORBES`,
  note: (count: number) =>
    count > 1 ? 'Photographed by ORBES. Compare them with the piece in your hands.' : 'Photographed by ORBES. Compare it with the piece in your hands.',
});

/** The honest limit of a code-based verification, shown under every positive result. */
export const ASSURANCE_NOTE =
  'This verification confirms an identity issued and signed by ORBES and its registry record. A printed code alone cannot prove that an object is genuine; ORBES Client Services can inspect a piece on request.';

/**
 * The second-hand guidance (J-02), the notice under AUTHENTIC — REGISTERED: never on OWNERSHIP VERIFIED nor on FIRST
 * REGISTRATION. The same sentence, word for word, is on the certificate card's verso and in the FAQ of the legal pages
 * (shared with them, J-06; docs/launch/PACKAGING-KIT.md §3, checked by its test): changing it here means changing it there.
 */
export { RESALE_GUIDANCE } from '../shared/resale.js';

/** The text link under it, which opens the OWNERSHIP tab on RECEIVING THIS PIECE, where the transfer code is entered. */
export const RESALE_ACTION = 'I HAVE A TRANSFER CODE';

/** The CARE tab of a piece whose model has no care instructions (shared with the console's care preview). */
export { DEFAULT_CARE } from '../shared/care.js';

/**
 * The legal pages (J-06, src/web/legal/, served at /legal): their links at the foot of the landing, under every
 * result and at the foot of MY PIECES (PRIVACY · TERMS · LEGAL · HELP, then DB-IP's attribution, shared/legal.ts), and
 * under CREATE ACCOUNT the terms of use, whose article 1 says that creating an account means accepting them, beside the
 * privacy policy, which says what the account records (the information due where data is collected).
 */
export const LEGAL = Object.freeze({
  /** The name of the links' navigation landmark. */
  label: 'Legal information',
  links: Object.freeze({ privacy: 'PRIVACY', terms: 'TERMS', notice: 'LEGAL', faq: 'HELP' }),
  /** Under CREATE ACCOUNT, before its links to the terms and the privacy policy (docs/legal/TERMS-FACTS.md R56). */
  accept: 'Creating an ORBES account means accepting the ORBES terms of use.',
  terms: 'TERMS OF USE',
  privacy: 'PRIVACY POLICY',
});

/**
 * THE COLLECTION (P-R02, /verify/lookbook): the lookbook of the models ORBES shows, grouped by collection, each on an
 * ivory plate with SEE THE MODEL; then a model's sheet (/verify/lookbook/<slug>): its photographs, its story, its
 * specifications and its care. An owner signed in also sees the models RESERVED FOR OWNERS. Reached from the landing,
 * from MY PIECES and, under an authentic result, from SEE THE MODEL.
 */
export const LOOKBOOK = Object.freeze({
  title: 'THE COLLECTION',
  /** The text link of the landing, of MY PIECES and of a sheet's foot (back to the grid). */
  link: 'THE COLLECTION',
  lead: 'The models of ORBES, as the maison presents them.',
  loading: 'ONE MOMENT…',
  loadFailed: 'The collection could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'No model is shown in the collection yet.',
  /** The section an owner of an ORBES piece sees, signed in; and the line of such a model's sheet. */
  reserved: 'RESERVED FOR OWNERS',
  reservedLead: 'Shown to the owners of an ORBES piece.',
  /** The text link of each card, and the one under an authentic result. */
  seeModel: 'SEE THE MODEL',
  scan: 'SCAN ORBES CODE',
  /** The accessible names of a sheet's photographs and of a card's. */
  photosLabel: (model: string) => `Photographs of the ${model} model`,
  story: 'THE STORY',
  specs: 'SPECIFICATIONS',
  care: 'CARE',
  /** The sheet of an address that leads nowhere (a model no longer shown, or reserved for owners). */
  notFound: 'This model is not in the ORBES collection.',
});

/**
 * THE RELEASES (P-R03, /verify/releases, API §8.9 and §10.10): the models ORBES releases in a limited number of pieces,
 * each entered from its page with an ORBES account (any: an account that holds no piece is drawn after the tiers),
 * then drawn: by tier, then seniority, then the order of a seed whose fingerprint is published with the release and
 * which the draw reveals, with every entry by its id, tier, seniority and rank. A place drawn is held until a time;
 * ORBES Client Services concludes each sale and sends no email: the account's page says it. Reached from the landing
 * and from MY PIECES, which groups the account's entries. The word is DRAW, never another (BRAND §4.5).
 *
 * The early access (P-X02): before entries open to everyone (48 hours by default, set per release), the owners
 * PLATINE and PALLADIUM reserve a place directly, first come, first served, within the pieces of the release; the
 * pieces left then go to the draw. The release's page says both times, the privilege is recalled in THE CIRCLE and in
 * MY PIECES.
 */
export const RELEASES = Object.freeze({
  title: 'THE RELEASES',
  /** The text link of the landing, of MY PIECES and of a release's foot (back to the list). */
  link: 'THE RELEASES',
  lead: 'Pieces released in a limited number. Enter the draw with your ORBES account: ORBES Client Services concludes each sale.',
  loading: 'ONE MOMENT…',
  loadFailed: 'The releases could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'No release is announced yet.',
  /** The text link of each release of the list. */
  see: 'SEE THE RELEASE',
  scan: 'SCAN ORBES CODE',
  /** The page of an address that leads nowhere: a release ORBES has not published. */
  notFound: 'This release is not known to ORBES.',
  /** A release's state, as its page and the list say it. */
  state: Object.freeze({ UPCOMING: 'ENTRIES OPEN SOON', OPEN: 'ENTRIES OPEN', CLOSED: 'ENTRIES CLOSED', DRAWN: 'DRAWN', CANCELLED: 'CANCELLED' }),
  /** P-X02: the state of a release while PLATINE and PALLADIUM reserve their places (before entries open to everyone). */
  earlyState: 'EARLY ACCESS',
  /** P-X02: said after the state once every piece is held by a direct reservation, before the draw. */
  fullState: 'EVERY PIECE RESERVED',
  /** P-X02: the line under a release's state, its two openings in UTC (the facts say them on this phone too). */
  access: (early: string, everyone: string) => `PLATINE AND PALLADIUM: FROM ${early} · EVERYONE: FROM ${everyone}`,
  /** P-X02: THE RELEASE's paragraph on its early access (its times are the line under the state and the facts). */
  earlyNote:
    'Before entries open to everyone, PLATINE and PALLADIUM owners reserve a place directly, first come, first served, within the pieces of the release: their tier is the one their account holds when they reserve. The pieces left then go to the draw.',
  pieces: (n: number) => (n === 1 ? '1 PIECE' : `${n} PIECES`),
  hours: (n: number) => (n === 1 ? '1 HOUR' : `${n} HOURS`),
  /** A time shown in UTC, then on the phone's own clock. */
  utc: (time: string) => `${time} UTC`,
  onThisPhone: (time: string, offset: string) => `${time} on this phone (${offset})`,
  /** The line of a release in the list: its pieces and the time that matters now. */
  opensLine: (pieces: string, time: string) => `${pieces} · ENTRIES OPEN ${time} UTC`,
  closesLine: (pieces: string, time: string) => `${pieces} · ENTRIES CLOSE ${time} UTC`,
  section: Object.freeze({ release: 'THE RELEASE', entry: 'YOUR ENTRY', draw: 'THE DRAW', entries: 'THE ENTRIES' }),
  rows: Object.freeze({ model: 'MODEL', pieces: 'PIECES', early: 'EARLY ACCESS', opens: 'ENTRIES OPEN', closes: 'ENTRIES CLOSE', held: 'PLACE HELD', reserved: 'RESERVED DIRECTLY', drawn: 'DRAWN' }),
  /** P-X02: the places reserved directly, of the release's pieces (`1 OF 3 PIECES`). */
  reservedOf: (n: number, quantity: number) => `${n} OF ${quantity === 1 ? '1 PIECE' : `${quantity} PIECES`}`,
  photosLabel: (title: string) => `The model of ${title}, photographed by ORBES`,
  /** Signed out, on a release's page: any ORBES account may enter, the sign-in and CREATE ACCOUNT follow. */
  signIn: 'Enter the draw with your ORBES account: sign in, or create one. Any account may enter, one entry per person.',
  enter: 'ENTER THE DRAW',
  withdraw: 'WITHDRAW',
  /** P-X02: the page's hairline button during the early access, for a PLATINE or PALLADIUM account. */
  reserve: 'RESERVE A PLACE',
  /** The account's own entry id, the one the draw's list publishes. */
  entryId: (id: string) => `YOUR ENTRY ${id}`,
  /** What the account's entry, or its absence, means now. */
  status: Object.freeze({
    open: 'Entries are open. One entry per person: ORBES Client Services may set aside a second one.',
    upcoming: (time: string) => `Entries open on ${time}.`,
    closed: 'Entries are closed. The draw follows.',
    drawn: 'The draw has taken place.',
    cancelled: 'This release has been cancelled: there will be no draw.',
    entered: 'You are entered in the draw. You may withdraw until it takes place.',
    enteredClosed: 'You are entered in the draw, which follows the close of entries.',
    withdrawn: 'You withdrew from the draw. You may enter again while entries are open.',
    withdrawnClosed: 'You withdrew from this draw.',
    selected: (until: string) => `Your place is held until ${until} — ORBES Client Services will contact you.`,
    waitlisted: (rank: number) => `You are on the waiting list, rank ${rank}. ORBES Client Services will contact you if a place opens.`,
    confirmed: 'Your purchase is concluded with ORBES Client Services.',
    lapsed: 'The time to conclude has passed: the place held for you has lapsed.',
    /** P-X02, a PLATINE or PALLADIUM account before its early access, then during it. */
    earlySoon: (tier: string, from: string) => `As a ${tier} owner, you may reserve a place directly from ${from}, before entries open to everyone.`,
    early: (tier: string, until: string) => `As a ${tier} owner, you may reserve a place now, until entries open to everyone on ${until}. First come, first served, within the pieces of the release.`,
    /** P-X02, any other account during the early access. */
    earlyOthers: (until: string) => `PLATINE and PALLADIUM owners are reserving their places now. Entries open to everyone on ${until}.`,
    /** P-X02, every piece held by a direct reservation: before entries open, then once they are. */
    full: (until: string) => `Every piece of this release has been reserved. Entries open to everyone on ${until}: the draw then ranks a waiting list, should a place open.`,
    openFull: 'Every piece of this release has been reserved. You may still enter: the draw ranks a waiting list, and ORBES Client Services contacts its first ranks should a place open.',
    /** P-X02, the account's own direct reservation. */
    reserved: (until: string) => `You reserved a place directly. It is held until ${until} — ORBES Client Services will contact you.`,
  }),
  /** The status of an entry, as MY PIECES and a release's page name it. */
  statusLabel: Object.freeze({ ENTERED: 'ENTERED', SELECTED: 'PLACE HELD', WAITLISTED: 'WAITING LIST', CONFIRMED: 'CONCLUDED', LAPSED: 'LAPSED', WITHDRAWN: 'WITHDRAWN' }),
  /** P-X02: a place held by a direct reservation (SELECTED, not drawn). */
  reservedLabel: 'PLACE RESERVED',
  /** A selection obliges no one; no email is sent. */
  noObligation: 'A place drawn obliges you to nothing: ORBES Client Services concludes each sale with you, and sends no email. Your entries are followed in MY PIECES.',
  /** The rule of the draw, exactly as the server applies it (services/drops.ts drawOrder). */
  rule:
    'The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, then the accounts that hold no piece; then by seniority, the full years since the account’s first piece, the most first; then by the SHA-256 of the 32 bytes of the seed followed by the entry’s identifier in lower-case letters, in increasing hexadecimal order. The tier and the seniority are those of the moment of the draw. The first ranks, as many as there are pieces left after the direct reservations of PLATINE and PALLADIUM owners, are selected; the next are on the waiting list, in that order.',
  commitment: 'The seed was drawn when the release was created, and its fingerprint published with it. Once the draw has taken place, the seed is published here: its SHA-256 is that fingerprint, and anyone can rank the entries below again.',
  /** Labels in the display face, so no figure: the commitment's sentence names SHA-256. */
  seedHash: 'SEED FINGERPRINT',
  seed: 'SEED',
  /** The check made on this phone, once the seed is published. */
  seedChecked: 'Checked on this phone: the SHA-256 of the seed is the fingerprint published with the release.',
  seedMismatch: 'Checked on this phone: the SHA-256 of the seed is not the fingerprint published with the release. ORBES Client Services can assist you.',
  entriesLead: (n: number) => (n === 1 ? '1 entry took part in the draw.' : `${n} entries took part in the draw.`),
  /** One entry of the draw's list: its rank, its tier and its seniority. */
  entryLine: (rank: number, tier: string, years: number) => `${rank} · ${tier} · ${years === 1 ? '1 YEAR' : `${years} YEARS`}`,
  noTier: 'NO TIER',
  yours: 'YOURS',
  more: 'SHOW MORE',
  entriesFailed: 'The entries could not be shown just now.',
  /** MY PIECES: the account's entries. */
  yourEntries: 'YOUR RELEASES',
  entryFailed: 'Your entries could not be shown just now.',
  /** The facts of the email to ORBES Client Services about a place held. */
  contactRelease: 'RELEASE',
  contactEntry: 'ENTRY',
  /** P-X02: the privilege of PLATINE and PALLADIUM, recalled in THE CIRCLE and in MY PIECES (its own words for a PLATINE or PALLADIUM account). */
  earlyAccess: Object.freeze({
    label: 'EARLY ACCESS',
    recall: 'PLATINE and PALLADIUM owners reserve a place in each release directly, before it opens to everyone: first come, first served, within its pieces. Each release’s page gives the times.',
    yours: (tier: string) => `As a ${tier} owner, you reserve a place in each release directly, before it opens to everyone: first come, first served, within its pieces. Each release’s page gives the times.`,
  }),
});

/**
 * THE CIRCLE (P-X01, /verify/circle, API §10.11): what ORBES publishes for the owners of a piece, by tier: notes, its
 * invitations, answered YES or NO until the event begins and within their places, and its polls, one vote per account,
 * whose results show once the reader has voted. A signed-in account that holds a piece now reads it, each post from its
 * tier up; it goes with the last piece. Reached from MY PIECES. A link to another site names its host beside it.
 */
export const CIRCLE = Object.freeze({
  title: 'THE CIRCLE',
  /** The text link of MY PIECES and of a post's foot (back to the feed). */
  link: 'THE CIRCLE',
  lead: 'For the owners of an ORBES piece: the news of the maison, its invitations and its questions.',
  loading: 'ONE MOMENT…',
  loadFailed: 'The circle could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'Nothing has been published in the circle yet.',
  more: 'SHOW MORE',
  moreFailed: 'More posts could not be shown just now.',
  scan: 'SCAN ORBES CODE',
  /** Signed out: the sign-in follows. */
  signIn: 'The circle is reserved for the owners of an ORBES piece. Sign in with your ORBES account.',
  /** Signed in, no piece held now. */
  ownersOnly: 'The circle is reserved for the owners of an ORBES piece. It opens once a piece is registered to your ORBES account.',
  /** A post below the reader's tier, withdrawn, or an address that leads nowhere. */
  notFound: 'This post is not in the circle.',
  kind: Object.freeze({ NOTE: 'NOTE', INVITATION: 'INVITATION', POLL: 'POLL' }),
  /** The text link of each post of the feed. */
  see: Object.freeze({ NOTE: 'READ THE NOTE', INVITATION: 'SEE THE INVITATION', POLL: 'SEE THE POLL' }),
  /** Who reads a post reserved to the higher tiers. */
  reach: Object.freeze({ 2: 'PLATINE AND PALLADIUM', 3: 'PALLADIUM' }),
  /** What the reader did, on a post of the feed. */
  answered: (answer: string) => `YOU ANSWERED ${answer}`,
  voted: 'YOU VOTED',
  photosLabel: (title: string) => `Photographs of ${title}`,
  /** A photograph whose own text is empty. */
  photoAlt: (title: string) => `${title}, photographed by ORBES`,
  section: Object.freeze({ invitation: 'THE INVITATION', answer: 'YOUR ANSWER', poll: 'THE POLL', links: 'TO SEE' }),
  rows: Object.freeze({ when: 'WHEN', where: 'WHERE', places: 'PLACES' }),
  places: (left: number, capacity: number) => (left === 0 ? `NONE LEFT OF ${capacity}` : `${left} LEFT OF ${capacity}`),
  yes: 'YES',
  no: 'NO',
  /** The accessible name of the YES · NO choice. */
  answerChoice: 'Your answer to this invitation',
  answer: Object.freeze({
    none: 'Will you come? Answer YES or NO: you may change your answer until the event begins.',
    yes: 'You will come. You may change your answer until the event begins.',
    no: 'You will not come. You may change your answer until the event begins.',
    full: 'Every place is taken. One may open if an owner answers NO.',
    closed: 'The event has begun: answers are closed.',
  }),
  /** The accessible name of the poll's options. */
  pollChoice: 'The options of this poll',
  pollLead: 'One vote per account, and it is final. The results show once you have voted.',
  pollVoted: 'Your vote is counted. The results so far:',
  /** The poll's hairline button, once an option is chosen: a vote is final. */
  vote: 'VOTE',
  votes: (n: number) => (n === 1 ? '1 VOTE' : `${n} VOTES`),
  yourVote: 'YOUR VOTE',
  /** A link to another site (its host is shown beside it); a release's and a model's links are SEE THE RELEASE and SEE THE MODEL. */
  openLink: 'OPEN THE LINK',
  /** The accessible name of a link to another site: where it leads. */
  externalLabel: (host: string) => `Open the link on ${host}, in a new tab`,
});

