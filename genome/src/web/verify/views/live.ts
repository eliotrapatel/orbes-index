/**
 * A LIVE RELEASE's page (plan of 2026-10-04, The experience; mockups B1–B7, the VAULT look): /verify/releases/<id>,
 * which becomes, as the release advances, its room, its line, the turn, the piece secured and the reservation confirmed.
 * Before and after the room (announced, the end of a visit, its final page) it is drawn in NOCTURNE's pieces with its
 * chrome (plan NOCTURNE, screen 6, step N7: C20, C27–C30); inside the room (the door, the line, the turn, the hold,
 * CONFIRMED, the after-room) the vault as lot E built it, without the rail or the ring (choice 4, fidelity rule 6): the
 * page tells the app which it shows (`onChrome`).
 *
 *   announced   ‹ THE RELEASES · the photograph, faded (its silhouette before; the seal, the monogram, before either) ·
 *               LIVE RELEASE · its model with its variant (MONOLITHE / IN BLUE) · its type and collection · its price ·
 *               A SURPRISE IN EVERY BOX · SEE THE MODEL from the photograph's stage, when the model's sheet is public ·
 *               OPENS IN dd:hh:mm or hh:mm:ss · the time in Paris, then on this phone · its pieces, the limit per
 *               collector, when the room opens, its rule (several rules: WHO MAY ENTER, joined by OR, C27) · THE REVEALS
 *               still to come, each with its time (each stage appears at its own, the page reading the release again then)
 *               · N COLLECTORS WILL BE THERE · YOUR SIZE and I'LL BE THERE for an account the rule lets in (once said, YOU'LL
 *               BE THERE · SIZE 17 over the sizes: another size changes it, WITHDRAW until T0); signed out, I'LL BE THERE
 *               opens the sign-in; outside the rule, the rule and why (C28) · ADD TO CALENDAR · its description · how the
 *               places are drawn · HOW RELEASES WORK (plan NEXT-NINE, FT-01: the last line of each of NOCTURNE's pages)
 *   room        THE ROOM IS OPEN · the model, its price and the quantity line (SEE THE MODEL, as announced, until T0) ·
 *               the door, one hairline horizon (ONE QUEUE §3.4, D35): the countdown on ORBES time (its figures
 *               morphing), UNTIL THE OPENING and N IN THE ROOM in the light pooled above it, the point breathing at its
 *               seam · READY CHECK on hairlines · YOUR SIZE (the size of I'LL BE THERE preselected) · ENTER THE ROOM,
 *               then YOU'RE READY. The last ten seconds' figures tick as they morph (room-tick.mp3, the SOUND
 *               preference). At 00:00, on the server's second, the draw in place (D36): DRAWING THE PLACES and its
 *               sentence take the countdown's place, LIVE NOW the overline's, the point travels from the left
 *               along the line, draw.mp3; then THE OPENING (D42) at the later of the draw's landing and the entry's first
 *               reading with its place: the line parts, its light rises, the queue resolves under the same
 *               photograph, YOUR PLACE morphing in, opening.mp3 and the welcome voice once per entry (D46)
 *   join        after T0, an account not in the line: the piece, its size, ENTER THE LINE (behind those in it)
 *   queue       ONE QUEUE (lot Q1, ANSWERS C3): after T0 every entry waiting for its turn (the after-room's too, headed
 *               THE AFTER-ROOM, with no time): LIVE NOW, YOUR PLACE (its place in its size), PAUSED or THE QUEUE IS
 *               PAUSED with its line above the time, ESTIMATED 17 MINUTES LEFT (counted down on the page, frozen while
 *               paused), the pieces left, the one note, LEAVE THE LINE on a second tap; READING YOUR PLACE until its
 *               place is read. Never the pace, the line ahead of it, a clock time or a held piece. Sold out in its size:
 *               SOLD OUT, its one sentence, LEAVE THE LINE
 *   turn        PRESS AND HOLD THE SEAL: the turn's ring runs out, the hold's ring fills in 1.5 s, letting go
 *               resets it; the space bar or Enter holds it from the keyboard; a short vibration where allowed
 *   secured     the reveal: the seal's GENOME glyphs with P-D01's ceremony motion, the seal's glow, secured.mp3 and
 *               the vibration; then the piece, its size, the add-ons, PAY · total, 5:00 to confirm, RELEASE MY PLACE
 *   confirmed   in the vault (lot Q1 §3.7): its moment and confirmed.mp3, the photograph, CONFIRMED, the monogram on
 *               its horizon, the reservation, its receipt and reference, SHARE TO STORIES under it (plan NEXT-NINE,
 *               BP-10: the CONFIRMED story card), ORBES Client Services
 *   edge pages  inside the room: not signed in (the sign-in), not eligible, sold out in its size: a vault page with
 *               one action each. The end of a visit (C30): turn passed, hold ended, place released, left, removed, the
 *               release (or its after-room) ended, gone: the photograph, LIVE RELEASE and its day, its title, the outcome
 *               and its sentence, ORBES Client Services for an entry removed, THE RELEASES, HOW RELEASES WORK
 *   past        plan LIVE RELEASE+ (decision 30; C29): ended, the page in its final state, as THE RELEASES' PAST opens it:
 *               ‹ THE RELEASES · the photograph · LIVE RELEASE and its day · its title and line · its pieces as announced ·
 *               SEE THE MODEL · signed in, YOU TOOK PART or YOU SECURED A PIECE · THIS RELEASE IS OVER on a plate · a
 *               piece secured: CONFIRMED and its receipt, in the ivory kept from the room · its description · HOW
 *               RELEASES WORK. Never an end
 *               figure, nor how the account's entry ended (a guest of the after-room keeps the second door until it
 *               closes). For a week after the end, to an account that took part without a piece, ONE QUESTION, the
 *               question after (plan LIVE RELEASE+, choice 11; views/question.ts, a plate card), here and on the page of
 *               an entry ended by the release's end with no second door (CLOSED, or SOLD OUT without an after-room): it
 *               opens at the release's final end (its after-room's, when one opened), never before; on the final page,
 *               read again each minute while it may still open (an after-room running)
 *   after-room  plan LIVE RELEASE+ (choice 2): still in the line when the release sold out, its delay later, the
 *               second door in the same vault (THE AFTER-ROOM · A SECOND DOOR, the door and its lock, when it closes,
 *               ENTER THE AFTER-ROOM); the account's own entry says when it appears (`afterRoom`, its stream's last
 *               event), the page's pulse shows it then. The after-room's own page is this page with its sheet
 *               (`afterRoom`, read through the release it follows): THE AFTER-ROOM over its screens, your place from
 *               the line, then the turn, the hold, the add-ons and PAY as in the main room
 *
 * The room's foot (its screens out of NOCTURNE): HOW RELEASES WORK first (plan NEXT-NINE, FT-01; in a new tab while the
 * collector holds an entry, so the room stays), THE RELEASES, SOUND, the legal pages.
 *
 * Real time: the stream (EventSource, `room` and `you` events) while it is open; its state polled while it is not, as
 * often as the server's `pollMs` says (2 s, LIVE_POLL_MS by default), the stream tried again later. Behind the next ones
 * in the one queue (ONE QUEUE §1.3: no batch can reach it next) the server ends the stream and the page reads its state
 * only (10 s to a minute, its first read spread over LIVE_QUEUE_SPREAD_MS), until a batch can reach it. Every countdown counts on the server's
 * clock, synced by three round trips (clockOffset). Every action is a same-origin JSON call through ApiClient (the session, the CSRF token);
 * the server's refusals read as it wrote them. Reduced motion: cross-fades only. aria-live: the place, the turn, the
 * piece secured. One primary action per screen (filled ivory): ENTER, the size chosen, PAY.
 */
import { leftOutLines, withUnits } from '../addons-model.js';
import { h, prefersReducedMotion, s } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { GUARANTEE, HOW, LIVE, LOOKBOOK, PIECES, RELEASES, SETS, TIER } from '../copy.js';
import { CLUB_PATH } from '../club-model.js';
import { isDesktop, onDesktopChange, touchLayout } from '../../shared/desktop.js';
import { HOW_PATH } from '../how-model.js';
import {
  bandModel,
  clockOffset,
  clockText,
  CLOCK_SAMPLES,
  countdown,
  formatMoney,
  heldEntry,
  heldPieces,
  engravingProblem,
  engravingText,
  holdChoice,
  holdRows,
  HOLD_MS,
  initialPick,
  initialSetPick,
  interestLine,
  isEndedSheet,
  isSetEntry,
  liveReference,
  liveScreen,
  receiptAddonRows,
  securedAddons,
  securedChoice,
  type SecuredAddonsModel,
  liveSet,
  liveSetChoice,
  livePieces,
  liveSheetModel,
  livePastModel,
  liveHeading,
  liveStoryModel,
  pastDay,
  pickedLabels,
  pictureOf,
  pieceSizeChoices,
  queueModel,
  PRESS_GAP_MS,
  readyChecks,
  revealCalendar,
  roomSize,
  servable,
  setShort,
  setSizesLine,
  sizeChoices,
  tickSecond,
  drawnScreen,
  fillEase,
  holdPoint,
  payLight,
  phaseAt,
  windowLeft,
  zonedTime,
  type ClockSample,
  type InitialSizeFrom,
  type LivePicture,
  type LivePieceModel,
  type LiveScreenKind,
  type LiveViewer,
} from '../live-model.js';
import { horizonBand, morph } from '../live-horizon.js';
import { monogramSealSvg, sealCSvg, sealSvg } from '../live-seal.js';
import { entrySizes, participationModel, RELEASES_PATH, zonedDate, type SetCardModel } from '../releases-model.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import type { SessionStore } from '../session.js';
import type { LiveSound } from '../live-sound.js';
import type { AccountQuestion, LiveAccess, LiveEndedSheet, LiveEntry, LiveInterest, LiveRoom, LiveSheet, LiveState, PieceSizeRef } from '../types.js';
import { formatMoney as money, upper } from '../view-model.js';
import { referenceWords, releaseContext } from '../messages-model.js';
import { dayAndHour, legalLinks, lookbookLink, PIECES_PATH, piecesLink, releasesLink, soundToggle, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { appAnchor, button, copyrightLine, countdown as countdownView, fadedPhoto, failedState, icon, loadingState, modelTitle, monogram, photoTiles, sizeButtons, textLink } from './nocturne.js';
import { writeButton } from './write.js';
import { OwnershipPanel } from './ownership.js';
import { QuestionBlock } from './question.js';
import { CEREMONY_VIBRATION } from './result.js';
import { storyButton } from './story.js';
import { StoryCards } from '../story-card.js';
import { DesktopRoom, type RoomFacts } from './desktop-room.js';
import { SecuredAddonsView } from './secured-addons.js';

/** The state read while the stream is lost (in the room; the server says how often in the queue: `pollMs`). */
export const LIVE_POLL_MS = 2000;
/** The bounds of the server's `pollMs`: any other figure is not taken. */
const POLL_BOUNDS = Object.freeze({ min: 1000, max: 60_000 });
/** A stream refused or closed is asked for again after this long (the state is polled meanwhile). */
export const LIVE_STREAM_RETRY_MS = 15_000;
/**
 * W2: a page whose stream the server ends behind the next batch reads its state first within this long, at a moment of
 * its own (then as the state's `pollMs` says): a queue of thousands ended at the same pulse does not read at once.
 */
export const LIVE_QUEUE_SPREAD_MS = 60_000;
/** The page's own pulse: the countdowns, the lock, the ticks. */
const PULSE_MS = 250;
/**
 * THE OPENING, from the draw into the queue (ONE QUEUE §3.4; MK Q1 PLAY THE OPENING, gen.mjs TX_END open): its length
 * on a phone and on a computer, and when YOUR PLACE morphs in.
 */
const OPENING = Object.freeze({ phone: { ms: 2800, place: 1650 }, desk: { ms: 3000, place: 1750 } });
/** RELEASE MY PLACE and LEAVE THE LINE wait this long for their second tap. */
const ARMED_MS = 4000;
/** The turn arriving in place from the queue (§3.5, D42 01:03; gen.mjs TX_END turn 1750 / 1850 ms). */
const TURN_ARRIVAL = Object.freeze({ phone: 1750, desk: 1850 });
/**
 * The hold handing off to SECURED (§3.5, ROUND 5 "passages kept"; MK #turn-hold PLAY THE HOLD, gen.mjs hb-* keyframes:
 * the press at 0.35 s, the ring full at 1.85 s, the hand-off into the vault from 2.2 to 3.3 s, where SECURED begins):
 * from 0.35 s after the ring is full (or the piece secured, if later), 1.1 s long.
 */
const HANDOFF = Object.freeze({ wait: 350, ms: 1100 });
/**
 * SECURED's passage (§3.5; gen.mjs TX_END secured 4000 / 4250 ms) and PAY's light filling from 0 to the time left over
 * 1.1 s, eased, from 2.9 s on a phone and 3.1 s on a computer (gen.mjs TX_JS).
 */
const SECURED_TX = Object.freeze({ phone: { ms: 4000, fill: 2900 }, desk: { ms: 4250, fill: 3100 }, fillMs: 1100 });
/** The CONFIRMED moment (§3.7; MK #confirmed, gen.mjs cm-* timings: its last part ends at 3.4 s / 3.65 s). */
const CONFIRMED_TX = Object.freeze({ phone: 3400, desk: 3700 });
/** THE AFTER-ROOM's door opening (§3.9; gen.mjs TX_END after 3650 / 3850 ms). */
const AFTER_TX = Object.freeze({ phone: 3650, desk: 3850 });
/** A sync that failed is tried again after this long. */
const SYNC_RETRY_MS = 10_000;
/**
 * The question after not asked yet on a final page to an account that took part without a piece: read again this
 * often while the page stays open, for as long as a sold-out release's after-room may run (its delay, up to 60 minutes,
 * then its length, up to 120), since the question waits for its end.
 */
const QUESTION_AGAIN_MS = 60_000;
const QUESTION_WAIT_MS = 3 * 3_600_000;
/** The outer ring of the seal button (r 128) and the hold's ring (r 116), as the mockup draws them. */
const TURN_RING = 2 * Math.PI * 128;
const HOLD_RING = 2 * Math.PI * 116;

/** The entry statuses after which nothing changes for the account: the page stops following the room. */
const FINAL = new Set(['CONFIRMED', 'MISSED', 'EXPIRED', 'RELEASED', 'REMOVED', 'ENDED']);
/** The entry statuses still open while the release runs: a room over with one of them has not said its last word. */
const OPEN = new Set(['WAITING', 'QUEUED', 'TURN', 'SECURED']);
/**
 * The screens drawn in NOCTURNE with its chrome (choice 4; C20, C27–C30): the release announced, its final page, and the
 * pages that end a visit (fidelity rule 6). Every other screen is the room's, kept as lot E built it. On a computer the
 * pages that end a visit are the room's too (desktop, decision 7: stagedEnd).
 */
const END_PAGES: ReadonlySet<string> = new Set(['missed', 'expired', 'released', 'left', 'removed', 'ended', 'over']);

/**
 * ONE QUEUE's look (lot Q1 §3.1; ANSWERS C1, C2, r15b, r19, r20d; OP-5; D31, D32): on a phone, the model's photograph on
 * the top 300 of 844 px, ORBES (and the host's message, where the room shows it) on its darkened top, no corner marks,
 * no grey plate with corners: the room before the opening and its draw (2, 3, 3b), the one queue in every state and the
 * after-room's wait (A), SOLD OUT in your size (S), the turn and the hold (4, 4b), secured (5), CONFIRMED (6), the
 * after-room's door (10). Every other screen keeps its look (7, 8, 9, 11); the late comer's JOIN too, but its piece, drawn
 * as YOUR PIECE without a plate or corner marks (owner, 24 Oct: piece()).
 */
const LOOK: ReadonlySet<string> = new Set(['room', 'queue', 'soldOut', 'turn', 'secured', 'confirmed', 'afterRoom']);
/**
 * The room's variants for one who cannot enter yet (lot Q1 §3.11: `room-sign-in`, `room-not-eligible`): before the
 * opening they are screen 2 for that collector and take the look too, each with its own lines (no door: there is no
 * countdown to show them); after it they are the late comer's entry, unchanged (D32).
 */
const ROOM_EDGES: ReadonlySet<string> = new Set(['signin', 'notEligible']);

export interface LiveView {
  root: HTMLElement;
  dispose(): void;
}

export interface LiveDeps {
  api: ApiClient;
  session: SessionStore;
  /** The LIVE flow's designed sounds (lot Q1 §3.10, live-sound.ts), the device's SOUND preference (SOUND ON / OFF). */
  sound: Pick<LiveSound, 'on' | 'set' | 'prime' | 'cue' | 'stopAll'>;
  /**
   * THE VAULT's place (lot Q1 §3.6, OP-17, D48; filled by lot Q3): on SOLD OUT for your size, under its sentence and
   * before LEAVE THE LINE, and on the end page of a release sold out, under its sentence. Absent (Q1, or a release whose
   * vault is off): no element is added and both pages are as without it. `mount` returns what takes it down.
   */
  vault?: LiveVault;
  /** The release's page as read; null when it could not be read (`failure` says why). */
  sheet: LiveSheet | LiveEndedSheet | null;
  failure?: string;
  /** Read the release again (TRY AGAIN). */
  onRetry(): void;
  onReleases(): void;
  /** HOW RELEASES WORK (plan NEXT-NINE, FT-01): the last line of NOCTURNE's pages, the first of the room's foot. */
  onHow(): void;
  /** THE CLUB, in an end page's foot on a computer (desktop, decision 7: the app's footer is not shown there). */
  onClub?(): void;
  onPieces(): void;
  onScan(): void;
  /** SEE THE MODEL: the model's sheet in the lookbook (`/verify/lookbook/<slug>`), from the photograph's stage. */
  onModel(slug: string): void;
  /** ENTER THE AFTER-ROOM: the after-room of release `parentId` (the second door). */
  onAfterRoom(parentId: string): void;
  /** This phone's time zone (Intl), the second clock of the release's times. */
  localZone: string;
  /**
   * NOCTURNE's chrome (the header, the rail, the SCAN ring, the footer): shown on the release's pages before and after
   * the room (announced, its final page, the end of a visit), hidden inside it (choice 4: the door, the line, the turn,
   * the hold, CONFIRMED, the after-room), told at each change of screen. `drawn` (desktop, decision 7):
   * whether the chrome is on screen, false on a computer for an end page staged as the room (`shown` keeps its meaning).
   */
  onChrome?(shown: boolean, drawn?: boolean): void;
}

/** THE VAULT on a page of the release (lot Q3 fills it): mounted into its slot, taken down with the screen. */
export interface LiveVault {
  mount(slot: HTMLElement, at: 'soldOut' | 'end', ctx: { dropId: string; entryId: string | null }): () => void;
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

/** The turn's parts the hold draws on: its screen, its overline, the seal, the fill ring, its glow and its point. */
interface HoldParts {
  el: HTMLElement;
  overline: HTMLElement;
  button: HTMLElement;
  glow: SVGCircleElement;
  fill: SVGCircleElement;
  point: HTMLElement;
}

const isApi = (e: unknown, code: string) => e instanceof ApiError && e.code === code;

class LivePage {
  readonly root: HTMLElement;
  /** ONE QUEUE's look, on a phone (LOOK): the model's photograph behind the top of the screen; the Cinema room's on a computer. */
  private readonly photo = h('div', { class: 'live__photo', attrs: { 'aria-hidden': 'true' } });
  /** The photograph's address(es) on show (`|`-joined), '' for none; a picture that fails is not tried again. */
  private photoKey = '';
  private readonly photoFailed = new Set<string>();
  private readonly notice = h('div', { class: 'live__notice', attrs: { 'aria-live': 'polite' } });
  private readonly head = h('header', { class: 'live__head' }, h('span', { class: 'wordmark wordmark--small live__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }), this.notice);
  private readonly stage = h('div', { class: 'live__stage' });
  /** Desktop (decision 7): the Cinema room, on a computer only (views/desktop-room.ts); null on a phone. */
  private cinema: DesktopRoom | null = null;
  private offDesktop: (() => void) | null = null;
  private readonly foot = h('footer', { class: 'live__foot' });
  /**
   * HOW RELEASES WORK, first in the room's foot (plan NEXT-NINE, FT-01): in the app; in a new tab while the collector holds
   * an entry, so the room stays where it is (syncHowFoot, at each render).
   */
  private readonly howFoot = h('a', { class: 'textlink live__how', attrs: { href: HOW_PATH }, text: HOW.link, on: { click: (ev) => this.openHowFromFoot(ev) } });
  private readonly polite = h('p', { class: 'visually-hidden', attrs: { role: 'status', 'aria-live': 'polite' } });
  private readonly assertive = h('p', { class: 'visually-hidden', attrs: { 'aria-live': 'assertive' } });
  private sheet: LiveSheet | LiveEndedSheet | null;
  private room: LiveRoom | null = null;
  /** ONE QUEUE: the server's time of the reading that brought the entry's place and estimate (its `queue`), or null. */
  private queueRead: number | null = null;
  /** How often the state is read without a stream: the server's `pollMs` (10 s to a minute in the queue), 2 s by default. */
  private pollMs = LIVE_POLL_MS;
  private entry: LiveEntry | null = null;
  private access: LiveAccess | null = null;
  /** IN-01: the house's guarantee set aside for this release, shown to the account (its pieces), or null. */
  private guarantee: { pieces: number } | null = null;
  /** AC-01: the size YOUR SIZES preselects (the server's, without an entry or an interest), or null. */
  private savedSize: { id: string; label: string } | null = null;
  /** AC-01: the size picked is YOUR SIZES' and not confirmed yet (no size tapped, nothing pressed). */
  private fromYours = false;
  /** Macro scope K44 T1: on a set's release, the size YOUR SIZES preselects for each piece that has one (the server's). */
  private savedSizes: PieceSizeRef[] = [];
  /**
   * Macro scope K44 T1: on a set's release, the size picked for each piece and where it comes from (`hand`: tapped; a
   * size from YOUR SIZES is to be confirmed by a tap or by entering). The entry's own once entered.
   */
  private setPicked = new Map<number, { sizeId: string; from: InitialSizeFrom | 'hand' }>();
  private interest: LiveInterest | null = null;
  /** BP-10: the CONFIRMED story card of each entry, drawn once (a screen built again reuses it). */
  private readonly stories = new StoryCards();
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
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** W2: the entry waits behind the next batch (`queue.next` false): no stream, its state read (`pollMs`). */
  private behind = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private screen: Screen | null = null;
  private signIn: OwnershipPanel | null = null;
  /** The sign-in under I'LL BE THERE on the announced page, once asked for (signed out). */
  private thereSignIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private busy = false;
  private error: string | null = null;
  /** The size and quantity picked before entering (the entry's own once entered). */
  private picked: { sizeId: string | null; quantity: number } = { sizeId: null, quantity: 1 };
  /**
   * The draw (ONE QUEUE §3.4): when the room's countdown reached 00:00 on this page (performance.now's clock, read back
   * to the server's second), null before. The room stays the draw until THE OPENING may start (drawnScreen).
   */
  private drawAt: number | null = null;
  /** The entry the welcome voice was asked for on this page (THE OPENING's, or a late comer's first reading). */
  private welcomeFor: string | null = null;
  /** The turn just came, and a size's pieces were all held before it: a piece has returned. */
  private returned = false;
  /** A room seen while the entry waited in the line had no piece free in its size. */
  private sizeWasFull = false;
  /** The secure was sent from this page's seal, for the turn under way. */
  private securing = false;
  /** The piece was secured on this page: the secured screen opens with the reveal (consumed when it mounts). */
  private reveal = false;
  private hold: Hold | null = null;
  /** When the hold's ring was full (performance.now), null before. */
  private fullAt: number | null = null;
  /**
   * The hold handing off to SECURED (§3.5; MK #turn-hold): the turn kept on show until `until` (performance.now) while
   * its rings and words fade and the seal dissolves into a faint glow; SECURED then mounts with its passage.
   */
  private handoff: { until: number; timers: ReturnType<typeof setTimeout>[] } | null = null;
  /** RELEASE MY PLACE or LEAVE THE LINE armed for its second tap until this time (performance.now). */
  private armedUntil = 0;
  /**
   * Plan MACRO M3 §4.4 (D2): the catalogue add-ons' units as the collector set them on the hold while their choice is
   * being sent (the entry's own once it answers); and PAY's answer of what could not be added, kept for its entry.
   */
  private itemUnits: Map<string, number> | null = null;
  /** 5b (lot Q2, step Q2.8): the engraving's words typed on YOUR TEXT and not yet saved, by add-on; the save under way. */
  private readonly addonDrafts = new Map<string, string>();
  private textSave: Promise<void> | null = null;
  /** The engraving whose words typed the house cannot engrave (its sentence in the error line), until they change. */
  private textInvalid: string | null = null;
  private leftOut: { entryId: string; lines: string[] } | null = null;
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
  /** The question after read again (QUESTION_AGAIN_MS), and since when it is (Date.now()). */
  private questionTimer: ReturnType<typeof setTimeout> | null = null;
  private questionSince: number | null = null;
  private disposed = false;

  constructor(private readonly deps: LiveDeps) {
    this.root = viewRoot('live', 'live-title');
    this.root.classList.add('vault');
    this.sheet = deps.sheet;
    this.root.append(
      this.photo,
      this.head,
      this.stage,
      this.foot,
      this.polite,
      this.assertive,
    );
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    // A window crossing the desktop breakpoint: the room staged for the computer, or back as the phone draws it. An end
    // page changes its look and chrome with it (NOCTURNE's on a phone, the room's on a computer): drawn again.
    this.offDesktop = onDesktopChange((desktop) => {
      if (!desktop) this.cinema?.undo();
      if (this.screen && END_PAGES.has(this.screen.kind)) this.rebuild();
      else if (this.screen) {
        // The room's foot in the order of the window's layout (SOUND in the legal row on a computer, apart on a phone).
        this.renderFoot(this.screen);
        if (desktop) this.stageRoom();
      }
    });
    this.render();
    if (this.sheet) void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.endPassage();
    this.deps.sound.stopAll();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.offDesktop?.();
    this.offDesktop = null;
    this.cinema?.undo();
    this.signIn?.dispose();
    this.signIn = null;
    this.thereSignIn?.dispose();
    this.thereSignIn = null;
    this.endHold(true);
    this.endHandoff();
    this.closeStream();
    this.stopPolling();
    for (const t of [this.retryTimer, this.syncTimer, this.questionTimer]) if (t) clearTimeout(t);
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
      if (this.questionTimer) clearTimeout(this.questionTimer);
      this.questionTimer = null;
      this.questionSince = null;
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
    this.guarantee = state.guarantee ?? null;
    this.savedSize = state.savedSize ?? null;
    this.savedSizes = Array.isArray(state.savedSizes) ? state.savedSizes : [];
    if (state.room) this.setRoom(state.room);
    this.setPollMs(state.pollMs);
    this.setEntry(state.entry, Date.parse(state.now));
    this.settle();
  }

  /** The server's `pollMs` (within its bounds, LIVE_POLL_MS otherwise): a polling under way takes it at once. */
  private setPollMs(ms: unknown): void {
    const next = typeof ms === 'number' && Number.isFinite(ms) && ms >= POLL_BOUNDS.min && ms <= POLL_BOUNDS.max ? ms : LIVE_POLL_MS;
    if (next === this.pollMs) return;
    this.pollMs = next;
    if (this.pollTimer) {
      this.stopPolling();
      this.startPolling();
    }
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

  /** `readAt`: the server's time of the reading that brought it (a stream's event, a state read); none for an action's answer. */
  private setEntry(entry: LiveEntry | null, readAt?: number): void {
    const before = this.entry?.status;
    if (entry?.status === 'TURN' && before !== 'TURN') this.returned = this.sizeWasFull;
    // The reveal on the transition itself, whichever brings it first (the secure's answer, the stream, a poll).
    if (before === 'TURN' && entry?.status === 'SECURED' && this.securing) {
      this.reveal = true;
      this.handOff();
    }
    if (entry?.status !== 'TURN') this.securing = false;
    if (entry?.status !== 'QUEUED' && entry?.status !== 'TURN') this.sizeWasFull = false;
    this.entry = entry;
    // ONE QUEUE: the time left counts down from the reading that brought it (D9: the time ticks, the place moves at readings).
    if (entry?.queue) this.queueRead = readAt !== undefined && Number.isFinite(readAt) ? readAt : this.now();
    // In the line without its place (an action's answer: ENTER THE LINE after the opening, D15), the stream lost: its
    // place read now, not at the next poll; READING YOUR PLACE meanwhile.
    if (entry?.status === 'QUEUED' && !entry.queue && this.connection !== 'live' && this.viewer === 'ready' && !this.done()) void this.readState(false);
    const held = heldEntry(entry);
    if (held) {
      this.picked = { sizeId: held.size.id, quantity: held.quantity };
      this.fromYours = false;
      if (held.sizes?.length) this.setPicked = new Map(held.sizes.map((x) => [x.piece, { sizeId: x.id, from: 'entry' as const }]));
    } else if (this.isSet()) {
      this.preselectSet();
    } else if (this.picked.sizeId === null && this.sheet && !isEndedSheet(this.sheet)) {
      const first = initialPick(this.sheet, entry, this.interest, this.savedSize);
      this.picked = { sizeId: first.sizeId, quantity: this.picked.quantity };
      this.fromYours = first.from === 'saved';
    }
    this.trackQueue();
  }

  /**
   * ONE QUEUE (§1.3): only an entry a batch can reach next follows the stream. Behind, the server ends its stream (the
   * page stops it there, `follow`'s error) and refuses a new one: its state is read as often as `pollMs` says, its time
   * counted down between two readings. Next, or its turn come: the stream.
   */
  private trackQueue(): void {
    const was = this.behind;
    this.behind = this.entry?.queue?.next === false;
    if (this.disposed || this.viewer !== 'ready' || this.done()) return;
    if (this.behind && !this.stream) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.startPolling();
    } else if (!this.behind && was && !this.stream) this.follow();
  }

  /** AC-01: the two lines under the sizes while the size picked is YOUR SIZES' and not confirmed; null otherwise. */
  private fromYoursLines(): { size: string; check: string } | null {
    if (!this.fromYours || this.interest || heldEntry(this.entry)) return null;
    const label = this.sizeLabel(this.picked.sizeId);
    return label === null ? null : { size: LIVE.there.fromYours(label), check: LIVE.there.checkSize };
  }

  // ── A set's release (macro scope K44 T1, T4) ─────────────────────────────

  /** The release sells a set: a size per piece, its quantity in sets. */
  private isSet(): boolean {
    return !!this.sheet?.set;
  }

  /** A set's pieces with their sizes, in the set's order (none on a model's release, or once over). */
  private pieces(): LivePieceModel[] {
    const s = this.live();
    return s?.set ? livePieces(s) : [];
  }

  /**
   * Each piece's size preselected (initialSetPick: the entry's, I'LL BE THERE's, YOUR SIZES', the only one), a size
   * tapped kept over it while it is still the piece's.
   */
  private preselectSet(): void {
    const pieces = this.pieces();
    const next = new Map<number, { sizeId: string; from: InitialSizeFrom | 'hand' }>(initialSetPick(pieces, this.entry, this.interest, this.savedSizes));
    for (const [piece, v] of this.setPicked) {
      if (v.from === 'hand' && pieces.some((p) => p.piece === piece && p.sizes.some((z) => z.id === v.sizeId))) next.set(piece, v);
    }
    this.setPicked = next;
  }

  /** The sizes the entry (or I'LL BE THERE) sends, once every piece has one; null while one is missing. */
  private setChoice(): { piece: number; sizeId: string }[] | null {
    return liveSetChoice(this.pieces(), this.setPicked);
  }

  /** The sizes picked on one line (`SIZE 17 · 52 · 45`), once every piece has one; null otherwise. */
  private setPickedLine(): string | null {
    const labels = pickedLabels(this.pieces(), this.setPicked);
    return labels ? SETS.live.sizes(labels) : null;
  }

  /** AC-01 for a set: a piece's size is YOUR SIZES' and not confirmed yet (nothing said, nothing entered). */
  private setFromYours(): boolean {
    if (this.interest || heldEntry(this.entry)) return false;
    return [...this.setPicked.values()].some((v) => v.from === 'saved');
  }

  /**
   * The pickers of a set (macro scope K44 T1): for each piece its name and type over its sizes (a size with no piece left
   * greyed, as a model's), the size YOUR SIZES preselects said under it while it stands; YOUR SIZES' check once under
   * them all. `nocturne`: NOCTURNE's buttons, under I'LL BE THERE; `room`: the room's own (choice 4). `choosing` (the
   * room): before ENTER, the sizes picked are outlined (ENTER is the one filled action); once entered, filled.
   */
  private setPickers(look: 'nocturne' | 'room', onPick: (piece: number, sizeId: string) => void): { el: HTMLElement; update(choosing?: boolean): void } {
    const nocturne = look === 'nocturne';
    const parts: { p: LivePieceModel; buttons: Map<string, HTMLButtonElement>; yours: HTMLElement }[] = [];
    const blocks: HTMLElement[] = [];
    for (const p of this.pieces()) {
      const id = `live-piece-${p.piece}`;
      const name = h('p', { class: nocturne ? 'n-g n-lb n-ivc n-live__piece-name' : 'live__overline live__piece-name', id }, ...withNumerals(p.line));
      const buttons = new Map<string, HTMLButtonElement>();
      let grid: HTMLElement;
      if (nocturne) {
        grid = sizeButtons(p.sizes, { selected: this.setPicked.get(p.piece)?.sizeId ?? null, label: SETS.pickerLabel(p.name), onSelect: (sizeId) => onPick(p.piece, sizeId) });
        grid.classList.add('n-live__sizes');
        grid.removeAttribute('aria-label');
        grid.setAttribute('aria-labelledby', id);
        [...grid.querySelectorAll<HTMLButtonElement>('button')].forEach((b, i) => {
          b.classList.add('live__size');
          buttons.set(p.sizes[i]!.id, b);
        });
      } else {
        grid = h('div', { class: 'live__sizes', attrs: { role: 'group', 'aria-labelledby': id } });
        for (const z of p.sizes) {
          const b = h('button', { class: 'btn live__size', attrs: { type: 'button' }, on: { click: () => onPick(p.piece, z.id) } }, h('span', { class: 'live__size-label', text: z.label }));
          buttons.set(z.id, b);
          grid.append(b);
        }
      }
      const yours = h('p', { class: nocturne ? 'n-g n-lb n-live__yours live__yours' : 'live__overline live__yours', attrs: { hidden: true } });
      parts.push({ p, buttons, yours });
      blocks.push(h('div', { class: nocturne ? 'n-live__piece live__piece' : 'live__piece', data: { piece: String(p.piece) } }, name, grid, yours));
    }
    const check = h('p', { class: nocturne ? 'n-sm n-live__yours-check live__yours-check' : 'live__note live__yours-check', attrs: { hidden: true }, text: SETS.checkSizes });
    const el = h('div', { class: nocturne ? 'n-live__set-pickers live__set-pickers' : 'live__set-pickers' }, ...blocks, check);
    return {
      el,
      update: (choosing?: boolean) => {
        const fromYours = this.setFromYours();
        for (const { p, buttons, yours } of parts) {
          const picked = this.setPicked.get(p.piece) ?? null;
          for (const c of pieceSizeChoices(p, this.room, picked?.sizeId ?? null)) {
            const b = buttons.get(c.id);
            if (!b) continue;
            b.setAttribute('aria-pressed', String(c.selected));
            b.disabled = this.busy || (!c.available && !c.selected);
            if (!c.available) b.setAttribute('aria-label', LIVE.soldOutSize(c.label));
            else b.removeAttribute('aria-label');
            b.classList.toggle('is-gone', !c.available);
          }
          const saved = fromYours && picked?.from === 'saved' ? p.sizes.find((z) => z.id === picked.sizeId) : undefined;
          yours.hidden = !saved;
          setFact(yours, saved ? LIVE.there.fromYours(saved.label) : '');
        }
        check.hidden = !fromYours;
        if (choosing !== undefined) el.classList.toggle('is-choosing', choosing);
      },
    };
  }

  /**
   * The two lines (AC-01), drawn under a size picker, hidden while there is nothing to confirm: in NOCTURNE's pieces
   * under I'LL BE THERE, in the room's own look (choice 4) under its picker.
   */
  private yoursBlock(look: 'nocturne' | 'room'): { el: HTMLElement; update(): void } {
    const nocturne = look === 'nocturne';
    const size = h('p', { class: nocturne ? 'n-g n-lb n-live__yours live__yours' : 'live__overline live__yours' });
    const check = h('p', { class: nocturne ? 'n-sm n-live__yours-check live__yours-check' : 'live__note live__yours-check', text: LIVE.there.checkSize });
    const el = h('div', { class: nocturne ? 'n-live__yours-block live__yours-block' : 'live__yours-block live__yours-block--room', attrs: { hidden: true } }, size, check);
    return {
      el,
      update: () => {
        const lines = this.fromYoursLines();
        el.hidden = lines === null;
        setFact(size, lines?.size ?? '');
      },
    };
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

  /** Follow the room: its stream, or its state every `pollMs` while the stream is lost (or behind the next batch, W2). */
  private follow(): void {
    if (this.disposed || this.viewer !== 'ready' || this.done()) return;
    if (this.stream) return;
    if (this.behind) {
      this.startPolling();
      return;
    }
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
      this.setEntry(data.entry, Date.parse(data.now));
      this.settle();
      this.render();
    });
    es.addEventListener('error', () => {
      if (this.stream !== es) return;
      this.connection = 'reconnecting';
      // Behind the next ones (ONE QUEUE), the server has ended the stream after its place and the room: not asked for
      // again; the state read from a moment of its own within LIVE_QUEUE_SPREAD_MS, then as `pollMs` says.
      if (this.behind) {
        es.close();
        this.stream = null;
        this.startPolling(Math.random() * LIVE_QUEUE_SPREAD_MS);
        this.screen?.update();
        return;
      }
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

  /** Read the state every `pollMs` (as it is at each read), the first after `firstMs`. */
  private startPolling(firstMs = this.pollMs): void {
    if (this.pollTimer || this.done()) return;
    const tick = (ms: number): void => {
      this.pollTimer = setTimeout(() => {
        tick(this.pollMs);
        void this.readState(false);
      }, ms);
    };
    tick(firstMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
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
    // The chain room → draw → THE OPENING (§3.4, N16): the draw in full from 00:00, the next screen at the later of its
    // landing and the entry's first reading with its place (at once on that reading under reduced motion).
    // The hold handing off to SECURED (§3.5): the turn stays on show until its hand-off ends.
    if (this.handoff && this.screen?.kind === 'turn' && kind === 'secured' && performance.now() < this.handoff.until) return 'turn';
    if (this.screen?.kind !== 'room') return kind;
    const opened = !isEndedSheet(sheet) && this.now() >= Date.parse(this.room?.opensAt ?? sheet.opensAt);
    return drawnScreen({ next: kind, drawAt: this.drawAt, opened, now: performance.now(), placed: !!this.entry?.queue, reduced: prefersReducedMotion() });
  }

  private render(): void {
    if (this.disposed) return;
    const kind = this.kind();
    if (!this.screen || this.screen.kind !== kind) this.mount(kind);
    else this.screen.update();
    this.renderNotice();
    this.renderPhoto();
    this.syncHowFoot();
    if (this.cinema && isDesktop()) this.cinema.update(this.roomFacts());
  }

  /** Desktop (decision 7): the screen on show staged as the Cinema room, on a computer. */
  private stageRoom(): void {
    if (!this.screen || !isDesktop()) return;
    this.cinema ??= new DesktopRoom(this.root, this.head, this.notice);
    this.cinema.arrange(this.screen.kind, this.screen.el, this.roomFacts());
  }

  /**
   * What the Cinema room's corners say (decision 7): the release's photograph, its title with its variant, the account's
   * choice on the screens of the line (`SIZE 17 · 1 PIECE`; at the turn its price after it, as the seal's line says it),
   * the people in the room.
   */
  private roomFacts(): RoomFacts {
    const sheet = this.sheet;
    const picture = sheet ? pictureOf(sheet) : null;
    const e = heldEntry(this.entry);
    const kind = this.screen?.kind;
    let choice: string | null = null;
    if (e && (kind === 'queue' || kind === 'soldOut' || kind === 'turn')) {
      choice = this.choiceOf(e);
      if (kind === 'turn') choice = `${choice} · ${formatMoney(e.priceMinor * e.quantity, e.currency)}`;
    }
    // A set's: its pieces' photographs side by side, the window's ground (from the photograph's stage).
    const tiles = sheet ? liveSet(sheet) : null;
    return {
      photos: tiles && tiles.images.length > 1 ? tiles.images.map((x) => x.src) : null,
      photo: picture?.kind === 'photo' ? picture.src : null,
      name: this.name(),
      model: sheet?.name ? upper(sheet.name) : this.name(),
      heading: (sheet ? liveHeading(sheet) : null) ?? this.name(),
      choice,
      count: this.room?.inRoom ?? null,
    };
  }

  /**
   * The account's choice (ONE QUEUE, D21, D34): `SIZE 52 · 1 PIECE`; a set's every size and its sets (macro scope K44 T1:
   * `SIZE 17 · 52 · 45 · 1 SET`). Under the name on the phone, in the Cinema room's corner on a computer.
   */
  private choiceOf(e: LiveEntry): string {
    return e.sizes?.length ? `${setSizesLine(e)} · ${SETS.live.sets(e.quantity)}` : LIVE.choice(e.size.label, e.quantity);
  }

  /** The release's title with its variant (MONOLITHE IN BLUE), as the Cinema room's corner says it; its name otherwise. */
  private heading(): string {
    const s = this.live();
    return (s ? liveHeading(s) : null) ?? this.name();
  }

  /**
   * The phone's lines under the name on the screens of the entry (ONE QUEUE, MK Q1, S; D34): its choice, then the people
   * in the room; on a computer the Cinema room's corners say both (desktop-room.ts). `choice`: the turn's (its price after
   * it, as the Cinema room's corner says it there).
   */
  private entryLines(choiceOf: (e: LiveEntry) => string = (e) => this.choiceOf(e)): { el: HTMLElement[]; update(): void } {
    const choice = this.fact('', 'live__choice live__phone-only');
    const presence = h('p', { class: 'live__presence live__entry-count live__phone-only' }, h('span', { class: 'live__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'live__presence-text' }));
    return {
      el: [choice, presence],
      update: () => {
        const e = heldEntry(this.entry);
        setFact(choice, e ? choiceOf(e) : '');
        choice.hidden = !e;
        const n = this.room?.inRoom ?? 0;
        setFact(presence.lastChild as HTMLElement, LIVE.inRoom(n));
        presence.hidden = n <= 0;
      },
    };
  }

  /** The room's HOW RELEASES WORK opens a new tab while the collector holds an entry, the app's page otherwise. */
  private syncHowFoot(): void {
    const apart = this.entry !== null;
    if ((this.howFoot.getAttribute('target') === '_blank') === apart) return;
    if (apart) {
      this.howFoot.setAttribute('target', '_blank');
      this.howFoot.setAttribute('rel', 'noopener');
    } else {
      this.howFoot.removeAttribute('target');
      this.howFoot.removeAttribute('rel');
    }
  }

  private openHowFromFoot(ev: MouseEvent): void {
    this.syncHowFoot();
    // A new tab (the entry held, or asked for by the reader) is the browser's; a plain click otherwise stays in the app.
    if (this.howFoot.getAttribute('target') === '_blank' || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    this.deps.onHow();
  }

  /** THE CLUB in an end page's foot on a computer (decision 7): in the app, as the app's footer opens it. */
  private openClub(ev: MouseEvent): void {
    if (!this.deps.onClub || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    this.deps.onClub();
  }

  /** HOW RELEASES WORK, the last line of NOCTURNE's pages of the release (announced, its end pages, its final page). */
  private howLine(): HTMLElement {
    return h('p', { class: 'n-px n-ctr n-live__how' }, textLink(HOW.link, { href: HOW_PATH, onOpen: () => this.deps.onHow(), extraClass: 'n-live__how-link' }));
  }

  /** Build the screen again (the release read again). */
  private rebuild(): void {
    if (this.screen) this.mount(this.screen.kind);
  }

  private mount(kind: LiveScreenKind | 'failed'): void {
    const hadFocus = this.root.contains(document.activeElement) || document.activeElement === document.body;
    const previous = this.screen?.kind;
    // Lot Q1 §3.10: a screen change stops what still sounds (or waits to) for the screen leaving.
    if (previous !== kind) this.deps.sound.stopAll();
    this.screen?.dispose?.();
    this.error = previous === kind ? this.error : null;
    const revealing = kind === 'secured' && this.reveal;
    this.reveal = false;
    // SOLD OUT's passage starts from the queue's horizon, where its band was (read before the queue gives way).
    const horizon = previous === 'queue' && kind === 'soldOut' ? this.screen?.el.querySelector('.live-hz__line')?.getBoundingClientRect() ?? null : null;
    // THE OPENING (§3.4): from the draw as it is, into the queue; the welcome voice is THE OPENING's then (D46).
    const opening = previous === 'room' && kind === 'queue' && this.drawAt !== null && this.entry !== null;
    const draw = opening && !prefersReducedMotion() && this.screen ? this.drawAsItIs(this.screen.el) : null;
    if (opening) this.welcomeFor = this.entry!.id;
    // YOUR TURN in place (§3.5, D42 01:03): the queue's place and time, where they stood, fade as the seal arrives.
    const arriving = previous === 'queue' && kind === 'turn' && !prefersReducedMotion() && this.screen ? this.queueAsItIs(this.screen.el) : null;
    const screen = this.build(kind, revealing);
    this.screen = screen;
    screen.el.classList.add('live__screen');
    // The Cinema room (a computer): what the screen leaving had borrowed (the host's messages) back in its place first.
    this.cinema?.release();
    this.stage.replaceChildren(screen.el);
    this.root.dataset.screen = kind;
    // Before and after the room, NOCTURNE's look and chrome; inside it, the room's own (choice 4, fidelity rule 6). On a
    // computer the end pages are the room's too (desktop, decision 7): its look, no menu, SCAN or account.
    const nocturne = this.nocturne(kind);
    const look = nocturne && !this.stagedEnd(kind);
    this.root.classList.toggle('is-nocturne', look);
    this.deps.onChrome?.(nocturne, look);
    // Every screen in the vault: CONFIRMED too, in both modes (lot Q1 §3.7, OP-2: "CONFIRMED in the dark world").
    this.root.classList.add('vault');
    this.renderFoot(screen);
    screen.update();
    this.renderPhoto();
    this.stageRoom();
    if (previous !== undefined && hadFocus) (screen.focus ?? screen.el.querySelector<HTMLElement>('h1'))?.focus({ preventScroll: kind !== 'turn' });
    if (kind !== previous && kind === 'turn') this.say(this.returned ? LIVE.announce.returned : LIVE.announce.turn, true);
    if (kind !== previous && revealing) this.say(LIVE.announce.secured(this.name()));
    if (kind !== previous && kind === 'afterRoom') this.say(LIVE.afterRoom.announce);
    this.endPassage();
    if (horizon && horizon.width > 0) this.soldPassage(horizon);
    // The turn's sound as it arrives (SFX_AT turn, 0.3 s), whatever it came from; its passage from the queue.
    if (kind === 'turn' && previous !== undefined && previous !== 'turn') this.deps.sound.cue('turn');
    if (arriving) this.turnPassage(arriving);
    if (revealing) this.securedPassage();
    // The CONFIRMED moment, as the payment goes through on this page (§3.7, D42; MK #confirmed PLAY THE MOMENT).
    if (kind === 'confirmed' && previous === 'secured') this.confirmedMoment();
    // The second door opening (§3.9, ROUND 5 "passages kept"; MK #after-door PLAY THE AFTER-ROOM), the passage into it
    // from the screen before it; a page opened or reloaded on the door shows it at rest.
    if (kind === 'afterRoom' && previous !== undefined && previous !== 'loading' && previous !== 'afterRoom') this.afterPassage();
    if (opening) {
      // Its sounds from its start, the screen mounted (mount stops the room's): opening.mp3, then the welcome voice once.
      this.deps.sound.cue('open', { entryId: this.entry?.id ?? null, afterRoom: !!this.afterRoomOf() });
      if (draw) this.openingPassage(draw);
    }
  }

  /** The passage under way (its class on the page, its own elements, its end), if any. */
  private passage: { cls: string; parts: HTMLElement[]; timer: ReturnType<typeof setTimeout>; done?: () => void } | null = null;

  /**
   * SOLD OUT's passage, the quieter one (lot Q1 §3.6; ANSWERS C16, ROUND 5; MK S, gen.mjs TX_END sold 3650 / 3800 ms):
   * the queue's horizon where its band was, its light withdrawing, its point going, the line dimming, then the screen
   * coming up (house.css .live--tx-sold); sold-out.mp3 at 0.25 s of its start (SFX_AT sold). Reduced motion: none.
   */
  private soldPassage(at: DOMRect): void {
    if (prefersReducedMotion()) return;
    const shz = h(
      'div',
      { class: 'live-tx-shz', attrs: { 'aria-hidden': 'true' } },
      h('span', { class: 'live-tx-shz__sky' }),
      h('span', { class: 'live-tx-shz__line' }),
      h('span', { class: 'live-tx-shz__pt' }),
    );
    // Where the band's horizon stood, in the window (CSSOM custom properties, the house's pattern for a measure).
    shz.style.setProperty('--live-tx-top', `${Math.round(at.top + at.height / 2)}px`);
    shz.style.setProperty('--live-tx-left', `${Math.round(at.left)}px`);
    shz.style.setProperty('--live-tx-width', `${Math.round(at.width)}px`);
    this.root.prepend(shz);
    this.root.classList.add('live--tx-sold');
    this.deps.sound.cue('sold');
    const ms = isDesktop() ? 3800 : 3650;
    this.passage = { cls: 'live--tx-sold', parts: [shz], timer: setTimeout(() => this.endPassage(), ms) };
  }

  /**
   * The draw as it stands when THE OPENING begins (§3.4; MK Q1 PLAY THE OPENING, gen.mjs TX_DOOR): its door (the line,
   * its point wherever it has travelled, its light, the drawing's words and the room count) and the room's lines that
   * leave with it (the name and its pieces on the phone, the pieces on the computer), each copied where it stands; and
   * where the parts that glide on the computer stand (LIVE NOW, the name, the host's message).
   */
  private drawAsItIs(room: HTMLElement): DrawGhosts | null {
    const door = room.querySelector<HTMLElement>('.live-hzd');
    const line = door?.querySelector<HTMLElement>('.live-hzd__horizon');
    const pt = door?.querySelector<HTMLElement>('.live-hzd__pt');
    if (!door || !line || !pt) return null;
    const lr = line.getBoundingClientRect();
    if (lr.width <= 0) return null;
    const pr = pt.getBoundingClientRect();
    const from = Math.min(100, Math.max(0, ((pr.left + pr.width / 2 - lr.left) / lr.width) * 100));
    const desk = isDesktop() && this.root.classList.contains('d-room');
    const ghosts = [ghost(door, room, 'live-tx-ghost--door')];
    const copy = ghosts[0]!.querySelector<HTMLElement>('.live-tx-ghost--door');
    copy?.style.setProperty('--live-tx-from', `${from.toFixed(3)}%`);
    // In place (the countdown's place kept, the words on the line where it stood), or the draw's still.
    copy?.classList.toggle('is-overlay', room.classList.contains('is-drawing'));
    for (const sel of desk ? [':scope .d-room__bl > .live__offer'] : [':scope > .live__title', ':scope > .live__offer']) {
      const el = room.querySelector<HTMLElement>(sel);
      if (el && el.getBoundingClientRect().height > 0) ghosts.push(ghost(el, room, 'live-tx-ghost--was'));
    }
    const at = (el: Element | null | undefined) => el?.getBoundingClientRect() ?? null;
    return {
      ghosts,
      glides: desk ? { head: at(room.querySelector('.d-room__head > .live__overline')), name: at(room.querySelector('.d-room__bl > .live__title')), notice: at(this.notice) } : null,
    };
  }

  /**
   * THE OPENING (§3.4; ANSWERS C16, 18:00; MK Q1 PLAY THE OPENING; gen.mjs TX_END open 2800 / 3000 ms, its CSS): over the
   * queue just mounted, the draw as it stood: its point glides back to the centre from wherever it is, the line parts there
   * (a point to each end), the light rises through the gap, the drawing's words, the room count, the name and its pieces
   * fade; LIVE NOW stays (on the computer it glides to its place, as do the name and the host's message); then the queue
   * resolves under the same photograph, YOUR PLACE morphing in (house.css .live--tx-open). Reduced motion: none of it.
   */
  private openingPassage(draw: DrawGhosts): void {
    const el = this.screen?.el;
    if (!el) return;
    const veil = h('div', { class: 'live-tx-open', attrs: { 'aria-hidden': 'true', inert: true } }, ...draw.ghosts);
    this.root.prepend(veil);
    const desk = draw.glides !== null;
    // On the computer, LIVE NOW, the name and the host's message glide from where the draw had them.
    const glide = (to: Element | null, from: DOMRect | null): void => {
      if (!(to instanceof HTMLElement) || !from) return;
      const now = to.getBoundingClientRect();
      if (now.height <= 0 || from.height <= 0) return;
      to.classList.add('live-tx-glide');
      to.style.setProperty('--live-tx-dx', `${Math.round(from.left - now.left)}px`);
      to.style.setProperty('--live-tx-dy', `${Math.round(from.top - now.top)}px`);
    };
    if (draw.glides) {
      glide(el.querySelector('.d-room__head > .live__overline'), draw.glides.head);
      glide(el.querySelector('.d-room__bl > .live__title'), draw.glides.name);
      glide(this.notice, draw.glides.notice);
    }
    this.root.classList.add('live--tx-open');
    const timing = desk ? OPENING.desk : OPENING.phone;
    // YOUR PLACE morphs in as its line appears (the figures' own morph, from nothing).
    const figure = el.querySelector<HTMLElement>('.live__place-figure');
    const placeTimer = figure
      ? setTimeout(() => {
          if (figure.isConnected) morph(figure, figure.dataset.morph ?? figure.textContent ?? '', { numerals: false, appear: true });
        }, timing.place)
      : null;
    const parts: HTMLElement[] = [veil];
    const done = (): void => {
      if (placeTimer) clearTimeout(placeTimer);
      for (const g of this.root.querySelectorAll<HTMLElement>('.live-tx-glide')) {
        g.classList.remove('live-tx-glide');
        g.style.removeProperty('--live-tx-dx');
        g.style.removeProperty('--live-tx-dy');
      }
    };
    this.passage = { cls: 'live--tx-open', parts, timer: setTimeout(() => this.endPassage(), timing.ms), done };
  }

  /** The queue's place and time where they stand as the turn arrives (§3.5): a copy of each, to fade where it stood. */
  private queueAsItIs(queue: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const sel of ['.live__place-label', '.live__place', '.live__queue-time']) {
      const el = queue.querySelector<HTMLElement>(sel);
      if (el && el.getBoundingClientRect().height > 0) out.push(ghost(el, queue, 'live-tx-ghost--q'));
    }
    return out;
  }

  /**
   * YOUR TURN arriving in place (§3.5; ANSWERS 23 Oct 01:03 "no transition screen"; MK #turn PLAY THE TURN, gen.mjs
   * TX_END turn 1750 / 1850 ms): under the same photograph, the queue's place and time fade out where the seal arrives,
   * the seal fades in, its countdown ring draws to the time left, then the words resolve (house.css .live--tx-turn).
   */
  private turnPassage(ghosts: HTMLElement[]): void {
    const veil = h('div', { class: 'live-tx-turn', attrs: { 'aria-hidden': 'true', inert: true } }, ...ghosts);
    this.root.prepend(veil);
    this.root.classList.add('live--tx-turn');
    const ms = isDesktop() ? TURN_ARRIVAL.desk : TURN_ARRIVAL.phone;
    this.passage = { cls: 'live--tx-turn', parts: [veil], timer: setTimeout(() => this.endPassage(), ms) };
  }

  /**
   * SECURED's passage (§3.5; ROUND 5 "passages kept"; MK #secured PLAY SECURED, gen.mjs TX_END secured 4000 / 4250 ms),
   * from the hold's hand-off: the horizon under YOUR PIECE draws out from the centre, the seal settles from a glow to
   * crisp ink, the light pools, the photograph comes forward, the words resolve, then PAY draws in and its light fills
   * to the time left (securedScreen); secured.mp3 at 0.6 s (house.css .live--tx-secured). Reduced motion: none of it.
   */
  private securedPassage(): void {
    if (prefersReducedMotion()) return;
    this.root.classList.add('live--tx-secured');
    const ms = isDesktop() ? SECURED_TX.desk.ms : SECURED_TX.phone.ms;
    this.passage = { cls: 'live--tx-secured', parts: [], timer: setTimeout(() => this.endPassage(), ms) };
  }

  /**
   * The CONFIRMED moment (§3.7; ANSWERS C15, C16, 22 Oct 16:30 "we don't need that seal, do something begtter", liked
   * 16:42; MK #confirmed PLAY THE MOMENT, gen.mjs cm-* rules, 3.4 s on a phone, 3.7 s on a computer): the screen settles
   * into the vault (a veil of the vault's ground lifting), the horizon draws out from the centre and fades at both ends,
   * the monogram resolves at its seam from a soft glow (6 %) to crisp ink (its glow 8 %), the light pools above it, the
   * photograph comes forward, CONFIRMED resolves, then LIVE RELEASE · MONOLITHE, then the practical part (house.css
   * .live--tx-confirmed). No seal, no flash, no bounce. confirmed.mp3 0.6 s in (SFX_AT confirmed), reduced motion too;
   * under reduced motion the page at once.
   */
  private confirmedMoment(): void {
    this.deps.sound.cue('confirmed');
    if (prefersReducedMotion()) return;
    const veil = h('div', { class: 'live-tx-veil', attrs: { 'aria-hidden': 'true' } });
    this.root.prepend(veil);
    this.root.classList.add('live--tx-confirmed');
    const ms = isDesktop() ? CONFIRMED_TX.desk : CONFIRMED_TX.phone;
    this.passage = { cls: 'live--tx-confirmed', parts: [veil], timer: setTimeout(() => this.endPassage(), ms) };
  }

  /**
   * THE AFTER-ROOM's door opening (§3.9; ANSWERS 16:42–16:43 "the line opens again", ROUND 5 "passages kept"; MK
   * #after-door PLAY THE AFTER-ROOM, gen.mjs TX_END after 3650 / 3850 ms): the door's horizon draws out from the centre,
   * closed, then opens again, a point going to each parted end, the light coming up through the gap; the photograph
   * comes forward; THE AFTER-ROOM, A SECOND DOOR, then its sentence and the rest (house.css .live--tx-after).
   * after-room.mp3 1.15 s in (SFX_AT after), reduced motion too; under reduced motion the page at once.
   */
  private afterPassage(): void {
    this.deps.sound.cue('after');
    if (prefersReducedMotion()) return;
    const veil = h('div', { class: 'live-tx-veil', attrs: { 'aria-hidden': 'true' } });
    this.root.prepend(veil);
    this.root.classList.add('live--tx-after');
    const ms = isDesktop() ? AFTER_TX.desk : AFTER_TX.phone;
    this.passage = { cls: 'live--tx-after', parts: [veil], timer: setTimeout(() => this.endPassage(), ms) };
  }

  /** The passage ends (its time over, the page leaving, or another screen): the page as it is, nothing held. */
  private endPassage(): void {
    const p = this.passage;
    if (!p) return;
    this.passage = null;
    clearTimeout(p.timer);
    this.root.classList.remove(p.cls);
    for (const part of p.parts) part.remove();
    p.done?.();
  }

  /** Whether screen `kind` is one of NOCTURNE's, with its chrome: announced, failed, the final page, an end page (or loading it). */
  private nocturne(kind: LiveScreenKind | 'failed'): boolean {
    if (kind === 'announced' || kind === 'past' || kind === 'failed') return true;
    if (kind === 'loading') return isEndedSheet(this.sheet);
    return END_PAGES.has(kind);
  }

  /** Desktop (decision 7): an end page on a computer, staged as the Cinema room (views/desktop-room.ts). */
  private stagedEnd(kind: LiveScreenKind | 'failed'): boolean {
    return END_PAGES.has(kind) && isDesktop();
  }

  private say(text: string, urgent = false): void {
    const region = urgent ? this.assertive : this.polite;
    region.textContent = '';
    // A new text node in a cleared region is announced even when the words repeat.
    requestAnimationFrame(() => {
      region.textContent = text;
    });
  }

  /**
   * The host message and the pause, under the header, on the screens of the room and the queue: on the queue the host
   * message only, its PAUSED (or THE QUEUE IS PAUSED) above its frozen time (ONE QUEUE, OP-6, N10: never twice).
   */
  private renderNotice(): void {
    const kind = this.screen?.kind;
    const live = kind === 'room' || kind === 'join' || kind === 'queue' || kind === 'soldOut' || kind === 'turn' || kind === 'secured';
    const room = this.room;
    const parts: HTMLElement[] = [];
    if (live && kind !== 'queue' && room?.paused) parts.push(h('p', { class: 'live__paused' }, h('span', { class: 'live__notice-label', text: LIVE.paused }), h('span', { class: 'live__notice-text', text: LIVE.pausedLine })));
    if (live && room?.message) parts.push(h('p', { class: 'live__message' }, h('span', { class: 'live__notice-label', text: LIVE.message }), h('span', { class: 'live__notice-text', text: room.message.text })));
    const key = parts.map((p) => p.textContent).join('|');
    if (this.notice.dataset.key === key) return;
    this.notice.dataset.key = key;
    this.notice.replaceChildren(...parts);
  }

  /**
   * ONE QUEUE's look on a phone (LOOK; D31, OP-5): the release's model (variant) photograph behind the top of the screen
   * (a set's pieces side by side, as the Cinema room has them), faded at its foot, darkened at its top for ORBES and the
   * host's message; none before the photograph is revealed, nor once it cannot be loaded: the vault's ground alone, the
   * screen moved up. The Cinema room draws its own on a computer (house.css shows this one on a phone only).
   */
  private renderPhoto(): void {
    const kind = this.screen?.kind;
    const sheet = this.sheet;
    const look = kind !== undefined && (LOOK.has(kind) || (ROOM_EDGES.has(kind) && !!sheet && !isEndedSheet(sheet) && phaseAt(sheet, this.room, this.now()) === 'ROOM'));
    const tiles = sheet ? liveSet(sheet) : null;
    const picture = sheet ? pictureOf(sheet) : null;
    const all = tiles && tiles.images.length > 1 ? tiles.images.map((x) => x.src) : picture?.kind === 'photo' ? [picture.src] : [];
    const srcs = all.filter((src) => !this.photoFailed.has(src));
    const key = srcs.join('|');
    if (key !== this.photoKey) {
      this.photoKey = key;
      this.photo.classList.toggle('live__photo--tiles', srcs.length > 1);
      this.photo.replaceChildren(
        ...srcs.map((src) => {
          // Drawn as the ground of its frame (CSSOM, the house's pattern: the address is the server's media path), so the
          // crop runs past the screen's edges without a picture wider than the page; a picture that fails gives way.
          const shot = h('span', { class: 'live__photo-shot' });
          shot.style.setProperty('--live-photo', `url("${src}")`);
          const probe = new Image();
          probe.addEventListener(
            'error',
            () => {
              this.photoFailed.add(src);
              if (!this.disposed) this.renderPhoto();
            },
            { once: true },
          );
          probe.src = src;
          return shot;
        }),
      );
    }
    this.root.classList.toggle('live--look', look);
    this.root.classList.toggle('live--photo', look && srcs.length > 0);
  }

  private renderFoot(screen: Screen): void {
    const kind = screen.kind;
    // NOCTURNE's screens have the chrome's footer (SOUND, the legal pages) and THE RELEASES in their own words.
    const end = this.stagedEnd(kind);
    if (this.nocturne(kind) && !end) {
      this.foot.replaceChildren();
      return;
    }
    // A page whose one action is THE RELEASES: the foot does not say it twice. HOW RELEASES WORK comes first (FT-01).
    const back = screen.back ? null : releasesLink(() => this.deps.onReleases(), { extraClass: 'live__releases' });
    const sound = kind === 'confirmed' ? null : soundToggle(this.deps.sound, 'live__sound');
    // An end page on a computer (decision 7): the room's foot, with what the app's footer says there on a phone (THE
    // CLUB, the copyright line), so nothing of the page goes (decision 12).
    const club = end ? h('a', { class: 'textlink live__club', attrs: { href: CLUB_PATH }, text: TIER.club, on: { click: (ev) => this.openClub(ev) } }) : null;
    const legal = legalLinks({ extraClass: 'live__legal' });
    // On a computer the foot is one row with SOUND at its right end (desktop, decision 7): SOUND after the legal
    // pages and before DB-IP's line, so the tab order follows the eye (§10.17). The phone's foot keeps its order.
    const soundInLegal = sound !== null && isDesktop();
    if (soundInLegal) legal.insertBefore(sound, legal.querySelector(':scope > .legal-links__credit'));
    this.syncHowFoot();
    this.foot.replaceChildren(...[this.howFoot, back, club, soundInLegal ? null : sound, legal, end ? copyrightLine('live__cr') : null].filter((x): x is HTMLElement => x !== null));
  }

  private build(kind: LiveScreenKind | 'failed', revealing = false): Screen {
    switch (kind) {
      case 'failed':
        return this.failedScreen();
      case 'loading':
        return { kind, el: h('section', { class: 'live__waiting' }, h('h1', { class: 'visually-hidden', id: 'live-title', text: LIVE.kind }), loadingState(LIVE.loading)), update: () => undefined };
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
      case 'queue':
        return this.queueScreen();
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

  /**
   * The release as a message's CONCERNING names it (CS-01): its title (MONOLITHE IN BLUE), as the server labels a
   * RELEASE context and as MY PIECES' entries do (live-model.ts myLiveEntries), its model's name before the title is told.
   */
  private releaseTitle(): string {
    const s = this.sheet;
    return upper(s?.title ?? s?.name ?? '') || LIVE.kind;
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

  /** The pieces the account may take: the release's per collector, or (IN-01) its guarantee's when higher. */
  private maxPieces(s: { perAccount: number }): number {
    return Math.max(s.perAccount, this.guarantee?.pieces ?? 0);
  }

  /** IN-01: the room's line under the size chooser, while a guarantee shown to the account applies here; '' otherwise. */
  private guaranteeLine(s: { perAccount: number }): string {
    return this.guarantee || this.entry?.guaranteed === true ? GUARANTEE.liveRoom(this.maxPieces(s)) : '';
  }

  /**
   * The piece on the vault: its photograph, else its silhouette, else the seal; a picture that fails takes the seal's place.
   * Macro scope K44 T1: a set's pieces, their photographs side by side (`set`, from the photograph's stage).
   * The late comer's JOIN (owner, 24 Oct, ANSWERS «Q1 BUILD QUESTIONS — DECIDED»: no plate with corners anywhere in the
   * release): drawn as YOUR PIECE on SECURED, no grey plate, no corner marks; the picture's edges dissolving into the
   * vault, standing in the light pooled over a hairline horizon (house.css .live__plate--join). The room's door is a
   * horizon since lot Q1 §3.4.
   */
  private piece(picture: LivePicture | null, extra: string, sweep = false, set: SetCardModel | null = null): HTMLElement {
    const plate = h('div', { class: ['live__plate', extra] });
    const seal = () => sealSvg('live__plate-seal');
    if (set && set.images.length > 1) {
      plate.classList.add('live__plate--tiles');
      for (const image of set.images) {
        const img = h('img', { class: ['live__img', 'live__img--photo', 'live__img--tile'], attrs: { src: image.src, alt: image.alt, decoding: 'async' } });
        img.addEventListener(
          'error',
          () => {
            img.remove();
            if (!plate.querySelector('img')) {
              plate.classList.remove('live__plate--tiles');
              plate.prepend(seal());
            }
          },
          { once: true },
        );
        plate.append(img);
      }
    } else if (picture) {
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
    // Its horizon, as YOUR PIECE's (securedScreen): a hairline dissolving at its ends, the light pooled above it.
    plate.append(h('span', { class: 'live__floor', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'live__floor-sky' }), h('span', { class: 'live__floor-line' })));
    return plate;
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
    // Could not be shown (C40): the release's kind as the page's title, the sentence, the reason, TRY AGAIN.
    const el = h(
      'section',
      { class: 'n-live__failed' },
      h('div', { class: 'n-px n-live__plain' }, h('h1', { class: 'n-g n-t1', id: 'live-title', attrs: { tabindex: '-1' }, text: LIVE.kind })),
      h('div', { class: 'n-px n-live__state' }, failedState({ sentence: LIVE.loadFailed, reason: this.deps.failure ?? '', retry: LIVE.retry, onRetry: () => this.deps.onRetry(), retryClass: 'n-live__retry' })),
    );
    return { kind: 'failed', el, update: () => undefined };
  }

  /** ‹ THE RELEASES, over a release's pages before and after the room (C20, C27, C29). */
  private crumb(): HTMLAnchorElement {
    return appAnchor(RELEASES_PATH, ['n-g', 'n-crumb', 'n-live__crumb'], () => this.deps.onReleases(), icon('back', { small: true }), LIVE.back);
  }

  /**
   * The release's photograph (its silhouette before), whole and faded, and its words lifted onto its foot; without one
   * (or once it cannot be loaded) its seal, the words under it.
   */
  private hero(picture: LivePicture | null, words: HTMLElement, set: SetCardModel | null = null): HTMLElement[] {
    // Macro scope K44 T1: a set's pieces, their photographs side by side from the photograph's stage (the house's crop).
    if (set && set.images.length > 1) {
      words.classList.add('n-lift');
      const tiles = photoTiles(set.images, {
        eager: true,
        extraClass: 'n-live__photo n-live__tiles',
        onEmpty: () => {
          tiles.replaceWith(this.seal());
          words.classList.remove('n-lift');
          words.classList.add('n-live__sealed');
        },
      });
      return [tiles, words];
    }
    if (!picture) {
      // Not revealed yet (or never): its seal, the monogram, as THE RELEASES draws it (C7); never the ORBES code.
      words.classList.add('n-live__sealed');
      return [this.seal(), words];
    }
    words.classList.add('n-lift');
    const photo = fadedPhoto(picture.src, picture.alt, { eager: true, extraClass: ['n-live__photo', picture.kind === 'silhouette' ? 'n-live__photo--silhouette' : ''].join(' ').trim() });
    photo.querySelector('img')?.classList.add('n-live__img', `n-live__img--${picture.kind}`);
    photo.querySelector('img')?.addEventListener(
      'error',
      () => {
        photo.replaceWith(this.seal());
        words.classList.remove('n-lift');
        words.classList.add('n-live__sealed');
      },
      { once: true },
    );
    return [photo, words];
  }

  /** The seal of a release whose picture is not revealed: the monogram in its ring (C7), decorative. */
  private seal(): HTMLElement {
    return h('div', { class: 'n-ctr n-live__seal' }, h('div', { class: 'n-seal' }, monogram(54)));
  }

  /**
   * B1, the release announced (C20; C27 with its surprise and several rules): ‹ THE RELEASES; its photograph; LIVE
   * RELEASE, its title (the model's name on a line of its own), its type and collection, its price, A SURPRISE IN EVERY
   * BOX, SEE THE MODEL; OPENS IN and its countdown on the server's clock; its day and hour in Paris (then on this phone);
   * its pieces, the limit per collector, when the room opens and its rule (several rules: WHO MAY ENTER, joined by OR);
   * the reveals still to come; N COLLECTORS WILL BE THERE and I'LL BE THERE; ADD TO CALENDAR; its description; how the
   * places are drawn.
   */
  private announcedScreen(): Screen {
    const s = this.live()!;
    const m = liveSheetModel(s, this.deps.localZone);
    const clock = countdownView(countdown(Date.parse(s.opensAt) - this.now()).map((g) => [g.value, g.unit] as const));
    clock.removeAttribute('aria-label');
    clock.setAttribute('aria-labelledby', 'live-opens');
    clock.classList.add('n-live__countdown');
    const values = [...clock.querySelectorAll<HTMLElement>('.n-cd__value')];
    const units = [...clock.querySelectorAll<HTMLElement>('.n-cd__unit')];
    const several = m.rules.length > 1;
    const lines = [m.pieces, m.perAccount, m.roomOpens, ...(several ? [] : [m.access])].filter((x) => x.length > 0);
    const dates = revealCalendar(s);
    const title = modelTitle('h1', ['n-g', 'n-t1', 'n-live__title'], m.heading, m.named ? m.name : null);
    title.id = 'live-title';
    title.tabIndex = -1;
    const see = m.lookbook ? textLink(LOOKBOOK.seeModel, { href: lookbookSheetPath(m.lookbook), onOpen: () => this.deps.onModel(m.lookbook!), extraClass: 'n-live__see' }) : null;
    const there = this.thereBlock();
    const tail = [
      h('p', { class: 'n-live__calendar-line' }, h('a', { class: 'n-g n-tl n-live__calendar', attrs: { href: m.calendarHref, download: 'orbes-live-release.ics' }, text: LIVE.calendar })),
      storyBlock(m.description, { className: 'n-live__description', paragraphClass: 'n-tx' }),
      h('p', { class: 'n-sm n-live__rule', text: m.rule }),
    ];
    const words = h(
      'div',
      { class: 'n-px n-ctr n-live__words' },
      h('p', { class: 'n-g n-lb n-live__kind', text: LIVE.kind }),
      title,
      m.line ? h('p', { class: 'n-g n-lb n-live__type' }, ...withNumerals(m.line)) : null,
      m.set?.names ? h('p', { class: 'n-g n-lb n-live__set-names' }, ...withNumerals(m.set.names)) : null,
      h('p', { class: 'n-num n-live__price', text: m.price }),
      m.set ? h('p', { class: 'n-g n-lb n-live__one-price', text: SETS.onePrice }) : null,
      m.surprise ? h('p', { class: 'n-g n-live__surprise', text: m.surprise }) : null,
      see ? h('p', { class: 'n-live__see-line' }, see) : null,
      h('p', { class: 'n-g n-lb n-live__opens', id: 'live-opens', text: LIVE.opensIn }),
      clock,
      h('p', { class: 'n-g n-lb n-live__when' }, ...withNumerals(m.when.paris)),
      m.when.local ? h('p', { class: 'n-g n-lb n-live__local' }, ...withNumerals(m.when.local)) : null,
      h('div', { class: 'n-lines n-live__lines' }, ...lines.map((l, i) => h('span', { class: ['n-g', 'n-lines__line', i === 0 ? 'n-ivc' : null] }, ...withNumerals(l)))),
      dates.length
        ? h(
            'div',
            { class: 'n-live__reveals live__reveals', attrs: { role: 'group', 'aria-labelledby': 'live-reveals' } },
            h('p', { class: 'n-g n-lb n-ivc n-live__reveals-title', id: 'live-reveals', text: LIVE.reveals }),
            h(
              'div',
              { class: 'n-lines n-live__reveals-lines' },
              ...dates.map((d) => h('span', { class: 'n-g n-lines__line n-live__reveal' }, h('span', { class: 'n-live__reveal-stage', text: d.label }), ' · ', dayAndHour(d.when, 'n-live__reveal-when'))),
            ),
          )
        : null,
      ...(several ? [] : [there.el, ...tail]),
    );
    const rules = several
      ? h(
          'section',
          { class: 'n-px n-ctr n-live__rules', attrs: { 'aria-labelledby': 'live-who' } },
          h('h2', { class: 'n-g n-lb n-live__who', id: 'live-who', text: LIVE.whoMayEnter }),
          h('p', { class: 'n-g n-t3 n-ivc n-live__rule-list' }, ...m.rules.flatMap((r, i) => [...(i > 0 ? [h('br'), h('span', { class: 'n-lb', text: LIVE.or }), h('br')] : []), ...withNumerals(r)])),
        )
      : null;
    const el = h(
      'section',
      { class: 'n-livepage n-live__announced live__announced' },
      this.crumb(),
      ...this.hero(m.picture, words, m.set),
      rules,
      several ? h('div', { class: 'n-px n-ctr n-live__after-rules' }, there.el, ...tail) : null,
      this.howLine(),
    );
    return {
      kind: 'announced',
      el,
      focus: title,
      update: () => {
        there.update();
        countdown(Date.parse(s.opensAt) - this.now()).forEach((p, i) => {
          if (values[i] && values[i]!.textContent !== p.value) values[i]!.textContent = p.value;
          if (units[i] && units[i]!.textContent !== p.unit) units[i]!.textContent = p.unit;
        });
      },
    };
  }

  /**
   * I'LL BE THERE on the announced page (C20, C28): the public count; for an account the rule lets in, YOUR SIZE, the
   * sizes and the action (once said, YOU'LL BE THERE · SIZE 17 over the sizes: another size changes it, WITHDRAW takes it
   * back, until T0); signed out, I'LL BE THERE as a text link opening the sign-in; outside the rule, the rule and why.
   * Its part is built again only when what it offers changes.
   */
  private thereBlock(): { el: HTMLElement; update(): void } {
    const count = h('p', { class: 'n-g n-lb n-live__interest live__there-count' });
    const body = h('div', { class: 'n-live__there-body' });
    const el = h('section', { class: 'n-live__there live__there', attrs: { 'aria-label': LIVE.there.action } }, count, body);
    let mode = '';
    let refresh: () => void = () => undefined;
    const build = (next: string): void => {
      mode = next;
      refresh = () => undefined;
      const s = this.live();
      if (!s) return body.replaceChildren();
      switch (next) {
        case 'signed-out': {
          const open = h('button', { class: 'n-g n-tl n-live__there-open', attrs: { type: 'button' }, text: LIVE.there.action });
          // Macro scope K44 T1: a set's, with a size for each piece.
          const signInLead = this.isSet() ? SETS.live.there.signIn : LIVE.there.signIn;
          const lead = h('p', { class: 'n-sm n-live__there-lead', text: signInLead });
          const panel = h('div', { class: 'n-live__panel live__there-panel' });
          const show = (): void => {
            this.thereSignIn ??= new OwnershipPanel({ kind: 'account', lead: signInLead }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
            panel.replaceChildren(this.thereSignIn.root);
            // The sign-in says the same sentence: it stands alone.
            open.parentElement!.hidden = true;
            lead.hidden = true;
          };
          open.addEventListener('click', () => {
            show();
            // (On a computer, the line to the sign-in page: its SIGN IN.)
            panel.querySelector<HTMLElement>('input, .d-signin-line__in')?.focus();
          });
          body.replaceChildren(h('p', { class: 'n-live__there-open-line' }, open), lead, panel);
          // Opened before (the page drawn again since): it stays open.
          if (this.thereSignIn) show();
          return;
        }
        case 'not-eligible': {
          // The rule (when it is one), why, and that the account does not meet it (C28, states 3 to 5).
          const s2 = this.live();
          const single = s2 ? liveSheetModel(s2, this.deps.localZone).rules.length <= 1 : true;
          body.replaceChildren(
            h(
              'div',
              { class: 'n-live__refusal live__there-rule' },
              single && s2 ? h('p', { class: 'n-g n-t3 n-ivc n-live__refusal-rule' }, ...withNumerals(LIVE.forWhom(s2.access.text))) : null,
              this.refusal ? h('p', { class: 'n-tx n-live__refusal-why' }, ...withNumerals(this.refusal)) : null,
              h('p', { class: 'n-sm n-live__refusal-note', text: LIVE.edge.notEligible.text }),
            ),
          );
          return;
        }
        case 'choose':
        case 'said': {
          const said = h('p', { class: 'n-g n-t3 n-ivc n-live__said live__there-said' });
          // Macro scope K44 T1: a set's, YOUR SIZES over a picker per piece (each with YOUR SIZES' line), said with every size.
          const set = this.isSet();
          const label = h('p', { class: 'n-g n-lb n-live__size-label', id: 'live-size', text: set ? SETS.yourSizes : LIVE.yourSize });
          const sizes = set ? this.setPickers('nocturne', (piece, id) => this.pickTherePiece(piece, id)) : this.sizes();
          // AC-01: the size YOUR SIZES preselects, to check before I'LL BE THERE.
          const yours = this.yoursBlock('nocturne');
          const lead = h('p', { class: 'n-sm n-live__there-lead', text: next === 'said' ? LIVE.there.change : set ? SETS.live.there.lead : LIVE.there.lead });
          const errorLine = h('p', { class: 'n-sm n-ivc n-live__error form__error', attrs: { role: 'alert', hidden: true } });
          const action = button(LIVE.there.action, { extraClass: 'n-live__there-action', onClick: () => this.sayThere() });
          const withdraw = button(LIVE.there.withdraw, { outline: true, extraClass: 'n-live__withdraw', onClick: () => void this.setThere(null) });
          // Said: the size said stands in YOUR SIZE's place over the sizes (C28, state 1); the group keeps its name.
          // IN-01: under I'LL BE THERE, the house's guarantee shown to the account.
          const guaranteed = this.guarantee ? h('p', { class: 'n-sm n-live__there-lead live__guarantee', text: GUARANTEE.liveAnnounced }) : null;
          body.replaceChildren(...[next === 'said' ? said : label, sizes.el, next === 'said' || set ? null : yours.el, lead, errorLine, next === 'said' ? withdraw : action, guaranteed].filter((x): x is HTMLElement => x !== null));
          if (!set) sizes.el.setAttribute('aria-label', LIVE.yourSize);
          refresh = () => {
            const i = this.interest;
            setFact(said, i ? (set && i.sizes?.length ? SETS.live.there.said(entrySizes(i)) : LIVE.there.said(i.size.label)) : '');
            sizes.update();
            yours.update();
            this.showError(errorLine);
            action.disabled = this.busy || (set ? this.setChoice() === null : this.picked.sizeId === null);
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

  /**
   * The sizes of I'LL BE THERE (C20, C28): each a 78 × 54 button in the reading face, the one picked (or said) doubly
   * ringed; one with no piece left to give is said so and cannot be picked.
   */
  private sizes(): { el: HTMLElement; update(): void } {
    const s = this.live()!;
    const choices = sizeChoices(s, this.room, this.picked.sizeId);
    const el = sizeButtons(
      choices.map((c) => ({ id: c.id, label: c.label })),
      { selected: this.picked.sizeId, label: LIVE.yourSize, onSelect: (id) => this.pickThere(id) },
    );
    el.classList.add('n-live__sizes');
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
    buttons.forEach((b) => b.classList.add('live__size'));
    return {
      el,
      update: () => {
        sizeChoices(s, this.room, this.picked.sizeId).forEach((c, i) => {
          const b = buttons[i];
          if (!b) return;
          b.setAttribute('aria-pressed', String(c.selected));
          b.disabled = this.busy || (!c.available && !c.selected);
          if (!c.available) b.setAttribute('aria-label', LIVE.soldOutSize(c.label));
          else b.removeAttribute('aria-label');
          b.classList.toggle('is-gone', !c.available);
        });
      },
    };
  }

  /** A size picked under I'LL BE THERE: kept until it is said; once said, the interest changed to it. */
  private pickThere(sizeId: string): void {
    if (this.busy) return;
    if (this.interest) {
      if (this.interest.size.id !== sizeId) void this.setThere(sizeId);
      return;
    }
    // AC-01: a size tapped is the collector's own: the lines of YOUR SIZES go.
    this.fromYours = false;
    this.picked = { ...this.picked, sizeId };
    this.screen?.update();
  }

  private sayThere(): void {
    if (this.isSet()) {
      const choice = this.setChoice();
      if (choice) void this.setThere(choice);
      return;
    }
    const sizeId = this.picked.sizeId;
    if (sizeId) void this.setThere(sizeId);
  }

  /**
   * Macro scope K44 T1: a piece's size picked under I'LL BE THERE: kept until it is said; once said, the interest changed
   * to it (every piece's size sent again, this one changed).
   */
  private pickTherePiece(piece: number, sizeId: string): void {
    if (this.busy) return;
    const said = this.interest?.sizes;
    if (this.interest && said?.length) {
      if (said.find((x) => x.piece === piece)?.id === sizeId) return;
      void this.setThere(said.map((x) => ({ piece: x.piece, sizeId: x.piece === piece ? sizeId : x.id })));
      return;
    }
    this.setPicked.set(piece, { sizeId, from: 'hand' });
    this.screen?.update();
  }

  /**
   * I'LL BE THERE with a size (null: withdrawn). The public count follows the account's own change at once (the next read
   * of the release brings everyone's); a refusal reads as the server wrote it, the rule's own (403) saying it instead.
   */
  private async setThere(choice: string | readonly { piece: number; sizeId: string }[] | null): Promise<void> {
    const s = this.live();
    if (!s || this.busy) return;
    this.busy = true;
    this.error = null;
    this.screen?.update();
    const before = this.interest;
    const from = document.activeElement;
    try {
      let after: LiveInterest | null = null;
      if (choice === null) await this.deps.api.liveWithdrawInterest(s.id);
      else after = await this.deps.api.liveInterest(s.id, choice);
      if (this.disposed) return;
      this.interest = after;
      if (after) {
        this.picked = { ...this.picked, sizeId: after.size.id };
        this.fromYours = false;
        // A set's: every piece's size as said.
        for (const x of after.sizes ?? []) this.setPicked.set(x.piece, { sizeId: x.id, from: 'interest' });
      }
      const delta = (after ? 1 : 0) - (before ? 1 : 0);
      const sheet = this.live();
      if (delta !== 0 && sheet) this.sheet = { ...sheet, interest: Math.max(0, sheet.interest + delta) };
      this.say(after ? (after.sizes?.length ? SETS.live.there.said(entrySizes(after)) : LIVE.there.said(after.size.label)) : LIVE.there.withdrawn);
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
    if (from && !from.isConnected) requestAnimationFrame(() => this.root.querySelector<HTMLElement>('.n-live__there .live__size[aria-pressed="true"], .n-live__there-action')?.focus({ preventScroll: isDesktop() }));
  }

  private signInScreen(): Screen {
    const s = this.live();
    const rule = s ? s.access.text : '';
    this.signIn ??= new OwnershipPanel({ kind: 'account', lead: LIVE.edge.signIn.text(rule) }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan(), look: 'vault' });
    const el = h('section', { class: 'live__edge live__signin' }, this.overline(this.name()), this.title(LIVE.edge.signIn.title), h('div', { class: 'live__panel' }, this.signIn.root));
    return { kind: 'signin', el, update: () => undefined };
  }

  private notEligibleScreen(): Screen {
    const s = this.live();
    const el = h(
      'section',
      { class: 'live__edge' },
      // In an after-room, its edge pages say so: the release itself had sold out before.
      this.overline(this.afterRoomOf() ? LIVE.afterRoom.kind : this.name()),
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
    const max = onQuantity ? this.maxPieces(s) : 1;
    const value = h('span', { class: 'live__qty-value', attrs: { 'aria-live': 'polite' } });
    const fewer = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': LIVE.fewer }, on: { click: () => onQuantity?.(this.picked.quantity - 1) }, text: '−' });
    const more = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': LIVE.more }, on: { click: () => onQuantity?.(this.picked.quantity + 1) }, text: '+' });
    const quantity = max > 1 ? h('div', { class: 'live__qty', attrs: { role: 'group', 'aria-labelledby': 'live-qty' } }, h('span', { class: 'live__overline', id: 'live-qty', text: LIVE.quantity }), fewer, value, more) : null;
    // AC-01: the size YOUR SIZES preselects, to confirm by a tap or by entering.
    const yours = this.yoursBlock('room');
    const el = h('div', { class: 'live__picker' }, label, grid, yours.el, quantity);
    return {
      el,
      update: (choosing: boolean) => {
        el.classList.toggle('is-choosing', choosing);
        yours.update();
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

  /**
   * Macro scope K44 T1, T4: a set's YOUR SIZES in the room and after T0 (a picker per piece, setPickers), then its
   * quantity in sets (`1 SET PER PERSON`: no stepper; more, where the release allows them).
   */
  private setPicker(onPick: (piece: number, sizeId: string) => void, onQuantity: (q: number) => void): { el: HTMLElement; update(choosing: boolean): void } {
    const s = this.live()!;
    const label = h('p', { class: 'live__overline live__size-label', id: 'live-size', text: SETS.yourSizes });
    const pickers = this.setPickers('room', onPick);
    const max = this.maxPieces(s);
    const value = h('span', { class: 'live__qty-value', attrs: { 'aria-live': 'polite' } });
    const fewer = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': SETS.live.fewer }, on: { click: () => onQuantity(this.picked.quantity - 1) }, text: '−' });
    const more = h('button', { class: 'btn live__step', attrs: { type: 'button', 'aria-label': SETS.live.more }, on: { click: () => onQuantity(this.picked.quantity + 1) }, text: '+' });
    const quantity = max > 1 ? h('div', { class: 'live__qty', attrs: { role: 'group', 'aria-labelledby': 'live-qty' } }, h('span', { class: 'live__overline', id: 'live-qty', text: SETS.live.quantity }), fewer, value, more) : null;
    const el = h('div', { class: 'live__picker live__picker--set' }, label, pickers.el, quantity);
    return {
      el,
      update: (choosing: boolean) => {
        el.classList.toggle('is-choosing', choosing);
        pickers.update();
        value.textContent = String(this.picked.quantity);
        fewer.disabled = this.busy || this.picked.quantity <= 1;
        more.disabled = this.busy || this.picked.quantity >= max;
      },
    };
  }

  /**
   * B2: the room (ONE QUEUE §3.4; D35, MK #room-2, #room-3): its door one hairline horizon running past the column and
   * dissolving at both ends, the point breathing at its seam, the light pooled above it; the countdown (its figures
   * morphing), UNTIL THE OPENING and the people in the room in that light; READY CHECK on hairlines, the size; then at
   * 00:00 the draw in place (D36, MK #room-draw): the countdown's last figure morphs to 00:00 with its tick, the countdown
   * and UNTIL THE OPENING resolve out, DRAWING THE PLACES and its sentence resolve in on the line, LIVE NOW over them,
   * the point leaves the centre and travels from the left, draw.mp3 0.85 s after 00:00; what only the room before the
   * opening offers fades where it stands (SEE THE MODEL, READY CHECK, YOUR SIZE, YOU'RE READY, LEAVE THE ROOM), so
   * nothing moves. A page that comes to the room after 00:00 shows the draw as it stands (the mockup's 3b). The room
   * stays the draw until THE OPENING (kind(), drawnScreen).
   */
  private roomScreen(): Screen {
    const s = this.live()!;
    const m = liveSheetModel(s, this.deps.localZone);
    const overline = this.overline(LIVE.phase.ROOM);
    overline.classList.add('live__phase');
    const set = this.isSet();
    const count = h('p', { class: 'live__count', attrs: { role: 'timer', 'aria-labelledby': 'live-until' } });
    const until = this.fact('', 'live__until');
    until.id = 'live-until';
    const presence = h('p', { class: 'live__presence' }, h('span', { class: 'live__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'live__presence-text' }));
    const countBlock = h('div', { class: 'live__count-block' }, count, until);
    const drawing = h('div', { class: 'live__drawing', attrs: { hidden: true } }, h('p', { class: 'live__subtitle', text: LIVE.drawing }), this.note(LIVE.drawingLine(s.tierPriority)));
    const part = (cls: string) => h('span', { class: `live-hzd__${cls}` });
    // The door: the horizon under the countdown (its parted points and its gap are THE OPENING's, shown only then).
    const door = h(
      'div',
      { class: 'live-hzd' },
      h('div', { class: 'live-hzd__say' }, countBlock, drawing),
      presence,
      h('div', { class: 'live-hzd__horizon', attrs: { 'aria-hidden': 'true' } }, part('sky'), part('gap'), part('line live-hzd__line--l'), part('line live-hzd__line--r'), part('reflect'), h('span', { class: 'live-hzd__track' }, part('breath')), part('pt'), part('pt live-hzd__pt--l'), part('pt live-hzd__pt--r')),
    );
    const checks = h('dl', { class: 'live__checks-list' });
    // READY CHECK on hairlines, on the vault: no grey plate, no corner marks (D31; MK #room-3).
    const plate = h('div', { class: 'live__checks' }, h('p', { class: 'live__overline live__checks-title', text: LIVE.ready.title }), checks);
    const errorLine = this.errorLine();
    // Macro scope K44 T1: a set's, a picker per piece.
    const picker = set
      ? this.setPicker(
          (piece, id) => this.pickPiece(piece, id),
          (q) => this.pickQuantity(q),
        )
      : this.picker(
          (id) => this.pick(id),
          (q) => this.pickQuantity(q),
        );
    const enter = h('button', { class: 'btn live__primary live__enter', attrs: { type: 'button' }, on: { click: () => this.enter() }, text: LIVE.enter });
    const ready = h('p', { class: 'live__subtitle live__ready', text: LIVE.youreReady });
    const readyLine = this.note('', 'live__ready-line');
    const choose = this.note(set ? SETS.live.chooseLine : LIVE.chooseLine, 'live__choose');
    const leave = h('button', { class: 'textlink live__leave', attrs: { type: 'button' }, on: { click: () => void this.act(() => this.deps.api.liveLeave(s.id)) }, text: LIVE.leaveRoom });
    // IN-01: under the size chooser, the house's guarantee shown to the account.
    const guaranteed = this.note('', 'live__guarantee');
    const prep = h('div', { class: 'live__prep' }, plate, picker.el, guaranteed, errorLine, choose, enter, ready, readyLine, leave);
    // SEE THE MODEL under the model's line until the opening; then the room is the piece's alone.
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
      prep,
    );
    /** The countdown was seen counting on this screen: its 00:00 is the draw in place (otherwise the draw as it stands). */
    let counted = false;
    let drawn = false;
    /** 00:00: the draw, `elapsed` ms after it on the server's clock. */
    const draw = (elapsed: number): void => {
      drawn = true;
      const inPlace = counted && !prefersReducedMotion();
      this.drawAt ??= performance.now() - elapsed;
      // Every part of the passage counted from 00:00 (CSSOM custom property; house.css .live__room.is-drawing).
      el.style.setProperty('--live-draw-t', `${Math.max(0, Math.round(performance.now() - this.drawAt))}ms`);
      el.classList.add(inPlace ? 'is-drawing' : 'is-drawn');
      overline.replaceChildren(...withNumerals(LIVE.phase.LIVE));
      drawing.hidden = false;
      // What the room before the opening offers goes: fading where it stands in the passage (nothing moves), at once
      // otherwise. Never reachable once the opening has come.
      for (const gone of [seeModel, prep, picker.el, guaranteed]) {
        if (!gone) continue;
        gone.setAttribute('inert', '');
        if (inPlace) gone.classList.add('live__gone');
        else gone.hidden = true;
      }
      if (!inPlace) countBlock.hidden = true;
      this.say(LIVE.announce.open);
      // draw.mp3 0.85 s after 00:00 (SFX_AT draw; a page come later hears nothing late).
      this.deps.sound.cue('draw', { base: this.drawAt });
    };
    const update = () => {
      const opensAt = Date.parse(this.room?.opensAt ?? s.opensAt);
      const remaining = opensAt - this.now();
      const entered = heldEntry(this.entry)?.status === 'WAITING';
      // The countdown, its figures morphing (D30); its last ten seconds' figures tick as they morph (N4).
      morph(count, clockText(remaining), { numerals: false });
      const local = zonedTime(opensAt, this.deps.localZone);
      setFact(until, `${LIVE.untilOpening} · ${local?.clock ?? ''}`);
      const tick = tickSecond(remaining);
      if (tick !== null && tick !== this.lastTick && this.synced && (tick > 0 || counted)) this.deps.sound.cue('tick');
      this.lastTick = tick;
      setFact(presence.lastChild as HTMLElement, LIVE.inRoom(this.room?.inRoom ?? 0));
      presence.hidden = !this.room?.inRoom;
      // 00:00, on the server's second: the draw (once per screen; a screen built again during it shows it as it stands).
      if (remaining <= 0 && !drawn) draw(this.drawAt === null ? -remaining : performance.now() - this.drawAt);
      if (remaining > 0) counted = true;
      if (drawn) return;
      const checksNow = set
        ? readyChecks({ access: this.access, size: this.setPickedLine(), toConfirm: this.setFromYours(), connection: this.connection, synced: this.synced, set: true })
        : readyChecks({ access: this.access, size: this.sizeLabel(this.picked.sizeId), toConfirm: this.fromYoursLines() !== null, connection: this.connection, synced: this.synced });
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
      const line = this.guaranteeLine(s);
      setFact(guaranteed, line);
      guaranteed.hidden = line === '';
      this.showError(errorLine);
      choose.hidden = entered;
      enter.hidden = entered;
      enter.disabled = this.busy || (set ? this.setChoice() === null : this.picked.sizeId === null);
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
    const quantity = (q: number): void => {
      this.picked = { ...this.picked, quantity: Math.min(this.maxPieces(s), Math.max(1, q)) };
      this.screen?.update();
    };
    // Macro scope K44 T1: a set's, a picker per piece (a size with no piece left greyed in its piece).
    const set = this.isSet();
    const picker = set
      ? this.setPicker((piece, id) => {
          this.setPicked.set(piece, { sizeId: id, from: 'hand' });
          this.screen?.update();
        }, quantity)
      : this.picker((id) => {
          this.fromYours = false;
          this.picked = { ...this.picked, sizeId: id };
          this.screen?.update();
        }, quantity);
    const enter = h('button', { class: 'btn live__primary live__enter', attrs: { type: 'button' }, on: { click: () => this.enter() }, text: LIVE.enterLine });
    const el = h(
      'section',
      { class: 'live__join' },
      this.overline(this.liveLine()),
      this.title(m.name),
      // The price and the quantity, as the room says them: an after-room's guest reads its piece here first (choice 2).
      this.fact(m.offer, 'live__offer'),
      this.surprise(m.surprise),
      this.piece(m.picture, 'live__plate--join', true, m.set),
      presence,
      left,
      this.note(this.afterRoomOf() ? LIVE.afterRoom.joinLine : set ? SETS.live.joinLine : LIVE.joinLine, 'live__join-line'),
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
        setFact(left, room ? (set ? SETS.live.left(room.left, room.quantity) : LIVE.left(room.left, room.quantity)) : '');
        picker.update(true);
        this.showError(errorLine);
        // The server's rule for a late entry: the pieces of the size not confirmed (held ones may return) serve it; a
        // set's, in each of its sizes.
        if (set) {
          const choice = this.setChoice();
          const short = choice?.some((x) => {
            const n = servable(roomSize(room, x.sizeId));
            return n !== null && n < this.picked.quantity;
          });
          enter.disabled = this.busy || choice === null || short === true;
        } else {
          const pieces = servable(roomSize(room, this.picked.sizeId ?? undefined));
          enter.disabled = this.busy || this.picked.sizeId === null || (pieces !== null && pieces < this.picked.quantity);
        }
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
      void this.act(() => this.deps.api.liveSize(s.id, sizeId, this.maxPieces(s) > 1 ? this.picked.quantity : undefined));
      return;
    }
    // AC-01: a size tapped, the one YOUR SIZES preselected too, is the collector's confirmation.
    this.fromYours = false;
    this.picked = { ...this.picked, sizeId };
    this.screen?.update();
  }

  /** Macro scope K44 T1: a piece's size picked: before entering, kept here; entered (before T0), that piece's size changed. */
  private pickPiece(piece: number, sizeId: string): void {
    this.deps.sound.prime();
    const s = this.live();
    const held = heldEntry(this.entry);
    if (!s || this.busy) return;
    if (held?.status === 'WAITING') {
      if (held.sizes?.find((x) => x.piece === piece)?.id === sizeId) return;
      void this.act(() => this.deps.api.liveSize(s.id, [{ piece, sizeId }], this.maxPieces(s) > 1 ? this.picked.quantity : undefined));
      return;
    }
    // AC-01: a size tapped, the one YOUR SIZES preselected too, is the collector's confirmation of that piece's.
    this.setPicked.set(piece, { sizeId, from: 'hand' });
    this.screen?.update();
  }

  private pickQuantity(q: number): void {
    this.deps.sound.prime();
    const s = this.live();
    if (!s || this.busy) return;
    const quantity = Math.min(this.maxPieces(s), Math.max(1, q));
    const held = heldEntry(this.entry);
    if (held?.status === 'WAITING') {
      // A set's: its sizes sent again with its new number of sets.
      const choice = held.sizes?.length ? held.sizes.map((x) => ({ piece: x.piece, sizeId: x.id })) : held.size.id;
      if (held.quantity !== quantity) void this.act(() => this.deps.api.liveSize(s.id, choice, quantity));
      return;
    }
    this.picked = { ...this.picked, quantity };
    this.screen?.update();
  }

  /** ENTER THE ROOM (before T0) or ENTER THE LINE (after it), with the size and quantity picked. */
  private enter(): void {
    this.deps.sound.prime();
    const s = this.live();
    // Macro scope K44 T1: a set's, a size per piece.
    const choice = this.isSet() ? this.setChoice() : this.picked.sizeId;
    if (!s || !choice) return;
    const from = document.activeElement;
    void this.act(
      () => this.deps.api.liveEnter(s.id, choice, this.maxPieces(s) > 1 ? this.picked.quantity : undefined),
      () => {
        // ENTER goes once entered: the keyboard's focus moves to the size now chosen, still changeable until T0.
        requestAnimationFrame(() => {
          // On a computer the room is staged in the window (views/desktop-room.ts): the focus moves without scrolling it.
          if (document.activeElement === from || document.activeElement === document.body) this.root.querySelector<HTMLElement>('.live__size[aria-pressed="true"]')?.focus({ preventScroll: isDesktop() });
        });
      },
    );
  }

  /**
   * ONE QUEUE (lot Q1, ANSWERS C3; plan §3.3; MK #queue Q1–Q10, #after-wait): the one waiting screen, from the opening
   * to the turn, every entry waiting (a set's in SETS' words, N2; the after-room's headed THE AFTER-ROOM with no time,
   * D29): LIVE NOW, the name with its variant, its choice (SIZE 52 · 1 PIECE) and the people in the room (the phone's
   * lines; the Cinema room's corners on a computer), YOUR PLACE (its place in its size, said with its size), PAUSED or
   * THE QUEUE IS PAUSED with its line above the time (OP-6, N10: the notice above says FROM ORBES alone here), the time
   * left (counted down from the reading, frozen while paused), the band of the pieces left, the one note, LEAVE THE LINE
   * on a second tap, at every stage. READING YOUR PLACE until its place is read (D15). The place moves at readings only:
   * said then (with the time read), morphing, place.mp3 with it (SFX place, 0 s).
   */
  private queueScreen(): Screen {
    const id = this.sheet!.id;
    const label = h('p', { class: 'live__overline live__place-label', attrs: { 'aria-hidden': 'true' }, text: LIVE.yourPlace });
    // The figure read with its words (a paragraph cannot be named): the label above is the eye's, hidden from readers.
    const said = h('span', { class: 'visually-hidden' });
    const figure = h('span', { class: 'live__place-figure' });
    const place = h('p', { class: 'live__place' }, said, figure);
    const reading = h('p', { class: 'live__fact live__queue-reading', attrs: { role: 'status' }, text: LIVE.queue.reading });
    const paused = this.fact('', 'live__queue-paused');
    const pausedLine = this.note('', 'live__queue-paused-line');
    const time = this.fact('', 'live__queue-time');
    // The pieces left: the Horizon band, its words inside (D23); no separator under it (r18).
    const band = horizonBand();
    const errorLine = this.errorLine();
    const leave = this.action(LIVE.queue.leave, () => this.armed(() => this.act(() => this.deps.api.liveLeave(id))), 'live__leave-line');
    const lines = this.entryLines();
    /** The place last shown (null before the first reading): a place that changes at a reading plays place.mp3. */
    let shown: number | null = null;
    // A tap or a key in the queue makes the sounds' context, as the room's do (live-sound.ts: a gesture's).
    const prime = (): void => this.deps.sound.prime();
    const el = h(
      'section',
      { class: 'live__queue', on: { pointerup: prime, keydown: prime } },
      this.overline(this.liveLine()),
      this.title(this.heading()),
      ...lines.el,
      label,
      place,
      reading,
      paused,
      pausedLine,
      time,
      band.el,
      this.note(this.isSet() ? SETS.live.queueNote : LIVE.queue.note, 'live__queue-note'),
      errorLine,
      leave,
    );
    return {
      kind: 'queue',
      el,
      update: () => {
        const e = this.entry;
        lines.update();
        if (!e) return;
        const m = queueModel(e, this.queueRead, this.now());
        el.dataset.state = m.kind === 'reading' ? 'reading' : m.paused ? 'paused' : 'waiting';
        const known = m.kind === 'waiting';
        // OP-6, N10: the release's PAUSE or PAUSE PACE, with its line, above the time it freezes; while its place is still
        // read, the release's PAUSE from the room (the notice above never says it on this screen).
        const hold = known ? m.paused : this.room?.paused ? 'RELEASE' : null;
        reading.hidden = known;
        label.hidden = !known;
        place.hidden = !known;
        paused.hidden = !hold;
        pausedLine.hidden = !hold;
        time.hidden = !known || m.time === null;
        band.el.hidden = !known || !this.room;
        setFact(paused, hold === 'RELEASE' ? LIVE.paused : hold === 'PACE' ? LIVE.queue.paused : '');
        pausedLine.textContent = hold === 'RELEASE' ? LIVE.pausedLine : hold === 'PACE' ? LIVE.queue.pausedLine : '';
        if (known) {
          if (said.textContent !== `${m.placeSaid} `) said.textContent = `${m.placeSaid} `;
          // Every figure morphs (D30): the place at a reading, the time as it counts down, the stock in the band.
          morph(figure, String(m.place), { numerals: false });
          // Lot Q1 §3.3, §3.10 (SFX place): the place changed at a reading, its figure morphing: place.mp3 with it.
          if (shown !== null && m.place !== shown) this.deps.sound.cue('place');
          shown = m.place;
          // D46, §3.10: the welcome voice once per entry when the queue first shows its place with no opening before it
          // (a late comer's first reading; THE OPENING asks for its own); never in the after-room (N6).
          if (this.welcomeFor !== e.id) {
            this.welcomeFor = e.id;
            this.deps.sound.cue('welcome', { entryId: e.id, afterRoom: !!this.afterRoomOf() });
          }
          morph(time, m.time ?? '');
          if (this.room) band.set(bandModel(this.room, e), hold);
          if (m.announce !== this.lastPlace) {
            this.lastPlace = m.announce;
            this.say(m.announce);
          }
        }
        this.showError(errorLine);
        leave.disabled = this.busy;
        leave.textContent = this.armedUntil ? LIVE.queue.leaveConfirm : LIVE.queue.leave;
      },
    };
  }

  /**
   * SOLD OUT for your size (ONE QUEUE, lot Q1 §3.6; ANSWERS C6, r10, r12, r13; MK S): the name with its variant over
   * SOLD OUT (the title only, never SOLD OUT IN SIZE 52), its choice and the people in the room (the phone's lines; the
   * Cinema room's corners on a computer), YOUR PLACE in one small line (the large figure in the computer's corner), the
   * one sentence (a set's naming its piece and size, N2), the vault's place (OP-17, D48: only when the page is given a
   * vault, lot Q3; none in Q1: nothing is added), LEAVE THE LINE on a second tap (no size switch after T0).
   */
  private soldOutScreen(): Screen {
    const s = this.live()!;
    const text = this.note('');
    // YOUR PLACE 4 for the eye; « Your place in size 52: 4 » for a reader (the line's figure as the queue says it).
    const placeShown = h('span', { attrs: { 'aria-hidden': 'true' } });
    const placeSaid = h('span', { class: 'visually-hidden' });
    const place = h('p', { class: 'live__fact live__ahead' }, placeShown, placeSaid);
    const errorLine = this.errorLine();
    const leave = this.action(LIVE.edge.soldOut.leave, () => this.armed(() => this.act(() => this.deps.api.liveLeave(s.id))), 'live__leave-line');
    const lines = this.entryLines();
    // OP-17 (lot Q3): THE VAULT under the sentence, before LEAVE THE LINE, when the page is given one; Q1 gives none.
    const vault = this.deps.vault && this.entry ? h('div', { class: 'live__vault-slot' }) : null;
    const el = h('section', { class: 'live__edge live__sold' }, this.overline(this.heading()), this.title(LIVE.edge.soldOut.title), ...lines.el, place, text, vault, errorLine, leave);
    const unmount = vault && this.deps.vault ? this.deps.vault.mount(vault, 'soldOut', { dropId: s.id, entryId: this.entry?.id ?? null }) : null;
    return {
      kind: 'soldOut',
      el,
      update: () => {
        const e = this.entry;
        lines.update();
        // Macro scope K44 T1: a set's entry sold out in one of its sizes: that piece and size said in its sentence.
        const now = e?.sizes?.length ? setShort(this.room, e) : null;
        text.textContent = now ? SETS.live.soldOut.none(now.name, now.label) : LIVE.edge.soldOut.text;
        // D19: its place in its size, as the server read it for the entry.
        const at = e?.queue?.place ?? null;
        const shown = at !== null ? LIVE.placeLine(at) : '';
        setFact(placeShown, shown);
        const said = at !== null && e ? `${isSetEntry(e) ? SETS.live.placeSaid : LIVE.queue.placeSaid(e.size.label)} ${at}` : '';
        // Its words apart from the eye's line (a space between, so each reads as itself).
        if (placeSaid.textContent !== (said && ` ${said}`)) placeSaid.textContent = said && ` ${said}`;
        // The Cinema room's corner draws it as the queue does, its label over its figure (desktop-room.ts).
        if (at !== null) place.dataset.place = String(at);
        else delete place.dataset.place;
        place.dataset.said = said;
        place.hidden = at === null;
        this.showError(errorLine);
        leave.disabled = this.busy;
        leave.textContent = this.armedUntil ? LIVE.edge.soldOut.leaveConfirm : LIVE.edge.soldOut.leave;
      },
      dispose: () => unmount?.(),
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

  /**
   * B4: the turn, the seal to press and hold (ONE QUEUE §3.5; D37, D34; MK #turn): seal C, the turn's countdown the ring
   * around it (r 128), the hold's ring inside (r 116); its clock morphing; the release's title with its variant, the
   * account's choice with its price and the people in the room under it on a phone (the Cinema room's corners say them
   * on a computer). Production's A PIECE HAS RETURNED stays when the size was full before the turn (N11).
   */
  private turnScreen(): Screen {
    const overline = this.overline(this.returned ? LIVE.returned : LIVE.yourTurn);
    // Both rings start at north and run clockwise; the hold's fill rides a soft glow of its own (OP-8, MK #turn-hold).
    const ring = s('circle', { class: 'live-hold__turn', cx: 134, cy: 134, r: 128, transform: 'rotate(-90 134 134)', 'stroke-dasharray': TURN_RING.toFixed(2) });
    const glow = s('circle', { class: 'live-hold__glow', cx: 134, cy: 134, r: 116, transform: 'rotate(-90 134 134)', 'stroke-dasharray': HOLD_RING.toFixed(2), 'stroke-dashoffset': HOLD_RING.toFixed(2) });
    const fill = s('circle', { class: 'live-hold__fill', cx: 134, cy: 134, r: 116, transform: 'rotate(-90 134 134)', 'stroke-dasharray': HOLD_RING.toFixed(2), 'stroke-dashoffset': HOLD_RING.toFixed(2) });
    const svg = s('svg', { class: 'live-hold__rings', viewBox: '0 0 268 268', 'aria-hidden': 'true', focusable: 'false' }, s('circle', { class: 'live-hold__track', cx: 134, cy: 134, r: 128 }), ring, glow, fill);
    // The breathing point on the fill's leading end; the faint glow the seal dissolves into when it hands off to SECURED.
    const point = h('span', { class: 'live-hold__pt', attrs: { 'aria-hidden': 'true' } }, h('i'));
    const dissolve = h('span', { class: 'live-hold__dissolve', attrs: { 'aria-hidden': 'true' } });
    // Macro scope K44 T1: the seal secures the set.
    const set = this.isSet();
    const button = h('button', { class: 'btn live-hold', attrs: { type: 'button', 'aria-label': set ? SETS.live.sealLabel : LIVE.sealLabel, 'aria-describedby': 'live-turn-left' } }, svg, point, sealCSvg('live-hold__seal'), dissolve);
    const left = h('p', { class: 'live__turn-left', id: 'live-turn-left', attrs: { role: 'timer' } });
    const errorLine = this.errorLine();
    const piece = this.fact('', 'live__turn-piece');
    const lines = this.entryLines((e) => `${this.choiceOf(e)} · ${formatMoney(e.priceMinor * e.quantity, e.currency)}`);
    const el = h(
      'section',
      { class: 'live__turn' },
      overline,
      this.title(LIVE.pressHold),
      button,
      left,
      this.fact(set ? SETS.live.toSecure : LIVE.toSecure, 'live__to-secure'),
      piece,
      ...lines.el,
      this.note(LIVE.letGo, 'live__let-go'),
      errorLine,
    );
    const parts: HoldParts = { el, overline, button, glow, fill, point };
    // The pointer: captured from the press to the release; the keyboard: the space bar or Enter, held.
    button.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      try {
        button.setPointerCapture(ev.pointerId);
      } catch {
        // A pointer that cannot be captured still ends with pointerup.
      }
      this.startHold(parts);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, () => this.endHold());
    button.addEventListener('keydown', (ev) => {
      if (ev.key !== ' ' && ev.key !== 'Enter') return;
      ev.preventDefault();
      if (!ev.repeat) this.startHold(parts);
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
        // The turn's clock morphs (D30): only its changed digits.
        morph(left, clockText(remainingMs), { numerals: false });
        ring.setAttribute('stroke-dashoffset', (TURN_RING * (1 - fraction)).toFixed(2));
        setFact(piece, this.heading());
        lines.update();
        // The pause alone: while the secure is sent (busy) the seal stays lit, its hold already done (startHold waits).
        button.setAttribute('aria-disabled', String(paused));
        el.classList.toggle('is-paused', paused);
        this.showError(errorLine);
      },
    };
  }

  /**
   * The seal pressed (4b HOLD; D38, OP-8; MK #turn-hold): the press sent at once with the turn's secret; the overline
   * reads HOLD, the seal pressed to 98.5 %, the inner ring filling clockwise from the top over HOLD_MS, the breathing
   * point on its leading end; hold.mp3 with the press itself (§3.10: the sound and the fill start together).
   */
  private startHold(p: HoldParts): void {
    const s = this.live();
    const token = this.entry?.status === 'TURN' ? this.entry.turn?.token : null;
    if (!s || !token || this.hold || this.busy || this.room?.paused || this.handoff) return;
    this.deps.sound.prime();
    this.deps.sound.cue('hold');
    navigator.vibrate?.(12);
    this.error = null;
    this.fullAt = null;
    const hold: Hold = { started: performance.now(), pressedAt: null, sent: false, frame: 0 };
    this.hold = hold;
    p.el.classList.add('is-holding');
    p.overline.replaceChildren(LIVE.holding);
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
    const draw = (progress: number) => {
      const offset = (HOLD_RING * (1 - progress)).toFixed(2);
      p.fill.setAttribute('stroke-dashoffset', offset);
      p.glow.setAttribute('stroke-dashoffset', offset);
      const at = holdPoint(progress);
      p.point.style.setProperty('--live-hold-x', `${at.x.toFixed(3)}%`);
      p.point.style.setProperty('--live-hold-y', `${at.y.toFixed(3)}%`);
    };
    const step = () => {
      if (this.hold !== hold) return;
      const progress = Math.min(1, (performance.now() - hold.started) / HOLD_MS);
      draw(progress);
      if (progress >= 1) this.fullAt ??= hold.started + HOLD_MS;
      if (progress >= 1 && hold.pressedAt !== null && performance.now() - hold.pressedAt >= PRESS_GAP_MS && !hold.sent) {
        hold.sent = true;
        this.securing = true;
        void this.secure(s.id, token);
        return;
      }
      hold.frame = requestAnimationFrame(step);
    };
    draw(0);
    hold.frame = requestAnimationFrame(step);
    this.resetHoldView = () => {
      p.el.classList.remove('is-holding');
      p.overline.replaceChildren(this.returned ? LIVE.returned : LIVE.yourTurn);
      draw(0);
    };
  }

  /**
   * The piece secured from this page's hold (§3.5; ROUND 5 "hold→SECURED … keep their current passages"; MK #turn-hold
   * PLAY THE HOLD, gen.mjs hb-* 2.2–3.3 s): from 0.35 s after the ring is full (at once, if the piece came later), the
   * screen withdraws into the vault for 1.1 s (the page around dims, the rings and the words fade, the seal dissolves into
   * a faint glow at its centre: house.css .live--tx-handoff); SECURED then mounts with its own passage. Reduced motion:
   * SECURED at once.
   */
  private handOff(): void {
    if (prefersReducedMotion() || this.screen?.kind !== 'turn' || this.handoff) return;
    const now = performance.now();
    const start = Math.max(now, (this.fullAt ?? now) + HANDOFF.wait);
    const until = start + HANDOFF.ms;
    const begin = () => {
      if (this.disposed || this.screen?.kind !== 'turn') return;
      this.endPassage();
      this.root.classList.add('live--tx-handoff');
      // Its class leaves when SECURED mounts (mount ends the passage under way); a second later at most, if it never does.
      this.passage = { cls: 'live--tx-handoff', parts: [], timer: setTimeout(() => this.endPassage(), HANDOFF.ms + 1000) };
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    this.handoff = { until, timers };
    if (start > now) timers.push(setTimeout(begin, start - now));
    else begin();
    timers.push(
      setTimeout(() => {
        this.handoff = null;
        this.render();
      }, until - now),
    );
  }

  private endHandoff(): void {
    for (const t of this.handoff?.timers ?? []) clearTimeout(t);
    this.handoff = null;
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

  /**
   * B5: the piece secured (`revealing`: secured on this page, just now: SECURED's passage), the add-ons, PAY (ONE QUEUE
   * §3.5; D39, D40; MK #secured): YOUR PIECE on the vault, seal C over a hairline horizon, SECURED AT under it; PAY is
   * the light, its lit part the time left to pay, emptying from right to left (its words 'PAY € 1 240 · 09:12'; its
   * accessible name PAY · total, the time its description). With add-ons offered or chosen it is 5b (lot Q2, step Q2.8;
   * MK #secured-addons): ADD-ONS under the name and the size, the rows (views/secured-addons.ts), M3's note, the error
   * line, then PAY with its total; without, screen 5 exactly (D10).
   */
  private securedScreen(revealing: boolean): Screen {
    this.addonDrafts.clear();
    this.textInvalid = null;
    const s = this.live();
    const set = this.isSet();
    const seal = sealCSvg('live__piece-seal');
    const securedAt = this.fact('', 'live__secured-at');
    // YOUR PIECE on the vault (D31; MK #secured): no grey plate, no corner marks; the seal in the light pooled over a
    // hairline horizon that dissolves at its ends, SECURED AT under the line.
    const floor = h('span', { class: 'live__floor', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'live__floor-sky' }), h('span', { class: 'live__floor-line' }));
    const reveal = h('div', { class: 'live__reveal' }, h('p', { class: 'live__overline', text: set ? SETS.live.yourSet : LIVE.yourPiece }), seal, floor, securedAt);
    const detail = this.fact('', 'live__detail');
    // Macro scope K44 T1: the set's pieces, each in its size, under its name (then the add-ons and PAY).
    const setPieces = set ? h('dl', { class: 'live__set-pieces', attrs: { 'aria-label': SETS.live.pieces } }) : null;
    // 5b (lot Q2, step Q2.8; D10–D12, N1–N3; MK #secured-addons): the hold's add-ons, its release's pick of the
    // catalogue, as rows on hairlines you tap to choose (one unit per piece, one per set), ENGRAVING chosen with YOUR TEXT;
    // M3's note under them while one has stock (N2). None offered nor chosen: hidden, and the screen is screen 5 (D10).
    const addonsTitle = h('p', { class: 'live__overline live__addons-title', id: 'live-addons', attrs: { hidden: true }, text: LIVE.addons });
    const addonsBox = h('div', { class: 'live__addons', attrs: { role: 'group', 'aria-labelledby': 'live-addons', hidden: true } });
    const addonsNote = h('p', { class: 'live__addons-note', attrs: { hidden: true } });
    const addonsView = new SecuredAddonsView(addonsBox, {
      choose: (addonId) => this.chooseAddon(addonId),
      typed: (addonId, value) => {
        this.addonDrafts.set(addonId, value);
        // The house's sentence said for the words before goes as they change.
        if (this.textInvalid === addonId) {
          this.textInvalid = null;
          this.error = null;
        }
        this.screen?.update();
      },
      save: (addonId) => void this.saveAddonText(addonId),
    });
    const errorLine = this.errorLine();
    // PAY, the light (D39): its words twice, ink on the lit part and ivory where the light has gone, the edge between them
    // feathered; its point breathing on the edge's foot, a faint pool of light under the lit part.
    const words = (cls: string) => h('span', { class: ['live-pay__words', cls] });
    const wordsIn = words('live-pay__words--in');
    const wordsOut = words('live-pay__words--out');
    const pay = h(
      'button',
      { class: 'btn live__primary live__pay live-pay', attrs: { type: 'button', 'aria-describedby': 'live-pay-left' }, on: { click: () => void this.payNow() } },
      h('span', { class: 'live-pay__pool', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'live-pay__art', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'live-pay__lit' }), wordsOut, wordsIn),
      h('span', { class: 'live-pay__edge', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'live-pay__halo' }, h('i')), h('span', { class: 'live-pay__pt' })),
    );
    const payTime = h('span', { class: 'live__pay-time' });
    const payLeft = h('span', { class: 'visually-hidden live__pay-left', id: 'live-pay-left', attrs: { role: 'timer' } }, payTime, ` ${LIVE.toConfirm}`);
    // SECURED's passage: PAY's light fills from 0 to the time left over 1.1 s, eased, from 2.9 s (3.1 s on a computer).
    const fillFrom = revealing && !prefersReducedMotion() ? performance.now() + (isDesktop() ? SECURED_TX.desk.fill : SECURED_TX.phone.fill) : null;
    let fillFrame = 0;
    let light = { fraction: 1, last: false, done: false };
    const paint = () => {
      const k = fillFrom === null ? 1 : fillEase((performance.now() - fillFrom) / SECURED_TX.fillMs);
      pay.style.setProperty('--live-pay-f', (light.fraction * k).toFixed(4));
      pay.classList.toggle('is-last', light.last);
      pay.classList.toggle('is-done', light.done);
    };
    if (fillFrom !== null) {
      const step = () => {
        paint();
        if (performance.now() < fillFrom + SECURED_TX.fillMs) fillFrame = requestAnimationFrame(step);
      };
      fillFrame = requestAnimationFrame(step);
    }
    const release = h('button', { class: 'textlink live__release', attrs: { type: 'button' }, on: { click: () => this.armed(() => this.act(() => this.deps.api.liveGiveBack(this.sheet!.id))) } });
    const el = h(
      'section',
      { class: 'live__secured' },
      this.overline(LIVE.secured),
      reveal,
      this.title(this.name()),
      detail,
      setPieces,
      addonsTitle,
      addonsBox,
      addonsNote,
      errorLine,
      pay,
      payLeft,
      this.note(LIVE.payNote, 'live__pay-note'),
      release,
    );
    if (revealing) {
      // SECURED's passage (mount plays it): secured.mp3 0.6 s into it (lot Q1 §3.10, SFX_AT secured) and the vibration
      // where the phone allows it, as today; once.
      this.deps.sound.cue('secured');
      navigator.vibrate?.([...CEREMONY_VIBRATION]);
    }
    this.frozenHold = null;
    return {
      kind: 'secured',
      el,
      dispose: () => cancelAnimationFrame(fillFrame),
      update: () => {
        const e = this.entry;
        if (!e?.hold) return;
        const at = zonedTime(e.hold.securedAt, this.deps.localZone);
        setFact(securedAt, LIVE.securedAt(at?.clock ?? ''));
        if (setPieces) {
          setFact(detail, [SETS.line(s?.set?.pieces.length ?? e.sizes?.length ?? 0), e.quantity > 1 ? SETS.live.sets(e.quantity) : ''].filter(Boolean).join(' · '));
          const rows = heldPieces(e, this.room, s);
          const key = JSON.stringify(rows);
          if (setPieces.dataset.key !== key) {
            setPieces.dataset.key = key;
            setPieces.replaceChildren(...rows.map((r) => h('div', { class: 'live__set-piece' }, h('dt', { class: 'live__set-piece-name' }, ...withNumerals(r.name)), h('dd', { class: 'live__set-piece-size' }, ...withNumerals(r.size)))));
          }
        } else {
          const collection = s?.collection ? `${upper(s.collection)} · ` : '';
          setFact(detail, `${collection}${LIVE.size(e.size.label)}${e.quantity > 1 ? ` · ${e.quantity} ${LIVE.quantity}` : ''}`);
        }
        const model = this.addonsModel(e);
        addonsView.draw(model?.rows ?? [], this.busy, this.textInvalid);
        addonsTitle.hidden = addonsBox.hidden = model === null;
        addonsNote.textContent = model?.note ?? '';
        addonsNote.hidden = !model?.note;
        const total = formatMoney(e.totalMinor, e.currency);
        let { remainingMs } = windowLeft(e.hold.securedAt, e.hold.expiresAt, this.now());
        // Paused: the time to confirm stands still (the server moves the hold's deadline by the pause at every read).
        if (this.room?.paused === true) {
          this.frozenHold ??= remainingMs;
          remainingMs = this.frozenHold;
        } else this.frozenHold = null;
        const clock = clockText(remainingMs);
        if (pay.dataset.total !== total) {
          // OP-9: the total, then the time; the price in the reading face, its groups kept together (not spread by the
          // button's tracking), the time a figure that morphs (D30).
          pay.dataset.total = total;
          pay.setAttribute('aria-label', LIVE.payName(total));
          for (const w of [wordsIn, wordsOut]) {
            const time = h('span', { class: 'live-pay__clock' });
            // One inline run (a flex box would drop the spaces around the total and the time).
            w.replaceChildren(h('span', null, ...payRun(LIVE.pay(total, clock), total, clock, time)));
          }
        }
        for (const t of [wordsIn, wordsOut, payLeft]) {
          const time = t.querySelector<HTMLElement>('.live-pay__clock, .live__pay-time');
          if (time) morph(time, clock, { numerals: false });
        }
        light = payLight(remainingMs, Date.parse(e.hold.expiresAt) - Date.parse(e.hold.securedAt));
        paint();
        pay.disabled = this.busy;
        pay.setAttribute('aria-busy', String(this.busy));
        release.textContent = this.armedUntil ? LIVE.releaseConfirm : LIVE.release;
        release.disabled = this.busy;
        this.showError(errorLine);
      },
    };
  }

  /**
   * 5b's add-ons (lot Q2, step Q2.8): what the hold's release offers now, then what was chosen and is no longer; each row
   * chosen or not (one unit per piece of the entry, one per set: PAY's total says it), the engraving's words as typed.
   */
  private addonsModel(e: LiveEntry): SecuredAddonsModel | null {
    return securedAddons(e, { units: this.itemUnits, drafts: this.addonDrafts });
  }

  /** A row tapped: chosen or let go, the hold's whole choice sent at once, the engraving keeping its words as saved (N1). */
  private chooseAddon(addonId: string): void {
    const s = this.live();
    const e = this.entry;
    // A choice, or the engraving's words, being sent: one at a time.
    if (!s || !e || this.busy || this.textSave) return;
    const rows = holdRows(e, this.itemUnits);
    const row = rows.find((r) => r.addonId === addonId);
    if (!row) return;
    const next = withUnits(rows, addonId, row.units > 0 ? 0 : 1);
    this.itemUnits = new Map(next.map((r) => [r.addonId, r.units]));
    // Let go: its words typed and not saved go with it.
    if (row.units > 0) this.addonDrafts.delete(addonId);
    if (this.textInvalid === addonId) this.textInvalid = null;
    void this.act(() => this.deps.api.liveAddons(s.id, holdChoice(next, e))).finally(() => {
      this.itemUnits = null;
      this.screen?.update();
    });
  }

  /**
   * YOUR TEXT left (its change) or PAY pressed: the engraving's words typed, saved with the hold's choice (N3: empty is
   * allowed, entered later in YOUR ORDERS). Words it cannot hold say the house's sentence in the error line, unsent, the
   * row kept chosen; the server's refusal says its own there. PAY stays as it is meanwhile (a save starts as YOUR TEXT
   * is left, which a press on PAY does: PAY then waits for it). True when nothing is left unsaved.
   */
  private async saveAddonText(addonId: string): Promise<boolean> {
    while (this.textSave) await this.textSave;
    const s = this.live();
    const e = this.entry;
    const draft = this.addonDrafts.get(addonId);
    if (!s || !e || draft === undefined) return true;
    // A choice being sent: the words wait for the next change or PAY.
    if (this.busy) return false;
    const model = this.addonsModel(e);
    const row = model?.rows.find((r) => r.addonId === addonId);
    if (!model || !row?.text) {
      this.addonDrafts.delete(addonId);
      return true;
    }
    const saved = (e.addonItems ?? []).find((c) => c.addonId === addonId)?.text ?? '';
    if (engravingText(draft) === engravingText(saved)) {
      this.addonDrafts.delete(addonId);
      this.screen?.update();
      return true;
    }
    const problem = engravingProblem(draft, row.text.max);
    if (problem) {
      this.error = problem;
      this.textInvalid = addonId;
      this.screen?.update();
      return false;
    }
    this.textInvalid = null;
    let ok = false;
    const run = (async () => {
      try {
        const entry = await this.deps.api.liveAddons(s.id, securedChoice(model.rows, new Map([[addonId, draft]])));
        if (this.disposed) return;
        this.error = null;
        // Saved: the server's words are the field's now, unless they were typed on meanwhile.
        if (this.addonDrafts.get(addonId) === draft) this.addonDrafts.delete(addonId);
        this.setEntry(entry);
        this.settle();
        ok = true;
      } catch (err) {
        if (this.disposed) return;
        // Refused: the words kept in the field, the row kept chosen, the server's sentence in the error line.
        this.deps.session.noteError(err);
        this.error = messageOf(err);
        if (err instanceof ApiError && err.status === 409) void this.readState(false);
      }
      this.render();
    })();
    this.textSave = run;
    await run;
    if (this.textSave === run) this.textSave = null;
    return ok;
  }

  private async payNow(): Promise<void> {
    const s = this.live();
    if (!s || this.busy) return;
    // PAY waits for the engraving's words typed and not yet saved (N3): saved first, PAY only once they are.
    for (const addonId of [...this.addonDrafts.keys()]) if (!(await this.saveAddonText(addonId))) return;
    // Plan MACRO M3 §4.4 (D2): PAY's answer names the add-ons that could not be added; CONFIRMED says them.
    void this.act(
      () => this.deps.api.liveConfirm(s.id),
      (e) => {
        const lines = leftOutLines(e.addonsLeftOut);
        this.leftOut = lines.length > 0 ? { entryId: e.id, lines } : null;
      },
    );
  }

  /** What could not be added at PAY, for the entry `e` (said on CONFIRMED); none otherwise. */
  private leftOutOf(e: LiveEntry): string[] {
    return this.leftOut && this.leftOut.entryId === e.id ? this.leftOut.lines : [];
  }

  /**
   * B6: CONFIRMED, redesigned (lot Q1 §3.7; ANSWERS C15, OP-2, 22 Oct 16:14 "something better and more rewarding withotu
   * deleteing any information", 16:27 the monogram alone; MK #confirmed): in the dark world in both modes, under the
   * photograph (470 px on a phone). CONFIRMED in the display face; its LIVE RELEASE (or THE AFTER-ROOM) as a label over
   * the name set large, the dot still read aloud; the ORBES monogram alone at the seam of a hairline horizon, the light
   * pooled above it; then the practical part, every line of production's page in its order: a set's YOUR SET IS
   * RESERVED, the sentence, the add-ons PAY could not add (MK caption: "stay under the sentence"), the receipt between
   * hairlines (RESERVED; SIZE or each set piece in its size; PIECES or SETS when more than one; each add-on of the
   * release; each catalogue add-on; TOTAL; REFERENCE), SHARE TO STORIES, CLIENT SERVICES with WRITE TO ORBES CLIENT
   * SERVICES, MY PIECES. On a computer (views/desktop-room.ts): the act in the centre, the sentence and the receipt
   * bottom left, the actions bottom right. Its moment, from SECURED: views/live.ts confirmedMoment.
   */
  private confirmedScreen(): Screen {
    const e = this.entry!;
    const reference = liveReference(e.id);
    const at = zonedTime(e.confirmedAt ?? e.hold?.securedAt ?? Date.now(), this.deps.localZone);
    const row = (label: string, value: string) => h('div', { class: 'rows__row' }, h('dt', { class: 'rows__label' }, ...withNumerals(label)), h('dd', { class: 'rows__value', text: value }));
    // Macro scope K44 T1: a set's, each piece in its size (`HALO` · SIZE 52), then its sets when more than one.
    const set = !!e.sizes?.length;
    const rows = h(
      'dl',
      { class: 'rows live__receipt' },
      row(LIVE.rows.reserved, at ? `${at.date} · ${at.clock}` : ''),
      ...(set ? heldPieces(e, this.room, this.live()).map((p) => row(p.name, p.size)) : [row(LIVE.rows.size, e.size.label)]),
      e.quantity > 1 ? row(set ? SETS.rows.sets : LIVE.rows.pieces, String(e.quantity)) : null,
      // D20 (lot Q2, step Q2.4): before lot Q2 its release add-ons as its orders sold them, then its catalogue add-ons as
      // sold (ENGRAVING · € 150; POLISHING CLOTH × 2 · € 30).
      ...receiptAddonRows(e, formatMoney).map(([label, value]) => row(label, value)),
      row(LIVE.rows.total, formatMoney(e.totalMinor, e.currency)),
      row(LIVE.rows.reference, reference),
    );
    // WRITE TO ORBES CLIENT SERVICES under the CLIENT SERVICES overline, the release and its reference attached (CS-01).
    const write = this.sheet ? releaseContext(this.sheet.id, this.releaseTitle(), LIVE.statusLabel.CONFIRMED, referenceWords(reference)) : null;
    const leftOut = h('div', { class: 'live__left-out', attrs: { role: 'status', hidden: true } });
    // LIVE RELEASE · MONOLITHE (THE AFTER-ROOM · …), word for word: its label over the name set large, the dot read aloud.
    const of = this.afterRoomOf() ? LIVE.afterRoom.confirmedOf(this.name()) : LIVE.confirmedOf(this.name());
    const cut = of.indexOf(' · ');
    const kind = cut < 0 ? '' : of.slice(0, cut);
    const named = cut < 0 ? of : of.slice(cut + 3);
    const part = (cls: string) => h('span', { class: `live__sign-${cls}` });
    const el = h(
      'section',
      { class: 'live__confirmed' },
      this.title(LIVE.confirmed),
      h(
        'p',
        { class: 'live__fact live__confirmed-of' },
        kind ? h('span', { class: 'live__confirmed-kind' }, ...withNumerals(kind)) : null,
        kind ? h('span', { class: 'visually-hidden', text: ' · ' }) : null,
        h('span', { class: 'live__confirmed-name' }, ...withNumerals(named)),
      ),
      // The signature: the ORBES monogram alone at the seam of a hairline horizon, the light pooled above it (C15).
      h('div', { class: 'live__sign', attrs: { 'aria-hidden': 'true' } }, part('sky'), part('line live__sign-line--l'), part('line live__sign-line--r'), part('reflect'), monogramSealSvg('live__sign-seal')),
      // Macro scope K44 T1: YOUR SET IS RESERVED, then the sentence.
      set ? this.fact(SETS.live.reserved(e.quantity), 'live__set-reserved') : null,
      h('p', { class: 'prose live__confirmed-text', text: set ? SETS.live.reservedText : LIVE.reservedIn(e.size.label, e.quantity) }),
      // Plan MACRO M3 §4.4 (D2): PAY's add-ons that could not be added, each by its name and why, under the sentence
      // (its answer may come after the stream's CONFIRMED: drawn at each update).
      leftOut,
      // The receipt between hairlines, on the page: no plate, no corner marks (D31).
      h('div', { class: 'live__receipt-plate' }, rows),
      this.storyOpen(e),
      h('p', { class: 'live__overline live__cs-title', text: LIVE.clientServices }),
      writeButton(write, { house: true }),
      piecesLink(() => this.deps.onPieces(), 'live__pieces'),
    );
    let said = '';
    return {
      kind: 'confirmed',
      el,
      update: () => {
        const lines = this.entry ? this.leftOutOf(this.entry) : [];
        const key = JSON.stringify(lines);
        if (key === said) return;
        said = key;
        leftOut.replaceChildren(...lines.map((line) => h('p', { class: 'live__left-out-line' }, ...withNumerals(line))));
        leftOut.hidden = lines.length === 0;
      },
    };
  }

  /**
   * SHARE TO STORIES under the receipt (plan NEXT-NINE, §3.8 BP-10): the house's full-width hairline button of the
   * CONFIRMED card (LIVE RELEASE, its model with its variant, the day of T0; an after-room's piece too), once drawn; none
   * without the model's photograph. Never on the release's final page.
   */
  private storyOpen(e: LiveEntry): HTMLButtonElement | null {
    const m = this.sheet ? liveStoryModel(this.sheet, this.deps.localZone) : null;
    return m ? storyButton(this.stories.card(e.id, m), m, { house: true }) : null;
  }

  /**
   * The second door (plan LIVE RELEASE+, choice 2), in the same vault: still in the line when the last piece was secured,
   * the after-room's delay later; its one action ENTER THE AFTER-ROOM. Until it closes (then the page says how the release
   * ended). ONE QUEUE (lot Q1 §3.9; ANSWERS C7, r20d; D29; MK #after-door): the door is the room's horizon, open: parted
   * at the centre, a point breathing at each parted end, the light spreading up through the gap; its passage
   * (afterPassage) as the mockup plays it.
   */
  private afterRoomScreen(): Screen {
    const part = (cls: string) => h('span', { class: `live-hzd__${cls}` });
    const door = h(
      'div',
      { class: 'live-hzd live-hzd--open', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'live-hzd__horizon' }, part('sky'), part('line live-hzd__line--l'), part('line live-hzd__line--r'), part('reflect'), part('pt live-hzd__pt--l'), part('pt live-hzd__pt--r')),
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
   * Over (plan LIVE RELEASE+, decision 30; C29): the release in its final state, as THE RELEASES' PAST opens it.
   * ‹ THE RELEASES; its photograph; LIVE RELEASE and its day, its title, its type and collection, its quantity as
   * announced, SEE THE MODEL; signed in, the account's part in it (YOU SECURED A PIECE, YOU TOOK PART); THIS RELEASE IS
   * OVER on its plate; for a piece secured, CONFIRMED and its receipt in the ivory kept from the room; the question
   * after; its description. Never an end figure.
   */
  private pastScreen(): Screen {
    const m = livePastModel(this.sheet!, this.deps.localZone, this.now());
    const part = h('p', { class: 'n-state n-live__part live__past-part', attrs: { hidden: true } });
    const receipt = h('div', { class: 'n-live__receipt-slot', attrs: { hidden: true } });
    const ask = this.questionBlock();
    const title = modelTitle('h1', ['n-g', 'n-t1', 'n-live__title'], m.heading, m.model);
    title.id = 'live-title';
    title.tabIndex = -1;
    const words = h(
      'div',
      { class: 'n-px n-ctr n-live__words' },
      h('p', { class: 'n-g n-lb n-live__kind' }, ...withNumerals([LIVE.kind, m.day].filter(Boolean).join(' · '))),
      title,
      m.line ? h('p', { class: 'n-g n-lb n-live__type' }, ...withNumerals(m.line)) : null,
      m.set?.names ? h('p', { class: 'n-g n-lb n-live__set-names' }, ...withNumerals(m.set.names)) : null,
      h('p', { class: 'n-g n-lb n-ivc n-live__pieces-line' }, ...withNumerals(m.pieces)),
      m.lookbook ? h('p', { class: 'n-live__see-line' }, textLink(LOOKBOOK.seeModel, { href: lookbookSheetPath(m.lookbook), onOpen: () => this.deps.onModel(m.lookbook!), extraClass: 'n-live__see' })) : null,
      part,
    );
    const description = storyBlock(m.description, { className: 'n-px n-live__description n-live__description--past', paragraphClass: 'n-tx' });
    const el = h(
      'section',
      { class: 'n-livepage n-live__past live__past' },
      this.crumb(),
      ...this.hero(m.picture, words, m.set),
      h('div', { class: 'n-nx n-live__over' }, h('p', { class: 'n-g n-t3 n-ivc n-live__over-text live__past-status', text: RELEASES.over })),
      receipt,
      ask.el,
      description,
      this.howLine(),
    );
    let drawn = '';
    return {
      kind: 'past',
      el,
      focus: title,
      update: () => {
        if (this.partRead === 'idle' && this.deps.session.state.status === 'signed-in') void this.readPart();
        const said = this.part ?? '';
        if (part.dataset.text !== said) {
          part.dataset.text = said;
          part.replaceChildren(...(said === RELEASES.past.secured ? [icon('check', { small: true })] : []), said);
        }
        part.hidden = this.part === null;
        // A piece secured: its reservation, as CONFIRMED said it in the room (C29).
        const e = this.deps.session.state.status === 'signed-in' && this.entry?.status === 'CONFIRMED' ? this.entry : null;
        const key = e ? JSON.stringify([e.id, e.size, e.quantity, e.legacyAddons, e.addonItems, e.totalMinor, e.currency, e.confirmedAt]) : '';
        if (key !== drawn) {
          drawn = key;
          receipt.replaceChildren(...(e ? [this.receipt(e, m.heading)] : []));
          receipt.hidden = e === null;
        }
        this.askQuestion(ask, true);
      },
    };
  }

  /**
   * CONFIRMED and its receipt on a release's final page (C29): the one ivory plate of /verify, kept from the room. The
   * release, CONFIRMED, the size reserved and what follows, then RESERVED, SIZE, PIECES, each add-on, TOTAL, REFERENCE,
   * and MY PIECES.
   */
  private receipt(e: LiveEntry, heading: string): HTMLElement {
    const reference = liveReference(e.id);
    const at = e.confirmedAt ?? e.hold?.securedAt ?? null;
    const time = at ? zonedTime(at, this.deps.localZone) : null;
    const reserved = at && time ? `${zonedDate(at, this.deps.localZone)} · ${time.time}` : '';
    const row = (label: string, value: string): [string, string] => [label, value];
    // Macro scope K44 T1: a set's, each piece in its size, then its sets.
    const set = !!e.sizes?.length;
    const rows = [
      row(LIVE.rows.reserved, reserved),
      ...(set ? heldPieces(e, this.room, this.sheet && !isEndedSheet(this.sheet) ? this.sheet : null).map((p) => row(p.name, p.size)) : [row(LIVE.rows.size, e.size.label)]),
      row(set ? SETS.rows.sets : LIVE.rows.pieces, String(e.quantity)),
      ...receiptAddonRows(e, (minor, currency) => LIVE.addonPrice(money(minor, currency))),
      row(LIVE.rows.total, money(e.totalMinor, e.currency)),
      row(LIVE.rows.reference, reference),
    ];
    return h(
      'section',
      { class: 'n-rec n-live__receipt', attrs: { 'aria-labelledby': 'live-confirmed' } },
      h('p', { class: 'n-g n-lb n-live__receipt-of' }, ...withNumerals(LIVE.confirmedOf(heading))),
      h('h2', { class: 'n-g n-t1 n-live__receipt-title', id: 'live-confirmed', text: LIVE.confirmed }),
      set ? h('p', { class: 'n-g n-lb n-live__receipt-set' }, ...withNumerals(SETS.live.reserved(e.quantity))) : null,
      h('p', { class: 'n-live__receipt-text', text: set ? SETS.live.reservedText : LIVE.reservedIn(e.size.label, e.quantity) }),
      h(
        'dl',
        { class: 'n-live__receipt-rows' },
        // The reference selected whole in one click on a computer (§10.19): its value marked (a phone's as before).
        ...rows.map(([label, value]) => h('div', { class: 'n-kv__row' }, h('dt', { class: 'n-g n-kv__label' }, ...withNumerals(label)), h('dd', { class: ['n-kv__value', 'n-num', label === LIVE.rows.reference && !touchLayout() ? 'n-live__ref' : null], text: value }))),
      ),
      h('p', { class: 'n-live__receipt-link' }, appAnchor(PIECES_PATH, ['n-g', 'n-live__pieces'], () => this.deps.onPieces(), PIECES.link)),
    );
  }

  /** ONE QUESTION: the question after, shown once read, kept when answered; on NOCTURNE's pages a plate card (C30). */
  private questionBlock(): QuestionBlock {
    return new QuestionBlock({
      api: this.deps.api,
      session: this.deps.session,
      localZone: this.deps.localZone,
      tone: 'nocturne',
      onAnswered: (q) => {
        this.question = q;
      },
    });
  }

  /**
   * The question after on a page of the release's end: read once signed in (never on an after-room's page), then shown.
   * `again` (the final page): not asked yet of an account that took part without a piece, read again while it may still
   * open there (a sold-out release's after-room still running).
   */
  private askQuestion(block: QuestionBlock, again = false): void {
    if (this.questionRead === 'idle' && this.deps.session.state.status === 'signed-in' && !this.afterRoomOf()) void this.readQuestion();
    else if (again) this.askAgain();
    block.show(this.question);
  }

  /** Read the question after again in QUESTION_AGAIN_MS, while it is not asked of an account that took part without a piece, for QUESTION_WAIT_MS at most. */
  private askAgain(): void {
    if (this.questionTimer || this.questionRead !== 'done' || this.question || this.part !== RELEASES.past.tookPart || this.disposed) return;
    this.questionSince ??= Date.now();
    if (Date.now() - this.questionSince >= QUESTION_WAIT_MS) return;
    this.questionTimer = setTimeout(() => {
      this.questionTimer = null;
      if (this.disposed || this.questionRead !== 'done' || this.question) return;
      this.questionRead = 'idle';
      this.screen?.update();
    }, QUESTION_AGAIN_MS);
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

  /**
   * An end page (C30): the visit ended (YOUR TURN HAS PASSED, YOUR HOLD HAS ENDED, YOUR PLACE IS RELEASED, YOU LEFT THE
   * LINE, YOUR ENTRY IS REMOVED), the release or its after-room ended before the account's piece, or the release gone.
   * Its photograph; LIVE RELEASE (THE AFTER-ROOM) and its day, its title; the outcome and its sentence (said aloud); the
   * question after once open; ORBES Client Services for an entry removed; THE RELEASES.
   */
  private edgeScreen(kind: LiveScreenKind): Screen {
    const copy = this.edgeCopy(kind);
    // YOUR ENTRY IS REMOVED: WRITE TO ORBES CLIENT SERVICES in place of the contact, the release attached (CS-01).
    const write = kind === 'removed' && this.entry && this.sheet ? releaseContext(this.sheet.id, this.releaseTitle(), LIVE.statusLabel.REMOVED) : null;
    const sheet = this.sheet;
    const heading = sheet ? (liveHeading(sheet) ?? (isEndedSheet(sheet) ? LIVE.kind : LIVE.unnamed)) : LIVE.kind;
    const day = sheet ? pastDay(sheet.opensAt, this.deps.localZone, this.now()) : '';
    const title = modelTitle('h1', ['n-g', 'n-t1', 'n-live__title'], heading, sheet?.name ? upper(sheet.name) : null);
    title.id = 'live-title';
    title.tabIndex = -1;
    const outcome = h('p', { class: 'n-g n-t2 n-ivc n-live__outcome', attrs: { tabindex: '-1' } }, ...withNumerals(copy.title));
    const note = h('p', { class: 'n-tx n-live__outcome-text', text: copy.text });
    // Ended by the release's end with no second door (CLOSED, or SOLD OUT without an after-room): its final end, the
    // question after open (plan LIVE RELEASE+, choice 11). A guest of an after-room is asked on the final page once it ends.
    const ask = kind === 'ended' && !this.entry?.afterRoom ? this.questionBlock() : null;
    // OP-17 (lot Q3): THE VAULT under the sentence of a release sold out, when the page is given one; Q1 gives none.
    const vault = kind === 'ended' && this.deps.vault ? h('div', { class: 'n-px live__vault-slot', attrs: { hidden: true } }) : null;
    let unmount: (() => void) | null = null;
    const words = h(
      'div',
      { class: 'n-px n-ctr n-live__words' },
      // In an after-room, its end pages say so: the release itself had sold out before.
      h('p', { class: 'n-g n-lb n-live__kind' }, ...withNumerals([this.afterRoomOf() ? LIVE.afterRoom.kind : LIVE.kind, day].filter(Boolean).join(' · '))),
      title,
    );
    const el = h(
      'section',
      { class: 'n-livepage n-live__end' },
      ...this.hero(sheet ? pictureOf(sheet) : null, words, sheet ? liveSet(sheet) : null),
      h('section', { class: 'n-px n-ctr n-live__outcome-block', attrs: { 'aria-live': 'polite' } }, outcome, note),
      vault,
      write ? h('div', { class: 'n-px n-live__contact' }, writeButton(write)) : null,
      ask?.el ?? null,
      h('p', { class: 'n-sec n-ctr n-live__back' }, textLink(LIVE.back, { href: RELEASES_PATH, onOpen: () => this.deps.onReleases(), extraClass: 'n-live__back-link' })),
      this.howLine(),
    );
    // The release's end may say its reason after the page (SOLD OUT, CLOSED): the words follow it.
    const update = (): void => {
      const now = this.edgeCopy(kind);
      if (outcome.textContent !== now.title) outcome.replaceChildren(...withNumerals(now.title));
      if (note.textContent !== now.text) note.textContent = now.text;
      if (ask) this.askQuestion(ask);
      // The vault once the release says it sold out (its reason may come after the page).
      if (vault && !unmount && this.deps.vault && sheet && this.room?.endedReason === 'SOLD_OUT') {
        vault.hidden = false;
        unmount = this.deps.vault.mount(vault, 'end', { dropId: sheet.id, entryId: this.entry?.id ?? null });
      }
    };
    // The keyboard and a screen reader land on what happened, under the release's title.
    return { kind, el, focus: outcome, back: true, update, dispose: () => unmount?.() };
  }

  private edgeCopy(kind: LiveScreenKind): { title: string; text: string } {
    const e = LIVE.edge;
    // Macro scope K44 T1: a set's end of a visit says « the set » where a model's says « the piece ».
    if (this.isSet()) {
      const x = SETS.live.edge;
      const reason = this.room?.endedReason ?? 'ENDED';
      switch (kind) {
        case 'missed':
          return { ...e.missed, text: x.missed };
        case 'expired':
          return { ...e.expired, text: x.expired };
        case 'released':
          return { ...e.released, text: x.released };
        case 'ended':
          return reason === 'SOLD_OUT' ? { ...e.ended.SOLD_OUT, text: x.soldOut } : reason === 'ENDED' ? { ...e.ended.ENDED, text: x.ended } : e.ended[reason];
        default:
          break;
      }
    }
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
        return (this.afterRoomOf() ? LIVE.afterRoom.ended : e.ended)[this.room?.endedReason ?? 'ENDED'];
      default:
        return this.afterRoomOf() ? LIVE.afterRoom.over : e.over;
    }
  }
}

/** Set a line's words, its figures in the reading face; nothing when they are the same (no reflow, nothing read again). */
/** The draw as THE OPENING starts from it: its copies (views/live.ts drawAsItIs) and, on a computer, where its gliding parts stood. */
interface DrawGhosts {
  ghosts: HTMLElement[];
  glides: { head: DOMRect | null; name: DOMRect | null; notice: DOMRect | null } | null;
}

/**
 * A copy of `el` where it stands in the window (fixed, its box measured; CSSOM custom properties, the house's pattern
 * for a measure), inside shallow copies of its ancestors up to the screen `top` (house.css .live-tx-ctx: no box of their
 * own), so the copy keeps every rule its place gives it. No id is copied; the copy is never read (the veil is hidden).
 */
function ghost(el: HTMLElement, top: HTMLElement, cls: string): HTMLElement {
  const r = el.getBoundingClientRect();
  const copy = el.cloneNode(true) as HTMLElement;
  for (const x of [copy, ...copy.querySelectorAll<HTMLElement>('[id]')]) x.removeAttribute('id');
  copy.classList.add('live-tx-ghost', cls);
  copy.style.setProperty('--live-tx-top', `${r.top.toFixed(1)}px`);
  copy.style.setProperty('--live-tx-left', `${r.left.toFixed(1)}px`);
  copy.style.setProperty('--live-tx-width', `${r.width.toFixed(1)}px`);
  let node: HTMLElement = copy;
  for (let p = el.parentElement; p && p !== top.parentElement; p = p.parentElement) {
    const ctx = p.cloneNode(false) as HTMLElement;
    ctx.removeAttribute('id');
    // Its place's rules, not its state's motion (the draw's own passage is not played again).
    ctx.classList.remove('is-drawing', 'is-drawn');
    ctx.classList.add('live-tx-ctx');
    ctx.append(node);
    node = ctx;
  }
  return node;
}

/**
 * PAY's words (LIVE.pay, OP-9) as one inline run: the total in the reading face (its groups kept together), the time in
 * `time` (a figure that morphs); the words around them as copy.ts writes them.
 */
function payRun(words: string, total: string, clock: string, time: HTMLElement): (string | HTMLElement)[] {
  const at = words.indexOf(total);
  const end = words.lastIndexOf(clock);
  if (at < 0 || end < at + total.length) return [words];
  return [words.slice(0, at), h('span', { class: 'live__money', text: total }), words.slice(at + total.length, end), time, words.slice(end + clock.length)].filter((x) => x !== '');
}

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

