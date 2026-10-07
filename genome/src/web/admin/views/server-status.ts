/**
 * The server's status (plan TEST ENTRANTS), on the right of the Club's Drops tab, of a draw's page and of a LIVE
 * RELEASE's page: two columns on a wide screen; under 1 100 px it comes first, folded to its one line, which opens it.
 * Model in model/system-status.ts; route GET /api/admin/system/status (AUDITOR).
 *
 *  - Its rows, read again every 2 s while the tab is shown (ui/refresh.ts): the app's memory and CPU against their
 *    limits, the server's memory available, load and disk, the response time, the requests, the errors and refusals,
 *    the LIVE connections, the database, the event loop's delay and the heap; each with its state (amber, red) and a
 *    sparkline of the last 10 minutes. A red row puts THE SERVER IS STRAINED over them, folded or not: the moment to
 *    STOP a test.
 *  - On the Drops tab, the test RUNNING, whatever its release (GET /api/admin/test-runs/active): its release, its test
 *    entrants and status, and STOP (ADMIN, one press: its test entrants stop at once, nothing is cleaned).
 */
import { h, mount, s, type Child } from '../../shared/dom.js';
import { formatCount, humanize } from '../format.js';
import { svgPoints } from '../model/analytics.js';
import { can } from '../model/permissions.js';
import { sparkRuns, STATUS_REFRESH_MS, statusRows, statusSummary, strainBanner, STRAIN_TONES, type StatusRow } from '../model/system-status.js';
import { toneOf } from '../model/tone.js';
import { href } from '../router.js';
import type { ActiveTestRun, SystemStatus } from '../types.js';
import { button, statusMark } from '../ui/components.js';
import { startRefresh } from '../ui/refresh.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const W = 1000;
const H = 40;

/** A row's 10 minutes: its runs of read values, scaled to its limit or its busiest value; red in oxblood. */
function spark(r: StatusRow): SVGSVGElement {
  const runs = sparkRuns(r.series, r.ceiling);
  return s(
    'svg',
    { class: r.state === 'red' ? 'spark spark--critical' : r.state === 'unknown' ? 'spark spark--muted' : 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
    s('line', { class: 'spark__base', x1: 0, y1: H, x2: W, y2: H }),
    // A lone value is drawn as a short dash, so that it shows.
    ...runs.map((run) => s('polyline', { class: 'spark__line', points: svgPoints(run.length === 1 ? [run[0], { x: Math.min(1, run[0].x + 0.004), y: run[0].y }] : run, W, H) })),
  );
}

function rowItem(r: StatusRow): HTMLElement {
  return h(
    'li',
    { class: ['sstatus__row', `sstatus__row--${r.state}`], data: { row: r.id, state: r.state, testid: `server-row-${r.id}` } },
    h('span', { class: 'sstatus__label' }, statusMark(r.label, STRAIN_TONES[r.state])),
    h('span', { class: 'sstatus__value', data: { testid: 'server-value' } }, r.value),
    h('span', { class: 'sstatus__note' }, r.note),
    h('span', { class: 'sstatus__spark' }, spark(r)),
  );
}

/** The panel; `activeTest` on the Drops tab: the test running, whatever its release, with STOP. */
export function serverStatusPanel(ctx: ViewContext, opts: { activeTest?: boolean } = {}): HTMLElement {
  const note = h('span', { class: 'panel__note', data: { testid: 'server-summary' } }, 'READING…');
  const fold = h('div', { class: 'sstatus__fold', id: 'server-status-rows' }, h('p', { class: 'notice' }, 'Reading the server’s status…'));
  const toggle = button('Open', { kind: 'ghost', testId: 'server-toggle' });
  toggle.classList.add('sstatus__toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'server-status-rows');
  // Only a change is announced (its words are set only when they change); never hidden, so that a screen reader hears
  // its first words: empty, it takes no room (styles.css).
  const banner = h('p', { class: 'sstatus__banner', attrs: { 'aria-live': 'assertive' }, data: { testid: 'server-strained' } });
  const testBox = h('div', { class: 'sstatus__test', attrs: { hidden: true }, data: { testid: 'server-test' } });
  const panel = h(
    'section',
    { class: ['panel', 'sstatus'], id: 'server-status' },
    h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, 'Server'), note, h('div', { class: 'panel__tools' }, toggle)),
    h('div', { class: 'panel__body' }, banner, testBox, fold),
  );
  toggle.addEventListener('click', () => {
    const open = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    toggle.textContent = open ? 'Close' : 'Open';
    toggle.setAttribute('aria-expanded', String(open));
  });

  let read = false;
  let bannerText = '';
  const apply = (st: SystemStatus) => {
    read = true;
    const rows = statusRows(st);
    note.textContent = statusSummary(rows, st.latest?.at ?? st.now);
    const said = strainBanner(rows) ?? '';
    if (said !== bannerText) {
      bannerText = said;
      banner.textContent = said;
    }
    mount(fold, h('ul', { class: 'sstatus__rows', data: { testid: 'server-rows' } }, ...rows.map(rowItem)));
  };
  startRefresh({
    load: () => ctx.api.systemStatus({ background: true }),
    apply,
    failed: () => {
      note.textContent = read ? 'UNAVAILABLE: THE LAST READ IS SHOWN' : 'UNAVAILABLE';
      if (!read) mount(fold, h('p', { class: 'notice' }, 'The server’s status could not be read just now: it is asked again every 2 seconds.'));
    },
    everyMs: STATUS_REFRESH_MS,
    owner: panel,
  });

  if (opts.activeTest) {
    let key = '';
    const show = (run: ActiveTestRun | null) => {
      const k = JSON.stringify(run);
      if (k === key) return;
      key = k;
      testBox.hidden = run === null;
      if (!run) return mount(testBox);
      const link = href(run.mode === 'LIVE' ? 'liveRelease' : 'drop', { dropId: run.dropId });
      const stop = can(ctx.session.admin.role, 'runTestEntrants') && run.status === 'RUNNING' ? button('Stop', { kind: 'secondary', testId: 'server-test-stop' }) : null;
      stop?.addEventListener('click', async () => {
        stop.disabled = true;
        try {
          await ctx.api.stopTestRun(run.id);
          notify('Test stopped: its test entrants no longer act. END TEST cleans up, on its release’s page.');
          void tests.now();
        } catch (e) {
          notifyError(e);
          stop.disabled = false;
        }
      });
      const children: Child[] = [
        h('p', { class: 'sstatus__test-title' }, 'Test running'),
        h('a', { class: 'idlink', attrs: { href: link, 'data-testid': 'server-test-release' } }, run.dropName),
        h(
          'p',
          { class: 'sstatus__test-line' },
          statusMark(humanize(run.status), toneOf('testRun', run.status)),
          h('span', { class: 'cell-sub', data: { testid: 'server-test-entrants' } }, `${run.mode === 'LIVE' ? 'LIVE RELEASE' : 'DRAW'} · ${formatCount(run.entrants)} test ${run.entrants === 1 ? 'entrant' : 'entrants'}`),
        ),
      ];
      mount(testBox, ...children, stop ? h('div', { class: 'row-actions' }, stop) : null);
    };
    const tests = startRefresh({
      load: () => ctx.api.activeTestRun({ background: true }),
      apply: (r) => show(r.run),
      everyMs: STATUS_REFRESH_MS,
      owner: panel,
    });
  }
  return panel;
}

/** A page with the server's panel on its right (first, folded, on a narrow screen). */
export function withServerPanel(main: Child[], panel: HTMLElement): HTMLElement {
  return h('div', { class: 'with-server' }, h('div', { class: 'with-server__main' }, ...main), h('aside', { class: 'with-server__aside', attrs: { 'aria-label': 'Server status' } }, panel));
}
