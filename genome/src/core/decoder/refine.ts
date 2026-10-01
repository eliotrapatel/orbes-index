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
 * interpolated bilinearly in angle and radius). When the bend is too strong
 * for descent to start from the homography, the ring lattice registration
 * (ringLatticeField) gives the field its starting point.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01, CODE01_RINGS } from '../code/profile.js';
import { TAU, type Point } from '../geometry.js';
import { homographyFromPoints, jacobianH, type Homography } from './homography.js';
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
 * Field parameter 2n + a is the offset of node n along axis a (0 = x); the
 * descent starts from `initial` (default: no offset). `cls` must be the
 * classification of the cells sampled with that initial field.
 */
export function refineOffsetField(
  img: GrayImage,
  h: Homography,
  unitPx: number,
  cls: CellClassification,
  initial: Float64Array = new Float64Array(FIELD_PARAMS),
): { shift: Float64Array; score: number } {
  const pos = projectCells(h, false);
  const params = Float64Array.from(initial);
  const shift = fieldShift(params);
  const contribution = new Float64Array(CELL_COUNT);
  const cellScore = (i: number, dx: number, dy: number): number => {
    const v = sampleBilinear(img, pos[2 * i] + dx, pos[2 * i + 1] + dy);
    return Math.abs(v - cls.threshold[i]) / (cls.contrast[i] > 1 ? cls.contrast[i] : 1);
  };
  let total = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    contribution[i] = cellScore(i, shift[2 * i], shift[2 * i + 1]);
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

// ── Ring lattice ───────────────────────────────────────────────────────────
//
// Strong curvature (a code engraved on a ring) bends the data orbits so far
// from any homography that the anchor fit is off by up to a whole ring pitch
// between the seal and the moons. Contrast-driven descent cannot recover from
// there: one ring sampled in place of its neighbour is just as contrasted.
// The orbits themselves are a radial lattice of known geometry, though: along
// any radius, ink (mask-balanced, ≈ ½ of the cells) can only sit within
// ±arcThickness/2 of a ring radius, and the inter-ring gaps, the band inside
// the first ring and the quiet band outside the last are always substrate.
// Averaged over an angular sector, the radial profile is periodic with the
// ring pitch, and its registration against that template measures the radial
// misalignment of the sector directly, whatever its size.

const LATTICE = (() => {
  const { firstRadius, pitch, arcThickness, ringCount } = CODE01.data;
  const lastRadius = firstRadius + (ringCount - 1) * pitch;
  return {
    firstRadius,
    pitch,
    halfArc: arcThickness / 2,
    /** Ink share of one pitch: the template is zero-mean over every pitch. */
    fill: arcThickness / pitch,
    /** Radial extent of the data band (u). */
    inner: firstRadius - pitch / 2,
    outer: lastRadius + pitch / 2,
    /** Pivot of the per-sector linear model, mid data band. */
    mid: (firstRadius + lastRadius) / 2,
  };
})();
/** Radial misalignments searched (u): wider than any anchor fit error worth reading. */
const LATTICE_OFFSET = 1.5;
const LATTICE_OFFSET_STEP = 0.05;
/** Radial stretch searched per sector (misalignment change per u of radius). */
const LATTICE_SLOPES = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
/** Profile resolution and reach: the data band plus the search range on both sides. */
const PROFILE_STEP = 0.05;
const PROFILE_FROM = LATTICE.inner - 1.25;
const PROFILE_TO = LATTICE.outer + 2.25;
const PROFILE_SAMPLES = Math.round((PROFILE_TO - PROFILE_FROM) / PROFILE_STEP);
const PROFILE_ANGLES = 24;
/** Penalty per u² of misalignment change between neighbouring sectors (scores are normalised to 1 per sector). */
const LATTICE_CONTINUITY = 0.5;

/**
 * Sector-averaged radial darkness profile through `h`, high-passed by its
 * moving average over exactly one pitch: shading, glare fall-off and
 * vignetting go, the lattice oscillation stays.
 */
function sectorProfile(img: GrayImage, h: Homography, sector: number): Float64Array {
  const raw = new Float64Array(PROFILE_SAMPLES);
  const span = TAU / SECTORS;
  const sin = new Float64Array(PROFILE_ANGLES);
  const cos = new Float64Array(PROFILE_ANGLES);
  for (let a = 0; a < PROFILE_ANGLES; a++) {
    const theta = (sector + (a + 0.5) / PROFILE_ANGLES) * span;
    sin[a] = Math.sin(theta);
    cos[a] = Math.cos(theta);
  }
  for (let j = 0; j < PROFILE_SAMPLES; j++) {
    const r = PROFILE_FROM + (j + 0.5) * PROFILE_STEP;
    let sum = 0;
    for (let a = 0; a < PROFILE_ANGLES; a++) {
      const x = r * sin[a];
      const y = -r * cos[a];
      const w = h[6] * x + h[7] * y + h[8];
      sum += sampleBilinear(img, (h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w);
    }
    raw[j] = sum / PROFILE_ANGLES;
  }
  const half = Math.round(LATTICE.pitch / PROFILE_STEP / 2);
  const out = new Float64Array(PROFILE_SAMPLES);
  for (let j = 0; j < PROFILE_SAMPLES; j++) {
    let sum = 0;
    for (let k = j - half; k < j + half; k++) sum += raw[k < 0 ? 0 : k >= PROFILE_SAMPLES ? PROFILE_SAMPLES - 1 : k];
    out[j] = sum / (2 * half) - raw[j];
  }
  return out;
}

const OFFSETS = Array.from({ length: Math.round((2 * LATTICE_OFFSET) / LATTICE_OFFSET_STEP) + 1 }, (_, i) => -LATTICE_OFFSET + i * LATTICE_OFFSET_STEP);

/**
 * Template edges (code radii) and the weight of the profile integral up to
 * each: the template is piecewise constant (1 − fill on ink zones, −fill on
 * the rest of the band), so a correlation is a weighted sum of profile
 * integrals at its edges.
 */
const LATTICE_EDGES = (() => {
  const radii: number[] = [LATTICE.inner, LATTICE.outer];
  const weights: number[] = [LATTICE.fill, -LATTICE.fill];
  for (const ring of CODE01_RINGS) {
    radii.push(ring.radius - LATTICE.halfArc, ring.radius + LATTICE.halfArc);
    weights.push(-1, 1);
  }
  return { radii: Float64Array.from(radii), weights: Float64Array.from(weights) };
})();

/**
 * Registration of a profile against the lattice: for every offset a, the best
 * correlation over the slopes b, where template radius t is observed at
 * t + a + b·(t − mid). Each correlation costs one prefix-sum lookup per
 * template edge instead of one product per profile sample.
 */
function registration(profile: Float64Array): { score: Float64Array; slope: Float64Array } {
  const prefix = new Float64Array(PROFILE_SAMPLES + 1);
  for (let j = 0; j < PROFILE_SAMPLES; j++) prefix[j + 1] = prefix[j] + profile[j];
  const { radii, weights } = LATTICE_EDGES;
  const score = new Float64Array(OFFSETS.length).fill(-Infinity);
  const slope = new Float64Array(OFFSETS.length);
  for (let i = 0; i < OFFSETS.length; i++) {
    for (const b of LATTICE_SLOPES) {
      let c = 0;
      for (let e = 0; e < radii.length; e++) {
        // Integral of the piecewise-constant profile up to the observed edge, in samples.
        const u = (radii[e] + OFFSETS[i] + b * (radii[e] - LATTICE.mid) - PROFILE_FROM) / PROFILE_STEP;
        let integral: number;
        if (u <= 0) integral = 0;
        else if (u >= PROFILE_SAMPLES) integral = prefix[PROFILE_SAMPLES];
        else {
          const j = Math.floor(u);
          integral = prefix[j] + (u - j) * profile[j];
        }
        c += weights[e] * integral;
      }
      if (c > score[i]) {
        score[i] = c;
        slope[i] = b;
      }
    }
  }
  return { score, slope };
}

/**
 * Offset candidates of one sector: the best registration with |a| ≤ ½ pitch
 * and the best within ±0.3 u of the same phase one pitch either side. The
 * lattice is periodic, so these score almost alike; only the band edges (one
 * ring of thirteen) and the neighbouring sectors tell them apart.
 */
function branchCandidates(score: Float64Array): number[] {
  const bestIn = (lo: number, hi: number): number => {
    let best = -1;
    for (let i = 0; i < OFFSETS.length; i++) {
      if (OFFSETS[i] > lo && OFFSETS[i] <= hi && (best < 0 || score[i] > score[best])) best = i;
    }
    return best;
  };
  const centre = bestIn(-LATTICE.pitch / 2, LATTICE.pitch / 2);
  const out: number[] = [];
  for (const k of [-1, 0, 1]) {
    const i = k === 0 ? centre : bestIn(OFFSETS[centre] + k * LATTICE.pitch - 0.3, OFFSETS[centre] + k * LATTICE.pitch + 0.3);
    if (i >= 0) out.push(i);
  }
  return out;
}

/**
 * Initial offset field registering the data orbits on the ring lattice,
 * sector by sector, from a homography that may be off by more than half a
 * ring pitch (null when no lattice is visible at all). Each sector gets a
 * radial offset and stretch; the branch of every sector is chosen jointly
 * around the code, maximising registration (each sector weighted by its
 * signal strength relative to the median sector) minus a penalty on offset
 * jumps between neighbouring sectors (a smooth surface bends smoothly).
 */
export function ringLatticeField(img: GrayImage, h: Homography): Float64Array | null {
  const regs = Array.from({ length: SECTORS }, (_, s) => registration(sectorProfile(img, h, s)));
  const peaks = regs.map((r) => Math.max(...r.score));
  const median = [...peaks].sort((a, b) => a - b)[SECTORS >> 1];
  if (!(median > 0)) return null;
  const cands = regs.map((r) => branchCandidates(r.score));
  const gain = (s: number, i: number): number => (peaks[s] > 0 ? (Math.min(1, peaks[s] / median) * regs[s].score[i]) / peaks[s] : 0);
  const jump = (i: number, j: number): number => LATTICE_CONTINUITY * (OFFSETS[i] - OFFSETS[j]) ** 2;

  // Best closed chain around the sectors: Viterbi from each start candidate.
  let best = -Infinity;
  let picks: number[] = [];
  for (const start of cands[0]) {
    let value = new Map<number, number>([[start, gain(0, start)]]);
    const back: Map<number, number>[] = [];
    for (let s = 1; s < SECTORS; s++) {
      const next = new Map<number, number>();
      const from = new Map<number, number>();
      for (const i of cands[s]) {
        let v = -Infinity;
        let arg = -1;
        for (const [j, prev] of value) {
          const t = prev - jump(i, j);
          if (t > v) {
            v = t;
            arg = j;
          }
        }
        next.set(i, v + gain(s, i));
        from.set(i, arg);
      }
      back.push(from);
      value = next;
    }
    for (const [last, v] of value) {
      const total = v - jump(last, start);
      if (total > best) {
        best = total;
        picks = [last];
        for (let s = SECTORS - 1; s > 0; s--) picks.unshift(back[s - 1].get(picks[0]) as number);
      }
    }
  }

  // No chain at all only with non-finite scores (a degenerate homography).
  if (picks.length !== SECTORS) return null;
  const params = new Float64Array(FIELD_PARAMS);
  const radii = [CODE01_RINGS[0].radius, CODE01_RINGS[CODE01_RINGS.length - 1].radius];
  for (let s = 0; s < SECTORS; s++) {
    const i = picks[s];
    const theta = (s + 0.5) * (TAU / SECTORS);
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta);
    radii.forEach((r, band) => {
      // Radial misalignment (u) at the node, turned into an image offset through the local Jacobian.
      const d = OFFSETS[i] + regs[s].slope[i] * (r - LATTICE.mid);
      const [a, b, c, e] = jacobianH(h, r * ux, r * uy);
      const n = s * BANDS + band;
      params[2 * n] = d * (a * ux + b * uy);
      params[2 * n + 1] = d * (c * ux + e * uy);
    });
  }
  return params;
}
