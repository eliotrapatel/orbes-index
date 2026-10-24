/**
 * A LIVE RELEASE in the console, `#/club/live/:dropId`, reached from the Club page's Drops tab (no link of its own in
 * the sidebar). Model in model/live.ts; routes in server/routes/admin/live.ts.
 *
 *  - The live board, once published: the release's state (paused, ending, over), its figures (in the room, in line,
 *    turns, secured, confirmed, pieces left, missed turns, ended holds), the latest host message, each size (its stock,
 *    the pieces left, held and sold, its people, its interest; ADD PIECES, with what the quantity line promised), and the
 *    controls: PAUSE / RESUME, EXTEND, MESSAGE (OPERATOR), END NOW (ADMIN, a phrase to type). It follows the console's
 *    stream (`console` events, http/live-stream.ts) and, should the stream be refused or lost, the board every 5 s; it
 *    stops when the console moves elsewhere (`disposeLiveView`, main.ts). A board in another state than the page was
 *    drawn for (the announcement or T0 passed, a pause, the end) has the page read again, its controls with it.
 *  - The pace (ONE QUEUE, lot Q1 §4), on the release's board (never an after-room's): X people per batch every Y
 *    minutes, its figures (D11, add only: in the queue, admitted all ways, the batches, the next batch in Paris time,
 *    PAUSED while held; the turns given by the pace, beyond the pieces, the hold's end in Paris time) and its controls,
 *    drawn with each board: SET PACE until the end, PAUSE PACE / RESUME PACE and NEXT BATCH NOW from T0, SHORTEN THE
 *    HOLD and END THE HOLD NOW from the announcement while the hold lasts (OPERATOR); the close guard's warning (D10,
 *    advice only: EXTEND, SET PACE, NEXT BATCH NOW); nothing takes a pace away. The line says each entry's turn (its
 *    batch and when), its queue place and estimated turn; the filters add those waiting in the queue and those beyond
 *    the pieces. The times part of the settings holds the pace and the hold, both required (D1).
 *  - The entries: the line itself, live (its open entries by place: the account, its email masked for an AUDITOR, its
 *    tier, size, pieces, status and deadline, the gesture's length), or every entry of one status, page by page; LET IN
 *    a QUEUED one and FREE a hold (OPERATOR), REMOVE an open one (ADMIN).
 *  - Client Services: each confirmed reservation is an order per piece, followed on the Orders board (plan LIVE
 *    RELEASE+, views/orders.ts), which replaces the LIVE plan's list: a link narrowed to the release.
 *  - The intelligence (views/live-intelligence.ts), each reading with how it is read: the live alerts and the live
 *    sell-out forecast on the live board (its stream keeps them current); the readings of the release's stage under the
 *    board: the release planner and the audience forecast before the announcement, the forecast and the demand radar
 *    until T0, the bot radar from the room's opening (REMOVE in one tap, ADMIN), the release report (and its CSV) and the
 *    collector insights once it has ended, and the release comparison.
 *  - The settings, part by part, each edited in its dialog until the announcement (the release, its sizes, its access —
 *    a tier, owners of models or a collection, the releases taken part in, a segment, AND or OR: plan LIVE RELEASE+,
 *    choices 4 and 27 —, its times, its turns and holds, its add-ons, its after-room, its surprise: choice 3), the silhouette (a photograph) and the boutique board's
 *    link (issued, shown once, revoked); PUBLISH (with or without a post of the circle, added or withdrawn until the
 *    announcement) and CANCEL (before the room opens, a phrase to type). Each request is audited by the server; then the
 *    page is read again.
 *  - Plan LIVE RELEASE+, step S8: the question after (choice 11: on by default, its words and 2 to 6 answers; once the
 *    release has ended, who is asked where, how many answered, each answer counted); the release's stock location
 *    (choice 16, with its sizes); the best time to open (choice 10, views/best-time.ts) while its settings change; PUBLISH
 *    first reads the feasibility check (choice 12) and shows its warning per size, never refusing.
 *  - The after-room (plan LIVE RELEASE+, choice 2): on the release's page, its settings (on or off, its model, price,
 *    sizes and stock, add-ons, delay and length) and, once the sell-out has opened it, when its door opened and closes,
 *    its guests and its entries, with a link to its own page: the same live board, entries, controls and Orders link,
 *    its readings (the bot radar, then its report and collectors), never a setting, a publication, a cancellation, a
 *    silhouette or a board link of its own.
 *  - Test entrants (plan TEST ENTRANTS, views/test-entrants.ts): SEND TEST ENTRANTS once the room is open (ADMIN), the
 *    test not ended, PAST TESTS, on the release's own page (not its after-room's); a test entrant's account carries TEST
 *    in the line, the entries and the bot radar. On the right, the server's status (views/server-status.ts).
 *  - Two tabs under the header of a release (plan MACRO M1 §2.2), never of an after-room: RELEASE, all of the above,
 *    and CAMPAIGN (`?tab=campaign`, views/campaign.ts): its links made in one click, its countdown image, its readout;
 *    no board is read nor followed there.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { formatCount, formatDateTime, groupChars, humanize } from '../format.js';
import { LIVE_ALERT_LABELS } from '../model/live-intelligence.js';
import {
  AFTER_ROOM_SKIPS,
  afterRoomStateLabel,
  afterRoomTiming,
  closeGuardLine,
  combineLine,
  defaultQuantityLine,
  formatMoney,
  hasBoard,
  holdLine,
  holdShortenProblem,
  LIVE_HOLD_LABEL,
  LIVE_LIMITS,
  LIVE_MESSAGE_HINT,
  LIVE_TIER_OPTIONS,
  liveActions,
  liveBoardFigures,
  liveEntryActions,
  liveEntryAdmission,
  liveEntryDeadline,
  liveEntryQueue,
  liveLead,
  livePaceActions,
  livePaceFigures,
  livePageKey,
  livePartChange,
  livePartProblem,
  livePartValues,
  livePhrase,
  liveStateLabel,
  locationOptions,
  paceCloseGuard,
  paceHint,
  paceLine,
  paceProblem,
  parisClock,
  parseSetSizes,
  parseSizes,
  liveSizesField,
  releasePieceNames,
  setsOnSale,
  priorityLine,
  questionLine,
  questionStateLine,
  questionTallyRows,
  sizesLine,
  surpriseLine,
  tierLabel,
  windowLine,
  type LivePart,
} from '../model/live.js';
import { livePublicAt, releaseTab } from '../model/campaign.js';
import { guaranteedText, stockWarning } from '../model/guarantees.js';
import { liveTestStart } from '../model/test-entrants.js';
import { toneOf } from '../model/tone.js';
import { OFFER_TEXT, setOptions, entrySizesText, perPersonText, pieceName, pieceSizeLabel, pieceTotals, setsOnSaleLines } from '../model/sets.js';
import { modelChoice } from '../model/variants.js';
import { href } from '../router.js';
import { LIVE_CURRENCIES, LIVE_ENTRY_STATUSES, type LiveBoard, type LiveEntry, type LiveEntryStatus, type LiveFeasibility, type LiveRelease, type Model, type SetView } from '../types.js';
import { barList, button, copyButton, defList, field, filterBar, kpi, linkButton, mono, pageHeader, pager, section, select, statusMark, table, type DefRow } from '../ui/components.js';
import { figureLabel, openDialog, type DialogField } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { photoDialog, photoThumb } from '../ui/photo.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { bestTimePanel } from './best-time.js';
import { campaignTab, releaseTabs } from './campaign.js';
import { guaranteesSection } from './drop.js';
import { loadLiveIntelligence, liveIntelligenceSections, liveSignals, sizeSellOut } from './live-intelligence.js';
import { serverStatusPanel, withServerPanel } from './server-status.js';
import { feasibilityBlock, stockBlock } from './stock-check.js';
import { loadTestReads, testEntrantsSection, testTag } from './test-entrants.js';

/** The board read again this often while the stream is refused or lost. */
export const LIVE_POLL_MS = 5000;

/** The open page's stream and timer, so main.ts stops them when the console moves elsewhere or signs out. */
let current: LiveFollower | null = null;
/** Bumped by every disposal: a page whose data arrive after one was never shown. */
let screens = 0;

/** Stop the live board's stream and timer, if a release's page is open. */
export function disposeLiveView(): void {
  screens++;
  current?.stop();
  current = null;
}

/**
 * Follows the live board: the console's stream while it runs; the board every LIVE_POLL_MS once it is refused or lost
 * (and once, at once, when it ends: the release over, its last board).
 */
class LiveFollower {
  private source: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: ViewContext,
    private readonly id: string,
    private readonly apply: (board: LiveBoard, via: 'stream' | 'poll') => void,
  ) {}

  start(board: LiveBoard): void {
    if (board.over) return;
    if (typeof EventSource !== 'function') return this.poll(0);
    const es = new EventSource(this.ctx.api.liveStreamUrl(this.id));
    this.source = es;
    es.addEventListener('console', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as { board: LiveBoard };
        this.apply(data.board, 'stream');
      } catch {
        // An event this page cannot read: the next one, or the board read again, says the same.
      }
    });
    es.addEventListener('error', () => {
      if (es.readyState !== EventSource.CLOSED || this.stopped) return;
      this.source = null;
      this.poll(0);
    });
  }

  stop(): void {
    this.stopped = true;
    this.source?.close();
    this.source = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private poll(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        const { board } = await this.ctx.api.liveBoard(this.id, { background: true });
        if (this.stopped) return;
        this.apply(board, 'poll');
        if (board.over) return;
      } catch {
        // A failed read waits for the next one.
      }
      this.poll(LIVE_POLL_MS);
    }, delay);
  }
}

const tierOf = (t: number) => (t === 0 ? 'None' : tierLabel(t));

export async function liveReleaseView(ctx: ViewContext): Promise<HTMLElement> {
  const asked = screens;
  const id = ctx.route.params.dropId ?? '';
  const status = (['OPEN', 'BEYOND', ...LIVE_ENTRY_STATUSES] as const).find((s) => s === ctx.route.query.status) as LiveEntryStatus | 'OPEN' | 'BEYOND' | undefined;
  const entriesPage = Math.max(1, Number(ctx.route.query.page) || 1);
  if (releaseTab(ctx.route.query) === 'campaign') {
    const shown = await liveCampaignView(ctx, id);
    if (shown) return shown;
  }
  const [r, models, collections, segments, locations] = await Promise.all([ctx.api.liveRelease(id), ctx.api.models(), ctx.api.collections(), ctx.api.segmentNames(), ctx.api.locations().catch(() => ({ items: [] }))]);
  const published = hasBoard(r.phase);
  // The best time to open while T0 may still move (its settings change); the after-room has none of its own.
  const timing = r.editable && !r.afterRoomOf;
  const [boardRead, entries, intelligence, bestTime, stockCheck, guarantees, tests] = await Promise.all([
    published ? ctx.api.liveBoard(id) : Promise.resolve(null),
    published && status ? ctx.api.liveEntries(id, { status, page: entriesPage, pageSize: 50 }) : Promise.resolve(null),
    loadLiveIntelligence(ctx.api, r),
    timing ? ctx.api.liveBestTime(id).catch(() => 'failed' as const) : Promise.resolve(null),
    // Plan NEXT LOT §3.5.4.3: the stock under its sizes, from its creation on.
    ctx.api.liveFeasibility(id).catch(() => 'failed' as const),
    // IN-01: the release's guarantees (an after-room has none).
    r.afterRoomOf ? Promise.resolve({ items: [] }) : ctx.api.releaseGuarantees(id),
    // An after-room is tested through its release.
    r.afterRoomOf ? Promise.resolve(null) : loadTestReads(ctx, id),
  ]);
  // The console moved on while the release was read: this page is stale, and starts nothing. Every read is above this
  // line, so the follower below starts only for the page on screen.
  if (asked !== screens) return h('div', { class: 'view view--live' });

  const role = ctx.session.admin.role;
  const acts = liveActions(r, role);
  // An after-room's own page: the release it follows sets it.
  const parent = r.afterRoomOf;
  const eyebrow = `${parent ? 'AFTER-ROOM' : 'LIVE RELEASE'} · ${r.id.slice(0, 8).toUpperCase()}`;
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };

  // ── The live board ───────────────────────────────────────────────────────
  let board: LiveBoard | null = boardRead?.board ?? null;
  // Only the state and its marks are announced, and only when they change: the time of the last update is not.
  const stateMarks = h('span', { class: 'live__marks', attrs: { 'aria-live': 'polite' } });
  const updated = h('span', { class: 'live__updated', data: { testid: 'live-updated' } });
  const stateLine = h('p', { class: 'live__state', data: { testid: 'live-board-state' } }, stateMarks, updated);
  let stateKey = '';
  // The controls, the marks of the publication and the lead are drawn for the state the release was read in: once the
  // board says another (T0 passed, a pause, the end, the last hold settled), the page is read again, its scroll kept.
  const pageKey = livePageKey({ phase: r.phase, paused: r.pausedAt !== null && !r.over, ended: r.endedAt !== null, over: r.over });
  let drawn = false;
  let stale = false;
  const figures = h('div', { class: ['kpis', 'live__figures'] });
  const messageLine = h('p', { class: 'live__message', data: { testid: 'live-message' } });
  const sizesBox = h('div', { class: 'live__sizes' });
  // The live alerts and the sell-out forecast (live-intelligence.ts), drawn with each board; the alerts' names are
  // announced once, when they change, not their running figures.
  const alertsBox = h('div', { class: 'live__alerts-box' });
  const alertsSaid = h('span', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
  let alertsKey = '';
  const sellOutBox = h('div', { class: 'live__sellout-box' });
  const lineBox = h('div', { class: 'live__line' });
  // W4: the pace's line, figures and controls, drawn with each board; an after-room has none.
  const paceBox = h('div', { class: 'live__pace', data: { testid: 'live-pace' } });
  // Its state is announced once, when it changes (set, paused, resumed), not its running figures.
  const paceSaid = h('span', { class: 'visually-hidden', attrs: { 'aria-live': 'polite' } });

  // Macro scope K44 T1: a set's release names each size by its piece (« Add pieces · AURA · 52 »).
  const sizeWords = (z: { label: string; piece?: number | null }) => pieceSizeLabel(r.set, z);
  const addPieces = (size: { id: string; label: string; stock: number; piece?: number }) =>
    void openDialog({
      title: `Add pieces · ${sizeWords(size)}`,
      eyebrow,
      body: [
        // ONE QUEUE (D5, D11): offered at the next batches on a paced release; at once in an after-room (no batches).
        h(
          'p',
          { class: 'dialog__text', data: { testid: 'live-add-pieces-text' } },
          `The size holds ${formatCount(size.stock)} ${size.stock === 1 ? 'piece' : 'pieces'}. ${parent ? 'The pieces added go at once to whoever waits for them.' : 'The pieces added are offered at the next batches, at the release’s pace.'}`,
        ),
        // A set's release sells as many sets as its scarcest piece: a size raised alone may add no set.
        r.set ? h('p', { class: 'dialog__text', data: { testid: 'live-add-pieces-set' } }, 'A set’s release sells as many sets as its scarcest piece: the sets on sale rise only when each piece can make them.') : null,
        h('p', { class: 'dialog__text', data: { testid: 'live-quantity-promise' } }, `The announcement says « ${r.quantityLine} ». Every addition is recorded in the audit log and reported: adding pieces after a fixed number was announced contradicts it.`),
      ],
      fields: [{ name: 'pieces', label: 'Pieces to add', required: true, maxlength: 4, hint: `${LIVE_LIMITS.addPieces.min} to ${formatCount(LIVE_LIMITS.addPieces.max)}.` }],
      validate: (v) => {
        const n = /^\s*\d{1,4}\s*$/.test(v.pieces) ? Number(v.pieces) : 0;
        return n >= LIVE_LIMITS.addPieces.min && n <= LIVE_LIMITS.addPieces.max ? null : `Add ${LIVE_LIMITS.addPieces.min} to ${formatCount(LIVE_LIMITS.addPieces.max)} pieces.`;
      },
      confirmLabel: 'Add pieces',
      submit: async (v) => {
        await ctx.api.addLivePieces(r.id, size.id, Number(v.pieces));
      },
    }).then(done('Pieces added.'));

  const entryAction = (e: LiveEntry, action: 'letIn' | 'free' | 'remove') =>
    void openDialog({
      title: action === 'letIn' ? 'Let in now' : action === 'free' ? 'Free the hold' : 'Remove from the release',
      eyebrow: `${e.email} · ${e.position === null ? 'IN THE ROOM' : `PLACE ${e.position}`}`,
      danger: action === 'remove',
      body: h(
        'p',
        { class: 'dialog__text' },
        action === 'letIn'
          ? e.sizes?.length
            ? `This person takes their turn now, before those ahead of them in their sizes (${entrySizesText(e.sizes)}), within each one’s free pieces.`
            : `This person takes their turn now, before those ahead of them in size ${e.size.label}, within its free pieces.`
          : action === 'free'
            ? parent
              ? 'The piece held returns: the next in line for its size gets a turn at once. Its add-ons are dropped.'
              : 'The piece held returns and is offered at the next batch. Its add-ons are dropped.'
            : // The owner's choice (24 Oct): REMOVE keeps production's words on every release.
              'The entry leaves the release for good: its place, or the piece it holds, goes to the next in line. Its screen says it was removed.',
      ),
      confirmLabel: action === 'letIn' ? 'Let in' : action === 'free' ? 'Free the hold' : 'Remove',
      submit: async () => {
        if (action === 'letIn') await ctx.api.letInLiveEntry(r.id, e.id);
        else if (action === 'free') await ctx.api.freeLiveHold(r.id, e.id);
        else await ctx.api.removeLiveEntry(r.id, e.id);
      },
    }).then((v) => {
      if (!v) return;
      notify(action === 'letIn' ? 'Let in: their turn has begun.' : action === 'free' ? 'Hold freed.' : 'Entry removed.');
      void refreshBoard();
    });

  const entryColumns = (b: LiveBoard | null) => [
    { label: 'Place', cell: (e: LiveEntry) => (e.position === null ? h('span', { class: 'soft' }, '—') : formatCount(e.position)), kind: ['num' as const] },
    {
      label: 'Account',
      cell: (e: LiveEntry) => h('span', null, h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: e.accountId }), 'data-testid': 'live-entry-account' } }, e.email), testTag(e.email)),
      kind: ['wide' as const],
    },
    { label: 'Tier', cell: (e: LiveEntry) => tierOf(e.tier), kind: ['nowrap' as const] },
    // Macro scope K44 T1: a set's entry, its size for each piece (« 52 · M · 45 CM »), and its sets (T4).
    { label: r.set ? 'Sizes' : 'Size', cell: (e: LiveEntry) => h('span', { class: 'live__size', data: { testid: 'live-entry-size' } }, e.sizes?.length ? entrySizesText(e.sizes) : e.size.label), kind: ['nowrap' as const] },
    { label: r.set ? 'Sets' : 'Pieces', cell: (e: LiveEntry) => formatCount(e.quantity), kind: ['num' as const] },
    {
      label: 'Status',
      cell: (e: LiveEntry) => {
        const deadline = liveEntryDeadline(e);
        const q = liveEntryQueue(e);
        return h(
          'span',
          { data: { testid: 'live-entry-status' } },
          statusMark(humanize(e.status), toneOf('liveEntry', e.status)),
          // IN-01: a place guaranteed by the house, first in line in its size.
          e.guaranteed ? h('span', { class: 'row-marks' }, statusMark('GUARANTEED', 'outline')) : null,
          e.letIn ? h('span', { class: 'cell-sub' }, 'Let in by the console') : null,
          deadline ? h('span', { class: 'cell-sub' }, deadline) : null,
          // ONE QUEUE (D11): while it waits in the queue, its place in its size (an after-room's too) from the queue's
          // snapshot and its estimated turn in Paris time, under its status as its deadline is under a turn's, so the
          // line keeps every column in the page at 1440 px ("add only").
          q.place === '—' ? null : h('span', { class: ['cell-sub', 'live__nowrap'] }, 'Queue place ', h('span', { data: { testid: 'live-entry-queue-place' } }, q.place)),
          q.turn === '—' ? null : h('span', { class: 'cell-sub' }, 'Estimated turn ', h('span', { class: 'live__nowrap', data: { testid: 'live-entry-estimated' } }, q.turn)),
        );
      },
    },
    // On a paced release, each entry's turn: the batch that gave it and when, or WAITING in the queue.
    ...((b ?? board)?.pace || r.pace
      ? [
          {
            label: 'Admitted',
            cell: (e: LiveEntry) => {
              const a = liveEntryAdmission(e);
              return h('span', { data: { testid: 'live-entry-admitted' } }, a.text === '—' ? h('span', { class: 'soft' }, '—') : a.text, a.at ? h('span', { class: 'cell-sub' }, a.at) : null);
            },
            kind: ['nowrap' as const],
          },
        ]
      : []),
    { label: 'Hold', cell: (e: LiveEntry) => (e.gestureMs === null ? h('span', { class: 'soft' }, '—') : `${(e.gestureMs / 1000).toFixed(2)} s`), kind: ['num' as const] },
    {
      label: '',
      cell: (e: LiveEntry) => {
        const a = b ? liveEntryActions(e, b, role) : { letIn: false, free: false, remove: false };
        return h(
          'span',
          { class: 'row-actions' },
          a.letIn ? button('Let in', { kind: 'ghost', testId: 'live-let-in', onClick: () => entryAction(e, 'letIn') }) : null,
          a.free ? button('Free', { kind: 'ghost', testId: 'live-free', onClick: () => entryAction(e, 'free') }) : null,
          a.remove ? button('Remove', { kind: 'ghost', testId: 'live-remove', onClick: () => entryAction(e, 'remove') }) : null,
        );
      },
      // Two of them (LET IN and REMOVE on a place in the queue) to a second line rather than past the page's width.
      kind: ['actions' as const, 'wrap' as const],
    },
  ];

  const render = (b: LiveBoard, via: 'stream' | 'poll' | 'read') => {
    if (stale) return;
    if (drawn && livePageKey({ phase: b.phase, paused: b.paused, ended: b.endedAt !== null, over: b.over }) !== pageKey) {
      stale = true;
      disposeLiveView();
      ctx.reload();
      return;
    }
    drawn = true;
    board = b;
    const label = liveStateLabel({ phase: b.phase, endedReason: b.endedReason }, parent !== null);
    const finishing = b.phase === 'ENDED' && !b.over;
    const key = JSON.stringify([label, b.phase, b.paused, finishing]);
    if (key !== stateKey) {
      stateKey = key;
      mount(
        stateMarks,
        statusMark(label, toneOf('livePhase', b.phase)),
        b.paused ? statusMark('PAUSED', 'alert') : null,
        finishing ? h('span', { class: 'live__note' }, 'Turns and holds finish at their deadlines') : null,
      );
    }
    updated.textContent = `${via === 'stream' ? 'LIVE' : 'READ'} · ${formatDateTime(ctx.now(), { seconds: true })}`;
    mount(figures, ...liveBoardFigures(b).map((f) => {
      const el = kpi(f.label, f.value, f.note);
      el.setAttribute('data-testid', f.testId);
      return el;
    }));
    const signals = liveSignals(b);
    mount(alertsBox, signals.alerts);
    mount(sellOutBox, signals.sellOut);
    const said = b.alerts.map((a) => `${LIVE_ALERT_LABELS[a.kind]}${a.size ? ` · ${sizeWords(a.size)}` : ''}`).join(', ');
    if (said !== alertsKey) {
      alertsKey = said;
      alertsSaid.textContent = said ? `${said}.` : '';
    }
    if (!parent) drawPace(b);
    mount(messageLine, ...(b.message ? [h('span', { class: 'live__message-label' }, 'Host message'), h('span', { class: 'live__message-text' }, `« ${b.message.text} »`), h('span', { class: 'cell-sub' }, formatDateTime(b.message.at, { seconds: true }))] : []));
    messageLine.hidden = !b.message;
    mount(
      sizesBox,
      // Macro scope K44 T1: a set's release, its sets on sale and each piece's pieces, then its sizes named by their piece.
      b.pieces?.length
        ? h(
            'p',
            { class: 'live__sets', data: { testid: 'live-sets-on-sale' } },
            h('span', { class: 'live__sets-figure' }, `Sets on sale: ${formatCount(b.quantity)}`),
            h('span', { class: 'cell-sub' }, `${b.pieces.map((p) => `${pieceName(r.set, p.piece)} ${formatCount(p.stock)}`).join(' · ')} · ${perPersonText(r.perAccount, true)}`),
          )
        : null,
      table(
        [
          { label: 'Size', cell: (s) => h('span', { class: 'live__size', data: { testid: 'live-board-size' } }, sizeWords(s)), kind: ['nowrap'] },
          { label: 'Stock', cell: (s) => formatCount(s.stock), kind: ['num'] },
          { label: 'Left', cell: (s) => formatCount(s.left), kind: ['num'] },
          { label: 'Held', cell: (s) => formatCount(s.held), kind: ['num'] },
          { label: 'Sold', cell: (s) => formatCount(s.sold), kind: ['num'] },
          { label: 'Room', cell: (s) => formatCount(s.waiting), kind: ['num'] },
          { label: 'Line', cell: (s) => formatCount(s.line), kind: ['num'] },
          // ONE QUEUE (D11): those in the queue past the size's pieces, on a paced release.
          // Its header on two lines (as 'Ended holds'), in the table's tighter columns, so Missed, Ended holds and Interest
          // stay in the page at 1440 px ("add only").
          ...(b.pace ? [{ label: 'Beyond the pieces', cell: (s: LiveBoard['sizes'][number]) => h('span', { data: { testid: 'live-size-beyond' } }, formatCount(s.beyond ?? 0)), kind: ['num' as const, 'wrap' as const] }] : []),
          { label: 'Turns', cell: (s) => formatCount(s.turns), kind: ['num'] },
          { label: 'Secured', cell: (s) => formatCount(s.secured), kind: ['num'] },
          { label: 'Confirmed', cell: (s) => formatCount(s.confirmed), kind: ['num'] },
          { label: 'Missed', cell: (s) => formatCount(s.missed), kind: ['num'] },
          { label: 'Ended holds', cell: (s) => formatCount(s.expired), kind: ['num', 'wrap'] },
          { label: 'Interest', cell: (s) => formatCount(s.interest), kind: ['num'] },
          ...(b.sellOut ? [{ label: 'Forecast', cell: (s: LiveBoard['sizes'][number]) => h('span', { data: { testid: 'live-size-sellout' } }, sizeSellOut(b, s.id)) }] : []),
          {
            label: '',
            cell: (s) => (acts.addPieces && !b.endedAt ? button('Add pieces', { kind: 'ghost', testId: 'live-add-pieces', onClick: () => addPieces(s) }) : null),
            kind: ['actions'],
          },
        ],
        b.sizes,
        { caption: 'Sizes' },
      ),
    );
    if (!status) {
      mount(
        lineBox,
        table(entryColumns(b), b.line, {
          caption: 'The line',
          empty: parent && b.phase !== 'LIVE' && b.phase !== 'ENDED' ? 'Nobody yet: its guests enter from its opening.' : b.phase === 'HIDDEN' || b.phase === 'ANNOUNCED' ? 'Nobody yet: the room opens at the time below.' : 'Nobody in the room or the line.',
        }),
        b.lineTotal > b.line.length ? h('p', { class: 'footnote' }, `The first ${formatCount(b.line.length)} of ${formatCount(b.lineTotal)} open entries, by place. Choose a status to read every entry.`) : null,
      );
    }
  };

  // ── The pace (ONE QUEUE, lot Q1 §4) ─────────────────────────────────────
  // The block is built once: its line, mark, figures and close guard follow each board, while its controls (and the
  // guard's) are drawn again only when what may be done changes, so a focused control keeps its focus and a click is not
  // lost to the next frame. They act on the latest board.
  let paceKey = '';
  let paceToolsKey: string | null = null;
  let guardToolsKey: string | null = null;
  const paceText = h('span', { class: 'live__pace-text', data: { testid: 'live-pace-line' } });
  const pacePausedMark = statusMark('PACE PAUSED', 'alert');
  const paceTools = h('span', { class: 'live__pace-tools' });
  const paceFigures = h('div', { class: ['kpis', 'live__pace-figures'] });
  // D10, the close guard: a warning, advice only (nothing happens by itself): EXTEND, SET PACE or NEXT BATCH NOW.
  const guardText = h('span', { class: 'live__alert-text', data: { testid: 'live-close-guard-text' } });
  const guardTools = h('span', { class: 'live__pace-tools' });
  const guardBox = h('div', { class: 'live__alert live__guard', data: { testid: 'live-close-guard' } }, h('p', { class: 'live__alert-head' }, guardText, guardTools));
  guardBox.hidden = true;
  mount(paceBox, h('div', { class: 'live__pace-head' }, h('span', { class: 'live__message-label' }, 'Pace'), paceText, paceTools), guardBox, paceFigures);
  function drawPace(b: LiveBoard): void {
    const p = b.pace ?? null;
    const ended = b.endedAt !== null || b.phase === 'ENDED';
    // A release without a pace (an after-room never draws this block) that has ended: nothing to say or do.
    paceBox.hidden = !p && ended;
    paceText.textContent = p ? paceLine(p) : '—';
    if (p?.paused && !ended) {
      if (!pacePausedMark.isConnected) paceTools.before(pacePausedMark);
    } else pacePausedMark.remove();
    const a = livePaceActions(b, role, false);
    const toolsKey = JSON.stringify(a);
    if (toolsKey !== paceToolsKey) {
      paceToolsKey = toolsKey;
      const pausePace = button('Pause pace', { kind: 'secondary', testId: 'live-pace-pause' });
      pausePace.addEventListener('click', () => void control(pausePace, () => ctx.api.pauseLivePace(r.id), 'Pace paused: no batch is given; the turns go on.'));
      const resumePace = button('Resume pace', { kind: 'primary', testId: 'live-pace-resume' });
      resumePace.addEventListener('click', () => void control(resumePace, () => ctx.api.resumeLivePace(r.id), 'Pace resumed: the next batch moves later by the time paused.'));
      const tools = [
        a.set ? button('Set pace', { kind: 'ghost', testId: 'live-pace-set', onClick: () => board && setPace(board) }) : null,
        a.pause ? pausePace : null,
        a.resume ? resumePace : null,
        a.next ? button('Next batch now', { kind: 'ghost', testId: 'live-pace-next-now', onClick: () => board && nextBatch(board) }) : null,
        // D4: from the announcement while the hold lasts (before it, the hold is a setting).
        a.shorten ? button('Shorten the hold', { kind: 'ghost', testId: 'live-hold-shorten', onClick: () => board && shortenHold(board) }) : null,
        a.endHold ? button('End the hold now', { kind: 'ghost', testId: 'live-hold-end', onClick: () => board && endHold(board) }) : null,
      ].filter((x): x is HTMLButtonElement => x !== null);
      mount(paceTools, ...tools);
      paceTools.hidden = tools.length === 0;
    }
    const remain = !ended ? (p?.closeGuard?.remain ?? 0) : 0;
    guardBox.hidden = remain <= 0;
    guardText.textContent = remain > 0 ? closeGuardLine(remain, !!r.set) : '';
    const guardKey = JSON.stringify([remain > 0, acts.extend, a.set, a.next]);
    if (guardKey !== guardToolsKey) {
      guardToolsKey = guardKey;
      mount(
        guardTools,
        ...(remain > 0
          ? [
              acts.extend ? button('Extend', { kind: 'ghost', testId: 'live-guard-extend', onClick: extend }) : null,
              a.set ? button('Set pace', { kind: 'ghost', testId: 'live-guard-set-pace', onClick: () => board && setPace(board) }) : null,
              a.next ? button('Next batch now', { kind: 'ghost', testId: 'live-guard-next-now', onClick: () => board && nextBatch(board) }) : null,
            ]
          : []),
      );
    }
    paceFigures.hidden = !p;
    mount(
      paceFigures,
      ...(p
        ? livePaceFigures({ ...b, pace: p }).map((f) => {
            const el = kpi(f.label, f.value, f.note);
            el.setAttribute('data-testid', f.testId);
            return el;
          })
        : []),
    );
    const said = p ? `Pace: ${paceLine(p)}${p.paused ? ', paused' : ''}.` : '';
    if (said !== paceKey) {
      if (paceKey !== '') paceSaid.textContent = said;
      paceKey = said;
    }
  }

  const setPace = (b: LiveBoard) => {
    const p = b.pace ?? null;
    if (!p) return;
    const started = b.phase === 'LIVE';
    const hold = p.holdMinutes ?? 0;
    // D10 in SET PACE: the close guard for the pace typed, from the next batch (which keeps its time).
    const notConfirmed = Math.max(0, b.totals.stock - b.totals.sold);
    const guard = (batch: string, minutes: string): Child => {
      const typed = paceProblem(batch, minutes) === null ? { batch: Number(batch), minutes: Number(minutes) } : { batch: p.batch, minutes: p.minutes };
      const remain = b.endedAt === null ? paceCloseGuard(typed, p.nextAt, b.closesAt, notConfirmed) : null;
      return remain ? h('p', { class: 'dialog__text', data: { testid: 'live-pace-guard' } }, closeGuardLine(remain, !!r.set)) : null;
    };
    void openDialog({
      title: 'Set the pace',
      eyebrow,
      body: [
        h(
          'p',
          { class: 'dialog__text' },
          'Turns are given from the line in batches, in its order (the guarantees first), only where a piece of the size is free; the turns, the holds and the pay windows stay as they are.',
        ),
        h(
          'p',
          { class: 'dialog__text', data: { testid: 'live-pace-effect' } },
          !started
            ? hold > 0
              ? `The first batch comes at the end of the hold, ${hold} ${hold === 1 ? 'minute' : 'minutes'} after T0.`
              : 'The first batch comes at T0.'
            : `The change takes effect from the next batch, which keeps its time (${p.paused || b.paused ? 'held while paused' : `${parisClock(p.nextAt)} Paris`}).`,
        ),
        h('p', { class: 'dialog__text' }, 'Slower or faster, until the end. The waiting screens show their new estimated time at their next reading. Recorded in the audit log.'),
      ],
      fields: [
        { name: 'batch', label: 'People per batch', required: true, maxlength: 4, value: String(p.batch), hint: `${formatCount(LIVE_LIMITS.pace.batch.min)} to ${formatCount(LIVE_LIMITS.pace.batch.max)}.` },
        { name: 'minutes', label: 'Every (minutes)', required: true, maxlength: 2, value: String(p.minutes), hint: `${LIVE_LIMITS.pace.minutes.min} to ${LIVE_LIMITS.pace.minutes.max}.` },
      ],
      live: (v) => guard(v.batch ?? '', v.minutes ?? ''),
      validate: (v) => paceProblem(v.batch, v.minutes) ?? (Number(v.batch) === p.batch && Number(v.minutes) === p.minutes ? 'Nothing has changed.' : null),
      confirmLabel: 'Set pace',
      submit: async (v) => {
        await ctx.api.setLivePace(r.id, { batch: Number(v.batch), minutes: Number(v.minutes) });
      },
    }).then(done('Pace set.'));
  };

  // D6: an extra batch now, up to X turns where a piece is free; refused when none (the server's words in the dialog).
  const nextBatch = (b: LiveBoard) => {
    const p = b.pace;
    if (!p) return;
    void openDialog({
      title: 'Next batch now',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text', data: { testid: 'live-pace-next-text' } }, `Up to ${formatCount(p.batch)} ${p.batch === 1 ? 'turn' : 'turns'} now, in the line’s order, where a piece is free: an extra batch. The batches keep their times.`),
      ],
      confirmLabel: 'Give the batch',
      submit: async () => {
        await ctx.api.nextLiveBatch(r.id);
      },
    }).then(done('Batch given.'));
  };

  // D4: the hold, once announced, only shortened or ended (before the announcement it is a setting, N14).
  const shortenHold = (b: LiveBoard) => {
    const p = b.pace;
    if (!p?.holdEndsAt) return;
    const current = p.holdMinutes ?? 0;
    void openDialog({
      title: 'Shorten the hold',
      eyebrow,
      body: [
        h(
          'p',
          { class: 'dialog__text', data: { testid: 'live-hold-shorten-text' } },
          `The hold after the opening lasts ${current} ${current === 1 ? 'minute' : 'minutes'}: the first batch comes at ${p.paused || b.paused ? 'its time once resumed' : `${parisClock(p.holdEndsAt)} Paris`}. A shorter hold brings it earlier, never later; the waiting screens show their new estimated time at their next reading.`,
        ),
        h('p', { class: 'dialog__text' }, 'Recorded in the audit log.'),
      ],
      fields: [{ name: 'minutes', label: 'New length (minutes)', required: true, maxlength: 3, hint: `After the opening (T0), shorter than now; END THE HOLD NOW starts the turns at once.` }],
      validate: (v) => holdShortenProblem(v.minutes, current),
      confirmLabel: 'Shorten the hold',
      submit: async (v) => {
        await ctx.api.shortenLiveHold(r.id, Number(v.minutes));
      },
    }).then(done('Hold shortened.'));
  };

  const endHold = (b: LiveBoard) => {
    const p = b.pace;
    if (!p?.holdEndsAt) return;
    const started = b.phase === 'LIVE';
    void openDialog({
      title: 'End the hold now',
      eyebrow,
      body: [
        h(
          'p',
          { class: 'dialog__text', data: { testid: 'live-hold-end-text' } },
          started
            ? `The first batch is given ${p.paused || b.paused ? 'at the resume' : 'now'}: up to ${formatCount(p.batch)} ${p.batch === 1 ? 'turn' : 'turns'}, in the line’s order, where a piece is free; the next ones follow every ${p.minutes === 1 ? 'minute' : `${p.minutes} minutes`}.`
            : `The first batch comes at T0, without a hold; the next ones follow every ${p.minutes === 1 ? 'minute' : `${p.minutes} minutes`}.`,
        ),
        h('p', { class: 'dialog__text' }, 'Recorded in the audit log.'),
      ],
      confirmLabel: 'End the hold',
      submit: async () => {
        await ctx.api.endLiveHold(r.id);
      },
    }).then(done('Hold ended.'));
  };

  async function refreshBoard(): Promise<void> {
    try {
      const { board: b } = await ctx.api.liveBoard(r.id);
      render(b, 'read');
    } catch (e) {
      notifyError(e);
    }
  }

  const control = async (btn: HTMLButtonElement, fn: () => Promise<unknown>, msg: string) => {
    btn.disabled = true;
    try {
      await fn();
      notify(msg);
      ctx.reload();
    } catch (e) {
      notifyError(e);
      btn.disabled = false;
    }
  };
  const pause = button('Pause', { kind: 'secondary', testId: 'live-pause' });
  pause.addEventListener('click', () => void control(pause, () => ctx.api.pauseLive(r.id), 'Paused: no new turn, the deadlines frozen.'));
  const resume = button('Resume', { kind: 'primary', testId: 'live-resume' });
  resume.addEventListener('click', () => void control(resume, () => ctx.api.resumeLive(r.id), 'Resumed: the turns and holds run again.'));
  const extend = () =>
    void openDialog({
      title: 'Extend the release',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `The sales end on ${formatDateTime(r.closesAt)}. The end moves later by the minutes below; the line keeps its turns until then.`),
      fields: [{ name: 'minutes', label: 'Minutes', required: true, maxlength: 3, value: '15', hint: `${LIVE_LIMITS.extendMinutes.min} to ${LIVE_LIMITS.extendMinutes.max}.` }],
      validate: (v) => {
        const n = /^\s*\d{1,3}\s*$/.test(v.minutes) ? Number(v.minutes) : 0;
        return n >= LIVE_LIMITS.extendMinutes.min && n <= LIVE_LIMITS.extendMinutes.max ? null : `Extend by ${LIVE_LIMITS.extendMinutes.min} to ${LIVE_LIMITS.extendMinutes.max} minutes.`;
      },
      confirmLabel: 'Extend',
      submit: async (v) => {
        await ctx.api.extendLive(r.id, Number(v.minutes));
      },
    }).then(done('Release extended.'));
  const message = () =>
    void openDialog({
      title: 'Host message',
      eyebrow,
      // ONE QUEUE (D11): said where it shows (FROM ORBES: the room, the draw, the late comer's entry, the queue, SOLD OUT
      // for one's size, the after-room's waiting screen, the turn and SECURED; never CONFIRMED nor the after-room's door).
      body: h('p', { class: 'dialog__text', data: { testid: 'live-message-hint' } }, LIVE_MESSAGE_HINT),
      fields: [{ name: 'text', label: 'Message', required: true, maxlength: LIVE_LIMITS.message, hint: `At most ${LIVE_LIMITS.message} characters, in the house’s words.` }],
      validate: (v) => (v.text.trim().length < 1 || v.text.trim().length > LIVE_LIMITS.message ? `A message is one line of 1 to ${LIVE_LIMITS.message} characters.` : null),
      confirmLabel: 'Send to the room',
      submit: async (v) => {
        await ctx.api.messageLive(r.id, v.text.trim());
      },
    }).then((v) => {
      if (!v) return;
      notify('Message sent to the room.');
      void refreshBoard();
    });
  const end = () =>
    void openDialog({
      title: 'End the release now',
      eyebrow,
      danger: true,
      body: [
        h('p', { class: 'dialog__text' }, 'No new turn. Everyone in the room, in the line and in a turn now reads that the release has ended. A piece already held may still be paid for until its time runs out.'),
        h('p', { class: 'dialog__text' }, 'The release then moves to PAST in THE RELEASES, as announced. Once.'),
      ],
      phrase: livePhrase('end', r),
      confirmLabel: 'End now',
      submit: async () => {
        await ctx.api.endLive(r.id);
      },
    }).then(done('Release ended.'));

  const boardTools = [
    acts.pause ? pause : null,
    acts.resume ? resume : null,
    acts.extend ? button('Extend', { kind: 'ghost', testId: 'live-extend', onClick: extend }) : null,
    acts.message ? button('Message', { kind: 'ghost', testId: 'live-message-new', onClick: message }) : null,
    acts.end ? button('End now', { kind: 'danger', testId: 'live-end', onClick: end }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);

  const boardSection = board
    ? section('Live board', [stateLine, alertsSaid, alertsBox, figures, ...(parent ? [] : [paceSaid, paceBox]), messageLine, sizesBox, sellOutBox], { id: 'live-board', tools: boardTools, note: `T0 ${formatDateTime(r.opensAt)} · end ${formatDateTime(r.closesAt)}` })
    : null;

  // ── The entries ──────────────────────────────────────────────────────────
  // ONE QUEUE (D11, OP-12): the QUEUED filter reads 'Waiting in the queue' (the WAITING status keeps its name), and a
  // paced release adds those beyond the pieces of their size.
  const statusFilter = select(
    'status',
    [
      { value: '', label: 'The line, live' },
      { value: 'OPEN', label: 'Open entries' },
      ...LIVE_ENTRY_STATUSES.map((s) => ({ value: s, label: s === 'QUEUED' ? 'Waiting in the queue' : humanize(s) })),
      ...(r.pace ? [{ value: 'BEYOND', label: 'Beyond the pieces' }] : []),
    ],
    status ?? '',
  );
  statusFilter.addEventListener('change', () => ctx.setQuery({ status: statusFilter.value, page: undefined }));
  let entriesSection: HTMLElement | null = null;
  if (published) {
    const body: Child[] = [filterBar(field('Entries', statusFilter))];
    if (entries) {
      const open = status === 'OPEN';
      const beyond = status === 'BEYOND';
      body.push(
        table(entryColumns(board), entries.items, {
          caption: open ? 'Open entries' : beyond ? 'Beyond the pieces' : 'Entries',
          empty: open ? 'No open entry.' : beyond ? 'Nobody in the queue is beyond the pieces of their size.' : 'No entry has this status.',
        }),
        pager(entries, (p) => ctx.setQuery({ page: p })),
      );
    } else body.push(lineBox);
    entriesSection = section('Entries', body, { id: 'live-entries', note: board ? `${formatCount(board.lineTotal)} open · ${formatCount(Object.values(r.entries).reduce((n, c) => n + c, 0))} in all` : undefined });
  }

  // ── Client Services: the orders ──────────────────────────────────────────
  const confirmed = r.entries.CONFIRMED ?? 0;
  const servicesSection = section(
    'Client Services',
    h(
      'p',
      { class: 'panel__text', data: { testid: 'live-orders' } },
      confirmed > 0
        ? `${formatCount(confirmed)} confirmed ${confirmed === 1 ? 'reservation' : 'reservations'}: each piece is an order, followed step by step on the Orders board, from payment to delivery.`
        : 'Each confirmed reservation becomes an order per piece, followed step by step on the Orders board, from payment to delivery.',
    ),
    { id: 'live-services', tools: [linkButton('Orders of this release', href('orders', {}, { dropId: r.id }), 'ghost')] },
  );

  // ── The settings ─────────────────────────────────────────────────────────
  const editPart = (part: LivePart, title: string, fields: DialogField[], extra: { body?: Child; live?: (v: Record<string, string>) => Child } = {}) =>
    void openDialog({
      title,
      eyebrow,
      body: extra.body ?? h('p', { class: 'dialog__text' }, r.publishedAt ? 'The release is published, announced later: its settings change until then.' : 'A draft: nothing of it is public yet.'),
      fields,
      validate: (v) => livePartProblem(r, part, v) ?? (Object.keys(livePartChange(r, part, v)).length === 0 ? 'Nothing has changed.' : null),
      ...(extra.live ? { live: extra.live } : {}),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.updateLiveRelease(r.id, livePartChange(r, part, v));
      },
    }).then(done('Release saved.'));
  const edit = (label: string, testId: string, open: () => void) => (acts.edit ? [button(label, { kind: 'ghost', testId, onClick: open })] : []);
  const values = (part: LivePart) => livePartValues(r, part);
  const modelOptions = (selected: string) =>
    models.items.filter((m: Model) => m.active || m.id === selected).map((m: Model) => ({ value: m.id, label: modelChoice(m) }));

  const releasePart = () => {
    const v = values('release');
    editPart('release', 'The release', [
      // Macro scope K44 T1: a set's release keeps its set (Sizes and stock gives its sizes per piece).
      ...(r.set ? [] : [{ name: 'modelId', label: 'Model', kind: 'select' as const, required: true, options: modelOptions(v.modelId), value: v.modelId }]),
      { name: 'title', label: 'Title', required: true, maxlength: LIVE_LIMITS.title, value: v.title, hint: 'Revealed with the name’s stage.' },
      { name: 'description', label: 'Description', kind: 'textarea', rows: 4, maxlength: LIVE_LIMITS.description, value: v.description, hint: 'Plain paragraphs. Revealed with the name’s stage. Optional.' },
      { name: 'price', label: r.set ? 'Price of the set' : 'Price of a piece', required: true, maxlength: 12, value: v.price, hint: r.set ? 'One price for the set, in units: 4800, or 4800.50. Shown from the announcement; shared over its pieces’ orders.' : 'In units: 4800, or 4800.50. Shown from the announcement.' },
      { name: 'currency', label: 'Currency', kind: 'select', options: LIVE_CURRENCIES.map((c) => ({ value: c, label: c })), value: v.currency },
      // T4: on a set's release, a set counts as one: « 1 SET PER PERSON ».
      r.set
        ? { name: 'perAccount', label: 'Sets per person', required: true, maxlength: 1, value: v.perAccount, hint: `${LIVE_LIMITS.perAccount.min} to ${LIVE_LIMITS.perAccount.max}: a set counts as one, whatever its pieces.` }
        : { name: 'perAccount', label: 'Pieces per person', required: true, maxlength: 1, value: v.perAccount, hint: `${LIVE_LIMITS.perAccount.min} to ${LIVE_LIMITS.perAccount.max}, chosen with the size.` },
    ], r.set ? { body: h('p', { class: 'dialog__text' }, `It sells THE SET ${humanize(r.set.name)}: ${r.set.pieces.map((p) => pieceName(r.set, p.piece)).join(', ')}.`) } : {});
  };
  const sizesPart = () => {
    const v = values('sizes');
    if (r.set) return setSizesPart(v);
    editPart(
      'sizes',
      'Sizes and stock',
      [
        { name: 'sizes', label: 'Sizes', kind: 'textarea', rows: 6, required: true, value: v.sizes, hint: `One size per line, its label then its stock: 52 = 3. A one-size release has one line (ONE SIZE = 25). Up to ${LIVE_LIMITS.sizes} sizes.` },
        { name: 'quantityLine', label: 'Quantity line', maxlength: LIVE_LIMITS.quantityLine, value: v.quantityLine, hint: 'As the announcement says it, at most 40 characters (25 PIECES · NEVER MORE). Empty: the number of pieces, then PIECES.' },
        {
          name: 'locationId',
          label: 'Stock location',
          kind: 'select',
          options: locationOptions(locations.items, v.locationId, r.locationId ? r.location?.name : undefined),
          value: v.locationId,
          hint: 'Where its orders hold a piece in stock, or wait for one: the stock check reads its stock there. ORBES Client Services may move an order elsewhere.',
        },
      ],
      {
        live: (x) => {
          const p = parseSizes(x.sizes, r.sizes);
          if ('problem' in p) return h('p', { class: 'dialog__text soft' }, p.problem);
          const total = p.sizes.reduce((n, s) => n + s.stock, 0);
          // IN-01: the stock never below the pieces the house guarantees (the server refuses the save).
          const warning = stockWarning(total, r.guaranteed);
          const preview = h('p', { class: 'dialog__text', data: { testid: 'live-sizes-preview' } }, `${formatCount(total)} ${total === 1 ? 'piece' : 'pieces'} in all · announced as « ${(x.quantityLine ?? '').trim() || defaultQuantityLine(total)} »`);
          return warning ? h('div', null, preview, h('p', { class: 'dialog__text', data: { testid: 'live-sizes-guaranteed' } }, warning)) : preview;
        },
      },
    );
  };
  // Macro scope K44 T1: a set's sizes per piece, each its model's, the sets on sale its scarcest piece's.
  const setSizesPart = (v: Record<string, string>) => {
    const set = r.set!;
    const names = releasePieceNames(r);
    editPart(
      'sizes',
      'Sizes and stock',
      [
        ...set.pieces.map((p) => ({
          name: liveSizesField(p.piece),
          label: `Sizes · ${pieceName(set, p.piece)}`,
          kind: 'textarea' as const,
          rows: 4,
          required: true,
          value: v[liveSizesField(p.piece)] ?? '',
          hint: `This piece’s sizes, one per line, its label then its stock: 52 = 3. Up to ${LIVE_LIMITS.sizes} sizes.`,
        })),
        { name: 'quantityLine', label: 'Quantity line', maxlength: LIVE_LIMITS.quantityLine, value: v.quantityLine, hint: 'As the announcement says it, at most 40 characters (25 SETS · NEVER MORE). Empty: the sets on sale, then SETS.' },
        {
          name: 'locationId',
          label: 'Stock location',
          kind: 'select',
          options: locationOptions(locations.items, v.locationId, r.locationId ? r.location?.name : undefined),
          value: v.locationId,
          hint: 'Where its orders hold a piece in stock, or wait for one: the stock check reads its stock there. ORBES Client Services may move an order elsewhere.',
        },
      ],
      {
        body: h('p', { class: 'dialog__text' }, `${r.publishedAt ? 'The release is published, announced later: its settings change until then.' : 'A draft: nothing of it is public yet.'} Each piece has its own sizes; the release sells as many sets as its scarcest piece.`),
        live: (x) => {
          const p = parseSetSizes(x, names, r.sizes);
          if ('problem' in p) return h('p', { class: 'dialog__text soft' }, p.problem);
          const lines = setsOnSaleLines(pieceTotals(p.sizes, names.length), names, 'LIVE');
          const sets = setsOnSale(p.sizes, names.length);
          return h(
            'div',
            null,
            h('p', { class: 'dialog__text', data: { testid: 'live-sizes-preview' } }, `${lines.onSale} · announced as « ${(x.quantityLine ?? '').trim() || defaultQuantityLine(sets, true)} »`),
            lines.uneven ? h('p', { class: 'dialog__text soft', data: { testid: 'live-sets-uneven' } }, lines.uneven) : null,
          );
        },
      },
    );
  };
  const accessPart = () => {
    const v = values('access');
    editPart('access', 'Access', [
      { name: 'minTier', label: 'Who may enter', kind: 'select', options: [...LIVE_TIER_OPTIONS], value: v.minTier },
      { name: 'collectionId', label: 'Owners of a collection', kind: 'select', options: [{ value: '', label: 'Any collection' }, ...collections.items.map((c) => ({ value: c.id, label: humanize(c.name) }))], value: v.collectionId },
      ...models.items.map((m: Model) => ({ name: `model:${m.id}`, label: `Owners of ${humanize(m.name)}`, kind: 'checkbox' as const, value: v[`model:${m.id}`] ?? '' })),
      {
        name: 'minParticipations',
        label: 'Taken part in at least',
        maxlength: 3,
        value: v.minParticipations,
        hint: `Releases, ${LIVE_LIMITS.minParticipations.min} to ${LIVE_LIMITS.minParticipations.max}: in the line of a LIVE RELEASE at T0 or after, or entered in a draw when it was drawn; this one never counts. The page says FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES. Empty: no such rule.`,
      },
      {
        name: 'segmentId',
        label: 'Segment',
        kind: 'select',
        options: [{ value: '', label: 'None' }, ...segments.map((x) => ({ value: x.id, label: x.name }))],
        value: v.segmentId,
        hint: 'Its members, read at each step. The page says FOR SELECTED COLLECTORS, never its name.',
      },
      {
        name: 'combine',
        label: 'The rules combine',
        kind: 'select',
        options: [
          { value: 'AND', label: 'Every rule is needed (AND)' },
          { value: 'OR', label: 'Any one rule is enough (OR)' },
        ],
        value: v.combine,
        hint: 'One choice for all the rules above: the tier, the owners of models or a collection, the releases taken part in, the segment. With OR, the page joins them with OR.',
      },
      { name: 'tierPriority', label: 'Tier priority', kind: 'checkbox', value: v.tierPriority, hint: 'At the opening (T0), the line forms by tier first (PALLADIUM, PLATINE, TITANE, then the others), then at random. Unticked: at random for all.' },
    ]);
  };
  const surprisePart = () => {
    const v = values('surprise');
    editPart(
      'surprise',
      'Surprise',
      [
        { name: 'enabled', label: 'A surprise in every box', kind: 'checkbox', value: v.enabled, hint: 'The same for every order of the release, its after-room’s too. The release page says A SURPRISE IN EVERY BOX, never what.' },
        { name: 'text', label: 'What it is (internal)', kind: 'textarea', rows: 3, maxlength: LIVE_LIMITS.surprise, value: v.text, hint: 'Printed on each order’s packing slip and work sheet, never shown to collectors.' },
      ],
    );
  };
  const questionPart = () => {
    const v = values('question');
    editPart(
      'question',
      'Question after',
      [
        { name: 'enabled', label: 'Ask the question after', kind: 'checkbox', value: v.enabled, hint: 'For 7 days from the end: on the release’s end page to those who took part without a piece, in MY PIECES to those who said I’LL BE THERE and did not come. One tap, changeable.' },
        { name: 'text', label: 'Question', maxlength: LIVE_LIMITS.question.text, value: v.text, hint: `One line, at most ${LIVE_LIMITS.question.text} characters. The default: WHAT WOULD YOU HAVE WANTED?` },
        {
          name: 'answers',
          label: 'Answers',
          kind: 'textarea',
          rows: 6,
          value: v.answers,
          hint: `${LIVE_LIMITS.question.minAnswers} to ${LIVE_LIMITS.question.maxAnswers}, one per line, each at most ${LIVE_LIMITS.question.answer} characters. Empty with an empty question: the default question and its answers.`,
        },
      ],
    );
  };
  const timesPart = () => {
    const v = values('times');
    editPart(
      'times',
      'Times (UTC)',
      [
        { name: 'announceAt', label: 'Announcement', kind: 'datetime', value: v.announceAt, hint: r.publishedAt ? 'Later than now: a published release keeps its announcement time.' : 'Empty: when the release is published.' },
        { name: 'silhouetteAt', label: 'Silhouette revealed', kind: 'datetime', value: v.silhouetteAt, hint: 'Empty: at the announcement. Each stage comes after the one before it.' },
        { name: 'nameAt', label: 'Name revealed', kind: 'datetime', value: v.nameAt, hint: 'Empty: at the announcement.' },
        { name: 'photoAt', label: 'Photograph revealed', kind: 'datetime', value: v.photoAt, hint: 'Empty: at the announcement. Every stage before the room opens.' },
        { name: 'roomOpensMinutes', label: 'Room opens (minutes before)', required: true, maxlength: 2, value: v.roomOpensMinutes, hint: `Before the opening (T0): ${LIVE_LIMITS.roomOpensMinutes.min} to ${LIVE_LIMITS.roomOpensMinutes.max}; ${LIVE_LIMITS.roomOpensMinutes.default} by default.` },
        { name: 'opensAt', label: 'The opening', kind: 'datetime', required: true, value: v.opensAt, hint: 'T0: the door opens and the line forms.' },
        { name: 'closesAt', label: 'End of the sales', kind: 'datetime', required: true, value: v.closesAt, hint: 'No new turn after it; the release also ends at its sell-out.' },
        // D1: X people per batch every Y minutes and the hold after the opening, all required.
        { name: 'paceBatch', label: 'People per batch', required: true, maxlength: 4, value: v.paceBatch, hint: paceHint(planCapacity) },
        { name: 'paceMinutes', label: 'Every (minutes)', required: true, maxlength: 2, value: v.paceMinutes, hint: 'SET PACE on the live board changes it until the end.' },
        // The owner's words (ANSWERS r5): its figure in --font inside the display-face label (BRAND-DESIGN-SYSTEM §3.1).
        { name: 'holdMinutes', label: figureLabel(LIVE_HOLD_LABEL), required: true, maxlength: 3, value: v.holdMinutes, hint: `Up to ${LIVE_LIMITS.hold.max}. Everyone waits it, guarantees included; once announced it can only be shortened or ended.` },
      ],
    );
  };
  // The pace's hint: the room's measured capacity, when the planner or the forecast was read.
  const plan = intelligence.plan && intelligence.plan !== 'failed' ? intelligence.plan : null;
  const forecast = intelligence.forecast && intelligence.forecast !== 'failed' ? intelligence.forecast : null;
  const planCapacity = plan?.forecast.capacity ?? forecast?.capacity ?? null;
  const turnsPart = () => {
    const v = values('turns');
    editPart('turns', 'Turns and holds', [
      { name: 'turnSeconds', label: 'Seconds to hold the seal', required: true, maxlength: 3, value: v.turnSeconds, hint: `Once it is one’s turn: ${LIVE_LIMITS.turnSeconds.min} to ${LIVE_LIMITS.turnSeconds.max}; ${LIVE_LIMITS.turnSeconds.default} by default.` },
      { name: 'payMinutes', label: 'Minutes to press PAY', required: true, maxlength: 2, value: v.payMinutes, hint: `Once the seal is held: ${LIVE_LIMITS.payMinutes.min} to ${LIVE_LIMITS.payMinutes.max}; ${LIVE_LIMITS.payMinutes.default} by default.` },
      ...[3, 2, 1, 0].flatMap((t) => [
        { name: `turn:${t}`, label: `${tierLabel(t)} · seconds to hold`, maxlength: 3, value: v[`turn:${t}`], hint: 'Empty: the release’s.' },
        { name: `pay:${t}`, label: `${tierLabel(t)} · minutes to pay`, maxlength: 2, value: v[`pay:${t}`], hint: 'Empty: the release’s.' },
      ]),
    ]);
  };
  const addonsPart = () => {
    const v = values('addons');
    editPart('addons', 'Add-ons', [
      {
        name: 'addons',
        label: 'Add-ons',
        kind: 'textarea',
        rows: 6,
        value: v.addons,
        hint: `Offered with a piece held, at most ${LIVE_LIMITS.addons}: one per line, its label, its price, then a line (ENGRAVING | 150 | Your initials, by hand). Empty: none.`,
      },
    ]);
  };

  const afterRoomPart = () => {
    const v = values('afterRoom');
    editPart(
      'afterRoom',
      'After-room',
      [
        { name: 'enabled', label: 'An after-room after a sell-out', kind: 'checkbox', value: v.enabled, hint: 'Opens only if the release sells out, for those still in its line then, in their order. Unticked: none.' },
        { name: 'modelId', label: 'Model', kind: 'select', options: [{ value: '', label: 'Choose a model' }, ...modelOptions(v.modelId)], value: v.modelId },
        { name: 'price', label: 'Price of a piece', maxlength: 12, value: v.price, hint: `In units, in the release’s currency (${r.currency}).` },
        { name: 'sizes', label: 'Sizes', kind: 'textarea', rows: 4, value: v.sizes, hint: 'Its own stock, one size per line: 52 = 3.' },
        { name: 'addons', label: 'Add-ons', kind: 'textarea', rows: 3, value: v.addons, hint: 'One per line: ENGRAVING | 150 | its line. Empty: none.' },
        { name: 'delay', label: 'Opens (minutes after the sell-out)', maxlength: 2, value: v.delay, hint: `${LIVE_LIMITS.afterRoomDelay.min} to ${LIVE_LIMITS.afterRoomDelay.max}; ${LIVE_LIMITS.afterRoomDelay.default} by default.` },
        { name: 'length', label: 'Open (minutes)', maxlength: 3, value: v.length, hint: `${LIVE_LIMITS.afterRoomLength.min} to ${LIVE_LIMITS.afterRoomLength.max}; ${LIVE_LIMITS.afterRoomLength.default} by default. It also closes at its own sell-out.` },
      ],
      {
        body: h(
          'p',
          { class: 'dialog__text' },
          'A second door, announced nowhere: only those still in the line when the last piece is secured see it, in the same vault, and keep their place. The turn and pay windows, the pieces per person and the surprise are the release’s; it asks no question after.',
        ),
      },
    );
  };

  const t = (iso: string | null, empty: string) => (iso ? formatDateTime(iso) : empty);
  const a = r.afterRoom;
  const opened = a !== null && a.state !== 'WAITING' && a.state !== 'NOT_OPENED';
  const afterRoomSection = section(
    'After-room',
    a
      ? defList([
          {
            label: 'State',
            value: h('span', { data: { testid: 'live-after-room-state' } }, statusMark(afterRoomStateLabel(a), toneOf('livePhase', a.phase))),
            note: a.skipped ? AFTER_ROOM_SKIPS[a.skipped] : undefined,
          },
          { label: 'Model', value: `${humanize(a.model.name)} · ${humanize(a.model.type)}`, note: a.model.active ? undefined : 'No longer offered for new pieces.' },
          { label: 'Price', value: `${formatMoney(a.priceMinor, a.currency)} a piece` },
          { label: 'Sizes', value: h('span', { data: { testid: 'live-after-room-sizes' } }, sizesLine(a.sizes)) },
          { label: 'Add-ons', value: a.addons.length ? a.addons.map((x) => `${x.label} ${formatMoney(x.priceMinor, a.currency)}`).join(' · ') : 'None' },
          { label: 'Timing', value: h('span', { data: { testid: 'live-after-room-timing' } }, afterRoomTiming(a)) },
          ...(a.opensAt && a.closesAt ? [{ label: 'Door', value: `${formatDateTime(a.opensAt)} to ${formatDateTime(a.closesAt)}`, note: 'Its guests see it from its opening' }] : []),
          ...(opened
            ? [{ label: 'Guests', value: h('span', { data: { testid: 'live-after-room-guests' } }, formatCount(a.guests)), note: `${formatCount(a.entries.CONFIRMED ?? 0)} CONFIRMED` }]
            : []),
        ])
      : h('p', { class: 'notice', data: { testid: 'live-after-room-none' } }, r.set ? 'None: a set’s release never has an after-room.' : 'None: the release closes at its sell-out.'),
    {
      id: 'live-part-after-room',
      tools: [
        // Macro scope K44: after-rooms stay a model's; a set's release never has one.
        ...(r.set ? [] : edit('Edit', 'live-edit-after-room', afterRoomPart)),
        ...(a && opened ? [linkButton('Its live board', href('liveRelease', { dropId: a.id }), 'ghost')] : []),
      ],
    },
  );
  // The question after: its words; once the release has ended, who is asked where, how many answered, each answer.
  const questionSection = (q: NonNullable<LiveRelease['question']>) =>
    section(
      'Question after',
      [
        defList([
          { label: 'Question', value: h('span', { data: { testid: 'live-question' } }, questionLine(q)) },
          { label: 'When', value: h('span', { data: { testid: 'live-question-state' } }, questionStateLine(q)) },
          ...(q.state === 'OPEN' || q.state === 'CLOSED'
            ? [
                {
                  label: 'Asked',
                  value: h('span', { data: { testid: 'live-question-asked' } }, `${formatCount(q.asked.tookPart + q.asked.interest)}`),
                  note: `${formatCount(q.asked.tookPart)} on the end page (took part, no piece) · ${formatCount(q.asked.interest)} in MY PIECES (I’LL BE THERE, did not come)`,
                },
                { label: 'Answered', value: h('span', { data: { testid: 'live-question-answered' } }, formatCount(q.answered)) },
              ]
            : []),
        ]),
        ...(q.state === 'OPEN' || q.state === 'CLOSED' ? [h('div', { data: { testid: 'live-question-tally' } }, barList(questionTallyRows(q)))] : []),
      ],
      { id: 'live-part-question', tools: edit('Edit', 'live-edit-question', questionPart) },
    );
  const parts: HTMLElement[] = [
    section(
      'The release',
      defList([
        // Macro scope K44 T1: a set's release names its set and its pieces, its price the set's, its limit in sets (T4).
        ...(r.set
          ? [
              { label: 'Set', value: h('a', { class: 'idlink', attrs: { href: href('catalogue'), 'data-testid': 'live-set' } }, `THE SET ${humanize(r.set.name)}`), note: r.set.active ? undefined : 'Set aside: no new release of it.' },
              { label: 'Pieces', value: h('span', { data: { testid: 'live-set-pieces' } }, r.set.pieces.map((p) => pieceName(r.set, p.piece)).join(', ')) },
            ]
          : [{ label: 'Model', value: `${humanize(r.model.name)} · ${humanize(r.model.type)}`, note: r.model.active ? undefined : 'No longer offered for new pieces.' }]),
        ...(r.description ? [{ label: 'Description', value: h('span', { class: 'cell-details' }, r.description) }] : []),
        { label: 'Price', value: h('span', { data: { testid: 'live-price' } }, `${formatMoney(r.priceMinor, r.currency)} ${r.set ? 'for the set' : 'a piece'}`) },
        { label: 'Per person', value: h('span', { data: { testid: 'live-per-person' } }, r.set ? perPersonText(r.perAccount, true) : `${r.perAccount} ${r.perAccount === 1 ? 'piece' : 'pieces'}`), note: r.set ? 'A set counts as one, whatever its pieces.' : undefined },
      ]),
      { id: 'live-part-release', tools: edit('Edit', 'live-edit-release', releasePart) },
    ),
    section(
      'Sizes',
      defList([
        ...(r.set
          ? [
              ...r.set.pieces.map((p) => ({ label: pieceName(r.set, p.piece), value: h('span', { data: { testid: 'live-sizes' } }, sizesLine(r.sizes.filter((z) => z.piece === p.piece))) })),
              { label: 'Sets on sale', value: h('span', { data: { testid: 'live-sets' } }, formatCount(r.quantity)), note: 'The scarcest piece’s pieces' },
            ]
          : [
              { label: 'Sizes', value: h('span', { data: { testid: 'live-sizes' } }, sizesLine(r.sizes)) },
              { label: 'Pieces', value: formatCount(r.quantity) },
            ]),
        { label: 'Quantity line', value: h('span', { data: { testid: 'live-quantity-line' } }, r.quantityLine), note: r.editable ? undefined : 'Announced: only ADD PIECES raises a stock now.' },
        // IN-01: the places the house guarantees, first in line in their size.
        ...(r.guaranteed.places > 0 ? [{ label: 'Guaranteed', value: h('span', { data: { testid: 'live-guaranteed' } }, guaranteedText(r.guaranteed)), note: 'First in line in their size, listed first.' }] : []),
        { label: 'Stock location', value: h('span', { data: { testid: 'live-location' } }, r.location?.name ?? 'None yet'), note: r.locationId ? undefined : 'The default location' },
        { label: 'Stock', value: stockBlock(ctx, r, stockCheck) },
      ]),
      { id: 'live-part-sizes', tools: edit('Edit', 'live-edit-sizes', sizesPart) },
    ),
    section(
      'Access',
      defList([
        { label: 'For', value: h('span', { data: { testid: 'live-access' } }, r.access.text), note: 'As the release page says it' },
        ...(r.access.minParticipations !== null
          ? [{ label: 'Taken part', value: `At least ${r.access.minParticipations} ${r.access.minParticipations === 1 ? 'release' : 'releases'}` }]
          : []),
        ...(r.access.segment
          ? [{ label: 'Segment', value: h('a', { class: 'idlink', attrs: { href: href('segment', { segmentId: r.access.segment.id }), 'data-testid': 'live-access-segment' } }, r.access.segment.name), note: 'Said FOR SELECTED COLLECTORS' }]
          : []),
        { label: 'Rules', value: h('span', { data: { testid: 'live-access-combine' } }, combineLine(r.access.combine)) },
        { label: 'Line at the opening', value: priorityLine(r.tierPriority) },
      ]),
      { id: 'live-part-access', tools: edit('Edit', 'live-edit-access', accessPart) },
    ),
    section(
      'Surprise',
      defList([
        { label: 'Surprise', value: h('span', { data: { testid: 'live-surprise' } }, surpriseLine(r)), note: r.surprise.enabled ? 'Internal: the packing slips and work sheets; the page says A SURPRISE IN EVERY BOX' : undefined },
      ]),
      { id: 'live-part-surprise', tools: edit('Edit', 'live-edit-surprise', surprisePart) },
    ),
    ...(r.question ? [questionSection(r.question)] : []),
    section(
      'Times (UTC)',
      defList([
        { label: 'Announcement', value: t(r.announceAt, r.publishedAt ? formatDateTime(r.publishedAt) : 'At the publication') },
        { label: 'Silhouette', value: r.stages ? formatDateTime(r.stages.silhouetteAt) : t(r.silhouetteAt, 'At the announcement') },
        { label: 'Name', value: r.stages ? formatDateTime(r.stages.nameAt) : t(r.nameAt, 'At the announcement') },
        { label: 'Photograph', value: r.stages ? formatDateTime(r.stages.photoAt) : t(r.photoAt, 'At the announcement') },
        { label: 'Room opens', value: formatDateTime(r.roomOpensAt), note: `${r.roomOpensMinutes} ${r.roomOpensMinutes === 1 ? 'minute' : 'minutes'} before T0` },
        { label: 'Opening', value: h('span', { data: { testid: 'live-t0' } }, formatDateTime(r.opensAt)), note: 'T0: the door opens, the line forms' },
        { label: 'End of the sales', value: formatDateTime(r.closesAt) },
        // ONE QUEUE (D1): the pace and the hold after the opening, both set at creation (an after-room has neither).
        ...(r.pace
          ? [
              { label: 'Pace', value: h('span', { data: { testid: 'live-pace-setting' } }, paceLine(r.pace)), note: 'SET PACE on the live board until the end' },
              {
                label: 'Hold after the opening',
                value: h('span', { data: { testid: 'live-hold-setting' } }, holdLine(r.holdMinutes)),
                note: r.editable ? 'Everyone waits it, guarantees included' : 'Once announced: only shortened or ended, on the live board',
              },
            ]
          : []),
      ]),
      { id: 'live-part-times', tools: edit('Edit', 'live-edit-times', timesPart) },
    ),
    section(
      'Turns and holds',
      defList([
        { label: 'Turn', value: `${r.turnSeconds} s to hold the seal` },
        { label: 'Hold', value: `${r.payMinutes} min to press PAY` },
        { label: 'Per tier', value: r.tierWindows.length ? h('span', { data: { testid: 'live-windows' } }, r.tierWindows.map(windowLine).join(' — ')) : 'The release’s for every tier' },
      ]),
      { id: 'live-part-turns', tools: edit('Edit', 'live-edit-turns', turnsPart) },
    ),
    section(
      'Add-ons',
      r.addons.length
        ? defList(r.addons.map((a): DefRow => ({ label: a.label, value: formatMoney(a.priceMinor, r.currency), note: a.line ?? undefined })))
        : h('p', { class: 'notice' }, 'None: PAY is the piece alone.'),
      { id: 'live-part-addons', tools: edit('Edit', 'live-edit-addons', addonsPart) },
    ),
    afterRoomSection,
  ];

  // The silhouette: its first staged reveal (without one, the seal stands in).
  const silhouette = () =>
    void photoDialog({
      title: 'Silhouette',
      eyebrow,
      impact: 'The first staged reveal on the release’s page and on the boutique board, from the silhouette’s time. Without one, the seal stands in.',
      current: r.silhouette?.url ?? null,
      currentAlt: 'The silhouette',
      save: async (photo) => {
        await ctx.api.setLiveSilhouette(r.id, photo);
      },
      remove: async () => {
        await ctx.api.removeLiveSilhouette(r.id);
      },
    }).then((v) => {
      if (!v) return;
      notify(v === 'saved' ? 'Silhouette saved.' : 'Silhouette removed.');
      ctx.reload();
    });
  parts.push(
    section('Silhouette', h('div', { class: 'live__silhouette', data: { testid: 'live-silhouette' } }, photoThumb(r.silhouette?.url ?? null, 'The silhouette', 'lg'), r.silhouette ? null : h('p', { class: 'notice' }, 'None: the seal stands in.')), {
      id: 'live-part-silhouette',
      tools: acts.edit ? [button(r.silhouette ? 'Change' : 'Add', { kind: 'ghost', testId: 'live-silhouette-edit', onClick: silhouette })] : [],
    }),
  );

  // The boutique board's secret link: shown once, when issued.
  const showLink = (url: string) =>
    void openDialog({
      title: 'The board’s link',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, 'Open it on the boutique’s screen. It is shown this once: the server keeps only its fingerprint. Anyone holding it sees the board (the countdown, the door, the pieces left), never a person.'),
        h('p', { class: 'live__link' }, mono(url, url)),
        h('div', { class: 'row-actions' }, copyButton(url, 'Copy the link')),
      ],
      confirmLabel: 'Done',
      cancelLabel: 'Close',
    }).then(() => ctx.reload());
  const issueLink = () =>
    void openDialog({
      title: r.boardLink ? 'Replace the board’s link' : 'Issue the board’s link',
      eyebrow,
      danger: r.boardLink !== null,
      body: h('p', { class: 'dialog__text' }, r.boardLink ? 'A new link replaces the one issued: a screen open on the old one goes blank at once.' : 'A secret link for a screen in a boutique or at an event: the board of the release, full screen, without any personal data.'),
      confirmLabel: r.boardLink ? 'Replace the link' : 'Issue the link',
      submit: async () => {
        const { url } = await ctx.api.issueLiveBoardLink(r.id);
        setTimeout(() => showLink(url), 0);
      },
    });
  const revokeLink = () =>
    void openDialog({
      title: 'Revoke the board’s link',
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text' }, 'The board answers that the release is not known from now on; a screen open on it goes blank at once.'),
      confirmLabel: 'Revoke',
      submit: async () => {
        await ctx.api.revokeLiveBoardLink(r.id);
      },
    }).then(done('Board link revoked.'));
  parts.push(
    section(
      'Boutique board',
      defList([{ label: 'Link', value: h('span', { data: { testid: 'live-board-link' } }, r.boardLink ? `Issued ${formatDateTime(r.boardLink.issuedAt)}` : 'None') }]),
      {
        id: 'live-part-board',
        tools: acts.boardLink
          ? [
              button(r.boardLink ? 'Replace' : 'Issue link', { kind: 'ghost', testId: 'live-board-issue', onClick: issueLink }),
              ...(r.boardLink ? [button('Revoke', { kind: 'ghost', testId: 'live-board-revoke', onClick: revokeLink })] : []),
            ]
          : [],
      },
    ),
  );

  // ── Publication ──────────────────────────────────────────────────────────
  const circleNote = `A note for the owners ${r.minTier >= 2 ? `from ${tierLabel(r.minTier)}` : 'of a piece'}, shown from the announcement: the room’s opening, the quantity line, the price and who may enter, never the piece’s name.`;
  // PUBLISH reads the feasibility check first and shows it: a warning per size, never a refusal (plan LIVE RELEASE+, K5).
  const publish = async () => {
    const check: LiveFeasibility | 'failed' = await ctx.api.liveFeasibility(r.id).catch(() => 'failed' as const);
    void openDialog({
      title: 'Publish the release',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, `It is announced ${r.announceAt ? `on ${formatDateTime(r.announceAt)}` : 'now'}, each stage at its time; the room opens on ${formatDateTime(r.roomOpensAt)}, T0 on ${formatDateTime(r.opensAt)}.`),
        h('p', { class: 'dialog__text' }, 'Its settings still change until the announcement; then only its stock rises (ADD PIECES).'),
        feasibilityBlock(ctx, r, check, () => ctx.api.liveFeasibility(r.id)),
      ],
      fields: [
        {
          name: 'circlePost',
          label: 'Post it in the circle',
          kind: 'checkbox',
          hint: `${circleNote} ${r.announceAt ? 'Added or withdrawn on this page until the announcement.' : 'Announced at once: the choice is final.'}`,
        },
      ],
      confirmLabel: 'Publish',
      submit: async (v) => {
        await ctx.api.publishLiveRelease(r.id, v.circlePost === 'true');
      },
    }).then(done('Release published.'));
  };
  // The release's post of the circle, once published: added or withdrawn until the announcement.
  const scheduledPost = r.circlePosts.some((p) => p.publishedAt !== null && Date.parse(p.publishedAt) > ctx.now().getTime());
  const circleToggle = () =>
    void openDialog({
      title: scheduledPost ? 'Withdraw the post' : 'Post it in the circle',
      eyebrow,
      body: h(
        'p',
        { class: 'dialog__text' },
        scheduledPost
          ? 'The post of the circle waiting for the announcement is withdrawn: the owners never read it. It can be posted again until the announcement.'
          : `${circleNote} The announcement: ${r.announceAt ? formatDateTime(r.announceAt) : 'at the publication'}.`,
      ),
      confirmLabel: scheduledPost ? 'Withdraw' : 'Post it',
      submit: async () => {
        if (scheduledPost) await ctx.api.withdrawLiveCircle(r.id);
        else await ctx.api.postLiveCircle(r.id);
      },
    }).then(done(scheduledPost ? 'Post withdrawn.' : 'Post scheduled for the announcement.'));
  const cancel = () =>
    void openDialog({
      title: 'Cancel the release',
      eyebrow,
      danger: true,
      body: h('p', { class: 'dialog__text' }, `${r.publishedAt ? 'Its page answers that the release is not known from now on, and a post of the circle not shown yet is withdrawn.' : 'The draft never shows.'} Nobody enters it.`),
      phrase: livePhrase('cancel', r),
      confirmLabel: 'Cancel release',
      cancelLabel: 'Keep it',
      submit: async () => {
        await ctx.api.cancelLiveRelease(r.id);
      },
    }).then(done('Release cancelled.'));

  const facts: DefRow[] = [
    { label: 'State', value: h('span', { data: { testid: 'live-state' } }, statusMark(liveStateLabel(r, parent !== null), toneOf('livePhase', r.phase))) },
    { label: 'Offer', value: r.set ? `${r.quantityLine} · ${formatMoney(r.priceMinor, r.currency)} the set · THE SET ${humanize(r.set.name)}` : `${r.quantityLine} · ${formatMoney(r.priceMinor, r.currency)} · ${sizesLine(r.sizes)}` },
    { label: parent ? 'Opened by the sell-out' : 'Published', value: r.publishedAt ? formatDateTime(r.publishedAt) : 'Not yet' },
    ...(r.circlePosts.length
      ? [{ label: 'Circle', value: h('span', { data: { testid: 'live-circle' } }, r.circlePosts.map((p) => (p.publishedAt ? `Post shown from ${formatDateTime(p.publishedAt)}` : 'Post withdrawn')).join(' · ')) }]
      : []),
    ...(r.cancelledAt ? [{ label: 'Cancelled', value: formatDateTime(r.cancelledAt) }] : []),
    ...(r.endedAt ? [{ label: 'Ended', value: `${formatDateTime(r.endedAt)} · ${liveStateLabel(r, parent !== null)}` }] : []),
    ...(Math.round(r.pausedMs / 1000) > 0 ? [{ label: 'Paused', value: `${formatCount(Math.round(r.pausedMs / 1000))} s in all` }] : []),
    { label: 'Created', value: `${formatDateTime(r.createdAt)}${r.createdBy ? ` · ${r.createdBy.email}` : ''}` },
    // An after-room has no interest, no seed of its own that orders anything (its line is its release's order), and no
    // public page: its guests read it through its release's.
    ...(parent
      ? []
      : [
          { label: 'Interest', value: `${formatCount(r.interest)} I’LL BE THERE` },
          { label: 'Seed fingerprint', value: mono(r.seedHash, groupChars(r.seedHash, 8)), note: 'SHA-256 of the seed that orders the line within a tier at T0; never revealed.' },
          ...(published ? [{ label: 'Page', value: h('a', { class: 'mono', attrs: { href: `/verify/releases/${r.id}`, target: '_blank', rel: 'noopener', 'data-testid': 'live-page' } }, `/verify/releases/${r.id}`) }] : []),
        ]),
  ];
  const releaseSection = section('Publication', defList(facts), {
    id: 'live-publication',
    tools: [
      acts.publish ? button('Publish', { kind: 'primary', testId: 'live-publish', onClick: () => void publish() }) : null,
      acts.circlePost ? button(scheduledPost ? 'Withdraw post' : 'Circle post', { kind: 'ghost', testId: scheduledPost ? 'live-circle-withdraw' : 'live-circle-post', onClick: circleToggle }) : null,
      acts.cancel ? button('Cancel', { kind: 'ghost', testId: 'live-cancel', onClick: cancel }) : null,
    ].filter((b): b is HTMLButtonElement => b !== null),
  });

  // An after-room's own page: what it offers, read only (its release sets it), what it takes from its release.
  const ownParts = parent
    ? [
        section(
          'The after-room',
          defList([
            { label: 'Of the release', value: h('a', { class: 'idlink', attrs: { href: href('liveRelease', { dropId: parent.id }), 'data-testid': 'live-after-room-of' } }, parent.title) },
            { label: 'Model', value: `${humanize(r.model.name)} · ${humanize(r.model.type)}` },
            { label: 'Price', value: h('span', { data: { testid: 'live-price' } }, `${formatMoney(r.priceMinor, r.currency)} a piece`) },
            { label: 'Sizes', value: h('span', { data: { testid: 'live-sizes' } }, sizesLine(r.sizes)) },
            { label: 'Add-ons', value: r.addons.length ? r.addons.map((x) => `${x.label} ${formatMoney(x.priceMinor, r.currency)}`).join(' · ') : 'None' },
            { label: 'Door', value: r.publishedAt ? `${formatDateTime(r.opensAt)} to ${formatDateTime(r.closesAt)}` : 'Opens only after the release’s sell-out' },
            { label: 'From the release', value: `${r.turnSeconds} s to hold the seal · ${r.payMinutes} min to press PAY · ${r.perAccount} ${r.perAccount === 1 ? 'piece' : 'pieces'} per person`, note: 'Its per-tier windows and its surprise too; no question after.' },
          ]),
          { id: 'live-part-after-room-own' },
        ),
      ]
    : parts;

  const readings = liveIntelligenceSections(ctx, r, intelligence, board);
  const best = bestTime ? [bestTimePanel(bestTime, { id: 'live-best-time' })] : [];
  // A set's release: each bot chooses a size per piece at random (no one size to choose for every bot).
  const testSection = tests ? testEntrantsSection(ctx, { mode: 'LIVE', dropId: r.id, eyebrow, start: liveTestStart(r), sizes: r.set ? [] : r.sizes, perAccount: r.perAccount }, tests) : null;
  const root = h(
    'div',
    { class: 'view view--live' },
    liveHeader(r),
    // An after-room has no campaign of its own: its sales are its release's.
    parent ? null : releaseTabs('liveRelease', r.id, 'release'),
    withServerPanel(
      [
        // Once published, the board leads, its test entrants under it, the intelligence of the release's stage after its
        // people; a draft opens on its publication, then its planner and forecast; the house's guarantees after them.
        ...(published ? [boardSection, testSection, entriesSection, servicesSection, ...readings, ...best, releaseSection] : [releaseSection, ...readings, ...best, testSection]),
        ...(parent ? [] : [guaranteesSection(guarantees.items, 'LIVE')]),
        h('div', { class: 'grid grid--2 live__parts' }, ...ownParts),
      ],
      serverStatusPanel(ctx),
    ),
  );

  if (board) {
    render(board, 'read');
    disposeLiveView();
    const follower: LiveFollower = new LiveFollower(ctx, r.id, (b, via) => {
      if (current === follower) render(b, via);
    });
    current = follower;
    follower.start(board);
  }
  return root;
}

/** A LIVE RELEASE's page header (an after-room's with the way to its release), on both tabs. */
function liveHeader(r: LiveRelease): HTMLElement {
  const parent = r.afterRoomOf;
  return pageHeader({
    eyebrow: 'Clients · Club · Drops',
    title: r.title,
    identifier: /\d/.test(r.title),
    lead: liveLead(r),
    actions: [...(parent ? [linkButton('The release', href('liveRelease', { dropId: parent.id }), 'ghost')] : []), linkButton('All drops', href('club', {}, { tab: 'drops' }), 'ghost')],
  });
}

/**
 * The CAMPAIGN tab (plan MACRO M1 §2.2): a release's name and photograph are public at the later of its NAME and PHOTO
 * stages. Null for an after-room, whose page then opens as ever.
 */
async function liveCampaignView(ctx: ViewContext, id: string): Promise<HTMLElement | null> {
  const asked = screens;
  const r = await ctx.api.liveRelease(id);
  if (r.afterRoomOf) return null;
  // A set's release: its pieces' names and photographs come with its campaign (its `offer`).
  const model = r.set ? null : await ctx.api.model(r.model.id).catch(() => null);
  if (asked !== screens) return h('div', { class: 'view view--live' });
  return h(
    'div',
    { class: 'view view--live view--campaign' },
    liveHeader(r),
    releaseTabs('liveRelease', r.id, 'campaign'),
    campaignTab(ctx, r.id, {
      mode: 'LIVE',
      opensAt: r.opensAt,
      published: r.publishedAt !== null,
      cancelled: r.cancelledAt !== null,
      publicAt: livePublicAt(r.stages),
      model: { name: model?.name ?? r.model.name, variant: model?.variantLabel ?? null, photo: model?.imageUrl ?? null },
    }),
  );
}

/**
 * The New live release dialog's fields: the essentials, the stock location (its default preselected) whose stock the
 * sizes are proposed from; every other setting by default, then edited on its page.
 */
export function newLiveFields(
  models: readonly Model[],
  values: Record<string, string>,
  locations: readonly { id: string; name: string; isDefault: boolean }[] = [],
  sets: readonly SetView[] = [],
): DialogField[] {
  const options = models.filter((m) => m.active).map((m) => ({ value: m.id, label: modelChoice(m) }));
  // Macro scope K44 T1: WHAT IT SELLS, A MODEL (as ever) or A SET; a set's price is the set's, its sizes per piece.
  const isSet = (v: Record<string, string>) => v.offer === 'SET';
  const piecesOf = (setId: string | undefined) => sets.find((x) => x.id === setId)?.pieces.length ?? 0;
  return [
    {
      name: 'offer',
      label: OFFER_TEXT.label,
      kind: 'select',
      required: true,
      options: [
        { value: 'MODEL', label: OFFER_TEXT.model },
        { value: 'SET', label: OFFER_TEXT.set },
      ],
      value: values.offer ?? 'MODEL',
    },
    { name: 'modelId', label: 'Model', kind: 'select', required: true, options: [{ value: '', label: 'Choose a model' }, ...options], value: values.modelId, shown: (v) => !isSet(v) },
    { name: 'setId', label: 'Set', kind: 'select', required: true, options: [{ value: '', label: OFFER_TEXT.chooseSet }, ...setOptions(sets, values.setId ?? '')], value: values.setId ?? '', hint: sets.length ? undefined : OFFER_TEXT.noSet, shown: isSet },
    { name: 'title', label: 'Title', required: true, maxlength: LIVE_LIMITS.title, value: values.title, hint: 'Revealed with the name’s stage.' },
    { name: 'opensAt', label: 'Opening (UTC)', kind: 'datetime', required: true, value: values.opensAt, hint: 'T0: the door opens and the line forms; the room opens 5 minutes before (changed on its page).' },
    { name: 'closesAt', label: 'End of the sales (UTC)', kind: 'datetime', required: true, value: values.closesAt },
    // D1: every release has a pace and a hold after the opening (0: none).
    { name: 'paceBatch', label: 'People per batch', required: true, maxlength: 4, value: values.paceBatch ?? '', hint: `${formatCount(LIVE_LIMITS.pace.batch.min)} to ${formatCount(LIVE_LIMITS.pace.batch.max)} turns per batch, in the line’s order, where a piece is free.` },
    { name: 'paceMinutes', label: 'Every (minutes)', required: true, maxlength: 2, value: values.paceMinutes ?? '', hint: `${LIVE_LIMITS.pace.minutes.min} to ${LIVE_LIMITS.pace.minutes.max}.` },
    { name: 'holdMinutes', label: figureLabel(LIVE_HOLD_LABEL), required: true, maxlength: 3, value: values.holdMinutes ?? '0', hint: `Up to ${LIVE_LIMITS.hold.max}: everyone waits it before the first batch.` },
    { name: 'price', label: 'Price of a piece', required: true, maxlength: 12, value: values.price, hint: 'In units: 4800, or 4800.50.', shown: (v) => !isSet(v) },
    { name: 'priceSet', label: 'Price of the set', required: true, maxlength: 12, value: values.priceSet ?? '', hint: 'One price for the set, in units: 4800, or 4800.50; shared over its pieces’ orders.', shown: isSet },
    { name: 'currency', label: 'Currency', kind: 'select', options: LIVE_CURRENCIES.map((c) => ({ value: c, label: c })), value: values.currency },
    {
      name: 'locationId',
      label: 'Stock location',
      kind: 'select',
      options: locationOptions(locations, values.locationId ?? ''),
      value: values.locationId ?? '',
      hint: 'Where its orders hold a piece in stock, or wait for one; the sizes are proposed from its stock.',
    },
    { name: 'sizes', label: 'Sizes', kind: 'textarea', rows: 4, required: true, value: values.sizes, hint: 'One size per line, its label then its stock: 52 = 3. Proposed from the stock, then the planner, once the model is chosen: yours to change.', shown: (v) => !isSet(v) },
    // A set's sizes, one field per piece (named by its model once the set is chosen), proposed per piece.
    ...[1, 2, 3, 4].map((k) => ({
      name: liveSizesField(k),
      label: `Sizes · piece ${k}`,
      kind: 'textarea' as const,
      rows: 3,
      required: true,
      value: values[liveSizesField(k)] ?? '',
      hint: 'This piece’s sizes, one per line, its label then its stock: 52 = 3. Proposed per piece once the set is chosen: yours to change.',
      shown: (v: Record<string, string>) => isSet(v) && piecesOf(v.setId) >= k,
    })),
  ];
}
