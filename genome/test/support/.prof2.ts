import { PRESETS, simulateCapture } from './camera-sim.js';
import { svgToGray } from './raster.js';
import { orbitalTestPattern } from './preview.js';
const source = svgToGray(orbitalTestPattern(7), { widthPx: 1200 });
for (let rep = 0; rep < 8; rep++) simulateCapture(source, PRESETS.typicalPhone, rep);
