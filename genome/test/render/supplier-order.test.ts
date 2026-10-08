/**
 * A supplier order as printed (plan NEXT LOT of 2026-10-07, §3.5.4.2, step 5.6; render/supplier-order.ts): A4 pages,
 * black on white, the house's lettering (no font, no text object), the monogram; its reference, date and expected date;
 * FROM the house, TO the supplier, DELIVER TO the location with its address; the lines with their prices; SHIPPING
 * '—' when none is set (adding nothing); the TOTAL in its currency; the note; never an email field; the lines past the
 * first page on the next; refused when it cannot be drawn; deterministic.
 */
import { describe, expect, it } from 'vitest';
import { CertificateInputError } from '../../src/server/render/certificate.js';
import { toDocumentText } from '../../src/server/render/label-font.js';
import {
  layoutSupplierOrder,
  noteLines,
  renderSupplierOrderPdf,
  SUPPLIER_ORDER_COPY,
  SUPPLIER_ORDER_LAYOUT,
  supplierOrderFilename,
  supplierOrderTexts,
  supplierOrderTotals,
  type SupplierOrderDocument,
} from '../../src/server/render/supplier-order.js';
import { INVOICE_ISSUER } from '../../src/server/services/invoices.js';

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

function doc(extra: Partial<SupplierOrderDocument> = {}): SupplierOrderDocument {
  return {
    reference: 'SO-7C21A0B9',
    date: new Date('2026-10-08T09:00:00.000Z'),
    expectedOn: '2026-11-02',
    from: { name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] },
    to: { name: 'Maison Nord', address: '1 rue du Nord\n59000 Lille\nFrance' },
    deliverTo: { name: 'LOGISTICS WAREHOUSE', address: '12 rue des Entrepôts\n93200 Saint-Denis\nFrance' },
    currency: 'EUR',
    lines: [
      { description: 'MONOLITHE · BLUE · 52', sku: 'MNL-RG-52', quantity: 12, unitPriceMinor: 12_000 },
      { description: 'MONOLITHE · BLUE · 54', sku: 'MNL-RG-54', quantity: 3, unitPriceMinor: 12_500 },
    ],
    shippingMinor: null,
    note: 'Box each piece; the delivery note names SO-7C21A0B9.',
    ...extra,
  };
}

function bounds(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const p: [number, number][] = [];
  for (const m of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const n = m[2].trim().split(/[ ,]+/).map(Number);
    p.push([n[n.length - 2]!, n[n.length - 1]!]);
  }
  return { x0: Math.min(...p.map(([x]) => x)), y0: Math.min(...p.map(([, y]) => y)), x1: Math.max(...p.map(([x]) => x)), y1: Math.max(...p.map(([, y]) => y)) };
}

describe('the supplier order PDF (render/supplier-order.ts)', () => {
  it('prints its reference, the house, the supplier and the location with its address, the lines with their prices, SHIPPING « — » when none, the total and the note; never an email', () => {
    const [page] = supplierOrderTexts(doc());
    expect(page).toEqual([
      'ORBES',
      'SUPPLIER ORDER',
      'REFERENCE',
      'SO-7C21A0B9',
      'DATE',
      '8 OCTOBER 2026',
      'EXPECTED DELIVERY',
      '2 NOVEMBER 2026',
      'CURRENCY',
      'EUR',
      'DELIVER TO',
      'LOGISTICS WAREHOUSE',
      '12 RUE DES ENTREPOTS',
      '93200 SAINT-DENIS',
      'FRANCE',
      'FROM',
      'CONGLOMERAT LLC',
      '30 N GOULD ST, STE N',
      'SHERIDAN, WY 82801',
      'UNITED STATES',
      'TO',
      'MAISON NORD',
      '1 RUE DU NORD',
      '59000 LILLE',
      'FRANCE',
      'DESCRIPTION',
      'SKU',
      'QTY',
      'UNIT PRICE',
      'LINE TOTAL',
      'MONOLITHE · BLUE · 52',
      'MNL-RG-52',
      '12',
      'EUR 120.00',
      'EUR 1 440.00',
      'MONOLITHE · BLUE · 54',
      'MNL-RG-54',
      '3',
      'EUR 125.00',
      'EUR 375.00',
      'SHIPPING',
      '—',
      'TOTAL',
      'EUR 1 815.00',
      'NOTE',
      'BOX EACH PIECE THE DELIVERY NOTE NAMES SO-7C21A0B9.',
      'ORBES · THEORBES.COM',
    ]);
    expect(page!.join(' ')).not.toMatch(/@|EMAIL|PHONE/);
    // A shipping cost adds to the total.
    const shipped = supplierOrderTexts(doc({ shippingMinor: 4_500 }))[0]!;
    expect(shipped.slice(shipped.indexOf('SHIPPING'), shipped.indexOf('TOTAL') + 2)).toEqual(['SHIPPING', 'EUR 45.00', 'TOTAL', 'EUR 1 860.00']);
    expect(supplierOrderTotals(doc({ shippingMinor: 4_500 }))).toEqual({ lines: 181_500, total: 186_000 });
    // A draft without its prices, currency or date: '—' where it is missing, and no total.
    const draft = supplierOrderTexts(doc({ currency: null, expectedOn: null, lines: [{ description: 'MONOLITHE · 52', sku: 'MNL-RG-52', quantity: 2, unitPriceMinor: null }], note: null }))[0]!;
    expect(draft.slice(draft.indexOf('EXPECTED DELIVERY'), draft.indexOf('CURRENCY') + 2)).toEqual(['EXPECTED DELIVERY', '—', 'CURRENCY', '—']);
    expect(draft.slice(draft.indexOf('MONOLITHE · 52'))).toEqual(['MONOLITHE · 52', 'MNL-RG-52', '2', '—', '—', 'SHIPPING', '—', 'TOTAL', '—', 'ORBES · THEORBES.COM']);
    expect(supplierOrderTotals(doc({ currency: null }))).toEqual({ lines: null, total: null });
    // Every fixed word draws as written.
    for (const t of [SUPPLIER_ORDER_COPY.title, SUPPLIER_ORDER_COPY.deliverTo, SUPPLIER_ORDER_COPY.shipping, SUPPLIER_ORDER_COPY.foot, ...Object.values(SUPPLIER_ORDER_COPY.columns), ...Object.values(SUPPLIER_ORDER_COPY.rows)]) {
      expect(toDocumentText(t), t).toBe(t);
    }
    expect(supplierOrderFilename('SO-7C21A0B9')).toBe('ORBES-SO-7C21A0B9.pdf');
  });

  it('lays the pages out in the margins, the monogram on the first; the lines past the first page on the next, each page numbered, the total on the last', () => {
    const L = SUPPLIER_ORDER_LAYOUT;
    const [page] = layoutSupplierOrder(doc());
    expect([page!.widthMm, page!.heightMm]).toEqual([210, 297]);
    expect(page!.placements).toEqual([]);
    expect(new Set(page!.shapes!.map((s) => s.color))).toEqual(new Set(['#0A0A0A']));
    for (const st of page!.marks!) {
      const b = bounds(st.d);
      expect(b.x0).toBeGreaterThanOrEqual(L.left - 0.5);
      expect(b.x1).toBeLessThanOrEqual(L.right + 0.5);
      expect(b.y1).toBeLessThan(290);
      expect(st.width).toBeGreaterThanOrEqual(0.1);
    }
    const many = doc({ lines: Array.from({ length: 40 }, (_, i) => ({ description: `MONOLITHE · ${40 + i}`, sku: `MNL-RG-${40 + i}`, quantity: 1, unitPriceMinor: 1_000 })) });
    const pages = supplierOrderTexts(many);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.filter((t) => t.startsWith('MNL-RG-'))).toHaveLength(17);
    expect(pages[1]!.filter((t) => t.startsWith('MNL-RG-'))).toHaveLength(23);
    expect(pages[1]!.slice(0, 3)).toEqual(['ORBES', 'SUPPLIER ORDER', 'SO-7C21A0B9']);
    expect(pages.map((p) => p.at(-1))).toEqual(['PAGE 1 OF 2', 'PAGE 2 OF 2']);
    expect(pages[0]).not.toContain('TOTAL');
    expect(pages[1]!.slice(pages[1]!.indexOf('TOTAL'), pages[1]!.indexOf('TOTAL') + 2)).toEqual(['TOTAL', 'EUR 400.00']);
    const laid = layoutSupplierOrder(many);
    expect(laid[1]!.shapes).toEqual([]);
    for (const p of laid) for (const st of p.marks!) expect(bounds(st.d).y1).toBeLessThan(290);
    // A long note on eight lines at most.
    expect(noteLines('word '.repeat(400))).toHaveLength(8);
    expect(noteLines(null)).toEqual([]);
  });

  it('refuses what it cannot print: a reference, a currency, a date, a quantity, a price', () => {
    for (const bad of [{ reference: 'SO-123' }, { currency: 'eur' }, { expectedOn: '2 November' }, { lines: [{ description: 'X', sku: 'X', quantity: 0, unitPriceMinor: 1 }] }, { lines: [{ description: 'X', sku: 'X', quantity: 1, unitPriceMinor: -1 }] }]) {
      expect(() => layoutSupplierOrder(doc(bad as Partial<SupplierOrderDocument>)), JSON.stringify(bad)).toThrow(CertificateInputError);
    }
  });

  it('renders a valid, deterministic PDF: no font, no text object, its title the supplier order', async () => {
    const a = await renderSupplierOrderPdf(doc());
    const b = await renderSupplierOrderPdf(doc());
    expect(a.contentType).toBe('application/pdf');
    expect(a.filename).toBe('ORBES-SO-7C21A0B9.pdf');
    expect(Buffer.from(a.body).equals(Buffer.from(b.body))).toBe(true);
    const text = latin1(a.body);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toContain('(ORBES SUPPLIER ORDER SO-7C21A0B9)');
    expect(text).toContain('(The supplier order SO-7C21A0B9 to MAISON NORD, delivered to LOGISTICS WAREHOUSE.)');
    expect(text.replace(/stream[\s\S]*?endstream/g, '')).not.toMatch(/\/Font|\/Subtype\s*\/Image/);
  });
});
