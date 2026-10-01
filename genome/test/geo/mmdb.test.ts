/**
 * GEO_MODE=mmdb: the local GeoIP database (src/server/geo/mmdb.ts), against a
 * tiny synthetic MaxMind DB built in memory (test/geo/support/mmdb-writer.ts).
 * No real DB-IP file is needed or committed.
 */
import { mkdtempSync, rmSync, writeFileSync, renameSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MMDB_CHECK_INTERVAL_MS, MmdbGeoDatabase, geoFromRecord, openMmdb, publicAddress } from '../../src/server/geo/mmdb.js';
import { createManualClock, type Logger } from '../../src/server/types.js';
import { buildMmdb, FIXTURE, FIXTURE_V2 } from './support/mmdb-writer.js';

interface Line {
  level: 'info' | 'warn' | 'error';
  o: unknown;
  m?: string;
}
function captureLog(): Logger & { lines: Line[]; warns(): Line[] } {
  const lines: Line[] = [];
  return {
    lines,
    warns: () => lines.filter((l) => l.level === 'warn'),
    info: (o, m) => lines.push({ level: 'info', o, m }),
    warn: (o, m) => lines.push({ level: 'warn', o, m }),
    error: (o, m) => lines.push({ level: 'error', o, m }),
  };
}

let dir: string;
let n = 0;
const fresh = (name = 'db.mmdb') => join(dir, `${++n}-${name}`);
/** Every log line any test produced: checked at the end for raw IPs. */
const allLogs: Line[] = [];
function tracked() {
  const log = captureLog();
  const push = log.lines.push.bind(log.lines);
  log.lines.push = (...items: Line[]) => {
    allLogs.push(...items);
    return push(...items);
  };
  return log;
}
/** Atomic replace, like scripts/geoip-update.ts does, with a distinct mtime. */
function replace(path: string, bytes: Buffer, mtimeSec: number) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, bytes);
  utimesSync(tmp, mtimeSec, mtimeSec);
  renameSync(tmp, path);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbes-mmdb-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('publicAddress (which addresses are ever looked up)', () => {
  it('accepts global unicast IPv4 and IPv6, unmapping IPv4-mapped IPv6', () => {
    expect(publicAddress('81.2.69.160')).toEqual({ address: '81.2.69.160', family: 4 });
    expect(publicAddress('2a01:cb00::1')).toEqual({ address: '2a01:cb00::1', family: 6 });
    expect(publicAddress('::ffff:81.2.69.160')).toEqual({ address: '81.2.69.160', family: 4 });
    expect(publicAddress('::FFFF:90.1.2.3')).toEqual({ address: '90.1.2.3', family: 4 });
  });

  it('refuses private, loopback, link-local, CGNAT, documentation, multicast and reserved ranges', () => {
    for (const ip of [
      '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0',
      '192.0.2.1', '198.51.100.7', '203.0.113.10', '198.18.0.1', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255',
      '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1',
      '2001:db8::1', '2001:0:4136:e378::1' /* Teredo */, '2002:c000:0204::1' /* 6to4 */, '64:ff9b::808:808' /* NAT64 */, '3fff::1',
    ]) {
      expect(publicAddress(ip), ip).toBeUndefined();
    }
    expect(publicAddress('172.15.255.255')).toBeDefined(); // just outside 172.16/12
    expect(publicAddress('100.128.0.1')).toBeDefined(); // just outside 100.64/10
  });

  it('refuses anything that is not an IP address', () => {
    for (const v of [undefined, null, 42, '', 'localhost', '81.2.69', '81.2.69.256', '1.2.3.4/24', ' 81.2.69.160', 'x'.repeat(100), {}]) {
      expect(publicAddress(v as unknown)).toBeUndefined();
    }
  });
});

describe('geoFromRecord', () => {
  it('keeps a known alpha-2 country and a point rounded to 1 decimal', () => {
    expect(geoFromRecord({ country: { iso_code: 'gb' }, location: { latitude: 51.5142, longitude: -0.0931 } })).toEqual({ country: 'GB', lat: 51.5, lon: -0.1 });
    expect(geoFromRecord({ registered_country: { iso_code: 'FR' } })).toEqual({ country: 'FR' });
    expect(geoFromRecord({ location: { latitude: -0.04, longitude: 0.04 } })).toEqual({ lat: 0, lon: 0 }); // never -0
  });

  it('drops unknown countries, out-of-range or non-numeric coordinates and junk', () => {
    expect(geoFromRecord({ country: { iso_code: 'ZZ' }, location: { latitude: 200, longitude: 0 } })).toEqual({});
    expect(geoFromRecord({ country: { iso_code: 42 }, location: { latitude: '48.8', longitude: 2.3 } })).toEqual({});
    expect(geoFromRecord({ location: { latitude: 48.8 } })).toEqual({});
    expect(geoFromRecord({ location: { latitude: Number.NaN, longitude: 1 } })).toEqual({});
    for (const v of [null, undefined, 'FR', 7, []]) expect(geoFromRecord(v)).toEqual({});
  });
});

describe('openMmdb', () => {
  it('opens the synthetic fixture', () => {
    const r = openMmdb(buildMmdb(FIXTURE));
    expect(r.metadata.databaseType).toBe('ORBES-Test-City');
    expect(r.metadata.ipVersion).toBe(6);
  });

  it('refuses empty, random, truncated and legacy-looking files with a short message', () => {
    const good = buildMmdb(FIXTURE);
    expect(() => openMmdb(Buffer.alloc(0))).toThrow(/too small/);
    expect(() => openMmdb(Buffer.alloc(4096, 0x5a))).toThrow(/not a readable MaxMind DB/);
    expect(() => openMmdb(good.subarray(0, Math.floor(good.length / 2)))).toThrow();
    expect(() => openMmdb(good.subarray(0, good.length - 40))).toThrow();
    // Metadata intact but the search tree cut away: the walk must fail at open time, not on a request.
    const marker = good.lastIndexOf(Buffer.from('MaxMind.com'));
    expect(() => openMmdb(Buffer.concat([good.subarray(0, 64), good.subarray(marker - 3)]))).toThrow();
  });
});

describe('MmdbGeoDatabase', () => {
  it('resolves fixture addresses to { country, lat, lon } rounded to 1 decimal', () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const log = tracked();
    const db = new MmdbGeoDatabase({ path, log });
    expect(db.status()).toMatchObject({ path, loaded: true, databaseType: 'ORBES-Test-City', ipVersion: 6 });
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ level: 'info', m: 'geoip database loaded' });

    expect(db.lookup('81.2.69.160')).toEqual({ country: 'GB', lat: 51.5, lon: -0.1 });
    expect(db.lookup('::ffff:81.2.69.160')).toEqual({ country: 'GB', lat: 51.5, lon: -0.1 });
    expect(db.lookup('90.12.34.56')).toEqual({ country: 'FR', lat: 48.9, lon: 2.4 });
    expect(db.lookup('1.0.17.1')).toEqual({ country: 'JP', lat: 35.7, lon: 139.7 });
    expect(db.lookup('2a01:cb00:1234::1')).toEqual({ country: 'FR', lat: 48.9, lon: 2.4 });
    expect(db.lookup('8.8.8.8')).toEqual({ country: 'US' }); // country-only record
    expect(db.lookup('5.5.5.5')).toEqual({}); // bogus record values are dropped
    expect(db.lookup('9.9.9.9')).toEqual({}); // not in the database
    expect(db.lookup('2600::1')).toEqual({});
  });

  it('never looks up private or reserved addresses, even if the database has them', () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const db = new MmdbGeoDatabase({ path, log: tracked() });
    expect(db.lookup('10.1.2.3')).toEqual({}); // the fixture maps 10/8 to FR on purpose
    expect(db.lookup('::ffff:10.1.2.3')).toEqual({});
    expect(db.lookup('127.0.0.1')).toEqual({});
    expect(db.lookup(undefined)).toEqual({});
    expect(db.lookup('not an ip')).toEqual({});
  });

  it('missing file: warns once, degrades to no geo, never throws; picks the file up once installed', async () => {
    const path = fresh();
    const clock = createManualClock('2026-10-01T00:00:00Z');
    const log = tracked();
    const db = new MmdbGeoDatabase({ path, log, clock: clock.now });
    expect(db.status()).toEqual({ path, loaded: false });
    for (let i = 0; i < 50; i++) expect(db.lookup('81.2.69.160')).toEqual({});
    expect(log.warns()).toHaveLength(1);
    expect(log.warns()[0].m).toMatch(/unavailable.*verification is unaffected/);
    expect(JSON.stringify(log.warns()[0].o)).toContain('ENOENT');

    // Still missing at the next check: no second warning.
    clock.advance(MMDB_CHECK_INTERVAL_MS);
    db.lookup('81.2.69.160');
    await db.settled();
    expect(log.warns()).toHaveLength(1);

    // Installed later: loaded at the next check without a restart.
    writeFileSync(path, buildMmdb(FIXTURE));
    clock.advance(MMDB_CHECK_INTERVAL_MS - 1);
    expect(db.lookup('81.2.69.160')).toEqual({}); // interval not over yet
    await db.settled();
    clock.advance(1);
    db.lookup('81.2.69.160'); // triggers the background check
    await db.settled();
    expect(db.lookup('81.2.69.160')).toEqual({ country: 'GB', lat: 51.5, lon: -0.1 });
    expect(log.lines.at(-1)).toMatchObject({ level: 'info', m: 'geoip database loaded' });
  });

  it('corrupt or empty file: warns once per problem and degrades to no geo', () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(10_000, 0xab), buildMmdb(FIXTURE).subarray(0, 900)]) {
      const path = fresh();
      writeFileSync(path, bytes);
      const log = tracked();
      const db = new MmdbGeoDatabase({ path, log });
      expect(db.lookup('81.2.69.160')).toEqual({});
      expect(db.lookup('90.1.2.3')).toEqual({});
      expect(log.warns()).toHaveLength(1);
      expect(db.status().loaded).toBe(false);
    }
    // A directory where the file should be.
    const log = tracked();
    expect(new MmdbGeoDatabase({ path: dir, log }).lookup('81.2.69.160')).toEqual({});
    expect(log.warns()).toHaveLength(1);
  });

  it('reloads a replaced file only after the check interval (mtime/size/inode), without blocking lookups', async () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const clock = createManualClock('2026-10-01T00:00:00Z');
    const log = tracked();
    const db = new MmdbGeoDatabase({ path, log, clock: clock.now });
    expect(db.lookup('81.2.69.160').country).toBe('GB');

    replace(path, buildMmdb(FIXTURE_V2), 1_800_000_000);
    clock.advance(MMDB_CHECK_INTERVAL_MS - 1000);
    expect(db.lookup('81.2.69.160').country).toBe('GB'); // not re-checked yet
    await db.settled();
    expect(db.lookup('81.2.69.160').country).toBe('GB');

    clock.advance(1000);
    // The lookup that starts the check is answered from the copy in memory.
    expect(db.lookup('81.2.69.160').country).toBe('GB');
    await db.settled();
    expect(db.lookup('81.2.69.160')).toEqual({ country: 'DE', lat: 52.5, lon: 13.4 });
    expect(log.lines.at(-1)).toMatchObject({ level: 'info', m: 'geoip database reloaded' });
    expect(db.status().buildEpoch).toBe(new Date(1_792_000_000 * 1000).toISOString());

    // Unchanged file: the next checks reload nothing.
    const before = log.lines.length;
    clock.advance(MMDB_CHECK_INTERVAL_MS);
    db.lookup('81.2.69.160');
    await db.settled();
    expect(log.lines).toHaveLength(before);
  });

  it('a broken replacement keeps the database in memory, warns once and is not re-read until it changes', async () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const clock = createManualClock('2026-10-01T00:00:00Z');
    const log = tracked();
    const db = new MmdbGeoDatabase({ path, log, clock: clock.now });

    replace(path, Buffer.alloc(5000, 0x11), 1_800_000_100);
    for (let i = 0; i < 3; i++) {
      clock.advance(MMDB_CHECK_INTERVAL_MS);
      db.lookup('81.2.69.160');
      await db.settled();
    }
    expect(db.lookup('81.2.69.160').country).toBe('GB');
    expect(log.warns()).toHaveLength(1);
    expect(log.warns()[0].m).toMatch(/keeping the copy already in memory/);

    // Deleted entirely: still served from memory, one more (different) warning at most.
    rmSync(path);
    clock.advance(MMDB_CHECK_INTERVAL_MS);
    db.lookup('81.2.69.160');
    await db.settled();
    expect(db.lookup('81.2.69.160').country).toBe('GB');
    expect(log.warns()).toHaveLength(2);

    // A good file again: reloaded.
    replace(path, buildMmdb(FIXTURE_V2), 1_800_000_200);
    clock.advance(MMDB_CHECK_INTERVAL_MS);
    db.lookup('81.2.69.160');
    await db.settled();
    expect(db.lookup('81.2.69.160').country).toBe('DE');
  });

  it('a lookup that fails inside the reader returns no geo and warns once', () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const log = tracked();
    const db = new MmdbGeoDatabase({ path, log });
    const loaded = (db as unknown as { loaded: { reader: { get: (ip: string) => unknown } } }).loaded;
    loaded.reader.get = () => {
      throw new Error('Unexpected data type at offset 81.2.69.160'); // even a message that echoes input…
    };
    expect(db.lookup('81.2.69.160')).toEqual({});
    expect(db.lookup('90.1.2.3')).toEqual({});
    expect(log.warns()).toHaveLength(1);
  });

  it('refresh() never rejects and concurrent checks share one run', async () => {
    const path = fresh();
    const db = new MmdbGeoDatabase({ path, log: tracked() });
    const a = db.refresh();
    const b = db.refresh();
    expect(a).toBe(b);
    await expect(a).resolves.toBeUndefined();
  });

  it('a lookup costs well under 0.1 ms', () => {
    const path = fresh();
    writeFileSync(path, buildMmdb(FIXTURE));
    const db = new MmdbGeoDatabase({ path, log: tracked() });
    const ips = ['81.2.69.160', '90.1.2.3', '1.0.17.1', '8.8.8.8', '2a01:cb00::1', '9.9.9.9', '10.0.0.1', '::ffff:81.2.69.1'];
    for (let i = 0; i < 2000; i++) db.lookup(ips[i % ips.length]); // warm-up
    const N = 20_000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) db.lookup(ips[i % ips.length]);
    const perLookupMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    // Typically a few microseconds; the bound is loose so slow CI machines stay green.
    expect(perLookupMs).toBeLessThan(0.1);
  });

  it('never writes a client IP address into the log', () => {
    expect(allLogs.length).toBeGreaterThan(5);
    const text = JSON.stringify(allLogs);
    for (const ip of ['81.2.69', '90.1.2.3', '90.12.34.56', '1.0.17.1', '2a01:cb00', '10.1.2.3', '9.9.9.9']) {
      expect(text).not.toContain(ip);
    }
  });
});
