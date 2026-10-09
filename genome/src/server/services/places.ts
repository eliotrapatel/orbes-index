/**
 * The places from the connection (plan CUSTOMER INTELLIGENCE §3.3 T.8.2): `geo_places`, a country with or without a
 * city, once each, never deleted. `idOf` gives a place's integer id, so a view, a device and a collector's place carry
 * four bytes instead of the words.
 *
 * Cost on the shared server: an LRU of 5 000 places in memory (≈ 0.5 MB), so a known place costs no query; an unknown
 * one costs `INSERT … ON CONFLICT (country, city) DO NOTHING` then one SELECT, both idempotent under concurrency (the
 * key is NULLS NOT DISTINCT, so a country alone is one row too). Concurrent asks for the same place share one read.
 */
import { normalizeCity } from '../geo/resolver.js';
import type { Db } from '../db/connection.js';

/** How many places the cache holds (T.7: ≈ 0.5 MB). */
export const PLACE_CACHE_SIZE = 5_000;

const COUNTRY_RE = /^[A-Z]{2}$/;

export interface PlaceServiceDeps {
  db: Db;
  /** The cache's size (tests). Default PLACE_CACHE_SIZE. */
  cacheSize?: number;
}

export class PlaceService {
  private readonly db: Db;
  private readonly max: number;
  /** key → id, oldest first (a hit moves its key to the end). */
  private readonly cache = new Map<string, number>();
  private readonly pending = new Map<string, Promise<number>>();

  constructor(deps: PlaceServiceDeps) {
    this.db = deps.db;
    this.max = Math.max(1, deps.cacheSize ?? PLACE_CACHE_SIZE);
  }

  /**
   * The id of the place (country, city), created when new. Null without a valid country (two capitals). A city that is
   * not a city's name (empty, over 80 characters, odd characters) is dropped and the country alone is placed.
   */
  async idOf(country: string | null | undefined, city?: string | null): Promise<number | null> {
    if (typeof country !== 'string' || !COUNTRY_RE.test(country)) return null;
    const name = normalizeCity(city) ?? null;
    const key = `${country}\u0000${name ?? ''}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    let read = this.pending.get(key);
    if (!read) {
      read = this.read(country, name).finally(() => this.pending.delete(key));
      this.pending.set(key, read);
    }
    const id = await read;
    this.remember(key, id);
    return id;
  }

  /** How many places the cache holds now (tests and Server status). */
  cached(): number {
    return this.cache.size;
  }

  private async read(country: string, city: string | null): Promise<number> {
    await this.db.insertInto('geo_places').values({ country, city }).onConflict((oc) => oc.columns(['country', 'city']).doNothing()).execute();
    const row = await this.db
      .selectFrom('geo_places')
      .select('id')
      .where('country', '=', country)
      .where('city', city === null ? 'is' : '=', city)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  private remember(key: string, id: number): void {
    this.cache.delete(key);
    this.cache.set(key, id);
    while (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
