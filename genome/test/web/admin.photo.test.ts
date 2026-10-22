/**
 * The console's canvas encoder, moved to shared/photo.ts unchanged (lot MACRO M2, plan §2.3, step M2.10: the collector's
 * WORN sends through it too), its behaviour held in vitest's node environment with a fake decoder and canvas:
 *
 *  - the file decoded with its EXIF orientation applied, drawn on white at the side tried, each quality in turn, the
 *    first that fits sent, the decoder's bitmap closed;
 *  - a smaller side tried only once no quality fits (the packing photo's limits);
 *  - refused before anything is sent, the console reading each refusal as before: an ApiError of status 0, its code
 *    (PHOTO_UNREADABLE, PHOTO_TOO_LARGE) and its words; the collector's own words through the same encoder;
 *  - the console's pure parts are the shared ones (admin/model/photo.ts re-exports them).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as consoleModel from '../../src/web/admin/model/photo.js';
import { PACKING_PHOTO_LIMITS } from '../../src/web/admin/model/logistics.js';
import { reencodePhoto as consoleEncode } from '../../src/web/admin/ui/photo.js';
import { ApiError } from '../../src/web/admin/api.js';
import * as shared from '../../src/web/shared/photo.js';

interface Drawn {
  calls: string[];
  closed: boolean;
}

/** A decoder answering a `w` × `h` bitmap, and a canvas whose JPEG weighs `bytes(width, height, quality)`. */
function fakeBrowser(w: number, h: number, bytes: (width: number, height: number, quality: number) => number, opts: { decodes?: boolean; context?: boolean } = {}): Drawn {
  const drawn: Drawn = { calls: [], closed: false };
  vi.stubGlobal('createImageBitmap', async (_file: Blob, o: { imageOrientation?: string }) => {
    drawn.calls.push(`decode ${o?.imageOrientation}`);
    if (opts.decodes === false) throw new Error('not an image');
    return { width: w, height: h, close: () => (drawn.closed = true) };
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () =>
      opts.context === false
        ? null
        : {
            set fillStyle(v: string) {
              drawn.calls.push(`fill ${v}`);
            },
            fillRect: (x: number, y: number, cw: number, ch: number) => drawn.calls.push(`rect ${x},${y},${cw}x${ch}`),
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            drawImage: (_b: unknown, x: number, y: number, dw: number, dh: number) => drawn.calls.push(`draw ${x},${y},${dw}x${dh}`),
          },
    toBlob(cb: (b: Blob | null) => void, type: string, quality: number) {
      drawn.calls.push(`encode ${type} ${quality} at ${this.width}x${this.height}`);
      cb(new Blob([new Uint8Array(bytes(this.width, this.height, quality))], { type }));
    },
  };
  vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas : null) });
  return drawn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/heic' });
const WORDS = { unreadable: 'U', empty: 'E', noCanvas: 'N' };

describe('the canvas encoder (shared/photo.ts), as the console used it', () => {
  it('draws a 4 000 × 3 000 photograph on white at 2 000 px and sends the first quality under 1 MiB', async () => {
    const drawn = fakeBrowser(4000, 3000, (_w, _h, q) => (q > 0.8 ? 2_000_000 : 900_000));
    const out = await consoleEncode(file);
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1500);
    expect(out.blob.size).toBe(900_000);
    expect(out.blob.type).toBe('image/jpeg');
    expect(drawn.calls).toEqual([
      'decode from-image',
      'fill #ffffff',
      'rect 0,0,2000x1500',
      'draw 0,0,2000x1500',
      'encode image/jpeg 0.9 at 2000x1500',
      'encode image/jpeg 0.85 at 2000x1500',
      'encode image/jpeg 0.8 at 2000x1500',
    ]);
    expect(drawn.closed).toBe(true);
  });

  it('tries a smaller side only once no quality fits (the packing photo), drawing each side once', async () => {
    const drawn = fakeBrowser(3200, 2400, (w) => (w > 1200 ? 70_000 : 60_000));
    const out = await consoleEncode(file, PACKING_PHOTO_LIMITS);
    expect(out.width).toBe(1200);
    expect(drawn.calls.filter((c) => c.startsWith('draw'))).toEqual(['draw 0,0,1600x1200', 'draw 0,0,1400x1050', 'draw 0,0,1200x900']);
  });

  it('refuses, before anything is sent, as the console said it: status 0, its code and its words', async () => {
    fakeBrowser(4000, 3000, () => 2_000_000);
    await expect(consoleEncode(file)).rejects.toMatchObject({ status: 0, code: 'PHOTO_TOO_LARGE', message: consoleModel.PHOTO_LIMITS.tooLarge });
    await expect(consoleEncode(file)).rejects.toBeInstanceOf(ApiError);
    fakeBrowser(0, 0, () => 1, { decodes: false });
    await expect(consoleEncode(file)).rejects.toMatchObject({ status: 0, code: 'PHOTO_UNREADABLE', message: 'This file could not be opened as a photograph. Choose a JPEG, PNG or WebP image.' });
    fakeBrowser(0, 0, () => 1);
    await expect(consoleEncode(file)).rejects.toMatchObject({ code: 'PHOTO_UNREADABLE', message: 'This photograph is empty.' });
    fakeBrowser(10, 10, () => 1, { context: false });
    await expect(consoleEncode(file)).rejects.toMatchObject({ code: 'PHOTO_UNREADABLE', message: 'This browser cannot prepare the photograph.' });
  });

  it('says each refusal in the words of the app that asked (the collector’s WORN)', async () => {
    fakeBrowser(0, 0, () => 1, { decodes: false });
    await expect(shared.reencodePhoto(file, consoleModel.PHOTO_LIMITS, WORDS)).rejects.toMatchObject({ name: 'PhotoError', code: 'PHOTO_UNREADABLE', message: 'U' });
    fakeBrowser(0, 0, () => 1);
    await expect(shared.reencodePhoto(file, consoleModel.PHOTO_LIMITS, WORDS)).rejects.toMatchObject({ code: 'PHOTO_UNREADABLE', message: 'E' });
    fakeBrowser(10, 10, () => 1, { context: false });
    await expect(shared.reencodePhoto(file, consoleModel.PHOTO_LIMITS, WORDS)).rejects.toMatchObject({ code: 'PHOTO_UNREADABLE', message: 'N' });
    fakeBrowser(4000, 3000, () => 2_000_000);
    const err = await shared.reencodePhoto(file, { ...consoleModel.PHOTO_LIMITS, tooLarge: 'T' }, WORDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(shared.PhotoError);
    expect(err).toMatchObject({ code: 'PHOTO_TOO_LARGE', message: 'T' });
  });

  it('is the console’s, unchanged: its pure parts are the shared ones', () => {
    expect(consoleModel.encodeAttempts).toBe(shared.encodeAttempts);
    expect(consoleModel.fitWithin).toBe(shared.fitWithin);
    expect(consoleModel.PHOTO_MAX_SIDE).toBe(shared.PHOTO_MAX_SIDE);
    expect(consoleModel.PHOTO_MAX_BYTES).toBe(shared.PHOTO_MAX_BYTES);
    expect(consoleModel.PHOTO_QUALITIES).toBe(shared.PHOTO_QUALITIES);
    expect(consoleModel.PHOTO_MIME_TYPES).toBe(shared.PHOTO_MIME_TYPES);
  });
});
