import { describe, expect, it } from 'vitest';
import { createGray, grayToRgba, luma601, meanAbsDiff, rgbaToGray, svgToGray } from './raster.js';

describe('luma601', () => {
  it('maps neutral grays to themselves and weights primaries per BT.601', () => {
    for (let v = 0; v < 256; v++) expect(luma601(v, v, v)).toBe(v);
    for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [200, 120, 40]]) {
      expect(Math.abs(luma601(r, g, b) - (0.299 * r + 0.587 * g + 0.114 * b))).toBeLessThanOrEqual(1);
    }
  });
});

describe('rgbaToGray / grayToRgba', () => {
  it('round-trips gray images', () => {
    const img = createGray(7, 3);
    img.data.forEach((_, i) => (img.data[i] = (i * 37) & 255));
    expect(rgbaToGray(grayToRgba(img), 7, 3)).toEqual(img);
  });

  it('composites translucent pixels over the background', () => {
    const rgba = Uint8Array.from([0, 0, 0, 128, 0, 0, 0, 0, 200, 200, 200, 255]);
    expect([...rgbaToGray(rgba, 3, 1).data]).toEqual([127, 255, 200]);
    expect([...rgbaToGray(rgba, 3, 1, 0).data]).toEqual([0, 0, 200]);
  });

  it('rejects buffers that do not match the size', () => {
    expect(() => rgbaToGray(new Uint8Array(12), 2, 2)).toThrow(RangeError);
  });
});

describe('svgToGray', () => {
  it('rasterises at the requested width, keeping the aspect ratio', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="#fff"/><rect width="10" height="10" fill="#000"/></svg>';
    const img = svgToGray(svg, { widthPx: 200 });
    expect([img.width, img.height]).toEqual([200, 100]);
    expect(img.data[50 * 200 + 50]).toBe(0);
    expect(img.data[50 * 200 + 150]).toBe(255);
  });

  it('composites transparent areas on the given background', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect x="2" width="2" height="4" fill="#808080"/></svg>';
    const white = svgToGray(svg, { widthPx: 40 });
    const dark = svgToGray(svg, { widthPx: 40, background: 30 });
    expect(white.data[20 * 40 + 5]).toBe(255);
    expect(dark.data[20 * 40 + 5]).toBe(30);
    expect(dark.data[20 * 40 + 35]).toBe(128);
  });

  it('validates options', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    expect(() => svgToGray(svg, { widthPx: 0 })).toThrow(RangeError);
    expect(() => svgToGray(svg, { widthPx: 10, background: 300 })).toThrow(RangeError);
  });
});

describe('meanAbsDiff', () => {
  it('averages absolute differences and requires equal sizes', () => {
    const a = createGray(2, 2, 10);
    const b = createGray(2, 2, 10);
    b.data[0] = 30;
    expect(meanAbsDiff(a, b)).toBe(5);
    expect(() => meanAbsDiff(a, createGray(1, 4))).toThrow(RangeError);
  });
});
