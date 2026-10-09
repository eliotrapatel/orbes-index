/**
 * The arrivals beside a LIVE room, and the Links report's time (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.14 and
 * A.15, step 4.13): `npx tsx scripts/bench.ts --arrivals` (scripts/bench.ts runs `benchArrivals`).
 *
 *   (1) The room, twice (`--arrivals` runs it once without arrivals, then once with them; the same room each time):
 *       three processes, as scripts/live-load.ts runs them and as on the VPS: the app (this file with --arrivals-serve:
 *       the server's own createContext, buildApp and LIVE engine, ORBES_ENV=development so the production rate limits
 *       apply, behind a trusted proxy), the database (--arrivals-database: PGlite alone in its process, reached over a
 *       socket as the app reaches PostgreSQL's container; live-load's own transport, copied here) and this one. In the
 *       app, a LIVE RELEASE of 60 pieces whose room is open, T0 a minute after the start, and a test of 200 test
 *       entrants sent into it through services/test-entrants.ts (the console's SEND TEST ENTRANTS: 200 TITANE arriving
 *       over 30 s, then the line at T0, each turn PRESS, the hold, SECURE, PAY or RELEASE MY PLACE as the owner's
 *       defaults say). For `minutes` (5), this process sends `perMinute` (1,000) arrivals a minute over real HTTP,
 *       `POST /api/v1/seen` with the page load's `a` and no view (half from new devices, half from devices already
 *       seen; a third through a console link, a third with campaign tags, a third from a site or direct; each phone on
 *       an address of its own), or sends nothing in the run without arrivals. Measured: each arrival's time, request
 *       sent → answer read (the route answers 204 once the arrival is written: its database work is inside); every
 *       LIVE engine pass's time over the same minutes; the database's and the app's CPU over them.
 *       Targets (A.15): the arrivals' p95 under 20 ms; no LIVE tick slower than without arrivals.
 *   (2) The Links report (A.14): in this process, PGlite in memory (or a throwaway PostgreSQL database when
 *       ORBES_TEST_POSTGRES_URL is set), the migrations, then 13 months at the unit
 *       (fillAcquisition below: 1,000 visits a day, ≈ 396,000 visits, 39,600 accounts, 77,700 conversions, the
 *       days summarised by the job, today's visits raw), then `AcquisitionReportService.report` for ALL TIME on its three
 *       views, LINKS, CAMPAIGN TAGS and REFERRING SITES, each timed `reps` times after warming up. Target: under 300 ms.
 *
 * PGlite has one connection, which every transaction holds in turn, where PostgreSQL has a pool of ten: the database's
 * share of every time here is pessimistic. The figures name the database they were measured on.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { Agent, request as httpRequest } from 'node:http';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import type { RawBuilder } from 'kysely';
import type { Db } from '../src/server/db/connection.js';

const SELF = fileURLToPath(import.meta.url);
/** The app's public origin here: every arrival sends it, as the app's page does. */
const ORIGIN = 'https://verify.orbes.bench';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** The targets of §3.4 A.14 and A.15. */
export const ARRIVALS_TARGETS = Object.freeze({
  /** The arrival route's p95, ms. */
  arrivalP95Ms: 20,
  /** The Links report, ALL TIME, each view, ms. */
  reportMs: 300,
});

export interface ArrivalsOptions {
  /** Minutes of arrivals beside the room (5). */
  minutes: number;
  /** Arrivals a minute (1,000). */
  perMinute: number;
  /** Test entrants in the room (200). */
  entrants: number;
  /** The report's timed readings per view (10) and warm-up (2). */
  reps: number;
  warmup: number;
  /** Where the app's logs go. */
  outDir: string;
}

export interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function stats(values: readonly number[]): Stats {
  const v = [...values].sort((a, b) => a - b);
  const at = (q: number) => (v.length ? v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)]! : NaN);
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: v.length, mean: r(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)), p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(v.at(-1) ?? NaN) };
}

// ── The database's process (live-load's transport) ──────────────────────────────────────────────────────────────

type DatabaseCall = { op: 'query'; sql: string; params: unknown[]; tx: number | null } | { op: 'begin'; tx: number } | { op: 'end'; tx: number; commit: boolean };
type DatabaseRequest = DatabaseCall & { id: number };
type DatabaseAnswer = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: Record<string, unknown> };
interface Queryable {
  query(sql: string, params?: unknown[], options?: { rowMode?: 'object' }): Promise<{ rows: unknown[]; affectedRows?: number }>;
}

/** Length-prefixed v8 messages on a socket (scripts/live-load.ts `framed`). */
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

/** PGlite alone in its process, on a socket (scripts/live-load.ts `databaseProcess`); its CPU answered on the channel. */
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
    if (m.type === 'cpu') {
      const u = process.cpuUsage();
      process.send!({ type: 'cpu', ms: (u.user + u.system) / 1000 });
    }
  });
  process.on('disconnect', () => {
    server.close();
    void pglite.close().finally(() => process.exit(0));
  });
  process.send!({ type: 'ready' });
}

/** The app's side of PGlite's socket (scripts/live-load.ts `connectDatabase`). */
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

// ── The app's process (--arrivals-serve) ────────────────────────────────────────────────────────────────────────

interface SetupMessage {
  type: 'setup';
  databaseSocket: string;
  entrants: number;
}
interface ReadyMessage {
  type: 'ready';
  port: number;
  links: string[];
  deviceCookie: string;
  t0: number;
}
interface ReportMessage {
  type: 'report';
  ticks: { start: number; ms: number }[];
  appCpuMs: number;
  run: { status: string; entrants: number; confirmed: number; released: number; missed: number; inRoom: number; errors: number };
  arrivals: { touches: number; sources: number; devicesWithSource: number };
}

async function serve(): Promise<void> {
  const setup = await new Promise<SetupMessage>((r) => process.once('message', (m) => r(m as SetupMessage)));
  const { loadConfig } = await import('../src/server/config.js');
  const { buildApp } = await import('../src/server/app.js');
  const { createContext, startLiveEngine } = await import('../src/server/context.js');
  const { createForwardingLogger, loggerOptions } = await import('../src/server/http/logging.js');
  const { createDbFromPGlite } = await import('../src/server/db/connection.js');
  const { deviceCookieName } = await import('../src/server/http/device.js');
  const { testPhrase } = await import('../src/server/services/test-entrants.js');
  const { liveFixtureOn, createLiveRelease } = await import('../test/support/live.js');

  const config = loadConfig({ ORBES_ENV: 'development', DATABASE_URL: 'pglite:memory', TRUST_PROXY: '127.0.0.1', PUBLIC_ORIGIN: ORIGIN, LOG_LEVEL: 'info' });
  const log = createForwardingLogger(process.stdout);
  const database = await connectDatabase(setup.databaseSocket);
  const ctx = await createContext(config, { log, db: createDbFromPGlite(database.pglite) });
  const app = await buildApp(ctx, { serveStatic: false, logger: loggerOptions(config) });
  log.attach(app.log);
  const engine = startLiveEngine(ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as { port: number }).port;

  // The room: a LIVE RELEASE of 60 pieces, its room open now, T0 a minute ahead; three console links for the arrivals.
  const clock = { now: () => new Date() } as unknown as Parameters<typeof liveFixtureOn>[1];
  const f = await liveFixtureOn(ctx, clock);
  const t0 = Date.now() + 60_000;
  const release = await createLiveRelease(f, { opensAt: new Date(t0), sizes: [{ label: '52', stock: 60 }], roomOpensMinutes: 5 });
  const channel = (await ctx.services.links.channels())[0]!;
  const links: string[] = [];
  for (const name of ['Instagram bio', 'Léa — TikTok', 'Press piece']) links.push((await ctx.services.links.create({ name, channelId: channel.id, destination: 'NOW' }, f.admin)).code);

  const ticks: { start: number; ms: number }[] = [];
  const tick = engine.tick.bind(engine);
  engine.tick = async (...args: Parameters<typeof tick>) => {
    const start = Date.now();
    const t = performance.now();
    const out = await tick(...args);
    ticks.push({ start, ms: Math.round((performance.now() - t) * 100) / 100 });
    return out;
  };
  // SEND TEST ENTRANTS: 200 TITANE over 30 s, the owner's defaults for the turns.
  const run = await app.testEntrants.start(
    release.id,
    { phrase: testPhrase(release.id), tiers: { none: 0, titane: setup.entrants, platine: 0, palladium: 0 }, arrival: { mode: 'burst', seconds: 30, interestPct: 0 }, choices: { size: '52', quantity: 1, addOnsPct: 0 } },
    f.admin,
  );
  const cpuAtReady = process.cpuUsage();
  process.send!({ type: 'ready', port, links, deviceCookie: deviceCookieName(config), t0 } satisfies ReadyMessage);

  process.on('message', (m: { type: string; from?: number }) => {
    if (m.type !== 'report') return;
    void (async () => {
      const used = process.cpuUsage(cpuAtReady);
      const view = await app.testEntrants.view(run.id);
      const sum = (k: 'confirmed' | 'released' | 'missed' | 'inRoom') => view.byTier.reduce((n, t) => n + t[k], 0);
      const { sql } = await import('kysely');
      const counts = (
        await sql<{ touches: number; sources: number; devices: number }>`
          SELECT (SELECT count(*) FROM acquisition_touches)::int AS touches, (SELECT count(*) FROM acquisition_sources)::int AS sources,
                 (SELECT count(*) FROM tracking_devices WHERE first_source_id IS NOT NULL)::int AS devices`.execute(ctx.db)
      ).rows[0]!;
      process.send!({
        type: 'report',
        ticks: ticks.filter((t) => t.start >= (m.from ?? 0)),
        appCpuMs: (used.user + used.system) / 1000,
        run: { status: view.status, entrants: view.entrants, confirmed: sum('confirmed'), released: sum('released'), missed: sum('missed'), inRoom: sum('inRoom'), errors: view.errors.length },
        arrivals: { touches: Number(counts.touches), sources: Number(counts.sources), devicesWithSource: Number(counts.devices) },
      } satisfies ReportMessage);
    })();
  });
}

// ── The driver ──────────────────────────────────────────────────────────────────────────────────────────────────

function nextMessage<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: { type: string }) => {
      if (m.type !== type) return;
      cleanup();
      resolve(m as T);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`a process of the bench ended (${code}) before its ${type}`));
    };
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

export interface RoomRun {
  arrivals: boolean;
  sent: number;
  statuses: Record<string, number>;
  arrivalMs: Stats | null;
  ticks: Stats;
  /** The engine's passes once the line formed (from T0). */
  ticksFromT0: Stats;
  databaseCpuMs: number;
  databaseCores: number;
  appCpuMs: number;
  windowS: number;
  run: ReportMessage['run'];
  recorded: ReportMessage['arrivals'];
}

/** One run of the room, with or without arrivals. */
async function roomRun(o: ArrivalsOptions, withArrivals: boolean): Promise<RoomRun> {
  mkdirSync(o.outDir, { recursive: true });
  const socketPath = join(tmpdir(), `orbes-arrivals-${process.pid}-${withArrivals ? 'a' : 'b'}.sock`);
  rmSync(socketPath, { force: true });
  const db = fork(SELF, ['--arrivals-database', socketPath], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await nextMessage(db, 'ready');
  const out = openSync(join(o.outDir, `arrivals-server-${withArrivals ? 'with' : 'without'}.log`), 'w');
  const app = fork(SELF, ['--arrivals-serve'], { stdio: ['ignore', out, 'inherit', 'ipc'] });
  closeSync(out);
  const dbCpu = async () => {
    db.send({ type: 'cpu' });
    return (await nextMessage<{ ms: number }>(db, 'cpu')).ms;
  };
  try {
    app.send({ type: 'setup', databaseSocket: socketPath, entrants: o.entrants } satisfies SetupMessage);
    const ready = await nextMessage<ReadyMessage>(app, 'ready');
    const agent = new Agent({ keepAlive: true, maxSockets: 32 });
    const started = Date.now();
    const cpu0 = await dbCpu();
    const durationMs = o.minutes * 60_000;
    const intervalMs = 60_000 / o.perMinute;
    const times: number[] = [];
    const statuses: Record<string, number> = {};
    const known: string[] = [];
    let sent = 0;
    const inFlight = new Set<Promise<void>>();
    const arrive = (i: number): Promise<void> =>
      new Promise((done) => {
        const fresh = i % 2 === 0 || known.length === 0;
        const cookie = fresh ? null : known[(i * 7919) % known.length]!;
        const a: Record<string, unknown> = { path: '/verify' };
        if (i % 3 === 0) a.link = ready.links[i % ready.links.length];
        else if (i % 3 === 1) a.utm = { source: ['instagram', 'tiktok', 'newsletter'][i % 3], medium: 'story', campaign: `drop-${i % 20}` };
        else if (i % 6 === 2) a.referrer = ['https://l.instagram.com/', 'https://www.google.com/', 'https://www.vogue.fr/a'][i % 3];
        const body = JSON.stringify({ v: 1, d: { s: false, t: 5, w: 390 }, a, e: [] });
        const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
        const t = performance.now();
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: ready.port,
            method: 'POST',
            path: '/api/v1/seen',
            agent,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin: ORIGIN, 'user-agent': UA, 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
          },
          (res) => {
            res.resume();
            res.on('end', () => {
              times.push(performance.now() - t);
              statuses[String(res.statusCode)] = (statuses[String(res.statusCode)] ?? 0) + 1;
              const set = res.headers['set-cookie']?.find((c) => c.startsWith(`${ready.deviceCookie}=`));
              if (set) known.push(set.split(';')[0]!);
              done();
            });
          },
        );
        req.on('error', () => {
          statuses.error = (statuses.error ?? 0) + 1;
          done();
        });
        req.end(body);
      });
    if (withArrivals) {
      // Open loop: one arrival every 60 ms whatever the answers, as phones arrive.
      for (let i = 0; Date.now() - started < durationMs; i++) {
        const due = started + i * intervalMs;
        const wait = due - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const p = arrive(i).finally(() => inFlight.delete(p));
        inFlight.add(p);
        sent++;
      }
      await Promise.all([...inFlight]);
    } else {
      await new Promise((r) => setTimeout(r, durationMs));
    }
    const windowS = (Date.now() - started) / 1000;
    const cpu1 = await dbCpu();
    app.send({ type: 'report', from: started });
    const report = await nextMessage<ReportMessage>(app, 'report');
    agent.destroy();
    return {
      arrivals: withArrivals,
      sent,
      statuses,
      arrivalMs: withArrivals ? stats(times) : null,
      ticks: stats(report.ticks.map((t) => t.ms)),
      ticksFromT0: stats(report.ticks.filter((t) => t.start >= ready.t0).map((t) => t.ms)),
      databaseCpuMs: Math.round(cpu1 - cpu0),
      databaseCores: Math.round(((cpu1 - cpu0) / (windowS * 1000)) * 1000) / 1000,
      appCpuMs: Math.round(report.appCpuMs),
      windowS: Math.round(windowS),
      run: report.run,
      recorded: report.arrivals,
    };
  } finally {
    const exited = Promise.all([new Promise((r) => app.once('exit', r)), new Promise((r) => db.once('exit', r))]);
    app.kill('SIGKILL');
    db.disconnect();
    setTimeout(() => db.kill('SIGKILL'), 5_000).unref();
    await exited;
    rmSync(socketPath, { force: true });
  }
}

/** The unit of §8, per Paris day. */
const ACQUISITION_UNIT = Object.freeze({
  newDevices: 600,
  visits: 1_000,
  signups: 100,
  entries: 60,
  orders: 40,
  campaigns: 5,
  links: 30,
  sites: 300,
});

interface AcquisitionFill {
  days: number;
  firstDay: string;
  lastDay: string;
  rows: Record<string, number>;
}

/**
 * The report's 13 months at the unit of the plan (§8: 1,000 visitors a day), written in bulk into a migrated, empty
 * database, as test data is (generate_series). Dev only: it never runs in production. From the Paris day 13 calendar
 * months before `end` (tracking.ts viewHistoryCutoff) through `end`'s own Paris day, each day: 600 new devices (half of
 * them arriving Direct, the others through a link, campaign tags or a site), 1,000 visits with a source (the 600 new
 * devices' and 400 returns of earlier devices, one per device, source and day), 100 sign-ups (each on one of the day's
 * new devices, with its first source and its SIGNUP conversion), 60 draw entries and 40 orders of the private salon (its
 * request, its invoice; one in twenty cancelled with its credit note), each with its conversion; 5 new campaigns; about
 * 50 sources visited (the 30 links, 15 of the sites, the day's campaigns). The house: the seven channels, 30 links (one
 * in three with a cost), 300 referring sites. Every day before `end`'s is summarised into `acquisition_daily` by the job
 * itself (summariseDays), as the morning window leaves it; `end`'s own visits stay raw, as today's do. The conversions'
 * last links are drawn, not judged (the job's rule is its tests'): what is measured here is the reading's time.
 * `end` must fall in the morning window (from 07:30 UTC).
 */
async function fillAcquisition(db: Db, end: Date, log: (m: string) => void = () => {}): Promise<AcquisitionFill> {
  const { sql } = await import('kysely');
  const { AcquisitionService } = await import('../src/server/services/acquisition.js');
  const { summariseDays } = await import('../src/server/services/acquisition-jobs.js');
  const { parisDay, parisDayStart } = await import('../src/server/services/schedule.js');
  const { nextParisDay, viewHistoryCutoff } = await import('../src/server/services/tracking.js');
  const { GrowthWorld } = await import('../test/support/growth.js');
  const count = async (table: string): Promise<number> => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(db)).rows[0]!.n);
  const U = ACQUISITION_UNIT;
  const firstDay = parisDay(viewHistoryCutoff(end));
  const lastDay = parisDay(end);
  const days: { d: number; day: string; start: Date }[] = [];
  for (let day = firstDay, d = 0; day <= lastDay; day = nextParisDay(day), d++) days.push({ d, day, start: parisDayStart(day) });
  const start = days[0]!.start;
  await new AcquisitionService({ db, publicOrigin: 'https://verify.orbes.bench', clock: () => start }).prepare();
  // The recording started with the fill's first day, whether this boot or an earlier one wrote the state row.
  await db.updateTable('acquisition_state').set({ tracking_started_at: start, conversions_until: start, daily_until: null, catch_up_on: null }).where('id', '=', 1).execute();
  const w = await new GrowthWorld(db).prepare();
  const model = await w.model('MONOLITHE', { price: [25_000, 'EUR'] });
  await sql`CREATE TEMP TABLE fill_days (d int PRIMARY KEY, day date NOT NULL, start timestamptz NOT NULL)`.execute(db);
  await sql`INSERT INTO fill_days (d, day, start)
            SELECT * FROM unnest(${sql.raw(`ARRAY[${days.map((x) => x.d).join(',')}]::int[]`)}, ${sql.raw(`ARRAY[${days.map((x) => `'${x.day}'`).join(',')}]::date[]`)},
                                 ${sql.raw(`ARRAY[${days.map((x) => `'${x.start.toISOString()}'`).join(',')}]::timestamptz[]`)})`.execute(db);
  const D = days.length;
  log(`fill: ${D} Paris days, ${firstDay} to ${lastDay}`);

  // The house: an admin, 30 links over the seven channels, 300 sites, 5 campaigns a day.
  const admin = (await db.insertInto('admin_users').values({ email: 'acq-fill@orbes.bench', email_normalized: 'acq-fill@orbes.bench', password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id;
  await sql`
    INSERT INTO links (code, name, channel_id, destination, cost_minor, cost_currency, created_by, created_at, updated_at)
    SELECT 'fill-link-' || g, 'Link ' || g, c.id, 'NOW', CASE WHEN g % 3 = 0 THEN 10000 * g END, CASE WHEN g % 3 = 0 THEN 'EUR' END, ${admin}::uuid, ${start}::timestamptz, ${start}::timestamptz
      FROM generate_series(1, ${U.links}::int) g
      JOIN (SELECT id, row_number() OVER (ORDER BY position) - 1 AS n FROM link_channels) c ON c.n = g % 7`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, link_id, key, created_at) SELECT 'LINK', id, 'L:' || id, created_at FROM links`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, site, key, created_at)
            SELECT 'SITE', 'site-' || g || '.example', 'S:site-' || g || '.example', ${start}::timestamptz FROM generate_series(1, ${U.sites}::int) g`.execute(db);
  await sql`INSERT INTO acquisition_sources (kind, utm_source, utm_medium, utm_campaign, utm_content, key, created_at)
            SELECT 'CAMPAIGN', (ARRAY['instagram','tiktok','newsletter','google'])[1 + k % 4], (ARRAY['story','bio','paid'])[1 + k % 3],
                   'drop-' || fd.d || '-' || k, CASE WHEN k % 2 = 0 THEN 'variant-' || k END,
                   'C:' || (ARRAY['instagram','tiktok','newsletter','google'])[1 + k % 4] || chr(31) || (ARRAY['story','bio','paid'])[1 + k % 3] || chr(31) || 'drop-' || fd.d || '-' || k
                        || chr(31) || coalesce(CASE WHEN k % 2 = 0 THEN 'variant-' || k END, '') || chr(31),
                   fd.start + make_interval(secs => k * 3600)
              FROM fill_days fd, generate_series(0, ${U.campaigns - 1}::int) k`.execute(db);
  const direct = (await db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
  const pool = (await db.selectFrom('acquisition_sources').select('id').where('kind', 'in', ['LINK', 'SITE', 'CAMPAIGN']).orderBy('id').execute()).map((r) => r.id);
  const P = pool.length;
  const poolArray = sql.raw(`ARRAY[${pool.join(',')}]::int[]`);
  const ofKind = async (kind: 'LINK' | 'SITE' | 'CAMPAIGN') => sql.raw(`ARRAY[${(await db.selectFrom('acquisition_sources').select('id').where('kind', '=', kind).orderBy('created_at').orderBy('id').execute()).map((r) => r.id).join(',')}]::int[]`);
  const linkArray = await ofKind('LINK');
  const siteArray = await ofKind('SITE');
  const campaignArray = await ofKind('CAMPAIGN');
  /**
   * A source of day `d` for the slot `n`: about 50 sources a day, as a house sees them: the 30 links (six visits in
   * ten), 15 of the sites (turning from day to day) and the day's 5 campaigns.
   */
  const daySource = (d: RawBuilder<unknown>, n: RawBuilder<unknown>) => {
    const r = sql`((${n})::bigint * 104729 % 50)::int`;
    return sql`(CASE WHEN ${r} < ${U.links} THEN (${linkArray})[1 + ${r}]
                     WHEN ${r} < ${U.links + 15} THEN (${siteArray})[1 + ((${d}) * 7 + ${r}) % ${U.sites}]
                     ELSE (${campaignArray})[1 + (${d}) * ${U.campaigns} + (${r} - ${U.links + 15}) % ${U.campaigns}] END)`;
  };

  // The devices: 600 a day, their pseudonyms 43 base64url characters of a SHA-256, half Direct.
  await sql`
    INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, first_seen_at, last_seen_at, first_source_id)
    SELECT translate(substr(encode(sha256(convert_to('acq-fill-device-' || fd.d || '-' || k, 'UTF8')), 'base64'), 1, 43), '+/', '-_'),
           (ARRAY['PHONE','PHONE','PHONE','COMPUTER','TABLET'])[1 + k % 5], (ARRAY['IOS','IOS','ANDROID','MACOS','WINDOWS'])[1 + k % 5],
           (ARRAY['SAFARI','SAFARI','CHROME','CHROME','FIREFOX'])[1 + k % 5],
           CASE WHEN k % 7 = 0 THEN 'IN_APP' ELSE 'BROWSER' END, CASE WHEN k % 7 = 0 THEN 'INSTAGRAM' END,
           fd.start + make_interval(secs => k * 143.0), fd.start + make_interval(secs => k * 143.0 + 1800),
           CASE WHEN (fd.d + k) % 2 = 0 THEN ${direct}::integer ELSE ${daySource(sql`fd.d`, sql`fd.d * 600 + k`)} END
      FROM fill_days fd, generate_series(0, ${U.newDevices - 1}::int) k
     ORDER BY fd.d, k`.execute(db);
  const firstDevice = Number((await sql<{ m: number }>`SELECT min(id) AS m FROM tracking_devices`.execute(db)).rows[0]!.m);
  if ((await count('tracking_devices')) !== D * U.newDevices) throw new Error('devices: not one per slot');
  log(`devices: ${D * U.newDevices}`);

  // The visits: the day's 600 new devices (their own first source, or a source of the pool for the Direct ones) and 400
  // returns of earlier devices through a source of the pool; one per device, source and day.
  await sql`
    INSERT INTO acquisition_touches (device_id, source_id, day, first_at, last_at, arrivals)
    SELECT v.device_id, CASE WHEN v.i < ${U.newDevices} AND d.first_source_id <> ${direct}::integer THEN d.first_source_id ELSE v.pooled END,
           v.day, v.first_at, v.first_at + make_interval(secs => (v.i % 5) * 600), 1 + (v.i % 3 = 0)::int
      FROM (SELECT fd.day, i, fd.start + make_interval(secs => i * 86.0) AS first_at,
                   CASE WHEN i < ${U.newDevices} THEN ${firstDevice} + fd.d * ${U.newDevices} + i
                        ELSE ${firstDevice} + ((fd.d * 1000 + i)::bigint * 2654435761 % greatest(fd.d * ${U.newDevices}, ${U.newDevices}))::int END AS device_id,
                   ${daySource(sql`fd.d`, sql`fd.d * 1000 + i + 7`)} AS pooled
              FROM fill_days fd CROSS JOIN generate_series(0, ${U.visits - 1}::int) i) v
      JOIN tracking_devices d ON d.id = v.device_id
    ON CONFLICT (device_id, source_id, day) DO NOTHING`.execute(db);
  log(`visits: ${await count('acquisition_touches')}`);

  // The sign-ups: 100 a day, each on one of the day's new devices, linked to it with its first source.
  await sql`
    INSERT INTO accounts (email, email_normalized, password_hash, country, created_at)
    SELECT 'acq-' || fd.d || '-' || k || '@bench.test', 'acq-' || fd.d || '-' || k || '@bench.test', 'unused',
           (ARRAY['FR','GB','US','IT','DE'])[1 + k % 5], fd.start + make_interval(secs => k * 143.0 + 900)
      FROM fill_days fd, generate_series(0, ${U.signups - 1}::int) k ORDER BY fd.d, k`.execute(db);
  await sql`CREATE TEMP TABLE fill_accounts AS SELECT id, created_at, row_number() OVER (ORDER BY created_at, id)::int - 1 AS n FROM accounts WHERE email LIKE 'acq-%@bench.test'`.execute(db);
  await sql`CREATE INDEX ON fill_accounts (n)`.execute(db);
  // The account n was made on day n / 100, on the device (day, n % 100).
  await sql`
    UPDATE tracking_devices d SET account_id = a.id, linked_at = a.created_at
      FROM fill_accounts a WHERE d.id = ${firstDevice} + (a.n / ${U.signups}) * ${U.newDevices} + a.n % ${U.signups}`.execute(db);
  await sql`UPDATE acquisition_touches t SET account_id = d.account_id FROM tracking_devices d WHERE d.id = t.device_id AND d.account_id IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO account_sources (account_id, first_source_id, first_seen_at, set_at, set_by)
    SELECT d.account_id, d.first_source_id, d.first_seen_at, d.linked_at, 'SIGN_UP' FROM tracking_devices d WHERE d.account_id IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'SIGNUP', a.id, a.id, a.created_at, CASE WHEN a.n % 10 < 7 THEN s.first_source_id ELSE (${poolArray})[1 + (a.n * 31) % ${P}] END, a.created_at
      FROM fill_accounts a JOIN account_sources s ON s.account_id = a.id`.execute(db);
  log(`sign-ups: ${await count('account_sources')}`);

  // The draws, one a month, and 60 entries a day of accounts already made; their conversions.
  const months = [...new Set(days.map((x) => x.day.slice(0, 7)))];
  const drops: string[] = [];
  for (const m of months) drops.push((await w.drop({ mode: 'DRAW', modelId: model, title: `DRAW ${m}`, opens: `${m}-01`, quantity: 50 })).id);
  const dropArray = sql.raw(`ARRAY[${drops.map((x) => `'${x}'`).join(',')}]::uuid[]`);
  const monthIndex = sql.raw(`(ARRAY[${months.map((m) => `'${m}'`).join(',')}]::text[])`);
  await sql`
    INSERT INTO drop_entries (drop_id, account_id, created_at, status)
    SELECT (${dropArray})[array_position(${monthIndex}, to_char(fd.day, 'YYYY-MM'))], a.id, fd.start + make_interval(secs => j * 1400.0 + 3600), 'ENTERED'
      FROM fill_days fd CROSS JOIN generate_series(0, ${U.entries - 1}::int) j
      JOIN fill_accounts a ON a.n = ((fd.d * ${U.entries} + j)::bigint * 7919 % ((fd.d + 1) * ${U.signups}))::int
    ON CONFLICT (drop_id, account_id) DO NOTHING`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'DRAW_ENTRY', e.id, e.account_id, e.created_at, CASE WHEN abs(hashtext(e.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${poolArray})[1 + abs(hashtext(e.id::text)) % ${P}] END, e.created_at
      FROM drop_entries e JOIN account_sources s ON s.account_id = e.account_id`.execute(db);
  log(`entries: ${await count('drop_entries')}`);

  // The orders: 40 a day of the private salon, each with its request and invoice; one in twenty cancelled with its credit note.
  await sql`
    INSERT INTO shop_requests (account_id, model_id, note, status, created_at, handled_at, outcome)
    SELECT a.id, ${model}::uuid, 'ACQ-' || fd.d || '-' || j, 'CLOSED', fd.start + make_interval(secs => j * 2000.0), fd.start + make_interval(secs => j * 2000.0 + 3600), 'ACCEPTED'
      FROM fill_days fd CROSS JOIN generate_series(0, ${U.orders - 1}::int) j
      JOIN fill_accounts a ON a.n = ((fd.d * ${U.orders} + j)::bigint * 104729 % ((fd.d + 1) * ${U.signups}))::int`.execute(db);
  await sql`
    INSERT INTO orders (channel, account_id, model_id, shop_request_id, price_minor, currency, status, reserved_at, paid_at, cancelled_at, location_id)
    SELECT 'SALON', r.account_id, r.model_id, r.id, 20000 + (abs(hashtext(r.note)) % 4) * 5000, 'EUR',
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN 'CANCELLED' ELSE 'PAID' END, r.handled_at, r.handled_at + interval '30 minutes',
           CASE WHEN abs(hashtext(r.note)) % 20 = 1 THEN r.handled_at + interval '1 day' END, ${w.location}::uuid
      FROM shop_requests r WHERE r.note LIKE 'ACQ-%'`.execute(db);
  const lines = JSON.stringify([{ kind: 'PIECE', label: 'PIECE', detail: 'THE PRIVATE SALON', amountMinor: 0 }]);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'INVOICE', extract(year FROM paid_at AT TIME ZONE 'UTC')::int, 800000 + row_number() OVER (ORDER BY id), id, '{"name":"CONGLOMERAT LLC"}', '{}', ${lines}::jsonb,
           currency, price_minor, price_minor, paid_at
      FROM orders WHERE channel = 'SALON' AND paid_at IS NOT NULL`.execute(db);
  await sql`
    INSERT INTO invoices (kind, year, sequence, order_id, credits_invoice_id, credit_scope, issuer, buyer, lines, currency, subtotal_minor, total_minor, issued_at)
    SELECT 'CREDIT_NOTE', extract(year FROM o.cancelled_at AT TIME ZONE 'UTC')::int, 800000 + row_number() OVER (ORDER BY o.id), o.id, i.id, 'FULL', i.issuer, i.buyer, i.lines,
           i.currency, i.subtotal_minor, i.total_minor, o.cancelled_at
      FROM orders o JOIN invoices i ON i.order_id = o.id AND i.kind = 'INVOICE' WHERE o.status = 'CANCELLED'`.execute(db);
  await sql`
    INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id, created_at)
    SELECT 'ORDER', o.id, o.account_id, r.created_at, CASE WHEN abs(hashtext(o.id::text)) % 2 = 0 THEN s.first_source_id ELSE (${poolArray})[1 + abs(hashtext(o.id::text)) % ${P}] END, o.reserved_at
      FROM orders o JOIN shop_requests r ON r.id = o.shop_request_id JOIN account_sources s ON s.account_id = o.account_id`.execute(db);
  log(`orders: ${await count('orders')}`);

  // The days before `end`'s, summarised by the job itself; the watermark and the catch-up as the job leaves them.
  let summarised = 0;
  for (let n = await summariseDays(db, end); n > 0; n = await summariseDays(db, end)) summarised += n;
  await db.updateTable('acquisition_state').set({ conversions_until: end, catch_up_on: lastDay }).where('id', '=', 1).execute();
  await sql`DROP TABLE fill_accounts`.execute(db);
  await sql`DROP TABLE fill_days`.execute(db);
  log(`summarised: ${summarised} days`);
  const rows: Record<string, number> = {};
  for (const t of ['link_channels', 'links', 'acquisition_sources', 'acquisition_touches', 'account_sources', 'acquisition_conversions', 'acquisition_daily', 'acquisition_state', 'tracking_devices', 'accounts', 'drop_entries', 'orders', 'invoices']) {
    rows[t] = await count(t);
  }
  return { days: D, firstDay, lastDay, rows };
}

export interface ReportTimes {
  database: string;
  fill: Record<string, number>;
  fillSeconds: number;
  views: Record<'links' | 'campaigns' | 'sites', Stats>;
}

/** (2) The Links report, ALL TIME, on 13 months at the unit, in this process on PGlite in memory. */
async function reportTimes(o: ArrivalsOptions): Promise<ReportTimes> {
  const { sql } = await import('kysely');
  const { testConfig } = await import('../src/server/config.js');
  const { createContext } = await import('../src/server/context.js');
  const { MemoryKeyProvider } = await import('../src/server/keys/memory-provider.js');
  const { closeDb, createDb } = await import('../src/server/db/connection.js');
  const { randomBytes } = await import('node:crypto');
  // On PostgreSQL when ORBES_TEST_POSTGRES_URL is set (a throwaway database, dropped at the end), else PGlite in memory.
  const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;
  let url = 'pglite:memory';
  let drop = async () => {};
  if (pgUrl) {
    const admin = createDb(pgUrl);
    const name = `orbes_bench_links_${randomBytes(4).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(pgUrl);
    u.pathname = `/${name}`;
    url = u.toString();
    drop = async () => {
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    };
  }
  const ctx = await createContext(testConfig({ databaseUrl: url, publicOrigin: ORIGIN }), { migrate: true, ensureActiveKey: false, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
  try {
    const version = (await sql<{ v: string }>`SELECT version() AS v`.execute(ctx.db)).rows[0]!.v;
    // The fill's last day is today (Paris): its visits stay raw, every day before is summarised. The job summarises in
    // the morning window only (from 07:30 UTC of the Paris day): before it (at night too, once the Paris day has
    // turned), the fill ends at 08:00 UTC of today's Paris day.
    const { morningWindowOpen, parisDay } = await import('../src/server/services/schedule.js');
    let end = new Date();
    if (!morningWindowOpen(end)) end = new Date(`${parisDay(end)}T08:00:00.000Z`);
    const t0 = performance.now();
    const fill = await fillAcquisition(ctx.db, end);
    await sql`ANALYZE`.execute(ctx.db);
    const fillSeconds = Math.round((performance.now() - t0) / 100) / 10;
    const svc = ctx.services.acquisitionReport;
    const views = {} as ReportTimes['views'];
    for (const view of ['links', 'campaigns', 'sites'] as const) {
      const ms: number[] = [];
      for (let i = 0; i < o.warmup + o.reps; i++) {
        const t = performance.now();
        const r = await svc.report({ view });
        const dt = performance.now() - t;
        if (r.total.visits === 0) throw new Error('the report read no visit');
        if (i >= o.warmup) ms.push(dt);
      }
      views[view] = stats(ms);
    }
    return { database: pgUrl ? `${version} (a throwaway database, pg pool of 10)` : `${version} (PGlite, in this process)`, fill: fill.rows, fillSeconds, views };
  } finally {
    await ctx.close();
    await drop();
  }
}

export interface ArrivalsResult {
  options: ArrivalsOptions;
  targets: typeof ARRIVALS_TARGETS;
  database: string;
  without: RoomRun;
  with: RoomRun;
  report: ReportTimes;
  verdict: { arrivalP95: boolean; ticksNotSlower: boolean; report: boolean };
}

/** The whole bench: the room without arrivals, with them, then the report. */
export async function benchArrivals(o: ArrivalsOptions, log: (s: string) => void): Promise<ArrivalsResult> {
  log(`## (f) Arrivals beside a LIVE room, and the Links report (plan CUSTOMER INTELLIGENCE §3.4 A.14, A.15)\n`);
  log(`room: ${o.entrants} test entrants, 60 pieces, T0 one minute in; ${o.perMinute} arrivals a minute for ${o.minutes} minutes; PGlite in its own process\n`);
  const without = await roomRun(o, false);
  log(`without arrivals: ${without.ticks.n} engine passes, p95 ${without.ticks.p95} ms, database CPU ${without.databaseCores} cores; the room ${JSON.stringify(without.run)}`);
  const withA = await roomRun(o, true);
  log(`with arrivals: ${withA.sent} sent ${JSON.stringify(withA.statuses)}, p95 ${withA.arrivalMs?.p95} ms; ${withA.ticks.n} engine passes, p95 ${withA.ticks.p95} ms; database CPU ${withA.databaseCores} cores; recorded ${JSON.stringify(withA.recorded)}; the room ${JSON.stringify(withA.run)}\n`);
  const report = await reportTimes(o);
  // The engine's passes over the whole window and from T0 (the line, the turns), their p50, p95 and p99 (a percentile
  // with no pass, a window shorter than T0's minute, is not compared).
  const notSlower = (a: Stats, b: Stats) => a.n === 0 || b.n === 0 || (a.p50 <= b.p50 && a.p95 <= b.p95 && a.p99 <= b.p99);
  const ticksNotSlower = notSlower(withA.ticks, without.ticks) && notSlower(withA.ticksFromT0, without.ticksFromT0);
  const verdict = {
    arrivalP95: (withA.arrivalMs?.p95 ?? Infinity) < ARRIVALS_TARGETS.arrivalP95Ms,
    ticksNotSlower,
    report: Object.values(report.views).every((v) => v.p95 < ARRIVALS_TARGETS.reportMs),
  };
  const row = (name: string, s: Stats | null) => (s ? `| ${name} | ${s.n} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} |` : `| ${name} | — | — | — | — | — |`);
  log('| Measure | n | p50 ms | p95 ms | p99 ms | max ms |\n|---|---|---|---|---|---|');
  log(row('arrival (POST /api/v1/seen with `a`)', withA.arrivalMs));
  log(row('LIVE engine pass, without arrivals', without.ticks));
  log(row('LIVE engine pass, with arrivals', withA.ticks));
  log(row('LIVE engine pass from T0, without', without.ticksFromT0));
  log(row('LIVE engine pass from T0, with', withA.ticksFromT0));
  for (const [view, s] of Object.entries(report.views)) log(row(`Links report, ALL TIME, ${view}`, s));
  log(`\ndatabase: ${report.database}; the report's fill: ${JSON.stringify(report.fill)} in ${report.fillSeconds} s`);
  log(`verdict: arrivals p95 < ${ARRIVALS_TARGETS.arrivalP95Ms} ms ${verdict.arrivalP95 ? 'yes' : 'NO'}; LIVE passes not slower ${verdict.ticksNotSlower ? 'yes' : 'NO'}; report < ${ARRIVALS_TARGETS.reportMs} ms ${verdict.report ? 'yes' : 'NO'}\n`);
  return { options: o, targets: ARRIVALS_TARGETS, database: `the room: PGlite in its own process; the report: ${report.database}`, without, with: withA, report, verdict };
}

if (process.argv.includes('--arrivals-database')) {
  void databaseProcess(process.argv[process.argv.indexOf('--arrivals-database') + 1]!).catch((e: unknown) => {
    process.stderr.write(`bench arrivals database: ${(e as Error)?.stack ?? String(e)}\n`);
    process.exit(1);
  });
} else if (process.argv.includes('--arrivals-serve')) {
  void serve().catch((e: unknown) => {
    process.stderr.write(`bench arrivals app: ${(e as Error)?.stack ?? String(e)}\n`);
    process.exit(1);
  });
}
