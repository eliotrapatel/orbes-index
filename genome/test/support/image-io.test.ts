import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeJpeg, encodeJpegFast, jpegLumaTable, readImage, writeJpeg, writePng } from './image-io.js';
import { Prng } from './prng.js';
import { createGray, meanAbsDiff, type GrayImage } from './raster.js';

const dir = mkdtempSync(join(tmpdir(), 'orbes-image-io-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Camera-like test image: concentric rings (edges at every angle) plus mild seeded noise. */
function ringsImage(width: number, height: number, seed: number): GrayImage {
  const img = createGray(width, height);
  const rng = new Prng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ring = Math.floor(Math.hypot(x - width / 2, y - height / 2) / 9) % 2;
      img.data[y * width + x] = Math.max(0, Math.min(255, Math.round((ring ? 215 : 35) + rng.normal(0, 3))));
    }
  }
  return img;
}

describe('PNG', () => {
  it('writes 8-bit grayscale and reads it back losslessly', () => {
    const img = ringsImage(61, 37, 1);
    const path = join(dir, 'nested', 'rings.png');
    writePng(path, img);
    const bytes = readFileSync(path);
    expect(bytes.readUInt32BE(0)).toBe(0x89504e47);
    expect(bytes[24]).toBe(8); // IHDR bit depth
    expect(bytes[25]).toBe(0); // IHDR colour type: grayscale
    expect(readImage(path)).toEqual(img);
  });
});

describe('JPEG', () => {
  it('writes and reads JPEG files', () => {
    const img = ringsImage(64, 48, 2);
    const path = join(dir, 'rings.jpg');
    writeJpeg(path, img, 95);
    const back = readImage(path);
    expect([back.width, back.height]).toEqual([64, 48]);
    expect(meanAbsDiff(back, img)).toBeLessThan(3);
  });

  it('rejects files that are neither PNG nor JPEG', () => {
    const path = join(dir, 'junk.bin');
    writeFileSync(path, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(() => readImage(path)).toThrow(/not a PNG or JPEG/);
  });

  it('encodeJpeg round-trips through jpeg-js with quality-dependent loss', () => {
    const img = ringsImage(96, 80, 3);
    const errors = [95, 75, 40, 10].map((q) => meanAbsDiff(encodeJpeg(img, q), img));
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeGreaterThan(errors[i - 1]);
    expect(errors[0]).toBeLessThan(2.5);
    expect(() => encodeJpeg(img, 0)).toThrow(RangeError);
  });

  it('uses the IJG-scaled Annex K luminance table', () => {
    expect([...jpegLumaTable(50).slice(0, 8)]).toEqual([16, 11, 10, 16, 24, 40, 51, 61]);
    expect([...jpegLumaTable(100)].every((q) => q === 1)).toBe(true);
    expect(jpegLumaTable(10)[0]).toBe(80); // 16 · 500 %
  });

  it('encodeJpegFast reproduces the jpeg-js round trip', () => {
    // Odd size: exercises partial edge blocks.
    const img = ringsImage(203, 117, 4);
    for (const q of [90, 75, 50, 20]) {
      const exact = encodeJpeg(img, q);
      const fast = encodeJpegFast(img, q);
      expect(meanAbsDiff(fast, exact)).toBeLessThan(0.3);
      // Same artifact strength, not merely a similar image.
      expect(Math.abs(meanAbsDiff(fast, img) - meanAbsDiff(exact, img))).toBeLessThan(0.1);
    }
  });

  it('encodeJpegFast keeps flat images flat, with the same DC quantisation as jpeg-js', () => {
    const flat = createGray(40, 24, 173);
    const fast = encodeJpegFast(flat, 30);
    expect(new Set(fast.data).size).toBe(1);
    expect(fast).toEqual(encodeJpeg(flat, 30));
  });
});
