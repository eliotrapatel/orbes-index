/**
 * Interface copy of the verification app (statuses, guidance, problems).
 *
 * Voice: brief, calm, factual, in the house style: uppercase tracked titles,
 * sentence-case explanations. No exclamation marks, no blame. Nothing here
 * says an object is genuine: a code proves an ORBES-issued identity, not the
 * physical piece (the result copy itself comes from the server).
 */
import { CHAPTER_LABELS, RAIL_LABEL } from '../shared/chapters.js';
import { onComputer } from '../shared/desktop.js';
import { ApiError } from './api.js';
import type { ScanHint } from './capture.js';
import type { VerificationState } from './types.js';

/**
 * Desktop (BRIEF §5.8): a line written for a phone (a tap, "this phone") and its words on a computer, chosen
 * each time the line is read; a computer reads its own whatever its window's width (decision D6, shared/desktop.ts
 * `onComputer`), a phone and a tablet (and the tests) read the phone's words, unchanged.
 */
const forDevice = (phone: string, computer: string): string => (onComputer() ? computer : phone);

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
 * Desktop (BRIEF §5.8): the server's sentence for an unreadable code asks for the camera ("in even light,
 * holding the camera steady"); on a computer of any width (decision D6) the result asks for a photo instead (the SCAN
 * page's upload, or UPLOAD A PHOTO under the camera in a window narrower than 1024 px), so it says the photo's words
 * (as PROBLEMS' 'upload-unreadable') and the phone. A phone keeps the server's sentence, unchanged; every other result
 * keeps it on both.
 */
export function resultMessage(state: VerificationState, server: string): string {
  if (state !== 'MALFORMED_CODE' || !server) return server;
  return forDevice(server, 'This code could not be read. Please upload a sharp, well-lit photo in which the whole code is visible, or scan it with your phone.');
}

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
 * ivory plate with its GENOME, then OWNERSHIP · ORBES CARE · SERVICE. An owner whose piece is gone declares it
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
  /** A piece's three tabs (plan ORBES CARE §2(a), answer 6): ORBES CARE holds its warranty and its care; SERVICE its history. */
  tabs: Object.freeze({ ownership: 'OWNERSHIP', care: 'ORBES CARE', service: 'SERVICE' }),
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
  /**
   * A service's label in SERVICE HISTORY by its type (plan ORBES CARE §2(a)): YEARLY_CARE reads PRIVATE CARE; any other
   * type reads as it is stored, in capitals, its underscores as spaces.
   */
  serviceTypes: Object.freeze({ YEARLY_CARE: 'PRIVATE CARE' }) as Readonly<Record<string, string>>,
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
  /** Plan NEXT LOT §3.6.A: IN PREPARATION, a step of the card only (paid, its piece assigned), never a status. */
  step: Object.freeze({ RESERVED: 'RESERVED', PAID: 'PAID', IN_PREPARATION: 'IN PREPARATION', SHIPPED: 'SHIPPED', DELIVERED: 'DELIVERED', CANCELLED: 'CANCELLED', RETURNED: 'RETURNED' }),
  /**
   * What the order's step means now. Plan NEXT LOT §3.6.A: the delivery address is the collector's own (RESERVED no
   * longer says Client Services settles it), and preparing the piece is IN PREPARATION's (PAID says it will be).
   */
  sentence: Object.freeze({
    RESERVED: 'Your piece is reserved. ORBES Client Services will contact you to settle payment.',
    PAID: 'Your payment is received. Your piece will be prepared for shipping.',
    IN_PREPARATION: 'Your piece is being prepared for shipping.',
    SHIPPED: 'Your piece is on its way. Once it has arrived, scan its ORBES CODE to register it to your account.',
    DELIVERED: 'Your piece has been delivered.',
    CANCELLED: 'This order has been cancelled.',
    RETURNED: 'This order has been returned to ORBES.',
  }),
  /**
   * Plan NEXT LOT §3.6.A: while ORBES Client Services looks into a parcel's delivery (lost, damaged, back to its sender),
   * in place of the step's sentence; the case itself, the photo and the agent's notes are never shown.
   */
  deliveryIssue: 'ORBES Client Services is looking into the delivery of your piece and will write to you in MESSAGES.',
  /**
   * Where the piece was sold; a welcome gift (plan NEXT-NINE, BP-19 T5) travels with an order; the other size of a size
   * exchange is an order of its own (plan NEXT LOT §3.6.D).
   */
  channel: Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW', SALON: 'THE PRIVATE SALON', GIFT: 'WELCOME GIFT', EXCHANGE: 'SIZE EXCHANGE' }),
  rows: Object.freeze({ size: 'SIZE', price: 'PRICE', engraving: 'ENGRAVING', shipping: 'SHIPPING', credit: 'CREDIT', total: 'TOTAL', carrier: 'CARRIER', tracking: 'TRACKING NUMBER' }),
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
   * DELIVERY ADDRESS (plan NEXT LOT §3.6.B): on each order, its delivery address (the name, the lines as typed, the
   * country's English name, the phone) with CHANGE while it may change; without one, ADD THE DELIVERY ADDRESS; once the
   * agent has begun packing, only through ORBES Client Services; an order travelling with another, that order's. The
   * address sheet: a saved address, or A NEW ADDRESS (the four fields), saved to YOUR ADDRESSES when asked.
   */
  address: Object.freeze({
    label: 'DELIVERY ADDRESS',
    change: 'CHANGE',
    empty: 'Add the address your piece is to be delivered to.',
    add: 'ADD THE DELIVERY ADDRESS',
    locked: 'Packing has begun. To change the address, write to ORBES Client Services.',
    travels: (reference: string) => `Delivered with order ${reference}, to its address.`,
    /** An order travelling with one that was cancelled (plan NEXT LOT §3.6, edge cases). */
    travelsCancelled: 'ORBES Client Services will contact you about the delivery.',
    /** The sheet's title (and its dialog's name), and what it concerns: `ORDER OR-3F9A21C4 · MONOLITHE IN BLUE`. */
    title: 'DELIVERY ADDRESS',
    /** The saved addresses, one choice each; the default one marked. */
    saved: 'YOUR ADDRESSES',
    isDefault: 'DEFAULT',
    newAddress: 'A NEW ADDRESS',
    save: 'SAVE IT TO YOUR ADDRESSES',
    confirm: 'CONFIRM',
    cancel: 'CANCEL',
    /** A failure, followed by the server's message. */
    failed: 'The address could not be changed just now.',
    /** Accessible names: the CHANGE link, with what it changes. */
    changeLabel: (reference: string) => `Change the delivery address of order ${reference}`,
  }),
  /**
   * The four fields of a delivery address (plan NEXT LOT §3.6.B), on an order and in YOUR ADDRESSES, and what is said
   * before the server says it, in its words.
   */
  addressFields: Object.freeze({
    name: 'NAME',
    address: 'ADDRESS',
    addressHint: 'As it is written on the parcel, one line each.',
    country: 'COUNTRY',
    chooseCountry: 'Choose a country',
    phone: 'PHONE',
    phoneHint: 'For the carrier, with the country code: +33 6 12 34 56 78.',
    nameAndAddress: 'Enter the name and the address.',
    countryMissing: 'Choose a country.',
    phoneInvalid: 'Enter a phone number with its country code.',
  }),
  /**
   * ENGRAVING (plan NEXT LOT §3.6.C): its row (`« J.M. » · + € 30`, or the words alone when the release's add-on paid for
   * it), its link under the rows until packing begins, and its sheet. After payment, a Settings-priced engraving added
   * gets its own invoice and one removed a credit note, both in DOCUMENTS.
   */
  engraving: Object.freeze({
    value: (text: string, price: string | null) => (price ? `« ${text} » · + ${price}` : `« ${text} »`),
    add: 'ADD AN ENGRAVING',
    change: 'CHANGE THE ENGRAVING',
    /** The release's ENGRAVING add-on, its words not entered yet. */
    enter: 'ENTER YOUR ENGRAVING',
    locked: 'Packing has begun. The engraving no longer changes.',
    title: 'ENGRAVING',
    lead: 'Engraved on your piece before it is shipped.',
    field: 'YOUR ENGRAVING',
    hint: 'Up to 20 characters: letters, figures, spaces and . & ’ -',
    price: (price: string) => `ENGRAVING · + ${price}`,
    included: 'Your engraving was bought with your order.',
    paidAdd: 'Your order is paid: the engraving is added to it with its own invoice, in DOCUMENTS.',
    paidRemove: 'Your order is paid: a credit note for the engraving will be in DOCUMENTS.',
    save: 'SAVE',
    remove: 'REMOVE THE ENGRAVING',
    cancel: 'CANCEL',
    /** Said before the server says it, in its words. */
    empty: 'Enter your engraving.',
    invalid: 'Up to 20 characters: letters, figures, spaces and . & ’ -',
    /** A failure, followed by the server's message. */
    failed: 'The engraving could not be saved just now.',
  }),
  /**
   * ADD-ONS (plan MACRO M3 §4.4, D2): the catalogue add-ons of an order, each REMOVE until packing begins (a second tap
   * or click confirms it), and ADD AN ADD-ON, which opens their sheet (a page part on a computer): the add-ons available,
   * their units, the total, ADD. After payment an add-on added has its own invoice, one removed a credit note.
   */
  addons: Object.freeze({
    title: 'ADD-ONS',
    /** What the add-ons are, under the section's label on a computer and at the head of the sheet. */
    lead: 'Sent with your piece, in its parcel.',
    add: 'ADD AN ADD-ON',
    remove: 'REMOVE',
    get removeConfirm() {
      return forDevice('TAP AGAIN TO REMOVE', 'CLICK AGAIN TO REMOVE');
    },
    /** Accessible names of REMOVE, with what it removes: `Remove POLISHING CLOTH × 2 from order OR-3F9A21C4`. */
    removeLabel: (name: string, reference: string) => `Remove ${name} from order ${reference}`,
    removeConfirmLabel: (name: string) => forDevice(`Tap again to remove ${name}`, `Click again to remove ${name}`),
    paidAdd: 'Your order is paid: the add-on is added with its own invoice, in DOCUMENTS.',
    paidRemove: 'Your order is paid: a credit note for the add-on will be in DOCUMENTS.',
    locked: 'Packing has begun. Add-ons can no longer be added.',
    none: 'No add-on is available for this order just now.',
    loading: 'ONE MOMENT…',
    /** The sheet's group of rows, as a screen reader names it. */
    choices: 'The add-ons available for this order',
    total: 'TOTAL',
    save: 'ADD',
    cancel: 'CANCEL',
    /** Said before the server says it. */
    choose: 'Choose an add-on.',
    /** Failures, each followed by the server's message. */
    loadFailed: 'The add-ons could not be shown just now.',
    failed: 'The add-on could not be added just now.',
    removeFailed: 'The add-on could not be removed just now.',
  }),
  /**
   * RETURNS AND EXCHANGES (plan NEXT LOT §3.6.D): on a delivered order for 14 days, REQUEST A RETURN and EXCHANGE THE
   * SIZE (only the sizes in stock), a reason and a note; the order case opens at once, written into MESSAGES; then what
   * it is now, on the card: requested, the return address, received, exchanged, or answered in MESSAGES.
   */
  returns: Object.freeze({
    label: 'RETURNS AND EXCHANGES',
    lead: (until: string) => `You may return this piece or exchange its size until ${until}. It is sent back at your cost, with the carrier of your choice.`,
    requestReturn: 'REQUEST A RETURN',
    exchange: 'EXCHANGE THE SIZE',
    newSize: 'THE NEW SIZE',
    /** A size not in stock, greyed out, as a screen reader says it; a label that already carries its word as written. */
    sizeOut: (label: string) => `${/^(SIZE\b|ONE SIZE$)/i.test(label.trim()) ? label : `Size ${label}`}, not in stock`,
    onlyInStock: 'Only the sizes in stock can be chosen.',
    noneInStock: 'No other size is in stock just now.',
    reason: 'REASON',
    chooseReason: 'Choose a reason',
    reasons: Object.freeze({ SIZE: 'The size does not fit', NOT_AS_EXPECTED: 'The piece is not as I expected', DAMAGED: 'The piece arrived damaged', OTHER: 'Another reason' }),
    note: 'YOUR NOTE',
    noteHint: 'Please leave out passwords and card numbers.',
    decides: 'ORBES Client Services decides once the piece is received. Their answer will appear in your account, under MESSAGES.',
    send: 'SEND THE REQUEST',
    cancel: 'CANCEL',
    /** Said before the server says it. */
    reasonMissing: 'Choose a reason.',
    sizeMissing: 'Choose the new size.',
    /** A failure, followed by the server's message. */
    failed: 'Your request could not be sent just now.',
    /** The card, once asked. */
    returnRequested: (date: string) => `RETURN REQUESTED · ${date}`,
    exchangeRequested: (size: string, date: string) => `EXCHANGE REQUESTED · ${size} · ${date}`,
    sendBack: (reference: string) => `Send the piece back, at your cost and with the carrier of your choice, to the address below. Write ORDER ${reference} on the parcel.`,
    returnAddress: 'RETURN ADDRESS',
    noReturnAddress: 'ORBES Client Services will send you the return address in MESSAGES.',
    received: (date: string) => `PIECE RECEIVED · ${date}`,
    receivedText: 'ORBES has received your piece. ORBES Client Services will write to you in MESSAGES.',
    exchangedFor: (size: string, reference: string) => `EXCHANGED FOR ${size} · ORDER ${reference}`,
    answered: 'ORBES Client Services has written to you in MESSAGES.',
  }),
  /**
   * YOUR NEW CLAIM CODE (plan NEXT LOT §3.4): a new claim code ORBES Client Services made for the order's piece (its card
   * lost before registration), shown once on a press of SHOW THE CODE, then never again; REGISTER THIS PIECE once the
   * order is shipped, COPY CODE, and SAVE YOUR NEW CARD, the certificate card with its ORBES CODE and this claim code.
   */
  claim: Object.freeze({
    label: 'YOUR NEW CLAIM CODE',
    lead: 'ORBES Client Services has made a new claim code for this piece. The previous one no longer registers it. The new one is shown once only.',
    show: 'SHOW THE CODE',
    shownOnce: 'This claim code is shown once: keep it now. ORBES cannot show it again.',
    /** On an order not shipped yet (REGISTER THIS PIECE is not offered): how the piece registers once it has arrived. */
    arrived: 'Once your piece has arrived, register it by scanning the ORBES CODE on your new card, then entering this claim code.',
    register: 'REGISTER THIS PIECE',
    copy: 'COPY CODE',
    save: 'SAVE YOUR NEW CARD',
    /** On a computer, the card is open on its own screen: the phone scans it there (desktop, decision 8). */
    get card() {
      return forDevice(
        'Your new certificate card, with its ORBES CODE and this claim code (PDF). Print it, or open it on another screen to scan it.',
        'Your new certificate card, with its ORBES CODE and this claim code (PDF). Print it, or open it on this screen and scan it with your phone.',
      );
    },
    registered: 'Your piece is registered to your account.',
    showFailed: 'Your new claim code could not be shown just now.',
    unavailable: 'This claim code can no longer be shown. ORBES Client Services can assist you.',
    copied: 'The claim code has been copied.',
    copyFailed: 'The claim code could not be copied: select it, then copy it.',
    saveFailed: 'Your new card could not be saved just now.',
    /** Accessible names: the code, its characters read one by one; what SAVE YOUR NEW CARD and REGISTER THIS PIECE do. */
    codeLabel: (code: string) => `Your new claim code: ${code.split('-').map((group) => [...group].join(' ')).join(', ')}`,
    saveLabel: (model: string) => `Save the new certificate card of your ${model} (PDF)`,
    registerLabel: (model: string) => `Register your ${model} with this claim code`,
  }),
  /**
   * Its documents (plan LIVE RELEASE+, M6): the invoice and the credit note (PDFs, issued by CONGLOMERAT LLC), the
   * model's care guide (shown under them), and once the piece is registered to the account its ownership certificate;
   * plan ORBES CARE (answer 14): the ORBES CARE conditions (PDF), right after the invoice, for every order.
   */
  documents: Object.freeze({
    title: 'DOCUMENTS',
    /** Followed by the document's number, in the reading face. */
    invoice: 'INVOICE',
    creditNote: 'CREDIT NOTE',
    careGuide: 'CARE GUIDE',
    certificate: 'OWNERSHIP CERTIFICATE',
    careConditions: 'ORBES CARE CONDITIONS',
    /** Under a document that saves a file (C24). */
    pdf: 'PDF',
    /** Accessible names: what each link does. */
    invoiceLabel: (number: string) => `Download the invoice ${number} (PDF)`,
    creditNoteLabel: (number: string) => `Download the credit note ${number} (PDF)`,
    certificateLabel: (model: string) => `Download the ownership certificate of your ${model} (PDF)`,
    careConditionsLabel: (model: string) => `Download the ORBES CARE conditions of your ${model} (PDF)`,
    careGuideLabel: (model: string) => `The care guide of ${model}`,
    downloadFailed: 'This document could not be downloaded just now.',
    careFailed: 'The care guide could not be shown just now.',
  }),
});

/**
 * The catalogue add-ons' rows (plan MACRO M3 §4.4, D2), wherever they are chosen: the LIVE hold, a draw's PLACE HELD, a
 * salon request and ADD AN ADD-ON. Each row: its name, its line, its price per unit (`+ € 15`), its units from 0 to what
 * may be taken (at most 3 of each), between − and +. An add-on chosen that could not be added when the order was made
 * is said by its name and why (none left, no longer offered); the sale goes on without it.
 */
export const ADDONS = Object.freeze({
  /** Its price per unit, as it adds to the order. */
  price: (price: string) => `+ ${price}`,
  /** An add-on and its units: `POLISHING CLOTH × 2` (one: its name alone). */
  units: (name: string, units: number) => (units > 1 ? `${name} × ${units}` : name),
  /** Accessible names of the stepper's buttons and its figure. */
  fewer: (name: string) => `One fewer ${name}`,
  more: (name: string) => `One more ${name}`,
  count: (name: string, units: number) => `${name}, ${units} chosen`,
  /** Under the rows, while one of them is at what may be taken. */
  limit: 'At most 3 of each, while available.',
  /** `THE POLISHING CLOTH COULD NOT BE ADDED: NONE LEFT.` (a name that begins with THE keeps it once). */
  leftOut: (name: string, reason: 'NONE_LEFT' | 'NOT_OFFERED') =>
    `${/^THE\s/i.test(name.trim()) ? name.trim() : `THE ${name.trim()}`} COULD NOT BE ADDED: ${reason === 'NONE_LEFT' ? 'NONE LEFT' : 'NO LONGER OFFERED'}.`.toUpperCase(),
  /** A choice that could not be saved, followed by the server's message. */
  failed: 'Your add-ons could not be saved just now.',
});

/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11): for 7 days from the release's end, on its end page
 * to those who took part without a piece, in MY PIECES to those who said I'LL BE THERE and did not come. One tap,
 * changeable until it closes; the question and its answers are the release's (the console's words, or the default
 * WHAT WOULD YOU HAVE WANTED? · ANOTHER SIZE · ANOTHER FINISH · ANOTHER PRICE BAND).
 */
export const QUESTION = Object.freeze({
  label: 'ONE QUESTION',
  /** Before an answer, and after it: until when it may change (the date on this phone's calendar). On a computer, no
   *  tap: the same sentence in words for any device (desktop, decision 8). */
  ask: (until: string) => forDevice(`One tap. You may change your answer until ${until}.`, `One choice. You may change your answer until ${until}.`),
  answered: (until: string) => `Thank you: your answer is recorded. You may change it until ${until}.`,
  saving: 'Recording your answer…',
  failed: 'Your answer could not be recorded just now.',
  /** MY PIECES: the section, its lead, and each release by its name (else LIVE RELEASE) and opening date. */
  piecesTitle: 'AFTER THE RELEASES',
  piecesLead: 'You said you would be there. One question about each release, for a week after it.',
  release: (name: string, date: string) => [name, date].filter(Boolean).join(' · '),
});

/**
 * The ORBES CARE tab of a piece in MY PIECES (plan ORBES CARE §2(a), answers 1 and 6; P-M02 before it): everything after
 * the sale under one name, in this order: its WARRANTY, its WARRANTY CLAIM when one is under way, PRIVATE CARE, CARING
 * FOR THIS PIECE (the care of its model, the result's care text), then how to reach ORBES Client Services. The paid
 * ORBES Care subscription is gone (answer 1). On a result, its ORBES CARE tab holds the warranty, the care and the
 * contact (step 2.3).
 */
export const ORBES_CARE = Object.freeze({
  /** The label of the model's care instructions. */
  careLabel: 'CARING FOR THIS PIECE',
  /**
   * The WARRANTY of a piece (plan ORBES CARE §2(a) item 1, answers 10 and 12), on a result and in MY PIECES: its rows and
   * the one sentence under them, which says what that warranty covers. `lifetime` is the piece's own warranty kind, as
   * its model gives it: a lifetime warranty has no end date, and never reads EXPIRED.
   */
  warranty: Object.freeze({
    /** The section's label in the ORBES CARE tab. */
    label: 'WARRANTY',
    rows: Object.freeze({ status: 'STATUS', from: 'FROM', until: 'UNTIL' }),
    status: Object.freeze({ NOT_STARTED: 'NOT YET STARTED', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', VOID: 'NO LONGER VALID' }),
    /** STATUS of a lifetime warranty once started. */
    activeLifetime: 'ACTIVE · LIFETIME',
    notStarted: 'The ORBES warranty begins on the date of purchase from an ORBES boutique or authorised retailer.',
    notStartedLifetime: 'The ORBES lifetime warranty begins on the date of purchase from an ORBES boutique or authorised retailer.',
    lifetime: 'This piece is covered for life by the ORBES warranty: if it tarnishes, fades or breaks by accident, ORBES replaces it.',
    /** The 2-year warranty: manufacturing defects only, repaired or replaced, until its end date (written in full). */
    active: (until: string) =>
      until
        ? `This piece is covered by the ORBES warranty against manufacturing defects until ${until}: ORBES repairs or replaces it.`
        : 'This piece is covered by the ORBES warranty against manufacturing defects: ORBES repairs or replaces it.',
    expired: 'The warranty period of this piece has ended. ORBES Client Services remains at your disposal for care and repair.',
    void: 'The ORBES warranty no longer applies to this piece. Please contact ORBES Client Services.',
    /**
     * A piece its warranty claim closed (CARE-C2, the owner's answer of 2026-10-16): one calm line in place of NO LONGER
     * VALID and its contact sentence, in MY PIECES, for as long as the piece is listed. The claim's own block keeps its
     * steps (the new piece prepared, then on its way).
     */
    closed: Object.freeze({
      REPLACEMENT: Object.freeze({ head: 'REPLACED UNDER ORBES CARE', text: 'Your new piece takes its place.' }),
      VALUE_CREDIT: Object.freeze({ head: 'REPLACED UNDER ORBES CARE', text: 'A credit of its value takes its place.' }),
      REFUND: Object.freeze({ head: 'REFUNDED UNDER THE LEGAL GUARANTEE', text: 'Its price is paid back to you by its seller.' }),
    }),
    /** No warranty the app can read: on a result and in MY PIECES alike. */
    none: 'Warranty details for this piece are available from ORBES Client Services.',
  }),
  /** The ORBES CARE tab's last words, above WRITE TO ORBES CLIENT SERVICES in MY PIECES (and on a result). */
  contact: 'A question about this piece, its warranty or its care: ORBES Client Services answers in MESSAGES.',
});

/**
 * A WARRANTY CLAIM in a piece's ORBES CARE tab (plan ORBES CARE §2(a) item 2, answer 9): its state as ORBES Client
 * Services take it, from the prepaid label to the outcome. Nothing here starts or feeds a claim: a collector writes to
 * ORBES Client Services in MESSAGES, who open it. The words of the outcome follow the claim's warranty (answer 10): the
 * lifetime warranty, the 2-year warranty, or the legal guarantee.
 */
const CLAIM_CREDIT = (amount: string, until: string) =>
  amount && until ? `a credit of ${amount} toward a new piece is in your account until ${until}` : 'a credit toward a new piece is in your account';

export const WARRANTY_CLAIM = Object.freeze({
  /** The block's label, and its accessible name. */
  label: 'WARRANTY CLAIM',
  open: 'ORBES Client Services is preparing your prepaid label. It will appear here.',
  labelTitle: 'YOUR PREPAID LABEL',
  labelText: 'Print it, pack the piece in its box and hand it to the carrier. ORBES answers once it has received the piece.',
  download: 'DOWNLOAD LABEL',
  carrier: 'CARRIER',
  tracking: 'TRACKING NUMBER',
  track: 'TRACK THE SHIPMENT',
  received: 'WITH ORBES',
  receivedText: 'ORBES has received your piece and is examining it.',
  /** The same piece, new: decided, then shipped. */
  replacement: 'Your new piece is being prepared. Its shipment will appear here.',
  replaced: 'REPLACED',
  replacedText: 'Your new piece is on its way. Register it with the certificate card in its box.',
  /** The lifetime warranty's credit of the piece's value (the model no longer made), and its credit after the free replacement. */
  valueCredit: (amount: string, until: string) => `This model is no longer made: ${CLAIM_CREDIT(amount, until)}.`,
  partCredit: (amount: string, until: string) =>
    amount && until ? `A credit of ${amount} toward a new piece is in your account until ${until}.` : 'A credit toward a new piece is in your account.',
  /** The piece goes back to its owner: decided, then shipped. */
  returned: 'Your piece is returned to you.',
  onItsWay: 'Your piece is on its way back.',
  repaired: Object.freeze({
    TWO_YEARS: 'Your piece has been repaired under the ORBES warranty.',
    LEGAL: 'Your piece has been repaired under the legal guarantee.',
  }),
  /** After a repair, once shipped. */
  repairedBack: 'It is on its way back.',
  priceReduction: (amount: string) => `Under the legal guarantee, the price of your piece is reduced by ${amount}: the seller pays it back to you.`,
  refund: (amount: string) => `Under the legal guarantee, your piece is refunded, ${amount}: the seller pays it back to you (for an ORBES order, with its credit note in ORDERS).`,
  refused: (reason: string) => `Not covered by the warranty: ${reason}.`,
  refusedLegal: (reason: string) => `Not covered by the legal guarantee: ${reason}.`,
  /** Why a claim is refused, each warranty with its own list (the server's). */
  reasons: Object.freeze({
    LOST: 'the piece is lost',
    THEFT_REPORTED: 'its theft is reported',
    SCRATCHED: 'it is scratched',
    DAMAGED_ON_PURPOSE: 'it was damaged on purpose',
    DAMAGED_BY_SOMEONE_ELSE: 'it was damaged by someone else',
    ALTERED_OUTSIDE_ORBES: 'it was altered or repaired outside ORBES',
    WARRANTY_ENDED: 'its warranty has ended',
    WARRANTY_VOID: 'its warranty no longer applies',
  }),
  /** NO_FAULT_FOUND, in the words of the claim's warranty. */
  noFault: Object.freeze({
    LIFETIME: 'it shows no tarnish, fading or accidental break',
    TWO_YEARS: 'it shows no manufacturing defect',
    LEGAL: 'it shows no lack of conformity',
  }),
  cancelled: 'This claim was closed.',
});

/**
 * PRIVATE CARE (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T6, named PRIVATE CARE by plan ORBES CARE, answer 5; its
 * internal name YEARLY_CARE is kept): the inspection, cleaning and polishing of a piece by ORBES, free, once a year, that
 * the tiers from PLATINE include, asked for from the piece with the address it returns to, then each step. Shown when the
 * account's tier has a care allowance (or a request of the piece is still open); otherwise the tier it opens from, when
 * THE PROGRAM gives one (`opens`). The prepaid label is shown here only.
 */
const CARE_PIECES = (allowance: number | 'ALL') => (allowance === 'ALL' ? 'every piece' : allowance === 1 ? '1 piece' : `${allowance} pieces`);
/** What a tier's allowance gives, as THE CLUB's line says it: every piece once a year each, or a number of pieces a year. */
const CARE_OPENS = (allowance: number | 'ALL') =>
  allowance === 'ALL' ? 'the inspection, cleaning and polishing of every piece by ORBES, free, once a year each' : `the inspection, cleaning and polishing of ${CARE_PIECES(allowance)} a year by ORBES, free`;

export const YEARLY_CARE = Object.freeze({
  /** The block's label, and its accessible name. */
  label: 'PRIVATE CARE',
  available: (tier: string, allowance: number | 'ALL', year: number) =>
    `Your ${tier} tier includes PRIVATE CARE for ${allowance === 'ALL' ? 'every piece, once a year each' : `${CARE_PIECES(allowance)} in ${year}`}: inspection, cleaning and polishing by ORBES, free of charge. ORBES Client Services sends you a prepaid label for this piece, and returns it to you at no cost.`,
  /** A tier that includes none: the tier PRIVATE CARE opens from in THE PROGRAM, and what it gives. */
  opens: (tier: string, allowance: number | 'ALL') => `PRIVATE CARE opens from ${tier}: ${CARE_OPENS(allowance)}.`,
  request: 'REQUEST PRIVATE CARE',
  /** The request's own form, in place. */
  confirm: (year: number) => `Request PRIVATE CARE for this piece for ${year}?`,
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
  received: 'WITH ORBES',
  receivedText: 'ORBES has received your piece.',
  returning: 'ON ITS WAY BACK',
  track: 'TRACK THE SHIPMENT',
  done: (year: number) => `Its PRIVATE CARE for ${year} is complete. It is recorded in SERVICE HISTORY.`,
  cancelled: 'This request was cancelled.',
  used: (year: number) => `Your PRIVATE CARE for ${year} has been used for another piece. It renews on 1 January.`,
  pieceDone: (year: number) => `This piece has had its PRIVATE CARE for ${year}.`,
  unavailable: 'PRIVATE CARE cannot be requested for this piece just now.',
  /**
   * CREATE TRANSFER CODE refused while the piece's care is REQUESTED or LABEL_SENT (409 CARE_OPEN, API §11.2): the
   * server's words (services/ownership.ts), PRIVATE CARE since plan ORBES CARE, step 1.4.
   */
  transferOpen: "This piece's PRIVATE CARE is under way: cancel the request or wait until it returns.",
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
/** The orders a credit is taken off, as THE PROGRAM's credit line names them (`a draw, a LIVE RELEASE or THE PRIVATE SALON`). */
const CREDIT_WORDS = Object.freeze({ DRAW: 'a draw', LIVE: 'a LIVE RELEASE', SALON: 'THE PRIVATE SALON' });
const CREDIT_ON = (channels: readonly ('DRAW' | 'LIVE' | 'SALON')[]) => {
  // Anything but a list (never sent so): THE PROGRAM's default, every channel.
  const list: readonly ('DRAW' | 'LIVE' | 'SALON')[] = Array.isArray(channels) ? channels : ['DRAW', 'LIVE', 'SALON'];
  const words = list.map((c) => CREDIT_WORDS[c]).filter((w) => w !== undefined);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
};

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
  /** The birthday credit's row (plan CUSTOMER INTELLIGENCE §3.5 SB.4.5), first under IN USE, with `creditValue`; for an account without a tier too. */
  birthdayCredit: 'BIRTHDAY CREDIT',
  /**
   * A warranty credit (plan ORBES CARE §2(a), answer 9): a credit of the lifetime warranty, after BIRTHDAY CREDIT, with
   * `creditValue`; for an account without a tier too.
   */
  warrantyCredit: 'WARRANTY CREDIT',
  credit: 'CREDIT',
  creditValue: (amount: string, date: string) => `${amount} · UNTIL ${date}`,
  /**
   * Under the rows, when a credit exists: the orders THE PROGRAM's "Credit usable on" names, in its order and in the
   * words of the program's credit line (services/club-program.ts CHANNEL_WORDS, `a, b or c`).
   */
  creditNote: (channels: readonly ('DRAW' | 'LIVE' | 'SALON')[]) => `ORBES Client Services takes it off the invoice of a piece from ${CREDIT_ON(channels)}.`,
  care: 'PRIVATE CARE',
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

/** CARING FOR THIS PIECE of a piece whose model has no care instructions (shared with the console's care preview). */
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
 * The model's variant (plan NEXT LOT §3.1): its label on its own line under the model's name (the label itself, no
 * word added), and the result's PRODUCT tab has its row, under MODEL. Never the piece's size, which is SIZE.
 */
export const MODEL_VARIANT = Object.freeze({
  row: 'VARIANT',
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
    /** AC-01: the size picker of a model of two sizes or more, above the note; the size asked under REQUESTED. */
    size: 'YOUR SIZE',
    notSure: 'NOT SURE YET',
    sizeHint: 'ORBES Client Services confirms it with you.',
    requestedSize: (size: string) => `SIZE ${size}`,
    /**
     * Plan MACRO M3 §4.4 (D2): the catalogue add-ons offered with the request (the model priced in a currency), sent with
     * it and added when ORBES Client Services accepts it, each while available; under REQUESTED, those chosen.
     */
    addons: Object.freeze({
      title: 'ADD TO YOUR ORDER',
      note: 'Added when ORBES Client Services accepts your request, while available.',
      /** Under REQUESTED: the add-ons sent with it. */
      chosen: 'YOUR ADD-ONS',
    }),
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
  /**
   * Plan NEXT-NINE, CO-01: THE RELEASES OF THIS MODEL, after CARE: each past release of the model and its variants, the
   * newest first, its opening date as the title (5 OCT 2026), its kind and variant as its line (LIVE RELEASE · IN STEEL;
   * DRAW alone for a model alone), its page; the six newest, then SHOW ALL 9 RELEASES. Never a quantity nor an end figure.
   */
  releases: Object.freeze({
    title: 'THE RELEASES OF THIS MODEL',
    kind: Object.freeze({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' }),
    variant: (label: string) => `IN ${label.toUpperCase()}`,
    line: (kind: string, variant: string | null) => (variant ? `${kind} · ${variant}` : kind),
    /** The row's accessible name: « DRAW, 14 SEP 2026, in gold: see the release ». */
    label: (kind: string, date: string, variant: string | null) => `${kind}, ${date}${variant ? `, in ${variant.toLowerCase()}` : ''}: see the release`,
    more: (n: number) => `SHOW ALL ${n} RELEASES`,
  }),
  /**
   * Plan NEXT-NINE, BP-34: PAIRS WELL WITH, the very last section of a model's sheet: one row of cards, each a model's
   * photograph, its name (MONOLITHE IN BLUE for a picked variant) and its type (BRACELET · THE PRIVATE SALON for a model of
   * the salon shown to an owner); never a price.
   */
  pairs: Object.freeze({
    title: 'PAIRS WELL WITH',
    withVariant: (name: string, variant: string | null) => (variant ? `${name} IN ${variant.toUpperCase()}` : name),
    line: (type: string, reserved: boolean) => (reserved ? `${type} · THE PRIVATE SALON` : type),
    /** A card's accessible name: « MONOLITHE IN BLUE, bracelet: see the model ». */
    label: (title: string, type: string) => `${title}, ${type.toLowerCase()}: see the model`,
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
 * ORBES Client Services concludes each sale (an email says a place is drawn only once DRAW_SELECTED is switched on,
 * lot M1): the account's page says it. Reached from the landing
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
  /** A time shown in UTC, then on the phone's own clock (on a computer's, desktop decision 8). */
  utc: (time: string) => `${time} UTC`,
  onThisPhone: (time: string, offset: string) => `${time} on this phone (${offset})`,
  onThisComputer: (time: string, offset: string) => `${time} on this computer (${offset})`,
  /** The line of a release in the list: its pieces and the time that matters now. */
  opensLine: (pieces: string, time: string) => `${pieces} · ENTRIES OPEN ${time} UTC`,
  closesLine: (pieces: string, time: string) => `${pieces} · ENTRIES CLOSE ${time} UTC`,
  section: Object.freeze({ release: 'THE RELEASE', entry: 'YOUR ENTRY', draw: 'THE DRAW', entries: 'THE ENTRIES' }),
  rows: Object.freeze({ model: 'MODEL', price: 'PRICE', pieces: 'PIECES', sizes: 'SIZES', early: 'EARLY ACCESS', opens: 'ENTRIES OPEN', closes: 'ENTRIES CLOSE', held: 'PLACE HELD', reserved: 'RESERVED DIRECTLY', drawn: 'DRAWN' }),
  /**
   * Plan NEXT LOT §3.6.F, a draw with sizes: THE RELEASE's SIZES row, one line per size (`SIZE 16 · 3 PIECES`, then the
   * places reserved directly in it and FULL once every piece of it is held before the draw); YOUR SIZE over the picker;
   * an entry's label with its size (`ENTERED · SIZE 17`); a size whose pieces are all reserved, said to assistive
   * technologies during the early access and under the picker while entries are open.
   */
  sizes: Object.freeze({
    line: (size: string, pieces: number, reserved: number, full: boolean) =>
      [`${drawSizeName(size)} · ${pieces === 1 ? '1 PIECE' : `${pieces} PIECES`}`, reserved > 0 ? `${reserved} RESERVED DIRECTLY` : null, full ? 'FULL' : null].filter((x) => x !== null).join(' · '),
    yourSize: 'YOUR SIZE',
    label: (status: string, size: string) => `${status} · ${drawSizeName(size)}`,
    full: (size: string) => (isOneSize(size) ? 'One size, every piece reserved' : `Size ${bareSize(size)}, every piece reserved`),
    openFull: (size: string) => `Every piece ${drawInSize(size)} has been reserved. You may still enter: the draw ranks a waiting list in each size.`,
  }),
  /** P-X02: the places reserved directly, of the release's pieces (`1 OF 3 PIECES`). */
  reservedOf: (n: number, quantity: number) => `${n} OF ${quantity === 1 ? '1 PIECE' : `${quantity} PIECES`}`,
  photosLabel: (title: string) => `The model of ${title}, photographed by ORBES`,
  /** Signed out, on a release's page: any ORBES account may enter, the sign-in and CREATE ACCOUNT follow. */
  signIn: 'Enter the draw with your ORBES account: sign in, or create one. Any account may enter, one entry per person.',
  /**
   * Plan MACRO M1 §3.3 (F4), a draw opened to a segment: its rule in THE RELEASE, as a LIVE RELEASE's page says it
   * (LIVE.forWhom('selected collectors'), the segment never named); the sign-in's lead, signed out; signed in and not
   * among them, YOUR ENTRY's refusal in place of ENTER THE DRAW, as a LIVE RELEASE's (the server's DRAW_NOT_ELIGIBLE,
   * then LIVE.edge.notEligible).
   */
  selected: 'FOR SELECTED COLLECTORS',
  signInSelected: 'Enter the draw with your ORBES account: sign in, or create one. This release is for selected collectors, one entry per person.',
  notEligible: 'This release is for selected collectors.',
  notEligibleNote: 'Your ORBES account does not meet the rule of this release.',
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
    /** Plan NEXT LOT §3.6.B: the delivery address is the collector's own, entered in YOUR ORDERS. */
    confirmed: 'Your purchase is concluded with ORBES Client Services. Add your delivery address in YOUR ORDERS.',
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
    /** Plan NEXT LOT §3.6.F, an entry in a draw with sizes: its size said. */
    enteredIn: (size: string) => `You are entered in the draw, ${drawInSize(size)}. You may change your size until entries close, and withdraw until the draw.`,
    selectedIn: (size: string, until: string) => `Your place ${drawInSize(size)} is held until ${until} — ORBES Client Services will contact you.`,
    waitlistedIn: (size: string, rank: number) => `You are on the waiting list of ${drawSizeWords(size)}, rank ${rank}. ORBES Client Services will contact you if a place opens.`,
    reservedIn: (size: string, until: string) => `You reserved a place directly ${drawInSize(size)}. It is held until ${until} — ORBES Client Services will contact you.`,
  }),
  /**
   * Plan MACRO M3 §4.4 (D2), ADD TO YOUR ORDER on a place held of a draw with a price: the catalogue add-ons, each with
   * its units, saved at once and added when ORBES Client Services confirms the order (each while available).
   */
  addons: Object.freeze({
    title: 'ADD TO YOUR ORDER',
    note: 'Your add-ons will be added when ORBES Client Services confirms your order.',
  }),
  /** The status of an entry, as MY PIECES and a release's page name it. */
  statusLabel: Object.freeze({ ENTERED: 'ENTERED', SELECTED: 'PLACE HELD', WAITLISTED: 'WAITING LIST', CONFIRMED: 'CONCLUDED', LAPSED: 'LAPSED', WITHDRAWN: 'WITHDRAWN' }),
  /** P-X02: a place held by a direct reservation (SELECTED, not drawn). */
  reservedLabel: 'PLACE RESERVED',
  /** A selection obliges no one (no word of emails: DRAW_SELECTED and DRAW_OFFERED may send one, lot M1 review). */
  noObligation: 'A place drawn obliges you to nothing: ORBES Client Services concludes each sale with you. Your entries are followed in MY PIECES.',
  /** The rule of the draw, exactly as the server applies it (services/drops.ts drawOrder). */
  rule:
    'The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, then the accounts that hold no piece; then by seniority, the full years since the account’s first piece, the most first; then by the SHA-256 of the 32 bytes of the seed followed by the entry’s identifier in lower-case letters, in increasing hexadecimal order. The tier and the seniority are those of the moment of the draw. The first ranks, as many as there are pieces left after the direct reservations of PLATINE and PALLADIUM owners, are selected; the next are on the waiting list, in that order. Places guaranteed by ORBES are selected first, for the pieces they cover, and listed apart without a rank.',
  /** Plan NEXT LOT §3.6.F: the rule of a draw with sizes, exactly as the server applies it (services/drops.ts draw). */
  ruleSizes:
    'Each entry is in the size it chose. The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, then the accounts that hold no piece; then by seniority, the full years since the account’s first piece, the most first; then by the SHA-256 of the 32 bytes of the seed followed by the entry’s identifier in lower-case letters, in increasing hexadecimal order. The tier and the seniority are those of the moment of the draw. In that order, an entry is selected while its size has a piece left after the direct reservations of PLATINE and PALLADIUM owners; the others form the waiting list of their size, in that order. Places guaranteed by ORBES are selected first, in their size, for the pieces they cover, and listed apart without a rank.',
  commitment: 'The seed was drawn when the release was created, and its fingerprint published with it. Once the draw has taken place, the seed is published here: its SHA-256 is that fingerprint, and anyone can rank the entries below again.',
  /** Labels in the display face, so no figure: the commitment's sentence names SHA-256. */
  seedHash: 'SEED FINGERPRINT',
  seed: 'SEED',
  /** The check made on this phone (this computer, desktop decision 8), once the seed is published. */
  get seedChecked() {
    return forDevice(
      'Checked on this phone: the SHA-256 of the seed is the fingerprint published with the release.',
      'Checked on this computer: the SHA-256 of the seed is the fingerprint published with the release.',
    );
  },
  get seedMismatch() {
    return forDevice(
      'Checked on this phone: the SHA-256 of the seed is not the fingerprint published with the release. ORBES Client Services can assist you.',
      'Checked on this computer: the SHA-256 of the seed is not the fingerprint published with the release. ORBES Client Services can assist you.',
    );
  },
  /** Over the draw's list: what it shows, never how many (no end figure, plan LIVE RELEASE+ choice 5). */
  entriesLead: 'Every entry the draw ranked, in its order: its rank, its tier and its seniority at the draw, then its identifier.',
  /** One entry of the draw's list: its rank, its tier and its seniority. */
  entryLine: (rank: number, tier: string, years: number) => `${rank} · ${tier} · ${years === 1 ? '1 YEAR' : `${years} YEARS`}`,
  /** Plan NEXT LOT §3.6.F: a list's line with the size the entry was drawn in, `12 · PLATINE · 2 YEARS · SIZE 17`. */
  entryLineIn: (line: string, size: string) => `${line} · ${drawSizeName(size)}`,
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
 * THE HOUSE'S GUARANTEE (plan NEXT-NINE, §3.3 IN-01): a place at a coming release, granted by ORBES Client Services to one
 * collector, shown only when Client Services chose to show it (one not shown leaves no mark anywhere in the app). It
 * names a place in a release and is never said of authenticity: never on a scan result, a certificate or a piece's page.
 * No NOW line and no notification.
 */
export const GUARANTEE = Object.freeze({
  /** The account sheet's block, the draw page's box, the label in MY PIECES. */
  title: 'THE HOUSE’S GUARANTEE',
  /** The account sheet's sentence, by what it covers. */
  model: (name: string) => `A guaranteed place at the next release of ${name}.`,
  collection: (name: string) => `A guaranteed place at the next release of the ${name} collection.`,
  release: (title: string) => `A guaranteed place at ${title}.`,
  /** A chosen release whose name may not be said yet. */
  comingRelease: 'A guaranteed place at a coming release.',
  rows: Object.freeze({ release: 'RELEASE', pieces: 'PIECES', validUntil: 'VALID UNTIL' }),
  /** The RELEASE row before a LIVE RELEASE's name stage. */
  unnamed: 'TO BE REVEALED',
  note: 'Granted by ORBES. Personal and used once: it cannot be transferred.',
  /** `1 piece`, `2 pieces`: inside a sentence. */
  pieces: (n: number) => (n === 1 ? '1 piece' : `${n} pieces`),
  /** A draw's page, YOUR ENTRY. */
  box: Object.freeze({
    upcoming: (pieces: string) => `ORBES guarantees you a place in this release. Enter the draw once entries open: you are selected first, for ${pieces}.`,
    open: (pieces: string) => `ORBES guarantees you a place in this release. Enter the draw: you are selected first, for ${pieces}.`,
    entered: (pieces: string) => `You are entered with the house’s guarantee: you are selected first at the draw, for ${pieces}.`,
    reservation: 'Your reservation uses the house’s guarantee.',
  }),
  /** THE ENTRIES, above the ranked list, once drawn. */
  list: Object.freeze({
    title: 'GUARANTEED BY THE HOUSE',
    lead: 'Set aside before the draw: selected first, without a rank, and left out of the ranking below.',
    line: (pieces: number) => `GUARANTEED · ${pieces === 1 ? '1 PIECE' : `${pieces} PIECES`}`,
  }),
  /** A LIVE RELEASE's page: announced, under I'LL BE THERE; in the room, under the size chooser. */
  liveAnnounced: 'ORBES guarantees you a place in this release. Be in the room at the opening: you are first in line in your size.',
  liveRoom: (pieces: number) => `You are first in line in your size, for up to ${pieces === 1 ? '1 piece' : `${pieces} pieces`}.`,
  /** The server's refusal of a size its guarantee cannot be given in (services/live.ts, LIVE_GUARANTEE_SIZE_FULL). */
  sizeFull: 'Your guaranteed place cannot be given in this size: choose another size.',
});

/**
 * HOW RELEASES WORK (plan NEXT-NINE, §3.5 FT-01; /verify/releases/how): one page that explains every release, its three
 * sections in this order. Every figure is the server's (GET /api/v1/releases/rules: the tiers, the usual early access,
 * the place held), passed in already said (`4 hours`, `90 minutes`, `48 hours`), never typed here. The order of a draw
 * names the tier, the seniority and the seed in RELEASES.rule's order; the LIVE order is the tier then chance (LIVE.rule).
 * No contact, no figure the server did not send, and no line on who confirms a sale.
 */
export const HOW = Object.freeze({
  title: 'HOW RELEASES WORK',
  /** The document's title while the page is shown. */
  documentTitle: 'HOW RELEASES WORK · ORBES',
  /** The text link to the page: under THE RELEASES' lead, at the foot of a release's pages, in the room's foot. */
  link: 'HOW RELEASES WORK',
  lead: 'Every ORBES release follows the rules below, as the server applies them. Each release’s page gives its own times.',
  /** A window of whole hours, else in minutes (`90 minutes`). */
  hours: (n: number) => plural(n, 'hour', 'hours'),
  minutes: (n: number) => plural(n, 'minute', 'minutes'),
  ways: Object.freeze({
    title: 'THE WAYS TO TAKE PART',
    draw: Object.freeze({
      term: 'DRAW',
      text: (held: string) =>
        `Any ORBES account may enter a draw while its entries are open, one entry per person, at no charge. After the close, the draw ranks the entries: the first ranks are selected, the next form the waiting list. A place drawn is held for you ${held} unless the release’s page says otherwise, and obliges you to nothing: ORBES Client Services concludes each sale with you.`,
    }),
    early: Object.freeze({
      term: 'EARLY ACCESS',
      /** PALLADIUM's usual window, then PLATINE's (null: PLATINE has none by default). */
      text: (palladium: string, platine: string | null) =>
        `Before a draw opens to everyone, owners reserve a place directly, first come, first served, within the pieces of the release: ${platine ? `PALLADIUM owners from ${palladium} before the opening, PLATINE owners from ${platine} before` : `PALLADIUM owners from ${palladium} before the opening`}. These are the usual times; each release’s page gives its own. The pieces left then go to the draw.`,
      /** The same window for both tiers. */
      same: (both: string) =>
        `Before a draw opens to everyone, owners reserve a place directly, first come, first served, within the pieces of the release: PALLADIUM and PLATINE owners from ${both} before the opening. These are the usual times; each release’s page gives its own. The pieces left then go to the draw.`,
      /** No early access by default. */
      none: 'A release may open to PALLADIUM and PLATINE owners before everyone: they then reserve a place directly, first come, first served, within the pieces of the release, and its page gives the times. The pieces left then go to the draw.',
    }),
    live: Object.freeze({
      term: 'LIVE RELEASE',
      text: 'A release held live, at its announced time. The room opens shortly before the opening; at the opening, the places of the collectors present are drawn and the line moves. When your turn comes, you press and hold the seal to secure your piece, then PAY to confirm it. Each release says who may enter and how many pieces each collector may take.',
    }),
    salon: Object.freeze({
      term: 'THE PRIVATE SALON',
      text: 'Reserved models shown to the owners of a piece, each from a tier, with its price. You request a piece from its page; ORBES Client Services contacts you to conclude the sale. Nothing is paid in the app.',
    }),
  }),
  order: Object.freeze({
    title: 'HOW THE ORDER IS SET',
    tiers: Object.freeze({
      term: 'THE TIERS',
      text: 'Your tier is read from the pieces registered to your account now. A piece revoked or retired by ORBES counts for no tier.',
      /** A tier and the pieces it starts from: `PLATINE · FROM 5 PIECES`. */
      row: (name: string, pieces: number) => `${name} · FROM ${plural(pieces, 'PIECE', 'PIECES')}`,
    }),
    draw: Object.freeze({
      term: 'IN A DRAW',
      text: 'Places guaranteed by ORBES are selected first, for the pieces they cover, and listed apart without a rank. The other entries are ranked by tier, the highest first, then the accounts that hold no piece; then by seniority, the full years since your first piece, the most first; then by a seed drawn when the release was created. In a release with sizes, each size is filled in that order. The seed’s fingerprint is published with the release and the seed itself after the draw, so anyone can rank the entries again. The tier and the seniority are those of the moment of the draw.',
    }),
    live: Object.freeze({
      term: 'IN A LIVE RELEASE',
      text: 'Places guaranteed by ORBES come first in their size. At the opening, the places of the collectors present in the room are drawn by tier, the highest first, then at random within each tier. A release may instead draw every place at random; its page says so. Those who arrive after the opening join the line behind, in order of arrival.',
    }),
  }),
  never: Object.freeze({
    title: 'WHAT THE HOUSE NEVER DOES',
    paid: Object.freeze({ term: 'NO PAID PRIORITY', text: 'No place, rank or early access is ever sold. A tier comes only from the pieces you hold.' }),
    auctions: Object.freeze({ term: 'NO AUCTIONS', text: 'A piece is never sold to the highest bidder. Its price is set by ORBES, the same for every collector of the release.' }),
    quantity: Object.freeze({
      term: 'A FIXED QUANTITY',
      text: 'Every release announces its number of pieces before it opens, and a draw never changes it once published. During a LIVE RELEASE, if ORBES adds pieces or opens an after-room for those still in line, its page says so at once.',
    }),
    account: Object.freeze({ term: 'ONE COLLECTOR, ONE ACCOUNT', text: 'Each person takes part with one ORBES account. ORBES Client Services may set aside an entry made with a second one.' }),
    returned: Object.freeze({
      term: 'A RETURNED PIECE',
      text: 'A piece that returns during a release goes to the next collector: in a LIVE RELEASE, to the next in line; in a draw, ORBES Client Services offers it to the waiting list, in its order. It is never set aside for anyone.',
    }),
  }),
  loading: 'ONE MOMENT…',
  failed: 'How releases work could not be shown just now.',
  retry: 'TRY AGAIN',
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
 * YOUR SIZES (plan NEXT-NINE, AC-01): a row of the account sheet, second after MESSAGES, its line the sizes saved
 * (`RING 52 · WRIST 16.5 CM`, or NOT SET), and its view in the sheet: four sizes, each a field of its own, SAVE and
 * CANCEL. A size saved preselects a model's size in I'LL BE THERE, the LIVE ready check and a salon request, always
 * confirmed by the collector. The hints only name the unit: no guide to measuring.
 */
export const ACCOUNT_SIZES = Object.freeze({
  row: 'YOUR SIZES',
  notSet: 'NOT SET',
  title: 'YOUR SIZES',
  lead: 'Your sizes preselect the size of a release or a request, for a model of that kind. You confirm it each time.',
  ring: 'RING SIZE',
  ringHint: 'French size.',
  bracelet: 'BRACELET SIZE',
  wrist: 'WRIST, FOR WATCHES',
  necklace: 'NECKLACE LENGTH',
  cmHint: 'In centimetres.',
  save: 'SAVE',
  cancel: 'CANCEL',
  /** Said in the account view once saved. */
  saved: 'Your sizes are saved.',
  /** A failure, followed by the server's message. */
  failed: 'Your sizes could not be saved just now.',
  /** The view while the sizes are read; it shows no field until they are. */
  loading: 'ONE MOMENT…',
  /** The sizes could not be read: followed by the server's message, then TRY AGAIN; no field and no SAVE. */
  unreadable: 'Your sizes could not be shown just now.',
  retry: 'TRY AGAIN',
  /** Each size's word in the row's line: `RING 52`, `WRIST 16.5 CM`. */
  short: Object.freeze({ RING: 'RING', BRACELET: 'BRACELET', WRIST: 'WRIST', NECKLACE: 'NECKLACE' }),
});

/**
 * YOUR ADDRESSES (plan NEXT LOT §3.6.B): a row of the account sheet, after YOUR SIZES, its line how many are saved
 * (`2 SAVED`, or NOT SET), and its view in the sheet: each address with DEFAULT on the default one, EDIT · MAKE DEFAULT ·
 * REMOVE (a second tap removes it), ADD AN ADDRESS with MY DEFAULT ADDRESS, up to five. The default one is put on each
 * new order; an order keeps its own copy. Its states as YOUR SIZES has them.
 */
export const ACCOUNT_ADDRESSES = Object.freeze({
  row: 'YOUR ADDRESSES',
  count: (n: number) => `${n} SAVED`,
  notSet: 'NOT SET',
  title: 'YOUR ADDRESSES',
  lead: 'Your default address is put on each new order. You may change an order’s address until its packing begins.',
  isDefault: 'DEFAULT',
  edit: 'EDIT',
  makeDefault: 'MAKE DEFAULT',
  remove: 'REMOVE',
  /** REMOVE asks for a second tap (a second click on a computer, desktop decision 8), as RELEASE MY PLACE does. */
  get removeConfirm() {
    return forDevice('TAP AGAIN TO REMOVE', 'CLICK AGAIN TO REMOVE');
  },
  add: 'ADD AN ADDRESS',
  defaultSwitch: 'MY DEFAULT ADDRESS',
  save: 'SAVE',
  cancel: 'CANCEL',
  empty: 'No address is saved. The first one you add becomes your default.',
  limit: 'You may keep up to 5 addresses.',
  /** Said in the view once done. */
  saved: 'Your address is saved.',
  removed: 'The address is removed.',
  /** A failure, followed by the server's message. */
  failed: 'Your address could not be saved just now.',
  /** The view while the addresses are read; then, when they cannot be, the sentence, the server's message and TRY AGAIN. */
  loading: 'ONE MOMENT…',
  unreadable: 'Your addresses could not be shown just now.',
  retry: 'TRY AGAIN',
  /** Accessible names of an address's links, with its name. */
  editLabel: (name: string) => `Edit the address of ${name}`,
  makeDefaultLabel: (name: string) => `Make the address of ${name} your default`,
  removeLabel: (name: string) => `Remove the address of ${name}`,
  /** REMOVE once armed: the second tap (click), still naming the address. */
  removeConfirmLabel: (name: string) => forDevice(`Tap again to remove the address of ${name}`, `Click again to remove the address of ${name}`),
  /** The most a collector keeps (services/addresses.ts ADDRESS_LIMITS.saved). */
  max: 5,
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

/** YOUR ACCOUNT's LIGHT MODE switch (shared/mode.ts): off is NOCTURNE's dark, the default. */
export const MODE = Object.freeze({
  label: 'LIGHT MODE',
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
 * Plan NEXT LOT §3.6.F, a draw's size: its label without the word a label may already carry (`SIZE 52` is 52), so that
 * a draw names it `SIZE 52`, `size 52` or `ONE SIZE`, never `SIZE SIZE 52`.
 */
const bareSize = (size: string) => String(size).trim().replace(/^SIZE\s+/i, '');
const drawSizeName = (size: string) => (isOneSize(size) ? 'ONE SIZE' : `SIZE ${bareSize(size)}`);
const drawSizeWords = (size: string) => (isOneSize(size) ? 'ONE SIZE' : `size ${bareSize(size)}`);
const drawInSize = (size: string) => (isOneSize(size) ? 'in ONE SIZE' : `in size ${bareSize(size)}`);

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
  /** A time of the release in Paris (`SUNDAY 11 OCTOBER · 19:00 PARIS`), then on this phone (computer) when its zone differs. */
  paris: (day: string, time: string) => `${day} · ${time} PARIS`,
  onThisPhone: (day: string, time: string) => `${day} · ${time} ON THIS PHONE`,
  onThisComputer: (day: string, time: string) => `${day} · ${time} ON THIS COMPUTER`,
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
    /** AC-01: a size preselected from YOUR SIZES, under the sizes, until the collector confirms it or taps another. */
    fromYours: (size: string) => `${sizeName(size)} · FROM YOUR SIZES`,
    checkSize: 'Check it is right for this model before you confirm.',
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
      ? 'Places are drawn by tier, then at random, among the collectors present at the opening. Those who arrive later join behind, in order of arrival. Places guaranteed by ORBES come first in their size.'
      : 'Places are drawn at random among the collectors present at the opening. Those who arrive later join behind, in order of arrival. Places guaranteed by ORBES come first in their size.',
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
    /** AC-01: the size preselected from YOUR SIZES, not ready until the collector taps a size or enters. */
    toConfirm: 'TO CONFIRM',
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
  /**
   * The queue (macro scope of 2026-10-20, W2, W5, W6): after the opening, on a release that lets its line in at a pace,
   * an entry waiting to be let into the room reads its place and when it should come in, in Paris, never the pace itself.
   */
  queue: Object.freeze({
    kind: 'THE QUEUE',
    /** The place's label as a screen reader says it, before the figure. */
    placeSaid: 'Your place in the queue',
    /** While the queue's figures are read (the page's first read of them, or after it lost them). */
    reading: 'READING YOUR PLACE',
    /** The estimated entry time in Paris, then on this phone (computer) when its zone says it otherwise. */
    eta: (time: string) => `ESTIMATED ENTRY ${time} PARIS`,
    onThisPhone: (time: string) => `${time} ON THIS PHONE`,
    onThisComputer: (time: string) => `${time} ON THIS COMPUTER`,
    /** How long until then: `ABOUT 12 MIN`, `ABOUT 2 H 05`; within half a minute, ANY MOMENT NOW. */
    about: (minutes: number) => (minutes < 60 ? `ABOUT ${minutes} MIN` : `ABOUT ${Math.floor(minutes / 60)} H ${String(minutes % 60).padStart(2, '0')}`),
    soon: 'ANY MOMENT NOW',
    paused: 'THE QUEUE IS PAUSED',
    pausedLine: 'It resumes from where it stopped.',
    /** W6: the place is kept whatever happens; the turn passes on only once it has come. */
    keep: 'Keep this page open. Your place is kept if you leave and come back.',
    leave: 'LEAVE THE LINE',
    /** LEAVE THE LINE gives the place up: a second tap (click, on a computer) within a few seconds confirms it. */
    get leaveConfirm() {
      return forDevice('TAP AGAIN TO LEAVE', 'CLICK AGAIN TO LEAVE');
    },
  }),
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
  /**
   * Plan MACRO M3 §4.4 (D2): the catalogue add-ons under the release's, each with its units, carried onto the order at
   * PAY; those none left of by then are said on CONFIRMED.
   */
  addonItems: Object.freeze({
    title: 'ADD TO YOUR ORDER',
    note: 'Added to your order at PAY, while available.',
  }),
  pay: (total: string) => `PAY · ${total}`,
  toConfirm: 'TO CONFIRM',
  /** Plan NEXT LOT §3.6.B: the delivery address is the collector's own, added in YOUR ORDERS. */
  payNote: 'ORBES Client Services will contact you for payment. Your delivery address is added in YOUR ORDERS.',
  release: 'RELEASE MY PLACE',
  /** RELEASE MY PLACE gives the piece back at once: a second tap (click, on a computer) within a few seconds confirms it. */
  get releaseConfirm() {
    return forDevice('TAP AGAIN TO RELEASE', 'CLICK AGAIN TO RELEASE');
  },
  // Confirmed
  confirmed: 'CONFIRMED',
  confirmedOf: (name: string) => `LIVE RELEASE · ${name}`,
  reservedIn: (size: string, quantity: number) =>
    `${quantity > 1 ? `Your ${quantity} pieces are reserved ${inSizeWords(size)}.` : isOneSize(size) ? 'Your piece is reserved in ONE SIZE.' : `Your piece is reserved in size ${size}.`} ORBES Client Services will contact you to settle payment. Add your delivery address in YOUR ORDERS.`,
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
      get leaveConfirm() {
        return forDevice('TAP AGAIN TO LEAVE', 'CLICK AGAIN TO LEAVE');
      },
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
    /** The queue (W5): its place, then when it should come in, Paris time; or that it is paused. */
    queue: (place: number, time: string | null) =>
      `Your place in the queue: ${place}. ${time === null ? 'The queue is paused. Your place is kept.' : `Estimated entry at ${time}, Paris time.`}`,
    /** Let into the room from the queue: then its place in the line, as the line says it. */
    admitted: 'You’re in.',
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

/**
 * SHARE TO STORIES (plan NEXT-NINE of 2026-10-06, §3.8 BP-10): the button under a LIVE RELEASE's CONFIRMED, a draw's
 * place SELECTED and the ceremony of a first registration, the story card's words (story-card.ts) and its preview
 * (views/story.ts). The page's own words stay PLACE HELD, PLACE RESERVED and CONCLUDED; only the card says SELECTED.
 */
export const STORY = Object.freeze({
  button: 'SHARE TO STORIES',
  /** The preview's accessible name. */
  label: 'Your story card',
  /** Desktop: the preview's name, over its actions beside the card (a computer only). */
  title: 'YOUR STORY CARD',
  /** The card's label in its hairline box, by where it comes from. */
  status: Object.freeze({ live: 'CONFIRMED', draw: 'SELECTED', registered: 'REGISTERED' }),
  /** The card's line over its title (a registration's: the piece's type and collection). */
  kind: Object.freeze({ live: LIVE.kind, draw: NOW.draw }),
  wordmark: 'ORBES',
  site: 'THEORBES.COM',
  share: 'SHARE',
  save: 'SAVE IMAGE',
  saved: 'IMAGE SAVED',
  close: 'CLOSE',
  /** Under SAVE IMAGE where the browser cannot share a file; on a computer, the story is added from the phone. */
  get cannotShare() {
    return forDevice(
      'This browser cannot share an image. Save it, then add it to your story from your photos.',
      'This browser cannot share an image. Save it, then add it to your story from your phone.',
    );
  },
  /** The card's alternative text: its words, joined. */
  alt: (...words: string[]) => words.join('. '),
  /** The title handed to the share sheet with the file (no text, no link). */
  shareTitle: 'ORBES',
  /** The file, shared or saved. */
  filename: 'ORBES-STORY.png',
});

/**
 * CREATE ACCOUNT's new words (plan CUSTOMER INTELLIGENCE §3.1 P.4.1, P.7): FIRST NAME and LAST NAME in place of
 * NAME (OPTIONAL), COUNTRY (preselected from where the person connects), then the one optional question, HOW DID YOU
 * HEAR ABOUT ORBES?, with IN A FEW WORDS under Other. EMAIL, PASSWORD and CREATE ACCOUNT keep their words where they are.
 */
export const SIGN_UP = Object.freeze({
  firstName: 'FIRST NAME',
  lastName: 'LAST NAME',
  country: 'COUNTRY',
  countryHint: 'Where you live. You may change it in YOUR PROFILE.',
  chooseCountry: 'Choose your country',
  heard: 'HOW DID YOU HEAR ABOUT ORBES? (OPTIONAL)',
  choose: 'Choose',
  other: 'IN A FEW WORDS (OPTIONAL)',
  noFirstName: 'Enter your first name.',
  noLastName: 'Enter your last name.',
  noCountry: 'Choose your country.',
});

/** Words in a sentence's list: « a », « a and b », « a, b and c ». */
const wordsList = (items: readonly string[] | string) => {
  const list = typeof items === 'string' ? [items] : [...items];
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

/**
 * YOUR TASTES, a block of YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.2 W.10.3, W.10.4): FAVOURITE PIECES and FAVOURITE
 * FINISHES, chosen among what THE COLLECTION shows, two by two; a choice the collection no longer shows stays, pressed,
 * NO LONGER IN THE COLLECTION under it.
 */
export const TASTES = Object.freeze({
  title: 'YOUR TASTES',
  lead: 'The pieces and finishes you prefer in the ORBES collection.',
  pieces: 'FAVOURITE PIECES',
  finishes: 'FAVOURITE FINISHES',
  hint: 'Choose as many as you like.',
  max: 'Up to 30.',
  retired: 'NO LONGER IN THE COLLECTION',
});

/**
 * YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8): a row of the account sheet, right after MESSAGES, its line how
 * complete the profile is (`60% COMPLETE`, or COMPLETE), and its view in the sheet: the fields in five groups (YOU,
 * WHERE YOU ARE, CONTACT, YOUR TASTES, HOW YOU FOUND ORBES), the date of birth entered once (CONFIRM YOUR DATE OF BIRTH,
 * then only ORBES Client Services changes it), the default address of YOUR ADDRESSES, SAVE and CANCEL. Never blocking.
 */
export const ACCOUNT_PROFILE = Object.freeze({
  row: 'YOUR PROFILE',
  complete: 'COMPLETE',
  percentRow: (n: number) => `${n}% COMPLETE`,
  title: 'YOUR PROFILE',
  lead: 'Your details, as ORBES keeps them. You may change them at any time, except your date of birth once it is saved.',
  percent: (n: number) => `Your profile is ${n}% complete.`,
  done: 'Your profile is complete.',
  /** What is missing, its items in the words of `item`: 'Missing: your phone, your date of birth and your Instagram.' */
  missing: (items: readonly string[]) => `Missing: ${wordsList(items)}.`,
  item: Object.freeze({
    NAME: 'your name',
    COUNTRY: 'your country',
    BIRTH_DATE: 'your date of birth',
    CITY: 'your city',
    ADDRESS: 'your address',
    PHONE: 'your phone',
    INSTAGRAM: 'your Instagram',
    PIECES: 'your favourite pieces',
    FINISHES: 'your favourite finishes',
    HEARD: 'how you heard about ORBES',
  }),
  groups: Object.freeze({ you: 'YOU', where: 'WHERE YOU ARE', contact: 'CONTACT', tastes: TASTES.title, found: 'HOW YOU FOUND ORBES' }),
  firstName: 'FIRST NAME',
  lastName: 'LAST NAME',
  birthDate: 'DATE OF BIRTH',
  day: 'DAY',
  month: 'MONTH',
  year: 'YEAR',
  birthHint: 'Entered once. After that, ORBES Client Services can change it.',
  birthSet: 'To change it, write to ORBES Client Services.',
  birthCleared: 'Not saved. To give it, write to ORBES Client Services.',
  /** The text link under a date set or removed: the sheet's MESSAGES. */
  write: MESSAGES.write,
  birthConfirm: 'CONFIRM YOUR DATE OF BIRTH',
  birthConfirmLine: (date: string) => `${date}. Once saved, only ORBES Client Services can change it.`,
  birthPartial: 'Choose the day, the month and the year.',
  /**
   * The last line under DATE OF BIRTH (question 14 of 8 October 2026), from THE PROGRAM's birthday credit: its amount
   * as the app writes money ('€ 20') and its days. Not drawn while THE PROGRAM gives none.
   */
  birthCredit: (amount: string, days: number) => `On your birthday, ORBES gives you a credit of ${amount}, valid ${days} ${days === 1 ? 'day' : 'days'}.`,
  country: 'COUNTRY',
  city: 'CITY',
  address: 'ADDRESS',
  addressHint: 'Your default delivery address. It is put on each new order.',
  addressNone: 'No address is saved.',
  addressAdd: 'ADD AN ADDRESS',
  addresses: 'YOUR ADDRESSES',
  isDefault: 'DEFAULT',
  phoneCode: 'COUNTRY CODE',
  phoneNumber: 'PHONE NUMBER',
  phoneHint: 'Not checked by text message.',
  instagram: 'INSTAGRAM',
  instagramHint: 'Your username only.',
  heard: 'HOW DID YOU HEAR ABOUT ORBES?',
  choose: 'Choose',
  other: 'IN A FEW WORDS',
  save: 'SAVE',
  cancel: 'CANCEL',
  retry: 'TRY AGAIN',
  loading: 'ONE MOMENT…',
  saved: 'Your profile is saved.',
  failed: 'Your profile could not be saved just now.',
  unreadable: 'Your profile could not be shown just now.',
  changed: 'Your profile was changed meanwhile. It is shown again as it is now.',
  /** YOUR ADDRESSES' back link when it was opened from YOUR PROFILE (otherwise MESSAGES.back, YOUR ACCOUNT). */
  backToProfile: 'YOUR PROFILE',
});

/** The wishlist (CUSTOMER INTELLIGENCE, W.10): the heart on a model's sheet, YOUR WISHLIST's row and page. Private: no count is shown. */
export const WISHLIST = Object.freeze({
  heart: 'WISHLIST',
  added: 'In your wishlist.',
  removed: 'Removed from your wishlist.',
  failed: 'Your wishlist could not be changed just now.',
  signedOut: 'Your wishlist is kept in your ORBES account.',
  signIn: 'SIGN IN',
  row: 'YOUR WISHLIST',
  count: (n: number) => (n === 0 ? 'NONE YET' : n === 1 ? '1 MODEL' : `${n} MODELS`),
  back: 'YOUR ACCOUNT',
  title: 'YOUR WISHLIST',
  lead: 'The models you marked with the heart on their page, the latest first.',
  loading: 'ONE MOMENT…',
  unreadable: 'Your wishlist could not be shown just now.',
  retry: 'TRY AGAIN',
  empty: 'Your wishlist is empty. Mark a model with the heart on its page to keep it here.',
  collection: 'THE COLLECTION',
  seeModel: 'SEE THE MODEL',
  remove: 'REMOVE',
  removedNamed: (name: string) => `${name} is removed from your wishlist.`,
  notShown: 'NOT IN THE COLLECTION NOW',
  discontinued: (year: number) => `DISCONTINUED · ${year}`,
  salon: 'THE PRIVATE SALON',
});

/**
 * The desktop layout (desktop, BRIEF §5.4): on a computer, SCAN stands in the top bar beside the account and
 * opens a page that sends the collector to their phone (its QR code), with UPLOAD A PHOTO below it; no camera opens.
 */
export const DESKTOP = Object.freeze({
  /** SCAN in the top bar: its word, and its name (the word first, as it reads). */
  scan: 'SCAN',
  scanLabel: 'Scan an ORBES code',
  /** The SCAN page (/verify/scan); `lead` is NOW's scan line too (views/desktop-now.ts). */
  scanPage: Object.freeze({
    title: 'SCAN AN ORBES CODE',
    lead: 'The code on your piece’s certificate card is read by a phone’s camera. Open ORBES on your phone to scan it, or upload a photo of the code.',
    /** The page's own sentence under its title. */
    intro: 'The ORBES CODE on your piece’s certificate card is read by a phone’s camera.',
    /** Beside the QR code: how it leads to the phone. */
    phoneLabel: 'WITH YOUR PHONE',
    phone: 'Point your phone’s camera at this code and open the link it shows: ORBES opens on your phone. Then tap SCAN ORBES CODE.',
    /** Under it: the photo path, from the computer itself. */
    computerLabel: 'FROM THIS COMPUTER',
    computer: 'Upload a photo of the ORBES CODE: a sharp, well-lit photo in which the whole code is visible.',
    /** What the QR code opens (the live site's scan address), under it and in its name. */
    address: 'verify.theorbes.com/verify',
    url: 'https://verify.theorbes.com/verify',
    /** Its name for a screen reader (never "QR": the brand's lexicon keeps the word out of the copy). */
    qrLabel: 'A code for your phone’s camera: it opens verify.theorbes.com/verify',
    upload: 'UPLOAD A PHOTO',
  }),
  /**
   * A model's gallery on a computer (decision 1): each photograph a tile that enlarges it in a full-window viewer, its
   * PREVIOUS, NEXT and CLOSE, and where it stands in the gallery. The viewer is named as the gallery is (LOOKBOOK.photosLabel).
   */
  viewer: Object.freeze({
    previous: 'PREVIOUS',
    next: 'NEXT',
    close: 'CLOSE',
    position: (at: number, of: number) => `${at} / ${of}`,
    enlarge: (at: number, of: number) => `Enlarge photograph ${at} of ${of}`,
  }),
  /**
   * THE ENTRIES of a draw drawn, as a table on a computer (§10.30): the head of its columns, over the ranked entries
   * (each line's rank, tier, seniority and size as RELEASES.entryLine says them, then the entry's identifier). Shown to
   * the eye only: a screen reader reads each entry's own line.
   */
  entries: Object.freeze({
    rank: 'RANK',
    tier: 'TIER',
    seniority: 'SENIORITY',
    size: 'SIZE',
    id: 'IDENTIFIER',
  }),
  /**
   * The LIVE RELEASE's room on a computer (decision 7, the Cinema room): the release's choice in its corner, under its
   * name, from the account's entry (`SIZE 17 · 1 PIECE`; at the turn, its price after it, as the seal's line says it).
   */
  room: Object.freeze({
    pieces: (n: number) => (n === 1 ? '1 PIECE' : `${n} PIECES`),
  }),
  /**
   * Sign in and create account on a computer (decision 6): their own page over a photograph (/verify/sign-in), its
   * title YOUR ACCOUNT (ACCOUNT.title) over the lead of the place it was opened from; every place that holds the sign-in
   * on a phone shows its lead and a line with SIGN IN and CREATE ACCOUNT, which open that page on that form. `lead`: the
   * page's sentence when it is opened from the top bar's SIGN IN.
   */
  signIn: Object.freeze({
    signIn: 'SIGN IN',
    create: 'CREATE ACCOUNT',
    lead: 'Sign in or create an ORBES account to continue.',
  }),
  /**
   * The account as pages on a computer (decision 5): YOUR ACCOUNT's cards, each with its line from the account's data;
   * MESSAGES' line, how many answers are unread (none: no line, as the phone's row has no NEW then).
   */
  account: Object.freeze({
    unread: (n: number) => `${n} UNREAD`,
  }),
  /**
   * MESSAGES as a page in two parts on a computer (decision 5, "Subjects | conversation"): on the left what the
   * collector has written about, each subject named as its first message was (MESSAGES.label's words, written by the
   * server), GENERAL for what concerns nothing in particular; on the right the conversation on the subject chosen, under
   * CONCERNING and the way to the place it names (an order's: SEE THE ORDER). A subject opened from WRITE TO ORBES
   * CLIENT SERVICES before its first message says where the answer will be, in the write sheet's words (MESSAGES.where).
   */
  messages: Object.freeze({
    subjects: 'Your subjects with ORBES Client Services',
    general: 'GENERAL',
    seeOrder: 'SEE THE ORDER',
  }),
  /**
   * An order as its own page on a computer (decision 5, /verify/orders/OR-…), MY PIECES' ORDERS listing them as rows:
   * each row's name for a screen reader (its model, its reference, where it is now).
   */
  orders: Object.freeze({
    rowLabel: (title: string, reference: string, step: string) => `${title}, ${reference}: ${step}`,
  }),
});

/**
 * RESET BY EMAIL (macro scope E3; lot M1 plan §4.4, step M1.19): offered only while GET /api/v1/account/reset says so (the
 * emails' channel on and PASSWORD_RESET switched on); otherwise FORGOTTEN PASSWORD? is ORBES Client Services' way alone,
 * word for word as before. Under FORGOTTEN PASSWORD, the email of the account and SEND LINK, then the same sentence for
 * any address (nothing is said of whether it has an account); ORBES Client Services' way stays under it, for whoever no
 * longer reaches that email. The link opens /verify/reset (views/reset.ts): the new password twice, then SAVE; the
 * existing recovery code underneath (a refused link reads the server's RECOVERY_CODE_INVALID words).
 */
export const ACCOUNT_RESET = Object.freeze({
  lead: 'Enter the email of your ORBES account: a link to choose a new password is sent to it.',
  send: 'SEND LINK',
  /** The same sentence for any address, whether an account uses it or not. */
  sent: 'If an account uses this address, a link is on its way. It works for 30 minutes.',
  noEmail: 'Enter the email of your ORBES account.',
  /** Above ORBES Client Services' way, under the link's form. */
  other: 'NO ACCESS TO THIS EMAIL?',
  /** The page the link opens: its title (SET A NEW PASSWORD) and, under it, the account it is for. */
  title: ACCOUNT_PASSWORD.recoverTitle,
  pageLead: (email: string) => `For the ORBES account ${email}.`,
  newPassword: ACCOUNT_PASSWORD.newPassword,
  confirm: 'NEW PASSWORD, AGAIN',
  confirmHint: 'The same password, to be sure of it.',
  mismatch: 'The two passwords are not the same.',
  save: 'SAVE',
  /** A link opened without its address and code (cut, or opened again after the page took them out of the address). */
  incomplete: 'This link is incomplete. Open it again from its email, or ask for a new one.',
  /** A link the server refused (RECOVERY_CODE_INVALID): what may have happened to it, never the typed form's words. */
  refused: 'This link has expired, was already used or was replaced by a newer one.',
  /** A link refused or incomplete: a new one, to the address it was for (or the one typed). */
  againLead: 'Ask for a new link: it works once, for 30 minutes.',
  again: 'SEND A NEW LINK',
  /** Done: the page's line over the sign-in, the recovery's own sentence under it (ACCOUNT_PASSWORD.recovered). */
  doneLead: 'Sign in with your new password.',
});

/**
 * STOP THESE EMAILS (macro scope E1, E2; lot M1 plan §4.4, step M1.19): the page an email's STOP THESE EMAILS opens
 * (/verify/unsubscribe#<token>, views/unsubscribe.ts). It names what the link stops, asks once (STOP), then says what
 * no longer comes. A link the server does not recognise has one calm answer; nothing is said of whose it was.
 */
export const UNSUBSCRIBE = Object.freeze({
  ask: 'STOP THESE EMAILS?',
  done: 'EMAILS STOPPED',
  plain: 'STOP THESE EMAILS',
  /** What each link stops, under the question. */
  kind: Object.freeze({
    FOUNDING_ANNOUNCEMENT: 'The email of the ORBES founding list, which announces the first release.',
    RELEASE_NOTICE: 'Release notices: an email each time ORBES announces a release.',
  }),
  stop: 'STOP',
  /** Once stopped, what no longer comes. */
  stopped: Object.freeze({
    FOUNDING_ANNOUNCEMENT: 'You will no longer receive the email of the ORBES founding list.',
    RELEASE_NOTICE: 'You will no longer receive release notices.',
  }),
  /** Release notices only: they are the account's own choice. */
  again: 'To receive them again, switch them on in YOUR PROFILE.',
  invalid: 'This link could not be read. Open it again from the email it came in.',
  loading: 'ONE MOMENT…',
  failed: 'This could not be done just now.',
  retry: 'TRY AGAIN',
});

/**
 * EMAIL ME WHEN A RELEASE IS ANNOUNCED (macro scope E2; lot M1 plan §4.4, step M1.19): YOUR PROFILE's last group, shown
 * only while the emails' channel is on (GET /api/v1/account/email-preferences answers; 409 EMAIL_OFF hides it), so
 * nothing is promised that is not sent. Saved as it is switched, apart from the profile's SAVE.
 */
export const RELEASE_NOTICES = Object.freeze({
  group: 'EMAILS',
  label: 'EMAIL ME WHEN A RELEASE IS ANNOUNCED',
  hint: 'To the email of your account, saved as soon as it is switched. Each of these emails can stop them too.',
  failed: 'Your choice could not be saved just now.',
});

/**
 * The house messages' words (macro scope D24 M1; lot M2 plan §1.2, step M2.2): each moment's default title and words,
 * shared with the server, which renders and stores them at delivery (src/shared/house-words.ts), so every collector word
 * still lives here.
 */
export { HOUSE } from '../../shared/house-words.js';

/**
 * FROM ORBES (macro scope D24, M3 and M4; lot M2 plan §1.5, step M2.5): the house messages in MESSAGES, read-only. On a
 * phone, MESSAGES gains two tabs once the account has one (ORBES CLIENT SERVICES, the conversation as before, and FROM
 * ORBES), each with NEW while it holds something unread; on a computer, FROM ORBES is a subject of the messages page,
 * WRITE TO ORBES CLIENT SERVICES in place of the reply. NOW's line says a new one while no answer is unread. The author
 * line and each link's words are HOUSE's (src/shared/house-words.ts), the console's preview draws the same.
 */
export const FROM_ORBES = Object.freeze({
  /** The tab, the subject and the list's name. */
  title: 'FROM ORBES',
  /** The other tab: the conversation with ORBES Client Services (MESSAGES' own words for its author). */
  conversation: 'ORBES CLIENT SERVICES',
  /** Under the list (M3): no reply; the phone's way to write is the conversation's tab, a computer's the button. */
  noReply: 'Messages from ORBES cannot be answered.',
  toWrite: 'To write, open',
  /** NOW's line while a house message is unread and no answer is. */
  now: Object.freeze({ label: 'MESSAGES', sentence: 'A new message from ORBES.', read: 'READ' }),
  loading: 'ONE MOMENT…',
  /** The list could not be read: followed by the server's message, then TRY AGAIN. */
  unreadable: 'Messages from ORBES could not be shown just now.',
  retry: 'TRY AGAIN',
  /** More than a page (30): the next one, older. */
  earlier: 'SHOW EARLIER',
  earlierFailed: 'Earlier messages could not be shown just now.',
});

/**
 * WORN, sending from the piece (macro scope D31, G1 to G3; lot M2 plan §2.3, step M2.10): the block of a piece's
 * OWNERSHIP tab, after OWNERSHIP CERTIFICATE (views/worn.ts; worn-model.ts says which state it shows). The owner chooses
 * a photograph, sees it as it will be shown with its credit (exactly the first name and the country, plus the Instagram
 * name when chosen; never a variant), agrees, and sends it; ORBES looks at it before it appears on the model's sheet.
 * The refusals' words are the console's (admin/model/worn.ts WORN_REFUSAL_WORDS[*].owner, held equal by a test).
 */
export const WORN = Object.freeze({
  title: 'WORN',
  lead: 'Show how you wear it. ORBES looks at each photograph before it appears on the model’s sheet, with your first name and country.',
  choose: 'CHOOSE A PHOTOGRAPH',
  chooseAnother: 'CHOOSE ANOTHER PHOTOGRAPH',
  /** On a computer the block is also a drop zone, its line under CHOOSE A PHOTOGRAPH. */
  drop: 'or drop it here',
  preparing: 'PREPARING…',
  /** The chosen photograph, re-encoded on the device, as it will be sent. */
  previewAlt: 'Your photograph, as it will be sent',
  /** The photograph sent, in review or published. */
  photoAlt: 'Your photograph for WORN',
  instagram: 'SHOW MY INSTAGRAM',
  consent: 'I took this photograph or have its author’s permission, and anyone recognisable in it agrees. ORBES may show it in WORN with my credit until I withdraw it.',
  consentLabel: 'I AGREE',
  consentMissing: 'Agree to how WORN shows your photograph to send it.',
  send: 'SEND',
  sending: 'SENDING…',
  cancel: 'CANCEL',
  review: 'IN REVIEW',
  reviewText: 'ORBES is looking at your photograph.',
  published: 'PUBLISHED',
  publishedSince: (date: string) => `In WORN since ${date}.`,
  seeOnSheet: 'SEE IT ON THE SHEET',
  withdraw: 'WITHDRAW',
  /** WITHDRAW, confirmed in place: a published photograph, then one in review. */
  withdrawAsk: 'Remove it from WORN?',
  withdrawAskReview: 'Withdraw it from review?',
  withdrawn: 'Your photograph is withdrawn and erased.',
  notPublished: 'NOT PUBLISHED',
  /** Why ORBES did not publish it, or took it down (one of three, never free text). */
  refusal: Object.freeze({
    PIECE_NOT_VISIBLE: 'The piece is not clearly visible.',
    QUALITY: 'The photograph is not sharp enough.',
    NOT_SUITABLE: 'This photograph cannot be shown in WORN.',
  }),
  /** No first name or country in YOUR PROFILE: the credit cannot be written. */
  profile: 'Add your first name and country in YOUR PROFILE to sign your photograph.',
  profileLink: 'YOUR PROFILE',
  /** A piece reported lost or stolen, or in service; a transfer pending: one calm sentence, no button. */
  status: 'No photograph can be sent while the piece is reported lost or stolen, or in service.',
  transfer: 'No photograph can be sent while the piece’s transfer is pending.',
  get unreadable() {
    return forDevice('This photograph cannot be read. Choose a JPEG or a photograph from your library.', 'This photograph cannot be read. Choose a JPEG or another photograph.');
  },
  noCanvas: 'This browser cannot prepare the photograph. Open the piece in another browser.',
  tooLarge: 'This photograph stays over 1 MB once prepared. Choose another one.',
  retry: 'TRY AGAIN',
  /**
   * WORN at the foot of a model's sheet (lot M2, G3 to G5), after PAIRS WELL WITH, for everyone: the photographs of every
   * variant of the model alike, each credited with exactly the first name and the country (and the Instagram name when
   * its owner chose to show it), never a variant; the first ones, then SHOW MORE; a photograph opened whole.
   */
  sheet: Object.freeze({
    title: 'WORN',
    lead: 'Worn by the owners of ORBES pieces.',
    /** A photograph's words for a screen reader, from its credit (the first name and the country as written). */
    alt: (firstName: string, country: string) => `Worn by ${firstName}, ${country}`,
    /** Its button: the photograph opened whole. */
    open: (firstName: string, country: string) => `Open the photograph worn by ${firstName}, ${country}`,
    /** The Instagram name, a link opened apart. */
    instagram: (handle: string) => `${handle} on Instagram (opens in a new tab)`,
    more: 'SHOW MORE',
    loading: 'ONE MOMENT…',
    failed: 'The next photographs cannot be shown now.',
    retry: 'TRY AGAIN',
    close: 'CLOSE',
  }),
});

/**
 * THE SET (macro scope of 2026-10-20, K44 T1 to T3; plan MACRO M3 §5.4): 2 to 4 models sold as one release, at one price,
 * a size chosen for each piece at entry. A set's release in THE RELEASES, NOW and PAST (THE SET · 3 PIECES, its pieces'
 * photographs side by side from the photograph's stage, their names from the name's); a set's draw (a size picker per
 * piece, YOUR SIZES' preselection for each, ENTER THE DRAW once every piece has a size, every size on the entry's label,
 * ONE PRICE FOR THE SET, its own rule); YOUR ORDERS (the pieces of one set grouped under THE SET · <name> with its one
 * price, RETURN THE SET in place of REQUEST A RETURN, a piece's size exchanged as any, the set cancelled whole).
 */
export const SETS = Object.freeze({
  /** Under a set's title, wherever its release is shown: `THE SET · 3 PIECES`. */
  line: (pieces: number) => `THE SET · ${pieces} PIECES`,
  /** A piece of a set before its name's stage, and a picker's label without one. */
  piece: (n: number) => `PIECE ${n}`,
  /** A set's quantity: `25 SETS`. */
  sets: (n: number) => (n === 1 ? '1 SET' : `${n} SETS`),
  /** The sets reserved directly, of the draw's (`1 OF 6 SETS`). */
  reservedOf: (n: number, quantity: number) => `${n} OF ${quantity === 1 ? '1 SET' : `${quantity} SETS`}`,
  /** A set's LIVE RELEASE: a set counts as one toward the limit per person (T4). */
  perPerson: (n: number) => (n === 1 ? '1 SET PER PERSON' : `UP TO ${n} SETS PER PERSON`),
  /** The price of a set's release, said once for all its pieces. */
  onePrice: 'ONE PRICE FOR THE SET',
  /** THE RELEASE's rows of a set's draw. */
  rows: Object.freeze({ sets: 'SETS', pieces: 'THE PIECES' }),
  /** One of a set's pieces photographed (each tile's words for a screen reader). */
  photoLabel: (name: string) => `${name}, a piece of the set, photographed by ORBES`,
  /** YOUR ENTRY of a set's draw: over the pickers, one per piece (its model's name, else PIECE 1), each a group named so. */
  yourSizes: 'YOUR SIZES',
  pickerLabel: (name: string) => `Your size of ${name}`,
  /** Under the pickers while a piece has no size yet: ENTER THE DRAW waits for every one. */
  chooseEach: 'Choose a size for each piece of the set.',
  /** An entry's label with every size, in the set's order: `ENTERED · SIZE 17 · 52 · 45`. */
  label: (status: string, sizes: readonly string[]) => `${status} · ${sizesWords(sizes)}`,
  /** A line of THE ENTRIES with the sizes the entry was drawn in: `12 · PLATINE · 2 YEARS · SIZE 17 · 52 · 45`. */
  entryLine: (line: string, sizes: readonly string[]) => `${line} · ${sizesWords(sizes)}`,
  /** An entry of a set's draw while entries are open (its sizes are on its label). */
  entered: 'You are entered in the draw with a size for each piece. You may change a size until entries close, and withdraw until the draw.',
  /** A size picked whose pieces are all reserved, while entries are open: said under that piece's sizes. */
  openFull: (size: string, name: string) => `Every piece of ${name} ${setInSize(size)} has been reserved. You may still enter: the draw places an entry while each of its sizes has a piece left.`,
  /** The rule of a set's draw, exactly as the server applies it (services/drops.ts draw). */
  rule:
    'Each entry chooses a size for each piece of the set. The entries are ranked by tier, from PALLADIUM to PLATINE to TITANE, then the accounts that hold no piece; then by seniority, the full years since the account’s first piece, the most first; then by the SHA-256 of the 32 bytes of the seed followed by the entry’s identifier in lower-case letters, in increasing hexadecimal order. The tier and the seniority are those of the moment of the draw. In that order, an entry is selected while every one of its sizes has a piece left after the direct reservations of PLATINE and PALLADIUM owners; the others form the waiting list, in that order.',
  /**
   * YOUR ORDERS (T1 to T3): the pieces of one set under THE SET · <name>, the one price and the total of the set; on each
   * piece, PART OF THE SET in its PRICE row; RETURN THE SET in place of REQUEST A RETURN, with why; the set cancelled whole.
   */
  orders: Object.freeze({
    group: (name: string) => `THE SET · ${name}`,
    pieces: (n: number) => (n === 1 ? '1 PIECE' : `${n} PIECES`),
    total: 'TOTAL',
    /** A piece's PRICE row: its price is the set's. */
    inSet: 'PART OF THE SET',
    /** Its piece among the set's: `PIECE 2 OF 3`. */
    pieceOf: (n: number, of: number) => `PIECE ${n} OF ${of}`,
    cancelled: 'This set has been cancelled, with every piece of it.',
    returnSet: 'RETURN THE SET',
    returnWhole: 'A set is returned whole: every piece of it is sent back together.',
    lead: (until: string) => `You may return this set or exchange this piece’s size until ${until}. It is sent back at your cost, with the carrier of your choice.`,
    /** Once a set's return is asked, on each of its pieces. */
    sendTogether: 'Send every piece of the set back together, in one parcel.',
    /** The order's page on a computer: the set's part, its pieces each a link to its own page. */
    title: 'THE SET',
    pieceLabel: (title: string, reference: string) => `${title}, order ${reference}`,
  }),
});

/** A set's sizes in its pieces' order (`SIZE 17 · 52 · 45`), each without the word its label may carry. */
function sizesWords(sizes: readonly string[]): string {
  const bare = (Array.isArray(sizes) ? sizes : [String(sizes)]).map((s) => (isOneSize(s) ? 'ONE SIZE' : bareSize(s)));
  return bare.length > 0 && bare[0] !== 'ONE SIZE' ? `SIZE ${bare.join(' · ')}` : bare.join(' · ');
}

const setInSize = (size: string) => (isOneSize(size) ? 'in ONE SIZE' : `in size ${bareSize(size)}`);
