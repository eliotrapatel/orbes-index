/**
 * The console's orders and settings (plan LIVE RELEASE+, step S2), its returns and invoices (step S4) — the pure models
 * and the API client: model/orders.ts, model/order-cases.ts and model/invoices.ts against the server's rules (their
 * bounds mirrored and compared), the board's and the invoices' filters, what each role may do, the
 * dialogs' checks and what they send (a return included), the packing slip without a price; AdminApi's paths, methods
 * and bodies.
 */
import { describe, expect, it } from 'vitest';
import { ORDER_ALERT_LIMITS, ORDER_LATE_RULES as SERVER_LATE_RULES } from '../../src/server/services/fulfilment.js';
import { ORDER_AMOUNT_MAX_MINOR as SERVER_AMOUNT_MAX, ORDER_CURRENCIES as SERVER_CURRENCIES, ORDER_TEXT_LIMITS, trackingLink as serverTrackingLink } from '../../src/server/services/orders.js';
import { CARRIER_NAME_MAX, checkTrackingUrl, LOCATION_NAME_MAX, STOCK_MOVE_MAX, STOCK_NOTE_MAX, TRACKING_URL_MAX } from '../../src/server/services/stock.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatMoney } from '../../src/web/admin/model/live.js';
import { formatCount } from '../../src/web/admin/format.js';
import { canOpenReturn, caseActions, CASE_REASON_LABELS, decideInput, decideProblem, openCaseInput, openCaseProblem, outcomeOptions, pastReturnWindow } from '../../src/web/admin/model/order-cases.js';
import { buyerLine, invoiceFilters, invoiceMonths, INVOICE_SEARCH_MAX, KIND_FILTER_LABELS, linkedDocument, monthLabel, signedMoney } from '../../src/web/admin/model/invoices.js';
import {
  ALERT_LIMITS,
  alertsInput,
  alertsProblem,
  boardFilters,
  buyerInput,
  buyerProblem,
  buyerSection,
  canChooseGiftSize,
  countryOptions,
  engravingLine,
  engravingPriceText,
  engravingPricesInput,
  engravingPricesProblem,
  engravingPricesValues,
  carrierProblem,
  cardHolds,
  CHANNEL_LABELS,
  creditActions,
  creditAppliedLine,
  creditAvailableLine,
  creditProblem,
  creditValue,
  delaysLine,
  giftHeaderLine,
  giftLine,
  giftRows,
  giftSavedSizeHint,
  giftSizeOptions,
  durationText,
  GIFT_SIZE_TERMS,
  EVENT_LABELS,
  eventActor,
  LATE_LABELS,
  lateSentence,
  LOGISTICS_LIMITS,
  DOCUMENT_LABELS,
  noteProblem,
  ORDER_AMOUNT_MAX_MINOR,
  ORDER_LIMITS,
  orderActions,
  packingSlip,
  RETURN_LABELS,
  shipWaitsFor,
  shippingLine,
  sizeText,
  termsChange,
  termsProblem,
  termsValues,
  trackingLink,
  trackingUrlProblem,
  viewHolds,
} from '../../src/web/admin/model/orders.js';
import { can } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import { ORDER_CURRENCIES, ORDER_LATE_RULES, type OrderCard, type OrderDetail, type OrderView } from '../../src/web/admin/types.js';

const ID = '0f8e7d6c-5b4a-4398-8877-665544332211';
const LOC = '11111111-2222-4333-8444-555555555555';

const view = (o: Partial<OrderView> = {}): OrderView => ({
  id: ID,
  reference: 'OR-0F8E7D6C',
  channel: 'SALON',
  source: { liveEntryId: null, piece: 1, dropEntryId: null, shopRequestId: 'r' },
  release: null,
  accountId: 'a',
  model: { id: 'm', name: 'MONOLITHE', variant: null },
  sizeLabel: null,
  skuId: null,
  priceMinor: null,
  currency: null,
  addons: [],
  surprise: null,
  engravingText: null,
  buyer: { name: null, address: null },
  status: 'RESERVED',
  reservedAt: '2026-11-01T09:00:00.000Z',
  paidAt: null,
  shippedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  returnedAt: null,
  location: { id: LOC, name: 'FRANCE WAREHOUSE' },
  reservation: null,
  shipment: null,
  productId: null,
  shopifyOrderId: null,
  shipping: { service: null, minor: null, benefit: null },
  withOrder: null,
  gifts: [],
  giftOf: null,
  credit: { available: [], applied: [] },
  return: null,
  invoices: [],
  events: [],
  ...o,
});

describe('the mirrors of the server', () => {
  it('holds the server\'s bounds, currencies, late rules and views', () => {
    expect(ORDER_LIMITS).toEqual({ ...ORDER_TEXT_LIMITS });
    expect(ORDER_AMOUNT_MAX_MINOR).toBe(SERVER_AMOUNT_MAX);
    expect([...ORDER_CURRENCIES]).toEqual([...SERVER_CURRENCIES]);
    expect([...ORDER_LATE_RULES]).toEqual([...SERVER_LATE_RULES]);
    expect(ALERT_LIMITS).toEqual(JSON.parse(JSON.stringify(ORDER_ALERT_LIMITS)));
    expect(LOGISTICS_LIMITS).toEqual({ locationName: LOCATION_NAME_MAX, carrierName: CARRIER_NAME_MAX, trackingUrl: TRACKING_URL_MAX });
    expect(trackingLink('https://t.example/?n={tracking}', '6A 1234 5678')).toBe(serverTrackingLink('https://t.example/?n={tracking}', '6A 1234 5678'));
  });

  it('refuses exactly the tracking links the server refuses', () => {
    for (const url of ['https://t.example/{tracking}', 'https://t.example/?a=1&n={tracking}', 'http://t.example/{tracking}', 'https://t.example/', 'https://t example/{tracking}', 'https://t.example/{tracking}{tracking}', `https://t.example/${'a'.repeat(500)}{tracking}`, '']) {
      let server: string | null = null;
      try {
        checkTrackingUrl(url);
      } catch (e) {
        server = (e as Error).message;
      }
      expect(trackingUrlProblem(url) === null, url).toBe(server === null);
    }
  });
});

describe('the board', () => {
  it('reads its filters from the page\'s query, only the values the server takes', () => {
    expect(boardFilters({ channel: 'LIVE', dropId: ID, locationId: LOC, late: 'true', q: '  OR-0F8E ' })).toEqual({ channel: 'LIVE', dropId: ID, locationId: LOC, late: true, q: 'OR-0F8E' });
    expect(boardFilters({ channel: 'SHOP', dropId: 'x', late: 'yes', q: '   ' })).toEqual({});
  });

  it('says why an order is late, since when, and the delays, the marks without a figure (the display face sets them)', () => {
    const d = { reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 1 };
    expect(ORDER_LATE_RULES.map((r) => lateSentence(r, d))).toEqual([
      'Reserved for over 2 days, not paid yet.',
      'Paid, its piece ready, and not shipped for over 3 days.',
      'Shipped over 10 days ago, not delivered yet.',
      'Delivered over 1 day ago, its piece not registered by its buyer.',
    ]);
    expect(Object.values(LATE_LABELS).every((l) => !/\d/.test(l))).toBe(true);
    expect(delaysLine(d)).toBe('Reserved 2 days · paid and ready 3 days · shipped 10 days · delivered, not registered 1 day');
    const now = new Date('2026-11-05T12:30:00.000Z');
    expect(['2026-11-05T12:29:40.000Z', '2026-11-05T12:18:00.000Z', '2026-11-05T09:30:00.000Z', '2026-11-05T07:00:00.000Z', '2026-11-02T08:30:00.000Z', '2026-11-02T12:30:00.000Z'].map((s) => durationText(s, now))).toEqual([
      'under a minute',
      '12 min',
      '3 h',
      '5 h 30 min',
      '3 d 4 h',
      '3 d',
    ]);
  });

  it('says what an order holds or what fulfils it', () => {
    const card = (o: Partial<OrderCard>) => ({ status: 'RESERVED', reservation: null, piece: null, location: { id: LOC, name: 'FRANCE WAREHOUSE' }, sizeLabel: null, skuCode: null, ...o }) as OrderCard;
    expect(cardHolds(card({}))).toBe('Size to enter');
    expect(cardHolds(card({ skuCode: 'MNL', reservation: 'STOCK' }))).toBe('In stock at FRANCE WAREHOUSE');
    // Waiting for supplier stock (plan NEXT LOT §3.5): no more piece to make.
    expect(cardHolds(card({ skuCode: 'MNL', reservation: 'AWAITING' }))).toBe('Awaiting stock');
    expect(cardHolds(card({ status: 'SHIPPED', piece: 'O26-J-00184' }))).toBe('Piece O26-J-00184');
    expect(cardHolds(card({ status: 'CANCELLED' }))).toBe('—');
    // Its piece ready while its parcel waits for another order's (plan NEXT LOT §3.5.6.6): never LATE meanwhile.
    expect(cardHolds(card({ status: 'PAID', skuCode: 'MNL', reservation: 'STOCK', waitingForParcel: true }))).toBe('Waiting for the rest of its parcel');
    expect(viewHolds(view({ skuId: 's', reservation: 'STOCK' }))).toBe('In stock at FRANCE WAREHOUSE');
    expect(['order.create', 'order.pay', 'order.ship', 'order.deliver', 'order.cancel', 'order.return', 'order.location', 'order.terms', 'order.buyer', 'order.link'].every((a) => EVENT_LABELS[a])).toBe(true);
    expect(['order.serve', 'order.pack.start', 'order.pack.scan', 'order.pack.photo', 'order.pack.check', 'order.reship', 'order.exchange', 'order.case.open', 'order.case.receive', 'order.case.decide', 'order.case.cancel'].every((a) => EVENT_LABELS[a])).toBe(true);
    const e = (type: string, id: string | null) => ({ action: 'order.pay', status: 'PAID' as const, note: null, at: '', actor: { type, id } });
    expect([eventActor(e('admin', 'x'), { x: 'op@orbes.test' }), eventActor(e('admin', 'y'), {}), eventActor(e('system', null), {}), eventActor(e('account', 'a'), {})]).toEqual([
      'op@orbes.test',
      'A console user',
      'ORBES',
      'The collector',
    ]);
  });
});

describe('an order\'s shipping (plan NEXT-NINE, BP-19 T4)', () => {
  it('says it: free by its tier, at its fee, with the order it travels with, or None; Welcome gift as a channel', () => {
    expect(shippingLine(view({ shipping: { service: 'STANDARD', minor: 0, benefit: 2 } }))).toBe('Standard · free (PLATINE)');
    expect(shippingLine(view({ shipping: { service: 'EXPRESS', minor: 0, benefit: 3 } }))).toBe('Express · free (PALLADIUM)');
    expect(shippingLine(view({ currency: 'EUR', shipping: { service: 'STANDARD', minor: 2_000, benefit: null } }))).toBe('Standard · €\u00a020');
    expect(shippingLine(view({ withOrder: { id: 'p', reference: 'OR-12345678', shipment: null }, shipping: { service: 'STANDARD', minor: 0, benefit: null } }))).toBe('With OR-12345678');
    expect(shippingLine(view())).toBe('None');
    expect(CHANNEL_LABELS.GIFT).toBe('Welcome gift');
    expect(EVENT_LABELS['order.shipping']).toBe('Shipping');
  });

  it('enters a fee in the terms\' dialog while RESERVED: sent with its service, an empty fee clears it, never a fee on a free benefit\'s service', () => {
    const o = view({ priceMinor: 300_000, currency: 'EUR' });
    const a = orderActions(o, 'OPERATOR').terms;
    expect(termsValues(o)).toMatchObject({ shippingService: 'STANDARD', shippingFee: '' });
    expect(termsChange(o, { ...termsValues(o), shippingFee: '20' }, a)).toEqual({ shippingService: 'STANDARD', shippingMinor: 2_000 });
    expect(termsChange(o, { ...termsValues(o), shippingService: 'EXPRESS', shippingFee: '40.50' }, a)).toEqual({ shippingService: 'EXPRESS', shippingMinor: 4_050 });
    expect(termsProblem(o, { ...termsValues(o), shippingFee: 'twenty' }, a)).toBe('The shipping fee is an amount in units: 20, or 20.50; empty for no shipping.');
    const fee = view({ priceMinor: 300_000, currency: 'EUR', shipping: { service: 'STANDARD', minor: 2_000, benefit: null } });
    expect(termsChange(fee, { ...termsValues(fee), shippingFee: '' }, a)).toEqual({ shippingService: null, shippingMinor: null });
    const free = view({ priceMinor: 300_000, currency: 'EUR', shipping: { service: 'STANDARD', minor: 0, benefit: 2 } });
    expect(termsProblem(free, { ...termsValues(free), shippingFee: '20' }, a)).toBe('This order’s shipping is free with its tier: no fee is added to it.');
    expect(termsProblem(free, { ...termsValues(free), shippingService: 'EXPRESS', shippingFee: '35' }, a)).toBeNull();
    expect(termsProblem(free, termsValues(free), a)).toBe('Nothing has changed.');
  });
});

describe('an order\'s welcome gift and credit (plan NEXT-NINE, BP-19 T5)', () => {
  const grant = { grantId: 'g3', tier: 3 as const, balanceMinor: 5_000, currency: 'EUR', expiresAt: '2027-10-06T09:00:00.000Z' };
  const platineGift = { id: 'x', reference: 'OR-AAAA0001', model: 'ANNEAU', status: 'RESERVED' as const, sizeToChoose: false, tier: 2 as const };
  const palladiumGift = { id: 'y', reference: 'OR-BBBB0002', model: 'JONC', status: 'RESERVED' as const, sizeToChoose: true, tier: 3 as const };
  it('says the gift travelling with an order, and a GIFT order\'s tier and parent', () => {
    expect(giftRows(view())).toEqual([]);
    expect(giftLine(platineGift)).toBe('OR-AAAA0001 · ANNEAU · RESERVED');
    expect(giftLine({ ...platineGift, sizeToChoose: true })).toBe('OR-AAAA0001 · ANNEAU · Size to choose');
    expect(giftRows(view({ gifts: [platineGift] }))).toEqual([{ label: 'Welcome gift', id: 'x', line: 'OR-AAAA0001 · ANNEAU · RESERVED' }]);
    const g = view({ channel: 'GIFT', withOrder: { id: 'p', reference: 'OR-12345678', shipment: null }, giftOf: { tier: 2, sizes: [], savedSize: null } });
    expect(giftHeaderLine(g)).toBe('Welcome gift · PLATINE · travels with OR-12345678');
    expect(giftHeaderLine(view())).toBeNull();
    expect(EVENT_LABELS['order.gift']).toBe('Welcome gift added');
    expect(EVENT_LABELS['order.credit.apply']).toBe('Credit applied');
  });

  it('chooses a GIFT order\'s size among its model\'s; it is never paid alone, and its parent waits for that size', () => {
    const g = view({ channel: 'GIFT', priceMinor: 0, currency: 'EUR', withOrder: { id: 'p', reference: 'OR-12345678', shipment: null }, giftOf: { tier: 3, sizes: [{ skuId: 's1', label: '52', available: 2 }, { skuId: 's2', label: '54', available: 0 }], savedSize: null } });
    expect(giftSizeOptions(g)).toEqual([{ value: '52', label: '52 · 2 available' }, { value: '54', label: '54 · none available' }]);
    const a = orderActions(g, 'OPERATOR');
    expect(a.pay).toBe(false);
    expect(a.terms).toMatchObject({ size: true, price: false, shipping: false });
    // CHOOSE SIZE, its own dialog, while the size is To be confirmed; EDIT never holds it.
    expect(sizeText({ sizeLabel: null, skuKnown: false, gift: true })).toBe('To be confirmed');
    expect(sizeText({ sizeLabel: null, skuKnown: false })).toBe('To enter');
    expect(sizeText({ sizeLabel: '52', skuKnown: true, gift: true })).toBe('52');
    expect(canChooseGiftSize(g, a.terms)).toBe(true);
    expect(canChooseGiftSize(g, orderActions(g, 'AUDITOR').terms)).toBe(false);
    expect(canChooseGiftSize({ ...g, skuId: 's1', giftOf: { tier: 3, sizes: [], savedSize: null } }, a.terms)).toBe(false);
    expect(canChooseGiftSize(view({ priceMinor: 300_000, currency: 'EUR' }), orderActions(view(), 'OPERATOR').terms)).toBe(false);
    // AC-01: the collector's saved size is a hint only, never a choice: the dialog opens on no size.
    expect(giftSavedSizeHint(g)).toBeNull();
    const hinted = { ...g, giftOf: { ...g.giftOf!, savedSize: '52' } };
    expect(giftSavedSizeHint(hinted)).toBe('Saved size: 52 (YOUR SIZES)');
    expect(giftSavedSizeHint({ ...g, giftOf: { ...g.giftOf!, savedSize: '16.5 CM' } })).toBe('Saved size: 16.5 CM (YOUR SIZES)');
    expect(termsValues(hinted).giftSize).toBe('');
    expect(GIFT_SIZE_TERMS).toEqual({ size: true, price: false, engraving: false, shipping: false });
    expect(termsChange(g, { ...termsValues(g), giftSize: '54' }, GIFT_SIZE_TERMS)).toEqual({ sizeLabel: '54' });
    expect(termsProblem(g, termsValues(g), GIFT_SIZE_TERMS)).toBe('Nothing has changed.');
    expect(shipWaitsFor(g)).toBe('Its size is to be chosen.');
    expect(shipWaitsFor({ ...g, skuId: 's1', sizeLabel: '52' })).toBe('It is paid with OR-12345678.');
    const parent = view({ priceMinor: 300_000, currency: 'EUR', skuId: 's', sizeLabel: '52', reservation: 'STOCK', gifts: [{ ...platineGift, sizeToChoose: true }] });
    expect(orderActions(parent, 'OPERATOR').pay).toBe(false);
    expect(shipWaitsFor(parent)).toBe('Choose the welcome gift’s size first.');
    expect(orderActions({ ...parent, gifts: [platineGift] }, 'OPERATOR').pay).toBe(true);
  });

  it('lists both tiers\' gifts of one order, one row each, and MARK PAID waits for every size to be chosen', () => {
    // PLATINE and PALLADIUM reached at once: two GIFT orders travel with one order, PLATINE's first.
    const parent = view({ priceMinor: 300_000, currency: 'EUR', skuId: 's', sizeLabel: '52', reservation: 'STOCK', gifts: [platineGift, palladiumGift] });
    expect(giftRows(parent)).toEqual([
      { label: 'Welcome gift · PLATINE', id: 'x', line: 'OR-AAAA0001 · ANNEAU · RESERVED' },
      { label: 'Welcome gift · PALLADIUM', id: 'y', line: 'OR-BBBB0002 · JONC · Size to choose' },
    ]);
    // The second gift's size is to be chosen: no MARK PAID, and the step says why.
    expect(orderActions(parent, 'OPERATOR').pay).toBe(false);
    expect(shipWaitsFor(parent)).toBe('Choose the welcome gift’s size first.');
    // Chosen: paid with both.
    const chosen = { ...parent, gifts: [platineGift, { ...palladiumGift, sizeToChoose: false }] };
    expect(orderActions(chosen, 'OPERATOR').pay).toBe(true);
    expect(shipWaitsFor(chosen)).toBe('It ships once paid.');
    // A gift past RESERVED never holds its order back.
    expect(orderActions({ ...parent, gifts: [platineGift, { ...palladiumGift, status: 'CANCELLED' as const }] }, 'OPERATOR').pay).toBe(true);
  });

  it('says the credit available and applied, and offers APPLY within the balance and the price, REMOVE once applied', () => {
    expect(creditAvailableLine(view())).toBe('None');
    const o = view({ priceMinor: 3_000, currency: 'EUR', credit: { available: [grant], applied: [] } });
    expect(creditAvailableLine(o)).toBe('PALLADIUM €\u00a050 until 06 OCT 2027');
    expect(creditAppliedLine(o)).toBe('None');
    expect(creditActions(o, 'OPERATOR')).toEqual({ apply: true, remove: false });
    expect(creditActions(o, 'AUDITOR')).toEqual({ apply: false, remove: false });
    // Within the piece's price: € 30 here.
    expect(creditValue(o)).toBe('30');
    expect(creditProblem(o, { amount: '30' })).toBeNull();
    expect(creditProblem(o, { amount: '0' })).toBe('The credit is an amount in units above 0: 50, or 50.50.');
    expect(creditProblem(o, { amount: '31' })).toBe('At most €\u00a030: the credit left in EUR, within the piece’s price.');
    // Another currency, not priced, a GIFT order, past RESERVED: nothing to apply.
    expect(creditActions(view({ priceMinor: 3_000, currency: 'GBP', credit: { available: [grant], applied: [] } }), 'OPERATOR').apply).toBe(false);
    expect(creditActions(view({ credit: { available: [grant], applied: [] } }), 'OPERATOR').apply).toBe(false);
    expect(creditActions({ ...o, channel: 'GIFT' }, 'OPERATOR').apply).toBe(false);
    expect(creditActions({ ...o, status: 'PAID' }, 'OPERATOR').apply).toBe(false);
    const applied = view({
      priceMinor: 300_000,
      currency: 'EUR',
      credit: {
        available: [],
        applied: [
          { id: 'u1', grantId: 'g2', tier: 2, amountMinor: 2_000, appliedAt: 'x', releasedAt: 'y', releasedReason: 'REMOVED' },
          { id: 'u2', grantId: 'g2', tier: 2, amountMinor: 5_000, appliedAt: 'x', releasedAt: null, releasedReason: null },
        ],
      },
    });
    expect(creditAppliedLine(applied)).toBe('\u2212 €\u00a050 (PLATINE)');
    expect(creditActions(applied, 'OPERATOR')).toEqual({ apply: false, remove: true });
  });
});

describe('what a role may do with an order', () => {
  it('offers each step only where the server takes it, to an OPERATOR', () => {
    const reserved = view();
    expect(orderActions(reserved, 'AUDITOR')).toEqual({ pay: false, deliver: false, cancel: false, archive: false, location: false, terms: { size: false, price: false, engraving: false, shipping: false }, buyer: false });
    // Not priced yet: not paid (its invoice needs its price, step S4).
    expect(orderActions(reserved, 'OPERATOR')).toEqual({ pay: false, deliver: false, cancel: true, archive: false, location: true, terms: { size: true, price: true, engraving: true, shipping: true }, buyer: true });
    expect(orderActions(view({ priceMinor: 480_000, currency: 'EUR' }), 'OPERATOR').pay).toBe(true);
    const paidStock = view({ status: 'PAID', paidAt: 'x', skuId: 's', reservation: 'STOCK' });
    expect(orderActions(paidStock, 'OPERATOR')).toMatchObject({ pay: false, cancel: true, terms: { size: true, price: false, engraving: true } });
    const live = view({ channel: 'LIVE', skuId: 's', reservation: 'AWAITING', sizeLabel: '52', priceMinor: 1, currency: 'EUR' });
    // A LIVE RELEASE's order: its size and price are its release's; its shipping is entered while RESERVED (BP-19 T4).
    expect(orderActions(live, 'ADMIN').terms).toEqual({ size: false, price: false, engraving: true, shipping: true });
    // The shipping: RESERVED only, and never on an order travelling with another (its parent's).
    expect(orderActions(paidStock, 'OPERATOR').terms.shipping).toBe(false);
    expect(orderActions(view({ withOrder: { id: 'p', reference: 'OR-12345678', shipment: null } }), 'OPERATOR').terms.shipping).toBe(false);
    // No Link a piece any more (plan NEXT LOT §3.5.4.4, step 5.11e): the agent's packing scan binds it; Ship and Open a
    // return moved to the Shipping and Order case sections.
    expect(Object.keys(orderActions(live, 'OPERATOR'))).not.toEqual(expect.arrayContaining(['linkPiece']));
    expect(Object.keys(orderActions(live, 'OPERATOR'))).not.toContain('ship');
    expect(Object.keys(orderActions(live, 'OPERATOR'))).not.toContain('return');
    const linked = view({ status: 'PAID', paidAt: 'x', skuId: 's', reservation: 'STOCK', productId: 'O26-J-00184' });
    expect(orderActions(linked, 'OPERATOR')).toMatchObject({ location: false, terms: { size: false } });
    // Plan NEXT LOT §3.6.B: the buyer until it ships, as the server takes it (409 ORDER_CLOSED after).
    expect(orderActions(view({ status: 'SHIPPED', productId: 'O26-J-00184' }), 'OPERATOR')).toMatchObject({ deliver: true, cancel: false, location: false, buyer: false });
    expect(orderActions(view({ status: 'DELIVERED', productId: 'O26-J-00184' }), 'OPERATOR')).toMatchObject({ deliver: false, cancel: false });
    // To the archive (the piece retired): an ADMIN's alone.
    const delivered = view({ status: 'DELIVERED', productId: 'O26-J-00184' });
    expect([orderActions(delivered, 'OPERATOR').archive, orderActions(delivered, 'ADMIN').archive, orderActions(reserved, 'ADMIN').archive]).toEqual([false, true, false]);
    // The work sheets went with the Atelier (plan NEXT LOT §3.5.4.5); deciding a lost parcel is ADMIN's.
    expect([can('OPERATOR', 'manageOrders'), can('AUDITOR', 'manageOrders'), can('OPERATOR', 'manageLogistics'), can('ADMIN', 'manageLogistics'), can('OPERATOR', 'decideLostParcel'), can('ADMIN', 'decideLostParcel')]).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(shipWaitsFor(view())).toBe('Its size is to be entered.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'AWAITING', priceMinor: 480_000, currency: 'EUR' }))).toBe('It waits for supplier stock.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'AWAITING' }))).toBe('It waits for supplier stock; its price is to be entered.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'STOCK', priceMinor: 480_000, currency: 'EUR' }))).toBe('It ships once paid.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'STOCK' }))).toBe('Its price is to be entered: it is paid once priced, and its invoice issued then.');
    expect(shipWaitsFor(paidStock)).toBe('It ships with its parcel: the agent packs it and scans its card (Shipping).');
    expect(shipWaitsFor(linked)).toBeNull();
  });

  it('checks the dialogs and sends what the server takes', () => {
    // Ship and its declared values are the Shipping section's (model/logistics.ts shipProblem, admin.logistics.test.ts).
    expect([noteProblem('', true), noteProblem('', false), noteProblem('x'.repeat(501), false)]).toEqual(['Say in the note why.', null, 'A note has at most 500 characters.']);

    const o = view();
    const a = orderActions(o, 'OPERATOR').terms;
    expect(termsValues(o)).toEqual({ size: '', oneSize: '', price: '', currency: 'EUR', engraving: '', shippingService: 'STANDARD', shippingFee: '', giftSize: '' });
    expect(termsProblem(o, termsValues(o), a)).toBe('Nothing has changed.');
    expect(termsChange(o, { size: '52', price: '4800', currency: 'GBP', engraving: ' A. & L. ' }, a)).toEqual({ sizeLabel: '52', priceMinor: 480_000, currency: 'GBP', engravingText: 'A. & L.' });
    expect(termsChange(o, { size: '', oneSize: 'true', price: '', currency: 'EUR', engraving: '' }, a)).toEqual({ sizeLabel: null });
    expect(termsProblem(o, { size: '52', oneSize: 'true' }, a)).toBe('A piece in one size has no size label.');
    expect(termsProblem(o, { price: '12,345,678' }, a)).toMatch(/^The price/);
    expect(termsProblem(o, { engraving: 'one\ntwo' }, a)).toBe('An engraving is one line.');
    const entered = view({ sizeLabel: '52', skuId: 's', priceMinor: 480_000, currency: 'EUR', engravingText: 'A.' });
    expect(termsChange(entered, { ...termsValues(entered), engraving: '' }, a)).toEqual({ engravingText: null });

    expect(buyerProblem(o, { name: 'Jane\nDoe', address: '' })).toBe('A name is one line.');
    expect(buyerProblem(o, { name: '', address: '' })).toBe('Nothing has changed.');
    expect(buyerInput({ name: ' Jane Doe ', address: '1 rue de la Paix\r\n75002 Paris ' })).toEqual({ name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', country: null, phone: null });
    expect(buyerInput({ name: '', address: ' ' })).toEqual({ name: null, address: null, country: null, phone: null });

    expect(alertsProblem({ reservedDays: '2', readyDays: '3', shippedDays: '10', unregisteredDays: '30' })).toBeNull();
    expect(alertsProblem({ reservedDays: '0', readyDays: '3', shippedDays: '10', unregisteredDays: '30' })).toBe('Reserved: 1 to 90 days.');
    expect(alertsProblem({ reservedDays: '2', readyDays: '3', shippedDays: '10', unregisteredDays: '366' })).toBe('Delivered, not registered: 1 to 365 days.');
    expect(alertsInput({ reservedDays: '2', readyDays: '3', shippedDays: '10', unregisteredDays: '30' })).toEqual({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
    expect(carrierProblem({ name: '', trackingUrl: 'https://t.example/{tracking}' })).toBe('Name the carrier.');
    expect(carrierProblem({ name: 'FedEx', trackingUrl: 'https://t.example/{tracking}' })).toBeNull();
  });

  it('lists on the packing slip the piece, its size, its add-ons, the engraving and the surprise, never a price', () => {
    const d = {
      order: view({ channel: 'LIVE', release: { id: 'd', title: 'THE RING' }, sizeLabel: '52', skuId: 's', priceMinor: 480_000, currency: 'EUR', addons: [{ id: 'x', label: 'ENGRAVING', priceMinor: 15_000 }], engravingText: 'A. & L.', surprise: 'A silk pouch', productId: 'O26-J-00184', buyer: { name: 'Jane Doe', address: '1 rue de la Paix' }, shipment: { carrier: { id: 'c', name: 'UPS' }, trackingNumber: '1Z', trackingUrl: 'https://x', declaredValueMinor: 480_000 } }),
      sourceReference: 'LR-0F8E7D6C',
      account: { id: 'a', email: 'a@example.com' },
      timing: { since: '', dueAt: null, rule: null, late: false },
      piece: null,
      actors: {},
      delays: { reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 },
    } as OrderDetail;
    const slip = packingSlip(d);
    expect(slip).toEqual({
      reference: 'OR-0F8E7D6C',
      sourceReference: 'LR-0F8E7D6C',
      channel: 'LIVE RELEASE',
      release: 'THE RING',
      model: 'MONOLITHE',
      piece: 'O26-J-00184',
      size: '52',
      addons: ['ENGRAVING'],
      engraving: 'A. & L.',
      surprise: 'A silk pouch',
      // Plan NEXT LOT §3.6.B, §1.1 (d): its country and phone ('Not entered'), no change.
      buyer: { name: 'Jane Doe', address: '1 rue de la Paix', country: null, phone: 'Not entered', changed: null },
    });
    // ADDRESS CHANGED while the order is not shipped, by Client Services; none once shipped.
    const changedAt = '2026-10-08T07:12:00.000Z';
    const marked = { ...d, order: { ...d.order, status: 'PAID' as const, buyer: { name: 'Jane Doe', address: '1 rue de la Paix', country: 'FR', phone: '+33 6 12 34 56 78' }, addressBy: 'STAFF' as const, addressChangedAt: changedAt } };
    expect(packingSlip(marked).buyer).toEqual({ name: 'Jane Doe', address: '1 rue de la Paix', country: 'France', phone: '+33 6 12 34 56 78', changed: expect.stringMatching(/^Changed on 08 OCT 2026 at \d{2}:12 by ORBES Client Services\.$/) });
    expect(packingSlip({ ...marked, order: { ...marked.order, status: 'SHIPPED' as const } }).buyer.changed).toBeNull();
    expect(JSON.stringify(slip)).not.toMatch(/4800|480000|15000|150/);
    // A variant's piece reads its variant after the model (plan NEXT LOT §3.5.3): the agent picks by model, variant and size.
    expect(packingSlip({ ...d, order: { ...d.order, model: { id: 'm', name: 'MONOLITHE', variant: 'BLUE' } } }).model).toBe('MONOLITHE · BLUE');
  });
});

describe('a return and the invoices (step S4)', () => {
  it('opens a return or a size exchange as an order case, and decides it, as the server takes it (plan NEXT LOT §3.5.4.4)', () => {
    const sizes = [
      { skuId: ID, selectable: true },
      { skuId: LOC, selectable: false },
    ];
    expect(openCaseProblem({ kind: '', reason: 'SIZE', note: 'x' }, sizes)).toBe('Choose a return or a size exchange.');
    expect(openCaseProblem({ kind: 'EXCHANGE', exchangeSkuId: LOC, reason: 'SIZE', note: 'x' }, sizes)).toBe('Choose the new size among those in stock.');
    expect(openCaseProblem({ kind: 'RETURN', reason: '', note: 'x' }, sizes)).toBe('Choose the reason.');
    expect(openCaseProblem({ kind: 'RETURN', reason: 'SIZE', note: ' ' }, sizes)).toBe('Say in the note what the collector asked.');
    expect(openCaseProblem({ kind: 'EXCHANGE', exchangeSkuId: ID, reason: 'SIZE', note: 'x' }, sizes)).toBeNull();
    // A size chosen before switching to a return is not sent.
    expect(openCaseInput({ kind: 'RETURN', exchangeSkuId: ID, reason: 'OTHER', note: ' Changed her mind. ' })).toEqual({ kind: 'RETURN', reason: 'OTHER', exchangeSkuId: null, note: 'Changed her mind.' });
    expect(Object.values(CASE_REASON_LABELS)).toEqual(['The size does not fit', 'The piece is not as I expected', 'The piece arrived damaged', 'Another reason']);
    expect(pastReturnWindow('2026-10-01T09:00:00.000Z', new Date('2026-10-15T09:00:01.000Z'))).toBe(true);
    expect(pastReturnWindow('2026-10-01T09:00:00.000Z', new Date('2026-10-15T09:00:00.000Z'))).toBe(false);
    expect(pastReturnWindow(null, new Date())).toBe(false);

    expect(outcomeOptions('RETURN').map((o) => o.label)).toEqual(['Refund']);
    expect(outcomeOptions('EXCHANGE').map((o) => o.label)).toEqual(['Ship the other size', 'Refund']);
    expect(outcomeOptions('LOST').map((o) => o.label)).toEqual(['Ship another piece', 'Refund']);
    expect(decideProblem({ kind: 'RETURN' }, { decision: 'RESHIP', pieceTo: 'RESTOCKED', locationId: LOC, note: 'x' })).toBe('Choose the outcome.');
    expect(decideProblem({ kind: 'RETURN' }, { decision: 'REFUND', pieceTo: '', note: 'x' })).toBe('Say where the piece goes.');
    expect(decideProblem({ kind: 'RETURN' }, { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: '', note: 'x' })).toBe('Choose the location the piece goes back to.');
    expect(decideProblem({ kind: 'RETURN' }, { decision: 'REFUND', pieceTo: 'ARCHIVED', note: '' })).toBe('Say in the note why.');
    expect(decideProblem({ kind: 'LOST' }, { decision: 'RESHIP', note: '' })).toBeNull();
    expect(decideInput({ kind: 'RETURN' }, { decision: 'REFUND', pieceTo: 'ARCHIVED', locationId: LOC, note: ' Damaged. ' })).toEqual({ decision: 'REFUND', pieceTo: 'ARCHIVED', locationId: null, note: 'Damaged.' });
    expect(decideInput({ kind: 'BACK_TO_SENDER' }, { decision: 'RESHIP', pieceTo: 'RESTOCKED', locationId: LOC, note: '' })).toEqual({ decision: 'RESHIP', pieceTo: null, locationId: null, note: null });

    // Decide once the parcel is back (a lost one by an ADMIN, as it stands); Cancel while open; Open a return once shipped.
    const c = { kind: 'RETURN' as const, status: 'OPEN' as const };
    expect(caseActions(c, 'OPERATOR')).toEqual({ decide: false, cancel: true });
    expect(caseActions({ ...c, status: 'RECEIVED' }, 'OPERATOR')).toEqual({ decide: true, cancel: true });
    expect(caseActions({ ...c, status: 'RECEIVED' }, 'AUDITOR')).toEqual({ decide: false, cancel: false });
    expect([caseActions({ kind: 'LOST', status: 'OPEN' }, 'OPERATOR').decide, caseActions({ kind: 'LOST', status: 'OPEN' }, 'ADMIN').decide]).toEqual([false, true]);
    expect(caseActions({ ...c, status: 'CLOSED' }, 'ADMIN')).toEqual({ decide: false, cancel: false });
    expect(canOpenReturn({ status: 'DELIVERED' }, [], 'OPERATOR')).toBe(true);
    expect(canOpenReturn({ status: 'DELIVERED' }, [{ status: 'RECEIVED' }], 'OPERATOR')).toBe(false);
    expect(canOpenReturn({ status: 'PAID' }, [], 'OPERATOR')).toBe(false);
    expect(canOpenReturn({ status: 'DELIVERED' }, [], 'AUDITOR')).toBe(false);
    expect(RETURN_LABELS).toEqual({ RESTOCKED: 'Back to stock', ARCHIVED: 'To the archive' });
    expect(DOCUMENT_LABELS).toEqual({ INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note' });
  });

  it('reads the Invoices page\'s filters, offers 24 months from the server\'s, names them and the documents', () => {
    expect(invoiceFilters({ month: '2026-11', kind: 'CREDIT_NOTE', q: ' INV-2026 ' })).toEqual({ month: '2026-11', kind: 'CREDIT_NOTE', q: 'INV-2026' });
    expect(invoiceFilters({ month: '2026-13', kind: 'RECEIPT', q: 'x'.repeat(50) })).toEqual({ q: 'x'.repeat(INVOICE_SEARCH_MAX) });
    expect(INVOICE_SEARCH_MAX).toBe(40);
    const months = invoiceMonths('2027-02');
    expect(months).toHaveLength(24);
    expect(months.slice(0, 3)).toEqual(['2027-02', '2027-01', '2026-12']);
    expect(months.at(-1)).toBe('2025-03');
    expect(invoiceMonths('2027-02', '2020-05').at(-1)).toBe('2020-05');
    expect(invoiceMonths('2027-02', '2026-12')).toHaveLength(24);
    expect([monthLabel('2026-10'), monthLabel('2027-01')]).toEqual(['October 2026', 'January 2027']);
    expect(KIND_FILTER_LABELS).toEqual({ INVOICE: 'Invoices', CREDIT_NOTE: 'Credit notes' });
    expect(linkedDocument({ credits: { id: ID, number: 'INV-2026-000001' }, creditedBy: null })).toBe('Cancels INV-2026-000001');
    expect(linkedDocument({ credits: null, creditedBy: { id: ID, number: 'CN-2026-000001' } })).toBe('Cancelled by CN-2026-000001');
    expect(linkedDocument({ credits: null, creditedBy: null })).toBe('');
    expect(buyerLine({ buyer: { name: 'Jane Doe', address: null, email: 'j@example.com' } })).toBe('Jane Doe');
    expect(buyerLine({ buyer: { name: null, address: null, email: 'j***@example.com' } })).toBe('j***@example.com');
    expect(signedMoney(-495_000, 'EUR')).toBe(`−${signedMoney(495_000, 'EUR')}`);
  });
});

describe('routes and the API client', () => {
  it('routes the board, an order, its slip, the atelier, the work sheets and the settings', () => {
    expect(parseHash('#/invoices?month=2026-11&kind=INVOICE')).toMatchObject({ name: 'invoices', query: { month: '2026-11', kind: 'INVOICE' } });
    expect(parseHash('#/orders?late=true')).toMatchObject({ name: 'orders', query: { late: 'true' } });
    expect(parseHash(`#/orders/${ID}`)).toMatchObject({ name: 'order', params: { orderId: ID } });
    expect(parseHash(`#/orders/${ID}/slip`)).toMatchObject({ name: 'packingSlip', params: { orderId: ID } });
    expect(parseHash('#/atelier')).toMatchObject({ name: 'atelier' });
    expect(parseHash(`#/atelier/sheets?origin=STOCK&skuId=${ID}&locationId=${LOC}`).query).toEqual({ origin: 'STOCK', skuId: ID, locationId: LOC });
    expect(parseHash('#/settings')).toMatchObject({ name: 'settings' });
    expect(href('workSheets', {}, { id: ID })).toBe(`#/atelier/sheets?id=${ID}`);
  });

  it('calls each route with its method and body, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      const csv = url.includes('.csv');
      return new Response(csv ? '"reference"\r\n' : '{}', { status: 200, headers: { 'content-type': csv ? 'text/csv' : 'application/json', 'content-disposition': csv ? 'attachment; filename="ORBES-orders-2026-11-10.csv"' : '' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.orderBoard({ channel: 'LIVE', late: true, q: 'OR-1' });
    const csv = await api.ordersCsv({ dropId: ID });
    await api.order(ID);
    await api.transitionOrder(ID, { to: 'PAID' });
    await api.changeOrderLocation(ID, LOC);
    await api.setOrderTerms(ID, { engravingText: 'A.' });
    await api.setOrderBuyer(ID, { name: 'J', address: null });
    await api.orderAlerts();
    await api.setOrderAlerts({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
    await api.locations();
    await api.createLocation('PARIS');
    await api.updateLocation(LOC, { isDefault: true });
    await api.carriers();
    await api.createCarrier({ name: 'FedEx', trackingUrl: 'https://f/{tracking}' });
    await api.updateCarrier(LOC, { active: false });
    await api.openOrderCase(ID, { kind: 'RETURN', reason: 'SIZE', note: 'Returned.' });
    await api.invoices({ month: '2026-11', kind: 'INVOICE' });
    const month = await api.invoicesCsv('2026-11');
    await api.invoicePdf(ID);
    await api.orderCase(ID);
    await api.decideOrderCase(ID, { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: LOC, note: 'Unworn.' });
    await api.cancelOrderCase(ID, 'Withdrawn.');
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/orders?channel=LIVE&late=true&q=OR-1',
      `GET /api/admin/orders.csv?dropId=${ID}`,
      `GET /api/admin/orders/${ID}`,
      `POST /api/admin/orders/${ID}/transition`,
      `POST /api/admin/orders/${ID}/location`,
      `PATCH /api/admin/orders/${ID}/terms`,
      `PUT /api/admin/orders/${ID}/buyer`,
      'GET /api/admin/orders/alerts',
      'PUT /api/admin/orders/alerts',
      'GET /api/admin/locations',
      'POST /api/admin/locations',
      `PATCH /api/admin/locations/${LOC}`,
      'GET /api/admin/carriers',
      'POST /api/admin/carriers',
      `PATCH /api/admin/carriers/${LOC}`,
      `POST /api/admin/orders/${ID}/case`,
      'GET /api/admin/invoices?month=2026-11&kind=INVOICE',
      'GET /api/admin/invoices.csv?month=2026-11',
      `GET /api/admin/invoices/${ID}/pdf`,
      `GET /api/admin/order-cases/${ID}`,
      `POST /api/admin/order-cases/${ID}/decide`,
      `POST /api/admin/order-cases/${ID}/cancel`,
    ]);
    expect(csv.filename).toBe('ORBES-orders-2026-11-10.csv');
    expect(month.filename).toBe('ORBES-orders-2026-11-10.csv');
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : undefined));
    expect(bodies[6]).toEqual({ name: 'J', address: null });
    expect(bodies[8]).toEqual({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
    expect(bodies[15]).toEqual({ kind: 'RETURN', reason: 'SIZE', note: 'Returned.' });
    expect(bodies[20]).toEqual({ decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: LOC, note: 'Unworn.' });
    expect(bodies[21]).toEqual({ note: 'Withdrawn.' });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
  });
});

describe('the Buyer, the engraving and their settings (plan NEXT LOT §3.6.B, C)', () => {
  /** The space formatMoney sets after the sign. */
  const NB = formatMoney(100, 'EUR').slice(1, 2);
  const T = '2026-10-07T12:02:00.000Z';
  it('says the buyer: name, address, country in English, phone, who entered it and when; the change highlighted until it ships; a travelling order\'s parent', () => {
    const o = view({ status: 'PAID', buyer: { name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, addressBy: 'COLLECTOR', addressAt: T, addressChangedAt: '2026-10-08T07:12:00.000Z' });
    const b = buyerSection(o, false);
    expect(b.rows).toEqual([
      { label: 'Name', value: 'Jane Doe' },
      { label: 'Address', value: '1 rue de la Paix\n75002 Paris' },
      { label: 'Country', value: 'France' },
      { label: 'Phone', value: '+33 6 12 34 56 78' },
      { label: 'Entered by', value: 'The client · 07 OCT 2026 · 12:02 UTC' },
    ]);
    expect(b.changed).toBe('Address changed on 08 OCT 2026 · 07:12 UTC, after it was first entered: check the parcel’s label.');
    expect(b.travels).toBeNull();
    // Shipped: no highlight any more. Entered by Client Services.
    expect(buyerSection({ ...o, status: 'SHIPPED', addressBy: 'STAFF' }, false)).toMatchObject({ changed: null, rows: expect.arrayContaining([{ label: 'Entered by', value: 'Client Services · 07 OCT 2026 · 12:02 UTC' }]) });
    // None entered; an order of before (no country, no phone).
    expect(buyerSection(view(), false).rows.map((r) => r.value)).toEqual(['Not entered', 'Not entered', 'Not entered', 'Not entered']);
    // An AUDITOR: the name masked and the address withheld by the server, the phone withheld, the country shown.
    expect(buyerSection(view({ buyer: { name: 'J*** D***', address: '***', country: 'FR', phone: null } }), true).rows.map((r) => r.value)).toEqual(['J*** D***', '***', 'France', '***']);
    // Travelling with another: its parent's, read only (no EDIT), its line.
    const gift = view({ channel: 'GIFT', withOrder: { id: 'p', reference: 'OR-3F9A21C4', shipment: null }, buyer: { name: 'Jane Doe', address: '1 rue', country: 'FR', phone: null } });
    expect(buyerSection(gift, false).travels).toBe('Travels with order OR-3F9A21C4: its buyer and address are that order’s.');
    expect(orderActions(gift, 'OPERATOR').buyer).toBe(false);
    expect(orderActions(view({ status: 'CANCELLED' }), 'OPERATOR').buyer).toBe(false);
    expect(orderActions(view({ status: 'CANCELLED', gifts: [{ id: 'g', reference: 'OR-1', model: 'M', status: 'RESERVED', sizeToChoose: false, tier: 2 }] }), 'OPERATOR').buyer).toBe(true);
  });

  it('edits the country and the phone in the server\'s words; empty clears them', () => {
    const o = view({ buyer: { name: 'Jane Doe', address: '1 rue', country: 'FR', phone: '+33 6 12 34 56 78' } });
    const same = { name: 'Jane Doe', address: '1 rue', country: 'FR', phone: '+33 6 12 34 56 78' };
    expect(buyerProblem(o, same)).toBe('Nothing has changed.');
    expect(buyerProblem(o, { ...same, country: 'XX' })).toBe('Choose a country.');
    expect(buyerProblem(o, { ...same, phone: '06 12 34 56 78' })).toBe('Enter a phone number with its country code.');
    expect(buyerProblem(o, { ...same, country: 'BE' })).toBeNull();
    expect(buyerInput({ ...same, country: '', phone: ' ' })).toEqual({ name: 'Jane Doe', address: '1 rue', country: null, phone: null });
    const options = countryOptions();
    expect(options[0]).toEqual({ value: '', label: 'Not entered' });
    expect(options.find((x) => x.value === 'GB')!.label).toBe('United Kingdom');
  });

  it('says the engraving with the price it took, or its words alone (the release\'s add-on)', () => {
    expect(engravingLine({ engravingText: 'J.M.', engravingMinor: 3_000, currency: 'EUR' })).toBe(`J.M. · €${NB}30`);
    expect(engravingLine({ engravingText: 'J.M.', engravingMinor: null, currency: 'EUR' })).toBe('J.M.');
    expect(engravingLine({ engravingText: null, engravingMinor: null, currency: 'EUR' })).toBe('None');
    // The history names the client's own changes (plan NEXT LOT §3.6.B, C), never by their action's code.
    expect([EVENT_LABELS['order.address'], EVENT_LABELS['order.engraving']]).toEqual(['Delivery address entered', 'Engraving entered']);
  });

  it('sets the engraving prices per currency: an amount in units, empty for none', () => {
    const sheet = { prices: { EUR: 3_000, GBP: null, USD: 3_550, CHF: null }, updatedAt: T, updatedBy: { id: 'a', email: 'admin@example.com' } };
    expect(engravingPriceText(sheet, 'EUR')).toBe(`€${NB}30`);
    expect(engravingPriceText(sheet, 'GBP')).toBe('—');
    expect(engravingPricesValues(sheet)).toEqual({ EUR: '30', GBP: '', USD: '35.50', CHF: '' });
    expect(engravingPricesProblem({ EUR: '30', GBP: '', USD: 'x', CHF: '' })).toBe('USD: an amount in units, or empty for none.');
    expect(engravingPricesProblem({ EUR: '30', GBP: '', USD: '', CHF: '' })).toBeNull();
    expect(engravingPricesInput({ EUR: '30', GBP: ' ', USD: '35.50', CHF: '' })).toEqual({ EUR: 3_000, GBP: null, USD: 3_550, CHF: null });
  });

  it('calls the engraving prices\' routes, the CSRF token on the change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = new AdminApi({
      fetch: async (url, init = {}) => {
        calls.push({ url, init });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    api.setCsrf('tok');
    await api.engravingPrices();
    await api.setEngravingPrices({ EUR: 3_000, GBP: null, USD: null, CHF: null });
    await api.setOrderBuyer(ID, { name: 'J', address: 'A', country: 'FR', phone: '+33 6 12 34 56 78' });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual(['GET /api/admin/orders/engraving-prices', 'PUT /api/admin/orders/engraving-prices', `PUT /api/admin/orders/${ID}/buyer`]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ prices: { EUR: 3_000, GBP: null, USD: null, CHF: null } });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ name: 'J', address: 'A', country: 'FR', phone: '+33 6 12 34 56 78' });
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
  });
});
