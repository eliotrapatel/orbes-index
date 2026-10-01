/**
 * Summed-area table: any axis-aligned box mean in O(1). Drives the adaptive
 * threshold and the moon blob filter.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { GrayImage } from './image.js';

export interface IntegralImage {
  width: number;
  height: number;
  /** (width + 1) × (height + 1); entry (x, y) = sum of pixels [0, x) × [0, y). */
  sums: Int32Array;
}

/** Largest image whose pixel sum fits a signed 32-bit table (255 · pixels < 2^31). */
export const MAX_INTEGRAL_PIXELS = Math.floor((2 ** 31 - 1) / 255);

/**
 * 32-bit entries (faster than float tables in every engine). The decoder
 * only builds tables for detection images, which it downscales well below
 * MAX_INTEGRAL_PIXELS; larger inputs are rejected rather than overflowing.
 */
export function integralImage(img: GrayImage): IntegralImage {
  const { width: w, height: h, data } = img;
  if (w * h > MAX_INTEGRAL_PIXELS) throw new RangeError(`image too large for a 32-bit summed-area table: ${w}×${h}`);
  const stride = w + 1;
  const sums = new Int32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const src = y * w;
    const above = y * stride;
    const out = above + stride;
    for (let x = 0; x < w; x++) {
      row += data[src + x];
      sums[out + x + 1] = sums[above + x + 1] + row;
    }
  }
  return { width: w, height: h, sums };
}

/**
 * Mean over the pixel box [x0, x1) × [y0, y1), clipped to the image. Returns
 * NaN when the clipped box is empty.
 */
export function boxMean(ii: IntegralImage, x0: number, y0: number, x1: number, y1: number): number {
  const ax = x0 < 0 ? 0 : x0 > ii.width ? ii.width : x0 | 0;
  const bx = x1 < 0 ? 0 : x1 > ii.width ? ii.width : x1 | 0;
  const ay = y0 < 0 ? 0 : y0 > ii.height ? ii.height : y0 | 0;
  const by = y1 < 0 ? 0 : y1 > ii.height ? ii.height : y1 | 0;
  const area = (bx - ax) * (by - ay);
  if (area <= 0) return Number.NaN;
  const s = ii.width + 1;
  const { sums } = ii;
  return (sums[by * s + bx] - sums[ay * s + bx] - sums[by * s + ax] + sums[ay * s + ax]) / area;
}
