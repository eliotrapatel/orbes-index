/**
 * Daily scan statistics (services/scan-stats.ts, recommendation A-09): the
 * complete UTC days counted by country, state and event type, staff scans
 * left out, each day counted once and never lowered by the purge that
 * follows, housekeeping counting before it purges, and the report the
 * console reads. The last block runs on the demo dataset.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, type AppContext } from '../../src/server/context.js';
import type { Db } from '../../src/server/db/connection.js';
import type { NewScanEvent, ScanDailyStatsRow } from '../../src/server/db/schema.js';
import { DEMO_TIMELINE_START, seedDemo } from '../../src/server/db/seed/demo.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import {
  addDays,
  aggregateScanStats,
  ANALYTICS_MAX_DAYS,
  analyticsWindow,
  daySpan,
  lastCompleteDay,
  scanStatsReport,
  SCAN_STATS_SETTLE_MS,
  SIGNAL_STATES,
} from '../../src/server/services/scan-stats.js';
import { createManualClock, type Logger } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const DAY = 86_400_000;

async function scan(db: Db, at: string | Date, v: Partial<NewScanEvent> = {}): Promise<void> {
  await db
    .insertInto('scan_events')
    .values({ occurred_at: at instanceof Date ? at : new Date(at), event_type: 'VERIFY', result_state: 'AUTHENTIC', country: 'FR', ...v })
    .execute();
}

async function stats(db: Db): Promise<ScanDailyStatsRow[]> {
  return db.selectFrom('scan_daily_stats').selectAll().orderBy('day').orderBy('country').orderBy('result_state').orderBy('event_type').execute();
}

/** What the statistics must hold: the scans before `beforeDay`, counted straight from the history. */
async function countedFromHistory(db: Db, beforeDay: string): Promise<ScanDailyStatsRow[]> {
  const r = await sql<ScanDailyStatsRow>`
    SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, COALESCE(country, 'ZZ') AS country, result_state, event_type, count(*)::int AS n
    FROM scan_events
    WHERE occurred_at < ${new Date(`${beforeDay}T00:00:00.000Z`)} AND event_type <> 'ADMIN_TEST'
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4`.execute(db);
  return r.rows;
}

function captureLog(): Logger & { lines: { level: string; o: unknown; m?: string }[] } {
  const lines: { level: string; o: unknown; m?: string }[] = [];
  return {
    lines,
    info: (o, m) => lines.push({ level: 'info', o, m }),
    warn: (o, m) => lines.push({ level: 'warn', o, m }),
    error: (o, m) => lines.push({ level: 'error', o, m }),
  };
}

describe('day arithmetic', () => {
  it('names the last complete UTC day: yesterday, once ten minutes into today', () => {
    expect(SCAN_STATS_SETTLE_MS).toBe(10 * 60_000);
    expect(lastCompleteDay(new Date('2026-10-02T09:00:00.000Z'))).toBe('2026-10-01');
    expect(lastCompleteDay(new Date('2026-10-02T00:10:00.000Z'))).toBe('2026-10-01');
    expect(lastCompleteDay(new Date('2026-10-02T00:09:59.999Z'))).toBe('2026-09-30');
    expect(lastCompleteDay(new Date('2026-03-01T12:00:00.000Z'))).toBe('2026-02-28');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(daySpan('2026-10-01', '2026-10-01')).toBe(1);
    expect(daySpan('2025-10-01', '2026-10-01')).toBe(366);
    expect(daySpan('2026-10-02', '2026-10-01')).toBe(0);
  });

  it('resolves the report window: 30 days to yesterday by default, at most 366 days', () => {
    const now = new Date('2026-10-02T09:00:00.000Z');
    expect(analyticsWindow({}, now)).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(analyticsWindow({ days: 90 }, now)).toEqual({ from: '2026-07-04', to: '2026-10-01' });
    expect(analyticsWindow({ days: 1, to: '2026-05-01' }, now)).toEqual({ from: '2026-05-01', to: '2026-05-01' });
    expect(analyticsWindow({ from: '2026-09-25' }, now)).toEqual({ from: '2026-09-25', to: '2026-10-01' });
    expect(analyticsWindow({ from: '2025-10-01' }, now)).toEqual({ from: '2025-10-01', to: '2026-10-01' });
    expect(daySpan('2025-10-01', '2026-10-01')).toBe(ANALYTICS_MAX_DAYS);
    expect(() => analyticsWindow({ from: '2025-09-30' }, now)).toThrow(/at most 366 days/);
    expect(() => analyticsWindow({ from: '2026-10-02' }, now)).toThrow(/from must not be after to/);
    expect(() => analyticsWindow({ days: 367 }, now)).toThrow(/at most 366 days/);
  });
});

describe('aggregateScanStats', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it('counts the complete UTC days by country, state and event type: ZZ for an unknown country, staff scans never', async () => {
    const db = t.db;
    await scan(db, '2026-04-28T00:00:00.000Z');
    await scan(db, '2026-04-28T23:59:59.999Z');
    await scan(db, '2026-04-28T12:00:00.000Z', { country: 'JP' });
    await scan(db, '2026-04-28T12:00:00.000Z', { country: null, result_state: 'INVALID_SIGNATURE' });
    await scan(db, '2026-04-28T12:00:00.000Z', { event_type: 'REGISTER', result_state: 'AUTHENTIC_FIRST_REGISTRATION' });
    await scan(db, '2026-04-28T12:00:00.000Z', { event_type: 'ADMIN_TEST' });
    await scan(db, '2026-04-29T08:00:00.000Z', { country: 'CN', result_state: 'UNKNOWN' });
    await scan(db, '2026-04-29T08:00:00.000Z', { country: 'CN', result_state: 'UNKNOWN', event_type: 'ADMIN_TEST' });
    await scan(db, '2026-04-30T08:00:00.000Z', { result_state: 'MALFORMED_CODE' }); // today: not complete

    expect(await aggregateScanStats(db, new Date('2026-04-30T09:00:00.000Z'))).toBe(5);
    expect(await stats(db)).toEqual([
      { day: '2026-04-28', country: 'FR', result_state: 'AUTHENTIC', event_type: 'VERIFY', n: 2 },
      { day: '2026-04-28', country: 'FR', result_state: 'AUTHENTIC_FIRST_REGISTRATION', event_type: 'REGISTER', n: 1 },
      { day: '2026-04-28', country: 'JP', result_state: 'AUTHENTIC', event_type: 'VERIFY', n: 1 },
      { day: '2026-04-28', country: 'ZZ', result_state: 'INVALID_SIGNATURE', event_type: 'VERIFY', n: 1 },
      { day: '2026-04-29', country: 'CN', result_state: 'UNKNOWN', event_type: 'VERIFY', n: 1 },
    ]);
  });

  it('is idempotent, counts each day once and never lowers a day whose scans are purged', async () => {
    const db = t.db;
    const before = await stats(db);
    expect(await aggregateScanStats(db, new Date('2026-04-30T09:00:00.000Z'))).toBe(0);
    expect(await stats(db)).toEqual(before);

    // The purge takes 28 and 29 April; a scan recorded late for 29 April is not counted either.
    await db.deleteFrom('scan_events').where('occurred_at', '<', new Date('2026-04-30T00:00:00.000Z')).execute();
    await scan(db, '2026-04-29T18:00:00.000Z', { country: 'CN', result_state: 'UNKNOWN' });
    // 30 April is over but not ten minutes old: still not counted.
    expect(await aggregateScanStats(db, new Date('2026-05-01T00:09:00.000Z'))).toBe(0);
    expect(await stats(db)).toEqual(before);

    expect(await aggregateScanStats(db, new Date('2026-05-01T00:10:00.000Z'))).toBe(1);
    expect(await stats(db)).toEqual([...before, { day: '2026-04-30', country: 'FR', result_state: 'MALFORMED_CODE', event_type: 'VERIFY', n: 1 }]);
    // Days without a scan write nothing; the next scanned day is counted when it is complete.
    await scan(db, '2026-05-04T10:00:00.000Z', { country: 'IT' });
    expect(await aggregateScanStats(db, new Date('2026-05-04T23:00:00.000Z'))).toBe(0);
    expect(await aggregateScanStats(db, new Date('2026-05-05T06:00:00.000Z'))).toBe(1);
    expect((await stats(db)).at(-1)).toEqual({ day: '2026-05-04', country: 'IT', result_state: 'AUTHENTIC', event_type: 'VERIFY', n: 1 });
  });

  it('reports a window: every day of it, the states, the event types, the countries and their signals', async () => {
    const r = await scanStatsReport(t.db, { from: '2026-04-27', to: '2026-05-04' }, new Date('2026-05-05T06:00:00.000Z'));
    expect(r).toMatchObject({ from: '2026-04-27', to: '2026-05-04', days: 8, through: '2026-05-04', total: 8 });
    expect(r.daily.map((d) => [d.day, d.total])).toEqual([
      ['2026-04-27', 0],
      ['2026-04-28', 5],
      ['2026-04-29', 1],
      ['2026-04-30', 1],
      ['2026-05-01', 0],
      ['2026-05-02', 0],
      ['2026-05-03', 0],
      ['2026-05-04', 1],
    ]);
    expect(r.daily[1].byState).toMatchObject({ AUTHENTIC: 3, AUTHENTIC_FIRST_REGISTRATION: 1, INVALID_SIGNATURE: 1, UNKNOWN: 0 });
    expect(Object.keys(r.daily[0].byState)).toHaveLength(9);
    expect(r.byState).toMatchObject({ AUTHENTIC: 4, AUTHENTIC_FIRST_REGISTRATION: 1, INVALID_SIGNATURE: 1, UNKNOWN: 1, MALFORMED_CODE: 1, SUSPICIOUS_ACTIVITY: 0 });
    expect(r.byEventType).toEqual({ VERIFY: 7, REGISTER: 1, TRANSFER: 0 });
    expect(r.signals).toEqual({ INVALID_SIGNATURE: 1, UNKNOWN: 1, MALFORMED_CODE: 1, SUSPICIOUS_ACTIVITY: 0, total: 3 });
    expect(r.countries.map((c) => [c.country, c.total, c.signals])).toEqual([
      ['FR', 4, 1],
      ['CN', 1, 1],
      ['IT', 1, 0],
      ['JP', 1, 0],
      ['ZZ', 1, 1],
    ]);
    expect(r.countries.find((c) => c.country === 'ZZ')!.byState.INVALID_SIGNATURE).toBe(1);

    const narrow = await scanStatsReport(t.db, { from: '2026-04-29', to: '2026-04-29' }, new Date('2026-05-05T06:00:00.000Z'));
    expect(narrow.total).toBe(1);
    expect(narrow.countries.map((c) => c.country)).toEqual(['CN']);
    expect(SIGNAL_STATES).toEqual(['INVALID_SIGNATURE', 'UNKNOWN', 'MALFORMED_CODE', 'SUSPICIOUS_ACTIVITY']);
  });
});

describe('housekeeping', () => {
  it('counts the complete days before it purges, leaves the counts unchanged, and purges nothing when the count fails', async () => {
    const t = await createTestDb();
    const clock = createManualClock('2026-05-01T09:00:00.000Z');
    const log = captureLog();
    const ctx = await createContext(testConfig({ scanRetentionDays: 30 }), { db: t.db, clock: clock.now, log });
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    try {
      const at = (daysAgo: number) => new Date(clock.now().getTime() - daysAgo * DAY);
      for (const daysAgo of [400, 120, 31, 29, 1]) await scan(t.db, at(daysAgo), { country: daysAgo > 100 ? 'GB' : 'FR' });
      await scan(t.db, at(31), { event_type: 'ADMIN_TEST' });

      const expected = await countedFromHistory(t.db, '2026-05-01');
      expect(expected.reduce((a, r) => a + r.n, 0)).toBe(5);
      const first = await hk.runOnce();
      expect(first).toMatchObject({ scanStats: 5, scanHistory: 4 });
      expect(await stats(t.db)).toEqual(expected);
      expect(await t.db.selectFrom('scan_events').select('id').execute()).toHaveLength(2);
      expect(log.lines.some((l) => l.level === 'info' && (l.o as { scanStats?: number }).scanStats === 5)).toBe(true);

      // A later pass: nothing new, nothing lowered.
      expect(await hk.runOnce()).toMatchObject({ scanStats: 0, scanHistory: 0 });
      expect(await stats(t.db)).toEqual(expected);

      // Thirty days later the two remaining scans are due, but the count fails: nothing is purged.
      clock.advance(30 * DAY);
      await sql`ALTER TABLE scan_daily_stats RENAME TO scan_daily_stats_off`.execute(t.db);
      expect(await hk.runOnce()).toMatchObject({ scanStats: 0, scanHistory: 0 });
      expect(log.lines.some((l) => l.level === 'error' && (l.o as { job?: string }).job === 'scanStats')).toBe(true);
      expect(await t.db.selectFrom('scan_events').select('id').execute()).toHaveLength(2);
      await sql`ALTER TABLE scan_daily_stats_off RENAME TO scan_daily_stats`.execute(t.db);
      expect(await hk.runOnce()).toMatchObject({ scanStats: 0, scanHistory: 2 });
      expect(await stats(t.db)).toEqual(expected);
    } finally {
      await hk.stop();
      await ctx.close();
      await t.close();
    }
  });
});

describe('on the demo dataset', () => {
  const NOW = new Date('2026-10-01T09:00:00.000Z');
  let t: TestDb;
  let ctx: AppContext;

  beforeAll(async () => {
    t = await createTestDb();
    const clock = createManualClock(DEMO_TIMELINE_START);
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    await seedDemo(ctx, { clock, now: NOW, accountPassword: 'demo-account-password-2026' });
  }, 180_000);

  afterAll(async () => {
    await ctx?.close();
    await t?.close();
  });

  it('counts every scan of every complete day of the demo, by country and state', async () => {
    const rows = await stats(t.db);
    expect(rows).toEqual(await countedFromHistory(t.db, '2026-10-01'));
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.at(-1)!.day).toBe('2026-09-30');
    const report = await scanStatsReport(t.db, analyticsWindow({ days: 366 }, NOW), NOW);
    expect(report.countries.map((c) => c.country)).toEqual(expect.arrayContaining(['FR', 'GB', 'IT', 'JP', 'US']));
    // Stolen pieces scanned by strangers (Barcelona; Paris and New York after Tokyo) and an old code revoked in London.
    expect(report.byState.SUSPICIOUS_ACTIVITY).toBeGreaterThanOrEqual(3);
    expect(report.byState.REVOKED).toBeGreaterThanOrEqual(1);
    expect(report.countries.find((c) => c.country === 'ES')!.byState.SUSPICIOUS_ACTIVITY).toBeGreaterThanOrEqual(1);
  });

  it('keeps the same figures after the scan history is purged, pass after pass', async () => {
    const before = await stats(t.db);
    const reportBefore = await scanStatsReport(t.db, analyticsWindow({ days: 366 }, NOW), NOW);
    const scansBefore = (await t.db.selectFrom('scan_events').select('id').execute()).length;

    const purging = await createContext(testConfig({ scanRetentionDays: 30 }), { db: t.db, clock: () => NOW, keyProvider: new MemoryKeyProvider({ env: 'test' }) });
    const hk = startHousekeeping(purging, { intervalMs: 3_600_000 });
    try {
      const pass = await hk.runOnce();
      expect(pass.scanStats).toBe(0);
      expect(pass.scanHistory).toBeGreaterThan(0);
      const left = await t.db.selectFrom('scan_events').select('occurred_at').orderBy('occurred_at').execute();
      expect(left.length).toBe(scansBefore - pass.scanHistory);
      expect(new Date(left[0].occurred_at).getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 30 * DAY);

      expect(await stats(t.db)).toEqual(before);
      expect(await scanStatsReport(t.db, analyticsWindow({ days: 366 }, NOW), NOW)).toEqual(reportBefore);
      expect(await hk.runOnce()).toMatchObject({ scanStats: 0, scanHistory: 0 });
      expect(await stats(t.db)).toEqual(before);
    } finally {
      await hk.stop();
      await purging.close();
    }
  });
});
