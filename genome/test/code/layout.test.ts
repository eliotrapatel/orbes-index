import { describe, expect, it } from 'vitest';
import {
  assertCellArray,
  cellByteIndex,
  cyclicRuns,
  decodeCellsToCodeword,
  placeCells,
  readFormatWords,
  type CellRun,
} from '../../src/core/code/layout.js';
import {
  CODE01,
  CODE01_DATA_BITS,
  CODE01_DATA_CELLS,
  CODE01_FORMAT_CELLS,
  CODE01_MASK_COUNT,
  CODE01_PADDING_CELLS,
  CODE01_RINGS,
  CODE01_TOTAL_CELLS,
  formatInfoValue,
  maskBits,
} from '../../src/core/code/profile.js';
import { bchFormatDecode, bchFormatEncode } from '../../src/core/ecc/index.js';
import { Prng } from '../support/prng.js';

const MASKS = Array.from({ length: CODE01_MASK_COUNT }, (_, m) => m);
const CODEWORD_BYTES = CODE01.ecc.totalBytes;
const formatWordFor = (mask: number): number => bchFormatEncode(formatInfoValue(1, mask));
const randomBytes = (rng: Prng, n: number): Uint8Array => Uint8Array.from({ length: n }, () => rng.int(0, 255));
const randomCells = (rng: Prng): Uint8Array => Uint8Array.from({ length: CODE01_TOTAL_CELLS }, () => rng.int(0, 1));

describe('placeCells and decodeCellsToCodeword', () => {
  it('round-trip random codewords under every mask, with the format word in both copies', () => {
    const rng = new Prng('layout/round-trip');
    for (let n = 0; n < 40; n++) {
      const codeword = randomBytes(rng, CODEWORD_BYTES);
      for (const mask of MASKS) {
        const formatWord = formatWordFor(mask);
        const cells = placeCells(codeword, mask, formatWord);
        expect(cells).toHaveLength(CODE01_TOTAL_CELLS);
        const decoded = decodeCellsToCodeword(cells, mask);
        expect(decoded.codeword).toEqual(codeword);
        expect(decoded.formatWords).toEqual([formatWord, formatWord]);
      }
    }
  });

  it('are exact inverses at the cell level: any consistent cell state re-encodes to itself', () => {
    const rng = new Prng('layout/cell-inverse');
    for (const mask of MASKS) {
      const cells = randomCells(rng);
      // Consistent = padding cells hold their mask bit and both format copies agree.
      const bits = maskBits(mask);
      for (let p = CODE01_DATA_BITS; p < CODE01_DATA_CELLS.length; p++) cells[CODE01_DATA_CELLS[p]] = bits[p];
      CODE01_FORMAT_CELLS[1].forEach((flat, b) => (cells[flat] = cells[CODE01_FORMAT_CELLS[0][b]]));
      const { codeword, formatWords } = decodeCellsToCodeword(cells, mask);
      expect(placeCells(codeword, mask, formatWords[0])).toEqual(cells);
    }
  });

  it('store codeword bit j (byte j >> 3, MSB first) in data cell j, XORed with the mask', () => {
    const rng = new Prng('layout/bit-order');
    const probes = [0, 1, 7, 8, 9, 100, 777, CODE01_DATA_BITS - 1, ...Array.from({ length: 40 }, () => rng.int(0, CODE01_DATA_BITS - 1))];
    for (const mask of MASKS) {
      const base = placeCells(new Uint8Array(CODEWORD_BYTES), mask, 0);
      for (const j of probes) {
        const codeword = new Uint8Array(CODEWORD_BYTES);
        codeword[j >> 3] = 0x80 >> (j & 7);
        const cells = placeCells(codeword, mask, 0);
        const changed = [...cells.keys()].filter((i) => cells[i] !== base[i]);
        expect(changed).toEqual([CODE01_DATA_CELLS[j]]);
      }
    }
  });

  it('mask every data cell including padding, and never the format cells', () => {
    for (const mask of MASKS) {
      const bits = maskBits(mask);
      const zeros = placeCells(new Uint8Array(CODEWORD_BYTES), mask, 0);
      const ones = placeCells(new Uint8Array(CODEWORD_BYTES).fill(0xff), mask, 0x7fff);
      CODE01_DATA_CELLS.forEach((flat, p) => {
        expect(zeros[flat]).toBe(bits[p]);
        // Padding cells carry 0 before masking whatever the codeword holds.
        expect(ones[flat]).toBe(p < CODE01_DATA_BITS ? 1 - bits[p] : bits[p]);
      });
      for (const flat of CODE01_FORMAT_CELLS.flat()) {
        expect(zeros[flat]).toBe(0);
        expect(ones[flat]).toBe(1);
      }
    }
    expect(CODE01_PADDING_CELLS).toBe(2);
  });

  it('write all 32 format words MSB first into both copies on ring 0', () => {
    const ring0 = CODE01_RINGS[CODE01.format.ring];
    expect(CODE01_FORMAT_CELLS.map((copy) => copy[0] - ring0.offset)).toEqual([...CODE01.format.copyStarts]);
    for (let value = 0; value < 32; value++) {
      const word = bchFormatEncode(value);
      const cells = placeCells(new Uint8Array(CODEWORD_BYTES), value & 3, word);
      for (const copy of CODE01_FORMAT_CELLS) {
        copy.forEach((flat, b) => expect(cells[flat]).toBe((word >> (14 - b)) & 1));
      }
      const words = readFormatWords(cells);
      expect(words).toEqual([word, word]);
      expect(bchFormatDecode(words[1]).value).toBe(value);
    }
  });

  it('read the two format copies independently', () => {
    const word = formatWordFor(2);
    const cells = placeCells(new Uint8Array(CODEWORD_BYTES), 2, word);
    for (const b of [0, 6, 14]) cells[CODE01_FORMAT_CELLS[1][b]] ^= 1;
    const flipped = word ^ (1 << 14) ^ (1 << 8) ^ 1;
    expect(readFormatWords(cells)).toEqual([word, flipped]);
    expect(decodeCellsToCodeword(cells, 2).formatWords).toEqual([word, flipped]);
    expect(bchFormatDecode(flipped).value).toBe(formatInfoValue(1, 2));
  });

  it('leave their inputs untouched and the shared mask tables intact', () => {
    const rng = new Prng('layout/purity');
    const codeword = randomBytes(rng, CODEWORD_BYTES);
    const codewordCopy = codeword.slice();
    const maskCopy = maskBits(1).slice();
    const cells = placeCells(codeword, 1, formatWordFor(1));
    const cellsCopy = cells.slice();
    decodeCellsToCodeword(cells, 1);
    expect(codeword).toEqual(codewordCopy);
    expect(cells).toEqual(cellsCopy);
    expect(maskBits(1)).toEqual(maskCopy);
    expect(placeCells(codeword, 1, formatWordFor(1))).not.toBe(cells);
  });

  it('accept plain arrays of cells', () => {
    const rng = new Prng('layout/array-like');
    const codeword = randomBytes(rng, CODEWORD_BYTES);
    const cells = Array.from(placeCells(codeword, 3, formatWordFor(3)));
    expect(decodeCellsToCodeword(cells, 3).codeword).toEqual(codeword);
  });

  it('reject malformed input with RangeError', () => {
    const codeword = new Uint8Array(CODEWORD_BYTES);
    expect(() => placeCells(new Uint8Array(CODEWORD_BYTES - 1), 0, 0)).toThrow(RangeError);
    expect(() => placeCells([...codeword] as unknown as Uint8Array, 0, 0)).toThrow(RangeError);
    for (const mask of [-1, 4, 1.5, Number.NaN]) expect(() => placeCells(codeword, mask, 0)).toThrow(RangeError);
    for (const word of [-1, 0x8000, 2.5]) expect(() => placeCells(codeword, 0, word)).toThrow(RangeError);

    const cells = placeCells(codeword, 0, 0);
    expect(() => decodeCellsToCodeword(cells.subarray(1), 0)).toThrow(RangeError);
    expect(() => decodeCellsToCodeword(cells, 4)).toThrow(RangeError);
    const bad = cells.slice();
    bad[500] = 2;
    expect(() => decodeCellsToCodeword(bad, 0)).toThrow(/cell 500/);
    expect(() => readFormatWords(bad)).toThrow(RangeError);
    expect(() => assertCellArray(null as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => assertCellArray(cells)).not.toThrow();
  });
});

describe('cellByteIndex', () => {
  it('maps the eight cells of every codeword byte to that byte, format and padding cells to −1', () => {
    const perByte = new Array<number>(CODEWORD_BYTES).fill(0);
    for (let flat = 0; flat < CODE01_TOTAL_CELLS; flat++) {
      const byte = cellByteIndex(flat);
      if (byte >= 0) perByte[byte]++;
    }
    expect(perByte.every((n) => n === 8)).toBe(true);
    for (const flat of CODE01_FORMAT_CELLS.flat()) expect(cellByteIndex(flat)).toBe(-1);
    for (let p = CODE01_DATA_BITS; p < CODE01_DATA_CELLS.length; p++) expect(cellByteIndex(CODE01_DATA_CELLS[p])).toBe(-1);
  });

  it('names exactly the codeword bytes that damaged cells corrupt (erasure mapping)', () => {
    const rng = new Prng('layout/erasures');
    const codeword = randomBytes(rng, CODEWORD_BYTES);
    const cells = placeCells(codeword, 0, formatWordFor(0));
    const damaged = Array.from({ length: 30 }, () => rng.int(0, CODE01_TOTAL_CELLS - 1));
    for (const flat of damaged) cells[flat] ^= 1;
    const read = decodeCellsToCodeword(cells, 0).codeword;
    const corrupted = [...read.keys()].filter((i) => read[i] !== codeword[i]);
    // A byte hit by an even number of flips on the same bit is restored, so ⊆ rather than =.
    const named = new Set(damaged.map(cellByteIndex).filter((b) => b >= 0));
    for (const byte of corrupted) expect(named.has(byte)).toBe(true);
  });

  it('rejects indices outside the cell array', () => {
    for (const flat of [-1, CODE01_TOTAL_CELLS, 0.5]) expect(() => cellByteIndex(flat)).toThrow(RangeError);
  });
});

describe('cyclicRuns', () => {
  it('splits a ring into maximal runs, joining the run that crosses north', () => {
    expect(cyclicRuns([1, 1, 0, 0, 0, 1])).toEqual([
      { start: 2, length: 3, value: 0 },
      { start: 5, length: 3, value: 1 },
    ]);
    expect(cyclicRuns([0, 1, 0, 1])).toEqual([
      { start: 0, length: 1, value: 0 },
      { start: 1, length: 1, value: 1 },
      { start: 2, length: 1, value: 0 },
      { start: 3, length: 1, value: 1 },
    ]);
    expect(cyclicRuns([2, 2, 2])).toEqual([{ start: 0, length: 3, value: 2 }]);
    expect(cyclicRuns([])).toEqual([]);
  });

  it('covers every cell exactly once with uniform, alternating runs (property)', () => {
    const rng = new Prng('layout/runs');
    for (let n = 0; n < 300; n++) {
      const length = rng.int(1, 40);
      const values = Array.from({ length }, () => rng.int(0, 2));
      const runs: CellRun[] = cyclicRuns(values);
      const covered = new Array<number>(length).fill(0);
      runs.forEach((run, i) => {
        expect(run.start).toBeGreaterThanOrEqual(0);
        expect(run.start).toBeLessThan(length);
        if (i > 0) expect(run.start).toBeGreaterThan(runs[i - 1].start);
        for (let k = 0; k < run.length; k++) {
          const c = (run.start + k) % length;
          covered[c]++;
          expect(values[c]).toBe(run.value);
        }
        if (runs.length > 1) expect(runs[(i + 1) % runs.length].value).not.toBe(run.value);
      });
      expect(covered.every((c) => c === 1)).toBe(true);
    }
  });
});
