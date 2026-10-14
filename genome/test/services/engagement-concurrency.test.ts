/**
 * The engagement score under concurrency (plan CUSTOMER INTELLIGENCE §3.5 SB.3.3 step 2, SB.3.5 « Concurrency », SB.3.7,
 * steps 7.3 and 7.4): two processes' passes claim the Paris day with one `INSERT … ON CONFLICT … RETURNING`, so one
 * runs and the others stop; batches racing over the same accounts write each row once (the upsert rewrites nothing that
 * does not differ); a stale claim is taken over by one pass only.
 *
 * On PGlite (always) the calls are issued together and the database serialises them: every order must give a correct
 * result. On PostgreSQL (opt-in, a pool of 8: true parallelism) the same cases run, in genome-ci; they are also where
 * the score's SQL (the batch's `= ANY`, the Paris days' `width_bucket`, `DISTINCT ON`, the row comparison of the upsert,
 * the clean-up's `DELETE … USING`) meets a real PostgreSQL:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/services/engagement-concurrency.test.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { ENGAGEMENT_FORMULA, scoreOf } from '../../src/server/services/engagement-formula.js';
import { EngagementService } from '../../src/server/services/engagement.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { GrowthWorld } from '../support/growth.js';

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
      const name = `orbes_engagement_${randomBytes(6).toString('hex')}`;
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
  describe.skipIf(backend.skip)(`the engagement score under concurrency, on ${backend.name}`, () => {
    let db: Db;
    let close: () => Promise<void>;
    // 2 November 2026, 09:00 Paris: in the morning window.
    const NOW = new Date('2026-11-02T08:00:00.000Z');
    const clock = createManualClock(NOW.toISOString());
    /** Four processes' services over the same database. */
    let passes: EngagementService[];
    const ids: string[] = [];
    const rowsOf = async () => db.selectFrom('account_scores').selectAll().orderBy('account_id').execute();

    beforeAll(async () => {
      ({ db, close } = await backend.open());
      passes = [0, 1, 2, 3].map(() => new EngagementService({ db, clock: clock.now, sleep: async () => undefined }));
      const w = await new GrowthWorld(db).prepare();
      const ring = await w.model('MONOLITHE', { price: [30_000, 'EUR'] });
      const pound = await w.model('AURA', { price: [10_000, 'GBP'] });
      const draw = await w.drop({ mode: 'DRAW', modelId: ring, title: 'A DRAW', opens: '2026-09-01', quantity: 50 });
      const device = (
        await db.insertInto('tracking_devices').values({ device_hash: randomBytes(32).toString('base64url').slice(0, 43), kind: 'PHONE', os: 'IOS', browser: 'SAFARI' }).returning('id').executeTakeFirstOrThrow()
      ).id;
      // 24 accounts, each with a little of everything the score reads.
      for (let n = 0; n < 24; n++) {
        const id = await w.account('2025-06-01', 'FR');
        ids.push(id);
        for (let day = 0; day <= n % 5; day++) {
          await db.insertInto('collector_views').values({ at: new Date(`2026-10-${String(10 + day).padStart(2, '0')}T21:${String(30 + n).padStart(2, '0')}:00Z`), device_id: device, account_id: id, page: VIEW_PAGE_CODES.SCAN, subject: null, seconds: 0, place_id: null }).execute();
        }
        if (n % 2 === 0) await w.drawEntry(draw.id, id, 'CONFIRMED', '2026-09-01');
        if (n % 3 === 0) await w.order({ accountId: id, modelId: ring, channel: 'SALON', paid: '2026-08-10', total: 30_000 * (1 + (n % 4)), currency: 'EUR' });
        if (n % 4 === 0) await w.order({ accountId: id, modelId: pound, channel: 'SALON', paid: '2026-07-10', total: 10_000, currency: 'GBP' });
        if (n % 6 === 0) await w.own(id, await w.piece(ring), 'FIRST_REGISTRATION', '2026-06-15');
      }
    }, 120_000);
    afterAll(() => close?.());

    it('four batches at once over the same accounts write each row once, as one batch alone would', async () => {
      const results = await Promise.all(passes.map((p) => p.scoreBatch(ids, NOW)));
      expect(results.reduce((n, r) => n + r.changed, 0)).toBe(ids.length);
      for (const r of results) expect(r.scores.size).toBe(ids.length);
      const rows = await rowsOf();
      expect(rows).toHaveLength(ids.length);
      // Each row is the formula applied to its account's figures, read again.
      const inputs = await passes[0]!.inputsFor(db, ids, NOW);
      for (const row of rows) {
        const s = scoreOf(inputs.get(row.account_id)!, NOW);
        expect(row).toMatchObject({
          formula: ENGAGEMENT_FORMULA, score: s.score, recency_points: s.parts.recency, frequency_points: s.parts.frequency, spend_points: s.parts.spend, speed_points: s.parts.speed, attendance_points: s.parts.attendance,
          active_days: s.inputs.activeDays, spend_eur_minor: s.inputs.spendEurMinor, purchases: s.inputs.purchases, other_currencies: s.inputs.otherCurrencies, releases_taken: s.inputs.releasesTaken, releases_open: s.inputs.releasesOpen, changed_at: NOW,
        });
      }
      // The figures are not all alike: the fixture reaches several values of each part.
      expect(new Set(rows.map((r) => r.score)).size).toBeGreaterThan(4);
      expect(rows.some((r) => r.other_currencies.includes('GBP'))).toBe(true);
      expect(new Set(rows.map((r) => r.active_days)).size).toBeGreaterThanOrEqual(5);
      // Again, later: nothing differs, nothing is written.
      const again = await Promise.all(passes.map((p) => p.scoreBatch(ids, new Date(NOW.getTime() + 60_000))));
      expect(again.map((r) => r.changed)).toEqual([0, 0, 0, 0]);
      expect(await rowsOf()).toEqual(rows);
    }, 60_000);

    it('four passes at once give one run of the day', async () => {
      const before = await rowsOf();
      const runs = await Promise.all(passes.map((p) => p.runIfDue(NOW)));
      const ran = runs.filter((r) => r !== null);
      expect(ran).toHaveLength(1);
      expect(ran[0]).toMatchObject({ day: '2026-11-02', accounts: ids.length, changed: 0 });
      expect(ran[0]!.bands.reduce((a, b) => a + b, 0)).toBe(ids.length);
      expect(await db.selectFrom('engagement_runs').select(['day', 'formula', 'accounts', 'changed']).execute()).toEqual([{ day: '2026-11-02', formula: ENGAGEMENT_FORMULA, accounts: ids.length, changed: 0 }]);
      expect(await rowsOf()).toEqual(before);
      // The passes after them do nothing.
      expect(await Promise.all(passes.map((p) => p.runIfDue(new Date(NOW.getTime() + 600_000))))).toEqual([null, null, null, null]);
    }, 60_000);

    it('a stale claim is taken over by one pass only, and a deleted account\'s row is removed once', async () => {
      const tomorrow = new Date(NOW.getTime() + 86_400_000);
      await db.insertInto('engagement_runs').values({ day: '2026-11-03', formula: ENGAGEMENT_FORMULA, started_at: new Date(tomorrow.getTime() - 21 * 60_000) }).execute();
      await db.updateTable('accounts').set({ status: 'DELETED' }).where('id', '=', ids[0]!).execute();
      const runs = await Promise.all(passes.map((p) => p.runIfDue(tomorrow)));
      const ran = runs.filter((r) => r !== null);
      expect(ran).toHaveLength(1);
      expect(ran[0]!.accounts).toBe(ids.length - 1);
      expect(await db.selectFrom('account_scores').select('account_id').where('account_id', '=', ids[0]!).execute()).toEqual([]);
      const row = await db.selectFrom('engagement_runs').selectAll().where('day', '=', '2026-11-03').executeTakeFirstOrThrow();
      expect(row).toMatchObject({ started_at: tomorrow, accounts: ids.length - 1 });
      expect(row.finished_at).not.toBeNull();
      expect(row.bands!.reduce((a, b) => a + b, 0)).toBe(ids.length - 1);
    }, 60_000);
  });
}
