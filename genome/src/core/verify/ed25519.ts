/**
 * Isomorphic Ed25519 verification (RFC 8032, pure Ed25519) via @noble/curves.
 *
 * Used where node:crypto is unavailable (browser, Web Worker, offline tools)
 * and as an independent second implementation in tests. The server's
 * authoritative check uses node:crypto (src/server/crypto/ed25519-node.ts).
 *
 * Verification runs with `zip215: false`, i.e. strict RFC 8032 / FIPS 186-5
 * decoding: non-canonical encodings of A and R are rejected, S must be < L,
 * and small-order public keys are rejected. noble's ed25519 defaults to the
 * permissive ZIP-215 rules (made for consensus systems), under which e.g. the
 * identity point as public key accepts the signature (R = identity, S = 0) for
 * every message. Strict mode leaves exactly one accepted encoding per valid
 * (key, signature), which is what an authentication code needs.
 *
 * The one remaining difference from node:crypto is noble's cofactored
 * equation versus OpenSSL's cofactorless one. They can only disagree on a
 * signature whose R has a small-order component, which only the holder of the
 * secret key can produce; honest signatures verify identically in both.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { PAYLOAD_V1_LENGTH, SIGNATURE_LENGTH, signingMessage } from '../payload.js';

const PUBLIC_KEY_LENGTH = 32;

function isBytes(v: unknown, length?: number): v is Uint8Array {
  return v instanceof Uint8Array && (length === undefined || v.length === length);
}

/** True iff `signature` is a valid strict RFC 8032 signature of `message` under `publicKey`. Never throws. */
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (!isBytes(publicKey, PUBLIC_KEY_LENGTH) || !isBytes(message) || !isBytes(signature, SIGNATURE_LENGTH)) return false;
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    // Verification is a boolean boundary: malformed input means "not authentic", never an exception.
    return false;
  }
}

/** Verify an ORBES CODE signature over signingMessage(payloadBytes). Never throws. */
export function verifyCodeSignature(publicKey: Uint8Array, payloadBytes: Uint8Array, signature: Uint8Array): boolean {
  if (!isBytes(payloadBytes, PAYLOAD_V1_LENGTH)) return false;
  return verifyEd25519(publicKey, signingMessage(payloadBytes), signature);
}
