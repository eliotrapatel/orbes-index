/**
 * GeoResolver (contract §2.12): coarse location of a request, from headers set
 * by the edge (Cloudflare) or by a trusted reverse proxy.
 *
 * Privacy: coordinates are rounded to 1 decimal (≈ 10 km) before they leave
 * this module, and the raw IP address is never read here. Only the peppered
 * HMAC of the IP (computed by the HTTP layer) is ever stored.
 *
 * Header values are attacker-controlled unless a proxy overwrites them, which
 * is why `headers` mode is only allowed with TRUST_PROXY (enforced by config)
 * and every value is strictly validated: anything odd is dropped, never
 * guessed. Location only feeds anomaly scoring, so a missing value is safe.
 */
import type { AppConfig } from '../config.js';
import { isKnownCountry } from './centroids.js';

export interface GeoInfo {
  /** ISO 3166-1 alpha-2, upper case. */
  country?: string;
  region?: string;
  /** Rounded to 1 decimal. Present only together with `lon`. */
  lat?: number;
  lon?: number;
}

/** The part of an HTTP request the resolver reads (Fastify's `request` satisfies it). */
export interface GeoRequest {
  headers: Record<string, string | string[] | undefined>;
}

export type GeoConfig = AppConfig['geo'];

const CLOUDFLARE = { country: 'cf-ipcountry', lat: 'cf-iplatitude', lon: 'cf-iplongitude', region: 'cf-region' } as const;
const DECIMAL_RE = /^[+-]?\d{1,3}(?:\.\d{1,12})?$/;
const MAX_REGION_LENGTH = 64;
// Letters (any script), digits, spaces and common punctuation of region names ("Île-de-France", "St. John's").
const REGION_RE = /^[\p{L}\p{M}\p{N} .,'()\-]+$/u;

export class GeoResolver {
  private readonly mode: GeoConfig['mode'];
  private readonly names: { country?: string; lat?: string; lon?: string; region?: string };

  constructor(config: GeoConfig) {
    this.mode = config.mode;
    if (config.mode === 'cloudflare') this.names = CLOUDFLARE;
    else if (config.mode === 'headers') {
      this.names = {
        country: config.countryHeader?.toLowerCase(),
        lat: config.latHeader?.toLowerCase(),
        lon: config.lonHeader?.toLowerCase(),
      };
    } else this.names = {};
  }

  resolve(request: GeoRequest): GeoInfo {
    if (this.mode === 'none' || !request || typeof request !== 'object' || !request.headers) return {};
    const out: GeoInfo = {};
    const country = normalizeCountry(header(request, this.names.country));
    if (country) out.country = country;
    const point = normalizeLatLon(header(request, this.names.lat), header(request, this.names.lon));
    if (point) {
      out.lat = point.lat;
      out.lon = point.lon;
    }
    const region = normalizeRegion(header(request, this.names.region));
    if (region) out.region = region;
    return out;
  }
}

/** Round to 1 decimal place (≈ 10 km), the only precision ORBES ever stores. */
export function roundCoord(v: number): number {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Upper-case alpha-2 code with a known centroid, else undefined. Drops
 * Cloudflare's pseudo-codes (XX unknown, T1 Tor) and anything malformed.
 */
export function normalizeCountry(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const c = v.trim().toUpperCase();
  return isKnownCountry(c) ? c : undefined;
}

/** Both coordinates valid and in range → rounded pair; otherwise undefined (never half a point). */
export function normalizeLatLon(lat: string | undefined, lon: string | undefined): { lat: number; lon: number } | undefined {
  if (lat === undefined || lon === undefined) return undefined;
  const a = lat.trim();
  const b = lon.trim();
  if (!DECIMAL_RE.test(a) || !DECIMAL_RE.test(b)) return undefined;
  const la = Number(a);
  const lo = Number(b);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return undefined;
  return { lat: roundCoord(la), lon: roundCoord(lo) };
}

function normalizeRegion(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const r = v.trim();
  if (r.length === 0 || r.length > MAX_REGION_LENGTH || !REGION_RE.test(r)) return undefined;
  return r;
}

function header(request: GeoRequest, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = request.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length <= 256 ? s : undefined;
}
