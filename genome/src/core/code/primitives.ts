/**
 * ORBES CODE-01: vector model of a code, from printed cells and genome glyphs
 * to layer-tagged primitives (see ../geometry.ts). Every renderer (SVG, PDF,
 * raster) draws exactly this list, so all outputs share one geometry.
 *
 * Paint order is decor first, then seal, moons, polaris halo, format arcs,
 * data arcs and genome glyphs. Decorative lines carry a reduced tone that the
 * SVG renderer pre-mixes into an opaque colour; painting them underneath means
 * that even a future decor change that overlapped machine-critical ink could
 * never lighten it.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { genomeGlyphPrimitives } from '../genome/render.js';
import { TAU, type Layer, type Primitive } from '../geometry.js';
import { assertCellArray, cyclicRuns } from './layout.js';
import {
  CODE01,
  CODE01_FORMAT_CELLS,
  CODE01_GENOME_CENTERS,
  CODE01_MOONS,
  CODE01_RINGS,
  type RingSpec,
} from './profile.js';

export interface CodePrimitiveOptions {
  /** Include the decorative hairlines (default true). Never needed for decoding. */
  decor?: boolean;
}

interface Hairline {
  r: number;
  width: number;
  tone: number;
}

/**
 * Decorative hairlines, all centred on the seal. Radii keep at least 0.6 u
 * from every machine-critical ink edge (data arcs 10.14–22.86, moons from
 * 25.75, polaris halo from 24.70) so that print gain, foil spread or
 * engraving burr can never bridge a hairline into a sampled feature.
 */
const DECOR_HAIRLINES: readonly Hairline[] = [
  // Horizon: the outer edge of the orbital system, inside the quiet band.
  { r: 24.0, width: 0.08, tone: 0.35 },
  // Guides framing the data orbits, as close as the clearance allows.
  { r: 9.5, width: 0.06, tone: 0.25 },
  { r: 23.5, width: 0.06, tone: 0.25 },
];

// Run keys for the cell-arc decomposition: runs never mix layers.
const PAPER = 0;
const DATA = 1;
const FORMAT = 2;

const FORMAT_SET: ReadonlySet<number> = new Set(CODE01_FORMAT_CELLS.flat());

function decorPrimitives(): Primitive[] {
  return DECOR_HAIRLINES.map(({ r, width, tone }) => ({ kind: 'ring', layer: 'decor', cx: 0, cy: 0, r, width, tone }));
}

function sealPrimitives(): Primitive[] {
  const { coreRadius, gapOuter, ringOuter } = CODE01.seal;
  return [
    { kind: 'disc', layer: 'seal', cx: 0, cy: 0, r: coreRadius },
    { kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: (gapOuter + ringOuter) / 2, width: ringOuter - gapOuter },
  ];
}

function moonPrimitives(): Primitive[] {
  const { radius, polarisIndex, haloRadius, haloWidth } = CODE01.moons;
  const polaris = CODE01_MOONS[polarisIndex];
  return [
    ...CODE01_MOONS.map((m): Primitive => ({ kind: 'disc', layer: 'moon', cx: m.x, cy: m.y, r: radius })),
    { kind: 'ring', layer: 'polaris', cx: polaris.x, cy: polaris.y, r: haloRadius, width: haloWidth },
  ];
}

/** Arcs (or a full ring) for the inked runs of one ring whose run key is `key`. */
function ringRunPrimitives(ring: RingSpec, keys: Uint8Array, key: number, layer: Layer): Primitive[] {
  const width = CODE01.data.arcThickness;
  const step = TAU / ring.cells;
  return cyclicRuns(keys)
    .filter((run) => run.value === key)
    .map((run): Primitive =>
      run.length === ring.cells
        ? { kind: 'ring', layer, cx: 0, cy: 0, r: ring.radius, width }
        : {
            kind: 'arc',
            layer,
            cx: 0,
            cy: 0,
            r: ring.radius,
            width,
            // Exact cell boundaries; a run crossing north simply ends beyond 2π.
            start: run.start * step,
            end: (run.start + run.length) * step,
            cap: 'round',
          },
    );
}

/**
 * Inked cells merged into round-capped arcs, one per maximal run of
 * consecutive ink cells of the same layer. All format arcs come first so the
 * SVG groups them into a single layer.
 */
function cellPrimitives(cells: Uint8Array): Primitive[] {
  const ringKeys = CODE01_RINGS.map((ring) =>
    Uint8Array.from({ length: ring.cells }, (_, c) => {
      const flat = ring.offset + c;
      if (cells[flat] === 0) return PAPER;
      return FORMAT_SET.has(flat) ? FORMAT : DATA;
    }),
  );
  return [
    ...CODE01_RINGS.flatMap((ring, k) => ringRunPrimitives(ring, ringKeys[k], FORMAT, 'format')),
    ...CODE01_RINGS.flatMap((ring, k) => ringRunPrimitives(ring, ringKeys[k], DATA, 'data')),
  ];
}

function genomePrimitives(glyphs: readonly number[]): Primitive[] {
  return glyphs.flatMap((glyph, i) => {
    const c = CODE01_GENOME_CENTERS[i];
    return genomeGlyphPrimitives(glyph, c.x, c.y, CODE01.genome.glyphRadius);
  });
}

/**
 * Complete primitive list of a CODE-01 artifact. `cells` is the final printed
 * state (CODE01_TOTAL_CELLS values, 1 = ink); `genomeGlyphs` are the eight
 * GENOME-01 glyph indices, glyph 0 at north. Throws RangeError on bad input.
 */
export function orbesCodePrimitives(
  cells: Uint8Array,
  genomeGlyphs: readonly number[],
  opts: CodePrimitiveOptions = {},
): Primitive[] {
  assertCellArray(cells);
  if (!Array.isArray(genomeGlyphs) || genomeGlyphs.length !== CODE01.genome.count) {
    throw new RangeError(`a CODE-01 genome has ${CODE01.genome.count} glyphs`);
  }
  return [
    ...(opts.decor === false ? [] : decorPrimitives()),
    ...sealPrimitives(),
    ...moonPrimitives(),
    ...cellPrimitives(cells),
    ...genomePrimitives(genomeGlyphs),
  ];
}
