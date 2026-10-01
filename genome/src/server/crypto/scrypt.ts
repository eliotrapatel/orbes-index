/**
 * scrypt secret hashing shared by passwords (AuthService) and claim codes
 * (issuance / ownership), so both use one audited parameter set and one
 * encoding (PLATFORM-CONTRACTS §2.9):
 *
 *   scrypt$<log2 N>$<r>$<p>$<salt base64url>$<hash base64url>
 *   e.g. scrypt$15$8$1$<16-byte salt>$<32-byte key>
 *
 * The parameters travel with every hash, so they can be raised later without
 * invalidating stored hashes (`needsRehash` tells callers when to upgrade).
 * Verification parses strictly and bounds every parameter: a tampered or
 * corrupted row can neither crash the process nor make it burn unbounded
 * CPU/memory, it simply fails to verify.
 *
 * Node-only (node:crypto runs scrypt on the libuv thread pool).
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { fromBase64Url, toBase64Url } from '../../core/bytes.js';

export interface ScryptParams {
  /** log2 of the CPU/memory cost N. */
  logN: number;
  r: number;
  p: number;
  saltBytes: number;
  keyBytes: number;
}

/** The current parameter set (contract §2.9): N = 2^15, r = 8, p = 1, 16-byte salt, 32-byte key. */
export const SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({ logN: 15, r: 8, p: 1, saltBytes: 16, keyBytes: 32 });

/** Longest secret accepted, in UTF-8 bytes. Bounds hashing work per request. */
export const MAX_SECRET_BYTES = 1024;

const PREFIX = 'scrypt';
// Accepted ranges when VERIFYING stored hashes (hashing always uses SCRYPT_PARAMS).
// Upper bounds keep a forged row from requesting gigabytes of memory.
const BOUNDS = { logN: [10, 20], r: [1, 32], p: [1, 16], salt: [16, 64], key: [16, 64] } as const;
const ENCODED_RE = /^scrypt\$(\d{1,2})\$(\d{1,2})\$(\d{1,2})\$([A-Za-z0-9_-]{16,128})\$([A-Za-z0-9_-]{16,128})$/;

interface ParsedHash {
  params: ScryptParams;
  salt: Uint8Array;
  hash: Uint8Array;
}

function scryptAsync(secret: Buffer, salt: Uint8Array, keyBytes: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret, salt, keyBytes, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function options(params: ScryptParams): ScryptOptions {
  const N = 2 ** params.logN;
  // OpenSSL needs 128·r·(N + 2) + 128·r·p bytes; Node's 32 MiB default is just short of that for N = 2^15, r = 8.
  const maxmem = 128 * params.r * (N + 2) + 128 * params.r * params.p + 1024 * 1024;
  return { N, r: params.r, p: params.p, maxmem };
}

function secretBytes(secret: string): Buffer {
  if (typeof secret !== 'string') throw new TypeError('secret must be a string');
  const bytes = Buffer.from(secret, 'utf8');
  if (bytes.length === 0) throw new RangeError('secret must not be empty');
  if (bytes.length > MAX_SECRET_BYTES) throw new RangeError(`secret must be at most ${MAX_SECRET_BYTES} bytes`);
  return bytes;
}

function inRange(v: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(v) && v >= min && v <= max;
}

/** Strict parse of an encoded hash; undefined when malformed or out of bounds. */
function parseEncoded(encoded: unknown): ParsedHash | undefined {
  if (typeof encoded !== 'string') return undefined;
  const m = ENCODED_RE.exec(encoded);
  if (!m) return undefined;
  const [logN, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Leading zeros would give one hash several spellings.
  if ([m[1], m[2], m[3]].some((s) => s.length > 1 && s.startsWith('0'))) return undefined;
  if (!inRange(logN, BOUNDS.logN) || !inRange(r, BOUNDS.r) || !inRange(p, BOUNDS.p)) return undefined;
  let salt: Uint8Array;
  let hash: Uint8Array;
  try {
    salt = fromBase64Url(m[4]);
    hash = fromBase64Url(m[5]);
  } catch {
    return undefined;
  }
  if (!inRange(salt.length, BOUNDS.salt) || !inRange(hash.length, BOUNDS.key)) return undefined;
  return { params: { logN, r, p, saltBytes: salt.length, keyBytes: hash.length }, salt, hash };
}

/** Hash a secret with a fresh random salt and the current parameters. */
export async function hashSecret(secret: string): Promise<string> {
  const bytes = secretBytes(secret);
  const params = SCRYPT_PARAMS;
  const salt = randomBytes(params.saltBytes);
  try {
    const key = await scryptAsync(bytes, salt, params.keyBytes, options(params));
    const encoded = `${PREFIX}$${params.logN}$${params.r}$${params.p}$${toBase64Url(salt)}$${toBase64Url(key)}`;
    key.fill(0);
    return encoded;
  } finally {
    bytes.fill(0);
  }
}

/**
 * Constant-time check of `secret` against an encoded hash. Returns false (never
 * throws) for a wrong secret, a malformed or out-of-bounds hash, or an
 * unacceptable secret (empty, too long, not a string).
 */
export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const parsed = parseEncoded(encoded);
  if (!parsed) return false;
  let bytes: Buffer;
  try {
    bytes = secretBytes(secret);
  } catch {
    return false;
  }
  try {
    const key = await scryptAsync(bytes, parsed.salt, parsed.params.keyBytes, options(parsed.params));
    const ok = key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
    key.fill(0);
    return ok;
  } catch {
    return false;
  } finally {
    bytes.fill(0);
  }
}

/** True when `encoded` is well-formed. Use to validate stored values without hashing. */
export function isEncodedSecret(encoded: unknown): boolean {
  return parseEncoded(encoded) !== undefined;
}

/** True when a stored hash uses parameters other than the current ones and should be re-hashed after a successful login. */
export function needsRehash(encoded: string): boolean {
  const parsed = parseEncoded(encoded);
  if (!parsed) return true;
  const a = parsed.params;
  const b = SCRYPT_PARAMS;
  return a.logN !== b.logN || a.r !== b.r || a.p !== b.p || a.saltBytes !== b.saltBytes || a.keyBytes !== b.keyBytes;
}
