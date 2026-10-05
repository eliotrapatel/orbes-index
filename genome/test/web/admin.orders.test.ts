/**
 * The console's orders, atelier and settings (plan LIVE RELEASE+, step S2) — the pure models and the API client:
 * model/orders.ts and model/atelier.ts against the server's rules (their bounds mirrored and compared), the board's and
 * the atelier's filters, what each role may do, the dialogs' checks and what they send, the packing slip without a
 * price; AdminApi's paths, methods and bodies.
 */
import { describe, expect, it } from 'vitest';
import { ATELIER_MAKE_MAX, BENCH_VIEWS as SERVER_BENCH_VIEWS, ISSUE_TEXT_LIMITS, suggestedPieces, THRESHOLD_MAX, WORK_SHEETS_MAX } from '../../src/server/services/atelier.js';
import { ORDER_ALERT_LIMITS, ORDER_LATE_RULES as SERVER_LATE_RULES } from '../../src/server/services/fulfilment.js';
import { RESERVED_MATERIAL_PENDING as SERVER_PENDING } from '../../src/server/services/issuance.js';
import { ORDER_AMOUNT_MAX_MINOR as SERVER_AMOUNT_MAX, ORDER_CURRENCIES as SERVER_CURRENCIES, ORDER_TEXT_LIMITS, trackingLink as serverTrackingLink } from '../../src/server/services/orders.js';
import { CARRIER_NAME_MAX, checkTrackingUrl, LOCATION_NAME_MAX, STOCK_MOVE_MAX, STOCK_NOTE_MAX, TRACKING_URL_MAX } from '../../src/server/services/stock.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { formatCount } from '../../src/web/admin/format.js';
import {
  adjustProblem,
  ATELIER_LIMITS,
  benchActions,
  benchFilters,
  issueInput,
  issueProblem,
  issueValues,
  makeProblem,
  originLabel,
  RESERVED_MATERIAL_PENDING,
  sheetsSelection,
  skuLabel,
  thresholdProblem,
  thresholdValue,
  transferProblem,
} from '../../src/web/admin/model/atelier.js';
import {
  ALERT_LIMITS,
  alertsInput,
  alertsProblem,
  boardFilters,
  buyerInput,
  buyerProblem,
  carrierProblem,
  cardHolds,
  delaysLine,
  durationText,
  EVENT_LABELS,
  eventActor,
  LATE_LABELS,
  lateSentence,
  LOGISTICS_LIMITS,
  noteProblem,
  ORDER_AMOUNT_MAX_MINOR,
  ORDER_LIMITS,
  orderActions,
  packingSlip,
  shipInput,
  shipProblem,
  shipWaitsFor,
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
import { BENCH_VIEWS, ORDER_CURRENCIES, ORDER_LATE_RULES, type BenchItem, type OrderCard, type OrderDetail, type OrderView } from '../../src/web/admin/types.js';

const ID = '0f8e7d6c-5b4a-4398-8877-665544332211';
const LOC = '11111111-2222-4333-8444-555555555555';

const view = (o: Partial<OrderView> = {}): OrderView => ({
  id: ID,
  reference: 'OR-0F8E7D6C',
  channel: 'SALON',
  source: { liveEntryId: null, piece: 1, dropEntryId: null, shopRequestId: 'r' },
  release: null,
  accountId: 'a',
  model: { id: 'm', name: 'MONOLITHE' },
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
  bench: null,
  shipment: null,
  productId: null,
  shopifyOrderId: null,
  events: [],
  ...o,
});

const bench = (o: Partial<BenchItem> = {}): BenchItem => ({
  id: ID,
  status: 'TO_MAKE',
  createdAt: '2026-11-01T09:00:00.000Z',
  startedAt: null,
  doneAt: null,
  cancelledAt: null,
  piece: { id: 'p', reference: 'O26-J-00184', status: 'RESERVED', material: '925 STERLING SILVER', signed: false },
  order: null,
  origin: { kind: 'STOCK' },
  sku: { id: 's', code: 'MNL-RG-52', model: { id: 'm', name: 'MONOLITHE' }, sizeLabel: '52' },
  location: { id: LOC, name: 'FRANCE WAREHOUSE' },
  engravingText: null,
  surprise: null,
  addons: [],
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
    expect(ATELIER_LIMITS).toEqual({ make: ATELIER_MAKE_MAX, sheets: WORK_SHEETS_MAX, threshold: THRESHOLD_MAX, move: STOCK_MOVE_MAX, note: STOCK_NOTE_MAX, material: ISSUE_TEXT_LIMITS.material, batch: ISSUE_TEXT_LIMITS.productionBatch });
    expect([...BENCH_VIEWS]).toEqual([...SERVER_BENCH_VIEWS]);
    expect(RESERVED_MATERIAL_PENDING).toBe(SERVER_PENDING);
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
    const card = (o: Partial<OrderCard>) => ({ status: 'RESERVED', reservation: null, bench: null, piece: null, location: { id: LOC, name: 'FRANCE WAREHOUSE' }, sizeLabel: null, skuCode: null, ...o }) as OrderCard;
    expect(cardHolds(card({}))).toBe('Size to enter');
    expect(cardHolds(card({ skuCode: 'MNL', reservation: 'STOCK' }))).toBe('In stock at FRANCE WAREHOUSE');
    expect(cardHolds(card({ skuCode: 'MNL', reservation: 'BENCH', bench: { status: 'TO_MAKE' } }))).toBe('To make');
    expect(cardHolds(card({ skuCode: 'MNL', reservation: 'BENCH', bench: { status: 'IN_PROGRESS' } }))).toBe('Being made');
    expect(cardHolds(card({ status: 'SHIPPED', piece: 'O26-J-00184' }))).toBe('Piece O26-J-00184');
    expect(cardHolds(card({ status: 'CANCELLED' }))).toBe('—');
    expect(viewHolds(view({ skuId: 's', reservation: 'STOCK' }))).toBe('In stock at FRANCE WAREHOUSE');
    expect(['order.create', 'order.pay', 'order.ship', 'order.deliver', 'order.cancel', 'order.return', 'order.location', 'order.terms', 'order.buyer', 'order.link'].every((a) => EVENT_LABELS[a])).toBe(true);
    const e = (type: string, id: string | null) => ({ action: 'order.pay', status: 'PAID' as const, note: null, at: '', actor: { type, id } });
    expect([eventActor(e('admin', 'x'), { x: 'op@orbes.test' }), eventActor(e('admin', 'y'), {}), eventActor(e('system', null), {}), eventActor(e('account', 'a'), {})]).toEqual([
      'op@orbes.test',
      'A console user',
      'ORBES',
      'The collector',
    ]);
  });
});

describe('what a role may do with an order', () => {
  it('offers each step only where the server takes it, to an OPERATOR', () => {
    const reserved = view();
    expect(orderActions(reserved, 'AUDITOR')).toEqual({ pay: false, ship: false, deliver: false, cancel: false, location: false, terms: { size: false, price: false, engraving: false }, buyer: false, linkPiece: false });
    expect(orderActions(reserved, 'OPERATOR')).toEqual({ pay: true, ship: false, deliver: false, cancel: true, location: true, terms: { size: true, price: true, engraving: true }, buyer: true, linkPiece: false });
    const paidStock = view({ status: 'PAID', paidAt: 'x', skuId: 's', reservation: 'STOCK' });
    expect(orderActions(paidStock, 'OPERATOR')).toMatchObject({ pay: false, ship: true, cancel: true, terms: { size: true, price: false, engraving: true }, linkPiece: true });
    const live = view({ channel: 'LIVE', skuId: 's', reservation: 'BENCH', sizeLabel: '52', priceMinor: 1, currency: 'EUR' });
    expect(orderActions(live, 'ADMIN').terms).toEqual({ size: false, price: false, engraving: true });
    expect(orderActions(live, 'ADMIN').linkPiece).toBe(false);
    const linked = view({ status: 'PAID', paidAt: 'x', skuId: 's', reservation: 'STOCK', productId: 'O26-J-00184' });
    expect(orderActions(linked, 'OPERATOR')).toMatchObject({ location: false, linkPiece: false, ship: true, terms: { size: false } });
    expect(orderActions(view({ status: 'SHIPPED' }), 'OPERATOR')).toMatchObject({ deliver: true, cancel: false, location: false, buyer: true });
    expect(orderActions(view({ status: 'DELIVERED' }), 'OPERATOR')).toMatchObject({ deliver: false, cancel: false });
    expect([can('OPERATOR', 'manageOrders'), can('AUDITOR', 'manageOrders'), can('OPERATOR', 'manageLogistics'), can('ADMIN', 'manageLogistics'), can('OPERATOR', 'printWorkSheets'), can('AUDITOR', 'printWorkSheets')]).toEqual([
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(shipWaitsFor(view())).toBe('Its size is to be entered.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'BENCH' }))).toBe('Its piece is being made at the atelier.');
    expect(shipWaitsFor(view({ skuId: 's', reservation: 'STOCK' }))).toBe('It ships once paid.');
    expect(shipWaitsFor(paidStock)).toBeNull();
  });

  it('checks the dialogs and sends what the server takes', () => {
    expect(shipProblem({ carrierId: '', trackingNumber: '6A1234' }, 'EUR')).toBe('Choose the carrier.');
    expect(shipProblem({ carrierId: LOC, trackingNumber: '#' }, 'EUR')).toMatch(/^A tracking number/);
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A1234', declaredValue: '4800' }, null)).toMatch(/price and currency/);
    expect(shipProblem({ carrierId: LOC, trackingNumber: '6A1234', declaredValue: 'abc' }, 'EUR')).toMatch(/declared value/);
    expect(shipProblem({ carrierId: LOC, trackingNumber: ' 6A 1234 ', declaredValue: '4 800.50' }, 'EUR')).toBeNull();
    expect(shipInput({ carrierId: LOC, trackingNumber: ' 6A 1234 ', declaredValue: '4 800.50', note: '' })).toEqual({ to: 'SHIPPED', carrierId: LOC, trackingNumber: '6A 1234', declaredValueMinor: 480_050 });
    expect(shipInput({ carrierId: LOC, trackingNumber: '6A1234', declaredValue: '', note: ' Fragile ' })).toEqual({ to: 'SHIPPED', carrierId: LOC, trackingNumber: '6A1234', note: 'Fragile' });
    expect([noteProblem('', true), noteProblem('', false), noteProblem('x'.repeat(501), false)]).toEqual(['Say in the note why.', null, 'A note has at most 500 characters.']);

    const o = view();
    const a = orderActions(o, 'OPERATOR').terms;
    expect(termsValues(o)).toEqual({ size: '', oneSize: '', price: '', currency: 'EUR', engraving: '' });
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
    expect(buyerInput({ name: ' Jane Doe ', address: '1 rue de la Paix\r\n75002 Paris ' })).toEqual({ name: 'Jane Doe', address: '1 rue de la Paix\n75002 Paris' });
    expect(buyerInput({ name: '', address: ' ' })).toEqual({ name: null, address: null });

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
      buyer: { name: 'Jane Doe', address: '1 rue de la Paix' },
    });
    expect(JSON.stringify(slip)).not.toMatch(/4800|480000|15000|150/);
  });
});

describe('the atelier', () => {
  it('names whom pieces are made for and a SKU; reads its filters and the work sheets\' selection', () => {
    expect([originLabel({ kind: 'RELEASE', release: { id: 'd', title: 'THE RING' } }), originLabel({ kind: 'SALON' }), originLabel({ kind: 'STOCK' })]).toEqual(['THE RING', 'PRIVATE SALON', 'FOR STOCK']);
    expect(skuLabel({ id: 's', code: 'X', model: { id: 'm', name: 'HALO' }, sizeLabel: null })).toBe('HALO · ONE SIZE');
    expect(benchFilters({ view: 'DONE', origin: 'STOCK', skuId: ID, locationId: LOC })).toEqual({ view: 'DONE', origin: 'STOCK', skuId: ID, locationId: LOC });
    expect(benchFilters({ view: 'LATER', origin: 'x', skuId: 'y' })).toEqual({});
    expect(benchFilters({ origin: ID.toUpperCase() })).toEqual({ origin: ID });
    expect(sheetsSelection({ id: ID, origin: 'STOCK' })).toEqual({ benchItemIds: [ID] });
    expect(sheetsSelection({ origin: 'SALON', skuId: ID })).toEqual({ origin: 'SALON', skuId: ID });
    expect(suggestedPieces(5, 1, 1)).toBe(3);
  });

  it('offers each step only where the server takes it', () => {
    expect(benchActions(bench(), 'OPERATOR')).toEqual({ start: true, done: false, cancel: true, sheet: true });
    expect(benchActions(bench({ status: 'IN_PROGRESS' }), 'OPERATOR')).toEqual({ start: false, done: true, cancel: true, sheet: true });
    expect(benchActions(bench({ order: { id: ID, reference: 'OR-1', status: 'PAID', channel: 'LIVE' } }), 'OPERATOR')).toMatchObject({ cancel: false });
    expect(benchActions(bench({ status: 'DONE' }), 'ADMIN')).toEqual({ start: false, done: false, cancel: false, sheet: false });
    expect(benchActions(bench(), 'AUDITOR')).toEqual({ start: false, done: false, cancel: false, sheet: false });
    expect([toneOf('bench', 'TO_MAKE'), toneOf('bench', 'IN_PROGRESS'), toneOf('bench', 'DONE'), toneOf('order', 'RESERVED'), toneOf('order', 'PAID'), toneOf('order', 'CANCELLED')]).toEqual([
      'outline',
      'solid',
      'muted',
      'outline',
      'solid',
      'muted',
    ]);
  });

  it('checks the dialogs: a piece finished, a transfer, a count, a minimum, pieces to make', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    const pending = bench({ piece: { id: 'p', reference: 'O26-J-00184', status: 'RESERVED', material: RESERVED_MATERIAL_PENDING, signed: true } });
    expect(issueValues(pending, now)).toEqual({ material: '', productionBatch: '', productionDate: '2026-11-05', withClaimSecret: 'true' });
    expect(issueProblem(pending, { material: '' }, now)).toBe('Confirm the material of the piece.');
    expect(issueProblem(bench(), { material: '', productionDate: '2026-11-07' }, now)).toBe('The production date cannot be in the future.');
    expect(issueProblem(bench(), { material: '', productionDate: '2026-02-30' }, now)).toBe('The production date is a day.');
    expect(issueProblem(bench(), { material: '', productionDate: '2026-11-06' }, now)).toBeNull();
    expect(issueInput({ material: ' 925 ', productionBatch: '', productionDate: '2026-11-05', withClaimSecret: '' })).toEqual({ material: '925', productionDate: '2026-11-05', withClaimSecret: false });
    expect(transferProblem({ fromLocationId: LOC, toLocationId: LOC, quantity: '1' })).toBe('A transfer goes to another location.');
    expect(transferProblem({ fromLocationId: LOC, toLocationId: ID, quantity: '0' })).toMatch(/^Move 1 to/);
    expect(transferProblem({ fromLocationId: LOC, toLocationId: ID, quantity: '3' })).toBeNull();
    expect(adjustProblem({ delta: '0', note: 'x' })).toMatch(/^Correct the count/);
    expect(adjustProblem({ delta: '-2', note: '' })).toBe('Say in the note why the count changes.');
    expect(adjustProblem({ delta: '-2', note: 'Damaged.' })).toBeNull();
    expect([thresholdProblem({ minimum: '' }), thresholdProblem({ minimum: '0' }), thresholdProblem({ minimum: '12' })]).toEqual([null, `A minimum is 1 to ${formatCount(10_000)} pieces, or none.`, null]);
    expect([thresholdValue({ minimum: '' }), thresholdValue({ minimum: '12' })]).toEqual([null, 12]);
    expect([makeProblem({ quantity: '51' }), makeProblem({ quantity: '3' })]).toEqual(['Make 1 to 50 pieces at a time.', null]);
  });
});

describe('routes and the API client', () => {
  it('routes the board, an order, its slip, the atelier, the work sheets and the settings', () => {
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
    await api.linkOrderPiece(ID, 'O26-J-00184');
    await api.orderAlerts();
    await api.setOrderAlerts({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
    await api.locations();
    await api.createLocation('PARIS');
    await api.updateLocation(LOC, { isDefault: true });
    await api.carriers();
    await api.createCarrier({ name: 'FedEx', trackingUrl: 'https://f/{tracking}' });
    await api.updateCarrier(LOC, { active: false });
    await api.atelierStock({ locationId: LOC });
    await api.transferStock({ skuId: ID, fromLocationId: LOC, toLocationId: ID, quantity: 1 });
    await api.adjustStock({ skuId: ID, locationId: LOC, delta: -1, note: 'x' });
    await api.setStockThreshold({ skuId: ID, locationId: LOC, minimum: null });
    await api.makeForStock({ skuId: ID, locationId: LOC, quantity: 2 });
    await api.bench({ view: 'ALL', origin: 'STOCK' });
    await api.benchCsv({});
    await api.startBench(ID);
    await api.finishBench(ID, { withClaimSecret: true });
    await api.cancelBench(ID);
    await api.workSheets({ benchItemIds: [ID] });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/orders?channel=LIVE&late=true&q=OR-1',
      `GET /api/admin/orders.csv?dropId=${ID}`,
      `GET /api/admin/orders/${ID}`,
      `POST /api/admin/orders/${ID}/transition`,
      `POST /api/admin/orders/${ID}/location`,
      `PATCH /api/admin/orders/${ID}/terms`,
      `PUT /api/admin/orders/${ID}/buyer`,
      `POST /api/admin/orders/${ID}/piece`,
      'GET /api/admin/orders/alerts',
      'PUT /api/admin/orders/alerts',
      'GET /api/admin/locations',
      'POST /api/admin/locations',
      `PATCH /api/admin/locations/${LOC}`,
      'GET /api/admin/carriers',
      'POST /api/admin/carriers',
      `PATCH /api/admin/carriers/${LOC}`,
      `GET /api/admin/atelier/stock?locationId=${LOC}`,
      'POST /api/admin/atelier/stock/transfer',
      'POST /api/admin/atelier/stock/adjust',
      'PUT /api/admin/atelier/thresholds',
      'POST /api/admin/atelier/make',
      'GET /api/admin/atelier/bench?view=ALL&origin=STOCK',
      'GET /api/admin/atelier/bench.csv',
      `POST /api/admin/atelier/bench/${ID}/start`,
      `POST /api/admin/atelier/bench/${ID}/done`,
      `POST /api/admin/atelier/bench/${ID}/cancel`,
      'POST /api/admin/atelier/sheets',
    ]);
    expect(csv.filename).toBe('ORBES-orders-2026-11-10.csv');
    const bodies = calls.map((c) => (typeof c.init.body === 'string' ? JSON.parse(c.init.body) : undefined));
    expect(bodies[6]).toEqual({ name: 'J', address: null });
    expect(bodies[9]).toEqual({ reservedDays: 2, readyDays: 3, shippedDays: 10, unregisteredDays: 30 });
    expect(bodies[19]).toEqual({ skuId: ID, locationId: LOC, minimum: null });
    expect(bodies[26]).toEqual({ benchItemIds: [ID] });
    expect(calls.every((c) => c.init.method === 'GET' || (c.init.headers as Record<string, string>)['x-csrf-token'] === 'tok')).toBe(true);
  });
});
