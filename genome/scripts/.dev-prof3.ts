import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { PRESETS, simulateCapture } from '../test/support/camera-sim.js';
const blank = { width: 400, height: 400, data: new Uint8Array(400 * 400).fill(255) };
const frames = [0, 1, 2].map((t) => simulateCapture(blank, { ...PRESETS.worn, occlusion: undefined, sheetMargin: Infinity }, t));
const f2 = [0, 1, 2].map((t) => simulateCapture(blank, { ...PRESETS.typicalPhone, sheetMargin: 0.2 }, t));
for (let r = 0; r < 6; r++) for (const f of [...frames, ...f2]) decodeOrbesCode(f);
