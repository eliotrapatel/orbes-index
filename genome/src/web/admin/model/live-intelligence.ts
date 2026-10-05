/**
 * The intelligence of a LIVE RELEASE in the console (views/live-intelligence.ts; server: services/live-insights.ts):
 * which readings a release shows at its stage, and how their figures are written. Pure, tested in
 * test/web/admin.live-intelligence.test.ts.
 *
 *   before its announcement   the release planner, the audience forecast;
 *   announced, the room open  the audience forecast, the demand radar; the bot radar once the room is open;
 *   from T0                   the live alerts and the live sell-out forecast on the live board, the bot radar;
 *   ended                     the release report, the collector insights, the bot radar;
 *   always                    the release comparison, once another release's T0 has passed.
 */
import { formatCount } from '../format.js';
import type { LiveAlertKind, LiveBotSign, LiveComparedRelease, LiveFunnelStep, LivePhase, LiveRelease, LiveSellOutOutlook } from '../types.js';
import type { BarRow } from './dashboard.js';
import { formatMoney } from './live.js';

export type LiveReading = 'plan' | 'forecast' | 'radar' | 'bots' | 'report' | 'collectors' | 'comparison';

/** The readings of a release at its stage, in the order the page shows them. */
export function liveReadings(r: Pick<LiveRelease, 'phase' | 'editable'> & { afterRoomOf?: LiveRelease['afterRoomOf'] }): LiveReading[] {
  const p: LivePhase = r.phase;
  if (p === 'CANCELLED') return [];
  // An after-room: no planner, forecast, radar or comparison (its audience is its guests, it is part of its release);
  // the bot radar while it runs, then its report and its collectors.
  if (r.afterRoomOf) return p === 'ENDED' ? ['report', 'collectors', 'bots'] : p === 'LIVE' ? ['bots'] : [];
  const out: LiveReading[] = [];
  if (r.editable) out.push('plan');
  if (p === 'DRAFT' || p === 'HIDDEN' || p === 'ANNOUNCED' || p === 'ROOM') out.push('forecast');
  if (p === 'ANNOUNCED' || p === 'ROOM') out.push('radar');
  if (p === 'ENDED') out.push('report', 'collectors');
  if (p === 'ROOM' || p === 'LIVE' || p === 'ENDED') out.push('bots');
  out.push('comparison');
  return out;
}

/** The three live alerts, as the board names them. */
export const LIVE_ALERT_LABELS: Readonly<Record<LiveAlertKind, string>> = Object.freeze({
  SIZE_SOLD_OUT: 'SIZE SOLD OUT',
  MISSED_WAVE: 'MISSED TURNS',
  LINE_STALLED: 'LINE STALLED',
});

/** The bot radar's signs, as the console names them. */
export const LIVE_BOT_SIGN_LABELS: Readonly<Record<LiveBotSign, string>> = Object.freeze({
  NEW_ACCOUNT: 'NEW ACCOUNT',
  NETWORK: 'ONE NETWORK',
  GESTURE_FLOOR: 'SHORT HOLD',
  GESTURE_REPEAT: 'REPEATED HOLD',
});

/** A share: `42 %`; `—` for none. */
export function shareText(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)} %`;
}

/** A pressure (demand for each piece): `2.33`; `—` for none. */
export function pressureText(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(2);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A length of time: `35 s`, `4 min 05 s`, `1 h 02 min`; `—` for none (services/live-insights.ts duration). */
export function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${pad(s % 60)} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${pad(m % 60)} min` : `${h} h`;
}

/** The time of an instant, to the second: `14:32:05 UTC` (without its zone for a figure whose label says it). */
export function clockText(iso: string | null | undefined, zone = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${zone ? ' UTC' : ''}`;
}

/** The sell-out forecast of a size or of the release, in a few words. */
export function sellOutText(s: { outlook: LiveSellOutOutlook | 'PARTIAL'; at: string | null; expectedLeft: number | null }): string {
  switch (s.outlook) {
    case 'SOLD_OUT':
      return `Sold out at ${clockText(s.at)}`;
    case 'SELLS_OUT':
      return `Sold out about ${clockText(s.at)}`;
    case 'LINE_SHORT':
      return `About ${formatCount(s.expectedLeft ?? 0)} left once the line is served`;
    case 'CLOSE_FIRST':
      return `About ${formatCount(s.expectedLeft ?? 0)} left at the close`;
    case 'PARTIAL':
      return `About ${formatCount(s.expectedLeft ?? 0)} left`;
    default:
      return 'No pace yet';
  }
}

/** The room forecast at T0: `750 – 1 500`. */
export function rangeText(f: { low: number; high: number }): string {
  return f.low === f.high ? formatCount(f.low) : `${formatCount(f.low)} – ${formatCount(f.high)}`;
}

/** The figures the comparison sets side by side, each a column: its head (no figure: the display face sets it) and its cell. */
export const LIVE_COMPARISON_COLUMNS: readonly { label: string; cell: (x: LiveComparedRelease) => string }[] = Object.freeze([
  { label: 'Pieces', cell: (x) => (x.added ? `${formatCount(x.stock)} (${formatCount(x.added)} added)` : formatCount(x.stock)) },
  { label: 'Price', cell: (x) => formatMoney(x.priceMinor, x.currency) },
  { label: 'Interest', cell: (x) => formatCount(x.interest) },
  { label: 'Room', cell: (x) => formatCount(x.room) },
  { label: 'Line at the opening', cell: (x) => formatCount(x.presentAtT0) },
  { label: 'Turns', cell: (x) => formatCount(x.turns) },
  { label: 'Confirmed', cell: (x) => formatCount(x.confirmedPieces) },
  { label: 'Sell-through', cell: (x) => shareText(x.sellThrough) },
  { label: 'Sold out in', cell: (x) => durationText(x.sellOutMs) },
  { label: 'Missed', cell: (x) => shareText(x.missedShare) },
  { label: 'Revenue', cell: (x) => formatMoney(x.piecesRevenueMinor + x.addonsRevenueMinor, x.currency) },
]);

/** The funnel's steps, as the report names them. */
export const LIVE_FUNNEL_LABELS: Readonly<Record<LiveFunnelStep, string>> = Object.freeze({
  INTEREST: 'I’LL BE THERE',
  ROOM: 'ENTERED',
  TURN: 'HAD A TURN',
  SECURED: 'HELD THE SEAL',
  CONFIRMED: 'PRESSED PAY',
  CONCLUDED: 'CONCLUDED',
});

/** The funnel as bars: each step's people, its bar against the largest, its share of the step before. */
export function funnelBars(funnel: readonly { step: LiveFunnelStep; people: number; share: number | null }[]): BarRow[] {
  const top = Math.max(1, ...funnel.map((f) => f.people));
  return funnel.map((f) => ({ key: f.step, label: LIVE_FUNNEL_LABELS[f.step], value: f.people, fraction: f.people / top, share: f.share === null ? '' : shareText(f.share), tone: 'solid' }));
}
