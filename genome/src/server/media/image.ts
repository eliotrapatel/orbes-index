/**
 * Uploaded photographs (F-04): the type checked by the file's own bytes, the
 * metadata removed by hand, the dimensions read. No image library and no
 * decoding: the structure of the file is walked, and only what a browser
 * needs to draw the picture is copied out.
 *
 *   sanitizeImage(bytes, declared)  → { mime, bytes, width, height }
 *
 * Accepted: a still JPEG (baseline, extended or progressive) or a still
 * WebP (lossy, lossless, with or without alpha), whose magic bytes match the
 * declared type (`Content-Type: image/jpeg` or `image/webp`), at most
 * MAX_IMAGE_BYTES and MAX_IMAGE_SIDE pixels on each side. Everything else is
 * refused: another type (an SVG, a PNG, a GIF sent under either name), a
 * damaged or truncated file, an animated WebP.
 *
 * What is removed, so that nothing of the camera, the place or the software
 * that made the file reaches the public URL:
 *  - JPEG: every APP1 segment (EXIF, with its GPS position and thumbnail;
 *    XMP, extended XMP), every other application segment except the JFIF
 *    header (its embedded thumbnail dropped), the ICC colour profile (APP2
 *    ICC_PROFILE) and the Adobe colour-transform marker (APP14), every
 *    comment (COM), and anything after the end-of-image marker (the second
 *    pictures of a multi-picture file, appended data);
 *  - WebP: the EXIF and XMP chunks (and their flags in the VP8X header),
 *    every chunk that is not part of the picture (only VP8X, ICCP, ALPH and
 *    one VP8 or VP8L are kept), and anything after the RIFF container.
 *
 * The console re-encodes every photograph through a canvas before sending it
 * (2 000 px at most), which carries none of this; the server strips it all
 * the same, for any other client of the API.
 */
import { MEDIA_MIME_TYPES, type MediaMimeType } from '../db/schema.js';
import { DomainError } from '../errors.js';

/** The types accepted, which media_objects.mime allows (migration 0012). */
export const IMAGE_MIME_TYPES = MEDIA_MIME_TYPES;
export type ImageMime = MediaMimeType;

/** 1 MiB: the request body limit of the image routes and the largest image stored (media_objects CHECK). */
export const MAX_IMAGE_BYTES = 1024 * 1024;
/** Pixels on each side, at most: a phone decodes every result's photographs (media_objects CHECK). */
export const MAX_IMAGE_SIDE = 4096;

export interface CleanImage {
  mime: ImageMime;
  /** The image without its metadata. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export const imageInvalid = (message: string, detail?: string) => new DomainError('IMAGE_INVALID', 400, message, detail ? { detail } : undefined);

export const imageAnimated = () => new DomainError('IMAGE_ANIMATED', 400, 'Animated images are not accepted: send a still photograph (JPEG or WebP).');

const NOT_AN_IMAGE = 'The file is not a JPEG or WebP image.';
const MISMATCH = 'The file does not match its declared type: send a JPEG as image/jpeg and a WebP as image/webp.';
const DAMAGED_JPEG = 'The JPEG image is damaged or incomplete.';
const DAMAGED_WEBP = 'The WebP image is damaged or incomplete.';

/** The type the bytes themselves say (JPEG: FF D8 FF; WebP: RIFF….WEBP), or null. */
export function sniffImageType(b: Uint8Array): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Check, strip and measure an uploaded image sent as `declared`. Throws IMAGE_INVALID or IMAGE_ANIMATED (400). */
export function sanitizeImage(input: Uint8Array, declared: ImageMime): CleanImage {
  if (!(input instanceof Uint8Array) || input.length === 0) throw imageInvalid('Send the image file itself.');
  if (input.length > MAX_IMAGE_BYTES) throw new DomainError('PAYLOAD_TOO_LARGE', 413, 'The image is larger than 1 MB.');
  const sniffed = sniffImageType(input);
  if (sniffed === null) throw imageInvalid(NOT_AN_IMAGE, 'magic');
  if (sniffed !== declared) throw imageInvalid(MISMATCH, `declared ${declared}, bytes ${sniffed}`);
  const out = sniffed === 'image/jpeg' ? stripJpeg(input) : stripWebp(input);
  if (out.width < 1 || out.height < 1 || out.width > MAX_IMAGE_SIDE || out.height > MAX_IMAGE_SIDE) {
    throw imageInvalid(`The image must be at most ${MAX_IMAGE_SIDE} pixels on each side.`, `${out.width}x${out.height}`);
  }
  return { mime: sniffed, ...out };
}

// ── JPEG ───────────────────────────────────────────────────────────────────

/** Start-of-frame markers (C0–CF except DHT C4, JPG C8, DAC CC): the frame header holds the dimensions. */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
/** Table and restart-interval segments a decoder needs: DHT, DAC, DQT, DNL, DRI. */
const TABLE_MARKERS = new Set([0xc4, 0xcc, 0xdb, 0xdc, 0xdd]);
const SOS = 0xda;
const EOI = 0xd9;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

/**
 * Walk the JPEG marker by marker and copy out what the picture needs: SOI, the JFIF header (without its
 * thumbnail), the ICC profile, the Adobe marker, the tables, the frame header, the scans with their
 * entropy-coded data, EOI. Everything else is dropped; an unknown marker refuses the file.
 */
export function stripJpeg(b: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw imageInvalid(NOT_AN_IMAGE, 'jpeg soi');
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let frame: { width: number; height: number } | null = null;
  let scans = 0;
  let i = 2;
  for (;;) {
    if (i >= b.length || b[i] !== 0xff) throw imageInvalid(DAMAGED_JPEG, `jpeg marker expected at ${i}`);
    // Fill bytes (FF FF …) may precede a marker.
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) throw imageInvalid(DAMAGED_JPEG, 'jpeg truncated marker');
    const marker = b[i++];
    if (marker === EOI) {
      if (!frame || scans === 0) throw imageInvalid(DAMAGED_JPEG, 'jpeg without frame or scan');
      parts.push(Uint8Array.of(0xff, EOI));
      break; // anything after the end of the image is dropped
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      // A restart marker outside a scan carries nothing: dropped.
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8) throw imageInvalid(DAMAGED_JPEG, `jpeg stray marker ${marker.toString(16)}`);
    if (i + 2 > b.length) throw imageInvalid(DAMAGED_JPEG, 'jpeg truncated length');
    const length = (b[i] << 8) | b[i + 1];
    if (length < 2 || i + length > b.length) throw imageInvalid(DAMAGED_JPEG, 'jpeg segment overruns the file');
    const payload = b.subarray(i + 2, i + length);
    const segment = (data: Uint8Array) => {
      const head = Uint8Array.of(0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff);
      parts.push(head, data);
    };
    i += length;

    if (marker === APP0) {
      // JFIF: identifier, version, units, densities, then a thumbnail of Xthumb × Ythumb pixels: kept without it.
      if (payload.length >= 14 && ascii(payload, 0, 5) === 'JFIF\u0000') segment(Uint8Array.of(...payload.subarray(0, 12), 0, 0));
      continue; // JFXX (an extension thumbnail) and anything else: dropped
    }
    if (marker === APP2) {
      if (payload.length >= 14 && ascii(payload, 0, 12) === 'ICC_PROFILE\u0000') segment(payload);
      continue; // MPF (multi-picture index), FlashPix: dropped
    }
    if (marker === APP14) {
      if (payload.length >= 5 && ascii(payload, 0, 5) === 'Adobe') segment(payload);
      continue;
    }
    if ((marker >= 0xe0 && marker <= 0xef) || marker === COM) continue; // APP1 (EXIF, XMP) and the rest; comments
    if (isSof(marker)) {
      if (frame) throw imageInvalid(DAMAGED_JPEG, 'jpeg with two frames');
      if (payload.length < 6) throw imageInvalid(DAMAGED_JPEG, 'jpeg short frame header');
      const height = (payload[1] << 8) | payload[2];
      const width = (payload[3] << 8) | payload[4];
      const components = payload[5];
      if (components < 1 || components > 4 || payload.length < 6 + 3 * components) throw imageInvalid(DAMAGED_JPEG, 'jpeg frame components');
      if (width === 0 || height === 0) throw imageInvalid(DAMAGED_JPEG, 'jpeg frame without dimensions');
      frame = { width, height };
      segment(payload);
      continue;
    }
    if (TABLE_MARKERS.has(marker)) {
      segment(payload);
      continue;
    }
    if (marker === SOS) {
      if (!frame) throw imageInvalid(DAMAGED_JPEG, 'jpeg scan before frame');
      segment(payload);
      // Entropy-coded data runs to the next marker that is neither a stuffed FF 00 nor a restart marker.
      const start = i;
      while (i < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const next = b[i + 1];
        if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
          i += 2;
          continue;
        }
        break;
      }
      if (i >= b.length) throw imageInvalid(DAMAGED_JPEG, 'jpeg scan without end');
      parts.push(b.subarray(start, i));
      scans++;
      continue;
    }
    // Hierarchical (DHP, EXP), JPEG-LS and the reserved markers: no browser draws them.
    throw imageInvalid('This kind of JPEG is not supported: save the photograph as a standard JPEG.', `jpeg marker ${marker.toString(16)}`);
  }
  return { bytes: concat(parts), width: frame.width, height: frame.height };
}

// ── WebP ───────────────────────────────────────────────────────────────────

const VP8X_ICC = 0x20;
const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;
const VP8X_ANIMATION = 0x02;

interface Chunk {
  fourcc: string;
  data: Uint8Array;
}

/**
 * Read the RIFF container chunk by chunk; keep VP8X (its EXIF, XMP and, without a kept ICCP, ICC flags
 * cleared), ICCP, ALPH and the one VP8 or VP8L bitstream; drop the rest. An ANIM or ANMF chunk, or the
 * animation flag, refuses the file.
 */
export function stripWebp(b: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') throw imageInvalid(NOT_AN_IMAGE, 'webp riff');
  const riffSize = u32le(b, 4);
  if (riffSize < 12 || riffSize + 8 > b.length) throw imageInvalid(DAMAGED_WEBP, 'webp riff size');
  const end = 8 + riffSize; // anything after the container is dropped
  const chunks: Chunk[] = [];
  let i = 12;
  while (i < end) {
    if (i + 8 > end) throw imageInvalid(DAMAGED_WEBP, 'webp truncated chunk header');
    const fourcc = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const dataStart = i + 8;
    if (size > end - dataStart) throw imageInvalid(DAMAGED_WEBP, `webp chunk ${fourcc} overruns the file`);
    chunks.push({ fourcc, data: b.subarray(dataStart, dataStart + size) });
    i = dataStart + size + (size & 1);
  }
  if (chunks.length === 0) throw imageInvalid(DAMAGED_WEBP, 'webp without chunks');
  if (chunks.some((c) => c.fourcc === 'ANIM' || c.fourcc === 'ANMF')) throw imageAnimated();

  const bitstreams = chunks.filter((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
  if (bitstreams.length !== 1) throw imageInvalid(DAMAGED_WEBP, `webp with ${bitstreams.length} bitstreams`);
  const image = bitstreams[0];
  const size = image.fourcc === 'VP8L' ? vp8lSize(image.data) : vp8Size(image.data);

  const first = chunks[0];
  let kept: Chunk[];
  let width = size.width;
  let height = size.height;
  if (first.fourcc === 'VP8X') {
    const x = first.data;
    if (x.length < 10) throw imageInvalid(DAMAGED_WEBP, 'webp short VP8X');
    if (x[0] & VP8X_ANIMATION) throw imageAnimated();
    width = 1 + u24le(x, 4);
    height = 1 + u24le(x, 7);
    // A still image's bitstream draws the whole canvas.
    if (width !== size.width || height !== size.height) throw imageInvalid(DAMAGED_WEBP, 'webp canvas and bitstream sizes differ');
    const icc = chunks.find((c) => c.fourcc === 'ICCP');
    // A lossy bitstream carries its transparency in an ALPH chunk; a lossless one inside itself.
    const alpha = image.fourcc === 'VP8 ' && x[0] & VP8X_ALPHA ? chunks.find((c) => c.fourcc === 'ALPH') : undefined;
    let flags = x[0] & ~(VP8X_EXIF | VP8X_XMP | VP8X_ICC);
    if (icc) flags |= VP8X_ICC;
    kept = [{ fourcc: 'VP8X', data: Uint8Array.of(flags, 0, 0, 0, ...x.subarray(4, 10)) }];
    if (icc) kept.push(icc);
    if (alpha) kept.push(alpha);
    kept.push(image);
  } else if (first === image) {
    kept = [image]; // the simple format: one bitstream, nothing else allowed
  } else {
    throw imageInvalid(DAMAGED_WEBP, `webp starts with ${first.fourcc}`);
  }

  const body = kept.flatMap((c) => {
    const head = new Uint8Array(8);
    for (let k = 0; k < 4; k++) head[k] = c.fourcc.charCodeAt(k);
    writeU32le(head, 4, c.data.length);
    return c.data.length & 1 ? [head, c.data, Uint8Array.of(0)] : [head, c.data];
  });
  const total = 4 + body.reduce((n, p) => n + p.length, 0);
  const riff = new Uint8Array(12);
  riff.set([0x52, 0x49, 0x46, 0x46]);
  writeU32le(riff, 4, total);
  riff.set([0x57, 0x45, 0x42, 0x50], 8);
  return { bytes: concat([riff, ...body]), width, height };
}

/** VP8 (lossy) key frame: frame tag (3 bytes, bit 0 clear), start code 9D 01 2A, then 14-bit width and height. */
function vp8Size(d: Uint8Array): { width: number; height: number } {
  if (d.length < 10 || (d[0] & 1) !== 0 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw imageInvalid(DAMAGED_WEBP, 'webp VP8 header');
  return { width: (d[6] | (d[7] << 8)) & 0x3fff, height: (d[8] | (d[9] << 8)) & 0x3fff };
}

/** VP8L (lossless): signature 2F, then 14 bits of width − 1 and 14 bits of height − 1. */
function vp8lSize(d: Uint8Array): { width: number; height: number } {
  if (d.length < 5 || d[0] !== 0x2f) throw imageInvalid(DAMAGED_WEBP, 'webp VP8L header');
  const bits = u32le(d, 1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

// ── Bytes ──────────────────────────────────────────────────────────────────

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let k = 0; k < n && at + k < b.length; k++) s += String.fromCharCode(b[at + k]);
  return s;
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function u24le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}

function writeU32le(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >>> 8) & 0xff;
  b[at + 2] = (v >>> 16) & 0xff;
  b[at + 3] = (v >>> 24) & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
