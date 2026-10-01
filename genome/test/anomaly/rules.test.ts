import { describe, expect, it } from 'vitest';
import { DEFAULT_ANOMALY_CONFIG, type AnomalyConfig } from '../../src/server/config.js';
import {
  ANOMALY_WEIGHTS,
  combineRisk,
  decayFactor,
  deviceDiversity,
  evaluateRules,
  geoDispersion,
  impossibleTravel,
  lostStolenScan,
  postRevocationScan,
  prepareHistory,
  scanVelocity,
  sourceKey,
  type ScanRecord,
} from '../../src/server/services/anomaly-rules.js';

const cfg: AnomalyConfig = { ...DEFAULT_ANOMALY_CONFIG };
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-06-01T10:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms);

let seq = 0;
function scan(ms: number, extra: Partial<ScanRecord> = {}): ScanRecord {
  seq++;
  return { id: `s${String(seq).padStart(5, '0')}`, at: at(ms), deviceHash: 'dev-a', ...extra };
}

/** The canonical counterfeit pattern: France 10:00 → Japan 10:02 → USA 10:03. */
function canonical(): ScanRecord[] {
  return [
    scan(0, { country: 'FR', deviceHash: 'd-fr' }),
    scan(2 * MIN, { country: 'JP', deviceHash: 'd-jp' }),
    scan(3 * MIN, { country: 'US', deviceHash: 'd-us' }),
  ];
}

describe('canonical counterfeit example', () => {
  it('France 10:00 → Japan 10:02 → USA 10:03 gives IMPOSSIBLE_TRAVEL and a suspicious risk score', () => {
    const h = canonical();
    const now = at(3 * MIN);
    const r = evaluateRules(h, now, cfg, { currentScanId: h[2].id });
    const types = r.findings.map((f) => f.type);
    expect(types).toContain('IMPOSSIBLE_TRAVEL');
    expect(r.riskScore).toBeGreaterThanOrEqual(cfg.suspiciousThreshold);
    const it = r.findings.find((f) => f.type === 'IMPOSSIBLE_TRAVEL')!;
    expect(it.severity).toBe('HIGH');
    expect(it.weight).toBe(60);
    expect(it.scanIds).toEqual([h[1].id, h[2].id]); // the latest violation: JP → US
    expect(it.details).toMatchObject({ fromCountry: 'JP', toCountry: 'US', violations: 2, basis: 'country' });
    expect(it.details.speedKmh as number).toBeGreaterThan(100_000);
  });

  it('the same history with coordinates reports coordinate basis', () => {
    const h = [
      scan(0, { country: 'FR', lat: 48.9, lon: 2.4 }),
      scan(2 * MIN, { country: 'JP', lat: 35.7, lon: 139.7 }),
    ];
    const [f] = impossibleTravel(h, at(2 * MIN), cfg);
    expect(f.details.basis).toBe('coordinates');
    expect(f.details.distanceKm as number).toBeGreaterThan(9600);
  });
});

describe('normal patterns stay quiet', () => {
  it('an owner scanning daily at home for a month', () => {
    const h: ScanRecord[] = [];
    for (let d = 0; d < 30; d++) h.push(scan(d * DAY + 8 * HOUR, { country: 'FR', lat: 48.9, lon: 2.4, deviceHash: 'owner-phone', byOwner: true }));
    const r = evaluateRules(h, at(29 * DAY + 8 * HOUR), cfg, { currentScanId: h[29].id, productStatus: 'OWNED', codeStatus: 'ACTIVE' });
    expect(r.findings).toEqual([]);
    expect(r.riskScore).toBe(0);
  });

  it('a boutique scanning 10 products: each code sees one boutique scan', () => {
    for (let p = 0; p < 10; p++) {
      const h = [scan(p * MIN, { country: 'FR', deviceHash: 'boutique-ipad', ipHash: 'boutique-ip' })];
      expect(evaluateRules(h, at(p * MIN), cfg, { currentScanId: h[0].id, productStatus: 'ACTIVATED', codeStatus: 'ACTIVE' }).riskScore).toBe(0);
    }
  });

  it('a boutique scanning one product repeatedly during a sale, then the buyer at home', () => {
    const h: ScanRecord[] = [];
    for (let i = 0; i < 15; i++) h.push(scan(i * MIN, { country: 'FR', deviceHash: 'boutique-ipad' }));
    h.push(scan(3 * HOUR, { country: 'FR', deviceHash: 'buyer-phone' }));
    expect(evaluateRules(h, at(3 * HOUR), cfg).findings).toEqual([]);
  });

  it('an owner travelling Paris → New York by plane (8 h)', () => {
    const h = [scan(0, { country: 'FR' }), scan(8 * HOUR, { country: 'US' })];
    expect(impossibleTravel(h, at(8 * HOUR), cfg)).toEqual([]);
  });

  it('neighbouring cities across a border within an hour (coordinates)', () => {
    const h = [scan(0, { country: 'FR', lat: 48.9, lon: 2.4 }), scan(40 * MIN, { country: 'BE', lat: 50.8, lon: 4.4 })];
    expect(impossibleTravel(h, at(40 * MIN), cfg)).toEqual([]); // ≈ 260 km < minTravelKm
  });

  it('a family sharing a product across a few devices', () => {
    const h = ['mum', 'dad', 'kid', 'mum', 'kid', 'dad'].map((d, i) => scan(i * DAY, { country: 'FR', deviceHash: d }));
    expect(evaluateRules(h, at(6 * DAY), cfg).findings).toEqual([]);
  });

  it('neighbouring countries without coordinates are not called impossible (lower-bound distance)', () => {
    const h = [scan(0, { country: 'FR' }), scan(30 * MIN, { country: 'IT' })];
    expect(impossibleTravel(h, at(30 * MIN), cfg)).toEqual([]);
    const m = [scan(0, { country: 'US', lat: 42.3, lon: -83 }), scan(20 * MIN, { country: 'CA' })]; // Detroit → Windsor
    expect(impossibleTravel(m, at(20 * MIN), cfg)).toEqual([]);
  });

  it('two scans in the same big country without coordinates are not travel', () => {
    const h = [scan(0, { country: 'US' }), scan(MIN, { country: 'US', lat: 40.7, lon: -74 })];
    expect(impossibleTravel(h, at(MIN), cfg)).toEqual([]);
  });
});

describe('IMPOSSIBLE_TRAVEL', () => {
  it('needs both distance ≥ minTravelKm and speed > impossibleTravelKmh', () => {
    const h = [scan(0, { country: 'FR' }), scan(3 * HOUR, { country: 'JP' })]; // ≥ 7 900 km in 3 h
    expect(impossibleTravel(h, at(3 * HOUR), cfg)).toHaveLength(1);
    expect(impossibleTravel(h, at(3 * HOUR), { ...cfg, minTravelKm: 9000 })).toEqual([]);
    expect(impossibleTravel(h, at(3 * HOUR), { ...cfg, impossibleTravelKmh: 3000 })).toEqual([]);
    // Coordinates are exact: Paris → Rome (≈ 1 100 km) in 30 minutes is impossible.
    const c = [scan(0, { country: 'FR', lat: 48.9, lon: 2.4 }), scan(30 * MIN, { country: 'IT', lat: 41.9, lon: 12.5 })];
    expect(impossibleTravel(c, at(30 * MIN), cfg)).toHaveLength(1);
  });

  it('treats simultaneous far-apart scans as infinitely fast (capped in details)', () => {
    const h = [scan(0, { country: 'FR' }), scan(0, { country: 'JP' })];
    const [f] = impossibleTravel(h, at(0), cfg);
    expect(f.details.speedKmh).toBe(1_000_000);
  });

  it('compares consecutive located scans, skipping scans without location', () => {
    const h = [scan(0, { country: 'FR' }), scan(MIN, {}), scan(2 * MIN, { country: 'JP' })];
    expect(impossibleTravel(h, at(2 * MIN), cfg)).toHaveLength(1);
  });

  it('ignores scans outside the decay horizon and in the future', () => {
    const h = [scan(-40 * DAY, { country: 'FR' }), scan(-40 * DAY + MIN, { country: 'JP' })];
    expect(impossibleTravel(h, at(0), cfg)).toEqual([]);
    const future = [scan(0, { country: 'FR' }), scan(10 * MIN, { country: 'JP' })];
    expect(impossibleTravel(future, at(5 * MIN), cfg)).toEqual([]);
  });

  it('is independent of input order', () => {
    const h = canonical();
    const a = impossibleTravel(h, at(3 * MIN), cfg);
    const b = impossibleTravel([...h].reverse(), at(3 * MIN), cfg);
    expect(b).toEqual(a);
  });
});

describe('SCAN_VELOCITY', () => {
  const burst = (n: number, devices: number, extra: Partial<ScanRecord> = {}) =>
    Array.from({ length: n }, (_, i) => scan(i * MIN, { deviceHash: `dev-${i % devices}`, ...extra }));

  it('fires above velocityMaxScans within the window from ≥ velocityMinDevices devices', () => {
    const h = burst(21, 5);
    const [f] = scanVelocity(h, at(20 * MIN), cfg);
    expect(f).toMatchObject({ type: 'SCAN_VELOCITY', severity: 'MEDIUM', weight: 45 });
    expect(f.details).toMatchObject({ scans: 21, sources: 5 });
    expect(f.scanIds).toHaveLength(21);
  });

  it('does not fire at exactly velocityMaxScans, with too few devices, or spread over a longer time', () => {
    expect(scanVelocity(burst(20, 5), at(20 * MIN), cfg)).toEqual([]);
    expect(scanVelocity(burst(30, 4), at(30 * MIN), cfg)).toEqual([]);
    const spread = Array.from({ length: 30 }, (_, i) => scan(i * 4 * MIN, { deviceHash: `dev-${i % 6}` })); // 15 per hour
    expect(scanVelocity(spread, at(120 * MIN), cfg)).toEqual([]);
  });

  it('owner scans never count (owner adjustment)', () => {
    const h = burst(25, 6, { byOwner: true });
    expect(scanVelocity(h, at(25 * MIN), cfg)).toEqual([]);
  });

  it('scans without any source identifier share one bucket', () => {
    const h = Array.from({ length: 30 }, (_, i) => scan(i * MIN, { deviceHash: null }));
    expect(scanVelocity(h, at(30 * MIN), cfg)).toEqual([]);
    expect(sourceKey({ id: 'x', at: at(0) })).toBe('unknown');
  });

  it('reports a past burst at its own time (so it decays)', () => {
    const h = burst(21, 5);
    h.push(scan(5 * DAY, { deviceHash: 'later' }));
    const [f] = scanVelocity(h, at(5 * DAY), cfg);
    expect(f.at.getTime()).toBe(T0 + 20 * MIN);
  });
});

describe('DEVICE_DIVERSITY', () => {
  it('fires above deviceMax distinct devices in deviceWindowDays', () => {
    const h = Array.from({ length: 13 }, (_, i) => scan(i * HOUR, { deviceHash: `d${i}` }));
    const [f] = deviceDiversity(h, at(13 * HOUR), cfg);
    expect(f).toMatchObject({ type: 'DEVICE_DIVERSITY', severity: 'MEDIUM', weight: 30 });
    expect(f.details.sources).toBe(13);
    expect(deviceDiversity(h.slice(0, 12), at(13 * HOUR), cfg)).toEqual([]);
  });

  it('only counts devices within the window', () => {
    const h = Array.from({ length: 13 }, (_, i) => scan(i * DAY, { deviceHash: `d${i}` })); // 13 devices over 13 days
    expect(deviceDiversity(h, at(13 * DAY), cfg)).toEqual([]);
  });

  it('owner devices are excluded', () => {
    const h = Array.from({ length: 13 }, (_, i) => scan(i * HOUR, { deviceHash: `d${i}`, byOwner: i < 2 }));
    expect(deviceDiversity(h, at(13 * HOUR), cfg)).toEqual([]);
  });
});

describe('distinct sources, not raw device cookies (SEC-7)', () => {
  it('the source key is the IP pseudonym when present, else the device, else the session', () => {
    expect(sourceKey({ id: 'x', at: at(0), ipHash: 'i', deviceHash: 'd', sessionHash: 's' })).toBe('i:i');
    expect(sourceKey({ id: 'x', at: at(0), deviceHash: 'd', sessionHash: 's' })).toBe('d:d');
    expect(sourceKey({ id: 'x', at: at(0), sessionHash: 's' })).toBe('s:s');
    expect(sourceKey({ id: 'x', at: at(0), ipHash: '', deviceHash: 'd' })).toBe('d:d');
    expect(sourceKey({ id: 'x', at: at(0) })).toBe('unknown');
  });

  it('40 cookie-less scans from one IP (a fresh device cookie each time) are one source: no DEVICE_DIVERSITY, no SCAN_VELOCITY', () => {
    const h = Array.from({ length: 40 }, (_, i) => scan(i * 30_000, { deviceHash: `fresh-cookie-${i}`, ipHash: 'one-ip', country: 'FR' }));
    const r = evaluateRules(h, at(40 * 30_000), cfg, { currentScanId: h[39].id });
    expect(r.findings).toEqual([]);
    expect(r.riskScore).toBe(0);
  });

  it('a boutique on one wifi with many phones is one source', () => {
    const h = Array.from({ length: 30 }, (_, i) => scan(i * MIN, { deviceHash: `phone-${i % 15}`, ipHash: 'boutique-wifi', country: 'FR', lat: 48.9, lon: 2.3 }));
    expect(evaluateRules(h, at(30 * MIN), cfg).findings).toEqual([]);
  });

  it('copies scanned in distinct places (distinct IPs) are still flagged', () => {
    const h = Array.from({ length: 13 }, (_, i) => scan(i * HOUR, { deviceHash: `d${i}`, ipHash: `ip-${i}` }));
    const [f] = deviceDiversity(h, at(13 * HOUR), cfg);
    expect(f.details.sources).toBe(13);
    const burst = Array.from({ length: 30 }, (_, i) => scan(i * 30_000, { deviceHash: `p${i % 15}`, ipHash: `ip-${i % 15}`, country: 'FR', lat: 48.9, lon: 2.3 }));
    expect(scanVelocity(burst, at(15 * MIN), cfg)).toHaveLength(1);
  });

  it('a same-place burst from many sources (velocity + diversity) reaches the suspicious threshold', () => {
    const burst = Array.from({ length: 30 }, (_, i) => scan(i * 30_000, { deviceHash: `p${i % 15}`, ipHash: `ip-${i % 15}`, country: 'FR', lat: 48.9, lon: 2.3 }));
    const r = evaluateRules(burst, at(29 * 30_000), cfg, { currentScanId: burst[29].id });
    expect(r.findings.map((f) => f.type).sort()).toEqual(['DEVICE_DIVERSITY', 'SCAN_VELOCITY']);
    expect(r.riskScore).toBe(62); // 1 − 0.55 · 0.70
    expect(r.riskScore).toBeGreaterThanOrEqual(cfg.suspiciousThreshold);
  });

  it('without an IP pseudonym, devices and then sessions stand in', () => {
    const h = Array.from({ length: 13 }, (_, i) => scan(i * HOUR, { deviceHash: null, sessionHash: `sess-${i}` }));
    expect(deviceDiversity(h, at(13 * HOUR), cfg)).toHaveLength(1);
  });
});

describe('GEO_DISPERSION', () => {
  it('fires above geoMaxCountries distinct countries in geoWindowDays', () => {
    const h = ['FR', 'GB', 'DE', 'IT'].map((c, i) => scan(i * DAY, { country: c }));
    const [f] = geoDispersion(h, at(4 * DAY), cfg);
    expect(f).toMatchObject({ type: 'GEO_DISPERSION', severity: 'HIGH', weight: 45 });
    expect(f.details.countries).toEqual(['DE', 'FR', 'GB', 'IT']);
    expect(geoDispersion(h.slice(0, 3), at(4 * DAY), cfg)).toEqual([]);
  });

  it('countries outside the window do not count', () => {
    const h = ['FR', 'GB', 'DE', 'IT'].map((c, i) => scan(i * 3 * DAY, { country: c }));
    expect(geoDispersion(h, at(9 * DAY), cfg)).toEqual([]);
  });
});

describe('status rules', () => {
  it('LOST_STOLEN_SCAN fires for LOST and STOLEN only', () => {
    for (const s of ['LOST', 'STOLEN'] as const) {
      const [f] = lostStolenScan([], at(0), cfg, { productStatus: s, currentScanId: 'cur' });
      expect(f).toMatchObject({ type: 'LOST_STOLEN_SCAN', severity: 'HIGH', weight: 50, scanIds: ['cur'] });
    }
    expect(lostStolenScan([], at(0), cfg, { productStatus: 'OWNED' })).toEqual([]);
    expect(lostStolenScan([], at(0), cfg)).toEqual([]);
  });

  it('POST_REVOCATION_SCAN fires for revoked or superseded codes and revoked products', () => {
    expect(postRevocationScan([], at(0), cfg, { codeStatus: 'REVOKED' })).toHaveLength(1);
    expect(postRevocationScan([], at(0), cfg, { codeStatus: 'SUPERSEDED' })).toHaveLength(1);
    expect(postRevocationScan([], at(0), cfg, { codeStatus: 'ACTIVE', productStatus: 'REVOKED' })).toHaveLength(1);
    expect(postRevocationScan([], at(0), cfg, { codeStatus: 'ACTIVE', productStatus: 'OWNED' })).toEqual([]);
    const [f] = postRevocationScan([], at(0), cfg, { codeStatus: 'SUPERSEDED' });
    expect(f).toMatchObject({ severity: 'MEDIUM', weight: 30 });
  });

  it('LOST alone (50) stays under the default threshold; LOST + impossible travel exceeds it', () => {
    const quiet = evaluateRules([scan(0, { country: 'FR' })], at(0), cfg, { productStatus: 'LOST' });
    expect(quiet.riskScore).toBe(50);
    const h = canonical();
    const loud = evaluateRules(h, at(3 * MIN), cfg, { productStatus: 'STOLEN' });
    expect(loud.riskScore).toBe(80); // 1 − 0.4·0.5
  });
});

describe('scoring', () => {
  it('combineRisk follows 100·(1 − Π(1 − wᵢ·decayᵢ/100))', () => {
    expect(combineRisk([])).toBe(0);
    expect(combineRisk([{ weight: 60, decay: 1 }])).toBe(60);
    expect(combineRisk([{ weight: 60, decay: 1 }, { weight: 45, decay: 1 }])).toBe(78);
    expect(combineRisk([{ weight: 60, decay: 0.5 }])).toBe(30);
    expect(combineRisk([{ weight: 100, decay: 1 }, { weight: 30, decay: 1 }])).toBe(100);
    expect(combineRisk([{ weight: 500, decay: 3 }])).toBe(100); // clamped
    expect(combineRisk([{ weight: Number.NaN, decay: 1 }])).toBe(0);
  });

  it('decay is linear over decayDays', () => {
    expect(decayFactor(at(0), at(0), 30)).toBe(1);
    expect(decayFactor(at(0), at(15 * DAY), 30)).toBeCloseTo(0.5, 10);
    expect(decayFactor(at(0), at(30 * DAY), 30)).toBe(0);
    expect(decayFactor(at(0), at(45 * DAY), 30)).toBe(0);
    expect(decayFactor(at(10), at(0), 30)).toBe(1);
  });

  it('an impossible-travel finding fades below the threshold as it ages', () => {
    const h = canonical();
    expect(evaluateRules(h, at(3 * MIN), cfg).riskScore).toBe(60);
    const later = evaluateRules([...h, scan(1 * DAY, { country: 'US' })], at(1 * DAY), cfg);
    expect(later.findings[0].type).toBe('IMPOSSIBLE_TRAVEL');
    expect(later.riskScore).toBe(58);
    expect(later.findings[0].riskScore).toBe(58);
    const gone = evaluateRules([...h, scan(31 * DAY, { country: 'US' })], at(31 * DAY), cfg);
    expect(gone.findings).toEqual([]);
  });

  it('weights table matches the contract', () => {
    expect(ANOMALY_WEIGHTS.IMPOSSIBLE_TRAVEL).toEqual({ severity: 'HIGH', weight: 60 });
    expect(ANOMALY_WEIGHTS.SCAN_VELOCITY).toEqual({ severity: 'MEDIUM', weight: 45 });
    expect(ANOMALY_WEIGHTS.DEVICE_DIVERSITY).toEqual({ severity: 'MEDIUM', weight: 30 });
    expect(ANOMALY_WEIGHTS.GEO_DISPERSION).toEqual({ severity: 'HIGH', weight: 45 });
    expect(ANOMALY_WEIGHTS.LOST_STOLEN_SCAN).toEqual({ severity: 'HIGH', weight: 50 });
    expect(ANOMALY_WEIGHTS.POST_REVOCATION_SCAN).toEqual({ severity: 'MEDIUM', weight: 30 });
    expect(ANOMALY_WEIGHTS.GENOME_MISMATCH.severity).toBe('HIGH');
    expect(ANOMALY_WEIGHTS.CODE_MISMATCH.severity).toBe('CRITICAL');
    expect(ANOMALY_WEIGHTS.VALID_SIGNATURE_UNREGISTERED.severity).toBe('CRITICAL');
  });

  it('prepareHistory drops invalid entries and sorts deterministically', () => {
    const bad = { id: 'bad', at: new Date(Number.NaN) } as ScanRecord;
    const h = prepareHistory([scan(2 * MIN), bad, scan(MIN)], at(5 * MIN), cfg);
    expect(h.map((s) => s.at.getTime())).toEqual([T0 + MIN, T0 + 2 * MIN]);
  });

  it('a mass-copied code (many devices, many countries, fast) scores far above the threshold', () => {
    const countries = ['FR', 'JP', 'US', 'BR', 'AU', 'ZA', 'CN', 'MX'];
    const h = Array.from({ length: 40 }, (_, i) => scan(i * MIN, { deviceHash: `cf-${i}`, country: countries[i % countries.length] }));
    const r = evaluateRules(h, at(40 * MIN), cfg);
    expect(r.findings.map((f) => f.type).sort()).toEqual(['DEVICE_DIVERSITY', 'GEO_DISPERSION', 'IMPOSSIBLE_TRAVEL', 'SCAN_VELOCITY']);
    expect(r.riskScore).toBeGreaterThanOrEqual(90);
  });
});
