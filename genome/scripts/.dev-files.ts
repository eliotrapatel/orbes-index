import { basename } from 'node:path';
import { decodeOrbesCode } from '../src/core/decoder/index.js';
import { readImage } from '../test/support/image-io.js';
for (const f of process.argv.slice(2)) {
  const img = readImage(f);
  const r = decodeOrbesCode(img);
  console.log(basename(f).padEnd(48), r.ok ? 'OK ' + r.quality.rsErrors + '/' + r.quality.rsErasures : r.reason + ' ' + (r.detail ?? ''), (r.ok ? r.quality.elapsedMs : r.elapsedMs).toFixed(0) + 'ms');
}
