/**
 * ORBES GENOME — glyph vocabulary.
 *
 * A genome glyph is a small orbital figure drawn inside a circle of radius R.
 * The candidate pool below is the design space evaluated by
 * `scripts/genome-symbol-study.ts`, which rasterises every candidate at
 * 8–24 px under blur, rotation and offset jitter and selects the 16 glyphs that
 * stay most mutually distinct at 10–12 px (docs/reports/genome-symbol-study.md).
 *
 * GENOME-01 is FROZEN: a glyph's index is the 4-bit value it encodes in every
 * product genome ever issued, so neither the order nor the geometry of a
 * GENOME-01 glyph may ever change. A new vocabulary means a new genome version.
 *
 * Design rules shared by every candidate:
 *   - all ink lies within radius R of the glyph centre;
 *   - every stroke, dot diameter and crescent thickness is ≥ 0.22 R so the
 *     figure survives small print and camera blur;
 *   - orientations are ABSOLUTE, relative to code north (never radial), so a
 *     glyph reads the same wherever it sits on the genome orbit;
 *   - a glyph carries its own frame of reference: no figure made of isolated
 *     off-centre dots, whose orientation could only be read against the glyph
 *     grid and which would be confused with the separator points of a genome.
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

/** Family of the rotation-invariant forms. Every other family is oriented, with four members. */
export const SYMMETRIC_FAMILY = 'SYMMETRIC';

// Proportions, in units of R. Tuned by the symbol study.
/** Stroke of every orbit: 18 % above the 0.22 R floor, for print and engraving spread. */
const STROKE = 0.26;
/** Centreline of the outer orbit, so its outer edge lies exactly on R. */
const ORBIT = 1 - STROKE / 2;
const POINT = 0.37;
/** Core of the orbit-with-point: larger than a free point so it does not read as an empty orbit. */
const CORE = 0.42;
const SMALL_ORBIT = 0.5;
/** A solid orb is optically heavier than an outline: drawn smaller than the orbit. */
const ORB = 0.8;

/** Builders for primitives expressed in units of R around one glyph centre. */
interface UnitPrimitives {
  disc(r: number, at?: { r: number; angle: number }): Primitive;
  ring(r: number, width: number): Primitive;
  arc(r: number, width: number, start: number, end: number, cap: 'round' | 'butt'): Primitive;
  halfDisc(r: number, angle: number): Primitive;
  crescent(r: number, offset: number, angle: number): Primitive;
}

function unitPrimitives(cx: number, cy: number, R: number): UnitPrimitives {
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

function glyph(id: string, name: string, family: string, hint: string, shape: (u: UnitPrimitives) => Primitive[]): GlyphCandidate {
  return Object.freeze({ id, name, family, hint, primitives: (cx: number, cy: number, R: number) => shape(unitPrimitives(cx, cy, R)) });
}

interface Orientation {
  suffix: string;
  /** Direction the figure points to, clockwise from code north. */
  angle: number;
  hint: string;
}

const orientations = (suffixes: string[], firstDeg: number, stepDeg: number, hints: string[]): Orientation[] =>
  suffixes.map((suffix, i) => ({ suffix, angle: deg(firstDeg + stepDeg * i), hint: hints[i] }));

const COMPASS = ['N', 'E', 'S', 'W'];
const DIAGONALS = ['NE', 'SE', 'SW', 'NW'];
/** Axes of point-symmetric figures, 45° apart. */
const AXES = ['NS', 'NESW', 'EW', 'NWSE'];

function family(
  name: string,
  label: string,
  members: Orientation[],
  shape: (u: UnitPrimitives, angle: number) => Primitive[],
): GlyphCandidate[] {
  return members.map((o) => glyph(`${name}_${o.suffix}`, `${label} ${o.suffix}`, name, o.hint, (u) => shape(u, o.angle)));
}

/**
 * Every glyph form considered for a genome vocabulary (measurements in the
 * symbol study report). Oriented families have exactly four members.
 */
export const GENOME_GLYPH_CANDIDATES: readonly GlyphCandidate[] = Object.freeze([
  glyph('FULL_ORBIT', 'Full orbit', SYMMETRIC_FAMILY, '○', (u) => [u.ring(ORBIT, STROKE)]),
  glyph('RING_POINT', 'Orbit with core', SYMMETRIC_FAMILY, '◉', (u) => [u.ring(ORBIT, STROKE), u.disc(CORE)]),
  glyph('SMALL_ORBIT', 'Small orbit', SYMMETRIC_FAMILY, '◦', (u) => [u.ring(SMALL_ORBIT, STROKE)]),
  glyph('POINT', 'Point', SYMMETRIC_FAMILY, '•', (u) => [u.disc(POINT)]),
  glyph('ORB', 'Orb', SYMMETRIC_FAMILY, '●', (u) => [u.disc(ORB)]),
  glyph('DOUBLE_ORBIT', 'Double orbit', SYMMETRIC_FAMILY, '◎', (u) => [u.ring(ORBIT, STROKE), u.ring(0.36, 0.24)]),
  glyph('HEAVY_ORBIT', 'Heavy orbit', SYMMETRIC_FAMILY, '⭘', (u) => [u.ring(0.775, 0.45)]),

  // Half of the orbit, on the orientation side.
  ...family('HALF_ARC', 'Half arc', orientations(COMPASS, 0, 90, ['◠', ')', '◡', '(']), (u, a) => [
    u.arc(ORBIT, STROKE, a - deg(90), a + deg(90), 'round'),
  ]),
  // Two opposite quarter orbits on the given axis.
  ...family('ARC_PAIR', 'Arc pair', orientations(AXES, 0, 45, ['↕', '⤢', '↔', '⤡']), (u, a) =>
    [0, Math.PI].map((side) => u.arc(ORBIT, STROKE, a + side - deg(45), a + side + deg(45), 'round')),
  ),
  // Quarter of an orb, in the given diagonal quadrant.
  ...family('QUARTER_ORB', 'Quarter orb', orientations(DIAGONALS, 45, 90, ['◝', '◞', '◟', '◜']), (u, a) => [
    u.arc(0.5, 1, a - deg(45), a + deg(45), 'butt'),
  ]),
  // Orbit with the half facing the orientation filled.
  ...family('HALF_ORBIT', 'Half orbit', orientations(COMPASS, 0, 90, ['◓', '◑', '◒', '◐']), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.halfDisc(ORBIT, a),
  ]),
  // Solid half orb.
  ...family('HALF_ORB', 'Half orb', orientations(COMPASS, 0, 90, ['⯊', '◗', '⯋', '◖']), (u, a) => [u.halfDisc(1, a)]),
  // Lit crescent bulging towards the orientation (the occluding disc sits opposite).
  ...family('ECLIPSE', 'Eclipse', orientations(COMPASS, 0, 90, ['⏜', '☽', '⏝', '☾']), (u, a) => [u.crescent(1, 0.62, a + Math.PI)]),
  // Orbit interrupted by a 90° gap facing the orientation.
  ...family('OPEN_ORBIT', 'Open orbit', orientations(COMPASS, 0, 90, ['U', 'Ↄ', '∩', 'C']), (u, a) => [
    u.arc(ORBIT, STROKE, a + deg(45), a + deg(315), 'round'),
  ]),
  // Orbit with the quadrant facing the diagonal orientation filled.
  ...family('QUARTER_ORBIT', 'Quarter orbit', orientations(DIAGONALS, 45, 90, ['◔', '◶', '◵', '◴']), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.arc(ORBIT / 2, ORBIT, a - deg(45), a + deg(45), 'butt'),
  ]),
  // Orbit carrying a planet on the orientation side.
  ...family('PLANET', 'Planet', orientations(COMPASS, 0, 90, ['⏀', '⦶', '⦸', '⦷']), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.disc(0.32, { r: 1 - 0.32, angle: a }),
  ]),
]);

/**
 * GENOME-01 — FROZEN index order. The set is the symbol study winner; the
 * order runs through the symmetric forms from the outer orbit inwards, then
 * each oriented family clockwise from north. Index = 4-bit glyph value.
 */
const GENOME01_ORDER: readonly string[] = [
  'FULL_ORBIT',
  'RING_POINT',
  'SMALL_ORBIT',
  'POINT',
  'HALF_ARC_N',
  'HALF_ARC_E',
  'HALF_ARC_S',
  'HALF_ARC_W',
  'ARC_PAIR_NS',
  'ARC_PAIR_NESW',
  'ARC_PAIR_EW',
  'ARC_PAIR_NWSE',
  'QUARTER_ORB_NE',
  'QUARTER_ORB_SE',
  'QUARTER_ORB_SW',
  'QUARTER_ORB_NW',
];

export const GENOME01_GLYPHS: readonly GlyphDef[] = Object.freeze(
  GENOME01_ORDER.map((id, index) => {
    const candidate = GENOME_GLYPH_CANDIDATES.find((c) => c.id === id);
    if (!candidate) throw new Error(`GENOME-01 glyph ${id} missing from the candidate pool`);
    return Object.freeze({ index, ...candidate });
  }),
);
