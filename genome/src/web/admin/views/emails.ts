/**
 * The Emails page, `#/settings/emails` (plan MACRO M1 §4.3, scope E0): every email ORBES sends, read from GET
 * /api/admin/email and its outbox (server: routes/admin/email.ts, services/email.ts). Reached from the Settings page
 * and the Founding list; no link of its own in the sidebar, as the Settings page.
 *
 *  - The channel: OFF (no provider in the server's .env: nothing is sent), or ON with the server's host and the sender.
 *  - The emails, one row per kind: its moment, who receives it, its switch (ADMIN: Switch on asks first, Switch off at
 *    once; on while the channel is off, it says it will send once the channel is on), its words, default or edited.
 *  - A kind's words (`?kind=`), over the list: the subject and the words (OPERATOR; an AUDITOR reads them), the
 *    placeholders its moment fills (one chosen is placed where the cursor is), the preview drawn again as they are
 *    written (DARK · LIGHT · PLAIN TEXT, ui/email-frame.ts), Save the words, Back to the default words, Send a test to
 *    me (ADMIN, only while the channel is on). Words not saved hold the page (ui/leave-guard.ts).
 *  - The outbox: queued, sent, failed and cancelled, the last errors, the emails newest first by status and kind (kept
 *    in the address), each opened as it was sent; the addresses masked for an AUDITOR by the server, a reset link's
 *    code never shown.
 * Model in model/emails.ts. Each change is audited by the server. Every time in Paris.
 */
import { h, mount } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  bodyProblem,
  channelRows,
  EMAIL_KIND_INFO,
  EMAILS_COPY as C,
  emailsActions,
  emailsParams,
  isDraftChanged,
  kindChoices,
  kindName,
  outboxFilters,
  outboxKpis,
  outboxLine,
  outboxWhen,
  OUTBOX_PAGE_SIZE,
  recipientKind,
  STATUS_CHOICES,
  statusTone,
  statusWords,
  subjectProblem,
  switchOnBody,
  switchState,
  unknownLine,
  unknownPlaceholders,
  wordsChange,
  wordsState,
  type EmailsActions,
  type EmailsParams,
} from '../model/emails.js';
import { parisDateTime } from '../model/links.js';
import { href } from '../router.js';
import { EMAIL_TEMPLATE_BODY_MAX, EMAIL_TEMPLATE_SUBJECT_MAX, type EmailKindView, type EmailsState, type EmailWords, type OutboxEmail, type Paged, type RenderedEmail } from '../types.js';
import { busy, button, defList, failure, field, filterBar, input, kpi, linkButton, loading, pageHeader, pager, section, select, setFieldError, statusMark, table, textarea } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { emailViewer, type EmailView } from '../ui/email-frame.js';
import { holdPage } from '../ui/leave-guard.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

/** The version of the previews chosen (DARK · LIGHT · PLAIN TEXT), kept while the console is open. */
let previewView: EmailView = 'dark';

export async function emailsView(ctx: ViewContext): Promise<HTMLElement> {
  const params = emailsParams(ctx.route.query);
  const [state, outbox] = await Promise.all([ctx.api.emails(), ctx.api.emailOutbox({ ...outboxFilters(params), page: pageParam(ctx), pageSize: OUTBOX_PAGE_SIZE })]);
  const acts = emailsActions(ctx.session.admin.role);
  const open = params.kind ? (state.kinds.find((k) => k.kind === params.kind) ?? null) : null;

  // The list of kinds and the outbox are drawn again in place after a change: words being written are never lost.
  const kindsBody = h('div', { class: 'emails__kinds' });
  const drawKinds = () => mount(kindsBody, kindsTable(ctx, state, acts, params, drawKinds));
  drawKinds();
  const outboxPart = h('div', { class: 'emails__outbox' });
  const drawOutbox = (counts: EmailsState['outbox'], page: Paged<OutboxEmail>) => mount(outboxPart, outboxSection(ctx, counts, page, params));
  drawOutbox(state.outbox, outbox);
  const refreshOutbox = async () => {
    try {
      const [s, page] = await Promise.all([ctx.api.emails(), ctx.api.emailOutbox({ ...outboxFilters(params), page: pageParam(ctx), pageSize: OUTBOX_PAGE_SIZE })]);
      drawOutbox(s.outbox, page);
    } catch {
      /* the outbox stays as read; the next visit reads it again */
    }
  };

  return h(
    'div',
    { class: 'view view--emails' },
    pageHeader({
      eyebrow: 'Settings',
      title: 'Emails',
      lead: C.lead,
      actions: [linkButton('Founding list', href('founding'), 'ghost'), linkButton('Settings', href('settings'), 'ghost')],
    }),
    channelSection(state),
    open ? editorSection(ctx, state, open, acts, drawKinds, refreshOutbox) : null,
    section(C.kinds, kindsBody, { id: 'emails-kinds', note: C.kindsNote }),
    outboxPart,
  );
}

// ── The channel ──────────────────────────────────────────────────────────────────────────────────────────────────

function channelSection(state: EmailsState): HTMLElement {
  const rows = channelRows(state.channel);
  return section(
    C.channel,
    [
      defList(
        rows.map((r, i) => ({
          label: r.label,
          value: i === 0 ? h('span', { data: { testid: 'emails-channel' } }, statusMark(r.value, state.channel.on ? 'solid' : 'muted')) : h('span', { class: 'emails__value' }, r.value),
          note: r.note,
        })),
      ),
      state.channel.on ? null : h('p', { class: 'emails__lead' }, C.channelOffNote),
    ],
    { id: 'emails-channel-part' },
  );
}

// ── The kinds ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Switch on (asked first: from now its moment writes it) or Switch off (at once); the kind updated in `state`. */
async function toggle(ctx: ViewContext, state: EmailsState, k: EmailKindView, b: HTMLButtonElement, after: () => void): Promise<void> {
  const replace = (next: EmailKindView) => {
    const i = state.kinds.findIndex((x) => x.kind === next.kind);
    if (i >= 0) state.kinds[i] = { ...state.kinds[i]!, ...next };
  };
  if (!k.enabled) {
    const done = await openDialog({
      title: C.switchOnTitle,
      eyebrow: kindName(k.kind),
      body: h('p', { class: 'dialog__text' }, switchOnBody(k.kind, state.channel.on)),
      confirmLabel: C.switchOn,
      submit: async () => replace(await ctx.api.setEmailEnabled(k.kind, true)),
    });
    if (!done) return;
    notify(C.switchedOn);
    after();
    return;
  }
  await busy(b, async () => {
    try {
      replace(await ctx.api.setEmailEnabled(k.kind, false));
      notify(C.switchedOff);
      after();
    } catch (e) {
      notifyError(e);
    }
  });
}

function switchCell(k: EmailKindView, channelOn: boolean): HTMLElement {
  const s = switchState(k, channelOn);
  return h('span', { class: 'emails__switch', data: { testid: 'emails-switch-state', kind: k.kind } }, statusMark(s.text, s.tone), h('span', { class: 'cell-sub' }, s.note));
}

function kindsTable(ctx: ViewContext, state: EmailsState, acts: EmailsActions, params: EmailsParams, redraw: () => void): HTMLElement {
  const wordsHref = (k: EmailKindView) => href('emailSettings', {}, { kind: k.kind, status: params.status, okind: params.outboxKind });
  return table<EmailKindView>(
    [
      {
        label: 'Email',
        cell: (k) =>
          h(
            'span',
            { class: 'emails__kind' },
            h('a', { class: 'idlink', attrs: { href: wordsHref(k), 'data-testid': 'emails-kind' } }, kindName(k.kind)),
            h('span', { class: 'cell-sub' }, EMAIL_KIND_INFO[k.kind].when),
          ),
        kind: ['wide'],
      },
      { label: 'Goes to', cell: (k) => EMAIL_KIND_INFO[k.kind].to, kind: ['nowrap'] },
      { label: 'Switch', cell: (k) => switchCell(k, state.channel.on), kind: ['nowrap'] },
      { label: 'Words', cell: (k) => h('span', { data: { testid: 'emails-words-state' } }, wordsState(k)), kind: ['nowrap'] },
      {
        label: 'Actions',
        hiddenLabel: true,
        cell: (k) => {
          const actions: HTMLElement[] = [];
          if (acts.switch) {
            const b = button(k.enabled ? C.switchOff : C.switchOn, { kind: 'ghost', testId: 'emails-switch' });
            b.addEventListener('click', () => void toggle(ctx, state, k, b, redraw));
            actions.push(b);
          }
          actions.push(linkButton(acts.edit ? C.editWords : C.readWords, wordsHref(k), 'ghost'));
          return h('span', { class: 'row-actions' }, ...actions);
        },
        kind: ['actions', 'wrap'],
      },
    ],
    state.kinds,
    { caption: C.kinds, current: (k) => k.kind === params.kind },
  );
}

// ── A kind's words ───────────────────────────────────────────────────────────────────────────────────────────────

function editorSection(ctx: ViewContext, state: EmailsState, k0: EmailKindView, acts: EmailsActions, redrawKinds: () => void, refreshOutbox: () => Promise<void>): HTMLElement {
  let k = k0;
  const info = EMAIL_KIND_INFO[k.kind];
  const subject = input('subject', { value: k.words.subject, maxlength: EMAIL_TEMPLATE_SUBJECT_MAX });
  const body = textarea('body', { rows: 13, maxlength: EMAIL_TEMPLATE_BODY_MAX });
  body.value = k.words.body;
  subject.setAttribute('data-testid', 'emails-subject');
  body.setAttribute('data-testid', 'emails-body');
  subject.readOnly = !acts.edit;
  body.readOnly = !acts.edit;
  const form = h(
    'div',
    { class: 'emails__fields' },
    field(C.subject, subject, { hint: C.subjectHint, wide: true }),
    field(C.body, body, { hint: C.bodyHint, wide: true }),
  );
  const warn = h('p', { class: 'emails__warn', attrs: { role: 'status' }, data: { testid: 'emails-unknown' } });
  const draft = (): EmailWords => ({ subject: subject.value, body: body.value });

  // The placeholders: each placed where the cursor is (the words by default).
  let lastField: HTMLInputElement | HTMLTextAreaElement = body;
  subject.addEventListener('focus', () => (lastField = subject));
  body.addEventListener('focus', () => (lastField = body));
  const place = (name: string) => {
    const f = lastField;
    const token = `{${name}}`;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? start;
    f.setRangeText(token, start, end, 'end');
    f.focus();
    f.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const placeholders = h(
    'div',
    { class: 'emails__placeholders', data: { testid: 'emails-placeholders' } },
    h('p', { class: 'emails__sub' }, C.placeholders),
    h(
      'dl',
      { class: 'emails__tokens' },
      ...k.placeholders.map((p) =>
        h(
          'div',
          { class: 'emails__token' },
          h('dt', null, acts.edit ? button(`{${p.name}}`, { kind: 'ghost', testId: `emails-place-${p.name}`, title: `Place {${p.name}}`, onClick: () => place(p.name) }) : h('span', { class: 'mono' }, `{${p.name}}`)),
          h('dd', null, p.words),
        ),
      ),
    ),
    acts.edit ? h('p', { class: 'emails__hint' }, C.placeholdersNote) : null,
  );

  // The switch, here too.
  const switchLine = h('div', { class: 'emails__state' });
  const drawSwitch = () => {
    const parts: HTMLElement[] = [switchCell(k, state.channel.on)];
    if (acts.switch) {
      const b = button(k.enabled ? C.switchOff : C.switchOn, { kind: 'secondary', testId: 'emails-editor-switch' });
      b.addEventListener('click', () =>
        void toggle(ctx, state, k, b, () => {
          k = state.kinds.find((x) => x.kind === k.kind) ?? k;
          drawSwitch();
          redrawKinds();
        }),
      );
      parts.push(b);
    }
    mount(switchLine, ...parts);
  };
  drawSwitch();

  // The preview, drawn again as the words are written (OPERATOR; an AUDITOR reads the kind's own).
  const preview = h('div', { class: 'emails__preview-box', data: { testid: 'emails-preview' } }, loading());
  let turn = 0;
  const drawPreview = async (words?: EmailWords) => {
    const mine = ++turn;
    try {
      const rendered: RenderedEmail = await ctx.api.emailPreview(k.kind, acts.edit && words ? words : undefined);
      if (mine !== turn) return;
      mount(preview, emailViewer(rendered, { view: previewView, onView: (v) => (previewView = v), note: C.previewNote }));
    } catch (e) {
      if (mine !== turn) return;
      // A refusal of the words being written is said under its field; the last preview stays.
      if (e instanceof ApiError && e.status === 400 && preview.querySelector('.email-view')) return;
      mount(preview, failure(C.previewFailed, () => void drawPreview(draft())));
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Save, Back to the default words, Send a test to me.
  const save = button(C.save, { kind: 'primary', testId: 'emails-save', disabled: true });
  const reset = button(C.reset, { kind: 'ghost', testId: 'emails-reset' });
  const test = button(C.test, { kind: 'secondary', testId: 'emails-test', disabled: !state.channel.on, title: state.channel.on ? undefined : C.testOff });
  const testLine = state.channel.on ? null : h('p', { class: 'emails__hint', data: { testid: 'emails-test-off' } }, C.testOff);

  let release: (() => void) | null = null;
  const sync = () => {
    const d = draft();
    const changed = isDraftChanged(k, d);
    const sp = subjectProblem(d.subject);
    const bp = bodyProblem(d.body);
    setFieldError(form, 'subject', changed ? (sp ?? undefined) : undefined);
    setFieldError(form, 'body', changed ? (bp ?? undefined) : undefined);
    warn.textContent = unknownLine(unknownPlaceholders(d, k.placeholders)) ?? '';
    save.disabled = !changed || sp !== null || bp !== null;
    reset.hidden = !(k.edited.subject || k.edited.body) && !changed;
    if (changed && !release) release = holdPage(C.unsaved, 'Emails');
    if (!changed && release) {
      release();
      release = null;
    }
  };
  const onInput = () => {
    sync();
    clearTimeout(timer);
    const d = draft();
    if (subjectProblem(d.subject) !== null || bodyProblem(d.body) !== null) return;
    timer = setTimeout(() => void drawPreview(d), 350);
  };
  subject.addEventListener('input', onInput);
  body.addEventListener('input', onInput);

  let noteOf: HTMLElement | null = null;
  const adopt = (next: EmailKindView) => {
    k = next;
    if (noteOf) noteOf.textContent = wordsState(next);
    const i = state.kinds.findIndex((x) => x.kind === next.kind);
    if (i >= 0) state.kinds[i] = next;
    subject.value = next.words.subject;
    body.value = next.words.body;
    sync();
    redrawKinds();
    void drawPreview(draft());
  };

  save.addEventListener('click', () =>
    void busy(save, async () => {
      const d = draft();
      const sp = subjectProblem(d.subject);
      const bp = bodyProblem(d.body);
      setFieldError(form, 'subject', sp ?? undefined);
      setFieldError(form, 'body', bp ?? undefined);
      if (sp || bp) return;
      try {
        adopt(await ctx.api.setEmailWords(k.kind, wordsChange(k, d)));
        notify(C.saved);
      } catch (e) {
        notifyError(e);
      }
    }, 'Saving…'),
  );
  reset.addEventListener('click', () =>
    void openDialog({
      title: C.resetTitle,
      eyebrow: kindName(k.kind),
      body: h('p', { class: 'dialog__text' }, C.resetBody),
      confirmLabel: C.reset,
      submit: async () => adopt(await ctx.api.setEmailWords(k.kind, { subject: null, body: null })),
    }).then((r) => {
      if (r) notify(C.resetDone);
    }),
  );
  test.addEventListener('click', () =>
    void busy(test, async () => {
      try {
        const d = draft();
        const words = acts.edit && subjectProblem(d.subject) === null && bodyProblem(d.body) === null ? d : {};
        await ctx.api.sendTestEmail(k.kind, words);
        notify(C.testSent(ctx.session.admin.email));
        await refreshOutbox();
      } catch (e) {
        notifyError(e);
      }
    }, 'Sending…'),
  );

  sync();
  void drawPreview();

  const buttons = [acts.edit ? save : null, acts.edit ? reset : null, acts.switch ? test : null].filter((b): b is HTMLButtonElement => b !== null);
  const left = h(
    'div',
    { class: 'emails__form' },
    h('p', { class: 'emails__lead' }, info.when, ' ', h('span', { class: 'soft' }, `To ${info.to.toLowerCase()}.`)),
    switchLine,
    form,
    warn,
    placeholders,
    buttons.length ? h('div', { class: 'emails__actions' }, ...buttons) : null,
    testLine && acts.switch ? testLine : null,
    acts.edit ? null : h('p', { class: 'emails__hint' }, C.readOnly),
  );
  const part = section(
    kindName(k.kind),
    h('div', { class: 'emails__editor' }, left, h('div', { class: 'emails__preview' }, h('p', { class: 'emails__sub' }, C.preview), preview)),
    {
      id: 'emails-editor',
      note: wordsState(k),
      tools: [linkButton(C.close, href('emailSettings', {}, { status: ctx.route.query.status, okind: ctx.route.query.okind }), 'ghost')],
    },
  );
  noteOf = part.querySelector<HTMLElement>('.panel__note');
  return part;
}

// ── The outbox ───────────────────────────────────────────────────────────────────────────────────────────────────

function outboxSection(ctx: ViewContext, counts: EmailsState['outbox'], page: Paged<OutboxEmail>, params: EmailsParams): HTMLElement {
  const choice = (name: string, label: string, options: readonly { value: string; label: string }[], value: string | null, key: string) => {
    const s = select(name, [...options], value ?? '');
    s.setAttribute('data-testid', `emails-filter-${name}`);
    s.addEventListener('change', () => ctx.setQuery({ [key]: s.value || null, page: null }));
    return field(label, s);
  };
  const isFiltered = params.status !== null || params.outboxKind !== null;
  const errors = counts.lastErrors.length
    ? h(
        'div',
        { class: 'emails__errors', data: { testid: 'emails-last-errors' } },
        h('p', { class: 'emails__sub' }, C.lastErrors),
        table(
          [
            { label: 'When', cell: (e) => parisDateTime(e.at), kind: ['nowrap'] },
            { label: 'Email', cell: (e) => kindName(e.kind), kind: ['nowrap'] },
            { label: 'Status', cell: (e) => statusMark(statusWords(e.status), statusTone(e.status)), kind: ['nowrap'] },
            { label: 'Error', cell: (e) => h('span', { class: 'emails__error' }, e.lastError), kind: ['wide'] },
          ],
          counts.lastErrors,
          { caption: C.lastErrors },
        ),
      )
    : null;

  return section(
    C.outbox,
    [
      h('div', { class: 'kpis emails__kpis', data: { testid: 'emails-outbox-kpis' } }, ...outboxKpis(counts).map((x) => kpi(x.label, x.value, x.note, x.tone))),
      errors,
      filterBar(choice('status', 'Status', STATUS_CHOICES, params.status, 'status'), choice('kind', 'Email', kindChoices(), params.outboxKind, 'okind')),
      table<OutboxEmail>(
        [
          { label: 'Written', cell: (e) => parisDateTime(e.createdAt), kind: ['nowrap'] },
          { label: 'Email', cell: (e) => h('span', null, kindName(e.kind), h('span', { class: 'cell-sub' }, recipientKind(e))), kind: ['nowrap'] },
          { label: 'To', cell: (e) => h('span', { data: { testid: 'emails-to' } }, e.to), kind: ['email'] },
          { label: 'Subject', cell: (e) => h('span', { class: 'emails__subject' }, e.subject), kind: ['wide'] },
          {
            label: 'Status',
            cell: (e) =>
              h(
                'span',
                { data: { testid: 'emails-status' } },
                statusMark(statusWords(e.status), statusTone(e.status)),
                h('span', { class: 'cell-sub' }, outboxWhen(e)),
                e.lastError ? h('span', { class: ['cell-sub', 'emails__error'] }, e.lastError) : null,
              ),
            kind: ['nowrap'],
          },
          { label: 'Actions', hiddenLabel: true, cell: (e) => h('span', { class: 'row-actions' }, button(C.open, { kind: 'ghost', testId: 'emails-open', onClick: () => void openEmail(ctx, e) })), kind: ['actions'] },
        ],
        page.items,
        { caption: C.outbox, empty: isFiltered ? C.outboxFiltered : C.outboxEmpty },
      ),
      pager(page, (p) => ctx.setQuery({ page: p })),
    ],
    { id: 'emails-outbox', note: `${outboxLine(page.total, isFiltered)} · ${C.outboxNote}` },
  );
}

/** One email of the outbox as it was sent: its row, then the email (DARK · LIGHT · PLAIN TEXT). */
async function openEmail(ctx: ViewContext, row: OutboxEmail): Promise<void> {
  let email;
  try {
    email = await ctx.api.outboxEmail(row.id);
  } catch (e) {
    notifyError(e);
    return;
  }
  await openDialog({
    title: C.sentAs,
    eyebrow: `${kindName(email.kind)} · ${statusWords(email.status)}`,
    body: [
      defList([
        { label: 'To', value: email.to },
        { label: 'Written', value: parisDateTime(email.createdAt) },
        { label: 'Status', value: statusMark(statusWords(email.status), statusTone(email.status)), note: outboxWhen(email) },
        ...(email.lastError ? [{ label: 'Last error', value: h('span', { class: 'emails__error' }, email.lastError) }] : []),
      ]),
      emailViewer(email, { view: previewView, onView: (v) => (previewView = v), testid: 'emails-opened' }),
    ],
    confirmLabel: C.close,
    noCancel: true,
  });
}
