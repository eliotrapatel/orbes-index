/**
 * TEST ENTRANTS (plan TEST ENTRANTS, 2026-10-07): the section of a draw's page and of a LIVE RELEASE's page. Model in
 * model/test-entrants.ts; routes in server/routes/admin/test-entrants.ts.
 *
 *  - SEND TEST ENTRANTS (ADMIN, a phrase to type), while the draw is open (or its early access, to reserve) or the room
 *    is open: the number per tier, the arrival, the behaviour (LIVE: PAY, RELEASE, MISS, LEAVE and the hold; a draw:
 *    withdraw, reserve, confirm by themselves), the choices (LIVE) and the profile, each with its default.
 *  - The release's test while one is not ended, read again every 2 s while the tab is shown: its status, its settings,
 *    its test entrants by tier, the release's entries real, test and in all, the test entrants holding a place with
 *    CONFIRM (and RELEASE on a LIVE RELEASE), the runner's last errors; ADD MORE (a phrase) and STOP while it runs; END
 *    TEST (a phrase, danger) until it has ended.
 *  - PAST TESTS: when, by whom, how many, the checks of its report passed; the report itself (its checks, each passed or
 *    failed in one line, and its peaks); END TEST for an earlier test not ended (a newer one sent since).
 * An AUDITOR and an OPERATOR read everything, without a button.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import { tierName } from '../model/club.js';
import { can } from '../model/permissions.js';
import {
  arrivalOptions,
  checksLine,
  isTestAccount,
  lastSettings,
  peakRows,
  pressCount,
  pressesLine,
  reportScore,
  TEST_ENTRANTS_LIMITS,
  TEST_TIER_COLUMNS,
  TEST_TIERS,
  testEntrantActions,
  testPhrase,
  testRunActions,
  testRunInput,
  testRunLine,
  testRunProblem,
  testRunValues,
  testSettingsLine,
  tierCounts,
  tierRows,
  tierTotal,
  type TestStart,
} from '../model/test-entrants.js';
import { STATUS_REFRESH_MS } from '../model/system-status.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { TestReport, TestRunMode, TestRunSelected, TestRunSettings, TestRunSummary, TestRunView } from '../types.js';
import { button, defList, kpi, section, statusMark, table } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { startRefresh } from '../ui/refresh.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The release a section tests. */
export interface TestTarget {
  mode: TestRunMode;
  dropId: string;
  /** The dialogs' eyebrow, as the page's own. */
  eyebrow: string;
  start: TestStart;
  /** A LIVE RELEASE's sizes, and the pieces one person may take. */
  sizes?: readonly { id: string; label: string }[];
  perAccount?: number;
}

/** What the page read with its own: the release's test not ended, its tests; null for a read that failed. */
export interface TestReads {
  current: { run: TestRunView | null } | null;
  runs: { runs: TestRunSummary[] } | null;
}

/** The two reads of the section, made with the page's own; a failure never stops the page. */
export function loadTestReads(ctx: ViewContext, dropId: string): Promise<TestReads> {
  return Promise.all([ctx.api.currentTestRun(dropId).catch(() => null), ctx.api.testRuns(dropId).catch(() => null)]).then(([current, runs]) => ({ current, runs }));
}

/** A test account's mark beside its email in the entries' lists (its email ends @orbes.test); null for any other. */
export function testTag(email: string): HTMLElement | null {
  return isTestAccount(email) ? h('span', { class: 'test-tag', attrs: { title: 'A test entrant: an account of the test pool, cleaned up by END TEST' }, data: { testid: 'test-tag' } }, 'TEST') : null;
}

/** The fields of SEND TEST ENTRANTS and ADD MORE: a draw's, or a LIVE RELEASE's. */
export function testFields(t: Pick<TestTarget, 'mode' | 'sizes' | 'perAccount'>, v: Record<string, string>): DialogField[] {
  const L = TEST_ENTRANTS_LIMITS;
  const live = t.mode === 'LIVE';
  const share = (name: string, label: string, hint?: string): DialogField => ({ name, label, maxlength: 3, value: v[name], hint: hint ?? '0 to 100.' });
  const pieces = Math.max(1, Math.min(L.quantity.max, t.perAccount ?? L.quantity.max));
  return [
    ...TEST_TIERS.map((x, i) => ({
      name: `tier:${x.key}`,
      label: `Test entrants · ${x.label}`,
      maxlength: 4,
      value: v[`tier:${x.key}`],
      hint: i === 0 ? `Per tier, ${formatCount(L.perPress)} at most together in one press. Their tier is set on the test account, never from pieces.` : undefined,
    })),
    { name: 'arrival', label: 'Arrival', kind: 'select', options: arrivalOptions(t.mode), value: v.arrival },
    { name: 'seconds', label: 'Arrival · seconds of the burst', maxlength: 4, value: v.seconds, hint: `For a burst: ${L.burstSeconds.min} to ${formatCount(L.burstSeconds.max)}, the arrivals even over them.` },
    ...(live ? [share('interestPct', 'Arrival · I’LL BE THERE first (%)', 'The share that says I’LL BE THERE before the opening, as a collector does from the release’s page.')] : []),
    ...(live
      ? [
          share('payPct', 'Behaviour · PAY (%)', 'At their turn: the share that holds the seal, then pays. PAY, RELEASE, MISS and LEAVE make 100 together.'),
          share('releasePct', 'Behaviour · RELEASE MY PLACE (%)'),
          share('missPct', 'Behaviour · miss the turn (%)', 'They let their turn run out.'),
          share('leavePct', 'Behaviour · LEAVE (%)'),
          { name: 'holdSeconds', label: 'Behaviour · seconds the seal is held', maxlength: 4, value: v.holdSeconds, hint: `${L.holdSeconds.min} to ${L.holdSeconds.max}: the server refuses a hold under 1.4 s, and the bot radar reads holds under 1.45 s.` },
        ]
      : [
          share('withdrawPct', 'Behaviour · withdraw (%)', 'The share that withdraws a little after entering.'),
          share('reservePct', 'Behaviour · reserve in early access (%)', 'Of the PLATINE and PALLADIUM: the share that reserves a place directly while the early access is open, instead of entering.'),
          share('confirmPct', 'Behaviour · confirm by themselves (%)', 'Of the places drawn, reserved or offered next: the share confirmed by itself 5 to 60 s later, the staff Confirm with its order. The others lapse as usual.'),
        ]),
    ...(live
      ? [
          {
            name: 'size',
            label: 'Choices · size',
            kind: 'select' as const,
            options: [{ value: '', label: 'At random among the release’s sizes' }, ...(t.sizes ?? []).map((s) => ({ value: s.id, label: s.label }))],
            value: v.size,
          },
          {
            name: 'quantity',
            label: 'Choices · pieces',
            kind: 'select' as const,
            options: [{ value: '', label: `At random, up to ${pieces}` }, ...Array.from({ length: pieces }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i === 0 ? 'piece' : 'pieces'}` }))],
            value: v.quantity === '' || Number(v.quantity) <= pieces ? v.quantity : '1',
          },
          share('addOnsPct', 'Choices · add-ons (%)', 'The share that adds the release’s add-ons to the piece held.'),
        ]
      : []),
    { name: 'seniorityMin', label: 'Profile · seniority from (years)', maxlength: 2, value: v.seniorityMin, hint: `Each drawn within the range, ${L.seniority.min} to ${L.seniority.max}: it ranks a draw after the tier.` },
    { name: 'seniorityMax', label: 'Profile · seniority to (years)', maxlength: 2, value: v.seniorityMax },
    { name: 'ageMin', label: 'Profile · account age from (days)', maxlength: 4, value: v.ageMin, hint: `${L.accountAgeDays.min} to ${formatCount(L.accountAgeDays.max)}: the bot radar flags new accounts.` },
    { name: 'ageMax', label: 'Profile · account age to (days)', maxlength: 4, value: v.ageMax },
    { name: 'countries', label: 'Profile · countries', maxlength: 200, value: v.countries, hint: 'Two letters each (FR, JP, US), each drawn at random. Empty: none.' },
    share('sharedNetworkPct', 'Profile · shared network (%)', 'The share coming from one shared network, to test the bot radar; the others each have their own.'),
  ];
}

/** The total a dialog would send, or what stops it, under its fields. */
function pressPreview(mode: TestRunMode, v: Record<string, string>, opts: { already?: number; earlyOnly?: boolean }): HTMLElement {
  const tiers = tierCounts(v);
  const problem = testRunProblem(mode, v, opts);
  const total = tiers ? tierTotal(tiers) : null;
  return h(
    'p',
    { class: ['dialog__text', problem ? 'soft' : null], data: { testid: 'test-total' } },
    total === null ? 'Each tier a whole number.' : `${formatCount(total)} test ${total === 1 ? 'entrant' : 'entrants'} in this press${opts.already ? `, ${formatCount(opts.already + total)} in the test` : ''}.`,
    problem && total !== null ? ` ${problem}` : null,
  );
}

/** A report: each check passed or failed in its line, then the test's peaks. */
export function reportBody(report: TestReport | null, peaks: Record<string, unknown> | null | undefined): Child[] {
  const peaksList = peakRows(peaks);
  return [
    report
      ? h(
          'ul',
          { class: 'tests__checks', data: { testid: 'test-report-checks' } },
          ...report.checks.map((c) =>
            h('li', { class: 'tests__check', data: { testid: 'test-report-check', pass: String(c.pass) } }, statusMark(c.pass ? 'PASSED' : 'FAILED', c.pass ? 'solid' : 'critical'), h('span', { class: 'tests__check-label' }, c.label), h('span', { class: 'cell-sub' }, c.line)),
          ),
        )
      : h('p', { class: 'dialog__text' }, 'No report: it is computed by END TEST, before the clean-up.'),
    peaksList.length
      ? [h('p', { class: 'tests__subtitle' }, 'Peaks while it ran'), defList(peaksList.map((p) => ({ label: p.label, value: p.value })))]
      : h('p', { class: 'dialog__text soft' }, 'No peaks were kept.'),
  ].flat();
}

/** The section; `reads`: what the page read with its own. */
export function testEntrantsSection(ctx: ViewContext, t: TestTarget, reads: TestReads): HTMLElement {
  const role = ctx.session.admin.role;
  const tools = h('span', { class: 'tests__tools' });
  const runBox = h('div', { class: 'tests__run', data: { testid: 'test-run' } });
  const pastBox = h('div', { class: 'tests__past', data: { testid: 'test-past' } });
  const root = section('Test entrants', [h('p', { class: 'panel__text', data: { testid: 'test-start-line' } }, t.start.line), runBox, pastBox], { id: 'test-entrants', tools: [tools] });

  let run: TestRunView | null = reads.current?.run ?? null;
  let runs: TestRunSummary[] = reads.runs?.runs ?? [];
  let runKey = '';
  let pastKey = '';
  let toolsKey = '';
  // Not read yet: the page's read failed (the section says so until a read answers).
  let unread = reads.current === null;

  const refreshPast = async () => {
    try {
      runs = (await ctx.api.testRuns(t.dropId, { background: true })).runs;
      drawPast();
    } catch {
      // The next change of the test reads them again.
    }
  };

  // ── The dialogs ──────────────────────────────────────────────────────────
  const sendPhrase = testPhrase('send', t.dropId);
  const send = () =>
    void openDialog({
      title: 'Send test entrants',
      eyebrow: t.eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, `${t.start.line} They are collector accounts of the test pool, kept from one test to the next: they win like anyone, take real ${t.mode === 'LIVE' ? 'pieces' : 'places'}, and their orders are real until END TEST.`),
        h('p', { class: 'dialog__text' }, 'One test at a time in the console. The server’s panel shows when the load is too much: then STOP.'),
      ],
      fields: testFields(t, testRunValues()),
      live: (v) => pressPreview(t.mode, v, { earlyOnly: t.start.earlyOnly }),
      validate: (v) => testRunProblem(t.mode, v, { earlyOnly: t.start.earlyOnly }),
      phrase: sendPhrase,
      confirmLabel: 'Send test entrants',
      submit: async (v) => {
        await ctx.api.startTestRun(t.dropId, testRunInput(t.mode, v, sendPhrase));
      },
    }).then((v) => {
      if (!v) return;
      notify('Test sent: its test entrants are on their way.');
      void current.now();
      void refreshPast();
    });

  const addMore = (r: TestRunView) =>
    void openDialog({
      title: 'Add more test entrants',
      eyebrow: t.eyebrow,
      body: h(
        'p',
        { class: 'dialog__text' },
        `Into the same test, with its last settings or new ones: ${formatCount(TEST_ENTRANTS_LIMITS.perPress)} at most per press, ${formatCount(TEST_ENTRANTS_LIMITS.perRun)} in the test (${formatCount(r.entrants)} now).`,
      ),
      fields: testFields(t, testRunValues(lastSettings(r))),
      live: (v) => pressPreview(t.mode, v, { already: r.entrants, earlyOnly: t.start.earlyOnly }),
      validate: (v) => testRunProblem(t.mode, v, { already: r.entrants, earlyOnly: t.start.earlyOnly }),
      phrase: sendPhrase,
      confirmLabel: 'Add test entrants',
      submit: async (v) => {
        await ctx.api.addTestEntrants(r.id, testRunInput(t.mode, v, sendPhrase));
      },
    }).then((v) => {
      if (!v) return;
      notify('Test entrants added to the test.');
      void current.now();
    });

  const stop = async (btn: HTMLButtonElement, r: TestRunView) => {
    btn.disabled = true;
    try {
      await ctx.api.stopTestRun(r.id);
      notify('Test stopped: its test entrants no longer act. END TEST cleans up.');
      void current.now();
    } catch (e) {
      notifyError(e);
      btn.disabled = false;
    }
  };

  const endPhrase = testPhrase('end', t.dropId);
  const end = (r: Pick<TestRunView, 'id'>) =>
    void openDialog({
      title: 'End the test',
      eyebrow: t.eyebrow,
      danger: true,
      body: [
        h('p', { class: 'dialog__text' }, `Its test entrants stop, and its report is computed first: one entry per account,${t.mode === 'DRAW' ? ' the draw’s order,' : ''} nobody holding two places, the stock against the orders, an order for every place confirmed.`),
        h(
          'p',
          { class: 'dialog__text' },
          `Then, for its test entrants only: their open orders are cancelled one by one (the stock goes back; a piece to make has its identity retired for good), their entries closed${t.mode === 'DRAW' ? ', and in a drawn draw their places held or confirmed lapse, so that staff can OFFER NEXT to real collectors' : ''}. The test accounts are kept for the next test.`,
        ),
      ],
      phrase: endPhrase,
      confirmLabel: 'End test',
      submit: async () => {
        await ctx.api.endTestRun(r.id, endPhrase);
      },
    }).then((v) => {
      if (!v) return;
      notify('Test ended: its report is under PAST TESTS.');
      void current.now();
      void refreshPast();
    });

  const byHand = (r: TestRunView, e: TestRunSelected, action: 'confirm' | 'release') =>
    void openDialog({
      title: action === 'confirm' ? 'Confirm the test entrant' : 'Release its place',
      eyebrow: `${e.email} · ${tierName(e.tier)}`,
      body: h(
        'p',
        { class: 'dialog__text' },
        action === 'release'
          ? 'It presses RELEASE MY PLACE now: the piece it holds goes to the next in line.'
          : r.mode === 'DRAW'
            ? 'The staff Confirm, as for a collector: the entry reads CONFIRMED and its order is created now.'
            : 'It holds the seal and pays now: its orders are created, one per piece.',
      ),
      confirmLabel: action === 'confirm' ? 'Confirm' : 'Release',
      submit: async () => {
        if (action === 'confirm') await ctx.api.confirmTestEntrant(r.id, e.accountId);
        else await ctx.api.releaseTestEntrant(r.id, e.accountId);
      },
    }).then((v) => {
      if (!v) return;
      notify(action === 'confirm' ? 'Test entrant confirmed.' : 'Place released.');
      void current.now();
    });

  const showReport = (x: Pick<TestRunSummary, 'createdAt' | 'createdBy' | 'report'> & { peaks?: Record<string, unknown> | null }) =>
    void openDialog({
      title: 'Test report',
      eyebrow: `${formatDateTime(x.createdAt)} · ${x.createdBy}`,
      body: reportBody(x.report, x.report?.peaks ?? x.peaks),
      confirmLabel: 'Done',
      cancelLabel: 'Close',
    });

  // ── The test not ended ───────────────────────────────────────────────────
  const drawRun = () => {
    const a = testRunActions(run, role, t.start);
    // The buttons are drawn again only when they change: STOP keeps its focus, and a press held across a refresh still clicks.
    const tk = JSON.stringify([a, run?.id ?? null]);
    if (tk !== toolsKey) {
      toolsKey = tk;
      mount(
        tools,
        a.send ? button('Send test entrants', { kind: 'primary', testId: 'test-send', onClick: send }) : null,
        run && a.addMore ? button('Add more', { kind: 'ghost', testId: 'test-add', onClick: () => addMore(run!) }) : null,
        run && a.stop ? stopButton(run) : null,
        run && a.end ? button('End test', { kind: 'danger', testId: 'test-end', onClick: () => end(run!) }) : null,
      );
    }
    if (!run) {
      mount(runBox, unread ? h('p', { class: 'notice' }, 'The test could not be read just now: it is asked again every 2 seconds.') : null);
      return;
    }
    const r = run;
    const s: TestRunSettings = lastSettings(r);
    const presses = pressCount(r);
    const columns = TEST_TIER_COLUMNS[r.mode];
    // A row's CONFIRM or RELEASE focused keeps its focus when the list is drawn again.
    const focused = document.activeElement instanceof HTMLElement && runBox.contains(document.activeElement) ? document.activeElement : null;
    const refocus = focused?.dataset.testid ? { testid: focused.dataset.testid, account: focused.closest<HTMLElement>('[data-account]')?.dataset.account ?? null } : null;
    mount(
      runBox,
      defList([
        { label: 'Status', value: h('span', { data: { testid: 'test-status' } }, statusMark(humanize(r.status), toneOf('testRun', r.status))), note: testRunLine(r) },
        { label: 'Sent', value: `${formatDateTime(r.createdAt)} · ${r.createdBy}` },
        { label: 'Test entrants', value: h('span', { data: { testid: 'test-entrants-count' } }, formatCount(r.entrants)), note: pressesLine(r) ?? undefined },
        { label: 'Settings', value: h('span', { data: { testid: 'test-settings' } }, testSettingsLine(r.mode, s, t.sizes)), note: presses > 1 ? 'The last press’s.' : undefined },
      ]),
      h(
        'div',
        { class: ['kpis', 'tests__figures'], data: { testid: 'test-release' } },
        kpi('Real', formatCount(r.release.real), 'ENTRIES OF COLLECTORS'),
        kpi('Test', formatCount(r.release.test), 'ENTRIES OF TEST ENTRANTS'),
        kpi('Total', formatCount(r.release.total), 'ENTRIES IN THE RELEASE'),
      ),
      h(
        'div',
        { data: { testid: 'test-tiers' } },
        table(
          [
            { label: 'Tier', cell: (x) => (x.total ? h('strong', null, x.label) : x.label), kind: ['nowrap'] },
            ...columns.map((c) => ({ label: c.label, cell: (x: ReturnType<typeof tierRows>[number]) => formatCount(x.counts[c.key]), kind: ['num' as const] })),
          ],
          tierRows(r.byTier),
          { caption: 'Test entrants by tier' },
        ),
      ),
      h('p', { class: 'tests__subtitle' }, r.mode === 'DRAW' ? 'Test entrants holding a place' : 'Test entrants in a turn or holding a piece'),
      h(
        'div',
        { data: { testid: 'test-selected' } },
        table(
          [
            { label: 'Account', cell: (e: TestRunSelected) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: e.accountId }) } }, e.email), testTag(e.email)), kind: ['wide'] },
            { label: 'Tier', cell: (e: TestRunSelected) => tierName(e.tier), kind: ['nowrap'] },
            { label: 'Status', cell: (e: TestRunSelected) => statusMark(humanize(e.status), toneOf(r.mode === 'DRAW' ? 'dropEntry' : 'liveEntry', e.status)), kind: ['nowrap'] },
            { label: 'Until', cell: (e: TestRunSelected) => (e.respondBy ? formatDateTime(e.respondBy) : h('span', { class: 'soft' }, '—')), kind: ['nowrap'] },
            { label: 'Order', cell: (e: TestRunSelected) => (e.orderRef ? h('span', { class: 'mono' }, e.orderRef) : h('span', { class: 'soft' }, '—')), kind: ['nowrap'] },
            {
              label: '',
              cell: (e: TestRunSelected) => {
                const x = testEntrantActions(r, e, role);
                return h(
                  'span',
                  { class: 'row-actions', data: { account: e.accountId } },
                  x.confirm ? button('Confirm', { kind: 'ghost', testId: 'test-entrant-confirm', onClick: () => byHand(r, e, 'confirm') }) : null,
                  x.release ? button('Release', { kind: 'ghost', testId: 'test-entrant-release', onClick: () => byHand(r, e, 'release') }) : null,
                );
              },
              kind: ['actions'],
            },
          ],
          r.selected,
          { caption: 'Test entrants holding a place', empty: r.mode === 'DRAW' ? 'None holds a place: the places come with the early access and the staff draw.' : 'None is in a turn or holds a piece now.' },
        ),
      ),
      ...(r.errors.length
        ? [
            h('p', { class: 'tests__subtitle' }, 'Last errors'),
            // The newest first.
            h('ul', { class: 'tests__errors', data: { testid: 'test-errors' } }, ...[...r.errors].reverse().map((e) => h('li', null, h('span', { class: 'cell-sub' }, formatDateTime(e.at, { seconds: true })), e.message))),
          ]
        : [h('p', { class: 'footnote', data: { testid: 'test-errors' } }, 'No error from the test entrants.')]),
    );
    if (refocus) {
      const within = refocus.account ? runBox.querySelector(`[data-account="${refocus.account}"]`) : runBox;
      within?.querySelector<HTMLElement>(`[data-testid="${refocus.testid}"]`)?.focus();
    }
  };
  // STOP: one press, no phrase (nothing is cleaned).
  const stopButton = (r: TestRunView) => {
    const b = button('Stop', { kind: 'secondary', testId: 'test-stop' });
    b.addEventListener('click', () => void stop(b, r));
    return b;
  };

  // ── PAST TESTS ───────────────────────────────────────────────────────────
  const drawPast = () => {
    const past = runs.filter((x) => x.id !== run?.id);
    const k = JSON.stringify(past);
    if (k === pastKey) return;
    pastKey = k;
    mount(
      pastBox,
      h('p', { class: 'tests__subtitle' }, 'Past tests'),
      table(
        [
          { label: 'Date', cell: (x: TestRunSummary) => formatDateTime(x.createdAt), kind: ['nowrap'] },
          { label: 'By', cell: (x: TestRunSummary) => x.createdBy, kind: ['wide'] },
          { label: 'Entrants', cell: (x: TestRunSummary) => formatCount(x.entrants), kind: ['num'] },
          { label: 'Status', cell: (x: TestRunSummary) => statusMark(humanize(x.status), toneOf('testRun', x.status)), kind: ['nowrap'] },
          {
            label: 'Checks',
            cell: (x: TestRunSummary) => {
              const score = x.report ? reportScore(x.report) : null;
              const failed = score ? score.passed < score.total : (x.checksPassed ?? 0) < (x.checksTotal ?? 0);
              return h('span', { class: [failed ? 'critical-text' : null], data: { testid: 'test-past-checks' } }, checksLine(x));
            },
            kind: ['num'],
          },
          {
            label: '',
            // An earlier test not ended (a newer one sent since) keeps its END TEST here.
            cell: (x: TestRunSummary) =>
              h(
                'span',
                { class: 'row-actions' },
                x.report ? button('Report', { kind: 'ghost', testId: 'test-report', onClick: () => showReport(x) }) : null,
                x.status !== 'ENDED' && can(role, 'runTestEntrants') ? button('End test', { kind: 'danger', testId: 'test-past-end', onClick: () => end(x) }) : null,
              ),
            kind: ['actions'],
          },
        ],
        past,
        { caption: 'Past tests', empty: 'No past test of this release.' },
      ),
    );
  };

  const apply = (next: TestRunView | null) => {
    const k = JSON.stringify(next);
    if (k === runKey && !unread) return;
    unread = false;
    const changed = (next?.id ?? null) !== (run?.id ?? null) || next?.status !== run?.status;
    runKey = k;
    run = next;
    drawRun();
    drawPast();
    if (changed) void refreshPast();
  };
  runKey = JSON.stringify(run);
  drawRun();
  drawPast();
  const current = startRefresh({
    load: () => ctx.api.currentTestRun(t.dropId, { background: true }),
    apply: (x) => apply(x.run),
    everyMs: STATUS_REFRESH_MS,
    immediate: reads.current === null,
    owner: root,
  });
  return root;
}
