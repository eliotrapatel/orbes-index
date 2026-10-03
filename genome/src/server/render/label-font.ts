/**
 * ORBES label lettering: a monoline geometric capital alphabet drawn from
 * straight lines and circular arcs, emitted as SVG path data to be STROKED
 * (round caps and joins).
 *
 * Why not a font: SVG `<text>` depends on fonts installed wherever the file is
 * opened, resvg needs font files on the server (none in a slim container),
 * and pdfkit would have to embed or reference one. Geometry renders
 * identically in SVG, PDF and PNG with no dependency, and the lettering
 * follows the brand's wide-tracked geometric sans (circular O, uppercase
 * only). Labels are human-readable decoration and are never sampled by the
 * decoder.
 *
 * Glyph space: cap height 1, y grows downward, 0 = cap line, 1 = baseline.
 * Angles in glyph definitions are degrees clockwise from +x (east), the SVG
 * convention in a y-down plane.
 */

type Op =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  /** Elliptical arc around (cx, cy) with radii (rx, ry) from angle `from` to `to` (to > from: clockwise). */
  | readonly ['arc', number, number, number, number, number, number]
  | readonly ['Z'];

interface GlyphDef {
  /** Advance width without side bearing, in cap heights. */
  w: number;
  ops: readonly Op[];
}

const rad = (d: number): number => (d * Math.PI) / 180;
const pointOn = (cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] => [
  cx + rx * Math.cos(rad(deg)),
  cy + ry * Math.sin(rad(deg)),
];

/** Move to the start of a circular arc. */
const at = (cx: number, cy: number, r: number, deg: number): Op => ['M', ...pointOn(cx, cy, r, r, deg)];
const lineAt = (cx: number, cy: number, r: number, deg: number): Op => ['L', ...pointOn(cx, cy, r, r, deg)];
const arc = (cx: number, cy: number, r: number, from: number, to: number): Op => ['arc', cx, cy, r, r, from, to];
const circle = (cx: number, cy: number, r: number): Op[] => [at(cx, cy, r, 180), arc(cx, cy, r, 180, 540)];

/** Angle (deg) of the tangent point on circle (cx, cy, r) seen from (px, py); `side` picks one of the two. */
function tangentDeg(px: number, py: number, cx: number, cy: number, r: number, side: 1 | -1): number {
  const dx = px - cx;
  const dy = py - cy;
  const toPoint = Math.atan2(dy, dx);
  const spread = Math.acos(r / Math.hypot(dx, dy));
  return ((toPoint + side * spread) * 180) / Math.PI;
}

const SIX_T = tangentDeg(0.48, 0, 0.31, 0.7, 0.3, -1);
const NINE_T = tangentDeg(0.16, 1, 0.33, 0.3, 0.3, -1);

const GLYPHS: Readonly<Record<string, GlyphDef>> = {
  ' ': { w: 0.4, ops: [] },
  '-': { w: 0.42, ops: [['M', 0.04, 0.56], ['L', 0.38, 0.56]] },
  // The dot sits on the baseline: its ink bottom meets the other glyphs' stroke overhang.
  '.': { w: 0.16, ops: circle(0.08, 0.965, 0.035) },
  '/': { w: 0.42, ops: [['M', 0.02, 1], ['L', 0.4, 0]] },
  '·': { w: 0.16, ops: circle(0.08, 0.52, 0.035) },
  // The colon of a time (14:32) and the hash of a link's fragment (/VERIFY/C#…), for the ownership certificate (F-06).
  ':': { w: 0.16, ops: [...circle(0.08, 0.38, 0.035), ...circle(0.08, 0.965, 0.035)] },
  '#': { w: 0.62, ops: [['M', 0.24, 0.06], ['L', 0.14, 0.94], ['M', 0.5, 0.06], ['L', 0.4, 0.94], ['M', 0.05, 0.35], ['L', 0.59, 0.35], ['M', 0.02, 0.65], ['L', 0.56, 0.65]] },
  '0': { w: 0.64, ops: [['M', 0, 0.5], ['arc', 0.32, 0.5, 0.32, 0.5, 180, 540]] },
  '1': { w: 0.34, ops: [['M', 0.03, 0.2], ['L', 0.26, 0], ['L', 0.26, 1]] },
  '2': { w: 0.62, ops: [at(0.32, 0.28, 0.27, 180), arc(0.32, 0.28, 0.27, 180, 395), ['L', 0.05, 1], ['L', 0.6, 1]] },
  '3': { w: 0.6, ops: [at(0.3, 0.24, 0.24, 200), arc(0.3, 0.24, 0.24, 200, 450), arc(0.3, 0.74, 0.26, 270, 520)] },
  '4': { w: 0.62, ops: [['M', 0.44, 1], ['L', 0.44, 0], ['L', 0.02, 0.68], ['L', 0.62, 0.68]] },
  '5': { w: 0.62, ops: [['M', 0.58, 0], ['L', 0.16, 0], lineAt(0.31, 0.7, 0.3, 240), arc(0.31, 0.7, 0.3, 240, 510)] },
  '6': { w: 0.62, ops: [['M', 0.48, 0], lineAt(0.31, 0.7, 0.3, SIX_T), arc(0.31, 0.7, 0.3, SIX_T, SIX_T - 360)] },
  '7': { w: 0.62, ops: [['M', 0.02, 0], ['L', 0.6, 0], ['L', 0.2, 1]] },
  '8': { w: 0.6, ops: [...circle(0.3, 0.235, 0.235), ...circle(0.3, 0.735, 0.265)] },
  '9': { w: 0.64, ops: [['M', 0.16, 1], lineAt(0.33, 0.3, 0.3, NINE_T), arc(0.33, 0.3, 0.3, NINE_T, NINE_T - 360)] },
  A: { w: 0.72, ops: [['M', 0, 1], ['L', 0.36, 0], ['L', 0.72, 1], ['M', 0.13, 0.64], ['L', 0.59, 0.64]] },
  B: {
    w: 0.66,
    ops: [
      ['M', 0.05, 1], ['L', 0.05, 0], ['L', 0.33, 0], arc(0.33, 0.23, 0.23, 270, 450), ['L', 0.05, 0.46],
      ['M', 0.05, 0.46], ['L', 0.36, 0.46], arc(0.36, 0.73, 0.27, 270, 450), ['L', 0.05, 1],
    ],
  },
  C: { w: 0.9, ops: [at(0.5, 0.5, 0.5, -45), arc(0.5, 0.5, 0.5, -45, -315)] },
  D: { w: 0.92, ops: [['M', 0.05, 0], ['L', 0.05, 1], ['L', 0.4, 1], arc(0.4, 0.5, 0.5, 90, -90), ['Z']] },
  E: { w: 0.6, ops: [['M', 0.58, 0], ['L', 0.05, 0], ['L', 0.05, 1], ['L', 0.58, 1], ['M', 0.05, 0.5], ['L', 0.5, 0.5]] },
  F: { w: 0.58, ops: [['M', 0.58, 0], ['L', 0.05, 0], ['L', 0.05, 1], ['M', 0.05, 0.5], ['L', 0.5, 0.5]] },
  G: { w: 1.0, ops: [at(0.5, 0.5, 0.5, -45), arc(0.5, 0.5, 0.5, -45, -360), ['L', 0.56, 0.5]] },
  H: { w: 0.75, ops: [['M', 0.05, 0], ['L', 0.05, 1], ['M', 0.7, 0], ['L', 0.7, 1], ['M', 0.05, 0.5], ['L', 0.7, 0.5]] },
  I: { w: 0.1, ops: [['M', 0.05, 0], ['L', 0.05, 1]] },
  J: { w: 0.5, ops: [['M', 0.45, 0], ['L', 0.45, 0.72], arc(0.23, 0.72, 0.22, 0, 180)] },
  K: { w: 0.66, ops: [['M', 0.05, 0], ['L', 0.05, 1], ['M', 0.62, 0], ['L', 0.05, 0.6], ['M', 0.2495, 0.39], ['L', 0.65, 1]] },
  L: { w: 0.56, ops: [['M', 0.05, 0], ['L', 0.05, 1], ['L', 0.55, 1]] },
  M: { w: 0.9, ops: [['M', 0.05, 1], ['L', 0.05, 0], ['L', 0.45, 0.7], ['L', 0.85, 0], ['L', 0.85, 1]] },
  N: { w: 0.75, ops: [['M', 0.05, 1], ['L', 0.05, 0], ['L', 0.7, 1], ['L', 0.7, 0]] },
  O: { w: 1.0, ops: circle(0.5, 0.5, 0.5) },
  P: { w: 0.64, ops: [['M', 0.05, 1], ['L', 0.05, 0], ['L', 0.36, 0], arc(0.36, 0.25, 0.25, 270, 450), ['L', 0.05, 0.5]] },
  Q: { w: 1.0, ops: [...circle(0.5, 0.5, 0.5), ['M', 0.62, 0.62], ['L', 1, 1]] },
  R: {
    w: 0.66,
    ops: [['M', 0.05, 1], ['L', 0.05, 0], ['L', 0.36, 0], arc(0.36, 0.25, 0.25, 270, 450), ['L', 0.05, 0.5], ['M', 0.34, 0.5], ['L', 0.64, 1]],
  },
  S: { w: 0.6, ops: [at(0.3, 0.25, 0.25, -20), arc(0.3, 0.25, 0.25, -20, -270), arc(0.3, 0.75, 0.25, -90, 160)] },
  T: { w: 0.66, ops: [['M', 0, 0], ['L', 0.66, 0], ['M', 0.33, 0], ['L', 0.33, 1]] },
  U: { w: 0.75, ops: [['M', 0.05, 0], ['L', 0.05, 0.675], arc(0.375, 0.675, 0.325, 180, 0), ['L', 0.7, 0]] },
  V: { w: 0.68, ops: [['M', 0, 0], ['L', 0.34, 1], ['L', 0.68, 0]] },
  W: { w: 0.96, ops: [['M', 0, 0], ['L', 0.24, 1], ['L', 0.48, 0.2], ['L', 0.72, 1], ['L', 0.96, 0]] },
  X: { w: 0.66, ops: [['M', 0.02, 0], ['L', 0.64, 1], ['M', 0.64, 0], ['L', 0.02, 1]] },
  Y: { w: 0.66, ops: [['M', 0, 0], ['L', 0.33, 0.5], ['L', 0.66, 0], ['M', 0.33, 0.5], ['L', 0.33, 1]] },
  Z: { w: 0.66, ops: [['M', 0.04, 0], ['L', 0.62, 0], ['L', 0.04, 1], ['L', 0.62, 1]] },
};

/** Space between glyph boxes before tracking, in cap heights. */
const SIDE_BEARING = 0.16;
/** Arcs are split into pieces of at most 90°: unambiguous SVG arc flags, stable after rounding. */
const MAX_ARC_DEG = 90;
const DECIMALS = 3;

export const LABEL_CHARSET: ReadonlySet<string> = new Set(Object.keys(GLYPHS));

/** Letters that do not decompose into a base letter and accents (NFKD), spelt the way French and English print them in capitals. */
const SPELLED: Readonly<Record<string, string>> = Object.freeze({ Æ: 'AE', Œ: 'OE', Ø: 'O', Đ: 'D', Ł: 'L', Þ: 'TH' });
const DASHES = /[\u2010-\u2015\u2212]/g;

/**
 * Free text (a model name, a material) as the lettering can draw it: accents
 * removed, uppercase, ligatures spelt out, dashes as '-', and every other
 * character outside LABEL_CHARSET a space (runs collapsed, ends trimmed).
 * "Argent 925, œuvre" → "ARGENT 925 OEUVRE". Never throws.
 */
export function toLabelText(text: string): string {
  const upper = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(DASHES, '-');
  let out = '';
  for (const ch of upper) out += SPELLED[ch] ?? (LABEL_CHARSET.has(ch) ? ch : ' ');
  return out.replace(/ {2,}/g, ' ').trim();
}

export interface TextRunOptions {
  /** Cap height in output units. */
  capHeight: number;
  /** Extra letter spacing in cap heights (brand tracking ≈ 0.18–0.32 em; caps here). */
  tracking?: number;
  /** Anchor x in output units. */
  x: number;
  /** Baseline y in output units (y grows downward). */
  baseline: number;
  /** How `x` anchors the run (default 'middle'). */
  align?: 'start' | 'middle' | 'end';
}

export interface TextRun {
  /** Absolute SVG path data (M, L, A, Z) to be stroked. */
  d: string;
  /** Run width in output units. */
  width: number;
  /** Suggested stroke width in output units. */
  strokeWidth: number;
}

/** Stroke weight relative to cap height: a light, architectural line like the brand typography. */
export const STROKE_RATIO = 0.085;

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError('non-finite coordinate in label');
  const s = n.toFixed(DECIMALS).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function glyphOf(ch: string): GlyphDef {
  const g = GLYPHS[ch];
  if (!g) throw new RangeError(`label character not supported: ${JSON.stringify(ch)}`);
  return g;
}

/** Width of `text` in cap heights (no stroke overhang). */
export function measureText(text: string, tracking = 0): number {
  const chars = [...text.toUpperCase()];
  if (chars.length === 0) return 0;
  const advance = chars.reduce((sum, ch) => sum + glyphOf(ch).w, 0);
  return advance + (chars.length - 1) * (SIDE_BEARING + tracking);
}

/** Path data for `text`, uppercase, laid out on one line. Throws RangeError on unsupported characters. */
export function textRun(text: string, opts: TextRunOptions): TextRun {
  const { capHeight: s, x, baseline } = opts;
  const tracking = opts.tracking ?? 0;
  if (!(Number.isFinite(s) && s > 0)) throw new RangeError('capHeight must be positive');
  if (!(Number.isFinite(tracking) && tracking >= 0)) throw new RangeError('tracking must be ≥ 0');
  const upper = text.toUpperCase();
  const width = measureText(upper, tracking) * s;
  const align = opts.align ?? 'middle';
  let pen = align === 'start' ? x : align === 'end' ? x - width : x - width / 2;
  const top = baseline - s;

  const parts: string[] = [];
  const P = (gx: number, gy: number, ox: number) => `${fmt(ox + gx * s)} ${fmt(top + gy * s)}`;
  for (const ch of upper) {
    const g = glyphOf(ch);
    // Pen position in glyph space, to check that every arc starts where the previous stroke ended.
    let pen0: [number, number] = [0, 0];
    let cur: [number, number] = [0, 0];
    for (const op of g.ops) {
      switch (op[0]) {
        case 'M':
        case 'L':
          parts.push(`${op[0]}${P(op[1], op[2], pen)}`);
          cur = [op[1], op[2]];
          if (op[0] === 'M') pen0 = cur;
          break;
        case 'Z':
          parts.push('Z');
          cur = pen0;
          break;
        case 'arc': {
          const [, cx, cy, rx, ry, from, to] = op;
          const [sx, sy] = pointOn(cx, cy, rx, ry, from);
          if (Math.abs(sx - cur[0]) > 1e-3 || Math.abs(sy - cur[1]) > 1e-3) {
            throw new Error(`label glyph ${JSON.stringify(ch)}: arc does not start at the pen position`);
          }
          const span = to - from;
          const pieces = Math.max(1, Math.ceil(Math.abs(span) / MAX_ARC_DEG - 1e-9));
          const sweep = span > 0 ? 1 : 0;
          for (let k = 1; k <= pieces; k++) {
            const [px, py] = pointOn(cx, cy, rx, ry, from + (span * k) / pieces);
            parts.push(`A${fmt(rx * s)} ${fmt(ry * s)} 0 0 ${sweep} ${P(px, py, pen)}`);
            cur = [px, py];
          }
          break;
        }
      }
    }
    pen += (g.w + SIDE_BEARING + tracking) * s;
  }
  return { d: parts.join(''), width, strokeWidth: s * STROKE_RATIO };
}
