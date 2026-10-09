/**
 * The server's status (test entrants, §7): what the console's Server panel reads, a sample every SYSTEM_SAMPLE_MS (2 s)
 * kept in a ring of SYSTEM_SAMPLES (300: the last 10 minutes), and the running maxima of a test while it runs (its
 * `peaks`, §6).
 *
 *   app   the container's cgroup v2 (/sys/fs/cgroup, or the process's own cgroup under it): memory.current, .max, .peak;
 *         cpu.stat's usage and throttled periods since the last sample against cpu.max; pids.current, .max;
 *   host  /proc/meminfo, /proc/loadavg, /proc/stat's CPU since the last sample, the disk of `/` (statfs, as df counts it);
 *   node  the heap and its limit, the RSS, the event loop's delay (p50, p99) and its utilisation since the last sample;
 *   live  the LIVE RELEASES' streams open on this process (http/live-stream.ts LiveHub.open);
 *   db    the pg pool's counts (db/connection.ts poolOf) and this database's connections in pg_stat_activity, with
 *         max_connections read in the same query;
 *   http  the responses of the last 60 s (the app's onResponse hook, app.ts): per second their count, their 5xx and 429
 *         and a histogram of their times, for the requests per second and the p95.
 *
 * Beside the samples, `visitorData`: the bytes of the customer intelligence lot's growing tables as last measured (plan
 * CUSTOMER INTELLIGENCE §3.4 A.10.7, the daily `intelligence sizes` figures, services/tracking-jobs.ts
 * IntelligenceSizes), for the 50 MB backup watch: Server status's « Visitor data » line; null when not read.
 *
 * A value that cannot be read is null (macOS has no /proc nor cgroup, PGlite no pool nor other connections, a file is
 * missing): a sample never throws. Its cost is a few small files, one statfs and one query every 2 s; the query is
 * skipped (its fields null) while the previous one still waits, so a pool at its limit never piles the sampler's reads
 * up behind the requests.
 *
 * A test's peaks (services/test-entrants.ts): startRunPeaks(runId) when it starts; each sample then raises its maxima
 * (memory, CPU, p95, loop delay p99, streams, connections, pool waiting) and every 5xx and 429 answered while it runs
 * is counted; currentRunPeaks reads them (persisted every ~10 s), stopRunPeaks reads them a last time and forgets them.
 * They live in this process's memory: a restart loses what was not persisted (the run is INTERRUPTED then).
 */
import { readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance, type ELDHistogram, type EventLoopUtilization } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { sql } from 'kysely';
import { poolOf, type Db } from '../db/connection.js';
import { noopLogger, systemClock, type Clock, type Logger } from '../types.js';
import type { VisitorData } from './tracking-jobs.js';

/** A sample every 2 s… */
export const SYSTEM_SAMPLE_MS = 2000;
/** …300 of them kept: the last 10 minutes. */
export const SYSTEM_SAMPLES = 300;
/** The responses' window: the last 60 s. */
export const HTTP_WINDOW_S = 60;
/** The event loop's delay is measured by a timer this often (its own interval taken off what it reads). */
const LOOP_RESOLUTION_MS = 20;
/** The database's read waits this long at most; past it, that sample's database fields are null. */
const DB_READ_TIMEOUT_MS = 1000;

export interface SystemSample {
  at: string;
  app: {
    memBytes: number | null;
    memLimitBytes: number | null;
    memPeakBytes: number | null;
    cpuCores: number | null;
    cpuLimitCores: number | null;
    throttledPct: number | null;
    pids: number | null;
    pidsMax: number | null;
  };
  host: {
    memAvailableBytes: number | null;
    memTotalBytes: number | null;
    swapUsedBytes: number | null;
    load1: number | null;
    load5: number | null;
    cpuPct: number | null;
    diskUsedPct: number | null;
  };
  node: {
    heapUsedBytes: number | null;
    heapLimitBytes: number | null;
    rssBytes: number | null;
    externalBytes: number | null;
    loopDelayP50Ms: number | null;
    loopDelayP99Ms: number | null;
    loopUtilPct: number | null;
  };
  live: { streams: number | null; releases: number | null; accounts: number | null };
  db: {
    poolTotal: number | null;
    poolIdle: number | null;
    poolWaiting: number | null;
    connections: number | null;
    maxConnections: number | null;
    active: number | null;
    waiting: number | null;
  };
  http: { rps: number | null; p95Ms: number | null; errors5xx: number | null; refused429: number | null };
}

/**
 * GET /api/admin/system/status: the server's time, the newest sample, the last 10 minutes oldest first (the newest
 * included), and the visitor data's bytes as last measured (null: not read).
 */
export interface SystemStatusView {
  now: string;
  latest: SystemSample;
  history: SystemSample[];
  visitorData: VisitorData | null;
}

/** A test's running maxima while it runs; the 5xx and 429 are the responses counted since it started. */
export interface RunPeaks {
  appMemBytes: number | null;
  appCpuCores: number | null;
  p95Ms: number | null;
  loopDelayP99Ms: number | null;
  liveStreams: number | null;
  dbConnections: number | null;
  poolWaiting: number | null;
  errors5xx: number;
  refused429: number;
}

// ── A test's peaks ─────────────────────────────────────────────────────────

const runPeaks = new Map<string, RunPeaks>();

/** Start following a test's peaks (again: kept as they are, an ADD MORE does not reset them). */
export function startRunPeaks(runId: string): void {
  if (runPeaks.has(runId)) return;
  runPeaks.set(runId, {
    appMemBytes: null,
    appCpuCores: null,
    p95Ms: null,
    loopDelayP99Ms: null,
    liveStreams: null,
    dbConnections: null,
    poolWaiting: null,
    errors5xx: 0,
    refused429: 0,
  });
}

/** A test's peaks so far (a copy), or null when they are not followed (never started, stopped, or a restart since). */
export function currentRunPeaks(runId: string): RunPeaks | null {
  const p = runPeaks.get(runId);
  return p ? { ...p } : null;
}

/** A test's peaks a last time; they are forgotten. */
export function stopRunPeaks(runId: string): RunPeaks | null {
  const p = currentRunPeaks(runId);
  runPeaks.delete(runId);
  return p;
}

const higher = (a: number | null, b: number | null): number | null => (b === null ? a : a === null ? b : Math.max(a, b));

/** Raise every followed test's maxima to a sample's. */
function raisePeaks(s: SystemSample): void {
  for (const p of runPeaks.values()) {
    p.appMemBytes = higher(p.appMemBytes, s.app.memBytes);
    p.appCpuCores = higher(p.appCpuCores, s.app.cpuCores);
    p.p95Ms = higher(p.p95Ms, s.http.p95Ms);
    p.loopDelayP99Ms = higher(p.loopDelayP99Ms, s.node.loopDelayP99Ms);
    p.liveStreams = higher(p.liveStreams, s.live.streams);
    p.dbConnections = higher(p.dbConnections, s.db.connections);
    p.poolWaiting = higher(p.poolWaiting, s.db.poolWaiting);
  }
}

// ── The responses of the last 60 s ─────────────────────────────────────────

/** Response times by bin: bin 0 under 1 ms, then eighth-octaves (each ~9 % wider than the last) up to 2^20 ms. */
const BINS = 2 + 8 * 20;
const binOf = (ms: number): number => (ms >= 1 ? Math.min(BINS - 1, 1 + Math.floor(Math.log2(ms) * 8)) : 0);
/** A bin's upper bound: the p95 read from the bins is never under the true one, and at most ~9 % over it. */
const binTop = (bin: number): number => 2 ** (bin / 8);

interface Second {
  /** The second (of the monotonic time) it counts, -1 before its first. */
  at: number;
  count: number;
  errors5xx: number;
  refused429: number;
  bins: Uint32Array;
}

/**
 * The responses of the last HTTP_WINDOW_S seconds, one bucket per second reused as the window turns: `record` is O(1)
 * per response, `read` merges 60 buckets. Time is monotonic (performance.now), never the app's clock, which tests move.
 */
export class HttpWindow {
  private readonly seconds: Second[] = Array.from({ length: HTTP_WINDOW_S }, () => ({ at: -1, count: 0, errors5xx: 0, refused429: 0, bins: new Uint32Array(BINS) }));
  private readonly startedAt: number;

  constructor(private readonly monotonic: () => number = () => performance.now()) {
    this.startedAt = monotonic();
  }

  /** A response sent: its status and time (reply.elapsedTime, ms). A 5xx or a 429 also counts for every test followed. */
  record(statusCode: number, ms: number): void {
    const sec = Math.floor(this.monotonic() / 1000);
    const b = this.seconds[sec % HTTP_WINDOW_S];
    if (b.at !== sec) {
      b.at = sec;
      b.count = 0;
      b.errors5xx = 0;
      b.refused429 = 0;
      b.bins.fill(0);
    }
    b.count++;
    b.bins[binOf(ms)]++;
    if (statusCode >= 500) {
      b.errors5xx++;
      for (const p of runPeaks.values()) p.errors5xx++;
    } else if (statusCode === 429) {
      b.refused429++;
      for (const p of runPeaks.values()) p.refused429++;
    }
  }

  /** The last 60 s (since the start when younger): requests per second, the p95 (null without a response), the 5xx and 429. */
  read(): SystemSample['http'] {
    const now = this.monotonic();
    const sec = Math.floor(now / 1000);
    const merged = new Uint32Array(BINS);
    let count = 0;
    let errors5xx = 0;
    let refused429 = 0;
    for (const b of this.seconds) {
      if (b.at <= sec - HTTP_WINDOW_S || b.at > sec) continue;
      count += b.count;
      errors5xx += b.errors5xx;
      refused429 += b.refused429;
      for (let i = 0; i < BINS; i++) merged[i] += b.bins[i];
    }
    // The window: the 59 whole seconds before this one and this one so far; shorter just after the start.
    const spanS = Math.max(1, Math.min(now - (sec - HTTP_WINDOW_S + 1) * 1000, now - this.startedAt) / 1000);
    let p95Ms: number | null = null;
    if (count > 0) {
      const rank = Math.ceil(count * 0.95);
      let seen = 0;
      for (let i = 0; i < BINS; i++) {
        seen += merged[i];
        if (seen >= rank) {
          p95Ms = round(binTop(i), 1);
          break;
        }
      }
    }
    return { rps: round(count / spanS, 1), p95Ms, errors5xx, refused429 };
  }
}

// ── Reading the host ───────────────────────────────────────────────────────

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** A cgroup value: a number, or null when absent, unreadable or `max` (no limit). */
function cgroupNumber(text: string | null): number | null {
  const t = text?.trim();
  if (!t || t === 'max') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** `key value` lines (cpu.stat), or `Key:   value kB` lines (/proc/meminfo, in bytes). */
function fields(text: string | null, unit = 1): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text?.split('\n') ?? []) {
    const m = /^(\w+):?\s+(\d+)/.exec(line);
    if (m) out.set(m[1], Number(m[2]) * unit);
  }
  return out;
}

/** /proc/stat's first line: the host's CPU time, busy and idle (iowait counted idle), in ticks. */
function hostCpu(text: string | null): { busy: number; idle: number } | null {
  const line = text?.split('\n').find((l) => l.startsWith('cpu '));
  const t = line?.trim().split(/\s+/).slice(1, 9).map(Number);
  if (!t || t.length < 5 || t.some((n) => !Number.isFinite(n))) return null;
  const idle = t[3] + t[4];
  return { busy: t.reduce((a, b) => a + b, 0) - idle, idle };
}

/** What only the database can say, in one query: this database's connections, the active ones, those waiting on a lock, and the limit. */
export async function databaseActivity(db: Db): Promise<{ connections: number; maxConnections: number; active: number; waiting: number }> {
  const r = await sql<{ connections: number; max_connections: number; active: number; waiting: number }>`
    SELECT count(*)::int AS connections,
           current_setting('max_connections')::int AS max_connections,
           count(*) FILTER (WHERE state = 'active')::int AS active,
           count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting
      FROM pg_stat_activity
     WHERE datname = current_database()`.execute(db);
  const row = r.rows[0];
  return { connections: Number(row.connections), maxConnections: Number(row.max_connections), active: Number(row.active), waiting: Number(row.waiting) };
}

// ── The sampler ────────────────────────────────────────────────────────────

/** The LIVE RELEASES' streams open on this process (LiveHub). */
export interface LiveStreamCounts {
  readonly open: { streams: number; releases: number; accounts: ReadonlyMap<string, number> };
}

export interface SystemStatusDeps {
  /** Its pool's counts and pg_stat_activity; PGlite (no pool) leaves the database's fields null. */
  db?: Db;
  live?: LiveStreamCounts;
  /** The samples' `at` and the view's `now` (the app's clock). */
  clock?: Clock;
  log?: Logger;
  /** The visitor data's bytes as last measured (IntelligenceSizes.visitorData; never throws). Without it, null. */
  visitorData?: () => Promise<VisitorData | null>;
  /** The sample's period; 0: no timer (tests call `sample()`). */
  intervalMs?: number;
  /** The samples kept. */
  size?: number;
  /** The cgroup v2 mount (default /sys/fs/cgroup), /proc (default /proc), the disk measured (default `/`): tests point them at fixtures. */
  cgroupRoot?: string;
  procRoot?: string;
  diskPath?: string;
  /** A monotonic time in ms (default performance.now): the CPU's rates and the responses' window. */
  monotonic?: () => number;
}

interface CpuReading {
  at: number;
  usageUsec: number | null;
  periods: number | null;
  throttled: number | null;
  host: { busy: number; idle: number } | null;
}

export class SystemStatus {
  /** The responses of the last 60 s, fed by the app's onResponse hook. */
  readonly http: HttpWindow;
  private readonly db: Db | undefined;
  private readonly live: LiveStreamCounts | undefined;
  private readonly visitorData: () => Promise<VisitorData | null>;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly intervalMs: number;
  private readonly size: number;
  private readonly cgroupRoot: string;
  private readonly procRoot: string;
  private readonly diskPath: string;
  private readonly monotonic: () => number;
  private readonly ring: SystemSample[] = [];
  private readonly loop: ELDHistogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  private elu: EventLoopUtilization | undefined;
  private cpu: CpuReading | undefined;
  private cgroup: Promise<string> | undefined;
  private dbRead: Promise<unknown> | undefined;
  private dbWarned = false;
  private sampling: Promise<SystemSample> | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(deps: SystemStatusDeps = {}) {
    this.db = deps.db;
    this.live = deps.live;
    this.visitorData = deps.visitorData ?? (async () => null);
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.intervalMs = deps.intervalMs ?? SYSTEM_SAMPLE_MS;
    this.size = deps.size ?? SYSTEM_SAMPLES;
    this.cgroupRoot = deps.cgroupRoot ?? '/sys/fs/cgroup';
    this.procRoot = deps.procRoot ?? '/proc';
    this.diskPath = deps.diskPath ?? '/';
    this.monotonic = deps.monotonic ?? (() => performance.now());
    this.http = new HttpWindow(this.monotonic);
  }

  /** Whether the timer runs. */
  get started(): boolean {
    return this.timer !== undefined;
  }

  /** Start sampling: one sample now, then one every intervalMs (idempotent). */
  start(): void {
    if (this.timer || this.intervalMs <= 0) return;
    this.loop.enable();
    // Its readings are null rather than errors; what is left (the process itself failing) is logged, never thrown.
    const tick = () => {
      this.sample().catch((e: unknown) => this.log.error({ err: { message: (e as Error)?.message } }, 'system status: a sample failed'));
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
  }

  /** Stop sampling and wait for the sample under way. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.loop.disable();
    await this.sampling?.catch(() => undefined);
  }

  /** The newest sample and the last 10 minutes; a first sample taken now when there is none yet; the visitor data. */
  async status(): Promise<SystemStatusView> {
    const latest = this.ring.at(-1) ?? (await this.sample());
    const visitorData = await this.visitorData().catch(() => null);
    return { now: this.clock().toISOString(), latest, history: [...this.ring], visitorData };
  }

  /** Take a sample (one at a time: a call while one is under way gets that one), keep it, raise the tests' peaks. */
  sample(): Promise<SystemSample> {
    this.sampling ??= this.take().finally(() => {
      this.sampling = undefined;
    });
    return this.sampling;
  }

  private async take(): Promise<SystemSample> {
    const at = this.clock().toISOString();
    const [cgroup, proc, disk, db] = await Promise.all([this.readCgroup(), this.readProc(), this.readDisk(), this.readDb()]);
    const now = this.monotonic();
    const prev = this.cpu;
    this.cpu = { at: now, usageUsec: cgroup.usageUsec, periods: cgroup.periods, throttled: cgroup.throttled, host: proc.cpu };
    const seconds = prev ? (now - prev.at) / 1000 : 0;

    let cpuCores: number | null = null;
    let throttledPct: number | null = null;
    if (prev && seconds > 0 && cgroup.usageUsec !== null && prev.usageUsec !== null) {
      cpuCores = round(Math.max(0, cgroup.usageUsec - prev.usageUsec) / 1e6 / seconds, 3);
    }
    if (prev && cgroup.periods !== null && prev.periods !== null && cgroup.throttled !== null && prev.throttled !== null) {
      const periods = cgroup.periods - prev.periods;
      throttledPct = periods > 0 ? round((Math.max(0, cgroup.throttled - prev.throttled) / periods) * 100, 1) : 0;
    }
    let cpuPct: number | null = null;
    if (prev?.host && proc.cpu) {
      const busy = proc.cpu.busy - prev.host.busy;
      const total = busy + proc.cpu.idle - prev.host.idle;
      if (total > 0) cpuPct = round((Math.max(0, busy) / total) * 100, 1);
    }

    const mem = process.memoryUsage();
    const elu = performance.eventLoopUtilization();
    const loopUtil = this.elu ? performance.eventLoopUtilization(elu, this.elu).utilization : null;
    this.elu = elu;
    // The loop's timer reads its own interval too: what is over it is the delay.
    const delay = (p: number) => round(Math.max(0, this.loop.percentile(p) / 1e6 - LOOP_RESOLUTION_MS), 1);
    const sampled = this.loop.count > 0;
    const loopDelayP50Ms = sampled ? delay(50) : null;
    const loopDelayP99Ms = sampled ? delay(99) : null;
    this.loop.reset();
    const open = this.live?.open;

    const sample: SystemSample = {
      at,
      app: {
        memBytes: cgroup.memBytes,
        memLimitBytes: cgroup.memLimitBytes,
        memPeakBytes: cgroup.memPeakBytes,
        cpuCores,
        cpuLimitCores: cgroup.cpuLimitCores,
        throttledPct,
        pids: cgroup.pids,
        pidsMax: cgroup.pidsMax,
      },
      host: {
        memAvailableBytes: proc.memAvailableBytes,
        memTotalBytes: proc.memTotalBytes,
        swapUsedBytes: proc.swapUsedBytes,
        load1: proc.load1,
        load5: proc.load5,
        cpuPct,
        diskUsedPct: disk,
      },
      node: {
        heapUsedBytes: mem.heapUsed,
        heapLimitBytes: getHeapStatistics().heap_size_limit,
        rssBytes: mem.rss,
        externalBytes: mem.external,
        loopDelayP50Ms,
        loopDelayP99Ms,
        loopUtilPct: loopUtil === null ? null : round(loopUtil * 100, 1),
      },
      live: open ? { streams: open.streams, releases: open.releases, accounts: open.accounts.size } : { streams: null, releases: null, accounts: null },
      db,
      http: this.http.read(),
    };
    this.ring.push(sample);
    if (this.ring.length > this.size) this.ring.splice(0, this.ring.length - this.size);
    raisePeaks(sample);
    return sample;
  }

  /** The process's own cgroup under the mount (`0::/path` in /proc/self/cgroup), or the mount itself (a container's own namespace). */
  private cgroupDir(): Promise<string> {
    this.cgroup ??= (async () => {
      const own = (await readText(join(this.procRoot, 'self', 'cgroup')))?.split('\n').find((l) => l.startsWith('0::'));
      const path = own?.slice(3).trim();
      if (path && path !== '/' && (await readText(join(this.cgroupRoot, path, 'memory.current'))) !== null) return join(this.cgroupRoot, path);
      return this.cgroupRoot;
    })();
    return this.cgroup;
  }

  private async readCgroup() {
    const dir = await this.cgroupDir();
    const [current, max, peak, stat, cpuMax, pids, pidsMax] = await Promise.all(
      ['memory.current', 'memory.max', 'memory.peak', 'cpu.stat', 'cpu.max', 'pids.current', 'pids.max'].map((f) => readText(join(dir, f))),
    );
    const cpu = fields(stat);
    const [quota, period] = cpuMax?.trim().split(/\s+/) ?? [];
    const cores = Number(quota) / Number(period);
    return {
      memBytes: cgroupNumber(current),
      memLimitBytes: cgroupNumber(max),
      memPeakBytes: cgroupNumber(peak),
      usageUsec: cpu.get('usage_usec') ?? null,
      periods: cpu.get('nr_periods') ?? null,
      throttled: cpu.get('nr_throttled') ?? null,
      cpuLimitCores: quota !== 'max' && Number.isFinite(cores) && cores > 0 ? round(cores, 3) : null,
      pids: cgroupNumber(pids),
      pidsMax: cgroupNumber(pidsMax),
    };
  }

  private async readProc() {
    const [meminfo, loadavg, stat] = await Promise.all(['meminfo', 'loadavg', 'stat'].map((f) => readText(join(this.procRoot, f))));
    const mem = fields(meminfo, 1024);
    const swapTotal = mem.get('SwapTotal');
    const swapFree = mem.get('SwapFree');
    const [load1, load5] = (loadavg?.trim().split(/\s+/) ?? []).map(Number);
    return {
      memAvailableBytes: mem.get('MemAvailable') ?? null,
      memTotalBytes: mem.get('MemTotal') ?? null,
      swapUsedBytes: swapTotal !== undefined && swapFree !== undefined ? swapTotal - swapFree : null,
      load1: Number.isFinite(load1) ? load1 : null,
      load5: Number.isFinite(load5) ? load5 : null,
      cpu: hostCpu(stat),
    };
  }

  /** The share of the disk used, as df counts it: used / (used + available to the app). */
  private async readDisk(): Promise<number | null> {
    try {
      const s = await statfs(this.diskPath);
      const used = s.blocks - s.bfree;
      return used + s.bavail > 0 ? round((used / (used + s.bavail)) * 100, 1) : null;
    } catch {
      return null;
    }
  }

  private async readDb(): Promise<SystemSample['db']> {
    const out: SystemSample['db'] = { poolTotal: null, poolIdle: null, poolWaiting: null, connections: null, maxConnections: null, active: null, waiting: null };
    const pool = this.db ? poolOf(this.db) : null;
    if (!this.db || !pool) return out;
    out.poolTotal = pool.totalCount;
    out.poolIdle = pool.idleCount;
    out.poolWaiting = pool.waitingCount;
    // The previous read still waits for a connection or an answer: this sample goes without.
    if (this.dbRead) return out;
    const read = databaseActivity(this.db).catch((e: unknown) => {
      if (!this.dbWarned) this.log.warn({ err: { message: (e as Error)?.message } }, 'system status: pg_stat_activity could not be read');
      this.dbWarned = true;
      return null;
    });
    this.dbRead = read.finally(() => {
      this.dbRead = undefined;
    });
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DB_READ_TIMEOUT_MS);
      timer.unref();
    });
    const activity = await Promise.race([read, late]);
    clearTimeout(timer);
    if (activity) Object.assign(out, activity);
    return out;
  }
}
