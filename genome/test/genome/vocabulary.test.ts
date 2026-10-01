import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import type { Primitive } from '../../src/core/geometry.js';
import { GENOME01_GLYPHS, GENOME_GLYPH_CANDIDATES, SYMMETRIC_FAMILY, type GlyphCandidate } from '../../src/core/genome/index.js';
import { primitiveToPathData } from '../../src/core/render/svg.js';

/** Largest distance from the glyph centre (0, 0) reached by a primitive's ink. */
function extent(p: Primitive): number {
  const centre = Math.hypot(p.cx, p.cy);
  switch (p.kind) {
    case 'disc':
    case 'halfDisc':
    case 'crescent':
      return centre + p.r;
    case 'ring':
    case 'arc':
      return centre + p.r + p.width / 2;
  }
}

/** Thinnest feature of a primitive: stroke width, dot diameter or crescent thickness. */
function thinnest(p: Primitive): number {
  switch (p.kind) {
    case 'disc':
    case 'halfDisc':
      return 2 * p.r;
    case 'ring':
    case 'arc':
      return p.width;
    case 'crescent':
      return p.offset;
  }
}

/** A unit-glyph primitive field after placing the glyph at (dx, dy) with radius k. */
function placedValue(key: string, value: unknown, dx: number, dy: number, k: number): unknown {
  if (key === 'cx') return dx + k * (value as number);
  if (key === 'cy') return dy + k * (value as number);
  return ['r', 'width', 'offset'].includes(key) ? k * (value as number) : value;
}

/** Ink coverage of a glyph rendered with resvg: radius R px, centred in a `side` px square. */
function renderGlyph(glyph: GlyphCandidate, R: number, side: number): Float64Array {
  const half = side / 2;
  const paths = glyph
    .primitives(0, 0, R)
    .map((p) => `<path d="${primitiveToPathData(p)}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${side} ${side}" width="${side}" height="${side}">${paths}</svg>`;
  const rgba = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;
  const ink = new Float64Array(side * side);
  for (let i = 0; i < ink.length; i++) ink[i] = rgba[4 * i + 3] / 255;
  return ink;
}

function gaussianBlur(src: Float64Array, side: number, sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const pass = (img: Float64Array, dx: number, dy: number): Float64Array =>
    img.map((_, i) => {
      const x = i % side;
      const y = Math.floor(i / side);
      let acc = 0;
      for (let t = -radius; t <= radius; t++) {
        const xx = x + t * dx;
        const yy = y + t * dy;
        if (xx >= 0 && xx < side && yy >= 0 && yy < side) acc += (kernel[t + radius] / sum) * img[yy * side + xx];
      }
      return acc;
    });
  return pass(pass(src, 1, 0), 0, 1);
}

function ncc(a: Float64Array, b: Float64Array): number {
  const mean = (v: Float64Array): number => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

describe('GENOME01_GLYPHS', () => {
  it('freezes 16 glyphs in their permanent index order', () => {
    expect(GENOME01_GLYPHS.map((g) => g.id)).toEqual([
      'FULL_ORBIT',
      'RING_POINT',
      'SMALL_ORBIT',
      'POINT',
      'HALF_ARC_N',
      'HALF_ARC_E',
      'HALF_ARC_S',
      'HALF_ARC_W',
      'ARC_PAIR_NS',
      'ARC_PAIR_NESW',
      'ARC_PAIR_EW',
      'ARC_PAIR_NWSE',
      'QUARTER_ORB_NE',
      'QUARTER_ORB_SE',
      'QUARTER_ORB_SW',
      'QUARTER_ORB_NW',
    ]);
    GENOME01_GLYPHS.forEach((g, i) => expect(g.index).toBe(i));
    expect(Object.isFrozen(GENOME01_GLYPHS)).toBe(true);
    expect(Object.isFrozen(GENOME01_GLYPHS[0])).toBe(true);
  });

  it('has unique ids, names and hints', () => {
    for (const key of ['id', 'name', 'hint'] as const) {
      expect(new Set(GENOME01_GLYPHS.map((g) => g[key])).size).toBe(16);
    }
    for (const g of GENOME01_GLYPHS) {
      expect(g.id).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
      expect([...g.hint]).toHaveLength(1);
    }
  });

  it('is systematic: the high two bits name the family, oriented ids carry their family', () => {
    for (let family = 0; family < 4; family++) {
      const members = GENOME01_GLYPHS.slice(4 * family, 4 * family + 4);
      expect(new Set(members.map((g) => g.family)).size).toBe(1);
      if (members[0].family !== SYMMETRIC_FAMILY) for (const g of members) expect(g.id.startsWith(`${g.family}_`)).toBe(true);
    }
    expect(GENOME01_GLYPHS.slice(0, 4).every((g) => g.family === SYMMETRIC_FAMILY)).toBe(true);
  });

  it('draws only genome-layer primitives that scale and translate with (cx, cy, R)', () => {
    for (const g of GENOME01_GLYPHS) {
      const unit = g.primitives(0, 0, 1);
      const placed = g.primitives(3, -2, 2.5);
      expect(unit.length).toBeGreaterThan(0);
      expect(placed).toHaveLength(unit.length);
      placed.forEach((p, i) => {
        expect(p.layer).toBe('genome');
        const expected = Object.entries(unit[i]).map(([key, value]) => [key, placedValue(key, value, 3, -2, 2.5)] as const);
        expect(Object.keys(p)).toEqual(expected.map(([key]) => key));
        for (const [key, value] of expected) {
          const actual = (p as unknown as Record<string, unknown>)[key];
          if (typeof value === 'number') expect(actual, `${g.id}.${key}`).toBeCloseTo(value, 12);
          else expect(actual).toBe(value);
        }
      });
    }
  });

  it('keeps all ink within R when rasterised', () => {
    const R = 60;
    const side = 2 * R + 16;
    for (const g of GENOME01_GLYPHS) {
      const ink = renderGlyph(g, R, side);
      let total = 0;
      ink.forEach((v, i) => {
        total += v;
        const d = Math.hypot((i % side) + 0.5 - side / 2, Math.floor(i / side) + 0.5 - side / 2);
        if (d > R + 1 && v > 0) expect.fail(`${g.id}: ink at ${d.toFixed(2)} px > R = ${R} px`);
      });
      expect(total, g.id).toBeGreaterThan(0.05 * Math.PI * R * R);
    }
  });

  it('stays mutually distinct at 12 px under blur (σ 0.8 px)', () => {
    const side = 16;
    const renders = GENOME01_GLYPHS.map((g) => gaussianBlur(renderGlyph(g, 6, side), side, 0.8));
    let closest = Infinity;
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) closest = Math.min(closest, 1 - ncc(renders[a], renders[b]));
    // The symbol study guarantees ≥ 0.28 in the worst case over jitter; upright renders do at least as well.
    expect(closest).toBeGreaterThan(0.28);
  });

  it('keeps its frozen geometry (snapshot hash)', () => {
    // Hash of the unit-glyph primitives, rounded to 1e-9 so only real geometry changes register.
    const geometry = JSON.stringify(
      GENOME01_GLYPHS.map((g) => [g.id, g.primitives(0, 0, 1)]),
      (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v),
    );
    expect(createHash('sha256').update(geometry).digest('hex')).toBe('175ef132eba020ae8c20a4de51635cad46c529045a32327774082fb66364efa8');
  });
});

describe('GENOME_GLYPH_CANDIDATES', () => {
  it('offers a pool of at least 24 forms containing every GENOME-01 glyph', () => {
    expect(GENOME_GLYPH_CANDIDATES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(GENOME_GLYPH_CANDIDATES.map((g) => g.id)).size).toBe(GENOME_GLYPH_CANDIDATES.length);
    for (const g of GENOME01_GLYPHS) expect(GENOME_GLYPH_CANDIDATES.some((c) => c.id === g.id && c.primitives === g.primitives)).toBe(true);
  });

  it('groups oriented forms in families of exactly four', () => {
    const families = new Map<string, number>();
    for (const g of GENOME_GLYPH_CANDIDATES) if (g.family !== SYMMETRIC_FAMILY) families.set(g.family, (families.get(g.family) ?? 0) + 1);
    expect(families.size).toBeGreaterThanOrEqual(3);
    for (const count of families.values()) expect(count).toBe(4);
  });

  it('keeps every candidate within R with features of at least 0.22 R', () => {
    for (const g of GENOME_GLYPH_CANDIDATES) {
      for (const p of g.primitives(0, 0, 1)) {
        expect(extent(p), g.id).toBeLessThanOrEqual(1 + 1e-12);
        expect(thinnest(p), g.id).toBeGreaterThanOrEqual(0.22);
      }
    }
  });
});
