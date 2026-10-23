/**
 * The LIVE RELEASES' load test (plan of 2026-10-04, Architecture › Load; Quality bar 6).
 *
 *   npx tsx scripts/live-load.ts [--levels 500,1000,1500,2000] [--vps-factor 2] [--burst-seconds 10] [--seed N]
 *                                [--pace X,Y] [--database-url postgres://…] [--json PATH]
 *
 * For each level N, three processes, as on the VPS: the app (this file with --serve: the server's own createContext,
 * buildApp, logger and LIVE engine, as src/server/index.ts starts them; ORBES_ENV=development, so the production rate
 * limits apply; behind a trusted proxy, each phone with its own X-Forwarded-For address, hence its own network), the
 * database (--database: PGlite alone in its process, reached over a socket as the app reaches PostgreSQL's container),
 * and this one, the phones, over real HTTP with Node's own http client (no dependency):
 *
 *   1. N accounts, a fifth of them owners (TITANE, PLATINE, PALLADIUM: the line's tier order and the club's standings
 *      read at T0 do real work), each signed in, each entered in a draw drawn before (so each has taken part in one
 *      release); a segment of the collectors who took part in a release and were active in the last 30 days; a LIVE
 *      RELEASE of 25 pieces in three sizes with two add-ons, created and published through the console's service, its
 *      room opening a minute before T0, with every rule of LIVE RELEASE+ that its checks read (plan of 2026-10-04,
 *      LIVE RELEASE+): taken part in a release AND a member of the segment (both read at each check: the stream, I'LL
 *      BE THERE, ENTER, SECURE), a surprise in every box, the question after, and an after-room of 25 pieces opening a
 *      minute after the sell-out for five minutes; and its stock at its location (STOCKED: one size wholly in stock,
 *      one in part, one with none), so that PAY reserves a piece in stock under the SKU's lock, or the order waits
 *      for supplier stock (AWAITING, plan NEXT LOT §3.5: no piece to make, no identity reserved);
 *   2. N concurrent streams (GET /api/v1/live/:id/stream, one per account), plus the console's stream and a boutique
 *      board's (the owner watches, a boutique shows the door), opened over the seconds after the announcement; half of
 *      the accounts say I'LL BE THERE over those seconds;
 *   3. a host message every second from the announcement to T0, so that every pulse sends every viewer a new room (the
 *      worst case of the fan-out, measured on every pulse);
 *   4. a burst of entries: the N accounts ENTER at random moments of the first --burst-seconds of the room (10 s: 100 a
 *      second for 1 000, thirty times the pace of a crowd spread over a five-minute room), each with a size;
 *   5. at T0 the door opens: the line formed, each turn taken on its phone as the stream brings it: PRESS, 1.5 s later
 *      SECURE, the add-ons for half of them, then PAY (seven in ten) or RELEASE MY PLACE (three in ten, the piece
 *      going to the next in line at once), until the release is SOLD OUT and every stream has ended;
 *   6. the after-room: the entries the sell-out ended read its second door in their last frame (each pulse reads the
 *      doors of the room's ENDED entries); at its T0 its guests open it (GET /api/v1/live/:id/after-room) in a burst of
 *      --burst-seconds, each opening its stream, then ENTERing with a size once it has read the after-room's page
 *      (AFTER_ROOM_READING_MS); the turns run as in the main room until the after-room is SOLD OUT and every one of its
 *      streams has ended.
 *
 * Measured, against the plan's targets for 1 000 in the room on the VPS profile (app container: 1.5 CPU, 768 MB):
 *
 *   action latency   each I'LL BE THERE, ENTER, PRESS, SECURE, add-ons, PAY and RELEASE, in both rooms,
 *                    request sent → answer read                                                      p95 < 200 ms
 *                    (the app's share of it on the VPS's CPU, below)
 *   fan-out          each pulse, its room in memory (the frame and the viewers' entries read: the events' `now`)
 *                    → the last viewer's room event read by its phone, over the pulses that reached at least
 *                    95 % of the viewers; the whole pulse on the server, its reads included, beside it    p95 < 100 ms
 *   memory           the app's peak resident memory, plus the GeoIP database the VPS app keeps in memory
 *                    (GEOIP_RESIDENT_MIB; this run has none)                                   < 60 % of 768 MB
 *   CPU              the app's busiest five seconds                                            < one core
 *   and none of: an answer other than 200, a stream refused or dropped before the end, an error in the app's log, a
 *   room that did not sell out, or orders other than the pieces confirmed (one per piece, those of STOCKED held in
 *   stock and every other one waiting for supplier stock, AWAITING).
 *
 * The VPS's CPU on this machine: a VPS vCPU is taken as --vps-factor times slower than the core the app runs on here
 * (DEFAULT_VPS_FACTOR), and what runs on the app's thread is multiplied by it before it is held against its target: the
 * fan-out, the CPU, and an action's app share (its event loop's p99 delay, plus its CPU per action: all of the app's
 * CPU over the run divided by the actions, an upper bound); the rest of an action's time, the database's wait, is
 * taken as measured. (Clamping the app to Apple
 * silicon's efficiency cores was tried and left: that clamp is the lowest scheduling class, and anything else running
 * starves it.) The app's memory is its own process's, with the heap Node sizes for the VPS's container
 * (VPS_HEAP_FLAGS) and the seeding's garbage collected before the streams; the database's process is reported
 * beside it, for information. PGlite has one connection, which every transaction holds in turn, where PostgreSQL has a
 * pool of ten: the actions and the pulse's reads wait for it, and the database's share of their times is pessimistic.
 * --database-url runs the app on a THROWAWAY PostgreSQL database instead (it is migrated and filled with the test's
 * accounts).
 *
 * Also reported: the streams' connection time, the line drawn at T0, each turn's delivery to its phone, the engine's
 * passes, the event loop's delay. The capacity is the largest level that meets every target, every smaller level
 * meeting them too: the room the server holds (LIVE_ROOM_CAPACITY, services/live-insights.ts), which the audience
 * forecast warns against.
 *
 * --pace X,Y (W4, the plan of 2026-10-20 §1.5: `--pace 250,1 --levels 5000`) gives the release a pace, X buyers admitted
 * every Y minutes (LIVE_PACE_BATCH, LIVE_PACE_MINUTES), and measures its queue (W2): from T0 the phones not admitted yet
 * wait on the queue's frame (`queue` events and their own `you` events, their place and estimated entry time) until
 * their batch lets them into the room. As the page does (web/verify/views/live.ts), only a phone whose batch is the
 * next one keeps its stream: the server ends the stream of one behind it after its place, and that phone reads GET
 * /state instead, first at a moment of its own within LIVE_QUEUE_SPREAD_MS, then as the state's `pollMs` says, until
 * its batch is the next one and it opens its stream again. Reported besides: those state reads, the streams the server
 * ended so and opened again, and the app's memory before T0 and from T0 on with the streams then open. The door before T0 is the house's for that many people: the room opens
 * PACED_ROOM_MINUTES (5) before T0, the console's default, the streams and I'LL BE THERE come over up to two minutes
 * before it, and the entries over the room's first four minutes (--burst-seconds sets another burst). So that the
 * release lasts until its last batch, a phone whose turn comes before
 * the last batch's time takes it (PRESS, SECURE, the add-ons for half) and then RELEASES MY PLACE, the piece going to
 * the next admitted in its size; from the last batch on, the phones act as in the room (PAY seven in ten) and the
 * release sells out. A paced release is published without an after-room (step 6 is left out): the pace meters the
 * release's line, not the after-room's door, which would open to the thousands the sell-out ended at the same second,
 * the door measured without a pace (docs/reports/live-load.md, §3); the run measures the queue. Measured besides, and held against the targets: the
 * queue's fan-out (each pulse's queue frame, from its time to the last waiting phone that read it, over the pulses that
 * reached 95 % of those waiting); every batch on the server (pacedBatchesProblem: exactly X, the last the rest, the k-th
 * at T0 + (k − 1) × Y to the millisecond, and the TEST REPORT's own PACE check, services/test-entrants.ts paceCheck, on
 * the release's entries and audit log); and on the phones (queueVerdict): every phone that waited admitted, none from
 * a place beyond X, at the time the queue first estimated, and how long its admission took to reach it. The action
 * target is held against the actions behind the pace (the turns, PAY, RELEASE); the door's (I'LL BE
 * THERE and ENTER, before T0, which the pace does not meter) are reported beside them. Its verdict is the queue's, not a
 * capacity: no LIVE_ROOM_CAPACITY is read from it.
 *
 * Prints a table per level and the capacity; writes every figure to genome/out/live-load/results.json (or --json
 * PATH) and the app's log of each level beside it (server-<N>.log). Seeded: the same arguments give the same
 * accounts, sizes and moments; the times depend on the machine and on what else runs on it.
 */
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { Agent, request as httpRequest, type IncomingMessage } from 'node:http';
import { createConnection, createServer, type Socket } from 'node:net';
import { cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import { LIVE_PACE_BATCH, LIVE_PACE_MINUTES } from '../src/server/db/schema.js';
import { LIVE_QUEUE_POLL_MS } from '../src/server/http/live-stream.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
/** The app's public origin in this test: every mutation sends it, as a browser on the site does. */
const ORIGIN = 'https://verify.orbes.load';
/** As the page (web/verify/views/live.ts LIVE_QUEUE_SPREAD_MS): its first state read once the server ended its stream behind the next batch. */
const LIVE_QUEUE_SPREAD_MS = 60_000;
/** As the page (web/verify/views/live.ts FINAL): an entry in one of these is over for its page, which closes its stream. */
const FINAL_STATUSES: ReadonlySet<string> = new Set(['CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'REMOVED']);
/** From T0, this long for the streams behind the next batch to end: the memory and streams "from T0" are read after it. */
const QUEUE_SETTLE_MS = 10_000;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// ── Targets (plan of 2026-10-04, Architecture › Load) ──────────────────────

export const LIVE_LOAD_TARGETS = Object.freeze({
  /** p95 of the customer actions, ms. */
  actionP95Ms: 200,
  /** p95 of a pulse's fan-out, ms. */
  fanOutP95Ms: 100,
  /** The app container's memory limit (deploy/vps/.env.example APP_MEM_LIMIT), MiB. */
  memoryLimitMib: 768,
  /** The share of it the app may use. */
  memoryShare: 0.6,
  /** The app's busiest five seconds, in cores: its JavaScript runs on one thread. */
  cpuCores: 1,
});

/**
 * How many times slower a VPS vCPU is taken to be than the core the test runs on (--vps-factor): 2, for this lot's
 * machine (an Apple M2 Pro's performance core) against a shared server vCPU of 2 to 3 GHz. An assumption, stated with
 * the figures.
 */
export const DEFAULT_VPS_FACTOR = 2;

/**
 * The heap of the app in the VPS's container, given to the app here so that its heap grows and is collected as it
 * would be there: the old generation Node sizes from the cgroup's limit (V8's HeapSizeFromPhysicalMemory: a quarter
 * of it, times two on 64-bit: 384 MB of 768 MB), and semi-spaces of at most 16 MB, the most the image's Node 22 (V8 12)
 * gives its young generation on 64-bit (Node 24 lets it grow to 64 MB, holding up to 192 MB of young heap).
 */
export const VPS_HEAP_FLAGS = Object.freeze([`--max-old-space-size=${(LIVE_LOAD_TARGETS.memoryLimitMib / 4) * 2}`, '--max-semi-space-size=16']);

/**
 * The GeoIP database the VPS app holds in memory (GEO_MODE=mmdb, docs/DEPLOYMENT.md §3.4: ≈ 125 MiB, measured on the
 * 2026-10 edition), added to this run's figure, which has none.
 */
export const GEOIP_RESIDENT_MIB = 125;

/** The release: the owner's « 25 PIECES » in three sizes, two add-ons, € 4 800. */
const SIZES = [
  { label: '52', stock: 9 },
  { label: '54', stock: 8 },
  { label: '56', stock: 8 },
];
const ADDONS = [
  { label: 'ENGRAVING', priceMinor: 25_000 },
  { label: 'GIFT BOX', priceMinor: 5_000 },
];
/**
 * The pieces in stock in advance at the release's location, by size (plan LIVE RELEASE+, choice 8): PAY holds one of them
 * under its SKU's lock; the other orders wait for supplier stock (AWAITING, plan NEXT LOT §3.5). One size wholly in
 * stock, one in part, one with none: 13 pieces held in stock, 12 waiting.
 */
const STOCKED: Readonly<Record<string, number>> = Object.freeze({ '52': 9, '54': 4 });
/** The after-room (plan LIVE RELEASE+, choice 2): a model of its own, 25 pieces in three sizes, an add-on, none in stock. */
const AFTER_SIZES = [
  { label: '52', stock: 9 },
  { label: '54', stock: 8 },
  { label: '56', stock: 8 },
];
const AFTER_ADDONS = [{ label: 'GIFT BOX', priceMinor: 5_000 }];
/**
 * What the after-room rightly answers a guest who arrives after its size, or the after-room itself, has sold out: its
 * guests all see the door at the same second, and its turns begin with the first of them to enter, so the last of a
 * crowd may find nothing left. Counted as late, not as failures.
 */
const AFTER_ROOM_LATE_CODES: readonly string[] = ['LIVE_SIZE_SOLD_OUT', 'LIVE_OVER'];
/**
 * A guest who opened the after-room reads its page before ENTER THE LINE: a model it had not seen, its price, its sizes
 * to choose from (web/verify/views/live.ts, the after-room's join screen): from 2 to 8 seconds.
 */
const AFTER_ROOM_READING_MS = Object.freeze({ min: 2_000, max: 8_000 });
/** The room opens this long before T0 (the console's minimum). */
const ROOM_MINUTES = 1;
/**
 * --pace: the room opens this long before T0, the console's default (LIVE_ROOM_OPENS_MINUTES.default), and the
 * announcement comes up to PACED_LEAD_MS before it: the thousands a pace is meant for arrive over the minutes the house
 * gives them, as a crowd of 5 000 in ten seconds collapsed the door on PGlite's one connection before T0 (the report,
 * §7: 30 s timeouts, its streams refused).
 */
export const PACED_ROOM_MINUTES = 5;
const PACED_LEAD_MS = 120_000;
/** Held this long before SECURE (the house's ring: 1.5 s; the server asks for 1.4 s). */
const HOLD_MS = 1500;
/** After T0, the release must have sold out within this time. */
const SELL_OUT_LIMIT_MS = 180_000;
/** A pulse counts as a full fan-out when it reached this share of the viewers. */
const FULL_PULSE = 0.95;

// ── Messages between the driver and the app's process ─────────────────────

interface SetupMessage {
  type: 'setup';
  viewers: number;
  /** From the publication to the room's opening: the time the streams have to connect. */
  leadMs: number;
  /** The room opens this long before T0. */
  roomMinutes: number;
  /** PostgreSQL's URL (--database-url), or `pglite:memory` with the socket of PGlite's process. */
  databaseUrl: string;
  databaseSocket: string | null;
  seed: number;
  /** --pace: the release's pace (W4), or none. */
  pace: LoadPace | null;
  /** The release has its after-room (step 6); false with a pace. */
  afterRoom: boolean;
}

interface ReadyMessage {
  type: 'ready';
  port: number;
  dropId: string;
  /** Its after-room's id (the phones read it from its door, and check it is this one); null without one (--pace). */
  afterRoomId: string | null;
  sizes: { id: string; label: string }[];
  addons: string[];
  roomOpensAt: number;
  opensAt: number;
  cookie: string;
  viewers: { token: string; csrf: string }[];
  console: { cookie: string };
  boardToken: string;
  seedMs: number;
  calibrationMs: number;
  /** The app started, before the test's accounts and release; and before the streams, the seeding's garbage collected. */
  idle: MemorySample;
  baseline: MemorySample;
}

interface MemorySample {
  at: number;
  rss: number;
  /** The streams open on the app then (the hub's), once the release is made. */
  streams?: number;
  /** The heap V8 holds (its young and old generations), and the part in use. */
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface PulseRecord {
  start: number;
  end: number;
  ms: number;
  streams: number;
}

interface TickRecord {
  start: number;
  ms: number;
  queued: number;
}

interface ServerReport {
  type: 'report';
  pulses: PulseRecord[];
  ticks: TickRecord[];
  memory: MemorySample[];
  maxRssBytes: number;
  cpuMs: { user: number; system: number };
  wallMs: number;
  loopDelayMs: { p50: number; p99: number; max: number };
  /** The app's CPU in each second, in cores. */
  cpuBySecond: number[];
  messageErrors: number;
  facts: ReleaseFacts;
}

/** What the two rooms left in the database, read once they are over (the orders of LIVE RELEASE+ and the after-room). */
interface ReleaseFacts {
  /** The orders of the release and of its after-room; by reservation: a piece held in stock, awaiting supplier stock, neither. */
  orders: { main: number; afterRoom: number; stock: number; awaiting: number; other: number };
  afterRoom: { guests: number; reason: string | null; confirmed: number };
  /** The rows of the event journal (services/journal.ts), written with every order and movement. */
  journal: number;
  /** --pace: the release's batches as its audit log recorded them, and the TEST REPORT's PACE check on them; null without a pace. */
  pace: PacedFacts | null;
}

/** What a paced release left: its batches (`drop.live.batch`, ONE QUEUE: those that gave turns), its entries placed and given a turn, the PACE check. */
interface PacedFacts {
  batches: PacedBatch[];
  placed: number;
  admitted: number;
  check: { pass: boolean; line: string };
}

/** One batch as the audit log recorded it: its number, its logical time, its entries, and when the engine wrote it. */
export interface PacedBatch {
  batch: number;
  at: number;
  entries: number;
  recordedAt: number;
}

// ── Options ────────────────────────────────────────────────────────────────

interface Options {
  levels: number[];
  vpsFactor: number;
  /** The entries' burst in the room, s; null: 10 s, or with a pace the room's minutes but the last (240 s). */
  burstSeconds: number | null;
  seed: number;
  databaseUrl: string;
  json: string;
  /** --pace X,Y: X buyers admitted every Y minutes (W4); null, no pace (everyone admitted at T0). */
  pace: LoadPace | null;
}

/** A release's pace in this test (W4): X buyers admitted every Y minutes. */
export interface LoadPace {
  batch: number;
  minutes: number;
}

/** --pace's value, `X,Y`: X buyers (LIVE_PACE_BATCH) every Y minutes (LIVE_PACE_MINUTES), the console's bounds. */
export function parsePace(value: string | undefined): LoadPace {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(value ?? '');
  const batch = m ? Number(m[1]) : NaN;
  const minutes = m ? Number(m[2]) : NaN;
  if (!(batch >= LIVE_PACE_BATCH.min && batch <= LIVE_PACE_BATCH.max && minutes >= LIVE_PACE_MINUTES.min && minutes <= LIVE_PACE_MINUTES.max)) {
    throw new Error(`--pace is X,Y: ${LIVE_PACE_BATCH.min} to ${LIVE_PACE_BATCH.max} buyers every ${LIVE_PACE_MINUTES.min} to ${LIVE_PACE_MINUTES.max} minutes (e.g. --pace 250,1)`);
  }
  return { batch, minutes };
}

/** The entries' burst in the room, s: --burst-seconds, else 10, or with a pace the room's minutes but the last. */
export function entryBurstSeconds(o: Pick<Options, 'burstSeconds' | 'pace'>): number {
  return o.burstSeconds ?? (o.pace ? (PACED_ROOM_MINUTES - 1) * 60 : 10);
}

/**
 * The release a level publishes: the time the streams have to connect before its room opens (a few seconds, more for a
 * larger audience; with a pace up to PACED_LEAD_MS, two minutes for 5 000), its room's minutes before T0, and whether
 * it has its after-room (not with a pace: the run measures the queue).
 */
export function releaseTimes(o: Pick<Options, 'pace'>, viewers: number): { leadMs: number; roomMinutes: number; afterRoom: boolean } {
  return o.pace
    ? { leadMs: Math.min(PACED_LEAD_MS, Math.max(10_000, Math.round(viewers * 24))), roomMinutes: PACED_ROOM_MINUTES, afterRoom: false }
    : { leadMs: Math.min(30_000, Math.max(10_000, Math.round(viewers * 8))), roomMinutes: ROOM_MINUTES, afterRoom: true };
}

/**
 * The batches a paced level needs: every viewer enters, so ceil(N / X) batches, the first at T0 and the k-th at
 * T0 + (k − 1) × Y; the last admits the rest. `spanMs` runs from T0 to the last batch.
 */
export function pacePlan(viewers: number, pace: LoadPace, opensAt: number): { batches: number; lastBatchAt: number; lastBatchSize: number; spanMs: number } {
  const batches = Math.max(1, Math.ceil(viewers / pace.batch));
  const spanMs = (batches - 1) * pace.minutes * 60_000;
  return { batches, lastBatchAt: opensAt + spanMs, lastBatchSize: viewers - (batches - 1) * pace.batch, spanMs };
}

export function parseArgs(argv: string[]): Options {
  const o: Options = {
    levels: [500, 1000, 1500, 2000],
    vpsFactor: DEFAULT_VPS_FACTOR,
    burstSeconds: null,
    seed: 20261004,
    databaseUrl: 'pglite:memory',
    json: join(ROOT, 'out', 'live-load', 'results.json'),
    pace: null,
  };
  const num = (v: string | undefined, name: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} needs a positive whole number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--levels') o.levels = (argv[++i] ?? '').split(',').map((s) => num(s.trim(), a));
    else if (a === '--vps-factor') {
      o.vpsFactor = Number(argv[++i]);
      if (!Number.isFinite(o.vpsFactor) || o.vpsFactor < 1) throw new Error('--vps-factor is a number, 1 or more');
    } else if (a === '--burst-seconds') o.burstSeconds = num(argv[++i], a);
    else if (a === '--seed') o.seed = num(argv[++i], a);
    else if (a === '--database-url') {
      o.databaseUrl = argv[++i] ?? '';
      if (!/^postgres(ql)?:\/\//.test(o.databaseUrl)) throw new Error('--database-url is a postgres:// URL (of a throwaway database)');
    }
    else if (a === '--json') o.json = resolve(argv[++i] ?? '');
    else if (a === '--pace') o.pace = parsePace(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(readFileSync(SELF, 'utf8').split('*/')[0]!.replace(/^\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (o.levels.length === 0) throw new Error('--levels needs at least one level');
  return o;
}

// ── Statistics ─────────────────────────────────────────────────────────────

interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentiles, rounded to 0.1. */
function stats(values: readonly number[]): Stats {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, p50: NaN, p95: NaN, p99: NaN, max: NaN };
  const q = (p: number) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]!;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { n, p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(v[n - 1]!) };
}

/** A small seeded generator (mulberry32): the same seed, the same sizes, moments and choices. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const mib = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
const round = (x: number) => Math.round(x * 10) / 10;

/** A fixed piece of work (arithmetic, SHA-256, JSON) timed once: the speed of the core the process runs on. */
async function calibrate(): Promise<number> {
  const { createHash } = await import('node:crypto');
  const t = performance.now();
  let x = 0;
  for (let i = 0; i < 3e6; i++) x += Math.sqrt(i);
  const b = Buffer.alloc(1024, x & 0xff);
  for (let i = 0; i < 2e5; i++) createHash('sha256').update(b).digest();
  const out: string[] = [];
  for (let i = 0; i < 2e5; i++) out.push(JSON.stringify({ a: i, b: 'x'.repeat(20), c: [1, 2, 3] }));
  return Math.round(performance.now() - t);
}

// ── The database's process (--database <socket>) ───────────────────────────

/**
 * What the app asks PGlite's process over its socket: a query (in a transaction or not), a transaction begun or ended.
 * Each message a 4-byte length then v8.serialize (dates, bytes and big numbers intact); the answers come back by `id`.
 */
type DatabaseCall =
  | { op: 'query'; sql: string; params: unknown[]; tx: number | null }
  | { op: 'begin'; tx: number }
  | { op: 'end'; tx: number; commit: boolean };

type DatabaseRequest = DatabaseCall & { id: number };

type DatabaseAnswer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: Record<string, unknown> };

interface Queryable {
  query(sql: string, params?: unknown[], options?: { rowMode?: 'object' }): Promise<{ rows: unknown[]; affectedRows?: number }>;
}

/** Length-prefixed v8 messages on a socket: `send` one, `onMessage` for each that arrives. */
function framed(socket: Socket, onMessage: (m: unknown) => void): (m: unknown) => void {
  let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32BE(0);
      if (buffer.length < 4 + size) break;
      const body = buffer.subarray(4, 4 + size);
      buffer = buffer.subarray(4 + size);
      onMessage(v8.deserialize(body));
    }
  });
  return (m) => {
    const body = v8.serialize(m);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length, 0);
    socket.write(Buffer.concat([head, body]));
  };
}

/**
 * PGlite alone in its process, on a socket, as PostgreSQL is a container of its own on the VPS reached over the network:
 * it shares neither the app's thread nor its memory, and runs on the performance cores whatever --cores says (it stands
 * in for PostgreSQL's own CPUs). Its resident memory is answered on the driver's channel.
 */
async function databaseProcess(socketPath: string): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLITE_PARSERS } = await import('../src/server/db/connection.js');
  const pglite = new PGlite({ parsers: PGLITE_PARSERS });
  await pglite.waitReady;
  const failure = (id: number, e: unknown): DatabaseAnswer => {
    const o = (e ?? {}) as Record<string, unknown>;
    const error: Record<string, unknown> = { message: String(o.message ?? e) };
    for (const k of ['code', 'constraint', 'table', 'column', 'detail', 'schema']) if (typeof o[k] === 'string') error[k] = o[k];
    return { id, ok: false, error };
  };
  const server = createServer((socket) => {
    const open = new Map<number, { tx: Queryable; end: (commit: boolean) => void; closed: Promise<unknown> }>();
    const answer = framed(socket, (message) => {
      const m = message as DatabaseRequest;
      if (m.op === 'query') {
        const on: Queryable = m.tx === null ? pglite : open.get(m.tx)!.tx;
        on.query(m.sql, m.params, { rowMode: 'object' }).then(
          (r) => answer({ id: m.id, ok: true, value: { rows: r.rows, affectedRows: r.affectedRows } }),
          (e: unknown) => answer(failure(m.id, e)),
        );
      } else if (m.op === 'begin') {
        let end!: (commit: boolean) => void;
        const decided = new Promise<boolean>((r) => (end = r));
        let begun!: () => void;
        const started = new Promise<void>((r) => (begun = r));
        const entry = { tx: pglite as Queryable, end, closed: Promise.resolve() as Promise<unknown> };
        open.set(m.tx, entry);
        entry.closed = pglite.transaction(async (tx) => {
          entry.tx = tx;
          begun();
          if (!(await decided)) throw new Error('rolled back by the app');
        });
        // A transaction that could not begin answers at once.
        Promise.race([started, entry.closed]).then(
          () => answer({ id: m.id, ok: true, value: null }),
          (e: unknown) => answer(failure(m.id, e)),
        );
      } else if (m.op === 'end') {
        const t = open.get(m.tx)!;
        open.delete(m.tx);
        t.end(m.commit);
        t.closed.then(
          () => answer({ id: m.id, ok: true, value: null }),
          (e: unknown) => answer(m.commit ? failure(m.id, e) : { id: m.id, ok: true, value: null }),
        );
      }
    }) as (a: DatabaseAnswer) => void;
    socket.on('error', () => socket.destroy());
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  process.on('message', (m: { type: string }) => {
    if (m.type === 'memory') process.send!({ type: 'memory', rss: process.memoryUsage().rss });
  });
  process.on('disconnect', () => {
    server.close();
    void pglite.close().finally(() => process.exit(0));
  });
  process.send!({ type: 'ready' });
}

/**
 * The app's side of PGlite's socket: what Kysely's PGlite dialect calls (`query`, `transaction`: one at a time, PGlite's
 * own lock, and the flags it reads), typed as a PGlite for createDbFromPGlite.
 */
async function connectDatabase(socketPath: string): Promise<{ pglite: import('@electric-sql/pglite').PGlite; close(): void }> {
  const socket = createConnection(socketPath);
  await new Promise<void>((r, reject) => socket.once('connect', r).once('error', reject));
  socket.setNoDelay(true);
  let seq = 0;
  let txSeq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const send = framed(socket, (message) => {
    const a = message as DatabaseAnswer;
    const w = waiting.get(a.id);
    if (!w) return;
    waiting.delete(a.id);
    if (a.ok) w.resolve(a.value);
    else w.reject(Object.assign(new Error(String(a.error.message)), a.error));
  });
  const ask = <T>(m: DatabaseCall): Promise<T> =>
    new Promise((resolveAsk, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve: resolveAsk as (v: unknown) => void, reject });
      send({ ...m, id });
    });
  const query = (tx: number | null) => (sql: string, params: unknown[] = []) => ask<{ rows: unknown[]; affectedRows?: number }>({ op: 'query', sql, params, tx });
  const proxy = {
    closed: false,
    ready: true,
    waitReady: Promise.resolve(),
    query: query(null),
    async transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T> {
      const tx = ++txSeq;
      await ask({ op: 'begin', tx });
      let out: T;
      try {
        out = await callback({ query: query(tx) });
      } catch (e) {
        await ask({ op: 'end', tx, commit: false });
        throw e;
      }
      await ask({ op: 'end', tx, commit: true });
      return out;
    },
    async close() {
      proxy.closed = true;
      socket.end();
    },
  };
  return { pglite: proxy as unknown as import('@electric-sql/pglite').PGlite, close: () => socket.end() };
}

// ── The app's process (--serve) ────────────────────────────────────────────

async function serve(): Promise<void> {
  const send = (m: ReadyMessage | ServerReport) => process.send!(m);
  const setup = await new Promise<SetupMessage>((r) => process.once('message', (m) => r(m as SetupMessage)));
  const calibrationMs = await calibrate();

  const { loadConfig } = await import('../src/server/config.js');
  const { buildApp } = await import('../src/server/app.js');
  const { createContext, startLiveEngine } = await import('../src/server/context.js');
  const { createForwardingLogger, loggerOptions } = await import('../src/server/http/logging.js');
  const { createDbFromPGlite } = await import('../src/server/db/connection.js');
  const { createModel, holdPieces } = await import('../test/support/live.js');
  const { withDrawSizes } = await import('../test/support/draws.js');
  const { sessionCookieName } = await import('../src/server/services/sessions.js');
  const { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } = await import('../src/server/services/after-room.js');
  const { defaultLocationId } = await import('../src/server/services/stock.js');
  const { livePaceFacts, paceCheck } = await import('../src/server/services/test-entrants.js');

  // As in production, but ORBES_ENV=development: no TLS, secrets or keys to provide; the production rate limits.
  const config = loadConfig({
    ORBES_ENV: 'development',
    DATABASE_URL: setup.databaseUrl,
    TRUST_PROXY: '127.0.0.1',
    PUBLIC_ORIGIN: ORIGIN,
    LOG_LEVEL: 'info',
  });
  // The process's stdout is the level's log file (the driver reads its errors afterwards).
  const log = createForwardingLogger(process.stdout);
  // PGlite in a process of its own, as PostgreSQL is a container of its own on the VPS: this process is the app alone,
  // its thread, its memory.
  const database = setup.databaseSocket ? await connectDatabase(setup.databaseSocket) : undefined;
  const ctx = await createContext(config, { log, ...(database ? { db: createDbFromPGlite(database.pglite) } : {}) });
  const app = await buildApp(ctx, { serveStatic: false, logger: loggerOptions(config) });
  log.attach(app.log);
  const engine = startLiveEngine(ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;

  const sample = (): MemorySample => {
    const m = process.memoryUsage();
    return { at: Date.now(), rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers };
  };
  const collect = () => (globalThis as { gc?: () => void }).gc?.();
  collect();
  const idle = sample();

  // ── The accounts, their pieces and sessions; the release ──
  const seeded = performance.now();
  const random = prng(setup.seed);
  const db = ctx.db;
  await db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).onConflict((oc) => oc.doNothing()).execute();
  const modelId = await createModel(db, 'MONOLITHE');
  const afterModelId = await createModel(db, 'AFTERGLOW');
  const adminEmail = `load-${randomUUID()}@orbes.load`;
  const adminId = (await db.insertInto('admin_users').values({ email: adminEmail, email_normalized: adminEmail, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  const admin = { type: 'admin' as const, id: adminId };

  const accountIds: string[] = [];
  for (let from = 0; from < setup.viewers; from += 500) {
    const rows = Array.from({ length: Math.min(500, setup.viewers - from) }, (_, k) => {
      const email = `load-${from + k}-${randomUUID().slice(0, 8)}@orbes.load`;
      return { email, email_normalized: email, password_hash: 'unused' };
    });
    accountIds.push(...(await db.insertInto('accounts').values(rows).returning('id').execute()).map((r) => r.id));
  }
  // A fifth of the accounts own pieces of the model: 10 % PALLADIUM (10 pieces), 5 % PLATINE (5), 5 % TITANE (1).
  const holdings: { accountId: string; pieces: number }[] = [];
  for (const id of accountIds) {
    const r = random();
    if (r < 0.1) holdings.push({ accountId: id, pieces: 10 });
    else if (r < 0.15) holdings.push({ accountId: id, pieces: 5 });
    else if (r < 0.2) holdings.push({ accountId: id, pieces: 1 });
  }
  // As the LIVE RELEASES' tests hold them (test/support/live.ts), each owner's pieces in one size.
  for (const h of holdings) await holdPieces(db, h.accountId, h.pieces, modelId, { variant: SIZES[Math.floor(random() * SIZES.length)]!.label });
  const viewers: { token: string; csrf: string }[] = [];
  for (const id of accountIds) {
    const s = await ctx.sessions.create({ subjectType: 'account', subjectId: id, userAgent: UA });
    viewers.push({ token: s.token, csrf: s.csrfToken });
  }
  const consoleSession = await ctx.sessions.create({ subjectType: 'admin', subjectId: adminId, mfaPassed: true, userAgent: UA });

  // A draw drawn before, every account entered (services/drops.ts, each entry its own transaction): each account has
  // taken part in one release (services/participation.ts). Created ahead, then its times moved so that it is open now,
  // then over, then drawn.
  const hour = 3_600_000;
  // Its pieces in one size (plan NEXT LOT §3.6.F: a draw's pieces are given per size), each account entered in it.
  // A draw's sizes are its model's (§5.1 #20): MONOLITHE, of no type for the LIVE RELEASE, given that size for the draw.
  const draw = await withDrawSizes(db, modelId, [SIZES[0]!.label], async () => {
    const created = await ctx.services.drops.create(
      { modelId, title: 'MONOLITHE · THE DRAW BEFORE', sizes: [{ label: SIZES[0]!.label, pieces: 25 }], opensAt: new Date(Date.now() + hour), closesAt: new Date(Date.now() + 2 * hour), earlyAccessHours: 0 },
      admin,
    );
    return ctx.services.drops.publish(created.id, admin);
  });
  await db.updateTable('drops').set({ opens_at: new Date(Date.now() - 2 * hour) }).where('id', '=', draw.id).execute();
  for (const id of accountIds) await ctx.services.drops.enter(id, draw.id, { type: 'account', id }, { sizeId: draw.sizes[0]!.id });
  await db.updateTable('drops').set({ closes_at: new Date(Date.now() - 1000) }).where('id', '=', draw.id).execute();
  await ctx.services.drops.draw(draw.id, admin);
  // The segment the release admits, read live at each check (services/segments.ts): taken part in a release, and active
  // (a sign-in, a session in use or a scan) in the last 30 days.
  const segment = await ctx.services.segments.create(
    { name: 'LOAD · TOOK PART, ACTIVE', criteria: { match: 'ALL', rules: [{ kind: 'PARTICIPATIONS', min: 1 }, { kind: 'ACTIVE', days: 30 }] } },
    admin,
  );

  const publishedAt = Date.now();
  const roomOpensAt = publishedAt + setup.leadMs;
  const opensAt = roomOpensAt + setup.roomMinutes * 60_000;
  const created = await ctx.services.liveConsole.create(
    {
      modelId,
      title: 'MONOLITHE · LIVE RELEASE',
      opensAt: new Date(opensAt),
      closesAt: new Date(opensAt + 3_600_000),
      roomOpensMinutes: setup.roomMinutes,
      priceMinor: 480_000,
      sizes: SIZES,
      addons: ADDONS,
      // LIVE RELEASE+: both rules read at each check, joined by AND (the heavier: neither stops the other).
      minParticipations: 1,
      accessSegmentId: segment.id,
      accessCombine: 'AND',
      surpriseEnabled: true,
      surpriseText: 'A polishing cloth in the house black.',
      // --pace: X people per batch every Y minutes, the first batch at T0; without it (ONE QUEUE, D1: every release has a
      // pace), the most a batch gives every minute, so everyone in the room has a turn at T0 as the door was measured.
      pace: setup.pace ?? { batch: 5000, minutes: 1 },
      holdMinutes: 0,
      afterRoom: setup.afterRoom
        ? {
            modelId: afterModelId,
            priceMinor: 120_000,
            sizes: AFTER_SIZES,
            addons: AFTER_ADDONS,
            delayMinutes: AFTER_ROOM_DELAY_MINUTES.min,
            lengthMinutes: AFTER_ROOM_LENGTH_MINUTES.min,
          }
        : null,
    },
    admin,
  );
  // The pieces made in advance, at the release's location (its default: the console named none).
  const locationId = await defaultLocationId(db);
  for (const s of await db.selectFrom('drop_sizes').select(['label', 'sku_id']).where('drop_id', '=', created.id).execute()) {
    const n = STOCKED[s.label];
    if (!n) continue;
    if (!s.sku_id) throw new Error(`size ${s.label} has no SKU`);
    await ctx.services.stock.adjust({ skuId: s.sku_id, locationId, delta: n, note: 'Load test: pieces made in advance.' }, admin);
  }
  await ctx.services.liveConsole.publish(created.id, {}, admin);
  const afterRoomId = (await db.selectFrom('drops').select('id').where('parent_drop_id', '=', created.id).executeTakeFirst())?.id ?? null;
  if (setup.afterRoom !== (afterRoomId !== null)) throw new Error(`the release was published ${afterRoomId ? 'with' : 'without'} an after-room`);
  const { token: boardToken } = await ctx.services.live.issueBoardLink(created.id, admin);
  const release = await db.selectFrom('drop_sizes').select(['id', 'label']).where('drop_id', '=', created.id).orderBy('position').execute();
  const addons = await db.selectFrom('live_addons').select('id').where('drop_id', '=', created.id).orderBy('position').execute();
  const seedMs = Math.round(performance.now() - seeded);

  // ── What the driver asks for afterwards: the pulses, the engine's passes, memory, CPU, the event loop ──
  const pulses: PulseRecord[] = [];
  const hub = app.liveHub;
  const pulse = hub.pulse.bind(hub);
  const timed = new WeakSet<Promise<void>>();
  hub.pulse = () => {
    const start = Date.now();
    const t = performance.now();
    const streams = hub.open.streams;
    const p = pulse();
    if (!timed.has(p)) {
      timed.add(p);
      void p.then(() => pulses.push({ start, end: Date.now(), ms: Math.round((performance.now() - t) * 10) / 10, streams }));
    }
    return p;
  };
  const ticks: TickRecord[] = [];
  const tick = engine.tick.bind(engine);
  engine.tick = async (...args: Parameters<typeof tick>) => {
    const start = Date.now();
    const t = performance.now();
    const out = await tick(...args);
    const r = out.releases.find((x) => x.dropId === created.id);
    ticks.push({ start, ms: Math.round((performance.now() - t) * 10) / 10, queued: r?.queued ?? 0 });
    return out;
  };
  // The seeding's garbage collected: the figures are the room's (an app running for days holds none of it).
  collect();
  const memory: MemorySample[] = [];
  const sampler = setInterval(() => memory.push({ ...sample(), streams: hub.open.streams }), 250);

  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const cpuAtReady = process.cpuUsage();
  const wallAtReady = performance.now();
  const cpuBySecond: number[] = [];
  let cpuThen = process.cpuUsage();
  let wallThen = performance.now();
  const cpuSampler = setInterval(() => {
    const used = process.cpuUsage(cpuThen);
    const wall = performance.now();
    cpuBySecond.push((used.user + used.system) / 1000 / (wall - wallThen));
    cpuThen = process.cpuUsage();
    wallThen = wall;
  }, 1000);

  // A host message every second from the announcement to T0: every pulse then sends every viewer a new room.
  let messageErrors = 0;
  let n = 0;
  const messages = setInterval(() => {
    if (Date.now() >= opensAt) return clearInterval(messages);
    ctx.services.live.message(created.id, `THE DOOR OPENS AT THE SAME SECOND FOR EVERYONE · ${++n}`, admin).catch(() => messageErrors++);
  }, 1000);

  /** What the two rooms left in the database. */
  const factsOf = async (): Promise<ReleaseFacts> => {
    const ids = afterRoomId ? [created.id, afterRoomId] : [created.id];
    const orders = await db.selectFrom('orders').select(['id', 'drop_id', 'reservation']).where('drop_id', 'in', ids).execute();
    const child = afterRoomId ? await db.selectFrom('drops').select('ended_reason').where('id', '=', afterRoomId).executeTakeFirstOrThrow() : { ended_reason: null };
    // Without an after-room (--pace): no guest, no entry (an id no row has).
    const afterId = afterRoomId ?? randomUUID();
    const count = async (q: Promise<{ n: number | string | bigint }>) => Number((await q).n);
    return {
      orders: {
        main: orders.filter((o) => o.drop_id === created.id).length,
        afterRoom: orders.filter((o) => o.drop_id === afterRoomId).length,
        stock: orders.filter((o) => o.reservation === 'STOCK').length,
        awaiting: orders.filter((o) => o.reservation === 'AWAITING').length,
        other: orders.filter((o) => o.reservation !== 'STOCK' && o.reservation !== 'AWAITING').length,
      },
      afterRoom: {
        guests: await count(db.selectFrom('after_room_guests').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', afterId).executeTakeFirstOrThrow()),
        reason: child.ended_reason,
        confirmed: await count(db.selectFrom('live_entries').select((eb) => eb.fn.countAll<number>().as('n')).where('drop_id', '=', afterId).where('status', '=', 'CONFIRMED').executeTakeFirstOrThrow()),
      },
      journal: await count(db.selectFrom('event_journal').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()),
      pace: setup.pace ? await pacedFacts() : null,
    };
  };

  /** A paced release's batches, as its audit log recorded them, and the TEST REPORT's PACE check on its entries and log. */
  const pacedFacts = async (): Promise<PacedFacts> => {
    const row = await db.selectFrom('drops').selectAll().where('id', '=', created.id).executeTakeFirstOrThrow();
    const facts = await livePaceFacts(db, row, new Date());
    const check = paceCheck(facts);
    return {
      batches: facts.events.flatMap((e) => (e.kind === 'BATCH' ? [{ batch: e.batch, at: e.at.getTime(), entries: e.entries, recordedAt: e.recordedAt.getTime() }] : [])),
      placed: facts.entries.length,
      admitted: facts.entries.filter((e) => e.admittedAt !== null).length,
      check: { pass: check.pass, line: check.line },
    };
  };

  process.on('message', async (m: { type: string }) => {
    if (m.type === 'collect') {
      clearInterval(sampler);
      clearInterval(cpuSampler);
      clearInterval(messages);
      loop.disable();
      const cpu = process.cpuUsage(cpuAtReady);
      const facts = await factsOf();
      send({
        type: 'report',
        pulses,
        ticks,
        memory,
        maxRssBytes: process.resourceUsage().maxRSS * 1024,
        cpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
        wallMs: Math.round(performance.now() - wallAtReady),
        loopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
        cpuBySecond,
        messageErrors,
        facts,
      });
    } else if (m.type === 'stop') {
      await app.close();
      await engine.stop();
      await ctx.close();
      database?.close();
      process.exit(0);
    }
  });

  send({
    type: 'ready',
    port,
    dropId: created.id,
    afterRoomId,
    sizes: release,
    addons: addons.map((a) => a.id),
    roomOpensAt,
    opensAt,
    cookie: sessionCookieName(config, 'account'),
    viewers,
    console: { cookie: `${sessionCookieName(config, 'admin')}=${consoleSession.token}` },
    boardToken,
    seedMs,
    calibrationMs,
    idle,
    baseline: sample(),
  });
}

// ── The driver: the phones ─────────────────────────────────────────────────

type ActionKind = 'interest' | 'enter' | 'press' | 'secure' | 'addons' | 'confirm' | 'release';
/** The release's room, or its after-room. */
type RoomKey = 'main' | 'after';
const ROOMS: readonly RoomKey[] = ['main', 'after'];

interface ActionRecord {
  room: RoomKey;
  kind: ActionKind;
  ms: number;
  status: number;
  code?: string;
}

/** A phone's stream of one room. */
interface StreamState {
  /** When it asked, and when its first event arrived. */
  asked: number;
  connectedMs: number | null;
  status: number | null;
  ended: boolean;
  dropped: boolean;
  /** --pace: ended by the server (or refused, 204) while the entry waits behind the next batch (W2): neither dropped nor refused. */
  parked: boolean;
  /** Closed by its phone, its entry over (as the page does, web/verify/views/live.ts `done`): not dropped. */
  closedByPhone: boolean;
  close: () => void;
}

interface Viewer {
  i: number;
  ip: string;
  cookie: string;
  csrf: string;
  sizeId: string;
  streams: Record<RoomKey, StreamState | null>;
  /** Its place in the main line has reached it. */
  placed: boolean;
  acting: Record<RoomKey, boolean>;
  outcome: Record<RoomKey, string | null>;
  /** The after-room's T0, from the second door its last frame of the main room carried: a guest. */
  door: number | null;
  /** --pace: what its phone read of the queue. */
  queue: QueuePhone;
  /** --pace: its entry waits behind the next batch (its last `you` or state said `queue.next` false); its state read meanwhile. */
  behind: boolean;
  polling: boolean;
}

/** What a phone read of the queue (W2) on a paced release: from its `you` events and the queue's frames. */
export interface QueuePhone {
  /** It waited for a batch: a `you` event carried its queue. */
  waited: boolean;
  /** The estimated entry time its first queue view gave, and its last place in the queue. */
  firstEta: number | null;
  lastPlace: number | null;
  /** The next batch's time, from the last queue frame it read: the batch it waits for. */
  waitingFor: number | null;
  /** When its phone read its admission (a `you` event, QUEUED or TURN, its queue gone), and the batch's time it waited for then. */
  admittedSeenAt: number | null;
  admittedFor: number | null;
}

/** One queue frame a waiting phone read: its pulse's time, when it was read, and how many waiting phones held a stream then. */
interface QueueEvent {
  now: number;
  at: number;
  streaming: number;
}

/**
 * The queue on the phones (W2, W4): every phone that waited was admitted; none from a place beyond X (the published
 * order: its last place before its batch within the batch); at the time its first estimate gave (the queue held no
 * pause, nobody left: the estimate is exact); the batches it saw; and how long each admission took to reach its phone
 * after the batch's time.
 */
export function queueVerdict(phones: readonly QueuePhone[], pace: LoadPace): { waited: number; admitted: number; orderBroken: number; etaKept: number; batchesSeen: number; delivery: number[] } {
  const waited = phones.filter((q) => q.waited);
  const admitted = waited.filter((q) => q.admittedSeenAt !== null && q.admittedFor !== null);
  return {
    waited: waited.length,
    admitted: admitted.length,
    orderBroken: admitted.filter((q) => q.lastPlace === null || q.lastPlace > pace.batch).length,
    etaKept: admitted.filter((q) => q.firstEta !== null && q.firstEta === q.admittedFor).length,
    batchesSeen: new Set(admitted.map((q) => q.admittedFor)).size,
    delivery: admitted.map((q) => q.admittedSeenAt! - q.admittedFor!),
  };
}

/** One reading of macOS's `footprint` for the app: its physical footprint, its peak so far, and the memory it lists as reclaimable. */
interface FootprintSample {
  at: number;
  footprintMib: number;
  peakMib: number | null;
  reclaimableMib: number;
}

/**
 * `footprint -p <pid>`'s header (« Footprint: 412 MB »), its `phys_footprint_peak` (the most since the process
 * started; null when absent) and its categories' Reclaimable column, summed, in MiB; null when it cannot be read.
 */
export function parseFootprint(out: string): { footprintMib: number; peakMib: number | null; reclaimableMib: number } | null {
  const mibOf = (n: string, unit: string) => Number(n) * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 } as Record<string, number>)[unit.toUpperCase()]!;
  const head = /Footprint:\s*([\d.]+)\s*(B|KB|MB|GB)\b/i.exec(out);
  if (!head) return null;
  const peak = /phys_footprint_peak:\s*([\d.]+)\s*(B|KB|MB|GB)\b/i.exec(out);
  let reclaimable = 0;
  for (const line of out.split('\n')) {
    const m = /^\s*([\d.]+)\s*(B|KB|MB|GB)\s+([\d.]+)\s*(B|KB|MB|GB)\s+([\d.]+)\s*(B|KB|MB|GB)\s+\d+\s+\S/i.exec(line);
    if (m) reclaimable += mibOf(m[5]!, m[6]!);
  }
  const round1 = (x: number) => Math.round(x * 10) / 10;
  return { footprintMib: round1(mibOf(head[1]!, head[2]!)), peakMib: peak ? round1(mibOf(peak[1]!, peak[2]!)) : null, reclaimableMib: round1(reclaimable) };
}

/** A phase's memory as the report reads it: its peak, the streams open then, the most open. */
function phaseLine(x: PhaseFigures): string {
  if (x.peakMib === null) return '—';
  const footprint = x.footprintPeakMib === null ? '' : `; footprint at most ${x.footprintPeakMib} MiB by its end (${x.reclaimableAtPeakMib} MiB reclaimable then)`;
  return `peak ${x.peakMib} MiB resident with ${x.streamsAtPeak ?? '—'} streams open (at most ${x.maxStreams ?? '—'})${footprint}`;
}

/** Per minute from T0 (negative before it): the peak resident memory and footprint in that minute, and the most streams open. */
function byMinute(memory: readonly MemorySample[], footprints: readonly FootprintSample[], t0: number): { minute: number; rssMib: number; footprintMib: number | null; streams: number }[] {
  const out = new Map<number, { minute: number; rssMib: number; footprintMib: number | null; streams: number }>();
  for (const m of memory) {
    const minute = Math.floor((m.at - t0) / 60_000);
    const r = out.get(minute) ?? { minute, rssMib: 0, footprintMib: null, streams: 0 };
    r.rssMib = Math.max(r.rssMib, mib(m.rss));
    r.streams = Math.max(r.streams, m.streams ?? 0);
    out.set(minute, r);
  }
  for (const f of footprints) {
    const r = out.get(Math.floor((f.at - t0) / 60_000));
    if (r) r.footprintMib = Math.max(r.footprintMib ?? 0, f.footprintMib);
  }
  return [...out.values()].sort((a, b) => a.minute - b.minute);
}

/** The most of these moments (ms) within one second, counted per whole second. */
export function peakPerSecond(moments: readonly number[]): number {
  const bySecond = new Map<number, number>();
  for (const m of moments) bySecond.set(Math.floor(m / 1000), (bySecond.get(Math.floor(m / 1000)) ?? 0) + 1);
  return Math.max(0, ...bySecond.values());
}

/**
 * The batches on the server against the plan (pacePlan): as many as needed, numbered 1 to B, each of X but the last (the
 * rest), the k-th at T0 + (k − 1) × Y to the millisecond. A line saying what is wrong, or null.
 */
export function pacedBatchesProblem(batches: readonly PacedBatch[], viewers: number, pace: LoadPace, opensAt: number): string | null {
  const plan = pacePlan(viewers, pace, opensAt);
  if (batches.length !== plan.batches) return `${batches.length} batches recorded, ${plan.batches} expected.`;
  for (const [i, b] of [...batches].sort((x, y) => x.batch - y.batch).entries()) {
    const size = i === plan.batches - 1 ? plan.lastBatchSize : pace.batch;
    if (b.batch !== i + 1) return `Batch ${b.batch} recorded where batch ${i + 1} was expected.`;
    if (b.entries !== size) return `Batch ${b.batch} admitted ${b.entries}, ${size} expected.`;
    if (b.at !== opensAt + i * pace.minutes * 60_000) return `Batch ${b.batch} came at T0 + ${b.at - opensAt} ms, T0 + ${i * pace.minutes * 60_000} ms expected.`;
  }
  return null;
}

interface RoomEvent {
  room: RoomKey;
  now: number;
  at: number;
}

/** A room's end, as its phones read it. */
interface RoomOutcome {
  reason: string | null;
  confirmed: number;
  released: number;
  /** When a phone first read it, after the room's T0. */
  endedMs: number | null;
}

interface FanOut {
  /** The pulses that reached at least FULL_PULSE of the room's viewers. */
  full: number;
  received: Stats;
}

interface LevelResult {
  viewers: number;
  vpsFactor: number;
  calibrationMs: number;
  seedMs: number;
  streams: { opened: number; refused: number; dropped: number; connect: Stats };
  actions: {
    all: Stats;
    byKind: Record<ActionKind, Stats>;
    /** The main room's actions (I'LL BE THERE included), and the after-room's (ENTER, PRESS, SECURE, add-ons, PAY, RELEASE): `all` is both. */
    main: Stats;
    afterRoom: Stats;
    unexpected: { room: RoomKey; kind: ActionKind; status: number; code?: string }[];
    /** The app's share of an action: its event loop's p99 delay and its CPU per action (all of it over the run, divided by the actions: an upper bound). */
    appShareMs: number;
    /** The p95 on the VPS: the app's share taken --vps-factor times slower, the rest (the database's wait) as measured. */
    vpsP95Ms: number;
    /**
     * --pace: the door's actions (I'LL BE THERE and ENTER, before T0: the pace does not meter them) and those behind the
     * pace (the turns, PAY, RELEASE), which the action target is then held against.
     */
    door: Stats;
    behind: Stats;
  };
  fanOut: { pulses: number; full: number; received: Stats; afterRoom: FanOut; serverPulse: Stats; serverPulseFull: Stats };
  turns: { given: number; delivery: Stats; lineDrawnMs: number | null; t0PassMs: number | null };
  engine: { passes: number; pass: Stats };
  memory: {
    /** The process: started, before the streams (the test's accounts and release made), and at its peak. */
    idleMib: number;
    baselineMib: number;
    peakRssMib: number;
    peakHeapMib: number;
    /** At the peak: V8's heap (held, used), the memory outside it (buffers, code, the allocator), in MiB. */
    atPeak: { heapTotalMib: number; heapUsedMib: number; externalMib: number; outsideHeapMib: number };
    /** The app as the VPS's container holds it: with the GeoIP database. */
    withGeoIpMib: number;
    limitMib: number;
    perViewerKib: number;
    /** PGlite's process at its peak, for information (PostgreSQL's container: 1 GB on the VPS). */
    databasePeakMib: number | null;
  };
  cpu: { userMs: number; systemMs: number; wallMs: number; cores: number; busiest5s: number };
  loopDelayMs: { p50: number; p99: number; max: number };
  /** The main room's end, after T0. */
  outcome: RoomOutcome;
  /** The after-room: its guests, their phones' doors read and streams, its end after its T0. */
  afterRoom: {
    /** --pace: the release had no after-room. */
    none: boolean;
    guests: number;
    doorRead: Stats;
    streams: { opened: number; refused: number; dropped: number; connect: Stats };
    /** Guests who came after the after-room, or their size, had sold out (AFTER_ROOM_LATE_CODES, a page ended or a stream's 204). */
    late: number;
    outcome: RoomOutcome;
  };
  /** What the rooms left in the database: the orders (held in stock or waiting), the after-room's guests, the journal. */
  facts: ReleaseFacts;
  /** --pace: the queue and its batches; null without a pace. */
  pace: PacedResult | null;
  appErrors: number;
  messageErrors: number;
  /** pace: the queue held exactly (its batches, the PACE check, the phones); queueFanOut: its frames against the fan-out target. */
  verdict: { action: boolean; fanOut: boolean; memory: boolean; cpu: boolean; clean: boolean; pace: boolean; queueFanOut: boolean; pass: boolean };
}

interface PacedResult {
  pace: LoadPace;
  /** The batches planned (pacePlan), and those the audit log recorded: their problem against the plan, or null. */
  planned: number;
  batches: PacedBatch[];
  problem: string | null;
  /** From each batch's time to the engine's writing it. */
  engineLag: Stats;
  /** The TEST REPORT's PACE check on the release's entries and log. */
  check: { pass: boolean; line: string };
  placed: number;
  admitted: number;
  /** The queue on the phones (queueVerdict), its admissions on the phone after their batch's time. */
  phones: Omit<ReturnType<typeof queueVerdict>, 'delivery'> & { delivery: Stats };
  /** The queue's frames: from each pulse's time to the last phone waiting on a stream that read it, over the pulses that reached 95 % of them. */
  fanOut: { pulses: number; full: number; received: Stats };
  /** W2: the app's memory before T0 (everyone in the room on a stream) and from T0 + QUEUE_SETTLE_MS on: its peak, the streams open then, the most open. */
  memory: { beforeT0: PhaseFigures; fromT0: PhaseFigures };
  /** macOS: the two readings of `footprint` (just before T0, once the release is over). */
  footprints: FootprintSample[];
  memoryByMinute: { minute: number; rssMib: number; footprintMib: number | null; streams: number }[];
  /** W2: the phones behind the next batch: their streams ended (or refused) by the server, opened again once their batch was the next one, their state reads. */
  queueStreams: { parked: number; reopened: number; stateReads: Stats; stateReadsNot200: number; stateReadsPeakPerSecond: number };
}

interface PhaseFigures {
  peakMib: number | null;
  streamsAtPeak: number | null;
  maxStreams: number | null;
  /**
   * macOS: the app's physical footprint at its most (`footprint`'s phys_footprint_peak read at the phase's end: just
   * before T0, then once the release is over, so the second is the run's), and what it listed as reclaimable then.
   */
  footprintPeakMib: number | null;
  reclaimableAtPeakMib: number | null;
}

/** The app's process, its log (stdout) in the level's file. */
function startServer(logPath: string): ChildProcess {
  const out = openSync(logPath, 'w');
  const child = fork(SELF, ['--serve'], { stdio: ['ignore', out, 'inherit', 'ipc'], execArgv: [...process.execArgv, ...VPS_HEAP_FLAGS, '--expose-gc'] });
  closeSync(out);
  return child;
}

/** PGlite's process (it stands in for PostgreSQL's container), its peak memory sampled. */
async function startDatabase(socketPath: string): Promise<{ peak(): number; stop(): Promise<void> }> {
  rmSync(socketPath, { force: true });
  const child = fork(SELF, ['--database', socketPath], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await nextMessage(child, 'ready');
  let peak = 0;
  child.on('message', (m: { type: string; rss?: number }) => {
    if (m.type === 'memory') peak = Math.max(peak, m.rss ?? 0);
  });
  const sampler = setInterval(() => child.connected && child.send({ type: 'memory' }), 1000);
  return {
    peak: () => peak,
    async stop() {
      clearInterval(sampler);
      const exited = new Promise((r) => child.once('exit', r));
      child.disconnect();
      await exited;
      rmSync(socketPath, { force: true });
    },
  };
}

function nextMessage<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: { type: string }) => {
      if (m.type !== type) return;
      cleanup();
      resolve(m as T);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`a process of the test ended (${code}) before its ${type}`));
    };
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function runLevel(o: Options, viewersWanted: number): Promise<LevelResult> {
  const dir = dirname(o.json);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `server-${viewersWanted}.log`);
  const pglite = o.databaseUrl === 'pglite:memory';
  const socketPath = join(tmpdir(), `orbes-live-load-${process.pid}-${viewersWanted}.sock`);
  const database = pglite ? await startDatabase(socketPath) : undefined;
  const child = startServer(logPath);
  // macOS: the app's physical footprint (`footprint`, what the system charges the process: its resident memory less the
  // pages the allocators have given back, which RSS still counts until the system takes them), read twice only, as it
  // stops the process while it walks its memory: just before T0 and once the release is over, each with its peak so far.
  const footprints: FootprintSample[] = [];
  const readFootprint = (): Promise<void> =>
    platform() !== 'darwin' || !child.pid
      ? Promise.resolve()
      : new Promise((done) => {
          const at = Date.now();
          execFile('/usr/bin/footprint', ['-p', String(child.pid)], { timeout: 20_000 }, (err, out) => {
            const f = err ? null : parseFootprint(out);
            if (f) footprints.push({ at, ...f });
            done();
          });
        });
  child.send({ type: 'setup', viewers: viewersWanted, ...releaseTimes(o, viewersWanted), databaseUrl: o.databaseUrl, databaseSocket: pglite ? socketPath : null, seed: o.seed, pace: o.pace } satisfies SetupMessage);
  const ready = await nextMessage<ReadyMessage>(child, 'ready');
  process.stdout.write(`  ${viewersWanted}: app ready (port ${ready.port}, seeded in ${(ready.seedMs / 1000).toFixed(1)} s, calibration ${ready.calibrationMs} ms)\n`);

  const random = prng(o.seed + viewersWanted);
  // --pace: the batches the level needs; until the last, a turn ends in RELEASE MY PLACE, so the release lasts.
  const plan = o.pace ? pacePlan(viewersWanted, o.pace, ready.opensAt) : null;
  /** The queue's frames the waiting phones read. */
  const queueEvents: QueueEvent[] = [];
  const agent = new Agent({ keepAlive: true });
  const actions: ActionRecord[] = [];
  /** Guests who came after the after-room, or their size, had sold out. */
  const lateGuests = new Set<Viewer>();
  /** The after-room's door read by each guest (GET …/after-room): a page read, reported beside the actions. */
  const doorReads: { ms: number; status: number }[] = [];
  const rooms: RoomEvent[] = [];
  const deliveries: number[] = [];
  let given = 0;
  let firstPlaced: number | null = null;
  let placed = 0;
  const last: Record<RoomKey, { phase?: string; over?: boolean; endedReason?: string | null }> = { main: {}, after: {} };
  /** When a phone first read each room's end. */
  const endRead: Record<RoomKey, number | null> = { main: null, after: null };
  /** The after-room's id and sizes, as its door answers them. */
  let afterRoom: { id: string; sizes: { id: string }[]; addons: string[] } | null = null;
  const dropOf = (room: RoomKey) => (room === 'main' ? ready.dropId : afterRoom!.id);

  const viewers: Viewer[] = ready.viewers.map((s, i) => ({
    i,
    // Each phone on a network of its own (a /24 apart): the rate group `live` counts per network and per account.
    ip: `10.${(i >> 8) & 255}.${i & 255}.7`,
    cookie: `${ready.cookie}=${s.token}`,
    csrf: s.csrf,
    sizeId: ready.sizes[Math.floor(random() * ready.sizes.length)]!.id,
    streams: { main: null, after: null },
    placed: false,
    acting: { main: false, after: false },
    outcome: { main: null, after: null },
    door: null,
    queue: { waited: false, firstEta: null, lastPlace: null, waitingFor: null, admittedSeenAt: null, admittedFor: null },
    behind: false,
    polling: false,
  }));
  /** --pace: the phones waiting for their batch on a stream (the next batch's), which the queue's frames reach. */
  const queueStreaming = new Set<Viewer>();
  /** --pace: the state reads of the phones behind the next batch (W2), and the streams opened again once it was theirs. */
  const stateReads: { ms: number; status: number; at: number }[] = [];
  let reopened = 0;
  /** The phones whose stream the server ended (or refused) behind the next batch. */
  const parked = new Set<Viewer>();
  let finished = false;

  /** One request of a phone, timed. */
  const request = (v: Viewer, method: string, path: string, body: unknown): Promise<{ status: number; ms: number; json: Record<string, unknown> | null }> =>
    new Promise((resolveCall) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      const t = performance.now();
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: ready.port,
          method,
          path,
          agent,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
            cookie: v.cookie,
            origin: ORIGIN,
            'x-csrf-token': v.csrf,
            'x-forwarded-for': v.ip,
            'user-agent': UA,
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (text += c));
          res.on('end', () => {
            let json: Record<string, unknown> | null = null;
            try {
              json = JSON.parse(text) as Record<string, unknown>;
            } catch {
              json = null;
            }
            resolveCall({ status: res.statusCode ?? 0, ms: performance.now() - t, json });
          });
        },
      );
      req.on('error', () => resolveCall({ status: 0, ms: performance.now() - t, json: null }));
      req.end(payload);
    });

  const call = async (v: Viewer, room: RoomKey, kind: ActionKind, method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> => {
    const r = await request(v, method, `/api/v1/live/${dropOf(room)}${path}`, body);
    const code = r.status === 0 ? 'NETWORK' : (r.json?.error as { code?: string } | undefined)?.code;
    actions.push({ room, kind, ms: r.ms, status: r.status, ...(code ? { code } : {}) });
    if (room === 'after' && kind === 'enter' && r.status === 409 && code && AFTER_ROOM_LATE_CODES.includes(code)) lateGuests.add(v);
    return r;
  };

  /** A turn on its phone: PRESS, the hold, SECURE, the add-ons for half, then PAY (7 in 10) or RELEASE MY PLACE. */
  const takeTurn = async (v: Viewer, room: RoomKey, token: string) => {
    v.acting[room] = true;
    const addons = room === 'main' ? ready.addons : null;
    try {
      if ((await call(v, room, 'press', 'POST', '/press', { token })).status !== 200) return;
      await sleep(HOLD_MS);
      if ((await call(v, room, 'secure', 'POST', '/secure', { token })).status !== 200) return;
      if (random() < 0.5) {
        const ids = addons ?? afterRoom!.addons;
        if (ids.length) await call(v, room, 'addons', 'PUT', '/addons', { addonIds: [ids[Math.floor(random() * ids.length)]!] });
      }
      await sleep(random() * 1000);
      // --pace: before the last batch, the place given back, so that the pieces last until every batch is admitted.
      if (plan && room === 'main' && Date.now() < plan.lastBatchAt) {
        if ((await call(v, room, 'release', 'POST', '/release', {})).status === 200) v.outcome[room] = 'RELEASED';
      } else if (random() < 0.7) {
        if ((await call(v, room, 'confirm', 'POST', '/confirm', {})).status === 200) v.outcome[room] = 'CONFIRMED';
      } else if ((await call(v, room, 'release', 'POST', '/release', {})).status === 200) v.outcome[room] = 'RELEASED';
    } finally {
      v.acting[room] = false;
    }
  };

  const onEvent = (v: Viewer, room: RoomKey, block: string, at: number) => {
    let name = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!data) return;
    const body = JSON.parse(data) as Record<string, unknown>;
    const stream = v.streams[room]!;
    if (stream.connectedMs === null) stream.connectedMs = at - stream.asked;
    if (name === 'room') {
      rooms.push({ room, now: Date.parse(body.now as string), at });
      last[room] = body as (typeof last)[RoomKey];
      if (last[room].endedReason && endRead[room] === null) endRead[room] = at;
    } else if (name === 'queue') {
      // W2: the queue's frame, shared by the phones waiting for their batch.
      queueEvents.push({ now: Date.parse(body.now as string), at, streaming: queueStreaming.size });
      v.queue.waitingFor = Date.parse(body.nextBatchAt as string);
    } else if (name === 'you') {
      const entry = body.entry as {
        status: string;
        position: number | null;
        turn: { at: string; token: string | null } | null;
        afterRoom?: { opensAt: string } | null;
        queue?: { place: number; etaAt: string | null; paused: boolean; next: boolean } | null;
      } | null;
      if (room === 'main') {
        // W2: behind the next batch, the server ends this stream after this chunk (the phone then reads its state).
        v.behind = entry?.queue?.next === false;
        if (entry?.queue && !v.behind) queueStreaming.add(v);
        else queueStreaming.delete(v);
      }
      if (room === 'main' && entry?.queue) {
        v.queue.waited = true;
        v.queue.lastPlace = entry.queue.place;
        if (v.queue.firstEta === null && entry.queue.etaAt) v.queue.firstEta = Date.parse(entry.queue.etaAt);
      } else if (room === 'main' && v.queue.waited && v.queue.admittedSeenAt === null && (entry?.status === 'QUEUED' || entry?.status === 'TURN')) {
        // Its batch let it in: its queue gone, its entry in the line.
        v.queue.admittedSeenAt = at;
        v.queue.admittedFor = v.queue.waitingFor;
      }
      if (room === 'main' && entry?.position != null && !v.placed) {
        v.placed = true;
        placed++;
        firstPlaced ??= at;
      }
      if (room === 'main' && entry?.afterRoom) v.door = Date.parse(entry.afterRoom.opensAt);
      if (entry?.status === 'TURN' && entry.turn?.token && !v.acting[room]) {
        given++;
        deliveries.push(at - Date.parse(entry.turn.at));
        void takeTurn(v, room, entry.turn.token);
      }
      // --pace: its entry over, the phone closes its stream as the page does (the release lasts twenty minutes; without a
      // pace it ends within seconds, every stream with it, as before).
      if (plan && entry && FINAL_STATUSES.has(entry.status) && !stream.closedByPhone) {
        stream.closedByPhone = true;
        stream.close();
      }
    }
  };

  /**
   * W2: a phone behind the next batch reads its state, first after `firstMs`, then as its `pollMs` says, until its batch
   * is the next one (or it is let in): then its stream again. Nothing once the release is over or the entry final.
   */
  const pollState = (v: Viewer, firstMs: number) => {
    if (v.polling) return;
    v.polling = true;
    const read = async () => {
      if (finished || last.main.over) {
        v.polling = false;
        return;
      }
      const r = await request(v, 'GET', `/api/v1/live/${ready.dropId}/state`, undefined);
      stateReads.push({ ms: r.ms, status: r.status, at: Date.now() });
      const entry = r.json?.entry as { status: string; queue: { place: number; etaAt: string | null; next: boolean } | null } | null | undefined;
      const frame = r.json?.queue as { nextBatchAt?: string } | undefined;
      const pollMs = typeof r.json?.pollMs === 'number' ? r.json.pollMs : LIVE_QUEUE_POLL_MS;
      if (r.status === 200 && entry) {
        if (entry.queue) {
          v.queue.waited = true;
          v.queue.lastPlace = entry.queue.place;
          if (v.queue.firstEta === null && entry.queue.etaAt) v.queue.firstEta = Date.parse(entry.queue.etaAt);
          if (frame?.nextBatchAt) v.queue.waitingFor = Date.parse(frame.nextBatchAt);
        }
        v.behind = entry.queue?.next === false;
        if (!['QUEUED', 'TURN', 'SECURED', 'WAITING'].includes(entry.status)) {
          v.polling = false;
          return;
        }
        if (!v.behind) {
          v.polling = false;
          reopened++;
          openStream(v, 'main');
          return;
        }
      }
      setTimeout(() => void read(), pollMs);
    };
    setTimeout(() => void read(), firstMs);
  };

  const openStream = (v: Viewer, room: RoomKey) => {
    const stream: StreamState = { asked: Date.now(), connectedMs: null, status: null, ended: false, dropped: false, parked: false, closedByPhone: false, close: () => {} };
    v.streams[room] = stream;
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: ready.port,
        method: 'GET',
        path: `/api/v1/live/${dropOf(room)}/stream`,
        agent: false,
        headers: { accept: 'text/event-stream', cookie: v.cookie, 'x-forwarded-for': v.ip, 'user-agent': UA },
      },
      (res: IncomingMessage) => {
        stream.status = res.statusCode ?? 0;
        if (res.statusCode !== 200) {
          res.resume();
          // W2: still behind the next batch for the server: its state read again.
          if (room === 'main' && res.statusCode === 204 && v.queue.waited && !last.main.over) {
            stream.parked = true;
            parked.add(v);
            pollState(v, LIVE_QUEUE_POLL_MS);
          }
          return;
        }
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk: string) => {
          const at = Date.now();
          buffer += chunk;
          for (let k = buffer.indexOf('\n\n'); k >= 0; k = buffer.indexOf('\n\n')) {
            onEvent(v, room, buffer.slice(0, k), at);
            buffer = buffer.slice(k + 2);
          }
        });
        res.on('close', () => {
          stream.ended = true;
          if (room === 'main') queueStreaming.delete(v);
          // W2: ended by the server behind the next batch: the state read, from a moment of its own.
          if (room === 'main' && v.behind && !last.main.over) {
            stream.parked = true;
            parked.add(v);
            pollState(v, random() * LIVE_QUEUE_SPREAD_MS);
          } else if (!last[room].over && !stream.closedByPhone) stream.dropped = true;
        });
      },
    );
    stream.close = () => req.destroy();
    req.on('error', () => {
      stream.ended = true;
      if (!stream.closedByPhone) stream.dropped = true;
    });
    req.end();
  };

  /** The console's stream and a boutique board's, read and discarded: the server builds them every pulse. */
  const side: IncomingMessage[] = [];
  const openSide = (method: string, path: string, headers: Record<string, string>, body?: string) => {
    const req = httpRequest({ host: '127.0.0.1', port: ready.port, method, path, agent: false, headers: { accept: 'text/event-stream', 'user-agent': UA, ...headers } }, (res) => {
      side.push(res);
      res.resume();
    });
    req.on('error', () => {});
    req.end(body);
  };
  openSide('GET', `/api/admin/live/${ready.dropId}/stream`, { cookie: ready.console.cookie, 'x-forwarded-for': '192.0.2.10' });
  const boardBody = JSON.stringify({ token: ready.boardToken });
  openSide('POST', `/api/v1/live/${ready.dropId}/board/stream`, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(boardBody)), origin: ORIGIN, 'x-forwarded-for': '192.0.2.20' }, boardBody);

  // The streams, spread over the time before the room opens (two seconds spare); half of the accounts say I'LL BE
  // THERE over the same seconds.
  const spread = Math.max(1000, ready.roomOpensAt - Date.now() - 2000);
  for (const v of viewers) setTimeout(() => openStream(v, 'main'), (v.i / viewers.length) * spread);
  const interest = viewers.filter(() => random() < 0.5).map((v) => sleep(random() * spread).then(() => call(v, 'main', 'interest', 'PUT', '/interest', { sizeId: v.sizeId })));

  // The burst of entries, in the first seconds of the room.
  await sleep(ready.roomOpensAt - Date.now() + 50);
  const entries = viewers.map((v) => sleep(random() * entryBurstSeconds(o) * 1000).then(() => call(v, 'main', 'enter', 'POST', '/enter', { sizeId: v.sizeId })));
  await Promise.all([...interest, ...entries]);

  // T0, then until the release is over and its streams have ended (--pace: the app's footprint read just before T0).
  if (o.pace) {
    await sleep(ready.opensAt - 2000 - Date.now());
    await readFootprint();
  }
  await sleep(ready.opensAt - Date.now());
  const roomDone = (room: RoomKey, among: Viewer[]) => last[room].over === true && among.every((v) => { const s = v.streams[room]; return !s || s.ended || s.status !== 200; });
  // With a pace, the release sells out after its last batch.
  const deadline = ready.opensAt + (plan?.spanMs ?? 0) + SELL_OUT_LIMIT_MS;
  while (Date.now() < deadline && !roomDone('main', viewers)) await sleep(200);
  while (viewers.some((v) => v.acting.main) && Date.now() < deadline + 10_000) await sleep(100);

  // The after-room: its guests read its door at its T0, in a burst, open its stream and ENTER with a size.
  const guests = viewers.filter((v) => v.door !== null);
  const afterOpensAt = guests.length ? Math.min(...guests.map((v) => v.door!)) : null;
  let afterDeadline = deadline;
  if (afterOpensAt !== null) {
    await sleep(afterOpensAt - Date.now() + 50);
    const visit = async (v: Viewer) => {
      await sleep(random() * (o.burstSeconds ?? 10) * 1000);
      const door = await request(v, 'GET', `/api/v1/live/${ready.dropId}/after-room`, undefined);
      doorReads.push({ ms: door.ms, status: door.status });
      const sheet = door.json as { id?: string; phase?: string; sizes?: { id: string }[]; addons?: { id: string }[] } | null;
      if (door.status !== 200 || sheet?.id !== ready.afterRoomId) return;
      // Over already: the page shows its end (without sizes), and opens nothing.
      if (sheet.phase === 'ENDED') {
        lateGuests.add(v);
        return;
      }
      if (!sheet.sizes?.length) return;
      afterRoom ??= { id: sheet.id, sizes: sheet.sizes, addons: (sheet.addons ?? []).map((a) => a.id) };
      openStream(v, 'after');
      await sleep(AFTER_ROOM_READING_MS.min + random() * (AFTER_ROOM_READING_MS.max - AFTER_ROOM_READING_MS.min));
      await call(v, 'after', 'enter', 'POST', '/enter', { sizeId: sheet.sizes[Math.floor(random() * sheet.sizes.length)]!.id });
    };
    await Promise.all(guests.map(visit));
    afterDeadline = afterOpensAt + SELL_OUT_LIMIT_MS;
    while (Date.now() < afterDeadline && !roomDone('after', guests)) await sleep(200);
  }
  // The turns under way finish (none should be: the rooms are over).
  while (viewers.some((v) => v.acting.main || v.acting.after) && Date.now() < afterDeadline + 10_000) await sleep(100);

  finished = true;
  if (o.pace) await readFootprint();
  child.send({ type: 'collect' });
  const report = await nextMessage<ServerReport>(child, 'report');
  child.send({ type: 'stop' });
  await new Promise<void>((r) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      r();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(t);
      r();
    });
  });
  const databasePeak = database?.peak() ?? null;
  await database?.stop();
  for (const s of side) s.destroy();
  agent.destroy();

  // ── The figures ──
  const kinds: ActionKind[] = ['interest', 'enter', 'press', 'secure', 'addons', 'confirm', 'release'];
  const byKind = Object.fromEntries(kinds.map((k) => [k, stats(actions.filter((a) => a.kind === k).map((a) => a.ms))])) as Record<ActionKind, Stats>;
  const late = (a: ActionRecord) => a.room === 'after' && a.kind === 'enter' && a.status === 409 && a.code !== undefined && AFTER_ROOM_LATE_CODES.includes(a.code);
  const unexpected = actions.filter((a) => a.status !== 200 && !late(a)).map((a) => ({ room: a.room, kind: a.kind, status: a.status, ...(a.code ? { code: a.code } : {}) }));

  // The fan-out: the room events of one pulse share its time (`now`, stamped once its room is in memory); from it to
  // the last phone that read one, over the pulses that reached nearly every viewer of that room.
  const pulses = report.pulses;
  const streamsOf = (room: RoomKey) => viewers.map((v) => v.streams[room]).filter((s): s is StreamState => s !== null);
  const fullOf = (room: RoomKey) => {
    const byPulse = new Map<number, { n: number; last: number }>();
    for (const e of rooms) {
      if (e.room !== room) continue;
      const r = byPulse.get(e.now) ?? { n: 0, last: 0 };
      r.n++;
      r.last = Math.max(r.last, e.at);
      byPulse.set(e.now, r);
    }
    const open = streamsOf(room).filter((s) => s.status === 200).length;
    return open === 0 ? [] : [...byPulse.entries()].filter(([, r]) => r.n >= FULL_PULSE * open);
  };
  const full = ROOMS.flatMap((room) => fullOf(room));
  const fullAfter = fullOf('after');
  const fanOut = full.map(([now, r]) => r.last - now);
  const fullPulses = pulses.filter((p) => full.some(([now]) => now >= p.start && now <= p.end));

  const t0Pass = report.ticks.find((t) => t.queued > 0 && t.start >= ready.opensAt - 1000);
  const peakRss = Math.max(report.maxRssBytes, ...report.memory.map((m) => m.rss));
  const peakHeap = Math.max(0, ...report.memory.map((m) => m.heapUsed));
  const top = report.memory.reduce<MemorySample | null>((a, m) => (a === null || m.rss > a.rss ? m : a), null) ?? ready.baseline;
  const limitMib = LIVE_LOAD_TARGETS.memoryLimitMib * LIVE_LOAD_TARGETS.memoryShare;
  const withGeoIp = mib(peakRss) + GEOIP_RESIDENT_MIB;
  const appErrors = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter((l) => /"level":(50|60)\b/.test(l)).length : 0;

  const all = stats(actions.map((a) => a.ms));
  const fan = stats(fanOut);
  // A guest late to the after-room: its stream answered 204 (over), or it never opened one (its page ended).
  for (const v of guests) if (v.streams.after?.status === 204) lateGuests.add(v);
  const streamFigures = (room: RoomKey, among: Viewer[]) => {
    const s = among.filter((v) => !(room === 'after' && lateGuests.has(v) && v.streams.after?.status !== 200)).map((v) => v.streams[room]);
    return {
      opened: s.filter((x) => x?.status === 200).length,
      refused: s.filter((x) => !x || (x.status !== 200 && !x.parked)).length,
      dropped: s.filter((x) => x?.dropped).length,
      connect: stats(s.filter((x): x is StreamState => x !== null && x.connectedMs !== null).map((x) => x.connectedMs!)),
    };
  };
  const streams = streamFigures('main', viewers);
  const afterStreams = streamFigures('after', guests);
  const outcomeOf = (room: RoomKey, t0: number | null): RoomOutcome => ({
    reason: last[room].endedReason ?? null,
    confirmed: viewers.filter((v) => v.outcome[room] === 'CONFIRMED').length,
    released: viewers.filter((v) => v.outcome[room] === 'RELEASED').length,
    endedMs: endRead[room] === null || t0 === null ? null : endRead[room]! - t0,
  });
  const outcome = outcomeOf('main', ready.opensAt);
  const afterOutcome = outcomeOf('after', afterOpensAt);
  const quantity = SIZES.reduce((n, s) => n + s.stock, 0);
  const afterQuantity = AFTER_SIZES.reduce((n, s) => n + s.stock, 0);
  const hasAfterRoom = ready.afterRoomId !== null;
  const stocked = SIZES.reduce((n, s) => n + Math.min(s.stock, STOCKED[s.label] ?? 0), 0);
  const facts = report.facts;
  const clean =
    unexpected.length === 0 &&
    stateReads.every((r) => r.status === 200) &&
    doorReads.every((d) => d.status === 200) &&
    streams.refused === 0 &&
    streams.dropped === 0 &&
    afterStreams.refused === 0 &&
    afterStreams.dropped === 0 &&
    appErrors === 0 &&
    report.messageErrors === 0 &&
    outcome.reason === 'SOLD_OUT' &&
    outcome.confirmed === quantity &&
    (hasAfterRoom
      ? // Every phone the sell-out ended read the second door, and only they.
        guests.length === facts.afterRoom.guests &&
        guests.length > 0 &&
        afterOutcome.reason === 'SOLD_OUT' &&
        afterOutcome.confirmed === afterQuantity &&
        facts.afterRoom.confirmed === afterQuantity
      : // --pace: no after-room, so no door in the last frames, no guest.
        guests.length === 0 && facts.afterRoom.guests === 0) &&
    // One order per piece confirmed; those of STOCKED held in stock, every other one waiting for supplier stock (plan NEXT LOT §3.5).
    facts.orders.main === quantity &&
    facts.orders.afterRoom === (hasAfterRoom ? afterQuantity : 0) &&
    facts.orders.stock === stocked &&
    facts.orders.awaiting === quantity + (hasAfterRoom ? afterQuantity : 0) - stocked &&
    facts.orders.other === 0;
  // The busiest five seconds of the app's CPU.
  let busiest = 0;
  for (let i = 0; i + 5 <= report.cpuBySecond.length; i++) busiest = Math.max(busiest, report.cpuBySecond.slice(i, i + 5).reduce((a, b) => a + b, 0) / 5);
  const f = o.vpsFactor;
  // An action's time is the app's share (waiting for its thread, then its own work) and the database's wait. Only the
  // first runs on the app's core; the second is PGlite's one connection here, a stand-in already pessimistic.
  const appShare = report.loopDelayMs.p99 + (report.cpuMs.user + report.cpuMs.system) / Math.max(1, actions.length + doorReads.length);
  // --pace: the door (I'LL BE THERE, ENTER in the main room, before T0) apart from what the pace meters.
  const atDoor = (a: ActionRecord) => a.room === 'main' && (a.kind === 'interest' || a.kind === 'enter');
  const door = stats(actions.filter(atDoor).map((a) => a.ms));
  const behind = stats(actions.filter((a) => !atDoor(a)).map((a) => a.ms));
  const vpsP95 = (o.pace ? behind.p95 : all.p95) + (f - 1) * appShare;

  // --pace: the queue's frames, the batches on the server, the queue on the phones.
  // W2: the memory and the streams before T0 (everyone in the room on a stream) and from T0 + QUEUE_SETTLE_MS on (the
  // streams behind the next batch ended).
  const phase = (from: number, to: number): PhaseFigures => {
    const m = report.memory.filter((x) => x.at >= from && x.at < to);
    const peak = m.reduce<MemorySample | null>((a, x) => (a === null || x.rss > a.rss ? x : a), null);
    const f = footprints.filter((x) => x.at >= from && x.at < to).at(-1) ?? null;
    return {
      peakMib: peak ? mib(peak.rss) : null,
      streamsAtPeak: peak?.streams ?? null,
      maxStreams: m.length ? Math.max(...m.map((x) => x.streams ?? 0)) : null,
      footprintPeakMib: f ? (f.peakMib ?? f.footprintMib) : null,
      reclaimableAtPeakMib: f?.reclaimableMib ?? null,
    };
  };
  let paced: PacedResult | null = null;
  if (o.pace && plan) {
    // The phones a pulse's frame was for: those waiting on a stream then (W2: the next batch's; at T0 every waiting
    // phone reads one frame before its stream ends behind it).
    const byPulse = new Map<number, { n: number; last: number; streaming: number }>();
    for (const e of queueEvents) {
      const r = byPulse.get(e.now) ?? { n: 0, last: 0, streaming: 0 };
      r.n++;
      r.last = Math.max(r.last, e.at);
      r.streaming = Math.max(r.streaming, e.streaming);
      byPulse.set(e.now, r);
    }
    const fullQueue = [...byPulse.entries()].filter(([, r]) => r.streaming > 0 && r.n >= FULL_PULSE * r.streaming);
    const batches = facts.pace?.batches ?? [];
    const phones = queueVerdict(viewers.map((v) => v.queue), o.pace);
    paced = {
      pace: o.pace,
      planned: plan.batches,
      batches,
      problem: facts.pace ? pacedBatchesProblem(batches, viewersWanted, o.pace, ready.opensAt) : 'The release has no pace.',
      engineLag: stats(batches.map((b) => b.recordedAt - b.at)),
      check: facts.pace?.check ?? { pass: false, line: 'No PACE check.' },
      placed: facts.pace?.placed ?? 0,
      admitted: facts.pace?.admitted ?? 0,
      phones: { ...phones, delivery: stats(phones.delivery) },
      fanOut: { pulses: byPulse.size, full: fullQueue.length, received: stats(fullQueue.map(([now, r]) => r.last - now)) },
      memory: { beforeT0: phase(0, ready.opensAt), fromT0: phase(ready.opensAt + QUEUE_SETTLE_MS, Number.POSITIVE_INFINITY) },
      footprints,
      // Each minute from the streams' opening: the app's peak resident memory and footprint, the streams then (results.json only).
      memoryByMinute: byMinute(report.memory, footprints, ready.opensAt),
      queueStreams: {
        parked: parked.size,
        reopened,
        stateReads: stats(stateReads.map((r) => r.ms)),
        stateReadsNot200: stateReads.filter((r) => r.status !== 200).length,
        stateReadsPeakPerSecond: peakPerSecond(stateReads.map((r) => r.at)),
      },
    };
  }
  const queueHeld =
    paced === null ||
    (paced.problem === null &&
      paced.check.pass &&
      paced.placed === viewersWanted &&
      paced.admitted === viewersWanted &&
      // Everyone beyond the first batch waited (the first batch too, when a pulse came between T0 and its pass).
      paced.phones.waited >= viewersWanted - o.pace!.batch &&
      paced.phones.admitted === paced.phones.waited &&
      paced.phones.orderBroken === 0);
  // The queue's frames held against the fan-out target, apart from the queue's exactness (none to read when no one waited).
  const queueFanOut =
    paced === null || viewersWanted <= o.pace!.batch || (paced.fanOut.received.n > 0 && paced.fanOut.received.p95 * f < LIVE_LOAD_TARGETS.fanOutP95Ms);
  const verdict = {
    action: vpsP95 < LIVE_LOAD_TARGETS.actionP95Ms,
    fanOut: fan.n > 0 && fan.p95 * f < LIVE_LOAD_TARGETS.fanOutP95Ms,
    memory: withGeoIp < limitMib,
    cpu: busiest * f < LIVE_LOAD_TARGETS.cpuCores,
    clean,
    pace: queueHeld,
    queueFanOut,
    pass: false,
  };
  verdict.pass = verdict.action && verdict.fanOut && verdict.memory && verdict.cpu && verdict.clean && verdict.pace && verdict.queueFanOut;

  return {
    viewers: viewersWanted,
    vpsFactor: o.vpsFactor,
    calibrationMs: ready.calibrationMs,
    seedMs: ready.seedMs,
    streams,
    actions: { all, byKind, main: stats(actions.filter((a) => a.room === 'main').map((a) => a.ms)), afterRoom: stats(actions.filter((a) => a.room === 'after').map((a) => a.ms)), unexpected, appShareMs: round(appShare), vpsP95Ms: round(vpsP95), door, behind },
    fanOut: {
      pulses: pulses.length,
      full: full.length,
      received: fan,
      afterRoom: { full: fullAfter.length, received: stats(fullAfter.map(([now, r]) => r.last - now)) },
      serverPulse: stats(pulses.map((p) => p.ms)),
      serverPulseFull: stats(fullPulses.map((p) => p.ms)),
    },
    turns: {
      given,
      delivery: stats(deliveries),
      lineDrawnMs: firstPlaced !== null && placed > 0 ? firstPlaced - ready.opensAt : null,
      t0PassMs: t0Pass?.ms ?? null,
    },
    engine: { passes: report.ticks.length, pass: stats(report.ticks.map((t) => t.ms)) },
    memory: {
      idleMib: mib(ready.idle.rss),
      baselineMib: mib(ready.baseline.rss),
      peakRssMib: mib(peakRss),
      peakHeapMib: mib(peakHeap),
      atPeak: { heapTotalMib: mib(top.heapTotal), heapUsedMib: mib(top.heapUsed), externalMib: mib(top.external), outsideHeapMib: mib(top.rss - top.heapTotal) },
      withGeoIpMib: Math.round(withGeoIp * 10) / 10,
      limitMib: Math.round(limitMib * 10) / 10,
      perViewerKib: Math.round(((peakRss - ready.baseline.rss) / 1024 / Math.max(1, streams.opened)) * 10) / 10,
      databasePeakMib: databasePeak === null ? null : mib(databasePeak),
    },
    cpu: {
      userMs: report.cpuMs.user,
      systemMs: report.cpuMs.system,
      wallMs: report.wallMs,
      cores: Math.round(((report.cpuMs.user + report.cpuMs.system) / Math.max(1, report.wallMs)) * 100) / 100,
      busiest5s: Math.round(busiest * 100) / 100,
    },
    loopDelayMs: { p50: Math.round(report.loopDelayMs.p50 * 10) / 10, p99: Math.round(report.loopDelayMs.p99 * 10) / 10, max: Math.round(report.loopDelayMs.max * 10) / 10 },
    outcome,
    afterRoom: { none: !hasAfterRoom, guests: guests.length, doorRead: stats(doorReads.map((d) => d.ms)), streams: afterStreams, late: lateGuests.size, outcome: afterOutcome },
    facts,
    pace: paced,
    appErrors,
    messageErrors: report.messageErrors,
    verdict,
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

const ms = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x} ms`);
const yes = (b: boolean) => (b ? 'met' : 'NOT MET');

function printLevel(r: LevelResult): void {
  const k = r.actions.byKind;
  const f = r.vpsFactor;
  const vps = (x: number) => (Number.isFinite(x) ? ` (× ${f}: ${round(x * f)} ms)` : '');
  const p = r.pace;
  const paris = (at: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at);
  const lines = [
    `### ${r.viewers} ${p ? `with a pace of ${p.pace.batch} every ${p.pace.minutes} min` : 'in the room'} (calibration ${r.calibrationMs} ms; a VPS vCPU taken as ${f} times slower)`,
    '',
    '| Figure | Measured | Target, on the VPS |',
    '|---|---|---|',
    ...(p
      ? [
          `| Actions behind the pace (${r.actions.behind.n}: the turns, PAY, RELEASE) | p50 ${ms(r.actions.behind.p50)} · **p95 ${ms(r.actions.behind.p95)}** (the app's share ${ms(r.actions.appShareMs)}, × ${f}: ${ms(r.actions.vpsP95Ms)}) · p99 ${ms(r.actions.behind.p99)} · max ${ms(r.actions.behind.max)} | p95 < ${LIVE_LOAD_TARGETS.actionP95Ms} ms: ${yes(r.verdict.action)} |`,
          `| The door, before T0 (${r.actions.door.n}: I'LL BE THERE and ENTER, which the pace does not meter) | p50 ${ms(r.actions.door.p50)} · p95 ${ms(r.actions.door.p95)} · max ${ms(r.actions.door.max)} | |`,
          `| Actions, all (${r.actions.all.n}) | p50 ${ms(r.actions.all.p50)} · p95 ${ms(r.actions.all.p95)} · p99 ${ms(r.actions.all.p99)} · max ${ms(r.actions.all.max)} | |`,
        ]
      : [`| Actions, all (${r.actions.all.n}) | p50 ${ms(r.actions.all.p50)} · **p95 ${ms(r.actions.all.p95)}** (the app's share ${ms(r.actions.appShareMs)}, × ${f}: ${ms(r.actions.vpsP95Ms)}) · p99 ${ms(r.actions.all.p99)} · max ${ms(r.actions.all.max)} | p95 < ${LIVE_LOAD_TARGETS.actionP95Ms} ms: ${yes(r.verdict.action)} |`]),
    `| By room: the main room (${r.actions.main.n}) / the after-room (${r.actions.afterRoom.n}) | p50 ${ms(r.actions.main.p50)} / ${ms(r.actions.afterRoom.p50)} · p95 ${ms(r.actions.main.p95)} / ${ms(r.actions.afterRoom.p95)} · max ${ms(r.actions.main.max)} / ${ms(r.actions.afterRoom.max)} | |`,
    `| I'LL BE THERE (${k.interest.n}) | p50 ${ms(k.interest.p50)} · p95 ${ms(k.interest.p95)} · max ${ms(k.interest.max)} | |`,
    `| ENTER (${k.enter.n}) | p50 ${ms(k.enter.p50)} · p95 ${ms(k.enter.p95)} · max ${ms(k.enter.max)} | |`,
    `| PRESS / SECURE (${k.press.n} / ${k.secure.n}) | p95 ${ms(k.press.p95)} / ${ms(k.secure.p95)} · max ${ms(k.press.max)} / ${ms(k.secure.max)} | |`,
    `| Add-ons / PAY / RELEASE (${k.addons.n} / ${k.confirm.n} / ${k.release.n}) | p95 ${ms(k.addons.p95)} / ${ms(k.confirm.p95)} / ${ms(k.release.p95)} | |`,
    `| Fan-out, the room in memory → the last phone (${r.fanOut.full} full pulses of ${r.fanOut.pulses}) | p50 ${ms(r.fanOut.received.p50)} · **p95 ${ms(r.fanOut.received.p95)}**${vps(r.fanOut.received.p95)} · max ${ms(r.fanOut.received.max)} | p95 < ${LIVE_LOAD_TARGETS.fanOutP95Ms} ms: ${yes(r.verdict.fanOut)} |`,
    ...(r.afterRoom.none ? [] : [`| The after-room's fan-out (${r.fanOut.afterRoom.full} full pulses) | p95 ${ms(r.fanOut.afterRoom.received.p95)}${vps(r.fanOut.afterRoom.received.p95)} · max ${ms(r.fanOut.afterRoom.received.max)} | |`]),
    `| The pulse on the server, its reads included (all / full) | p50 ${ms(r.fanOut.serverPulse.p50)} · p95 ${ms(r.fanOut.serverPulse.p95)} / ${ms(r.fanOut.serverPulseFull.p95)} · max ${ms(r.fanOut.serverPulse.max)} | |`,
    `| Memory, the app's peak | ${r.memory.peakRssMib} MiB resident (${r.memory.idleMib} MiB started, ${r.memory.baselineMib} MiB before the streams; ${r.memory.perViewerKib} KiB per viewer; at the peak V8's heap ${r.memory.atPeak.heapTotalMib} MiB, ${r.memory.atPeak.heapUsedMib} in use, ${r.memory.atPeak.outsideHeapMib} MiB outside it)${r.memory.databasePeakMib === null ? '' : ` · PGlite's process ${r.memory.databasePeakMib} MiB`} | |`,
    `| Memory with the GeoIP database (+${GEOIP_RESIDENT_MIB} MiB) | **${r.memory.withGeoIpMib} MiB** | < ${r.memory.limitMib} MiB: ${yes(r.verdict.memory)} |`,
    `| Streams | ${r.streams.opened} open · ${r.streams.refused} refused · ${r.streams.dropped} dropped · connected p95 ${ms(r.streams.connect.p95)} | |`,
    `| The line at T0 | first place on a phone ${ms(r.turns.lineDrawnMs)} after T0 · the engine's pass ${ms(r.turns.t0PassMs)} | |`,
    `| Turns | ${r.turns.given} given · on the phone p95 ${ms(r.turns.delivery.p95)} after the turn began | |`,
    `| Engine passes (${r.engine.passes}) | p95 ${ms(r.engine.pass.p95)} · max ${ms(r.engine.pass.max)} | |`,
    `| Event loop delay | p50 ${ms(r.loopDelayMs.p50)} · p99 ${ms(r.loopDelayMs.p99)} · max ${ms(r.loopDelayMs.max)} | |`,
    `| CPU, the app | busiest five seconds **${r.cpu.busiest5s} of a core** (× ${f}: ${round(r.cpu.busiest5s * f)}) · ${r.cpu.cores} over ${(r.cpu.wallMs / 1000).toFixed(0)} s (user ${r.cpu.userMs} ms, system ${r.cpu.systemMs} ms) | < ${LIVE_LOAD_TARGETS.cpuCores} core: ${yes(r.verdict.cpu)} |`,
    `| The end | ${r.outcome.reason ?? 'not over'} ${r.outcome.endedMs !== null ? `${(r.outcome.endedMs / 1000).toFixed(1)} s after T0` : ''} · ${r.outcome.confirmed} confirmed · ${r.outcome.released} released | every piece confirmed |`,
    r.afterRoom.none
      ? `| The after-room | none: a paced release is published without one (the run measures the queue) | |`
      : `| The after-room | ${r.afterRoom.guests} guests (${r.facts.afterRoom.guests} remembered) · door read p95 ${ms(r.afterRoom.doorRead.p95)} · ${r.afterRoom.streams.opened} streams, ${r.afterRoom.streams.refused} refused, ${r.afterRoom.streams.dropped} dropped · ${r.afterRoom.late} came after their size or the room sold out · ${r.afterRoom.outcome.reason ?? 'not over'} ${r.afterRoom.outcome.endedMs !== null ? `${(r.afterRoom.outcome.endedMs / 1000).toFixed(1)} s after its T0` : ''} · ${r.afterRoom.outcome.confirmed} confirmed · ${r.afterRoom.outcome.released} released | every piece confirmed |`,
    `| The orders | ${r.facts.orders.main} + ${r.facts.orders.afterRoom} (after-room) · ${r.facts.orders.stock} held in stock · ${r.facts.orders.awaiting} awaiting stock · ${r.facts.orders.other} other · ${r.facts.journal} journal rows | one per piece |`,
    `| Answers other than 200 · app errors | ${r.actions.unexpected.length} · ${r.appErrors} | none: ${yes(r.verdict.clean)} |`,
    ...(p
      ? [
          `| The queue's frames, the pulse's time → the last waiting phone (${p.fanOut.full} full pulses of ${p.fanOut.pulses}) | p50 ${ms(p.fanOut.received.p50)} · **p95 ${ms(p.fanOut.received.p95)}**${vps(p.fanOut.received.p95)} · max ${ms(p.fanOut.received.max)} | p95 < ${LIVE_LOAD_TARGETS.fanOutP95Ms} ms: ${yes(r.verdict.queueFanOut)} |`,
          `| The batches on the server (${p.batches.length} of ${p.planned} planned) | ${p.batches.map((b) => b.entries).join(' · ')} admitted, the first at ${p.batches.length ? `${paris(p.batches[0]!.at)} Paris` : '—'} (T0), each ${p.pace.minutes} min after the last · the engine wrote each p95 ${ms(p.engineLag.p95)} · max ${ms(p.engineLag.max)} after its time · ${p.admitted} of ${p.placed} placed admitted | ${p.problem ?? 'exactly X every Y, on their times'} |`,
          `| The PACE check (TEST REPORT) | ${p.check.line} | ${p.check.pass ? 'passed' : 'FAILED'} |`,
          `| The queue on the phones | ${p.phones.waited} waited · ${p.phones.admitted} admitted, in ${p.phones.batchesSeen} batches · ${p.phones.orderBroken} from a place beyond ${p.pace.batch} · ${p.phones.etaKept} at the time first estimated · the admission on the phone p50 ${ms(p.phones.delivery.p50)} · p95 ${ms(p.phones.delivery.p95)} · max ${ms(p.phones.delivery.max)} after the batch's time | every one admitted, in the line's order |`,
          `| The queue held | | ${yes(r.verdict.pace)} |`,
          `| Behind the next batch (W2) | ${p.queueStreams.parked} streams ended by the server · ${p.queueStreams.reopened} opened again once their batch was the next · ${p.queueStreams.stateReads.n} state reads instead, p50 ${ms(p.queueStreams.stateReads.p50)} · p95 ${ms(p.queueStreams.stateReads.p95)} · max ${ms(p.queueStreams.stateReads.max)}, at most ${p.queueStreams.stateReadsPeakPerSecond} in a second, ${p.queueStreams.stateReadsNot200} other than 200 | |`,
          `| Memory before T0 / from T0 + ${QUEUE_SETTLE_MS / 1000} s | ${phaseLine(p.memory.beforeT0)} / ${phaseLine(p.memory.fromT0)} | |`,
        ]
      : []),
    '',
    `**${r.verdict.pass ? 'Every target met' : 'A target not met'}** at ${r.viewers} ${p ? `with a pace of ${p.pace.batch} every ${p.pace.minutes} min` : 'in the room'}.`,
    '',
  ];
  if (r.actions.unexpected.length) {
    const groups = new Map<string, number>();
    for (const u of r.actions.unexpected) {
      const g = `${u.room} ${u.kind} ${u.status} ${u.code ?? ''}`.trim();
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    lines.push(`Answers other than 200: ${[...groups].map(([g, n]) => `${g} × ${n}`).join(', ')}`, '');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function drive(o: Options): Promise<void> {
  process.stdout.write(
    `LIVE RELEASES load test (${o.pace ? 'a paced release: the queue, the rules, the stock' : 'LIVE RELEASE+: the rules, the stock, the after-room'}): levels ${o.levels.join(', ')}, a VPS vCPU taken as ${o.vpsFactor} times slower, a burst of ${entryBurstSeconds(o)} s, seed ${o.seed}, ${o.databaseUrl === 'pglite:memory' ? 'PGlite in its own process' : 'PostgreSQL'}${o.pace ? `, a pace of ${o.pace.batch} every ${o.pace.minutes} min (W4)` : ''}\n`,
  );
  const results: LevelResult[] = [];
  for (const level of o.levels) {
    const r = await runLevel(o, level);
    printLevel(r);
    results.push(r);
  }
  const passing = results.filter((r) => r.verdict.pass).map((r) => r.viewers);
  // The capacity: the largest level met, with every smaller level met too (a level that fails below it voids it).
  let capacity: number | null = null;
  for (const r of [...results].sort((a, b) => a.viewers - b.viewers)) {
    if (!r.verdict.pass) break;
    capacity = r.viewers;
  }
  process.stdout.write(
    o.pace
      ? `With a pace: ${passing.length ? `the queue held and every target met at ${passing.join(', ')}` : 'no level met every target'}. A paced run measures the queue; LIVE_ROOM_CAPACITY is not read from it.\n`
      : capacity === null
        ? 'No level met every target.\n'
        : `Capacity: ${capacity} in the room (levels met: ${passing.join(', ')}). LIVE_ROOM_CAPACITY (services/live-insights.ts) is set from it.\n`,
  );
  const machine = { cpu: cpus()[0]?.model ?? 'unknown', cpus: cpus().length, memoryGib: Math.round((totalmem() / 1073741824) * 10) / 10, os: `${platform()} ${osRelease()}`, node: process.version };
  mkdirSync(dirname(o.json), { recursive: true });
  writeFileSync(o.json, `${JSON.stringify({ at: new Date().toISOString(), options: o, targets: LIVE_LOAD_TARGETS, geoIpMib: GEOIP_RESIDENT_MIB, machine, capacity: o.pace ? null : capacity, results }, null, 2)}\n`);
  process.stdout.write(`Figures: ${o.json}\n`);
}

// Run as a script (the driver, or the app's or the database's process it forks), never on import (its tests).
// Node resolves the main module to its real path: argv[1] is resolved the same way, so a symlinked path still runs it.
const mainPath = (() => {
  if (process.argv[1] === undefined) return null;
  try {
    return realpathSync(resolve(process.argv[1]));
  } catch {
    return resolve(process.argv[1]);
  }
})();
const isMain = mainPath !== null && import.meta.url === pathToFileURL(mainPath).href;
if (!isMain) {
  // Imported: its exports only.
} else if (process.argv.includes('--database')) {
  void databaseProcess(process.argv[process.argv.indexOf('--database') + 1]!).catch((e: unknown) => {
    process.stderr.write(`live-load database: ${(e as Error)?.stack ?? String(e)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes('--serve')) {
  void serve().catch((e: unknown) => {
    process.stderr.write(`live-load app: ${(e as Error)?.stack ?? String(e)}\n`);
    process.exit(1);
  });
} else {
  void drive(parseArgs(process.argv.slice(2))).catch((e: unknown) => {
    process.stderr.write(`live-load: ${(e as Error)?.message ?? String(e)}\n`);
    process.exit(1);
  });
}
