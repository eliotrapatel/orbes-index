/**
 * ORBES GENOME — glyph vocabulary.
 *
 * A genome glyph is a small orbital figure drawn inside a circle of radius R.
 * The candidate pool below is the design space evaluated by
 * `scripts/genome-symbol-study.ts`, which rasterises every candidate at
 * 8–24 px under blur, rotation and offset jitter and selects the 16 glyphs of
 * GENOME-01 that stay most mutually distinct at 10–12 px. The resulting
 * GENOME-01 order is FROZEN: a glyph's index is the 4-bit value it encodes in
 * every product genome ever issued, so neither the order nor the geometry of
 * a selected glyph may change. A new vocabulary means a new genome version.
 *
 * Design rules shared by every candidate:
 *   - all ink lies within radius R of the glyph centre;
 *   - every stroke, dot diameter and crescent thickness is ≥ 0.22 R so the
 *     figure survives small print and camera blur;
 *   - orientations are ABSOLUTE, relative to code north (never radial), so a
 *     glyph reads the same wherever it sits on the genome orbit.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

import { deg, polar, type Primitive } from '../geometry.js';

export interface GlyphDef {
  index: number;
  id: string;
  name: string;
  family: string;
  /** Closest Unicode approximation, for logs and plain-text displays. */
  hint: string;
  /** Primitives on layer 'genome'; all ink within radius R of (cx, cy). */
  primitives(cx: number, cy: number, R: number): Primitive[];
}

/** A vocabulary candidate: a glyph before it is assigned a permanent index. */
export type GlyphCandidate = Omit<GlyphDef, 'index'>;

/** Family of the rotation-invariant forms. Every other family is oriented. */
export const SYMMETRIC_FAMILY = 'SYMMETRIC';

// Proportions in units of R.
/** Stroke of the outer orbit. */
const STROKE = 0.26;
/** Centreline of the outer orbit, so its outer edge lies exactly on R. */
const ORBIT = 1 - STROKE / 2;
/** Radius of a point. */
const POINT = 0.36;

/** A glyph drawn on a unit circle; `unit` builds it for centre (cx, cy) and radius R. */
type UnitShape = (k: Scale) => Primitive[];

interface Scale {
  disc(r: number, at?: { r: number; angle: number }): Primitive;
  ring(r: number, width: number): Primitive;
  arc(r: number, width: number, start: number, end: number, cap: 'round' | 'butt'): Primitive;
  halfDisc(r: number, angle: number): Primitive;
  crescent(r: number, offset: number, angle: number): Primitive;
}

function scale(cx: number, cy: number, R: number): Scale {
  const layer = 'genome' as const;
  return {
    disc: (r, at) => {
      const c = at ? polar(at.r * R, at.angle, cx, cy) : { x: cx, y: cy };
      return { kind: 'disc', layer, cx: c.x, cy: c.y, r: r * R };
    },
    ring: (r, width) => ({ kind: 'ring', layer, cx, cy, r: r * R, width: width * R }),
    arc: (r, width, start, end, cap) => ({ kind: 'arc', layer, cx, cy, r: r * R, width: width * R, start, end, cap }),
    halfDisc: (r, angle) => ({ kind: 'halfDisc', layer, cx, cy, r: r * R, angle }),
    crescent: (r, offset, angle) => ({ kind: 'crescent', layer, cx, cy, r: r * R, offset: offset * R, angle }),
  };
}

function glyph(id: string, name: string, family: string, hint: string, shape: UnitShape): GlyphCandidate {
  return Object.freeze({ id, name, family, hint, primitives: (cx: number, cy: number, R: number) => shape(scale(cx, cy, R)) });
}

interface Orientation {
  suffix: string;
  /** Direction the figure points to, clockwise from code north. */
  angle: number;
  hint: string;
}

const compass = (hints: [string, string, string, string]): Orientation[] =>
  ['N', 'E', 'S', 'W'].map((suffix, i) => ({ suffix, angle: deg(90 * i), hint: hints[i] }));

const diagonal = (hints: [string, string, string, string]): Orientation[] =>
  ['NE', 'SE', 'SW', 'NW'].map((suffix, i) => ({ suffix, angle: deg(45 + 90 * i), hint: hints[i] }));

function family(
  name: string,
  label: string,
  orientations: Orientation[],
  shape: (k: Scale, angle: number) => Primitive[],
): GlyphCandidate[] {
  return orientations.map((o) => glyph(`${name}_${o.suffix}`, `${label} ${o.suffix}`, name, o.hint, (k) => shape(k, o.angle)));
}

/**
 * Every glyph form considered for a genome vocabulary (see the symbol study
 * report for measurements). Oriented families have four members.
 */
export const GENOME_GLYPH_CANDIDATES: readonly GlyphCandidate[] = Object.freeze([
  glyph('FULL_ORBIT', 'Full orbit', SYMMETRIC_FAMILY, '○', (k) => [k.ring(ORBIT, STROKE)]),
  glyph('ORB', 'Orb', SYMMETRIC_FAMILY, '●', (k) => [k.disc(1)]),
  glyph('POINT', 'Point', SYMMETRIC_FAMILY, '•', (k) => [k.disc(POINT)]),
  glyph('RING_POINT', 'Orbit with point', SYMMETRIC_FAMILY, '◉', (k) => [k.ring(ORBIT, STROKE), k.disc(POINT)]),
  glyph('DOUBLE_ORBIT', 'Double orbit', SYMMETRIC_FAMILY, '◎', (k) => [k.ring(ORBIT, STROKE), k.ring(0.36, 0.24)]),
  glyph('CORE_ORBIT', 'Orb in orbit', SYMMETRIC_FAMILY, '⦿', (k) => [k.ring(ORBIT, STROKE), k.disc(0.5)]),
  glyph('HEAVY_ORBIT', 'Heavy orbit', SYMMETRIC_FAMILY, '⭘', (k) => [k.ring(0.775, 0.45)]),

  // Ring with the half facing the orientation filled.
  ...family('HALF_ORBIT', 'Half orbit', compass(['◓', '◑', '◒', '◐']), (k, a) => [k.ring(ORBIT, STROKE), k.halfDisc(ORBIT, a)]),
  // Solid half disc, no orbit.
  ...family('HALF_ORB', 'Half orb', compass(['⯊', '◗', '⯋', '◖']), (k, a) => [k.halfDisc(1, a)]),
  // Lit crescent bulging towards the orientation (the occluding disc sits opposite).
  ...family('ECLIPSE', 'Eclipse', compass(['◠', '☽', '◡', '☾']), (k, a) => [k.crescent(1, 0.62, a + Math.PI)]),
  // Orbit interrupted by a 90° gap facing the orientation.
  ...family('OPEN_ORBIT', 'Open orbit', compass(['U', 'Ↄ', '∩', 'C']), (k, a) => [
    k.arc(ORBIT, STROKE, a + deg(45), a + deg(315), 'round'),
  ]),
  // Orbit carrying a planet on the orientation side.
  ...family('PLANET', 'Planet', compass(['⏀', '⦶', '⦸', '⦷']), (k, a) => [k.ring(ORBIT, STROKE), k.disc(0.32, { r: 1 - 0.32, angle: a })]),
  // Half orbit: a 180° arc on the orientation side.
  ...family('HALF_ARC', 'Half arc', compass(['⌒', ')', '‿', '(']), (k, a) => [k.arc(ORBIT, STROKE, a - deg(90), a + deg(90), 'round')]),
  // Orbit with the quadrant facing the (diagonal) orientation filled.
  ...family('QUARTER_ORBIT', 'Quarter orbit', diagonal(['◔', '◶', '◵', '◴']), (k, a) => [
    k.ring(ORBIT, STROKE),
    k.arc(ORBIT / 2, ORBIT, a - deg(45), a + deg(45), 'butt'),
  ]),
  // Two opposite 100° arcs whose axis has the given orientation (45° steps).
  ...family(
    'ARC_PAIR',
    'Arc pair',
    ['N', 'NE', 'E', 'SE'].map((suffix, i) => ({ suffix, angle: deg(45 * i), hint: ['⦅', '⟋', '⦆', '⟍'][i] })),
    (k, a) => [0, Math.PI].map((side) => k.arc(ORBIT, STROKE, a + side - deg(50), a + side + deg(50), 'round')),
  ),
]);

/**
 * GENOME-01 — FROZEN index order (output of the symbol study, see
 * docs/reports/genome-symbol-study.md). Index = 4-bit glyph value.
 */
const GENOME01_ORDER: readonly string[] = [
  'FULL_ORBIT',
  'ORB',
  'RING_POINT',
  'POINT',
  'HALF_ORBIT_N',
  'HALF_ORBIT_E',
  'HALF_ORBIT_S',
  'HALF_ORBIT_W',
  'ECLIPSE_N',
  'ECLIPSE_E',
  'ECLIPSE_S',
  'ECLIPSE_W',
  'OPEN_ORBIT_N',
  'OPEN_ORBIT_E',
  'OPEN_ORBIT_S',
  'OPEN_ORBIT_W',
];

export const GENOME01_GLYPHS: readonly GlyphDef[] = Object.freeze(
  GENOME01_ORDER.map((id, index) => {
    const candidate = GENOME_GLYPH_CANDIDATES.find((c) => c.id === id);
    if (!candidate) throw new Error(`GENOME-01 glyph ${id} missing from the candidate pool`);
    return Object.freeze({ index, ...candidate });
  }),
);
