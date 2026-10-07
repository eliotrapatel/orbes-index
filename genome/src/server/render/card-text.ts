/**
 * Runs of type for the certificate card 79t (plan NEXT LOT §3.2), set from
 * the glyph outlines of ./card-type.ts and placed by their INK edge, as 79t's
 * build.py places its <text> elements (`text()` and `run()`):
 *
 *   - a run's metrics are build.py's `metrics()`: the advance (the trailing
 *     tracking included), the ink width (advance less the trailing tracking
 *     and the first and last glyphs' side bearings) and the left bearing, all
 *     without kerning, since build.py computed the card's positions so;
 *   - `cardText` puts the ink's start (or centre, or end) at x, then draws the
 *     glyphs from the origin that gives, kerned unless told otherwise (79t
 *     sets its two legends and the year unkerned, everything else kerned);
 *   - `cardRun` sets Gravesend words and Helvetica Neue parts (digits, the
 *     fingerprint) on one line, each Helvetica part at Gravesend's cap height
 *     with the same tracking in millimetres, each part from where the one
 *     before it ends (no kerning across parts).
 *
 * Everything comes out as filled outlines in page millimetres (y down): no
 * font is ever written, so the claim code is never text. A character the
 * face has no outline for is dropped.
 */
import { GRAVESEND_SANS, HELVETICA_NEUE_LIGHT, HELVETICA_NEUE_REGULAR, type CardFace, type CardGlyph } from './card-type.js';

export const CARD_FACES = Object.freeze({ gravesend: GRAVESEND_SANS, regular: HELVETICA_NEUE_REGULAR, light: HELVETICA_NEUE_LIGHT });
export type CardFaceName = keyof typeof CARD_FACES;

export interface CardTypeSpec {
  face: CardFaceName;
  /** Font size (the em), millimetres. */
  size: number;
  /** Tracking (letter-spacing), in ems of `size`: added after every character, the last one included. */
  tracking: number;
  /** Kerning pairs applied (default true). Positions are computed without them in any case, as build.py does. */
  kerning?: boolean;
}

export interface CardMetrics {
  /** Advance of the run, the trailing tracking included, mm. */
  advance: number;
  /** Ink width: from the first glyph's ink to the last one's, mm. */
  ink: number;
  /** The first glyph's left side bearing, mm. */
  lsb: number;
}

export interface CardRun {
  /** Filled outlines in page millimetres (absolute M L Q C Z), '' for a run with nothing to draw. */
  d: string;
  /** The ink's left and right edges as placed (the computed ink, as build.py places it), mm. */
  inkLeft: number;
  inkRight: number;
  /** Where the next character would start (the run's origin plus its advance), mm. */
  end: number;
  /** The right edge of the last glyph's ink as drawn, kerning included (equal to inkRight without kerning), mm. */
  drawnRight: number;
}

/** Cap height of a face as a fraction of its em. */
export const capRatio = (face: CardFaceName): number => CARD_FACES[face].capHeight / CARD_FACES[face].unitsPerEm;

/** The characters of `text` the face can draw (any other is dropped). */
export function drawable(text: string, face: CardFaceName): string {
  const glyphs = CARD_FACES[face].glyphs;
  return [...text].filter((c) => Object.hasOwn(glyphs, c)).join('');
}

function glyph(f: CardFace, c: string): CardGlyph {
  return f.glyphs[c];
}

/** build.py's metrics(): advance (with the trailing tracking), ink width and left bearing, unkerned, mm. */
export function cardMetrics(text: string, spec: CardTypeSpec): CardMetrics {
  const f = CARD_FACES[spec.face];
  const chars = [...drawable(text, spec.face)];
  if (chars.length === 0) return { advance: 0, ink: 0, lsb: 0 };
  const k = spec.size / f.unitsPerEm;
  const advance = chars.reduce((s, c) => s + glyph(f, c).a, 0) * k + chars.length * spec.tracking * spec.size;
  const first = glyph(f, chars[0]);
  const last = glyph(f, chars[chars.length - 1]);
  const lsb = (first.b ? first.b[0] : 0) * k;
  const rsb = (last.b ? last.a - last.b[2] : last.a) * k;
  return { advance, ink: advance - spec.tracking * spec.size - lsb - rsb, lsb };
}

/** The advance with kerning (when the spec applies it): where the run's last character actually ends, mm. */
function kernedAdvance(chars: readonly string[], spec: CardTypeSpec): number {
  const f = CARD_FACES[spec.face];
  const k = spec.size / f.unitsPerEm;
  let x = 0;
  chars.forEach((c, i) => {
    x += glyph(f, c).a * k + spec.tracking * spec.size;
    if (spec.kerning !== false && i + 1 < chars.length) x += (f.kern[c + chars[i + 1]] ?? 0) * k;
  });
  return x;
}

/** The ink width of a run as drawn: kerned when the spec kerns, mm. */
export function cardInkWidth(text: string, spec: CardTypeSpec): number {
  const m = cardMetrics(text, spec);
  const chars = [...drawable(text, spec.face)];
  if (chars.length === 0) return 0;
  return m.ink + (kernedAdvance(chars, spec) - m.advance);
}

/** A coordinate for path data: three decimals at most, never "-0". */
export function cardFmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError('non-finite coordinate');
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * A screen's raster grid, for comparing a render with a screen capture (test/render/certificate.test.ts compares the
 * card with 79t's front.png, a Chrome screenshot): a screen rasteriser (Skia, in Chrome) puts each glyph's baseline
 * on a whole device pixel and its origin on a quarter pixel, rounded down. Print files never use it.
 */
export interface GlyphGrid {
  /** Device pixels per millimetre. */
  pxPerMm: number;
  /** Where the page's origin falls, in device pixels. */
  originPx: { x: number; y: number };
}

let glyphGrid: GlyphGrid | null = null;

/** Run `draw` with every glyph placed on `grid`'s pixels (see GlyphGrid); synchronous, restored afterwards. */
export function onGlyphGrid<T>(grid: GlyphGrid, draw: () => T): T {
  const before = glyphGrid;
  glyphGrid = grid;
  try {
    return draw();
  } finally {
    glyphGrid = before;
  }
}

/** A glyph's origin as placed: as computed, or on the glyph grid when one is set. */
function onGrid(x: number, baseline: number): [number, number] {
  if (!glyphGrid) return [x, baseline];
  const { pxPerMm: k, originPx: o } = glyphGrid;
  return [(Math.floor((o.x + x * k) * 4) / 4 - o.x) / k, (Math.round(o.y + baseline * k) - o.y) / k];
}

const PARSED = new WeakMap<CardGlyph, (string | number)[]>();

/** A glyph's outline as tokens: commands and numbers. */
function tokens(g: CardGlyph): (string | number)[] {
  let t = PARSED.get(g);
  if (!t) {
    t = [];
    for (const m of g.d.matchAll(/([MLQCZ])|(-?\d+(?:\.\d+)?)/g)) t.push(m[1] ?? Number(m[2]));
    PARSED.set(g, t);
  }
  return t;
}

/** One glyph's outline at origin (ox, baseline), k millimetres per font unit, y flipped. */
function glyphPath(g: CardGlyph, ox: number, baseline: number, k: number): string {
  let out = '';
  let xNext = true;
  let afterCommand = true;
  for (const t of tokens(g)) {
    if (typeof t === 'string') {
      out += t;
      xNext = true;
      afterCommand = true;
      continue;
    }
    out += (afterCommand ? '' : ' ') + cardFmt(xNext ? ox + t * k : baseline - t * k);
    xNext = !xNext;
    afterCommand = false;
  }
  return out;
}

/** Draw the drawable characters of `text` from the origin x0 (not the ink edge). */
function drawFrom(chars: readonly string[], spec: CardTypeSpec, x0: number, baseline: number): { d: string; end: number; drawnRight: number } {
  const f = CARD_FACES[spec.face];
  const k = spec.size / f.unitsPerEm;
  let x = x0;
  let d = '';
  let drawnRight = x0;
  chars.forEach((c, i) => {
    const g = glyph(f, c);
    if (g.b) {
      const [gx, gy] = onGrid(x, baseline);
      d += glyphPath(g, gx, gy, k);
      drawnRight = x + g.b[2] * k;
    }
    x += g.a * k + spec.tracking * spec.size;
    if (spec.kerning !== false && i + 1 < chars.length) x += (f.kern[c + chars[i + 1]] ?? 0) * k;
  });
  return { d, end: x, drawnRight };
}

/**
 * build.py's text(): `x` is the ink's start ('start'), centre ('middle') or end ('end'), computed from the unkerned
 * metrics; the glyphs are then drawn from the origin that gives, kerned unless `kerning: false`.
 */
export function cardText(text: string, spec: CardTypeSpec & { x: number; baseline: number; align?: 'start' | 'middle' | 'end' }): CardRun {
  const chars = [...drawable(text, spec.face)];
  const m = cardMetrics(text, spec);
  const align = spec.align ?? 'start';
  const x0 = align === 'start' ? spec.x - m.lsb : align === 'end' ? spec.x - m.ink - m.lsb : spec.x - m.ink / 2 - m.lsb;
  const { d, end, drawnRight } = drawFrom(chars, spec, x0, spec.baseline);
  return { d, inkLeft: x0 + m.lsb, inkRight: x0 + m.lsb + m.ink, end, drawnRight: chars.length > 0 ? drawnRight : x0 + m.lsb };
}

/** One part of a run: its text and its face. */
export interface CardRunPart {
  text: string;
  face: CardFaceName;
}

/**
 * build.py's run(): parts on one baseline from the ink start `x`, Gravesend at `size` and `tracking`, any other face
 * at Gravesend's cap height (size × Gravesend's cap ratio ÷ its own) with the same tracking in millimetres. Each part
 * starts where the one before it ends; kerning applies inside a part only.
 */
export function cardRun(parts: readonly CardRunPart[], spec: { x: number; baseline: number; size: number; tracking: number; kerning?: boolean }): CardRun {
  const specOf = (face: CardFaceName): CardTypeSpec => {
    if (face === 'gravesend') return { face, size: spec.size, tracking: spec.tracking, kerning: spec.kerning };
    const size = (spec.size * capRatio('gravesend')) / capRatio(face);
    return { face, size, tracking: (spec.tracking * spec.size) / size, kerning: spec.kerning };
  };
  const drawn = parts.map((p) => ({ chars: [...drawable(p.text, p.face)], spec: specOf(p.face), text: p.text })).filter((p) => p.chars.length > 0);
  if (drawn.length === 0) return { d: '', inkLeft: spec.x, inkRight: spec.x, end: spec.x, drawnRight: spec.x };
  let d = '';
  let cx = spec.x;
  let inkRight = spec.x;
  let drawnRight = spec.x;
  drawn.forEach((p, i) => {
    const m = cardMetrics(p.text, p.spec);
    const x0 = i === 0 ? cx - m.lsb : cx;
    const part = drawFrom(p.chars, p.spec, x0, spec.baseline);
    d += part.d;
    if (part.d !== '') drawnRight = part.drawnRight;
    cx = x0 + m.advance;
    if (i === drawn.length - 1) {
      // build.py: the ink's end is the run's end less the last part's trailing tracking and the last glyph's right bearing.
      const f = CARD_FACES[p.spec.face];
      const last = glyph(f, p.chars[p.chars.length - 1]);
      const rsb = ((last.b ? last.a - last.b[2] : last.a) * p.spec.size) / f.unitsPerEm;
      inkRight = cx - p.spec.tracking * p.spec.size - rsb;
    }
  });
  return { d, inkLeft: spec.x, inkRight, end: cx, drawnRight };
}

/**
 * Free text as a run of Gravesend words and Helvetica Neue Regular digit runs (79t: « 925 », « 17 »), the digits at
 * Gravesend's cap height (plan NEXT LOT §3.2, Default (mine): every digit run of the piece's lines).
 */
export function digitParts(text: string): CardRunPart[] {
  return [...text.matchAll(/(\d+)|(\D+)/g)].map((m) => ({ text: m[0], face: m[1] !== undefined ? ('regular' as const) : ('gravesend' as const) }));
}
