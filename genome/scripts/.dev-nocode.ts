import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { PRESETS, simulateCapture } from '../test/support/camera-sim.js';
import { Prng } from '../test/support/prng.js';
const blank = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
for (let t = 0; t < 6; t++) {
  const rng = new Prng(t);
  const scene = simulateCapture(blank, { ...PRESETS.typicalPhone, sheetMargin: 0.2, rotationDeg: rng.range(0, 360) }, t);
  const noise = { width: 1280, height: 720, data: Uint8Array.from({ length: 1280 * 720 }, () => rng.int(0, 255)) };
  for (const [n, img] of [['scene', scene], ['noise', noise]] as const) {
    const t0 = performance.now();
    const r = decodeOrbesCode(img);
    console.log(n, r.ok, r.ok ? '' : r.reason, (performance.now() - t0).toFixed(1));
  }
}
