/**
 * ORBES CODE-01 physical print test sheets (master specification §30).
 *
 *   npx tsx scripts/test-sheets.ts            write docs/assets/test-sheets/
 *   npx tsx scripts/test-sheets.ts --check    exit 1 when the committed files are stale
 *   npx tsx scripts/test-sheets.ts --out DIR  write somewhere else
 *
 * Produces an A4 test kit, as one vector PDF and one SVG per page:
 *
 *   page 1      instructions, contents, a 100 mm calibration ruler
 *   pages 2–8   one rendition per page (black on white, white on black,
 *               ivory paper, matte grey 92 %, textured paper, black leather,
 *               metallic surface), each with the same sample code at 10, 15,
 *               20, 25, 30, 40 and 50 mm on cut-out tags with crop marks, a
 *               results table (sizes × scan distances, 1× and 2× zoom) and a
 *               10 mm scale bar.
 *
 * Every code is a REAL CODE-01 artifact: canonical payload, Ed25519 signature
 * by the PUBLIC SAMPLE KEY of docs/vectors/code01-sample.json (derived from a
 * public string, never a production key; the script refuses to run if the
 * derived public key differs from the published one), CRC, Reed-Solomon,
 * encoder output. Each tag is labelled "SAMPLE - NOT VALID". A production
 * verifier answers INVALID SIGNATURE for them: that still proves the scanner
 * READ the code, which is what the physical test measures.
 *
 * Everything is vector: code primitives are filled outlines (the shared
 * `primitiveToPathData` geometry), lettering is the stroked label alphabet of
 * src/server/render/label-font.ts plus a few punctuation glyphs defined here,
 * substrate textures are seeded vector strokes. No font and no raster image
 * is written, so nothing depends on the machine that opens the file. In the
 * SVG each page's code is defined once and instantiated at every size
 * (`<use>`); in the PDF it is one Form XObject per page. Output is
 * deterministic (fixed seeds, fixed document date), so `--check` and the test
 * suite can compare the committed files byte for byte.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import PDFDocument from 'pdfkit';
import { toHex, utf8 } from '../src/core/bytes.js';
import { CODE01_SIZE, encodeOrbesCode, type OrbesCodeModel } from '../src/core/code/index.js';
import { computeGenome } from '../src/core/genome/index.js';
import { TAU, type Layer, type Primitive } from '../src/core/geometry.js';
import { packIdentity, type ProductIdentity } from '../src/core/identity.js';
import { encodePayload, frameCodeData, issuedDayFromDate, signingMessage } from '../src/core/payload.js';
import { primitiveToPathData } from '../src/core/render/svg.js';
import { verifyCodeSignature } from '../src/core/verify/ed25519.js';
import { LABEL_CHARSET, STROKE_RATIO, measureText, textRun } from '../src/server/render/label-font.js';
import { Prng } from '../test/support/prng.js';

// ── Public parameters ──────────────────────────────────────────────────────

/** Printed code sizes (side of the 50 u artifact, quiet zone included). */
export const SHEET_SIZES_MM = [10, 15, 20, 25, 30, 40, 50] as const;
/** Lens-to-code distances of the physical protocol (and of scripts/print-size-matrix.ts). */
export const SCAN_DISTANCES_CM = [8, 10, 12, 15, 20, 25] as const;
/** Published sample public key (docs/vectors/code01-sample.json, ORBES-CODE-SPEC §13). */
export const SAMPLE_PUBLIC_KEY_HEX = 'd145b2794521745d32c404d83eb924e8245906254b8106ae4adf08d1eaeb01e5';
/** The sample key's key id, as in the published vectors. */
export const SAMPLE_KEY_ID = 1;
/** Document date (PDF metadata, issued day in the payloads): fixed for reproducible output. */
export const SHEET_DATE = new Date(Date.UTC(2026, 9, 1));
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;
export const SAMPLE_LABEL = 'SAMPLE - NOT VALID';
export const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/assets/test-sheets');
export const PDF_FILENAME = 'orbes-code-test-sheets.pdf';

/** Never a production key: derived from a public string (scripts/spec-vectors.ts). */
const SAMPLE_SECRET_KEY = sha256(utf8('ORBES CODE-01 public sample key - never valid in production'));

export type Texture = 'none' | 'paper-fibres' | 'leather-grain' | 'brushed-metal';

/** One printed rendition: a substrate simulated on paper, an ink, a texture. */
export interface Rendition {
  /** 1..7; the rendition is on page index + 1. */
  index: number;
  id: string;
  name: string;
  /** Substrate base colour (and the colour reduced decor tones are pre-mixed against). */
  substrate: string;
  /** Optional sheen across each tag: gradient stops from its top-left to its bottom-right corner. */
  gradient?: readonly string[];
  ink: string;
  /** Print the decorative hairlines (omitted on engraving, as ORBES-CODE-SPEC §3 allows). */
  decor: boolean;
  texture: Texture;
  polarity: 'dark-on-light' | 'light-on-dark';
  /** One-line technical description (label alphabet only). */
  description: string;
  /** The real material this page stands in for. */
  simulates: string;
}

export const RENDITIONS: readonly Rendition[] = [
  {
    index: 1,
    id: 'black-on-white',
    name: 'BLACK ON WHITE',
    substrate: '#FFFFFF',
    ink: '#0A0A0A',
    decor: true,
    texture: 'none',
    polarity: 'dark-on-light',
    description: 'REFERENCE RENDITION · INK #0A0A0A ON WHITE PAPER',
    simulates: 'WHITE PAPER, CARD AND CERTIFICATES',
  },
  {
    index: 2,
    id: 'white-on-black',
    name: 'WHITE ON BLACK',
    substrate: '#0A0A0A',
    ink: '#FFFFFF',
    decor: true,
    texture: 'none',
    polarity: 'light-on-dark',
    description: 'INVERTED POLARITY · WHITE ON #0A0A0A',
    simulates: 'BLACK CARD WITH WHITE PRINT OR FOIL',
  },
  {
    index: 3,
    id: 'ivory',
    name: 'IVORY PAPER',
    substrate: '#F6F2EA',
    ink: '#111111',
    decor: true,
    texture: 'none',
    polarity: 'dark-on-light',
    description: 'SOFT BLACK #111111 ON IVORY #F6F2EA',
    simulates: 'IVORY CARD STOCK, HANG TAGS, CERTIFICATES',
  },
  {
    index: 4,
    id: 'matte-grey',
    name: 'MATTE PAPER · GREY 92 %',
    substrate: '#EBEBEB',
    ink: '#0A0A0A',
    decor: true,
    texture: 'none',
    polarity: 'dark-on-light',
    description: 'BLACK ON 92 % GREY #EBEBEB',
    simulates: 'MATTE GREY OR RECYCLED STOCK',
  },
  {
    index: 5,
    id: 'textured-paper',
    name: 'TEXTURED PAPER',
    substrate: '#F7F4EC',
    ink: '#141414',
    decor: true,
    texture: 'paper-fibres',
    polarity: 'dark-on-light',
    description: 'FIBRE AND SPECK OVERLAY AT LOW CONTRAST, OVER THE CODE',
    simulates: 'COTTON, LAID OR FELT-MARKED PAPER',
  },
  {
    index: 6,
    id: 'black-leather',
    name: 'BLACK LEATHER',
    substrate: '#211C19',
    ink: '#E9E3D7',
    decor: true,
    texture: 'leather-grain',
    polarity: 'light-on-dark',
    description: 'LIGHT INK #E9E3D7 ON GRAINED DARK SUBSTRATE #211C19',
    simulates: 'PRINTED OR FOILED DARK LEATHER',
  },
  {
    index: 7,
    id: 'metallic',
    name: 'METALLIC SURFACE',
    substrate: '#ADADAD',
    gradient: ['#C6C6C6', '#9C9C9C', '#B4B4B4'],
    ink: '#444444',
    decor: false,
    texture: 'brushed-metal',
    polarity: 'dark-on-light',
    description: 'DARKER ENGRAVING #444444 ON BRUSHED MID GREY · NO DECOR',
    simulates: 'LASER ENGRAVED STEEL, SILVER OR BRASS PLATES',
  },
];

// ── Sample codes ───────────────────────────────────────────────────────────

export interface SampleCode {
  rendition: string;
  productId: string;
  identity: ProductIdentity;
  payloadBytes: Uint8Array;
  signature: Uint8Array;
  /** Framed data (payload ‖ signature ‖ CRC), what a decoder must return. */
  data: Uint8Array;
  model: OrbesCodeModel;
}

/** Serials 900001…900007 (one per rendition): far from any demo or production range. */
export function sampleSerial(rendition: Rendition): number {
  return 900_000 + rendition.index;
}

export function samplePublicKey(): Uint8Array {
  return ed25519.getPublicKey(SAMPLE_SECRET_KEY);
}

/** The real, signed sample code printed on a rendition's page. */
export function sampleCodeFor(rendition: Rendition): SampleCode {
  const identity: ProductIdentity = { year: 2026, categoryIndex: 1, serial: sampleSerial(rendition) };
  const payloadBytes = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: SAMPLE_KEY_ID,
    identity,
    issue: 1,
    issuedDay: issuedDayFromDate(SHEET_DATE),
    // "TS0" + rendition index: recognisable, distinct per page.
    nonce: Uint8Array.of(0x54, 0x53, 0x30, rendition.index),
  });
  const signature = ed25519.sign(signingMessage(payloadBytes), SAMPLE_SECRET_KEY);
  const data = frameCodeData(payloadBytes, signature);
  const model = encodeOrbesCode({ data, genomeGlyphs: computeGenome(packIdentity(identity)).glyphs }, { decor: rendition.decor });
  // Category index 1 is "J" in the published vectors (O26-J-00184).
  return { rendition: rendition.id, productId: `O26-J-${identity.serial}`, identity, payloadBytes, signature, data, model };
}

// ── Lettering ──────────────────────────────────────────────────────────────
//
// The label alphabet covers A–Z, 0–9, space, '-', '/', '·'. Instructions also
// need a little punctuation, drawn here in the same glyph space (cap height
// 1, y down, baseline at 1) and the same monoline style.

const circlePath = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}A${r} ${r} 0 0 1 ${cx - r} ${cy}`;

const EXTRA_GLYPHS: Readonly<Record<string, { w: number; d: string }>> = {
  '.': { w: 0.12, d: circlePath(0.06, 0.955, 0.035) },
  ',': { w: 0.12, d: 'M0.08 0.92L0.03 1.12' },
  ':': { w: 0.12, d: circlePath(0.06, 0.43, 0.035) + circlePath(0.06, 0.955, 0.035) },
  '%': { w: 0.8, d: `M0.68 0L0.12 1${circlePath(0.17, 0.2, 0.15)}${circlePath(0.63, 0.8, 0.15)}` },
  '(': { w: 0.26, d: 'M0.24 -0.06A0.42 0.62 0 0 0 0.24 1.06' },
  ')': { w: 0.26, d: 'M0.02 -0.06A0.42 0.62 0 0 1 0.02 1.06' },
  '+': { w: 0.6, d: 'M0.3 0.25L0.3 0.85M0 0.55L0.6 0.55' },
  '=': { w: 0.56, d: 'M0.02 0.42L0.54 0.42M0.02 0.7L0.54 0.7' },
  '±': { w: 0.6, d: 'M0.3 0.16L0.3 0.7M0 0.43L0.6 0.43M0 0.94L0.6 0.94' },
  '≥': { w: 0.56, d: 'M0.04 0.14L0.52 0.4L0.04 0.66M0.04 0.94L0.52 0.94' },
  '>': { w: 0.5, d: 'M0.04 0.2L0.48 0.55L0.04 0.9' },
  '#': { w: 0.72, d: 'M0.32 0L0.2 1M0.62 0L0.5 1M0.04 0.33L0.72 0.33M0.01 0.67L0.69 0.67' },
};

/** Glyph side bearing of the label alphabet (not exported by it): measured. */
const SIDE_BEARING = measureText('II') - 2 * measureText('I');

function glyphAdvance(ch: string): number {
  if (LABEL_CHARSET.has(ch)) return measureText(ch);
  const extra = EXTRA_GLYPHS[ch];
  if (!extra) throw new RangeError(`test sheet lettering: unsupported character ${JSON.stringify(ch)}`);
  return extra.w;
}

/** Width of `text` in mm at cap height `cap`. */
export function textWidth(text: string, cap: number, tracking = 0): number {
  const chars = [...text.toUpperCase()];
  if (chars.length === 0) return 0;
  return (chars.reduce((sum, ch) => sum + glyphAdvance(ch), 0) + (chars.length - 1) * (SIDE_BEARING + tracking)) * cap;
}

function fmt(n: number, decimals = 3): string {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite coordinate ${n}`);
  const s = n.toFixed(decimals).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

const fmt2 = (n: number): string => fmt(n, 2);

/** Absolute M/L/A/Z path data in glyph space → page space (scale s, origin at ox, oy). */
function placeGlyphPath(d: string, ox: number, oy: number, s: number): string {
  const tokens = d.match(/[MLAZ]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  let out = '';
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const c = tokens[i++];
    if (c === 'M' || c === 'L') {
      const x = num();
      const y = num();
      out += `${c}${fmt(ox + x * s)} ${fmt(oy + y * s)}`;
    } else if (c === 'A') {
      const rx = num();
      const ry = num();
      const flags = `${tokens[i++]} ${tokens[i++]} ${tokens[i++]}`;
      const x = num();
      const y = num();
      out += `A${fmt(rx * s)} ${fmt(ry * s)} ${flags} ${fmt(ox + x * s)} ${fmt(oy + y * s)}`;
    } else if (c === 'Z') {
      out += 'Z';
    } else {
      throw new Error(`unexpected glyph path token ${c}`);
    }
  }
  return out;
}

interface TextOptions {
  cap: number;
  tracking?: number;
  x: number;
  baseline: number;
  align?: 'start' | 'middle' | 'end';
  color: string;
  /** Stroke weight multiplier (small type is drawn slightly heavier). */
  weight?: number;
  /**
   * Widest the line may be; a longer line is set at a proportionally smaller
   * cap height. Default for start-aligned text: up to the right page margin.
   */
  maxWidth?: number;
}

/** A line of stroked uppercase lettering, as a display-list item. */
function text(content: string, o: TextOptions): Item {
  const upper = content.toUpperCase();
  const tracking = o.tracking ?? 0;
  const align = o.align ?? 'start';
  const maxWidth = o.maxWidth ?? (align === 'start' ? PAGE_WIDTH_MM - MARGIN - o.x : Infinity);
  const natural = textWidth(upper, o.cap, tracking);
  const cap = natural > maxWidth ? (o.cap * maxWidth) / natural : o.cap;
  const width = textWidth(upper, cap, tracking);
  let pen = align === 'start' ? o.x : align === 'end' ? o.x - width : o.x - width / 2;
  const top = o.baseline - cap;
  let d = '';
  for (const ch of upper) {
    if (ch !== ' ') {
      d += LABEL_CHARSET.has(ch)
        ? textRun(ch, { capHeight: cap, x: pen, baseline: o.baseline, align: 'start' }).d
        : placeGlyphPath(EXTRA_GLYPHS[ch].d, pen, top, cap);
    }
    pen += (glyphAdvance(ch) + SIDE_BEARING + tracking) * cap;
  }
  const weight = o.weight ?? (cap < 1.5 ? 1.3 : 1);
  return { kind: 'stroke', d, width: cap * STROKE_RATIO * weight, color: o.color, text: upper };
}

/** Greedy word wrap to `maxWidth` mm. */
function wrap(content: string, cap: number, tracking: number, maxWidth: number): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && textWidth(candidate, cap, tracking) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Path data: one parser, two emitters ────────────────────────────────────
//
// Every path of the kit (code outlines, lettering, marks, textures) goes
// through `parsePath` into absolute segments, then out either as compact
// relative SVG path data or as PDF path operators. Both emitters see the same
// geometry, so the SVG and PDF pages agree.

export type PathSeg =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'Q'; qx: number; qy: number; x: number; y: number }
  | { c: 'A'; rx: number; ry: number; rot: number; large: boolean; sweep: boolean; x: number; y: number }
  | { c: 'Z' };

/** SVG path data (M L H V Q A Z, absolute or relative, implicit repeats) → absolute segments. */
export function parsePath(d: string): PathSeg[] {
  const tokens = d.match(/[MLHVQAZmlhvqaz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const segs: PathSeg[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = (): number => {
    const t = tokens[i++];
    const v = Number(t);
    if (t === undefined || /^[A-Za-z]$/.test(t) || !Number.isFinite(v)) throw new RangeError(`malformed path data near token ${i}: ${d.slice(0, 80)}`);
    return v;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === '') throw new RangeError('path data must start with a command');
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        x = sx = num() + ox;
        y = sy = num() + oy;
        segs.push({ c: 'M', x, y });
        cmd = rel ? 'l' : 'L'; // further pairs are implicit line-tos
        break;
      }
      case 'L': {
        x = num() + ox;
        y = num() + oy;
        segs.push({ c: 'L', x, y });
        break;
      }
      case 'H':
        x = num() + ox;
        segs.push({ c: 'L', x, y });
        break;
      case 'V':
        y = num() + oy;
        segs.push({ c: 'L', x, y });
        break;
      case 'Q': {
        const qx = num() + ox;
        const qy = num() + oy;
        x = num() + ox;
        y = num() + oy;
        segs.push({ c: 'Q', qx, qy, x, y });
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        x = num() + ox;
        y = num() + oy;
        segs.push({ c: 'A', rx, ry, rot, large, sweep, x, y });
        break;
      }
      case 'Z':
        segs.push({ c: 'Z' });
        x = sx;
        y = sy;
        cmd = '';
        break;
      default:
        throw new RangeError(`unsupported path command ${cmd}`);
    }
  }
  return segs;
}

/**
 * Compact SVG path data: relative commands, `decimals` places, no leading
 * zeros, repeated command letters dropped. Offsets are taken between ROUNDED
 * absolute points, so the decoded points are exactly the rounded originals
 * (no drift along long subpaths).
 */
export function compactPath(segs: readonly PathSeg[], decimals: number): string {
  const q = 10 ** decimals;
  const R = (v: number): number => Math.round(v * q);
  const n = (units: number): string => {
    if (!Number.isFinite(units)) throw new RangeError('non-finite path coordinate');
    let s = (units / q).toFixed(decimals);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s.replace(/^(-?)0\./, '$1.');
  };
  let out = '';
  let last = '';
  const emit = (cmd: string, nums: readonly string[]): void => {
    if (cmd !== last || cmd === 'm') {
      out += cmd;
      last = cmd;
    } else if (!nums[0].startsWith('-')) {
      out += ' ';
    }
    nums.forEach((v, k) => {
      out += (k > 0 && !v.startsWith('-') ? ' ' : '') + v;
    });
  };
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;
  for (const s of segs) {
    if (s.c === 'Z') {
      out += 'z';
      last = 'z';
      px = sx;
      py = sy;
      continue;
    }
    const x = R(s.x);
    const y = R(s.y);
    const dx = x - px;
    const dy = y - py;
    if (s.c === 'M') {
      emit('m', [n(dx), n(dy)]);
      sx = x;
      sy = y;
    } else if (s.c === 'L') {
      if (dy === 0) emit('h', [n(dx)]);
      else if (dx === 0) emit('v', [n(dy)]);
      else emit('l', [n(dx), n(dy)]);
    } else if (s.c === 'Q') {
      emit('q', [n(R(s.qx) - px), n(R(s.qy) - py), n(dx), n(dy)]);
    } else {
      emit('a', [n(R(s.rx)), n(R(s.ry)), n(R(s.rot)), s.large ? '1' : '0', s.sweep ? '1' : '0', n(dx), n(dy)]);
    }
    px = x;
    py = y;
  }
  return out;
}

const pdfNum = (v: number): string => fmt(v, 3);

/**
 * PDF path operators (m, l, c, h) for absolute segments. Quadratics become
 * cubics exactly; unrotated elliptical arcs use the endpoint → centre
 * conversion of SVG 1.1 §F.6.5 (in a y-scaled space where they are circles)
 * and are split into cubic Béziers of at most 90° (radial error < 3·10⁻⁴ r).
 */
export function pdfPathOps(segs: readonly PathSeg[]): string {
  const ops: string[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const s of segs) {
    switch (s.c) {
      case 'M':
        x = sx = s.x;
        y = sy = s.y;
        ops.push(`${pdfNum(x)} ${pdfNum(y)} m`);
        break;
      case 'L':
        x = s.x;
        y = s.y;
        ops.push(`${pdfNum(x)} ${pdfNum(y)} l`);
        break;
      case 'Q': {
        const c1x = x + (2 / 3) * (s.qx - x);
        const c1y = y + (2 / 3) * (s.qy - y);
        const c2x = s.x + (2 / 3) * (s.qx - s.x);
        const c2y = s.y + (2 / 3) * (s.qy - s.y);
        ops.push(`${pdfNum(c1x)} ${pdfNum(c1y)} ${pdfNum(c2x)} ${pdfNum(c2y)} ${pdfNum(s.x)} ${pdfNum(s.y)} c`);
        x = s.x;
        y = s.y;
        break;
      }
      case 'A':
        if (s.rot !== 0) throw new RangeError('rotated arcs are not supported');
        ops.push(...arcToBeziers(x, y, s, (bx, by) => `${pdfNum(bx)} ${pdfNum(by)}`));
        x = s.x;
        y = s.y;
        break;
      case 'Z':
        ops.push('h');
        x = sx;
        y = sy;
        break;
    }
  }
  return ops.join('\n');
}

function arcToBeziers(x1: number, y1: number, a: Extract<PathSeg, { c: 'A' }>, pt: (x: number, y: number) => string): string[] {
  if (!(a.rx > 0 && a.ry > 0)) return [`${pt(a.x, a.y)} l`];
  // Work where the ellipse is a circle of radius rx: y' = y·k.
  const k = a.rx / a.ry;
  const Y1 = y1 * k;
  const X2 = a.x;
  const Y2 = a.y * k;
  const hx = (x1 - X2) / 2;
  const hy = (Y1 - Y2) / 2;
  const d2 = hx * hx + hy * hy;
  if (d2 === 0) return [];
  // Rounded coordinates can leave the chord a hair longer than the diameter: scale up (SVG §F.6.6).
  const r = Math.max(a.rx, Math.sqrt(d2));
  const coef = (a.large !== a.sweep ? 1 : -1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
  const cx = coef * hy + (x1 + X2) / 2;
  const cy = -coef * hx + (Y1 + Y2) / 2;
  const t1 = Math.atan2(Y1 - cy, x1 - cx);
  let dt = Math.atan2(Y2 - cy, X2 - cx) - t1;
  if (a.sweep && dt < 0) dt += TAU;
  if (!a.sweep && dt > 0) dt -= TAU;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const out: string[] = [];
  for (let j = 0; j < n; j++) {
    const a0 = t1 + (dt * j) / n;
    const a1 = t1 + (dt * (j + 1)) / n;
    const kk = (4 / 3) * Math.tan((a1 - a0) / 4);
    const p0x = cx + r * Math.cos(a0);
    const p0y = cy + r * Math.sin(a0);
    const last = j === n - 1;
    const p3x = last ? X2 : cx + r * Math.cos(a1);
    const p3y = last ? Y2 : cy + r * Math.sin(a1);
    const c1x = p0x - kk * r * Math.sin(a0);
    const c1y = p0y + kk * r * Math.cos(a0);
    const c2x = p3x + kk * r * Math.sin(a1);
    const c2y = p3y - kk * r * Math.cos(a1);
    out.push(`${pt(c1x, c1y / k)} ${pt(c2x, c2y / k)} ${pt(p3x, last ? a.y : p3y / k)} c`);
  }
  return out;
}

// ── Display list ───────────────────────────────────────────────────────────

export interface LinearGradient {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: readonly (readonly [number, string])[];
}

export type Item =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string | LinearGradient }
  | { kind: 'stroke'; d: string; width: number; color: string; opacity?: number; text?: string; role?: string }
  | { kind: 'code'; key: string; cx: number; cy: number; sizeMm: number }
  | { kind: 'group'; attrs: Readonly<Record<string, string>>; items: Item[] };

export interface CodeDef {
  key: string;
  code: SampleCode;
  ink: string;
  /** Colour reduced tones are pre-mixed against. */
  paper: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one sample code landed (page millimetres), for tests and the record table. */
export interface TagPlacement {
  rendition: string;
  sizeMm: number;
  productId: string;
  /** The cut-out tag (substrate panel). */
  tag: Rect;
  /** The 50 u artifact square (quiet zone included). */
  code: Rect;
}

export interface SheetPage {
  /** 1-based. */
  number: number;
  slug: string;
  title: string;
  items: Item[];
  codes: CodeDef[];
  tags: TagPlacement[];
}

// ── Page furniture ─────────────────────────────────────────────────────────

const MARGIN = 12;
const INK = '#0A0A0A';
const MUTED = '#5A5A5A';
const RULE = 0.12;
const PAGE_COUNT = RENDITIONS.length + 1;

const TAG_PAD = 3;
const TAG_LABEL_H = 10;
const TAG_GUTTER = 10;
const TAG_ROWS: readonly (readonly number[])[] = [
  [50, 40, 30],
  [25, 20, 15, 10],
];
const SIZE_CAP = 1.7;
const SAMPLE_CAP = 1.05;
const ID_CAP = 0.95;

const TABLE_ROW_H = 7.8;

const CROP_GAP = 1;
const CROP_LEN = 3;
const CROP_WIDTH = 0.1;

function line(x1: number, y1: number, x2: number, y2: number, width = RULE, color = INK, role?: string): Item {
  return { kind: 'stroke', d: `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`, width, color, ...(role ? { role } : {}) };
}

function footer(pageNumber: number): Item[] {
  const y = PAGE_HEIGHT_MM - 10;
  const right = PAGE_WIDTH_MM - MARGIN;
  const bar = `M${fmt(right - 10)} ${fmt(y)}L${fmt(right)} ${fmt(y)}M${fmt(right - 10)} ${fmt(y - 1.2)}L${fmt(right - 10)} ${fmt(y + 1.2)}M${fmt(right)} ${fmt(y - 1.2)}L${fmt(right)} ${fmt(y + 1.2)}`;
  return [
    line(MARGIN, y - 5, right, y - 5, RULE, MUTED),
    text(`ORBES CODE-01 · PHYSICAL PRINT TEST SHEETS · ${SAMPLE_LABEL} · PRINT AT 100 % · NO FIT TO PAGE`, {
      cap: 1.45,
      tracking: 0.3,
      x: MARGIN,
      baseline: y + 0.7,
      color: INK,
    }),
    text(`PAGE ${pageNumber} / ${PAGE_COUNT}`, { cap: 1.45, tracking: 0.3, x: right - 16, baseline: y + 0.7, align: 'end', color: INK }),
    { kind: 'stroke', d: bar, width: 0.15, color: INK, role: 'scale-bar' },
    text('10 MM', { cap: 1.2, tracking: 0.3, x: right - 5, baseline: y + 3.6, align: 'middle', color: INK }),
  ];
}

function cropMarks(rects: readonly Rect[]): Item {
  let d = '';
  for (const r of rects) {
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    for (const [x, y, dx, dy] of [
      [x0, y0, -1, -1],
      [x1, y0, 1, -1],
      [x0, y1, -1, 1],
      [x1, y1, 1, 1],
    ] as const) {
      d += `M${fmt(x + dx * CROP_GAP)} ${fmt(y)}L${fmt(x + dx * (CROP_GAP + CROP_LEN))} ${fmt(y)}`;
      d += `M${fmt(x)} ${fmt(y + dy * CROP_GAP)}L${fmt(x)} ${fmt(y + dy * (CROP_GAP + CROP_LEN))}`;
    }
  }
  return { kind: 'stroke', d, width: CROP_WIDTH, color: '#000000', role: 'crop-marks' };
}

// ── Substrate textures (seeded vector strokes, page millimetres) ───────────

function inside(r: Rect, inset: number, rng: Prng): { x: number; y: number } {
  return { x: rng.range(r.x + inset, r.x + r.w - inset), y: rng.range(r.y + inset, r.y + r.h - inset) };
}

/** Paper fibres and specks, drawn OVER the code at low contrast. */
function paperFibres(r: Rect, rng: Prng): Item[] {
  const areaCm2 = (r.w * r.h) / 100;
  const fine: string[] = [];
  const coarse: string[] = [];
  for (let i = 0; i < Math.round(areaCm2 * 5); i++) {
    const len = rng.range(0.8, 2.6);
    const p = inside(r, len + 0.2, rng);
    const a = rng.range(0, TAU);
    const ex = Math.cos(a) * len;
    const ey = Math.sin(a) * len;
    const bend = rng.range(-0.35, 0.35);
    const qx = ex / 2 - Math.sin(a) * bend;
    const qy = ey / 2 + Math.cos(a) * bend;
    (rng.chance(0.7) ? fine : coarse).push(`M${fmt2(p.x)} ${fmt2(p.y)}q${fmt2(qx)} ${fmt2(qy)} ${fmt2(ex)} ${fmt2(ey)}`);
  }
  const darkSpecks: string[] = [];
  const lightSpecks: string[] = [];
  for (let i = 0; i < Math.round(areaCm2 * 14); i++) {
    const p = inside(r, 0.3, rng);
    (rng.chance(0.45) ? darkSpecks : lightSpecks).push(`M${fmt2(p.x)} ${fmt2(p.y)}h0.01`);
  }
  return [
    { kind: 'stroke', d: fine.join(''), width: 0.05, color: '#5C574F', opacity: 0.12 },
    { kind: 'stroke', d: coarse.join(''), width: 0.09, color: '#5C574F', opacity: 0.1 },
    { kind: 'stroke', d: darkSpecks.join(''), width: 0.09, color: '#6B655B', opacity: 0.16 },
    { kind: 'stroke', d: lightSpecks.join(''), width: 0.12, color: '#FFFFFF', opacity: 0.2 },
  ];
}

/** Pebble-grain creases on dark leather: a network UNDER the ink, a sparse share OVER it. */
function leatherGrain(r: Rect, rng: Prng): { under: Item[]; over: Item[] } {
  const pitch = 2.0;
  const under: string[] = [];
  const highlights: string[] = [];
  const over: string[] = [];
  for (let y = r.y + 0.8; y < r.y + r.h - 0.8; y += pitch) {
    for (let x = r.x + 0.8; x < r.x + r.w - 0.8; x += pitch) {
      const px = Math.min(r.x + r.w - 0.8, x + rng.range(-0.5, 0.5));
      const py = Math.min(r.y + r.h - 0.8, y + rng.range(-0.5, 0.5));
      const a = rng.range(0, TAU);
      const l1 = rng.range(0.3, 0.6);
      const b = a + rng.range(-1.2, 1.2);
      const l2 = rng.range(0.3, 0.6);
      const crease = `M${fmt2(px)} ${fmt2(py)}l${fmt2(Math.cos(a) * l1)} ${fmt2(Math.sin(a) * l1)} ${fmt2(Math.cos(b) * l2)} ${fmt2(Math.sin(b) * l2)}`;
      under.push(crease);
      if (rng.chance(0.25)) over.push(crease);
      if (rng.chance(0.4)) {
        const h = rng.range(0.25, 0.5);
        highlights.push(`M${fmt2(px + 0.5)} ${fmt2(py + 0.4)}l${fmt2(h)} ${fmt2(rng.range(-0.15, 0.15))}`);
      }
    }
  }
  return {
    under: [
      { kind: 'stroke', d: under.join(''), width: 0.09, color: '#100D0B' },
      { kind: 'stroke', d: highlights.join(''), width: 0.12, color: '#2F2924' },
    ],
    over: [{ kind: 'stroke', d: over.join(''), width: 0.07, color: '#100D0B', opacity: 0.35 }],
  };
}

/** Horizontal brushing over the whole tag (engraving included). */
function brushedMetal(r: Rect, rng: Prng): Item[] {
  const light: string[] = [];
  const dark: string[] = [];
  for (let y = r.y + 0.2; y < r.y + r.h - 0.2; y += rng.range(0.25, 0.65)) {
    const x0 = r.x + rng.range(0, r.w * 0.3);
    const x1 = r.x + r.w - rng.range(0, r.w * 0.3);
    if (x1 - x0 < 1) continue;
    (rng.chance(0.55) ? light : dark).push(`M${fmt2(x0)} ${fmt2(y)}h${fmt2(x1 - x0)}`);
  }
  return [
    { kind: 'stroke', d: light.join(''), width: 0.06, color: '#FFFFFF', opacity: 0.12 },
    { kind: 'stroke', d: dark.join(''), width: 0.05, color: '#000000', opacity: 0.06 },
  ];
}

// ── Rendition pages ────────────────────────────────────────────────────────

function tagWidth(sizeMm: number): number {
  return Math.max(sizeMm + 2 * TAG_PAD, Math.ceil(textWidth(SAMPLE_LABEL, SAMPLE_CAP, 0.3) + 4));
}

function tagItems(r: Rendition, code: CodeDef, sizeMm: number, x: number, y: number): { items: Item[]; placement: TagPlacement } {
  const w = tagWidth(sizeMm);
  const h = TAG_PAD + sizeMm + TAG_LABEL_H;
  const tag: Rect = { x, y, w, h };
  const rng = new Prng(`test-sheet/${r.id}/${sizeMm}`);
  const fill: string | LinearGradient = r.gradient
    ? { id: `sheen-${r.index}-${sizeMm}`, x1: x, y1: y, x2: x + w, y2: y + h, stops: r.gradient.map((c, i) => [i / (r.gradient!.length - 1), c] as const) }
    : r.substrate;
  const items: Item[] = [{ kind: 'rect', x, y, w, h, fill }];
  let over: Item[] = [];
  if (r.texture === 'leather-grain') {
    const grain = leatherGrain(tag, rng);
    items.push(...grain.under);
    over = grain.over;
  } else if (r.texture === 'paper-fibres') {
    over = paperFibres(tag, rng);
  } else if (r.texture === 'brushed-metal') {
    over = brushedMetal(tag, rng);
  }
  const cx = x + w / 2;
  const cy = y + TAG_PAD + sizeMm / 2;
  items.push({ kind: 'code', key: code.key, cx, cy, sizeMm }, ...over);
  const base = y + TAG_PAD + sizeMm;
  items.push(
    text(`${sizeMm} MM`, { cap: SIZE_CAP, tracking: 0.35, x: cx, baseline: base + 3.4, align: 'middle', color: r.ink }),
    text(SAMPLE_LABEL, { cap: SAMPLE_CAP, tracking: 0.3, x: cx, baseline: base + 6.0, align: 'middle', color: r.ink }),
    text(code.code.productId, { cap: ID_CAP, tracking: 0.3, x: cx, baseline: base + 8.3, align: 'middle', color: r.ink }),
  );
  return {
    items: [{ kind: 'group', attrs: { 'data-tag': `${r.id}-${sizeMm}mm`, 'data-size-mm': String(sizeMm) }, items }],
    placement: {
      rendition: r.id,
      sizeMm,
      productId: code.code.productId,
      tag,
      code: { x: cx - sizeMm / 2, y: cy - sizeMm / 2, w: sizeMm, h: sizeMm },
    },
  };
}

/** Results table: sizes × distances, for the 1× and the 2× zoom pass. */
function recordTable(x0: number, y0: number, ink: string): Item[] {
  const labelW = 21.6;
  const cellW = 13.7;
  const headH = 6;
  const rowH = TABLE_ROW_H;
  const cols = SCAN_DISTANCES_CM.length * 2;
  const width = labelW + cols * cellW;
  const height = 2 * headH + SHEET_SIZES_MM.length * rowH;
  const items: Item[] = [];
  const rect = `M${fmt(x0)} ${fmt(y0)}h${fmt(width)}v${fmt(height)}h${fmt(-width)}Z`;
  items.push({ kind: 'stroke', d: rect, width: 0.25, color: ink, role: 'record-table' });
  let grid = '';
  for (let i = 1; i <= SHEET_SIZES_MM.length + 1; i++) {
    const y = y0 + headH + (i === 1 ? headH : headH + (i - 1) * rowH);
    grid += `M${fmt(x0)} ${fmt(y)}h${fmt(width)}`;
  }
  grid += `M${fmt(x0 + labelW)} ${fmt(y0 + headH)}h${fmt(cols * cellW)}`;
  for (let c = 0; c <= cols; c++) {
    if (c === SCAN_DISTANCES_CM.length) continue;
    const x = x0 + labelW + c * cellW;
    grid += `M${fmt(x)} ${fmt(c === 0 ? y0 : y0 + headH)}V${fmt(y0 + height)}`;
  }
  items.push({ kind: 'stroke', d: grid, width: RULE, color: ink });
  const mid = x0 + labelW + SCAN_DISTANCES_CM.length * cellW;
  items.push(line(mid, y0, mid, y0 + height, 0.35, ink));
  items.push(
    text('1X · NO ZOOM', { cap: 1.5, tracking: 0.35, x: x0 + labelW + (SCAN_DISTANCES_CM.length * cellW) / 2, baseline: y0 + 4, align: 'middle', color: ink }),
    text('2X ZOOM · IF THE SCANNER OFFERS IT', { cap: 1.5, tracking: 0.35, x: mid + (SCAN_DISTANCES_CM.length * cellW) / 2, baseline: y0 + 4, align: 'middle', color: ink }),
    text('SIZE', { cap: 1.4, tracking: 0.35, x: x0 + 2, baseline: y0 + headH + 4, color: ink }),
    text('DISTANCE', { cap: 1.15, tracking: 0.3, x: x0 + 2, baseline: y0 + 4, color: MUTED }),
  );
  for (let c = 0; c < cols; c++) {
    const d = SCAN_DISTANCES_CM[c % SCAN_DISTANCES_CM.length];
    items.push(text(`${d} CM`, { cap: 1.4, tracking: 0.25, x: x0 + labelW + (c + 0.5) * cellW, baseline: y0 + headH + 4, align: 'middle', color: ink }));
  }
  SHEET_SIZES_MM.forEach((s, i) => {
    items.push(text(`${s} MM`, { cap: 1.5, tracking: 0.35, x: x0 + 2, baseline: y0 + 2 * headH + i * rowH + 4.3, color: ink }));
  });
  return items;
}

function renditionPage(r: Rendition): SheetPage {
  const pageNumber = r.index + 1;
  const code = sampleCodeFor(r);
  const def: CodeDef = { key: `code-${r.id}`, code, ink: r.ink, paper: r.substrate };
  const items: Item[] = [];
  const right = PAGE_WIDTH_MM - MARGIN;

  // Header.
  items.push(
    text('ORBES CODE-01 · PRINT TEST SHEET', { cap: 2.2, tracking: 0.5, x: MARGIN, baseline: 15, color: INK }),
    text(SAMPLE_LABEL, { cap: 2.2, tracking: 0.5, x: right, baseline: 15, align: 'end', color: INK }),
    text(`RENDITION ${r.index} / ${RENDITIONS.length}`, { cap: 1.6, tracking: 0.4, x: right, baseline: 25.5, align: 'end', color: MUTED }),
    text(r.name, { cap: 4.4, tracking: 0.32, x: MARGIN, baseline: 25.5, color: INK }),
    text(r.description, { cap: 1.6, tracking: 0.28, x: MARGIN, baseline: 31, color: MUTED }),
    text(`SAMPLE CODE ${code.productId} · KEY ID ${SAMPLE_KEY_ID} · PUBLIC SAMPLE KEY · A VERIFIER MUST ANSWER INVALID SIGNATURE OR UNKNOWN`, {
      cap: 1.6,
      tracking: 0.28,
      x: MARGIN,
      baseline: 35.5,
      color: MUTED,
    }),
    line(MARGIN, 39, right, 39),
  );

  // Tags.
  const placements: TagPlacement[] = [];
  let y = 45;
  for (const row of TAG_ROWS) {
    const widths = row.map(tagWidth);
    const total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * TAG_GUTTER;
    let x = (PAGE_WIDTH_MM - total) / 2;
    let rowH = 0;
    row.forEach((size, i) => {
      const t = tagItems(r, def, size, x, y);
      items.push(...t.items);
      placements.push(t.placement);
      x += widths[i] + TAG_GUTTER;
      rowH = Math.max(rowH, t.placement.tag.h);
    });
    y += rowH + TAG_GUTTER;
  }
  items.push(cropMarks(placements.map((p) => p.tag)));

  // Record table.
  const t0 = y + 3;
  items.push(
    text('RESULTS · SUCCESSFUL READS OUT OF 3 ATTEMPTS PER CELL', { cap: 1.9, tracking: 0.4, x: MARGIN, baseline: t0, color: INK }),
  );
  const fields = ['PHONE / OS', 'BROWSER', 'DATE', 'LIGHT', 'PRINTER / DPI'];
  const fieldW = (right - MARGIN) / fields.length;
  fields.forEach((f, i) => {
    const fx = MARGIN + i * fieldW;
    items.push(text(f, { cap: 1.3, tracking: 0.3, x: fx, baseline: t0 + 7, color: MUTED }));
    items.push(line(fx + textWidth(f, 1.3, 0.3) + 1.5, t0 + 7.3, fx + fieldW - 3, t0 + 7.3, 0.1, MUTED));
  });
  const tableTop = t0 + 11;
  const tableItems = recordTable(MARGIN, tableTop, INK);
  items.push(...tableItems);
  const tableBottom = tableTop + 12 + SHEET_SIZES_MM.length * TABLE_ROW_H;
  const notes = [
    'WRITE 3/3, 2/3, 1/3 OR 0/3 · LEAVE BLANK IF NOT TESTED · WRITE > WHEN THE CODE DOES NOT FIT INSIDE THE ON-SCREEN ORBIT AT THAT DISTANCE',
    'DISTANCE = PHONE LENS TO TAG, PHONE PARALLEL TO THE TAG · A READ = ANY RESULT SCREEN WITHIN 10 S · CUT THE TAG OUT OR MASK THE OTHER CODES FIRST',
    `THIS PAGE SIMULATES ${r.simulates} ON PAPER · CONFIRM ON THE REAL MATERIAL BEFORE FIXING A MINIMUM SIZE`,
  ];
  notes.forEach((n, i) => items.push(text(n, { cap: 1.3, tracking: 0.22, x: MARGIN, baseline: tableBottom + 5 + i * 3.4, color: MUTED })));
  items.push(...footer(pageNumber));

  return {
    number: pageNumber,
    slug: `page-${String(pageNumber).padStart(2, '0')}-${r.id}`,
    title: `ORBES CODE-01 print test sheet · page ${pageNumber}/${PAGE_COUNT} · ${r.name.toLowerCase()} · ${SAMPLE_LABEL}`,
    items,
    codes: [def],
    tags: placements,
  };
}

// ── Cover page ─────────────────────────────────────────────────────────────

const INSTRUCTIONS: readonly (readonly [string, readonly string[]])[] = [
  [
    '1 · PRINT',
    [
      'PRINT AT 100 % (ACTUAL SIZE). DISABLE FIT TO PAGE, SHRINK TO FIT AND ANY SCALING IN THE PRINTER DRIVER.',
      'MEASURE THE 100 MM RULER BELOW AND THE 10 MM SCALE BAR AT THE FOOT OF EVERY PAGE: THEY MUST MEASURE 100 MM ± 0.5 AND 10 MM ± 0.1. OTHERWISE DISCARD THE PRINT: EVERY SIZE ON IT IS WRONG.',
      'USE A LASER OR INKJET PRINTER AT 600 DPI OR MORE ON MATTE PAPER, BEST QUALITY, NO TONER SAVING. RECORD PRINTER, PAPER AND DPI IN EACH TABLE.',
      'PAGES 2 TO 8 SIMULATE SUBSTRATES ON PAPER. THEY DO NOT REPLACE TESTS ON REAL LEATHER OR METAL: PRODUCE THOSE FROM THE SVG FILES OF THIS KIT.',
    ],
  ],
  [
    '2 · PREPARE',
    [
      'CUT EACH TAG OUT ALONG ITS CROP MARKS, OR COVER EVERY OTHER CODE WITH PLAIN PAPER: THE SCANNER READS WHATEVER CODE IS INSIDE THE ORBIT, AND AT 25 CM THE ORBIT SEES THE WHOLE PAGE.',
      'LAY THE TAG FLAT ON A PLAIN SURFACE UNDER DIFFUSE INDOOR LIGHT (300 TO 500 LUX), NO SPOTLIGHT OR REFLECTION ON THE TAG.',
    ],
  ],
  [
    '3 · SCAN',
    [
      'OPEN /VERIFY ON THE PHONE OVER HTTPS, START SCANNING AND ALLOW THE CAMERA.',
      'HOLD THE PHONE PARALLEL TO THE TAG AT EACH DISTANCE: 8, 10, 12, 15, 20 AND 25 CM FROM LENS TO TAG. USE A RULER OR A SPACER. KEEP THE CODE CENTRED IN THE ORBIT.',
      'MAKE 3 ATTEMPTS PER SIZE AND DISTANCE. AN ATTEMPT SUCCEEDS WHEN ANY RESULT SCREEN APPEARS WITHIN 10 S. THESE ARE SAMPLE CODES SIGNED WITH THE PUBLIC SAMPLE KEY: THE RESULT MUST BE INVALID SIGNATURE OR UNKNOWN. IF A SAMPLE CODE IS EVER SHOWN AS AUTHENTIC, STOP AND REPORT IT AS A SECURITY DEFECT.',
      'REPEAT THE SERIES WITH 2X ZOOM WHEN THE SCANNER SHOWS ITS ZOOM CONTROL (BROWSER DEPENDENT).',
    ],
  ],
  [
    '4 · RECORD',
    [
      'WRITE THE NUMBER OF SUCCESSFUL ATTEMPTS IN THE TABLE OF EACH PAGE: ONE TABLE PER PHONE AND PRINT, COPY THE PAGE FOR MORE PHONES. NOTE PHONE MODEL, OS, BROWSER, LIGHT AND PRINTER.',
    ],
  ],
  [
    '5 · DECIDE',
    [
      'A SIZE PASSES ON A PHONE WHEN IT READS 3/3 AT TWO NEIGHBOURING DISTANCES WITHOUT ZOOM: REAL USERS DO NOT HOLD AN EXACT DISTANCE. THIS IS THE ROBUST CRITERION OF THE SIMULATION.',
      'COMPARE WITH DOCS/REPORTS/PRINT-SIZE-MATRIX.MD, A CAMERA SIMULATION. A MINIMUM PRINT SIZE IS VALIDATED ONLY WHEN THE PHYSICAL RESULTS ON REAL PHONES (ANDROID, IPHONE, IPHONE PRO) AGREE WITH IT. WHEN THEY DISAGREE, THE PHYSICAL RESULT WINS.',
    ],
  ],
];

function coverPage(): SheetPage {
  const items: Item[] = [];
  const right = PAGE_WIDTH_MM - MARGIN;
  const width = right - MARGIN;
  items.push(
    text('ORBES CODE-01', { cap: 3, tracking: 0.7, x: MARGIN, baseline: 20, color: INK }),
    text('PHYSICAL PRINT TEST SHEETS', { cap: 5.6, tracking: 0.36, x: MARGIN, baseline: 31, color: INK }),
    text(`${SAMPLE_LABEL} · EVERY CODE HERE IS SIGNED WITH THE PUBLIC SAMPLE KEY · NEVER AUTHENTIC`, {
      cap: 1.7,
      tracking: 0.3,
      x: MARGIN,
      baseline: 38,
      color: MUTED,
    }),
    line(MARGIN, 42, right, 42),
  );

  // Contents.
  let y = 50;
  items.push(text('CONTENTS', { cap: 2, tracking: 0.5, x: MARGIN, baseline: y, color: INK }));
  y += 6;
  const cols = [MARGIN, MARGIN + 14, MARGIN + 66, MARGIN + 157];
  ['PAGE', 'RENDITION', 'SUBSTRATE · INK', 'SAMPLE CODE'].forEach((h, i) =>
    items.push(text(h, { cap: 1.3, tracking: 0.35, x: cols[i], baseline: y, color: MUTED })),
  );
  y += 1.6;
  items.push(line(MARGIN, y, right, y, 0.1, MUTED));
  for (const r of RENDITIONS) {
    y += 4.4;
    const code = sampleCodeFor(r);
    items.push(
      text(String(r.index + 1), { cap: 1.6, tracking: 0.3, x: cols[0], baseline: y, color: INK }),
      text(r.name, { cap: 1.6, tracking: 0.3, x: cols[1], baseline: y, color: INK }),
      text(`${r.substrate} · ${r.ink}${r.texture === 'none' ? '' : ` · ${r.texture.replace('-', ' ')}`}`, { cap: 1.6, tracking: 0.2, x: cols[2], baseline: y, color: INK }),
      text(code.productId, { cap: 1.6, tracking: 0.3, x: cols[3], baseline: y, color: INK }),
    );
  }
  y += 3;
  items.push(line(MARGIN, y, right, y, 0.1, MUTED));
  y += 5;
  items.push(
    text(`SIZES ${SHEET_SIZES_MM.join(' · ')} MM = SIDE OF THE PRINTED SQUARE, QUIET ZONE INCLUDED (50 U) · DISTANCES ${SCAN_DISTANCES_CM.join(' · ')} CM`, {
      cap: 1.5,
      tracking: 0.25,
      x: MARGIN,
      baseline: y,
      color: MUTED,
    }),
  );

  // Instructions.
  y += 9;
  const cap = 1.75;
  const tracking = 0.14;
  const lead = 3.25;
  for (const [heading, paragraphs] of INSTRUCTIONS) {
    items.push(text(heading, { cap: 2, tracking: 0.5, x: MARGIN, baseline: y, color: INK }));
    y += 5;
    for (const p of paragraphs) {
      const lines = wrap(p, cap, tracking, width - 6);
      lines.forEach((l, i) => {
        if (i === 0) items.push(text('·', { cap, x: MARGIN + 1, baseline: y, color: INK }));
        items.push(text(l, { cap, tracking, x: MARGIN + 5, baseline: y, color: INK }));
        y += lead;
      });
      y += 1.2;
    }
    y += 2.5;
  }

  // 100 mm calibration ruler.
  y = Math.max(y + 4, 247);
  const x0 = (PAGE_WIDTH_MM - 100) / 2;
  let ticks = `M${fmt(x0)} ${fmt(y)}H${fmt(x0 + 100)}`;
  for (let mm = 0; mm <= 100; mm++) {
    const len = mm % 10 === 0 ? 3 : mm % 5 === 0 ? 2 : 1.2;
    ticks += `M${fmt(x0 + mm)} ${fmt(y)}V${fmt(y - len)}`;
  }
  items.push({ kind: 'stroke', d: ticks, width: 0.12, color: INK, role: 'ruler-100mm' });
  for (let mm = 0; mm <= 100; mm += 10) {
    items.push(text(String(mm), { cap: 1.3, tracking: 0.2, x: x0 + mm, baseline: y + 3.4, align: 'middle', color: INK }));
  }
  items.push(
    text('CALIBRATION RULER · 100 MM · CHECK BEFORE EVERY TEST SERIES', { cap: 1.3, tracking: 0.3, x: PAGE_WIDTH_MM / 2, baseline: y + 7.5, align: 'middle', color: MUTED }),
  );
  items.push(...footer(1));
  return {
    number: 1,
    slug: 'page-01-instructions',
    title: `ORBES CODE-01 physical print test sheets · page 1/${PAGE_COUNT} · instructions · ${SAMPLE_LABEL}`,
    items,
    codes: [],
    tags: [],
  };
}

/** The whole kit, cover first. Throws if the sample key is not the published one. */
export function buildTestSheets(): SheetPage[] {
  const pub = toHex(samplePublicKey());
  if (pub !== SAMPLE_PUBLIC_KEY_HEX) throw new Error(`sample key mismatch: ${pub} is not the published sample key`);
  const pages = [coverPage(), ...RENDITIONS.map(renditionPage)];
  for (const page of pages) {
    for (const def of page.codes) {
      if (!verifyCodeSignature(samplePublicKey(), def.code.payloadBytes, def.code.signature)) {
        throw new Error(`${def.code.productId}: signature does not verify with the sample key`);
      }
    }
  }
  return pages;
}

// ── SVG back end ───────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function parseHex(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) throw new RangeError(`expected #rrggbb, got ${color}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}

/** Opaque mix of ink over paper at `tone` (the core SVG renderer's rule). */
function mixTone(ink: string, paper: string, tone: number): string {
  const a = parseHex(ink);
  const b = parseHex(paper);
  return `#${a.map((c, i) => Math.round(b[i] + (c - b[i]) * tone).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const FULL_TURN_EPSILON = 1e-9;

/** Rings and full-turn arcs have a hole: filled even-odd (as in the core renderers). */
function hasHole(p: Primitive): boolean {
  if (p.kind === 'ring') return p.r - p.width / 2 > 0;
  if (p.kind === 'arc') return p.end - p.start >= TAU - FULL_TURN_EPSILON && p.r - p.width / 2 > 0;
  return false;
}

function primitiveFill(def: CodeDef, p: Primitive): string {
  const tone = p.tone ?? 1;
  if (!(tone > 0 && tone <= 1)) throw new RangeError(`tone must be in (0, 1], got ${tone}`);
  return tone === 1 ? def.ink : mixTone(def.ink, def.paper, tone);
}

/** Code outlines keep 0.001 u (≤ 1 µm at 50 mm); page geometry 0.01 mm. */
const CODE_DECIMALS = 3;
const PAGE_DECIMALS = 2;

/** The code once, in code units (−25…25), layer by layer like the core renderer. */
function svgCodeDef(def: CodeDef): string {
  const lines = [`<g id="${def.key}" data-product-id="${escapeXml(def.code.productId)}" fill="${def.ink}">`];
  let open: Layer | null = null;
  for (const p of def.code.model.primitives) {
    if (p.layer !== open) {
      if (open !== null) lines.push('</g>');
      lines.push(`<g data-layer="${p.layer}">`);
      open = p.layer;
    }
    const fill = primitiveFill(def, p);
    const d = compactPath(parsePath(primitiveToPathData(p)), CODE_DECIMALS);
    lines.push(`<path${fill === def.ink ? '' : ` fill="${fill}"`}${hasHole(p) ? ' fill-rule="evenodd"' : ''} d="${d}"/>`);
  }
  if (open !== null) lines.push('</g>');
  lines.push('</g>');
  return lines.join('\n');
}

function collectGradients(items: readonly Item[], out: LinearGradient[]): void {
  for (const it of items) {
    if (it.kind === 'rect' && typeof it.fill !== 'string') out.push(it.fill);
    if (it.kind === 'group') collectGradients(it.items, out);
  }
}

function svgItems(items: readonly Item[], out: string[]): void {
  for (const it of items) {
    switch (it.kind) {
      case 'rect': {
        const fill = typeof it.fill === 'string' ? it.fill : `url(#${it.fill.id})`;
        out.push(`<rect x="${fmt(it.x)}" y="${fmt(it.y)}" width="${fmt(it.w)}" height="${fmt(it.h)}" fill="${fill}"/>`);
        break;
      }
      case 'stroke': {
        if (!it.d) break;
        const extra =
          (it.opacity === undefined ? '' : ` stroke-opacity="${fmt(it.opacity)}"`) +
          (it.text === undefined ? '' : ` data-text="${escapeXml(it.text)}"`) +
          (it.role === undefined ? '' : ` data-role="${it.role}"`);
        out.push(`<path fill="none" stroke="${it.color}" stroke-width="${fmt(it.width)}"${extra} d="${compactPath(parsePath(it.d), PAGE_DECIMALS)}"/>`);
        break;
      }
      case 'code': {
        const s = it.sizeMm / CODE01_SIZE;
        out.push(`<use xlink:href="#${it.key}" data-size-mm="${it.sizeMm}" transform="translate(${fmt(it.cx)} ${fmt(it.cy)}) scale(${fmt(s, 6)})"/>`);
        break;
      }
      case 'group': {
        const attrs = Object.entries(it.attrs)
          .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
          .join('');
        out.push(`<g${attrs}>`);
        svgItems(it.items, out);
        out.push('</g>');
        break;
      }
    }
  }
}

/** One A4 page as a standalone SVG document (millimetre user units). */
export function pageToSvg(page: SheetPage): string {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}" width="${PAGE_WIDTH_MM}mm" height="${PAGE_HEIGHT_MM}mm">`,
    `<title>${escapeXml(page.title)}</title>`,
  ];
  const gradients: LinearGradient[] = [];
  collectGradients(page.items, gradients);
  if (page.codes.length > 0 || gradients.length > 0) {
    out.push('<defs>');
    for (const g of gradients) {
      out.push(
        `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${fmt(g.x1)}" y1="${fmt(g.y1)}" x2="${fmt(g.x2)}" y2="${fmt(g.y2)}">` +
          g.stops.map(([o, c]) => `<stop offset="${fmt(o)}" stop-color="${c}"/>`).join('') +
          '</linearGradient>',
      );
    }
    for (const def of page.codes) out.push(svgCodeDef(def));
    out.push('</defs>');
  }
  out.push(`<rect width="${PAGE_WIDTH_MM}" height="${PAGE_HEIGHT_MM}" fill="#FFFFFF"/>`);
  out.push('<g stroke-linecap="round" stroke-linejoin="round">');
  svgItems(page.items, out);
  out.push('</g>', '</svg>');
  return out.join('\n') + '\n';
}

// ── PDF back end ───────────────────────────────────────────────────────────

const PT_PER_MM = 72 / 25.4;

function pdfColor(hex: string): string {
  return parseHex(hex)
    .map((c) => fmt(c / 255, 4))
    .join(' ');
}

/** Page geometry rounded exactly as in the SVG (0.01 mm) before conversion. */
function pagePdfOps(d: string): string {
  return pdfPathOps(parsePath(compactPath(parsePath(d), PAGE_DECIMALS)));
}

/** The code as a Form XObject in code units (y down like the page user space). */
function codeXObject(doc: PDFKit.PDFDocument, def: CodeDef): PDFKit.PDFKitReference {
  const ops: string[] = [];
  let current = '';
  for (const p of def.code.model.primitives) {
    const fill = primitiveFill(def, p);
    if (fill !== current) {
      ops.push(`${pdfColor(fill)} rg`);
      current = fill;
    }
    ops.push(pdfPathOps(parsePath(primitiveToPathData(p))), hasHole(p) ? 'f*' : 'f');
  }
  const half = CODE01_SIZE / 2;
  const ref = doc.ref({ Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [-half, -half, half, half], Resources: { ProcSet: ['PDF'] } });
  ref.end(ops.join('\n'));
  return ref;
}

function pdfItems(doc: PDFKit.PDFDocument, items: readonly Item[], xobjects: ReadonlyMap<string, string>): void {
  for (const it of items) {
    switch (it.kind) {
      case 'rect': {
        if (typeof it.fill === 'string') {
          doc.save();
          doc.addContent(`${pdfColor(it.fill)} rg ${fmt(it.x)} ${fmt(it.y)} ${fmt(it.w)} ${fmt(it.h)} re f`);
          doc.restore();
        } else {
          const g = doc.linearGradient(it.fill.x1, it.fill.y1, it.fill.x2, it.fill.y2);
          for (const [o, c] of it.fill.stops) g.stop(o, c);
          doc.rect(it.x, it.y, it.w, it.h).fill(g);
        }
        break;
      }
      case 'stroke': {
        if (!it.d) break;
        doc.save();
        if (it.opacity !== undefined) doc.strokeOpacity(it.opacity);
        doc.addContent(`${pdfColor(it.color)} RG ${fmt(it.width)} w 1 J 1 j\n${pagePdfOps(it.d)}\nS`);
        doc.restore();
        break;
      }
      case 'code': {
        const name = xobjects.get(it.key);
        if (!name) throw new Error(`no XObject for ${it.key}`);
        const s = it.sizeMm / CODE01_SIZE;
        doc.save();
        doc.transform(s, 0, 0, s, it.cx, it.cy);
        doc.addContent(`/${name} Do`);
        doc.restore();
        break;
      }
      case 'group':
        pdfItems(doc, it.items, xobjects);
        break;
    }
  }
}

/** The kit as one A4 vector PDF (no fonts, no images; one Form XObject per page's code). */
export async function sheetsToPdf(pages: readonly SheetPage[]): Promise<Uint8Array> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    pdfVersion: '1.4',
    displayTitle: true,
    info: {
      Title: 'ORBES CODE-01 physical print test sheets (SAMPLE - NOT VALID)',
      Author: 'ORBES',
      Subject: 'Print-size test kit: sample codes signed with the public sample key, never valid',
      Keywords: 'ORBES CODE-01, test sheet, print size, sample',
      Creator: 'ORBES GENOME CODE scripts/test-sheets.ts',
      Producer: 'ORBES GENOME CODE',
      CreationDate: SHEET_DATE,
      ModDate: SHEET_DATE,
    },
  });
  const chunks: Uint8Array[] = [];
  const finished = new Promise<void>((resolveDone, reject) => {
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolveDone());
    doc.on('error', (e: unknown) => reject(e));
  });
  finished.catch(() => {});
  try {
    for (const page of pages) {
      doc.addPage({ size: [PAGE_WIDTH_MM * PT_PER_MM, PAGE_HEIGHT_MM * PT_PER_MM], margin: 0 });
      const names = new Map<string, string>();
      page.codes.forEach((def, i) => {
        const name = `Code${page.number}x${i}`;
        (doc.page.xobjects as Record<string, PDFKit.PDFKitReference>)[name] = codeXObject(doc, def);
        names.set(def.key, name);
      });
      doc.save();
      doc.transform(PT_PER_MM, 0, 0, PT_PER_MM, 0, 0);
      pdfItems(doc, page.items, names);
      doc.restore();
    }
  } finally {
    doc.end();
  }
  await finished;
  return Buffer.concat(chunks);
}

// ── CLI ────────────────────────────────────────────────────────────────────

export interface SheetFile {
  name: string;
  bytes: Uint8Array;
}

/** Every output file of the kit, in memory. */
export async function renderTestSheetFiles(): Promise<SheetFile[]> {
  const pages = buildTestSheets();
  const files: SheetFile[] = pages.map((p) => ({ name: `${p.slug}.svg`, bytes: Buffer.from(pageToSvg(p), 'utf8') }));
  files.push({ name: PDF_FILENAME, bytes: await sheetsToPdf(pages) });
  return files;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : DEFAULT_OUT_DIR;
  const files = await renderTestSheetFiles();
  if (args.includes('--check')) {
    const stale = files.filter((f) => {
      const path = join(outDir, f.name);
      return !existsSync(path) || !Buffer.from(readFileSync(path)).equals(Buffer.from(f.bytes));
    });
    for (const f of stale) console.error(`stale: ${join(outDir, f.name)}`);
    if (stale.length > 0) {
      console.error('Run: npx tsx scripts/test-sheets.ts');
      process.exit(1);
    }
    console.log(`${files.length} test sheet files up to date in ${outDir}`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const f of files) {
    writeFileSync(join(outDir, f.name), f.bytes);
    total += f.bytes.length;
    console.log(`${f.name.padEnd(36)} ${(f.bytes.length / 1024).toFixed(1).padStart(7)} KiB`);
  }
  console.log(`${files.length} files, ${(total / 1024).toFixed(0)} KiB → ${outDir}`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
