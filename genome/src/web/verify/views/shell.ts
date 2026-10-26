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
import type { ConcerningTarget, HouseTarget, WriteContext } from '../messages-model.js';
import type { ContactModel } from '../view-model.js';
import { CHROME, DESKTOP } from '../copy.js';
import { accountButton, chapterOf, railLive, type ChapterId } from '../nocturne-model.js';
import type { SessionStore } from '../session.js';
import type { SoundSwitch } from '../sound.js';
import { isLight, MODE_THEME_COLOURS, type ModeSwitch } from '../../shared/mode.js';
import type { ClubStatus } from '../types.js';
import { AccountSheet } from './account.js';
import { ACCOUNT_PATH, AccountPage, accountRouteOf, type AccountPageHost, type AccountView } from './desktop-account.js';
import { SIGN_IN_PATH } from './desktop-signin.js';
import { CHAPTER_PATHS, showRailLive } from '../../shared/chapters.js';
import { LANDING_PATH, PIECES_PATH } from './common.js';
import { appAnchor, CHAPTERS, drawSound, footer, icon, monogram } from './nocturne.js';
import { OrderSheet, registerOrderSheet } from './order-sheet.js';
import { registerMessages, registerWriteSheet, WriteSheet, type MessagesPart } from './write.js';
import { closeStoryPreview } from './story.js';
import { dockRail, isDesktop, onDesktopChange, wordmarkLink } from '../../shared/desktop.js';
import { SCAN_PAGE_PATH } from './desktop-scan.js';

export interface ShellDeps {
  api: ApiClient;
  session: SessionStore;
  sound: SoundSwitch;
  /** The light mode (YOUR ACCOUNT's LIGHT MODE). */
  mode: ModeSwitch;
  /** A chapter of the rail, in the app (its history entry the router's). */
  onChapter(chapter: ChapterId): void;
  /** Signed out, the account button: MY PIECES and its sign-in (on a computer, the sign-in page). */
  onSignIn(): void;
  /** Desktop (decision 5): the account button opens YOUR ACCOUNT's page on a computer. */
  onAccount(): void;
  /** Desktop: SEE MESSAGES and NOW's READ open MESSAGES' page on a computer (on FROM ORBES for `part` 'house'). */
  onMessagesPage(part?: MessagesPart): void;
  /** Desktop (decision 5): WRITE TO ORBES CLIENT SERVICES on a computer, MESSAGES on what it attaches. */
  onWrite(context: WriteContext | null): void;
  /** Desktop: what the account's pages ask of the app (their addresses, YOUR WISHLIST, NOW after SIGN OUT). */
  accountHost: AccountPageHost;
  /** THE CLUB (plan NEXT-NINE, BP-19 T9): the footer's line and the account sheet's row, in the app. */
  onTheClub(): void;
  /** YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2): the account sheet's row, its page in the app. */
  onWishlist(): void;
  /** THE VAULT (lot Q3 §3.6): the account sheet's row, its page in the app. */
  onVault(): void;
  /** The SCAN ring: the scanner (a tap: the sound signature's context is created in it). */
  onScan(): void;
  /** Desktop: SCAN in the top bar, the SCAN page (no camera on a computer). */
  onScanPage(): void;
  /** MESSAGES' CONCERNING link: the place a message concerned, in the app. */
  onConcerning(target: ConcerningTarget): void;
  /** NOW's line follows MESSAGES once read: the conversation, or FROM ORBES (lot M2). */
  onMessagesRead(part: MessagesPart): void;
  /** A house message's link (lot M2, FROM ORBES): its place in the app (the sheet keeps YOUR SIZES and IN USE). */
  onHouse(target: HouseTarget): void;
  /** FORGOTTEN PASSWORD? of the write sheet's sign-in: ORBES Client Services' email. */
  recoveryContact(): Promise<ContactModel | undefined>;
  /**
   * The consent banner (lot M4 plan §3.4; views/consent-banner.ts): fixed at the foot of the screen beside the SCAN ring,
   * outside the column, made inert with the page while a sheet covers it. It puts itself in the page only once wanted
   * (switched on, no choice held): with conversions off the page is as it was.
   */
  consentBand?: HTMLElement;
}

/**
 * The screens drawn in NOCTURNE with its chrome; the others of NOCTURNE (the scanner, VERIFYING…, a problem of the
 * scan: C11, C12, C17) keep the whole screen, without the rail and the ring.
 */
const CHROME_SCREENS: readonly string[] = ['landing', 'result', 'pieces', 'piece', 'lookbook', 'sheet', 'releases', 'release', 'circle', 'circlePost', 'club', 'how', 'wishlist', 'vault', 'gift', 'scanPage', 'account', 'signIn', 'messages', 'order', 'reset', 'unsubscribe'];
const NOCTURNE_SCREENS: readonly string[] = [...CHROME_SCREENS, 'scan', 'verifying', 'message'];
/** Desktop (BRIEF §5.3): on a computer the top bar stays on every page, VERIFYING… and a problem of the scan
 *  too (they open no camera there); the phone keeps them on the whole screen. */
const DESKTOP_CHROME_SCREENS: readonly string[] = ['verifying', 'message'];
/** Desktop (BRIEF §5.4): the screens of the scan a computer reaches from SCAN, which the top bar marks current. */
const DESKTOP_SCAN_SCREENS: readonly string[] = ['verifying', 'result', 'message'];

/** Safari's bars (addition 13): the ink of NOCTURNE, and the light of the shared certificate, kept as it is. */
export const THEME_COLOURS = Object.freeze({ nocturne: '#0a0a0a', certificate: '#ffffff' });
/** The NOCTURNE screens the light mode leaves dark: the camera, and THE VAULT page (lot Q3 §3.5, D41); shared/light.css
 *  names them the same way. */
const LIGHT_EXCEPT: readonly string[] = ['scan', 'vault'];

/** The rail's dot is read again no sooner than this (the banner's own cadence). */
const RAIL_REFRESH_MS = 60_000;
/** Desktop: the menu waits no longer than this for RELEASES' dot (then shows; the dot comes when it is read). */
const RAIL_WAIT_MS = 2_000;

/** Each chapter's address (shared/chapters.ts: the legal pages' rail leads to the same). */
const PATHS: Readonly<Record<ChapterId, string>> = CHAPTER_PATHS;

export class Shell {
  /** The column: the header, the rail, the banner, the app's screen (`host`), the footer. */
  readonly column: HTMLElement;
  private readonly header: HTMLElement;
  /** Signed in: the tier's name and the monogram, a button that opens the account sheet (a phone's). */
  private readonly account: HTMLButtonElement;
  private readonly accountText = h('span', { class: 'n-acct__tier' });
  /**
   * Desktop (decision 5): on a computer the same words and monogram, a link to YOUR ACCOUNT's page (its
   * address shown, openable in a new tab); the button above stays the phone's.
   */
  private readonly accountLink: HTMLAnchorElement;
  private readonly accountLinkText = h('span', { class: 'n-acct__tier' });
  /** Signed out: SIGN IN, a link to MY PIECES and its sign-in (on a computer, to the sign-in page). */
  private readonly signIn: HTMLAnchorElement;
  /** Desktop: SCAN in the top bar, beside the account (shown on a computer only; the ring is the phone's). */
  private readonly scanLink: HTMLAnchorElement;
  private readonly rail: HTMLElement;
  private readonly links: Map<ChapterId, HTMLAnchorElement>;
  private readonly live = h('i', { class: 'n-rail__live', attrs: { 'aria-hidden': 'true', hidden: true } });
  /** The dot's word for a screen reader (shared/chapters.ts RAIL_LIVE_WORD): RELEASES LIVE while it shows. */
  private readonly liveWord = h('span', { class: 'visually-hidden n-rail__live-word', attrs: { hidden: true } });
  private readonly foot: HTMLElement;
  private readonly soundButton: HTMLButtonElement | null;
  /** The SCAN ring, fixed at the foot of the screen. */
  readonly ring: HTMLElement;
  /** The consent banner, when the app gives one (beside the ring, outside the column; in the page once wanted). */
  private readonly bands: HTMLElement[];
  readonly sheet: AccountSheet;
  /** Desktop (decision 5): the account as pages of a computer, the sheet's views each at its address. */
  readonly page: AccountPage;
  /** WRITE TO ORBES CLIENT SERVICES (CS-01). */
  readonly write: WriteSheet;
  /** An order's sheets in YOUR ORDERS (plan NEXT LOT §3.6): its delivery address, its engraving, a return or an exchange. */
  readonly orderSheet: OrderSheet;
  private club: ClubStatus | null = null;
  private clubFor: string | null = null;
  private railReadAt = -Infinity;
  private railReading = false;
  /** Desktop: the session asked once (known, or its request failed), and the tier being read. */
  private sessionTried = false;
  private clubReading = false;
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
      // The sheet on a phone (on a computer the link below is shown in its place: YOUR ACCOUNT's page, decision 5).
      { class: 'n-g n-acct', attrs: { type: 'button', 'aria-haspopup': 'dialog', hidden: true }, on: { click: () => (isDesktop() ? deps.onAccount() : this.sheet.open(this.account)) } },
      this.accountText,
      monogram(28),
    );
    this.accountLink = appAnchor(ACCOUNT_PATH, ['n-g', 'n-acct'], () => deps.onAccount(), this.accountLinkText, monogram(28));
    this.accountLink.hidden = true;
    // SIGN IN: MY PIECES and its sign-in on a phone; on a computer the sign-in page, its own address (decision 6).
    this.signIn = appAnchor(isDesktop() ? SIGN_IN_PATH : PIECES_PATH, ['n-g', 'n-acct'], () => deps.onSignIn(), CHROME.signIn);
    this.signIn.hidden = true;
    // Desktop (BRIEF §5.4): SCAN in the top bar, to the left of the account, on a computer only.
    this.scanLink = appAnchor(SCAN_PAGE_PATH, ['n-g', 'n-hd__scan'], () => deps.onScanPage(), icon('scan', { small: true }), h('span', { class: 'n-hd__scan-word', text: DESKTOP.scan }));
    this.scanLink.setAttribute('aria-label', DESKTOP.scanLabel);
    this.scanLink.hidden = !isDesktop();
    onDesktopChange((desktop) => {
      this.scanLink.hidden = !desktop;
      this.signIn.href = desktop ? SIGN_IN_PATH : PIECES_PATH;
      this.drawAccount();
      if (this.screen) {
        this.drawChrome();
        this.drawCurrent();
      }
    });
    this.header = h('header', { class: 'n-hd' }, h('span', { class: 'n-g n-wm', text: 'ORBES' }), this.account, this.signIn);
    // Desktop: on a computer ORBES is a link to NOW, the first Tab stop (§10.17); the phone's word elsewhere.
    wordmarkLink(this.header.querySelector<HTMLElement>(':scope > .n-wm'), () => appAnchor(LANDING_PATH, ['n-g', 'n-wm'], () => deps.onChapter('now'), 'ORBES'));

    this.links = new Map(
      CHAPTERS.map((c) => {
        const link = appAnchor(PATHS[c], ['n-g', 'n-rail__link'], () => deps.onChapter(c), CHROME.chapters[c]);
        link.dataset.chapter = c;
        return [c, link] as const;
      }),
    );
    this.links.get('releases')!.append(this.live, this.liveWord);
    // Desktop (BRIEF §10.11): on a computer the menu shows once RELEASES' dot is known (its first reading, a
    // moment at most), so the centred menu never moves as the dot comes; nothing on a phone.
    this.rail = h('nav', { class: 'n-rail', attrs: { 'aria-label': CHROME.rail, 'data-d-pending': true } }, ...this.links.values());
    window.setTimeout(() => this.rail.removeAttribute('data-d-pending'), RAIL_WAIT_MS);

    const foot = footer(
      deps.sound,
      () => {
        deps.sound.set(!deps.sound.on);
        this.drawSound();
        this.sheet.soundChanged();
        this.page.soundChanged();
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

    this.bands = deps.consentBand ? [deps.consentBand] : [];
    this.column = h('div', { class: 'n-column' });
    host.before(this.column);
    this.column.append(this.header, this.rail, banner, host, this.foot);
    for (const el of [this.header, this.rail, this.foot]) el.hidden = true;
    // Desktop: the menu inside the top bar, before SCAN (the Tab order follows the eye, BRIEF §10.17). SCAN and the
    // account's link are a computer's only: out of the header elsewhere, so a phone's header is production's.
    dockRail(this.header, this.rail, () => (isDesktop() ? [this.scanLink, this.account, this.accountLink, this.signIn] : [this.account, this.signIn]));

    this.sheet = new AccountSheet({
      api: deps.api,
      session: deps.session,
      sound: deps.sound,
      mode: deps.mode,
      onPieces: () => deps.onChapter('pieces'),
      onTheClub: () => deps.onTheClub(),
      onWishlist: () => deps.onWishlist(),
      onVault: () => deps.onVault(),
      onSound: () => this.drawSound(),
      onClub: (club) => {
        this.club = club;
        this.drawAccount();
      },
      outside: () => [this.column, this.ring, ...this.bands],
      onConcerning: (target) => deps.onConcerning(target),
      onHouse: (target) => deps.onHouse(target),
      onRead: (part) => deps.onMessagesRead(part),
    });
    this.page = new AccountPage({
      api: deps.api,
      session: deps.session,
      sound: deps.sound,
      mode: deps.mode,
      onPieces: () => deps.onChapter('pieces'),
      onTheClub: () => deps.onTheClub(),
      onWishlist: () => deps.onWishlist(),
      onVault: () => deps.onVault(),
      onSound: () => this.drawSound(),
      onClub: (club) => {
        this.club = club;
        this.drawAccount();
      },
      outside: () => [],
      onConcerning: (target) => deps.onConcerning(target),
      onHouse: (target) => deps.onHouse(target),
      onRead: (part) => deps.onMessagesRead(part),
      host: deps.accountHost,
    });
    this.write = new WriteSheet({
      api: deps.api,
      session: deps.session,
      outside: () => [this.column, this.ring, ...this.bands],
      recoveryContact: () => deps.recoveryContact(),
      onMessages: (trigger) => this.sheet.openMessages(trigger),
    });
    registerWriteSheet((context, trigger) => {
      if (this.sheet.isOpen) this.sheet.close();
      if (this.orderSheet.isOpen) this.orderSheet.close();
      // Desktop (decision 5): on a computer, MESSAGES' page on the subject of what the button attaches.
      if (isDesktop()) deps.onWrite(context);
      else this.write.open(context, trigger);
    });
    this.orderSheet = new OrderSheet({ api: deps.api, session: deps.session, outside: () => [this.column, this.ring, ...this.bands] });
    registerOrderSheet((request) => {
      if (this.sheet.isOpen) this.sheet.close();
      if (this.write.isOpen) this.write.close();
      this.orderSheet.open(request);
    });
    registerMessages((trigger, part) => {
      if (this.write.isOpen) this.write.close();
      if (isDesktop()) deps.onMessagesPage(part);
      else this.sheet.openMessages(trigger, part);
    });
    document.body.append(this.ring, this.sheet.el, this.write.el, this.orderSheet.el);

    deps.session.subscribe(() => this.onSession());
    this.drawAccount();
    this.drawSound();
    void deps.session
      .ensure()
      .catch(() => undefined)
      .finally(() => {
        this.sessionTried = true;
        this.drawAccount();
      });
  }

  /** The screen now shown: NOCTURNE's ground or not, the chrome or not, the rail's chapter, Safari's bars. */
  show(screen: string): void {
    this.screen = screen;
    const nocturne = this.drawChrome();
    document.body.classList.toggle('nocturne', nocturne);
    // Another screen (a chapter, back, a link): the sheets give way to it, and the story card's preview (BP-10).
    if (this.sheet.isOpen) this.sheet.close();
    if (this.write.isOpen) this.write.close();
    if (this.orderSheet.isOpen) this.orderSheet.close();
    closeStoryPreview();
    this.drawCurrent();
    this.drawThemeColour();
    if (!this.header.hidden) {
      this.drawSound();
      if (Date.now() - this.railReadAt >= RAIL_REFRESH_MS) void this.readRail();
    }
  }

  /**
   * The current item of the rail (aria-current and its static line): the screen's chapter. Desktop (BRIEF
   * §5.4): on a computer the scan lives under SCAN in the top bar, so its page, VERIFYING…, a result and a problem of the
   * scan mark SCAN; on a phone the scan lives on NOW, which a result keeps marking.
   */
  /**
   * Desktop: the account sheet on one of its views (a window narrowed to a phone's on that page, main.ts); also a
   * piece's WORN, YOUR PROFILE on a phone, whose `onClosed` runs as the sheet closes.
   */
  openAccountSheet(view: AccountView, part?: MessagesPart, onClosed?: () => void): void {
    this.sheet.openOn(view, this.account, part, onClosed);
  }

  /** Desktop: the account sheet closed, the view it showed (null: it was not open). */
  closeAccountSheet(): AccountView | null {
    if (!this.sheet.isOpen) return null;
    const view = this.sheet.shownView;
    this.sheet.close();
    return view;
  }

  private drawCurrent(): void {
    const screen = this.screen;
    const scan = screen === 'scanPage' || (isDesktop() && DESKTOP_SCAN_SCREENS.includes(screen));
    if (scan) this.scanLink.setAttribute('aria-current', 'page');
    else this.scanLink.removeAttribute('aria-current');
    // Desktop: the account's pages mark the account button (its words in ink), YOUR WISHLIST too at its card's
    // address under the account; the sign-in page SIGN IN.
    const accountPage = screen === 'account' || screen === 'messages' || (screen === 'wishlist' && isDesktop() && accountRouteOf(location.pathname) === 'wishlist');
    for (const el of [this.account, this.accountLink]) {
      if (accountPage) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    if (screen === 'signIn') this.signIn.setAttribute('aria-current', 'page');
    else this.signIn.removeAttribute('aria-current');
    const chapter = scan ? null : chapterOf(screen);
    for (const [c, link] of this.links) {
      if (c === chapter) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  /**
   * The chrome (the header, the rail, the footer, the SCAN ring) shown or hidden for the screen on show; returns whether
   * the screen is one of NOCTURNE's. Drawn again when the window crosses the desktop breakpoint (VERIFYING… and a
   * problem of the scan have the chrome on a computer only).
   */
  private drawChrome(): boolean {
    const screen = this.screen;
    const chrome = CHROME_SCREENS.includes(screen) || (screen === 'live' && this.liveOn) || (isDesktop() && DESKTOP_CHROME_SCREENS.includes(screen));
    for (const el of [this.header, this.rail, this.foot, this.ring]) el.hidden = !chrome;
    return chrome || NOCTURNE_SCREENS.includes(screen);
  }

  /** The light mode was switched (YOUR ACCOUNT): the browser's bars follow the ground. */
  modeChanged(): void {
    this.drawThemeColour();
  }

  /**
   * Safari's bars: the certificate's paper, the light ground on a NOCTURNE screen drawn light (shared/light.css: every
   * NOCTURNE screen but the camera), NOCTURNE's ground everywhere else (the LIVE RELEASE's room too).
   */
  private drawThemeColour(): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const light = isLight() && document.body.classList.contains('nocturne') && !LIGHT_EXCEPT.includes(this.screen);
    meta.content = this.screen === 'certificate' ? THEME_COLOURS.certificate : light ? MODE_THEME_COLOURS.light : THEME_COLOURS.nocturne;
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
      this.page.known(null);
      if (email) void this.readClub(email);
    }
    this.drawAccount();
  }

  /** The tier the header names, read once per account (and again each time the sheet opens). */
  private async readClub(email: string): Promise<void> {
    this.clubReading = true;
    try {
      const club = await this.deps.api.clubStatus();
      if (this.clubFor !== email) return;
      this.club = club;
      this.sheet.known(club);
      this.page.known(club);
    } catch (e) {
      this.deps.session.noteError(e);
    } finally {
      if (this.clubFor === email) this.clubReading = false;
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
    // The phone's button, or a computer's link (desktop): the same words and name.
    const desktop = isDesktop();
    this.account.hidden = s.status !== 'signed-in' || desktop;
    this.accountLink.hidden = s.status !== 'signed-in' || !desktop;
    this.signIn.hidden = s.status !== 'anonymous';
    for (const text of [this.accountText, this.accountLinkText]) {
      text.textContent = m.kind === 'account' ? (m.text ?? '') : '';
      text.hidden = m.kind !== 'account' || m.text === null;
    }
    for (const el of [this.account, this.accountLink]) el.setAttribute('aria-label', m.kind === 'account' ? m.label : 'Your account');
    // Desktop (BRIEF §10.11): on a computer, SCAN and the account wait for the account to be known (the
    // session asked, the tier read), then show together at their final width, so the top bar never moves as they come.
    const pending = (s.status === 'unknown' && !this.sessionTried) || (s.status === 'signed-in' && this.clubReading);
    this.header.toggleAttribute('data-d-pending', pending && desktop);
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
      this.rail.removeAttribute('data-d-pending');
    }
  }
}
