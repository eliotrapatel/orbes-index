/**
 * MY PIECES' orders (plan LIVE RELEASE+, step S3): an order of the account as its card in YOUR ORDERS shows it
 * (orders-model.ts), and the copy. Pure: no DOM. The page itself is driven in Chromium by verify.orders.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ORDERS } from '../../src/web/verify/copy.js';
import { ORDER_PATH, orderDate, orderDocuments, orderModel, orderModels, orderRows, orderSteps } from '../../src/web/verify/orders-model.js';
import type { AccountOrder } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

const NBSP = ' ';

function order(extra: Partial<AccountOrder> = {}): AccountOrder {
  return {
    id: '1a2b3c4d-0000-4000-8000-000000000001',
    reference: 'OR-1A2B3C4D',
    channel: 'LIVE',
    release: 'Monolithe — Live',
    model: 'Monolithe',
    size: { label: '52' },
    priceMinor: 480_000,
    currency: 'EUR',
    addons: [{ label: 'Engraving', priceMinor: 25_000 }],
    status: 'RESERVED',
    reservedAt: '2026-10-05T18:00:12.000Z',
    paidAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    returnedAt: null,
    shipment: null,
    ...extra,
  };
}

const SHIPMENT = { carrier: 'Colissimo', trackingNumber: '6A 1234 5678 901', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901' };
const steps = (o: AccountOrder, offset = 0) => orderSteps(o, offset).map((s) => [s.label, s.date, s.state]);

describe('YOUR ORDERS: an order\'s card (orders-model.ts)', () => {
  it('reads RESERVED · PAID · SHIPPED · DELIVERED, each reached with its date, the current one marked, those to come without one', () => {
    expect(ORDER_PATH).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED']);
    expect(steps(order())).toEqual([
      ['RESERVED', '5 OCT 2026', 'current'],
      ['PAID', '', 'next'],
      ['SHIPPED', '', 'next'],
      ['DELIVERED', '', 'next'],
    ]);
    const shipped = order({ status: 'SHIPPED', paidAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', shipment: SHIPMENT });
    expect(steps(shipped)).toEqual([
      ['RESERVED', '5 OCT 2026', 'done'],
      ['PAID', '6 OCT 2026', 'done'],
      ['SHIPPED', '8 OCT 2026', 'current'],
      ['DELIVERED', '', 'next'],
    ]);
    const delivered = order({ status: 'DELIVERED', paidAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', deliveredAt: '2026-10-10T10:00:00.000Z', shipment: SHIPMENT });
    expect(steps(delivered).map((s) => s[2])).toEqual(['done', 'done', 'done', 'current']);
  });

  it('a CANCELLED or RETURNED order: the steps it reached, then that end with its date', () => {
    expect(steps(order({ status: 'CANCELLED', cancelledAt: '2026-10-06T08:00:00.000Z' }))).toEqual([
      ['RESERVED', '5 OCT 2026', 'done'],
      ['CANCELLED', '6 OCT 2026', 'current'],
    ]);
    expect(steps(order({ status: 'CANCELLED', paidAt: '2026-10-06T08:00:00.000Z', cancelledAt: '2026-10-07T08:00:00.000Z' })).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'CANCELLED']);
    // Returned on its way (SHIPPED → RETURNED), or once delivered.
    const onItsWay = order({ status: 'RETURNED', paidAt: '2026-10-06T08:00:00.000Z', shippedAt: '2026-10-07T08:00:00.000Z', returnedAt: '2026-10-12T08:00:00.000Z', shipment: SHIPMENT });
    expect(steps(onItsWay)).toEqual([
      ['RESERVED', '5 OCT 2026', 'done'],
      ['PAID', '6 OCT 2026', 'done'],
      ['SHIPPED', '7 OCT 2026', 'done'],
      ['RETURNED', '12 OCT 2026', 'current'],
    ]);
    expect(steps(order({ ...onItsWay, deliveredAt: '2026-10-09T08:00:00.000Z' })).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED']);
  });

  it('dates each step on this phone\'s calendar', () => {
    // 23:30 UTC is the next day in Paris (+120 min), the same day in New York (−240 min).
    expect(orderDate('2026-10-05T23:30:00.000Z', 120)).toBe('6 OCT 2026');
    expect(orderDate('2026-10-05T23:30:00.000Z', -240)).toBe('5 OCT 2026');
    expect(orderDate('not a date', 0)).toBe('');
    expect(orderDate(null, 0)).toBe('');
    expect(steps(order({ reservedAt: '2026-10-05T23:30:00.000Z' }), 120)[0]).toEqual(['RESERVED', '6 OCT 2026', 'current']);
  });

  it('without an offset, dates each step with this phone\'s offset on that date, not today\'s', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Paris';
    try {
      // 00:30 in Paris on 15 July (summer time, UTC+2) is 22:30 UTC the day before: still 15 JUL, seen in winter or summer.
      expect(orderDate('2026-07-14T22:30:00.000Z')).toBe('15 JUL 2026');
      // 00:30 in Paris on 15 December (winter time, UTC+1).
      expect(orderDate('2026-12-14T23:30:00.000Z')).toBe('15 DEC 2026');
      expect(orderDate('not a date')).toBe('');
      const reserved = order({ status: 'PAID', reservedAt: '2026-07-14T22:30:00.000Z', paidAt: '2026-12-14T23:30:00.000Z' });
      expect(orderSteps(reserved).map((s) => s.date)).toEqual(['15 JUL 2026', '15 DEC 2026', '', '']);
      expect(orderModels([reserved])[0]!.steps.map((s) => s.date)).toEqual(['15 JUL 2026', '15 DEC 2026', '', '']);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('says the size, the price, each add-on at its price and the TOTAL; TO BE CONFIRMED until Client Services enters them', () => {
    expect(orderRows(order())).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['ENGRAVING', `€${NBSP}250`],
      ['TOTAL', `€${NBSP}5${NBSP}050`],
    ]);
    // No add-on: no total. One size.
    expect(orderRows(order({ addons: [], size: { label: null } }))).toEqual([
      ['SIZE', 'ONE SIZE'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
    ]);
    // A draw's or a salon's order before its terms are entered.
    expect(orderRows(order({ channel: 'DRAW', size: null, priceMinor: null, currency: null, addons: [] }))).toEqual([
      ['SIZE', 'TO BE CONFIRMED'],
      ['PRICE', 'TO BE CONFIRMED'],
    ]);
    expect(orderRows(order({ currency: 'CHF', priceMinor: 480_050, addons: [] }))[1]).toEqual(['PRICE', `CHF${NBSP}4${NBSP}800.50`]);
  });

  it('a CANCELLED order never promises a confirmation: the size and the price never entered are left out', () => {
    const salon = { channel: 'SALON' as const, release: null, size: null, priceMinor: null, currency: null, addons: [], status: 'CANCELLED' as const, cancelledAt: '2026-10-06T08:00:00.000Z' };
    expect(orderRows(order(salon))).toEqual([]);
    expect(orderModel(order(salon), 0)!.rows).toEqual([]);
    expect(orderRows(order({ ...salon, size: { label: '54' } }))).toEqual([['SIZE', '54']]);
    expect(orderRows(order({ ...salon, priceMinor: 300_000, currency: 'EUR' }))).toEqual([['PRICE', `€${NBSP}3${NBSP}000`]]);
    // Its terms entered: kept as they were sold.
    expect(orderRows(order({ status: 'CANCELLED', cancelledAt: '2026-10-06T08:00:00.000Z' }))).toEqual(orderRows(order()));
    // Still on its way, an order keeps TO BE CONFIRMED.
    expect(orderRows(order({ ...salon, status: 'RESERVED', cancelledAt: null }))).toEqual([
      ['SIZE', 'TO BE CONFIRMED'],
      ['PRICE', 'TO BE CONFIRMED'],
    ]);
  });

  it('names the model, where it was sold and what its step means; its reference', () => {
    const m = orderModel(order(), 0)!;
    expect(m).toMatchObject({ key: 'order-or-1a2b3c4d', status: 'RESERVED', title: 'MONOLITHE', line: 'LIVE RELEASE · MONOLITHE — LIVE', sentence: ORDERS.sentence.RESERVED, reference: 'ORDER OR-1A2B3C4D', shipment: null });
    expect(orderModel(order({ channel: 'DRAW', release: 'Monolithe — Release I' }), 0)!.line).toBe('DRAW · MONOLITHE — RELEASE I');
    expect(orderModel(order({ channel: 'SALON', release: null }), 0)!.line).toBe('THE PRIVATE SALON');
    for (const s of ['PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] as const) expect(orderModel(order({ status: s }), 0)!.sentence).toBe(ORDERS.sentence[s]);
  });

  it('once shipped: the carrier, the tracking number and TRACK THE SHIPMENT to the carrier\'s page (https only)', () => {
    const m = orderModel(order({ status: 'SHIPPED', paidAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', shipment: SHIPMENT }), 0)!;
    expect(m.shipment).toEqual({
      rows: [
        ['CARRIER', 'COLISSIMO'],
        ['TRACKING NUMBER', '6A 1234 5678 901'],
      ],
      href: SHIPMENT.trackingUrl,
      label: 'Track the shipment 6A 1234 5678 901 on the site of Colissimo (opens in a new tab)',
    });
    expect(orderModel(order({ status: 'DELIVERED', shipment: SHIPMENT }), 0)!.shipment).not.toBeNull();
    expect(orderModel(order({ status: 'RETURNED', shipment: SHIPMENT }), 0)!.shipment).not.toBeNull();
    // A link that is not https is never offered; the number still is.
    for (const trackingUrl of ['http://example.com/?code=1', 'javascript:alert(1)', 'https://exa mple.com']) {
      expect(orderModel(order({ status: 'SHIPPED', shipment: { ...SHIPMENT, trackingUrl } }), 0)!.shipment).toMatchObject({ href: null, rows: [['CARRIER', 'COLISSIMO'], ['TRACKING NUMBER', SHIPMENT.trackingNumber]] });
    }
    // Before it ships, none.
    expect(orderModel(order({ status: 'PAID', shipment: SHIPMENT }), 0)!.shipment).toBeNull();
  });

  it('leaves out an order it cannot read, never guessed; keeps the server\'s order', () => {
    const list = [
      order({ reference: 'OR-AAAAAAAA' }),
      order({ reference: 'LR-AAAAAAAA' }),
      order({ status: 'LOST' as never }),
      order({ channel: 'SHOP' as never }),
      order({ reservedAt: null as never }),
      order({ reference: 'OR-BBBBBBBB', status: 'PAID' }),
    ];
    expect(orderModels(list, 0).map((m) => m.reference)).toEqual(['ORDER OR-AAAAAAAA', 'ORDER OR-BBBBBBBB']);
  });

  it('lists its documents (M6): the invoice and the credit note with their numbers, the care guide, the ownership certificate; a number it cannot read left out', () => {
    const D = ORDERS.documents;
    // A server before the documents: none.
    expect(orderModel(order(), 0)!.documents).toEqual([]);
    const all = order({
      status: 'DELIVERED',
      documents: { invoice: { number: 'INV-2026-000001', issuedAt: '2026-10-06T09:00:00.000Z' }, creditNote: { number: 'CN-2026-000002', issuedAt: '2026-10-09T09:00:00.000Z' }, careGuide: true, certificate: true },
    });
    expect(orderDocuments(all)).toEqual([
      { kind: 'INVOICE', label: 'INVOICE', number: 'INV-2026-000001', ariaLabel: 'Download the invoice INV-2026-000001 (PDF)', file: 'invoice' },
      { kind: 'CREDIT_NOTE', label: 'CREDIT NOTE', number: 'CN-2026-000002', ariaLabel: 'Download the credit note CN-2026-000002 (PDF)', file: 'credit-note' },
      { kind: 'CARE_GUIDE', label: 'CARE GUIDE', number: null, ariaLabel: 'The care guide of MONOLITHE', file: null },
      { kind: 'CERTIFICATE', label: 'OWNERSHIP CERTIFICATE', number: null, ariaLabel: 'Download the ownership certificate of your MONOLITHE (PDF)', file: 'certificate' },
    ]);
    expect(orderModel(all, 0)!.documents).toEqual(orderDocuments(all));
    expect(orderModel(all, 0)!.id).toBe(all.id);
    // Only what the server lists; a number that is not one, or of the other kind, never shown.
    const none = { invoice: null, creditNote: null, careGuide: false, certificate: false };
    expect(orderDocuments(order({ documents: none }))).toEqual([]);
    expect(orderDocuments(order({ documents: { ...none, careGuide: true } })).map((d) => d.kind)).toEqual(['CARE_GUIDE']);
    for (const number of ['INV-26-1', 'CN-2026-000001', '<b>', '']) {
      expect(orderDocuments(order({ documents: { ...none, invoice: { number, issuedAt: '2026-10-06T09:00:00.000Z' } } })), number).toEqual([]);
    }
    expect(orderDocuments(order({ documents: { ...none, creditNote: { number: 'INV-2026-000001', issuedAt: '2026-10-06T09:00:00.000Z' } } }))).toEqual([]);
    expect(orderDocuments(order({ documents: 'x' as never }))).toEqual([]);
    expect([D.title, D.careGuide, D.certificate]).toEqual(['DOCUMENTS', 'CARE GUIDE', 'OWNERSHIP CERTIFICATE']);
  });

  it('writes the brand\'s English: no word of BRAND §4.5 (nor "product"), no exclamation', () => {
    const D = ORDERS.documents;
    const words = [
      JSON.stringify(ORDERS),
      ORDERS.trackLabel('6A1234', 'Colissimo'),
      ORDERS.reference('OR-1A2B3C4D'),
      D.invoiceLabel('INV-2026-000001'),
      D.creditNoteLabel('CN-2026-000001'),
      D.certificateLabel('MONOLITHE'),
      D.careGuideLabel('MONOLITHE'),
    ].join('\n');
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
