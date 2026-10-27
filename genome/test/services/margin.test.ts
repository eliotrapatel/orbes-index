/**
 * The margin on GROWTH (macro scope K43 N1 to N3, D61; lot M4 plan §1.1, §1.5, step M4.3; services/margin.ts), on the
 * houses of test/support/margin.ts (every figure below is counted by hand from its header) and on GROWTH's fourteen
 * months (test/support/growth.ts):
 *
 *  - the pure arithmetic, without a database: shareEqually (largest remainder in minor units), rateFor (the exact limit,
 *    the next band, ALL OTHER COUNTRIES, no band at all), the euro converter (a currency without a rate left out and
 *    counted), marginCsvField (a loss written as a number, never `'-10.00`, text, while a formula stays guarded);
 *  - the first plan's house (seedMargin): each column on each sale: a traced piece, a piece not bound yet at its SKU's
 *    average over two supplier orders in two currencies, a piece without any price missing, one priced only in a currency
 *    without a rate; inbound shared over the supplier order's units less those cancelled; a parcel of two orders sharing
 *    its box and its band; a welcome gift in PERKS, never a row; free shipping moved from OUTBOUND to PERKS; credits added
 *    back to REVENUE and counted in PERKS; a supplementary invoice and a line credit note; an add-on unit at its SKU's
 *    average, no pouch or card; a set's pieces each under its own model at its share; a size exchange's parcel charged to
 *    its original, the returned piece back in stock; a lost parcel's piece and second parcel charged to its order (a
 *    RESHIP); an order not packed estimated from its models' box and packed weight; care DONE and a claim decided in the
 *    window, the claim under ELSEWHERE for a piece no order sold; the tier at payment (a buyer who reached PLATINE after
 *    the order counts under the tier held then, TITANE); test entrants, CANCELLED and RETURNED out; no release anywhere
 *    in the output; the missing list; the window and its validation; the CSV's columns;
 *  - ONE QUEUE's house (seedMarginVault): a SERVICE unit revenue only, cost 0, never missing; an old order's
 *    `orders.addons` and engraving revenue only; the converted add-on, a PRODUCT, costed as a product; the vault's free
 *    add-on in THE VAULT's add-ons; a house credit won and a friend's credit to give used, each in its part; a VAULT order
 *    at 0 claimed: REVENUE 0, all its costs THE VAULT's products won, under VAULT, its model and its winner's tier; an
 *    unclaimed one (CANCELLED) out; a RIGHT TO BUY order a sale of VAULT; THE VAULT CARD from the stored checklist line,
 *    estimated before packing; a guaranteed piece counted, its release never named; the line naming no account; the line
 *    under the margin's rules (a test entrant's VAULT order at 0, credit and free add-on out, as of the column);
 *  - REVENUE − PERKS' credits − THE VAULT's credits − THE VAULT's credits to give = GROWTH's net revenue for the same
 *    orders (held against GrowthService.report, with a friend's credit to give used, in euros and pounds converted, and on
 *    GROWTH's own fixture);
 *  - the report's cost of the rewards won equal to VaultService.report's for the same period (the rewards opened
 *    mid-month, so the Paris days and the UTC window hold the same openings), its `costUnknown` (a product won without a
 *    supplier price) and its amount in a currency without a rate left out and named.;
 *  - the first plan's edges (seedMarginEdges): a parcel of three paid orders sharing its box and its band by largest
 *    remainder, the first order first (84 / 83 / 83 and 334 / 333 / 333 cents); inbound over a supplier order's units
 *    less those credited and those cancelled (the credited unit given back, the share changes); a parcel heavier than
 *    every band: OUTBOUND 0 and a rate missing; the catalogue's engraving, a SERVICE unit: revenue only, cost 0.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/server/errors.js';
import { EuroConverter, MARGIN_CHANNELS, MARGIN_CSV_COLUMNS, MARGIN_TIERS, MARGIN_VAULT_WORDS, marginCsv, marginCsvField, rateFor, shareEqually, type MarginGroup, type MarginReport } from '../../src/server/services/margin.js';
import { createAdmin, createHarness, type Harness } from '../api/support.js';
import { GROWTH_NOW, seedGrowth } from '../support/growth.js';
import { MARGIN_NOW, seedMargin, seedMarginEdges, seedMarginVault, type MarginEdgesFixture, type MarginFixture, type MarginVaultFixture } from '../support/margin.js';

describe('the margin: the pure parts', () => {
  it('shareEqually: the floor each, one more for the first until the remainder is spent; the shares add up', () => {
    expect(shareEqually(1000, 3)).toEqual([334, 333, 333]);
    expect(shareEqually(250, 2)).toEqual([125, 125]);
    expect(shareEqually(5, 7)).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(shareEqually(0, 2)).toEqual([0, 0]);
    expect(shareEqually(10, 0)).toEqual([]);
    for (const [t, n] of [[999, 4], [1, 1], [100_000_000, 7]] as const) expect(shareEqually(t, n).reduce((a, b) => a + b, 0)).toBe(t);
  });

  it('rateFor: the smallest band of the country holding the weight, else ALL OTHER COUNTRIES\'; none: null', () => {
    const bands = [
      { country: 'FR', maxWeightG: 1000, costMinor: 990, currency: 'EUR' },
      { country: 'FR', maxWeightG: 500, costMinor: 690, currency: 'EUR' },
      { country: null, maxWeightG: 2000, costMinor: 2500, currency: 'EUR' },
      { country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' },
    ];
    expect(rateFor('FR', 500, bands)?.costMinor).toBe(690); // the exact limit
    expect(rateFor('FR', 501, bands)?.costMinor).toBe(990);
    expect(rateFor('FR', 1001, bands)?.costMinor).toBe(2500); // over every band of FR: ALL OTHER COUNTRIES
    expect(rateFor('DE', 300, bands)?.costMinor).toBe(1500);
    expect(rateFor(null, 300, bands)?.costMinor).toBe(1500);
    expect(rateFor('DE', 2001, bands)).toBeNull();
    expect(rateFor('FR', 10, [])).toBeNull();
  });

  it('EuroConverter: euros as they are, a rate applied, a currency without one left out and counted (never a zero)', () => {
    const m = new EuroConverter(new Map([['GBP', 1.2]]));
    expect(m.eur(1000, 'EUR')).toBe(1000);
    expect(m.eur(1000, 'GBP')).toBe(1200);
    expect(m.eur(1000, 'JPY')).toBe(0);
    expect(m.eur(5, 'JPY')).toBe(0);
    expect(m.eur(0, 'CHF')).toBe(0);
    expect([...m.missing]).toEqual([['JPY', 2]]);
    expect(m.has('EUR') && m.has('GBP') && !m.has('CHF')).toBe(true);
  });

  it('marginCsvField: a figure, a loss too, quoted as a number; any other field through csvField\'s formula guard', () => {
    expect(marginCsvField('-10.00')).toBe('"-10.00"');
    expect(marginCsvField('8290.00')).toBe('"8290.00"');
    expect(marginCsvField('-72.36')).toBe('"-72.36"');
    expect(marginCsvField('0')).toBe('"0"');
    expect(marginCsvField('')).toBe('""');
    expect(marginCsvField('-1+2')).toBe(`"'-1+2"`);
    expect(marginCsvField('-SUM(A1:A9)')).toBe(`"'-SUM(A1:A9)"`);
    expect(marginCsvField('=1+2')).toBe(`"'=1+2"`);
    expect(marginCsvField('+33')).toBe(`"'+33"`);
    expect(marginCsvField('-10.00\n')).toBe(`"'-10.00\n"`);
    expect(marginCsvField('A "B"')).toBe('"A ""B"""');
  });
});

/** A sale's group as the view by model reads it when alone in it. */
const costs = (c: Partial<Omit<MarginGroup['costs'], 'perks' | 'vault'>> & { perks?: Partial<MarginGroup['costs']['perks']>; vault?: Partial<MarginGroup['costs']['vault']> }): MarginGroup['costs'] => ({
  piece: 0,
  inbound: 0,
  packaging: 0,
  outbound: 0,
  allowance: 0,
  careWarranty: 0,
  ...c,
  perks: { credits: 0, freeShipping: 0, gifts: 0, ...c.perks },
  vault: { credits: 0, creditsToGive: 0, addons: 0, productsWon: 0, cards: 0, ...c.vault },
});

describe('MarginService on the house of test/support/margin.ts', () => {
  let h: Harness;
  let f: MarginFixture;
  let r: MarginReport;
  const margin = () => h.ctx.services.margin;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(MARGIN_NOW.toISOString());
    f = await seedMargin(h.t.db, (await createAdmin(h.ctx, 'ADMIN')).id);
    r = await margin().report();
  }, 60_000);
  afterAll(() => h?.close());

  it('reads GROWTH\'s window, 12 months by default or 24, in euros; another window is refused', async () => {
    expect(r.window).toMatchObject({ months: 12, from: '2025-11', to: '2026-10', currency: 'EUR', test: false });
    expect(r.currency).toBe('EUR');
    expect(r.partnerIncome).toEqual([]);
    expect(r.window.list).toHaveLength(12);
    expect((await margin().report({ months: 24 })).window).toMatchObject({ months: 24, from: '2024-11', to: '2026-10' });
    await expect(margin().report({ months: 6 })).rejects.toBeInstanceOf(DomainError);
  });

  it('the totals: every column of the eight sales, the care and the claim; the estimates', () => {
    expect(r.totals).toEqual({
      key: 'ALL',
      label: null,
      orders: 8,
      pieces: 9,
      revenueMinor: 829_000,
      costs: costs({ piece: 149_500, inbound: 600, packaging: 6_750, outbound: 4_950, allowance: 19_225, careWarranty: 6_000, perks: { credits: 10_000, freeShipping: 1_500, gifts: 30_600 } }),
      marginMinor: 599_875,
      marginBp: 7_236,
      estimated: 4,
    });
    expect(r.estimated).toBe(4);
  });

  it('by channel: LIVE, DRAW, SALON, VAULT (none in this house), then ELSEWHERE carrying the claim on a piece no order sold', () => {
    expect(r.byChannel.map((g) => g.key)).toEqual(['LIVE', 'DRAW', 'SALON', 'VAULT', 'ELSEWHERE']);
    expect([...MARGIN_CHANNELS]).toEqual(['LIVE', 'DRAW', 'SALON', 'VAULT', 'ELSEWHERE']);
    const [live, draw, salon, vault, elsewhere] = r.byChannel;
    expect(vault).toEqual({ key: 'VAULT', label: null, orders: 0, pieces: 0, revenueMinor: 0, costs: costs({}), marginMinor: 0, marginBp: null, estimated: 0 });
    // O2: € 1 250 billed before its € 100 credit, its € 1 200 piece traced and € 1 inbound, half the box and the pouch and
    // card, half the band as free shipping, 2.5 %. O3: its piece at A's average (€ 190 and € 0.50), an estimate.
    expect(live).toEqual({
      key: 'LIVE',
      label: null,
      orders: 2,
      pieces: 2,
      revenueMinor: 245_000,
      costs: costs({ piece: 39_000, inbound: 150, packaging: 1_250, allowance: 6_125, perks: { credits: 10_000, freeShipping: 1_500 } }),
      marginMinor: 186_975,
      marginBp: 7_632,
      estimated: 1,
    });
    // O4 (pounds at 1.2, estimated parcel: BX and 250 g under ALL OTHER COUNTRIES), S1 (no price, no allowance), S2 (a
    // price in francs without a rate).
    expect(draw).toMatchObject({ orders: 3, pieces: 3, revenueMinor: 220_000, marginMinor: 193_700, estimated: 3 });
    expect(draw!.costs).toEqual(costs({ piece: 19_000, inbound: 50, packaging: 1_750, outbound: 1_500, allowance: 4_000 }));
    // O1 (its gift and its add-on unit), O5 and its exchange, O10 and its lost parcel; O1's piece's care.
    expect(salon).toMatchObject({ orders: 3, pieces: 4, revenueMinor: 364_000, estimated: 0 });
    expect(salon!.costs).toEqual(costs({ piece: 91_500, inbound: 400, packaging: 3_750, outbound: 3_450, allowance: 9_100, careWarranty: 5_000, perks: { gifts: 30_600 } }));
    expect(salon!.marginMinor).toBe(364_000 - (91_500 + 400 + 3_750 + 3_450 + 9_100 + 5_000 + 30_600));
    expect(elsewhere).toEqual({ key: 'ELSEWHERE', label: null, orders: 0, pieces: 0, revenueMinor: 0, costs: costs({ careWarranty: 1_000 }), marginMinor: -1_000, marginBp: null, estimated: 0 });
  });

  it('by tier at payment: X bought at TITANE though PLATINE since; the care counts under the tier of its day', () => {
    expect(r.byTier.map((g) => g.key)).toEqual([...MARGIN_TIERS]);
    expect(r.byTier.map((g) => [g.key, g.orders, g.revenueMinor, g.costs.careWarranty])).toEqual([
      ['PALLADIUM', 2, 245_000, 0],
      ['PLATINE', 0, 0, 5_000],
      ['TITANE', 1, 124_000, 0],
      ['NONE', 5, 460_000, 1_000],
    ]);
    // O1 alone: € 1 240 billed (piece, add-on unit, shipping), its piece € 200 and the unit € 15, € 1 inbound, BX, pouch
    // and card, FR up to 500 g, 2.5 % (€ 31), and its gift (€ 300 traced, € 1 inbound, pouch and card) in PERKS.
    expect(r.byTier[2]).toEqual({
      key: 'TITANE',
      label: null,
      orders: 1,
      pieces: 2,
      revenueMinor: 124_000,
      costs: costs({ piece: 21_500, inbound: 100, packaging: 750, outbound: 690, allowance: 3_100, perks: { gifts: 30_600 } }),
      marginMinor: 67_260,
      marginBp: 5_424,
      estimated: 0,
    });
  });

  it('by model: a variant folded into its main model, a set\'s pieces each under its own at its share; never by release', () => {
    expect(r.byModel.map((g) => [g.key, g.label, g.orders, g.revenueMinor])).toEqual([
      [f.models.halo, 'HALO', 6, 729_000],
      [f.models.aura, 'AURA', 1, 60_000],
      [f.models.orbit, 'ORBIT', 1, 40_000],
    ]);
    // S1: no supplier price (missing), the pouch and the card, no allowance for its category (missing): € 595.
    expect(r.byModel[1]).toMatchObject({ marginMinor: 59_500, estimated: 1, costs: costs({ packaging: 500 }) });
    // S2 and the claim: its pouch and card, 2.5 %, the refused claim's € 10.
    expect(r.byModel[2]).toMatchObject({ marginMinor: 40_000 - 500 - 1_000 - 1_000, costs: costs({ packaging: 500, allowance: 1_000, careWarranty: 1_000 }) });
    // HALO: O5's chain counts B's traced piece once (O5's came back to stock), both parcels and two pouches and cards;
    // O10 counts its lost piece and its reshipped one, both parcels.
    const halo = r.byModel[0]!;
    expect(halo.costs.piece).toBe(21_500 + 20_000 + 19_000 + 19_000 + 30_000 + 40_000);
    expect(halo.costs.outbound).toBe(690 + 1_500 + 1_380 + 1_380);
    const text = JSON.stringify(r);
    for (const id of Object.values(f.releases)) expect(text).not.toContain(id);
    expect(text).not.toMatch(/release|drop|— LIVE|— DRAW/i);
    for (const id of Object.values(f.accounts)) expect(text).not.toContain(id);
  });

  it('THE VAULT before lot Q3: its line and its column at nothing', () => {
    expect(r.totals.costs.vault).toEqual({ credits: 0, creditsToGive: 0, addons: 0, productsWon: 0, cards: 0 });
    expect(r.vault).toMatchObject({
      claimed: { orders: 0, costMinor: 0 },
      credits: { orders: 0, costMinor: 0 },
      creditsToGive: { orders: 0, costMinor: 0 },
      addons: { units: 0, costMinor: 0 },
      cards: { cards: 0, estimated: 0, costMinor: 0 },
      guaranteedPieces: 0,
    });
    expect(r.vault.rewardsCost).toMatchObject({ costMinor: 0, costUnknown: 0 });
    expect(r.vault.rewardsCost.byKind.every((k) => k.cost.length === 0 && k.costMinor === 0)).toBe(true);
  });

  it('names what is missing: a piece without a price, a parcel without weight or box, a category, an amount in francs', () => {
    expect(r.missing).toEqual({
      piecePrices: 1,
      parcelWeights: 1,
      shippingRates: 0,
      boxCosts: 1,
      allowances: [{ categoryId: f.categories.Q, code: 'Q', name: 'Leather goods', orders: 1 }],
      unitCosts: [],
      currencies: [{ currency: 'CHF', amounts: 1 }],
    });
  });

  it('REVENUE − credits = GROWTH\'s net revenue for the same orders (the test entrant\'s included, pounds at the rate)', async () => {
    const all = await margin().report({ test: true });
    const [eur, gbp] = [await h.ctx.services.growth.report({ currency: 'EUR' }), await h.ctx.services.growth.report({ currency: 'GBP' })];
    const c = all.totals.costs;
    expect(all.totals.revenueMinor - c.perks.credits - c.vault.credits - c.vault.creditsToGive).toBe(eur.revenue.total.netMinor + gbp.revenue.total.netMinor * 1.2);
    // The test entrant's order (O8): one more sale, its piece and parcel estimated (FR up to 500 g).
    expect(all.totals.orders).toBe(9);
    expect(all.totals.revenueMinor).toBe(r.totals.revenueMinor + 120_000);
    expect(all.totals.marginMinor - r.totals.marginMinor).toBe(120_000 - (19_000 + 50 + 750 + 690 + 3_000));
    expect(all.estimated).toBe(5);
  });

  it('a unit cost cleared and a rate removed: counted as 0 and named; restored, the figures come back', async () => {
    const db = h.t.db;
    await db.deleteFrom('margin_unit_costs').where('key', '=', 'CARD').execute();
    await db.deleteFrom('currency_rates').where('currency', '=', 'GBP').execute();
    try {
      const m = await margin().report();
      expect(m.missing.unitCosts).toEqual(['CARD']);
      // O4's invoice in pounds: left out and counted (A's average reads SO1 alone, SO2's line has no rate).
      expect(m.missing.currencies).toEqual([{ currency: 'CHF', amounts: 1 }, { currency: 'GBP', amounts: 1 }]);
      expect(m.totals.revenueMinor).toBe(r.totals.revenueMinor - 120_000);
      // Each piece sent without its card (€ 2): O1, O2, O3, O4, O5 and E5, O10's two, S1, S2 in PACKAGING; O1's gift in PERKS.
      expect(r.totals.costs.packaging - m.totals.costs.packaging).toBe(10 * 200);
      expect(r.totals.costs.perks.gifts - m.totals.costs.perks.gifts).toBe(200);
    } finally {
      await db.insertInto('margin_unit_costs').values({ key: 'CARD', cost_minor: 200, currency: 'EUR' }).execute();
      await db.insertInto('currency_rates').values({ currency: 'GBP', eur_rate: '1.2' }).execute();
    }
    expect((await margin().report()).totals).toEqual(r.totals);
  });

  it('the CSV: its columns, the totals then each view, in euros', async () => {
    const file = await margin().csv();
    expect(file.filename).toBe('orbes-margin-2026-10-15.csv');
    expect(file.contentType).toMatch(/^text\/csv/);
    const rows = file.body.trimEnd().split('\r\n');
    expect(rows[0]).toBe(MARGIN_CSV_COLUMNS.map((c) => `"${c}"`).join(','));
    expect(rows[1]).toBe('"Total","Every order","8","9","8290.00","1495.00","6.00","67.50","49.50","192.25","100.00","15.00","306.00","0.00","0.00","0.00","0.00","0.00","60.00","5998.75","72.36","4"');
    expect(rows).toHaveLength(1 + 1 + r.byModel.length + MARGIN_CHANNELS.length + MARGIN_TIERS.length);
    // A loss stays a number a spreadsheet sums: ELSEWHERE's claim (€ 10, no revenue) and PLATINE's care (€ 50).
    expect(rows).toContain('"By channel","ELSEWHERE","0","0","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","10.00","-10.00","","0"');
    expect(rows).toContain('"By tier","PLATINE","0","0","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","50.00","-50.00","","0"');
    expect(MARGIN_CSV_COLUMNS.slice(13, 18)).toEqual(['THE VAULT: credits', 'THE VAULT: credits to give', 'THE VAULT: add-ons', 'THE VAULT: products won', 'THE VAULT: cards']);
    expect(file.body).not.toMatch(/release|drop/i);
    expect(file.body).not.toContain("'-");
    expect(marginCsv(r)).toBe(file.body);
  });
});

describe('MarginService on GROWTH\'s fourteen months (test/support/growth.ts)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(GROWTH_NOW.toISOString());
    await seedGrowth(h.t.db);
  }, 60_000);
  afterAll(() => h?.close());

  it('REVENUE − credits = GROWTH\'s net revenue in euros; the pound order left out and named until GBP has a rate', async () => {
    const r = await h.ctx.services.margin.report();
    const eur = await h.ctx.services.growth.report({ currency: 'EUR' });
    // A1's draw, A2's LIVE, A3's salon in pounds (its revenue left out without a rate), A5's two (one with a € 500
    // credit), A6's, A8's second and A12's; A2's return and A3's cancellation out, A8's first before the window.
    expect(r.totals.orders).toBe(8);
    expect(r.totals.costs.perks.credits).toBe(50_000);
    expect(r.totals.costs.vault.credits + r.totals.costs.vault.creditsToGive).toBe(0);
    expect(r.totals.revenueMinor - r.totals.costs.perks.credits).toBe(eur.revenue.total.netMinor);
    expect(r.missing.currencies).toEqual([{ currency: 'GBP', amounts: 1 }]);
    // A2's LIVE carries its welcome gift as a perk; no piece has a supplier price: each is missing.
    expect(r.totals.pieces).toBe(9);
    expect(r.missing.piecePrices).toBe(9);

    await h.t.db.insertInto('currency_rates').values({ currency: 'GBP', eur_rate: '1.15' }).execute();
    const rated = await h.ctx.services.margin.report();
    const gbp = await h.ctx.services.growth.report({ currency: 'GBP' });
    expect(rated.missing.currencies).toEqual([]);
    expect(rated.totals.revenueMinor - rated.totals.costs.perks.credits).toBe(eur.revenue.total.netMinor + Math.round(gbp.revenue.total.netMinor * 1.15));
  });
});

describe('MarginService on ONE QUEUE\'s house (test/support/margin.ts seedMarginVault; D61, Q2-D)', () => {
  let h: Harness;
  let f: MarginVaultFixture;
  let r: MarginReport;
  const margin = () => h.ctx.services.margin;
  /** A sale's group, alone in the view by tier or channel when asked. */
  const channel = (rep: MarginReport, key: string) => rep.byChannel.find((g) => g.key === key)!;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(MARGIN_NOW.toISOString());
    f = await seedMarginVault(h.t.db, (await createAdmin(h.ctx, 'ADMIN')).id);
    r = await margin().report();
  }, 60_000);
  afterAll(() => h?.close());

  it('the totals of the five sales: O0, O1, O2 (SALON), OW at 0 and OR (VAULT); OX, ON and the test entrant\'s out', () => {
    expect(r.totals).toEqual({
      key: 'ALL',
      label: null,
      orders: 5,
      pieces: 5,
      revenueMinor: 382_500,
      costs: costs({
        piece: 80_500,
        inbound: 500,
        packaging: 3_000,
        outbound: 2_760,
        allowance: 9_564,
        perks: { credits: 2_000 },
        vault: { credits: 2_500, creditsToGive: 3_000, addons: 600, productsWon: 21_540, cards: 150 },
      }),
      marginMinor: 256_386,
      marginBp: 6_703,
      estimated: 2,
    });
    expect(r.missing).toEqual({ piecePrices: 0, parcelWeights: 0, shippingRates: 0, boxCosts: 0, allowances: [], unitCosts: [], currencies: [{ currency: 'CHF', amounts: 1 }] });
  });

  it('add-on units by kind: a SERVICE revenue only, never missing; a PRODUCT bought at its SKU\'s average; the vault\'s free one THE VAULT\'s; the old orders.addons and engraving revenue only', () => {
    const salon = channel(r, 'SALON');
    // O0 (€ 1 000 + the release's CLOTH € 15 + its engraving € 40), O1 (€ 1 000 + WRAPPING € 5 + CLOTH € 20 + its free
    // CLOTH at 0 + € 15 shipping, € 25 added back), O2 (€ 800 + € 15, € 20 and € 30 added back).
    expect(salon).toMatchObject({ orders: 3, pieces: 3, revenueMinor: 105_500 + 104_000 + 81_500, estimated: 1 });
    // Three HALO pieces at € 200 and € 1 inbound; O1's CLOTH bought at € 5 and € 1; the WRAPPING nothing; O0's history nothing.
    expect(salon.costs).toEqual(
      costs({ piece: 60_500, inbound: 400, packaging: 2_250, outbound: 2_070, allowance: 2_638 + 2_600 + 2_038, perks: { credits: 2_000 }, vault: { credits: 2_500, creditsToGive: 3_000, addons: 600, cards: 100 } }),
    );
    expect(r.missing.piecePrices).toBe(0);
  });

  it('a VAULT order at 0 claimed: REVENUE 0, its piece, box, pouch, card and band THE VAULT\'s products won, under VAULT, HALO and its winner\'s tier; a RIGHT TO BUY order a sale of VAULT', () => {
    const vault = channel(r, 'VAULT');
    // OW: € 200 + € 1, BX € 2.50, pouch and card € 5, FR up to 1 000 g € 6.90 = € 215.40. OR: € 915 billed, its piece at
    // the average, BX, pouch and card, the band, 2.5 % (€ 22.88) and its card by the rule (€ 0.50), estimated.
    expect(vault).toEqual({
      key: 'VAULT',
      label: null,
      orders: 2,
      pieces: 2,
      revenueMinor: 91_500,
      costs: costs({ piece: 20_000, inbound: 100, packaging: 750, outbound: 690, allowance: 2_288, vault: { productsWon: 21_540, cards: 50 } }),
      marginMinor: 91_500 - (20_000 + 100 + 750 + 690 + 2_288 + 21_540 + 50),
      marginBp: 5_036,
      estimated: 1,
    });
    // W held one piece since January: TITANE at both payments; the others none.
    expect(r.byTier.map((g) => [g.key, g.orders, g.revenueMinor, g.costs.vault.productsWon])).toEqual([
      ['PALLADIUM', 0, 0, 0],
      ['PLATINE', 0, 0, 0],
      ['TITANE', 2, 91_500, 21_540],
      ['NONE', 3, 291_000, 0],
    ]);
    expect(r.byModel.map((g) => [g.label, g.orders])).toEqual([['HALO', 5]]);
  });

  it('THE VAULT\'s line: its counts and costs the column\'s parts, the guaranteed piece counted (never costed, never named), the report\'s cost beside them', () => {
    const c = r.totals.costs.vault;
    expect(r.vault).toEqual({
      claimed: { orders: 1, costMinor: 21_540 },
      credits: { orders: 1, costMinor: 2_500 },
      creditsToGive: { orders: 1, costMinor: 3_000 },
      addons: { units: 1, costMinor: 600 },
      // O1's from its stored checklist; O2's and OR's by the rule before packing.
      cards: { cards: 3, estimated: 2, costMinor: 150 },
      guaranteedPieces: 1,
      rewardsCost: {
        byKind: [
          { kind: 'CREDIT', cost: [{ currency: 'EUR', minor: 5_000 }, { currency: 'CHF', minor: 1_000 }], costMinor: 5_000, costUnknown: 0 },
          { kind: 'ADDON', cost: [{ currency: 'EUR', minor: 1_000 }], costMinor: 1_000, costUnknown: 0 },
          { kind: 'GUARANTEED', cost: [], costMinor: 0, costUnknown: 0 },
          { kind: 'PRODUCT', cost: [{ currency: 'EUR', minor: 40_000 }], costMinor: 40_000, costUnknown: 1 },
          { kind: 'CREDIT_TO_GIVE', cost: [{ currency: 'EUR', minor: 3_000 }], costMinor: 3_000, costUnknown: 0 },
          { kind: 'I_WAS_THERE', cost: [], costMinor: 0, costUnknown: 0 },
          { kind: 'VAULT_EDITION', cost: [], costMinor: 0, costUnknown: 0 },
          { kind: 'THE_PIECE', cost: [], costMinor: 0, costUnknown: 0 },
        ],
        costMinor: 49_000,
        costUnknown: 1,
      },
    });
    expect([r.vault.claimed.costMinor, r.vault.credits.costMinor, r.vault.creditsToGive.costMinor, r.vault.addons.costMinor, r.vault.cards.costMinor]).toEqual([c.productsWon, c.credits, c.creditsToGive, c.addons, c.cards]);
    // OP-22: a guaranteed piece, never a place; the line's words.
    expect(MARGIN_VAULT_WORDS.guaranteed).toBe('Guaranteed pieces: each is bought at its price, so it costs nothing here.');
    expect(Object.values(MARGIN_VAULT_WORDS).map((w) => (typeof w === 'function' ? w(2) : w)).join(' ')).not.toMatch(/place/i);
    expect(MARGIN_VAULT_WORDS.costUnknown(1)).toBe('1 reward without a supplier price');
    expect(MARGIN_VAULT_WORDS.costUnknown(3)).toBe('3 rewards without a supplier price');
    // No account, no vault, no release, no order anywhere in the report.
    const text = JSON.stringify(r);
    for (const id of [...Object.values(f.accounts), ...Object.values(f.vaults), ...Object.values(f.orders), f.releases.live]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/release|drop/i);
  });

  it('the report\'s cost is the report\'s own: equal to VaultService.report\'s for the same period, by kind and currency, its costUnknown too; CHF without a rate left out and named', async () => {
    const report = await h.ctx.services.vault.report({ from: '2025-11-01', to: '2026-10-31' });
    for (const k of r.vault.rewardsCost.byKind) {
      const theirs = report.byKind.find((x) => x.kind === k.kind)!;
      expect(k.cost, k.kind).toEqual(theirs.cost);
      expect(k.costUnknown, k.kind).toBe(theirs.costUnknown);
    }
    expect(r.vault.rewardsCost.costUnknown).toBe(report.costUnknown);
    expect(report.costUnknown).toBe(1);
    expect(report.totalCost).toEqual([{ currency: 'EUR', minor: 49_000 }, { currency: 'CHF', minor: 1_000 }]);
    // The francs: left out of the euros, named in the missing list.
    expect(r.vault.rewardsCost.costMinor).toBe(49_000);
    expect(r.missing.currencies).toEqual([{ currency: 'CHF', amounts: 1 }]);
    // With a rate, counted.
    await h.t.db.insertInto('currency_rates').values({ currency: 'CHF', eur_rate: '1.05' }).execute();
    try {
      const rated = await margin().report();
      expect(rated.vault.rewardsCost.byKind[0]).toMatchObject({ kind: 'CREDIT', costMinor: 5_000 + 1_050 });
      expect(rated.missing.currencies).toEqual([]);
    } finally {
      await h.t.db.deleteFrom('currency_rates').where('currency', '=', 'CHF').execute();
    }
  });

  it('the line under the margin\'s rules: the test entrant\'s VAULT order at 0, credit and free add-on out unless `test`, as of the column', async () => {
    const all = await margin().report({ test: true });
    const c = all.totals.costs.vault;
    // OT: its piece at the average, BX, pouch and card, the band, an estimate; OTs: its € 25 credit and its free CLOTH.
    expect(all.vault).toMatchObject({
      claimed: { orders: 2, costMinor: 21_540 * 2 },
      credits: { orders: 2, costMinor: 5_000 },
      creditsToGive: { orders: 1, costMinor: 3_000 },
      addons: { units: 2, costMinor: 1_200 },
      cards: { cards: 4, estimated: 3, costMinor: 200 },
      guaranteedPieces: 2,
    });
    expect([all.vault.claimed.costMinor, all.vault.credits.costMinor, all.vault.creditsToGive.costMinor, all.vault.addons.costMinor, all.vault.cards.costMinor]).toEqual([c.productsWon, c.credits, c.creditsToGive, c.addons, c.cards]);
    // The report's cost reads every vault, the test entrant's included, whatever `test`.
    expect(all.vault.rewardsCost).toEqual(r.vault.rewardsCost);
    expect(all.totals.orders - r.totals.orders).toBe(2);
  });

  it('REVENUE − PERKS\' credits − THE VAULT\'s credits − its credits to give = GROWTH\'s net revenue (a friend\'s credit to give used)', async () => {
    const all = await margin().report({ test: true });
    const eur = await h.ctx.services.growth.report({ currency: 'EUR' });
    const c = all.totals.costs;
    expect(c.vault.creditsToGive).toBe(3_000);
    expect(all.totals.revenueMinor - c.perks.credits - c.vault.credits - c.vault.creditsToGive).toBe(eur.revenue.total.netMinor);
    expect(eur.revenue.total.netMinor).toBe(472_500);
  });

  it('THE VAULT CARD\'s unit cost cleared: its cards counted at 0 and VAULT_CARD named; the CSV carries THE VAULT\'s five parts', async () => {
    await h.t.db.deleteFrom('margin_unit_costs').where('key', '=', 'VAULT_CARD').execute();
    try {
      const m = await margin().report();
      expect(m.missing.unitCosts).toEqual(['VAULT_CARD']);
      expect(m.vault.cards).toEqual({ cards: 3, estimated: 2, costMinor: 0 });
      expect(m.totals.marginMinor).toBe(r.totals.marginMinor + 150);
    } finally {
      await h.t.db.insertInto('margin_unit_costs').values({ key: 'VAULT_CARD', cost_minor: 50, currency: 'EUR' }).execute();
    }
    const rows = (await margin().csv()).body.trimEnd().split('\r\n');
    expect(rows).toContain('"By channel","VAULT","2","2","915.00","200.00","1.00","7.50","6.90","22.88","0.00","0.00","0.00","0.00","0.00","0.00","215.40","0.50","0.00","460.82","50.36","1"');
    expect(rows).toContain('"Total","Every order","5","5","3825.00","805.00","5.00","30.00","27.60","95.64","20.00","0.00","0.00","25.00","30.00","6.00","215.40","1.50","0.00","2563.86","67.03","2"');
  });
});

describe('MarginService on the first plan\'s edges (test/support/margin.ts seedMarginEdges)', () => {
  let h: Harness;
  let f: MarginEdgesFixture;
  let r: MarginReport;
  const margin = () => h.ctx.services.margin;
  const channel = (rep: MarginReport, key: string) => rep.byChannel.find((g) => g.key === key)!;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(MARGIN_NOW.toISOString());
    f = await seedMarginEdges(h.t.db, (await createAdmin(h.ctx, 'ADMIN')).id);
    r = await margin().report();
  }, 60_000);
  afterAll(() => h?.close());

  it('the totals: two boxes and one band shared to the cent, € 1.00 inbound a unit; the parcel no band holds named', () => {
    expect(r.totals).toEqual({
      key: 'ALL',
      label: null,
      orders: 4,
      pieces: 4,
      revenueMinor: 454_000,
      costs: costs({ piece: 90_000, inbound: 400, packaging: 4 * 500 + 2 * 250, outbound: 1_000, allowance: 11_350 }),
      marginMinor: 348_750,
      marginBp: 7_682,
      estimated: 1,
    });
    expect(r.missing).toEqual({ piecePrices: 0, parcelWeights: 0, shippingRates: 1, boxCosts: 0, allowances: [], unitCosts: [], currencies: [] });
  });

  it('a parcel of three paid orders: its box (€ 2.50) 84 / 83 / 83 cents and its band (€ 10.00) 334 / 333 / 333, the first order first', () => {
    // O1 (SALON) with O4 (SALON, TITANE); O2 (LIVE) and O3 (DRAW, its piece at A's average: an estimate) alone.
    expect(channel(r, 'LIVE')).toEqual({
      key: 'LIVE',
      label: null,
      orders: 1,
      pieces: 1,
      revenueMinor: 100_000,
      costs: costs({ piece: 20_000, inbound: 100, packaging: 500 + 83, outbound: 333, allowance: 2_500 }),
      marginMinor: 76_484,
      marginBp: 7_648,
      estimated: 0,
    });
    expect(channel(r, 'DRAW')).toEqual({
      key: 'DRAW',
      label: null,
      orders: 1,
      pieces: 1,
      revenueMinor: 100_000,
      costs: costs({ piece: 20_000, inbound: 100, packaging: 500 + 83, outbound: 333, allowance: 2_500 }),
      marginMinor: 76_484,
      marginBp: 7_648,
      estimated: 1,
    });
    // O1: € 1 000 + its ENGRAVING € 40, BX's extra cent and the band's. O4: € 1 500, its whole box, no band.
    const salon = channel(r, 'SALON');
    expect(salon).toEqual({
      key: 'SALON',
      label: null,
      orders: 2,
      pieces: 2,
      revenueMinor: 104_000 + 150_000,
      costs: costs({ piece: 20_000 + 30_000, inbound: 200, packaging: 500 + 84 + 500 + 250, outbound: 334, allowance: 2_600 + 3_750 }),
      marginMinor: 80_382 + 115_400,
      marginBp: 7_708,
      estimated: 0,
    });
    // The parcel's shares add up to its box and its band.
    const halo = r.byModel.find((g) => g.label === 'HALO')!;
    expect(halo).toMatchObject({ orders: 3, revenueMinor: 304_000 });
    expect(halo.costs.packaging - 3 * 500).toBe(250);
    expect(halo.costs.outbound).toBe(1_000);
  });

  it('a parcel heavier than every band, its country\'s and ALL OTHER COUNTRIES\': OUTBOUND 0, missing.shippingRates 1', () => {
    expect(r.byTier.find((g) => g.key === 'TITANE')).toEqual({
      key: 'TITANE',
      label: null,
      orders: 1,
      pieces: 1,
      revenueMinor: 150_000,
      costs: costs({ piece: 30_000, inbound: 100, packaging: 750, allowance: 3_750 }),
      marginMinor: 115_400,
      marginBp: 7_693,
      estimated: 0,
    });
    expect(r.byModel.map((g) => [g.label, g.orders, g.costs.outbound])).toEqual([
      ['HALO', 3, 1_000],
      ['NOVA', 1, 0],
    ]);
  });

  it('the engraving, a SERVICE unit: revenue only, cost 0, never missing', () => {
    const halo = r.byModel.find((g) => g.label === 'HALO')!;
    // Three HALO pieces at € 200 and € 1.00: nothing more for the ENGRAVING's € 40.
    expect(halo.costs.piece).toBe(60_000);
    expect(halo.costs.inbound).toBe(300);
    expect(r.missing.piecePrices).toBe(0);
  });

  it('inbound over the supplier order\'s units less those credited and cancelled: the credited unit given back, the share changes', async () => {
    // € 12.00 over 12 units: € 1.00 each, traced (O1, O2, O4) and at A's average (O3).
    expect(r.totals.costs.inbound).toBe(4 * 100);
    await h.t.db.updateTable('supplier_order_lines').set({ credited_quantity: 0 }).where('id', '=', f.creditedLine).execute();
    try {
      // Over 13 units: € 0.923 each, rounded per sale.
      const m = await margin().report();
      expect(m.totals.costs.inbound).toBe(4 * 92);
      expect(channel(m, 'DRAW').costs.inbound).toBe(92);
      expect(channel(m, 'LIVE').costs.inbound).toBe(92);
    } finally {
      await h.t.db.updateTable('supplier_order_lines').set({ credited_quantity: 1 }).where('id', '=', f.creditedLine).execute();
    }
    expect((await margin().report()).totals).toEqual(r.totals);
  });

  it('REVENUE = GROWTH\'s net revenue; the CSV\'s totals; no release, no account named', async () => {
    const eur = await h.ctx.services.growth.report({ currency: 'EUR' });
    expect(r.totals.revenueMinor).toBe(eur.revenue.total.netMinor);
    const rows = (await margin().csv()).body.trimEnd().split('\r\n');
    expect(rows[1]).toBe('"Total","Every order","4","4","4540.00","900.00","4.00","25.00","10.00","113.50","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","3487.50","76.82","1"');
    expect(rows).toContain('"By channel","LIVE","1","1","1000.00","200.00","1.00","5.83","3.33","25.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","0.00","764.84","76.48","0"');
    const text = JSON.stringify(r);
    for (const id of [...Object.values(f.releases), ...Object.values(f.accounts), ...Object.values(f.orders)]) expect(text).not.toContain(id);
  });
});
