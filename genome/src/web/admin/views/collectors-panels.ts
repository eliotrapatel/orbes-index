/**
 * The Collectors page's panels after Who they are (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6.3 items 3 to 7,
 * §3.2 W.8, §3.3 T.4.2; step 9.10), each drawn from its reading of GET /api/admin/collectors/report:
 *
 *   origin      Where they come from: SOURCES · HOW THEY HEARD · LINKS · CAMPAIGNS · REFERRING SITES · FIRST VISITS, and
 *               how many collectors came last through another source than their first.
 *   likes       What they like: the Wishlists figures, then FAVOURITE PIECES · FINISHES · MOST WISHED (MODELS ·
 *               COLLECTIONS, each row's 'Wished' opening who wishes for it, question 16) · MOST VIEWED (MODELS · RELEASES,
 *               COLLECTORS · ALL VISITORS) · PIECES HELD.
 *   devices     Devices: BY COLLECTORS · BY VISITS · ALL DEVICES, each with DEVICE, SYSTEM, OPENED IN (and inside which
 *               app) and BROWSERS; only BY COLLECTORS opens collectors (a visit or a device is not a collector).
 *   engagement  Engagement: SCORE SPREAD with the month kept beside it pale, THE FIVE PARTS, ACTIVE AND DORMANT, MONTHLY
 *               COHORTS.
 *   trends      Over time: a Figure and a Split by, the line over the period with the previous period's pale, and every
 *               point in a table, each a link to its collectors.
 *
 * Every figure that counts collectors is a link to them (`listHref`), with its aria-label; a 0 opens nothing; counts of
 * wishes, views, visits and devices open nothing. Charts are drawn aria-hidden; their figures are in the tables beside
 * them. Text through h() and s() only (CSP-safe); the look is the console's (`.range`, `.bars`, `.table`).
 */
import { h, s, type Child } from '../../shared/dom.js';
import { formatCount, formatDate } from '../format.js';
import {
  barCompare,
  becameWords,
  BROWSER_LABELS,
  bucketWords,
  cohortWords,
  compareWords,
  DEVICE_LABELS,
  DEVICES_COPY,
  differWords,
  ENGAGEMENT_PANEL_COPY as EP,
  groupWords,
  listHref,
  monthWords,
  OPENED_LABELS,
  openLabel,
  ORIGIN_COPY as O,
  partWords,
  recordingNote,
  sourceBarLabel,
  SYSTEM_LABELS,
  SYSTEM_ORDER,
  TREND_FIGURE_LABELS,
  TREND_SPLIT_LABELS,
  trendSlice,
  TRENDS_COPY as TC,
  WITHHELD,
} from '../model/collectors.js';
import { PART_LABELS } from '../model/engagement.js';
import { money } from '../model/growth.js';
import { changeWords, LIKES_COPY as L, LIKES_SLICES, medianWords, modelWords, reachWords, shareWords, tasteLabel, tasteWords, wishedLink, wishedName, wishlistLink } from '../model/likes.js';
import { APP_WORDS, durationText } from '../model/owner-intelligence.js';
import { href } from '../router.js';
import {
  IN_APPS,
  TREND_FIGURES,
  TREND_SPLITS,
  type CollectorDevices,
  type CollectorLinkResult,
  type CollectorsReport,
  type CollectorTrendPoint,
  type TrendFigure,
  type TrendSplit,
} from '../types.js';
import { button, emptyState, select, table } from '../ui/components.js';
import { figureLink, noMatch, nodes, panelBars, panelLine, panelTabs, type PanelBar, type PanelCtx } from './collectors-parts.js';

type R<P extends CollectorsReport['panel']> = Extract<CollectorsReport, { panel: P }>;

/** A panel with tabs: the tabs, then what the current one shows, drawn again on each pick. */
function tabbed<T extends string>(label: string, items: readonly { key: T; text: string }[], first: T, testid: string, draw: (tab: T, redraw: () => void) => Child[]): HTMLElement {
  const body = h('div', { class: 'collectors__tab-body' });
  let tab = first;
  const redraw = () => {
    body.replaceChildren(
      panelTabs<T>(label, items, tab, (k) => {
        tab = k;
        redraw();
      }, testid),
      ...nodes(draw(tab, redraw)),
    );
  };
  redraw();
  return body;
}

/** A subtitle inside a panel. */
const subtitle = (text: string) => h('h3', { class: 'panel__subtitle' }, text);

/** A count that opens its collectors. */
function opens(n: number, link: string | null, aria: string): HTMLElement {
  return figureLink(formatCount(n), link, aria);
}

/** A most wished row's bar (§3.2 W.8): the hairline track, filled as `wished` is to the most wished (panelBars' fill). */
function wishedBar(wished: number, most: number): HTMLElement {
  const fill = h('span', { class: ['bar__fill', 'bar__fill--solid'] });
  // CSSOM custom property (CSP-safe): the stylesheet scales the fill with it.
  fill.style.setProperty('--f', String(most > 0 ? wished / most : 0));
  return h('span', { class: ['bar__track', 'collectors__cell-bar'], attrs: { 'aria-hidden': 'true' } }, fill);
}

// ── Where they come from ─────────────────────────────────────────────────────────────────────────────────────────

type OriginTab = 'sources' | 'heard' | 'links' | 'campaigns' | 'sites' | 'visits';

function linkResult(pc: PanelCtx, r: CollectorLinkResult, slice: string | null, name: string, side: 'first' | 'last', currency: string): Child[] {
  const which = side === 'first' ? 'whose first link was' : 'whose last link was';
  return [
    slice ? opens(r.collectors, listHref(pc.p, slice, r.collectors), openLabel(r.collectors, `${which} ${name}`)) : formatCount(r.collectors),
    formatCount(r.buyers),
    r.revenueMinor === null ? WITHHELD : money(r.revenueMinor, currency),
  ];
}

export function originPanel(pc: PanelCtx, r: R<'origin'>): Child[] {
  const f = r.figures;
  const p = pc.p;
  const items = (Object.keys(O.tabs) as OriginTab[]).map((k) => ({ key: k, text: O.tabs[k] }));
  const body = tabbed<OriginTab>(O.title, items, 'sources', 'collectors-origin-tabs', (tab) => {
    switch (tab) {
      case 'sources': {
        if (f.total === 0) return [noMatch(pc)];
        const rows: PanelBar[] = f.sources.map((b) => {
          const label = sourceBarLabel(b);
          return { key: b.key, label, n: b.collectors, compare: barCmp(r, b), link: listHref(p, `source:${b.key}`, b.collectors), aria: openLabel(b.collectors, `who first came from ${label}`) };
        });
        return [panelBars(rows, f.total, 'collectors-sources'), panelLine(differWords(f.firstLastDiffer), 'collectors-differ')];
      }
      case 'heard': {
        if (f.total === 0) return [noMatch(pc)];
        const rows: PanelBar[] = f.heard.map((b) => {
          const label = b.key === 'none' ? O.notAnswered : `${b.label ?? ''}${b.setAside ? ` ${O.setAside}` : ''}`;
          const slice = b.other ? 'heardother' : `heard:${b.key}`;
          const aria = b.key === 'none' ? openLabel(b.collectors, 'who did not answer') : b.other ? openLabel(b.collectors, 'who answered Other, with their words') : openLabel(b.collectors, `who heard of ORBES through ${b.label ?? ''}`);
          return { key: b.key, label, n: b.collectors, compare: barCmp(r, b), link: listHref(p, slice, b.collectors), aria };
        });
        return [panelBars(rows, f.total, 'collectors-heard')];
      }
      case 'links': {
        const cur = f.links.currency;
        const rows: { key: string; heading: boolean; name: Child; channel: string; first: Child[]; last: Child[]; cost: string }[] = [];
        for (const g of f.links.channels) {
          rows.push({ key: `channel:${g.channel.id}`, heading: true, name: g.channel.name, channel: '', first: linkResult(pc, g.first, null, g.channel.name, 'first', cur), last: linkResult(pc, g.last, null, g.channel.name, 'last', cur), cost: '' });
          for (const l of g.links) {
            const name = h('a', { class: 'idlink', attrs: { href: href('link', { linkId: l.link.id }) } }, l.link.archived ? `${l.link.name} ${O.archived}` : l.link.name);
            rows.push({
              key: l.link.id,
              heading: false,
              name,
              channel: g.channel.name,
              first: linkResult(pc, l.first, `link1:${l.link.id}`, l.link.name, 'first', cur),
              last: linkResult(pc, l.last, `link2:${l.link.id}`, l.link.name, 'last', cur),
              cost: l.cost ? money(l.cost.minor, l.cost.currency) : '—',
            });
          }
        }
        const currency =
          f.links.currencies.length > 1
            ? (() => {
                const c = select('collectorsCurrency', f.links.currencies.map((x) => ({ value: x, label: x })), cur);
                c.setAttribute('aria-label', O.currency);
                c.setAttribute('data-testid', 'collectors-currency');
                c.addEventListener('change', () => pc.reload({ currency: c.value as typeof cur }));
                return c;
              })()
            : null;
        const C = O.columns;
        return [
          currency,
          table(
            [
              { label: C.link, cell: (x: (typeof rows)[number]) => (x.heading ? h('span', { class: 'links__heading' }, x.name) : x.name), kind: ['wide'] },
              { label: C.channel, cell: (x) => x.channel, kind: ['nowrap'] },
              { label: `${C.first} · ${C.collectors}`, cell: (x) => x.first[0]!, kind: ['num'] },
              { label: C.buyers, cell: (x) => x.first[1]!, kind: ['num'] },
              { label: C.revenue, cell: (x) => x.first[2]!, kind: ['num', 'nowrap'] },
              { label: `${C.last} · ${C.collectors}`, cell: (x) => x.last[0]!, kind: ['num'] },
              { label: C.buyers, cell: (x) => x.last[1]!, kind: ['num'] },
              { label: C.revenue, cell: (x) => x.last[2]!, kind: ['num', 'nowrap'] },
              { label: C.cost, cell: (x) => x.cost, kind: ['num', 'nowrap'] },
            ],
            rows,
            { empty: O.noLink, caption: O.tabs.links },
          ),
          panelLine(O.linksNote),
        ];
      }
      case 'campaigns': {
        const C = O.columns;
        const rows = f.campaigns.rows.flatMap((c) => [
          { key: `c:${c.campaign ?? ''}`, name: c.campaign ?? O.noCampaign, sub: false, visits: c.firstVisits, collectors: opens(c.collectors, listHref(p, `campaign:${c.campaign ?? 'none'}`, c.collectors), openLabel(c.collectors, `who first came through the campaign ${c.campaign ?? O.noCampaign}`)), buyers: c.buyers },
          ...c.rows.map((x, i) => ({ key: `c:${c.campaign ?? ''}:${i}`, name: `${x.source ?? O.noSource} / ${x.medium ?? O.noSource}`, sub: true, visits: x.firstVisits, collectors: formatCount(x.collectors) as Child, buyers: x.buyers })),
        ]);
        return [
          table(
            [
              { label: C.campaign, cell: (x: (typeof rows)[number]) => (x.sub ? h('span', { class: 'cell-sub' }, x.name) : x.name), kind: ['wide'] },
              { label: C.firstVisits, cell: (x) => formatCount(x.visits), kind: ['num'] },
              { label: C.collectors, cell: (x) => x.collectors, kind: ['num'] },
              { label: C.buyers, cell: (x) => formatCount(x.buyers), kind: ['num'] },
            ],
            rows,
            { empty: O.noCampaignYet, caption: O.tabs.campaigns },
          ),
        ];
      }
      case 'sites': {
        const list = [...f.sites.rows, f.sites.other, f.sites.none];
        if (list.every((b) => b.collectors === 0)) return [emptyState(O.noSiteYet)];
        const rows: PanelBar[] = list.map((b) => {
          const label = b.key === 'other' ? O.otherSites : b.key === 'none' ? O.noSite : (b.site ?? b.key);
          const slice = b.key === 'other' ? null : b.key === 'none' ? 'referrer:none' : `referrer:${b.site}`;
          return { key: b.key, label, n: b.collectors, compare: barCmp(r, b), link: slice ? listHref(p, slice, b.collectors) : null, aria: openLabel(b.collectors, b.key === 'none' ? 'who came first with no referring site' : `who first came from ${label}`) };
        });
        return [panelBars(rows, f.total, 'collectors-sites')];
      }
      case 'visits':
        return firstVisits(pc, r);
    }
  });
  return [panelLine(recordingNote(r.recordingSince, r.period, r.previous), 'collectors-recording'), body];
}

const barCmp = (r: CollectorsReport, b: { compare: { now: number; before: number } | null }) => barCompare(b.compare, r.compareBy);

/** Columns, one per bucket, scaled to the largest: the figure in ink, a second mark beside it, the previous pale behind. */
function columns(values: number[], second: number[] | null, previous: (number | null)[] | null, testid: string): HTMLElement {
  const max = Math.max(1, ...values, ...(second ?? []), ...(previous ?? []).map((x) => x ?? 0));
  const bar = (v: number, cls: string) => {
    const el = h('span', { class: ['collectors__col-fill', cls] });
    // CSSOM custom property (CSP-safe): the stylesheet sets the column's height with it.
    el.style.setProperty('--f', String(v / max));
    return el;
  };
  return h(
    'div',
    { class: 'collectors__cols', attrs: { 'aria-hidden': 'true' }, data: { testid } },
    ...values.map((v, i) =>
      h('span', { class: 'collectors__col' }, previous && previous[i] !== null && previous[i] !== undefined ? bar(previous[i]!, 'collectors__col-fill--before') : null, bar(v, 'collectors__col-fill--now'), second ? bar(second[i] ?? 0, 'collectors__col-fill--second') : null),
    ),
  );
}

function firstVisits(pc: PanelCtx, r: R<'origin'>): Child[] {
  const fv = r.figures.firstVisits;
  if (fv.total === 0 && fv.buckets.every((b) => b.newCollectors === 0)) return [emptyState(O.noVisit)];
  const C = O.columns;
  const prev = fv.previous;
  const rows = fv.buckets.map((b, i) => ({ b, before: prev?.[i] ?? null }));
  return [
    columns(
      fv.buckets.map((b) => b.firstVisits),
      fv.buckets.map((b) => b.newCollectors),
      prev ? fv.buckets.map((_, i) => prev[i]?.firstVisits ?? null) : null,
      'collectors-first-visits-chart',
    ),
    panelLine(becameWords(fv.becameCollectors, fv.total), 'collectors-became'),
    table(
      [
        { label: C.bucket, cell: (x: (typeof rows)[number]) => bucketWords(x.b), kind: ['nowrap'] },
        { label: C.firstVisits, cell: (x) => formatCount(x.b.firstVisits), kind: ['num'] },
        { label: C.became, cell: (x) => opens(x.b.becameCollectors, listHref(pc.p, `bucket:firstvisit:${x.b.key}`, x.b.becameCollectors), openLabel(x.b.becameCollectors, `whose first visit fell in ${bucketWords(x.b)}`)), kind: ['num'] },
        { label: C.newCollectors, cell: (x) => opens(x.b.newCollectors, listHref(pc.p, `bucket:signup:${x.b.key}`, x.b.newCollectors), openLabel(x.b.newCollectors, `who signed up in ${bucketWords(x.b)}`)), kind: ['num'] },
        ...(prev ? [{ label: C.before, cell: (x: (typeof rows)[number]) => (x.before ? `${formatCount(x.before.firstVisits)} · ${bucketWords(x.before)}` : '—'), kind: ['num' as const, 'nowrap' as const] }] : []),
      ],
      rows,
      { caption: O.tabs.visits },
    ),
  ];
}

// ── What they like ───────────────────────────────────────────────────────────────────────────────────────────────

type LikesTab = 'pieces' | 'finishes' | 'wished' | 'viewed' | 'held';
const SHOWN = 20;

export function likesPanel(pc: PanelCtx, r: R<'likes'>): Child[] {
  const f = r.figures;
  const p = pc.p;
  if (f.total === 0) return [noMatch(pc)];
  const w = f.wishlists;
  const link = wishlistLink(f.raw, w.collectors);
  const figure = (key: string, label: string, value: Child, cmp: ReturnType<typeof compareWords>, note: string | null) =>
    h('div', { class: ['kpi', 'collectors__kpi'], data: { key } }, h('p', { class: 'kpi__label' }, label), h('div', { class: 'kpi__value' }, value), cmp ? h('p', { class: ['kpi__note', 'collectors__change'] }, cmp.change) : null, cmp?.before ? h('p', { class: ['kpi__note', 'collectors__before'] }, cmp.before) : null, note ? h('p', { class: 'kpi__note' }, note) : null);
  const prev = w.previous;
  const wishlists = h(
    'div',
    { class: ['kpis', 'collectors__kpis', 'collectors__kpis--three'], data: { testid: 'collectors-wishlists' } },
    figure('withWishlist', L.withWishlist, w.collectors === null ? '—' : figureLink(formatCount(w.collectors), link ? listHref(p, link.slice, w.collectors) : null, link?.label ?? '', 'collectors__kpi-link'), prev ? compareWords(w.collectors, prev.collectors) : null, shareWords(w.share)),
    figure('wishesAdded', L.wishesAdded, formatCount(w.added), prev ? compareWords(w.added, prev.added) : null, null),
    figure('wishesRemoved', L.wishesRemoved, formatCount(w.removed), prev ? compareWords(w.removed, prev.removed) : null, null),
  );
  const items = (Object.keys(L.tabs) as LikesTab[]).map((k) => ({ key: k, text: L.tabs[k] }));
  let wishedSide: 'models' | 'collections' = 'models';
  let viewedWhat: 'models' | 'releases' = 'models';
  let viewedWho: 'collectors' | 'visitors' = 'collectors';
  let all = false;
  const body = tabbed<LikesTab>(L.title, items, 'wished', 'collectors-likes-tabs', (tab, redraw) => {
    const showAll = (groups: number) =>
      !all && groups > SHOWN
        ? button(`${L.showAll} ${formatCount(groups)}`, {
            kind: 'ghost',
            testId: 'collectors-likes-all',
            onClick: () => {
              all = true;
              redraw();
            },
          })
        : null;
    const cut = <T,>(rows: T[]) => (all ? rows : rows.slice(0, SHOWN));
    switch (tab) {
      case 'pieces':
      case 'finishes': {
        const kind = tab === 'pieces' ? 'PIECE' : 'FINISH';
        const block = tab === 'pieces' ? f.pieces : f.finishes;
        if (block.rows.length === 0) return [emptyState(tab === 'pieces' ? L.empty.pieces : L.empty.finishes)];
        const slice = (key: string) => (kind === 'PIECE' ? LIKES_SLICES.favpiece(key) : LIKES_SLICES.favfinish(key));
        type Row = { key: string; label: string; swatch: string | null; n: number; chosen: number | null; previous: number | null };
        const rows: Row[] = [
          ...block.rows.map((t) => ({ key: t.key, label: tasteWords(t), swatch: 'swatch' in t ? (t as { swatch: string | null }).swatch : null, n: t.collectors, chosen: t.chosen, previous: t.previous })),
          { key: 'none', label: L.noneChosen, swatch: null, n: block.none, chosen: null, previous: null },
        ];
        return [
          table(
            [
              { label: tab === 'pieces' ? L.favouritePieces : L.favouriteFinishes, cell: (x: Row) => h('span', null, x.swatch ? swatchDot(x.swatch) : null, x.label), kind: ['wide'] },
              { label: L.columns.collectors, cell: (x) => opens(x.n, listHref(p, slice(x.key), x.n, { name: x.label }), x.key === 'none' ? openLabel(x.n, `who chose no favourite ${kind === 'PIECE' ? 'piece' : 'finish'}`) : tasteLabel(x.n, kind, { label: x.label })), kind: ['num'] },
              { label: L.columns.chosen, cell: (x) => (x.chosen === null ? '' : formatCount(x.chosen)), kind: ['num'] },
              { label: L.columns.comparison, cell: (x) => (x.chosen === null ? '' : changeWords(x.chosen, x.previous)), kind: ['num'] },
            ],
            rows,
            { caption: tab === 'pieces' ? L.favouritePieces : L.favouriteFinishes },
          ),
        ];
      }
      case 'wished': {
        const sides = panelTabs<'models' | 'collections'>(L.tabs.wished, [{ key: 'models', text: L.wishedSwitch.models }, { key: 'collections', text: L.wishedSwitch.collections }], wishedSide, (k) => {
          wishedSide = k;
          all = false;
          redraw();
        }, 'collectors-wished-side');
        const notes = [panelLine(L.rowsOpen), panelLine(L.noCount), f.raw ? null : panelLine(L.monthly, 'collectors-monthly')];
        if (wishedSide === 'collections') {
          const rows = f.collections.rows;
          return [
            sides,
            table(
              [
                { label: L.columns.collection, cell: (x: (typeof rows)[number]) => x.name, kind: ['wide'] },
                {
                  label: L.columns.collectorsWishing,
                  cell: (x) => {
                    const l = wishedLink(f.raw, 'collection', x);
                    return opens(x.collectors, l ? listHref(p, l.slice, x.collectors) : null, l?.label ?? '');
                  },
                  kind: ['num'],
                },
                { label: L.columns.comparison, cell: (x) => changeWords(x.collectors, x.previous), kind: ['num'] },
              ],
              cut(rows),
              { empty: L.empty.wishes, caption: L.mostWishedCollections },
            ),
            showAll(f.collections.groups),
            ...notes,
          ];
        }
        type Row = (typeof f.mostWished.rows)[number]['variants'][number] & { rank: string; variantRow: boolean };
        const rows: Row[] = cut(f.mostWished.rows).flatMap((m, i) => [{ ...m, rank: String(i + 1), variantRow: false }, ...m.variants.map((v) => ({ ...v, rank: '', variantRow: true }))]);
        const most = Math.max(0, ...rows.map((x) => x.wished));
        return [
          sides,
          table(
            [
              { label: '#', cell: (x: Row) => x.rank, kind: ['num'] },
              { label: L.columns.model, cell: (x) => h('span', { class: [x.variantRow ? 'cell-sub' : null] }, wishedName(x)), kind: ['wide'] },
              { label: L.columns.type, cell: (x) => x.type, kind: ['nowrap'] },
              { label: L.columns.collection, cell: (x) => x.collection ?? '—', kind: ['nowrap'] },
              {
                label: L.columns.wished,
                cell: (x) => {
                  const l = wishedLink(f.raw, 'model', x);
                  return opens(x.wished, l ? listHref(p, l.slice, x.wished) : null, l?.label ?? '');
                },
                kind: ['num'],
              },
              { label: L.columns.added, cell: (x) => formatCount(x.added), kind: ['num'] },
              { label: L.columns.comparison, cell: (x) => changeWords(x.wished, x.previous), kind: ['num'] },
              { label: '', cell: (x) => wishedBar(x.wished, most) },
            ],
            rows,
            { empty: L.empty.wishes, caption: L.mostWishedModels },
          ),
          showAll(f.mostWished.groups),
          ...notes,
        ];
      }
      case 'viewed': {
        const what = panelTabs<'models' | 'releases'>(L.tabs.viewed, [{ key: 'models', text: L.viewedSwitch.models }, { key: 'releases', text: L.viewedSwitch.releases }], viewedWhat, (k) => {
          viewedWhat = k;
          all = false;
          redraw();
        }, 'collectors-viewed-what');
        const who = panelTabs<'collectors' | 'visitors'>(L.tabs.viewed, [{ key: 'collectors', text: L.viewedSwitch.collectors }, { key: 'visitors', text: L.viewedSwitch.visitors }], viewedWho, (k) => {
          viewedWho = k;
          redraw();
        }, 'collectors-viewed-who');
        const block = viewedWho === 'collectors' ? f.viewed.collectors : f.viewed.visitors;
        const byCollectors = viewedWho === 'collectors';
        type Row = { key: string; name: string; sub: boolean; collectors: number | null; views: number; seconds: number; medianSeconds: number | null; visitors: number | null; slice: string };
        const rows: Row[] =
          viewedWhat === 'models'
            ? cut(block.models).flatMap((m) => [
                { key: m.modelId, name: modelWords(m), sub: false, collectors: m.collectors, views: m.views, seconds: m.seconds, medianSeconds: m.medianSeconds, visitors: m.visitors, slice: LIKES_SLICES.viewedModel(m.modelId) },
                ...m.variants.map((v) => ({ key: v.modelId, name: modelWords(v), sub: true, collectors: v.collectors, views: v.views, seconds: v.seconds, medianSeconds: v.medianSeconds, visitors: v.visitors, slice: LIKES_SLICES.viewedModel(v.modelId) })),
              ])
            : cut(block.releases).map((x) => ({ key: x.dropId, name: x.title ?? '—', sub: false, collectors: x.collectors, views: x.views, seconds: x.seconds, medianSeconds: x.medianSeconds, visitors: x.visitors, slice: LIKES_SLICES.viewedRelease(x.dropId) }));
        const C = L.columns;
        return [
          h('div', { class: 'collectors__switches' }, what, who),
          table(
            [
              { label: viewedWhat === 'models' ? C.model : C.release, cell: (x: Row) => h('span', { class: [x.sub ? 'cell-sub' : null] }, x.name), kind: ['wide'] },
              byCollectors
                ? { label: C.collectorsWhoLooked, cell: (x: Row) => opens(x.collectors ?? 0, listHref(p, x.slice, x.collectors ?? 0), openLabel(x.collectors ?? 0, `who looked at ${x.name} in the period`)), kind: ['num'] }
                : { label: C.visitors, cell: (x: Row) => formatCount(x.visitors), kind: ['num'] },
              { label: C.views, cell: (x) => formatCount(x.views), kind: ['num'] },
              { label: C.timeSpent, cell: (x) => durationText(x.seconds), kind: ['num', 'nowrap'] },
              ...(byCollectors ? [{ label: C.medianTime, cell: (x: Row) => medianWords(x.medianSeconds), kind: ['num' as const, 'nowrap' as const] }] : []),
            ],
            rows,
            { empty: L.empty.viewed, caption: L.tabs.viewed },
          ),
          showAll(block.groups),
          byCollectors ? panelLine(reachWords(f.viewed.collectors.reachesBackTo)) : panelLine(f.viewed.visitors.through ? DEVICES_COPY.through(f.viewed.visitors.through) : null),
        ];
      }
      case 'held': {
        type Row = { key: string; name: string; sub: boolean; collectors: number; pieces: number };
        const rows: Row[] = cut(f.held.rows).flatMap((m) => [
          { key: m.modelId, name: modelWords(m), sub: false, collectors: m.collectors, pieces: m.pieces },
          ...m.variants.map((v) => ({ key: v.modelId, name: modelWords(v), sub: true, collectors: v.collectors, pieces: v.pieces })),
        ]);
        return [
          table(
            [
              { label: L.columns.model, cell: (x: Row) => h('span', { class: [x.sub ? 'cell-sub' : null] }, x.name), kind: ['wide'] },
              { label: L.columns.collectors, cell: (x) => opens(x.collectors, listHref(p, LIKES_SLICES.holds(x.key), x.collectors), openLabel(x.collectors, `who hold a piece of ${x.name}`)), kind: ['num'] },
              { label: L.columns.pieces, cell: (x) => formatCount(x.pieces), kind: ['num'] },
            ],
            rows,
            { empty: L.empty.held, caption: L.tabs.held },
          ),
          showAll(f.held.groups),
        ];
      }
    }
  });
  return [h('h3', { class: 'panel__subtitle' }, L.wishlists), wishlists, body];
}

function swatchDot(color: string): HTMLElement {
  const dot = h('span', { class: 'collectors__swatch', attrs: { 'aria-hidden': 'true' } });
  if (/^#[0-9a-f]{3,8}$/i.test(color)) dot.style.setProperty('--swatch', color);
  return dot;
}

// ── Devices ──────────────────────────────────────────────────────────────────────────────────────────────────────

type DevicesTab = 'byCollectors' | 'byVisits' | 'allDevices';

export function devicesPanel(pc: PanelCtx, r: R<'devices'>): Child[] {
  const f = r.figures;
  const items = (Object.keys(DEVICES_COPY.switch) as DevicesTab[]).map((k) => ({ key: k, text: DEVICES_COPY.switch[k] }));
  const body = tabbed<DevicesTab>(DEVICES_COPY.title, items, 'byCollectors', 'collectors-devices-tabs', (tab) => {
    const t = f[tab];
    const cur = t.current;
    const before = t.previous;
    const opensCollectors = tab === 'byCollectors';
    if (opensCollectors && f.total === 0) return [noMatch(pc)];
    const note = tab === 'byCollectors' ? DEVICES_COPY.byCollectorsNote : tab === 'byVisits' ? DEVICES_COPY.byVisitsNote : DEVICES_COPY.allDevicesNote;
    const reach = tab === 'allDevices' ? panelLine(f.through ? DEVICES_COPY.through(f.through) : null) : panelLine(reachWords(f.reachesBackTo));
    if (cur.total === 0) return [panelLine(note), emptyState(DEVICES_COPY.nothing), reach];
    const list = (dim: 'device' | 'system' | 'openedin' | 'app', keys: readonly string[], value: (d: CollectorDevices, k: string) => number, label: (k: string) => string, testid: string, keep: (k: string, n: number) => boolean = () => true) =>
      panelBars(
        keys
          .filter((k) => keep(k, value(cur, k)))
          .map((k) => {
            const n = value(cur, k);
            return {
              key: k,
              label: label(k),
              n,
              compare: before ? compareWords(n, value(before, k)) : null,
              link: opensCollectors ? listHref(pc.p, `${dim}:${k}`, n) : null,
              aria: openLabel(n, `whose main ${dim === 'device' ? 'device is a' : dim === 'system' ? 'system is' : dim === 'openedin' ? 'way in is' : 'app is'} ${label(k)}`),
            };
          }),
        cur.total,
        `collectors-devices-${dim}`,
      );
    const browsers = cur.browsers.map((b) => ({ key: b.browser, label: BROWSER_LABELS[b.browser] ?? b.browser, n: b.count, compare: before ? compareWords(b.count, before.browsers.find((x) => x.browser === b.browser)?.count ?? 0) : null, link: null, aria: '' }));
    return [
      panelLine(note),
      h(
        'div',
        { class: 'collectors__lists' },
        h('div', null, h('h3', { class: 'panel__subtitle' }, DEVICES_COPY.device), list('device', ['PHONE', 'TABLET', 'COMPUTER', 'UNKNOWN'], (d, k) => d.kinds[k as keyof typeof d.kinds] ?? 0, (k) => DEVICE_LABELS[k] ?? k, '', (k, n) => k !== 'UNKNOWN' || n > 0)),
        h('div', null, h('h3', { class: 'panel__subtitle' }, DEVICES_COPY.system), list('system', SYSTEM_ORDER, (d, k) => d.systems[k as keyof typeof d.systems] ?? 0, (k) => SYSTEM_LABELS[k as (typeof SYSTEM_ORDER)[number]] ?? k, '')),
        h(
          'div',
          null,
          h('h3', { class: 'panel__subtitle' }, DEVICES_COPY.openedIn),
          list('openedin', ['BROWSER', 'IN_APP', 'HOME_SCREEN'], (d, k) => d.openedIn[k as keyof typeof d.openedIn] ?? 0, (k) => OPENED_LABELS[k] ?? k, ''),
          h('h3', { class: 'panel__subtitle' }, DEVICES_COPY.apps),
          list('app', IN_APPS, (d, k) => d.apps[k as keyof typeof d.apps] ?? 0, (k) => APP_WORDS[k as keyof typeof APP_WORDS] ?? k, ''),
        ),
      ),
      h('h3', { class: 'panel__subtitle' }, DEVICES_COPY.browsers),
      panelBars(browsers, cur.total, 'collectors-devices-browsers'),
      reach,
    ];
  });
  return [panelLine(recordingNote(r.recordingSince, r.period, r.previous), 'collectors-recording'), body];
}

// ── Engagement ───────────────────────────────────────────────────────────────────────────────────────────────────

export function engagementPanel(pc: PanelCtx, r: R<'engagement'>): Child[] {
  const f = r.figures;
  const p = pc.p;
  if (f.total === 0) return [noMatch(pc)];
  const scoreLabel = (k: string) => (k === 'none' ? EP.notMeasured : k.replace('-', '–'));
  const spread = panelBars(
    f.spread.rows.map((x) => ({
      key: x.key,
      label: scoreLabel(x.key),
      n: x.collectors,
      compare: null,
      ghost: x.key === 'none' ? null : x.previous,
      link: listHref(p, `score:${x.key}`, x.collectors),
      aria: x.key === 'none' ? openLabel(x.collectors, 'with no score') : openLabel(x.collectors, `with a score of ${scoreLabel(x.key)}`),
    })),
    f.total,
    'collectors-spread',
  );
  const today = parisDayOf(pc.ctx.now());
  const parts = f.parts.map((x) => {
    const name = PART_LABELS[x.key];
    const text = `${name} ${partWords(x.average, x.max)}`;
    return h(
      'li',
      { class: 'collectors__part', data: { key: x.key } },
      figureLink(text, x.average === null ? null : listHref(p, `part:${x.key}`, x.collectors), openLabel(x.collectors, `behind the average of ${name}`)),
    );
  });
  const status = panelBars(
    f.status.rows.map((x) => ({
      key: x.key,
      label: EP.statusLabels[x.key] ?? x.key,
      n: x.collectors,
      compare: f.status.previousAsOf ? compareWords(x.collectors, x.previous) : null,
      link: listHref(p, `status:${x.key}`, x.collectors),
      aria: openLabel(x.collectors, x.key === 'never' ? 'never active since sign-up' : `${(EP.statusLabels[x.key] ?? x.key).toLowerCase()} on ${formatDate(f.status.asOf)}`),
    })),
    f.total,
    'collectors-status',
  );
  type Row = (typeof f.cohorts.rows)[number];
  const cohorts = table(
    [
      { label: EP.month, cell: (x: Row) => monthWords(x.month), kind: ['nowrap'] },
      { label: EP.collectors, cell: (x) => opens(x.collectors, listHref(p, `cohort:${x.month}:all`, x.collectors), openLabel(x.collectors, `who signed up in ${monthWords(x.month)}`)), kind: ['num'] },
      ...[0, 1, 2, 3].map((i) => ({
        label: EP.after([1, 3, 6, 12][i]!),
        cell: (x: Row) => {
          const m = x.marks[i];
          if (!m) return '';
          const words = cohortWords(m);
          return m.active === null ? words : figureLink(words, listHref(p, `cohort:${x.month}:${m.after}:active`, m.active), openLabel(m.active, `of ${monthWords(x.month)} active after ${m.after === 1 ? '1 month' : `${m.after} months`}`));
        },
        kind: ['num' as const, 'nowrap' as const],
      })),
    ],
    f.cohorts.rows,
    { caption: EP.cohorts },
  );
  return [
    h('h3', { class: 'panel__subtitle' }, EP.spread),
    spread,
    panelLine(EP.spreadNote(f.spread.median)),
    f.spread.scored === 0 ? panelLine(EP.noScore) : null,
    f.scoresOn && f.scoresOn !== today ? panelLine(`Scores of ${formatDate(f.scoresOn)}.`) : null,
    f.spread.previousMonth && r.previous ? panelLine(EP.previousMonth(f.spread.previousMonth)) : null,
    h('h3', { class: 'panel__subtitle' }, EP.parts),
    h('ul', { class: 'collectors__parts', data: { testid: 'collectors-parts' } }, ...parts),
    h('h3', { class: 'panel__subtitle' }, EP.status),
    status,
    panelLine(EP.statusNote(f.status.asOf)),
    h('h3', { class: 'panel__subtitle' }, EP.cohorts),
    cohorts,
  ];
}

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const parisDayOf = (d: Date) => PARIS_DAY.format(d);

// ── Over time ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The line's view box; the SVG stretches to its box, its strokes keep their width (the stylesheet's `.trend__svg`). */
const W = 1000;
const H = 200;

function line(points: (number | null)[], max: number, cls: string): SVGElement | null {
  const coords = points
    .map((v, i) => (v === null ? null : `${points.length > 1 ? (i / (points.length - 1)) * W : W / 2},${H - (v / max) * H}`))
    .filter((x): x is string => x !== null);
  return coords.length ? s('polyline', { class: ['trend__line', cls].join(' '), points: coords.join(' ') }) : null;
}

export function trendsPanel(pc: PanelCtx, r: R<'trends'>): Child[] {
  const f = r.figures;
  const p = pc.p;
  const figure = select('trendFigure', TREND_FIGURES.map((x) => ({ value: x, label: TREND_FIGURE_LABELS[x]! })), f.figure);
  figure.setAttribute('aria-label', TC.figure);
  figure.setAttribute('data-testid', 'collectors-trend-figure');
  const split = select('trendSplit', TREND_SPLITS.map((x) => ({ value: x, label: TREND_SPLIT_LABELS[x]! })), f.split);
  split.setAttribute('aria-label', TC.split);
  split.setAttribute('data-testid', 'collectors-trend-split');
  const pick = () => pc.reload({ figure: figure.value as TrendFigure, split: split.value as TrendSplit });
  figure.addEventListener('change', pick);
  split.addEventListener('change', pick);
  const selects = h('div', { class: 'collectors__switches' }, h('label', { class: 'collectors__select' }, h('span', { class: 'collectors__pick-name' }, TC.figure), figure), h('label', { class: 'collectors__select' }, h('span', { class: 'collectors__pick-name' }, TC.split), split));
  if (f.total.length === 0) return [selects, emptyState(TC.noPoint)];
  const series = f.groups.length ? f.groups : [{ group: 'all', points: f.total }];
  const values = (pts: CollectorTrendPoint[]) => pts.map((x) => x.value);
  const max = Math.max(1, ...series.flatMap((g) => values(g.points).map((v) => v ?? 0)), ...(f.previous ?? []).map((x) => x.value ?? 0));
  const svg = s(
    'svg',
    { class: 'trend__svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
    s('line', { class: 'trend__base', x1: 0, y1: H, x2: W, y2: H }),
    f.previous ? line(values(f.previous), max, 'collectors__line--before') : null,
    ...series.map((g, i) => line(values(g.points), max, `collectors__line--${Math.min(i, 6)}`)),
  );
  const legend = f.groups.length
    ? h('ul', { class: 'collectors__legend', data: { testid: 'collectors-trend-legend' } }, ...f.groups.map((g, i) => h('li', { class: `collectors__key collectors__key--${Math.min(i, 6)}` }, groupWords(f.split, g.group, pc.options))))
    : null;
  const figureName = TREND_FIGURE_LABELS[f.figure]!;
  const cell = (pt: CollectorTrendPoint | undefined, group: string | null, previous = false): Child => {
    if (!pt) return '—';
    const text = pt.value === null ? '—' : formatCount(pt.value);
    if (group === 'visitor' || pt.collectors === 0) return text;
    const slice = trendSlice(f.figure, pt.key, { previous, group });
    const what = `behind ${figureName.toLowerCase()} in ${bucketWords(pt)}${group && group !== 'all' ? `, ${groupWords(f.split, group, pc.options)}` : ''}`;
    return figureLink(text, listHref(p, slice, pt.collectors, { figure: f.figure, split: f.split }), openLabel(pt.collectors, what));
  };
  const previousCell = (pt: CollectorTrendPoint | undefined): Child => (pt ? h('span', null, cell(pt, null, true), h('span', { class: 'cell-sub' }, ' ', bucketWords(pt))) : '—');
  const rows = f.total.map((pt, i) => ({ pt, i }));
  const cols = [
    { label: TC.bucket, cell: (x: (typeof rows)[number]) => bucketWords(x.pt), kind: ['nowrap' as const] },
    { label: f.groups.length ? TC.total : figureName, cell: (x: (typeof rows)[number]) => cell(x.pt, null), kind: ['num' as const] },
    ...f.groups.map((g) => ({ label: groupWords(f.split, g.group, pc.options), cell: (x: (typeof rows)[number]) => cell(g.points[x.i], g.group), kind: ['num' as const] })),
    ...(f.previous ? [{ label: TC.previous, cell: (x: (typeof rows)[number]) => previousCell(f.previous?.[x.i]), kind: ['num' as const, 'nowrap' as const] }] : []),
  ];
  return [
    selects,
    h('figure', { class: ['trend', 'collectors__trend'], data: { testid: 'collectors-trend-chart' } }, h('div', { class: 'collectors__trend-plot' }, svg)),
    legend,
    table(cols, rows, { caption: `${figureName} by ${f.unit}` }),
    panelLine(reachWords(f.reachesBackTo)),
  ];
}
