import { describe, expect, it } from 'vitest';
import { GF256_PRIMITIVE_POLY, gfDiv, gfExp, gfInv, gfLog, gfMul } from '../../src/core/ecc/gf256.js';

/** Independent reference: shift-and-add multiplication reduced by 0x11D, no tables. */
function referenceMul(a: number, b: number): number {
  let product = 0;
  for (let x = a, y = b; y !== 0; y >>= 1) {
    if (y & 1) product ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return product;
}

describe('GF(256) over 0x11D', () => {
  it('uses the QR Code primitive polynomial', () => {
    expect(GF256_PRIMITIVE_POLY).toBe(0x11d);
  });

  it('α = 2 is primitive: its powers enumerate all 255 non-zero elements', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 255; i++) seen.add(gfExp(i));
    expect(seen.size).toBe(255);
    expect(seen.has(0)).toBe(false);
    expect(gfExp(0)).toBe(1);
    expect(gfExp(1)).toBe(2);
    expect(gfExp(8)).toBe(0x1d); // α^8 = x^4 + x^3 + x^2 + 1
    expect(gfExp(255)).toBe(1);
  });

  it('exp reduces any integer exponent modulo 255', () => {
    for (let e = -600; e <= 600; e++) expect(gfExp(e)).toBe(gfExp(((e % 255) + 255) % 255));
    expect(gfMul(gfExp(-1), 2)).toBe(1);
  });

  it('log inverts exp on the whole field', () => {
    for (let i = 0; i < 255; i++) expect(gfLog(gfExp(i))).toBe(i);
    for (let a = 1; a < 256; a++) expect(gfExp(gfLog(a))).toBe(a);
  });

  it('multiplication matches a table-free reference for all 65 536 pairs', () => {
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        if (gfMul(a, b) !== referenceMul(a, b)) expect.fail(`gfMul(${a}, ${b})`);
      }
    }
  });

  it('division undoes multiplication and every non-zero element has an inverse', () => {
    for (let a = 0; a < 256; a++) {
      for (let b = 1; b < 256; b++) {
        if (gfDiv(gfMul(a, b), b) !== a) expect.fail(`gfDiv(gfMul(${a}, ${b}), ${b})`);
      }
    }
    for (let a = 1; a < 256; a++) {
      expect(gfMul(a, gfInv(a))).toBe(1);
      expect(gfDiv(1, a)).toBe(gfInv(a));
    }
  });

  it('distributes over addition (XOR)', () => {
    for (let a = 0; a < 256; a += 7) {
      for (let b = 0; b < 256; b += 3) {
        for (let c = 0; c < 256; c += 11) {
          if (gfMul(a, b ^ c) !== (gfMul(a, b) ^ gfMul(a, c))) expect.fail(`distributivity ${a},${b},${c}`);
        }
      }
    }
  });

  it('throws RangeError for operations undefined at zero', () => {
    expect(() => gfDiv(5, 0)).toThrow(RangeError);
    expect(() => gfInv(0)).toThrow(RangeError);
    expect(() => gfLog(0)).toThrow(RangeError);
    expect(gfDiv(0, 7)).toBe(0);
  });
});
