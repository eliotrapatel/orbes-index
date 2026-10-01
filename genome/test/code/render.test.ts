import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ORBES_CODE_STYLES, encodeOrbesCode, renderOrbesCodeSvg, type OrbesCodeModel } from '../../src/core/code/encoder.js';
import { CODE01, CODE01_SIZE, CODE01_TOTAL_CELLS, cellCenter } from '../../src/core/code/profile.js';
import { svgToGray, type GrayImage } from '../support/raster.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const DATA = Uint8Array.from({ length: CODE01.ecc.dataBytes }, (_, i) => (i * 73 + 41) & 0xff);
const GLYPHS = [0, 5, 10, 15, 3, 12, 6, 9];
const MODEL = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS });
const RASTER_PX = 1000; // 20 px per cell pitch

/** Luma at the centre of every cell of a rendering `RASTER_PX` wide. */
function cellLumas(image: GrayImage): number[] {
  const scale = image.width / CODE01_SIZE;
  return Array.from({ length: CODE01_TOTAL_CELLS }, (_, flat) => {
    const { x, y } = cellCenter(flat);
    const col = Math.floor((x + CODE01_SIZE / 2) * scale);
    const row = Math.floor((y + CODE01_SIZE / 2) * scale);
    return image.data[row * image.width + col];
  });
}

function expectCellsReadBack(model: OrbesCodeModel, image: GrayImage, inkIsDark: boolean): void {
  const lumas = cellLumas(image);
  lumas.forEach((luma, flat) => {
    const dark = luma < 64;
    const light = luma > 192;
    expect(dark || light).toBe(true);
    expect(dark === inkIsDark ? 1 : 0).toBe(model.cells[flat]);
  });
}

describe('renderOrbesCodeSvg', () => {
  it('is byte-for-byte stable for a fixed input (visual regression snapshot)', () => {
    const svg = renderOrbesCodeSvg(MODEL);
    expect(renderOrbesCodeSvg(encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS }))).toBe(svg);
    expect(MODEL.mask).toBe(0);
    expect(sha256(svg)).toBe('957da690151f45d046f875ff1bc587d4be44fea778dfc63b1371f205d218d146');
    expect(sha256(renderOrbesCodeSvg(MODEL, ORBES_CODE_STYLES.inverted))).toBe('fdf794c09b195fd42f9ca3439bb4fbd964d267622ec2ee47638a4b7b3ac0f8a4');
  });

  it('frames the code in a 50 u viewBox centred on the seal, black ink on white by default', () => {
    const svg = renderOrbesCodeSvg(MODEL);
    expect(svg).toContain('viewBox="-25 -25 50 50"');
    expect(svg).toContain('<title>ORBES CODE-01</title>');
    expect(svg).toContain('<rect x="-25" y="-25" width="50" height="50" fill="#FFFFFF"/>');
    expect(svg).toContain('<g fill="#0A0A0A">');
    for (const layer of ['decor', 'seal', 'moon', 'polaris', 'format', 'data', 'genome']) {
      expect(svg.split(`<g data-layer="${layer}">`)).toHaveLength(2); // exactly one group per layer
    }
    expect(svg).not.toContain('stroke');
  });

  it('supports a transparent background, a physical size, a custom title and dropping decor', () => {
    const svg = renderOrbesCodeSvg(MODEL, { paper: null, widthMm: 18, title: 'O26-J-00184', decor: false });
    expect(svg).not.toContain('<rect');
    expect(svg).toContain('width="18mm" height="18mm"');
    expect(svg).toContain('<title>O26-J-00184</title>');
    expect(svg).not.toContain('data-layer="decor"');
    expect(svg).toContain('data-layer="data"');
  });

  it('renders the inverted style as white ink on black paper, with hairlines mixed towards the paper', () => {
    const svg = renderOrbesCodeSvg(MODEL, ORBES_CODE_STYLES.inverted);
    expect(svg).toContain('<g fill="#FFFFFF">');
    expect(svg).toContain('fill="#0A0A0A"/>');
    // Horizon tone 0.35 and guide tone 0.25 of white over #0A0A0A.
    expect(svg).toContain('<path fill="#606060" fill-rule="evenodd"');
    expect(svg).toContain('<path fill="#474747" fill-rule="evenodd"');
  });

  it('rasterises so that every cell centre reads back its encoded value (classic, ivory, inverted)', () => {
    expectCellsReadBack(MODEL, svgToGray(renderOrbesCodeSvg(MODEL), { widthPx: RASTER_PX }), true);
    expectCellsReadBack(MODEL, svgToGray(renderOrbesCodeSvg(MODEL, ORBES_CODE_STYLES.ivory), { widthPx: RASTER_PX }), true);
    expectCellsReadBack(MODEL, svgToGray(renderOrbesCodeSvg(MODEL, ORBES_CODE_STYLES.inverted), { widthPx: RASTER_PX }), false);
  });

  it('keeps the quiet zones clean: seal gap, quiet ring and the band around the data orbits', () => {
    const plain = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS }, { decor: false });
    const image = svgToGray(renderOrbesCodeSvg(plain), { widthPx: RASTER_PX });
    const scale = RASTER_PX / CODE01_SIZE;
    const lumaAt = (r: number, angle: number): number => {
      const col = Math.floor((r * Math.sin(angle) + CODE01_SIZE / 2) * scale);
      const row = Math.floor((-r * Math.cos(angle) + CODE01_SIZE / 2) * scale);
      return image.data[row * image.width + col];
    };
    for (let k = 0; k < 360; k++) {
      const angle = (k * Math.PI) / 180;
      expect(lumaAt(1.0, angle)).toBeLessThan(20); // seal core
      expect(lumaAt(2.5, angle)).toBeGreaterThan(235); // seal gap
      expect(lumaAt(3.5, angle)).toBeLessThan(20); // seal orbit
      expect(lumaAt(4.85, angle)).toBeGreaterThan(235); // quiet ring
      expect(lumaAt(23.6, angle)).toBeGreaterThan(235); // quiet band, outside the data orbits
    }
  });
});
