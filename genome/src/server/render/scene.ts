/**
 * Renderer-neutral description of one printable artifact (a code, optionally
 * with its label), shared by the SVG, PDF and PNG back ends so every format
 * draws the same geometry at the same physical size.
 *
 * Units: the scene is laid out in code units (u, the CODE-01 cell pitch; the
 * code itself spans −25..25 including its quiet zone) and mapped to
 * millimetres by `widthMm`.
 */
import type { Primitive } from '../../core/geometry.js';
import { ORBES_CODE_STYLES } from '../../core/code/encoder.js';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A path to be stroked with round caps and joins (label lettering, sheet marks). */
export interface StrokePath {
  d: string;
  /** Stroke width in the scene's units. */
  width: number;
}

export interface ArtifactScene {
  /** Drawing area in code units. */
  viewBox: ViewBox;
  /** Physical size of the whole scene (code + label area). */
  widthMm: number;
  heightMm: number;
  ink: string;
  /** Background; null = transparent. */
  paper: string | null;
  /** Code primitives (decor already filtered when disabled). */
  primitives: readonly Primitive[];
  /** Label lettering. Empty when unlabeled. */
  strokes: readonly StrokePath[];
  /** Document title / accessible name. */
  title: string;
}

export type ArtifactTheme = 'black' | 'inverted' | 'ivory';
export const ARTIFACT_THEME_NAMES: readonly ArtifactTheme[] = ['black', 'inverted', 'ivory'];

/** Theme → colours, from the core brand presentations so every surface agrees. */
export const ARTIFACT_THEMES: Readonly<Record<ArtifactTheme, { ink: string; paper: string }>> = Object.freeze({
  black: ORBES_CODE_STYLES.classic,
  inverted: ORBES_CODE_STYLES.inverted,
  ivory: ORBES_CODE_STYLES.ivory,
});

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const mmToPt = (mm: number): number => (mm * PT_PER_INCH) / MM_PER_INCH;

/** '#rgb' / '#rrggbb' → [r, g, b], or null for anything else. */
export function parseHexColor(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Opaque mix of ink over paper at `tone` (the SVG renderer's rule, so reduced
 * tones look identical in every format). Undefined when either colour is not
 * hex or there is no paper: callers then fall back to fill opacity.
 */
export function mixTone(ink: string, paper: string | null, tone: number): string | undefined {
  const a = parseHexColor(ink);
  const b = paper === null ? null : parseHexColor(paper);
  if (!a || !b) return undefined;
  const mixed = a.map((c, i) => Math.round(b[i] + (c - b[i]) * tone));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
