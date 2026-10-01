/**
 * Decoder robustness targets, part 3: adversarial-but-realistic captures the
 * pose and damage suites do not cover (strong curvature, combined
 * degradations, codes cut by the frame, several codes or decoys in view).
 */
import { describe, expect, it } from 'vitest';
import { CODE01_SIZE } from '../../src/core/code/profile.js';
import { PRESETS, type CaptureParams } from '../support/camera-sim.js';
import type { Prng } from '../support/prng.js';
import { runTrials } from './fixtures.js';

describe('decoder robustness — adversarial captures', () => {
  it('reads laser engravings on a strongly curved ring (metal preset)', () => {
    // A 10 mm code on an 18 mm ring: no homography follows the bend, and the
    // anchor fit is off by up to one ring pitch between the seal and the moons.
    const r = runTrials('metal-ring', 12, (rng) => ({ pxPerU: 7.2, params: { ...PRESETS.metal, rotationDeg: rng.range(0, 360) } }));
    expect(r.ok, r.failures.join('\n')).toBeGreaterThanOrEqual(11);
  });
});

export type { CaptureParams, Prng };
export { CODE01_SIZE };
