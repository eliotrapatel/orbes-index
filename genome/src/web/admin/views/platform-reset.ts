/**
 * The Platform reset page, `#/settings/platform-reset` (lot PURGE, plan §B.5; the owner's answers of 27 Oct 2026,
 * answers 1 to 3 and Claude's points 3 and 4): the one button that empties the platform before the launch, for the
 * reset holder only (D12). Read from GET /api/admin/platform-reset (routes/admin/platform-reset.ts); anyone else, and
 * any role but ADMIN, meets the console's not-found state. Reached from the Settings page, whose header shows the link
 * to the holder only; no link of its own in the sidebar. Words in model/platform-reset.ts.
 *
 *  - The state: the holder (his email), READY, REFUSED NOW with the server's reason in Paris time (a window, a test
 *    running, a LIVE room open) or LOCKED with when and by whom; a refused reset's line.
 *  - After a reset: its line (entry 1's short hash, the old log's head), the post-check lines (OK or failing), the
 *    checklist, and what a test may have left as entry 1 listed it before the wipe.
 *  - Before one: what goes (the accounts neither test nor team in bold, their newest sign-ups in Paris, the releases
 *    open or announced, a LIVE room open), what stays, what a test may have made (the 9 Oct lists with the piece
 *    reference ranges), the segments that go and the signing keys.
 *  - RESET THE PLATFORM (danger): the dialog's body with the server's numbers for the date (H2), the count again, the
 *    current password, a fresh code, the phrase RESET PLATFORM; the count and the newest sign-up the page showed go
 *    with the press (G18); a refusal is said inside it. On the 202: the restart notice over the whole page, and the
 *    session asked every 3 s (GET /api/admin/auth/me, which never signs out) until the platform answers: every session
 *    ended, the sign-in; the session alive after the platform was down, the reset did not happen and the page is read
 *    again (its refused line says why).
 *  - LOCK RESET: its danger dialog (the current password, a fresh code, the phrase LOCK RESET), a refusal said inside
 *    it; once locked, no button, for good.
 * Built with shared/dom.ts h() as every console view: no markup from strings, no inline style or script.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import {
  captureBlocks,
  goesRows,
  LOCK_PHRASE,
  lastResetParts,
  mayAskHolder,
  passwordField,
  PLATFORM_RESET_TEXT as T,
  postCheckRow,
  postCheckVerdict,
  pressProblem,
  releaseLines,
  RESET_CHECKLIST,
  RESET_PHRASE,
  resetButtons,
  resetDialogText,
  resetPress,
  resetState,
  RESTART_POLL_MS,
  restartAnswer,
  signUpLines,
  staysRows,
  type CountRow,
  type LinePart,
  type ListBlock,
} from '../model/platform-reset.js';
import { parisDateTime } from '../model/links.js';
import { purgeCodeField } from '../model/test-purge.js';
import { href } from '../router.js';
import type { PlatformResetPage, PlatformResetPreview } from '../types.js';
import { button, defList, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { startRefresh } from '../ui/refresh.js';
import { notify } from '../ui/toast.js';
import { NotFoundPage, type ViewContext } from './context.js';

type HolderPage = Extract<PlatformResetPage, { holder: true }>;

export async function platformResetView(ctx: ViewContext): Promise<HTMLElement> {
  // The console's not-found state (main.ts) for anyone but the holder: the page never names itself to them.
  if (!mayAskHolder(ctx.session.admin.role)) throw new NotFoundPage();
  const page = await ctx.api.platformReset();
  if (!page.holder) throw new NotFoundPage();

  const root = h('div', { class: 'view view--platform-reset' });
  const buttons = resetButtons(page);
  const actions: Child[] = [linkButton('Settings', href('settings'), 'ghost')];
  if (buttons.lock) actions.push(button('Lock reset', { kind: 'secondary', testId: 'reset-lock', onClick: () => void lock() }));
  if (buttons.reset) actions.push(button('Reset the platform', { kind: 'danger', testId: 'reset-platform', onClick: () => void reset(page.preview!) }));

  // ── The presses ──────────────────────────────────────────────────────────
  const reset = async (preview: PlatformResetPreview) => {
    const text = resetDialogText(preview, page.refusal);
    const asked = await openDialog({
      title: T.resetDialogTitle,
      eyebrow: `Settings · ${T.title}`,
      danger: true,
      body: [
        ...text.lines.map((line) => h('p', { class: ['dialog__text', 'reset__text'], data: { testid: 'reset-line' } }, line)),
        h('p', { class: ['dialog__text', 'reset__text'], data: { testid: 'reset-collectors' } }, h('strong', null, text.collectors.strong), text.collectors.rest),
        text.hold ? h('p', { class: ['dialog__text', 'reset__text', 'critical-text'], data: { testid: 'reset-hold' } }, text.hold) : null,
      ],
      fields: [passwordField(), purgeCodeField()],
      validate: pressProblem,
      phrase: RESET_PHRASE,
      confirmLabel: 'Reset the platform',
      working: 'Resetting…',
      submit: async (v) => {
        await ctx.api.resetPlatform(resetPress(v, preview));
      },
    });
    if (asked) restarting();
  };

  const lock = async () => {
    const asked = await openDialog({
      title: T.lockDialogTitle,
      eyebrow: `Settings · ${T.title}`,
      danger: true,
      body: h('p', { class: ['dialog__text', 'reset__text'], data: { testid: 'lock-line' } }, T.lockBody),
      fields: [passwordField(), purgeCodeField()],
      validate: pressProblem,
      phrase: LOCK_PHRASE,
      confirmLabel: 'Lock reset',
      working: 'Locking…',
      submit: async (v) => {
        await ctx.api.lockPlatformReset(LOCK_PHRASE, v.password ?? '', (v.totp ?? '').replace(/\s+/g, ''));
      },
    });
    if (asked) {
      notify(T.locked);
      ctx.reload();
    }
  };

  /** After the 202: the notice over the whole page, and the session asked every 3 s until the platform answers. */
  const restarting = () => {
    const notice = h(
      'div',
      { class: 'reset-restart', attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' }, data: { testid: 'reset-restarting' } },
      h(
        'div',
        { class: 'reset-restart__box' },
        h('span', { class: 'loading__orbit', attrs: { 'aria-hidden': 'true' } }),
        h('p', { class: 'reset-restart__title' }, T.restartTitle),
        h('p', { class: 'reset-restart__text' }, T.restartText),
        h('p', { class: 'reset-restart__note' }, T.restartWait),
      ),
    );
    mount(root, notice);
    notice.focus();
    let seenDown = false;
    const watch = startRefresh({
      load: async () => {
        try {
          await ctx.api.me();
          return { status: 200 };
        } catch (e) {
          return { status: e instanceof ApiError ? e.status : 0 };
        }
      },
      apply: (answer) => {
        const next = restartAnswer(answer, seenDown);
        if (answer.status !== 200 && answer.status !== 401) seenDown = true;
        if (next === 'wait') return;
        watch.stop();
        // Every session ended with the reset: the console's own ended-session path, to the sign-in.
        if (next === 'signIn') ctx.api.onUnauthorized?.();
        else ctx.reload();
      },
      everyMs: RESTART_POLL_MS,
      immediate: false,
      owner: notice,
    });
  };

  mount(
    root,
    pageHeader({ eyebrow: T.eyebrow, title: T.title, lead: T.lead, actions }),
    stateSection(page),
    page.lastReset ? lastResetSection(page.lastReset) : null,
    ...(page.preview ? previewSections(page.preview) : []),
  );
  return root;
}

// ── The sections ───────────────────────────────────────────────────────────

function stateSection(page: HolderPage): HTMLElement {
  const st = resetState(page);
  return section(
    'Reset',
    defList([
      { label: 'Holder', value: h('span', { class: 'reset__email', data: { testid: 'reset-holder' } }, page.email) },
      {
        label: 'State',
        value: h(
          'span',
          { data: { testid: 'reset-state' } },
          statusMark(st.label, st.tone),
          h('span', { class: ['reset__state-line', st.label === 'REFUSED NOW' ? 'critical-text' : null], data: { testid: 'reset-state-line' } }, st.line),
        ),
      },
      { label: 'Last reset', value: h('span', { data: { testid: 'reset-last-when' } }, page.lastReset ? `${parisDateTime(page.lastReset.at)}${page.lastReset.by ? ` by ${page.lastReset.by}` : ''}` : T.noReset) },
      ...(page.lastFailure ? [{ label: 'Refused reset', value: h('span', { class: 'critical-text', data: { testid: 'reset-failure' } }, page.lastFailure.message) }] : []),
    ]),
    { id: 'reset-state' },
  );
}

function lineOf(parts: readonly LinePart[]): Child[] {
  return parts.map((p) => (p.mono ? h('span', { class: 'mono', attrs: { title: p.text } }, p.text) : p.text));
}

function lastResetSection(r: NonNullable<HolderPage['lastReset']>): HTMLElement {
  const rows = r.postCheck.map((l) => ({ ...postCheckRow(l), key: l.key }));
  const checklist = h(
    'ol',
    { class: 'reset__checklist', data: { testid: 'reset-checklist' } },
    ...RESET_CHECKLIST.map((i) =>
      h('li', { data: { item: i.key } }, h('span', null, i.before, i.link ? h('a', { attrs: { href: href(i.link.route) } }, i.link.label) : null, i.after ?? null)),
    ),
  );
  return section(
    'Last reset',
    [
      h('p', { class: 'reset__last', data: { testid: 'reset-last' } }, ...lineOf(lastResetParts(r))),
      h('h3', { class: 'panel__subtitle' }, 'After the reset'),
      h('p', { class: ['notice', rows.some((x) => x.failing) ? 'critical-text' : null], data: { testid: 'reset-check-verdict' } }, postCheckVerdict(r.postCheck)),
      // A table, not label rows: a line's label carries figures (entry 1), which the display face never sets.
      h(
        'div',
        { data: { testid: 'reset-checks' } },
        table(
          [
            { label: 'Check', cell: (x: (typeof rows)[number]) => h('span', { data: { testid: 'reset-check', check: x.key, ok: x.failing ? 'no' : 'yes' } }, x.label) },
            { label: 'Result', cell: (x: (typeof rows)[number]) => statusMark(x.mark, x.tone), kind: ['nowrap'] },
            {
              label: 'Found',
              cell: (x: (typeof rows)[number]) =>
                h(
                  'span',
                  { class: [x.failing ? 'critical-text' : null, x.mono ? 'reset__ids' : null], data: { testid: 'reset-check-value' } },
                  ...(x.mono ? x.value.split(', ').flatMap((id, i): Child[] => (i === 0 ? [mono(id)] : [', ', mono(id)])) : [x.value]),
                ),
              kind: ['wide'],
            },
          ],
          rows,
          { caption: 'After the reset' },
        ),
      ),
      h('h3', { class: 'panel__subtitle' }, 'Checklist'),
      checklist,
      h('h3', { class: 'panel__subtitle' }, 'What a test may have left'),
      h('p', { class: 'notice' }, T.capturedLead),
      r.capture ? blocksOf(captureBlocks(r.capture, 'before'), 'captured') : h('p', { class: 'notice' }, 'Entry 1 holds no list.'),
    ],
    { id: 'reset-last' },
  );
}

function countList(rows: CountRow[], testid: string): HTMLElement {
  return defList(
    rows.map((r) => ({
      label: r.label,
      value: h('span', { data: { testid: `${testid}-${r.key}` } }, ...r.value.map((v) => (v.strong ? h('strong', null, v.text) : v.text))),
    })),
  );
}

function linesOf(lines: string[], testid: string): HTMLElement {
  return h('ul', { class: 'reset__lines', data: { testid } }, ...lines.map((l) => h('li', null, l)));
}

function previewSections(p: PlatformResetPreview): HTMLElement[] {
  const signUps = signUpLines(p);
  const releases = releaseLines(p);
  const blocks = captureBlocks(p.lists, 'now');
  const made = blocks.filter((b) => b.key !== 'segmentsGone' && b.key !== 'keys');
  return [
    section(
      'What goes',
      [
        countList(goesRows(p), 'goes'),
        p.liveOpen ? h('p', { class: ['notice', 'critical-text'], data: { testid: 'reset-live-open' } }, p.liveOpen.message) : null,
        signUps.length ? h('h3', { class: 'panel__subtitle' }, signUps.length === p.collectors.count ? 'Their sign-ups, newest first' : 'Their newest sign-ups') : null,
        signUps.length ? linesOf(signUps, 'reset-sign-ups') : null,
        releases.length ? h('h3', { class: 'panel__subtitle' }, 'Releases open or announced') : null,
        releases.length ? linesOf(releases, 'reset-releases') : null,
      ],
      { id: 'reset-goes' },
    ),
    section('What stays', countList(staysRows(p), 'stays'), { id: 'reset-stays' }),
    section('What stays that a test may have made', [h('p', { class: 'notice' }, T.previewLead), blocksOf(made, 'made')], { id: 'reset-made' }),
    section('Segments that go', blocksOf(blocks.filter((b) => b.key === 'segmentsGone'), 'segments', false), { id: 'reset-segments' }),
    section('Signing keys', blocksOf(blocks.filter((b) => b.key === 'keys'), 'keys', false), { id: 'reset-keys' }),
  ];
}

/** Each list under its title (none when `titled` is false: the section names it); an empty one says None. */
function blocksOf(blocks: ListBlock[], testid: string, titled = true): HTMLElement {
  return h(
    'div',
    { class: 'reset__lists', data: { testid: `reset-${testid}` } },
    ...blocks.flatMap((b) => [
      titled ? h('h3', { class: 'panel__subtitle' }, b.title) : null,
      b.rows.length === 0
        ? h('p', { class: 'notice', data: { testid: `reset-list-${b.key}` } }, T.none)
        : h(
            'div',
            { data: { testid: `reset-list-${b.key}` } },
            table(
              b.head.map((label, c) => ({
                label,
                cell: (row: { cells: string[]; flag: boolean }) =>
                  b.key === 'skus' && c === 4 && row.flag
                    ? h('span', null, row.cells[c]!, ' ', statusMark('CHECK', 'alert'))
                    : b.mono.includes(c)
                      ? mono(row.cells[c]!)
                      : row.cells[c]!,
                // An identifier or a day on one line: a laptop's width wraps the words around them instead.
                kind: b.mono.includes(c) || label === 'Made' ? ['nowrap'] : undefined,
              })),
              b.rows.map((cells, i) => ({ cells, flag: b.flag?.[i] === true })),
              { caption: b.title },
            ),
          ),
    ]),
  );
}
