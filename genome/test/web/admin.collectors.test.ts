/**
 * The Collectors page in the console (plan CUSTOMER INTELLIGENCE §3.6 C.6.1, C.13 « admin.collectors.test.ts »; step
 * 9.2's shell, the model's helpers with steps 9.9 and on): who reads it, where it is routed, its words.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLLECTORS_PAGE_COPY, EXPORT_COPY, exportBody, exportDone, exportQuery } from '../../src/web/admin/model/collectors.js';
import { can, CAPABILITY_MIN_ROLE } from '../../src/web/admin/model/permissions.js';
import { parseHash } from '../../src/web/admin/router.js';

describe('the Collectors page (§3.6 C.6.1)', () => {
  it('is read from AUDITOR; never by RETAIL nor LOGISTICS', () => {
    expect(CAPABILITY_MIN_ROLE.readCollectors).toBe('AUDITOR');
    for (const role of ['RETAIL', 'LOGISTICS'] as const) expect(can(role, 'readCollectors'), role).toBe(false);
    for (const role of ['AUDITOR', 'OPERATOR', 'ADMIN'] as const) expect(can(role, 'readCollectors'), role).toBe(true);
  });

  it('Export (CSV) is an ADMIN\'s only (§3.6 C.7): its words, and its query the five filters alone', () => {
    expect(CAPABILITY_MIN_ROLE.exportCollectors).toBe('ADMIN');
    for (const role of ['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR'] as const) expect(can(role, 'exportCollectors'), role).toBe(false);
    expect(can('ADMIN', 'exportCollectors')).toBe(true);
    expect(EXPORT_COPY).toEqual({ button: 'Export (CSV)', title: 'Export the collectors', confirm: 'Export', working: 'Exporting…' });
    const lead = 'One row per collector, with everything held: profile, tastes, wishlist, where they came from, devices, places, the score and its parts, and what they looked at.';
    const tail = 'The file is made now and is not kept on the server. The export is recorded in the audit log.';
    expect(exportBody(1204)).toBe(`${lead} Only the five filters of the page apply: 1\u2009204 collectors. ${tail}`);
    expect(exportBody(1)).toBe(`${lead} Only the five filters of the page apply: 1 collector. ${tail}`);
    expect(exportBody(null)).toBe(`${lead} Only the five filters of the page apply. ${tail}`);
    expect(exportDone(1204)).toBe('Exported 1\u2009204 collectors.');
    expect(exportDone(1)).toBe('Exported 1 collector.');
    expect(exportQuery(DEFAULT_PARAMS)).toEqual({});
    expect(
      exportQuery({ ...DEFAULT_PARAMS, p: 'custom', from: '2026-09-01', to: '2026-09-30', cmp: false, scope: 'new', c: ['IT', 'FR'], s: ['kind:SITE'], t: [3, 0], sc: { min: 40, max: 100 }, ft: ['RING'] }),
    ).toEqual({ c: 'FR,IT', s: 'kind:SITE', t: '0,3', sc: '40-100', ft: 'RING' });
  });

  it('is routed at #/collectors, its query kept', () => {
    expect(parseHash('#/collectors?p=7d&c=FR')).toMatchObject({ name: 'collectors', query: { p: '7d', c: 'FR' } });
  });

  it('sits under Clients right after Owners in the sidebar', () => {
    const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/web/admin/main.ts'), 'utf8');
    const clients = main.slice(main.indexOf("group: 'Clients'"), main.indexOf("group: 'Security'"));
    const routes = [...clients.matchAll(/route: '(\w+)'/g)].map((m) => m[1]);
    expect(routes.slice(0, 4)).toEqual(['messages', 'owners', 'collectors', 'club']);
    expect(clients).toContain("{ route: 'collectors', label: 'Collectors', cap: 'readCollectors' }");
  });

  it('writes the plan’s header and notes, calmly', () => {
    expect(COLLECTORS_PAGE_COPY).toMatchObject({
      eyebrow: 'Clients',
      title: 'Collectors',
      lead: 'Who the collectors are, where they come from, what they like, the devices they use and how engaged they are, over the period you choose. Every figure opens its collectors. Test entrants and the team’s own accounts are left out.',
      growthTeam: 'GROWTH still counts the team’s accounts.',
      parisMonths: 'Months are Paris months; GROWTH counts UTC months.',
    });
    const words = JSON.stringify(COLLECTORS_PAGE_COPY);
    expect(words).not.toContain('!');
    expect(words).not.toMatch(/atelier|handmade|craft|product/i);
  });
});

// ── Step 9.9: the query, the view in words, the comparisons, the links (model/collectors.ts) ──────────────────────

import {
  AGE_LABELS,
  barCompare,
  clearedFilters,
  collectorsApiQuery,
  collectorsHref,
  collectorsParams,
  collectorsRouteQuery,
  compareWords,
  CONTROLS_COPY,
  countryRowLabel,
  customProblem,
  DEFAULT_PARAMS,
  filterCount,
  listHref,
  newWords,
  openLabel,
  periodDays,
  periodTabWords,
  rangeWords,
  readAtWords,
  recordingNote,
  scoreRange,
  toggled,
  tooManyChoices,
  viewWords,
  WHO_COPY,
  whoWhat,
} from '../../src/web/admin/model/collectors.js';
import * as server from '../../src/server/services/insights-scope.js';
import { COLLECTOR_AGE_SLICES, COLLECTOR_PERIODS, COLLECTOR_SCOPES, COLLECTOR_SOURCE_KINDS, COLLECTOR_PANELS as CONSOLE_PANELS, COLLECTOR_SCORE_SLICES, COLLECTOR_SLICE_DIMENSIONS, COLLECTOR_STATUSES, TREND_FIGURES as CONSOLE_FIGURES, TREND_SPLITS as CONSOLE_SPLITS } from '../../src/web/admin/types.js';
import { COLLECTOR_PANELS, ENGAGEMENT_STATUSES, SCORE_SLICES, SLICE_DIMENSIONS, TREND_FIGURES, TREND_SPLITS, parseSlice } from '../../src/server/services/collector-insights.js';

const NOW = new Date('2026-10-14T12:00:00.000Z'); // 14:00 Paris
const OPTIONS = {
  channels: [{ id: '0f6c2a52-6d0c-4b8e-9e7f-0b2a4c9d1e11', name: 'Instagram' }],
  types: [
    { key: 'RING', label: 'Rings' },
    { key: 'CUFF', label: 'Cuffs' },
  ],
};

describe('the Collectors page’s mirrors (§3.6 C.6, step 9.9)', () => {
  it('mirror the server’s lists word for word', () => {
    expect([...COLLECTOR_PERIODS]).toEqual([...server.PERIOD_KEYS]);
    expect([...COLLECTOR_SCOPES]).toEqual([...server.SCOPES]);
    expect([...COLLECTOR_SOURCE_KINDS]).toEqual([...server.SOURCE_FILTER_KINDS]);
    expect([...COLLECTOR_AGE_SLICES]).toEqual([...server.AGE_SLICES]);
    expect([...CONSOLE_PANELS]).toEqual([...COLLECTOR_PANELS]);
    expect([...COLLECTOR_SCORE_SLICES]).toEqual([...SCORE_SLICES]);
    expect([...COLLECTOR_STATUSES]).toEqual([...ENGAGEMENT_STATUSES]);
    expect([...COLLECTOR_SLICE_DIMENSIONS]).toEqual([...SLICE_DIMENSIONS]);
    expect([...CONSOLE_FIGURES]).toEqual([...TREND_FIGURES]);
    expect([...CONSOLE_SPLITS]).toEqual([...TREND_SPLITS]);
  });

  it('routes the list of collectors at #/collectors/list, its query kept', () => {
    expect(parseHash('#/collectors/list?slice=country%3AFR&p=7d')).toMatchObject({ name: 'collectorsList', query: { slice: 'country:FR', p: '7d' } });
  });
});

describe('the Collectors page’s query (§3.6 C.6.2)', () => {
  it('reads the defaults from an empty address: 30 days, compared, every collector, no filter', () => {
    expect(collectorsParams({}, NOW)).toEqual(DEFAULT_PARAMS);
    expect(collectorsHref(DEFAULT_PARAMS)).toBe('#/collectors');
  });

  it('reads every control from the address and writes it back the same, the lists sorted and once', () => {
    const q = { p: '7d', cmp: '0', scope: 'active', c: 'it,FR,FR', s: `kind:SITE,${OPTIONS.channels[0]!.id}`, t: '3,0', sc: '40-100', ft: 'RING,CUFF' };
    const p = collectorsParams(q, NOW);
    expect(p).toEqual({ p: '7d', from: null, to: null, cmp: false, scope: 'active', c: ['FR', 'IT'], s: [OPTIONS.channels[0]!.id, 'kind:SITE'], t: [0, 3], sc: { min: 40, max: 100 }, ft: ['CUFF', 'RING'] });
    expect(collectorsRouteQuery(p)).toEqual({ p: '7d', from: null, to: null, cmp: '0', scope: 'active', c: 'FR,IT', s: `${OPTIONS.channels[0]!.id},kind:SITE`, t: '0,3', sc: '40-100', ft: 'CUFF,RING' });
    expect(collectorsParams(parseHash(collectorsHref(p)).query, NOW)).toEqual(p);
    // What the routes read: the same values, the comparison written only when off.
    expect(collectorsApiQuery(p, { figure: 'active' })).toEqual({ p: '7d', cmp: false, scope: 'active', c: 'FR,IT', s: `${OPTIONS.channels[0]!.id},kind:SITE`, t: '0,3', sc: '40-100', ft: 'CUFF,RING', figure: 'active' });
    expect(collectorsApiQuery(DEFAULT_PARAMS)).toEqual({ p: '30d', scope: 'all' });
  });

  it('reads what the server would refuse as the default', () => {
    const p = collectorsParams({ p: 'week', scope: 'everyone', c: 'France,F1', s: 'kind:LINK,instagram', t: '4,x,2', sc: '90-40', ft: 'x'.repeat(65) }, NOW);
    expect(p).toEqual({ ...DEFAULT_PARAMS, t: [2] });
    expect(collectorsParams({ sc: '0-101' }, NOW).sc).toBeNull();
  });

  it('keeps CUSTOM only with two days from 1 Jan 2026 to today, at most 731 days apart', () => {
    expect(collectorsParams({ p: 'custom', from: '2026-03-01', to: '2026-03-31' }, NOW)).toMatchObject({ p: 'custom', from: '2026-03-01', to: '2026-03-31' });
    for (const [from, to] of [
      ['2025-12-31', '2026-03-31'],
      ['2026-03-31', '2026-03-01'],
      ['2026-03-01', '2026-10-15'],
      ['2026-02-30', '2026-03-01'],
    ]) {
      expect(customProblem(from!, to!, '2026-10-14'), `${from} ${to}`).toBe('Choose dates from 1 Jan 2026 to today, at most two years apart.');
      expect(collectorsParams({ p: 'custom', from, to }, NOW).p).toBe('30d');
    }
    expect(customProblem('2026-01-01', '2028-01-02', '2028-01-02')).toBeNull(); // 731 days apart
    expect(customProblem('2026-01-01', '2028-01-03', '2028-01-03')).not.toBeNull();
    expect(collectorsRouteQuery(DEFAULT_PARAMS, { p: 'custom', from: '2026-03-01', to: '2026-03-31' })).toMatchObject({ p: 'custom', from: '2026-03-01', to: '2026-03-31' });
    // Another period drops the dates.
    expect(collectorsRouteQuery({ ...DEFAULT_PARAMS, p: 'custom', from: '2026-03-01', to: '2026-03-31' }, { p: '90d' })).toMatchObject({ p: '90d', from: null, to: null });
  });

  it('refuses a view whose address passes the route’s 512 characters', () => {
    const one = collectorsHref({ ...DEFAULT_PARAMS, c: ['FR'] });
    expect(tooManyChoices(one)).toBe(false);
    const many = collectorsHref({ ...DEFAULT_PARAMS, s: Array.from({ length: 14 }, (_, i) => `0f6c2a52-6d0c-4b8e-9e7f-0b2a4c9d1e${String(i).padStart(2, '0')}`) });
    expect(many.length).toBeGreaterThan(512);
    expect(tooManyChoices(many)).toBe(true);
    expect(CONTROLS_COPY.tooMany).toBe('Too many choices for one view: remove one.');
  });

  it('reads back every channel of the Source filter the address holds: the first boot’s seven in, seven out, up to the 512 characters', () => {
    const uuid = (i: number) => `0f6c2a52-6d0c-4b8e-9e7f-0b2a4c9d1e${String(i).padStart(2, '0')}`;
    for (const n of [4, 5, 6, 7]) {
      const p = { ...DEFAULT_PARAMS, s: Array.from({ length: n }, (_, i) => uuid(i)) };
      const hash = collectorsHref(p);
      expect(tooManyChoices(hash), `${n}`).toBe(false);
      expect(collectorsParams(parseHash(hash).query, NOW).s, `${n}`).toEqual(p.s);
      // The list behind a figure reads the same filters.
      expect(listParams(parseHash(hash.replace('#/collectors?', '#/collectors/list?slice=country%3AFR&')).query, NOW).s, `${n} list`).toEqual(p.s);
    }
    // Countries and favourite pieces too: every value up to what fits in the route.
    const wide = { ...DEFAULT_PARAMS, c: ['AT', 'BE', 'CH', 'DE', 'ES', 'FR', 'GB', 'IT', 'JP', 'NL', 'PT', 'SE', 'US'], s: Array.from({ length: 7 }, (_, i) => uuid(i)), ft: ['BRACELET', 'CUFF', 'EARRING', 'NECKLACE', 'PENDANT', 'RING', 'SIGNET RING'] };
    expect(tooManyChoices(collectorsHref(wide))).toBe(false);
    expect(collectorsParams(parseHash(collectorsHref(wide)).query, NOW)).toEqual(wide);
    // A choice past the 512 is still refused.
    const past = { ...wide, s: Array.from({ length: 14 }, (_, i) => uuid(i)) };
    expect(tooManyChoices(collectorsHref(past))).toBe(true);
    // Every other route keeps its 200 characters a value.
    expect(parseHash(`#/owners?q=${'z'.repeat(300)}`).query.q).toHaveLength(200);
  });

  it('counts the filters set, clears them alone, and ticks a choice', () => {
    const p = { ...DEFAULT_PARAMS, p: '7d' as const, scope: 'new' as const, c: ['FR', 'IT'], t: [2], sc: { min: 40, max: 100 } };
    expect(filterCount(p)).toBe(3);
    expect(clearedFilters(p)).toEqual({ ...DEFAULT_PARAMS, p: '7d', scope: 'new' });
    expect(toggled(['FR'], 'IT', true)).toEqual(['FR', 'IT']);
    expect(toggled(['FR', 'IT'], 'FR', false)).toEqual(['IT']);
  });

  it('reads a score range from From and To', () => {
    expect(scoreRange('', '')).toBeNull();
    expect(scoreRange('40', '')).toEqual({ min: 40, max: 100 });
    expect(scoreRange('', '30')).toEqual({ min: 0, max: 30 });
    for (const [a, b] of [['50', '40'], ['-1', '10'], ['10', '101'], ['4.5', '9']]) expect(scoreRange(a!, b!), `${a}-${b}`).toBe('A score from 0 to 100, the first not above the second.');
  });
});

describe('the view in words (§3.6 C.6.2)', () => {
  it('says the collectors, the filters and the period with the one it is compared with', () => {
    const p = collectorsParams({ c: 'FR,IT', s: OPTIONS.channels[0]!.id, t: '2', sc: '40-100', ft: 'RING' }, NOW);
    expect(viewWords(p, OPTIONS, NOW)).toBe('Collectors in France or Italy · first came from Instagram · PLATINE · score 40 to 100 · favourite piece Rings. Last 30 days, 15 SEP to 14 OCT 2026, compared with 16 AUG to 14 SEP 2026.');
    expect(viewWords(DEFAULT_PARAMS, OPTIONS, NOW)).toBe('All collectors. Last 30 days, 15 SEP to 14 OCT 2026, compared with 16 AUG to 14 SEP 2026.');
    expect(viewWords({ ...DEFAULT_PARAMS, p: '12m', cmp: false, scope: 'new', s: ['kind:BEFORE', 'kind:DIRECT'] }, OPTIONS, NOW)).toBe('Collectors new in the period · first came from Before tracking or Direct. Last 12 months, 15 OCT 2025 to 14 OCT 2026.');
    expect(viewWords({ ...DEFAULT_PARAMS, p: 'custom', from: '2026-03-01', to: '2026-03-31', scope: 'active', t: [0, 3] }, OPTIONS, NOW)).toBe('Collectors active in the period · NO TIER or PALLADIUM. From 01 MAR to 31 MAR 2026, compared with 29 JAN to 28 FEB 2026.');
  });

  it('counts the periods in Paris days, as the server does', () => {
    const now = new Date('2026-10-14T22:30:00.000Z'); // already 15 Oct in Paris
    for (const key of ['7d', '30d', '90d', '12m'] as const) {
      const s = server.parisPeriod({ p: key }, now);
      const b = server.previousPeriod(s);
      expect(periodDays({ p: key, from: null, to: null }, now), key).toEqual({ from: s.from, to: s.to, previous: { from: b.from, to: b.to } });
    }
    expect(rangeWords('2026-10-14', '2026-10-14')).toBe('14 OCT 2026');
    expect(rangeWords('2025-12-30', '2026-01-02')).toBe('30 DEC 2025 to 02 JAN 2026');
    expect(periodTabWords('30d')).toBe('LAST 30 DAYS');
    expect(periodTabWords('12m')).toBe('LAST 12 MONTHS');
    expect(readAtWords('2026-10-14T12:02:30.000Z')).toBe('Read at 14:02');
  });
});

describe('the comparisons (§3.6 C.6.3)', () => {
  it('reads a change against the previous period, a percentage only on 3 collectors or more on both sides', () => {
    expect(compareWords(1204, 1118)).toEqual({ change: '+86 (+8%)', before: '1\u2009118 before' });
    expect(compareWords(90, 100)).toEqual({ change: '−10 (−10%)', before: '100 before' });
    expect(compareWords(12, 0)).toEqual({ change: 'new', before: null });
    expect(compareWords(0, 0)).toEqual({ change: '—', before: null });
    expect(compareWords(2, 5)).toEqual({ change: '−3', before: '5 before' });
    expect(compareWords(5, 2)).toEqual({ change: '+3', before: '2 before' });
    expect(compareWords(0, 4)).toEqual({ change: '−4', before: '4 before' });
    expect(compareWords(5, 5)).toEqual({ change: '0 (0%)', before: '5 before' });
    expect(compareWords(5, null)).toBeNull();
    expect(compareWords(null, 5)).toBeNull();
    // A median score: in points, never a percentage.
    expect(compareWords(54, 51, { points: true })).toEqual({ change: '+3', before: '51 before' });
    expect(compareWords(54, 0, { points: true })).toEqual({ change: '+54', before: '0 before' });
  });

  it('reads a stock with the scope ALL as new in each period', () => {
    expect(newWords(42, 31)).toEqual({ change: '+42 new', before: '31 before' });
    expect(newWords(0, 0)).toEqual({ change: '—', before: null });
    expect(barCompare({ now: 42, before: 31 }, 'NEW')).toEqual({ change: '+42 new', before: '31 before' });
    expect(barCompare({ now: 312, before: 300 }, 'SCOPE')).toEqual({ change: '+12 (+4%)', before: '300 before' });
    expect(barCompare(null, 'NEW')).toBeNull();
    expect(barCompare({ now: 1, before: 1 }, null)).toBeNull();
  });

  it('says the recording’s start where the figures need it', () => {
    const since = '2026-10-01T10:00:00.000Z';
    expect(recordingNote(null, { from: '2026-09-15', to: '2026-10-14' }, null)).toBeNull();
    expect(recordingNote(since, { from: '2026-08-01', to: '2026-08-31' }, null)).toBe('Nothing recorded yet: visits are recorded since 01 OCT 2026.');
    expect(recordingNote(since, { from: '2026-09-15', to: '2026-10-14' }, null)).toBe('Nothing recorded before 01 OCT 2026.');
    expect(recordingNote(since, { from: '2026-10-08', to: '2026-10-14' }, { from: '2026-10-01' })).toBeNull();
    expect(recordingNote(since, { from: '2026-10-08', to: '2026-10-14' }, { from: '2026-09-30' })).toBe('Not comparable: recording started on 01 OCT 2026.');
  });
});

describe('every figure opens its collectors (§3.6 C.6.5)', () => {
  const p = collectorsParams({ p: '7d', c: 'FR' }, NOW);

  it('links a figure to the list with the page’s query and its slice, a 0 to nothing', () => {
    const link = listHref(p, 'country:FR', 312)!;
    expect(parseHash(link)).toMatchObject({ name: 'collectorsList', query: { p: '7d', c: 'FR', slice: 'country:FR' } });
    expect(listHref(p, 'country:FR', 0)).toBeNull();
    expect(openLabel(312, whoWhat('country', 'FR', null))).toBe('Open the 312 collectors in France');
    expect(openLabel(1, whoWhat('age', '25-34', null))).toBe('Open the 1 collector aged 25–34');
    // Every slice a figure of At a glance and Who they are opens is one the server reads.
    for (const slice of ['all', 'new', 'firstvisit', 'active', 'scored', 'wished', 'age:25-34', 'age:none', 'country:FR', 'country:none', 'conncountry:IT', 'conncountry:unknown', 'city:lyon', 'city:none', 'conncity:12', 'conncity:unknown']) {
      expect(() => parseSlice(slice), slice).not.toThrow();
    }
  });

  it('never opens a city for an AUDITOR, whose list the server refuses (§3.0 (h))', () => {
    expect(listHref(p, 'city:lyon', 4, { reader: { withCities: false }, name: 'Lyon' })).toBeNull();
    expect(listHref(p, 'conncity:12', 4, { reader: { withCities: false } })).toBeNull();
    expect(listHref(p, 'country:FR', 4, { reader: { withCities: false } })).not.toBeNull();
    expect(parseHash(listHref(p, 'city:lyon', 4, { reader: { withCities: true }, name: 'Lyon' })!).query).toMatchObject({ slice: 'city:lyon', name: 'Lyon' });
  });

  it('shows a figure without a link when its address would pass 512 characters', () => {
    expect(listHref(p, `campaign:${'x'.repeat(200)}`, 3)).not.toBeNull();
    const long = { ...p, s: Array.from({ length: 12 }, (_, i) => `0f6c2a52-6d0c-4b8e-9e7f-0b2a4c9d1e${String(i).padStart(2, '0')}`) };
    expect(listHref(long, `campaign:${'x'.repeat(200)}`, 3)).toBeNull();
  });

  it('names the age bands, the countries and the cities', () => {
    expect(Object.values(AGE_LABELS)).toEqual(['Under 18', '18–24', '25–34', '35–44', '45–54', '55–64', '65 and over', 'Not given']);
    expect(countryRowLabel('FR')).toBe('FR · France');
    expect(countryRowLabel('none')).toBe('Not given');
    expect(countryRowLabel('unknown')).toBe('Unknown');
    expect(WHO_COPY.agesNote(31)).toBe('Age today, from the date of birth the client entered. Median: 31.');
    expect(WHO_COPY.showAll(143)).toBe('Show all 143');
    expect(whoWhat('city', 'lyon', 'Lyon')).toBe('in Lyon');
    expect(whoWhat('conncity', '12', 'Lyon')).toBe('connecting from Lyon');
  });
});

// ── Step 9.10: the panels' words and the slices their figures open ───────────────────────────────────────────────

import {
  becameWords,
  bucketWords,
  cohortWords,
  differWords,
  groupWords,
  monthWords,
  partWords,
  sourceBarLabel,
  SYSTEM_LABELS,
  SYSTEM_ORDER,
  trendSlice,
  TREND_FIGURE_LABELS,
  TREND_SPLIT_LABELS,
} from '../../src/web/admin/model/collectors.js';

describe('the panels’ words (§3.6 C.6.3, step 9.10)', () => {
  it('says the first visits, the first and last sources, the parts and the cohorts', () => {
    expect(becameWords(12, 150)).toBe('12 first visits became collectors (8%).');
    expect(becameWords(0, 1)).toBe('0 first visit became collectors (0%).');
    expect(differWords({ collectors: 12, differ: 3 })).toBe('3 of the 12 collectors who signed up in the period came last through another source than their first (25%).');
    expect(sourceBarLabel({ kind: 'LINK', channel: { name: 'Instagram' } })).toBe('Instagram');
    expect(sourceBarLabel({ kind: 'BEFORE', channel: null })).toBe('Before tracking');
    expect(bucketWords({ from: '2026-09-07', to: '2026-09-13' })).toBe('07 SEP to 13 SEP 2026');
    expect(partWords(12.44, 25)).toBe('12.4 / 25');
    expect(partWords(null, 25)).toBe('Fewer than 3 collectors');
    expect(cohortWords({ active: 5, share: 42 })).toBe('42% · 5');
    expect(cohortWords({ active: null, share: null })).toBe('—');
    expect(monthWords('2026-03')).toBe('March 2026');
    expect(monthWords('2026-03-01')).toBe('March 2026');
  });

  it('names every figure and split of Over time, and their groups', () => {
    expect(TREND_FIGURES.map((f) => TREND_FIGURE_LABELS[f])).toEqual(['Collectors', 'New collectors', 'First visits', 'Active collectors', 'Median score', 'Wishes added', 'Views of models', 'Buyers']);
    expect(TREND_SPLITS.map((s) => TREND_SPLIT_LABELS[s])).toEqual(['Nothing', 'Country', 'Source', 'Tier', 'Age', 'Device']);
    expect(groupWords('country', 'FR', OPTIONS)).toBe('FR · France');
    expect(groupWords('source', `channel:${OPTIONS.channels[0]!.id}`, OPTIONS)).toBe('Instagram');
    expect(groupWords('source', 'kind:DIRECT', OPTIONS)).toBe('Direct');
    expect(groupWords('tier', '2', OPTIONS)).toBe('PLATINE');
    expect(groupWords('age', '65plus', OPTIONS)).toBe('65 and over');
    expect(groupWords('device', 'PHONE', OPTIONS)).toBe('Phone');
    expect(groupWords('device', 'unknown', OPTIONS)).toBe('No view recorded');
    expect(groupWords('age', 'other', OPTIONS)).toBe('Other');
    expect(groupWords('age', 'visitor', OPTIONS)).toBe('No collector');
    expect(SYSTEM_ORDER.map((k) => SYSTEM_LABELS[k])).toEqual(['iPhone', 'iPad', 'Android', 'Mac', 'Windows', 'ChromeOS', 'Linux', 'Other']);
  });

  it('opens slices the server reads, a trend point’s group never on the previous line', () => {
    expect(trendSlice('active', '2026-W37')).toBe('bucket:trend:active:2026-W37');
    expect(trendSlice('active', '2026-W37', { group: 'FR' })).toBe('bucket:trend:active:2026-W37:FR');
    expect(trendSlice('active', '2026-W37', { previous: true, group: 'FR' })).toBe('bucket:trend:active:prev:2026-W37');
    expect(trendSlice('active', '2026-09', { group: 'all' })).toBe('bucket:trend:active:2026-09');
    const id = OPTIONS.channels[0]!.id;
    for (const slice of [
      trendSlice('buyers', '2026-09-14', { group: 'kind:SITE' }),
      trendSlice('new', '2026-09', { previous: true }),
      `source:channel:${id}`,
      'source:kind:BEFORE',
      'heard:none',
      'heardother',
      `link1:${id}`,
      `link2:${id}`,
      'campaign:none',
      'referrer:instagram.com',
      'referrer:none',
      'bucket:firstvisit:2026-09-14',
      'bucket:signup:prev:2026-W37',
      'favpiece:RING',
      'favfinish:none',
      'haswish',
      `wishmodel:${id}`,
      `wishcollection:${id}`,
      `viewed:${id}`,
      `viewed:r:${id}`,
      `holds:${id}`,
      'device:PHONE',
      'system:IPAD',
      'openedin:IN_APP',
      'app:INSTAGRAM',
      'score:90-100',
      'score:none',
      'part:spend',
      'status:never',
      'cohort:2026-03:all',
      'cohort:2026-03:3:active',
    ]) {
      expect(() => parseSlice(slice), slice).not.toThrow();
    }
  });
});

// ── Step 9.11: the collectors behind a figure ────────────────────────────────────────────────────────────────────

import { bucketKeyWords, joinedText, LIST_COPY, listParams, listTitle, tierWords } from '../../src/web/admin/model/collectors.js';

describe('the list of the collectors behind a figure (§3.6 C.6.5, step 9.11)', () => {
  const t = (slice: string, subject: string | null = null, o: { name?: string; split?: string } = {}) => listTitle({ slice, name: o.name ?? null, figure: null, split: o.split ?? null }, subject, OPTIONS, '2026-10-14');

  it('reads its address: the page’s query, the slice, the title’s name, the page', () => {
    const l = listParams({ p: '7d', c: 'FR', slice: 'country:FR', page: '3', figure: 'active', split: 'tier' }, NOW);
    expect(l).toMatchObject({ p: '7d', c: ['FR'], slice: 'country:FR', page: 3, figure: 'active', split: 'tier', name: null });
    expect(listParams({ slice: 'all', page: 'x' }, NOW).page).toBe(1);
    // Back to the figures: the page with the same query.
    expect(collectorsHref(l)).toBe('#/collectors?p=7d&c=FR');
  });

  it('names the figure without ranking anyone, as the plan words it', () => {
    expect(t('country:FR')).toBe('Country: France');
    expect(t('score:60-69')).toBe('Score 60 to 69');
    expect(t('part:spend')).toBe('Spend: the collectors with a score');
    expect(t(`link1:${OPTIONS.channels[0]!.id}`, 'Instagram bio')).toBe('Came through Instagram bio (first link)');
    expect(t(`link2:${OPTIONS.channels[0]!.id}`, 'Instagram bio')).toBe('Came through Instagram bio (last link)');
    expect(t('cohort:2026-03:3:active')).toBe('Active after 3 months, March 2026');
    expect(t('cohort:2026-03:1:inactive')).toBe('Not active after 1 month, March 2026');
    expect(t('cohort:2026-03:all')).toBe('Signed up in March 2026');
    expect(t(`wishmodel:${OPTIONS.channels[0]!.id}`, 'MONOLITHE · Blue')).toBe('Wish for MONOLITHE · Blue on 14 OCT 2026');
    expect(t(`wishcollection:${OPTIONS.channels[0]!.id}`, 'ORBITAL')).toBe('Wish for a model of ORBITAL on 14 OCT 2026');
    expect(t('city:lyon', null, { name: 'Lyon' })).toBe('City: Lyon');
    expect(t('source:kind:SITE')).toBe('First came from Referring sites');
    expect(t('age:25-34')).toBe('Age: 25–34');
    expect(t('favpiece:RING')).toBe('Favourite piece: Rings');
    expect(t('system:IPAD')).toBe('Main system: iPad');
    expect(t('status:dormant')).toBe('Dormant on 14 OCT 2026');
    expect(t('bucket:firstvisit:2026-09-14')).toBe('First visit in 14 SEP 2026');
    expect(t('bucket:signup:prev:2026-W37')).toBe('Signed up in week 37 of 2026, the period before');
    expect(t('bucket:trend:active:2026-09:FR', null, { split: 'country' })).toBe('Active collectors, September 2026 · FR · France');
    expect(t('nothing')).toBe(LIST_COPY.unknown);
    expect(bucketKeyWords('2026-W02')).toBe('week 2 of 2026');
    expect(tierWords(0)).toBe('—');
    expect(tierWords(3)).toBe('PALLADIUM');
    expect(LIST_COPY).toMatchObject({ back: 'Back to the figures', note: 'Read now: a figure read a few minutes ago may differ by a few.', empty: 'No collector in this figure now.' });
  });

  it('writes a row\'s Joined as the Paris day, as the page counts days', () => {
    // 30 September 22:30 UTC is 1 October 00:30 in Paris: NEW IN THE PERIOD of a period from 1 October, and joined then.
    expect(joinedText('2026-09-30T22:30:00.000Z')).toBe('01 OCT 2026');
    expect(joinedText('2026-12-31T23:30:00.000Z')).toBe('01 JAN 2027');
    expect(joinedText('2026-10-14T09:00:00.000Z')).toBe('14 OCT 2026');
  });
});

// ── Review RI2: the panels' tabs and switches by keyboard, the focus kept across a redraw ──────────────────────────────

import { focusMark, tabStep } from '../../src/web/admin/views/collectors-parts.js';
import { LIKES_COPY } from '../../src/web/admin/model/likes.js';

describe('the panels\' tabs by keyboard and the focus across a redraw (review RI2)', () => {
  it('Left and Right move to the next tab, wrapping; Home and End to the ends; any other key none', () => {
    expect([tabStep('ArrowRight', 0, 3), tabStep('ArrowRight', 2, 3), tabStep('ArrowLeft', 0, 3), tabStep('ArrowLeft', 2, 3)]).toEqual([1, 0, 2, 1]);
    expect([tabStep('Home', 2, 3), tabStep('End', 0, 3)]).toEqual([0, 2]);
    expect([tabStep('Enter', 0, 3), tabStep('ArrowDown', 0, 3), tabStep('ArrowRight', 0, 0)]).toEqual([null, null, null]);
  });

  /** A plain element stub: its attributes, its parent's nearest test id, and how many of a test id the root holds. */
  const el = (attrs: Record<string, string>, group: string | null = null) => ({
    getAttribute: (k: string) => attrs[k] ?? null,
    parentElement: { closest: () => (group ? { getAttribute: () => group } : null) },
  });
  const root = (counts: Record<string, number>) => ({ querySelectorAll: (sel: string) => ({ length: counts[sel] ?? 0 }) });

  it('finds a focused control again by its switch and key, its own test id when unique, or its name', () => {
    const r = root({ '[data-testid="collectors-trend-split"]': 1, '[data-testid="collectors-figure"]': 9 });
    expect(focusMark(el({ 'data-key': 'cities' }, 'collectors-who-tabs') as unknown as Element, r as unknown as ParentNode)).toBe('[data-testid="collectors-who-tabs"] [data-key="cities"]');
    expect(focusMark(el({ 'data-testid': 'collectors-trend-split' }) as unknown as Element, r as unknown as ParentNode)).toBe('[data-testid="collectors-trend-split"]');
    expect(focusMark(el({ name: 'cmp' }) as unknown as Element, r as unknown as ParentNode)).toBe('[name="cmp"]');
    // A figure's link (one of many): not found again, never the wrong one.
    expect(focusMark(el({ 'data-testid': 'collectors-figure' }) as unknown as Element, r as unknown as ParentNode)).toBeNull();
    expect(focusMark(null, r as unknown as ParentNode)).toBeNull();
    expect(focusMark(el({ name: 'say "x"' }) as unknown as Element, r as unknown as ParentNode)).toBe('[name="say \\"x\\""]');
  });

  it('names each switch apart for screen readers, and MOST WISHED\'s columns', () => {
    const names = [WHO_COPY.title, WHO_COPY.sidesLabel, LIKES_COPY.title, ...Object.values(LIKES_COPY.switches)];
    expect(new Set(names).size).toBe(names.length);
    expect(LIKES_COPY.columns).toMatchObject({ rank: 'Rank', shareOfMost: 'Share of the most wished' });
  });
});
