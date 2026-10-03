/**
 * server/media/image.ts (F-04): an uploaded photograph is accepted only when
 * its own bytes say JPEG or WebP, as declared; EXIF, XMP and every other
 * piece of metadata are removed by hand, the picture itself left untouched,
 * the colour profile kept whole; an animated WebP, an SVG, a PNG, a damaged
 * file, one over 4 096 px or one turned by its EXIF orientation is refused.
 */
import { describe, expect, it } from 'vitest';
import { isDomainError } from '../../src/server/errors.js';
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, sanitizeImage, sniffImageType, type ImageMime } from '../../src/server/media/image.js';
import {
  chunk,
  COMMENT_SECRET,
  exifTiff,
  GPS_SECRET,
  ICC_DEVICE_TEXT,
  includesText,
  jpegMarkers,
  jpegPhoto,
  jpegPixels,
  pngImage,
  SEGMENTS,
  SVG_IMAGE,
  THUMB_SECRET,
  TRAILER_SECRET,
  vp8,
  vp8l,
  vp8x,
  webp,
  webpChunks,
  withJpegFrameSize,
  withJpegSegments,
  XMP_SECRET,
} from '../support/images.js';

/** The error code a refused image gets. */
function refusal(bytes: Uint8Array, mime: ImageMime): string {
  try {
    sanitizeImage(bytes, mime);
  } catch (e) {
    if (isDomainError(e)) return `${e.httpStatus} ${e.code}`;
    throw e;
  }
  return 'accepted';
}

const SECRETS = [GPS_SECRET, XMP_SECRET, COMMENT_SECRET, TRAILER_SECRET, THUMB_SECRET.slice(0, 6), THUMB_SECRET];

describe('sniffImageType', () => {
  it('reads the type from the magic bytes, never from a name', () => {
    expect(sniffImageType(jpegPhoto())).toBe('image/jpeg');
    expect(sniffImageType(webp([vp8l()]))).toBe('image/webp');
    expect(sniffImageType(SVG_IMAGE)).toBeNull();
    expect(sniffImageType(pngImage())).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe('JPEG', () => {
  it('keeps a plain photograph as it is, and measures it', () => {
    const photo = jpegPhoto(48, 32);
    const clean = sanitizeImage(photo, 'image/jpeg');
    expect(clean).toMatchObject({ mime: 'image/jpeg', width: 48, height: 32 });
    expect(Buffer.from(clean.bytes).equals(Buffer.from(photo))).toBe(true);
  });

  it('removes EXIF (with its GPS position), XMP, IPTC, comments, thumbnails, multi-picture data and anything after the image', () => {
    const photo = jpegPhoto(48, 32);
    const tagged = withJpegSegments(
      photo,
      [SEGMENTS.jfifWithThumbnail(), SEGMENTS.exif(), SEGMENTS.xmp(), SEGMENTS.jfxx(), SEGMENTS.iptc(), SEGMENTS.mpf(), SEGMENTS.comment()],
      { replaceApp0: true, trailer: TRAILER_SECRET },
    );
    for (const s of SECRETS) expect(includesText(tagged, s), s).toBe(true);
    const clean = sanitizeImage(tagged, 'image/jpeg');
    for (const s of SECRETS) expect(includesText(clean.bytes, s), s).toBe(false);
    // The JFIF header stays, without its thumbnail; every APP1, APP13, MPF and comment is gone.
    expect(jpegMarkers(clean.bytes)).toEqual(['e0', 'db', 'c0', 'c4', 'da']);
    expect([...clean.bytes.subarray(2, 20)]).toEqual([0xff, 0xe0, 0, 16, ...Buffer.from('JFIF\u0000', 'latin1'), 1, 2, 0, 0, 1, 0, 1, 0, 0]);
    expect([...clean.bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
    // The picture is exactly the same.
    const before = jpegPixels(photo);
    const after = jpegPixels(clean.bytes);
    expect([after.width, after.height]).toEqual([48, 32]);
    expect(Buffer.from(after.data).equals(Buffer.from(before.data))).toBe(true);
    // Stripping is idempotent.
    expect(Buffer.from(sanitizeImage(clean.bytes, 'image/jpeg').bytes).equals(Buffer.from(clean.bytes))).toBe(true);
  });

  it('keeps what the colours need: the ICC profile and the Adobe marker', () => {
    const clean = sanitizeImage(withJpegSegments(jpegPhoto(), [SEGMENTS.icc(), SEGMENTS.exif(), SEGMENTS.adobe()]), 'image/jpeg');
    expect(jpegMarkers(clean.bytes)).toEqual(['e2', 'ee', 'e0', 'db', 'c0', 'c4', 'da']);
    expect(includesText(clean.bytes, 'ICC_PROFILE')).toBe(true);
    expect(includesText(clean.bytes, GPS_SECRET)).toBe(false);
  });

  it('keeps the ICC profile as it is, its own text included: a device profile still names its maker and model', () => {
    // What the module header, API §13.4 and SECURITY-MODEL say: the profile is kept whole, never edited.
    const clean = sanitizeImage(withJpegSegments(jpegPhoto(), [SEGMENTS.iccDevice(), SEGMENTS.exif()]), 'image/jpeg');
    expect(includesText(clean.bytes, ICC_DEVICE_TEXT)).toBe(true);
    expect(includesText(clean.bytes, GPS_SECRET)).toBe(false);
  });

  it('refuses a photograph turned by its EXIF orientation (other than 1), which would show sideways once the EXIF is removed', () => {
    const photo = jpegPhoto(32, 16);
    for (const [value, order] of [[6, 'MM'], [8, 'II'], [3, 'MM'], [2, 'II']] as const) {
      const turned = withJpegSegments(photo, [SEGMENTS.exifOriented(value, order)]);
      let message = '';
      try {
        sanitizeImage(turned, 'image/jpeg');
      } catch (e) {
        if (!isDomainError(e)) throw e;
        expect(`${e.httpStatus} ${e.code}`).toBe('400 IMAGE_INVALID');
        message = e.publicMessage;
      }
      expect(message, `orientation ${value} ${order}`).toBe('The photograph is turned by its EXIF orientation, which is removed here: save it upright, then send it again.');
    }
    // Upright (1), an orientation a browser ignores (0, 9), or none at all: kept, the EXIF removed, the size as it was.
    for (const value of [1, 0, 9]) {
      const clean = sanitizeImage(withJpegSegments(photo, [SEGMENTS.exifOriented(value)]), 'image/jpeg');
      expect(clean).toMatchObject({ width: 32, height: 16 });
      expect(includesText(clean.bytes, GPS_SECRET)).toBe(false);
    }
  });

  it('refuses a damaged, truncated or oversized JPEG', () => {
    const photo = jpegPhoto();
    expect(refusal(photo.subarray(0, photo.length - 2), 'image/jpeg')).toBe('400 IMAGE_INVALID'); // no end of image
    expect(refusal(photo.subarray(0, 40), 'image/jpeg')).toBe('400 IMAGE_INVALID');
    expect(refusal(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), 'image/jpeg')).toBe('400 IMAGE_INVALID'); // no frame, no scan
    // A segment whose length runs past the file.
    const broken = Uint8Array.from(photo);
    broken[4] = 0xff;
    expect(refusal(broken, 'image/jpeg')).toBe('400 IMAGE_INVALID');
    // Over 4 096 px on a side (a decompression bomb for the phones that show it).
    expect(refusal(withJpegFrameSize(photo, MAX_IMAGE_SIDE + 1, 10), 'image/jpeg')).toBe('400 IMAGE_INVALID');
    expect(refusal(withJpegFrameSize(photo, 10, 60_000), 'image/jpeg')).toBe('400 IMAGE_INVALID');
    expect(sanitizeImage(withJpegFrameSize(photo, MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), 'image/jpeg')).toMatchObject({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE });
    expect(refusal(withJpegFrameSize(photo, 0, 10), 'image/jpeg')).toBe('400 IMAGE_INVALID');
    // A JPEG-LS or hierarchical frame no browser draws.
    const ls = Uint8Array.from(photo);
    ls[findMarker(photo, 0xc0) + 1] = 0xf7;
    expect(refusal(ls, 'image/jpeg')).toBe('400 IMAGE_INVALID');
  });

  it('refuses anything over 1 MiB, before reading it', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(jpegPhoto());
    expect(refusal(big, 'image/jpeg')).toBe('413 PAYLOAD_TOO_LARGE');
  });
});

describe('WebP', () => {
  it('keeps a simple lossless or lossy WebP, and measures it', () => {
    expect(sanitizeImage(webp([vp8l(1, 1)]), 'image/webp')).toMatchObject({ mime: 'image/webp', width: 1, height: 1 });
    expect(sanitizeImage(webp([vp8l(640, 480)]), 'image/webp')).toMatchObject({ width: 640, height: 480 });
    const lossy = sanitizeImage(webp([vp8(300, 200)]), 'image/webp');
    expect(lossy).toMatchObject({ width: 300, height: 200 });
    expect(webpChunks(lossy.bytes)).toEqual(['VP8 ']);
  });

  it('removes the EXIF and XMP chunks and their flags, unknown chunks and anything after the container', () => {
    const tagged = webp(
      [vp8x(0x08 | 0x04 | 0x20, 640, 480), chunk('ICCP', 'sRGB profile'), vp8l(640, 480), chunk('EXIF', `MM\u0000*${GPS_SECRET}`), chunk('XMP ', `<x:xmpmeta>${XMP_SECRET}</x:xmpmeta>`), chunk('ABCD', COMMENT_SECRET)],
      { trailer: TRAILER_SECRET },
    );
    for (const s of [GPS_SECRET, XMP_SECRET, COMMENT_SECRET, TRAILER_SECRET]) expect(includesText(tagged, s), s).toBe(true);
    const clean = sanitizeImage(tagged, 'image/webp');
    for (const s of [GPS_SECRET, XMP_SECRET, COMMENT_SECRET, TRAILER_SECRET]) expect(includesText(clean.bytes, s), s).toBe(false);
    expect(webpChunks(clean.bytes)).toEqual(['VP8X', 'ICCP', 'VP8L']);
    // EXIF and XMP flags cleared, ICC kept (its chunk is), the canvas as it was; the RIFF size is the file's.
    expect(clean.bytes[20]).toBe(0x20);
    expect(clean).toMatchObject({ width: 640, height: 480 });
    const riff = clean.bytes[4] | (clean.bytes[5] << 8) | (clean.bytes[6] << 16) | (clean.bytes[7] << 24);
    expect(riff + 8).toBe(clean.bytes.length);
    expect(Buffer.from(sanitizeImage(clean.bytes, 'image/webp').bytes).equals(Buffer.from(clean.bytes))).toBe(true);
  });

  it('refuses a WebP turned by the orientation of its EXIF chunk, with or without the JPEG\'s Exif header', () => {
    const exif = (value: number, prefix = false) => ({ fourcc: 'EXIF', data: Uint8Array.from([...(prefix ? [0x45, 0x78, 0x69, 0x66, 0, 0] : []), ...exifTiff(value, 'II', GPS_SECRET)]) });
    expect(refusal(webp([vp8x(0x08, 64, 48), vp8l(64, 48), exif(6)]), 'image/webp')).toBe('400 IMAGE_INVALID');
    expect(refusal(webp([vp8x(0x08, 64, 48), vp8l(64, 48), exif(8, true)]), 'image/webp')).toBe('400 IMAGE_INVALID');
    const upright = sanitizeImage(webp([vp8x(0x08, 64, 48), vp8l(64, 48), exif(1)]), 'image/webp');
    expect(webpChunks(upright.bytes)).toEqual(['VP8X', 'VP8L']);
    expect(includesText(upright.bytes, GPS_SECRET)).toBe(false);
  });

  it('keeps the ICCP chunk as it is, its own text included', () => {
    const clean = sanitizeImage(webp([vp8x(0x20, 64, 48), chunk('ICCP', `desc Display P3 ${ICC_DEVICE_TEXT}`), vp8l(64, 48)]), 'image/webp');
    expect(webpChunks(clean.bytes)).toEqual(['VP8X', 'ICCP', 'VP8L']);
    expect(includesText(clean.bytes, ICC_DEVICE_TEXT)).toBe(true);
  });

  it('keeps the transparency of a lossy WebP (ALPH) only where the header announces it', () => {
    const withAlpha = sanitizeImage(webp([vp8x(0x10, 30, 20), chunk('ALPH', 'alpha!'), vp8(30, 20), chunk('EXIF', GPS_SECRET)]), 'image/webp');
    expect(webpChunks(withAlpha.bytes)).toEqual(['VP8X', 'ALPH', 'VP8 ']);
    expect(withAlpha.bytes[20]).toBe(0x10);
  });

  it('refuses an animated WebP: by its flag, or by its ANIM and ANMF chunks', () => {
    expect(refusal(webp([vp8x(0x02, 64, 64), chunk('ANIM', 'loop'), chunk('ANMF', 'frame 1'), chunk('ANMF', 'frame 2')]), 'image/webp')).toBe('400 IMAGE_ANIMATED');
    expect(refusal(webp([vp8x(0x02, 64, 64), vp8l(64, 64)]), 'image/webp')).toBe('400 IMAGE_ANIMATED');
    expect(refusal(webp([vp8x(0x00, 64, 64), chunk('ANIM', 'loop'), vp8l(64, 64)]), 'image/webp')).toBe('400 IMAGE_ANIMATED');
  });

  it('refuses a damaged WebP', () => {
    expect(refusal(webp([chunk('EXIF', GPS_SECRET)]), 'image/webp')).toBe('400 IMAGE_INVALID'); // no bitstream
    expect(refusal(webp([vp8l(), vp8l()]), 'image/webp')).toBe('400 IMAGE_INVALID'); // two
    expect(refusal(webp([vp8x(0, 100, 100), vp8l(50, 50)]), 'image/webp')).toBe('400 IMAGE_INVALID'); // canvas ≠ bitstream
    expect(refusal(webp([vp8l(5000, 10)]), 'image/webp')).toBe('400 IMAGE_INVALID'); // over 4 096 px
    const truncated = webp([vp8l(10, 10)]);
    expect(refusal(truncated.subarray(0, truncated.length - 4), 'image/webp')).toBe('400 IMAGE_INVALID');
    expect(refusal(webp([{ fourcc: 'VP8 ', data: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) }]), 'image/webp')).toBe('400 IMAGE_INVALID'); // not a key frame
  });
});

describe('what is not a JPEG or a WebP', () => {
  it('refuses an SVG, a PNG or text, whatever type it is sent as', () => {
    for (const mime of ['image/jpeg', 'image/webp'] as const) {
      expect(refusal(SVG_IMAGE, mime), mime).toBe('400 IMAGE_INVALID');
      expect(refusal(pngImage(), mime), mime).toBe('400 IMAGE_INVALID');
      expect(refusal(new TextEncoder().encode('hello'), mime), mime).toBe('400 IMAGE_INVALID');
      expect(refusal(new Uint8Array(0), mime), mime).toBe('400 IMAGE_INVALID');
    }
  });

  it('refuses a JPEG sent as WebP, and a WebP sent as JPEG', () => {
    expect(refusal(jpegPhoto(), 'image/webp')).toBe('400 IMAGE_INVALID');
    expect(refusal(webp([vp8l()]), 'image/jpeg')).toBe('400 IMAGE_INVALID');
  });
});

/** Offset of the first `marker` segment of a JPEG (its FF byte). */
function findMarker(b: Uint8Array, marker: number): number {
  let i = 2;
  while (i + 3 < b.length && b[i] === 0xff) {
    if (b[i + 1] === marker) return i;
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  throw new Error(`no marker ${marker.toString(16)}`);
}
