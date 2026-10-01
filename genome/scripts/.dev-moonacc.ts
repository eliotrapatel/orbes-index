import { CODE01_MOONS } from '../src/core/code/profile.js';
import { binarize } from '../src/core/decoder/binarize.js';
import { findSealHits, measureSeal, mergeClusters } from '../src/core/decoder/finder.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findMoons } from '../src/core/decoder/moons.js';
import { capture, captureTruth, makeCode } from '../test/decoder/fixtures.js';
const code = makeCode(11);
const params = { rotationDeg: 200, tiltXDeg: -25, tiltYDeg: 20 };
const img = capture(code, 6, params, 7);
const truth = captureTruth(6, params);
const ii = integralImage(img);
const bin = binarize(img, ii, 90);
const seal = mergeClusters([findSealHits(bin, img.width, img.height)]).map((c) => measureSeal(img, c)).filter((s) => s)[0]!;
const m = findMoons(img, ii, seal)!;
for (const s of m.slots) { const d = CODE01_MOONS.map((c) => { const t = truth(c.x, c.y); return Math.hypot(t.x - s!.x, t.y - s!.y); }); console.log(d.map((x) => x.toFixed(2)).join(' '), 'halo', s!.halo.toFixed(2)); }
