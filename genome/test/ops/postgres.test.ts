/**
 * The operator tool chain on real PostgreSQL (opt-in):
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/ops/postgres.test.ts
 *
 * The role needs CREATEDB. A throwaway database is created and dropped. Runs
 * the CLIs exactly as an operator would (they open DATABASE_URL themselves):
 * db migrate → keys generate (LocalKeyProvider) → db seed → verify → db
 * reset-demo (rollback + reseed on PostgreSQL) → export-demo-codes.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDbCli, type CliIO } from '../../scripts/db.js';
import { runExportCli } from '../../scripts/export-demo-codes.js';
import { runKeysCli } from '../../scripts/keys.js';
import { frameCodeData } from '../../src/core/payload.js';
import { loadConfig } from '../../src/server/config.js';
import { createContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { MIGRATIONS } from '../../src/server/db/migrate.js';
import { createManualClock } from '../../src/server/types.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
const NOW = new Date('2026-10-01T09:00:00.000Z');

function capture(): CliIO & { stdout: string[]; text(): string } {
  const lines: string[] = [];
  const stdout: string[] = [];
  return { stdout, out: (l) => (stdout.push(l), lines.push(l)), err: (l) => lines.push(l), text: () => lines.join('\n') };
}

describe.skipIf(!adminUrl)('operator CLIs on PostgreSQL', () => {
  let admin: Db;
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const dbName = `orbes_ops_${randomBytes(6).toString('hex')}`;

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    dir = mkdtempSync(join(tmpdir(), 'orbes-ops-pg-'));
    env = {
      ORBES_ENV: 'development',
      DATABASE_URL: u.toString(),
      KEY_PROVIDER: 'local',
      KEY_DIR: join(dir, 'keys'),
      KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      DEMO_ACCOUNT_PASSWORD: 'demo-account-password-2026',
    };
  });

  afterAll(async () => {
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const run = async (cli: typeof runDbCli, argv: string[]) => {
    const io = capture();
    const code = await cli(argv, { env, io, now: () => NOW });
    return { code, io };
  };

  it('migrates, generates a key, seeds and verifies like the server would', async () => {
    expect((await run(runDbCli, ['migrate'])).io.text()).toBe(`Applied ${Object.keys(MIGRATIONS).length} migration(s): ${Object.keys(MIGRATIONS).join(', ')}`);
    expect((await run(runKeysCli, ['generate'])).code).toBe(0);
    const seed = await run(runDbCli, ['seed', '--json']);
    expect(seed.code, seed.io.text()).toBe(0);
    const result = JSON.parse(seed.io.stdout[seed.io.stdout.length - 1]);
    // Open, as on PGlite (test/integration/demo-seed.test.ts): the impossible travel, the stolen pendant's scan and
    // the unsold piece a stranger scanned in Lyon (S-07); the boutique's own scan of its stock is dismissed.
    expect(result).toMatchObject({ seeded: true, products: 47, keyId: 1, anomalies: { open: 3 } });

    // A local key survives the CLI: it stays ACTIVE and the server can keep issuing with it.
    const keys = JSON.parse((await run(runKeysCli, ['list', '--json'])).io.stdout[0]).keys;
    expect(keys.map((k: { keyId: number; status: string }) => [k.keyId, k.status])).toEqual([[1, 'ACTIVE']]);

    const clock = createManualClock(new Date(NOW.getTime() + 60_000));
    const ctx = await createContext(loadConfig(env), { clock: clock.now, migrate: false, bootstrapAdmin: false });
    try {
      const code = await ctx.db
        .selectFrom('codes as c')
        .innerJoin('products as p', 'p.id', 'c.product_id')
        .select(['c.payload', 'c.signature'])
        .where('p.product_id', '=', 'O26-J-00184')
        .executeTakeFirstOrThrow();
      const outcome = await ctx.services.verification.verify({ code: Buffer.from(frameCodeData(code.payload, code.signature)).toString('base64url') }, {});
      expect(outcome.state).toBe('AUTHENTIC_FIRST_REGISTRATION');
      expect((await ctx.audit.verifyChain()).ok).toBe(true);
    } finally {
      await ctx.close();
    }
  }, 240_000);

  it('reset-demo rolls the schema back and reseeds on PostgreSQL; export reads the result', async () => {
    const reset = await run(runDbCli, ['reset-demo', '--yes', '--json']);
    expect(reset.code, reset.io.text()).toBe(0);
    expect(JSON.parse(reset.io.stdout[reset.io.stdout.length - 1])).toMatchObject({ seeded: true, products: 47 });
    // The registry was rebuilt: a fresh key 1 (a new file), the previous file stays unused on disk.
    expect(readdirSync(env.KEY_DIR!)).toHaveLength(2);

    const io = capture();
    const out = join(dir, 'codes');
    const code = await runExportCli(['--out', out, '--products', 'O26-J-00184', '--formats', 'svg', '--no-sheet'], { env, io, now: () => NOW });
    expect(code, io.text()).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['O26-J-00184-I1.svg', 'manifest.json']);
  }, 240_000);
});
