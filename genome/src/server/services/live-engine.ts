/**
 * The engine of the LIVE RELEASES (services/live.ts): one per process, a pass every LIVE_TICK_MS (250 ms) over the
 * releases in their live window, each pass of a release one transaction with its row FOR UPDATE (LiveService.advance:
 * the line at T0, the turns and holds that ran out, the end, the turns).
 *
 * One ticker, even when two processes overlap (a deployment starts the new container before it stops the old one):
 * the process that ticks holds a session-level PostgreSQL advisory lock (ADVISORY_LOCK.LIVE_ENGINE), taken with
 * pg_try_advisory_lock on the connection it ticks on. On PostgreSQL that connection is reserved from the pool while the
 * process leads (`connection: 'reserved'`); the others stand by and try again every LIVE_STANDBY_MS, so a process that
 * stops or dies (its connection closed, the lock released) is replaced within a second. PGlite (development, tests, the
 * demo) has one connection and one process: the lock is taken on it and the passes share it with the requests
 * (`connection: 'shared'`).
 *
 * Restart-safe: the engine keeps nothing in memory. Every pass reads the releases and their entries again, and writes
 * what the clock and the rows call for, at their logical times (a turn MISSED at its deadline, a release CLOSED at its
 * `closes_at`); a release whose pass fails is logged and retried by the next pass, and a leader whose passes keep
 * failing as a whole (its connection lost) hands the lock back and stands by.
 */
import { sql } from 'kysely';
import { ADVISORY_LOCK, type Db } from '../db/connection.js';
import { noopLogger, type Logger } from '../types.js';
import type { LiveAdvance, LiveService } from './live.js';

/** The engine's pass. */
export const LIVE_TICK_MS = 250;
/** How often a process that does not lead tries the lock again. */
export const LIVE_STANDBY_MS = 1000;
/** Consecutive passes failed as a whole (the release list unreadable) after which a leader hands the lock back: its connection is likely gone. */
const MAX_FAILED_PASSES = 4;

export interface LiveEngineDeps {
  db: Db;
  live: LiveService;
  log?: Logger;
  /** 'reserved' on PostgreSQL (the lock and the passes on one connection of the pool); 'shared' on PGlite. */
  connection?: 'reserved' | 'shared';
  tickMs?: number;
  standbyMs?: number;
}

/** One pass: what `advance` did to each release in its live window. */
export interface LiveTick {
  releases: LiveAdvance[];
  /** Releases whose pass failed (logged), retried by the next pass. */
  failed: number;
}

export class LiveEngine {
  private readonly db: Db;
  private readonly live: LiveService;
  private readonly log: Logger;
  private readonly connection: 'reserved' | 'shared';
  private readonly tickMs: number;
  private readonly standbyMs: number;
  private running: Promise<void> | undefined;
  private stopping = false;
  private wake: (() => void) | undefined;
  private leader = false;

  constructor(deps: LiveEngineDeps) {
    this.db = deps.db;
    this.live = deps.live;
    this.log = deps.log ?? noopLogger;
    this.connection = deps.connection ?? 'reserved';
    this.tickMs = deps.tickMs ?? LIVE_TICK_MS;
    this.standbyMs = deps.standbyMs ?? LIVE_STANDBY_MS;
  }

  /** Whether this process holds the lock and ticks. */
  get leading(): boolean {
    return this.leader;
  }

  /** Start the loop (idempotent). */
  start(): void {
    if (this.running) return;
    this.stopping = false;
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
  }

  /** Stop the loop, wait for the pass under way, hand the lock back. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.running;
  }

  /** One pass over the releases in their live window, on `db` (the leader's connection). Errors of a release are logged. */
  async tick(db: Db = this.db): Promise<LiveTick> {
    const out: LiveTick = { releases: [], failed: 0 };
    for (const id of await this.live.liveReleaseIds(db)) {
      try {
        const r = await this.live.advance(id, db);
        if (r) out.releases.push(r);
      } catch (e) {
        out.failed++;
        this.log.error({ dropId: id, err: { message: (e as Error)?.message } }, 'live engine: a release could not advance');
      }
    }
    const moved = out.releases.filter((r) => r.queued || r.missed || r.expired || r.turns || r.ended);
    if (moved.length) this.log.info({ live: moved }, 'live engine');
    return out;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        if (this.connection === 'reserved') await this.db.connection().execute((conn) => this.lead(conn));
        else await this.lead(this.db);
      } catch (e) {
        this.log.error({ err: { message: (e as Error)?.message } }, 'live engine: the lock could not be taken or kept');
      }
      if (!this.stopping) await this.sleep(this.standbyMs);
    }
  }

  /** Take the lock on `db`'s connection; while held, a pass every tickMs until stopped or failing. */
  private async lead(db: Db): Promise<void> {
    const got = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${ADVISORY_LOCK.LIVE_ENGINE}::bigint) AS locked`.execute(db);
    if (!got.rows[0]?.locked) return;
    this.leader = true;
    this.log.info({}, 'live engine: leading');
    let failures = 0;
    try {
      while (!this.stopping && failures < MAX_FAILED_PASSES) {
        const started = Date.now();
        try {
          await this.tick(db);
          failures = 0;
        } catch (e) {
          failures++;
          this.log.error({ err: { message: (e as Error)?.message } }, 'live engine: a pass failed');
        }
        await this.sleep(Math.max(0, this.tickMs - (Date.now() - started)));
      }
    } finally {
      this.leader = false;
      await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK.LIVE_ENGINE}::bigint)`.execute(db).catch(() => {});
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref?.();
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }
}
