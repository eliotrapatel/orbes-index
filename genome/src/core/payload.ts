/**
 * ORBES CODE-01 canonical payload, signing message and data framing.
 *
 * Payload v1: 13 bytes, fixed layout, big-endian
 *   byte 0      codeVersion << 4 | genomeVersion
 *   byte 1      keyId
 *   bytes 2..5  packed product identity (u32)
 *   byte 6      issue
 *   bytes 7..8  issuedDay (u16, days since 2024-01-01 UTC)
 *   bytes 9..12 nonce
 *
 * Every field has a fixed width and every reserved value is rejected, so each
 * payload value has exactly one byte encoding and decodePayload ∘ encodePayload
 * is the identity in both directions. The signature can therefore be defined
 * over the bytes without any canonicalisation step.
 *
 * Code data (what Reed-Solomon protects): payload ‖ Ed25519 signature ‖ CRC-16
 * (79 bytes). The CRC catches the rare RS miscorrection before any signature
 * work; it is NOT an integrity mechanism against an attacker (the signature is).
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { concatBytes, readU16BE, readU32BE, utf8, writeU16BE, writeU32BE } from './bytes.js';
import { crc16 } from './ecc/crc16.js';
import { IdentityError, packIdentity, unpackIdentity, type ProductIdentity } from './identity.js';

export const PAYLOAD_V1_LENGTH = 13;
export const SIGNATURE_LENGTH = 64;
/** payload ‖ signature ‖ crc16 */
export const CODE_DATA_V1_LENGTH = 79;
/** Signing message = utf8(domain) ‖ 0x00 ‖ payloadBytes. */
export const SIGNING_DOMAIN_V1 = 'ORBES-CODE/v1';
export const ISSUED_DAY_EPOCH_UTC = Date.UTC(2024, 0, 1);

export interface CodePayloadV1 {
  codeVersion: 1;
  /** 1..15 */
  genomeVersion: number;
  /** 1..255 (0 reserved) */
  keyId: number;
  identity: ProductIdentity;
  /** 1..255 code issue counter for this product (re-issue after revocation/damage) */
  issue: number;
  /** days since 2024-01-01 UTC, 0..65535 */
  issuedDay: number;
  /** 4 bytes, random per issued code */
  nonce: Uint8Array;
}

/**
 * LENGTH, VERSION, RANGE, CRC and RESERVED mean a damaged or invalid frame.
 * UNSUPPORTED_VERSION (code-profiles.ts `unframeAnyCodeData` only) means an
 * intact frame of a code version this build has no profile for: the reader
 * is outdated, the code is not damaged.
 */
export type PayloadErrorCode = 'LENGTH' | 'VERSION' | 'RANGE' | 'CRC' | 'RESERVED' | 'UNSUPPORTED_VERSION';

export class PayloadError extends Error {
  override readonly name = 'PayloadError';
  /** The code version read from the frame (UNSUPPORTED_VERSION). */
  readonly codeVersion?: number;

  constructor(
    readonly code: PayloadErrorCode,
    message: string,
    options?: { cause?: unknown; codeVersion?: number },
  ) {
    super(message, options);
    if (options?.codeVersion !== undefined) this.codeVersion = options.codeVersion;
  }
}

const CODE_VERSION = 1;
const GENOME_VERSION_MAX = 15;
const NONCE_LENGTH = 4;
const CRC_OFFSET = PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH;
const ISSUED_DAY_MAX = 0xffff;
const MS_PER_DAY = 86_400_000;

function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * Check a one-byte counter whose zero value is reserved: zero → RESERVED,
 * anything else outside 1..max → RANGE.
 */
function checkNonZeroField(name: string, v: unknown, max: number): void {
  if (v === 0) throw new PayloadError('RESERVED', `${name} 0 is reserved`);
  if (!isInt(v) || v < 1 || v > max) throw new PayloadError('RANGE', `${name} ${String(v)} is outside 1..${max}`);
}

function checkLength(name: string, b: unknown, length: number): asserts b is Uint8Array {
  if (!isBytes(b) || b.length !== length) {
    const got = isBytes(b) ? `${b.length} bytes` : 'not a Uint8Array';
    throw new PayloadError('LENGTH', `${name} must be ${length} bytes (got ${got})`);
  }
}

function packIdentityOrThrow(identity: ProductIdentity): number {
  try {
    return packIdentity(identity);
  } catch (e) {
    if (e instanceof IdentityError) throw new PayloadError('RANGE', `identity: ${e.message}`, { cause: e });
    throw e;
  }
}

function unpackIdentityOrThrow(packed: number): ProductIdentity {
  try {
    return unpackIdentity(packed);
  } catch (e) {
    if (e instanceof IdentityError) throw new PayloadError('RANGE', `identity: ${e.message}`, { cause: e });
    throw e;
  }
}

/** 13-byte canonical encoding. Validates every field; throws PayloadError. */
export function encodePayload(p: CodePayloadV1): Uint8Array {
  if (p === null || typeof p !== 'object') throw new PayloadError('RANGE', 'payload must be an object');
  if (p.codeVersion !== CODE_VERSION) throw new PayloadError('VERSION', `unsupported code version ${String(p.codeVersion)}`);
  checkNonZeroField('genome version', p.genomeVersion, GENOME_VERSION_MAX);
  checkNonZeroField('key id', p.keyId, 0xff);
  const packed = packIdentityOrThrow(p.identity);
  checkNonZeroField('issue', p.issue, 0xff);
  if (!isInt(p.issuedDay) || p.issuedDay < 0 || p.issuedDay > ISSUED_DAY_MAX) {
    throw new PayloadError('RANGE', `issued day ${String(p.issuedDay)} is outside 0..${ISSUED_DAY_MAX}`);
  }
  checkLength('nonce', p.nonce, NONCE_LENGTH);

  const out = new Uint8Array(PAYLOAD_V1_LENGTH);
  out[0] = (CODE_VERSION << 4) | p.genomeVersion;
  out[1] = p.keyId;
  writeU32BE(out, 2, packed);
  out[6] = p.issue;
  writeU16BE(out, 7, p.issuedDay);
  out.set(p.nonce, 9);
  return out;
}

/**
 * Strict decoder. Check order: LENGTH, VERSION, then fields in byte order
 * (RESERVED for a zero genome version / key id / issue, RANGE for an
 * identity that unpackIdentity rejects). The nonce is copied, never aliased.
 */
export function decodePayload(b: Uint8Array): CodePayloadV1 {
  checkLength('payload', b, PAYLOAD_V1_LENGTH);
  const codeVersion = b[0] >>> 4;
  if (codeVersion !== CODE_VERSION) throw new PayloadError('VERSION', `unsupported code version ${codeVersion}`);
  const genomeVersion = b[0] & 0x0f;
  checkNonZeroField('genome version', genomeVersion, GENOME_VERSION_MAX);
  const keyId = b[1];
  checkNonZeroField('key id', keyId, 0xff);
  const identity = unpackIdentityOrThrow(readU32BE(b, 2));
  const issue = b[6];
  checkNonZeroField('issue', issue, 0xff);
  return {
    codeVersion: CODE_VERSION,
    genomeVersion,
    keyId,
    identity,
    issue,
    issuedDay: readU16BE(b, 7),
    nonce: b.slice(9, 9 + NONCE_LENGTH),
  };
}

/**
 * Message that is actually signed: utf8('ORBES-CODE/v1') ‖ 0x00 ‖ payload.
 * The domain prefix keeps an ORBES code signature from ever being valid for
 * another protocol using the same key, and vice versa; the 0x00 terminator
 * makes the domain unambiguous (it cannot be extended into the payload).
 * Only 13-byte v1 payloads may be signed under this domain.
 */
export function signingMessage(payloadBytes: Uint8Array): Uint8Array {
  checkLength('payload', payloadBytes, PAYLOAD_V1_LENGTH);
  return concatBytes(utf8(SIGNING_DOMAIN_V1), Uint8Array.of(0), payloadBytes);
}

/**
 * payload ‖ signature ‖ CRC-16 (big-endian, over payload ‖ signature).
 * Pure framing: only lengths are checked here. Payload semantics are enforced
 * by encodePayload at issuance and by decodePayload when unframing, which
 * also lets tests build CRC-valid frames around deliberately invalid payloads.
 */
export function frameCodeData(payloadBytes: Uint8Array, signature: Uint8Array): Uint8Array {
  checkLength('payload', payloadBytes, PAYLOAD_V1_LENGTH);
  checkLength('signature', signature, SIGNATURE_LENGTH);
  const out = new Uint8Array(CODE_DATA_V1_LENGTH);
  out.set(payloadBytes, 0);
  out.set(signature, PAYLOAD_V1_LENGTH);
  writeU16BE(out, CRC_OFFSET, crc16(out.subarray(0, CRC_OFFSET)));
  return out;
}

/**
 * Inverse of frameCodeData. Check order: LENGTH, CRC, then decodePayload.
 * Returned byte arrays are copies, independent of `data`.
 */
export function unframeCodeData(data: Uint8Array): {
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  payload: CodePayloadV1;
} {
  checkLength('code data', data, CODE_DATA_V1_LENGTH);
  if (crc16(data.subarray(0, CRC_OFFSET)) !== readU16BE(data, CRC_OFFSET)) {
    throw new PayloadError('CRC', 'code data CRC-16 mismatch');
  }
  const payloadBytes = data.slice(0, PAYLOAD_V1_LENGTH);
  return {
    payloadBytes,
    signature: data.slice(PAYLOAD_V1_LENGTH, CRC_OFFSET),
    payload: decodePayload(payloadBytes),
  };
}

/** UTC day number of `d` since 2024-01-01 (floor). Throws PayloadError('RANGE') outside 0..65535. */
export function issuedDayFromDate(d: Date): number {
  const t = d instanceof Date ? d.getTime() : Number.NaN;
  if (Number.isNaN(t)) throw new PayloadError('RANGE', 'issued date is not a valid Date');
  // Date values are UTC milliseconds without leap seconds, so floor division gives exact UTC days.
  const day = Math.floor((t - ISSUED_DAY_EPOCH_UTC) / MS_PER_DAY);
  if (day < 0 || day > ISSUED_DAY_MAX) {
    throw new PayloadError('RANGE', `issued date ${d.toISOString()} is outside the 16-bit day range from 2024-01-01`);
  }
  return day;
}

/** Midnight UTC of issued day `day`. Throws PayloadError('RANGE') outside 0..65535. */
export function dateFromIssuedDay(day: number): Date {
  if (!isInt(day) || day < 0 || day > ISSUED_DAY_MAX) {
    throw new PayloadError('RANGE', `issued day ${String(day)} is outside 0..${ISSUED_DAY_MAX}`);
  }
  return new Date(ISSUED_DAY_EPOCH_UTC + day * MS_PER_DAY);
}
