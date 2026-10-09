/**
 * The Links pages of the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10, steps 4.8 and 4.9) — pure
 * helpers, no DOM: the words, the page's state from its address, the rows of the three views with their figures twice
 * side by side (FIRST LINK · DISCOVERY and LAST LINK · CONVERSION), the returns, the click-through to the collectors
 * behind a figure, the phone's blocks, the New link and Edit dialog's checks, and a link's page.
 *
 *  - The period is Paris days (7, 30 or 90 days, 12 months to today, ALL TIME by default, or CUSTOM From and To), kept
 *    in the address (`#/links?period=30`) with the view, the archived links shown or not, and a currency of the house
 *    when invoices exist in more than one (amounts are never converted).
 *  - Figures in the console's money (`€ 4 800`, `−€ 320` for a credit note in a later period); a RETURN, SINCE MADE
 *    as `×3.2` with « Revenue € 6 400 for € 2 000 » under it, '—' without a cost, « Not in GBP » when the link's cost is
 *    in another currency than the one shown.
 *  - Every figure but Visits, First visits, Cost and Return opens its collectors (`#/links/collectors?…`); a zero opens
 *    nothing.
 *  - Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { formatCount, formatDate } from '../format.js';
import { href } from '../router.js';
import {
  HOUSE_CURRENCIES,
  LINKS_VIEWS,
  LINK_DESTINATIONS,
  type HouseCurrency,
  type LinkAttribution,
  type LinkCampaignRow,
  type LinkDestination,
  type LinkDestinations,
  type LinkFigures,
  type LinkInput,
  type LinkMeasure,
  type LinkReport,
  type LinkReturn,
  type LinkReturns,
  type LinksReport,
  type LinksView,
  type LinkView,
  type SourceKind,
} from '../types.js';
import type { BarRow } from './dashboard.js';
import { money } from './growth.js';

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const LINKS_COPY = Object.freeze({
  eyebrow: 'Clients',
  title: 'Links',
  lead: 'Links that bring people to verify.theorbes.com, and what each brought in. Test entrants, the team’s own accounts and the console’s own devices are never counted.',
  newLink: 'New link',
  channels: 'Channels',
  period: 'Period',
  currency: 'Currency',
  view: 'View',
  from: 'From',
  to: 'To',
  apply: 'Show',
  customProblem: 'Choose a From and a To day, To not before From, at most 800 days apart.',
  showArchived: 'Show archived links',
  archived: 'ARCHIVED',
  copy: 'Copy',
  firstGroup: 'FIRST LINK · DISCOVERY',
  lastGroup: 'LAST LINK · CONVERSION',
  first: 'FIRST',
  last: 'LAST',
  total: 'TOTAL',
  empty: 'No link yet. Make one with New link: each link counts its visits and what they bring in.',
  failed: 'This figure could not be read. The rest of the page is current.',
  tryAgain: 'Try again',
  deleted: 'Deleted accounts are left out; GROWTH keeps them.',
  notes: 'What the columns count',
  costLine: (cost: string) => `Cost ${cost}`,
  visitsLine: (visits: string, first: string) => `Visits ${visits} · First visits ${first}`,
});

/** The three views, as the page's tabs. */
export const VIEW_LABELS: Readonly<Record<LinksView, string>> = Object.freeze({ links: 'LINKS', campaigns: 'CAMPAIGN TAGS', sites: 'REFERRING SITES' });

/** The first column's heading on each view. */
export const VIEW_ROW_HEADING: Readonly<Record<LinksView, string>> = Object.freeze({ links: 'LINK', campaigns: 'CAMPAIGN', sites: 'SITE' });

/** The group of lines after the rows, on each view. */
export const WITHOUT_HEADING: Readonly<Record<LinksView, string>> = Object.freeze({ links: 'WITHOUT A LINK', campaigns: 'WITHOUT TAGS', sites: 'WITHOUT A SITE' });

/** A line without a link, a tag or a site, by its kind. */
export const LINE_LABELS: Readonly<Record<SourceKind, string>> = Object.freeze({
  LINK: 'Links',
  CAMPAIGN: 'Campaign tags',
  SITE: 'Referring sites',
  DIRECT: 'Direct',
  BEFORE: 'Before tracking',
  STAFF: 'Console device',
});

/** The line that opens a view (Links, Campaign tags, Referring sites); the others open nothing. */
const LINE_VIEW: Partial<Record<SourceKind, LinksView>> = { LINK: 'links', CAMPAIGN: 'campaigns', SITE: 'sites' };

export const MEASURE_LABELS: Readonly<Record<LinkMeasure, string>> = Object.freeze({ signups: 'Sign-ups', entries: 'Entries', purchases: 'Purchases', revenue: 'Revenue' });
export const MEASURE_HEADINGS: Readonly<Record<LinkMeasure, string>> = Object.freeze({ signups: 'SIGN-UPS', entries: 'ENTRIES', purchases: 'PURCHASES', revenue: 'REVENUE' });
export const MEASURES: readonly LinkMeasure[] = Object.freeze(['signups', 'entries', 'purchases', 'revenue']);

/** The column headings with their notes (the header's marks; also listed under the table). */
export const HEADINGS = Object.freeze({
  visits: 'VISITS',
  firstVisits: 'FIRST VISITS',
  returns: 'RETURN, SINCE MADE',
  cost: 'COST',
});

export const HEADING_NOTES = Object.freeze({
  visits: 'A device arriving through it, once a day.',
  entries: 'Draw entries and LIVE RELEASE entries.',
  first: 'Collectors whose first visit came through it.',
  last: 'The latest link, tag or site before the sign-up, the entry or the order, within 90 days. A direct return never replaces it.',
  returns: 'Revenue since the link was made, divided by its cost.',
});

/** The theorbes.com site's row. */
export const ORBES_SITE = 'theorbes.com';

// ── The page's state ─────────────────────────────────────────────────────────────────────────────────────────────

export const LINK_PERIODS = ['7', '30', '90', '12m', 'all', 'custom'] as const;
export type LinkPeriod = (typeof LINK_PERIODS)[number];

/** The period's tab: its figure apart (it reads in --font inside the display face). */
export const PERIOD_TABS: Readonly<Record<LinkPeriod, { figure: string | null; words: string }>> = Object.freeze({
  '7': { figure: '7', words: 'DAYS' },
  '30': { figure: '30', words: 'DAYS' },
  '90': { figure: '90', words: 'DAYS' },
  '12m': { figure: '12', words: 'MONTHS' },
  all: { figure: null, words: 'ALL TIME' },
  custom: { figure: null, words: 'CUSTOM' },
});

/** The period in a title (« … · 30 days »). */
const PERIOD_WORDS: Readonly<Record<Exclude<LinkPeriod, 'custom'>, string>> = Object.freeze({ '7': '7 days', '30': '30 days', '90': '90 days', '12m': '12 months', all: 'all time' });

/** A period's days apart at most (the server's REPORT_MAX_DAYS). */
export const LINKS_MAX_DAYS = 800;

export interface LinksParams {
  period: LinkPeriod;
  /** The Paris days asked (both or neither: all time, or a CUSTOM not given yet). */
  from: string | null;
  to: string | null;
  view: LinksView;
  archived: boolean;
  /** Only when the address names one: the server chooses otherwise. */
  currency: HouseCurrency | null;
  /** CUSTOM's days as typed, kept in the address. */
  customFrom: string | null;
  customTo: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A Paris day `YYYY-MM-DD` that exists. */
export function isDay(v: string | null | undefined): v is string {
  if (!v || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** `day` moved by `n` days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to` (0 for one day). */
export function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** Today in Paris, `YYYY-MM-DD`. */
export function parisDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A CUSTOM period's problem, or null. */
export function customProblem(from: string | null, to: string | null): string | null {
  if (!isDay(from) || !isDay(to) || to < from || daysApart(from, to) > LINKS_MAX_DAYS) return LINKS_COPY.customProblem;
  return null;
}

/** The Paris days of a period, to today (Paris); null for all time and a CUSTOM not valid yet. */
export function periodRange(period: LinkPeriod, today: string, custom: { from: string | null; to: string | null } = { from: null, to: null }): { from: string; to: string } | null {
  switch (period) {
    case '7':
      return { from: addDays(today, -6), to: today };
    case '30':
      return { from: addDays(today, -29), to: today };
    case '90':
      return { from: addDays(today, -89), to: today };
    case '12m': {
      const [y, m, d] = today.split('-').map(Number) as [number, number, number];
      const back = new Date(Date.UTC(y - 1, m - 1, d));
      // 29 February a year back is 1 March.
      if (back.getUTCMonth() !== m - 1) back.setUTCDate(0);
      return { from: addDays(back.toISOString().slice(0, 10), 1), to: today };
    }
    case 'custom':
      return customProblem(custom.from, custom.to) === null ? { from: custom.from!, to: custom.to! } : null;
    default:
      return null;
  }
}

/** The page's state from its address: anything the server would refuse reads as the default. */
export function linksParams(query: Readonly<Record<string, string | undefined>>, now: Date): LinksParams {
  const period = (LINK_PERIODS as readonly string[]).includes(query.period ?? '') ? (query.period as LinkPeriod) : 'all';
  const customFrom = isDay(query.from) ? query.from : null;
  const customTo = isDay(query.to) ? query.to : null;
  const range = periodRange(period, parisDay(now), { from: customFrom, to: customTo });
  return {
    period,
    from: range?.from ?? null,
    to: range?.to ?? null,
    view: (LINKS_VIEWS as readonly string[]).includes(query.view ?? '') ? (query.view as LinksView) : 'links',
    archived: query.archived === '1',
    currency: (HOUSE_CURRENCIES as readonly string[]).includes(query.currency ?? '') ? (query.currency as HouseCurrency) : null,
    customFrom: period === 'custom' ? customFrom : null,
    customTo: period === 'custom' ? customTo : null,
  };
}

/** The address's query for a state, `q` merged in (the defaults left out, so `#/links` is ALL TIME on LINKS). */
export function linksQuery(p: LinksParams, q: Partial<{ period: LinkPeriod; view: LinksView; archived: boolean; currency: HouseCurrency | null; from: string | null; to: string | null }> = {}): Record<string, string | null> {
  const period = q.period ?? p.period;
  const view = q.view ?? p.view;
  const archived = q.archived ?? p.archived;
  const currency = q.currency === undefined ? p.currency : q.currency;
  const from = period === 'custom' ? (q.from === undefined ? p.customFrom : q.from) : null;
  const to = period === 'custom' ? (q.to === undefined ? p.customTo : q.to) : null;
  return { period: period === 'all' ? null : period, view: view === 'links' ? null : view, archived: archived ? '1' : null, currency, from, to };
}

/** The period in words, for a title: « 30 days », « all time », « 01 OCT 2026 – 31 OCT 2026 ». */
export function periodWords(period: LinkPeriod, from: string | null, to: string | null): string {
  if (period === 'custom') return from && to ? `${formatDate(from)} – ${formatDate(to)}` : PERIOD_WORDS.all;
  return PERIOD_WORDS[period];
}

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure that opens its collectors (href null: nothing to open). */
export interface FigureCell {
  text: string;
  href: string | null;
}

export interface ReturnCell {
  text: string;
  sub: string | null;
}

/** `×3.2`: a return, one decimal. */
export function ratioText(ratio: number): string {
  return `×${(Math.round(ratio * 10) / 10).toFixed(1)}`;
}

/** RETURN, SINCE MADE's cell: '—' without a cost, « Not in GBP » when its cost is in another currency than the one shown. */
export function returnCell(r: LinkReturn | null | undefined, shown: HouseCurrency): ReturnCell {
  if (!r) return { text: '—', sub: null };
  if (r.currency !== shown) return { text: `Not in ${shown}`, sub: null };
  return { text: r.ratio === null ? '—' : ratioText(r.ratio), sub: `Revenue ${money(r.revenueMinor, r.currency)} for ${money(r.costMinor, r.currency)}` };
}

/** What the click-through of a row names (services/acquisition-report.ts parseSourceSpec) and how the title reads it. */
export interface SourceRef {
  /** `total`, `link:<uuid>`, `channel:<uuid>`, `source:<id>,…`, `kind:<KIND>`. */
  source: string;
  /** Its name in the list's title: a link's, a channel's, a campaign, a site, a line. */
  name: string;
}

/** The router keeps 200 characters of a value: a longer `source` (a campaign of many variants) opens nothing. */
const SOURCE_MAX = 200;

/** The collectors behind a figure: `#/links/collectors?…` with the period, or null for nothing to open. */
export function collectorsHref(ref: SourceRef | null, attribution: LinkAttribution, measure: LinkMeasure, p: Pick<LinksParams, 'period' | 'from' | 'to' | 'currency'>, extra: { linkId?: string } = {}): string | null {
  if (!ref || ref.source.length > SOURCE_MAX) return null;
  return href(
    'linkCollectors',
    {},
    {
      source: ref.source,
      name: ref.name.slice(0, SOURCE_MAX),
      attribution,
      measure,
      period: p.period === 'all' ? null : p.period,
      from: p.period === 'all' ? null : p.from,
      to: p.period === 'all' ? null : p.to,
      currency: p.currency,
      link: extra.linkId,
    },
  );
}

/** A measure's figure as text, in the currency shown for revenue. */
export function measureText(f: LinkFigures, attribution: LinkAttribution, measure: LinkMeasure, currency: HouseCurrency): string {
  const r = f[attribution];
  return measure === 'revenue' ? money(r.revenueMinor, currency) : formatCount(r[measure]);
}

/** The four figures of one attribution, each opening its collectors unless it is 0. */
export function attributionCells(f: LinkFigures, attribution: LinkAttribution, ref: SourceRef | null, p: Pick<LinksParams, 'period' | 'from' | 'to' | 'currency'>, currency: HouseCurrency): Record<LinkMeasure, FigureCell> {
  const out = {} as Record<LinkMeasure, FigureCell>;
  for (const m of MEASURES) {
    const r = f[attribution];
    const value = m === 'revenue' ? r.revenueMinor : r[m];
    out[m] = { text: measureText(f, attribution, m, currency), href: value === 0 ? null : collectorsHref(ref, attribution, m, { ...p, currency: p.currency ?? currency }) };
  }
  return out;
}

// ── The rows of the three views ──────────────────────────────────────────────────────────────────────────────────

export type LinksRowKind = 'channel' | 'link' | 'group' | 'campaign' | 'site' | 'heading' | 'line' | 'total';

/** A row of the table, and a block on a phone. */
export interface LinksRow {
  kind: LinksRowKind;
  key: string;
  label: string;
  /** A link's address without its protocol (shown in mono with Copy), or a campaign's second line. */
  sub: string | null;
  /** What Copy copies: the link's address. */
  copy: string | null;
  /** Where the name leads: the link's page, a view's tab. */
  open: string | null;
  archived: boolean;
  /** Absent on a heading. */
  figures: {
    visits: string;
    firstVisits: string;
    first: Record<LinkMeasure, FigureCell>;
    last: Record<LinkMeasure, FigureCell>;
  } | null;
  /**
   * On LINKS only (the other views have no cost nor return): a channel's and a link's returns (null: no cost, '—') and
   * cost; 'blank' on the lines without a link and the TOTAL.
   */
  money?: { returns: { first: ReturnCell; last: ReturnCell } | null; cost: string } | 'blank';
}

/** The address as it is shown: without its protocol. */
export function addressText(address: string): string {
  return address.replace(/^https?:\/\//, '');
}

/** A campaign's three tags: `ig / story / drop-14`, '—' for one not given. */
export function campaignLabel(r: Pick<LinkCampaignRow, 'source' | 'medium' | 'campaign'>): string {
  return [r.source, r.medium, r.campaign].map((x) => x ?? '—').join(' / ');
}

/** A campaign's second line: its one variant's content and term, or how many it sums. */
export function campaignSub(r: Pick<LinkCampaignRow, 'variants' | 'content' | 'term'>): string | null {
  if (r.variants > 1) return `${formatCount(r.variants)} variants`;
  if (r.content === null && r.term === null) return null;
  return `content: ${r.content ?? '—'} · term: ${r.term ?? '—'}`;
}

/** A site's name; theorbes.com says it is ORBES's own. */
export function siteLabel(site: string): string {
  return site === ORBES_SITE ? `${ORBES_SITE} (ORBES’s site)` : site;
}

/** The link page's address, the view's tab. */
export const linkHref = (id: string): string => href('link', { linkId: id });

/** The rows of the report's view: its own rows, then the lines without one (under their heading), then the TOTAL. */
export function linksRows(r: LinksReport, p: LinksParams): LinksRow[] {
  const currency = r.currency;
  const q = { period: p.period, from: p.from, to: p.to, currency: p.currency ?? currency };
  const figures = (f: LinkFigures, ref: SourceRef | null): NonNullable<LinksRow['figures']> => ({
    visits: formatCount(f.visits),
    firstVisits: formatCount(f.firstVisits),
    first: attributionCells(f, 'first', ref, q, currency),
    last: attributionCells(f, 'last', ref, q, currency),
  });
  const returns = (x: LinkReturns | null): { first: ReturnCell; last: ReturnCell } | null => (x ? { first: returnCell(x.first, currency), last: returnCell(x.last, currency) } : null);
  const rows: LinksRow[] = [];
  const base = { sub: null, copy: null, open: null, archived: false };
  if (r.view === 'links') {
    for (const g of r.channels) {
      rows.push({
        ...base,
        kind: 'channel',
        key: `channel:${g.channel.id}`,
        label: g.channel.name.toUpperCase(),
        figures: figures(g.figures, { source: `channel:${g.channel.id}`, name: g.channel.name }),
        money: { returns: returns(g.returns), cost: g.cost ? money(g.cost.minor, g.cost.currency) : '—' },
      });
      for (const l of g.links) {
        rows.push({
          kind: 'link',
          key: `link:${l.link.id}`,
          label: l.link.name,
          sub: addressText(l.link.address),
          copy: l.link.address,
          open: linkHref(l.link.id),
          archived: l.link.archivedAt !== null,
          figures: figures(l.figures, { source: `link:${l.link.id}`, name: l.link.name }),
          money: { returns: returns(l.returns), cost: l.link.cost ? money(l.link.cost.minor, l.link.cost.currency) : '—' },
        });
      }
    }
  } else if (r.view === 'campaigns') {
    for (const g of r.campaigns) {
      const ids = g.rows.flatMap((x) => x.sourceIds);
      const label = g.utmSource ?? '—';
      rows.push({ ...base, kind: 'group', key: `group:${label}`, label, figures: figures(g.figures, ids.length ? { source: `source:${ids.join(',')}`, name: label } : null) });
      for (const c of g.rows) {
        const name = campaignLabel(c);
        rows.push({ ...base, kind: 'campaign', key: `campaign:${c.sourceIds.join(',')}`, label: name, sub: campaignSub(c), figures: figures(c.figures, c.sourceIds.length ? { source: `source:${c.sourceIds.join(',')}`, name } : null) });
      }
    }
  } else {
    for (const s of r.sites) rows.push({ ...base, kind: 'site', key: `site:${s.sourceId}`, label: siteLabel(s.site), figures: figures(s.figures, { source: `source:${s.sourceId}`, name: s.site }) });
  }
  rows.push({ ...base, kind: 'heading', key: 'heading', label: WITHOUT_HEADING[r.view], figures: null });
  for (const line of r.without) {
    const view = LINE_VIEW[line.kind];
    const open = view && view !== r.view ? href('links', {}, linksQuery(p, { view })) : null;
    rows.push({
      ...base,
      kind: 'line',
      key: `line:${line.kind}`,
      label: LINE_LABELS[line.kind],
      open,
      figures: figures(line.figures, { source: `kind:${line.kind}`, name: LINE_LABELS[line.kind] }),
      ...(r.view === 'links' ? { money: 'blank' as const } : {}),
    });
  }
  rows.push({
    ...base,
    kind: 'total',
    key: 'total',
    label: LINKS_COPY.total,
    figures: figures(r.total, { source: 'total', name: 'all' }),
    ...(r.view === 'links' ? { money: 'blank' as const } : {}),
  });
  return rows;
}

/** Whether no link was ever made (LINKS shows its empty line, then the lines without a link and the TOTAL). */
export function noLinkYet(r: LinksReport): boolean {
  return r.view === 'links' && r.channels.length === 0;
}

/** A phone's block for a row, in the order it reads: the figures of FIRST, then of LAST, each one per line. */
export interface PhoneBlock {
  label: string;
  sub: string | null;
  visits: string;
  first: { label: string; cell: FigureCell | ReturnCell }[];
  last: { label: string; cell: FigureCell | ReturnCell }[];
  cost: string | null;
}

export function phoneBlock(row: LinksRow): PhoneBlock | null {
  if (!row.figures) return null;
  const side = (a: LinkAttribution) => {
    const lines: { label: string; cell: FigureCell | ReturnCell }[] = MEASURES.map((m) => ({ label: MEASURE_LABELS[m], cell: row.figures![a][m] }));
    if (row.money && row.money !== 'blank') lines.push({ label: 'Return', cell: row.money.returns ? row.money.returns[a] : { text: '—', sub: null } });
    return lines;
  };
  return {
    label: row.label,
    sub: row.sub,
    visits: LINKS_COPY.visitsLine(row.figures.visits, row.figures.firstVisits),
    first: side('first'),
    last: side('last'),
    cost: row.money && row.money !== 'blank' ? LINKS_COPY.costLine(row.money.cost) : null,
  };
}

// ── New link and Edit ───────────────────────────────────────────────────────────────────────────────────────────

export const LINK_DIALOG = Object.freeze({
  newTitle: 'New link',
  editTitle: 'Edit the link',
  name: 'Name',
  namePlaceholder: 'Instagram bio',
  channel: 'Channel',
  newChannel: '+ New channel…',
  channelName: 'New channel',
  add: 'Add',
  goesTo: 'Goes to',
  release: 'Release',
  model: 'Model',
  address: 'Address',
  addressHint: 'Letters, figures and dashes. It can never change once the link is made.',
  cost: 'Cost',
  costCurrency: 'Currency',
  costHint: 'What this link cost: a fee, a post, a campaign. Used for its return.',
  note: 'Note',
  noteHint: 'Only staff read it.',
  make: 'Make the link',
  save: 'Save',
  cancel: 'Cancel',
  making: 'Making…',
  saving: 'Saving…',
  ready: 'The link is ready.',
  direct: 'Direct address, for places that refuse a redirect:',
  done: 'Done',
  made: 'Link made.',
  saved: 'Saved.',
  chooseRelease: 'Choose a release',
  chooseModel: 'Choose a model',
  unchanged: 'Nothing has changed.',
  failed: 'The action could not be completed.',
});

export const LINK_ERRORS = Object.freeze({
  name: 'Give the link a name.',
  nameLong: 'A link’s name is 80 characters at most.',
  code: 'The address is 3 to 32 letters, figures or dashes, in lower case.',
  destination: 'Choose where the link goes.',
  cost: 'The cost is an amount with cents, in one currency.',
  channel: 'Give the channel a name.',
  channelLong: 'A channel’s name is 40 characters at most.',
  noChannel: 'Choose a channel.',
});

export const LINK_NAME_MAX = 80;
export const LINK_NOTE_MAX = 500;
export const CHANNEL_NAME_MAX = 40;

/** Where the link goes, as the Goes to select offers it. */
export const DESTINATION_LABELS: Readonly<Record<LinkDestination, string>> = Object.freeze({
  NOW: 'NOW',
  RELEASES: 'THE RELEASES',
  RELEASE: 'A release',
  COLLECTION: 'THE COLLECTION',
  MODEL: 'A model’s sheet',
  CLUB: 'THE CLUB',
  HOW: 'HOW RELEASES WORK',
});

/** The order of the Goes to select. */
export const DESTINATION_ORDER: readonly LinkDestination[] = Object.freeze(['NOW', 'RELEASES', 'RELEASE', 'COLLECTION', 'MODEL', 'CLUB', 'HOW'] as const satisfies readonly LinkDestination[]);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** An instant in Paris time, as the console writes dates: `14 OCT 2026 · 20:00 Paris`. */
export function parisDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year} · ${parts.hour}:${parts.minute} Paris`;
}

/** A release as the dialog names it: `MONOLITHE — LIVE · 14 OCT 2026 · 20:00 Paris`. */
export function releaseLabel(r: LinkDestinations['releases'][number]): string {
  return `${r.title} — ${r.mode} · ${parisDateTime(r.opensAt)}`;
}

/** A model as the dialog names it: `MONOLITHE`, a variant `MONOLITHE · BLUE`. */
export function modelLabel(m: LinkDestinations['models'][number]): string {
  return (m.variantOf && m.variantLabel ? `${m.name} · ${m.variantLabel}` : m.name).toUpperCase();
}

/** A cost typed in units (`2000`, `2 000`, `2000.50`, `2000,5`) in cents; null when it is not one. */
export function parseCost(text: string | null | undefined): number | null {
  const s = (text ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [units, cents = ''] = s.split('.');
  return Number(units) * 100 + Number(cents.padEnd(2, '0'));
}

/** A cost in cents as the field shows it: `2000`, `2000.50`. */
export function costText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** What the New link and Edit dialog holds. */
export interface LinkForm {
  name: string;
  channelId: string;
  destination: string;
  dropId: string;
  modelId: string;
  /** New link only. */
  code: string;
  cost: string;
  currency: string;
  note: string;
}

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/** The first problem of the form, with the field it is under; null when it may be sent. */
export function linkFormProblem(f: LinkForm, isNew: boolean): { field: keyof LinkForm; message: string } | null {
  const name = f.name.trim();
  if (!name) return { field: 'name', message: LINK_ERRORS.name };
  if (name.length > LINK_NAME_MAX) return { field: 'name', message: LINK_ERRORS.nameLong };
  if (!f.channelId || f.channelId === NEW_CHANNEL) return { field: 'channelId', message: LINK_ERRORS.noChannel };
  if (!(LINK_DESTINATIONS as readonly string[]).includes(f.destination)) return { field: 'destination', message: LINK_ERRORS.destination };
  if (f.destination === 'RELEASE' && !f.dropId) return { field: 'dropId', message: LINK_ERRORS.destination };
  if (f.destination === 'MODEL' && !f.modelId) return { field: 'modelId', message: LINK_ERRORS.destination };
  if (isNew && !CODE_RE.test(f.code)) return { field: 'code', message: LINK_ERRORS.code };
  if (f.cost.trim() !== '' && (parseCost(f.cost) === null || !(HOUSE_CURRENCIES as readonly string[]).includes(f.currency))) return { field: 'cost', message: LINK_ERRORS.cost };
  return null;
}

/** The select's value that turns Channel into a new channel's name. */
export const NEW_CHANNEL = '__new';

/** The body of POST /api/admin/links (or, without `code`, of PATCH) from the form. */
export function linkInput(f: LinkForm, isNew: boolean): LinkInput {
  const destination = f.destination as LinkDestination;
  const minor = f.cost.trim() === '' ? null : parseCost(f.cost);
  const note = f.note.trim();
  return {
    name: f.name.trim(),
    channelId: f.channelId,
    destination,
    dropId: destination === 'RELEASE' ? f.dropId : null,
    modelId: destination === 'MODEL' ? f.modelId : null,
    ...(isNew ? { code: f.code } : {}),
    cost: minor === null ? null : { minor, currency: f.currency as HouseCurrency },
    note: note === '' ? null : note,
  };
}

/** The Edit dialog's fields from the link. */
export function linkFormOf(l: LinkView): LinkForm {
  return {
    name: l.name,
    channelId: l.channel.id,
    destination: l.destination,
    dropId: l.dropId ?? '',
    modelId: l.modelId ?? '',
    code: l.code,
    cost: l.cost ? costText(l.cost.minor) : '',
    currency: l.cost?.currency ?? 'EUR',
    note: l.note ?? '',
  };
}

/** What changed on Edit, as PATCH's body; null when nothing did. */
export function linkChanges(l: LinkView, f: LinkForm): Partial<Omit<LinkInput, 'code'>> | null {
  const next = linkInput(f, false);
  const out: Partial<Omit<LinkInput, 'code'>> = {};
  if (next.name !== l.name) out.name = next.name;
  if (next.channelId !== l.channel.id) out.channelId = next.channelId;
  if (next.destination !== l.destination || (next.dropId ?? null) !== l.dropId || (next.modelId ?? null) !== l.modelId) {
    out.destination = next.destination;
    out.dropId = next.dropId ?? null;
    out.modelId = next.modelId ?? null;
  }
  const cost = next.cost ?? null;
  if ((cost?.minor ?? null) !== (l.cost?.minor ?? null) || (cost?.currency ?? null) !== (l.cost?.currency ?? null)) out.cost = cost;
  if ((next.note ?? null) !== l.note) out.note = next.note ?? null;
  return Object.keys(out).length ? out : null;
}

/** The field a server's refusal is about (its words are the server's): the address, the name, the cost… or none. */
export function errorField(code: string, message: string): keyof LinkForm | null {
  if (code === 'LINK_CODE_TAKEN' || message === LINK_ERRORS.code) return 'code';
  if (message === LINK_ERRORS.name || message === LINK_ERRORS.nameLong) return 'name';
  if (message === LINK_ERRORS.destination) return 'destination';
  if (message === LINK_ERRORS.cost) return 'cost';
  if (/^A note is/.test(message)) return 'note';
  if (code === 'CHANNEL_NOT_FOUND') return 'channelId';
  return null;
}

// ── Channels ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CHANNELS_COPY = Object.freeze({
  title: 'Channels',
  lead: 'Links are grouped by channel, in this order.',
  links: (n: number) => `${formatCount(n)} ${n === 1 ? 'link' : 'links'}`,
  rename: 'Rename',
  save: 'Save',
  cancel: 'Cancel',
  up: 'Up',
  down: 'Down',
  remove: 'Remove',
  inUse: 'Links use it.',
  add: 'Add a channel',
  addButton: 'Add',
  done: 'Done',
  added: 'Channel added.',
  renamed: 'Saved.',
  removed: 'Channel removed.',
  moved: 'Order saved.',
});

/** A channel's name's problem, or null. */
export function channelNameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return LINK_ERRORS.channel;
  if (t.length > CHANNEL_NAME_MAX) return LINK_ERRORS.channelLong;
  return null;
}

/** The channels' places after moving one up or down: each `{ id, position }` to change (10, 20, 30…); null at an end. */
export function channelMoves(channels: readonly { id: string; position: number }[], id: string, by: -1 | 1): { id: string; position: number }[] | null {
  const i = channels.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= channels.length) return null;
  const order = [...channels];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return order.map((c, k) => ({ id: c.id, position: Math.min(999, (k + 1) * 10), was: c.position })).filter((c) => c.position !== c.was).map(({ id: cid, position }) => ({ id: cid, position }));
}
