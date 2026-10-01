import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { makeCode, capture, renderCode } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
import { Prng } from '../test/support/prng.js';
let correct = 0, nul = 0, wrong = 0, fails = 0;
const confs: number[] = [];
for (let t = 0; t < 40; t++) {
  const rng = new Prng(t);
  const code = makeCode(100 + t);
  const ppu = rng.range(3, 8);
  const preset = rng.pick(['clean', 'typicalPhone', 'lowLight', 'glare', 'tilted45', 'leather', 'small'] as const);
  const img = capture(code, ppu, { ...PRESETS[preset], codeWidthPx: undefined, rotationDeg: rng.range(0, 360) }, t);
  const r = decodeOrbesCode(img);
  if (!r.ok) { fails++; continue; }
  r.genome!.glyphs.forEach((g, i) => {
    if (g === null) nul++;
    else if (g === code.genomeGlyphs[i]) { correct++; confs.push(r.genome!.confidence[i]); }
    else { wrong++; console.log('WRONG', preset, ppu.toFixed(1), 'pos', i, 'got', g, 'want', code.genomeGlyphs[i], 'conf', r.genome!.confidence[i].toFixed(2)); }
  });
}
console.log({ correct, nul, wrong, fails, minConf: Math.min(...confs).toFixed(2) });
// mirrored
const code = makeCode(7);
const src = renderCode(code, 6);
const flipped = { ...src, data: new Uint8Array(src.data.length) };
for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) flipped.data[y * src.width + x] = src.data[y * src.width + (src.width - 1 - x)];
const a = decodeOrbesCode(flipped);
const b = decodeOrbesCode(flipped, { tryMirrored: true });
console.log('mirror default', a.ok, a.ok ? '' : a.reason, 'tryMirrored', b.ok, b.ok && b.quality.mirrored, b.ok && b.genome?.glyphs.join(','), code.genomeGlyphs.join(','));
