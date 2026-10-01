import { binarize } from '../src/core/decoder/binarize.js';
import { findSealHits, measureSeal, mergeClusters } from '../src/core/decoder/finder.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findMoons } from '../src/core/decoder/moons.js';
import { makeCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';

const code = makeCode(1);
const name = (process.argv[2] ?? 'typicalPhone') as keyof typeof PRESETS;
const img = capture(code, Number(process.argv[3] ?? 8), PRESETS[name], 1);
for (let rep = 0; rep < 2; rep++) {
  let t = performance.now();
  const lap = (l: string) => { const n = performance.now(); console.log(l, (n - t).toFixed(1)); t = n; };
  const ii = integralImage(img); lap('integral');
  const side = Math.min(img.width, img.height);
  const lists = [];
  for (const w of [Math.round(side / 8), Math.round(side / 16)]) {
    const b = binarize(img, ii, w); lap('binarize ' + w);
    const h = findSealHits(b, img.width, img.height); lap('hits ' + h.length);
    lists.push(h);
  }
  const cl = mergeClusters(lists); lap('merge ' + cl.length);
  console.log(cl.slice(0, 6));
  const seals = cl.slice(0, 12).map((c) => measureSeal(img, c)).filter((s) => s); lap('measure ' + seals.length);
  for (const s of seals) {
    console.log(s);
    const m = findMoons(img, ii, s!); lap('moons');
    console.log(JSON.stringify(m));
  }
}
