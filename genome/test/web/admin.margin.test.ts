/**
 * Growth's Margin and Margin settings in the console (macro scope of 2026-10-20, K43 N1 to N3; D61; lot M4 plan §1.3,
 * step M4.4): the pure models (src/web/admin/model/margin.ts, model/margin-settings.ts) against the server's shapes and
 * rules, and the API client's routes.
 *
 *  - Growth's Margin: its tab from the query (BY MODEL by default), the four figures, each view's rows (PERKS' three
 *    parts and THE VAULT's five, the estimate mark, a loss, FROM THE VAULT, ELSEWHERE and the tier at payment named),
 *    THE VAULT's line (its counts and costs, the guaranteed pieces never a place (OP-22), the report's own cost and its
 *    rewards without a supplier price shown only when there are any, why the two can differ, its way to
 *    #/club?tab=vault), Partner experiences beside it (nothing until recorded), What is missing with where each item is
 *    fixed; never a release.
 *  - Margin settings: the currencies and their rates, the bands by country (ALL OTHER COUNTRIES last) and their
 *    dialog's checks and changes, the unit costs, the allowances; ADMIN writes, every reader of Growth reads.
 *  - The words: calm, no atelier, handmade or craft, no exclamation mark.
 */
import { describe, expect, it } from 'vitest';
import {
  MARGIN_CHANNELS as SERVER_CHANNELS,
  MARGIN_TIERS as SERVER_TIERS,
  MARGIN_VAULT_WORDS as SERVER_VAULT_WORDS,
  costTotal as serverCostTotal,
  type MarginReport as ServerMarginReport,
} from '../../src/server/services/margin.js';
import { parseRate, percentToBp, type MarginSettings as ServerMarginSettings } from '../../src/server/services/margin-settings.js';
import { AdminApi, type FetchLike } from '../../src/web/admin/api.js';
import { growthParams } from '../../src/web/admin/model/growth.js';
import {
  costTotal,
  estimateText,
  MARGIN_CHANNEL_LABELS,
  MARGIN_GROUP_HEAD,
  MARGIN_TEXT,
  MARGIN_VAULT_PARTS,
  MARGIN_VAULT_WORDS,
  marginEmpty,
  marginKpis,
  marginPercent,
  marginRows,
  marginTab,
  missingItems,
  partnerLine,
  unitCostLabel,
  vaultLineEmpty,
  vaultLineItems,
  vaultReportCost,
  vaultReportHref,
} from '../../src/web/admin/model/margin.js';
import {
  allowanceField,
  allowanceProblem,
  allowanceRows,
  allowanceText,
  bandChange,
  bandCountryOptions,
  bandFormValues,
  bandGroups,
  bandInput,
  bandProblem,
  bandText,
  careKeys,
  currencyRows,
  MARGIN_SETTINGS_TEXT,
  packagingKeys,
  rateField,
  rateLine,
  rateProblem,
  rateValue,
  unitCostFormValues,
  unitCostInput,
  unitCostNote,
  unitCostProblem,
  unitCostText,
} from '../../src/web/admin/model/margin-settings.js';
import { can } from '../../src/web/admin/model/permissions.js';
import { href, parseHash } from '../../src/web/admin/router.js';
import {
  MARGIN_CHANNELS,
  MARGIN_TIERS,
  MARGIN_UNIT_COST_KEYS,
  VAULT_REWARD_KINDS,
  type MarginCosts,
  type MarginGroup,
  type MarginReport,
  type MarginSettings,
  type MarginVaultCosts,
  type MarginVaultLine,
  type ShippingCostView,
} from '../../src/web/admin/types.js';

/** The server's report as the console receives it (JSON: dates as text): the shapes must agree, held by the compiler. */
const asWeb = (r: ServerMarginReport): MarginReport => ({ ...r, window: { ...r.window, generatedAt: r.window.generatedAt.toISOString() } });
const settingsAsWeb = (s: ServerMarginSettings): MarginSettings => ({
  ...s,
  rates: s.rates.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
  shippingCosts: s.shippingCosts.map((b) => ({ ...b, updatedAt: b.updatedAt.toISOString() })),
  unitCosts: s.unitCosts.map((u) => ({ ...u, updatedAt: u.updatedAt?.toISOString() ?? null })),
  allowances: s.allowances.map((a) => ({ ...a, updatedAt: a.updatedAt?.toISOString() ?? null })),
});
void asWeb;
void settingsAsWeb;

/** The house writes amounts with no-break spaces (`€ 4 800`); compared here as plain ones. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/[\u00a0\u2009\u202f]/g, ' ')) as T;

const costs = (o: Partial<Omit<MarginCosts, 'perks' | 'vault'>> & { perks?: Partial<MarginCosts['perks']>; vault?: Partial<MarginVaultCosts> } = {}): MarginCosts => ({
  piece: 0,
  inbound: 0,
  packaging: 0,
  outbound: 0,
  allowance: 0,
  careWarranty: 0,
  ...o,
  perks: { credits: 0, freeShipping: 0, gifts: 0, ...o.perks },
  vault: { credits: 0, creditsToGive: 0, addons: 0, productsWon: 0, cards: 0, ...o.vault },
});

const group = (key: string, label: string | null, o: Partial<MarginGroup> = {}): MarginGroup => ({
  key,
  label,
  orders: 0,
  pieces: 0,
  revenueMinor: 0,
  costs: costs(),
  marginMinor: 0,
  marginBp: null,
  estimated: 0,
  ...o,
});

const HALO = group('m-halo', 'HALO', {
  orders: 3,
  pieces: 4,
  revenueMinor: 360_000,
  costs: costs({
    piece: 60_000,
    inbound: 300,
    packaging: 1_500,
    outbound: 2_070,
    allowance: 9_000,
    careWarranty: 5_000,
    perks: { credits: 10_000, freeShipping: 1_500, gifts: 30_600 },
    vault: { credits: 2_500, creditsToGive: 2_500, addons: 900, productsWon: 12_000, cards: 100 },
  }),
  marginMinor: 182_030,
  marginBp: 5056,
  estimated: 1,
});
const LOSS = group('m-orbit', 'ORBIT', { orders: 1, pieces: 1, revenueMinor: 10_000, costs: costs({ piece: 12_000 }), marginMinor: -2_000, marginBp: -2000 });

const VAULT: MarginVaultLine = {
  claimed: { orders: 1, costMinor: 12_000 },
  credits: { orders: 1, costMinor: 2_500 },
  creditsToGive: { orders: 1, costMinor: 2_500 },
  addons: { units: 1, costMinor: 900 },
  cards: { cards: 2, estimated: 1, costMinor: 100 },
  guaranteedPieces: 2,
  rewardsCost: {
    byKind: VAULT_REWARD_KINDS.map((kind) => ({
      kind,
      cost: kind === 'CREDIT' ? [{ currency: 'EUR', minor: 5_000 }] : kind === 'PRODUCT' ? [{ currency: 'EUR', minor: 12_000 }] : [],
      costMinor: kind === 'CREDIT' ? 5_000 : kind === 'PRODUCT' ? 12_000 : 0,
      costUnknown: kind === 'ADDON' ? 2 : 0,
    })),
    costMinor: 17_000,
    costUnknown: 2,
  },
};

const NO_VAULT: MarginVaultLine = {
  claimed: { orders: 0, costMinor: 0 },
  credits: { orders: 0, costMinor: 0 },
  creditsToGive: { orders: 0, costMinor: 0 },
  addons: { units: 0, costMinor: 0 },
  cards: { cards: 0, estimated: 0, costMinor: 0 },
  guaranteedPieces: 0,
  rewardsCost: { byKind: VAULT_REWARD_KINDS.map((kind) => ({ kind, cost: [], costMinor: 0, costUnknown: 0 })), costMinor: 0, costUnknown: 0 },
};

const REPORT: MarginReport = {
  window: { months: 12, from: '2025-11-01', to: '2026-11-01', list: [], currency: 'EUR', test: false, generatedAt: '2026-10-23T08:00:00.000Z' },
  currency: 'EUR',
  totals: group('ALL', null, {
    orders: 4,
    pieces: 5,
    revenueMinor: 370_000,
    costs: costs({
      piece: 72_000,
      inbound: 300,
      packaging: 1_500,
      outbound: 2_070,
      allowance: 9_000,
      careWarranty: 5_000,
      perks: { credits: 10_000, freeShipping: 1_500, gifts: 30_600 },
      vault: { credits: 2_500, creditsToGive: 2_500, addons: 900, productsWon: 12_000, cards: 100 },
    }),
    marginMinor: 220_030,
    marginBp: 5947,
    estimated: 3,
  }),
  byModel: [HALO, LOSS],
  byChannel: [
    group('LIVE', null, { orders: 2 }),
    group('DRAW', null),
    group('SALON', null, { orders: 1 }),
    group('VAULT', null, { orders: 1, costs: costs({ vault: { productsWon: 12_000 } }), marginMinor: -12_000 }),
    group('ELSEWHERE', null, { costs: costs({ careWarranty: 1_000 }), marginMinor: -1_000 }),
  ],
  byTier: [group('PALLADIUM', null), group('PLATINE', null), group('TITANE', null), group('NONE', null, { orders: 4 })],
  vault: VAULT,
  partnerIncome: [],
  estimated: 3,
  missing: {
    piecePrices: 2,
    parcelWeights: 1,
    shippingRates: 3,
    boxCosts: 1,
    allowances: [{ categoryId: 17, code: 'Q', name: 'Leather goods', orders: 1 }],
    unitCosts: ['CARD', 'VAULT_CARD', 'CLAIM_REPAIR'],
    currencies: [
      { currency: 'CHF', amounts: 1 },
      { currency: 'JPY', amounts: 3 },
    ],
  },
};

describe('Growth\'s Margin (lot M4 plan §1.3)', () => {
  it('reads its tab from the query, BY MODEL by default, never a release', () => {
    expect(['model', 'channel', 'tier', 'release', undefined, ''].map((v) => marginTab(v))).toEqual(['model', 'channel', 'tier', 'model', 'model', 'model']);
    expect(growthParams({ mg: 'channel' }).mg).toBe('channel');
    expect(MARGIN_TEXT.line).toBe('In euros, at the rates of Margin settings. Not by release.');
    // The console's rows are the server's, VAULT among the channels.
    expect(MARGIN_CHANNELS).toEqual([...SERVER_CHANNELS]);
    expect(MARGIN_CHANNELS).toEqual(['LIVE', 'DRAW', 'SALON', 'VAULT', 'ELSEWHERE']);
    expect(MARGIN_TIERS).toEqual([...SERVER_TIERS]);
    // Its tab rides in Growth's address as `mg`, left out by default (views/growth.ts growthHref).
    expect(growthParams({}).mg).toBe('model');
    expect(growthParams({ mg: 'release' }).mg).toBe('model');
  });

  it('shows Revenue, Costs, Margin and Margin % of the window, REVENUE − COSTS = MARGIN, THE VAULT\'s five parts among the costs', () => {
    expect(costTotal(REPORT.totals.costs)).toBe(REPORT.totals.revenueMinor - REPORT.totals.marginMinor);
    // The console's sum is the server's (services/margin.ts costTotal).
    expect(costTotal(REPORT.totals.costs)).toBe(serverCostTotal(REPORT.totals.costs));
    expect(marginKpis(REPORT).map((k) => [k.label, plain(k.value), k.note])).toEqual([
      ['Revenue', '€ 3 700', 'IN 12 MONTHS · BEFORE CREDITS'],
      ['Costs', '€ 1 499.70', 'PERKS, THE VAULT, CARE AND WARRANTY INCLUDED'],
      ['Margin', '€ 2 200.30', 'INCLUDES ESTIMATES FOR 3 ORDERS'],
      ['Margin %', '59.5 %', 'OF REVENUE'],
    ]);
    expect(marginKpis({ ...REPORT, totals: { ...REPORT.totals, estimated: 0 } })[2]!.note).toBe('NO ESTIMATE');
    expect([marginPercent(null), marginPercent(0), marginPercent(5556), marginPercent(-2000)]).toEqual(['—', '0.0 %', '55.6 %', '−20.0 %']);
    expect([estimateText(0), estimateText(1), estimateText(12)]).toEqual([null, 'Includes estimates for 1 order', 'Includes estimates for 12 orders']);
    expect(marginEmpty(REPORT)).toBe(false);
    expect(marginEmpty({ ...REPORT, totals: group('ALL', null) })).toBe(true);
    // Care on a piece no order sold is a cost of the window: not empty.
    expect(marginEmpty({ ...REPORT, totals: group('ALL', null, { costs: costs({ careWarranty: 500 }), marginMinor: -500 }) })).toBe(false);
  });

  it('reads each view\'s rows: PERKS\' three parts, THE VAULT\'s five, the estimate mark, a loss, FROM THE VAULT, ELSEWHERE and the tier at payment', () => {
    const [halo, orbit] = plain(marginRows(REPORT, 'model'));
    expect({ ...halo!, perkParts: undefined, vaultParts: undefined }).toMatchObject({
      label: 'HALO',
      hint: null,
      orders: '3',
      revenue: '€ 3 600',
      piece: '€ 600',
      inbound: '€ 3',
      packaging: '€ 15',
      outbound: '€ 20.70',
      allowance: '€ 90',
      perks: '€ 421',
      vault: '€ 180',
      care: '€ 50',
      margin: '€ 1 820.30',
      percent: '50.6 %',
      loss: false,
      estimate: 'Includes estimates for 1 order',
    });
    expect(halo!.perkParts.map((p) => p.text)).toEqual(['Credits € 100', 'Free shipping € 15', 'Welcome gifts € 306']);
    expect(orbit).toMatchObject({ margin: '−€ 20', percent: '−20.0 %', loss: true, estimate: null });
    // THE VAULT's five parts under its total, as PERKS'.
    expect(halo!.vaultParts.map((p) => p.text)).toEqual(['Credits € 25', 'Credits to give € 25', 'Add-ons € 9', 'Products won € 120', 'Cards € 1']);
    expect(MARGIN_VAULT_PARTS.map((p) => p.key)).toEqual(['credits', 'creditsToGive', 'addons', 'productsWon', 'cards']);
    expect(orbit!.perkParts).toEqual([]);
    expect(orbit!.vaultParts).toEqual([]);
    expect(orbit!.vault).toBe('€ 0');
    expect(marginRows(REPORT, 'channel').map((r) => [r.label, r.hint])).toEqual([
      ['LIVE RELEASE', null],
      ['DRAW', null],
      ['THE PRIVATE SALON', null],
      ['FROM THE VAULT', null],
      ['ELSEWHERE', 'Care and warranty on pieces no order sold'],
    ]);
    // A VAULT order is named as the Orders board names it (model/orders.ts orderSourceText: FROM THE VAULT).
    expect(MARGIN_CHANNEL_LABELS.VAULT).toBe('FROM THE VAULT');
    expect(plain(marginRows(REPORT, 'channel')[3]!)).toMatchObject({ vault: '€ 120', margin: '−€ 120', loss: true, percent: '—' });
    expect(marginRows(REPORT, 'tier').map((r) => [r.label, r.hint])).toEqual([
      ['PALLADIUM', null],
      ['PLATINE', null],
      ['TITANE', null],
      ['Below TITANE', null],
    ]);
    expect(MARGIN_GROUP_HEAD).toEqual({ model: 'Model', channel: 'Channel', tier: 'Tier when paid' });
    // No release anywhere in the words.
    expect(JSON.stringify(marginRows(REPORT, 'model'))).not.toMatch(/release/i);
    expect(JSON.stringify([vaultLineItems(REPORT.vault), vaultReportCost(REPORT.vault)])).not.toMatch(/release|drop/i);
  });

  it('reads THE VAULT\'s line beside the tables: its counts and costs as the margin counts them, guaranteed pieces as a piece (never a place), the report\'s own cost, its way to Club → THE VAULT', () => {
    expect(plain(vaultLineItems(REPORT.vault)).map((v) => [v.key, v.text, v.figure, v.note])).toEqual([
      ['claimed', 'Products won, claimed (VAULT orders at 0)', '1 order · € 120', null],
      ['credits', 'Vault credits used', '1 order · € 25', null],
      ['creditsToGive', 'Credits to give used', '1 order · € 25', null],
      ['addons', 'Free add-ons given', '1 unit · € 9', null],
      ['cards', 'THE VAULT CARDs packed', '2 cards · € 1', '1 card estimated before packing'],
      ['guaranteed', 'Guaranteed pieces: each is bought at its price, so it costs nothing here.', '2 pieces', null],
    ]);
    // Its costs are THE VAULT column's parts (the server builds the line from them).
    const t = REPORT.totals.costs.vault;
    const v = REPORT.vault;
    expect([v.claimed.costMinor, v.credits.costMinor, v.creditsToGive.costMinor, v.addons.costMinor, v.cards.costMinor]).toEqual([t.productsWon, t.credits, t.creditsToGive, t.addons, t.cards]);
    // OP-22: "GUARANTEED · A piece at the next LIVE release": never a place, anywhere in the line.
    const guaranteed = vaultLineItems(REPORT.vault).find((i) => i.key === 'guaranteed')!;
    expect(guaranteed.text).toMatch(/piece/);
    expect(guaranteed.text).not.toMatch(/place/i);
    expect(JSON.stringify([vaultLineItems(REPORT.vault), vaultLineItems(NO_VAULT), vaultReportCost(REPORT.vault), MARGIN_VAULT_WORDS.guaranteed])).not.toMatch(/place/i);
    expect(plain(vaultLineItems({ ...NO_VAULT, guaranteedPieces: 1 })).find((i) => i.key === 'guaranteed')!.figure).toBe('1 piece');
    expect(vaultLineItems({ ...NO_VAULT }).find((i) => i.key === 'cards')!.note).toBeNull();

    // The report's own cost of the rewards won, by kind as Club → THE VAULT names them, and its rewards without a supplier price.
    expect(plain(vaultReportCost(REPORT.vault))).toEqual({
      text: 'The report’s cost of the rewards won',
      figure: '€ 170',
      kinds: 'House credit € 50 · Product € 120',
      unknown: '2 rewards without a supplier price',
    });
    // "N rewards without a supplier price" only when the report has any.
    expect(vaultReportCost({ ...REPORT.vault, rewardsCost: { ...REPORT.vault.rewardsCost, costUnknown: 1 } }).unknown).toBe('1 reward without a supplier price');
    expect(vaultReportCost({ ...REPORT.vault, rewardsCost: { ...REPORT.vault.rewardsCost, costUnknown: 0 } }).unknown).toBeNull();
    expect(plain(vaultReportCost(NO_VAULT))).toEqual({ text: 'The report’s cost of the rewards won', figure: '€ 0', kinds: null, unknown: null });

    // Why the two can differ, and where each reward's value and cost is read: Club → THE VAULT, its report.
    expect(MARGIN_VAULT_WORDS.reading).toBe(
      "THE VAULT's report counts the rewards won in the window, as Club → THE VAULT shows them; the margin counts what was spent and shipped in it, so the two can differ.",
    );
    expect(MARGIN_VAULT_WORDS.report).toBe("Each reward's value and cost: Club → THE VAULT, its report.");
    expect(vaultReportHref()).toBe('#/club?tab=vault');
    expect(vaultReportHref()).toBe(href('club', {}, { tab: 'vault' }));
    expect(MARGIN_TEXT.vaultLink).toBe('THE VAULT’s report');
    // The console says the server's words (services/margin.ts MARGIN_VAULT_WORDS).
    expect({ guaranteed: MARGIN_VAULT_WORDS.guaranteed, reading: MARGIN_VAULT_WORDS.reading, report: MARGIN_VAULT_WORDS.report }).toEqual({
      guaranteed: SERVER_VAULT_WORDS.guaranteed,
      reading: SERVER_VAULT_WORDS.reading,
      report: SERVER_VAULT_WORDS.report,
    });
    for (const n of [1, 2, 12]) expect(MARGIN_VAULT_WORDS.costUnknown(n)).toBe(SERVER_VAULT_WORDS.costUnknown(n));

    // Shown while anything is counted or won; a window without either holds no line.
    expect(vaultLineEmpty(REPORT.vault)).toBe(false);
    expect(vaultLineEmpty(NO_VAULT)).toBe(true);
    expect(vaultLineEmpty({ ...NO_VAULT, guaranteedPieces: 1 })).toBe(false);
    expect(vaultLineEmpty({ ...NO_VAULT, rewardsCost: { ...NO_VAULT.rewardsCost, costUnknown: 1 } })).toBe(false);
  });

  it('shows Partner experiences beside the margin, never inside it: nothing until partners are recorded (step M4.6), then the first plan\'s line in euros', () => {
    expect(partnerLine(REPORT)).toBeNull();
    expect(
      plain(
        partnerLine({
          partnerIncome: [
            { partnerId: 'p1', brand: 'MAISON A', invoicedMinor: 700_000, paidMinor: 500_000 },
            { partnerId: 'p2', brand: 'MAISON B', invoicedMinor: 500_000, paidMinor: 300_000 },
          ],
        }),
      ),
    ).toBe('Partner experiences: € 12 000 invoiced in this window, € 8 000 paid.');
    // Never inside the tables: no partner in a view's rows.
    expect(JSON.stringify(marginRows(REPORT, 'model'))).not.toMatch(/partner/i);
  });

  it('names What is missing with its count and where it is fixed', () => {
    const items = missingItems(REPORT.missing);
    expect(items.map((m) => [m.text, m.fix.label, m.fix.href])).toEqual([
      ['1 amount in CHF has no rate: it is left out.', 'Margin settings', '#/growth/margin-settings'],
      ['3 amounts in JPY have no rate: they are left out.', 'Margin settings', '#/growth/margin-settings'],
      ['2 pieces or units have no supplier price.', 'A supplier order’s prices', '#/supplier-orders'],
      ['1 parcel has no weight.', 'The model’s Packing', '#/catalogue'],
      ['1 parcel has no box, or a box without a cost.', 'Boxes, in Orders → Settings', '#/settings'],
      ['3 parcels have no shipping band for their country and weight.', 'Margin settings', '#/growth/margin-settings'],
      ['Leather goods (Q) has no returns and claims allowance: 1 order.', 'Margin settings', '#/growth/margin-settings'],
      ['Not set: CARD, THE VAULT CARD, Claim: REPAIR.', 'Margin settings', '#/growth/margin-settings'],
    ]);
    expect(missingItems({ piecePrices: 0, parcelWeights: 0, shippingRates: 0, boxCosts: 0, allowances: [], unitCosts: [], currencies: [] })).toEqual([]);
    expect(MARGIN_UNIT_COST_KEYS.map(unitCostLabel)).toEqual([
      'POUCH',
      'CARD',
      'THE VAULT CARD',
      'PRIVATE CARE service',
      'Claim: REPLACEMENT',
      'Claim: VALUE CREDIT',
      'Claim: PART CREDIT',
      'Claim: REPAIR',
      'Claim: PRICE REDUCTION',
      'Claim: REFUND',
      'Claim: REFUSED',
    ]);
  });
});

const BAND = (id: string, country: string | null, maxWeightG: number, costMinor: number, currency = 'EUR'): ShippingCostView => ({ id, country, maxWeightG, costMinor, currency, updatedAt: '2026-10-20T10:00:00.000Z' });

const SETTINGS: MarginSettings = {
  currency: 'EUR',
  rates: [{ currency: 'GBP', eurRate: '1.150000', updatedAt: '2026-10-20T10:00:00.000Z' }],
  currenciesWithoutRate: ['USD', 'CHF'],
  shippingCosts: [BAND('b1', 'FR', 1000, 990), BAND('b2', 'FR', 500, 690), BAND('b3', null, 1000, 1500), BAND('b4', 'DE', 500, 800), BAND('b5', 'GB', 500, 700, 'GBP')],
  unitCosts: MARGIN_UNIT_COST_KEYS.map((key) => ({ key, costMinor: key === 'POUCH' ? 300 : null, currency: key === 'POUCH' ? 'EUR' : null, updatedAt: null })),
  allowances: [
    { categoryId: 1, code: 'J', name: 'Jewelry', active: true, allowanceBp: 250, updatedAt: null },
    { categoryId: 2, code: 'L', name: 'Leather goods', active: true, allowanceBp: null, updatedAt: null },
    { categoryId: 3, code: 'W', name: 'Watches', active: false, allowanceBp: null, updatedAt: null },
    { categoryId: 4, code: 'X', name: 'Old', active: false, allowanceBp: 100, updatedAt: null },
  ],
};

describe('Margin settings (lot M4 plan §1.3)', () => {
  it('opens at #/growth/margin-settings, under Growth; an ADMIN writes, every reader of Growth reads', () => {
    expect(href('marginSettings')).toBe('#/growth/margin-settings');
    expect(parseHash('#/growth/margin-settings')).toMatchObject({ name: 'marginSettings' });
    expect(parseHash('#/growth')).toMatchObject({ name: 'growth' });
    expect((['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const).map((r) => can(r, 'manageMargin'))).toEqual([false, false, false, false, true]);
    expect((['AUDITOR', 'OPERATOR', 'ADMIN'] as const).map((r) => can(r, 'readGrowth'))).toEqual([true, true, true]);
  });

  it('lists each currency with its rate or none, and checks a rate as the server does', () => {
    expect(currencyRows(SETTINGS).map((r) => [r.currency, r.text])).toEqual([
      ['CHF', 'No rate: left out of the margin'],
      ['GBP', '1 GBP = 1.150000 EUR'],
      ['USD', 'No rate: left out of the margin'],
    ]);
    expect(rateLine('JPY', '0.006200')).toBe('1 JPY = 0.006200 EUR');
    expect([rateField('1.150000'), rateField('2.000000'), rateField('0.006200'), rateField(null)]).toEqual(['1.15', '2', '0.0062', '']);
    expect(rateValue(' 1,15 ')).toBe('1.15');
    expect(rateProblem({ currency: 'EUR', rate: '1' })).toBe('Every margin figure is in euros: the euro is 1 and takes no rate.');
    expect(rateProblem({ currency: 'GB', rate: '1' })).toBe('The currency is a three-letter code, such as GBP.');
    for (const bad of ['0', '-1', '100001', '1.1234567', 'abc', '']) expect(plain(rateProblem({ currency: 'GBP', rate: bad })), bad).toMatch(/^A rate is the euros one unit is worth/);
    for (const good of ['1.15', '0.0085', '100000', '1,2']) {
      expect(rateProblem({ currency: 'gbp', rate: good }), good).toBeNull();
      // What the console accepts, the server takes.
      expect(() => parseRate(rateValue(good))).not.toThrow();
    }
  });

  it('groups the bands by country, ALL OTHER COUNTRIES last, each by weight, and checks a band\'s dialog', () => {
    expect(bandGroups(SETTINGS.shippingCosts).map((g) => [g.label, g.bands.map((b) => plain(bandText(b)))])).toEqual([
      ['France', ['up to 500 g · € 6.90', 'up to 1 000 g · € 9.90']],
      ['Germany', ['up to 500 g · € 8']],
      ['United Kingdom', ['up to 500 g · £ 7']],
      ['ALL OTHER COUNTRIES', ['up to 1 000 g · € 15']],
    ]);
    const options = bandCountryOptions();
    expect(options[0]).toEqual({ value: '*', label: 'ALL OTHER COUNTRIES' });
    expect(options.find((o) => o.value === 'FR')).toEqual({ value: 'FR', label: 'France' });
    expect(bandFormValues(null)).toEqual({ country: '*', maxWeightG: '', cost: '', currency: 'EUR' });
    expect(bandFormValues(SETTINGS.shippingCosts[1]!)).toEqual({ country: 'FR', maxWeightG: '500', cost: '6.90', currency: 'EUR' });
    expect(bandProblem({ country: 'ZZ', maxWeightG: '500', cost: '6.90', currency: 'EUR' })).toBe('Choose the country, or ALL OTHER COUNTRIES.');
    expect(plain(bandProblem({ country: 'FR', maxWeightG: '0', cost: '6.90', currency: 'EUR' }))).toBe('UP TO is a whole number of grams, 1 to 100 000.');
    expect(plain(bandProblem({ country: 'FR', maxWeightG: '100001', cost: '6.90', currency: 'EUR' }))).toBe('UP TO is a whole number of grams, 1 to 100 000.');
    expect(bandProblem({ country: 'FR', maxWeightG: '500', cost: '6.999', currency: 'EUR' })).toBe('A cost reads 6.90, or 12.');
    expect(bandProblem({ country: 'FR', maxWeightG: '500', cost: '6.90', currency: 'E' })).toBe('The currency is a three-letter code, such as EUR.');
    expect(bandProblem({ country: '*', maxWeightG: '1 000', cost: '15', currency: 'eur' })).toBeNull();
    expect(bandInput({ country: '*', maxWeightG: '1 000', cost: '15', currency: 'eur' })).toEqual({ country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' });
    const fr = SETTINGS.shippingCosts[1]!;
    expect(bandChange(fr, { country: 'FR', maxWeightG: '500', cost: '6.90', currency: 'EUR' })).toBeNull();
    expect(bandChange(fr, { country: '*', maxWeightG: '500', cost: '7.20', currency: 'EUR' })).toEqual({ country: null, costMinor: 720 });
  });

  it('reads the unit costs in their sections and checks a cost', () => {
    // Packaging: the POUCH and the CARD per piece, THE VAULT CARD per card packed (D61).
    expect(packagingKeys(SETTINGS).map((u) => u.key)).toEqual(['POUCH', 'CARD', 'VAULT_CARD']);
    expect(careKeys(SETTINGS).map((u) => u.key)).toEqual(MARGIN_UNIT_COST_KEYS.filter((k) => k !== 'POUCH' && k !== 'CARD' && k !== 'VAULT_CARD'));
    expect([...packagingKeys(SETTINGS), ...careKeys(SETTINGS)].map((u) => u.key).sort()).toEqual([...MARGIN_UNIT_COST_KEYS].sort());
    expect([unitCostLabel('VAULT_CARD'), unitCostNote('VAULT_CARD')]).toEqual(['THE VAULT CARD', 'Per card packed']);
    expect(MARGIN_SETTINGS_TEXT.packagingLead).toMatch(/THE VAULT CARD/);
    const [pouch, card] = packagingKeys(SETTINGS);
    expect(plain([unitCostText(pouch!), unitCostText(card!)])).toEqual(['€ 3', 'Not set']);
    expect([unitCostNote('POUCH'), unitCostNote('CARE_SERVICE'), unitCostNote('CLAIM_REFUND')]).toEqual(['Per piece', 'Per service done', 'Per claim decided']);
    expect(unitCostFormValues(card!)).toEqual({ cost: '', currency: 'EUR' });
    expect(unitCostFormValues(pouch!)).toEqual({ cost: '3', currency: 'EUR' });
    expect(unitCostProblem(pouch!, { cost: '3', currency: 'eur' })).toBe('Nothing has changed.');
    expect(unitCostProblem(pouch!, { cost: '3.50', currency: 'EUR' })).toBeNull();
    expect(unitCostProblem(card!, { cost: 'x', currency: 'EUR' })).toBe('A cost reads 6.90, or 12.');
    expect(unitCostInput({ cost: '3,50', currency: 'gbp' })).toEqual({ costMinor: 350, currency: 'GBP' });
    expect(MARGIN_SETTINGS_TEXT.careHint).toBe('A credit given is counted when it is used on an order (PERKS); set here what the outcome itself costs.');
  });

  it('lists the active categories (and an inactive one still holding an allowance) and checks an allowance as the server does', () => {
    expect(allowanceRows(SETTINGS).map((a) => a.code)).toEqual(['J', 'L', 'X']);
    expect([allowanceText(250), allowanceText(0), allowanceText(null)]).toEqual(['2.50 %', '0.00 %', 'Not set']);
    expect([allowanceField(250), allowanceField(1234), allowanceField(null)]).toEqual(['2.5', '12.34', '']);
    const leather = SETTINGS.allowances[1]!;
    for (const bad of ['101', '2.555', '-1', 'abc', '']) expect(allowanceProblem(leather, bad), bad).toBe('An allowance is a percent from 0 to 100, with at most two decimals.');
    for (const good of ['2.5', '0', '100', '12,25', '3 %']) {
      expect(allowanceProblem(leather, good), good).toBeNull();
      expect(() => percentToBp(good.replace(/[\s%]/g, '').replace(',', '.'))).not.toThrow();
    }
    expect(allowanceProblem(SETTINGS.allowances[0]!, '2.50')).toBe('Nothing has changed.');
  });

  it('keeps the house\'s words: no atelier, handmade or craft, no exclamation mark', () => {
    const words = JSON.stringify([MARGIN_TEXT, MARGIN_SETTINGS_TEXT, missingItems(REPORT.missing), MARGIN_VAULT_WORDS, vaultLineItems(REPORT.vault), vaultReportCost(REPORT.vault)]);
    expect(words).not.toMatch(/atelier|handmade|craft|!/i);
  });
});

describe('the API client', () => {
  it('calls the margin\'s and its settings\' routes with their methods and bodies, the CSRF token on every change', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch: FetchLike = async (url, init = {}) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new AdminApi({ fetch });
    api.setCsrf('tok');
    await api.margin({ months: 24 });
    await api.marginSettings();
    await api.setMarginRate('GBP', '1.15');
    await api.clearMarginRate('GBP');
    await api.addShippingCost({ country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' });
    await api.updateShippingCost('b1', { costMinor: 720 });
    await api.removeShippingCost('b1');
    await api.setUnitCost('POUCH', { costMinor: 300, currency: 'EUR' });
    await api.clearUnitCost('CLAIM_REFUND');
    await api.setAllowance(17, '2.5');
    await api.clearAllowance(17);
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/admin/margin?months=24',
      'GET /api/admin/margin/settings',
      'PUT /api/admin/margin/rates/GBP',
      'DELETE /api/admin/margin/rates/GBP',
      'POST /api/admin/margin/shipping-costs',
      'PATCH /api/admin/margin/shipping-costs/b1',
      'DELETE /api/admin/margin/shipping-costs/b1',
      'PUT /api/admin/margin/unit-costs/POUCH',
      'DELETE /api/admin/margin/unit-costs/CLAIM_REFUND',
      'PUT /api/admin/margin/allowances/17',
      'DELETE /api/admin/margin/allowances/17',
    ]);
    const bodies = calls.filter((c) => c.init.body !== undefined).map((c) => JSON.parse(String(c.init.body)));
    expect(bodies).toEqual([{ rate: '1.15' }, { country: null, maxWeightG: 1000, costMinor: 1500, currency: 'EUR' }, { costMinor: 720 }, { costMinor: 300, currency: 'EUR' }, { percent: '2.5' }]);
    for (const c of calls.slice(2)) expect(new Headers(c.init.headers).get('x-csrf-token')).toBe('tok');
  });
});
