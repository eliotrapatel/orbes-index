/**
 * The platform reset's shutdown path (lot PURGE, step PURGE.10; plan §B.4, M1, H4, H13; B4.sd1-5, B4.fail;
 * src/server/platform-reset-shutdown.ts).
 *
 *  - With fakes: the order of the stops (the app closed first, then the LIVE engine, housekeeping, the test purge's
 *    loop, the receptions' worker, the emails', the house messages' and the ad events' senders, then the views
 *    written), the MAIN POOL CLOSED BEFORE the reset, the reset given the one dedicated connection opened after it
 *    (never the main pool), that connection closed, exit 0; a reset that fails: exit 1, its connection still closed; a
 *    step before the reset that fails: no reset, exit 1; the lifecycle schedules once and never twice.
 *  - With the real service on PGlite: a run refused by the database leaves the authorization cleared and
 *    `platform.reset.failed` audited, exit 1; a stop that fails before the reset clears it and audits
 *    `SHUTDOWN <step>`, exit 1, no reset.
 *  - ONE test on a REAL app listening on a port (H4): createContext and buildApp on PGlite with the real route and the
 *    real lifecycle, only the reset's run(), the pool's close and the process's exit faked: POST
 *    /api/admin/platform-reset gets its 202, `app.close()` then resolves (the 202's request is not waiting for the
 *    shutdown) well before the force timer, a request made meanwhile gets 503, and run() is reached exactly once.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { base32Decode, totp } from '../../src/server/crypto/totp.js';
import { createDbFromPGlite, type Db } from '../../src/server/db/connection.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { platformResetLifecycle, platformResetShutdown, PLATFORM_RESET_FORCE_MS, type PlatformResetShutdownDeps } from '../../src/server/platform-reset-shutdown.js';
import { RESET_PHRASE, type PlatformResetPreview } from '../../src/server/services/platform-reset.js';
import { createManualClock, SYSTEM_ACTOR, type Logger, type ManualClock } from '../../src/server/types.js';
import { Client, ORIGIN, safeJson } from '../api/support.js';
import { createTestDb, type TestDb } from '../support/db.js';

const SECOND = 1000;
const HOUR = 3_600_000;
const PASSWORD = 'correct horse battery staple';
const WINDOWS_OPEN = `CREATE OR REPLACE FUNCTION orbes_maintenance_window(p_at timestamptz) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT NULL::text $$`;

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// ── With fakes ─────────────────────────────────────────────────────────────

/** A context whose every stop is recorded, a main pool and a dedicated connection that are mere markers. */
function fakes(opts: { failAt?: string; runFails?: boolean } = {}) {
  const order: string[] = [];
  const mainPool = { name: 'main pool' } as unknown as Db;
  const dedicated = { name: 'dedicated connection' } as unknown as Db;
  const step = (name: string) => ({
    stop: async () => {
      order.push(name);
      if (opts.failAt === name) throw new Error(`${name} failed`);
    },
  });
  const abandoned: { adminId: string; reason: string; on: Db }[] = [];
  const ctx = {
    db: mainPool,
    services: {
      testPurge: step('testPurge.stop'),
      receptions: step('receptions.stop'),
      email: step('email.stop'),
      houseSender: step('houseSender.stop'),
      ads: step('ads.stop'),
      tracking: step('tracking.stop'),
      platformReset: { abandon: async (adminId: string, reason: string, on: Db) => void abandoned.push({ adminId, reason, on }) },
    },
  } as unknown as AppContext;
  const exits: number[] = [];
  const runs: unknown[][] = [];
  const deps: PlatformResetShutdownDeps = {
    app: () => ({ close: async () => void order.push('app.close') }) as unknown as FastifyInstance,
    ctx,
    liveEngine: () => step('liveEngine.stop'),
    housekeeping: () => step('housekeeping.stop'),
    log: quiet,
    claim: () => true,
    closeMainPool: async () => {
      order.push('main pool closed');
      if (opts.failAt === 'closeMainPool') throw new Error('close failed');
    },
    openConnection: () => {
      order.push('dedicated connection opened');
      return dedicated;
    },
    closeConnection: async (conn) => void order.push(conn === dedicated ? 'dedicated connection closed' : 'another connection closed'),
    exit: (code) => void exits.push(code),
    run: async (...args) => {
      order.push('run');
      runs.push(args);
      if (opts.runFails) throw Object.assign(new Error('RESET_COLLECTORS_CHANGED'), { code: 'OR011' });
    },
  };
  return { deps, order, exits, runs, abandoned, mainPool, dedicated };
}

const STOPS = ['app.close', 'liveEngine.stop', 'housekeeping.stop', 'testPurge.stop', 'receptions.stop', 'email.stop', 'houseSender.stop', 'ads.stop', 'tracking.stop'];

describe('the platform reset shutdown, with fakes', () => {
  it('stops everything in order, closes the main pool BEFORE the reset, runs it on the one dedicated connection, exits 0', async () => {
    const f = fakes();
    await platformResetShutdown(f.deps, 'holder-id', 3, '2026-10-28T10:00:00.123456Z');
    expect(f.order).toEqual([...STOPS, 'main pool closed', 'dedicated connection opened', 'run', 'dedicated connection closed']);
    expect(f.runs).toEqual([['holder-id', 3, '2026-10-28T10:00:00.123456Z', f.dedicated]]);
    expect(f.runs[0]![3]).not.toBe(f.mainPool);
    expect(f.exits).toEqual([0]);
    expect(f.abandoned).toEqual([]);
    expect(PLATFORM_RESET_FORCE_MS).toBe(180_000);
  });

  it('a reset that fails exits 1, its connection closed all the same', async () => {
    const f = fakes({ runFails: true });
    await platformResetShutdown(f.deps, 'holder-id', 0, null);
    expect(f.order).toEqual([...STOPS, 'main pool closed', 'dedicated connection opened', 'run', 'dedicated connection closed']);
    expect(f.exits).toEqual([1]);
  });

  it('a stop that fails before the reset stops the path: no reset, the failure recorded, exit 1', async () => {
    const early = fakes({ failAt: 'tracking.stop' });
    await platformResetShutdown(early.deps, 'holder-id', 0, null);
    expect(early.order).toEqual(STOPS);
    expect(early.runs).toEqual([]);
    expect(early.exits).toEqual([1]);
    // The main pool still open: the failure is recorded through it.
    expect(early.abandoned).toEqual([{ adminId: 'holder-id', reason: 'SHUTDOWN tracking.stop', on: early.mainPool }]);

    const late = fakes({ failAt: 'closeMainPool' });
    await platformResetShutdown(late.deps, 'holder-id', 0, null);
    expect(late.runs).toEqual([]);
    expect(late.exits).toEqual([1]);
    // The pool may be half closed: the failure is recorded on a dedicated connection, closed after.
    expect(late.abandoned).toEqual([{ adminId: 'holder-id', reason: 'SHUTDOWN closeMainPool', on: late.dedicated }]);
    expect(late.order.slice(-2)).toEqual(['dedicated connection opened', 'dedicated connection closed']);
  });

  it('the lifecycle only schedules the shutdown, once; a second request, or one while the process shuts down, changes nothing', async () => {
    const f = fakes();
    const scheduled: (() => void)[] = [];
    const warned: string[] = [];
    let claimed = false;
    const lifecycle = platformResetLifecycle({
      ...f.deps,
      log: { ...quiet, warn: (_o: unknown, m?: string) => void warned.push(String(m)) } as Logger,
      claim: () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      schedule: (fn) => void scheduled.push(fn),
    });
    lifecycle.requestPlatformReset('holder-id', 1, null);
    expect(f.order).toEqual([]); // nothing ran in the caller's tick
    lifecycle.requestPlatformReset('holder-id', 1, null);
    expect(scheduled).toHaveLength(1);
    expect(warned).toEqual(['platform reset already requested: this request changes nothing']);
    scheduled[0]!();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 10));
    expect(f.runs).toHaveLength(1);
    expect(f.exits).toEqual([0]);

    // The process already shutting down (SIGTERM first): the scheduled reset does nothing.
    const g = fakes();
    const pending: (() => void)[] = [];
    const busy = platformResetLifecycle({ ...g.deps, claim: () => false, schedule: (fn) => void pending.push(fn) });
    busy.requestPlatformReset('holder-id', 1, null);
    pending[0]!();
    await new Promise((r) => setTimeout(r, 10));
    expect(g.order).toEqual([]);
    expect(g.exits).toEqual([]);
  });
});

// ── With the real service, and a real app ─────────────────────────────────

interface Holder {
  id: string;
  email: string;
  key: Uint8Array;
}

describe('the platform reset shutdown, on PGlite', () => {
  let t: TestDb;
  let db: Db;
  let clock: ManualClock;
  let ctx: AppContext;
  let app: FastifyInstance;
  let holder: Holder;

  const code = (s: Holder) => {
    clock.advance(30 * SECOND);
    return totp(s.key, clock.now().getTime());
  };
  const gateRow = async () => (await sql<Record<string, any>>`SELECT * FROM platform_reset_gate`.execute(db)).rows[0]!;
  const session = async () => (await ctx.services.auth.adminLogin({ email: holder.email, password: PASSWORD, totp: code(holder) }, {})).session.token;
  const collector = (name: string) =>
    ctx.services.auth.registerAccount({ email: `p10s.${name}.${randomUUID().slice(0, 6)}@example.com`, password: PASSWORD, firstName: 'Noé', lastName: 'Bernard', country: 'FR' });

  /** The holder's press through the service: the authorization written. */
  async function pressed(): Promise<PlatformResetPreview> {
    const p = await ctx.services.platformReset.preview(holder.id);
    const token = await session();
    await ctx.services.platformReset.request(
      { phrase: RESET_PHRASE, password: PASSWORD, totp: code(holder), collectorsSeen: p.collectorsSeen, collectorsSeenUntil: p.collectorsSeenUntil },
      { actor: { type: 'admin', id: holder.id }, token },
      {},
    );
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset' });
    return p;
  }

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    clock = createManualClock(Date.now() - 30 * HOUR);
    ctx = await createContext(testConfig({ publicOrigin: ORIGIN }), { db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    app = await buildApp(ctx, { serveStatic: false });
    await sql.raw(WINDOWS_OPEN).execute(db);
    const email = `p10s.holder.${randomUUID().slice(0, 6)}@example.com`;
    const a = await ctx.services.auth.createAdmin({ email, password: PASSWORD, role: 'ADMIN' }, SYSTEM_ACTOR);
    const { secret } = await ctx.services.auth.createTotpEnrollment(a.id);
    holder = { id: a.id, email, key: base32Decode(secret) };
    await ctx.services.auth.enableTotp(a.id, { secret, code: code(holder) }, { type: 'admin', id: a.id });
    await sql.raw(`UPDATE platform_reset_gate SET holder_admin_id = '${holder.id}'`).execute(db);
    await collector('one');
    clock.set(Date.now());
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await ctx?.close();
    await t?.close();
  });

  /** The real shutdown's dependencies on this test's database: the main pool's close and the exit faked. */
  function realDeps(exits: number[], extra: Partial<PlatformResetShutdownDeps> = {}): PlatformResetShutdownDeps {
    return {
      app: () => undefined,
      ctx,
      liveEngine: () => undefined,
      housekeeping: () => undefined,
      log: quiet,
      claim: () => true,
      // PGlite has one connection, which the test keeps: "closed" here, and a second handle on it is the dedicated one.
      closeMainPool: async () => {},
      openConnection: () => createDbFromPGlite(t.pglite),
      closeConnection: async () => {},
      exit: (c) => void exits.push(c),
      ...extra,
    };
  }

  it('a reset the database refuses: rolled back, its authorization cleared, platform.reset.failed audited, exit 1', async () => {
    const p = await pressed();
    await collector('after-the-press');
    const accounts = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM accounts`.execute(db)).rows[0]!.n);
    const exits: number[] = [];
    await platformResetShutdown(realDeps(exits), holder.id, p.collectorsSeen, p.collectorsSeenUntil);
    expect(exits).toEqual([1]);
    expect(await gateRow()).toMatchObject({ authorized_by: null, authorized_at: null, authorized_purpose: null, resets: 0, last_reset_at: null });
    const last = (await sql<{ action: string; details: Record<string, unknown> }>`SELECT action, details FROM audit_logs ORDER BY id DESC LIMIT 1`.execute(db)).rows[0];
    expect(last).toEqual({ action: 'platform.reset.failed', details: { reason: 'RESET_COLLECTORS_CHANGED' } });
    expect(Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM accounts`.execute(db)).rows[0]!.n)).toBe(accounts);
    expect((await ctx.audit.verifyChain()).ok).toBe(true);
  });

  it('a stop that fails before the reset: no reset, the authorization cleared, SHUTDOWN <step> audited, exit 1', async () => {
    await pressed();
    const exits: number[] = [];
    let ran = 0;
    const tracking = ctx.services.tracking.stop;
    ctx.services.tracking.stop = async () => {
      throw new Error('disk full');
    };
    try {
      await platformResetShutdown(realDeps(exits, { run: async () => void ran++ }), holder.id, 0, null);
    } finally {
      ctx.services.tracking.stop = tracking;
    }
    expect(ran).toBe(0);
    expect(exits).toEqual([1]);
    expect(await gateRow()).toMatchObject({ authorized_by: null, resets: 0 });
    const last = (await sql<{ action: string; details: Record<string, unknown> }>`SELECT action, details FROM audit_logs ORDER BY id DESC LIMIT 1`.execute(db)).rows[0];
    expect(last).toEqual({ action: 'platform.reset.failed', details: { reason: 'SHUTDOWN tracking.stop' } });
  });

  it('on a real app listening on a port (H4): the 202, then app.close() resolves well before the force timer, a request meanwhile gets 503, run() once', async () => {
    const c = new Client(app);
    const login = await c.post('/api/admin/auth/login', { email: holder.email, password: PASSWORD, totp: code(holder) });
    expect(login.statusCode, login.body).toBe(200);
    const page = safeJson(await c.get('/api/admin/platform-reset')) as { holder: boolean; preview: PlatformResetPreview };
    expect(page.holder).toBe(true);

    // The real lifecycle; only the run, the pool's close and the exit are faked.
    const runs: unknown[][] = [];
    const exits: number[] = [];
    const exited = deferred();
    const dedicated = createDbFromPGlite(t.pglite);
    let closeStarted = 0;
    let closeResolved = 0;
    ctx.lifecycle = platformResetLifecycle({
      ...realDeps(exits),
      app: () =>
        ({
          close: async () => {
            closeStarted = Date.now();
            await app.close();
            closeResolved = Date.now();
          },
        }) as unknown as FastifyInstance,
      openConnection: () => dedicated,
      run: async (...args) => void runs.push(args),
      exit: (code) => {
        exits.push(code);
        exited.resolve();
      },
    });
    // Hold app.close() inside its preClose hooks (the test entrants' close), once the 503 gate is up.
    const closing = deferred();
    const hold = deferred();
    const entrantsClose = app.testEntrants.close.bind(app.testEntrants);
    app.testEntrants.close = async () => {
      closing.resolve();
      await hold.promise;
      await entrantsClose();
    };

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const headers = {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-csrf-token': c.csrf!,
      cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    };
    const body = () => JSON.stringify({ phrase: RESET_PHRASE, password: PASSWORD, totp: code(holder), collectorsSeen: page.preview.collectorsSeen, collectorsSeenUntil: page.preview.collectorsSeenUntil });

    const res = await fetch(`${base}/api/admin/platform-reset`, { method: 'POST', headers, body: body() });
    expect(res.status, await res.clone().text()).toBe(202);
    expect(await res.json()).toEqual({ restartsIn: 'about a minute' });

    // The shutdown started on a later tick: app.close() is under way, every request now answers 503.
    await closing.promise;
    expect(closeStarted).toBeGreaterThan(0);
    const again = await fetch(`${base}/api/admin/platform-reset`, { method: 'POST', headers, body: body() });
    expect(again.status).toBe(503);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('SERVICE_UNAVAILABLE');
    const health = await fetch(`${base}/api/v1/health`);
    expect(health.status).toBe(503);
    await health.arrayBuffer();
    expect(runs).toEqual([]);

    const released = Date.now();
    hold.resolve();
    await exited.promise;
    expect(closeResolved).toBeGreaterThan(0);
    expect(closeResolved - released).toBeLessThan(5_000);
    expect(exits).toEqual([0]);
    expect(runs).toEqual([[holder.id, page.preview.collectorsSeen, page.preview.collectorsSeenUntil, dedicated]]);
    // A second call (as the second request would have made) changes nothing.
    ctx.lifecycle.requestPlatformReset(holder.id, 0, null);
    await new Promise((r) => setTimeout(r, 20));
    expect(runs).toHaveLength(1);
    expect(exits).toEqual([0]);
    // The authorization was written by the press (the faked run never used it).
    expect(await gateRow()).toMatchObject({ authorized_by: holder.id, authorized_purpose: 'platform.reset' });
  }, 30_000);
});
