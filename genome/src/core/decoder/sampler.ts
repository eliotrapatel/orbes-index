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

const FOOTPRINT = 0.2;
/** Sub-samples per cell with the footprint (3 × 3) and without (centre only). */
export const FOOTPRINT_SAMPLES = 9;

/**
 * Image positions of the cell samples through `h`: interleaved x, y; one
 * sample per cell, or FOOTPRINT_SAMPLES per cell (±0.2 u radially and
 * tangentially) when `footprint` is set.
 */
export function projectCells(h: Homography, footprint: boolean): Float64Array {
  const per = footprint ? FOOTPRINT_SAMPLES : 1;
  const out = new Float64Array(CELL_COUNT * per * 2);
  const { x: cxs, y: cys, theta } = CELL_GEOMETRY;
  let o = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const cx = cxs[i];
    const cy = cys[i];
    // Radial unit vector (sin θ, −cos θ); tangential (cos θ, sin θ).
    const s = Math.sin(theta[i]);
    const c = Math.cos(theta[i]);
    for (let k = 0; k < per; k++) {
      const dr = footprint ? ((k % 3) - 1) * FOOTPRINT : 0;
      const dt = footprint ? (Math.floor(k / 3) - 1) * FOOTPRINT : 0;
      const x = cx + dr * s + dt * c;
      const y = cy - dr * c + dt * s;
      const w = h[6] * x + h[7] * y + h[8];
      out[o++] = (h[0] * x + h[1] * y + h[2]) / w;
      out[o++] = (h[3] * x + h[4] * y + h[5]) / w;
    }
  }
  return out;
}

/**
 * Mean gray value per cell from projected sample positions, optionally
 * shifted by a per-cell image offset (`shift`: interleaved dx, dy per cell).
 */
export function sampleProjected(img: GrayImage, pos: Float64Array, shift: Float64Array | null, out = new Float64Array(CELL_COUNT)): Float64Array {
  const per = pos.length / (2 * CELL_COUNT);
  let o = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const dx = shift ? shift[2 * i] : 0;
    const dy = shift ? shift[2 * i + 1] : 0;
    let sum = 0;
    for (let k = 0; k < per; k++, o += 2) sum += sampleBilinear(img, pos[o] + dx, pos[o + 1] + dy);
    out[i] = sum / per;
  }
  return out;
}

/** Cell values through `h` (see projectCells / sampleProjected). */
export function sampleCells(img: GrayImage, h: Homography, footprint: boolean, shift: Float64Array | null = null): Float64Array {
  return sampleProjected(img, projectCells(h, footprint), shift);
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

/** Rectified sample points of the quiet zones, with the cell whose local threshold applies. */
const QUIET_PROBES = (() => {
  const probes: { x: number; y: number; cell: number }[] = [];
  const nearestCell = (ringIndex: number, a: number): number => {
    const ring = CODE01_RINGS[ringIndex];
    return ring.offset + (Math.floor((a / TAU) * ring.cells) % ring.cells);
  };
  // Outer quiet band between the data orbits and the moons, away from the
  // diagonals where the moons and the polaris halo sit.
  const OUTER = 24.6;
  for (let k = 0; k < 96; k++) {
    const a = ((k + 0.5) * TAU) / 96;
    const fromDiagonal = Math.abs((((a - Math.PI / 4) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2) - Math.PI / 4);
    if (Math.PI / 4 - fromDiagonal < (12 * Math.PI) / 180) continue;
    probes.push({ x: OUTER * Math.sin(a), y: -OUTER * Math.cos(a), cell: nearestCell(CODE01_RINGS.length - 1, a) });
  }
  // The seal's own quiet ring.
  const INNER = 4.85;
  for (let k = 0; k < 32; k++) {
    const a = ((k + 0.5) * TAU) / 32;
    probes.push({ x: INNER * Math.sin(a), y: -INNER * Math.cos(a), cell: nearestCell(0, a) });
  }
  return probes;
})();

/**
 * Fraction of the quiet-zone probes that read as substrate under `h`. A true
 * code scores near 1 (glare reads light too); a look-alike — a genome glyph
 * mistaken for a seal, a misassigned moon — lands the probes on data or
 * clutter and scores near ½. A cheap gate before expensive work.
 */
export function quietZoneScore(img: GrayImage, h: Homography, cls: CellClassification): number {
  let light = 0;
  for (const p of QUIET_PROBES) {
    const w = h[6] * p.x + h[7] * p.y + h[8];
    const v = sampleBilinear(img, (h[0] * p.x + h[1] * p.y + h[2]) / w, (h[3] * p.x + h[4] * p.y + h[5]) / w);
    if (v >= cls.threshold[p.cell]) light++;
  }
  return light / QUIET_PROBES.length;
}
