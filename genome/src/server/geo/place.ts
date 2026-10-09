/**
 * The connection's place (plan CUSTOMER INTELLIGENCE §3.3 T.8.2): the country and, when the GeoIP database knows it, the
 * city of the request's connection, approximate. For CREATE ACCOUNT's preselected country (§3.1 P.4.3) and for the
 * customer intelligence's places (`geo_places` through PlaceService, the devices' last place, the collectors' places).
 * Always the connection's, labelled as such, never written into the profile or the address book.
 */
import type { GeoRequest, GeoResolver } from './resolver.js';

export interface ConnectionPlace {
  /** ISO 3166-1 alpha-2, upper case. */
  country: string;
  /** 1 to 80 characters, trimmed; null when unknown. */
  city: string | null;
}

/** The connection's country and city, or null without a country (a city alone places nothing). Never throws. */
export function connectionPlace(ctx: { geo: Pick<GeoResolver, 'resolve'> }, request: GeoRequest): ConnectionPlace | null {
  let geo: ReturnType<GeoResolver['resolve']>;
  try {
    geo = ctx.geo.resolve(request);
  } catch {
    return null;
  }
  if (typeof geo.country !== 'string' || !/^[A-Z]{2}$/.test(geo.country)) return null;
  return { country: geo.country, city: typeof geo.city === 'string' ? geo.city : null };
}
