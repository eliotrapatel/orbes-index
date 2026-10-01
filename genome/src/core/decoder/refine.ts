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
import { sampleBilinear, type GrayImage } from './image.js';
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
 * An objective over a parameter vector that can score a one-coordinate change
 * without committing it (so scorers can update incrementally).
 */
export interface Objective {
  /** Score with coordinate k set to `value`, all others as last accepted. */
  trial(k: number, value: number): number;
  /** Commit the last trial. */
  accept(): void;
}

/** Objective from a plain scoring function (every trial is a full evaluation). */
export function fullObjective(params: Float64Array, score: (p: Float64Array) => number): Objective {
  const scratch = Float64Array.from(params);
  return {
    trial(k, value) {
      scratch.set(params);
      scratch[k] = value;
      return score(scratch);
    },
    accept() {},
  };
}

/**
 * Coordinate descent: each coordinate is nudged by ±step while that improves
 * the objective; the step halves once no coordinate improves, down to
 * `minStep`. `params` holds the best point on return (the objective sees it
 * through accept); returns the best score.
 */
export function coordinateDescent(params: Float64Array, initial: number, objective: Objective, step: number, minStep: number, maxEvals: number): number {
  let best = initial;
  let evals = 1;
  for (let s = step; s >= minStep && evals < maxEvals; s /= 2) {
    let improved = true;
    while (improved && evals < maxEvals) {
      improved = false;
      for (let k = 0; k < params.length && evals < maxEvals; k++) {
        for (const dir of [1, -1]) {
          const value = params[k] + dir * s;
          const v = objective.trial(k, value);
          evals++;
          if (v > best) {
            best = v;
            params[k] = value;
            objective.accept();
            improved = true;
            break;
          }
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
  const best = coordinateDescent(params, score(params), fullObjective(params, score), 0.3 * unitPx, 0.04 * unitPx, 400);
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
 * data radius; and the reverse lists (cells influenced by each node), which
 * make a one-parameter change cost a quarter of a full evaluation. Static:
 * the cells never move in the code plane.
 */
const FIELD_WEIGHTS = (() => {
  const inner = CODE01_RINGS[0].radius;
  const outer = CODE01_RINGS[CODE01_RINGS.length - 1].radius;
  const node = new Uint8Array(CELL_COUNT * 4);
  const weight = new Float64Array(CELL_COUNT * 4);
  const byNode: { cells: number[]; weights: number[] }[] = Array.from({ length: SECTORS * BANDS }, () => ({ cells: [], weights: [] }));
  for (let i = 0; i < CELL_COUNT; i++) {
    const f = (CELL_GEOMETRY.theta[i] / TAU) * SECTORS - 0.5;
    const s0 = ((Math.floor(f) % SECTORS) + SECTORS) % SECTORS;
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
      if (w > 0) {
        byNode[n].cells.push(i);
        byNode[n].weights.push(w);
      }
    });
  }
  return {
    node,
    weight,
    nodeCells: byNode.map((b) => Int32Array.from(b.cells)),
    nodeWeights: byNode.map((b) => Float64Array.from(b.weights)),
  };
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
 * Field parameter 2n + a is the offset of node n along axis a (0 = x).
 */
export function refineOffsetField(img: GrayImage, h: Homography, unitPx: number, cls: CellClassification): { shift: Float64Array; score: number } {
  const pos = projectCells(h, false);
  const params = new Float64Array(FIELD_PARAMS);
  const shift = new Float64Array(CELL_COUNT * 2);
  const contribution = new Float64Array(CELL_COUNT);
  const cellScore = (i: number, dx: number, dy: number): number => {
    const v = sampleBilinear(img, pos[2 * i] + dx, pos[2 * i + 1] + dy);
    return Math.abs(v - cls.threshold[i]) / (cls.contrast[i] > 1 ? cls.contrast[i] : 1);
  };
  let total = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    contribution[i] = cellScore(i, 0, 0);
    total += contribution[i];
  }
  // Pending trial: coordinate k's node cells with their new shift and score.
  let pendingK = -1;
  let pendingTotal = 0;
  const trialShift = new Float64Array(CELL_COUNT);
  const trialScore = new Float64Array(CELL_COUNT);
  const objective: Objective = {
    trial(k, value) {
      const axis = k & 1;
      const cells = FIELD_WEIGHTS.nodeCells[k >> 1];
      const weights = FIELD_WEIGHTS.nodeWeights[k >> 1];
      const delta = value - params[k];
      let t = total;
      for (let j = 0; j < cells.length; j++) {
        const i = cells[j];
        const moved = shift[2 * i + axis] + weights[j] * delta;
        trialShift[j] = moved;
        trialScore[j] = axis === 0 ? cellScore(i, moved, shift[2 * i + 1]) : cellScore(i, shift[2 * i], moved);
        t += trialScore[j] - contribution[i];
      }
      pendingK = k;
      pendingTotal = t;
      return t;
    },
    accept() {
      const axis = pendingK & 1;
      const cells = FIELD_WEIGHTS.nodeCells[pendingK >> 1];
      for (let j = 0; j < cells.length; j++) {
        shift[2 * cells[j] + axis] = trialShift[j];
        contribution[cells[j]] = trialScore[j];
      }
      total = pendingTotal;
    },
  };
  const best = coordinateDescent(params, total, objective, 0.25 * unitPx, 0.04 * unitPx, 800);
  return { shift: fieldShift(params), score: best };
}
