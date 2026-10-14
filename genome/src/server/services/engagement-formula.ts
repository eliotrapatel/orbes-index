/**
 * The engagement score's formula (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.5 SB.3.1 and SB.3.3, step 7.2; the
 * owner's answer to question 13 for the spend steps): a score from 0 to 100, the sum of five parts, each read in steps
 * over the 12 months before the run. Pure functions and constants, no database: services/engagement.ts reads the
 * figures and writes the rows.
 *
 *   Recency      up to 25   the time since the latest act of the collector (a scan of an ORBES CODE, a draw entry, a
 *                           LIVE RELEASE entry, I'LL BE THERE, an order, a piece registered; never a page view or a
 *                           sign-in). The bounds are inclusive: « within 7 days » is 7 days or less.
 *   Frequency    up to 20   the Paris calendar days with at least one act.
 *   Spend        up to 25   the purchases as GROWTH counts them, in euros (the other currencies at SPEND_EUR_RATES):
 *                           any purchase, then from € 150, € 350, € 700 and € 1 500 (question 13: « lower steps because
 *                           price range 70-350 euro per piece »). A piece with no known price is a purchase of € 0.
 *   Release speed  up to 10 how soon after a release opens the collector enters it: the median, in whole minutes, over
 *                           the releases taken part in.
 *   Attendance   up to 20   the releases taken part in, out of those open to the collector: half of them or more gives
 *                           the whole part.
 *
 * Every figure of the formula is a constant below, gathered in FORMULA_CONSTANTS. Changing any of them raises
 * ENGAGEMENT_FORMULA by one, and the next run recalculates every account (a row made by another formula is rewritten);
 * test/services/engagement-formula.test.ts pins the constants' hash with the formula's number, so one cannot move
 * without the other. FORMULA_LINES, the sentences the client sheet shows under « How the score is calculated », are
 * written from the same constants: the words never disagree with the code.
 *
 * Staff only: nothing of this file reaches a collector.
 */
import { HOUSE_CURRENCIES, type ScoreActKind, type ScoreOtherCurrency } from '../db/schema.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** The formula's version: raised by one whenever a constant below changes. */
export const ENGAGEMENT_FORMULA = 1;

/** The window every part looks in: the days before the run (12 months). */
export const ENGAGEMENT_WINDOW_DAYS = 365;

/** The most each part gives; their sum is 100. */
export const PART_MAX = Object.freeze({ recency: 25, frequency: 20, spend: 25, speed: 10, attendance: 20 } as const);
export type EngagementPart = keyof typeof PART_MAX;
export const ENGAGEMENT_PARTS = Object.freeze(['recency', 'frequency', 'spend', 'speed', 'attendance'] as const satisfies readonly EngagementPart[]);

/** Recency: the latest act within `days` (inclusive) gives `points`; none in the window gives 0. */
export const RECENCY_STEPS: readonly { readonly days: number; readonly points: number }[] = Object.freeze([
  Object.freeze({ days: 7, points: 25 }),
  Object.freeze({ days: 30, points: 20 }),
  Object.freeze({ days: 90, points: 14 }),
  Object.freeze({ days: 180, points: 8 }),
  Object.freeze({ days: 365, points: 3 }),
]);

/** Frequency: `from` active days or more give `points`; none gives 0. */
export const FREQUENCY_STEPS: readonly { readonly from: number; readonly points: number }[] = Object.freeze([
  Object.freeze({ from: 1, points: 4 }),
  Object.freeze({ from: 2, points: 8 }),
  Object.freeze({ from: 4, points: 12 }),
  Object.freeze({ from: 7, points: 16 }),
  Object.freeze({ from: 12, points: 20 }),
]);

/** Spend: the steps in euro cents (question 13: € 150, € 350, € 700, € 1 500 in 12 months). */
export const SPEND_STEPS_EUR_MINOR: readonly number[] = Object.freeze([15_000, 35_000, 70_000, 150_000]);
/** Spend: the points of a purchase below the first step, then of each step reached. */
export const SPEND_POINTS: readonly number[] = Object.freeze([8, 13, 18, 22, 25]);

/** Release speed: a median of `minutes` or less gives `points` (0: there at the opening); later than the last gives SPEED_LATER_POINTS; no release gives 0. */
export const SPEED_STEPS_MINUTES: readonly { readonly minutes: number; readonly points: number }[] = Object.freeze([
  Object.freeze({ minutes: 0, points: 10 }),
  Object.freeze({ minutes: 5, points: 9 }),
  Object.freeze({ minutes: 30, points: 7 }),
  Object.freeze({ minutes: 120, points: 5 }),
  Object.freeze({ minutes: 1440, points: 3 }),
]);
export const SPEED_LATER_POINTS = 1;

/** Attendance: this share of the open releases taken part in, or more, gives the whole part. */
export const ATTENDANCE_FULL_SHARE = 0.5;

/** One unit of each house currency in euros: fixed rates, since the score is one number (GROWTH never converts). */
export const SPEND_EUR_RATES: Readonly<Record<(typeof HOUSE_CURRENCIES)[number], number>> = Object.freeze({ EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.06 });

/** Every figure of the formula, as the test's hash and FORMULA_LINES read them. */
export interface FormulaConstants {
  windowDays: number;
  partMax: Readonly<Record<EngagementPart, number>>;
  recencySteps: readonly { readonly days: number; readonly points: number }[];
  frequencySteps: readonly { readonly from: number; readonly points: number }[];
  spendStepsEurMinor: readonly number[];
  spendPoints: readonly number[];
  speedStepsMinutes: readonly { readonly minutes: number; readonly points: number }[];
  speedLaterPoints: number;
  attendanceFullShare: number;
  spendEurRates: Readonly<Record<string, number>>;
}

export const FORMULA_CONSTANTS: FormulaConstants = Object.freeze({
  windowDays: ENGAGEMENT_WINDOW_DAYS,
  partMax: PART_MAX,
  recencySteps: RECENCY_STEPS,
  frequencySteps: FREQUENCY_STEPS,
  spendStepsEurMinor: SPEND_STEPS_EUR_MINOR,
  spendPoints: SPEND_POINTS,
  speedStepsMinutes: SPEED_STEPS_MINUTES,
  speedLaterPoints: SPEED_LATER_POINTS,
  attendanceFullShare: ATTENDANCE_FULL_SHARE,
  spendEurRates: SPEND_EUR_RATES,
});

const DAY_MS = 86_400_000;

// ── The five parts ─────────────────────────────────────────────────────────

/** Recency: the points of the latest act at `now` (the bounds inclusive); 0 without an act, or with one older than the last step. */
export function recencyPoints(lastActAt: Date | null, now: Date): number {
  if (lastActAt === null) return 0;
  const age = now.getTime() - lastActAt.getTime();
  for (const step of RECENCY_STEPS) if (age <= step.days * DAY_MS) return step.points;
  return 0;
}

/** Frequency: the points of `days` active days. */
export function frequencyPoints(days: number): number {
  let points = 0;
  for (const step of FREQUENCY_STEPS) if (days >= step.from) points = step.points;
  return points;
}

/** Spend: the points of `eurMinor` euro cents over `purchases` purchases; no purchase gives 0, any purchase at least the first points. */
export function spendPoints(eurMinor: number, purchases: number): number {
  if (!(purchases > 0)) return 0;
  let points = SPEND_POINTS[0]!;
  SPEND_STEPS_EUR_MINOR.forEach((from, i) => {
    if (eurMinor >= from) points = SPEND_POINTS[i + 1]!;
  });
  return points;
}

/** Release speed: the points of a median of `medianMinutes` whole minutes; null (no release) gives 0. */
export function speedPoints(medianMinutes: number | null): number {
  if (medianMinutes === null) return 0;
  for (const step of SPEED_STEPS_MINUTES) if (medianMinutes <= step.minutes) return step.points;
  return SPEED_LATER_POINTS;
}

/** Attendance: `taken` of `open` releases; ATTENDANCE_FULL_SHARE of them or more gives the whole part, none open gives 0. */
export function attendancePoints(taken: number, open: number): number {
  if (!(open > 0)) return 0;
  return Math.min(PART_MAX.attendance, Math.round(((PART_MAX.attendance / ATTENDANCE_FULL_SHARE) * taken) / open));
}

/**
 * An amount in minor units of a house currency, in euro cents, rounded half up. The rate is read to the hundredth and
 * the amount multiplied whole, so the half is exact. An unknown currency throws: an order in one cannot exist
 * (HOUSE_CURRENCIES), and a score must never be made from a guess.
 */
export function toEurMinor(amountMinor: number, currency: string): number {
  const rate = (SPEND_EUR_RATES as Readonly<Record<string, number>>)[currency];
  if (rate === undefined || !Object.prototype.hasOwnProperty.call(SPEND_EUR_RATES, currency)) throw new RangeError(`toEurMinor: no euro rate for the currency ${currency}`);
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('toEurMinor: an amount is a whole number of minor units');
  return Math.floor((amountMinor * Math.round(rate * 100) + 50) / 100);
}

/** The currencies the score converts: the house's, but the euro. */
export const isOtherCurrency = (c: string): c is ScoreOtherCurrency => c !== 'EUR' && (HOUSE_CURRENCIES as readonly string[]).includes(c);

// ── The score ──────────────────────────────────────────────────────────────

/** The figures behind the five parts, as the daily job reads them for one account (account_scores keeps them). */
export interface EngagementInputs {
  /** The latest act in the window and its kind, both or neither. */
  lastActAt: Date | null;
  lastActKind: ScoreActKind | null;
  /** The Paris days with an act in the window. */
  activeDays: number;
  /** The purchases of the window in euro cents, how many they are, and how many have no known price. */
  spendEurMinor: number;
  purchases: number;
  unpriced: number;
  /** The currencies converted to euros, in the house's order. */
  otherCurrencies: ScoreOtherCurrency[];
  /** The median whole minutes from a release's opening to the entry, over `speedReleases` releases; null without one. */
  speedMinutes: number | null;
  speedReleases: number;
  /** The releases taken part in, out of those open to the collector. */
  releasesTaken: number;
  releasesOpen: number;
}

export interface EngagementScore {
  score: number;
  parts: Record<EngagementPart, number>;
  inputs: EngagementInputs;
}

/** The score of `inputs` at `now`: its five parts and their sum, a whole number from 0 to 100. */
export function scoreOf(inputs: EngagementInputs, now: Date): EngagementScore {
  const parts = {
    recency: recencyPoints(inputs.lastActAt, now),
    frequency: frequencyPoints(inputs.activeDays),
    spend: spendPoints(inputs.spendEurMinor, inputs.purchases),
    speed: inputs.speedReleases > 0 ? speedPoints(inputs.speedMinutes) : 0,
    attendance: attendancePoints(inputs.releasesTaken, inputs.releasesOpen),
  };
  return { score: parts.recency + parts.frequency + parts.spend + parts.speed + parts.attendance, parts, inputs };
}

/** The band of ten a score falls in: 0 (0–9) to 9 (90–100). */
export function band(score: number): number {
  return Math.min(9, Math.max(0, Math.floor(score / 10)));
}

// ── The words ──────────────────────────────────────────────────────────────

/** Whole euros as the house writes them: `€ 150`, `€ 1 500`. */
const euros = (minor: number): string => `€ ${String(Math.round(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;

/** A number of days in words: the 12 months by their name, any other count in days. */
const daysWords = (days: number): string => (days === 365 ? '12 months' : `${days} days`);

/** A number of minutes in words: `5 minutes`, `2 hours`, `24 hours`. */
function minutesWords(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** A share in words: a half by its name, any other as a percentage. */
const shareWords = (share: number): string => (share === 0.5 ? 'Half' : `${Math.round(share * 100)} %`);

/**
 * The sentences the client sheet shows under « How the score is calculated » (§3.5 SB.3.6): one per part, then the
 * formula's number. Written from `c`, the constants above unless a test passes others.
 */
export function formulaLines(c: FormulaConstants = FORMULA_CONSTANTS, formula: number = ENGAGEMENT_FORMULA): string[] {
  const window = daysWords(c.windowDays);
  const recency = c.recencySteps.map((s, i) => `${i === 0 ? 'Within ' : ''}${daysWords(s.days)} ${s.points}`).join(', ');
  const frequency = c.frequencySteps
    .map((s, i) => {
      const next = c.frequencySteps[i + 1];
      if (!next) return `${s.from} days or more ${s.points}`;
      if (next.from - 1 === s.from) return `${s.from} ${s.from === 1 ? 'day' : 'days'} ${s.points}`;
      return `${s.from} to ${next.from - 1} days ${s.points}`;
    })
    .join(', ');
  const spend = [`A purchase ${c.spendPoints[0]}`, ...c.spendStepsEurMinor.map((from, i) => `from ${euros(from)} ${c.spendPoints[i + 1]}`)].join(', ');
  const firstLater = c.speedStepsMinutes.findIndex((s) => s.minutes > 0);
  const speed = [
    ...c.speedStepsMinutes.map((s, i) => (s.minutes === 0 ? `At the opening ${s.points}` : `${i === firstLater ? (i === 0 ? 'Within ' : 'within ') : ''}${minutesWords(s.minutes)} ${s.points}`)),
    `later ${c.speedLaterPoints}`,
  ].join(', ');
  return [
    `Recency, up to ${c.partMax.recency}: the latest scan, draw entry, LIVE RELEASE entry, I’LL BE THERE, order or piece registered. ${recency}.`,
    `Frequency, up to ${c.partMax.frequency}: the days with one of these acts in ${window}. ${frequency}.`,
    `Spend, up to ${c.partMax.spend}: the pieces bought in ${window}, counted as GROWTH counts them, in euros. ${spend}.`,
    `Release speed, up to ${c.partMax.speed}: how soon after a release opens the client enters it, the median over ${window}. ${speed}.`,
    `Attendance, up to ${c.partMax.attendance}: the releases taken part in, out of those open to every client since the account was created, plus those it entered by access. ${shareWords(c.attendanceFullShare)} of them or more gives ${c.partMax.attendance}.`,
    `Formula ${formula}, fixed in the code.`,
  ];
}

/** The six lines of the formula in force. */
export const FORMULA_LINES: readonly string[] = Object.freeze(formulaLines());
