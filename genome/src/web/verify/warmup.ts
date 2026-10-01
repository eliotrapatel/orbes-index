/**
 * Decoder warm-up: a tiny synthetic ORBES CODE frame decoded once at idle on
 * the landing page, so the worker's first camera frame does not pay for the
 * JavaScript engine compiling the decoder (a cold first decode took
 * 170–790 ms in the E2E runs, a warm one tens of ms).
 *
 * The frame is drawn from the printed cells of the public CODE-01 sample
 * vector (docs/vectors/code01-sample.json, signed with the published sample
 * key, so it can never verify in production) as plain ring segments, seal and
 * moons: every decoder stage runs (finder, moons, homography, sampling,
 * format, Reed-Solomon, CRC, payload, genome) and the decode then stops early
 * on success. Its result is discarded; nothing is sent to the server.
 *
 * Pure (no DOM), so it is unit tested in Node.
 */

/** Printed cells of the sample vector, ring-major, most significant bit first (1344 bits). */
export const WARMUP_CELLS_B64 =
  'qCS9qCVEov+O3Y5We4t4yMnCgKUgi7wO+Q4UUC92seq7eVk/WmBgZxIPGYbjrMblhJUv4zt1btizq0mh73gdgqdcqxoPf64C5ysqMs4S+Lg/GPuEc35Iq8DQNkner/ToQG1W/kJa8ZbZU2s3BWldJelgeflZHZya0wWjTNpPuoyHhov+DY/MWTuqlBGDLxTL0CvvsZKtaqegs8EPD+MFYzrE/ix6LeVn';

/** Side of the warm-up frame (px): 4 px per u, enough for every stage, cheap to decode. */
export const WARMUP_FRAME_SIDE = 200;

// CODE-01 geometry (ORBES-CODE-SPEC §4), restated here so the page bundle does not pull in the core profile.
const RING_FIRST = 10.5;
const RING_COUNT = 13;
const ARC_HALF = 0.36;
const MOON_R = 1.75;
const MOON_D = 27.5 / Math.SQRT2;
const CELLS_PER_RING = Array.from({ length: RING_COUNT }, (_, k) => 4 * Math.round((2 * Math.PI * (RING_FIRST + k)) / 4));
const RING_OFFSETS = CELLS_PER_RING.reduce<number[]>((acc, n, k) => [...acc, k === 0 ? 0 : acc[k - 1] + CELLS_PER_RING[k - 1]], []);

function decodeBase64(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of b64) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** The 1344 printed cells (1 = ink) of the warm-up code. */
export function warmupCells(): Uint8Array {
  const bytes = decodeBase64(WARMUP_CELLS_B64);
  const total = RING_OFFSETS[RING_COUNT - 1] + CELLS_PER_RING[RING_COUNT - 1];
  return Uint8Array.from({ length: total }, (_, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1);
}

let cached: { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null = null;

function inkAt(cells: Uint8Array, x: number, y: number): boolean {
  const r = Math.hypot(x, y);
  if (r < 2 || (r >= 3 && r < 4)) return true; // seal core and orbit
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) if (Math.hypot(x - sx * MOON_D, y - sy * MOON_D) < MOON_R) return true;
  const k = Math.round(r - RING_FIRST);
  if (k < 0 || k >= RING_COUNT || Math.abs(r - (RING_FIRST + k)) > ARC_HALF) return false;
  let theta = Math.atan2(x, -y); // clockwise from north
  if (theta < 0) theta += 2 * Math.PI;
  const n = CELLS_PER_RING[k];
  const c = Math.min(n - 1, Math.floor((theta * n) / (2 * Math.PI)));
  return cells[RING_OFFSETS[k] + c] === 1;
}

/**
 * The warm-up frame as RGBA (ink #0A0A0A on white, 2 × 2 supersampled edges).
 * A fresh copy each call: the decoder client transfers the buffer to the worker.
 */
export function warmupFrame(): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } {
  if (!cached) {
    const side = WARMUP_FRAME_SIDE;
    const ppu = side / 50;
    const cells = warmupCells();
    const data = new Uint8ClampedArray(side * side * 4);
    for (let py = 0; py < side; py++) {
      for (let px = 0; px < side; px++) {
        let ink = 0;
        for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) if (inkAt(cells, (px + ox - side / 2) / ppu, (py + oy - side / 2) / ppu)) ink++;
        const v = Math.round(255 - (ink / 4) * (255 - 10));
        const i = (py * side + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    cached = { width: side, height: side, data };
  }
  return { width: cached.width, height: cached.height, data: cached.data.slice() };
}
