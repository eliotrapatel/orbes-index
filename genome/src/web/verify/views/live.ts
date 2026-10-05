/**
 * A LIVE RELEASE's page (plan of 2026-10-04, The experience; mockups B1–B7, the VAULT look): /verify/releases/<id>,
 * which becomes, as the release advances, its room, its line, the turn, the piece secured and the reservation confirmed.
 *
 *   announced   LIVE RELEASE · the piece on its plate (photograph, else silhouette, else the seal) · its name, price ·
 *               SEE THE MODEL from the photograph's stage, when the model's sheet is public ·
 *               OPENS IN dd:hh:mm or hh:mm:ss · the time in Paris, then on this phone · the rule, the quantity line and
 *               the limit per collector, when the room opens · THE REVEALS still to come, each with its time (each stage
 *               appears at its own, the page reading the release again then) · N COLLECTORS WILL BE THERE · I'LL BE
 *               THERE with a size for an account the rule lets in (another size changes it, WITHDRAW until T0); signed
 *               out, the sign-in under it; outside the rule, the rule and why · ADD TO CALENDAR · how the places are drawn
 *   room        THE ROOM IS OPEN · the model, its price and the quantity line (SEE THE MODEL, as announced, until T0) ·
 *               the closed vault door, its lock the seal ·
 *               the countdown on ORBES time · N IN THE ROOM · READY CHECK · YOUR SIZE (the size of I'LL BE THERE
 *               preselected) · ENTER THE ROOM, then YOU'RE READY.
 *               The last minute the seal's orbits turn back into alignment, the last ten seconds tick (P-D07's
 *               sound, its preference); at T0, on the server's second, the lock aligns, the door opens and the piece
 *               appears under a light sweep: DRAWING THE PLACES
 *   join        after T0, an account not in the line: the piece, its size, ENTER THE LINE (behind those in it)
 *   line        YOUR PLACE, who is ahead in your size, the pieces left overall and in your size, the held pieces
 *               that may return; sold out in your size: stay in case one returns, or LEAVE THE LINE
 *   turn        PRESS AND HOLD THE SEAL: the turn's ring runs out, the hold's ring fills in 1.5 s, letting go
 *               resets it; the space bar or Enter holds it from the keyboard; a short vibration where allowed
 *   secured     the reveal: the seal's GENOME glyphs with P-D01's ceremony motion, the seal's glow, the chord and the
 *               vibration; then the piece, its size, the add-ons, PAY · total, 5:00 to confirm, RELEASE MY PLACE
 *   confirmed   out into the light: the page turns ivory (house style), the reservation, its reference, ORBES Client
 *               Services
 *   edge pages  not signed in (the sign-in), not eligible, turn passed, hold ended, place released, left, removed,
 *               the release ended, gone: a vault page with one action each
 *   past        plan LIVE RELEASE+ (decision 30): ended, the page in its final state, as THE RELEASES' PAST opens it:
 *               LIVE RELEASE · the piece on its plate · its name and line · SEE THE MODEL · THIS RELEASE IS OVER · its
 *               opening date and quantity line as announced · signed in, YOU TOOK PART or YOU SECURED A PIECE · its
 *               description · THE RELEASES. Never an end figure, nor how the account's entry ended (a guest of the
 *               after-room keeps the second door until it closes). For a week after the end, to an account that took
 *               part without a piece, ONE QUESTION, the question after (plan LIVE RELEASE+, choice 11; views/question.ts),
 *               here only: it opens at the release's final end (its after-room's, when one opened), never before
 *   after-room  plan LIVE RELEASE+ (choice 2): still in the line when the release sold out, its delay later, the
 *               second door in the same vault (THE AFTER-ROOM · A SECOND DOOR, the door and its lock, when it closes,
 *               ENTER THE AFTER-ROOM); the account's own entry says when it appears (`afterRoom`, its stream's last
 *               event), the page's pulse shows it then. The after-room's own page is this page with its sheet
 *               (`afterRoom`, read through the release it follows): THE AFTER-ROOM over its screens, your place from
 *               the line, then the turn, the hold, the add-ons and PAY as in the main room
 *
 * Real time: the stream (EventSource, `room` and `you` events) while it is open; its state polled every 2 s while it
 * is not (LIVE_POLL_MS), the stream tried again later. Every countdown counts on the server's clock, synced by three
 * round trips (clockOffset). Every action is a same-origin JSON call through ApiClient (the session, the CSRF token);
 * the server's refusals read as it wrote them. Reduced motion: cross-fades only. aria-live: the place, the turn, the
 * piece secured. One primary action per screen (filled ivory): ENTER, the size chosen, PAY.
 */
import { bracket } from '../../shared/corners.js';
import { h, prefersReducedMotion, s } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { LIVE, RELEASES } from '../copy.js';
import {
  addonChoices,
  aheadLine,
  clockOffset,
  clockText,
  CLOCK_SAMPLES,
  countdown,
  formatMoney,
  heldEntry,
  HOLD_MS,
  initialSize,
  interestLine,
  isEndedSheet,
  lineFacts,
  liveReference,
  liveScreen,
  liveSheetModel,
  livePastModel,
  lockAngle,
  placeAnnouncement,
  PRESS_GAP_MS,
  readyChecks,
  revealCalendar,
  roomSize,
  servable,
  sizeChoices,
  tickSecond,
  windowLeft,
  zonedTime,
  type ClockSample,
  type LivePicture,
  type LiveScreenKind,
  type LiveViewer,
} from '../live-model.js';
import { sealSvg, turnRings } from '../live-seal.js';
import { participationModel } from '../releases-model.js';
import type { SessionStore } from '../session.js';
import type { SoundSignature } from '../sound.js';
import type { AccountQuestion, ClientServices, LiveAccess, LiveEndedSheet, LiveEntry, LiveInterest, LiveRoom, LiveSheet, LiveState } from '../types.js';
import { releaseContactModel, upper } from '../view-model.js';
import { contactBlock, legalLinks, lookbookLink, piecesLink, releasesLink, soundToggle, toneMark, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { OwnershipPanel } from './ownership.js';
import { QuestionBlock } from './question.js';
import { CEREMONY_VIBRATION } from './result.js';

/** The state read while the stream is lost. */
export const LIVE_POLL_MS = 2000;
/** A stream refused or closed is asked for again after this long (the state is polled meanwhile). */
export const LIVE_STREAM_RETRY_MS = 15_000;
/** The page's own pulse: the countdowns, the lock, the ticks. */
const PULSE_MS = 250;
/** The opening at T0 (the lock aligning, the door, the sweep) plays this long before the line takes its place. */
export const OPENING_MS = 2800;
/** The lock clicks into alignment, then the door opens. */
const DOOR_DELAY_MS = 420;
/** RELEASE MY PLACE and LEAVE THE LINE wait this long for their second tap. */
const ARMED_MS = 4000;
/** A sync that failed is tried again after this long. */
const SYNC_RETRY_MS = 10_000;
/** The outer ring of the seal button (r 128) and the hold's ring (r 116), as the mockup draws them. */
const TURN_RING = 2 * Math.PI * 128;
const HOLD_RING = 2 * Math.PI * 116;

/** The entry statuses after which nothing changes for the account: the page stops following the room. */
const FINAL = new Set(['CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'REMOVED', 'ENDED']);
/** The entry statuses still open while the release runs: a room over with one of them has not said its last word. */
const OPEN = new Set(['WAITING', 'QUEUED', 'TURN', 'SECURED']);

export interface LiveView {
  root: HTMLElement;
  dispose(): void;
}

export interface LiveDeps {
  api: ApiClient;
  session: SessionStore;
  /** P-D07's sound: the ticks and the chord, its preference (SOUND ON / OFF). */
  sound: Pick<SoundSignature, 'on' | 'set' | 'prime' | 'tick' | 'play'>;
  /** The release's page as read; null when it could not be read (`failure` says why). */
  sheet: LiveSheet | LiveEndedSheet | null;
  failure?: string;
  /** Read the release again (TRY AGAIN). */
  onRetry(): void;
  onReleases(): void;
  onPieces(): void;
  onScan(): void;
  /** SEE THE MODEL: the model's sheet in the lookbook (`/verify/lookbook/<slug>`), from the photograph's stage. */
  onModel(slug: string): void;
  /** ENTER THE AFTER-ROOM: the after-room of release `parentId` (the second door). */
  onAfterRoom(parentId: string): void;
  clientServices(): Promise<ClientServices>;
  /** This phone's time zone (Intl), the second clock of the release's times. */
  localZone: string;
}

export function liveView(deps: LiveDeps): LiveView {
  const page = new LivePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** A screen of the page: its element, refreshed in place at every change of the room or the clock. */
interface Screen {
  kind: LiveScreenKind | 'failed';
  el: HTMLElement;
  /** The element focused when the screen appears (its title by default). */
  focus?: HTMLElement;
  /** Its one action is THE RELEASES. */
  back?: boolean;
  update(): void;
  dispose?(): void;
}

/** The hold of the seal under way. */
interface Hold {
  started: number;
  /** When the server answered the press (performance.now), null until it has. */
  pressedAt: number | null;
  sent: boolean;
  frame: number;
}

const isApi = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

class LivePage {
  readonly root: HTMLElement;
  private readonly notice = h('div', { class: 'live__notice', attrs: { 'aria-live': 'polite' } });
  private readonly stage = h('div', { class: 'live__stage' });
  private readonly foot = h('footer', { class: 'live__foot' });
  private readonly polite = h('p', { class: 'visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
  private readonly assertive = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'assertive' } });
  private sheet: LiveSheet | LiveEndedSheet | null;
  private room: LiveRoom | null = null;
  private entry: LiveEntry | null = null;
  private access: LiveAccess | null = null;
  private interest: LiveInterest | null = null;
  private viewer: LiveViewer = 'unknown';
  /** The read of the state under way, if any. */
  private reading: Promise<void> | null = null;
  /** The room said it is over while the entry this page holds was still open: the state was read once more. */
  private overRead = false;
  private refusal: string | null = null;
  /** The release no longer answers (cancelled, unpublished): it is over for this page. */
  private gone = false;
  private offset: number | null = null;
  private synced = false;
  private connection: 'live' | 'reconnecting' = 'reconnecting';
  private stream: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private screen: Screen | null = null;
  private signIn: OwnershipPanel | null = null;
  /** The sign-in under I'LL BE THERE on the announced page, once asked for (signed out). */
  private thereSignIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private contacts: ClientServices = {};
  private busy = false;
  private error: string | null = null;
  /** The size and quantity picked before entering (the entry's own once entered). */
  private picked: { sizeId: string | null; quantity: number } = { sizeId: null, quantity: 1 };
  /** The opening at T0 under way on this screen: when it began (performance.now), null otherwise. */
  private opening: number | null = null;
  /** The turn just came, and a size's pieces were all held before it: a piece has returned. */
  private returned = false;
  /** A room seen while the entry waited in the line had no piece free in its size. */
  private sizeWasFull = false;
  /** The secure was sent from this page's seal, for the turn under way. */
  private securing = false;
  /** The piece was secured on this page: the secured screen opens with the reveal (consumed when it mounts). */
  private reveal = false;
  private hold: Hold | null = null;
  /** RELEASE MY PLACE or LEAVE THE LINE armed for its second tap until this time (performance.now). */
  private armedUntil = 0;
  private lastTick: number | null = null;
  private lastPlace: string | null = null;
  private frozenTurn: number | null = null;
  /** The hold's time left when a pause began: it stands still until the pause ends. */
  private frozenHold: number | null = null;
  /** How many of the stage times and the room's opening had passed at the last pulse. */
  private stagesDue: number | null = null;
  /** Over: the account's part in the release (YOU TOOK PART, YOU SECURED A PIECE), read once signed in; null for none. */
  private part: string | null = null;
  private partRead: 'idle' | 'reading' | 'done' = 'idle';
  private partGen = 0;
  /** Ended: the question after (plan LIVE RELEASE+, choice 11), read once signed in; null when it is not asked of the account here. */
  private question: AccountQuestion | null = null;
  private questionRead: 'idle' | 'reading' | 'done' = 'idle';
  private questionGen = 0;
  private disposed = false;

  constructor(private readonly deps: LiveDeps) {
    this.root = viewRoot('live', 'live-title');
    this.root.classList.add('vault');
    this.sheet = deps.sheet;
    this.root.append(
      h('header', { class: 'live__head' }, h('span', { class: 'wordmark wordmark--small live__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }), this.notice),
      this.stage,
      this.foot,
      this.polite,
      this.assertive,
    );
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    void deps.clientServices().then((c) => {
      this.contacts = c;
      if (this.screen?.kind === 'confirmed' || this.screen?.kind === 'removed') this.rebuild();
    });
    this.render();
    if (this.sheet) void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signIn?.dispose();
    this.signIn = null;
    this.thereSignIn?.dispose();
    this.thereSignIn = null;
    this.endHold(true);
    this.closeStream();
    this.stopPolling();
    for (const t of [this.retryTimer, this.syncTimer]) if (t) clearTimeout(t);
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.screen?.dispose?.();
  }

  // ── Time ─────────────────────────────────────────────────────────────────

  /** The server's time now (ms): this device's clock and the synced offset. */
  private now(): number {
    return Date.now() + (this.offset ?? 0);
  }

  /** Three round trips to the server's clock; the offset of the shortest. Tried again later when it fails. */
  private async syncClock(): Promise<void> {
    const samples: ClockSample[] = [];
    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      try {
        const sentAt = Date.now();
        const server = Date.parse(await this.deps.api.liveClock());
        samples.push({ sentAt, receivedAt: Date.now(), server });
      } catch {
        break;
      }
      if (this.disposed) return;
    }
    const best = clockOffset(samples);
    if (best && samples.length === CLOCK_SAMPLES) {
      this.offset = best.offset;
      this.synced = true;
    } else {
      this.syncTimer = setTimeout(() => void this.syncClock(), SYNC_RETRY_MS);
    }
    this.screen?.update();
  }

  // ── The release and the account ──────────────────────────────────────────

  private async start(): Promise<void> {
    void this.syncClock();
    this.pulseTimer = setInterval(() => this.pulse(), PULSE_MS);
    await this.deps.session.ensure().catch(() => undefined);
    if (!this.disposed) this.onSession();
  }

  /**
   * The session changed: the account's standing follows. Announced, it is read once (I'LL BE THERE, or the rule and why);
   * from the room's opening, it is followed (the stream, or the polling while it is lost).
   */
  private onSession(): void {
    if (this.disposed || !this.sheet) return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      this.signIn?.dispose();
      this.signIn = null;
      this.thereSignIn?.dispose();
      this.thereSignIn = null;
      if (this.viewer !== 'ready') void this.readState(this.roomTime());
    } else if (s.status === 'anonymous') {
      this.viewer = 'signed-out';
      this.entry = null;
      this.access = null;
      this.partGen++;
      this.part = null;
      this.partRead = 'idle';
      this.questionGen++;
      this.question = null;
      this.questionRead = 'idle';
      this.closeStream();
      this.stopPolling();
    }
    this.render();
  }

  /** Whether the room is open (or the release over), when the account's standing matters. */
  private roomTime(): boolean {
    const sheet = this.sheet;
    if (!sheet) return false;
    return isEndedSheet(sheet) || this.now() >= Date.parse(this.room?.roomOpensAt ?? sheet.roomOpensAt);
  }

  /** The room and the account's own standing; `follow`: then the stream (or the polling while it is lost). One read at a time. */
  private readState(follow: boolean): Promise<void> {
    if (this.reading) return this.reading.then(() => (follow && this.viewer === 'ready' ? this.follow() : undefined));
    this.reading = this.read(follow).finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async read(follow: boolean): Promise<void> {
    if (!this.sheet) return;
    try {
      const state = await this.deps.api.liveState(this.sheet.id);
      if (this.disposed) return;
      this.apply(state);
      if (follow) this.follow();
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.status === 401) this.viewer = 'signed-out';
      else if (isApi(e, 'LIVE_NOT_ELIGIBLE')) {
        this.viewer = 'not-eligible';
        this.refusal = e instanceof ApiError ? e.message : null;
        this.closeStream();
        this.stopPolling();
      } else if (e instanceof ApiError && e.status === 404) {
        this.gone = true;
        this.closeStream();
        this.stopPolling();
      } else {
        // Unreachable for now: the polling goes on (or starts) and the page keeps what it showed.
        this.connection = 'reconnecting';
        if (follow) this.startPolling();
      }
    }
    this.render();
  }

  private apply(state: LiveState): void {
    if (!this.synced) this.offset = Date.parse(state.now) - Date.now();
    this.viewer = 'ready';
    this.refusal = null;
    this.access = state.access;
    this.interest = state.interest;
    this.setRoom(state.room);
    this.setEntry(state.entry);
    this.settle();
  }

  /** The release is an after-room: its page is read through the release it follows. */
  private afterRoomOf(): string | null {
    return this.sheet?.afterRoom?.parentId ?? null;
  }

  /**
   * `streamed`: the room of a stream, whose chunks bring the account's own entry before the room, so the entry held is
   * at least as recent as this room; a state read brings the room before its entry is applied.
   */
  private setRoom(room: LiveRoom, streamed = false): void {
    // A room seen while waiting in the line with no piece free in the size: a turn that comes later is a piece that has
    // returned. Judged on the room before this one (a state read's room may already hold the account's own turn) and,
    // streamed, on this one too (the entry, read first, says it is still in the line at this room).
    const e = this.entry;
    if (e?.status === 'QUEUED') {
      const full = (r: LiveRoom | null) => {
        const size = roomSize(r, e.size.id);
        return size !== null && size.left < e.quantity;
      };
      if (full(this.room) || (streamed && full(room))) this.sizeWasFull = true;
    }
    this.room = room;
  }

  private setEntry(entry: LiveEntry | null): void {
    const before = this.entry?.status;
    if (entry?.status === 'TURN' && before !== 'TURN') this.returned = this.sizeWasFull;
    // The reveal on the transition itself, whichever brings it first (the secure's answer, the stream, a poll).
    if (before === 'TURN' && entry?.status === 'SECURED' && this.securing) this.reveal = true;
    if (entry?.status !== 'TURN') this.securing = false;
    if (entry?.status !== 'QUEUED' && entry?.status !== 'TURN') this.sizeWasFull = false;
    this.entry = entry;
    const held = heldEntry(entry);
    if (held) this.picked = { sizeId: held.size.id, quantity: held.quantity };
    else if (this.picked.sizeId === null && this.sheet && !isEndedSheet(this.sheet)) this.picked = { sizeId: initialSize(this.sheet, entry, this.interest), quantity: this.picked.quantity };
  }

  /**
   * After the room or the entry changed: the following stops once nothing will change. A room over while the entry
   * shown is still open means its last change was not seen: the following stops and the state is read once more (after
   * a read already under way, which may predate the end), so the page shows how the release ended for the account.
   */
  private settle(): void {
    if (this.done()) {
      this.closeStream();
      this.stopPolling();
    } else if (this.room?.over === true && !this.overRead) {
      this.overRead = true;
      this.closeStream();
      this.stopPolling();
      void (this.reading ?? Promise.resolve()).then(() => this.readState(false));
    }
  }

  // ── Real time ────────────────────────────────────────────────────────────

  /** Follow the room: its stream, or its state every LIVE_POLL_MS while the stream is lost. */
  private follow(): void {
    if (this.disposed || this.viewer !== 'ready' || this.done()) return;
    if (this.stream) return;
    if (typeof EventSource !== 'function' || !this.sheet) {
      this.startPolling();
      return;
    }
    const es = new EventSource(this.deps.api.liveStreamUrl(this.sheet.id));
    this.stream = es;
    es.addEventListener('open', () => {
      if (this.stream !== es) return;
      this.connection = 'live';
      this.stopPolling();
      this.screen?.update();
    });
    es.addEventListener('room', (ev) => {
      const data = parse<LiveRoom & { now: string }>(ev);
      if (!data || this.stream !== es) return;
      this.setRoom(data, true);
      this.settle();
      this.render();
    });
    es.addEventListener('you', (ev) => {
      const data = parse<{ now: string; entry: LiveEntry | null }>(ev);
      if (!data || this.stream !== es) return;
      this.setEntry(data.entry);
      this.settle();
      this.render();
    });
    es.addEventListener('error', () => {
      if (this.stream !== es) return;
      this.connection = 'reconnecting';
      // The browser reconnects by itself (CONNECTING); a refusal or the end (CLOSED) is asked for again later.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        this.stream = null;
        if (!this.done()) this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.follow();
        }, LIVE_STREAM_RETRY_MS);
      }
      this.startPolling();
      this.screen?.update();
    });
  }

  /**
   * Nothing will change for this page any more: the release over (with no open entry shown, or once read again after
   * it), or the account's entry final. An entry ENDED is final once the room says why (the room and the entries are
   * read apart: the reason may come a frame after the entry).
   */
  private done(): boolean {
    const e = this.entry;
    const final = e !== null && FINAL.has(e.status) && (e.status !== 'ENDED' || !!this.room?.endedReason);
    const over = this.room?.over === true && (this.overRead || !(e && OPEN.has(e.status)));
    return this.gone || over || final || this.viewer === 'not-eligible';
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPolling(): void {
    if (this.pollTimer || this.done()) return;
    this.pollTimer = setInterval(() => void this.readState(false), LIVE_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** The page's pulse: the room's opening, the stages, the countdowns, the lock and its ticks. */
  private pulse(): void {
    if (this.disposed || !this.sheet) return;
    const sheet = this.sheet;
    if (!isEndedSheet(sheet)) {
      // A stage revealed, or the room opened, while the page is open: the release read again (every stage is revealed
      // when the room opens), then, signed in, the account's standing and the stream.
      const now = this.now();
      const due = [sheet.stages.silhouetteAt, sheet.stages.nameAt, sheet.stages.photoAt, sheet.roomOpensAt].filter((t) => Date.parse(t) <= now).length;
      if (this.stagesDue !== null && due !== this.stagesDue) {
        void this.refreshSheet().then(() => {
          // The room open: the account's standing read again (it may have changed since the announcement), then followed.
          const following = this.stream !== null || this.pollTimer !== null;
          if (!following && this.roomTime() && this.deps.session.state.status === 'signed-in') void this.readState(true);
        });
      }
      this.stagesDue = due;
    }
    if (this.armedUntil && performance.now() > this.armedUntil) {
      this.armedUntil = 0;
      this.screen?.update();
    }
    this.render();
  }

  private async refreshSheet(): Promise<void> {
    if (!this.sheet) return;
    try {
      const parent = this.afterRoomOf();
      const sheet = parent ? await this.deps.api.liveAfterRoom(parent) : await this.deps.api.liveRelease(this.sheet.id);
      if (this.disposed) return;
      this.sheet = sheet;
      if (this.screen && this.screen.kind !== 'turn') this.rebuild();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) this.gone = true;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private kind(): LiveScreenKind | 'failed' {
    const sheet = this.sheet;
    if (!sheet) return 'failed';
    if (this.gone) return 'over';
    const kind = liveScreen({ sheet, viewer: this.viewer, room: this.room, entry: this.entry, now: this.now() });
    // The opening at T0 plays to its end before the line (or the late arrivals' size) takes its place.
    if (this.screen?.kind === 'room' && (kind === 'line' || kind === 'turn' || kind === 'join' || kind === 'soldOut' || kind === 'room')) {
      if (this.opening === null || performance.now() - this.opening < OPENING_MS) return 'room';
    }
    return kind;
  }

  private render(): void {
    if (this.disposed) return;
    const kind = this.kind();
    if (!this.screen || this.screen.kind !== kind) this.mount(kind);
    else this.screen.update();
    this.renderNotice();
  }

  /** Build the screen again (the release read again, the contact arrived). */
  private rebuild(): void {
    if (this.screen) this.mount(this.screen.kind);
  }

  private mount(kind: LiveScreenKind | 'failed'): void {
    const hadFocus = this.root.contains(document.activeElement) || document.activeElement === document.body;
    const previous = this.screen?.kind;
    this.screen?.dispose?.();
    this.error = previous === kind ? this.error : null;
    const revealing = kind === 'secured' && this.reveal;
    this.reveal = false;
    const screen = this.build(kind, revealing);
    this.screen = screen;
    screen.el.classList.add('live__screen');
    this.stage.replaceChildren(screen.el);
    this.root.dataset.screen = kind;
    // Out into the light: CONFIRMED in the ivory house style; every other screen in the vault.
    this.root.classList.toggle('vault', kind !== 'confirmed');
    this.root.classList.toggle('is-light', kind === 'confirmed');
    this.renderFoot(screen);
    screen.update();
    if (previous !== undefined && hadFocus) (screen.focus ?? screen.el.querySelector<HTMLElement>('h1'))?.focus({ preventScroll: kind !== 'turn' });
    if (kind !== previous && kind === 'turn') this.say(this.returned ? LIVE.announce.returned : LIVE.announce.turn, true);
    if (kind !== previous && revealing) this.say(LIVE.announce.secured(this.name()));
    if (kind !== previous && kind === 'afterRoom') this.say(LIVE.afterRoom.announce);
  }

  private say(text: string, urgent = false): void {
    const region = urgent ? this.assertive : this.polite;
    region.textContent = '';
    // A new text node in a cleared region is announced even when the words repeat.
    requestAnimationFrame(() => {
      region.textContent = text;
    });
  }

  /** The host message and the pause, under the header, on the screens of the room and the line. */
  private renderNotice(): void {
    const kind = this.screen?.kind;
    const live = kind === 'room' || kind === 'join' || kind === 'line' || kind === 'soldOut' || kind === 'turn' || kind === 'secured';
    const room = this.room;
    const parts: HTMLElement[] = [];
    if (live && room?.paused) parts.push(h('p', { class: 'live__paused' }, h('span', { class: 'live__notice-label', text: LIVE.paused }), h('span', { class: 'live__notice-text', text: LIVE.pausedLine })));
    if (live && room?.message) parts.push(h('p', { class: 'live__message' }, h('span', { class: 'live__notice-label', text: LIVE.message }), h('span', { class: 'live__notice-text', text: room.message.text })));
    const key = parts.map((p) => p.textContent).join('|');
    if (this.notice.dataset.key === key) return;
    this.notice.dataset.key = key;
    this.notice.replaceChildren(...parts);
  }

  private renderFoot(screen: Screen): void {
    const kind = screen.kind;
    // A page whose one action is THE RELEASES: the foot does not say it twice.
    const back = screen.back ? null : releasesLink(() => this.deps.onReleases(), { extraClass: 'live__releases' });
    const sound = kind === 'confirmed' ? null : soundToggle(this.deps.sound, 'live__sound');
    this.foot.replaceChildren(...[back, sound, legalLinks({ extraClass: 'live__legal' })].filter((x): x is HTMLElement => x !== null));
  }

  private build(kind: LiveScreenKind | 'failed', revealing = false): Screen {
    switch (kind) {
      case 'failed':
        return this.failedScreen();
      case 'loading':
        return { kind, el: h('section', { class: 'live__waiting' }, h('h1', { class: 'visually-hidden', id: 'live-title', text: LIVE.kind }), h('p', { class: 'micro soft', attrs: { 'aria-busy': 'true' }, text: LIVE.loading })), update: () => undefined };
      case 'announced':
        return this.announcedScreen();
      case 'signin':
        return this.signInScreen();
      case 'notEligible':
        return this.notEligibleScreen();
      case 'room':
        return this.roomScreen();
      case 'join':
        return this.joinScreen();
      case 'line':
        return this.lineScreen();
      case 'soldOut':
        return this.soldOutScreen();
      case 'turn':
        return this.turnScreen();
      case 'secured':
        return this.securedScreen(revealing);
      case 'confirmed':
        return this.confirmedScreen();
      case 'afterRoom':
        return this.afterRoomScreen();
      case 'past':
        return this.pastScreen();
      default:
        return this.edgeScreen(kind);
    }
  }

  // ── Parts ────────────────────────────────────────────────────────────────

  /** Over the screens of a release that is live: LIVE NOW, or THE AFTER-ROOM. */
  private liveLine(): string {
    return this.afterRoomOf() ? LIVE.afterRoom.kind : LIVE.phase.LIVE;
  }

  private live(): LiveSheet | null {
    return this.sheet && !isEndedSheet(this.sheet) ? this.sheet : null;
  }

  private name(): string {
    const s = this.live();
    return s?.name ? upper(s.name) : LIVE.kind;
  }

  private title(text: string): HTMLHeadingElement {
    return h('h1', { class: 'live__title', id: 'live-title', attrs: { tabindex: '-1' } }, ...withNumerals(text));
  }

  private overline(text: string): HTMLParagraphElement {
    return h('p', { class: 'live__overline' }, ...withNumerals(text));
  }

  /** A line of tracked capitals in the display face, its figures in the reading face. */
  private fact(text: string, extra = ''): HTMLParagraphElement {
    return h('p', { class: ['live__fact', extra] }, ...withNumerals(text));
  }

  /** A SURPRISE IN EVERY BOX: a vault label between two hairlines, when the release has one (what it is stays unsaid). */
  private surprise(label: string | null): HTMLParagraphElement | null {
    return label ? h('p', { class: 'live__surprise', text: label }) : null;
  }

  private note(text: string, extra = ''): HTMLParagraphElement {
    return h('p', { class: ['live__note', extra], text });
  }

  /** The piece on a plate: its photograph, else its silhouette, else the seal; a picture that fails takes the seal's place. */
  private piece(picture: LivePicture | null, extra: string, sweep = false): HTMLElement {
    const plate = h('div', { class: ['live__plate', extra] });
    const seal = () => sealSvg('live__plate-seal');
    if (picture) {
      const img = h('img', { class: ['live__img', `live__img--${picture.kind}`], attrs: { src: picture.src, alt: picture.alt, decoding: 'async' } });
      img.addEventListener('error', () => img.replaceWith(seal()), { once: true });
      plate.append(img);
      if (sweep) {
        // The light sweep: a band of light across the piece, masked to its own shape (CSSOM: the picture's address).
        const light = h('span', { class: 'live__sweep', attrs: { 'aria-hidden': 'true' } });
        light.style.setProperty('--piece', `url("${picture.src}")`);
        plate.append(light);
      }
    } else plate.append(seal());
    return bracket(plate);
  }

  /** SEE THE MODEL, once the photograph is revealed and the model's sheet is public; else nothing. */
  private seeModel(slug: string | null): HTMLAnchorElement | null {
    return slug ? lookbookLink(() => this.deps.onModel(slug), { slug, extraClass: 'live__see-model' }) : null;
  }

  private hairline(): HTMLElement {
    return h('hr', { class: 'live__rule' });
  }

  private errorLine(): HTMLParagraphElement {
    return h('p', { class: 'form__error live__error', attrs: { role: 'alert', hidden: true } });
  }

  private showError(line: HTMLParagraphElement): void {
    line.textContent = this.error ?? '';
    line.hidden = this.error === null;
  }

  /** The action of an edge page: a hairline button. */
  private action(text: string, onClick: () => void, extra = ''): HTMLButtonElement {
    return h('button', { class: ['btn', 'live__action', extra], attrs: { type: 'button' }, on: { click: onClick }, text });
  }

  /** Run one action of the account: busy meanwhile, its answer (the entry) applied, a refusal said as the server wrote it. */
  private async act(run: () => Promise<LiveEntry>, after?: (e: LiveEntry) => void): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.screen?.update();
    try {
      const entry = await run();
      if (this.disposed) return;
      this.setEntry(entry);
      this.settle();
      after?.(entry);
      if (!this.stream) this.follow();
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.error = messageOf(e);
      // The room has moved on (a turn passed, the size locked, the release over): read it again.
      if (e instanceof ApiError && e.status === 409) void this.readState(false);
    } finally {
      this.busy = false;
    }
    this.render();
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  private failedScreen(): Screen {
    const el = h(
      'section',
      { class: 'live__edge' },
      this.overline(LIVE.kind),
      this.title(LIVE.kind),
      h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${LIVE.loadFailed} ${this.deps.failure ?? ''}`.trim() }),
      this.action(LIVE.retry, () => this.deps.onRetry()),
    );
    return { kind: 'failed', el, update: () => undefined };
  }

  /** B1: the release announced. */
  private announcedScreen(): Screen {
    const s = this.live()!;
    const m = liveSheetModel(s, this.deps.localZone);
    const units = countdown(0).map(() => ({ value: h('span', { class: 'live__digits' }), unit: h('span', { class: 'live__unit-label' }) }));
    const clock = h(
      'div',
      { class: 'live__countdown', attrs: { role: 'timer', 'aria-labelledby': 'live-opens' } },
      ...units.flatMap((u, i) => [i > 0 ? h('span', { class: 'live__colon', attrs: { 'aria-hidden': 'true' }, text: ':' }) : null, h('span', { class: 'live__unit' }, u.value, u.unit)]),
    );
    const description = storyBlock(m.description, { className: 'live__description', paragraphClass: 'live__note' });
    const calendar = h('a', { class: 'textlink live__calendar', attrs: { href: m.calendarHref, download: 'orbes-live-release.ics' }, text: LIVE.calendar });
    const dates = revealCalendar(s);
    const reveals = dates.length
      ? h(
          'div',
          { class: 'live__reveals' },
          h('p', { class: 'live__overline', id: 'live-reveals', text: LIVE.reveals }),
          h(
            'dl',
            { class: 'live__reveals-list', attrs: { 'aria-labelledby': 'live-reveals' } },
            ...dates.map((d) => h('div', { class: 'live__reveal-date' }, h('dt', { class: 'live__reveal-stage', text: d.label }), h('dd', { class: 'live__reveal-when' }, ...withNumerals(d.when)))),
          ),
        )
      : null;
    const there = this.thereBlock();
    const el = h(
      'section',
      { class: 'live__announced' },
      this.overline(LIVE.kind),
      this.piece(m.picture, 'live__plate--announce'),
      this.title(m.name),
      m.line ? this.fact(m.line, 'live__kindline') : null,
      h('p', { class: 'live__price', text: m.price }),
      this.seeModel(m.lookbook),
      this.hairline(),
      h('p', { class: 'live__overline', id: 'live-opens', text: LIVE.opensIn }),
      clock,
      this.fact(m.when.paris, 'live__when'),
      m.when.local ? this.fact(m.when.local, 'live__when live__when--local') : null,
      h('div', { class: 'live__facts' }, this.fact(m.access), this.fact(m.quantity), this.fact(m.roomOpens)),
      this.surprise(m.surprise),
      reveals,
      there.el,
      description,
      calendar,
      this.note(m.rule, 'live__rule-note'),
    );
    return {
      kind: 'announced',
      el,
      update: () => {
        there.update();
        countdown(Date.parse(s.opensAt) - this.now()).forEach((p, i) => {
          if (!units[i]) return;
          if (units[i]!.value.textContent !== p.value) units[i]!.value.textContent = p.value;
          if (units[i]!.unit.textContent !== p.unit) units[i]!.unit.textContent = p.unit;
        });
      },
    };
  }

  /**
   * I'LL BE THERE on the announced page: the public count; for an account the rule lets in, its size and the action (once
   * said, another size changes it, WITHDRAW takes it back, until T0); signed out, a text link opening the sign-in; outside
   * the rule, the rule and why. Its part is built again only when what it offers changes.
   */
  private thereBlock(): { el: HTMLElement; update(): void } {
    const count = this.fact('', 'live__there-count');
    const body = h('div', { class: 'live__there-body' });
    const el = h('section', { class: 'live__there', attrs: { 'aria-label': LIVE.there.action } }, this.hairline(), count, body);
    let mode = '';
    let refresh: () => void = () => undefined;
    const build = (next: string): void => {
      mode = next;
      refresh = () => undefined;
      const s = this.live();
      if (!s) return body.replaceChildren();
      switch (next) {
        case 'signed-out': {
          const open = h('button', { class: 'textlink live__there-open', attrs: { type: 'button' }, text: LIVE.there.action });
          const panel = h('div', { class: 'live__panel live__there-panel' });
          const show = (): void => {
            this.thereSignIn ??= new OwnershipPanel({ kind: 'account', lead: LIVE.there.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
            panel.replaceChildren(this.thereSignIn.root);
            open.hidden = true;
          };
          open.addEventListener('click', () => {
            show();
            panel.querySelector<HTMLInputElement>('input')?.focus();
          });
          body.replaceChildren(open, panel);
          // Opened before (the page drawn again since): it stays open.
          if (this.thereSignIn) show();
          return;
        }
        case 'not-eligible':
          body.replaceChildren(this.note([this.refusal, LIVE.edge.notEligible.text].filter(Boolean).join(' '), 'live__there-rule'));
          return;
        case 'choose':
        case 'said': {
          const said = this.subtitleLine('live__there-said');
          const lead = this.note(next === 'said' ? LIVE.there.change : LIVE.there.lead, 'live__there-lead');
          const picker = this.picker((id) => this.pickThere(id), null);
          const errorLine = this.errorLine();
          const action = h('button', { class: 'btn live__primary live__there-action', attrs: { type: 'button' }, on: { click: () => this.sayThere() }, text: LIVE.there.action });
          const withdraw = h('button', { class: 'textlink live__there-withdraw', attrs: { type: 'button' }, on: { click: () => void this.setThere(null) }, text: LIVE.there.withdraw });
          body.replaceChildren(said, picker.el, lead, errorLine, next === 'said' ? withdraw : action);
          refresh = () => {
            setFact(said, this.interest ? LIVE.there.said(this.interest.size.label) : '');
            said.hidden = !this.interest;
            picker.update(next === 'choose');
            this.showError(errorLine);
            action.disabled = this.busy || this.picked.sizeId === null;
            action.setAttribute('aria-busy', String(this.busy));
            withdraw.disabled = this.busy;
          };
          return;
        }
        default:
          body.replaceChildren();
      }
    };
    return {
      el,
      update: () => {
        const line = interestLine(this.live()?.interest ?? 0);
        setFact(count, line ?? '');
        count.hidden = line === null;
        const next = this.viewer === 'ready' ? (this.interest ? 'said' : 'choose') : this.viewer;
        if (next !== mode) build(next);
        refresh();
      },
    };
  }

  /** A line in the display face of a fact said (`YOU'LL BE THERE · SIZE 52`), its figures in the reading face. */
  private subtitleLine(extra: string): HTMLParagraphElement {
    return h('p', { class: ['live__subtitle', extra] });
  }

  /** A size picked under I'LL BE THERE: kept until it is said; once said, the interest changed to it. */
  private pickThere(sizeId: string): void {
    if (this.busy) return;
    if (this.interest) {
      if (this.interest.size.id !== sizeId) void this.setThere(sizeId);
      return;
    }
    this.picked = { ...this.picked, sizeId };
    this.screen?.update();
  }

  private sayThere(): void {
    const sizeId = this.picked.sizeId;
    if (sizeId) void this.setThere(sizeId);
  }

  /**
   * I'LL BE THERE with a size (null: withdrawn). The public count follows the account's own change at once (the next read
   * of the release brings everyone's); a refusal reads as the server wrote it, the rule's own (403) saying it instead.
   */
  private async setThere(sizeId: string | null): Promise<void> {
    const s = this.live();
    if (!s || this.busy) return;
    this.busy = true;
    this.error = null;
    this.screen?.update();
    const before = this.interest;
    const from = document.activeElement;
    try {
      let after: LiveInterest | null = null;
      if (sizeId === null) await this.deps.api.liveWithdrawInterest(s.id);
      else after = await this.deps.api.liveInterest(s.id, sizeId);
      if (this.disposed) return;
      this.interest = after;
      if (after) this.picked = { ...this.picked, sizeId: after.size.id };
      const delta = (after ? 1 : 0) - (before ? 1 : 0);
      const sheet = this.live();
      if (delta !== 0 && sheet) this.sheet = { ...sheet, interest: Math.max(0, sheet.interest + delta) };
      this.say(after ? LIVE.there.said(after.size.label) : LIVE.there.withdrawn);
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      if (e instanceof ApiError && e.status === 401) this.viewer = 'signed-out';
      else if (isApi(e, 'LIVE_NOT_ELIGIBLE')) {
        this.viewer = 'not-eligible';
        this.refusal = e instanceof ApiError ? e.message : null;
      } else this.error = messageOf(e);
    } finally {
      this.busy = false;
    }
    this.render();
    // The action gone (said, or withdrawn): the keyboard's focus on the size now said, else on the action back.
    if (from && !from.isConnected) requestAnimationFrame(() => this.root.querySelector<HTMLElement>('.live__there .live__size[aria-pressed="true"], .live__there-action')?.focus());
  }

  private signInScreen(): Screen {
    const s = this.live();
    const rule = s ? s.access.text : '';
    this.signIn ??= new OwnershipPanel({ kind: 'account', lead: LIVE.edge.signIn.text(rule) }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
    const el = h('section', { class: 'live__edge live__signin' }, this.overline(this.name()), this.title(LIVE.edge.signIn.title), h('div', { class: 'live__panel' }, this.signIn.root));
    return { kind: 'signin', el, update: () => undefined };
  }

  private notEligibleScreen(): Screen {
    const s = this.live();
    const el = h(
      'section',
      { class: 'live__edge' },
      this.overline(this.name()),
      this.title(s ? LIVE.forWhom(s.access.text) : LIVE.kind),
      this.note([this.refusal, LIVE.edge.notEligible.text].filter(Boolean).join(' ')),
      this.action(LIVE.back, () => this.deps.onReleases()),
    );
    return { kind: 'notEligible', el, back: true, update: () => undefined };
  }

  /**
   * The size picker and the quantity, while they can change (never after T0: the room hides them then). `choosing`:
   * before ENTER, the size picked is outlined (ENTER is the one filled action); once entered, it is filled.
   */
  private picker(onPick: (sizeId: string) => void, onQuantity: ((q: number) => void) | null): { el: HTMLElement; update(choosing: boolean): void } {
    const s = this.live()!;
    const label = h('p', { class: 'live__overline live__size-label', id: 'live-size', text: LIVE.yourSize });
    const grid = h('div', { class: 'live__sizes', attrs: { role: 'group', 'aria-labelledby': 'live-size' } });
    const buttons = new Map<string, HTMLButtonElement>();
    for (const c of sizeChoices(s, this.room, this.picked.sizeId)) {
      const b = h('button', { class: 'btn live__size', attrs: { type: 'button' }, on: { click: () => onPick(c.id) } }, h('span', { class: 'live__size-label', text: c.label }));
      buttons.set(c.id, b);
      grid.append(b);
    }
    // I'LL BE THERE says a size only (`onQuantity` null): the quantity is chosen in the room.
    const max = onQuantity ? s.perAccount : 1;
    const value = h('span', { class: 'live__qty-value', attrs: { 'aria-live': 'polite' } });
    const fewer = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': LIVE.fewer }, on: { click: () => onQuantity?.(this.picked.quantity - 1) }, text: '−' });
    const more = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': LIVE.more }, on: { click: () => onQuantity?.(this.picked.quantity + 1) }, text: '+' });
    const quantity = max > 1 ? h('div', { class: 'live__qty', attrs: { role: 'group', 'aria-labelledby': 'live-qty' } }, h('span', { class: 'live__overline', id: 'live-qty', text: LIVE.quantity }), fewer, value, more) : null;
    const el = h('div', { class: 'live__picker' }, label, grid, quantity);
    return {
      el,
      update: (choosing: boolean) => {
        el.classList.toggle('is-choosing', choosing);
        const choices = sizeChoices(s, this.room, this.picked.sizeId);
        for (const c of choices) {
          const b = buttons.get(c.id);
          if (!b) continue;
          b.setAttribute('aria-pressed', String(c.selected));
          const off = this.busy || (!c.available && !c.selected);
          b.disabled = off;
          if (!c.available) b.setAttribute('aria-label', LIVE.soldOutSize(c.label));
          else b.removeAttribute('aria-label');
          b.classList.toggle('is-gone', !c.available);
        }
        value.textContent = String(this.picked.quantity);
        fewer.disabled = this.busy || this.picked.quantity <= 1;
        more.disabled = this.busy || this.picked.quantity >= max;
      },
    };
  }

  /** B2: the room, its closed door, the countdown, the ready check, the size; at T0 the opening. */
  private roomScreen(): Screen {
    const s = this.live()!;
    const m = liveSheetModel(s, this.deps.localZone);
    const overline = this.overline(LIVE.phase.ROOM);
    const lock = sealSvg('live-door__seal');
    const door = h(
      'div',
      { class: 'live-door', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'live-door__inside' }, this.piece(m.picture, 'live-door__piece', true)),
      h('div', { class: 'live-door__leaf live-door__leaf--left' }),
      h('div', { class: 'live-door__leaf live-door__leaf--right' }),
      h('div', { class: 'live-door__lock' }, lock),
    );
    const count = h('p', { class: 'live__count', attrs: { role: 'timer', 'aria-labelledby': 'live-until' } });
    const until = this.fact('', 'live__until');
    until.id = 'live-until';
    const presence = h('p', { class: 'live__presence' }, h('span', { class: 'live__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'live__presence-text' }));
    const drawing = h('div', { class: 'live__drawing', attrs: { hidden: true } }, h('p', { class: 'live__subtitle', text: LIVE.drawing }), this.note(LIVE.drawingLine(s.tierPriority)));
    const checks = h('dl', { class: 'live__checks-list' });
    const plate = bracket(h('div', { class: 'live__checks' }, h('p', { class: 'live__overline live__checks-title', text: LIVE.ready.title }), checks));
    const errorLine = this.errorLine();
    const picker = this.picker(
      (id) => this.pick(id),
      (q) => this.pickQuantity(q),
    );
    const enter = h('button', { class: 'btn live__primary live__enter', attrs: { type: 'button' }, on: { click: () => this.enter() }, text: LIVE.enter });
    const ready = h('p', { class: 'live__subtitle live__ready', text: LIVE.youreReady });
    const readyLine = this.note('', 'live__ready-line');
    const choose = this.note(LIVE.chooseLine, 'live__choose');
    const leave = h('button', { class: 'textlink live__leave', attrs: { type: 'button' }, on: { click: () => void this.act(() => this.deps.api.liveLeave(s.id)) }, text: LIVE.leaveRoom });
    const prep = h('div', { class: 'live__prep' }, plate, picker.el, errorLine, choose, enter, ready, readyLine, leave);
    // SEE THE MODEL under the model's line while the door is closed; at T0 the room is the piece's alone.
    const seeModel = this.seeModel(m.lookbook);
    // The ticks sound only from a context a gesture made: any tap or key in the room before T0 makes it (a collector
    // who entered earlier, on this page or another, then came back). A tap's pointerup is the gesture a browser grants.
    const prime = (): void => this.deps.sound.prime();
    const el = h(
      'section',
      { class: 'live__room', on: { pointerup: prime, keydown: prime } },
      overline,
      this.title(m.name),
      this.fact(m.offer, 'live__offer'),
      this.surprise(m.surprise),
      seeModel,
      door,
      h('div', { class: 'live__count-block' }, count, until, presence),
      drawing,
      prep,
    );
    let opened = false;
    const update = () => {
      const opensAt = Date.parse(this.room?.opensAt ?? s.opensAt);
      const remaining = opensAt - this.now();
      const entered = heldEntry(this.entry)?.status === 'WAITING';
      // The countdown, the lock's orbits, the ticks of the last ten seconds.
      count.textContent = clockText(remaining);
      const local = zonedTime(opensAt, this.deps.localZone);
      setFact(until, `${LIVE.untilOpening} · ${local?.clock ?? ''}`);
      if (!prefersReducedMotion()) turnRings(lock, (k) => lockAngle(k, remaining));
      const tick = tickSecond(remaining);
      if (tick !== null && tick !== this.lastTick && this.synced) this.deps.sound.tick();
      this.lastTick = tick;
      setFact(presence.lastChild as HTMLElement, LIVE.inRoom(this.room?.inRoom ?? 0));
      presence.hidden = !this.room?.inRoom;
      // T0, on the server's second: the lock aligns, the door opens, the piece under its light.
      if (remaining <= 0 && !opened) {
        opened = true;
        this.opening = performance.now();
        el.classList.add('is-opening');
        door.classList.add('is-aligned');
        overline.replaceChildren(...withNumerals(LIVE.phase.LIVE));
        drawing.hidden = false;
        prep.hidden = true;
        if (seeModel) seeModel.hidden = true;
        this.say(LIVE.announce.open);
        setTimeout(() => door.classList.add('is-open'), prefersReducedMotion() ? 0 : DOOR_DELAY_MS);
      }
      if (opened) return;
      const checksNow = readyChecks({ access: this.access, size: this.sizeLabel(this.picked.sizeId), connection: this.connection, synced: this.synced });
      const key = checksNow.map((c) => `${c.value}:${c.ok}`).join('|');
      if (checks.dataset.key !== key) {
        checks.dataset.key = key;
        checks.replaceChildren(
        ...checksNow.map((c) =>
          h(
            'div',
            { class: ['live__check', c.ok ? 'is-ok' : null] },
            h('dt', { class: 'live__check-label', text: c.label }),
            h('dd', { class: 'live__check-value' }, h('span', { class: 'live__check-text' }, ...withNumerals(c.value)), checkMark(c.ok), h('span', { class: 'visually-hidden', text: c.ok ? LIVE.ready.ok : LIVE.ready.pending })),
          ),
        ),
        );
      }
      picker.update(!entered);
      this.showError(errorLine);
      choose.hidden = entered;
      enter.hidden = entered;
      enter.disabled = this.busy || this.picked.sizeId === null;
      enter.setAttribute('aria-busy', String(this.busy));
      const allOk = checksNow.every((c) => c.ok);
      ready.hidden = !entered || !allOk;
      readyLine.hidden = !entered;
      readyLine.textContent = LIVE.readyLine(local?.clock ?? '');
      leave.hidden = !entered;
      leave.disabled = this.busy;
    };
    return { kind: 'room', el, update, focus: undefined };
  }

  /** After T0, an account not in the line: its size, then ENTER THE LINE (it joins behind). */
  private joinScreen(): Screen {
    const s = this.live()!;
    const m = liveSheetModel(s, this.deps.localZone);
    const errorLine = this.errorLine();
    const left = this.fact('', 'live__left');
    const presence = h('p', { class: 'live__presence' }, h('span', { class: 'live__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'live__presence-text' }));
    const picker = this.picker(
      (id) => {
        this.picked = { ...this.picked, sizeId: id };
        this.screen?.update();
      },
      (q) => {
        this.picked = { ...this.picked, quantity: Math.min(s.perAccount, Math.max(1, q)) };
        this.screen?.update();
      },
    );
    const enter = h('button', { class: 'btn live__primary live__enter', attrs: { type: 'button' }, on: { click: () => this.enter() }, text: LIVE.enterLine });
    const el = h(
      'section',
      { class: 'live__join' },
      this.overline(this.liveLine()),
      this.title(m.name),
      this.piece(m.picture, 'live__plate--join', true),
      presence,
      left,
      this.note(this.afterRoomOf() ? LIVE.afterRoom.joinLine : LIVE.joinLine, 'live__join-line'),
      picker.el,
      errorLine,
      enter,
    );
    return {
      kind: 'join',
      el,
      update: () => {
        const room = this.room;
        setFact(presence.lastChild as HTMLElement, LIVE.inRoom(room?.inRoom ?? 0));
        presence.hidden = !room?.inRoom;
        setFact(left, room ? LIVE.left(room.left, room.quantity) : '');
        picker.update(true);
        this.showError(errorLine);
        // The server's rule for a late entry: the pieces of the size not confirmed (held ones may return) serve it.
        const pieces = servable(roomSize(room, this.picked.sizeId ?? undefined));
        enter.disabled = this.busy || this.picked.sizeId === null || (pieces !== null && pieces < this.picked.quantity);
        enter.setAttribute('aria-busy', String(this.busy));
      },
    };
  }

  private sizeLabel(sizeId: string | null): string | null {
    return this.live()?.sizes.find((x) => x.id === sizeId)?.label ?? null;
  }

  /** A size picked: before entering, kept here; entered (before T0), the entry's size changed. */
  private pick(sizeId: string): void {
    this.deps.sound.prime();
    const s = this.live();
    const held = heldEntry(this.entry);
    if (!s || this.busy) return;
    if (held?.status === 'WAITING') {
      if (held.size.id === sizeId) return;
      void this.act(() => this.deps.api.liveSize(s.id, sizeId, s.perAccount > 1 ? this.picked.quantity : undefined));
      return;
    }
    this.picked = { ...this.picked, sizeId };
    this.screen?.update();
  }

  private pickQuantity(q: number): void {
    this.deps.sound.prime();
    const s = this.live();
    if (!s || this.busy) return;
    const quantity = Math.min(s.perAccount, Math.max(1, q));
    const held = heldEntry(this.entry);
    if (held?.status === 'WAITING') {
      if (held.quantity !== quantity) void this.act(() => this.deps.api.liveSize(s.id, held.size.id, quantity));
      return;
    }
    this.picked = { ...this.picked, quantity };
    this.screen?.update();
  }

  /** ENTER THE ROOM (before T0) or ENTER THE LINE (after it), with the size and quantity picked. */
  private enter(): void {
    this.deps.sound.prime();
    const s = this.live();
    const sizeId = this.picked.sizeId;
    if (!s || !sizeId) return;
    const from = document.activeElement;
    void this.act(
      () => this.deps.api.liveEnter(s.id, sizeId, s.perAccount > 1 ? this.picked.quantity : undefined),
      () => {
        // ENTER goes once entered: the keyboard's focus moves to the size now chosen, still changeable until T0.
        requestAnimationFrame(() => {
          if (document.activeElement === from || document.activeElement === document.body) this.root.querySelector<HTMLElement>('.live__size[aria-pressed="true"]')?.focus();
        });
      },
    );
  }

  /** B3: the line. */
  private lineScreen(): Screen {
    // The figure read with its words (a paragraph cannot be named): the label above is the eye's, hidden from readers.
    const figure = h('span', { class: 'live__place-figure' });
    const place = h('p', { class: 'live__place' }, h('span', { class: 'visually-hidden', text: `${LIVE.yourPlaceSaid} ` }), figure);
    const ahead = this.fact('', 'live__ahead');
    const meter = h('div', { class: 'live__meter', attrs: { 'aria-hidden': 'true' } });
    const left = this.fact('', 'live__left');
    const held = this.fact('', 'live__held');
    const el = h(
      'section',
      { class: 'live__line' },
      this.overline(this.liveLine()),
      this.title(this.name()),
      h('p', { class: 'live__overline live__place-label', attrs: { 'aria-hidden': 'true' }, text: LIVE.yourPlace }),
      place,
      ahead,
      meter,
      left,
      held,
      this.hairline(),
      this.note(LIVE.lineNote, 'live__line-note'),
    );
    let cells = '';
    return {
      kind: 'line',
      el,
      update: () => {
        const e = this.entry;
        const room = this.room;
        if (!e || !room) return;
        figure.textContent = e.position === null ? '' : String(e.position);
        setFact(ahead, aheadLine(e));
        const facts = lineFacts(room, e.size.id, e.size.label);
        setFact(left, facts.left);
        setFact(held, facts.held ?? '');
        held.hidden = facts.held === null;
        const key = facts.cells ? facts.cells.join('') : `bar:${facts.taken.toFixed(3)}`;
        if (key !== cells) {
          cells = key;
          meter.classList.toggle('live__meter--bar', facts.cells === null);
          if (facts.cells) {
            meter.style.setProperty('--cells', String(facts.cells.length));
            meter.replaceChildren(...facts.cells.map((c) => h('span', { class: `live__cell live__cell--${c}` })));
          } else {
            const bar = h('span', { class: 'live__bar' });
            bar.style.transform = `scaleX(${facts.taken})`;
            meter.replaceChildren(bar);
          }
        }
        const said = placeAnnouncement(e);
        if (said && said !== this.lastPlace) {
          this.lastPlace = said;
          this.say(said);
        }
      },
    };
  }

  /** Sold out in your size: stay in line in case a piece returns, or leave (no size switch after T0). */
  private soldOutScreen(): Screen {
    const s = this.live()!;
    const text = this.note('');
    const place = this.fact('', 'live__ahead');
    const errorLine = this.errorLine();
    const leave = this.action(LIVE.edge.soldOut.leave, () => this.armed(() => this.act(() => this.deps.api.liveLeave(s.id))), 'live__leave-line');
    const el = h('section', { class: 'live__edge' }, this.overline(this.name()), this.title(LIVE.edge.soldOut.title(this.entry?.size.label ?? '')), place, text, errorLine, leave);
    return {
      kind: 'soldOut',
      el,
      update: () => {
        const e = this.entry;
        const size = e ? roomSize(this.room, e.size.id) : null;
        text.textContent = size && size.held > 0 ? LIVE.edge.soldOut.stay : LIVE.edge.soldOut.none;
        setFact(place, size && size.held > 0 ? LIVE.held(size.held) : e?.position ? `${LIVE.yourPlace} ${e.position}` : '');
        this.showError(errorLine);
        leave.disabled = this.busy;
        leave.textContent = this.armedUntil ? LIVE.edge.soldOut.leaveConfirm : LIVE.edge.soldOut.leave;
      },
    };
  }

  /** A second tap within ARMED_MS confirms an action that gives a place back. */
  private armed(run: () => Promise<void>): void {
    if (this.busy) return;
    if (this.armedUntil && performance.now() <= this.armedUntil) {
      this.armedUntil = 0;
      void run();
      return;
    }
    this.armedUntil = performance.now() + ARMED_MS;
    this.screen?.update();
  }

  /** B4: the turn, the seal to press and hold. */
  private turnScreen(): Screen {
    const overline = this.overline(this.returned ? LIVE.returned : LIVE.yourTurn);
    // Both rings start at north and run clockwise.
    const ring = s('circle', { class: 'live-hold__turn', cx: 134, cy: 134, r: 128, transform: 'rotate(-90 134 134)', 'stroke-dasharray': TURN_RING.toFixed(2) });
    const fill = s('circle', { class: 'live-hold__fill', cx: 134, cy: 134, r: 116, transform: 'rotate(-90 134 134)', 'stroke-dasharray': HOLD_RING.toFixed(2), 'stroke-dashoffset': HOLD_RING.toFixed(2) });
    const svg = s('svg', { class: 'live-hold__rings', viewBox: '0 0 268 268', 'aria-hidden': 'true', focusable: 'false' }, s('circle', { class: 'live-hold__track', cx: 134, cy: 134, r: 128 }), ring, fill);
    const button = h('button', { class: 'btn live-hold', attrs: { type: 'button', 'aria-label': LIVE.sealLabel, 'aria-describedby': 'live-turn-left' } }, svg, sealSvg('live-hold__seal'));
    const left = h('p', { class: 'live__turn-left', id: 'live-turn-left', attrs: { role: 'timer' } });
    const errorLine = this.errorLine();
    const el = h(
      'section',
      { class: 'live__turn' },
      overline,
      this.title(LIVE.pressHold),
      button,
      left,
      this.fact(LIVE.toSecure, 'live__to-secure'),
      this.fact('', 'live__turn-piece'),
      this.note(LIVE.letGo, 'live__let-go'),
      errorLine,
    );
    const piece = el.querySelector<HTMLElement>('.live__turn-piece')!;
    // The pointer: captured from the press to the release; the keyboard: the space bar or Enter, held.
    button.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      try {
        button.setPointerCapture(ev.pointerId);
      } catch {
        // A pointer that cannot be captured still ends with pointerup.
      }
      this.startHold(el, overline, fill);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, () => this.endHold());
    button.addEventListener('keydown', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      if (!ev.repeat) this.startHold(el, overline, fill);
    });
    button.addEventListener('keyup', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      this.endHold();
    });
    button.addEventListener('blur', () => this.endHold());
    button.addEventListener('contextmenu', (ev) => ev.preventDefault());
    button.addEventListener('click', (ev) => ev.preventDefault());
    const onHidden = () => {
      if (document.visibilityState === 'hidden') this.endHold();
    };
    document.addEventListener('visibilitychange', onHidden);
    this.frozenTurn = null;
    return {
      kind: 'turn',
      el,
      focus: button,
      dispose: () => {
        document.removeEventListener('visibilitychange', onHidden);
        this.endHold(true);
      },
      update: () => {
        const e = this.entry;
        if (!e?.turn) return;
        const paused = this.room?.paused === true;
        let { remainingMs, fraction } = windowLeft(e.turn.at, e.turn.expiresAt, this.now());
        // Paused: the turn's time stands still (the server moves its deadline by the pause).
        if (paused) {
          this.frozenTurn ??= remainingMs;
          remainingMs = this.frozenTurn;
          fraction = Math.min(1, remainingMs / Math.max(1, Date.parse(e.turn.expiresAt) - Date.parse(e.turn.at)));
        } else this.frozenTurn = null;
        left.textContent = clockText(remainingMs);
        ring.setAttribute('stroke-dashoffset', (TURN_RING * (1 - fraction)).toFixed(2));
        setFact(piece, `${this.name()} · ${LIVE.size(e.size.label)} · ${formatMoney(e.priceMinor * e.quantity, e.currency)}`);
        // The pause alone: while the secure is sent (busy) the seal stays lit, its hold already done (startHold waits).
        button.setAttribute('aria-disabled', String(paused));
        el.classList.toggle('is-paused', paused);
        this.showError(errorLine);
      },
    };
  }

  /** The seal pressed: the press sent at once with the turn's secret, the hold's ring filling for HOLD_MS. */
  private startHold(el: HTMLElement, overline: HTMLElement, fill: SVGCircleElement): void {
    const s = this.live();
    const token = this.entry?.status === 'TURN' ? this.entry.turn?.token : null;
    if (!s || !token || this.hold || this.busy || this.room?.paused) return;
    this.deps.sound.prime();
    navigator.vibrate?.(12);
    this.error = null;
    const hold: Hold = { started: performance.now(), pressedAt: null, sent: false, frame: 0 };
    this.hold = hold;
    el.classList.add('is-holding');
    overline.replaceChildren(LIVE.holding);
    this.screen?.update();
    this.deps.api.livePress(s.id, token).then(
      () => {
        if (this.hold === hold) hold.pressedAt = performance.now();
      },
      (e: unknown) => {
        if (this.hold !== hold || this.disposed) return;
        this.deps.session.noteError(e);
        this.error = messageOf(e);
        this.endHold(true);
        if (e instanceof ApiError && e.status === 409) void this.readState(false);
        this.screen?.update();
      },
    );
    const step = () => {
      if (this.hold !== hold) return;
      const progress = Math.min(1, (performance.now() - hold.started) / HOLD_MS);
      fill.setAttribute('stroke-dashoffset', (HOLD_RING * (1 - progress)).toFixed(2));
      if (progress >= 1 && hold.pressedAt !== null && performance.now() - hold.pressedAt >= PRESS_GAP_MS && !hold.sent) {
        hold.sent = true;
        this.securing = true;
        void this.secure(s.id, token);
        return;
      }
      hold.frame = requestAnimationFrame(step);
    };
    hold.frame = requestAnimationFrame(step);
    this.resetHoldView = () => {
      el.classList.remove('is-holding');
      overline.replaceChildren(this.returned ? LIVE.returned : LIVE.yourTurn);
      fill.setAttribute('stroke-dashoffset', HOLD_RING.toFixed(2));
    };
  }

  private resetHoldView: (() => void) | null = null;

  /**
   * The seal let go: the ring resets, unless it is full (the secure then goes as soon as the server has seen the press
   * long enough). `force`: the hold ends whatever its state (the screen leaves, a refusal).
   */
  private endHold(force = false): void {
    const hold = this.hold;
    if (!hold) return;
    const full = performance.now() - hold.started >= HOLD_MS;
    if (!force && (full || hold.sent)) return;
    cancelAnimationFrame(hold.frame);
    this.hold = null;
    this.resetHoldView?.();
    if (!force && performance.now() - hold.started > 200) this.say(LIVE.announce.reset);
  }

  private async secure(id: string, token: string): Promise<void> {
    await this.act(() => this.deps.api.liveSecure(id, token));
    if (this.hold) {
      cancelAnimationFrame(this.hold.frame);
      this.hold = null;
    }
    if (this.entry?.status === 'TURN') this.resetHoldView?.();
  }

  /** B5: the piece secured, its reveal (`revealing`: secured on this page, just now), the add-ons, PAY. */
  private securedScreen(revealing: boolean): Screen {
    const s = this.live();
    const seal = sealSvg('live__piece-seal');
    const securedAt = this.fact('', 'live__secured-at');
    const reveal = bracket(h('div', { class: 'live__plate live__reveal' }, h('p', { class: 'live__overline', text: LIVE.yourPiece }), seal, securedAt));
    const detail = this.fact('', 'live__detail');
    const addonsBox = h('div', { class: 'live__addons', attrs: { role: 'group', 'aria-labelledby': 'live-addons' } });
    const addonButtons = new Map<string, HTMLButtonElement>();
    const addons = s && s.addons.length > 0 && this.entry ? addonChoices(s, this.entry) : [];
    for (const a of addons) {
      // The add-on's one line of words under its button (a control's label stays on one line), read with it.
      const lineId = `live-addon-${a.id}`;
      const b = h(
        'button',
        { class: 'btn live__addon', attrs: { type: 'button', 'aria-describedby': a.line ? lineId : undefined }, on: { click: () => this.toggleAddon(a.id) } },
        h('span', { class: 'live__addon-mark', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'live__addon-label' }, ...withNumerals(a.label)),
        ' ',
        h('span', { class: 'live__addon-price', text: a.price }),
      );
      addonButtons.set(a.id, b);
      addonsBox.append(h('div', { class: 'live__addon-item' }, b, a.line ? h('p', { class: 'live__addon-line', id: lineId, text: a.line }) : null));
    }
    const errorLine = this.errorLine();
    const pay = h('button', { class: 'btn live__primary live__pay', attrs: { type: 'button' }, on: { click: () => this.payNow() } });
    const deadline = h('p', { class: 'live__deadline' }, h('span', { class: 'live__deadline-time', attrs: { role: 'timer' } }), h('span', { class: 'live__deadline-label', text: LIVE.toConfirm }));
    const release = h('button', { class: 'textlink live__release', attrs: { type: 'button' }, on: { click: () => this.armed(() => this.act(() => this.deps.api.liveGiveBack(this.sheet!.id))) } });
    const el = h(
      'section',
      { class: ['live__secured', revealing && !prefersReducedMotion() ? 'is-revealing' : null] },
      this.overline(LIVE.secured),
      reveal,
      this.title(this.name()),
      detail,
      addons.length > 0 ? h('p', { class: 'live__overline live__addons-title', id: 'live-addons', text: LIVE.addons }) : null,
      addons.length > 0 ? addonsBox : null,
      errorLine,
      pay,
      deadline,
      this.note(LIVE.payNote, 'live__pay-note'),
      release,
    );
    if (revealing) {
      // The reveal (P-D01's motion on the seal's glyphs): the chord and the vibration where the phone allows it; once.
      this.deps.sound.play();
      navigator.vibrate?.([...CEREMONY_VIBRATION]);
    }
    this.frozenHold = null;
    return {
      kind: 'secured',
      el,
      update: () => {
        const e = this.entry;
        if (!e?.hold) return;
        const at = zonedTime(e.hold.securedAt, this.deps.localZone);
        setFact(securedAt, LIVE.securedAt(at?.clock ?? ''));
        const collection = s?.collection ? `${upper(s.collection)} · ` : '';
        setFact(detail, `${collection}${LIVE.size(e.size.label)}${e.quantity > 1 ? ` · ${e.quantity} ${LIVE.quantity}` : ''}`);
        const chosen = new Set(e.addons.map((a) => a.id));
        for (const [id, b] of addonButtons) {
          b.setAttribute('aria-pressed', String(chosen.has(id)));
          b.disabled = this.busy;
        }
        const total = formatMoney(e.totalMinor, e.currency);
        if (pay.dataset.total !== total) {
          // The price in the reading face, its groups kept together (not spread by the button's tracking).
          pay.dataset.total = total;
          // One inline run (a button lays its children out as flex items, which would drop the space before the price).
          pay.replaceChildren(h('span', null, LIVE.pay(''), h('span', { class: 'live__money', text: total })));
        }
        pay.disabled = this.busy;
        pay.setAttribute('aria-busy', String(this.busy));
        let { remainingMs } = windowLeft(e.hold.securedAt, e.hold.expiresAt, this.now());
        // Paused: the time to confirm stands still (the server moves the hold's deadline by the pause at every read).
        if (this.room?.paused === true) {
          this.frozenHold ??= remainingMs;
          remainingMs = this.frozenHold;
        } else this.frozenHold = null;
        (deadline.firstChild as HTMLElement).textContent = clockText(remainingMs);
        release.textContent = this.armedUntil ? LIVE.releaseConfirm : LIVE.release;
        release.disabled = this.busy;
        this.showError(errorLine);
      },
    };
  }

  private toggleAddon(id: string): void {
    const s = this.live();
    const e = this.entry;
    if (!s || !e || this.busy) return;
    const ids = new Set(e.addons.map((a) => a.id));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    // In the release's order, as the server keeps them.
    void this.act(() => this.deps.api.liveAddons(s.id, s.addons.filter((a) => ids.has(a.id)).map((a) => a.id)));
  }

  private payNow(): void {
    const s = this.live();
    if (!s) return;
    void this.act(() => this.deps.api.liveConfirm(s.id));
  }

  /** B6: CONFIRMED, out into the light (the ivory house style). */
  private confirmedScreen(): Screen {
    const e = this.entry!;
    const reference = liveReference(e.id);
    const at = zonedTime(e.confirmedAt ?? e.hold?.securedAt ?? Date.now(), this.deps.localZone);
    const row = (label: string, value: string) => h('div', { class: 'rows__row' }, h('dt', { class: 'rows__label' }, ...withNumerals(label)), h('dd', { class: 'rows__value', text: value }));
    const rows = h(
      'dl',
      { class: 'rows live__receipt' },
      row(LIVE.rows.reserved, at ? `${at.date} · ${at.clock}` : ''),
      row(LIVE.rows.size, e.size.label),
      e.quantity > 1 ? row(LIVE.rows.pieces, String(e.quantity)) : null,
      ...e.addons.map((a) => row(upper(a.label), formatMoney(a.priceMinor * e.quantity, e.currency))),
      row(LIVE.rows.total, formatMoney(e.totalMinor, e.currency)),
      row(LIVE.rows.reference, reference),
    );
    const contact = releaseContactModel(this.contacts, this.name(), reference, LIVE.confirmed);
    const el = h(
      'section',
      { class: 'live__confirmed' },
      h('div', { class: 'live__mark' }, toneMark('authentic')),
      this.title(LIVE.confirmed),
      this.fact(this.afterRoomOf() ? LIVE.afterRoom.confirmedOf(this.name()) : LIVE.confirmedOf(this.name()), 'live__confirmed-of'),
      h('p', { class: 'prose live__confirmed-text', text: LIVE.reservedIn(e.size.label, e.quantity) }),
      bracket(h('div', { class: 'live__receipt-plate' }, rows)),
      contact ? h('p', { class: 'live__overline live__cs-title', text: LIVE.clientServices }) : null,
      contact ? contactBlock(contact) : null,
      piecesLink(() => this.deps.onPieces(), 'live__pieces'),
    );
    return { kind: 'confirmed', el, update: () => undefined };
  }

  /**
   * The second door (plan LIVE RELEASE+, choice 2), in the same vault: still in the line when the last piece was secured,
   * the after-room's delay later; its one action ENTER THE AFTER-ROOM. Until it closes (then the page says how the release
   * ended).
   */
  private afterRoomScreen(): Screen {
    const door = h(
      'div',
      { class: 'live-door live-door--after', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'live-door__leaf live-door__leaf--left' }),
      h('div', { class: 'live-door__leaf live-door__leaf--right' }),
      h('div', { class: 'live-door__lock' }, sealSvg('live-door__seal')),
    );
    const until = this.fact('', 'live__until live__after-until');
    const enter = h('button', { class: 'btn live__primary live__after-enter', attrs: { type: 'button' }, on: { click: () => this.deps.onAfterRoom(this.sheet!.id) }, text: LIVE.afterRoom.enter });
    const el = h(
      'section',
      { class: 'live__after' },
      this.overline(LIVE.afterRoom.kind),
      this.title(LIVE.afterRoom.title),
      door,
      this.note(LIVE.afterRoom.text, 'live__after-text'),
      until,
      enter,
    );
    return {
      kind: 'afterRoom',
      el,
      update: () => {
        const door = this.entry?.afterRoom;
        const closes = door ? zonedTime(door.closesAt, this.deps.localZone) : null;
        setFact(until, closes ? LIVE.afterRoom.openUntil(closes.time) : '');
      },
    };
  }

  /**
   * Over (plan LIVE RELEASE+, decision 30): the release in its final state, as THE RELEASES' PAST opens it. What was
   * announced (each part from its stage), THIS RELEASE IS OVER, and signed in the account's part in it; never an end
   * figure. Its one action: THE RELEASES.
   */
  private pastScreen(): Screen {
    const m = livePastModel(this.sheet!, this.deps.localZone);
    const part = this.fact('', 'live__past-part');
    part.hidden = true;
    const ask = this.questionBlock();
    const el = h(
      'section',
      { class: 'live__past' },
      this.overline(LIVE.kind),
      this.piece(m.picture, 'live__plate--past'),
      this.title(m.name),
      m.line ? this.fact(m.line, 'live__kindline') : null,
      this.seeModel(m.lookbook),
      this.hairline(),
      this.fact(RELEASES.over, 'live__past-status'),
      this.fact(m.facts, 'live__past-facts'),
      part,
      ask.el,
      storyBlock(m.description, { className: 'live__description', paragraphClass: 'live__note' }),
      this.action(LIVE.back, () => this.deps.onReleases()),
    );
    return {
      kind: 'past',
      el,
      back: true,
      update: () => {
        if (this.partRead === 'idle' && this.deps.session.state.status === 'signed-in') void this.readPart();
        setFact(part, this.part ?? '');
        part.hidden = this.part === null;
        this.askQuestion(ask);
      },
    };
  }

  /** ONE QUESTION, in the vault: the question after, shown once read, kept when answered. */
  private questionBlock(): QuestionBlock {
    return new QuestionBlock({
      api: this.deps.api,
      session: this.deps.session,
      localZone: this.deps.localZone,
      tone: 'vault',
      onAnswered: (q) => {
        this.question = q;
      },
    });
  }

  /** The question after on a page of the release's end: read once signed in (never on an after-room's page), then shown. */
  private askQuestion(block: QuestionBlock): void {
    if (this.questionRead === 'idle' && this.deps.session.state.status === 'signed-in' && !this.afterRoomOf()) void this.readQuestion();
    block.show(this.question);
  }

  /** The question after for the account (asked here only of one that took part without a piece); unsaid should it not be read. */
  private async readQuestion(): Promise<void> {
    const id = this.sheet?.id;
    if (!id) return;
    const gen = ++this.questionGen;
    this.questionRead = 'reading';
    let question: AccountQuestion | null = null;
    try {
      const q = await this.deps.api.question(id);
      question = q?.asked === 'TOOK_PART' ? q : null;
    } catch (e) {
      if (gen !== this.questionGen || this.disposed) return;
      this.deps.session.noteError(e);
    }
    if (gen !== this.questionGen || this.disposed) return;
    this.question = question;
    this.questionRead = 'done';
    this.screen?.update();
  }

  /** The account's part in this release, from the releases it took part in; left unsaid should it not be read. */
  private async readPart(): Promise<void> {
    const id = this.sheet?.id;
    if (!id) return;
    const gen = ++this.partGen;
    this.partRead = 'reading';
    let part: string | null = null;
    try {
      part = participationModel(await this.deps.api.participation()).marks.get(id) ?? null;
    } catch (e) {
      if (gen !== this.partGen || this.disposed) return;
      this.deps.session.noteError(e);
    }
    if (gen !== this.partGen || this.disposed) return;
    this.part = part;
    this.partRead = 'done';
    this.screen?.update();
  }

  /** An edge page: its title, its sentence, its one action. */
  private edgeScreen(kind: LiveScreenKind): Screen {
    const copy = this.edgeCopy(kind);
    const contact = kind === 'removed' && this.entry ? releaseContactModel(this.contacts, this.name(), liveReference(this.entry.id), LIVE.statusLabel.REMOVED) : null;
    const title = this.title(copy.title);
    const note = this.note(copy.text);
    // Never the question after: it opens at the release's final end, its after-room's included, on its final page.
    const el = h(
      'section',
      { class: 'live__edge' },
      this.overline(this.name()),
      title,
      note,
      contact ? contactBlock(contact) : this.action(LIVE.back, () => this.deps.onReleases()),
    );
    // The release's end may say its reason after the page (SOLD OUT, CLOSED): the words follow it.
    const update = (): void => {
      const now = this.edgeCopy(kind);
      if (title.textContent !== now.title) title.replaceChildren(...withNumerals(now.title));
      if (note.textContent !== now.text) note.textContent = now.text;
    };
    return { kind, el, back: contact === null, update };
  }

  private edgeCopy(kind: LiveScreenKind): { title: string; text: string } {
    const e = LIVE.edge;
    switch (kind) {
      case 'missed':
        return e.missed;
      case 'expired':
        return e.expired;
      case 'released':
        return e.released;
      case 'left':
        return e.left;
      case 'removed':
        return e.removed;
      case 'ended':
        return e.ended[this.room?.endedReason ?? 'ENDED'];
      default:
        return this.afterRoomOf() ? LIVE.afterRoom.over : e.over;
    }
  }
}

/** Set a line's words, its figures in the reading face; nothing when they are the same (no reflow, nothing read again). */
function setFact(el: HTMLElement, text: string): void {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.replaceChildren(...withNumerals(text));
}

/** A check of READY CHECK: its tick when ready, a hairline dash otherwise (decorative: the row's words say it). */
function checkMark(ok: boolean): SVGSVGElement {
  return s(
    'svg',
    { class: 'live__check-mark', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: ok ? 'M2.5 7.5 L5.6 10.4 L11.5 3.8' : 'M3.5 7 L10.5 7' }),
  );
}

/** The data of a stream event, or null when it is not the JSON it should be. */
function parse<T>(ev: Event): T | null {
  try {
    const data = JSON.parse((ev as MessageEvent<string>).data) as T;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

