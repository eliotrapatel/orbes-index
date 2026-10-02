/**
 * Daily scan statistics over HTTP (A-09): GET /api/admin/analytics reads the
 * counted days for an AUDITOR, a window of at most 366 UTC days ending on the
 * last complete day by default, staff scans and today's scans left out, and
 * the same figures after the scan history is purged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousekeeping } from '../../src/server/context.js';
import type { NewScanEvent } from '../../src/server/db/schema.js';
import { aggregateScanStats } from '../../src/server/services/scan-stats.js';
import { adminClient, createHarness, errorOf, safeJson, type Client, type Harness } from './support.js';

const NOW = '2026-10-02T09:00:00.000Z';

describe('GET /api/admin/analytics', () => {
  let h: Harness;
  let auditor: Client;

  const get = async (url: string, status = 200): Promise<any> => {
    const res = await auditor.get(url);
    expect(res.statusCode, `${url} → ${res.body.slice(0, 200)}`).toBe(status);
    return safeJson(res);
  };

  async function scans(at: string, n: number, v: Partial<NewScanEvent> = {}): Promise<void> {
    for (let i = 0; i < n; i++) {
      await h.ctx.db
        .insertInto('scan_events')
        .values({ occurred_at: new Date(at), event_type: 'VERIFY', result_state: 'AUTHENTIC', country: 'FR', ...v })
        .execute();
    }
  }

  beforeAll(async () => {
    h = await createHarness({ config: { scanRetentionDays: 30 } });
    h.clock.set(NOW);
    auditor = await adminClient(h, 'AUDITOR');
    await scans('2026-10-01T10:00:00.000Z', 2);
    await scans('2026-10-01T11:00:00.000Z', 1, { country: 'CN', result_state: 'INVALID_SIGNATURE' });
    await scans('2026-10-01T12:00:00.000Z', 1, { country: null, result_state: 'UNKNOWN' });
    await scans('2026-10-01T13:00:00.000Z', 3, { event_type: 'ADMIN_TEST' });
    await scans('2026-09-15T08:00:00.000Z', 1, { country: 'GB', result_state: 'AUTHENTIC_OWNERSHIP_VERIFIED' });
    await scans('2026-09-15T09:00:00.000Z', 1, { country: 'ES', result_state: 'SUSPICIOUS_ACTIVITY' });
    await scans('2026-07-10T09:00:00.000Z', 1, { country: 'JP', result_state: 'MALFORMED_CODE' });
    await scans('2025-12-01T09:00:00.000Z', 1, { country: 'US' });
    await scans('2026-10-02T08:00:00.000Z', 4); // today: counted after midnight UTC
    await aggregateScanStats(h.ctx.db, h.clock.now());
  });
  afterAll(() => h?.close());

  it('gives an AUDITOR the last 30 complete days: the days, the states, the countries and their signals', async () => {
    const r = await get('/api/admin/analytics');
    expect(r).toMatchObject({ from: '2026-09-02', to: '2026-10-01', days: 30, through: '2026-10-01', total: 6 });
    expect(r.daily).toHaveLength(30);
    expect(r.daily[0]).toEqual({ day: '2026-09-02', total: 0, byState: expect.objectContaining({ AUTHENTIC: 0 }) });
    expect(r.daily.at(-1)).toMatchObject({ day: '2026-10-01', total: 4, byState: { AUTHENTIC: 2, INVALID_SIGNATURE: 1, UNKNOWN: 1 } });
    expect(r.daily.find((d: any) => d.day === '2026-09-15').total).toBe(2);
    expect(r.byEventType).toEqual({ VERIFY: 6, REGISTER: 0, TRANSFER: 0 });
    expect(r.signals).toEqual({ INVALID_SIGNATURE: 1, UNKNOWN: 1, MALFORMED_CODE: 0, SUSPICIOUS_ACTIVITY: 1, total: 3 });
    expect(r.countries.map((c: any) => [c.country, c.total, c.signals])).toEqual([
      ['FR', 2, 0],
      ['CN', 1, 1],
      ['ES', 1, 1],
      ['GB', 1, 0],
      ['ZZ', 1, 1],
    ]);
    // Anonymous: counts by day, state, type and country, nothing about a scan.
    expect(Object.keys(r.countries[0]).sort()).toEqual(['byState', 'country', 'signals', 'total']);
    const keys = new Set<string>();
    JSON.stringify(r, (k, v) => (keys.add(k), v));
    const allowed = ['', 'from', 'to', 'days', 'through', 'total', 'byState', 'byEventType', 'signals', 'daily', 'day', 'countries', 'country'];
    const unexpected = [...keys].filter((k) => !allowed.includes(k) && !/^\d+$/.test(k) && !/^[A-Z_]+$/.test(k));
    expect(unexpected).toEqual([]);
  });

  it('reads 90 days, a window by its two ends, or the days that end on a given day', async () => {
    const quarter = await get('/api/admin/analytics?days=90');
    expect(quarter).toMatchObject({ from: '2026-07-04', to: '2026-10-01', days: 90, total: 7 });
    expect(quarter.countries.find((c: any) => c.country === 'JP')).toMatchObject({ total: 1, signals: 1, byState: { MALFORMED_CODE: 1 } });

    const year = await get('/api/admin/analytics?from=2025-10-01&to=2026-10-01');
    expect(year).toMatchObject({ days: 366, total: 8 });
    expect(year.daily).toHaveLength(366);

    expect(await get('/api/admin/analytics?to=2026-09-15&days=1')).toMatchObject({ from: '2026-09-15', to: '2026-09-15', total: 2 });
    expect(await get('/api/admin/analytics?from=2026-10-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-01', days: 1, total: 4 });
    expect(await get('/api/admin/analytics?to=2026-09-15')).toMatchObject({ from: '2026-08-17', to: '2026-09-15', days: 30, total: 2 });
    expect(await get('/api/admin/analytics?from=&to=&days=')).toMatchObject({ from: '2026-09-02', to: '2026-10-01' });
  });

  it('refuses a window over 366 days, inverted, ambiguous or not made of days', async () => {
    for (const q of [
      'from=2025-09-30&to=2026-10-01',
      'from=2025-09-30',
      'days=367',
      'days=0',
      'days=30.5',
      'days=abc',
      'from=2026-10-02&to=2026-10-01',
      'from=2026-10-02',
      'from=2026-09-01&days=30',
      'from=2026-02-30',
      'to=2026-10-01T00:00:00Z',
    ]) {
      const res = await auditor.get(`/api/admin/analytics?${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(errorOf(res).code, q).toBe('VALIDATION_FAILED');
    }
    expect(errorOf(await auditor.get('/api/admin/analytics?from=2025-09-30')).message).toMatch(/366 days/);
    expect(errorOf(await auditor.get('/api/admin/analytics?from=2025-09-30&to=2026-10-01')).message).toMatch(/366 days/);
  });

  it('reads the same figures after the scan history is purged', async () => {
    const year = '/api/admin/analytics?from=2025-10-01&to=2026-10-01';
    const before = await get(year);
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      const pass = await hk.runOnce();
      // SCAN_RETENTION_DAYS=30: the July and December scans leave the history.
      expect(pass).toMatchObject({ scanStats: 0, scanHistory: 2 });
    } finally {
      await hk.stop();
    }
    expect(await h.ctx.db.selectFrom('scan_events').select('id').where('occurred_at', '<', new Date('2026-09-01T00:00:00.000Z')).execute()).toEqual([]);
    expect(await get(year)).toEqual(before);
    expect((await get('/api/admin/analytics?days=90')).countries.map((c: any) => c.country)).toContain('JP');
  });
});
