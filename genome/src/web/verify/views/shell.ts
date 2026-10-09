/**
 * NOCTURNE's chrome (plan NOCTURNE, Navigation), held by the app round every screen it draws in NOCTURNE:
 *
 *   ORBES                                TITANE ⦶     the header: the tier's name and the monogram open the account
 *   NOW   RELEASES •   COLLECTION   CIRCLE   PIECES    sheet (decision 11; SIGN IN signed out: MY PIECES' sign-in);
 *   ─────────────────────────────────────────────     the rail of chapters, the current one underlined
 *   [the banner of the LIVE RELEASES]                 (aria-current), RELEASES' dot while a release is live or
 *   [the screen]                                      announced (nocturne-model.ts railLive)
 *   ─────────────────────────────────────────────
 *   ⦶  THE CLUB                                       the footer: THE CLUB (plan NEXT-NINE, BP-19 T9: in the app), then
 *      PRIVACY  TERMS  LEGAL  HELP                    the legal pages (SOUND as today; the account sheet repeats it)
 *   SOUND ON · IP GEOLOCATION BY DB-IP · © ORBES · PARIS
 *                     ( ⌖ )                           the SCAN ring, fixed at the foot of the screen, over a fade
 *                     SCAN
 *
 * The column is phone width on a computer (choice 5). The chrome is hidden on the screens that keep their own look:
 * the room (choice 4: the door, the line, the turn, the hold, CONFIRMED, the after-room; a LIVE RELEASE's pages before
 * and after it have the chrome, C20, C27–C30: the page says which it shows, `liveChrome`), the boutique board, the
 * shared certificate (choice 3); the scanner, VERIFYING… and a problem of the scan (C11, C12, C17) are NOCTURNE's
 * without it.
 * The shared certificate also sets Safari's bars back to its light (addition 13): every other screen's are the ink.
 *
 * The shell also holds the write sheet (plan NEXT-NINE, CS-01: views/write.ts), which every WRITE TO ORBES CLIENT
 * SERVICES of the app opens, on any screen, and opens the account sheet on MESSAGES for SEE MESSAGES and NOW's READ.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import type { ConcerningTarget } from '../messages-model.js';
import type { ContactModel } from '../view-model.js';
import { CHROME } from '../copy.js';
import { accountButton, chapterOf, railLive, type ChapterId } from '../nocturne-model.js';
import type { SessionStore } from '../session.js';
import type { SoundSwitch } from '../sound.js';
import type { ClubStatus } from '../types.js';
import { AccountSheet } from './account.js';
import { CHAPTER_PATHS, showRailLive } from '../../shared/chapters.js';
import { PIECES_PATH } from './common.js';
import { appAnchor, CHAPTERS, drawSound, footer, icon, monogram } from './nocturne.js';
import { OrderSheet, registerOrderSheet } from './order-sheet.js';
import { registerMessages, registerWriteSheet, WriteSheet } from './write.js';
import { closeStoryPreview } from './story.js';

export interface ShellDeps {
  api: ApiClient;
  session: SessionStore;
  sound: SoundSwitch;
  /** A chapter of the rail, in the app (its history entry the router's). */
  onChapter(chapter: ChapterId): void;
  /** Signed out, the account button: MY PIECES and its sign-in. */
  onSignIn(): void;
  /** THE CLUB (plan NEXT-NINE, BP-19 T9): the footer's line and the account sheet's row, in the app. */
  onTheClub(): void;
  /** YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2): the account sheet's row, its page in the app. */
  onWishlist(): void;
  /** The SCAN ring: the scanner (a tap: the sound signature's context is created in it). */
  onScan(): void;
  /** MESSAGES' CONCERNING link: the place a message concerned, in the app. */
  onConcerning(target: ConcerningTarget): void;
  /** NOW's line follows MESSAGES once read. */
  onMessagesRead(): void;
  /** FORGOTTEN PASSWORD? of the write sheet's sign-in: ORBES Client Services' email. */
  recoveryContact(): Promise<ContactModel | undefined>;
}

/**
 * The screens drawn in NOCTURNE with its chrome; the others of NOCTURNE (the scanner, VERIFYING…, a problem of the
 * scan: C11, C12, C17) keep the whole screen, without the rail and the ring.
 */
const CHROME_SCREENS: readonly string[] = ['landing', 'result', 'pieces', 'piece', 'lookbook', 'sheet', 'releases', 'release', 'circle', 'circlePost', 'club', 'how', 'wishlist'];
const NOCTURNE_SCREENS: readonly string[] = [...CHROME_SCREENS, 'scan', 'verifying', 'message'];

/** Safari's bars (addition 13): the ink of NOCTURNE, and the light of the shared certificate, kept as it is. */
export const THEME_COLOURS = Object.freeze({ nocturne: '#0a0a0a', certificate: '#ffffff' });

/** The rail's dot is read again no sooner than this (the banner's own cadence). */
const RAIL_REFRESH_MS = 60_000;

/** Each chapter's address (shared/chapters.ts: the legal pages' rail leads to the same). */
const PATHS: Readonly<Record<ChapterId, string>> = CHAPTER_PATHS;

export class Shell {
  /** The column: the header, the rail, the banner, the app's screen (`host`), the footer. */
  readonly column: HTMLElement;
  private readonly header: HTMLElement;
  /** Signed in: the tier's name and the monogram, a button that opens the account sheet. */
  private readonly account: HTMLButtonElement;
  private readonly accountText = h('span', { class: 'n-acct__tier' });
  /** Signed out: SIGN IN, a link to MY PIECES and its sign-in. */
  private readonly signIn: HTMLAnchorElement;
  private readonly rail: HTMLElement;
  private readonly links: Map<ChapterId, HTMLAnchorElement>;
  private readonly live = h('i', { class: 'n-rail__live', attrs: { 'aria-hidden': 'true', hidden: true } });
  /** The dot's word for a screen reader (shared/chapters.ts RAIL_LIVE_WORD): RELEASES LIVE while it shows. */
  private readonly liveWord = h('span', { class: 'visually-hidden n-rail__live-word', attrs: { hidden: true } });
  private readonly foot: HTMLElement;
  private readonly soundButton: HTMLButtonElement | null;
  /** The SCAN ring, fixed at the foot of the screen. */
  readonly ring: HTMLElement;
  readonly sheet: AccountSheet;
  /** WRITE TO ORBES CLIENT SERVICES (CS-01). */
  readonly write: WriteSheet;
  /** An order's sheets in YOUR ORDERS (plan NEXT LOT §3.6): its delivery address, its engraving, a return or an exchange. */
  readonly orderSheet: OrderSheet;
  private club: ClubStatus | null = null;
  private clubFor: string | null = null;
  private railReadAt = -Infinity;
  private railReading = false;
  private screen = '';
  /** A LIVE RELEASE's page shows one of its screens before or after the room (the chrome), else one of the room's. */
  private liveOn = false;

  constructor(
    private readonly deps: ShellDeps,
    host: HTMLElement,
    banner: HTMLElement,
  ) {
    this.account = h(
      'button',
      { class: 'n-g n-acct', attrs: { type: 'button', 'aria-haspopup': 'dialog', hidden: true }, on: { click: () => this.sheet.open(this.account) } },
      this.accountText,
      monogram(28),
    );
    this.signIn = appAnchor(PIECES_PATH, ['n-g', 'n-acct'], () => deps.onSignIn(), CHROME.signIn);
    this.signIn.hidden = true;
    this.header = h('header', { class: 'n-hd' }, h('span', { class: 'n-g n-wm', text: 'ORBES' }), this.account, this.signIn);

    this.links = new Map(
      CHAPTERS.map((c) => {
        const link = appAnchor(PATHS[c], ['n-g', 'n-rail__link'], () => deps.onChapter(c), CHROME.chapters[c]);
        link.dataset.chapter = c;
        return [c, link] as const;
      }),
    );
    this.links.get('releases')!.append(this.live, this.liveWord);
    this.rail = h('nav', { class: 'n-rail', attrs: { 'aria-label': CHROME.rail } }, ...this.links.values());

    const foot = footer(
      deps.sound,
      () => {
        deps.sound.set(!deps.sound.on);
        this.drawSound();
        this.sheet.soundChanged();
      },
      () => deps.onTheClub(),
    );
    this.foot = foot.el;
    this.soundButton = foot.soundButton;

    this.ring = h(
      'div',
      { class: 'n-scan', attrs: { hidden: true } },
      h('button', { class: 'n-scan__ring', attrs: { type: 'button', 'aria-label': CHROME.scanLabel }, on: { click: () => deps.onScan() } }, icon('scan')),
      h('span', { class: 'n-g n-scan__label', attrs: { 'aria-hidden': 'true' }, text: CHROME.scan }),
    );

    this.column = h('div', { class: 'n-column' });
    host.before(this.column);
    this.column.append(this.header, this.rail, banner, host, this.foot);
    for (const el of [this.header, this.rail, this.foot]) el.hidden = true;

    this.sheet = new AccountSheet({
      api: deps.api,
      session: deps.session,
      sound: deps.sound,
      onPieces: () => deps.onChapter('pieces'),
      onTheClub: () => deps.onTheClub(),
      onWishlist: () => deps.onWishlist(),
      onSound: () => this.drawSound(),
      onClub: (club) => {
        this.club = club;
        this.drawAccount();
      },
      outside: () => [this.column, this.ring],
      onConcerning: (target) => deps.onConcerning(target),
      onRead: () => deps.onMessagesRead(),
    });
    this.write = new WriteSheet({
      api: deps.api,
      session: deps.session,
      outside: () => [this.column, this.ring],
      recoveryContact: () => deps.recoveryContact(),
      onMessages: (trigger) => this.sheet.openMessages(trigger),
    });
    registerWriteSheet((context, trigger) => {
      if (this.sheet.isOpen) this.sheet.close();
      if (this.orderSheet.isOpen) this.orderSheet.close();
      this.write.open(context, trigger);
    });
    this.orderSheet = new OrderSheet({ api: deps.api, session: deps.session, outside: () => [this.column, this.ring] });
    registerOrderSheet((request) => {
      if (this.sheet.isOpen) this.sheet.close();
      if (this.write.isOpen) this.write.close();
      this.orderSheet.open(request);
    });
    registerMessages((trigger) => {
      if (this.write.isOpen) this.write.close();
      this.sheet.openMessages(trigger);
    });
    document.body.append(this.ring, this.sheet.el, this.write.el, this.orderSheet.el);

    deps.session.subscribe(() => this.onSession());
    this.drawAccount();
    this.drawSound();
    void deps.session.ensure().catch(() => undefined);
  }

  /** The screen now shown: NOCTURNE's ground or not, the chrome or not, the rail's chapter, Safari's bars. */
  show(screen: string): void {
    this.screen = screen;
    const chrome = CHROME_SCREENS.includes(screen) || (screen === 'live' && this.liveOn);
    const nocturne = chrome || NOCTURNE_SCREENS.includes(screen);
    document.body.classList.toggle('nocturne', nocturne);
    for (const el of [this.header, this.rail, this.foot, this.ring]) el.hidden = !chrome;
    // Another screen (a chapter, back, a link): the sheets give way to it, and the story card's preview (BP-10).
    if (this.sheet.isOpen) this.sheet.close();
    if (this.write.isOpen) this.write.close();
    if (this.orderSheet.isOpen) this.orderSheet.close();
    closeStoryPreview();
    const chapter = chapterOf(screen);
    for (const [c, link] of this.links) {
      if (c === chapter) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = screen === 'certificate' ? THEME_COLOURS.certificate : THEME_COLOURS.nocturne;
    if (chrome) {
      this.drawSound();
      if (Date.now() - this.railReadAt >= RAIL_REFRESH_MS) void this.readRail();
    }
  }

  /**
   * A LIVE RELEASE's page changed screen: before or after the room (`shown`), NOCTURNE's ground and chrome; inside it,
   * the room's own look (choice 4). Told for the page on screen only: a page arriving tells it once mounted, right before its screen is shown, so its first screen opens as it should.
   */
  liveChrome(shown: boolean): void {
    if (this.liveOn === shown) return;
    this.liveOn = shown;
    if (this.screen === 'live') this.show('live');
  }

  private onSession(): void {
    const s = this.deps.session.state;
    const email = s.status === 'signed-in' ? s.account.email : null;
    if (email !== this.clubFor) {
      this.clubFor = email;
      this.club = null;
      this.sheet.known(null);
      if (email) void this.readClub(email);
    }
    this.drawAccount();
  }

  /** The tier the header names, read once per account (and again each time the sheet opens). */
  private async readClub(email: string): Promise<void> {
    try {
      const club = await this.deps.api.clubStatus();
      if (this.clubFor !== email) return;
      this.club = club;
      this.sheet.known(club);
    } catch (e) {
      this.deps.session.noteError(e);
    }
    this.drawAccount();
  }

  /**
   * The account button: the tier's name and the monogram (the monogram alone without a tier), named "Your account,
   * TITANE"; SIGN IN signed out. Neither while the session is not known yet.
   */
  private drawAccount(): void {
    const s = this.deps.session.state;
    const m = accountButton(s.status === 'signed-in', s.status === 'signed-in' ? (this.club?.tier?.name ?? null) : null);
    this.account.hidden = s.status !== 'signed-in';
    this.signIn.hidden = s.status !== 'anonymous';
    this.accountText.textContent = m.kind === 'account' ? (m.text ?? '') : '';
    this.accountText.hidden = m.kind !== 'account' || m.text === null;
    this.account.setAttribute('aria-label', m.kind === 'account' ? m.label : 'Your account');
  }

  private drawSound(): void {
    if (this.soundButton) drawSound(this.soundButton, this.deps.sound);
  }

  /** RELEASES' dot: a LIVE RELEASE announced, its room open or live, or a draw open, soon open or in its early access. */
  private async readRail(): Promise<void> {
    if (this.railReading) return;
    this.railReading = true;
    this.railReadAt = Date.now();
    try {
      const [live, drops] = await Promise.all([this.deps.api.liveNext().catch(() => null), this.deps.api.drops().catch(() => [])]);
      showRailLive(this.live, this.liveWord, railLive(live, drops));
    } finally {
      this.railReading = false;
    }
  }
}
