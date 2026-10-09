/**
 * The server's status in the console (plan TEST ENTRANTS, GET /api/admin/system/status) — pure helpers, no DOM.
 *
 *  - Its rows, in the order the panel shows them: the owner's « Standard » (the app's memory and CPU against their
 *    limits, the server's memory available, load and disk, the response time, the requests, the errors and refusals,
 *    the LIVE connections, the database's connections and waiting queue) and three strain signals (the event loop's
 *    delay, the heap, the pool waiting inside the database row), each with its value, a line under it, its state and the
 *    10 minutes of its sparkline.
 *  - Each row's state: normal; amber from 70 % of its limit, red from 90 %; the event loop's p99 amber from 100 ms, red
 *    from 250 ms; the pool's waiting requests amber above 0, red above 5; the disk amber from 75 %, red from 80 % (the
 *    runbook's thresholds, DEPLOYMENT §15.12); the response time's p95 amber from 300 ms (the server's target,
 *    DEPLOYMENT §3) and red from 1 s; the errors amber at the first 5xx or 429 of the last minute, red above five 5xx;
 *    the LIVE connections amber above the 500 in the room the load test measured, never red on their own. A value the
 *    server cannot read here (macOS, PGlite) is unknown, never a strain.
 *  - The banner when a row is red, THE SERVER IS STRAINED: <its rows>, so the owner knows when to STOP a test; the
 *    panel's line when it is folded.
 *  - Under the database's row, VISITOR DATA (plan CUSTOMER INTELLIGENCE §3.4 A.10.7): the bytes of the recorded visitor
 *    data as last measured (the daily `intelligence sizes` figures), in all and by part, in MB, for the 50 MB backup
 *    watch; never a strain, unknown while not read; no sparkline (measured once a day).
 */
import { formatCount, formatDateTime } from '../format.js';
import type { SystemSample, SystemStatus, VisitorData } from '../types.js';
import type { Point } from './analytics.js';
import type { Tone } from './tone.js';

/** The thresholds of the states (see the head of this file). */
export const STRAIN = Object.freeze({
  amberShare: 0.7,
  redShare: 0.9,
  loopDelayMs: { amber: 100, red: 250 },
  poolWaiting: { amber: 0, red: 5 },
  diskPct: { amber: 75, red: 80 },
  p95Ms: { amber: 300, red: 1000 },
  errors5xx: { red: 5 },
  /** The accounts in the room the load test measured the server to hold (services/live-insights.ts LIVE_ROOM_CAPACITY). */
  liveAccounts: 500,
});

/** The panel's refresh, and the window its sparklines draw. */
export const STATUS_REFRESH_MS = 2000;

export type StrainState = 'normal' | 'amber' | 'red' | 'unknown';

/** A row of the panel. */
export interface StatusRow {
  id: string;
  label: string;
  value: string;
  note: string;
  state: StrainState;
  /** One value per sample of the history, oldest first (null: unread then). */
  series: (number | null)[];
  /** What the sparkline is scaled to: the limit when there is one and it is higher, else the busiest value. */
  ceiling: number;
}

/** A state's mark (ui/components statusMark): unknown grey, normal filled, amber the diamond, red in oxblood. */
export const STRAIN_TONES: Readonly<Record<StrainState, Tone>> = Object.freeze({ normal: 'solid', amber: 'alert', red: 'critical', unknown: 'muted' });

const RANK: Readonly<Record<StrainState, number>> = { unknown: 0, normal: 1, amber: 2, red: 3 };

/** The worse of states (unknown only when nothing is known). */
export function worstState(...states: StrainState[]): StrainState {
  return states.reduce<StrainState>((w, s) => (RANK[s] > RANK[w] ? s : w), 'unknown');
}

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** `used` against `limit`: amber from 70 %, red from 90 %; unknown without both. */
export function shareState(used: number | null | undefined, limit: number | null | undefined): StrainState {
  if (!known(used) || !known(limit) || !(limit > 0)) return known(used) ? 'normal' : 'unknown';
  const share = used / limit;
  return share >= STRAIN.redShare ? 'red' : share >= STRAIN.amberShare ? 'amber' : 'normal';
}

/** A value against its own thresholds: amber from `amber`, red from `red` (both inclusive). */
export function levelState(v: number | null | undefined, t: { amber: number; red: number }): StrainState {
  if (!known(v)) return 'unknown';
  return v >= t.red ? 'red' : v >= t.amber ? 'amber' : 'normal';
}

/** The pool's waiting requests: amber above 0, red above 5. */
export function waitingState(v: number | null | undefined): StrainState {
  if (!known(v)) return 'unknown';
  return v > STRAIN.poolWaiting.red ? 'red' : v > STRAIN.poolWaiting.amber ? 'amber' : 'normal';
}

/** The last minute's errors: amber at the first 5xx or 429, red above five 5xx. */
export function errorsState(errors5xx: number | null | undefined, refused429: number | null | undefined): StrainState {
  if (!known(errors5xx) && !known(refused429)) return 'unknown';
  const e = known(errors5xx) ? errors5xx : 0;
  const r = known(refused429) ? refused429 : 0;
  return e > STRAIN.errors5xx.red ? 'red' : e > 0 || r > 0 ? 'amber' : 'normal';
}

/** The LIVE connections: amber above the accounts the load test measured in the room; never red on their own. */
export function liveState(accounts: number | null | undefined): StrainState {
  if (!known(accounts)) return 'unknown';
  return accounts > STRAIN.liveAccounts ? 'amber' : 'normal';
}

/** `312 MB`, `1.5 GB` (1 024-based, as the console says a photograph's size); `—` unread. */
export function formatBytes(n: number | null | undefined): string {
  if (!known(n)) return '—';
  if (n < 1024) return `${formatCount(n)} B`;
  if (n < 1024 ** 2) return `${formatCount(Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) {
    const mb = n / 1024 ** 2;
    return `${mb < 10 ? mb.toFixed(1) : formatCount(Math.round(mb))} MB`;
  }
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** `42 %` of a share (0 … 1) or of a percentage (`pct: true`); `—` unread. */
export function formatShare(v: number | null | undefined, opts: { pct?: boolean } = {}): string {
  if (!known(v)) return '—';
  return `${Math.round(opts.pct ? v : v * 100)} %`;
}

/** `120 ms`; `—` unread. */
export function formatMs(v: number | null | undefined): string {
  return known(v) ? `${formatCount(Math.round(v))} ms` : '—';
}

/** `0.42`: cores, loads and requests a second, to two decimals (one from 100); `—` unread. */
export function formatDecimal(v: number | null | undefined): string {
  if (!known(v)) return '—';
  return v >= 100 ? formatCount(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2);
}

const ratio = (used: number | null | undefined, limit: number | null | undefined): string =>
  known(used) && known(limit) && limit > 0 ? ` · ${formatShare(used / limit)}` : '';

/** The busiest value of a series and a limit, so that a curve below its limit reads as such; 1 when nothing is known. */
export function ceilingOf(series: readonly (number | null)[], limit?: number | null): number {
  const top = Math.max(0, ...series.filter(known), known(limit) ? limit : 0);
  return top > 0 ? top : 1;
}

const MIB = 1024 ** 2;
/** `7.1`: bytes in MB (1 024-based, as formatBytes), one decimal. */
const inMb = (n: number): string => (n / MIB).toFixed(1);

/** The VISITOR DATA row's value and note: `12.4 MB`, `VIEWS 7.1 · DEVICES 2.2 · VISITS 1.0 · CONVERSIONS 0.4 · WISHES 0.1 · PROFILES 1.6`. */
export function visitorDataWords(v: VisitorData): { value: string; note: string } {
  return {
    value: `${inMb(v.totalBytes)} MB`,
    note: `VIEWS ${inMb(v.viewsBytes)} · DEVICES ${inMb(v.devicesBytes)} · VISITS ${inMb(v.visitsBytes)} · CONVERSIONS ${inMb(v.conversionsBytes)} · WISHES ${inMb(v.wishesBytes)} · PROFILES ${inMb(v.profilesBytes)}`,
  };
}

/** The rows of the panel from the server's answer (its latest sample; the history for the sparklines). */
export function statusRows(s: SystemStatus): StatusRow[] {
  const l: SystemSample | null = s.latest;
  const hist = s.history;
  const of = <T>(pick: (x: SystemSample) => T) => (l ? pick(l) : null);
  const series = (pick: (x: SystemSample) => number | null) => hist.map((x) => (known(pick(x)) ? pick(x) : null));
  const unread = 'NOT READ ON THIS SERVER';
  const row = (id: string, label: string, value: string, note: string, state: StrainState, values: (number | null)[], limit?: number | null): StatusRow => ({
    id,
    label,
    value,
    note: state === 'unknown' ? unread : note,
    state,
    series: values,
    ceiling: ceilingOf(values, limit),
  });

  const mem = of((x) => x.app.memBytes);
  const memLimit = of((x) => x.app.memLimitBytes);
  const cores = of((x) => x.app.cpuCores);
  const coresLimit = of((x) => x.app.cpuLimitCores);
  const avail = of((x) => x.host.memAvailableBytes);
  const total = of((x) => x.host.memTotalBytes);
  const heap = of((x) => x.node.heapUsedBytes);
  const heapLimit = of((x) => x.node.heapLimitBytes);
  const conns = of((x) => x.db.connections);
  const maxConns = of((x) => x.db.maxConnections);
  const waiting = of((x) => x.db.poolWaiting);
  const poolTotal = of((x) => x.db.poolTotal);
  const poolIdle = of((x) => x.db.poolIdle);
  const e5 = of((x) => x.http.errors5xx);
  const r429 = of((x) => x.http.refused429);
  const accounts = of((x) => x.live.accounts);
  const releases = of((x) => x.live.releases);
  const inUse = known(poolTotal) && known(poolIdle) ? poolTotal - poolIdle : null;

  return [
    row(
      'app-memory',
      'APP MEMORY',
      known(mem) ? `${formatBytes(mem)}${known(memLimit) ? ` / ${formatBytes(memLimit)}` : ''}${ratio(mem, memLimit)}` : '—',
      known(memLimit) ? `PEAK ${formatBytes(of((x) => x.app.memPeakBytes))}` : 'NO LIMIT SET',
      shareState(mem, memLimit),
      series((x) => x.app.memBytes),
      memLimit,
    ),
    row(
      'app-cpu',
      'APP CPU',
      known(cores) ? `${formatDecimal(cores)}${known(coresLimit) ? ` / ${formatDecimal(coresLimit)}` : ''} cores${ratio(cores, coresLimit)}` : '—',
      `THROTTLED ${formatShare(of((x) => x.app.throttledPct), { pct: true })}`,
      shareState(cores, coresLimit),
      series((x) => x.app.cpuCores),
      coresLimit,
    ),
    row(
      'server-memory',
      'SERVER MEMORY AVAILABLE',
      known(avail) ? `${formatBytes(avail)}${known(total) ? ` of ${formatBytes(total)}` : ''}` : '—',
      `SWAP USED ${formatBytes(of((x) => x.host.swapUsedBytes))}`,
      known(avail) && known(total) ? shareState(total - avail, total) : known(avail) ? 'normal' : 'unknown',
      series((x) => x.host.memAvailableBytes),
      total,
    ),
    row(
      'load',
      'LOAD',
      known(of((x) => x.host.load1)) ? `${formatDecimal(of((x) => x.host.load1))} · ${formatDecimal(of((x) => x.host.load5))}` : '—',
      `1 AND 5 MIN · CPU ${formatShare(of((x) => x.host.cpuPct), { pct: true })}`,
      known(of((x) => x.host.cpuPct)) ? shareState(of((x) => x.host.cpuPct), 100) : known(of((x) => x.host.load1)) ? 'normal' : 'unknown',
      series((x) => x.host.load1),
    ),
    row('disk', 'DISK', formatShare(of((x) => x.host.diskUsedPct), { pct: true }), 'USED ON /', levelState(of((x) => x.host.diskUsedPct), STRAIN.diskPct), series((x) => x.host.diskUsedPct), 100),
    row('response', 'RESPONSE TIME p95', formatMs(of((x) => x.http.p95Ms)), 'LAST MINUTE', levelState(of((x) => x.http.p95Ms), STRAIN.p95Ms), series((x) => x.http.p95Ms), STRAIN.p95Ms.amber),
    row('requests', 'REQUESTS / s', formatDecimal(of((x) => x.http.rps)), 'LAST MINUTE', known(of((x) => x.http.rps)) ? 'normal' : 'unknown', series((x) => x.http.rps)),
    row(
      'errors',
      'ERRORS AND REFUSALS',
      known(e5) || known(r429) ? `${formatCount(e5 ?? 0)} · ${formatCount(r429 ?? 0)}` : '—',
      'ERRORS (5XX) · REFUSED (429), LAST MINUTE',
      errorsState(e5, r429),
      hist.map((x) => (known(x.http.errors5xx) || known(x.http.refused429) ? (x.http.errors5xx ?? 0) + (x.http.refused429 ?? 0) : null)),
    ),
    row(
      'live',
      'LIVE CONNECTIONS',
      formatCount(of((x) => x.live.streams)),
      `${formatCount(accounts)} ${accounts === 1 ? 'ACCOUNT' : 'ACCOUNTS'} · ${formatCount(releases)} ${releases === 1 ? 'RELEASE' : 'RELEASES'}`,
      known(of((x) => x.live.streams)) ? liveState(accounts) : 'unknown',
      series((x) => x.live.streams),
    ),
    row(
      'database',
      'DATABASE',
      known(conns) ? `${formatCount(conns)}${known(maxConns) ? ` / ${formatCount(maxConns)}` : ''}${ratio(conns, maxConns)}` : known(inUse) ? `${formatCount(inUse)} IN USE` : '—',
      `POOL ${known(inUse) ? `${formatCount(inUse)} OF ${formatCount(poolTotal)} IN USE` : '—'} · ${formatCount(waiting)} WAITING`,
      known(conns) || known(waiting) ? worstState(known(conns) ? shareState(conns, maxConns) : 'normal', waitingState(waiting)) : 'unknown',
      series((x) => x.db.connections),
      maxConns,
    ),
    (() => {
      const v = s.visitorData ? visitorDataWords(s.visitorData) : null;
      return row('visitor-data', 'VISITOR DATA', v?.value ?? '—', v?.note ?? '', v ? 'normal' : 'unknown', hist.map(() => null));
    })(),
    row(
      'loop',
      'EVENT LOOP DELAY p99',
      formatMs(of((x) => x.node.loopDelayP99Ms)),
      `p50 ${formatMs(of((x) => x.node.loopDelayP50Ms))} · BUSY ${formatShare(of((x) => x.node.loopUtilPct), { pct: true })}`,
      levelState(of((x) => x.node.loopDelayP99Ms), STRAIN.loopDelayMs),
      series((x) => x.node.loopDelayP99Ms),
      STRAIN.loopDelayMs.amber,
    ),
    row(
      'heap',
      'HEAP',
      known(heap) ? `${formatBytes(heap)}${known(heapLimit) ? ` / ${formatBytes(heapLimit)}` : ''}${ratio(heap, heapLimit)}` : '—',
      `RESIDENT ${formatBytes(of((x) => x.node.rssBytes))}`,
      shareState(heap, heapLimit),
      series((x) => x.node.heapUsedBytes),
      heapLimit,
    ),
  ];
}

/** The banner over the panel when a row is red: `THE SERVER IS STRAINED: APP MEMORY, DATABASE`; null otherwise. */
export function strainBanner(rows: readonly StatusRow[]): string | null {
  const red = rows.filter((r) => r.state === 'red').map((r) => r.label);
  return red.length ? `THE SERVER IS STRAINED: ${red.join(', ')}` : null;
}

/**
 * The panel's line, also all it shows once folded on a narrow screen: `STRAINED: DATABASE`, `TO WATCH: DISK`, `NORMAL`
 * or `NOT READ YET`, then the sample's time.
 */
export function statusSummary(rows: readonly StatusRow[], at: string | null | undefined): string {
  const named = (s: StrainState) => rows.filter((r) => r.state === s).map((r) => r.label);
  const red = named('red');
  const amber = named('amber');
  const head = red.length ? `STRAINED: ${red.join(', ')}` : amber.length ? `TO WATCH: ${amber.join(', ')}` : rows.some((r) => r.state === 'normal') ? 'NORMAL' : 'NOT READ YET';
  return at ? `${head} · ${formatDateTime(at, { seconds: true })}` : head;
}

/**
 * A sparkline's runs: one polyline per run of read values (an unread sample breaks the line), x spread over the whole
 * window (0 the first sample, 1 the last), y against `ceiling`; a lone value is a point of its own.
 */
export function sparkRuns(values: readonly (number | null)[], ceiling: number): Point[][] {
  const n = values.length;
  const runs: Point[][] = [];
  let run: Point[] = [];
  values.forEach((v, i) => {
    if (!known(v)) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: n === 1 ? 0.5 : i / (n - 1), y: ceiling > 0 ? Math.max(0, Math.min(1, v / ceiling)) : 0 });
  });
  if (run.length) runs.push(run);
  return runs;
}
