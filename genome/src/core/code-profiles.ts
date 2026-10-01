/**
 * Code-version registry (ORBES-CODE-SPEC §12, master specification §26).
 *
 * Every ORBES code names its version twice: in the format word (3 bits,
 * versions 1..8, readable before any data is decoded) and in the high nibble
 * of payload byte 0 (covered by the signature). A `CodeProfileEntry` gathers
 * what one version defines: its geometry, the length of its protected data,
 * its strict unframing / payload rules and its signing domain.
 *
 *   - The decoder reads the format word with the version-invariant CODE-01
 *     format cells, then decodes the data with the profile the word names
 *     (decoder/decode.ts, `DecodeOptions.codeProfiles`).
 *   - `unframeAnyCodeData` dispatches on the high nibble of byte 0.
 *   - A frame of a version this build has no profile for, whose
 *     version-independent envelope is intact, is reported as
 *     UNSUPPORTED_VERSION (an outdated reader), not as damage.
 *
 * Version-independent envelope (every version, ORBES-CODE-SPEC §12):
 *   payload (≥ 1 byte, byte 0 = codeVersion << 4 | …) ‖ signature (64 bytes)
 *   ‖ CRC-16/CCITT (big-endian) over everything before it.
 *
 * Today the registry holds CODE-01 only. The decoder's sampling tables are
 * those of the CODE-01 geometry: a profile with another geometry is ignored
 * by the decoder until its tables are generalised (the registry, the
 * encoder, the payload dispatch and the server are already version-driven).
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */
import { readU16BE } from './bytes.js';
import { CODE01 } from './code/profile.js';
import { crc16 } from './ecc/crc16.js';
import { PayloadError, SIGNATURE_LENGTH, SIGNING_DOMAIN_V1, signingMessage, unframeCodeData, type CodePayloadV1 } from './payload.js';

/** Result of unframing one version's code data. */
export interface UnframedCode<P> {
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  payload: P;
}

/** What one code version defines. */
export interface CodeProfileEntry<P = unknown> {
  /** 1..8, as carried by the format word and the payload's high nibble. */
  readonly version: number;
  /** Public name, e.g. 'CODE-01'. */
  readonly id: string;
  /** Geometric profile (rings, format cells, moons, ECC sizes). */
  readonly layout: typeof CODE01;
  /** Bytes protected by Reed-Solomon: payload ‖ signature ‖ CRC-16. */
  readonly dataLength: number;
  /** Signing domain prefix of this version. */
  readonly signingDomain: string;
  /** Strict unframing: length, CRC, then payload rules. Throws PayloadError. */
  unframe(data: Uint8Array): UnframedCode<P>;
  /** The exact message signed for a payload of this version. */
  signingMessage(payloadBytes: Uint8Array): Uint8Array;
}

export type CodeProfileRegistry<P = unknown> = ReadonlyMap<number, CodeProfileEntry<P>>;

/** Code versions the format word can carry. */
export const CODE_VERSION_MIN = 1;
export const CODE_VERSION_MAX = 8;
/** Smallest version-independent envelope: one payload byte ‖ signature ‖ CRC-16. */
export const CODE_ENVELOPE_MIN_LENGTH = 1 + SIGNATURE_LENGTH + 2;

/** CODE-01: 13-byte payload v1, Ed25519 over 'ORBES-CODE/v1' ‖ 0x00 ‖ payload, RS(164,79). */
export const CODE01_PROFILE: CodeProfileEntry<CodePayloadV1> = Object.freeze({
  version: 1,
  id: CODE01.id,
  layout: CODE01,
  dataLength: CODE01.ecc.dataBytes,
  signingDomain: SIGNING_DOMAIN_V1,
  unframe: unframeCodeData,
  signingMessage,
});

/** Every code version this build reads and verifies. */
export const CODE_PROFILES: CodeProfileRegistry<CodePayloadV1> = new Map([[CODE01_PROFILE.version, CODE01_PROFILE]]);

/** High nibble of byte 0. Throws PayloadError('LENGTH') on empty input. */
export function codeVersionOf(data: Uint8Array): number {
  if (!(data instanceof Uint8Array) || data.length === 0) throw new PayloadError('LENGTH', 'code data is empty');
  return data[0] >>> 4;
}

/**
 * Unframe code data of any registered version, chosen by the high nibble of
 * byte 0. A registered version applies its own strict rules (and errors). An
 * unregistered version 1..8 whose envelope is intact throws
 * PayloadError('UNSUPPORTED_VERSION') carrying `codeVersion`; anything else
 * throws PayloadError('VERSION').
 */
export function unframeAnyCodeData<P>(
  data: Uint8Array,
  profiles: CodeProfileRegistry<P>,
): UnframedCode<P> & { codeVersion: number; profile: CodeProfileEntry<P> } {
  const version = codeVersionOf(data);
  const profile = profiles.get(version);
  if (profile) return { ...profile.unframe(data), codeVersion: version, profile };
  const envelopeIntact =
    version >= CODE_VERSION_MIN &&
    version <= CODE_VERSION_MAX &&
    data.length >= CODE_ENVELOPE_MIN_LENGTH &&
    crc16(data.subarray(0, data.length - 2)) === readU16BE(data, data.length - 2);
  if (envelopeIntact) {
    throw new PayloadError('UNSUPPORTED_VERSION', `code version ${version} is not supported by this reader`, { codeVersion: version });
  }
  throw new PayloadError('VERSION', `unsupported code version ${version}`);
}

/**
 * The profiles the CODE-01 decoder and encoder can handle: same geometry
 * (sampling tables, format cells, RS sizes) and data length.
 */
export function code01CompatibleProfiles<P>(profiles: CodeProfileRegistry<P>): CodeProfileEntry<P>[] {
  return [...profiles.values()].filter(
    (p) => p.layout === CODE01 && p.dataLength === CODE01.ecc.dataBytes && p.version >= CODE_VERSION_MIN && p.version <= CODE_VERSION_MAX,
  );
}
