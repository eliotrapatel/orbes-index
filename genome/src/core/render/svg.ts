/**
 * Shared SVG renderer for the ORBES primitive model (see ../geometry.ts).
 *
 * Every primitive becomes ONE closed, filled outline: strokes are never used,
 * so the SVG, the PDF renderer (which reuses `primitiveToPathData`) and any
 * rasteriser cover exactly the same area, independent of how each engine
 * implements stroke joins or caps.
 *
 * Path conventions (y-down plane, so "clockwise" means clockwise on screen):
 *   - outer contours run clockwise, holes counter-clockwise, so a path fills
 *     identically under the nonzero and the evenodd rule;
 *   - circular arcs are split into segments of at most 90°, which keeps every
 *     SVG arc command unambiguous (no large-arc flag) and numerically stable
 *     after rounding, even for spans close to a full turn;
 *   - coordinates are rounded to 3 decimals and attributes are emitted in a
 *     fixed order, so the output is byte-for-byte deterministic.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { TAU, polar, type Layer, type Point, type Primitive } from '../geometry.js';

export interface SvgStyle {
  /** Ink colour (default `#000000`). */
  ink?: string;
  /** Background colour; `null` leaves the background transparent (default `#ffffff`). */
  paper?: string | null;
  /** Render primitives of the `decor` layer (default true). */
  decor?: boolean;
  /** Physical width; sets `width`/`height` in millimetres, preserving the viewBox aspect ratio. */
  widthMm?: number;
  /** Accessible title, emitted as `<title>`. */
  title?: string;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_INK = '#000000';
const DEFAULT_PAPER = '#ffffff';
const DECIMALS = 3;
const MAX_ARC_SEGMENT = TAU / 4;
/** An arc whose span is within this of a full turn is drawn as a closed ring. */
const FULL_TURN_EPSILON = 1e-9;

/** Fixed-precision number formatting: 3 decimals, no trailing zeros, never "-0". */
function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite coordinate ${n}`);
  const s = n.toFixed(DECIMALS).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function pt(p: Point): string {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

/**
 * SVG arc commands following the circle (cx, cy, r) from angle a0 to a1
 * (clockwise when a1 > a0). The pen must already be at polar(r, a0).
 */
function arcTo(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const span = a1 - a0;
  const segments = Math.max(1, Math.ceil(Math.abs(span) / MAX_ARC_SEGMENT - 1e-9));
  const sweep = span > 0 ? 1 : 0;
  let d = '';
  for (let k = 1; k <= segments; k++) {
    const p = polar(r, a0 + (span * k) / segments, cx, cy);
    d += `A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${pt(p)}`;
  }
  return d;
}

function circle(cx: number, cy: number, r: number, clockwise: boolean): string {
  const [a0, a1] = clockwise ? [0, TAU] : [TAU, 0];
  return `M${pt(polar(r, a0, cx, cy))}${arcTo(cx, cy, r, a0, a1)}Z`;
}

function annulus(cx: number, cy: number, inner: number, outer: number): string {
  // A band reaching the centre has no hole: it is a disc of the outer radius.
  return inner > 0 ? circle(cx, cy, outer, true) + circle(cx, cy, inner, false) : circle(cx, cy, outer, true);
}

function requirePositive(value: number, what: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`${what} must be a positive finite number, got ${value}`);
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be finite, got ${value}`);
}

/** Closed outline of an arc band, round caps kept inside [start, end]. */
function arcPath(cx: number, cy: number, r: number, width: number, start: number, end: number, cap: 'round' | 'butt'): string {
  const span = end - start;
  const half = width / 2;
  const outer = r + half;
  const inner = r - half;
  if (span >= TAU - FULL_TURN_EPSILON) return annulus(cx, cy, inner, outer);

  if (cap === 'butt') {
    const tip = inner > 0 ? `L${pt(polar(inner, end, cx, cy))}${arcTo(cx, cy, inner, end, start)}` : `L${pt({ x: cx, y: cy })}`;
    return `M${pt(polar(outer, start, cx, cy))}${arcTo(cx, cy, outer, start, end)}${tip}Z`;
  }

  if (inner <= 0) throw new RangeError('round-capped arc width must be smaller than its diameter');
  // Angular half-width of a cap disc seen from the centre. asin (rather than
  // half/r) makes the cap tangent to the interval bound, so the inked extent is
  // exactly [start, end] as the geometry contract requires.
  const inset = Math.asin(half / r);
  if (span <= 2 * inset) {
    // Too short for a capsule: the largest centred dot that fits the interval.
    const mid = polar(r, start + span / 2, cx, cy);
    return circle(mid.x, mid.y, r * Math.sin(span / 2), true);
  }
  const a = start + inset;
  const b = end - inset;
  const capEnd = polar(r, b, cx, cy);
  const capStart = polar(r, a, cx, cy);
  return (
    `M${pt(polar(outer, a, cx, cy))}` +
    arcTo(cx, cy, outer, a, b) +
    // Each cap is the half of the cap circle lying beyond the radial line through its centre.
    arcTo(capEnd.x, capEnd.y, half, b, b + Math.PI) +
    arcTo(cx, cy, inner, b, a) +
    arcTo(capStart.x, capStart.y, half, a + Math.PI, a + TAU) +
    'Z'
  );
}

/**
 * Closed, filled outline of one primitive as SVG path data, in the primitive's
 * own coordinates. Used by the SVG renderer and the PDF renderer, so both
 * produce identical geometry. Throws RangeError on degenerate geometry.
 */
export function primitiveToPathData(p: Primitive): string {
  requireFinite(p.cx, 'cx');
  requireFinite(p.cy, 'cy');
  requirePositive(p.r, `${p.kind} radius`);
  switch (p.kind) {
    case 'disc':
      return circle(p.cx, p.cy, p.r, true);
    case 'ring':
      requirePositive(p.width, 'ring width');
      return annulus(p.cx, p.cy, p.r - p.width / 2, p.r + p.width / 2);
    case 'arc': {
      requirePositive(p.width, 'arc width');
      requireFinite(p.start, 'arc start');
      requireFinite(p.end, 'arc end');
      if (!(p.end > p.start)) throw new RangeError('arc end must be greater than start');
      if (p.width > 2 * p.r) throw new RangeError('arc width must not exceed its diameter');
      return arcPath(p.cx, p.cy, p.r, p.width, p.start, p.end, p.cap);
    }
    case 'halfDisc': {
      requireFinite(p.angle, 'halfDisc angle');
      const from = p.angle - Math.PI / 2;
      // The closing segment of the path is the straight diameter.
      return `M${pt(polar(p.r, from, p.cx, p.cy))}${arcTo(p.cx, p.cy, p.r, from, from + Math.PI)}Z`;
    }
    case 'crescent': {
      requireFinite(p.angle, 'crescent angle');
      if (!(p.offset > 0 && p.offset < 2 * p.r)) throw new RangeError('crescent offset must be in (0, 2r)');
      // The two equal circles intersect at ±phi around `angle` (seen from the
      // lit disc) and at π ∓ phi (seen from the occluding disc).
      const phi = Math.acos(p.offset / (2 * p.r));
      const occluder = polar(p.offset, p.angle, p.cx, p.cy);
      return (
        `M${pt(polar(p.r, p.angle + phi, p.cx, p.cy))}` +
        arcTo(p.cx, p.cy, p.r, p.angle + phi, p.angle + TAU - phi) +
        arcTo(occluder.x, occluder.y, p.r, p.angle + Math.PI + phi, p.angle + Math.PI - phi) +
        'Z'
      );
    }
    default: {
      const unknown: never = p;
      throw new RangeError(`unknown primitive kind ${(unknown as { kind: string }).kind}`);
    }
  }
}

/**
 * True when the outline has a hole. Such paths also carry an explicit evenodd
 * rule, so the hole survives editors that re-orient subpaths.
 */
function hasHole(p: Primitive): boolean {
  if (p.kind === 'ring') return p.r - p.width / 2 > 0;
  if (p.kind === 'arc') return p.end - p.start >= TAU - FULL_TURN_EPSILON && p.r - p.width / 2 > 0;
  return false;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Fill attributes for a reduced tone. When ink and paper are both hex colours
 * the tone is pre-mixed into an opaque colour: print workflows then never see
 * transparency, and overlapping elements cannot darken each other. Otherwise
 * (transparent paper, named colours) it falls back to fill-opacity.
 */
function toneFill(tone: number, ink: string, paper: string | null): string {
  const inkRgb = parseHex(ink);
  const paperRgb = paper === null ? null : parseHex(paper);
  if (inkRgb && paperRgb) {
    const mixed = inkRgb.map((c, i) => Math.round(paperRgb[i] + (c - paperRgb[i]) * tone));
    return ` fill="#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}"`;
  }
  return ` fill-opacity="${fmt(tone)}"`;
}

/**
 * Render primitives to a standalone SVG document. Primitives are painted in
 * order; consecutive primitives of the same layer share a `<g data-layer>`
 * group so designers can isolate machine-critical layers.
 */
export function primitivesToSvg(primitives: readonly Primitive[], viewBox: ViewBox, style: SvgStyle = {}): string {
  requireFinite(viewBox.x, 'viewBox.x');
  requireFinite(viewBox.y, 'viewBox.y');
  requirePositive(viewBox.w, 'viewBox.w');
  requirePositive(viewBox.h, 'viewBox.h');
  const ink = style.ink ?? DEFAULT_INK;
  const paper = style.paper === undefined ? DEFAULT_PAPER : style.paper;
  const box = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.w)} ${fmt(viewBox.h)}`;

  let size = '';
  if (style.widthMm !== undefined) {
    requirePositive(style.widthMm, 'widthMm');
    size = ` width="${fmt(style.widthMm)}mm" height="${fmt((style.widthMm * viewBox.h) / viewBox.w)}mm"`;
  }

  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"${size}>`];
  if (style.title !== undefined) lines.push(`<title>${escapeXml(style.title)}</title>`);
  if (paper !== null) {
    lines.push(
      `<rect x="${fmt(viewBox.x)}" y="${fmt(viewBox.y)}" width="${fmt(viewBox.w)}" height="${fmt(viewBox.h)}" fill="${escapeXml(paper)}"/>`,
    );
  }
  lines.push(`<g fill="${escapeXml(ink)}">`);

  let openLayer: Layer | null = null;
  for (const p of primitives) {
    if (p.layer === 'decor' && style.decor === false) continue;
    const tone = p.tone ?? 1;
    if (!(tone >= 0 && tone <= 1)) throw new RangeError(`tone must be in [0, 1], got ${tone}`);
    if (tone === 0) continue;
    if (p.layer !== openLayer) {
      if (openLayer !== null) lines.push('</g>');
      lines.push(`<g data-layer="${escapeXml(p.layer)}">`);
      openLayer = p.layer;
    }
    const fill = tone === 1 ? '' : toneFill(tone, ink, paper);
    const rule = hasHole(p) ? ' fill-rule="evenodd"' : '';
    lines.push(`<path${fill}${rule} d="${primitiveToPathData(p)}"/>`);
  }
  if (openLayer !== null) lines.push('</g>');
  lines.push('</g>', '</svg>');
  return lines.join('\n') + '\n';
}
