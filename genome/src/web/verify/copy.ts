/**
 * Interface copy of the verification app (statuses, guidance, problems).
 *
 * Voice: brief, calm, factual, in the house style: uppercase tracked titles,
 * sentence-case explanations. No exclamation marks, no blame. Nothing here
 * says an object is genuine: a code proves an ORBES-issued identity, not the
 * physical piece (the result copy itself comes from the server).
 */
import { CHAPTER_LABELS, RAIL_LABEL } from '../shared/chapters.js';
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

/** The zoom toggle's accessible name (C11): what pressing it does, its figure named. */
export const ZOOM = Object.freeze({
  out: (label: string) => `Zoom out to ${label}`,
  in: (label: string) => `Zoom in to ${label}`,
});

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
 * ORBES Client Services' email under FORGOTTEN PASSWORD? (BRAND-DESIGN-SYSTEM §4.2), the one place of the collector app
 * it remains (plan NEXT-NINE, CS-01: everywhere else, WRITE TO ORBES CLIENT SERVICES, MESSAGES): a text link opens an
 * email prefilled with the scan reference. Never "Contact support" (§4.5).
 */
export const CONTACT = Object.freeze({
  action: 'CONTACT ORBES CLIENT SERVICES',
  /** The label of the fact under the customer's own words in the prefilled email. */
  reference: 'REFERENCE',
  /** Subject of the email under FORGOTTEN PASSWORD? (C-04). */
  recoverySubject: 'ORBES — FORGOTTEN PASSWORD',
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
  tabs: Object.freeze({ ownership: 'OWNERSHIP', warranty: 'WARRANTY', service: 'SERVICE', care: 'CARE' }),
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
  // NOCTURNE (C3, C4): the tabs of MY PIECES, a piece's link and its page, ADD A PIECE, where a piece comes from.
  /** The tabs of MY PIECES (C3, C24, C31), and their accessible name. */
  pageTabs: Object.freeze({ pieces: 'PIECES', orders: 'ORDERS', releases: 'RELEASES' }),
  pageTabsLabel: 'My pieces',
  /** Under each piece of the list, the link to its page; the crumb of a piece's page back to the list. */
  seePiece: 'SEE THE PIECE',
  back: 'MY PIECES',
  /** « REGISTERED TO YOU · SINCE 3 OCT 2026 » under a piece of the list. */
  since: (date: string) => `SINCE ${date}`,
  add: 'ADD A PIECE',
  addLead: 'Scan a piece, then register it from the OWNERSHIP tab of its result.',
  /** Addition 2 (C4): its release and its order. */
  origin: Object.freeze({
    label: 'WHERE IT COMES FROM',
    draw: (day: string) => `THE DRAW OF ${day}`,
    live: (day: string) => `THE LIVE RELEASE OF ${day}`,
    /** The order's step now and when it reached it: « DELIVERED ON 22 SEP 2026 ». */
    step: (step: string, date: string) => (date ? `${step} ON ${date}` : step),
  }),
});

/**
 * MY PIECES' orders (plan LIVE RELEASE+, choice 6; GET /api/v1/account/orders): one order per piece, sold in a LIVE
 * RELEASE, a draw or the private salon, step by step: RESERVED · PAID · SHIPPED · DELIVERED with their dates, or
 * CANCELLED, or RETURNED; the model, the size, the add-ons and the price; once shipped, the carrier and the tracking
 * number, with its link to the carrier's site in a new tab. ORBES Client Services moves each step (DELIVERED also comes
 * when the piece is registered): nothing here changes an order.
 */
export const ORDERS = Object.freeze({
  title: 'YOUR ORDERS',
  loadFailed: 'Your orders could not be shown just now.',
  /** Accessible name of an order's steps. */
  stepsLabel: 'Steps of this order',
  step: Object.freeze({ RESERVED: 'RESERVED', PAID: 'PAID', SHIPPED: 'SHIPPED', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED', RETURNED: 'RETURNED' }),
  /** What the order's step means now. */
  sentence: Object.freeze({
    RESERVED: 'Your piece is reserved. ORBES Client Services will contact you to settle payment and delivery.',
    PAID: 'Your payment is received. ORBES is preparing your piece for shipping.',
    SHIPPED: 'Your piece is on its way. Once it has arrived, scan its ORBES CODE to register it to your account.',
    DELIVERED: 'Your piece has been delivered.',
    CANCELLED: 'This order has been cancelled.',
    RETURNED: 'This order has been returned to ORBES.',
  }),
  /** Where the piece was sold; a welcome gift (plan NEXT-NINE, BP-19 T5) travels with an order. */
  channel: Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW', SALON: 'THE PRIVATE SALON', GIFT: 'WELCOME GIFT' }),
  rows: Object.freeze({ size: 'SIZE', price: 'PRICE', shipping: 'SHIPPING', credit: 'CREDIT', total: 'TOTAL', carrier: 'CARRIER', tracking: 'TRACKING NUMBER' }),
  /**
   * BP-19 T5: a welcome gift, on its own card: its line (WELCOME GIFT · PLATINE), its price (none of its own), and while
   * it waits the order it travels with. The credit taken off an order reads − € 50 (CREDIT).
   */
  gift: Object.freeze({
    price: 'WELCOME GIFT',
    travels: (reference: string) => `Your welcome gift travels with order ${reference}.`,
  }),
  credit: (amount: string) => `\u2212 ${amount}`,
  /**
   * BP-19 T4: an order's shipping, free by its tier (FREE · PLATINE, FREE EXPRESS · PALLADIUM), at its fee (€ 20, EXPRESS
   * · € 40), or carried by the order it travels with.
   */
  shipping: Object.freeze({
    free: (tier: string) => `FREE · ${tier}`,
    freeExpress: (tier: string) => `FREE EXPRESS · ${tier}`,
    express: (fee: string) => `EXPRESS · ${fee}`,
    withOrder: (reference: string) => `WITH ORDER ${reference}`,
  }),
  oneSize: 'ONE SIZE',
  /** A draw's or a salon's size or price, before ORBES Client Services enters it. */
  toConfirm: 'TO BE CONFIRMED',
  track: 'TRACK THE SHIPMENT',
  /** Accessible name of TRACK THE SHIPMENT: the number, the carrier, and that the carrier's site opens apart. */
  trackLabel: (trackingNumber: string, carrier: string) => `Track the shipment ${trackingNumber} on the site of ${carrier} (opens in a new tab)`,
  /** The order's reference, for ORBES Client Services. */
  reference: (reference: string) => `ORDER ${reference}`,
  /**
   * Its documents (plan LIVE RELEASE+, M6): the invoice and the credit note (PDFs, issued by CONGLOMERAT LLC), the
   * model's care guide (shown under them), and once the piece is registered to the account its ownership certificate.
   */
  documents: Object.freeze({
    title: 'DOCUMENTS',
    /** Followed by the document's number, in the reading face. */
    invoice: 'INVOICE',
    creditNote: 'CREDIT NOTE',
    careGuide: 'CARE GUIDE',
    certificate: 'OWNERSHIP CERTIFICATE',
    /** Under a document that saves a file (C24). */
    pdf: 'PDF',
    /** Accessible names: what each link does. */
    invoiceLabel: (number: string) => `Download the invoice ${number} (PDF)`,
    creditNoteLabel: (number: string) => `Download the credit note ${number} (PDF)`,
    certificateLabel: (model: string) => `Download the ownership certificate of your ${model} (PDF)`,
    careGuideLabel: (model: string) => `The care guide of ${model}`,
    downloadFailed: 'This document could not be downloaded just now.',
    careFailed: 'The care guide could not be shown just now.',
  }),
});

/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11): for 7 days from the release's end, on its end page
 * to those who took part without a piece, in MY PIECES to those who said I'LL BE THERE and did not come. One tap,
 * changeable until it closes; the question and its answers are the release's (the console's words, or the default
 * WHAT WOULD YOU HAVE WANTED? · ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND).
 */
export const QUESTION = Object.freeze({
  label: 'ONE QUESTION',
  /** Before an answer, and after it: until when it may change (the date on this phone's calendar). */
  ask: (until: string) => `One tap. You may change your answer until ${until}.`,
  answered: (until: string) => `Thank you: your answer is recorded. You may change it until ${until}.`,
  saving: 'Recording your answer…',
  failed: 'Your answer could not be recorded just now.',
  /** MY PIECES: the section, its lead, and each release by its name (else LIVE RELEASE) and opening date. */
  piecesTitle: 'AFTER THE RELEASES',
  piecesLead: 'You said you would be there. One question about each release, for a week after it.',
  release: (name: string, date: string) => [name, date].filter(Boolean).join(' · '),
});

/**
 * The CARE tab of a piece in MY PIECES (P-M02): the care of its model (the result's CARE text), then ORBES Care, the
 * subscription that looks after the owner's pieces. SUBSCRIBE opens its page in a new tab once ORBES publishes one
 * (CARE_SUBSCRIBE_URL); until then, a plain sentence says subscriptions open soon, with nothing to press.
 */
export const ORBES_CARE = Object.freeze({
  /** The label of the model's care instructions. */
  careLabel: 'CARING FOR THIS PIECE',
  /** The label of the subscription's presentation, and its accessible name. */
  label: 'ORBES CARE',
  lead: 'ORBES Care looks after your pieces, year after year:',
  benefits: Object.freeze([
    'An annual care service by the ORBES atelier: inspection, cleaning and polishing.',
    'Priority repair with ORBES Client Services.',
    'An extended warranty.',
  ]),
  subscribe: 'SUBSCRIBE',
  /** The accessible name of SUBSCRIBE: it opens another page, in a new tab. */
  subscribeLabel: 'Subscribe to ORBES Care, in a new tab',
  soon: 'Subscriptions open soon.',
});

/**
 * YEARLY CARE (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6), in a piece's SERVICE tab above SERVICE HISTORY: the yearly
 * care a PLATINE or PALLADIUM tier includes, asked for from the piece with the address it returns to, then each step.
 * Shown only when the account's tier has a care allowance (or a request of the piece is still open). Apart from ORBES
 * CARE, the subscription of the CARE tab, which stays as it is. The prepaid label is shown here only.
 */
const CARE_PIECES = (allowance: number | 'ALL') => (allowance === 'ALL' ? 'every piece' : allowance === 1 ? '1 piece' : `${allowance} pieces`);

export const YEARLY_CARE = Object.freeze({
  /** The block's label, and its accessible name. */
  label: 'YEARLY CARE',
  available: (tier: string, allowance: number | 'ALL', year: number) =>
    `Your ${tier} tier includes the yearly care of ${CARE_PIECES(allowance)} in ${year}: inspection, cleaning and polishing by the ORBES atelier. ORBES Client Services sends you a prepaid label for this piece, and returns it to you at no cost.`,
  request: 'REQUEST YEARLY CARE',
  /** The request's own form, in place. */
  confirm: (year: number) => `Request the yearly care of this piece for ${year}?`,
  returnAddress: 'RETURN ADDRESS',
  returnLead: 'Where ORBES returns the piece once its care is done.',
  name: 'NAME',
  address: 'ADDRESS',
  prefilled: 'From your last order. Check it before you confirm.',
  missing: 'Enter the name and the address the piece returns to.',
  confirmRequest: 'CONFIRM REQUEST',
  cancel: 'CANCEL',
  /** The longest name and address (services/care.ts CARE_ADDRESS_LIMITS). */
  nameMax: 200,
  addressMax: 1000,
  requested: (date: string) => `REQUESTED · ${date}`,
  requestedText: 'ORBES Client Services is preparing your prepaid label. It will appear here.',
  cancelRequest: 'CANCEL REQUEST',
  labelTitle: 'YOUR PREPAID LABEL',
  labelText: 'Print it, pack the piece in its box and hand it to the carrier.',
  download: 'DOWNLOAD LABEL',
  carrier: 'CARRIER',
  tracking: 'TRACKING NUMBER',
  received: 'AT THE ATELIER',
  receivedText: 'The ORBES atelier has received your piece.',
  returning: 'ON ITS WAY BACK',
  track: 'TRACK THE SHIPMENT',
  done: (year: number) => `Its yearly care for ${year} is complete. It is recorded in SERVICE HISTORY.`,
  cancelled: 'This request was cancelled.',
  used: (year: number) => `Your yearly care for ${year} has been used for another piece. It renews on 1 January.`,
  pieceDone: (year: number) => `This piece has had its yearly care for ${year}.`,
  unavailable: 'The yearly care cannot be requested for this piece just now.',
});

/**
 * THE CLUB'S TIERS (P-X04, at the head of MY PIECES): the account's tier, TITANE, PLATINE or PALLADIUM (1, 5 and 10
 * pieces held now, never a revoked one), its name in the display face and its pieces in the reading face, the benefits
 * of the tier and of those below it (the server's words, set by ORBES), and the way to the next tier. An account that
 * holds no piece reads what its first one opens.
 */
const TIER_WAY = (tier: string, missing: number, from: number) =>
  `${missing} more ${Number(missing) === 1 ? 'piece registered to your account opens' : 'pieces registered to your account open'} ${tier}, from ${from} pieces held.`;
const TIER_FIRST = (tier: string) => `A piece registered to your ORBES account opens ${tier}, the first tier of the club`;

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
  nextWay: (tier: string, missing: number, from: number) => `${TIER_WAY(tier, missing, from)} It adds:`,
  /** The same way, said alone: NOW's line under YOUR PIECES (C1), after the tier and its pieces. */
  way: (tier: string, missing: number, from: number) => TIER_WAY(tier, missing, from),
  /** An account without a tier: what its first piece opens. */
  first: (tier: string) => `${TIER_FIRST(tier)}:`,
  /** The same, said alone (NOW's line under YOUR PIECES). */
  firstWay: (tier: string) => `${TIER_FIRST(tier)}.`,
  /** PALLADIUM: no tier above. */
  top: 'PALLADIUM is the highest tier of the club.',
  /** Shown when MY PIECES lists more pieces than the tier counts: a piece revoked or retired by ORBES counts for none. */
  counted: 'A piece revoked or retired by ORBES counts for no tier.',
  /** The benefits in use (plan NEXT-NINE, BP-19 T10): shown only when a row exists. */
  inUse: 'IN USE',
  credit: 'CREDIT',
  creditValue: (amount: string, date: string) => `${amount} · UNTIL ${date}`,
  /** Under the rows, when a credit exists. */
  creditNote: 'ORBES Client Services takes it off the invoice of a piece from a draw, a LIVE RELEASE or THE PRIVATE SALON.',
  care: 'YEARLY CARE',
  careOf: (used: number, allowance: number, year: number) => `${used} OF ${allowance} ${allowance === 1 ? 'PIECE' : 'PIECES'} IN ${year}`,
  careAll: (used: number, year: number) => `EVERY PIECE · ${used} IN ${year}`,
  gift: 'WELCOME GIFT',
  giftNext: 'WITH YOUR NEXT ORDER',
  giftWith: (ref: string) => `WITH ORDER ${ref}`,
  /** The account sheet's row under MY PIECES, and the footer's line: THE CLUB's page. */
  club: 'THE CLUB',
});

/**
 * THE CLUB (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T9; /verify/club): a public page that explains the tiers, their
 * figures and their benefits read from the server (GET /api/v1/the-club), never typed here. Signed in, the account's
 * own tier; without a tier, what its first piece opens; signed out, the sign-in.
 */
const CURRENCY_WORDS: Readonly<Record<string, string>> = Object.freeze({ EUR: 'euros', GBP: 'pounds sterling', USD: 'US dollars', CHF: 'Swiss francs' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const CLUB_PAGE = Object.freeze({
  title: 'THE CLUB',
  /** The figures of the tiers, as the server holds them (CLUB_TIER_THRESHOLDS). */
  lead: (titane: number, platine: number, palladium: number) =>
    `Your tier is set by the pieces registered to your ORBES account now: TITANE from ${plural(titane, 'piece', 'pieces')}, PLATINE from ${platine}, PALLADIUM from ${palladium}.`,
  /** Under a tier's name. */
  from: (n: number) => `FROM ${plural(n, 'PIECE', 'PIECES')}`,
  /** A welcome gift's photograph. */
  giftAlt: (model: string) => `${model}, photographed by ORBES`,
  how: 'HOW THE TIERS WORK',
  follows: 'Your tier follows the pieces registered to you at every moment: a piece passed on, revoked or retired by ORBES counts for no tier, and your tier follows at once.',
  once: 'The welcome gift and the credit are given once per tier and per account.',
  currency: (code: string) => `The credit applies to orders in ${CURRENCY_WORDS[code] ?? code}.`,
  shipping: 'Free shipping applies to deliveries, not to returns.',
  draws: 'Each draw’s page gives its own early access times.',
  /** Signed in with a tier: the account sheet. */
  yourTier: (name: string, pieces: number) => `YOUR TIER: ${name} · ${plural(pieces, 'PIECE', 'PIECES')} HELD`,
  /** Signed in without a tier: MY PIECES. */
  first: 'YOUR FIRST PIECE OPENS TITANE',
  /** Signed out: MY PIECES' sign-in. */
  signIn: 'SIGN IN TO SEE YOUR TIER',
  loading: 'ONE MOMENT…',
  failed: 'The club could not be shown just now.',
  retry: 'TRY AGAIN',
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
 * The photograph above the GENOME of an authentic result (F-04): its model's reference photograph, or its variant's
 * (plan NOCTURNE, decision 9: the model is the reference for a piece; no photograph of the piece itself is shown). It
 * shows what ORBES registered under this identity, for the customer to compare with the piece in hand. Nothing here
 * says the object is genuine (§4.6).
 */
export const PHOTOS = Object.freeze({
  /** The section's accessible name. */
  label: 'Photographs of this piece',
  /** Its name in MY PIECES, where each piece of the list has its own (F-01). */
  labelOf: (productId: string) => `Photographs of ${productId}`,
  model: 'THE MODEL',
  /** « The MONOLITHE BRACELET model in steel, photographed by ORBES »: the model, and its variant when it has one (N1). */
  modelAlt: (model: string, type: string, variant?: string | null) =>
    `The ${[model, type].filter((x) => x.length > 0).join(' ')} model${typeof variant === 'string' && variant.trim() ? ` in ${variant.trim().toLowerCase()}` : ''}, photographed by ORBES`,
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
 * DISCONTINUED (P-R06): a model an ADMIN discontinued is no longer made; its pieces verify as before. Said with the
 * year, under the product lines of an authentic result and of an ownership certificate, and on the line of its sheet
 * in THE COLLECTION; the result's PRODUCT tab has its row.
 */
export const DISCONTINUED = Object.freeze({
  line: (year: number) => `DISCONTINUED · ${year}`,
  row: 'DISCONTINUED',
});

/**
 * THE COLLECTION (P-R02, /verify/lookbook): the lookbook of the models ORBES shows, grouped by collection, each on an
 * ivory plate with SEE THE MODEL; then a model's sheet (/verify/lookbook/<slug>): its photographs, its story, its
 * specifications and its care. An owner signed in also sees THE PRIVATE SALON (P-X08): the reserved models its tier
 * reaches, each with its price, requested from its sheet (REQUEST THIS PIECE) and concluded by ORBES Client Services.
 * Reached from the landing, from MY PIECES and, under an authentic result, from SEE THE MODEL.
 */
/** A count said in words, from one to twelve (« You own two »). */
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export const LOOKBOOK = Object.freeze({
  title: 'THE COLLECTION',
  /** The text link of the landing, of MY PIECES and of a sheet's foot (back to the grid). */
  link: 'THE COLLECTION',
  lead: 'The models of ORBES, as the maison presents them.',
  loading: 'ONE MOMENT…',
  loadFailed: 'The collection could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'No model is shown in the collection yet.',
  /** P-X08: the section an owner of an ORBES piece sees, signed in; and the line of such a model's sheet. */
  reserved: 'THE PRIVATE SALON',
  reservedLead: 'Pieces offered to the owners of an ORBES piece, by tier, on request.',
  /** P-X08: a model of the salon on its sheet: its price, the tier it is offered from, and REQUEST THIS PIECE. */
  salon: Object.freeze({
    price: 'PRICE',
    tier: 'OFFERED FROM',
    lead: 'Offered to the owners of an ORBES piece, on request. ORBES Client Services contacts you to conclude the sale: nothing is paid here.',
    note: 'A NOTE FOR ORBES CLIENT SERVICES',
    noteHint: 'Optional: a size, a finish, the best time to call.',
    request: 'REQUEST THIS PIECE',
    /** The status once requested, and what follows. */
    requestedLabel: 'REQUESTED',
    requested: 'ORBES Client Services will contact you.',
    requestFailed: 'The request could not be sent.',
  }),
  /** The text link of each card, and the one under an authentic result. */
  seeModel: 'SEE THE MODEL',
  /** NOCTURNE (addition 8): a model's sizes, from its SKUs and its variants' (`SIZES 16 · 17 · 18`, `SIZE 17`). */
  sizes: (...sizes: string[]) => (sizes.length === 1 ? `SIZE ${sizes[0]}` : `SIZES ${sizes.join(' · ')}`),
  /** The accessible name of a model's variant dots. */
  variants: 'Its variants',
  /**
   * NOCTURNE: the account's pieces of a model and its variants (« You own two: steel and gold »), counted from MY PIECES;
   * the variants named when the model has some.
   */
  youOwn: (n: number, ...variants: string[]) => {
    const count = n >= 1 && n <= 12 ? NUMBER_WORDS[n - 1] : String(n);
    const named = variants.length > 1 ? `${variants.slice(0, -1).join(', ')} and ${variants[variants.length - 1]}` : (variants[0] ?? '');
    return named ? `You own ${count}: ${named}` : `You own ${count}`;
  },
  scan: 'SCAN ORBES CODE',
  /**
   * NOCTURNE (addition 7, C5): THE PRIVATE SALON for a visitor (signed out, or an account that holds no piece): what it is
   * and what opens it, never a model (terms, article 12); SIGN IN and SCAN ORBES CODE.
   */
  teaser: 'Pieces offered to the owners of an ORBES piece, by tier, on request. It opens once a piece is registered to your ORBES account.',
  /**
   * NOCTURNE (screen 5): THE PRIVATE SALON locked below an owner's tier, in the teaser's pieces: what it is, then the
   * tier that opens it and the pieces that tier starts from (the club's), never a model (terms, article 12).
   */
  locked: (tier: string, pieces: number) =>
    `Pieces offered to the owners of an ORBES piece, by tier, on request. It opens at ${tier}, from ${pieces} pieces registered to your ORBES account.`,
  signIn: 'SIGN IN',
  /** The accessible name of a sheet's dots: each switches the sheet to that variant (N6, C6). */
  variant: 'Variant',
  /**
   * NOCTURNE N6 (C6): a model's next release, a plate row under its dots: its kind (LIVE RELEASE, DRAW · ENTRIES OPEN),
   * then its variant and its day and hour, without a countdown (`IN BLUE, THURSDAY 21:00 PARIS`): a LIVE RELEASE in
   * Paris (its weekday within the coming six days, else its weekday then its date: THURSDAY 22 OCTOBER · 21:00 PARIS),
   * a draw in UTC as THE RELEASES say it (ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC). The words before the date may wrap;
   * a date never parts from its hour (`week`, `dated`, `utc`: each kept on one line).
   */
  next: Object.freeze({
    variant: (label: string) => `IN ${label.toUpperCase()},`,
    week: (weekday: string, time: string) => `${weekday} ${time} PARIS`,
    dated: (date: string, time: string) => `${date} · ${time} PARIS`,
    opens: 'ENTRIES OPEN',
    closes: 'ENTRIES CLOSE',
    utc: (time: string) => `${time} UTC`,
  }),
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
 * The early access (P-X02), by tier (plan NEXT-NINE, BP-19 T3): before entries open to everyone (PALLADIUM 4 hours and
 * PLATINE 2 hours by default, set per release), the owners PALLADIUM, then PLATINE, reserve a place directly, first
 * come, first served, within the pieces of the release; the pieces left then go to the draw. The release's page says
 * the times, the privilege is recalled in THE CIRCLE and in MY PIECES.
 */
export const RELEASES = Object.freeze({
  title: 'THE RELEASES',
  /** The text link of the landing, of MY PIECES and of a release's foot (back to the list). */
  link: 'THE RELEASES',
  lead: 'Pieces released in a limited number, by draw or LIVE RELEASE, with your ORBES account: ORBES Client Services concludes each sale.',
  loading: 'ONE MOMENT…',
  loadFailed: 'The releases could not be shown just now.',
  /** The LIVE RELEASES could not be read while the draws could: said above the draws. */
  liveFailed: 'The LIVE RELEASES could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'No release is announced yet.',
  /**
   * The two tabs (plan LIVE RELEASE+, choice 5): LIVE, the releases to come and under way (THE RELEASES' calendar); PAST,
   * the releases ended.
   */
  tabs: Object.freeze({ label: 'THE RELEASES', live: 'LIVE', past: 'PAST' }),
  /** PAST: every release ended, the newest first, as announced (no end figure); signed in, the account's part in each. */
  past: Object.freeze({
    empty: 'No release has ended yet.',
    loadFailed: 'The past releases could not be shown just now.',
    more: 'SHOW MORE',
    moreFailed: 'More releases could not be shown just now.',
    kind: Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' }),
    /** A card's opening date, then its quantity as announced: `11 OCT 2026 · 25 PIECES`. */
    line: (date: string, quantity: string) => [date, quantity].filter(Boolean).join(' · '),
    /** At the top of PAST, signed in. */
    taken: (n: number) => `You have taken part in ${n} ${n === 1 ? 'release' : 'releases'}.`,
    takenFailed: 'Your part in the releases could not be shown just now.',
    /** On a card, and on the release's page. */
    tookPart: 'YOU TOOK PART',
    secured: 'YOU SECURED A PIECE',
  }),
  /** A release ended, on its page (plan LIVE RELEASE+, decision 30): a neutral status, never how it ended. */
  over: 'THIS RELEASE IS OVER',
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
  /** P-X02: the line under a release's state, its two openings in UTC, when PLATINE and PALLADIUM reserve from the same time. */
  access: (early: string, everyone: string) => `PLATINE AND PALLADIUM: FROM ${early} · EVERYONE: FROM ${everyone}`,
  /** BP-19 T3: the line under a release's state when each tier has its own time (PLATINE's left out when it has none). */
  accessByTier: (palladium: string, platine: string | null, everyone: string) =>
    [`PALLADIUM: FROM ${palladium}`, ...(platine ? [`PLATINE: FROM ${platine}`] : []), `EVERYONE: FROM ${everyone}`].join(' · '),
  /** P-X02: THE RELEASE's paragraph on its early access, when PLATINE and PALLADIUM reserve from the same time. */
  earlyNote:
    'Before entries open to everyone, PLATINE and PALLADIUM owners reserve a place directly, first come, first served, within the pieces of the release: their tier is the one their account holds when they reserve. The pieces left then go to the draw.',
  /** BP-19 T3: THE RELEASE's paragraph when each tier has its own time. */
  earlyNoteByTier:
    'Before entries open to everyone, PALLADIUM owners, then PLATINE owners, reserve a place directly, first come, first served, within the pieces of the release: their tier is the one their account holds when they reserve. The pieces left then go to the draw.',
  /**
   * BP-19 T3: the EARLY ACCESS row, each tier's hours (`4 HOURS`), PLATINE's left out when it has none. Each tier's words
   * are joined by no-break spaces, so that a narrow phone wraps the row only at ' · ', never between a figure and its unit.
   */
  earlyHours: (palladium: string, platine: string | null) => {
    const group = (tier: string, hours: string) => `${tier} ${hours}`.replace(/ /g, '\u00a0');
    return platine ? `${group('PALLADIUM', palladium)} · ${group('PLATINE', platine)}` : group('PALLADIUM', palladium);
  },
  pieces: (n: number) => (n === 1 ? '1 PIECE' : `${n} PIECES`),
  hours: (n: number) => (n === 1 ? '1 HOUR' : `${n} HOURS`),
  /** A time shown in UTC, then on the phone's own clock. */
  utc: (time: string) => `${time} UTC`,
  onThisPhone: (time: string, offset: string) => `${time} on this phone (${offset})`,
  /** The line of a release in the list: its pieces and the time that matters now. */
  opensLine: (pieces: string, time: string) => `${pieces} · ENTRIES OPEN ${time} UTC`,
  closesLine: (pieces: string, time: string) => `${pieces} · ENTRIES CLOSE ${time} UTC`,
  section: Object.freeze({ release: 'THE RELEASE', entry: 'YOUR ENTRY', draw: 'THE DRAW', entries: 'THE ENTRIES' }),
  rows: Object.freeze({ model: 'MODEL', price: 'PRICE', pieces: 'PIECES', early: 'EARLY ACCESS', opens: 'ENTRIES OPEN', closes: 'ENTRIES CLOSE', held: 'PLACE HELD', reserved: 'RESERVED DIRECTLY', drawn: 'DRAWN' }),
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
    /** BP-19 T3, a PLATINE account during PALLADIUM's hours: when its own begin. */
    earlyPalladium: (from: string) => `PALLADIUM owners are reserving their places now. As a PLATINE owner, you may reserve a place from ${from}.`,
    /** BP-19 T3, any other account during PALLADIUM's hours only. */
    earlyOthersPalladium: (until: string) => `PALLADIUM owners are reserving their places now. Entries open to everyone on ${until}.`,
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
  /** Over the draw's list: what it shows, never how many (no end figure, plan LIVE RELEASE+ choice 5). */
  entriesLead: 'Every entry the draw ranked, in its order: its rank, its tier and its seniority at the draw, then its identifier.',
  /** One entry of the draw's list: its rank, its tier and its seniority. */
  entryLine: (rank: number, tier: string, years: number) => `${rank} · ${tier} · ${years === 1 ? '1 YEAR' : `${years} YEARS`}`,
  noTier: 'NO TIER',
  yours: 'YOURS',
  more: 'SHOW MORE',
  entriesFailed: 'The entries could not be shown just now.',
  /** MY PIECES: the account's entries. */
  yourEntries: 'YOUR RELEASES',
  entryFailed: 'Your entries could not be shown just now.',
  /** P-X02: the privilege of PLATINE and PALLADIUM, recalled in THE CIRCLE and in MY PIECES (for an account without a tier: from TITANE up, YOUR TIER says it). */
  earlyAccess: Object.freeze({
    label: 'EARLY ACCESS',
    recall: 'PLATINE and PALLADIUM owners reserve a place in each release directly, before it opens to everyone: first come, first served, within its pieces. Each release’s page gives the times.',
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
  /** The accessible name of the feed's list (the canvas's). */
  postsLabel: 'Posts',
  /** Signed out: the sign-in follows. */
  signIn: 'The circle is reserved for the owners of an ORBES piece. Sign in with your ORBES account.',
  /** Signed in, no piece held now. */
  ownersOnly: 'The circle is reserved for the owners of an ORBES piece. It opens once a piece is registered to your ORBES account.',
  /** A post below the reader's tier, withdrawn, or an address that leads nowhere. */
  notFound: 'This post is not in the circle.',
  kind: Object.freeze({ NOTE: 'NOTE', INVITATION: 'INVITATION', POLL: 'POLL' }),
  /** An invitation's experience of the tier program (plan NEXT-NINE, BP-19 T7), above its title. */
  experience: Object.freeze({ MEMBERS_EVENING: 'MEMBERS’ EVENING', LAUNCH_PREVIEW: 'LAUNCH PREVIEW', PARTNER_EXPERIENCE: 'PARTNER EXPERIENCE' }),
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

/**
 * The ceremony of a first registration (P-D01), on the result VIEW AS OWNER opens: the GENOME appears glyph by glyph,
 * then the name of its model and its collection; under them SHARE THE GENOME, a text link that shares (or saves) an
 * image of the GENOME on ivory with the same two names. Neither the identity of the piece nor the account is in it.
 */
export const CEREMONY = Object.freeze({
  /** The accessible name of the names under the GENOME. */
  label: 'Your piece',
  share: 'SHARE THE GENOME',
  /** The title handed to the share sheet with the image. */
  shareTitle: 'ORBES GENOME',
  /** The image's file name, when it is shared or saved. */
  filename: 'ORBES-GENOME.png',
});

/**
 * NOCTURNE's chrome (plan NOCTURNE, Navigation): the header's account button (the tier's name and the monogram,
 * decision 11; SIGN IN signed out), the rail of chapters, the SCAN ring at the foot of every screen.
 */
export const CHROME = Object.freeze({
  /** The rail's landmark, the canvas's. */
  rail: RAIL_LABEL,
  /** shared/chapters.ts: the legal pages carry the same rail. */
  chapters: CHAPTER_LABELS,
  signIn: 'SIGN IN',
  /** The SCAN ring: its word under it, and its name (the word first, as it reads). */
  scan: 'SCAN',
  scanLabel: 'Scan an ORBES code',
});

/**
 * NOW (plan NOCTURNE, screen 1; /verify, in place of the landing): the hero What leads chooses (a LIVE RELEASE, else a
 * draw, else the newest model of the collection), the draw under a LIVE RELEASE as a plate card, YOUR PIECES and THE
 * CIRCLE's next invitation for an owner, THE COLLECTION, then the scan. Its other words are those of the screens it
 * leads to (RELEASES, LIVE, LOOKBOOK, CIRCLE, PIECES, TIER).
 */
export const NOW = Object.freeze({
  /** The page's name when no hero leads it (the rail's chapter). */
  label: 'NOW',
  /** The sections' accessible names, the canvas's. */
  sections: Object.freeze({ release: 'The next release', also: 'Also announced', collection: 'The collection', pieces: 'Your pieces', circle: 'The circle', scan: 'Scan' }),
  /** A draw's kind, before its state: DRAW · ENTRIES OPEN. */
  draw: 'DRAW',
  pieces: 'YOUR PIECES',
  scan: 'SCAN ORBES CODE',
  upload: 'UPLOAD A PHOTO',
});

/**
 * WRITE TO ORBES CLIENT SERVICES and MESSAGES (plan NEXT-NINE of 2026-10-06, §3.1 CS-01): every place that showed an
 * email address, a phone number or opening hours shows one button, which opens the write sheet; the answers arrive in
 * the account, under MESSAGES; NOW shows one line while an answer is unread. Nothing is emailed. Staff are never named:
 * the answers are signed ORBES CLIENT SERVICES, and the collector never sees a status.
 */
export const MESSAGES = Object.freeze({
  /** The button, at every place of the app that showed a contact. */
  write: 'WRITE TO ORBES CLIENT SERVICES',
  /** The write sheet's dialog name and its close. */
  close: 'Close',
  concerning: 'CONCERNING',
  yourMessage: 'YOUR MESSAGE',
  yourReply: 'YOUR REPLY',
  hint: 'Please leave out passwords and card numbers.',
  send: 'SEND',
  cancel: 'CANCEL',
  where: 'The answer will appear in your account, under MESSAGES.',
  /** The words checked here before the server checks them, as it writes them. */
  empty: 'Write your message.',
  tooLong: 'Your message is limited to 2,000 characters.',
  sent: 'MESSAGE SENT',
  sentText: 'Your message is with ORBES Client Services. Their answer will appear in your account, under MESSAGES.',
  seeMessages: 'SEE MESSAGES',
  done: 'CLOSE',
  signedOut: 'Sign in or create an ORBES account to write to ORBES Client Services. Their answer will appear in your account.',
  /** The account sheet's row, its mark while an answer is unread, and its view. */
  title: 'MESSAGES',
  new: 'NEW',
  back: 'YOUR ACCOUNT',
  you: 'YOU',
  house: 'ORBES CLIENT SERVICES',
  emptyThread: 'You may write to ORBES Client Services here, or from a piece, an order or a release, which is then attached to your message.',
  /** NOW's line while an answer is unread. */
  now: Object.freeze({ label: 'MESSAGES', sentence: 'ORBES Client Services has answered you.', read: 'READ' }),
  /** The help line of a scan with a problem, over the button. */
  help: 'ORBES Client Services can help with any question about this piece. The reference below is attached to your message.',
  /** What a message concerns, as the sheet labels it before sending (the server writes its own). */
  label: Object.freeze({ ref: 'REF', order: 'ORDER', warranty: 'WARRANTY NO LONGER VALID', salon: 'PRIVATE SALON REQUEST', reference: 'REFERENCE', in: 'IN' }),
  /** The longest message a collector writes (services/messages.ts MESSAGE_LIMITS.collector). */
  max: 2000,
});

/**
 * The account sheet (C2), from the header's account button: who is signed in, YOUR TIER (moved from MY PIECES,
 * decision 10: TIER's words), SOUND, CHANGE PASSWORD (ACCOUNT_PASSWORD's), MY PIECES, the legal pages, SIGN OUT.
 */
export const ACCOUNT = Object.freeze({
  /** The sheet's label, and its dialog's name. */
  title: 'YOUR ACCOUNT',
  signedInAs: 'SIGNED IN AS',
  close: 'Close',
  /** The legal pages' row: the index of the four, in a new tab. */
  legal: 'PRIVACY · TERMS · LEGAL · HELP',
  signOut: 'SIGN OUT',
});

/**
 * The sound signature (P-D07): SOUND ON / OFF, a text link at the foot of the landing. Its accessible name is SOUND,
 * its state is said by aria-pressed (ON or OFF beside the word is for the eye). On by default; kept on this device.
 */
export const SOUND = Object.freeze({
  label: 'SOUND',
  on: 'ON',
  off: 'OFF',
});

/** A release's label for a model in one size (services/release-stock.ts releaseSizeLabel), whatever its case. */
const isOneSize = (size: string) => typeof size === 'string' && size.trim().toUpperCase() === 'ONE SIZE';
/** A size in reading text: `in size 52`, or `in ONE SIZE` (never `in size ONE SIZE`). */
const inSizeWords = (size: string) => (isOneSize(size) ? 'in ONE SIZE' : `in size ${size}`);
/** Its twin for the display face: `IN SIZE 52`, or `IN ONE SIZE`. */
const inSizeLabel = (size: string) => (isOneSize(size) ? 'IN ONE SIZE' : `IN SIZE ${size}`);
/** A size named alone: `SIZE 52`, or `ONE SIZE`. */
const sizeName = (size: string) => (isOneSize(size) ? 'ONE SIZE' : `SIZE ${size}`);

/**
 * The LIVE RELEASE (plan of 2026-10-04, The experience): its card in THE RELEASES, its page at /verify/releases/<id>
 * as it becomes the room, the line, the turn, the piece secured and the reservation confirmed, and its edge pages, each
 * with one action. A time is said in Paris, then on this phone when it differs; every figure is set in the reading face.
 */
export const LIVE = Object.freeze({
  kind: 'LIVE RELEASE',
  /** Before the name's stage: the release has no name yet on screen. */
  unnamed: 'TO BE REVEALED',
  /** Where it stands, over its title. */
  phase: Object.freeze({ ANNOUNCED: 'LIVE RELEASE', ROOM: 'THE ROOM IS OPEN', LIVE: 'LIVE NOW' }),
  /** The card's line in THE RELEASES before the room opens. */
  opens: (when: string) => `OPENS ${when}`,
  opensIn: 'OPENS IN',
  units: Object.freeze({ days: 'DAYS', hours: 'HOURS', minutes: 'MINUTES', seconds: 'SECONDS' }),
  /** A time of the release in Paris (`SUNDAY 11 OCTOBER · 19:00 PARIS`), then on this phone when its zone differs. */
  paris: (day: string, time: string) => `${day} · ${time} PARIS`,
  onThisPhone: (day: string, time: string) => `${day} · ${time} ON THIS PHONE`,
  /**
   * The rules of access as the page states them, after « FOR »: « owners from PLATINE », « collectors who have taken part
   * in 3 releases », « selected collectors » (a segment's name is never said), joined by « or » when any one is enough.
   */
  forWhom: (rule: string) => `FOR ${rule.toUpperCase()}`,
  /** NOCTURNE (C27): the rules of a release any one of which lets a collector in, listed one under the other, OR between them. */
  whoMayEnter: 'WHO MAY ENTER',
  or: 'OR',
  /** A surprise in every box (plan LIVE RELEASE+, choice 3): a vault label on the release's page; what it is stays unsaid. */
  surprise: 'A SURPRISE IN EVERY BOX',
  perAccount: (n: number) => (n === 1 ? 'ONE PER COLLECTOR' : `UP TO ${n} PER COLLECTOR`),
  roomOpens: (minutes: number) => `THE ROOM OPENS ${minutes} ${minutes === 1 ? 'MINUTE' : 'MINUTES'} BEFORE`,
  calendar: 'ADD TO CALENDAR',
  /** The calendar of the reveals: the stages still to come, each with its time (never what it shows). */
  reveals: 'THE REVEALS',
  stage: Object.freeze({ SILHOUETTE: 'THE SILHOUETTE', NAME: 'THE NAME', PHOTO: 'THE PHOTOGRAPH' }) as Readonly<Record<string, string>>,
  /** Stages revealed at the same minute: `THE NAME AND THE PHOTOGRAPH`. */
  together: (first: string, then: string) => `${first} AND ${then}`,
  /** I'LL BE THERE: a collector who meets the rule says so with a size, until T0; the count is public. */
  there: Object.freeze({
    action: 'I’LL BE THERE',
    lead: 'Say you will be there, with your size: the room preselects it when it opens.',
    said: (size: string) => `YOU’LL BE THERE · ${sizeName(size)}`,
    change: 'Another size changes it. You may withdraw until the opening.',
    withdraw: 'WITHDRAW',
    /** Said aloud once withdrawn. */
    withdrawn: 'Withdrawn. You may say it again until the opening.',
    signIn: 'Sign in to say you will be there, with your size.',
    count: (n: number) => (n === 1 ? '1 COLLECTOR WILL BE THERE' : `${n} COLLECTORS WILL BE THERE`),
  }),
  /** The boutique board: the countdown, the door, the pieces left overall, live. */
  board: Object.freeze({
    of: (quantity: number) => `OF ${quantity} LEFT`,
    soldOut: 'SOLD OUT',
    ended: 'THE RELEASE HAS ENDED',
    live: 'LIVE',
    reconnecting: 'RECONNECTING',
    fullScreen: 'FULL SCREEN',
    unavailable: Object.freeze({ title: 'THIS BOARD IS NOT AVAILABLE', text: 'Its link may have been replaced or withdrawn. ORBES gives the current one.' }),
  }),
  /** How the places are drawn at the opening (the release's tier priority). */
  rule: (tierPriority: boolean) =>
    tierPriority
      ? 'Places are drawn by tier, then at random, among the collectors present at the opening. Those who arrive later join behind, in order of arrival.'
      : 'Places are drawn at random among the collectors present at the opening. Those who arrive later join behind, in order of arrival.',
  // The room
  untilOpening: 'UNTIL THE OPENING',
  inRoom: (n: number) => `${n} IN THE ROOM`,
  /** The latest host message, under the header. */
  message: 'FROM ORBES',
  paused: 'PAUSED',
  pausedLine: 'The release is paused. It resumes shortly, and no time passes on your turn meanwhile.',
  ready: Object.freeze({
    title: 'READY CHECK',
    signedIn: 'SIGNED IN',
    access: 'ACCESS',
    size: 'SIZE',
    connection: 'CONNECTION',
    clock: 'CLOCK',
    granted: 'GRANTED',
    choose: 'TO CHOOSE',
    live: 'LIVE',
    reconnecting: 'RECONNECTING',
    synced: 'SYNCED TO ORBES',
    syncing: 'SYNCING',
    /** The accessible state of a check. */
    ok: 'ready',
    pending: 'not ready yet',
  }),
  yourSize: 'YOUR SIZE',
  size: (label: string) => sizeName(label),
  /** A size that has no piece left to give. */
  soldOutSize: (size: string) => (isOneSize(size) ? 'One size, no piece left' : `Size ${size}, no piece left`),
  quantity: 'PIECES',
  fewer: 'One piece fewer',
  more: 'One piece more',
  enter: 'ENTER THE ROOM',
  enterLine: 'ENTER THE LINE',
  chooseLine: 'Choose your size, then enter the room. It can change until the opening, never after.',
  youreReady: 'YOU’RE READY',
  readyLine: (time: string) => `Your place is drawn at ${time}. Keep this page open.`,
  leaveRoom: 'LEAVE THE ROOM',
  // T0
  drawing: 'DRAWING THE PLACES',
  /** The order at T0, true of every rule of access (the accounts without a tier, where the rule lets them in, last). */
  drawingLine: (tierPriority: boolean) =>
    tierPriority ? 'By tier, the highest first; at random within each tier.' : 'At random among the collectors present at the opening.',
  /** After T0, for an account not in the line yet. */
  joinLine: 'The release is open. Choose your size to join the line: you take your place behind those already in it.',
  // The line
  yourPlace: 'YOUR PLACE',
  /** The place's label as a screen reader says it, before the figure. */
  yourPlaceSaid: 'Your place',
  ahead: (n: number, size: string) => (n === 0 ? `YOU ARE NEXT ${inSizeLabel(size)}` : `${n} AHEAD OF YOU ${inSizeLabel(size)}`),
  left: (left: number, quantity: number) => `${left} OF ${quantity} LEFT`,
  inSize: (n: number, size: string) => `${n} ${inSizeLabel(size)}`,
  held: (n: number) => (n === 1 ? '1 HELD PIECE MAY RETURN' : `${n} HELD PIECES MAY RETURN`),
  lineNote: 'When your turn comes, the seal appears here: press and hold it to secure your piece. Keep this page open.',
  // The turn
  yourTurn: 'YOUR TURN',
  returned: 'A PIECE HAS RETURNED',
  holding: 'HOLD',
  pressHold: 'PRESS AND HOLD THE SEAL',
  /** The accessible name of the seal: the keyboard holds it with the space bar or Enter. */
  sealLabel: 'Press and hold the seal, or hold the space bar, to secure your piece',
  toSecure: 'TO SECURE YOUR PIECE',
  letGo: 'Let go too early and the seal resets.',
  // Secured
  secured: 'SECURED',
  yourPiece: 'YOUR PIECE',
  securedAt: (time: string) => `SECURED AT ${time}`,
  addons: 'ADD-ONS',
  /** An add-on's price, per piece. */
  addonPrice: (price: string) => `+ ${price}`,
  pay: (total: string) => `PAY · ${total}`,
  toConfirm: 'TO CONFIRM',
  payNote: 'ORBES Client Services will contact you for payment and delivery.',
  release: 'RELEASE MY PLACE',
  /** RELEASE MY PLACE gives the piece back at once: a second tap within a few seconds confirms it. */
  releaseConfirm: 'TAP AGAIN TO RELEASE',
  // Confirmed
  confirmed: 'CONFIRMED',
  confirmedOf: (name: string) => `LIVE RELEASE · ${name}`,
  reservedIn: (size: string, quantity: number) =>
    `${quantity > 1 ? `Your ${quantity} pieces are reserved ${inSizeWords(size)}.` : isOneSize(size) ? 'Your piece is reserved in ONE SIZE.' : `Your piece is reserved in size ${size}.`} ORBES Client Services will contact you to settle payment and delivery.`,
  /** MY PIECES' YOUR RELEASES (plan LIVE RELEASE+, Interconnection): the piece secured, a past fact true at every step of
   *  its order (paid, shipped, delivered, cancelled or returned); its steps are its order's. */
  securedInPieces: (size: string, quantity: number) =>
    quantity > 1 ? `You secured ${quantity} pieces ${inSizeWords(size)}. Their steps follow in YOUR ORDERS.` : `You secured your piece ${inSizeWords(size)}. Its steps follow in YOUR ORDERS.`,
  rows: Object.freeze({ reserved: 'RESERVED', size: 'SIZE', pieces: 'PIECES', total: 'TOTAL', reference: 'REFERENCE' }),
  clientServices: 'CLIENT SERVICES',
  // The edge pages: a title, a sentence, one action
  edge: Object.freeze({
    signIn: Object.freeze({ title: 'SIGN IN TO ENTER', text: (rule: string) => `The room is open to ${rule}. Sign in, or create an account.` }),
    notEligible: Object.freeze({ text: 'Your ORBES account does not meet the rule of this release.' }),
    missed: Object.freeze({ title: 'YOUR TURN HAS PASSED', text: 'The piece went to the next collector in line.' }),
    expired: Object.freeze({ title: 'YOUR HOLD HAS ENDED', text: 'The piece has returned to the line for the next collector.' }),
    released: Object.freeze({ title: 'YOUR PLACE IS RELEASED', text: 'The piece has returned to the line for the next collector.' }),
    left: Object.freeze({ title: 'YOU LEFT THE LINE', text: 'Your place has gone to the collectors behind you.' }),
    removed: Object.freeze({ title: 'YOUR ENTRY IS REMOVED', text: 'ORBES has removed your entry from this release. ORBES Client Services can assist you.' }),
    soldOut: Object.freeze({
      title: (size: string) => (isOneSize(size) ? 'SOLD OUT' : `SOLD OUT IN SIZE ${size}`),
      stay: 'Every piece in your size is taken. You keep your place in case one returns, or you may leave.',
      none: 'Every piece in your size is reserved. You keep your place should ORBES add one, or you may leave.',
      leave: 'LEAVE THE LINE',
      leaveConfirm: 'TAP AGAIN TO LEAVE',
    }),
    ended: Object.freeze({
      SOLD_OUT: Object.freeze({ title: 'SOLD OUT', text: 'Every piece of this release is reserved.' }),
      CLOSED: Object.freeze({ title: 'THE RELEASE HAS CLOSED', text: 'Its time has run out before your turn came.' }),
      ENDED: Object.freeze({ title: 'THE RELEASE HAS ENDED', text: 'ORBES has ended this release before your piece was secured.' }),
    }),
    /** A release that no longer answers while its page is open (cancelled): it is in neither LIVE nor PAST. A release ended opens in its final state. */
    over: Object.freeze({ title: 'THIS RELEASE IS OVER', text: 'It no longer appears in THE RELEASES. Your entry, if you had one, stays in MY PIECES.' }),
  }),
  back: 'THE RELEASES',
  loading: 'ONE MOMENT…',
  loadFailed: 'The release could not be shown just now.',
  retry: 'TRY AGAIN',
  /** What the page says aloud as it changes (aria-live). */
  announce: Object.freeze({
    place: (place: number, ahead: number, size: string) => `Your place: ${place}. ${ahead === 0 ? `You are next ${inSizeWords(size)}` : `${ahead} ahead of you ${inSizeWords(size)}`}.`,
    turn: 'Your turn. Press and hold the seal until the ring is full.',
    returned: 'A piece has returned: your turn. Press and hold the seal until the ring is full.',
    secured: (name: string) => `Secured: ${name} is held for you.`,
    open: 'The release is open. The places are drawn.',
    reset: 'The seal has reset. Press and hold it until the ring is full.',
  }),
  /** MY PIECES: an entry's status, and what it means now. */
  statusLabel: Object.freeze({
    WAITING: 'IN THE ROOM',
    QUEUED: 'IN LINE',
    TURN: 'YOUR TURN',
    SECURED: 'PIECE HELD',
    CONFIRMED: 'CONFIRMED',
    MISSED: 'TURN PASSED',
    EXPIRED: 'HOLD ENDED',
    RELEASED: 'PLACE RELEASED',
    LEFT: 'LEFT',
    REMOVED: 'REMOVED',
    ENDED: 'ENDED',
  }),
  sentence: Object.freeze({
    WAITING: 'You are in the room. Your place is drawn at the opening.',
    QUEUED: 'You are in the line. Open the release to follow your place.',
    TURN: 'It is your turn. Open the release to secure your piece.',
    SECURED: 'A piece is held for you. Open the release to confirm it.',
    MISSED: 'Your turn passed before the seal was held.',
    EXPIRED: 'Your hold ended before it was confirmed.',
    RELEASED: 'You released your place: the piece returned to the line.',
    LEFT: 'You left this release.',
    REMOVED: 'ORBES removed your entry from this release.',
    ENDED: 'The release ended before your piece was secured.',
  }),
  reference: (ref: string) => `REFERENCE ${ref}`,
  /**
   * The after-room (plan LIVE RELEASE+, choice 2): a second door in the same vault, after a sell-out, for those who were
   * still in the line, in the same order; announced nowhere else.
   */
  afterRoom: Object.freeze({
    kind: 'THE AFTER-ROOM',
    title: 'A SECOND DOOR',
    text: 'You were still in the line when the last piece was secured. Behind this door, another piece is offered to those who were waiting, in the same order, for a short time.',
    enter: 'ENTER THE AFTER-ROOM',
    openUntil: (time: string) => `OPEN UNTIL ${time}`,
    /** In the after-room, before entering its line. */
    joinLine: 'You keep your place from the line. Choose your size to take it.',
    confirmedOf: (name: string) => `THE AFTER-ROOM · ${name}`,
    over: Object.freeze({ title: 'THE AFTER-ROOM IS CLOSED', text: 'Your entry, if you had one, stays in MY PIECES.' }),
    /** An entry of the after-room that ends with it (its edge pages are overlined THE AFTER-ROOM): never "the release". */
    ended: Object.freeze({
      SOLD_OUT: Object.freeze({ title: 'SOLD OUT', text: 'Every piece of the after-room is reserved.' }),
      CLOSED: Object.freeze({ title: 'THE AFTER-ROOM IS CLOSED', text: 'Its time has run out before your turn came.' }),
      ENDED: Object.freeze({ title: 'THE AFTER-ROOM HAS ENDED', text: 'ORBES has ended the after-room before your piece was secured.' }),
    }),
    /** Said aloud when the door appears. */
    announce: 'A second door has opened.',
  }),
});
