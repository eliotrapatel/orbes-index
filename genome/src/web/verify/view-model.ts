/**
 * Result view-model: a VerifyOutcome (server) → what the result screen shows.
 *
 * Pure (no DOM) and unit-tested. The server decides the state and writes the
 * title and message; this module only arranges them: which sections appear,
 * the notice under the message (unusual activity for the owner, or, under
 * AUTHENTIC — REGISTERED, the second-hand guidance of J-02 and its link to
 * RECEIVING THIS PIECE),
 * the photographs of an authentic piece (F-04: its own, then its model's),
 * the sheet of its model in THE COLLECTION (P-R02: SEE THE MODEL),
 * the ceremony of a first registration (P-D01: the GENOME, then the name of
 * its model and its collection),
 * how product facts read as brand lines (DISCONTINUED · <year> last when
 * its model was discontinued, P-R06), which tabs exist and what the
 * ownership tab offers (or, on an UNUSUAL ACTIVITY result that carries a
 * registration token or a transfer window, the certificate-card or the
 * transfer-code section), when the scan's windows end on this device's
 * clock, where WRITE TO ORBES CLIENT SERVICES is offered with what it
 * attaches (plan NEXT-NINE, CS-01: the scan, and its warranty on the
 * warranty tab), the email of ORBES Client Services under FORGOTTEN
 * PASSWORD? (the one place it remains), and whether the customer
 * may say where the piece was seen or bought (a result that was not
 * authentic). It never infers
 * anything the server did not say (no internal statuses, no scores), and it
 * never upgrades a state.
 */
import { contactLines, type ContactLines } from '../shared/client-services.js';
import { isLookbookSlug } from '../shared/lookbook.js';
import { ASSURANCE_NOTE, CONTACT, DEFAULT_CARE, DISCONTINUED, FALLBACK_TITLES, PHOTOS, RESALE_ACTION, RESALE_GUIDANCE } from './copy.js';
import { scanContext, warrantyContext, type WriteContext } from './messages-model.js';
import type { StoryInput } from './story-card.js';
import { VERIFICATION_STATES, type ClientServices, type VerificationState, type VerifyOutcome, type WarrantyStatus } from './types.js';

export type Tone = 'authentic' | 'caution' | 'void';
export type TabId = 'product' | 'warranty' | 'care' | 'ownership';

export const TAB_LABELS: Readonly<Record<TabId, string>> = Object.freeze({
  product: 'PRODUCT',
  warranty: 'WARRANTY',
  care: 'CARE',
  ownership: 'OWNERSHIP',
});

export type Row = readonly [label: string, value: string];

export type OwnershipMode =
  /**
   * First registration is open: token from this scan. `underReview`: offered on
   * an UNUSUAL ACTIVITY result (the server's step 10 exception), to the holder
   * of the certificate card only, so the claim code is always required.
   */
  | { kind: 'register'; token: string; expiresAt: string; claimCodeRequired: boolean; underReview: boolean }
  /** The viewer owns it. */
  | { kind: 'yours'; productId: string; transferPending: boolean }
  /**
   * Someone else owns it; the viewer may hold a transfer code. `transfer` (F-03): this scan's window to receive it,
   * which the server gives a signed-in reader who is not the owner while a transfer is pending; the code is then
   * accepted for this piece only, with this scan. Its `expiresAt` is on this device's clock (see resultViewModel).
   * `staff` (S-07): this scan carried a console session, so it earned no window, and scanning again in this browser
   * would earn none either: the panel says so instead of VERIFY AGAIN. `underReview`: offered on an UNUSUAL
   * ACTIVITY result from the scan history alone (the server's exception, as for registration), where the transfer
   * code the owner gave is what proves the handover.
   */
  | { kind: 'registered'; productId: string; transferPending: boolean; transfer?: { token: string; expiresAt: string }; staff?: true; underReview?: true }
  /** No owner and registration is not open: the piece has not been delivered by ORBES or an authorised retailer yet. */
  | { kind: 'unregistered' }
  /**
   * Open for its first registration, but this scan earned no token: the browser is signed in to the
   * ORBES console, so the server recorded a staff scan (S-07, API §9.2: `staffScan`), never a buyer's.
   */
  | { kind: 'staff' }
  /**
   * Not a scan: MY PIECES (F-01) signed out. The panel offers its sign-in forms (and FORGOTTEN PASSWORD?) alone,
   * so an owner whose piece is gone reaches the account without scanning it; signed in, the page lists the pieces.
   * `lead`: the sentence over the forms where another page needs an account (a release's page, P-R03: any account
   * enters its draw); MY PIECES' own when absent.
   */
  | { kind: 'account'; lead?: string };

/**
 * ORBES Client Services' email under FORGOTTEN PASSWORD? (C-04), in the OWNERSHIP panel: the one place of the collector
 * app where it remains (plan NEXT-NINE, CS-01), for someone who also lost their recovery code. Built from GET
 * /api/v1/client-services; absent when no usable email is configured. Everywhere else, WRITE TO ORBES CLIENT SERVICES.
 */
export interface ContactModel {
  placement: 'recovery';
  /** mailto: with the subject "ORBES — FORGOTTEN PASSWORD" and a body prefilled with the reference of the scan on screen. */
  mailto?: string;
}

/**
 * WRITE TO ORBES CLIENT SERVICES on a result (plan NEXT-NINE, CS-01): under the help line of every caution and void
 * result (`help`), and in the WARRANTY tab when the warranty no longer applies (`warranty`), with the scan it attaches
 * (null: a staff scan, which attaches nothing).
 */
export interface WriteModel {
  placement: 'help' | 'warranty';
  context: WriteContext | null;
}

/**
 * WHERE DID YOU SEE OR BUY THIS PIECE? Offered under the contact of every result that was not authentic,
 * attached to its scan (POST /api/v1/reports; the server takes one report per scan, within 24 hours).
 * Never on a staff scan (`staffScan`: this browser is signed in to the console), which takes no report.
 */
export interface ReportModel {
  scanId: string;
  /** The short reference of the result's foot, which the answer is kept with. */
  reference: string;
}

/**
 * A photograph shown above the GENOME of an authentic result (F-04), on its ivory plate: its model's reference
 * photograph, never the piece's own (plan NOCTURNE, decision 9). `src` is always a path of this origin's media route.
 */
export interface PhotoModel {
  kind: 'model';
  src: string;
  alt: string;
  caption: string;
}

export interface GenomeModel {
  id: string;
  version: string;
  versionNumber: number;
  fingerprint: string;
  glyphs: number[];
  ids: string[];
}

export interface ResultViewModel {
  state: VerificationState;
  tone: Tone;
  titleMain: string;
  titleSub?: string;
  message: string;
  /**
   * A line under the message: for the owner, when unusual activity was recorded elsewhere and the server's message
   * does not say it; under AUTHENTIC — REGISTERED, the second-hand guidance (J-02, RESALE_GUIDANCE).
   */
  notice?: string;
  /**
   * The text link under the second-hand guidance (J-02): it opens the OWNERSHIP tab on RECEIVING THIS PIECE, where a
   * transfer code is entered. Only where that section is shown: a piece registered to someone else.
   */
  noticeLink?: { label: string; tab: TabId };
  /** The photographs of an authentic piece (F-04): its own first, then its model's; empty otherwise. */
  photos: PhotoModel[];
  /** The address of its model's sheet in THE COLLECTION (P-R02), under the product lines: authentic results of a PUBLIC model only. */
  lookbook?: string;
  genome?: GenomeModel;
  /** Brand lines: MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY, then DISCONTINUED · YYYY when its model was (P-R06). */
  productLines: string[];
  /**
   * NOCTURNE (C9, C13, C14): the model's name over the lines, then TYPE / CATEGORY / MATERIAL / SIZE 17 / CREATED YYYY
   * (addition 1: the piece's size, from the issuance field Size), then DISCONTINUED · YYYY. Empty with no product.
   */
  modelName?: string;
  pieceLines: string[];
  tabs: TabId[];
  productRows: Row[];
  verificationRows: Row[];
  assuranceNote?: string;
  warranty?: { status: string; rows: Row[]; note: string };
  care: string;
  ownership: OwnershipMode;
  /**
   * The ceremony of a first registration (P-D01): the result VIEW AS OWNER opens once a piece has just been
   * registered to the reader's account. The GENOME appears glyph by glyph, then the name of its model and its
   * collection (never a rank nor a vintage), with SHARE THE GENOME. Only on an authentic result of a piece that is
   * the reader's, with its GENOME and its model.
   */
  ceremony?: CeremonyModel;
  /**
   * SHARE TO STORIES under the ceremony (plan NEXT-NINE, §3.8 BP-10): what its REGISTERED card is made of (the model's
   * photograph, its type and collection, the model with its variant, the day of the registration on this phone), set
   * with the ceremony only. Its card exists only with a photograph of this origin's media route (story-card.ts).
   */
  story?: StoryInput;
  /** Footnote on the limits of a code-based verification (positive results only). */
  footnote?: string;
  /** "1 OCT 2026 · 14:32" in the viewer's time zone. */
  verifiedAt: string;
  /** Short scan reference for Client Services. */
  reference: string;
  /** WRITE TO ORBES CLIENT SERVICES, where the result asks for it (CS-01), with what it attaches. */
  write?: WriteModel;
  /** The same contact for a customer who forgot the password (OWNERSHIP panel, FORGOTTEN PASSWORD?), when configured. */
  recoveryContact?: ContactModel;
  /** Where the piece was seen or bought: results that were not authentic only. */
  report?: ReportModel;
}

/** What the ceremony names under the GENOME (P-D01), in capitals as the product lines: the model, then its collection. */
export interface CeremonyModel {
  name: string;
  collection?: string;
}

const AUTHENTIC: ReadonlySet<VerificationState> = new Set([
  'AUTHENTIC',
  'AUTHENTIC_FIRST_REGISTRATION',
  'AUTHENTIC_REGISTERED',
  'AUTHENTIC_OWNERSHIP_VERIFIED',
]);

export function isAuthenticState(state: VerificationState): boolean {
  return AUTHENTIC.has(state);
}

export function toneOf(state: VerificationState): Tone {
  if (AUTHENTIC.has(state)) return 'authentic';
  if (state === 'SUSPICIOUS_ACTIVITY' || state === 'MALFORMED_CODE') return 'caution';
  return 'void';
}

/** "AUTHENTIC — FIRST REGISTRATION" → main "AUTHENTIC", sub "FIRST REGISTRATION". */
export function splitTitle(title: string): { main: string; sub?: string } {
  const parts = title.split(/\s+[—–-]\s+/);
  const main = (parts[0] ?? '').trim().toUpperCase();
  const sub = parts.slice(1).join(' · ').trim().toUpperCase();
  return sub ? { main, sub } : { main };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 'YYYY-MM-DD' (or an ISO date-time; its UTC date) → '1 OCT 2026'. Unparseable input is returned as is. */
export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return value;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM-DD' → '20 September 2028', for dates inside sentences. Unparseable input is returned as is. */
export function formatDateLong(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const month = m ? MONTHS_LONG[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : value;
}

/**
 * ISO date-time → '1 OCT 2026 · 14:32' at a fixed offset from UTC
 * (`offsetMinutes` = minutes EAST of UTC; the page passes the viewer's own).
 */
export function formatDateTime(iso: string, offsetMinutes = 0): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** ISO date-time → '5 October 2026, 11:00' at `offsetMinutes` east of UTC, for times inside sentences. */
export function formatDateTimeLong(iso: string, offsetMinutes = 0): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The offset of a time shown at `offsetMinutes` east of UTC, e.g. 'UTC+02:00', 'UTC-03:30'. */
export function utcOffsetLabel(offsetMinutes = 0): string {
  const m = Math.round(Math.abs(offsetMinutes));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `UTC${offsetMinutes < 0 && m > 0 ? '-' : '+'}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** First block of the scan id, enough for Client Services to find it. */
export function shortReference(scanId: string): string {
  const head = (scanId || '').split('-')[0] ?? '';
  return /^[0-9a-f]{6,}$/i.test(head) ? head.toUpperCase() : '';
}

const WARRANTY_STATUS: Readonly<Record<WarrantyStatus, string>> = Object.freeze({
  NOT_STARTED: 'NOT YET STARTED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  VOID: 'NO LONGER VALID',
});

function warrantyNote(status: WarrantyStatus, end: string): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'The ORBES warranty begins on the date of purchase from an ORBES boutique or authorised retailer.';
    case 'ACTIVE':
      return end ? `This piece is covered by the ORBES warranty until ${end}.` : 'This piece is covered by the ORBES warranty.';
    case 'EXPIRED':
      return 'The warranty period of this piece has ended. ORBES Client Services remains at your disposal for care and repair.';
    case 'VOID':
      return 'The ORBES warranty no longer applies to this piece. Please contact ORBES Client Services.';
  }
}

const ASSURANCE_LABEL = Object.freeze({
  CODE: 'PRINTED CODE',
  CODE_ONLY: 'PRINTED CODE ONLY',
  CODE_AND_HARDWARE: 'PRINTED CODE AND SECURE HARDWARE',
});

const SYMBOLS: Readonly<Record<string, string>> = Object.freeze({ EUR: '€', GBP: '£', USD: '$', CHF: 'CHF' });
const NBSP = ' ';

/** A price as the house writes it: `€ 4 800`, `€ 4 800.50`; the groups never break across lines. */
export function formatMoney(minor: number, currency: string): string {
  const value = Number.isFinite(minor) ? Math.max(0, Math.round(minor)) : 0;
  const units = Math.floor(value / 100);
  const cents = value % 100;
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  return `${SYMBOLS[code] ?? code}${NBSP}${grouped}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

export function upper(s: string | undefined | null): string {
  return (s ?? '').trim().toUpperCase();
}

/** Contract §4: exactly MODEL / TYPE / CATEGORY / MATERIAL / CREATED (the size belongs to the rows), as a result and MY PIECES show them. */
export function productLines(p: {
  model: string;
  type: string;
  category?: { name: string } | null;
  material: string;
  createdYear?: number | null;
  discontinuedYear?: number | null;
}): string[] {
  const discontinued = discontinuedYearOf(p.discontinuedYear);
  return [
    upper(p.model),
    upper(p.type),
    upper(p.category?.name),
    upper(p.material),
    p.createdYear ? `CREATED ${p.createdYear}` : '',
    // P-R06: last, under CREATED, when its model was discontinued.
    discontinued !== null ? DISCONTINUED.line(discontinued) : '',
  ].filter((x) => x.length > 0);
}

/**
 * The lines under a result's model name (NOCTURNE, C9 and addition 1): TYPE / CATEGORY / MATERIAL, the piece's size
 * as written at issuance (SIZE 17), CREATED YYYY, then DISCONTINUED · YYYY when its model was (P-R06).
 */
export function pieceLines(p: {
  type: string;
  category?: { name: string } | null;
  material: string;
  variant?: string | null;
  createdYear?: number | null;
  discontinuedYear?: number | null;
}): string[] {
  const discontinued = discontinuedYearOf(p.discontinuedYear);
  const size = upper(p.variant);
  return [
    upper(p.type),
    upper(p.category?.name),
    upper(p.material),
    // A value written with its word already (« Size 17 ») is not named twice.
    size ? (/^SIZE\b/.test(size) ? size : `SIZE ${size}`) : '',
    p.createdYear ? `CREATED ${p.createdYear}` : '',
    discontinued !== null ? DISCONTINUED.line(discontinued) : '',
  ].filter((x) => x.length > 0);
}

/** The year a model was discontinued (P-R06), when the server sent one that is a year; else null (nothing is said). */
export function discontinuedYearOf(year: unknown): number | null {
  return typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
}

/** The WARRANTY rows and their sentence, on a result and in MY PIECES; undefined for a status the app does not know. */
export function warrantyModel(w: { status: WarrantyStatus; startDate?: string; endDate?: string } | undefined | null): { status: string; rows: Row[]; note: string } | undefined {
  if (!w || !WARRANTY_STATUS[w.status]) return undefined;
  const rows: Row[] = [['STATUS', WARRANTY_STATUS[w.status]]];
  if (w.startDate) rows.push(['FROM', formatDate(w.startDate)]);
  if (w.endDate) rows.push(['UNTIL', formatDate(w.endDate)]);
  return { status: WARRANTY_STATUS[w.status], rows, note: warrantyNote(w.status, formatDateLong(w.endDate)) };
}

/** Eight glyph indices of 0 to 15, as GENOME-01 defines them: anything else is not drawn. */
export function validGlyphs(glyphs: unknown): glyphs is number[] {
  return Array.isArray(glyphs) && glyphs.length === 8 && glyphs.every((x) => Number.isInteger(x) && x >= 0 && x <= 15);
}

function genomeVersionNumber(version: string): number {
  const m = /(\d+)$/.exec(version || '');
  return m ? Number(m[1]) : 1;
}

/**
 * Build the result screen from a verification outcome. `clientServices` (GET /api/v1/client-services)
 * adds the email of ORBES Client Services under FORGOTTEN PASSWORD? (CS-01: everywhere else, the button). `receivedAt` (this device's
 * clock, ms) is when the outcome arrived: the windows of the scan (registration, transfer) then end on
 * this device's clock 15 minutes after it, as they do on the server's after `verifiedAt`, whatever the
 * gap between the two clocks; without it, they end at the server's `expiresAt` as written. `ceremony` (P-D01): this
 * result is the one VIEW AS OWNER opens right after a first registration.
 */
export function resultViewModel(
  outcome: VerifyOutcome,
  opts: { offsetMinutes?: number; clientServices?: ClientServices; receivedAt?: number; ceremony?: boolean } = {},
): ResultViewModel {
  const state: VerificationState = VERIFICATION_STATES.includes(outcome.state) ? outcome.state : 'MALFORMED_CODE';
  const authentic = AUTHENTIC.has(state);
  const title = splitTitle(outcome.title || FALLBACK_TITLES[state]);
  const vm: ResultViewModel = {
    state,
    tone: toneOf(state),
    titleMain: title.main,
    message: outcome.message || '',
    photos: [],
    productLines: [],
    pieceLines: [],
    tabs: [],
    productRows: [],
    verificationRows: [],
    care: DEFAULT_CARE,
    ownership: { kind: 'unregistered' },
    verifiedAt: outcome.verifiedAt ? formatDateTime(outcome.verifiedAt, opts.offsetMinutes ?? 0) : '',
    reference: shortReference(outcome.scanId),
  };
  if (title.sub) vm.titleSub = title.sub;
  // Said once: the server's owner message already carries the sentence; the notice only covers a message that does not.
  if (outcome.notice === 'UNUSUAL_ACTIVITY' && !/unusual activity/i.test(vm.message)) {
    vm.notice = 'Unusual activity has been recorded for this identity. ORBES Client Services can assist you.';
  }

  // GENOME: shown whenever the server sends it (authentic, suspicious, revoked).
  const g = outcome.genome;
  if (g && validGlyphs(g.glyphs)) {
    vm.genome = {
      id: g.id,
      version: g.version,
      versionNumber: genomeVersionNumber(g.version),
      fingerprint: g.fingerprint,
      glyphs: [...g.glyphs],
      ids: Array.isArray(g.ids) ? [...g.ids] : [],
    };
  }

  const p = outcome.product;
  if (authentic && p) {
    vm.productLines = productLines(p);
    vm.pieceLines = pieceLines(p);
    if (upper(p.model)) vm.modelName = upper(p.model);
    const rows: Row[] = [['PRODUCT ID', p.productId]];
    if (p.collection) rows.push(['COLLECTION', upper(p.collection)]);
    rows.push(['MODEL', upper(p.model)], ['TYPE', upper(p.type)]);
    // The piece's free-text field set at issuance, its size (NOCTURNE N1: SIZE, formerly VARIANT), as written.
    if (p.variant) rows.push(['SIZE', upper(p.variant)]);
    rows.push(['CATEGORY', upper(p.category?.name)], ['MATERIAL', upper(p.material)], ['CREATED', String(p.createdYear)]);
    if (p.productionDate) rows.push(['PRODUCTION DATE', formatDate(p.productionDate)]);
    const discontinued = discontinuedYearOf(p.discontinuedYear);
    if (discontinued !== null) rows.push([DISCONTINUED.row, String(discontinued)]);
    vm.productRows = rows;
    if (p.care && p.care.trim()) vm.care = p.care.trim();
    vm.tabs = ['product', 'warranty', 'care', 'ownership'];
    // The server sends them on authentic results only; the client shows them nowhere else either.
    vm.photos = photoModels(p);
    // SEE THE MODEL (P-R02): the sheet of a model shown in THE COLLECTION, when the server names one.
    if (isLookbookSlug(p.lookbook)) vm.lookbook = p.lookbook;
  }

  const v = outcome.verification;
  if (v) {
    vm.verificationRows = [
      ['SIGNATURE', `VALID · ORBES KEY ${String(v.keyId).padStart(2, '0')}`],
      ['CODE', `${upper(v.codeVersion)} · ISSUE ${v.issue}`],
      ['GENOME', upper(v.genomeVersion)],
      ['ISSUED', formatDate(v.issuedAt)],
      ['ASSURANCE', ASSURANCE_LABEL[v.assurance] ?? upper(v.assurance)],
    ];
    if (v.hardwareProofRequired) {
      vm.assuranceNote = 'This piece is designed to be confirmed with an additional secure hardware check, which this scan could not include.';
    }
  }

  if (authentic) {
    const warranty = warrantyModel(outcome.warranty);
    if (warranty) vm.warranty = warranty;
    vm.ownership = ownershipMode(outcome, clockShift(outcome, opts.receivedAt));
    vm.footnote = ASSURANCE_NOTE;
    // P-D01: the piece just registered, read again as its owner's. Nothing to celebrate on a piece that is not the
    // reader's (another account signed in meanwhile), nor without the GENOME it reveals or the model it names.
    const name = upper(p?.model);
    if (opts.ceremony === true && vm.ownership.kind === 'yours' && vm.genome && name) {
      const collection = upper(p?.collection);
      vm.ceremony = collection ? { name, collection } : { name };
      // BP-10: the REGISTERED card, the day of this reading as its owner, right after the registration.
      vm.story = { photo: vm.photos[0]?.src ?? null, model: p?.model, variant: p?.modelVariant ?? null, type: p?.type, collection: p?.collection, at: outcome.verifiedAt, zone: opts.offsetMinutes ?? 0 };
    }
    // J-02: a registered piece reads the same for its owner signed out and for every copy of its code, so a buyer is
    // told what shows that the seller holds the registration. AUTHENTIC — REGISTERED only, and never over a notice of
    // unusual activity (said by the notice or by the server's message): that one comes first.
    if (state === 'AUTHENTIC_REGISTERED' && outcome.notice !== 'UNUSUAL_ACTIVITY' && vm.notice === undefined) {
      vm.notice = RESALE_GUIDANCE;
      if (vm.ownership.kind === 'registered' && vm.tabs.includes('ownership')) vm.noticeLink = { label: RESALE_ACTION, tab: 'ownership' };
    }
  } else if (state === 'SUSPICIOUS_ACTIVITY') {
    // The holder of the certificate card may still register, and the holder of a transfer code receive the piece
    // (no tabs, no product data): see ownershipMode.
    vm.ownership = ownershipMode(outcome, clockShift(outcome, opts.receivedAt));
  }

  // Wherever the copy sends the customer to ORBES Client Services: every caution and void result, and a warranty that
  // no longer applies. The button attaches the scan (a staff scan, which the server refuses to attach, nothing).
  const placement = !authentic ? 'help' : vm.warranty && outcome.warranty?.status === 'VOID' ? 'warranty' : null;
  if (placement) {
    const scanId = outcome.staffScan !== true && SCAN_ID.test(outcome.scanId ?? '') ? outcome.scanId.toLowerCase() : null;
    vm.write = {
      placement,
      context: scanId ? (placement === 'warranty' ? warrantyContext(scanId, vm.reference, state) : scanContext(scanId, vm.reference, state)) : null,
    };
  }
  // Wherever the OWNERSHIP panel may offer sign-in, FORGOTTEN PASSWORD? leads to Client Services (C-04).
  if (vm.ownership.kind !== 'unregistered') {
    const recovery = recoveryContactModel(opts.clientServices, vm.reference);
    if (recovery) vm.recoveryContact = recovery;
  }
  // The customer may say where the piece was seen or bought, attached to this scan: results that were not authentic,
  // scanned as a customer. A staff scan (a browser signed in to the console, S-07) takes no report: the server would
  // refuse it, and scanning again in this browser would only make another staff scan.
  if (!authentic && outcome.staffScan !== true && SCAN_ID.test(outcome.scanId ?? '')) {
    vm.report = { scanId: outcome.scanId.toLowerCase(), reference: vm.reference };
  }
  return vm;
}

const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The email of ORBES Client Services with `subject`, whose body leaves the customer room to write above the facts that
 * have a value (RFC 6068 wants CRLF line breaks in a mailto body). The only mailto: of the collector app, for
 * recoveryContactModel alone (CS-01).
 */
function contactOf(lines: ContactLines, subject: string, facts: [string, string][]): ContactModel {
  const contact: ContactModel = { placement: 'recovery' };
  if (lines.email) {
    const body = ['', '', ...facts.filter(([, value]) => value.length > 0).map(([label, value]) => `${label}: ${value}`)].join('\r\n');
    contact.mailto = `mailto:${lines.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  return contact;
}

/**
 * ORBES Client Services for a customer who forgot the password (C-04): they check the customer's identity, then give a
 * one-time recovery code. The email's subject says why; its body carries the reference of the scan on screen, which
 * helps Client Services find the piece and its owner. Null without an email: the phone and the hours are no longer shown
 * in the collector app (CS-01).
 */
export function recoveryContactModel(cs: ClientServices | undefined, reference: string): ContactModel | null {
  const lines = cs ? contactLines(cs) : null;
  return lines?.email ? contactOf(lines, CONTACT.recoverySubject, [[CONTACT.reference, reference]]) : null;
}

/**
 * How far this device's clock is ahead of the server's (ms, negative when behind), measured when the outcome arrived
 * (`receivedAt`) against the server's time of the scan (`verifiedAt`); 0 when either is unknown. It includes the
 * moment the answer took to arrive, so a window never ends on the device before it does on the server.
 */
function clockShift(o: VerifyOutcome, receivedAt: number | undefined): number {
  const server = typeof o.verifiedAt === 'string' ? Date.parse(o.verifiedAt) : Number.NaN;
  return receivedAt !== undefined && Number.isFinite(receivedAt) && Number.isFinite(server) ? receivedAt - server : 0;
}

/** A window's end on this device's clock: the server's expiry moved by `shift` (clockShift); as written when 0. */
function onDeviceClock(expiresAt: string, shift: number): string {
  const t = Date.parse(expiresAt);
  return shift === 0 || !Number.isFinite(t) ? expiresAt : new Date(t + shift).toISOString();
}

/** The scan's transfer window (F-03), when the server sent a usable one, its end on this device's clock. */
function transferWindow(o: VerifyOutcome, shift: number): { token: string; expiresAt: string } | undefined {
  const t = o.transfer;
  return t && typeof t.token === 'string' && t.token !== '' && typeof t.expiresAt === 'string' ? { token: t.token, expiresAt: onDeviceClock(t.expiresAt, shift) } : undefined;
}

const PRODUCT_ID = /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/;

function ownershipMode(o: VerifyOutcome, shift = 0): OwnershipMode {
  const productId = o.product?.productId ?? '';
  const reg = o.registration;
  if (o.state === 'SUSPICIOUS_ACTIVITY') {
    // The server's rule (verification.ts, step 10): a token on an unusual activity result is usable
    // with the claim code of the certificate card only. A token without that requirement is ignored.
    if (reg?.token && reg.claimCodeRequired === true) {
      return { kind: 'register', token: reg.token, expiresAt: onDeviceClock(reg.expiresAt, shift), claimCodeRequired: true, underReview: true };
    }
    // F-03, the same exception for a transfer: unusual activity from the scan history alone, a transfer pending, a
    // signed-in reader who is not the owner. The piece is the one the GENOME names (no product data on this result).
    const t = transferWindow(o, shift);
    const piece = o.genome?.id ?? '';
    if (t && PRODUCT_ID.test(piece)) return { kind: 'registered', productId: piece, transferPending: true, transfer: t, underReview: true };
    return { kind: 'unregistered' };
  }
  if (o.state === 'AUTHENTIC_FIRST_REGISTRATION') {
    // A browser signed in to the console: the server recorded a staff scan and issued no token.
    if (o.staffScan === true) return { kind: 'staff' };
    if (reg?.token) {
      return { kind: 'register', token: reg.token, expiresAt: onDeviceClock(reg.expiresAt, shift), claimCodeRequired: reg.claimCodeRequired === true, underReview: false };
    }
    // No token otherwise: nothing to register with.
    return { kind: 'unregistered' };
  }
  const own = o.ownership;
  if (own?.you) return { kind: 'yours', productId, transferPending: own.transferPending === true };
  if (own?.registered) {
    const transferPending = own.transferPending === true;
    // S-07: a staff scan never earns a transfer window, and VERIFY AGAIN in this browser would be another staff scan.
    if (transferPending && o.staffScan === true) return { kind: 'registered', productId, transferPending, staff: true };
    // F-03: the server's transfer window of this scan, only beside the pending transfer it is for.
    const t = transferPending ? transferWindow(o, shift) : undefined;
    return { kind: 'registered', productId, transferPending, ...(t ? { transfer: t } : {}) };
  }
  return { kind: 'unregistered' };
}

/**
 * The tab a result opens on: OWNERSHIP when it offers what the reader most likely scanned for, a first
 * registration (the scan's token) or the transfer of the piece to them (F-03: the scan's transfer window,
 * given to a signed-in reader who is not the owner while a transfer is pending); PRODUCT otherwise.
 */
export function initialTab(vm: Pick<ResultViewModel, 'ownership'>): TabId {
  const m = vm.ownership;
  return m.kind === 'register' || (m.kind === 'registered' && m.transfer !== undefined) ? 'ownership' : 'product';
}

/** The only URLs a photograph may come from: this origin's media route, named by a SHA-256 (the story card's too, story-card.ts). */
export const MEDIA_URL = /^\/api\/v1\/media\/[0-9a-f]{64}$/;

/**
 * The photograph of a piece (F-04): its model's reference photograph (or its variant's, NOCTURNE N1), what the customer
 * compares with the piece in hand, with the alternative text a screen reader says, which names the model and its
 * variant, never the piece (plan NOCTURNE, decision 9: no photograph of the piece itself). Shared with the owner's list
 * of pieces, whose items carry the same URL (null there when absent). A URL that is not this origin's media route is
 * dropped.
 */
export function photoModels(p: { model: string; type: string; modelVariant?: string | null; imageUrl?: string | null }): PhotoModel[] {
  if (typeof p.imageUrl !== 'string' || !MEDIA_URL.test(p.imageUrl)) return [];
  return [{ kind: 'model', src: p.imageUrl, alt: PHOTOS.modelAlt(upper(p.model), upper(p.type), p.modelVariant), caption: PHOTOS.model }];
}

/**
 * A model named with its variant, as a sentence names it (NOCTURNE N1): « MONOLITHE in blue »; the model alone when it
 * has no variant's label. `name` is given as it is to be shown (a title in capitals).
 */
export function modelWithVariant(name: string, variant: string | null | undefined): string {
  const v = typeof variant === 'string' ? variant.trim().replace(/\s+/g, ' ') : '';
  return v ? `${name} in ${v.toLowerCase()}` : name;
}

/**
 * Whether a registration window (ISO expiry) is still open at `now` (ms); the same for a transfer window (F-03). Both
 * are on this device's clock: the modes of resultViewModel carry the server's expiry moved by the gap between the
 * clocks, so a device whose clock is wrong by minutes still offers the form for the 15 minutes of the scan.
 */
export function registrationOpen(expiresAt: string, now: number): boolean {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > now;
}

/** Heading of the OWNERSHIP panel's registration block: never "open" once the scan's window has closed. */
export function registrationStatus(expiresAt: string, now: number): 'REGISTRATION OPEN' | 'REGISTRATION CLOSED' {
  return registrationOpen(expiresAt, now) ? 'REGISTRATION OPEN' : 'REGISTRATION CLOSED';
}

/** Normalise a claim / transfer code as typed: uppercase, Crockford look-alikes kept, grouped XXXX-XXXX-XXXX. */
export function normalizeCodeInput(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
  return chars.replace(/(.{4})(?=.)/g, '$1-');
}
