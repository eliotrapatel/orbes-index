/**
 * Alignment refinement by cell-sampling contrast.
 *
 * The homography fitted to the seal centre and the moon centroids is good to
 * a fraction of a unit, but centroid bias (blur, partial occlusion of a
 * moon), the perspective offset of the seal's ellipse centre, slight surface
 * curvature and lens distortion leave residual misalignment that matters for
 * the outer rings. The image itself tells how well we are aligned: at the
 * true cell centres ink cells are darkest and paper cells lightest, so the
 * sum over cells of |value − local threshold| / local contrast peaks at
 * alignment. We maximise it by coordinate descent with step halving, first
 * over the image positions of the control points (sub-pixel), then — for
 * curved or distorted surfaces that no homography can follow — over a smooth
 * offset field (one image offset per angular sector and radial band,
 * interpolated bilinearly in angle and radius).
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01_RINGS } from '../code/profile.js';
import { TAU, type Point } from '../geometry.js';
import { homographyFromPoints, type Homography } from './homography.js';
import type { GrayImage } from './image.js';
import { CELL_COUNT, CELL_GEOMETRY, projectCells, sampleProjected, type CellClassification } from './sampler.js';

/** Contrast-normalised separation of the cell samples from their thresholds (higher = better aligned). */
export function alignmentScore(values: Float64Array, cls: CellClassification): number {
  let s = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = cls.contrast[i] > 1 ? cls.contrast[i] : 1;
    s += Math.abs(values[i] - cls.threshold[i]) / c;
  }
  return s;
}

/**
 * Coordinate descent: each coordinate is nudged by ±step while that improves
 * `score`; the step halves once no coordinate improves, down to `minStep`.
 * Returns the best score; `params` holds the best point.
 */
export function coordinateDescent(params: Float64Array, score: (p: Float64Array) => number, step: number, minStep: number, maxEvals: number): number {
  let best = score(params);
  let evals = 1;
  for (let s = step; s >= minStep && evals < maxEvals; s /= 2) {
    let improved = true;
    while (improved && evals < maxEvals) {
      improved = false;
      for (let k = 0; k < params.length && evals < maxEvals; k++) {
        for (const dir of [1, -1]) {
          const old = params[k];
          params[k] = old + dir * s;
          const v = score(params);
          evals++;
          if (v > best) {
            best = v;
            improved = true;
            break;
          }
          params[k] = old;
        }
      }
    }
  }
  return best;
}

export interface RefinedAlignment {
  homography: Homography;
  /** Image positions of the control points after refinement. */
  points: Point[];
  score: number;
}

/**
 * Refine the image positions of the control points (`codePoints[i]` ↔
 * `imagePoints[i]`) so that cell sampling is as contrasted as possible.
 * `unitPx` (pixels per u) scales the search steps.
 */
export function refineControlPoints(
  img: GrayImage,
  codePoints: readonly Point[],
  imagePoints: readonly Point[],
  unitPx: number,
  cls: CellClassification,
): RefinedAlignment | null {
  const values = new Float64Array(CELL_COUNT);
  const params = new Float64Array(imagePoints.length * 2);
  const pointsOf = (p: Float64Array): Point[] => imagePoints.map((q, i) => ({ x: q.x + p[2 * i], y: q.y + p[2 * i + 1] }));
  const score = (p: Float64Array): number => {
    const h = homographyFromPoints(codePoints, pointsOf(p));
    if (!h) return -Infinity;
    return alignmentScore(sampleProjected(img, projectCells(h, false), null, values), cls);
  };
  const best = coordinateDescent(params, score, 0.3 * unitPx, 0.04 * unitPx, 400);
  const points = pointsOf(params);
  const h = homographyFromPoints(codePoints, points);
  return h ? { homography: h, points, score: best } : null;
}

// ── Offset field ───────────────────────────────────────────────────────────

const SECTORS = 8;
const BANDS = 2;
/** Number of field parameters: an image offset (dx, dy) per sector and band. */
export const FIELD_PARAMS = SECTORS * BANDS * 2;

/**
 * Bilinear weights of each cell on the field nodes: four (node, weight)
 * pairs per cell, nodes at sector centres and at the innermost / outermost
 * data radius. Static: the cells never move in the code plane.
 */
const FIELD_WEIGHTS = (() => {
  const inner = CODE01_RINGS[0].radius;
  const outer = CODE01_RINGS[CODE01_RINGS.length - 1].radius;
  const node = new Uint8Array(CELL_COUNT * 4);
  const weight = new Float64Array(CELL_COUNT * 4);
  for (let i = 0; i < CELL_COUNT; i++) {
    const f = (CELL_GEOMETRY.theta[i] / TAU) * SECTORS - 0.5;
    const s0 = (((Math.floor(f) % SECTORS) + SECTORS) % SECTORS) as number;
    const s1 = (s0 + 1) % SECTORS;
    const ta = f - Math.floor(f);
    const radius = CODE01_RINGS[CELL_GEOMETRY.ring[i]].radius;
    const tr = (radius - inner) / (outer - inner);
    const entries: [number, number][] = [
      [s0 * BANDS, (1 - ta) * (1 - tr)],
      [s0 * BANDS + 1, (1 - ta) * tr],
      [s1 * BANDS, ta * (1 - tr)],
      [s1 * BANDS + 1, ta * tr],
    ];
    entries.forEach(([n, w], k) => {
      node[4 * i + k] = n;
      weight[4 * i + k] = w;
    });
  }
  return { node, weight };
})();

/** Per-cell image shift (interleaved dx, dy) implied by the field parameters. */
export function fieldShift(params: Float64Array, out = new Float64Array(CELL_COUNT * 2)): Float64Array {
  const { node, weight } = FIELD_WEIGHTS;
  for (let i = 0; i < CELL_COUNT; i++) {
    let dx = 0;
    let dy = 0;
    for (let k = 4 * i; k < 4 * i + 4; k++) {
      dx += weight[k] * params[2 * node[k]];
      dy += weight[k] * params[2 * node[k] + 1];
    }
    out[2 * i] = dx;
    out[2 * i + 1] = dy;
  }
  return out;
}

/**
 * Offset-field refinement on top of a homography: follows surface curvature
 * and lens distortion. Returns the per-cell shift to apply when sampling.
 */
export function refineOffsetField(img: GrayImage, h: Homography, unitPx: number, cls: CellClassification): { shift: Float64Array; score: number } {
  const pos = projectCells(h, false);
  const shift = new Float64Array(CELL_COUNT * 2);
  const values = new Float64Array(CELL_COUNT);
  const score = (p: Float64Array): number => alignmentScore(sampleProjected(img, pos, fieldShift(p, shift), values), cls);
  const params = new Float64Array(FIELD_PARAMS);
  const best = coordinateDescent(params, score, 0.25 * unitPx, 0.04 * unitPx, 800);
  return { shift: fieldShift(params), score: best };
}
