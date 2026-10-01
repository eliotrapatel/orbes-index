/**
 * Secret hashing shared by passwords and claim codes (src/server/crypto/scrypt.ts)
 * and the claim-code format (src/server/services/claim-codes.ts).
 */
import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/core/bytes.js';
import { hashSecret, isEncodedSecret, MAX_SECRET_BYTES, needsRehash, SCRYPT_PARAMS, verifySecret } from '../../src/server/crypto/scrypt.js';
import {
  CLAIM_CODE_LENGTH,
  CROCKFORD_ALPHABET,
  formatGrouped,
  generateClaimCode,
  hashClaimCode,
  normalizeClaimCode,
  normalizeCrockford,
  randomCrockford,
  verifyClaimCode,
} from '../../src/server/services/claim-codes.js';

describe('scrypt secrets', () => {
  it('encodes scrypt$15$8$1$<16-byte salt>$<32-byte key> and verifies', async () => {
    const h = await hashSecret('correct horse battery staple');
    const m = /^scrypt\$15\$8\$1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(h);
    expect(m).not.toBeNull();
    expect(fromBase64Url(m![1]).length).toBe(16);
    expect(fromBase64Url(m![2]).length).toBe(32);
    expect(SCRYPT_PARAMS).toEqual({ logN: 15, r: 8, p: 1, saltBytes: 16, keyBytes: 32 });
    expect(await verifySecret('correct horse battery staple', h)).toBe(true);
    expect(await verifySecret('correct horse battery staplE', h)).toBe(false);
    expect(isEncodedSecret(h)).toBe(true);
    expect(needsRehash(h)).toBe(false);
  });

  it('is interoperable with plain node:crypto scrypt (standard construction, no pepper)', async () => {
    const h = await hashSecret('pässwörd ✓');
    const [, , , , salt, key] = h.split('$');
    const expected = scryptSync(Buffer.from('pässwörd ✓', 'utf8'), fromBase64Url(salt), 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    expect(toBase64Url(new Uint8Array(expected))).toBe(key);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashSecret('same'), hashSecret('same')]);
    expect(a).not.toBe(b);
    expect(await verifySecret('same', a)).toBe(true);
    expect(await verifySecret('same', b)).toBe(true);
  });

  it('verifies hashes with other in-bounds parameters and flags them for rehash', async () => {
    const salt = new Uint8Array(16).fill(9);
    const key = scryptSync('legacy', salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const legacy = `scrypt$14$8$1$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(key))}`;
    expect(await verifySecret('legacy', legacy)).toBe(true);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('never throws on malformed, out-of-bounds or hostile hashes', async () => {
    const good = await hashSecret('x');
    const [, , , , salt, key] = good.split('$');
    const hostile = [
      '',
      'bcrypt$...',
      good.replace('scrypt$15', 'scrypt$30'), // N = 2^30 would need 128 GiB
      good.replace('$8$1$', '$99$1$'),
      good.replace('$8$1$', '$08$1$'), // non-canonical number
      `scrypt$15$8$1$${salt}`,
      `scrypt$15$8$1$${salt}$${key}$extra`,
      `scrypt$15$8$1$${toBase64Url(new Uint8Array(8))}$${key}`, // salt too short
      `scrypt$15$8$1$${salt}$${key}=`,
      null,
      42,
    ];
    for (const h of hostile) {
      expect(await verifySecret('x', h as string)).toBe(false);
      expect(isEncodedSecret(h)).toBe(false);
    }
    expect(needsRehash('garbage')).toBe(true);
  });

  it('bounds the secret: empty or over-long secrets are refused for hashing and never verify', async () => {
    await expect(hashSecret('')).rejects.toThrow(RangeError);
    await expect(hashSecret('a'.repeat(MAX_SECRET_BYTES + 1))).rejects.toThrow(RangeError);
    await expect(hashSecret(7 as unknown as string)).rejects.toThrow(TypeError);
    const h = await hashSecret('a'.repeat(MAX_SECRET_BYTES));
    expect(await verifySecret('a'.repeat(MAX_SECRET_BYTES), h)).toBe(true);
    expect(await verifySecret('a'.repeat(MAX_SECRET_BYTES + 1), h)).toBe(false);
    expect(await verifySecret(undefined as unknown as string, h)).toBe(false);
  });
});

describe('claim codes', () => {
  it('generates XXXX-XXXX-XXXX from the Crockford alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateClaimCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('draws characters uniformly (no modulo bias)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      for (const ch of randomCrockford(256)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    // Expected 400 each (sd ≈ 20); a biased draw (e.g. %32 of a non-multiple range) would skew far beyond this.
    for (const n of counts.values()) expect(n).toBeGreaterThan(280);
  });

  it('normalises typed input the Crockford way', () => {
    expect(normalizeClaimCode('ABCD-EFGH-JKMN')).toBe('ABCDEFGHJKMN');
    expect(normalizeClaimCode(' abcd efgh jkmn ')).toBe('ABCDEFGHJKMN');
    expect(normalizeClaimCode('0OIL-1234-5678')).toBe('0011' + '12345678');
    expect(normalizeClaimCode('ABCD-EFGH-JKMU')).toBeUndefined(); // U is not in the alphabet
    expect(normalizeClaimCode('ABCD-EFGH-JKM')).toBeUndefined();
    expect(normalizeClaimCode('ABCD-EFGH-JKMNP')).toBeUndefined();
    expect(normalizeClaimCode('ABCD_EFGH_JKMN')).toBeUndefined();
    expect(normalizeClaimCode('A'.repeat(100))).toBeUndefined();
    expect(normalizeClaimCode(12)).toBeUndefined();
    expect(normalizeCrockford('abcd-efgh', 8)).toBe('ABCDEFGH');
    expect(formatGrouped('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    expect(CLAIM_CODE_LENGTH).toBe(12);
  });

  it('hashes with scrypt and verifies any accepted spelling, constant-time', async () => {
    const code = generateClaimCode();
    const hash = await hashClaimCode(code);
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(hash).not.toContain(code.replaceAll('-', ''));
    expect(await verifyClaimCode(code, hash)).toBe(true);
    expect(await verifyClaimCode(code.toLowerCase().replaceAll('-', ' '), hash)).toBe(true);
    const wrong = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
    expect(await verifyClaimCode(wrong, hash)).toBe(false);
    expect(await verifyClaimCode('not a code', hash)).toBe(false);
    expect(await verifyClaimCode(code, 'garbage')).toBe(false);
    await expect(hashClaimCode('short')).rejects.toThrow(RangeError);
  });
});
