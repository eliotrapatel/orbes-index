/**
 * Optional access to the core decoder (src/core/decoder/, CONTRACTS §8) for
 * round-trip tests of rendered artifacts. The decoder is built by another
 * team; until it exists these helpers return undefined and the round-trip
 * assertions are skipped (parse checks still run).
 */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type DecodeResult =
  | { ok: true; data: Uint8Array; payloadBytes: Uint8Array; signature: Uint8Array; quality: { inverted: boolean } }
  | { ok: false; reason: string; detail?: string };

export interface CoreDecoder {
  rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage;
  decodeOrbesCode(img: GrayImage, opts?: { tryInverted?: boolean; tryMirrored?: boolean; readGenome?: boolean }): DecodeResult;
}

// The contract fixes the exports, not the file layout: look in the likely modules.
const CANDIDATES = ['index.js', 'decoder.js', 'decode.js', 'image.js'];

let cached: Promise<CoreDecoder | undefined> | undefined;

export function loadDecoder(): Promise<CoreDecoder | undefined> {
  cached ??= (async () => {
    const found: Partial<CoreDecoder> = {};
    for (const file of CANDIDATES) {
      try {
        // A variable specifier keeps TypeScript from requiring the module at compile time.
        const path = `../../src/core/decoder/${file}`;
        const m = (await import(/* @vite-ignore */ path)) as Partial<CoreDecoder>;
        if (!found.decodeOrbesCode && typeof m.decodeOrbesCode === 'function') found.decodeOrbesCode = m.decodeOrbesCode;
        if (!found.rgbaToGray && typeof m.rgbaToGray === 'function') found.rgbaToGray = m.rgbaToGray;
      } catch {
        // module not built (yet)
      }
    }
    return found.decodeOrbesCode && found.rgbaToGray ? (found as CoreDecoder) : undefined;
  })();
  return cached;
}
