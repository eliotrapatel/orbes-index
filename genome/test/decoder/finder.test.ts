import { describe, expect, it } from 'vitest';
import { CODE01_MOONS, CODE01_SIZE } from '../../src/core/code/profile.js';
import { binarize } from '../../src/core/decoder/binarize.js';
import { inkBlobs } from '../../src/core/decoder/components.js';
import { findSealHits, measureSeal, mergeClusters, type SealCandidate } from '../../src/core/decoder/finder.js';
import type { GrayImage } from '../../src/core/decoder/image.js';
import { integralImage } from '../../src/core/decoder/integral.js';
import { findMoonQuads, findMoons } from '../../src/core/decoder/moons.js';
import { PRESETS, type CaptureParams } from '../support/camera-sim.js';
import { capture, captureTruth, makeCode, renderCode } from './fixtures.js';

const code = makeCode(11);

/** Seal candidates of a frame (both scan axes, coarse window), best first. */
function seals(img: GrayImage): SealCandidate[] {
  const ii = integralImage(img);
  const bin = binarize(img, ii, Math.round(Math.min(img.width, img.height) / 8));
  const clusters = mergeClusters([findSealHits(bin, img.width, img.height, 'rows'), findSealHits(bin, img.width, img.height, 'columns')]);
  return clusters
    .map((c) => measureSeal(img, c))
    .filter((s): s is SealCandidate => s !== null)
    .sort((a, b) => b.score - a.score);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('seal finder', () => {
  it.each([2.5, 4, 8, 14])('locates the seal of a %s px/u render to sub-pixel accuracy', (ppu) => {
    const img = renderCode(code, ppu);
    const centre = { x: (CODE01_SIZE / 2) * ppu, y: (CODE01_SIZE / 2) * ppu };
    const found = seals(img).filter((s) => dist(s.center, centre) < 2 * s.unit);
    expect(found).toHaveLength(1);
    const [seal] = found;
    expect(dist(seal.center, centre)).toBeLessThan(0.05 * ppu + 0.1);
    expect(seal.unit / ppu).toBeGreaterThan(0.97);
    expect(seal.unit / ppu).toBeLessThan(1.03);
    // A frontal view: the affine frame is a pure scale.
    expect(Math.abs(seal.affine[1]) / ppu).toBeLessThan(0.03);
    expect(seal.paper - seal.ink).toBeGreaterThan(150);
  });

  it('recovers centre and foreshortening of a tilted, rotated capture', () => {
    const params: CaptureParams = { rotationDeg: 33, tiltXDeg: 40, tiltYDeg: -10 };
    const img = capture(code, 7, params, 5);
    const truth = captureTruth(7, params);
    const c = truth(0, 0);
    const seal = seals(img).find((s) => dist(s.center, c) < 2 * s.unit);
    expect(seal).toBeDefined();
    expect(dist(seal!.center, c)).toBeLessThan(0.1 * seal!.unit);
    // The affine frame maps the seal ring (3.5 u) onto the true ring, whatever the rotation.
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const ring = truth(3.5 * Math.sin(a), -3.5 * Math.cos(a));
      const r = Math.hypot(ring.x - c.x, ring.y - c.y);
      const [m11, m12, m21, m22] = seal!.affine;
      // Radius of the affine-mapped circle along the same image direction.
      const dx = (ring.x - c.x) / r;
      const dy = (ring.y - c.y) / r;
      const det = m11 * m22 - m12 * m21;
      const ux = (m22 * dx - m12 * dy) / det;
      const uy = (-m21 * dx + m11 * dy) / det;
      const predicted = 3.5 / Math.hypot(ux, uy);
      expect(Math.abs(predicted - r) / r).toBeLessThan(0.06);
    }
  });

  it('ignores the polaris halo and plain discs, rings and bars', () => {
    const img = renderCode(code, 8);
    const polaris = { x: (CODE01_MOONS[0].x + 25) * 8, y: (CODE01_MOONS[0].y + 25) * 8 };
    expect(seals(img).some((s) => dist(s.center, polaris) < 3 * 8)).toBe(false);

    const w = 200;
    const shapes: GrayImage = { width: w, height: w, data: new Uint8Array(w * w).fill(230) };
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const r1 = Math.hypot(x - 50, y - 50);
        const r2 = Math.hypot(x - 150, y - 50);
        const bar = x > 30 && x < 170 && y > 130 && y < 150;
        if (r1 < 20 || (r2 > 14 && r2 < 22) || bar) shapes.data[y * w + x] = 20;
      }
    }
    expect(seals(shapes)).toEqual([]);
  });
});

describe('moon detection', () => {
  function moonsOf(img: GrayImage) {
    const seal = seals(img)[0];
    return { seal, moons: findMoons(img, integralImage(img), seal) };
  }

  it('finds the four moons, clockwise, to sub-pixel accuracy, with the polaris halo as hint', () => {
    const params: CaptureParams = { rotationDeg: 200, tiltXDeg: -25, tiltYDeg: 20 };
    const img = capture(code, 6, params, 7);
    const truth = captureTruth(6, params);
    const { moons } = moonsOf(img);
    expect(moons).not.toBeNull();
    const slots = moons!.slots;
    expect(slots.every((m) => m !== null)).toBe(true);
    // Each slot matches a true moon; consecutive slots are consecutive moons clockwise.
    const index = slots.map((m) => {
      const d = CODE01_MOONS.map((c) => dist(truth(c.x, c.y), m!));
      const k = d.indexOf(Math.min(...d));
      expect(d[k]).toBeLessThan(0.5);
      return k;
    });
    for (let k = 0; k < 4; k++) expect((index[(k + 1) % 4] - index[k] + 4) % 4).toBe(1);
    const halos = slots.map((m) => m!.halo);
    expect(halos.indexOf(Math.max(...halos))).toBe(index.indexOf(0));
  });

  it('accepts three moons when the fourth is hidden', () => {
    const params: CaptureParams = {
      rotationDeg: 15,
      // Paper-coloured patch (abrasion) erasing the south-east moon.
      occlusion: [{ kind: 'blob', x: 0.5 + CODE01_MOONS[2].x / CODE01_SIZE, y: 0.5 + CODE01_MOONS[2].y / CODE01_SIZE, area: 0.012, aspect: 1, level: 1 }],
    };
    const img = capture(code, 6, params, 8);
    const truth = captureTruth(6, params);
    const { moons } = moonsOf(img);
    expect(moons).not.toBeNull();
    const found = moons!.slots.filter((m) => m !== null);
    expect(found).toHaveLength(3);
    for (const m of found) expect(Math.min(...[0, 1, 3].map((k) => dist(truth(CODE01_MOONS[k].x, CODE01_MOONS[k].y), m!)))).toBeLessThan(0.5);
  });

  it('finds the moon square without the seal (moon-first fallback)', () => {
    const params: CaptureParams = { ...PRESETS.typicalPhone, rotationDeg: 70 };
    const img = capture(code, 6, params, 9);
    const truth = captureTruth(6, params);
    const bin = binarize(img, integralImage(img), Math.round(Math.min(img.width, img.height) / 8));
    const quads = findMoonQuads(img, inkBlobs(bin, img.width, img.height, 12, 20_000), 3);
    expect(quads.length).toBeGreaterThan(0);
    expect(dist(quads[0].center, truth(0, 0))).toBeLessThan(1);
    expect(quads[0].moons.slots).toHaveLength(4);
  });
});
