/**
 * The console's intelligence on the LIVE RELEASES (plan of 2026-10-04, The console › Intelligence): nine readings, each
 * from ORBES's own data only (the releases, their entries, interest and add-ons, the club's tiers, the pieces held, the
 * audit log of the live controls), each by a rule written here and its reasoning returned with it, in words and with the
 * figures it used. Nothing here writes; nothing here leaves the console (routes/admin/live.ts, AUDITOR and up; the
 * emails in clear for an OPERATOR or an ADMIN, masked for an AUDITOR, by the routes).
 *
 *   release planner      (`plan`) before the announcement: the quantity, from the audience forecast and the pieces each
 *                        person present at T0 asked for in past releases (with enough stock: the pieces confirmed and the
 *                        unserved pieces at the turns' conversion; LIVE_INSIGHT_RULES.defaultDemandPerPerson without a
 *                        past release); the size mix, that quantity shared out (largest remainder) by the interest in
 *                        each size plus the eligible collectors whose latest piece of the model's type is in that size
 *                        (`products.variant`); the eligible collectors by tier. Eligible: what the release's rules let
 *                        in now; with a rule of taking part or of a segment, or rules combined by OR (plan LIVE
 *                        RELEASE+), every rule read for every account as at the entry (live.ts accessAccounts).
 *   audience forecast    (`forecast`) the room at T0 as a range: from the interest (I'LL BE THERE) at the share of the
 *                        interest present at T0 in past releases (their lowest and highest; LIVE_INSIGHT_RULES.
 *                        defaultShowUp without one); before any interest, from the eligible accounts of each tier at
 *                        the share of each tier present at T0 in past releases (counted under each release's rule today);
 *                        never above the eligible accounts. Above LIVE_ROOM_CAPACITY (the room the load test measured
 *                        the server to hold), it says so.
 *   demand radar         (`radar`) before T0: per size, the pieces wanted (the room's once it is open, the interest's
 *                        before) against the stock, its pressure; interest and presence by tier; the expected sell-out
 *                        time (the pieces go at T0; a share of the turns returns, at the conversion of past releases, and
 *                        each round costs a turn); ADD PIECES suggested when the demand at that conversion reaches twice
 *                        the stock, with the quantity line the announcement promised (the plan's choice 36).
 *   bot radar            (`bots`) the entries an ADMIN may want to remove: a very new account (created less than
 *                        LIVE_INSIGHT_RULES.newAccountHours before it entered), many entries from one network (the keyed
 *                        hash of its prefix, services/live.ts liveNetworkHash: at least `networkCrowd`), a hold shorter than
 *                        the house's ring allows (`gestureFloorMs`), or the same hold repeated to the millisecond across
 *                        releases (`gestureRepeat`). Removal is the live control REMOVE (ADMIN), one tap.
 *   live alerts          (`signals`, on the live board and its stream) exactly three: a size sells out; a wave of missed
 *                        turns (at least `missedWave.count` in `missedWave.windowSeconds`, half the turns that ended then
 *                        or more); a line stalled while pieces are free (a turn due in a size for `stallSeconds` and none
 *                        given: the engine gives one within a second).
 *   live sell-out        (`signals`) per size and overall: the pace of the pieces secured in the last `pace.windowMinutes`
 *   forecast             at the share of holds confirmed, against what the line can still absorb (the holds, the turns
 *                        and the line of each size at the release's conversion so far).
 *   release report       (`report`, `reportCsv`) the time to sell out per size and overall, the unserved demand per size,
 *                        the missed turns and ended holds, by tier, the add-ons, the funnel interest → room → turn →
 *                        secured → confirmed → concluded, every addition of pieces (choice 36: reported), and the quantity
 *                        and size mix for next time by the planner's rule applied to what this release measured.
 *   collector insights   (`collectors`) the conversion by tier, by country (the entry's, from its address's geolocation)
 *                        and of repeat collectors against first-timers; who came but secured no piece (an entry ORBES
 *                        removed left out of every figure).
 *   release comparison   (`comparison`) the release beside the others whose T0 has passed, figure by figure.
 *
 * Every rule's numbers are in LIVE_INSIGHT_RULES and LIVE_ROOM_CAPACITY, the arithmetic in pure functions (tested on
 * fixtures with known figures), the reads in LiveInsightsService.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { DropRow, LiveEndReason, LiveEntryStatus, LiveResolution } from '../db/schema.js';
import { csvDocument, CSV_CONTENT_TYPE } from '../render/csv.js';
import { systemClock, type Clock } from '../types.js';
import { CLUB_EXCLUDED_STATUSES, clubStandings, tierForPieces, tierName, type ClubTier } from './club.js';
import { DROP_QUANTITY_MAX, dropNotFound } from './drops.js';
import { accessAccounts, effectiveDeadline, livePhase, LIVE_GESTURE_MIN_MS, LIVE_NETWORK_RETENTION_DAYS, LIVE_OPEN_STATUSES, roomOpensAt, type LivePhase } from './live.js';
import { defaultQuantityLine, liveMoney, majorUnits } from './live-console.js';
import { notFound } from '../errors.js';
import { releaseSizeLabel, sizeMix, type SizeMix } from './release-stock.js';
import { defaultLocationId, knownLocation, stockBalances } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/**
 * The room the server holds, the limit the audience forecast warns against: measured by the load test of the VPS
 * profile (scripts/live-load.ts; docs/reports/live-load.md), the largest level that met every target in every run.
 * Measured again on 2026-10-05 with LIVE RELEASE+ (the rules read at each check, the orders made at PAY, an after-room
 * whose second door opens for all its guests at once): 500 did in all three runs; 750 in two of three, the after-room's
 * door in the third; 1 000 in none, the after-room's door every time (the room itself met them in two of three). It was
 * 1 000 for the LIVE RELEASE alone (2026-10-04).
 */
export const LIVE_ROOM_CAPACITY = Object.freeze({ inRoom: 500 });

/** Every number the intelligence's rules use (each one is in the reasoning it gives). */
export const LIVE_INSIGHT_RULES = Object.freeze({
  /** The past releases read: the latest ones by T0. */
  pastReleases: 12,
  /** Without a past release: the share of the interest present at T0, low and high. */
  defaultShowUp: Object.freeze({ low: 0.5, high: 1 }),
  /** Without a past release: the pieces asked for per person present at T0. */
  defaultDemandPerPerson: 0.5,
  /** ADD PIECES is suggested when the demand at the turns' conversion reaches this many times the stock. */
  addPiecesFactor: 2,
  /** A very new account: created less than this many hours before it entered. */
  newAccountHours: 24,
  /** Many entries from one network: at least this many. */
  networkCrowd: 3,
  /** A hold shorter than this (the house's ring takes 1 500 ms; the server refuses under LIVE_GESTURE_MIN_MS). */
  gestureFloorMs: 1450,
  /** The same hold repeated: at least `count` holds of one account, across releases, within `spreadMs` of each other. */
  gestureRepeat: Object.freeze({ count: 3, spreadMs: 10 }),
  /** A wave of missed turns: at least `count` in the last `windowSeconds`, and at least `share` of the turns that ended then. */
  missedWave: Object.freeze({ windowSeconds: 120, count: 5, share: 0.5 }),
  /** A line stalled: a turn due for this long, none given. */
  stallSeconds: 10,
  /** The live pace: the pieces secured in the last `windowMinutes`, read once the sales have run `minSeconds`. */
  pace: Object.freeze({ windowMinutes: 5, minSeconds: 30 }),
  /** The demand radar counts at most this many rounds of turns. */
  maxRounds: 10,
  /** The lists (bot radar, who came without a piece): at most this many rows, the total given. */
  listMax: 500,
});

const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const TIERS = [0, 1, 2, 3] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Words and figures ──────────────────────────────────────────────────────

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The ring of the house's seal: it fills in this long (verify/live-model.ts HOLD_MS). */
export const LIVE_HOUSE_RING_MS = 1500;

/** A whole number as the console writes it (web/admin/format.ts formatCount): `1 000`, a thin space between the thousands. */
export function count(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

/** A share: `42 %`. */
export function percent(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** A length of time: `35 s`, `4 min 05 s`, `1 h 02 min`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / SECOND));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${pad(s % 60)} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${pad(m % 60)} min` : `${h} h`;
}

/** An instant as the console writes it: `09 NOV 2026 · 14:32:05 UTC`. */
export function utc(d: Date): string {
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** A range: `75 to 90`, or one figure when both ends meet. */
const span = (low: number, high: number) => (Math.round(low) === Math.round(high) ? count(low) : `${count(low)} to ${count(high)}`);
const tierWord = (t: number) => (t === 0 ? 'no tier' : tierName(t as ClubTier)!);
const people = (n: number) => `${count(n)} ${n === 1 ? 'person' : 'people'}`;
const pieces = (n: number) => `${count(n)} ${n === 1 ? 'piece' : 'pieces'}`;

/** The middle value (the lower of the two middle ones for an even count, so a median is always one measured); null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/**
 * `total` shared out by `weights` (largest remainder: each its floor, then one more to the largest remainders, the
 * earlier size first on a tie); equal weights when every weight is 0.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const n = Math.max(0, Math.round(total));
  const w = weights.every((x) => !(x > 0)) ? weights.map(() => 1) : weights.map((x) => (x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (n * x) / sum);
  const out = exact.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left--;
  }
  return out;
}

// ── Facts ──────────────────────────────────────────────────────────────────

export interface InsightSize {
  id: string;
  label: string;
  stock: number;
}

/** A release as the rules read it. */
export interface InsightRelease {
  id: string;
  title: string;
  opensAt: Date;
  closesAt: Date;
  roomOpensAt: Date;
  endedAt: Date | null;
  endedReason: LiveEndReason | null;
  pausedAt: Date | null;
  pausedMs: number;
  turnSeconds: number;
  payMinutes: number;
  perAccount: number;
  priceMinor: number;
  currency: string;
  quantityLine: string;
  sizes: InsightSize[];
}

/** An entry as the rules read it. */
export interface InsightEntry {
  id: string;
  accountId: string;
  sizeId: string;
  quantity: number;
  status: LiveEntryStatus;
  /** The club's tier at entry, read again at T0 for the line. */
  tier: number;
  position: number | null;
  joinedAt: Date;
  queuedAt: Date | null;
  turnAt: Date | null;
  turnExpiresAt: Date | null;
  securedAt: Date | null;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  endedAt: Date | null;
  gestureMs: number | null;
  /**
   * How ORBES Client Services concluded a confirmed reservation, as its orders say (plan LIVE RELEASE+: the LIVE plan's
   * resolution is retired into the orders, `entryOutcome`): CONCLUDED once one of them is paid, CANCELLED once every
   * one is cancelled, null before.
   */
  resolution: LiveResolution | null;
  country: string | null;
  /** IN-01: the entry uses the house's guarantee: first in line in its size (services/live.ts giveTurnsNow). */
  guaranteed?: boolean;
}

/**
 * The outcome of a LIVE entry from its orders (services/orders.ts), as SQL over `live_entries` aliased `e`: CANCELLED
 * when every order of the entry is cancelled, CONCLUDED when one of them was paid, NULL otherwise; the entry's own
 * resolution (the LIVE plan's, kept as history) only for an entry without orders.
 */
export const entryOutcome = sql<LiveResolution | null>`CASE
    WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.live_entry_id = e.id) THEN e.resolution
    WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.live_entry_id = e.id AND o.status <> 'CANCELLED') THEN 'CANCELLED'
    WHEN EXISTS (SELECT 1 FROM orders o WHERE o.live_entry_id = e.id AND o.paid_at IS NOT NULL) THEN 'CONCLUDED'
    ELSE NULL END`;

export function insightRelease(d: DropRow, sizes: readonly InsightSize[]): InsightRelease {
  return {
    id: d.id,
    title: d.title,
    opensAt: d.opens_at,
    closesAt: d.closes_at,
    roomOpensAt: roomOpensAt(d),
    endedAt: d.ended_at,
    endedReason: d.ended_reason,
    pausedAt: d.paused_at,
    pausedMs: Number(d.paused_ms_total),
    turnSeconds: d.turn_seconds ?? 30,
    payMinutes: d.pay_minutes ?? 5,
    perAccount: d.per_account ?? 1,
    priceMinor: d.price_minor ?? 0,
    currency: d.currency ?? 'EUR',
    quantityLine: d.quantity_line ?? defaultQuantityLine(d.quantity),
    sizes: sizes.map((s) => ({ id: s.id, label: s.label, stock: s.stock })),
  };
}

const sumQ = (xs: readonly InsightEntry[]) => xs.reduce((n, e) => n + e.quantity, 0);
/** The line formed at T0: the entries placed at T0 itself (their `queued_at` is T0), the others came later. */
const atT0 = (r: Pick<InsightRelease, 'opensAt'>, e: InsightEntry) => e.queuedAt !== null && e.queuedAt.getTime() === r.opensAt.getTime();
/** An entry that waited in the line and never had a turn, and is out of it (the release ended, or it left the line). */
const unserved = (e: InsightEntry) => e.turnAt === null && e.position !== null && (e.status === 'ENDED' || e.status === 'LEFT');

/** The turns and holds of a set of entries: how many ended which way, the shares, the typical times. */
export interface LineRates {
  turns: number;
  /** Turns that have ended: secured, missed, or their entry out (left, removed, ended by the release). */
  turnsEnded: number;
  secured: number;
  /** Holds that have ended: confirmed, ran out, given back, or removed. */
  holdsEnded: number;
  confirmed: number;
  /** secured / turnsEnded; null before a turn ended. */
  secureRate: number | null;
  /** confirmed / holdsEnded; null before a hold ended. */
  payRate: number | null;
  /** The middle time from a turn to its seal held, and from the seal to PAY. */
  secureDelayMs: number | null;
  payDelayMs: number | null;
}

export function lineRates(entries: readonly InsightEntry[]): LineRates {
  const turns = entries.filter((e) => e.turnAt !== null);
  const secured = turns.filter((e) => e.securedAt !== null);
  const turnsEnded = turns.filter((e) => e.securedAt !== null || e.status === 'MISSED' || e.status === 'LEFT' || e.status === 'REMOVED' || e.status === 'ENDED').length;
  const confirmed = secured.filter((e) => e.status === 'CONFIRMED');
  const holdsEnded = secured.filter((e) => e.status === 'CONFIRMED' || e.status === 'EXPIRED' || e.status === 'RELEASED' || e.status === 'REMOVED').length;
  return {
    turns: turns.length,
    turnsEnded,
    secured: secured.length,
    holdsEnded,
    confirmed: confirmed.length,
    secureRate: turnsEnded ? secured.length / turnsEnded : null,
    payRate: holdsEnded ? confirmed.length / holdsEnded : null,
    secureDelayMs: median(secured.map((e) => e.securedAt!.getTime() - e.turnAt!.getTime())),
    payDelayMs: median(confirmed.map((e) => e.confirmedAt!.getTime() - e.securedAt!.getTime())),
  };
}

/** A turn's chance to end in a confirmed piece: the share secured × the share confirmed (each 1 when nothing ended yet). */
export function conversionOf(r: LineRates): number {
  return (r.secureRate ?? 1) * (r.payRate ?? 1);
}

/** What a release measured, as the planner, the forecast, the report and the comparison read it. */
export interface ReleaseSummary {
  id: string;
  title: string;
  opensAt: Date;
  endedReason: LiveEndReason | null;
  priceMinor: number;
  currency: string;
  stock: number;
  interest: number;
  /** Every entry (people who entered the room or the line). */
  room: number;
  /** In the line formed at T0, overall and by tier (0 to 3). */
  presentAtT0: number;
  presentByTier: number[];
  turns: number;
  secured: number;
  confirmed: number;
  confirmedPieces: number;
  concluded: number;
  /** The confirmed reservations ORBES Client Services cancelled (resolution CANCELLED) and their pieces: no revenue. */
  cancelled: number;
  cancelledPieces: number;
  missed: number;
  expired: number;
  released: number;
  unservedPieces: number;
  /** A turn's chance to end confirmed (conversionOf). */
  conversion: number;
  /** The pieces the release would have confirmed with enough stock: confirmed + unserved × conversion. */
  demandPieces: number;
  /** From T0 to its last piece confirmed, when every piece was. */
  sellOutMs: number | null;
  pausedMs: number;
  rates: LineRates;
}

export function summarize(r: InsightRelease, entries: readonly InsightEntry[], interest: number): ReleaseSummary {
  const rates = lineRates(entries);
  const conversion = conversionOf(rates);
  const confirmed = entries.filter((e) => e.status === 'CONFIRMED');
  const confirmedPieces = sumQ(confirmed);
  const cancelled = confirmed.filter((e) => e.resolution === 'CANCELLED');
  const unservedPieces = sumQ(entries.filter(unserved));
  const stock = r.sizes.reduce((n, s) => n + s.stock, 0);
  const cohort = entries.filter((e) => atT0(r, e));
  const last = confirmed.reduce<number | null>((m, e) => (m === null || e.confirmedAt!.getTime() > m ? e.confirmedAt!.getTime() : m), null);
  return {
    id: r.id,
    title: r.title,
    opensAt: r.opensAt,
    endedReason: r.endedReason,
    priceMinor: r.priceMinor,
    currency: r.currency,
    stock,
    interest,
    room: entries.length,
    presentAtT0: cohort.length,
    presentByTier: TIERS.map((t) => cohort.filter((e) => e.tier === t).length),
    turns: rates.turns,
    secured: rates.secured,
    confirmed: confirmed.length,
    confirmedPieces,
    concluded: confirmed.filter((e) => e.resolution === 'CONCLUDED').length,
    cancelled: cancelled.length,
    cancelledPieces: sumQ(cancelled),
    missed: entries.filter((e) => e.status === 'MISSED').length,
    expired: entries.filter((e) => e.status === 'EXPIRED').length,
    released: entries.filter((e) => e.status === 'RELEASED').length,
    unservedPieces,
    conversion,
    demandPieces: confirmedPieces + Math.round(unservedPieces * conversion),
    sellOutMs: stock > 0 && confirmedPieces >= stock && last !== null ? last - r.opensAt.getTime() : null,
    pausedMs: r.pausedMs,
    rates,
  };
}

// ── Audience forecast ──────────────────────────────────────────────────────

/** A past release as the forecast reads it. */
export interface PastAudience {
  title: string;
  interest: number;
  presentAtT0: number;
  presentByTier: readonly number[];
  /** Its eligible accounts by tier, counted under its rule today. */
  eligibleByTier: readonly number[];
}

export interface AudienceForecast {
  /** The room expected at T0: a range and its middle. */
  low: number;
  high: number;
  expected: number;
  basis: 'INTEREST' | 'ELIGIBLE' | 'NONE';
  interest: number;
  eligible: number;
  eligibleByTier: number[];
  /** In the room now (from its opening), null before. */
  inRoom: number | null;
  capacity: number;
  aboveCapacity: boolean;
  pastReleases: number;
  reasoning: string[];
}

const extent = (xs: readonly number[]): [number, number] | null => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);

export function audienceForecast(input: { interest: number; eligibleByTier: readonly number[]; past: readonly PastAudience[]; inRoom: number | null }): AudienceForecast {
  const eligibleByTier = TIERS.map((t) => input.eligibleByTier[t] ?? 0);
  const eligible = eligibleByTier.reduce((a, b) => a + b, 0);
  const why: string[] = [];
  const showUps = input.past.filter((p) => p.interest > 0).map((p) => p.presentAtT0 / p.interest);
  const pooled = extent(input.past.filter((p) => p.eligibleByTier.some((x) => x > 0)).map((p) => p.presentAtT0 / p.eligibleByTier.reduce((a, b) => a + b, 0)));
  let low = 0;
  let high = eligible;
  let basis: AudienceForecast['basis'] = 'NONE';
  if (input.interest > 0) {
    basis = 'INTEREST';
    const range = extent(showUps);
    const [a, b] = range ?? [LIVE_INSIGHT_RULES.defaultShowUp.low, LIVE_INSIGHT_RULES.defaultShowUp.high];
    low = Math.round(input.interest * a);
    high = Math.round(input.interest * b);
    why.push(
      range
        ? `${count(input.interest)} collectors said I'LL BE THERE. In ${count(showUps.length)} past ${showUps.length === 1 ? 'release' : 'releases'}, the line at T0 held ${percent(a)} to ${percent(b)} of the interest: ${span(low, high)}.`
        : `${count(input.interest)} collectors said I'LL BE THERE. No past release measures how many of them come: ${percent(a)} to ${percent(b)} of the interest is assumed, ${span(low, high)}.`,
    );
  } else if (pooled) {
    basis = 'ELIGIBLE';
    let lo = 0;
    let hi = 0;
    const parts: string[] = [];
    for (const t of TIERS) {
      if (eligibleByTier[t] === 0) continue;
      const own = extent(input.past.filter((p) => (p.eligibleByTier[t] ?? 0) > 0).map((p) => (p.presentByTier[t] ?? 0) / p.eligibleByTier[t]!));
      const [a, b] = own ?? pooled;
      lo += eligibleByTier[t]! * a;
      hi += eligibleByTier[t]! * b;
      parts.push(`${tierWord(t).toUpperCase()} ${count(eligibleByTier[t]!)} at ${percent(a)} to ${percent(b)}${own ? '' : ' (all tiers)'}`);
    }
    low = Math.round(lo);
    high = Math.round(hi);
    why.push(`No interest yet. Each tier's eligible accounts at the share of that tier present at T0 in past releases (their eligible accounts counted under their rule today): ${parts.join('; ')}. ${span(low, high)}.`);
  } else {
    why.push(`No interest yet and no past release: no basis for a forecast beyond the ${count(eligible)} eligible ${eligible === 1 ? 'account' : 'accounts'}.`);
  }
  if (high > eligible || low > eligible) {
    low = Math.min(low, eligible);
    high = Math.min(high, eligible);
    why.push(`Never more than the ${count(eligible)} accounts the rule lets in.`);
  }
  if (basis === 'INTEREST' && pooled) {
    const total = eligible;
    why.push(`For comparison, the eligible accounts at the past releases' share (${percent(pooled[0])} to ${percent(pooled[1])}) give ${span(total * pooled[0], total * pooled[1])}.`);
  }
  const expected = Math.round((low + high) / 2);
  const above = high > LIVE_ROOM_CAPACITY.inRoom;
  if (above) {
    why.push(
      `The upper end, ${count(high)}, is above the ${count(LIVE_ROOM_CAPACITY.inRoom)} in the room the load test measured the server to hold.`,
    );
  } else {
    why.push(`Within the ${count(LIVE_ROOM_CAPACITY.inRoom)} in the room the load test measured the server to hold.`);
  }
  if (input.inRoom !== null) why.push(`In the room now: ${people(input.inRoom)}.`);
  return {
    low,
    high,
    expected,
    basis,
    interest: input.interest,
    eligible,
    eligibleByTier,
    inRoom: input.inRoom,
    capacity: LIVE_ROOM_CAPACITY.inRoom,
    aboveCapacity: above,
    pastReleases: input.past.length,
    reasoning: why,
  };
}

// ── Release planner ────────────────────────────────────────────────────────

export interface ReleasePlan {
  forecast: AudienceForecast;
  /** Pieces asked for per person present at T0, and from how many past releases (0: the rule's default). */
  demandPerPerson: number;
  pastReleases: number;
  /** The quantity suggested; null without any basis. */
  quantity: number | null;
  /** The release's sizes: their stock now, the interest, the eligible collectors who hold that size, the suggestion. */
  sizes: { id: string; label: string; stock: number; interest: number; collectors: number; suggested: number | null }[];
  /** Sizes the eligible collectors hold that the release does not offer. */
  otherSizes: { label: string; collectors: number }[];
  eligibleByTier: number[];
  /** The model's type the sizes were read in (`models.type`). */
  modelType: string;
  reasoning: string[];
}

export function releasePlan(input: {
  sizes: readonly InsightSize[];
  forecast: AudienceForecast;
  past: readonly { presentAtT0: number; demandPieces: number }[];
  interestBySize: ReadonlyMap<string, number>;
  /** By size label in capitals: the eligible collectors whose latest piece of the type is in that size. */
  collectorsBySize: ReadonlyMap<string, number>;
  modelType: string;
}): ReleasePlan {
  const why: string[] = [];
  const past = input.past.filter((p) => p.presentAtT0 > 0);
  const demandPerPerson = past.length
    ? past.reduce((n, p) => n + p.demandPieces, 0) / past.reduce((n, p) => n + p.presentAtT0, 0)
    : LIVE_INSIGHT_RULES.defaultDemandPerPerson;
  why.push(
    past.length
      ? `Each person present at T0 asked for ${demandPerPerson.toFixed(2)} pieces in ${count(past.length)} past ${past.length === 1 ? 'release' : 'releases'} (the pieces confirmed, and the pieces of those never served at the turns' conversion).`
      : `No past release: ${demandPerPerson.toFixed(2)} pieces per person present at T0 is assumed.`,
  );
  const f = input.forecast;
  const quantity = f.basis === 'NONE' ? null : Math.min(DROP_QUANTITY_MAX, Math.max(1, Math.round(f.expected * demandPerPerson)));
  why.push(
    quantity === null
      ? 'No audience to forecast yet: no quantity is suggested.'
      : `The audience forecast expects ${count(f.expected)} at T0 (${span(f.low, f.high)}): ${count(f.expected)} × ${demandPerPerson.toFixed(2)} = ${pieces(quantity)}.`,
  );
  const known = new Set(input.sizes.map((s) => s.label.toUpperCase()));
  const weights = input.sizes.map((s) => (input.interestBySize.get(s.id) ?? 0) + (input.collectorsBySize.get(s.label.toUpperCase()) ?? 0));
  const shares = quantity === null ? input.sizes.map(() => null) : apportion(quantity, weights);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  why.push(
    totalWeight > 0
      ? `Shared by size in proportion to the interest in each size and the eligible collectors whose latest ${input.modelType} is in that size (${input.sizes.map((s, i) => `${s.label}: ${count(weights[i]!)}`).join(', ')}), the largest remainders rounded up.`
      : `Nothing tells the sizes apart yet (no interest, no ${input.modelType} held in these sizes): shared equally.`,
  );
  const otherSizes = [...input.collectorsBySize.entries()].filter(([label]) => !known.has(label)).map(([label, n]) => ({ label, collectors: n })).sort((a, b) => b.collectors - a.collectors || (a.label < b.label ? -1 : 1));
  if (otherSizes.length) why.push(`Eligible collectors also hold sizes this release does not offer: ${otherSizes.map((s) => `${s.label}: ${count(s.collectors)}`).join(', ')}.`);
  return {
    forecast: f,
    demandPerPerson,
    pastReleases: past.length,
    quantity,
    sizes: input.sizes.map((s, i) => ({ id: s.id, label: s.label, stock: s.stock, interest: input.interestBySize.get(s.id) ?? 0, collectors: input.collectorsBySize.get(s.label.toUpperCase()) ?? 0, suggested: shares[i] ?? null })),
    otherSizes,
    eligibleByTier: f.eligibleByTier,
    modelType: input.modelType,
    reasoning: why,
  };
}

// ── Demand radar ───────────────────────────────────────────────────────────

export interface RadarSize {
  id: string;
  label: string;
  stock: number;
  interest: number;
  /** In the room in this size: people and the pieces they ask for. */
  inRoom: number;
  roomPieces: number;
  /** The pieces wanted: the room's once it is open, the interest's before. */
  demand: number;
  /** demand / stock; null for a size without stock. */
  pressure: number | null;
  sellsOut: boolean;
  /** When it is expected to sell out; null when it is not. */
  sellOutAt: Date | null;
  /** The pieces expected confirmed when it does not sell out. */
  expectedSold: number;
  /** ADD PIECES suggested: how many would serve the expected demand; null when not suggested. */
  addPieces: number | null;
}

export interface DemandRadar {
  /** The room is open (the demand is the room's) or not yet (the interest's). */
  roomOpen: boolean;
  /** T0 has passed: the line has formed and the live sell-out forecast takes over. */
  formed: boolean;
  inRoom: number;
  stock: number;
  interest: number;
  pressure: number | null;
  sizes: RadarSize[];
  byTier: { tier: number; interest: number; inRoom: number }[];
  conversion: number;
  /** All sizes expected to sell out: when the last does. */
  sellOutAt: Date | null;
  quantityLine: string;
  reasoning: string[];
}

export function demandRadar(input: {
  release: InsightRelease;
  /** The entries in the room (WAITING). */
  room: readonly InsightEntry[];
  interest: readonly { sizeId: string; tier: number }[];
  /** The rates of past releases, pooled. */
  past: LineRates | null;
  now: Date;
}): DemandRadar {
  const r = input.release;
  const roomOpen = input.now.getTime() >= r.roomOpensAt.getTime();
  const formed = input.now.getTime() >= r.opensAt.getTime();
  const why: string[] = [];
  const conversion = input.past ? conversionOf(input.past) : 1;
  const rounds = conversion >= 1 ? 1 : conversion <= 0 ? LIVE_INSIGHT_RULES.maxRounds : Math.min(LIVE_INSIGHT_RULES.maxRounds, Math.ceil(1 / conversion));
  const secureMs = input.past?.secureDelayMs ?? (r.turnSeconds * SECOND) / 2;
  const payMs = input.past?.payDelayMs ?? (r.payMinutes * MINUTE) / 2;
  const roundMs = secureMs + payMs + (rounds - 1) * r.turnSeconds * SECOND;
  why.push(
    roomOpen
      ? `The demand of a size is the pieces asked for by the people in the room in that size (${people(input.room.length)} in the room).`
      : `The room is not open yet: the demand of a size is its interest (I'LL BE THERE, one piece each).`,
  );
  why.push(
    input.past && input.past.turnsEnded > 0
      ? `In past releases a turn ended in a confirmed piece ${percent(conversion)} of the time (${percent(input.past.secureRate ?? 1)} secured, ${percent(input.past.payRate ?? 1)} of those confirmed); the seal was held after ${duration(secureMs)} and PAY pressed ${duration(payMs)} later (the middle times).`
      : `No past release: every turn is assumed to end in a confirmed piece, the seal held after half the turn (${duration(secureMs)}) and PAY pressed after half the time to pay (${duration(payMs)}).`,
  );
  why.push(
    `A size sells out when its demand at that conversion reaches its stock: its pieces go at T0, ${rounds === 1 ? 'in one round' : `in ${count(rounds)} rounds, each returned piece going to the next in line after a turn of ${duration(r.turnSeconds * SECOND)}`}: T0 + ${duration(roundMs)}.`,
  );
  const sizes: RadarSize[] = r.sizes.map((s) => {
    const room = input.room.filter((e) => e.sizeId === s.id);
    const interest = input.interest.filter((i) => i.sizeId === s.id).length;
    const roomPieces = sumQ(room);
    const demand = roomOpen ? roomPieces : interest;
    const expected = Math.floor(demand * conversion);
    const sellsOut = s.stock > 0 && expected >= s.stock;
    const suggest = s.stock > 0 && demand * conversion >= LIVE_INSIGHT_RULES.addPiecesFactor * s.stock ? expected - s.stock : null;
    return {
      id: s.id,
      label: s.label,
      stock: s.stock,
      interest,
      inRoom: room.length,
      roomPieces,
      demand,
      pressure: s.stock > 0 ? demand / s.stock : null,
      sellsOut,
      sellOutAt: sellsOut ? new Date(r.opensAt.getTime() + roundMs) : null,
      expectedSold: Math.min(s.stock, expected),
      addPieces: suggest,
    };
  });
  const stock = r.sizes.reduce((n, s) => n + s.stock, 0);
  const demand = sizes.reduce((n, s) => n + s.demand, 0);
  for (const s of sizes) {
    if (s.stock === 0) continue;
    why.push(
      s.sellsOut
        ? `${s.label}: ${pieces(s.demand)} wanted for ${pieces(s.stock)} (pressure ${s.pressure!.toFixed(2)}): expected to sell out.`
        : `${s.label}: ${pieces(s.demand)} wanted for ${pieces(s.stock)} (pressure ${s.pressure!.toFixed(2)}): about ${pieces(s.expectedSold)} expected confirmed.`,
    );
  }
  const suggested = sizes.filter((s) => s.addPieces !== null && s.addPieces > 0);
  if (suggested.length) {
    why.push(
      `The demand at that conversion is at least ${LIVE_INSIGHT_RULES.addPiecesFactor} times the stock in ${suggested.map((s) => s.label).join(', ')}: adding ${suggested.map((s) => `${count(s.addPieces!)} in ${s.label}`).join(', ')} would serve it. The announcement says « ${r.quantityLine} »: adding pieces after a fixed number was announced contradicts it, and every addition is recorded and reported.`,
    );
  }
  const all = sizes.filter((s) => s.stock > 0);
  return {
    roomOpen,
    formed,
    inRoom: input.room.length,
    stock,
    interest: input.interest.length,
    pressure: stock > 0 ? demand / stock : null,
    sizes,
    byTier: TIERS.map((t) => ({ tier: t, interest: input.interest.filter((i) => i.tier === t).length, inRoom: input.room.filter((e) => e.tier === t).length })),
    conversion,
    sellOutAt: all.length > 0 && all.every((s) => s.sellsOut) ? new Date(r.opensAt.getTime() + roundMs) : null,
    quantityLine: r.quantityLine,
    reasoning: why,
  };
}

// ── Live alerts and the live sell-out forecast (the live board) ────────────

export type LiveAlertKind = 'SIZE_SOLD_OUT' | 'MISSED_WAVE' | 'LINE_STALLED';
/** The three, in the order the board shows them. */
export const LIVE_ALERT_KINDS = Object.freeze(['SIZE_SOLD_OUT', 'MISSED_WAVE', 'LINE_STALLED'] as const satisfies readonly LiveAlertKind[]);

export interface LiveAlert {
  kind: LiveAlertKind;
  size: { id: string; label: string } | null;
  /** Since when it holds. */
  since: Date;
  text: string;
  reasoning: string[];
}

/** The latest console actions that make a turn due (a RESUME, an ADD PIECES), from the audit log. */
export interface LiveControlTimes {
  resumedAt: Date | null;
  stockAt: Date | null;
}

/** A turn's or a hold's deadline as it stands now, and whether it has passed. */
const lapsed = (deadline: Date | null, r: InsightRelease, now: Date) => deadline !== null && effectiveDeadline(deadline, { paused_at: r.pausedAt }, now).getTime() <= now.getTime();

interface StallCandidate {
  size: InsightSize;
  /** When the turn became due, from the entries alone. */
  since: number;
  head: InsightEntry;
  free: number;
}

/** The sizes where a turn is due now (the engine's rule: services/live.ts giveTurnsNow), and since when by the entries. */
export function dueTurns(r: InsightRelease, entries: readonly InsightEntry[], now: Date): StallCandidate[] {
  const t = now.getTime();
  if (t < r.opensAt.getTime() || r.endedAt || r.pausedAt || t >= r.closesAt.getTime()) return [];
  const out: StallCandidate[] = [];
  for (const s of r.sizes) {
    const own = entries.filter((e) => e.sizeId === s.id);
    const running = (e: InsightEntry) => (e.status === 'TURN' && !lapsed(e.turnExpiresAt, r, now)) || (e.status === 'SECURED' && !lapsed(e.holdExpiresAt, r, now));
    const confirmed = sumQ(own.filter((e) => e.status === 'CONFIRMED'));
    const free = s.stock - confirmed - sumQ(own.filter(running));
    const servable = s.stock - confirmed;
    const head = own
      .filter((e) => e.status === 'QUEUED' && e.quantity <= servable)
      // IN-01: the places guaranteed by the house first in their size, as the engine gives the turns.
      .sort((a, b) => Number(b.guaranteed === true) - Number(a.guaranteed === true) || (a.position ?? 0) - (b.position ?? 0))[0];
    if (!head || head.quantity > free) continue;
    // The clock moves only on what makes this turn due or shows the engine at work: T0, the head's own place in the line,
    // a turn given, pieces returned (a turn or a hold that ended), a place ahead of the head left, a confirmation that
    // passes over a place ahead wanting more than the size can still give. A collector joining or leaving behind the head
    // does neither: a busy line must not hide an engine that has stopped.
    const place = head.position ?? 0;
    const ahead = (e: InsightEntry) => e.position !== null && e.position < place;
    const passedOver = own.some((e) => e.status === 'QUEUED' && ahead(e));
    let since = Math.max(r.opensAt.getTime(), head.queuedAt?.getTime() ?? 0);
    for (const e of own) {
      const moves = [e.turnAt, e.turnAt !== null || ahead(e) ? e.endedAt : null, passedOver ? e.confirmedAt : null];
      for (const d of moves) if (d && d.getTime() > since) since = d.getTime();
      // A turn or a hold the engine has not marked yet frees its pieces at its deadline.
      if (e.status === 'TURN' && lapsed(e.turnExpiresAt, r, now)) since = Math.max(since, effectiveDeadline(e.turnExpiresAt!, { paused_at: r.pausedAt }, now).getTime());
      if (e.status === 'SECURED' && lapsed(e.holdExpiresAt, r, now)) since = Math.max(since, effectiveDeadline(e.holdExpiresAt!, { paused_at: r.pausedAt }, now).getTime());
    }
    out.push({ size: s, since, head, free });
  }
  return out;
}

/** Exactly three alerts: a size sold out, a wave of missed turns, a line stalled while pieces are free. */
export function liveAlerts(r: InsightRelease, entries: readonly InsightEntry[], controls: LiveControlTimes, now: Date): LiveAlert[] {
  const t = now.getTime();
  if (t < r.opensAt.getTime()) return [];
  const out: LiveAlert[] = [];
  // 1. A size sells out: every piece of it confirmed.
  for (const s of r.sizes) {
    if (s.stock < 1) continue;
    const confirmed = entries.filter((e) => e.sizeId === s.id && e.status === 'CONFIRMED');
    if (sumQ(confirmed) < s.stock) continue;
    const since = new Date(Math.max(...confirmed.map((e) => e.confirmedAt!.getTime())));
    const waiting = entries.filter((e) => e.sizeId === s.id && (e.status === 'QUEUED' || e.status === 'WAITING')).length;
    out.push({
      kind: 'SIZE_SOLD_OUT',
      size: { id: s.id, label: s.label },
      since,
      text: `Size ${s.label} is sold out.`,
      reasoning: [
        s.stock === 1 ? `Its one piece is confirmed, at ${utc(since)}.` : `Its ${pieces(s.stock)} are all confirmed, the last at ${utc(since)}.`,
        waiting ? `${people(waiting)} still ${waiting === 1 ? 'waits' : 'wait'} in this size, in case ADD PIECES serves them.` : 'Nobody waits in this size.',
      ],
    });
  }
  // 2. A wave of missed turns.
  const w = LIVE_INSIGHT_RULES.missedWave;
  const from = t - w.windowSeconds * SECOND;
  const inWindow = (d: Date | null) => d !== null && d.getTime() > from && d.getTime() <= t;
  const missed = entries.filter((e) => e.status === 'MISSED' && inWindow(e.endedAt));
  const securedNow = entries.filter((e) => e.turnAt !== null && inWindow(e.securedAt)).length;
  const outOfTurn = entries.filter((e) => e.turnAt !== null && e.securedAt === null && (e.status === 'LEFT' || e.status === 'REMOVED' || e.status === 'ENDED') && inWindow(e.endedAt)).length;
  const ended = missed.length + securedNow + outOfTurn;
  if (missed.length >= w.count && missed.length >= w.share * ended) {
    const since = new Date(Math.min(...missed.map((e) => e.endedAt!.getTime())));
    out.push({
      kind: 'MISSED_WAVE',
      size: null,
      since,
      text: `${count(missed.length)} turns missed in ${duration(w.windowSeconds * SECOND)}.`,
      reasoning: [
        `In the last ${duration(w.windowSeconds * SECOND)}, ${count(ended)} turns ended: ${count(missed.length)} ran out, ${count(securedNow)} secured, ${count(outOfTurn)} left or removed (${percent(missed.length / ended)} missed).`,
        `A wave is ${count(w.count)} missed turns or more in that time, and at least ${percent(w.share)} of the turns that ended: collectors may not be reaching their turn (a host message, or more time with EXTEND).`,
      ],
    });
  }
  // 3. A line stalled while pieces are free.
  for (const c of dueTurns(r, entries, now)) {
    let since = c.since;
    for (const d of [controls.resumedAt, controls.stockAt]) if (d && d.getTime() > since && d.getTime() <= t) since = d.getTime();
    const waited = t - since;
    if (waited < LIVE_INSIGHT_RULES.stallSeconds * SECOND) continue;
    const queued = entries.filter((e) => e.sizeId === c.size.id && e.status === 'QUEUED').length;
    out.push({
      kind: 'LINE_STALLED',
      size: { id: c.size.id, label: c.size.label },
      since: new Date(since),
      text: `The line of size ${c.size.label} has stalled for ${duration(waited)}.`,
      reasoning: [
        `${pieces(c.free)} free in size ${c.size.label}, ${people(queued)} in its line, and place ${count(c.head.position ?? 0)} could take ${c.head.quantity === 1 ? 'it' : `its ${count(c.head.quantity)}`}: no turn has begun since ${utc(new Date(since))}.`,
        `The engine gives a due turn within a second: a stall of ${duration(LIVE_INSIGHT_RULES.stallSeconds * SECOND)} or more says it is not running.`,
      ],
    });
  }
  return out;
}

export type SellOutOutlook = 'SOLD_OUT' | 'SELLS_OUT' | 'LINE_SHORT' | 'CLOSE_FIRST' | 'NO_PACE';

export interface SizeSellOut {
  size: { id: string; label: string };
  stock: number;
  /** The pieces not confirmed yet. */
  remaining: number;
  outlook: SellOutOutlook;
  /** SOLD_OUT: when; SELLS_OUT: when expected. */
  at: Date | null;
  /** LINE_SHORT, CLOSE_FIRST: the pieces expected left. */
  expectedLeft: number | null;
  /** Pieces secured per minute in the window. */
  pace: number;
  reasoning: string[];
}

export interface LiveSellOut {
  outlook: SellOutOutlook | 'PARTIAL';
  at: Date | null;
  expectedLeft: number;
  /** The window the pace is read over. */
  windowMs: number;
  /** The share of turns secured and of holds confirmed so far (1 before one ended). */
  secureRate: number;
  payRate: number;
  sizes: SizeSellOut[];
  reasoning: string[];
}

/**
 * The live sell-out forecast at `now` (after T0, until the end), or null before T0 and once the release has ended.
 * The pace is read over the last LIVE_INSIGHT_RULES.pace.windowMinutes, from the latest RESUME at the earliest (a pause
 * that has ended is not time on sale), a pause still running left out.
 */
export function sellOutForecast(r: InsightRelease, entries: readonly InsightEntry[], controls: Pick<LiveControlTimes, 'resumedAt'>, now: Date): LiveSellOut | null {
  const t = now.getTime();
  if (t < r.opensAt.getTime() || r.endedAt || t >= r.closesAt.getTime()) return null;
  const rates = lineRates(entries);
  const s = rates.secureRate ?? 1;
  const c = rates.payRate ?? 1;
  const resumed = controls.resumedAt && controls.resumedAt.getTime() <= t ? controls.resumedAt.getTime() : null;
  const windowStart = Math.max(r.opensAt.getTime(), t - LIVE_INSIGHT_RULES.pace.windowMinutes * MINUTE);
  const fromResume = resumed !== null && resumed > windowStart;
  const start = fromResume ? resumed : windowStart;
  const pausedInWindow = r.pausedAt ? t - Math.max(r.pausedAt.getTime(), start) : 0;
  const windowMs = Math.max(0, t - start - Math.max(0, pausedInWindow));
  const outOfSale = [fromResume ? 'the pause before it' : '', pausedInWindow > 0 ? (fromResume ? 'the pause running now' : 'the pause') : ''].filter(Boolean).join(' and ');
  const why: string[] = [
    `The pace: the pieces secured since ${utc(new Date(start))}${fromResume ? ', the latest RESUME' : ''} (${duration(windowMs)} of sales${outOfSale ? `, ${outOfSale} left out` : ''}).`,
    rates.turnsEnded || rates.holdsEnded
      ? `So far ${percent(s)} of the turns that ended were secured and ${percent(c)} of the holds that ended confirmed.`
      : 'No turn or hold has ended yet: each is assumed to be secured and confirmed.',
  ];
  const sizes: SizeSellOut[] = [];
  for (const z of r.sizes) {
    if (z.stock < 1) continue;
    const own = entries.filter((e) => e.sizeId === z.id);
    const confirmed = own.filter((e) => e.status === 'CONFIRMED');
    const remaining = Math.max(0, z.stock - sumQ(confirmed));
    const pace = windowMs > 0 ? sumQ(own.filter((e) => e.securedAt !== null && e.securedAt.getTime() >= start)) / (windowMs / MINUTE) : 0;
    const base = { size: { id: z.id, label: z.label }, stock: z.stock, remaining, pace };
    if (remaining === 0) {
      const at = new Date(Math.max(...confirmed.map((e) => e.confirmedAt!.getTime())));
      sizes.push({ ...base, outlook: 'SOLD_OUT', at, expectedLeft: null, reasoning: [`Every piece confirmed, the last at ${utc(at)}.`] });
      continue;
    }
    const holds = sumQ(own.filter((e) => e.status === 'SECURED'));
    const turns = sumQ(own.filter((e) => e.status === 'TURN'));
    const line = sumQ(own.filter((e) => e.status === 'QUEUED' && e.quantity <= remaining));
    const supply = holds * c + (turns + line) * s * c;
    const head = `${pieces(remaining)} to confirm; the line can still give ${count(supply)} (${count(holds)} held, ${count(turns)} in a turn, ${count(line)} waiting, at those shares)`;
    if (supply < remaining) {
      const left = remaining - Math.floor(supply);
      sizes.push({ ...base, outlook: 'LINE_SHORT', at: null, expectedLeft: left, reasoning: [`${head}: about ${pieces(left)} left once the line is served, unless more collectors join it.`] });
      continue;
    }
    if (r.pausedAt || windowMs < LIVE_INSIGHT_RULES.pace.minSeconds * SECOND || pace * c <= 0) {
      const reason = r.pausedAt ? 'the release is paused' : windowMs < LIVE_INSIGHT_RULES.pace.minSeconds * SECOND ? `the sales have run less than ${duration(LIVE_INSIGHT_RULES.pace.minSeconds * SECOND)}${fromResume ? ' since the RESUME' : ''}` : `no piece was secured in ${duration(windowMs)}`;
      sizes.push({ ...base, outlook: 'NO_PACE', at: null, expectedLeft: null, reasoning: [`${head}; no pace to forecast from: ${reason}.`] });
      continue;
    }
    const rate = pace * c;
    const at = new Date(t + (remaining / rate) * MINUTE);
    if (at.getTime() > r.closesAt.getTime()) {
      const left = remaining - Math.floor((rate * (r.closesAt.getTime() - t)) / MINUTE);
      sizes.push({ ...base, outlook: 'CLOSE_FIRST', at: null, expectedLeft: left, reasoning: [`${head}. At ${pace.toFixed(1)} secured a minute, ${rate.toFixed(1)} confirmed: the sales end at ${utc(r.closesAt)} with about ${pieces(left)} left.`] });
      continue;
    }
    sizes.push({ ...base, outlook: 'SELLS_OUT', at, expectedLeft: null, reasoning: [`${head}. At ${pace.toFixed(1)} secured a minute, ${rate.toFixed(1)} confirmed: sold out about ${utc(at)}.`] });
  }
  const left = sizes.reduce((n, z) => n + (z.expectedLeft ?? 0), 0);
  let outlook: LiveSellOut['outlook'];
  let at: Date | null = null;
  const latest = (xs: SizeSellOut[]) => new Date(Math.max(...xs.map((z) => z.at!.getTime())));
  if (sizes.length && sizes.every((z) => z.outlook === 'SOLD_OUT')) {
    outlook = 'SOLD_OUT';
    at = latest(sizes);
  } else if (sizes.length && sizes.every((z) => z.outlook === 'SOLD_OUT' || z.outlook === 'SELLS_OUT')) {
    outlook = 'SELLS_OUT';
    at = latest(sizes);
    why.push(`Every size sells out: the release about ${utc(at)}, with its last size.`);
  } else if (sizes.some((z) => z.outlook === 'LINE_SHORT' || z.outlook === 'CLOSE_FIRST')) {
    outlook = 'PARTIAL';
    why.push(`About ${pieces(left)} expected left in ${sizes.filter((z) => z.expectedLeft).map((z) => z.size.label).join(', ')}.`);
  } else {
    outlook = 'NO_PACE';
  }
  return { outlook, at, expectedLeft: left, windowMs, secureRate: s, payRate: c, sizes, reasoning: why };
}

/** What the live board carries of the intelligence: its alerts and the live sell-out forecast. */
export interface LiveSignals {
  alerts: LiveAlert[];
  sellOut: LiveSellOut | null;
}

// ── Bot radar ──────────────────────────────────────────────────────────────

export type BotSign = 'NEW_ACCOUNT' | 'NETWORK' | 'GESTURE_FLOOR' | 'GESTURE_REPEAT';
export const BOT_SIGNS = Object.freeze(['NEW_ACCOUNT', 'NETWORK', 'GESTURE_FLOOR', 'GESTURE_REPEAT'] as const satisfies readonly BotSign[]);

export interface BotEntryFacts {
  entry: InsightEntry;
  email: string;
  accountCreatedAt: Date;
  /** The keyed hash of the entry's network, hex; null once erased. */
  network: string | null;
  /** Every hold of the account across the LIVE RELEASES (this one's included). */
  gestures: readonly number[];
}

export interface BotFlag {
  entryId: string;
  accountId: string;
  /** As stored: the routes mask it for an AUDITOR. */
  email: string;
  status: LiveEntryStatus;
  size: { id: string; label: string };
  tier: number;
  position: number | null;
  /** Still in the release: REMOVE applies. */
  open: boolean;
  signs: BotSign[];
  /** The network's group (`1` the most crowded), when it is one. */
  network: number | null;
  reasons: string[];
}

export interface BotRadar {
  entries: number;
  flagged: number;
  bySign: Record<BotSign, number>;
  networks: { group: number; entries: number }[];
  /** The flagged entries, the most signs first, then by place (at most LIVE_INSIGHT_RULES.listMax). */
  items: BotFlag[];
  reasoning: string[];
}

export function botRadar(r: InsightRelease, facts: readonly BotEntryFacts[]): BotRadar {
  const rules = LIVE_INSIGHT_RULES;
  const byNetwork = new Map<string, number>();
  for (const f of facts) if (f.network) byNetwork.set(f.network, (byNetwork.get(f.network) ?? 0) + 1);
  const crowded = [...byNetwork.entries()].filter(([, n]) => n >= rules.networkCrowd).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const group = new Map(crowded.map(([h], i) => [h, i + 1]));
  const label = new Map(r.sizes.map((s) => [s.id, s.label]));
  const bySign = Object.fromEntries(BOT_SIGNS.map((s) => [s, 0])) as Record<BotSign, number>;
  const flags: BotFlag[] = [];
  for (const f of facts) {
    const e = f.entry;
    const signs: BotSign[] = [];
    const reasons: string[] = [];
    const age = e.joinedAt.getTime() - f.accountCreatedAt.getTime();
    if (age < rules.newAccountHours * HOUR) {
      signs.push('NEW_ACCOUNT');
      reasons.push(`Account created ${duration(Math.max(0, age))} before it entered.`);
    }
    const g = f.network ? group.get(f.network) : undefined;
    if (g !== undefined) {
      signs.push('NETWORK');
      reasons.push(`One of ${count(byNetwork.get(f.network!)!)} entries from network ${g}.`);
    }
    if (e.gestureMs !== null && e.gestureMs < rules.gestureFloorMs) {
      signs.push('GESTURE_FLOOR');
      reasons.push(`Held the seal ${count(e.gestureMs)} ms: the house's ring takes ${count(LIVE_HOUSE_RING_MS)} ms.`);
    }
    const hold = f.gestures;
    if (hold.length >= rules.gestureRepeat.count && Math.max(...hold) - Math.min(...hold) <= rules.gestureRepeat.spreadMs) {
      signs.push('GESTURE_REPEAT');
      reasons.push(`${count(hold.length)} holds across releases within ${count(Math.max(...hold) - Math.min(...hold))} ms of each other (${hold.map((x) => count(x)).join(', ')} ms).`);
    }
    if (signs.length === 0) continue;
    for (const s of signs) bySign[s]++;
    flags.push({
      entryId: e.id,
      accountId: e.accountId,
      email: f.email,
      status: e.status,
      size: { id: e.sizeId, label: label.get(e.sizeId) ?? '' },
      tier: e.tier,
      position: e.position,
      open: (LIVE_OPEN_STATUSES as readonly string[]).includes(e.status),
      signs,
      network: g ?? null,
      reasons,
    });
  }
  flags.sort((a, b) => b.signs.length - a.signs.length || (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || (a.entryId < b.entryId ? -1 : 1));
  return {
    entries: facts.length,
    flagged: flags.length,
    bySign,
    networks: crowded.map(([h, n]) => ({ group: group.get(h)!, entries: n })),
    items: flags.slice(0, rules.listMax),
    reasoning: [
      `A very new account: created less than ${count(rules.newAccountHours)} hours before it entered.`,
      `Many entries from one network: ${count(rules.networkCrowd)} or more entries whose address shares a network (its keyed hash, never the address; erased ${count(LIVE_NETWORK_RETENTION_DAYS)} days after the end). A boutique's or an office's network may be one.`,
      `A machine-regular hold: the seal held less than ${count(rules.gestureFloorMs)} ms (the house's ring fills in ${count(LIVE_HOUSE_RING_MS)} ms; the server refuses under ${count(LIVE_GESTURE_MIN_MS)} ms), or ${count(rules.gestureRepeat.count)} holds or more of one account, across releases, within ${count(rules.gestureRepeat.spreadMs)} ms of each other.`,
      'A sign is a reason to look, not a proof: an ADMIN removes an entry with one tap; its place, or the piece it holds, goes to the next in line.',
    ],
  };
}

// ── Release report ─────────────────────────────────────────────────────────

export interface StockAddition {
  at: Date;
  sizeId: string;
  size: string;
  pieces: number;
  before: number;
  after: number;
}

export interface AddonFact {
  id: string;
  label: string;
}

export interface EntryAddonFact {
  entryId: string;
  addonId: string;
  priceMinor: number;
}

export interface ReleaseReport {
  id: string;
  title: string;
  /** The release is over (ended, no turn or hold left): the figures are final. */
  final: boolean;
  endedReason: LiveEndReason | null;
  opensAt: Date;
  endedAt: Date | null;
  sellOutMs: number | null;
  pausedMs: number;
  currency: string;
  quantityLine: string;
  funnel: { step: 'INTEREST' | 'ROOM' | 'TURN' | 'SECURED' | 'CONFIRMED' | 'CONCLUDED'; people: number; share: number | null }[];
  sizes: {
    id: string;
    label: string;
    stock: number;
    added: number;
    confirmedPieces: number;
    sellOutMs: number | null;
    unservedPeople: number;
    unservedPieces: number;
    missed: number;
    expired: number;
    released: number;
    nextDemand: number;
  }[];
  byTier: { tier: number; entries: number; turns: number; secured: number; confirmed: number; missed: number; expired: number }[];
  missed: number;
  expired: number;
  released: number;
  addons: { id: string; label: string; reservations: number; pieces: number; revenueMinor: number }[];
  /** The confirmed reservations ORBES Client Services cancelled, left out of the revenue. */
  cancelled: { reservations: number; pieces: number };
  piecesRevenueMinor: number;
  addonsRevenueMinor: number;
  additions: StockAddition[];
  conversion: number;
  next: { quantity: number; sizes: { label: string; pieces: number }[] };
  reasoning: string[];
}

export function releaseReport(input: {
  release: InsightRelease;
  entries: readonly InsightEntry[];
  interest: number;
  addons: readonly AddonFact[];
  entryAddons: readonly EntryAddonFact[];
  additions: readonly StockAddition[];
  over: boolean;
}): ReleaseReport {
  const r = input.release;
  const sum = summarize(r, input.entries, input.interest);
  const why: string[] = [];
  const steps: [ReleaseReport['funnel'][number]['step'], number][] = [
    ['INTEREST', input.interest],
    ['ROOM', sum.room],
    ['TURN', sum.turns],
    ['SECURED', sum.secured],
    ['CONFIRMED', sum.confirmed],
    ['CONCLUDED', sum.concluded],
  ];
  const funnel = steps.map(([step, n], i) => ({ step, people: n, share: i === 0 ? null : steps[i - 1]![1] > 0 ? n / steps[i - 1]![1] : null }));
  const sizes = r.sizes.map((s) => {
    const own = input.entries.filter((e) => e.sizeId === s.id);
    const confirmed = own.filter((e) => e.status === 'CONFIRMED');
    const confirmedPieces = sumQ(confirmed);
    const lost = own.filter(unserved);
    const last = confirmed.length ? Math.max(...confirmed.map((e) => e.confirmedAt!.getTime())) : null;
    const unservedPieces = sumQ(lost);
    return {
      id: s.id,
      label: s.label,
      stock: s.stock,
      added: input.additions.filter((a) => a.sizeId === s.id).reduce((n, a) => n + a.pieces, 0),
      confirmedPieces,
      sellOutMs: s.stock > 0 && confirmedPieces >= s.stock && last !== null ? last - r.opensAt.getTime() : null,
      unservedPeople: lost.length,
      unservedPieces,
      missed: own.filter((e) => e.status === 'MISSED').length,
      expired: own.filter((e) => e.status === 'EXPIRED').length,
      released: own.filter((e) => e.status === 'RELEASED').length,
      nextDemand: confirmedPieces + Math.round(unservedPieces * sum.conversion),
    };
  });
  // The revenue: the confirmed reservations ORBES Client Services has not cancelled.
  const confirmedIds = new Set(input.entries.filter((e) => e.status === 'CONFIRMED' && e.resolution !== 'CANCELLED').map((e) => e.id));
  const quantityOf = new Map(input.entries.map((e) => [e.id, e.quantity]));
  const addons = input.addons.map((a) => {
    const chosen = input.entryAddons.filter((x) => x.addonId === a.id && confirmedIds.has(x.entryId));
    return {
      id: a.id,
      label: a.label,
      reservations: chosen.length,
      pieces: chosen.reduce((n, x) => n + (quantityOf.get(x.entryId) ?? 0), 0),
      revenueMinor: chosen.reduce((n, x) => n + x.priceMinor * (quantityOf.get(x.entryId) ?? 0), 0),
    };
  });
  const piecesRevenueMinor = (sum.confirmedPieces - sum.cancelledPieces) * r.priceMinor;
  const addonsRevenueMinor = addons.reduce((n, a) => n + a.revenueMinor, 0);
  const stock = sizes.reduce((n, s) => n + s.stock, 0);
  why.push(
    input.over ? 'The release is over: these figures are final.' : 'The release is not over yet: these figures are the ones so far.',
    sum.sellOutMs !== null
      ? `Sold out ${duration(sum.sellOutMs)} after T0 (the time from T0 to the last piece confirmed${sum.pausedMs > 0 ? `, ${duration(sum.pausedMs)} of pause included` : ''}).`
      : `Not sold out: ${pieces(sum.confirmedPieces)} confirmed of ${count(stock)}.`,
    `The unserved demand of a size: the pieces asked for by those who waited in its line and never had a turn (the release ended first, or they left the line). ${count(sum.unservedPieces)} in all.`,
    `A turn ended in a confirmed piece ${percent(sum.conversion)} of the time (${percent(sum.rates.secureRate ?? 1)} secured, ${percent(sum.rates.payRate ?? 1)} of those confirmed).`,
    `The funnel counts people: the interest (I'LL BE THERE), those who entered the room or the line, had a turn, held the seal, pressed PAY, and whose reservation ORBES Client Services concluded.`,
    `Revenue at the prices of the release and of each add-on as chosen: ${liveMoney(piecesRevenueMinor, r.currency)} for the pieces, ${liveMoney(addonsRevenueMinor, r.currency)} for the add-ons. ${
      sum.cancelled
        ? `The ${sum.cancelled === 1 ? 'reservation' : `${count(sum.cancelled)} reservations`} ORBES Client Services cancelled (${pieces(sum.cancelledPieces)}) ${sum.cancelled === 1 ? 'is' : 'are'} left out, add-ons included.`
        : 'A reservation ORBES Client Services cancels is left out: none so far.'
    }`,
  );
  if (input.additions.length) {
    why.push(
      `Pieces were added after the announcement (« ${r.quantityLine} »): ${input.additions.map((a) => `${count(a.pieces)} in ${a.size} at ${utc(a.at)}`).join('; ')}. Each is in the audit log.`,
    );
  } else {
    why.push(`No piece was added after the announcement (« ${r.quantityLine} »).`);
  }
  const nextTotal = sizes.reduce((n, s) => n + s.nextDemand, 0);
  const next = { quantity: Math.min(DROP_QUANTITY_MAX, nextTotal), sizes: sizes.map((s) => ({ label: s.label, pieces: s.nextDemand })) };
  why.push(
    `Next time, by the release planner's rule applied to what this release measured: each size's pieces confirmed plus its unserved pieces at that conversion, ${next.sizes.map((s) => `${s.label} × ${count(s.pieces)}`).join(', ')}: ${pieces(next.quantity)} for an audience like this one.`,
  );
  return {
    id: r.id,
    title: r.title,
    final: input.over,
    endedReason: r.endedReason,
    opensAt: r.opensAt,
    endedAt: r.endedAt,
    sellOutMs: sum.sellOutMs,
    pausedMs: r.pausedMs,
    currency: r.currency,
    quantityLine: r.quantityLine,
    funnel,
    sizes,
    byTier: TIERS.map((t) => {
      const own = input.entries.filter((e) => e.tier === t);
      return {
        tier: t,
        entries: own.length,
        turns: own.filter((e) => e.turnAt !== null).length,
        secured: own.filter((e) => e.securedAt !== null).length,
        confirmed: own.filter((e) => e.status === 'CONFIRMED').length,
        missed: own.filter((e) => e.status === 'MISSED').length,
        expired: own.filter((e) => e.status === 'EXPIRED').length,
      };
    }),
    missed: sum.missed,
    expired: sum.expired,
    released: sum.released,
    addons,
    cancelled: { reservations: sum.cancelled, pieces: sum.cancelledPieces },
    piecesRevenueMinor,
    addonsRevenueMinor,
    additions: [...input.additions],
    conversion: sum.conversion,
    next,
    reasoning: why,
  };
}

/** The report as a CSV: one figure per row (section, item, value), every field quoted (render/csv.ts). */
export function releaseReportCsv(rep: ReleaseReport): string {
  const ms = (v: number | null) => (v === null ? '' : String(Math.round(v / SECOND)));
  const share = (v: number | null) => (v === null ? '' : v.toFixed(4));
  const rows: string[][] = [['section', 'item', 'value']];
  const add = (section: string, item: string, value: string | number) => rows.push([section, item, String(value)]);
  add('release', 'id', rep.id);
  add('release', 'title', rep.title);
  add('release', 'final', rep.final ? 'yes' : 'no');
  add('release', 'end', rep.endedReason ?? '');
  add('release', 'T0', rep.opensAt.toISOString());
  add('release', 'ended at', rep.endedAt ? rep.endedAt.toISOString() : '');
  add('release', 'seconds to sell out', ms(rep.sellOutMs));
  add('release', 'seconds paused', ms(rep.pausedMs));
  add('release', 'quantity line', rep.quantityLine);
  add('release', 'turn conversion', share(rep.conversion));
  for (const f of rep.funnel) {
    add('funnel', f.step.toLowerCase(), f.people);
    add('funnel', `${f.step.toLowerCase()} share of previous`, share(f.share));
  }
  for (const s of rep.sizes) {
    const k = `size ${s.label}`;
    add(k, 'stock', s.stock);
    add(k, 'pieces added', s.added);
    add(k, 'pieces confirmed', s.confirmedPieces);
    add(k, 'seconds to sell out', ms(s.sellOutMs));
    add(k, 'unserved people', s.unservedPeople);
    add(k, 'unserved pieces', s.unservedPieces);
    add(k, 'missed turns', s.missed);
    add(k, 'ended holds', s.expired);
    add(k, 'places given back', s.released);
  }
  for (const t of rep.byTier) {
    const k = `tier ${t.tier === 0 ? 'none' : tierName(t.tier as ClubTier)!}`;
    for (const [item, v] of [['entries', t.entries], ['turns', t.turns], ['secured', t.secured], ['confirmed', t.confirmed], ['missed turns', t.missed], ['ended holds', t.expired]] as const) add(k, item, v);
  }
  for (const a of rep.addons) {
    add(`add-on ${a.label}`, 'reservations', a.reservations);
    add(`add-on ${a.label}`, 'pieces', a.pieces);
    add(`add-on ${a.label}`, `revenue ${rep.currency}`, majorUnits(a.revenueMinor));
  }
  add('revenue', `pieces ${rep.currency}`, majorUnits(rep.piecesRevenueMinor));
  add('revenue', `add-ons ${rep.currency}`, majorUnits(rep.addonsRevenueMinor));
  add('revenue', 'cancelled reservations left out', rep.cancelled.reservations);
  add('revenue', 'cancelled pieces left out', rep.cancelled.pieces);
  for (const a of rep.additions) add('pieces added', `${a.at.toISOString()} size ${a.size}`, `${a.pieces} (${a.before} to ${a.after})`);
  add('next time', 'quantity', rep.next.quantity);
  for (const s of rep.next.sizes) add('next time', `size ${s.label}`, s.pieces);
  for (const [i, line] of rep.reasoning.entries()) add('reasoning', String(i + 1), line);
  return csvDocument(rows);
}

// ── Collector insights ─────────────────────────────────────────────────────

export interface ConversionRow {
  entered: number;
  secured: number;
  confirmed: number;
  /** confirmed / entered; null for none. */
  conversion: number | null;
}

export interface CollectorInsights {
  byTier: (ConversionRow & { tier: number })[];
  byCountry: (ConversionRow & { country: string | null })[];
  repeat: ConversionRow;
  firstTime: ConversionRow;
  /** Who came but secured no piece: at most LIVE_INSIGHT_RULES.listMax, the total given. */
  unsecured: { total: number; items: { entryId: string; accountId: string; email: string; tier: number; size: string; status: LiveEntryStatus; position: number | null; country: string | null }[] };
  reasoning: string[];
}

const conversionRow = (xs: readonly InsightEntry[]): ConversionRow => {
  const confirmed = xs.filter((e) => e.status === 'CONFIRMED').length;
  return { entered: xs.length, secured: xs.filter((e) => e.securedAt !== null).length, confirmed, conversion: xs.length ? confirmed / xs.length : null };
};

export function collectorInsights(r: InsightRelease, all: readonly InsightEntry[], emails: ReadonlyMap<string, string>, repeatAccounts: ReadonlySet<string>): CollectorInsights {
  const label = new Map(r.sizes.map((s) => [s.id, s.label]));
  // An entry ORBES removed (the bot radar's, a locked account's) is not a collector's visit: left out of every figure.
  const entries = all.filter((e) => e.status !== 'REMOVED');
  const removed = all.length - entries.length;
  const countries = [...new Set(entries.map((e) => e.country))];
  const byCountry = countries
    .map((c) => ({ country: c, ...conversionRow(entries.filter((e) => e.country === c)) }))
    .sort((a, b) => b.entered - a.entered || (a.country === null ? 1 : b.country === null ? -1 : a.country < b.country ? -1 : 1));
  const repeat = conversionRow(entries.filter((e) => repeatAccounts.has(e.accountId)));
  const firstTime = conversionRow(entries.filter((e) => !repeatAccounts.has(e.accountId)));
  const without = entries
    .filter((e) => e.securedAt === null)
    .sort((a, b) => b.tier - a.tier || (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.joinedAt.getTime() - b.joinedAt.getTime());
  const rate = (x: ConversionRow) => (x.conversion === null ? 'none' : percent(x.conversion));
  return {
    byTier: TIERS.map((t) => ({ tier: t, ...conversionRow(entries.filter((e) => e.tier === t)) })),
    byCountry,
    repeat,
    firstTime,
    unsecured: {
      total: without.length,
      items: without.slice(0, LIVE_INSIGHT_RULES.listMax).map((e) => ({
        entryId: e.id,
        accountId: e.accountId,
        email: emails.get(e.accountId) ?? '',
        tier: e.tier,
        size: label.get(e.sizeId) ?? '',
        status: e.status,
        position: e.position,
        country: e.country,
      })),
    },
    reasoning: [
      `The conversion of a group: those who pressed PAY, of those who entered${removed ? ` (${count(removed)} ${removed === 1 ? 'entry' : 'entries'} removed by ORBES left out)` : ''}.`,
      'The tier is the club\'s at the entry, read again at T0 for the line. The country is the entry\'s, from the geolocation of its address (the country only; none when it could not be read).',
      `A repeat collector entered an earlier LIVE RELEASE: ${people(repeat.entered)}, ${rate(repeat)} converted, against ${rate(firstTime)} for the ${people(firstTime.entered)} here for the first time.`,
      `${people(without.length)} came and secured no piece, the highest tiers first: the people to address in the circle.`,
    ],
  };
}

// ── Release comparison ─────────────────────────────────────────────────────

export interface ComparedRelease {
  id: string;
  title: string;
  current: boolean;
  opensAt: Date;
  endedReason: LiveEndReason | null;
  currency: string;
  priceMinor: number;
  stock: number;
  added: number;
  interest: number;
  room: number;
  presentAtT0: number;
  turns: number;
  secured: number;
  confirmedPieces: number;
  /** confirmed pieces / stock. */
  sellThrough: number | null;
  sellOutMs: number | null;
  /** missed / turns. */
  missedShare: number | null;
  expired: number;
  conversion: number;
  piecesRevenueMinor: number;
  addonsRevenueMinor: number;
}

export interface ReleaseComparison {
  releases: ComparedRelease[];
  reasoning: string[];
}

export function compareReleases(rows: readonly { summary: ReleaseSummary; current: boolean; added: number; addonsRevenueMinor: number }[]): ReleaseComparison {
  return {
    releases: rows.map(({ summary: s, current, added, addonsRevenueMinor }) => ({
      id: s.id,
      title: s.title,
      current,
      opensAt: s.opensAt,
      endedReason: s.endedReason,
      currency: s.currency,
      priceMinor: s.priceMinor,
      stock: s.stock,
      added,
      interest: s.interest,
      room: s.room,
      presentAtT0: s.presentAtT0,
      turns: s.turns,
      secured: s.secured,
      confirmedPieces: s.confirmedPieces,
      sellThrough: s.stock > 0 ? s.confirmedPieces / s.stock : null,
      sellOutMs: s.sellOutMs,
      missedShare: s.turns > 0 ? s.missed / s.turns : null,
      expired: s.expired,
      conversion: s.conversion,
      piecesRevenueMinor: (s.confirmedPieces - s.cancelledPieces) * s.priceMinor,
      addonsRevenueMinor,
    })),
    reasoning: [
      `The release beside the others whose T0 has passed (the latest ${count(LIVE_INSIGHT_RULES.pastReleases)}, cancelled ones and after-rooms left out), latest first.`,
      'The room counts everyone who entered; the line at T0, those placed at T0 itself. The sell-through: the pieces confirmed of the stock (the pieces added included). The missed share: the turns that ran out, of every turn.',
      'The time to sell out runs from T0 to the last piece confirmed, pauses included. A release not over yet shows its figures so far.',
      'The revenue: the pieces and add-ons of the confirmed reservations at their prices, those ORBES Client Services cancelled left out.',
    ],
  };
}

// ── Service ────────────────────────────────────────────────────────────────

/** Eligibility of the accounts holding pieces now: their counted pieces, the models and collections they hold. */
interface Holder {
  accountId: string;
  pieces: number;
  models: Set<string>;
  collections: Set<string>;
}

interface Eligibility {
  /** ACTIVE accounts in all. */
  active: number;
  holders: Holder[];
}

interface Rule {
  minTier: number;
  models: readonly string[];
  collectionId: string | null;
  /**
   * The accounts a release's rules let in now, read by live.ts accessAccounts when it has a rule of taking part or of a
   * segment, or combines its rules by OR (plan LIVE RELEASE+); null: the tier and the pieces alone, read from `Holder`.
   */
  accounts: Set<string> | null;
}

/** Whether a holder of pieces is let in by a rule. */
function allowedBy(h: Holder, rule: Rule): boolean {
  if (rule.accounts) return rule.accounts.has(h.accountId);
  if (tierForPieces(h.pieces) < rule.minTier) return false;
  if (rule.models.length === 0 && rule.collectionId === null) return true;
  return rule.models.some((m) => h.models.has(m)) || (rule.collectionId !== null && h.collections.has(rule.collectionId));
}

/**
 * The eligible accounts of a rule by tier (0 to 3): a tier from `minTier`, and a piece of a model or collection it names;
 * or, for a release whose rules go beyond them, the accounts they let in now, each at its tier.
 */
function eligibleOf(el: Eligibility, rule: Rule): number[] {
  const out = [0, 0, 0, 0];
  let holders = 0;
  for (const h of el.holders) {
    if (!allowedBy(h, rule)) continue;
    out[tierForPieces(h.pieces)] += 1;
    holders += 1;
  }
  // The accounts holding no piece the club counts: tier 0, never the owners of a named model or collection.
  const named = rule.models.length > 0 || rule.collectionId !== null;
  if (rule.accounts) out[0] += Math.max(0, rule.accounts.size - holders);
  else if (rule.minTier === 0 && !named) out[0] += Math.max(0, el.active - el.holders.length);
  return out;
}

export interface LiveInsightsServiceDeps {
  db: Db;
  clock?: Clock;
}

export class LiveInsightsService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: LiveInsightsServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The readings ─────────────────────────────────────────────────────────

  /** The release planner: the quantity and size mix suggested for this release, now. */
  async plan(dropId: string): Promise<ReleasePlan> {
    const now = this.clock();
    const { d, release, rule, modelType } = await this.release(dropId);
    const [el, past, interest] = await Promise.all([this.eligibility(), this.past(d, now), this.interest(d.id)]);
    const forecast = audienceForecast({ interest: interest.length, eligibleByTier: eligibleOf(el, rule), past: past.map((p) => p.audience(el)), inRoom: await this.inRoom(d, now) });
    const eligible = new Set(el.holders.filter((h) => allowedBy(h, rule)).map((h) => h.accountId));
    const variants = await this.variants(modelType);
    const collectorsBySize = new Map<string, number>();
    for (const v of variants) if (eligible.has(v.accountId)) collectorsBySize.set(v.size, (collectorsBySize.get(v.size) ?? 0) + 1);
    const interestBySize = new Map<string, number>();
    for (const i of interest) interestBySize.set(i.sizeId, (interestBySize.get(i.sizeId) ?? 0) + 1);
    return releasePlan({ sizes: release.sizes, forecast, past: past.map((p) => p.summary), interestBySize, collectorsBySize, modelType });
  }

  /**
   * The size mix a new release of a model is proposed (plan LIVE RELEASE+, choice 13, L1; services/release-stock.ts
   * sizeMix): the sizes in stock at the location (the default one when none is given) first, then the planner's demand
   * per size, read as for a release open to every ORBES account opening now (once created, its page's planner reads its
   * own rules).
   */
  async sizeMix(modelId: string, locationId: string | null): Promise<SizeMix> {
    if (typeof modelId !== 'string' || !UUID_RE.test(modelId)) throw notFound('Model', 'MODEL_NOT_FOUND');
    const model = await this.db.selectFrom('models').select(['id', 'name', 'type']).where('id', '=', modelId.toLowerCase()).executeTakeFirst();
    if (!model) throw notFound('Model', 'MODEL_NOT_FOUND');
    const locId = locationId ? await knownLocation(this.db, locationId) : await defaultLocationId(this.db);
    const now = this.clock();
    const [location, balances, el, past, variants] = await Promise.all([
      this.db.selectFrom('stock_locations').select(['id', 'name']).where('id', '=', locId).executeTakeFirstOrThrow(),
      stockBalances(this.db, { modelId: model.id, locationId: locId }),
      this.eligibility(),
      this.past({ id: '00000000-0000-0000-0000-000000000000', opens_at: now }, now),
      this.variants(model.type),
    ]);
    const stock = balances.map((b) => ({ label: releaseSizeLabel(b.sku.sizeLabel), available: Math.max(0, b.available) }));
    const open: Rule = { minTier: 0, models: [], collectionId: null, accounts: null };
    const forecast = audienceForecast({ interest: 0, eligibleByTier: eligibleOf(el, open), past: past.map((p) => p.audience(el)), inRoom: null });
    const collectorsBySize = new Map<string, number>();
    for (const v of variants) collectorsBySize.set(v.size, (collectorsBySize.get(v.size) ?? 0) + 1);
    const labels = [...new Set([...stock.map((x) => x.label.trim().toUpperCase()), ...collectorsBySize.keys()])].filter((l) => l.length > 0);
    const plan = releasePlan({
      sizes: labels.map((l) => ({ id: l, label: l, stock: stock.filter((x) => x.label.trim().toUpperCase() === l).reduce((n, x) => n + x.available, 0) })),
      forecast,
      past: past.map((p) => p.summary),
      interestBySize: new Map(),
      collectorsBySize,
      modelType: model.type,
    });
    return sizeMix({
      model: { id: model.id, name: model.name },
      location,
      stock,
      planned: plan.quantity,
      demand: plan.sizes.map((x) => ({ label: x.label, pieces: x.suggested ?? 0 })),
      plannerReasoning: ['The planner, as for a release open to every ORBES account opening now:', ...forecast.reasoning, ...plan.reasoning],
    });
  }

  /** The audience forecast: the room expected at T0. */
  async forecast(dropId: string): Promise<AudienceForecast> {
    const now = this.clock();
    const { d, rule } = await this.release(dropId);
    const [el, past, interest, inRoom] = await Promise.all([this.eligibility(), this.past(d, now), this.interest(d.id), this.inRoom(d, now)]);
    return audienceForecast({ interest: interest.length, eligibleByTier: eligibleOf(el, rule), past: past.map((p) => p.audience(el)), inRoom });
  }

  /** The demand radar, before T0. */
  async radar(dropId: string): Promise<DemandRadar> {
    const now = this.clock();
    const { d, release } = await this.release(dropId);
    const [entries, interest, past] = await Promise.all([this.entries([d.id]), this.interest(d.id), this.past(d, now)]);
    const standings = await clubStandings(this.db, interest.map((i) => i.accountId), now);
    const pastEntries = past.flatMap((p) => p.entries);
    return demandRadar({
      release,
      room: entries.filter((e) => e.status === 'WAITING'),
      interest: interest.map((i) => ({ sizeId: i.sizeId, tier: standings.get(i.accountId)?.tier ?? 0 })),
      past: pastEntries.length ? lineRates(pastEntries) : null,
      now,
    });
  }

  /** The bot radar: the entries of the release that show a sign. */
  async bots(dropId: string): Promise<BotRadar> {
    const { d, release } = await this.release(dropId);
    const rows = await this.db
      .selectFrom('live_entries as e')
      .innerJoin('accounts as a', 'a.id', 'e.account_id')
      .select(['e.id', 'a.email', 'a.created_at', 'e.network_hash'])
      .where('e.drop_id', '=', d.id)
      .execute();
    const entries = new Map((await this.entries([d.id])).map((e) => [e.id, e]));
    const accounts = [...new Set([...entries.values()].map((e) => e.accountId))];
    const gestures = new Map<string, number[]>();
    for (let i = 0; i < accounts.length; i += 1000) {
      const held = await this.db
        .selectFrom('live_entries as e')
        .innerJoin('drops as d', 'd.id', 'e.drop_id')
        .select(['e.account_id', 'e.gesture_ms'])
        .where('e.account_id', 'in', accounts.slice(i, i + 1000))
        .where('e.gesture_ms', 'is not', null)
        .where('d.mode', '=', 'LIVE')
        .execute();
      for (const g of held) gestures.set(g.account_id, [...(gestures.get(g.account_id) ?? []), g.gesture_ms!]);
    }
    const facts: BotEntryFacts[] = rows.map((row) => {
      const e = entries.get(row.id)!;
      return { entry: e, email: row.email, accountCreatedAt: row.created_at, network: row.network_hash ? Buffer.from(row.network_hash).toString('hex') : null, gestures: gestures.get(e.accountId) ?? [] };
    });
    return botRadar(release, facts);
  }

  /** The live board's alerts and sell-out forecast (LiveConsoleService.board), from T0 until the release is over. */
  async signals(d: DropRow, now: Date): Promise<LiveSignals> {
    if (now.getTime() < d.opens_at.getTime()) return { alerts: [], sellOut: null };
    const [sizes, entries] = await Promise.all([this.sizes(d.id), this.entries([d.id])]);
    const release = insightRelease(d, sizes);
    // The audit log is read only when it can change a reading: a turn due long enough to be a stall without a console
    // action since, or a pause that has ended (the pace is read from the latest RESUME).
    const due = dueTurns(release, entries, now).some((c) => now.getTime() - c.since >= LIVE_INSIGHT_RULES.stallSeconds * SECOND);
    const controls = due || release.pausedMs > 0 ? await this.controlTimes(d.id) : { resumedAt: null, stockAt: null };
    return { alerts: liveAlerts(release, entries, controls, now), sellOut: sellOutForecast(release, entries, controls, now) };
  }

  /** The release report (final once the release is over). */
  async report(dropId: string): Promise<ReleaseReport> {
    const now = this.clock();
    const { d, release } = await this.release(dropId);
    const [entries, interest, addons, additions] = await Promise.all([this.entries([d.id]), this.interest(d.id), this.addonFacts(d.id), this.additions(d.id)]);
    const holding = entries.some((e) => e.status === 'TURN' || e.status === 'SECURED');
    return releaseReport({ release, entries, interest: interest.length, addons: addons.addons, entryAddons: addons.chosen, additions, over: livePhase(d, now) === 'ENDED' && !holding });
  }

  /** The report as a CSV download. */
  async reportCsv(dropId: string): Promise<{ filename: string; contentType: string; body: string }> {
    const rep = await this.report(dropId);
    const day = this.clock().toISOString().slice(0, 10);
    return { filename: `ORBES-live-${rep.id.slice(0, 8).toUpperCase()}-report-${day}.csv`, contentType: CSV_CONTENT_TYPE, body: releaseReportCsv(rep) };
  }

  /** The collector insights; emails as stored (the routes mask them for an AUDITOR). */
  async collectors(dropId: string): Promise<CollectorInsights> {
    const { d, release } = await this.release(dropId);
    const entries = await this.entries([d.id]);
    const ids = [...new Set(entries.map((e) => e.accountId))];
    const emails = new Map<string, string>();
    const repeat = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      for (const a of await this.db.selectFrom('accounts').select(['id', 'email']).where('id', 'in', chunk).execute()) emails.set(a.id, a.email);
      const earlier = await this.db
        .selectFrom('live_entries as e')
        .innerJoin('drops as x', 'x.id', 'e.drop_id')
        .select('e.account_id')
        .distinct()
        .where('e.account_id', 'in', chunk)
        .where('x.mode', '=', 'LIVE')
        .where('x.parent_drop_id', 'is', null)
        .where('x.id', '!=', d.id)
        .where('x.opens_at', '<', d.opens_at)
        .execute();
      for (const r of earlier) repeat.add(r.account_id);
    }
    return collectorInsights(release, entries, emails, repeat);
  }

  /** The release beside the others whose T0 has passed (after-rooms left out: each is part of its release). */
  async comparison(dropId: string): Promise<ReleaseComparison> {
    const now = this.clock();
    const { d } = await this.release(dropId);
    const others = await this.db
      .selectFrom('drops')
      .selectAll()
      .where('mode', '=', 'LIVE')
      .where('parent_drop_id', 'is', null)
      .where('published_at', 'is not', null)
      .where('cancelled_at', 'is', null)
      .where('opens_at', '<=', now)
      .where('id', '!=', d.id)
      .orderBy('opens_at', 'desc')
      .orderBy('id')
      .limit(LIVE_INSIGHT_RULES.pastReleases)
      .execute();
    const all = [d, ...others].sort((a, b) => b.opens_at.getTime() - a.opens_at.getTime() || (a.id < b.id ? -1 : 1));
    const ids = all.map((x) => x.id);
    const [sizes, entries, interest, revenue, additions] = await Promise.all([this.sizesOf(ids), this.entries(ids), this.interestCounts(ids), this.addonRevenue(ids), this.additionsOf(ids)]);
    return compareReleases(
      all.map((x) => ({
        summary: summarize(insightRelease(x, sizes.get(x.id) ?? []), entries.filter((e) => e.dropId === x.id), interest.get(x.id) ?? 0),
        current: x.id === d.id,
        added: additions.get(x.id) ?? 0,
        addonsRevenueMinor: revenue.get(x.id) ?? 0,
      })),
    );
  }

  /**
   * What each of these LIVE RELEASES measured (`summarize`, as the comparison reads it), by id; an id that is not a LIVE
   * RELEASE is left out. GROWTH's Latest releases (plan NEXT-NINE, BP-29; services/growth.ts) reads it.
   */
  async summaries(dropIds: readonly string[]): Promise<Map<string, ReleaseSummary>> {
    const ids = [...new Set(dropIds.filter((id) => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase()))];
    if (ids.length === 0) return new Map();
    const drops = await this.db.selectFrom('drops').selectAll().where('id', 'in', ids).where('mode', '=', 'LIVE').execute();
    const live = drops.map((x) => x.id);
    const [sizes, entries, interest] = await Promise.all([this.sizesOf(live), this.entries(live), this.interestCounts(live)]);
    return new Map(drops.map((x) => [x.id, summarize(insightRelease(x, sizes.get(x.id) ?? []), entries.filter((e) => e.dropId === x.id), interest.get(x.id) ?? 0)]));
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** A LIVE RELEASE (404 DROP_NOT_FOUND for anything else), its sizes, its rule and its model's type. */
  private async release(dropId: string): Promise<{ d: DropRow; release: InsightRelease; rule: Rule; modelType: string }> {
    if (typeof dropId !== 'string' || !UUID_RE.test(dropId)) throw dropNotFound();
    const id = dropId.toLowerCase();
    const d = await this.db.selectFrom('drops').selectAll().where('id', '=', id).where('mode', '=', 'LIVE').executeTakeFirst();
    if (!d) throw dropNotFound();
    const [sizes, models, model] = await Promise.all([
      this.sizes(id),
      this.db.selectFrom('live_access_models').select('model_id').where('drop_id', '=', id).execute(),
      this.db.selectFrom('models').select('type').where('id', '=', d.model_id).executeTakeFirstOrThrow(),
    ]);
    return {
      d,
      release: insightRelease(d, sizes),
      rule: { minTier: d.live_min_tier ?? 0, models: models.map((m) => m.model_id), collectionId: d.access_collection_id, accounts: await accessAccounts(this.db, d, this.clock()) },
      modelType: model.type,
    };
  }


  private sizes(dropId: string): Promise<InsightSize[]> {
    return this.db.selectFrom('drop_sizes').select(['id', 'label', 'stock']).where('drop_id', '=', dropId).orderBy('position').execute();
  }

  private async sizesOf(ids: readonly string[]): Promise<Map<string, InsightSize[]>> {
    const out = new Map<string, InsightSize[]>();
    if (ids.length === 0) return out;
    const rows = await this.db.selectFrom('drop_sizes').select(['drop_id', 'id', 'label', 'stock']).where('drop_id', 'in', [...ids]).orderBy('drop_id').orderBy('position').execute();
    for (const r of rows) out.set(r.drop_id, [...(out.get(r.drop_id) ?? []), { id: r.id, label: r.label, stock: r.stock }]);
    return out;
  }

  /** The entries of releases, as the rules read them. */
  private async entries(dropIds: readonly string[]): Promise<(InsightEntry & { dropId: string })[]> {
    if (dropIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('live_entries as e')
      .select([
        'id', 'drop_id', 'account_id', 'size_id', 'quantity', 'status', 'tier', 'position', 'joined_at', 'queued_at', 'turn_at', 'turn_expires_at', 'secured_at',
        'hold_expires_at', 'confirmed_at', 'ended_at', 'gesture_ms', 'country', 'guarantee_id',
      ])
      .select(entryOutcome.as('resolution'))
      .where('drop_id', 'in', [...dropIds])
      .orderBy('drop_id')
      .orderBy(sql`position IS NULL`)
      .orderBy('position')
      .orderBy('joined_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      dropId: r.drop_id,
      accountId: r.account_id,
      sizeId: r.size_id,
      quantity: r.quantity,
      status: r.status,
      tier: r.tier,
      position: r.position,
      joinedAt: r.joined_at,
      queuedAt: r.queued_at,
      turnAt: r.turn_at,
      turnExpiresAt: r.turn_expires_at,
      securedAt: r.secured_at,
      holdExpiresAt: r.hold_expires_at,
      confirmedAt: r.confirmed_at,
      endedAt: r.ended_at,
      gestureMs: r.gesture_ms,
      resolution: r.resolution,
      country: r.country,
      guaranteed: r.guarantee_id !== null,
    }));
  }

  private interest(dropId: string): Promise<{ accountId: string; sizeId: string }[]> {
    return this.db.selectFrom('live_interest').select(['account_id as accountId', 'size_id as sizeId']).where('drop_id', '=', dropId).execute();
  }

  private async interestCounts(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.selectFrom('live_interest').select((eb) => ['drop_id', eb.fn.countAll<number>().as('n')]).where('drop_id', 'in', [...ids]).groupBy('drop_id').execute();
    return new Map(rows.map((r) => [r.drop_id, Number(r.n)]));
  }

  /** In the room now (WAITING), from its opening until T0; null otherwise. */
  private async inRoom(d: DropRow, now: Date): Promise<number | null> {
    const phase: LivePhase = livePhase(d, now);
    if (phase !== 'ROOM') return null;
    const r = await this.db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', d.id).where('status', '=', 'WAITING').executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** Every ACTIVE account holding a piece the club counts: its pieces, its models and collections. */
  private async eligibility(): Promise<Eligibility> {
    const [rows, active] = await Promise.all([
      this.db
        .selectFrom('ownership as o')
        .innerJoin('products as p', 'p.id', 'o.product_id')
        .innerJoin('models as m', 'm.id', 'p.model_id')
        .innerJoin('accounts as a', 'a.id', 'o.account_id')
        .select((eb) => [
          'o.account_id',
          eb.fn.countAll<number>().as('pieces'),
          sql<string[]>`array_agg(DISTINCT p.model_id::text)`.as('models'),
          sql<(string | null)[]>`array_agg(DISTINCT coalesce(p.collection_id, m.collection_id)::text)`.as('collections'),
        ])
        .where('o.ended_at', 'is', null)
        .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
        .where('a.status', '=', 'ACTIVE')
        .groupBy('o.account_id')
        .execute(),
      this.db.selectFrom('accounts').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow(),
    ]);
    return {
      active: Number(active.n),
      holders: rows.map((r) => ({
        accountId: r.account_id,
        pieces: Number(r.pieces),
        models: new Set((r.models ?? []).filter((x): x is string => typeof x === 'string')),
        collections: new Set((r.collections ?? []).filter((x): x is string => typeof x === 'string')),
      })),
    };
  }

  /** Each account's size in a model's type: the variant of its latest piece of that type (a piece the club counts). */
  private async variants(modelType: string): Promise<{ accountId: string; size: string }[]> {
    const rows = await this.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .innerJoin('models as m', 'm.id', 'p.model_id')
      .select(['o.account_id', 'p.variant'])
      .distinctOn('o.account_id')
      .where('o.ended_at', 'is', null)
      .where('p.status', 'not in', [...CLUB_EXCLUDED_STATUSES])
      .where('p.variant', 'is not', null)
      .where('m.type', '=', modelType)
      .orderBy('o.account_id')
      .orderBy('o.started_at', 'desc')
      .orderBy('p.id')
      .execute();
    return rows.map((r) => ({ accountId: r.account_id, size: String(r.variant).trim().toUpperCase() })).filter((r) => r.size !== '');
  }

  /**
   * The past releases (published, not cancelled, ended or closed by now, T0 before this one's; never an after-room, a
   * second door for a sold-out line, not a release of its own), the latest LIVE_INSIGHT_RULES.pastReleases by T0: their summaries, their entries, and their audience under their rule.
   */
  private async past(d: Pick<DropRow, 'id' | 'opens_at'>, now: Date) {
    const rows = await this.db
      .selectFrom('drops')
      .selectAll()
      .where('mode', '=', 'LIVE')
      .where('parent_drop_id', 'is', null)
      .where('published_at', 'is not', null)
      .where('cancelled_at', 'is', null)
      .where('id', '!=', d.id)
      .where('opens_at', '<', d.opens_at)
      .where((eb) => eb.or([eb('ended_at', 'is not', null), eb('closes_at', '<=', now)]))
      .orderBy('opens_at', 'desc')
      .orderBy('id')
      .limit(LIVE_INSIGHT_RULES.pastReleases)
      .execute();
    const ids = rows.map((r) => r.id);
    const [sizes, entries, interest, models] = await Promise.all([
      this.sizesOf(ids),
      this.entries(ids),
      this.interestCounts(ids),
      ids.length ? this.db.selectFrom('live_access_models').select(['drop_id', 'model_id']).where('drop_id', 'in', ids).execute() : Promise.resolve([]),
    ]);
    const accounts = await Promise.all(rows.map((p) => accessAccounts(this.db, p, now)));
    return rows.map((p, i) => {
      const own = entries.filter((e) => e.dropId === p.id);
      const summary = summarize(insightRelease(p, sizes.get(p.id) ?? []), own, interest.get(p.id) ?? 0);
      const rule: Rule = { minTier: p.live_min_tier ?? 0, models: models.filter((m) => m.drop_id === p.id).map((m) => m.model_id), collectionId: p.access_collection_id, accounts: accounts[i]! };
      return {
        summary,
        entries: own,
        audience: (el: Eligibility): PastAudience => ({
          title: p.title,
          interest: summary.interest,
          presentAtT0: summary.presentAtT0,
          presentByTier: summary.presentByTier,
          eligibleByTier: eligibleOf(el, rule),
        }),
      };
    });
  }

  /** The add-ons of a release and those chosen with each entry, at their price then. */
  private async addonFacts(dropId: string): Promise<{ addons: AddonFact[]; chosen: EntryAddonFact[] }> {
    const [addons, chosen] = await Promise.all([
      this.db.selectFrom('live_addons').select(['id', 'label']).where('drop_id', '=', dropId).orderBy('position').execute(),
      this.db
        .selectFrom('live_entry_addons as x')
        .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
        .select(['x.entry_id as entryId', 'x.addon_id as addonId', 'x.price_minor as priceMinor'])
        .where('e.drop_id', '=', dropId)
        .execute(),
    ]);
    return { addons, chosen };
  }

  /** The add-ons' revenue of confirmed reservations, per release; those ORBES Client Services cancelled left out. */
  private async addonRevenue(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('live_entry_addons as x')
      .innerJoin('live_entries as e', 'e.id', 'x.entry_id')
      .select((eb) => ['e.drop_id', eb.fn.sum<number>(sql`x.price_minor * e.quantity`).as('minor')])
      .where('e.drop_id', 'in', [...ids])
      .where('e.status', '=', 'CONFIRMED')
      .where(sql<boolean>`(${entryOutcome}) IS DISTINCT FROM 'CANCELLED'`)
      .groupBy('e.drop_id')
      .execute();
    return new Map(rows.map((r) => [r.drop_id, Number(r.minor ?? 0)]));
  }

  /** Every ADD PIECES of a release, from the audit log (`drop.live.stock`), the earliest first. */
  private async additions(dropId: string): Promise<StockAddition[]> {
    const rows = await this.db
      .selectFrom('audit_logs')
      .select(['occurred_at', 'details'])
      .where('target_type', '=', 'drop')
      .where('target_id', '=', dropId)
      .where('action', '=', 'drop.live.stock')
      .orderBy('id')
      .execute();
    return rows.map((r) => {
      const x = r.details as Record<string, unknown>;
      return { at: r.occurred_at, sizeId: String(x.sizeId ?? ''), size: String(x.size ?? ''), pieces: Number(x.pieces ?? 0), before: Number(x.before ?? 0), after: Number(x.after ?? 0) };
    });
  }

  /** The pieces added to each release (`drop.live.stock`). */
  private async additionsOf(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('audit_logs')
      .select(['target_id', 'details'])
      .where('target_type', '=', 'drop')
      .where('target_id', 'in', [...ids])
      .where('action', '=', 'drop.live.stock')
      .execute();
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.target_id!, (out.get(r.target_id!) ?? 0) + Number((r.details as Record<string, unknown>).pieces ?? 0));
    return out;
  }

  /** The latest RESUME and ADD PIECES of a release, from the audit log. */
  private async controlTimes(dropId: string): Promise<LiveControlTimes> {
    const rows = await this.db
      .selectFrom('audit_logs')
      .select((eb) => ['action', eb.fn.max('occurred_at').as('at')])
      .where('target_type', '=', 'drop')
      .where('target_id', '=', dropId)
      .where('action', 'in', ['drop.live.resume', 'drop.live.stock'])
      .groupBy('action')
      .execute();
    const at = (action: string) => {
      const v = rows.find((r) => r.action === action)?.at;
      return v ? new Date(v as Date) : null;
    };
    return { resumedAt: at('drop.live.resume'), stockAt: at('drop.live.stock') };
  }
}
