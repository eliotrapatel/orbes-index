/**
 * Anomaly rules (contract §2.5) as pure functions over one code's recent scan
 * history. No I/O, no clock: everything they need is in the arguments, so
 * each rule is unit-tested with synthetic histories.
 *
 * Shape of every rule: (history, now, config, ctx?) → 0 or 1 finding. A rule
 * reports its MOST RECENT violation; `at` is when that violation happened and
 * drives the linear decay of its weight, so an old burst fades instead of
 * marking the product forever.
 *
 * These thresholds and scores are internal. Nothing here may reach a public
 * response (the verification service exposes states and brand copy only).
 */
import type { AnomalyConfig } from '../config.js';
import type { AnomalySeverity, CodeStatus, JsonObject, ProductStatus } from '../db/schema.js';
import { countryCentroid, countryRadiusKm, type LatLon } from '../geo/centroids.js';
import { haversineKm, isValidLatLon } from '../geo/haversine.js';

// ── Types ──────────────────────────────────────────────────────────────────

export const RULE_TYPES = [
  'IMPOSSIBLE_TRAVEL',
  'SCAN_VELOCITY',
  'DEVICE_DIVERSITY',
  'GEO_DISPERSION',
  'LOST_STOLEN_SCAN',
  'POST_REVOCATION_SCAN',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** Findings recorded by the verification service itself (not scored by rules). */
export const SERVICE_FINDING_TYPES = ['GENOME_MISMATCH', 'CODE_MISMATCH', 'VALID_SIGNATURE_UNREGISTERED'] as const;
export type ServiceFindingType = (typeof SERVICE_FINDING_TYPES)[number];

export type AnomalyType = RuleType | ServiceFindingType;

/** Severity and weight (0..100) per finding type. Service findings carry the risk score they are stored with. */
export const ANOMALY_WEIGHTS: Readonly<Record<AnomalyType, { severity: AnomalySeverity; weight: number }>> = Object.freeze({
  IMPOSSIBLE_TRAVEL: { severity: 'HIGH', weight: 60 },
  // 45 (was 35): a same-place burst (velocity ⊕ diversity = 62) crosses the default threshold 60.
  SCAN_VELOCITY: { severity: 'MEDIUM', weight: 45 },
  DEVICE_DIVERSITY: { severity: 'MEDIUM', weight: 30 },
  GEO_DISPERSION: { severity: 'HIGH', weight: 45 },
  LOST_STOLEN_SCAN: { severity: 'HIGH', weight: 50 },
  POST_REVOCATION_SCAN: { severity: 'MEDIUM', weight: 30 },
  GENOME_MISMATCH: { severity: 'HIGH', weight: 60 },
  CODE_MISMATCH: { severity: 'CRITICAL', weight: 100 },
  VALID_SIGNATURE_UNREGISTERED: { severity: 'CRITICAL', weight: 100 },
});

/** One past scan of the code, as the rules see it. */
export interface ScanRecord {
  id: string;
  at: Date;
  /** Pseudonymous device id (HMAC of the device cookie). Source key when there is no IP pseudonym. */
  deviceHash?: string | null;
  /** Session pseudonym. Source key when there is neither an IP nor a device pseudonym. */
  sessionHash?: string | null;
  /** HMAC(pepper, IP). The primary source key (see sourceKey). */
  ipHash?: string | null;
  accountId?: string | null;
  /** The scan was made by the product's current, authenticated owner. */
  byOwner?: boolean;
  /** ISO alpha-2. */
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface RuleContext {
  /** The scan being verified now (findings that involve it are the "new" ones). */
  currentScanId?: string;
  productStatus?: ProductStatus | null;
  codeStatus?: CodeStatus | null;
}

export interface RuleFinding {
  type: RuleType;
  severity: AnomalySeverity;
  weight: number;
  /** When the violation happened (decay reference). */
  at: Date;
  /** Scans that make up the violation (the latest one last). */
  scanIds: string[];
  details: JsonObject;
}

export type AnomalyRule = (
  history: readonly ScanRecord[],
  now: Date,
  config: AnomalyConfig,
  ctx?: RuleContext,
) => RuleFinding[];

export interface ScoredFinding extends RuleFinding {
  /** Linear decay factor in [0, 1]. */
  decay: number;
  /** round(weight × decay), the finding's own contribution. */
  riskScore: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** JSON cannot hold Infinity: simultaneous far-apart scans report this speed. */
const SPEED_CAP_KMH = 1_000_000;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Scans the rules may look at: valid timestamps, not in the future, within
 * the decay horizon (older violations would score 0 anyway). Sorted oldest
 * first, ties by id so results never depend on input order.
 */
export function prepareHistory(history: readonly ScanRecord[], now: Date, config: AnomalyConfig): ScanRecord[] {
  const nowMs = now.getTime();
  const horizon = nowMs - horizonMs(config);
  return history
    .filter((s) => s && s.at instanceof Date && Number.isFinite(s.at.getTime()) && s.at.getTime() <= nowMs && s.at.getTime() >= horizon)
    .slice()
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** How far back history matters: the longest window or the decay period. */
export function horizonMs(config: AnomalyConfig): number {
  return Math.max(
    config.decayDays * DAY_MS,
    config.deviceWindowDays * DAY_MS,
    config.geoWindowDays * DAY_MS,
    config.velocityWindowMin * MINUTE_MS,
  );
}

/**
 * Key used to count distinct SOURCES (contract §2.5, SEC-7): the IP
 * pseudonym when present, else the device cookie pseudonym, else the
 * session pseudonym. Device cookies are client-controlled (a client that
 * drops its cookie gets a fresh one on every request), so counting them
 * would let one machine inflate DEVICE_DIVERSITY / SCAN_VELOCITY at will;
 * an IP is not free to multiply. A boutique wifi with many phones counts as
 * one source. Scans with none of them share one bucket, so missing data can
 * never inflate the count.
 */
export function sourceKey(s: ScanRecord): string {
  if (s.ipHash) return `i:${s.ipHash}`;
  if (s.deviceHash) return `d:${s.deviceHash}`;
  if (s.sessionHash) return `s:${s.sessionHash}`;
  return 'unknown';
}

/** Linear decay: 1 at `at`, 0 after `decayDays`. */
export function decayFactor(at: Date, now: Date, decayDays: number): number {
  const age = now.getTime() - at.getTime();
  if (age <= 0) return 1;
  const span = decayDays * DAY_MS;
  if (!(span > 0)) return 0;
  return Math.max(0, 1 - age / span);
}

/** Contract §2.5: 100 · (1 − Π(1 − wᵢ·decayᵢ/100)), rounded, in 0..100. */
export function combineRisk(parts: readonly { weight: number; decay: number }[]): number {
  let keep = 1;
  for (const p of parts) {
    const w = clamp(p.weight, 0, 100);
    const d = clamp(p.decay, 0, 1);
    keep *= 1 - (w * d) / 100;
  }
  return clamp(Math.round(100 * (1 - keep)), 0, 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

function finding(type: RuleType, at: Date, scanIds: string[], details: JsonObject): RuleFinding {
  const { severity, weight } = ANOMALY_WEIGHTS[type];
  return { type, severity, weight, at: new Date(at.getTime()), scanIds, details };
}

/**
 * Slide a time window over `scans` (sorted) and report the most recent window
 * end where `violates(count, distinctKeys)` holds. O(n).
 */
function latestWindowViolation(
  scans: readonly ScanRecord[],
  windowMs: number,
  key: (s: ScanRecord) => string | undefined,
  violates: (count: number, distinct: number) => boolean,
): { end: number; start: number; count: number; distinct: number; keys: string[] } | undefined {
  const counts = new Map<string, number>();
  let start = 0;
  let found: { end: number; start: number; count: number; distinct: number; keys: string[] } | undefined;
  for (let end = 0; end < scans.length; end++) {
    const kEnd = key(scans[end]);
    if (kEnd !== undefined) counts.set(kEnd, (counts.get(kEnd) ?? 0) + 1);
    const lo = scans[end].at.getTime() - windowMs;
    while (scans[start].at.getTime() < lo) {
      const k = key(scans[start]);
      if (k !== undefined) {
        const n = counts.get(k)! - 1;
        if (n === 0) counts.delete(k);
        else counts.set(k, n);
      }
      start++;
    }
    if (violates(end - start + 1, counts.size)) {
      found = { end, start, count: end - start + 1, distinct: counts.size, keys: [...counts.keys()].sort() };
    }
  }
  return found;
}

// ── Rules ──────────────────────────────────────────────────────────────────

/** Where a scan was, for travel purposes: real coordinates when known, else its country's centroid. */
interface Located {
  scan: ScanRecord;
  point: LatLon | undefined;
  centroid: LatLon | undefined;
  country: string | undefined;
}

function locate(s: ScanRecord): Located | undefined {
  const point = isValidLatLon({ lat: s.lat ?? undefined, lon: s.lon ?? undefined }) ? { lat: s.lat!, lon: s.lon! } : undefined;
  const country = typeof s.country === 'string' ? s.country : undefined;
  const centroid = countryCentroid(country);
  if (!point && !centroid) return undefined;
  return { scan: s, point, centroid, country };
}

/**
 * Distance between two located scans, or undefined when it cannot be known.
 * Coordinates on both sides are used as is. Otherwise: same country counts
 * as the same place (a centroid is no evidence of movement inside a
 * country), and different countries give a LOWER bound: the distance between
 * the best known points minus each country-only side's radius. Travel is
 * then only called impossible when even the most favourable placement inside
 * both countries is (no false alarm for Paris → New York by plane).
 */
function travelDistanceKm(a: Located, b: Located): { km: number; basis: 'coordinates' | 'country' } | undefined {
  if (a.point && b.point) return { km: haversineKm(a.point, b.point), basis: 'coordinates' };
  if (a.country && b.country && a.country === b.country) return { km: 0, basis: 'country' };
  const pa = a.point ?? a.centroid;
  const pb = b.point ?? b.centroid;
  if (!pa || !pb) return undefined;
  const slack = (a.point ? 0 : countryRadiusKm(a.country)) + (b.point ? 0 : countryRadiusKm(b.country));
  return { km: Math.max(0, haversineKm(pa, pb) - slack), basis: 'country' };
}

/** IMPOSSIBLE_TRAVEL: consecutive located scans ≥ minTravelKm apart, faster than impossibleTravelKmh. */
export const impossibleTravel: AnomalyRule = (history, now, config) => {
  const located = prepareHistory(history, now, config)
    .map(locate)
    .filter((l): l is Located => l !== undefined);
  let latest: RuleFinding | undefined;
  let violations = 0;
  for (let i = 1; i < located.length; i++) {
    const a = located[i - 1];
    const b = located[i];
    const d = travelDistanceKm(a, b);
    if (!d || d.km < config.minTravelKm) continue;
    const dtMs = b.scan.at.getTime() - a.scan.at.getTime();
    const speed = dtMs <= 0 ? Infinity : d.km / (dtMs / HOUR_MS);
    if (!(speed > config.impossibleTravelKmh)) continue;
    violations++;
    latest = finding('IMPOSSIBLE_TRAVEL', b.scan.at, [a.scan.id, b.scan.id], {
      fromCountry: a.country ?? null,
      toCountry: b.country ?? null,
      distanceKm: Math.round(d.km),
      minutes: Math.round(dtMs / MINUTE_MS),
      speedKmh: Math.round(Math.min(speed, SPEED_CAP_KMH)),
      basis: d.basis,
    });
  }
  if (!latest) return [];
  latest.details.violations = violations;
  return [latest];
};

/**
 * SCAN_VELOCITY: more than velocityMaxScans scans within velocityWindowMin
 * minutes from at least velocityMinDevices distinct sources (sourceKey). The
 * current owner's scans are not counted (owner adjustment, §2.5).
 */
export const scanVelocity: AnomalyRule = (history, now, config) => {
  const scans = prepareHistory(history, now, config).filter((s) => !s.byOwner);
  const v = latestWindowViolation(
    scans,
    config.velocityWindowMin * MINUTE_MS,
    sourceKey,
    (count, sources) => count > config.velocityMaxScans && sources >= config.velocityMinDevices,
  );
  if (!v) return [];
  return [
    finding('SCAN_VELOCITY', scans[v.end].at, scans.slice(v.start, v.end + 1).map((s) => s.id), {
      scans: v.count,
      sources: v.distinct,
      windowMin: config.velocityWindowMin,
    }),
  ];
};

/** DEVICE_DIVERSITY: more than deviceMax distinct sources (sourceKey) within deviceWindowDays (owner scans excluded). */
export const deviceDiversity: AnomalyRule = (history, now, config) => {
  const scans = prepareHistory(history, now, config).filter((s) => !s.byOwner);
  const v = latestWindowViolation(scans, config.deviceWindowDays * DAY_MS, sourceKey, (_count, sources) => sources > config.deviceMax);
  if (!v) return [];
  return [
    finding('DEVICE_DIVERSITY', scans[v.end].at, scans.slice(v.start, v.end + 1).map((s) => s.id), {
      sources: v.distinct,
      scans: v.count,
      windowDays: config.deviceWindowDays,
    }),
  ];
};

/** GEO_DISPERSION: more than geoMaxCountries distinct countries within geoWindowDays. */
export const geoDispersion: AnomalyRule = (history, now, config) => {
  const scans = prepareHistory(history, now, config).filter((s) => typeof s.country === 'string' && /^[A-Z]{2}$/.test(s.country));
  const v = latestWindowViolation(scans, config.geoWindowDays * DAY_MS, (s) => s.country!, (_count, countries) => countries > config.geoMaxCountries);
  if (!v) return [];
  return [
    finding('GEO_DISPERSION', scans[v.end].at, scans.slice(v.start, v.end + 1).map((s) => s.id), {
      countries: v.keys,
      windowDays: config.geoWindowDays,
    }),
  ];
};

/** LOST_STOLEN_SCAN: the product is reported LOST or STOLEN and is being scanned now. */
export const lostStolenScan: AnomalyRule = (_history, now, _config, ctx) => {
  const status = ctx?.productStatus;
  if (status !== 'LOST' && status !== 'STOLEN') return [];
  return [finding('LOST_STOLEN_SCAN', now, ctx?.currentScanId ? [ctx.currentScanId] : [], { productStatus: status })];
};

/** POST_REVOCATION_SCAN: a revoked or superseded code (or a revoked product) is being scanned now. */
export const postRevocationScan: AnomalyRule = (_history, now, _config, ctx) => {
  const code = ctx?.codeStatus;
  const product = ctx?.productStatus;
  const codeRevoked = code === 'REVOKED' || code === 'SUPERSEDED';
  if (!codeRevoked && product !== 'REVOKED') return [];
  return [
    finding('POST_REVOCATION_SCAN', now, ctx?.currentScanId ? [ctx.currentScanId] : [], {
      codeStatus: code ?? null,
      productStatus: product ?? null,
    }),
  ];
};

export const RULES: Readonly<Record<RuleType, AnomalyRule>> = Object.freeze({
  IMPOSSIBLE_TRAVEL: impossibleTravel,
  SCAN_VELOCITY: scanVelocity,
  DEVICE_DIVERSITY: deviceDiversity,
  GEO_DISPERSION: geoDispersion,
  LOST_STOLEN_SCAN: lostStolenScan,
  POST_REVOCATION_SCAN: postRevocationScan,
});

/** Run every rule, decay each finding and combine them into one risk score. */
export function evaluateRules(
  history: readonly ScanRecord[],
  now: Date,
  config: AnomalyConfig,
  ctx: RuleContext = {},
): { riskScore: number; findings: ScoredFinding[] } {
  const findings: ScoredFinding[] = [];
  for (const type of RULE_TYPES) {
    for (const f of RULES[type](history, now, config, ctx)) {
      const decay = decayFactor(f.at, now, config.decayDays);
      if (decay <= 0) continue;
      findings.push({ ...f, decay, riskScore: clamp(Math.round(f.weight * decay), 0, 100) });
    }
  }
  return { riskScore: combineRisk(findings), findings };
}
