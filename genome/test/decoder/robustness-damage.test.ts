/**
 * Decoder robustness targets, part 2: damage, lighting and materials
 * (seeded camera simulator trials; the full sweep lives in
 * scripts/scan-matrix.ts).
 */
import { describe, expect, it } from 'vitest';
import { CODE01_SIZE } from '../../src/core/code/profile.js';
import { PRESETS, type CaptureParams, type Substrate } from '../support/camera-sim.js';
import type { Prng } from '../support/prng.js';
import { runTrials } from './fixtures.js';

/** Data orbit area (u²) and whole-artifact area (u²). */
const DATA_AREA = Math.PI * (23 * 23 - 10 * 10);
const SOURCE_AREA = CODE01_SIZE * CODE01_SIZE;

function phone(rng: Prng, extra: CaptureParams = {}): CaptureParams {
  return {
    ...PRESETS.typicalPhone,
    rotationDeg: rng.range(0, 360),
    tiltXDeg: rng.range(-12, 12),
    tiltYDeg: rng.range(-12, 12),
    offset: { x: rng.range(-60, 60), y: rng.range(-40, 40) },
    ...extra,
  };
}

/** Normalised source position of the code point at radius r (u), angle a (clockwise from north). */
function at(r: number, a: number): { x: number; y: number } {
  return { x: 0.5 + (r * Math.sin(a)) / CODE01_SIZE, y: 0.5 - (r * Math.cos(a)) / CODE01_SIZE };
}

describe('decoder robustness — damage, lighting, materials', () => {
  it('reads through a specular highlight washing out 15 % of the data area', () => {
    const r = runTrials('glare', 10, (rng) => {
      const aspect = 0.6;
      // 1.6·exp(−2ρ²) ≥ 0.5 inside ρ² ≤ ln(3.2)/2.
      const radius = Math.sqrt((0.15 * DATA_AREA) / (Math.PI * aspect * (Math.log(3.2) / 2))) / CODE01_SIZE;
      const glare = { ...at(rng.range(13, 20), rng.range(0, 2 * Math.PI)), radius, aspect, angleDeg: rng.range(0, 180), intensity: 1.6 };
      return { pxPerU: 6, params: phone(rng, { glare }) };
    });
    expect(r.failures).toEqual([]);
  });

  it('reads through an opaque blob covering 15 % of the data area', () => {
    const r = runTrials('blob', 10, (rng) => ({
      pxPerU: 6,
      params: phone(rng, {
        occlusion: [
          {
            kind: 'blob',
            ...at(rng.range(14, 19), rng.range(0, 2 * Math.PI)),
            area: (0.15 * DATA_AREA) / SOURCE_AREA,
            aspect: rng.range(0.5, 1),
            angleDeg: rng.range(0, 180),
            level: rng.chance(0.5) ? 0.08 : 0.86,
          },
        ],
      }),
    }));
    expect(r.failures).toEqual([]);
  });

  it('reads through a 2 u wide strip across the code, even across the seal', () => {
    const r = runTrials('strip', 10, (rng) => {
      const angle = rng.range(0, 180);
      const centre = at(rng.range(0, 16), ((angle + 90) * Math.PI) / 180);
      return {
        pxPerU: 6,
        params: phone(rng, { occlusion: [{ kind: 'strip', ...centre, area: (46 * 2) / SOURCE_AREA, aspect: 1 / 23, angleDeg: angle, level: rng.chance(0.5) ? 0.08 : 0.86 }] }),
      };
    });
    expect(r.failures).toEqual([]);
  });

  it('reads 30 % contrast print (ink 110 on paper 220) under uneven light', () => {
    const contrast = runTrials('contrast', 8, (rng) => ({ pxPerU: 5, params: phone(rng, { inkLevel: 110 / 255, paperLevel: 220 / 255 }) }));
    const light = runTrials('lighting', 6, (rng) => ({
      pxPerU: 5,
      params: phone(rng, { illumination: { angleDeg: rng.range(0, 360), strength: 0.5 }, vignette: 0.5 }),
    }));
    expect([...contrast.failures, ...light.failures]).toEqual([]);
  });

  it('reads ≥ 95 % of low-light captures at 4 px/u (lowLight preset: underexposed, noisy, defocused, hand shake, JPEG 70)', () => {
    const trials = 20;
    const r = runTrials('low-light', trials, (rng) => ({
      pxPerU: 4,
      params: {
        ...PRESETS.lowLight,
        rotationDeg: rng.range(0, 360),
        tiltXDeg: rng.range(-12, 12),
        tiltYDeg: rng.range(-12, 12),
        offset: { x: rng.range(-60, 60), y: rng.range(-40, 40) },
      },
    }));
    expect(r.ok / trials, r.failures.join('\n')).toBeGreaterThanOrEqual(0.95);
  });

  it('reads light ink on a dark substrate', () => {
    const r = runTrials('inverted', 6, (rng) => ({ pxPerU: 5, params: phone(rng), style: 'inverted' }));
    expect(r.failures).toEqual([]);
  });

  it.each<[Substrate | 'ivory', CaptureParams]>([
    ['textured-paper', {}],
    ['leather', { paperLevel: 0.5, inkLevel: 0.2 }],
    ['brushed-metal', { paperLevel: 0.72, inkLevel: 0.25 }],
    ['ivory', {}],
  ])('reads codes on %s', (substrate, material) => {
    const r = runTrials(`substrate-${substrate}`, 4, (rng) => ({
      pxPerU: 5,
      params: phone(rng, { ...(substrate === 'ivory' ? {} : { substrate }), ...material }),
      ...(substrate === 'ivory' ? { style: 'ivory' as const } : {}),
    }));
    expect(r.failures).toEqual([]);
  });
});
