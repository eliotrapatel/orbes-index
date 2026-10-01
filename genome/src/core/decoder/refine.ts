/**
 * Alignment refinement by cell-sampling contrast.
 *
 * The homography fitted to the seal centre and the moon centroids is good to
 * a fraction of a unit, but centroid bias (blur, partial occlusion of a
 * moon), the perspective offset of the seal's ellipse centre, slight surface
 * curvature and lens distortion leave residual misalignment that matters for
 * the outer rings. The decoded image itself tells how well we are aligned: at
 * the true cell centres, ink cells are darkest and paper cells lightest, so
 * the sum over cells of |value − local threshold| / local contrast peaks at
 * alignment. We maximise it by coordinate descent with step halving over the
 * image positions of the control points (sub-pixel), then — for curved or
 * distorted surfaces — over a smooth per-sector image offset field.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { Point } from '../geometry.js';
import { homographyFromPoints, type Homography } from './homography.js';
import type { GrayImage } from './image.js';
import { CELL_COUNT, CELL_GEOMETRY, sampleCells, type CellClassification, type OffsetField } from './sampler.js';

/** Contrast-normalised separation of the cell samples from their thresholds (higher = better aligned). */
export function alignmentScore(values: Float64Array, cls: CellClassification, weights?: Float64Array): number {
  let s = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = cls.contrast[i] > 1 ? cls.contrast[i] : 1;
    const w = weights ? weights[i] : 1;
    s += (w * Math.abs(values[i] - cls.threshold[i])) / c;
  }
  return s;
}

/**
 * Coordinate descent over a parameter vector: each coordinate is nudged by
 * ±step while that improves `score`; the step halves once no coordinate
 * improves, down to `minStep`.
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
    sampleCells(img, h, false, undefined, values);
    return alignmentScore(values, cls);
  };
  const best = coordinateDescent(params, score, 0.3 * unitPx, 0.03 * unitPx, 400);
  const points = pointsOf(params);
  const h = homographyFromPoints(codePoints, points);
  return h ? { homography: h, points, score: best } : null;
}

const SECTORS = 8;

/**
 * Smooth offset field: one image-space offset per angular sector at the
 * inner and outer data radius, interpolated linearly in angle and radius.
 */
export function makeOffsetField(offsets: Float64Array): OffsetField {
  const INNER = 10.5;
  const OUTER = 22.5;
  return (x: number, y: number) => {
    let a = Math.atan2(x, -y);
    if (a < 0) a += 2 * Math.PI;
    const f = (a / (2 * Math.PI)) * SECTORS - 0.5;
    const s0 = ((Math.floor(f) % SECTORS) + SECTORS) % SECTORS;
    const s1 = (s0 + 1) % SECTORS;
    const ta = f - Math.floor(f);
    let tr = (Math.hypot(x, y) - INNER) / (OUTER - INNER);
    tr = tr < 0 ? 0 : tr > 1 ? 1 : tr;
    let dx = 0;
    let dy = 0;
    for (const [s, ws] of [
      [s0, 1 - ta],
      [s1, ta],
    ]) {
      for (const [band, wb] of [
        [0, 1 - tr],
        [1, tr],
      ]) {
        const k = 4 * (s * 2 + band);
        dx += ws * wb * offsets[k / 2];
        dy += ws * wb * offsets[k / 2 + 1];
      }
    }
    return { dx, dy };
  };
}

/** Number of parameters of the offset field (2 per sector and radial band). */
export const OFFSET_FIELD_PARAMS = SECTORS * 2 * 2;

/**
 * Per-sector offset refinement on top of a homography: corrects surface
 * curvature and lens distortion that no single homography can follow.
 */
export function refineOffsetField(img: GrayImage, h: Homography, unitPx: number, cls: CellClassification): { field: OffsetField; offsets: Float64Array; score: number } {
  const offsets = new Float64Array(OFFSET_FIELD_PARAMS);
  const values = new Float64Array(CELL_COUNT);
  const field = makeOffsetField(offsets);
  // Each parameter only influences nearby cells, but scoring all cells keeps
  // the objective simple and still costs well under a millisecond.
  const score = (p: Float64Array): number => {
    offsets.set(p);
    sampleCells(img, h, false, field, values);
    return alignmentScore(values, cls);
  };
  const params = new Float64Array(OFFSET_FIELD_PARAMS);
  const best = coordinateDescent(params, score, 0.25 * unitPx, 0.03 * unitPx, 600);
  offsets.set(params);
  return { field, offsets, score: best };
}

export { CELL_GEOMETRY };
