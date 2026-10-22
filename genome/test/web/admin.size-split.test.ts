/**
 * ORDER A MODEL and the countries each location serves, in the console (macro scope of 2026-10-20, K11 Z1 and Z2; lot M3
 * plan §3.3, step M3.7) — the pure models (src/web/admin/model/size-split.ts, model/location-countries.ts) against the
 * server's bounds, and the API client's routes:
 *
 *  - Order a model: the MODEL choices (active main models naturally sorted, each with its variants under it), PIECES
 *    and TO ORDER's checks, the lines staff leave (0 leaves one out), the total « N of M pieces » with its warning, the
 *    source and unmatched lines, what ADD TO DRAFTS sends and how its answer is said.
 *  - SERVES and Edit countries: the names, the choices left, the countries moving here, the toast.
 *  - The words: calm, no atelier, handmade or craft, no exclamation mark; never a collector named.
 */
import { describe, expect, it } from 'vitest';
import { SPLIT_QUANTITY_MAX } from '../../src/server/services/size-split.js';
import { SUPPLIER_ORDER_LIMITS } from '../../src/server/services/supplier-orders.js';
import { COUNTRY_CODES } from '../../src/shared/countries.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import {
  countriesMovingHere,
  countriesSavedToast,
  countryAddOptions,
  LOCATION_COUNTRIES_TEXT,
  movingLine,
  sameCountries,
  servedNames,
} from '../../src/web/admin/model/location-countries.js';
import {
  piecesOf,
  piecesProblem,
  SPLIT_COLUMNS,
  SPLIT_LIMITS,
  SPLIT_TEXT,
  splitAddedToast,
  splitDraftLines,
  splitDraftWords,
  splitEdited,
  splitLineKey,
  splitModelChoices,
  splitSourceLine,
  splitTotal,
  splitTotalLine,
  splitTotalWarning,
  splitUnmatchedLine,
  toOrderOf,
} from '../../src/web/admin/model/size-split.js';
import type { Model, SizeSplitProposal, SplitDraftsResult, StockLocation } from '../../src/web/admin/types.js';

const model = (id: string, name: string, o: { label?: string; of?: string; active?: boolean; prefix?: string } = {}) =>
  ({
    id,
    name,
    type: 'RING',
    active: o.active ?? true,
    skuPrefix: o.prefix ?? id.toUpperCase(),
    variantLabel: o.label ?? null,
    variantOf: o.of ? { id: o.of, name, label: null } : null,
  }) as unknown as Model;

const FRANCE = { id: 'l1', name: 'FRANCE WAREHOUSE', isDefault: true };
const LOGISTICS = { id: 'l2', name: 'LOGISTICS WAREHOUSE', isDefault: false };

const line = (size: string | null, at: { id: string; name: string }, orders: number, savedSizes: number, proposed: number) => ({
  sku: { id: `k-${size ?? 'OS'}`, code: `ORB-${size ?? 'OS'}`, sizeLabel: size },
  location: { id: at.id, name: at.name },
  orders,
  savedSizes,
  proposed,
});

/** ORBIT: 10 pieces; 52 FRANCE 2 orders, 54 LOGISTICS 1 order and 1 saved size; 7, 3 proposed. */
const PROPOSAL: SizeSplitProposal = {
  model: { id: 'm1', name: 'ORBIT', variant: null },
  sizeKind: 'RING',
  quantity: 10,
  locations: [FRANCE, LOGISTICS],
  lines: [line('50', FRANCE, 0, 0, 0), line('50', LOGISTICS, 0, 0, 0), line('52', FRANCE, 2, 0, 7), line('52', LOGISTICS, 0, 0, 0), line('54', FRANCE, 0, 0, 0), line('54', LOGISTICS, 1, 1, 3)],
  totals: { orders: 3, savedSizes: 1, proposed: 10 },
  unmatched: 0,
  source: 'DATA',
};

describe('Order a model: the ask', () => {
  it('offers each active main model naturally sorted, then its active variants under it; an inactive model is not ordered again', () => {
    const models = [
      model('a10', 'ORBIT 10'),
      model('a2', 'ORBIT 2'),
      model('h', 'HALO', { label: 'Silver' }),
      model('hg', 'HALO', { label: 'Gold', of: 'h' }),
      model('hb', 'HALO', { label: 'Black', of: 'h' }),
      model('hx', 'HALO', { label: 'Rose', of: 'h', active: false }),
      model('old', 'ECLIPSE', { active: false }),
      model('cv', 'CHAIN', { label: 'Steel', of: 'c-off' }),
    ];
    expect(splitModelChoices(models)).toEqual([
      { value: '', label: 'Choose a model' },
      { value: 'cv', label: 'CHAIN · STEEL' },
      { value: 'h', label: 'HALO · SILVER' },
      { value: 'hb', label: '— BLACK' },
      { value: 'hg', label: '— GOLD' },
      { value: 'a2', label: 'ORBIT 2' },
      { value: 'a10', label: 'ORBIT 10' },
    ]);
  });

  it('takes 1 to 10 000 pieces, as the server does, and says so otherwise', () => {
    expect(SPLIT_LIMITS.quantity).toBe(SPLIT_QUANTITY_MAX);
    expect(SPLIT_LIMITS.line).toBe(SUPPLIER_ORDER_LIMITS.quantity);
    expect(['1', ' 12 ', '10 000', '10000'].map(piecesOf)).toEqual([1, 12, 10_000, 10_000]);
    for (const bad of ['', '0', '10001', '1.5', '-3', 'ten']) {
      expect(piecesOf(bad)).toBeNull();
      expect(piecesProblem(bad)).toBe('Pieces: a whole number, 1 to 10\u2009000.');
    }
    expect(piecesProblem('120')).toBeNull();
  });
});

describe('Order a model: the split', () => {
  it('reads every line as proposed until a TO ORDER is typed; 0 or empty leaves a line out; a figure that is not one blocks', () => {
    expect(SPLIT_COLUMNS).toEqual(['Size', 'Location', 'Orders', 'Saved sizes', 'Proposed', 'To order']);
    expect(['', ' ', '0', '7', '10 000'].map(toOrderOf)).toEqual([0, 0, 0, 7, 10_000]);
    expect(['10001', '-1', '2.5', 'x'].map(toOrderOf)).toEqual([null, null, null, null]);
    const none = new Map<string, string>();
    expect(splitEdited(PROPOSAL, none)).toBe(false);
    expect(splitTotal(PROPOSAL, none)).toBe(10);
    expect(splitDraftLines(PROPOSAL, none)).toEqual([
      { skuId: 'k-52', locationId: 'l1', quantity: 7 },
      { skuId: 'k-54', locationId: 'l2', quantity: 3 },
    ]);
    // 54 LOGISTICS to 4, 50 FRANCE to 2, 52 FRANCE typed back to its 7: edited, 13 to order.
    const edits = new Map([
      [splitLineKey(PROPOSAL.lines[5]!), '4'],
      [splitLineKey(PROPOSAL.lines[0]!), '2'],
      [splitLineKey(PROPOSAL.lines[2]!), '7'],
    ]);
    expect(splitEdited(PROPOSAL, edits)).toBe(true);
    expect(splitTotal(PROPOSAL, edits)).toBe(13);
    expect(splitDraftLines(PROPOSAL, edits)).toEqual([
      { skuId: 'k-50', locationId: 'l1', quantity: 2 },
      { skuId: 'k-52', locationId: 'l1', quantity: 7 },
      { skuId: 'k-54', locationId: 'l2', quantity: 4 },
    ]);
    // Back to what was proposed: not edited any more.
    expect(splitEdited(PROPOSAL, new Map([[splitLineKey(PROPOSAL.lines[2]!), '7']]))).toBe(false);
    // A line typed as 0 is left out; a figure that is not one stops the total and the body.
    const zero = new Map([[splitLineKey(PROPOSAL.lines[2]!), '0']]);
    expect(splitDraftLines(PROPOSAL, zero)).toEqual([{ skuId: 'k-54', locationId: 'l2', quantity: 3 }]);
    const bad = new Map([[splitLineKey(PROPOSAL.lines[2]!), 'seven']]);
    expect(splitTotal(PROPOSAL, bad)).toBeNull();
    expect(splitDraftLines(PROPOSAL, bad)).toBeNull();
  });

  it('keeps the total in view against the pieces asked, with a warning (never a refusal) when it differs', () => {
    expect(splitTotalLine(10, 10)).toBe('10 of 10 pieces');
    expect(splitTotalLine(1, 1)).toBe('1 of 1 piece');
    expect(splitTotalLine(1200, 1000)).toBe('1\u2009200 of 1\u2009000 pieces');
    expect(splitTotalWarning(10, 10)).toBeNull();
    expect(splitTotalWarning(13, 10)).toBe('3 more than the 10 asked.');
    expect(splitTotalWarning(9, 10)).toBe('1 fewer than the 10 asked.');
  });

  it('says where the proposal comes from, and the saved sizes that match no size', () => {
    expect(splitSourceLine(PROPOSAL)).toBe('From 3 orders, net of size exchanges, and 1 saved size.');
    expect(splitSourceLine({ ...PROPOSAL, totals: { orders: 1, savedSizes: 0, proposed: 10 } })).toBe('From 1 order, net of size exchanges, and 0 saved sizes.');
    expect(splitSourceLine({ ...PROPOSAL, source: 'EVEN', totals: { orders: 0, savedSizes: 0, proposed: 10 } })).toBe('No orders or saved sizes yet: split evenly at FRANCE WAREHOUSE.');
    // The default location left out: the even split goes to the first location considered.
    expect(splitSourceLine({ ...PROPOSAL, source: 'EVEN', locations: [LOGISTICS] })).toBe('No orders or saved sizes yet: split evenly at LOGISTICS WAREHOUSE.');
    expect(splitSourceLine({ ...PROPOSAL, sizeKind: null, totals: { orders: 2, savedSizes: 0, proposed: 10 } })).toBe(
      'From 2 orders, net of size exchanges, and 0 saved sizes. Saved sizes are not read for a model without a size type or of one size.',
    );
    expect(splitUnmatchedLine(0)).toBeNull();
    expect(splitUnmatchedLine(1)).toBe('1 saved size matches none of its sizes: not counted.');
    expect(splitUnmatchedLine(4)).toBe('4 saved sizes match none of its sizes: not counted.');
  });

  it('names the drafts ADD TO DRAFTS wrote, in the toast and in the panel', () => {
    const one: SplitDraftsResult = {
      drafts: [{ id: 'd1', reference: 'SO-1A2B3C4D', supplier: { id: 's', name: 'MAISON NORD' }, location: { id: 'l1', name: 'FRANCE WAREHOUSE' }, lines: 1, pieces: 7 }],
      pieces: 7,
    };
    expect(splitAddedToast(one)).toBe('7 pieces added to the draft SO-1A2B3C4D.');
    const two: SplitDraftsResult = {
      drafts: [one.drafts[0]!, { id: 'd2', reference: 'SO-5E6F7A8B', supplier: { id: 's', name: 'MAISON NORD' }, location: { id: 'l2', name: 'LOGISTICS WAREHOUSE' }, lines: 2, pieces: 6 }],
      pieces: 13,
    };
    expect(splitAddedToast(two)).toBe('13 pieces added to 2 drafts: SO-1A2B3C4D, SO-5E6F7A8B.');
    expect(splitDraftWords(one.drafts[0]!)).toBe('MAISON NORD · FRANCE WAREHOUSE · 7 pieces on 1 line');
    expect(splitDraftWords(two.drafts[1]!)).toBe('MAISON NORD · LOGISTICS WAREHOUSE · 6 pieces on 2 lines');
  });
});

describe('the countries each location serves', () => {
  const locations: Pick<StockLocation, 'id' | 'name' | 'countries'>[] = [
    { id: 'l1', name: 'FRANCE WAREHOUSE', countries: ['FR'] },
    { id: 'l2', name: 'LOGISTICS WAREHOUSE', countries: ['BE', 'GB', 'LU'] },
  ];

  it('names them in English, alphabetically, and offers every country not chosen yet', () => {
    expect(servedNames(['US', 'BE', 'GB'])).toEqual(['Belgium', 'United Kingdom', 'United States']);
    expect(servedNames([])).toEqual([]);
    const options = countryAddOptions(['FR', 'BE']);
    expect(options[0]).toEqual({ value: '', label: 'Choose a country' });
    expect(options).toHaveLength(COUNTRY_CODES.length - 2 + 1);
    expect(options.some((o) => o.value === 'FR' || o.value === 'BE')).toBe(false);
    const labels = options.slice(1).map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('says which countries move here from another location, before saving and in the toast', () => {
    expect(countriesMovingHere(['FR', 'IT'], locations[0]!, locations)).toEqual([]);
    expect(movingLine([])).toBeNull();
    const moved = countriesMovingHere(['LU', 'FR', 'BE'], locations[0]!, locations);
    expect(moved).toEqual([
      { country: 'BE', from: { id: 'l2', name: 'LOGISTICS WAREHOUSE' } },
      { country: 'LU', from: { id: 'l2', name: 'LOGISTICS WAREHOUSE' } },
    ]);
    expect(movingLine(moved)).toBe('Belgium and Luxembourg move here from LOGISTICS WAREHOUSE.');
    expect(movingLine(moved.slice(0, 1))).toBe('Belgium moves here from LOGISTICS WAREHOUSE.');
    expect(countriesSavedToast([])).toBe('Countries saved.');
    expect(countriesSavedToast(moved.slice(0, 1))).toBe('Countries saved. Belgium moved here from LOGISTICS WAREHOUSE.');
    expect(sameCountries(['FR', 'BE'], ['BE', 'FR'])).toBe(true);
    expect(sameCountries(['FR'], ['FR', 'BE'])).toBe(false);
  });
});

describe('the API client', () => {
  it('calls the location countries\', the split\'s and ADD TO DRAFTS\' routes with their methods and bodies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.setLocationCountries('l1', ['FR', 'BE']);
    await api.supplierSplit({ modelId: 'm1', quantity: 10 });
    await api.supplierSplit({ modelId: 'm1', quantity: 10, locationIds: ['l2'] });
    await api.supplierSplitDrafts([{ skuId: 'k', locationId: 'l1', quantity: 7 }]);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'PUT /api/admin/locations/l1/countries',
      'POST /api/admin/supplier-orders/split',
      'POST /api/admin/supplier-orders/split',
      'POST /api/admin/supplier-orders/split/drafts',
    ]);
    expect(calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { countries: ['FR', 'BE'] },
      { modelId: 'm1', quantity: 10 },
      { modelId: 'm1', quantity: 10, locationIds: ['l2'] },
      { lines: [{ skuId: 'k', locationId: 'l1', quantity: 7 }] },
    ]);
    for (const c of calls) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});

describe('the words', () => {
  it('stay calm and in the house: no atelier, handmade or craft, no exclamation mark', () => {
    const all = [...Object.values(SPLIT_TEXT), ...Object.values(LOCATION_COUNTRIES_TEXT)].join('\n');
    expect(all).not.toMatch(/atelier|handmade|hand-made|craft|!/i);
  });
});
