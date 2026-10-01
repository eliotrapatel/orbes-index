import { describe, expect, it } from 'vitest';
import { encodeOrbesCode, maskPenalty, type EncodeInput } from '../../src/core/code/encoder.js';
import { decodeCellsToCodeword, placeCells, readFormatWords } from '../../src/core/code/layout.js';
import { orbesCodePrimitives } from '../../src/core/code/primitives.js';
import {
  CODE01,
  CODE01_MASK_COUNT,
  CODE01_RINGS,
  CODE01_TOTAL_CELLS,
  formatInfoValue,
  parseFormatInfoValue,
  type RingSpec,
} from '../../src/core/code/profile.js';
import { bchFormatDecode, bchFormatEncode, rsDecode, rsEncode } from '../../src/core/ecc/index.js';
import { TAU } from '../../src/core/geometry.js';
import { Prng } from '../support/prng.js';

const MASKS = Array.from({ length: CODE01_MASK_COUNT }, (_, m) => m);
const DATA = Uint8Array.from({ length: CODE01.ecc.dataBytes }, (_, i) => (i * 73 + 41) & 0xff);
const GLYPHS = [0, 5, 10, 15, 3, 12, 6, 9];

function randomInput(rng: Prng): EncodeInput {
  return {
    data: Uint8Array.from({ length: CODE01.ecc.dataBytes }, () => rng.int(0, 255)),
    genomeGlyphs: Array.from({ length: 8 }, () => rng.int(0, 15)),
  };
}

describe('encodeOrbesCode', () => {
  it('builds the normative model: RS codeword, masked cells, BCH format word, primitives', () => {
    const model = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS });
    expect(model.profile).toBe('CODE-01');
    expect(model.codeVersion).toBe(1);
    expect(model.codeword).toEqual(rsEncode(DATA, CODE01.ecc.totalBytes - CODE01.ecc.dataBytes));
    expect(model.codeword.subarray(0, DATA.length)).toEqual(DATA);
    expect(model.formatWord).toBe(bchFormatEncode(formatInfoValue(1, model.mask)));
    expect(model.cells).toEqual(placeCells(model.codeword, model.mask, model.formatWord));
    expect(model.cells).toHaveLength(CODE01_TOTAL_CELLS);
    expect(model.genomeGlyphs).toEqual(GLYPHS);
    expect(model.genomeGlyphs).not.toBe(GLYPHS);
    expect(model.primitives).toEqual(orbesCodePrimitives(model.cells, GLYPHS));
  });

  it('round-trips through the decoder-side helpers: format word → mask → codeword → data', () => {
    const rng = new Prng('encoder/round-trip');
    for (let n = 0; n < 25; n++) {
      const input = randomInput(rng);
      const model = encodeOrbesCode(input);
      const [first, second] = readFormatWords(model.cells);
      expect(second).toBe(first);
      const format = bchFormatDecode(first);
      expect(format.distance).toBe(0);
      expect(parseFormatInfoValue(format.value)).toEqual({ codeVersion: 1, mask: model.mask });
      const decoded = rsDecode(decodeCellsToCodeword(model.cells, model.mask).codeword, 85);
      expect(decoded.ok && decoded.errors === 0 && decoded.data).toEqual(input.data);
    }
  });

  it('selects the lowest-penalty mask, the lowest id on ties, deterministically', () => {
    const rng = new Prng('encoder/mask-selection');
    const chosen = new Set<number>();
    for (let n = 0; n < 40; n++) {
      const input = randomInput(rng);
      const model = encodeOrbesCode(input);
      const penalties = MASKS.map((mask) => maskPenalty(encodeOrbesCode({ ...input, mask }).cells).total);
      expect(model.mask).toBe(penalties.indexOf(Math.min(...penalties)));
      expect(encodeOrbesCode(input)).toEqual(model);
      chosen.add(model.mask);
    }
    // The penalty genuinely discriminates: random data does not always keep mask 0.
    expect(chosen.size).toBeGreaterThan(2);
  });

  it('honours a forced mask', () => {
    for (const mask of MASKS) {
      const model = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS, mask, codeVersion: 1 });
      expect(model.mask).toBe(mask);
      expect(parseFormatInfoValue(bchFormatDecode(model.formatWord).value).mask).toBe(mask);
      expect(decodeCellsToCodeword(model.cells, mask).codeword).toEqual(model.codeword);
    }
  });

  it('includes the decorative layer unless asked not to', () => {
    const withDecor = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS });
    const plain = encodeOrbesCode({ data: DATA, genomeGlyphs: GLYPHS }, { decor: false });
    expect(withDecor.primitives.some((p) => p.layer === 'decor')).toBe(true);
    expect(plain.primitives.some((p) => p.layer === 'decor')).toBe(false);
    expect(plain.primitives).toEqual(withDecor.primitives.filter((p) => p.layer !== 'decor'));
    expect(plain.cells).toEqual(withDecor.cells);
  });

  it('rejects invalid input with RangeError', () => {
    const ok: EncodeInput = { data: DATA, genomeGlyphs: GLYPHS };
    const bad: unknown[] = [
      null,
      { ...ok, data: DATA.subarray(1) },
      { ...ok, data: new Uint8Array(80) },
      { ...ok, data: [...DATA] },
      { ...ok, codeVersion: 2 },
      { ...ok, mask: 4 },
      { ...ok, mask: -1 },
      { ...ok, mask: 0.5 },
      { ...ok, genomeGlyphs: GLYPHS.slice(1) },
      { ...ok, genomeGlyphs: undefined },
      { ...ok, genomeGlyphs: [...GLYPHS.slice(1), 16] },
      { ...ok, genomeGlyphs: [...GLYPHS.slice(1), -1] },
    ];
    for (const input of bad) expect(() => encodeOrbesCode(input as EncodeInput)).toThrow(RangeError);
  });
});

// ── maskPenalty ────────────────────────────────────────────────────────────

/** Alternating ink/paper on every ring: no long runs, balanced, no empty patches. */
function alternatingCells(): Uint8Array {
  const cells = new Uint8Array(CODE01_TOTAL_CELLS);
  for (const ring of CODE01_RINGS) for (let c = 0; c < ring.cells; c++) cells[ring.offset + c] = c % 2;
  return cells;
}

/** Documented regions: 8 sectors of 45° by cell mid angle × bands of rings 0–5, 6–9, 10–12. */
function regionOf(ring: RingSpec, cell: number): number {
  const band = ring.index <= 5 ? 0 : ring.index <= 9 ? 1 : 2;
  return band * 8 + Math.floor(((cell + 0.5) * 8) / ring.cells);
}

describe('maskPenalty', () => {
  it('is zero for an alternating pattern and huge for blank or solid cells', () => {
    expect(maskPenalty(alternatingCells())).toEqual({ runs: 0, balance: 0, patches: 0, total: 0 });
    const blank = maskPenalty(new Uint8Array(CODE01_TOTAL_CELLS));
    const solid = maskPenalty(new Uint8Array(CODE01_TOTAL_CELLS).fill(1));
    const expectedRuns = CODE01_RINGS.reduce((sum, ring) => sum + (ring.cells - 9) ** 2, 0);
    expect(blank.runs).toBe(expectedRuns);
    expect(solid.runs).toBe(expectedRuns);
    expect(solid.balance).toBeCloseTo(24 * 40 * 0.35, 9);
    expect(solid.patches).toBe(0);
    // Every pair of adjacent blank rings overlaps over the full turn.
    const fullOverlap = CODE01_RINGS.slice(1).reduce((sum, ring, k) => sum + 2 * TAU * ((ring.radius + CODE01_RINGS[k].radius) / 2), 0);
    expect(blank.patches).toBeCloseTo(fullOverlap, 9);
    expect(blank.total).toBeCloseTo(blank.runs + blank.balance + blank.patches, 9);
  });

  it('charges (length − 9)² for a run longer than 9, including runs across north', () => {
    const ring = CODE01_RINGS[3];
    const cells = alternatingCells();
    // Odd cells are ink, so ink on cells n−5 … 5 forms one run of exactly 11 across north.
    for (let k = -5; k <= 5; k++) cells[ring.offset + ((k + ring.cells) % ring.cells)] = 1;
    expect(maskPenalty(cells)).toEqual({ runs: 4, balance: 0, patches: 0, total: 4 });
    // A run of exactly 9 is free.
    const nine = alternatingCells();
    for (let k = 10; k <= 18; k++) nine[ring.offset + k] = 0;
    expect(nine[ring.offset + 9]).toBe(1);
    expect(maskPenalty(nine).runs).toBe(0);
  });

  it('charges 40 per unit of ink-ratio excess beyond 0.15 in a sector', () => {
    for (const fill of [0, 1]) {
      const cells = alternatingCells();
      const target = regionOf(CODE01_RINGS[11], 0) + 2; // band 2, sector 2 (90°–135°)
      let ink = 0;
      let total = 0;
      for (const ring of CODE01_RINGS) {
        for (let c = 0; c < ring.cells; c++) {
          if (regionOf(ring, c) !== target) continue;
          // Three cells in four set to `fill`: a skewed ratio without long runs.
          cells[ring.offset + c] = c % 4 === 0 ? 1 - fill : fill;
          ink += cells[ring.offset + c];
          total++;
        }
      }
      const excess = Math.abs(ink / total - 0.5) - 0.15;
      expect(excess).toBeGreaterThan(0.05);
      const penalty = maskPenalty(cells);
      expect(penalty.runs).toBe(0);
      expect(penalty.balance).toBeCloseTo(40 * excess, 9);
      expect(penalty.total).toBeCloseTo(penalty.runs + penalty.balance + penalty.patches, 9);
    }
  });

  it('charges stacked paper runs of 7+ cells on adjacent rings by overlapping arc length', () => {
    const [inner, outer] = [CODE01_RINGS[4], CODE01_RINGS[5]];
    const stacked = alternatingCells();
    // Cells 0…6 are paper on both rings; cells n−1 and 7 are odd, hence ink.
    for (let c = 0; c < 7; c++) {
      stacked[inner.offset + c] = 0;
      stacked[outer.offset + c] = 0;
    }
    const overlap = (7 * TAU) / outer.cells;
    expect(maskPenalty(stacked)).toEqual({ runs: 0, balance: 0, patches: expect.closeTo(2 * 15 * overlap, 9), total: expect.closeTo(2 * 15 * overlap, 9) });

    // The same runs on opposite sides of the code do not form a patch, nor do runs of 6.
    const apart = alternatingCells();
    const shorter = alternatingCells();
    for (let c = 0; c < 7; c++) {
      apart[inner.offset + c] = 0;
      apart[outer.offset + outer.cells / 2 + c] = 0;
    }
    for (const ring of [inner, outer]) {
      for (let c = 0; c < 6; c++) shorter[ring.offset + c] = 0;
      shorter[ring.offset + 6] = 1;
    }
    expect(maskPenalty(apart).patches).toBe(0);
    expect(maskPenalty(shorter).patches).toBe(0);
  });

  it('rejects anything but a full array of 0/1 cells', () => {
    expect(() => maskPenalty(new Uint8Array(CODE01_TOTAL_CELLS - 1))).toThrow(RangeError);
    expect(() => maskPenalty(new Uint8Array(CODE01_TOTAL_CELLS).fill(2))).toThrow(RangeError);
    expect(() => maskPenalty([] as unknown as Uint8Array)).toThrow(RangeError);
  });
});
