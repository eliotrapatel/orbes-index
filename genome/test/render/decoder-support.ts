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

let cached: Promise<CoreDecoder | undefined> | undefined;

export function loadDecoder(): Promise<CoreDecoder | undefined> {
  cached ??= (async () => {
    // A variable specifier keeps TypeScript from requiring the module at compile time.
    for (const path of ['../../src/core/decoder/index.js', '../../src/core/decoder/decoder.js']) {
      try {
        const m = (await import(/* @vite-ignore */ path)) as Partial<CoreDecoder>;
        if (typeof m.decodeOrbesCode === 'function' && typeof m.rgbaToGray === 'function') return m as CoreDecoder;
      } catch {
        // not built yet
      }
    }
    return undefined;
  })();
  return cached;
}
