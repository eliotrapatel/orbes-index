/**
 * scripts/geoip-update.ts with an injected fetch serving the synthetic fixture:
 * month fallback, gzip integrity, validation probes, atomic install keeping the
 * previous file, idempotence, dry run, --check and --rollback. No network.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editions, runGeoipUpdate, type InstalledState } from '../../scripts/geoip-update.js';
import { buildMmdb, FIXTURE, FIXTURE_V2 } from './support/mmdb-writer.js';

const NOW = () => new Date('2026-10-01T03:00:00Z');
const BASE = 'https://download.db-ip.com/free';
const URL_OCT = `${BASE}/dbip-city-lite-2026-10.mmdb.gz`;
const URL_SEP = `${BASE}/dbip-city-lite-2026-09.mmdb.gz`;
const PROBE = ['--probe', '81.2.69.160=GB'];
const PROBE_ANY = ['--probe', '90.1.2.3=FR']; // true in both fixtures

let dir: string;
let n = 0;

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

/** A fetch that serves `files` (url → bytes) and 404 for anything else; records calls. */
function fakeFetch(files: Record<string, Buffer | (() => Response)>) {
  const calls: { url: string; method: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const v = files[url];
    if (v === undefined) return new Response('not found', { status: 404 });
    if (typeof v === 'function') return v();
    return new Response(method === 'HEAD' ? null : new Uint8Array(v), { status: 200, headers: { 'content-length': String(v.length) } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

function freshTarget(): string {
  const d = join(dir, String(++n));
  return join(d, 'dbip-city-lite.mmdb');
}

const gz1 = () => gzipSync(buildMmdb(FIXTURE));
const gz2 = () => gzipSync(buildMmdb(FIXTURE_V2));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbes-geoip-update-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('editions()', () => {
  it('current UTC month first, then the previous one (across the year boundary)', () => {
    expect(editions(undefined, new Date('2026-10-01T00:30:00Z'))).toEqual(['2026-10', '2026-09']);
    expect(editions(undefined, new Date('2027-01-01T00:00:00Z'))).toEqual(['2027-01', '2026-12']);
    expect(editions('2026-07', new Date())).toEqual(['2026-07']);
    expect(() => editions('2026-13', new Date())).toThrow(/YYYY-MM/);
  });
});

describe('geoip-update', () => {
  it('installs the current edition, validated, with a sidecar state file and no temp files left', async () => {
    const target = freshTarget();
    const f = fakeFetch({ [URL_OCT]: gz1() });
    const c = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(readFileSync(target).equals(buildMmdb(FIXTURE))).toBe(true);
    const state = JSON.parse(readFileSync(`${target}.json`, 'utf8')) as InstalledState;
    expect(state).toMatchObject({ edition: '2026-10', url: URL_OCT, bytes: buildMmdb(FIXTURE).length, databaseType: 'ORBES-Test-City' });
    expect(state.attribution).toMatch(/IP Geolocation by DB-IP/);
    expect(readdirSync(join(target, '..')).sort()).toEqual(['dbip-city-lite.mmdb', 'dbip-city-lite.mmdb.json']);
    expect(c.out.join('\n')).toMatch(/probe 81\.2\.69\.160 → GB \(51\.5, -0\.1\) OK/);
    expect(c.out.join('\n')).toMatch(/installed edition 2026-10/);
  });

  it('is idempotent: an installed, intact edition is not downloaded again (unless --force)', async () => {
    const target = freshTarget();
    const f = fakeFetch({ [URL_OCT]: gz1() });
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: io().io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls).toHaveLength(1);
    const c = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls).toHaveLength(1);
    expect(c.out.join('\n')).toMatch(/already installed and intact/);
    // A tampered file is not "intact": downloaded again.
    writeFileSync(target, Buffer.from('tampered'));
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: io().io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls).toHaveLength(2);
    expect(await runGeoipUpdate(['--path', target, '--force', ...PROBE], { io: io().io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls).toHaveLength(3);
  });

  it('falls back to the previous month while the current one is not published (404)', async () => {
    const target = freshTarget();
    const f = fakeFetch({ [URL_SEP]: gz1() });
    const c = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls.map((x) => x.url)).toEqual([URL_OCT, URL_SEP]);
    expect(JSON.parse(readFileSync(`${target}.json`, 'utf8')).edition).toBe('2026-09');
    expect(c.out.join('\n')).toMatch(/2026-10 is not published yet/);
    // Next run: October still missing, September installed → nothing to do.
    const again = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: again.io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(again.out.join('\n')).toMatch(/2026-09 is already installed/);
  });

  it('fails when neither month is published, or on a server error (no fallback on 5xx)', async () => {
    const target = freshTarget();
    const c = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: fakeFetch({}).fetch, now: NOW })).toBe(1);
    expect(c.err.join('\n')).toMatch(/no edition published among 2026-10, 2026-09/);
    const f = fakeFetch({ [URL_OCT]: () => new Response('boom', { status: 503 }), [URL_SEP]: gz1() });
    const c2 = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c2.io, fetch: f.fetch, now: NOW })).toBe(1);
    expect(c2.err.join('\n')).toMatch(/HTTP 503/);
    expect(existsSync(target)).toBe(false);
  });

  it('rejects corrupt or truncated archives and invalid databases, keeping the installed file untouched', async () => {
    const target = freshTarget();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: io().io, fetch: fakeFetch({ [URL_OCT]: gz1() }).fetch, now: NOW })).toBe(0);
    const installed = readFileSync(target);
    const good = gz2();
    const flipped = Buffer.from(good);
    flipped[Math.floor(flipped.length / 2)] ^= 0xff; // CRC mismatch
    const cases: [string, Buffer, RegExp][] = [
      ['truncated gzip', good.subarray(0, good.length - 20), /corrupt or truncated gzip|truncated/],
      ['bit flip', flipped, /corrupt or truncated gzip|invalid|check/i],
      ['not gzip', Buffer.from('<html>maintenance</html>'), /corrupt or truncated gzip/],
      ['gzip of junk', gzipSync(Buffer.alloc(4096, 0x42)), /not a readable MaxMind DB/],
      ['probe mismatch', gzipSync(buildMmdb({ networks: { '81.2.69.0/24': { country: { iso_code: 'IT' } } } })), /expected country GB, database says IT/],
    ];
    for (const [name, body, re] of cases) {
      const c = io();
      const code = await runGeoipUpdate(['--path', target, '--force', ...PROBE], { io: c.io, fetch: fakeFetch({ [URL_OCT]: body }).fetch, now: NOW });
      expect(code, name).toBe(1);
      expect(c.err.join('\n'), name).toMatch(re);
      expect(readFileSync(target).equals(installed), name).toBe(true);
      expect(readdirSync(join(target, '..')).sort(), name).toEqual(['dbip-city-lite.mmdb', 'dbip-city-lite.mmdb.json']);
    }
  });

  it('detects a body shorter than its Content-Length', async () => {
    const target = freshTarget();
    const body = gz1();
    const f = fakeFetch({
      [URL_OCT]: () => new Response(new Uint8Array(body), { status: 200, headers: { 'content-length': String(body.length + 100) } }),
    });
    const c = io();
    // Either undici refuses the mismatch or the script does; both must fail.
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: f.fetch, now: NOW })).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  it('keeps the replaced file as .previous, and --rollback swaps them back atomically', async () => {
    const target = freshTarget();
    expect(await runGeoipUpdate(['--path', target, '--month', '2026-09', ...PROBE_ANY], { io: io().io, fetch: fakeFetch({ [URL_SEP]: gz1() }).fetch, now: NOW })).toBe(0);
    expect(await runGeoipUpdate(['--path', target, ...PROBE_ANY], { io: io().io, fetch: fakeFetch({ [URL_OCT]: gz2() }).fetch, now: NOW })).toBe(0);
    expect(readFileSync(target).equals(buildMmdb(FIXTURE_V2))).toBe(true);
    expect(readFileSync(`${target}.previous`).equals(buildMmdb(FIXTURE))).toBe(true);
    expect(JSON.parse(readFileSync(`${target}.previous.json`, 'utf8')).edition).toBe('2026-09');

    const c = io();
    expect(await runGeoipUpdate(['--path', target, '--rollback'], { io: c.io, now: NOW })).toBe(0);
    expect(readFileSync(target).equals(buildMmdb(FIXTURE))).toBe(true);
    expect(readFileSync(`${target}.previous`).equals(buildMmdb(FIXTURE_V2))).toBe(true);
    expect(JSON.parse(readFileSync(`${target}.json`, 'utf8')).edition).toBe('2026-09');
    expect(JSON.parse(readFileSync(`${target}.previous.json`, 'utf8')).edition).toBe('2026-10');
    expect(c.out.join('\n')).toMatch(/rolled back/);

    const none = freshTarget();
    const c2 = io();
    expect(await runGeoipUpdate(['--path', none, '--rollback'], { io: c2.io, now: NOW })).toBe(1);
    expect(c2.err.join('\n')).toMatch(/nothing to roll back to/);
  });

  it('--dry-run uses HEAD only and writes nothing', async () => {
    const target = freshTarget();
    const f = fakeFetch({ [URL_SEP]: gz1() });
    const c = io();
    expect(await runGeoipUpdate(['--path', target, '--dry-run'], { io: c.io, fetch: f.fetch, now: NOW })).toBe(0);
    expect(f.calls.every((x) => x.method === 'HEAD')).toBe(true);
    expect(c.out.join('\n')).toMatch(/would download .*2026-09\.mmdb\.gz/);
    expect(existsSync(join(target, '..'))).toBe(false);
  });

  it('--check validates a file without network access; --json output is parseable', async () => {
    const file = join(dir, 'check.mmdb');
    writeFileSync(file, buildMmdb(FIXTURE));
    const c = io();
    expect(await runGeoipUpdate(['--check', file, '--json', ...PROBE], { io: c.io, now: NOW })).toBe(0);
    const report = JSON.parse(c.out[0]) as { action: string; probes: { country: string; lat: number }[] };
    expect(report.action).toBe('checked');
    expect(report.probes[0]).toMatchObject({ country: 'GB', lat: 51.5 });
    const bad = io();
    expect(await runGeoipUpdate(['--check', file, '--probe', '81.2.69.160=FR'], { io: bad.io, now: NOW })).toBe(1);
  });

  it('refuses a concurrent run (lock) and reports usage errors with exit code 2', async () => {
    const target = freshTarget();
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(`${target}.lock`, '1 now\n');
    const c = io();
    expect(await runGeoipUpdate(['--path', target, ...PROBE], { io: c.io, fetch: fakeFetch({ [URL_OCT]: gz1() }).fetch, now: NOW })).toBe(1);
    expect(c.err.join('\n')).toMatch(/another geoip-update holds/);
    expect(existsSync(target)).toBe(false);

    for (const argv of [['--bogus'], ['--month', '2026-1'], ['--probe', 'nope'], ['--check', 'x', '--rollback'], ['--base-url', 'ftp://x']]) {
      const u = io();
      expect(await runGeoipUpdate(argv, { io: u.io, env: {}, now: NOW }), argv.join(' ')).toBe(2);
      expect(u.err.join('\n')).toMatch(/Usage: tsx scripts\/geoip-update\.ts/);
    }
    const h = io();
    expect(await runGeoipUpdate(['--help'], { io: h.io })).toBe(0);
    expect(h.out.join('\n')).toMatch(/IP Geolocation\s+by DB-IP/);
  });

  it('takes the target from GEO_MMDB_PATH and refuses a relative one', async () => {
    const target = freshTarget();
    const f = fakeFetch({ [URL_OCT]: gz1() });
    expect(await runGeoipUpdate([...PROBE], { io: io().io, env: { GEO_MMDB_PATH: target }, fetch: f.fetch, now: NOW })).toBe(0);
    expect(existsSync(target)).toBe(true);
    const c = io();
    expect(await runGeoipUpdate([...PROBE], { io: c.io, env: { GEO_MMDB_PATH: 'relative.mmdb' }, fetch: f.fetch, now: NOW })).toBe(2);
  });
});
