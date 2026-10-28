/**
 * The Ended tests page, `#/settings/tests` (lot PURGE, plan §A.6; the owner's answers of 27 Oct 2026, answer 4): every
 * ended test of every release, read from GET /api/admin/test-runs/ended (routes/admin/test-entrants.ts). Reached from
 * the Settings page; no link of its own in the sidebar, as the Settings page. Model in model/test-purge.ts.
 *
 *  - One row per test, the newest ended first: its release (a link to its page), when it ended (Paris), who sent it, its
 *    test entrants, its status (PURGING with how far, PAUSED with its reason in Paris words, PURGED with when and by
 *    whom; for an ADMIN, why an ended test cannot be purged, muted), its report.
 *  - PURGE on a row (ADMIN; RESUME PURGE on a paused one): the dialog of the release's page (views/test-entrants.ts).
 *  - PURGE ALL ENDED TESTS (ADMIN, while one test at least can be purged): what it would do is read first (how many
 *    tests, the paused purges it resumes, the tests skipped and why, at most how many of the pool's test accounts go,
 *    a window or a running test now), then a danger dialog with the phrase PURGE ALL TESTS and a fresh authenticator
 *    code; a refusal is said inside it.
 *  - Read again every 2 s while a purge is under way (ui/refresh.ts, in the background: a 401 never signs out here).
 * Everyone who reads the console reads the page; an AUDITOR and an OPERATOR without a button. Empty: "No ended test."
 */
import { h, mount } from '../../shared/dom.js';
import { formatCount } from '../format.js';
import { parisDateTime } from '../model/links.js';
import { STATUS_REFRESH_MS } from '../model/system-status.js';
import { canPurgeAll, codeProblem, ENDED_TESTS_TEXT, PURGE_ALL_PHRASE, purgeAction, purgeAllDialogText, purgeCodeField, purgeUnderWay, typedCode } from '../model/test-purge.js';
import { checksLine } from '../model/test-entrants.js';
import { href } from '../router.js';
import type { EndedTestRun, TestPurgeAllPreview } from '../types.js';
import { button, linkButton, pageHeader, section, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { startRefresh, type Refresh } from '../ui/refresh.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { purgeTest, reportBody, testRunStatusCell } from './test-entrants.js';

export async function endedTestsView(ctx: ViewContext): Promise<HTMLElement> {
  let runs: EndedTestRun[] = (await ctx.api.endedTestRuns()).runs;
  const role = ctx.session.admin.role;
  const allBox = h('span', { class: 'tests__tools' });
  const listBox = h('div', { data: { testid: 'ended-tests' } });
  const notice = h('p', { class: 'notice', data: { testid: 'ended-tests-unread' }, attrs: { hidden: true } }, ENDED_TESTS_TEXT.unread);
  const root = h(
    'div',
    { class: 'view view--ended-tests' },
    pageHeader({
      eyebrow: 'Settings',
      title: 'Ended tests',
      lead: ENDED_TESTS_TEXT.lead,
      actions: [linkButton('Settings', href('settings'), 'ghost'), allBox],
    }),
    section('Tests', [notice, listBox]),
  );

  // ── Reads ────────────────────────────────────────────────────────────────
  let watch: Refresh | null = null;
  const apply = (next: EndedTestRun[]) => {
    runs = next;
    notice.hidden = true;
    draw();
    follow();
  };
  /** Read again every 2 s while a purge is under way; stopped once none is. */
  const follow = () => {
    if (!purgeUnderWay(runs)) {
      watch?.stop();
      watch = null;
      return;
    }
    watch ??= startRefresh({
      load: () => ctx.api.endedTestRuns({ background: true }),
      apply: (x) => apply(x.runs),
      failed: () => {
        notice.hidden = false;
      },
      everyMs: STATUS_REFRESH_MS,
      immediate: false,
      owner: root,
    });
  };
  const reread = async () => {
    try {
      apply((await ctx.api.endedTestRuns({ background: true })).runs);
    } catch {
      notice.hidden = false;
      follow();
    }
  };

  // ── The dialogs ──────────────────────────────────────────────────────────
  const showReport = (x: EndedTestRun) =>
    void openDialog({
      title: 'Test report',
      eyebrow: `${x.dropName} · ${parisDateTime(x.createdAt)} · ${x.createdBy}`,
      body: reportBody(x.report, x.report?.peaks ?? x.peaks),
      confirmLabel: 'Done',
      cancelLabel: 'Close',
    });

  const purgeAll = async (btn: HTMLButtonElement) => {
    btn.disabled = true;
    let preview: TestPurgeAllPreview;
    try {
      preview = (await ctx.api.testRunPurgeAllPreview()).preview;
    } catch (e) {
      notifyError(e);
      return;
    } finally {
      btn.disabled = false;
    }
    const text = purgeAllDialogText(preview, runs);
    const asked = await openDialog({
      title: 'Purge all ended tests',
      eyebrow: 'Settings · Ended tests',
      danger: true,
      body: [
        ...text.lines.map((line) => h('p', { class: ['dialog__text', 'tests__purge-text'], data: { testid: 'purge-line' } }, line)),
        text.skipped.length ? h('ul', { class: 'tests__skipped', data: { testid: 'purge-all-skipped' } }, ...text.skipped.map((line) => h('li', null, line))) : null,
        text.hold ? h('p', { class: ['dialog__text', 'tests__purge-text', 'critical-text'], data: { testid: 'purge-hold' } }, text.hold) : null,
      ],
      fields: [purgeCodeField()],
      validate: codeProblem,
      phrase: PURGE_ALL_PHRASE,
      confirmLabel: 'Purge all',
      working: 'Purging…',
      submit: async (v) => {
        const out = await ctx.api.purgeAllTestRuns(PURGE_ALL_PHRASE, typedCode(v));
        const n = out.runs.length + out.resumed.length;
        notify(n === 1 ? 'Purge under way: 1 test.' : `Purge under way: ${formatCount(n)} tests.`);
      },
    });
    if (asked) await reread();
  };

  // ── The list ─────────────────────────────────────────────────────────────
  const purgeButton = (x: EndedTestRun) => {
    const action = purgeAction(x, role);
    if (!action) return null;
    const b = button(action === 'resume' ? 'Resume purge' : 'Purge', { kind: 'danger', testId: 'test-purge' });
    b.addEventListener('click', () => {
      void purgeTest(ctx, x, `${x.dropName} · ${parisDateTime(x.createdAt)}`, b).then(() => reread());
    });
    return b;
  };

  let key = '';
  const draw = () => {
    const k = JSON.stringify(runs);
    if (k === key) return;
    key = k;
    if (canPurgeAll(runs, role)) {
      if (!allBox.firstChild) {
        const all = button('Purge all ended tests', { kind: 'danger', testId: 'test-purge-all' });
        all.addEventListener('click', () => void purgeAll(all));
        mount(allBox, all);
      }
    } else mount(allBox);
    mount(
      listBox,
      table(
        [
          {
            label: 'Release',
            // Its page, its kind and who sent the test: one cell, so the status keeps its room on a laptop's width.
            cell: (x: EndedTestRun) =>
              h(
                'span',
                null,
                h('a', { class: 'idlink', attrs: { href: href(x.mode === 'LIVE' ? 'liveRelease' : 'drop', { dropId: x.dropId }) } }, x.dropName),
                h('span', { class: 'cell-sub', data: { testid: 'ended-test-by' } }, `${x.mode === 'LIVE' ? 'LIVE RELEASE' : 'DRAW'} · sent by ${x.createdBy}`),
              ),
          },
          { label: 'Ended', cell: (x: EndedTestRun) => h('span', { class: 'tests__when' }, parisDateTime(x.endedAt ?? x.createdAt)) },
          { label: 'Entrants', cell: (x: EndedTestRun) => formatCount(x.entrants), kind: ['num'] },
          { label: 'Checks', cell: (x: EndedTestRun) => checksLine(x), kind: ['num'] },
          { label: 'Status', cell: (x: EndedTestRun) => testRunStatusCell(x, role), kind: ['nowrap'] },
          {
            label: 'Actions',
            hiddenLabel: true,
            cell: (x: EndedTestRun) =>
              h(
                'span',
                { class: 'row-actions', data: { run: x.id } },
                x.report ? button('Report', { kind: 'ghost', testId: 'test-report', onClick: () => showReport(x) }) : null,
                purgeButton(x),
              ),
            kind: ['actions', 'wrap'],
          },
        ],
        runs,
        { caption: 'Ended tests', empty: ENDED_TESTS_TEXT.empty },
      ),
    );
  };
  draw();
  follow();
  return root;
}
