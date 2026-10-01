import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { CODE01_GENOME_CENTERS } from '../../src/core/code/profile.js';
import {
  GENOME01_GLYPHS,
  computeGenome,
  genomeGlyphPrimitives,
  genomeLayout,
  renderGenomeSvg,
  type Genome,
} from '../../src/core/genome/index.js';

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
