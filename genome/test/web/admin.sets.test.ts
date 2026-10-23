/**
 * THE SET in the console (macro scope of 2026-10-20, K44 T1, T3 and T4; lot M3 plan §5.3, step M3.17) — the pure model
 * (src/web/admin/model/sets.ts) and the set's place in the club's, the LIVE RELEASE's and the order's helpers, against
 * the server's rules, and the API client's routes:
 *
 *  - Catalogue → Sets: a set's row, its dialog's checks (2 to 4 different models in order, the code's rule, the price
 *    with its currency, its pieces frozen once a release names it) and what it sends (an edit only what changed).
 *  - A set's draw: its fields of pieces per piece, the sets on sale and the even rule, the body (setId, each size's
 *    piece), an edit's change; its outcome and sizes named by their piece; an entry's sizes.
 *  - A set's LIVE RELEASE: its lines per piece, its sets on sale (the scarcest piece's), « N SETS », « 1 SET PER
 *    PERSON » (T4), the New live release's body.
 *  - The order page: the set's orders and shares, Cancel naming the set's orders, DECIDE THE SET's checks and body.
 *  - The server's answers fit the console's types; the words are calm.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdminDrop as ServerAdminDrop, AdminDropEntry as ServerAdminDropEntry } from '../../src/server/services/drops.js';
import type { AdminLiveBoard as ServerLiveBoard, AdminLiveCard as ServerLiveCard, AdminLiveRelease as ServerLiveRelease } from '../../src/server/services/live-console.js';
import type { ReleasePlan as ServerReleasePlan, SetSizeMix as ServerSetSizeMix } from '../../src/server/services/live-insights.js';
import type { ReleaseCampaign as ServerReleaseCampaign } from '../../src/server/services/campaign.js';
import type { GrowthRelease as ServerGrowthRelease } from '../../src/server/services/growth.js';
import type { CaseDecided as ServerCaseDecided, OrderCaseRecord as ServerOrderCase } from '../../src/server/services/order-cases.js';
import type { AdminOrderSet as ServerOrderSet } from '../../src/server/services/orders.js';
import { SET_CODE_PATTERN as SERVER_CODE, SET_NAME_MAX as SERVER_NAME_MAX, SET_PIECES_MAX as SERVER_PIECES_MAX, SET_PIECES_MIN as SERVER_PIECES_MIN } from '../../src/server/db/schema.js';
import type { SetView as ServerSetView } from '../../src/server/services/sets.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { dropChange, dropInput, dropProblem, drawOutcomeText, drawSizesChange } from '../../src/web/admin/model/club.js';
import { releaseRow } from '../../src/web/admin/model/growth.js';
import { defaultQuantityLine, livePartChange, livePartProblem, livePartValues, newLiveInput, newLiveProblem, parseSetSizes, setsOnSale } from '../../src/web/admin/model/live.js';
import {
  entrySizesText,
  groupCaseLine,
  groupPieces,
  ORDER_SET_TEXT,
  orderSetPieceLine,
  orderSetPriceText,
  orderSetShare,
  perPersonText,
  pieceAtField,
  pieceName,
  pieceSizeLabel,
  pieceTotals,
  pieceToField,
  releaseOfferLine,
  SET_LIMITS,
  setCancelText,
  setChange,
  setCreateInput,
  setDecisionInput,
  setDecisionProblem,
  setDrawSizesInput,
  setDrawSizesOf,
  setDrawSizesProblem,
  setDrawSizeValues,
  setFormValues,
  setModelOptions,
  setOptions,
  setPieceSizes,
  setPiecesLines,
  setPriceText,
  setProblem,
  setReleasesText,
  setShopifyInput,
  setShopifyProblem,
  setShopifyStatus,
  setSizeField,
  setsOnSaleLines,
  setState,
  SETS_TEXT,
} from '../../src/web/admin/model/sets.js';
import type * as web from '../../src/web/admin/types.js';

const N = '\u00a0';
const S1 = '0f0e0d0c-0b0a-4908-8706-050403020101';
const M1 = '1f0e0d0c-0b0a-4908-8706-050403020101';
const M2 = '1f0e0d0c-0b0a-4908-8706-050403020102';
const M3 = '1f0e0d0c-0b0a-4908-8706-050403020103';
const O1 = '2f0e0d0c-0b0a-4908-8706-050403020101';
const O2 = '2f0e0d0c-0b0a-4908-8706-050403020102';
const O3 = '2f0e0d0c-0b0a-4908-8706-050403020103';
const C1 = '3f0e0d0c-0b0a-4908-8706-050403020101';
const C2 = '3f0e0d0c-0b0a-4908-8706-050403020102';
const LOC = '4f0e0d0c-0b0a-4908-8706-050403020101';

const piece = (position: number, id: string, name: string, sizes: (string | null)[], variant: string | null = null): web.SetView['pieces'][number] => ({
  position,
  model: { id, name, variant, variantOf: null, type: 'RING', active: true, sizeType: 'RING', imageUrl: null },
  sizes: sizes.map((label, i) => ({ skuId: `${id.slice(0, -2)}${i}${i}`, label })),
  basePrice: { priceMinor: 210_000, currency: 'EUR' },
});

const AURA: web.SetView = {
  id: S1,
  name: 'AURA',
  code: 'AURA',
  basePriceMinor: 420_000,
  baseCurrency: 'EUR',
  active: true,
  shopifyProductId: null,
  pieces: [piece(1, M1, 'HALO', ['52', '54']), piece(2, M2, 'ECLAT', ['M', 'L'], 'STEEL')],
  releases: [],
  createdAt: '2026-10-22T08:00:00.000Z',
  updatedAt: '2026-10-22T08:00:00.000Z',
};

const SET: web.ReleaseSet = {
  id: S1,
  name: 'AURA',
  code: 'AURA',
  active: true,
  pieces: [
    { piece: 1, model: { id: M1, name: 'HALO', type: 'RING', active: true, variant: null } },
    { piece: 2, model: { id: M2, name: 'ECLAT', type: 'BRACELET', active: true, variant: 'STEEL' } },
  ],
};

const model = (id: string, name: string, over: Partial<web.Model> = {}): web.Model => ({ id, name, type: 'RING', active: true, variantOf: null, variantLabel: null, sizeType: 'RING', sizesOffered: 2, ...over }) as web.Model;

describe('Catalogue → Sets', () => {
  it('holds the server\'s bounds and the code\'s rule', () => {
    expect(SET_LIMITS).toMatchObject({ name: SERVER_NAME_MAX, piecesMin: SERVER_PIECES_MIN, piecesMax: SERVER_PIECES_MAX });
    for (const code of ['AURA', 'A1', 'AURA-2026']) expect(SERVER_CODE.test(code)).toBe(true);
  });

  it('reads a row: its pieces in order, its price, its releases, its state and Shopify link', () => {
    expect(setPiecesLines(AURA)).toEqual(['1 · HALO · RING', '2 · ECLAT · RING · STEEL']);
    expect(setPriceText(AURA)).toBe(`€${N}4${N}200`);
    expect(setPriceText({ basePriceMinor: null, baseCurrency: null })).toBe('No base price');
    expect(setReleasesText(AURA)).toBe('None yet');
    expect(setReleasesText({ releases: [{ id: 'd', mode: 'DRAW', title: 'x', opensAt: '', publishedAt: null, cancelledAt: null }] })).toBe('1 release');
    expect(setState(AURA)).toBe('ACTIVE');
    expect(setState({ active: false })).toBe('SET ASIDE');
    expect(setShopifyStatus(AURA)).toBe('NOT LINKED');
    expect(SETS_TEXT.empty).toBe('No set yet: group 2 to 4 models sold at one price.');
  });

  it('offers the active models and variants, a variant after its main model, one with no size greyed out', () => {
    const models = [model(M1, 'HALO'), model(M3, 'ORBIT', { sizeType: null, sizesOffered: 0 }), model(M2, 'HALO', { variantOf: { id: M1, name: 'HALO', label: null }, variantLabel: 'STEEL' }), model('x', 'OLD', { active: false })];
    expect(setModelOptions(models)).toEqual([
      { value: M1, label: 'HALO · RING' },
      { value: M2, label: 'HALO · RING · STEEL' },
      { value: M3, label: 'ORBIT · RING · no size offered', disabled: true },
    ]);
    // A model the set holds stays offered, even no longer active.
    expect(setModelOptions(models, ['x']).map((o) => o.value)).toContain('x');
  });

  it('refuses before sending what the server would refuse', () => {
    const v = { ...setFormValues(null), name: 'Aura', code: 'aura', piece1: M1, piece2: M2 };
    expect(setProblem(v)).toBeNull();
    expect(setProblem({ ...v, name: ' ' })).toBe('Give the set a name.');
    expect(setProblem({ ...v, code: 'A' })).toMatch(/^The code is 2 to 40 capitals/);
    expect(setProblem({ ...v, piece2: '' })).toBe('A set groups 2 to 4 models.');
    expect(setProblem({ ...v, piece2: '', piece3: M3 })).toBe('Give the pieces in order, without an empty one between two.');
    expect(setProblem({ ...v, piece2: M1 })).toBe('Each model is in a set once.');
    expect(setProblem({ ...v, price: '42,00,0' })).toBe('The price is an amount in units: 4200, or 4200.50.');
    // Once a release names it, its pieces are frozen; its name and price still change.
    const named = { ...AURA, releases: [{ id: 'd', mode: 'DRAW' as const, title: 'x', opensAt: '', publishedAt: null, cancelledAt: null }] };
    expect(setProblem({ ...setFormValues(named), piece3: M3 }, named)).toBe(SETS_TEXT.frozen);
    expect(setProblem({ ...setFormValues(named), name: 'AURA II' }, named)).toBeNull();
  });

  it('sends a creation with its code in capitals and the price only when given; an edit only what changed', () => {
    expect(setCreateInput({ ...setFormValues(null), name: ' Aura ', code: 'aura-1', piece1: M1, piece2: M2 })).toEqual({ name: 'Aura', code: 'AURA-1', modelIds: [M1, M2] });
    expect(setCreateInput({ ...setFormValues(null), name: 'Aura', code: 'AURA', piece1: M1, piece2: M2, price: '4200', currency: 'CHF' })).toEqual({ name: 'Aura', code: 'AURA', modelIds: [M1, M2], basePriceMinor: 420_000, baseCurrency: 'CHF' });
    const same = setFormValues(AURA);
    expect(setChange(AURA, same)).toEqual({});
    expect(setChange(AURA, { ...same, piece3: M3 })).toEqual({ modelIds: [M1, M2, M3] });
    expect(setChange(AURA, { ...same, price: '' })).toEqual({ basePriceMinor: null, baseCurrency: null });
    expect(setChange(AURA, { ...same, code: 'aura-x' })).toEqual({ code: 'AURA-X' });
  });

  it('checks the Shopify product pasted back', () => {
    expect(setShopifyProblem(AURA, { productId: '' })).toBe(SETS_TEXT.unchanged);
    expect(setShopifyProblem(AURA, { productId: 'nope' })).toMatch(/^The product id/);
    expect(setShopifyProblem(AURA, { productId: 'https://admin.shopify.com/store/x/products/123' })).toBeNull();
    expect(setShopifyInput({ productId: 'https://admin.shopify.com/store/x/products/123' })).toBe('123');
    expect(setShopifyInput({ productId: '' })).toBeNull();
  });
});

describe('a set\'s release, as the club and its pages name it', () => {
  it('names a set by its pieces, a size by its piece, an entry by its sizes, the limit in sets (T4)', () => {
    expect(setOptions([AURA, { ...AURA, id: 'x', active: false }])).toEqual([{ value: S1, label: 'AURA · 2 PIECES' }]);
    expect(releaseOfferLine({ model: { name: 'AURA', type: 'SET' }, set: SET })).toBe('Set · HALO · ECLAT');
    expect(releaseOfferLine({ model: { name: 'MONOLITHE', type: 'RING' } })).toBe('MONOLITHE · RING');
    expect(pieceName(SET, 2)).toBe('ECLAT · STEEL');
    expect(pieceSizeLabel(SET, { label: 'M', piece: 2 })).toBe('ECLAT · STEEL · M');
    expect(pieceSizeLabel(undefined, { label: '52' })).toBe('52');
    expect(entrySizesText([{ piece: 2, id: 'b', label: 'M' }, { piece: 1, id: 'a', label: '52' }])).toBe('52 · M');
    expect(perPersonText(1, true)).toBe('1 SET PER PERSON');
    expect(perPersonText(2, false)).toBe('2 PIECES PER PERSON');
    expect(defaultQuantityLine(25, true)).toBe('25 SETS');
    expect(defaultQuantityLine(1, true)).toBe('1 SET');
  });

  it('gives a set draw a field of pieces per piece\'s size, its sets on sale and the even rule, and sends each size with its piece', () => {
    const pieces = setPieceSizes(AURA);
    expect(pieces).toEqual([
      { piece: 1, name: 'HALO', labels: ['52', '54'] },
      { piece: 2, name: 'ECLAT · STEEL', labels: ['M', 'L'] },
    ]);
    const v = { ...setDrawSizeValues(pieces, null), [setSizeField(1, '52')]: '10', [setSizeField(1, '54')]: '15', [setSizeField(2, 'M')]: '20' };
    expect(setDrawSizesOf(v).map((s) => [s.piece, s.label, s.pieces])).toEqual([
      [1, '52', 10],
      [1, '54', 15],
      [2, 'M', 20],
      [2, 'L', 0],
    ]);
    expect(setDrawSizesProblem(v, pieces)).toBeNull();
    expect(setDrawSizesProblem({ ...v, [setSizeField(2, 'M')]: '0' }, pieces)).toBe('Give ECLAT · STEEL at least one size with pieces.');
    expect(setDrawSizesProblem({ ...v, [setSizeField(2, 'M')]: 'x' }, pieces)).toBe('A size has 0 to 10 000 pieces.');
    // The even rule: said while the pieces differ, never a refusal of a draft.
    const totals = pieceTotals(setDrawSizesOf(v), 2);
    expect(totals).toEqual([25, 20]);
    expect(setsOnSaleLines(totals, ['HALO', 'ECLAT · STEEL'], 'DRAW')).toEqual({ onSale: 'Sets on sale: 20', uneven: 'Each piece’s sizes add up to the same sets before the draw is published: HALO 25 · ECLAT · STEEL 20.' });
    expect(setsOnSaleLines([25, 25], ['HALO', 'ECLAT'], 'DRAW').uneven).toBeNull();
    expect(setsOnSaleLines([25, 20], ['HALO', 'ECLAT'], 'LIVE').uneven).toBe('The release sells as many sets as its scarcest piece: HALO 25 · ECLAT 20.');
    expect(setDrawSizesInput(v)).toEqual([
      { piece: 1, label: '52', pieces: 10 },
      { piece: 1, label: '54', pieces: 15 },
      { piece: 2, label: 'M', pieces: 20 },
    ]);
    // The draw's body sells the set; its problem checks the sizes per piece.
    const base = { title: 'The set', description: '', opensAt: '2026-11-01T10:00', closesAt: '2026-11-03T10:00', purchaseWindowHours: '48', earlyAccessHours: '0', earlyAccessPlatineHours: '0', price: '4200', currency: 'EUR' };
    expect(dropProblem({ ...base, ...v, setId: S1 }, (x) => setDrawSizesProblem(x, pieces))).toBeNull();
    const body = dropInput({ ...base, ...v, setId: S1 });
    expect(body).toMatchObject({ setId: S1, priceMinor: 420_000, currency: 'EUR', sizes: setDrawSizesInput(v) });
    expect(body).not.toHaveProperty('modelId');
  });

  it('changes a set\'s draft: its sizes per piece when they changed, another set with its sizes, never a model', () => {
    const d = {
      id: 'd1',
      title: 'The set',
      description: null,
      model: { id: S1, name: 'AURA', type: 'SET', active: true, variant: null },
      set: SET,
      sizes: [
        { id: 'z1', label: '52', piece: 1, pieces: 10, reserved: 0, entered: 0, held: 0, waitlisted: 0, guaranteedEntered: 0 },
        { id: 'z2', label: 'M', piece: 2, pieces: 10, reserved: 0, entered: 0, held: 0, waitlisted: 0, guaranteedEntered: 0 },
      ],
      opensAt: '2026-11-01T10:00:00.000Z',
      closesAt: '2026-11-03T10:00:00.000Z',
      purchaseWindowHours: 48,
      earlyAccessHours: 0,
      earlyAccessPlatineHours: 0,
      priceMinor: null,
      currency: null,
      accessSegment: null,
    } as unknown as web.Drop;
    const pieces = setPieceSizes(AURA);
    const values = setDrawSizeValues(pieces, d);
    expect(values).toEqual({ [setSizeField(1, '52')]: '10', [setSizeField(1, '54')]: '0', [setSizeField(2, 'M')]: '10', [setSizeField(2, 'L')]: '0' });
    expect(drawSizesChange(d, values)).toBeNull();
    expect(drawSizesChange(d, { ...values, [setSizeField(2, 'L')]: '3' })).toEqual([
      { piece: 1, label: '52', pieces: 10 },
      { piece: 2, label: 'M', pieces: 10 },
      { piece: 2, label: 'L', pieces: 3 },
    ]);
    const form = { title: 'The set', description: '', opensAt: '2026-11-01T10:00', closesAt: '2026-11-03T10:00', purchaseWindowHours: '48', earlyAccessHours: '0', earlyAccessPlatineHours: '0', price: '', currency: 'EUR', ...values };
    expect(dropChange(d, { ...form, setId: S1 })).toEqual({});
    expect(dropChange(d, { ...form, setId: 'other' })).toEqual({ setId: 'other', sizes: setDrawSizesInput(values) });
    // The draw's outcome names each size by its piece.
    expect(drawOutcomeText({ selected: 2, waitlisted: 1, sizes: [{ id: 'z2', label: 'M', piece: 2, places: 1, selected: 1, waitlisted: 1 }], drop: d })).toBe('Drawn. ECLAT · STEEL · M: 1 selected, 1 on the waiting list.');
  });

  it('gives a set\'s LIVE RELEASE its lines per piece, its sets on sale the scarcest piece\'s, and sends its set, its one price and each size\'s piece', () => {
    const names = ['HALO', 'ECLAT · STEEL'];
    // (ONE QUEUE, lot Q1, D1: the pace and the hold, required.)
    const v = { offer: 'SET', setId: S1, title: 'The set', opensAt: '2026-11-01T18:00', closesAt: '2026-11-01T19:00', price: '', priceSet: '4200', currency: 'EUR', locationId: '', paceBatch: '250', paceMinutes: '1', holdMinutes: '0', sizes: '', sizes1: '52 = 10\n54 = 15', sizes2: 'M = 20' };
    expect(newLiveProblem(v, names)).toBeNull();
    expect(newLiveProblem({ ...v, sizes2: '' }, names)).toBe('ECLAT · STEEL: list the sizes, one per line: its label, then its stock (52 = 3).');
    expect(newLiveProblem({ ...v, setId: '' }, names)).toBe('Choose the set of the release.');
    expect(newLiveProblem({ ...v, priceSet: 'x' }, names)).toBe('The price of the set, in units (4800, or 4800.50).');
    const body = newLiveInput(v, names);
    expect(body).toMatchObject({ setId: S1, priceMinor: 420_000, currency: 'EUR' });
    expect(body).not.toHaveProperty('modelId');
    expect(body.sizes).toEqual([
      { label: '52', stock: 10, piece: 1 },
      { label: '54', stock: 15, piece: 1 },
      { label: 'M', stock: 20, piece: 2 },
    ]);
    expect(setsOnSale(body.sizes as { stock: number; piece: number }[], 2)).toBe(20);
    // A model's release is as it was.
    expect(newLiveInput({ ...v, offer: 'MODEL', modelId: M1, price: '4800', sizes: 'ONE SIZE = 25' })).toMatchObject({ modelId: M1, priceMinor: 480_000, sizes: [{ label: 'ONE SIZE', stock: 25 }] });

    // Its page's Sizes and stock: each piece's lines, each size keeping its id; « 20 SETS » by default.
    const r = {
      set: SET,
      quantity: 20,
      quantityLine: '20 SETS',
      locationId: null,
      perAccount: 1,
      sizes: [
        { id: 'z1', label: '52', stock: 10, piece: 1 },
        { id: 'z2', label: '54', stock: 15, piece: 1 },
        { id: 'z3', label: 'M', stock: 20, piece: 2 },
      ],
    } as unknown as web.LiveRelease;
    const parts = livePartValues(r, 'sizes');
    expect(parts).toEqual({ sizes1: '52 = 10\n54 = 15', sizes2: 'M = 20', quantityLine: '', locationId: '' });
    expect(livePartChange(r, 'sizes', parts)).toEqual({});
    expect(livePartChange(r, 'sizes', { ...parts, sizes2: 'M = 20\nL = 5' })).toEqual({
      sizes: [
        { id: 'z1', label: '52', stock: 10, piece: 1 },
        { id: 'z2', label: '54', stock: 15, piece: 1 },
        { id: 'z3', label: 'M', stock: 20, piece: 2 },
        { label: 'L', stock: 5, piece: 2 },
      ],
    });
    expect(parseSetSizes({ sizes1: '52 = 1', sizes2: 'M = x' }, ['HALO', 'ECLAT'])).toEqual({ problem: 'ECLAT: line 1: a size’s label, then its stock (52 = 3).' });
    // T4: 1 to 5 sets per person, said in sets.
    expect(livePartProblem(r, 'release', { setId: S1, title: 'The set', description: '', price: '4200', currency: 'EUR', perAccount: '6' })).toBe('A person secures 1 to 5 sets.');
    expect(livePartValues(r, 'release')).toMatchObject({ setId: S1 });
    expect(livePartValues(r, 'release')).not.toHaveProperty('modelId');
  });

  it('counts a set\'s release in sets in Growth\'s latest releases', () => {
    const row = releaseRow({ id: 'd1', mode: 'LIVE', title: 'The set', opensAt: '2026-11-01T18:00:00.000Z', pieces: 20, sold: 12, sellOutMs: null, entries: null, set: { name: 'AURA', pieces: 2 } });
    expect(row).toMatchObject({ method: 'LIVE RELEASE · SET OF 2', pieces: '20 sets', sold: '12 sets' });
  });
});

describe('the order page: Part of THE SET', () => {
  const sale: web.AdminOrderSet = {
    saleId: 's1',
    setId: S1,
    name: 'AURA',
    priceMinor: 420_000,
    currency: 'EUR',
    piece: 1,
    orders: [
      { id: O1, reference: 'ORB-1', piece: 1, channel: 'DRAW', status: 'PAID', model: 'HALO', variant: null, sizeLabel: '52', priceMinor: 210_001, currency: 'EUR' },
      { id: O2, reference: 'ORB-2', piece: 2, channel: 'DRAW', status: 'PAID', model: 'ECLAT', variant: 'STEEL', sizeLabel: 'M', priceMinor: 209_999, currency: 'EUR' },
    ],
  };

  it('reads the set\'s price, each order\'s piece and share', () => {
    expect(ORDER_SET_TEXT.part('aura')).toBe('Part of THE SET AURA');
    expect(orderSetPriceText(sale)).toBe(`€${N}4${N}200 for the set`);
    expect(orderSetPieceLine(sale.orders[1]!)).toBe('Piece 2 · ECLAT · STEEL · M');
    expect(orderSetShare(sale.orders[0]!)).toBe(`€${N}2${N}100.01`);
  });

  it('says Cancel cancels the set\'s orders; a piece\'s size exchange is cancelled alone', () => {
    expect(setCancelText(sale, O1, 'DRAW')).toBe('A set is cancelled whole: this cancels the set’s 2 orders, ORB-1, ORB-2.');
    expect(setCancelText(sale, O3, 'EXCHANGE')).toBeNull();
    expect(setCancelText(null, O1, 'DRAW')).toBeNull();
  });

  it('decides the set together: every piece back first, each piece where ORBES says, one body', () => {
    const c = {
      id: C1,
      group: {
        id: 'g1',
        cases: [
          { id: C1, order: { id: O1, reference: 'ORB-1' }, status: 'RECEIVED' as const, received: true },
          { id: C2, order: { id: O2, reference: 'ORB-2' }, status: 'OPEN' as const, received: false },
        ],
      },
    };
    expect(groupPieces(c, sale).map((p) => p.line)).toEqual(['Piece 1 · HALO · 52', 'Piece 2 · ECLAT · STEEL · M']);
    expect(groupCaseLine(c.group.cases[1]!, sale)).toBe('Piece 2 · ECLAT · STEEL · M · ORB-2 · NOT BACK YET');
    const v = { decision: 'REFUND', [pieceToField(C1)]: 'RESTOCKED', [pieceAtField(C1)]: LOC, [pieceToField(C2)]: 'ARCHIVED', note: 'Back whole.' };
    expect(setDecisionProblem(c, v)).toBe('1 piece is not back yet: the set is decided once every piece is received.');
    const back = { ...c, group: { ...c.group, cases: c.group.cases.map((x) => ({ ...x, status: 'RECEIVED' as const, received: true })) } };
    expect(setDecisionProblem(back, v)).toBeNull();
    expect(setDecisionProblem(back, { ...v, [pieceToField(C2)]: '' })).toBe('Say where the piece of ORB-2 goes.');
    expect(setDecisionProblem(back, { ...v, [pieceAtField(C1)]: '' })).toBe('Choose the location the piece of ORB-1 goes back to.');
    expect(setDecisionProblem(back, { ...v, note: ' ' })).toBe('Say in the note why.');
    expect(setDecisionInput(back, v)).toEqual({
      decision: 'REFUND',
      pieceTo: 'RESTOCKED',
      locationId: LOC,
      note: 'Back whole.',
      pieces: [
        { caseId: C1, pieceTo: 'RESTOCKED', locationId: LOC },
        { caseId: C2, pieceTo: 'ARCHIVED' },
      ],
    });
  });
});

describe('the words', () => {
  it('are calm: no atelier, handmade or craft, no exclamation mark', () => {
    for (const file of ['model/sets.ts', 'views/sets.ts']) {
      const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/admin', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code).not.toMatch(/atelier|handmade|hand-made|craft|!['"`]/i);
    }
  });
});

describe('the API client', () => {
  it('calls the sets\' routes, the set size mix and DECIDE THE SET with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.sets();
    await api.set(S1);
    await api.createSet({ name: 'Aura', code: 'AURA', modelIds: [M1, M2] });
    await api.updateSet(S1, { basePriceMinor: null, baseCurrency: null });
    await api.setSetAside(S1);
    await api.reinstateSet(S1);
    await api.linkSetShopify(S1, '123');
    await api.setSizeMix(S1, LOC);
    await api.decideOrderCase(C1, { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: LOC, note: 'Back.', pieces: [{ caseId: C2, pieceTo: 'ARCHIVED' }] });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/sets',
      `GET /api/admin/sets/${S1}`,
      'POST /api/admin/sets',
      `PATCH /api/admin/sets/${S1}`,
      `POST /api/admin/sets/${S1}/set-aside`,
      `POST /api/admin/sets/${S1}/reinstate`,
      `PUT /api/admin/sets/${S1}/shopify`,
      `GET /api/admin/live/size-mix?setId=${S1}&locationId=${LOC}`,
      `POST /api/admin/order-cases/${C1}/decide`,
    ]);
    const bodies = calls.filter((c) => c.init.method !== 'GET').map((c) => JSON.parse(String(c.init.body)));
    expect(bodies).toEqual([
      { name: 'Aura', code: 'AURA', modelIds: [M1, M2] },
      { basePriceMinor: null, baseCurrency: null },
      {},
      {},
      { productId: '123' },
      { decision: 'REFUND', pieceTo: 'RESTOCKED', locationId: LOC, note: 'Back.', pieces: [{ caseId: C2, pieceTo: 'ARCHIVED' }] },
    ]);
    for (const c of calls.filter((x) => x.init.method !== 'GET')) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});

// ── The server's answers fit the console's types (checked by the compiler) ──────────────────────────────────────

type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
export const setViewFits = (s: Json<ServerSetView>): web.SetView => s;
export const setDropFits = (d: NonNullable<Json<ServerAdminDrop>['set']>): web.ReleaseSet => d;
export const setDropEntryFits = (e: NonNullable<Json<ServerAdminDropEntry>['sizes']>): web.PieceSizeRef[] => e;
export const setLiveCardFits = (c: NonNullable<Json<ServerLiveCard>['set']>): web.ReleaseSet => c;
export const setLiveSizesFits = (s: Json<ServerLiveRelease>['sizes']): web.LiveRelease['sizes'] => s;
export const setLiveBoardFits = (b: Pick<Json<ServerLiveBoard>, 'pieces' | 'sizes'>): Pick<web.LiveBoard, 'pieces' | 'sizes'> => b;
export const setSizeMixFits = (m: Json<ServerSetSizeMix>): web.SetSizeMix => m;
export const setPlanFits = (p: Json<ServerReleasePlan>['pieces']): web.LiveReleasePlan['pieces'] => p;
export const setCampaignFits = (c: Json<ServerReleaseCampaign>['offer']): web.ReleaseCampaign['offer'] => c;
export const setGrowthFits = (g: Json<ServerGrowthRelease>): web.GrowthRelease => g;
export const setOrderFits = (s: Json<ServerOrderSet>): web.AdminOrderSet => s;
export const setCaseFits = (c: Json<ServerOrderCase>['group']): web.OrderCaseRecord['group'] => c;
export const setDecidedFits = (d: Json<ServerCaseDecided>['group']): web.OrderCaseDecided['group'] => d;
