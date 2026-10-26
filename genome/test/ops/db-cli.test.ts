/**
 * scripts/db.ts: migrate / status / seed / reset-demo, with injected
 * in-memory databases (the configuration still decides what the commands
 * believe about persistence and the environment).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDbCli, type CliIO } from '../../scripts/db.js';
import { testConfig } from '../../src/server/config.js';
import { createContext } from '../../src/server/context.js';
import { MIGRATIONS, migrateDown, migrationStatus } from '../../src/server/db/migrate.js';
import { inTransaction } from '../../src/server/db/connection.js';
import { clearTheVaultForReset } from '../../src/server/db/seed/vault-reset.js';
import { DEMO_FIRST_REGISTRATION_PRODUCT_ID } from '../../src/server/db/seed/demo.js';
import { KeyService } from '../../src/server/keys/key-service.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { AuditService } from '../../src/server/services/audit.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { VaultService } from '../../src/server/services/vault.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const NOW = new Date('2026-10-01T09:00:00.000Z');
/** Looks persistent to the CLI (the database itself is injected). */
const DEV_ENV = { ORBES_ENV: 'development', DATABASE_URL: 'pglite:/var/lib/orbes/demo-db', DEMO_ACCOUNT_PASSWORD: 'demo-account-password-2026' };
/** A complete, valid production configuration (random secrets; the database is never reached). */
const PROD_ENV = {
  ORBES_ENV: 'production',
  DATABASE_URL: 'postgres://orbes@db.invalid:5432/orbes',
  PUBLIC_ORIGIN: 'https://verify.example.com',
  COOKIE_SECRET: randomBytes(32).toString('base64url'),
  IP_HASH_PEPPER: randomBytes(32).toString('base64url'),
  KEY_PROVIDER: 'local',
  KEY_DIR: '/var/lib/orbes/keys',
  KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
};

function capture(): CliIO & { stdout: string[]; stderr: string[]; text(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l), text: () => [...stdout, ...stderr].join('\n') };
}

async function run(argv: string[], db: TestDb['db'] | undefined, env: NodeJS.ProcessEnv = DEV_ENV) {
  const io = capture();
  const code = await runDbCli(argv, { env, io, ...(db ? { db } : {}), now: () => NOW });
  return { code, io };
}

describe('db CLI: usage and refusals', () => {
  it('prints usage and rejects unknown commands and options', async () => {
    const help = await run(['--help'], undefined);
    expect(help.code).toBe(0);
    expect(help.io.text()).toMatch(/reset-demo --yes/);
    expect((await run([], undefined)).code).toBe(2);
    expect((await run(['drop-everything'], undefined)).code).toBe(2);
    expect((await run(['seed', '--bogus'], undefined)).code).toBe(2);
    expect((await run(['seed', 'extra'], undefined)).code).toBe(2);
  });

  it('refuses the demo commands in production, before opening the database', async () => {
    const seed = await run(['seed'], undefined, PROD_ENV);
    expect(seed.code).toBe(1);
    expect(seed.io.text()).toMatch(/never loaded into a production environment/);
    const reset = await run(['reset-demo', '--yes', '--force'], undefined, PROD_ENV);
    expect(reset.code).toBe(1);
  });

  it('reports configuration errors with exit code 78 and without echoing values', async () => {
    const r = await run(['migrate'], undefined, { ...PROD_ENV, COOKIE_SECRET: 'short-secret-value' });
    expect(r.code).toBe(78);
    expect(r.io.text()).toMatch(/COOKIE_SECRET: must be at least 32 characters/);
    expect(r.io.text()).not.toContain('short-secret-value');
  });
});

describe('db CLI: unusable signing key', () => {
  it('stops before seeding when the ACTIVE key cannot sign in this process, and says how to recover', async () => {
    const t = await createTestDb();
    try {
      // An earlier process with KEY_PROVIDER=memory left an ACTIVE key nobody holds any more.
      const earlier = new KeyService({ db: t.db, provider: new MemoryKeyProvider({ env: 'test' }), audit: new AuditService({ db: t.db }) });
      await earlier.ensureActiveKey({ type: 'system' });
      const io = capture();
      const code = await runDbCli(['seed'], { env: DEV_ENV, io, db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }), now: () => NOW });
      expect(code).toBe(1);
      expect(io.text()).toMatch(/belongs to an earlier process .* reset-demo --yes/);
      expect(await t.db.selectFrom('products').select('id').execute()).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});

describe('db CLI: migrate and status', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
  });
  afterAll(async () => t?.close());

  it('applies pending migrations once and reports status', async () => {
    const before = await run(['status', '--json'], t.db);
    const names = Object.keys(MIGRATIONS);
    expect(JSON.parse(before.io.stdout[0]).migrations).toEqual(names.map((name) => ({ name })));
    const first = await run(['migrate'], t.db);
    expect(first.code).toBe(0);
    expect(first.io.text()).toBe(`Applied ${names.length} migration(s): ${names.join(', ')}`);
    expect((await run(['migrate'], t.db)).io.text()).toBe('Schema is up to date.');
    const after = await run(['status'], t.db);
    expect(after.io.text()).toMatch(/applied {2}0001_initial {2}\d{4}-/);
    expect(after.io.text()).toMatch(/Database: pglite:\/var\/lib\/orbes\/demo-db/);
  });
});

describe('db CLI: seed and reset-demo', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
  });
  afterAll(async () => t?.close());

  it('seeds an empty database, prints the demo secrets once, and retires the throw-away memory key', async () => {
    const r = await run(['seed'], t.db);
    expect(r.code, r.io.text()).toBe(0);
    const text = r.io.text();
    expect(text).toMatch(/ORBES demo dataset loaded in [\d.]+ s: 47 products, 8 accounts/);
    expect(text).toMatch(/Products by status: ISSUED \d+ · ACTIVATED \d+ · REGISTERED/);
    expect(text).toMatch(/password from DEMO_ACCOUNT_PASSWORD/);
    expect(text).not.toContain(DEV_ENV.DEMO_ACCOUNT_PASSWORD);
    expect(text).toMatch(new RegExp(`${DEMO_FIRST_REGISTRATION_PRODUCT_ID} scans as AUTHENTIC — FIRST REGISTRATION; its claim code \\(shown once\\): [0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}`));
    expect(text).toMatch(/KEY_PROVIDER=memory\) and is now RETIRED/);
    // Expected suspicious scans of the stories are not reported as warnings without --verbose.
    expect(r.io.stderr).toEqual([]);

    const keys = await t.db.selectFrom('cryptographic_keys').select(['status', 'provider']).execute();
    expect(keys).toEqual([{ status: 'RETIRED', provider: 'memory' }]);
    const retire = await t.db.selectFrom('audit_logs').select(['actor_id']).where('action', '=', 'key.retire').executeTakeFirstOrThrow();
    expect(retire.actor_id).toMatch(/^cli:db:/);
  }, 180_000);

  it('is idempotent: a second seed changes nothing', async () => {
    const before = await t.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const r = await run(['seed', '--json'], t.db);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.io.stdout[0])).toEqual({ seeded: false, reason: 'ALREADY_SEEDED' });
    const after = await t.db.selectFrom('audit_logs').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
    expect(await t.db.selectFrom('cryptographic_keys').select('key_id').execute()).toHaveLength(1);
  });

  it('reset-demo needs --yes, then drops everything and loads a fresh demo', async () => {
    const unconfirmed = await run(['reset-demo'], t.db);
    expect(unconfirmed.code).toBe(2);
    expect(unconfirmed.io.text()).toMatch(/--yes/);

    const oldIds = (await t.db.selectFrom('products').select('id').execute()).map((r) => r.id);
    const r = await run(['reset-demo', '--yes', '--json'], t.db, { ...DEV_ENV, DEMO_ACCOUNT_PASSWORD: '' });
    expect(r.code, r.io.text()).toBe(0);
    const result = JSON.parse(r.io.stdout[r.io.stdout.length - 1]);
    expect(result).toMatchObject({ seeded: true, ephemeral: false, products: 47 });
    // Without DEMO_ACCOUNT_PASSWORD a random password is generated and returned once.
    expect(result.generatedAccountPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const newIds = (await t.db.selectFrom('products').select('id').execute()).map((r) => r.id);
    expect(newIds).toHaveLength(47);
    expect(newIds.some((id) => oldIds.includes(id))).toBe(false);
    // A fresh audit chain, still intact.
    const first = await t.db.selectFrom('audit_logs').select(['id']).orderBy('id').executeTakeFirstOrThrow();
    expect(Number(first.id)).toBe(1);
  }, 180_000);

  it('reset-demo clears what THE VAULT’s down steps refuse (lot Q3), which production keeps', async () => {
    // The demo holds the reference's example rewards (D26); here a dev database also used THE VAULT: vaults opened to a
    // credit, a credit to give, a right to buy, GUARANTEED and a piece won free (a VAULT order at 0 holding its unit),
    // an invitation, an invited account, a source changed, a release's vault on and a vault-only model.
    const clock = createManualClock(NOW.toISOString());
    const ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    try {
      // The demo's MONOLITHE (its right to buy) at a price, one unit in stock to be won free.
      const modelId = (await t.db.selectFrom('vault_rewards').select('model_id').where('kind', '=', 'PRODUCT').executeTakeFirstOrThrow()).model_id!;
      await t.db.updateTable('models').set({ base_price_minor: 120_000, base_currency: 'EUR' }).where('id', '=', modelId).execute();
      const email = 'reset-admin@orbes.test';
      const staff = { type: 'admin' as const, id: (await t.db.insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'ADMIN' }).returning('id').executeTakeFirstOrThrow()).id };
      const locationId = (await t.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
      const skuId = await inTransaction(t.db, (tx) => ensureSku(tx, modelId, null));
      await ctx.services.stock.adjust({ skuId, locationId, delta: 1, note: 'Counted.' }, staff);
      await t.db.insertInto('vault_rewards').values({ kind: 'PRODUCT', odds_in: 2_000, quantity: 1, model_id: modelId, mode: 'FREE', position: 6 }).execute();
      let next = 0;
      const opener = new VaultService({ db: t.db, audit: ctx.audit, profiles: ctx.services.profiles, clock: clock.now, random: () => next });
      const accounts = (await t.db.selectFrom('accounts').select('id').where('status', '=', 'ACTIVE').orderBy('created_at').execute()).map((a) => a.id);
      const kinds: string[] = [];
      // CREDIT, CREDIT TO GIVE, PRODUCT (right to buy), GUARANTEED, then the piece won free, by their parts.
      for (const [i, part] of [0, 100_000, 150_000, 190_000, 195_500].entries()) {
        const given = await ctx.services.vault.give({ source: 'PROFILE', accountId: accounts[i]! });
        next = part;
        kinds.push((await opener.open(accounts[i]!, given.vaults[0]!.id)).kind);
      }
      expect(kinds).toEqual(['CREDIT', 'CREDIT_TO_GIVE', 'PRODUCT', 'GUARANTEED', 'PRODUCT']);
      await ctx.services.vault.invitation(accounts[0]!);
      await t.db.updateTable('accounts').set({ invited_by: accounts[0]!, invited_at: NOW }).where('id', '=', accounts[5]!).execute();
      await t.db.updateTable('vault_sources').set({ enabled: false }).where('source', '=', 'WORN').execute();
      await t.db.updateTable('models').set({ vault_only: true }).where('id', '=', modelId).execute();
      const live = await t.db.selectFrom('drops').select('id').where('mode', '=', 'LIVE').where('parent_drop_id', 'is', null).executeTakeFirst();
      if (live) await t.db.updateTable('drops').set({ vault_on: true }).where('id', '=', live.id).execute();
      expect(await t.db.selectFrom('orders').select('id').where('channel', '=', 'VAULT').execute()).toHaveLength(1);
    } finally {
      await ctx.close();
    }

    const r = await run(['reset-demo', '--yes'], t.db);
    expect(r.code, r.io.text()).toBe(0);
    expect(r.io.text()).toMatch(/rolled back 0063_margin, 0062_vault_rewards, 0061_the_vault, .*0001_initial\)/);
    // A fresh demo: no vault, the example rewards under the floor again.
    expect(await t.db.selectFrom('vaults').select('id').execute()).toEqual([]);
    expect((await t.db.selectFrom('vault_rewards').select('kind').orderBy('position').execute()).map((x) => x.kind)).toEqual(['I_WAS_THERE', 'CREDIT', 'CREDIT_TO_GIVE', 'PRODUCT', 'GUARANTEED', 'THE_PIECE']);
  }, 240_000);

  it('keeps THE VAULT’s down guards for every other caller: a vault left in place refuses the rollback', async () => {
    const other = await createTestDb();
    try {
      await other.db.insertInto('vault_rewards').values({ kind: 'GUARANTEED', odds_in: 200, quantity: 1, position: 1 }).execute();
      expect((await migrateDown(other.db)).reverted).toEqual(['0063_margin']);
      expect((await migrateDown(other.db)).reverted).toEqual(['0062_vault_rewards']);
      await expect(migrateDown(other.db)).rejects.toThrow(/migration 0061_the_vault cannot be rolled back: 0 vaults, .* 1 vault rewards/);
      // reset-demo's clearing, on a database where 0062 is no longer applied.
      const applied = (await migrationStatus(other.db)).filter((m) => m.executedAt !== undefined).map((m) => m.name);
      expect(await clearTheVaultForReset(other.db, applied)).toEqual({ deleted: { vault_rewards: 1 } });
      expect((await other.db.selectFrom('vault_rewards').select('kind').execute()).map((x) => x.kind)).toEqual(['I_WAS_THERE']);
      expect((await migrateDown(other.db)).reverted).toEqual(['0061_the_vault']);
    } finally {
      await other.close();
    }
  });

  it('reset-demo refuses to wipe non-demo data without --force; seed refuses to mix with it', async () => {
    const other = await createTestDb();
    try {
      await other.db.insertInto('categories').values({ id: 1, code: 'J', name: 'Jewelry' }).execute();
      const col = await other.db.insertInto('collections').values({ name: 'X' }).returning('id').executeTakeFirstOrThrow();
      const model = await other.db
        .insertInto('models')
        .values({ category_id: 1, collection_id: col.id, name: 'M', type: 'RING', sku_prefix: 'M-1' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await other.db
        .insertInto('products')
        .values({ product_id: 'O26-J-00001', packed_identity: (26 << 25) | (1 << 20) | 1, year: 2026, category_id: 1, serial: 1, sku: 'M-1', model_id: model.id, material: 'GOLD' })
        .execute();

      const seed = await run(['seed'], other.db);
      expect(seed.code).toBe(1);
      expect(seed.io.text()).toMatch(/already holds products/);
      const reset = await run(['reset-demo', '--yes'], other.db);
      expect(reset.code).toBe(1);
      expect(reset.io.text()).toMatch(/--force/);
      expect(await other.db.selectFrom('products').select('product_id').execute()).toEqual([{ product_id: 'O26-J-00001' }]);
    } finally {
      await other.close();
    }
  });
});
