/**
 * ORBES SEAL finder.
 *
 * The seal is concentric (core disc r < 2, gap 2–3, ring 3–4, quiet 4–5.75),
 * so EVERY line through its centre crosses the run sequence
 *   light · dark 1 · light 1 · dark 4 · light 1 · dark 1 · light
 * whatever the rotation, and an affine view preserves those ratios. Stage 1
 * looks for that pattern along image rows of the binarised frame, stage 2
 * confirms it along the column and both diagonals through the core (rejecting
 * stripes, text and clutter), stage 3 clusters the hits of one seal.
 * Stage 4 measures the seal precisely on the gray image: rays from the centre
 * locate the ring (both edges) and the core edge with sub-pixel threshold
 * crossings, and direct least-squares ellipse fits give the centre and the
 * affine shape (scale, foreshortening axis; the in-plane rotation remains
 * unknown until the moons are found).
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { Point } from '../geometry.js';
import { fitEllipseRobust, type Ellipse } from './ellipse.js';
import { sampleBilinear, type GrayImage } from './image.js';

export interface SealCandidate {
  center: Point;
  /**
   * Linear map code-plane vector (u) → image vector (px), exact up to an
   * unknown rotation/reflection on the code side: [a11, a12, a21, a22].
   */
  affine: [number, number, number, number];
  /** Pixels per u, √|det affine|. */
  unit: number;
  /** Gray level of the seal ink and of the quiet ring around it. */
  ink: number;
  paper: number;
  /** Higher is better (ray support × fit quality × pattern hits). */
  score: number;
}

/** Smallest seal unit worth trying (px per u): below it the 1 u ring is under 2 px. */
const MIN_UNIT = 1.2;

// Expected run widths in u for dark ring, gap, core, gap, dark ring, with tolerance.
const RING_RANGE: [number, number] = [0.35, 1.9];
const GAP_RANGE: [number, number] = [0.3, 1.8];
const CORE_RANGE: [number, number] = [2.8, 4.8];
/** Minimum quiet run beyond the seal ring, in u (the printed quiet ring is 1.75 u). */
const MIN_QUIET = 0.4;

function inRange(v: number, unit: number, [lo, hi]: [number, number]): boolean {
  return v >= lo * unit && v <= hi * unit;
}

/** Unit size implied by a dark·light·DARK·light·dark run sequence, or 0 if it is not a seal section. */
function sealPattern(a: number, b: number, c: number, d: number, e: number): number {
  const unit = (a + b + c + d + e) / 8;
  if (unit < MIN_UNIT) return 0;
  if (!inRange(c, unit, CORE_RANGE)) return 0;
  if (!inRange(a, unit, RING_RANGE) || !inRange(e, unit, RING_RANGE)) return 0;
  if (!inRange(b, unit, GAP_RANGE) || !inRange(d, unit, GAP_RANGE)) return 0;
  // A seal is symmetric about its centre: same ring and gap widths on both sides.
  const slack = 0.8 * unit + 1;
  if (Math.abs(a - e) > slack || Math.abs(b - d) > slack) return 0;
  return unit;
}

interface Hit {
  x: number;
  y: number;
  unit: number;
}

/** Runs along a line through (x, y): in each direction, the ink run containing the start, then gap, ring, quiet. */
interface CrossSection {
  unit: number;
  /** Offset (in steps) of the core centre from the start pixel, along (dx, dy). */
  offset: number;
}

function crossCheck(bin: Uint8Array, w: number, h: number, x: number, y: number, dx: number, dy: number, maxRun: number): CrossSection | null {
  if (x < 0 || y < 0 || x >= w || y >= h || bin[y * w + x] !== 1) return null;
  const runs: number[][] = [];
  for (const sign of [-1, 1]) {
    const counts = [0, 0, 0, 0];
    let px = x;
    let py = y;
    let state = 0; // 0 core (ink), 1 gap, 2 ring (ink), 3 quiet
    while (state < 4) {
      if (px < 0 || py < 0 || px >= w || py >= h) break;
      const ink = bin[py * w + px] === 1;
      const expectInk = state === 0 || state === 2;
      if (ink !== expectInk) {
        state++;
        continue;
      }
      counts[state]++;
      if (counts[state] > maxRun) break;
      px += sign * dx;
      py += sign * dy;
    }
    // The quiet run needs only to be long enough, it may well run off to a glyph.
    if (state < 3) return null;
    runs.push(counts);
  }
  const [neg, pos] = runs;
  const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
  const core = neg[0] + pos[0] - 1;
  const unit = sealPattern(neg[2] * step, neg[1] * step, core * step, pos[1] * step, pos[2] * step);
  if (unit === 0) return null;
  if (Math.min(neg[3], pos[3]) * step < MIN_QUIET * unit) return null;
  return { unit, offset: (pos[0] - neg[0]) / 2 };
}

export type ScanAxis = 'rows' | 'columns';

/**
 * Confirms a scan hit along the perpendicular axis and both diagonals,
 * re-centring as it goes. A second direction besides the scan line must show
 * the seal pattern: that already rejects stripes and bars, yet keeps a seal
 * crossed by a scratch or a strip on one side. The ray-based measurement
 * (measureSeal) is the strict test.
 */
function confirm(bin: Uint8Array, w: number, h: number, hit: Hit, axis: ScanAxis): Hit | null {
  const maxRun = Math.ceil(hit.unit * 8);
  const [px, py, ax, ay] = axis === 'rows' ? [0, 1, 1, 0] : [1, 0, 0, 1];
  let cx = hit.x;
  let cy = hit.y;
  const units = [hit.unit];
  const perp = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), px, py, maxRun);
  if (perp) {
    units.push(perp.unit);
    cx = Math.floor(cx) + 0.5 + px * perp.offset;
    cy = Math.floor(cy) + 0.5 + py * perp.offset;
    // Re-centre along the scan axis too, now that the line runs through the centre.
    const along = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), ax, ay, maxRun);
    if (along) {
      cx = Math.floor(cx) + 0.5 + ax * along.offset;
      cy = Math.floor(cy) + 0.5 + ay * along.offset;
    }
  }
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
  ]) {
    const diag = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), dx, dy, maxRun);
    if (diag) units.push(diag.unit);
  }
  if (units.length < 2) return null;
  const lo = Math.min(...units);
  const hi = Math.max(...units);
  // Foreshortening changes the unit with direction, but never by more than this.
  if (hi > 1.8 * lo) return null;
  return { x: cx, y: cy, unit: units.reduce((s, u) => s + u, 0) / units.length };
}

/** Clustered seal hits: approximate centre, unit and number of supporting scan lines. */
export interface SealCluster {
  x: number;
  y: number;
  unit: number;
  count: number;
}

/** Scan along rows or columns + confirmation + clustering on one binarised frame. */
export function findSealHits(bin: Uint8Array, w: number, h: number, axis: ScanAxis = 'rows'): SealCluster[] {
  const clusters: SealCluster[] = [];
  const [lines, length, lineStride, step] = axis === 'rows' ? [h, w, w, 1] : [w, h, 1, w];
  const runs = new Int32Array(length + 2);
  for (let line = 0; line < lines; line++) {
    // Run lengths along the line, starting with a (possibly empty) light run.
    let n = 0;
    let len = 0;
    let ink = 0;
    for (let k = 0, idx = line * lineStride; k < length; k++, idx += step) {
      const v = bin[idx];
      if (v !== ink) {
        runs[n++] = len;
        len = 0;
        ink = v;
      }
      len++;
    }
    runs[n++] = len;
    // Dark runs sit at odd indices; a seal section needs light runs on both sides.
    let start = runs[0];
    for (let i = 1; i + 5 < n; i += 2) {
      const unit = sealPattern(runs[i], runs[i + 1], runs[i + 2], runs[i + 3], runs[i + 4]);
      if (unit > 0 && runs[i - 1] >= MIN_QUIET * unit && runs[i + 5] >= MIN_QUIET * unit) {
        const core = start + runs[i] + runs[i + 1] + runs[i + 2] / 2;
        const seed = axis === 'rows' ? { x: core, y: line + 0.5, unit } : { x: line + 0.5, y: core, unit };
        const hit = confirm(bin, w, h, seed, axis);
        if (hit) addToClusters(clusters, hit);
      }
      start += runs[i] + runs[i + 1];
    }
  }
  return clusters;
}

function addToClusters(clusters: SealCluster[], hit: Hit): void {
  for (const c of clusters) {
    if (Math.hypot(c.x - hit.x, c.y - hit.y) < 2 * Math.max(c.unit, hit.unit) && Math.abs(c.unit - hit.unit) < 0.5 * c.unit) {
      const k = c.count;
      c.x = (c.x * k + hit.x) / (k + 1);
      c.y = (c.y * k + hit.y) / (k + 1);
      c.unit = (c.unit * k + hit.unit) / (k + 1);
      c.count = k + 1;
      return;
    }
  }
  clusters.push({ x: hit.x, y: hit.y, unit: hit.unit, count: 1 });
}

/** Merge cluster lists found on several binarisations of the same frame. */
export function mergeClusters(lists: readonly SealCluster[][]): SealCluster[] {
  const merged: SealCluster[] = [];
  for (const list of lists) {
    for (const c of list) {
      const same = merged.find((m) => Math.hypot(m.x - c.x, m.y - c.y) < 2 * Math.max(m.unit, c.unit));
      if (!same) {
        merged.push({ ...c });
        continue;
      }
      const k = same.count + c.count;
      same.x = (same.x * same.count + c.x * c.count) / k;
      same.y = (same.y * same.count + c.y * c.count) / k;
      same.unit = (same.unit * same.count + c.unit * c.count) / k;
      same.count = k;
    }
  }
  return merged.sort((a, b) => b.count - a.count);
}

const RAY_COUNT = 48;

/**
 * Precise seal measurement around a cluster: ray casting on the gray image,
 * sub-pixel edges, ellipse fits. Returns null if the rays do not show a seal.
 */
export function measureSeal(img: GrayImage, cluster: SealCluster): SealCandidate | null {
  const first = measureAt(img, cluster.x, cluster.y, cluster.unit, cluster.count);
  // Rays from an off-centre origin (a hit confirmed on a damaged seal) give
  // skewed edge ratios: measure again from the fitted centre.
  if (first && Math.hypot(first.center.x - cluster.x, first.center.y - cluster.y) > 0.3 * cluster.unit) {
    return measureAt(img, first.center.x, first.center.y, first.unit, cluster.count) ?? first;
  }
  return first;
}

function measureAt(img: GrayImage, cx: number, cy: number, unit: number, hits: number): SealCandidate | null {
  const reach = 6.5 * unit;
  if (cx - reach < -unit || cy - reach < -unit || cx + reach > img.width + unit || cy + reach > img.height + unit) return null;
  const step = Math.min(0.5, unit / 6);
  const samples = Math.ceil(reach / step);

  // Ink level: the inner part of the core; paper level: the quiet ring, per ray.
  let ink = 0;
  let inkCount = 0;
  for (let k = 0; k < 9; k++) {
    const a = (k * Math.PI * 2) / 9;
    const r = k === 0 ? 0 : 0.9 * unit;
    ink += sampleBilinear(img, cx + r * Math.cos(a), cy + r * Math.sin(a));
    inkCount++;
  }
  ink /= inkCount;

  const profiles: Float64Array[] = [];
  const peaks: number[] = [];
  for (let k = 0; k < RAY_COUNT; k++) {
    const a = (k * Math.PI * 2) / RAY_COUNT;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const raw = new Float64Array(samples + 1);
    for (let i = 0; i <= samples; i++) raw[i] = sampleBilinear(img, cx + i * step * ca, cy + i * step * sa);
    // [1 2 1] smoothing suppresses sensor noise without moving edges.
    const p = new Float64Array(samples + 1);
    for (let i = 0; i <= samples; i++) p[i] = (raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(samples, i + 1)]) / 4;
    profiles.push(p);
    let peak = -Infinity;
    for (let i = Math.floor((3.8 * unit) / step); i <= samples; i++) peak = Math.max(peak, p[i]);
    peaks.push(peak);
  }
  const paper = [...peaks].sort((p, q) => p - q)[peaks.length >> 1];
  if (!(paper - ink > 12)) return null;
  const threshold = (ink + paper) / 2;

  const ring: [number[], number[]] = [[], []];
  const core: [number[], number[]] = [[], []];
  for (let k = 0; k < RAY_COUNT; k++) {
    const p = profiles[k];
    const a = (k * Math.PI * 2) / RAY_COUNT;
    const edges = rayEdges(p, threshold, Math.floor((0.8 * unit) / step));
    if (!edges) continue;
    const [e2, e3, e4] = edges.map((i) => i * step);
    if (e4 < 2.4 * unit || e4 > 6 * unit) continue;
    if (e2 / e4 < 0.38 || e2 / e4 > 0.6 || e3 / e4 < 0.64 || e3 / e4 > 0.82) continue;
    // Mid-ring radius is free of blur/threshold bias: both ring edges move symmetrically.
    const mid = (e3 + e4) / 2;
    ring[0].push(cx + mid * Math.cos(a));
    ring[1].push(cy + mid * Math.sin(a));
    core[0].push(cx + e2 * Math.cos(a));
    core[1].push(cy + e2 * Math.sin(a));
  }
  if (ring[0].length < RAY_COUNT * 0.6) return null;
  const ringFit = fitEllipseRobust(ring[0], ring[1], Math.max(0.5, 0.15 * unit));
  if (!ringFit || ringFit.inliers < RAY_COUNT * 0.5) return null;
  const coreFit = fitEllipseRobust(core[0], core[1], Math.max(0.5, 0.15 * unit));

  // Combine: the ring (radius 3.5 u) defines the shape; the core fit (2 u)
  // only adds to the centre estimate, with weight by support and radius.
  const fits: [Ellipse, number, number][] = [[ringFit.ellipse, 3.5, ringFit.inliers * 3.5 * 3.5]];
  if (coreFit && coreFit.inliers >= RAY_COUNT * 0.5) fits.push([coreFit.ellipse, 2.0, coreFit.inliers * 2 * 2 * 0.5]);
  let wsum = 0;
  let ex = 0;
  let ey = 0;
  for (const [el, , wgt] of fits) {
    ex += el.cx * wgt;
    ey += el.cy * wgt;
    wsum += wgt;
  }
  ex /= wsum;
  ey /= wsum;
  const R = 3.5;
  const q = ringFit.ellipse.m.map((v) => v * R * R) as [number, number, number];
  const affine = inverseSqrtSym(q);
  if (!affine) return null;
  const det = affine[0] * affine[3] - affine[1] * affine[2];
  const sealUnit = Math.sqrt(Math.abs(det));
  // Eigen-ratio of the shape: a seal seen beyond ~70° tilt is not decodable anyway.
  const [l1, l2] = symEigenvalues(q);
  if (!(Math.sqrt(Math.min(l1, l2) / Math.max(l1, l2)) > 0.3)) return null;
  if (sealUnit < MIN_UNIT * 0.8) return null;
  const support = ringFit.inliers / RAY_COUNT;
  const score = support * (1 / (1 + ringFit.rms / sealUnit)) * Math.log2(2 + hits) * ((paper - ink) / 255 + 0.2);
  return { center: { x: ex, y: ey }, affine, unit: sealUnit, ink, paper, score };
}

/**
 * Indices (fractional) of the core edge (up-crossing), ring inner edge
 * (down-crossing) and ring outer edge (up-crossing) along a radial profile.
 */
function rayEdges(p: Float64Array, t: number, start: number): [number, number, number] | null {
  const out: number[] = [];
  let wantUp = true;
  for (let i = Math.max(1, start); i < p.length && out.length < 3; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (wantUp ? a < t && b >= t : a >= t && b < t) {
      out.push(i - 1 + (t - a) / (b - a));
      wantUp = !wantUp;
    }
  }
  return out.length === 3 ? [out[0], out[1], out[2]] : null;
}

function symEigenvalues([a, b, c]: [number, number, number]): [number, number] {
  const mean = (a + c) / 2;
  const d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return [mean + d, mean - d];
}

/** Symmetric Q^(−1/2) for SPD Q = [a, b; b, c], as [m11, m12, m21, m22]. */
function inverseSqrtSym(q: [number, number, number]): [number, number, number, number] | null {
  const [a, b, c] = q;
  const [l1, l2] = symEigenvalues(q);
  if (!(l2 > 0)) return null;
  // Eigenvector of l1.
  let vx: number;
  let vy: number;
  if (Math.abs(b) > 1e-12) {
    vx = l1 - c;
    vy = b;
  } else if (a >= c) {
    vx = 1;
    vy = 0;
  } else {
    vx = 0;
    vy = 1;
  }
  const n = Math.hypot(vx, vy);
  vx /= n;
  vy /= n;
  const s1 = 1 / Math.sqrt(l1);
  const s2 = 1 / Math.sqrt(l2);
  // V diag(s1, s2) Vᵀ with V = [v, v⊥].
  const m11 = s1 * vx * vx + s2 * vy * vy;
  const m12 = (s1 - s2) * vx * vy;
  const m22 = s1 * vy * vy + s2 * vx * vx;
  return [m11, m12, m12, m22];
}
