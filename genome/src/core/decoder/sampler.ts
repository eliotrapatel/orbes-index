/**
 * Cell sampling and classification.
 *
 * Every one of the CODE-01 cells is read at its centre through the code →
 * image homography, with a small footprint (3 × 3 bilinear sub-samples within
 * ±0.2 u radially and tangentially, i.e. well inside the 0.72 u ink of an arc)
 * that averages sensor noise and JPEG ringing without reaching the gaps.
 *
 * Classification is local: each cell is compared with a threshold computed
 * by 2-means over its neighbourhood (±2 rings, ±4 u of arc, ≈ 40 cells). The
 * mask keeps every such neighbourhood near half ink, so the two clusters
 * exist and the threshold follows illumination gradients, vignetting and
 * substrate tone. A neighbourhood whose two clusters are barely apart
 * (glare, a uniform occluder) yields low confidence for its cells, which the
 * Reed-Solomon stage then treats as erasures instead of guessing.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01_RINGS, CODE01_TOTAL_CELLS, cellRef } from '../code/profile.js';
import { TAU } from '../geometry.js';
import type { Homography } from './homography.js';
import { sampleBilinear, type GrayImage } from './image.js';

export const CELL_COUNT = CODE01_TOTAL_CELLS;

/** Code-plane geometry of each cell: centre, unit radial and tangential directions, ring. */
export const CELL_GEOMETRY = (() => {
  const x = new Float64Array(CELL_COUNT);
  const y = new Float64Array(CELL_COUNT);
  const theta = new Float64Array(CELL_COUNT);
  const ring = new Uint8Array(CELL_COUNT);
  for (let flat = 0; flat < CELL_COUNT; flat++) {
    const ref = cellRef(flat);
    const spec = CODE01_RINGS[ref.ring];
    const a = ((ref.cell + 0.5) * TAU) / spec.cells;
    theta[flat] = a;
    ring[flat] = ref.ring;
    x[flat] = spec.radius * Math.sin(a);
    y[flat] = -spec.radius * Math.cos(a);
  }
  return { x, y, theta, ring };
})();

/** Neighbourhood (flat indices) of each cell used for its local threshold. */
const NEIGHBOURS: Int16Array[] = (() => {
  const RING_REACH = 2;
  const ARC_REACH = 4;
  const out: Int16Array[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const list: number[] = [];
    const ri = CELL_GEOMETRY.ring[i];
    for (let k = Math.max(0, ri - RING_REACH); k <= Math.min(CODE01_RINGS.length - 1, ri + RING_REACH); k++) {
      const spec = CODE01_RINGS[k];
      const span = ARC_REACH / spec.radius;
      for (let c = 0; c < spec.cells; c++) {
        const j = spec.offset + c;
        let d = Math.abs(CELL_GEOMETRY.theta[j] - CELL_GEOMETRY.theta[i]);
        if (d > Math.PI) d = TAU - d;
        if (d <= span) list.push(j);
      }
    }
    out.push(Int16Array.from(list));
  }
  return out;
})();

/** Optional smooth correction field: image-space offset (px) added after the homography. */
export type OffsetField = (x: number, y: number) => { dx: number; dy: number };

const FOOTPRINT = 0.2;

/**
 * Mean gray value at each cell centre (footprint 3 × 3 sub-samples when
 * `footprint` is true, else the single centre sample — used while aligning).
 */
export function sampleCells(img: GrayImage, h: Homography, footprint: boolean, field?: OffsetField, out = new Float64Array(CELL_COUNT)): Float64Array {
  const { x: cxs, y: cys, theta } = CELL_GEOMETRY;
  for (let i = 0; i < CELL_COUNT; i++) {
    const cx = cxs[i];
    const cy = cys[i];
    if (!footprint) {
      out[i] = sampleAt(img, h, cx, cy, field);
      continue;
    }
    // Radial unit vector (sin θ, −cos θ); tangential (cos θ, sin θ).
    const s = Math.sin(theta[i]);
    const c = Math.cos(theta[i]);
    let sum = 0;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const dr = a * FOOTPRINT;
        const dt = b * FOOTPRINT;
        sum += sampleAt(img, h, cx + dr * s + dt * c, cy - dr * c + dt * s, field);
      }
    }
    out[i] = sum / 9;
  }
  return out;
}

function sampleAt(img: GrayImage, h: Homography, x: number, y: number, field?: OffsetField): number {
  const w = h[6] * x + h[7] * y + h[8];
  let px = (h[0] * x + h[1] * y + h[2]) / w;
  let py = (h[3] * x + h[4] * y + h[5]) / w;
  if (field) {
    const o = field(x, y);
    px += o.dx;
    py += o.dy;
  }
  return sampleBilinear(img, px, py);
}

export interface CellClassification {
  /** 1 = ink. */
  bits: Uint8Array;
  /** 0 (unreliable) … 1 (clear). */
  confidence: Float64Array;
  /** Local threshold and cluster separation per cell. */
  threshold: Float64Array;
  contrast: Float64Array;
  /** Median local cluster separation (gray levels). */
  globalContrast: number;
}

/** 2-means split of `values` restricted to `idx`: [threshold, low mean, high mean]. */
function twoMeans(values: Float64Array, idx: Int16Array): [number, number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < idx.length; k++) {
    const v = values[idx[k]];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let t = (lo + hi) / 2;
  let mLo = lo;
  let mHi = hi;
  for (let iter = 0; iter < 6; iter++) {
    let sl = 0;
    let nl = 0;
    let sh = 0;
    let nh = 0;
    for (let k = 0; k < idx.length; k++) {
      const v = values[idx[k]];
      if (v < t) {
        sl += v;
        nl++;
      } else {
        sh += v;
        nh++;
      }
    }
    if (nl === 0 || nh === 0) break;
    mLo = sl / nl;
    mHi = sh / nh;
    const next = (mLo + mHi) / 2;
    if (Math.abs(next - t) < 0.25) {
      t = next;
      break;
    }
    t = next;
  }
  return [t, mLo, mHi];
}

/** Saturated samples: nothing can be read under a blown-out highlight. */
const SATURATED = 250;

export function classifyCells(values: Float64Array): CellClassification {
  const threshold = new Float64Array(CELL_COUNT);
  const contrast = new Float64Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const [t, lo, hi] = twoMeans(values, NEIGHBOURS[i]);
    threshold[i] = t;
    contrast[i] = hi - lo;
  }
  const globalContrast = Math.max(1, median(contrast));
  const bits = new Uint8Array(CELL_COUNT);
  const confidence = new Float64Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = values[i];
    bits[i] = v < threshold[i] ? 1 : 0;
    const local = Math.max(contrast[i], 1);
    // Distance to the threshold relative to the cluster half-separation, damped
    // where the neighbourhood itself has collapsed (glare, occluder, shadow).
    const margin = Math.min(1, Math.abs(v - threshold[i]) / (local / 2));
    const health = Math.min(1, contrast[i] / (0.5 * globalContrast));
    confidence[i] = v >= SATURATED ? 0 : margin * health;
  }
  return { bits, confidence, threshold, contrast, globalContrast };
}

function median(a: Float64Array): number {
  const s = Float64Array.from(a).sort();
  return s.length ? s[s.length >> 1] : 0;
}
