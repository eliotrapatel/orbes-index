/**
 * Photographs in the console (F-04), as pure functions the views and the
 * tests share: how large a photograph is sent, how it reads in a line, and
 * what each upload reaches before anything is saved.
 *
 * The console re-encodes every photograph through a canvas (shared/photo.ts, through ui/photo.ts):
 * at most PHOTO_MAX_SIDE pixels on its longer side, as a JPEG whose quality
 * steps down until it fits the server's 1 MiB. A canvas carries none of the
 * file's metadata (EXIF and its GPS position, XMP), and draws the photograph
 * the right way up (EXIF orientation applied first); the server strips the
 * metadata of any other upload all the same.
 */
import { formatCount } from '../format.js';
import {
  encodeAttempts,
  fitWithin,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  PHOTO_MIME_TYPES,
  PHOTO_QUALITIES,
  type PhotoLimits,
} from '../../shared/photo.js';

// The encoder's pure parts moved to shared/photo.ts unchanged (lot MACRO M2, step M2.10: the collector's WORN sends
// through it too); the console reads them from here as before.
export { encodeAttempts, fitWithin, PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_MIME_TYPES, PHOTO_QUALITIES, type PhotoLimits };

/** A catalogue, gallery, circle or silhouette photograph: 2 000 px, within the server's 1 MiB. */
export const PHOTO_LIMITS: PhotoLimits = Object.freeze({
  sides: Object.freeze([PHOTO_MAX_SIDE]),
  qualities: PHOTO_QUALITIES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'This photograph stays over 1 MB once compressed. Choose a simpler or smaller one.',
});

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
