import { describe, expect, it } from 'vitest';
import { encodeOrbesCode } from '../../src/core/code/encoder.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData } from '../../src/core/payload.js';
import {
  ArtifactOptionsError,
  buildArtifactScene,
  cropMarks,
  LABEL_LAYOUT,
  labelStrokes,
  layoutSheet,
  MAX_SHEET_ITEMS,
  renderPrintSheet,
  SHEET_FOOTER_MM,
  SHEET_PAGES,
  type PrintSheetItem,
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
    const plain = buildArtifactScene(model, { widthMm: 40, theme: 'black', label: false });
    const labeled = buildArtifactScene(model, { widthMm: 40, theme: 'ivory', label: true, productId: it0.productId });
    expect(plain.viewBox).toEqual({ x: -25, y: -25, w: 50, h: 50 });
    expect(plain.heightMm).toBe(40);
    expect(plain.strokes).toEqual([]);
    expect(labeled.viewBox.h).toBe(50 + LABEL_LAYOUT.height);
    expect(labeled.heightMm).toBeCloseTo(46, 9);
    expect(labeled.paper).toBe('#F6F2EA');
    expect(() => buildArtifactScene(model, { widthMm: 40, theme: 'black', label: true })).toThrow(/product id/);
    expect(() => buildArtifactScene(model, { widthMm: 0, theme: 'black', label: false })).toThrow(RangeError);
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

  it('paginates and refuses cells that do not fit', () => {
    const l = layoutSheet(60, 69, 7, { page: 'A4', gutterMm: 8 });
    expect(l.columns * l.rows).toBe(6);
    expect(l.pages.map((p) => p.length)).toEqual([6, 1]);
    expect(l.pages[1][0].index).toBe(6);
    expect(() => layoutSheet(300, 300, 1)).toThrow(RangeError);
    expect(() => layoutSheet(25, 25, 0)).toThrow(RangeError);
  });

  it('crop marks: two ticks per corner, outside the artwork', () => {
    const marks = cropMarks([{ index: 0, xMm: 20, yMm: 30 }], 25, 25);
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
    expect(r.filename).toBe('ORBES-sheet-2026-02-01-31-black-25mm.pdf');
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
