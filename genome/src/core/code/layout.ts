/**
 * ORBES CODE-01: placement of the Reed-Solomon codeword and the format word on
 * the orbital cell array. Shared by the encoder (forward) and the decoder
 * (inverse), so both sides follow one normative definition:
 *
 *   1. bit j of the 164-byte codeword (byte j >> 3, most significant bit
 *      first) is stored in cell CODE01_DATA_CELLS[j]; the padding data cells
 *      after the last codeword bit carry 0;
 *   2. every data cell at position p of CODE01_DATA_CELLS is XORed with
 *      maskBits(mask)[p]. Format cells are never masked: the format word is
 *      what tells the decoder which mask to remove;
 *   3. the 15-bit format word is written most significant bit first into both
 *      copies: bit b (0 = MSB) goes to cell CODE01_FORMAT_CELLS[copy][b].
 *
 * Cell values: 1 = ink, 0 = paper. Cells are flat indices (ring-major,
 * clockwise from north), see profile.ts.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import {
  CODE01,
  CODE01_DATA_BITS,
  CODE01_DATA_CELLS,
  CODE01_FORMAT_CELLS,
  CODE01_TOTAL_CELLS,
  maskBits,
} from './profile.js';

const FORMAT_MSB = CODE01.format.bits - 1;
const FORMAT_WORD_MAX = (1 << CODE01.format.bits) - 1;

/** Codeword byte carried by each flat cell, −1 for format and padding cells. */
const CELL_BYTE: Int16Array = (() => {
  const table = new Int16Array(CODE01_TOTAL_CELLS).fill(-1);
  for (let j = 0; j < CODE01_DATA_BITS; j++) table[CODE01_DATA_CELLS[j]] = j >> 3;
  return table;
})();

function requireCodeword(codeword: Uint8Array): void {
  if (!(codeword instanceof Uint8Array) || codeword.length !== CODE01.ecc.totalBytes) {
    throw new RangeError(`a CODE-01 codeword has ${CODE01.ecc.totalBytes} bytes`);
  }
}

/** Throws RangeError unless `cells` holds exactly CODE01_TOTAL_CELLS values, each 0 or 1. */
export function assertCellArray(cells: ArrayLike<number>): void {
  if (cells === null || typeof cells !== 'object' || cells.length !== CODE01_TOTAL_CELLS) {
    throw new RangeError(`a CODE-01 cell array has ${CODE01_TOTAL_CELLS} cells`);
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0 && cells[i] !== 1) throw new RangeError(`cell ${i} is ${cells[i]}, expected 0 or 1`);
  }
}

/**
 * Final printed cell state (steps 1–3): codeword placed and masked, format
 * word in both copies. Throws RangeError on a wrong codeword length, an
 * invalid mask or a format word outside 15 bits.
 */
export function placeCells(codeword: Uint8Array, mask: number, formatWord: number): Uint8Array {
  requireCodeword(codeword);
  if (!Number.isInteger(formatWord) || formatWord < 0 || formatWord > FORMAT_WORD_MAX) {
    throw new RangeError(`format word ${formatWord} is not a ${CODE01.format.bits}-bit integer`);
  }
  const bits = maskBits(mask);
  const cells = new Uint8Array(CODE01_TOTAL_CELLS);
  CODE01_DATA_CELLS.forEach((flat, p) => {
    const bit = p < CODE01_DATA_BITS ? (codeword[p >> 3] >> (7 - (p & 7))) & 1 : 0;
    cells[flat] = bit ^ bits[p];
  });
  for (const copy of CODE01_FORMAT_CELLS) {
    copy.forEach((flat, b) => {
      cells[flat] = (formatWord >> (FORMAT_MSB - b)) & 1;
    });
  }
  return cells;
}

/** The raw 15-bit words read from the two format copies (not BCH-decoded). */
export function readFormatWords(cells: ArrayLike<number>): [number, number] {
  assertCellArray(cells);
  const [first, second] = CODE01_FORMAT_CELLS.map((copy) => copy.reduce((word, flat) => (word << 1) | cells[flat], 0));
  return [first, second];
}

/**
 * Inverse of placeCells: removes the mask and reassembles the codeword. Pure:
 * no error correction happens here, the codeword goes to rsDecode next.
 * `cells` must hold exactly CODE01_TOTAL_CELLS values, each 0 or 1.
 */
export function decodeCellsToCodeword(
  cells: ArrayLike<number>,
  mask: number,
): { codeword: Uint8Array; formatWords: [number, number] } {
  const formatWords = readFormatWords(cells);
  const bits = maskBits(mask);
  const codeword = new Uint8Array(CODE01.ecc.totalBytes);
  for (let j = 0; j < CODE01_DATA_BITS; j++) {
    codeword[j >> 3] |= (cells[CODE01_DATA_CELLS[j]] ^ bits[j]) << (7 - (j & 7));
  }
  return { codeword, formatWords };
}

/**
 * Codeword byte whose bit a flat cell carries, or −1 for format and padding
 * cells. Lets the decoder turn unreliable cells (glare, occlusion) into
 * Reed-Solomon erasure positions.
 */
export function cellByteIndex(flat: number): number {
  if (!Number.isInteger(flat) || flat < 0 || flat >= CODE01_TOTAL_CELLS) throw new RangeError(`cell ${flat} out of range`);
  return CELL_BYTE[flat];
}

/** Maximal run of cyclically consecutive cells sharing one value. */
export interface CellRun {
  /** First cell, 0 ≤ start < n. */
  start: number;
  /** Number of cells; a run may wrap past cell n − 1 back to cell 0. */
  length: number;
  value: number;
}

/**
 * Cyclic run-length decomposition of one ring (`values[c]` for cell c).
 * Runs are ordered by start; a run crossing north (cell n − 1 → 0) is one
 * run, listed last. A uniform ring is a single run of length n starting at 0.
 */
export function cyclicRuns(values: ArrayLike<number>): CellRun[] {
  const n = values.length;
  if (n === 0) return [];
  let first = -1;
  for (let c = 0; c < n && first < 0; c++) if (values[c] !== values[(c + n - 1) % n]) first = c;
  if (first < 0) return [{ start: 0, length: n, value: values[0] }];

  const runs: CellRun[] = [];
  let start = first;
  for (let k = 1; k <= n; k++) {
    const c = (first + k) % n;
    if (k === n || values[c] !== values[start]) {
      runs.push({ start, length: (c - start + n) % n, value: values[start] });
      start = c;
    }
  }
  return runs;
}
