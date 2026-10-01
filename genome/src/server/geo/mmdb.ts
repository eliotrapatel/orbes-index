/**
 * Local GeoIP lookups (GEO_MODE=mmdb): client IP → { country, lat, lon } from
 * a MaxMind-format database file (DB-IP "IP to City Lite" by default, CC BY
 * 4.0; GeoLite2-City has the same layout), so anomaly scoring (impossible
 * travel, geographic dispersion) works without an edge such as Cloudflare.
 *
 * Privacy (same rules as the header modes, contract §2.12):
 *   - the IP is used in memory for the lookup only: never logged, never
 *     stored, never part of an error message (only the peppered HMAC computed
 *     by the HTTP layer is ever persisted);
 *   - coordinates are rounded to 1 decimal (≈ 10 km) before they leave here;
 *   - private, loopback, link-local, documentation, CGNAT, multicast and other
 *     special-purpose addresses are never looked up.
 *
 * Availability: geolocation only feeds anomaly scoring, so it must never
 * break or slow down verification. A missing, unreadable or corrupt file
 * degrades to "no geo" with ONE warning per distinct problem (no log flood);
 * a lookup never throws. The file is re-checked (stat: mtime, size, inode) at
 * most every 10 minutes, lazily on lookups, and reloaded in the background
 * when it changed; a replacement that fails to open keeps the database
 * already in memory. scripts/geoip-update.ts installs new files atomically
 * (rename), so a half-written file is never seen here.
 *
 * Cost: the whole file is held in memory (≈ 130 MB for DB-IP City Lite, twice
 * that for a moment during a reload); a lookup is a binary-tree walk plus one
 * record decode, a few microseconds.
 */
import { readFileSync, statSync, type Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import { Reader, type Response } from 'mmdb-lib';
import { systemClock, type Clock, type Logger } from '../types.js';
import { normalizeCountry, roundCoord, type GeoInfo } from './resolver.js';

/** How often (at most) the file is stat()ed for changes. */
export const MMDB_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export interface MmdbGeoOptions {
  /** Absolute path of the .mmdb file (GEO_MMDB_PATH). */
  path: string;
  /** Where warnings go. Default: one JSON line on stderr per message (pino-like). */
  log?: Logger;
  clock?: Clock;
  /** Minimum time between two change checks. Default MMDB_CHECK_INTERVAL_MS. */
  checkIntervalMs?: number;
}

/** What is known about the loaded database (safe to log or expose to operators). */
export interface MmdbStatus {
  path: string;
  loaded: boolean;
  databaseType?: string;
  buildEpoch?: string;
  ipVersion?: number;
  nodeCount?: number;
  bytes?: number;
}

/** Shape of the record fields read here (MaxMind City / DB-IP City layout). */
interface RecordShape {
  country?: { iso_code?: unknown };
  registered_country?: { iso_code?: unknown };
  location?: { latitude?: unknown; longitude?: unknown };
}

interface Loaded {
  reader: Reader<Response>;
  mtimeMs: number;
  size: number;
  ino: number;
  status: MmdbStatus;
}

/**
 * Special-purpose ranges (IANA IPv4/IPv6 special-purpose registries) that
 * never carry a meaningful location. For IPv6 everything outside global
 * unicast 2000::/3 is excluded, plus the special blocks inside it.
 */
const NON_GLOBAL = (() => {
  const b = new BlockList();
  for (const [net, bits] of [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.88.99.0', 24], // 6to4 relay anycast
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved + limited broadcast
  ] as const) {
    b.addSubnet(net, bits, 'ipv4');
  }
  for (const [net, bits] of [
    ['::', 3], // unspecified, loopback, IPv4-mapped/compatible, NAT64, discard-only…
    ['4000::', 2], // not global unicast
    ['8000::', 1], // ULA fc00::/7, link-local fe80::/10, multicast ff00::/8, …
    ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID…)
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4
    ['3ffe::', 16], // former 6bone
    ['3fff::', 20], // documentation (RFC 9637)
  ] as const) {
    b.addSubnet(net, bits, 'ipv6');
  }
  return b;
})();

/**
 * The address to look up, or undefined when it is not a global unicast
 * address. IPv4-mapped IPv6 (`::ffff:a.b.c.d`, what a dual-stack socket
 * reports for IPv4 clients) is unmapped first.
 */
export function publicAddress(ip: unknown): { address: string; family: 4 | 6 } | undefined {
  if (typeof ip !== 'string' || ip.length === 0 || ip.length > 64) return undefined;
  let a = ip;
  const lower = a.toLowerCase();
  if (lower.startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7);
  const family = isIP(a);
  if (family === 4) return NON_GLOBAL.check(a, 'ipv4') ? undefined : { address: a, family: 4 };
  if (family === 6) {
    // A zone index (fe80::1%eth0) only exists on link-local addresses, which are excluded anyway.
    if (a.includes('%')) return undefined;
    return NON_GLOBAL.check(a, 'ipv6') ? undefined : { address: a, family: 6 };
  }
  return undefined;
}

/** Country and rounded point of one database record; {} when nothing usable. */
export function geoFromRecord(record: unknown): GeoInfo {
  if (!record || typeof record !== 'object') return {};
  const r = record as RecordShape;
  const out: GeoInfo = {};
  const iso = r.country?.iso_code ?? r.registered_country?.iso_code;
  const country = typeof iso === 'string' ? normalizeCountry(iso) : undefined;
  if (country) out.country = country;
  const lat = r.location?.latitude;
  const lon = r.location?.longitude;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  ) {
    out.lat = roundCoord(lat);
    out.lon = roundCoord(lon);
  }
  return out;
}

/**
 * Parse and sanity-check a database image. Throws a short, IP-free message
 * when the bytes are not a usable MaxMind DB.
 */
export function openMmdb(bytes: Buffer): Reader<Response> {
  if (bytes.length < 64) throw new Error('file too small to be a MaxMind DB');
  let reader: Reader<Response>;
  try {
    reader = new Reader<Response>(bytes);
  } catch (e) {
    throw new Error(`not a readable MaxMind DB (${shortReason(e)})`);
  }
  const m = reader.metadata;
  if (m.binaryFormatMajorVersion !== 2) throw new Error('unsupported MaxMind DB format version');
  if (m.ipVersion !== 4 && m.ipVersion !== 6) throw new Error('invalid MaxMind DB metadata (ip_version)');
  if (!Number.isInteger(m.nodeCount) || m.nodeCount <= 0) throw new Error('invalid MaxMind DB metadata (node_count)');
  if (m.searchTreeSize + 16 > bytes.length) throw new Error('truncated MaxMind DB (search tree exceeds file)');
  // Walk the tree once on both families: a damaged tree or data section throws here, not on a request.
  try {
    reader.get('8.8.8.8');
    if (m.ipVersion === 6) reader.get('2001:4860:4860::8888');
  } catch (e) {
    throw new Error(`damaged MaxMind DB (${shortReason(e)})`);
  }
  return reader;
}

function statusOf(path: string, reader: Reader<Response>, bytes: number): MmdbStatus {
  const m = reader.metadata;
  const epoch = m.buildEpoch instanceof Date && Number.isFinite(m.buildEpoch.getTime()) ? m.buildEpoch.toISOString() : undefined;
  return {
    path,
    loaded: true,
    ...(typeof m.databaseType === 'string' ? { databaseType: m.databaseType.slice(0, 64) } : {}),
    ...(epoch ? { buildEpoch: epoch } : {}),
    ipVersion: m.ipVersion,
    nodeCount: m.nodeCount,
    bytes,
  };
}

/** Error text without anything that could echo input data; bounded. */
function shortReason(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, ' ').slice(0, 120);
}

function signatureOf(st: Stats): string {
  return `${st.mtimeMs}:${st.size}:${st.ino}`;
}

const stderrLogger: Logger = {
  info: (o, m) => writeLine(30, o, m),
  warn: (o, m) => writeLine(40, o, m),
  error: (o, m) => writeLine(50, o, m),
};

function writeLine(level: number, o: object | string, m?: string): void {
  const base = typeof o === 'string' ? { msg: o } : { ...o, ...(m !== undefined ? { msg: m } : {}) };
  try {
    process.stderr.write(`${JSON.stringify({ level, time: Date.now(), ...base })}\n`);
  } catch {
    // Logging must never take the lookup path down.
  }
}

export class MmdbGeoDatabase {
  readonly path: string;
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly interval: number;
  private loaded: Loaded | undefined;
  private lastCheckAt: number;
  private checking: Promise<void> | undefined;
  /** Last problem reported, so each distinct problem is logged once (until it is resolved). */
  private lastProblem: string | undefined;
  private lookupFailureReported = false;
  /** stat signature of a file that failed to open: not re-read until it changes. */
  private rejected: string | undefined;

  constructor(options: MmdbGeoOptions) {
    this.path = options.path;
    this.log = options.log ?? stderrLogger;
    this.clock = options.clock ?? systemClock;
    this.interval = Math.max(0, options.checkIntervalMs ?? MMDB_CHECK_INTERVAL_MS);
    this.lastCheckAt = this.clock().getTime();
    // Synchronous first load (startup): the first request already has geo.
    let st: Stats;
    let bytes: Buffer;
    try {
      st = statSync(this.path);
      if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' });
      bytes = readFileSync(this.path);
    } catch (e) {
      this.problem(e);
      return;
    }
    try {
      this.install(bytes, st, 'loaded');
    } catch (e) {
      this.rejected = signatureOf(st);
      this.problem(e);
    }
  }

  /** Location of a client IP; {} for non-public addresses, unknown ranges, or no database. Never throws. */
  lookup(ip: unknown): GeoInfo {
    this.maybeCheck();
    const current = this.loaded;
    if (!current) return {};
    const target = publicAddress(ip);
    if (!target) return {};
    try {
      return geoFromRecord(current.reader.get(target.address));
    } catch (e) {
      if (!this.lookupFailureReported) {
        this.lookupFailureReported = true;
        this.log.warn({ geoip: { path: this.path, reason: shortReason(e) } }, 'geoip lookup failed; the database may be damaged (no location for affected requests)');
      }
      return {};
    }
  }

  status(): MmdbStatus {
    return this.loaded ? { ...this.loaded.status } : { path: this.path, loaded: false };
  }

  /** Check the file now (ignoring the interval) and reload it if it changed. Never rejects. */
  refresh(): Promise<void> {
    this.lastCheckAt = this.clock().getTime();
    if (!this.checking) this.checking = this.check().finally(() => (this.checking = undefined));
    return this.checking;
  }

  /** Resolves when no background check is running (tests, graceful shutdown). */
  async settled(): Promise<void> {
    while (this.checking) await this.checking;
  }

  private maybeCheck(): void {
    if (this.checking) return;
    if (this.clock().getTime() - this.lastCheckAt < this.interval) return;
    void this.refresh();
  }

  private async check(): Promise<void> {
    try {
      let st: Stats;
      try {
        st = await stat(this.path);
        if (!st.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' });
      } catch (e) {
        this.problem(e);
        return;
      }
      const cur = this.loaded;
      if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size && cur.ino === st.ino) {
        this.lastProblem = undefined;
        return;
      }
      const signature = signatureOf(st);
      if (signature === this.rejected) return;
      let bytes: Buffer;
      try {
        bytes = await readFile(this.path);
      } catch (e) {
        this.problem(e);
        return;
      }
      try {
        this.install(bytes, st, cur ? 'reloaded' : 'loaded');
      } catch (e) {
        this.rejected = signature;
        this.problem(e);
      }
    } catch (e) {
      // Belt and braces: a background check must never become an unhandled rejection.
      this.problem(e);
    }
  }

  private install(bytes: Buffer, st: Stats, verb: 'loaded' | 'reloaded'): void {
    const reader = openMmdb(bytes);
    const status = statusOf(this.path, reader, bytes.length);
    this.loaded = { reader, mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, status };
    this.lastProblem = undefined;
    this.rejected = undefined;
    this.lookupFailureReported = false;
    this.log.info({ geoip: status }, `geoip database ${verb}`);
  }

  private problem(e: unknown): void {
    const reason = shortReason(e);
    const keeping = this.loaded !== undefined;
    const key = `${keeping}:${reason}`;
    if (key === this.lastProblem) return;
    this.lastProblem = key;
    const msg = keeping
      ? 'geoip database file unusable; keeping the copy already in memory'
      : 'geoip database unavailable; scans get no location until it is installed (verification is unaffected)';
    this.log.warn({ geoip: { path: this.path, reason } }, msg);
  }
}
