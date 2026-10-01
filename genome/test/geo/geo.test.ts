import { describe, expect, it } from 'vitest';
import { COUNTRY_CENTROIDS, countryCentroid, isKnownCountry } from '../../src/server/geo/centroids.js';
import { haversineKm, isValidLatLon } from '../../src/server/geo/haversine.js';
import { GeoResolver, normalizeCountry, normalizeLatLon, roundCoord } from '../../src/server/geo/resolver.js';

describe('haversineKm', () => {
  it('matches known great-circle distances within 1 %', () => {
    const paris = { lat: 48.8566, lon: 2.3522 };
    const tokyo = { lat: 35.6762, lon: 139.6503 };
    const nyc = { lat: 40.7128, lon: -74.006 };
    const london = { lat: 51.5074, lon: -0.1278 };
    expect(haversineKm(paris, tokyo)).toBeGreaterThan(9712 * 0.99);
    expect(haversineKm(paris, tokyo)).toBeLessThan(9712 * 1.01);
    expect(haversineKm(paris, nyc)).toBeCloseTo(5837, -2);
    expect(haversineKm(paris, london)).toBeCloseTo(344, -1);
  });

  it('is zero for identical points, symmetric, and bounded by half the circumference', () => {
    const a = { lat: 10, lon: 20 };
    const b = { lat: -33.9, lon: 151.2 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371.0088, 3);
  });

  it('handles the antimeridian', () => {
    expect(haversineKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(111.2, 0);
  });

  it('rejects invalid coordinates', () => {
    expect(() => haversineKm({ lat: 91, lon: 0 }, { lat: 0, lon: 0 })).toThrow(RangeError);
    expect(() => haversineKm({ lat: Number.NaN, lon: 0 }, { lat: 0, lon: 0 })).toThrow(RangeError);
    expect(isValidLatLon({ lat: 0, lon: 181 })).toBe(false);
    expect(isValidLatLon({ lat: -90, lon: -180 })).toBe(true);
  });
});

describe('country centroids', () => {
  it('covers ISO 3166-1 alpha-2 with sane coordinates', () => {
    const codes = Object.keys(COUNTRY_CENTROIDS);
    expect(codes.length).toBeGreaterThanOrEqual(245);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z]{2}$/);
      expect(isValidLatLon(COUNTRY_CENTROIDS[c])).toBe(true);
    }
    for (const c of ['FR', 'JP', 'US', 'GB', 'DE', 'IT', 'CN', 'AE', 'CH', 'SG', 'HK', 'BR', 'AU', 'ZA', 'MC']) {
      expect(isKnownCountry(c)).toBe(true);
    }
    expect(Object.isFrozen(COUNTRY_CENTROIDS)).toBe(true);
  });

  it('places countries roughly where they are', () => {
    const fr = countryCentroid('FR')!;
    expect(fr.lat).toBeGreaterThan(42);
    expect(fr.lat).toBeLessThan(51);
    expect(fr.lon).toBeGreaterThan(-5);
    expect(fr.lon).toBeLessThan(8);
    // Paris ↔ Tokyo via centroids is in the right ballpark.
    expect(haversineKm(fr, countryCentroid('JP')!)).toBeGreaterThan(9000);
    expect(haversineKm(countryCentroid('JP')!, countryCentroid('US')!)).toBeGreaterThan(8000);
  });

  it('rejects unknown or malformed codes', () => {
    expect(countryCentroid('XX')).toBeUndefined();
    expect(countryCentroid('T1')).toBeUndefined();
    expect(countryCentroid('fr')).toBeUndefined();
    expect(countryCentroid('__proto__')).toBeUndefined();
    expect(countryCentroid(undefined)).toBeUndefined();
    expect(countryCentroid(null)).toBeUndefined();
  });
});

describe('GeoResolver', () => {
  const req = (headers: Record<string, string | string[] | undefined>) => ({ headers });

  it('mode none returns nothing, whatever the headers say', () => {
    const r = new GeoResolver({ mode: 'none' });
    expect(r.resolve(req({ 'cf-ipcountry': 'FR', 'cf-iplatitude': '48.85', 'cf-iplongitude': '2.35' }))).toEqual({});
  });

  it('cloudflare mode reads cf-ipcountry / cf-iplatitude / cf-iplongitude and rounds to 1 decimal', () => {
    const r = new GeoResolver({ mode: 'cloudflare' });
    expect(r.resolve(req({ 'cf-ipcountry': 'FR', 'cf-iplatitude': '48.85661', 'cf-iplongitude': '2.35222' }))).toEqual({
      country: 'FR',
      lat: 48.9,
      lon: 2.4,
    });
    expect(r.resolve(req({ 'cf-ipcountry': 'jp' }))).toEqual({ country: 'JP' });
    expect(r.resolve(req({ 'cf-region': 'Île-de-France', 'cf-ipcountry': 'FR' }))).toEqual({ country: 'FR', region: 'Île-de-France' });
  });

  it('drops Cloudflare pseudo-countries and malformed values', () => {
    const r = new GeoResolver({ mode: 'cloudflare' });
    expect(r.resolve(req({ 'cf-ipcountry': 'XX' }))).toEqual({});
    expect(r.resolve(req({ 'cf-ipcountry': 'T1' }))).toEqual({});
    expect(r.resolve(req({ 'cf-ipcountry': 'FRA' }))).toEqual({});
    expect(r.resolve(req({ 'cf-iplatitude': '95', 'cf-iplongitude': '2' }))).toEqual({});
    expect(r.resolve(req({ 'cf-iplatitude': '1e2', 'cf-iplongitude': '2' }))).toEqual({});
    expect(r.resolve(req({ 'cf-iplatitude': '48.8' }))).toEqual({}); // never half a point
    expect(r.resolve(req({ 'cf-iplatitude': 'NaN', 'cf-iplongitude': 'Infinity' }))).toEqual({});
    expect(r.resolve(req({ 'cf-region': '<script>' }))).toEqual({});
    expect(r.resolve(req({ 'cf-region': 'x'.repeat(65) }))).toEqual({});
  });

  it('headers mode reads the configured names (case-insensitive) and takes the first of repeated headers', () => {
    const r = new GeoResolver({ mode: 'headers', countryHeader: 'X-Geo-Country', latHeader: 'x-geo-lat', lonHeader: 'x-geo-lon' });
    expect(r.resolve(req({ 'x-geo-country': ['US', 'FR'], 'x-geo-lat': '40.71', 'x-geo-lon': '-74.01' }))).toEqual({
      country: 'US',
      lat: 40.7,
      lon: -74,
    });
    // Cloudflare headers are ignored in headers mode.
    expect(r.resolve(req({ 'cf-ipcountry': 'FR' }))).toEqual({});
  });

  it('headers mode without configured names returns nothing', () => {
    expect(new GeoResolver({ mode: 'headers' }).resolve(req({ 'x-geo-country': 'FR' }))).toEqual({});
  });

  it('survives garbage requests', () => {
    const r = new GeoResolver({ mode: 'cloudflare' });
    expect(r.resolve({} as never)).toEqual({});
    expect(r.resolve(null as never)).toEqual({});
  });

  it('helpers', () => {
    expect(roundCoord(-0.04)).toBe(0);
    expect(Object.is(roundCoord(-0.04), -0)).toBe(false);
    expect(roundCoord(12.349)).toBe(12.3);
    expect(normalizeCountry(' gb ')).toBe('GB');
    expect(normalizeLatLon('-33.86', '151.21')).toEqual({ lat: -33.9, lon: 151.2 });
  });
});

describe('country radii', () => {
  it('large countries have a larger centroid-to-edge radius than the default', async () => {
    const { countryRadiusKm, DEFAULT_COUNTRY_RADIUS_KM } = await import('../../src/server/geo/centroids.js');
    expect(countryRadiusKm('US')).toBeGreaterThan(2000);
    expect(countryRadiusKm('RU')).toBeGreaterThan(countryRadiusKm('FR'));
    expect(countryRadiusKm('MC')).toBe(DEFAULT_COUNTRY_RADIUS_KM);
    expect(countryRadiusKm(undefined)).toBe(DEFAULT_COUNTRY_RADIUS_KM);
    expect(countryRadiusKm('__proto__')).toBe(DEFAULT_COUNTRY_RADIUS_KM);
    for (const c of Object.keys(COUNTRY_CENTROIDS)) expect(countryRadiusKm(c)).toBeGreaterThan(0);
  });
});
