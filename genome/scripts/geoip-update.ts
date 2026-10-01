/**
 * Download and install the free DB-IP "IP to City Lite" GeoIP database used by
 * GEO_MODE=mmdb (src/server/geo/mmdb.ts).
 *
 *   tsx scripts/geoip-update.ts                       install / refresh $GEO_MMDB_PATH
 *   tsx scripts/geoip-update.ts --dry-run             say what would be downloaded; write nothing
 *   tsx scripts/geoip-update.ts --check <file.mmdb>   validate a file (no network)
 *   tsx scripts/geoip-update.ts --rollback            put the previous file back
 *
 * Data: DB-IP.com "IP to City Lite", licence CC BY 4.0. Attribution required
 * wherever the data is shown or redistributed: "IP Geolocation by DB-IP"
 * (https://db-ip.com). See NOTICE.md at the repository root.
 *
 * Source: https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz, one
 * edition per month. The current UTC month is tried first; while it is not
 * published yet (HTTP 404) the previous month is used.
 *
 * Safety:
 *   - the download is size-capped, gunzipped as a stream (CRC and length
 *     verified by gunzip: a truncated or corrupt archive fails), then opened
 *     with the same code the server uses and must resolve known public
 *     addresses (--probe, default 8.8.8.8=US) before it is installed;
 *   - install is atomic (temp file in the same directory, fsync, rename): the
 *     server never sees a half-written file, and picks the new one up within
 *     10 minutes (mtime check) without a restart;
 *   - the file being replaced is kept as <file>.previous (see --rollback);
 *   - idempotent: an edition that is already installed (and intact) is not
 *     downloaded again unless --force; a lock file prevents concurrent runs.
 *
 * Exit codes: 0 success (installed or already up to date), 1 failure,
 * 2 usage error.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, link, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import { geoFromRecord, openMmdb } from '../src/server/geo/mmdb.js';

export const DEFAULT_BASE_URL = 'https://download.db-ip.com/free';
export const DEFAULT_FILE_NAME = 'dbip-city-lite.mmdb';
export const DEFAULT_PROBES = ['8.8.8.8=US'];
/** Compressed download cap (the monthly file is ≈ 60 MB) and decompressed cap (≈ 130 MB). */
export const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const STALE_LOCK_MS = 60 * 60 * 1000;
const ATTRIBUTION = 'IP Geolocation by DB-IP (https://db-ip.com), CC BY 4.0';

export const EXIT = Object.freeze({ OK: 0, FAILURE: 1, USAGE: 2 });

export const GEOIP_USAGE = `Usage: tsx scripts/geoip-update.ts [options]

Download the free DB-IP "IP to City Lite" database (CC BY 4.0, "IP Geolocation
by DB-IP", https://db-ip.com) and install it atomically for GEO_MODE=mmdb.

Options
  --path <file>        Database file to install (default: $GEO_MMDB_PATH,
                       else <genome>/.data/geoip/${DEFAULT_FILE_NAME})
  --month <YYYY-MM>    Edition to fetch (default: current UTC month, then the previous one)
  --force              Download even if that edition is already installed
  --dry-run            Show what would happen; download and write nothing
  --check <file>       Validate an existing .mmdb file (opens, resolves the probes); no network
  --rollback           Restore <file>.previous as the current file (the current one becomes .previous)
  --probe <ip=CC>      Public address that must resolve to country CC (repeatable;
                       default ${DEFAULT_PROBES.join(', ')})
  --base-url <url>     Download location (default ${DEFAULT_BASE_URL})
  --json               Machine-readable summary on stdout
  -h, --help           This text

Exit codes: 0 installed or already up to date, 1 failure, 2 usage error.`;

const OPTIONS = {
  path: { type: 'string' },
  month: { type: 'string' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  check: { type: 'string' },
  rollback: { type: 'boolean' },
  probe: { type: 'string', multiple: true },
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

const consoleIO: CliIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export interface GeoipDeps {
  env?: NodeJS.ProcessEnv;
  io?: CliIO;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Sidecar `<file>.json`: what is installed, for idempotence and audits. */
export interface InstalledState {
  source: string;
  attribution: string;
  edition: string;
  url: string;
  sha256: string;
  bytes: number;
  databaseType?: string;
  buildEpoch?: string;
  installedAt: string;
}

interface Probe {
  ip: string;
  country: string;
}

export interface ValidationReport {
  databaseType?: string;
  buildEpoch?: string;
  nodeCount: number;
  bytes: number;
  sha256: string;
  probes: { ip: string; expected: string; country?: string; lat?: number; lon?: number }[];
}

class UsageError extends Error {}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runGeoipUpdate(argv: string[], deps: GeoipDeps = {}): Promise<number> {
  const io = deps.io ?? consoleIO;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.fetch ?? globalThis.fetch;

  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
    values = parsed.values as typeof values;
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${GEOIP_USAGE}`);
    return EXIT.USAGE;
  }
  if (values.help) {
    io.out(GEOIP_USAGE);
    return EXIT.OK;
  }

  const json = values.json === true;
  const log = (line: string) => (json ? io.err(line) : io.out(line));

  try {
    const probes = parseProbes((values.probe as string[] | undefined) ?? DEFAULT_PROBES);
    const modes = [values.check !== undefined, values.rollback === true, values['dry-run'] === true].filter(Boolean).length;
    if (modes > 1) throw new UsageError('--check, --rollback and --dry-run are mutually exclusive');

    if (typeof values.check === 'string') {
      const report = await validateFile(resolve(values.check), probes);
      printReport(io, log, json, { action: 'checked', path: resolve(values.check), ...report });
      return EXIT.OK;
    }

    const target = targetPath(values.path as string | undefined, env);
    if (values.rollback) {
      await withLock(target, () => rollback(target, log));
      if (json) io.out(JSON.stringify({ action: 'rolled-back', path: target }));
      return EXIT.OK;
    }

    const baseUrl = String(values['base-url'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new UsageError('--base-url must be an http(s) URL');
    const months = editions(values.month as string | undefined, now());

    if (values['dry-run']) {
      await dryRun({ target, months, baseUrl, force: values.force === true, doFetch, log, io, json });
      return EXIT.OK;
    }

    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    const result = await withLock(target, () =>
      update({ target, months, baseUrl, force: values.force === true, probes, doFetch, log, now }),
    );
    if (json) io.out(JSON.stringify(result));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n\n${GEOIP_USAGE}`);
      return EXIT.USAGE;
    }
    io.err(`geoip-update: FAILED: ${(e as Error).message ?? String(e)}`);
    return EXIT.FAILURE;
  }
}

// ── Pieces (exported for tests) ────────────────────────────────────────────

/** Default target: $GEO_MMDB_PATH, else <genome>/.data/geoip/dbip-city-lite.mmdb. */
export function targetPath(option: string | undefined, env: NodeJS.ProcessEnv): string {
  const fromEnv = env.GEO_MMDB_PATH?.trim();
  if (option !== undefined) return resolve(option);
  if (fromEnv) {
    if (!isAbsolute(fromEnv)) throw new UsageError('GEO_MMDB_PATH must be an absolute path');
    return fromEnv;
  }
  const genomeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  return join(genomeRoot, '.data', 'geoip', DEFAULT_FILE_NAME);
}

/** Editions to try, newest first: the requested month only, or the current UTC month then the previous one. */
export function editions(month: string | undefined, now: Date): string[] {
  if (month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UsageError('--month must be YYYY-MM');
    return [month];
  }
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  return [fmt(y, m), m === 0 ? fmt(y - 1, 11) : fmt(y, m - 1)];
}

export function editionUrl(baseUrl: string, edition: string): string {
  return `${baseUrl}/dbip-city-lite-${edition}.mmdb.gz`;
}

function parseProbes(list: string[]): Probe[] {
  return list.map((p) => {
    const m = /^([0-9A-Fa-f:.]+)=([A-Za-z]{2})$/.exec(p.trim());
    if (!m) throw new UsageError(`--probe must look like 8.8.8.8=US (got an invalid value)`);
    return { ip: m[1], country: m[2].toUpperCase() };
  });
}

/** Open a database image like the server does and resolve every probe. Throws on any problem. */
export function validateBytes(bytes: Buffer, probes: Probe[]): ValidationReport {
  const reader = openMmdb(bytes);
  const m = reader.metadata;
  const report: ValidationReport = {
    ...(typeof m.databaseType === 'string' ? { databaseType: m.databaseType } : {}),
    ...(m.buildEpoch instanceof Date && Number.isFinite(m.buildEpoch.getTime()) ? { buildEpoch: m.buildEpoch.toISOString() } : {}),
    nodeCount: m.nodeCount,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    probes: [],
  };
  for (const p of probes) {
    const geo = geoFromRecord(reader.get(p.ip));
    report.probes.push({ ip: p.ip, expected: p.country, ...geo });
    if (geo.country !== p.country) {
      throw new Error(`probe ${p.ip}: expected country ${p.country}, database says ${geo.country ?? 'nothing'}`);
    }
  }
  return report;
}

async function validateFile(path: string, probes: Probe[]): Promise<ValidationReport> {
  return validateBytes(await readFile(path), probes);
}

async function readState(target: string): Promise<InstalledState | undefined> {
  try {
    return JSON.parse(await readFile(`${target}.json`, 'utf8')) as InstalledState;
  } catch {
    return undefined;
  }
}

async function sha256File(path: string): Promise<string | undefined> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return undefined;
  }
}

/** True when `edition` is installed and the file still matches what was installed. */
async function isInstalled(target: string, edition: string): Promise<boolean> {
  const state = await readState(target);
  if (!state || state.edition !== edition) return false;
  return (await sha256File(target)) === state.sha256;
}

interface UpdateArgs {
  target: string;
  months: string[];
  baseUrl: string;
  force: boolean;
  probes: Probe[];
  doFetch: typeof fetch;
  log: (line: string) => void;
  now: () => Date;
}

export interface UpdateResult {
  action: 'installed' | 'up-to-date';
  path: string;
  edition: string;
  url?: string;
  sha256?: string;
  bytes?: number;
  previous?: string;
}

async function update(a: UpdateArgs): Promise<UpdateResult> {
  a.log(`geoip-update: target ${a.target}`);
  for (const edition of a.months) {
    if (!a.force && (await isInstalled(a.target, edition))) {
      a.log(`geoip-update: edition ${edition} is already installed and intact; nothing to do (use --force to re-download)`);
      return { action: 'up-to-date', path: a.target, edition };
    }
    const url = editionUrl(a.baseUrl, edition);
    a.log(`geoip-update: downloading ${url}`);
    const tmp = join(dirname(a.target), `.${basename(a.target)}.download-${process.pid}-${Date.now()}`);
    let downloaded: { compressed: number; bytes: number } | 'not-published';
    try {
      downloaded = await download(url, tmp, a.doFetch);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    if (downloaded === 'not-published') {
      a.log(`geoip-update: edition ${edition} is not published yet (HTTP 404)`);
      continue;
    }
    try {
      a.log(`geoip-update: downloaded ${mib(downloaded.compressed)} compressed, ${mib(downloaded.bytes)} uncompressed; gzip integrity OK`);
      const report = validateBytes(await readFile(tmp), a.probes);
      for (const p of report.probes) {
        const point = p.lat !== undefined ? ` (${p.lat}, ${p.lon})` : ' (no coordinates)';
        a.log(`geoip-update: probe ${p.ip} → ${p.country}${point} OK`);
      }
      if (!report.probes.some((p) => p.lat !== undefined)) {
        a.log('geoip-update: WARNING: no probe has coordinates; impossible-travel scoring will use country centroids only');
      }
      a.log(`geoip-update: validated ${report.databaseType ?? 'database'} built ${report.buildEpoch ?? 'unknown'} (${report.nodeCount} nodes)`);
      const previous = await install(tmp, a.target);
      const state: InstalledState = {
        source: 'DB-IP.com IP to City Lite',
        attribution: ATTRIBUTION,
        edition,
        url,
        sha256: report.sha256,
        bytes: report.bytes,
        ...(report.databaseType ? { databaseType: report.databaseType } : {}),
        ...(report.buildEpoch ? { buildEpoch: report.buildEpoch } : {}),
        installedAt: a.now().toISOString(),
      };
      await writeAtomic(`${a.target}.json`, `${JSON.stringify(state, null, 2)}\n`);
      a.log(`geoip-update: installed edition ${edition} at ${a.target}${previous ? ` (previous kept as ${previous})` : ''}`);
      a.log('geoip-update: the server reloads it within 10 minutes; no restart needed');
      return { action: 'installed', path: a.target, edition, url, sha256: report.sha256, bytes: report.bytes, ...(previous ? { previous } : {}) };
    } finally {
      await rm(tmp, { force: true });
    }
  }
  throw new Error(`no edition published among ${a.months.join(', ')}`);
}

/** Stream url → gunzip → file, with size caps. 'not-published' on HTTP 404. */
async function download(url: string, dest: string, doFetch: typeof fetch): Promise<{ compressed: number; bytes: number } | 'not-published'> {
  const res = await doFetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { 'user-agent': 'orbes-geoip-update/1 (+https://theorbes.com)' },
  });
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return 'not-published';
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_COMPRESSED_BYTES) {
    await res.body.cancel().catch(() => {});
    throw new Error(`download refused: ${mib(declared)} exceeds the ${mib(MAX_COMPRESSED_BYTES)} cap`);
  }
  let compressed = 0;
  let bytes = 0;
  const countIn = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      compressed += chunk.length;
      cb(compressed > MAX_COMPRESSED_BYTES ? new Error('download exceeds the compressed size cap') : null, chunk);
    },
  });
  const countOut = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      cb(bytes > MAX_DECOMPRESSED_BYTES ? new Error('archive exceeds the decompressed size cap') : null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>),
      countIn,
      createGunzip(),
      countOut,
      createWriteStream(dest, { flags: 'wx', mode: 0o644 }),
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    const why = code?.startsWith('Z_') || /unexpected end|incorrect header|invalid/i.test((e as Error).message)
      ? 'corrupt or truncated gzip archive'
      : (e as Error).message;
    throw new Error(`download failed: ${why}`);
  }
  if (Number.isFinite(declared) && declared !== compressed) {
    throw new Error(`download truncated: got ${compressed} of ${declared} bytes`);
  }
  if (bytes === 0) throw new Error('download failed: empty archive');
  await fsyncPath(dest);
  return { compressed, bytes };
}

/**
 * Atomically make `tmp` the current file; the replaced file becomes
 * `<target>.previous` (itself replaced atomically). Returns the .previous path
 * when there was a file to keep.
 */
async function install(tmp: string, target: string): Promise<string | undefined> {
  const previous = `${target}.previous`;
  let kept: string | undefined;
  if (existsSync(target)) {
    const prevTmp = `${previous}.tmp-${process.pid}`;
    await rm(prevTmp, { force: true });
    try {
      await link(target, prevTmp);
    } catch {
      await copyFile(target, prevTmp);
    }
    await rename(prevTmp, previous);
    const state = await readState(target);
    if (state) await writeAtomic(`${previous}.json`, `${JSON.stringify(state, null, 2)}\n`);
    kept = previous;
  }
  await rename(tmp, target);
  await fsyncPath(dirname(target));
  return kept;
}

async function rollback(target: string, log: (line: string) => void): Promise<void> {
  const previous = `${target}.previous`;
  if (!existsSync(previous)) throw new Error(`nothing to roll back to: ${previous} does not exist`);
  // Never install a previous file that does not open.
  openMmdb(await readFile(previous));
  // The current file is linked aside first, so `target` is replaced atomically (never missing).
  const swap = `${target}.rollback-${process.pid}`;
  const hasCurrent = existsSync(target);
  if (hasCurrent) {
    await rm(swap, { force: true });
    try {
      await link(target, swap);
    } catch {
      await copyFile(target, swap);
    }
  }
  await rename(previous, target);
  if (hasCurrent) await rename(swap, previous);
  const curState = await readFile(`${target}.json`, 'utf8').catch(() => undefined);
  const prevState = await readFile(`${previous}.json`, 'utf8').catch(() => undefined);
  if (prevState !== undefined) await writeAtomic(`${target}.json`, prevState);
  else await rm(`${target}.json`, { force: true });
  if (curState !== undefined && hasCurrent) await writeAtomic(`${previous}.json`, curState);
  await fsyncPath(dirname(target));
  log(`geoip-update: rolled back: ${target} is the previous file again${hasCurrent ? `; the replaced one is ${previous}` : ''}`);
}

async function dryRun(a: {
  target: string;
  months: string[];
  baseUrl: string;
  force: boolean;
  doFetch: typeof fetch;
  log: (line: string) => void;
  io: CliIO;
  json: boolean;
}): Promise<void> {
  a.log(`geoip-update: DRY RUN (nothing is downloaded or written); target ${a.target}`);
  for (const edition of a.months) {
    if (!a.force && (await isInstalled(a.target, edition))) {
      a.log(`geoip-update: edition ${edition} is already installed; a real run would do nothing`);
      if (a.json) a.io.out(JSON.stringify({ action: 'dry-run', wouldDo: 'nothing', edition, path: a.target }));
      return;
    }
    const url = editionUrl(a.baseUrl, edition);
    const res = await a.doFetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) {
      a.log(`geoip-update: edition ${edition} is not published yet (HTTP 404)`);
      continue;
    }
    if (!res.ok) throw new Error(`HEAD ${url}: HTTP ${res.status}`);
    const size = Number(res.headers.get('content-length') ?? NaN);
    a.log(`geoip-update: would download ${url}${Number.isFinite(size) ? ` (${mib(size)})` : ''}, validate it and install it at ${a.target}`);
    if (existsSync(a.target)) a.log(`geoip-update: would keep the current file as ${a.target}.previous`);
    if (a.json) a.io.out(JSON.stringify({ action: 'dry-run', wouldDo: 'install', edition, url, path: a.target }));
    return;
  }
  throw new Error(`no edition published among ${a.months.join(', ')}`);
}

/** Run `fn` holding `<target>.lock` (O_EXCL). A lock older than an hour is considered stale. */
async function withLock<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${target}.lock`;
  await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  for (let attempt = 0; ; attempt++) {
    try {
      const h = await open(lock, 'wx', 0o644);
      await h.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await h.close();
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST' || attempt > 0) {
        throw new Error(`another geoip-update holds ${lock} (remove it if no update is running)`);
      }
      const st = await stat(lock).catch(() => undefined);
      if (st && Date.now() - st.mtimeMs < STALE_LOCK_MS) {
        throw new Error(`another geoip-update holds ${lock} (remove it if no update is running)`);
      }
      await rm(lock, { force: true }); // stale
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, content, { mode: 0o644 });
  await fsyncPath(tmp);
  await rename(tmp, path);
}

async function fsyncPath(path: string): Promise<void> {
  let h;
  try {
    h = await open(path, 'r');
    await h.sync();
  } catch {
    // Directories cannot be fsynced on every platform; the rename is still atomic.
  } finally {
    await h?.close();
  }
}

function printReport(io: CliIO, log: (line: string) => void, json: boolean, r: ValidationReport & { action: string; path: string }): void {
  if (json) {
    io.out(JSON.stringify(r));
    return;
  }
  log(`geoip-update: ${r.path}: OK, ${r.databaseType ?? 'database'} built ${r.buildEpoch ?? 'unknown'}, ${mib(r.bytes)}, ${r.nodeCount} nodes, sha256 ${r.sha256}`);
  for (const p of r.probes) {
    log(`geoip-update: probe ${p.ip} → ${p.country}${p.lat !== undefined ? ` (${p.lat}, ${p.lon})` : ' (no coordinates)'} OK`);
  }
}

function mib(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

function isMainModule(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule(import.meta.url)) {
  runGeoipUpdate(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
