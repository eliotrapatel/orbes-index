/**
 * The platform reset's own shutdown path (lot PURGE, plan §B.4, M1, H4, H13; B4.sd1-5, B4.fail): the normal shutdown
 * (index.ts `shutdown`) cannot host the reset (it is bounded by 25 s, closes the database at its end, and a request that
 * waited for it would wait for itself), so the reset has this one, installed by index.ts as `ctx.lifecycle`.
 *
 *   requestPlatformReset   called by POST /api/admin/platform-reset once its 202 is sent (the route's onResponse). It
 *                          only SCHEDULES `platformResetShutdown` on a later tick (`setImmediate`) and returns at once:
 *                          neither the route, its hook nor this lifecycle ever awaits the shutdown (H4: `app.close()`
 *                          waits for the requests in flight). A second call while one is scheduled or running, or while
 *                          the process is already shutting down, is a logged no-op.
 *
 *   platformResetShutdown  under one force timer of 180 s (exit 1), in this order:
 *                          1. `app.close()`: every request now answers 503 (app.ts's gate, /health included); the TEST
 *                             ENTRANTS' bots stop (its preClose); it resolves once the 202's request has finished;
 *                          2. the LIVE engine (its lock goes back), housekeeping, the test purge's loop, the receptions'
 *                             worker, the emails', the house messages' and the ad events' senders stopped;
 *                          3. the views still in memory written (`tracking.stop()`), BEFORE the wipe;
 *                          4. the MAIN POOL CLOSED: no connection of this process is left (H13);
 *                          5. ONE dedicated connection opened (the same database, a pool of exactly one connection);
 *                          6. `ctx.services.platformReset.run(...)` on it: the database refuses any other client backend,
 *                             whatever its name (migration 0067 §B.2 d 4); on a failure run() has rolled back, cleared the
 *                             authorization and audited `platform.reset.failed`;
 *                          7. that connection closed; exit 0 (reset) or 1 (refused or failed). Docker restarts the app
 *                             (compose.yaml `restart: unless-stopped`); the boot re-creates what a first boot makes.
 *                          A step before the reset that fails stops the path there: no reset, the authorization
 *                          cleared and `platform.reset.failed { reason: 'SHUTDOWN <step>' }` audited (on the main pool
 *                          while it has not begun to close, otherwise on a dedicated connection), exit 1.
 *
 * Every dependency is injected (index.ts gives the real ones), so the order, the 503 and the failures are tested with
 * fakes and on a real app (test/server/platform-reset-shutdown.test.ts).
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext, AppLifecycle } from './context.js';
import type { Db } from './db/connection.js';
import type { Logger } from './types.js';

/** The force timer of the reset's shutdown: past it, the process exits 1 whatever it is doing. */
export const PLATFORM_RESET_FORCE_MS = 180_000;

export interface PlatformResetShutdownDeps {
  /** The running app (index.ts's, once listening). */
  app: () => FastifyInstance | undefined;
  ctx: AppContext;
  liveEngine: () => { stop(): Promise<void> } | undefined;
  housekeeping: () => { stop(): Promise<void> } | undefined;
  log: Logger;
  /** Takes the process's one shutdown (index.ts's `shuttingDown`): false when another shutdown already runs. */
  claim(): boolean;
  /** Closes the main pool (index.ts: closeDb(ctx.db)). */
  closeMainPool(): Promise<void>;
  /** Opens the one dedicated connection (index.ts: createDb(DATABASE_URL, { poolMax: 1 })). */
  openConnection(): Db;
  closeConnection(conn: Db): Promise<void>;
  exit(code: number): void;
  /** Tests: the force timer's length (default PLATFORM_RESET_FORCE_MS). */
  forceMs?: number;
  /** Tests: the reset run (default ctx.services.platformReset.run). */
  run?: (adminId: string, collectorsSeen: number, collectorsSeenUntil: string | null, conn: Db) => Promise<unknown>;
  /** Tests: how the shutdown is scheduled (default setImmediate). */
  schedule?: (fn: () => void) => void;
}

function errFields(e: unknown): { name?: string; message: string; code?: string } {
  const code = (e as { code?: unknown })?.code;
  return e instanceof Error ? { name: e.name, message: e.message, ...(typeof code === 'string' ? { code } : {}) } : { message: String(e) };
}

/**
 * The reset's shutdown path, steps 1 to 7 (see the header). Resolves after `exit` was called (the real one never
 * returns). Never throws.
 */
export async function platformResetShutdown(deps: PlatformResetShutdownDeps, adminId: string, collectorsSeen: number, collectorsSeenUntil: string | null): Promise<void> {
  const { ctx, log } = deps;
  const force = setTimeout(() => {
    log.error({}, 'platform reset: the restart did not finish in time; exiting');
    deps.exit(1);
  }, deps.forceMs ?? PLATFORM_RESET_FORCE_MS);
  force.unref();
  let step = 'app.close';
  let poolClosed = false;
  let conn: Db | undefined;
  let code = 1;
  log.warn({ adminId }, 'platform reset: the platform stops, resets and restarts');
  try {
    // 1. Nobody else in: 503 for every request, the test entrants' bots stopped, the 202's request finished.
    await deps.app()?.close();
    // 2. Every engine and sender stopped.
    step = 'liveEngine.stop';
    await deps.liveEngine()?.stop();
    step = 'housekeeping.stop';
    await deps.housekeeping()?.stop();
    step = 'testPurge.stop';
    await ctx.services.testPurge.stop();
    step = 'receptions.stop';
    await ctx.services.receptions.stop();
    step = 'email.stop';
    await ctx.services.email.stop();
    step = 'houseSender.stop';
    await ctx.services.houseSender.stop();
    step = 'ads.stop';
    await ctx.services.ads.stop();
    // 3. The views still in memory written before the wipe.
    step = 'tracking.stop';
    await ctx.services.tracking.stop();
    // 4. The main pool closed: no connection of this process left (the reset refuses any other one).
    step = 'closeMainPool';
    poolClosed = true; // from here the main pool is not used again, even if its close fails half way
    await deps.closeMainPool();
    // 5. One dedicated connection.
    step = 'openConnection';
    conn = deps.openConnection();
  } catch (e) {
    log.error({ step, err: errFields(e) }, 'platform reset: the restart stopped before the reset; nothing is reset');
    try {
      conn ??= poolClosed ? deps.openConnection() : undefined;
    } catch (e2) {
      log.error({ err: errFields(e2) }, 'platform reset: no connection to record the failure');
    }
    const on = conn ?? (poolClosed ? undefined : ctx.db);
    if (on) await ctx.services.platformReset.abandon(adminId, `SHUTDOWN ${step}`, on);
    if (conn) await deps.closeConnection(conn).catch((e3) => log.error({ err: errFields(e3) }, 'platform reset: closing its connection failed'));
    clearTimeout(force);
    deps.exit(1);
    return;
  }
  // 6. The reset, on that connection only.
  try {
    const run = deps.run ?? ((a, s, u, c) => ctx.services.platformReset.run(a, s, u, c));
    await run(adminId, collectorsSeen, collectorsSeenUntil, conn);
    code = 0;
    log.warn({ adminId }, 'platform reset done: entry 1 of the new audit chain written; restarting');
  } catch (e) {
    log.error({ err: errFields(e) }, 'platform reset refused or failed: nothing changed; restarting');
  }
  // 7. The connection closed, then exit (Docker restarts the app).
  await deps.closeConnection(conn).catch((e) => log.error({ err: errFields(e) }, 'platform reset: closing its connection failed'));
  clearTimeout(force);
  deps.exit(code);
}

/**
 * The lifecycle index.ts installs: `requestPlatformReset` schedules `platformResetShutdown` on a later tick and returns
 * at once (H4); a second call, or a call while the process already shuts down, is a logged no-op.
 */
export function platformResetLifecycle(deps: PlatformResetShutdownDeps): AppLifecycle {
  let requested = false;
  const schedule = deps.schedule ?? ((fn: () => void) => void setImmediate(fn));
  return {
    requestPlatformReset(adminId, collectorsSeen, collectorsSeenUntil) {
      if (requested) {
        deps.log.warn({ adminId }, 'platform reset already requested: this request changes nothing');
        return;
      }
      requested = true;
      schedule(() => {
        if (!deps.claim()) {
          deps.log.warn({ adminId }, 'platform reset requested while the process shuts down: nothing is reset (the authorization expires in 5 minutes)');
          return;
        }
        void platformResetShutdown(deps, adminId, collectorsSeen, collectorsSeenUntil);
      });
    },
  };
}
