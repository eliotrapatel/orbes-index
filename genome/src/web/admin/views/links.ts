/**
 * Links, `#/links` (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.10.1, A.10.2 and A.10.7; step 4.8), under Clients
 * after Segments: the links that bring people to verify.theorbes.com and what each brought in, from GET /api/admin/links
 * (services/acquisition-report.ts), read on demand like GROWTH.
 *
 *   - The period (7, 30 or 90 days, 12 months, ALL TIME by default, CUSTOM From and To, Paris days), the currency when
 *     invoices exist in more than one, the view (LINKS · CAMPAIGN TAGS · REFERRING SITES) and, on LINKS, the archived
 *     links: all kept in the address, so a reload keeps them.
 *   - The table (desk): two header rows, the first grouping FIRST LINK · DISCOVERY and LAST LINK · CONVERSION; on LINKS
 *     the channels in their order, each its sum, then its links (name, address in mono with Copy, ARCHIVED when shown);
 *     then the lines without a link and the TOTAL. Every figure but Visits, First visits, Cost and Return opens its
 *     collectors. Under 600 px, one block per row instead, hairlines between, the period and the view as two selects.
 *   - New link and Edit (one dialog, `openLinkDialog`, OPERATOR): name, channel (or a new one), where it goes, the
 *     address suggested from the name (`-2`, `-3`… when taken), the cost and a note; after New link, its addresses with
 *     Copy. Channels (OPERATOR): rename, move, remove while no link uses it, add.
 *   - An AUDITOR reads everything, without New link, Channels, Edit or Archive; emails are masked in the lists.
 *
 * The console's house style: white paper, ink, hairlines, no cards. Text through h() only (CSP-safe).
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { freeCode, suggestCode } from '../../../shared/link-code.js';
import { ApiError, type AdminApi } from '../api.js';
import {
  CHANNELS_COPY as CC,
  channelMoves,
  channelNameProblem,
  customProblem,
  DESTINATION_LABELS,
  DESTINATION_ORDER,
  errorField,
  HEADING_NOTES,
  HEADINGS,
  LINK_DIALOG as D,
  LINK_NAME_MAX,
  LINK_NOTE_MAX,
  CHANNEL_NAME_MAX,
  LINK_PERIODS,
  linkChanges,
  linkFormOf,
  linkFormProblem,
  linkInput,
  LINKS_COPY as C,
  linksParams,
  linksQuery,
  linksRows,
  MEASURE_HEADINGS,
  MEASURES,
  modelLabel,
  NEW_CHANNEL,
  noLinkYet,
  PERIOD_TABS,
  phoneBlock,
  releaseLabel,
  VIEW_LABELS,
  VIEW_ROW_HEADING,
  type FigureCell,
  type LinkForm,
  type LinkPeriod,
  type LinksParams,
  type LinksRow,
  type ReturnCell,
} from '../model/links.js';
import { can } from '../model/permissions.js';
import { href } from '../router.js';
import { HOUSE_CURRENCIES, LINKS_VIEWS, type LinkChannelView, type LinkDestinations, type LinksReport, type LinkView } from '../types.js';
import { button, checkbox, copyButton, emptyState, field, input, pageHeader, select, setFieldError, textarea } from '../ui/components.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

// ── Figures ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure: a link to its collectors, or its text. */
function figure(c: FigureCell, testid?: string): HTMLElement {
  return c.href ? h('a', { class: ['idlink', 'links__figure'], attrs: { href: c.href, 'data-testid': testid ?? null } }, c.text) : h('span', { class: 'links__figure' }, c.text);
}

/** A return: `×3.2` and « Revenue … for … » under it. */
function returnFigure(r: ReturnCell): HTMLElement {
  return h('span', { class: 'links__return' }, h('span', null, r.text), r.sub ? h('span', { class: 'cell-sub' }, r.sub) : null);
}

/** A heading with its note (the mark, and the note as its title). */
function noted(label: string, note: string | null): Child[] {
  return note ? [label, h('span', { class: 'links__mark', attrs: { title: note, 'aria-hidden': 'true' } }, ' ⓘ')] : [label];
}

/** A row's name: the link's page or a view, its address in mono with Copy, ARCHIVED. */
function nameCell(row: LinksRow): HTMLElement {
  const name = row.open ? h('a', { class: 'idlink', attrs: { href: row.open, 'data-testid': row.kind === 'link' ? 'link-name' : 'line-name' } }, row.label) : h('span', null, row.label);
  return h(
    'span',
    { class: 'links__name' },
    h('span', { class: 'links__name-line' }, name, row.archived ? h('span', { class: 'links__archived', data: { testid: 'link-archived' } }, C.archived) : null),
    row.copy && row.sub
      ? h('span', { class: 'links__address' }, h('span', { class: 'mono', data: { testid: 'link-address' } }, row.sub), copyButton(row.copy, C.copy))
      : row.sub
        ? h('span', { class: 'cell-sub' }, row.sub)
        : null,
  );
}

// ── The table (desk) ─────────────────────────────────────────────────────────────────────────────────────────────

function desktopTable(r: LinksReport, rows: LinksRow[]): HTMLElement {
  const withMoney = r.view === 'links';
  const span = MEASURES.length + (withMoney ? 1 : 0);
  const cols = 3 + span * 2 + (withMoney ? 1 : 0);
  const th = (cls: string[], ...children: Child[]) => h('th', { class: cls, attrs: { scope: 'col' } }, ...children);
  const groupHead = h(
    'tr',
    { class: 'links__groups' },
    h('th', { attrs: { colspan: 3, scope: 'colgroup' } }),
    h('th', { class: ['links__split', 'links__group'], attrs: { colspan: span, scope: 'colgroup', title: HEADING_NOTES.first } }, ...noted(C.firstGroup, HEADING_NOTES.first)),
    h('th', { class: ['links__split', 'links__group'], attrs: { colspan: span, scope: 'colgroup', title: HEADING_NOTES.last } }, ...noted(C.lastGroup, HEADING_NOTES.last)),
    withMoney ? h('th', { class: 'links__split' }) : null,
  );
  const side = (split: boolean) => [
    ...MEASURES.map((m, i) => th(['col--num', i === 0 && split ? 'links__split' : ''].filter(Boolean), ...noted(MEASURE_HEADINGS[m], m === 'entries' ? HEADING_NOTES.entries : null))),
    ...(withMoney ? [th(['col--num'], ...noted(HEADINGS.returns, HEADING_NOTES.returns))] : []),
  ];
  const head = h(
    'tr',
    null,
    th(['col--wide'], VIEW_ROW_HEADING[r.view]),
    th(['col--num'], ...noted(HEADINGS.visits, HEADING_NOTES.visits)),
    th(['col--num'], HEADINGS.firstVisits),
    ...side(true),
    ...side(true),
    ...(withMoney ? [th(['col--num', 'links__split'], HEADINGS.cost)] : []),
  );
  const bodyRow = (row: LinksRow) => {
    if (!row.figures) return h('tr', { class: 'links__heading-row', data: { key: 'heading-row' } }, h('td', { attrs: { colspan: cols } }, h('span', { class: 'links__heading' }, row.label)));
    const f = row.figures;
    const money = row.money;
    const ret = (a: 'first' | 'last') =>
      withMoney ? [h('td', { class: 'col--num' }, money && money !== 'blank' ? returnFigure(money.returns ? money.returns[a] : { text: '—', sub: null }) : '')] : [];
    const measures = (a: 'first' | 'last') => MEASURES.map((m, i) => h('td', { class: ['col--num', i === 0 ? 'links__split' : null] }, figure(f[a][m], `figure-${a}-${m}`)));
    return h(
      'tr',
      { class: `links__row links__row--${row.kind}`, data: { key: row.key } },
      h('td', { class: 'col--wide' }, nameCell(row)),
      h('td', { class: 'col--num' }, f.visits),
      h('td', { class: 'col--num' }, f.firstVisits),
      ...measures('first'),
      ...ret('first'),
      ...measures('last'),
      ...ret('last'),
      ...(withMoney ? [h('td', { class: ['col--num', 'links__split'] }, money && money !== 'blank' ? money.cost : '')] : []),
    );
  };
  return h(
    'div',
    { class: ['table-wrap', 'links__desk'] },
    h('table', { class: ['table', 'links__table'], data: { testid: 'links-table' } }, h('caption', { class: 'visually-hidden' }, `${VIEW_LABELS[r.view]}: the first link and the last link side by side`), h('thead', null, groupHead, head), h('tbody', null, ...rows.map(bodyRow))),
  );
}

// ── The blocks (phone) ───────────────────────────────────────────────────────────────────────────────────────────

function phoneBlocks(rows: LinksRow[]): HTMLElement {
  return h(
    'div',
    { class: 'links__phone', data: { testid: 'links-blocks' } },
    ...rows.map((row) => {
      const b = phoneBlock(row);
      if (!b) return h('p', { class: 'links__heading links__heading--phone' }, row.label);
      const column = (title: string, lines: typeof b.first) =>
        h(
          'dl',
          { class: 'links__col' },
          h('dt', { class: 'links__col-title' }, title),
          ...lines.map((l) => h('dd', { class: 'links__col-line' }, h('span', { class: 'links__col-label' }, l.label), 'href' in l.cell ? figure(l.cell) : returnFigure(l.cell))),
        );
      return h(
        'div',
        { class: `links__block links__block--${row.kind}`, data: { key: row.key } },
        nameCell(row),
        h('p', { class: 'links__visits' }, b.visits),
        h('div', { class: 'links__cols' }, column(C.first, b.first), column(C.last, b.last)),
        b.cost ? h('p', { class: 'links__cost' }, b.cost) : null,
      );
    }),
  );
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────────────────────

function tabs(label: string, items: { text: Child[]; href: string; current: boolean; testid: string }[]): HTMLElement {
  return h(
    'nav',
    { class: 'range', attrs: { 'aria-label': label } },
    ...items.flatMap((t, i) => [
      i > 0 ? h('span', { class: 'range__dot', attrs: { 'aria-hidden': 'true' } }) : null,
      h('a', { class: 'range__tab', attrs: { href: t.href, 'aria-current': t.current ? 'page' : null, 'data-testid': t.testid } }, ...t.text),
    ]),
  );
}

const periodText = (x: LinkPeriod): Child[] => {
  const t = PERIOD_TABS[x];
  return t.figure ? [h('span', { class: 'range__figure' }, t.figure), ` ${t.words}`] : [t.words];
};

function controls(ctx: ViewContext, p: LinksParams, r: LinksReport | null): HTMLElement {
  const go = (q: Parameters<typeof linksQuery>[1]) => href('links', {}, linksQuery(p, q));
  const periodTabs = tabs(
    C.period,
    LINK_PERIODS.map((x) => ({ text: periodText(x), href: go({ period: x }), current: x === p.period, testid: `links-period-${x}` })),
  );
  const viewTabs = tabs(
    C.view,
    LINKS_VIEWS.map((v) => ({ text: [VIEW_LABELS[v]], href: go({ view: v }), current: v === p.view, testid: `links-view-${v}` })),
  );
  // On a phone, the period and the view as two selects.
  const periodSelect = select('linksPeriod', LINK_PERIODS.map((x) => ({ value: x, label: `${PERIOD_TABS[x].figure ? `${PERIOD_TABS[x].figure} ` : ''}${PERIOD_TABS[x].words}` })), p.period);
  periodSelect.setAttribute('aria-label', C.period);
  periodSelect.addEventListener('change', () => ctx.navigate(go({ period: periodSelect.value as LinkPeriod })));
  const viewSelect = select('linksView', LINKS_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })), p.view);
  viewSelect.setAttribute('aria-label', C.view);
  viewSelect.addEventListener('change', () => ctx.navigate(go({ view: viewSelect.value as LinksParams['view'] })));

  const extra: Child[] = [];
  if (r && r.currencies.length > 1) {
    const cur = select('linksCurrency', r.currencies.map((c) => ({ value: c, label: c })), r.currency);
    cur.setAttribute('aria-label', C.currency);
    cur.setAttribute('data-testid', 'links-currency');
    cur.addEventListener('change', () => ctx.navigate(go({ currency: cur.value as (typeof HOUSE_CURRENCIES)[number] })));
    extra.push(cur);
  }
  if (p.view === 'links') {
    const box = checkbox('archived', C.showArchived, p.archived);
    box.setAttribute('data-testid', 'links-archived');
    box.querySelector('input')!.addEventListener('change', (ev) => ctx.navigate(go({ archived: (ev.target as HTMLInputElement).checked })));
    extra.push(box);
  }

  let custom: HTMLElement | null = null;
  if (p.period === 'custom') {
    const from = input('from', { type: 'date', value: p.customFrom ?? '' });
    const to = input('to', { type: 'date', value: p.customTo ?? '' });
    const problem = h('p', { class: 'links__problem', attrs: { role: 'alert' } }, p.customFrom && p.customTo ? (customProblem(p.customFrom, p.customTo) ?? '') : '');
    custom = h(
      'form',
      { class: ['filters', 'links__custom'], attrs: { novalidate: true, 'data-testid': 'links-custom' } },
      field(C.from, from),
      field(C.to, to),
      button(C.apply, { kind: 'secondary', type: 'submit' }),
      problem,
    );
    custom.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const bad = customProblem(from.value, to.value);
      if (bad) {
        problem.textContent = bad;
        return;
      }
      ctx.navigate(go({ period: 'custom', from: from.value, to: to.value }));
    });
  }

  return h(
    'div',
    { class: 'links__controls' },
    h('div', { class: 'links__bar links__bar--desk' }, periodTabs),
    h('div', { class: 'links__bar links__bar--phone' }, periodSelect, viewSelect),
    custom,
    h('div', { class: 'links__bar links__bar--desk' }, viewTabs),
    extra.length ? h('div', { class: 'links__bar' }, ...extra) : null,
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every address in use, archived links' included, so the dialog's suggestion is free (`-2`, `-3`…). */
async function takenCodes(api: AdminApi, r: LinksReport | null): Promise<Set<string>> {
  const codes = new Set<string>();
  const add = (x: LinksReport) => x.channels.forEach((g) => g.links.forEach((l) => codes.add(l.link.code)));
  if (r && r.view === 'links' && r.archived) add(r);
  else {
    try {
      add(await api.linksReport({ view: 'links', archived: true }));
    } catch {
      if (r) add(r);
    }
  }
  return codes;
}

export async function linksView(ctx: ViewContext): Promise<HTMLElement> {
  const p = linksParams(ctx.route.query, ctx.now());
  const manage = can(ctx.session.admin.role, 'manageLinks');
  let report: LinksReport | null = null;
  try {
    report = await ctx.api.linksReport({ from: p.from, to: p.to, currency: p.currency, view: p.view, archived: p.archived });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
    report = null;
  }

  const newLink = async () => {
    try {
      const [channels, destinations, taken] = await Promise.all([ctx.api.linkChannels(), ctx.api.linkDestinations(), takenCodes(ctx.api, report)]);
      const made = await openLinkDialog(ctx.api, { link: null, channels, destinations, taken });
      if (made) ctx.reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const channels = async () => {
    try {
      const changed = await openChannelsDialog(ctx.api, await ctx.api.linkChannels());
      if (changed) ctx.reload();
    } catch (e) {
      notifyError(e);
    }
  };
  const actions: Child[] = manage
    ? [button(C.newLink, { kind: 'primary', testId: 'links-new', onClick: () => void newLink() }), button(C.channels, { kind: 'secondary', testId: 'links-channels', onClick: () => void channels() })]
    : [];

  let body: Child[];
  if (!report) {
    body = [h('div', { class: 'links__failed', data: { testid: 'links-failed' } }, emptyState(C.failed), button(C.tryAgain, { kind: 'secondary', onClick: () => ctx.reload() }))];
  } else {
    const rows = linksRows(report, p);
    body = [
      noLinkYet(report)
        ? h('div', { class: 'links__empty', data: { testid: 'links-empty' } }, emptyState(C.empty), manage ? button(C.newLink, { kind: 'primary', onClick: () => void newLink() }) : null)
        : null,
      desktopTable(report, rows),
      phoneBlocks(rows),
      h(
        'dl',
        { class: 'links__notes', attrs: { 'aria-label': C.notes } },
        ...[
          [HEADINGS.visits, HEADING_NOTES.visits],
          [MEASURE_HEADINGS.entries, HEADING_NOTES.entries],
          [C.firstGroup, HEADING_NOTES.first],
          [C.lastGroup, HEADING_NOTES.last],
          ...(report.view === 'links' ? [[HEADINGS.returns, HEADING_NOTES.returns]] : []),
        ].map(([t, d]) => h('div', { class: 'links__note' }, h('dt', null, t), h('dd', null, d))),
      ),
      h('p', { class: 'growth__line' }, C.deleted),
    ];
  }

  return h(
    'div',
    { class: 'view view--links' },
    pageHeader({ eyebrow: C.eyebrow, title: C.title, lead: C.lead, actions }),
    controls(ctx, p, report),
    h('section', { class: ['panel', 'links__panel'], data: { testid: 'links-report' } }, ...body),
  );
}

// ── New link and Edit ────────────────────────────────────────────────────────────────────────────────────────────

/** The fields of the dialog as the model reads them. */
function formOf(form: HTMLFormElement): LinkForm {
  const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  return { name: v('name'), channelId: v('channelId'), destination: v('destination'), dropId: v('dropId'), modelId: v('modelId'), code: v('code'), cost: v('cost'), currency: v('currency'), note: v('note') };
}

/**
 * New link (`link` null) or Edit the link (OPERATOR, plan §3.4 A.10.2). Resolves with the link made or saved, or null
 * when cancelled. A refusal of the server is shown under the field it names, the rest of the form kept.
 */
export function openLinkDialog(api: AdminApi, o: { link: LinkView | null; channels: LinkChannelView[]; destinations: LinkDestinations; taken: ReadonlySet<string> }): Promise<LinkView | null> {
  return new Promise((resolve) => {
    const isNew = o.link === null;
    const start: LinkForm = o.link ? linkFormOf(o.link) : { name: '', channelId: o.channels[0]?.id ?? '', destination: 'NOW', dropId: '', modelId: '', code: '', cost: '', currency: 'EUR', note: '' };
    const channels = [...o.channels];
    const previous = document.activeElement as HTMLElement | null;

    const name = input('name', { maxlength: LINK_NAME_MAX, placeholder: D.namePlaceholder, value: start.name });
    const channelOptions = () => [...channels.map((c) => ({ value: c.id, label: c.name })), { value: NEW_CHANNEL, label: D.newChannel }];
    let channel = select('channelId', channelOptions(), start.channelId || NEW_CHANNEL);
    const channelField = field(D.channel, channel, { required: true, wide: true });
    const newChannel = input('newChannel', { maxlength: CHANNEL_NAME_MAX });
    const addChannel = button(D.add, { kind: 'secondary', testId: 'link-channel-add' });
    const cancelChannel = button(D.cancel, { kind: 'ghost' });
    const newChannelField = field(D.channelName, newChannel, { wide: true });
    newChannelField.append(h('span', { class: 'links__inline' }, addChannel, cancelChannel));
    newChannelField.hidden = true;

    const destination = select('destination', DESTINATION_ORDER.map((d) => ({ value: d, label: DESTINATION_LABELS[d] })), start.destination);
    const drop = select('dropId', [{ value: '', label: D.chooseRelease }, ...o.destinations.releases.map((r) => ({ value: r.id, label: releaseLabel(r) }))], start.dropId);
    const model = select('modelId', [{ value: '', label: D.chooseModel }, ...o.destinations.models.map((m) => ({ value: m.id, label: modelLabel(m) }))], start.modelId);
    const dropField = field(D.release, drop, { wide: true });
    const modelField = field(D.model, model, { wide: true });

    const code = input('code', { maxlength: 32, mono: true, value: start.code });
    let codeTouched = !isNew;
    const suggest = () => freeCode(suggestCode(name.value), (c) => o.taken.has(c));
    const prefix = `${location.host}/go/`;
    const codeHint = h('span', { class: 'cfield__hint', id: 'link-code-hint' }, D.addressHint);
    code.id = 'link-code';
    code.setAttribute('aria-describedby', 'link-code-hint');
    const addressField = isNew
      ? h(
          'div',
          { class: ['cfield', 'cfield--wide'], data: { field: 'code' } },
          h('label', { class: 'cfield__label', attrs: { for: 'link-code' } }, D.address),
          h('span', { class: 'links__code' }, h('span', { class: ['mono', 'links__prefix'] }, prefix), code),
          codeHint,
        )
      : h(
          'div',
          { class: ['cfield', 'cfield--wide'], data: { field: 'address' } },
          h('span', { class: 'cfield__label' }, D.address),
          h('span', { class: 'links__address' }, h('span', { class: 'mono' }, o.link!.address.replace(/^https?:\/\//, '')), copyButton(o.link!.address, C.copy)),
        );

    const cost = input('cost', { inputmode: 'decimal', value: start.cost, maxlength: 16 });
    const currency = select('currency', HOUSE_CURRENCIES.map((c) => ({ value: c, label: c })), start.currency);
    currency.setAttribute('aria-label', D.costCurrency);
    cost.id = 'link-cost';
    cost.setAttribute('aria-describedby', 'link-cost-hint');
    const costField = h(
      'div',
      { class: ['cfield', 'cfield--wide'], data: { field: 'cost' } },
      h('label', { class: 'cfield__label', attrs: { for: 'link-cost' } }, D.cost),
      h('span', { class: 'links__cost-field' }, cost, currency),
      h('span', { class: 'cfield__hint', id: 'link-cost-hint' }, D.costHint),
    );
    const note = textarea('note', { maxlength: LINK_NOTE_MAX, rows: 3 });
    note.value = start.note;

    const error = h('p', { class: 'dialog__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const confirm = button(isNew ? D.make : D.save, { kind: 'primary', type: 'submit', testId: 'dialog-confirm' });
    const cancel = button(D.cancel, { kind: 'ghost', testId: 'dialog-cancel' });
    const fields = h(
      'div',
      { class: 'dialog__fields' },
      field(D.name, name, { required: true, wide: true }),
      channelField,
      newChannelField,
      field(D.goesTo, destination, { required: true, wide: true }),
      dropField,
      modelField,
      addressField,
      costField,
      field(D.note, note, { wide: true, hint: D.noteHint }),
    );
    const form = h(
      'form',
      { class: 'dialog__form', attrs: { method: 'dialog', novalidate: true } },
      h('h2', { class: 'dialog__title' }, isNew ? D.newTitle : D.editTitle),
      fields,
      error,
      h('div', { class: 'dialog__actions' }, cancel, confirm),
    );
    const dlg = h('dialog', { class: ['dialog', 'links__dialog'], attrs: { 'aria-label': isNew ? D.newTitle : D.editTitle, 'data-testid': 'link-dialog' } }, form);
    document.body.appendChild(dlg);

    let busy = false;
    let settled = false;
    let result: LinkView | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      previous?.focus?.();
      resolve(result);
    };

    const showDestination = () => {
      dropField.hidden = destination.value !== 'RELEASE';
      modelField.hidden = destination.value !== 'MODEL';
    };
    destination.addEventListener('change', () => {
      showDestination();
      setFieldError(form, 'destination', undefined);
    });
    showDestination();

    if (isNew) {
      name.addEventListener('input', () => {
        if (!codeTouched) code.value = suggest();
      });
      code.addEventListener('input', () => {
        if (/[A-Z]/.test(code.value)) code.value = code.value.toLowerCase();
        codeTouched = code.value !== '';
        setFieldError(form, 'code', undefined);
      });
    }

    const showNewChannel = (on: boolean) => {
      channelField.hidden = on;
      newChannelField.hidden = !on;
      if (on) newChannel.focus();
    };
    channel.addEventListener('change', () => showNewChannel(channel.value === NEW_CHANNEL));
    cancelChannel.addEventListener('click', () => {
      channel.value = channels[0]?.id ?? NEW_CHANNEL;
      setFieldError(form, 'newChannel', undefined);
      showNewChannel(channels.length === 0);
    });
    addChannel.addEventListener('click', async () => {
      const problem = channelNameProblem(newChannel.value);
      setFieldError(form, 'newChannel', problem ?? undefined);
      if (problem) return;
      addChannel.disabled = true;
      try {
        const made = await api.createLinkChannel({ name: newChannel.value.trim() });
        channels.push(made);
        const next = select('channelId', channelOptions(), made.id);
        next.id = channel.id;
        next.setAttribute('aria-describedby', channel.getAttribute('aria-describedby') ?? '');
        next.required = true;
        channel.replaceWith(next);
        channel = next;
        channel.addEventListener('change', () => showNewChannel(channel.value === NEW_CHANNEL));
        newChannel.value = '';
        showNewChannel(false);
        setFieldError(form, 'channelId', undefined);
      } catch (e) {
        setFieldError(form, 'newChannel', e instanceof ApiError ? e.message : D.failed);
      } finally {
        addChannel.disabled = false;
      }
    });
    if (!start.channelId) showNewChannel(true);

    cancel.addEventListener('click', () => {
      if (!busy) finish();
    });
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      if (!busy) finish();
    });

    /** After New link: the dialog turns into its result, the addresses with Copy. */
    const ready = (l: LinkView) => {
      const done = button(D.done, { kind: 'primary', testId: 'link-done', onClick: finish });
      mount(
        form,
        h('h2', { class: 'dialog__title' }, D.ready),
        h(
          'div',
          { class: ['dialog__body', 'links__ready'], data: { testid: 'link-ready' } },
          h('p', { class: ['mono', 'links__ready-address'], data: { testid: 'link-ready-address' } }, l.address.replace(/^https?:\/\//, '')),
          copyButton(l.address, C.copy),
          h('p', { class: 'dialog__text' }, D.direct),
          h('p', { class: ['mono', 'links__ready-direct'], data: { testid: 'link-ready-direct' } }, l.directAddress),
          copyButton(l.directAddress, C.copy),
        ),
        h('div', { class: 'dialog__actions' }, done),
      );
      done.focus();
    };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      error.textContent = '';
      for (const f of ['name', 'channelId', 'destination', 'dropId', 'modelId', 'code', 'cost', 'note']) setFieldError(form, f, undefined);
      const values = formOf(form);
      const problem = linkFormProblem(values, isNew);
      if (problem) {
        setFieldError(form, problem.field, problem.message);
        (form.elements.namedItem(problem.field) as HTMLElement | null)?.focus();
        return;
      }
      const change = o.link ? linkChanges(o.link, values) : null;
      if (o.link && !change) {
        error.textContent = D.unchanged;
        return;
      }
      busy = true;
      const label = confirm.textContent;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      confirm.textContent = isNew ? D.making : D.saving;
      try {
        if (isNew) {
          result = await api.createLink(linkInput(values, true));
          notify(D.made);
          busy = false;
          ready(result);
          return;
        }
        result = await api.updateLink(o.link!.id, change!);
        notify(D.saved);
        busy = false;
        finish();
      } catch (e) {
        const where = e instanceof ApiError ? errorField(e.code, e.message) : null;
        const message = e instanceof ApiError ? e.message : D.failed;
        if (where && form.querySelector(`.cfield[data-field="${where}"]`)) setFieldError(form, where, message);
        else error.textContent = message;
        busy = false;
        confirm.disabled = false;
        cancel.disabled = false;
        confirm.removeAttribute('aria-busy');
        confirm.textContent = label;
      }
    });

    dlg.showModal();
    name.focus();
  });
}

// ── Channels ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Channels dialog (OPERATOR, plan §3.4 A.10.7): resolves true when anything changed. */
export function openChannelsDialog(api: AdminApi, initial: LinkChannelView[]): Promise<boolean> {
  return new Promise((resolve) => {
    let channels = [...initial];
    let changed = false;
    let renaming: string | null = null;
    const previous = document.activeElement as HTMLElement | null;
    const error = h('p', { class: 'dialog__error', attrs: { role: 'alert', 'aria-live': 'assertive' } });
    const list = h('ol', { class: 'links__channels', data: { testid: 'channels-list' } });
    const addInput = input('channelName', { maxlength: CHANNEL_NAME_MAX });
    const addButton = button(CC.addButton, { kind: 'secondary', testId: 'channels-add' });
    const done = button(CC.done, { kind: 'primary', testId: 'channels-done' });
    const dlg = h(
      'dialog',
      { class: ['dialog', 'links__dialog'], attrs: { 'aria-label': CC.title, 'data-testid': 'channels-dialog' } },
      h(
        'div',
        { class: 'dialog__form' },
        h('h2', { class: 'dialog__title' }, CC.title),
        h('p', { class: 'dialog__text' }, CC.lead),
        list,
        h('div', { class: ['cfield', 'cfield--wide', 'links__channel-add'], data: { field: 'channelName' } }, h('label', { class: 'cfield__label', attrs: { for: 'channel-add' } }, CC.add), h('span', { class: 'links__inline' }, addInput, addButton), h('span', { class: 'cfield__hint' }, '')),
        error,
        h('div', { class: 'dialog__actions' }, done),
      ),
    );
    addInput.id = 'channel-add';
    document.body.appendChild(dlg);

    const act = async (fn: () => Promise<unknown>, toast: string) => {
      error.textContent = '';
      try {
        await fn();
        changed = true;
        channels = await api.linkChannels();
        notify(toast);
      } catch (e) {
        error.textContent = e instanceof ApiError ? e.message : D.failed;
      }
      draw();
    };

    const draw = () => {
      mount(
        list,
        ...channels.map((c, i) => {
          if (renaming === c.id) {
            const nameInput = input('rename', { maxlength: CHANNEL_NAME_MAX, value: c.name });
            nameInput.setAttribute('aria-label', CC.rename);
            const save = button(CC.save, { kind: 'secondary', testId: 'channel-save' });
            save.addEventListener('click', () => {
              const problem = channelNameProblem(nameInput.value);
              if (problem) {
                error.textContent = problem;
                return;
              }
              renaming = null;
              void act(() => api.updateLinkChannel(c.id, { name: nameInput.value.trim() }), CC.renamed);
            });
            const back = button(CC.cancel, { kind: 'ghost', onClick: () => ((renaming = null), draw()) });
            queueMicrotask(() => nameInput.focus());
            return h('li', { class: 'links__channel', data: { testid: 'channel' } }, h('span', { class: 'links__inline' }, nameInput, save, back));
          }
          const remove = button(CC.remove, { kind: 'ghost', testId: 'channel-remove', disabled: c.links > 0, title: c.links > 0 ? CC.inUse : undefined });
          remove.addEventListener('click', () => void act(() => api.deleteLinkChannel(c.id), CC.removed));
          const move = (by: -1 | 1) => {
            const moves = channelMoves(channels, c.id, by);
            if (!moves) return;
            void act(async () => {
              for (const m of moves) await api.updateLinkChannel(m.id, { position: m.position });
            }, CC.moved);
          };
          return h(
            'li',
            { class: 'links__channel', data: { testid: 'channel' } },
            h('span', { class: 'links__channel-name' }, h('span', { data: { testid: 'channel-name' } }, c.name), h('span', { class: 'cell-sub' }, CC.links(c.links), c.links > 0 ? ` · ${CC.inUse}` : '')),
            h(
              'span',
              { class: 'row-actions' },
              button(CC.rename, { kind: 'ghost', testId: 'channel-rename', onClick: () => ((renaming = c.id), draw()) }),
              button(CC.up, { kind: 'ghost', testId: 'channel-up', disabled: i === 0, onClick: () => move(-1) }),
              button(CC.down, { kind: 'ghost', testId: 'channel-down', disabled: i === channels.length - 1, onClick: () => move(1) }),
              remove,
            ),
          );
        }),
      );
    };
    draw();

    addButton.addEventListener('click', () => {
      const problem = channelNameProblem(addInput.value);
      setFieldError(dlg, 'channelName', problem ?? undefined);
      if (problem) return;
      const name = addInput.value.trim();
      addInput.value = '';
      void act(() => api.createLinkChannel({ name }), CC.added);
    });
    const finish = () => {
      dlg.close();
      dlg.remove();
      previous?.focus?.();
      resolve(changed);
    };
    done.addEventListener('click', finish);
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      finish();
    });
    dlg.showModal();
    done.focus();
  });
}

