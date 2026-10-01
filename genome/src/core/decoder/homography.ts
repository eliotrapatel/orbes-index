/**
 * Planar homographies (row-major 3×3, h[8] = 1) and their estimation by the
 * normalised DLT (Hartley): both point sets are centred and scaled to RMS
 * distance √2 before solving, which keeps the linear system well conditioned
 * whatever the pixel scale. With exactly four correspondences the solution is
 * exact; with more it is the algebraic least-squares fit.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import type { Point } from '../geometry.js';

export type Homography = number[];

/** Solve A x = b (n×n, row-major, destroyed) by Gaussian elimination with partial pivoting. */
export function solveLinear(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * n + col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (!(best > 1e-12)) return null;
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = a[col * n + c];
        a[col * n + c] = a[pivot * n + c];
        a[pivot * n + c] = tmp;
      }
      const tb = b[col];
      b[col] = b[pivot];
      b[pivot] = tb;
    }
    const diag = a[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col] / diag;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let c = r + 1; c < n; c++) acc -= a[r * n + c] * x[c];
    x[r] = acc / a[r * n + r];
  }
  return x;
}

/** Similarity that moves the centroid to the origin and the RMS distance to √2, as a homography. */
function normalizer(points: readonly Point[]): Homography | null {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let d = 0;
  for (const p of points) d += (p.x - mx) ** 2 + (p.y - my) ** 2;
  const rms = Math.sqrt(d / points.length);
  if (!(rms > 1e-12)) return null;
  const s = Math.SQRT2 / rms;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

export function multiplyH(a: Homography, b: Homography): Homography {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function invertH(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k;
  const B = f * g - d * i;
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  return normalizeH([
    A / det,
    (c * k - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * k) / det,
    (a * e - b * d) / det,
  ]);
}

function normalizeH(h: Homography): Homography | null {
  if (!(Math.abs(h[8]) > 1e-15)) return null;
  const s = 1 / h[8];
  const out = h.map((v) => v * s);
  return out.every(Number.isFinite) ? out : null;
}

export function applyH(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/**
 * Homography mapping src[i] → dst[i] (at least 4 pairs, no three of the
 * first four collinear). Returns null for degenerate configurations.
 */
export function homographyFromPoints(src: readonly Point[], dst: readonly Point[]): Homography | null {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const ns = normalizer(src.slice(0, n));
  const nd = normalizer(dst.slice(0, n));
  if (!ns || !nd) return null;
  // Normal equations of the 2n × 8 system with h33 = 1 (safe: the normalised
  // source centroid is the origin, which never maps to infinity here).
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  const row = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const p = applyH(ns, src[i].x, src[i].y);
    const q = applyH(nd, dst[i].x, dst[i].y);
    for (let eq = 0; eq < 2; eq++) {
      row.fill(0);
      let rhs: number;
      if (eq === 0) {
        row[0] = p.x;
        row[1] = p.y;
        row[2] = 1;
        row[6] = -p.x * q.x;
        row[7] = -p.y * q.x;
        rhs = q.x;
      } else {
        row[3] = p.x;
        row[4] = p.y;
        row[5] = 1;
        row[6] = -p.x * q.y;
        row[7] = -p.y * q.y;
        rhs = q.y;
      }
      for (let r = 0; r < 8; r++) {
        if (row[r] === 0) continue;
        atb[r] += row[r] * rhs;
        for (let c = 0; c < 8; c++) ata[r * 8 + c] += row[r] * row[c];
      }
    }
  }
  const x = solveLinear(ata, atb, 8);
  if (!x) return null;
  const hn = [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], 1];
  const ndInv = invertH(nd);
  if (!ndInv) return null;
  return normalizeH(multiplyH(ndInv, multiplyH(hn, ns)));
}

/** Local linear part (Jacobian) of h at code-plane point (x, y): [dX/dx, dX/dy, dY/dx, dY/dy]. */
export function jacobianH(h: Homography, x: number, y: number): [number, number, number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  const X = (h[0] * x + h[1] * y + h[2]) / w;
  const Y = (h[3] * x + h[4] * y + h[5]) / w;
  return [(h[0] - h[6] * X) / w, (h[1] - h[7] * X) / w, (h[3] - h[6] * Y) / w, (h[4] - h[7] * Y) / w];
}
