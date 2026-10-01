/**
 * Renderer visual regression.
 *
 * The published sample code (docs/vectors/code01-sample.json: O26-J-00184,
 * public sample key) in its four presentations, and its genome in the row and
 * orbit layouts, are rasterised with resvg at fixed sizes and compared with
 * the committed baselines in ./baselines/ (8-bit grayscale PNG):
 *
 *   - mean absolute difference < MAX_MEAN levels over the whole image, and
 *   - no BLOCK×BLOCK region whose mean absolute difference reaches
 *     MAX_BLOCK levels (a single flipped data cell or a moved glyph is a
 *     local change the global mean would dilute).
 *
 * The thresholds absorb anti-aliasing differences between resvg builds and
 * platforms; any geometric change to a machine-critical layer exceeds them.
 *
 *   UPDATE_BASELINES=1 npx vitest run test/visual/renderer.test.ts
 *
 * rewrites the baselines (review the PNG diff before committing). On a
 * mismatch the actual image and an amplified difference image are written to
 * genome/out/visual/ (git-ignored).
 *
 * Structural invariants of the SVG documents are asserted independently of
 * any baseline, and so are cross-rendition raster invariants: the inverted
 * rendition is the tonal negative of the classic one, ivory is its affine
 * remap, and removing the decor changes pixels only on the hairline rings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../../src/core/bytes.js';
import {
  CODE01,
  CODE01_FORMAT_CELLS,
  CODE01_RINGS,
  CODE01_SIZE,
  ORBES_CODE_STYLES,
  encodeOrbesCode,
  renderOrbesCodeSvg,
  type OrbesCodeModel,
} from '../../src/core/code/index.js';
import { computeGenome, genomeGlyphPrimitives, renderGenomeSvg, type Genome } from '../../src/core/genome/index.js';
import { packIdentity, type ProductIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage } from '../../src/core/payload.js';
import { readImage, writePng } from '../support/image-io.js';
import { createGray, luma601, svgToGray, type GrayImage } from '../support/raster.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = join(HERE, 'baselines');
const DIFF_DIR = join(HERE, '..', '..', 'out', 'visual');
const VECTORS = join(HERE, '..', '..', '..', 'docs', 'vectors', 'code01-sample.json');
const UPDATE = process.env.UPDATE_BASELINES === '1';

const MAX_MEAN = 0.5;
const BLOCK = 8;
const MAX_BLOCK = 6;

// ── The published sample (identical inputs to scripts/spec-vectors.ts) ────

const SAMPLE_SECRET_KEY = sha256(utf8('ORBES CODE-01 public sample key - never valid in production'));
const SAMPLE_IDENTITY: ProductIdentity = { year: 2026, categoryIndex: 1, serial: 184 };

function sampleCode(decor = true): { model: OrbesCodeModel; genome: Genome; data: Uint8Array } {
  const payload = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: 1,
    identity: SAMPLE_IDENTITY,
    issue: 1,
    issuedDay: issuedDayFromDate(new Date(Date.UTC(2026, 0, 15))),
    nonce: Uint8Array.of(0x4f, 0x52, 0x42, 0x53),
  });
  const data = frameCodeData(payload, ed25519.sign(signingMessage(payload), SAMPLE_SECRET_KEY));
  const genome = computeGenome(packIdentity(SAMPLE_IDENTITY));
  return { model: encodeOrbesCode({ data, genomeGlyphs: genome.glyphs }, { decor }), genome, data };
}

const SAMPLE = sampleCode();
const CODE_PX = 256;

interface Case {
  name: string;
  svg: string;
  widthPx: number;
}

const CASES: readonly Case[] = [
  { name: 'code-classic', svg: renderOrbesCodeSvg(SAMPLE.model, ORBES_CODE_STYLES.classic), widthPx: CODE_PX },
  { name: 'code-inverted', svg: renderOrbesCodeSvg(SAMPLE.model, ORBES_CODE_STYLES.inverted), widthPx: CODE_PX },
  { name: 'code-ivory', svg: renderOrbesCodeSvg(SAMPLE.model, ORBES_CODE_STYLES.ivory), widthPx: CODE_PX },
  { name: 'code-no-decor', svg: renderOrbesCodeSvg(SAMPLE.model, { ...ORBES_CODE_STYLES.classic, decor: false }), widthPx: CODE_PX },
  { name: 'genome-row', svg: renderGenomeSvg(SAMPLE.genome, { layout: 'row' }), widthPx: 512 },
  { name: 'genome-orbit', svg: renderGenomeSvg(SAMPLE.genome, { layout: 'orbit' }), widthPx: 256 },
];

const raster = new Map<string, GrayImage>();
function render(c: Case): GrayImage {
  let img = raster.get(c.name);
  if (!img) {
    img = svgToGray(c.svg, { widthPx: c.widthPx });
    raster.set(c.name, img);
  }
  return img;
}
const caseNamed = (name: string): Case => CASES.find((c) => c.name === name)!;

// ── Image comparison ───────────────────────────────────────────────────────

interface Diff {
  mean: number;
  maxBlock: number;
  maxPixel: number;
  worstBlock: { x: number; y: number };
}

function compare(a: GrayImage, b: GrayImage): Diff {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  const { width: w, height: h } = a;
  let sum = 0;
  let maxPixel = 0;
  let maxBlock = 0;
  let worstBlock = { x: 0, y: 0 };
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    sum += d;
    if (d > maxPixel) maxPixel = d;
  }
  for (let by = 0; by < h; by += BLOCK) {
    for (let bx = 0; bx < w; bx += BLOCK) {
      let s = 0;
      let n = 0;
      for (let y = by; y < Math.min(h, by + BLOCK); y++) {
        for (let x = bx; x < Math.min(w, bx + BLOCK); x++) {
          s += Math.abs(a.data[y * w + x] - b.data[y * w + x]);
          n++;
        }
      }
      if (s / n > maxBlock) {
        maxBlock = s / n;
        worstBlock = { x: bx, y: by };
      }
    }
  }
  return { mean: sum / a.data.length, maxBlock, maxPixel, worstBlock };
}

function diffImage(a: GrayImage, b: GrayImage): GrayImage {
  const out = createGray(a.width, a.height, 255);
  for (let i = 0; i < out.data.length; i++) out.data[i] = 255 - Math.min(255, 4 * Math.abs(a.data[i] - b.data[i]));
  return out;
}

// ── Baselines ──────────────────────────────────────────────────────────────

describe('renderer visual regression (resvg rasters vs committed baselines)', () => {
  for (const c of CASES) {
    it(`${c.name} matches its baseline`, () => {
      const actual = render(c);
      const path = join(BASELINES, `${c.name}.png`);
      if (UPDATE) {
        writePng(path, actual);
        return;
      }
      if (!existsSync(path)) throw new Error(`missing baseline ${path}: run UPDATE_BASELINES=1 npx vitest run test/visual/renderer.test.ts`);
      const baseline = readImage(path);
      const d = compare(actual, baseline);
      if (d.mean >= MAX_MEAN || d.maxBlock >= MAX_BLOCK) {
        writePng(join(DIFF_DIR, `${c.name}-actual.png`), actual);
        writePng(join(DIFF_DIR, `${c.name}-diff.png`), diffImage(actual, baseline));
      }
      expect(d.mean, `${c.name}: mean abs diff (see out/visual/)`).toBeLessThan(MAX_MEAN);
      expect(d.maxBlock, `${c.name}: worst ${BLOCK}×${BLOCK} block at ${d.worstBlock.x},${d.worstBlock.y}`).toBeLessThan(MAX_BLOCK);
    });
  }

  it('keeps the baselines small, grayscale and at the documented sizes', () => {
    for (const c of CASES) {
      const path = join(BASELINES, `${c.name}.png`);
      const bytes = readFileSync(path);
      expect(bytes.length, c.name).toBeLessThan(40_000);
      // IHDR: width, height, bit depth 8, colour type 0 (grayscale).
      expect(bytes.readUInt32BE(16), c.name).toBe(c.widthPx);
      expect(bytes[24], c.name).toBe(8);
      expect(bytes[25], c.name).toBe(0);
    }
  });

  it('detects a single flipped data cell (the block threshold is not diluted by the image size)', () => {
    // The independent arc model reproduces the encoder's raster exactly…
    const same = { ...SAMPLE.model, primitives: encodeWithCells(SAMPLE.model.cells) };
    expect(compare(svgToGray(renderOrbesCodeSvg(same, ORBES_CODE_STYLES.classic), { widthPx: CODE_PX }), render(caseNamed('code-classic'))).maxPixel).toBe(0);
    // …so any difference below comes from the flipped cell alone.
    const cells = SAMPLE.model.cells.slice();
    const ring = CODE01_RINGS[8];
    const flat = ring.offset + 17;
    cells[flat] ^= 1;
    const flipped = { ...SAMPLE.model, cells, primitives: encodeWithCells(cells) };
    const d = compare(svgToGray(renderOrbesCodeSvg(flipped, ORBES_CODE_STYLES.classic), { widthPx: CODE_PX }), render(caseNamed('code-classic')));
    expect(d.mean).toBeLessThan(MAX_MEAN); // the global mean alone would miss it…
    expect(d.maxBlock).toBeGreaterThanOrEqual(MAX_BLOCK); // …the region metric does not.
  });

  it('detects an arc-thickness drift of 0.05 u through the global mean', () => {
    const scaled = SAMPLE.model.primitives.map((p) => (p.kind === 'arc' && (p.layer === 'data' || p.layer === 'format') ? { ...p, width: p.width + 0.05 } : p));
    const d = compare(svgToGray(renderOrbesCodeSvg({ ...SAMPLE.model, primitives: scaled }, ORBES_CODE_STYLES.classic), { widthPx: CODE_PX }), render(caseNamed('code-classic')));
    expect(d.mean).toBeGreaterThanOrEqual(MAX_MEAN);
  });
});

/** Primitives of the sample with a modified cell array (same genome, same decor). */
function encodeWithCells(cells: Uint8Array): OrbesCodeModel['primitives'] {
  // The encoder derives primitives from cells; re-run its primitive stage through a forced model.
  const base = SAMPLE.model;
  const others = base.primitives.filter((p) => p.layer !== 'format' && p.layer !== 'data');
  const arcs = cellArcs(cells);
  // Keep the paint order: decor, seal, moon, polaris, format, data, genome.
  const order = ['decor', 'seal', 'moon', 'polaris'];
  return [...others.filter((p) => order.includes(p.layer)), ...arcs, ...others.filter((p) => p.layer === 'genome')];
}

// ── Independent model of the cell arcs (ORBES-CODE-SPEC §8.1) ──────────────

const FORMAT_SET = new Set(CODE01_FORMAT_CELLS.flat());

interface Run {
  ring: number;
  start: number;
  length: number;
  layer: 'format' | 'data';
}

/** Maximal cyclic runs of ink cells of one layer per ring, re-derived from the spec, not from the encoder. */
function inkRuns(cells: Uint8Array): Run[] {
  const runs: Run[] = [];
  for (const ring of CODE01_RINGS) {
    const key = (c: number): number => {
      const flat = ring.offset + (((c % ring.cells) + ring.cells) % ring.cells);
      return cells[flat] === 0 ? 0 : FORMAT_SET.has(flat) ? 2 : 1;
    };
    const n = ring.cells;
    // Start scanning at a boundary so cyclic runs are not split.
    let origin = 0;
    while (origin < n && key(origin) === key(origin - 1)) origin++;
    if (origin === n) {
      if (key(0) !== 0) runs.push({ ring: ring.index, start: 0, length: n, layer: key(0) === 2 ? 'format' : 'data' });
      continue;
    }
    let c = origin;
    while (c < origin + n) {
      const k = key(c);
      let len = 1;
      while (len < n && key(c + len) === k && c + len < origin + n) len++;
      if (k !== 0) runs.push({ ring: ring.index, start: c % n, length: len, layer: k === 2 ? 'format' : 'data' });
      c += len;
    }
  }
  return runs;
}

function cellArcs(cells: Uint8Array): OrbesCodeModel['primitives'] {
  const runs = inkRuns(cells);
  const prim = (r: Run): OrbesCodeModel['primitives'][number] => {
    const ring = CODE01_RINGS[r.ring];
    const step = (2 * Math.PI) / ring.cells;
    return r.length === ring.cells
      ? { kind: 'ring', layer: r.layer, cx: 0, cy: 0, r: ring.radius, width: CODE01.data.arcThickness }
      : { kind: 'arc', layer: r.layer, cx: 0, cy: 0, r: ring.radius, width: CODE01.data.arcThickness, start: r.start * step, end: (r.start + r.length) * step, cap: 'round' };
  };
  return [...runs.filter((r) => r.layer === 'format').map(prim), ...runs.filter((r) => r.layer === 'data').map(prim)];
}

// ── SVG structure ──────────────────────────────────────────────────────────

function layerGroups(svg: string): { layer: string; paths: string[] }[] {
  const groups: { layer: string; paths: string[] }[] = [];
  const re = /<g data-layer="([a-z]+)">\n([\s\S]*?)\n<\/g>/g;
  for (let m = re.exec(svg); m; m = re.exec(svg)) groups.push({ layer: m[1], paths: m[2].split('\n') });
  return groups;
}

function mixHex(ink: string, paper: string, tone: number): string {
  const p = (s: string, i: number): number => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(paper, i) + (p(ink, i) - p(paper, i)) * tone).toString(16).padStart(2, '0')).join('')}`;
}

describe('CODE-01 SVG structural invariants', () => {
  it('renders the published sample vector (its codeword is the one in docs/vectors)', () => {
    const vectors = JSON.parse(readFileSync(VECTORS, 'utf8')) as { codewordHex: string; framedDataHex: string; genome: { glyphs: number[] }; publicKeyHex: string };
    expect(toHex(SAMPLE.model.codeword)).toBe(vectors.codewordHex);
    expect(toHex(SAMPLE.data)).toBe(vectors.framedDataHex);
    expect(SAMPLE.genome.glyphs).toEqual(vectors.genome.glyphs);
    expect(toHex(ed25519.getPublicKey(SAMPLE_SECRET_KEY))).toBe(vectors.publicKeyHex);
  });

  it('has the documented root, background and ink, and nothing but filled paths', () => {
    const svg = caseNamed('code-classic').svg;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-25 -25 50 50">\n<title>ORBES CODE-01</title>\n')).toBe(true);
    expect(svg).toContain('<rect x="-25" y="-25" width="50" height="50" fill="#FFFFFF"/>');
    expect(svg).toContain('<g fill="#0A0A0A">');
    for (const banned of ['stroke', '<text', '<image', 'transform', 'style=', 'fill-opacity', '<use', 'href']) expect(svg, banned).not.toContain(banned);
    const elements = svg.match(/<([a-z]+)/g)!.map((t) => t.slice(1));
    expect(new Set(elements)).toEqual(new Set(['svg', 'title', 'rect', 'g', 'path']));
  });

  it('paints the layers in the specified order (§8.2), decor first and only when enabled', () => {
    expect(layerGroups(caseNamed('code-classic').svg).map((g) => g.layer)).toEqual(['decor', 'seal', 'moon', 'polaris', 'format', 'data', 'genome']);
    expect(layerGroups(caseNamed('code-no-decor').svg).map((g) => g.layer)).toEqual(['seal', 'moon', 'polaris', 'format', 'data', 'genome']);
  });

  it('draws exactly one arc per maximal ink run, re-derived from the cells and the spec', () => {
    const groups = new Map(layerGroups(caseNamed('code-classic').svg).map((g) => [g.layer, g.paths]));
    const runs = inkRuns(SAMPLE.model.cells);
    expect(groups.get('decor')).toHaveLength(3);
    expect(groups.get('seal')).toHaveLength(2);
    expect(groups.get('moon')).toHaveLength(4);
    expect(groups.get('polaris')).toHaveLength(1);
    expect(groups.get('format')).toHaveLength(runs.filter((r) => r.layer === 'format').length);
    expect(groups.get('data')).toHaveLength(runs.filter((r) => r.layer === 'data').length);
    const glyphPrims = SAMPLE.genome.glyphs.reduce((n, g) => n + genomeGlyphPrimitives(g, 0, 0, CODE01.genome.glyphRadius).length, 0);
    expect(groups.get('genome')).toHaveLength(glyphPrims);
    // Every inked cell is covered by exactly one run.
    const inked = Array.from(SAMPLE.model.cells).reduce((n, v) => n + v, 0);
    expect(runs.reduce((n, r) => n + r.length, 0)).toBe(inked);
  });

  it('fills holes even-odd on rings only, pre-mixes decor tones, keeps 3-decimal coordinates', () => {
    const svg = caseNamed('code-classic').svg;
    const groups = new Map(layerGroups(svg).map((g) => [g.layer, g.paths]));
    const holed = SAMPLE.model.primitives.filter((p) => p.kind === 'ring' && p.r - p.width / 2 > 0).length;
    expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(holed);
    // Decor tones 0.35 and 0.25 of #0A0A0A on white, as opaque colours.
    const decorFills = groups.get('decor')!.map((p) => /fill="(#[0-9a-f]{6})"/.exec(p)?.[1]);
    expect(decorFills).toEqual([mixHex('#0A0A0A', '#FFFFFF', 0.35), mixHex('#0A0A0A', '#FFFFFF', 0.25), mixHex('#0A0A0A', '#FFFFFF', 0.25)]);
    for (const n of svg.match(/-?\d+\.\d+/g) ?? []) expect(n.split('.')[1].length).toBeLessThanOrEqual(3);
    expect(svg).not.toMatch(/[^\d.]-0[^.\d]/);
  });

  it('changes only colours between presentations: the geometry is byte-identical', () => {
    const strip = (svg: string): string => svg.replace(/#[0-9A-Fa-f]{6}/g, '#COLOR');
    const classic = strip(caseNamed('code-classic').svg);
    expect(strip(caseNamed('code-inverted').svg)).toBe(classic);
    expect(strip(caseNamed('code-ivory').svg)).toBe(classic);
    // Without decor: the same document minus the decor group.
    expect(strip(caseNamed('code-no-decor').svg)).toBe(classic.replace(/<g data-layer="decor">\n[\s\S]*?\n<\/g>\n/, ''));
  });

  it('is deterministic and sizes physically when asked', () => {
    expect(renderOrbesCodeSvg(sampleCode().model, ORBES_CODE_STYLES.classic)).toBe(caseNamed('code-classic').svg);
    const sized = renderOrbesCodeSvg(SAMPLE.model, { ...ORBES_CODE_STYLES.classic, widthMm: 20 });
    expect(sized).toContain('viewBox="-25 -25 50 50" width="20mm" height="20mm"');
  });
});

describe('GENOME SVG structural invariants', () => {
  it('row: eight glyph groups separated by seven decor points, in reading order', () => {
    const svg = caseNamed('genome-row').svg;
    expect(svg).toContain('<title>ORBES GENOME G1-E1DC-BE52</title>');
    expect(svg).toContain('viewBox="-1.7 -1.7 27.2 3.4"');
    const layers = layerGroups(svg).map((g) => g.layer);
    expect(layers).toEqual(Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 'genome' : 'decor')));
    const groups = layerGroups(svg);
    SAMPLE.genome.glyphs.forEach((g, i) => expect(groups[2 * i].paths).toHaveLength(genomeGlyphPrimitives(g, 0, 0, 1).length));
  });

  it('orbit: the seal, then each glyph followed by its separator, glyph 0 at north', () => {
    const svg = caseNamed('genome-orbit').svg;
    const layers = layerGroups(svg).map((g) => g.layer);
    expect(layers).toEqual(['seal', ...Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 'genome' : 'decor'))]);
    const edge = CODE01.genome.orbitRadius + CODE01.genome.glyphRadius + 1.25;
    expect(svg).toContain(`viewBox="-${edge} -${edge} ${2 * edge} ${2 * edge}"`);
  });
});

// ── Cross-rendition raster invariants ──────────────────────────────────────

describe('cross-rendition raster invariants', () => {
  const classic = (): GrayImage => render(caseNamed('code-classic'));

  it('inverted is the exact tonal negative of classic (ink and paper swapped)', () => {
    const a = classic();
    const b = render(caseNamed('code-inverted'));
    const ink = luma601(0x0a, 0x0a, 0x0a);
    let worst = 0;
    for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] + b.data[i] - (255 + ink)));
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('ivory is the affine remap of classic onto #111111 / #F6F2EA', () => {
    const a = classic();
    const b = render(caseNamed('code-ivory'));
    const inkC = luma601(0x0a, 0x0a, 0x0a);
    const ink = luma601(0x11, 0x11, 0x11);
    const paper = luma601(0xf6, 0xf2, 0xea);
    let worst = 0;
    for (let i = 0; i < a.data.length; i++) {
      const coverage = (255 - a.data[i]) / (255 - inkC);
      worst = Math.max(worst, Math.abs(b.data[i] - (paper + (ink - paper) * coverage)));
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('removing the decor changes pixels only on the three hairline rings, never machine-critical ink', () => {
    const a = classic();
    const b = render(caseNamed('code-no-decor'));
    const pxPerU = CODE_PX / CODE01_SIZE;
    let changed = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const i = y * a.width + x;
        if (a.data[i] === b.data[i]) continue;
        changed++;
        expect(b.data[i]).toBeGreaterThan(a.data[i]); // decor only ever adds ink
        const r = Math.hypot((x + 0.5) / pxPerU - CODE01_SIZE / 2, (y + 0.5) / pxPerU - CODE01_SIZE / 2);
        const nearest = Math.min(...[9.5, 23.5, 24].map((h) => Math.abs(r - h)));
        expect(nearest, `pixel ${x},${y} at r = ${r.toFixed(2)} u`).toBeLessThan(0.08 + 1 / pxPerU);
      }
    }
    expect(changed).toBeGreaterThan(0);
  });
});
