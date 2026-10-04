/**
 * Server entry point: `npm start` / `npm run dev`.
 *
 *   1. load and validate the configuration (fail fast, all problems at once);
 *   2. build the context (database, migrations, services, bootstrap admin);
 *   3. build the Fastify app, start housekeeping and the LIVE RELEASES'
 *      engine (services/live-engine.ts), listen;
 *   4. on SIGTERM/SIGINT: stop accepting connections, let in-flight requests
 *      finish (bounded by SHUTDOWN_GRACE_MS), stop the engine (its lock goes
 *      back to the next process) and housekeeping, close the database, exit.
 *      An unhandled error triggers the same shutdown with exit code 1 so the
 *      orchestrator restarts a clean process.
 *
 * Migrations run automatically outside production. In production they run
 * only with `--migrate` or MIGRATE_ON_START=true (otherwise the server
 * refuses to start on a schema with pending migrations).
 *
 * `--demo` (or ORBES_DEMO=true; development/test only, DATABASE_URL must be
 * pglite:memory): load the demo dataset at start, then serve it (demo.ts).
 * Settings that are accepted but risky (configWarnings) are logged as warnings.
 *
 * The startup log carries a redacted configuration summary: no secrets, no
 * anomaly thresholds, the database password masked.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { ConfigError, configWarnings, loadConfig, redactConfig, type AppConfig } from './config.js';
import { createContext, startHousekeeping, startLiveEngine, type AppContext, type Housekeeping } from './context.js';
import type { LiveEngine } from './services/live-engine.js';
import { demoBanner, demoRefusal, startDemo, type DemoStart } from './demo.js';
import { createForwardingLogger, loggerOptions } from './http/logging.js';
import { APP_VERSION } from './routes/public.js';

const SHUTDOWN_GRACE_MS = 25_000;

const log = createForwardingLogger();
let app: FastifyInstance | undefined;
let ctx: AppContext | undefined;
let housekeeping: Housekeeping | undefined;
let liveEngine: LiveEngine | undefined;
let shuttingDown = false;

function flag(name: string, env: string | undefined): boolean {
  return process.argv.includes(`--${name}`) || /^(1|true|yes)$/i.test(env ?? '');
}

function errFields(e: unknown): { name?: string; message: string } {
  return e instanceof Error ? { name: e.name, message: e.message } : { message: String(e) };
}

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, 'shutting down');
  const force = setTimeout(() => {
    log.error({}, 'graceful shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  try {
    await app?.close(); // stops accepting, answers 503 to new requests, waits for in-flight ones
    await liveEngine?.stop(); // the pass under way finishes, the engine's lock goes back
    await housekeeping?.stop();
    await ctx?.close();
    log.info({}, 'shutdown complete');
  } catch (e) {
    log.error({ err: errFields(e) }, 'error during shutdown');
    exitCode = 1;
  }
  process.exit(exitCode);
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      // Messages name variables and rules, never values.
      process.stderr.write(`${e.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const config = loadConfigOrExit();
  const demoMode = flag('demo', process.env.ORBES_DEMO);
  if (demoMode && demoRefusal(config)) {
    process.stderr.write(`--demo: ${demoRefusal(config)}\n`);
    process.exit(78); // EX_CONFIG
  }
  try {
    let demo: DemoStart | undefined;
    if (demoMode) {
      demo = await startDemo(config, { log });
      ctx = demo.ctx;
    } else {
      ctx = await createContext(config, {
        log,
        ...(config.env === 'production' ? { migrate: config.migrateOnStart || process.argv.includes('--migrate') } : {}),
      });
    }
    app = await buildApp(ctx, { serveStatic: true, logger: loggerOptions(config) });
    log.attach(app.log);
    for (const warning of configWarnings(config)) log.warn({ warning }, 'risky configuration');
    housekeeping = startHousekeeping(ctx);
    liveEngine = startLiveEngine(ctx);
    await app.listen({ host: config.host, port: config.port });
    log.info({ version: APP_VERSION, demo: demoMode, config: redactConfig(config) }, 'ORBES GENOME server started');
    if (demo) process.stdout.write(demoBanner(demo, config.publicOrigin));
  } catch (e) {
    log.error({ err: errFields(e) }, 'startup failed');
    await shutdown('startup failed', 1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('unhandledRejection', (reason) => {
  log.error({ err: errFields(reason) }, 'unhandled rejection');
  void shutdown('unhandled rejection', 1);
});
process.on('uncaughtException', (e) => {
  log.error({ err: errFields(e) }, 'uncaught exception');
  void shutdown('uncaught exception', 1);
});

void main();
