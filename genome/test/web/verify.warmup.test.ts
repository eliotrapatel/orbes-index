/**
 * Decoder warm-up (src/web/verify/warmup.ts): the synthetic frame the landing
 * page decodes at idle so the worker's first camera frame is not a cold one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toHex } from '../../src/core/bytes.js';
import { decodeOrbesCode, rgbaToGray } from '../../src/core/decoder/index.js';
import { WARMUP_CELLS_B64, WARMUP_FRAME_SIDE, warmupCells, warmupFrame } from '../../src/web/verify/warmup.js';

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/vectors/code01-sample.json');
const vector = JSON.parse(readFileSync(VECTORS, 'utf8')) as { framedDataHex: string; rings: { bits: string }[] };

describe('decoder warm-up frame', () => {
  it('carries the printed cells of the public sample vector (sample key: never valid in production)', () => {
    const cells = warmupCells();
    expect(cells.length).toBe(1344);
    expect(Array.from(cells).join('')).toBe(vector.rings.map((r) => r.bits).join(''));
    expect(WARMUP_CELLS_B64.length).toBe(224);
  });

  it('is a small RGBA frame that the decoder reads completely (every stage runs, then it stops early)', () => {
    const frame = warmupFrame();
    expect(frame.width).toBe(WARMUP_FRAME_SIDE);
    expect(frame.height).toBe(WARMUP_FRAME_SIDE);
    expect(frame.data.length).toBe(WARMUP_FRAME_SIDE * WARMUP_FRAME_SIDE * 4);
    const t0 = performance.now();
    const res = decodeOrbesCode(rgbaToGray(frame.data, frame.width, frame.height));
    const ms = performance.now() - t0;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(toHex(res.data)).toBe(vector.framedDataHex);
    expect(res.quality.rsErrors + res.quality.rsErasures).toBe(0);
    expect(ms).toBeLessThan(2_000);
  });

  it('draws quickly and deterministically', () => {
    const t0 = performance.now();
    const a = warmupFrame();
    expect(performance.now() - t0).toBeLessThan(200);
    expect(warmupFrame().data).toEqual(a.data);
  });
});
