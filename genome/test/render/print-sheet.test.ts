import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeOrbesCode } from '../../src/core/code/encoder.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData } from '../../src/core/payload.js';
import * as coreSheet from '../../src/core/render/sheet-layout.js';
import {
  ArtifactOptionsError,
  artifactCellMm,
  buildArtifactScene,
  cropMarks,
  LABEL_LAYOUT,
  labelStrokes,
  layoutSheet,
  MAX_SHEET_ITEMS,
  mmToPt,
  planPrintSheet,
  PRINT_SHEET_MANIFEST_COLUMNS,
  printSheetManifestCsv,
  renderPrintSheet,
  SHEET_FOOTER_MM,
  SHEET_PAGES,
  type PrintSheetItem,
  type PrintSheetManifestItem,
} from '../../src/server/render/index.js';

function item(serial: number): PrintSheetItem {
  const identity = { year: 2026, categoryIndex: 1, serial };
  const payload = encodePayload({ codeVersion: 1, genomeVersion: 1, keyId: 1, identity, issue: 1, issuedDay: 800, nonce: Uint8Array.of(1, 2, 3, serial & 0xff) });
  // Rendering never verifies signatures; a dummy signature keeps this test independent of keys.
  return {
    data: frameCodeData(payload, new Uint8Array(64).fill(serial & 0xff)),
    genomeGlyphs: computeGenome(packIdentity(identity)).glyphs,
    productId: `O26-J-${String(serial).padStart(5, '0')}`,
  };
}

const xsOf = (d: string) => [...d.matchAll(/[MLA][^MLAZ]*?([-\d.]+) ([-\d.]+)(?=[MLAZ]|$)/g)].map((m) => Number(m[1]));

describe('labeled artifact layout', () => {
  it('places the product id and ORBES under the quiet zone, centred, within the side margins', () => {
    for (const id of ['O26-J-00184', 'O99-W-999999']) {
      const [line, brand] = labelStrokes(id);
      for (const s of [line, brand]) {
        const xs = xsOf(s.d);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(-25 + LABEL_LAYOUT.sideMargin - 0.01);
        expect(Math.max(...xs)).toBeLessThanOrEqual(25 - LABEL_LAYOUT.sideMargin + 0.01);
        expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(1.5); // roughly centred
      }
      expect(line.width).toBeGreaterThan(brand.width);
    }
  });

  it('scene: viewBox and physical height grow by the label area', () => {
    const it0 = item(1);
    const model = encodeOrbesCode(it0, {});
    const plain = buildArtifactScene(model, { widthMm: 40, theme: 'classic', label: false });
    const labeled = buildArtifactScene(model, { widthMm: 40, theme: 'ivory', label: true, productId: it0.productId });
    expect(plain.viewBox).toEqual({ x: -25, y: -25, w: 50, h: 50 });
    expect(plain.heightMm).toBe(40);
    expect(plain.strokes).toEqual([]);
    expect(labeled.viewBox.h).toBe(50 + LABEL_LAYOUT.height);
    expect(labeled.heightMm).toBeCloseTo(46, 9);
    expect(labeled.paper).toBe('#F6F2EA');
    expect(() => buildArtifactScene(model, { widthMm: 40, theme: 'classic', label: true })).toThrow(/product id/);
    expect(() => buildArtifactScene(model, { widthMm: 0, theme: 'classic', label: false })).toThrow(RangeError);
  });
});

describe('multi-up sheets', () => {
  it('fits a centred grid inside the margins and above the footer', () => {
    const l = layoutSheet(25, 28.75, 30, { page: 'A4' });
    expect([l.pageWidthMm, l.pageHeightMm]).toEqual([...SHEET_PAGES.A4]);
    expect(l.columns).toBe(5); // (186 + 8) / (25 + 8) = 5.9
    expect(l.rows).toBe(7); // usable height 297 − 2·12 − 10 = 263 mm: (263 + 8) / (28.75 + 8) = 7.4
    const perPage = l.columns * l.rows;
    expect(l.pages).toHaveLength(Math.ceil(30 / perPage));
    for (const page of l.pages) {
      for (const p of page) {
        expect(p.xMm).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(p.xMm + 25).toBeLessThanOrEqual(210 - 12 + 1e-9);
        expect(p.yMm + 28.75).toBeLessThanOrEqual(297 - 12 - SHEET_FOOTER_MM + 1e-9);
      }
    }
    const first = l.pages[0];
    const left = first[0].xMm;
    const right = 210 - (first[l.columns - 1].xMm + 25);
    expect(left).toBeCloseTo(right, 9);
  });

  it('numbers each cell by row and column, filled row by row from the top-left corner', () => {
    const l = layoutSheet(60, 69, 8, { page: 'A4' });
    expect([l.columns, l.rows]).toEqual([2, 3]);
    expect(l.pages.map((p) => p.map(({ index, row, column }) => [index, row, column]))).toEqual([
      [[0, 0, 0], [1, 0, 1], [2, 1, 0], [3, 1, 1], [4, 2, 0], [5, 2, 1]],
      [[6, 0, 0], [7, 0, 1]],
    ]);
    for (const page of l.pages) {
      for (const p of page) {
        expect(p.xMm).toBeCloseTo(l.pages[0][p.column].xMm, 9);
        expect(p.yMm).toBeCloseTo(l.pages[0][p.row * l.columns].yMm, 9);
      }
    }
  });

  it('lives in the core, where the console computes its preview with the same cell size as the PDF', () => {
    expect(layoutSheet).toBe(coreSheet.layoutSheet);
    expect(SHEET_PAGES).toBe(coreSheet.SHEET_PAGES);
    expect(LABEL_LAYOUT.height).toBe(coreSheet.ARTIFACT_LABEL_HEIGHT_U);
    const model = encodeOrbesCode(item(1), {});
    for (const label of [true, false]) {
      const scene = buildArtifactScene(model, { widthMm: 27.5, theme: 'classic', label, productId: 'O26-J-00001' });
      expect(artifactCellMm(27.5, label)).toEqual({ widthMm: scene.widthMm, heightMm: scene.heightMm });
    }
  });

  it('paginates and refuses cells that do not fit', () => {
    const l = layoutSheet(60, 69, 7, { page: 'A4', gutterMm: 8 });
    expect(l.columns * l.rows).toBe(6);
    expect(l.pages.map((p) => p.length)).toEqual([6, 1]);
    expect(l.pages[1][0].index).toBe(6);
    expect(() => layoutSheet(300, 300, 1)).toThrow(RangeError);
    expect(() => layoutSheet(25, 25, 0)).toThrow(RangeError);
  });

  it('crop marks: two ticks per corner, outside the artwork', () => {
    const marks = cropMarks([{ index: 0, xMm: 20, yMm: 30, row: 0, column: 0 }], 25, 25);
    expect((marks.d.match(/M/g) ?? []).length).toBe(8);
    const pts = [...marks.d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (const [x, y] of pts) {
      const inside = x > 20 && x < 45 && y > 30 && y < 55;
      expect(inside).toBe(false);
    }
  });

  it('renders a multi-page PDF with every code, crop marks and the footer', async () => {
    const items = Array.from({ length: 31 }, (_, i) => item(i + 1));
    const r = await renderPrintSheet(items, { widthMm: 25 }, { createdAt: new Date('2026-02-01T00:00:00Z') });
    expect(r.contentType).toBe('application/pdf');
    expect(r.filename).toBe('ORBES-sheet-2026-02-01-31-classic-25mm.pdf');
    const text = Buffer.from(r.body as Uint8Array).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const l = layoutSheet(25, 25 * (57.5 / 50), 31);
    expect(text).toMatch(new RegExp(`/Count ${l.pages.length}\\b`));
    expect(text.replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, '')).not.toMatch(/\/Subtype\s*\/Image|\/Font/);
  });

  it('validates sheet requests', async () => {
    const createdAt = new Date('2026-02-01T00:00:00Z');
    await expect(renderPrintSheet([], {}, { createdAt })).rejects.toBeInstanceOf(ArtifactOptionsError);
    await expect(renderPrintSheet([item(1)], { page: 'B5' as never }, { createdAt })).rejects.toBeInstanceOf(ArtifactOptionsError);
    await expect(renderPrintSheet([item(1)], { widthMm: 400 }, { createdAt })).rejects.toThrow(/too large for this page/);
    expect(MAX_SHEET_ITEMS).toBe(200);
  });
});

// ── Plan and manifest ──────────────────────────────────────────────────────

const CREATED = new Date('2026-02-01T00:00:00Z');

function manifestItem(it: PrintSheetItem, i: number): PrintSheetManifestItem {
  return { productId: it.productId, sku: `MNL-RG-SIZE-${48 + i}`, variant: i % 3 === 0 ? null : `Size ${48 + i}`, material: '925 STERLING SILVER', codeId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` };
}

/** Rows of an RFC 4180 document whose every field is quoted. */
function parseCsv(csv: string): string[][] {
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv
    .slice(0, -2)
    .split('\r\n')
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1].replace(/""/g, '"')));
}

/** Inflated content streams of a PDF's pages, in page order (each opens with the page's y-flip). */
function pageContents(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const pages: string[] = [];
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    let content = '';
    try {
      content = inflateSync(Buffer.from(pdf.subarray(start, end))).toString('latin1');
    } catch {
      // Not a deflated stream: not page content.
    }
    if (/^1 0 0 -1 0 [\d.]+ cm\n/.test(content)) pages.push(content);
    re.lastIndex = end;
  }
  return pages;
}

/**
 * Every code the PDF draws, in drawing order: its page (from 1), the top-left
 * corner of its scene in page millimetres (from the scene's `cm`), and what is
 * drawn in it (scene units, so the same wherever the code sits on the page).
 */
function drawnCodes(pdf: Uint8Array, widthMm: number): { page: number; xMm: number; yMm: number; body: string }[] {
  const s = mmToPt(widthMm) / 50;
  const out: { page: number; xMm: number; yMm: number; body: string }[] = [];
  pageContents(pdf).forEach((content, p) => {
    for (const m of content.matchAll(/^q\n([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\n([\s\S]*?)\nQ$/gm)) {
      if (Math.abs(Number(m[1]) - s) > 1e-5 || m[1] !== m[2]) continue; // the page marks' millimetre transform
      // drawScene: tx = mmToPt(x) − viewBox.x · s, with viewBox.x = −25 (and the same for y).
      out.push({ page: p + 1, xMm: (Number(m[3]) - 25 * s) / mmToPt(1), yMm: (Number(m[4]) - 25 * s) / mmToPt(1), body: m[5] });
    }
  });
  return out;
}

describe('print-sheet plan and manifest', () => {
  it('plans every code: page, row and column from 1, in item order, from the same grid as the PDF', () => {
    const plan = planPrintSheet(9, { widthMm: 60, page: 'A4' });
    expect(plan.options).toMatchObject({ widthMm: 60, theme: 'classic', label: true, decor: true, kOnly: false });
    expect([plan.cellWmm, plan.cellHmm]).toEqual([60, 69]);
    expect([plan.layout.columns, plan.layout.rows]).toEqual([2, 3]);
    expect(plan.slots.map((x) => x.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan.slots.map((x) => [x.page, x.row, x.column])).toEqual([
      [1, 1, 1], [1, 1, 2], [1, 2, 1], [1, 2, 2], [1, 3, 1], [1, 3, 2],
      [2, 1, 1], [2, 1, 2], [2, 2, 1],
    ]);
    const flat = plan.layout.pages.flat();
    plan.slots.forEach((x, i) => expect([x.xMm, x.yMm]).toEqual([flat[i].xMm, flat[i].yMm]));
    // Defaults as the sheet's: 25 mm, labelled, A4.
    const d = planPrintSheet(1, {});
    expect([d.page, d.cellWmm, d.cellHmm, d.options.label]).toEqual(['A4', 25, 28.75, true]);
  });

  it('refuses what the sheet refuses', () => {
    expect(() => planPrintSheet(0, {})).toThrow(ArtifactOptionsError);
    expect(() => planPrintSheet(MAX_SHEET_ITEMS + 1, {})).toThrow(/1 to 200 codes/);
    expect(() => planPrintSheet(1, { page: 'B5' as never })).toThrow(/A4, A3 or LETTER/);
    expect(() => planPrintSheet(1, { page: 'toString' as never })).toThrow(/A4, A3 or LETTER/);
    expect(() => planPrintSheet(1, { widthMm: 400 })).toThrow(/too large for this page/);
    expect(() => planPrintSheet(1, { widthMm: 5 })).toThrow(/Width must be between/);
    expect(() => printSheetManifestCsv([], {}, { createdAt: CREATED })).toThrow(ArtifactOptionsError);
  });

  it('writes the manifest as CSV: one row per code in the PDF order, formulas neutralised, named after the sheet', () => {
    const items = [5, 3, 7].map((n, i) => manifestItem(item(n), i));
    items[1] = { ...items[1], variant: '=SUM(A1)', material: 'GOLD, 18 "K"' };
    const r = printSheetManifestCsv(items, { widthMm: 30, theme: 'ivory', page: 'A3' }, { createdAt: CREATED });
    expect(r.contentType).toBe('text/csv; charset=utf-8; header=present');
    expect(r.filename).toBe('ORBES-sheet-2026-02-01-3-ivory-30mm-manifest.csv');
    const rows = parseCsv(r.body as string);
    expect(rows[0]).toEqual([...PRINT_SHEET_MANIFEST_COLUMNS]);
    expect(PRINT_SHEET_MANIFEST_COLUMNS).toEqual(['page', 'row', 'column', 'productId', 'sku', 'variant', 'material', 'codeId']);
    expect(rows.slice(1)).toEqual([
      ['1', '1', '1', 'O26-J-00005', 'MNL-RG-SIZE-48', '', '925 STERLING SILVER', items[0].codeId],
      ['1', '1', '2', 'O26-J-00003', 'MNL-RG-SIZE-49', "'=SUM(A1)", 'GOLD, 18 "K"', items[1].codeId],
      ['1', '1', '3', 'O26-J-00007', 'MNL-RG-SIZE-50', 'Size 50', '925 STERLING SILVER', items[2].codeId],
    ]);
    const k = printSheetManifestCsv(items, { kOnly: true }, { createdAt: CREATED });
    expect(k.filename).toBe('ORBES-sheet-2026-02-01-3-classic-25mm-K-manifest.csv');
  });

  it('puts every manifest row where the PDF draws that code: same page, same row and column, same piece', async () => {
    // Out of serial order and over two pages, so neither sorting nor a single page could hide a mismatch.
    const serials = [5, 3, 7, 1, 6, 2, 4, 9];
    const items = serials.map(item);
    const options = { widthMm: 60, page: 'A4' as const };
    const pdf = (await renderPrintSheet(items, options, { createdAt: CREATED })).body as Uint8Array;
    const drawn = drawnCodes(pdf, options.widthMm);
    const rows = parseCsv(printSheetManifestCsv(items.map(manifestItem), options, { createdAt: CREATED }).body as string).slice(1);
    expect(drawn).toHaveLength(items.length);
    expect(rows).toHaveLength(items.length);

    // Rows and columns read off the PDF alone: the distinct corners, top to bottom and left to right.
    const distinct = (v: number[]) => [...new Set(v.map((x) => x.toFixed(3)))].map(Number).sort((a, b) => a - b);
    const xs = distinct(drawn.map((d) => d.xMm));
    const ys = distinct(drawn.map((d) => d.yMm));
    expect([xs.length, ys.length]).toEqual([2, 3]);
    const at = (v: number, all: number[]) => all.findIndex((x) => Math.abs(x - v) < 1e-3) + 1;

    // What each piece's code looks like on its own, wherever it is placed.
    const alone = new Map<string, string>();
    for (const it of items) {
      const one = drawnCodes((await renderPrintSheet([it], options, { createdAt: CREATED })).body as Uint8Array, options.widthMm);
      expect(one).toHaveLength(1);
      alone.set(it.productId, one[0].body);
    }
    expect(new Set(alone.values()).size).toBe(items.length);

    rows.forEach(([page, row, column, productId], i) => {
      const d = drawn[i];
      expect([String(d.page), String(at(d.yMm, ys)), String(at(d.xMm, xs))], `row ${i + 1}`).toEqual([page, row, column]);
      expect(d.body === alone.get(productId), `row ${i + 1}: ${productId} is drawn at page ${page}, row ${row}, column ${column}`).toBe(true);
    });
    expect(rows.map((r) => r[3])).toEqual(items.map((it) => it.productId));
    expect(rows.map((r) => r[0])).toEqual(['1', '1', '1', '1', '1', '1', '2', '2']);
  });
});
