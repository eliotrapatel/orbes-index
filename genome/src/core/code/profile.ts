/**
 * ORBES CODE-01 — geometric profile.
 *
 * This file is the single source of truth for the CODE-01 layout. The
 * encoder, the renderers and the decoder all derive their geometry from it.
 * Changing ANY value here breaks compatibility with every printed CODE-01
 * artifact: a new layout must be published as a new profile (CODE-02, …).
 *
 * Unit: 1 u = nominal cell pitch. All radii are in u.
 *
 *   r 0.0 ─ 2.0   SEAL core (solid orb)                       machine-critical
 *   r 2.0 ─ 3.0   SEAL gap (light)                            machine-critical
 *   r 3.0 ─ 4.0   SEAL orbit (solid ring)                     machine-critical
 *   r 4.0 ─ 5.75  quiet ring (light), half-open [4.0, 5.75)    machine-critical
 *   r 5.75─ 9.25  GENOME orbit: 8 glyphs, centre radius 7.5   identity / cross-check
 *                 (a glyph's innermost ink may touch r = 5.75 exactly, by
 *                 design: orbit 7.5 − glyph radius 1.75 = quietOuter; the
 *                 seal keeps its full 1.75 u clearance, ORBES-CODE-SPEC §4.2)
 *   r 10.0─ 23.0  DATA orbits: 13 rings, centre radii 10.5…22.5, pitch 1
 *                 ring 0 carries 2 copies of the BCH format word
 *   r 23.0─ 25.75 quiet band (light)                          machine-critical
 *                 (ink-free except the decor hairlines at r 23.5 and 24.0,
 *                 ≥ 0.6 u from machine-critical ink, ORBES-CODE-SPEC §4.7)
 *   moons         4 solid discs, radius 1.75, centre radius 27.5 at the
 *                 diagonals (NW, NE, SE, SW); the NW moon ("polaris") carries a
 *                 thin concentric halo used only as an orientation hint.
 *   extent        square of half-width 23 + 2 u quiet zone  → 50 u × 50 u
 */

import { TAU, deg, polar, type Point } from '../geometry.js';

export interface RingSpec {
  /** 0 = innermost data ring. */
  index: number;
  /** Centre radius in u. */
  radius: number;
  /** Number of cells on the ring (multiple of 4 → 90° rotation = index shift). */
  cells: number;
  /** Global index of the ring's first cell in the flattened cell array. */
  offset: number;
}

export interface CellRef {
  ring: number;
  cell: number;
  /** Index in the flattened cell array (ring-major, clockwise from north). */
  flat: number;
}

export const CODE01 = {
  id: 'CODE-01',
  version: 1,

  seal: {
    coreRadius: 2.0,
    gapOuter: 3.0,
    ringOuter: 4.0,
    /** Outer edge of the seal quiet ring; equals genome.orbitRadius − genome.glyphRadius on purpose (genome ink may touch it). */
    quietOuter: 5.75,
  },

  genome: {
    orbitRadius: 7.5,
    glyphRadius: 1.75,
    count: 8,
    /** glyph i is centred at angle i · 45° clockwise from north */
    stepRad: TAU / 8,
  },

  data: {
    firstRadius: 10.5,
    ringCount: 13,
    pitch: 1,
    /** Radial thickness of a drawn data arc (u). Cell centre sampling is at ring radius. */
    arcThickness: 0.72,
  },

  format: {
    /** Format words live on ring 0. Two asymmetric copies (start cells). */
    ring: 0,
    copyStarts: [0, 24] as const,
    bits: 15,
  },

  moons: {
    orbitRadius: 27.5,
    radius: 1.75,
    /** Clockwise from north. Index 0 is POLARIS (NW). */
    anglesDeg: [315, 45, 135, 225] as const,
    polarisIndex: 0,
    /** Polaris halo annulus (hint only): centre radius & width, relative to moon centre. */
    haloRadius: 2.6,
    haloWidth: 0.4,
  },

  extent: {
    /** Half width of the content square (u). */
    halfWidth: 23.0,
    /** Mandatory quiet zone around the content square (u). */
    quiet: 2.0,
  },

  ecc: {
    /** Bytes of protected data: 13 payload + 64 signature + 2 CRC-16. */
    dataBytes: 79,
    /** Total RS(255-shortened) codeword length over GF(256). */
    totalBytes: 164,
  },
} as const;

/** Total side length of the printed artifact, quiet zone included (u). */
export const CODE01_SIZE = 2 * (CODE01.extent.halfWidth + CODE01.extent.quiet); // 50

/** Ring layout (computed once, deterministic). */
export const CODE01_RINGS: readonly RingSpec[] = (() => {
  const rings: RingSpec[] = [];
  let offset = 0;
  for (let k = 0; k < CODE01.data.ringCount; k++) {
    const radius = CODE01.data.firstRadius + k * CODE01.data.pitch;
    const cells = 4 * Math.round((TAU * radius) / 4);
    rings.push({ index: k, radius, cells, offset });
    offset += cells;
  }
  return rings;
})();

/** Total number of data-orbit cells (format + data + padding). */
export const CODE01_TOTAL_CELLS = CODE01_RINGS.reduce((s, r) => s + r.cells, 0); // 1344

/** Flattened indices of format cells: copy c, bit b (MSB first) → flat index. */
export const CODE01_FORMAT_CELLS: readonly (readonly number[])[] = CODE01.format.copyStarts.map(
  (start) => {
    const ring = CODE01_RINGS[CODE01.format.ring];
    return Array.from({ length: CODE01.format.bits }, (_, b) => ring.offset + ((start + b) % ring.cells));
  },
);

const FORMAT_SET = new Set(CODE01_FORMAT_CELLS.flat());

/**
 * Flattened indices of DATA cells in bit order. Bit j of the RS codeword
 * (byte j>>3, MSB first) is stored in cell CODE01_DATA_CELLS[j]. Cells beyond
 * totalBytes·8 are padding (value 0 before masking).
 */
export const CODE01_DATA_CELLS: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < CODE01_TOTAL_CELLS; i++) if (!FORMAT_SET.has(i)) out.push(i);
  return out;
})();

export const CODE01_DATA_BITS = CODE01.ecc.totalBytes * 8; // 1312
export const CODE01_PADDING_CELLS = CODE01_DATA_CELLS.length - CODE01_DATA_BITS; // 2

/** Map a flat cell index to (ring, cell). */
export function cellRef(flat: number): CellRef {
  for (const ring of CODE01_RINGS) {
    if (flat < ring.offset + ring.cells) return { ring: ring.index, cell: flat - ring.offset, flat };
  }
  throw new RangeError(`cell ${flat} out of range`);
}

/** Angular span [start, end) of a cell (radians, clockwise from north). */
export function cellSpan(ring: RingSpec, cell: number): { start: number; end: number; mid: number } {
  const step = TAU / ring.cells;
  return { start: cell * step, end: (cell + 1) * step, mid: (cell + 0.5) * step };
}

/** Centre point of a cell in code-plane coordinates (u, y-down). */
export function cellCenter(flat: number): Point {
  const { ring, cell } = cellRef(flat);
  const spec = CODE01_RINGS[ring];
  return polar(spec.radius, cellSpan(spec, cell).mid);
}

/** Centres of the four moons in code-plane coordinates, index 0 = polaris (NW). */
export const CODE01_MOONS: readonly Point[] = CODE01.moons.anglesDeg.map((a) =>
  polar(CODE01.moons.orbitRadius, deg(a)),
);

/** Centres of the eight genome glyphs, glyph 0 at north, clockwise. */
export const CODE01_GENOME_CENTERS: readonly Point[] = Array.from({ length: CODE01.genome.count }, (_, i) =>
  polar(CODE01.genome.orbitRadius, i * CODE01.genome.stepRad),
);

// ── Masking ────────────────────────────────────────────────────────────────
//
// Data cells (NOT format cells) are XORed with one of four fixed pseudo-random
// mask sequences so that printed artifacts never show long empty or solid
// sectors (which would hurt both aesthetics and local thresholding). The mask
// id is recorded in the format word. Sequences come from xorshift32 seeded
// with fixed constants; bit = most significant bit of the state after each
// step. This is a WHITENING pattern, not a security mechanism.

const MASK_SEEDS = [0x9e3779b9, 0x7f4a7c15, 0x94d049bb, 0xbf58476d] as const;
export const CODE01_MASK_COUNT = MASK_SEEDS.length;

const maskCache = new Map<number, Uint8Array>();

/**
 * Mask bits for data-cell positions 0..CODE01_DATA_CELLS.length-1. Returns a
 * fresh copy each call so a caller mutating it can never corrupt later encodes
 * or decodes in the same process (copying 1314 bytes is negligible).
 */
export function maskBits(mask: number): Uint8Array {
  return maskBitsShared(mask).slice();
}

function maskBitsShared(mask: number): Uint8Array {
  if (!Number.isInteger(mask) || mask < 0 || mask >= MASK_SEEDS.length) {
    throw new RangeError(`invalid mask ${mask}`);
  }
  const cached = maskCache.get(mask);
  if (cached) return cached;
  const out = new Uint8Array(CODE01_DATA_CELLS.length);
  let s = MASK_SEEDS[mask] >>> 0;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s >>> 31;
  }
  maskCache.set(mask, out);
  return out;
}

// ── Format word ────────────────────────────────────────────────────────────
//
// 5 information bits: (codeVersion − 1) in the 3 high bits, mask id in the 2
// low bits. Protected with BCH(15,5) (generator 0x537) and XORed with 0x5412
// (the same well-studied construction as QR Code format information) so that
// the all-zero word never appears. See src/core/ecc/bch.ts.

export function formatInfoValue(codeVersion: number, mask: number): number {
  if (!Number.isInteger(codeVersion) || codeVersion < 1 || codeVersion > 8) throw new RangeError('codeVersion out of range');
  if (!Number.isInteger(mask) || mask < 0 || mask > 3) throw new RangeError('mask out of range');
  return ((codeVersion - 1) << 2) | mask;
}

export function parseFormatInfoValue(v: number): { codeVersion: number; mask: number } {
  return { codeVersion: ((v >> 2) & 0b111) + 1, mask: v & 0b11 };
}
