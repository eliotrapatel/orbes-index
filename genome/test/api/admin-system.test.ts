/**
 * GET /api/admin/system/status (test entrants §7): read by every console role from AUDITOR, `{ now, latest, history }`
 * with the sample's fields exactly as the console reads them; the app's sampler times every response, feeds a test's
 * peaks, starts with the app and stops when it closes; `visitorData`, Server status's « Visitor data » line (plan
 * CUSTOMER INTELLIGENCE §3.4 A.10.7, step 4.10): the daily `intelligence sizes` figures, read once on demand while
 * the process has none, a failed read tried again after 10 minutes and never an error of the route.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentRunPeaks, startRunPeaks, stopRunPeaks, type SystemSample, type SystemStatusView } from '../../src/server/services/system-status.js';
import { INTELLIGENCE_TABLES, intelligenceSizes, IntelligenceSizes, visitorDataOf } from '../../src/server/services/tracking-jobs.js';
import { adminClient, createHarness, errorOf, type Client, type Harness } from './support.js';

const URL = '/api/admin/system/status';

/** The sample's fields, group by group (the console's types read these). */
const FIELDS: Record<keyof Omit<SystemSample, 'at'>, string[]> = {
  app: ['memBytes', 'memLimitBytes', 'memPeakBytes', 'cpuCores', 'cpuLimitCores', 'throttledPct', 'pids', 'pidsMax'],
  host: ['memAvailableBytes', 'memTotalBytes', 'swapUsedBytes', 'load1', 'load5', 'cpuPct', 'diskUsedPct'],
  node: ['heapUsedBytes', 'heapLimitBytes', 'rssBytes', 'externalBytes', 'loopDelayP50Ms', 'loopDelayP99Ms', 'loopUtilPct'],
  live: ['streams', 'releases', 'accounts'],
  db: ['poolTotal', 'poolIdle', 'poolWaiting', 'connections', 'maxConnections', 'active', 'waiting'],
  http: ['rps', 'p95Ms', 'errors5xx', 'refused429'],
};

describe('GET /api/admin/system/status', () => {
  let h: Harness;
  let auditor: Client;

  beforeAll(async () => {
    h = await createHarness();
    auditor = await adminClient(h, 'AUDITOR');
  });
  afterAll(() => h?.close());

  it('answers an AUDITOR the newest sample and the last 10 minutes, every field a number or null', async () => {
    const res = await auditor.get(URL);
    expect(res.statusCode).toBe(200);
    const body = res.json() as SystemStatusView;
    expect(Object.keys(body).sort()).toEqual(['history', 'latest', 'now', 'visitorData']);
    expect(new Date(body.now).toISOString()).toBe(body.now);
    expect(body.history.length).toBeGreaterThanOrEqual(1);
    expect(body.history.length).toBeLessThanOrEqual(300);
    expect(body.latest).toEqual(body.history.at(-1));

    const s = body.latest;
    expect(Object.keys(s).sort()).toEqual(['app', 'at', 'db', 'host', 'http', 'live', 'node']);
    expect(new Date(s.at).toISOString()).toBe(s.at);
    for (const [group, keys] of Object.entries(FIELDS)) {
      const values = s[group as keyof typeof FIELDS] as Record<string, unknown>;
      expect(Object.keys(values).sort(), group).toEqual([...keys].sort());
      for (const k of keys) expect(values[k] === null || typeof values[k] === 'number', `${group}.${k}`).toBe(true);
    }
    // Node always answers; PGlite has no pool; the hub has no stream open.
    expect(s.node.heapUsedBytes).toBeGreaterThan(0);
    expect(s.node.rssBytes).toBeGreaterThan(0);
    for (const v of Object.values(s.db)) expect(v).toBeNull();
    expect(s.live).toEqual({ streams: 0, releases: 0, accounts: 0 });
  });

  it('carries the visitor data as last measured: in all and by part, measured once on demand, then the daily figures', async () => {
    // Plan CUSTOMER INTELLIGENCE §3.4 A.10.7: the bytes of the lot's growing tables (the `intelligence sizes` figures).
    const first = ((await auditor.get(URL)).json() as SystemStatusView).visitorData!;
    expect(Object.keys(first).sort()).toEqual(['at', 'conversionsBytes', 'devicesBytes', 'profilesBytes', 'totalBytes', 'viewsBytes', 'visitsBytes', 'wishesBytes']);
    const tables = await intelligenceSizes(h.t.db);
    expect(Object.keys(tables).sort()).toEqual([...INTELLIGENCE_TABLES].sort());
    expect(first).toEqual(visitorDataOf(tables, new Date(first.at)));
    expect(first.totalBytes).toBe(first.viewsBytes + first.devicesBytes + first.visitsBytes + first.conversionsBytes + first.wishesBytes + first.profilesBytes);
    expect(first.viewsBytes).toBe(tables.collector_views! + tables.view_daily_stats!);
    expect(first.profilesBytes).toBe(tables.account_profiles! + tables.account_tastes!);
    // Kept: the next read is the same measure, until the daily job measures again.
    expect(((await auditor.get(URL)).json() as SystemStatusView).visitorData).toEqual(first);
    h.clock.advance(60_000);
    await h.ctx.services.intelligenceSizes.measure();
    expect(((await auditor.get(URL)).json() as SystemStatusView).visitorData!.at).toBe(new Date(h.clock.now()).toISOString());
  });

  it('says null when the visitor data cannot be read, tries again 10 minutes later, and the status still answers', async () => {
    let now = Date.parse('2026-10-09T07:40:00Z');
    let broken = true;
    const db = new Proxy(h.t.db, {
      get: (target, key) => {
        if (broken && key === 'getExecutor') return () => { throw new Error('database unavailable'); };
        const v = Reflect.get(target, key) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const sizes = new IntelligenceSizes(db, () => new Date(now));
    expect(await sizes.visitorData()).toBeNull();
    broken = false;
    now += 9 * 60_000;
    expect(await sizes.visitorData()).toBeNull();
    now += 60_000;
    expect((await sizes.visitorData())?.at).toBe('2026-10-09T07:50:00.000Z');
    const { SystemStatus } = await import('../../src/server/services/system-status.js');
    const failing = new SystemStatus({ intervalMs: 0, visitorData: () => Promise.reject(new Error('no')) });
    expect((await failing.status()).visitorData).toBeNull();
  });

  it("times every response: the requests per second and the p95 of the last 60 s", async () => {
    for (let i = 0; i < 5; i++) expect((await h.client().get('/api/v1/health')).statusCode).toBe(200);
    await h.app.systemStatus.sample();
    const { latest } = (await auditor.get(URL)).json() as SystemStatusView;
    expect(latest.http.rps).toBeGreaterThan(0);
    expect(latest.http.p95Ms).not.toBeNull();
    expect(latest.http.errors5xx).toBe(0);
  });

  it("feeds a test's peaks with the app's samples", async () => {
    startRunPeaks('api-run');
    try {
      // A request refused by the guard is neither a 5xx nor a 429: the counters stay.
      expect((await h.client().get(URL)).statusCode).toBe(401);
      await h.app.systemStatus.sample();
      const peaks = currentRunPeaks('api-run')!;
      expect(peaks.liveStreams).toBe(0);
      expect(peaks.p95Ms).not.toBeNull();
      expect(peaks).toMatchObject({ dbConnections: null, poolWaiting: null, errors5xx: 0, refused429: 0 });
    } finally {
      stopRunPeaks('api-run');
    }
  });

  it('is refused to anonymous callers (401) and to RETAIL (403)', async () => {
    expect((await h.client().get(URL)).statusCode).toBe(401);
    const res = await (await adminClient(h, 'RETAIL')).get(URL);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
  });

  it("starts with the app, counts its 429 in a test's peaks, and stops when it closes", async () => {
    const other = await createHarness({ config: { rateLimits: { apiPerMinute: 2 } } });
    expect(other.app.systemStatus.started).toBe(true);
    startRunPeaks('api-refusals');
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await other.client().get('/api/v1/health')).statusCode);
      expect(codes).toEqual([200, 200, 429, 429]);
      expect(currentRunPeaks('api-refusals')).toMatchObject({ errors5xx: 0, refused429: 2 });
      expect((await other.app.systemStatus.sample()).http).toMatchObject({ errors5xx: 0, refused429: 2 });
    } finally {
      stopRunPeaks('api-refusals');
      await other.close();
    }
    expect(other.app.systemStatus.started).toBe(false);
  });
});
