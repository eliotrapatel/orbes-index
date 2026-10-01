/**
 * Raster helpers for tests: 8-bit grayscale images, SVG rasterisation and
 * RGBA ↔ luma conversion.
 *
 * Node-only test infrastructure (resvg is a native module).
 */
import { Resvg } from '@resvg/resvg-js';

/**
 * 8-bit luma image, row-major, one byte per pixel. Structurally identical to
 * the decoder contract (CONTRACTS.md §8), so the two are interchangeable.
 */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createGray(width: number, height: number, fill = 0): GrayImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`invalid image size ${width}×${height}`);
  }
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}

/**
 * BT.601 luma of 8-bit sRGB values, in 8.8 fixed point. The weights sum to
 * 256, so neutral grays map to themselves exactly.
 */
export function luma601(r: number, g: number, b: number): number {
  return (77 * r + 150 * g + 29 * b + 128) >> 8;
}

/**
 * RGBA (straight alpha) → luma, compositing translucent pixels over a flat
 * `background` luma (default white, like paper behind a transparent SVG).
 */
export function rgbaToGray(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  background = 255,
): GrayImage {
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`RGBA buffer has ${rgba.length} bytes, expected ${width * height * 4}`);
  }
  const out = createGray(width, height);
  const d = out.data;
  for (let i = 0, p = 0; i < d.length; i++, p += 4) {
    const y = luma601(rgba[p], rgba[p + 1], rgba[p + 2]);
    const a = rgba[p + 3];
    d[i] = a === 255 ? y : Math.round((y * a + background * (255 - a)) / 255);
  }
  return out;
}

/** Gray → opaque RGBA (R = G = B = luma). */
export function grayToRgba(img: GrayImage): Uint8Array {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    const v = img.data[i];
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}

export interface SvgRasterOptions {
  /** Output width in pixels; the height follows the SVG aspect ratio. */
  widthPx: number;
  /** Luma 0..255 composited behind transparent areas (default 255, white). */
  background?: number;
}

/**
 * Rasterise an SVG to luma with resvg. System fonts are not loaded: it keeps
 * rendering fast and identical across machines (ORBES artifacts are pure
 * geometry, so text is never machine-relevant).
 */
export function svgToGray(svg: string, opts: SvgRasterOptions): GrayImage {
  const { widthPx } = opts;
  const background = opts.background ?? 255;
  if (!Number.isInteger(widthPx) || widthPx <= 0) throw new RangeError(`invalid widthPx ${widthPx}`);
  if (!(background >= 0 && background <= 255)) throw new RangeError(`invalid background ${background}`);
  const level = Math.round(background);
  // resvg composites onto the background itself, so every pixel comes back
  // opaque and the premultiplied/straight alpha question never arises.
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx },
    background: `rgb(${level},${level},${level})`,
    font: { loadSystemFonts: false },
    logLevel: 'off',
  }).render();
  return rgbaToGray(rendered.pixels, rendered.width, rendered.height, level);
}

/** Mean absolute difference between two same-sized images (0..255). */
export function meanAbsDiff(a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(`size mismatch: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}
