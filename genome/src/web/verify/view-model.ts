/**
 * Result view-model: a VerifyOutcome (server) → what the result screen shows.
 *
 * Pure (no DOM) and unit-tested. The server decides the state and writes the
 * title and message; this module only arranges them: which sections appear,
 * how product facts read as brand lines, which tabs exist and what the
 * ownership tab offers (or, on an UNUSUAL ACTIVITY result that carries a
 * registration token, the certificate-card section). It never infers
 * anything the server did not say (no internal statuses, no scores), and it
 * never upgrades a state.
 */
import { ASSURANCE_NOTE, DEFAULT_CARE, FALLBACK_TITLES } from './copy.js';
import { VERIFICATION_STATES, type VerificationState, type VerifyOutcome, type WarrantyStatus } from './types.js';

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
  /** Someone else owns it; the viewer may hold a transfer code. */
  | { kind: 'registered'; productId: string; transferPending: boolean }
  /** No owner and registration is not open (e.g. not yet delivered by a retailer). */
  | { kind: 'unregistered' };

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
  /** Extra line for the owner when unusual activity was recorded elsewhere. */
  notice?: string;
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

function upper(s: string | undefined | null): string {
  return (s ?? '').trim().toUpperCase();
}

function genomeVersionNumber(version: string): number {
  const m = /(\d+)$/.exec(version || '');
  return m ? Number(m[1]) : 1;
}

/** Build the result screen from a verification outcome. */
export function resultViewModel(outcome: VerifyOutcome, opts: { offsetMinutes?: number } = {}): ResultViewModel {
  const state: VerificationState = VERIFICATION_STATES.includes(outcome.state) ? outcome.state : 'MALFORMED_CODE';
  const authentic = AUTHENTIC.has(state);
  const title = splitTitle(outcome.title || FALLBACK_TITLES[state]);
  const vm: ResultViewModel = {
    state,
    tone: toneOf(state),
    titleMain: title.main,
    message: outcome.message || '',
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
  if (g && Array.isArray(g.glyphs) && g.glyphs.length === 8 && g.glyphs.every((x) => Number.isInteger(x) && x >= 0 && x <= 15)) {
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
    // Contract §4: exactly MODEL / TYPE / CATEGORY / MATERIAL / CREATED; the variant belongs to the PRODUCT tab.
    vm.productLines = [upper(p.model), upper(p.type), upper(p.category?.name), upper(p.material), p.createdYear ? `CREATED ${p.createdYear}` : '']
      .filter((x) => x.length > 0);
    const rows: Row[] = [['PRODUCT ID', p.productId]];
    if (p.collection) rows.push(['COLLECTION', upper(p.collection)]);
    rows.push(['MODEL', upper(p.model)], ['TYPE', upper(p.type)]);
    if (p.variant) rows.push(['VARIANT', upper(p.variant)]);
    rows.push(['CATEGORY', upper(p.category?.name)], ['MATERIAL', upper(p.material)], ['CREATED', String(p.createdYear)]);
    if (p.productionDate) rows.push(['PRODUCTION DATE', formatDate(p.productionDate)]);
    vm.productRows = rows;
    if (p.care && p.care.trim()) vm.care = p.care.trim();
    vm.tabs = ['product', 'warranty', 'care', 'ownership'];
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
    const w = outcome.warranty;
    if (w && WARRANTY_STATUS[w.status]) {
      const rows: Row[] = [['STATUS', WARRANTY_STATUS[w.status]]];
      if (w.startDate) rows.push(['FROM', formatDate(w.startDate)]);
      if (w.endDate) rows.push(['UNTIL', formatDate(w.endDate)]);
      vm.warranty = { status: WARRANTY_STATUS[w.status], rows, note: warrantyNote(w.status, formatDateLong(w.endDate)) };
    }
    vm.ownership = ownershipMode(outcome);
    vm.footnote = ASSURANCE_NOTE;
  } else if (state === 'SUSPICIOUS_ACTIVITY') {
    // The holder of the certificate card may still register (no tabs, no product data): see ownershipMode.
    vm.ownership = ownershipMode(outcome);
  }
  return vm;
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
  if (o.state === 'AUTHENTIC_FIRST_REGISTRATION' && reg?.token) {
    return { kind: 'register', token: reg.token, expiresAt: reg.expiresAt, claimCodeRequired: reg.claimCodeRequired === true, underReview: false };
  }
  const own = o.ownership;
  if (own?.you) return { kind: 'yours', productId, transferPending: own.transferPending === true };
  if (own?.registered) return { kind: 'registered', productId, transferPending: own.transferPending === true };
  return { kind: 'unregistered' };
}

/** Whether a registration window (ISO expiry) is still open at `now` (ms). */
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
