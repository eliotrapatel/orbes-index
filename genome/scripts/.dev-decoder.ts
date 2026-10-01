import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { makeCode, renderCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
(globalThis as any).DBG = process.env.DBG ? (s: string) => console.log('   ', s) : undefined;
const code = makeCode(Number(process.env.SEED ?? 1));
const names = (process.argv[2] ?? 'clean,typicalPhone,tilted45,glare,leather,worn,small,lowLight,metal').split(',');
for (const name of names as (keyof typeof PRESETS)[]) {
  const img = capture(code, Number(process.argv[3] ?? 8), PRESETS[name], 1);
  decodeOrbesCode(img);
  const t = performance.now();
  const r = decodeOrbesCode(img);
  console.log(name, r.ok, r.ok ? '' : r.reason + ' ' + r.detail, (performance.now() - t).toFixed(1), r.ok ? JSON.stringify({ e: r.quality.rsErrors, er: r.quality.rsErasures, g: r.genome?.glyphs.join(','), want: code.genomeGlyphs.join(',') }) : '');
}
