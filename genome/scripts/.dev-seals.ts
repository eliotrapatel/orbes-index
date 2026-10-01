import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { PRESETS, simulateCapture } from '../test/support/camera-sim.js';
import { makeCode, capture } from '../test/decoder/fixtures.js';
let log: string[] = [];
(globalThis as any).DBG = (s: string) => log.push(s);
const blank = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
for (let t = 0; t < 4; t++) {
  for (const [n, img] of [
    ['scene', simulateCapture(blank, { ...PRESETS.typicalPhone, sheetMargin: 0.2 }, t)],
    ['textured', simulateCapture(blank, { ...PRESETS.worn, occlusion: undefined, sheetMargin: Infinity }, t)],
    ['leather', simulateCapture(blank, { ...PRESETS.leather, sheetMargin: Infinity }, t)],
    ['code-lowLight', capture(makeCode(t), 3, PRESETS.lowLight, t)],
    ['code-leather', capture(makeCode(t), 4, PRESETS.leather, t)],
  ] as const) {
    log = [];
    const r = decodeOrbesCode(img);
    console.log(n, r.ok, log.filter((l) => l.startsWith('seal')).join(' | '));
  }
}
