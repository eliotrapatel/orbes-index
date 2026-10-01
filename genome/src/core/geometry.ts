/**
 * ORBES shared geometry model.
 *
 * Every visual artifact of the system (ORBES SEAL, GENOME glyphs, ORBES CODE)
 * is described as a list of resolution-independent primitives expressed in
 * abstract units ("u"). Renderers (SVG, PDF, raster) consume this list, which
 * guarantees that every output format is geometrically identical.
 *
 * Coordinate system (shared with SVG):
 *   - origin at the code centre
 *   - x grows to the right, y grows DOWNWARD
 *   - angles are in radians, measured CLOCKWISE from NORTH (straight up)
 *     so that a point at radius r and angle θ is (r·sin θ, −r·cos θ).
 *
 * This module is isomorphic: no Node.js or DOM dependencies.
 */

/** Semantic layer of a primitive. Documents which elements are machine-critical. */
export type Layer =
  /** ORBES SEAL — central finder. MACHINE-CRITICAL (localisation, scale). */
  | 'seal'
  /** Perspective anchors ("moons"). MACHINE-CRITICAL (homography). */
  | 'moon'
  /** Halo around the polar moon. Orientation HINT only (not required). */
  | 'polaris'
  /** Format information cells (version + mask, BCH protected). MACHINE-CRITICAL. */
  | 'format'
  /** Reed-Solomon protected payload + signature cells. MACHINE-CRITICAL. */
  | 'data'
  /** GENOME glyphs. Human identity + secondary machine cross-check (non-critical for decoding). */
  | 'genome'
  /** Decorative brand structures. NEVER sampled by the decoder. */
  | 'decor';

interface PrimitiveBase {
  layer: Layer;
  /** Ink coverage 0..1 (1 = full ink). Decorative elements may use reduced tone. */
  tone?: number;
}

/** Filled disc. */
export interface DiscPrimitive extends PrimitiveBase {
  kind: 'disc';
  cx: number;
  cy: number;
  r: number;
}

/** Annulus centred on radius `r` with radial thickness `width`. */
export interface RingPrimitive extends PrimitiveBase {
  kind: 'ring';
  cx: number;
  cy: number;
  r: number;
  width: number;
}

/**
 * Stroked circular arc centred on radius `r`, thickness `width`, from angle
 * `start` to `end` (clockwise, radians, `end` > `start`). With cap 'round' the
 * round caps are drawn INSIDE [start, end] — i.e. the visual extent of the arc
 * is exactly the angular interval, caps included.
 */
export interface ArcPrimitive extends PrimitiveBase {
  kind: 'arc';
  cx: number;
  cy: number;
  r: number;
  width: number;
  start: number;
  end: number;
  cap: 'round' | 'butt';
}

/**
 * Filled half disc of radius `r`. `angle` is the direction (clockwise from
 * north) of the outward normal of the filled half: angle 0 fills the northern
 * half.
 */
export interface HalfDiscPrimitive extends PrimitiveBase {
  kind: 'halfDisc';
  cx: number;
  cy: number;
  r: number;
  angle: number;
}

/**
 * Crescent ("eclipse"): a disc of radius `r` minus a disc of radius `r`
 * displaced by `offset` (0 < offset < 2r) in direction `angle`. The remaining
 * lit crescent therefore faces the OPPOSITE direction of `angle`.
 */
export interface CrescentPrimitive extends PrimitiveBase {
  kind: 'crescent';
  cx: number;
  cy: number;
  r: number;
  offset: number;
  angle: number;
}

export type Primitive =
  | DiscPrimitive
  | RingPrimitive
  | ArcPrimitive
  | HalfDiscPrimitive
  | CrescentPrimitive;

export interface Point {
  x: number;
  y: number;
}

/** Polar (r, θ clockwise from north) → cartesian in the y-down code plane. */
export function polar(r: number, theta: number, cx = 0, cy = 0): Point {
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}

/** Cartesian (y-down) → angle clockwise from north in [0, 2π). */
export function angleOf(x: number, y: number): number {
  const a = Math.atan2(x, -y);
  return a < 0 ? a + 2 * Math.PI : a;
}

export const TAU = Math.PI * 2;
export const deg = (d: number): number => (d * Math.PI) / 180;
