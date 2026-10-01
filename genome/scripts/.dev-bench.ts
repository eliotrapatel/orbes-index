import { binarize } from '../src/core/decoder/binarize.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findSealHits } from '../src/core/decoder/finder.js';
import { makeCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
const img = capture(makeCode(1), 8, PRESETS.typicalPhone, 1);
function integral32(img: { width: number; height: number; data: Uint8Array }) {
  const w = img.width, h = img.height, s = w + 1;
  const sums = new Int32Array(s * (h + 1));
  const d = img.data;
  for (let y = 0; y < h; y++) {
    let row = 0; const src = y * w; const above = y * s; const out = above + s;
    for (let x = 0; x < w; x++) { row += d[src + x]; sums[out + x + 1] = sums[above + x + 1] + row; }
  }
  return sums;
}
for (let r = 0; r < 5; r++) {
  let t = performance.now();
  const ii = integralImage(img); const t1 = performance.now() - t; t = performance.now();
  integral32(img); const t2 = performance.now() - t; t = performance.now();
  const b = binarize(img, ii, 90); const t3 = performance.now() - t; t = performance.now();
  findSealHits(b, img.width, img.height); const t4 = performance.now() - t;
  console.log(t1.toFixed(1), t2.toFixed(1), t3.toFixed(1), t4.toFixed(1));
}
