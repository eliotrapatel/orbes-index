/**
 * The guilloche of the card 79t (render/guilloche.ts, plan NEXT LOT §3.2):
 * tex.py's two families of sine waves (pitch 0.30, amplitude 0.42,
 * wavelength 2.2 mm, half a wave apart, anchored on the card), drawn as one
 * cubic Bézier per quarter wave instead of tex.py's 0.04 mm polyline: the same
 * curve within a few micrometres.
 */
import { describe, expect, it } from 'vitest';
import { GUILLOCHE_79T, guillochePath } from '../../src/server/render/guilloche.js';

type Wave = { x0: number; y0: number; segments: number[][] };

/** The path's waves: each M and its C segments. */
function waves(d: string): Wave[] {
  return d
    .split('M')
    .filter(Boolean)
    .map((w) => {
      const [start, ...cs] = w.split('C');
      const [x0, y0] = start.trim().split(' ').map(Number);
      return { x0, y0, segments: cs.map((c) => c.trim().split(' ').map(Number)) };
    });
}

const bezier = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

describe('guilloche (render/guilloche.ts)', () => {
  const box = { x0: 67.0659, x1: 82.4659, y0: 16.8732, y1: 28.0028 };
  const cx = 74.7659125;

  it("draws tex.py's rows: from the pitch line under y0 − A, two more than the box needs, for each of the two families", () => {
    const { pitch, amplitude: A } = GUILLOCHE_79T;
    const ys = Math.floor((box.y0 - A) / pitch) * pitch;
    const rows = Math.floor((box.y1 + A - ys) / pitch) + 2;
    const w = waves(guillochePath(box, cx));
    expect(w).toHaveLength(2 * rows);
    // Each wave spans the box, from the quarter-wave node at or before x0 to the one at or after x1.
    for (const { x0, segments } of w) {
      expect(x0).toBeLessThanOrEqual(box.x0 + 1e-3);
      expect(x0).toBeGreaterThan(box.x0 - 2.2 / 4 - 1e-3);
      const end = segments[segments.length - 1][4];
      expect(end).toBeGreaterThanOrEqual(box.x1 - 1e-3);
      expect(end).toBeLessThan(box.x1 + 2.2 / 4 + 1e-3);
    }
  });

  it('follows the sine within 5 µm: y = yb + A · sin(2π (x − cx) / λ + φ), the second family half a wave apart', () => {
    const { pitch, amplitude: A, wavelength: lam } = GUILLOCHE_79T;
    const ys = Math.floor((box.y0 - A) / pitch) * pitch;
    const w = waves(guillochePath(box, cx));
    const rows = w.length / 2;
    let worst = 0;
    w.forEach((wave, i) => {
      const phase = i < rows ? 0 : Math.PI;
      const yb = ys + (i % rows) * pitch;
      let [px, py] = [wave.x0, wave.y0];
      for (const [x1, y1, x2, y2, x3, y3] of wave.segments) {
        for (let t = 0; t <= 1; t += 0.05) {
          const x = bezier(px, x1, x2, x3, t);
          const y = bezier(py, y1, y2, y3, t);
          worst = Math.max(worst, Math.abs(y - (yb + A * Math.sin((2 * Math.PI * (x - cx)) / lam + phase))));
        }
        [px, py] = [x3, y3];
      }
    });
    expect(worst).toBeLessThan(0.005);
  });

  it('is anchored on the card: two boxes drawn apart share one lattice (the monogram and the year)', () => {
    const year = { x0: 70.6, x1: 78.9, y0: 21.1, y1: 23.8 };
    // Every point the smaller box's waves pass through at a quarter-wave node is one of the larger box's.
    const nodes = (d: string) => new Set(waves(d).flatMap((w) => [`${w.x0.toFixed(3)} ${w.y0.toFixed(3)}`, ...w.segments.map((s) => `${s[4].toFixed(3)} ${s[5].toFixed(3)}`)]));
    const mono = nodes(guillochePath(box, cx));
    const inYear = nodes(guillochePath(year, cx));
    expect(inYear.size).toBeGreaterThan(100);
    for (const p of inYear) expect(mono.has(p), p).toBe(true);
  });

  it('refuses a box it cannot fill', () => {
    expect(() => guillochePath({ x0: 1, x1: 1, y0: 0, y1: 1 }, 0)).toThrow(RangeError);
    expect(() => guillochePath({ x0: 0, x1: 1, y0: 0, y1: 1 }, 0, { pitch: 0, amplitude: 0.4, wavelength: 2 })).toThrow(RangeError);
  });
});
