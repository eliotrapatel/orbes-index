import { makeCode, capture } from '../test/decoder/fixtures.js';
import { PRESETS } from '../test/support/camera-sim.js';
import { writePng } from '../test/support/image-io.js';
const code = makeCode(1);
for (const name of process.argv[2].split(',') as (keyof typeof PRESETS)[]) {
  const img = capture(code, Number(process.argv[3] ?? 8), PRESETS[name], 1);
  writePng(`/tmp/claude-0/-home-user-orbes-index/c69a4bc9-92e3-59d9-b46c-1319bf876532/scratchpad/${name}.png`, img);
}
