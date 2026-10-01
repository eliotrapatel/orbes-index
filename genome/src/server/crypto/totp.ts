/**
 * HOTP (RFC 4226) and TOTP (RFC 6238) for admin second-factor login.
 *
 * Defaults are what every authenticator app supports: SHA-1, 30-second
 * steps, 6 digits, T0 = 0. Verification accepts ±1 step of clock drift
 * (contract §2.9) and reports which step matched, so callers can refuse a
 * code that was already used (RFC 6238 §5.2: "the verifier MUST NOT accept
 * the second attempt of the same OTP").
 *
 * Secrets are raw bytes; base32 (RFC 4648, unpadded) is only the transport
 * format for otpauth:// URIs and manual entry. 20 random bytes (160 bits)
 * match the HMAC-SHA-1 block recommendation of RFC 4226 §4.
 *
 * Node-only.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpOptions {
  /** Step length in seconds (default 30). */
  step?: number;
  /** Code length, 6..8 (default 6). */
  digits?: number;
  algorithm?: TotpAlgorithm;
  /** Unix time (seconds) at which counting starts (default 0). */
  t0?: number;
}

export interface TotpVerifyOptions extends TotpOptions {
  /** Steps of drift accepted on each side (default 1, max 10). */
  window?: number;
  /** Only accept counters strictly greater than this one (replay protection). */
  afterCounter?: number;
}

export type TotpVerifyResult = { ok: true; counter: number } | { ok: false };

export const TOTP_DEFAULTS = Object.freeze({ step: 30, digits: 6, algorithm: 'SHA1' as TotpAlgorithm, t0: 0, window: 1 });
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HASH: Record<TotpAlgorithm, string> = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' };
// Counter values stay within 2^53 so they can be plain numbers in results.
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

// ── Base32 (RFC 4648 §6) ───────────────────────────────────────────────────

/** Unpadded uppercase base32. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(acc >>> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

/**
 * Decode base32 the way users type secrets: case-insensitive, spaces, hyphens
 * and trailing '=' padding ignored. Throws SyntaxError on any other character
 * or an impossible length.
 */
export function base32Decode(input: string): Uint8Array {
  if (typeof input !== 'string') throw new SyntaxError('base32 input must be a string');
  const s = input.replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  // Lengths 1, 3 and 6 (mod 8) cannot come from whole bytes.
  if ([1, 3, 6].includes(s.length % 8)) throw new SyntaxError('invalid base32 length');
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const v = BASE32_ALPHABET.indexOf(s[i]);
    if (v < 0) throw new SyntaxError(`invalid base32 character at offset ${i}`);
    acc = ((acc << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}

/** A fresh random TOTP secret, base32-encoded (32 characters for 20 bytes). */
export function generateTotpSecret(bytes = TOTP_SECRET_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) throw new RangeError('TOTP secrets must be 16..64 bytes');
  return base32Encode(randomBytes(bytes));
}

// ── HOTP / TOTP ────────────────────────────────────────────────────────────

function resolve(opts: TotpOptions): { step: number; digits: number; algorithm: TotpAlgorithm; t0: number } {
  const step = opts.step ?? TOTP_DEFAULTS.step;
  const digits = opts.digits ?? TOTP_DEFAULTS.digits;
  const algorithm = opts.algorithm ?? TOTP_DEFAULTS.algorithm;
  const t0 = opts.t0 ?? TOTP_DEFAULTS.t0;
  if (!Number.isInteger(step) || step < 1 || step > 3600) throw new RangeError('TOTP step must be 1..3600 seconds');
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new RangeError('TOTP digits must be 6..8');
  if (!(algorithm in HASH)) throw new RangeError('unsupported TOTP algorithm');
  if (!Number.isFinite(t0)) throw new RangeError('TOTP t0 must be finite');
  return { step, digits, algorithm, t0 };
}

function checkSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length === 0) throw new RangeError('OTP secret must be non-empty bytes');
}

/** RFC 4226 HOTP value for one counter, zero-padded to `digits`. */
export function hotp(secret: Uint8Array, counter: number, opts: { digits?: number; algorithm?: TotpAlgorithm } = {}): string {
  checkSecret(secret);
  const { digits, algorithm } = resolve(opts);
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError('HOTP counter must be a non-negative safe integer');
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(HASH[algorithm], secret).update(msg).digest();
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** The TOTP counter (time step number) at `timeMs`. */
export function totpCounter(timeMs: number, opts: TotpOptions = {}): number {
  const { step, t0 } = resolve(opts);
  if (!Number.isFinite(timeMs)) throw new RangeError('time must be finite');
  const counter = Math.floor((Math.floor(timeMs / 1000) - t0) / step);
  if (counter < 0 || counter > MAX_COUNTER) throw new RangeError('time is outside the TOTP range');
  return counter;
}

/** RFC 6238 TOTP value at `timeMs` (Unix milliseconds). */
export function totp(secret: Uint8Array, timeMs: number, opts: TotpOptions = {}): string {
  return hotp(secret, totpCounter(timeMs, opts), opts);
}

/**
 * Check a submitted code against every step in the drift window. All
 * candidates are computed and compared in constant time without early exit,
 * so timing does not reveal which step (if any) matched.
 */
export function verifyTotp(secret: Uint8Array, code: unknown, timeMs: number, opts: TotpVerifyOptions = {}): TotpVerifyResult {
  const { digits } = resolve(opts);
  const window = opts.window ?? TOTP_DEFAULTS.window;
  if (!Number.isInteger(window) || window < 0 || window > 10) throw new RangeError('TOTP window must be 0..10');
  if (typeof code !== 'string') return { ok: false };
  const submitted = code.replace(/\s+/g, '');
  if (submitted.length !== digits || !/^\d+$/.test(submitted)) return { ok: false };

  const now = totpCounter(timeMs, opts);
  const want = Buffer.from(submitted, 'ascii');
  let matched = -1;
  for (let c = now - window; c <= now + window; c++) {
    if (c < 0) continue;
    const ok = timingSafeEqual(Buffer.from(hotp(secret, c, opts), 'ascii'), want);
    // Prefer the latest matching step, so replay tracking moves forward monotonically.
    if (ok) matched = c;
  }
  if (matched < 0) return { ok: false };
  if (opts.afterCounter !== undefined && matched <= opts.afterCounter) return { ok: false };
  return { ok: true, counter: matched };
}

/**
 * otpauth:// provisioning URI (Key Uri Format, as read by Google
 * Authenticator, 1Password, Authy …). Shown once during enrolment as a QR
 * code; it contains the secret, so it must never be logged.
 */
export function totpUri(input: { secret: string; account: string; issuer?: string } & Pick<TotpOptions, 'digits' | 'step' | 'algorithm'>): string {
  const issuer = input.issuer ?? 'ORBES';
  const { step, digits, algorithm } = resolve(input);
  base32Decode(input.secret); // validate
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret.replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase(),
    issuer,
    algorithm,
    digits: String(digits),
    period: String(step),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
