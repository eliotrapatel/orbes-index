/**
 * A small QR code encoder (desktop, BRIEF §5.4: the SCAN page's code, which a phone's camera opens): byte mode,
 * error correction level M, versions 1 to 40 (the smallest that holds the text), the mask with the lowest penalty, as
 * ISO/IEC 18004 sets them. No dependency; drawn as an SVG of whole modules (`qrSvg`): dark modules on pure white with a
 * quiet zone of 4 modules, in both modes (never ivory, no plate beyond the quiet zone).
 *
 * The matrix is `modules[y][x]`, true for a dark module.
 */
import { s } from './dom.js';

/** Level M's error-correction codewords per block, and its number of blocks, for versions 1 to 40. */
const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28] as const;
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] as const;
/** Level M in the format information. */
const FORMAT_M = 0;

/** The modules of a version that carry data and error correction (every module but the function patterns). */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver - 1]! * BLOCKS_M[ver - 1]!;
}

// ── Reed–Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1 ──────────────────────

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// ── The matrix ─────────────────────────────────────────────────────────────

class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly fn: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.fn[y]![x] = true;
  }

  alignmentPositions(): number[] {
    const ver = this.version;
    if (ver === 1) return [];
    const count = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
    const out = [6];
    for (let pos = this.size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  drawFunctionPatterns(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const pos = this.alignmentPositions();
    const last = pos.length - 1;
    pos.forEach((x, i) =>
      pos.forEach((y, j) => {
        if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) this.alignment(x, y);
      }),
    );
    // Reserved now, written once the mask is chosen.
    this.drawFormat(0);
    this.drawVersion();
  }

  private finder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, d !== 2 && d !== 4);
      }
    }
  }

  private alignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(mask: number): void {
    const data = (FORMAT_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    // The dark module, always.
    this.set(8, n - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  /** The codewords in the zigzag of two-module columns from the right, the timing column skipped. */
  drawCodewords(data: readonly number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.fn[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = ((data[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.fn[y]![x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /** The standard penalty: runs of five or more, 2 × 2 blocks, finder-like patterns, the balance of dark and light. */
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && get(i) === get(i - 1)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // 1:1:3:1:1 with four light modules on one side.
      for (let i = 0; i + 10 < n; i++) {
        const p = [true, false, true, true, true, false, true];
        const core = p.every((v, k) => get(i + k) === v) || p.every((v, k) => get(i + 4 + k) === v);
        if (!core) continue;
        const a = p.every((v, k) => get(i + k) === v) && [7, 8, 9, 10].every((k) => !get(i + k));
        const b = p.every((v, k) => get(i + 4 + k) === v) && [0, 1, 2, 3].every((k) => !get(i + k));
        if (a) score += 40;
        if (b) score += 40;
      }
    };
    for (let y = 0; y < n; y++) line((i) => m[y]![i]!);
    for (let x = 0; x < n; x++) line((i) => m[i]![x]!);
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** The data codewords of `bytes` in byte mode at `ver`, terminated and padded. */
function dataBits(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** The data split into blocks, each with its error correction, interleaved as the matrix reads them. */
function withErrorCorrection(data: readonly number[], ver: number): number[] {
  const blocks = BLOCKS_M[ver - 1]!;
  const eccLen = ECC_PER_BLOCK_M[ver - 1]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const out: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    // A short block takes a place-holder so every block is as long as the long ones.
    if (i < shortBlocks) dat.push(-1);
    out.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < out[0]!.length; i++) {
    out.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/** The QR code of `text` (UTF-8, byte mode, level M): its modules, `[y][x]`, true when dark. */
export function qrModules(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  for (; ver <= 40; ver++) {
    const header = 4 + (ver <= 9 ? 8 : 16);
    if (header + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > 40) throw new RangeError('Text too long for a QR code');
  const codewords = withErrorCorrection(dataBits(bytes, ver), ver);
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = new Matrix(ver);
    m.drawFunctionPatterns();
    m.drawCodewords(codewords);
    m.applyMask(mask);
    m.drawFormat(mask);
    const score = m.penalty();
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best!.modules;
}

/** The quiet zone round a code, in modules. */
export const QR_QUIET = 4;

/**
 * The QR code of `text` as an SVG: one module per unit (its viewBox the code and its quiet zone), dark modules in black
 * on pure white, edges kept crisp; `label` names it for a screen reader. Its size on the page is the layout's (a whole
 * number of pixels per module).
 */
export function qrSvg(text: string, opts: { label: string; className?: string }): SVGSVGElement {
  const modules = qrModules(text);
  const n = modules.length + QR_QUIET * 2;
  let d = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      d += `M${x + QR_QUIET} ${y + QR_QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  });
  const svg = s(
    'svg',
    { class: opts.className ?? 'qr', viewBox: `0 0 ${n} ${n}`, role: 'img', 'aria-label': opts.label, 'shape-rendering': 'crispEdges', 'data-modules': n },
    s('rect', { width: n, height: n, fill: '#ffffff' }),
    s('path', { d, fill: '#000000' }),
  );
  return svg;
}
