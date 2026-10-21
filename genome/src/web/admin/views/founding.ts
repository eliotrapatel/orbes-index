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
 *  - The founding announcement (plan MACRO M1 §4.3, E1, F6), after the segment: the channel and the email's switch, the
 *    people it reaches, a release chosen among those published and not over (what the email says of it, its opening,
 *    its emails, when the queued ones go), the email as it would go now (ui/email-frame.ts); Send now or Send at the
 *    opening (ADMIN, the phrase SEND <8>), Cancel scheduled while some wait; each refusal said beside its button. Read
 *    from GET /api/admin/email/announcement (routes/admin/email.ts); its words are the Emails page's.
 * Model in model/founding.ts and model/emails.ts. Each change is audited by the server.
 */
import { h, mount } from '../../shared/dom.js';
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
import {
  announcementEmailsText,
  announcementOffer,
  announcementPhrase,
  chosenRelease,
  EMAILS_COPY as E,
  reachText,
  releaseChoiceLabel,
  sendBody,
  sentText,
} from '../model/emails.js';
import { parisDateTime } from '../model/links.js';
import { membersLine } from '../model/segments.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import type { AnnouncementRelease, AnnouncementState, FoundingEntry, FoundingSummary, Segment, SegmentGroup } from '../types.js';
import { barList, busy, button, defList, emptyState, failure, field, filterBar, kpi, linkButton, loading, pageHeader, pager, section, select, statusMark, table } from '../ui/components.js';
import { emailViewer, type EmailView } from '../ui/email-frame.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function foundingView(ctx: ViewContext): Promise<HTMLElement> {
  const params = foundingParams(ctx.route.query);
  const [summary, list, segments, announcement] = await Promise.all([
    ctx.api.foundingSummary(),
    ctx.api.founding({ ...foundingFilters(params), page: pageParam(ctx), pageSize: FOUNDING_PAGE_SIZE }),
    ctx.api.segments().catch((): Segment[] | null => null),
    ctx.api.announcement().catch((): AnnouncementState | null => null),
  ]);
  const role = ctx.session.admin.role;
  const acts = foundingActions(role);

  const csv = acts.csv ? csvButton(ctx) : null;
  const header = pageHeader({ eyebrow: 'Clients', title: 'Founding list', lead: C.lead, actions: csv && summary.total > 0 ? [csv] : [] });

  if (summary.total === 0) {
    return h(
      'div',
      { class: 'view view--founding' },
      header,
      section(C.people, emptyState(C.empty), { id: 'founding-people' }),
      segmentSection(ctx, segments, acts.makeSegment),
      announcementSection(ctx, announcement, can(role, 'sendAnnouncement')),
    );
  }

  return h(
    'div',
    { class: 'view view--founding' },
    header,
    h('div', { class: 'kpis', data: { testid: 'founding-kpis' } }, ...foundingKpis(summary).map((k) => kpi(k.label, k.value, k.note, k.tone))),
    segmentSection(ctx, segments, acts.makeSegment),
    announcementSection(ctx, announcement, can(role, 'sendAnnouncement')),
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

// ── The founding announcement (E1, F6) ───────────────────────────────────────────────────────────────────────────

/** The version of its preview chosen (DARK · LIGHT · PLAIN TEXT), kept while the console is open. */
let announcementView: EmailView = 'dark';

/**
 * The founding announcement: the channel, the email's switch and its reach, then a release chosen, the email as it
 * would go, and what may be done (ADMIN). Drawn again in place after a send or a cancel, the release kept.
 */
function announcementSection(ctx: ViewContext, first: AnnouncementState | null, canSend: boolean): HTMLElement {
  const emailsLink = linkButton(E.emailsPage, href('emailSettings', {}, { kind: 'FOUNDING_ANNOUNCEMENT' }), 'ghost');
  if (first === null) {
    return section(E.announcement, [h('p', { class: 'founding__lead' }, E.announcementLead), defList([{ label: 'Announcement', value: h('span', { data: { testid: 'founding-announcement-unread' } }, E.announcementUnread) }])], {
      id: 'founding-announcement',
      tools: [emailsLink],
    });
  }
  const body = h('div', { class: 'founding__announcement' });
  let state = first;
  let chosen: string | null = null;
  let previewTurn = 0;

  const draw = () => {
    const r = chosenRelease(state, chosen);
    chosen = r?.id ?? null;
    const facts = defList([
      { label: 'Channel', value: h('span', { data: { testid: 'founding-announcement-channel' } }, statusMark(state.channel ? 'ON' : 'OFF', state.channel ? 'solid' : 'muted')), note: state.channel ? undefined : E.channelOff },
      {
        label: 'The email',
        value: h('span', { data: { testid: 'founding-announcement-switch' } }, statusMark(state.enabled ? 'ON' : 'OFF', state.enabled ? (state.channel ? 'solid' : 'outline') : 'muted')),
        note: state.enabled ? (state.channel ? undefined : E.willSend) : 'Switched on and worded on the Emails page.',
      },
      { label: 'Reach', value: h('span', { data: { testid: 'founding-announcement-reach' } }, reachText(state.reach)), note: 'Those who have not unsubscribed.' },
    ]);
    if (!r) {
      mount(body, facts, h('div', { data: { testid: 'founding-announcement-none' } }, emptyState(E.noRelease)));
      return;
    }
    const pick = select('release', state.releases.map((x) => ({ value: x.id, label: releaseChoiceLabel(x) })), r.id);
    pick.setAttribute('data-testid', 'founding-announcement-release');
    pick.addEventListener('change', () => {
      chosen = pick.value;
      draw();
    });
    const preview = h('div', { class: 'founding__preview', data: { testid: 'founding-announcement-preview' } }, loading());
    const mine = ++previewTurn;
    void ctx.api.announcementPreview(r.id).then(
      (email) => {
        if (mine === previewTurn) mount(preview, emailViewer(email, { view: announcementView, onView: (v) => (announcementView = v), note: 'As it would go now, with an example first name.' }));
      },
      () => {
        if (mine === previewTurn) mount(preview, failure(E.previewFailed));
      },
    );
    mount(
      body,
      facts,
      h(
        'div',
        { class: 'founding__release' },
        h(
          'div',
          { class: 'founding__release-side' },
          field(E.release, pick, { wide: true }),
          defList([
            { label: 'It says', value: h('span', { data: { testid: 'founding-announcement-words' } }, r.words), note: r.mode === 'LIVE' && !r.announced ? 'Not announced yet.' : undefined },
            { label: 'Opens', value: parisDateTime(r.opensAt) },
            { label: 'Emails', value: h('span', { data: { testid: 'founding-announcement-emails' } }, announcementEmailsText(r.emails)) },
            { label: 'Scheduled', value: h('span', { data: { testid: 'founding-announcement-scheduled' } }, r.scheduledAt ? parisDateTime(r.scheduledAt) : '—') },
          ]),
          canSend ? actions(r) : h('p', { class: 'founding__why' }, E.adminSends),
        ),
        preview,
      ),
    );
  };

  const reread = async () => {
    try {
      state = await ctx.api.announcement();
    } catch {
      /* the panel stays as read; the next visit reads it again */
    }
    draw();
  };

  const actions = (r: AnnouncementRelease): HTMLElement => {
    const offer = announcementOffer(state, r, ctx.now());
    const send = (when: 'NOW' | 'OPENING') =>
      void openDialog({
        title: E.sendTitle,
        eyebrow: r.title,
        body: h('p', { class: 'dialog__text' }, sendBody(state, r, when)),
        phrase: announcementPhrase(r.id),
        confirmLabel: when === 'NOW' ? E.sendNow : E.sendAtOpening,
        working: 'Sending…',
        submit: async () => {
          const res = await ctx.api.sendAnnouncement(r.id, when, announcementPhrase(r.id));
          notify(sentText(res.queued, res.notBefore, ctx.now()));
        },
      }).then((v) => {
        if (v) void reread();
      });
    const now = button(E.sendNow, { kind: 'primary', testId: 'founding-announcement-now', disabled: !offer.now.ok, onClick: () => send('NOW') });
    const opening = offer.atOpening.shown ? button(E.sendAtOpening, { kind: 'secondary', testId: 'founding-announcement-opening', disabled: !offer.atOpening.ok, onClick: () => send('OPENING') }) : null;
    const cancel = offer.cancel
      ? button(E.cancel, {
          kind: 'ghost',
          testId: 'founding-announcement-cancel',
          onClick: () =>
            void openDialog({
              title: E.cancelTitle,
              eyebrow: r.title,
              danger: true,
              body: h('p', { class: 'dialog__text' }, E.cancelBody),
              confirmLabel: E.cancel,
              cancelLabel: 'Keep',
              submit: async () => {
                const res = await ctx.api.cancelAnnouncement(r.id);
                notify(`${res.cancelled} ${res.cancelled === 1 ? 'email' : 'emails'} cancelled.`);
              },
            }).then((v) => {
              if (v) void reread();
            }),
        })
      : null;
    // Why a button waits: the channel, the switch, nobody on the list, a LIVE RELEASE not announced.
    const why = offer.now.why ?? (offer.atOpening.shown ? offer.atOpening.why : null);
    return h(
      'div',
      { class: 'founding__send' },
      h('div', { class: 'founding__buttons' }, now, opening, cancel),
      why ? h('p', { class: 'founding__why', data: { testid: 'founding-announcement-why' } }, why) : null,
    );
  };

  draw();
  return section(E.announcement, [h('p', { class: 'founding__lead' }, E.announcementLead), body], { id: 'founding-announcement', tools: [emailsLink] });
}
