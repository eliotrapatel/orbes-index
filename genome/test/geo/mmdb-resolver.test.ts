/**
 * GeoResolver in mmdb mode, alone and wired into the real app: the client IP
 * Fastify computes (TRUST_PROXY applied to X-Forwarded-For) is located with
 * the local database and stored, rounded, on the scan event; anomaly scoring
 * then sees the travel. A missing database never blocks verification.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { GeoResolver } from '../../src/server/geo/resolver.js';
import type { Logger } from '../../src/server/types.js';
import { createHarness, issue, safeJson, seedCatalog, type Harness } from '../api/support.js';
import { buildMmdb, FIXTURE } from './support/mmdb-writer.js';

let dir: string;
let dbPath: string;

function captureLog(): Logger & { lines: { level: string; o: unknown; m?: string }[] } {
  const lines: { level: string; o: unknown; m?: string }[] = [];
  return {
    lines,
    info: (o, m) => lines.push({ level: 'info', o, m }),
    warn: (o, m) => lines.push({ level: 'warn', o, m }),
    error: (o, m) => lines.push({ level: 'error', o, m }),
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbes-geo-resolver-'));
  dbPath = join(dir, 'dbip-city-lite.mmdb');
  writeFileSync(dbPath, buildMmdb(FIXTURE));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GeoResolver (mmdb mode)', () => {
  it('locates request.ip and ignores client-supplied geo headers', () => {
    const r = new GeoResolver({ mode: 'mmdb', mmdbPath: dbPath }, { log: captureLog() });
    const forged = { 'cf-ipcountry': 'JP', 'cf-iplatitude': '35.6', 'cf-iplongitude': '139.7', 'x-geo-country': 'JP' };
    expect(r.resolve({ headers: forged, ip: '81.2.69.160' })).toEqual({ country: 'GB', city: 'London', lat: 51.5, lon: -0.1 });
    expect(r.resolve({ headers: forged, ip: '203.0.113.10' })).toEqual({});
    expect(r.resolve({ headers: forged })).toEqual({});
    expect(r.resolve({ headers: {}, ip: '::ffff:90.1.2.3' })).toEqual({ country: 'FR', city: 'Paris', lat: 48.9, lon: 2.4 });
    expect(r.mmdb?.status().loaded).toBe(true);
  });

  it('other modes never read request.ip', () => {
    for (const mode of ['none', 'cloudflare'] as const) {
      const r = new GeoResolver({ mode });
      expect(r.mmdb).toBeUndefined();
      expect(r.resolve({ headers: {}, ip: '81.2.69.160' })).toEqual({});
    }
  });

  it('without an injected logger, warnings still reach stderr (one JSON line, no IP)', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const r = new GeoResolver({ mode: 'mmdb', mmdbPath: join(dir, 'missing.mmdb') });
      expect(r.resolve({ headers: {}, ip: '81.2.69.160' })).toEqual({});
      expect(r.resolve({ headers: {}, ip: '81.2.69.161' })).toEqual({});
      const out = spy.mock.calls.map((c) => String(c[0]));
      expect(out).toHaveLength(1);
      const line = JSON.parse(out[0]) as { level: number; msg: string; geoip: { reason: string } };
      expect(line.level).toBe(40);
      expect(line.msg).toMatch(/geoip database unavailable/);
      expect(line.geoip.reason).toBe('ENOENT');
      expect(out[0]).not.toContain('81.2.69');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('verification with GEO_MODE=mmdb behind a trusted proxy', () => {
  // The harness client connects from 203.0.113.10: that is "the proxy" (Caddy).
  const PROXY = '203.0.113.10';
  let h: Harness;
  let log: ReturnType<typeof captureLog>;

  beforeAll(async () => {
    log = captureLog();
    const config = testConfig({ trustProxy: PROXY, geo: { mode: 'mmdb', mmdbPath: dbPath } });
    h = await createHarness({
      config: { trustProxy: PROXY, geo: { mode: 'mmdb', mmdbPath: dbPath } },
      context: { geo: new GeoResolver(config.geo, { log }) },
    });
  });
  afterAll(() => h?.close());

  async function scanFrom(clientIp: string, code: string, extraXff?: string) {
    const xff = extraXff ? `${extraXff}, ${clientIp}` : clientIp;
    const res = await h.client().post('/api/v1/verify', { code }, { headers: { 'x-forwarded-for': xff } });
    expect(res.statusCode).toBe(200);
    const { scanId } = safeJson(res) as { scanId: string };
    return h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', scanId).executeTakeFirstOrThrow();
  }

  it('stores the fixture country and the rounded point for the X-Forwarded-For client', async () => {
    const catalog = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, catalog);
    const scan = await scanFrom('81.2.69.160', p.code.data);
    expect(scan).toMatchObject({ country: 'GB', lat: 51.5, lon: -0.1 });
    // Only the pseudonym of the IP is stored, never the address.
    expect(JSON.stringify(scan)).not.toContain('81.2.69');
    // The city the database knows never reaches the scan (plan CUSTOMER INTELLIGENCE §3.3 T.8.2): scan_events has no
    // city, and nothing of it is written in any column.
    expect(Object.keys(scan)).not.toContain('city');
    expect(JSON.stringify(scan)).not.toContain('London');

    // A forged left-most entry is ignored: the proxy appended the real client (FR).
    const forged = await scanFrom('90.1.2.3', p.code.data, '1.0.17.1');
    expect(forged).toMatchObject({ country: 'FR', lat: 48.9, lon: 2.4 });

    // A private client address (e.g. a LAN test through the proxy) has no location.
    const lan = await scanFrom('192.168.1.20', p.code.data);
    expect(lan).toMatchObject({ country: null, lat: null, lon: null });
  });

  it('feeds impossible-travel detection: London, then Tokyo two minutes later', async () => {
    const catalog = await seedCatalog(h.ctx);
    const p = await issue(h.ctx, catalog);
    await scanFrom('81.2.69.160', p.code.data);
    h.clock.advance(2 * 60_000);
    const tokyo = await scanFrom('1.0.17.1', p.code.data);
    expect(tokyo).toMatchObject({ country: 'JP', lat: 35.7, lon: 139.7 });
    const found = await h.ctx.db
      .selectFrom('anomalies')
      .select(['type'])
      .where('product_id', '=', p.product.id)
      .execute();
    expect(found.map((a) => a.type)).toContain('IMPOSSIBLE_TRAVEL');
  });

  it('logged the database load once and never a client IP', () => {
    expect(log.lines.filter((l) => l.m === 'geoip database loaded')).toHaveLength(1);
    expect(log.lines.filter((l) => l.level !== 'info')).toEqual([]);
    expect(JSON.stringify(log.lines)).not.toMatch(/81\.2\.69|90\.1\.2\.3|1\.0\.17\.1/);
  });
});

describe('verification with GEO_MODE=mmdb and an untrusted or missing setup', () => {
  it('X-Forwarded-For from an untrusted peer is ignored (no forged location)', async () => {
    const h = await createHarness({
      config: { trustProxy: '10.0.0.1', geo: { mode: 'mmdb', mmdbPath: dbPath } },
      context: { geo: new GeoResolver({ mode: 'mmdb', mmdbPath: dbPath }, { log: captureLog() }) },
    });
    try {
      const p = await issue(h.ctx, await seedCatalog(h.ctx));
      const res = await h.client().post('/api/v1/verify', { code: p.code.data }, { headers: { 'x-forwarded-for': '81.2.69.160' } });
      const scan = await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', (safeJson(res) as { scanId: string }).scanId).executeTakeFirstOrThrow();
      expect(scan).toMatchObject({ country: null, lat: null, lon: null }); // 203.0.113.10 (documentation range) itself
    } finally {
      await h.close();
    }
  });

  it('a missing database file: verification still answers 200, the scan has no location, one warning', async () => {
    const log = captureLog();
    const missing = join(dir, 'not-installed-yet.mmdb');
    const h = await createHarness({
      config: { trustProxy: '203.0.113.10', geo: { mode: 'mmdb', mmdbPath: missing } },
      context: { geo: new GeoResolver({ mode: 'mmdb', mmdbPath: missing }, { log }) },
    });
    try {
      const p = await issue(h.ctx, await seedCatalog(h.ctx));
      for (let i = 0; i < 3; i++) {
        const res = await h.client().post('/api/v1/verify', { code: p.code.data }, { headers: { 'x-forwarded-for': '81.2.69.160' } });
        expect(res.statusCode).toBe(200);
        expect((safeJson(res) as { state: string }).state).toMatch(/^AUTHENTIC/);
        const scan = await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', (safeJson(res) as { scanId: string }).scanId).executeTakeFirstOrThrow();
        expect(scan).toMatchObject({ country: null, lat: null, lon: null });
      }
      expect(log.lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it('the context builds the mmdb resolver from config alone', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const h = await createHarness({ config: { trustProxy: '203.0.113.10', geo: { mode: 'mmdb', mmdbPath: dbPath } } });
    try {
      expect(h.ctx.geo.mmdb?.status()).toMatchObject({ loaded: true, path: dbPath });
      const p = await issue(h.ctx, await seedCatalog(h.ctx));
      const res = await h.client().post('/api/v1/verify', { code: p.code.data }, { headers: { 'x-forwarded-for': '2a01:cb00::42' } });
      const scan = await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', (safeJson(res) as { scanId: string }).scanId).executeTakeFirstOrThrow();
      expect(scan).toMatchObject({ country: 'FR', lat: 48.9, lon: 2.4 });
    } finally {
      spy.mockRestore();
      await h.close();
    }
  });
});
