/**
 * Great-circle distance (haversine) on a spherical Earth. Accurate to about
 * 0.5 % against the ellipsoid, far finer than the coarse locations it is fed.
 */
import type { LatLon } from './centroids.js';

/** IUGG mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6371.0088;

const RAD = Math.PI / 180;

/** Distance in km between two points. Throws RangeError on non-finite or out-of-range input. */
export function haversineKm(a: LatLon, b: LatLon): number {
  assertPoint(a);
  assertPoint(b);
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  // min(): rounding can push s a hair above 1 for antipodal points, which would make asin NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function isValidLatLon(p: { lat?: unknown; lon?: unknown } | null | undefined): p is LatLon {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180
  );
}

function assertPoint(p: LatLon): void {
  if (!isValidLatLon(p)) throw new RangeError('haversineKm: invalid coordinates');
}
