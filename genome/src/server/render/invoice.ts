/**
 * The invoice and the credit note of an order (plan LIVE RELEASE+ of 2026-10-04, choices 20 and 22, M7): one A4 page,
 * black on white, in English, issued by CONGLOMERAT LLC without VAT (services/invoices.ts). A4 millimetres, y down:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ORBES                                           ╭─────╮  │  the word and the monogram, as the ownership
 *   │ INVOICE                                         │ ORB │  │  certificate's head
 *   │ ──────────────────────────────────────────────────────── │
 *   │ NUMBER    INV-2026-000001        ISSUED BY               │
 *   │ DATE      5 OCTOBER 2026         CONGLOMERAT LLC         │
 *   │ ORDER     OR-1A2B3C4D            30 N GOULD ST, STE N …  │
 *   │ CURRENCY  EUR                    BILLED TO               │
 *   │                                  JANE DOE, 12 RUE …, @   │
 *   │ ──────────────────────────────────────────────────────── │
 *   │ DESCRIPTION                                       AMOUNT │
 *   │ MONOLITHE · SIZE 52                         EUR 4 800.00 │  the piece, then each add-on as sold
 *   │ LIVE RELEASE · MONOLITHE — LIVE                          │
 *   │ ENGRAVING                                     EUR 150.00 │
 *   │ ──────────────────────────────────────────────────────── │
 *   │ TOTAL                                       EUR 4 950.00 │
 *   │ THIS CREDIT NOTE CANCELS INVOICE INV-… IN FULL.          │  a credit note only
 *   │ ORBES · THEORBES.COM                                     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Everything is the house's geometry, as the certificate card and the ownership certificate (./certificate.ts):
 * lettering stroked from ./label-font.ts (no font in the file: the same capitals everywhere), the monogram a flat fill
 * of its master outlines, hairline rules. Free text (the model, a release, the buyer's name, address and email) goes
 * through toDocumentText: accents dropped, capitals, the punctuation of an address and an email kept. No VAT line: the
 * VAT fields stay in the data, empty (the owner's decision). Deterministic for one input (the PDF's dates are the
 * document's issue).
 */
import { MONOGRAM_BOUNDS, monogramPathData } from '../../core/render/monogram.js';
import { CertificateInputError, fittedRun, fmt, INK, longDate, MIN_STROKE_MM, PDF_TYPE, stroked, type LineSpec } from './certificate.js';
import { textRun, toDocumentText } from './label-font.js';
import { renderPdf, type PdfPage } from './pdf.js';
import { SHEET_PAGES } from './print-sheet.js';
import type { StrokePath } from './scene.js';

export type InvoiceDocumentKind = 'INVOICE' | 'CREDIT_NOTE';

/** One line as issued: the piece (its model and size, where it was sold beneath), or an add-on. */
export interface InvoiceDocumentLine {
  label: string;
  /** A second, smaller line under the label (where the piece was sold), or null. */
  detail: string | null;
  amountMinor: number;
}

/** What an invoice or a credit note prints, as issued (services/invoices.ts keeps it unchanged). */
export interface InvoiceDocument {
  kind: InvoiceDocumentKind;
  /** `INV-2026-000001`, `CN-2026-000001`. */
  number: string;
  issuedAt: Date;
  /** The order's reference, `OR-1A2B3C4D`. */
  order: string;
  /** The number of the invoice a credit note cancels; null for an invoice. */
  credits: string | null;
  issuer: { name: string; address: readonly string[] };
  /** As entered by ORBES Client Services (masked for an AUDITOR by the caller), and the account's email. */
  buyer: { name: string | null; address: string | null; email: string | null };
  lines: readonly InvoiceDocumentLine[];
  currency: string;
  totalMinor: number;
}

/** The fixed lettering (house voice: capitals, tracked). */
export const INVOICE_COPY = Object.freeze({
  title: Object.freeze({ INVOICE: 'INVOICE', CREDIT_NOTE: 'CREDIT NOTE' } as const),
  rows: Object.freeze({ number: 'NUMBER', date: 'DATE', order: 'ORDER', credits: 'CANCELS', currency: 'CURRENCY' }),
  issuedBy: 'ISSUED BY',
  billedTo: 'BILLED TO',
  description: 'DESCRIPTION',
  amount: 'AMOUNT',
  total: 'TOTAL',
  cancels: (invoice: string) => `THIS CREDIT NOTE CANCELS INVOICE ${invoice} IN FULL.`,
  foot: 'ORBES · THEORBES.COM',
});

/** Page geometry in millimetres (A4 portrait, y down), on the ownership certificate's grid. */
export const INVOICE_LAYOUT = Object.freeze({
  page: 'A4' as const,
  left: 22,
  right: 188,
  brand: { text: 'ORBES', cap: 4, tracking: 0.9, baseline: 30 },
  title: { cap: 1.8, tracking: 0.6, baseline: 37 },
  monogram: { top: 26, bottom: 37 },
  ruleTop: 46,
  /** The facts on the left, the issuer and the buyer on the right: label, then value at `valueOffset`. */
  facts: { x: 22, first: 58, valueOffset: 26 },
  parties: { x: 110, first: 58, width: 78 },
  rows: { pitch: 6, labelCap: 1.15, labelTracking: 0.45, valueCap: 1.6, minValueCap: 1.1, valueTracking: 0.25 },
  section: { cap: 1.3, tracking: 0.6 },
  /** The buyer's address, at most this many lines (the rest joined into the last). */
  addressLines: 5,
  ruleParties: 148,
  table: { head: 158, first: 168, pitch: 11, detailGap: 4.4, detailCap: 1.2, amountWidth: 44 },
  ruleTotal: 248,
  total: { baseline: 258, cap: 2.2, tracking: 0.3 },
  statement: { baseline: 268, cap: 1.3, tracking: 0.25 },
  foot: { baseline: 287, cap: 1.2, tracking: 0.35 },
});

/** Lines a page holds: the piece and its add-ons (six at most, as a LIVE RELEASE's). */
export const INVOICE_MAX_LINES = 7;

const NUMBER_RE = /^(INV|CN)-20\d{2}-\d{6}$/;
const ORDER_RE = /^OR-[0-9A-F]{8}$/;

/** An amount in minor units as a document says it: `EUR 4 800.00`, the thousands set apart by a space. */
export function documentAmount(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new CertificateInputError('an amount is a whole number of minor units');
  const units = String(Math.floor(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${currency} ${units}.${String(minor % 100).padStart(2, '0')}`;
}

/** The buyer's address on at most INVOICE_LAYOUT.addressLines lines, as the lettering draws it. */
export function addressLines(address: string | null): string[] {
  const lines = (address ?? '').split(/\r?\n/).map(toDocumentText).filter((l) => l.length > 0);
  const max = INVOICE_LAYOUT.addressLines;
  return lines.length <= max ? lines : [...lines.slice(0, max - 1), lines.slice(max - 1).join(', ')];
}

/** The page of an invoice or a credit note. Throws CertificateInputError on input it cannot draw. */
export function layoutInvoice(d: InvoiceDocument): PdfPage {
  if (!NUMBER_RE.test(d.number) || (d.kind === 'INVOICE') !== d.number.startsWith('INV-')) throw new CertificateInputError('not a document number');
  if (!ORDER_RE.test(d.order)) throw new CertificateInputError('not an order reference');
  if ((d.kind === 'CREDIT_NOTE') !== (d.credits !== null) || (d.credits !== null && !NUMBER_RE.test(d.credits))) throw new CertificateInputError('a credit note names the invoice it cancels');
  if (!/^[A-Z]{3}$/.test(d.currency)) throw new CertificateInputError('not a currency');
  if (d.lines.length < 1 || d.lines.length > INVOICE_MAX_LINES) throw new CertificateInputError(`one to ${INVOICE_MAX_LINES} lines`);
  if (d.lines.reduce((n, l) => n + l.amountMinor, 0) !== d.totalMinor) throw new CertificateInputError('the total is the sum of the lines');
  const L = INVOICE_LAYOUT;
  const C = INVOICE_COPY;
  const R = L.rows;
  const [pw, ph] = SHEET_PAGES[L.page];
  const strokes: StrokePath[] = [];
  const line = (text: string, s: LineSpec) => strokes.push(stroked(textRun(text, { capHeight: s.cap, tracking: s.tracking, x: s.x, baseline: s.baseline, align: s.align ?? 'start' })));
  const fitted = (text: string, s: LineSpec & { minCap: number; maxWidth: number }) => {
    if (text !== '') strokes.push(stroked(fittedRun(text, s)));
  };
  const rule = (y: number) => strokes.push({ d: `M${fmt(L.left)} ${fmt(y)}L${fmt(L.right)} ${fmt(y)}`, width: MIN_STROKE_MM });
  const label = (text: string, x: number, baseline: number) => line(text, { cap: R.labelCap, tracking: R.labelTracking, x, baseline });
  const section = (text: string, x: number, baseline: number, align: LineSpec['align'] = 'start') => line(text, { cap: L.section.cap, tracking: L.section.tracking, x, baseline, align });
  const value = (text: string, x: number, baseline: number, maxWidth: number) =>
    fitted(text, { cap: R.valueCap, minCap: R.minValueCap, tracking: R.valueTracking, x, baseline, maxWidth });

  // Head: the word, the document's name, the monogram at the right margin, a hairline.
  line(L.brand.text, { cap: L.brand.cap, tracking: L.brand.tracking, x: L.left, baseline: L.brand.baseline });
  line(C.title[d.kind], { cap: L.title.cap, tracking: L.title.tracking, x: L.left, baseline: L.title.baseline });
  const mh = L.monogram.bottom - L.monogram.top;
  const mw = (mh * MONOGRAM_BOUNDS.w) / MONOGRAM_BOUNDS.h;
  const monogram = monogramPathData({ x: L.right - mw, y: L.monogram.top, width: mw });
  rule(L.ruleTop);

  // The facts: its number, date, order, what it cancels, its currency.
  const F = L.facts;
  const facts: [string, string][] = [
    [C.rows.number, d.number],
    [C.rows.date, longDate(d.issuedAt)],
    [C.rows.order, d.order],
    ...(d.credits ? [[C.rows.credits, d.credits] as [string, string]] : []),
    [C.rows.currency, d.currency],
  ];
  facts.forEach(([l, v], i) => {
    const baseline = F.first + i * R.pitch;
    label(l, F.x, baseline);
    value(v, F.x + F.valueOffset, baseline, L.parties.x - 6 - (F.x + F.valueOffset));
  });

  // The parties: who issues it, who it is billed to.
  const P = L.parties;
  let y = P.first;
  section(C.issuedBy, P.x, y);
  for (const l of [d.issuer.name, ...d.issuer.address]) value(toDocumentText(l), P.x, (y += R.pitch), P.width);
  y += R.pitch * 1.6;
  section(C.billedTo, P.x, y);
  const buyer = [d.buyer.name, ...addressLines(d.buyer.address), d.buyer.email].map((l) => toDocumentText(l ?? '')).filter((l) => l.length > 0);
  for (const l of buyer) value(l, P.x, (y += R.pitch), P.width);
  if (y > L.ruleParties - 4) throw new CertificateInputError('the parties overflow their block');
  rule(L.ruleParties);

  // The lines: each description (and where the piece was sold) on the left, its amount on the right.
  const T = L.table;
  section(C.description, L.left, T.head);
  section(C.amount, L.right, T.head, 'end');
  const describe = L.right - L.left - T.amountWidth - 4;
  d.lines.forEach((l, i) => {
    const baseline = T.first + i * T.pitch;
    value(toDocumentText(l.label), L.left, baseline, describe);
    if (l.detail) fitted(toDocumentText(l.detail), { cap: T.detailCap, minCap: R.minValueCap, tracking: R.labelTracking, x: L.left, baseline: baseline + T.detailGap, maxWidth: describe });
    line(documentAmount(l.amountMinor, d.currency), { cap: R.valueCap, tracking: R.valueTracking, x: L.right, baseline, align: 'end' });
  });
  rule(L.ruleTotal);
  line(C.total, { cap: L.total.cap, tracking: L.total.tracking, x: L.left, baseline: L.total.baseline });
  line(documentAmount(d.totalMinor, d.currency), { cap: L.total.cap, tracking: L.total.tracking, x: L.right, baseline: L.total.baseline, align: 'end' });
  if (d.credits) line(C.cancels(d.credits), { cap: L.statement.cap, tracking: L.statement.tracking, x: L.left, baseline: L.statement.baseline });
  line(C.foot, { cap: L.foot.cap, tracking: L.foot.tracking, x: L.left, baseline: L.foot.baseline });

  return { widthMm: pw, heightMm: ph, placements: [], marks: strokes, markColor: INK, shapes: monogram.map((m) => ({ d: m, color: INK })) };
}

/** The file of a document: `ORBES-invoice-INV-2026-000001.pdf`, `ORBES-credit-note-CN-2026-000001.pdf`. */
export function invoiceFilename(kind: InvoiceDocumentKind, number: string): string {
  return `ORBES-${kind === 'INVOICE' ? 'invoice' : 'credit-note'}-${number}.pdf`;
}

/** An invoice or a credit note as a one-page A4 PDF (RGB: a document). Deterministic for one input. */
export async function renderInvoicePdf(d: InvoiceDocument): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
  const page = layoutInvoice(d);
  const name = d.kind === 'INVOICE' ? 'invoice' : 'credit note';
  const body = await renderPdf([page], {
    title: `ORBES ${INVOICE_COPY.title[d.kind]} ${d.number}`,
    subject: `The ${name} ${d.number} of order ${d.order}, issued by ${d.issuer.name}.`,
    keywords: ['ORBES', name, d.number, d.order].join(', '),
    creationDate: d.issuedAt,
  });
  return { contentType: PDF_TYPE, body, filename: invoiceFilename(d.kind, d.number) };
}
