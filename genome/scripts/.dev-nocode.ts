import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { PRESETS, simulateCapture } from '../test/support/camera-sim.js';
import { Prng } from '../test/support/prng.js';
const blank = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
const rows: Record<string, number[]> = {};
for (let t = 0; t < 6; t++) {
  const rng = new Prng(t);
  const frames: [string, { width: number; height: number; data: Uint8Array }][] = [
    ['scene', simulateCapture(blank, { ...PRESETS.typicalPhone, sheetMargin: 0.2, rotationDeg: rng.range(0, 360) }, t)],
    ['leather', simulateCapture(blank, { ...PRESETS.leather, sheetMargin: Infinity }, t)],
    ['textured', simulateCapture(blank, { ...PRESETS.worn, occlusion: undefined, sheetMargin: Infinity }, t)],
    ['noise', { width: 1280, height: 720, data: Uint8Array.from({ length: 1280 * 720 }, () => rng.int(0, 255)) }],
  ];
  for (const [n, img] of frames) {
    const t0 = performance.now();
    const r = decodeOrbesCode(img);
    if (r.ok) console.log('FALSE POSITIVE', n);
    (rows[n] ??= []).push(performance.now() - t0);
  }
}
for (const [n, v] of Object.entries(rows)) console.log(n.padEnd(10), v.map((x) => x.toFixed(0)).join(' '));
