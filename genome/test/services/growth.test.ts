/**
 * GROWTH (plan NEXT-NINE, §3.9 BP-29, step 9.1; services/growth.ts), on the fourteen months of test/support/growth.ts
 * (every figure below is counted by hand from its header):
 *
 *  - the pure functions: median, percentile, ltvStats, secondPieceBuckets, cohortTable, funnelMonths, tierReachDates,
 *    maskSmallGroups, monthsOfWindow;
 *  - lifetime value = invoices − credit notes + pieces from elsewhere at their model's price; an ordered piece counts
 *    once; a returned order nets to zero; TRANSFER, RESALE and ADMIN pieces are not counted; a variant takes its main
 *    model's price; a piece without a price counts and adds nothing; currencies are never mixed;
 *  - DELETED accounts are out of lifetime value, repeat buying and COLLECTORS BY VALUE, and in the funnel and revenue;
 *  - the test entrants' pool is out of the purchases and of every step of the funnel;
 *  - the tiers follow the constant, and a stub ([1, 3, 5]) moves them;
 *  - a GIFT order is never a purchase, and a credit lowers the revenue;
 *  - COLLECTORS BY VALUE: its order, ties by account id, its pages, the sum of its rows equal to the lifetime value's
 *    total, each row equal to collectorValue (and to the client sheet's);
 *  - the funnel's months, « Buyers » counting a first SALON order as well as LIVE and DRAW, never a GIFT order;
 *  - the revenue of each month equal to the Invoices page's (InvoiceService.list);
 *  - Latest releases without drafts, cancelled releases, after-rooms or releases still ahead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, type AppContext } from '../../src/server/context.js';
import { DomainError } from '../../src/server/errors.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { CLUB_TIER_THRESHOLDS } from '../../src/server/services/club.js';
import {
  cohortTable,
  COHORT_MARKS,
  countByMonth,
  FUNNEL_STEPS,
  funnelMonths,
  GROWTH_COLLECTORS_PAGE,
  GROWTH_MIN_GROUP,
  GrowthService,
  ltvStats,
  maskSmallGroups,
  median,
  monthsOfWindow,
  percentile,
  PIECE_SOURCES,
  secondPieceBuckets,
  tierReachDates,
} from '../../src/server/services/growth.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { GROWTH_NOW, seedGrowth, type GrowthFixture } from '../support/growth.js';

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

describe('GROWTH: the pure functions', () => {
  it('median, percentile and ltvStats', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(3); // (2 + 3) / 2 = 2.5, rounded
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 1)).toBe(40);
    expect(percentile([10, 20, 30, 40], 0.75)).toBe(30);
    expect(ltvStats([])).toEqual({ collectors: 0, totalMinor: 0, averageMinor: null, medianMinor: null, topTenthFromMinor: null });
    // Ten collectors: the top tenth is the highest one; eleven: the two highest, from the second.
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x * 100);
    expect(ltvStats(ten)).toEqual({ collectors: 10, totalMinor: 5500, averageMinor: 550, medianMinor: 550, topTenthFromMinor: 1000 });
    expect(ltvStats([...ten, 50]).topTenthFromMinor).toBe(900);
    expect(ltvStats([300, 100, 200]).topTenthFromMinor).toBe(300);
  });

  it('secondPieceBuckets: before one, three, six and twelve months after the first, then after a year', () => {
    const first = d('2026-01-31');
    const b = secondPieceBuckets([
      { first, second: d('2026-02-27') }, // within a month (31 Jan + 1 month: 28 Feb)
      { first, second: d('2026-02-28') }, // a month to the day: one to three months
      { first, second: d('2026-07-30') }, // under six months
      { first, second: d('2026-07-31') }, // six months to the day: six months to a year
      { first, second: d('2027-01-30') },
      { first, second: d('2027-01-31') }, // a year to the day: after a year
    ]);
    expect(b).toEqual({ MONTH: 1, THREE_MONTHS: 1, SIX_MONTHS: 1, YEAR: 2, LATER: 1 });
  });

  it('monthsOfWindow, countByMonth and funnelMonths', () => {
    expect(monthsOfWindow(new Date('2026-10-15T00:00:00Z'), 12)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    expect(monthsOfWindow(new Date('2026-01-01T00:00:00Z'), 24)[0]).toBe('2024-02');
    expect([...countByMonth([d('2026-01-02'), null, d('2026-01-30'), d('2026-03-01')])]).toEqual([
      ['2026-01', 2],
      ['2026-03', 1],
    ]);
    const empty = new Map<string, number>();
    const rows = funnelMonths(['2026-01', '2026-02'], { scans: new Map([['2026-02', 9]]), accounts: empty, owners: empty, buyers: new Map([['2026-01', 1]]), platine: empty, palladium: empty });
    expect(rows).toEqual([
      { month: '2026-02', counts: { scans: 9, accounts: 0, owners: 0, buyers: 0, platine: 0, palladium: 0 } },
      { month: '2026-01', counts: { scans: 0, accounts: 0, owners: 0, buyers: 1, platine: 0, palladium: 0 } },
    ]);
    expect(FUNNEL_STEPS).toEqual(['scans', 'accounts', 'owners', 'buyers', 'platine', 'palladium']);
  });

  it('cohortTable: each mark once the cohort\'s last day is that far behind, the newest month first', () => {
    const rows = cohortTable(
      [
        { first: d('2026-01-05'), second: d('2026-01-20') },
        { first: d('2026-01-31'), second: d('2026-05-15') },
        { first: d('2026-01-10'), second: null },
        { first: d('2026-03-01'), second: d('2026-03-02') },
      ],
      ['2026-01', '2026-02', '2026-03'],
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(COHORT_MARKS).toEqual([1, 3, 6, 12]);
    expect(rows).toEqual([
      { month: '2026-03', collectors: 1, within: [1, 1, null, null], toDate: 1 },
      { month: '2026-02', collectors: 0, within: [0, 0, null, null], toDate: 0 },
      { month: '2026-01', collectors: 3, within: [1, 1, null, null], toDate: 2 },
    ]);
  });

  it('tierReachDates: the running count of pieces held, an end before a start at the same instant; any thresholds', () => {
    const iv = [
      { start: d('2026-01-01'), end: null },
      { start: d('2026-02-01'), end: d('2026-03-01') },
      { start: d('2026-03-01'), end: null },
      { start: d('2026-04-01'), end: null },
    ];
    expect(tierReachDates(iv, [1, 3, 4])).toEqual([d('2026-01-01'), d('2026-04-01'), null]);
    expect(tierReachDates(iv, [1, 2, 3])).toEqual([d('2026-01-01'), d('2026-02-01'), d('2026-04-01')]);
    expect(tierReachDates([], CLUB_TIER_THRESHOLDS)).toEqual([null, null, null]);
  });

  it('maskSmallGroups: under three collectors, the count stays and the amounts read null', () => {
    expect(GROWTH_MIN_GROUP).toBe(3);
    expect(maskSmallGroups([{ collectors: 2, totalMinor: 5, n: 1 }, { collectors: 3, totalMinor: 9, n: 1 }], ['totalMinor'])).toEqual([
      { collectors: 2, totalMinor: null, n: 1 },
      { collectors: 3, totalMinor: 9, n: 1 },
    ]);
  });
});

describe('GROWTH: the report on fourteen months (services/growth.ts)', () => {
  let t: TestDb;
  let ctx: AppContext;
  let clock: ManualClock;
  let f: GrowthFixture;
  const growth = () => ctx.services.growth;

  beforeAll(async () => {
    t = await createTestDb();
    clock = createManualClock(GROWTH_NOW.toISOString());
    ctx = await createContext(testConfig(), { db: t.db, clock: clock.now, keyProvider: new MemoryKeyProvider({ env: 'test' }), ensureActiveKey: true });
    f = await seedGrowth(t.db);
  }, 60_000);
  afterAll(async () => {
    await ctx?.close();
    await t?.close();
  });

  it('reads the last 12 UTC months by default, the current one included, in the currency with the most invoices', async () => {
    const r = await growth().report();
    expect(r.window).toMatchObject({ months: 12, from: '2025-11', to: '2026-10', currency: 'EUR', currencies: ['EUR', 'GBP'] });
    expect(r.window.list).toHaveLength(12);
    const long = await growth().report({ months: 24 });
    expect(long.window).toMatchObject({ months: 24, from: '2024-11', to: '2026-10' });
    for (const bad of [{ months: 6 }, { currency: 'JPY' }]) await expect(growth().report(bad)).rejects.toBeInstanceOf(DomainError);
  });

  it('lifetime value: invoices less credit notes plus pieces from elsewhere, an ordered piece once, a returned order at zero, a variant at its main model\'s price', async () => {
    const { ltv } = await growth().report();
    // A1 6 050, A2 9 600, A4 1 200, A5 5 500, A8 2 400, A10 1 200, A12 1 200 (euros): A3 bought in pounds only, A6 is DELETED.
    expect(ltv.perCollector).toEqual({ collectors: 7, totalMinor: 2_715_000, averageMinor: 387_857, medianMinor: 240_000, topTenthFromMinor: 960_000 });
    expect(ltv.unpricedPieces).toBe(1);
    expect(ltv.byTier).toEqual([
      { key: 'PALLADIUM', label: null, collectors: 1, totalMinor: null, averageMinor: null, medianMinor: null },
      { key: 'PLATINE', label: null, collectors: 0, totalMinor: null, averageMinor: null, medianMinor: null },
      { key: 'TITANE', label: null, collectors: 3, totalMinor: 1_200_000, averageMinor: 400_000, medianMinor: 120_000 },
      { key: 'NONE', label: null, collectors: 3, totalMinor: 910_000, averageMinor: 303_333, medianMinor: 240_000 },
    ]);
    expect(ltv.byCountry).toEqual([
      { key: 'FR', label: null, collectors: 5, totalMinor: 1_925_000, averageMinor: 385_000, medianMinor: 120_000 },
      { key: 'CH', label: null, collectors: 1, totalMinor: null, averageMinor: null, medianMinor: null },
      { key: null, label: null, collectors: 1, totalMinor: null, averageMinor: null, medianMinor: null },
    ]);
    expect(ltv.byFirstModel).toEqual([
      { key: f.models.halo, label: 'HALO', collectors: 5, totalMinor: 1_150_000, averageMinor: 230_000, medianMinor: 120_000 },
      { key: f.models.monolithe, label: 'MONOLITHE', collectors: 2, totalMinor: null, averageMinor: null, medianMinor: null },
    ]);
    expect(ltv.byChannel.map((g) => g.key)).toEqual([...PIECE_SOURCES]);
    expect(ltv.byChannel.map((g) => [g.key, g.collectors, g.totalMinor])).toEqual([
      ['LIVE', 1, null],
      ['DRAW', 1, null],
      ['SALON', 3, 1_395_000],
      ['POINT_OF_SALE', 0, null],
      ['ELSEWHERE', 2, null],
    ]);
  });

  it('never mixes currencies: in pounds, A3\'s order alone, and the piece without a price', async () => {
    const r = await growth().report({ currency: 'GBP' });
    expect(r.window.currency).toBe('GBP');
    expect(r.ltv.perCollector).toMatchObject({ collectors: 2, totalMinor: 100_000 });
    expect(r.revenue.total).toEqual({ orders: 1, invoicedMinor: 100_000, creditedMinor: 0, netMinor: 100_000 });
    const rows = (await growth().collectors({ currency: 'GBP' })).items;
    expect(rows.map((c) => [c.accountId, c.valueMinor, c.pieces])).toEqual([
      [f.accounts.A3, 100_000, 1],
      [f.accounts.A1, 0, 1],
    ]);
  });

  it('repeat buying: every currency, the second piece and the time to it, the cohorts by month of the first piece', async () => {
    const { repeat } = await growth().report();
    expect(repeat).toMatchObject({ collectors: 8, withSecond: 4, rate: 0.5, medianDays: 168 });
    expect(repeat.buckets).toEqual({ MONTH: 0, THREE_MONTHS: 1, SIX_MONTHS: 1, YEAR: 1, LATER: 1 });
    expect(repeat.cohorts).toHaveLength(12);
    const cohort = (m: string) => repeat.cohorts.find((c) => c.month === m)!;
    expect(repeat.cohorts[0]!.month).toBe('2026-10');
    expect(cohort('2025-11')).toEqual({ month: '2025-11', collectors: 1, within: [0, 1, 1, null], toDate: 1 });
    expect(cohort('2026-01')).toEqual({ month: '2026-01', collectors: 1, within: [0, 0, 0, null], toDate: 0 });
    expect(cohort('2026-02')).toEqual({ month: '2026-02', collectors: 2, within: [0, 0, 0, null], toDate: 1 });
    expect(cohort('2026-04')).toEqual({ month: '2026-04', collectors: 1, within: [0, 0, null, null], toDate: 0 });
    expect(cohort('2026-06')).toEqual({ month: '2026-06', collectors: 1, within: [0, 0, null, null], toDate: 0 });
    expect(cohort('2026-12' as string)).toBeUndefined();
    expect(cohort('2026-08')).toEqual({ month: '2026-08', collectors: 0, within: [0, null, null, null], toDate: 0 });
    expect(cohort('2026-09')).toEqual({ month: '2026-09', collectors: 0, within: [null, null, null, null], toDate: 0 });
  });

  it('the funnel: each account in the month it first reached each step, DELETED ones kept; Buyers by a first LIVE, DRAW or SALON order, never a GIFT', async () => {
    const { funnel } = await growth().report();
    expect(funnel.thresholds).toEqual([...CLUB_TIER_THRESHOLDS]);
    expect(funnel.totals).toEqual({ scans: 100, accounts: 9, owners: 4, buyers: 5, platine: 1, palladium: 1 });
    const month = (m: string) => funnel.months.find((x) => x.month === m)!.counts;
    expect(funnel.months[0]!.month).toBe('2026-10');
    expect(month('2025-11')).toEqual({ scans: 40, accounts: 1, owners: 1, buyers: 1, platine: 0, palladium: 0 }); // A2: LIVE
    expect(month('2026-01')).toEqual({ scans: 60, accounts: 1, owners: 1, buyers: 0, platine: 0, palladium: 0 });
    expect(month('2026-02')).toMatchObject({ accounts: 1, buyers: 2 }); // A3 and A5: SALON
    expect(month('2026-03')).toMatchObject({ accounts: 1, buyers: 1, platine: 1 }); // A6 (DELETED); A1 reaches PLATINE
    expect(month('2026-06')).toMatchObject({ accounts: 1, buyers: 1 }); // A12: DRAW
    expect(month('2026-07')).toMatchObject({ palladium: 1 });
    expect(funnel.clubNow).toEqual({ TITANE: 4, PLATINE: 0, PALLADIUM: 1, total: 5 });
  });

  it('the tiers follow the constant: stubbed to [1, 3, 5], A4 reaches PLATINE with three pieces and A1 PALLADIUM in March', async () => {
    const stubbed = new GrowthService({ db: t.db, clock: clock.now, thresholds: [1, 3, 5] });
    const r = await stubbed.report();
    expect(r.funnel.thresholds).toEqual([1, 3, 5]);
    expect(r.funnel.totals).toMatchObject({ platine: 2, palladium: 1 });
    expect(r.funnel.months.find((m) => m.month === '2026-05')!.counts.platine).toBe(1);
    expect(r.funnel.months.find((m) => m.month === '2026-03')!.counts.palladium).toBe(1);
    expect(r.ltv.byTier.map((g) => [g.key, g.collectors])).toEqual([
      ['PALLADIUM', 1],
      ['PLATINE', 1],
      ['TITANE', 2],
      ['NONE', 3],
    ]);
    expect(r.funnel.clubNow).toEqual({ TITANE: 3, PLATINE: 1, PALLADIUM: 1, total: 5 });
    expect((await stubbed.collectors()).items.find((c) => c.accountId === f.accounts.A4)!.tier).toBe('PLATINE');
    expect((await growth().collectors()).items.find((c) => c.accountId === f.accounts.A4)!.tier).toBe('TITANE');
  });

  it('the revenue: invoices less credit notes in the month each was issued, a credit lowering it, GIFT orders adding nothing; each month equals the Invoices page', async () => {
    const { revenue } = await growth().report();
    expect(revenue.total).toEqual({ orders: 9, invoicedMinor: 2_115_000, creditedMinor: 600_000, netMinor: 1_515_000 });
    const month = (m: string) => revenue.months.find((x) => x.month === m)!;
    expect(month('2026-01')).toEqual({ month: '2026-01', orders: 1, invoicedMinor: 125_000, creditedMinor: 120_000, netMinor: 5_000 });
    expect(month('2026-04')).toMatchObject({ invoicedMinor: 480_000, creditedMinor: 480_000, netMinor: 0 });
    expect(month('2026-10')).toEqual({ month: '2026-10', orders: 2, invoicedMinor: 550_000, creditedMinor: 0, netMinor: 550_000 });
    for (const m of revenue.months) {
      const page = (await ctx.services.invoices.list({ month: m.month })).totals.find((x) => x.currency === 'EUR') ?? { invoiced: 0, credited: 0, net: 0 };
      expect([m.invoicedMinor, m.creditedMinor, m.netMinor], m.month).toEqual([page.invoiced, page.credited, page.net]);
    }
    expect(revenue.byChannel).toEqual([
      { key: 'LIVE', label: null, collectors: 1, orders: 1, netMinor: null },
      { key: 'DRAW', label: null, collectors: 3, orders: 3, netMinor: 245_000 },
      { key: 'SALON', label: null, collectors: 4, orders: 5, netMinor: 790_000 },
    ]);
    expect(revenue.byModel.map((g) => [g.label, g.collectors, g.netMinor])).toEqual([
      ['MONOLITHE', 3, 910_000],
      ['HALO', 6, 605_000],
    ]);
    expect(revenue.byCountry.find((g) => g.key === 'FR')).toMatchObject({ collectors: 3, netMinor: 725_000 });
    // The DELETED account's order is in the revenue, its amount withheld with Italy's single collector.
    expect(revenue.byCountry.find((g) => g.key === 'IT')).toMatchObject({ collectors: 1, netMinor: null });
  });

  it('names no account in the report', async () => {
    const json = JSON.stringify(await growth().report());
    for (const id of Object.values(f.accounts)) expect(json).not.toContain(id);
    expect(json).not.toMatch(/@example\.com/);
  });

  it('COLLECTORS BY VALUE: highest first then by account id, DELETED left out, its sum the lifetime value\'s total, each row its collectorValue and its client sheet\'s', async () => {
    const page = await growth().collectors();
    expect(page).toMatchObject({ currency: 'EUR', currencies: ['EUR', 'GBP'], page: 1, pageSize: GROWTH_COLLECTORS_PAGE, total: 7 });
    const { A1, A2, A4, A5, A8, A10, A12 } = f.accounts;
    expect(page.items.map((c) => c.accountId)).toEqual([A2, A1, A5, A8, ...[A4, A10, A12].sort()]);
    expect(page.items[0]).toMatchObject({ tier: 'TITANE', country: 'FR', pieces: 2, valueMinor: 960_000, firstPieceAt: d('2025-11-20') });
    expect(page.items[1]).toMatchObject({ tier: 'PALLADIUM', pieces: 3, valueMinor: 605_000, firstPieceAt: d('2025-09-20') });
    expect(page.items.find((c) => c.accountId === A5)).toMatchObject({ tier: null, country: null });
    expect(page.items.every((c) => c.email.endsWith('@example.com'))).toBe(true);
    expect(page.items.some((c) => c.accountId === f.accounts.A6)).toBe(false);
    const { ltv } = await growth().report();
    expect(page.items.reduce((n, c) => n + c.valueMinor, 0)).toBe(ltv.perCollector.totalMinor);
    for (const c of page.items) {
      const value = await growth().collectorValue(c.accountId);
      expect(value.find((v) => v.currency === 'EUR')?.valueMinor, c.accountId).toBe(c.valueMinor);
      expect((await ctx.services.owners.sheet(c.accountId)).lifetimeValue, c.accountId).toEqual(value);
    }
    expect(await growth().collectorValue(f.accounts.A3)).toEqual([{ currency: 'GBP', valueMinor: 100_000 }]);
    expect(await growth().collectorValue(f.accounts.A7)).toEqual([]);
    expect((await ctx.services.owners.sheet(f.accounts.A9)).lifetimeValue).toEqual([]);
    await expect(growth().collectorValue('nope')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('Latest releases: the last six past their opening, without drafts, cancelled releases, after-rooms or releases ahead', async () => {
    const items = await growth().releases();
    expect(items.map((r) => r.id)).toEqual([f.releases.D2, f.releases.D1, f.releases.L1]);
    expect(items[0]).toMatchObject({ mode: 'DRAW', title: 'MONOLITHE — DRAW', pieces: 5, sold: 0, entries: 1, sellOutMs: null });
    expect(items[1]).toMatchObject({ mode: 'DRAW', pieces: 10, sold: 2, entries: 3 });
    expect(items[2]).toMatchObject({ mode: 'LIVE', pieces: 3, sold: 1, entries: null, sellOutMs: null });
  });

  it('COLLECTORS BY VALUE pages by 25: the rows of the second page follow the first, the total counts them all', async () => {
    for (let i = 0; i < 20; i++) {
      const a = await f.world.account('2026-09-01', 'FR');
      await f.world.own(a, await f.world.piece(f.models.halo), 'FIRST_REGISTRATION', '2026-09-02');
    }
    const first = await growth().collectors();
    const second = await growth().collectors({ page: 2 });
    expect([first.total, second.total]).toEqual([27, 27]);
    expect([first.items.length, second.items.length]).toEqual([25, 2]);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((c) => c.accountId)).size).toBe(27);
    for (let i = 1; i < all.length; i++) {
      const [a, b] = [all[i - 1]!, all[i]!];
      expect(a.valueMinor > b.valueMinor || (a.valueMinor === b.valueMinor && a.accountId < b.accountId), `${i}`).toBe(true);
    }
    expect((await growth().collectors({ page: 3 })).items).toEqual([]);
    expect((await growth().collectors({ page: 3 })).total).toBe(27);
    expect(all.reduce((n, c) => n + c.valueMinor, 0)).toBe((await growth().report()).ltv.perCollector.totalMinor);
  });

  it('leaves the test entrants\' pool out: a pool account created, owning and buying in the window changes no step of the funnel, no lifetime value, repeat buying or COLLECTORS BY VALUE', async () => {
    const before = await growth().report();
    const collectors = await growth().collectors();
    // A pool account (TEST ENTRANTS: a test_entrants row, its creation moved back into the window by a press), with a
    // piece from elsewhere and a paid SALON order, and a DRAW order of its own.
    const bot = await f.world.account('2026-04-02', 'FR');
    await t.db.insertInto('test_entrants').values({ account_id: bot, tier: 3, seniority: 10 }).execute();
    await f.world.own(bot, await f.world.piece(f.models.halo), 'FIRST_REGISTRATION', '2026-04-03');
    await f.world.order({ accountId: bot, modelId: f.models.halo, channel: 'SALON', paid: '2026-04-04', total: 120_000, currency: 'EUR' });
    const after = await growth().report();
    expect(after.funnel).toEqual(before.funnel);
    expect(after.ltv).toEqual(before.ltv);
    expect(after.repeat).toEqual(before.repeat);
    expect(await growth().collectors()).toEqual(collectors);
    expect(await growth().collectorValue(bot)).toEqual([]);
  });
});
