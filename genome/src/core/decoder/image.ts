/**
 * Luma images for the decoder.
 *
 * Pixel convention (shared with the camera simulator): pixel (i, j) covers
 * [i, i+1) × [j, j+1), so its centre sits at (i + 0.5, j + 0.5). Every image
 * position the decoder reports or consumes is in these continuous coordinates.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

/** 8-bit luma image, row-major, one byte per pixel (CONTRACTS.md §8). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * RGBA → BT.601 luma (8.8 fixed point, neutral grays map to themselves).
 * Translucent pixels are composited over white, the way a transparent PNG
 * export of a code appears on paper. Camera frames are opaque and take the
 * fast path.
 */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`invalid image size ${width}×${height}`);
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError(`RGBA buffer has ${rgba.length} bytes, expected ${width * height * 4}`);
  }
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const y = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2] + 128) >> 8;
    const a = rgba[p + 3];
    data[i] = a === 255 ? y : Math.round((y * a + 255 * (255 - a)) / 255);
  }
  return { width, height, data };
}

/** True when `img` is a structurally valid, non-empty GrayImage. */
export function isUsableImage(img: unknown): img is GrayImage {
  if (img === null || typeof img !== 'object') return false;
  const { width, height, data } = img as Partial<GrayImage>;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    data instanceof Uint8Array &&
    data.length >= (width as number) * (height as number)
  );
}

/** Photographic negative (light ink on a dark substrate becomes dark on light). */
export function invertImage(img: GrayImage): GrayImage {
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = 255 - img.data[i];
  return { width: img.width, height: img.height, data };
}

/** Area-average downscale by an integer factor (partial edge blocks are dropped). */
export function downscaleImage(img: GrayImage, factor: number): GrayImage {
  const width = Math.max(1, Math.floor(img.width / factor));
  const height = Math.max(1, Math.floor(img.height / factor));
  const data = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * img.width + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += img.data[row + dx];
      }
      data[y * width + x] = Math.round(sum / area);
    }
  }
  return { width, height, data };
}

/**
 * Bilinear sample at continuous position (x, y) (pixel centres at +0.5),
 * clamped to the image border.
 */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const ax = fx - x0;
  const ay = fy - y0;
  const r0 = y0 * w;
  const r1 = y1 * w;
  const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * ax;
  const bottom = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * ax;
  return top + (bottom - top) * ay;
}
