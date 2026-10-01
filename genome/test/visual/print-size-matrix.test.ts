/**
 * Physical model of scripts/print-size-matrix.ts: optics, scanner crop,
 * fit and defocus rules, per-trial capture parameters, and the adaptive
 * trial logic on two small real rows. The full matrix is a script (minutes);
 * these checks keep its model honest in seconds.
 */
import { describe, expect, it } from 'vitest';
import { CODE01_SIZE } from '../../src/core/code/index.js';
import { cameraCrop } from '../../src/web/verify/capture.js';
import {
  CROP,
  PROFILES,
  STREAM,
  VIEWPORT,
  defocusCirclePx,
  fitsCrop,
  focalPx,
  pxPerMm,
  runRow,
  trialSetup,
  type Cell,
} from '../../scripts/print-size-matrix.js';
import { RENDITIONS, SCAN_DISTANCES_CM, SHEET_SIZES_MM } from '../../scripts/test-sheets.js';
import { Prng } from '../support/prng.js';

const profile = (id: string) => PROFILES.find((p) => p.id === id)!;
const rendition = (id: string) => RENDITIONS.find((r) => r.id === id)!;

describe('phone and scanner model', () => {
  it('decodes the square the scanner itself crops under its reticle', () => {
    const reticle = Math.min(0.66 * VIEWPORT.width, 0.4 * VIEWPORT.height, 340);
    expect(CROP).toEqual(cameraCrop({ width: STREAM.height, height: STREAM.width }, VIEWPORT, reticle));
    expect(CROP.sw).toBeGreaterThan(800);
    expect(CROP.sw).toBeLessThanOrEqual(STREAM.height);
  });

  it('derives the focal length from the horizontal field of view, doubled by 2× zoom', () => {
    for (const p of PROFILES) {
      expect(p.hfovDeg).toBeGreaterThanOrEqual(65);
      expect(p.hfovDeg).toBeLessThanOrEqual(70);
      expect(focalPx(p)).toBeCloseTo((p.zoom * 960) / Math.tan(((p.hfovDeg / 2) * Math.PI) / 180), 9);
    }
    expect(focalPx(profile('android-2x'))).toBeCloseTo(2 * focalPx(profile('android-1x')), 9);
    // ≈ 14 px/mm at 10 cm with a 68° lens: a 10 mm code is ≈ 2.8 px per u.
    expect(pxPerMm(profile('android-1x'), 100)).toBeCloseTo(14.23, 1);
    expect((pxPerMm(profile('android-1x'), 100) * 10) / CODE01_SIZE).toBeCloseTo(2.85, 1);
  });

  it('models minimum focus distances of 8 cm (Android), 12 cm (iPhone) and 20 cm (iPhone Pro)', () => {
    expect(profile('android-1x').minFocusMm).toBe(80);
    expect(profile('iphone-1x').minFocusMm).toBe(120);
    expect(profile('iphone-pro-1x').minFocusMm).toBe(200);
  });

  it('blurs only closer than the minimum focus, growing as the code gets closer (thin lens)', () => {
    const p = profile('iphone-1x');
    expect(defocusCirclePx(p, 120)).toBe(0);
    expect(defocusCirclePx(p, 250)).toBe(0);
    const c100 = defocusCirclePx(p, 100);
    const c80 = defocusCirclePx(p, 80);
    expect(c80).toBeGreaterThan(c100);
    // c = A·f_px·(s − d)/((s − f)·d) with A = f/N.
    const A = p.focalMm / p.fNumber;
    expect(c100).toBeCloseTo((A * focalPx(p) * 20) / ((120 - p.focalMm) * 100), 9);
    // Zoom magnifies the blur circle exactly as much as the code: the same blur in u.
    const z = profile('iphone-2x');
    expect(defocusCirclePx(z, 100) / pxPerMm(z, 100)).toBeCloseTo(c100 / pxPerMm(p, 100), 9);
    // The Android lens is never out of focus on the 8–25 cm grid.
    for (const d of SCAN_DISTANCES_CM) expect(defocusCirclePx(profile('android-1x'), d * 10)).toBe(0);
  });

  it('flags codes too large for the crop, monotonically in size and distance', () => {
    const p = profile('android-1x');
    expect(fitsCrop(p, 30, 80)).toBe(true);
    expect(fitsCrop(p, 50, 80)).toBe(false);
    for (const prof of PROFILES) {
      for (const d of SCAN_DISTANCES_CM) {
        const fits = SHEET_SIZES_MM.map((s) => fitsCrop(prof, s, d * 10));
        expect(fits.indexOf(false) === -1 || fits.slice(fits.indexOf(false)).every((f) => !f)).toBe(true);
      }
      for (const s of SHEET_SIZES_MM) {
        const fits = SCAN_DISTANCES_CM.map((d) => fitsCrop(prof, s, d * 10));
        expect(fits.indexOf(true) === -1 || fits.slice(fits.indexOf(true)).every(Boolean)).toBe(true);
      }
    }
  });

  it('builds seeded, hand-held capture parameters on the scanner crop', () => {
    const r = rendition('black-leather');
    const p = profile('iphone-pro-1x');
    const a = trialSetup(r, p, 20, 15, new Prng('t'));
    const b = trialSetup(r, p, 20, 15, new Prng('t'));
    expect(a).toEqual(b);
    expect(a.params.frame).toEqual({ width: CROP.sw, height: CROP.sw });
    expect(a.params.focalLengthPx).toBeCloseTo(focalPx(p), 9);
    expect(a.params.sheetMargin).toBe(Infinity); // leather fills the view
    expect(a.params.substrate).toBe('leather');
    const nominal = (pxPerMm(p, 150) * 20) / CODE01_SIZE;
    for (let i = 0; i < 50; i++) {
      const t = trialSetup(r, p, 20, 15, new Prng(`t${i}`));
      expect(t.pxPerU / nominal).toBeGreaterThan(1 / 1.07 - 1e-9);
      expect(t.pxPerU / nominal).toBeLessThan(1 / 0.93 + 1e-9);
      // 15 cm is inside the iPhone Pro's 20 cm minimum focus: defocus dominates the base blur.
      expect(t.blurSigmaPx).toBeGreaterThan(1.5);
      const tilt = Math.hypot(t.params.tiltXDeg ?? 0, t.params.tiltYDeg ?? 0);
      expect(tilt).toBeLessThanOrEqual(12 + 1e-9);
    }
    const paper = trialSetup(rendition('ivory'), profile('android-1x'), 10, 10, new Prng('p'));
    expect(paper.params.sheetMargin).toBeCloseTo(3 / 10, 9); // a 3 mm cut-out tag around a 10 mm code
    expect(paper.blurSigmaPx).toBeLessThan(1);
  });
});

describe('adaptive trials per row', () => {
  function checkRow(cells: Cell[], screen: number, confirm: number, p: (typeof PROFILES)[number], distanceCm: number): void {
    let reliableBelow = false;
    for (const [i, c] of cells.entries()) {
      expect(c.status === 'overflow').toBe(!fitsCrop(p, c.sizeMm, distanceCm * 10));
      if (c.status === 'measured') {
        expect(c.trials).toBeGreaterThanOrEqual(2);
        if (c.confirmed) {
          expect(c.trials).toBe(confirm);
          expect(c.ok / c.trials).toBeGreaterThanOrEqual(0.95);
        }
        if (c.inferred) {
          expect(c.trials).toBe(screen);
          expect(c.ok).toBe(screen);
          expect(reliableBelow).toBe(true);
        }
        expect(c.reliable).toBe(c.confirmed || c.inferred);
        reliableBelow = c.reliable;
      } else {
        reliableBelow = false;
      }
      if (c.status === 'skipped') {
        // Only below two consecutive larger simulated sizes that read nothing.
        const larger = cells.slice(i + 1).filter((x) => x.status === 'measured');
        expect(larger.length).toBeGreaterThanOrEqual(2);
        expect(larger[0].ok + larger[1].ok).toBe(0);
      }
    }
  }

  it('confirms the frontier, infers larger sizes and never simulates codes that do not fit', () => {
    const job = { rendition: 'black-on-white', profile: 'android-2x', distanceCm: 10, screen: 3, confirm: 6 };
    const a = runRow(job);
    const b = runRow(job);
    expect(a.cells).toEqual(b.cells); // seeded: identical on every run and in every worker
    checkRow(a.cells, job.screen, job.confirm, profile(job.profile), job.distanceCm);
    // 2× at 10 cm: ≈ 28 px/mm, so 25 mm and up overflow the crop and 10 mm is large enough to read.
    expect(a.cells.filter((c) => c.status === 'overflow').map((c) => c.sizeMm)).toEqual([25, 30, 40, 50]);
    expect(a.cells[0].reliable).toBe(true);
    expect(a.trialsRun).toBe(a.cells.reduce((n, c) => n + c.trials, 0));
  }, 60_000);

  it('stops a hopeless row after two empty sizes (iPhone Pro, far inside its focus distance)', () => {
    const job = { rendition: 'black-on-white', profile: 'iphone-pro-2x', distanceCm: 8, screen: 3, confirm: 6 };
    const r = runRow(job);
    checkRow(r.cells, job.screen, job.confirm, profile(job.profile), job.distanceCm);
    const measured = r.cells.filter((c) => c.status === 'measured');
    expect(measured.every((c) => c.ok === 0 && c.trials === 2)).toBe(true);
    expect(r.cells.some((c) => c.reliable)).toBe(false);
  }, 60_000);
});
