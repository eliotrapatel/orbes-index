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
 *       (scripts/acquisition-fill.ts: 1,000 visits a day, ≈ 396,000 visits, 39,600 accounts, 77,700 conversions, the
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
  const { fillAcquisition } = await import('./acquisition-fill.js');
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
    // The fill's last day is today (Paris): its visits stay raw, every day before is summarised.
    const end = new Date();
    if (end.getUTCHours() < 8) end.setUTCHours(8, 0, 0, 0);
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
