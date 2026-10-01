/**
 * Adaptive mean thresholding (Bradley-Roth): a pixel is ink when it is
 * clearly darker than the mean of the window around it — or, for light ink
 * on a dark substrate, clearly lighter. Used only to FIND the seal; moons,
 * alignment and cell values are measured on the gray image.
 *
 * The margin from the local mean is relative (a fraction of the mean, or of
 * its complement for light ink) with an absolute floor: it scales with
 * exposure, so sensor noise on a flat substrate does not turn into ink
 * speckles that would break run patterns, while 30 %-contrast print still
 * clears it comfortably.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { GrayImage } from './image.js';
import type { IntegralImage } from './integral.js';

/** Margin from the local mean, as a fraction of that mean (of 255 − mean for light ink). */
const RELATIVE_MARGIN = 0.1;
/** Absolute margin floor (gray levels), for very dark or very bright frames. */
const MIN_MARGIN = 4;

/**
 * 1 = ink, 0 = substrate. `window` is the box side in pixels; `lightInk`
 * selects light-on-dark polarity. The comparison is done on window sums
 * (v · area against a threshold sum), and interior pixels, whose window is
 * never clipped, take a branch-free fast path: this loop runs over every
 * pixel of every frame, several times.
 */
export function binarize(img: GrayImage, ii: IntegralImage, window: number, lightInk = false): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const half = Math.max(1, Math.floor(window / 2));
  const s = w + 1;
  const { sums } = ii;
  const keep = 1 - RELATIVE_MARGIN;
  // Interior columns: the window [x − half, x + half] lies inside the image.
  const xa = Math.min(w, half);
  const xb = Math.max(xa, w - half - 1);
  for (let y = 0; y < h; y++) {
    const y0 = y - half < 0 ? 0 : y - half;
    const y1 = y + half + 1 > h ? h : y + half + 1;
    const r0 = y0 * s;
    const r1 = y1 * s;
    const rows = y1 - y0;
    const base = y * w;
    const classify = (x: number, x0: number, x1: number): number => {
      const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
      const area = rows * (x1 - x0);
      const v = data[base + x] * area;
      if (lightInk) {
        // v > mean + max(k·(255 − mean), floor)
        const room = 255 * area - sum;
        return v > sum + Math.max(RELATIVE_MARGIN * room, MIN_MARGIN * area) ? 1 : 0;
      }
      // v < mean − max(k·mean, floor)
      return v < Math.min(keep * sum, sum - MIN_MARGIN * area) ? 1 : 0;
    };
    for (let x = 0; x < xa; x++) out[base + x] = classify(x, 0, Math.min(w, x + half + 1));
    const area = rows * (2 * half + 1);
    const floor = MIN_MARGIN * area;
    if (lightInk) {
      const full = 255 * area;
      for (let x = xa; x < xb; x++) {
        const x0 = x - half;
        const x1 = x + half + 1;
        const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
        const margin = RELATIVE_MARGIN * (full - sum);
        out[base + x] = data[base + x] * area > sum + (margin > floor ? margin : floor) ? 1 : 0;
      }
    } else {
      for (let x = xa; x < xb; x++) {
        const x0 = x - half;
        const x1 = x + half + 1;
        const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
        const t = keep * sum;
        const u = sum - floor;
        out[base + x] = data[base + x] * area < (t < u ? t : u) ? 1 : 0;
      }
    }
    for (let x = xb; x < w; x++) out[base + x] = classify(x, Math.max(0, x - half), Math.min(w, x + half + 1));
  }
  return out;
}
