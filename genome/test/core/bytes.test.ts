import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  equalBytes,
  fromBase64Url,
  fromHex,
  readU16BE,
  readU32BE,
  toBase64Url,
  toHex,
  utf8,
  writeU16BE,
  writeU32BE,
} from '../../src/core/bytes.js';

/** Deterministic PRNG (mulberry32) so random round trips are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function randomBytes(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => next() & 0xff);
}

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('concatBytes', () => {
  it('concatenates in order, including empty parts', () => {
    expect(concatBytes(bytes(1, 2), new Uint8Array(0), bytes(3), bytes(4, 5))).toEqual(bytes(1, 2, 3, 4, 5));
  });

  it('returns an empty array for no parts and a fresh copy for one part', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0));
    const part = bytes(9, 8);
    const out = concatBytes(part);
    out[0] = 0;
    expect(part).toEqual(bytes(9, 8));
  });

  it('copies the visible window of subarray views only', () => {
    const backing = bytes(0, 1, 2, 3, 4);
    expect(concatBytes(backing.subarray(1, 3), backing.subarray(4))).toEqual(bytes(1, 2, 4));
  });
});

describe('hex', () => {
  it('encodes lowercase with two digits per byte', () => {
    expect(toHex(bytes(0x00, 0x0f, 0xa5, 0xff))).toBe('000fa5ff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  it('round-trips all 256 byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromHex(toHex(all))).toEqual(all);
  });

  it('accepts either case', () => {
    expect(fromHex('DEADbeef')).toEqual(bytes(0xde, 0xad, 0xbe, 0xef));
    expect(fromHex('')).toEqual(new Uint8Array(0));
  });

  it.each(['0', 'abc', '0g', 'g0', ' 00', '00 ', '0x00', '+1', '-1', 'zz', '0\n', '００', 'é0'])(
    'rejects %j',
    (s) => {
      expect(() => fromHex(s)).toThrow(SyntaxError);
    },
  );

  it('rejects characters adjacent to the digit and letter ranges', () => {
    for (const c of ['/', ':', '@', 'G', '`', 'g']) expect(() => fromHex(`0${c}`)).toThrow(SyntaxError);
  });

  it('round-trips random buffers', () => {
    const next = mulberry32(0x0b5e);
    for (let i = 0; i < 200; i++) {
      const b = randomBytes(next, next() % 70);
      expect(fromHex(toHex(b))).toEqual(b);
    }
  });
});

describe('base64url', () => {
  // RFC 4648 §10 vectors, translated to the unpadded URL-safe form.
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('RFC 4648 vector %j ↔ %j', (text, encoded) => {
    expect(toBase64Url(utf8(text))).toBe(encoded);
    expect(fromBase64Url(encoded)).toEqual(utf8(text));
  });

  it('uses "-" and "_" in place of "+" and "/"', () => {
    expect(toBase64Url(bytes(0xfb, 0xff))).toBe('-_8');
    expect(toBase64Url(bytes(0xff, 0xff, 0xff))).toBe('____');
    expect(fromBase64Url('-_8')).toEqual(bytes(0xfb, 0xff));
  });

  it('round-trips all lengths 0..100 of random data', () => {
    const next = mulberry32(0xb64);
    for (let length = 0; length <= 100; length++) {
      const b = randomBytes(next, length);
      const encoded = toBase64Url(b);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(encoded.length).toBe(Math.ceil((length * 4) / 3));
      expect(fromBase64Url(encoded)).toEqual(b);
    }
  });

  it.each([
    ['padding', 'Zg=='],
    ['single padding', 'Zm8='],
    ['standard alphabet +', '+_8'],
    ['standard alphabet /', '-/8'],
    ['whitespace', 'Zm9v Yg'],
    ['newline', 'Zm9v\nYg'],
    ['length 4n+1', 'Zm9vY'],
    ['single character', 'A'],
    ['non-ASCII', 'Zm9é'],
    ['non-canonical trailing bits (2 bits)', 'Zh'],
    ['non-canonical trailing bits (4 bits)', 'Zm9'],
  ])('rejects %s (%j)', (_label, s) => {
    expect(() => fromBase64Url(s)).toThrow(SyntaxError);
  });

  it('accepts exactly one spelling per byte string', () => {
    // 'f' = 0x66 = 011001|10 → "Zg"; every other final character carries stray bits.
    const accepted = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'].filter((c) => {
      try {
        fromBase64Url(`Z${c}`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual(['A', 'Q', 'g', 'w']);
  });
});

describe('utf8', () => {
  it('encodes ASCII, 2-, 3- and 4-byte sequences', () => {
    expect(utf8('ORBES')).toEqual(bytes(0x4f, 0x52, 0x42, 0x45, 0x53));
    expect(utf8('é')).toEqual(bytes(0xc3, 0xa9));
    expect(utf8('€')).toEqual(bytes(0xe2, 0x82, 0xac));
    expect(utf8('😀')).toEqual(bytes(0xf0, 0x9f, 0x98, 0x80));
    expect(utf8('')).toEqual(new Uint8Array(0));
  });

  it('replaces lone surrogates with U+FFFD', () => {
    expect(utf8('\ud800')).toEqual(bytes(0xef, 0xbf, 0xbd));
  });
});

describe('equalBytes', () => {
  it('compares length and content', () => {
    expect(equalBytes(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
    expect(equalBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    expect(equalBytes(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
    expect(equalBytes(bytes(0, 2, 3), bytes(1, 2, 3))).toBe(false);
    expect(equalBytes(bytes(1, 2), bytes(1, 2, 0))).toBe(false);
  });
});

describe('big-endian integers', () => {
  it('reads and writes u16 big-endian', () => {
    const b = new Uint8Array(4);
    writeU16BE(b, 1, 0xabcd);
    expect(b).toEqual(bytes(0, 0xab, 0xcd, 0));
    expect(readU16BE(b, 1)).toBe(0xabcd);
    writeU16BE(b, 2, 0xffff);
    expect(readU16BE(b, 2)).toBe(0xffff);
  });

  it('reads and writes u32 big-endian as unsigned', () => {
    const b = new Uint8Array(6);
    writeU32BE(b, 1, 0x89abcdef);
    expect(b).toEqual(bytes(0, 0x89, 0xab, 0xcd, 0xef, 0));
    expect(readU32BE(b, 1)).toBe(0x89abcdef);
    writeU32BE(b, 2, 0xffffffff);
    expect(readU32BE(b, 2)).toBe(4294967295);
    writeU32BE(b, 0, 0);
    expect(readU32BE(b, 0)).toBe(0);
  });

  it('round-trips random values at random offsets', () => {
    const next = mulberry32(0x5eed);
    const b = new Uint8Array(16);
    for (let i = 0; i < 500; i++) {
      const v32 = next();
      const o32 = next() % 13;
      writeU32BE(b, o32, v32);
      expect(readU32BE(b, o32)).toBe(v32);
      const v16 = next() & 0xffff;
      const o16 = next() % 15;
      writeU16BE(b, o16, v16);
      expect(readU16BE(b, o16)).toBe(v16);
    }
  });

  it('throws RangeError on out-of-bounds or non-integer offsets', () => {
    const b = new Uint8Array(4);
    expect(() => readU16BE(b, 3)).toThrow(RangeError);
    expect(() => readU32BE(b, 1)).toThrow(RangeError);
    expect(() => readU32BE(b, -1)).toThrow(RangeError);
    expect(() => readU16BE(b, 0.5)).toThrow(RangeError);
    expect(() => readU16BE(b, Number.NaN)).toThrow(RangeError);
    expect(() => writeU16BE(b, 3, 1)).toThrow(RangeError);
    expect(() => writeU32BE(b, 1, 1)).toThrow(RangeError);
    expect(b).toEqual(new Uint8Array(4));
  });

  it('throws RangeError on values that do not fit', () => {
    const b = new Uint8Array(4);
    expect(() => writeU16BE(b, 0, 0x10000)).toThrow(RangeError);
    expect(() => writeU16BE(b, 0, -1)).toThrow(RangeError);
    expect(() => writeU32BE(b, 0, 0x100000000)).toThrow(RangeError);
    expect(() => writeU32BE(b, 0, -1)).toThrow(RangeError);
    expect(() => writeU32BE(b, 0, 1.5)).toThrow(RangeError);
    expect(() => writeU32BE(b, 0, Number.NaN)).toThrow(RangeError);
    expect(b).toEqual(new Uint8Array(4));
  });
});
