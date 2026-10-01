import { binarize } from '../src/core/decoder/binarize.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findSealHits, mergeClusters, measureSeal } from '../src/core/decoder/finder.js';
import { Prng } from '../test/support/prng.js';
const rng = new Prng(1);
const img = { width: 1280, height: 720, data: Uint8Array.from({ length: 1280 * 720 }, () => rng.int(0, 255)) };
for (let r = 0; r < 3; r++) {
  let t = performance.now();
  const lap = (l: string) => { const n = performance.now(); console.log(l, (n - t).toFixed(1)); t = n; };
  const ii = integralImage(img); lap('integral');
  const b = binarize(img, ii, 90); lap('bin');
  const h = findSealHits(b, 1280, 720, 'rows'); lap('rows ' + h.length);
  const c = findSealHits(b, 1280, 720, 'columns'); lap('cols ' + c.length);
  const m = mergeClusters([h, c]); lap('merge ' + m.length);
  let ok = 0; for (const cl of m.slice(0, 12)) if (measureSeal(img, cl)) ok++; lap('measure ' + ok);
}
console.log((globalThis as any).NP, (globalThis as any).NH);
