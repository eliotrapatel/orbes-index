/**
 * The invoice and the credit note as printed (plan LIVE RELEASE+, step S4, M7; render/invoice.ts): one A4 page, black
 * on white, the house's lettering (no font, no text object), the monogram; the issuer, the buyer (the punctuation of an
 * address and an email kept), the lines and the total, no VAT line; a credit note names the invoice it cancels; refused
 * when it cannot be drawn as issued; deterministic.
 */
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CertificateInputError } from '../../src/server/render/certificate.js';
import { addressLines, documentAmount, INVOICE_COPY, INVOICE_LAYOUT, INVOICE_MAX_LINES, invoiceFilename, layoutInvoice, renderInvoicePdf, type InvoiceDocument } from '../../src/server/render/invoice.js';
import { toDocumentText, toLabelText } from '../../src/server/render/label-font.js';
import { INVOICE_ISSUER } from '../../src/server/services/invoices.js';

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

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

function bounds(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const p: [number, number][] = [];
  for (const m of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const n = m[2].trim().split(/[ ,]+/).map(Number);
    p.push([n[n.length - 2]!, n[n.length - 1]!]);
  }
  return { x0: Math.min(...p.map(([x]) => x)), y0: Math.min(...p.map(([, y]) => y)), x1: Math.max(...p.map(([x]) => x)), y1: Math.max(...p.map(([, y]) => y)) };
}

function doc(extra: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    kind: 'INVOICE',
    number: 'INV-2026-000001',
    issuedAt: new Date('2026-10-05T10:00:00.000Z'),
    order: 'OR-1A2B3C4D',
    credits: null,
    issuer: { name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] },
    buyer: { name: 'Jeanne d’Arc-Müller', address: '12 rue de l’Église, Bât. B\n75003 Paris\nFrance', email: 'jeanne.muller+orbes@example.com' },
    lines: [
      { label: 'MONOLITHE · SIZE 52', detail: 'LIVE RELEASE · MONOLITHE — LIVE', amountMinor: 480_000 },
      { label: 'Engraving', detail: null, amountMinor: 15_000 },
    ],
    currency: 'EUR',
    totalMinor: 495_000,
    ...extra,
  };
}

describe('invoice and credit note (M7)', () => {
  it('writes amounts with their currency, thousands apart; the address on five lines at most; the punctuation of an address and an email kept', () => {
    expect([documentAmount(495_000, 'EUR'), documentAmount(5, 'GBP'), documentAmount(100_000_000, 'USD'), documentAmount(0, 'CHF')]).toEqual([
      'EUR 4 950.00',
      'GBP 0.05',
      'USD 1 000 000.00',
      'CHF 0.00',
    ]);
    // A credit taken off the order (plan NEXT-NINE, BP-19 T5): its minus sign; never a fraction of a minor unit.
    expect(documentAmount(-5_000, 'EUR')).toBe('EUR -50.00');
    expect(documentAmount(-1, 'EUR')).toBe('EUR -0.01');
    expect(() => documentAmount(1.5, 'EUR')).toThrow(CertificateInputError);
    expect(addressLines('12 rue de l’Église, Bât. B\n\n75003 Paris\r\nFrance')).toEqual(["12 RUE DE L'EGLISE, BAT. B", '75003 PARIS', 'FRANCE']);
    expect(addressLines('1\n2\n3\n4\n5\n6\n7')).toEqual(['1', '2', '3', '4', '5, 6, 7']);
    expect(addressLines(null)).toEqual([]);
    expect(toDocumentText('jeanne.muller+orbes@example.com (home)')).toBe('JEANNE.MULLER+ORBES@EXAMPLE.COM (HOME)');
    expect(toDocumentText('jean_dupont+shop@mail-box.example.com')).toBe('JEAN_DUPONT+SHOP@MAIL-BOX.EXAMPLE.COM');
    expect(addressLines('12/14 rue des Arts & Métiers\n75003 Paris')).toEqual(['12/14 RUE DES ARTS & METIERS', '75003 PARIS']);
    expect(() => layoutInvoice(doc({ buyer: { name: 'Jean Dupont', address: '12/14 rue des Arts & Métiers', email: 'jean_dupont+shop@mail-box.example.com' } }))).not.toThrow();
    // A label never letters them: a piece's card keeps the lettering it always had.
    expect(toLabelText('Argent 925, (œuvre)')).toBe('ARGENT 925 OEUVRE');
    expect(invoiceFilename('INVOICE', 'INV-2026-000001')).toBe('ORBES-invoice-INV-2026-000001.pdf');
    expect(invoiceFilename('CREDIT_NOTE', 'CN-2026-000001')).toBe('ORBES-credit-note-CN-2026-000001.pdf');
  });

  it('lays out one A4 page in the margins: the head, the facts, the parties, the lines, the total; the monogram in ink', () => {
    const L = INVOICE_LAYOUT;
    const page = layoutInvoice(doc());
    expect([page.widthMm, page.heightMm]).toEqual([210, 297]);
    expect(page.placements).toEqual([]);
    expect(page.links ?? []).toEqual([]);
    expect(page.markColor).toBe('#0A0A0A');
    expect(new Set(page.shapes!.map((s) => s.color))).toEqual(new Set(['#0A0A0A']));
    for (const st of page.marks!) {
      const b = bounds(st.d);
      expect(b.x0).toBeGreaterThanOrEqual(L.left - 0.5);
      expect(b.x1).toBeLessThanOrEqual(L.right + 0.5);
      expect(b.y0).toBeGreaterThan(20);
      expect(b.y1).toBeLessThan(290);
      expect(st.width).toBeGreaterThanOrEqual(0.1);
    }
    // The total and its amount on their baseline, the amount against the right margin.
    const total = page.marks!.map((m) => bounds(m.d)).filter((b) => Math.abs(b.y1 - L.total.baseline) < 0.5);
    expect(total).toHaveLength(2);
    expect(Math.max(...total.map((b) => b.x1))).toBeCloseTo(L.right, 0);
    // An invoice cancels nothing: nothing between the total and the foot.
    expect(page.marks!.map((m) => bounds(m.d)).filter((b) => b.y1 > L.total.baseline + 1 && b.y1 < L.foot.baseline - 2)).toEqual([]);
    for (const t of [...Object.values(INVOICE_COPY.title), INVOICE_COPY.cancels('INV-2026-000001'), INVOICE_COPY.foot]) expect(toDocumentText(t), t).toBe(t);
  });

  it('a credit note names the invoice it cancels, in its facts and under its total', () => {
    const L = INVOICE_LAYOUT;
    const invoice = layoutInvoice(doc());
    const credit = layoutInvoice(doc({ kind: 'CREDIT_NOTE', number: 'CN-2026-000001', credits: 'INV-2026-000001' }));
    // CANCELS and its number (one row more), and the statement.
    const statement = credit.marks!.map((m) => bounds(m.d)).filter((b) => Math.abs(b.y1 - L.statement.baseline) < 0.5);
    expect(statement).toHaveLength(1);
    expect(credit.marks!.length).toBe(invoice.marks!.length + 3);
  });

  it('refuses what it cannot print as issued: a number, an order, a currency, the lines, the total, a credit note without its invoice', () => {
    for (const bad of [
      doc({ number: 'INV-26-1' }),
      doc({ number: 'CN-2026-000001' }),
      doc({ kind: 'CREDIT_NOTE', number: 'CN-2026-000001' }),
      doc({ credits: 'INV-2026-000001' }),
      doc({ order: 'OR-1' }),
      doc({ currency: 'euro' }),
      doc({ lines: [] }),
      doc({ lines: Array.from({ length: INVOICE_MAX_LINES + 1 }, () => ({ label: 'X', detail: null, amountMinor: 0 })), totalMinor: 0 }),
      doc({ totalMinor: 1 }),
      // A credit larger than what it is taken off: a total below zero.
      doc({ lines: [{ label: 'MONOLITHE', detail: null, amountMinor: 100 }, { label: 'CREDIT · PLATINE', detail: null, amountMinor: -200 }], totalMinor: -100 }),
    ]) {
      expect(() => layoutInvoice(bad), JSON.stringify([bad.number, bad.order, bad.currency, bad.lines.length, bad.totalMinor])).toThrow(CertificateInputError);
    }
  });

  it('holds the piece, six add-ons, its shipping, a credit and a welcome gift on its page (BP-19): up to seven lines at the table\'s pitch, more sharing its height above the total', () => {
    const lines = [
      { label: 'MONOLITHE · SIZE 52', detail: 'LIVE RELEASE · MONOLITHE IN STEEL', amountMinor: 505_000 },
      ...Array.from({ length: 6 }, (_, i) => ({ label: `ADD-ON ${i + 1}`, detail: null, amountMinor: 1_000 })),
      { label: 'SHIPPING · EXPRESS', detail: 'FREE · PALLADIUM', amountMinor: 0 },
      { label: 'CREDIT · PALLADIUM', detail: null, amountMinor: -10_000 },
      { label: 'WELCOME GIFT · ECLIPSE', detail: 'ORDER OR-1A2B3C4D', amountMinor: 0 },
    ];
    expect(lines).toHaveLength(INVOICE_MAX_LINES);
    const page = layoutInvoice(doc({ lines, totalMinor: lines.reduce((n, l) => n + l.amountMinor, 0) }));
    const L = INVOICE_LAYOUT;
    // The lettering between the table's head and the total (the hairlines, flat, aside).
    const inTable = page.marks!.map((m) => bounds(m.d)).filter((b) => b.y1 > L.table.head + 1 && b.y1 < L.total.baseline - L.total.cap - 0.5 && b.y1 - b.y0 > 0.01);
    expect(inTable.length).toBeGreaterThan(0);
    expect(Math.max(...inTable.map((b) => b.y1))).toBeLessThan(L.ruleTotal);
  });

  it('renders a valid, deterministic PDF: no font, no text object, no VAT line, its title the document', async () => {
    const a = await renderInvoicePdf(doc());
    const b = await renderInvoicePdf(doc());
    expect(a.contentType).toBe('application/pdf');
    expect(a.filename).toBe('ORBES-invoice-INV-2026-000001.pdf');
    expect(Buffer.from(a.body).equals(Buffer.from(b.body))).toBe(true);
    const text = latin1(a.body);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.275591 841\.889764\]/);
    expect(text).toContain('(ORBES INVOICE INV-2026-000001)');
    expect(text).toContain('(The invoice INV-2026-000001 of order OR-1A2B3C4D, issued by CONGLOMERAT LLC.)');
    expect(text.replace(/stream[\s\S]*?endstream/g, '')).not.toMatch(/\/Font|\/Subtype\s*\/Image/);
    expect(pdfStreams(a.body)).not.toMatch(/\bBT\b|\bTj\b|\bTJ\b/);
    // Nothing says VAT: the fields stay in the data, empty (the owner's decision).
    expect(JSON.stringify(INVOICE_COPY)).not.toMatch(/VAT|TAX/);
    const credit = await renderInvoicePdf(doc({ kind: 'CREDIT_NOTE', number: 'CN-2026-000001', credits: 'INV-2026-000001' }));
    expect(credit.filename).toBe('ORBES-credit-note-CN-2026-000001.pdf');
    expect(latin1(credit.body)).toContain('(ORBES CREDIT NOTE CN-2026-000001)');
  });
});
