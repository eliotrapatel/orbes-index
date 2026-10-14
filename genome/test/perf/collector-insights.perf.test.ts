/**
 * The Collectors page and Segments at the house's stress volume, on PostgreSQL (plan CUSTOMER INTELLIGENCE §3.6
 * C.5.3, C.6.8 and C.13 « Performance », step 9.14). Opt-in, as every PostgreSQL suite here; genome-ci runs it:
 *
 *   ORBES_TEST_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres npx vitest run test/perf/collector-insights.perf.test.ts
 *
 * The role needs CREATEDB: the run creates a throwaway database, migrates it, writes the house of
 * test/perf/collector-insights.house.ts (20,000 counted collectors, 5,000 test accounts, 3 M raw views over 13 months
 * with their days counted and closed months written by the views' own job), then drops it. It checks:
 *
 *  - each panel within C.6.8's budget, cold (the page's cache emptied before each reading), for the view the page opens
 *    on (LAST 30 DAYS, compared with the period before, every collector); Over time for each of its eight figures and
 *    split by country; a list (the collectors behind a figure) for six slices. The same readings over LAST 12 MONTHS
 *    are timed and printed beside them, for the docs (DATABASE §11.4), not held to the budgets: C.6.8 sets one budget
 *    per panel, and 12 months of BY VISITS or of the views of 20,000 collectors read about a million raw rows;
 *  - EXPLAIN of every statement of the panel likes over LAST 12 MONTHS that reads `collector_views`: never a
 *    sequential scan of it (its time index or its account index is read);
 *  - Segments with every new criterion in one segment (C.5.3): `isSegmentMember` under 20 ms and `count` under 1.5 s,
 *    for a segment of ALL of them and one of ANY;
 *  - the export at 20,000 collectors: its body under C.7's 20 MB, within its own 60 s.
 *
 * Each figure is the best of three readings: the suite's other files run beside this one on the same runner, and their
 * load is not the code's. Every timing is printed, so the CI log keeps the measured figures.
 */
import { randomBytes } from 'node:crypto';
import { Kysely, PostgresDialect, sql, CompiledQuery } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, poolOf, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import type { Database } from '../../src/server/db/schema.js';
import { AuditService } from '../../src/server/services/audit.js';
import { CollectorInsightsService, COLLECTOR_PANELS, TREND_FIGURES, type CollectorPanel, type InsightsRequest } from '../../src/server/services/collector-insights.js';
import { LinkService } from '../../src/server/services/links.js';
import { isSegmentMember, SegmentService } from '../../src/server/services/segments.js';
import { everyNewCriterion, PERF_BUDGETS_MS, PERF_HOUSE, PERF_NOW, scansOf, seedInsightsHouse, timeBest, type LoggedQuery, type PerfHouse } from './collector-insights.house.js';

const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;
/** The house's writing, on a shared CI runner: the views, their 395 days counted, the rest. */
const SEED_MS = 25 * 60_000;

describe.skipIf(!adminUrl)('the Collectors page and Segments at 20,000 collectors (PostgreSQL)', () => {
  let admin: Db;
  let db: Db;
  let house: PerfHouse;
  let insights: CollectorInsightsService;
  let links: LinkService;
  let audit: AuditService;
  const dbName = `orbes_perf_${randomBytes(6).toString('hex')}`;
  const figures: string[] = [];
  const note = (line: string) => {
    figures.push(line);
    process.stdout.write(`[collector-insights.perf] ${line}\n`);
  };

  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 4, statementTimeoutMs: 0 });
    await migrateToLatest(db);
    const t0 = Date.now();
    house = await seedInsightsHouse(db, { log: (m) => note(`seed ${((Date.now() - t0) / 1000).toFixed(0)} s: ${m}`) });
    audit = new AuditService({ db, clock: () => PERF_NOW });
    links = new LinkService({ db, audit, publicOrigin: 'https://verify.orbes.bench', clock: () => PERF_NOW });
    insights = new CollectorInsightsService({ db, audit, links, clock: () => PERF_NOW });
  }, SEED_MS);

  afterAll(async () => {
    if (figures.length) process.stdout.write(`[collector-insights.perf] summary\n  ${figures.filter((f) => !f.startsWith('seed')).join('\n  ')}\n`);
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  /** One panel's reading, cold: the page's cache emptied first, so the database is read. */
  const cold = (req: InsightsRequest) => async () => {
    insights.clearCache();
    return insights.report(req);
  };

  it('holds the stress volume it was asked for', async () => {
    const n = async (q: string) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.raw(q)}`.execute(db)).rows[0]!.n);
    expect(house.collectors).toBe(PERF_HOUSE.collectors);
    expect(await n('test_entrants')).toBe(PERF_HOUSE.testAccounts);
    expect(await n('collector_views')).toBe(PERF_HOUSE.views);
    expect(house.days).toBeGreaterThanOrEqual(390);
    expect(await n('collector_view_months')).toBeGreaterThan(0);
    expect(await n('account_scores')).toBeGreaterThan(15_000);
    expect(await n('collector_history')).toBeGreaterThan(15_000);
  });

  it('reads each panel within its budget (LAST 30 DAYS, compared)', async () => {
    for (const panel of COLLECTOR_PANELS) {
      const t = await timeBest(cold({ panel, p: '30d' }));
      const budget = PERF_BUDGETS_MS[panel as CollectorPanel];
      note(`${panel} 30d: ${t.best} ms (budget ${budget}; ${t.all.join(', ')})`);
      expect(t.best, panel).toBeLessThan(budget);
    }
  }, 600_000);

  it('reads Over time within its budget for every figure, and split by country', async () => {
    for (const figure of TREND_FIGURES) {
      const t = await timeBest(cold({ panel: 'trends', p: '30d', figure }));
      note(`trends ${figure} 30d: ${t.best} ms (${t.all.join(', ')})`);
      expect(t.best, figure).toBeLessThan(PERF_BUDGETS_MS.trends);
    }
    const t = await timeBest(cold({ panel: 'trends', p: '30d', figure: 'collectors', split: 'country' }));
    note(`trends collectors by country 30d: ${t.best} ms (${t.all.join(', ')})`);
    expect(t.best).toBeLessThan(PERF_BUDGETS_MS.trends);
  }, 600_000);

  it('times the same readings over LAST 12 MONTHS, for the docs', async () => {
    for (const panel of COLLECTOR_PANELS) {
      const t = await timeBest(cold({ panel, p: '12m' }), 2);
      note(`${panel} 12m: ${t.best} ms (${t.all.join(', ')})`);
    }
    for (const figure of TREND_FIGURES) {
      const t = await timeBest(cold({ panel: 'trends', p: '12m', figure }), 2);
      note(`trends ${figure} 12m: ${t.best} ms (${t.all.join(', ')})`);
    }
    // A reading cut by the page's own timeout (8 s) throws 503 INSIGHTS_TIMEOUT and fails this case.
  }, 600_000);

  it('reads the collectors behind a figure within its budget', async () => {
    const slices = ['all', 'country:FR', 'score:60-69', `wishmodel:${house.mainModels[0]}`, `source:channel:${house.channels[0]}`, 'status:dormant'];
    for (const slice of slices) {
      const t = await timeBest(() => insights.list({ p: '30d', slice }, { withCities: true }));
      note(`list ${slice.split(':')[0]}: ${t.best} ms (${t.all.join(', ')})`);
      expect(t.best, slice).toBeLessThan(PERF_BUDGETS_MS.list);
    }
  }, 300_000);

  it('never reads collector_views whole for What they like over 12 months', async () => {
    const logged: LoggedQuery[] = [];
    // The same pool, its statements logged: the panel's own SQL with its parameters.
    const logging = new Kysely<Database>({ dialect: new PostgresDialect({ pool: poolOf(db)! }), log: (e) => void logged.push({ sql: e.query.sql, parameters: e.query.parameters }) });
    await new CollectorInsightsService({ db: logging, audit, links, clock: () => PERF_NOW }).report({ panel: 'likes', p: '12m' });
    const reading = logged.filter((q) => /collector_views/.test(q.sql) && /^\s*(WITH|SELECT)\b/i.test(q.sql));
    expect(reading.length).toBeGreaterThan(0);
    const used = new Set<string>();
    await db.transaction().execute(async (tx) => {
      await sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`.execute(tx);
      await sql.raw(`SET LOCAL work_mem = '32MB'`).execute(tx);
      for (const q of reading) {
        const r = await tx.executeQuery<{ 'QUERY PLAN': unknown }>(CompiledQuery.raw(`EXPLAIN (FORMAT JSON) ${q.sql}`, [...q.parameters]));
        const scans = scansOf(r.rows[0]!['QUERY PLAN'], 'collector_views');
        for (const s of scans) {
          expect(s.type, q.sql.slice(0, 200)).not.toBe('Seq Scan');
          if (s.index) used.add(s.index);
        }
      }
    });
    note(`likes 12m EXPLAIN: ${reading.length} statements over collector_views, indexes ${[...used].sort().join(', ')}`);
    expect([...used].some((i) => i === 'collector_views_at_idx' || i === 'collector_views_account_idx')).toBe(true);
  }, 300_000);

  it('decides a segment holding every new criterion within its budgets', async () => {
    const segments = new SegmentService({ db, audit, clock: () => PERF_NOW });
    const staff = (await db.selectFrom('admin_users').select('id').where('email_normalized', '=', 'perf-admin@orbes.bench').executeTakeFirstOrThrow()).id;
    const accounts = (
      await sql<{ id: string }>`SELECT id FROM accounts WHERE email LIKE 'perf-c-%' AND status = 'ACTIVE' ORDER BY abs(hashtext(id::text)) LIMIT 20`.execute(db)
    ).rows.map((r) => r.id);
    for (const match of ['ALL', 'ANY'] as const) {
      const criteria = everyNewCriterion(house, match);
      const seg = await segments.create({ name: `Perf every new criterion ${match}`, criteria }, { type: 'admin', id: staff });
      const count = await timeBest(() => segments.count(criteria));
      const members = (await segments.count(criteria)).count;
      note(`segment ${match}: count ${count.best} ms (${members} members; ${count.all.join(', ')})`);
      expect(count.best, `count ${match}`).toBeLessThan(PERF_BUDGETS_MS.segmentCount);
      const times: number[] = [];
      for (const id of [house.collector, ...accounts]) {
        await isSegmentMember(db, seg.id, id, PERF_NOW);
        times.push((await timeBest(() => isSegmentMember(db, seg.id, id, PERF_NOW))).best);
      }
      times.sort((a, b) => a - b);
      note(`segment ${match}: isSegmentMember median ${times[Math.floor(times.length / 2)]} ms, slowest ${times[times.length - 1]} ms over ${times.length} accounts`);
      for (const t of times) expect(t, `isSegmentMember ${match}`).toBeLessThan(PERF_BUDGETS_MS.isSegmentMember);
    }
  }, 300_000);

  it('makes the export of 20,000 collectors under 20 MB', async () => {
    const staff = (await db.selectFrom('admin_users').select('id').where('email_normalized', '=', 'perf-admin@orbes.bench').executeTakeFirstOrThrow()).id;
    const t0 = performance.now();
    const file = await insights.exportCsv({}, { type: 'admin', id: staff });
    const ms = Math.round(performance.now() - t0);
    const bytes = file.body.reduce((n, line) => n + Buffer.byteLength(line, 'utf8') + 2, 0);
    note(`export: ${file.rows} rows, ${(bytes / 1_048_576).toFixed(1)} MB, ${ms} ms`);
    expect(file.rows).toBe(PERF_HOUSE.collectors);
    expect(bytes).toBeLessThan(20 * 1_048_576);
  }, 120_000);
});
