/**
 * Renders the browser-tab icons of both web apps from the ORBES monogram
 * (BRAND-DESIGN-SYSTEM §3.5, §3.9).
 *
 *   npx tsx scripts/favicons.ts
 *
 * Writes:
 *   src/web/verify/favicon.svg   the monogram in ink on a white disc
 *   src/web/admin/favicon.svg    the monogram in ink on an ivory square, with
 *                                the four corner moons that tell the console
 *                                apart from the public app in a row of tabs
 *
 * The five outlines are the master's, verbatim (src/core/render/monogram.ts),
 * placed by one transform: the ink box 26 of 32 units wide, centred. The
 * white disc keeps the icon legible on a dark tab bar. Output is byte for
 * byte reproducible; test/web/monogram.test.ts checks that the committed
 * files are what this script produces, so run it after any change to the
 * monogram or to these icons. The build copies each file to /assets/ with a
 * content hash (scripts/build-web.ts).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORBES_CODE_STYLES } from '../src/core/code/styles.js';
import { MONOGRAM_BOUNDS, MONOGRAM_PATHS } from '../src/core/render/monogram.js';

export const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/web');

/** Icon geometry, in the icon's 32-unit viewBox. */
export const FAVICON = Object.freeze({
  size: 32,
  /** Width of the monogram's ink box, centred: 3 units clear on either side. */
  monogramWidth: 26,
  ink: '#0a0a0a',
  /** /verify: a white disc of radius 15 under the monogram. */
  discRadius: 15,
  paper: '#ffffff',
  /** /admin: the ivory square and its four corner moons (radius 2, 4 units from each edge). */
  ivory: ORBES_CODE_STYLES.ivory.paper.toLowerCase(),
  moonRadius: 2,
  moonInset: 4,
});

const num = (n: number): string => {
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/** The monogram centred in the icon: one group, one transform, the master outlines. */
function monogramGroup(): string {
  const { size, monogramWidth, ink } = FAVICON;
  const b = MONOGRAM_BOUNDS;
  const k = monogramWidth / b.w;
  const tx = (size - monogramWidth) / 2 - b.x * k;
  const ty = (size - b.h * k) / 2 - b.y * k;
  return `<g fill="${ink}" transform="matrix(${num(k)} 0 0 ${num(k)} ${num(tx)} ${num(ty)})">${MONOGRAM_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

/** The two icons: path relative to src/web, and the SVG. */
export function renderFavicons(): { app: 'verify' | 'admin'; path: string; svg: string }[] {
  const { size, paper, discRadius, ivory, moonRadius: r, moonInset: m } = FAVICON;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`;
  const c = size / 2;
  const moons = [
    [m, m],
    [size - m, m],
    [size - m, size - m],
    [m, size - m],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${FAVICON.ink}"/>`)
    .join('');
  return [
    { app: 'verify', path: 'verify/favicon.svg', svg: `${open}<circle cx="${c}" cy="${c}" r="${discRadius}" fill="${paper}"/>${monogramGroup()}</svg>\n` },
    { app: 'admin', path: 'admin/favicon.svg', svg: `${open}<rect width="${size}" height="${size}" fill="${ivory}"/>${moons}${monogramGroup()}</svg>\n` },
  ];
}

function main(): void {
  for (const f of renderFavicons()) {
    writeFileSync(join(WEB_DIR, f.path), f.svg);
    console.log(`${f.path.padEnd(20)} ${(f.svg.length / 1024).toFixed(1).padStart(5)} KiB`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
