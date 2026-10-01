import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/core/geometry.js';
import {
  captureGeometry,
  perspectiveHomography,
  PRESETS,
  simulateCapture,
  type CaptureParams,
  type PresetName,
} from './camera-sim.js';
import { createGray, meanAbsDiff, svgToGray, type GrayImage } from './raster.js';

// ── Fixtures and measurements ──────────────────────────────────────────────

/** Code-like artifact (viewBox −25..25 like CODE-01): seal, 13 dashed orbits, four moons. */
function codeLikeSvg(): string {
  const orbits = Array.from({ length: 13 }, (_, k) => {
    const r = 10.5 + k;
    return `<circle r="${r}" fill="none" stroke="#000" stroke-width="0.72" stroke-dasharray="${1 + (k % 3) * 0.6} ${0.8 + (k % 2)}" stroke-dashoffset="${k}"/>`;
  }).join('');
  const moons = [315, 45, 135, 225]
    .map((d) => {
      const a = (d * Math.PI) / 180;
      return `<circle cx="${(19.4 * Math.sin(a)).toFixed(2)}" cy="${(-19.4 * Math.cos(a)).toFixed(2)}" r="1.75"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-25 -25 50 50"><rect x="-25" y="-25" width="50" height="50" fill="#fff"/><circle r="2"/><circle r="3.5" fill="none" stroke="#000"/>${orbits}${moons}</svg>`;
}

const CODE_LIKE = svgToGray(codeLikeSvg(), { widthPx: 400 });

/** White 600×600 source with small black discs at known source-pixel positions. */
const DOTS: readonly Point[] = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
  { x: 500, y: 500 },
  { x: 100, y: 500 },
  { x: 300, y: 300 },
  { x: 300, y: 160 },
  { x: 420, y: 330 },
];
const DOT_SOURCE = svgToGray(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#fff"/>${DOTS.map(
    (d) => `<circle cx="${d.x}" cy="${d.y}" r="5"/>`,
  ).join('')}</svg>`,
  { widthPx: 600 },
);

/** Identity camera: the frame is the source, pixel for pixel. */
const identity = (src: GrayImage): CaptureParams => ({ frame: { width: src.width, height: src.height }, codeWidthPx: src.width });

/** Darkness-weighted centroid (continuous px, pixel centres at +0.5) within `radius` of `at`. */
function darkCentroid(img: GrayImage, at: Point, radius: number): Point {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.max(0, Math.floor(at.y - radius)); y < Math.min(img.height, Math.ceil(at.y + radius)); y++) {
    for (let x = Math.max(0, Math.floor(at.x - radius)); x < Math.min(img.width, Math.ceil(at.x + radius)); x++) {
      const w = 255 - img.data[y * img.width + x];
      sw += w;
      sx += w * (x + 0.5);
      sy += w * (y + 0.5);
    }
  }
  return { x: sx / sw, y: sy / sw };
}

/** Byte-identical images (vitest's deep equality walks typed arrays element by element: far too slow here). */
function identical(a: GrayImage, b: GrayImage): boolean {
  const bytes = (img: GrayImage) => Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return a.width === b.width && a.height === b.height && bytes(a).equals(bytes(b));
}

const pixel = (img: GrayImage, p: Point): number => img.data[Math.floor(p.y) * img.width + Math.floor(p.x)];

function stats(img: GrayImage, x0 = 0, y0 = 0, x1 = img.width, y1 = img.height): { mean: number; sd: number } {
  let s = 0;
  let s2 = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = img.data[y * img.width + x];
      s += v;
      s2 += v * v;
    }
  }
  const n = (x1 - x0) * (y1 - y0);
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

const applyH = (h: readonly number[], x: number, y: number): Point => {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
};

// ── Geometry ───────────────────────────────────────────────────────────────

describe('simulateCapture: geometry', () => {
  it('reproduces the source exactly under an identity camera', () => {
    const wide = svgToGray(codeLikeSvg().replace('viewBox="-25 -25 50 50"', 'viewBox="-30 -25 60 50"'), { widthPx: 360 });
    for (const src of [CODE_LIKE, wide]) {
      const out = simulateCapture(src, identity(src), 1);
      expect([out.width, out.height]).toEqual([src.width, src.height]);
      expect(meanAbsDiff(out, src)).toBe(0);
    }
  });

  it('defaults to a centred, face-on 1280×720 capture at 60 % of the short side', () => {
    const geom = captureGeometry(CODE_LIKE);
    expect([geom.width, geom.height]).toEqual([1280, 720]);
    expect(geom.center.x).toBeCloseTo(640, 9);
    expect(geom.center.y).toBeCloseTo(360, 9);
    expect(geom.corners[1]!.x - geom.corners[0]!.x).toBeCloseTo(432, 9);
    expect(geom.scaleAtCenter).toBeCloseTo(432 / CODE_LIKE.width, 6);
    const out = simulateCapture(CODE_LIKE, PRESETS.clean, 1);
    expect(pixel(out, geom.center)).toBe(0); // seal core
  });

  const base: CaptureParams = { frame: { width: 800, height: 600 }, background: 1 };
  const configs: [string, CaptureParams][] = [
    ['face-on, rotated, offset', { ...base, codeWidthPx: 450, rotationDeg: 33, offset: { x: -40, y: 25 } }],
    ['tilted on both axes', { ...base, codeWidthPx: 420, rotationDeg: 20, tiltXDeg: 35, tiltYDeg: -25, offset: { x: 30, y: -20 } }],
    ['steep and close (strong keystone)', { ...base, codeWidthPx: 380, tiltXDeg: 60, focalLengthPx: 500 }],
    ['barrel distortion', { ...base, codeWidthPx: 520, tiltYDeg: 15, barrelK1: 0.08 }],
    ['curved like a ring', { ...base, codeWidthPx: 420, curvature: 1, rotationDeg: -12, tiltYDeg: 10 }],
    ['downscaled', { ...base, codeWidthPx: 500, tiltXDeg: -20, rotationDeg: 8, downscale: 2 }],
  ];

  it.each(configs)('places known source points where captureGeometry projects them (%s)', (_, params) => {
    const out = simulateCapture(DOT_SOURCE, params, 1);
    const geom = captureGeometry(DOT_SOURCE, params);
    expect([out.width, out.height]).toEqual([geom.width, geom.height]);
    for (const dot of DOTS) {
      const expected = geom.project(dot.x, dot.y)!;
      const found = darkCentroid(out, expected, 14 / (params.downscale ?? 1));
      expect(Math.hypot(found.x - expected.x, found.y - expected.y)).toBeLessThan(1);
    }
  });

  it('reports corners and a homography consistent with the forward model', () => {
    for (const params of [configs[1][1], configs[2][1], configs[5][1]]) {
      const geom = captureGeometry(DOT_SOURCE, params);
      expect(perspectiveHomography(DOT_SOURCE, params)).toEqual(geom.homography);
      const sourceCorners = [
        [0, 0],
        [600, 0],
        [600, 600],
        [0, 600],
      ];
      sourceCorners.forEach(([u, v], i) => {
        const viaH = applyH(geom.homography, u, v);
        expect(viaH.x).toBeCloseTo(geom.corners[i]!.x, 6);
        expect(viaH.y).toBeCloseTo(geom.corners[i]!.y, 6);
      });
    }
  });

  it('renders the source silhouette exactly at the reported corners', () => {
    const ink = createGray(300, 200, 0);
    const params: CaptureParams = { frame: { width: 800, height: 600 }, codeWidthPx: 400, tiltXDeg: 30, rotationDeg: 15, sheetMargin: 0, background: 1 };
    const out = simulateCapture(ink, params, 1);
    const { center, corners } = captureGeometry(ink, params);
    for (const c of corners) {
      const towardsCentre = { x: center.x - c!.x, y: center.y - c!.y };
      const step = 6 / Math.hypot(towardsCentre.x, towardsCentre.y);
      expect(pixel(out, { x: c!.x + towardsCentre.x * step, y: c!.y + towardsCentre.y * step })).toBeLessThan(10);
      expect(pixel(out, { x: c!.x - towardsCentre.x * step, y: c!.y - towardsCentre.y * step })).toBeGreaterThan(245);
    }
  });

  it('area-averages minified detail instead of aliasing it', () => {
    const checker = createGray(800, 800);
    checker.data.forEach((_, i) => (checker.data[i] = ((i % 800) + Math.floor(i / 800)) % 2 ? 255 : 0));
    const out = simulateCapture(checker, { frame: { width: 300, height: 300 }, codeWidthPx: 200, tiltYDeg: 10 }, 1);
    const { mean, sd } = stats(out, 110, 110, 190, 190);
    expect(mean).toBeGreaterThan(120);
    expect(mean).toBeLessThan(135);
    expect(sd).toBeLessThan(6);
  });

  it('bends the surface on a cylinder, darkening towards the silhouette', () => {
    const white = createGray(400, 400, 255);
    const params: CaptureParams = { frame: { width: 600, height: 600 }, codeWidthPx: 400, curvature: 1.2, background: 0 };
    const out = simulateCapture(white, params, 1);
    const geom = captureGeometry(white, params);
    expect(pixel(out, geom.center)).toBe(255);
    // At the source edge the surface normal is 0.6 rad from the crest: √cos(0.6) of full brightness.
    const edge = geom.project(1, 200)!;
    expect(Math.abs(pixel(out, { x: edge.x + 1, y: edge.y }) - 255 * Math.sqrt(Math.cos(0.6)))).toBeLessThan(4);
    // The bend foreshortens the edges: the projected width is less than the flat width.
    expect(geom.corners[1]!.x - geom.corners[0]!.x).toBeLessThan(400);
  });
});

// ── Photometry, optics, sensor, codec ──────────────────────────────────────

describe('simulateCapture: photometry and artifacts', () => {
  it('remaps source luma between inkLevel and paperLevel (contrast and polarity)', () => {
    const inverted = simulateCapture(CODE_LIKE, { ...identity(CODE_LIKE), paperLevel: 0, inkLevel: 1 }, 1);
    expect(inverted.data.reduce((m, v, i) => Math.max(m, Math.abs(v - (255 - CODE_LIKE.data[i]))), 0)).toBeLessThanOrEqual(1);
    const lowContrast = simulateCapture(CODE_LIKE, { ...identity(CODE_LIKE), paperLevel: 0.8, inkLevel: 0.2 }, 1);
    expect(lowContrast.data.reduce((m, v) => Math.min(m, v), 255)).toBe(51);
    expect(lowContrast.data.reduce((m, v) => Math.max(m, v), 0)).toBe(204);
  });

  it('adds sensor noise with the configured read and shot components', () => {
    const flat = createGray(256, 256, 255);
    const read = stats(simulateCapture(flat, { ...identity(flat), paperLevel: 0.5, noise: { sigma: 4 } }, 1));
    expect(read.mean).toBeCloseTo(127.5, 0);
    expect(read.sd).toBeGreaterThan(3.85);
    expect(read.sd).toBeLessThan(4.15);
    const shot = stats(simulateCapture(flat, { ...identity(flat), paperLevel: 0.5, noise: { sigma: 2, shot: 1 } }, 1));
    expect(shot.sd).toBeGreaterThan(Math.sqrt(4 + 127) - 0.3);
    expect(shot.sd).toBeLessThan(Math.sqrt(4 + 128) + 0.3);
  });

  it('defocus spreads edges while preserving the mean', () => {
    const half = createGray(200, 100, 255);
    for (let y = 0; y < 100; y++) half.data.fill(0, y * 200, y * 200 + 100);
    const sharp = simulateCapture(half, identity(half), 1);
    const soft = simulateCapture(half, { ...identity(half), blurSigma: 2 }, 1);
    expect(stats(soft).mean).toBeCloseTo(stats(sharp).mean, 0);
    // Pixel centres 1.5 px either side of the edge: Φ(∓0.75) of full scale ≈ 58 / 197.
    const row = 50 * 200;
    expect(sharp.data[row + 98]).toBe(0);
    expect(Math.abs(soft.data[row + 98] - 58)).toBeLessThanOrEqual(2);
    expect(Math.abs(soft.data[row + 101] - 197)).toBeLessThanOrEqual(2);
  });

  it('motion blur smears along its direction only', () => {
    const dot = createGray(81, 81, 255);
    dot.data.fill(0, 40 * 81 + 40, 40 * 81 + 41);
    const out = simulateCapture(dot, { ...identity(dot), motionBlur: { lengthPx: 9, angleDeg: 90 } }, 1);
    for (const dx of [-3, 3]) expect(out.data[40 * 81 + 40 + dx]).toBeLessThan(240);
    for (const dy of [-3, 3]) expect(out.data[(40 + dy) * 81 + 40]).toBe(255);
  });

  it('glare saturates the sensor even over solid ink', () => {
    const ink = createGray(200, 200, 0);
    const out = simulateCapture(ink, { ...identity(ink), glare: { x: 0.5, y: 0.5, radius: 0.2, aspect: 0.5, intensity: 1.5 } }, 1);
    expect(out.data[100 * 200 + 100]).toBe(255);
    // Major axis points north: brighter 25 px above the centre than 25 px to its side.
    expect(out.data[75 * 200 + 100]).toBeGreaterThan(out.data[100 * 200 + 125] + 50);
    expect(out.data[5 * 200 + 5]).toBe(0);
  });

  it('applies the illumination gradient towards angleDeg and vignettes the corners', () => {
    const paper = createGray(400, 300, 255);
    const lit = simulateCapture(paper, { ...identity(paper), paperLevel: 0.6, illumination: { angleDeg: 90, strength: 0.3 } }, 1);
    // ±(200 − 0.5) px from the centre along the gradient, half-diagonal 250 px.
    expect(Math.abs(lit.data[150 * 400 + 399] - 0.6 * 255 * (1 + (0.3 * 199.5) / 250))).toBeLessThanOrEqual(1);
    expect(Math.abs(lit.data[150 * 400] - 0.6 * 255 * (1 - (0.3 * 199.5) / 250))).toBeLessThanOrEqual(1);
    const vignetted = simulateCapture(paper, { ...identity(paper), paperLevel: 0.6, vignette: 0.4 }, 1);
    expect(vignetted.data[150 * 400 + 200]).toBe(153);
    expect(Math.abs(vignetted.data[0] - 0.6 * 255 * 0.6)).toBeLessThanOrEqual(2);
  });

  it('occluders cover the requested fraction of the code area', () => {
    const white = createGray(400, 400, 255);
    const blob = simulateCapture(white, { ...identity(white), occlusion: [{ kind: 'blob', x: 0.5, y: 0.5, area: 0.05, level: 0 }] }, 1);
    expect(blob.data.filter((v) => v < 128).length / blob.data.length).toBeCloseTo(0.05, 2);
    const strip = simulateCapture(white, { ...identity(white), occlusion: [{ kind: 'strip', x: 0.5, y: 0.5, area: 0.02, aspect: 0.1, level: 0 }] }, 1);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // prettier-ignore
    strip.data.forEach((v, i) => {
      if (v >= 128) return;
      minX = Math.min(minX, i % 400);
      maxX = Math.max(maxX, i % 400);
      minY = Math.min(minY, Math.floor(i / 400));
      maxY = Math.max(maxY, Math.floor(i / 400));
    });
    expect(maxY - minY).toBeGreaterThan(5 * (maxX - minX)); // angle 0 = major axis north
  });

  it('places random occluders from the seed', () => {
    const params: CaptureParams = { ...identity(CODE_LIKE), occlusion: { count: 4, area: 0.01 } };
    const a = simulateCapture(CODE_LIKE, params, 5);
    expect(identical(simulateCapture(CODE_LIKE, params, 5), a)).toBe(true);
    expect(meanAbsDiff(a, simulateCapture(CODE_LIKE, params, 6))).toBeGreaterThan(0.5);
    expect(meanAbsDiff(a, CODE_LIKE)).toBeGreaterThan(0.5);
  });

  it('textures differ by material and are attached to the surface', () => {
    const white = createGray(512, 512, 255);
    const sd = (substrate: CaptureParams['substrate']) =>
      stats(simulateCapture(white, { ...identity(white), paperLevel: 0.7, substrate }, 1), 64, 64, 448, 448).sd;
    expect(sd('none')).toBe(0);
    const paper = sd('paper');
    expect(paper).toBeGreaterThan(1);
    expect(paper).toBeLessThan(8);
    expect(sd('textured-paper')).toBeGreaterThan(paper);
    expect(sd('leather')).toBeGreaterThan(paper);

    // Brushing runs along the source x axis: neighbours along x differ far less than along y.
    const metal = simulateCapture(white, { ...identity(white), paperLevel: 0.7, substrate: 'brushed-metal' }, 1);
    let along = 0;
    let across = 0;
    for (let y = 64; y < 448; y++) {
      for (let x = 64; x < 448; x++) {
        const i = y * 512 + x;
        along += Math.abs(metal.data[i + 1] - metal.data[i]);
        across += Math.abs(metal.data[i + 512] - metal.data[i]);
      }
    }
    expect(along).toBeLessThan(0.5 * across);

    // Moving the camera moves the texture with the surface (pure translation face-on).
    const params: CaptureParams = { frame: { width: 600, height: 600 }, codeWidthPx: 512, substrate: 'leather' };
    const a = simulateCapture(white, params, 3);
    const b = simulateCapture(white, { ...params, offset: { x: 16, y: 0 } }, 3);
    for (let y = 100; y < 500; y += 7) {
      for (let x = 100; x < 480; x += 5) expect(b.data[y * 600 + x + 16]).toBe(a.data[y * 600 + x]);
    }
  });

  it('shows the background outside the source, by default a blank card at paper level', () => {
    const ink = createGray(100, 100, 0);
    const frame = { width: 300, height: 300 };
    expect(simulateCapture(ink, { frame, codeWidthPx: 100 }, 1).data[0]).toBe(255);
    expect(simulateCapture(ink, { frame, codeWidthPx: 100, paperLevel: 0.5 }, 1).data[0]).toBe(128);
    const dark = simulateCapture(ink, { frame, codeWidthPx: 100, background: 0.1 }, 1);
    expect(dark.data[0]).toBe(26);
    expect(dark.data[150 * 300 + 150]).toBe(0);
  });

  it('shows the background beyond the sheet margin', () => {
    const white = createGray(200, 200, 255);
    const flat = simulateCapture(white, { frame: { width: 400, height: 400 }, codeWidthPx: 200, sheetMargin: 0.25, background: 0.2 }, 1);
    expect(flat.data[0]).toBe(51);
    expect(flat.data[200 * 400 + 60]).toBe(255);
    expect(flat.data[200 * 400 + 40]).toBe(51);
    const clutter = simulateCapture(white, { frame: { width: 400, height: 400 }, codeWidthPx: 200, sheetMargin: 0.25, background: { kind: 'clutter' } }, 1);
    const border = stats(clutter, 0, 0, 400, 40);
    expect(border.sd).toBeGreaterThan(5);
    expect(border.mean).toBeGreaterThan(20);
    expect(border.mean).toBeLessThan(160);
  });

  it('downscales by area averaging and reports geometry in output pixels', () => {
    const params: CaptureParams = { frame: { width: 640, height: 480 }, codeWidthPx: 300, rotationDeg: 10 };
    const full = simulateCapture(CODE_LIKE, params, 1);
    const half = simulateCapture(CODE_LIKE, { ...params, downscale: 2 }, 1);
    expect([half.width, half.height]).toEqual([320, 240]);
    expect(Math.abs(stats(half).mean - stats(full).mean)).toBeLessThan(0.5);
    // 2×2 box average of the full-resolution frame, up to rounding.
    expect(half.data[120 * 320 + 160]).toBeCloseTo(
      (full.data[240 * 640 + 320] + full.data[240 * 640 + 321] + full.data[241 * 640 + 320] + full.data[241 * 640 + 321]) / 4,
      -0.3,
    );
    const odd = captureGeometry(CODE_LIKE, { ...params, downscale: 1.5 });
    expect([odd.width, odd.height]).toEqual([427, 320]);
    expect(captureGeometry(CODE_LIKE, { ...params, downscale: 2 }).center).toEqual({ x: 160, y: 120 });
  });

  it('adds JPEG artifacts; the fast codec matches jpeg-js', () => {
    const params: CaptureParams = { ...identity(CODE_LIKE), blurSigma: 0.8, noise: { sigma: 2 } };
    const raw = simulateCapture(CODE_LIKE, params, 1);
    const fast = simulateCapture(CODE_LIKE, { ...params, jpegQuality: 50 }, 1);
    const exact = simulateCapture(CODE_LIKE, { ...params, jpegQuality: 50, jpegCodec: 'jpeg-js' }, 1);
    expect(meanAbsDiff(fast, raw)).toBeGreaterThan(1);
    expect(meanAbsDiff(fast, exact)).toBeLessThan(0.3);
  });

  it('rejects invalid parameters', () => {
    const bad: CaptureParams[] = [
      { tiltXDeg: 89 },
      { blurSigma: -1 },
      { paperLevel: 2 },
      { downscale: 0.5 },
      { barrelK1: 1 },
      { noise: { sigma: -1 } },
      { jpegQuality: 0 },
      { occlusion: [{ kind: 'blob', x: 0.5, y: 0.5, area: 0 }] },
      { codeWidthPx: 0 },
      { frame: { width: 10.5, height: 10 } },
      { background: 2 },
      { sheetMargin: -1 },
      { curvature: -0.1 },
    ];
    for (const params of bad) expect(() => simulateCapture(CODE_LIKE, params, 1), JSON.stringify(params)).toThrow(RangeError);
  });
});

// ── Determinism, presets, performance ──────────────────────────────────────

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

describe('PRESETS', () => {
  it.each(PRESET_NAMES)('%s is deterministic per seed', (name) => {
    // Half-size frame keeps the suite fast; every effect is still exercised.
    const preset = PRESETS[name];
    const params: CaptureParams = { ...preset, frame: { width: 640, height: 360 }, codeWidthPx: (preset.codeWidthPx ?? 432) / 2 };
    const a = simulateCapture(CODE_LIKE, params, 3);
    expect(identical(simulateCapture(CODE_LIKE, params, 3), a)).toBe(true);
    if (name !== 'clean') expect(meanAbsDiff(a, simulateCapture(CODE_LIKE, params, 4))).toBeGreaterThan(0);
  });

  it.each(PRESET_NAMES)('%s yields a full frame with the code visible', (name) => {
    const out = simulateCapture(CODE_LIKE, PRESETS[name], 11);
    expect([out.width, out.height]).toEqual([1280, 720]);
    const { corners } = captureGeometry(CODE_LIKE, PRESETS[name]);
    const xs = corners.map((c) => c!.x);
    const ys = corners.map((c) => c!.y);
    const values: number[] = [];
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(720, Math.ceil(Math.max(...ys))); y += 2) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(1280, Math.ceil(Math.max(...xs))); x += 2) {
        values.push(out.data[y * 1280 + x]);
      }
    }
    values.sort((a, b) => a - b);
    const p5 = values[Math.floor(values.length * 0.05)];
    const p95 = values[Math.floor(values.length * 0.95)];
    expect(p95 - p5).toBeGreaterThan(40); // ink and paper both present
  });

  it('are frozen all the way down', () => {
    expect(Object.isFrozen(PRESETS)).toBe(true);
    expect(Object.isFrozen(PRESETS.typicalPhone)).toBe(true);
    expect(Object.isFrozen(PRESETS.typicalPhone.noise)).toBe(true);
  });
});

describe('performance', () => {
  it('renders a typical 1280×720 phone frame quickly', () => {
    const source = svgToGray(codeLikeSvg(), { widthPx: 800 });
    const time = (params: CaptureParams): number => {
      simulateCapture(source, params, 0); // warm-up (JIT, cached material textures)
      const runs = [1, 2, 3].map((seed) => {
        const started = performance.now();
        simulateCapture(source, params, seed);
        return performance.now() - started;
      });
      return runs.sort((a, b) => a - b)[1];
    };
    // Typically ≈ 30 ms (clean) and ≈ 100–200 ms (typicalPhone); the bounds leave room for slow, loaded CI hosts.
    const clean = time(PRESETS.clean);
    const typical = time(PRESETS.typicalPhone);
    expect(clean, `clean took ${clean.toFixed(0)} ms`).toBeLessThan(400);
    expect(typical, `typicalPhone took ${typical.toFixed(0)} ms`).toBeLessThan(1500);
  });
});
