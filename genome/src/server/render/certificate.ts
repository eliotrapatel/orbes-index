/**
 * ORBES certificate card: the 85 × 55 mm card delivered with a piece, which
 * carries its one-time claim code under a scratch-off panel, and the A4
 * sheet of ten cards for print runs. Card millimetres, y down:
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ ORBES                                 ╭─────╮ │  the monogram, from the cap line of ORBES
 *   │ CERTIFICATE PROOF · LAYOUT NOT VALID… │ ORB │ │  to the identity baseline; PROOF until
 *   │ O26-J-00184                           ╰─────╯ │  the brand validates the layout
 *   │ ○ · ◠ · ◝ · …       GENOME G1-E1DC-BE52       │  GENOME row, as printed
 *   │ MODEL      MONOLITHE · RING                   │
 *   │ MATERIAL   925 STERLING SILVER                │
 *   │ ───────────────────────────────────────────── │
 *   │ 1 OPEN THEORBES.COM/VERIFY    CLAIM CODE      │
 *   │ 2 SCAN THE ORBES CODE         ┌─────────────┐ │
 *   │ 3 REGISTER WITH THE CLAIM CODE│▒▒ scratch ▒▒│ │  claim code under the panel
 *   │                               └─────────────┘ │
 *   │ VERIFY ONLY AT THEORBES.COM/VERIFY            │
 *   └───────────────────────────────────────────────┘
 *
 * Never the ORBES CODE itself: the piece carries the scannable code, the card
 * proves possession. A photograph of a card must not be a code that verifies.
 *
 * Everything is geometry, as on the print label: lettering from
 * ./label-font.ts (stroked, no font in the file), the GENOME from the core
 * genome layout (filled), the brand's monogram as a flat fill of its master
 * outlines (core/render/monogram.ts; the word ORBES stays lettered beside
 * it), a hairline rule, and the scratch-off panel as a flat fill in the spot
 * colour ORBES SCRATCH-OFF set to overprint, so the claim code beneath it
 * stays whole on the black plate. Black is K only
 * (DeviceCMYK, as the K-only artifacts): no four-colour rich black on
 * hairline lettering. The claim code exists in the PDF only as stroked
 * paths, never as text, so it cannot be searched or copied out of the file.
 *
 * The data file for variable-data printing (CSV) holds the card's fields
 * except the GENOME, which a print shop cannot typeset.
 *
 * Until the brand validates the layout (BRAND-DESIGN-SYSTEM §7), every card,
 * sheet and file name (PDF and CSV) carries the mention PROOF: CERTIFICATE_LAYOUT_STATUS
 * moves to 'VALIDATED' on the brand's sign-off, and only then.
 *
 * The same lettering, GENOME geometry and monogram draw the OWNERSHIP
 * CERTIFICATE (F-06, `renderOwnershipCertificatePdf`, at the end of this
 * file): the A4 page a piece's owner shares with a buyer or an insurer, the
 * PDF of the live record at `/verify/c#…` (services/ownership-certificates.ts).
 * It names no owner, never says AUTHENTIC (it attests a record, not the
 * object it is shown with) and carries its live address, lettered and as a
 * link, so whoever holds the page can check that it is still valid.
 */
import { ORBES_CODE_STYLES } from '../../core/code/styles.js';
import { genomeLayout } from '../../core/genome/render.js';
import type { Genome } from '../../core/genome/genome.js';
import { MONOGRAM_BOUNDS, monogramPathData } from '../../core/render/monogram.js';
import { primitiveToPathData } from '../../core/render/svg.js';
import { measureText, textRun, toLabelText, type TextRun } from './label-font.js';
import { csvDocument, csvField, CSV_CONTENT_TYPE } from './csv.js';
import { renderPdf, type PdfPage, type PdfPlacement, type PdfSpotColor } from './pdf.js';
import { gridCutMarks, sheetFooter, SHEET_PAGES, type SheetLayout, type SheetPlacement } from './print-sheet.js';
import type { ArtifactScene, StrokePath } from './scene.js';

export type CertificateLayoutStatus = 'PROOF' | 'VALIDATED';

/** The brand's sign-off of the card layout: 'VALIDATED' only once the brand approves the specimen of BRAND §7. */
export const CERTIFICATE_LAYOUT_STATUS: CertificateLayoutStatus = 'PROOF';

export type CertificateFormat = 'pdf' | 'csv';
export type CertificateLayout = 'card' | 'sheet';
export const CERTIFICATE_FORMATS: readonly CertificateFormat[] = ['pdf', 'csv'];
export const CERTIFICATE_LAYOUTS: readonly CertificateLayout[] = ['card', 'sheet'];

/** Cards per request: each costs one scrypt check of its claim code before anything is drawn. */
export const MAX_CERTIFICATE_ITEMS = 50;

export const CERTIFICATE_CARD = Object.freeze({
  widthMm: 85,
  heightMm: 55,
  /** Nothing is drawn closer than this to a trimmed edge (cutting tolerance). */
  safeMm: 4.5,
});

/** A4 sheet: 2 × 5 abutting cards (no gutter, cut on shared edges), 11 mm top and bottom margins. */
export const CERTIFICATE_SHEET = Object.freeze({
  page: 'A4' as const,
  columns: 2,
  rows: 5,
  marginYmm: 11,
  /**
   * Footer in the 11 mm under the grid, below the cut marks (287 to 290 mm):
   * the caption, then '10 MM' and the scale bar on the same line, all ink
   * within 291 to 293 mm, so 4 mm clear of an edge office printers may not
   * print. The bar ends short of the x = 190 mm cut line: no cut mark points
   * at it.
   */
  footer: Object.freeze({ centerYmm: 292, barRightMm: 186, barLabel: 'before' as const }),
});

/** The scratch-off ink, on its own plate. The CMYK alternate (a mid grey) is only how viewers and office printers show it. */
export const SCRATCH_OFF_SPOT: Readonly<PdfSpotColor> = Object.freeze({ name: 'ORBES SCRATCH-OFF', cmyk: [0, 0, 0, 35] as const });

/**
 * The card's fixed copy (house voice: uppercase, tracked). The three steps
 * are those of the packaging kit (docs/launch/PACKAGING-KIT.md), word for
 * word, as test/docs/packaging-kit.test.ts checks: step 2 names the ORBES
 * CODE, what the buyer scans, not the SEAL, its finder (BRAND §2.1).
 */
export const CERTIFICATE_COPY = Object.freeze({
  title: 'CERTIFICATE',
  proof: 'PROOF · LAYOUT NOT VALIDATED',
  model: 'MODEL',
  material: 'MATERIAL',
  genome: 'GENOME',
  steps: Object.freeze(['OPEN THEORBES.COM/VERIFY', 'SCAN THE ORBES CODE', 'REGISTER WITH THE CLAIM CODE'] as const),
  claimCode: 'CLAIM CODE',
  verifyOnly: 'VERIFY ONLY AT THEORBES.COM/VERIFY',
});

export interface CertificateItem {
  /** Canonical product id, e.g. O26-J-00184. */
  productId: string;
  /** Model as recorded, e.g. 'MONOLITHE · RING' (free text: drawn through toLabelText). */
  model: string;
  /** Material as recorded (free text: drawn through toLabelText). */
  material: string;
  genome: Pick<Genome, 'glyphs' | 'version' | 'fingerprint'>;
  /** XXXX-XXXX-XXXX in canonical Crockford. The caller has checked it against the product's hash. */
  claimCode: string;
}

export interface CertificateOptions {
  layout?: CertificateLayout;
  /** Defaults to CERTIFICATE_LAYOUT_STATUS. */
  status?: CertificateLayoutStatus;
  /** PDF creation date (deterministic output); its day appears in sheet captions and file names. */
  createdAt: Date;
}

export interface RenderedCertificates {
  contentType: string;
  body: Uint8Array | string;
  filename: string;
}

/** Input the renderer cannot draw. The service validates first, so this is a programming error. */
export class CertificateInputError extends RangeError {
  override readonly name = 'CertificateInputError';
}

// ── Card layout ────────────────────────────────────────────────────────────

const INK = '#0A0A0A';
/** Hairline floor: thinner strokes do not survive a print shop's plate (0.1 mm ≈ 0.28 pt). */
const MIN_STROKE_MM = 0.1;
const CROCKFORD_GROUP = '[0-9A-HJKMNP-TV-Z]{4}';
const CLAIM_CODE_RE = new RegExp(`^${CROCKFORD_GROUP}-${CROCKFORD_GROUP}-${CROCKFORD_GROUP}$`);
const PRODUCT_ID_RE = /^O\d{2}-[A-Z]-\d{5,6}$/;
const FINGERPRINT_RE = /^G\d+-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Card geometry in card millimetres (origin at the card's top-left corner). */
export const CARD_LAYOUT = Object.freeze({
  left: 6,
  right: 79,
  brand: { text: 'ORBES', cap: 2.2, tracking: 0.9, baseline: 8.6 },
  /** CERTIFICATE under the word, then the PROOF mention on the same baseline. */
  title: { cap: 1.2, tracking: 0.6, baseline: 11.2 },
  proof: { cap: 1.0, tracking: 0.45, baseline: 11.2, gapMm: 3 },
  /**
   * The monogram (BRAND §3.9), a flat K fill against the right margin: its ink
   * from the cap line of ORBES (8.6 − 2.2) down to the identity's baseline,
   * 11 mm high and so 14.4 mm wide.
   */
  monogram: { top: 6.4, bottom: 17.4 },
  id: { cap: 3.0, tracking: 0.3, baseline: 17.4 },
  /** GENOME row: glyph diameter, the top of its box (the row layout keeps a 0.7 R margin), gap to the fingerprint. */
  genome: { glyphMm: 2.6, top: 19.6, gapMm: 3, cap: 1.1, tracking: 0.35 },
  rows: { labelCap: 1.0, labelTracking: 0.45, valueX: 23, valueCap: 1.3, minValueCap: 1.0, valueTracking: 0.25, baselines: [28.4, 31.8] as const },
  rule: { y: 34.6 },
  steps: { numberX: 6, textX: 9.2, cap: 1.2, tracking: 0.22, baselines: [39, 41.9, 44.8] as const },
  claim: { x: 47, labelBaseline: 39, labelCap: 1.0, labelTracking: 0.45 },
  panel: { x: 47, y: 40.6, w: 32, h: 6.8, r: 1 },
  code: { cap: 1.75, minCap: 1.4, tracking: 0.18, padMm: 1 },
  verifyOnly: { cap: 1.2, tracking: 0.35, baseline: 49.6 },
});

export interface CertificateCard {
  /** The GENOME row: a scene placed in page millimetres. */
  genome: PdfPlacement;
  /** The monogram's five outlines, closed paths in page millimetres, filled in ink. */
  monogram: string[];
  /** The monogram's ink box, page millimetres. */
  monogramBox: { x: number; y: number; w: number; h: number };
  /** Lettering and the rule, stroked, in page millimetres. */
  strokes: StrokePath[];
  /** The scratch-off panel: a closed path in page millimetres. */
  panel: string;
  /** The panel's rectangle, page millimetres. */
  panelBox: { x: number; y: number; w: number; h: number };
  /** The claim code's lettering (also in `strokes`): the panel must cover it. */
  code: StrokePath;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new CertificateInputError('non-finite coordinate');
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

const stroked = (run: TextRun): StrokePath => ({ d: run.d, width: Math.max(run.strokeWidth, MIN_STROKE_MM) });

interface LineSpec {
  cap: number;
  tracking: number;
  x: number;
  baseline: number;
  align?: 'start' | 'middle' | 'end';
}

/**
 * Free text on one line of at most `maxWidth`: at its cap height when it
 * fits, shrunk down to `minCap` otherwise, and only then cut short with '...'.
 */
function fittedRun(text: string, spec: LineSpec & { minCap: number; maxWidth: number }): TextRun {
  const width = (t: string) => measureText(t, spec.tracking);
  let t = text;
  // The cap height at which the whole text fills the line. Whether to cut is
  // decided on it, never by multiplying it back: width × (maxWidth / width)
  // can round one ulp above maxWidth, and text that fits would lose its end.
  const fit = spec.maxWidth / width(t);
  let cap = Math.min(spec.cap, fit);
  if (fit < spec.minCap) {
    cap = spec.minCap;
    const chars = [...t];
    while (width(t) * cap > spec.maxWidth && chars.length > 0) {
      chars.pop();
      t = `${chars.join('').trimEnd()}...`;
    }
  }
  return textRun(t, { capHeight: cap, tracking: spec.tracking, x: spec.x, baseline: spec.baseline, align: spec.align ?? 'start' });
}

/** A rounded rectangle as one closed path (M, L, A, Z only, like the lettering). */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const a = (ex: number, ey: number) => `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`;
  return (
    `M${fmt(x + r)} ${fmt(y)}L${fmt(x + w - r)} ${fmt(y)}${a(x + w, y + r)}` +
    `L${fmt(x + w)} ${fmt(y + h - r)}${a(x + w - r, y + h)}` +
    `L${fmt(x + r)} ${fmt(y + h)}${a(x, y + h - r)}` +
    `L${fmt(x)} ${fmt(y + r)}${a(x + r, y)}Z`
  );
}

/** Lay out one card with its top-left corner at (ox, oy) page millimetres. Throws CertificateInputError on input it cannot draw. */
export function layoutCertificateCard(item: CertificateItem, status: CertificateLayoutStatus, ox = 0, oy = 0): CertificateCard {
  if (!PRODUCT_ID_RE.test(item.productId)) throw new CertificateInputError('not a canonical product id');
  if (!CLAIM_CODE_RE.test(item.claimCode)) throw new CertificateInputError('a claim code is XXXX-XXXX-XXXX in canonical Crockford');
  if (!FINGERPRINT_RE.test(item.genome.fingerprint)) throw new CertificateInputError('not a genome fingerprint');
  const L = CARD_LAYOUT;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const strokes: StrokePath[] = [];
  const line = (text: string, s: LineSpec) =>
    strokes.push(stroked(textRun(text, { capHeight: s.cap, tracking: s.tracking, x: X(s.x), baseline: Y(s.baseline), align: s.align ?? 'start' })));

  // Header: the word, CERTIFICATE (and PROOF) under it, the monogram at the right margin.
  line(L.brand.text, { cap: L.brand.cap, tracking: L.brand.tracking, x: L.left, baseline: L.brand.baseline });
  line(CERTIFICATE_COPY.title, { cap: L.title.cap, tracking: L.title.tracking, x: L.left, baseline: L.title.baseline });
  if (status === 'PROOF') {
    const x = L.left + measureText(CERTIFICATE_COPY.title, L.title.tracking) * L.title.cap + L.proof.gapMm;
    line(CERTIFICATE_COPY.proof, { cap: L.proof.cap, tracking: L.proof.tracking, x, baseline: L.proof.baseline });
  }
  const mh = L.monogram.bottom - L.monogram.top;
  const mw = (mh * MONOGRAM_BOUNDS.w) / MONOGRAM_BOUNDS.h;
  const monogramBox = { x: X(L.right - mw), y: Y(L.monogram.top), w: mw, h: mh };

  // Identity, then the GENOME row: the glyphs of the signed identity in reading order.
  line(item.productId, { cap: L.id.cap, tracking: L.id.tracking, x: L.left, baseline: L.id.baseline });
  const row = genomeLayout(item.genome, 'row');
  const vb = row.viewBox;
  const s = L.genome.glyphMm / (2 * row.glyphRadius);
  // The first glyph's ink, not the layout's margin, aligns with the text above.
  const gx = L.left - (-row.glyphRadius - vb.x) * s;
  const inkRight = gx + (vb.x + vb.w + row.glyphRadius) * s;
  const centreY = L.genome.top - vb.y * s;
  const scene: ArtifactScene = {
    viewBox: vb,
    widthMm: vb.w * s,
    heightMm: vb.h * s,
    ink: INK,
    paper: null,
    primitives: row.primitives,
    strokes: [],
    title: `ORBES GENOME ${item.genome.fingerprint}`,
  };
  line(`${CERTIFICATE_COPY.genome} ${item.genome.fingerprint}`, {
    cap: L.genome.cap,
    tracking: L.genome.tracking,
    x: inkRight + L.genome.gapMm,
    baseline: centreY + L.genome.cap / 2,
  });

  // Model and material: free text, fitted to the value column.
  const rows: readonly [string, string][] = [
    [CERTIFICATE_COPY.model, item.model],
    [CERTIFICATE_COPY.material, item.material],
  ];
  rows.forEach(([label, value], i) => {
    const baseline = L.rows.baselines[i];
    line(label, { cap: L.rows.labelCap, tracking: L.rows.labelTracking, x: L.left, baseline });
    const text = toLabelText(value);
    if (text === '') return;
    const run = fittedRun(text, {
      cap: L.rows.valueCap,
      minCap: L.rows.minValueCap,
      tracking: L.rows.valueTracking,
      x: X(L.rows.valueX),
      baseline: Y(baseline),
      maxWidth: L.right - L.rows.valueX,
    });
    strokes.push(stroked(run));
  });

  strokes.push({ d: `M${fmt(X(L.left))} ${fmt(Y(L.rule.y))}L${fmt(X(L.right))} ${fmt(Y(L.rule.y))}`, width: MIN_STROKE_MM });

  // The three steps, then the one address to trust.
  CERTIFICATE_COPY.steps.forEach((step, i) => {
    const baseline = L.steps.baselines[i];
    line(String(i + 1), { cap: L.steps.cap, tracking: 0, x: L.steps.numberX, baseline });
    line(step, { cap: L.steps.cap, tracking: L.steps.tracking, x: L.steps.textX, baseline });
  });
  line(CERTIFICATE_COPY.verifyOnly, { cap: L.verifyOnly.cap, tracking: L.verifyOnly.tracking, x: L.left, baseline: L.verifyOnly.baseline });

  // The claim code, centred in the panel that covers it.
  line(CERTIFICATE_COPY.claimCode, { cap: L.claim.labelCap, tracking: L.claim.labelTracking, x: L.claim.x, baseline: L.claim.labelBaseline });
  const P = L.panel;
  const codeCap = Math.min(L.code.cap, Math.max(L.code.minCap, (P.w - 2 * L.code.padMm) / measureText(item.claimCode, L.code.tracking)));
  const code = stroked(
    textRun(item.claimCode, { capHeight: codeCap, tracking: L.code.tracking, x: X(P.x + P.w / 2), baseline: Y(P.y + P.h / 2 + codeCap / 2), align: 'middle' }),
  );
  strokes.push(code);

  return {
    genome: { scene, xMm: X(gx), yMm: Y(L.genome.top) },
    monogram: monogramPathData({ x: monogramBox.x, y: monogramBox.y, width: mw }),
    monogramBox,
    strokes,
    panel: roundedRect(X(P.x), Y(P.y), P.w, P.h, P.r),
    panelBox: { x: X(P.x), y: Y(P.y), w: P.w, h: P.h },
    code,
  };
}

function cardPage(widthMm: number, heightMm: number, cards: readonly CertificateCard[], marks: readonly StrokePath[] = []): PdfPage {
  return {
    widthMm,
    heightMm,
    placements: cards.map((c) => c.genome),
    marks: [...cards.flatMap((c) => c.strokes), ...marks],
    markColor: INK,
    // The monograms first, as flat ink; the panels last, over the codes they cover.
    shapes: [
      ...cards.flatMap((c) => c.monogram.map((d) => ({ d, color: INK }))),
      ...cards.map((c) => ({ d: c.panel, color: SCRATCH_OFF_SPOT.name, overprint: true })),
    ],
  };
}

// ── Sheet ──────────────────────────────────────────────────────────────────

/** Placement of `count` cards on A4 sheets of 2 × 5, centred horizontally, 11 mm from the top. */
export function layoutCertificateSheet(count: number): SheetLayout {
  if (!Number.isInteger(count) || count < 1) throw new CertificateInputError('count must be a positive integer');
  const [pw, ph] = SHEET_PAGES[CERTIFICATE_SHEET.page];
  const { columns, rows, marginYmm } = CERTIFICATE_SHEET;
  const { widthMm: w, heightMm: h } = CERTIFICATE_CARD;
  const x0 = (pw - columns * w) / 2;
  const perPage = columns * rows;
  const pages: SheetPlacement[][] = [];
  for (let i = 0; i < count; i++) {
    const slot = i % perPage;
    if (slot === 0) pages.push([]);
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    pages[pages.length - 1].push({ index: i, xMm: x0 + column * w, yMm: marginYmm + row * h, row, column });
  }
  return { pageWidthMm: pw, pageHeightMm: ph, columns, rows, pages };
}

// ── Outputs ────────────────────────────────────────────────────────────────

const PDF_TYPE = 'application/pdf';

/** Cards as a vector PDF: one 85 × 55 mm page per card, or A4 sheets of ten with cut marks and a scale bar. */
export async function renderCertificatePdf(items: readonly CertificateItem[], opts: CertificateOptions): Promise<RenderedCertificates> {
  if (items.length < 1 || items.length > MAX_CERTIFICATE_ITEMS) throw new CertificateInputError(`1 to ${MAX_CERTIFICATE_ITEMS} cards per file`);
  const layout = opts.layout ?? 'card';
  if (!CERTIFICATE_LAYOUTS.includes(layout)) throw new CertificateInputError('layout must be card or sheet');
  const status = opts.status ?? CERTIFICATE_LAYOUT_STATUS;
  const day = opts.createdAt.toISOString().slice(0, 10);
  const proof = status === 'PROOF';
  const { widthMm: cw, heightMm: ch } = CERTIFICATE_CARD;

  let pages: PdfPage[];
  let title: string;
  if (layout === 'card') {
    pages = items.map((it) => cardPage(cw, ch, [layoutCertificateCard(it, status)]));
    title = items.length === 1 ? `ORBES CERTIFICATE CARD ${items[0].productId}` : `ORBES CERTIFICATE CARDS · ${day} · ${items.length} CARDS`;
  } else {
    const sheet = layoutCertificateSheet(items.length);
    const { columns, rows } = CERTIFICATE_SHEET;
    const caption = `ORBES CERTIFICATE CARDS${proof ? ' · PROOF' : ''} · ${day} · ${items.length} CARDS`;
    // The full grid's cut marks on every page: the print shop cuts every sheet the same way.
    const cuts = gridCutMarks(sheet.pages[0][0].xMm, sheet.pages[0][0].yMm, columns, rows, cw, ch);
    pages = sheet.pages.map((placements, pageIndex) =>
      cardPage(
        sheet.pageWidthMm,
        sheet.pageHeightMm,
        placements.map((p) => layoutCertificateCard(items[p.index], status, p.xMm, p.yMm)),
        [cuts, ...sheetFooter(sheet, pageIndex, caption, CERTIFICATE_SHEET.footer)],
      ),
    );
    title = caption;
  }
  const body = await renderPdf(pages, {
    title: proof && layout === 'card' ? `${title} · PROOF` : title,
    subject: `ORBES certificate card${items.length > 1 ? 's' : ''}, claim code under scratch-off${proof ? ' · PROOF, layout not validated by the brand' : ''}`,
    keywords: ['ORBES', 'certificate', ...(proof ? ['PROOF'] : []), ...(items.length === 1 ? [items[0].productId] : [])].join(', '),
    creationDate: opts.createdAt,
    colorMode: 'k-only',
    spotColors: [SCRATCH_OFF_SPOT],
  });
  const suffix = proof ? '-PROOF' : '';
  const filename =
    layout === 'card' && items.length === 1
      ? `ORBES-certificate-${items[0].productId}${suffix}.pdf`
      : `ORBES-certificates-${day}-${items.length}-${layout}${suffix}.pdf`;
  return { contentType: PDF_TYPE, body, filename };
}

export { csvField };

/** Variable-data file for a print shop: productId, model, material, code; UTF-8, CRLF, a header row. */
export function certificatesCsv(items: readonly CertificateItem[]): string {
  return csvDocument([['productId', 'model', 'material', 'code'], ...items.map((it) => [it.productId, it.model, it.material, it.claimCode])]);
}

/**
 * The CSV as a download. Its columns stay those of the print shop's
 * template, so the PROOF mention is in its file name, as for the PDFs.
 */
export function renderCertificateCsv(items: readonly CertificateItem[], opts: Pick<CertificateOptions, 'createdAt' | 'status'>): RenderedCertificates {
  if (items.length < 1 || items.length > MAX_CERTIFICATE_ITEMS) throw new CertificateInputError(`1 to ${MAX_CERTIFICATE_ITEMS} cards per file`);
  for (const it of items) {
    if (!PRODUCT_ID_RE.test(it.productId) || !CLAIM_CODE_RE.test(it.claimCode)) throw new CertificateInputError('invalid certificate item');
  }
  const day = opts.createdAt.toISOString().slice(0, 10);
  const suffix = (opts.status ?? CERTIFICATE_LAYOUT_STATUS) === 'PROOF' ? '-PROOF' : '';
  return { contentType: CSV_CONTENT_TYPE, body: certificatesCsv(items), filename: `ORBES-certificates-${day}-${items.length}${suffix}.csv` };
}

// ── Specimen ───────────────────────────────────────────────────────────────

/**
 * SVG of one card for the brand specimen (BRAND §7): the trimmed card on
 * white with a hairline edge, and the panel in its CMYK alternate, or left
 * off to show the claim code it covers. Not a production file: the PDF
 * carries the spot colour and the overprint a print shop needs.
 */
export function certificateCardSvg(item: CertificateItem, opts: { status?: CertificateLayoutStatus; panel?: boolean } = {}): string {
  const card = layoutCertificateCard(item, opts.status ?? CERTIFICATE_LAYOUT_STATUS);
  const { widthMm: w, heightMm: h } = CERTIFICATE_CARD;
  const g = card.genome;
  const vb = g.scene.viewBox;
  const k = g.scene.widthMm / vb.w;
  const [c, m, y, kk] = SCRATCH_OFF_SPOT.cmyk;
  const channel = (v: number) => Math.round(255 * (1 - v / 100) * (1 - kk / 100));
  const grey = `#${[c, m, y].map((v) => channel(v).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    `<title>ORBES certificate card ${item.productId}</title>`,
    `<rect data-layer="card" x="0.05" y="0.05" width="${fmt(w - 0.1)}" height="${fmt(h - 0.1)}" fill="#FFFFFF" stroke="#C2C2C2" stroke-width="0.1"/>`,
    `<g data-layer="genome" fill="${INK}" transform="matrix(${fmt(k)} 0 0 ${fmt(k)} ${fmt(g.xMm - vb.x * k)} ${fmt(g.yMm - vb.y * k)})">`,
    ...g.scene.primitives.map((p) => `<path d="${primitiveToPathData(p)}"/>`),
    '</g>',
    `<g data-layer="monogram" fill="${INK}">`,
    ...card.monogram.map((d) => `<path d="${d}"/>`),
    '</g>',
    `<g data-layer="lettering" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">`,
    ...card.strokes.map((st) => `<path stroke-width="${fmt(st.width)}" d="${st.d}"/>`),
    '</g>',
    ...(opts.panel === false ? [] : [`<path data-layer="scratch-off" data-spot="${SCRATCH_OFF_SPOT.name}" fill="${grey}" d="${card.panel}"/>`]),
    '</svg>',
    '',
  ].join('\n');
}

// ── Ownership certificate (F-06) ───────────────────────────────────────────

/** The fixed lettering of the ownership certificate (house voice: uppercase, tracked; never AUTHENTIC, never a name). */
export const OWNERSHIP_CERTIFICATE_COPY = Object.freeze({
  title: 'OWNERSHIP CERTIFICATE',
  genome: 'GENOME',
  piece: 'THE PIECE',
  record: 'THE RECORD',
  certificate: 'THIS CERTIFICATE',
  rows: Object.freeze({
    model: 'MODEL',
    type: 'TYPE',
    category: 'CATEGORY',
    collection: 'COLLECTION',
    variant: 'VARIANT',
    material: 'MATERIAL',
    created: 'CREATED',
    discontinued: 'DISCONTINUED',
    ownership: 'OWNERSHIP',
    since: 'SINCE',
    warranty: 'WARRANTY',
    from: 'FROM',
    until: 'UNTIL',
    incidents: 'LOSS OR THEFT',
    status: 'STATUS',
    issued: 'ISSUED',
    validUntil: 'VALID UNTIL',
  }),
  verified: 'VERIFIED',
  unverified: 'REGISTERED · NOT YET VERIFIED',
  noIncident: 'NONE REPORTED',
  warranty: Object.freeze({ NOT_STARTED: 'NOT YET STARTED', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', VOID: 'NO LONGER VALID' }),
  valid: (when: string) => `VALID ON ${when}`,
  statement: Object.freeze([
    'THIS CERTIFICATE ATTESTS WHAT THE ORBES REGISTRY RECORDED ABOUT THIS PIECE ON THE DATE ABOVE.',
    'IT DOES NOT ATTEST THE OBJECT IT IS SHOWN WITH: SCAN THE ORBES CODE OF AN OBJECT TO CHECK IT.',
    'IT NAMES NO OWNER. IT IS NO LONGER VALID ONCE THE PIECE CHANGES HANDS OR A LOSS OR THEFT IS REPORTED.',
  ] as const),
  checkLive: 'CHECK IT LIVE',
  verifyOnly: 'VERIFY ONLY AT THEORBES.COM/VERIFY',
});

/** Page geometry in millimetres (A4 portrait, y down). */
export const OWNERSHIP_CERTIFICATE_LAYOUT = Object.freeze({
  page: 'A4' as const,
  left: 22,
  right: 188,
  brand: { text: 'ORBES', cap: 4, tracking: 0.9, baseline: 30 },
  title: { cap: 1.8, tracking: 0.6, baseline: 37 },
  /** The monogram against the right margin, from the cap line of ORBES (30 − 4) to the title's baseline. */
  monogram: { top: 26, bottom: 37 },
  ruleTop: 46,
  /** The ivory plate of the GENOME, as on screen (BRAND §2.5). */
  plate: { x: 22, y: 54, w: 166, h: 82 },
  genomeLabel: { cap: 1.3, tracking: 0.6, baseline: 63 },
  id: { cap: 5, tracking: 0.3, baseline: 73 },
  /** The glyphs in their orbit around the SEAL, as the screen and the piece show them. */
  orbit: { sizeMm: 44, centreY: 99 },
  fingerprint: { cap: 1.6, tracking: 0.3, baseline: 130 },
  /** Two columns, THE PIECE and THE RECORD: label, then value at `valueOffset`. */
  columns: [22, 110] as const,
  columnWidth: 78,
  valueOffset: 26,
  section: { cap: 1.3, tracking: 0.6, baseline: 150 },
  rows: { first: 158, pitch: 6, labelCap: 1.15, labelTracking: 0.45, valueCap: 1.6, minValueCap: 1.1, valueTracking: 0.25 },
  ruleMiddle: 202,
  certificate: { baseline: 212, first: 220, valueOffset: 30 },
  statement: { cap: 1.3, tracking: 0.25, baselines: [246, 252, 258] as const },
  live: { labelBaseline: 268, addressBaseline: 275, codeBaseline: 282, cap: 1.8, minCap: 1.2, tracking: 0.2 },
  verifyOnly: { cap: 1.2, tracking: 0.35, baseline: 290 },
});

export type WarrantySummaryStatus = keyof typeof OWNERSHIP_CERTIFICATE_COPY.warranty;

/** What the ownership certificate shows: the live record of a VALID certificate (services/ownership-certificates.ts). */
export interface OwnershipCertificateDocument {
  productId: string;
  /** The category's name, e.g. 'Jewelry'. Free text from here on: drawn through toLabelText. */
  category: string;
  collection: string | null;
  model: string;
  type: string;
  variant: string | null;
  material: string;
  createdYear: number;
  genome: Pick<Genome, 'glyphs' | 'version' | 'fingerprint'> | null;
  /** The year its model was discontinued (P-R06): a row DISCONTINUED under CREATED; null or absent while it is not. */
  discontinuedYear?: number | null;
  verified: boolean;
  /** The day the ownership began, 'YYYY-MM-DD' (UTC). */
  since: string;
  warranty: { status: WarrantySummaryStatus; startDate?: string; endDate?: string };
  issuedAt: Date;
  expiresAt: Date;
  /** When the record was read: the PDF's date (CreationDate, file name). */
  checkedAt: Date;
  /** The certificate's live address, `https://host/verify/c#` and its 52-character token. */
  link: string;
}

const LONG_MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** 'YYYY-MM-DD' or a Date → '3 OCTOBER 2026' (UTC). */
function longDate(v: string | Date): string {
  const iso = typeof v === 'string' ? v : v.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m || !LONG_MONTHS[Number(m[2]) - 1]) throw new CertificateInputError('not a date');
  return `${Number(m[3])} ${LONG_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const CERTIFICATE_LINK_RE = /^(https?:\/\/[A-Za-z0-9.:-]{1,253})\/verify\/c#([0-9A-HJKMNP-TV-Z]{52})$/;

/** The lettered form of a certificate's link: its address up to the '#', and its code in groups of four. */
export function certificateLinkLettering(link: string): { address: string; code: string } {
  const m = CERTIFICATE_LINK_RE.exec(link);
  if (!m) throw new CertificateInputError('not a certificate link');
  const host = m[1].replace(/^https?:\/\//, '');
  return { address: toLabelText(`${host}/VERIFY/C#`), code: m[2].match(/.{1,4}/g)!.join('-') };
}

/** The A4 page of an ownership certificate. Throws CertificateInputError on input it cannot draw. */
export function layoutOwnershipCertificate(d: OwnershipCertificateDocument): PdfPage {
  if (!PRODUCT_ID_RE.test(d.productId)) throw new CertificateInputError('not a canonical product id');
  if (d.genome && !FINGERPRINT_RE.test(d.genome.fingerprint)) throw new CertificateInputError('not a genome fingerprint');
  if (!(d.warranty.status in OWNERSHIP_CERTIFICATE_COPY.warranty)) throw new CertificateInputError('unknown warranty status');
  const L = OWNERSHIP_CERTIFICATE_LAYOUT;
  const C = OWNERSHIP_CERTIFICATE_COPY;
  const [pw, ph] = SHEET_PAGES[L.page];
  const live = certificateLinkLettering(d.link);
  const strokes: StrokePath[] = [];
  const line = (text: string, s: LineSpec) => strokes.push(stroked(textRun(text, { capHeight: s.cap, tracking: s.tracking, x: s.x, baseline: s.baseline, align: s.align ?? 'start' })));
  const fitted = (text: string, s: LineSpec & { minCap: number; maxWidth: number }) => {
    const t = toLabelText(text);
    if (t !== '') strokes.push(stroked(fittedRun(t, s)));
  };
  const centre = pw / 2;

  // Header: the word, OWNERSHIP CERTIFICATE under it, the monogram at the right margin, a hairline.
  line(L.brand.text, { cap: L.brand.cap, tracking: L.brand.tracking, x: L.left, baseline: L.brand.baseline });
  line(C.title, { cap: L.title.cap, tracking: L.title.tracking, x: L.left, baseline: L.title.baseline });
  const mh = L.monogram.bottom - L.monogram.top;
  const mw = (mh * MONOGRAM_BOUNDS.w) / MONOGRAM_BOUNDS.h;
  const monogram = monogramPathData({ x: L.right - mw, y: L.monogram.top, width: mw });
  const rule = (y: number) => strokes.push({ d: `M${fmt(L.left)} ${fmt(y)}L${fmt(L.right)} ${fmt(y)}`, width: MIN_STROKE_MM });
  rule(L.ruleTop);

  // The plate: GENOME, the product id, the glyphs in their orbit around the SEAL, the fingerprint.
  const P = L.plate;
  line(C.genome, { cap: L.genomeLabel.cap, tracking: L.genomeLabel.tracking, x: centre, baseline: L.genomeLabel.baseline, align: 'middle' });
  line(d.productId, { cap: L.id.cap, tracking: L.id.tracking, x: centre, baseline: L.id.baseline, align: 'middle' });
  const placements: PdfPlacement[] = [];
  if (d.genome) {
    const orbit = genomeLayout(d.genome, 'orbit');
    const vb = orbit.viewBox;
    const scene: ArtifactScene = {
      viewBox: vb,
      widthMm: L.orbit.sizeMm,
      heightMm: (L.orbit.sizeMm * vb.h) / vb.w,
      ink: ORBES_CODE_STYLES.ivory.ink,
      paper: null,
      primitives: orbit.primitives,
      strokes: [],
      title: `ORBES GENOME ${d.genome.fingerprint}`,
    };
    placements.push({ scene, xMm: centre - scene.widthMm / 2, yMm: L.orbit.centreY - scene.heightMm / 2 });
    line(`${d.genome.fingerprint} · GENOME-${String(d.genome.version).padStart(2, '0')}`, {
      cap: L.fingerprint.cap,
      tracking: L.fingerprint.tracking,
      x: centre,
      baseline: L.fingerprint.baseline,
      align: 'middle',
    });
  }

  // Two columns of rows: the piece, and what the registry records about it.
  const R = L.rows;
  const column = (x: number, title: string, rows: readonly (readonly [string, string])[]) => {
    line(title, { cap: L.section.cap, tracking: L.section.tracking, x, baseline: L.section.baseline });
    rows.forEach(([label, value], i) => {
      const baseline = R.first + i * R.pitch;
      line(label, { cap: R.labelCap, tracking: R.labelTracking, x, baseline });
      fitted(value, { cap: R.valueCap, minCap: R.minValueCap, tracking: R.valueTracking, x: x + L.valueOffset, baseline, maxWidth: L.columnWidth - L.valueOffset });
    });
  };
  const piece: [string, string][] = [
    [C.rows.model, d.model],
    [C.rows.type, d.type],
    [C.rows.category, d.category],
    ...(d.collection ? [[C.rows.collection, d.collection] as [string, string]] : []),
    ...(d.variant ? [[C.rows.variant, d.variant] as [string, string]] : []),
    [C.rows.material, d.material],
    [C.rows.created, String(d.createdYear)],
    ...(d.discontinuedYear ? [[C.rows.discontinued, String(d.discontinuedYear)] as [string, string]] : []),
  ];
  const record: [string, string][] = [
    [C.rows.ownership, d.verified ? C.verified : C.unverified],
    [C.rows.since, longDate(d.since)],
    [C.rows.warranty, C.warranty[d.warranty.status]],
    ...(d.warranty.startDate ? [[C.rows.from, longDate(d.warranty.startDate)] as [string, string]] : []),
    ...(d.warranty.endDate ? [[C.rows.until, longDate(d.warranty.endDate)] as [string, string]] : []),
    [C.rows.incidents, C.noIncident],
  ];
  column(L.columns[0], C.piece, piece);
  column(L.columns[1], C.record, record);
  rule(L.ruleMiddle);

  // This certificate: valid when, issued, until; what it attests; its live address.
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = d.checkedAt;
  const certificate: [string, string][] = [
    [C.rows.status, C.valid(`${longDate(at)} · ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`)],
    [C.rows.issued, longDate(d.issuedAt)],
    [C.rows.validUntil, longDate(d.expiresAt)],
  ];
  line(C.certificate, { cap: L.section.cap, tracking: L.section.tracking, x: L.left, baseline: L.certificate.baseline });
  certificate.forEach(([label, value], i) => {
    const baseline = L.certificate.first + i * R.pitch;
    line(label, { cap: R.labelCap, tracking: R.labelTracking, x: L.left, baseline });
    line(value, { cap: R.valueCap, tracking: R.valueTracking, x: L.left + L.certificate.valueOffset, baseline });
  });
  C.statement.forEach((text, i) =>
    strokes.push(stroked(fittedRun(text, { cap: L.statement.cap, minCap: L.statement.cap * 0.8, tracking: L.statement.tracking, x: L.left, baseline: L.statement.baselines[i], maxWidth: L.right - L.left }))),
  );
  const V = L.live;
  line(C.checkLive, { cap: L.section.cap, tracking: L.section.tracking, x: L.left, baseline: V.labelBaseline });
  strokes.push(stroked(fittedRun(live.address, { cap: V.cap, minCap: V.minCap, tracking: V.tracking, x: L.left, baseline: V.addressBaseline, maxWidth: L.right - L.left })));
  strokes.push(stroked(fittedRun(live.code, { cap: V.cap, minCap: V.minCap, tracking: V.tracking, x: L.left, baseline: V.codeBaseline, maxWidth: L.right - L.left })));
  line(C.verifyOnly, { cap: L.verifyOnly.cap, tracking: L.verifyOnly.tracking, x: L.left, baseline: L.verifyOnly.baseline });

  const top = V.addressBaseline - V.cap - 1;
  return {
    widthMm: pw,
    heightMm: ph,
    placements,
    marks: strokes,
    markColor: INK,
    fills: [{ d: `M${fmt(P.x)} ${fmt(P.y)}L${fmt(P.x + P.w)} ${fmt(P.y)}L${fmt(P.x + P.w)} ${fmt(P.y + P.h)}L${fmt(P.x)} ${fmt(P.y + P.h)}Z`, color: ORBES_CODE_STYLES.ivory.paper }],
    shapes: monogram.map((m) => ({ d: m, color: INK })),
    links: [{ xMm: L.left, yMm: top, wMm: L.right - L.left, hMm: V.codeBaseline + 1 - top, url: d.link }],
  };
}

/** The ownership certificate as a one-page A4 PDF (RGB: a document, not a print run). Deterministic for one input. */
export async function renderOwnershipCertificatePdf(d: OwnershipCertificateDocument): Promise<RenderedCertificates> {
  const page = layoutOwnershipCertificate(d);
  const day = d.checkedAt.toISOString().slice(0, 10);
  const body = await renderPdf([page], {
    title: `ORBES OWNERSHIP CERTIFICATE ${d.productId}`,
    subject: `The ORBES record of ${d.productId} on ${day}. It attests a record, not the object it is shown with.`,
    keywords: ['ORBES', 'ownership certificate', d.productId].join(', '),
    creationDate: d.checkedAt,
  });
  return { contentType: PDF_TYPE, body, filename: `ORBES-ownership-certificate-${d.productId}-${day}.pdf` };
}
