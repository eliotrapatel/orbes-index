/**
 * A photograph re-encoded on the device by a canvas, before it is sent: the console's encoder (F-04: a model's, a
 * piece's, a gallery's, a circle's photograph, the packing photo) and, since lot MACRO M2 (plan §2.3, step M2.10), the
 * collector's WORN photograph sent from a piece. Moved here unchanged from the console (admin/ui/photo.ts and
 * admin/model/photo.ts), which imports it from here.
 *
 * Re-encoding: the chosen file is decoded by the browser (createImageBitmap, EXIF orientation applied), drawn on white
 * at most PHOTO_MAX_SIDE pixels on its longer side, and sent as a JPEG whose quality steps down until it fits the
 * server's 1 MiB (the packing photo: smaller sides in turn too, until it fits the edge's 64 KB). A canvas carries none of
 * the file's metadata (EXIF and its GPS position, XMP), and draws the photograph the right way up; the server strips the
 * metadata of any other upload all the same (src/server/media/image.ts sanitizeImage).
 *
 * The words said when a photograph cannot be prepared are each app's own (the console's, the collector's copy.ts): a
 * refusal is a PhotoError with its code (PHOTO_UNREADABLE, PHOTO_TOO_LARGE) and those words.
 */

/** The longer side of a photograph as it is sent. */
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

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/** Why a photograph could not be prepared: its code, and the words of the app that asked. */
export class PhotoError extends Error {
  constructor(
    readonly code: 'PHOTO_UNREADABLE' | 'PHOTO_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'PhotoError';
  }
}

/** What an app says when a photograph cannot be prepared (`limits.tooLarge` says the last case). */
export interface PhotoWords {
  /** The browser cannot open the file as a photograph. */
  readonly unreadable: string;
  /** It opens with no pixel to draw. */
  readonly empty: string;
  /** This browser has no canvas to draw it on. */
  readonly noCanvas: string;
}

/**
 * Decode `file`, draw it at each longer side of `limits` in turn and encode it as a JPEG whose quality steps down at
 * each side, until it fits `limits.maxBytes`; refused with a PhotoError otherwise, before anything is sent.
 */
export async function reencodePhoto(file: Blob, limits: PhotoLimits, words: PhotoWords): Promise<EncodedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('PHOTO_UNREADABLE', words.unreadable);
  }
  try {
    const attempts = encodeAttempts(bitmap.width, bitmap.height, limits);
    if (attempts.length === 0) throw new PhotoError('PHOTO_UNREADABLE', words.empty);
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g) throw new PhotoError('PHOTO_UNREADABLE', words.noCanvas);
    let drawn = '';
    for (const { width, height, quality } of attempts) {
      if (drawn !== `${width}x${height}`) {
        drawn = `${width}x${height}`;
        canvas.width = width;
        canvas.height = height;
        // A JPEG has no transparency: a cut-out piece sits on white paper.
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, width, height);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, width, height);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= limits.maxBytes) return { blob, width, height };
    }
    throw new PhotoError('PHOTO_TOO_LARGE', limits.tooLarge);
  } finally {
    bitmap.close();
  }
}
