import { CODE01_MOONS, CODE01_SIZE } from '../src/core/code/profile.js';
import { binarize } from '../src/core/decoder/binarize.js';
import { findSealHits, measureSeal, mergeClusters } from '../src/core/decoder/finder.js';
import { applyH, homographyFromPoints, multiplyH } from '../src/core/decoder/homography.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { findMoons } from '../src/core/decoder/moons.js';
import { classifyCells, sampleCells } from '../src/core/decoder/sampler.js';
import { refineControlPoints, refineOffsetField, alignmentScore } from '../src/core/decoder/refine.js';
import { makeCode, renderCode, SOURCE_PX_PER_U } from '../test/decoder/fixtures.js';
import { PRESETS, captureGeometry, simulateCapture, type CaptureParams } from '../test/support/camera-sim.js';

const code = makeCode(Number(process.env.SEED ?? 1));
const name = (process.argv[2] ?? 'tilted45') as keyof typeof PRESETS;
const ppu = Number(process.argv[3] ?? 8);
const extra = JSON.parse(process.argv[4] ?? '{}');
const params: CaptureParams = { ...PRESETS[name], codeWidthPx: ppu * CODE01_SIZE, ...extra };
const source = renderCode(code, SOURCE_PX_PER_U);
const img = simulateCapture(source, params, Number(process.env.CSEED ?? 1));
const geo = captureGeometry(source, params);
const S = SOURCE_PX_PER_U;
const truth = (u: number, v: number) => geo.project((u + 25) * S, (v + 25) * S)!;
const Htrue = multiplyH(geo.homography, [S, 0, 25 * S, 0, S, 25 * S, 0, 0, 1]);
const ber = (bits: Uint8Array) => { let e = 0; for (let i = 0; i < bits.length; i++) e += bits[i] !== code.model.cells[i] ? 1 : 0; return e; };
{
  const v = sampleCells(img, Htrue, true); const c = classifyCells(v);
  console.log('BER with true planar H:', ber(c.bits), 'contrast', c.globalContrast.toFixed(1));
}
const ii = integralImage(img);
const side = Math.min(img.width, img.height);
const cl = mergeClusters([8, 16].map((d) => findSealHits(binarize(img, ii, Math.round(side / d)), img.width, img.height)));
const seals = cl.slice(0, 12).map((c) => measureSeal(img, c)).filter((s) => s !== null);
const tc = truth(0, 0);
console.log('true centre', tc, 'scale', geo.scaleAtCenter * S);
for (const seal of seals) {
  console.log('seal', seal.center, 'err', Math.hypot(seal.center.x - tc.x, seal.center.y - tc.y).toFixed(2), 'unit', seal.unit.toFixed(2), 'score', seal.score.toFixed(2));
  const moons = findMoons(img, ii, seal);
  if (!moons) { console.log('  no moons'); continue; }
  const tm = CODE01_MOONS.map((m) => truth(m.x, m.y));
  for (const m of moons.slots) {
    if (!m) { console.log('  slot null'); continue; }
    const d = tm.map((t) => Math.hypot(t.x - m.x, t.y - m.y));
    const k = d.indexOf(Math.min(...d));
    console.log(`  moon resp ${m.response.toFixed(2)} halo ${m.halo.toFixed(2)} nearest true ${k} err ${d[k].toFixed(2)}`);
  }
  // Assign true correspondences to evaluate the pipeline independent of orientation.
  const cp = [{ x: 0, y: 0 }]; const ip = [seal.center];
  for (const m of moons.slots) { if (!m) continue; const d = tm.map((t) => Math.hypot(t.x - m.x, t.y - m.y)); const k = d.indexOf(Math.min(...d)); cp.push(CODE01_MOONS[k]); ip.push(m); }
  const h0 = homographyFromPoints(cp, ip)!;
  const v0 = sampleCells(img, h0, true); const c0 = classifyCells(v0);
  console.log('  BER initial', ber(c0.bits), 'score', alignmentScore(v0, c0).toFixed(1));
  const full = CODE01_MOONS.map((c) => c);
  const r = refineControlPoints(img, [{ x: 0, y: 0 }, ...full], [seal.center, ...full.map((c) => applyH(h0, c.x, c.y))], seal.unit, c0)!;
  const v1 = sampleCells(img, r.homography, true); const c1 = classifyCells(v1);
  console.log('  BER refined', ber(c1.bits), 'score', r.score.toFixed(1), 'trueScore', alignmentScore(sampleCells(img, Htrue, false), c0).toFixed(1));
  const t0 = performance.now();
  const f = refineOffsetField(img, r.homography, seal.unit, c1);
  const v2 = sampleCells(img, r.homography, true, f.shift); const c2 = classifyCells(v2);
  console.log('  BER field', ber(c2.bits), (performance.now() - t0).toFixed(1), 'ms');
  for (const [i, p] of r.points.entries()) { const t = i === 0 ? tc : truth(full[i - 1].x, full[i - 1].y); console.log('   ctrl err', Math.hypot(p.x - t.x, p.y - t.y).toFixed(2)); }
}
