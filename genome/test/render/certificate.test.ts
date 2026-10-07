/**
 * Certificate card (render/certificate.ts): the card 79t, MINT CERTIFICATE
 * (plan NEXT LOT §3.2, validated by the owner on 2026-10-07), 95 × 62 mm, one
 * side, carrying the ORBES CODE and the claim code in plain sight; the A4
 * sheet of eight; the CSV for print shops; the BRAND §7 specimen.
 *
 * What a print shop and a buyer rely on is checked: the geometry pinned to
 * 79t's build.py (test/fixtures/card-79t/, the design's record), every mark
 * inside the card; the ORBES CODE scanning back to the piece's signed
 * payload; the card against 79t's own front.png, pixel for pixel within the
 * plan's tolerance; a valid, deterministic, pure-vector PDF without any font
 * or text, K only with the greys as K tints and no spot colour; the claim
 * code never present as text; the sheet's geometry and cut marks; PROOF only
 * for a PROOF layout; CSV quoting and formula guards. And the ownership
 * certificate (F-06): one A4 page of a piece's record, its GENOME on an ivory
 * plate, its live link lettered and as an annotation, never a font, a name or
 * the word AUTHENTIC, deterministic.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { CERTIFICATE_SPECIMEN_ITEM, renderCertificateSpecimenFiles } from '../../scripts/certificate-specimen.js';
import { sampleInput } from '../../scripts/render-samples.js';
import { encodeOrbesCode } from '../../src/core/code/encoder.js';
import { CODE01_TOTAL_CELLS, cellCenter } from '../../src/core/code/profile.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { genomeLayout } from '../../src/core/genome/render.js';
import { packIdentity } from '../../src/core/identity.js';
import { MONOGRAM_BOUNDS, MONOGRAM_PATHS, pathBounds } from '../../src/core/render/monogram.js';
import { onGlyphGrid, cardMetrics } from '../../src/server/render/card-text.js';
import {
  CARD_79T,
  CERTIFICATE_CARD,
  CERTIFICATE_COPY,
  CERTIFICATE_LAYOUT_STATUS,
  CERTIFICATE_SHEET,
  CertificateInputError,
  MAX_CERTIFICATE_ITEMS,
  OWNERSHIP_CERTIFICATE_COPY,
  OWNERSHIP_CERTIFICATE_LAYOUT,
  certificateCardSvg,
  certificateLinkLettering,
  certificatesCsv,
  csvField,
  layoutCertificateCard,
  layoutCertificateSheet,
  layoutOwnershipCertificate,
  mmToPt,
  pixelsFor,
  renderCertificateCsv,
  renderCertificatePdf,
  renderOwnershipCertificatePdf,
  renderPdf,
  gridCutMarks,
  sheetFooter,
  sizeLabel,
  svgToPng,
  toLabelText,
  variantLine,
  type CertificateCard,
  type CertificateItem,
  type OwnershipCertificateDocument,
  type PdfLayer,
} from '../../src/server/render/index.js';
import { kTintOf } from '../../src/server/render/certificate.js';
import { ORBES_CODE_STYLES } from '../../src/core/code/styles.js';
import { requireDecoder } from './decoder-support.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', '..', 'docs', 'assets');
const FIXTURE = join(HERE, '..', 'fixtures', 'card-79t');
const OUT = join(HERE, '..', '..', 'out');
const DATE = new Date('2026-10-02T09:30:00.000Z');
/** The claim code build.py draws (79t-mint/build.py :108 and :175); the specimen file keeps its own invented one. */
const CLAIM_79T = '7MSE-SK34-PWMC';

/** A piece of 79t's: MONOLITHE · BRACELET in BLUE, SIZE 17, with the sample ORBES CODE of its serial. */
function item(serial: number, extra: Partial<CertificateItem> = {}): CertificateItem {
  return {
    productId: `O26-J-${String(serial).padStart(5, '0')}`,
    model: 'MONOLITHE · BRACELET',
    modelVariant: 'Blue',
    size: '17',
    material: '925 STERLING SILVER',
    year: 2026,
    genome: computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial })),
    code: { data: sampleInput().data, issue: 1 },
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

/** Every coordinate pair of absolute path data (M L Q C A: the end point of an arc), as [x, y]. */
function coords(d: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of d.matchAll(/([MLQCA])([^MLQCAZ]*)/g)) {
    const n = m[2].trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (m[1] === 'A') out.push([n[5], n[6]]);
    else for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  }
  return out;
}

function bounds(d: string, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  const p = coords(d);
  return {
    x0: Math.min(...p.map(([x]) => x)) - pad,
    y0: Math.min(...p.map(([, y]) => y)) - pad,
    x1: Math.max(...p.map(([x]) => x)) + pad,
    y1: Math.max(...p.map(([, y]) => y)) + pad,
  };
}

/** The layers a page shows, with the clip path standing for a clipped group (its items show only inside it). */
function marks(layers: readonly PdfLayer[]): { d: string; pad: number; layer: PdfLayer }[] {
  return layers.map((l) => (l.kind === 'clip' ? { d: l.clip, pad: 0, layer: l } : { d: l.d, pad: l.kind === 'stroke' ? l.width / 2 : 0, layer: l }));
}

/** Every claim-code spelling a reader could search for. */
const spellings = (code: string) => [code, code.replace(/-/g, ''), code.replace(/-/g, ' ')];

const strokes = (card: CertificateCard) => card.layers.filter((l): l is Extract<PdfLayer, { kind: 'stroke' }> => l.kind === 'stroke');

describe('certificate card 79t: what it is', () => {
  it('is 95 × 62 mm, one side, VALIDATED, its copy word for word as 79t sets it', () => {
    expect(CERTIFICATE_CARD).toEqual({ widthMm: 95, heightMm: 62, safeMm: 5.19 });
    expect(CERTIFICATE_LAYOUT_STATUS).toBe('VALIDATED');
    expect(CERTIFICATE_COPY).toEqual({
      title: 'MINT CERTIFICATE',
      brand: 'ORBES',
      genome: 'GENOME',
      steps: ['SCAN THE ORBES CODE', 'ENTER THE CLAIM CODE', 'THE PIECE IS REGISTERED TO YOU'],
      claimCode: 'CLAIM CODE · KEEP IT PRIVATE',
      verifyOnly: 'VERIFY ONLY AT VERIFY.THEORBES.COM',
      proof: 'PROOF · LAYOUT NOT VALIDATED',
    });
  });

  it('prints its two warm greys as the K tints of their lightness: #F1F1EE K 5.9, #B4B4B1 K 29.8', () => {
    expect(kTintOf('#F1F1EE')).toBe(5.9);
    expect(kTintOf('#B4B4B1')).toBe(29.8);
    expect(CARD_79T.guilloche).toMatchObject({ ground: '#F1F1EE', groundK: 5.9, line: '#B4B4B1', lineK: 29.8, lineWidth: 0.06, pitch: 0.3, amplitude: 0.42, wavelength: 2.2 });
    expect(kTintOf(CARD_79T.guilloche.ground)).toBe(CARD_79T.guilloche.groundK);
    expect(kTintOf(CARD_79T.guilloche.line)).toBe(CARD_79T.guilloche.lineK);
  });
});

describe('certificate card 79t: geometry pinned to build.py', () => {
  const card = layoutCertificateCard(item(184, { claimCode: CLAIM_79T }), 'VALIDATED');

  it('draws one 0.1125 mm rule, butt and mitred, 5.25 mm inside the trim, cut round each legend with 1.4 mm of white each side of its ink', () => {
    const rule = strokes(card).find((l) => l.width === 0.1125)!;
    expect(rule).toMatchObject({ cap: 'butt', join: 'miter', color: '#0A0A0A' });
    const p = coords(rule.d);
    expect(new Set(p.map(([x]) => x).filter((x) => x < 10))).toEqual(new Set([5.25]));
    expect(new Set(p.map(([x]) => x).filter((x) => x > 85))).toEqual(new Set([89.75]));
    expect(new Set(p.map(([, y]) => y))).toEqual(new Set([5.25, 56.75]));
    // The ends at each break: 1.4 mm from the legend's ink, both sides; each legend centred on the card.
    const [top, bottom] = card.boxes.legends;
    expect(top.text).toBe('MINT CERTIFICATE');
    expect(bottom.text).toBe('VERIFY ONLY AT VERIFY.THEORBES.COM');
    for (const [legend, y] of [
      [top, 5.25],
      [bottom, 56.75],
    ] as const) {
      const ends = p.filter(([x, py]) => py === y && x > 10 && x < 85).map(([x]) => x).sort((a, b) => a - b);
      expect(ends).toHaveLength(2);
      expect(legend.left - ends[0]).toBeCloseTo(1.4, 3);
      expect(ends[1] - legend.right).toBeCloseTo(1.4, 3);
      expect((legend.left + legend.right) / 2).toBeCloseTo(47.5, 6);
    }
    // 79t's legend widths (unkerned metrics: MINT CERTIFICATE 12.73, VERIFY ONLY AT … 28.20).
    expect(top.right - top.left).toBeCloseTo(12.725, 2);
    expect(bottom.right - bottom.left).toBeCloseTo(28.195, 2);
  });

  it('places the ORBES CODE in a 32 mm box at (10.138, 10.886), flat on the stock, its decor in its own tints', () => {
    expect(card.boxes.code).toEqual({ x: 10.1376, y: 10.8856, w: 32, h: 32 });
    const [code, genome] = card.placements;
    expect(code).toMatchObject({ xMm: 10.1376, yMm: 10.8856 });
    expect(code.scene).toMatchObject({ widthMm: 32, heightMm: 32, paper: null, ink: '#0A0A0A', viewBox: { x: -25, y: -25, w: 50, h: 50 } });
    // The piece's own code: its framed data and its GENOME glyphs, with the decor.
    const it = item(184);
    expect(code.scene.primitives).toEqual(encodeOrbesCode({ data: it.code.data, genomeGlyphs: it.genome.glyphs }, { decor: true }).primitives);
    expect(code.scene.primitives.filter((p) => p.layer === 'decor').map((p) => p.tone)).toEqual([0.35, 0.25, 0.25]);
    // Its ring 11.5 mm in (the box's edge 0.6144 mm outside the ring), moved 0.748 mm left; the step numbers centred
    // on their measure (the widest of 1, 2 and 3) from the ring's edge.
    expect(10.1376 + 0.748 + 0.6144).toBeCloseTo(11.5, 9);
    const numberWidth = Math.max(...['1', '2', '3'].map((n) => cardMetrics(n, { face: 'regular', size: (1.05 * 0.64) / 0.714, tracking: 0 }).ink));
    expect(numberWidth).toBeCloseTo(0.451818, 5);
    expect(CARD_79T.steps.numberCentreX).toBeCloseTo(11.5 + numberWidth / 2, 5);
    expect(CARD_79T.steps.textX).toBeCloseTo(11.5 + numberWidth + 1.35, 5);
    // The GENOME row: its first glyph's ink on the column's edge, at one fixed scale.
    const row = genomeLayout(it.genome, 'row');
    expect(genome.scene.widthMm).toBeCloseTo(row.viewBox.w * CARD_79T.genome.rowScale, 9);
    expect(genome.xMm + (-1 - row.viewBox.x) * CARD_79T.genome.rowScale).toBeCloseTo(48.0052875, 9);
    expect(CARD_79T.genome.rowScale * 25.43).toBeCloseTo(15.354193, 5);
  });

  it('sets the column from 48.01 to 81.27, the claim code centred on it, its baseline and step 3\'s on 50.5', () => {
    expect(CARD_79T.column.x0).toBeCloseTo(48.01, 2);
    expect(CARD_79T.column.x1).toBeCloseTo(81.27, 2);
    expect(CARD_79T.column.x1 - CARD_79T.column.x0).toBeCloseTo(33.26, 2);
    expect(card.boxes.claimCode.left).toBeCloseTo(48.0052875, 6);
    expect(card.boxes.claimCode.right).toBeCloseTo(81.2659125, 6);
    expect(card.boxes.claimCode.baseline).toBe(50.5);
    expect(CARD_79T.steps.baselines).toEqual([47.14, 48.82, 50.5]);
    expect(CARD_79T.claim.codeBaseline).toBe(CARD_79T.steps.baselines[2]);
    // Equal air to the ring (its right edge 42.2712) and to the 8 mm bound.
    expect(48.0052875 - 42.2712).toBeCloseTo(95 - 8 - 81.2659125, 9);
  });

  it('places the monogram by MONOGRAM_BOUNDS (42.90, 100.15, 457.32, 416.69): 13.0 × 9.93 mm, its right edge on 81.27, from 17.47 to 27.40', () => {
    expect([MONOGRAM_BOUNDS.x, MONOGRAM_BOUNDS.y, MONOGRAM_BOUNDS.x + MONOGRAM_BOUNDS.w, MONOGRAM_BOUNDS.y + MONOGRAM_BOUNDS.h].map((v) => Math.round(v * 100) / 100)).toEqual([
      42.9, 100.15, 457.32, 416.69,
    ]);
    const b = pathBounds(MONOGRAM_PATHS);
    expect(b.x).toBeCloseTo(42.9, 2);
    expect(b.y + b.h).toBeCloseTo(416.69, 2);
    const m = card.boxes.monogram;
    expect(m.w).toBe(13);
    expect(m.h).toBeCloseTo(9.93, 2);
    expect(m.x + m.w).toBeCloseTo(81.2659125, 9);
    expect(m.y).toBeCloseTo(17.47, 2);
    expect(m.y + m.h).toBeCloseTo(27.4, 2);
    // Filled with the guilloche: a clip of the master outlines holding the K 5.9 ground and the K 29.8 waves.
    const mono = card.layers[0];
    expect(mono.kind).toBe('clip');
    if (mono.kind !== 'clip') return;
    const cb = bounds(mono.clip);
    expect(cb.x0).toBeCloseTo(m.x, 2);
    expect(cb.x1).toBeCloseTo(m.x + m.w, 2);
    expect(mono.items).toMatchObject([
      { kind: 'fill', color: '#F1F1EE', k: 5.9 },
      { kind: 'stroke', color: '#B4B4B1', k: 29.8, width: 0.06, cap: 'round', join: 'round' },
    ]);
  });

  it('layers the year on it: 2.4 mm, 7.76 mm wide, centred, cut out by a 0.165 mm halo of bare stock, filled with the same guilloche', () => {
    expect(CARD_79T.year).toEqual({ size: 2.4, tracking: 0.4, haloMm: 0.165, bandMm: 3 });
    const y = card.boxes.year;
    expect(y.right - y.left).toBeCloseTo(7.76, 2);
    expect((y.left + y.right) / 2).toBeCloseTo(CARD_79T.monogram.centreX, 6);
    expect(card.layers[1]).toMatchObject({ kind: 'stroke', width: 0.33, color: CARD_79T.stock, k: 0, join: 'round' });
    expect(card.layers[2]).toMatchObject({ kind: 'fill', color: CARD_79T.stock, k: 0 });
    expect(card.layers[3]).toMatchObject({ kind: 'clip', items: [{ k: 5.9 }, { k: 29.8 }] });
    expect(card.layers[1].kind === 'stroke' && card.layers[1].d).toBe(card.layers[3].kind === 'clip' && card.layers[3].clip);
  });

  it('sets CLAIM CODE · KEEP IT PRIVATE and its line 0.5 mm lower than the column\'s rhythm put them', () => {
    // build.py: the label's baseline at 44.39747 and the line at 45.34747, both lowered by 0.5 mm.
    expect(CARD_79T.claim.labelBaseline).toBeCloseTo(44.39747 + 0.5, 9);
    expect(CARD_79T.claim.lineY).toBeCloseTo(45.34747 + 0.5, 9);
    const line = strokes(card).find((l) => l.width === 0.1)!;
    expect(line).toMatchObject({ cap: 'butt' });
    expect(coords(line.d)).toEqual([
      [48.005, 45.847],
      [81.266, 45.847],
    ]);
  });

  it('keeps every mark 5.19 mm inside the trim, and every mark but the rule and its legends 8 mm inside; the legends sit on the rule', () => {
    for (const status of ['VALIDATED', 'PROOF'] as const) {
      const c = layoutCertificateCard(item(184), status);
      const [top, bottom] = c.boxes.legends;
      // The rule, then its two legends, in that order among the layers.
      const ruleAt = c.layers.findIndex((l) => l.kind === 'stroke' && l.width === 0.1125);
      for (const [i, { d, pad, layer }] of marks(c.layers).entries()) {
        const b = bounds(d, pad);
        const isRule = i === ruleAt;
        const isLegend = i === ruleAt + 1 || i === ruleAt + 2;
        if (isRule) {
          expect(b.x0, status).toBeGreaterThanOrEqual(CERTIFICATE_CARD.safeMm);
          expect(b.y0, status).toBeGreaterThanOrEqual(CERTIFICATE_CARD.safeMm);
          expect(b.x1, status).toBeLessThanOrEqual(95 - CERTIFICATE_CARD.safeMm);
          expect(b.y1, status).toBeLessThanOrEqual(62 - CERTIFICATE_CARD.safeMm);
        } else if (isLegend) {
          // On the rule: half its cap height (0.32 mm) outside it, as 79t sets them (the round letters' overshoot besides).
          expect(layer.kind, status).toBe('fill');
          expect(Math.min(b.y0, 62 - b.y1), status).toBeGreaterThanOrEqual(5.25 - 0.64 / 2 - 0.03);
          expect(b.x0, status).toBeGreaterThanOrEqual(Math.min(top.left, bottom.left) - 0.01);
          expect(b.x1, status).toBeLessThanOrEqual(Math.max(top.right, bottom.right) + 0.01);
        } else {
          expect(b.x0, status).toBeGreaterThanOrEqual(8);
          expect(b.y0, status).toBeGreaterThanOrEqual(8);
          expect(b.x1, status).toBeLessThanOrEqual(87);
          expect(b.y1, status).toBeLessThanOrEqual(54);
        }
      }
      // The ORBES CODE's outermost ink (its decor hairline, r 24.04 + 0.04 u) and the GENOME row.
      const code = c.placements[0];
      const reach = (24.04 + 0.04) * 0.64;
      expect(code.xMm + 16 - reach).toBeGreaterThanOrEqual(8);
      expect(code.yMm + 16 - reach).toBeGreaterThanOrEqual(8);
      const g = c.placements[1];
      expect(g.xMm + g.scene.widthMm).toBeLessThanOrEqual(87);
    }
  });
});

describe('certificate card 79t: variable data', () => {
  it('prints the year of the identity it is given: O27 prints 2027', () => {
    const a = layoutCertificateCard(item(184), 'VALIDATED');
    const b = layoutCertificateCard(item(184, { productId: 'O27-J-00184', year: 2027 }), 'VALIDATED');
    expect(a.layers[2].kind === 'fill' && a.layers[2].d).not.toBe(b.layers[2].kind === 'fill' && b.layers[2].d);
    const w = (year: string) => cardMetrics(year, { face: 'gravesend', size: 2.4, tracking: 0.4 }).ink;
    expect(b.boxes.year.right - b.boxes.year.left).toBeCloseTo(w('2027'), 9);
    expect(() => layoutCertificateCard(item(184, { year: 26 }), 'VALIDATED')).toThrow(CertificateInputError);
  });

  it('writes line 2 in its four forms: BLUE  ·  SIZE 17, SIZE 17, BLUE, and a size already worded or ONE SIZE as written', () => {
    expect(variantLine({ modelVariant: 'Blue', size: '17' })).toBe('BLUE  ·  SIZE 17');
    expect(variantLine({ modelVariant: null, size: '17' })).toBe('SIZE 17');
    expect(variantLine({ modelVariant: 'Blue', size: null })).toBe('BLUE');
    expect(variantLine({ modelVariant: '  ', size: '' })).toBe('');
    expect(sizeLabel('Size 54')).toBe('SIZE 54');
    expect(sizeLabel('One size')).toBe('ONE SIZE');
    expect(sizeLabel('17.5')).toBe('SIZE 17.5');
    expect(variantLine({ modelVariant: 'Bleu nuit', size: 'One size' })).toBe('BLEU NUIT  ·  ONE SIZE');
  });

  it('draws the three lines at their pitch, and without variant or size moves the material up one pitch; the claim block never moves', () => {
    const P = CARD_79T.piece;
    const full = layoutCertificateCard(item(184), 'VALIDATED');
    expect(full.boxes.lines.map((l) => [l.text, l.baseline])).toEqual([
      ['MONOLITHE · BRACELET', P.firstBaseline],
      ['BLUE  ·  SIZE 17', P.firstBaseline + P.pitch],
      ['925 STERLING SILVER', P.firstBaseline + 2 * P.pitch],
    ]);
    expect(full.boxes.lines.every((l) => l.size === 1.2)).toBe(true);
    const bare = layoutCertificateCard(item(184, { modelVariant: null, size: null }), 'VALIDATED');
    expect(bare.boxes.lines.map((l) => [l.text, l.baseline])).toEqual([
      ['MONOLITHE · BRACELET', P.firstBaseline],
      ['925 STERLING SILVER', P.firstBaseline + P.pitch],
    ]);
    expect(bare.boxes.claimCode).toEqual(full.boxes.claimCode);
    expect(strokes(bare).map((s) => s.d)).toEqual(strokes(full).map((s) => s.d));
  });

  it('fits long text to the column: shrinks it to 1.0 mm, then cuts it with "...", never past x 81.27', () => {
    const long = layoutCertificateCard(
      item(184, { model: 'MONOLITHE ARCHITECTURALE · BRACELET', material: '925 Sterling Silver, rhodium plated, with a satin finish on every face' }),
      'VALIDATED',
    );
    const [model, , material] = long.boxes.lines;
    expect(model.text).toBe('MONOLITHE ARCHITECTURALE · BRACELET');
    expect(model.size).toBeLessThan(1.2);
    expect(model.size).toBeGreaterThanOrEqual(1.0);
    expect(material.size).toBe(1.0);
    expect(material.text.endsWith('...')).toBe(true);
    for (const l of long.boxes.lines) expect(l.right).toBeLessThanOrEqual(CARD_79T.column.x1 + 1e-9);
  });

  it('removes accents as every printed document does, and drops a character it has no outline for', () => {
    const c = layoutCertificateCard(item(184, { model: 'Éclat d’été · Bague', modelVariant: 'Émeraude', size: '52' }), 'VALIDATED');
    expect(c.boxes.lines.map((l) => l.text)).toEqual([toLabelText('Éclat d’été · Bague'), 'EMERAUDE  ·  SIZE 52', '925 STERLING SILVER']);
    expect(toLabelText('Éclat d’été · Bague')).toBe('ECLAT D ETE · BAGUE');
  });

  it('clears the monogram with a 6-digit serial', () => {
    const c = layoutCertificateCard(item(184, { productId: 'O26-J-999999' }), 'VALIDATED');
    expect(c.boxes.serial.right).toBeLessThan(c.boxes.monogram.x - 4);
  });

  it('centres any claim code on the column, inside the 8 mm bound and clear of the ORBES CODE', () => {
    // 79t's code is the column's measure; Helvetica Neue's letters are not all as wide, so the widest (W, M) reach
    // past the column, still clear of the ring and inside the bound, and the narrowest (1) stay inside it.
    for (const code of [CLAIM_79T, '7KQ2-M4TD-9XWH', '1111-1111-1111', 'WWWW-MMMM-WWWW', 'AVAT-PYPT-PAPA']) {
      const c = layoutCertificateCard(item(184, { claimCode: code }), 'VALIDATED');
      const b = c.boxes.claimCode;
      expect((b.left + b.right) / 2, code).toBeCloseTo((CARD_79T.column.x0 + CARD_79T.column.x1) / 2, 6);
      expect(b.left, code).toBeGreaterThan(42.2712 + 1);
      expect(b.right, code).toBeLessThan(87);
    }
  });

  it('says PROOF · LAYOUT NOT VALIDATED in the top rule, in MINT CERTIFICATE\'s place, only for a PROOF layout', () => {
    const proof = layoutCertificateCard(item(184), 'PROOF');
    expect(proof.boxes.legends.map((l) => l.text)).toEqual(['PROOF · LAYOUT NOT VALIDATED', 'VERIFY ONLY AT VERIFY.THEORBES.COM']);
    const [top] = proof.boxes.legends;
    const rule = coords(strokes(proof).find((l) => l.width === 0.1125)!.d).filter(([x, y]) => y === 5.25 && x > 10 && x < 85).map(([x]) => x).sort((a, b) => a - b);
    expect(top.left - rule[0]).toBeCloseTo(1.4, 3);
    expect(layoutCertificateCard(item(184), 'VALIDATED').boxes.legends[0].text).toBe('MINT CERTIFICATE');
  });

  it('refuses what it cannot draw', () => {
    expect(() => layoutCertificateCard(item(1, { productId: 'nope' }), 'VALIDATED')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(1, { claimCode: '7KQ2-M4TD-9XW' }), 'VALIDATED')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(1, { claimCode: '7KQ2-M4TD-9XWU' }), 'VALIDATED')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(1, { genome: { ...item(1).genome, fingerprint: 'X' } }), 'VALIDATED')).toThrow(CertificateInputError);
    expect(() => layoutCertificateCard(item(1, { code: undefined as never }), 'VALIDATED')).toThrow(CertificateInputError);
  });
});

/** The card as Chrome drew 79t's front.png: (6, 6) device pixels from its corner, 6 device pixels per CSS pixel. */
const PX_PER_MM = (6 * 96) / 25.4;

/** A PNG's first pixel of the card's stock from the top-left, along the row and column through (x, y). */
function cardCorner(img: PNG): { x: number; y: number } {
  const stock = (i: number) => img.data[i] === 251 && img.data[i + 1] === 251 && img.data[i + 2] === 249;
  let x = 0;
  while (x < img.width && !stock((300 * img.width + x) * 4)) x++;
  let y = 0;
  while (y < img.height && !stock((y * img.width + 300) * 4)) y++;
  return { x, y };
}

/** Rasterise a card SVG into a frame of the reference's size, its corner at `corner`, on the reference's table colour. */
async function renderLike(svg: string, ref: PNG, corner: { x: number; y: number }): Promise<PNG> {
  const k = PX_PER_MM;
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const [x, y, w, h] = [-corner.x / k, -corner.y / k, ref.width / k, ref.height / k];
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#D9D8D4"/>${inner}</svg>`;
  return PNG.sync.read(Buffer.from(await svgToPng(frame, { widthPx: ref.width, dpi: 600 })));
}

describe('certificate card 79t: its ORBES CODE scans', () => {
  it('decodes, from the card rendered at 600 dpi, to the piece\'s signed payload', async () => {
    const decoder = await requireDecoder();
    const it = item(184);
    const png = await svgToPng(certificateCardSvg(it, { edge: false }), { widthPx: pixelsFor(95, 600), dpi: 600 });
    const img = PNG.sync.read(Buffer.from(png));
    expect(img.width).toBe(2244);
    const res = decoder.decodeOrbesCode(decoder.rgbaToGray(img.data, img.width, img.height), { readGenome: true });
    expect(res.ok, res.ok ? '' : `${res.reason} ${res.detail ?? ''}`).toBe(true);
    if (!res.ok) return;
    expect(Buffer.from(res.data).equals(Buffer.from(it.code.data))).toBe(true);
    expect(res.genome?.glyphs).toEqual(it.genome.glyphs);
  });
});

describe('certificate card 79t: fidelity to the validated design (test/fixtures/card-79t/79t-mint/front.png)', () => {
  it('matches 79t: at most 0.5 % of its pixels differ by more than 48/255 in a channel, and every cell of the ORBES CODE reads the same', async () => {
    const ref = PNG.sync.read(readFileSync(join(FIXTURE, '79t-mint', 'front.png')));
    // A Chrome screenshot at deviceScaleFactor 6 of 360 × 236 CSS px: the card from (6, 6), 22.68 px per mm.
    expect([ref.width, ref.height]).toEqual([2160, 1416]);
    const corner = cardCorner(ref);
    expect(corner).toEqual({ x: 6, y: 6 });
    const specimen = { ...CERTIFICATE_SPECIMEN_ITEM, claimCode: CLAIM_79T };
    // Chrome put each glyph's baseline on a whole device pixel and its origin on a quarter pixel (Skia's glyph
    // positioning): the type is placed so for the comparison, which then measures the card, not the rasteriser.
    const svg = onGlyphGrid({ pxPerMm: PX_PER_MM, originPx: corner }, () => certificateCardSvg(specimen, { edge: false }));
    const mine = await renderLike(svg, ref, corner);
    const diff = new PNG({ width: ref.width, height: ref.height });
    let differ = 0;
    for (let i = 0; i < ref.data.length; i += 4) {
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(ref.data[i + c] - mine.data[i + c]));
      if (d > 48) differ++;
      const v = 255 - Math.min(255, d * 3);
      diff.data.set([d > 48 ? 255 : v, v, v, 255], i);
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'card-79t-diff.png'), PNG.sync.write(diff));
    writeFileSync(join(OUT, 'card-79t-specimen.png'), PNG.sync.write(mine));
    const share = differ / (ref.width * ref.height);
    expect(share, `${differ} pixels differ (${(share * 100).toFixed(3)} %): see out/card-79t-diff.png`).toBeLessThanOrEqual(0.005);

    // Every cell of the code, at its centre: dark in both or light in both.
    const lum = (img: PNG, x: number, y: number) => {
      const i = (Math.round(y) * img.width + Math.round(x)) * 4;
      return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    };
    const { x: cx, y: cy } = { x: corner.x + (CARD_79T.code.x + 16) * PX_PER_MM, y: corner.y + (CARD_79T.code.y + 16) * PX_PER_MM };
    const u = (0.64 * PX_PER_MM);
    const wrong: number[] = [];
    for (let flat = 0; flat < CODE01_TOTAL_CELLS; flat++) {
      const p = cellCenter(flat);
      const [x, y] = [cx + p.x * u, cy + p.y * u];
      if (lum(ref, x, y) < 128 !== lum(mine, x, y) < 128) wrong.push(flat);
    }
    expect(wrong).toEqual([]);
  }, 60_000);
});

describe('certificate sheet', () => {
  it('lays eight abutting cards on A4: 2 × 4, the grid centred, 10 mm left and right, 24.5 mm top and bottom', () => {
    expect(CERTIFICATE_SHEET).toEqual({ page: 'A4', columns: 2, rows: 4, marginYmm: 24.5, footer: { centerYmm: 284, barRightMm: 186, barLabel: 'before' } });
    const s = layoutCertificateSheet(19);
    expect(s.pages.map((p) => p.length)).toEqual([8, 8, 3]);
    expect(s.pages[0].map((p) => [p.xMm, p.yMm])).toEqual([
      [10, 24.5],
      [105, 24.5],
      [10, 86.5],
      [105, 86.5],
      [10, 148.5],
      [105, 148.5],
      [10, 210.5],
      [105, 210.5],
    ]);
    expect(210 - (105 + 95)).toBe(10);
    expect(297 - (210.5 + 62)).toBe(24.5);
    expect(() => layoutCertificateSheet(0)).toThrow(CertificateInputError);
  });

  it('puts cut marks only outside the grid, on every cut line', () => {
    const cuts = gridCutMarks(10, 24.5, 2, 4, 95, 62);
    const segments = [...cuts.d.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map((m) => m.slice(1).map(Number));
    expect(segments).toHaveLength(2 * 3 + 2 * 5);
    for (const [x0, y0, x1, y1] of segments) {
      const outside = (x: number, y: number) => x < 10 || x > 200 || y < 24.5 || y > 272.5;
      expect(outside(x0, y0) && outside(x1, y1)).toBe(true);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(3, 9);
    }
  });

  it('keeps the footer at 284 mm, clear of the cut marks, of the x = 200 mm cut line and of the unprintable bottom edge', () => {
    const sheet = layoutCertificateSheet(MAX_CERTIFICATE_ITEMS);
    // The longest caption the renderer writes: PROOF, a two-digit count, the last page.
    const footer = sheetFooter(sheet, sheet.pages.length - 1, 'ORBES CERTIFICATE CARDS · PROOF · 2026-10-02 · 50 CARDS', CERTIFICATE_SHEET.footer);
    expect(footer).toHaveLength(3);
    const [caption, bar, label] = footer.map((st) => bounds(st.d, st.width / 2));
    const cutMarksEnd = CERTIFICATE_SHEET.marginYmm + CERTIFICATE_SHEET.rows * CERTIFICATE_CARD.heightMm + 1 + 3;
    expect(cutMarksEnd).toBe(276.5);
    for (const b of [caption, bar, label]) {
      expect(b.y0).toBeGreaterThanOrEqual(cutMarksEnd + 5);
      expect(b.y1).toBeLessThanOrEqual(297 - 10);
    }
    // One line: the caption, then '10 MM', then the bar, ending short of the right cut line.
    expect(caption.x1).toBeLessThan(label.x0 - 1);
    expect(label.x1).toBeLessThan(bar.x0);
    expect(bar.x1).toBeLessThan(10 + 2 * CERTIFICATE_CARD.widthMm - 1);
    const unpadded = bounds(footer[1].d);
    expect(unpadded.x1 - unpadded.x0).toBeCloseTo(10, 9);
  });

  it('cards per request: 50, which make 7 sheets (6 × 8 + 2); 48 make six full sheets', async () => {
    expect(MAX_CERTIFICATE_ITEMS).toBe(50);
    expect(layoutCertificateSheet(48).pages.map((p) => p.length)).toEqual([8, 8, 8, 8, 8, 8]);
    expect(layoutCertificateSheet(50).pages.map((p) => p.length)).toEqual([8, 8, 8, 8, 8, 8, 2]);
  });
});

describe('certificate PDF', () => {
  it('one card per page at 95 × 62 mm: valid, vector, no font, no image, no text, no spot colour', async () => {
    const r = await renderCertificatePdf([item(184)], { createdAt: DATE });
    expect(r.contentType).toBe('application/pdf');
    expect(r.filename).toBe('ORBES-certificate-O26-J-00184.pdf');
    const pdf = r.body as Uint8Array;
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 269\.291339 175\.748031\]/);
    expect(text).toMatch(/\/Count 1\b/);
    expect(pdfObjects(pdf)).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject|\/DCTDecode|\/JPXDecode|\/Separation|\/ExtGState/);
    const content = pdfStreams(pdf);
    expect(content).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b|\bBI\b|\bDo\b/);
    expect(content).toMatch(/\bS\n/); // the rule, the line, the guilloche
    expect(content).toMatch(/\bf\n/); // the type, the code, the GENOME
    expect(content).toMatch(/\bW n\n/); // the monogram's and the year's clips

    const three = await renderCertificatePdf([item(1), item(2), item(3)], { createdAt: DATE });
    expect(latin1(three.body)).toMatch(/\/Count 3\b/);
    expect(three.filename).toBe('ORBES-certificates-2026-10-02-3-card.pdf');
  });

  it('K only: no RGB anywhere, every colour C = M = Y = 0, the greys as K 5.9 and K 29.8, the stock never inked but where the year is cut out', async () => {
    const content = pdfStreams((await renderCertificatePdf([item(184), item(185)], { layout: 'sheet', createdAt: DATE })).body as Uint8Array);
    expect(content).not.toMatch(/DeviceRGB/);
    expect(content).toContain('0 0 0 1 scn');
    expect(content).toContain('0 0 0 1 SCN');
    expect(content).toMatch(/0 0 0 0\.059\d* scn/);
    expect(content).toMatch(/0 0 0 0\.298\d* SCN/);
    // The code's decor hairlines keep their tints (K 35 and K 25).
    expect(content).toContain('0 0 0 0.35 scn');
    expect(content).toContain('0 0 0 0.25 scn');
    const tints = new Set<string>();
    for (const m of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) (scn|SCN)/g)) {
      expect([m[1], m[2], m[3]]).toEqual(['0', '0', '0']);
      tints.add(Number(m[4]).toFixed(3));
    }
    expect([...tints].sort()).toEqual(['0.000', '0.059', '0.250', '0.298', '0.350', '1.000']);
  });

  it('A4 sheets of eight with cut marks outside the grid and a footer clear of them', async () => {
    const r = await renderCertificatePdf(Array.from({ length: 12 }, (_, i) => item(i + 1)), { layout: 'sheet', createdAt: DATE });
    expect(r.filename).toBe('ORBES-certificates-2026-10-02-12-sheet.pdf');
    const text = latin1(r.body);
    expect(text).toMatch(new RegExp(`/MediaBox \\[0 0 ${mmToPt(210).toFixed(6).replace(/0+$/, '')} ${mmToPt(297).toFixed(6).replace(/0+$/, '')}\\]`));
    expect(text).toMatch(/\/Count 2\b/);
    // The title is UTF-16 (it holds '·'): read it without its zero bytes.
    expect(text.replace(/\0/g, '')).toContain('ORBES CERTIFICATE CARDS · 2026-10-02 · 12 CARDS');
    expect(text.replace(/\0/g, '')).not.toContain('PROOF');
    const fifty = await renderCertificatePdf(Array.from({ length: 50 }, (_, i) => item(i + 1)), { layout: 'sheet', createdAt: DATE });
    expect(latin1(fifty.body)).toMatch(/\/Count 7\b/);
  });

  it('a PROOF layout says PROOF in the top rule, the caption and the file names', async () => {
    const r = await renderCertificatePdf([item(184)], { createdAt: DATE, status: 'PROOF' });
    expect(r.filename).toBe('ORBES-certificate-O26-J-00184-PROOF.pdf');
    expect(latin1(r.body)).toMatch(/\(ORBES, certificate, PROOF, O26-J-00184\)/);
    const sheet = await renderCertificatePdf([item(184)], { createdAt: DATE, status: 'PROOF', layout: 'sheet' });
    expect(sheet.filename).toBe('ORBES-certificates-2026-10-02-1-sheet-PROOF.pdf');
    expect(latin1(sheet.body).replace(/\0/g, '')).toContain('ORBES CERTIFICATE CARDS · PROOF · 2026-10-02 · 1 CARDS');
    const validated = await renderCertificatePdf([item(184)], { createdAt: DATE });
    expect(latin1(validated.body)).not.toMatch(/PROOF/);
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
    const svg = certificateCardSvg(item(184, { claimCode: code }));
    for (const s of spellings(code)) expect(svg).not.toContain(s);
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
  it('productId, model, variant (line 2 as printed), material, year, code: quoted, CRLF, values as recorded', () => {
    const r = renderCertificateCsv(
      [item(184), item(185, { modelVariant: null, size: 'One size', material: 'Or jaune 18 carats, « Soleil »', claimCode: '0000-1111-2222', year: 2027 })],
      { createdAt: DATE },
    );
    expect(r.contentType).toBe('text/csv; charset=utf-8; header=present');
    expect(r.filename).toBe('ORBES-certificates-2026-10-02-2.csv');
    expect(r.body).toBe(
      '"productId","model","variant","material","year","code"\r\n' +
        '"O26-J-00184","MONOLITHE · BRACELET","BLUE  ·  SIZE 17","925 STERLING SILVER","2026","7KQ2-M4TD-9XWH"\r\n' +
        '"O26-J-00185","MONOLITHE · BRACELET","ONE SIZE","Or jaune 18 carats, « Soleil »","2027","0000-1111-2222"\r\n',
    );
  });

  it('names the file PROOF only for a PROOF layout, its columns unchanged either way', () => {
    const proof = renderCertificateCsv([item(184)], { createdAt: DATE, status: 'PROOF' });
    const validated = renderCertificateCsv([item(184)], { createdAt: DATE, status: 'VALIDATED' });
    expect(proof.filename).toBe('ORBES-certificates-2026-10-02-1-PROOF.csv');
    expect(validated.filename).toBe('ORBES-certificates-2026-10-02-1.csv');
    expect(renderCertificateCsv([item(184)], { createdAt: DATE }).filename).toBe(validated.filename);
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
  it('shows 79t on its stock with the piece of 79t: the ORBES CODE, the GENOME row, the guilloche; no scratch-off panel', () => {
    const svg = certificateCardSvg(CERTIFICATE_SPECIMEN_ITEM);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="95mm" height="62mm" viewBox="0 0 95 62">/);
    expect(svg).toContain('<rect data-layer="stock" width="95" height="62" fill="#FBFBF9"/>');
    expect(svg).toContain('<g data-layer="orbes-code"');
    expect(svg).toContain('<g data-layer="genome"');
    expect(svg).toContain('stroke="#B4B4B1"');
    expect(svg).not.toMatch(/scratch|<text|font/i);
    expect(CERTIFICATE_SPECIMEN_ITEM).toMatchObject({ productId: 'O26-J-00184', model: 'MONOLITHE · BRACELET', modelVariant: 'Blue', size: '17', year: 2026, claimCode: '7KQ2-M4TD-9XWH' });
    expect(CERTIFICATE_SPECIMEN_ITEM.genome.fingerprint).toBe('G1-E1DC-BE52');
    // The ORBES CODE of render-samples.ts, the one 79t's assets/orbes-code-sample.svg draws.
    expect(Buffer.from(CERTIFICATE_SPECIMEN_ITEM.code.data).equals(Buffer.from(sampleInput().data))).toBe(true);
    expect(readFileSync(join(FIXTURE, 'assets', 'orbes-code-sample.svg'), 'utf8')).toBe(readFileSync(join(ASSETS, 'orbes-code-sample.svg'), 'utf8'));
  });

  it('the committed specimen files are byte for byte what scripts/certificate-specimen.ts produces (run it after any change); the revealed one is gone', async () => {
    const files = await renderCertificateSpecimenFiles();
    expect(files.map((f) => f.name)).toEqual(['certificate-card-specimen.svg', 'certificate-card-specimen.pdf']);
    for (const f of files) {
      const path = join(ASSETS, f.name);
      expect(existsSync(path), `${path} missing: run npx tsx scripts/certificate-specimen.ts`).toBe(true);
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(f.bytes)), `${f.name} is stale: run npx tsx scripts/certificate-specimen.ts`).toBe(true);
    }
    expect(existsSync(join(ASSETS, 'certificate-card-specimen-revealed.svg'))).toBe(false);
  });

  it('keeps 79t\'s record in the repository: build.py with tex.py and its assets, and its front.png', () => {
    for (const f of ['tex.py', '79t-mint/build.py', '79t-mint/front.png', 'assets/orbes-code-sample.svg', 'assets/genome-row.svg', 'assets/orbes-monogram.svg', 'assets/gravesend-sans-500.woff2']) {
      expect(existsSync(join(FIXTURE, f)), f).toBe(true);
    }
    const build = readFileSync(join(FIXTURE, '79t-mint', 'build.py'), 'utf8');
    expect(build).toContain("cert = 'MINT CERTIFICATE'");
    expect(build).toContain("'7MSE-SK34-PWMC'");
    expect(build).toContain('MB = (42.90, 100.15, 457.32, 416.69)');
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
