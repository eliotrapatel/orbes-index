/**
 * The birthday credit's grant under concurrency (plan CUSTOMER INTELLIGENCE §3.5 SB.4.4 and SB.4.7, step 6.4): two
 * passes of two processes wait for each other on the account's row (FOR UPDATE) and check the rules again under it, and
 * `tier_grants_birthday_key` keeps one grant per account and birthday whatever happens; a date of birth saved while a
 * pass runs (the profile's save takes the same row FOR NO KEY UPDATE) is seen by it: the credit is given for the date
 * as it was, or not at all, and nothing deadlocks.
 *
 * On PGlite (always) the calls are issued together and the database serialises their transactions: every order must
 * give a correct result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run, in genome-ci:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/birthday-credits-concurrency.test.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AuditService } from '../../src/server/services/audit.js';
import { BirthdayCreditService } from '../../src/server/services/birthday-credits.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

interface Backend {
  name: string;
  skip: boolean;
  open(): Promise<{ db: Db; close(): Promise<void> }>;
}

const BACKENDS: Backend[] = [
  {
    name: 'PGlite',
    skip: false,
    async open() {
      const t = await createTestDb();
      return { db: t.db, close: () => t.close() };
    },
  },
  {
    name: 'PostgreSQL',
    skip: !adminUrl,
    async open() {
      const admin = createDb(adminUrl!);
      const name = `orbes_birthdays_${randomBytes(6).toString('hex')}`;
      await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
      const u = new URL(adminUrl!);
      u.pathname = `/${name}`;
      const db = createDb(u.toString(), { poolMax: 8 });
      await migrateToLatest(db);
      return {
        db,
        async close() {
          await closeDb(db);
          await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
          await closeDb(admin);
        },
      };
    },
  },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.skip)(`the birthday credit's grant under concurrency, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    // 14 March 2027, 00:05 Paris.
    const clock = createManualClock('2027-03-13T23:05:00.000Z');
    /** Two processes' services over the same database. */
    let passes: BirthdayCreditService[];

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      passes = [0, 1, 2, 3].map(() => new BirthdayCreditService({ db, audit: new AuditService({ db, clock: clock.now }), clock: clock.now }));
    }, 60_000);
    afterAll(() => close?.());

    /** An account born on `birthDate`, the date on the account since January. */
    async function born(birthDate: string): Promise<string> {
      const email = `birthday-${randomUUID()}@example.com`;
      const id = (await db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
      await db.insertInto('account_profiles').values({ account_id: id, birth_date: birthDate, birth_date_by: 'COLLECTOR', birth_date_at: new Date('2027-01-10T09:00:00.000Z'), birth_date_collector_at: new Date('2027-01-10T09:00:00.000Z') }).execute();
      return id;
    }
    const grantsOf = (accountId: string) => db.selectFrom('tier_grants').select(['birthday_on', 'amount_minor']).where('account_id', '=', accountId).where('kind', '=', 'BIRTHDAY').execute();
    const auditsOf = (accountId: string) => db.selectFrom('audit_logs').select('id').where('target_id', '=', accountId).where('action', '=', 'club.grant').execute();

    it('four passes at once over 12 birthdays give one credit each, each audited once', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) ids.push(await born(`19${70 + i}-03-14`));
      const given = await Promise.all(passes.map((p) => p.grantDue(clock.now())));
      expect(given.reduce((a, b) => a + b, 0)).toBe(12);
      for (const id of ids) {
        expect(await grantsOf(id)).toEqual([{ birthday_on: '2027-03-14', amount_minor: 2_000 }]);
        expect(await auditsOf(id)).toHaveLength(1);
      }
      // The passes after them give nothing.
      expect(await Promise.all(passes.map((p) => p.grantDue(clock.now())))).toEqual([0, 0, 0, 0]);
    }, 60_000);

    it('a date of birth changed while the passes run gives the credit of the date as it was, or none: never both, never a deadlock', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) ids.push(await born(`19${80 + i}-03-13`));
      // 13 March's birthday is caught up on the 14th; meanwhile Client Services' change moves each date to 14 March,
      // on its birthday: no credit for the new date this year (question 20).
      const change = (id: string) =>
        db.transaction().execute(async (tx) => {
          await tx.selectFrom('accounts').select('id').where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
          await tx.updateTable('account_profiles').set({ birth_date: '1990-03-14', birth_date_by: 'STAFF', birth_date_at: clock.now() }).where('account_id', '=', id).execute();
        });
      await Promise.all([...passes.map((p) => p.grantDue(clock.now())), ...ids.map((id) => change(id))]);
      await Promise.all(passes.map((p) => p.grantDue(clock.now())));
      for (const id of ids) {
        const grants = await grantsOf(id);
        expect(grants.length).toBeLessThanOrEqual(1);
        // Whichever came first, nothing was given for 14 March: the date was not on the account before it.
        expect(grants.map((g) => g.birthday_on).filter((d) => d !== '2027-03-13')).toEqual([]);
        expect(await auditsOf(id)).toHaveLength(grants.length);
      }
    }, 60_000);
  });
}
