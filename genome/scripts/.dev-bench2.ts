import { binarize } from '../src/core/decoder/binarize.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findSealHits } from '../src/core/decoder/finder.js';
import { Prng } from '../test/support/prng.js';
import { makeCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
const rng = new Prng(1);
const noise = { width: 1280, height: 720, data: Uint8Array.from({ length: 1280 * 720 }, () => rng.int(0, 255)) };
const scene = capture(makeCode(1), 6, PRESETS.typicalPhone, 1);
function rle(bin: Uint8Array, w: number, h: number) { const runs = new Int32Array(w + 2); let tot = 0; for (let y = 0; y < h; y++) { let n = 0, len = 0, ink = 0; for (let x = 0, idx = y * w; x < w; x++, idx++) { const v = bin[idx]; if (v !== ink) { runs[n++] = len; len = 0; ink = v; } len++; } runs[n++] = len; tot += n; } return tot; }
for (const [name, img] of [['noise', noise], ['scene', scene]] as const) {
  const best: Record<string, number> = {};
  const lap = (k: string, f: () => unknown) => { const t = performance.now(); f(); const d = performance.now() - t; best[k] = Math.min(best[k] ?? Infinity, d); };
  for (let r = 0; r < 15; r++) {
    let ii: any, b: any;
    lap('integral', () => { ii = integralImage(img); });
    lap('binarize', () => { b = binarize(img, ii, 90); });
    lap('rle', () => rle(b, img.width, img.height));
    lap('rows', () => findSealHits(b, img.width, img.height, 'rows'));
    lap('cols', () => findSealHits(b, img.width, img.height, 'columns'));
  }
  console.log(name, Object.entries(best).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  '));
}
