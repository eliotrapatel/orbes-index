/**
 * Image file I/O and JPEG round trips for tests (Node-only).
 *
 *   writePng / writeJpeg   GrayImage → file (parent directories are created)
 *   readImage              PNG or JPEG file → GrayImage (sniffed by magic bytes)
 *   encodeJpeg             exact JPEG round trip through jpeg-js
 *   encodeJpegFast         the same lossy stage for luma only, ~8× faster
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createGray, grayToRgba, rgbaToGray, type GrayImage } from './raster.js';

export function writePng(path: string, img: GrayImage): void {
  assertImage(img);
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  // Grayscale in, grayscale out: pngjs stores the bytes as-is (8-bit, colour type 0).
  const bytes = PNG.sync.write(png, { colorType: 0, inputColorType: 0, inputHasAlpha: false });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

export function writeJpeg(path: string, img: GrayImage, quality = 90): void {
  const bytes = jpegBytes(img, quality);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/** Decode a PNG or JPEG file to luma; translucent PNG pixels are composited over white. */
export function readImage(path: string): GrayImage {
  const bytes = readFileSync(path);
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    const png = PNG.sync.read(bytes); // normalised to 8-bit RGBA
    return rgbaToGray(png.data, png.width, png.height, 255);
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return rgbaToGray(decoded.data, decoded.width, decoded.height, 255);
  }
  throw new Error(`${path}: not a PNG or JPEG file`);
}

/**
 * Exact JPEG round trip (baseline, 4:4:4) through jpeg-js at `quality`
 * 1..100. Reference implementation for compression artifacts; slow
 * (≈ 300 ms for 1280×720) because jpeg-js always codes three components.
 */
export function encodeJpeg(img: GrayImage, quality: number): GrayImage {
  const decoded = jpeg.decode(jpegBytes(img, quality), { useTArray: true, formatAsRGBA: true });
  return rgbaToGray(decoded.data, decoded.width, decoded.height, 255);
}

function jpegBytes(img: GrayImage, quality: number): Uint8Array {
  assertImage(img);
  assertQuality(quality);
  return jpeg.encode({ width: img.width, height: img.height, data: grayToRgba(img) }, quality).data;
}

// ── Fast luma-only JPEG ────────────────────────────────────────────────────
//
// For a gray image the chroma planes are constant (Cb = Cr = 128) and the
// entropy coding stage is lossless, so the pixels a JPEG decoder returns are
// fully determined by: 8×8 block DCT of the level-shifted luma → division by
// the quality-scaled luminance table and rounding → inverse DCT. Doing just
// that, with the same IJG quality scaling and edge replication as jpeg-js,
// reproduces its artifacts (blocking, ringing, flattened texture) to within
// DCT rounding noise, at a fraction of the cost.

/** ITU-T T.81 Annex K.1 luminance quantisation table, natural (row-major) order. */
const ANNEX_K_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
] as const;

/** IJG quality scaling (libjpeg `jpeg_quality_scaling`, as used by jpeg-js). */
export function jpegLumaTable(quality: number): Uint8Array {
  assertQuality(quality);
  const scale = quality < 50 ? Math.floor(5000 / quality) : Math.floor(200 - 2 * quality);
  return Uint8Array.from(ANNEX_K_LUMA, (base) => Math.min(255, Math.max(1, Math.floor((base * scale + 50) / 100))));
}

/** AAN scale factors: aan[0] = 1, aan[k] = √2·cos(kπ/16) (libjpeg `aanscalefactor`). */
const AAN = Array.from({ length: 8 }, (_, k) => (k === 0 ? 1 : Math.SQRT2 * Math.cos((k * Math.PI) / 16)));

/**
 * Per-coefficient factors folding the AAN output scaling into quantisation,
 * exactly as libjpeg's float DCT path does: quantised = round(F·toQuant[i]),
 * dequantised (still AAN-scaled, ×8) = q·fromQuant[i].
 */
function quantFactors(quality: number): { toQuant: Float64Array; fromQuant: Float64Array } {
  const table = jpegLumaTable(quality);
  const toQuant = new Float64Array(64);
  const fromQuant = new Float64Array(64);
  for (let i = 0; i < 64; i++) {
    const scaled = table[i] * AAN[i >> 3] * AAN[i & 7];
    toQuant[i] = 1 / (scaled * 8);
    fromQuant[i] = scaled;
  }
  return { toQuant, fromQuant };
}

export function encodeJpegFast(img: GrayImage, quality: number): GrayImage {
  assertImage(img);
  const { toQuant, fromQuant } = quantFactors(quality);
  const { width, height, data } = img;
  const out = createGray(width, height);
  const block = new Float64Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      if (bx + 8 <= width && by + 8 <= height) {
        for (let y = 0, row = by * width + bx; y < 8; y++, row += width) {
          for (let x = 0; x < 8; x++) block[y * 8 + x] = data[row + x] - 128;
        }
      } else {
        // Partial edge block: replicate the last row/column, as the encoder does.
        for (let y = 0; y < 8; y++) {
          const row = Math.min(by + y, height - 1) * width;
          for (let x = 0; x < 8; x++) block[y * 8 + x] = data[row + Math.min(bx + x, width - 1)] - 128;
        }
      }
      forwardDct(block);
      let acNonZero = false;
      for (let i = 0; i < 64; i++) {
        const v = block[i] * toQuant[i];
        // Round half away from zero, like the reference quantiser.
        const q = v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5);
        block[i] = q * fromQuant[i];
        if (q !== 0 && i !== 0) acNonZero = true;
      }
      // A DC-only block reconstructs to a constant (the IDCT passes DC through unchanged).
      if (acNonZero) inverseDct(block);
      else block.fill(block[0]);
      for (let y = 0; y < 8 && by + y < height; y++) {
        const row = (by + y) * width;
        for (let x = 0; x < 8 && bx + x < width; x++) {
          const v = Math.round(block[y * 8 + x] / 8 + 128);
          out.data[row + bx + x] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  }
  return out;
}

/** In-place 8×8 AAN forward DCT (libjpeg jfdctflt.c): rows, then columns; output scaled by 8·aan[u]·aan[v]. */
function forwardDct(d: Float64Array): void {
  for (let o = 0; o < 64; o += 8) fdct8(d, o, 1);
  for (let o = 0; o < 8; o++) fdct8(d, o, 8);
}

/** One 8-point AAN forward DCT over d[o], d[o + s], …, d[o + 7s]. */
function fdct8(d: Float64Array, o: number, s: number): void {
  const d0 = d[o], d1 = d[o + s], d2 = d[o + 2 * s], d3 = d[o + 3 * s];
  const d4 = d[o + 4 * s], d5 = d[o + 5 * s], d6 = d[o + 6 * s], d7 = d[o + 7 * s];
  const tmp0 = d0 + d7, tmp7 = d0 - d7, tmp1 = d1 + d6, tmp6 = d1 - d6;
  const tmp2 = d2 + d5, tmp5 = d2 - d5, tmp3 = d3 + d4, tmp4 = d3 - d4;
  // Even part.
  const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
  d[o] = tmp10 + tmp11;
  d[o + 4 * s] = tmp10 - tmp11;
  const z1 = (tmp12 + tmp13) * 0.707106781;
  d[o + 2 * s] = tmp13 + z1;
  d[o + 6 * s] = tmp13 - z1;
  // Odd part.
  const o10 = tmp4 + tmp5, o11 = tmp5 + tmp6, o12 = tmp6 + tmp7;
  const z5 = (o10 - o12) * 0.382683433;
  const z2 = 0.5411961 * o10 + z5;
  const z4 = 1.306562965 * o12 + z5;
  const z3 = o11 * 0.707106781;
  const z11 = tmp7 + z3, z13 = tmp7 - z3;
  d[o + 5 * s] = z13 + z2;
  d[o + 3 * s] = z13 - z2;
  d[o + s] = z11 + z4;
  d[o + 7 * s] = z11 - z4;
}

/** In-place 8×8 AAN inverse DCT (libjpeg jidctflt.c): columns, then rows; input pre-scaled by aan[u]·aan[v], output ×8. */
function inverseDct(d: Float64Array): void {
  for (let o = 0; o < 8; o++) idct8(d, o, 8);
  for (let o = 0; o < 64; o += 8) idct8(d, o, 1);
}

/** One 8-point AAN inverse DCT over d[o], d[o + s], …, d[o + 7s]. */
function idct8(d: Float64Array, o: number, s: number): void {
  // Even part.
  const e0 = d[o], e1 = d[o + 2 * s], e2 = d[o + 4 * s], e3 = d[o + 6 * s];
  const tmp10 = e0 + e2, tmp11 = e0 - e2, tmp13 = e1 + e3;
  const tmp12 = (e1 - e3) * 1.414213562 - tmp13;
  const tmp0 = tmp10 + tmp13, tmp3 = tmp10 - tmp13, tmp1 = tmp11 + tmp12, tmp2 = tmp11 - tmp12;
  // Odd part.
  const i4 = d[o + s], i5 = d[o + 3 * s], i6 = d[o + 5 * s], i7 = d[o + 7 * s];
  const z13 = i6 + i5, z10 = i6 - i5, z11 = i4 + i7, z12 = i4 - i7;
  const tmp7 = z11 + z13;
  const r11 = (z11 - z13) * 1.414213562;
  const z5 = (z10 + z12) * 1.847759065;
  const r10 = 1.0823922 * z12 - z5;
  const r12 = -2.61312593 * z10 + z5;
  const tmp6 = r12 - tmp7;
  const tmp5 = r11 - tmp6;
  const tmp4 = r10 + tmp5;
  d[o] = tmp0 + tmp7;
  d[o + 7 * s] = tmp0 - tmp7;
  d[o + s] = tmp1 + tmp6;
  d[o + 6 * s] = tmp1 - tmp6;
  d[o + 2 * s] = tmp2 + tmp5;
  d[o + 5 * s] = tmp2 - tmp5;
  d[o + 4 * s] = tmp3 + tmp4;
  d[o + 3 * s] = tmp3 - tmp4;
}

function assertImage(img: GrayImage): void {
  if (img.data.length !== img.width * img.height) {
    throw new RangeError(`GrayImage data has ${img.data.length} bytes, expected ${img.width * img.height}`);
  }
}

function assertQuality(quality: number): void {
  if (!(quality >= 1 && quality <= 100)) throw new RangeError(`JPEG quality must be 1..100, got ${quality}`);
}
