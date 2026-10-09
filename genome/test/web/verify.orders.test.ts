/**
 * MY PIECES' orders (plan LIVE RELEASE+, step S3): an order of the account as its card in YOUR ORDERS shows it
 * (orders-model.ts), and the copy. Pure: no DOM. The page itself is driven in Chromium by verify.orders.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { ORDERS } from '../../src/web/verify/copy.js';
import { ORDER_PATH, orderAddress, orderClaim, orderDate, orderDocuments, orderEngraving, orderModel, orderModels, orderRequest, orderReturns, orderRows, orderSteps, shippingValue } from '../../src/web/verify/orders-model.js';
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
  it('reads RESERVED · PAID · IN PREPARATION · SHIPPED · DELIVERED, each reached with its date, the current one marked, those to come without one', () => {
    // Plan NEXT LOT §3.6.A: IN PREPARATION, a step of the card only, between PAID and SHIPPED.
    expect(ORDER_PATH).toEqual(['RESERVED', 'PAID', 'IN_PREPARATION', 'SHIPPED', 'DELIVERED']);
    expect(steps(order())).toEqual([
      ['RESERVED', '5 OCT 2026', 'current'],
      ['PAID', '', 'next'],
      ['IN PREPARATION', '', 'next'],
      ['SHIPPED', '', 'next'],
      ['DELIVERED', '', 'next'],
    ]);
    // Several steps reached in the year of the first: each by its day and month (C24, C32: five columns hold no year).
    const shipped = order({ status: 'SHIPPED', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: '2026-10-07T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', shipment: SHIPMENT });
    expect(steps(shipped)).toEqual([
      ['RESERVED', '5 OCT', 'done'],
      ['PAID', '6 OCT', 'done'],
      ['IN PREPARATION', '7 OCT', 'done'],
      ['SHIPPED', '8 OCT', 'current'],
      ['DELIVERED', '', 'next'],
    ]);
    // A step of another year says its own.
    expect(steps(order({ status: 'PAID', reservedAt: '2026-12-30T10:00:00.000Z', paidAt: '2027-01-04T10:00:00.000Z' })).slice(0, 2)).toEqual([
      ['RESERVED', '30 DEC', 'done'],
      ['PAID', '4 JAN 2027', 'current'],
    ]);
    const delivered = order({ status: 'DELIVERED', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', deliveredAt: '2026-10-10T10:00:00.000Z', shipment: SHIPMENT });
    expect(steps(delivered).map((s) => s[2])).toEqual(['done', 'done', 'done', 'done', 'current']);
  });

  it('IN PREPARATION (plan NEXT LOT §3.6.A): current once paid with its piece assigned, its date the server\'s; never while waiting; kept once reached', () => {
    // PAID without its piece (waiting for supplier stock, never said): PAID current, its sentence.
    const waiting = order({ status: 'PAID', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: null });
    expect(steps(waiting).map((s) => [s[0], s[2]])).toEqual([
      ['RESERVED', 'done'],
      ['PAID', 'current'],
      ['IN PREPARATION', 'next'],
      ['SHIPPED', 'next'],
      ['DELIVERED', 'next'],
    ]);
    expect(orderModel(waiting, 0)!.sentence).toBe(ORDERS.sentence.PAID);
    // PAID with its piece: IN PREPARATION current, dated, with its sentence.
    const preparing = order({ status: 'PAID', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: '2026-10-07T09:00:00.000Z' });
    expect(steps(preparing)).toEqual([
      ['RESERVED', '5 OCT', 'done'],
      ['PAID', '6 OCT', 'done'],
      ['IN PREPARATION', '7 OCT', 'current'],
      ['SHIPPED', '', 'next'],
      ['DELIVERED', '', 'next'],
    ]);
    expect(orderModel(preparing, 0)!.sentence).toBe(ORDERS.sentence.IN_PREPARATION);
    // RESERVED with its piece assigned stays RESERVED until paid (§3.6.A).
    expect(steps(order({ preparingAt: '2026-10-05T19:00:00.000Z' })).map((s) => s[2])).toEqual(['current', 'next', 'next', 'next', 'next']);
    // An order shipped before IN PREPARATION existed: the step done, without a date.
    const before = order({ status: 'SHIPPED', paidAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-08T15:30:00.000Z', shipment: SHIPMENT });
    expect(steps(before)[2]).toEqual(['IN PREPARATION', '', 'done']);
    // RETURNED keeps the step it reached; CANCELLED while waiting never shows it.
    const returned = order({ status: 'RETURNED', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: '2026-10-07T09:00:00.000Z', shippedAt: '2026-10-08T09:00:00.000Z', returnedAt: '2026-10-12T08:00:00.000Z', shipment: SHIPMENT });
    expect(steps(returned).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'IN PREPARATION', 'SHIPPED', 'RETURNED']);
    const cancelled = order({ status: 'CANCELLED', paidAt: '2026-10-06T09:00:00.000Z', preparingAt: null, cancelledAt: '2026-10-07T08:00:00.000Z' });
    expect(steps(cancelled).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'CANCELLED']);
    // A delivery looked into: one sentence in place of the step's.
    expect(orderModel(order({ status: 'SHIPPED', shipment: SHIPMENT, deliveryIssue: true }), 0)!.sentence).toBe(ORDERS.deliveryIssue);
    expect(orderModel(order({ status: 'SHIPPED', shipment: SHIPMENT, deliveryIssue: false }), 0)!.sentence).toBe(ORDERS.sentence.SHIPPED);
  });

  it('a CANCELLED or RETURNED order: the steps it reached, then that end with its date', () => {
    expect(steps(order({ status: 'CANCELLED', cancelledAt: '2026-10-06T08:00:00.000Z' }))).toEqual([
      ['RESERVED', '5 OCT', 'done'],
      ['CANCELLED', '6 OCT', 'current'],
    ]);
    expect(steps(order({ status: 'CANCELLED', paidAt: '2026-10-06T08:00:00.000Z', cancelledAt: '2026-10-07T08:00:00.000Z' })).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'CANCELLED']);
    // Returned on its way (SHIPPED → RETURNED), or once delivered.
    const onItsWay = order({ status: 'RETURNED', paidAt: '2026-10-06T08:00:00.000Z', shippedAt: '2026-10-07T08:00:00.000Z', returnedAt: '2026-10-12T08:00:00.000Z', shipment: SHIPMENT });
    expect(steps(onItsWay)).toEqual([
      ['RESERVED', '5 OCT', 'done'],
      ['PAID', '6 OCT', 'done'],
      ['SHIPPED', '7 OCT', 'done'],
      ['RETURNED', '12 OCT', 'current'],
    ]);
    expect(steps(order({ ...onItsWay, deliveredAt: '2026-10-09T08:00:00.000Z' })).map((s) => s[0])).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED']);
  });

  it('dates each step on this phone\'s calendar', () => {
    // 23:30 UTC is the next day in Paris (+120 min), the same day in New York (−240 min).
    expect(orderDate('2026-10-05T23:30:00.000Z', 120)).toBe('6 OCT 2026');
    expect(orderDate('2026-10-05T23:30:00.000Z', -240)).toBe('5 OCT 2026');
    expect(orderDate('not a date', 0)).toBe('');
    expect(orderDate(null, 0)).toBe('');
    expect(orderDate('2026-10-05T23:30:00.000Z', 120, { year: false })).toBe('6 OCT');
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
      expect(orderSteps(reserved).map((s) => s.date)).toEqual(['15 JUL', '15 DEC', '', '', '']);
      expect(orderModels([reserved])[0]!.steps.map((s) => s.date)).toEqual(['15 JUL', '15 DEC', '', '', '']);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('says the size, the price, each add-on at its price and the TOTAL; TO BE CONFIRMED until Client Services enters them', () => {
    expect(orderRows(order())).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      // An add-on adds to the price (C24).
      ['ENGRAVING', `+ €${NBSP}250`],
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

  it('says a welcome gift (BP-19 T5): WELCOME GIFT · its tier, no price of its own, the order it travels with while it waits', () => {
    const gift = order({
      channel: 'GIFT',
      release: null,
      model: 'Anneau',
      size: { label: null },
      priceMinor: 0,
      currency: 'EUR',
      addons: [],
      withOrder: 'OR-9F8E7D6C',
      giftTier: 'PLATINE',
      shipping: { service: 'STANDARD', minor: 0, benefit: null, withOrder: 'OR-9F8E7D6C' },
    });
    const m = orderModel(gift, 0)!;
    expect(m.line).toBe('WELCOME GIFT · PLATINE');
    expect(m.sentence).toBe('Your welcome gift travels with order OR-9F8E7D6C.');
    expect(m.rows).toEqual([['SIZE', 'ONE SIZE'], ['PRICE', 'WELCOME GIFT'], ['SHIPPING', 'WITH ORDER OR-9F8E7D6C']]);
    // Once shipped, its step says it.
    expect(orderModel({ ...gift, status: 'SHIPPED', paidAt: '2026-10-06T09:00:00.000Z', shippedAt: '2026-10-07T09:00:00.000Z', shipment: SHIPMENT }, 0)!.sentence).toBe(ORDERS.sentence.SHIPPED);
    // A size still to choose, and an unknown tier: TO BE CONFIRMED, the channel alone.
    expect(orderModel({ ...gift, size: null, giftTier: null }, 0)!.line).toBe('WELCOME GIFT');
  });

  it('takes the CREDIT off the TOTAL (BP-19 T5): − € 50, never on a price to be confirmed', () => {
    expect(orderRows(order({ addons: [], creditMinor: 5_000 }))).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['CREDIT', `\u2212 €${NBSP}50`],
      ['TOTAL', `€${NBSP}4${NBSP}750`],
    ]);
    expect(orderRows(order({ creditMinor: 5_000, shipping: { service: 'STANDARD', minor: 2_000, benefit: null, withOrder: null } })).at(-1)).toEqual(['TOTAL', `€${NBSP}5${NBSP}020`]);
    expect(orderRows(order({ addons: [], creditMinor: 0 }))).toEqual(orderRows(order({ addons: [] })));
    expect(orderRows(order({ addons: [], priceMinor: null, currency: null, creditMinor: 5_000 })).map((r) => r[0])).toEqual(['SIZE', 'PRICE']);
  });

  it('says its SHIPPING (BP-19 T4): free by its tier, at its fee (EXPRESS named), with the order it travels with; no row without shipping; the TOTAL with a fee', () => {
    const ship = (shipping: AccountOrder['shipping'], extra: Partial<AccountOrder> = {}) => orderRows(order({ addons: [], shipping, ...extra }));
    expect(ship({ service: 'STANDARD', minor: 0, benefit: 2, withOrder: null })).toEqual([['SIZE', '52'], ['PRICE', `€${NBSP}4${NBSP}800`], ['SHIPPING', 'FREE · PLATINE']]);
    expect(ship({ service: 'EXPRESS', minor: 0, benefit: 3, withOrder: null })[2]).toEqual(['SHIPPING', 'FREE EXPRESS · PALLADIUM']);
    // A fee: the row, and the TOTAL with it.
    expect(ship({ service: 'STANDARD', minor: 2_000, benefit: null, withOrder: null })).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['SHIPPING', `€${NBSP}20`],
      ['TOTAL', `€${NBSP}4${NBSP}820`],
    ]);
    expect(ship({ service: 'EXPRESS', minor: 4_000, benefit: null, withOrder: null })[2]).toEqual(['SHIPPING', `EXPRESS · €${NBSP}40`]);
    // Travelling with another order: that order carries the fee, no TOTAL of its own for it.
    expect(ship({ service: 'STANDARD', minor: 0, benefit: null, withOrder: 'OR-9F8E7D6C' })).toEqual([['SIZE', '52'], ['PRICE', `€${NBSP}4${NBSP}800`], ['SHIPPING', 'WITH ORDER OR-9F8E7D6C']]);
    // No shipping (an order of before, or below PLATINE without a fee): no row, as before.
    expect(ship(null)).toEqual(orderRows(order({ addons: [] })));
    expect(ship(undefined)).toEqual(orderRows(order({ addons: [] })));
    // With add-ons and a fee: the TOTAL counts both. A fee in no currency the app can say: no row.
    expect(orderRows(order({ shipping: { service: 'STANDARD', minor: 2_000, benefit: null, withOrder: null } })).at(-1)).toEqual(['TOTAL', `€${NBSP}5${NBSP}070`]);
    expect(shippingValue({ shipping: { service: 'STANDARD', minor: 2_000, benefit: null, withOrder: null }, currency: null })).toBeNull();
    expect(ORDERS.channel.GIFT).toBe('WELCOME GIFT');
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
    // The private salon has no release: its model follows it, with its variant (C32).
    expect(orderModel(order({ channel: 'SALON', release: null }), 0)!.line).toBe('THE PRIVATE SALON · MONOLITHE');
    expect(orderModel(order({ channel: 'SALON', release: null, model: 'Zenith', modelVariant: 'Gold' }), 0)!.line).toBe('THE PRIVATE SALON · ZENITH IN GOLD');
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
      { kind: 'INVOICE', label: 'INVOICE', number: 'INV-2026-000001', ariaLabel: 'Download the invoice INV-2026-000001 (PDF)', file: 'invoice', byNumber: false },
      { kind: 'CREDIT_NOTE', label: 'CREDIT NOTE', number: 'CN-2026-000002', ariaLabel: 'Download the credit note CN-2026-000002 (PDF)', file: 'credit-note', byNumber: false },
      { kind: 'CARE_GUIDE', label: 'CARE GUIDE', number: null, ariaLabel: 'The care guide of MONOLITHE', file: null, byNumber: false },
      { kind: 'CERTIFICATE', label: 'OWNERSHIP CERTIFICATE', number: null, ariaLabel: 'Download the ownership certificate of your MONOLITHE (PDF)', file: 'certificate', byNumber: false },
    ]);
    // Plan NEXT LOT §3.6.C: its other documents (an engraving added, then removed, after payment), in order of issue, after
    // the invoice and the credit note, each saved by its number; a number of the other kind, or none, left out.
    const others = order({
      status: 'PAID',
      documents: {
        invoice: { number: 'INV-2026-000001', issuedAt: '2026-10-06T09:00:00.000Z' },
        creditNote: null,
        others: [
          { kind: 'INVOICE', number: 'INV-2026-000003', issuedAt: '2026-10-07T09:00:00.000Z' },
          { kind: 'CREDIT_NOTE', number: 'CN-2026-000004', issuedAt: '2026-10-08T09:00:00.000Z' },
          { kind: 'INVOICE', number: 'CN-2026-000005', issuedAt: '2026-10-08T09:00:00.000Z' },
        ],
        careGuide: true,
        certificate: false,
      },
    });
    expect(orderDocuments(others).map((d) => [d.label, d.number, d.file, d.byNumber])).toEqual([
      ['INVOICE', 'INV-2026-000001', 'invoice', false],
      ['INVOICE', 'INV-2026-000003', null, true],
      ['CREDIT NOTE', 'CN-2026-000004', null, true],
      ['CARE GUIDE', null, null, false],
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

describe('YOUR NEW CLAIM CODE on an order (plan NEXT LOT §3.4)', () => {
  const waiting = { status: 'WAITING' as const, madeAt: '2026-10-07T12:02:00.000Z' };

  it('shows its block only while a new claim code waits (claimCode.status WAITING), never with the code itself', () => {
    // A server before it, or no code waiting: no block.
    expect(orderModel(order(), 0)!.claim).toBeNull();
    expect(orderModel(order({ claimCode: null }), 0)!.claim).toBeNull();
    // Anything but WAITING as the server says it is never guessed into a block.
    for (const claimCode of [{ status: 'READ', madeAt: waiting.madeAt }, { status: 'WAITING' }, { status: 'WAITING', madeAt: 7 }, 'WAITING', true]) {
      expect(orderClaim(order({ claimCode: claimCode as never })), JSON.stringify(claimCode)).toBeNull();
    }
    const m = orderModel(order({ status: 'SHIPPED', modelVariant: 'Blue', shipment: SHIPMENT, claimCode: waiting }), 0)!;
    expect(m.claim).toEqual({
      madeAt: waiting.madeAt,
      registerable: true,
      saveLabel: 'Save the new certificate card of your MONOLITHE in blue (PDF)',
      registerLabel: 'Register your MONOLITHE in blue with this claim code',
    });
    expect(JSON.stringify(m.claim)).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  });

  it('offers REGISTER THIS PIECE on a shipped or delivered order only: a piece not received yet registers by its new card', () => {
    for (const status of ['SHIPPED', 'DELIVERED'] as const) expect(orderClaim(order({ status, claimCode: waiting }))!.registerable, status).toBe(true);
    for (const status of ['RESERVED', 'PAID'] as const) expect(orderClaim(order({ status, claimCode: waiting }))!.registerable, status).toBe(false);
    // Without a variant, the model alone.
    expect(orderClaim(order({ claimCode: waiting }))!.saveLabel).toBe('Save the new certificate card of your MONOLITHE (PDF)');
  });

  it('writes its words calmly: the block, the messages, the accessible names (the code read one character at a time)', () => {
    const C = ORDERS.claim;
    expect([C.label, C.show, C.register, C.copy, C.save]).toEqual(['YOUR NEW CLAIM CODE', 'SHOW THE CODE', 'REGISTER THIS PIECE', 'COPY CODE', 'SAVE YOUR NEW CARD']);
    expect(C.lead).toBe('ORBES Client Services has made a new claim code for this piece. The previous one no longer registers it. The new one is shown once only.');
    expect(C.shownOnce).toBe('This claim code is shown once: keep it now. ORBES cannot show it again.');
    expect(C.codeLabel('ABCD-EFGH-JKMN')).toBe('Your new claim code: A B C D, E F G H, J K M N');
    expect(C.registered).toBe('Your piece is registered to your account.');
  });
});

describe('ORDERS: the model\'s photograph above each order (plan NOCTURNE, addition 3)', () => {
  it('carries its model\'s cover photograph, named after the model and its variant; none without one, nor a link it cannot trust', () => {
    const ref = `/api/v1/media/${'c'.repeat(64)}`;
    expect(orderModel(order(), 0)!.photo).toBeNull();
    expect(orderModel(order({ imageUrl: null }), 0)!.photo).toBeNull();
    expect(orderModel(order({ imageUrl: ref, modelVariant: 'Steel' }), 0)!.photo).toEqual({ kind: 'model', src: ref, alt: 'The MONOLITHE model in steel, photographed by ORBES', caption: 'THE MODEL' });
    for (const imageUrl of [`${ref}?x`, 'https://example.com/a.webp', 'javascript:alert(1)']) expect(orderModel(order({ imageUrl }), 0)!.photo, imageUrl).toBeNull();
  });
});

describe('YOUR ORDERS: the collector\'s side of an order (plan NEXT LOT §3.6)', () => {
  const ADDRESS = { name: 'Jeanne Martin', lines: '12 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' };
  const editable = { address: true, engraving: true };
  const offer = { priceMinor: 3_000, included: false, maxLength: 20 };

  it('ENGRAVING (§3.6.C): its words with the price it took, counted in the TOTAL; the release\'s add-on paid for it once, its words alone', () => {
    // A Settings-priced engraving: « J.M. » · + € 30, in the TOTAL.
    const priced = order({ addons: [], engraving: { text: 'J.M.', priceMinor: 3_000 } });
    expect(orderRows(priced)).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['ENGRAVING', `« J.M. » · + €${NBSP}30`],
      ['TOTAL', `€${NBSP}4${NBSP}830`],
    ]);
    // The release's ENGRAVING add-on carries the price: the words alone, the TOTAL as before (never counted twice).
    const included = order({ engraving: { text: 'J.M.', priceMinor: null } });
    expect(orderRows(included)).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['ENGRAVING', `+ €${NBSP}250`],
      ['ENGRAVING', '« J.M. »'],
      ['TOTAL', `€${NBSP}5${NBSP}050`],
    ]);
    // Words of before, no price: shown, no TOTAL of their own.
    expect(orderRows(order({ addons: [], engraving: { text: 'A & B', priceMinor: null } }))).toEqual([
      ['SIZE', '52'],
      ['PRICE', `€${NBSP}4${NBSP}800`],
      ['ENGRAVING', '« A & B »'],
    ]);
  });

  it('ENGRAVING\'s link and sheet: ADD, CHANGE or ENTER; once paid, the documents it brings; once packing has begun, its line', () => {
    const E = ORDERS.engraving;
    expect(orderEngraving(order({ addons: [], editable, engravingOffer: offer }))).toMatchObject({ action: E.add, text: '', included: false, priceLine: E.price(`€${NBSP}30`), addNote: null, removable: false });
    // Paid: adding one brings its own invoice; removing a priced one, its credit note.
    expect(orderEngraving(order({ status: 'PAID', addons: [], editable, engravingOffer: offer }))!.addNote).toBe(E.paidAdd);
    expect(orderEngraving(order({ status: 'PAID', addons: [], editable, engravingOffer: offer, engraving: { text: 'J.M.', priceMinor: 3_000 } }))).toMatchObject({ action: E.change, text: 'J.M.', removable: true, removeNote: E.paidRemove, addNote: null });
    // A free one issues no document.
    expect(orderEngraving(order({ status: 'PAID', addons: [], editable, engravingOffer: { ...offer, priceMinor: 0 } }))!.addNote).toBeNull();
    // The release's add-on: ENTER YOUR ENGRAVING, then CHANGE; no price, no REMOVE.
    const addon = { priceMinor: null, included: true, maxLength: 20 };
    expect(orderEngraving(order({ editable, engravingOffer: addon }))).toMatchObject({ action: E.enter, included: true, priceLine: E.included, removable: false, removeNote: null });
    expect(orderEngraving(order({ status: 'PAID', editable, engravingOffer: addon, engraving: { text: 'J.M.', priceMinor: null } }))).toMatchObject({ action: E.change, removable: false, removeNote: null });
    // None offered: no link.
    expect(orderEngraving(order({ addons: [], editable: { address: true, engraving: false }, engravingOffer: null }))).toBeNull();
    // Packing has begun (its address no longer the collector's): the line in place of the link.
    const packing = order({ status: 'PAID', address: ADDRESS, editable: { address: false, engraving: false }, engravingOffer: offer, engraving: { text: 'J.M.', priceMinor: 3_000 } });
    expect(orderEngraving(packing)).toMatchObject({ action: null, locked: E.locked });
    expect(orderEngraving({ ...packing, engraving: null })).toBeNull();
    // An order travelling with another (a LIVE entry's second piece, the release's ENGRAVING add-on): packing begun, the
    // same line in place of the link, though its address is its parent's.
    const travelling = order({ status: 'PAID', withOrder: 'OR-3F9A21C4', addressOf: 'OR-3F9A21C4', editable: { address: false, engraving: false }, engravingOffer: addon, engraving: { text: 'C.L.', priceMinor: null } });
    expect(orderEngraving(travelling)).toMatchObject({ action: null, locked: E.locked, text: 'C.L.' });
    expect(orderEngraving(travelling)!.locked).toBe(ORDERS.engraving.locked);
    expect(orderEngraving(travelling)!.action).toBeNull();
    // Still the collector's to change while packing has not begun.
    expect(orderEngraving({ ...travelling, editable: { address: false, engraving: true } })).toMatchObject({ action: E.change, locked: null });
    // Shipped: neither link nor line.
    expect(orderEngraving({ ...travelling, status: 'SHIPPED', shipment: SHIPMENT })).toBeNull();
  });

  it('DELIVERY ADDRESS (§3.6.B): its lines with CHANGE, ADD THE DELIVERY ADDRESS, packing begun, read once shipped, none once cancelled; the order it travels with', () => {
    const A = ORDERS.address;
    expect(orderAddress(order({ address: ADDRESS, editable }))).toEqual({
      state: 'editable',
      lines: ['Jeanne Martin', '12 rue de la Paix', '75002 Paris', 'France', '+33 6 12 34 56 78'],
      sentence: null,
      current: { name: 'Jeanne Martin', address: ADDRESS.lines, country: 'FR', phone: '+33 6 12 34 56 78' },
    });
    expect(orderAddress(order({ address: null, editable }))).toEqual({ state: 'empty', lines: [], sentence: A.empty, current: null });
    expect(orderAddress(order({ status: 'PAID', address: ADDRESS, editable: { address: false, engraving: false } }))).toMatchObject({ state: 'locked', sentence: A.locked });
    expect(orderAddress(order({ status: 'SHIPPED', address: ADDRESS, editable: { address: false, engraving: false }, shipment: SHIPMENT }))).toMatchObject({ state: 'read', sentence: null });
    // An address of before: its country and phone not entered, left out.
    expect(orderAddress(order({ status: 'DELIVERED', address: { name: 'J. Martin', lines: 'Paris', country: null, phone: null } }))!.lines).toEqual(['J. Martin', 'Paris']);
    expect(orderAddress(order({ status: 'CANCELLED', address: ADDRESS, cancelledAt: '2026-10-06T08:00:00.000Z' }))).toBeNull();
    // A welcome gift travels with its order, to its address: no CHANGE; its order cancelled, ORBES Client Services says.
    const gift = order({ channel: 'GIFT', withOrder: 'OR-3F9A21C4', addressOf: 'OR-3F9A21C4', address: ADDRESS, editable: { address: false, engraving: false } });
    expect(orderAddress(gift)).toEqual({ state: 'travels', lines: [], sentence: A.travels('OR-3F9A21C4'), current: null });
    const parent = order({ id: '3f9a21c4-0000-4000-8000-000000000002', reference: 'OR-3F9A21C4', status: 'CANCELLED', cancelledAt: '2026-10-06T08:00:00.000Z' });
    expect(orderModels([gift, parent], 0)[0]!.address!.sentence).toBe(A.travelsCancelled);
    // A server before it: nothing said.
    expect(orderAddress(order())).toBeNull();
  });

  it('RETURNS AND EXCHANGES (§3.6.D): until when, each other size in stock or not; none on a gift, before delivery, or for a model of one size\'s exchange', () => {
    const delivered = order({ status: 'DELIVERED', deliveredAt: '2026-10-07T10:00:00.000Z', returnable: { until: '2026-10-21T10:00:00.000Z', sizes: [{ label: '50', available: true }, { label: '54', available: false }] } });
    expect(orderReturns(delivered, 0)).toEqual({
      lead: ORDERS.returns.lead('21 OCT 2026'),
      sizes: [
        { label: '50', available: true },
        { label: '54', available: false },
      ],
      concerning: 'ORDER OR-1A2B3C4D · MONOLITHE · SIZE 52',
      // A server before plan CUSTOMER INTELLIGENCE §3.7 sends no YOUR SIZES' size: none preselected.
      savedSize: null,
    });
    expect(orderReturns({ ...delivered, returnable: { until: '2026-10-21T10:00:00.000Z', sizes: [] } }, 0)!.sizes).toEqual([]);
    expect(orderReturns({ ...delivered, channel: 'GIFT' }, 0)).toBeNull();
    expect(orderReturns({ ...delivered, status: 'SHIPPED' }, 0)).toBeNull();
    expect(orderReturns({ ...delivered, returnable: null }, 0)).toBeNull();
  });

  it('its request (§3.6.D): asked with the return address (or that it follows in MESSAGES), received, exchanged for its order, answered in MESSAGES', () => {
    const R = ORDERS.returns;
    const base = { kind: 'EXCHANGE' as const, status: 'OPEN' as const, openedAt: '2026-10-12T10:00:00.000Z', receivedAt: null, sizeLabel: '18', returnAddress: 'ORBES LOGISTICS\n1 rue du Port\n13002 Marseille', outcome: null, exchangeOrder: null };
    const o = (c: Partial<typeof base> | Record<string, unknown>) => order({ status: 'DELIVERED', case: { ...base, ...c } as never });
    expect(orderRequest(o({}), 0)).toEqual({
      label: 'EXCHANGE REQUESTED · SIZE 18 · 12 OCT 2026',
      received: null,
      sentences: [R.sendBack('OR-1A2B3C4D')],
      returnAddress: ['ORBES LOGISTICS', '1 rue du Port', '13002 Marseille'],
    });
    expect(orderRequest(o({ kind: 'RETURN', sizeLabel: null, returnAddress: null }), 0)).toEqual({ label: 'RETURN REQUESTED · 12 OCT 2026', received: null, sentences: [R.noReturnAddress], returnAddress: null });
    expect(orderRequest(o({ status: 'RECEIVED', receivedAt: '2026-10-15T10:00:00.000Z' }), 0)).toMatchObject({ received: 'PIECE RECEIVED · 15 OCT 2026', sentences: [R.receivedText], returnAddress: null });
    expect(orderRequest(o({ status: 'CLOSED', outcome: 'EXCHANGE', exchangeOrder: { id: '9b2c0000-0000-4000-8000-000000000003', reference: 'OR-9B2C0000' } }), 0)!.label).toBe('EXCHANGED FOR SIZE 18 · ORDER OR-9B2C0000');
    // A return decided: the order reads RETURNED, with its credit note; nothing more here.
    expect(orderRequest(o({ kind: 'RETURN', status: 'CLOSED', outcome: 'REFUND' }), 0)).toBeNull();
    expect(orderRequest(o({ status: 'CANCELLED' }), 0)).toMatchObject({ sentences: [R.answered] });
    expect(orderRequest(order(), 0)).toBeNull();
  });

  it('names a size not in stock in the exchange sheet as a screen reader says it, a label that carries its word as written (§3.6.D)', () => {
    const R = ORDERS.returns;
    expect(R.sizeOut('54')).toBe('Size 54, not in stock');
    expect(R.sizeOut('SIZE 58')).toBe('SIZE 58, not in stock');
    expect(R.sizeOut('ONE SIZE')).toBe('ONE SIZE, not in stock');
  });

  it('an EXCHANGE order (§3.6.D) is kept and reads SIZE EXCHANGE, with its model, size and steps like any order', () => {
    const m = orderModel(order({ channel: 'EXCHANGE', release: null, status: 'PAID', paidAt: '2026-10-16T10:00:00.000Z' }), 0)!;
    expect(m.line).toBe('SIZE EXCHANGE');
    expect(m.steps.map((s) => s.label)).toEqual(['RESERVED', 'PAID', 'IN PREPARATION', 'SHIPPED', 'DELIVERED']);
  });

  it('writes the brand\'s English in its new words: no exclamation, no word of §4.5, a piece and never a product', () => {
    const said = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => unknown)('OR-3F9A21C4', '12 OCT 2026'))] : v && typeof v === 'object' ? Object.values(v).flatMap(said) : [];
    const words = [ORDERS.address, ORDERS.addressFields, ORDERS.engraving, ORDERS.returns, ORDERS.deliveryIssue, ORDERS.sentence, ORDERS.step].flatMap(said).join('\n');
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
    expect(words).not.toMatch(/product|atelier|handmade|craft/i);
  });
});
