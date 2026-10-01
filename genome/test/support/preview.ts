/**
 * Eyeball check for the camera simulator: renders a code-like orbital test
 * pattern through every preset and writes PNGs to genome/out/sim-preview/.
 *
 *   npx tsx test/support/preview.ts [seed]
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, simulateCapture, type PresetName } from './camera-sim.js';
import { writePng } from './image-io.js';
import { Prng } from './prng.js';
import { svgToGray } from './raster.js';

/**
 * CODE-01-like stand-in (viewBox −25..25): seal, 13 orbits of random arcs,
 * four moons. Only the look matters here; real artifacts come from the encoder.
 */
export function orbitalTestPattern(seed: number): string {
  const rng = new Prng(seed);
  const parts: string[] = [
    '<circle cx="0" cy="0" r="2" fill="#000"/>',
    '<circle cx="0" cy="0" r="3.5" fill="none" stroke="#000" stroke-width="1"/>',
    '<circle cx="0" cy="0" r="7.5" fill="none" stroke="#000" stroke-width="0.25"/>',
  ];
  for (let ring = 0; ring < 13; ring++) {
    const radius = 10.5 + ring;
    const cells = 4 * Math.round((2 * Math.PI * radius) / 4);
    let start = -1;
    for (let c = 0; c <= cells; c++) {
      const ink = c < cells && rng.chance(0.5);
      if (ink && start < 0) start = c;
      if (!ink && start >= 0) {
        const a0 = (start / cells) * 2 * Math.PI;
        const a1 = (c / cells) * 2 * Math.PI;
        const p = (a: number) => `${(radius * Math.sin(a)).toFixed(3)} ${(-radius * Math.cos(a)).toFixed(3)}`;
        parts.push(
          `<path d="M ${p(a0)} A ${radius} ${radius} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}" fill="none" stroke="#000" stroke-width="0.72"/>`,
        );
        start = -1;
      }
    }
  }
  for (const deg of [315, 45, 135, 225]) {
    const a = (deg * Math.PI) / 180;
    parts.push(`<circle cx="${(27.5 * Math.sin(a)).toFixed(3)}" cy="${(-27.5 * Math.cos(a)).toFixed(3)}" r="1.75" fill="#000"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 60 60"><rect x="-30" y="-30" width="60" height="60" fill="#fff"/>${parts.join('')}</svg>`;
}

function main(): void {
  const seed = Number(process.argv[2] ?? 7);
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'sim-preview');
  const source = svgToGray(orbitalTestPattern(seed), { widthPx: 1200 });
  writePng(join(outDir, 'source.png'), source);
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const started = performance.now();
    const frame = simulateCapture(source, PRESETS[name], seed);
    const ms = performance.now() - started;
    const file = join(outDir, `${name}.png`);
    writePng(file, frame);
    console.log(`${name.padEnd(13)} ${frame.width}×${frame.height}  ${ms.toFixed(0).padStart(4)} ms  → ${file}`);
  }
}

if (process.argv[1]?.endsWith("preview.ts")) main();
