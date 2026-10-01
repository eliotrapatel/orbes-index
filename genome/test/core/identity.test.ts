import { describe, expect, it } from 'vitest';
import {
  IdentityError,
  formatProductId,
  packIdentity,
  parseProductId,
  staticCategoryResolver,
  unpackIdentity,
  type CategoryInfo,
  type ProductIdentity,
} from '../../src/core/identity.js';

/** mulberry32: small, fast, seedable; every test owns its own stream. */
function prng(seed: number): { u32(): number; int(min: number, max: number): number } {
  let a = seed >>> 0;
  const u32 = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { u32, int: (min, max) => min + (u32() % (max - min + 1)) };
}

const CATEGORIES: CategoryInfo[] = [
  { code: 'J', index: 1, name: 'Jewelry' },
  { code: 'L', index: 2, name: 'Leather goods' },
  { code: 'W', index: 7, name: 'Watches' },
  { code: 'Z', index: 31, name: 'Last index' },
];
const resolver = staticCategoryResolver(CATEGORIES);
const KNOWN_INDICES = CATEGORIES.map((c) => c.index);

const id = (year: number, categoryIndex: number, serial: number): ProductIdentity => ({ year, categoryIndex, serial });

describe('packIdentity / unpackIdentity', () => {
  it('uses the yy:7 | category:5 | serial:20 layout', () => {
    expect(packIdentity(id(2026, 1, 184))).toBe(0x341000b8);
    expect(packIdentity(id(2000, 1, 1))).toBe(0x00100001);
    expect(unpackIdentity(0x341000b8)).toEqual(id(2026, 1, 184));
  });

  it('stays an unsigned u32 when the year sets bit 31', () => {
    const packed = packIdentity(id(2099, 31, 999_999));
    expect(packed).toBe(0xc7ff423f);
    expect(packed).toBeGreaterThan(0x7fffffff);
    expect(unpackIdentity(packed)).toEqual(id(2099, 31, 999_999));
  });

  it.each([
    ['year 1999', id(1999, 1, 1)],
    ['year 2100', id(2100, 1, 1)],
    ['fractional year', id(2026.5, 1, 1)],
    ['category 0 (reserved)', id(2026, 0, 1)],
    ['category 32', id(2026, 32, 1)],
    ['serial 0', id(2026, 1, 0)],
    ['serial 1 000 000', id(2026, 1, 1_000_000)],
    ['negative serial', id(2026, 1, -5)],
    ['NaN serial', id(2026, 1, Number.NaN)],
    ['string serial', { year: 2026, categoryIndex: 1, serial: '184' } as unknown as ProductIdentity],
  ])('packIdentity rejects %s', (_label, bad) => {
    expect(() => packIdentity(bad)).toThrow(IdentityError);
  });

  it.each([
    ['year 2100 (yy = 100)', 100 * 2 ** 25 + (1 << 20) + 1],
    ['year 2127 (yy = 127)', 0xfe100001],
    ['category 0', 26 * 2 ** 25 + 184],
    ['serial 0', 26 * 2 ** 25 + (1 << 20)],
    ['serial 1 000 000', 26 * 2 ** 25 + (1 << 20) + 1_000_000],
    ['serial 0xFFFFF', 26 * 2 ** 25 + (1 << 20) + 0xfffff],
    ['negative', -1],
    ['above u32', 2 ** 32],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
  ])('unpackIdentity rejects %s', (_label, packed) => {
    expect(() => unpackIdentity(packed)).toThrow(IdentityError);
  });

  it('round-trips random valid identities (seeded)', () => {
    const rng = prng(0x1d3a7);
    // Injectivity on the sample: a packed value is never shared by two distinct identities.
    const identityByPacked = new Map<number, string>();
    for (let i = 0; i < 5000; i++) {
      const original = id(rng.int(2000, 2099), rng.int(1, 31), rng.int(1, 999_999));
      const packed = packIdentity(original);
      expect(Number.isInteger(packed) && packed >= 0 && packed <= 0xffffffff).toBe(true);
      expect(unpackIdentity(packed)).toEqual(original);
      const key = JSON.stringify(original);
      expect(identityByPacked.get(packed) ?? key).toBe(key);
      identityByPacked.set(packed, key);
    }
  });

  it('every u32 either unpacks to an identity that packs back to it, or is rejected (seeded)', () => {
    const rng = prng(0xbadc0de);
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const packed = rng.u32();
      let unpacked: ProductIdentity | undefined;
      try {
        unpacked = unpackIdentity(packed);
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityError);
        continue;
      }
      accepted++;
      expect(packIdentity(unpacked)).toBe(packed);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

describe('formatProductId', () => {
  it('formats the canonical text form with ≥ 5 serial digits', () => {
    expect(formatProductId(id(2026, 1, 184), resolver)).toBe('O26-J-00184');
    expect(formatProductId(id(2000, 2, 1), resolver)).toBe('O00-L-00001');
    expect(formatProductId(id(2009, 7, 99_999), resolver)).toBe('O09-W-99999');
    expect(formatProductId(id(2099, 31, 100_000), resolver)).toBe('O99-Z-100000');
    expect(formatProductId(id(2099, 31, 999_999), resolver)).toBe('O99-Z-999999');
  });

  it('rejects a category index the resolver does not know', () => {
    expect(() => formatProductId(id(2026, 3, 184), resolver)).toThrow(IdentityError);
  });

  it('rejects a resolver answer that does not match the requested index', () => {
    const lying = { byCode: () => undefined, byIndex: () => ({ code: 'J', index: 2, name: 'x' }) };
    expect(() => formatProductId(id(2026, 1, 184), lying)).toThrow(IdentityError);
  });

  it('rejects out-of-range identities', () => {
    expect(() => formatProductId(id(2100, 1, 1), resolver)).toThrow(IdentityError);
    expect(() => formatProductId(id(2026, 1, 0), resolver)).toThrow(IdentityError);
  });
});

describe('parseProductId', () => {
  it('parses canonical ids', () => {
    expect(parseProductId('O26-J-00184', resolver)).toEqual(id(2026, 1, 184));
    expect(parseProductId('O00-L-00001', resolver)).toEqual(id(2000, 2, 1));
    expect(parseProductId('O99-Z-999999', resolver)).toEqual(id(2099, 31, 999_999));
    expect(parseProductId('O26-W-100000', resolver)).toEqual(id(2026, 7, 100_000));
  });

  it.each([
    ['lowercase prefix', 'o26-J-00184'],
    ['lowercase category', 'O26-j-00184'],
    ['leading space', ' O26-J-00184'],
    ['trailing space', 'O26-J-00184 '],
    ['trailing newline', 'O26-J-00184\n'],
    ['inner space', 'O26 -J-00184'],
    ['missing zero padding', 'O26-J-184'],
    ['4-digit serial', 'O26-J-0184'],
    ['non-canonical 6-digit serial', 'O26-J-000184'],
    ['7-digit serial (> 999 999)', 'O26-J-1000000'],
    ['serial 0', 'O26-J-00000'],
    ['serial 0 in 6 digits', 'O26-J-000000'],
    ['unknown category', 'O26-A-00184'],
    ['4-digit year', 'O2026-J-00184'],
    ['1-digit year', 'O6-J-00184'],
    ['fullwidth digits', 'O２６-J-00184'],
    ['en dash separator', 'O26–J-00184'],
    ['underscore separator', 'O26_J_00184'],
    ['two-letter category', 'O26-JJ-00184'],
    ['digit category', 'O26-1-00184'],
    ['zero instead of O', '026-J-00184'],
    ['empty string', ''],
  ])('rejects %s', (_label, s) => {
    expect(() => parseProductId(s, resolver)).toThrow(IdentityError);
  });

  it('rejects non-string input', () => {
    expect(() => parseProductId(26184 as unknown as string, resolver)).toThrow(IdentityError);
    expect(() => parseProductId(null as unknown as string, resolver)).toThrow(IdentityError);
  });

  it('round-trips format → parse → format for random identities (seeded)', () => {
    const rng = prng(0x5eed);
    for (let i = 0; i < 3000; i++) {
      const original = id(rng.int(2000, 2099), KNOWN_INDICES[rng.int(0, KNOWN_INDICES.length - 1)], rng.int(1, 999_999));
      const text = formatProductId(original, resolver);
      expect(text).toMatch(/^O\d{2}-[A-Z]-\d{5,6}$/);
      const parsed = parseProductId(text, resolver);
      expect(parsed).toEqual(original);
      expect(formatProductId(parsed, resolver)).toBe(text);
    }
  });
});

describe('staticCategoryResolver', () => {
  it('resolves by code and by index', () => {
    expect(resolver.byCode('L')).toEqual({ code: 'L', index: 2, name: 'Leather goods' });
    expect(resolver.byIndex(31)?.code).toBe('Z');
    expect(resolver.byCode('A')).toBeUndefined();
    expect(resolver.byIndex(3)).toBeUndefined();
  });

  it('is isolated from later mutation of the input list', () => {
    const list: CategoryInfo[] = [{ code: 'J', index: 1, name: 'Jewelry' }];
    const r = staticCategoryResolver(list);
    list[0].index = 9;
    expect(r.byCode('J')?.index).toBe(1);
    expect(Object.isFrozen(r.byCode('J'))).toBe(true);
  });

  it.each([
    ['duplicate code', [{ code: 'J', index: 1, name: 'a' }, { code: 'J', index: 2, name: 'b' }]],
    ['duplicate index', [{ code: 'J', index: 1, name: 'a' }, { code: 'L', index: 1, name: 'b' }]],
    ['index 0', [{ code: 'J', index: 0, name: 'a' }]],
    ['index 32', [{ code: 'J', index: 32, name: 'a' }]],
    ['two-letter code', [{ code: 'JW', index: 1, name: 'a' }]],
    ['lowercase code', [{ code: 'j', index: 1, name: 'a' }]],
    ['empty code', [{ code: '', index: 1, name: 'a' }]],
  ])('rejects %s', (_label, list) => {
    expect(() => staticCategoryResolver(list)).toThrow(IdentityError);
  });
});

describe('IdentityError', () => {
  it('is a named Error subclass', () => {
    const err = new IdentityError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IdentityError');
  });
});
