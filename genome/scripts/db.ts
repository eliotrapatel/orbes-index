/**
 * Database operations: schema migrations and the demo dataset.
 *
 *   npm run db:migrate                     apply pending migrations (safe in production)
 *   npm run db:seed                        load the demo dataset into an empty database
 *   tsx scripts/db.ts status               list migrations and when each was applied
 *   tsx scripts/db.ts reset-demo --yes     drop every ORBES table, migrate, load the demo dataset
 *
 * Options: --json (machine-readable output), --verbose (service logs on stderr),
 * --force (reset-demo: also wipe a database holding non-demo products), --help.
 *
 * Configuration is the server's own (DATABASE_URL, KEY_PROVIDER, KEY_DIR, …;
 * see .env.example), validated by loadConfig(). The demo commands also read
 * DEMO_ACCOUNT_PASSWORD (password of every demo account; when unset a random
 * one is generated and printed once).
 *
 * Safety: `seed` and `reset-demo` refuse ORBES_ENV=production outright, `seed`
 * only loads into a database without products, and `reset-demo` needs --yes
 * (and --force when the database holds products that are not the demo's).
 *
 * Exit codes: 0 success, 1 failure, 2 usage error, 78 configuration error.
 *
 * The helpers at the bottom (CliIO, loadCliConfig, cliActor, isMainModule)
 * are shared with scripts/keys.ts and scripts/export-demo-codes.ts.
 */
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { ConfigError, loadConfig, type AppConfig } from '../src/server/config.js';
import { createContext } from '../src/server/context.js';
import { closeDb, createDb, type Db } from '../src/server/db/connection.js';
import { migrateDown, migrateToLatest, migrationStatus } from '../src/server/db/migrate.js';
import {
  DEMO_FIRST_REGISTRATION_PRODUCT_ID,
  DEMO_TIMELINE_START,
  demoSeedStatus,
  seedDemo,
  type DemoSeedResult,
} from '../src/server/db/seed/demo.js';
import { PRODUCT_STATUSES } from '../src/server/db/schema.js';
import { parseDatabaseUrl, redactDatabaseUrl } from '../src/server/db/url.js';
import { createKeyProvider, type KeyProvider } from '../src/server/keys/index.js';
import { createManualClock, type Actor, type Logger } from '../src/server/types.js';

// ── Shared CLI plumbing ────────────────────────────────────────────────────

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

export const consoleIO: CliIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/** Injection points for tests; production use passes nothing. */
export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  io?: CliIO;
  /** Use this database instead of opening DATABASE_URL (left open). */
  db?: Db;
  /** Use this key custody provider instead of the configured one. */
  keyProvider?: KeyProvider;
  /** Current time (the end of the demo timeline). */
  now?: () => Date;
}

export const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 2, CONFIG: 78 });

/** Validated configuration, or the exit code after explaining what is wrong (never echoing values). */
export function loadCliConfig(env: NodeJS.ProcessEnv, io: CliIO): AppConfig | number {
  try {
    return loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) {
      io.err(e.message);
      return EXIT.CONFIG;
    }
    throw e;
  }
}

/** Audit actor for operator commands: `system` with `cli:<os user>` so the audit log shows who ran them. */
export function cliActor(tool: string): Actor {
  let user = 'unknown';
  try {
    user = userInfo().username || 'unknown';
  } catch {
    // Containers can run under a uid without a passwd entry.
  }
  return { type: 'system', id: `cli:${tool}:${user}`.slice(0, 120) };
}

/** Logger for CLI runs: warnings and errors always, info with --verbose; one line each on stderr. */
export function cliLogger(io: CliIO, verbose: boolean): Logger {
  const line = (level: string) => (o: object | string, m?: string) => {
    const message = typeof o === 'string' ? o : (m ?? '');
    const fields = typeof o === 'object' && o !== null && Object.keys(o).length > 0 ? ` ${JSON.stringify(o)}` : '';
    io.err(`[${level}] ${message}${fields}`);
  };
  const info = line('info');
  return { info: (o, m) => (verbose ? info(o, m) : undefined), warn: line('warn'), error: line('error') };
}

/** Parse argv strictly; usage errors become a message and exit code 2. */
export function parseCli<T extends NonNullable<ParseArgsConfig['options']>>(
  argv: string[],
  options: T,
  io: CliIO,
  usage: string,
): { values: Record<string, string | boolean | undefined>; positionals: string[] } | number {
  try {
    const r = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    return { values: r.values as Record<string, string | boolean | undefined>, positionals: r.positionals };
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${usage}`);
    return EXIT.USAGE;
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    // DomainError carries a safe public message; anything else keeps its own message (never a stack).
    const pub = (e as { publicMessage?: unknown }).publicMessage;
    const detail = (e as { internal?: { detail?: unknown } }).internal?.detail;
    return typeof pub === 'string' ? `${pub}${typeof detail === 'string' ? ` (${detail})` : ''}` : e.message;
  }
  return String(e);
}

/** True when `metaUrl` is the module node was started with (tsx keeps argv[1] as the script path). */
export function isMainModule(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

/** `pglite:memory` lives only as long as the process: seeding it is a smoke test, nothing persists. */
export function isEphemeralDatabase(url: string): boolean {
  const t = parseDatabaseUrl(url);
  return t.kind === 'pglite' && t.dataDir === null;
}

// ── db CLI ─────────────────────────────────────────────────────────────────

export const DB_USAGE = `Usage: tsx scripts/db.ts <command> [options]

Commands
  migrate              Apply pending migrations
  status               List migrations and when each was applied
  seed                 Load the demo dataset into an empty database (not in production)
  reset-demo --yes     Drop every ORBES table, migrate and load the demo dataset (not in production)

Options
  --json               Machine-readable output
  --verbose            Service logs on stderr
  --force              reset-demo: also wipe a database that holds non-demo products
  --help               This text

Environment: the server's (see .env.example); DEMO_ACCOUNT_PASSWORD sets the demo accounts' password.`;

const DB_OPTIONS = {
  json: { type: 'boolean' },
  verbose: { type: 'boolean' },
  yes: { type: 'boolean' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function runDbCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io = deps.io ?? consoleIO;
  const parsed = parseCli(argv, DB_OPTIONS, io, DB_USAGE);
  if (typeof parsed === 'number') return parsed;
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(DB_USAGE);
    return EXIT.OK;
  }
  const [command, ...rest] = positionals;
  if (!command || rest.length > 0 || !['migrate', 'status', 'seed', 'reset-demo'].includes(command)) {
    io.err(command ? `Unknown or malformed command: ${[command, ...rest].join(' ')}\n\n${DB_USAGE}` : DB_USAGE);
    return EXIT.USAGE;
  }

  const config = loadCliConfig(deps.env ?? process.env, io);
  if (typeof config === 'number') return config;
  const opts = { json: values.json === true, verbose: values.verbose === true, yes: values.yes === true, force: values.force === true };
  const log = cliLogger(io, opts.verbose);

  try {
    switch (command) {
      case 'migrate':
        return await withDb(config, deps, log, async (db) => {
          const { applied } = await migrateToLatest(db);
          if (opts.json) io.out(JSON.stringify({ applied }));
          else io.out(applied.length > 0 ? `Applied ${applied.length} migration(s): ${applied.join(', ')}` : 'Schema is up to date.');
          return EXIT.OK;
        });
      case 'status':
        return await withDb(config, deps, log, async (db) => {
          const list = await migrationStatus(db);
          if (opts.json) {
            io.out(JSON.stringify({ database: redactDatabaseUrl(config.databaseUrl), migrations: list }));
          } else {
            io.out(`Database: ${redactDatabaseUrl(config.databaseUrl)}`);
            for (const m of list) io.out(`  ${m.executedAt ? 'applied' : 'PENDING'}  ${m.name}${m.executedAt ? `  ${m.executedAt.toISOString()}` : ''}`);
          }
          return EXIT.OK;
        });
      case 'seed':
        return await seedCommand(config, deps, io, log, opts);
      case 'reset-demo':
        return await resetDemoCommand(config, deps, io, log, opts);
    }
  } catch (e) {
    io.err(`db ${command}: ${errorMessage(e)}`);
    if (opts.verbose && e instanceof Error && e.stack) io.err(e.stack);
    return EXIT.FAILURE;
  }
  return EXIT.USAGE;
}

async function withDb<T>(config: AppConfig, deps: CliDeps, log: Logger, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = deps.db ?? createDb(config.databaseUrl, { log });
  try {
    return await fn(db);
  } finally {
    if (!deps.db) await closeDb(db);
  }
}

interface DemoOpts {
  json: boolean;
  verbose: boolean;
  yes: boolean;
  force: boolean;
}

function refuseProduction(config: AppConfig, io: CliIO, command: string): number | undefined {
  if (config.env !== 'production') return undefined;
  io.err(`db ${command}: refused, the demo dataset is never loaded into a production environment (ORBES_ENV=production).`);
  return EXIT.FAILURE;
}

async function seedCommand(config: AppConfig, deps: CliDeps, io: CliIO, log: Logger, opts: DemoOpts): Promise<number> {
  const refused = refuseProduction(config, io, 'seed');
  if (refused !== undefined) return refused;
  const env = deps.env ?? process.env;
  const password = env.DEMO_ACCOUNT_PASSWORD?.trim() || undefined;
  if (password !== undefined && password.length < 12) {
    io.err('db seed: DEMO_ACCOUNT_PASSWORD must be at least 12 characters.');
    return EXIT.FAILURE;
  }

  return withDb(config, deps, log, async (db) => {
    // Check before building a context: it would create a signing key as a side effect.
    await migrateToLatest(db);
    const status = await demoSeedStatus(db);
    if (status === 'SEEDED') {
      if (opts.json) io.out(JSON.stringify({ seeded: false, reason: 'ALREADY_SEEDED' }));
      else io.out('The demo dataset is already loaded; nothing to do (use reset-demo to start over).');
      return EXIT.OK;
    }
    if (status === 'OTHER_DATA') {
      io.err('db seed: the database already holds products; the demo dataset only loads into an empty database.');
      return EXIT.FAILURE;
    }

    const clock = createManualClock(DEMO_TIMELINE_START);
    const provider = deps.keyProvider ?? (await createKeyProvider(config, log));
    // The stories deliberately trigger suspicious scans; their service warnings are noise here unless --verbose.
    const ctxLog: Logger = opts.verbose ? log : { info: () => {}, warn: () => {}, error: log.error };
    const ctx = await createContext(config, { db, clock: clock.now, log: ctxLog, keyProvider: provider, migrate: false });
    const started = performance.now();
    try {
      // An ACTIVE key this process cannot sign with (left by an earlier KEY_PROVIDER=memory run, or a wrong
      // KEY_DIR / KEY_ENCRYPTION_KEY) would fail the first issuance with a vague error; say what to do instead.
      if (!(await ctx.keys.selfTest())) {
        io.err(
          provider.name === 'memory'
            ? 'db seed: the ACTIVE signing key belongs to an earlier process (KEY_PROVIDER=memory keeps keys in memory only). Run `tsx scripts/db.ts reset-demo --yes`, or use KEY_PROVIDER=local.'
            : 'db seed: the ACTIVE signing key cannot sign with the configured provider (check KEY_DIR and KEY_ENCRYPTION_KEY, or rotate: `tsx scripts/keys.ts rotate`).',
        );
        return EXIT.FAILURE;
      }
      const result = await seedDemo(ctx, { clock, now: deps.now?.() ?? new Date(), ...(password ? { accountPassword: password } : {}), log: ctxLog });
      const ephemeral = isEphemeralDatabase(config.databaseUrl);
      let keyNote: string | undefined;
      if (provider.name === 'memory' && !ephemeral) {
        // A memory key dies with this process: retire it so the demo codes stay verifiable (RETIRED =
        // verify-only) and the server creates a signing key it actually holds on its next start.
        await ctx.keys.retire(result.keyId, cliActor('db'));
        keyNote = `Signing key #${result.keyId} lived in this process only (KEY_PROVIDER=memory) and is now RETIRED; demo codes stay verifiable and the server creates a new key on start. Use KEY_PROVIDER=local to keep one.`;
      }
      const seconds = (performance.now() - started) / 1000;
      if (opts.json) io.out(JSON.stringify({ seeded: true, ephemeral, ...result }));
      else printSeedSummary(io, result, { seconds, ephemeral, keyNote, passwordFromEnv: password !== undefined, admin: config.bootstrapAdmin?.email });
      return EXIT.OK;
    } finally {
      await ctx.close();
    }
  });
}

async function resetDemoCommand(config: AppConfig, deps: CliDeps, io: CliIO, log: Logger, opts: DemoOpts): Promise<number> {
  const refused = refuseProduction(config, io, 'reset-demo');
  if (refused !== undefined) return refused;
  if (!opts.yes) {
    io.err(`db reset-demo drops every ORBES table in ${redactDatabaseUrl(config.databaseUrl)}. Re-run with --yes to confirm.`);
    return EXIT.USAGE;
  }
  const dropped = await withDb(config, deps, log, async (db) => {
    const applied = (await migrationStatus(db)).filter((m) => m.executedAt !== undefined);
    if (applied.length > 0 && !opts.force && (await demoSeedStatus(db)) === 'OTHER_DATA') {
      io.err('db reset-demo: the database holds products that are not the demo dataset; add --force to wipe it anyway.');
      return undefined;
    }
    // Roll back one migration at a time, newest first, until none is applied.
    const reverted: string[] = [];
    for (let guard = 0; guard < 1000; guard++) {
      const executed = (await migrationStatus(db)).filter((m) => m.executedAt !== undefined);
      if (executed.length === 0) break;
      const r = await migrateDown(db);
      if (r.reverted.length === 0) throw new Error(`could not roll back migration ${executed[executed.length - 1].name}`);
      reverted.push(...r.reverted);
    }
    return reverted;
  });
  if (dropped === undefined) return EXIT.FAILURE;
  if (!opts.json) io.out(dropped.length > 0 ? `Dropped the schema (rolled back ${dropped.join(', ')}).` : 'The database was empty.');
  return seedCommand(config, deps, io, log, opts);
}

function printSeedSummary(
  io: CliIO,
  r: DemoSeedResult,
  x: { seconds: number; ephemeral: boolean; keyNote?: string; passwordFromEnv: boolean; admin?: string },
): void {
  io.out(`ORBES demo dataset loaded in ${x.seconds.toFixed(1)} s: ${r.products} products, ${r.accounts.length} accounts, ${r.scans} scans, ${r.anomalies.open} open anomalies.`);
  const byStatus = PRODUCT_STATUSES.filter((s) => r.productsByStatus[s]).map((s) => `${s} ${r.productsByStatus[s]}`);
  io.out(`  Products by status: ${byStatus.join(' · ')}`);
  io.out(`  Signing key: #${r.keyId}`);
  io.out('');
  io.out(x.passwordFromEnv ? '  Demo accounts (password from DEMO_ACCOUNT_PASSWORD):' : `  Demo accounts (password, shown once: ${r.generatedAccountPassword}):`);
  for (const a of r.accounts) io.out(`    ${a.email.padEnd(30)} ${a.displayName}`);
  io.out('');
  const first = r.claimCodes.find((c) => c.productId === DEMO_FIRST_REGISTRATION_PRODUCT_ID);
  if (first) io.out(`  ${first.productId} scans as AUTHENTIC — FIRST REGISTRATION; its claim code (shown once): ${first.claimCode}`);
  const others = r.claimCodes.filter((c) => c.productId !== DEMO_FIRST_REGISTRATION_PRODUCT_ID);
  if (others.length > 0) {
    io.out('  Other unregistered claim codes (shown once):');
    for (const c of others) io.out(`    ${c.productId}  ${c.claimCode}${c.registrable ? '' : '  (not sold yet)'}`);
  }
  io.out('');
  io.out(x.admin ? `  Admin console: /admin, sign in as ${x.admin} (BOOTSTRAP_ADMIN_*).` : '  Admin console: set BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD to create an admin on start.');
  if (x.keyNote) io.out(`  Note: ${x.keyNote}`);
  if (x.ephemeral) io.out('  Note: DATABASE_URL is pglite:memory, so nothing persists after this command (smoke test only).');
}

if (isMainModule(import.meta.url)) {
  runDbCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`db: ${errorMessage(e)}\n`);
      process.exitCode = EXIT.FAILURE;
    },
  );
}
