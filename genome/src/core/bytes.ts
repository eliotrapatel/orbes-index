/**
 * Byte utilities shared by every ORBES module.
 *
 * Isomorphic (browser, Web Worker, Node): plain Uint8Array, no Buffer, no
 * top-level host globals. Parsers are strict because their input arrives from
 * untrusted channels (URLs, API bodies, configuration): they reject anything
 * that is not exactly well-formed instead of guessing what was meant.
 */

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ── Hex ────────────────────────────────────────────────────────────────────

const BYTE_TO_HEX: readonly string[] = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

/** Lowercase hex, two digits per byte. */
export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += BYTE_TO_HEX[b[i]];
  return s;
}

/** Value of one hex digit (either case), or −1. */
function hexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30; // 0-9
  const lower = code | 0x20; // ASCII case fold: only A-F / a-f land in a-f
  if (lower >= 0x61 && lower <= 0x66) return lower - 0x61 + 10;
  return -1;
}

/**
 * Parse hex digits (upper or lower case). No prefix, separators or whitespace
 * are accepted. Throws SyntaxError on odd length or any other character.
 */
export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new SyntaxError(`hex string has odd length ${s.length}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexDigit(s.charCodeAt(2 * i));
    const lo = hexDigit(s.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) throw new SyntaxError(`invalid hex character near offset ${2 * i}`);
    out[i] = (hi << 4) | lo;
  }
  return out;
}

// ── Base64url (RFC 4648 §5, unpadded) ──────────────────────────────────────

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** ASCII code → sextet value, −1 for characters outside the alphabet. */
const B64URL_VALUES: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i++) table[B64URL_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Base64url without padding. */
export function toBase64Url(b: Uint8Array): string {
  const A = B64URL_ALPHABET;
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    s += A[v >>> 18] + A[(v >>> 12) & 63] + A[(v >>> 6) & 63] + A[v & 63];
  }
  const rest = b.length - i;
  if (rest === 1) {
    const v = b[i] << 16;
    s += A[v >>> 18] + A[(v >>> 12) & 63];
  } else if (rest === 2) {
    const v = (b[i] << 16) | (b[i + 1] << 8);
    s += A[v >>> 18] + A[(v >>> 12) & 63] + A[(v >>> 6) & 63];
  }
  return s;
}

/**
 * Parse unpadded base64url. Rejects padding, the standard-alphabet characters
 * '+' and '/', whitespace, impossible lengths (4n + 1) and non-zero unused
 * trailing bits. The last rule makes the encoding canonical: every byte string
 * has exactly one accepted spelling, so encoded tokens can be compared or used
 * as keys without normalisation. Throws SyntaxError.
 */
export function fromBase64Url(s: string): Uint8Array {
  const tail = s.length % 4;
  if (tail === 1) throw new SyntaxError(`invalid base64url length ${s.length}`);
  const out = new Uint8Array(((s.length - tail) / 4) * 3 + (tail === 0 ? 0 : tail - 1));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? B64URL_VALUES[code] : -1;
    if (v < 0) throw new SyntaxError(`invalid base64url character at offset ${i}`);
    // At most 6 bits are pending before a new sextet, so 12 bits of history suffice.
    acc = ((acc << 6) | v) & 0xfff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = acc >>> bits;
    }
  }
  if ((acc & ((1 << bits) - 1)) !== 0) throw new SyntaxError('non-canonical base64url: unused trailing bits are not zero');
  return out;
}

// ── Text ───────────────────────────────────────────────────────────────────

// Created lazily so that importing this module never touches a host global.
let encoder: TextEncoder | undefined;

/** UTF-8 encoding (lone surrogates become U+FFFD, as with TextEncoder). */
export function utf8(s: string): Uint8Array {
  encoder ??= new TextEncoder();
  return encoder.encode(s);
}

// ── Comparison ─────────────────────────────────────────────────────────────

/**
 * True when both arrays have the same length and content. The loop has no
 * early exit so the running time does not depend on where the first mismatch
 * is (best effort: JavaScript engines give no hard constant-time guarantee).
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Big-endian integers ────────────────────────────────────────────────────
//
// Typed arrays silently read `undefined` (→ NaN/0) and drop writes outside
// their bounds, which would turn a framing bug into corrupted data. These
// helpers throw RangeError instead.

function checkAccess(b: Uint8Array, o: number, size: number): void {
  if (!Number.isInteger(o) || o < 0 || o + size > b.length) {
    throw new RangeError(`${size}-byte access at offset ${o} is out of bounds (length ${b.length})`);
  }
}

function checkValue(v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`value ${v} is not an integer in 0..${max}`);
}

export function readU16BE(b: Uint8Array, o: number): number {
  checkAccess(b, o, 2);
  return (b[o] << 8) | b[o + 1];
}

/** Unsigned: 0..0xFFFFFFFF. */
export function readU32BE(b: Uint8Array, o: number): number {
  checkAccess(b, o, 4);
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function writeU16BE(b: Uint8Array, o: number, v: number): void {
  checkAccess(b, o, 2);
  checkValue(v, 0xffff);
  b[o] = v >>> 8;
  b[o + 1] = v & 0xff;
}

export function writeU32BE(b: Uint8Array, o: number, v: number): void {
  checkAccess(b, o, 4);
  checkValue(v, 0xffffffff);
  b[o] = v >>> 24;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}
