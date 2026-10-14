/**
 * The Collectors page, `#/collectors` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6; steps 9.2 and 9.9), under
 * Clients after Owners, for AUDITOR and up (`readCollectors`): the counted collectors' figures over the period chosen,
 * compared with the period before, from GET /api/admin/collectors/report (one panel a reading).
 *
 *   - The controls (§3.6 C.6.2), all kept in the route's query so a view can be reloaded and shared: the period (LAST 7,
 *     30, 90 DAYS, LAST 12 MONTHS, CUSTOM From and To), Compare with the previous period, the scope (ALL · ACTIVE IN THE
 *     PERIOD · NEW IN THE PERIOD) and the five filters (Country, Source, Tier, Score from … to …, Favourite piece), Clear
 *     filters; on the right « Read at 14:02 » and Read again. A choice whose address would pass 512 characters is refused
 *     before it is applied. Under the bar, the view in words. Under 600 px the filters fold into « Filters (3) », opened
 *     as a sheet.
 *   - The panels, top to bottom, each a section that loads on its own (two readings at once from the page, the server's
 *     load guard allowing two), says so with Try again when it cannot be read, the rest of the page standing; a new choice
 *     cancels those still loading. Every figure is a link to its collectors (`#/collectors/list`, step 9.11), with an
 *     `aria-label` such as « Open the 312 collectors in France »; a 0 opens nothing, and an AUDITOR's city bars open
 *     nothing (§3.0 (h)).
 *   - At a glance (six KPIs) and Who they are (AGES · COUNTRIES · CITIES, as given and from the connection), with the
 *     comparison's words (model/collectors.ts).
 *
 * The console's house style: white paper, ink, hairlines; `.range`, `.kpi`, `.bars` and `.table`, no new look. Text
 * through h() only (CSP-safe).
 */
import { h, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { formatCount, formatDate } from '../format.js';
import { countryName } from '../model/analytics.js';
import {
  AGE_LABELS,
  barCompare,
  clearedFilters,
  collectorsApiQuery,
  collectorsHref,
  collectorsParams,
  COLLECTORS_PAGE_COPY as C,
  DEVICES_COPY,
  ENGAGEMENT_PANEL_COPY,
  ORIGIN_COPY,
  TRENDS_COPY,
  compareWords,
  CONTROLS_COPY as K,
  countryRowLabel,
  customProblem,
  filterCount,
  KPI_LABELS,
  listHref,
  openLabel,
  OVERVIEW_COPY,
  PANEL_COPY,
  PERIOD_TABS,
  periodTabWords,
  readAtWords,
  recordingNote,
  scoreRange,
  SCOPE_LABELS,
  shareOf,
  SOURCE_KIND_LABELS,
  TIER_LABELS,
  TIER_ORDER,
  toggled,
  tooManyChoices,
  typeWords,
  viewWords,
  whoWhat,
  WHO_CITIES_SHOWN,
  WHO_COPY,
  WITHHELD,
  type CollectorsParams,
  type CompareWords,
  type Reader,
} from '../model/collectors.js';
import { LIKES_COPY } from '../model/likes.js';
import { parisDay } from '../model/links.js';
import { COLLECTOR_PERIODS, COLLECTOR_SCOPES, type CollectorBar, type CollectorCityBar, type CollectorPanel, type CollectorsOptions, type CollectorsReport, type CollectorsQuery } from '../types.js';
import { button, checkbox, emptyState, field, input, pageHeader } from '../ui/components.js';
import { devicesPanel, engagementPanel, likesPanel, originPanel, trendsPanel } from './collectors-panels.js';
import { compareBlock, figureLink, noMatch, nodes, panelBars, panelLine, panelTabs, type PanelBar, type PanelCtx } from './collectors-parts.js';
import type { ViewContext } from './context.js';

// ── At a glance ──────────────────────────────────────────────────────────────────────────────────────────────────

function kpiBlock(key: string, label: string, value: string, link: string | null, aria: string, cmp: CompareWords | null, note: string | null): HTMLElement {
  return h(
    'div',
    { class: ['kpi', 'collectors__kpi'], data: { key } },
    h('p', { class: 'kpi__label' }, label),
    link ? h('a', { class: ['kpi__value', 'collectors__kpi-link'], attrs: { href: link, 'aria-label': aria, 'data-testid': 'collectors-figure' } }, value) : h('p', { class: 'kpi__value' }, value),
    cmp ? h('p', { class: ['kpi__note', 'collectors__change'] }, cmp.change) : null,
    cmp?.before ? h('p', { class: ['kpi__note', 'collectors__before'] }, cmp.before) : null,
    note ? h('p', { class: 'kpi__note' }, note) : null,
  );
}

function overviewPanel(pc: PanelCtx, r: Extract<CollectorsReport, { panel: 'overview' }>): Child[] {
  const f = r.figures;
  const p = pc.p;
  const cmp = (k: { value: number | null; previous: number | null }, points = false) => (r.previous ? compareWords(k.value, k.previous, { points }) : null);
  const num = (v: number | null) => (v === null ? '—' : formatCount(v));
  const today = parisDay(pc.ctx.now());
  const scoresOn = f.medianScore.scoresOn && f.medianScore.scoresOn !== today ? OVERVIEW_COPY.scoresOf(f.medianScore.scoresOn) : null;
  const median = f.medianScore.value === null ? '—' : formatCount(f.medianScore.value);
  const withheld = f.medianScore.value === null && f.medianScore.scored > 0 ? WITHHELD : null;
  const kpis = [
    kpiBlock('collectors', KPI_LABELS.collectors, num(f.collectors.value), listHref(p, 'all', f.collectors.value ?? 0), openLabel(f.collectors.value ?? 0, 'of this view'), cmp(f.collectors), null),
    kpiBlock('newCollectors', KPI_LABELS.newCollectors, num(f.newCollectors.value), listHref(p, 'new', f.newCollectors.value ?? 0), openLabel(f.newCollectors.value ?? 0, 'who signed up in the period'), cmp(f.newCollectors), null),
    kpiBlock(
      'firstVisits',
      KPI_LABELS.firstVisits,
      num(f.firstVisits.value),
      listHref(p, 'firstvisit', f.firstVisits.becameCollectors),
      openLabel(f.firstVisits.becameCollectors, 'whose first visit fell in the period'),
      cmp(f.firstVisits),
      OVERVIEW_COPY.became(f.firstVisits.becameCollectors),
    ),
    kpiBlock('active', KPI_LABELS.active, num(f.active.value), listHref(p, 'active', f.active.value ?? 0), openLabel(f.active.value ?? 0, 'active in the period'), cmp(f.active), null),
    kpiBlock(
      'medianScore',
      KPI_LABELS.medianScore,
      median,
      listHref(p, 'scored', f.medianScore.scored),
      openLabel(f.medianScore.scored, 'with a score'),
      f.medianScore.value === null ? null : cmp(f.medianScore, true),
      [withheld, OVERVIEW_COPY.scored(f.medianScore.scored), scoresOn].filter(Boolean).join(' · '),
    ),
    kpiBlock(
      'wishesAdded',
      KPI_LABELS.wishesAdded,
      num(f.wishesAdded.value),
      listHref(p, 'wished', f.wishesAdded.collectors),
      openLabel(f.wishesAdded.collectors, 'who added a wish in the period'),
      cmp(f.wishesAdded),
      OVERVIEW_COPY.by(f.wishesAdded.collectors),
    ),
  ];
  return [
    (f.collectors.value ?? 0) === 0 && filterCount(p) > 0 ? noMatch(pc) : null,
    h('div', { class: ['kpis', 'collectors__kpis'], data: { testid: 'collectors-kpis' } }, ...kpis),
    panelLine(recordingNote(r.recordingSince, r.period, r.previous), 'collectors-recording'),
  ];
}

// ── Who they are ─────────────────────────────────────────────────────────────────────────────────────────────────

type WhoTab = 'ages' | 'countries' | 'cities';
type Side = 'given' | 'connection';

function whoPanel(pc: PanelCtx, r: Extract<CollectorsReport, { panel: 'who' }>): Child[] {
  const f = r.figures;
  if (f.total === 0) return [noMatch(pc)];
  const body = h('div', { class: 'collectors__tab-body' });
  let tab: WhoTab = 'ages';
  let side: Side = 'given';
  let all = false;
  const bar = (dim: 'age' | 'country' | 'conncountry' | 'city' | 'conncity', row: CollectorBar | CollectorCityBar, label: string): ReturnType<typeof barOf> => barOf(pc, r, dim, row, label);
  const draw = () => {
    const tabs = panelTabs<WhoTab>(WHO_COPY.title, [
      { key: 'ages', text: WHO_COPY.tabs.ages },
      { key: 'countries', text: WHO_COPY.tabs.countries },
      { key: 'cities', text: WHO_COPY.tabs.cities },
    ], tab, (k) => {
      tab = k;
      all = false;
      draw();
    }, 'collectors-who-tabs');
    const sides = panelTabs<Side>(WHO_COPY.title, [
      { key: 'given', text: WHO_COPY.switch.given },
      { key: 'connection', text: WHO_COPY.switch.connection },
    ], side, (k) => {
      side = k;
      all = false;
      draw();
    }, 'collectors-who-side');
    const content: Child[] = [];
    if (tab === 'ages') {
      content.push(panelBars(f.ages.rows.map((row) => bar('age', row, AGE_LABELS[row.key as keyof typeof AGE_LABELS] ?? row.key)), f.total, 'collectors-ages'));
      content.push(panelLine(WHO_COPY.agesNote(f.ages.median), 'collectors-ages-note'));
    } else if (tab === 'countries') {
      const rows = side === 'given' ? f.countries.given : f.countries.connection;
      content.push(sides, panelBars(rows.map((row) => bar(side === 'given' ? 'country' : 'conncountry', row, countryRowLabel(row.key))), f.total, 'collectors-countries'));
      if (side === 'connection') content.push(panelLine(WHO_COPY.connection));
    } else {
      const block = side === 'given' ? f.cities.given : f.cities.connection;
      const named = block.rows.filter((x) => x.key !== 'none' && x.key !== 'unknown');
      const rest = block.rows.filter((x) => x.key === 'none' || x.key === 'unknown');
      const shown = all ? named : named.slice(0, WHO_CITIES_SHOWN);
      const label = (row: CollectorCityBar) =>
        row.key === 'none' ? WHO_COPY.notGiven : row.key === 'unknown' ? WHO_COPY.unknown : side === 'connection' && row.country ? `${row.label ?? row.key} · ${countryName(row.country)}` : (row.label ?? row.key);
      content.push(sides, panelBars([...shown, ...rest].map((row) => bar(side === 'given' ? 'city' : 'conncity', row, label(row))), f.total, 'collectors-cities'));
      if (!all && block.groups > WHO_CITIES_SHOWN) {
        content.push(
          button(WHO_COPY.showAll(block.groups), {
            kind: 'ghost',
            testId: 'collectors-cities-all',
            onClick: () => {
              all = true;
              draw();
            },
          }),
        );
      }
      if (!pc.reader.withCities) content.push(panelLine(WHO_COPY.citiesWithheld));
      if (side === 'connection') content.push(panelLine(WHO_COPY.connection), panelLine(WHO_COPY.dbip, 'collectors-dbip'));
    }
    body.replaceChildren(tabs, ...nodes(content));
  };
  draw();
  return [body];
}

/** A who bar: its words, its comparison and its link (no city for an AUDITOR). */
function barOf(pc: PanelCtx, r: CollectorsReport, dim: 'age' | 'country' | 'conncountry' | 'city' | 'conncity', row: CollectorBar | CollectorCityBar, label: string): PanelBar {
  const cityLabel = 'label' in row ? row.label : null;
  const name = dim === 'city' && row.key !== 'none' ? cityLabel : null;
  return {
    key: row.key,
    label,
    n: row.collectors,
    compare: barCompare(row.compare, r.compareBy),
    link: listHref(pc.p, `${dim}:${row.key}`, row.collectors, { reader: pc.reader, name }),
    aria: openLabel(row.collectors, whoWhat(dim, row.key, cityLabel)),
  };
}

// ── The panels ───────────────────────────────────────────────────────────────────────────────────────────────────

type Drawer = (pc: PanelCtx, r: CollectorsReport) => Child[];

/** The panels, top to bottom (§3.6 C.6.3), with their titles. */
export const PANELS: readonly { panel: CollectorPanel; title: string; draw: Drawer }[] = [
  { panel: 'overview', title: OVERVIEW_COPY.title, draw: (pc, r) => overviewPanel(pc, r as Extract<CollectorsReport, { panel: 'overview' }>) },
  { panel: 'who', title: WHO_COPY.title, draw: (pc, r) => whoPanel(pc, r as Extract<CollectorsReport, { panel: 'who' }>) },
  { panel: 'origin', title: ORIGIN_COPY.title, draw: (pc, r) => originPanel(pc, r as Extract<CollectorsReport, { panel: 'origin' }>) },
  { panel: 'likes', title: LIKES_COPY.title, draw: (pc, r) => likesPanel(pc, r as Extract<CollectorsReport, { panel: 'likes' }>) },
  { panel: 'devices', title: DEVICES_COPY.title, draw: (pc, r) => devicesPanel(pc, r as Extract<CollectorsReport, { panel: 'devices' }>) },
  { panel: 'engagement', title: ENGAGEMENT_PANEL_COPY.title, draw: (pc, r) => engagementPanel(pc, r as Extract<CollectorsReport, { panel: 'engagement' }>) },
  { panel: 'trends', title: TRENDS_COPY.title, draw: (pc, r) => trendsPanel(pc, r as Extract<CollectorsReport, { panel: 'trends' }>) },
];

/** At most `n` readings at once from the page (the server's load guard reads two at a time). */
function limiter(n: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>) => {
    if (running >= n) await new Promise<void>((go) => waiting.push(go));
    running += 1;
    try {
      return await fn();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

// ── The controls ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A multi-select of checkboxes under its name and how many are chosen (`Country · 2`). */
function picker(name: string, testid: string, choices: { value: string; label: string; checked: boolean }[], onToggle: (value: string, on: boolean, box: HTMLInputElement) => void): HTMLElement {
  const chosen = choices.filter((c) => c.checked).length;
  const list = h(
    'div',
    { class: 'collectors__choices' },
    ...(choices.length
      ? choices.map((c) => {
          const box = checkbox(`${testid}-${c.value}`, c.label, c.checked);
          const input = box.querySelector('input')!;
          input.value = c.value;
          input.addEventListener('change', () => onToggle(c.value, input.checked, input));
          return box;
        })
      : [h('p', { class: 'micro soft' }, K.noChoice)]),
  );
  return h('details', { class: 'collectors__pick', data: { testid } }, h('summary', { class: 'collectors__pick-name' }, chosen ? `${name} · ${chosen}` : name), list);
}

function periodControls(pc: PanelCtx, apply: (q: Partial<CollectorsParams>) => boolean): HTMLElement {
  const { p } = pc;
  const tabs = h(
    'nav',
    { class: ['range', 'collectors__periods'], attrs: { 'aria-label': K.period } },
    ...COLLECTOR_PERIODS.flatMap((x, i) => {
      const t = PERIOD_TABS[x];
      const text: Child[] = t.figure ? [t.words.split(' ')[0]!, ' ', h('span', { class: 'range__figure' }, t.figure), ` ${t.words.split(' ').slice(1).join(' ')}`] : [t.words];
      const target = x === 'custom' ? collectorsHref(p, { p: 'custom', from: p.from ?? periodStart(pc), to: p.to ?? parisDay(pc.ctx.now()) }) : collectorsHref(p, { p: x, from: null, to: null });
      return [
        i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
        h('a', { class: 'range__tab', attrs: { href: target, 'aria-current': x === p.p ? 'page' : null, 'aria-label': periodTabWords(x), 'data-testid': `collectors-period-${x}` } }, ...text),
      ];
    }),
  );
  if (p.p !== 'custom') return tabs;
  const from = input('from', { type: 'date', value: p.from ?? '' });
  const to = input('to', { type: 'date', value: p.to ?? '' });
  const problem = h('p', { class: 'collectors__problem', attrs: { role: 'alert' } });
  const form = h('form', { class: ['filters', 'collectors__custom'], attrs: { novalidate: true, 'data-testid': 'collectors-custom' } }, field(K.from, from), field(K.to, to), button(K.apply, { kind: 'secondary', type: 'submit' }), problem);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const bad = customProblem(from.value, to.value, parisDay(pc.ctx.now()));
    problem.textContent = bad ?? '';
    if (!bad) apply({ p: 'custom', from: from.value, to: to.value });
  });
  return h('div', { class: 'collectors__period' }, tabs, form);
}

/** CUSTOM opened from another period starts with that period's first day. */
function periodStart(pc: PanelCtx): string {
  const d = new Date(pc.ctx.now().getTime());
  const days = pc.p.p === '7d' ? 6 : pc.p.p === '90d' ? 89 : pc.p.p === '12m' ? 364 : 29;
  const today = parisDay(d);
  const t = new Date(`${today}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() - days);
  const from = t.toISOString().slice(0, 10);
  return from < '2026-01-01' ? '2026-01-01' : from;
}

function controls(pc: PanelCtx, problem: HTMLElement): HTMLElement {
  const { p, options } = pc;
  /** Applies a choice; false (and the words) when its address would pass 512 characters. */
  const apply = (q: Partial<CollectorsParams>): boolean => {
    const target = collectorsHref(p, q);
    if (tooManyChoices(target)) {
      problem.textContent = K.tooMany;
      return false;
    }
    problem.textContent = '';
    pc.ctx.navigate(target);
    return true;
  };
  const list = <T extends string | number>(key: 'c' | 's' | 't' | 'ft', parse: (v: string) => T) => (value: string, on: boolean, box: HTMLInputElement) => {
    const now = p[key] as unknown as T[];
    if (!apply({ [key]: toggled(now, parse(value), on) } as Partial<CollectorsParams>)) box.checked = !on;
  };

  const compare = checkbox('cmp', K.compare, p.cmp);
  compare.setAttribute('data-testid', 'collectors-compare');
  const cmpBox = compare.querySelector('input')!;
  cmpBox.addEventListener('change', () => apply({ cmp: cmpBox.checked }));

  const scope = h(
    'nav',
    { class: ['range', 'collectors__scope'], attrs: { 'aria-label': K.scope } },
    ...COLLECTOR_SCOPES.flatMap((x, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: collectorsHref(p, { scope: x }), 'aria-current': x === p.scope ? 'page' : null, 'data-testid': `collectors-scope-${x}` } }, SCOPE_LABELS[x]),
    ]),
  );

  const countries = [...new Set([...(options?.countries ?? []), ...p.c])].sort();
  const country = picker(K.country, 'collectors-country', countries.map((x) => ({ value: x, label: `${x} · ${countryName(x)}`, checked: p.c.includes(x) })), list('c', (v) => v));
  const sources = [
    ...(options?.channels ?? []).map((c) => ({ value: c.id, label: c.name })),
    ...(options?.sourceKinds ?? []).map((k) => ({ value: `kind:${k}`, label: SOURCE_KIND_LABELS[k] })),
  ];
  const source = picker(K.source, 'collectors-source', sources.map((x) => ({ ...x, checked: p.s.includes(x.value) })), list('s', (v) => v));
  const tier = picker(K.tier, 'collectors-tier', TIER_ORDER.map((t) => ({ value: String(t), label: TIER_LABELS[t]!, checked: p.t.includes(t) })), list('t', Number));
  tier.querySelector('.collectors__choices')!.append(h('p', { class: 'micro soft' }, K.tierHint));
  const types = [...(options?.types ?? []).map((x) => x.key), ...p.ft.filter((k) => !(options?.types ?? []).some((x) => x.key === k))];
  const favourite = picker(K.favourite, 'collectors-favourite', types.map((k) => ({ value: k, label: typeWords(k, options), checked: p.ft.includes(k) })), list('ft', (v) => v));

  const scFrom = input('scFrom', { type: 'number', min: 0, max: 100, step: 1, inputmode: 'numeric', value: p.sc ? String(p.sc.min) : '' });
  const scTo = input('scTo', { type: 'number', min: 0, max: 100, step: 1, inputmode: 'numeric', value: p.sc ? String(p.sc.max) : '' });
  scFrom.setAttribute('aria-label', `${K.score} ${K.scoreFrom}`);
  scTo.setAttribute('aria-label', `${K.score} ${K.scoreTo}`);
  const scoreForm = h(
    'form',
    { class: 'collectors__score', attrs: { novalidate: true, 'data-testid': 'collectors-score' } },
    h('span', { class: 'collectors__pick-name' }, K.score),
    scFrom,
    h('span', { class: 'micro soft' }, K.scoreTo.toLowerCase()),
    scTo,
    button(K.scoreApply, { kind: 'ghost', type: 'submit' }),
  );
  scoreForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const range = scoreRange(scFrom.value, scTo.value);
    if (typeof range === 'string') {
      problem.textContent = range;
      return;
    }
    apply({ sc: range });
  });

  const n = filterCount(p);
  const filters = h(
    'div',
    { class: 'collectors__filters', data: { testid: 'collectors-filters' } },
    country,
    source,
    tier,
    scoreForm,
    favourite,
    n > 0 ? button(K.clear, { kind: 'ghost', testId: 'collectors-clear', onClick: () => apply(clearedFilters(p)) }) : null,
    button(K.done, { kind: 'secondary', testId: 'collectors-filters-done', onClick: () => filters.classList.remove('is-open') }),
  );
  const fold = button(n ? `${K.filters} (${n})` : K.filters, { kind: 'secondary', testId: 'collectors-filters-fold', onClick: () => filters.classList.toggle('is-open') });
  fold.classList.add('collectors__fold');
  fold.setAttribute('aria-expanded', 'false');
  fold.addEventListener('click', () => fold.setAttribute('aria-expanded', String(filters.classList.contains('is-open'))));

  return h(
    'div',
    { class: 'collectors__controls', data: { testid: 'collectors-controls' } },
    periodControls(pc, apply),
    h('div', { class: 'collectors__bar' }, scope, compare, fold),
    filters,
    problem,
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The panels still loading of the page shown last: a new choice (a navigation) cancels them. */
let loadingPanels: AbortController | null = null;

export async function collectorsView(ctx: ViewContext): Promise<HTMLElement> {
  loadingPanels?.abort();
  const cancel = new AbortController();
  loadingPanels = cancel;
  window.addEventListener('hashchange', () => cancel.abort(), { once: true });

  const p = collectorsParams(ctx.route.query, ctx.now());
  let options: CollectorsOptions | null = null;
  try {
    options = await ctx.api.collectorsOptions();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
  }
  const reader: Reader = { withCities: ctx.session.admin.role !== 'AUDITOR' };
  const problem = h('p', { class: 'collectors__problem', attrs: { role: 'alert' }, data: { testid: 'collectors-problem' } });
  const readAt = h('span', { class: 'collectors__read-at', data: { testid: 'collectors-read-at' } }, K.readAt);
  const slow = limiter(2);
  let earliest: number | null = null;
  const seen = (at: string) => {
    const t = Date.parse(at);
    if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
    if (earliest !== null) readAt.textContent = readAtWords(new Date(earliest));
  };

  const loaders: ((fresh: boolean) => void)[] = [];
  const sections = PANELS.map((def) => {
    const body = h('div', { class: 'panel__body' });
    const el = h(
      'section',
      { class: ['panel', 'collectors__panel', `collectors__panel--${def.panel}`], id: `collectors-${def.panel}`, data: { testid: `collectors-panel-${def.panel}` } },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, def.title)),
      body,
    );
    let extra: Pick<CollectorsQuery, 'figure' | 'split' | 'currency'> = {};
    const load = (fresh: boolean) => {
      body.replaceChildren(h('div', { class: 'loading', attrs: { role: 'status' } }, h('span', { class: 'loading__orbit', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'loading__text' }, PANEL_COPY.loading)));
      el.setAttribute('aria-busy', 'true');
      void slow(() => ctx.api.collectorsReport(def.panel, collectorsApiQuery(p, extra), { fresh, signal: cancel.signal }))
        .then((r) => {
          if (cancel.signal.aborted) return;
          seen(r.readAt);
          const pc: PanelCtx = {
            ctx,
            p,
            options,
            reader,
            reload: (x = {}) => {
              extra = { ...extra, ...x };
              load(false);
            },
            clear: () => ctx.navigate(collectorsHref(clearedFilters(p))),
          };
          body.replaceChildren(...nodes(def.draw(pc, r)));
        })
        .catch((e: unknown) => {
          if (cancel.signal.aborted || (e instanceof ApiError && e.code === 'ABORTED')) return;
          const message = e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : e instanceof ApiError && (e.code === 'INSIGHTS_BUSY' || e.code === 'INSIGHTS_TIMEOUT') ? e.message : PANEL_COPY.failed;
          body.replaceChildren(
            h('div', { class: 'collectors__failed', attrs: { role: 'alert' }, data: { testid: 'collectors-failed' } }, emptyState(message), button(PANEL_COPY.tryAgain, { kind: 'secondary', onClick: () => load(true) })),
          );
        })
        .finally(() => el.removeAttribute('aria-busy'));
    };
    loaders.push(load);
    return el;
  });

  const again = button(K.readAgain, {
    kind: 'ghost',
    testId: 'collectors-read-again',
    onClick: () => {
      earliest = null;
      readAt.textContent = K.readAt;
      for (const load of loaders) load(true);
    },
  });
  const pc: PanelCtx = { ctx, p, options, reader, reload: () => undefined, clear: () => ctx.navigate(collectorsHref(clearedFilters(p))) };
  const view = h(
    'div',
    { class: ['view', 'view--collectors'], data: { testid: 'collectors' } },
    pageHeader({ eyebrow: C.eyebrow, title: C.title, lead: C.lead, actions: [h('span', { class: 'collectors__reading' }, readAt, h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }), again)] }),
    controls(pc, problem),
    h('p', { class: 'collectors__words', data: { testid: 'collectors-words' } }, viewWords(p, options, ctx.now())),
    ...sections,
    h('p', { class: 'footnote' }, `${C.growthTeam} ${C.parisMonths}`),
  );
  for (const load of loaders) load(false);
  return view;
}
