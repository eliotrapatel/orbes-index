/**
 * The server's status (services/system-status.ts, test entrants §7): the cgroup v2 and /proc readings from fixture
 * files (test/fixtures/system-status, copied to a temporary root so a second reading can move the counters), the CPU
 * rates between two samples, `max` limits and unreadable files as null, the process's own cgroup under the mount, the
 * responses' window (requests per second, p95, 5xx, 429), the ring of samples, and a test's running peaks.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  currentRunPeaks,
  databaseActivity,
  HttpWindow,
  startRunPeaks,
  stopRunPeaks,
  SystemStatus,
  type SystemStatusDeps,
} from '../../src/server/services/system-status.js';
import { createManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'system-status');
const KIB = 1024;

/** A fresh copy of the fixtures, a manual clock and a monotonic time the test moves. */
async function host(): Promise<{ root: string; cgroup: string; proc: string; at: { ms: number }; deps: SystemStatusDeps }> {
  const root = await mkdtemp(join(tmpdir(), 'orbes-status-'));
  await cp(FIXTURES, root, { recursive: true });
  const at = { ms: 10_000 };
  const clock = createManualClock('2026-10-07T03:00:00.000Z');
  const cgroup = join(root, 'cgroup');
  const proc = join(root, 'proc');
  return { root, cgroup, proc, at, deps: { cgroupRoot: cgroup, procRoot: proc, diskPath: root, intervalMs: 0, clock: clock.now, monotonic: () => at.ms } };
}

describe('SystemStatus: the readings', () => {
  const roots: string[] = [];
  afterAll(async () => {
    for (const r of roots) await rm(r, { recursive: true, force: true });
  });

  it('reads the app from cgroup v2, the host from /proc and statfs; the CPU rates from the second sample on', async () => {
    const h = await host();
    roots.push(h.root);
    const status = new SystemStatus(h.deps);
    const first = await status.sample();
    expect(first.app).toEqual({
      memBytes: 412_876_800,
      memLimitBytes: 805_306_368,
      memPeakBytes: 530_579_456,
      cpuCores: null,
      cpuLimitCores: 1.5,
      throttledPct: null,
      pids: 23,
      pidsMax: 256,
    });
    expect(first.host).toMatchObject({
      memAvailableBytes: 1_873_420 * KIB,
      memTotalBytes: 3_995_012 * KIB,
      swapUsedBytes: (2_097_148 - 1_835_004) * KIB,
      load1: 0.84,
      load5: 0.62,
      cpuPct: null,
    });
    expect(first.host.diskUsedPct).toBeGreaterThan(0);
    expect(first.host.diskUsedPct).toBeLessThanOrEqual(100);

    // 2 s later: 1.5 s of CPU used (0.75 of a core), 5 of 20 periods throttled; the host 800 busy ticks of 2 000.
    h.at.ms += 2000;
    await writeFile(join(h.cgroup, 'cpu.stat'), 'usage_usec 82734567\nuser_usec 61123456\nsystem_usec 21611111\nnr_periods 4020\nnr_throttled 17\nthrottled_usec 395678\n');
    await writeFile(join(h.proc, 'stat'), 'cpu  1000600 2000 300200 8001100 50100 0 10000 1000 0 0\ncpu0 0 0 0 0 0 0 0 0 0 0\n');
    await writeFile(join(h.cgroup, 'memory.current'), '450000000\n');
    const second = await status.sample();
    expect(second.app).toMatchObject({ memBytes: 450_000_000, cpuCores: 0.75, throttledPct: 25 });
    expect(second.host.cpuPct).toBe(40);
  });

  it('reads `max` as no limit (null), and no throttling while no period passes', async () => {
    const h = await host();
    roots.push(h.root);
    await writeFile(join(h.cgroup, 'memory.max'), 'max\n');
    await writeFile(join(h.cgroup, 'cpu.max'), 'max 100000\n');
    await writeFile(join(h.cgroup, 'pids.max'), 'max\n');
    const status = new SystemStatus(h.deps);
    await status.sample();
    h.at.ms += 2000;
    const s = await status.sample();
    expect(s.app).toMatchObject({ memLimitBytes: null, cpuLimitCores: null, pidsMax: null, cpuCores: 0, throttledPct: 0 });
  });

  it('gives null for what it cannot read (no cgroup, no /proc, no disk, no database, no hub) and never throws', async () => {
    const missing = join(tmpdir(), `orbes-status-missing-${process.pid}`);
    const status = new SystemStatus({ cgroupRoot: missing, procRoot: missing, diskPath: missing, intervalMs: 0 });
    await status.sample();
    const s = await status.sample();
    for (const v of Object.values(s.app)) expect(v).toBeNull();
    for (const v of Object.values(s.host)) expect(v).toBeNull();
    for (const v of Object.values(s.db)) expect(v).toBeNull();
    expect(s.live).toEqual({ streams: null, releases: null, accounts: null });
    // Node always answers; the loop's delay only once its monitor runs (start).
    expect(s.node.heapUsedBytes).toBeGreaterThan(0);
    expect(s.node.heapLimitBytes).toBeGreaterThan(s.node.heapUsedBytes!);
    expect(s.node.rssBytes).toBeGreaterThan(0);
    expect(s.node.externalBytes).toBeGreaterThanOrEqual(0);
    expect(s.node.loopDelayP99Ms).toBeNull();
    expect(s.node.loopUtilPct).toBeGreaterThanOrEqual(0);
    expect(s.http).toEqual({ rps: 0, p95Ms: null, errors5xx: 0, refused429: 0 });
  });

  it("reads the process's own cgroup under the mount, or the mount itself when that one has no files", async () => {
    const h = await host();
    roots.push(h.root);
    const own = join(h.cgroup, 'system.slice', 'orbes.scope');
    await mkdir(own, { recursive: true });
    await writeFile(join(own, 'memory.current'), '123456789\n');
    await writeFile(join(h.proc, 'self', 'cgroup'), '0::/system.slice/orbes.scope\n');
    expect((await new SystemStatus(h.deps).sample()).app.memBytes).toBe(123_456_789);

    await writeFile(join(h.proc, 'self', 'cgroup'), '0::/elsewhere.scope\n');
    expect((await new SystemStatus(h.deps).sample()).app.memBytes).toBe(412_876_800);
  });

  it('counts the LIVE RELEASES streams open on the process', async () => {
    const h = await host();
    roots.push(h.root);
    const live = { open: { streams: 7, releases: 2, accounts: new Map([['a', 2], ['b', 1], ['admin:c', 1]]) } };
    expect((await new SystemStatus({ ...h.deps, live }).sample()).live).toEqual({ streams: 7, releases: 2, accounts: 3 });
  });

  it('measures the event loop once started, and stops', async () => {
    const h = await host();
    roots.push(h.root);
    const status = new SystemStatus({ ...h.deps, intervalMs: 60_000 });
    expect(status.started).toBe(false);
    status.start();
    expect(status.started).toBe(true);
    await new Promise((r) => setTimeout(r, 120));
    const s = await status.sample();
    expect(s.node.loopDelayP50Ms).toBeGreaterThanOrEqual(0);
    expect(s.node.loopDelayP99Ms).toBeGreaterThanOrEqual(s.node.loopDelayP50Ms!);
    await status.stop();
    expect(status.started).toBe(false);
    // The first sample was taken at start: two in the ring.
    expect((await status.status()).history).toHaveLength(2);
  });
});

describe('SystemStatus: the ring', () => {
  it('keeps the last `size` samples oldest first, the newest as `latest`; a first one taken on demand', async () => {
    const clock = createManualClock('2026-10-07T03:00:00.000Z');
    const missing = join(tmpdir(), `orbes-status-missing-${process.pid}`);
    const status = new SystemStatus({ cgroupRoot: missing, procRoot: missing, diskPath: missing, intervalMs: 0, size: 3, clock: clock.now });

    const empty = await status.status();
    expect(empty.history).toHaveLength(1);
    expect(empty.latest).toEqual(empty.history[0]);
    expect(empty.now).toBe('2026-10-07T03:00:00.000Z');

    for (let i = 0; i < 4; i++) {
      clock.advance(2000);
      await status.sample();
    }
    const view = await status.status();
    expect(view.history.map((s) => s.at)).toEqual(['2026-10-07T03:00:04.000Z', '2026-10-07T03:00:06.000Z', '2026-10-07T03:00:08.000Z']);
    expect(view.latest).toEqual(view.history[2]);
    expect(view.now).toBe('2026-10-07T03:00:08.000Z');
  });

  it('takes one sample at a time', async () => {
    const missing = join(tmpdir(), `orbes-status-missing-${process.pid}`);
    const status = new SystemStatus({ cgroupRoot: missing, procRoot: missing, diskPath: missing, intervalMs: 0 });
    const [a, b] = await Promise.all([status.sample(), status.sample()]);
    expect(a).toBe(b);
    expect((await status.status()).history).toHaveLength(1);
  });
});

describe('HttpWindow: the responses of the last 60 s', () => {
  it('gives the requests per second, the p95 (never under the true one, within 10 %), the 5xx and the 429', () => {
    const at = { ms: 1000 };
    const http = new HttpWindow(() => at.ms);
    for (let i = 0; i < 93; i++) http.record(200, 5);
    for (let i = 0; i < 5; i++) http.record(200, 200);
    http.record(503, 200);
    http.record(429, 0.4);
    at.ms = 11_000;
    const r = http.read();
    // 100 responses over the 10 s since the start.
    expect(r.rps).toBe(10);
    expect(r.errors5xx).toBe(1);
    expect(r.refused429).toBe(1);
    expect(r.p95Ms).toBeGreaterThanOrEqual(200);
    expect(r.p95Ms).toBeLessThanOrEqual(220);

    // Six slow ones of 1 000: the p95 is a fast one.
    const fast = new HttpWindow(() => at.ms);
    for (let i = 0; i < 994; i++) fast.record(200, 5);
    for (let i = 0; i < 6; i++) fast.record(200, 900);
    const f = fast.read();
    expect(f.p95Ms).toBeGreaterThanOrEqual(5);
    expect(f.p95Ms).toBeLessThanOrEqual(5.5);
  });

  it('forgets what is older than 60 s, and counts over a full minute once the app is older', () => {
    const at = { ms: 0 };
    const http = new HttpWindow(() => at.ms);
    at.ms = 100_000;
    for (let i = 0; i < 120; i++) http.record(200, 3);
    at.ms = 130_500;
    for (let i = 0; i < 60; i++) http.record(500, 3);
    at.ms = 159_999;
    // 180 responses over the window's 59.999 s.
    expect(http.read()).toMatchObject({ rps: 3, errors5xx: 60 });
    at.ms = 160_000;
    // The second 100 left the window.
    expect(http.read()).toMatchObject({ rps: 1, errors5xx: 60 });
    at.ms = 191_000;
    expect(http.read()).toEqual({ rps: 0, p95Ms: null, errors5xx: 0, refused429: 0 });
  });
});

describe("a test's peaks", () => {
  it('follow the running maxima of the samples while started, and the 5xx and 429 answered meanwhile', async () => {
    const h = await host();
    const live = { open: { streams: 3, releases: 1, accounts: new Map<string, number>() } };
    const status = new SystemStatus({ ...h.deps, live });
    try {
      status.http.record(503, 2);
      startRunPeaks('run-a');
      expect(currentRunPeaks('run-a')).toEqual({
        appMemBytes: null,
        appCpuCores: null,
        p95Ms: null,
        loopDelayP99Ms: null,
        liveStreams: null,
        dbConnections: null,
        poolWaiting: null,
        errors5xx: 0,
        refused429: 0,
      });

      await status.sample();
      h.at.ms += 2000;
      await writeFile(join(h.cgroup, 'memory.current'), '600000000\n');
      await writeFile(join(h.cgroup, 'cpu.stat'), 'usage_usec 83234567\nnr_periods 4020\nnr_throttled 12\n');
      live.open.streams = 9;
      status.http.record(200, 40);
      status.http.record(500, 40);
      status.http.record(429, 1);
      status.http.record(429, 1);
      await status.sample();
      // Lower again: the maxima stay.
      h.at.ms += 2000;
      await writeFile(join(h.cgroup, 'memory.current'), '420000000\n');
      live.open.streams = 1;
      await status.sample();

      // Started again (ADD MORE): kept as they are.
      startRunPeaks('run-a');
      const peaks = currentRunPeaks('run-a')!;
      expect(peaks).toMatchObject({ appMemBytes: 600_000_000, appCpuCores: 1, liveStreams: 9, dbConnections: null, poolWaiting: null, errors5xx: 1, refused429: 2 });
      expect(peaks.p95Ms).toBeGreaterThanOrEqual(40);
      expect(peaks.loopDelayP99Ms).toBeNull();

      // A copy: changing it changes nothing.
      peaks.errors5xx = 99;
      expect(currentRunPeaks('run-a')!.errors5xx).toBe(1);

      // A second test started now sees only what comes after.
      startRunPeaks('run-b');
      status.http.record(502, 1);
      expect(currentRunPeaks('run-b')).toMatchObject({ errors5xx: 1, appMemBytes: null });

      const last = stopRunPeaks('run-a');
      expect(last).toMatchObject({ appMemBytes: 600_000_000, errors5xx: 2, refused429: 2 });
      expect(currentRunPeaks('run-a')).toBeNull();
      expect(stopRunPeaks('run-a')).toBeNull();
      expect(stopRunPeaks('run-b')).toMatchObject({ errors5xx: 1 });
      expect(currentRunPeaks('never-started')).toBeNull();
    } finally {
      await rm(h.root, { recursive: true, force: true });
    }
  });
});

describe('the database', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t?.close());

  it('PGlite has no pool: the database fields are null, and the sampler sends it no query', async () => {
    const missing = join(tmpdir(), `orbes-status-missing-${process.pid}`);
    const s = await new SystemStatus({ db: t.db, cgroupRoot: missing, procRoot: missing, diskPath: missing, intervalMs: 0 }).sample();
    for (const v of Object.values(s.db)) expect(v).toBeNull();
  });

  it("reads this database's connections and the limit in one query (pg_stat_activity)", async () => {
    const a = await databaseActivity(t.db);
    expect(a.maxConnections).toBeGreaterThan(0);
    expect(a.connections).toBeGreaterThanOrEqual(a.active);
    expect(a.waiting).toBe(0);
  });
});
