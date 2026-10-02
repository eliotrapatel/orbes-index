/**
 * Multi-up print sheets: where each labelled code goes on the page.
 *
 * The server's print-sheet PDF and its manifest (src/server/render/
 * artifact.ts, planPrintSheet) and the console's preview ("35 per A4 ·
 * 4 pages", src/web/admin/model/generator.ts) all place codes with these
 * functions, so the preview, the PDF and the manifest cannot disagree. It
 * lives in the core because the console bundles it and the production image
 * ships src/core and src/server only.
 *
 * Units are millimetres, origin at the top-left corner of the page.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */
import { CODE01_SIZE } from '../code/profile.js';

export type SheetPageSize = 'A4' | 'A3' | 'LETTER';
export const SHEET_PAGES: Readonly<Record<SheetPageSize, readonly [number, number]>> = Object.freeze({
  A4: [210, 297] as const,
  A3: [297, 420] as const,
  LETTER: [215.9, 279.4] as const,
});

/** Height reserved at the bottom of a sheet for the footer line and scale bar. */
export const SHEET_FOOTER_MM = 10;

/** Height of the print label (product id + ORBES) under a code, in code units (the code is 50 u wide). */
export const ARTIFACT_LABEL_HEIGHT_U = 7.5;

/** Physical size of one code on a sheet: its width, and its height with the label area when labelled. */
export function artifactCellMm(widthMm: number, label: boolean): { widthMm: number; heightMm: number } {
  const h = CODE01_SIZE + (label ? ARTIFACT_LABEL_HEIGHT_U : 0);
  return { widthMm, heightMm: (widthMm * h) / CODE01_SIZE };
}

export interface SheetLayoutOptions {
  page?: SheetPageSize;
  /** Page margin (default 12 mm). The bottom margin also holds the footer. */
  marginMm?: number;
  /** Space between artifacts, where crop marks go (default 8 mm). */
  gutterMm?: number;
}

export interface SheetPlacement {
  /** Index into the item list. */
  index: number;
  /** Top-left corner of the cell on its page. */
  xMm: number;
  yMm: number;
  /** Grid row and column on the page, from 0 (top row, left column). */
  row: number;
  column: number;
}

export interface SheetLayout {
  pageWidthMm: number;
  pageHeightMm: number;
  columns: number;
  rows: number;
  pages: SheetPlacement[][];
}

/**
 * Grid placement of `count` cells of `cellW × cellH` mm on as many pages as
 * needed, centred horizontally, filled row by row from the top-left corner.
 * Throws RangeError when a cell does not fit the page.
 */
export function layoutSheet(cellWmm: number, cellHmm: number, count: number, opts: SheetLayoutOptions = {}): SheetLayout {
  const [pw, ph] = SHEET_PAGES[opts.page ?? 'A4'] ?? SHEET_PAGES.A4;
  const margin = opts.marginMm ?? 12;
  const gutter = opts.gutterMm ?? 8;
  if (!(cellWmm > 0 && cellHmm > 0)) throw new RangeError('cell size must be positive');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
  const usableW = pw - 2 * margin;
  const usableH = ph - 2 * margin - SHEET_FOOTER_MM;
  const columns = Math.floor((usableW + gutter) / (cellWmm + gutter));
  const rows = Math.floor((usableH + gutter) / (cellHmm + gutter));
  if (columns < 1 || rows < 1) throw new RangeError('the artifact does not fit on the page');
  const gridW = columns * cellWmm + (columns - 1) * gutter;
  const x0 = (pw - gridW) / 2;
  const perPage = columns * rows;
  const pages: SheetPlacement[][] = [];
  for (let i = 0; i < count; i++) {
    const slot = i % perPage;
    if (slot === 0) pages.push([]);
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    pages[pages.length - 1].push({ index: i, xMm: x0 + column * (cellWmm + gutter), yMm: margin + row * (cellHmm + gutter), row, column });
  }
  return { pageWidthMm: pw, pageHeightMm: ph, columns, rows, pages };
}
