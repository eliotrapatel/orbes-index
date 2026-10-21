/**
 * The House messages page, `#/house-messages` (plan MACRO M2 §1.6, scope D24 M1 and M2): what ORBES writes to collectors
 * in MESSAGES, read from GET /api/admin/house/moments and /messages (server: routes/admin/house.ts,
 * services/house-moments.ts, services/house-messages.ts). Under Messages in the sidebar (Clients), its two tabs:
 *
 *  - MOMENTS (`?tab=moments`, the default): the six moments, each its name and what triggers it, its switch (ADMIN:
 *    Switch on asks first and says that nothing is sent for what happened before; Switch off at once), delivered and
 *    read over 30 days and in all, its words, default or edited. A moment's words (`?moment=`) over the list: the title
 *    and the words (OPERATOR; an AUDITOR reads them), the placeholders it fills, its links, the preview drawn again as
 *    they are written (ui/house-preview.ts: DARK · LIGHT, PHONE · COMPUTER), Save the words, Back to the default words.
 *  - MESSAGES (`?tab=messages`): the custom messages, newest first, by status (draft, scheduled with its time in Paris,
 *    sent with reached, read and the share, cancelled); New message (OPERATOR). A message (`?message=<id>` or `new`):
 *    its title and words ({firstName} only, no link), its audience (a tier and above, or a segment) with its reach read
 *    live, the preview, Save (OPERATOR); Send… with Send now or Schedule in Paris, the reach repeated and SEND typed,
 *    then Reschedule… and Cancel the message (ADMIN); Delete the draft (OPERATOR). A sent message is read-only, its
 *    figures with it.
 * Words or a message not saved hold the page (ui/leave-guard.ts). Model in model/house-messages.ts. Every change is
 * audited by the server. Every time in Paris.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { HOUSE } from '../../../shared/house-words.js';
import { ApiError } from '../api.js';
import {
  audienceDraftOf,
  audienceOf,
  authorLine,
  bodyProblem,
  customPreview,
  defaultScheduleValue,
  HOUSE_COPY as C,
  HOUSE_MOMENT_INFO,
  HOUSE_PAGE_SIZE,
  HOUSE_PLACEHOLDER_WORDS,
  houseActions,
  houseParams,
  isMomentDraftChanged,
  linkWords,
  messageOffer,
  messagesLine,
  momentFigures,
  momentName,
  momentSwitch,
  momentWords,
  momentWordsChange,
  momentWordsState,
  parisInputValue,
  reachedText,
  reachText,
  readText,
  sameAudience,
  scheduleProblem,
  sendLine,
  sentToast,
  STATUS_CHOICES,
  statusTone,
  statusWhen,
  statusWords,
  switchOnBody,
  TIER_CHOICES,
  titleProblem,
  unknownLine,
  unknownPlaceholders,
  type AudienceDraft,
  type HouseActions,
  type HouseParams,
  type HousePreviewItem,
  type MessageOffer,
} from '../model/house-messages.js';
import { parisDateTime } from '../model/links.js';
import { href } from '../router.js';
import { HOUSE_BODY_MAX, HOUSE_TITLE_MAX, type HouseAudience, type HouseMessage, type HouseMessageDetail, type HouseMomentView, type HousePlaceholderName, type Paged, type SegmentName } from '../types.js';
import { busy, button, defList, failure, field, filterBar, input, linkButton, loading, pageHeader, pager, section, select, setFieldError, statusMark, table, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { housePreview } from '../ui/house-preview.js';
import { holdPage } from '../ui/leave-guard.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

export async function houseMessagesView(ctx: ViewContext): Promise<HTMLElement> {
  const params = houseParams(ctx.route.query);
  const acts = houseActions(ctx.session.admin.role);
  const header = pageHeader({
    eyebrow: 'Clients',
    title: 'House messages',
    lead: C.lead,
    actions: [linkButton('Messages', href('messages'), 'ghost'), linkButton(C.segmentsPage, href('segments'), 'ghost')],
  });
  const parts: Child[] = params.tab === 'moments' ? await momentsTab(ctx, params, acts) : await messagesTab(ctx, params, acts);
  return h('div', { class: 'view view--house' }, header, tabs(params), ...parts);
}

/** MOMENTS · MESSAGES, as links (the console's local tabs). */
function tabs(p: HouseParams): HTMLElement {
  const items = [
    { key: 'moments', text: C.moments, href: href('houseMessages', {}, { tab: 'moments' }), current: p.tab === 'moments' },
    { key: 'messages', text: C.messages, href: href('houseMessages', {}, { tab: 'messages' }), current: p.tab === 'messages' },
  ];
  return h(
    'nav',
    { class: ['range', 'house__tabs'], attrs: { 'aria-label': C.tabs } },
    ...items.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: t.href, 'aria-current': t.current ? 'page' : null, 'data-testid': `house-tab-${t.key}` } }, t.text),
    ]),
  );
}

/** A moment's or a message's preview item from its words, links and time. */
function momentItem(title: string, body: string, links: readonly string[], at: Date): HousePreviewItem {
  return { author: authorLine(HOUSE.author, at), title, body, links: [...links] };
}

/** The placeholders a set of words may hold, each placed where the cursor is (OPERATOR) and what it is filled with. */
function placeholdersBlock(names: readonly HousePlaceholderName[], edit: boolean, place: (name: string) => void, notes: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'emails__placeholders house__placeholders', data: { testid: 'house-placeholders' } },
    h('p', { class: 'emails__sub' }, C.placeholders),
    h(
      'dl',
      { class: 'emails__tokens' },
      ...names.map((p) =>
        h(
          'div',
          { class: 'emails__token' },
          h('dt', null, edit ? button(`{${p}}`, { kind: 'ghost', testId: `house-place-${p}`, title: `Place {${p}}`, onClick: () => place(p) }) : h('span', { class: 'mono' }, `{${p}}`)),
          h('dd', null, HOUSE_PLACEHOLDER_WORDS[p]),
        ),
      ),
    ),
    edit ? h('p', { class: 'emails__hint' }, C.placeholdersNote) : null,
    ...notes,
  );
}

/** Place `{name}` where the cursor is in the last field focused. */
function placer(fields: (HTMLInputElement | HTMLTextAreaElement)[], fallback: HTMLInputElement | HTMLTextAreaElement): (name: string) => void {
  let last = fallback;
  for (const f of fields) f.addEventListener('focus', () => (last = f));
  return (name: string) => {
    const token = `{${name}}`;
    const start = last.selectionStart ?? last.value.length;
    const end = last.selectionEnd ?? start;
    last.setRangeText(token, start, end, 'end');
    last.focus();
    last.dispatchEvent(new Event('input', { bubbles: true }));
  };
}

// ── MOMENTS ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function momentsTab(ctx: ViewContext, params: HouseParams, acts: HouseActions): Promise<Child[]> {
  let moments: HouseMomentView[];
  try {
    moments = await ctx.api.houseMoments();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    return [section(C.momentsTitle, failure('The moments could not be read.', () => ctx.reload()), { id: 'house-moments' })];
  }
  const listBody = h('div', { class: 'house__moments' });
  const drawList = () => mount(listBody, momentsTable(ctx, moments, acts, params, drawList));
  drawList();
  const open = params.moment ? (moments.find((m) => m.moment === params.moment) ?? null) : null;
  return [open ? momentEditor(ctx, moments, open, acts, drawList) : null, section(C.momentsTitle, listBody, { id: 'house-moments', note: C.momentsNote })];
}

/** Switch on (asked first, with the no-back-fill sentence) or Switch off (at once); the moment updated in `moments`. */
async function toggleMoment(ctx: ViewContext, moments: HouseMomentView[], m: HouseMomentView, b: HTMLButtonElement, after: () => void): Promise<void> {
  const replace = (next: HouseMomentView) => {
    const i = moments.findIndex((x) => x.moment === next.moment);
    if (i >= 0) moments[i] = next;
  };
  if (!m.enabled) {
    const done = await openDialog({
      title: C.switchOnTitle,
      eyebrow: momentName(m.moment),
      body: [h('p', { class: 'dialog__text' }, switchOnBody(m.moment))],
      confirmLabel: C.switchOn,
      submit: async () => replace(await ctx.api.setHouseMomentEnabled(m.moment, true)),
    });
    if (!done) return;
    notify(C.switchedOn);
    after();
    return;
  }
  await busy(b, async () => {
    try {
      replace(await ctx.api.setHouseMomentEnabled(m.moment, false));
      notify(C.switchedOff);
      after();
    } catch (e) {
      notifyError(e);
    }
  });
}

function switchCell(m: HouseMomentView): HTMLElement {
  const s = momentSwitch(m);
  return h('span', { class: 'emails__switch', data: { testid: 'house-switch-state', moment: m.moment } }, statusMark(s.text, s.tone), h('span', { class: 'cell-sub' }, s.note));
}

function momentsTable(ctx: ViewContext, moments: HouseMomentView[], acts: HouseActions, params: HouseParams, redraw: () => void): HTMLElement {
  const wordsHref = (m: HouseMomentView) => href('houseMessages', {}, { tab: 'moments', moment: m.moment });
  return table<HouseMomentView>(
    [
      {
        label: 'Moment',
        cell: (m) =>
          h(
            'span',
            { class: 'emails__kind' },
            h('a', { class: 'idlink', attrs: { href: wordsHref(m), 'data-testid': 'house-moment' } }, momentName(m.moment)),
            h('span', { class: 'cell-sub' }, HOUSE_MOMENT_INFO[m.moment].when),
          ),
        kind: ['wide'],
      },
      { label: 'Switch', cell: (m) => switchCell(m), kind: ['nowrap'] },
      { label: `${C.delivered} · ${C.days30}`, cell: (m) => h('span', { data: { testid: 'house-figures-30' } }, momentFigures(m.figures).days30), kind: ['nowrap'] },
      { label: C.inAll, cell: (m) => h('span', { data: { testid: 'house-figures-all' } }, momentFigures(m.figures).all), kind: ['nowrap'] },
      { label: 'Words', cell: (m) => h('span', { data: { testid: 'house-words-state' } }, momentWordsState(m)), kind: ['nowrap'] },
      {
        label: 'Actions',
        hiddenLabel: true,
        cell: (m) => {
          const actions: HTMLElement[] = [];
          if (acts.switch) {
            const b = button(m.enabled ? C.switchOff : C.switchOn, { kind: 'ghost', testId: 'house-switch' });
            b.addEventListener('click', () => void toggleMoment(ctx, moments, m, b, redraw));
            actions.push(b);
          }
          actions.push(linkButton(acts.edit ? C.editWords : C.readWords, wordsHref(m), 'ghost'));
          return h('span', { class: 'row-actions' }, ...actions);
        },
        kind: ['actions', 'wrap'],
      },
    ],
    moments,
    { caption: C.momentsTitle, current: (m) => m.moment === params.moment },
  );
}

function momentEditor(ctx: ViewContext, moments: HouseMomentView[], m0: HouseMomentView, acts: HouseActions, redrawList: () => void): HTMLElement {
  let m = m0;
  const info = HOUSE_MOMENT_INFO[m.moment];
  const words0 = momentWords(m);
  const title = input('title', { value: words0.title, maxlength: HOUSE_TITLE_MAX });
  const body = textarea('body', { rows: 8, maxlength: HOUSE_BODY_MAX });
  body.value = words0.body;
  title.setAttribute('data-testid', 'house-title');
  body.setAttribute('data-testid', 'house-body');
  title.readOnly = !acts.edit;
  body.readOnly = !acts.edit;
  const form = h('div', { class: 'emails__fields' }, field(C.title, title, { hint: C.titleHint, wide: true }), field(C.body, body, { hint: C.bodyHint, wide: true }));
  const warn = h('p', { class: 'emails__warn', attrs: { role: 'status' }, data: { testid: 'house-unknown' } });
  const draft = () => ({ title: title.value, body: body.value });
  const place = placer([title, body], body);
  const linksLine = h(
    'p',
    { class: 'house__links', data: { testid: 'house-links' } },
    h('span', { class: 'emails__sub' }, C.links),
    h('span', null, m.links.map(linkWords).join(' · ')),
  );
  const placeholders = placeholdersBlock(m.placeholders, acts.edit, place, [h('p', { class: 'emails__hint' }, C.firstNameNote)]);

  // The switch, here too, and the figures.
  const switchLine = h('div', { class: 'emails__state' });
  const drawSwitch = () => {
    const parts: HTMLElement[] = [switchCell(m)];
    if (acts.switch) {
      const b = button(m.enabled ? C.switchOff : C.switchOn, { kind: 'secondary', testId: 'house-editor-switch' });
      b.addEventListener('click', () =>
        void toggleMoment(ctx, moments, m, b, () => {
          m = moments.find((x) => x.moment === m.moment) ?? m;
          drawSwitch();
          redrawList();
        }),
      );
      parts.push(b);
    }
    mount(switchLine, ...parts);
  };
  drawSwitch();
  const figures = momentFigures(m.figures);
  const facts = defList(
    [
      { label: `${C.delivered} · ${C.days30}`, value: figures.days30 },
      { label: `${C.delivered} · ${C.inAll}`, value: figures.all },
    ],
    'house__facts',
  );

  // The preview, drawn again as the words are written (OPERATOR; an AUDITOR reads the moment's own).
  const preview = h('div', { class: 'house__preview-box', data: { testid: 'house-moment-preview' } }, loading());
  let turn = 0;
  const drawPreview = async (words?: { title: string; body: string }) => {
    const mine = ++turn;
    try {
      const sent = acts.edit && words ? { title: words.title.trim() === '' ? null : words.title, body: words.body.trim() === '' ? null : words.body } : undefined;
      const r = await ctx.api.houseMomentPreview(m.moment, sent);
      if (mine !== turn) return;
      mount(preview, housePreview(momentItem(r.title, r.body, r.links.map(linkWords), ctx.now()), { note: C.previewNote }));
    } catch (e) {
      if (mine !== turn) return;
      // Words the server refuses (a placeholder this moment does not fill) are said under the fields; the last preview stays.
      if (e instanceof ApiError && (e.status === 400 || e.status === 422) && preview.querySelector('.house-view')) return;
      mount(preview, failure(C.previewFailed, () => void drawPreview(draft())));
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = button(C.save, { kind: 'primary', testId: 'house-save', disabled: true });
  const reset = button(C.reset, { kind: 'ghost', testId: 'house-reset' });
  let release: (() => void) | null = null;
  const problems = () => {
    const d = draft();
    return { title: titleProblem(d.title, true), body: bodyProblem(d.body, true), unknown: unknownPlaceholders(d, m.placeholders) };
  };
  const sync = () => {
    const d = draft();
    const changed = isMomentDraftChanged(m, d);
    const p = problems();
    setFieldError(form, 'title', changed ? (p.title ?? undefined) : undefined);
    setFieldError(form, 'body', changed ? (p.body ?? undefined) : undefined);
    warn.textContent = unknownLine(p.unknown, m.placeholders) ?? '';
    save.disabled = !changed || p.title !== null || p.body !== null || p.unknown.length > 0;
    reset.hidden = m.title === null && m.body === null && !changed;
    if (changed && !release) release = holdPage(C.unsaved, 'House messages');
    if (!changed && release) {
      release();
      release = null;
    }
  };
  const onInput = () => {
    sync();
    clearTimeout(timer);
    const p = problems();
    if (p.title !== null || p.body !== null || p.unknown.length > 0) return;
    const d = draft();
    timer = setTimeout(() => void drawPreview(d), 350);
  };
  title.addEventListener('input', onInput);
  body.addEventListener('input', onInput);

  let noteOf: HTMLElement | null = null;
  const adopt = (next: HouseMomentView) => {
    m = next;
    if (noteOf) noteOf.textContent = momentWordsState(next);
    const i = moments.findIndex((x) => x.moment === next.moment);
    if (i >= 0) moments[i] = next;
    const w = momentWords(next);
    title.value = w.title;
    body.value = w.body;
    sync();
    redrawList();
    void drawPreview(draft());
  };
  save.addEventListener('click', () =>
    void busy(save, async () => {
      const p = problems();
      setFieldError(form, 'title', p.title ?? undefined);
      setFieldError(form, 'body', p.body ?? undefined);
      if (p.title || p.body || p.unknown.length) return;
      try {
        adopt(await ctx.api.setHouseMomentWords(m.moment, momentWordsChange(m, draft())));
        notify(C.saved);
      } catch (e) {
        notifyError(e);
      }
    }, 'Saving…'),
  );
  reset.addEventListener('click', () =>
    void openDialog({
      title: C.reset,
      eyebrow: momentName(m.moment),
      body: h('p', { class: 'dialog__text' }, C.resetBody),
      confirmLabel: C.reset,
      submit: async () => adopt(await ctx.api.setHouseMomentWords(m.moment, { title: null, body: null })),
    }).then((r) => {
      if (r) notify(C.resetDone);
    }),
  );

  sync();
  void drawPreview();

  const left = h(
    'div',
    { class: 'emails__form' },
    h('p', { class: 'emails__lead' }, info.when),
    switchLine,
    facts,
    form,
    warn,
    placeholders,
    linksLine,
    acts.edit ? h('div', { class: 'emails__actions' }, save, reset) : h('p', { class: 'emails__hint' }, C.readOnly),
  );
  const part = section(
    momentName(m.moment),
    h('div', { class: 'emails__editor house__editor' }, left, h('div', { class: 'house__preview' }, h('p', { class: 'emails__sub' }, C.preview), preview)),
    { id: 'house-moment-editor', note: momentWordsState(m), tools: [linkButton(C.close, href('houseMessages', {}, { tab: 'moments' }), 'ghost')] },
  );
  noteOf = part.querySelector<HTMLElement>('.panel__note');
  return part;
}

// ── MESSAGES ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function messagesTab(ctx: ViewContext, params: HouseParams, acts: HouseActions): Promise<Child[]> {
  const list = (async (): Promise<HTMLElement> => {
    try {
      const page = await ctx.api.houseMessages({ ...(params.status ? { status: params.status } : {}), page: pageParam(ctx), pageSize: HOUSE_PAGE_SIZE });
      return messagesSection(ctx, page, params, acts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e;
      return section(C.messagesTitle, failure('The messages could not be read.', () => ctx.reload()), { id: 'house-messages' });
    }
  })();
  const editor = params.message ? messageEditor(ctx, params, acts) : Promise.resolve(null);
  return [await editor, await list];
}

function messagesSection(ctx: ViewContext, page: Paged<HouseMessage>, params: HouseParams, acts: HouseActions): HTMLElement {
  const now = ctx.now();
  const status = select('status', [...STATUS_CHOICES], params.status ?? '');
  status.setAttribute('data-testid', 'house-filter-status');
  status.addEventListener('change', () => ctx.setQuery({ status: status.value || null, page: null }));
  const openHref = (m: HouseMessage) => href('houseMessages', {}, { tab: 'messages', message: m.id, status: params.status });
  return section(
    C.messagesTitle,
    [
      filterBar(field('Status', status)),
      table<HouseMessage>(
        [
          {
            label: 'Message',
            cell: (m) =>
              h(
                'span',
                { class: 'emails__kind' },
                h('a', { class: ['idlink', 'house__title-link'], attrs: { href: openHref(m), 'data-testid': 'house-message' } }, m.title),
                h('span', { class: 'cell-sub' }, `Written ${parisDateTime(m.createdAt)}${m.createdBy ? ` · ${m.createdBy.email}` : ''}`),
              ),
            kind: ['wide'],
          },
          { label: C.audience, cell: (m) => h('span', { data: { testid: 'house-message-audience' } }, m.audience.label), kind: ['nowrap'] },
          {
            label: 'Status',
            cell: (m) => h('span', { data: { testid: 'house-message-status' } }, statusMark(statusWords(m.status), statusTone(m.status)), h('span', { class: 'cell-sub' }, statusWhen(m, now))),
            kind: ['nowrap'],
          },
          { label: 'Reached', cell: (m) => h('span', { data: { testid: 'house-message-reached' } }, reachedText(m)), kind: ['num', 'nowrap'] },
          { label: 'Read · share', cell: (m) => h('span', { data: { testid: 'house-message-read' } }, readText(m)), kind: ['num', 'nowrap'] },
        ],
        page.items,
        { caption: C.messagesTitle, empty: params.status ? C.emptyFiltered : C.empty, current: (m) => m.id === params.message },
      ),
      pager(page, (p) => ctx.setQuery({ page: p })),
    ],
    {
      id: 'house-messages',
      note: messagesLine(page.total, params.status !== null),
      tools: acts.edit ? [linkButton(C.newMessage, href('houseMessages', {}, { tab: 'messages', message: 'new' }), 'secondary')] : [],
    },
  );
}

/** The audience select: the tiers and above, then every segment by name. Values `tier:2`, `segment:<id>`. */
function audienceSelect(segments: SegmentName[] | null, d: AudienceDraft): HTMLSelectElement {
  const s = h(
    'select',
    { class: 'cinput cinput--select', attrs: { name: 'audience', 'data-testid': 'house-audience' } },
    h('option', { attrs: { value: '', disabled: true } }, C.chooseSegment),
    h('optgroup', { attrs: { label: C.aTier } }, ...TIER_CHOICES.map((t) => h('option', { attrs: { value: `tier:${t.value}` } }, t.label))),
    segments && segments.length
      ? h('optgroup', { attrs: { label: C.aSegment } }, ...segments.map((g) => h('option', { attrs: { value: `segment:${g.id}` } }, g.name)))
      : null,
  );
  s.value = d.kind === 'TIER' ? `tier:${d.tier}` : `segment:${d.segmentId}`;
  if (s.selectedIndex < 0) s.value = '';
  return s;
}

function draftFromSelect(value: string): AudienceDraft {
  const [kind, v] = value.split(':') as [string, string | undefined];
  return kind === 'segment' ? { kind: 'SEGMENT', segmentId: v ?? '', tier: '2' } : { kind: 'TIER', segmentId: '', tier: v ?? '' };
}

async function messageEditor(ctx: ViewContext, params: HouseParams, acts: HouseActions): Promise<HTMLElement> {
  const isNew = params.message === 'new';
  const closeHref = href('houseMessages', {}, { tab: 'messages', status: params.status });
  const close = linkButton(C.close, closeHref, 'ghost');
  let m: HouseMessageDetail | null = null;
  if (!isNew) {
    try {
      m = await ctx.api.houseMessage(params.message!);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e;
      const words = e instanceof ApiError && e.status === 404 ? 'This message does not exist, or a draft was deleted.' : 'This message could not be read.';
      return section('Message', failure(words, () => ctx.reload()), { id: 'house-message-editor', tools: [close] });
    }
  }
  if (isNew && !acts.edit) return section(C.newTitle, h('p', { class: 'notice' }, C.operatorWrites), { id: 'house-message-editor', tools: [close] });
  const offer = messageOffer(m, acts);
  const segments = offer.editable ? await ctx.api.segmentNames().catch(() => null) : null;

  const at = () => (m?.sentAt ? new Date(m.sentAt) : m?.sendAt ? new Date(m.sendAt) : ctx.now());
  const preview = h('div', { class: 'house__preview-box', data: { testid: 'house-message-preview' } });
  const drawPreview = (words: { title: string; body: string }) => mount(preview, housePreview(customPreview(words, at(), HOUSE.author), { note: C.previewNote }));

  // Its facts: status and time, audience, figures, who wrote, sent or cancelled it.
  const facts = m
    ? defList(
        [
          { label: 'Status', value: h('span', { data: { testid: 'house-editor-status' } }, statusMark(statusWords(m.status), statusTone(m.status))), note: statusWhen(m, ctx.now()) },
          { label: C.audience, value: h('span', { data: { testid: 'house-editor-audience' } }, m.audience.label) },
          ...(m.status === 'SENT'
            ? [
                { label: 'Reached', value: h('span', { data: { testid: 'house-editor-reached' } }, reachedText(m)), note: 'Counted when it went' },
                { label: 'Read · share', value: h('span', { data: { testid: 'house-editor-read' } }, readText(m)) },
              ]
            : []),
          { label: 'Written', value: parisDateTime(m.createdAt), note: m.createdBy?.email },
          ...(m.sentBy ? [{ label: m.status === 'SENT' ? 'Sent by' : 'Scheduled by', value: m.sentBy.email }] : []),
          ...(m.cancelledBy ? [{ label: 'Cancelled by', value: m.cancelledBy.email, note: parisDateTime(m.cancelledAt) }] : []),
        ],
        'house__facts',
      )
    : null;

  const sectionTitle = m ? m.title : C.newTitle;
  const actions = h('div', { class: 'emails__actions' });

  // Read-only: a sent or cancelled message, or a reader who does not write.
  if (!offer.editable) {
    drawPreview({ title: m!.title, body: m!.body });
    const reach = m!.reachNow !== null ? h('p', { class: 'house__reach', data: { testid: 'house-reach' } }, reachText(m!.reachNow)) : null;
    const made = messageButtons(ctx, m!, offer, () => false);
    const buttons = [made.send, ...made.others].filter((b): b is HTMLButtonElement => b !== null);
    if (buttons.length) mount(actions, ...buttons);
    const left = h(
      'div',
      { class: 'emails__form' },
      facts,
      reach,
      h('div', { class: 'house__words' }, h('p', { class: 'emails__sub' }, C.title), h('p', { class: 'house__words-title' }, m!.title), h('p', { class: 'emails__sub' }, C.body), h('p', { class: 'house__words-body' }, m!.body)),
      buttons.length ? actions : null,
      (m!.status === 'DRAFT' || m!.status === 'SCHEDULED') && !acts.edit ? h('p', { class: 'emails__hint' }, C.readOnlyMessage) : null,
    );
    return section(sectionTitle, h('div', { class: 'emails__editor house__editor' }, left, h('div', { class: 'house__preview' }, h('p', { class: 'emails__sub' }, C.preview), preview)), {
      id: 'house-message-editor',
      tools: [close],
    });
  }

  // The form (OPERATOR, a draft or a scheduled message).
  const title = input('title', { value: m?.title ?? '', maxlength: HOUSE_TITLE_MAX });
  const body = textarea('body', { rows: 10, maxlength: HOUSE_BODY_MAX });
  body.value = m?.body ?? '';
  title.setAttribute('data-testid', 'house-title');
  body.setAttribute('data-testid', 'house-body');
  let audienceDraft = audienceDraftOf(m);
  const audience = audienceSelect(segments, audienceDraft);
  const reach = h('p', { class: 'house__reach', attrs: { 'aria-live': 'polite' }, data: { testid: 'house-reach' } });
  const form = h(
    'div',
    { class: 'emails__fields' },
    field(C.title, title, { hint: C.titleHint, wide: true }),
    field(C.body, body, { hint: C.customHint, wide: true }),
    field(C.audience, audience, { hint: segments && segments.length ? 'A tier reaches that tier and the ones above it.' : C.noSegments, wide: true }),
  );
  const warn = h('p', { class: 'emails__warn', attrs: { role: 'status' }, data: { testid: 'house-unknown' } });
  const place = placer([title, body], body);
  const placeholders = placeholdersBlock(['firstName'], true, place, [h('p', { class: 'emails__hint' }, C.firstNameNote)]);

  const draft = () => ({ title: title.value, body: body.value });
  const saved = () => ({ title: m?.title ?? '', body: m?.body ?? '' });
  // A new message starts from the default audience (PLATINE and above): opening one and leaving it untouched is no change.
  const savedAudience = m ? (m.audience.segmentId ? { segmentId: m.audience.segmentId } : m.audience.tier ? { tier: m.audience.tier } : null) : audienceOf(audienceDraftOf(null));
  const changed = () => {
    const d = draft();
    const s = saved();
    return d.title.trim() !== s.title || d.body.replace(/\r\n?/g, '\n').trim() !== s.body || !sameAudience(audienceOf(audienceDraft), savedAudience);
  };
  const problems = () => {
    const d = draft();
    return { title: titleProblem(d.title), body: bodyProblem(d.body), unknown: unknownPlaceholders(d, ['firstName']), audience: audienceOf(audienceDraft) ? null : 'Choose an audience.' };
  };

  // The reach, read again as the audience changes (POST …/count, OPERATOR).
  let reachTurn = 0;
  const drawReach = async () => {
    const mine = ++reachTurn;
    const a = audienceOf(audienceDraft);
    if (!a) {
      reach.textContent = '';
      return;
    }
    reach.textContent = C.reachCounting;
    try {
      const { count } = await ctx.api.houseReach(a);
      if (mine === reachTurn) reach.textContent = reachText(count);
    } catch {
      if (mine === reachTurn) reach.textContent = C.reachUnread;
    }
  };

  const save = button(C.saveDraft, { kind: 'primary', testId: 'house-save', disabled: true });
  let release: (() => void) | null = null;
  let sendButtons: HTMLButtonElement[] = [];
  const sync = () => {
    const isChanged = changed();
    const p = problems();
    const typed = isNew ? draft().title !== '' || draft().body !== '' : isChanged;
    setFieldError(form, 'title', typed ? (p.title ?? undefined) : undefined);
    setFieldError(form, 'body', typed ? (p.body ?? undefined) : undefined);
    warn.textContent = unknownLine(p.unknown, ['firstName']) ?? '';
    save.disabled = !isChanged || p.title !== null || p.body !== null || p.audience !== null || p.unknown.length > 0;
    for (const b of sendButtons) {
      b.disabled = isChanged;
      b.title = isChanged ? C.saveFirst : '';
    }
    if (isChanged && !release) release = holdPage(C.unsavedMessage, 'House messages');
    if (!isChanged && release) {
      release();
      release = null;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onInput = () => {
    sync();
    clearTimeout(timer);
    timer = setTimeout(() => drawPreview(draft()), 150);
  };
  title.addEventListener('input', onInput);
  body.addEventListener('input', onInput);
  audience.addEventListener('change', () => {
    audienceDraft = draftFromSelect(audience.value);
    sync();
    void drawReach();
  });

  save.addEventListener('click', () =>
    void busy(save, async () => {
      const p = problems();
      setFieldError(form, 'title', p.title ?? undefined);
      setFieldError(form, 'body', p.body ?? undefined);
      const a = audienceOf(audienceDraft);
      if (p.title || p.body || p.unknown.length || !a) return;
      const d = draft();
      try {
        if (!m) {
          const created = await ctx.api.createHouseMessage({ title: d.title.trim(), body: d.body.trim(), audience: a });
          release?.();
          release = null;
          notify(C.created);
          ctx.setQuery({ message: created.id, tab: 'messages' });
          return;
        }
        const change: { title?: string; body?: string; audience?: HouseAudience } = {};
        if (d.title.trim() !== m.title) change.title = d.title.trim();
        if (d.body.replace(/\r\n?/g, '\n').trim() !== m.body) change.body = d.body.trim();
        if (!sameAudience(a, m.audience.segmentId ? { segmentId: m.audience.segmentId } : m.audience.tier ? { tier: m.audience.tier } : null)) change.audience = a;
        await ctx.api.updateHouseMessage(m.id, change);
        release?.();
        release = null;
        notify(C.savedDraft);
        ctx.reload();
      } catch (e) {
        notifyError(e);
      }
    }, 'Saving…'),
  );

  const made = m ? messageButtons(ctx, m, offer, changed) : { send: null, others: [] };
  sendButtons = made.send ? [made.send] : [];
  mount(actions, save, ...sendButtons, ...made.others);

  sync();
  drawPreview(draft());
  void drawReach();

  const left = h(
    'div',
    { class: 'emails__form' },
    facts,
    form,
    reach,
    warn,
    placeholders,
    actions,
    m && !acts.send ? h('p', { class: 'emails__hint' }, C.adminSends) : null,
  );
  return section(sectionTitle, h('div', { class: 'emails__editor house__editor' }, left, h('div', { class: 'house__preview' }, h('p', { class: 'emails__sub' }, C.preview), preview)), {
    id: 'house-message-editor',
    note: m ? statusWords(m.status) : undefined,
    tools: [close],
  });
}

/** The buttons of a saved message: Send… or Reschedule… (ADMIN), Cancel the message (ADMIN), Delete the draft (OPERATOR). */
function messageButtons(ctx: ViewContext, m: HouseMessageDetail, offer: MessageOffer, unsaved: () => boolean): { send: HTMLButtonElement | null; others: HTMLButtonElement[] } {
  let send: HTMLButtonElement | null = null;
  if (offer.send) {
    const kind = offer.send;
    send = button(kind === 'SEND' ? C.send : C.reschedule, { kind: kind === 'SEND' ? 'primary' : 'secondary', testId: kind === 'SEND' ? 'house-send' : 'house-reschedule' });
    send.addEventListener('click', () => {
      if (!unsaved()) void sendDialog(ctx, m, kind);
    });
  }
  const others: HTMLButtonElement[] = [];
  if (offer.cancel) others.push(button(C.cancel, { kind: 'ghost', testId: 'house-cancel', onClick: () => void cancelDialog(ctx, m) }));
  if (offer.remove) others.push(button(C.deleteDraft, { kind: 'ghost', testId: 'house-delete', onClick: () => void deleteDialog(ctx, m) }));
  return { send, others };
}

/** SEND NOW or SCHEDULE in Paris, the reach repeated (read again now), the phrase SEND typed (ADMIN). */
async function sendDialog(ctx: ViewContext, m0: HouseMessageDetail, kind: 'SEND' | 'RESCHEDULE'): Promise<void> {
  let m = m0;
  try {
    m = await ctx.api.houseMessage(m0.id);
  } catch {
    /* the reach as read with the page */
  }
  const reach = m.reachNow;
  const startAt = kind === 'RESCHEDULE' && m.sendAt && new Date(m.sendAt).getTime() > ctx.now().getTime() + 60_000 ? parisInputValue(m.sendAt) : defaultScheduleValue(ctx.now());
  const done = await openDialog({
    title: kind === 'SEND' ? C.sendTitle : C.rescheduleTitle,
    eyebrow: m.title,
    fields: [
      {
        name: 'when',
        label: C.when,
        kind: 'select',
        options: [
          { value: 'NOW', label: C.sendNow },
          { value: 'SCHEDULE', label: C.schedule },
        ],
        value: kind === 'SEND' ? 'NOW' : 'SCHEDULE',
      },
      { name: 'at', label: C.at, kind: 'datetime', value: startAt, hint: C.atHint, shown: (v) => v.when === 'SCHEDULE' },
    ],
    live: (v) => h('p', { class: 'dialog__text house__send-line', data: { testid: 'house-send-line' } }, sendLine(m.audience.label, reach, v.when === 'SCHEDULE' ? { now: false, value: v.at ?? '' } : { now: true })),
    validate: (v) => (v.when === 'SCHEDULE' ? scheduleProblem(v.at ?? '', ctx.now()) : null),
    phrase: 'SEND',
    confirmLabel: kind === 'SEND' ? 'Send' : C.reschedule.replace('…', ''),
    working: 'Sending…',
    submit: async (v) => {
      // The dialog holds Confirm until SEND is typed; the server asks for it again.
      const next = await ctx.api.sendHouseMessage(m.id, 'SEND', v.when === 'SCHEDULE' ? (v.at ?? null) : null);
      notify(sentToast(next, ctx.now()));
    },
  });
  if (done) ctx.reload();
}

async function cancelDialog(ctx: ViewContext, m: HouseMessageDetail): Promise<void> {
  const done = await openDialog({
    title: C.cancel,
    eyebrow: m.title,
    body: h('p', { class: 'dialog__text' }, `${C.cancelBody} ${m.sendAt ? `It was to go ${parisDateTime(m.sendAt)}.` : ''}`.trim()),
    confirmLabel: C.cancel,
    danger: true,
    submit: async () => {
      await ctx.api.cancelHouseMessage(m.id);
    },
  });
  if (done) {
    notify(C.cancelled);
    ctx.reload();
  }
}

async function deleteDialog(ctx: ViewContext, m: HouseMessageDetail): Promise<void> {
  const done = await openDialog({
    title: C.deleteDraft,
    eyebrow: m.title,
    body: h('p', { class: 'dialog__text' }, C.deleteBody),
    confirmLabel: C.deleteDraft,
    danger: true,
    submit: async () => {
      await ctx.api.deleteHouseMessage(m.id);
    },
  });
  if (done) {
    notify(C.deleted);
    ctx.setQuery({ message: null });
  }
}
