/**
 * The club's tier at the head of MY PIECES (P-X04) — pure, no DOM.
 *
 * From GET /api/v1/club/status: the badge (the tier's name, set in the display
 * face, and the pieces it counts, in the reading face), the benefits of the
 * tier and of those below it, and the way to the next tier (how many more
 * pieces, from how many it starts, what it adds); PALLADIUM says it is the
 * highest. An account without a tier reads what its first piece opens. What
 * the server sends is read defensively: a missing or malformed field shows
 * less, never something wrong.
 *
 * The meter (plan NEXT-NINE, BP-19 T1): one dot per piece up to PALLADIUM,
 * TIER_DOTS of them, the pieces PALLADIUM starts from as the status sends them
 * (`tierThresholds`, the server's CLUB_TIER_THRESHOLDS: 10); TIER_DOTS, the
 * same figure, only when the status does not say.
 *
 * IN USE (plan NEXT-NINE, BP-19 T10), shown only when a row exists: the CREDIT left and until when, the YEARLY CARE of
 * the year (no row when the tier gives none), a WELCOME GIFT while its tier has an active gift model (WITH YOUR NEXT
 * ORDER, then WITH ORDER OR-… until it is delivered). The program's lines come before the tiers' words, in the
 * benefits and in NEXT's.
 *
 * The BIRTHDAY CREDIT (plan CUSTOMER INTELLIGENCE §3.5 SB.4.5) is IN USE's first row while one is open, with what is
 * left and until when, as CREDIT reads. It is given to every account, piece or not: without a tier, IN USE shows that
 * row alone (the tiers' credit, care and gifts wait for their tier). The note under the rows shows with either credit.
 */
import { TIER } from './copy.js';
import type { ClubInUse, ClubStatus, ClubTierName, CreditChannel } from './types.js';
import { formatDate, formatMoney } from './view-model.js';

const NAMES: readonly ClubTierName[] = ['TITANE', 'PLATINE', 'PALLADIUM'];
/** The credit's channels in THE PROGRAM's order (the server's CREDIT_CHANNELS). */
const CREDIT_CHANNELS: readonly CreditChannel[] = ['DRAW', 'LIVE', 'SALON'];

/** The meter's dots when the status does not say: the pieces PALLADIUM starts from (the server's CLUB_TIER_THRESHOLDS[2], held equal by test/web/verify.tiers.test.ts). */
export const TIER_DOTS = 10;
/** At most this many dots, whatever the server sends. */
const TIER_DOTS_MAX = 20;

/** The meter's length: the last of the status's `tierThresholds` (PALLADIUM's), else TIER_DOTS. */
export function tierDotsOf(status: { tierThresholds?: unknown } | null | undefined): number {
  const t = status?.tierThresholds;
  const last = Array.isArray(t) && t.length === NAMES.length ? t[NAMES.length - 1] : undefined;
  return typeof last === 'number' && Number.isInteger(last) && last >= 1 && last <= TIER_DOTS_MAX ? last : TIER_DOTS;
}

export interface TierModel {
  /** The section's label: YOUR TIER, or THE CLUB before the first tier. */
  label: string;
  /** The badge: the tier's name and the pieces it counts; null without a tier. */
  badge: { name: ClubTierName; pieces: string } | null;
  /** The meter under the badge: `of` dots (TIER_DOTS), `on` of them filled (the pieces held, to `of`); null without a tier. */
  meter: { on: number; of: number } | null;
  /** The program's lines for the tier, then the words of the tier and of those below it, lowest first; [] without a tier. */
  benefits: string[];
  /** IN USE (BP-19 T10): its rows, and the credit's note when a credit (a tier's, the birthday's, a vault's or a warranty's) is in it; null when no row exists. */
  inUse: { label: string; rows: (readonly [string, string])[]; note: string | null } | null;
  /** The way to the next tier; null at the highest, or when the server did not say. */
  next: { label: string; sentence: string; benefits: string[] } | null;
  /** PALLADIUM: no tier above. */
  top: string | null;
  /** MY PIECES lists more pieces than the tier counts (one revoked or retired): the note that says why. */
  note: string | null;
}

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((l) => l.trim()) : []);
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

/** The tier block of MY PIECES; `listed` is the number of pieces the page shows (to explain a piece that counts for none). */
/** IN USE's rows from the status (BP-19 T10); null when none exists. */
export function inUseModel(u: ClubInUse | null | undefined): TierModel['inUse'] {
  if (!u || typeof u !== 'object') return null;
  const rows: (readonly [string, string])[] = [];
  const b = u.birthdayCredit;
  if (b && Number.isInteger(b.balanceMinor) && b.balanceMinor > 0 && typeof b.currency === 'string' && typeof b.expiresAt === 'string') {
    rows.push([TIER.birthdayCredit, TIER.creditValue(formatMoney(b.balanceMinor, b.currency), formatDate(b.expiresAt))]);
  }
  // A vault's credit (THE VAULT, lot Q3: "credits in YOUR ACCOUNT"), after the birthday credit, as they are taken; for an
  // account without a tier too.
  const v = u.vaultCredit;
  if (v && Number.isInteger(v.balanceMinor) && v.balanceMinor > 0 && typeof v.currency === 'string' && typeof v.expiresAt === 'string') {
    rows.push([TIER.vaultCredit, TIER.creditValue(formatMoney(v.balanceMinor, v.currency), formatDate(v.expiresAt))]);
  }
  // A warranty credit (plan ORBES CARE, answer 9), after the birthday credit; for an account without a tier too.
  const w = u.warrantyCredit;
  if (w && Number.isInteger(w.balanceMinor) && w.balanceMinor > 0 && typeof w.currency === 'string' && typeof w.expiresAt === 'string') {
    rows.push([TIER.warrantyCredit, TIER.creditValue(formatMoney(w.balanceMinor, w.currency), formatDate(w.expiresAt))]);
  }
  const c = u.credit;
  if (c && Number.isInteger(c.balanceMinor) && c.balanceMinor > 0 && typeof c.currency === 'string' && typeof c.expiresAt === 'string') {
    rows.push([TIER.credit, TIER.creditValue(formatMoney(c.balanceMinor, c.currency), formatDate(c.expiresAt))]);
  }
  const care = u.care;
  if (care && Number.isInteger(care.year) && Number.isInteger(care.used)) {
    if (care.allowance === 'ALL') rows.push([TIER.care, TIER.careAll(care.used, care.year)]);
    else if (typeof care.allowance === 'number' && care.allowance > 0) rows.push([TIER.care, TIER.careOf(care.used, care.allowance, care.year)]);
  }
  // One row for the gifts the next order carries (PLATINE's and PALLADIUM's together), one per order a gift travels with.
  const gifts = Array.isArray(u.gifts) ? u.gifts : [];
  if (gifts.some((g) => g?.state === 'PENDING')) rows.push([TIER.gift, TIER.giftNext]);
  for (const ref of new Set(gifts.filter((g) => g?.state === 'WITH_ORDER' && typeof g.orderReference === 'string').map((g) => g.orderReference!))) rows.push([TIER.gift, TIER.giftWith(ref)]);
  if (rows.length === 0) return null;
  // The note names the orders THE PROGRAM takes the credit off, in its order; none known, no note (never a promise).
  const channels = Array.isArray(u.creditChannels) ? CREDIT_CHANNELS.filter((ch) => u.creditChannels.includes(ch)) : [];
  return { label: TIER.inUse, rows, note: rows.some(([l]) => l === TIER.credit || l === TIER.birthdayCredit || l === TIER.vaultCredit || l === TIER.warrantyCredit) && channels.length > 0 ? TIER.creditNote(channels) : null };
}

export function tierModel(status: Pick<ClubStatus, 'tier' | 'pieces'> & Partial<Pick<ClubStatus, 'benefits' | 'next' | 'tierThresholds' | 'program' | 'inUse'>>, listed = 0): TierModel {
  const level = count(status?.tier?.level);
  const name = level >= 1 && level <= 3 ? NAMES[level - 1]! : null;
  const pieces = count(status?.pieces);
  const n = status?.next;
  const nextName = n && NAMES.includes(n.name) && count(n.level) === level + 1 ? n.name : null;
  const missing = Math.max(1, count(n?.missing));
  const from = count(n?.pieces);
  const next =
    nextName && n
      ? {
          label: TIER.next(nextName),
          sentence: name === null ? TIER.first(nextName) : TIER.nextWay(nextName, missing, from),
          benefits: [...lines(n.program), ...lines(n.benefits)],
        }
      : null;
  return {
    label: name ? TIER.label : TIER.noneLabel,
    badge: name ? { name, pieces: TIER.pieces(pieces) } : null,
    meter: name ? { on: Math.min(pieces, tierDotsOf(status)), of: tierDotsOf(status) } : null,
    benefits: name ? [...lines(status.program), ...lines(status.benefits)] : [],
    // Without a tier: the birthday credit (every account receives it, piece or not) and a warranty credit alone.
    inUse: name ? inUseModel(status.inUse) : status.inUse && typeof status.inUse === 'object' ? inUseModel({ ...status.inUse, credit: null, care: null, gifts: [] }) : null,
    next,
    top: name === 'PALLADIUM' ? TIER.top : null,
    note: listed > pieces ? TIER.counted : null,
  };
}
