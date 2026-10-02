/**
 * Analytics view model (A-09): the daily scan statistics of the last 30 or
 * 90 complete days as figures, one curve of every scan, one small curve per
 * verification state, the countries with the most scans and the countries of
 * the counterfeit signals. Pure: unit-tested without a browser.
 *
 * Geometry is in unit fractions (x and y in 0..1, y from the baseline up):
 * ui/charts.ts turns them into SVG coordinates and CSS custom properties.
 */
import { formatCount, formatDate, humanize, percent } from '../format.js';
import { href } from '../router.js';
import { SIGNAL_STATES, VERIFICATION_STATES, type AnalyticsCountry, type AnalyticsData, type VerificationState } from '../types.js';
import type { BarRow, Kpi } from './dashboard.js';
import { toneOf, type Tone } from './tone.js';

/** The two windows the view offers, in days; the view opens on the longer one. */
export const ANALYTICS_RANGES = [30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 90;

/** Countries listed in the two country panels. */
export const COUNTRY_LIMIT = 10;

/** The verification states of a code ORBES issued and that verifies. */
export const AUTHENTIC_STATES: readonly VerificationState[] = Object.freeze([
  'AUTHENTIC',
  'AUTHENTIC_FIRST_REGISTRATION',
  'AUTHENTIC_REGISTERED',
  'AUTHENTIC_OWNERSHIP_VERIFIED',
]);

/** The window of the route query (`?days=30`); anything else is the default. */
export function analyticsRange(query: Readonly<Record<string, string | undefined>>): AnalyticsRange {
  const n = Number(query.days);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : DEFAULT_ANALYTICS_RANGE;
}

// ── Countries ──────────────────────────────────────────────────────────────

let regionNames: Intl.DisplayNames | null | undefined;

/** English name of an ISO 3166-1 alpha-2 code (`France`); `Unknown` for ZZ; the code itself when the browser has no name. */
export function countryName(code: string): string {
  if (code === 'ZZ') return 'Unknown';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    const name = regionNames?.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** `FR · France`, or `Unknown location` for ZZ. */
export function countryLabel(code: string): string {
  return code === 'ZZ' ? 'Unknown location' : `${code} · ${countryName(code)}`;
}

// ── Figures ────────────────────────────────────────────────────────────────

function sum(d: AnalyticsData, states: readonly VerificationState[]): number {
  return states.reduce((a, s) => a + (d.byState[s] ?? 0), 0);
}

/** Countries with at least one signal, the most signals first (then the most scans, then by code). */
export function signalCountries(d: AnalyticsData): AnalyticsCountry[] {
  return d.countries.filter((c) => c.signals > 0).sort((a, b) => b.signals - a.signals || b.total - a.total || a.country.localeCompare(b.country));
}

export function analyticsKpis(d: AnalyticsData): Kpi[] {
  const authentic = sum(d, AUTHENTIC_STATES);
  const signalled = signalCountries(d);
  const invalid = d.signals.INVALID_SIGNATURE ?? 0;
  const known = d.countries.filter((c) => c.country !== 'ZZ');
  return [
    { key: 'scans', label: 'Scans', value: formatCount(d.total), note: `IN ${formatCount(d.days)} DAYS`, tone: 'solid' },
    { key: 'authentic', label: 'Authentic', value: formatCount(authentic), note: `${percent(authentic, d.total)} OF SCANS`, tone: 'solid' },
    {
      key: 'signals',
      label: 'Counterfeit signals',
      value: formatCount(d.signals.total),
      // An invalid signature is said first, in oxblood; otherwise where the signals come from.
      note:
        invalid > 0
          ? `${formatCount(invalid)} INVALID ${invalid === 1 ? 'SIGNATURE' : 'SIGNATURES'}`
          : signalled.length === 0
            ? 'NONE'
            : `IN ${formatCount(signalled.length)} ${signalled.length === 1 ? 'COUNTRY' : 'COUNTRIES'}`,
      tone: invalid > 0 ? 'critical' : 'solid',
    },
    {
      key: 'countries',
      label: 'Countries',
      value: formatCount(known.length),
      note: known.length > 0 ? `MOST SCANS: ${countryName(known[0].country).toUpperCase()}` : 'NO LOCATION',
      tone: 'solid',
    },
  ];
}

/** `Complete days 04 JUL 2026 – 01 OCT 2026 (UTC) …`: what the figures cover and what they leave out. */
export function analyticsLead(d: AnalyticsData): string {
  return `Complete days from ${formatDate(d.from)} to ${formatDate(d.to)}, in UTC. Today's scans are counted after midnight UTC; staff scans never are. The counts stay after the scan history is purged.`;
}

// ── Curves ─────────────────────────────────────────────────────────────────

/** The axis ceiling: the smallest 1, 2 or 5 × 10ⁿ at or above `max` (1 for an empty window). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** The labelled levels of the axis, top first: the ceiling, its half when a whole number, and 0. */
export function axisLevels(ceiling: number): { value: number; y: number }[] {
  const half = ceiling / 2;
  return [
    { value: ceiling, y: 1 },
    ...(Number.isInteger(half) && half > 0 ? [{ value: half, y: 0.5 }] : []),
    { value: 0, y: 0 },
  ];
}

export interface Point {
  /** 0 (first day) … 1 (last day); 0.5 for a single day. */
  x: number;
  /** 0 (baseline) … 1 (ceiling). */
  y: number;
}

/** One point per value, x spread evenly over the window, y against `ceiling`. */
export function curve(values: readonly number[], ceiling: number): Point[] {
  const n = values.length;
  return values.map((v, i) => ({ x: n === 1 ? 0.5 : i / (n - 1), y: ceiling > 0 ? Math.max(0, Math.min(1, v / ceiling)) : 0 }));
}

/** SVG `points` for a viewBox `0 0 width height` (y down), to two decimals. */
export function svgPoints(points: readonly Point[], width: number, height: number): string {
  const r = (v: number) => String(Math.round(v * 100) / 100);
  return points.map((p) => `${r(p.x * width)},${r((1 - p.y) * height)}`).join(' ');
}

export interface DayTick {
  index: number;
  x: number;
  label: string;
}

/** Up to `count` evenly spaced day labels, the first and the last day always among them (`04 JUL`). */
export function dayTicks(days: readonly string[], count = 5): DayTick[] {
  const n = days.length;
  if (n === 0) return [];
  const want = Math.max(1, Math.min(count, n));
  const indices = new Set<number>();
  for (let k = 0; k < want; k++) indices.add(want === 1 ? n - 1 : Math.round((k * (n - 1)) / (want - 1)));
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({ index, x: n === 1 ? 0.5 : index / (n - 1), label: formatDate(days[index]).slice(0, 6) }));
}

/** The nearest day to a horizontal fraction of the plot (0 … 1). */
export function nearestDay(fraction: number, days: number): number {
  if (days <= 1) return 0;
  return Math.max(0, Math.min(days - 1, Math.round(fraction * (days - 1))));
}

/** Space between the cursor (or the day's point) and its readout, in CSS pixels. */
export const READOUT_GAP = 16;

/**
 * Where the day's readout opens in a plot `plot.width` × `plot.height` CSS pixels, for a day at `p` and a
 * readout `box` wide and tall: `dx`, its left edge from the cursor (beside it on the right when it fits,
 * else on the left; when neither side has room, as on a phone for a day near the middle, over the cursor,
 * inside the plot, so the page never scrolls sideways; a readout wider than the plot keeps its right edge
 * on the plot's), and `low`, true when it sits at the foot of the plot rather than its top: only over the
 * cursor, when a readout at the top would cover the day's point and one at the foot would not (or would
 * cover less of the plot above it).
 */
export function readoutPlacement(
  p: Point,
  box: { width: number; height: number },
  plot: { width: number; height: number },
  gap = READOUT_GAP,
): { dx: number; low: boolean } {
  const at = p.x * plot.width;
  if (at + gap + box.width <= plot.width) return { dx: gap, low: false };
  if (at - gap - box.width >= 0) return { dx: -gap - box.width, low: false };
  const left = Math.min(Math.max(0, at - box.width / 2), plot.width - box.width);
  // The point's distance from the top of the plot: clear of a readout at the top, else of one at the foot.
  const top = (1 - p.y) * plot.height;
  const low = top < box.height + gap / 2 && (top <= plot.height - box.height - gap / 2 || p.y > 0.5);
  return { dx: left - at, low };
}

/** What the cursor reads on one day: the count first, then every state with scans that day. */
export function dayReadout(d: AnalyticsData, index: number): { day: string; total: string; lines: { label: string; value: string; tone: Tone }[] } {
  const entry = d.daily[index];
  if (!entry) return { day: '—', total: '—', lines: [] };
  return {
    day: formatDate(entry.day),
    total: `${formatCount(entry.total)} ${entry.total === 1 ? 'SCAN' : 'SCANS'}`,
    lines: VERIFICATION_STATES.filter((s) => (entry.byState[s] ?? 0) > 0).map((s) => ({
      label: humanize(s),
      value: formatCount(entry.byState[s]),
      tone: toneOf('verification', s),
    })),
  };
}

export interface StateRow {
  state: VerificationState;
  label: string;
  tone: Tone;
  total: number;
  share: string;
  /** The day's count, per day of the window. */
  values: number[];
  /** The busiest day (`4 ON 03 SEP 2026`), or an empty string without scans. */
  peak: string;
  /**
   * Its scans in Verification events, over the window (while the history keeps them): from the first
   * millisecond of the first day to the last of the last day, as an anomaly's window links (`scanHref`).
   */
  link: string;
}

/** One row per verification state, in the order of the public contract: its curve, total and share. */
export function stateRows(d: AnalyticsData): StateRow[] {
  return VERIFICATION_STATES.map((state) => {
    const values = d.daily.map((x) => x.byState[state] ?? 0);
    const total = d.byState[state] ?? 0;
    let peakIndex = -1;
    values.forEach((v, i) => {
      if (v > 0 && (peakIndex < 0 || v > values[peakIndex])) peakIndex = i;
    });
    return {
      state,
      label: humanize(state),
      tone: toneOf('verification', state),
      total,
      share: percent(total, d.total),
      values,
      peak: peakIndex < 0 ? '' : `${formatCount(values[peakIndex])} ON ${formatDate(d.daily[peakIndex].day)}`,
      link: href('scans', {}, { state, from: `${d.from}T00:00:00.000Z`, to: `${d.to}T23:59:59.999Z` }),
    };
  });
}

// ── Country bars ───────────────────────────────────────────────────────────

/** The countries with the most scans, as hairline bars scaled to the first. */
export function countryBars(d: AnalyticsData, limit = COUNTRY_LIMIT): BarRow[] {
  const rows = d.countries.slice(0, limit);
  const max = Math.max(0, ...rows.map((c) => c.total));
  return rows.map((c) => ({
    key: c.country,
    label: countryLabel(c.country),
    value: c.total,
    fraction: max > 0 ? c.total / max : 0,
    share: percent(c.total, d.total),
    tone: 'solid',
  }));
}

/** The countries of the counterfeit signals, the most first; red where a signature did not verify. */
export function signalBars(d: AnalyticsData, limit = COUNTRY_LIMIT): BarRow[] {
  const rows = signalCountries(d).slice(0, limit);
  const max = Math.max(0, ...rows.map((c) => c.signals));
  return rows.map((c) => ({
    key: c.country,
    label: countryLabel(c.country),
    value: c.signals,
    fraction: max > 0 ? c.signals / max : 0,
    share: percent(c.signals, d.signals.total),
    tone: (c.byState.INVALID_SIGNATURE ?? 0) > 0 ? 'critical' : 'solid',
  }));
}

/** The signal states, as the columns of the countries' breakdown. */
export const SIGNAL_COLUMNS: readonly { state: (typeof SIGNAL_STATES)[number]; label: string }[] = Object.freeze(
  SIGNAL_STATES.map((state) => ({ state, label: humanize(state) })),
);
