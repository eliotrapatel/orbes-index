/**
 * The forbidden windows of the lot PURGE (plan PURGE §W, D16, R3): neither a test purge batch nor a platform reset
 * (nor their checks) may RUN in the host's night maintenance or in one of the hub's backups.
 *
 *   The night    The UNION of [03:00, 05:30) UTC (the host's night freeze) and [04:00, 06:30) Paris, both read on
 *               their own clock every day. In winter time the two are the same hours (04:00–06:30 Paris); in summer
 *               time the union is 02:00–05:30 UTC, i.e. 04:00–07:30 Paris.
 *   The backups  The hub's two backups, fixed in PARIS time all year: [03:00, 03:10) and [03:45, 03:55) Paris
 *               (02:00 and 02:45 UTC in winter time, 01:00 and 01:45 UTC in summer time).
 *
 * A call is refused unless both its start and its start + margin are outside every window (each window lasts at
 * least 10 minutes and a margin at most 5, so the two ends are enough). The database holds the same rule
 * (`orbes_maintenance_window` and `orbes_maintenance_window_within`, migration 0066) and enforces it; this copy
 * gives the console its words, in Paris time first with UTC in parentheses, every hour computed for its date.
 * The two copies are kept equal by test/services/maintenance-window.test.ts.
 *
 * Paris hours are read through `Intl` with schedule.ts's PARIS_TIME_ZONE. Pure functions, no database.
 */
import { parisDay, parisLocalInstant, PARIS_TIME_ZONE } from './schedule.js';

export type MaintenanceWindowKind = 'NIGHT' | 'BACKUP';

/** One forbidden window: its kind and its bounds, [startsAt, endsAt). */
export interface MaintenanceWindow {
  kind: MaintenanceWindowKind;
  startsAt: Date;
  endsAt: Date;
}

/** The margins the lot uses (§W): a reset, its precheck and LOCK RESET's checks 5 minutes; a purge batch 1 minute. */
export const MAINTENANCE_MARGIN_MS = Object.freeze({ reset: 5 * 60_000, purgeBatch: 60_000 });

/** The longest margin the rule allows: every window lasts at least 10 minutes, so both ends of a margin are enough. */
const MAX_MARGIN_MS = 5 * 60_000;

/** The night on the UTC clock, minutes of the day [from, to). */
const NIGHT_UTC = { from: 3 * 60, to: 5 * 60 + 30 } as const;
/** The night on the Paris clock, minutes of the day [from, to). */
const NIGHT_PARIS = { from: 4 * 60, to: 6 * 60 + 30 } as const;
/** The hub backups on the Paris clock, minutes of the day [from, to). */
const BACKUPS_PARIS = [
  { from: 3 * 60, to: 3 * 60 + 10 },
  { from: 3 * 60 + 45, to: 3 * 60 + 55 },
] as const;

const parisClockParts = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const utcClockParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function clockOf(format: Intl.DateTimeFormat, at: Date): { hh: string; mm: string; minutes: number } {
  const p = Object.fromEntries(format.formatToParts(at).map((x) => [x.type, x.value]));
  const hh = String(p.hour);
  const mm = String(p.minute);
  return { hh, mm, minutes: Number(hh) * 60 + Number(mm) };
}

/** `HH:MM` on the Paris clock. */
export function parisClock(at: Date): string {
  const c = clockOf(parisClockParts, at);
  return `${c.hh}:${c.mm}`;
}

/** `HH:MM` on the UTC clock. */
function utcClock(at: Date): string {
  const c = clockOf(utcClockParts, at);
  return `${c.hh}:${c.mm}`;
}

/** The instant of a Paris wall-clock time on the Paris day `day` (`YYYY-MM-DD`). Every time used here exists every day. */
function parisAt(day: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const at = parisLocalInstant(`${day}T${hh}:${mm}`);
  if (!at) throw new RangeError(`maintenanceWindow: ${day} ${hh}:${mm} does not exist in Paris`);
  return at;
}

/** The instant of a UTC time of day on the date `day` (`YYYY-MM-DD`). */
function utcAt(day: string, minutes: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
}

function inRange(minutes: number, r: { from: number; to: number }): boolean {
  return minutes >= r.from && minutes < r.to;
}

/** The window `at` falls in, or null (margin 0). */
function windowAt(at: Date): MaintenanceWindow | null {
  const utc = clockOf(utcClockParts, at).minutes;
  const paris = clockOf(parisClockParts, at).minutes;
  if (inRange(utc, NIGHT_UTC) || inRange(paris, NIGHT_PARIS)) {
    // Both halves of the night fall on the same calendar date in UTC and in Paris (02:00–05:30 UTC at the widest).
    const day = parisDay(at);
    const halves = [
      { startsAt: utcAt(day, NIGHT_UTC.from), endsAt: utcAt(day, NIGHT_UTC.to) },
      { startsAt: parisAt(day, NIGHT_PARIS.from), endsAt: parisAt(day, NIGHT_PARIS.to) },
    ];
    return {
      kind: 'NIGHT',
      startsAt: new Date(Math.min(...halves.map((x) => x.startsAt.getTime()))),
      endsAt: new Date(Math.max(...halves.map((x) => x.endsAt.getTime()))),
    };
  }
  for (const b of BACKUPS_PARIS) {
    if (inRange(paris, b)) {
      const day = parisDay(at);
      return { kind: 'BACKUP', startsAt: parisAt(day, b.from), endsAt: parisAt(day, b.to) };
    }
  }
  return null;
}

function checkInputs(at: Date, marginMs: number, fn: string): void {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new RangeError(`${fn}: not a valid instant`);
  if (!Number.isFinite(marginMs) || marginMs < 0 || marginMs > MAX_MARGIN_MS) throw new RangeError(`${fn}: the margin is 0 to 5 minutes`);
}

/**
 * The forbidden window a call at `at` would run in: the window at `at`, else the window at `at + marginMs` (the call
 * would still be running when it starts); null when the call may run. `marginMs` is 0 to 5 minutes.
 */
export function maintenanceWindow(at: Date, marginMs = 0): MaintenanceWindow | null {
  checkInputs(at, marginMs, 'maintenanceWindow');
  return windowAt(at) ?? (marginMs > 0 ? windowAt(new Date(at.getTime() + marginMs)) : null);
}

/**
 * Why a call at `at` may not run, in the console's words, Paris time first with UTC in parentheses, every hour
 * computed for the date; null when it may run.
 *
 *   in the night    « The platform's night maintenance runs from 04:00 to 06:30 Paris (03:00–05:30 UTC). Try again at 06:30. »
 *                   (summer time: « from 04:00 to 07:30 Paris (02:00–05:30 UTC). Try again at 07:30. »)
 *   in a backup     « The hub backup runs from 03:00 to 03:10 Paris (02:00–02:10 UTC). Try again at 03:10. »
 *   in the margin   « The hub backup starts at 03:00 Paris; try again at 03:10. »
 *                   « The platform's night maintenance starts at 04:00 Paris; try again at 06:30. »
 */
export function windowWords(at: Date, marginMs = 0): string | null {
  checkInputs(at, marginMs, 'windowWords');
  const now = windowAt(at);
  const w = now ?? maintenanceWindow(at, marginMs);
  if (!w) return null;
  const name = w.kind === 'NIGHT' ? "The platform's night maintenance" : 'The hub backup';
  const from = parisClock(w.startsAt);
  const to = parisClock(w.endsAt);
  if (!now) return `${name} starts at ${from} Paris; try again at ${to}.`;
  return `${name} runs from ${from} to ${to} Paris (${utcClock(w.startsAt)}–${utcClock(w.endsAt)} UTC). Try again at ${to}.`;
}

const parisDayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: PARIS_TIME_ZONE, day: 'numeric', month: 'long' });

/** An instant in the console's words, Paris time: « 29 October at 14:05 Paris ». */
export function parisWhen(at: Date): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new RangeError('parisWhen: not a valid instant');
  return `${parisDayMonth.format(at)} at ${parisClock(at)} Paris`;
}
