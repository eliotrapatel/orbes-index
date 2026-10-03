/**
 * Photograph fixtures for the F-04 tests (Node-only): real JPEGs from
 * jpeg-js, the metadata a camera or an editor writes into them, and WebP
 * containers built chunk by chunk (still, extended, animated).
 *
 *   jpegPhoto(w, h)              a small gradient photograph, JFIF header only
 *   withJpegSegments(jpeg, …)    the same with EXIF / XMP / ICC / … segments after SOI
 *   webp(chunks)                 a RIFF/WEBP container of the given chunks
 *
 * The markers written into the metadata (GPS_SECRET, XMP_SECRET…) are what
 * the tests look for in the stored bytes: none may survive.
 */
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const GPS_SECRET = 'GPS 48.8566N 2.3522E iPhone 15 Pro serial C39XK2';
export const XMP_SECRET = 'xmp-secret-photographer@example.com';
export const COMMENT_SECRET = 'comment-secret-edited-in-darkroom';
export const TRAILER_SECRET = 'trailer-secret-appended-after-eoi';
export const THUMB_SECRET = 'thumb-secret-uncropped-original';

/** A width × height gradient photograph, encoded by jpeg-js (APP0 JFIF, DQT, SOF0, DHT, SOS). */
export function jpegPhoto(width = 48, height = 32, quality = 85): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.round((x / width) * 255);
      data[i + 1] = Math.round((y / height) * 255);
      data[i + 2] = 160;
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(jpeg.encode({ width, height, data }, quality).data);
}

/** Decoded RGBA of a JPEG, to compare the picture before and after stripping. */
export function jpegPixels(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width: d.width, height: d.height, data: d.data };
}

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** One JPEG segment: FF marker, big-endian length (payload + 2), payload. */
export function jpegSegment(marker: number, payload: Uint8Array | string): Uint8Array {
  const p = typeof payload === 'string' ? latin1(payload) : payload;
  return Uint8Array.of(0xff, marker, ((p.length + 2) >> 8) & 0xff, (p.length + 2) & 0xff, ...p);
}

/**
 * A TIFF structure (the payload of an EXIF block) whose IFD0 holds one entry, Orientation (0x0112, SHORT, 1) = `value`,
 * in big-endian (MM) or little-endian (II) byte order, followed by `tail` (e.g. a GPS marker).
 */
export function exifTiff(value: number, order: 'MM' | 'II' = 'MM', tail = ''): Uint8Array {
  const u16 = (v: number) => (order === 'II' ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) => (order === 'II' ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const value16 = order === 'II' ? [value & 0xff, (value >> 8) & 0xff, 0, 0] : [(value >> 8) & 0xff, value & 0xff, 0, 0];
  return Uint8Array.from([...latin1(order), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...value16, ...u32(0), ...latin1(tail)]);
}

/**
 * The text an ICC profile written by a device carries (its description, maker and model tags, `desc`, `dmnd`, `dmdd`),
 * in an APP2 ICC_PROFILE segment: kept, as the colours need the profile.
 */
export const ICC_DEVICE_TEXT = 'dmdd iPhone 15 Pro Max';

/** The segments a phone, an editor or a multi-picture file adds. */
export const SEGMENTS = {
  /** EXIF whose IFD0 says Orientation = `value` (6: the camera was turned a quarter clockwise), then the GPS marker. */
  exifOriented: (value: number, order: 'MM' | 'II' = 'MM') => jpegSegment(0xe1, Uint8Array.of(...latin1('Exif\u0000\u0000'), ...exifTiff(value, order, GPS_SECRET))),
  iccDevice: () => jpegSegment(0xe2, Uint8Array.of(...latin1('ICC_PROFILE\u0000'), 1, 1, ...latin1(`desc Display P3 dmnd APPL ${ICC_DEVICE_TEXT}`))),
  exif: () => jpegSegment(0xe1, `Exif\u0000\u0000MM\u0000*${GPS_SECRET}`),
  xmp: () => jpegSegment(0xe1, `http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta><dc:creator>${XMP_SECRET}</dc:creator></x:xmpmeta>`),
  comment: () => jpegSegment(0xfe, COMMENT_SECRET),
  /** A JFIF header with a 2 × 1 thumbnail (6 bytes of RGB) whose pixels spell part of THUMB_SECRET. */
  jfifWithThumbnail: () => jpegSegment(0xe0, Uint8Array.of(...latin1('JFIF\u0000'), 1, 2, 0, 0, 1, 0, 1, 2, 1, ...latin1(THUMB_SECRET.slice(0, 6)))),
  jfxx: () => jpegSegment(0xe0, `JFXX\u0000\u0013${THUMB_SECRET}`),
  iptc: () => jpegSegment(0xed, `Photoshop 3.0\u0000${GPS_SECRET}`),
  mpf: () => jpegSegment(0xe2, `MPF\u0000${GPS_SECRET}`),
  icc: () => jpegSegment(0xe2, Uint8Array.of(...latin1('ICC_PROFILE\u0000'), 1, 1, ...latin1('sRGB IEC61966-2.1'))),
  adobe: () => jpegSegment(0xee, Uint8Array.of(...latin1('Adobe'), 0, 100, 0, 0, 0, 0, 1)),
};

/** `jpeg` with `segments` inserted right after SOI (and its own APP0 first dropped when `replaceApp0`). */
export function withJpegSegments(jpegBytes: Uint8Array, segments: Uint8Array[], opts: { replaceApp0?: boolean; trailer?: string } = {}): Uint8Array {
  let rest = jpegBytes.subarray(2);
  if (opts.replaceApp0 && rest[0] === 0xff && rest[1] === 0xe0) rest = rest.subarray(2 + ((rest[2] << 8) | rest[3]));
  const trailer = opts.trailer ? latin1(opts.trailer) : new Uint8Array(0);
  return Uint8Array.from([0xff, 0xd8, ...segments.flatMap((s) => [...s]), ...rest, ...trailer]);
}

/** The markers of a JPEG up to its first scan, in order (e.g. ['e0', 'db', 'c0', 'c4', 'da']). */
export function jpegMarkers(b: Uint8Array): string[] {
  const out: string[] = [];
  let i = 2;
  while (i + 3 < b.length && b[i] === 0xff) {
    const m = b[i + 1];
    out.push(m.toString(16));
    if (m === 0xda) break;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return out;
}

/** Set the dimensions written in a JPEG's SOF0 header (the picture data is left as it is). */
export function withJpegFrameSize(b: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(b);
  let i = 2;
  while (i + 3 < out.length && out[i] === 0xff) {
    const m = out[i + 1];
    if (m === 0xc0) {
      out[i + 5] = (height >> 8) & 0xff;
      out[i + 6] = height & 0xff;
      out[i + 7] = (width >> 8) & 0xff;
      out[i + 8] = width & 0xff;
      return out;
    }
    i += 2 + ((out[i + 2] << 8) | out[i + 3]);
  }
  throw new Error('no SOF0');
}

// ── WebP ───────────────────────────────────────────────────────────────────

export interface WebpChunk {
  fourcc: string;
  data: Uint8Array;
}

/** A RIFF/WEBP container of these chunks (each padded to an even length). */
export function webp(chunks: WebpChunk[], opts: { trailer?: string } = {}): Uint8Array {
  const parts: number[] = [];
  for (const c of chunks) {
    parts.push(...latin1(c.fourcc), c.data.length & 0xff, (c.data.length >> 8) & 0xff, (c.data.length >> 16) & 0xff, (c.data.length >>> 24) & 0xff, ...c.data);
    if (c.data.length & 1) parts.push(0);
  }
  const size = 4 + parts.length;
  const trailer = opts.trailer ? [...latin1(opts.trailer)] : [];
  return Uint8Array.from([...latin1('RIFF'), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, ...latin1('WEBP'), ...parts, ...trailer]);
}

/** A lossless (VP8L) bitstream header of width × height (the 1 × 1 white pixel of libwebp's smallest file, resized). */
export function vp8l(width = 1, height = 1): WebpChunk {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return { fourcc: 'VP8L', data: Uint8Array.of(0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff, 0x00, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07) };
}

/** A lossy (VP8) key frame header of width × height, followed by a few bytes of partition data. */
export function vp8(width: number, height: number): WebpChunk {
  return { fourcc: 'VP8 ', data: Uint8Array.of(0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f, 1, 2, 3, 4) };
}

/** The extended header: flags (ICC 0x20, alpha 0x10, EXIF 0x08, XMP 0x04, animation 0x02) and the canvas size. */
export function vp8x(flags: number, width: number, height: number): WebpChunk {
  const w = width - 1;
  const h = height - 1;
  return { fourcc: 'VP8X', data: Uint8Array.of(flags, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff) };
}

export const chunk = (fourcc: string, text: string): WebpChunk => ({ fourcc, data: latin1(text) });

/** FourCCs of a RIFF/WEBP container, in order. */
export function webpChunks(b: Uint8Array): string[] {
  const out: string[] = [];
  const end = 8 + (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24));
  let i = 12;
  while (i + 8 <= end) {
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    out.push(String.fromCharCode(...b.subarray(i, i + 4)));
    i += 8 + size + (size & 1);
  }
  return out;
}

// ── Not photographs ────────────────────────────────────────────────────────

export const SVG_IMAGE = latin1('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');

export function pngImage(width = 8, height = 8): Uint8Array {
  const png = new PNG({ width, height });
  png.data.fill(200);
  return new Uint8Array(PNG.sync.write(png));
}

/** Does `haystack` contain the latin-1 bytes of `needle`? */
export function includesText(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle, 'latin1'));
}
