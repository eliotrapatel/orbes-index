import { binarize } from '../src/core/decoder/binarize.js';
import { integralImage } from '../src/core/decoder/integral.js';
import { readImage } from '../test/support/image-io.js';
const img = readImage(process.argv[2]);
const [x0, x1, y0, y1] = process.argv.slice(3).map(Number);
const ii = integralImage(img);
const side = Math.min(img.width, img.height);
const b = binarize(img, ii, Math.round(side / 8));
for (let y = y0; y <= y1; y++) {
  let row = '';
  for (let x = x0; x <= x1; x++) row += b[y * img.width + x] ? '#' : '.';
  console.log(String(y).padStart(4), row);
}
