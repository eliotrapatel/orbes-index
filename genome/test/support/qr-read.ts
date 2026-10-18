/**
 * A QR code reader for the tests (desktop: the SCAN page's code, shared/qr.ts), written from ISO/IEC 18004 on its
 * own, never from the encoder's code: a module matrix (`modules[y][x]`, true for a dark module) read as a phone's camera
 * app reads it once the grid is found. Versions 1 to 10 (the SCAN page's address is a version 3), any error-correction
 * level for the format, level M for the data; byte mode. Every check fails loudly: the finder, timing and alignment
 * patterns and the dark module where the standard puts them, both copies of the format information valid and equal,
 * both copies of the version information (from version 7), every block's Reed–Solomon syndromes zero (no error is
 * corrected: a code drawn by the app must be exact), the data's mode, count, terminator and padding.
 *
 * `modulesFromPixels` samples a screenshot (an RGBA buffer) back to its modules, from the code's box on the page and its
 * number of modules quiet zone included, each module read at its centre.
 */

/** What a code holds and how it was built. */
export interface QrReading {
  version: number;
  level: 'L' | 'M' | 'Q' | 'H';
  mask: number;
  text: string;
}

/** ISO/IEC 18004 Table 9, level M, versions 1 to 10: total codewords, then [blocks, data codewords per block] groups. */
const LEVEL_M: Readonly<Record<number, { total: number; ecPerBlock: number; groups: readonly (readonly [number, number])[] }>> = {
  1: { total: 26, ecPerBlock: 10, groups: [[1, 16]] },
  2: { total: 44, ecPerBlock: 16, groups: [[1, 28]] },
  3: { total: 70, ecPerBlock: 26, groups: [[1, 44]] },
  4: { total: 100, ecPerBlock: 18, groups: [[2, 32]] },
  5: { total: 134, ecPerBlock: 24, groups: [[2, 43]] },
  6: { total: 172, ecPerBlock: 16, groups: [[4, 27]] },
  7: { total: 196, ecPerBlock: 18, groups: [[4, 31]] },
  8: { total: 242, ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9: { total: 292, ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { total: 346, ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};

/** Byte-mode capacity at level M (ISO/IEC 18004 Table 7), versions 1 to 10. */
export const BYTE_CAPACITY_M: readonly number[] = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

/** The centres of the alignment patterns' rows and columns (ISO/IEC 18004 Annex E), versions 1 to 10. */
const ALIGNMENT: Readonly<Record<number, readonly number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const LEVELS = ['M', 'L', 'H', 'Q'] as const;

// ── GF(256) over x^8 + x^4 + x^3 + x^2 + 1 ────────────────────────────────────

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** The block's syndromes r(α^i), i = 0 … ec − 1 (the code's generator has the roots α^0 … α^(ec−1)): all zero when exact. */
function syndromes(block: readonly number[], ec: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ec; i++) {
    let s = 0;
    for (const c of block) s = mul(s, EXP[i]!) ^ c;
    out.push(s);
  }
  return out;
}

// ── BCH codes of the format (15, 5) and the version (18, 6) ─────────────────

function bch(value: number, bits: number, generator: number, genBits: number): number {
  let v = value << (genBits - 1);
  for (let i = bits + genBits - 2; i >= genBits - 1; i--) if ((v >> i) & 1) v ^= generator << (i - (genBits - 1));
  return (value << (genBits - 1)) | v;
}
/** The 15 bits of the format information for (level bits, mask), masked with 101010000010010. */
export const formatBits = (levelBits: number, mask: number): number => bch((levelBits << 3) | mask, 5, 0x537, 11) ^ 0x5412;
/** The 18 bits of the version information of `version` (7 and above). */
export const versionBits = (version: number): number => bch(version, 6, 0x1f25, 13);

const ones = (x: number) => x.toString(2).replace(/0/g, '').length;

/** Mask condition (ISO/IEC 18004 Table 10), i the row, j the column: true where the module is inverted. */
function masked(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

export class QrReadError extends Error {}
function fail(message: string): never {
  throw new QrReadError(message);
}

/** Read the text of a QR code's modules, checking everything the standard fixes. */
export function readQr(modules: readonly (readonly boolean[])[]): QrReading {
  const n = modules.length;
  if (n < 21 || (n - 17) % 4 !== 0 || modules.some((row) => row.length !== n)) fail(`not a QR matrix: ${n} rows`);
  const version = (n - 17) / 4;
  if (version > 10) fail(`version ${version}: this reader reads versions 1 to 10`);
  const at = (x: number, y: number) => modules[y]![x]!;
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const reserve = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) fn[y]![x] = true;
  };

  // The finder patterns and their separators: a 7 × 7 ring, a 3 × 3 core, a light border.
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        reserve(x, y);
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const dark = d === 4 ? false : d !== 2;
        if (at(x, y) !== dark) fail(`finder at (${cx}, ${cy}): module (${x}, ${y}) is ${at(x, y) ? 'dark' : 'light'}`);
      }
    }
  }
  // The timing patterns, row 6 and column 6, dark on even positions.
  for (let k = 8; k < n - 8; k++) {
    reserve(k, 6);
    reserve(6, k);
    if (at(k, 6) !== (k % 2 === 0) || at(6, k) !== (k % 2 === 0)) fail(`timing pattern broken at ${k}`);
  }
  // The alignment patterns: every pair of centres but those on a finder.
  const centres = ALIGNMENT[version]!;
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === n - 7) || (cx === n - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          reserve(cx + dx, cy + dy);
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          if (at(cx + dx, cy + dy) !== dark) fail(`alignment pattern at (${cx}, ${cy}) broken`);
        }
      }
    }
  }
  // The dark module.
  reserve(8, n - 8);
  if (!at(8, n - 8)) fail('the dark module is light');

  // The format information, both copies (bit 14 first: the most significant).
  const first: [number, number][] = [];
  for (let x = 0; x <= 5; x++) first.push([x, 8]);
  first.push([7, 8], [8, 8], [8, 7]);
  for (let y = 5; y >= 0; y--) first.push([8, y]);
  const second: [number, number][] = [];
  for (let y = n - 1; y >= n - 7; y--) second.push([8, y]);
  for (let x = n - 8; x < n; x++) second.push([x, 8]);
  const readBits = (cells: readonly [number, number][]) =>
    cells.reduce((v, [x, y]) => {
      reserve(x, y);
      return (v << 1) | (at(x, y) ? 1 : 0);
    }, 0);
  const formats = [readBits(first), readBits(second)];
  if (formats[0] !== formats[1]) fail(`the two copies of the format information differ: ${formats[0]} and ${formats[1]}`);
  let format: { levelBits: number; mask: number } | null = null;
  for (let levelBits = 0; levelBits < 4; levelBits++) for (let mask = 0; mask < 8; mask++) if (formatBits(levelBits, mask) === formats[0]) format = { levelBits, mask };
  if (!format) fail(`format information ${formats[0]!.toString(2)} is no valid code word`);
  const level = LEVELS[format.levelBits]!;

  // The version information (version 7 and above), both copies (bit 17 first).
  if (version >= 7) {
    const read = (corner: 'top-right' | 'bottom-left') => {
      let v = 0;
      for (let k = 17; k >= 0; k--) {
        const a = Math.floor(k / 3);
        const b = n - 11 + (k % 3);
        const [x, y] = corner === 'top-right' ? [b, a] : [a, b];
        reserve(x, y);
        v = (v << 1) | (at(x, y) ? 1 : 0);
      }
      return v;
    };
    for (const corner of ['top-right', 'bottom-left'] as const) {
      const v = read(corner);
      if (v !== versionBits(version)) fail(`version information (${corner}) ${v.toString(2)} is not version ${version}'s (${ones(v ^ versionBits(version))} bits off)`);
    }
  }
  if (level !== 'M') fail(`level ${level}: this reader reads level M's data`);

  // The codewords, in the zigzag from the bottom right, two columns at a time, column 6 skipped, unmasked.
  const bits: number[] = [];
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) {
      const y = upward ? n - 1 - k : k;
      for (const x of [right, right - 1]) {
        if (fn[y]![x]) continue;
        bits.push((at(x, y) !== masked(format.mask, y, x)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const table = LEVEL_M[version]!;
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length && codewords.length < table.total; i += 8) codewords.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  if (codewords.length !== table.total) fail(`${codewords.length} codewords for ${table.total}`);

  // De-interleaved: the data codewords column by column across the blocks, then the error-correction codewords.
  const sizes = table.groups.flatMap(([count, data]) => new Array<number>(count).fill(data));
  const blocks = sizes.map(() => [] as number[]);
  let p = 0;
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) sizes.forEach((size, b) => i < size && blocks[b]!.push(codewords[p++]!));
  for (let i = 0; i < table.ecPerBlock; i++) blocks.forEach((block) => block.push(codewords[p++]!));
  if (p !== table.total) fail(`${p} codewords placed for ${table.total}`);
  blocks.forEach((block, b) => {
    const s = syndromes(block, table.ecPerBlock);
    if (s.some((x) => x !== 0)) fail(`block ${b + 1}: Reed–Solomon syndromes not zero`);
  });
  const data = blocks.flatMap((block, b) => block.slice(0, sizes[b]));

  // The data: byte mode, its count, its bytes, the terminator, then 11101100 00010001 to the end.
  const stream = data.flatMap((c) => [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (c >> k) & 1));
  let q = 0;
  const take = (k: number) => {
    let v = 0;
    for (let i = 0; i < k; i++) v = (v << 1) | (stream[q++] ?? fail('the data ends too soon'));
    return v;
  };
  const mode = take(4);
  if (mode !== 0b0100) fail(`mode ${mode.toString(2)}: not byte mode`);
  const count = take(version <= 9 ? 8 : 16);
  const bytes = Uint8Array.from({ length: count }, () => take(8));
  const left = stream.length - q;
  const terminator = Math.min(4, left);
  if (take(terminator) !== 0) fail('no terminator after the data');
  while (q % 8 !== 0) if (take(1) !== 0) fail('the padding to a codeword is not zero');
  for (let k = 0; q < stream.length; k++) if (take(8) !== (k % 2 === 0 ? 0xec : 0x11)) fail('the pad codewords are not 11101100 00010001');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { version, level, mask: format.mask, text };
}

/**
 * The modules of a code drawn on a screenshot: `rgba` the picture (`width` pixels wide), `box` the code's box in it
 * (its quiet zone included), `count` its modules across (quiet zone included), each read at its centre (dark below
 * half the white's luminance). The quiet zone is checked light, and the code returned without it.
 */
export function modulesFromPixels(rgba: Uint8Array, width: number, box: { x: number; y: number; size: number }, count: number, quiet: number): boolean[][] {
  const step = box.size / count;
  const dark = (mx: number, my: number) => {
    const px = Math.floor(box.x + (mx + 0.5) * step);
    const py = Math.floor(box.y + (my + 0.5) * step);
    const i = (py * width + px) * 4;
    const lum = 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
    return lum < 128;
  };
  const out: boolean[][] = [];
  for (let my = 0; my < count; my++) {
    const row: boolean[] = [];
    for (let mx = 0; mx < count; mx++) {
      const inQuiet = mx < quiet || my < quiet || mx >= count - quiet || my >= count - quiet;
      const d = dark(mx, my);
      if (inQuiet && d) throw new QrReadError(`the quiet zone is dark at module (${mx}, ${my})`);
      if (!inQuiet) row.push(d);
    }
    if (my >= quiet && my < count - quiet) out.push(row);
  }
  return out;
}
