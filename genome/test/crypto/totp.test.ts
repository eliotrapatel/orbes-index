import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  totpCounter,
  totpUri,
  verifyTotp,
  type TotpAlgorithm,
} from '../../src/server/crypto/totp.js';
import { deriveSubkey, open, openText, seal, SecretboxError } from '../../src/server/crypto/secretbox.js';

const ascii = (s: string) => new Uint8Array(Buffer.from(s, 'ascii'));

// RFC 6238 Appendix B seeds: the SHA-256/512 seeds are the SHA-1 seed repeated to the hash block size.
const SEEDS: Record<TotpAlgorithm, Uint8Array> = {
  SHA1: ascii('12345678901234567890'),
  SHA256: ascii('12345678901234567890123456789012'),
  SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};

// RFC 6238 Appendix B: [Unix seconds, SHA1, SHA256, SHA512], 8 digits.
const RFC6238: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('HOTP (RFC 4226)', () => {
  it('matches the Appendix D test values', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(SEEDS.SHA1, counter)).toBe(code));
  });

  it('rejects invalid parameters', () => {
    expect(() => hotp(SEEDS.SHA1, -1)).toThrow(RangeError);
    expect(() => hotp(SEEDS.SHA1, 1.5)).toThrow(RangeError);
    expect(() => hotp(new Uint8Array(0), 1)).toThrow(RangeError);
    expect(() => hotp(SEEDS.SHA1, 1, { digits: 5 })).toThrow(RangeError);
    expect(() => hotp(SEEDS.SHA1, 1, { digits: 9 })).toThrow(RangeError);
    expect(() => hotp(SEEDS.SHA1, 1, { algorithm: 'MD5' as TotpAlgorithm })).toThrow(RangeError);
  });
});

describe('TOTP (RFC 6238)', () => {
  for (const [t, sha1, sha256, sha512] of RFC6238) {
    it(`matches Appendix B at T=${t}`, () => {
      expect(totp(SEEDS.SHA1, t * 1000, { digits: 8 })).toBe(sha1);
      expect(totp(SEEDS.SHA256, t * 1000, { digits: 8, algorithm: 'SHA256' })).toBe(sha256);
      expect(totp(SEEDS.SHA512, t * 1000, { digits: 8, algorithm: 'SHA512' })).toBe(sha512);
    });
  }

  it('6-digit codes are the last 6 digits of the 8-digit truncation (same 31-bit value, mod 10^6)', () => {
    expect(totp(SEEDS.SHA1, 59_000)).toBe('287082');
    for (const [t, sha1] of RFC6238) expect(totp(SEEDS.SHA1, t * 1000)).toBe(sha1.slice(2));
  });

  it('steps every 30 seconds', () => {
    expect(totpCounter(0)).toBe(0);
    expect(totpCounter(29_999)).toBe(0);
    expect(totpCounter(30_000)).toBe(1);
    expect(totpCounter(59_000)).toBe(1);
    expect(totp(SEEDS.SHA1, 30_000)).toBe(totp(SEEDS.SHA1, 59_999));
    expect(totp(SEEDS.SHA1, 59_999)).not.toBe(totp(SEEDS.SHA1, 60_000));
  });

  it('verifies with ±1 step of drift and reports the matched counter', () => {
    const t = 1_234_567_890_000;
    const c = totpCounter(t);
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t), t)).toEqual({ ok: true, counter: c });
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t - 30_000), t)).toEqual({ ok: true, counter: c - 1 });
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t + 30_000), t)).toEqual({ ok: true, counter: c + 1 });
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t - 60_000), t)).toEqual({ ok: false });
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t + 60_000), t)).toEqual({ ok: false });
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t - 60_000), t, { window: 2 }).ok).toBe(true);
    expect(verifyTotp(SEEDS.SHA1, totp(SEEDS.SHA1, t - 30_000), t, { window: 0 }).ok).toBe(false);
  });

  it('refuses codes at or before the last used counter (replay)', () => {
    const t = 1_700_000_000_000;
    const code = totp(SEEDS.SHA1, t);
    const first = verifyTotp(SEEDS.SHA1, code, t);
    expect(first.ok).toBe(true);
    const counter = (first as { counter: number }).counter;
    expect(verifyTotp(SEEDS.SHA1, code, t, { afterCounter: counter })).toEqual({ ok: false });
    expect(verifyTotp(SEEDS.SHA1, code, t, { afterCounter: counter - 1 }).ok).toBe(true);
  });

  it('rejects malformed submissions without throwing', () => {
    const t = 59_000;
    for (const bad of [undefined, null, 287082, '', '28708', '2870820', 'abcdef', '28708a', '287 08']) {
      expect(verifyTotp(SEEDS.SHA1, bad, t)).toEqual({ ok: false });
    }
    // Spaces between digit groups are a common way to type codes.
    expect(verifyTotp(SEEDS.SHA1, '287 082', t).ok).toBe(true);
  });

  it('rejects invalid verify options', () => {
    expect(() => verifyTotp(SEEDS.SHA1, '000000', 59_000, { window: 11 })).toThrow(RangeError);
    expect(() => totpCounter(Number.NaN)).toThrow(RangeError);
    expect(() => totpCounter(-31_000)).toThrow(RangeError);
  });
});

describe('base32 and provisioning', () => {
  it('round-trips and matches RFC 4648 §10 vectors', () => {
    const vectors: [string, string][] = [
      ['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, enc] of vectors) {
      expect(base32Encode(ascii(plain))).toBe(enc);
      expect(Buffer.from(base32Decode(enc)).toString('ascii')).toBe(plain);
    }
    expect(base32Encode(SEEDS.SHA1)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodes leniently (case, spaces, hyphens, padding) but rejects foreign characters', () => {
    expect(base32Decode('mzxw 6ytb-oi======')).toEqual(ascii('foobar'));
    expect(() => base32Decode('MZXW1')).toThrow(SyntaxError);
    expect(() => base32Decode('M')).toThrow(SyntaxError);
  });

  it('generates 160-bit secrets by default', () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
    expect(() => generateTotpSecret(8)).toThrow(RangeError);
  });

  it('builds an otpauth URI with issuer, algorithm, digits and period', () => {
    const uri = totpUri({ secret: 'gezd gnbv', account: 'ops@theorbes.com' });
    expect(uri).toBe('otpauth://totp/ORBES:ops%40theorbes.com?secret=GEZDGNBV&issuer=ORBES&algorithm=SHA1&digits=6&period=30');
    expect(() => totpUri({ secret: 'not base32!', account: 'x' })).toThrow(SyntaxError);
  });
});

describe('secretbox (AES-256-GCM)', () => {
  const key = deriveSubkey('a master secret that is long enough', 'orbes/test/v1');

  it('round-trips text and bytes, with a fresh IV each time', () => {
    const a = seal(key, 'GEZDGNBVGY3TQOJQ');
    const b = seal(key, 'GEZDGNBVGY3TQOJQ');
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(openText(key, a)).toBe('GEZDGNBVGY3TQOJQ');
    expect(open(key, seal(key, Uint8Array.of(1, 2, 3)))).toEqual(Uint8Array.of(1, 2, 3));
  });

  it('binds ciphertexts to their AAD', () => {
    const sealed = seal(key, 'secret', 'admin:1');
    expect(openText(key, sealed, 'admin:1')).toBe('secret');
    expect(() => open(key, sealed, 'admin:2')).toThrow(SecretboxError);
    expect(() => open(key, sealed)).toThrow(SecretboxError);
  });

  it('fails closed on a wrong key, tampering or malformed input', () => {
    const sealed = seal(key, 'secret');
    const other = deriveSubkey('a master secret that is long enough', 'orbes/other/v1');
    expect(() => open(other, sealed)).toThrow(SecretboxError);
    const [v, iv, ct] = sealed.split('.');
    const flipped = ct.slice(0, 2) + (ct[2] === 'A' ? 'B' : 'A') + ct.slice(3);
    expect(() => open(key, `${v}.${iv}.${flipped}`)).toThrow(SecretboxError);
    for (const bad of ['', 'v1', 'v2.a.b', `v1.${iv}`, `v1.!!.${ct}`, `v1.${iv}.AAAA`, `${sealed}.x`]) {
      expect(() => open(key, bad)).toThrow(SecretboxError);
    }
    expect(() => seal(new Uint8Array(16), 'x')).toThrow(SecretboxError);
  });

  it('derives independent 32-byte subkeys per purpose', () => {
    const k1 = deriveSubkey(new Uint8Array(32).fill(7), 'a');
    const k2 = deriveSubkey(new Uint8Array(32).fill(7), 'b');
    expect(k1).toHaveLength(32);
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(false);
    expect(deriveSubkey(new Uint8Array(32).fill(7), 'a')).toEqual(k1);
    expect(() => deriveSubkey('short', 'a')).toThrow(SecretboxError);
  });
});
