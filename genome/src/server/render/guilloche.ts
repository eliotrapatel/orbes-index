/**
 * The guilloche of the certificate card 79t (plan NEXT LOT §3.2): the fine
 * security texture inside the monogram and the year. Two families of sine
 * waves, half a wave apart, crossing into the lattice of a banknote's ground,
 * as 79t's tex.py draws them (`guilloche_path`):
 *
 *   y = yb + A · sin(2π (x − cx) / λ + φ),  φ ∈ {0, π},  yb on a pitch grid
 *
 * The waves are anchored on the card (the phase on `cx`, the rows on the
 * pitch grid from y = 0), so two areas drawn apart (the monogram and the year)
 * share one lattice. tex.py samples each wave as a polyline every 0.04 mm;
 * here each quarter wave is one cubic Bézier through the same points with the
 * same slopes (Hermite), four per wavelength: the same shape within a few
 * micrometres, at a tenth of the size (plan §3.2, Default (mine)).
 */

export interface GuillocheSpec {
  /** Distance between two waves of one family, mm. */
  pitch: number;
  /** Amplitude, mm. */
  amplitude: number;
  /** Wavelength, mm. */
  wavelength: number;
}

/** 79t's waves: pitch 0.30, amplitude 0.42, wavelength 2.2 mm. */
export const GUILLOCHE_79T: Readonly<GuillocheSpec> = Object.freeze({ pitch: 0.3, amplitude: 0.42, wavelength: 2.2 });

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) throw new RangeError('non-finite coordinate');
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/**
 * The waves covering the box (x0..x1, y0..y1), as one path to stroke: every row of both families whose wave can
 * reach the box (tex.py's rows: from the pitch grid line under y0 − A, two more than the box needs), each from the
 * quarter-wave node at or before x0 to the one at or after x1. Clip it to the shape it fills.
 */
export function guillochePath(box: { x0: number; x1: number; y0: number; y1: number }, cx: number, spec: GuillocheSpec = GUILLOCHE_79T): string {
  const { pitch, amplitude: A, wavelength: lam } = spec;
  if (![box.x0, box.x1, box.y0, box.y1, cx].every(Number.isFinite) || box.x1 <= box.x0 || box.y1 <= box.y0) throw new RangeError('a guilloche needs a box');
  if (!(pitch > 0 && A >= 0 && lam > 0)) throw new RangeError('a guilloche needs a positive pitch and wavelength');
  const ys = Math.floor((box.y0 - A) / pitch) * pitch;
  const rows = Math.floor((box.y1 + A - ys) / pitch) + 2;
  const quarter = lam / 4;
  const w = (2 * Math.PI) / lam;
  let d = '';
  for (const phase of [0, Math.PI]) {
    // Nodes where the wave's argument is a multiple of π/2: x = cx + (kπ/2 − φ)/w.
    const nodeX = (k: number) => cx + (k * (Math.PI / 2) - phase) / w;
    const kFirst = Math.floor((box.x0 - nodeX(0)) / quarter + 1e-9);
    const kLast = Math.ceil((box.x1 - nodeX(0)) / quarter - 1e-9);
    for (let i = 0; i < rows; i++) {
      const yb = ys + i * pitch;
      const y = (x: number) => yb + A * Math.sin(w * (x - cx) + phase);
      const slope = (x: number) => A * w * Math.cos(w * (x - cx) + phase);
      const x0 = nodeX(kFirst);
      d += `M${fmt(x0)} ${fmt(y(x0))}`;
      for (let k = kFirst; k < kLast; k++) {
        const xa = nodeX(k);
        const xb = nodeX(k + 1);
        const h = (xb - xa) / 3;
        d += `C${fmt(xa + h)} ${fmt(y(xa) + h * slope(xa))} ${fmt(xb - h)} ${fmt(y(xb) - h * slope(xb))} ${fmt(xb)} ${fmt(y(xb))}`;
      }
    }
  }
  return d;
}
