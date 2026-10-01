import { PRESETS, simulateCapture, type CaptureParams } from './camera-sim.js';
import { svgToGray } from './raster.js';
import { orbitalTestPattern } from './preview.js';
const source = svgToGray(orbitalTestPattern(7), { widthPx: 1200 });
const p: CaptureParams = { ...PRESETS.typicalPhone };
const base: CaptureParams = { ...p, background: 0.3, substrate: 'none', blurSigma: 0, motionBlur: undefined, noise: undefined, jpegQuality: undefined };
const variants: [string, CaptureParams][] = [
  ['clean', {}], ['geom', base], ['+clutter', { ...base, background: p.background }], ['+paper', { ...base, substrate: 'paper' }],
  ['+blur', { ...base, blurSigma: 0.9 }], ['+motion', { ...base, motionBlur: p.motionBlur }], ['+noise', { ...base, noise: p.noise }],
  ['+jpeg', { ...base, jpegQuality: 82 }], ['full', p],
];
const best = new Map<string, number>();
for (let rep = 0; rep < 5; rep++) for (const [n, v] of variants) {
  const t = performance.now(); simulateCapture(source, v, 1); const ms = performance.now() - t;
  best.set(n, Math.min(best.get(n) ?? 1e9, ms));
}
for (const [n, ms] of best) console.log(n.padEnd(10), ms.toFixed(0));
