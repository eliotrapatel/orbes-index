import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { CODE01, CODE01_GENOME_CENTERS } from '../../src/core/code/profile.js';
import {
  GENOME01_GLYPHS,
  computeGenome,
  genomeGlyphPrimitives,
  genomeLayout,
  renderGenomeSvg,
  type Genome,
} from '../../src/core/genome/index.js';
import { GENOME_MONOGRAM_WIDTH } from '../../src/core/genome/render.js';
import { MONOGRAM_PATHS, monogramHeight, monogramPathData, pathBounds } from '../../src/core/render/monogram.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const EXAMPLE = computeGenome(0x341000b8);
const POINT = GENOME01_GLYPHS.findIndex((g) => g.id === 'POINT');
const FULL_ORBIT = GENOME01_GLYPHS.findIndex((g) => g.id === 'FULL_ORBIT');

/** A genome object with chosen glyphs, for layout checks. */
function genomeWith(glyphs: number[]): Genome {
  return { ...EXAMPLE, glyphs, ids: glyphs.map((g) => GENOME01_GLYPHS[g]?.id ?? 'INVALID') };
}

/** Luma (0..255) of the pixel at viewBox point (x, y) when the SVG is rendered `px` wide. */
function lumaAt(svg: string, viewBox: { x: number; y: number; w: number }, px: number, x: number, y: number): number {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: px }, font: { loadSystemFonts: false } }).render();
  const k = px / viewBox.w;
  const col = Math.floor((x - viewBox.x) * k);
  const row = Math.floor((y - viewBox.y) * k);
  return image.pixels[4 * (row * image.width + col)];
}

describe('genomeGlyphPrimitives', () => {
  it('draws the vocabulary glyph at the requested place and size', () => {
    for (const g of GENOME01_GLYPHS) {
      expect(genomeGlyphPrimitives(g.index, 7, -3, 1.75)).toEqual(g.primitives(7, -3, 1.75));
      expect(genomeGlyphPrimitives(g.index, 7, -3, 1.75, 1)).toEqual(g.primitives(7, -3, 1.75));
    }
  });

  it('rejects unknown glyphs, sizes and versions', () => {
    for (const glyph of [-1, 16, 1.5, Number.NaN]) expect(() => genomeGlyphPrimitives(glyph, 0, 0, 1)).toThrow(RangeError);
    for (const R of [0, -1, Number.POSITIVE_INFINITY]) expect(() => genomeGlyphPrimitives(0, 0, 0, R)).toThrow(RangeError);
    expect(() => genomeGlyphPrimitives(0, 0, 0, 1, 2)).toThrow(RangeError);
  });
});

describe('genomeLayout', () => {
  it("places the orbit glyphs exactly where CODE-01 prints them, glyph 0 at north", () => {
    const layout = genomeLayout(genomeWith(new Array(8).fill(POINT)), 'orbit');
    const glyphDiscs = layout.primitives.filter((p) => p.layer === 'genome');
    expect(glyphDiscs).toHaveLength(8);
    glyphDiscs.forEach((p, i) => {
      expect(p.cx).toBeCloseTo(CODE01_GENOME_CENTERS[i].x, 12);
      expect(p.cy).toBeCloseTo(CODE01_GENOME_CENTERS[i].y, 12);
    });
    expect(CODE01_GENOME_CENTERS[0].y).toBeLessThan(0);
    expect(layout.primitives.filter((p) => p.layer === 'seal')).toHaveLength(2);
    expect(layout.primitives.filter((p) => p.layer === 'decor')).toHaveLength(8);
  });

  it('lines the row glyphs up with a separator point between neighbours', () => {
    const layout = genomeLayout(genomeWith(new Array(8).fill(POINT)), 'row');
    const glyphs = layout.primitives.filter((p) => p.layer === 'genome');
    const separators = layout.primitives.filter((p) => p.layer === 'decor');
    expect(separators).toHaveLength(7);
    glyphs.forEach((p, i) => {
      expect(p.cy).toBe(0);
      if (i > 0) expect(separators[i - 1].cx).toBeCloseTo((glyphs[i - 1].cx + p.cx) / 2, 12);
    });
    expect(layout.glyphRadius).toBe(1);
  });

  it('rejects malformed genomes and layouts', () => {
    expect(() => genomeLayout(genomeWith([0, 0, 0, 0, 0, 0, 0]))).toThrow(RangeError);
    expect(() => genomeLayout(EXAMPLE, 'spiral' as 'row')).toThrow(RangeError);
    expect(() => genomeLayout(genomeWith([0, 0, 0, 0, 0, 0, 0, 16]))).toThrow(RangeError);
  });
});

describe('renderGenomeSvg', () => {
  it('renders deterministic row and orbit documents (snapshot hashes)', () => {
    const row = renderGenomeSvg(EXAMPLE);
    const orbit = renderGenomeSvg(EXAMPLE, { layout: 'orbit' });
    expect(renderGenomeSvg(EXAMPLE, { layout: 'row' })).toBe(row);
    expect(renderGenomeSvg(EXAMPLE, { layout: 'orbit' })).toBe(orbit);
    expect(sha256(row)).toBe('eb5390256c95b0f536849a82777410c08928bd9a128ca6819fa87dd96f37b18d');
    expect(sha256(orbit)).toBe('1e7ebdba2504d32e354c8d83c100f03531f17d6e3477fc9fb4e55946899c9a8a');
  });

  it('titles the document with the fingerprint and applies ink and paper', () => {
    const svg = renderGenomeSvg(EXAMPLE, { ink: '#111111', paper: '#f7f5f0' });
    expect(svg).toContain('<title>ORBES GENOME G1-E1DC-BE52</title>');
    expect(svg).toContain('<g fill="#111111">');
    expect(svg).toContain('fill="#f7f5f0"');
    expect(renderGenomeSvg(EXAMPLE, { paper: null })).not.toContain('<rect');
  });

  it('sizes the document from the physical glyph diameter', () => {
    const row = genomeLayout(EXAMPLE, 'row').viewBox;
    expect(renderGenomeSvg(EXAMPLE, { glyphSize: 4 })).toContain(`width="${(2 * row.w).toFixed(3).replace(/\.?0+$/, '')}mm"`);
    const orbit = genomeLayout(EXAMPLE, 'orbit');
    const expected = (4 * orbit.viewBox.w) / (2 * orbit.glyphRadius);
    expect(renderGenomeSvg(EXAMPLE, { layout: 'orbit', glyphSize: 4 })).toContain(`width="${expected}mm" height="${expected}mm"`);
    expect(renderGenomeSvg(EXAMPLE)).not.toContain('mm"');
    expect(() => renderGenomeSvg(EXAMPLE, { glyphSize: 0 })).toThrow(RangeError);
  });

  it('rasterises with glyph 0 at north: ink at a point glyph, paper inside an orbit', () => {
    const glyphs = new Array<number>(8).fill(FULL_ORBIT);
    glyphs[0] = POINT;
    const genome = genomeWith(glyphs);
    const { viewBox } = genomeLayout(genome, 'orbit');
    const svg = renderGenomeSvg(genome, { layout: 'orbit' });
    const north = CODE01_GENOME_CENTERS[0];
    const east = CODE01_GENOME_CENTERS[2];
    expect(lumaAt(svg, viewBox, 420, north.x, north.y)).toBeLessThan(40);
    expect(lumaAt(svg, viewBox, 420, east.x, east.y)).toBeGreaterThan(215);
    expect(lumaAt(svg, viewBox, 420, 0, 0)).toBeLessThan(40); // seal core
  });

  it('rejects unknown layouts', () => {
    expect(() => renderGenomeSvg(EXAMPLE, { layout: 'grid' as 'row' })).toThrow(RangeError);
  });
});

describe('the orbit\'s centre: the SEAL as printed, or the ORBES monogram on a collector\'s screen (NOCTURNE, decision 12)', () => {
  it('keeps the SEAL by default, byte for byte, in the orbit; the row has no centre', () => {
    const orbit = renderGenomeSvg(EXAMPLE, { layout: 'orbit' });
    expect(renderGenomeSvg(EXAMPLE, { layout: 'orbit', centre: 'seal' })).toBe(orbit);
    expect(orbit.match(/data-layer="seal"/g)).toHaveLength(1);
    expect(orbit).not.toContain('data-layer="monogram"');
    expect(genomeLayout(EXAMPLE, 'orbit').monogram).toBeUndefined();
    expect(genomeLayout(EXAMPLE, 'orbit', { centre: 'seal' })).toEqual(genomeLayout(EXAMPLE, 'orbit'));
    // The row draws no centre: the option leaves it as it is.
    expect(renderGenomeSvg(EXAMPLE, { centre: 'monogram' })).toBe(renderGenomeSvg(EXAMPLE));
    expect(genomeLayout(EXAMPLE, 'row', { centre: 'monogram' }).monogram).toBeUndefined();
  });

  it('gives the seal\'s core disc and ring way to the master\'s five outlines, placed 8 u wide and centred, never redrawn', () => {
    const seal = genomeLayout(EXAMPLE, 'orbit');
    const mono = genomeLayout(EXAMPLE, 'orbit', { centre: 'monogram' });
    // Every glyph and separator exactly as around the SEAL, in the same viewBox; no seal primitive.
    expect(mono.primitives).toEqual(seal.primitives.filter((p) => p.layer !== 'seal'));
    expect(mono.primitives.some((p) => p.layer === 'seal')).toBe(false);
    expect(mono.viewBox).toEqual(seal.viewBox);
    expect(mono.glyphRadius).toBe(seal.glyphRadius);
    // The seal ring's diameter, 8 u.
    expect(GENOME_MONOGRAM_WIDTH).toBe(2 * CODE01.seal.ringOuter);
    expect(GENOME_MONOGRAM_WIDTH).toBe(8);
    // The master paths placed (core/render/monogram.ts), centred on the orbit's centre.
    const h = monogramHeight(8);
    expect(mono.monogram).toEqual(monogramPathData({ x: -4, y: -h / 2, width: 8 }));
    expect(mono.monogram).toHaveLength(MONOGRAM_PATHS.length);
    const b = pathBounds(mono.monogram!);
    expect(b.x).toBeCloseTo(-4, 2);
    expect(b.w).toBeCloseTo(8, 2);
    expect(b.y + b.h / 2).toBeCloseTo(0, 2);
    expect(b.h).toBeCloseTo(h, 2);
    // Inside the seal's quiet ring (5.75 u): no corner of its ink box reaches it.
    for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      expect(Math.hypot(x, y)).toBeLessThan(CODE01.seal.quietOuter);
    }
  });

  it('draws the monogram in the glyphs\' ink, in a group of its own before the glyphs, filled with the nonzero rule', () => {
    const svg = renderGenomeSvg(EXAMPLE, { layout: 'orbit', centre: 'monogram', ink: '#f6f2ea', paper: null });
    expect(svg).toContain('<g fill="#f6f2ea">');
    expect(svg).not.toContain('data-layer="seal"');
    const group = /<g data-layer="monogram">\n([\s\S]*?)\n<\/g>/.exec(svg);
    expect(group).not.toBeNull();
    const ds = [...group![1].matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]);
    expect(ds).toEqual(genomeLayout(EXAMPLE, 'orbit', { centre: 'monogram' }).monogram);
    expect(group![1]).not.toContain('fill-rule');
    expect(svg.indexOf('data-layer="monogram"')).toBeLessThan(svg.indexOf('data-layer="genome"'));
    expect(svg.match(/data-layer="genome"/g)).toHaveLength(CODE01.genome.count);
    // Deterministic.
    expect(renderGenomeSvg(EXAMPLE, { layout: 'orbit', centre: 'monogram', ink: '#f6f2ea', paper: null })).toBe(svg);
  });

  it('rasterises the glyphs where they were, the monogram\'s O at the centre, and paper where the SEAL\'s ring was', () => {
    const glyphs = new Array<number>(8).fill(FULL_ORBIT);
    glyphs[0] = POINT;
    const genome = genomeWith(glyphs);
    const { viewBox } = genomeLayout(genome, 'orbit');
    const svg = renderGenomeSvg(genome, { layout: 'orbit', centre: 'monogram' });
    const north = CODE01_GENOME_CENTERS[0];
    expect(lumaAt(svg, viewBox, 840, north.x, north.y)).toBeLessThan(40);
    // The O's outline at its left edge is ink (0.4 u inside its outer edge, x = -4, on the horizontal axis; it is about 0.8 u thick).
    expect(lumaAt(svg, viewBox, 840, -3.6, 0)).toBeLessThan(40);
    // Beyond the monogram, inside the quiet ring: paper (the seal's ring sat at r 3–4 on the vertical axis).
    expect(lumaAt(svg, viewBox, 840, 0, -3.5)).toBeGreaterThan(215);
    expect(lumaAt(renderGenomeSvg(genome, { layout: 'orbit' }), viewBox, 840, 0, -3.5)).toBeLessThan(40);
  });

  it('rejects an unknown centre', () => {
    expect(() => genomeLayout(EXAMPLE, 'orbit', { centre: 'disc' as 'seal' })).toThrow(RangeError);
    expect(() => renderGenomeSvg(EXAMPLE, { layout: 'orbit', centre: 'disc' as 'seal' })).toThrow(RangeError);
  });
});

