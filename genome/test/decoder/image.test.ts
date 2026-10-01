import { describe, expect, it } from 'vitest';
import { binarize } from '../../src/core/decoder/binarize.js';
import { asGrayImage, downscaleImage, invertImage, rgbaToGray, sampleBilinear } from '../../src/core/decoder/image.js';
import { boxMean, integralImage, MAX_INTEGRAL_PIXELS } from '../../src/core/decoder/integral.js';
import { rgbaToGray as referenceRgbaToGray } from '../support/raster.js';
import { Prng } from '../support/prng.js';

function randomImage(seed: number, width: number, height: number) {
  const rng = new Prng(seed);
  return { width, height, data: Uint8Array.from({ length: width * height }, () => rng.int(0, 255)) };
}

describe('rgbaToGray', () => {
  it('maps neutral grays to themselves and weights channels as BT.601', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const g = rgbaToGray(rgba, 6, 1);
    expect(Array.from(g.data)).toEqual([0, 128, 255, 77, 149, 29]);
  });

  it('composites translucent pixels over white, like the test raster helper', () => {
    const rng = new Prng('rgba');
    const rgba = Uint8Array.from({ length: 4 * 64 }, () => rng.int(0, 255));
    expect(rgbaToGray(rgba, 8, 8).data).toEqual(referenceRgbaToGray(rgba, 8, 8, 255).data);
    expect(rgbaToGray(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1).data[0]).toBe(255);
  });

  it('rejects inconsistent sizes', () => {
    expect(() => rgbaToGray(new Uint8Array(12), 2, 2)).toThrow(RangeError);
    expect(() => rgbaToGray(new Uint8Array(16), -2, 2)).toThrow(RangeError);
    expect(() => rgbaToGray(new Uint8Array(16), 1.5, 2)).toThrow(RangeError);
  });
});

describe('image helpers', () => {
  it('validates image shape and views clamped or oversized buffers in place', () => {
    expect(asGrayImage({ width: 2, height: 2, data: new Uint8Array(4) })?.data.length).toBe(4);
    const clamped = new Uint8ClampedArray([1, 2, 3, 4, 5, 6]);
    const view = asGrayImage({ width: 2, height: 2, data: clamped })!;
    expect(Array.from(view.data)).toEqual([1, 2, 3, 4]);
    clamped[0] = 9;
    expect(view.data[0]).toBe(9);
    expect(asGrayImage({ width: 2, height: 2, data: new Uint8Array(3) })).toBeNull();
    expect(asGrayImage({ width: 0, height: 2, data: new Uint8Array(4) })).toBeNull();
    expect(asGrayImage({ width: 2.5, height: 2, data: new Uint8Array(6) })).toBeNull();
    expect(asGrayImage({ width: 2, height: 2, data: [1, 2, 3, 4] })).toBeNull();
    expect(asGrayImage(null)).toBeNull();
    expect(asGrayImage('image')).toBeNull();
  });

  it('samples bilinearly with pixel centres at +0.5 and clamps at the border', () => {
    const img = { width: 2, height: 2, data: new Uint8Array([0, 100, 200, 40]) };
    expect(sampleBilinear(img, 0.5, 0.5)).toBe(0);
    expect(sampleBilinear(img, 1.5, 0.5)).toBe(100);
    expect(sampleBilinear(img, 1, 0.5)).toBe(50);
    expect(sampleBilinear(img, 1, 1)).toBe(85);
    expect(sampleBilinear(img, -10, -10)).toBe(0);
    expect(sampleBilinear(img, 10, 10)).toBe(40);
  });

  it('inverts and area-downscales', () => {
    const img = randomImage(1, 6, 4);
    expect(invertImage(invertImage(img)).data).toEqual(img.data);
    const small = downscaleImage(img, 2);
    expect([small.width, small.height]).toEqual([3, 2]);
    const d = img.data;
    expect(small.data[0]).toBe(Math.round((d[0] + d[1] + d[6] + d[7]) / 4));
  });
});

describe('integral image', () => {
  it('gives exact box means, clipped to the image', () => {
    const img = randomImage(2, 37, 23);
    const ii = integralImage(img);
    const rng = new Prng('boxes');
    for (let t = 0; t < 200; t++) {
      const x0 = rng.int(-5, 36);
      const y0 = rng.int(-5, 22);
      const x1 = x0 + rng.int(1, 20);
      const y1 = y0 + rng.int(1, 20);
      let sum = 0;
      let n = 0;
      for (let y = Math.max(0, y0); y < Math.min(23, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(37, x1); x++) {
          sum += img.data[y * 37 + x];
          n++;
        }
      }
      if (n === 0) expect(boxMean(ii, x0, y0, x1, y1)).toBeNaN();
      else expect(boxMean(ii, x0, y0, x1, y1)).toBeCloseTo(sum / n, 9);
    }
  });

  it('refuses images whose sum could overflow 32 bits', () => {
    expect(() => integralImage({ width: MAX_INTEGRAL_PIXELS + 1, height: 1, data: new Uint8Array(0) })).toThrow(RangeError);
  });
});

describe('binarize', () => {
  it('marks pixels clearly darker (or lighter) than their surroundings', () => {
    const w = 64;
    const img = { width: w, height: w, data: new Uint8Array(w * w).fill(200) };
    img.data[32 * w + 32] = 60; // dark dot
    img.data[10 * w + 10] = 250; // light dot
    img.data[50 * w + 50] = 190; // within the margin: substrate
    const ii = integralImage(img);
    const dark = binarize(img, ii, 15);
    const light = binarize(img, ii, 15, true);
    expect(dark[32 * w + 32]).toBe(1);
    expect(dark[50 * w + 50]).toBe(0);
    expect(dark.reduce((s, v) => s + v, 0)).toBe(1);
    expect(light[10 * w + 10]).toBe(1);
    expect(light.reduce((s, v) => s + v, 0)).toBe(1);
  });

  it('agrees with a direct window computation, borders included', () => {
    const img = randomImage(3, 40, 30);
    const ii = integralImage(img);
    for (const lightInk of [false, true]) {
      const bin = binarize(img, ii, 9, lightInk);
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 40; x++) {
          const mean = boxMean(ii, x - 4, y - 4, x + 5, y + 5);
          const v = img.data[y * 40 + x];
          const expected = lightInk ? v > mean + Math.max(0.1 * (255 - mean), 4) : v < mean - Math.max(0.1 * mean, 4);
          expect(bin[y * 40 + x], `(${x}, ${y}) light=${lightInk}`).toBe(expected ? 1 : 0);
        }
      }
    }
  });
});
