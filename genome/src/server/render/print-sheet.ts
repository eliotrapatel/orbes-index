/**
 * Print layout: the labeled artifact (code + product id + ORBES under it) and
 * multi-up print sheets for batch production.
 *
 * Labeled artifact, in code units (the code occupies −25..25 including its
 * mandatory 2 u quiet zone; nothing is ever drawn inside that zone):
 *
 *   y −25 ┌──────────────┐
 *         │   ORBES CODE │
 *   y  25 ├──────────────┤  ← quiet zone ends
 *         │ O26-J-00184  │  product id, cap 2.0 u, wide tracking
 *         │  O R B E S   │  brand line, cap 1.1 u, very wide tracking
 *   y 32.5└──────────────┘
 *
 * The label is lettering from ./label-font.ts (stroked geometry, no fonts),
 * so the SVG, PDF and PNG print sheets are identical.
 */
import { renderOrbesCodeSvg, type OrbesCodeModel } from '../../core/code/encoder.js';
import { CODE01_SIZE } from '../../core/code/profile.js';
import {
  ARTIFACT_LABEL_HEIGHT_U,
  artifactCellMm,
  layoutSheet,
  SHEET_FOOTER_MM,
  SHEET_PAGES,
  type SheetLayout,
  type SheetLayoutOptions,
  type SheetPageSize,
  type SheetPlacement,
} from '../../core/render/sheet-layout.js';
import { primitivesToSvg } from '../../core/render/svg.js';
import { measureText, textRun, type TextRun } from './label-font.js';
import { ARTIFACT_THEMES, type ArtifactScene, type ArtifactTheme, type StrokePath, type ViewBox } from './scene.js';

const HALF = CODE01_SIZE / 2;

/** Label geometry in code units, below the code's quiet zone. */
export const LABEL_LAYOUT = Object.freeze({
  /** Height added under the code (the core's ARTIFACT_LABEL_HEIGHT_U, which sheet layouts use). */
  height: ARTIFACT_LABEL_HEIGHT_U,
  idCapHeight: 2.0,
  idTracking: 0.32,
  idBaseline: HALF + 3.0,
  brandText: 'ORBES',
  brandCapHeight: 1.1,
  brandTracking: 0.9,
  brandBaseline: HALF + 5.9,
  /** Lettering never comes closer than this to the artifact's side edges. */
  sideMargin: 2.0,
});

export interface SceneOptions {
  widthMm: number;
  theme: ArtifactTheme;
  label: boolean;
  /** Canonical product id; required when `label` is true. */
  productId?: string;
  title?: string;
}

/** Stroked lettering for a label under a code of half-width 25 u. Shrinks a line that would not fit. */
export function labelStrokes(productId: string): StrokePath[] {
  const L = LABEL_LAYOUT;
  const maxWidth = CODE01_SIZE - 2 * L.sideMargin;
  const line = (text: string, cap: number, tracking: number, baseline: number): TextRun => {
    const fitted = Math.min(cap, maxWidth / Math.max(measureText(text, tracking), 1e-9));
    return textRun(text, { capHeight: fitted, tracking, x: 0, baseline: baseline - (cap - fitted) / 2, align: 'middle' });
  };
  const id = line(productId, L.idCapHeight, L.idTracking, L.idBaseline);
  const brand = line(L.brandText, L.brandCapHeight, L.brandTracking, L.brandBaseline);
  return [
    { d: id.d, width: id.strokeWidth },
    { d: brand.d, width: brand.strokeWidth },
  ];
}

/** Code (+ optional label) as a renderer-neutral scene. */
export function buildArtifactScene(model: OrbesCodeModel, opts: SceneOptions): ArtifactScene {
  if (!(Number.isFinite(opts.widthMm) && opts.widthMm > 0)) throw new RangeError('widthMm must be positive');
  const colors = ARTIFACT_THEMES[opts.theme];
  if (!colors) throw new RangeError(`unknown theme ${String(opts.theme)}`);
  let strokes: StrokePath[] = [];
  let h = CODE01_SIZE;
  if (opts.label) {
    if (!opts.productId) throw new RangeError('a labeled artifact needs the product id');
    strokes = labelStrokes(opts.productId);
    h += LABEL_LAYOUT.height;
  }
  const viewBox: ViewBox = { x: -HALF, y: -HALF, w: CODE01_SIZE, h };
  // The same size the sheet layouts (and the console's preview) compute from the core.
  const cell = artifactCellMm(opts.widthMm, opts.label);
  return {
    viewBox,
    widthMm: cell.widthMm,
    heightMm: cell.heightMm,
    ink: colors.ink,
    paper: colors.paper,
    primitives: model.primitives,
    strokes,
    title: opts.title ?? (opts.productId ? `ORBES CODE ${opts.productId}` : 'ORBES CODE'),
  };
}

/**
 * SVG of a scene. Unlabeled scenes go through the core renderer
 * (renderOrbesCodeSvg, viewBox −25..25); labeled ones extend the viewBox
 * downward and append the stroked lettering in its own group.
 */
export function sceneToSvg(model: OrbesCodeModel, scene: ArtifactScene, decor: boolean): string {
  const style = { ink: scene.ink, paper: scene.paper, decor, widthMm: scene.widthMm, title: scene.title };
  if (scene.strokes.length === 0) return renderOrbesCodeSvg(model, style);
  const svg = primitivesToSvg(scene.primitives, scene.viewBox, style);
  const close = '</svg>\n';
  if (!svg.endsWith(close)) throw new Error('unexpected SVG serialisation from the core renderer');
  const label = [
    `<g data-layer="label" fill="none" stroke="${escapeAttr(scene.ink)}" stroke-linecap="round" stroke-linejoin="round">`,
    ...scene.strokes.map((s) => `<path stroke-width="${fmt(s.width)}" d="${s.d}"/>`),
    '</g>',
  ].join('\n');
  return svg.slice(0, -close.length) + label + '\n' + close;
}

// ── Multi-up sheets ────────────────────────────────────────────────────────

// The grid itself (page sizes, cell size, placement) is in the core, shared with the console's preview.
export { ARTIFACT_LABEL_HEIGHT_U, artifactCellMm, layoutSheet, SHEET_FOOTER_MM, SHEET_PAGES };
export type { SheetLayout, SheetLayoutOptions, SheetPageSize, SheetPlacement };

/** Crop and cut marks: 3 mm ticks starting 1 mm from the edge, 0.1 mm wide. */
const MARK_LEN_MM = 3;
const MARK_GAP_MM = 1;
const MARK_WIDTH_MM = 0.1;

/** Crop marks (corner ticks outside each cell) as one stroked path in page millimetres. */
export function cropMarks(placements: readonly SheetPlacement[], cellWmm: number, cellHmm: number): StrokePath {
  let d = '';
  for (const p of placements) {
    const x0 = p.xMm;
    const y0 = p.yMm;
    const x1 = p.xMm + cellWmm;
    const y1 = p.yMm + cellHmm;
    for (const [x, y, dx, dy] of [
      [x0, y0, -1, -1],
      [x1, y0, 1, -1],
      [x0, y1, -1, 1],
      [x1, y1, 1, 1],
    ] as const) {
      // Horizontal tick beside the corner, vertical tick above/below it; both stop short of the artwork.
      d += `M${fmt(x + dx * MARK_GAP_MM)} ${fmt(y)}L${fmt(x + dx * (MARK_GAP_MM + MARK_LEN_MM))} ${fmt(y)}`;
      d += `M${fmt(x)} ${fmt(y + dy * MARK_GAP_MM)}L${fmt(x)} ${fmt(y + dy * (MARK_GAP_MM + MARK_LEN_MM))}`;
    }
  }
  return { d, width: MARK_WIDTH_MM };
}

/**
 * Cut marks of a grid of abutting cells (no gutter, cut on shared edges):
 * ticks outside the grid on the extension of every cut line, never between
 * cells, where they would land on the neighbouring artwork. Page millimetres.
 */
export function gridCutMarks(x0: number, y0: number, columns: number, rows: number, cellWmm: number, cellHmm: number): StrokePath {
  if (!(Number.isInteger(columns) && columns >= 1 && Number.isInteger(rows) && rows >= 1)) throw new RangeError('a grid needs at least one row and one column');
  const x1 = x0 + columns * cellWmm;
  const y1 = y0 + rows * cellHmm;
  let d = '';
  for (let c = 0; c <= columns; c++) {
    const x = x0 + c * cellWmm;
    d += `M${fmt(x)} ${fmt(y0 - MARK_GAP_MM)}L${fmt(x)} ${fmt(y0 - MARK_GAP_MM - MARK_LEN_MM)}`;
    d += `M${fmt(x)} ${fmt(y1 + MARK_GAP_MM)}L${fmt(x)} ${fmt(y1 + MARK_GAP_MM + MARK_LEN_MM)}`;
  }
  for (let r = 0; r <= rows; r++) {
    const y = y0 + r * cellHmm;
    d += `M${fmt(x0 - MARK_GAP_MM)} ${fmt(y)}L${fmt(x0 - MARK_GAP_MM - MARK_LEN_MM)} ${fmt(y)}`;
    d += `M${fmt(x1 + MARK_GAP_MM)} ${fmt(y)}L${fmt(x1 + MARK_GAP_MM + MARK_LEN_MM)} ${fmt(y)}`;
  }
  return { d, width: MARK_WIDTH_MM };
}

export interface SheetFooterOptions {
  /** Centre line of the footer (default: inside the SHEET_FOOTER_MM band). */
  centerYmm?: number;
  /** Right end of the scale bar (default: 12 mm from the right edge, as the caption is from the left). */
  barRightMm?: number;
  /**
   * '10 MM' under the bar (default), or before it on the caption's baseline:
   * the footer is then no taller than the bar (2 mm), for a tight margin.
   */
  barLabel?: 'below' | 'before';
}

/**
 * Footer of a sheet page in page millimetres: a caption and a 10 mm scale bar
 * so the printer can confirm the sheet was printed at 100 %.
 */
export function sheetFooter(layout: SheetLayout, pageIndex: number, caption: string, opts: SheetFooterOptions = {}): StrokePath[] {
  const y = opts.centerYmm ?? layout.pageHeightMm - SHEET_FOOTER_MM / 2 - 2;
  const left = 12;
  const text = `${caption} · PAGE ${pageIndex + 1}/${layout.pages.length} · PRINT AT ACTUAL SIZE`;
  const run = textRun(text, { capHeight: 1.6, tracking: 0.35, x: left, baseline: y + 0.8, align: 'start' });
  const barRight = opts.barRightMm ?? layout.pageWidthMm - left;
  const bar = `M${fmt(barRight - 10)} ${fmt(y)}L${fmt(barRight)} ${fmt(y)}M${fmt(barRight - 10)} ${fmt(y - 1)}L${fmt(barRight - 10)} ${fmt(y + 1)}M${fmt(barRight)} ${fmt(y - 1)}L${fmt(barRight)} ${fmt(y + 1)}`;
  const barLabel =
    opts.barLabel === 'before'
      ? textRun('10 MM', { capHeight: 1.2, tracking: 0.3, x: barRight - 11.5, baseline: y + 0.8, align: 'end' })
      : textRun('10 MM', { capHeight: 1.2, tracking: 0.3, x: barRight - 5, baseline: y + 3.2, align: 'middle' });
  return [
    { d: run.d, width: run.strokeWidth },
    { d: bar, width: 0.15 },
    { d: barLabel.d, width: barLabel.strokeWidth },
  ];
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError('non-finite coordinate');
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
