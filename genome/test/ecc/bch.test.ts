import { describe, expect, it } from 'vitest';
import { FORMAT_GENERATOR, FORMAT_XOR_MASK, bchFormatDecode, bchFormatEncode } from '../../src/core/ecc/bch.js';

/**
 * QR Code format information words for 5-bit values 0..31 (ISO/IEC 18004
 * Annex C; same table as ZXing's FORMAT_INFO_DECODE_LOOKUP).
 */
const QR_FORMAT_WORDS = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0, 0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318,
  0x6c41, 0x6976, 0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b, 0x355f, 0x3068, 0x3f31, 0x3a06,
  0x24b4, 0x2183, 0x2eda, 0x2bed,
];

function popcount(x: number): number {
  let n = 0;
  for (let w = x; w !== 0; w &= w - 1) n++;
  return n;
}

/** Polynomial remainder over GF(2). */
function mod2(dividend: number, divisor: number): number {
  const divisorDegree = 31 - Math.clz32(divisor);
  let r = dividend;
  while (r !== 0 && 31 - Math.clz32(r) >= divisorDegree) r ^= divisor << (31 - Math.clz32(r) - divisorDegree);
  return r;
}

/** All 15-bit masks of weight ≤ 3 (1 + 15 + 105 + 455 = 576 patterns). */
const ERROR_PATTERNS: readonly number[] = (() => {
  const out = [0];
  for (let a = 0; a < 15; a++) {
    out.push(1 << a);
    for (let b = a + 1; b < 15; b++) {
      out.push((1 << a) | (1 << b));
      for (let c = b + 1; c < 15; c++) out.push((1 << a) | (1 << b) | (1 << c));
    }
  }
  return out;
})();

describe('BCH(15,5) format word', () => {
  it('uses the QR generator and mask', () => {
    expect(FORMAT_GENERATOR).toBe(0x537);
    expect(FORMAT_XOR_MASK).toBe(0x5412);
  });

  it('matches the published QR format information table for all 32 values', () => {
    expect(Array.from({ length: 32 }, (_, v) => bchFormatEncode(v))).toEqual(QR_FORMAT_WORDS);
  });

  it('produces systematic words divisible by the generator once unmasked', () => {
    for (let v = 0; v < 32; v++) {
      const unmasked = bchFormatEncode(v) ^ FORMAT_XOR_MASK;
      expect(unmasked >> 10).toBe(v);
      expect(mod2(unmasked, FORMAT_GENERATOR)).toBe(0);
    }
  });

  it('has minimum distance 7 and no all-zero or all-one word', () => {
    let min = Infinity;
    for (let a = 0; a < 32; a++) {
      for (let b = a + 1; b < 32; b++) min = Math.min(min, popcount(bchFormatEncode(a) ^ bchFormatEncode(b)));
      expect(bchFormatEncode(a)).not.toBe(0);
      expect(bchFormatEncode(a)).not.toBe(0x7fff);
    }
    expect(min).toBe(7);
  });

  it('corrects every error pattern of weight ≤ 3 on every value (exhaustive)', () => {
    expect(ERROR_PATTERNS).toHaveLength(576);
    for (let v = 0; v < 32; v++) {
      const word = bchFormatEncode(v);
      for (const pattern of ERROR_PATTERNS) {
        const result = bchFormatDecode(word ^ pattern);
        const weight = popcount(pattern);
        if (result.value !== v || result.distance !== weight || result.secondDistance < 7 - weight) {
          expect.fail(`value ${v}, pattern 0x${pattern.toString(16)}: ${JSON.stringify(result)}`);
        }
      }
    }
  });

  it('reports exact nearest and runner-up distances for every 15-bit word', () => {
    for (let w = 0; w <= 0x7fff; w++) {
      const distances = Array.from({ length: 32 }, (_, v) => popcount(w ^ bchFormatEncode(v)));
      const sorted = [...distances].sort((a, b) => a - b);
      const result = bchFormatDecode(w);
      if (
        result.distance !== sorted[0] ||
        result.secondDistance !== sorted[1] ||
        result.value !== distances.indexOf(sorted[0])
      ) {
        expect.fail(`word 0x${w.toString(16)}: ${JSON.stringify(result)}`);
      }
    }
  });

  it('exposes ties instead of hiding them, resolving to the lowest value', () => {
    // Codewords 8 bits apart have words at distance 4 from both: a 4-bit
    // corruption can be undecidable, and the caller must be able to see that.
    const a = bchFormatEncode(0);
    const b = Array.from({ length: 32 }, (_, v) => bchFormatEncode(v)).find((w) => popcount(w ^ a) === 8);
    expect(b).toBeDefined();
    const diff = a ^ (b as number);
    let halfway = 0;
    for (let bit = 0, taken = 0; taken < 4; bit++) {
      if (diff & (1 << bit)) {
        halfway |= 1 << bit;
        taken++;
      }
    }
    const result = bchFormatDecode(a ^ halfway);
    expect(result).toEqual({ value: 0, distance: 4, secondDistance: 4 });
  });

  it('rejects out-of-range inputs', () => {
    for (const v of [-1, 32, 1.5, Number.NaN]) expect(() => bchFormatEncode(v)).toThrow(RangeError);
    for (const w of [-1, 0x8000, 0.5, Number.NaN]) expect(() => bchFormatDecode(w)).toThrow(RangeError);
  });
});
