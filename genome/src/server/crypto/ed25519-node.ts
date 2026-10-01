/**
 * Ed25519 (RFC 8032, pure) signing and verification on node:crypto (OpenSSL).
 *
 * Keys travel as raw bytes: the 32-byte RFC 8032 secret seed and the 32-byte
 * public key. node:crypto has no raw-seed import on Node 22, so seeds are
 * wrapped in the fixed RFC 8410 PKCS#8 DER prefix; every DER copy holding a
 * seed is zeroed as soon as OpenSSL has parsed it. (The KeyObject's internal
 * copy lives in OpenSSL memory and is released with the object; JavaScript
 * cannot wipe it.)
 *
 * Verification is strict to match src/core/verify/ed25519.ts: OpenSSL already
 * rejects S ≥ L and non-canonical R, but it accepts non-canonical and
 * small-order public keys (with the identity point as key, R = identity and
 * S = 0 verifies for every message). Such keys are rejected up front with the
 * audited @noble/curves point decoder.
 *
 * Node-only.
 */

import { createPrivateKey, createPublicKey, randomFillSync, sign, verify, type KeyObject } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';

const SEED_LENGTH = 32;
const PUBLIC_KEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;

/** RFC 8410: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING (32) } } */
const PKCS8_SEED_PREFIX = Uint8Array.of(
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
);
/** RFC 8410: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING (0 unused bits, 32 bytes) } */
const SPKI_PREFIX = Uint8Array.of(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00);

function isBytes(v: unknown, length?: number): v is Uint8Array {
  return v instanceof Uint8Array && (length === undefined || v.length === length);
}

function assertSeed(seed: Uint8Array): void {
  if (!isBytes(seed, SEED_LENGTH)) throw new TypeError(`Ed25519 seed must be a ${SEED_LENGTH}-byte Uint8Array`);
}

function withPrefix(prefix: Uint8Array, body: Uint8Array): Uint8Array {
  const der = new Uint8Array(prefix.length + body.length);
  der.set(prefix, 0);
  der.set(body, prefix.length);
  return der;
}

function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  assertSeed(seed);
  const der = withPrefix(PKCS8_SEED_PREFIX, seed);
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } finally {
    der.fill(0);
  }
}

/** Canonical encoding of a point of order > 8, i.e. what strict RFC 8032 verification accepts as a key. */
function isStrictPublicKey(publicKey: Uint8Array): boolean {
  try {
    return !ed25519.Point.fromBytes(publicKey, false).isSmallOrder();
  } catch {
    return false;
  }
}

/** Fresh key pair: `privateKey` is the 32-byte RFC 8032 seed (keep secret), `publicKey` its 32-byte encoding. */
export function generateEd25519KeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  // An Ed25519 secret key is, by definition (RFC 8032 §5.1.5), 32 uniformly random bytes.
  const privateKey = randomFillSync(new Uint8Array(SEED_LENGTH));
  return { privateKey, publicKey: publicKeyFromSeed(privateKey) };
}

/** 32-byte public key of a 32-byte seed. */
export function publicKeyFromSeed(seed32: Uint8Array): Uint8Array {
  const spki = createPublicKey(privateKeyFromSeed(seed32)).export({ format: 'der', type: 'spki' });
  if (spki.length !== SPKI_PREFIX.length + PUBLIC_KEY_LENGTH || !SPKI_PREFIX.every((b, i) => spki[i] === b)) {
    throw new Error('unexpected Ed25519 SPKI encoding from node:crypto');
  }
  return Uint8Array.from(spki.subarray(SPKI_PREFIX.length));
}

/** Deterministic 64-byte RFC 8032 signature of `message` under `seed32`. Throws TypeError on malformed input. */
export function signEd25519(seed32: Uint8Array, message: Uint8Array): Uint8Array {
  if (!isBytes(message)) throw new TypeError('message must be a Uint8Array');
  const signature = sign(null, message, privateKeyFromSeed(seed32));
  if (signature.length !== SIGNATURE_LENGTH) throw new Error('unexpected Ed25519 signature length from node:crypto');
  // Plain Uint8Array (not a pooled Buffer view) so callers get an independent, comparable value.
  return Uint8Array.from(signature);
}

/** True iff `signature` is a valid strict RFC 8032 signature of `message` under `publicKey`. Never throws. */
export function verifyEd25519Node(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (!isBytes(publicKey, PUBLIC_KEY_LENGTH) || !isBytes(message) || !isBytes(signature, SIGNATURE_LENGTH)) return false;
  if (!isStrictPublicKey(publicKey)) return false;
  try {
    const key = createPublicKey({ key: withPrefix(SPKI_PREFIX, publicKey), format: 'der', type: 'spki' });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}
