/**
 * The catalogue add-ons in the collector app (lot MACRO M3, plan §4.4, step M3.12; macro scope D2): the pure model
 * (addons-model.ts), the order card's rows and TOTAL (orders-model.ts), the words (copy.ts) and the API calls (api.ts),
 * in vitest's node environment:
 *
 *  - the rows to choose from: what is offered (its units within what may be taken, at most 3), then what was chosen and is
 *    no longer offered (its units may only go down); an add-on the app cannot read left out; the total and the choice sent;
 *  - a receipt's rows (`POLISHING CLOTH × 2` · `+ € 30`) and PAY's lines of what could not be added;
 *  - an order's add-ons among its terms and in its TOTAL; REMOVE while removable, ADD AN ADD-ON while offered, the line
 *    once packing has begun, nothing on an order that has none and takes none; the sheet's rows, none available, packing
 *    begun, and once paid its own invoice;
 *  - the calls: the hold's choice beside the release's add-ons, a place held's, a request's, YOUR ORDERS' offer, addition
 *    and removal, each with the CSRF token, and an answer of the wrong shape refused.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADDON_LIMIT } from '../../src/server/services/order-addons.js';
import {
  ADDON_UNITS_MAX,
  addonPrice,
  addonRows,
  addonSheet,
  chosenRows,
  chosenTotal,
  chosenUnits,
  leftOutLines,
  orderAddonRows,
  orderAddons,
  rowsChoice,
  rowsLimit,
  rowsTotal,
  withUnits,
} from '../../src/web/verify/addons-model.js';
import { ApiClient } from '../../src/web/verify/api.js';
import { ADDONS, LIVE, ORDERS } from '../../src/web/verify/copy.js';
import { ENGRAVING_TEXT_MAX, engravingProblem, holdRows, securedAddons, securedChoice, securedColumn } from '../../src/web/verify/live-model.js';
import { payBelowFirstScreen, SECURED_PARTS } from '../../src/web/verify/views/desktop-room.js';
import { orderModel, orderRows } from '../../src/web/verify/orders-model.js';
import { formatMoney } from '../../src/web/verify/view-model.js';
import type { AccountOrder, AddonOfferItem, ChosenAddon, LiveEntry } from '../../src/web/verify/types.js';

const CLOTH = '0b5e7d1a-1c2d-4e5f-9a8b-7c6d5e4f3a2b';
const EXTENDER = '6f1c7a54-3b1e-4c2a-9a55-0d3b1f2e4c5a';
const CASE = '9d2e4f6a-8b0c-4d1e-a2f3-b4c5d6e7f8a9';

const offered = (o: Partial<AddonOfferItem> & Pick<AddonOfferItem, 'addonId' | 'name'>): AddonOfferItem => ({ line: null, priceMinor: 1_500, currency: 'EUR', maxUnits: 3, ...o });
const chosen = (o: Partial<ChosenAddon> & Pick<ChosenAddon, 'addonId' | 'name'>): ChosenAddon => ({ line: null, units: 1, priceMinor: 1_500, ...o });

function order(o: Partial<AccountOrder> = {}): AccountOrder {
  return {
    id: '3f9a21c4-7c21-4a9f-8b0e-21c43f9a7c21',
    reference: 'OR-3F9A21C4',
    channel: 'LIVE',
    release: 'MONOLITHE IN STEEL',
    model: 'MONOLITHE',
    size: { label: '16' },
    priceMinor: 505_000,
    currency: 'EUR',
    addons: [],
    status: 'RESERVED',
    reservedAt: '2026-10-05T03:03:00.000Z',
    paidAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    returnedAt: null,
    shipment: null,
    addonItems: [],
    canAddAddons: true,
    editable: { address: true, engraving: false },
    ...o,
  };
}

describe('the add-ons’ rows (addons-model.ts)', () => {
  it('rows what is offered with its units chosen, within what may be taken, then what was chosen and is offered no longer', () => {
    expect(ADDON_UNITS_MAX).toBe(ADDON_LIMIT);
    const rows = addonRows(
      [offered({ addonId: CLOTH, name: 'Polishing cloth', line: '  A soft   cloth. ' }), offered({ addonId: CASE, name: 'THE TRAVEL CASE FOR TWO PIECES, LINED', priceMinor: 1_245_050, maxUnits: 1 })],
      new Map([[CLOTH, 2]]),
      [chosen({ addonId: EXTENDER, name: 'CHAIN EXTENDER', units: 1, priceMinor: 3_000 })],
      'EUR',
    );
    expect(rows).toEqual([
      { addonId: CLOTH, name: 'POLISHING CLOTH', line: 'A soft cloth.', priceMinor: 1_500, price: '+ €\u00a015', units: 2, max: 3 },
      { addonId: CASE, name: 'THE TRAVEL CASE FOR TWO PIECES, LINED', line: null, priceMinor: 1_245_050, price: '+ €\u00a012\u00a0450.50', units: 0, max: 1 },
      { addonId: EXTENDER, name: 'CHAIN EXTENDER', line: null, priceMinor: 3_000, price: '+ €\u00a030', units: 1, max: 1 },
    ]);
    expect(rowsTotal(rows)).toBe(2 * 1_500 + 3_000);
    expect(rowsChoice(rows)).toEqual([
      { addonId: CLOTH, units: 2 },
      { addonId: EXTENDER, units: 1 },
    ]);
    // Within 0 and its most; the note while one stands at its most.
    expect(withUnits(rows, CASE, 5).find((r) => r.addonId === CASE)!.units).toBe(1);
    expect(withUnits(rows, CLOTH, -1).find((r) => r.addonId === CLOTH)!.units).toBe(0);
    expect(rowsLimit(rows)).toBe(ADDONS.limit);
    expect(rowsLimit(withUnits(withUnits(rows, EXTENDER, 0), CLOTH, 1))).toBeNull();
  });

  it('leaves out an add-on it cannot read, sold out, or offered twice; one chosen past what is left keeps its units as its most', () => {
    const rows = addonRows(
      [
        offered({ addonId: 'not-an-id', name: 'X' }),
        offered({ addonId: CLOTH, name: '' }),
        offered({ addonId: EXTENDER, name: 'CHAIN EXTENDER', maxUnits: 0 }),
        offered({ addonId: CASE, name: 'CASE', maxUnits: 1 }),
        offered({ addonId: CASE, name: 'CASE AGAIN' }),
      ],
      new Map([[CASE, 2]]),
    );
    expect(rows.map((r) => [r.name, r.units, r.max])).toEqual([['CASE', 2, 2]]);
    expect(addonRows(null)).toEqual([]);
    expect(chosenUnits([chosen({ addonId: CLOTH, name: 'A', units: 2 }), chosen({ addonId: CASE, name: 'B', units: 0 })])).toEqual(new Map([[CLOTH, 2]]));
  });

  it('writes a receipt’s rows, their sum, and what could not be added at PAY by its name and why', () => {
    const list = [chosen({ addonId: CLOTH, name: 'Polishing cloth', units: 2 }), chosen({ addonId: EXTENDER, name: 'CHAIN EXTENDER', priceMinor: null })];
    expect(chosenRows(list, 'EUR')).toEqual([
      ['POLISHING CLOTH × 2', '+ €\u00a030'],
      ['CHAIN EXTENDER', ''],
    ]);
    // On the room's CONFIRMED, written as the release's add-ons there: without the sign.
    expect(chosenRows(list, 'EUR', formatMoney)).toEqual([
      ['POLISHING CLOTH × 2', '€\u00a030'],
      ['CHAIN EXTENDER', ''],
    ]);
    expect(chosenTotal(list)).toBe(3_000);
    expect(addonPrice(12_345_600, 'GBP')).toBe('+ £\u00a0123\u00a0456');
    expect(
      leftOutLines([
        { addonId: CLOTH, name: 'Polishing cloth', units: 2, reason: 'NONE_LEFT' },
        { addonId: CASE, name: 'The travel case', units: 1, reason: 'NOT_OFFERED' },
        { addonId: EXTENDER, name: '', units: 1, reason: 'NONE_LEFT' },
      ]),
    ).toEqual(['THE POLISHING CLOTH COULD NOT BE ADDED: NONE LEFT.', 'THE TRAVEL CASE COULD NOT BE ADDED: NO LONGER OFFERED.']);
  });
});

describe('an order’s add-ons in YOUR ORDERS (orders-model.ts, addons-model.ts)', () => {
  const items = [
    { addonId: CLOTH, name: 'POLISHING CLOTH', units: 2, priceMinor: 1_500, currency: 'EUR', canRemove: true },
    { addonId: EXTENDER, name: 'CHAIN EXTENDER', units: 1, priceMinor: 3_000, currency: 'EUR', canRemove: false },
  ];

  it('lists them among its terms, after the release’s, and counts them in its TOTAL', () => {
    const o = order({ addons: [{ label: 'Engraving', priceMinor: 15_000 }], addonItems: items });
    expect(orderAddonRows(o)).toEqual([
      ['POLISHING CLOTH × 2', '+ €\u00a030'],
      ['CHAIN EXTENDER', '+ €\u00a030'],
    ]);
    expect(orderRows(o)).toEqual([
      ['SIZE', '16'],
      ['PRICE', '€\u00a05\u00a0050'],
      ['ENGRAVING', '+ €\u00a0150'],
      ['POLISHING CLOTH × 2', '+ €\u00a030'],
      ['CHAIN EXTENDER', '+ €\u00a030'],
      ['TOTAL', '€\u00a05\u00a0260'],
    ]);
    // An add-on alone makes a TOTAL.
    expect(orderRows(order({ addonItems: [items[0]!] })).at(-1)).toEqual(['TOTAL', '€\u00a05\u00a0080']);
  });

  it('offers REMOVE for each removable one and ADD AN ADD-ON while offered; once paid, REMOVE says its credit note', () => {
    expect(orderAddons(order({ addonItems: items }))).toEqual({
      removable: [{ addonId: CLOTH, words: 'POLISHING CLOTH × 2', label: 'Remove POLISHING CLOTH × 2 from order OR-3F9A21C4' }],
      canAdd: true,
      removeNote: null,
      locked: null,
    });
    expect(orderAddons(order({ status: 'PAID', addonItems: items }))!.removeNote).toBe(ORDERS.addons.paidRemove);
    // One add-on at two prices (added before and after a price change): one REMOVE for all its units.
    const twice = [items[0]!, { ...items[0]!, units: 1, priceMinor: 2_000 }];
    expect(orderAddons(order({ addonItems: twice }))!.removable).toEqual([{ addonId: CLOTH, words: 'POLISHING CLOTH × 3', label: 'Remove POLISHING CLOTH × 3 from order OR-3F9A21C4' }]);
    expect(orderModel(order({ addonItems: items }))!.addons?.canAdd).toBe(true);
  });

  it('says packing has begun on an order that carries some, and nothing on an order with none to show nor to add', () => {
    const packed = { addonItems: items.map((i) => ({ ...i, canRemove: false })), canAddAddons: false, status: 'PAID' as const, editable: { address: false, engraving: false } };
    expect(orderAddons(order(packed))).toEqual({ removable: [], canAdd: false, removeNote: null, locked: ORDERS.addons.locked });
    // Travelling with another order (its address that order's): its engraving says it.
    expect(orderAddons(order({ ...packed, addressOf: 'OR-1A2B3C4D', engravingOffer: { priceMinor: 3_000, included: false, maxLength: 20 } }))!.locked).toBe(ORDERS.addons.locked);
    expect(orderAddons(order({ canAddAddons: false }))).toBeNull();
    expect(orderAddons(order({ ...packed, status: 'SHIPPED' }))).toBeNull();
    // A server before the add-ons: none.
    expect(orderAddons(order({ addonItems: undefined, canAddAddons: undefined }))).toBeNull();
    expect(orderRows(order({ addonItems: undefined }))).toEqual([
      ['SIZE', '16'],
      ['PRICE', '€\u00a05\u00a0050'],
    ]);
  });

  it('opens ADD AN ADD-ON on its rows, none available, or packing begun; once paid, its own invoice', () => {
    const offer = [offered({ addonId: CLOTH, name: 'POLISHING CLOTH' })];
    expect(addonSheet({ canAdd: true, reason: null, paid: false, currency: 'EUR', offer })).toMatchObject({ empty: null, paidNote: null, currency: 'EUR', rows: [{ addonId: CLOTH, units: 0, max: 3 }] });
    expect(addonSheet({ canAdd: true, reason: null, paid: true, currency: 'EUR', offer }).paidNote).toBe(ORDERS.addons.paidAdd);
    expect(addonSheet({ canAdd: true, reason: null, paid: true, currency: 'EUR', offer: [] })).toEqual({ rows: [], empty: ORDERS.addons.none, paidNote: null, currency: 'EUR' });
    expect(addonSheet({ canAdd: false, reason: 'PACKING_STARTED', paid: true, currency: 'EUR', offer: [] }).empty).toBe(ORDERS.addons.locked);
    expect(addonSheet({ canAdd: false, reason: 'CLOSED', paid: false, currency: 'EUR', offer: [] }).empty).toBe(ORDERS.addons.none);
  });
});

describe('5b, SECURED with add-ons (lot Q2, step Q2.8; live-model.ts, desktop-room.ts)', () => {
  const ENGRAVING = '1c3e5a7b-9d0f-4a2b-8c4d-6e8f0a1b2c3d';
  const WRAPPING = '2d4f6b8c-0e1a-4b3c-9d5e-7f9a1b2c3d4e';
  const hold = (o: Partial<LiveEntry> = {}) =>
    ({
      currency: 'EUR',
      quantity: 1,
      addonOffer: [
        offered({ addonId: WRAPPING, name: 'Gift wrapping', line: 'In the house’s paper, with a card in your words.', maxUnits: 1, engraving: false }),
        offered({ addonId: ENGRAVING, name: 'Engraving', line: 'Up to 12 characters, engraved by ORBES.', priceMinor: 4_000, maxUnits: 1, engraving: true, textMax: 12 }),
        offered({ addonId: CASE, name: 'The travel case', line: 'A case made to carry your piece.', priceMinor: 6_000, maxUnits: 1, engraving: false, whileAvailable: true }),
      ],
      addonItems: [{ ...chosen({ addonId: ENGRAVING, name: 'Engraving', priceMinor: 4_000 }), text: 'M. B.' }],
      ...o,
    }) as Pick<LiveEntry, 'addonOffer' | 'addonItems' | 'currency'>;

  it('draws a row per add-on you tap (one per piece), ENGRAVING chosen with YOUR TEXT counted against its textMax, and M3’s note while one has stock', () => {
    const m = securedAddons(hold())!;
    expect(m.rows.map((r) => [r.name, r.price, r.chosen, r.text])).toEqual([
      ['GIFT WRAPPING', '+ € 15', false, null],
      ['ENGRAVING', '+ € 40', true, { value: 'M. B.', max: 12, count: '5 / 12' }],
      ['THE TRAVEL CASE', '+ € 60', false, null],
    ]);
    expect(m.note).toBe('Added to your order at PAY, while available.');
    // Services only: no note (N2). The engraving without its own most characters: the house's 20; no words: 0 / 20.
    const services = securedAddons(hold({ addonOffer: [offered({ addonId: ENGRAVING, name: 'Engraving', priceMinor: 15_000, maxUnits: 1, engraving: true })], addonItems: [{ ...chosen({ addonId: ENGRAVING, name: 'Engraving' }), text: null }] }))!;
    expect(services.note).toBeNull();
    expect(services.rows[0]!.text).toEqual({ value: '', max: 20, count: '0 / 20' });
    // Typed and not saved: the field's words and count; a tap not sent yet: chosen or let go at once (no field when let go).
    const typed = securedAddons(hold(), { drafts: new Map([[ENGRAVING, 'M. B. R.']]), units: new Map([[WRAPPING, 1]]) })!;
    expect(typed.rows.map((r) => [r.chosen, r.text?.count ?? null])).toEqual([
      [true, null],
      [false, null],
      [false, null],
    ]);
    expect(securedAddons(hold(), { drafts: new Map([[ENGRAVING, 'M. B. R.']]) })!.rows[1]!.text!.count).toBe('8 / 12');
  });

  it('sends the rows chosen with the engraving’s words (none when empty), checks them against its textMax, and totals one unit per piece', () => {
    const m = securedAddons(hold(), { units: new Map([[ENGRAVING, 1], [CASE, 1]]) })!;
    expect(securedChoice(m.rows)).toEqual([
      { addonId: ENGRAVING, text: 'M. B.' },
      { addonId: CASE, text: null },
    ]);
    expect(securedChoice(m.rows, new Map([[ENGRAVING, '  A.   R. ']]))).toEqual([
      { addonId: ENGRAVING, text: 'A. R.' },
      { addonId: CASE, text: null },
    ]);
    expect(securedChoice(m.rows, new Map([[ENGRAVING, '   ']]))[0]).toEqual({ addonId: ENGRAVING, text: null });
    expect(engravingProblem('M. B.', 12)).toBeNull();
    expect(engravingProblem('', 12)).toBeNull();
    expect(engravingProblem('ABCDEFGHIJKLM', 12)).toBe('Up to 12 characters: letters, figures, spaces and . & ’ -');
    expect(engravingProblem('M. B. #', 12)).toBe(LIVE.addonText.invalid(12));
    expect(engravingProblem('ABCDEFGHIJKLMNOPQRST', ENGRAVING_TEXT_MAX)).toBeNull();
    // PAY's total is the server's (piece + each add-on chosen) × pieces: two pieces, ENGRAVING and THE TRAVEL CASE.
    const rows = holdRows({ ...hold(), addonItems: [] }, new Map([[ENGRAVING, 1], [CASE, 1]]));
    expect((505_000 + rowsTotal(rows)) * 2).toBe(1_030_000);
  });

  it('orders the computer’s right column as the mockup, or with PAY first when the rows would push it below the first screen, the note and the error line under the rows in both', () => {
    expect(securedColumn(false)).toEqual(['addons-title', 'addons', 'addons-note', 'error', 'pay', 'pay-left', 'pay-note', 'release']);
    expect(securedColumn(true)).toEqual(['pay', 'pay-left', 'pay-note', 'release', 'addons-title', 'addons', 'addons-note', 'error']);
    expect(Object.keys(SECURED_PARTS).sort()).toEqual([...securedColumn(false)].sort());
    expect([payBelowFirstScreen(900, 900), payBelowFirstScreen(900.4, 900), payBelowFirstScreen(901, 900)]).toEqual([false, false, true]);
  });

  it('names YOUR TEXT by its visible label and the row’s name, never by a sentence of its own (D37)', () => {
    const view = readFileSync(new URL('../../src/web/verify/views/secured-addons.ts', import.meta.url), 'utf8');
    expect(view).not.toMatch(/'aria-label'/);
    expect(view).toContain("'aria-labelledby': `${base}-text-label ${base}-label`");
    expect(view).toContain("'aria-describedby': [r.line ? lineId : null, countId]");
    expect(LIVE.addonText.label).toBe('YOUR TEXT');
    expect(LIVE.addonText.count(5, 12)).toBe('5 / 12');
    expect(Object.keys(LIVE.addonText).sort()).toEqual(['count', 'invalid', 'label']);
    expect(Object.keys(LIVE.addonItems)).toEqual(['note']);
  });
});

describe('the add-ons’ calls (api.ts)', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function fakeApi(responses: (() => Response)[]) {
    const calls: { url: string; method: string; body: unknown; csrf: string | undefined }[] = [];
    const api = new ApiClient({
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body, csrf: headers['x-csrf-token'] });
        const r = responses.shift();
        if (!r) throw new Error(`unexpected request ${String(input)}`);
        return r();
      }) as typeof fetch,
    });
    return { api, calls };
  }

  it('sends the hold’s rows (lot Q2, step Q2.4: each an add-on, the engraving with its words), a place held’s and a request’s, with the CSRF token', async () => {
    const entry = { id: 'e', status: 'SECURED' };
    const { api, calls } = fakeApi([
      () => json(200, { account: { email: 'you@example.com', displayName: null }, csrfToken: 't1' }),
      () => json(200, { entry }),
      () => json(200, { entry }),
      () => json(200, { entry: null, savedSize: null, addons: null }),
      () => json(201, { request: { id: 'r', status: 'OPEN', createdAt: '2026-10-05T16:49:00.000Z', modelId: 'm', addons: [] } }),
      () => json(201, { request: { id: 'r', status: 'OPEN', createdAt: '2026-10-05T16:49:00.000Z', modelId: 'm' } }),
    ]);
    await api.me();
    await api.liveAddons('d1', [{ addonId: CLOTH }, { addonId: 'e1', text: 'M. B.' }]);
    expect(calls[1]).toMatchObject({ url: '/api/v1/live/d1/addons', method: 'PUT', csrf: 't1', body: { items: [{ addonId: CLOTH }, { addonId: 'e1', text: 'M. B.' }] } });
    expect(calls[1]!.body).toEqual({ items: [{ addonId: CLOTH }, { addonId: 'e1', text: 'M. B.' }] });
    // None: an empty list clears them; empty words are not sent.
    await api.liveAddons('d1', [{ addonId: 'e1', text: '' }]);
    expect(calls[2]!.body).toEqual({ items: [{ addonId: 'e1' }] });
    await api.drawAddons('d2', [{ addonId: CLOTH, units: 1 }]);
    expect(calls[3]).toMatchObject({ url: '/api/v1/club/drops/d2/addons', method: 'PUT', csrf: 't1', body: { items: [{ addonId: CLOTH, units: 1 }] } });
    await api.requestPiece('zenith', null, '17', [{ addonId: CLOTH, units: 1 }]);
    expect(calls[4]).toMatchObject({ url: '/api/v1/club/lookbook/zenith/request', method: 'POST', body: { size: '17', addons: [{ addonId: CLOTH, units: 1 }] } });
    await api.requestPiece('zenith', 'A note', null);
    expect(calls[5]!.body).toEqual({ note: 'A note' });
  });

  it('reads YOUR ORDERS’ offer, adds and removes an add-on (the order back), and refuses an answer of the wrong shape', async () => {
    const offer = { canAdd: true, reason: null, paid: false, currency: 'EUR', offer: [offered({ addonId: CLOTH, name: 'POLISHING CLOTH' })] };
    const o = order();
    const { api, calls } = fakeApi([
      () => json(200, { account: { email: 'you@example.com', displayName: null }, csrfToken: 't1' }),
      () => json(200, offer),
      () => json(200, { order: o }),
      () => json(200, { order: o }),
      () => json(200, { canAdd: true }),
      () => json(200, { order: null }),
    ]);
    await api.me();
    expect(await api.orderAddonOffer(o.id)).toEqual(offer);
    expect(calls[1]).toMatchObject({ url: `/api/v1/account/orders/${o.id}/addons`, method: 'GET', csrf: undefined });
    expect(await api.addOrderAddon(o.id, CLOTH, 2)).toEqual(o);
    expect(calls[2]).toMatchObject({ url: `/api/v1/account/orders/${o.id}/addons`, method: 'POST', csrf: 't1', body: { addonId: CLOTH, units: 2 } });
    expect(await api.removeOrderAddon(o.id, CLOTH)).toEqual(o);
    expect(calls[3]).toMatchObject({ url: `/api/v1/account/orders/${o.id}/addons/${CLOTH}`, method: 'DELETE', csrf: 't1' });
    await expect(api.orderAddonOffer(o.id)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(api.addOrderAddon(o.id, CLOTH, 1)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});
