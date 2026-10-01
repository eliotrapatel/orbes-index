/**
 * GENOME-01 symbol study.
 *
 * Measures how distinct the vocabulary candidates remain when printed small
 * and photographed badly, selects the 16-glyph set that stays most distinct,
 * and documents the frozen GENOME-01 vocabulary.
 *
 *   npx tsx scripts/genome-symbol-study.ts
 *
 * Writes docs/reports/genome-symbol-study.md and
 * docs/assets/genome-01-vocabulary.svg. Fully deterministic (resvg rendering,
 * seeded PRNG): re-running it reproduces both files byte for byte.
 *
 * Method
 *   1. Every candidate is rasterised with resvg at glyph diameters of 8, 10,
 *      12, 16 and 24 px, centred in a patch 1.3× its diameter, under
 *      27 jitters: rotation −5°/0°/+5° × offsets −0.5/0/+0.5 px on each axis.
 *   2. Each render is blurred with a Gaussian of σ = 0.6, 0.8 or 1.0 px and
 *      normalised to zero mean and unit energy.
 *   3. Dissimilarity of A and B at one size = 1 − NCC, taken at the WORST
 *      case: the highest correlation between the upright reference of one
 *      glyph and any jittered render of the other, over all blurs.
 *   4. Selection: over every systematic structure (s symmetric forms + f
 *      oriented families × 4 orientations = 16), maximise the minimum
 *      pairwise dissimilarity at 10–12 px; ties are broken leximin (then the
 *      second-closest pair, and so on).
 *   5. Validation: Monte-Carlo nearest-template classification of the frozen
 *      set with random rotation, offset, blur, contrast and sensor noise.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { CODE01 } from '../src/core/code/profile.js';
import { computeGenome } from '../src/core/genome/genome.js';
import { genomeLayout, type GenomeLayout } from '../src/core/genome/render.js';
import {
  GENOME01_GLYPHS,
  GENOME_GLYPH_CANDIDATES,
  SYMMETRIC_FAMILY,
  type GlyphCandidate,
  type GlyphDef,
} from '../src/core/genome/vocabulary.js';
import type { Primitive } from '../src/core/geometry.js';
import { primitiveToPathData } from '../src/core/render/svg.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT_PATH = resolve(ROOT, 'docs/reports/genome-symbol-study.md');
const SPECIMEN_PATH = resolve(ROOT, 'docs/assets/genome-01-vocabulary.svg');

/** Glyph diameters studied, in pixels. */
const SIZES = [8, 10, 12, 16, 24];
/** Diameters the selection optimises for: about 3 px per CODE-01 cell, the usual lower limit for sampling a cell code. */
const SELECTION_SIZES = [10, 12];
const BLURS = [0.6, 0.8, 1.0];
const ROTATIONS_DEG = [-5, 0, 5];
const OFFSETS_PX = [-0.5, 0, 0.5];
/** Patch side relative to the glyph diameter: the glyph plus part of its quiet surround. */
const PATCH_SCALE = 1.3;
/** Extra rendered border so blur near the patch edge sees real background. */
const BLUR_PAD = 4;

const MONTE_CARLO_TRIALS = 200;
/** Sensor noise σ relative to full contrast: a dim phone frame, then a stress level. */
const MONTE_CARLO_NOISE = [0.06, 0.15];
const MONTE_CARLO_SEED = 0x0b5e_5eed;

type Patch = Float64Array;

interface Jitter {
  rotation: number;
  dx: number;
  dy: number;
}

const JITTERS: Jitter[] = ROTATIONS_DEG.flatMap((rotation) =>
  OFFSETS_PX.flatMap((dy) => OFFSETS_PX.map((dx) => ({ rotation, dx, dy }))),
);
const UPRIGHT = JITTERS.findIndex((j) => j.rotation === 0 && j.dx === 0 && j.dy === 0);

// ── Rendering ───────────────────────────────────────────────────────────────

function patchSide(size: number): number {
  const margin = Math.ceil(((PATCH_SCALE - 1) / 2) * size);
  return size + 2 * margin;
}

/** Ink coverage (0 = paper, 1 = ink) of a glyph rendered with resvg, padded by BLUR_PAD. */
function renderInk(glyph: GlyphCandidate, size: number, jitter: Jitter): Float64Array {
  const side = patchSide(size) + 2 * BLUR_PAD;
  const half = side / 2;
  const paths = glyph
    .primitives(0, 0, size / 2)
    .map((p) => `<path d="${primitiveToPathData(p)}"/>`)
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-half} ${-half} ${side} ${side}" width="${side}" height="${side}">` +
    `<rect x="${-half}" y="${-half}" width="${side}" height="${side}" fill="#fff"/>` +
    `<g fill="#000" transform="translate(${jitter.dx} ${jitter.dy}) rotate(${jitter.rotation})">${paths}</g></svg>`;
  const rgba = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;
  const ink = new Float64Array(side * side);
  for (let i = 0; i < ink.length; i++) ink[i] = 1 - rgba[4 * i] / 255;
  return ink;
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += k[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  return k.map((v) => v / sum);
}

/** Separable Gaussian blur of a square image (zero ink outside), cropped by BLUR_PAD. */
function blurAndCrop(ink: Float64Array, side: number, sigma: number): Float64Array {
  const k = gaussianKernel(sigma);
  const radius = (k.length - 1) / 2;
  const pass = (src: Float64Array, horizontal: boolean): Float64Array => {
    const dst = new Float64Array(src.length);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        let acc = 0;
        for (let t = -radius; t <= radius; t++) {
          const xx = horizontal ? x + t : x;
          const yy = horizontal ? y : y + t;
          if (xx >= 0 && xx < side && yy >= 0 && yy < side) acc += k[t + radius] * src[yy * side + xx];
        }
        dst[y * side + x] = acc;
      }
    }
    return dst;
  };
  const blurred = pass(pass(ink, true), false);
  const inner = side - 2 * BLUR_PAD;
  const out = new Float64Array(inner * inner);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) out[y * inner + x] = blurred[(y + BLUR_PAD) * side + x + BLUR_PAD];
  }
  return out;
}

/** Zero mean, unit energy: the dot product of two normalised patches is their NCC. */
function normalise(p: Float64Array): Patch {
  const mean = p.reduce((s, v) => s + v, 0) / p.length;
  const centred = p.map((v) => v - mean);
  const norm = Math.sqrt(centred.reduce((s, v) => s + v * v, 0));
  return centred.map((v) => v / norm);
}

function dot(a: Patch, b: Patch): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ── Pairwise dissimilarity ─────────────────────────────────────────────────

/** patches[blur][jitter] for one glyph at one size. */
type GlyphRenders = Patch[][];

function renderGlyph(glyph: GlyphCandidate, size: number): GlyphRenders {
  const side = patchSide(size) + 2 * BLUR_PAD;
  const raw = JITTERS.map((j) => renderInk(glyph, size, j));
  return BLURS.map((sigma) => raw.map((ink) => normalise(blurAndCrop(ink, side, sigma))));
}

/** Worst-case 1 − NCC between two glyphs over blur and jitter, in both template directions. */
function dissimilarity(a: GlyphRenders, b: GlyphRenders): number {
  let best = -1;
  for (let s = 0; s < BLURS.length; s++) {
    for (let j = 0; j < JITTERS.length; j++) {
      best = Math.max(best, dot(a[s][UPRIGHT], b[s][j]), dot(a[s][j], b[s][UPRIGHT]));
    }
  }
  return 1 - best;
}

type Matrix = number[][];

function distanceMatrix(glyphs: readonly GlyphCandidate[], size: number): Matrix {
  const renders = glyphs.map((g) => renderGlyph(g, size));
  const m = glyphs.map(() => glyphs.map(() => 0));
  for (let a = 0; a < glyphs.length; a++) {
    for (let b = a + 1; b < glyphs.length; b++) m[a][b] = m[b][a] = dissimilarity(renders[a], renders[b]);
  }
  return m;
}

// ── Selection ──────────────────────────────────────────────────────────────

function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

interface Selection {
  structure: string;
  members: number[];
  /** Pairwise selection distances, ascending. */
  sorted: number[];
}

/** Leximin order: compare the closest pair first, then the next closest, … */
function leximinBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function selectVocabulary(selectionDistance: Matrix): Selection[] {
  const symmetric = GENOME_GLYPH_CANDIDATES.flatMap((g, i) => (g.family === SYMMETRIC_FAMILY ? [i] : []));
  const families = new Map<string, number[]>();
  GENOME_GLYPH_CANDIDATES.forEach((g, i) => {
    if (g.family !== SYMMETRIC_FAMILY) families.set(g.family, [...(families.get(g.family) ?? []), i]);
  });
  const oriented = [...families.values()].filter((members) => members.length === 4);

  // Every systematic structure: s symmetric forms + f oriented families × 4 = 16 glyphs.
  const results: Selection[] = [];
  for (let familyCount = 0; familyCount * 4 <= 16; familyCount++) {
    const symmetricCount = 16 - 4 * familyCount;
    if (symmetricCount > symmetric.length || familyCount > oriented.length) continue;
    for (const sym of combinations(symmetric, symmetricCount)) {
      for (const fams of combinations(oriented, familyCount)) {
        const members = [...sym, ...fams.flat()];
        const pairs: number[] = [];
        for (let a = 0; a < members.length; a++) {
          for (let b = a + 1; b < members.length; b++) pairs.push(selectionDistance[members[a]][members[b]]);
        }
        results.push({ structure: `${symmetricCount} symmetric + ${familyCount} families`, members, sorted: pairs.sort((x, y) => x - y) });
      }
    }
  }
  return results.sort((a, b) => (leximinBetter(a.sorted, b.sorted) ? -1 : leximinBetter(b.sorted, a.sorted) ? 1 : 0));
}

// ── Monte-Carlo validation ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

interface Classification {
  size: number;
  noise: number;
  accuracy: number;
  confusions: Map<string, number>;
}

/**
 * Nearest-template classification: templates are upright renders at σ = 0.8;
 * each trial applies a random rotation (±5°), offset (±0.5 px), blur
 * (σ 0.6–1.0), contrast (0.5–1.0) and additive Gaussian noise.
 */
function classify(glyphs: readonly GlyphCandidate[], size: number, noise: number, rand: () => number): Classification {
  const side = patchSide(size) + 2 * BLUR_PAD;
  const templates = glyphs.map((g) => normalise(blurAndCrop(renderInk(g, size, JITTERS[UPRIGHT]), side, 0.8)));
  const confusions = new Map<string, number>();
  let correct = 0;
  for (let t = 0; t < MONTE_CARLO_TRIALS; t++) {
    glyphs.forEach((glyph, truth) => {
      const jitter = { rotation: (rand() * 2 - 1) * 5, dx: rand() - 0.5, dy: rand() - 0.5 };
      const contrast = 0.5 + 0.5 * rand();
      const observed = blurAndCrop(renderInk(glyph, size, jitter), side, 0.6 + 0.4 * rand()).map(
        (v) => contrast * v + noise * gaussian(rand),
      );
      const n = normalise(observed);
      let guess = 0;
      let bestScore = -Infinity;
      templates.forEach((tpl, i) => {
        const score = dot(tpl, n);
        if (score > bestScore) [bestScore, guess] = [score, i];
      });
      if (guess === truth) correct++;
      else {
        const key = `${glyph.id} → ${glyphs[guess].id}`;
        confusions.set(key, (confusions.get(key) ?? 0) + 1);
      }
    });
  }
  return { size, noise, accuracy: correct / (MONTE_CARLO_TRIALS * glyphs.length), confusions };
}

// ── Report ─────────────────────────────────────────────────────────────────

const f3 = (v: number): string => v.toFixed(3);
const pct = (v: number): string => `${(100 * v).toFixed(2)} %`;

function pairStats(m: Matrix, members: readonly number[]): { min: number; mean: number; closest: [number, number] } {
  let min = Infinity;
  let sum = 0;
  let count = 0;
  let closest: [number, number] = [members[0], members[1]];
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      const d = m[members[a]][members[b]];
      sum += d;
      count++;
      if (d < min) [min, closest] = [d, [members[a], members[b]]];
    }
  }
  return { min, mean: sum / count, closest };
}

function nearestNeighbour(m: Matrix, i: number, among: readonly number[]): { j: number; d: number } {
  let best = { j: -1, d: Infinity };
  for (const j of among) if (j !== i && m[i][j] < best.d) best = { j, d: m[i][j] };
  return best;
}

function writeReport(
  matrices: Map<number, Matrix>,
  selectionDistance: Matrix,
  ranking: Selection[],
  frozen: number[],
  classifications: Classification[],
): string {
  const ids = GENOME_GLYPH_CANDIDATES.map((g) => g.id);
  const pool = GENOME_GLYPH_CANDIDATES.map((_, i) => i);
  const indexOf = (id: string): number => {
    const i = ids.indexOf(id);
    if (i < 0) throw new Error(`candidate ${id} not in the pool`);
    return i;
  };
  const d = (a: string, b: string): string => f3(selectionDistance[indexOf(a)][indexOf(b)]);
  const winner = ranking[0];
  const frozenSet = new Set(frozen);
  const matches = winner.members.length === frozen.length && winner.members.every((i) => frozenSet.has(i));
  const describe = (r: Selection): string => {
    const sym = r.members.filter((i) => GENOME_GLYPH_CANDIDATES[i].family === SYMMETRIC_FAMILY).map((i) => ids[i]);
    const fams = [...new Set(r.members.map((i) => GENOME_GLYPH_CANDIDATES[i].family).filter((f) => f !== SYMMETRIC_FAMILY))];
    return [...sym, ...fams.map((f) => `${f} ×4`)].join(', ');
  };
  const cellPx = (size: number): string => (size / (2 * CODE01.genome.glyphRadius)).toFixed(1);
  const lines: string[] = [];
  const push = (...l: string[]): void => void lines.push(...l);

  push(
    '# GENOME-01 symbol study',
    '',
    '_Generated by `genome/scripts/genome-symbol-study.ts`. Do not edit by hand: re-run the script._',
    '',
    '## Question',
    '',
    'Which 16 orbital glyphs should form the GENOME-01 vocabulary so that every glyph stays recognisable when a',
    'CODE-01 artifact is printed small and photographed by a phone: few pixels per glyph, defocus blur, slight',
    'rotation and sub-pixel misregistration? The vocabulary must also read as one systematic ORBES family.',
    '',
    '## Method',
    '',
    `- **Candidates.** ${GENOME_GLYPH_CANDIDATES.length} glyphs (\`GENOME_GLYPH_CANDIDATES\` in \`src/core/genome/vocabulary.ts\`):`,
    '  rotation-invariant forms plus oriented families of four, all drawn with one orbit stroke (0.26 R). All ink lies',
    '  within the glyph radius R; every stroke, dot diameter and crescent thickness is at least 0.22 R. Orientations',
    '  are absolute (relative to code north). Figures made of isolated off-centre dots (a lone satellite, a binary',
    '  pair) were excluded before measurement: their orientation can only be read against the glyph grid and they',
    '  are confused with the separator points of a genome.',
    `- **Rendering.** resvg rasterises each candidate at glyph diameters of ${SIZES.join(', ')} px, centred in a patch`,
    `  ${PATCH_SCALE}× the diameter, under ${JITTERS.length} jitters: rotation ${ROTATIONS_DEG.map((r) => `${r}°`).join(' / ')} ×`,
    `  offsets ${OFFSETS_PX.join(' / ')} px on each axis.`,
    `- **Blur.** Each render is convolved with a Gaussian of σ = ${BLURS.join(', ')} px (camera defocus and print spread).`,
    '- **Dissimilarity.** `d(A, B) = 1 − NCC` on zero-mean, unit-energy patches (so print contrast and exposure do not',
    '  matter), taken at the worst case: the highest correlation between the upright reference of one glyph and any',
    '  jittered render of the other, over every blur, in both directions. 0 means indistinguishable, 1 means',
    '  uncorrelated, 2 means inverted.',
    `- **Selection sizes.** ${SELECTION_SIZES.join(' and ')} px glyphs: a CODE-01 glyph spans ${2 * CODE01.genome.glyphRadius} cells, so this is`,
    `  ${SELECTION_SIZES.map(cellPx).join('–')} px per cell, around the usual lower limit (≈ 3 px per cell) for sampling a printed cell code.`,
    '- **Selection.** Over every systematic structure (s symmetric forms + f oriented families × 4 = 16), maximise the',
    '  minimum pairwise dissimilarity at the selection sizes (each pair scored at its worse size). Ties are broken',
    '  leximin: then the second closest pair, and so on.',
    `- **Validation.** Monte-Carlo nearest-template classification of the frozen set: ${MONTE_CARLO_TRIALS} trials per glyph`,
    `  and size with random rotation (±5°), offset (±0.5 px), blur (σ 0.6–1.0 px), contrast (50–100 %) and additive`,
    `  Gaussian noise (σ = ${MONTE_CARLO_NOISE.join(' or ')} of full contrast: a dim phone frame, then a stress level).`,
    '  Templates are upright renders at σ = 0.8 px.',
    '',
    '## Candidates',
    '',
    `Nearest neighbour of every candidate within the whole pool (d at ${SELECTION_SIZES.join('/')} px, worse of the two).`,
    '',
    '| # | id | family | hint | nearest candidate | d | GENOME-01 index |',
    '|---:|---|---|:---:|---|---:|:---:|',
  );
  GENOME_GLYPH_CANDIDATES.forEach((g, i) => {
    const nn = nearestNeighbour(selectionDistance, i, pool);
    const index = frozen.indexOf(i);
    push(`| ${i} | \`${g.id}\` | ${g.family} | ${g.hint} | \`${ids[nn.j]}\` | ${f3(nn.d)} | ${index >= 0 ? index : ''} |`);
  });

  const structures = [...new Set(ranking.map((r) => r.structure))];
  push(
    '',
    '## Selection',
    '',
    `${ranking.length} candidate vocabularies evaluated. Best of each structure:`,
    '',
    '| structure | best vocabulary | min d | 2nd | 3rd |',
    '|---|---|---:|---:|---:|',
    ...structures.map((st) => {
      const r = ranking.find((x) => x.structure === st)!;
      return `| ${st} | ${describe(r)} | ${f3(r.sorted[0])} | ${f3(r.sorted[1])} | ${f3(r.sorted[2])} |`;
    }),
    '',
    'Overall ranking (leximin order):',
    '',
    '| rank | structure | vocabulary | min d | 2nd | 3rd |',
    '|---:|---|---|---:|---:|---:|',
    ...ranking.slice(0, 8).map((r, rank) => `| ${rank + 1} | ${r.structure} | ${describe(r)} | ${f3(r.sorted[0])} | ${f3(r.sorted[1])} | ${f3(r.sorted[2])} |`),
    '',
    matches
      ? 'The frozen GENOME-01 vocabulary is exactly the study winner (rank 1).'
      : '**Warning:** the frozen GENOME-01 vocabulary differs from the current study winner. GENOME-01 is frozen; a better set can only ship as a new genome version.',
    '',
    '## Frozen GENOME-01 vocabulary',
    '',
    'Index order is permanent: the index is the 4-bit value a glyph encodes. Symmetric forms run from the outer',
    'orbit inwards, then each oriented family clockwise from north. Specimen: `docs/assets/genome-01-vocabulary.svg`.',
    '',
    '| index | nibble | id | name | family | hint | nearest in set | d |',
    '|---:|:---:|---|---|---|:---:|---|---:|',
  );
  GENOME01_GLYPHS.forEach((g, index) => {
    const nn = nearestNeighbour(selectionDistance, frozen[index], frozen);
    push(
      `| ${index} | \`${index.toString(2).padStart(4, '0')}\` | \`${g.id}\` | ${g.name} | ${g.family} | ${g.hint} | \`${ids[nn.j]}\` | ${f3(nn.d)} |`,
    );
  });

  push('', '## Distance summary by size', '', '| glyph diameter | px per cell | min d (set) | closest pair | mean d (set) | min d (whole pool) |', '|---:|---:|---:|---|---:|---:|');
  for (const size of SIZES) {
    const m = matrices.get(size)!;
    const set = pairStats(m, frozen);
    const all = pairStats(m, pool);
    push(`| ${size} px | ${cellPx(size)} | ${f3(set.min)} | \`${ids[set.closest[0]]}\` / \`${ids[set.closest[1]]}\` | ${f3(set.mean)} | ${f3(all.min)} |`);
  }

  const reference = matrices.get(SELECTION_SIZES[SELECTION_SIZES.length - 1])!;
  push(
    '',
    `### Pairwise dissimilarity of the frozen set at ${SELECTION_SIZES[SELECTION_SIZES.length - 1]} px`,
    '',
    `| | ${frozen.map((_, i) => i).join(' | ')} |`,
    `|---:|${frozen.map(() => '---:').join('|')}|`,
  );
  frozen.forEach((a, row) => {
    push(`| **${row}** | ${frozen.map((b) => (a === b ? '·' : reference[a][b].toFixed(2))).join(' | ')} |`);
  });

  push('', '## Monte-Carlo validation', '', '| glyph diameter | noise σ | accuracy | most frequent confusions |', '|---:|---:|---:|---|');
  for (const c of classifications) {
    const top = [...c.confusions.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([k, n]) => `${k} (${n})`)
      .join(', ');
    push(`| ${c.size} px | ${c.noise} | ${pct(c.accuracy)} | ${top || 'none'} |`);
  }

  const withOrb = ranking.find((r) => r.members.includes(indexOf('ORB')))!;
  const set8 = pairStats(matrices.get(SIZES[0])!, frozen);
  push(
    '',
    '## Findings and rationale',
    '',
    '- **Fill and outline of one silhouette merge under blur.** A crescent and the half arc on the same side',
    `  (d = ${d('ECLIPSE_N', 'HALF_ARC_N')}), a half orb and that crescent (d = ${d('HALF_ORB_N', 'ECLIPSE_N')}) are nearly the same`,
    '  low-frequency image, so at most one family per silhouette can ever be selected.',
    '- **A shared orbit dominates composite figures.** Members of the half-filled orbit family differ by one inner fill',
    `  but share the whole orbit: d(HALF_ORBIT_N, HALF_ORBIT_E) = ${d('HALF_ORBIT_N', 'HALF_ORBIT_E')}, against`,
    `  d(HALF_ARC_N, HALF_ARC_E) = ${d('HALF_ARC_N', 'HALF_ARC_E')} for the bare half arcs and`,
    `  d(QUARTER_ORB_NE, QUARTER_ORB_SE) = ${d('QUARTER_ORB_NE', 'QUARTER_ORB_SE')} for bare quarter orbs. Oriented families`,
    '  therefore work best as ring-free silhouettes; the orbit itself is kept as a symmetric form.',
    '- **The solid orb correlates with every centred figure** (d(ORB, RING_POINT) =',
    `  ${d('ORB', 'RING_POINT')}, d(ORB, POINT) = ${d('ORB', 'POINT')}). The best vocabulary containing it reaches min d =`,
    `  ${f3(withOrb.sorted[0])}, against ${f3(winner.sorted[0])} without it. The orb stays the heart of the ORBES SEAL instead.`,
    '- **Proportions were tuned on the same measurements**: a 0.42 R core in the orbit-with-core (the free point is',
    `  0.37 R) keeps it apart from both the full orbit (d = ${d('FULL_ORBIT', 'RING_POINT')}) and the small orbit`,
    `  (d = ${d('SMALL_ORBIT', 'RING_POINT')}); the arc pairs use 90° arcs so that they never approach a full orbit`,
    `  (d(FULL_ORBIT, ARC_PAIR_NESW) = ${d('FULL_ORBIT', 'ARC_PAIR_NESW')}).`,
    `- **Structure.** The winner has ${winner.structure}: the high two bits of a glyph value name its form family, the`,
    '  low two bits its orientation. Every glyph uses the same orbit stroke and proportions, so a genome reads as one',
    '  ORBES orbital figure and never as a matrix code.',
    `- **Small sizes.** At ${SIZES[0]} px (${cellPx(SIZES[0])} px per cell) the closest pair is \`${ids[set8.closest[0]]}\` /`,
    `  \`${ids[set8.closest[1]]}\` (d = ${f3(set8.min)}). The genome is a human-facing identity and a secondary cross-check:`,
    '  decoding never depends on it, because the Reed-Solomon protected data rings carry the signed identity.',
    '',
  );
  return lines.join('\n');
}

// ── Specimen sheet ─────────────────────────────────────────────────────────

const FONT = "'Helvetica Neue', HelveticaNeue, Helvetica, Arial, sans-serif";
const SPECIMEN_INK = '#111111';
// Brand ivory (--ivory) and secondary grey (--ink-soft): docs/BRAND-DESIGN-SYSTEM.md §3.2.
const SPECIMEN_PAPER = '#f6f2ea';
const SPECIMEN_MUTED = '#5c5c5c';
/** O26, category 1, serial 184: the identity shown on the specimen sheet. */
const EXAMPLE_IDENTITY = (26 << 25) | (1 << 20) | 184;

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function text(x: number, y: number, content: string, size: number, opts: { anchor?: string; weight?: number; fill?: string; tracking?: number } = {}): string {
  const tracking = opts.tracking ?? 0.22;
  return (
    `<text x="${x}" y="${y}" font-size="${size}" letter-spacing="${(size * tracking).toFixed(2)}"` +
    `${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.weight ? ` font-weight="${opts.weight}"` : ''}` +
    ` fill="${opts.fill ?? SPECIMEN_INK}">${escapeXml(content)}</text>`
  );
}

function paths(primitives: readonly Primitive[]): string {
  // primitiveToPathData winds holes against outlines, so the default nonzero rule is exact.
  return primitives.map((p) => `<path d="${primitiveToPathData(p)}"/>`).join('');
}

/** A genome layout placed at (x, y) and scaled so that its glyph radius becomes `R`. */
function placedLayout(layout: GenomeLayout, x: number, y: number, R: number): string {
  const k = R / layout.glyphRadius;
  return `<g fill="${SPECIMEN_INK}" transform="translate(${x} ${y}) scale(${k})">${paths(layout.primitives)}</g>`;
}

function familyCaption(family: string, members: readonly GlyphDef[]): string {
  if (family === SYMMETRIC_FAMILY) return 'SYMMETRIC FORMS';
  const suffixes = members.map((g) => g.id.slice(family.length + 1));
  return `${family.replace(/_/g, ' ')} · ${suffixes.join(' ')}`;
}

function specimenSvg(): string {
  const W = 600;
  const H = 880;
  const M = 56;
  const cellW = (W - 2 * M) / 4;
  const gridTop = 150;
  const rowH = 132;
  const R = 24;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`,
    '<title>ORBES GENOME-01 vocabulary</title>',
    `<rect width="${W}" height="${H}" fill="${SPECIMEN_PAPER}"/>`,
  ];
  // Hairline corner brackets, the brand's framing device.
  const arm = 18;
  const inset = 22;
  for (const [x, y, sx, sy] of [
    [inset, inset, 1, 1],
    [W - inset, inset, -1, 1],
    [inset, H - inset, 1, -1],
    [W - inset, H - inset, -1, -1],
  ]) {
    parts.push(`<path d="M${x} ${y + sy * arm}V${y}H${x + sx * arm}" fill="none" stroke="${SPECIMEN_INK}" stroke-width="0.75"/>`);
  }
  parts.push(
    text(M, 78, 'ORBES', 22, { tracking: 0.42, weight: 300 }),
    text(W - M, 70, 'GENOME-01', 8.5, { anchor: 'end', tracking: 0.32 }),
    text(W - M, 84, 'GLYPH VOCABULARY', 6.5, { anchor: 'end', tracking: 0.32, fill: SPECIMEN_MUTED }),
    rule(M, W - M, 104, 0.5),
    text(M, 124, '16 GLYPHS · 4 BITS EACH · 8 GLYPHS PER GENOME · 32 BITS', 6, { tracking: 0.32, fill: SPECIMEN_MUTED }),
  );

  for (let row = 0; row < GENOME01_GLYPHS.length / 4; row++) {
    const members = GENOME01_GLYPHS.slice(4 * row, 4 * row + 4);
    const top = gridTop + rowH * row;
    if (row > 0) parts.push(rule(M, W - M, top, 0.35, 0.25));
    parts.push(text(M, top + 16, familyCaption(members[0].family, members), 5.5, { tracking: 0.36, fill: SPECIMEN_MUTED }));
    members.forEach((g, col) => {
      const cx = M + cellW * (col + 0.5);
      const cy = top + 58;
      parts.push(
        `<g fill="${SPECIMEN_INK}">${paths(g.primitives(cx, cy, R))}</g>`,
        text(cx, cy + R + 24, g.id.replace(/_/g, ' '), 6.2, { anchor: 'middle', tracking: 0.3 }),
        text(cx, cy + R + 36, `${g.index.toString(16).toUpperCase()} · ${g.index.toString(2).padStart(4, '0')}`, 5.5, {
          anchor: 'middle',
          tracking: 0.3,
          fill: SPECIMEN_MUTED,
        }),
      );
    });
  }

  // Example: one genome in both presentations.
  const example = computeGenome(EXAMPLE_IDENTITY);
  const exampleTop = gridTop + rowH * 4 + 8;
  parts.push(
    rule(M, W - M, exampleTop, 0.5),
    text(M, exampleTop + 20, 'EXAMPLE GENOME', 5.5, { tracking: 0.36, fill: SPECIMEN_MUTED }),
    text(W - M, exampleTop + 20, `IDENTITY 0x${example.packedIdentity.toString(16).toUpperCase()} · ${example.fingerprint}`, 5.5, {
      anchor: 'end',
      tracking: 0.36,
      fill: SPECIMEN_MUTED,
    }),
  );
  const row = genomeLayout(example, 'row');
  const rowR = 11;
  const orbit = genomeLayout(example, 'orbit');
  const orbitR = 8;
  const orbitExtent = ((CODE01.genome.orbitRadius + CODE01.genome.glyphRadius) / CODE01.genome.glyphRadius) * orbitR;
  const exampleCentreY = exampleTop + 76;
  // Row: first glyph edge on the left margin. Orbit: outer glyph edge on the right margin.
  parts.push(
    placedLayout(row, M + rowR, exampleCentreY, rowR),
    placedLayout(orbit, W - M - orbitExtent, exampleCentreY, orbitR),
  );
  parts.push(
    rule(M, W - M, H - 62, 0.5),
    text(M, H - 44, 'GENOME = PERMUTE(IDENTITY) · PUBLIC BIJECTION · AUTHENTICITY BY ED25519 SIGNATURE', 5.5, {
      tracking: 0.36,
      fill: SPECIMEN_MUTED,
    }),
    text(W - M, H - 44, 'PARIS, 2026', 5.5, { anchor: 'end', tracking: 0.36, fill: SPECIMEN_MUTED }),
    '</svg>',
  );
  return parts.join('\n') + '\n';
}

function rule(x0: number, x1: number, y: number, width: number, opacity = 1): string {
  const fade = opacity === 1 ? '' : ` stroke-opacity="${opacity}"`;
  return `<path d="M${x0} ${y}H${x1}" stroke="${SPECIMEN_INK}" stroke-width="${width}"${fade}/>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const started = performance.now();
  const matrices = new Map<number, Matrix>();
  for (const size of SIZES) {
    matrices.set(size, distanceMatrix(GENOME_GLYPH_CANDIDATES, size));
    console.log(`rendered ${GENOME_GLYPH_CANDIDATES.length} candidates at ${size} px`);
  }
  const selectionDistance = GENOME_GLYPH_CANDIDATES.map((_, a) =>
    GENOME_GLYPH_CANDIDATES.map((_, b) => Math.min(...SELECTION_SIZES.map((s) => matrices.get(s)![a][b]))),
  );
  const ranking = selectVocabulary(selectionDistance);
  const frozen = GENOME01_GLYPHS.map((g) => GENOME_GLYPH_CANDIDATES.findIndex((c) => c.id === g.id));
  const rand = mulberry32(MONTE_CARLO_SEED);
  const classifications = MONTE_CARLO_NOISE.flatMap((noise) => SIZES.map((size) => classify(GENOME01_GLYPHS, size, noise, rand)));

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  mkdirSync(dirname(SPECIMEN_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, writeReport(matrices, selectionDistance, ranking, frozen, classifications));
  writeFileSync(SPECIMEN_PATH, specimenSvg());

  const winner = ranking[0];
  console.log(`study winner (${winner.structure}, min d ${f3(winner.sorted[0])}):`);
  console.log('  ' + winner.members.map((i) => GENOME_GLYPH_CANDIDATES[i].id).join(' '));
  for (const c of classifications) console.log(`  classification ${c.size} px, noise ${c.noise}: ${pct(c.accuracy)}`);
  console.log(`wrote ${REPORT_PATH}\nwrote ${SPECIMEN_PATH}\n(${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

main();
