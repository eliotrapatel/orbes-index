/**
 * ORBES Smart Model's export on PostgreSQL (opt-in: ORBES_TEST_POSTGRES_URL, as test/db/postgres.test.ts): the pg driver
 * production uses, as a role with the production app's rights only (deploy/vps/scripts/lib.sh: SELECT, INSERT, UPDATE,
 * DELETE, no DDL, not a superuser), one connection in the pool. The figures are PGlite's (smart-model-export.test.ts),
 * the LIVE guard refuses, and the connection always comes back out of its read-only transaction.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { readSmartModel, SmartModelExportError } from '../../src/server/services/smart-model-export.js';
import { createAdmin } from '../api/support.js';
import { seedMargin, type MarginFixture } from '../support/margin.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('PostgreSQL: ORBES Smart Model export', () => {
  let admin: Db;
  let owner: Db;
  let app: Db;
  let ctx: AppContext;
  let f: MarginFixture;
  const suffix = randomBytes(6).toString('hex');
  const dbName = `orbes_sm_${suffix}`;
  const appRole = `orbes_sm_app_${suffix}`;
  const appPassword = randomBytes(18).toString('hex');

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    owner = createDb(u.toString(), { poolMax: 4 });
    ctx = await createContext(testConfig({ databaseUrl: u.toString() }), { db: owner, migrate: true });
    f = await seedMargin(owner, (await createAdmin(ctx, 'ADMIN')).id);
    // The production app's rights (lib.sh db_prepare), on a role of this test only.
    await sql.raw(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`).execute(admin);
    await sql.raw(`GRANT CONNECT ON DATABASE ${dbName} TO ${appRole}`).execute(admin);
    await sql.raw(`GRANT USAGE ON SCHEMA public TO ${appRole}`).execute(owner);
    await sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`).execute(owner);
    await sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`).execute(owner);
    const a = new URL(u.toString());
    a.username = appRole;
    a.password = appPassword;
    app = createDb(a.toString(), { poolMax: 1 });
  }, 120_000);

  afterAll(async () => {
    if (app) await closeDb(app);
    if (ctx) await ctx.close();
    if (owner) await closeDb(owner);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await sql.raw(`DROP ROLE IF EXISTS ${appRole}`).execute(admin);
      await closeDb(admin);
    }
  });

  it('PostgreSQL: the same figures as PGlite, read as the app role', async () => {
    const raw = await readSmartModel(app, '2025-01-01');
    const s = new Map(raw.sales.map((x) => [x.order, x]));
    expect(s.size).toBe(9);
    expect(s.get(f.orders.O1)).toMatchObject({ units: 1, giftUnits: 1, revenueMinor: 122_500, shippingMinor: 1_500, customerRank: 2 });
    expect(s.get(f.orders.O2)).toMatchObject({ units: 2, revenueMinor: 237_000, creditsMinor: -10_000, refundedMinor: 2_000 });
    expect(s.get(f.orders.O4)).toMatchObject({ currency: 'GBP', revenueMinor: 100_000 });
    expect(s.get(f.orders.O7)).toMatchObject({ status: 'cancelled', revenueMinor: 0 });
    expect(raw.rates).toEqual([{ currency: 'GBP', eurRate: 1.2 }]);
  });

  it('PostgreSQL: the LIVE guard refuses, and the one connection comes back writable, out of any transaction', async () => {
    await sql`UPDATE drops SET opens_at = now() + interval '10 minutes', closes_at = now() + interval '70 minutes', ended_at = NULL WHERE id = ${f.releases.live}`.execute(owner);
    await expect(readSmartModel(app, '2025-01-01')).rejects.toEqual(new SmartModelExportError('live'));
    const r = await sql<{ ro: string; tx: string }>`SELECT current_setting('transaction_read_only') AS ro, current_setting('statement_timeout') AS tx`.execute(app);
    expect(r.rows[0]).toEqual({ ro: 'off', tx: '30s' });
    await sql`UPDATE drops SET opens_at = now() + interval '1 day', closes_at = now() + interval '1 day 1 hour' WHERE id = ${f.releases.live}`.execute(app);
    expect((await readSmartModel(app, '2025-01-01')).sales).toHaveLength(9);
    const after = await sql<{ ro: string }>`SELECT current_setting('transaction_read_only') AS ro`.execute(app);
    expect(after.rows[0]!.ro).toBe('off');
  });
});
