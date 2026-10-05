/**
 * The best time to open (plan LIVE RELEASE+, choice 10) in the console — pure helpers, no DOM: the panel of a LIVE
 * RELEASE's page and of Analytics (views/best-time.ts) read GET /api/admin/live/:id/best-time and
 * /api/admin/analytics/best-time (server: services/activity.ts), sign-ins and scans counted by hour, never an account.
 *
 *  - the tiers read: everyone, or a tier and above (a release's: its own);
 *  - the hours of the day in Paris time, each a column scaled to the busiest, the suggested hour and the release's T0
 *    marked; the figures of each as a table (the sign-ins and scans of the tiers read, each tier's, the past releases
 *    opened then and their line at T0);
 *  - the countries, each with its busiest hour.
 */
import { formatCount, percent } from '../format.js';
import type { BestTime } from '../types.js';
import { countryLabel } from './analytics.js';
import { tierName } from './club.js';
import type { BarRow } from './dashboard.js';

/** The tiers the panel reads: everyone, or a tier and above. */
export const BEST_TIME_TIERS = Object.freeze([
  Object.freeze({ tier: 0, label: 'Everyone' }),
  Object.freeze({ tier: 1, label: 'From TITANE' }),
  Object.freeze({ tier: 2, label: 'From PLATINE' }),
  Object.freeze({ tier: 3, label: 'PALLADIUM' }),
]);

/** The tier Analytics reads from the query (`?tier=`): 0, everyone, by default. */
export function bestTimeTier(query: Readonly<Record<string, string | undefined>>): number {
  const n = Number(query.tier);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
}

/** The country Analytics reads from the query (`?country=`): two letters, else all. */
export function bestTimeCountry(query: Readonly<Record<string, string | undefined>>): string | null {
  const c = (query.country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** An hour of the day: `19:00`. */
export function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** A share: `23 %`. */
export function shareText(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** Who the figures are of: `every collector`, `collectors from PLATINE`, in a country when one is read. */
export function bestTimeWho(b: Pick<BestTime, 'minTier' | 'country'>): string {
  const who = b.minTier >= 1 && b.minTier <= 3 ? `collectors from ${tierName(b.minTier)}` : 'every collector';
  return b.country ? `${who} in ${countryLabel(b.country)}` : who;
}

/** The suggestion in one line: `19:00 Paris · 23 % of the activity of collectors from PLATINE`; or why there is none. */
export function bestTimeHeadline(b: Pick<BestTime, 'suggested' | 'minTier' | 'country'>): string {
  if (!b.suggested) return 'No activity counted in these days: no hour stands out yet.';
  return `${hourText(b.suggested.hour)} Paris · ${shareText(b.suggested.share)} of the activity of ${bestTimeWho(b)}`;
}

/** A release's T0 beside it: `Its T0 · 20:00 Paris · 12 % of that activity`; null when no release is read. */
export function bestTimeReleaseLine(b: Pick<BestTime, 'release'>): string | null {
  return b.release ? `Its T0 · ${hourText(b.release.hour)} Paris · ${shareText(b.release.share)} of that activity` : null;
}

/** An hour's column: its height against the busiest hour, the suggested hour, the release's T0, a past release opened then. */
export interface HourColumn {
  hour: number;
  value: number;
  fraction: number;
  suggested: boolean;
  release: boolean;
  past: boolean;
  /** What a screen reader says of it. */
  label: string;
}

export function hourColumns(b: Pick<BestTime, 'hours' | 'suggested' | 'release'>): HourColumn[] {
  const top = Math.max(0, ...b.hours.map((h) => h.activity));
  return b.hours.map((h) => {
    const suggested = b.suggested?.hour === h.hour;
    const release = b.release?.hour === h.hour;
    return {
      hour: h.hour,
      value: h.activity,
      fraction: top > 0 ? h.activity / top : 0,
      suggested,
      release,
      past: h.past.releases > 0,
      label: `${hourText(h.hour)}: ${formatCount(h.activity)}${suggested ? ', suggested' : ''}${release ? ', its T0' : ''}`,
    };
  });
}

/** The hours with anything to say (activity, or a past release opened then), for the table under the columns. */
export function bestTimeRows(b: Pick<BestTime, 'hours'>): BestTime['hours'] {
  return b.hours.filter((h) => h.activity > 0 || h.byTier.some((n) => n > 0) || h.past.releases > 0);
}

/** The countries, the most active first, each with its busiest hour, as hairline bars (at most `limit`). */
export function bestTimeCountryBars(b: Pick<BestTime, 'countries'>, limit = 10): BarRow[] {
  const total = b.countries.reduce((n, c) => n + c.activity, 0);
  const top = Math.max(0, ...b.countries.map((c) => c.activity));
  return b.countries.slice(0, limit).map((c) => ({
    key: c.country,
    label: `${countryLabel(c.country)} · ${hourText(c.peakHour)}`,
    value: c.activity,
    fraction: top > 0 ? c.activity / top : 0,
    share: percent(c.activity, total),
    tone: 'solid',
  }));
}
