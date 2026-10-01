/**
 * Counterfeit simulation on real PostgreSQL (opt-in).
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/simulation/postgres.test.ts
 *
 * Runs the anomaly-heavy scenarios (cloned code: four rule types upserted per
 * scan; duplicated code; keys: product-less CRITICAL findings under the
 * advisory lock) with every world in its own throwaway database. The role
 * needs CREATEDB; the databases are dropped afterwards.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, describe } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import type { DbFactory } from './lab.js';
import { scenarioSuite } from './suite.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('counterfeit simulation on PostgreSQL', () => {
  const created: string[] = [];
  let admin: Db | undefined;

  const factory: DbFactory = async () => {
    admin ??= createDb(adminUrl!);
    const name = `orbes_sim_${randomBytes(6).toString('hex')}`;
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    created.push(name);
    const u = new URL(adminUrl!);
    u.pathname = `/${name}`;
    // Migrations are applied by createContext (test configuration).
    const db = createDb(u.toString(), { poolMax: 4 });
    return { db, close: () => closeDb(db) };
  };

  afterAll(async () => {
    if (!admin) return;
    for (const name of created) await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
    await closeDb(admin);
  });

  scenarioSuite([2, 8, 10], { dbFactory: factory, label: 'PostgreSQL' });
});
