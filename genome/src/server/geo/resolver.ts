/**
 * GeoResolver (contract §2.12): coarse location of a request, from headers set
 * by the edge (Cloudflare) or by a trusted reverse proxy, or (GEO_MODE=mmdb)
 * from a local GeoIP database applied to the client IP the HTTP layer already
 * computed (`request.ip`, which honours TRUST_PROXY): see mmdb.ts.
 *
 * Privacy: coordinates are rounded to 1 decimal (≈ 10 km) before they leave
 * this module. The raw IP address is only read in mmdb mode, in memory, for
 * the lookup: it is never logged or returned. Only the peppered HMAC of the IP
 * (computed by the HTTP layer) is ever stored.
 *
 * Header values are attacker-controlled unless a proxy overwrites them, which
 * is why `headers` mode is only allowed with TRUST_PROXY (enforced by config)
 * and every value is strictly validated: anything odd is dropped, never
 * guessed. Location only feeds anomaly scoring, so a missing value is safe.
 *
 * The city (plan CUSTOMER INTELLIGENCE §3.3 T.8.2) is read too, from the GeoIP record (`city.names.en`) or Cloudflare's
 * `cf-ipcity`, by the same rule as the region. It feeds only the customer intelligence's places (geo/place.ts):
 * VerificationService reads the geo fields one by one, so a city never reaches `scan_events` nor anomaly scoring.
 */
import type { AppConfig } from '../config.js';
import type { Clock, Logger } from '../types.js';
import { isKnownCountry } from './centroids.js';
import { MmdbGeoDatabase } from './mmdb.js';

export interface GeoInfo {
  /** ISO 3166-1 alpha-2, upper case. */
  country?: string;
  region?: string;
  /** The connection's city, approximate (1 to 80 characters, trimmed): only for the customer intelligence's places, never stored with a scan. */
  city?: string;
  /** Rounded to 1 decimal. Present only together with `lon`. */
  lat?: number;
  lon?: number;
}

/** The part of an HTTP request the resolver reads (Fastify's `request` satisfies it). */
export interface GeoRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Client IP as resolved by Fastify (TRUST_PROXY applied). Read only in mmdb mode. */
  ip?: string;
}

export interface GeoResolverOptions {
  /** Warnings about the GeoIP database (mmdb mode). Default: JSON lines on stderr. */
  log?: Logger;
  clock?: Clock;
  /** Use this database instead of opening config.mmdbPath (tests). */
  mmdb?: MmdbGeoDatabase;
}

export type GeoConfig = AppConfig['geo'];

const CLOUDFLARE = { country: 'cf-ipcountry', lat: 'cf-iplatitude', lon: 'cf-iplongitude', region: 'cf-region', city: 'cf-ipcity' } as const;
const DECIMAL_RE = /^[+-]?\d{1,3}(?:\.\d{1,12})?$/;
const MAX_REGION_LENGTH = 64;
/** A city's longest name kept (geo_places.city, migration 0042). */
export const MAX_CITY_LENGTH = 80;
// Letters (any script), digits, spaces and common punctuation of region names ("Île-de-France", "St. John's").
const REGION_RE = /^[\p{L}\p{M}\p{N} .,'()\-]+$/u;

export class GeoResolver {
  private readonly mode: GeoConfig['mode'];
  private readonly names: { country?: string; lat?: string; lon?: string; region?: string; city?: string };
  /** The GeoIP database (mmdb mode only). */
  readonly mmdb: MmdbGeoDatabase | undefined;

  constructor(config: GeoConfig, options: GeoResolverOptions = {}) {
    this.mode = config.mode;
    if (config.mode === 'mmdb') {
      // config.ts requires an absolute GEO_MMDB_PATH in this mode; an empty path just means "no database".
      this.mmdb = options.mmdb ?? new MmdbGeoDatabase({ path: config.mmdbPath ?? '', log: options.log, clock: options.clock });
    }
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
    if (this.mode === 'none' || !request || typeof request !== 'object') return {};
    if (this.mode === 'mmdb') return this.mmdb ? this.mmdb.lookup(request.ip) : {};
    if (!request.headers) return {};
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
    const city = normalizeCity(header(request, this.names.city));
    if (city) out.city = city;
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

/**
 * A city's name as the region's (letters of any script, digits, spaces, `.,'()-`), trimmed, 1 to 80 characters, else
 * undefined: anything odd is dropped, never guessed.
 */
export function normalizeCity(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const c = v.trim();
  if (c.length === 0 || c.length > MAX_CITY_LENGTH || !REGION_RE.test(c)) return undefined;
  return c;
}

function header(request: GeoRequest, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const v = request.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length <= 256 ? s : undefined;
}
