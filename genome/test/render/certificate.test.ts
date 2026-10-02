/**
 * Certificate card (render/certificate.ts): the 85 × 55 mm card that carries
 * a claim code under a scratch-off panel, the A4 sheet of ten, the CSV for
 * print shops, and the BRAND §7 specimen.
 *
 * What a print shop and a buyer rely on is checked: a valid, deterministic,
 * pure-vector PDF without any font; K-only black; the scratch-off panel as a
 * Separation plate set to overprint and covering the code; every mark inside
 * the card's safe area; the sheet's geometry and cut marks; never the ORBES
 * CODE on the card; the claim code never present as text; PROOF until the
 * brand validates the layout; CSV quoting and formula guards.
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
import {
  CARD_LAYOUT,
  CERTIFICATE_CARD,
  CERTIFICATE_COPY,
  CERTIFICATE_LAYOUT_STATUS,
  CERTIFICATE_SHEET,
  CertificateInputError,
  MAX_CERTIFICATE_ITEMS,
  SCRATCH_OFF_SPOT,
  certificateCardSvg,
  certificatesCsv,
  csvField,
  gridCutMarks,
  layoutCertificateCard,
  layoutCertificateSheet,
  measureText,
  mmToPt,
  renderCertificateCsv,
  renderCertificatePdf,
  renderPdf,
  sheetFooter,
  textRun,
  toLabelText,
  type CertificateItem,
} from '../../src/server/render/index.js';
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
    }
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
    expect(first[0]).toEqual({ index: 0, xMm: 20, yMm: 11 });
    expect(first[1]).toEqual({ index: 1, xMm: 105, yMm: 11 });
    expect(first[9]).toEqual({ index: 9, xMm: 105, yMm: 231 });
    expect(first[9].yMm + CERTIFICATE_CARD.heightMm).toBe(297 - CERTIFICATE_SHEET.marginYmm);
    expect(l.pages[2][0]).toEqual({ index: 20, xMm: 20, yMm: 11 });
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
    expect(content).toMatch(/\bf\n/); // filled glyphs and panel

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
    expect(r.filename).toBe('ORBES-certificates-2026-10-02-2.csv');
    expect(r.body).toBe(
      '"productId","model","material","code"\r\n' +
        '"O26-J-00184","MONOLITHE · RING","925 STERLING SILVER","7KQ2-M4TD-9XWH"\r\n' +
        '"O26-J-00185","MONOLITHE · RING","Or jaune 18 carats, « Soleil »","0000-1111-2222"\r\n',
    );
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
