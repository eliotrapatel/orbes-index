/**
 * A supplier order as a PDF (plan NEXT LOT of 2026-10-07, §3.5.4.2): what ORBES sends its supplier itself (the console
 * sends no email). A4, black on white, in English, on the invoice's grid (./invoice.ts): the word ORBES, SUPPLIER ORDER
 * and the monogram; the reference, the date (sent, or last changed for a draft), the expected delivery and the currency;
 * FROM (the issuer of ORBES's invoices, services/invoices.ts INVOICE_ISSUER), TO (the supplier, its name and address) and
 * DELIVER TO (the location, its name and address); the lines (the model, its variant and size, the SKU, the quantity,
 * the unit price, the line total); SHIPPING ('—' when none is set: it adds nothing); the TOTAL in its currency; the note.
 * Never an email nor a phone: the supplier's contact stays in the console. Lines past the first page continue on the
 * next, each page with its foot; the shipping, total and note close the last.
 *
 * As every ORBES document: lettering stroked from ./label-font.ts (no font in the file), free text through
 * toDocumentText. Deterministic for one input (the PDF's dates are the document's date). `supplierOrderTexts` gives the
 * text each page draws, in order (the tests read it, the lettering being outlines).
 */
import { MONOGRAM_BOUNDS, monogramPathData } from '../../core/render/monogram.js';
import { CertificateInputError, fittedRun, fmt, INK, longDate, MIN_STROKE_MM, PDF_TYPE, stroked, type LineSpec } from './certificate.js';
import { addressLines, documentAmount, INVOICE_LAYOUT } from './invoice.js';
import { textRun, toDocumentText } from './label-font.js';
import { renderPdf, type PdfPage } from './pdf.js';
import { SHEET_PAGES } from './print-sheet.js';
import type { StrokePath } from './scene.js';

/** One line of a supplier order, as printed. */
export interface SupplierOrderDocumentLine {
  /** MONOLITHE · BLUE · 52. */
  description: string;
  sku: string;
  quantity: number;
  /** Hundredths in the order's currency; null: not set yet (a draft). */
  unitPriceMinor: number | null;
}

/** What a supplier order's PDF prints. */
export interface SupplierOrderDocument {
  /** `SO-7C21A0B9`. */
  reference: string;
  date: Date;
  /** YYYY-MM-DD, or null while none is set (a draft). */
  expectedOn: string | null;
  from: { name: string; address: readonly string[] };
  to: { name: string; address: string | null };
  deliverTo: { name: string; address: string | null };
  /** Three capitals, or null while none is set (a draft). */
  currency: string | null;
  lines: readonly SupplierOrderDocumentLine[];
  /** Hundredths; null: no shipping cost (printed '—', adding nothing). */
  shippingMinor: number | null;
  note: string | null;
}

/** The fixed lettering (house voice: capitals, tracked). */
export const SUPPLIER_ORDER_COPY = Object.freeze({
  title: 'SUPPLIER ORDER',
  rows: Object.freeze({ reference: 'REFERENCE', date: 'DATE', expected: 'EXPECTED DELIVERY', currency: 'CURRENCY' }),
  from: 'FROM',
  to: 'TO',
  deliverTo: 'DELIVER TO',
  columns: Object.freeze({ description: 'DESCRIPTION', sku: 'SKU', quantity: 'QTY', unitPrice: 'UNIT PRICE', lineTotal: 'LINE TOTAL' }),
  shipping: 'SHIPPING',
  total: 'TOTAL',
  note: 'NOTE',
  none: '—',
  page: (n: number, of: number) => `PAGE ${n} OF ${of}`,
  foot: 'ORBES · THEORBES.COM',
});

/** Page geometry in millimetres (A4 portrait, y down). */
export const SUPPLIER_ORDER_LAYOUT = Object.freeze({
  page: 'A4' as const,
  left: 22,
  right: 188,
  facts: { x: 22, first: 58, valueOffset: 34, width: 80 },
  deliverTo: { x: 22, first: 90 },
  parties: { x: 110, first: 58, width: 78 },
  ruleParties: 140,
  table: {
    head: 150,
    /** The first row's baseline on the first page, and on the pages after it. */
    first: 160,
    nextFirst: 66,
    nextHead: 56,
    pitch: 7,
    /** The last row's baseline, at most. */
    last: 276,
    sku: { x: 100, width: 30 },
    quantity: { end: 140 },
    unitPrice: { end: 164, width: 22 },
    lineTotal: { end: 188, width: 22 },
    description: { width: 74 },
  },
  close: { rule: 5, shipping: 12, total: 21, note: 31, noteFirst: 37, notePitch: 5 },
  noteLines: 8,
  noteWidth: 92,
  foot: { baseline: 287 },
});

const REFERENCE_RE = /^SO-[0-9A-F]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** An amount, or '—': `EUR 1 200.00`; without a currency yet, its figure alone. */
function money(minor: number | null, currency: string | null): string {
  if (minor === null) return SUPPLIER_ORDER_COPY.none;
  return currency ? documentAmount(minor, currency) : documentAmount(minor, '').trim();
}

/** The note on at most SUPPLIER_ORDER_LAYOUT.noteLines lines of at most noteWidth characters, cut at a word. */
export function noteLines(note: string | null): string[] {
  const words = (note ?? '').split(/\s+/).map(toDocumentText).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > SUPPLIER_ORDER_LAYOUT.noteWidth) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.length <= SUPPLIER_ORDER_LAYOUT.noteLines ? lines : [...lines.slice(0, SUPPLIER_ORDER_LAYOUT.noteLines - 1), `${lines[SUPPLIER_ORDER_LAYOUT.noteLines - 1]}...`];
}

/** The lines' total and the order's (null while a price or the currency is missing). */
export function supplierOrderTotals(d: SupplierOrderDocument): { lines: number | null; total: number | null } {
  if (d.currency === null || d.lines.some((l) => l.unitPriceMinor === null)) return { lines: null, total: null };
  const lines = d.lines.reduce((n, l) => n + l.quantity * l.unitPriceMinor!, 0);
  return { lines, total: lines + (d.shippingMinor ?? 0) };
}

interface Drawn {
  text: string;
  spec: LineSpec & { minCap?: number; maxWidth?: number };
}

/** What each page draws, in order: the texts and their places; the rules' heights apart. */
function pagesOf(d: SupplierOrderDocument): { texts: Drawn[]; rules: number[] }[] {
  if (!REFERENCE_RE.test(d.reference)) throw new CertificateInputError('not a supplier order reference');
  if (d.currency !== null && !/^[A-Z]{3}$/.test(d.currency)) throw new CertificateInputError('not a currency');
  if (d.expectedOn !== null && !DATE_RE.test(d.expectedOn)) throw new CertificateInputError('not a date');
  for (const l of d.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new CertificateInputError('a line orders at least one piece');
    if (l.unitPriceMinor !== null && (!Number.isSafeInteger(l.unitPriceMinor) || l.unitPriceMinor < 0)) throw new CertificateInputError('a price is a whole number of hundredths');
  }
  const L = SUPPLIER_ORDER_LAYOUT;
  const C = SUPPLIER_ORDER_COPY;
  const R = INVOICE_LAYOUT.rows;
  const T = L.table;
  const pages: { texts: Drawn[]; rules: number[] }[] = [];
  let page: { texts: Drawn[]; rules: number[] } = { texts: [], rules: [] };
  const put = (text: string, spec: Drawn['spec']) => {
    if (text !== '') page.texts.push({ text, spec });
  };
  const label = (text: string, x: number, baseline: number) => put(text, { cap: R.labelCap, tracking: R.labelTracking, x, baseline });
  const section = (text: string, x: number, baseline: number, align: LineSpec['align'] = 'start') => put(text, { cap: INVOICE_LAYOUT.section.cap, tracking: INVOICE_LAYOUT.section.tracking, x, baseline, align });
  const value = (text: string, x: number, baseline: number, maxWidth: number, align: LineSpec['align'] = 'start') =>
    put(text, { cap: R.valueCap, minCap: R.minValueCap, tracking: R.valueTracking, x, baseline, maxWidth, align });
  const head = () => {
    put(INVOICE_LAYOUT.brand.text, { cap: INVOICE_LAYOUT.brand.cap, tracking: INVOICE_LAYOUT.brand.tracking, x: L.left, baseline: INVOICE_LAYOUT.brand.baseline });
    put(C.title, { cap: INVOICE_LAYOUT.title.cap, tracking: INVOICE_LAYOUT.title.tracking, x: L.left, baseline: INVOICE_LAYOUT.title.baseline });
    page.rules.push(INVOICE_LAYOUT.ruleTop);
  };
  const tableHead = (y: number) => {
    section(C.columns.description, L.left, y);
    section(C.columns.sku, T.sku.x, y);
    section(C.columns.quantity, T.quantity.end, y, 'end');
    section(C.columns.unitPrice, T.unitPrice.end, y, 'end');
    section(C.columns.lineTotal, T.lineTotal.end, y, 'end');
  };
  const newPage = () => {
    pages.push(page);
    page = { texts: [], rules: [] };
    head();
    put(d.reference, { cap: R.labelCap, tracking: R.labelTracking, x: L.right, baseline: INVOICE_LAYOUT.title.baseline, align: 'end' });
  };

  // The first page: the head, the facts, the parties.
  head();
  const F = L.facts;
  const facts: [string, string][] = [
    [C.rows.reference, d.reference],
    [C.rows.date, longDate(d.date)],
    [C.rows.expected, d.expectedOn ? longDate(d.expectedOn) : C.none],
    [C.rows.currency, d.currency ?? C.none],
  ];
  facts.forEach(([l, v], i) => {
    const baseline = F.first + i * R.pitch;
    label(l, F.x, baseline);
    value(v, F.x + F.valueOffset, baseline, L.parties.x - 6 - (F.x + F.valueOffset));
  });
  let y = L.deliverTo.first;
  section(C.deliverTo, L.deliverTo.x, y);
  for (const l of [toDocumentText(d.deliverTo.name), ...addressLines(d.deliverTo.address)]) value(l, L.deliverTo.x, (y += R.pitch), F.width);
  const P = L.parties;
  y = P.first;
  section(C.from, P.x, y);
  for (const l of [d.from.name, ...d.from.address]) value(toDocumentText(l), P.x, (y += R.pitch), P.width);
  y += R.pitch * 1.6;
  section(C.to, P.x, y);
  for (const l of [toDocumentText(d.to.name), ...addressLines(d.to.address)]) value(l, P.x, (y += R.pitch), P.width);
  page.rules.push(L.ruleParties);

  // The lines, as many pages as they need.
  tableHead(T.head);
  y = T.first;
  for (const l of d.lines) {
    if (y > T.last) {
      newPage();
      tableHead(T.nextHead);
      y = T.nextFirst;
    }
    value(toDocumentText(l.description), L.left, y, T.description.width);
    value(toDocumentText(l.sku), T.sku.x, y, T.sku.width);
    value(String(l.quantity), T.quantity.end, y, 20, 'end');
    value(money(l.unitPriceMinor, d.currency), T.unitPrice.end, y, T.unitPrice.width, 'end');
    value(money(l.unitPriceMinor === null ? null : l.quantity * l.unitPriceMinor, d.currency), T.lineTotal.end, y, T.lineTotal.width, 'end');
    y += T.pitch;
  }

  // The shipping, the total and the note close the last page (on a page of their own when the lines leave no room).
  const notes = noteLines(d.note);
  const K = L.close;
  const height = notes.length ? K.noteFirst + (notes.length - 1) * K.notePitch : K.total;
  let top = y - T.pitch;
  if (top + height > T.last + 4) {
    newPage();
    top = T.nextHead - 6;
  }
  page.rules.push(top + K.rule);
  label(C.shipping, L.left, top + K.shipping);
  value(money(d.shippingMinor, d.currency), L.right, top + K.shipping, 40, 'end');
  const totals = supplierOrderTotals(d);
  put(C.total, { cap: INVOICE_LAYOUT.total.cap, tracking: INVOICE_LAYOUT.total.tracking, x: L.left, baseline: top + K.total });
  put(money(totals.total, d.currency), { cap: INVOICE_LAYOUT.total.cap, tracking: INVOICE_LAYOUT.total.tracking, x: L.right, baseline: top + K.total, align: 'end' });
  if (notes.length) {
    section(C.note, L.left, top + K.note);
    notes.forEach((n, i) => put(n, { cap: R.labelCap, minCap: 1, tracking: R.labelTracking, x: L.left, baseline: top + K.noteFirst + i * K.notePitch, maxWidth: L.right - L.left }));
  }
  pages.push(page);

  // Each page's foot, and its number when there are several.
  pages.forEach((p, i) => {
    p.texts.push({ text: C.foot, spec: { cap: INVOICE_LAYOUT.foot.cap, tracking: INVOICE_LAYOUT.foot.tracking, x: L.left, baseline: L.foot.baseline } });
    if (pages.length > 1) p.texts.push({ text: C.page(i + 1, pages.length), spec: { cap: INVOICE_LAYOUT.foot.cap, tracking: INVOICE_LAYOUT.foot.tracking, x: L.right, baseline: L.foot.baseline, align: 'end' } });
  });
  return pages;
}

/** The text each page draws, in order (the lettering is outlines: the tests read this). */
export function supplierOrderTexts(d: SupplierOrderDocument): string[][] {
  return pagesOf(d).map((p) => p.texts.map((t) => t.text));
}

/** The pages of a supplier order. Throws CertificateInputError on input it cannot draw. */
export function layoutSupplierOrder(d: SupplierOrderDocument): PdfPage[] {
  const L = SUPPLIER_ORDER_LAYOUT;
  const [pw, ph] = SHEET_PAGES[L.page];
  return pagesOf(d).map((p, i) => {
    // Drawn as the lettering can: the dash of an amount not set ('—') as '-'.
    const strokes: StrokePath[] = p.texts.map((t) => {
      const text = toDocumentText(t.text);
      return stroked(
        t.spec.maxWidth !== undefined
          ? fittedRun(text, { ...t.spec, minCap: t.spec.minCap ?? t.spec.cap, maxWidth: t.spec.maxWidth })
          : textRun(text, { capHeight: t.spec.cap, tracking: t.spec.tracking, x: t.spec.x, baseline: t.spec.baseline, align: t.spec.align ?? 'start' }),
      );
    });
    for (const y of p.rules) strokes.push({ d: `M${fmt(L.left)} ${fmt(y)}L${fmt(L.right)} ${fmt(y)}`, width: MIN_STROKE_MM });
    const shapes =
      i === 0
        ? (() => {
            const mh = INVOICE_LAYOUT.monogram.bottom - INVOICE_LAYOUT.monogram.top;
            const mw = (mh * MONOGRAM_BOUNDS.w) / MONOGRAM_BOUNDS.h;
            return monogramPathData({ x: L.right - mw, y: INVOICE_LAYOUT.monogram.top, width: mw }).map((m) => ({ d: m, color: INK }));
          })()
        : [];
    return { widthMm: pw, heightMm: ph, placements: [], marks: strokes, markColor: INK, shapes };
  });
}

/** The file of a supplier order: `ORBES-SO-7C21A0B9.pdf`. */
export function supplierOrderFilename(reference: string): string {
  return `ORBES-${reference}.pdf`;
}

/** A supplier order as an A4 PDF (RGB: a document). Deterministic for one input. */
export async function renderSupplierOrderPdf(d: SupplierOrderDocument): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
  const pages = layoutSupplierOrder(d);
  const body = await renderPdf(pages, {
    title: `ORBES ${SUPPLIER_ORDER_COPY.title} ${d.reference}`,
    subject: `The supplier order ${d.reference} to ${toDocumentText(d.to.name)}, delivered to ${toDocumentText(d.deliverTo.name)}.`,
    keywords: ['ORBES', 'supplier order', d.reference].join(', '),
    creationDate: d.date,
  });
  return { contentType: PDF_TYPE, body, filename: supplierOrderFilename(d.reference) };
}
