import { describe, expect, it } from 'vitest';
import { CODE01_MOONS, CODE01_SIZE } from '../../src/core/code/profile.js';
import { primitiveCovers, readGenome } from '../../src/core/decoder/genome-reader.js';
import { applyH, homographyFromPoints, multiplyH, type Homography } from '../../src/core/decoder/homography.js';
import type { GrayImage } from '../../src/core/decoder/image.js';
import { alignmentScore, coordinateDescent, fieldShift, FIELD_PARAMS, fullObjective, refineControlPoints, refineOffsetField, ringLatticeField } from '../../src/core/decoder/refine.js';
import { CELL_COUNT, CELL_GEOMETRY, classifyCells, quietZoneScore, sampleCells } from '../../src/core/decoder/sampler.js';
import { genomeGlyphPrimitives } from '../../src/core/genome/render.js';
import type { Primitive } from '../../src/core/geometry.js';
import { PRESETS, type CaptureParams } from '../support/camera-sim.js';
import { Prng } from '../support/prng.js';
import { capture, captureTruth, makeCode, renderCode } from './fixtures.js';

const code = makeCode(21);

/** Code plane → image of a frontal render at `ppu`. */
function renderFrame(ppu: number): Homography {
  return [ppu, 0, (CODE01_SIZE / 2) * ppu, 0, ppu, (CODE01_SIZE / 2) * ppu, 0, 0, 1];
}

function bitErrors(bits: Uint8Array): number {
  let e = 0;
  for (let i = 0; i < CELL_COUNT; i++) if (bits[i] !== code.model.cells[i]) e++;
  return e;
}

/** Homography through the simulator's ground truth at the seal and moons (exact for a planar capture). */
function truthFrame(truth: (x: number, y: number) => { x: number; y: number }): Homography {
  const pts = [{ x: 0, y: 0 }, ...CODE01_MOONS];
  return homographyFromPoints(pts, pts.map((p) => truth(p.x, p.y)))!;
}

describe('cell sampling and classification', () => {
  it.each([3, 6])('reads every cell of a clean %s px/u render', (ppu) => {
    const cls = classifyCells(sampleCells(renderCode(code, ppu), renderFrame(ppu), true));
    expect(bitErrors(cls.bits)).toBe(0);
    // A cell whose immediate neighbours all share its value (≈ 1 in 256) is
    // indistinguishable from a smudge and may read with low confidence.
    expect(cls.confidence.filter((c) => c > 0.3).length).toBeGreaterThan(0.98 * CELL_COUNT);
    expect(cls.globalContrast).toBeGreaterThan(150);
  });

  it('follows illumination gradients through local thresholds', () => {
    const params: CaptureParams = { rotationDeg: 40, inkLevel: 0.43, paperLevel: 0.86, illumination: { angleDeg: 60, strength: 0.6 }, vignette: 0.6, noise: { sigma: 6 } };
    const img = capture(code, 5, params, 3);
    const cls = classifyCells(sampleCells(img, truthFrame(captureTruth(5, params)), true));
    expect(bitErrors(cls.bits)).toBe(0);
  });

  it('gives cells under a blown-out highlight low confidence', () => {
    const params: CaptureParams = { glare: { x: 0.5, y: 0.2, radius: 0.12, aspect: 1, intensity: 3 } };
    const img = capture(code, 5, params, 4);
    const h = truthFrame(captureTruth(5, params));
    const cls = classifyCells(sampleCells(img, h, true));
    // Cells within 2 u of the highlight centre (code point (0, −15)): nothing to read there.
    let inside = 0;
    for (let i = 0; i < CELL_COUNT; i++) {
      const p = CELL_GEOMETRY;
      if (Math.hypot(p.x[i], p.y[i] + 15) < 2) {
        inside++;
        expect(cls.confidence[i]).toBeLessThan(0.15);
      }
    }
    expect(inside).toBeGreaterThan(5);
  });

  it('scores the quiet zones: high for the true frame, low for a wrong scale', () => {
    const img = renderCode(code, 6);
    const h = renderFrame(6);
    const cls = classifyCells(sampleCells(img, h, true));
    expect(quietZoneScore(img, h, cls)).toBeGreaterThan(0.95);
    // A frame 0.6× too small lands the probes on the data orbits.
    const shrunk = multiplyH(h, [0.6, 0, 0, 0, 0.6, 0, 0, 0, 1]);
    const shrunkCls = classifyCells(sampleCells(img, shrunk, true));
    expect(quietZoneScore(img, shrunk, shrunkCls)).toBeLessThan(0.7);
  });
});

describe('alignment refinement', () => {
  it('coordinate descent climbs to the optimum of a smooth score', () => {
    const p = new Float64Array([0, 0]);
    const score = (q: Float64Array) => -((q[0] - 1.3) ** 2) - (q[1] + 0.7) ** 2;
    const best = coordinateDescent(p, score(p), fullObjective(p, score), 1, 0.01, 1000);
    expect(p[0]).toBeCloseTo(1.3, 1);
    expect(p[1]).toBeCloseTo(-0.7, 1);
    expect(best).toBeGreaterThan(-0.001);
  });

  it('pulls perturbed control points back onto the code', () => {
    const params: CaptureParams = { rotationDeg: 120, tiltXDeg: 20 };
    const img = capture(code, 5, params, 6);
    const truth = captureTruth(5, params);
    const codePoints = [{ x: 0, y: 0 }, ...CODE01_MOONS];
    const exact = codePoints.map((p) => truth(p.x, p.y));
    const rng = new Prng('perturb');
    // Up to ±0.6 u on every control point: many cells are then misread.
    const perturbed = exact.map((p) => ({ x: p.x + rng.range(-3, 3), y: p.y + rng.range(-3, 3) }));
    const start = homographyFromPoints(codePoints, perturbed)!;
    const cls = classifyCells(sampleCells(img, start, true));
    const before = bitErrors(cls.bits);
    const refined = refineControlPoints(img, codePoints, perturbed, 5, cls)!;
    const after = classifyCells(sampleCells(img, refined.homography, true));
    expect(before).toBeGreaterThan(20);
    expect(bitErrors(after.bits)).toBe(0);
    for (const p of [{ x: 0, y: 12 }, { x: -20, y: -5 }, { x: 15, y: 15 }]) {
      const a = applyH(refined.homography, p.x, p.y);
      const t = truth(p.x, p.y);
      expect(Math.hypot(a.x - t.x, a.y - t.y)).toBeLessThan(0.2 * 5);
    }
  });

  it('interpolates the offset field and corrects a curved surface', () => {
    const params = new Float64Array(FIELD_PARAMS).fill(0);
    params[0] = 2;
    params[1] = -1;
    const shift = fieldShift(params);
    // Cells far from node 0 (other sectors) do not move; some cells near it do.
    let moved = 0;
    for (let i = 0; i < CELL_COUNT; i++) if (shift[2 * i] !== 0) moved++;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(CELL_COUNT / 2);

    const capture2: CaptureParams = { rotationDeg: 10, curvature: 0.8, tiltYDeg: 10 };
    const img = capture(code, 6, capture2, 2);
    const truth = captureTruth(6, capture2);
    const h = truthFrame(truth);
    const cls = classifyCells(sampleCells(img, h, true));
    const field = refineOffsetField(img, h, 6, cls);
    const withField = classifyCells(sampleCells(img, h, true, field.shift));
    expect(field.score).toBeGreaterThan(alignmentScore(sampleCells(img, h, false), cls));
    // The incremental objective agrees with a full evaluation of the final field.
    expect(field.score).toBeCloseTo(alignmentScore(sampleCells(img, h, false, field.shift), cls), 6);
    expect(bitErrors(withField.bits)).toBeLessThan(bitErrors(cls.bits));
  });
});

describe('ring lattice registration', () => {
  it('registers the orbits of a code on a finger ring, where the anchor fit is a ring pitch off', () => {
    const params: CaptureParams = { ...PRESETS.metal, rotationDeg: 70 };
    const img = capture(code, 7.2, params, 5);
    const h = truthFrame(captureTruth(7.2, params));
    const anchorFit = classifyCells(sampleCells(img, h, true));
    const initial = ringLatticeField(img, h)!;
    const registered = classifyCells(sampleCells(img, h, true, fieldShift(initial)));
    const refined = refineOffsetField(img, h, 7.2, registered, initial);
    const final = classifyCells(sampleCells(img, h, true, refined.shift));
    // Through the seal and moons alone a sixth of the cells read wrong; the
    // registration alone halves that, and descent from it reaches a readable frame
    // (Reed-Solomon corrects 42 bytes, ≈ 60 scattered cells).
    expect(bitErrors(anchorFit.bits)).toBeGreaterThan(150);
    expect(bitErrors(registered.bits)).toBeLessThan(bitErrors(anchorFit.bits) / 2);
    expect(bitErrors(final.bits)).toBeLessThan(60);
  });

  it('leaves a well-aligned flat capture alone and finds nothing without orbits', () => {
    const params: CaptureParams = { rotationDeg: 25, tiltXDeg: 20 };
    const img = capture(code, 5, params, 7);
    const h = truthFrame(captureTruth(5, params));
    const shift = fieldShift(ringLatticeField(img, h)!);
    // Every node offset stays well inside the 0.28 u gap between rings.
    for (let i = 0; i < shift.length; i += 2) expect(Math.hypot(shift[i], shift[i + 1])).toBeLessThan(0.15 * 5);
    const blank: GrayImage = { width: 300, height: 300, data: new Uint8Array(300 * 300).fill(200) };
    expect(ringLatticeField(blank, renderFrame(6))).toBeNull();
  });
});

describe('genome reader', () => {
  it('rasterises primitives with the geometry.ts semantics', () => {
    const arc: Primitive = { kind: 'arc', layer: 'genome', cx: 0, cy: 0, r: 1, width: 0.2, start: 0, end: Math.PI / 2, cap: 'round' };
    expect(primitiveCovers(arc, Math.sin(Math.PI / 4), -Math.cos(Math.PI / 4))).toBe(true);
    // Round caps stay inside [start, end]: just before north is not inked.
    expect(primitiveCovers(arc, -0.05, -1)).toBe(false);
    expect(primitiveCovers({ ...arc, cap: 'butt' }, 0.02, -1)).toBe(true);
    const half: Primitive = { kind: 'halfDisc', layer: 'genome', cx: 0, cy: 0, r: 1, angle: 0 };
    expect(primitiveCovers(half, 0, -0.5)).toBe(true);
    expect(primitiveCovers(half, 0, 0.5)).toBe(false);
    const crescent: Primitive = { kind: 'crescent', layer: 'genome', cx: 0, cy: 0, r: 1, offset: 0.6, angle: 0 };
    expect(primitiveCovers(crescent, 0, 0.9)).toBe(true);
    expect(primitiveCovers(crescent, 0, -0.9)).toBe(false);
    expect(primitiveCovers({ kind: 'ring', layer: 'genome', cx: 0, cy: 0, r: 1, width: 0.2 }, 0, 0.5)).toBe(false);
    expect(primitiveCovers({ kind: 'disc', layer: 'genome', cx: 1, cy: 1, r: 0.5 }, 1.2, 1.2)).toBe(true);
  });

  it('reads every GENOME-01 glyph through the code frame', () => {
    // Two codes cover different glyphs; check all 16 render and read back.
    const seen = new Set<number>();
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const c = makeCode(seed);
      const read = readGenome(renderCode(c, 6), renderFrame(6));
      expect(read.glyphs).toEqual(c.genomeGlyphs);
      for (const v of read.confidence) expect(v).toBeGreaterThan(0.4);
      c.genomeGlyphs.forEach((g) => seen.add(g));
    }
    expect(seen.size).toBeGreaterThan(10);
    for (let g = 0; g < 16; g++) expect(genomeGlyphPrimitives(g, 0, 0, 1).length).toBeGreaterThan(0);
  });

  it('returns null glyphs where there is nothing to read', () => {
    const blank: GrayImage = { width: 300, height: 300, data: new Uint8Array(300 * 300).fill(200) };
    const read = readGenome(blank, renderFrame(6));
    expect(read.glyphs).toEqual(new Array(8).fill(null));
    expect(read.confidence).toEqual(new Array(8).fill(0));
  });
});
