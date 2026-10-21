/**
 * The Founding list (Clients), `#/founding` (plan MACRO M1 §3.2, scope F3 and F4): the people theorbes.com's form
 * adds, read from GET /api/admin/founding, /summary and /founding.csv (server: routes/admin/founding.ts).
 *
 *  - Its KPIs: on the list, matched to an account, unsubscribed, countries.
 *  - By country, by source (the kind, the channel) and the sources one by one (a link's name opens its page).
 *  - The people, newest first, filtered by matched, country, source and unsubscribed (kept in the address): the email
 *    (masked for an AUDITOR by the server), first name, country, source, joined (Paris), the client sheet once matched,
 *    unsubscribed or not; Remove (ADMIN, a phrase to type: erasure on request).
 *  - Download (CSV) (OPERATOR), in a Shopify customers import's columns (S1, S6).
 *  - The segment: Make the segment (OPERATOR) creates « Founding list » with the FOUNDING_LIST rule when none exists, in
 *    one click; then the page links to it. Nothing lasting is given: its members are read live (F4).
 * Model in model/founding.ts. Each change is audited by the server.
 */
import { h } from '../../shared/dom.js';
import {
  channelBars,
  countryBars,
  countryChoices,
  countryText,
  filtered,
  foundingActions,
  foundingFilters,
  foundingKpis,
  foundingParams,
  foundingSegmentName,
  foundingSegmentOf,
  FOUNDING_COPY as C,
  FOUNDING_PAGE_SIZE,
  FOUNDING_SEGMENT_CRITERIA,
  joinedText,
  kindBars,
  MATCHED_CHOICES,
  peopleLine,
  removePhrase,
  sourceChoices,
  sourceRows,
  sourceText,
  statusText,
  unsubscribedDay,
  UNSUBSCRIBED_CHOICES,
  type SourceRow,
} from '../model/founding.js';
import { membersLine } from '../model/segments.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import type { FoundingEntry, FoundingSummary, Segment, SegmentGroup } from '../types.js';
import { barList, busy, button, defList, emptyState, field, filterBar, kpi, linkButton, pageHeader, pager, section, select, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function foundingView(ctx: ViewContext): Promise<HTMLElement> {
  const params = foundingParams(ctx.route.query);
  const [summary, list, segments] = await Promise.all([
    ctx.api.foundingSummary(),
    ctx.api.founding({ ...foundingFilters(params), page: pageParam(ctx), pageSize: FOUNDING_PAGE_SIZE }),
    ctx.api.segments().catch((): Segment[] | null => null),
  ]);
  const role = ctx.session.admin.role;
  const acts = foundingActions(role);

  const csv = acts.csv ? csvButton(ctx) : null;
  const header = pageHeader({ eyebrow: 'Clients', title: 'Founding list', lead: C.lead, actions: csv && summary.total > 0 ? [csv] : [] });

  if (summary.total === 0) {
    return h('div', { class: 'view view--founding' }, header, section(C.people, emptyState(C.empty), { id: 'founding-people' }), segmentSection(ctx, segments, acts.makeSegment));
  }

  return h(
    'div',
    { class: 'view view--founding' },
    header,
    h('div', { class: 'kpis', data: { testid: 'founding-kpis' } }, ...foundingKpis(summary).map((k) => kpi(k.label, k.value, k.note, k.tone))),
    segmentSection(ctx, segments, acts.makeSegment),
    h(
      'div',
      { class: ['grid', 'grid--2', 'founding__grid'] },
      section(C.byCountry, barList(countryBars(summary)), { id: 'founding-countries', note: 'Most joined' }),
      section(C.byKind, [barList(kindBars(summary)), h('p', { class: 'founding__sub' }, C.byChannel), barList(channelBars(summary))], { id: 'founding-kinds', note: 'Where they came from' }),
    ),
    sourcesSection(summary, can(role, 'readLinks')),
    peopleSection(ctx, summary, list, params, acts.remove),
  );
}

/** The sources one by one, the most joined first; a link's name opens its page. */
function sourcesSection(s: FoundingSummary, readLinks: boolean): HTMLElement {
  return section(
    C.sources,
    table<SourceRow>(
      [
        {
          label: 'Source',
          cell: (r) => (r.linkId && readLinks ? h('a', { class: ['idlink', 'founding__source'], attrs: { href: href('link', { linkId: r.linkId }) } }, r.label) : h('span', null, r.label)),
          kind: ['wide'],
        },
        { label: 'Kind', cell: (r) => r.kind, kind: ['nowrap'] },
        { label: 'Channel', cell: (r) => r.channel, kind: ['nowrap'] },
        { label: 'People', cell: (r) => r.count, kind: ['nowrap', 'num'] },
        { label: 'Share', cell: (r) => r.share, kind: ['nowrap', 'num'] },
      ],
      sourceRows(s),
      { caption: C.sources, empty: C.noFigures },
    ),
    { id: 'founding-sources', note: C.sourcesNote },
  );
}

/** The people, newest first, with the filters and the pager. */
function peopleSection(ctx: ViewContext, summary: FoundingSummary, list: { items: FoundingEntry[]; page: number; pageSize: number; total: number }, params: ReturnType<typeof foundingParams>, canRemove: boolean): HTMLElement {
  const choice = (name: string, label: string, options: readonly { value: string; label: string }[], value: string | null, key: string) => {
    const s = select(name, [...options], value ?? '');
    s.setAttribute('data-testid', `founding-filter-${name}`);
    s.addEventListener('change', () => ctx.setQuery({ [key]: s.value || null, page: null }));
    return field(label, s);
  };
  const filters = filterBar(
    choice('matched', 'Account', MATCHED_CHOICES, params.matched, 'matched'),
    choice('country', 'Country', countryChoices(summary, params.country), params.country, 'country'),
    choice('source', 'Source', sourceChoices(), params.source, 'source'),
    choice('unsubscribed', 'Emails', UNSUBSCRIBED_CHOICES, params.unsubscribed, 'unsub'),
  );

  const remove = (e: FoundingEntry) =>
    void openDialog({
      title: C.removeTitle,
      eyebrow: `${e.firstName} · ${e.email}`,
      danger: true,
      body: h('p', { class: 'dialog__text' }, C.removeBody),
      phrase: removePhrase(e.id),
      confirmLabel: C.remove,
      cancelLabel: 'Keep',
      submit: async () => {
        await ctx.api.removeFounding(e.id, removePhrase(e.id));
      },
    }).then((r) => {
      if (!r) return;
      notify(C.removed);
      ctx.reload();
    });

  const isFiltered = filtered(params);
  return section(
    C.people,
    [
      filters,
      table<FoundingEntry>(
        [
          { label: 'Email', cell: (e) => h('span', { data: { testid: 'founding-email' } }, e.email), kind: ['email'] },
          { label: 'First name', cell: (e) => e.firstName, kind: ['nowrap'] },
          { label: 'Country', cell: (e) => countryText(e.country), kind: ['nowrap'] },
          { label: 'Source', cell: (e) => sourceText(e), kind: ['wide'] },
          { label: 'Joined', cell: (e) => joinedText(e), kind: ['nowrap'] },
          {
            label: 'Account',
            cell: (e) =>
              e.accountId ? h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: e.accountId }), 'data-testid': 'founding-account' } }, C.clientSheet) : h('span', { class: 'soft' }, C.notMatched),
            kind: ['nowrap'],
          },
          { label: 'Emails', cell: (e) => h('span', { data: { testid: 'founding-status' } }, statusText(e), unsubscribedDay(e) ? h('span', { class: 'cell-sub' }, unsubscribedDay(e)) : null), kind: ['nowrap'] },
          ...(canRemove
            ? [{ label: 'Actions', hiddenLabel: true, cell: (e: FoundingEntry) => h('span', { class: 'row-actions' }, button(C.remove, { kind: 'ghost', testId: 'founding-remove', onClick: () => remove(e) })), kind: ['actions' as const] }]
            : []),
        ],
        list.items,
        { caption: C.people, empty: isFiltered ? C.filteredEmpty : C.empty },
      ),
      pager(list, (p) => ctx.setQuery({ page: p })),
    ],
    { id: 'founding-people', note: peopleLine(list.total, isFiltered) },
  );
}

/** The segment: its link once made, or Make the segment (OPERATOR). */
function segmentSection(ctx: ViewContext, segments: Segment[] | null, canMake: boolean): HTMLElement {
  const made = segments ? foundingSegmentOf(segments) : null;
  let body: HTMLElement;
  let tools: HTMLElement[] = [];
  if (made) {
    body = defList([
      {
        label: 'Segment',
        value: h('a', { class: 'idlink', attrs: { href: href('segment', { segmentId: made.id }), 'data-testid': 'founding-segment' } }, made.name),
        note: membersLine(made.count),
      },
    ]);
    tools = [linkButton(C.openSegment, href('segment', { segmentId: made.id }), 'ghost')];
  } else {
    body = defList([{ label: 'Segment', value: h('span', { data: { testid: 'founding-segment-none' } }, segments === null ? C.segmentsUnread : canMake ? C.noSegment : C.noSegmentAuditor) }]);
    if (canMake && segments) {
      const b = button(C.makeSegment, { kind: 'primary', testId: 'founding-make-segment' });
      b.addEventListener('click', () =>
        void busy(b, async () => {
          try {
            const criteria: SegmentGroup = JSON.parse(JSON.stringify(FOUNDING_SEGMENT_CRITERIA)) as SegmentGroup;
            await ctx.api.createSegment({ name: foundingSegmentName(segments.map((s) => s.name)), criteria });
            notify(C.segmentMade);
            ctx.reload();
          } catch (e) {
            notifyError(e);
          }
        }, 'Making…'),
      );
      tools = [b];
    }
  }
  return section(C.segment, [h('p', { class: 'founding__lead' }, C.segmentLead), body], { id: 'founding-segment-part', tools });
}

/** Download (CSV): every row, in a Shopify customers import's columns. */
function csvButton(ctx: ViewContext): HTMLButtonElement {
  const b = button(C.csv, { kind: 'ghost', testId: 'founding-csv', title: C.csvNote });
  b.addEventListener('click', () =>
    void busy(b, async () => {
      try {
        saveDownload(await ctx.api.foundingCsv());
      } catch (e) {
        notifyError(e);
      }
    }),
  );
  return b;
}
