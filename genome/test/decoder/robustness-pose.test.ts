/**
 * Decoder robustness targets, part 1: pose and optics (seeded camera
 * simulator trials; the full sweep lives in scripts/scan-matrix.ts).
 */
import { describe, expect, it } from 'vitest';
import { PRESETS, type CaptureParams } from '../support/camera-sim.js';
import type { Prng } from '../support/prng.js';
import { runTrials } from './fixtures.js';

/** Random placement: any rotation, off-centre. */
function placement(rng: Prng): CaptureParams {
  return { rotationDeg: rng.range(0, 360), offset: { x: rng.range(-80, 80), y: rng.range(-50, 50) } };
}

/** The typicalPhone preset (hand-held, blur, noise, JPEG, clutter) at a random placement. */
function phone(rng: Prng, extra: CaptureParams = {}): CaptureParams {
  return { ...PRESETS.typicalPhone, ...placement(rng), tiltXDeg: rng.range(-12, 12), tiltYDeg: rng.range(-12, 12), ...extra };
}

describe('decoder robustness — pose and optics', () => {
  it('reads every clean frontal capture from 3.5 px/u, at any rotation', () => {
    const r = runTrials('clean', 12, (rng) => ({ pxPerU: rng.range(3.5, 6), params: placement(rng) }));
    expect(r.failures).toEqual([]);
  });

  it('reads every typical hand-held phone capture at 4 px/u', () => {
    const r = runTrials('phone', 8, (rng) => ({ pxPerU: 4, params: phone(rng) }));
    expect(r.failures).toEqual([]);
  });

  it('reads every capture tilted up to 40° about any axis', () => {
    const r = runTrials('tilt40', 12, (rng) => {
      const axis = rng.range(0, 2 * Math.PI);
      const tilt = rng.range(30, 40);
      return { pxPerU: 6, params: phone(rng, { tiltXDeg: tilt * Math.cos(axis), tiltYDeg: tilt * Math.sin(axis) }) };
    });
    expect(r.failures).toEqual([]);
  });

  it('reads ≥ 95 % of captures tilted 45°', () => {
    const r = runTrials('tilt45', 20, (rng) => {
      const axis = rng.range(0, 2 * Math.PI);
      return { pxPerU: 6, params: phone(rng, { tiltXDeg: 45 * Math.cos(axis), tiltYDeg: 45 * Math.sin(axis) }) };
    });
    expect(r.ok, r.failures.join('\n')).toBeGreaterThanOrEqual(19);
  });

  it('reads through defocus blur of 0.5 u', () => {
    const r = runTrials('blur', 8, (rng) => ({ pxPerU: 6, params: phone(rng, { blurSigma: 0.5 * 6 }) }));
    expect(r.failures).toEqual([]);
  });

  it('reads through sensor noise σ 12 and JPEG quality 60', () => {
    const noise = runTrials('noise', 8, (rng) => ({ pxPerU: 5, params: phone(rng, { noise: { sigma: 12, shot: 0.04 } }) }));
    const jpeg = runTrials('jpeg', 8, (rng) => ({ pxPerU: 5, params: phone(rng, { jpegQuality: 60 }) }));
    expect([...noise.failures, ...jpeg.failures]).toEqual([]);
  });

  it('reads codes on moderately curved leather goods', () => {
    const r = runTrials('curved', 8, (rng) => ({
      pxPerU: 6,
      params: phone(rng, { curvature: rng.range(0.3, 0.5), substrate: 'leather', paperLevel: 0.6, inkLevel: 0.15 }),
    }));
    expect(r.failures).toEqual([]);
  });
});
