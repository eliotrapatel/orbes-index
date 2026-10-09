/**
 * The places from the connection (plan CUSTOMER INTELLIGENCE §3.3 T.8.2, step 3.3): `connectionPlace` (geo/place.ts),
 * the country and city of a request's connection or null, and PlaceService (services/places.ts, `ctx.services.places`),
 * a place's id in `geo_places` (migration 0042), created once, cached in an LRU of 5 000.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionPlace } from '../../src/server/geo/place.js';
import { GeoResolver } from '../../src/server/geo/resolver.js';
import { PLACE_CACHE_SIZE, PlaceService } from '../../src/server/services/places.js';
import type { Logger } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { buildMmdb, FIXTURE } from '../geo/support/mmdb-writer.js';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('connectionPlace', () => {
  let dir: string;
  let mmdb: GeoResolver;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-place-'));
    const path = join(dir, 'dbip-city-lite.mmdb');
    writeFileSync(path, buildMmdb(FIXTURE));
    mmdb = new GeoResolver({ mode: 'mmdb', mmdbPath: path }, { log: quiet });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('gives the connection\'s country and city from the GeoIP database, the city null when it knows only the country', () => {
    expect(connectionPlace({ geo: mmdb }, { headers: {}, ip: '81.2.69.160' })).toEqual({ country: 'GB', city: 'London' });
    expect(connectionPlace({ geo: mmdb }, { headers: {}, ip: '2a01:cb00:1234::1' })).toEqual({ country: 'FR', city: 'Paris' });
    expect(connectionPlace({ geo: mmdb }, { headers: {}, ip: '8.8.8.8' })).toEqual({ country: 'US', city: null });
  });

  it('is null without a country: an unknown, private or missing address, a record of nonsense, a resolver that throws', () => {
    for (const ip of ['9.9.9.9', '10.1.2.3', '100.64.0.1', undefined, '5.5.5.5']) expect(connectionPlace({ geo: mmdb }, { headers: {}, ip }), String(ip)).toBeNull();
    expect(connectionPlace({ geo: { resolve: () => ({ city: 'Paris' }) } }, { headers: {} })).toBeNull();
    expect(connectionPlace({ geo: { resolve: () => ({ country: 'fr' }) } }, { headers: {} })).toBeNull();
    expect(
      connectionPlace(
        {
          geo: {
            resolve: () => {
              throw new Error('down');
            },
          },
        },
        { headers: {} },
      ),
    ).toBeNull();
  });

  it('reads Cloudflare\'s country and city in cloudflare mode, and nothing in mode none', () => {
    const cf = new GeoResolver({ mode: 'cloudflare' });
    expect(connectionPlace({ geo: cf }, { headers: { 'cf-ipcountry': 'IT', 'cf-ipcity': 'Milan' } })).toEqual({ country: 'IT', city: 'Milan' });
    expect(connectionPlace({ geo: cf }, { headers: { 'cf-ipcountry': 'IT', 'cf-ipcity': '<b>' } })).toEqual({ country: 'IT', city: null });
    expect(connectionPlace({ geo: new GeoResolver({ mode: 'none' }) }, { headers: { 'cf-ipcountry': 'IT' }, ip: '81.2.69.160' })).toBeNull();
  });
});

describe('PlaceService', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  const rows = async () => (await t.db.selectFrom('geo_places').selectAll().orderBy('id').execute()).map((r) => ({ country: r.country, city: r.city }));

  it('creates a place once, a country alone included, and gives the same id after', async () => {
    const places = new PlaceService({ db: t.db });
    const paris = await places.idOf('FR', 'Paris');
    const france = await places.idOf('FR', null);
    const lyon = await places.idOf('FR', 'Lyon');
    expect(new Set([paris, france, lyon]).size).toBe(3);
    expect(await places.idOf('FR', 'Paris')).toBe(paris);
    expect(await places.idOf('FR')).toBe(france);
    // Another instance (another process, after a restart) reads the same rows, never a second one.
    const again = new PlaceService({ db: t.db });
    expect(await again.idOf('FR', 'Paris')).toBe(paris);
    expect(await again.idOf('FR', null)).toBe(france);
    expect(await rows()).toEqual([
      { country: 'FR', city: 'Paris' },
      { country: 'FR', city: null },
      { country: 'FR', city: 'Lyon' },
    ]);
  });

  it('is null without a valid country, and drops a city that is not a city\'s name, placing the country alone', async () => {
    const places = new PlaceService({ db: t.db });
    for (const country of [null, undefined, '', 'fr', 'FRA', 'F', '1A']) expect(await places.idOf(country as string, 'Paris'), String(country)).toBeNull();
    const germany = await places.idOf('DE', null);
    for (const city of ['', '   ', 'x'.repeat(81), 'Berlin<script>', 'Berlin/Mitte']) expect(await places.idOf('DE', city), city).toBe(germany);
    expect(await places.idOf('DE', '  Berlin ')).toBe(await places.idOf('DE', 'Berlin'));
    expect((await rows()).filter((r) => r.country === 'DE')).toEqual([
      { country: 'DE', city: null },
      { country: 'DE', city: 'Berlin' },
    ]);
  });

  it('answers a known place from memory, shares one read between concurrent asks, and stays idempotent under concurrency', async () => {
    const places = new PlaceService({ db: t.db });
    const ids = await Promise.all(Array.from({ length: 20 }, () => places.idOf('IT', 'Milan')));
    expect(new Set(ids).size).toBe(1);
    // Two services racing on one new place: one row, one id.
    const [a, b] = [new PlaceService({ db: t.db }), new PlaceService({ db: t.db })];
    const [x, y] = await Promise.all([a.idOf('ES', 'Madrid'), b.idOf('ES', 'Madrid')]);
    expect(x).toBe(y);
    expect((await rows()).filter((r) => r.country === 'ES')).toEqual([{ country: 'ES', city: 'Madrid' }]);
    // Cached: the row's id is answered without the database, even once the database is gone for this service.
    const cached = new PlaceService({ db: t.db });
    const milan = await cached.idOf('IT', 'Milan');
    const broken = Object.assign(Object.create(Object.getPrototypeOf(cached)), cached, { db: undefined }) as PlaceService;
    expect(await broken.idOf('IT', 'Milan')).toBe(milan);
  });

  it('holds at most its size, the least recently used place leaving first', async () => {
    expect(PLACE_CACHE_SIZE).toBe(5_000);
    const places = new PlaceService({ db: t.db, cacheSize: 2 });
    const ch = await places.idOf('CH', null);
    await places.idOf('AT', null);
    await places.idOf('CH', null); // CH is now the most recent
    await places.idOf('BE', null); // AT leaves
    expect(places.cached()).toBe(2);
    const broken = Object.assign(Object.create(Object.getPrototypeOf(places)), places, { db: undefined }) as PlaceService;
    expect(await broken.idOf('CH', null)).toBe(ch);
    await expect(broken.idOf('AT', null)).rejects.toBeDefined();
  });

  it('is the context\'s ctx.services.places', async () => {
    const { createHarness } = await import('../api/support.js');
    const h = await createHarness();
    try {
      expect(h.ctx.services.places).toBeInstanceOf(PlaceService);
      const id = await h.ctx.services.places.idOf('PT', 'Lisbon');
      expect(await h.ctx.db.selectFrom('geo_places').select(['country', 'city']).where('id', '=', id!).executeTakeFirstOrThrow()).toEqual({ country: 'PT', city: 'Lisbon' });
    } finally {
      await h.close();
    }
  });
});
