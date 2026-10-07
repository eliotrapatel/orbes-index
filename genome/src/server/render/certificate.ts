/**
 * ORBES certificate card: the card 79t, MINT CERTIFICATE, delivered in the
 * box with a piece (plan NEXT LOT §3.2, validated by the owner on 2026-10-07:
 * « parfait je valide celui là »), as one 95 × 62 mm page per card or A4
 * sheets of eight for print runs. One side; the back is blank. Card
 * millimetres, y down:
 *
 *   ┌──────────────────── MINT CERTIFICATE ────────────────────┐
 *   │  ╭────────────╮   ORBES                        ╭─────╮   │
 *   │  │            │   O26-J-00184                  │ ORB │   │  the monogram in guilloche,
 *   │  │   ORBES    │   ○ · ◠ · ◝ · …                ╰─────╯   │  the year layered on it
 *   │  │   CODE     │   GENOME G1-E1DC-BE52                    │
 *   │  │            │   MONOLITHE · BRACELET                   │  the piece's three lines
 *   │  ╰────────────╯   BLUE  ·  SIZE 17                       │
 *   │                   925 STERLING SILVER                    │
 *   │  1 SCAN THE ORBES CODE                CLAIM CODE · KEEP… │
 *   │  2 ENTER THE CLAIM CODE               ────────────────── │
 *   │  3 THE PIECE IS REGISTERED TO YOU     7MSE-SK34-PWMC     │
 *   └──────────── VERIFY ONLY AT VERIFY.THEORBES.COM ──────────┘
 *
 * The card carries the ORBES CODE and the claim code, both visible, on one
 * side (owner, 2026-10-07): there is no scratch-off panel, and whoever holds
 * the card can register the piece. A scan of the card proves the card that
 * came with the piece, not the metal itself.
 *
 * Everything is geometry. The type is drawn as glyph outlines (./card-text.ts
 * from ./card-type.ts: Gravesend Sans 500, Helvetica Neue Light and Regular),
 * the ORBES CODE and the GENOME row from the core's primitives, the monogram
 * from its master outlines (core/render/monogram.ts) filled with the
 * guilloche (./guilloche.ts). No font is ever written, so the claim code is
 * never text: it cannot be searched or copied out of the file. Black is K
 * only (DeviceCMYK); the guilloche's two warm greys print as the K tints of
 * the same lightness (K 5.9 and K 29.8), the code's decor keeps its tints,
 * the stock is never inked, and there is no spot colour.
 *
 * Every position is CARD_79T's, taken from the results of 79t's build.py
 * (.claude/orbes-run/card-79t/79t-mint/build.py, committed with its assets
 * and its front.png under test/fixtures/card-79t/); only the piece's data
 * changes from one card to the next.
 *
 * The data file for variable-data printing (CSV) holds the card's fields
 * except the ORBES CODE and the GENOME, which a print shop cannot typeset.
 *
 * CERTIFICATE_LAYOUT_STATUS is VALIDATED. The PROOF machinery stays for a
 * future layout: a PROOF card says PROOF · LAYOUT NOT VALIDATED in its top
 * rule, in MINT CERTIFICATE's place, and its sheets and file names say PROOF.
 *
 * The same lettering, GENOME geometry and monogram draw the OWNERSHIP
 * CERTIFICATE (F-06, `renderOwnershipCertificatePdf`, at the end of this
 * file): the A4 page a piece's owner shares with a buyer or an insurer, the
 * PDF of the live record at `/verify/c#…` (services/ownership-certificates.ts).
 * It names no owner, never says AUTHENTIC (it attests a record, not the
 * object it is shown with) and carries its live address, lettered and as a
 * link, so whoever holds the page can check that it is still valid. The same
 * page names an order instead of a live address for the certificate among an
 * order's documents in MY PIECES (plan LIVE RELEASE+, M6): a new document for
 * the piece's registered buyer, never its claim card. The invoices and credit
 * notes (./invoice.ts) are lettered with the same helpers.
 */
import { encodeOrbesCode } from '../../core/code/encoder.js';
import { ORBES_CODE_STYLES } from '../../core/code/styles.js';
import { CODE01_SIZE } from '../../core/code/profile.js';
import { TAU, type Primitive } from '../../core/geometry.js';
import { genomeLayout } from '../../core/genome/render.js';
import type { Genome } from '../../core/genome/genome.js';
import { MONOGRAM_BOUNDS, monogramHeight, monogramPathData } from '../../core/render/monogram.js';
import { primitiveToPathData } from '../../core/render/svg.js';
import { cardRun, cardText, digitParts, type CardRun } from './card-text.js';
import { guillochePath, GUILLOCHE_79T } from './guilloche.js';
import { measureText, textRun, toLabelText, type TextRun } from './label-font.js';
import { csvDocument, csvField, CSV_CONTENT_TYPE } from './csv.js';
import { renderPdf, type PdfLayer, type PdfPage, type PdfPlacement } from './pdf.js';
import { gridCutMarks, sheetFooter, SHEET_PAGES, type SheetLayout, type SheetPlacement } from './print-sheet.js';
import { mixTone, type ArtifactScene, type StrokePath } from './scene.js';

export type CertificateLayoutStatus = 'PROOF' | 'VALIDATED';

/**
 * The brand's sign-off of the card layout: VALIDATED since the owner validated 79t on 2026-10-07 (« parfait je
 * valide celui là », plan NEXT LOT §3.2). The physical proof (the box, the printer, a sheet cut and scanned) is a
 * check before the first customer card (§7), not a condition of this constant.
 */
export const CERTIFICATE_LAYOUT_STATUS: CertificateLayoutStatus = 'VALIDATED';

export type CertificateFormat = 'pdf' | 'csv';
export type CertificateLayout = 'card' | 'sheet';
export const CERTIFICATE_FORMATS: readonly CertificateFormat[] = ['pdf', 'csv'];
export const CERTIFICATE_LAYOUTS: readonly CertificateLayout[] = ['card', 'sheet'];

/** Cards per request: each costs one scrypt check of its claim code before anything is drawn. */
export const MAX_CERTIFICATE_ITEMS = 50;

export const CERTIFICATE_CARD = Object.freeze({
  widthMm: 95,
  heightMm: 62,
  /** Nothing is drawn closer than this to a trimmed edge: the rule's outer edge (5.25 − 0.1125 / 2, floored). */
  safeMm: 5.19,
});

/**
 * A4 sheet: 2 × 4 abutting cards (no gutter, cut on shared edges), the grid centred: 10 mm left and right, 24.5 mm
 * top and bottom. The footer, the caption then '10 MM' and the scale bar on one line, sits at 284 mm: under the cut
 * marks (which end at 276.5 mm) and 12 mm clear of the bottom edge an office printer may not print. The bar ends
 * short of the x = 200 mm cut line.
 */
export const CERTIFICATE_SHEET = Object.freeze({
  page: 'A4' as const,
  columns: 2,
  rows: 4,
  marginYmm: 24.5,
  footer: Object.freeze({ centerYmm: 284, barRightMm: 186, barLabel: 'before' as const }),
});

/**
 * The card's fixed copy (house voice: uppercase, tracked), word for word as 79t sets it. The steps and the line
 * under the card are the packaging kit's too (docs/launch/PACKAGING-KIT.md), as test/docs/packaging-kit.test.ts
 * checks: step 1 names the ORBES CODE, what the buyer scans, not the SEAL, its finder (BRAND §2.1).
 */
export const CERTIFICATE_COPY = Object.freeze({
  title: 'MINT CERTIFICATE',
  brand: 'ORBES',
  genome: 'GENOME',
  steps: Object.freeze(['SCAN THE ORBES CODE', 'ENTER THE CLAIM CODE', 'THE PIECE IS REGISTERED TO YOU'] as const),
  claimCode: 'CLAIM CODE · KEEP IT PRIVATE',
  verifyOnly: 'VERIFY ONLY AT VERIFY.THEORBES.COM',
  proof: 'PROOF · LAYOUT NOT VALIDATED',
});

export interface CertificateItem {
  /** Canonical product id, e.g. O26-J-00184. */
  productId: string;
  /** Line 1 as recorded: the model's name and type, e.g. 'MONOLITHE · BRACELET' (free text: drawn through toLabelText). */
  model: string;
  /** The model's label among its variants (models.variant_label, e.g. 'Blue'), or null. */
  modelVariant: string | null;
  /** The piece's Size field (products.variant, e.g. '17'), or null. */
  size: string | null;
  /** Material as recorded (free text: drawn through toLabelText). */
  material: string;
  /** The year of the piece's ORBES identity (products.year, the 26 of O26), printed in the monogram. */
  year: number;
  genome: Pick<Genome, 'glyphs' | 'version' | 'fingerprint'>;
  /** The piece's ACTIVE code: its framed data (frameCodeData(payload, signature)) and its issue. */
  code: { data: Uint8Array; issue: number };
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

// ── Shared lettering helpers (the ownership certificate and the invoices) ──

/** The ink of every card and document (black on white). */
export const INK = '#0A0A0A';
/** Hairline floor: thinner strokes do not survive a print shop's plate (0.1 mm ≈ 0.28 pt). */
export const MIN_STROKE_MM = 0.1;
const CROCKFORD_GROUP = '[0-9A-HJKMNP-TV-Z]{4}';
const CLAIM_CODE_RE = new RegExp(`^${CROCKFORD_GROUP}-${CROCKFORD_GROUP}-${CROCKFORD_GROUP}$`);
const PRODUCT_ID_RE = /^O\d{2}-[A-Z]-\d{5,6}$/;
const FINGERPRINT_RE = /^G\d+-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** A coordinate in millimetres for path data: three decimals at most. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new CertificateInputError('non-finite coordinate');
  const s = n.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** A run of lettering as a stroked path, never thinner than the hairline floor. */
export const stroked = (run: TextRun): StrokePath => ({ d: run.d, width: Math.max(run.strokeWidth, MIN_STROKE_MM) });

export interface LineSpec {
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
export function fittedRun(text: string, spec: LineSpec & { minCap: number; maxWidth: number }): TextRun {
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

// ── The card 79t ───────────────────────────────────────────────────────────

/** K tint of the same lightness as a colour: K = round((1 − mean(R, G, B) / 255) × 100, 1) (plan §3.2). */
export function kTintOf(color: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new CertificateInputError('a colour is #rrggbb');
  const mean = (parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16)) / 3;
  return Math.round((1 - mean / 255) * 1000) / 10;
}

/**
 * The card 79t in card millimetres, from the top-left corner: build.py's results (gutter 5.734, column 48.01 to
 * 81.27, rhythm 5.41, monogram 13.0 × 9.93 from 17.47 to 27.40, year 7.76 wide). Sizes are font sizes (the em) in
 * mm; tracking is in ems; baselines are y in mm.
 */
export const CARD_79T = Object.freeze({
  widthMm: 95,
  heightMm: 62,
  /** The stock, as the specimen shows it on screen. It is never inked: the PDF draws no ground. */
  stock: '#FBFBF9',
  ink: INK,
  /** Every mark but the rule and its two legends stays this far inside the trim. */
  boundMm: 8,
  /** One fine rule, mitred, cut round MINT CERTIFICATE (top) and VERIFY ONLY AT … (bottom), 1.4 mm of white each side of their ink. */
  rule: Object.freeze({ insetMm: 5.25, width: 0.1125, legendGapMm: 1.4 }),
  /** Both legends: Gravesend, unkerned, centred on the rule, their caps' middle on it. */
  legend: Object.freeze({ size: 1.0, tracking: 0.24 }),
  /** The ORBES CODE: a 32 mm box, its ring 11.5 mm in, moved 0.748 mm left so its ink lines up with the step numbers. */
  code: Object.freeze({ x: 10.1376, y: 10.8856, sizeMm: 32 }),
  /** The steps, flush left on the ring's left edge: the numbers in Helvetica Neue Regular at Gravesend's cap height, centred on their own measure. */
  steps: Object.freeze({
    numberCentreX: 11.725909243697479,
    textX: 13.301818487394958,
    size: 1.05,
    tracking: 0.2,
    baselines: Object.freeze([47.14, 48.82, 50.5] as const),
  }),
  /** The right column: the claim code's measure, with equal air to the ring and to the 8 mm bound. */
  column: Object.freeze({ x0: 48.0052875, x1: 81.2659125 }),
  brand: Object.freeze({ size: 2.0, tracking: 0.62, baseline: 12.78 }),
  serial: Object.freeze({ size: 2.2, tracking: 0.05, baseline: 19.761076165108733 }),
  /**
   * The GENOME row at one fixed scale on every card (mm per row unit: 79t's 15.35 mm GENOME line over its row's
   * 25.43 units), its glyphs' centre line, then GENOME and the fingerprint (Gravesend 1.0, the fingerprint in
   * Helvetica Neue Regular).
   */
  genome: Object.freeze({ rowScale: 0.6037826697825291, rowCentreY: 25.775135000000003, baseline: 28.268917669782528, size: 1.0, tracking: 0.24 }),
  /** The piece's three lines: Gravesend 1.2 (down to 1.0 to fit, then cut with '...'), tracked 0.2, pitch 1.95. */
  piece: Object.freeze({ size: 1.2, minSize: 1.0, tracking: 0.2, firstBaseline: 34.447193834891266, pitch: 1.95 }),
  /** CLAIM CODE · KEEP IT PRIVATE and its 0.1 mm line (both 0.5 mm lower than the rhythm put them), then the code. */
  claim: Object.freeze({
    labelBaseline: 44.89747,
    labelSize: 1.0,
    labelTracking: 0.24,
    lineY: 45.84747,
    lineWidth: 0.1,
    codeSize: 3.645,
    codeTracking: 0.032,
    codeBaseline: 50.5,
  }),
  /** The monogram: 13.0 mm wide by MONOGRAM_BOUNDS, its right edge on the column's, centred between the serial's ink top and the glyphs' foot. */
  monogram: Object.freeze({ width: 13.0, centreX: 74.7659125, centreY: 22.438096917445634 }),
  /** The guilloche: a ground and two families of waves, in two warm greys printed as K tints of their lightness. */
  guilloche: Object.freeze({
    ground: '#F1F1EE',
    groundK: 5.9,
    line: '#B4B4B1',
    lineK: 29.8,
    lineWidth: 0.06,
    /** The ground and the waves reach this far past the monogram's box, clipped to its outline. */
    padMm: 0.6,
    ...GUILLOCHE_79T,
  }),
  /** The year: Gravesend 2.4, tracked 0.40, unkerned, centred on the monogram, cut out of it by a halo of bare stock. */
  year: Object.freeze({ size: 2.4, tracking: 0.4, haloMm: 0.165, bandMm: 3 }),
});

/** Gravesend's cap height over its em (0.640). */
const G_CAP = 0.64;

/** One card laid out: its layers (in order) and its scenes, in page millimetres. */
export interface CertificateCard {
  /** Filled outlines, stroked rules and clipped groups, in drawing order. */
  layers: PdfLayer[];
  /** The ORBES CODE, then the GENOME row: scenes placed in page millimetres. */
  placements: PdfPlacement[];
  /** Where things went, page millimetres (for checks and the specimen). */
  boxes: {
    card: { x: number; y: number; w: number; h: number };
    code: { x: number; y: number; w: number; h: number };
    monogram: { x: number; y: number; w: number; h: number };
    year: { left: number; right: number; baseline: number };
    claimCode: { left: number; right: number; baseline: number };
    serial: { left: number; right: number };
    /** The piece's lines as drawn: their text, size, baseline and ink. */
    lines: { text: string; size: number; baseline: number; left: number; right: number }[];
    /** The rule's legends: the top one's text (MINT CERTIFICATE or PROOF · …) and each one's ink. */
    legends: { text: string; left: number; right: number; y: number }[];
  };
}

/** The size as the card prints it, by the app's rule (pieceLines): SIZE 17; a value with its word, or ONE SIZE, as written. */
export function sizeLabel(size: string | null): string {
  const s = toLabelText(size ?? '');
  if (s === '') return '';
  return /^SIZE\b/.test(s) || s === 'ONE SIZE' ? s : `SIZE ${s}`;
}

/** Line 2 as printed: the variant and the size, two spaces each side of the dot; either alone; '' with neither. */
export function variantLine(item: Pick<CertificateItem, 'modelVariant' | 'size'>): string {
  return [toLabelText(item.modelVariant ?? ''), sizeLabel(item.size)].filter((s) => s !== '').join('  ·  ');
}

/** A piece's line in the column: Gravesend with Helvetica digits, shrunk to fit, then cut with '...'. */
function pieceRun(text: string, x: number, baseline: number): { run: CardRun; text: string; size: number } {
  const P = CARD_79T.piece;
  const maxWidth = CARD_79T.column.x1 - CARD_79T.column.x0;
  // The width as drawn (kerned) at size 1: everything in the run scales with the size.
  const widthAt1 = (t: string) => {
    const r = cardRun(digitParts(t), { x: 0, baseline: 0, size: 1, tracking: P.tracking });
    return Math.max(r.inkRight, r.drawnRight) - r.inkLeft;
  };
  let t = text;
  const fit = maxWidth / widthAt1(t);
  let size = Math.min(P.size, fit);
  if (fit < P.minSize) {
    size = P.minSize;
    const chars = [...t];
    while (widthAt1(t) * size > maxWidth && chars.length > 0) {
      chars.pop();
      t = `${chars.join('').trimEnd()}...`;
    }
  }
  return { run: cardRun(digitParts(t), { x, baseline, size, tracking: P.tracking }), text: t, size };
}

const hasHole = (p: Primitive): boolean =>
  p.kind === 'ring' ? p.r - p.width / 2 > 0 : p.kind === 'arc' ? p.end - p.start >= TAU - 1e-9 && p.r - p.width / 2 > 0 : false;

/** Lay out one card with its top-left corner at (ox, oy) page millimetres. Throws CertificateInputError on input it cannot draw. */
export function layoutCertificateCard(item: CertificateItem, status: CertificateLayoutStatus, ox = 0, oy = 0): CertificateCard {
  if (!PRODUCT_ID_RE.test(item.productId)) throw new CertificateInputError('not a canonical product id');
  if (!CLAIM_CODE_RE.test(item.claimCode)) throw new CertificateInputError('a claim code is XXXX-XXXX-XXXX in canonical Crockford');
  if (!FINGERPRINT_RE.test(item.genome.fingerprint)) throw new CertificateInputError('not a genome fingerprint');
  if (!Number.isInteger(item.year) || item.year < 1000 || item.year > 9999) throw new CertificateInputError('a year has four digits');
  if (!item.code || !(item.code.data instanceof Uint8Array) || !Number.isInteger(item.code.issue)) throw new CertificateInputError('a card needs its ORBES CODE');
  const C = CARD_79T;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + y;
  const layers: PdfLayer[] = [];
  const ink = (d: string) => {
    if (d !== '') layers.push({ kind: 'fill', d, color: INK });
  };

  // The monogram, filled with the guilloche: a ground, then the waves, clipped to its outlines (non-zero).
  const M = C.monogram;
  const G = C.guilloche;
  const mh = monogramHeight(M.width);
  const mx = M.centreX - M.width / 2;
  const my = M.centreY - mh / 2;
  const outlines = monogramPathData({ x: X(mx), y: Y(my), width: M.width }).join('');
  const rect = (x0: number, y0: number, x1: number, y1: number) => `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}L${fmt(x0)} ${fmt(y1)}Z`;
  const textured = (clip: string, box: { x0: number; x1: number; y0: number; y1: number }): PdfLayer => ({
    kind: 'clip',
    clip,
    items: [
      { kind: 'fill', d: rect(X(box.x0), Y(box.y0), X(box.x1), Y(box.y1)), color: G.ground, k: G.groundK },
      // Waves anchored on the card (its own x and the pitch grid from its own top), so every card's lattice is the same.
      { kind: 'stroke', d: shiftPath(guillochePath(box, M.centreX, G), ox, oy), width: G.lineWidth, cap: 'round', join: 'round', color: G.line, k: G.lineK },
    ],
  });
  layers.push(textured(outlines, { x0: mx - G.padMm, x1: mx + M.width + G.padMm, y0: my - G.padMm, y1: my + mh + G.padMm }));

  // The year on it, in the same guilloche, cut out of the monogram by a halo of bare stock.
  const Yr = C.year;
  const year = cardText(String(item.year), { face: 'gravesend', size: Yr.size, tracking: Yr.tracking, kerning: false, x: X(M.centreX), baseline: Y(M.centreY + (Yr.size * G_CAP) / 2), align: 'middle' });
  layers.push({ kind: 'stroke', d: year.d, width: 2 * Yr.haloMm, cap: 'round', join: 'round', color: C.stock, k: 0 });
  layers.push({ kind: 'fill', d: year.d, color: C.stock, k: 0 });
  // tex.py fills a band of the monogram's width, 3 mm each side of its middle; the waves only show inside the year, so
  // they are drawn over the year's ink box alone (anchored as before: the same lattice, a smaller file).
  const yearTop = M.centreY - (Yr.size * G_CAP) / 2;
  const reach = G.amplitude + G.lineWidth;
  layers.push(
    textured(year.d, {
      x0: Math.max(M.centreX - M.width / 2, year.inkLeft - ox - reach),
      x1: Math.min(M.centreX + M.width / 2, year.inkRight - ox + reach),
      y0: Math.max(M.centreY - Yr.bandMm, yearTop - 0.1 - reach),
      y1: Math.min(M.centreY + Yr.bandMm, yearTop + Yr.size * G_CAP + 0.1 + reach),
    }),
  );

  // The rule, cut round its two legends.
  const R = C.rule;
  const L = C.legend;
  const top = status === 'PROOF' ? CERTIFICATE_COPY.proof : CERTIFICATE_COPY.title;
  const legend = (text: string, y: number) =>
    cardText(text, { face: 'gravesend', size: L.size, tracking: L.tracking, kerning: false, x: X(C.widthMm / 2), baseline: Y(y + (L.size * G_CAP) / 2), align: 'middle' });
  const legendTop = legend(top, R.insetMm);
  const legendBottom = legend(CERTIFICATE_COPY.verifyOnly, C.heightMm - R.insetMm);
  const gt = (legendTop.inkRight - legendTop.inkLeft) / 2 + R.legendGapMm;
  const gb = (legendBottom.inkRight - legendBottom.inkLeft) / 2 + R.legendGapMm;
  const [x0, x1, y0, y1, mid] = [X(R.insetMm), X(C.widthMm - R.insetMm), Y(R.insetMm), Y(C.heightMm - R.insetMm), X(C.widthMm / 2)];
  layers.push({
    kind: 'stroke',
    d: `M${fmt(mid - gt)} ${fmt(y0)}L${fmt(x0)} ${fmt(y0)}L${fmt(x0)} ${fmt(y1)}L${fmt(mid - gb)} ${fmt(y1)}M${fmt(mid + gb)} ${fmt(y1)}L${fmt(x1)} ${fmt(y1)}L${fmt(x1)} ${fmt(y0)}L${fmt(mid + gt)} ${fmt(y0)}`,
    width: R.width,
    cap: 'butt',
    join: 'miter',
    color: INK,
  });
  ink(legendTop.d);
  ink(legendBottom.d);

  // The steps.
  const S = C.steps;
  const numberSize = (S.size * G_CAP) / 0.714;
  CERTIFICATE_COPY.steps.forEach((step, i) => {
    ink(cardText(String(i + 1), { face: 'regular', size: numberSize, tracking: 0, x: X(S.numberCentreX), baseline: Y(S.baselines[i]), align: 'middle' }).d);
    ink(cardText(step, { face: 'gravesend', size: S.size, tracking: S.tracking, x: X(S.textX), baseline: Y(S.baselines[i]) }).d);
  });

  // The claim: its line, the code centred on the column, its label.
  const K = C.claim;
  const col = C.column;
  layers.push({ kind: 'stroke', d: `M${fmt(X(col.x0))} ${fmt(Y(K.lineY))}L${fmt(X(col.x1))} ${fmt(Y(K.lineY))}`, width: K.lineWidth, cap: 'butt', join: 'miter', color: INK });
  const claim = cardText(item.claimCode, { face: 'light', size: K.codeSize, tracking: K.codeTracking, x: X((col.x0 + col.x1) / 2), baseline: Y(K.codeBaseline), align: 'middle' });
  ink(claim.d);
  ink(cardText(CERTIFICATE_COPY.claimCode, { face: 'gravesend', size: K.labelSize, tracking: K.labelTracking, x: X(col.x0), baseline: Y(K.labelBaseline) }).d);

  // The column: ORBES, the serial, the GENOME row and its line, the piece's lines.
  ink(cardText(CERTIFICATE_COPY.brand, { face: 'gravesend', size: C.brand.size, tracking: C.brand.tracking, x: X(col.x0), baseline: Y(C.brand.baseline) }).d);
  const serial = cardText(item.productId, { face: 'light', size: C.serial.size, tracking: C.serial.tracking, x: X(col.x0), baseline: Y(C.serial.baseline) });
  ink(serial.d);
  const Gn = C.genome;
  ink(
    cardRun(
      [
        { text: `${CERTIFICATE_COPY.genome} `, face: 'gravesend' },
        { text: item.genome.fingerprint, face: 'regular' },
      ],
      { x: X(col.x0), baseline: Y(Gn.baseline), size: Gn.size, tracking: Gn.tracking },
    ).d,
  );
  const P = C.piece;
  // Without a variant and a size, line 2 is left out and the material moves up one pitch; the claim block never moves.
  const second = variantLine(item);
  const shown = second === '' ? [toLabelText(item.model), toLabelText(item.material)] : [toLabelText(item.model), second, toLabelText(item.material)];
  const lines: CertificateCard['boxes']['lines'] = [];
  for (const [slot, text] of shown.entries()) {
    if (text === '') continue;
    const baseline = P.firstBaseline + slot * P.pitch;
    const fitted = pieceRun(text, X(col.x0), Y(baseline));
    ink(fitted.run.d);
    lines.push({ text: fitted.text, size: fitted.size, baseline: Y(baseline), left: fitted.run.inkLeft, right: Math.max(fitted.run.inkRight, fitted.run.drawnRight) });
  }

  // The ORBES CODE, flat K on bare stock (its decor in its own tints), and the GENOME row.
  const model = encodeOrbesCode({ data: item.code.data, genomeGlyphs: item.genome.glyphs }, { decor: true });
  const half = CODE01_SIZE / 2;
  const codeScene: ArtifactScene = {
    viewBox: { x: -half, y: -half, w: CODE01_SIZE, h: CODE01_SIZE },
    widthMm: C.code.sizeMm,
    heightMm: C.code.sizeMm,
    ink: INK,
    paper: null,
    primitives: model.primitives,
    strokes: [],
    title: `ORBES CODE ${item.productId}`,
  };
  const row = genomeLayout(item.genome, 'row');
  const vb = row.viewBox;
  const s = Gn.rowScale;
  const genomeScene: ArtifactScene = {
    viewBox: vb,
    widthMm: vb.w * s,
    heightMm: vb.h * s,
    ink: INK,
    paper: null,
    primitives: row.primitives,
    strokes: [],
    title: `ORBES GENOME ${item.genome.fingerprint}`,
  };
  const placements: PdfPlacement[] = [
    { scene: codeScene, xMm: X(C.code.x), yMm: Y(C.code.y) },
    // The first glyph's ink (its centre one glyph radius in) on the column's edge.
    { scene: genomeScene, xMm: X(col.x0 + row.glyphRadius * s + vb.x * s), yMm: Y(Gn.rowCentreY + vb.y * s) },
  ];

  return {
    layers,
    placements,
    boxes: {
      card: { x: ox, y: oy, w: C.widthMm, h: C.heightMm },
      code: { x: X(C.code.x), y: Y(C.code.y), w: C.code.sizeMm, h: C.code.sizeMm },
      monogram: { x: X(mx), y: Y(my), w: M.width, h: mh },
      year: { left: year.inkLeft, right: year.inkRight, baseline: Y(M.centreY + (Yr.size * G_CAP) / 2) },
      claimCode: { left: claim.inkLeft, right: claim.inkRight, baseline: Y(K.codeBaseline) },
      serial: { left: serial.inkLeft, right: Math.max(serial.inkRight, serial.drawnRight) },
      lines,
      legends: [
        { text: top, left: legendTop.inkLeft, right: legendTop.inkRight, y: y0 },
        { text: CERTIFICATE_COPY.verifyOnly, left: legendBottom.inkLeft, right: legendBottom.inkRight, y: y1 },
      ],
    },
  };
}

/** Path data (absolute M L C numbers) moved by (dx, dy). */
function shiftPath(d: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return d;
  let i = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (n) => fmt(Number(n) + (i++ % 2 === 0 ? dx : dy)));
}

function cardPage(widthMm: number, heightMm: number, cards: readonly CertificateCard[], marks: readonly StrokePath[] = []): PdfPage {
  return {
    widthMm,
    heightMm,
    layers: cards.flatMap((c) => c.layers),
    placements: cards.flatMap((c) => c.placements),
    marks: [...marks],
    markColor: INK,
  };
}

// ── Sheet ──────────────────────────────────────────────────────────────────

/** Placement of `count` cards on A4 sheets of 2 × 4, the grid centred on the page. */
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

export const PDF_TYPE = 'application/pdf';

/** Cards as a vector PDF: one 95 × 62 mm page per card, or A4 sheets of eight with cut marks and a scale bar. */
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
    // The full grid's cut marks on every page: every sheet is cut the same way.
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
    subject: `ORBES certificate card${items.length > 1 ? 's' : ''}, MINT CERTIFICATE, with the ORBES CODE and the claim code${proof ? ' · PROOF, layout not validated by the brand' : ''}`,
    keywords: ['ORBES', 'certificate', ...(proof ? ['PROOF'] : []), ...(items.length === 1 ? [items[0].productId] : [])].join(', '),
    creationDate: opts.createdAt,
    colorMode: 'k-only',
  });
  const suffix = proof ? '-PROOF' : '';
  const filename =
    layout === 'card' && items.length === 1
      ? `ORBES-certificate-${items[0].productId}${suffix}.pdf`
      : `ORBES-certificates-${day}-${items.length}-${layout}${suffix}.pdf`;
  return { contentType: PDF_TYPE, body, filename };
}

export { csvField };

/**
 * Variable-data file for a print shop: productId, model, variant (line 2 as printed), material, year, code; UTF-8,
 * CRLF, a header row. The ORBES CODE and the GENOME cannot go in a CSV.
 */
export function certificatesCsv(items: readonly CertificateItem[]): string {
  return csvDocument([
    ['productId', 'model', 'variant', 'material', 'year', 'code'],
    ...items.map((it) => [it.productId, it.model, variantLine(it), it.material, String(it.year), it.claimCode]),
  ]);
}

/** The CSV as a download. Under a PROOF layout, its file name says PROOF, as the PDFs'. */
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

/** A layer as SVG; clip paths take ids from `ids`. */
function layerSvg(layer: PdfLayer, ids: { next: number; prefix: string }, defs: string[]): string {
  if (layer.kind === 'fill') return `<path fill="${layer.color}"${layer.rule === 'even-odd' ? ' fill-rule="evenodd"' : ''} d="${layer.d}"/>`;
  if (layer.kind === 'stroke') {
    return `<path fill="none" stroke="${layer.color}" stroke-width="${fmt(layer.width)}" stroke-linecap="${layer.cap}" stroke-linejoin="${layer.join}" d="${layer.d}"/>`;
  }
  const id = `${ids.prefix}${ids.next++}`;
  defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path${layer.rule === 'even-odd' ? ' clip-rule="evenodd"' : ''} d="${layer.clip}"/></clipPath>`);
  return [`<g clip-path="url(#${id})">`, ...layer.items.map((it) => layerSvg(it, ids, defs)), '</g>'].join('\n');
}

/** A scene's primitives as SVG paths in page millimetres, its reduced tones mixed over white as the code's SVG does. */
function sceneSvg(pl: PdfPlacement, layer: string): string {
  const { scene } = pl;
  const vb = scene.viewBox;
  const k = scene.widthMm / vb.w;
  return [
    `<g data-layer="${layer}" fill="${scene.ink}" transform="matrix(${fmt(k)} 0 0 ${fmt(k)} ${fmt(pl.xMm - vb.x * k)} ${fmt(pl.yMm - vb.y * k)})">`,
    ...scene.primitives.map((p) => {
      const tone = p.tone ?? 1;
      const fill = tone === 1 ? '' : ` fill="${mixTone(scene.ink, ORBES_CODE_STYLES.classic.paper, tone)}"`;
      return `<path${fill}${hasHole(p) ? ' fill-rule="evenodd"' : ''} d="${primitiveToPathData(p)}"/>`;
    }),
    '</g>',
  ].join('\n');
}

/**
 * SVG of one card for the brand specimen (BRAND §7) and the fidelity check against 79t: the stock as on screen
 * (#FBFBF9), the card's layers, the ORBES CODE and the GENOME row; a hairline edge shows the trim unless `edge`
 * is false. Not a production file: the PDF prints the same geometry in K, without the stock.
 */
export function certificateCardSvg(item: CertificateItem, opts: { status?: CertificateLayoutStatus; edge?: boolean } = {}): string {
  const card = layoutCertificateCard(item, opts.status ?? CERTIFICATE_LAYOUT_STATUS);
  const { widthMm: w, heightMm: h } = CERTIFICATE_CARD;
  const defs: string[] = [];
  const ids = { next: 1, prefix: 'card-clip-' };
  const body = card.layers.map((l) => layerSvg(l, ids, defs));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`,
    `<title>ORBES certificate card ${item.productId}</title>`,
    `<defs>${defs.join('')}</defs>`,
    `<rect data-layer="stock" width="${w}" height="${h}" fill="${CARD_79T.stock}"/>`,
    ...(opts.edge === false ? [] : [`<rect data-layer="edge" x="0.05" y="0.05" width="${fmt(w - 0.1)}" height="${fmt(h - 0.1)}" fill="none" stroke="#C2C2C2" stroke-width="0.1"/>`]),
    '<g data-layer="card">',
    ...body,
    '</g>',
    sceneSvg(card.placements[0], 'orbes-code'),
    sceneSvg(card.placements[1], 'genome'),
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
    order: 'ORDER',
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
  /** Its model's label among its variants (NEXT LOT §3.1: « Steel »), or null for a model without one. */
  modelVariant: string | null;
  type: string;
  /** The piece's free-text Size field set at issuance, printed in the row labelled VARIANT. */
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
  /** A link's creation and expiry (F-06): with `link` only. */
  issuedAt?: Date;
  expiresAt?: Date;
  /** When the record was read: the PDF's date (CreationDate, file name). */
  checkedAt: Date;
  /**
   * The certificate's live address, `https://host/verify/c#` and its 52-character token (F-06, a link its owner
   * shares). Without one, `order` names the order the piece was bought with: the certificate an order's documents give
   * its buyer in MY PIECES (plan LIVE RELEASE+, M6), the record as read then, with no live address.
   */
  link?: string;
  /** The order's reference, `OR-1A2B3C4D` (M6): only without `link`. */
  order?: string;
}

const ORDER_REFERENCE_RE = /^OR-[0-9A-F]{8}$/;

const LONG_MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** 'YYYY-MM-DD' or a Date → '3 OCTOBER 2026' (UTC). */
export function longDate(v: string | Date): string {
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
  if (d.link !== undefined ? d.order !== undefined || !d.issuedAt || !d.expiresAt : !ORDER_REFERENCE_RE.test(d.order ?? '')) {
    throw new CertificateInputError('a certificate has its link and its dates, or the reference of its order');
  }
  const L = OWNERSHIP_CERTIFICATE_LAYOUT;
  const C = OWNERSHIP_CERTIFICATE_COPY;
  const [pw, ph] = SHEET_PAGES[L.page];
  const live = d.link !== undefined ? certificateLinkLettering(d.link) : null;
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
    // Up to 8 rows keep the pitch; a ninth (the variant line, plan NEXT LOT §3.1) tightens it so the last baseline
    // stays 3 mm above the middle rule (5.125 mm: the ninth at 199, the rule at 202).
    const pitch = rows.length > 8 ? (L.ruleMiddle - 3 - R.first) / (rows.length - 1) : R.pitch;
    rows.forEach(([label, value], i) => {
      const baseline = R.first + i * pitch;
      // A line with no label (the model's variant, under the model's name) draws its value alone.
      if (label !== '') line(label, { cap: R.labelCap, tracking: R.labelTracking, x, baseline });
      fitted(value, { cap: R.valueCap, minCap: R.minValueCap, tracking: R.valueTracking, x: x + L.valueOffset, baseline, maxWidth: L.columnWidth - L.valueOffset });
    });
  };
  // Plan NEXT LOT §3.1: the model's variant on a line of its own, unlabelled, right under the model's name (none
  // without a label). The row labelled VARIANT below is the piece's Size field, kept as it is (question 1).
  const modelVariant = d.modelVariant?.trim() ? d.modelVariant.trim().replace(/\s+/g, ' ') : null;
  const piece: [string, string][] = [
    [C.rows.model, d.model],
    ...(modelVariant ? [['', modelVariant] as [string, string]] : []),
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

  // This certificate: valid when, issued, until (a link), or the order it was bought with; what it attests; its live
  // address (a link).
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = d.checkedAt;
  const certificate: [string, string][] = [
    [C.rows.status, C.valid(`${longDate(at)} · ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`)],
    ...(live
      ? [
          [C.rows.issued, longDate(d.issuedAt!)] as [string, string],
          [C.rows.validUntil, longDate(d.expiresAt!)] as [string, string],
        ]
      : [[C.rows.order, d.order!] as [string, string]]),
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
  if (live) {
    line(C.checkLive, { cap: L.section.cap, tracking: L.section.tracking, x: L.left, baseline: V.labelBaseline });
    strokes.push(stroked(fittedRun(live.address, { cap: V.cap, minCap: V.minCap, tracking: V.tracking, x: L.left, baseline: V.addressBaseline, maxWidth: L.right - L.left })));
    strokes.push(stroked(fittedRun(live.code, { cap: V.cap, minCap: V.minCap, tracking: V.tracking, x: L.left, baseline: V.codeBaseline, maxWidth: L.right - L.left })));
  }
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
    links: live ? [{ xMm: L.left, yMm: top, wMm: L.right - L.left, hMm: V.codeBaseline + 1 - top, url: d.link! }] : [],
  };
}

/** The ownership certificate as a one-page A4 PDF (RGB: a document, not a print run). Deterministic for one input. */
export async function renderOwnershipCertificatePdf(d: OwnershipCertificateDocument): Promise<RenderedCertificates> {
  const page = layoutOwnershipCertificate(d);
  const day = d.checkedAt.toISOString().slice(0, 10);
  const body = await renderPdf([page], {
    title: `ORBES OWNERSHIP CERTIFICATE ${d.productId}`,
    subject: `The ORBES record of ${d.productId} on ${day}${d.order ? `, bought with order ${d.order}` : ''}. It attests a record, not the object it is shown with.`,
    keywords: ['ORBES', 'ownership certificate', d.productId].join(', '),
    creationDate: d.checkedAt,
  });
  return { contentType: PDF_TYPE, body, filename: `ORBES-ownership-certificate-${d.productId}-${day}.pdf` };
}
