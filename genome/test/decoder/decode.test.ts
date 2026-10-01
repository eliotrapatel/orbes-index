import { describe, expect, it } from 'vitest';
import { encodeOrbesCode } from '../../src/core/code/encoder.js';
import { CODE01_MOONS, CODE01_SIZE } from '../../src/core/code/profile.js';
import { decodeOrbesCode, rgbaToGray, type DecodeResult, type GrayImage } from '../../src/core/decoder/index.js';
import { applyH } from '../../src/core/decoder/homography.js';
import { frameCodeData } from '../../src/core/payload.js';
import { PRESETS, simulateCapture } from '../support/camera-sim.js';
import { Prng } from '../support/prng.js';
import { grayToRgba, svgToGray } from '../support/raster.js';
import { renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { capture, makeCode, renderCode, type CodeFixture } from './fixtures.js';

type Success = Extract<DecodeResult, { ok: true }>;

function expectDecoded(res: DecodeResult, code: CodeFixture): Success {
  if (!res.ok) throw new Error(`decode failed: ${res.reason} ${res.detail ?? ''}`);
  expect(res.data).toEqual(code.data);
  expect(res.payloadBytes).toEqual(code.payloadBytes);
  expect(res.signature).toEqual(code.signature);
  expect(res.codeVersion).toBe(1);
  expect(res.mask).toBe(code.model.mask);
  return res;
}

/** Rotate an image by 90° clockwise. */
function rotate90(img: GrayImage): GrayImage {
  const { width: w, height: h } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = img.data[y * w + x];
  return { width: h, height: w, data: out };
}

function mirror(img: GrayImage): GrayImage {
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) out[y * img.width + x] = img.data[y * img.width + (img.width - 1 - x)];
  return { ...img, data: out };
}

/** Code centred in a larger blank frame, so that ±0.5 px conventions are easy to check. */
function onCanvas(src: GrayImage, width: number, height: number, ox: number, oy: number, fill = 255): GrayImage {
  const data = new Uint8Array(width * height).fill(fill);
  for (let y = 0; y < src.height; y++) data.set(src.data.subarray(y * src.width, (y + 1) * src.width), (y + oy) * width + ox);
  return { width, height, data };
}

describe('decodeOrbesCode — clean renders', () => {
  it.each([0, 1, 2, 3])('decodes a code under mask %i, with exact geometry and quality', (mask) => {
    const code = makeCode(30 + mask, { mask });
    const ppu = 6;
    const img = onCanvas(renderCode(code, ppu), 420, 360, 50, 20);
    const res = expectDecoded(decodeOrbesCode(img), code);
    const cx = 50 + 25 * ppu;
    const cy = 20 + 25 * ppu;
    expect(res.geometry.center.x).toBeCloseTo(cx, 0);
    expect(res.geometry.center.y).toBeCloseTo(cy, 0);
    res.geometry.moons.forEach((m, i) => {
      expect(Math.hypot(m.x - (cx + CODE01_MOONS[i].x * ppu), m.y - (cy + CODE01_MOONS[i].y * ppu))).toBeLessThan(0.3);
    });
    const h = res.geometry.homography;
    expect(h).toHaveLength(9);
    expect(h[8]).toBe(1);
    const p = applyH(h, 10, -20);
    expect(Math.hypot(p.x - (cx + 10 * ppu), p.y - (cy - 20 * ppu))).toBeLessThan(0.3);
    expect(res.genome).not.toBeNull();
    expect(res.genome!.glyphs).toEqual(code.genomeGlyphs);
    expect(res.genome!.confidence.every((c) => c > 0.4)).toBe(true);
    expect(res.quality).toMatchObject({ rsErrors: 0, rsErasures: 0, inverted: false, mirrored: false });
    expect(res.quality.moduleSizePx).toBeCloseTo(ppu, 1);
    expect(res.quality.contrast).toBeGreaterThan(0.7);
    expect(res.quality.contrast).toBeLessThanOrEqual(1);
    expect(Math.min(res.quality.orientation, 360 - res.quality.orientation)).toBeLessThan(0.5);
    expect(res.quality.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it.each([3.5, 4.5, 10, 16])('decodes a %s px/u render', (ppu) => {
    const code = makeCode(40);
    expectDecoded(decodeOrbesCode(renderCode(code, ppu)), code);
  });

  it('reports the in-plane orientation of code north, clockwise from image up', () => {
    const code = makeCode(41);
    let img = renderCode(code, 5);
    for (const expected of [90, 180, 270]) {
      img = rotate90(img);
      const res = expectDecoded(decodeOrbesCode(img), code);
      expect(Math.abs(res.quality.orientation - expected)).toBeLessThan(0.5);
      expect(res.genome!.glyphs).toEqual(code.genomeGlyphs);
    }
  });

  it('reads light-on-dark codes unless told not to', () => {
    const code = makeCode(42);
    const img = renderCode(code, 5, 'inverted');
    const res = expectDecoded(decodeOrbesCode(img), code);
    expect(res.quality.inverted).toBe(true);
    expect(res.genome!.glyphs).toEqual(code.genomeGlyphs);
    expect(decodeOrbesCode(img, { tryInverted: false }).ok).toBe(false);
    expectDecoded(decodeOrbesCode(renderCode(code, 5, 'ivory')), code);
  });

  it('reads mirror images only with tryMirrored', () => {
    const code = makeCode(43);
    const img = mirror(renderCode(code, 5));
    expect(decodeOrbesCode(img).ok).toBe(false);
    const res = expectDecoded(decodeOrbesCode(img, { tryMirrored: true }), code);
    expect(res.quality.mirrored).toBe(true);
    expect(res.genome!.glyphs).toEqual(code.genomeGlyphs);
  });

  it('decodes artifacts without decor, from RGBA input, and in very large frames', () => {
    const plain = makeCode(44, { decor: false });
    const svg = renderOrbesCodeSvg(plain.model, { paper: null });
    const gray = svgToGray(svg, { widthPx: 300 });
    const rgba = grayToRgba(gray);
    expectDecoded(decodeOrbesCode(rgbaToGray(rgba, gray.width, gray.height)), plain);

    // 3200 × 2400 frame: detection runs on a downscaled copy, sampling on the full image.
    const code = makeCode(45);
    const big = onCanvas(renderCode(code, 28), 3200, 2400, 1700, 900, 250);
    const res = expectDecoded(decodeOrbesCode(big), code);
    expect(res.quality.moduleSizePx).toBeCloseTo(28, 0);
  });

  it('brute-forces the mask when both format copies are destroyed', () => {
    const code = makeCode(47, { mask: 2 });
    const ppu = 6;
    const img = renderCode(code, ppu);
    for (const fill of [255, 0]) {
      // Paint over the whole format ring (ring 0, r 10.14–10.86 u) in paper or ink.
      const damaged = { ...img, data: img.data.slice() };
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const r = Math.hypot(x + 0.5 - 25 * ppu, y + 0.5 - 25 * ppu) / ppu;
          if (r > 10 && r < 11) damaged.data[y * img.width + x] = fill;
        }
      }
      const res = expectDecoded(decodeOrbesCode(damaged), code);
      expect(res.quality.rsErrors + res.quality.rsErasures).toBeGreaterThan(0);
    }
  });

  it('skips the genome when asked and accepts out-of-range candidate limits', () => {
    const code = makeCode(46);
    const img = renderCode(code, 5);
    expect(expectDecoded(decodeOrbesCode(img, { readGenome: false }), code).genome).toBeNull();
    for (const maxSealCandidates of [0, -3, 1.7, Number.NaN, 1e9]) expectDecoded(decodeOrbesCode(img, { maxSealCandidates }), code);
  });
});

describe('decodeOrbesCode — integrity', () => {
  /** A code whose 79 data bytes are taken as given (no payload validation by the encoder). */
  function rawCode(data: Uint8Array): GrayImage {
    const model = encodeOrbesCode({ data, genomeGlyphs: [0, 1, 2, 3, 4, 5, 6, 7] });
    return svgToGray(renderOrbesCodeSvg(model), { widthPx: 300 });
  }

  it('reports CRC when Reed-Solomon succeeds on data whose CRC-16 does not match', () => {
    const data = makeCode(50).data.slice();
    data[3] ^= 0x10;
    const res = decodeOrbesCode(rawCode(data));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('CRC');
  });

  it('reports PAYLOAD for a CRC-valid frame around an invalid payload', () => {
    const code = makeCode(51);
    const payload = code.payloadBytes.slice();
    payload[1] = 0; // key id 0 is reserved
    const res = decodeOrbesCode(rawCode(frameCodeData(payload, code.signature)));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('PAYLOAD');
  });

  it('reports ECC, never wrong data, when half of the data orbits belong to another code', () => {
    const code = makeCode(52, { mask: 1 });
    const other = makeCode(57, { mask: 1 });
    const img = renderCode(code, 6);
    const donor = renderCode(other, 6);
    // Same seal, moons, genome and format ring; the eastern half of orbits 1–12
    // transplanted: a perfectly sharp image of ≈ 80 wrong bytes, twice the
    // Reed-Solomon capacity.
    const spliced = { ...img, data: img.data.slice() };
    for (let y = 0; y < img.height; y++) {
      for (let x = 150; x < img.width; x++) {
        const r = Math.hypot(x + 0.5 - 150, y + 0.5 - 150) / 6;
        if (r > 11 && r < 23) spliced.data[y * img.width + x] = donor.data[y * img.width + x];
      }
    }
    const res = decodeOrbesCode(spliced);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('ECC');
  });
});

describe('decodeOrbesCode — never throws, no false positives', () => {
  const rng = new Prng('fuzz');

  it('rejects malformed and degenerate inputs without throwing', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      42,
      'image',
      {},
      { width: 10, height: 10 },
      { width: 10, height: 10, data: new Uint8Array(50) },
      { width: Number.NaN, height: 10, data: new Uint8Array(100) },
      { width: -10, height: -10, data: new Uint8Array(100) },
      { width: 1e9, height: 1e9, data: new Uint8Array(100) },
      { width: 10, height: 10, data: Array.from({ length: 100 }, () => 0) },
      {
        get width(): number {
          throw new Error('hostile getter');
        },
        height: 10,
        data: new Uint8Array(100),
      },
    ];
    for (const input of inputs) {
      const res = decodeOrbesCode(input as GrayImage);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe('NO_SEAL');
        expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each([
    [1, 1],
    [3, 2000],
    [2000, 3],
    [12, 12],
    [64, 48],
    [640, 480],
  ])('survives %i × %i frames of noise, black, white and gradients', (w, h) => {
    const frames: GrayImage[] = [
      { width: w, height: h, data: Uint8Array.from({ length: w * h }, () => rng.int(0, 255)) },
      { width: w, height: h, data: new Uint8Array(w * h) },
      { width: w, height: h, data: new Uint8Array(w * h).fill(255) },
      { width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => ((i % w) * 255) / Math.max(1, w - 1)) },
      { width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => ((i % w) + Math.floor(i / w)) % 2 ? 0 : 255) },
    ];
    for (const img of frames) {
      for (const opts of [{}, { tryMirrored: true }]) {
        const res = decodeOrbesCode(img, opts);
        expect(res.ok).toBe(false);
      }
    }
  });

  it('finds nothing in code-free scenes, textures and partial codes', () => {
    const blank: GrayImage = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
    const scenes = [0, 1, 2].flatMap((seed) => [
      simulateCapture(blank, { ...PRESETS.typicalPhone, sheetMargin: 0.2, rotationDeg: seed * 50 }, seed),
      simulateCapture(blank, { ...PRESETS.leather, sheetMargin: Number.POSITIVE_INFINITY }, seed),
    ]);
    for (const img of scenes) expect(decodeOrbesCode(img, { tryMirrored: true }).ok).toBe(false);

    // Half of a real code: the seal, the moons and the format are there, the data is not.
    const code = makeCode(53);
    const img = renderCode(code, 6);
    const half = { ...img, data: img.data.slice() };
    for (let y = 0; y < img.height; y++) for (let x = Math.floor(img.width / 2) + 8; x < img.width; x++) if (Math.hypot(x - 150, y - 150) > 66 && Math.hypot(x - 150, y - 150) < 138) half.data[y * img.width + x] = 255;
    expect(decodeOrbesCode(half).ok).toBe(false);
  });

  it('decodes a typical phone capture in well under a second', () => {
    const code = makeCode(54);
    const img = capture(code, 8, PRESETS.typicalPhone, 1);
    decodeOrbesCode(img);
    const res = expectDecoded(decodeOrbesCode(img), code);
    expect(res.quality.elapsedMs).toBeLessThan(500);
    expect(CODE01_SIZE * res.quality.moduleSizePx).toBeGreaterThan(300);
  });
});
