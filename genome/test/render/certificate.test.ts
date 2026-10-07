/**
 * Certificate card (render/certificate.ts): the 85 × 55 mm card that carries
 * a claim code under a scratch-off panel, the A4 sheet of ten, the CSV for
 * print shops, and the BRAND §7 specimen.
 *
 * What a print shop and a buyer rely on is checked: a valid, deterministic,
 * pure-vector PDF without any font; K-only black; the scratch-off panel as a
 * Separation plate set to overprint and covering the code; every mark inside
 * the card's safe area; the brand's monogram as a flat ink fill of its
 * master outlines, clear of the lettering; the sheet's geometry and cut
 * marks; never the ORBES
 * CODE on the card; the claim code never present as text; PROOF until the
 * brand validates the layout; CSV quoting and formula guards. And the
 * ownership certificate (F-06): one A4 page of a piece's record, its GENOME on
 * an ivory plate, its live link lettered and as an annotation, never a font,
 * a name or the word AUTHENTIC, deterministic.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CERTIFICATE_SPECIMEN_ITEM, renderCertificateSpecimenFiles } from '../../scripts/certificate-specimen.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { genomeLayout } from '../../src/core/genome/render.js';
import { packIdentity } from '../../src/core/identity.js';
import { MONOGRAM_BOUNDS, MONOGRAM_PATHS, monogramPathData, pathBounds } from '../../src/core/render/monogram.js';
import {
  CARD_LAYOUT,
  CERTIFICATE_CARD,
  CERTIFICATE_COPY,
  CERTIFICATE_LAYOUT_STATUS,
  CERTIFICATE_SHEET,
  CertificateInputError,
  MAX_CERTIFICATE_ITEMS,
  OWNERSHIP_CERTIFICATE_COPY,
  OWNERSHIP_CERTIFICATE_LAYOUT,
  SCRATCH_OFF_SPOT,
  certificateCardSvg,
  certificateLinkLettering,
  certificatesCsv,
  csvField,
  gridCutMarks,
  layoutCertificateCard,
  layoutCertificateSheet,
  layoutOwnershipCertificate,
  measureText,
  mmToPt,
  renderCertificateCsv,
  renderCertificatePdf,
  renderOwnershipCertificatePdf,
  renderPdf,
  sheetFooter,
  textRun,
  toLabelText,
  type CertificateItem,
  type OwnershipCertificateDocument,
} from '../../src/server/render/index.js';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import { STROKE_RATIO } from '../../src/server/render/label-font.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'docs', 'assets');
const DATE = new Date('2026-10-02T09:30:00.000Z');

function item(serial: number, extra: Partial<CertificateItem> = {}): CertificateItem {
  return {
    productId: `O26-J-${String(serial).padStart(5, '0')}`,
    model: 'MONOLITHE · RING',
    material: '925 STERLING SILVER',
    genome: computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial })),
    claimCode: '7KQ2-M4TD-9XWH',
    ...extra,
  };
}

const latin1 = (b: Uint8Array | string) => (typeof b === 'string' ? b : Buffer.from(b).toString('latin1'));

/** Concatenated, inflated content of every FlateDecode stream in a PDF. */
function pdfStreams(pdf: Uint8Array): string {
  const text = latin1(pdf);
  let out = '';
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(pdf.subarray(start, end));
    try {
      out += inflateSync(raw).toString('latin1') + '\n';
    } catch {
      out += raw.toString('latin1') + '\n';
    }
    re.lastIndex = end;
  }
  return out;
}

/** The PDF without its (binary) stream bodies: dictionaries and objects only. */
function pdfObjects(pdf: Uint8Array): string {
  return latin1(pdf).replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, 'stream endstream');
}

/** Endpoints of every M/L/A command of absolute path data. */
function points(d: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const n = m[2].trim().split(/[ ,]+/).map(Number);
    out.push([n[n.length - 2], n[n.length - 1]]);
  }
  return out;
}

function bounds(d: string, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  const p = points(d);
  return {
    x0: Math.min(...p.map(([x]) => x)) - pad,
    y0: Math.min(...p.map(([, y]) => y)) - pad,
    x1: Math.max(...p.map(([x]) => x)) + pad,
    y1: Math.max(...p.map(([, y]) => y)) + pad,
  };
}

/** Every claim-code spelling a reader could search for. */
const spellings = (code: string) => [code, code.replace(/-/g, ''), code.replace(/-/g, ' ')];

describe('certificate card layout', () => {
  it('keeps every mark inside the safe area of the 85 × 55 mm card', () => {
    const { widthMm: w, heightMm: h, safeMm: s } = CERTIFICATE_CARD;
    for (const status of ['PROOF', 'VALIDATED'] as const) {
      const card = layoutCertificateCard(item(184), status);
      for (const st of card.strokes) {
        const b = bounds(st.d, st.width / 2);
        expect(b.x0).toBeGreaterThanOrEqual(s);
        expect(b.y0).toBeGreaterThanOrEqual(s);
        expect(b.x1).toBeLessThanOrEqual(w - s);
        expect(b.y1).toBeLessThanOrEqual(h - s);
      }
      const g = card.genome;
      expect(g.xMm).toBeGreaterThanOrEqual(s - 1); // the row layout's own margin may reach past the ink
      expect(g.yMm + g.scene.heightMm).toBeLessThanOrEqual(CARD_LAYOUT.rows.baselines[0] - CARD_LAYOUT.rows.valueCap);
      const p = card.panelBox;
      expect(p.x).toBeGreaterThanOrEqual(s);
      expect(p.x + p.w).toBeLessThanOrEqual(w - s);
      expect(p.y + p.h).toBeLessThanOrEqual(h - s);
      const m = pathBounds(card.monogram);
      expect(m.x).toBeGreaterThanOrEqual(s);
      expect(m.y).toBeGreaterThanOrEqual(s);
      expect(m.x + m.w).toBeLessThanOrEqual(w - s + 1e-3);
      expect(m.y + m.h).toBeLessThanOrEqual(h - s);
    }
  });

  it('carries the monogram: the master outlines as a flat fill against the right margin, from the cap line of ORBES to the identity baseline', () => {
    const L = CARD_LAYOUT;
    for (const status of ['PROOF', 'VALIDATED'] as const) {
      const card = layoutCertificateCard(item(184), status);
      const box = card.monogramBox;
      expect(box.y).toBeCloseTo(L.brand.baseline - L.brand.cap, 9);
      expect(box.y + box.h).toBeCloseTo(L.id.baseline, 9);
      expect(box.x + box.w).toBeCloseTo(L.right, 9);
      expect(box.w / box.h).toBeCloseTo(MONOGRAM_BOUNDS.w / MONOGRAM_BOUNDS.h, 9);
      // 11 mm high, 14.4 mm wide; the outlines are the master's, placed on that box (three decimals).
      expect(box.h).toBeCloseTo(11, 9);
      expect(box.w).toBeCloseTo(14.4, 2);
      expect(card.monogram).toEqual(monogramPathData({ x: box.x, y: box.y, width: box.w }));
      expect(card.monogram).toHaveLength(MONOGRAM_PATHS.length);
      const ink = pathBounds(card.monogram);
      expect(ink.x).toBeCloseTo(box.x, 2);
      expect(ink.y).toBeCloseTo(box.y, 2);
      expect(ink.w).toBeCloseTo(box.w, 2);
      expect(ink.h).toBeCloseTo(box.h, 2);
      // Clear of every other mark by at least 3 mm across and 3 mm down: the CERTIFICATE line and its
      // PROOF mention end to its left, the GENOME row and its fingerprint start below it.
      for (const st of card.strokes) {
        const b = bounds(st.d, st.width / 2);
        const apart = b.x1 <= box.x - 3 || b.y0 >= box.y + box.h + 3;
        expect(apart, st.d.slice(0, 40)).toBe(true);
      }
      expect(card.genome.yMm).toBeGreaterThanOrEqual(box.y + box.h);
    }
  });

  it('sets CERTIFICATE under the word, and PROOF after it on the same line', () => {
    const L = CARD_LAYOUT;
    const proof = layoutCertificateCard(item(184), 'PROOF');
    const [brand, title, mention] = proof.strokes.map((st) => bounds(st.d));
    expect(Math.abs(brand.x0 - title.x0)).toBeLessThan(0.3); // both start at the left margin (O and C bear differently)
    expect(title.y1).toBeCloseTo(L.title.baseline, 1);
    expect(mention.y1).toBeCloseTo(L.proof.baseline, 1);
    expect(mention.x0 - title.x1).toBeGreaterThan(L.proof.gapMm - 1);
    expect(title.y0 - brand.y1).toBeGreaterThan(1);
  });

  it('centres the claim code inside the panel that covers it, whatever its characters', () => {
    for (const code of ['7KQ2-M4TD-9XWH', 'WWWW-MMMM-QQQQ', '1111-1111-1111', '0000-GGGG-DDDD']) {
      const card = layoutCertificateCard(item(184, { claimCode: code }), 'PROOF');
      const b = bounds(card.code.d, card.code.width / 2);
      const p = card.panelBox;
      expect(b.x0, code).toBeGreaterThanOrEqual(p.x + 0.5);
      expect(b.x1, code).toBeLessThanOrEqual(p.x + p.w - 0.5);
      expect(b.y0, code).toBeGreaterThanOrEqual(p.y + 0.5);
      expect(b.y1, code).toBeLessThanOrEqual(p.y + p.h - 0.5);
      expect(Math.abs((b.x0 + b.x1) / 2 - (p.x + p.w / 2))).toBeLessThan(0.05);
      // The panel's path is the rounded rectangle of panelBox.
      const pb = bounds(card.panel);
      expect([pb.x0, pb.y0, pb.x1, pb.y1]).toEqual([p.x, p.y, p.x + p.w, p.y + p.h]);
    }
  });

  it('keeps the steps out of the claim-code column', () => {
    const card = layoutCertificateCard(item(184), 'PROOF');
    const left = card.strokes.filter((st) => {
      const b = bounds(st.d);
      return b.y0 > CARD_LAYOUT.rule.y && b.y1 < CARD_LAYOUT.panel.y + CARD_LAYOUT.panel.h && b.x0 < CARD_LAYOUT.claim.x;
    });
    expect(left.length).toBe(6); // three numbers, three steps
    for (const st of left) expect(bounds(st.d, st.width / 2).x1).toBeLessThan(CARD_LAYOUT.claim.x - 1);
  });

  it('fits long free text: shrinks it, then cuts it with "...", never past the right edge', () => {
    const long = 'Sterling silver 925, hand-polished, with a brushed inner band and an engraved serial number';
    const short = layoutCertificateCard(item(184), 'VALIDATED');
    const card = layoutCertificateCard(item(184, { material: long, model: 'Monolithe Œuvre · Bague très longue à motif gravé' }), 'VALIDATED');
    expect(card.strokes).toHaveLength(short.strokes.length);
    for (const st of card.strokes) expect(bounds(st.d, st.width / 2).x1).toBeLessThanOrEqual(CARD_LAYOUT.right + 0.2);
    // Strokes 5 and 7 are the model and material values (VALIDATED: no PROOF line): shrunk to the 1.0 mm floor,
    // whose stroke is the 0.1 mm hairline floor, against 1.3 × 0.085 mm at full size. At 1.0 mm the material is
    // still wider than the column, so the bound above also proves it was cut short.
    expect(short.strokes[7].width).toBeCloseTo(CARD_LAYOUT.rows.valueCap * STROKE_RATIO, 9);
    expect(card.strokes[5].width).toBeCloseTo(0.1, 9);
    expect(card.strokes[7].width).toBeCloseTo(0.1, 9);
    expect(measureText(toLabelText(long), CARD_LAYOUT.rows.valueTracking) * CARD_LAYOUT.rows.minValueCap).toBeGreaterThan(CARD_LAYOUT.right - CARD_LAYOUT.rows.valueX);
    // Accents and punctuation outside the lettering never throw; empty text leaves the row blank.
    expect(() => layoutCertificateCard(item(184, { material: '¿¡ ✓ —' }), 'PROOF')).not.toThrow();
    expect(layoutCertificateCard(item(184, { material: '✓' }), 'PROOF').strokes).toHaveLength(layoutCertificateCard(item(184), 'PROOF').strokes.length - 1);
  });

  it('draws free text that fits once shrunk whole, at the size that fills the column', () => {
    const { right, rows } = CARD_LAYOUT;
    const whole = (text: string, cap: number) =>
      textRun(text, { capHeight: cap, tracking: rows.valueTracking, x: rows.valueX, baseline: rows.baselines[1], align: 'start' }).d;
    const fit = (text: string) => (right - rows.valueX) / measureText(text, rows.valueTracking);
    // Fits at 1.22 mm, where width × cap rounds to one ulp above the column: drawn whole, not cut with '...'.
    const material = toLabelText('Oxidised sterling silver 925 with gold vermeil');
    expect(fit(material)).toBeGreaterThan(rows.minValueCap);
    expect(fit(material)).toBeLessThan(rows.valueCap);
    expect(layoutCertificateCard(item(184, { material }), 'VALIDATED').strokes[7].d).toBe(whole(material, fit(material)));
    // Every length down to the 1.0 mm floor: never cut, whatever the rounding.
    const long = 'Oxidised sterling silver 925 with gold vermeil, hand-polished, brushed inner band';
    let shrunk = 0;
    for (let n = 1; n <= long.length; n++) {
      const text = toLabelText(long.slice(0, n));
      if (fit(text) < rows.minValueCap) break;
      if (fit(text) < rows.valueCap) shrunk++;
      const card = layoutCertificateCard(item(184, { material: text }), 'VALIDATED');
      expect(card.strokes[7].d, text).toBe(whole(text, Math.min(rows.valueCap, fit(text))));
    }
    expect(shrunk).toBeGreaterThan(10);
  });

  it('says PROOF until the brand validates the layout', () => {
    expect(CERTIFICATE_LAYOUT_STATUS).toBe('PROOF');
    const proof = layoutCertificateCard(item(184), 'PROOF');
    const validated = layoutCertificateCard(item(184), 'VALIDATED');
    expect(proof.strokes.length).toBe(validated.strokes.length + 1);
    expect(CERTIFICATE_COPY.proof).toMatch(/^PROOF/);
  });

  it('never draws the ORBES CODE: only the GENOME row of the identity', () => {
    const it0 = item(184);
    const card = layoutCertificateCard(it0, 'PROOF');
    expect(card.genome.scene.primitives).toEqual(genomeLayout(it0.genome, 'row').primitives);
    for (const p of card.genome.scene.primitives) expect(['genome', 'decor']).toContain(p.layer);
    // The glyphs are drawn at 2.6 mm: above the 2.1 mm floor of a printed glyph (BRAND §2.6).
    expect(card.genome.scene.widthMm / card.genome.scene.viewBox.w * 2).toBeCloseTo(CARD_LAYOUT.genome.glyphMm, 9);
  });

  it('refuses what it cannot draw', () => {
    expect(() => layoutCertificateCard(item(184, { claimCode: '7kq2-m4td-9xwh' }), 'PROOF')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(184, { claimCode: '7KQ2M4TD9XWH' }), 'PROOF')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(184, { claimCode: 'UUUU-UUUU-UUUU' }), 'PROOF')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(184, { productId: 'x' }), 'PROOF')).toThrow(CertificateInputError);
  });
});

describe('certificate sheet', () => {
  it('lays ten abutting cards on A4: 2 × 5, 11 mm top and bottom, centred', () => {
    const l = layoutCertificateSheet(23);
    expect([l.pageWidthMm, l.pageHeightMm]).toEqual([210, 297]);
    expect(l.pages.map((p) => p.length)).toEqual([10, 10, 3]);
    const first = l.pages[0];
    expect(first[0]).toEqual({ index: 0, xMm: 20, yMm: 11, row: 0, column: 0 });
    expect(first[1]).toEqual({ index: 1, xMm: 105, yMm: 11, row: 0, column: 1 });
    expect(first[9]).toEqual({ index: 9, xMm: 105, yMm: 231, row: 4, column: 1 });
    expect(first[9].yMm + CERTIFICATE_CARD.heightMm).toBe(297 - CERTIFICATE_SHEET.marginYmm);
    expect(l.pages[2][0]).toEqual({ index: 20, xMm: 20, yMm: 11, row: 0, column: 0 });
    expect(() => layoutCertificateSheet(0)).toThrow(CertificateInputError);
  });

  it('puts cut marks only outside the grid, on every cut line', () => {
    const marks = gridCutMarks(20, 11, 2, 5, 85, 55);
    const segments = [...marks.d.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map((m) => m.slice(1).map(Number));
    expect(segments).toHaveLength(2 * 3 + 2 * 6);
    for (const [x0, y0, x1, y1] of segments) {
      const outside = (x: number, y: number) => x < 20 || x > 190 || y < 11 || y > 286;
      expect(outside(x0, y0) && outside(x1, y1)).toBe(true);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(3, 9);
    }
    expect(() => gridCutMarks(0, 0, 0, 1, 1, 1)).toThrow(RangeError);
  });

  it('keeps the footer clear of the cut marks, of the x = 190 mm cut line and of the unprintable bottom edge', () => {
    const sheet = layoutCertificateSheet(MAX_CERTIFICATE_ITEMS);
    // The longest caption the renderer writes: PROOF, a two-digit count, the last page.
    const footer = sheetFooter(sheet, sheet.pages.length - 1, 'ORBES CERTIFICATE CARDS · PROOF · 2026-10-02 · 50 CARDS', CERTIFICATE_SHEET.footer);
    expect(footer).toHaveLength(3);
    const [caption, bar, label] = footer.map((st) => bounds(st.d, st.width / 2));
    const cutMarksEnd = CERTIFICATE_SHEET.marginYmm + CERTIFICATE_SHEET.rows * CERTIFICATE_CARD.heightMm + 1 + 3;
    for (const b of [caption, bar, label]) {
      expect(b.y0).toBeGreaterThanOrEqual(cutMarksEnd + 0.8);
      expect(b.y1).toBeLessThanOrEqual(297 - 3.5);
    }
    // One line: the caption, then '10 MM', then the bar, ending short of the right cut line.
    expect(caption.x1).toBeLessThan(label.x0 - 1);
    expect(label.x1).toBeLessThan(bar.x0);
    expect(bar.x1).toBeLessThan(20 + 2 * CERTIFICATE_CARD.widthMm - 1);
    const unpadded = bounds(footer[1].d);
    expect(unpadded.x1 - unpadded.x0).toBeCloseTo(10, 9);
  });
});

describe('certificate PDF', () => {
  it('one card per page at 85 × 55 mm: valid, vector, no font, no image, no text', async () => {
    const r = await renderCertificatePdf([item(184)], { createdAt: DATE });
    expect(r.contentType).toBe('application/pdf');
    expect(r.filename).toBe('ORBES-certificate-O26-J-00184-PROOF.pdf');
    const pdf = r.body as Uint8Array;
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 240\.944882 155\.905512\]/);
    expect(text).toMatch(/\/Count 1\b/);
    expect(pdfObjects(pdf)).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject|\/DCTDecode|\/JPXDecode/);
    const content = pdfStreams(pdf);
    expect(content).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bBI\b|\bDo\b/);
    expect(content).toMatch(/\bS\n/); // stroked lettering
    expect(content).toMatch(/\bf\n/); // filled glyphs, monogram and panel

    const three = await renderCertificatePdf([item(1), item(2), item(3)], { createdAt: DATE });
    expect(latin1(three.body)).toMatch(/\/Count 3\b/);
    expect(three.filename).toBe('ORBES-certificates-2026-10-02-3-card-PROOF.pdf');
  });

  it('the scratch-off panel is a Separation plate, overprinting, drawn last over the code', async () => {
    const pdf = (await renderCertificatePdf([item(184)], { createdAt: DATE })).body as Uint8Array;
    const objects = pdfObjects(pdf);
    expect(objects).toContain('[/Separation /ORBES#20SCRATCH-OFF /DeviceCMYK');
    expect(objects).toContain(`/C1 [${SCRATCH_OFF_SPOT.cmyk.map((v) => v / 100).join(' ')}]`);
    expect(objects).toMatch(/\/Type \/ExtGState\n\/OP true\n\/op true\n\/OPM 1/);
    const content = pdfStreams(pdf);
    const panelAt = content.indexOf('/GsOP gs');
    expect(panelAt).toBeGreaterThan(0);
    expect(content.slice(panelAt)).toMatch(/^\/GsOP gs\n[\s\S]*?\/CS0 cs\n1 scn\nf\n/);
    // Nothing is painted after the panel: it covers the code.
    expect(content.slice(panelAt)).not.toMatch(/\bS\n/);
    expect((content.match(/\/GsOP gs/g) ?? []).length).toBe(1);
  });

  it('fills the monogram in K, before the panel: five flat outlines beside the GENOME glyphs', async () => {
    const card = layoutCertificateCard(item(184), 'PROOF');
    const content = pdfStreams((await renderCertificatePdf([item(184)], { createdAt: DATE })).body as Uint8Array);
    const beforePanel = content.slice(0, content.indexOf('/GsOP gs'));
    // Every fill before the panel: one per GENOME primitive, then one per monogram outline.
    expect((beforePanel.match(/\bf\*?\n/g) ?? []).length).toBe(card.genome.scene.primitives.length + MONOGRAM_PATHS.length);
    // The first outline starts where the card's path data says (pdfkit writes its M as an m).
    const [, x, y] = /^M([\d.]+) ([\d.]+)/.exec(card.monogram[0])!;
    expect(beforePanel).toContain(`${x} ${y} m`);
    expect(content.slice(content.indexOf('/GsOP gs'))).not.toContain(`${x} ${y} m`);
  });

  it('black is K only: no RGB anywhere, every process colour C = M = Y = 0', async () => {
    const content = pdfStreams((await renderCertificatePdf([item(184), item(185)], { layout: 'sheet', createdAt: DATE })).body as Uint8Array);
    expect(content).not.toMatch(/DeviceRGB/);
    expect(content).toContain('0 0 0 1 scn');
    expect(content).toContain('0 0 0 1 SCN');
    for (const m of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) (scn|SCN)/g)) expect([m[1], m[2], m[3]]).toEqual(['0', '0', '0']);
  });

  it('A4 sheets of ten with cut marks and a footer saying PROOF', async () => {
    const r = await renderCertificatePdf(Array.from({ length: 12 }, (_, i) => item(i + 1)), { layout: 'sheet', createdAt: DATE });
    expect(r.filename).toBe('ORBES-certificates-2026-10-02-12-sheet-PROOF.pdf');
    const text = latin1(r.body);
    expect(text).toMatch(new RegExp(`/MediaBox \\[0 0 ${mmToPt(210).toFixed(6).replace(/0+$/, '')} ${mmToPt(297).toFixed(6).replace(/0+$/, '')}\\]`));
    expect(text).toMatch(/\/Count 2\b/);
    // The title is UTF-16 (it holds '·'): read it without its zero bytes.
    expect(text.replace(/\0/g, '')).toContain('ORBES CERTIFICATE CARDS · PROOF · 2026-10-02 · 12 CARDS');
  });

  it('VALIDATED drops every PROOF mention', async () => {
    const r = await renderCertificatePdf([item(184)], { createdAt: DATE, status: 'VALIDATED' });
    expect(r.filename).toBe('ORBES-certificate-O26-J-00184.pdf');
    expect(latin1(r.body)).not.toMatch(/PROOF/);
    const sheet = await renderCertificatePdf([item(184)], { createdAt: DATE, status: 'VALIDATED', layout: 'sheet' });
    expect(sheet.filename).toBe('ORBES-certificates-2026-10-02-1-sheet.pdf');
    const proof = await renderCertificatePdf([item(184)], { createdAt: DATE });
    expect(latin1(proof.body)).toMatch(/\(ORBES, certificate, PROOF, O26-J-00184\)/);
  });

  it('is deterministic for the same input and date', async () => {
    const a = (await renderCertificatePdf([item(184), item(185)], { layout: 'sheet', createdAt: DATE })).body as Uint8Array;
    const b = (await renderCertificatePdf([item(184), item(185)], { layout: 'sheet', createdAt: DATE })).body as Uint8Array;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = (await renderCertificatePdf([item(184), item(185)], { layout: 'sheet', createdAt: new Date('2026-10-03T00:00:00Z') })).body as Uint8Array;
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('never carries the claim code as text, in any spelling', async () => {
    const code = 'Z9Y8-X7W6-V5T4';
    for (const layout of ['card', 'sheet'] as const) {
      const pdf = (await renderCertificatePdf([item(184, { claimCode: code })], { layout, createdAt: DATE })).body as Uint8Array;
      const all = latin1(pdf) + pdfStreams(pdf);
      for (const s of spellings(code)) expect(all).not.toContain(s);
    }
  });

  it('bounds a request', async () => {
    await expect(renderCertificatePdf([], { createdAt: DATE })).rejects.toThrow(CertificateInputError);
    const many = Array.from({ length: MAX_CERTIFICATE_ITEMS + 1 }, (_, i) => item(i + 1));
    await expect(renderCertificatePdf(many, { createdAt: DATE })).rejects.toThrow(CertificateInputError);
    await expect(renderCertificatePdf([item(1)], { createdAt: DATE, layout: 'poster' as never })).rejects.toThrow(CertificateInputError);
  });

  it('the PDF engine refuses unknown colours and malformed spot colours', async () => {
    const page = (color: string) => [{ widthMm: 10, heightMm: 10, placements: [], shapes: [{ d: 'M0 0L5 0L5 5Z', color }] }];
    await expect(renderPdf(page('NOT A SPOT'), { title: 't', creationDate: DATE })).rejects.toThrow(/unknown colour/);
    await expect(renderPdf(page('#000000'), { title: 't', creationDate: DATE, spotColors: [{ name: '', cmyk: [0, 0, 0, 1] }] })).rejects.toThrow(/spot colour/);
    await expect(renderPdf(page('#000000'), { title: 't', creationDate: DATE, spotColors: [{ name: 'X', cmyk: [0, 0, 0, 101] }] })).rejects.toThrow(/0\.\.100/);
    // RGB mode keeps a hex shape in RGB; no overprint state unless asked for.
    const rgb = pdfStreams(await renderPdf(page('#FF0000'), { title: 't', creationDate: DATE }));
    expect(rgb).toContain('/DeviceRGB cs\n1 0 0 scn');
    expect(rgb).not.toContain('gs');
  });
});

describe('certificate CSV for variable-data printing', () => {
  it('productId, model, material, code: quoted, CRLF, values as recorded', () => {
    const r = renderCertificateCsv([item(184), item(185, { material: 'Or jaune 18 carats, « Soleil »', claimCode: '0000-1111-2222' })], { createdAt: DATE });
    expect(r.contentType).toBe('text/csv; charset=utf-8; header=present');
    // Until the brand validates the layout, the print shop's file says PROOF in its name, as the PDFs do.
    expect(r.filename).toBe('ORBES-certificates-2026-10-02-2-PROOF.csv');
    expect(r.body).toBe(
      '"productId","model","material","code"\r\n' +
        '"O26-J-00184","MONOLITHE · RING","925 STERLING SILVER","7KQ2-M4TD-9XWH"\r\n' +
        '"O26-J-00185","MONOLITHE · RING","Or jaune 18 carats, « Soleil »","0000-1111-2222"\r\n',
    );
  });

  it('names the file PROOF until the layout is VALIDATED, its columns unchanged either way', () => {
    const proof = renderCertificateCsv([item(184)], { createdAt: DATE, status: 'PROOF' });
    const validated = renderCertificateCsv([item(184)], { createdAt: DATE, status: 'VALIDATED' });
    expect(proof.filename).toBe('ORBES-certificates-2026-10-02-1-PROOF.csv');
    expect(validated.filename).toBe('ORBES-certificates-2026-10-02-1.csv');
    expect(renderCertificateCsv([item(184)], { createdAt: DATE }).filename).toBe(CERTIFICATE_LAYOUT_STATUS === 'PROOF' ? proof.filename : validated.filename);
    expect(proof.body).toBe(validated.body);
  });

  it('defuses spreadsheet formulas and escapes quotes', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    for (const lead of ['+', '-', '@', '\t', '\r']) expect(csvField(`${lead}1`)).toBe(`"'${lead}1"`);
    expect(csvField('a "b", c\nd')).toBe('"a ""b"", c\nd"');
    expect(csvField('925')).toBe('"925"');
    expect(certificatesCsv([item(1, { model: '-cmd|calc' })])).toContain('"\'-cmd|calc"');
  });

  it('bounds and checks its input', () => {
    expect(() => renderCertificateCsv([], { createdAt: DATE })).toThrow(CertificateInputError);
    expect(() => renderCertificateCsv([item(1, { claimCode: 'nope' })], { createdAt: DATE })).toThrow(CertificateInputError);
  });
});

describe('certificate specimen (BRAND §7)', () => {
  it('shows the card with its panel, and the code the panel covers', () => {
    const svg = certificateCardSvg(CERTIFICATE_SPECIMEN_ITEM);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="85mm" height="55mm" viewBox="0 0 85 55">/);
    expect(svg).toContain('data-spot="ORBES SCRATCH-OFF" fill="#A6A6A6"');
    expect(certificateCardSvg(CERTIFICATE_SPECIMEN_ITEM, { panel: false })).not.toContain('data-layer="scratch-off"');
    // The monogram, a flat fill in the card's ink, five outlines.
    const monogram = /<g data-layer="monogram" fill="#0A0A0A">\n((?:<path d="[^"]+"\/>\n)+)<\/g>/.exec(svg);
    expect(monogram).not.toBeNull();
    expect(monogram![1].match(/<path /g)).toHaveLength(5);
    expect(CERTIFICATE_SPECIMEN_ITEM.genome.fingerprint).toBe('G1-E1DC-BE52');
  });

  it('the committed specimen files are byte for byte what scripts/certificate-specimen.ts produces (run it after any change)', async () => {
    for (const f of await renderCertificateSpecimenFiles()) {
      const path = join(ASSETS, f.name);
      expect(existsSync(path), `${path} missing: run npx tsx scripts/certificate-specimen.ts`).toBe(true);
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(f.bytes)), `${f.name} is stale: run npx tsx scripts/certificate-specimen.ts`).toBe(true);
    }
  });
});

// ── Ownership certificate (F-06) ───────────────────────────────────────────

const TOKEN = '7Q2MZXKW4R8T1V0G3H5J6K9N2P4S6T8V0W2X4Y6Z8A1B3C5D7E9G';

function ownershipDoc(extra: Partial<OwnershipCertificateDocument> = {}): OwnershipCertificateDocument {
  return {
    productId: 'O26-J-00184',
    category: 'Jewelry',
    collection: 'ORBIT',
    model: 'Monolithe',
    modelVariant: null,
    type: 'Ring',
    variant: 'Size 54',
    material: '925 Sterling Silver',
    createdYear: 2026,
    genome: computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 })),
    verified: true,
    since: '2026-10-01',
    warranty: { status: 'ACTIVE', startDate: '2026-09-20', endDate: '2028-09-20' },
    issuedAt: new Date('2026-10-03T09:00:00.000Z'),
    expiresAt: new Date('2027-01-01T09:00:00.000Z'),
    checkedAt: new Date('2026-10-03T12:34:56.000Z'),
    link: `https://verify.theorbes.com/verify/c#${TOKEN}`,
    ...extra,
  };
}

describe('ownership certificate (F-06)', () => {
  it('letters the live link: the address up to its #, then the code in groups of four', () => {
    expect(certificateLinkLettering(`https://verify.theorbes.com/verify/c#${TOKEN}`)).toEqual({
      address: 'VERIFY.THEORBES.COM/VERIFY/C#',
      code: TOKEN.match(/.{4}/g)!.join('-'),
    });
    expect(certificateLinkLettering(`http://127.0.0.1:8080/verify/c#${TOKEN}`).address).toBe('127.0.0.1:8080/VERIFY/C#');
    for (const bad of [`https://x.test/verify/c/${TOKEN}`, `https://x.test/verify/c#${TOKEN.slice(1)}`, `javascript:alert(1)#${TOKEN}`, `https://x.test/verify/c#${TOKEN.toLowerCase()}`]) {
      expect(() => certificateLinkLettering(bad), bad).toThrow(CertificateInputError);
    }
  });

  it('lays out one A4 page: the plate first, the GENOME in its orbit on it, the monogram, the link as an annotation', () => {
    const L = OWNERSHIP_CERTIFICATE_LAYOUT;
    const page = layoutOwnershipCertificate(ownershipDoc());
    expect([page.widthMm, page.heightMm]).toEqual([210, 297]);
    // The ivory plate under everything, the GENOME orbit centred on it in the ivory colourway's ink.
    expect(page.fills).toEqual([{ d: 'M22 54L188 54L188 136L22 136Z', color: ORBES_CODE_STYLES.ivory.paper }]);
    expect(page.placements).toHaveLength(1);
    const orbit = page.placements[0];
    expect(orbit.scene.ink).toBe(ORBES_CODE_STYLES.ivory.ink);
    expect(orbit.scene.paper).toBeNull();
    expect(orbit.scene.primitives).toEqual(genomeLayout(ownershipDoc().genome!, 'orbit').primitives);
    expect(orbit.xMm + orbit.scene.widthMm / 2).toBeCloseTo(105, 6);
    expect(orbit.yMm).toBeGreaterThan(L.id.baseline);
    expect(orbit.yMm + orbit.scene.heightMm).toBeLessThan(L.fingerprint.baseline - L.fingerprint.cap);
    // The monogram against the right margin, in ink.
    expect(page.shapes?.map((x) => x.color)).toEqual(MONOGRAM_PATHS.map(() => '#0A0A0A'));
    const mono = pathBounds(page.shapes!.map((x) => x.d));
    expect(mono.x + mono.w).toBeCloseTo(L.right, 3);
    expect(mono.y).toBeCloseTo(L.monogram.top, 3);
    expect(mono.y + mono.h).toBeCloseTo(L.monogram.bottom, 3);
    // Every stroke inside the page's margins.
    for (const st of page.marks!) {
      const b = bounds(st.d);
      expect(b.x0).toBeGreaterThanOrEqual(L.left - 0.5);
      expect(b.x1).toBeLessThanOrEqual(L.right + 0.5);
      expect(b.y0).toBeGreaterThan(20);
      expect(b.y1).toBeLessThan(292);
    }
    // The link covers its two lettered lines.
    expect(page.links).toEqual([{ xMm: L.left, yMm: L.live.addressBaseline - L.live.cap - 1, wMm: L.right - L.left, hMm: L.live.codeBaseline + 1 - (L.live.addressBaseline - L.live.cap - 1), url: ownershipDoc().link }]);
  });

  it('draws the rows a piece has: no collection or variant row when there is none, no GENOME without one', () => {
    const full = layoutOwnershipCertificate(ownershipDoc());
    const bare = layoutOwnershipCertificate(ownershipDoc({ collection: null, variant: null, genome: null, warranty: { status: 'NOT_STARTED' } }));
    // Two piece rows, the GENOME (and its fingerprint line), and FROM and UNTIL with their values fewer.
    expect(full.marks!.length - bare.marks!.length).toBe(2 * 2 + 1 + 2 * 2);
    expect(bare.placements).toEqual([]);
  });

  it('draws the model variant on an unlabelled line right under MODEL\'s value (plan NEXT LOT §3.1); the Size field\'s row keeps its label VARIANT', () => {
    const L = OWNERSHIP_CERTIFICATE_LAYOUT;
    const R = L.rows;
    const full = layoutOwnershipCertificate(ownershipDoc());
    const steel = layoutOwnershipCertificate(ownershipDoc({ modelVariant: 'Steel' }));
    // One run more (the value alone, no label); nothing for a blank label.
    expect(steel.marks!.length - full.marks!.length).toBe(1);
    expect(layoutOwnershipCertificate(ownershipDoc({ modelVariant: '   ' })).marks).toEqual(full.marks);
    // Under MODEL's value: the second row's baseline, at the values' x; nothing at the labels' x on that row.
    const second = R.first + R.pitch;
    const onRow = (page: typeof full) =>
      page.marks!.map((m) => bounds(m.d)).filter((b) => b.y1 <= second + 0.01 && b.y1 > second - R.valueCap - 0.01 && b.x0 < L.columns[1]);
    const row = onRow(steel);
    expect(row).toHaveLength(1);
    expect(row[0]!.x0).toBeGreaterThanOrEqual(L.columns[0] + L.valueOffset - 0.01);
    // The labels under it move down one pitch (8 rows here: the 6 mm pitch kept); MODEL's stays.
    const labels = (page: typeof full) =>
      page.marks!.map((m) => bounds(m.d)).filter((b) => b.y1 - b.y0 > 0.1 && Math.abs(b.x0 - L.columns[0]) < 0.5 && b.y0 > L.section.baseline + 0.5 && b.y1 < L.ruleMiddle).map((b) => b.y1).sort((a, b) => a - b);
    const before = labels(full);
    expect(labels(steel)).toHaveLength(before.length);
    labels(steel).forEach((y, i) => expect(y, `label ${i}`).toBeCloseTo(i === 0 ? before[0]! : before[i]! + R.pitch, 3));
    // The Size field's row is still labelled VARIANT (question 1 of the plan, unanswered).
    expect(OWNERSHIP_CERTIFICATE_COPY.rows.variant).toBe('VARIANT');
  });

  it('fits a piece of 9 rows above the middle rule (pitch 5.125 mm, the last baseline at 199), and keeps the 6 mm pitch for 8', () => {
    const L = OWNERSHIP_CERTIFICATE_LAYOUT;
    const R = L.rows;
    // MODEL, the variant line, TYPE, CATEGORY, COLLECTION, VARIANT (the size), MATERIAL, CREATED, DISCONTINUED.
    const nine = layoutOwnershipCertificate(ownershipDoc({ modelVariant: 'Brushed cobalt with a polished inner rim', discontinuedYear: 2027 }));
    const pieceMarks = (page: ReturnType<typeof layoutOwnershipCertificate>) =>
      // The lettered runs of THE PIECE's column, between its heading and THIS CERTIFICATE (the middle rule, a flat line, aside).
      page.marks!.map((m) => bounds(m.d)).filter((b) => b.y1 - b.y0 > 0.1 && b.x0 < L.columns[1] - 0.5 && b.y0 > L.section.baseline + 0.5 && b.y1 < L.certificate.baseline - 2);
    const marks = pieceMarks(nine);
    for (const b of marks) expect(b.y1).toBeLessThan(L.ruleMiddle - 1.6);
    const last = Math.max(...marks.map((b) => b.y1));
    expect(last).toBeCloseTo(199, 1);
    expect((L.ruleMiddle - 3 - R.first) / 8).toBe(5.125);
    // Eight rows (no variant line): the last baseline at 158 + 7 × 6 = 200, as before.
    const eight = pieceMarks(layoutOwnershipCertificate(ownershipDoc({ discontinuedYear: 2027 })));
    expect(Math.max(...eight.map((b) => b.y1))).toBeCloseTo(R.first + 7 * R.pitch, 1);
    // THE RECORD's column keeps its 6 mm pitch.
    const record = (page: ReturnType<typeof layoutOwnershipCertificate>) =>
      page.marks!.map((m) => bounds(m.d)).filter((b) => b.x0 >= L.columns[1] - 0.5 && b.y0 > L.section.baseline + 0.5 && b.y1 < L.ruleMiddle);
    expect(record(nine)).toEqual(record(layoutOwnershipCertificate(ownershipDoc({ discontinuedYear: 2027 }))));
  });

  it('draws DISCONTINUED and its year under CREATED once the model was (P-R06): one row more, its label clear of its value, above the middle rule', () => {
    const L = OWNERSHIP_CERTIFICATE_LAYOUT;
    const R = L.rows;
    const full = layoutOwnershipCertificate(ownershipDoc());
    const discontinued = layoutOwnershipCertificate(ownershipDoc({ discontinuedYear: 2027 }));
    // The label, then the value: two runs of strokes more; nothing without a year (null or absent).
    expect(discontinued.marks!.length - full.marks!.length).toBe(2);
    expect(layoutOwnershipCertificate(ownershipDoc({ discontinuedYear: null })).marks).toEqual(full.marks);
    const added = discontinued.marks!.filter((m) => !full.marks!.some((f) => f.d === m.d)).map((m) => bounds(m.d));
    expect(added).toHaveLength(2);
    // The eighth row of THE PIECE (model, type, category, collection, variant, material, created, discontinued).
    const baseline = R.first + 7 * R.pitch;
    for (const b of added) {
      expect(b.y1).toBeLessThanOrEqual(baseline + 0.01);
      expect(b.y1).toBeLessThan(L.ruleMiddle);
    }
    const [label, value] = [...added].sort((a, b) => a.x0 - b.x0);
    expect(label.x0).toBeCloseTo(L.columns[0], 0);
    expect(label.x1).toBeLessThan(L.columns[0] + L.valueOffset);
    expect(value.x0).toBeGreaterThanOrEqual(L.columns[0] + L.valueOffset - 0.01);
    expect(OWNERSHIP_CERTIFICATE_COPY.rows.discontinued).toBe('DISCONTINUED');
  });

  it('writes its copy in the lettering\'s capitals, names no owner and never says AUTHENTIC', () => {
    const all = JSON.stringify(OWNERSHIP_CERTIFICATE_COPY) + OWNERSHIP_CERTIFICATE_COPY.valid('3 OCTOBER 2026 · 12:34 UTC');
    expect(all).not.toMatch(/AUTHENTIC|GENUINE|REAL\b|STOLEN|COUNTERFEIT|OWNER'S|NAME:/);
    for (const line of [...OWNERSHIP_CERTIFICATE_COPY.statement, OWNERSHIP_CERTIFICATE_COPY.title, OWNERSHIP_CERTIFICATE_COPY.verifyOnly, OWNERSHIP_CERTIFICATE_COPY.unverified]) {
      expect(toLabelText(line), line).toBe(line);
    }
    expect(OWNERSHIP_CERTIFICATE_COPY.statement[1]).toMatch(/DOES NOT ATTEST THE OBJECT/);
  });

  it('renders a valid, deterministic PDF: no font, no text, RGB, the link as a URI annotation', async () => {
    const a = await renderOwnershipCertificatePdf(ownershipDoc());
    const b = await renderOwnershipCertificatePdf(ownershipDoc());
    expect(a.contentType).toBe('application/pdf');
    expect(a.filename).toBe('ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf');
    const pdf = a.body as Uint8Array;
    expect(Buffer.from(pdf).equals(Buffer.from(b.body as Uint8Array))).toBe(true);
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.275591 841\.889764\]/);
    expect(text).toMatch(/\/Count 1\b/);
    expect(pdfObjects(pdf)).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject/);
    expect(pdfObjects(pdf)).toMatch(/\/Subtype \/Link/);
    expect(text).toContain(`/URI (https://verify.theorbes.com/verify/c#${TOKEN})`);
    const content = pdfStreams(pdf);
    expect(content).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b/);
    // The plate, the first thing painted, in ivory (#F6F2EA): before the GENOME, the lettering and the monogram.
    const plate = /22 54 m\n188 54 l\n188 136 l\n22 136 l\nh\n\/DeviceRGB cs\n0\.9647\d* 0\.9490\d* 0\.9176\d* scn\nf\n/.exec(content);
    expect(plate).not.toBeNull();
    expect(plate!.index).toBeLessThan(content.search(/\bc\n/));
    expect(plate!.index).toBeLessThan(content.search(/\bS\n/));
    // Another moment, another file (its date is the record's).
    const later = await renderOwnershipCertificatePdf(ownershipDoc({ checkedAt: new Date('2026-10-04T08:00:00.000Z') }));
    expect(Buffer.from(later.body as Uint8Array).equals(Buffer.from(pdf))).toBe(false);
    expect(later.filename).toBe('ORBES-ownership-certificate-O26-J-00184-2026-10-04.pdf');
  });

  it('refuses what it cannot draw', async () => {
    await expect(renderOwnershipCertificatePdf(ownershipDoc({ productId: 'nope' }))).rejects.toThrow(CertificateInputError);
    await expect(renderOwnershipCertificatePdf(ownershipDoc({ link: 'https://x.test/verify/c' }))).rejects.toThrow(CertificateInputError);
    await expect(renderOwnershipCertificatePdf(ownershipDoc({ since: 'yesterday' }))).rejects.toThrow(CertificateInputError);
    await expect(renderPdf([{ widthMm: 10, heightMm: 10, placements: [], links: [{ xMm: 0, yMm: 0, wMm: 1, hMm: 1, url: 'javascript:alert(1)' }] }], { title: 't', creationDate: DATE })).rejects.toThrow(RangeError);
  });
});

// ── The ownership certificate among an order's documents (plan LIVE RELEASE+, M6) ─────────────────────────────────

/** The same record, naming the order it was bought with instead of a live link (MY PIECES' documents). */
function orderDoc(extra: Partial<OwnershipCertificateDocument> = {}): OwnershipCertificateDocument {
  const { issuedAt: _i, expiresAt: _e, link: _l, ...record } = ownershipDoc();
  return { ...record, order: 'OR-1A2B3C4D', ...extra };
}

describe('ownership certificate of an order (M6)', () => {
  it('is the same page naming the order: no live address, no link, the record and the statement as a link\'s', () => {
    const L = OWNERSHIP_CERTIFICATE_LAYOUT;
    const linked = layoutOwnershipCertificate(ownershipDoc());
    const page = layoutOwnershipCertificate(orderDoc());
    expect(page.links).toEqual([]);
    expect(page.fills).toEqual(linked.fills);
    expect(page.placements).toEqual(linked.placements);
    expect(page.shapes).toEqual(linked.shapes);
    // Under THIS CERTIFICATE: STATUS and ORDER (two rows) instead of STATUS, ISSUED and VALID UNTIL; no CHECK IT LIVE,
    // its address nor its code.
    const differ = (a: typeof page, b: typeof page) => a.marks!.filter((m) => !b.marks!.some((x) => x.d === m.d)).map((m) => bounds(m.d));
    const gone = differ(linked, page);
    const added = differ(page, linked);
    expect(gone).toHaveLength(2 * 2 + 3);
    expect(added).toHaveLength(2);
    for (const b of gone) expect(b.y0).toBeGreaterThan(L.certificate.baseline);
    for (const b of added) expect(b.y1).toBeCloseTo(L.certificate.first + L.rows.pitch, 0);
    // Nothing between the statement and VERIFY ONLY, where a link's live address goes.
    for (const st of page.marks!) {
      const b = bounds(st.d);
      if (b.y1 > L.statement.baselines[2] + 1) expect(b.y0).toBeGreaterThan(L.verifyOnly.baseline - L.verifyOnly.cap - 1);
    }
    expect(OWNERSHIP_CERTIFICATE_COPY.rows.order).toBe('ORDER');
  });

  it('renders a deterministic PDF with no annotation, its subject naming the order; refuses a link without its dates, or an order with a link', async () => {
    const a = await renderOwnershipCertificatePdf(orderDoc());
    expect(Buffer.from(a.body as Uint8Array).equals(Buffer.from((await renderOwnershipCertificatePdf(orderDoc())).body as Uint8Array))).toBe(true);
    expect(a.filename).toBe('ORBES-ownership-certificate-O26-J-00184-2026-10-03.pdf');
    const pdf = a.body as Uint8Array;
    expect(pdfObjects(pdf)).not.toMatch(/\/Subtype \/Link|\/URI|\/Font/);
    expect(latin1(pdf)).toContain('bought with order OR-1A2B3C4D');
    for (const bad of [orderDoc({ order: 'OR-1' }), orderDoc({ order: undefined }), ownershipDoc({ order: 'OR-1A2B3C4D' }), ownershipDoc({ expiresAt: undefined })]) {
      expect(() => layoutOwnershipCertificate(bad)).toThrow(CertificateInputError);
    }
  });
});
