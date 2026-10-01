import { binarize } from '../src/core/decoder/binarize.js';
import { findSealHits, measureSeal, mergeClusters } from '../src/core/decoder/finder.js';
import { homographyFromPoints, applyH } from '../src/core/decoder/homography.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findMoons } from '../src/core/decoder/moons.js';
import { classifyCells, sampleCells, quietZoneScore } from '../src/core/decoder/sampler.js';
import { CODE01_MOONS } from '../src/core/code/profile.js';
import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { readImage } from '../test/support/image-io.js';
(globalThis as any).DBG = (s: string) => console.log('   ', s);
const img = readImage(process.argv[2]);
const ii = integralImage(img);
const side = Math.min(img.width, img.height);
for (const axis of ['rows', 'columns'] as const) {
  const cl = mergeClusters([8, 16].map((d) => findSealHits(binarize(img, ii, Math.round(side / d)), img.width, img.height, axis)));
  console.log(axis, 'clusters', cl.map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)} u${c.unit.toFixed(1)} n${c.count}`).join(' | '));
  for (const c of cl.slice(0, 6)) {
    const s = measureSeal(img, c);
    if (!s) { console.log('  measure fail'); continue; }
    console.log('  seal', s.center.x.toFixed(1), s.center.y.toFixed(1), 'unit', s.unit.toFixed(2));
    const m = findMoons(img, ii, s);
    if (!m) { console.log('  no moons'); continue; }
    console.log('  moons', m.slots.map((x) => x ? `${x.x.toFixed(0)},${x.y.toFixed(0)} r${x.response.toFixed(2)} h${x.halo.toFixed(2)}` : 'null').join(' | '));
    const cp = [{ x: 0, y: 0 }], ip = [s.center];
    m.slots.forEach((x, k) => { if (x) { cp.push(CODE01_MOONS[k]); ip.push(x); } });
    const h = homographyFromPoints(cp, ip)!;
    const v = sampleCells(img, h, true); const cls = classifyCells(v);
    console.log('  quiet', quietZoneScore(img, h, cls).toFixed(2));
  }
}
const r = decodeOrbesCode(img);
console.log(r.ok ? 'OK' : r.reason + ' ' + r.detail, r.ok ? r.quality : '');
