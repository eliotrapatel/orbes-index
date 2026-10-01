import { describe, expect, it } from 'vitest';
import { encodeOrbesCode } from '../../src/core/code/encoder.js';
import { orbesCodePrimitives } from '../../src/core/code/primitives.js';
import {
  CODE01,
  CODE01_FORMAT_CELLS,
  CODE01_GENOME_CENTERS,
  CODE01_MOONS,
  CODE01_RINGS,
  CODE01_TOTAL_CELLS,
  type RingSpec,
} from '../../src/core/code/profile.js';
import { genomeGlyphPrimitives } from '../../src/core/genome/index.js';
import { TAU, type ArcPrimitive, type Primitive, type RingPrimitive } from '../../src/core/geometry.js';
import { Prng } from '../support/prng.js';

const GLYPHS = [0, 5, 10, 15, 3, 12, 6, 9];
const FORMAT = new Set(CODE01_FORMAT_CELLS.flat());
const layerOfCell = (flat: number): 'format' | 'data' => (FORMAT.has(flat) ? 'format' : 'data');
type CellPrimitive = ArcPrimitive | RingPrimitive;

function cellPrimitivesOf(primitives: readonly Primitive[]): CellPrimitive[] {
  return primitives.filter((p): p is CellPrimitive => p.layer === 'data' || p.layer === 'format') as CellPrimitive[];
}

function ringAt(radius: number): RingSpec {
  const ring = CODE01_RINGS.find((r) => Math.abs(r.radius - radius) < 1e-12);
  if (!ring) throw new Error(`no data ring at radius ${radius}`);
  return ring;
}

/** Cell interval [first, last + 1) drawn by an arc or ring, checked to fall on exact cell boundaries. */
function cellInterval(p: CellPrimitive, ring: RingSpec): [number, number] {
  if (p.kind === 'ring') return [0, ring.cells];
  const a = (p.start * ring.cells) / TAU;
  const b = (p.end * ring.cells) / TAU;
  expect(Math.abs(a - Math.round(a))).toBeLessThan(1e-9);
  expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-9);
  return [Math.round(a), Math.round(b)];
}

/**
 * Layer accounting: every ink cell is covered by exactly one data/format
 * primitive of its own layer, no paper cell is covered, and arcs are maximal
 * (never two touching arcs of one layer, which would have been one run).
 */
function checkCellAccounting(cells: Uint8Array, primitives: readonly Primitive[]): void {
  const coverage = new Uint8Array(CODE01_TOTAL_CELLS);
  for (const p of cellPrimitivesOf(primitives)) {
    expect([p.cx, p.cy, p.width]).toEqual([0, 0, CODE01.data.arcThickness]);
    const ring = ringAt(p.r);
    const [a, b] = cellInterval(p, ring);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(ring.cells);
    expect(b - a).toBeGreaterThan(0);
    expect(b - a).toBeLessThanOrEqual(ring.cells);
    if (p.kind === 'arc') {
      expect(p.cap).toBe('round');
      expect(b - a).toBeLessThan(ring.cells);
      // Maximal run: the cells just outside the arc are paper or belong to the other layer.
      for (const outside of [a - 1, b]) {
        const flat = ring.offset + ((outside + ring.cells) % ring.cells);
        expect(cells[flat] === 1 && layerOfCell(flat) === p.layer).toBe(false);
      }
    }
    for (let c = a; c < b; c++) {
      const flat = ring.offset + (c % ring.cells);
      coverage[flat]++;
      expect(cells[flat]).toBe(1);
      expect(layerOfCell(flat)).toBe(p.layer);
    }
  }
  expect(coverage).toEqual(cells);
}

describe('orbesCodePrimitives: data and format cells', () => {
  it('covers every ink cell with exactly one round-capped arc of its layer (encoded codes, all masks)', () => {
    const rng = new Prng('primitives/accounting');
    for (let n = 0; n < 12; n++) {
      const data = Uint8Array.from({ length: CODE01.ecc.dataBytes }, () => rng.int(0, 255));
      const model = encodeOrbesCode({ data, genomeGlyphs: GLYPHS, mask: n % 4 });
      checkCellAccounting(model.cells, model.primitives);
    }
  });

  it('accounts for arbitrary cell states, including runs across north and dense rings', () => {
    const rng = new Prng('primitives/random-cells');
    for (const density of [0.1, 0.5, 0.9, 0.99]) {
      const cells = Uint8Array.from({ length: CODE01_TOTAL_CELLS }, () => (rng.chance(density) ? 1 : 0));
      checkCellAccounting(cells, orbesCodePrimitives(cells, GLYPHS));
    }
  });

  it('draws a fully inked ring as one ring, but splits ring 0 exactly at the format/data boundaries', () => {
    const cells = new Uint8Array(CODE01_TOTAL_CELLS).fill(1);
    const primitives = cellPrimitivesOf(orbesCodePrimitives(cells, GLYPHS));
    checkCellAccounting(cells, primitives);
    const ring0 = CODE01_RINGS[0];
    const summary = primitives.map((p) => [p.layer, p.kind, ringAt(p.r).index, ...cellInterval(p, ringAt(p.r))]);
    expect(summary).toEqual([
      ['format', 'arc', 0, 0, 15],
      ['format', 'arc', 0, 24, 39],
      ['data', 'arc', 0, 15, 24],
      ['data', 'arc', 0, 39, ring0.cells],
      ...CODE01_RINGS.slice(1).map((ring) => ['data', 'ring', ring.index, 0, ring.cells]),
    ]);
  });

  it('joins a run that crosses north into one arc ending beyond 2π', () => {
    const cells = new Uint8Array(CODE01_TOTAL_CELLS);
    const ring = CODE01_RINGS[7];
    for (const c of [ring.cells - 2, ring.cells - 1, 0, 1, 2]) cells[ring.offset + c] = 1;
    const arcs = cellPrimitivesOf(orbesCodePrimitives(cells, GLYPHS));
    expect(arcs).toHaveLength(1);
    const [arc] = arcs;
    expect(arc.kind).toBe('arc');
    expect(cellInterval(arc, ring)).toEqual([ring.cells - 2, ring.cells + 3]);
  });

  it('emits nothing on the data orbits for blank cells', () => {
    expect(cellPrimitivesOf(orbesCodePrimitives(new Uint8Array(CODE01_TOTAL_CELLS), GLYPHS))).toEqual([]);
  });
});

describe('orbesCodePrimitives: fixed structures', () => {
  const primitives = orbesCodePrimitives(new Uint8Array(CODE01_TOTAL_CELLS), GLYPHS);
  const byLayer = (layer: Primitive['layer']): Primitive[] => primitives.filter((p) => p.layer === layer);

  it('draws the ORBES SEAL: core disc r 2.0 and orbit ring 3.0–4.0', () => {
    expect(byLayer('seal')).toEqual([
      { kind: 'disc', layer: 'seal', cx: 0, cy: 0, r: 2 },
      { kind: 'ring', layer: 'seal', cx: 0, cy: 0, r: 3.5, width: 1 },
    ]);
  });

  it('draws four moons of radius 1.75 and the polaris halo around moon 0 (NW)', () => {
    const moons = byLayer('moon');
    expect(moons).toHaveLength(4);
    moons.forEach((m, k) => expect(m).toEqual({ kind: 'disc', layer: 'moon', cx: CODE01_MOONS[k].x, cy: CODE01_MOONS[k].y, r: 1.75 }));
    expect(CODE01_MOONS[0].x).toBeLessThan(0);
    expect(CODE01_MOONS[0].y).toBeLessThan(0);
    expect(byLayer('polaris')).toEqual([
      { kind: 'ring', layer: 'polaris', cx: CODE01_MOONS[0].x, cy: CODE01_MOONS[0].y, r: 2.6, width: 0.4 },
    ]);
  });

  it('places genome glyph i at CODE01_GENOME_CENTERS[i] with the profile glyph radius', () => {
    const expected = GLYPHS.flatMap((g, i) =>
      genomeGlyphPrimitives(g, CODE01_GENOME_CENTERS[i].x, CODE01_GENOME_CENTERS[i].y, CODE01.genome.glyphRadius),
    );
    expect(byLayer('genome')).toEqual(expected);
  });

  it('paints decor first, so a reduced-tone hairline can never cover machine-critical ink', () => {
    const decorCount = byLayer('decor').length;
    expect(decorCount).toBe(3);
    expect(primitives.slice(0, decorCount).every((p) => p.layer === 'decor')).toBe(true);
    expect(primitives.slice(decorCount).every((p) => p.layer !== 'decor')).toBe(true);
  });

  it('omits decor on request and nothing else', () => {
    expect(orbesCodePrimitives(new Uint8Array(CODE01_TOTAL_CELLS), GLYPHS, { decor: false })).toEqual(
      primitives.filter((p) => p.layer !== 'decor'),
    );
  });

  it('rejects malformed cells and genomes with RangeError', () => {
    const cells = new Uint8Array(CODE01_TOTAL_CELLS);
    expect(() => orbesCodePrimitives(cells.subarray(1), GLYPHS)).toThrow(RangeError);
    const two = cells.slice();
    two[3] = 2;
    expect(() => orbesCodePrimitives(two, GLYPHS)).toThrow(RangeError);
    expect(() => orbesCodePrimitives(cells, GLYPHS.slice(1))).toThrow(RangeError);
    expect(() => orbesCodePrimitives(cells, [...GLYPHS.slice(1), 16])).toThrow(RangeError);
  });
});

// ── Decor clearance ────────────────────────────────────────────────────────

/**
 * Radial ink extent [min, max] of a primitive, measured from the code centre.
 * Arcs count as their full ring (conservative); other shapes as their disc.
 */
function radialExtent(p: Primitive): [number, number] {
  const d = Math.hypot(p.cx, p.cy);
  if (p.kind === 'ring' || p.kind === 'arc') {
    const inner = p.r - p.width / 2;
    const outer = p.r + p.width / 2;
    return [d >= outer ? d - outer : d <= inner ? inner - d : 0, d + outer];
  }
  return [Math.max(0, d - p.r), d + p.r];
}

/**
 * Gap between a decor hairline (a full ring around the centre) and another
 * primitive. Because the hairline is a complete concentric annulus, the
 * Euclidean distance to any connected shape is exactly the radial gap.
 */
function clearance(hairline: RingPrimitive, other: Primitive): number {
  const [lo, hi] = radialExtent(other);
  const inner = hairline.r - hairline.width / 2;
  const outer = hairline.r + hairline.width / 2;
  return Math.max(lo - outer, inner - hi, 0);
}

describe('decor clearance', () => {
  // All cells inked: every possible data or format arc position is present.
  const primitives = orbesCodePrimitives(new Uint8Array(CODE01_TOTAL_CELLS).fill(1), GLYPHS);
  const hairlines = primitives.filter((p): p is RingPrimitive => p.layer === 'decor' && p.kind === 'ring');
  const MACHINE_CRITICAL = new Set(['seal', 'moon', 'polaris', 'format', 'data']);

  it('uses only faint, concentric hairlines', () => {
    expect(hairlines).toHaveLength(primitives.filter((p) => p.layer === 'decor').length);
    for (const h of hairlines) {
      expect([h.cx, h.cy]).toEqual([0, 0]);
      expect(h.width).toBeLessThanOrEqual(0.08);
      expect(h.tone).toBeGreaterThan(0);
      expect(h.tone).toBeLessThanOrEqual(0.35);
    }
    expect(hairlines.map((h) => h.r)).toContain(24);
  });

  it('keeps at least 0.6 u from every machine-critical feature (moons, halo, seal, data and format arcs)', () => {
    let closest = Infinity;
    for (const h of hairlines) {
      for (const p of primitives) if (MACHINE_CRITICAL.has(p.layer)) closest = Math.min(closest, clearance(h, p));
    }
    expect(closest).toBeGreaterThanOrEqual(0.6);
  });

  it('never touches a genome glyph, whichever glyph is printed', () => {
    for (let glyph = 0; glyph < 16; glyph++) {
      const genome = orbesCodePrimitives(new Uint8Array(CODE01_TOTAL_CELLS), new Array(8).fill(glyph)).filter((p) => p.layer === 'genome');
      for (const h of hairlines) for (const p of genome) expect(clearance(h, p)).toBeGreaterThan(0.2);
    }
  });

  it('stays within the printed artifact', () => {
    for (const h of hairlines) expect(h.r + h.width / 2).toBeLessThan(CODE01.extent.halfWidth + CODE01.extent.quiet);
  });
});
