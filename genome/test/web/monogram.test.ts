/**
 * The ORBES monogram (BRAND-DESIGN-SYSTEM §3.9): the master's five outlines,
 * carried verbatim by the core (src/core/render/monogram.ts) and drawn the
 * same everywhere the brand put it. Checked here: the paths are the master
 * file's; the ink box; the absolute path data the card's PDF draws covers the
 * very pixels of the master; the on-screen markup (an image named ORBES, or
 * decorative beside the typed word); the two tab icons, byte for byte what
 * scripts/favicons.ts writes. Its presence on each screen is in the brand
 * tests of both apps, on the card in test/render/certificate.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAVICON, renderFavicons, WEB_DIR } from '../../scripts/favicons.js';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import {
  absoluteSegments,
  MONOGRAM_ARTBOARD,
  MONOGRAM_BOUNDS,
  MONOGRAM_LABEL,
  MONOGRAM_PATHS,
  monogramHeight,
  monogramPathData,
  pathBounds,
} from '../../src/core/render/monogram.js';
import { monogramMarkup } from '../../src/web/shared/monogram.js';
import { svgToGray } from '../support/raster.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = readFileSync(join(HERE, '../../../docs/assets/brand/orbes-monogram.svg'), 'utf8');

/** Every x, y reached by absolute path data (end points and control points of M, L, C). */
function coordinates(d: string): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of absoluteSegments(d)) {
    if (s[0] === 'Z') continue;
    const n = s.slice(1) as number[];
    for (let i = 0; i < n.length; i += 2) {
      xs.push(n[i]);
      ys.push(n[i + 1]);
    }
  }
  return { xs, ys };
}

describe('the monogram master (docs/assets/brand/orbes-monogram.svg)', () => {
  it('carries the five outlines of the master file, verbatim and in order, on its 500 × 500 artboard', () => {
    const paths = [...MASTER.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toHaveLength(5);
    expect(MONOGRAM_PATHS).toEqual(paths);
    const vb = /viewBox="([^"]+)"/.exec(MASTER)![1].split(/\s+/).map(Number);
    expect(vb).toEqual([MONOGRAM_ARTBOARD.x, MONOGRAM_ARTBOARD.y, MONOGRAM_ARTBOARD.w, MONOGRAM_ARTBOARD.h]);
    // One colour, no text, no image: the master is outlines only.
    expect(new Set([...MASTER.matchAll(/fill:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase()))).toEqual(new Set(['#1d1d1b']));
    expect(MASTER).not.toMatch(/<(text|image|use|linearGradient|radialGradient)\b/);
    expect(MONOGRAM_LABEL).toBe('ORBES');
  });

  it('knows its ink box: the outer edge of the O, about 414 × 317 units, 1.31 times wider than tall', () => {
    expect(MONOGRAM_BOUNDS).toEqual({ x: 42.9, y: 100.15, w: 414.42, h: 316.54 });
    const exact = pathBounds(MONOGRAM_PATHS);
    // Rounded outward by less than 0.01 unit.
    const gaps = [
      exact.x - MONOGRAM_BOUNDS.x,
      exact.y - MONOGRAM_BOUNDS.y,
      MONOGRAM_BOUNDS.x + MONOGRAM_BOUNDS.w - (exact.x + exact.w),
      MONOGRAM_BOUNDS.y + MONOGRAM_BOUNDS.h - (exact.y + exact.h),
    ];
    for (const g of gaps) {
      expect(g).toBeGreaterThan(-1e-9);
      expect(g).toBeLessThan(0.01);
    }
    // The O alone sets the box: the four letters sit inside it.
    expect(pathBounds([MONOGRAM_PATHS[0]])).toEqual(exact);
    for (const d of MONOGRAM_PATHS.slice(1)) {
      const b = pathBounds([d]);
      expect(b.x).toBeGreaterThan(exact.x);
      expect(b.x + b.w).toBeLessThan(exact.x + exact.w);
    }
    expect(monogramHeight(MONOGRAM_BOUNDS.w)).toBeCloseTo(MONOGRAM_BOUNDS.h, 9);
    expect(monogramHeight(14.4)).toBeCloseTo(11, 2);
  });
});

describe('absolute path data (what the certificate card draws)', () => {
  it('reads relative, implicit and smooth commands, and refuses those it does not know', () => {
    expect(absoluteSegments('M1,2l3 4 5 6h1v-1H0V0z')).toEqual([
      ['M', 1, 2],
      ['L', 4, 6],
      ['L', 9, 12],
      ['L', 10, 12],
      ['L', 10, 11],
      ['L', 0, 11],
      ['L', 0, 0],
      ['Z'],
    ]);
    // S reflects the previous C's second control point about the current point.
    expect(absoluteSegments('M0 0C0 10 10 10 10 0s10-10 10 0')).toEqual([
      ['M', 0, 0],
      ['C', 0, 10, 10, 10, 10, 0],
      ['C', 10, -10, 20, -10, 20, 0],
    ]);
    // Implicit line-tos after a relative M; numbers glued by their sign or their point.
    expect(absoluteSegments('m1 1 2 2-.5.5')).toEqual([['M', 1, 1], ['L', 3, 3], ['L', 2.5, 3.5]]);
    expect(() => absoluteSegments('M0 0A1 1 0 0 1 2 2')).toThrow(RangeError);
    expect(() => absoluteSegments('M0 0Q1 1 2 2')).toThrow(RangeError);
    expect(() => absoluteSegments('5 5')).toThrow(RangeError);
  });

  it('places the ink box exactly where it is asked, in M, L, C and Z only, deterministically', () => {
    const place = { x: 64.6, y: 6.4, width: 14.4 };
    const paths = monogramPathData(place);
    expect(paths).toHaveLength(5);
    for (const d of paths) {
      expect(d).toMatch(/^M[-\d. ]+(?:[MLCZ][-\d. ]*)+$/);
      expect(d).not.toMatch(/\d\.\d{4}/); // three decimals at most
    }
    const all = paths.map(coordinates);
    const xs = all.flatMap((c) => c.xs);
    const ys = all.flatMap((c) => c.ys);
    // Control points never leave the box by more than the curves' own bulge; end points stay inside.
    const box = pathBounds(paths);
    expect(box.x).toBeCloseTo(place.x, 2);
    expect(box.y).toBeCloseTo(place.y, 2);
    expect(box.w).toBeCloseTo(place.width, 2);
    expect(box.h).toBeCloseTo(monogramHeight(place.width), 2);
    expect(Math.min(...xs)).toBeGreaterThan(place.x - 0.5);
    expect(Math.max(...ys)).toBeLessThan(place.y + monogramHeight(place.width) + 0.5);
    expect(monogramPathData(place)).toEqual(paths);
    expect(() => monogramPathData({ x: 0, y: 0, width: 0 })).toThrow(RangeError);
  });

  it('covers the very pixels of the master: the conversion changes no shape', () => {
    const b = MONOGRAM_BOUNDS;
    const svg = (paths: readonly string[]) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500"><g fill="#000">${paths.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;
    // Placed on the master's own coordinates (scale 1), so only the conversion can differ.
    const converted = monogramPathData({ x: b.x, y: b.y, width: b.w });
    const a = svgToGray(svg(MONOGRAM_PATHS), { widthPx: 1000 });
    const c = svgToGray(svg(converted), { widthPx: 1000 });
    let worst = 0;
    let ink = 0;
    for (let i = 0; i < a.data.length; i++) {
      worst = Math.max(worst, Math.abs(a.data[i] - c.data[i]));
      if (a.data[i] < 128) ink++;
    }
    expect(ink).toBeGreaterThan(50_000); // the comparison is about real ink
    // Antialiasing of edges moved by at most 0.0005 unit (3 decimals): a few levels, never a pixel's worth.
    expect(worst).toBeLessThanOrEqual(8);
  });
});

describe('the monogram on screen (src/web/shared/monogram.ts)', () => {
  it('is an image named ORBES when it stands alone, in currentColor, cropped to its ink', () => {
    const svg = monogramMarkup();
    const b = MONOGRAM_BOUNDS;
    expect(svg).toMatch(new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" class="monogram" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" fill="currentColor" focusable="false" role="img" aria-label="ORBES">`));
    expect([...svg.matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])).toEqual(MONOGRAM_PATHS);
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b|style=|<title|<text/i);
  });

  it('is decorative beside the typed word: hidden from assistive technology, never named twice', () => {
    const svg = monogramMarkup({ class: 'landing__monogram', decorative: true });
    expect(svg).toContain('class="monogram landing__monogram"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toMatch(/role=|aria-label=/);
    expect(() => monogramMarkup({ class: 'x" onload="alert(1)' })).toThrow();
  });
});

describe('tab icons (scripts/favicons.ts)', () => {
  const files = renderFavicons();

  it('the committed favicons are byte for byte what scripts/favicons.ts produces (run it after any change)', () => {
    expect(files.map((f) => f.app)).toEqual(['verify', 'admin']);
    for (const f of files) {
      expect(readFileSync(join(WEB_DIR, f.path), 'utf8'), `${f.path} is stale: run npx tsx scripts/favicons.ts`).toBe(f.svg);
    }
    expect(renderFavicons()).toEqual(files);
  });

  it('draw the monogram master in ink, 26 of 32 units wide and centred', () => {
    for (const f of files) {
      const group = /<g fill="([^"]+)" transform="matrix\(([^)]+)\)">((?:<path d="[^"]+"\/>)+)<\/g>/.exec(f.svg);
      expect(group, f.app).not.toBeNull();
      expect(group![1]).toBe(FAVICON.ink);
      expect([...group![3].matchAll(/d="([^"]+)"/g)].map((m) => m[1])).toEqual(MONOGRAM_PATHS);
      const [k, , , k2, tx, ty] = group![2].split(' ').map(Number);
      expect(k2).toBe(k);
      const b = MONOGRAM_BOUNDS;
      expect(b.w * k).toBeCloseTo(FAVICON.monogramWidth, 3);
      expect(tx + (b.x + b.w / 2) * k).toBeCloseTo(FAVICON.size / 2, 3);
      expect(ty + (b.y + b.h / 2) * k).toBeCloseTo(FAVICON.size / 2, 3);
      expect(f.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
    }
  });

  it('keep the two apps apart: /verify on a white disc, the console on ivory with four corner moons', () => {
    const [verify, admin] = files;
    expect(verify.svg).toContain(`<circle cx="16" cy="16" r="15" fill="#ffffff"/>`);
    expect(verify.svg).not.toContain('<rect');
    expect(admin.svg).toContain(`<rect width="32" height="32" fill="${ORBES_CODE_STYLES.ivory.paper.toLowerCase()}"/>`);
    const moons = [...admin.svg.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="2" fill="#0a0a0a"\/>/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(moons).toEqual([[4, 4], [28, 4], [28, 28], [4, 28]]);
    // The moons stay clear of the O: its ink box ends 3 units from the edges, its curve further in at the corners.
    const half = FAVICON.monogramWidth / 2;
    const r45 = (half * monogramHeight(half)) / Math.sqrt((half ** 2 + monogramHeight(half) ** 2) / 2);
    expect(Math.hypot(12, 12) - FAVICON.moonRadius - r45).toBeGreaterThan(3);
  });
});
