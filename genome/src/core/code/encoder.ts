/**
 * ORBES CODE-01 encoder and SVG renderer.
 *
 * Pipeline (normative, see layout.ts for the cell placement):
 *   data (79 bytes) ─► RS(164,79) codeword ─► for each candidate mask: cells
 *   (codeword placed and masked, BCH format word in both copies) ─► the mask
 *   with the lowest visual penalty ─► vector primitives ─► SVG.
 *
 * The mask is a whitening pattern chosen for print quality and local
 * thresholding, never a security mechanism: the signature inside the data is
 * what authenticates a code.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { CODE_PROFILES, code01CompatibleProfiles, type CodeProfileRegistry } from '../code-profiles.js';
import { bchFormatEncode, rsEncode } from '../ecc/index.js';
import { TAU, type Primitive } from '../geometry.js';
import { primitivesToSvg, type SvgStyle } from '../render/svg.js';
import { assertCellArray, cyclicRuns, placeCells, type CellRun } from './layout.js';
import { orbesCodePrimitives } from './primitives.js';
import { ORBES_CODE_STYLES } from './styles.js';
import {
  CODE01,
  CODE01_MASK_COUNT,
  CODE01_RINGS,
  CODE01_SIZE,
  CODE01_TOTAL_CELLS,
  formatInfoValue,
  type RingSpec,
} from './profile.js';

export interface EncodeInput {
  /** Exactly CODE01.ecc.dataBytes (79) bytes: payload ‖ signature ‖ CRC-16. */
  data: Uint8Array;
  /** The eight GENOME-01 glyph indices, glyph 0 at north. */
  genomeGlyphs: readonly number[];
  /**
   * Code version written into the format word (default 1). Must name a
   * profile of the registry (`opts.codeProfiles`, default CODE_PROFILES) with
   * the CODE-01 geometry. The data's own version nibble is the caller's.
   */
  codeVersion?: number;
  /** Force a mask (0..3) instead of selecting the one with the lowest penalty. */
  mask?: number;
}

export interface OrbesCodeModel {
  profile: 'CODE-01';
  codeVersion: number;
  mask: number;
  formatWord: number;
  /** 164 bytes: data ‖ Reed-Solomon parity. */
  codeword: Uint8Array;
  /** CODE01_TOTAL_CELLS cells, final printed state (1 = ink), mask applied. */
  cells: Uint8Array;
  genomeGlyphs: number[];
  /** Seal, moons, polaris halo, format/data arcs, genome glyphs and (optionally) decor. */
  primitives: Primitive[];
}

/** Breakdown of the mask selection penalty (lower is better). */
export interface MaskPenalty {
  /** Runs of more than RUN_LIMIT identical cells along a ring. */
  runs: number;
  /** Sectors whose ink ratio strays far from one half. */
  balance: number;
  /** Long paper runs stacked on long paper runs of the next ring (empty patches). */
  patches: number;
  total: number;
}

/** Brand presentations of the code (ink on paper); defined in styles.ts, re-exported here. */
export { ORBES_CODE_STYLES };

/** CODE-01, the version written when the input names none. */
const DEFAULT_CODE_VERSION = 1;
const PARITY_BYTES = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes;

// ── Mask penalty ───────────────────────────────────────────────────────────
//
// (a) A ring run of identical cells longer than RUN_LIMIT costs
//     (length − RUN_LIMIT)²: long solid arcs and long gaps read as structure
//     rather than texture and starve local thresholding of contrast.
// (b) Ink ratio per region (SECTORS angular sectors × BANDS radial bands):
//     a deviation from 0.5 beyond BALANCE_TOLERANCE costs BALANCE_WEIGHT per
//     unit of excess ratio, so no part of the artifact looks heavier.
// (c) Paper runs of at least PATCH_MIN_RUN cells overlapping (in angle) a paper
//     run of at least PATCH_MIN_RUN cells on the next ring outward form a large
//     empty patch; each u of overlapping arc length costs PATCH_WEIGHT.
// The weights put the terms on one scale: a run of 13 cells (16), a 7 u patch
// (14) and an all-ink or all-paper region (14) cost about the same.

const RUN_LIMIT = 9;
const SECTORS = 8;
const BANDS = 3;
const BALANCE_TOLERANCE = 0.15;
const BALANCE_WEIGHT = 40;
const PATCH_MIN_RUN = 7;
const PATCH_WEIGHT = 2;

/**
 * Radial band of each ring, split by cumulative cell count so the three bands
 * hold similar numbers of cells (rings 0–5, 6–9, 10–12 for CODE-01).
 */
const RING_BAND: readonly number[] = CODE01_RINGS.map((ring) =>
  Math.floor((BANDS * (ring.offset + ring.cells / 2)) / CODE01_TOTAL_CELLS),
);

function ringValues(cells: Uint8Array, ring: RingSpec): Uint8Array {
  return cells.subarray(ring.offset, ring.offset + ring.cells);
}

function runPenalty(runs: readonly CellRun[]): number {
  let cost = 0;
  for (const run of runs) if (run.length > RUN_LIMIT) cost += (run.length - RUN_LIMIT) ** 2;
  return cost;
}

function balancePenalty(cells: Uint8Array): number {
  const ink = new Array<number>(SECTORS * BANDS).fill(0);
  const total = new Array<number>(SECTORS * BANDS).fill(0);
  CODE01_RINGS.forEach((ring, k) => {
    for (let c = 0; c < ring.cells; c++) {
      // Sector of the cell's mid angle, (c + ½)/n of a turn, in exact integer arithmetic.
      const region = RING_BAND[k] * SECTORS + Math.floor(((2 * c + 1) * SECTORS) / (2 * ring.cells));
      ink[region] += cells[ring.offset + c];
      total[region]++;
    }
  });
  let cost = 0;
  for (let i = 0; i < ink.length; i++) {
    const excess = Math.abs(ink[i] / total[i] - 0.5) - BALANCE_TOLERANCE;
    if (excess > 0) cost += BALANCE_WEIGHT * excess;
  }
  return cost;
}

/** Angular interval [start, end) of a run, end > start, possibly beyond 2π. */
function runInterval(run: CellRun, ring: RingSpec): [number, number] {
  const step = TAU / ring.cells;
  return [run.start * step, (run.start + run.length) * step];
}

/** Angle shared by two intervals on the circle (each at most one full turn). */
function circularOverlap([a0, a1]: [number, number], [b0, b1]: [number, number]): number {
  let overlap = 0;
  for (const shift of [-TAU, 0, TAU]) overlap += Math.max(0, Math.min(a1, b1 + shift) - Math.max(a0, b0 + shift));
  return overlap;
}

function patchPenalty(ringRuns: readonly CellRun[][]): number {
  const longPaper = ringRuns.map((runs, k) =>
    runs.filter((r) => r.value === 0 && r.length >= PATCH_MIN_RUN).map((r) => runInterval(r, CODE01_RINGS[k])),
  );
  let cost = 0;
  for (let k = 0; k + 1 < CODE01_RINGS.length; k++) {
    const meanRadius = (CODE01_RINGS[k].radius + CODE01_RINGS[k + 1].radius) / 2;
    for (const inner of longPaper[k]) {
      for (const outer of longPaper[k + 1]) cost += PATCH_WEIGHT * meanRadius * circularOverlap(inner, outer);
    }
  }
  return cost;
}

/** Visual penalty of a printed cell state; the encoder keeps the mask that minimises `total`. */
export function maskPenalty(cells: Uint8Array): MaskPenalty {
  if (!(cells instanceof Uint8Array)) throw new RangeError('cells must be a Uint8Array');
  assertCellArray(cells);
  const ringRuns = CODE01_RINGS.map((ring) => cyclicRuns(ringValues(cells, ring)));
  const runs = ringRuns.reduce((sum, r) => sum + runPenalty(r), 0);
  const balance = balancePenalty(cells);
  const patches = patchPenalty(ringRuns);
  return { runs, balance, patches, total: runs + balance + patches };
}

// ── Encoder ────────────────────────────────────────────────────────────────

function requireInput(input: EncodeInput, profiles: CodeProfileRegistry<unknown>): number {
  if (input === null || typeof input !== 'object') throw new RangeError('encode input must be an object');
  if (!(input.data instanceof Uint8Array) || input.data.length !== CODE01.ecc.dataBytes) {
    throw new RangeError(`CODE-01 data must be exactly ${CODE01.ecc.dataBytes} bytes`);
  }
  const version = input.codeVersion ?? DEFAULT_CODE_VERSION;
  if (!code01CompatibleProfiles(profiles).some((p) => p.version === version)) {
    throw new RangeError(`unsupported code version ${String(version)}`);
  }
  if (!Array.isArray(input.genomeGlyphs) || input.genomeGlyphs.length !== CODE01.genome.count) {
    throw new RangeError(`a CODE-01 genome has ${CODE01.genome.count} glyphs`);
  }
  const { mask } = input;
  if (mask !== undefined && !(Number.isInteger(mask) && mask >= 0 && mask < CODE01_MASK_COUNT)) {
    throw new RangeError(`invalid mask ${String(mask)}`);
  }
  return version;
}

/** The candidate with the lowest total penalty; the first (lowest mask id) wins ties. */
function lowestPenalty<T extends { cells: Uint8Array }>(candidates: readonly T[]): T {
  let best = candidates[0];
  let bestPenalty = maskPenalty(best.cells).total;
  for (const candidate of candidates.slice(1)) {
    const penalty = maskPenalty(candidate.cells).total;
    if (penalty < bestPenalty) [best, bestPenalty] = [candidate, penalty];
  }
  return best;
}

/**
 * Encode 79 data bytes and a genome into a CODE-01 model. Deterministic: the
 * same input always yields the same mask, cells and primitives. Throws
 * RangeError on invalid input.
 */
export function encodeOrbesCode(input: EncodeInput, opts: { decor?: boolean; codeProfiles?: CodeProfileRegistry<unknown> } = {}): OrbesCodeModel {
  const version = requireInput(input, opts.codeProfiles ?? CODE_PROFILES);
  const codeword = rsEncode(input.data, PARITY_BYTES);
  const masks = input.mask === undefined ? Array.from({ length: CODE01_MASK_COUNT }, (_, m) => m) : [input.mask];
  const layouts = masks.map((mask) => {
    const formatWord = bchFormatEncode(formatInfoValue(version, mask));
    return { mask, formatWord, cells: placeCells(codeword, mask, formatWord) };
  });
  const chosen = layouts.length === 1 ? layouts[0] : lowestPenalty(layouts);
  const genomeGlyphs = [...input.genomeGlyphs];
  return {
    profile: 'CODE-01',
    codeVersion: version,
    mask: chosen.mask,
    formatWord: chosen.formatWord,
    codeword,
    cells: chosen.cells,
    genomeGlyphs,
    primitives: orbesCodePrimitives(chosen.cells, genomeGlyphs, opts),
  };
}

const HALF = CODE01_SIZE / 2;

/**
 * Standalone SVG of a code: viewBox −25 −25 50 50 (quiet zone included),
 * classic ink on white unless the style says otherwise. `paper: null` gives a
 * transparent background, `widthMm` a physical size, `decor: false` omits the
 * decorative hairlines.
 */
export function renderOrbesCodeSvg(model: OrbesCodeModel, style: SvgStyle = {}): string {
  return primitivesToSvg(
    model.primitives,
    { x: -HALF, y: -HALF, w: CODE01_SIZE, h: CODE01_SIZE },
    {
      ...style,
      ink: style.ink ?? ORBES_CODE_STYLES.classic.ink,
      paper: style.paper === undefined ? ORBES_CODE_STYLES.classic.paper : style.paper,
      title: style.title ?? `ORBES ${CODE01.id}`,
    },
  );
}
