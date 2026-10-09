/**
 * Photographs in the console (F-04), as pure functions the views and the
 * tests share: how large a photograph is sent, how it reads in a line, and
 * what each upload reaches before anything is saved.
 *
 * The console re-encodes every photograph through a canvas (ui/photo.ts):
 * at most PHOTO_MAX_SIDE pixels on its longer side, as a JPEG whose quality
 * steps down until it fits the server's 1 MiB. A canvas carries none of the
 * file's metadata (EXIF and its GPS position, XMP), and draws the photograph
 * the right way up (EXIF orientation applied first); the server strips the
 * metadata of any other upload all the same.
 */
import { formatCount } from '../format.js';

/** The longer side of a photograph as the console sends it. */
export const PHOTO_MAX_SIDE = 2000;
/** Mirrors the server's MAX_IMAGE_BYTES (src/server/media/image.ts): the body limit of the image routes. */
export const PHOTO_MAX_BYTES = 1024 * 1024;
/** Mirrors the server's IMAGE_MIME_TYPES: what the image routes take. */
export const PHOTO_MIME_TYPES = Object.freeze(['image/jpeg', 'image/webp'] as const);
/** JPEG qualities tried in turn, until the photograph fits PHOTO_MAX_BYTES. */
export const PHOTO_QUALITIES = Object.freeze([0.9, 0.85, 0.8, 0.72, 0.64, 0.56] as const);

/** What a re-encoding aims at: the longer sides tried in turn, the qualities tried at each, the bytes it must fit. */
export interface PhotoLimits {
  /** Longer sides, largest first: the next one is tried once no quality fits at this one. */
  readonly sides: readonly number[];
  /** JPEG qualities, highest first, tried at each side. */
  readonly qualities: readonly number[];
  readonly maxBytes: number;
  /** Said when no side and no quality fits `maxBytes`. */
  readonly tooLarge: string;
}

/** A catalogue, gallery, circle or silhouette photograph: 2 000 px, within the server's 1 MiB. */
export const PHOTO_LIMITS: PhotoLimits = Object.freeze({
  sides: Object.freeze([PHOTO_MAX_SIDE]),
  qualities: PHOTO_QUALITIES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'This photograph stays over 1 MB once compressed. Choose a simpler or smaller one.',
});

/**
 * The encodings tried, in turn, for a photograph of `width` × `height`: each side of `limits` (a side the photograph
 * already fits within is drawn at its own size, once), and at each the qualities from the highest. The first that fits
 * `limits.maxBytes` is sent.
 */
export function encodeAttempts(width: number, height: number, limits: PhotoLimits): { width: number; height: number; quality: number }[] {
  const attempts: { width: number; height: number; quality: number }[] = [];
  const drawn = new Set<string>();
  for (const side of limits.sides) {
    const size = fitWithin(width, height, side);
    const key = `${size.width}x${size.height}`;
    if (size.width === 0 || drawn.has(key)) continue;
    drawn.add(key);
    for (const quality of limits.qualities) attempts.push({ ...size, quality });
  }
  return attempts;
}

/** The size a photograph is drawn at: its own when it fits, else scaled down to `max` on its longer side. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `1 600 × 1 200 PX · 312 KB`: what will be sent. */
export function photoFacts(width: number, height: number, bytes: number): string {
  const size = bytes < 1024 ? `${formatCount(bytes)} B` : `${formatCount(Math.round(bytes / 1024))} KB`;
  return `${formatCount(width)} × ${formatCount(height)} PX · ${size}`;
}

/** Said before a model's reference photograph is saved or removed: the results it is shown on. */
export function modelPhotoImpact(issued: number): string {
  const n = Number.isFinite(issued) && issued > 0 ? issued : 0;
  const reach =
    n === 0
      ? 'No piece has been issued with this model yet: its pieces will show it'
      : `Shown at once on the ${formatCount(n)} issued ${n === 1 ? 'piece' : 'pieces'} of this model`;
  return `${reach} above the GENOME of every authentic result on /verify: the reference a client compares with the piece in hand.`;
}

/** Said before the photograph of one piece is saved or removed. */
export const PIECE_PHOTO_IMPACT =
  'Kept in the records for ORBES staff, never shown to a client: /verify shows the model’s reference photograph, the reference for every piece of it.';

/** How the console sends a photograph: said under the chooser. */
export const PHOTO_SENT_AS = `Sent as a JPEG of at most ${formatCount(PHOTO_MAX_SIDE)} px, without its EXIF or location data. Any photograph this browser opens (JPEG, PNG, WebP; HEIC in Safari).`;
