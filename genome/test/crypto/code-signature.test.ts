import { describe, expect, it } from 'vitest';
import { concatBytes, utf8 } from '../../src/core/bytes.js';
import {
  PAYLOAD_V1_LENGTH,
  SIGNATURE_LENGTH,
  SIGNING_DOMAIN_V1,
  encodePayload,
  frameCodeData,
  signingMessage,
  unframeCodeData,
  type CodePayloadV1,
} from '../../src/core/payload.js';
import { verifyCodeSignature, verifyEd25519 } from '../../src/core/verify/ed25519.js';
import { publicKeyFromSeed, signEd25519, verifyEd25519Node } from '../../src/server/crypto/ed25519-node.js';

// Fixed (test-only) issuing key so every run signs the same bytes.
const SEED = Uint8Array.from({ length: 32 }, (_, i) => (i * 29 + 3) & 0xff);
const PUBLIC_KEY = publicKeyFromSeed(SEED);

const PAYLOAD: CodePayloadV1 = {
  codeVersion: 1,
  genomeVersion: 1,
  keyId: 1,
  identity: { year: 2026, categoryIndex: 1, serial: 184 },
  issue: 1,
  issuedDay: 1004,
  nonce: Uint8Array.of(0x9a, 0x41, 0x07, 0xe3),
};
const PAYLOAD_BYTES = encodePayload(PAYLOAD);
const SIGNATURE = signEd25519(SEED, signingMessage(PAYLOAD_BYTES));

/** Copy of `bytes` with bit `bit` (MSB-first within each byte) flipped. */
function flipBit(bytes: Uint8Array, bit: number): Uint8Array {
  const out = bytes.slice();
  out[bit >>> 3] ^= 0x80 >>> (bit & 7);
  return out;
}

describe('verifyCodeSignature', () => {
  it('accepts a code signed by the server over the domain-separated message', () => {
    expect(SIGNATURE.length).toBe(SIGNATURE_LENGTH);
    expect(verifyCodeSignature(PUBLIC_KEY, PAYLOAD_BYTES, SIGNATURE)).toBe(true);
    expect(verifyEd25519Node(PUBLIC_KEY, signingMessage(PAYLOAD_BYTES), SIGNATURE)).toBe(true);
  });

  it('accepts what comes out of the 79-byte frame', () => {
    const { payloadBytes, signature } = unframeCodeData(frameCodeData(PAYLOAD_BYTES, SIGNATURE));
    expect(verifyCodeSignature(PUBLIC_KEY, payloadBytes, signature)).toBe(true);
  });

  it('rejects every single-bit flip of the payload (exhaustive, 13 × 8 bits)', () => {
    const accepted: number[] = [];
    for (let bit = 0; bit < PAYLOAD_V1_LENGTH * 8; bit++) {
      const tampered = flipBit(PAYLOAD_BYTES, bit);
      if (verifyCodeSignature(PUBLIC_KEY, tampered, SIGNATURE)) accepted.push(bit);
      if (verifyEd25519Node(PUBLIC_KEY, signingMessage(tampered), SIGNATURE)) accepted.push(bit);
    }
    expect(accepted).toEqual([]);
  });

  it('rejects every single-bit flip of the signature (exhaustive, 64 × 8 bits)', () => {
    const accepted: number[] = [];
    const message = signingMessage(PAYLOAD_BYTES);
    for (let bit = 0; bit < SIGNATURE_LENGTH * 8; bit++) {
      const tampered = flipBit(SIGNATURE, bit);
      if (verifyCodeSignature(PUBLIC_KEY, PAYLOAD_BYTES, tampered)) accepted.push(bit);
      if (verifyEd25519Node(PUBLIC_KEY, message, tampered)) accepted.push(bit);
    }
    expect(accepted).toEqual([]);
  });

  it('rejects a signature made for a different product identity', () => {
    const other = encodePayload({ ...PAYLOAD, identity: { ...PAYLOAD.identity, serial: 185 } });
    const otherSignature = signEd25519(SEED, signingMessage(other));
    expect(verifyCodeSignature(PUBLIC_KEY, other, otherSignature)).toBe(true);
    expect(verifyCodeSignature(PUBLIC_KEY, PAYLOAD_BYTES, otherSignature)).toBe(false);
  });

  it('rejects a signature from another key', () => {
    const otherSeed = SEED.map((b) => b ^ 0x5a);
    const forged = signEd25519(otherSeed, signingMessage(PAYLOAD_BYTES));
    expect(verifyCodeSignature(PUBLIC_KEY, PAYLOAD_BYTES, forged)).toBe(false);
    expect(verifyCodeSignature(publicKeyFromSeed(otherSeed), PAYLOAD_BYTES, forged)).toBe(true);
  });

  describe('domain separation', () => {
    const zero = Uint8Array.of(0);
    const foreignMessages: [string, Uint8Array][] = [
      ['the bare payload (no domain)', PAYLOAD_BYTES],
      ['another protocol version', concatBytes(utf8('ORBES-CODE/v2'), zero, PAYLOAD_BYTES)],
      ['another domain', concatBytes(utf8('ORBES-RECEIPT/v1'), zero, PAYLOAD_BYTES)],
      ['the domain without its 0x00 terminator', concatBytes(utf8(SIGNING_DOMAIN_V1), PAYLOAD_BYTES)],
      ['a lowercase domain', concatBytes(utf8(SIGNING_DOMAIN_V1.toLowerCase()), zero, PAYLOAD_BYTES)],
      ['the payload before the domain', concatBytes(PAYLOAD_BYTES, zero, utf8(SIGNING_DOMAIN_V1))],
    ];

    it.each(foreignMessages)('rejects a signature over %s', (_label, message) => {
      const signature = signEd25519(SEED, message);
      // The signature is genuine for its own message …
      expect(verifyEd25519(PUBLIC_KEY, message, signature)).toBe(true);
      // … but must never authenticate an ORBES code.
      expect(verifyCodeSignature(PUBLIC_KEY, PAYLOAD_BYTES, signature)).toBe(false);
    });
  });

  it('returns false, without throwing, for malformed inputs', () => {
    const cases: [Uint8Array, Uint8Array, Uint8Array][] = [
      [PUBLIC_KEY, PAYLOAD_BYTES.subarray(0, 12), SIGNATURE],
      [PUBLIC_KEY, concatBytes(PAYLOAD_BYTES, Uint8Array.of(0)), SIGNATURE],
      [PUBLIC_KEY, PAYLOAD_BYTES, SIGNATURE.subarray(0, 63)],
      [PUBLIC_KEY.subarray(0, 31), PAYLOAD_BYTES, SIGNATURE],
      [PUBLIC_KEY, null as unknown as Uint8Array, SIGNATURE],
      [undefined as unknown as Uint8Array, PAYLOAD_BYTES, SIGNATURE],
    ];
    for (const [pk, payload, sig] of cases) {
      expect(() => verifyCodeSignature(pk, payload, sig)).not.toThrow();
      expect(verifyCodeSignature(pk, payload, sig)).toBe(false);
    }
  });
});
