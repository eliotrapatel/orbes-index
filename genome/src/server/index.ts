/**
 * Server entry point: `npm start` / `npm run dev`.
 *
 *   1. load and validate the configuration (fail fast, all problems at once);
 *   2. build the context (database, migrations, services, bootstrap admin);
 *   3. build the Fastify app and listen;
 *   4. on SIGTERM/SIGINT: stop accepting connections, let in-flight requests
 *      finish (bounded), stop housekeeping, close the database, exit.
 *
 * Migrations run automatically outside production. In production they run
 * only with `--migrate` or MIGRATE_ON_START=true (otherwise the server
 * refuses to start on a schema with pending migrations).
 *
 * The startup log carries a redacted configuration summary: no secrets, no
 * anomaly thresholds, the database password masked.
 */
import { buildApp } from './app.js';
import { ConfigError, loadConfig, redactConfig } from './config.js';
import { createContext, startHousekeeping, type AppContext, type Housekeeping } from './context.js';
import { createForwardingLogger, loggerOptions } from './http/logging.js';
import { APP_VERSION } from './routes/public.js';

const SHUTDOWN_GRACE_MS = 25_000;

function flag(name: string, env: string | undefined): boolean {
  return process.argv.includes(`--${name}`) || /^(1|true|yes)$/i.test(env ?? '');
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      // Messages name variables and rules, never values.
      process.stderr.write(`${e.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw e;
  }

  const log = createForwardingLogger();
  let ctx: AppContext | undefined;
  let housekeeping: Housekeeping | undefined;
  try {
    ctx = await createContext(config, {
      log,
      ...(config.env === 'production' ? { migrate: flag('migrate', process.env.MIGRATE_ON_START) } : {}),
    });
    const app = await buildApp(ctx, { serveStatic: true, logger: loggerOptions(config, process.env.LOG_LEVEL) });
    log.attach(app.log);
    housekeeping = startHousekeeping(ctx);

    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'shutting down');
      const force = setTimeout(() => {
        app.log.error({}, 'graceful shutdown timed out; exiting');
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);
      force.unref();
      void (async () => {
        try {
          await app.close();
          await housekeeping?.stop();
          await ctx?.close();
          app.log.info({}, 'shutdown complete');
          process.exit(0);
        } catch (e) {
          app.log.error({ err: { message: (e as Error)?.message } }, 'error during shutdown');
          process.exit(1);
        }
      })();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    await app.listen({ host: config.host, port: config.port });
    app.log.info({ version: APP_VERSION, config: redactConfig(config) }, 'ORBES GENOME server started');
  } catch (e) {
    log.error({ err: { name: (e as Error)?.name, message: (e as Error)?.message } }, 'startup failed');
    await housekeeping?.stop().catch(() => {});
    await ctx?.close().catch(() => {});
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'unhandled rejection', err: String((reason as Error)?.message ?? reason) })}\n`);
});

void main();
