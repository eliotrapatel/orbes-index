/**
 * Decoder robustness targets, part 3: adversarial-but-realistic captures the
 * pose and damage suites do not cover (strong curvature, codes cut by the
 * frame, close-ups, combined degradations, several codes or look-alikes in
 * view), plus seeded fuzzing for crashes and false positives.
 */
import { describe, expect, it } from 'vitest';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { CODE01_SIZE } from '../../src/core/code/profile.js';
import { decodeOrbesCode, type DecodeResult } from '../../src/core/decoder/index.js';
import { PRESETS, simulateCapture, type CaptureParams } from '../support/camera-sim.js';
import { Prng } from '../support/prng.js';
import { createGray, svgToGray, type GrayImage } from '../support/raster.js';
import { makeCode, renderCode, runTrials, SOURCE_PX_PER_U } from './fixtures.js';

/** Data orbit area (u²). */
const DATA_AREA = Math.PI * (23 * 23 - 10 * 10);

/** Normalised source position of the code point at radius r (u), angle a (clockwise from north). */
function at(r: number, a: number): { x: number; y: number } {
  return { x: 0.5 + (r * Math.sin(a)) / CODE01_SIZE, y: 0.5 - (r * Math.cos(a)) / CODE01_SIZE };
}

/** The typicalPhone preset at a random rotation, modest tilt and offset. */
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

function paste(dst: GrayImage, src: GrayImage, x0: number, y0: number): void {
  for (let y = 0; y < src.height; y++) dst.data.set(src.data.subarray(y * src.width, (y + 1) * src.width), (y0 + y) * dst.width + x0);
}

/** Dark concentric bands [inner, outer) (px) centred at (cx, cy). */
function drawBands(img: GrayImage, cx: number, cy: number, bands: readonly (readonly [number, number])[]): void {
  const reach = Math.max(...bands.map(([, b]) => b)) + 1;
  for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(img.height, cy + reach); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(img.width, cx + reach); x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (bands.some(([a, b]) => r >= a && r < b)) img.data[y * img.width + x] = 10;
    }
  }
}

function sameData(res: DecodeResult, data: Uint8Array): boolean {
  return res.ok && res.data.length === data.length && res.data.every((b, i) => b === data[i]);
}

describe('decoder robustness — adversarial captures', () => {
  it('reads laser engravings on a strongly curved ring (metal preset)', () => {
    // A 10 mm code on an 18 mm ring: no homography follows the bend, and the
    // anchor fit is off by up to one ring pitch between the seal and the moons.
    const r = runTrials('metal-ring', 12, (rng) => ({ pxPerU: 7.2, params: { ...PRESETS.metal, rotationDeg: rng.range(0, 360) } }));
    expect(r.ok, r.failures.join('\n')).toBeGreaterThanOrEqual(11);
  });

  it('reads light-on-dark engravings on a bent, glossy metal ring', () => {
    const r = runTrials('metal-inverted', 8, (rng) => {
      const pxPerU = rng.range(5, 7);
      return { pxPerU, params: { ...PRESETS.metal, rotationDeg: rng.range(0, 360), curvature: rng.range(0.5, 1) }, style: 'inverted' };
    });
    expect(r.ok, r.failures.join('\n')).toBeGreaterThanOrEqual(7);
  });

  it('reads a close-up whose frame cuts off two opposite moons', () => {
    // 14 px/u in a 1280×720 frame: turned ≈ 45°, the moons (27.5 u from the
    // centre) of one diagonal fall outside the frame while every data cell
    // (≤ 23 u) is still in view.
    const r = runTrials('closeup-two-moons', 8, (rng) => ({
      pxPerU: 14,
      params: { ...PRESETS.typicalPhone, offset: { x: 0, y: 0 }, tiltXDeg: 0, tiltYDeg: 0, blurSigma: 1.5, rotationDeg: 45 + 90 * rng.int(0, 3) + rng.range(-6, 6) },
    }));
    expect(r.failures).toEqual([]);
  });

  it('reads a code partly outside the frame, both moons of one side cut off', () => {
    // The code centre 15–17.5 u from the frame edge: the two moons on that side
    // (19.4 u out along each axis) are gone, and so is a slice of the outer orbits.
    const r = runTrials('side-cut', 10, (rng) => {
      const pxPerU = rng.range(5, 7);
      const inset = rng.range(15, 17.5) * pxPerU;
      const offset = [
        { x: 640 - inset, y: 0 },
        { x: inset - 640, y: 0 },
        { x: 0, y: 360 - inset },
        { x: 0, y: inset - 360 },
      ][rng.int(0, 3)];
      return { pxPerU, params: { ...PRESETS.typicalPhone, offset, tiltXDeg: 0, tiltYDeg: 0, rotationDeg: 90 * rng.int(0, 3) + rng.range(-8, 8) } };
    });
    expect(r.ok, r.failures.join('\n')).toBeGreaterThanOrEqual(9);
  });

  it('reads a code with one moon outside the frame, or its quiet zone clipped', () => {
    const r = runTrials('frame-edge', 8, (rng) => {
      const pxPerU = rng.range(5, 7);
      // Moons on the image axes; the centre 20–25 u from an edge loses that moon only.
      const inset = rng.range(20, 25) * pxPerU;
      const offset = rng.chance(0.5) ? { x: rng.chance(0.5) ? 640 - inset : inset - 640, y: 0 } : { x: 0, y: rng.chance(0.5) ? 360 - inset : inset - 360 };
      return { pxPerU, params: phone(rng, { offset, tiltXDeg: 0, tiltYDeg: 0, rotationDeg: 45 + 90 * rng.int(0, 3) + rng.range(-4, 4) }) };
    });
    expect(r.failures).toEqual([]);
  });

  it('reads through combined tilt, glare and low contrast', () => {
    const r = runTrials('combined', 8, (rng) => {
      const axis = rng.range(0, 2 * Math.PI);
      const tilt = rng.range(30, 40);
      const aspect = 0.6;
      // A highlight washing out 10 % of the data area (1.6·exp(−2ρ²) ≥ 0.5 inside ρ² ≤ ln(3.2)/2).
      const radius = Math.sqrt((0.1 * DATA_AREA) / (Math.PI * aspect * (Math.log(3.2) / 2))) / CODE01_SIZE;
      const glare = { ...at(rng.range(13, 20), rng.range(0, 2 * Math.PI)), radius, aspect, angleDeg: rng.range(0, 180), intensity: 1.6 };
      return { pxPerU: 6, params: phone(rng, { tiltXDeg: tilt * Math.cos(axis), tiltYDeg: tilt * Math.sin(axis), glare, inkLevel: 0.43, paperLevel: 0.86 }) };
    });
    expect(r.failures).toEqual([]);
  });

  it('reads small, strongly compressed captures, including rotations near 45° multiples', () => {
    const small = runTrials('small-jpeg', 8, (rng) => ({ pxPerU: rng.range(2.5, 3.2), params: phone(rng, { jpegQuality: 50 }) }));
    const diagonal = runTrials('rotation-45', 8, (rng) => ({ pxPerU: 2.5, params: phone(rng, { rotationDeg: 45 * rng.int(0, 7) + rng.range(-2, 2) }) }));
    expect([...small.failures, ...diagonal.failures]).toEqual([]);
  });

  it('reads one of two codes side by side, never a mix of both', () => {
    for (let t = 0; t < 6; t++) {
      const rng = new Prng(`two-codes#${t}`);
      const pxPerU = rng.range(4, 6);
      const [a, b] = [makeCode(1100 + t), makeCode(1200 + t)];
      const left = renderCode(a, SOURCE_PX_PER_U);
      const gap = Math.round(left.width * rng.range(0, 0.15));
      const scene = createGray(2 * left.width + gap, left.height, 255);
      paste(scene, left, 0, 0);
      paste(scene, renderCode(b, SOURCE_PX_PER_U), left.width + gap, 0);
      const frame = simulateCapture(scene, { ...phone(rng), rotationDeg: rng.range(-20, 20), offset: { x: 0, y: 0 }, codeWidthPx: (pxPerU * CODE01_SIZE * scene.width) / left.width }, t);
      const res = decodeOrbesCode(frame);
      expect(sameData(res, a.data) || sameData(res, b.data), `trial ${t}: ${res.ok ? 'wrong data' : res.reason}`).toBe(true);
    }
  });

  it('reads a code among seal and moon look-alikes (bullseyes, discs, rings)', () => {
    for (let t = 0; t < 6; t++) {
      const rng = new Prng(`decoys#${t}`);
      const code = makeCode(1300 + t);
      const source = renderCode(code, SOURCE_PX_PER_U);
      const side = Math.round(source.width * 2.4);
      const scene = createGray(side, side, 255);
      const u = SOURCE_PX_PER_U;
      const lo = (side - source.width) / 2 - 6 * u;
      const hi = (side + source.width) / 2 + 6 * u;
      for (let n = 0; n < 18; n++) {
        let x = 0;
        let y = 0;
        do {
          x = rng.range(0, side);
          y = rng.range(0, side);
        } while (x > lo && x < hi && y > lo && y < hi);
        const s = u * rng.range(0.6, 1.6);
        const decoys = [
          [[0, 2 * s], [3 * s, 4 * s]], // seal-like
          [[0, 1.75 * s]], // moon-like
          [[0, 2 * s], [3 * s, 4 * s], [6 * s, 7 * s], [9 * s, 10 * s]], // target
          [[2 * s, 3 * s], [5 * s, 6 * s]], // rings
        ] as const;
        drawBands(scene, x, y, decoys[rng.int(0, 3)]);
      }
      paste(scene, source, Math.round((side - source.width) / 2), Math.round((side - source.width) / 2));
      const pxPerU = rng.range(3.5, 5);
      const frame = simulateCapture(scene, { ...phone(rng), offset: { x: rng.range(-30, 30), y: rng.range(-20, 20) }, codeWidthPx: (pxPerU * CODE01_SIZE * side) / source.width }, t);
      const res = decodeOrbesCode(frame);
      expect(sameData(res, code.data), `trial ${t}: ${res.ok ? 'wrong data' : res.reason}`).toBe(true);
    }
  });
});

describe('decoder robustness — fuzzing', () => {
  it('never fails internally on pathological frames', () => {
    const rng = new Prng('pathological');
    const code = makeCode(1400);
    const frames: GrayImage[] = [];
    for (const pxPerU of [0.5, 1, 1.5, 40]) {
      frames.push(simulateCapture(renderCode(code, Math.max(1, Math.min(pxPerU, 16))), { codeWidthPx: pxPerU * CODE01_SIZE, frame: { width: 320, height: 240 }, rotationDeg: rng.range(0, 360) }, 1));
    }
    for (let k = 0; k < 6; k++) {
      // Random crops of a real code: corners, rims, lone moons.
      const src = renderCode(code, rng.pick([2, 3, 6]));
      const x0 = rng.int(0, src.width - 12);
      const y0 = rng.int(0, src.height - 12);
      const crop = createGray(rng.int(12, src.width - x0), rng.int(12, src.height - y0));
      for (let y = 0; y < crop.height; y++) crop.data.set(src.data.subarray((y0 + y) * src.width + x0, (y0 + y) * src.width + x0 + crop.width), y * crop.width);
      frames.push(crop);
    }
    for (const gain of [0.02, 4]) {
      const src = renderCode(code, 5);
      frames.push({ ...src, data: src.data.map((v) => Math.max(0, Math.min(255, Math.round(v * gain + (gain > 1 ? -300 : 120))))) });
    }
    const rings = createGray(600, 400, 240);
    for (let n = 0; n < 60; n++) drawBands(rings, rng.range(0, 600), rng.range(0, 400), [[0, 3], [5, 7], [9, 11]]);
    frames.push(rings, createGray(5000, 12, 128), createGray(12, 3000, 0));
    for (const frame of frames) {
      for (const opts of [{}, { tryMirrored: true, tryInverted: false }]) {
        const res = decodeOrbesCode(frame, opts);
        if (!res.ok) expect(res.detail ?? '').not.toMatch(/internal error/);
      }
    }
  });

  it('reports no code on ORBES look-alikes whose data is not a valid codeword', () => {
    for (let t = 0; t < 6; t++) {
      const rng = new Prng(`look-alike#${t}`);
      // Random bytes in place of payload ‖ signature ‖ CRC-16: Reed-Solomon
      // succeeds on the printed codeword, the CRC must not.
      const data = Uint8Array.from({ length: 79 }, () => rng.int(0, 255));
      const model = encodeOrbesCode({ data, genomeGlyphs: Array.from({ length: 8 }, () => rng.int(0, 15)) });
      const source = svgToGray(renderOrbesCodeSvg(model), { widthPx: CODE01_SIZE * SOURCE_PX_PER_U });
      const res = decodeOrbesCode(simulateCapture(source, phone(rng, { codeWidthPx: rng.range(4, 7) * CODE01_SIZE }), t), { tryMirrored: true });
      expect(res.ok).toBe(false);
    }
  });
});
