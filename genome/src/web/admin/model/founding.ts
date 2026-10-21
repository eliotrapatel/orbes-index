/**
 * The Founding list of the console (plan MACRO M1 §3.2, scope F3 and F4; views/founding.ts) — pure helpers, no DOM:
 * the words, the filters from the address, the KPIs, the bars by country and by source, a person's row in words, the
 * phrase Remove asks for, and the segment Make the segment creates.
 *
 *  - The people are those theorbes.com's form added (server: services/founding.ts). Their emails are masked for an
 *    AUDITOR by the server; the CSV (OPERATOR) is in a Shopify customers import's columns (S1, S6).
 *  - Make the segment (OPERATOR): one segment, « Founding list », whose one rule is FOUNDING_LIST (the account matched
 *    to a pre-registration). Nothing lasting is given (F4): its members are read live wherever it decides.
 *  - Every time in Paris. Words calm, no exclamation mark, never atelier, handmade or craft (admin.brand.test.ts).
 */
import { countryName } from '../../../shared/countries.js';
import { formatCount, percent } from '../format.js';
import { SOURCE_KINDS, type AdminRole, type FoundingEntry, type FoundingFilters, type FoundingSummary, type Segment, type SegmentGroup, type SourceKind } from '../types.js';
import type { BarRow, Kpi } from './dashboard.js';
import { LINE_LABELS, parisDateTime } from './links.js';
import { can } from './permissions.js';

export const FOUNDING_COPY = Object.freeze({
  lead: 'The people theorbes.com’s form adds, where they came from, and the ORBES account each one becomes when they sign up with the same email. Nothing lasting is given: a release opened to the segment lets them in first.',
  empty: 'Nobody yet. The theorbes.com form adds people here.',
  filteredEmpty: 'Nobody on the list matches these filters.',
  byCountry: 'By country',
  byKind: 'By source',
  byChannel: 'By channel',
  sources: 'Sources',
  sourcesNote: 'One by one, the most joined first',
  noFigures: 'Figures appear once people join.',
  people: 'People',
  csv: 'Download (CSV)',
  csvNote: 'In the columns of a Shopify customers import.',
  segment: 'The segment',
  segmentLead: 'The accounts matched to the list, read live wherever the segment decides: a LIVE RELEASE’s or a draw’s access. The release page says FOR SELECTED COLLECTORS, never its name.',
  makeSegment: 'Make the segment',
  openSegment: 'Open the segment',
  segmentMade: 'Segment made.',
  noSegment: 'None yet.',
  noSegmentAuditor: 'None yet. An OPERATOR makes it.',
  remove: 'Remove',
  removeTitle: 'Remove from the list',
  removeBody: 'Erasure on request: the row is deleted with its consent and its source. An ORBES account with the same email is not touched. This cannot be undone.',
  removed: 'Removed from the list.',
  notMatched: 'Not yet',
  clientSheet: 'Client sheet',
  receiving: 'On the list',
  unsubscribed: 'Unsubscribed',
});

/** The name Make the segment gives, and the one rule of its criteria. */
export const FOUNDING_SEGMENT_NAME = 'Founding list';
export const FOUNDING_SEGMENT_CRITERIA: Readonly<SegmentGroup> = Object.freeze({ match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }] } satisfies SegmentGroup);

/** How many countries the bars show; the rest are counted under Other countries. */
export const FOUNDING_COUNTRY_BARS = 12;
/** The table's page. */
export const FOUNDING_PAGE_SIZE = 50;

// ── The filters, kept in the address (`#/founding?matched=yes&country=FR`) ───────────────────────────────────────────

export type YesNo = 'yes' | 'no';

export interface FoundingParams {
  matched: YesNo | null;
  unsubscribed: YesNo | null;
  country: string | null;
  source: SourceKind | null;
}

const yesNo = (v: string | undefined): YesNo | null => (v === 'yes' || v === 'no' ? v : null);

/** The filters of the address; anything unreadable is no filter. */
export function foundingParams(query: Readonly<Record<string, string | undefined>>): FoundingParams {
  const country = (query.country ?? '').toUpperCase();
  const source = (SOURCE_KINDS as readonly string[]).includes(query.source ?? '') ? (query.source as SourceKind) : null;
  return { matched: yesNo(query.matched), unsubscribed: yesNo(query.unsub), country: /^[A-Z]{2}$/.test(country) ? country : null, source };
}

/** What GET /api/admin/founding is asked for. */
export function foundingFilters(p: FoundingParams): FoundingFilters {
  return {
    ...(p.matched ? { matched: p.matched === 'yes' } : {}),
    ...(p.unsubscribed ? { unsubscribed: p.unsubscribed === 'yes' } : {}),
    ...(p.country ? { country: p.country } : {}),
    ...(p.source ? { sourceKind: p.source } : {}),
  };
}

export const filtered = (p: FoundingParams): boolean => p.matched !== null || p.unsubscribed !== null || p.country !== null || p.source !== null;

/** The filters' choices: matched or not, receiving or unsubscribed. */
export const MATCHED_CHOICES = Object.freeze([
  { value: '', label: 'Everyone' },
  { value: 'yes', label: 'Matched to an account' },
  { value: 'no', label: 'Not yet matched' },
]);
export const UNSUBSCRIBED_CHOICES = Object.freeze([
  { value: '', label: 'Everyone' },
  { value: 'no', label: 'On the list' },
  { value: 'yes', label: 'Unsubscribed' },
]);

/** A country as the console names it: `FR · France`. */
export const countryText = (code: string, name?: string): string => `${code} · ${name ?? countryName(code)}`;

/** The Country filter: the countries on the list (and the one chosen, even when nobody is left in it). */
export function countryChoices(s: Pick<FoundingSummary, 'countries'>, chosen: string | null): { value: string; label: string }[] {
  const known = s.countries.map((c) => ({ code: c.country, name: c.name }));
  if (chosen && !known.some((c) => c.code === chosen)) known.push({ code: chosen, name: countryName(chosen) });
  return [{ value: '', label: 'Every country' }, ...known.sort((a, b) => a.name.localeCompare(b.name, 'en')).map((c) => ({ value: c.code, label: countryText(c.code, c.name) }))];
}

/** The Source filter: the kinds of source, in the Links page's order and words. */
export function sourceChoices(): { value: string; label: string }[] {
  return [{ value: '', label: 'Every source' }, ...(['LINK', 'CAMPAIGN', 'SITE', 'DIRECT'] as const).map((k) => ({ value: k, label: LINE_LABELS[k] }))];
}

// ── The figures ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The four KPIs: on the list, matched to an account, unsubscribed, countries. */
export function foundingKpis(s: FoundingSummary): Kpi[] {
  const top = s.countries[0];
  return [
    { key: 'total', label: 'On the list', value: formatCount(s.total), note: 'FROM THEORBES.COM', tone: 'solid' },
    { key: 'matched', label: 'Matched to an account', value: formatCount(s.matched), note: `${percent(s.matched, s.total)} OF THE LIST`, tone: 'solid' },
    { key: 'unsubscribed', label: 'Unsubscribed', value: formatCount(s.unsubscribed), note: s.unsubscribed > 0 ? 'NO EMAILS' : 'NONE', tone: 'solid' },
    { key: 'countries', label: 'Countries', value: formatCount(s.countries.length), note: top ? `MOST: ${top.name.toUpperCase()}` : 'NONE YET', tone: 'solid' },
  ];
}

function bars(rows: { key: string; label: string; value: number }[], total: number): BarRow[] {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, fraction: max > 0 ? r.value / max : 0, share: percent(r.value, total), tone: 'solid' }));
}

/** The countries, the most first (FOUNDING_COUNTRY_BARS of them), the rest as Other countries. */
export function countryBars(s: FoundingSummary, limit = FOUNDING_COUNTRY_BARS): BarRow[] {
  const shown = s.countries.slice(0, limit);
  const rest = s.countries.slice(limit).reduce((n, c) => n + c.count, 0);
  return bars(
    [
      ...shown.map((c) => ({ key: c.country, label: countryText(c.country, c.name), value: c.count })),
      ...(rest > 0 ? [{ key: 'OTHER', label: `${formatCount(s.countries.length - limit)} other countries`, value: rest }] : []),
    ],
    s.total,
  );
}

/** The kinds of source (Links, Campaign tags, Referring sites, Direct), the most first. */
export function kindBars(s: FoundingSummary): BarRow[] {
  return bars(
    s.kinds.map((k) => ({ key: k.kind, label: LINE_LABELS[k.kind], value: k.count })),
    s.total,
  );
}

/** The channels of the links people came through; those who came another way, together. */
export function channelBars(s: FoundingSummary): BarRow[] {
  return bars(
    s.channels.map((c) => ({ key: c.name ?? '', label: c.name ?? 'Without a link', value: c.count })),
    s.total,
  );
}

/** A source one by one: its words, its kind, its channel, its people and their share of the list. */
export interface SourceRow {
  label: string;
  kind: string;
  channel: string;
  linkId: string | null;
  count: string;
  share: string;
}

export function sourceRows(s: FoundingSummary): SourceRow[] {
  return s.sources.map((x) => ({
    label: x.label,
    kind: LINE_LABELS[x.kind],
    channel: x.channel ?? '—',
    linkId: x.kind === 'LINK' ? x.linkId : null,
    count: formatCount(x.count),
    share: percent(x.count, s.total),
  }));
}

// ── A person ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a person came from: a link's name with its channel, `Instagram bio (Instagram)`; a campaign, a site, Direct. */
export function sourceText(e: Pick<FoundingEntry, 'source'>): string {
  return e.source.kind === 'LINK' && e.source.channel ? `${e.source.label} (${e.source.channel})` : e.source.label;
}

/** When a person joined, in Paris. */
export const joinedText = (e: Pick<FoundingEntry, 'joinedAt'>): string => parisDateTime(e.joinedAt);

/** On the list, or unsubscribed. */
export function statusText(e: Pick<FoundingEntry, 'unsubscribedAt'>): string {
  return e.unsubscribedAt ? FOUNDING_COPY.unsubscribed : FOUNDING_COPY.receiving;
}

/** The Paris day a person unsubscribed, under the word; null while on the list. */
export function unsubscribedDay(e: Pick<FoundingEntry, 'unsubscribedAt'>): string | null {
  return e.unsubscribedAt ? parisDateTime(e.unsubscribedAt).split(' · ')[0]! : null;
}

/** The phrase Remove asks for: `REMOVE 1A2B3C4D` (services/founding.ts removePhrase). */
export function removePhrase(id: string): string {
  return `REMOVE ${id.slice(0, 8).toUpperCase()}`;
}

/** The count of the list under the table: `3 people`, `1 person`, with the filters said. */
export function peopleLine(total: number, isFiltered: boolean): string {
  return `${formatCount(total)} ${total === 1 ? 'person' : 'people'}${isFiltered ? ' match the filters' : ''}`;
}

// ── What the reader may do ───────────────────────────────────────────────────────────────────────────────────────

export interface FoundingActions {
  csv: boolean;
  remove: boolean;
  makeSegment: boolean;
}

export function foundingActions(role: AdminRole | null | undefined): FoundingActions {
  return { csv: can(role, 'exportFounding'), remove: can(role, 'removeFounding'), makeSegment: can(role, 'manageSegments') };
}

// ── The segment ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A segment whose one rule is FOUNDING_LIST, not negated: the one Make the segment makes. */
export function isFoundingSegment(criteria: SegmentGroup): boolean {
  if (criteria.rules.length !== 1) return false;
  const rule = criteria.rules[0]!;
  return !('rules' in rule) && rule.kind === 'FOUNDING_LIST' && rule.not !== true;
}

/** The founding list's segment among them (the oldest when there are several), or null. */
export function foundingSegmentOf(segments: readonly Segment[]): Segment | null {
  return [...segments].filter((s) => isFoundingSegment(s.criteria)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
}

/** The name Make the segment gives: « Founding list », or « Founding list 2 »… when another segment already has it. */
export function foundingSegmentName(taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!names.has(FOUNDING_SEGMENT_NAME.toLowerCase())) return FOUNDING_SEGMENT_NAME;
  for (let i = 2; ; i += 1) if (!names.has(`${FOUNDING_SEGMENT_NAME} ${i}`.toLowerCase())) return `${FOUNDING_SEGMENT_NAME} ${i}`;
}
