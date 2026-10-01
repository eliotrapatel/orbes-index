/**
 * Direct least-squares ellipse fitting (Fitzgibbon, Pilu & Fisher 1999, in
 * the numerically stable formulation of Halíř & Flusser 1998). The fit is
 * ellipse-specific: the constraint 4AC − B² = 1 rules out hyperbolas and
 * parabolas, so even a partial or noisy edge set yields an ellipse or nothing.
 *
 * Ellipses are returned in centre form (p − c)ᵀ M (p − c) = 1 with M
 * symmetric positive definite, which is what the seal → affine step needs.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

export interface Ellipse {
  cx: number;
  cy: number;
  /** Symmetric positive definite shape matrix [m11, m12, m22]. */
  m: [number, number, number];
}

/** Real roots of x³ + a x² + b x + c (one or three). */
function cubicRoots(a: number, b: number, c: number): number[] {
  const q = (a * a - 3 * b) / 9;
  const r = (2 * a * a * a - 9 * a * b + 27 * c) / 54;
  if (r * r < q * q * q) {
    const theta = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(q * q * q))));
    const s = -2 * Math.sqrt(q);
    return [0, 1, -1].map((k) => s * Math.cos((theta + 2 * Math.PI * k) / 3) - a / 3);
  }
  const big = -Math.sign(r) * Math.cbrt(Math.abs(r) + Math.sqrt(r * r - q * q * q));
  const small = big === 0 ? 0 : q / big;
  return [big + small - a / 3];
}

/** Inverse of a symmetric 3×3 matrix (row-major), null when singular. */
function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

/** Null vector of a (rank-2) 3×3 matrix: the largest cross product of two rows. */
function nullVector(m: number[]): number[] {
  const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
  let best = [0, 0, 0];
  let bestNorm = 0;
  for (const [i, j] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    const [p, q] = [rows[i], rows[j]];
    const v = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n > bestNorm) {
      best = v;
      bestNorm = n;
    }
  }
  return best;
}

/**
 * Fit an ellipse to points (xs[i], ys[i]). Needs at least 6 points; returns
 * null when the points do not determine a proper ellipse.
 */
export function fitEllipse(xs: ArrayLike<number>, ys: ArrayLike<number>): Ellipse | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 6) return null;
  // Normalise (centroid, RMS radius √2) to keep the scatter matrices well conditioned.
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let spread = 0;
  for (let i = 0; i < n; i++) spread += (xs[i] - mx) ** 2 + (ys[i] - my) ** 2;
  const scale = Math.sqrt(spread / (2 * n));
  if (!(scale > 1e-9)) return null;

  // Scatter blocks S1 = D1ᵀD1, S2 = D1ᵀD2, S3 = D2ᵀD2 with D1 = [x², xy, y²], D2 = [x, y, 1].
  const s1 = new Array<number>(9).fill(0);
  const s2 = new Array<number>(9).fill(0);
  const s3 = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) {
    const x = (xs[i] - mx) / scale;
    const y = (ys[i] - my) / scale;
    const d1 = [x * x, x * y, y * y];
    const d2 = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        s1[r * 3 + c] += d1[r] * d1[c];
        s2[r * 3 + c] += d1[r] * d2[c];
        s3[r * 3 + c] += d2[r] * d2[c];
      }
    }
  }
  const s3inv = invert3(s3);
  if (!s3inv) return null;
  // T = −S3⁻¹ S2ᵀ ; M = S1 + S2 T ; then premultiply by C1⁻¹.
  const t = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += s3inv[r * 3 + k] * s2[c * 3 + k];
      t[r * 3 + c] = -acc;
    }
  }
  const m = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let acc = s1[r * 3 + c];
      for (let k = 0; k < 3; k++) acc += s2[r * 3 + k] * t[k * 3 + c];
      m[r * 3 + c] = acc;
    }
  }
  const reduced = [m[6] / 2, m[7] / 2, m[8] / 2, -m[3], -m[4], -m[5], m[0] / 2, m[1] / 2, m[2] / 2];

  // Characteristic polynomial of the 3×3 reduced matrix.
  const [a, b, c, d, e, f, g, h, k] = reduced;
  const trace = a + e + k;
  const minors = a * e - b * d + a * k - c * g + e * k - f * h;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  let best: number[] | null = null;
  let bestCond = 0;
  for (const lambda of cubicRoots(-trace, minors, -det)) {
    const v = nullVector([a - lambda, b, c, d, e - lambda, f, g, h, k - lambda]);
    const cond = 4 * v[0] * v[2] - v[1] * v[1];
    if (cond > bestCond) {
      bestCond = cond;
      best = v;
    }
  }
  if (!best) return null;
  const lin = [0, 1, 2].map((r) => t[r * 3] * best[0] + t[r * 3 + 1] * best[1] + t[r * 3 + 2] * best[2]);
  return conicToEllipse(best[0], best[1], best[2], lin[0], lin[1], lin[2], mx, my, scale);
}

/** Conic A x² + B xy + C y² + D x + E y + F = 0 in normalised coordinates → centre form in pixels. */
function conicToEllipse(
  A: number,
  B: number,
  C: number,
  D: number,
  E: number,
  F: number,
  mx: number,
  my: number,
  scale: number,
): Ellipse | null {
  const det = 4 * A * C - B * B;
  if (!(Math.abs(det) > 1e-15)) return null;
  const x0 = (B * E - 2 * C * D) / det;
  const y0 = (B * D - 2 * A * E) / det;
  const fc = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
  if (!(Math.abs(fc) > 1e-15)) return null;
  const m11 = A / -fc / (scale * scale);
  const m12 = B / 2 / -fc / (scale * scale);
  const m22 = C / -fc / (scale * scale);
  if (!(m11 > 0 && m22 > 0 && m11 * m22 - m12 * m12 > 0)) return null;
  return { cx: x0 * scale + mx, cy: y0 * scale + my, m: [m11, m12, m22] };
}

/** Approximate geometric distance (pixels) from (x, y) to the ellipse, along the ray from its centre. */
export function ellipseDistance(el: Ellipse, x: number, y: number): number {
  const dx = x - el.cx;
  const dy = y - el.cy;
  const q = el.m[0] * dx * dx + 2 * el.m[1] * dx * dy + el.m[2] * dy * dy;
  const r = Math.hypot(dx, dy);
  if (q <= 0) return r;
  return Math.abs(r - r / Math.sqrt(q));
}

/**
 * Fit with outlier rejection: refit up to twice without the points further
 * than max(`minTolerance`, 3 × median distance) from the previous fit.
 */
export function fitEllipseRobust(xs: number[], ys: number[], minTolerance: number): { ellipse: Ellipse; inliers: number; rms: number } | null {
  let px = xs;
  let py = ys;
  let el = fitEllipse(px, py);
  for (let round = 0; round < 2 && el; round++) {
    const fit = el;
    const dist = px.map((x, i) => ellipseDistance(fit, x, py[i]));
    const sorted = [...dist].sort((p, q) => p - q);
    const tol = Math.max(minTolerance, 3 * sorted[sorted.length >> 1]);
    const keep = dist.map((d) => d <= tol);
    if (keep.every(Boolean)) break;
    px = px.filter((_, i) => keep[i]);
    py = py.filter((_, i) => keep[i]);
    el = fitEllipse(px, py);
  }
  if (!el) return null;
  const fit = el;
  const rms = Math.sqrt(px.reduce((s, x, i) => s + ellipseDistance(fit, x, py[i]) ** 2, 0) / px.length);
  return { ellipse: el, inliers: px.length, rms };
}
