/**
 * Claim codes: the one-time secret shipped with a product (inside the box /
 * certificate) that proves possession at first registration (contract §2.3,
 * §2.7).
 *
 *   12 Crockford base32 characters = 60 bits of entropy, shown once as
 *   XXXX-XXXX-XXXX and stored only as an scrypt hash (same parameters as
 *   passwords, see ../crypto/scrypt.ts).
 *
 * Crockford's alphabet omits I, L, O and U, and decoding is forgiving the way
 * the spec allows (case-insensitive, I/L read as 1, O read as 0, hyphens and
 * spaces ignored), because these codes are typed by customers from a printed
 * card. The canonical form (12 uppercase characters, no separators) is what
 * gets hashed, so every accepted spelling verifies.
 *
 * 60 bits plus scrypt plus the per-product attempt limit (contract §2.7) make
 * online guessing hopeless and offline guessing of a leaked hash expensive.
 */
import { randomBytes } from 'node:crypto';
import { hashSecret, verifySecret } from '../crypto/scrypt.js';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CLAIM_CODE_LENGTH = 12;
const GROUP = 4;
// Generous cap before normalising: separators and spaces are tolerated, novels are not.
const MAX_INPUT_LENGTH = 64;

const DECODE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of CROCKFORD_ALPHABET) m.set(c, c);
  // Crockford decoding aliases for characters that look alike on paper.
  m.set('I', '1');
  m.set('L', '1');
  m.set('O', '0');
  return m;
})();

/**
 * Random Crockford base32 string. Each character takes the low 5 bits of one
 * random byte: 256 is a multiple of 32, so every character is uniform.
 */
export function randomCrockford(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 256) throw new RangeError('length must be an integer in 1..256');
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += CROCKFORD_ALPHABET[b & 0x1f];
  bytes.fill(0);
  return out;
}

/**
 * Canonical form of a typed code (`length` characters, uppercase, no
 * separators), or undefined when it cannot be one: wrong length, a 'U', or any
 * other character outside the alphabet.
 */
export function normalizeCrockford(input: unknown, length = CLAIM_CODE_LENGTH): string | undefined {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) return undefined;
  const compact = input.replace(/[\s-]+/g, '').toUpperCase();
  if (compact.length !== length) return undefined;
  let out = '';
  for (const c of compact) {
    const v = DECODE.get(c);
    if (v === undefined) return undefined;
    out += v;
  }
  return out;
}

/** Group a canonical code for display: ABCD-EFGH-JKMN. */
export function formatGrouped(canonical: string): string {
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += GROUP) groups.push(canonical.slice(i, i + GROUP));
  return groups.join('-');
}

/** A fresh claim code in display form, XXXX-XXXX-XXXX. */
export function generateClaimCode(): string {
  return formatGrouped(randomCrockford(CLAIM_CODE_LENGTH));
}

/** Canonical 12-character form of a typed claim code, or undefined if malformed. */
export function normalizeClaimCode(input: unknown): string | undefined {
  return normalizeCrockford(input, CLAIM_CODE_LENGTH);
}

/** scrypt hash of a claim code (any accepted spelling) for `products.claim_secret_hash`. */
export async function hashClaimCode(code: string): Promise<string> {
  const canonical = normalizeClaimCode(code);
  if (canonical === undefined) throw new RangeError('not a valid claim code');
  return hashSecret(canonical);
}

/**
 * Constant-time check of a typed claim code against the stored hash. False for
 * malformed input or a malformed hash; never throws. Callers must apply the
 * per-product attempt limit BEFORE calling (each call costs one scrypt).
 */
export async function verifyClaimCode(input: unknown, encodedHash: string): Promise<boolean> {
  const canonical = normalizeClaimCode(input);
  if (canonical === undefined) return false;
  return verifySecret(canonical, encodedHash);
}
