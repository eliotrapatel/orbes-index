import { describe, expect, it } from 'vitest';
import { crc16 } from '../../src/core/ecc/crc16.js';

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Independent bit-serial reference of CRC-16/CCITT-FALSE. */
function referenceCrc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      const feedback = ((crc >> 15) ^ (byte >> bit)) & 1;
      crc = (crc << 1) & 0xffff;
      if (feedback) crc ^= 0x1021;
    }
  }
  return crc;
}

/** Deterministic PRNG (mulberry32). */
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

describe('crc16 (CRC-16/CCITT-FALSE)', () => {
  it('has the catalogue check value 0x29B1 for "123456789"', () => {
    expect(crc16(ascii('123456789'))).toBe(0x29b1);
  });

  it('returns the initial value for empty input and known values for short input', () => {
    expect(crc16(new Uint8Array(0))).toBe(0xffff);
    expect(crc16(ascii('A'))).toBe(0xb915);
  });

  it('matches a bit-serial reference on random data', () => {
    const next = mulberry32(0xc0c0);
    for (let i = 0; i < 300; i++) {
      const data = Uint8Array.from({ length: next() % 200 }, () => next() & 0xff);
      expect(crc16(data)).toBe(referenceCrc16(data));
    }
  });

  it('detects every 1- and 2-bit error in a 79-byte CODE-01 data frame', () => {
    const next = mulberry32(0xf4a3e);
    const message = Uint8Array.from({ length: 77 }, () => next() & 0xff);
    const crc = crc16(message);
    const frame = new Uint8Array(79);
    frame.set(message);
    frame[77] = crc >>> 8;
    frame[78] = crc & 0xff;
    const isValid = (f: Uint8Array): boolean => crc16(f.subarray(0, 77)) === ((f[77] << 8) | f[78]);
    expect(isValid(frame)).toBe(true);

    const bits = frame.length * 8;
    let undetected = 0;
    for (let i = 0; i < bits; i++) {
      frame[i >> 3] ^= 0x80 >> (i & 7);
      if (isValid(frame)) undetected++;
      for (let j = i + 1; j < bits; j++) {
        frame[j >> 3] ^= 0x80 >> (j & 7);
        if (isValid(frame)) undetected++;
        frame[j >> 3] ^= 0x80 >> (j & 7);
      }
      frame[i >> 3] ^= 0x80 >> (i & 7);
    }
    expect(undetected).toBe(0);
  });
});
