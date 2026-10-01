/**
 * Adaptive mean thresholding (Bradley-Roth): a pixel is ink when it is
 * clearly darker than the mean of the window around it. Used only to FIND
 * the seal; moons, alignment and cell values are measured on the gray image.
 *
 * The margin below the local mean is relative (a fraction of the mean) with
 * an absolute floor: it scales with exposure, so sensor noise on a flat
 * substrate does not turn into ink speckles that would break run patterns,
 * while 30 %-contrast print still clears it comfortably.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { GrayImage } from './image.js';
import type { IntegralImage } from './integral.js';

/** Margin below the local mean, as a fraction of that mean. */
const RELATIVE_MARGIN = 0.1;
/** Absolute margin floor (gray levels), for very dark frames. */
const MIN_MARGIN = 4;

/** 1 = ink (darker than its surroundings), 0 = substrate. `window` is the box side in pixels. */
export function binarize(img: GrayImage, ii: IntegralImage, window: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const half = Math.max(1, Math.floor(window / 2));
  const s = w + 1;
  const { sums } = ii;
  for (let y = 0; y < h; y++) {
    const y0 = y - half < 0 ? 0 : y - half;
    const y1 = y + half + 1 > h ? h : y + half + 1;
    const r0 = y0 * s;
    const r1 = y1 * s;
    const rows = y1 - y0;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x - half < 0 ? 0 : x - half;
      const x1 = x + half + 1 > w ? w : x + half + 1;
      const mean = (sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0]) / (rows * (x1 - x0));
      const margin = mean * RELATIVE_MARGIN;
      out[base + x] = data[base + x] < mean - (margin > MIN_MARGIN ? margin : MIN_MARGIN) ? 1 : 0;
    }
  }
  return out;
}
