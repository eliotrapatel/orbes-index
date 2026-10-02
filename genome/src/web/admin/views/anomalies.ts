/**
 * Anomalies with their triage workflow: OPEN → ACKNOWLEDGED → RESOLVED or
 * DISMISSED, reopen when needed. Closing a finding requires a note so the
 * audit trail explains every decision. Under its status, each finding names
 * the console user who took the latest decision (A-02). A finding shows what
 * customers said about the scans that took part in it (where they saw or
 * bought the piece), and leads to those cases.
 *
 * Filters, all kept in the view's URL: product, type (every type the server
 * can record), status, severity and the order (most severe first, then the
 * highest risk; risk; last seen). A product that is not a full id is
 * refused on its field, before the URL changes; filters the server refuses
 * (a URL typed by hand) keep the form on screen, with the refusal and a way
 * back to the whole list. `finding` narrows the list to one finding (a
 * case's link to the anomaly its scan took part in), with the way back to
 * every finding. `id` opens a finding's detail panel: the
 * timeline of its product's scans in its window, their countries, the
 * distinct devices, a link to the scan that raised it and to the window in
 * Verification events (GET /api/admin/anomalies/:id/context).
 *
 * The decision dialog can also act on the piece in the same gesture: mark it
 * COUNTERFEIT FLAGGED or STOLEN (OPERATOR, as its lifecycle allows) and
 * revoke its code (ADMIN, typed confirmation), through the existing routes
 * with a reason that cites the finding, in that order, then resolve it. A
 * step that fails stops the chain; the dialog reports each step, and a retry
 * never repeats a step already done. Ticking a revocation or the
 * COUNTERFEIT FLAGGED mark gives the dialog its destructive marks.
 *
 * The view reads the summary itself (the Type list): its count goes to the
 * badge, which then asks nothing more on this navigation.
 */
import { h } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { anomalyName, formatCount, formatDateTime, humanize, shortHash, summarizeDetails } from '../format.js';
import {
  anomalyFiltersFrom,
  countriesLine,
  decisionDanger,
  decisionError,
  decisionNeedsContext,
  decisionOffer,
  decisionPhrase,
  decisionReason,
  decisionSteps,
  decisionSummary,
  hasAnomalyFilters,
  isProductFilter,
  MARK_FIELDS,
  REASON_MAX,
  REVOKE_FIELD,
  scanHref,
  SORT_OPTIONS,
  sortValue,
  typeOptions,
  windowScansHref,
  type DecisionOffer,
  type DecisionStep,
} from '../model/anomalies.js';
import { can } from '../model/permissions.js';
import { reportWhere, triageMoves } from '../model/registry.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { ANOMALY_SEVERITIES, ANOMALY_STATUSES, type AnomalyContext, type AnomalyRecord, type AnomalyScan, type Paged } from '../types.js';
import {
  anomalyStatus,
  button,
  defList,
  field,
  filterBar,
  input,
  linkButton,
  mono,
  narrowedTo,
  pageHeader,
  pager,
  section,
  select,
  setFieldError,
  statusMark,
  table,
} from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import { pageParam, type ViewContext } from './context.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function anomaliesView(ctx: ViewContext): Promise<HTMLElement> {
  const q = ctx.route.query;
  const filters = anomalyFiltersFrom(q);
  // One finding (a case's link to the anomaly its scan took part in); the server refuses an id that is not one.
  const finding = q.finding?.trim() || undefined;
  const openId = q.id && UUID_RE.test(q.id) ? q.id : null;
  const [listed, summary, detail] = await Promise.all([
    // Filters the server refuses (a URL typed by hand): the form stays, with the refusal, instead of a failed page.
    ctx.api
      .anomalies({ ...filters, ...(finding ? { id: finding } : {}), page: pageParam(ctx), pageSize: 50 })
      .catch((e: unknown): { refused: string } => {
        if (e instanceof ApiError && e.status === 400 && e.code === 'VALIDATION_FAILED') return { refused: e.message };
        throw e;
      }),
    ctx.api.anomalySummary(),
    openId ? ctx.api.anomalyContext(openId).catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))) : Promise.resolve(null),
  ]);
  ctx.attention(summary.attention);
  const canTriage = can(ctx.session.admin.role, 'triageAnomaly');
  const decide = (a: AnomalyRecord, known: AnomalyContext | null) => () => void decision(ctx, a, known);
  const detailHref = (a: AnomalyRecord) => href('anomalies', {}, { ...q, id: a.id });

  // The customers' answers on the scans that took part in the finding: how many, how many still open, the latest
  // (where, and the customer's note), as the Verification events list shows a scan's.
  const reports = (a: AnomalyRecord) =>
    a.reports
      ? h(
          'span',
          { class: 'cell-report' },
          h('a', { class: 'idlink', attrs: { href: href('cases', {}, { anomalyId: a.id }), 'data-testid': 'anomaly-reports' } }, `${a.reports.count} ${a.reports.count === 1 ? 'case' : 'cases'}`),
          h('span', { class: 'cell-sub' }, `${a.reports.open} open`),
          h('span', { class: 'cell-details' }, reportWhere(a.reports.latest)),
          a.reports.latest.note ? h('span', { class: 'cell-details', data: { testid: 'anomaly-report-note' } }, a.reports.latest.note) : null,
        )
      : h('span', { class: 'soft' }, '—');

  const triage = (a: AnomalyRecord) => {
    const details = linkButton('Details', detailHref(a), 'ghost');
    details.setAttribute('data-testid', 'anomaly-details');
    if (!canTriage || triageMoves(a.status).length === 0) return details;
    return h('span', { class: 'cell-actions' }, details, button('Triage', { kind: 'ghost', testId: 'triage', onClick: decide(a, a.id === detail?.anomaly.id ? detail : null) }));
  };

  const header = pageHeader({ eyebrow: 'Activity', title: 'Anomalies', lead: 'Findings from scan patterns and registry checks. Detection only: nothing is revoked automatically.' });
  if ('refused' in listed) {
    return h(
      'div',
      { class: 'view view--anomalies' },
      header,
      filterForm(ctx, summary.types),
      h(
        'div',
        { class: 'failure', attrs: { role: 'alert' }, data: { testid: 'anomalies-refused' } },
        h('p', { class: 'failure__title' }, 'Filters not applied'),
        h('p', { class: 'failure__text' }, listed.refused),
        linkButton('Clear filters', href('anomalies'), 'secondary'),
      ),
    );
  }
  const list: Paged<AnomalyRecord> = listed;

  return h(
    'div',
    { class: 'view view--anomalies' },
    header,
    filterForm(ctx, summary.types),
    detail ? detailPanel(ctx, detail, canTriage ? decide(detail.anomaly, detail) : null) : null,
    table(
      [
        { label: 'Severity', cell: (a) => statusMark(a.severity, toneOf('severity', a.severity)), kind: ['nowrap'] },
        {
          label: 'Finding',
          cell: (a) =>
            h(
              'span',
              null,
              anomalyName(a.type),
              h('span', { class: 'cell-details' }, summarizeDetails(a.details, 220)),
              a.resolutionNote ? h('span', { class: 'cell-sub' }, a.resolutionNote) : null,
            ),
          kind: ['wide'],
        },
        { label: 'Product', cell: (a) => (a.productId ? h('a', { class: 'idlink', attrs: { href: productHref(a.productId) } }, a.productId) : h('span', { class: 'soft' }, 'Unregistered')), kind: ['nowrap'] },
        { label: 'Status', cell: (a) => anomalyStatus(a), kind: ['nowrap'] },
        { label: 'Risk', cell: (a) => String(a.riskScore), kind: ['num'] },
        { label: 'Seen', cell: (a) => String(a.occurrences), kind: ['num'] },
        { label: 'Last seen', cell: (a) => formatDateTime(a.lastSeenAt), kind: ['nowrap'] },
        { label: 'Reports', cell: reports },
        { label: '', cell: triage, kind: ['actions'] },
      ],
      list.items,
      {
        empty: hasAnomalyFilters(filters) || finding ? 'No finding matches these filters.' : 'No anomaly recorded.',
        caption: 'Anomalies',
        onRow: detailHref,
        current: (a) => a.id === openId,
      },
    ),
    pager(list, (p) => ctx.setQuery({ page: p })),
  );
}

// ── Filters ────────────────────────────────────────────────────────────────

function filterForm(ctx: ViewContext, types: readonly string[]): HTMLElement {
  const f = anomalyFiltersFrom(ctx.route.query);
  const product = input('productId', { value: f.productId ?? '', placeholder: 'O26-J-00184', maxlength: 64 });
  const type = select('type', typeOptions(types, f.type), f.type ?? '');
  const status = select('status', [{ value: '', label: 'All' }, ...ANOMALY_STATUSES.map((s) => ({ value: s, label: humanize(s) }))], f.status ?? '');
  const severity = select('severity', [{ value: '', label: 'All' }, ...[...ANOMALY_SEVERITIES].reverse().map((s) => ({ value: s, label: s }))], f.severity ?? '');
  const sort = select('sort', [...SORT_OPTIONS], sortValue(f.sort));
  const form = h(
    'form',
    { class: 'filters__form', attrs: { role: 'search', 'aria-label': 'Filter anomalies' } },
    filterBar(
      field('Product', product),
      field('Type', type),
      field('Status', status),
      field('Severity', severity),
      field('Sort', sort),
      button('Apply', { type: 'submit', kind: 'secondary', testId: 'anomalies-apply' }),
      ctx.route.query.finding ? narrowedTo('One finding', href('anomalies')) : null,
    ),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    // The server filters by a full product id only: a partial one is said here, the list stays as it was.
    if (!isProductFilter(product.value)) {
      setFieldError(form, 'productId', 'Enter a full product id (O26-J-00184).');
      product.focus();
      return;
    }
    setFieldError(form, 'productId', undefined);
    ctx.setQuery({
      productId: product.value.trim().toUpperCase(),
      type: type.value,
      status: status.value,
      severity: severity.value,
      sort: sort.value,
      finding: undefined,
      page: undefined,
    });
  });
  for (const s of [type, status, severity, sort]) s.addEventListener('change', () => form.requestSubmit());
  return form;
}

// ── Detail panel ───────────────────────────────────────────────────────────

function detailPanel(ctx: ViewContext, c: AnomalyContext, onTriage: (() => void) | null): HTMLElement {
  const a = c.anomaly;
  const productId = c.product?.productId ?? null;
  const windowHref = windowScansHref(c);
  const tools = [
    windowHref ? linkButton('Open in verification events', windowHref, 'ghost') : null,
    onTriage && triageMoves(a.status).length ? button('Triage', { kind: 'secondary', testId: 'detail-triage', onClick: onTriage }) : null,
    linkButton('Close', href('anomalies', {}, { ...ctx.route.query, id: undefined }), 'ghost'),
  ].filter((x): x is HTMLButtonElement | HTMLAnchorElement => x !== null);

  const trigger = c.trigger;
  const facts = defList(
    [
      {
        label: 'Finding',
        value: h('span', null, statusMark(a.severity, toneOf('severity', a.severity)), ` ${anomalyName(a.type)}`),
        // Who took the latest decision (A-02), as under the list's status.
        note: `${humanize(a.status)}${a.actorEmail ? ` by ${a.actorEmail}` : ''} · risk ${a.riskScore} · seen ${formatCount(a.occurrences)}×`,
      },
      { label: 'Details', value: h('span', { class: 'cell-details' }, summarizeDetails(a.details, 400) || '—') },
      {
        label: 'Product',
        value: productId ? h('a', { class: 'idlink', attrs: { href: productHref(productId) } }, productId) : h('span', { class: 'soft' }, 'Unregistered identity'),
        ...(c.product ? { note: humanize(c.product.lifecycle.status) } : {}),
      },
      { label: 'Code', value: c.code ? `Issue ${c.code.issue}` : '—', ...(c.code ? { note: humanize(c.code.status) } : {}) },
      { label: 'Window', value: `${formatDateTime(c.window.from)} → ${formatDateTime(c.window.to)}` },
      { label: 'Scans', value: formatCount(c.scans.total), ...(c.scans.truncated ? { note: `The latest ${formatCount(c.scans.items.length)} below` } : {}) },
      { label: 'Countries', value: countriesLine(c.countries) || '—' },
      { label: 'Distinct devices', value: formatCount(c.devices) },
      {
        label: 'Triggering scan',
        value: trigger
          ? h('a', { class: 'idlink', attrs: { href: scanHref(trigger, productId), 'data-testid': 'trigger-scan' } }, formatDateTime(trigger.occurredAt, { seconds: true }))
          : h('span', { class: 'soft' }, 'Not recorded'),
        ...(trigger ? { note: scanWhere(trigger) } : {}),
      },
      // What customers said about the finding's scans (C-02): its cases, as the list's Reports column shows them.
      {
        label: 'Cases',
        value: a.reports
          ? h(
              'a',
              { class: 'idlink', attrs: { href: href('cases', {}, { anomalyId: a.id }), 'data-testid': 'finding-cases' } },
              `${formatCount(a.reports.count)} ${a.reports.count === 1 ? 'case' : 'cases'}`,
            )
          : h('span', { class: 'soft' }, 'No customer report'),
        ...(a.reports ? { note: `${formatCount(a.reports.open)} open · latest ${reportWhere(a.reports.latest)}` } : {}),
      },
    ],
    'deflist--cols',
  );
  const timeline = c.scans.items.length
    ? h('ol', { class: 'timeline timeline--scans', data: { testid: 'anomaly-timeline' } }, ...c.scans.items.map(scanItem))
    : h('p', { class: 'soft micro' }, 'No scan in this window.');
  return section('Finding', [facts, h('h3', { class: 'panel__subtitle' }, 'Scans in the window'), timeline], { id: 'finding', class: 'panel--finding', tools });
}

function scanWhere(s: AnomalyScan): string {
  return [s.country ?? 'UNKNOWN', s.region, s.deviceHash ? `device ${shortHash(s.deviceHash, 6, 2)}` : null].filter(Boolean).join(' · ');
}

function scanItem(s: AnomalyScan): HTMLElement {
  return h(
    'li',
    { class: ['timeline__item', s.trigger ? 'timeline__item--trigger' : null], data: { scan: s.id } },
    h('span', { class: 'timeline__when' }, formatDateTime(s.occurredAt, { seconds: true })),
    h('span', { class: 'timeline__move' }, h('strong', null, humanize(s.state)), s.eventType === 'VERIFY' ? '' : ` · ${humanize(s.eventType)}`),
    h('span', { class: 'timeline__who' }, scanWhere(s)),
    h(
      'span',
      { class: 'timeline__reason' },
      [s.userAgentFamily, s.riskScore === null ? null : `Risk ${s.riskScore}`, s.trigger ? 'Raised this finding' : null].filter(Boolean).join(' · ') || '—',
      ' ',
      mono(s.id, shortHash(s.id, 8, 4)),
    ),
    // The customer reported on this scan (C-02): where they saw or bought the piece, and the state of its case.
    s.report
      ? h(
          'span',
          { class: 'timeline__reason', data: { testid: 'timeline-report' } },
          'Customer report: ',
          h('a', { class: 'idlink', attrs: { href: href('cases', {}, { scanId: s.id }) } }, reportWhere(s.report)),
          ` · ${humanize(s.report.status)}`,
        )
      : null,
  );
}

// ── Decision ───────────────────────────────────────────────────────────────

async function decision(ctx: ViewContext, a: AnomalyRecord, known: AnomalyContext | null): Promise<void> {
  const role = ctx.session.admin.role;
  const moves = triageMoves(a.status);
  if (moves.length === 0) return;
  let c = known;
  if (!c && decisionNeedsContext(a, role)) {
    try {
      c = await ctx.api.anomalyContext(a.id);
    } catch (e) {
      notifyError(e);
      return;
    }
  }
  const offer = decisionOffer(c, role, moves);
  const report = h('ol', { class: 'steps', attrs: { hidden: true, 'aria-live': 'polite' }, data: { testid: 'decision-steps' } });
  const done = new Set<string>();
  let last: DecisionStep[] = [];

  const fields: DialogField[] = [
    { name: 'status', label: 'Decision', kind: 'select', required: true, options: moves.map((m) => ({ value: m.to, label: `${m.label} → ${humanize(m.to)}` })) },
    ...offer.marks.map((m): DialogField => ({ name: MARK_FIELDS[m], label: `Mark the piece ${humanize(m)}`, kind: 'checkbox' })),
    ...(offer.revoke
      ? [{ name: REVOKE_FIELD, label: `Revoke the code (issue ${offer.revoke.issue})`, kind: 'checkbox' as const, hint: 'Scans of this code then verify as REVOKED; a new issue needs a re-print.' }]
      : []),
    {
      name: 'note',
      label: 'Note',
      kind: 'textarea',
      maxlength: 2000,
      hint: offer.marks.length || offer.revoke ? 'Required to resolve, dismiss or reopen. Each action cites this finding and the note.' : 'Required to resolve, dismiss or reopen a closed finding.',
    },
  ];

  const r = await openDialog({
    title: anomalyName(a.type),
    eyebrow: `${a.severity} · ${a.productId ?? 'Unregistered identity'} · ${humanize(a.status)}`,
    body: [h('p', { class: 'dialog__text' }, summarizeDetails(a.details, 400) || 'No details recorded.'), report],
    fields,
    phrase: (v) => decisionPhrase(v, offer, done),
    danger: (v) => decisionDanger(v, offer, done),
    // A mark or a revocation done by an earlier attempt stays part of the decision (its box is locked, ticked): the
    // retry can only resolve the finding, and its summary names what was done.
    validate: (v) => decisionError(v, offer, moves, done),
    confirmLabel: 'Record decision',
    submit: async (v) => {
      last = decisionSteps(v, offer, done);
      await runSteps(ctx, a, offer, last, v.note?.trim() || undefined, done, report);
    },
  });
  if (r) {
    notify(decisionSummary(last));
    ctx.reload();
  } else if (done.size > 0) {
    // Cancelled after a partial failure: what was done stays done, and the page shows it.
    notify(`Partly recorded: ${decisionSummary(last.filter((s) => done.has(s.key)))}`);
    ctx.reload();
  }
}

/** Tick and lock the dialog's box of a step that is done. */
function lockBox(inDialog: HTMLElement, name: string): void {
  const box = inDialog.closest('form, dialog')?.querySelector<HTMLInputElement>(`input[type=checkbox][name="${name}"]`);
  if (!box) return;
  box.checked = true;
  box.disabled = true;
}

/** Run the steps in order, skipping those already done; report each one; stop at the first failure. */
async function runSteps(ctx: ViewContext, a: AnomalyRecord, offer: DecisionOffer, steps: DecisionStep[], note: string | undefined, done: Set<string>, report: HTMLElement): Promise<void> {
  const state = new Map<string, 'done' | 'failed' | 'pending'>(steps.map((s) => [s.key, done.has(s.key) ? 'done' : 'pending']));
  const paint = () => {
    report.hidden = false;
    report.replaceChildren(
      ...steps.map((s) => {
        const st = state.get(s.key)!;
        return h('li', { class: 'steps__item', data: { state: st } }, h('span', { class: 'steps__label' }, s.label), h('span', { class: 'steps__state' }, st === 'done' ? 'Done' : st === 'failed' ? 'Failed' : 'Not done'));
      }),
    );
  };
  paint();
  const product = offer.productId ?? a.productUuid;
  for (const s of steps) {
    if (done.has(s.key)) continue;
    try {
      if (s.kind === 'mark') await ctx.api.transition(product!, s.to, decisionReason(a, note, REASON_MAX.transition));
      else if (s.kind === 'revoke') await ctx.api.revokeCode(s.codeId, decisionReason(a, note, REASON_MAX.revoke));
      else await ctx.api.updateAnomaly(a.id, s.to, note);
      done.add(s.key);
      state.set(s.key, 'done');
      // What was done to the piece cannot be undone from here: its box stays ticked and is locked.
      if (s.kind !== 'status') lockBox(report, s.kind === 'mark' ? MARK_FIELDS[s.to] : REVOKE_FIELD);
      paint();
    } catch (e) {
      state.set(s.key, 'failed');
      paint();
      const why = e instanceof ApiError ? e.message : 'The action could not be completed.';
      const kept = done.size ? ' The steps done stay done; confirm again to retry the rest.' : '';
      throw new ApiError(e instanceof ApiError ? e.status : 0, e instanceof ApiError ? e.code : 'STEP_FAILED', `${s.label}: ${why}${kept}`);
    }
  }
}
