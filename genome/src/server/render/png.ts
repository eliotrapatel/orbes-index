/**
 * PNG back end: rasterise the artifact SVG with resvg (off the event loop)
 * at an exact pixel width derived from the physical width and dpi, then
 * record that dpi in a pHYs chunk so layout and print software place the
 * image at its true physical size.
 *
 * The SVG is the single source: the PNG shows exactly what the SVG and PDF
 * show (same primitives, same label lettering, no fonts involved).
 */
import { crc32 } from 'node:zlib';
import { renderAsync } from '@resvg/resvg-js';
import { MM_PER_INCH } from './scene.js';

export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const INCH_PER_METER = 1 / 0.0254;

/** Pixel width for a physical width at a given resolution (at least 1). */
export function pixelsFor(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));
}

export interface PngRenderOptions {
  /** Output width in pixels; height follows the SVG's aspect ratio. */
  widthPx: number;
  /** Resolution recorded in the pHYs chunk. */
  dpi: number;
}

/** Rasterise an SVG document to PNG. Text is never used by our SVGs, so no fonts are loaded. */
export async function svgToPng(svg: string, opts: PngRenderOptions): Promise<Uint8Array> {
  if (!Number.isInteger(opts.widthPx) || opts.widthPx < 1) throw new RangeError('widthPx must be a positive integer');
  const image = await renderAsync(svg, {
    fitTo: { mode: 'width', value: opts.widthPx },
    font: { loadSystemFonts: false },
    shapeRendering: 2, // geometricPrecision: anti-aliased, exact coverage at arc edges
    logLevel: 'off',
  });
  return setPngDpi(new Uint8Array(image.asPng()), opts.dpi);
}

interface Chunk {
  type: string;
  /** Offset of the chunk's length field. */
  offset: number;
  /** Total chunk size: length + type + data + CRC. */
  size: number;
}

function readChunks(png: Uint8Array): Chunk[] {
  if (png.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((b, i) => png[i] === b)) {
    throw new RangeError('not a PNG file');
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let o = PNG_SIGNATURE.length;
  while (o + 12 <= png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const size = 12 + len;
    if (o + size > png.length) throw new RangeError('truncated PNG chunk');
    chunks.push({ type, offset: o, size });
    o += size;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR') throw new RangeError('PNG does not start with IHDR');
  return chunks;
}

/**
 * Return a copy of `png` whose pHYs chunk declares `dpi` (pixels per metre,
 * unit = metre), replacing any existing pHYs. Placed right after IHDR, as the
 * PNG spec requires pHYs to precede IDAT.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!(Number.isFinite(dpi) && dpi > 0)) throw new RangeError('dpi must be positive');
  const chunks = readChunks(png);
  const ppm = Math.round(dpi * INCH_PER_METER);
  const phys = new Uint8Array(12 + 9);
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  phys[16] = 1; // unit: metre
  dv.setUint32(17, crc32(phys.subarray(4, 17)) >>> 0);

  const kept = chunks.filter((c) => c.type !== 'pHYs');
  const ihdr = kept[0];
  const total = PNG_SIGNATURE.length + phys.length + kept.reduce((s, c) => s + c.size, 0);
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  let o = PNG_SIGNATURE.length;
  out.set(png.subarray(ihdr.offset, ihdr.offset + ihdr.size), o);
  o += ihdr.size;
  out.set(phys, o);
  o += phys.length;
  for (const c of kept.slice(1)) {
    out.set(png.subarray(c.offset, c.offset + c.size), o);
    o += c.size;
  }
  return out;
}

/** Resolution declared by a PNG's pHYs chunk (metre unit), or undefined. */
export function readPngDpi(png: Uint8Array): number | undefined {
  const c = readChunks(png).find((ch) => ch.type === 'pHYs');
  if (!c) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (png[c.offset + 16] !== 1) return undefined;
  return view.getUint32(c.offset + 8) / INCH_PER_METER;
}
