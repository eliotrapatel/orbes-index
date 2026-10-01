import { describe, expect, it } from 'vitest';
import { inkBlobs } from '../../src/core/decoder/components.js';
import { ellipseDistance, fitEllipse, fitEllipseRobust } from '../../src/core/decoder/ellipse.js';
import { applyH, homographyFromPoints, invertH, jacobianH, multiplyH, solveLinear } from '../../src/core/decoder/homography.js';
import { Prng } from '../support/prng.js';

/** Points on the ellipse centred at (cx, cy), semi-axes a, b, rotated by phi. */
function ellipsePoints(cx: number, cy: number, a: number, b: number, phi: number, n: number, rng?: Prng, noise = 0) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    xs.push(cx + x * Math.cos(phi) - y * Math.sin(phi) + (rng ? rng.normal(0, noise) : 0));
    ys.push(cy + x * Math.sin(phi) + y * Math.cos(phi) + (rng ? rng.normal(0, noise) : 0));
  }
  return { xs, ys };
}

describe('fitEllipse', () => {
  it('recovers an exact ellipse: centre and shape matrix', () => {
    const { xs, ys } = ellipsePoints(312.4, 187.9, 40, 25, 0.6, 24);
    const el = fitEllipse(xs, ys);
    expect(el).not.toBeNull();
    expect(el!.cx).toBeCloseTo(312.4, 6);
    expect(el!.cy).toBeCloseTo(187.9, 6);
    // Every input point satisfies (p − c)ᵀ M (p − c) = 1.
    for (let i = 0; i < xs.length; i++) expect(ellipseDistance(el!, xs[i], ys[i])).toBeLessThan(1e-6);
    // Eigenvalues of M are 1/a² and 1/b².
    const [m11, m12, m22] = el!.m;
    const mean = (m11 + m22) / 2;
    const d = Math.sqrt(((m11 - m22) / 2) ** 2 + m12 * m12);
    expect(1 / Math.sqrt(mean - d)).toBeCloseTo(40, 6);
    expect(1 / Math.sqrt(mean + d)).toBeCloseTo(25, 6);
  });

  it('works from a partial arc and stays accurate under noise', () => {
    const rng = new Prng('ellipse-noise');
    const full = ellipsePoints(50, 60, 30, 18, -0.3, 48, rng, 0.3);
    const el = fitEllipse(full.xs.slice(0, 30), full.ys.slice(0, 30));
    expect(el).not.toBeNull();
    expect(Math.hypot(el!.cx - 50, el!.cy - 60)).toBeLessThan(0.5);
  });

  it('returns null for too few or degenerate points', () => {
    expect(fitEllipse([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBeNull();
    expect(fitEllipse([0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(fitEllipse(new Array(10).fill(3), new Array(10).fill(4))).toBeNull();
  });

  it('rejects outliers in the robust variant', () => {
    const rng = new Prng('ellipse-outliers');
    const { xs, ys } = ellipsePoints(100, 100, 20, 20, 0, 40, rng, 0.1);
    for (const k of [3, 11, 25]) {
      xs[k] += 9;
      ys[k] -= 7;
    }
    const fit = fitEllipseRobust(xs, ys, 0.5);
    expect(fit).not.toBeNull();
    expect(fit!.inliers).toBe(37);
    expect(Math.hypot(fit!.ellipse.cx - 100, fit!.ellipse.cy - 100)).toBeLessThan(0.1);
    expect(fit!.rms).toBeLessThan(0.3);
  });
});

describe('homography', () => {
  const H = [1.3, 0.2, 400, -0.15, 1.1, 250, 0.0004, -0.0003, 1];

  it('solves linear systems with pivoting and flags singular ones', () => {
    const x = solveLinear(new Float64Array([0, 2, 1, 1, 1, 1, 2, 1, 0]), new Float64Array([5, 4, 4]), 3);
    expect(Array.from(x!).map((v) => +v.toFixed(9))).toEqual([1, 2, 1]);
    expect(solveLinear(new Float64Array([1, 2, 2, 4]), new Float64Array([1, 2]), 2)).toBeNull();
  });

  it('recovers a projective map exactly from four points and by least squares from more', () => {
    const src = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
      { x: 0, y: 0 },
      { x: 7, y: -13 },
    ];
    const dst = src.map((p) => applyH(H, p.x, p.y));
    for (const n of [4, 6]) {
      const fit = homographyFromPoints(src.slice(0, n), dst.slice(0, n));
      expect(fit).not.toBeNull();
      fit!.forEach((v, i) => expect(v).toBeCloseTo(H[i], 8));
    }
  });

  it('inverts and composes', () => {
    const inv = invertH(H)!;
    // H·H⁻¹ is the identity up to scale.
    const id = multiplyH(H, inv).map((v, _, m) => v / m[8]);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(id[i]).toBeCloseTo(v, 9));
    const p = applyH(inv, ...(Object.values(applyH(H, 3.5, -8)) as [number, number]));
    expect(p.x).toBeCloseTo(3.5, 9);
    expect(p.y).toBeCloseTo(-8, 9);
    expect(invertH([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });

  it('returns null for degenerate correspondences', () => {
    const line = [0, 1, 2, 3].map((k) => ({ x: k, y: 2 * k }));
    expect(homographyFromPoints(line, line)).toBeNull();
    expect(homographyFromPoints(line.slice(0, 3), line.slice(0, 3))).toBeNull();
  });

  it('has the finite-difference Jacobian', () => {
    const [a, b, c, d] = jacobianH(H, 5, -7);
    const e = 1e-5;
    const p = applyH(H, 5, -7);
    const px = applyH(H, 5 + e, -7);
    const py = applyH(H, 5, -7 + e);
    expect(a).toBeCloseTo((px.x - p.x) / e, 4);
    expect(b).toBeCloseTo((py.x - p.x) / e, 4);
    expect(c).toBeCloseTo((px.y - p.y) / e, 4);
    expect(d).toBeCloseTo((py.y - p.y) / e, 4);
  });
});

describe('inkBlobs', () => {
  it('labels connected ink regions with area, centroid and ellipse moments', () => {
    const w = 60;
    const h = 40;
    const bin = new Uint8Array(w * h);
    // Disc of radius 8 at (20.5, 20.5) and a 3 × 20 bar.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - 20.5, y + 0.5 - 20.5) <= 8) bin[y * w + x] = 1;
    for (let y = 5; y < 25; y++) for (let x = 45; x < 48; x++) bin[y * w + x] = 1;
    // A U shape whose arms only join at the bottom (labels merge late).
    for (let y = 30; y < 38; y++) {
      bin[y * w + 40] = 1;
      bin[y * w + 50] = 1;
    }
    for (let x = 40; x <= 50; x++) bin[37 * w + x] = 1;
    const blobs = inkBlobs(bin, w, h, 1, 10_000).sort((p, q) => q.area - p.area);
    expect(blobs).toHaveLength(3);
    const disc = blobs[0];
    expect(disc.x).toBeCloseTo(20.5, 6);
    expect(disc.y).toBeCloseTo(20.5, 6);
    expect(disc.a).toBeCloseTo(8, 0);
    expect(disc.fill).toBeGreaterThan(0.95);
    expect(disc.fill).toBeLessThan(1.05);
    const bar = blobs.find((b) => b.area === 60)!;
    expect(bar.a / bar.b).toBeGreaterThan(5);
    expect(blobs.find((b) => b.area === 8 + 8 + 9)).toBeDefined();
    expect(inkBlobs(bin, w, h, 100, 300)).toHaveLength(1);
  });

  it('gives up on texture with more provisional labels than allowed', () => {
    const w = 50;
    const bin = new Uint8Array(w * w);
    for (let y = 0; y < w; y += 2) for (let x = 0; x < w; x += 2) bin[y * w + x] = 1;
    expect(inkBlobs(bin, w, w, 1, 10, 100)).toEqual([]);
    expect(inkBlobs(bin, w, w, 1, 10)).toHaveLength(625);
  });
});
