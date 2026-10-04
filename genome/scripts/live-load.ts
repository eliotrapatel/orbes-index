/**
 * The LIVE RELEASES' load test (plan of 2026-10-04, Architecture › Load; Quality bar 6).
 *
 *   npx tsx scripts/live-load.ts [--levels 500,1000,1500,2000] [--vps-factor 2] [--burst-seconds 10] [--seed N]
 *                                [--database-url postgres://…] [--json PATH]
 *
 * For each level N, three processes, as on the VPS: the app (this file with --serve: the server's own createContext,
 * buildApp, logger and LIVE engine, as src/server/index.ts starts them; ORBES_ENV=development, so the production rate
 * limits apply; behind a trusted proxy, each phone with its own X-Forwarded-For address, hence its own network), the
 * database (--database: PGlite alone in its process, reached over a socket as the app reaches PostgreSQL's container),
 * and this one, the phones, over real HTTP with Node's own http client (no dependency):
 *
 *   1. N accounts, a fifth of them owners (TITANE, PLATINE, PALLADIUM: the line's tier order and the club's standings
 *      read at T0 do real work), each signed in; a LIVE RELEASE of 25 pieces in three sizes with two add-ons, created
 *      and published through the console's service, its room opening a minute before T0;
 *   2. N concurrent streams (GET /api/v1/live/:id/stream, one per account), plus the console's stream and a boutique
 *      board's (the owner watches, a boutique shows the door), opened over the seconds after the announcement;
 *   3. a host message every second from the announcement to T0, so that every pulse sends every viewer a new room (the
 *      worst case of the fan-out, measured on every pulse);
 *   4. a burst of entries: the N accounts ENTER at random moments of the first --burst-seconds of the room (10 s: 100 a
 *      second for 1 000, thirty times the pace of a crowd spread over a five-minute room), each with a size;
 *   5. at T0 the door opens: the line formed, each turn taken on its phone as the stream brings it: PRESS, 1.5 s later
 *      SECURE, the add-ons for half of them, then PAY (seven in ten) or RELEASE MY PLACE (three in ten, the piece
 *      going to the next in line at once), until the release is SOLD OUT and every stream has ended.
 *
 * Measured, against the plan's targets for 1 000 in the room on the VPS profile (app container: 1.5 CPU, 768 MB):
 *
 *   action latency   each ENTER, PRESS, SECURE, add-ons, PAY and RELEASE, request sent → answer read      p95 < 200 ms
 *                    (the app's share of it on the VPS's CPU, below)
 *   fan-out          each pulse, its room in memory (the frame and the viewers' entries read: the events' `now`)
 *                    → the last viewer's room event read by its phone, over the pulses that reached at least
 *                    95 % of the viewers; the whole pulse on the server, its reads included, beside it    p95 < 100 ms
 *   memory           the app's peak resident memory, plus the GeoIP database the VPS app keeps in memory
 *                    (GEOIP_RESIDENT_MIB; this run has none)                                   < 60 % of 768 MB
 *   CPU              the app's busiest five seconds                                            < one core
 *   and none of: an answer other than 200, a stream refused or dropped before the end, an error in the app's log, a
 *   release that did not sell out.
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
 * Prints a table per level and the capacity; writes every figure to genome/out/live-load/results.json (or --json
 * PATH) and the app's log of each level beside it (server-<N>.log). Seeded: the same arguments give the same
 * accounts, sizes and moments; the times depend on the machine and on what else runs on it.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Agent, request as httpRequest, type IncomingMessage } from 'node:http';
import { createConnection, createServer, type Socket } from 'node:net';
import { cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
/** The app's public origin in this test: every mutation sends it, as a browser on the site does. */
const ORIGIN = 'https://verify.orbes.load';
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
/** The room opens this long before T0 (the console's minimum). */
const ROOM_MINUTES = 1;
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
  /** PostgreSQL's URL (--database-url), or `pglite:memory` with the socket of PGlite's process. */
  databaseUrl: string;
  databaseSocket: string | null;
  seed: number;
}

interface ReadyMessage {
  type: 'ready';
  port: number;
  dropId: string;
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
}

// ── Options ────────────────────────────────────────────────────────────────

interface Options {
  levels: number[];
  vpsFactor: number;
  burstSeconds: number;
  seed: number;
  databaseUrl: string;
  json: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    levels: [500, 1000, 1500, 2000],
    vpsFactor: DEFAULT_VPS_FACTOR,
    burstSeconds: 10,
    seed: 20261004,
    databaseUrl: 'pglite:memory',
    json: join(ROOT, 'out', 'live-load', 'results.json'),
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
  const { sessionCookieName } = await import('../src/server/services/sessions.js');

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
  // A fifth of the accounts own pieces of the model: 10 % PALLADIUM (5 pieces), 5 % PLATINE (3), 5 % TITANE (1).
  const holdings: { accountId: string; pieces: number }[] = [];
  for (const id of accountIds) {
    const r = random();
    if (r < 0.1) holdings.push({ accountId: id, pieces: 5 });
    else if (r < 0.15) holdings.push({ accountId: id, pieces: 3 });
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

  const publishedAt = Date.now();
  const roomOpensAt = publishedAt + setup.leadMs;
  const opensAt = roomOpensAt + ROOM_MINUTES * 60_000;
  const created = await ctx.services.liveConsole.create(
    {
      modelId,
      title: 'MONOLITHE · LIVE RELEASE',
      opensAt: new Date(opensAt),
      closesAt: new Date(opensAt + 3_600_000),
      roomOpensMinutes: ROOM_MINUTES,
      priceMinor: 480_000,
      sizes: SIZES,
      addons: ADDONS,
    },
    admin,
  );
  await ctx.services.liveConsole.publish(created.id, {}, admin);
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
  const sampler = setInterval(() => memory.push(sample()), 250);

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

  process.on('message', async (m: { type: string }) => {
    if (m.type === 'collect') {
      clearInterval(sampler);
      clearInterval(cpuSampler);
      clearInterval(messages);
      loop.disable();
      const cpu = process.cpuUsage(cpuAtReady);
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

type ActionKind = 'enter' | 'press' | 'secure' | 'addons' | 'confirm' | 'release';

interface ActionRecord {
  kind: ActionKind;
  ms: number;
  status: number;
  code?: string;
}

interface Viewer {
  i: number;
  ip: string;
  cookie: string;
  csrf: string;
  sizeId: string;
  /** When its stream asked, and when its first room arrived. */
  asked: number;
  connectedMs: number | null;
  streamStatus: number | null;
  ended: boolean;
  dropped: boolean;
  /** Its place in the line has reached it. */
  placed: boolean;
  acting: boolean;
  outcome: string | null;
}

interface RoomEvent {
  now: number;
  at: number;
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
    unexpected: { kind: ActionKind; status: number; code?: string }[];
    /** The app's share of an action: its event loop's p99 delay and its CPU per action (all of it over the run, divided by the actions: an upper bound). */
    appShareMs: number;
    /** The p95 on the VPS: the app's share taken --vps-factor times slower, the rest (the database's wait) as measured. */
    vpsP95Ms: number;
  };
  fanOut: { pulses: number; full: number; received: Stats; serverPulse: Stats; serverPulseFull: Stats };
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
  /** The end's reason, and when a phone first read it, after T0. */
  outcome: { reason: string | null; confirmed: number; released: number; endedMs: number | null };
  appErrors: number;
  messageErrors: number;
  verdict: { action: boolean; fanOut: boolean; memory: boolean; cpu: boolean; clean: boolean; pass: boolean };
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
  // Time for the streams to connect before the room opens: a few seconds, more for a larger audience.
  const leadMs = Math.min(30_000, Math.max(10_000, Math.round(viewersWanted * 8)));
  child.send({ type: 'setup', viewers: viewersWanted, leadMs, databaseUrl: o.databaseUrl, databaseSocket: pglite ? socketPath : null, seed: o.seed } satisfies SetupMessage);
  const ready = await nextMessage<ReadyMessage>(child, 'ready');
  process.stdout.write(`  ${viewersWanted}: app ready (port ${ready.port}, seeded in ${(ready.seedMs / 1000).toFixed(1)} s, calibration ${ready.calibrationMs} ms)\n`);

  const random = prng(o.seed + viewersWanted);
  const agent = new Agent({ keepAlive: true });
  const actions: ActionRecord[] = [];
  const rooms: RoomEvent[] = [];
  const deliveries: number[] = [];
  let given = 0;
  let firstPlaced: number | null = null;
  let placed = 0;
  let lastRoom: { phase?: string; over?: boolean; endedReason?: string | null } = {};
  /** When a phone first read the release's end. */
  let endRead: number | null = null;

  const viewers: Viewer[] = ready.viewers.map((s, i) => ({
    i,
    // Each phone on a network of its own (a /24 apart): the rate group `live` counts per network and per account.
    ip: `10.${(i >> 8) & 255}.${i & 255}.7`,
    cookie: `${ready.cookie}=${s.token}`,
    csrf: s.csrf,
    sizeId: ready.sizes[Math.floor(random() * ready.sizes.length)]!.id,
    asked: 0,
    connectedMs: null,
    streamStatus: null,
    ended: false,
    dropped: false,
    placed: false,
    acting: false,
    outcome: null,
  }));

  const call = (v: Viewer, kind: ActionKind, method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> =>
    new Promise((resolveCall) => {
      const payload = JSON.stringify(body);
      const t = performance.now();
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: ready.port,
          method,
          path: `/api/v1/live/${ready.dropId}${path}`,
          agent,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
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
            const ms = performance.now() - t;
            let json: Record<string, unknown> | null = null;
            try {
              json = JSON.parse(text) as Record<string, unknown>;
            } catch {
              json = null;
            }
            const status = res.statusCode ?? 0;
            const code = (json?.error as { code?: string } | undefined)?.code;
            actions.push({ kind, ms, status, ...(code ? { code } : {}) });
            resolveCall({ status, json });
          });
        },
      );
      req.on('error', () => {
        actions.push({ kind, ms: performance.now() - t, status: 0, code: 'NETWORK' });
        resolveCall({ status: 0, json: null });
      });
      req.end(payload);
    });

  /** A turn on its phone: PRESS, the hold, SECURE, the add-ons for half, then PAY (7 in 10) or RELEASE MY PLACE. */
  const takeTurn = async (v: Viewer, token: string) => {
    v.acting = true;
    try {
      if ((await call(v, 'press', 'POST', '/press', { token })).status !== 200) return;
      await sleep(HOLD_MS);
      if ((await call(v, 'secure', 'POST', '/secure', { token })).status !== 200) return;
      if (random() < 0.5) await call(v, 'addons', 'PUT', '/addons', { addonIds: [ready.addons[Math.floor(random() * ready.addons.length)]!] });
      await sleep(random() * 1000);
      if (random() < 0.7) {
        if ((await call(v, 'confirm', 'POST', '/confirm', {})).status === 200) v.outcome = 'CONFIRMED';
      } else if ((await call(v, 'release', 'POST', '/release', {})).status === 200) v.outcome = 'RELEASED';
    } finally {
      v.acting = false;
    }
  };

  const onEvent = (v: Viewer, block: string, at: number) => {
    let name = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!data) return;
    const body = JSON.parse(data) as Record<string, unknown>;
    if (name === 'room') {
      if (v.connectedMs === null) v.connectedMs = at - v.asked;
      rooms.push({ now: Date.parse(body.now as string), at });
      lastRoom = body as typeof lastRoom;
      if (lastRoom.endedReason && endRead === null) endRead = at;
    } else if (name === 'you') {
      const entry = body.entry as { status: string; position: number | null; turn: { at: string; token: string | null } | null } | null;
      if (entry?.position != null && !v.placed) {
        v.placed = true;
        placed++;
        firstPlaced ??= at;
      }
      if (entry?.status === 'TURN' && entry.turn?.token && !v.acting) {
        given++;
        deliveries.push(at - Date.parse(entry.turn.at));
        void takeTurn(v, entry.turn.token);
      }
    }
  };

  const openStream = (v: Viewer) => {
    v.asked = Date.now();
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: ready.port,
        method: 'GET',
        path: `/api/v1/live/${ready.dropId}/stream`,
        agent: false,
        headers: { accept: 'text/event-stream', cookie: v.cookie, 'x-forwarded-for': v.ip, 'user-agent': UA },
      },
      (res: IncomingMessage) => {
        v.streamStatus = res.statusCode ?? 0;
        if (res.statusCode !== 200) {
          res.resume();
          return;
        }
        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk: string) => {
          const at = Date.now();
          buffer += chunk;
          for (let k = buffer.indexOf('\n\n'); k >= 0; k = buffer.indexOf('\n\n')) {
            onEvent(v, buffer.slice(0, k), at);
            buffer = buffer.slice(k + 2);
          }
        });
        res.on('close', () => {
          v.ended = true;
          if (!lastRoom.over) v.dropped = true;
        });
      },
    );
    req.on('error', () => {
      v.ended = true;
      v.dropped = true;
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

  // The streams, spread over the time before the room opens (two seconds spare).
  const spread = Math.max(1000, ready.roomOpensAt - Date.now() - 2000);
  for (const v of viewers) setTimeout(() => openStream(v), (v.i / viewers.length) * spread);

  // The burst of entries, in the first seconds of the room.
  await sleep(ready.roomOpensAt - Date.now() + 50);
  const entries = viewers.map((v) =>
    sleep(random() * o.burstSeconds * 1000).then(() => call(v, 'enter', 'POST', '/enter', { sizeId: v.sizeId })),
  );
  await Promise.all(entries);

  // T0, then until the release is over and its streams have ended.
  await sleep(ready.opensAt - Date.now());
  const deadline = ready.opensAt + SELL_OUT_LIMIT_MS;
  while (Date.now() < deadline && !(lastRoom.over && viewers.every((v) => v.ended || v.streamStatus !== 200))) await sleep(200);
  // The turns under way finish (none should be: the release is over).
  while (viewers.some((v) => v.acting) && Date.now() < deadline + 10_000) await sleep(100);

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
  const kinds: ActionKind[] = ['enter', 'press', 'secure', 'addons', 'confirm', 'release'];
  const byKind = Object.fromEntries(kinds.map((k) => [k, stats(actions.filter((a) => a.kind === k).map((a) => a.ms))])) as Record<ActionKind, Stats>;
  const unexpected = actions.filter((a) => a.status !== 200).map((a) => ({ kind: a.kind, status: a.status, ...(a.code ? { code: a.code } : {}) }));

  // The fan-out: the room events of one pulse share its time (`now`, stamped once its room is in memory); from it to
  // the last phone that read one, over the pulses that reached nearly every viewer.
  const pulses = report.pulses;
  const byPulse = new Map<number, { n: number; last: number }>();
  for (const e of rooms) {
    const r = byPulse.get(e.now) ?? { n: 0, last: 0 };
    r.n++;
    r.last = Math.max(r.last, e.at);
    byPulse.set(e.now, r);
  }
  const viewerCount = viewers.filter((v) => v.streamStatus === 200).length;
  const full = [...byPulse.entries()].filter(([, r]) => r.n >= FULL_PULSE * viewerCount);
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
  const streams = {
    opened: viewerCount,
    refused: viewers.filter((v) => v.streamStatus !== null && v.streamStatus !== 200).length + viewers.filter((v) => v.streamStatus === null).length,
    dropped: viewers.filter((v) => v.dropped).length,
    connect: stats(viewers.filter((v) => v.connectedMs !== null).map((v) => v.connectedMs!)),
  };
  const outcome = {
    reason: lastRoom.endedReason ?? null,
    confirmed: viewers.filter((v) => v.outcome === 'CONFIRMED').length,
    released: viewers.filter((v) => v.outcome === 'RELEASED').length,
    endedMs: endRead === null ? null : endRead - ready.opensAt,
  };
  const quantity = SIZES.reduce((n, s) => n + s.stock, 0);
  const clean =
    unexpected.length === 0 &&
    streams.refused === 0 &&
    streams.dropped === 0 &&
    appErrors === 0 &&
    report.messageErrors === 0 &&
    outcome.reason === 'SOLD_OUT' &&
    outcome.confirmed === quantity;
  // The busiest five seconds of the app's CPU.
  let busiest = 0;
  for (let i = 0; i + 5 <= report.cpuBySecond.length; i++) busiest = Math.max(busiest, report.cpuBySecond.slice(i, i + 5).reduce((a, b) => a + b, 0) / 5);
  const f = o.vpsFactor;
  // An action's time is the app's share (waiting for its thread, then its own work) and the database's wait. Only the
  // first runs on the app's core; the second is PGlite's one connection here, a stand-in already pessimistic.
  const appShare = report.loopDelayMs.p99 + (report.cpuMs.user + report.cpuMs.system) / Math.max(1, actions.length);
  const vpsP95 = all.p95 + (f - 1) * appShare;
  const verdict = {
    action: vpsP95 < LIVE_LOAD_TARGETS.actionP95Ms,
    fanOut: fan.n > 0 && fan.p95 * f < LIVE_LOAD_TARGETS.fanOutP95Ms,
    memory: withGeoIp < limitMib,
    cpu: busiest * f < LIVE_LOAD_TARGETS.cpuCores,
    clean,
    pass: false,
  };
  verdict.pass = verdict.action && verdict.fanOut && verdict.memory && verdict.cpu && verdict.clean;

  return {
    viewers: viewersWanted,
    vpsFactor: o.vpsFactor,
    calibrationMs: ready.calibrationMs,
    seedMs: ready.seedMs,
    streams,
    actions: { all, byKind, unexpected, appShareMs: round(appShare), vpsP95Ms: round(vpsP95) },
    fanOut: {
      pulses: pulses.length,
      full: full.length,
      received: fan,
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
      perViewerKib: Math.round(((peakRss - ready.baseline.rss) / 1024 / Math.max(1, viewerCount)) * 10) / 10,
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
  const lines = [
    `### ${r.viewers} in the room (calibration ${r.calibrationMs} ms; a VPS vCPU taken as ${f} times slower)`,
    '',
    '| Figure | Measured | Target, on the VPS |',
    '|---|---|---|',
    `| Actions, all (${r.actions.all.n}) | p50 ${ms(r.actions.all.p50)} · **p95 ${ms(r.actions.all.p95)}** (the app's share ${ms(r.actions.appShareMs)}, × ${f}: ${ms(r.actions.vpsP95Ms)}) · p99 ${ms(r.actions.all.p99)} · max ${ms(r.actions.all.max)} | p95 < ${LIVE_LOAD_TARGETS.actionP95Ms} ms: ${yes(r.verdict.action)} |`,
    `| ENTER (${k.enter.n}) | p50 ${ms(k.enter.p50)} · p95 ${ms(k.enter.p95)} · max ${ms(k.enter.max)} | |`,
    `| PRESS / SECURE (${k.press.n} / ${k.secure.n}) | p95 ${ms(k.press.p95)} / ${ms(k.secure.p95)} · max ${ms(k.press.max)} / ${ms(k.secure.max)} | |`,
    `| Add-ons / PAY / RELEASE (${k.addons.n} / ${k.confirm.n} / ${k.release.n}) | p95 ${ms(k.addons.p95)} / ${ms(k.confirm.p95)} / ${ms(k.release.p95)} | |`,
    `| Fan-out, the room in memory → the last phone (${r.fanOut.full} full pulses of ${r.fanOut.pulses}) | p50 ${ms(r.fanOut.received.p50)} · **p95 ${ms(r.fanOut.received.p95)}**${vps(r.fanOut.received.p95)} · max ${ms(r.fanOut.received.max)} | p95 < ${LIVE_LOAD_TARGETS.fanOutP95Ms} ms: ${yes(r.verdict.fanOut)} |`,
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
    `| Answers other than 200 · app errors | ${r.actions.unexpected.length} · ${r.appErrors} | none: ${yes(r.verdict.clean)} |`,
    '',
    `**${r.verdict.pass ? 'Every target met' : 'A target not met'}** at ${r.viewers} in the room.`,
    '',
  ];
  if (r.actions.unexpected.length) {
    const groups = new Map<string, number>();
    for (const u of r.actions.unexpected) groups.set(`${u.kind} ${u.status} ${u.code ?? ''}`.trim(), (groups.get(`${u.kind} ${u.status} ${u.code ?? ''}`.trim()) ?? 0) + 1);
    lines.push(`Answers other than 200: ${[...groups].map(([g, n]) => `${g} × ${n}`).join(', ')}`, '');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function drive(o: Options): Promise<void> {
  process.stdout.write(
    `LIVE RELEASES load test: levels ${o.levels.join(', ')}, a VPS vCPU taken as ${o.vpsFactor} times slower, a burst of ${o.burstSeconds} s, seed ${o.seed}, ${o.databaseUrl === 'pglite:memory' ? 'PGlite in its own process' : 'PostgreSQL'}\n`,
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
    capacity === null
      ? 'No level met every target.\n'
      : `Capacity: ${capacity} in the room (levels met: ${passing.join(', ')}). LIVE_ROOM_CAPACITY (services/live-insights.ts) is set from it.\n`,
  );
  const machine = { cpu: cpus()[0]?.model ?? 'unknown', cpus: cpus().length, memoryGib: Math.round((totalmem() / 1073741824) * 10) / 10, os: `${platform()} ${osRelease()}`, node: process.version };
  mkdirSync(dirname(o.json), { recursive: true });
  writeFileSync(o.json, `${JSON.stringify({ at: new Date().toISOString(), options: o, targets: LIVE_LOAD_TARGETS, geoIpMib: GEOIP_RESIDENT_MIB, machine, capacity, results }, null, 2)}\n`);
  process.stdout.write(`Figures: ${o.json}\n`);
}

if (process.argv.includes('--database')) {
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
