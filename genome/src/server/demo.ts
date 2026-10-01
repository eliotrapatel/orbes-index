/**
 * Demo mode (`node --import tsx src/server/index.ts --demo`, or ORBES_DEMO=true):
 * the server starts on an in-memory PGlite database, loads the demo dataset
 * through the real services (src/server/db/seed/demo.ts) and then serves it.
 *
 * - Development and test only: production is refused, and so is any
 *   DATABASE_URL other than `pglite:memory` (a demo must never be seeded into
 *   a database that outlives the process).
 * - Time: the seed replays the catalogue's history on a manual clock that
 *   ends at the real current time; the clock then follows real time, so
 *   sessions, scan tokens and new scans behave normally.
 * - Console access: BOOTSTRAP_ADMIN_* when configured; otherwise a demo ADMIN
 *   (`demo-admin@example.com`) with a random password, returned once.
 */
import { randomBytes } from 'node:crypto';
import type { AppConfig } from './config.js';
import { createContext, type AppContext, type ContextOverrides } from './context.js';
import { DEMO_TIMELINE_START, seedDemo, type DemoSeedResult, type SeedClock } from './db/seed/demo.js';
import { noopLogger, type Clock, type Logger } from './types.js';

export const DEMO_DATABASE_URL = 'pglite:memory';
export const DEMO_ADMIN_EMAIL = 'demo-admin@example.com';

export class DemoModeError extends Error {
  override readonly name = 'DemoModeError';
}

/** A clock the seed drives by hand, then switched to follow real time (`followRealTime`). */
export interface DemoClock extends SeedClock {
  now: Clock;
  followRealTime(): void;
}

export function createDemoClock(start: Date = DEMO_TIMELINE_START, realNow: () => number = Date.now): DemoClock {
  let manual: number | undefined = start.getTime();
  return {
    now: () => new Date(manual ?? realNow()),
    set(d) {
      if (manual === undefined) throw new DemoModeError('the demo clock already follows real time');
      const ms = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d);
      if (!Number.isFinite(ms)) throw new RangeError('invalid clock time');
      manual = ms;
    },
    followRealTime() {
      manual = undefined;
    },
  };
}

/** Why `config` cannot run the demo, or undefined when it can. */
export function demoRefusal(config: Pick<AppConfig, 'env' | 'databaseUrl'>): string | undefined {
  if (config.env === 'production') return 'demo mode is refused in production (ORBES_ENV=production)';
  if (config.databaseUrl !== DEMO_DATABASE_URL) return `demo mode runs on DATABASE_URL=${DEMO_DATABASE_URL} only (the demo dataset must not outlive the process)`;
  return undefined;
}

export interface DemoStart {
  ctx: AppContext;
  seed: DemoSeedResult;
  /** Console sign-in: the configured bootstrap admin, or a demo ADMIN whose password is shown once. */
  admin: { email: string; password?: string };
}

export interface DemoOptions {
  log?: Logger;
  /** Password of every demo account (default: random, returned in `seed.generatedAccountPassword`). */
  accountPassword?: string;
  /** Tests: context overrides (an injected database, a key provider). The clock is always the demo clock. */
  context?: Omit<ContextOverrides, 'clock'>;
  /** Tests: the real-time source the clock follows after seeding. */
  realNow?: () => number;
}

/** Build the context, seed the demo dataset and hand the clock over to real time. */
export async function startDemo(config: AppConfig, opts: DemoOptions = {}): Promise<DemoStart> {
  const refusal = demoRefusal(config);
  if (refusal) throw new DemoModeError(refusal);
  const log = opts.log ?? noopLogger;
  const realNow = opts.realNow ?? Date.now;
  const clock = createDemoClock(DEMO_TIMELINE_START, realNow);
  // The stories deliberately trigger suspicious scans: their service warnings are noise here.
  const quiet: Logger = { info: () => {}, warn: () => {}, error: log.error };
  const ctx = await createContext(config, { log: quiet, ...opts.context, clock: clock.now });
  try {
    const seed = await seedDemo(ctx, {
      clock,
      now: new Date(realNow()),
      ...(opts.accountPassword ? { accountPassword: opts.accountPassword } : {}),
      log: quiet,
    });
    clock.followRealTime();

    let admin: DemoStart['admin'];
    if (config.bootstrapAdmin) {
      admin = { email: config.bootstrapAdmin.email };
    } else {
      const password = randomBytes(18).toString('base64url');
      await ctx.services.auth.createAdmin({ email: DEMO_ADMIN_EMAIL, password, role: 'ADMIN' }, { type: 'system', id: 'demo' });
      admin = { email: DEMO_ADMIN_EMAIL, password };
    }
    log.info({ products: seed.products, scans: seed.scans, anomalies: seed.anomalies.open }, 'demo dataset loaded');
    return { ctx, seed, admin };
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
}

/** Human-readable summary for the terminal (demo secrets are shown once, here). */
export function demoBanner(d: DemoStart, origin: string): string {
  const lines = [
    '',
    `ORBES demo: ${d.seed.products} products, ${d.seed.accounts.length} accounts, ${d.seed.scans} scans, ${d.seed.anomalies.open} open anomalies (in memory, lost on exit).`,
    `  Verify app:    ${origin}/verify`,
    `  Admin console: ${origin}/admin  —  ${d.admin.email}${d.admin.password ? `  /  ${d.admin.password}` : ' (BOOTSTRAP_ADMIN_PASSWORD)'}`,
  ];
  if (d.seed.generatedAccountPassword) lines.push(`  Demo accounts: ${d.seed.accounts.map((a) => a.email).join(', ')}  /  ${d.seed.generatedAccountPassword}`);
  const first = d.seed.claimCodes.find((c) => c.registrable);
  if (first) lines.push(`  ${first.productId} scans as AUTHENTIC — FIRST REGISTRATION; claim code ${first.claimCode}`);
  lines.push('');
  return lines.join('\n');
}
