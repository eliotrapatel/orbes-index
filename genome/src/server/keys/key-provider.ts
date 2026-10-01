/**
 * Private-key custody abstraction (contract §2.2).
 *
 * A KeyProvider owns Ed25519 private keys and exposes exactly two
 * operations: create a key (returning only its public half and an opaque
 * reference) and sign with a key. Private key material never crosses this
 * interface, so a KMS/HSM provider can implement it without the key ever
 * leaving the device. The database stores the public key and the reference
 * (`provider_ref`), never a secret.
 *
 * Providers are deliberately dumb: lifecycle (ACTIVE / RETIRED / REVOKED),
 * key ids and verify-after-sign live in KeyService.
 */

export interface KeyProvider {
  /** Stable provider name stored in `cryptographic_keys.provider` (e.g. 'local', 'memory', 'aws-kms'). */
  readonly name: string;
  /** Create a new Ed25519 key labelled `kid`. Must never overwrite an existing key. */
  generate(kid: string): Promise<{ publicKey: Uint8Array; providerRef: string }>;
  /** Pure Ed25519 (RFC 8032) signature of `message`, 64 bytes. */
  sign(providerRef: string, message: Uint8Array): Promise<Uint8Array>;
}

export type KeyProviderErrorCode =
  /** The reference does not name a key this provider holds. */
  | 'KEY_NOT_FOUND'
  /** A key with this kid already exists. */
  | 'KEY_EXISTS'
  /** Stored key material failed its integrity check (tampered, corrupted or wrong encryption key). */
  | 'KEY_INTEGRITY'
  /** Malformed kid / reference / message. */
  | 'INVALID_INPUT'
  /** Misconfiguration (missing encryption key, unusable directory, refused environment). */
  | 'CONFIG'
  /** I/O or backend failure. */
  | 'UNAVAILABLE';

/**
 * Provider failure. Messages name the kid or reference, never key material;
 * they are for logs, and KeyService maps them to generic public errors.
 */
export class KeyProviderError extends Error {
  override readonly name = 'KeyProviderError';
  constructor(
    readonly code: KeyProviderErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Key labels: short, URL- and filename-safe, so a kid can be published in the
 * JWKS-like key list and used as a file name without any escaping.
 */
export const KID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidKid(kid: unknown): kid is string {
  return typeof kid === 'string' && KID_RE.test(kid) && !kid.includes('..');
}

export function assertKid(kid: unknown): asserts kid is string {
  if (!isValidKid(kid)) throw new KeyProviderError('INVALID_INPUT', 'invalid kid (expected [A-Za-z0-9][A-Za-z0-9._-]{0,63})');
}

export function assertMessage(message: unknown): asserts message is Uint8Array {
  if (!(message instanceof Uint8Array)) throw new KeyProviderError('INVALID_INPUT', 'message must be a Uint8Array');
}
