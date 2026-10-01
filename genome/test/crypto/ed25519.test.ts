import { ed25519 } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, toHex } from '../../src/core/bytes.js';
import { verifyEd25519 } from '../../src/core/verify/ed25519.js';
import {
  generateEd25519KeyPair,
  publicKeyFromSeed,
  signEd25519,
  verifyEd25519Node,
} from '../../src/server/crypto/ed25519-node.js';

/** mulberry32: small, fast, seedable; every test owns its own stream. */
function prng(seed: number): { int(maxExclusive: number): number; bytes(length: number): Uint8Array } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    int: (maxExclusive) => next() % maxExclusive,
    bytes: (length) => Uint8Array.from({ length }, () => next() & 0xff),
  };
}

const VERIFIERS = [
  ['noble (core)', verifyEd25519],
  ['node:crypto (server)', verifyEd25519Node],
] as const;

/** RFC 8032 §7.1, tests 1–3. */
const RFC8032_VECTORS = [
  {
    name: 'TEST 1 (empty message)',
    secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    public: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    message: '',
    signature:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    name: 'TEST 2 (1-byte message)',
    secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    public: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    message: '72',
    signature:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
  {
    name: 'TEST 3 (2-byte message)',
    secret: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    public: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
    message: 'af82',
    signature:
      '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
  },
];

/** Group order L of the Ed25519 base point. */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

function bytesToBigIntLE(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}

function bigIntToBytesLE(v: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
}

describe('RFC 8032 test vectors', () => {
  describe.each(RFC8032_VECTORS)('$name', (v) => {
    const secret = fromHex(v.secret);
    const publicKey = fromHex(v.public);
    const message = fromHex(v.message);
    const signature = fromHex(v.signature);

    it('node:crypto derives the public key and signs to the expected bytes', () => {
      expect(toHex(publicKeyFromSeed(secret))).toBe(v.public);
      expect(toHex(signEd25519(secret, message))).toBe(v.signature);
    });

    it.each(VERIFIERS)('%s accepts the signature', (_name, verify) => {
      expect(verify(publicKey, message, signature)).toBe(true);
    });

    it.each(VERIFIERS)('%s rejects it for another message', (_name, verify) => {
      expect(verify(publicKey, concatBytes(message, Uint8Array.of(0)), signature)).toBe(false);
    });
  });
});

describe('node:crypto ↔ noble interoperability', () => {
  it('produces identical signatures and cross-verifies on random keys and messages (seeded)', () => {
    const rng = prng(0x25519);
    for (let i = 0; i < 40; i++) {
      const seed = rng.bytes(32);
      const message = rng.bytes(rng.int(200));
      const publicKey = publicKeyFromSeed(seed);
      expect(publicKey).toEqual(ed25519.getPublicKey(seed));

      const nodeSignature = signEd25519(seed, message);
      const nobleSignature = ed25519.sign(message, seed);
      // Ed25519 is deterministic: two correct implementations agree byte for byte.
      expect(nodeSignature).toEqual(nobleSignature);
      expect(verifyEd25519(publicKey, message, nodeSignature)).toBe(true);
      expect(verifyEd25519Node(publicKey, message, nobleSignature)).toBe(true);
    }
  });

  it('a signature does not verify under another key', () => {
    const rng = prng(0xa11ce);
    const message = rng.bytes(32);
    const signature = signEd25519(rng.bytes(32), message);
    const otherKey = publicKeyFromSeed(rng.bytes(32));
    for (const [, verify] of VERIFIERS) expect(verify(otherKey, message, signature)).toBe(false);
  });
});

describe('generateEd25519KeyPair', () => {
  it('returns a 32-byte seed and its 32-byte public key', () => {
    const { privateKey, publicKey } = generateEd25519KeyPair();
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(privateKey.length).toBe(32);
    expect(publicKey.length).toBe(32);
    expect(publicKey).toEqual(publicKeyFromSeed(privateKey));
    expect(publicKey).toEqual(ed25519.getPublicKey(privateKey));
    const message = Uint8Array.of(1, 2, 3);
    expect(verifyEd25519Node(publicKey, message, signEd25519(privateKey, message))).toBe(true);
  });

  it('draws a fresh seed on every call', () => {
    const a = generateEd25519KeyPair();
    const b = generateEd25519KeyPair();
    expect(a.privateKey).not.toEqual(b.privateKey);
    expect(a.publicKey).not.toEqual(b.publicKey);
  });
});

describe('signEd25519 / publicKeyFromSeed input handling', () => {
  const seed = fromHex(RFC8032_VECTORS[0].secret);

  it('leaves the caller seed untouched', () => {
    const copy = seed.slice();
    signEd25519(seed, Uint8Array.of(1));
    publicKeyFromSeed(seed);
    expect(seed).toEqual(copy);
  });

  it('returns plain, independent Uint8Arrays', () => {
    const signature = signEd25519(seed, new Uint8Array(0));
    expect(Object.getPrototypeOf(signature)).toBe(Uint8Array.prototype);
    expect(signature.byteOffset).toBe(0);
    expect(signature.buffer.byteLength).toBe(64);
    expect(Object.getPrototypeOf(publicKeyFromSeed(seed))).toBe(Uint8Array.prototype);
  });

  it.each([
    ['31-byte seed', new Uint8Array(31)],
    ['33-byte seed', new Uint8Array(33)],
    ['64-byte seed (expanded key)', new Uint8Array(64)],
    ['string seed', 'x'.repeat(32) as unknown as Uint8Array],
  ])('rejects a %s', (_label, badSeed) => {
    expect(() => signEd25519(badSeed, Uint8Array.of(1))).toThrow(TypeError);
    expect(() => publicKeyFromSeed(badSeed)).toThrow(TypeError);
  });

  it('rejects a non-byte message', () => {
    expect(() => signEd25519(seed, 'hello' as unknown as Uint8Array)).toThrow(TypeError);
  });
});

describe.each(VERIFIERS)('%s verification is strict and never throws', (_name, verify) => {
  const v = RFC8032_VECTORS[1];
  const publicKey = fromHex(v.public);
  const message = fromHex(v.message);
  const signature = fromHex(v.signature);

  it.each([
    ['31-byte public key', publicKey.subarray(0, 31), message, signature],
    ['33-byte public key', concatBytes(publicKey, Uint8Array.of(0)), message, signature],
    ['63-byte signature', publicKey, message, signature.subarray(0, 63)],
    ['65-byte signature', publicKey, message, concatBytes(signature, Uint8Array.of(0))],
    ['empty signature', publicKey, message, new Uint8Array(0)],
    ['null public key', null, message, signature],
    ['undefined message', publicKey, undefined, signature],
    ['string signature', publicKey, message, v.signature],
    ['number[] public key', [...publicKey], message, signature],
  ])('returns false for %s', (_label, pk, msg, sig) => {
    const call = (): boolean => verify(pk as Uint8Array, msg as Uint8Array, sig as Uint8Array);
    expect(call).not.toThrow();
    expect(call()).toBe(false);
  });

  it('returns false for a public key that is not a curve point', () => {
    // y = 2 has no matching x on edwards25519, so this encoding does not decode.
    const notOnCurve = new Uint8Array(32);
    notOnCurve[0] = 2;
    expect(() => ed25519.Point.fromBytes(notOnCurve, false)).toThrow();
    expect(verify(notOnCurve, message, signature)).toBe(false);
  });

  it('rejects the malleated signature (R, S + L)', () => {
    const s = bytesToBigIntLE(signature.subarray(32));
    const malleated = concatBytes(signature.subarray(0, 32), bigIntToBytesLE(s + L, 32));
    expect(verify(publicKey, message, malleated)).toBe(false);
  });

  it('rejects the small-order-key forgery (A = identity, R = identity, S = 0) for any message', () => {
    // Under permissive rules this "signature" verifies for every message,
    // because both sides of [8]SB = [8]R + [8]kA are the identity.
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const forged = concatBytes(identity, new Uint8Array(32));
    expect(verify(identity, message, forged)).toBe(false);
    expect(verify(identity, new Uint8Array(0), forged)).toBe(false);
  });

  describe('R encodings (signatures made with the secret key, so only R decides)', () => {
    // With R = the identity point, S = k·a (mod L) satisfies S·B = R + k·A for
    // k = SHA-512(R_bytes ‖ A ‖ M), i.e. a genuine signature by the key
    // holder. The same point R has two non-canonical spellings (y = p + 1,
    // and x = 0 with the sign bit set); strict RFC 8032 verifiers must reject
    // both, otherwise a signer could mint several byte-distinct signatures of
    // one code and the registry's byte comparisons would stop being unique.
    const P = 2n ** 255n - 19n;
    const { scalar } = ed25519.utils.getExtendedPublicKey(fromHex(v.secret));

    function signWithR(rBytes: Uint8Array): Uint8Array {
      const k = bytesToBigIntLE(sha512(concatBytes(rBytes, publicKey, message))) % L;
      return concatBytes(rBytes, bigIntToBytesLE((k * scalar) % L, 32));
    }

    it('accepts the canonical encoding (y = 1)', () => {
      expect(verify(publicKey, message, signWithR(bigIntToBytesLE(1n, 32)))).toBe(true);
    });

    it('rejects y = p + 1', () => {
      expect(verify(publicKey, message, signWithR(bigIntToBytesLE(P + 1n, 32)))).toBe(false);
    });

    it('rejects x = 0 with the sign bit set', () => {
      const negativeZero = bigIntToBytesLE(1n, 32);
      negativeZero[31] |= 0x80;
      expect(verify(publicKey, message, signWithR(negativeZero))).toBe(false);
    });
  });

  it('rejects the same forgery with a non-canonical identity key (y = p + 1)', () => {
    const nonCanonicalIdentity = bigIntToBytesLE(2n ** 255n - 19n + 1n, 32);
    const identity = new Uint8Array(32);
    identity[0] = 1;
    expect(verify(nonCanonicalIdentity, message, concatBytes(identity, new Uint8Array(32)))).toBe(false);
  });
});
