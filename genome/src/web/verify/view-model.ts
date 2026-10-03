/**
 * Result view-model: a VerifyOutcome (server) → what the result screen shows.
 *
 * Pure (no DOM) and unit-tested. The server decides the state and writes the
 * title and message; this module only arranges them: which sections appear,
 * the notice under the message (unusual activity for the owner, or, under
 * AUTHENTIC — REGISTERED, the second-hand guidance of J-02 and its link to
 * RECEIVING THIS PIECE),
 * the photographs of an authentic piece (F-04: its own, then its model's),
 * how product facts read as brand lines, which tabs exist and what the
 * ownership tab offers (or, on an UNUSUAL ACTIVITY result that carries a
 * registration token, the certificate-card section), where ORBES Client
 * Services is offered, with its prefilled email, and whether the customer
 * may say where the piece was seen or bought (a result that was not
 * authentic). It never infers
 * anything the server did not say (no internal statuses, no scores), and it
 * never upgrades a state.
 */
import { ASSURANCE_NOTE, CONTACT, DEFAULT_CARE, FALLBACK_TITLES, PHOTOS, RESALE_ACTION, RESALE_GUIDANCE } from './copy.js';
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
   * accepted for this piece only, with this scan.
   */
  | { kind: 'registered'; productId: string; transferPending: boolean; transfer?: { token: string; expiresAt: string } }
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
   */
  | { kind: 'account' };

/**
 * ORBES Client Services, offered where the result asks the customer to contact it: under the
 * help line of every caution and void result, and in the WARRANTY tab when the warranty no
 * longer applies; under FORGOTTEN PASSWORD? in the OWNERSHIP panel, where Client Services
 * gives the one-time recovery code (C-04); and in MY PIECES, under a report only Client
 * Services can withdraw (a theft, or a loss they recorded: F-01). Built from GET
 * /api/v1/client-services; absent when neither a usable email nor a usable phone is configured.
 */
export interface ContactModel {
  placement: 'help' | 'warranty' | 'recovery' | 'piece';
  /**
   * mailto: with the subject "ORBES — REF {ref} — {title}" and a body prefilled with the reference, the result and
   * the time; for a forgotten password, the subject "ORBES — FORGOTTEN PASSWORD" and the reference; for a piece of
   * MY PIECES, the subject "ORBES — {product id} — {status}" and the piece.
   */
  mailto?: string;
  /** The number as configured, and its tel: link. */
  phone?: { label: string; href: string };
  hours?: string;
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
 * A photograph shown above the GENOME of an authentic result (F-04), on its ivory plate: the piece's own (taken by
 * ORBES at issuance) or its model's reference photograph. `src` is always a path of this origin's media route.
 */
export interface PhotoModel {
  kind: 'piece' | 'model';
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
  genome?: GenomeModel;
  /** Brand lines: MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY. */
  productLines: string[];
  tabs: TabId[];
  productRows: Row[];
  verificationRows: Row[];
  assuranceNote?: string;
  warranty?: { status: string; rows: Row[]; note: string };
  care: string;
  ownership: OwnershipMode;
  /** Footnote on the limits of a code-based verification (positive results only). */
  footnote?: string;
  /** "1 OCT 2026 · 14:32" in the viewer's time zone. */
  verifiedAt: string;
  /** Short scan reference for Client Services. */
  reference: string;
  /** How to reach ORBES Client Services, where the result asks for it (and Client Services is configured). */
  contact?: ContactModel;
  /** The same contact for a customer who forgot the password (OWNERSHIP panel, FORGOTTEN PASSWORD?), when configured. */
  recoveryContact?: ContactModel;
  /** Where the piece was seen or bought: results that were not authentic only. */
  report?: ReportModel;
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

export function upper(s: string | undefined | null): string {
  return (s ?? '').trim().toUpperCase();
}

/** Contract §4: exactly MODEL / TYPE / CATEGORY / MATERIAL / CREATED (the variant belongs to the rows), as a result and MY PIECES show them. */
export function productLines(p: { model: string; type: string; category?: { name: string } | null; material: string; createdYear?: number | null }): string[] {
  return [upper(p.model), upper(p.type), upper(p.category?.name), upper(p.material), p.createdYear ? `CREATED ${p.createdYear}` : ''].filter((x) => x.length > 0);
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
 * adds the contact of ORBES Client Services where the result asks for it.
 */
export function resultViewModel(outcome: VerifyOutcome, opts: { offsetMinutes?: number; clientServices?: ClientServices } = {}): ResultViewModel {
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
    const rows: Row[] = [['PRODUCT ID', p.productId]];
    if (p.collection) rows.push(['COLLECTION', upper(p.collection)]);
    rows.push(['MODEL', upper(p.model)], ['TYPE', upper(p.type)]);
    if (p.variant) rows.push(['VARIANT', upper(p.variant)]);
    rows.push(['CATEGORY', upper(p.category?.name)], ['MATERIAL', upper(p.material)], ['CREATED', String(p.createdYear)]);
    if (p.productionDate) rows.push(['PRODUCTION DATE', formatDate(p.productionDate)]);
    vm.productRows = rows;
    if (p.care && p.care.trim()) vm.care = p.care.trim();
    vm.tabs = ['product', 'warranty', 'care', 'ownership'];
    // The server sends them on authentic results only; the client shows them nowhere else either.
    vm.photos = photoModels(p);
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
    vm.ownership = ownershipMode(outcome);
    vm.footnote = ASSURANCE_NOTE;
    // J-02: a registered piece reads the same for its owner signed out and for every copy of its code, so a buyer is
    // told what shows that the seller holds the registration. AUTHENTIC — REGISTERED only, and never over a notice of
    // unusual activity (said by the notice or by the server's message): that one comes first.
    if (state === 'AUTHENTIC_REGISTERED' && outcome.notice !== 'UNUSUAL_ACTIVITY' && vm.notice === undefined) {
      vm.notice = RESALE_GUIDANCE;
      if (vm.ownership.kind === 'registered' && vm.tabs.includes('ownership')) vm.noticeLink = { label: RESALE_ACTION, tab: 'ownership' };
    }
  } else if (state === 'SUSPICIOUS_ACTIVITY') {
    // The holder of the certificate card may still register (no tabs, no product data): see ownershipMode.
    vm.ownership = ownershipMode(outcome);
  }

  // Wherever the copy sends the customer to ORBES Client Services: every caution and void result, and
  // a warranty that no longer applies. Nothing when Client Services is not configured.
  const placement = !authentic ? 'help' : vm.warranty && outcome.warranty?.status === 'VOID' ? 'warranty' : null;
  if (placement && opts.clientServices) {
    const contact = contactModel(opts.clientServices, vm, placement, opts.offsetMinutes ?? 0);
    if (contact) vm.contact = contact;
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

/** The same rules as the server's CLIENT_SERVICES_* (config.ts), checked again before anything becomes a link. */
const MAILBOX = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const PHONE = /^\+[1-9](?:[ .-]?[0-9]){6,14}$/;
const HOURS = /^[^\p{Cc}]{1,120}$/u;

/** The usable lines of GET /api/v1/client-services; null when neither an email nor a phone is usable. */
function contactLines(cs: ClientServices): { email?: string; phone?: string; hours?: string } | null {
  const text = (v: unknown, re: RegExp, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length <= max && re.test(t) ? t : undefined;
  };
  const email = text(cs.email, MAILBOX, 254);
  const phone = text(cs.phone, PHONE, 32);
  if (!email && !phone) return null;
  const hours = text(cs.hours, HOURS, 120);
  return { ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(hours ? { hours } : {}) };
}

/**
 * The contact: an email with `subject`, whose body leaves the customer room to write above the facts that
 * have a value (RFC 6068 wants CRLF line breaks in a mailto body), then the phone and the hours.
 */
function contactOf(lines: { email?: string; phone?: string; hours?: string }, placement: ContactModel['placement'], subject: string, facts: [string, string][]): ContactModel {
  const contact: ContactModel = { placement };
  if (lines.email) {
    const body = ['', '', ...facts.filter(([, value]) => value.length > 0).map(([label, value]) => `${label}: ${value}`)].join('\r\n');
    contact.mailto = `mailto:${lines.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  if (lines.phone) contact.phone = { label: lines.phone, href: `tel:+${lines.phone.replace(/\D/g, '')}` };
  if (lines.hours) contact.hours = lines.hours;
  return contact;
}

function contactModel(cs: ClientServices, vm: ResultViewModel, placement: ContactModel['placement'], offsetMinutes: number): ContactModel | null {
  const lines = contactLines(cs);
  if (!lines) return null;
  const title = vm.titleSub ? `${vm.titleMain} — ${vm.titleSub}` : vm.titleMain;
  const subject = ['ORBES', vm.reference ? `REF ${vm.reference}` : '', title].filter((x) => x.length > 0).join(' — ');
  // The time is the one on the customer's screen, in their own zone, so the email names its offset from UTC.
  return contactOf(lines, placement, subject, [
    [CONTACT.reference, vm.reference],
    [CONTACT.result, title],
    [CONTACT.warranty, placement === 'warranty' ? (vm.warranty?.status ?? '') : ''],
    [CONTACT.verified, vm.verifiedAt ? `${vm.verifiedAt} (${utcOffsetLabel(offsetMinutes)})` : ''],
  ]);
}

/**
 * ORBES Client Services for a customer who forgot the password (C-04): they check the customer's identity,
 * then give a one-time recovery code. The email's subject says why; its body carries the reference of the
 * scan on screen, which helps Client Services find the piece and its owner. Null when nothing is configured.
 */
export function recoveryContactModel(cs: ClientServices | undefined, reference: string): ContactModel | null {
  const lines = cs ? contactLines(cs) : null;
  return lines ? contactOf(lines, 'recovery', CONTACT.recoverySubject, [[CONTACT.reference, reference]]) : null;
}

/**
 * ORBES Client Services for a piece of MY PIECES whose report only they withdraw (a theft, or a loss they recorded,
 * F-01): the email's subject names the piece and its status line, its body the piece. Null when nothing is configured.
 */
export function pieceContactModel(cs: ClientServices | undefined, productId: string, status: string): ContactModel | null {
  const lines = cs ? contactLines(cs) : null;
  return lines ? contactOf(lines, 'piece', ['ORBES', productId, status].filter((x) => x.length > 0).join(' — '), [[CONTACT.piece, productId]]) : null;
}

function ownershipMode(o: VerifyOutcome): OwnershipMode {
  const productId = o.product?.productId ?? '';
  const reg = o.registration;
  if (o.state === 'SUSPICIOUS_ACTIVITY') {
    // The server's rule (verification.ts, step 10): a token on an unusual activity result is usable
    // with the claim code of the certificate card only. A token without that requirement is ignored.
    if (reg?.token && reg.claimCodeRequired === true) {
      return { kind: 'register', token: reg.token, expiresAt: reg.expiresAt, claimCodeRequired: true, underReview: true };
    }
    return { kind: 'unregistered' };
  }
  if (o.state === 'AUTHENTIC_FIRST_REGISTRATION') {
    // A browser signed in to the console: the server recorded a staff scan and issued no token.
    if (o.staffScan === true) return { kind: 'staff' };
    if (reg?.token) {
      return { kind: 'register', token: reg.token, expiresAt: reg.expiresAt, claimCodeRequired: reg.claimCodeRequired === true, underReview: false };
    }
    // No token otherwise: nothing to register with.
    return { kind: 'unregistered' };
  }
  const own = o.ownership;
  if (own?.you) return { kind: 'yours', productId, transferPending: own.transferPending === true };
  if (own?.registered) {
    const transferPending = own.transferPending === true;
    // F-03: the server's transfer window of this scan, only beside the pending transfer it is for.
    const t = o.transfer;
    const scanWindow = transferPending && t && typeof t.token === 'string' && t.token !== '' && typeof t.expiresAt === 'string' ? { transfer: { token: t.token, expiresAt: t.expiresAt } } : {};
    return { kind: 'registered', productId, transferPending, ...scanWindow };
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

/** The only URLs a photograph may come from: this origin's media route, named by a SHA-256. */
const MEDIA_URL = /^\/api\/v1\/media\/[0-9a-f]{64}$/;

/**
 * The photographs of a piece (F-04), its own first (what the customer compares with the piece in hand), then its
 * model's reference photograph; each with the alternative text a screen reader says. Shared with the owner's list of
 * pieces, whose items carry the same two URLs (null there when absent). A URL that is not this origin's media route
 * is dropped.
 */
export function photoModels(p: { productId: string; model: string; type: string; imageUrl?: string | null; photoUrl?: string | null }): PhotoModel[] {
  const out: PhotoModel[] = [];
  if (typeof p.photoUrl === 'string' && MEDIA_URL.test(p.photoUrl)) {
    out.push({ kind: 'piece', src: p.photoUrl, alt: PHOTOS.pieceAlt(p.productId), caption: PHOTOS.piece });
  }
  if (typeof p.imageUrl === 'string' && MEDIA_URL.test(p.imageUrl)) {
    out.push({ kind: 'model', src: p.imageUrl, alt: PHOTOS.modelAlt(upper(p.model), upper(p.type)), caption: PHOTOS.model });
  }
  return out;
}

/** Whether a registration window (ISO expiry) is still open at `now` (ms); the same for a transfer window (F-03). */
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
