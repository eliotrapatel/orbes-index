import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { makeCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
const imgs = [1, 2, 3, 4].map((s) => capture(makeCode(s), 6, { ...PRESETS.typicalPhone, rotationDeg: s * 77 }, s));
for (let r = 0; r < 3; r++) for (const img of imgs) decodeOrbesCode(img);
const T: number[] = [];
for (let r = 0; r < 10; r++) for (const img of imgs) { const t = performance.now(); decodeOrbesCode(img); T.push(performance.now() - t); }
T.sort((a, b) => a - b); console.log('min', T[0].toFixed(1), 'median', T[T.length >> 1].toFixed(1));
