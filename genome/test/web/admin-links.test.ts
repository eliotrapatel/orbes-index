/**
 * The console's Links pages, their model (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10 and A.15
 * « test/web/admin-links.test.ts », steps 4.8 and 4.9; src/web/admin/model/links.ts), with plain values (no DOM):
 *
 *  - the page's state from its address (ALL TIME on LINKS by default, the periods in Paris days, CUSTOM checked as the
 *    server checks it, the defaults left out of the address);
 *  - the rows of the three views: LINKS grouped by channel in the channels' order (its sum, then its links), CAMPAIGN
 *    TAGS grouped by utm_source with their variants, REFERRING SITES with ORBES's own site named; then the lines without
 *    one under their heading, then the TOTAL; the two column groups side by side, each figure opening its collectors
 *    (never a zero, never Visits, First visits, Cost or Return); the returns' words; the phone's blocks in their order;
 *  - the New link and Edit dialog's checks, body and changes, the suggested address, the server's refusals placed under
 *    their field; the Channels' moves;
 *  - the capabilities, the routes, and every word calm (no exclamation mark; admin.brand.test.ts reads the files);
 *  - compile-time: the console's types are what the server sends.
 */
import { describe, expect, it } from 'vitest';
import type { AcquisitionReport, FigureCollectors, LinkReport as ServerLinkReport } from '../../src/server/services/acquisition-report.js';
import type { ChannelView, LinkDestinations as ServerDestinations, LinkView as ServerLinkView } from '../../src/server/services/links.js';
import { REPORT_MAX_DAYS, REPORT_VIEWS, ATTRIBUTIONS, MEASURES as SERVER_MEASURES } from '../../src/server/services/acquisition-report.js';
import { freeCode, suggestCode } from '../../src/shared/link-code.js';
import {
  addDays,
  attributionCells,
  campaignLabel,
  campaignSub,
  channelMoves,
  channelNameProblem,
  CHANNELS_COPY,
  collectorRow,
  collectorsHref,
  collectorsParams,
  collectorsTitle,
  COLLECTORS_COPY,
  dayBars,
  destinationText,
  LINK_PAGE,
  linkUnused,
  costText,
  customProblem,
  DESTINATION_LABELS,
  DESTINATION_ORDER,
  errorField,
  HEADING_NOTES,
  LINE_LABELS,
  LINK_DIALOG,
  LINK_ERRORS,
  linkChanges,
  linkFormOf,
  linkFormProblem,
  linkInput,
  LINKS_COPY,
  LINKS_MAX_DAYS,
  linksParams,
  linksQuery,
  linksRows,
  modelLabel,
  noLinkYet,
  parisDateTime,
  parisDay,
  parseCost,
  periodRange,
  periodWords,
  phoneBlock,
  ratioText,
  releaseLabel,
  returnCell,
  siteLabel,
  VIEW_LABELS,
  WITHOUT_HEADING,
  type LinkForm,
  type LinksParams,
} from '../../src/web/admin/model/links.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { parseHash } from '../../src/web/admin/router.js';
import {
  LINK_ATTRIBUTIONS,
  LINK_DESTINATIONS,
  LINK_MEASURES,
  LINKS_VIEWS,
  type LinkChannelView,
  type LinkDestinations,
  type LinkFigureCollectors,
  type LinkFigures,
  type LinkReport,
  type LinksReport,
  type LinkView,
} from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
// Compile-time: the console reads what the server sends (services/acquisition-report.ts, services/links.ts).
export const reportFits = (r: Json<AcquisitionReport>): LinksReport => r;
export const linkReportFits = (r: Json<ServerLinkReport>): LinkReport => r;
export const collectorsFit = (r: Json<FigureCollectors>): LinkFigureCollectors => r;
export const linkFits = (l: Json<ServerLinkView>): LinkView => l;
export const channelFits = (c: Json<ChannelView>): LinkChannelView => c;
export const destinationsFit = (d: Json<ServerDestinations>): LinkDestinations => d;

const NOW = new Date('2026-10-09T09:30:00.000Z');
/** The console's figures carry thin and no-break spaces (`1 204`, `€ 6 400`): read as plain spaces here. */
const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replace(/[\u2009\u00a0\u202f]/g, ' ')) as T;
const L1 = '0b9c1e2a-1111-4c3d-8e9f-0a1b2c3d4e5f';
const L2 = '0b9c1e2a-2222-4c3d-8e9f-0a1b2c3d4e5f';
const L3 = '0b9c1e2a-3333-4c3d-8e9f-0a1b2c3d4e5f';
const IG = '7e1d0c55-aaaa-4b2e-9c1d-0e5f6a7b8c9d';
const INF = '7e1d0c55-bbbb-4b2e-9c1d-0e5f6a7b8c9d';

const figs = (visits: number, firstVisits: number, first: [number, number, number, number], last: [number, number, number, number]): LinkFigures => ({
  visits,
  firstVisits,
  first: { signups: first[0], entries: first[1], purchases: first[2], revenueMinor: first[3] },
  last: { signups: last[0], entries: last[1], purchases: last[2], revenueMinor: last[3] },
});
const zero = () => figs(0, 0, [0, 0, 0, 0], [0, 0, 0, 0]);

function link(id: string, name: string, code: string, channel: { id: string; name: string }, extra: Partial<LinkView> = {}): LinkView {
  return {
    id,
    code,
    name,
    channel,
    destination: 'COLLECTION',
    dropId: null,
    modelId: null,
    cost: null,
    note: null,
    address: `https://verify.theorbes.com/go/${code}`,
    directAddress: `https://verify.theorbes.com/verify/lookbook?o=${code}`,
    archivedAt: null,
    createdBy: { id: 'a1', email: 'camille@orbes.test' },
    createdAt: '2026-10-01T09:20:00.000Z',
    updatedAt: '2026-10-01T09:20:00.000Z',
    ...extra,
  };
}

const ret = (revenueMinor: number, costMinor: number, currency: 'EUR' | 'GBP' = 'EUR') => ({ revenueMinor, costMinor, currency, ratio: costMinor > 0 ? Math.round((revenueMinor / costMinor) * 100) / 100 : null });

function linksReport(over: Partial<LinksReport> = {}): LinksReport {
  const igc = { id: IG, name: 'Instagram' };
  const infc = { id: INF, name: 'Influencers' };
  return {
    view: 'links',
    period: { from: null, to: null },
    currency: 'EUR',
    currencies: ['EUR'],
    archived: false,
    trackingStartedAt: '2026-10-01T00:00:00.000Z',
    channels: [
      {
        channel: { id: IG, name: 'Instagram', position: 10 },
        figures: figs(1_204, 812, [12, 9, 4, 640_000], [10, 8, 3, 480_000]),
        cost: { minor: 200_000, currency: 'EUR' },
        returns: { first: ret(640_000, 200_000), last: ret(480_000, 200_000) },
        links: [
          {
            link: link(L1, 'Instagram bio', 'instagram-bio', igc, { cost: { minor: 200_000, currency: 'EUR' } }),
            sourceId: 4,
            figures: figs(1_204, 812, [12, 9, 4, 640_000], [10, 8, 3, 480_000]),
            returns: { first: ret(640_000, 200_000), last: ret(480_000, 200_000) },
          },
          { link: link(L2, 'Story 14 Oct', 'story-14', igc), sourceId: 5, figures: zero(), returns: null },
        ],
      },
      {
        channel: { id: INF, name: 'Influencers', position: 30 },
        figures: figs(300, 200, [2, 1, 1, 32_000], [3, 1, 1, 32_000]),
        cost: null,
        returns: null,
        links: [
          {
            link: link(L3, 'Léa — TikTok', 'lea-tiktok', infc, { cost: { minor: 50_000, currency: 'GBP' }, archivedAt: '2026-10-05T10:00:00.000Z' }),
            sourceId: 6,
            figures: figs(300, 200, [2, 1, 1, 32_000], [3, 1, 1, 32_000]),
            returns: { first: ret(0, 50_000, 'GBP'), last: ret(0, 50_000, 'GBP') },
          },
        ],
      },
    ],
    campaigns: [],
    sites: [],
    without: [
      { kind: 'CAMPAIGN', figures: figs(40, 30, [1, 0, 0, 0], [1, 0, 0, 0]) },
      { kind: 'SITE', figures: figs(90, 60, [2, 1, 0, 0], [1, 0, 0, 0]) },
      { kind: 'DIRECT', figures: zero() },
      { kind: 'BEFORE', figures: figs(0, 0, [5, 2, 2, -32_000], [5, 2, 2, -32_000]) },
      { kind: 'STAFF', figures: zero() },
    ],
    total: figs(1_634, 1_102, [22, 13, 7, 640_000], [20, 11, 6, 480_000]),
    ...over,
  };
}

function params(query: Record<string, string | undefined> = {}): LinksParams {
  return linksParams(query, NOW);
}

describe('the page\'s state from its address (plan CUSTOMER INTELLIGENCE §3.4 A.10.1)', () => {
  it('opens on ALL TIME and LINKS, the archived links hidden, the currency the server\'s', () => {
    expect(params()).toEqual({ period: 'all', from: null, to: null, view: 'links', archived: false, currency: null, customFrom: null, customTo: null });
    expect(linksQuery(params())).toEqual({ period: null, view: null, archived: null, currency: null, from: null, to: null });
  });

  it('reads 7, 30 and 90 days and 12 months to today in Paris, and keeps them in the address', () => {
    // 9 October 2026 09:30 UTC is 11:30 Paris; 22:30 UTC on 9 October is already the 10th in Paris.
    expect(parisDay(NOW)).toBe('2026-10-09');
    expect(parisDay(new Date('2026-10-09T22:30:00.000Z'))).toBe('2026-10-10');
    expect(params({ period: '7' })).toMatchObject({ period: '7', from: '2026-10-03', to: '2026-10-09' });
    expect(params({ period: '30' })).toMatchObject({ from: '2026-09-10', to: '2026-10-09' });
    expect(params({ period: '90' })).toMatchObject({ from: '2026-07-12', to: '2026-10-09' });
    expect(params({ period: '12m' })).toMatchObject({ from: '2025-10-10', to: '2026-10-09' });
    expect(periodRange('12m', '2028-02-29')).toEqual({ from: '2027-03-01', to: '2028-02-29' });
    expect(periodRange('all', '2026-10-09')).toBeNull();
    expect(linksQuery(params({ period: '30' }), { view: 'sites' })).toEqual({ period: '30', view: 'sites', archived: null, currency: null, from: null, to: null });
    expect(linksQuery(params(), { period: '7', archived: true, currency: 'GBP' })).toEqual({ period: '7', view: null, archived: '1', currency: 'GBP', from: null, to: null });
  });

  it('takes a CUSTOM period as the server does: both days, To not before From, at most 800 days apart', () => {
    expect(params({ period: 'custom', from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ period: 'custom', from: '2026-10-01', to: '2026-10-31', customFrom: '2026-10-01', customTo: '2026-10-31' });
    expect(linksQuery(params({ period: 'custom', from: '2026-10-01', to: '2026-10-31' }))).toMatchObject({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
    // Not given yet, or wrong: all time, CUSTOM kept so its fields show.
    for (const q of [{}, { from: '2026-10-31', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2024-01-01', to: '2026-03-12' }]) {
      expect(params({ period: 'custom', ...q }), JSON.stringify(q)).toMatchObject({ period: 'custom', from: null, to: null });
    }
    expect(LINKS_MAX_DAYS).toBe(REPORT_MAX_DAYS);
    expect(customProblem('2024-01-01', addDays('2024-01-01', 800))).toBeNull();
    expect(customProblem('2024-01-01', addDays('2024-01-01', 801))).toBe(LINKS_COPY.customProblem);
    expect(periodWords('custom', '2026-10-01', '2026-10-31')).toBe('01 OCT 2026 – 31 OCT 2026');
    expect(periodWords('30', null, null)).toBe('30 days');
    expect(periodWords('all', null, null)).toBe('all time');
  });

  it('reads anything else as the default: an unknown period, view or currency', () => {
    expect(params({ period: '14', view: 'tags', currency: 'JPY', archived: 'yes' })).toMatchObject({ period: 'all', view: 'links', currency: null, archived: false });
    expect(params({ view: 'campaigns', archived: '1', currency: 'CHF' })).toMatchObject({ view: 'campaigns', archived: true, currency: 'CHF' });
    expect([...LINKS_VIEWS]).toEqual([...REPORT_VIEWS]);
    expect([...LINK_ATTRIBUTIONS]).toEqual([...ATTRIBUTIONS]);
    expect([...LINK_MEASURES]).toEqual([...SERVER_MEASURES]);
  });
});

describe('the rows of LINKS (plan CUSTOMER INTELLIGENCE §3.4 A.10.1)', () => {
  const p = params({ period: '30' });
  const rows = linksRows(linksReport(), p);

  it('groups the links by channel in the channels\' order: the channel\'s sum, then its links, newest first as sent; then WITHOUT A LINK and the TOTAL', () => {
    expect(rows.map((r) => [r.kind, r.label])).toEqual([
      ['channel', 'INSTAGRAM'],
      ['link', 'Instagram bio'],
      ['link', 'Story 14 Oct'],
      ['channel', 'INFLUENCERS'],
      ['link', 'Léa — TikTok'],
      ['heading', 'WITHOUT A LINK'],
      ['line', 'Campaign tags'],
      ['line', 'Referring sites'],
      ['line', 'Direct'],
      ['line', 'Before tracking'],
      ['line', 'Console device'],
      ['total', 'TOTAL'],
    ]);
    const bio = rows[1]!;
    expect(bio).toMatchObject({ sub: 'verify.theorbes.com/go/instagram-bio', copy: 'https://verify.theorbes.com/go/instagram-bio', open: `#/links/${L1}`, archived: false });
    expect(rows[4]!.archived).toBe(true);
    // The lines that are a view open it; the others open nothing.
    expect(rows[6]!.open).toBe('#/links?period=30&view=campaigns');
    expect(rows[7]!.open).toBe('#/links?period=30&view=sites');
    expect(rows[8]!.open).toBeNull();
    expect(noLinkYet(linksReport())).toBe(false);
    expect(noLinkYet(linksReport({ channels: [] }))).toBe(true);
    expect(noLinkYet(linksReport({ channels: [], view: 'sites' }))).toBe(false);
  });

  it('gives each figure twice, as the first link and as the last, each opening its collectors, a zero opening nothing', () => {
    const bio = plain(rows[1]!.figures!);
    expect(bio.visits).toBe('1 204');
    expect(bio.firstVisits).toBe('812');
    expect(Object.fromEntries(Object.entries(bio.first).map(([k, v]) => [k, v.text]))).toEqual({ signups: '12', entries: '9', purchases: '4', revenue: '€ 6 400' });
    expect(Object.fromEntries(Object.entries(bio.last).map(([k, v]) => [k, v.text]))).toEqual({ signups: '10', entries: '8', purchases: '3', revenue: '€ 4 800' });
    expect(bio.first.signups.href).toBe(`#/links/collectors?source=link%3A${L1}&name=Instagram%20bio&attribution=first&measure=signups&period=30&from=2026-09-10&to=2026-10-09&currency=EUR`);
    expect(bio.last.revenue.href).toContain('attribution=last&measure=revenue');
    expect(rows[0]!.figures!.first.entries.href).toContain(`source=channel%3A${IG}`);
    expect(rows[2]!.figures!.first.signups.href).toBeNull();
    // A credit note in a later period: negative, and still opens its collectors.
    const before = plain(rows[9]!.figures!);
    expect(before.first.revenue).toEqual({ text: '−€ 320', href: expect.stringContaining('source=kind%3ABEFORE') });
    expect(rows[11]!.figures!.first.signups.href).toContain('source=total&name=all');
    // ALL TIME names no period.
    const all = linksRows(linksReport(), params());
    expect(all[1]!.figures!.first.signups.href).toBe(`#/links/collectors?source=link%3A${L1}&name=Instagram%20bio&attribution=first&measure=signups&currency=EUR`);
  });

  it('shows the return since made and the cost on LINKS only: ×3.2 with what it is made of, \'—\' without a cost, « Not in EUR », blank on the lines', () => {
    expect(plain(rows[1]!.money)).toEqual({
      returns: { first: { text: '×3.2', sub: 'Revenue € 6 400 for € 2 000' }, last: { text: '×2.4', sub: 'Revenue € 4 800 for € 2 000' } },
      cost: '€ 2 000',
    });
    expect(rows[2]!.money).toEqual({ returns: null, cost: '—' });
    expect(plain(rows[4]!.money)).toEqual({ returns: { first: { text: 'Not in EUR', sub: null }, last: { text: 'Not in EUR', sub: null } }, cost: '£ 500' });
    expect(rows[3]!.money).toEqual({ returns: null, cost: '—' });
    expect(rows[6]!.money).toBe('blank');
    expect(rows[11]!.money).toBe('blank');
    expect(returnCell(null, 'EUR')).toEqual({ text: '—', sub: null });
    expect(plain(returnCell({ revenueMinor: 0, costMinor: 0, currency: 'EUR', ratio: null }, 'EUR'))).toEqual({ text: '—', sub: 'Revenue € 0 for € 0' });
    expect([ratioText(3.2), ratioText(0), ratioText(12.35), ratioText(0.04)]).toEqual(['×3.2', '×0.0', '×12.4', '×0.0']);
  });

  it('reads the phone\'s block in order: the name and address, the visits, FIRST then LAST one per line with the return, the cost', () => {
    const b = plain(phoneBlock(rows[1]!)!);
    expect(b.label).toBe('Instagram bio');
    expect(b.sub).toBe('verify.theorbes.com/go/instagram-bio');
    expect(b.visits).toBe('Visits 1 204 · First visits 812');
    expect(b.first.map((l) => [l.label, l.cell.text])).toEqual([
      ['Sign-ups', '12'],
      ['Entries', '9'],
      ['Purchases', '4'],
      ['Revenue', '€ 6 400'],
      ['Return', '×3.2'],
    ]);
    expect(b.last.map((l) => l.label)).toEqual(['Sign-ups', 'Entries', 'Purchases', 'Revenue', 'Return']);
    expect(b.cost).toBe('Cost € 2 000');
    // A line: no return, no cost; the heading: no block.
    const line = phoneBlock(rows[8]!)!;
    expect(line.first.map((l) => l.label)).toEqual(['Sign-ups', 'Entries', 'Purchases', 'Revenue']);
    expect(line.cost).toBeNull();
    expect(phoneBlock(rows[5]!)).toBeNull();
  });
});

describe('the rows of CAMPAIGN TAGS and REFERRING SITES', () => {
  it('groups the campaigns by utm_source, each row its three tags, its one variant\'s content and term or how many it sums; no cost nor return', () => {
    const r = linksReport({
      view: 'campaigns',
      channels: [],
      campaigns: [
        {
          utmSource: 'ig',
          figures: figs(70, 50, [3, 1, 1, 9_000], [2, 1, 1, 9_000]),
          rows: [
            { source: 'ig', medium: 'story', campaign: 'drop-14', sourceIds: [11], variants: 1, content: 'story-2', term: null, figures: figs(40, 30, [2, 1, 1, 9_000], [1, 1, 1, 9_000]) },
            { source: 'ig', medium: null, campaign: 'drop-15', sourceIds: [12, 13, 14], variants: 3, content: null, term: null, figures: figs(30, 20, [1, 0, 0, 0], [1, 0, 0, 0]) },
          ],
        },
      ],
      without: [
        { kind: 'LINK', figures: zero() },
        { kind: 'SITE', figures: zero() },
        { kind: 'DIRECT', figures: zero() },
        { kind: 'BEFORE', figures: zero() },
        { kind: 'STAFF', figures: zero() },
      ],
    });
    const rows = linksRows(r, params({ view: 'campaigns' }));
    expect(rows.map((x) => [x.kind, x.label, x.sub])).toEqual([
      ['group', 'ig', null],
      ['campaign', 'ig / story / drop-14', 'content: story-2 · term: —'],
      ['campaign', 'ig / — / drop-15', '3 variants'],
      ['heading', 'WITHOUT TAGS', null],
      ['line', 'Links', null],
      ['line', 'Referring sites', null],
      ['line', 'Direct', null],
      ['line', 'Before tracking', null],
      ['line', 'Console device', null],
      ['total', 'TOTAL', null],
    ]);
    expect(rows.every((x) => x.money === undefined)).toBe(true);
    expect(rows[0]!.figures!.first.signups.href).toContain('source=source%3A11%2C12%2C13%2C14');
    expect(rows[2]!.figures!.first.signups.href).toContain('source=source%3A12%2C13%2C14');
    expect(rows[4]!.open).toBe('#/links');
    expect(phoneBlock(rows[1]!)!.cost).toBeNull();
    expect(phoneBlock(rows[1]!)!.first.map((l) => l.label)).toEqual(['Sign-ups', 'Entries', 'Purchases', 'Revenue']);
    expect(campaignSub({ variants: 1, content: null, term: null })).toBeNull();
    expect(campaignLabel({ source: null, medium: null, campaign: 'x' })).toBe('— / — / x');
  });

  it('names ORBES\'s own site, and opens no list when a campaign names too many sources for an address', () => {
    expect(siteLabel('theorbes.com')).toBe('theorbes.com (ORBES’s site)');
    expect(siteLabel('instagram.com')).toBe('instagram.com');
    const r = linksReport({ view: 'sites', channels: [], sites: [{ site: 'theorbes.com', sourceId: 21, figures: figs(9, 9, [1, 0, 0, 0], [1, 0, 0, 0]) }] });
    const rows = linksRows(r, params({ view: 'sites' }));
    expect(rows[0]).toMatchObject({ kind: 'site', label: 'theorbes.com (ORBES’s site)' });
    expect(rows[0]!.figures!.first.signups.href).toContain('source=source%3A21&name=theorbes.com');
    expect(rows[1]!.label).toBe(WITHOUT_HEADING.sites);
    const many = Array.from({ length: 60 }, (_, i) => 1_000 + i);
    expect(collectorsHref({ source: `source:${many.join(',')}`, name: 'ig' }, 'first', 'signups', params())).toBeNull();
    const cells = attributionCells(figs(1, 1, [1, 1, 1, 1], [0, 0, 0, 0]), 'first', null, params(), 'EUR');
    expect(cells.signups).toEqual({ text: '1', href: null });
  });
});

describe('New link and Edit (plan CUSTOMER INTELLIGENCE §3.4 A.10.2)', () => {
  const form = (over: Partial<LinkForm> = {}): LinkForm => ({ name: 'Instagram bio', channelId: IG, destination: 'NOW', dropId: '', modelId: '', code: 'instagram-bio', cost: '', currency: 'EUR', note: '', ...over });

  it('suggests the address from the name, -2, -3… when taken, as the server does', () => {
    expect(suggestCode('Léa — TikTok')).toBe('lea-tiktok');
    expect(freeCode('instagram-bio', (c) => new Set(['instagram-bio', 'instagram-bio-2']).has(c))).toBe('instagram-bio-3');
  });

  it('checks the form in the server\'s words, under the field each is about', () => {
    expect(linkFormProblem(form(), true)).toBeNull();
    expect(linkFormProblem(form({ name: '  ' }), true)).toEqual({ field: 'name', message: LINK_ERRORS.name });
    expect(linkFormProblem(form({ name: 'x'.repeat(81) }), true)).toEqual({ field: 'name', message: LINK_ERRORS.nameLong });
    expect(linkFormProblem(form({ channelId: '__new' }), true)?.field).toBe('channelId');
    expect(linkFormProblem(form({ destination: 'RELEASE' }), true)).toEqual({ field: 'dropId', message: LINK_ERRORS.destination });
    expect(linkFormProblem(form({ destination: 'MODEL' }), true)).toEqual({ field: 'modelId', message: LINK_ERRORS.destination });
    for (const code of ['ab', 'Instagram', '-bio', 'bio-', 'a b c', 'x'.repeat(33)]) expect(linkFormProblem(form({ code }), true), code).toEqual({ field: 'code', message: LINK_ERRORS.code });
    // Edit never sends the address.
    expect(linkFormProblem(form({ code: '' }), false)).toBeNull();
    expect(linkFormProblem(form({ cost: '20,5x' }), true)).toEqual({ field: 'cost', message: LINK_ERRORS.cost });
    expect(linkFormProblem(form({ cost: '2000', currency: 'JPY' }), true)).toEqual({ field: 'cost', message: LINK_ERRORS.cost });
  });

  it('sends what was chosen: the release or the model only for theirs, the cost in cents, a note or none', () => {
    expect(linkInput(form({ destination: 'RELEASE', dropId: 'd1', modelId: 'm1', cost: '2 000,50', currency: 'GBP', note: '  For the drop  ' }), true)).toEqual({
      name: 'Instagram bio',
      channelId: IG,
      destination: 'RELEASE',
      dropId: 'd1',
      modelId: null,
      code: 'instagram-bio',
      cost: { minor: 200_050, currency: 'GBP' },
      note: 'For the drop',
    });
    expect(linkInput(form(), false)).not.toHaveProperty('code');
    expect([parseCost('2000'), parseCost('2 000.5'), parseCost('0'), parseCost('-1'), parseCost('1.234'), parseCost('')]).toEqual([200_000, 200_050, 0, null, null, null]);
    expect([costText(200_000), costText(200_050)]).toEqual(['2000', '2000.50']);
  });

  it('sends on Edit what changed only, never the address; nothing changed, nothing sent', () => {
    const l = link(L1, 'Instagram bio', 'instagram-bio', { id: IG, name: 'Instagram' }, { cost: { minor: 200_000, currency: 'EUR' }, note: 'Bio' });
    const f = linkFormOf(l);
    expect(f).toEqual({ name: 'Instagram bio', channelId: IG, destination: 'COLLECTION', dropId: '', modelId: '', code: 'instagram-bio', cost: '2000', currency: 'EUR', note: 'Bio' });
    expect(linkChanges(l, f)).toBeNull();
    expect(linkChanges(l, { ...f, name: 'Bio', cost: '', note: '' })).toEqual({ name: 'Bio', cost: null, note: null });
    expect(linkChanges(l, { ...f, destination: 'MODEL', modelId: 'm1' })).toEqual({ destination: 'MODEL', dropId: null, modelId: 'm1' });
    expect(linkChanges(l, { ...f, code: 'other' })).toBeNull();
  });

  it('puts a refusal under the field it is about', () => {
    expect(errorField('LINK_CODE_TAKEN', 'Another link already uses this address.')).toBe('code');
    expect(errorField('VALIDATION_FAILED', LINK_ERRORS.code)).toBe('code');
    expect(errorField('VALIDATION_FAILED', LINK_ERRORS.destination)).toBe('destination');
    expect(errorField('VALIDATION_FAILED', LINK_ERRORS.cost)).toBe('cost');
    expect(errorField('VALIDATION_FAILED', 'A note is 500 characters at most.')).toBe('note');
    expect(errorField('CHANNEL_NOT_FOUND', 'Channel not found.')).toBe('channelId');
    expect(errorField('RATE_LIMITED', 'Too many requests.')).toBeNull();
  });

  it('names where a link goes: the pages, a release with its opening in Paris, a model and its variant', () => {
    expect(DESTINATION_ORDER.map((d) => DESTINATION_LABELS[d])).toEqual(['NOW', 'THE RELEASES', 'A release', 'THE COLLECTION', 'A model’s sheet', 'THE CLUB', 'HOW RELEASES WORK']);
    expect([...DESTINATION_ORDER].sort()).toEqual([...LINK_DESTINATIONS].sort());
    // 14 October 2026 18:00 UTC is 20:00 in Paris (summer time); 3 November 19:00 UTC is 20:00 (winter time).
    expect(releaseLabel({ id: 'd', title: 'MONOLITHE', mode: 'LIVE', opensAt: '2026-10-14T18:00:00.000Z', model: 'MONOLITHE' })).toBe('MONOLITHE — LIVE · 14 OCT 2026 · 20:00 Paris');
    expect(parisDateTime('2026-11-03T19:00:00.000Z')).toBe('03 NOV 2026 · 20:00 Paris');
    expect(parisDateTime(null)).toBe('—');
    expect(modelLabel({ id: 'm', name: 'MONOLITHE', variantLabel: 'Blue', variantOf: 'm0', slug: 'monolithe-blue' })).toBe('MONOLITHE · BLUE');
    expect(modelLabel({ id: 'm', name: 'Monolithe', variantLabel: null, variantOf: null, slug: 'monolithe' })).toBe('MONOLITHE');
  });
});

describe('Channels (plan CUSTOMER INTELLIGENCE §3.4 A.10.7)', () => {
  it('moves a channel up or down by writing only the places that change', () => {
    const list = [
      { id: 'a', position: 10 },
      { id: 'b', position: 20 },
      { id: 'c', position: 30 },
    ];
    expect(channelMoves(list, 'b', -1)).toEqual([
      { id: 'b', position: 10 },
      { id: 'a', position: 20 },
    ]);
    expect(channelMoves(list, 'a', -1)).toBeNull();
    expect(channelMoves(list, 'c', 1)).toBeNull();
    // Places equal (a channel added with a place of its own): every one renumbered that needs it.
    expect(channelMoves([{ id: 'a', position: 5 }, { id: 'b', position: 5 }], 'a', 1)).toEqual([
      { id: 'b', position: 10 },
      { id: 'a', position: 20 },
    ]);
  });

  it('checks a channel\'s name in the server\'s words', () => {
    expect(channelNameProblem('  ')).toBe(LINK_ERRORS.channel);
    expect(channelNameProblem('x'.repeat(41))).toBe(LINK_ERRORS.channelLong);
    expect(channelNameProblem('Press')).toBeNull();
    expect(CHANNELS_COPY.links(1)).toBe('1 link');
    expect(CHANNELS_COPY.links(12)).toBe('12 links');
  });
});

describe('who reads and who acts, and where (plan CUSTOMER INTELLIGENCE §3.4 A.10)', () => {
  it('lets AUDITOR and up read Links, OPERATOR and up make and change links; never RETAIL nor LOGISTICS', () => {
    expect(CAPABILITY_MIN_ROLE.readLinks).toBe('AUDITOR');
    expect(CAPABILITY_MIN_ROLE.manageLinks).toBe('OPERATOR');
    for (const role of ['RETAIL', 'LOGISTICS'] as const) {
      expect(can(role, 'readLinks'), role).toBe(false);
      expect(can(role, 'manageLinks'), role).toBe(false);
    }
    expect(can('AUDITOR', 'readLinks')).toBe(true);
    expect(can('AUDITOR', 'manageLinks')).toBe(false);
    expect(can('OPERATOR', 'manageLinks')).toBe(true);
  });

  it('routes #/links, a link\'s page and the collectors behind a figure', () => {
    expect(parseHash('#/links?period=30').name).toBe('links');
    expect(parseHash('#/links/collectors?source=total&attribution=first&measure=signups').name).toBe('linkCollectors');
    expect(parseHash(`#/links/${L1}`)).toMatchObject({ name: 'link', params: { linkId: L1 } });
  });

  it('writes calmly: no exclamation mark, no atelier, handmade or craft, never « product »', () => {
    const words = JSON.stringify([LINKS_COPY, LINK_DIALOG, LINK_ERRORS, CHANNELS_COPY, HEADING_NOTES, LINE_LABELS, VIEW_LABELS, WITHOUT_HEADING, DESTINATION_LABELS, COLLECTORS_COPY]) + [LINKS_COPY, LINK_PAGE].flatMap((o) => Object.values(o)).filter((x) => typeof x === 'function').map((f) => (f as (...a: string[]) => string)('1', '2')).join(' ');
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|hand-made|craft|product/i);
  });
});

describe('a link\'s page and the collectors behind a figure (plan CUSTOMER INTELLIGENCE §3.4 A.10.3, A.10.4; step 4.9)', () => {
  const destinations: LinkDestinations = {
    releases: [{ id: 'd1', title: 'MONOLITHE', mode: 'LIVE', opensAt: '2026-10-14T18:00:00.000Z', model: 'MONOLITHE' }],
    models: [{ id: 'm1', name: 'MONOLITHE', variantLabel: 'Blue', variantOf: 'm0', slug: 'monolithe-blue' }],
  };

  it('says where the link goes: a page, a release with its opening, a model\'s variant', () => {
    const ig = { id: IG, name: 'Instagram' };
    expect(destinationText(link(L1, 'x', 'xyz', ig, { destination: 'RELEASE', dropId: 'd1' }), destinations)).toBe('MONOLITHE — LIVE · 14 OCT 2026 · 20:00 Paris');
    expect(destinationText(link(L1, 'x', 'xyz', ig, { destination: 'MODEL', modelId: 'm1' }), destinations)).toBe('MONOLITHE · BLUE');
    expect(destinationText(link(L1, 'x', 'xyz', ig, { destination: 'CLUB' }), null)).toBe('THE CLUB');
    expect(destinationText(link(L1, 'x', 'xyz', ig, { destination: 'RELEASE', dropId: 'gone' }), destinations)).toBe('A release');
    expect(LINK_PAGE.goesTo('THE CLUB')).toBe('Goes to THE CLUB');
    expect(LINK_PAGE.gone).toBe('Goes to a release that no longer exists: it opens THE RELEASES.');
    expect(LINK_PAGE.made('camille@orbes.test', parisDateTime('2026-10-09T09:20:00.000Z'))).toBe('Made by camille@orbes.test on 09 OCT 2026 · 11:20 Paris');
    expect(LINK_PAGE.crumb('Instagram bio')).toBe('Clients · Links · Instagram bio');
  });

  it('opens a figure of a link\'s page on its collectors, the way back to the link kept', () => {
    const href = collectorsHref({ source: `link:${L1}`, name: 'Instagram bio' }, 'last', 'purchases', params({ period: '7' }), { linkId: L1 });
    expect(href).toBe(`#/links/collectors?source=link%3A${L1}&name=Instagram%20bio&attribution=last&measure=purchases&period=7&from=2026-10-03&to=2026-10-09&link=${L1}`);
    const q = collectorsParams(parseHash(href!).query, NOW)!;
    expect(q).toEqual({ source: `link:${L1}`, name: 'Instagram bio', attribution: 'last', measure: 'purchases', period: '7', from: '2026-10-03', to: '2026-10-09', currency: null, page: 1, linkId: L1 });
    expect(collectorsTitle(q)).toBe('Purchases through Instagram bio · last link · 7 days');
    expect(collectorsParams({}, NOW)).toBeNull();
    expect(collectorsParams({ source: 'total', attribution: 'x', measure: 'y', page: '3', link: 'nope' }, NOW)).toMatchObject({ attribution: 'first', measure: 'signups', page: 3, linkId: null, period: 'all' });
  });

  it('titles a list by its figure: through a link, a site or a tag; a line; the TOTAL; a CUSTOM period', () => {
    const base = { attribution: 'first' as const, measure: 'signups' as const, period: '30' as const, from: '2026-09-10', to: '2026-10-09' };
    expect(collectorsTitle({ ...base, source: `link:${L1}`, name: 'Instagram bio' })).toBe('Sign-ups through Instagram bio · first link · 30 days');
    expect(collectorsTitle({ ...base, source: 'source:21', name: 'instagram.com', measure: 'purchases' })).toBe('Purchases through instagram.com · first link · 30 days');
    expect(collectorsTitle({ ...base, source: 'kind:DIRECT', name: 'Direct' })).toBe('Sign-ups · Direct · first link · 30 days');
    expect(collectorsTitle({ ...base, source: 'kind:CAMPAIGN', name: 'Campaign tags' })).toBe('Sign-ups through Campaign tags · first link · 30 days');
    expect(collectorsTitle({ ...base, source: 'total', name: 'all', attribution: 'last', measure: 'revenue', period: 'all' })).toBe('Revenue · All · last link · all time');
    expect(collectorsTitle({ ...base, source: 'total', name: 'all', period: 'custom', from: '2026-10-01', to: '2026-10-31' })).toBe('Sign-ups · All · first link · 01 OCT 2026 – 31 OCT 2026');
  });

  it('lists a collector with its country, its sign-up day and its figures in the period, opening the client sheet', () => {
    expect(plain(collectorRow({ accountId: 'a1', email: 'c***@example.com', country: null, signedUpAt: '2026-10-02T10:00:00.000Z', entries: 2, purchases: 1, revenueMinor: -32_000 }, 'EUR'))).toEqual({
      link: '#/owners/a1',
      email: 'c***@example.com',
      country: '—',
      signedUp: '02 OCT 2026',
      entries: '2',
      purchases: '1',
      revenue: '−€ 320',
    });
    expect(COLLECTORS_COPY.empty).toBe('No collector for this figure in these days.');
  });

  it('knows a link that has brought nothing yet', () => {
    expect(linkUnused({ figures: zero() })).toBe(true);
    expect(linkUnused({ figures: figs(1, 0, [0, 0, 0, 0], [0, 0, 0, 0]) })).toBe(false);
    expect(linkUnused({ figures: figs(0, 0, [0, 0, 0, 0], [0, 0, 0, -1]) })).toBe(false);
  });

  it('draws By day: every Paris day of the period, 0 included, its sign-ups first and last; weeks from their Monday beyond 90 days', () => {
    const days = [
      { day: '2026-10-07', visits: 4, firstVisits: 3, signupsFirst: 1, signupsLast: 0 },
      { day: '2026-10-09', visits: 2, firstVisits: 1, signupsFirst: 0, signupsLast: 1 },
    ];
    const week = dayBars(days, { from: '2026-10-03', to: '2026-10-09' }, '2026-10-09');
    expect(week.weeks).toBe(false);
    expect(week.bars.map((b) => [b.label, b.value, b.share, b.fraction])).toEqual([
      ['03 OCT 2026', 0, '0 · 0', 0],
      ['04 OCT 2026', 0, '0 · 0', 0],
      ['05 OCT 2026', 0, '0 · 0', 0],
      ['06 OCT 2026', 0, '0 · 0', 0],
      ['07 OCT 2026', 4, '1 · 0', 1],
      ['08 OCT 2026', 0, '0 · 0', 0],
      ['09 OCT 2026', 2, '0 · 1', 0.5],
    ]);
    // All time: from the first day with any, to today.
    expect(dayBars(days, { from: null, to: null }, '2026-10-10').bars.map((b) => b.key)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
    expect(dayBars([], { from: null, to: null }, '2026-10-10').bars.map((b) => b.value)).toEqual([0]);
    // 12 months: weeks, each from its Monday (5 October 2026 is a Monday).
    const year = dayBars(days, { from: '2025-10-10', to: '2026-10-09' }, '2026-10-09');
    expect(year.weeks).toBe(true);
    expect(year.bars.length).toBeLessThanOrEqual(54);
    expect(year.bars.at(-1)).toMatchObject({ key: '2026-10-05', label: 'Week of 05 OCT 2026', value: 6, share: '1 · 1' });
  });
});
