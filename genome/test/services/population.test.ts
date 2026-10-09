/**
 * Who is counted (plan CUSTOMER INTELLIGENCE §3.0 (d), §3.6 C.3, step 0.2; services/population.ts), against a migrated
 * database:
 *
 *  - countedCollector leaves out test entrants, the team's own accounts (an email that is a console login's, active or
 *    disabled) and DELETED accounts, and keeps LOCKED ones;
 *  - houseAccount names exactly the team's own accounts, whatever their status;
 *  - notTestEntrant is GROWTH's SQL, moved: the same text, the same rows (growth.test.ts is unchanged and still passes);
 *  - HouseAccounts keeps the console logins' emails for 5 minutes, then reads them again; a failed read is not kept.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { countedCollector, HOUSE_ACCOUNTS_CACHE_MS, houseAccount, HouseAccounts, notTestEntrant } from '../../src/server/services/population.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

let t: TestDb;
const ids: Record<string, string> = {};

async function account(key: string, status: 'ACTIVE' | 'LOCKED' | 'DELETED' = 'ACTIVE'): Promise<string> {
  const email = `${key}@population.test`;
  ids[key] = (
    await t.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused', status }).returning('id').executeTakeFirstOrThrow()
  ).id;
  return ids[key]!;
}

async function adminLogin(key: string, disabled = false): Promise<void> {
  const email = `${key}@population.test`;
  await t.db
    .insertInto('admin_users')
    .values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'OPERATOR', disabled_at: disabled ? new Date('2026-09-01T10:00:00Z') : null })
    .execute();
}

/** The keys of the accounts a filter keeps, sorted. */
async function kept(filter: ReturnType<typeof countedCollector>): Promise<string[]> {
  const rows = (await sql<{ id: string }>`SELECT a.id FROM accounts a WHERE ${filter}`.execute(t.db)).rows;
  const byId = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
  return rows.map((r) => byId.get(r.id)).filter((k): k is string => !!k).sort();
}

beforeAll(async () => {
  t = await createTestDb();
  await account('active');
  await account('locked', 'LOCKED');
  await account('deleted', 'DELETED');
  await t.db.insertInto('test_entrants').values({ account_id: await account('entrant') }).execute();
  await account('team');
  await adminLogin('team');
  await account('former', 'LOCKED');
  await adminLogin('former', true); // a disabled console login: still the team's
  await account('teamgone', 'DELETED');
  await adminLogin('teamgone');
  await adminLogin('staffonly'); // a console login without a collector account
});
afterAll(() => t?.close());

describe('who is counted', () => {
  it('countedCollector: ACTIVE and LOCKED collectors only; no test entrant, no team account, no DELETED account', async () => {
    expect(await kept(countedCollector('a.id'))).toEqual(['active', 'locked']);
  });

  it('countedCollector reads any column holding an account id', async () => {
    const rows = (
      await sql<{ n: number }>`SELECT count(*)::int AS n FROM test_entrants te2 WHERE ${countedCollector('te2.account_id')}`.execute(t.db)
    ).rows;
    expect(rows[0]!.n).toBe(0);
  });

  it("houseAccount: the accounts whose email is a console login's, active or disabled, whatever their status", async () => {
    expect(await kept(houseAccount('a.id'))).toEqual(['former', 'team', 'teamgone']);
    expect(await kept(sql`NOT ${houseAccount('a.id')}`)).toEqual(['active', 'deleted', 'entrant', 'locked']);
  });

  it("notTestEntrant is GROWTH's SQL, moved unchanged", async () => {
    const compiled = sql`${notTestEntrant('o.account_id')}`.compile(t.db);
    expect(compiled.sql).toBe('NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = "o"."account_id")');
    expect(compiled.parameters).toEqual([]);
    expect(await kept(notTestEntrant('a.id'))).toEqual(['active', 'deleted', 'former', 'locked', 'team', 'teamgone']);
  });
});

describe('HouseAccounts: the team emails, kept 5 minutes', () => {
  it('reads once, keeps the set for 5 minutes, then reads again', async () => {
    const clock = createManualClock('2026-10-09T10:00:00Z');
    const house = new HouseAccounts(t.db, clock.now);
    expect(HOUSE_ACCOUNTS_CACHE_MS).toBe(5 * 60_000);
    expect(await house.isHouseEmail('team@population.test')).toBe(true);
    expect(await house.isHouseEmail('former@population.test')).toBe(true);
    expect(await house.isHouseEmail('active@population.test')).toBe(false);

    // A new console login is not seen until the 5 minutes have passed.
    await adminLogin('active');
    clock.advance(HOUSE_ACCOUNTS_CACHE_MS - 1);
    expect(await house.isHouseEmail('active@population.test')).toBe(false);
    clock.advance(1);
    expect(await house.isHouseEmail('active@population.test')).toBe(true);

    // invalidate() forgets the set at once.
    await t.db.deleteFrom('admin_users').where('email_normalized', '=', 'active@population.test').execute();
    expect(await house.isHouseEmail('active@population.test')).toBe(true);
    house.invalidate();
    expect(await house.isHouseEmail('active@population.test')).toBe(false);
  });

  it('two calls during a read share it, and a failed read is not kept', async () => {
    let reads = 0;
    let fail = true;
    const db = {
      selectFrom: () => ({
        select: () => ({
          execute: async () => {
            reads += 1;
            if (fail) throw new Error('database unavailable');
            return [{ email_normalized: 'team@population.test' }];
          },
        }),
      }),
    } as unknown as ConstructorParameters<typeof HouseAccounts>[0];
    const clock = createManualClock('2026-10-09T10:00:00Z');
    const house = new HouseAccounts(db, clock.now);
    await expect(house.all()).rejects.toThrow('database unavailable');
    fail = false;
    const [a, b] = await Promise.all([house.all(), house.all()]);
    expect(a).toBe(b);
    expect(reads).toBe(2);
    expect(await house.isHouseEmail('team@population.test')).toBe(true);
    expect(reads).toBe(2);
  });
});
