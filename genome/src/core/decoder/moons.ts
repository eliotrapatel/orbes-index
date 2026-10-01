/**
 * Moon (perspective anchor) detection.
 *
 * The seal fixes the code's affine frame up to an in-plane rotation, so the
 * four moons (solid discs r = 1.75 u at radius 27.5 u on the diagonals) must
 * lie in an annulus around the seal; perspective only stretches that annulus,
 * so it is searched generously. Inside it a centre-surround box filter (dark
 * inner box, light surround; two summed-area lookups per position) responds
 * to compact dark blobs of the moon's size and stays near zero on data arcs
 * (striped: the surround is as dark as the centre), on large dark areas
 * (occluders, shadows: same) and on thin lines. Peaks are refined to a
 * sub-pixel darkness-weighted centroid restricted to the moon disc, which
 * also keeps the polaris halo (from 2.4 u) out of the estimate.
 *
 * Selection uses a projective invariant: opposite moons and the code centre
 * are collinear in ANY view (a homography maps lines to lines), so the two
 * moon diagonals must both pass through the seal centre. Candidate pairs are
 * scored on that, then combined into the best four (or three, when a moon is
 * occluded) — robust to strong perspective, where the moons' rectified radii
 * and angles drift far from the frontal 27.5 u / 90°.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE01 } from '../code/profile.js';
import type { Point } from '../geometry.js';
import type { SealCandidate } from './finder.js';
import { sampleBilinear, type GrayImage } from './image.js';
import { boxMean, type IntegralImage } from './integral.js';

export interface MoonDetection {
  /** Sub-pixel centre in image coordinates. */
  x: number;
  y: number;
  /** Normalised centre-surround response (≈ 0.5 for a clean moon). */
  response: number;
  /** Darkness of the polaris halo ring around this moon, 0 ≈ none. */
  halo: number;
}

export interface MoonSet {
  /**
   * Four slots in clockwise image order around the seal; opposite slots
   * (k, k + 2) are opposite moons. Null = not found (at most one).
   */
  slots: (MoonDetection | null)[];
  score: number;
}

/** Linear map [a11, a12, a21, a22]. */
export type Mat2 = [number, number, number, number];

const ORBIT = CODE01.moons.orbitRadius;
const MOON_R = CODE01.moons.radius;
/** Rectified search annulus (u). Wide: perspective moves the moons by ±30 %. */
const BAND: [number, number] = [ORBIT * 0.72, ORBIT * 1.45];
const MIN_RESPONSE = 0.22;
/** Peaks kept for pairing (strongest first). */
const MAX_PEAKS = 24;
/** Largest distance (u) from the seal centre to a moon diagonal. */
const MAX_DIAGONAL_OFFSET = 1.5;
/** Tolerance on the angle between moon diagonals and on a pair's opposition. */
const ANGLE_TOLERANCE = (40 * Math.PI) / 180;
/** Centroid window radius (u): the whole moon disc, but none of the polaris halo (from 2.4 u). */
const CENTROID_WINDOW = 2.15;

export function invert2([a, b, c, d]: Mat2): Mat2 | null {
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return null;
  return [d / det, -b / det, -c / det, a / det];
}

function singularValues([a, b, c, d]: Mat2): [number, number] {
  const s1 = a * a + b * b + c * c + d * d;
  const det = Math.abs(a * d - b * c);
  const big = Math.sqrt(Math.max(0, s1 / 2 + Math.sqrt(Math.max(0, (s1 * s1) / 4 - det * det))));
  return [big, big > 0 ? det / big : 0];
}

/** Mean gray value on a circle of radius r (u) around image point p, mapped by `affine`. */
export function ringMean(img: GrayImage, affine: Mat2, p: Point, r: number, count: number): number {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const a = (k * 2 * Math.PI) / count;
    const u = r * Math.sin(a);
    const v = -r * Math.cos(a);
    sum += sampleBilinear(img, p.x + affine[0] * u + affine[1] * v, p.y + affine[2] * u + affine[3] * v);
  }
  return sum / count;
}

/**
 * Darkness-weighted centroid of the moon disc around `p` (two re-centring
 * passes), `affine` mapping moon-local units to pixels. Weights ramp from the
 * local paper level to the ink level, so blur and exposure cannot bias the
 * centre of a symmetric blob.
 */
export function refineCentroid(img: GrayImage, affine: Mat2, p: Point, ink: number, paper: number): Point {
  const inv = invert2(affine);
  if (!inv || !(paper - ink > 1)) return p;
  const [s1] = singularValues(affine);
  const half = Math.ceil(CENTROID_WINDOW * s1) + 1;
  const span = paper - ink;
  const r2max = CENTROID_WINDOW * CENTROID_WINDOW;
  let cur = p;
  for (let pass = 0; pass < 2; pass++) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    const x0 = Math.max(0, Math.floor(cur.x - half));
    const x1 = Math.min(img.width - 1, Math.ceil(cur.x + half));
    const y0 = Math.max(0, Math.floor(cur.y - half));
    const y1 = Math.min(img.height - 1, Math.ceil(cur.y + half));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      const dy = py - cur.y;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const dx = px - cur.x;
        const u = inv[0] * dx + inv[1] * dy;
        const v = inv[2] * dx + inv[3] * dy;
        if (u * u + v * v > r2max) continue;
        let wgt = (paper - img.data[y * img.width + x]) / span;
        if (wgt <= 0) continue;
        if (wgt > 1) wgt = 1;
        sw += wgt;
        sx += wgt * px;
        sy += wgt * py;
      }
    }
    if (!(sw > 0)) return cur;
    cur = { x: sx / sw, y: sy / sw };
  }
  return cur;
}

/** Local ink (moon interior) and paper (beyond the halo) levels around a moon. */
export function moonLevels(img: GrayImage, affine: Mat2, p: Point): { ink: number; paper: number } {
  return { ink: (2 * ringMean(img, affine, p, 0.5, 8) + sampleBilinear(img, p.x, p.y)) / 3, paper: ringMean(img, affine, p, 3.4, 16) };
}

/** Halo darkness around a moon centre (polaris hint), relative to the moon's contrast. */
export function haloDarkness(img: GrayImage, affine: Mat2, p: Point): number {
  const { ink, paper } = moonLevels(img, affine, p);
  if (!(paper - ink > 1)) return 0;
  return (paper - ringMean(img, affine, p, CODE01.moons.haloRadius, 24)) / (paper - ink);
}

interface Peak extends MoonDetection {
  /** Rectified polar coordinates around the seal (u, radians clockwise from north). */
  r: number;
  a: number;
  q: Point;
}

/** Candidate moon peaks of the centre-surround filter inside the moon annulus. */
function moonPeaks(img: GrayImage, ii: IntegralImage, seal: SealCandidate): Peak[] {
  const affine = seal.affine;
  const inv = invert2(affine);
  if (!inv) return [];
  const [sMax, sMin] = singularValues(affine);
  // Inner box inscribed in the (possibly foreshortened) moon; surround reaching past it.
  const inner = Math.max(1, sMin * MOON_R * 0.6);
  const outer = Math.max(inner + 1.5, sMax * MOON_R * 1.4);
  const grid = Math.max(1, sMin * 0.4);
  const reach = BAND[1] * sMax;
  const gx0 = Math.max(outer, seal.center.x - reach);
  const gy0 = Math.max(outer, seal.center.y - reach);
  const gx1 = Math.min(img.width - outer, seal.center.x + reach);
  const gy1 = Math.min(img.height - outer, seal.center.y + reach);
  if (!(gx1 > gx0 && gy1 > gy0)) return [];
  const nx = Math.floor((gx1 - gx0) / grid) + 1;
  const ny = Math.floor((gy1 - gy0) / grid) + 1;
  const contrast = Math.max(16, seal.paper - seal.ink);
  const resp = new Float32Array(nx * ny).fill(-1);
  const innerArea = 4 * inner * inner;
  const outerArea = 4 * outer * outer;
  const r0 = BAND[0] * BAND[0];
  const r1 = BAND[1] * BAND[1];
  for (let j = 0; j < ny; j++) {
    const y = gy0 + j * grid;
    const dy = y - seal.center.y;
    for (let i = 0; i < nx; i++) {
      const x = gx0 + i * grid;
      const dx = x - seal.center.x;
      const qx = inv[0] * dx + inv[1] * dy;
      const qy = inv[2] * dx + inv[3] * dy;
      const rr = qx * qx + qy * qy;
      if (rr < r0 || rr > r1) continue;
      const mi = boxMean(ii, x - inner, y - inner, x + inner, y + inner);
      const mo = boxMean(ii, x - outer, y - outer, x + outer, y + outer);
      const surround = (mo * outerArea - mi * innerArea) / (outerArea - innerArea);
      resp[j * nx + i] = (surround - mi) / contrast;
    }
  }
  const raw: { x: number; y: number; v: number }[] = [];
  const suppress = Math.max(2, Math.round((MOON_R * 1.5 * sMin) / grid));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = resp[j * nx + i];
      if (v < MIN_RESPONSE) continue;
      let isMax = true;
      for (let dj = -suppress; dj <= suppress && isMax; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -suppress; di <= suppress; di++) {
          const i2 = i + di;
          if (i2 < 0 || i2 >= nx || (di === 0 && dj === 0)) continue;
          const w = resp[jj * nx + i2];
          // Strict on one side so plateaus yield exactly one peak.
          if (w > v || (w === v && (dj < 0 || (dj === 0 && di < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) raw.push({ x: gx0 + i * grid, y: gy0 + j * grid, v });
    }
  }
  raw.sort((a, b) => b.v - a.v);
  const peaks: Peak[] = [];
  for (const p of raw.slice(0, MAX_PEAKS)) {
    const { ink, paper } = moonLevels(img, affine, p);
    if (!(paper - ink > 0.25 * contrast)) continue;
    const c = refineCentroid(img, affine, p, ink, paper);
    const dx = c.x - seal.center.x;
    const dy = c.y - seal.center.y;
    const q = { x: inv[0] * dx + inv[1] * dy, y: inv[2] * dx + inv[3] * dy };
    const a = Math.atan2(q.x, -q.y);
    peaks.push({ x: c.x, y: c.y, response: p.v, halo: haloDarkness(img, affine, c), q, r: Math.hypot(q.x, q.y), a: a < 0 ? a + 2 * Math.PI : a });
  }
  return peaks;
}

/** Absolute angular difference in [0, π]. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

interface Diagonal {
  i: number;
  j: number;
  score: number;
  /** Direction angle of the diagonal (mod π). */
  dir: number;
}

/** Opposite-moon pairs whose connecting line passes through the seal centre. */
function diagonals(peaks: Peak[]): Diagonal[] {
  const out: Diagonal[] = [];
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const p = peaks[i];
      const q = peaks[j];
      if (Math.PI - angleDiff(p.a, q.a) > ANGLE_TOLERANCE) continue;
      const ratio = p.r / q.r;
      if (ratio < 0.6 || ratio > 1 / 0.6) continue;
      // Distance from the centre (origin of the rectified frame) to line pq.
      const len = Math.hypot(q.q.x - p.q.x, q.q.y - p.q.y);
      const offset = Math.abs(p.q.x * q.q.y - p.q.y * q.q.x) / len;
      if (offset > MAX_DIAGONAL_OFFSET) continue;
      const score = (p.response + q.response) * (1 - offset / (2 * MAX_DIAGONAL_OFFSET));
      out.push({ i, j, score, dir: Math.atan2(q.q.x - p.q.x, -(q.q.y - p.q.y)) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Order detections clockwise by rectified angle into four slots (null = missing). */
function toSlots(members: Peak[], missingAngle: number | null): (MoonDetection | null)[] {
  const entries: { a: number; m: MoonDetection | null }[] = members.map((p) => ({ a: p.a, m: p }));
  if (missingAngle !== null) entries.push({ a: missingAngle, m: null });
  entries.sort((x, y) => x.a - y.a);
  return entries.map((e) => (e.m ? { x: e.m.x, y: e.m.y, response: e.m.response, halo: e.m.halo } : null));
}

/**
 * Detect the moons around a seal candidate and pick the most consistent set.
 * Null when fewer than three consistent moons are visible.
 */
export function findMoons(img: GrayImage, ii: IntegralImage, seal: SealCandidate): MoonSet | null {
  const peaks = moonPeaks(img, ii, seal);
  const diags = diagonals(peaks);
  let best: MoonSet | null = null;
  for (let s = 0; s < diags.length; s++) {
    for (let t = s + 1; t < diags.length; t++) {
      const d1 = diags[s];
      const d2 = diags[t];
      if (d1.i === d2.i || d1.i === d2.j || d1.j === d2.i || d1.j === d2.j) continue;
      // The diagonals of the moon square cross at right angles, give or take perspective.
      const cross = angleDiff(d1.dir, d2.dir);
      if (Math.abs(Math.min(cross, Math.PI - cross) - Math.PI / 2) > ANGLE_TOLERANCE) continue;
      const score = d1.score + d2.score;
      if (!best || score > best.score) {
        best = { slots: toSlots([peaks[d1.i], peaks[d1.j], peaks[d2.i], peaks[d2.j]], null), score };
      }
    }
  }
  if (best) return best;
  // One moon hidden: a diagonal plus a third moon roughly square to it.
  for (const d of diags) {
    const p = peaks[d.i];
    const q = peaks[d.j];
    const meanR = (p.r + q.r) / 2;
    for (let k = 0; k < peaks.length; k++) {
      if (k === d.i || k === d.j) continue;
      const m = peaks[k];
      if (m.r < 0.6 * meanR || m.r > meanR / 0.6) continue;
      if (Math.abs(angleDiff(m.a, p.a) - Math.PI / 2) > ANGLE_TOLERANCE) continue;
      const score = 0.75 * (d.score + m.response);
      if (!best || score > best.score) {
        const missing = (m.a + Math.PI) % (2 * Math.PI);
        best = { slots: toSlots([p, q, m], missing), score };
      }
    }
  }
  return best;
}
