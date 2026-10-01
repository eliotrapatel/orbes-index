/**
 * Secretbox: authenticated encryption of small server-side secrets at rest
 * (admin TOTP seeds today) with AES-256-GCM from node:crypto.
 *
 *   sealed = "v1." base64url(iv: 12 random bytes) "." base64url(ciphertext ‖ tag: 16 bytes)
 *
 * - A fresh random 96-bit IV per seal (NIST SP 800-38D §8.2.2). With random
 *   IVs one key must stay well below 2^32 seals; storing TOTP seeds never
 *   comes close.
 * - Optional AAD binds a ciphertext to its context (e.g. the admin id), so a
 *   database attacker cannot move one user's sealed secret to another row.
 * - Opening fails closed with SecretboxError on any malformation or
 *   authentication failure; the message never contains key or plaintext.
 *
 * Keys are 32 bytes. `deriveSubkey` (HKDF-SHA256, RFC 5869) gives each use
 * its own key from one master secret, so a key is never shared across
 * purposes.
 *
 * Node-only.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { fromBase64Url, toBase64Url, utf8 } from '../../core/bytes.js';

export const SECRETBOX_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';
// Secrets sealed here are tiny; refusing large inputs bounds work on hostile rows.
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_SEALED_CHARS = Math.ceil(((MAX_PLAINTEXT_BYTES + TAG_BYTES) * 4) / 3) + 64;

export class SecretboxError extends Error {
  override readonly name = 'SecretboxError';
}

function checkKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== SECRETBOX_KEY_BYTES) {
    throw new SecretboxError(`secretbox key must be ${SECRETBOX_KEY_BYTES} bytes`);
  }
}

function toBytes(v: Uint8Array | string): Uint8Array {
  return typeof v === 'string' ? utf8(v) : v;
}

/** Encrypt and authenticate `plaintext` (bytes or UTF-8 text). */
export function seal(key: Uint8Array, plaintext: Uint8Array | string, aad?: Uint8Array | string): string {
  checkKey(key);
  const pt = toBytes(plaintext);
  if (pt.length > MAX_PLAINTEXT_BYTES) throw new SecretboxError('plaintext is too large');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  if (aad !== undefined) cipher.setAAD(toBytes(aad));
  const ct = Buffer.concat([cipher.update(pt), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

/** Decrypt a value produced by `seal` with the same key and AAD. Throws SecretboxError otherwise. */
export function open(key: Uint8Array, sealed: string, aad?: Uint8Array | string): Uint8Array {
  checkKey(key);
  if (typeof sealed !== 'string' || sealed.length > MAX_SEALED_CHARS) throw new SecretboxError('malformed sealed value');
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new SecretboxError('malformed sealed value');
  let iv: Uint8Array;
  let body: Uint8Array;
  try {
    iv = fromBase64Url(parts[1]);
    body = fromBase64Url(parts[2]);
  } catch {
    throw new SecretboxError('malformed sealed value');
  }
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new SecretboxError('malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  if (aad !== undefined) decipher.setAAD(toBytes(aad));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  try {
    const pt = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
    return new Uint8Array(pt);
  } catch {
    // Wrong key, wrong AAD or tampered ciphertext: GCM cannot tell which, and neither do we.
    throw new SecretboxError('sealed value failed authentication');
  }
}

/** `open` for values sealed from UTF-8 text. */
export function openText(key: Uint8Array, sealed: string, aad?: Uint8Array | string): string {
  const pt = open(key, sealed, aad);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(pt);
  } catch {
    throw new SecretboxError('sealed value is not UTF-8 text');
  }
}

/**
 * HKDF-SHA256 subkey for one purpose. `info` names the purpose (e.g.
 * 'orbes/admin-totp/v1'); different infos give independent keys.
 */
export function deriveSubkey(
  ikm: Uint8Array | string,
  info: string,
  opts: { salt?: Uint8Array | string; length?: number } = {},
): Uint8Array {
  const material = toBytes(ikm);
  if (material.length < 16) throw new SecretboxError('key material must be at least 16 bytes');
  if (typeof info !== 'string' || info.length === 0) throw new SecretboxError('HKDF info is required');
  const length = opts.length ?? SECRETBOX_KEY_BYTES;
  const salt = opts.salt === undefined ? new Uint8Array(0) : toBytes(opts.salt);
  return new Uint8Array(hkdfSync('sha256', material, salt, utf8(info), length));
}
