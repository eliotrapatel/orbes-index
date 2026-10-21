/**
 * ORBES verification app (PLATFORM-CONTRACTS §4, spec §19–20).
 *
 *   NOW (the landing, views/now.ts): what leads (a LIVE RELEASE, a draw, the newest model) ──SEE THE …──▶ its page;
 *            an owner's pieces ──▶ MY PIECES; the next invitation (YES / NO) ──▶ its post; THE COLLECTION ──▶ the lookbook
 *   landing ──SCAN──▶ scanner ──code read──▶ VERIFYING… ──▶ result
 *      ├──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ result
 *      ├──MY PIECES──▶ the owner's pieces (/verify/pieces, F-01)
 *      ├──THE COLLECTION──▶ the lookbook (/verify/lookbook, P-R02) ──SEE THE MODEL──▶ a sheet
 *      └──THE RELEASES──▶ the releases (/verify/releases, P-R03) ──SEE THE RELEASE──▶ a release's page
 *                         a LIVE RELEASE's page (plan of 2026-10-04): its room, its line, the turn, the piece secured
 *                         (the vault), the reservation confirmed (ivory); read first as one, else a draw's
 *   MY PIECES ──THE CIRCLE──▶ the owners' circle (/verify/circle, P-X01) ──SEE THE …──▶ a post
 *   result ──SEE THE MODEL──▶ its model's sheet (/verify/lookbook/<slug>), the lookbook under it
 *   result ──REGISTER, then VIEW AS OWNER──▶ VERIFYING… ──▶ the result with the ceremony (P-D01)
 *   an AUTHENTIC_* result ──▶ the sound signature (P-D07), its AudioContext created in the tap SCAN or UPLOAD
 *   the scan as a ritual (P-D10): the ring searches, tightens around the centre on a seal seen (onSeal), locks on the
 *                    code; VERIFYING… takes the ring up, and the result's GENOME plate opens from the centre
 *   MY PIECES ──▶ the banner of the LIVE RELEASES over it (a plate under the rail): its release's page
 *   a boutique board's link ──▶ the board of a LIVE RELEASE (/verify/releases/<id>/board#secret), on its own
 *   a shared link ──▶ an ownership certificate (/verify/c#token, F-06)
 *   any step ──problem──▶ message (camera declined, no code, offline…)
 *   NOCTURNE's chrome (views/shell.ts) round every screen but the scan, the room, the board and the certificate: the
 *                    header (the tier and the monogram open the account sheet, views/account.ts; SIGN IN signed out),
 *                    the rail of chapters NOW · RELEASES · COLLECTION · CIRCLE · PIECES, the footer, the SCAN ring
 *
 * The page only reads the code; the server verifies it. Nothing secret lives
 * here: no keys, no thresholds.
 *
 * Paths (a small router; static.ts serves the shell at /verify and /verify/*):
 *   /verify          the landing, and every screen of a scan (one URL);
 *   /verify/pieces   MY PIECES, which a link, a reload or a bookmark opens directly (its tab, PIECES, ORDERS or
 *                    RELEASES, kept by its entry);
 *   /verify/pieces/<id>  a piece of MY PIECES (plan NOCTURNE, C4), over MY PIECES' entry (an address that is none: MY
 *                    PIECES, its address put back);
 *   /verify/c#…      the ownership certificate of a link an owner shared: its token
 *                    is the fragment, which no request line or proxy log holds;
 *   /verify/lookbook          THE COLLECTION, the lookbook of the models (P-R02);
 *   /verify/lookbook/<slug>   a model's sheet (an address that is none: the lookbook);
 *   /verify/club              THE CLUB, the tiers and what each gives (plan NEXT-NINE, BP-19 T9);
 *   /verify/releases          THE RELEASES, the drops ORBES announces (P-R03);
 *   /verify/releases/how      HOW RELEASES WORK, every release's rules (plan NEXT-NINE, FT-01), over the list's entry or
 *                             the release's it was opened from;
 *   /verify/releases/<id>     a release's page, its entry and its draw, or a LIVE RELEASE's (an address that is none: the list);
 *   /verify/releases/<id>/board#…  a LIVE RELEASE's boutique board, its secret the fragment: a screen of its own, with no
 *                             entry under it (a boutique's screen has nowhere to go back to);
 *   /verify/releases/<id>/after-room  the after-room of LIVE RELEASE <id>, for one of its guests (plan LIVE RELEASE+): its
 *                             page over the release's, read through it; anyone else (or signed out, or before its T0)
 *                             is shown the release's page instead, its address put back;
 *   /verify/circle            THE CIRCLE, the owners' feed (P-X01);
 *   /verify/circle/<id>       a post, its answer or its vote (an address that is none: the feed);
 *   /verify/reset#…           SET A NEW PASSWORD, RESET BY EMAIL's link (lot M1, E3): the account's email and its code in
 *                             the fragment, read and taken out of the address bar at once (kept in memory), over the landing;
 *   /verify/unsubscribe#…     STOP THESE EMAILS, an email's link (lot M1, E1, E2): its token, read and taken out alike;
 *   anything else    the landing, its address put back to /verify.
 *
 * History: the landing screen is the base entry and every other screen shares
 * one entry above it, MY PIECES, the certificate and the lookbook included
 * (with their own URL), so the back button (or CLOSE) returns to the landing
 * screen and releases the camera. A model's sheet is the one entry above
 * that: it lies on the lookbook's, so back from a sheet returns to the
 * lookbook, then to the landing (from a result, SEE THE MODEL turns the
 * scan's entry into the lookbook's). The releases (P-R03) are built alike: a
 * release's page lies on the list's entry, so back from it returns to the
 * list, then to the landing (from MY PIECES, an entry's release turns its
 * entry into the list's). The circle (P-X01) is built the same way: a post
 * lies on the feed's entry. Opened directly, MY PIECES, a certificate, the
 * lookbook, the releases or the circle puts a landing entry under itself, and
 * a sheet, a release's page or a post the landing and its list, so back still
 * leads through the app rather than out of it; a reload keeps the entry it is
 * on. A certificate's fragment edited in place reads the certificate again.
 */
import { viewportCorners } from '../shared/corners.js';
import { byId, focusFirst, h, prefersReducedMotion } from '../shared/dom.js';
import { ApiClient, ApiError, settledWithin } from './api.js';
import { buildVerifyInput, defaultZoomLevel, zoomLabel, type ZoomState } from './capture.js';
import { DESKTOP, HINTS, HOW, MESSAGES, PROBLEMS, problemForApiError, STATUS, type ProblemAction, type ProblemKind } from './copy.js';
import type { DecodeReply } from './protocol.js';
import { Camera, CameraError, DecoderClient, DecoderUnavailableError, PhotoError, readPhoto, ScanSession, workerUrl } from './scanner.js';
import { SessionStore } from './session.js';
import { SoundSignature } from './sound.js';
import { DeviceMode } from '../shared/mode.js';
import type { ClientServices, LiveEndedSheet, LiveSheet, VerifyInput } from './types.js';
import { certificateTokenOf } from './certificate-model.js';
import { CIRCLE_PATH, circlePostPath, circleRouteOf } from './circle-model.js';
import { CLUB_PATH, isClubPath } from './club-model.js';
import { HOW_PATH } from './how-model.js';
import { lookbookRouteOf, lookbookSheetPath } from './lookbook-model.js';
import { boardTokenOf } from './board-model.js';
import { afterRoomPath, releasePath, releasesRouteOf, RELEASES_PATH } from './releases-model.js';
import { recoveryContactModel, resultViewModel } from './view-model.js';
import { orderReference, type ConcerningTarget, type WriteContext } from './messages-model.js';
import { isResetPath, isUnsubscribePath, RESET_PATH, resetLinkOf, UNSUBSCRIBE_PATH, unsubscribeTokenOf, type ResetLink } from './reset-model.js';
import { boardView } from './views/board.js';
import { certificateView } from './views/certificate.js';
import { circlePostView, circleView } from './views/circle.js';
import { clubView } from './views/club.js';
import { howView } from './views/how.js';
import { CERTIFICATE_PATH, LANDING_PATH, LOOKBOOK_PATH, PIECES_PATH } from './views/common.js';
import { messageOf } from './views/forms.js';
import { liveView } from './views/live.js';
import { liveBannerView } from './views/live-banner.js';
import { lookbookView, sheetView } from './views/lookbook.js';
import { messageView } from './views/message.js';
import { nowView, type NowView } from './views/now.js';
import { pieceView } from './views/piece.js';
import { piecePath, piecesView, type PiecesTab } from './views/pieces.js';
import { wishlistView } from './views/wishlist.js';
import { isWishlistPath, WISHLIST_PATH } from './wishlist-model.js';
import { releasesView, releaseView, type ReleasesTab } from './views/releases.js';
import { resetView } from './views/reset.js';
import { unsubscribeView } from './views/unsubscribe.js';
import { resultView } from './views/result.js';
import { scanView, type ScanView } from './views/scanning.js';
import { Shell } from './views/shell.js';
import { readArrival, sendArrival, tabStorage } from './arrival.js';
import { seen } from './seen.js';
import type { SeenAppState } from './seen-model.js';
import { verifyingView } from './views/verifying.js';
import { isDesktop, onDesktopChange, watchBar } from '../shared/desktop.js';
import { nowArrangement } from './views/desktop-now.js';
import { resultArrangement } from './views/desktop-result.js';
import { modelArrangement } from './views/desktop-model.js';
import { wishlistArrangement } from './views/desktop-wishlist.js';
import { releaseArrangement } from './views/desktop-release.js';
import { piecesArrangement } from './views/desktop-pieces.js';
import { isScanPagePath, SCAN_PAGE_PATH, scanPageView } from './views/desktop-scan.js';
import { ACCOUNT_PATH, ACCOUNT_WISHLIST_PATH, accountPath, accountRouteOf, isAccountView, type AccountView } from './views/desktop-account.js';
import { isSignInPath, registerSignInPage, SIGN_IN_PATH, signInPageView, type SignInPageView, type SignInRequest, type SignInTab } from './views/desktop-signin.js';
import { isMessagesPath, isWriteContext, messagesPageView, messagesPath, messagesSubjectOf, subjectKey } from './views/desktop-messages.js';
import { isOrdersPath, orderPagePath, orderPageView, orderReferenceOf } from './views/desktop-order.js';

type Screen = 'landing' | 'scan' | 'verifying' | 'result' | 'message' | 'pieces' | 'piece' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'live' | 'board' | 'circle' | 'circlePost' | 'club' | 'how' | 'wishlist' | 'scanPage' | 'account' | 'signIn' | 'messages' | 'order' | 'reset' | 'unsubscribe';

/**
 * What a history entry of the app holds: the landing, a screen of a scan, MY PIECES, a certificate, the lookbook or a
 * sheet, the releases or a release's page, the circle or a post, THE CLUB, HOW RELEASES WORK, YOUR WISHLIST.
 */
type Entry = 'landing' | 'app' | 'pieces' | 'piece' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'circle' | 'circlePost' | 'club' | 'how' | 'wishlist' | 'scanPage' | 'account' | 'signIn' | 'messages' | 'order' | 'reset' | 'unsubscribe';

/** The entries above the landing that a scan, MY PIECES or a list takes the place of (their own address goes with them). */
const REPLACEABLE: readonly Entry[] = ['app', 'pieces', 'piece', 'certificate', 'lookbook', 'sheet', 'releases', 'release', 'circle', 'circlePost', 'club', 'how', 'wishlist', 'scanPage', 'account', 'signIn', 'messages', 'order', 'reset', 'unsubscribe'];

/**
 * The route of a path under /verify: MY PIECES, a certificate, the lookbook, a model's sheet, the releases, a
 * release's page, the circle, a post, or the landing (also for a path the app does not know). In any case: the
 * certificate's PDF letters its address in capitals (the server redirects those to /verify/c).
 */
function routeOf(pathname: string): 'landing' | 'pieces' | 'piece' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'board' | 'circle' | 'circlePost' | 'club' | 'how' | 'wishlist' | 'scanPage' | 'account' | 'signIn' | 'messages' | 'order' | 'reset' | 'unsubscribe' {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  // Desktop (decision 5): MESSAGES in two parts and an order's page of a computer. A phone keeps the account
  // sheet's MESSAGES (NOW at its address) and the order's card on MY PIECES' ORDERS (an order's address shows it there).
  if (isMessagesPath(path) && isDesktop()) return 'messages';
  if (isOrdersPath(path)) return isDesktop() && orderReferenceOf(pathname) ? 'order' : 'pieces';
  // Desktop (decisions 5, 6): the account's pages and the sign-in page of a computer (a phone keeps the sheet
  // and the sign-in where it stands: NOW at these addresses); YOUR WISHLIST's card's address is its page everywhere.
  const account = accountRouteOf(path);
  if (account === 'wishlist') return 'wishlist';
  if (account && isDesktop()) return 'account';
  if (isSignInPath(path) && isDesktop()) return 'signIn';
  if (path === PIECES_PATH) return 'pieces';
  // A piece of MY PIECES; under /verify/pieces, an address that is none is MY PIECES.
  if (path.startsWith(`${PIECES_PATH}/`)) return pieceIdOf(pathname) ? 'piece' : 'pieces';
  const lookbook = lookbookRouteOf(path);
  if (lookbook) return lookbook.sheet ? 'sheet' : 'lookbook';
  const releases = releasesRouteOf(path);
  if (releases) return releases.board ? 'board' : releases.how ? 'how' : releases.release ? 'release' : 'releases';
  const circle = circleRouteOf(path);
  if (circle) return circle.post ? 'circlePost' : 'circle';
  // THE CLUB (plan NEXT-NINE, BP-19 T9), built like the lookbook.
  if (isClubPath(path)) return 'club';
  // YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2), opened from the account sheet.
  if (isWishlistPath(path)) return 'wishlist';
  // Desktop: the SCAN page of a computer (a phone keeps NOW at this address).
  if (isScanPagePath(path) && isDesktop()) return 'scanPage';
  // The emails' pages (lot M1, step M1.19): an email's link, on a phone and a computer alike.
  if (isResetPath(path)) return 'reset';
  if (isUnsubscribePath(path)) return 'unsubscribe';
  return path === CERTIFICATE_PATH ? 'certificate' : 'landing';
}

/** The piece a path names (/verify/pieces/O26-J-00184), in capitals, or null. */
function pieceIdOf(pathname: string): string | null {
  const m = /^\/verify\/pieces\/([^/]+)\/?$/i.exec(pathname);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!).toUpperCase();
  } catch {
    return null;
  }
  return /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/.test(id) ? id : null;
}

/** MY PIECES' tab its place in the history keeps (PIECES, ORDERS or RELEASES; PIECES by default). */
const piecesTabOf = (state: unknown): PiecesTab => {
  const tab = (state as { tab?: unknown } | null)?.tab;
  return tab === 'orders' || tab === 'releases' ? tab : 'pieces';
};

/** The address of the sheet a path names, or null. */
const sheetSlugOf = (pathname: string): string | null => lookbookRouteOf(pathname)?.sheet ?? null;

/** The id of the release a path names, or null. */
const releaseIdOf = (pathname: string): string | null => releasesRouteOf(pathname)?.release ?? null;

/** Whether a path names the after-room of its release. */
const afterRoomOf = (pathname: string): boolean => releasesRouteOf(pathname)?.afterRoom === true;

/** The id of the post a path names, or null. */
const postIdOf = (pathname: string): string | null => circleRouteOf(pathname)?.post ?? null;

const entryOf = (state: unknown): Entry | undefined => (state as { screen?: Entry } | null)?.screen;

/**
 * Desktop: the page a piece, a release or a model's sheet was opened over when it was opened from MESSAGES
 * (its SEE THE PIECE, SEE THE RELEASE, SEE THE MODEL) or an order's page, with no list under it; null over its list.
 * Back from it returns to that page; its crumb (‹ MY PIECES, ‹ THE RELEASES, ‹ THE COLLECTION) opens the list over it.
 */
const overOf = (state: unknown): 'messages' | 'order' | null => {
  const over = (state as { from?: unknown } | null)?.from;
  return over === 'messages' || over === 'order' ? over : null;
};

/** On a computer, the page a piece, a release or a sheet opened now stands over directly (MESSAGES, an order's page). */
const pageUnder = (entry: Entry | undefined): 'messages' | 'order' | null => (isDesktop() && (entry === 'messages' || entry === 'order') ? entry : null);

/**
 * How many entries of the app an entry lies above the landing (0: the landing). Every entry the app writes carries it
 * (push, replace), so NOW (the rail) goes back to the landing in one step whatever the way taken. An entry written
 * without it (an address edited in place) is read from its kind: one over the landing, two for a sheet, a piece, a
 * release's page or a post (over their list), three for an after-room (over its release).
 */
function depthOf(state: unknown): number {
  const depth = (state as { depth?: unknown } | null)?.depth;
  if (typeof depth === 'number' && Number.isInteger(depth) && depth >= 0) return depth;
  const entry = entryOf(state);
  if (entry === undefined || entry === 'landing') return 0;
  if (entry === 'sheet' || entry === 'circlePost' || entry === 'piece' || entry === 'how' || entry === 'order') return 2;
  if (entry === 'release') return afterRoomOf(location.pathname) ? 3 : 2;
  // An account's section over YOUR ACCOUNT (desktop).
  if (entry === 'account') return accountRouteOf(location.pathname) === 'account' ? 1 : 2;
  return 1;
}

/** A new entry of the app over the current one, one step further from the landing. */
function pushEntry(state: object, url: string): void {
  history.pushState({ ...state, depth: depthOf(history.state) + 1 }, '', url);
}

/** The current entry rewritten in place, at its depth (the landing's is 0). */
function replaceEntry(state: unknown, url?: string): void {
  const depth = entryOf(state) === 'landing' ? 0 : depthOf(history.state);
  history.replaceState({ ...(state as object | null), depth }, '', url);
}

/** Desktop: the page the sign-in page gives way to once signed in (MESSAGES on a subject, an order's page). */
type SignInThen = { screen: 'messages' | 'order'; path: string; context?: WriteContext | null };

/** The sign-in page's form its entry keeps (desktop): CREATE ACCOUNT, or SIGN IN by default. */
const signInTabOf = (state: unknown): SignInTab => ((state as { tab?: unknown } | null)?.tab === 'create' ? 'create' : 'signin');

/** YOUR WISHLIST's address: on a computer its card's, under YOUR ACCOUNT (desktop). */
const wishlistPath = (): string => (isDesktop() ? ACCOUNT_WISHLIST_PATH : WISHLIST_PATH);

/** THE RELEASES' tab its place in the history keeps (plan LIVE RELEASE+, choice 5): PAST, or LIVE by default. */
const releasesTabOf = (state: unknown): ReleasesTab => ((state as { tab?: unknown } | null)?.tab === 'past' ? 'past' : 'live');

/** Minimum time VERIFYING… stays visible, so a fast answer never reads as a flicker. */
const MIN_VERIFYING_MS = 650;
/**
 * How long a result may wait for the contact of ORBES Client Services, from the moment the
 * verification is sent (the two are read together). A contact that has not come by then is left
 * out of this result; its read goes on, and the next result has it.
 */
const CONTACT_WAIT_MS = 1_000;
/** Fade-out of the outgoing screen. */
const LEAVE_MS = 280;
/** Pause on "ORBES CODE FOUND" before VERIFYING…, so the lock is seen. */
const LOCK_PAUSE_MS = 420;
/** Desktop: the longest MY PIECES waits on a computer for its banner to be known before it shows. */
const BANNER_WAIT_MS = 1_200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** This phone's time zone: a LIVE RELEASE says its times in Paris, then here when it differs. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

class App {
  private readonly host = byId('app');
  private readonly photoInput = byId<HTMLInputElement>('photo-input');
  private readonly api = new ApiClient();
  private readonly session = new SessionStore(this.api);
  private readonly camera = new Camera();
  /** The sound signature of an authentic result (P-D07), on unless turned off on this device. */
  private readonly sound = new SoundSignature();
  /** The light mode (shared/mode.ts), off unless turned on on this device; a switch redraws the browser's bar. */
  private readonly mode = new DeviceMode(undefined, () => this.shell?.modeChanged());
  private decoder: DecoderClient | null = null;
  private scan: { view: ScanView; session: ScanSession } | null = null;
  /** The screen on show that holds listeners (a result, MY PIECES): released when another takes its place. */
  private live: { dispose(): void } | null = null;
  private screen: Screen = 'landing';
  /** The shell's own document title (index.html), put back when HOW RELEASES WORK is left. */
  private readonly shellTitle = document.title;
  /** Bumped on every navigation; async work started under an older value is dropped. */
  private generation = 0;
  /** The last verify request, for TRY AGAIN after a connection problem. */
  private lastInput: VerifyInput | null = null;
  /** Whether that request was VIEW AS OWNER right after a first registration (P-D01): TRY AGAIN keeps its ceremony. */
  private lastCeremony = false;
  /** ORBES Client Services details, fetched with the first verification (a failed fetch is tried again with the next). */
  private clientServices: Promise<ClientServices> | null = null;
  private zoomed = false;
  /** The default zoom level of the open camera (≈ 2×), null when it has no useful zoom. */
  private zoomLevel: number | null = null;
  private resumeScan = false;
  /** The token of the certificate on show (its fragment), to tell an edited fragment from the same one. */
  private certificateToken: string | null = null;
  /** The address of the sheet on show (P-R02), to tell another sheet from the same one. */
  private sheetSlug: string | null = null;
  /** The id of the release on show (P-R03), to tell another release from the same one. */
  private releaseId: string | null = null;
  /** The page shown is the after-room of `releaseId`. */
  private releaseAfterRoom = false;
  /** The id of the post on show (P-X01), to tell another post from the same one. */
  private postId: string | null = null;
  /** The id of the piece on show (C4), to tell another piece from the same one. */
  private pieceId: string | null = null;
  /** MY PIECES' tab on show: the banner is the PIECES tab's (C3; C24 and C31 go without it). */
  private piecesTab: PiecesTab = 'pieces';
  /** ORDER OR-… from a piece's page: MY PIECES opens on ORDERS with it in view once back on its entry. */
  private pendingOrder: string | null = null;
  /** The banner of the LIVE RELEASES, over MY PIECES (and nowhere else: on NOW, the release leads the page). */
  private readonly banner = liveBannerView({ api: this.api, onRelease: (id) => this.openRelease(id) });
  /** NOCTURNE's chrome round the screen: the header and its account sheet, the rail, the footer, the SCAN ring. */
  private shell: Shell | null = null;
  /** The LIVE RELEASE's page on show shows its room (its own chrome): the recording's LIVE (plan CUSTOMER INTELLIGENCE §3.3 T.9). */
  private liveRoom = false;
  /**
   * Desktop (decision 6): the screen the sign-in page was opened from, kept as it stood (its page, its tab, a
   * result and its scan's windows), shown again once signed in there or on back.
   */
  private signInFrom: { root: HTMLElement; live: { dispose(): void } | null; screen: Screen; path: string; depth: number } | null = null;
  /** The sign-in page on show (its form follows its entry's). */
  private signInPage: SignInPageView | null = null;
  /**
   * The emails' links (lot M1, step M1.19): RESET BY EMAIL's email and code, an unsubscribe link's token, read from the
   * fragment and taken out of the address bar at once; kept in memory for back and forward, never stored.
   */
  private resetLink: ResetLink | null = null;
  private unsubscribeToken: string | null = null;

  start(): void {
    // Where the visit comes from (plan CUSTOMER INTELLIGENCE §3.4 A.9): `o` and the `utm_` tags read and taken out of the
    // address before the router's first replaceEntry, the referring page on the tab's first load; sent below.
    const arrival = readArrival(location, document, tabStorage(), history);
    // What the collector looks at (plan CUSTOMER INTELLIGENCE §3.3 T.9): off in an automated browser, nothing drawn.
    seen.start(this.api);
    this.photoInput.addEventListener('change', () => {
      const file = this.photoInput.files?.[0];
      this.photoInput.value = '';
      if (file) void this.verifyPhoto(file);
    });
    window.addEventListener('popstate', (ev) => {
      // Back or forward onto MY PIECES, a certificate, the lookbook or a sheet shows it again; onto the landing, or onto
      // a scan's entry (its screen is gone), the landing.
      const entry = entryOf(ev.state);
      const route = routeOf(location.pathname);
      // Desktop: back from the sign-in page (or signed in there) onto the place it was opened from, as it was.
      if (this.signInFrom && entry !== 'signIn' && route !== 'signIn') {
        const from = this.signInFrom;
        this.signInFrom = null;
        if (location.pathname + location.search + location.hash === from.path && depthOf(ev.state) === from.depth) {
          void this.restoreScreen(from);
          return;
        }
        from.live?.dispose();
      }
      if (route === 'board') {
        if (this.screen !== 'board') void this.showBoard();
      } else if (entry === 'messages' || route === 'messages') {
        // Desktop: MESSAGES on the subject its address names (a phone: the account sheet on MESSAGES).
        void this.showMessages();
      } else if (entry === 'order' || route === 'order') {
        // Desktop: an order's page (a phone: its card on MY PIECES' ORDERS).
        void this.showOrder();
      } else if (entry === 'piece' || route === 'piece') {
        const id = pieceIdOf(location.pathname);
        if (!(this.screen === 'piece' && this.pieceId === id)) void this.showPiece(id);
      } else if (entry === 'pieces' || route === 'pieces') {
        // Back onto MY PIECES (from a piece, or ORDER OR-… on a piece's page: ORDERS, the order in view).
        if (this.pendingOrder !== null) replaceEntry({ ...(history.state as object), screen: 'pieces', tab: 'orders' });
        if (this.screen !== 'pieces' || this.pendingOrder !== null) void this.showPieces();
      } else if (entry === 'certificate' || route === 'certificate') this.onCertificateAddress();
      else if (entry === 'sheet' || route === 'sheet') {
        const slug = sheetSlugOf(location.pathname);
        if (!(this.screen === 'sheet' && this.sheetSlug === slug)) void this.showSheet(slug);
      } else if (entry === 'lookbook' || route === 'lookbook') {
        if (this.screen !== 'lookbook') void this.showLookbook();
      } else if (entry === 'how' || route === 'how') {
        if (this.screen !== 'how') void this.showHow();
      } else if (entry === 'release' || route === 'release') {
        const id = releaseIdOf(location.pathname);
        const after = afterRoomOf(location.pathname);
        if (!((this.screen === 'release' || this.screen === 'live') && this.releaseId === id && this.releaseAfterRoom === after)) void this.showRelease(id, true, after);
      } else if (entry === 'releases' || route === 'releases') {
        if (this.screen !== 'releases') void this.showReleases();
      } else if (entry === 'circlePost' || route === 'circlePost') {
        const id = postIdOf(location.pathname);
        if (!(this.screen === 'circlePost' && this.postId === id)) void this.showCirclePost(id);
      } else if (entry === 'circle' || route === 'circle') {
        if (this.screen !== 'circle') void this.showCircle();
      } else if (entry === 'club' || route === 'club') {
        if (this.screen !== 'club') void this.showClub();
      } else if (entry === 'signIn' || route === 'signIn') {
        // The sign-in page (desktop): its form as its entry keeps it.
        if (this.screen === 'signIn') this.signInPage?.showTab(signInTabOf(history.state));
        else void this.showSignIn();
      } else if (entry === 'account' || route === 'account') {
        void this.showAccount();
      } else if (entry === 'wishlist' || route === 'wishlist') {
        if (this.screen !== 'wishlist') void this.showWishlist();
      } else if ((entry === 'scanPage' || route === 'scanPage') && isDesktop()) {
        if (this.screen !== 'scanPage') void this.showScanPage();
      } else if (entry === 'reset' || route === 'reset') {
        if (this.screen !== 'reset') void this.showReset();
      } else if (entry === 'unsubscribe' || route === 'unsubscribe') {
        if (this.screen !== 'unsubscribe') void this.showUnsubscribe();
      } else if (this.screen !== 'landing') void this.showLanding();
    });
    // A certificate's fragment changed in place (pasted, edited): the certificate of the new one.
    window.addEventListener('hashchange', () => {
      const route = routeOf(location.pathname);
      if (route === 'certificate') this.onCertificateAddress();
      // A board's secret pasted or changed in place: the board of the new one.
      else if (route === 'board') void this.showBoard();
      // An email's link opened again in this tab (only its fragment differs): its page, with the new one.
      else if ((route === 'reset' || route === 'unsubscribe') && location.hash.length > 1) this.openMailLink(route);
    });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.stopCamera());

    document.body.prepend(viewportCorners());
    // Desktop: the top bar over an opening frame, then on the ground (shared/desktop.ts); NOW's and a
    // result's own arrangements on a computer (views/desktop-now.ts, views/desktop-result.ts).
    watchBar({ arrange: [nowArrangement, resultArrangement, modelArrangement, wishlistArrangement, releaseArrangement, piecesArrangement] });
    // Desktop (BRIEF §5b: no scroll restore): a computer changes pages at once, so the browser's own restore
    // after Back would run after the page's scrollTo(0, 0) and win; every page opens at its top, as on the phone (whose
    // fade lets the page's scroll come last). The phone keeps the browser's default.
    const scrollRule = (desktop: boolean) => {
      if ('scrollRestoration' in history) history.scrollRestoration = desktop ? 'manual' : 'auto';
    };
    scrollRule(isDesktop());
    onDesktopChange(scrollRule);
    this.shell = new Shell(
      {
        api: this.api,
        session: this.session,
        sound: this.sound,
        mode: this.mode,
        onChapter: (c) => {
          if (c === 'now') this.openNow();
          else if (c === 'releases') this.openReleases();
          else if (c === 'collection') this.openLookbook();
          else if (c === 'circle') this.openCircle();
          else this.openPieces({ tab: 'pieces' });
        },
        onSignIn: () => this.signIn(),
        onAccount: () => this.openAccount(),
        onMessagesPage: () => this.openMessages(),
        onWrite: (context) => this.openMessages({ context }),
        accountHost: {
          navigate: (view) => this.navigateAccount(view),
          openWishlist: () => this.openWishlist(),
          signedOut: () => this.openNow(),
          signIn: (view) => this.accountSignIn(view),
          openMessages: () => this.openMessages(),
        },
        onTheClub: () => this.openClub(),
        onWishlist: () => this.openWishlist(),
        onScan: () => void this.startScan(),
        onScanPage: () => this.openScanPage(),
        onConcerning: (target) => this.openConcerning(target),
        onMessagesRead: () => {
          if (this.screen === 'landing') (this.live as NowView | null)?.messagesRead();
        },
        recoveryContact: async () => recoveryContactModel(await this.contactDetails(), '') ?? undefined,
      },
      this.host,
      this.banner.el,
    );
    // Desktop (decision 6): every SIGN IN · CREATE ACCOUNT line of a computer opens the sign-in page.
    registerSignInPage((request) => this.openSignIn(request));
    // Desktop (§4: a window resized across the breakpoint never breaks): a computer's window narrowed past the
    // desktop's width on an account's page shows NOW in that entry's place, the account sheet open on the same view
    // (the account's pages are a computer's, the sheet the phone's); widened again with the sheet open, that page.
    onDesktopChange((desktop) => {
      if (desktop) {
        const shown = this.shell?.closeAccountSheet() ?? null;
        if (shown === 'account') this.openAccount();
        else if (shown) this.openAccountSection(shown);
        return;
      }
      if (this.screen === 'signIn') {
        this.signInToPhone();
        return;
      }
      if (this.screen === 'messages') {
        void this.showMessages();
        return;
      }
      if (this.screen === 'order') {
        void this.showOrder();
        return;
      }
      // The SCAN page is a computer's (decision 4): narrowed past the desktop's width, NOW in its entry's place, as its
      // address gives on a phone (routeOf); widened again, NOW stays.
      if (this.screen === 'scanPage') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        void this.showLanding();
        return;
      }
      if (this.screen !== 'account') return;
      const named = accountRouteOf(location.pathname);
      const view: AccountView = named && named !== 'wishlist' ? named : 'account';
      replaceEntry({ screen: 'landing' }, LANDING_PATH);
      void this.showLanding().then(() => {
        if (this.screen === 'landing') this.shell?.openAccountSheet(view);
      });
    });
    const route = routeOf(location.pathname);
    if (route === 'board') {
      // The boutique board: on its own, nothing under it; its secret stays in its own address.
      replaceEntry({ screen: 'board' });
      void this.showBoard(false);
    } else if (route === 'pieces') {
      // A reload keeps its entry; a direct visit (a link, a bookmark) puts the landing under MY PIECES. An address under
      // /verify/pieces that is none shows MY PIECES, its own address put back. Desktop: an order's address
      // (/verify/orders/OR-…) on a phone, its card on ORDERS.
      const orders = isOrdersPath(location.pathname);
      const order = orders ? orderReferenceOf(location.pathname) : null;
      if (order) this.pendingOrder = order;
      if (entryOf(history.state) !== 'pieces') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry(orders ? { screen: 'pieces', tab: 'orders' } : { screen: 'pieces' }, PIECES_PATH);
      } else if (location.pathname !== PIECES_PATH) replaceEntry(history.state, PIECES_PATH);
      void this.showPieces(false);
    } else if (route === 'piece') {
      // A piece over MY PIECES, over the landing: back from it returns to the list.
      const id = pieceIdOf(location.pathname)!;
      if (entryOf(history.state) !== 'piece') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'pieces' }, PIECES_PATH);
        pushEntry({ screen: 'piece' }, piecePath(id));
      }
      void this.showPiece(id, false);
    } else if (route === 'certificate') {
      // The same for a certificate, its fragment kept in its own address (the landing's has none).
      if (entryOf(history.state) !== 'certificate') {
        const address = `${CERTIFICATE_PATH}${location.hash}`;
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'certificate' }, address);
      }
      void this.showCertificate(false);
    } else if (route === 'lookbook' || route === 'sheet') {
      // The lookbook (P-R02) over the landing; a sheet over both, so back from it returns to the lookbook. An address
      // under /verify/lookbook that is none shows the lookbook, its own address put back.
      const slug = sheetSlugOf(location.pathname);
      if (entryOf(history.state) !== (slug ? 'sheet' : 'lookbook')) {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
        if (slug) pushEntry({ screen: 'sheet' }, lookbookSheetPath(slug));
      } else if (!slug && location.pathname !== LOOKBOOK_PATH) replaceEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
      if (slug) void this.showSheet(slug, false);
      else void this.showLookbook(false);
    } else if (route === 'how') {
      // HOW RELEASES WORK (plan NEXT-NINE, FT-01) over the list, over the landing: back from it returns to the list.
      if (entryOf(history.state) !== 'how') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'releases' }, RELEASES_PATH);
        pushEntry({ screen: 'how', over: 'releases' }, HOW_PATH);
      } else if (location.pathname !== HOW_PATH) replaceEntry(history.state, HOW_PATH);
      void this.showHow(false);
    } else if (route === 'releases' || route === 'release') {
      // The releases (P-R03) over the landing; a release's page over both, so back from it returns to the list. An
      // address under /verify/releases that is none shows the list, its own address put back.
      const id = releaseIdOf(location.pathname);
      const after = id !== null && afterRoomOf(location.pathname);
      if (entryOf(history.state) !== (id ? 'release' : 'releases')) {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'releases' }, RELEASES_PATH);
        // An after-room over its release's page: back from it returns to the second door.
        if (id) pushEntry({ screen: 'release' }, releasePath(id));
        if (after) pushEntry({ screen: 'release' }, afterRoomPath(id));
      } else if (!id && location.pathname !== RELEASES_PATH) replaceEntry({ screen: 'releases' }, RELEASES_PATH);
      if (id) void this.showRelease(id, false, after);
      else void this.showReleases(false);
    } else if (route === 'circle' || route === 'circlePost') {
      // The circle (P-X01) over the landing; a post over both, so back from it returns to the feed. An address under
      // /verify/circle that is none shows the feed, its own address put back.
      const id = postIdOf(location.pathname);
      if (entryOf(history.state) !== (id ? 'circlePost' : 'circle')) {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'circle' }, CIRCLE_PATH);
        if (id) pushEntry({ screen: 'circlePost' }, circlePostPath(id));
      } else if (!id && location.pathname !== CIRCLE_PATH) replaceEntry({ screen: 'circle' }, CIRCLE_PATH);
      if (id) void this.showCirclePost(id, false);
      else void this.showCircle(false);
    } else if (route === 'club') {
      // THE CLUB over the landing, as the lookbook: its own address put back.
      if (entryOf(history.state) !== 'club') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'club' }, CLUB_PATH);
      } else if (location.pathname !== CLUB_PATH) replaceEntry({ screen: 'club' }, CLUB_PATH);
      void this.showClub(false);
    } else if (route === 'wishlist') {
      // YOUR WISHLIST over the landing, as THE CLUB: its own address put back. On a computer, YOUR WISHLIST's card's
      // page, over YOUR ACCOUNT (desktop).
      const path = wishlistPath();
      if (entryOf(history.state) !== 'wishlist') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        if (isDesktop()) {
          pushEntry({ screen: 'account', view: 'account' }, ACCOUNT_PATH);
          pushEntry({ screen: 'wishlist', under: 'account' }, path);
        } else pushEntry({ screen: 'wishlist' }, path);
      } else if (location.pathname !== path) replaceEntry(history.state, path);
      void this.showWishlist(false);
    } else if (route === 'account') {
      // Desktop (decision 5): YOUR ACCOUNT over the landing, a section's page over both.
      const view = accountRouteOf(location.pathname) as AccountView;
      if (entryOf(history.state) !== 'account') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'account', view: 'account' }, ACCOUNT_PATH);
        if (view !== 'account') pushEntry({ screen: 'account', view, under: 'account' }, accountPath(view));
      } else if (location.pathname !== accountPath(view)) replaceEntry(history.state, accountPath(view));
      void this.showAccount(false);
    } else if (route === 'messages') {
      // Desktop (decision 5): MESSAGES over the landing, on the subject its address names (a reload keeps the
      // context of a subject not written yet: its entry's).
      if (entryOf(history.state) !== 'messages') {
        const path = location.pathname;
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'messages' }, path);
      }
      void this.showMessages(false);
    } else if (route === 'order') {
      // Desktop (decision 5): an order's page over MY PIECES' ORDERS, over the landing.
      if (entryOf(history.state) !== 'order') {
        const path = orderPagePath(orderReferenceOf(location.pathname)!);
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'pieces', tab: 'orders' }, PIECES_PATH);
        pushEntry({ screen: 'order', under: 'pieces' }, path);
      }
      void this.showOrder(false);
    } else if (route === 'signIn') {
      // Desktop (decision 6): the sign-in page over the landing (signed in there: back to it).
      if (entryOf(history.state) !== 'signIn') {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: 'signIn', tab: 'signin' }, SIGN_IN_PATH);
      }
      void this.showSignIn(false);
    } else if (route === 'reset' || route === 'unsubscribe') {
      // An email's link (lot M1, step M1.19) over the landing: its fragment read, then taken out of the address bar.
      const fresh = location.hash.length > 1;
      this.takeMailLink(route);
      if (fresh || entryOf(history.state) !== route) {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: route }, route === 'reset' ? RESET_PATH : UNSUBSCRIBE_PATH);
      } else replaceEntry(history.state, route === 'reset' ? RESET_PATH : UNSUBSCRIBE_PATH);
      void (route === 'reset' ? this.showReset(false) : this.showUnsubscribe(false));
    } else if (route === 'scanPage') {
      // Desktop: the SCAN page over the landing, as THE CLUB.
      if (entryOf(history.state) !== route) {
        replaceEntry({ screen: 'landing' }, LANDING_PATH);
        pushEntry({ screen: route }, SCAN_PAGE_PATH);
      } else if (location.pathname !== SCAN_PAGE_PATH) replaceEntry({ screen: route }, SCAN_PAGE_PATH);
      void this.showScanPage(false);
    } else {
      replaceEntry({ screen: 'landing' }, location.pathname === LANDING_PATH ? undefined : LANDING_PATH);
      void this.showLanding(false);
    }
    // Boot the decoder worker and warm the decoder (one synthetic decode) while the visitor reads the landing screen; a
    // boutique board never scans, and is never recorded: its arrival is not sent.
    if (route === 'board') return;
    // The arrival, once the first screen is drawn, in the recording's first batch (plan CUSTOMER INTELLIGENCE §3.4 A.9).
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    sendArrival(seen, arrival.arrival, {
      document: document as Document & { prerendering?: boolean },
      requestIdleCallback: w.requestIdleCallback ? (cb, opts) => w.requestIdleCallback!.call(window, cb, opts) : undefined,
      setTimeout: (cb, ms) => window.setTimeout(cb, ms),
    });
    const warm = () => void this.decoderClient()?.warm();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle.call(window, warm);
    else setTimeout(warm, 400);
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  /**
   * Leave the landing entry (once) so back returns to it; from MY PIECES or a certificate, the scan takes their entry,
   * at /verify (a certificate's token leaves the address bar with it).
   */
  private enter(): void {
    const entry = entryOf(history.state);
    // From a sheet (or a release's page), the scan takes its entry over the lookbook's (the list's): back then returns there.
    if (entry !== undefined && entry !== 'app' && REPLACEABLE.includes(entry)) replaceEntry({ screen: 'app' }, LANDING_PATH);
    else if (entry !== 'app') pushEntry({ screen: 'app' }, LANDING_PATH);
  }

  /**
   * NOW (the rail): the landing, the base entry. From an entry above it, back to it by as many entries as it lies above
   * the landing (its depth, whatever the way taken to it).
   */
  private openNow(): void {
    const depth = depthOf(history.state);
    if (depth <= 0) {
      if (this.screen !== 'landing') void this.showLanding();
      return;
    }
    history.go(-depth);
  }

  /**
   * MY PIECES, from the landing (an entry above it), from a result (in the scan's entry) or from another chapter of the
   * rail (in its entry): back returns to the landing.
   * From a piece (its crumb, the rail), back to the list under it; `order`, ORDER OR-… of a piece's page: ORDERS with that
   * order in view. `tab` opens on that tab (the rail's PIECES: PIECES); by default the one its entry kept.
   */
  private openPieces(opts: { tab?: PiecesTab; order?: string } = {}): void {
    // Desktop (decision 5): an order named (ORDER OR-… of a piece's page) opens its own page.
    if (opts.order && isDesktop()) {
      this.openOrder(opts.order);
      return;
    }
    const entry = entryOf(history.state);
    // (A piece opened over MESSAGES or an order's page has no list under it: MY PIECES over it.)
    if (entry === 'piece' && overOf(history.state) === null) {
      this.pendingOrder = opts.order ?? null;
      history.back();
      return;
    }
    const tab = opts.order ? 'orders' : (opts.tab ?? (entry === 'pieces' ? piecesTabOf(history.state) : 'pieces'));
    this.pendingOrder = opts.order ?? null;
    // The rail's chapters take each other's entry (as THE COLLECTION, THE RELEASES and THE CIRCLE do).
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') replaceEntry({ screen: 'pieces', tab }, PIECES_PATH);
    else pushEntry({ screen: 'pieces', tab }, PIECES_PATH);
    void this.showPieces();
  }

  /** MESSAGES' CONCERNING link (CS-01): the piece, the order on MY PIECES' ORDERS, the release or the model it concerned. */
  private openConcerning(target: ConcerningTarget): void {
    if (target.to === 'piece') this.openPiece(target.id);
    else if (target.to === 'order') this.openPieces({ order: orderReference(target.id) });
    // (On a computer, openPieces opens the order's own page.)
    else if (target.to === 'pieces') this.openPieces({ tab: 'orders' });
    else if (target.to === 'release') this.openRelease(target.id);
    else this.openSheet(target.slug);
  }

  /**
   * A piece of MY PIECES (C4), over MY PIECES' entry: back from it returns to the list. On a computer, from MESSAGES or an
   * order's page, over that page: back returns to it in one step.
   */
  private openPiece(id: string): void {
    const entry = entryOf(history.state);
    const address = piecePath(id);
    const under = pageUnder(entry);
    if (entry === 'piece') replaceEntry({ screen: 'piece', from: overOf(history.state) ?? undefined }, address);
    else if (under) pushEntry({ screen: 'piece', from: under }, address);
    else {
      if (entry !== 'pieces') {
        if (entry === 'app' || entry === 'certificate') replaceEntry({ screen: 'pieces' }, PIECES_PATH);
        else pushEntry({ screen: 'pieces' }, PIECES_PATH);
      }
      pushEntry({ screen: 'piece' }, address);
    }
    void this.showPiece(id);
  }

  /**
   * THE COLLECTION (P-R02), from the landing (an entry above it), from MY PIECES (in its entry), or from a sheet (the
   * lookbook is the entry under it: back to it).
   */
  private openLookbook(): void {
    const entry = entryOf(history.state);
    if (entry === 'sheet' && overOf(history.state) === null) {
      history.back();
      return;
    }
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') replaceEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
    else pushEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
    void this.showLookbook();
  }

  /**
   * THE RELEASES (P-R03), from the landing (an entry above it), from MY PIECES or the lookbook (in their entry), or
   * from a release's page (the list is the entry under it: back to it).
   */
  private openReleases(): void {
    const entry = entryOf(history.state);
    // HOW RELEASES WORK opened from the list: back to it; opened from a release's page, the list in its place.
    if ((entry === 'release' && overOf(history.state) === null) || (entry === 'how' && (history.state as { over?: unknown } | null)?.over === 'releases')) {
      history.back();
      return;
    }
    if (entry === 'how') {
      replaceEntry({ screen: 'releases' }, RELEASES_PATH);
      void this.showReleases();
      return;
    }
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') replaceEntry({ screen: 'releases' }, RELEASES_PATH);
    else pushEntry({ screen: 'releases' }, RELEASES_PATH);
    void this.showReleases();
  }

  /**
   * HOW RELEASES WORK (plan NEXT-NINE, FT-01), from THE RELEASES (over the list's entry) or from a release's page (over
   * its entry): back from it returns there. Its entry says which (`over`), so its ‹ THE RELEASES knows the list's place.
   */
  private openHow(): void {
    const entry = entryOf(history.state);
    if (entry === 'how') return;
    pushEntry({ screen: 'how', over: entry === 'releases' ? 'releases' : 'release' }, HOW_PATH);
    void this.showHow();
  }

  /**
   * THE CIRCLE (P-X01), from MY PIECES (in its entry, as the lookbook), or from a post (the feed is the entry under it:
   * back to it).
   */
  private openCircle(): void {
    const entry = entryOf(history.state);
    if (entry === 'circlePost') {
      history.back();
      return;
    }
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') replaceEntry({ screen: 'circle' }, CIRCLE_PATH);
    else pushEntry({ screen: 'circle' }, CIRCLE_PATH);
    void this.showCircle();
  }

  /**
   * THE CLUB (plan NEXT-NINE, BP-19 T9), from the footer or the account sheet: over the current entry, or in the place of
   * a chapter's (as the rail's chapters take each other's).
   */
  private openClub(): void {
    const entry = entryOf(history.state);
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle' || entry === 'club') replaceEntry({ screen: 'club' }, CLUB_PATH);
    else pushEntry({ screen: 'club' }, CLUB_PATH);
    void this.showClub();
  }

  /**
   * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2), from the account sheet's row: over the current entry, or in
   * the place of a chapter's, as THE CLUB.
   */
  private openWishlist(): void {
    const entry = entryOf(history.state);
    // Desktop: YOUR WISHLIST's card, over YOUR ACCOUNT (its crumb goes back there).
    if (entry === 'account') pushEntry({ screen: 'wishlist', under: 'account' }, wishlistPath());
    else if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle' || entry === 'club' || entry === 'wishlist') replaceEntry({ screen: 'wishlist' }, wishlistPath());
    else pushEntry({ screen: 'wishlist' }, wishlistPath());
    void this.showWishlist();
  }

  /** SIGN IN (the header, a heart, THE PRIVATE SALON, YOUR WISHLIST): on a computer its page (decision 6); MY PIECES' sign-in on a phone. */
  private signIn(): void {
    if (isDesktop()) this.openSignIn();
    else this.openPieces();
  }

  /**
   * ‹ YOUR ACCOUNT (YOUR WISHLIST's crumb, THE CLUB's line): the account sheet on a phone; on a computer YOUR ACCOUNT's
   * page, back to it when it is the page under.
   */
  private toAccount(trigger: HTMLElement): void {
    if (isDesktop()) this.openAccount();
    else this.shell?.sheet.open(trigger);
  }

  /**
   * YOUR ACCOUNT (desktop, decision 5): the header's account button and every ‹ YOUR ACCOUNT, over the page it
   * is opened from (back returns there); from a section of the account or YOUR WISHLIST over it, back to it.
   */
  private openAccount(): void {
    if (!isDesktop()) return;
    const entry = entryOf(history.state);
    if (entry === 'account' && accountRouteOf(location.pathname) === 'account') {
      void this.showAccount();
      return;
    }
    if ((entry === 'account' || entry === 'wishlist') && (history.state as { under?: unknown } | null)?.under === 'account') {
      history.back();
      return;
    }
    pushEntry({ screen: 'account', view: 'account' }, ACCOUNT_PATH);
    void this.showAccount();
  }

  /** A section of the account from outside it (NOW's READ, SEE MESSAGES: MESSAGES), over the page it is opened from. */
  private openAccountSection(view: AccountView): void {
    if (!isDesktop()) return;
    // MESSAGES is its own page in two parts (decision 5).
    if (view === 'messages') {
      this.openMessages();
      return;
    }
    if (entryOf(history.state) === 'account') {
      this.navigateAccount(view);
      void this.showAccount();
      return;
    }
    pushEntry({ screen: 'account', view }, accountPath(view));
    void this.showAccount();
  }

  /** The account's page moved by itself (a card, its crumb, SAVE): its address follows, back to the page under when it is that one. */
  private navigateAccount(view: AccountView): void {
    const st = history.state as { under?: unknown } | null;
    const current = entryOf(st) === 'account' ? (accountRouteOf(location.pathname) as AccountView | null) : null;
    if (current === view) return;
    if (current !== null && st?.under === view) {
      history.back();
      return;
    }
    pushEntry({ screen: 'account', view, under: current ?? undefined }, accountPath(view));
  }

  /**
   * The sign-in page (desktop, decision 6), on its form, with the sentence of the place it is opened from;
   * that place is kept as it stands and shown again once signed in (or on back). Already on it: its form.
   */
  private openSignIn(request: SignInRequest = {}, then?: SignInThen): void {
    if (!isDesktop()) {
      this.openPieces();
      return;
    }
    const tab: SignInTab = request.tab ?? 'signin';
    const lead = request.lead ?? DESKTOP.signIn.lead;
    if (this.screen === 'signIn' && entryOf(history.state) === 'signIn') {
      replaceEntry({ ...(history.state as object), tab });
      this.signInPage?.showTab(tab);
      return;
    }
    const root = this.host.firstElementChild as HTMLElement | null;
    this.signInFrom?.live?.dispose();
    this.signInFrom = root ? { root, live: this.live, screen: this.screen, path: location.pathname + location.search + location.hash, depth: depthOf(history.state) } : null;
    this.live = null;
    pushEntry({ screen: 'signIn', tab, lead, ...(then ? { then: then.screen, thenPath: then.path, thenContext: then.context ?? null } : {}) }, SIGN_IN_PATH);
    void this.showSignIn();
  }

  /**
   * MESSAGES (desktop, decision 5): every WRITE TO ORBES CLIENT SERVICES of a computer, on the subject of what
   * it attaches (`context`), and SEE MESSAGES, NOW's READ and the account's card on the newest subject; over the page it
   * is opened from (back returns there). Signed out, the sign-in page first, the place kept as it stands; once signed in,
   * this page on that subject in the sign-in page's place.
   */
  private openMessages(opts: { context?: WriteContext | null } = {}): void {
    if (!isDesktop()) return;
    const context = opts.context ?? null;
    const path = messagesPath(context ? subjectKey(context) : null);
    if (this.session.state.status === 'anonymous') {
      this.openSignIn({ lead: MESSAGES.signedOut }, { screen: 'messages', path, context });
      return;
    }
    if (entryOf(history.state) === 'messages') replaceEntry({ screen: 'messages', context }, path);
    else pushEntry({ screen: 'messages', context }, path);
    void this.showMessages();
  }

  /**
   * An order's page (desktop, decision 5): from MY PIECES' ORDERS over its entry (‹ MY PIECES goes back to it);
   * from anywhere else (a piece's ORDER OR-…, a message's SEE THE ORDER) over the page it is opened from.
   */
  private openOrder(reference: string): void {
    if (!isDesktop()) {
      this.openPieces({ order: reference });
      return;
    }
    const path = orderPagePath(reference);
    const entry = entryOf(history.state);
    if (entry === 'order') replaceEntry({ ...(history.state as object), screen: 'order' }, path);
    else if (entry === 'pieces') {
      replaceEntry({ ...(history.state as object), screen: 'pieces', tab: 'orders' });
      pushEntry({ screen: 'order', under: 'pieces' }, path);
    } else pushEntry({ screen: 'order' }, path);
    void this.showOrder();
  }

  /**
   * A page of a computer reached signed out (an address typed, a reload, a session ended): the sign-in page in its
   * entry's place, with its lead; signed in there, that page again in its place (MESSAGES with its subject's context).
   */
  private pageSignIn(screen: 'messages' | 'order', lead: string): void {
    if (!isDesktop() || entryOf(history.state) !== screen) return;
    const context = (history.state as { context?: unknown } | null)?.context;
    this.signInFrom?.live?.dispose();
    this.signInFrom = null;
    replaceEntry({ screen: 'signIn', tab: 'signin', lead, then: screen, thenPath: location.pathname, thenContext: isWriteContext(context) ? context : null }, SIGN_IN_PATH);
    void this.showSignIn();
  }

  /**
   * The SCAN page (desktop, BRIEF §5.4): SCAN in the top bar, and every SCAN of the app on a computer, which
   * opens no camera; over the current entry, or in the place of a chapter's, as THE CLUB.
   */
  private openScanPage(): void {
    const entry = entryOf(history.state);
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle' || entry === 'club' || entry === 'wishlist' || entry === 'scanPage') replaceEntry({ screen: 'scanPage' }, SCAN_PAGE_PATH);
    else pushEntry({ screen: 'scanPage' }, SCAN_PAGE_PATH);
    void this.showScanPage();
  }

  /** A post of the circle, over the feed's entry (from a post of the feed). Back from it returns to the feed. */
  private openCirclePost(id: string): void {
    const entry = entryOf(history.state);
    const address = circlePostPath(id);
    if (entry === 'circlePost') replaceEntry({ screen: 'circlePost' }, address);
    else {
      if (entry !== 'circle') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') replaceEntry({ screen: 'circle' }, CIRCLE_PATH);
        else pushEntry({ screen: 'circle' }, CIRCLE_PATH);
      }
      pushEntry({ screen: 'circlePost' }, address);
    }
    void this.showCirclePost(id);
  }

  /**
   * A release's page, over the list's entry: from the list (SEE THE RELEASE), or from MY PIECES (an entry's release: its
   * entry becomes the list's). Back from it returns to the list, never straight to the landing. On a computer, from
   * MESSAGES or an order's page, over that page: back returns to it in one step.
   */
  private openRelease(id: string): void {
    const entry = entryOf(history.state);
    const address = releasePath(id);
    const under = pageUnder(entry);
    if (entry === 'release') replaceEntry({ screen: 'release', from: overOf(history.state) ?? undefined }, address);
    else if (under) pushEntry({ screen: 'release', from: under }, address);
    else {
      if (entry !== 'releases') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') replaceEntry({ screen: 'releases' }, RELEASES_PATH);
        else pushEntry({ screen: 'releases' }, RELEASES_PATH);
      }
      pushEntry({ screen: 'release' }, address);
    }
    void this.showRelease(id);
  }

  /**
   * The after-room of a release (plan LIVE RELEASE+): from its release's page (the second door), over it, so back returns
   * to it; from MY PIECES (an after-room's entry), over the list and the release's page.
   */
  private openAfterRoom(parentId: string): void {
    if (entryOf(history.state) !== 'release' || releaseIdOf(location.pathname) !== parentId) this.openRelease(parentId);
    pushEntry({ screen: 'release' }, afterRoomPath(parentId));
    void this.showRelease(parentId, true, true);
  }

  /**
   * A model's sheet, over the lookbook's entry: from the lookbook (a card's SEE THE MODEL), or from a result (SEE THE
   * MODEL: the scan's entry becomes the lookbook's). Back from it returns to the lookbook, never straight to the landing.
   * On a computer, from MESSAGES (a model of THE PRIVATE SALON) or an order's page, over that page: back returns to it.
   */
  private openSheet(slug: string): void {
    const entry = entryOf(history.state);
    const address = lookbookSheetPath(slug);
    const under = pageUnder(entry);
    if (entry === 'sheet') replaceEntry({ screen: 'sheet', from: overOf(history.state) ?? undefined }, address);
    else if (under) pushEntry({ screen: 'sheet', from: under }, address);
    else {
      if (entry !== 'lookbook') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') replaceEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
        else pushEntry({ screen: 'lookbook' }, LOOKBOOK_PATH);
      }
      pushEntry({ screen: 'sheet' }, address);
    }
    void this.showSheet(slug);
  }

  /** `beforeShow`: told once the page left is gone and before the new one's screen is shown (a LIVE RELEASE's chrome). */
  private async swap(next: HTMLElement, screen: Screen, focus = true, beforeShow?: () => void): Promise<boolean> {
    const gen = this.generation;
    const old = this.host.firstElementChild as HTMLElement | null;
    // Desktop (BRIEF §5b, §10.13): on a computer a page changes at once, with no fade; the phone keeps its own.
    if (old && !prefersReducedMotion() && !isDesktop()) {
      old.classList.add('is-leaving');
      await sleep(LEAVE_MS);
      if (gen !== this.generation) return false;
    }
    this.live?.dispose();
    this.live = null;
    document.body.dataset.screen = screen;
    // HOW RELEASES WORK names the document; every other screen keeps the shell's own title.
    document.title = screen === 'how' ? HOW.documentTitle : this.shellTitle;
    beforeShow?.();
    this.shell?.show(screen);
    this.host.replaceChildren(next);
    this.screen = screen;
    // Desktop: the sign-in page left for a new entry over it (a menu or footer link): the place it was opened from is
    // never shown again by Back in one step, so it is let go (a LIVE RELEASE's stream and timers with it). A page that
    // takes the sign-in page's own entry (signed in: MESSAGES, an order's page) keeps it for Back.
    if (screen !== 'signIn' && this.signInFrom && depthOf(history.state) > this.signInFrom.depth + 1) {
      this.signInFrom.live?.dispose();
      this.signInFrom = null;
    }
    seen.screen(screen, this.seenState());
    // On NOW, the LIVE RELEASE the banner would name leads the page itself (C1): the banner is MY PIECES' PIECES tab's (C3).
    this.banner.show(screen === 'pieces' && this.piecesTab === 'pieces');
    window.scrollTo(0, 0);
    if (focus) focusFirst(next);
    return true;
  }

  /** What the recording reads beside the screen (seen-model.ts pageOf): the subject on show. */
  private seenState(): SeenAppState {
    return {
      piecesTab: this.piecesTab,
      pieceId: this.pieceId,
      sheetSlug: this.sheetSlug,
      releaseId: this.releaseId,
      releaseAfterRoom: this.releaseAfterRoom,
      liveRoom: this.liveRoom,
      postId: this.postId,
    };
  }

  /**
   * NOW (plan NOCTURNE, screen 1), the base entry at /verify: what leads (a LIVE RELEASE, a draw, the newest model), an
   * owner's pieces and next invitation, the collection, the scan.
   */
  private async showLanding(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = nowView({
      api: this.api,
      session: this.session,
      localZone: localZone(),
      onScan: () => void this.startScan(),
      onUpload: () => this.pickPhoto(),
      onPieces: () => this.openPieces(),
      onRelease: (id) => this.openRelease(id),
      onCollection: () => this.openLookbook(),
      onModel: (slug) => this.openSheet(slug),
      onCircle: () => this.openCircle(),
      onPost: (id) => this.openCirclePost(id),
      focus,
    });
    if (await this.swap(view.root, 'landing', focus)) this.live = view;
    else view.dispose();
  }

  /** MY PIECES (F-01): the signed-in owner's pieces, its orders and its releases, or the sign-in when signed out. */
  private async showPieces(focus = true, signInTab?: SignInTab): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.pieceId = null;
    const order = this.pendingOrder;
    this.pendingOrder = null;
    // The tab its place in the history kept: back from a piece, or from a release opened from RELEASES, returns to it.
    this.piecesTab = order ? 'orders' : entryOf(history.state) === 'pieces' ? piecesTabOf(history.state) : 'pieces';
    const view = piecesView({
      api: this.api,
      session: this.session,
      onScan: () => void this.startScan(),
      clientServices: () => this.contactDetails(),
      onRelease: (id) => this.openRelease(id),
      onAfterRoom: (parentId) => this.openAfterRoom(parentId),
      onPiece: (id) => this.openPiece(id),
      onOrder: (reference) => this.openOrder(reference),
      tab: this.piecesTab,
      order,
      onTab: (tab) => {
        this.piecesTab = tab;
        if (entryOf(history.state) === 'pieces') replaceEntry({ ...(history.state as object), tab });
        if (this.screen === 'pieces') {
          this.banner.show(tab === 'pieces');
          seen.screen('pieces', this.seenState());
        }
      },
      localZone: localZone(),
      signInTab,
    });
    // Desktop (BRIEF §10.11): on a computer the PIECES tab is shown once its banner is known (a short wait at
    // most), so the banner and the page are laid out together; the page never moves when the banner arrives.
    if (isDesktop() && this.piecesTab === 'pieces') {
      const gen = this.generation;
      await Promise.race([this.banner.decided(), sleep(BANNER_WAIT_MS)]);
      if (gen !== this.generation) {
        view.dispose();
        return;
      }
    }
    if (await this.swap(view.root, 'pieces', focus)) {
      this.live = view;
      view.shown();
    } else view.dispose();
  }

  /** A piece of MY PIECES (C4, C35); `id` null: an address that is none, MY PIECES in its place. */
  private async showPiece(id: string | null, focus = true): Promise<void> {
    if (id === null) {
      replaceEntry({ screen: 'pieces' }, PIECES_PATH);
      return this.showPieces(focus);
    }
    this.generation++;
    this.stopCamera();
    this.pieceId = id;
    const gen = this.generation;
    const view = pieceView({
      api: this.api,
      session: this.session,
      productId: id,
      clientServices: () => this.contactDetails(),
      onPieces: () => this.openPieces(),
      // Not the account's (passed on, or never its): MY PIECES in its place, at its address.
      onMissing: () => {
        if (gen !== this.generation) return;
        if (entryOf(history.state) === 'piece') replaceEntry({ screen: 'pieces' }, PIECES_PATH);
        void this.showPieces();
      },
      onRelease: (releaseId) => this.openRelease(releaseId),
      onOrder: (reference) => this.openPieces({ order: reference }),
      onModel: (slug) => this.openSheet(slug),
      onScan: () => void this.startScan(),
    });
    if (await this.swap(view.root, 'piece', focus)) this.live = view;
    else view.dispose();
  }

  /** THE CIRCLE (P-X01): the owners' feed, for a signed-in account that holds a piece; the sign-in otherwise. */
  private async showCircle(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.postId = null;
    const view = circleView({
      api: this.api,
      session: this.session,
      onScan: () => void this.startScan(),
      onPost: (id) => this.openCirclePost(id),
    });
    if (await this.swap(view.root, 'circle', focus)) this.live = view;
    else view.dispose();
  }

  /** A post of the circle (P-X01); `id` null: an address that is none, said as a post not in the circle. */
  private async showCirclePost(id: string | null, focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.postId = id;
    const view = circlePostView({
      api: this.api,
      session: this.session,
      id,
      onScan: () => void this.startScan(),
      onCircle: () => this.openCircle(),
      onRelease: (releaseId) => this.openRelease(releaseId),
      onModel: (slug) => this.openSheet(slug),
      offsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (await this.swap(view.root, 'circlePost', focus)) this.live = view;
    else view.dispose();
  }

  /** THE CLUB (plan NEXT-NINE, BP-19 T9): the tiers and what each gives, for everyone; signed in, the way to its own. */
  private async showClub(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = clubView({
      api: this.api,
      session: this.session,
      onAccount: (trigger) => this.toAccount(trigger),
      onPieces: () => this.openPieces(),
      onSignIn: () => this.signIn(),
    });
    if (await this.swap(view.root, 'club', focus)) this.live = view;
    else view.dispose();
  }

  /** YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2): the models the account marked with the heart. */
  private async showWishlist(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = wishlistView({
      api: this.api,
      session: this.session,
      onAccount: (trigger) => this.toAccount(trigger),
      onSheet: (slug) => this.openSheet(slug),
      onCollection: () => this.openLookbook(),
      onSignIn: () => this.signIn(),
    });
    if (await this.swap(view.root, 'wishlist', focus)) this.live = view;
    else view.dispose();
  }

  /** YOUR ACCOUNT or one of its sections (desktop, decision 5), as its address names it. */
  private async showAccount(focus = true): Promise<void> {
    const page = this.shell?.page;
    if (!page || !isDesktop()) {
      void this.showLanding(focus);
      return;
    }
    const named = accountRouteOf(location.pathname);
    const view: AccountView = named && named !== 'wishlist' ? named : 'account';
    // MESSAGES is its own page in two parts: an entry of the account's that names it shows that page.
    if (view === 'messages') {
      replaceEntry({ screen: 'messages' }, messagesPath(null));
      return this.showMessages(focus);
    }
    // Signed out: the sign-in page in its place, this page once signed in.
    if (this.session.state.status === 'anonymous') {
      this.accountSignIn(view);
      return;
    }
    const under = (history.state as { under?: AccountView } | null)?.under;
    if (this.screen === 'account' && page.root.isConnected) {
      page.arrive(view, under, focus);
      return;
    }
    this.generation++;
    this.stopCamera();
    // The page is the same element each time: shown again, it comes back from its way out (a screen left for another).
    page.root.classList.remove('is-leaving');
    page.arrive(view, under, focus);
    if (await this.swap(page.root, 'account', focus)) this.live = { dispose: () => page.left() };
  }

  /** The sign-in page (desktop, decision 6): its form and its sentence as its entry keeps them. */
  private async showSignIn(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const st = history.state as { lead?: unknown } | null;
    const view = signInPageView({
      api: this.api,
      session: this.session,
      tab: signInTabOf(history.state),
      lead: typeof st?.lead === 'string' ? st.lead : DESKTOP.signIn.lead,
      contact: async () => recoveryContactModel(await this.contactDetails(), '') ?? undefined,
      onTab: (tab) => {
        if (entryOf(history.state) === 'signIn') replaceEntry({ ...(history.state as object), tab });
      },
      // Signed in (or an account created): back to the place it was opened from (the landing for an address typed);
      // in the place of an account's page reached signed out, that page.
      onDone: () => {
        if (entryOf(history.state) !== 'signIn') return;
        const st = history.state as { then?: unknown; thenPath?: unknown; thenContext?: unknown } | null;
        const then = st?.then;
        if ((then === 'messages' || then === 'order') && typeof st?.thenPath === 'string') {
          // MESSAGES on its subject, or an order's page, in the sign-in page's place (the place it was opened from, if
          // kept, stays under it: back returns there as it stood).
          replaceEntry(then === 'messages' ? { screen: 'messages', context: isWriteContext(st.thenContext) ? st.thenContext : null } : { screen: 'order' }, st.thenPath);
          void (then === 'messages' ? this.showMessages() : this.showOrder());
        } else if (isAccountView(then)) {
          replaceEntry({ screen: 'account', view: then }, accountPath(then));
          void this.showAccount();
        } else history.back();
      },
    });
    this.signInPage = view;
    if (await this.swap(view.root, 'signIn', focus)) {
      this.live = {
        dispose: () => {
          view.dispose();
          if (this.signInPage === view) this.signInPage = null;
        },
      };
    } else view.dispose();
  }

  /** MESSAGES in two parts (desktop, decision 5), on the subject its address names; a phone: the sheet on MESSAGES. */
  private async showMessages(focus = true): Promise<void> {
    if (!isDesktop()) {
      replaceEntry({ screen: 'landing' }, LANDING_PATH);
      await this.showLanding(focus);
      if (this.screen === 'landing') this.shell?.openAccountSheet('messages');
      return;
    }
    this.generation++;
    this.stopCamera();
    const context = (history.state as { context?: unknown } | null)?.context;
    const view = messagesPageView({
      api: this.api,
      session: this.session,
      subject: messagesSubjectOf(location.pathname),
      context: isWriteContext(context) ? context : null,
      onSubject: (key, ctx) => {
        if (entryOf(history.state) === 'messages') replaceEntry({ ...(history.state as object), screen: 'messages', context: ctx }, messagesPath(key));
      },
      onAccount: () => this.openAccount(),
      onConcerning: (target) => this.openConcerning(target),
      onCancel: () => history.back(),
      onSignIn: () => this.pageSignIn('messages', MESSAGES.signedOut),
      onRead: () => undefined,
    });
    if (await this.swap(view.root, 'messages', focus)) this.live = view;
    else view.dispose();
  }

  /** An order's page (desktop, decision 5); a phone, or an address that names none: MY PIECES' ORDERS. */
  private async showOrder(focus = true): Promise<void> {
    const reference = orderReferenceOf(location.pathname);
    if (!isDesktop() || !reference) {
      this.pendingOrder = reference;
      replaceEntry({ screen: 'pieces', tab: 'orders' }, PIECES_PATH);
      return this.showPieces(focus);
    }
    this.generation++;
    this.stopCamera();
    const gen = this.generation;
    const view = orderPageView({
      api: this.api,
      session: this.session,
      reference,
      onPieces: () => {
        if ((history.state as { under?: unknown } | null)?.under === 'pieces') history.back();
        else this.openPieces({ tab: 'orders' });
      },
      // Not the account's (another account's address, or gone): MY PIECES' ORDERS in its place, at its address.
      onMissing: () => {
        if (gen !== this.generation) return;
        if (entryOf(history.state) === 'order') replaceEntry({ screen: 'pieces', tab: 'orders' }, PIECES_PATH);
        void this.showPieces();
      },
      onSignIn: () => this.pageSignIn('order', DESKTOP.signIn.lead),
    });
    if (await this.swap(view.root, 'order', focus)) this.live = view;
    else view.dispose();
  }

  /**
   * An account's page reached signed out on a computer (an address typed, back, a session ended): the sign-in page in
   * its entry's place (back leaves both), with the page's lead; signed in there, that account's page in its place.
   */
  private accountSignIn(view: AccountView): void {
    if (!isDesktop()) return;
    this.signInFrom?.live?.dispose();
    this.signInFrom = null;
    replaceEntry({ screen: 'signIn', tab: 'signin', lead: DESKTOP.signIn.lead, then: view }, SIGN_IN_PATH);
    void this.showSignIn();
  }

  /**
   * Desktop (§4: a window resized across the breakpoint never breaks): the sign-in page is a computer's; a
   * window narrowed past the desktop's width on it gives way to the phone's own sign-in, as the account's pages give
   * way to its sheet: the place it was opened from, as it stood (its sign-in drawn as a phone's, in its place), or,
   * reached by its address, MY PIECES' sign-in on the same form.
   */
  private signInToPhone(): void {
    if (entryOf(history.state) !== 'signIn') return;
    if (this.signInFrom) {
      history.back();
      return;
    }
    const tab = signInTabOf(history.state);
    replaceEntry({ screen: 'pieces' }, PIECES_PATH);
    void this.showPieces(true, tab);
  }

  /** The place the sign-in page was opened from, shown again as it stood. */
  private async restoreScreen(from: { root: HTMLElement; live: { dispose(): void } | null; screen: Screen }): Promise<void> {
    this.generation++;
    from.root.classList.remove('is-leaving');
    if (await this.swap(from.root, from.screen, true)) this.live = from.live;
    else from.live?.dispose();
  }

  /** The SCAN page of a computer (desktop): its QR code, UPLOAD A PHOTO. */
  private async showScanPage(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = scanPageView({ onUpload: () => this.pickPhoto() });
    if (await this.swap(view.root, 'scanPage', focus)) this.live = view;
    else view.dispose();
  }

  /** THE COLLECTION (P-R02): the lookbook of the models; an owner signed in also sees the reserved ones. */
  private async showLookbook(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.sheetSlug = null;
    const view = lookbookView({
      api: this.api,
      session: this.session,
      onScan: () => void this.startScan(),
      // THE PRIVATE SALON's teaser: SIGN IN, MY PIECES' sign-in (as the header's SIGN IN); the sign-in page on a computer.
      onSignIn: () => this.signIn(),
      onSheet: (slug) => this.openSheet(slug),
    });
    if (await this.swap(view.root, 'lookbook', focus)) this.live = view;
    else view.dispose();
  }

  /** A model's sheet (P-R02); `slug` null: an address that is none, said as a model not in the collection. */
  private async showSheet(slug: string | null, focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.sheetSlug = slug;
    const view = sheetView({
      api: this.api,
      session: this.session,
      slug,
      onCollection: () => this.openLookbook(),
      // The heart's SIGN IN, signed out (plan CUSTOMER INTELLIGENCE §3.2 W.10.1): MY PIECES' sign-in; its page on a computer.
      onSignIn: () => this.signIn(),
      // A dot chosen (N6): the sheet's address becomes that variant's, in the same history entry.
      onVariant: (variant) => {
        if (this.screen !== 'sheet' || entryOf(history.state) !== 'sheet') return;
        this.sheetSlug = variant;
        replaceEntry(history.state, lookbookSheetPath(variant));
        seen.show({ page: 'MODEL', subject: variant });
      },
      onRelease: (id) => this.openRelease(id),
      // BP-34: a card of PAIRS WELL WITH opens that model's sheet in this sheet's history entry (back: THE COLLECTION).
      onSheet: (slug) => this.openSheet(slug),
      localZone: localZone(),
      focus,
    });
    if (await this.swap(view.root, 'sheet', focus)) this.live = view;
    else view.dispose();
  }

  /** HOW RELEASES WORK (plan NEXT-NINE, FT-01): every release's rules, their figures read from the server. */
  private async showHow(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.releaseId = null;
    const view = howView({ api: this.api, onReleases: () => this.openReleases() });
    if (await this.swap(view.root, 'how', focus)) this.live = view;
    else view.dispose();
  }

  /** THE RELEASES (P-R03): the drops ORBES announces, each with its page. */
  private async showReleases(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.releaseId = null;
    const view = releasesView({
      api: this.api,
      session: this.session,
      // The tab its place in the history kept: back from a release opened from PAST returns to PAST.
      tab: entryOf(history.state) === 'releases' ? releasesTabOf(history.state) : 'live',
      onTab: (tab) => {
        if (entryOf(history.state) === 'releases') replaceEntry({ ...(history.state as object), tab });
      },
      onRelease: (id) => this.openRelease(id),
      onHow: () => this.openHow(),
      localZone: localZone(),
    });
    if (await this.swap(view.root, 'releases', focus)) this.live = view;
    else view.dispose();
  }

  /**
   * A release's page: a LIVE RELEASE's (its room, the vault) when the id is one, read first; else a draw's (P-R03), its
   * entry for a signed-in account, its draw. `id` null: an address that is none.
   */
  private async showRelease(id: string | null, focus = true, afterRoom = false): Promise<void> {
    const gen = ++this.generation;
    this.stopCamera();
    this.releaseId = id;
    this.releaseAfterRoom = afterRoom && id !== null;
    if (id !== null && afterRoom) {
      // The after-room, through its release: its guest only, from its T0. Signed out, anyone else, before its T0 or
      // without one: the release's own page (its sign-in, its second door when there is one), its address put back.
      let sheet: LiveSheet | LiveEndedSheet | null = null;
      let failure: string | null = null;
      try {
        sheet = await this.api.liveAfterRoom(id);
      } catch (e) {
        if (gen !== this.generation) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          replaceEntry({ screen: 'release' }, releasePath(id));
          return this.showRelease(id, focus);
        }
        failure = messageOf(e);
      }
      if (gen !== this.generation) return;
      return this.showLive(id, sheet, failure, focus, true);
    }
    if (id !== null) {
      // The LIVE page answers 404 for any other id, a draw's included. When it cannot be read now (a refusal of its own
      // rate group, an error), the draw's page is read: a draw's address shows its draw; when neither can be read, the
      // failure is said on the LIVE page (its TRY AGAIN reads both again).
      let sheet: LiveSheet | LiveEndedSheet | null = null;
      let failure: string | null = null;
      try {
        sheet = await this.api.liveRelease(id);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) {
          const draw = await this.api.drop(id).then(
            () => true,
            () => false,
          );
          if (!draw) failure = messageOf(e);
        }
      }
      if (gen !== this.generation) return;
      if (sheet || failure !== null) return this.showLive(id, sheet, failure, focus, false);
    }
    const view = releaseView({
      api: this.api,
      session: this.session,
      id,
      onScan: () => void this.startScan(),
      onReleases: () => this.openReleases(),
      onHow: () => this.openHow(),
      onModel: (slug) => this.openSheet(slug),
      offsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (await this.swap(view.root, 'release', focus)) this.live = view;
    else view.dispose();
  }

  /** A LIVE RELEASE's page (or its after-room's), as read; `failure` when it could not be. */
  private async showLive(id: string, sheet: LiveSheet | LiveEndedSheet | null, failure: string | null, focus: boolean, afterRoom: boolean): Promise<void> {
    let chrome: boolean | null = null;
    // Desktop (decision 7): whether the chrome is on screen, which an end page staged as the room hides on a
    // computer while it stays out of the room (`chrome`) for what the app records.
    let drawn: boolean | null = null;
    let mounted = false;
    const view = liveView({
      api: this.api,
      session: this.session,
      sound: this.sound,
      sheet,
      failure: failure ?? undefined,
      onRetry: () => void this.showRelease(id, true, afterRoom),
      onReleases: () => this.openReleases(),
      onPieces: () => this.openPieces(),
      onScan: () => void this.startScan(),
      onModel: (slug) => this.openSheet(slug),
      onAfterRoom: (parentId) => this.openAfterRoom(parentId),
      onHow: () => this.openHow(),
      onClub: () => this.openClub(),
      localZone: localZone(),
      // The chrome is the page's on screen: the one this page asks for is kept until it is mounted (the page left keeps
      // its own while it fades out, and keeps it should this one be given up), then followed while it is shown.
      onChrome: (shown, onScreen = shown) => {
        chrome = shown;
        drawn = onScreen;
        if (mounted && view.root.isConnected) {
          this.shell?.liveChrome(onScreen);
          // Into the room or out of it: the recording's LIVE, or the release's page.
          this.liveRoom = !shown;
          if (this.screen === 'live') seen.screen('live', this.seenState());
        }
      },
    });
    const beforeShow = (): void => {
      mounted = true;
      this.liveRoom = chrome === false;
      if (drawn !== null) this.shell?.liveChrome(drawn);
    };
    if (await this.swap(view.root, 'live', focus, beforeShow)) this.live = view;
    else view.dispose();
  }

  /**
   * A LIVE RELEASE's boutique board (plan of 2026-10-04, choice 31), by its secret link: the release from the path, the
   * secret from the fragment (THIS BOARD IS NOT AVAILABLE without one that answers).
   */
  private async showBoard(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const id = releasesRouteOf(location.pathname)?.release ?? '';
    const view = boardView({ api: this.api, id, token: boardTokenOf(location.hash) });
    if (await this.swap(view.root, 'board', focus)) this.live = view;
    else view.dispose();
  }

  /** An ownership certificate (F-06), from the token of the address's fragment: no session needed. */
  private async showCertificate(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.certificateToken = certificateTokenOf(location.hash);
    const view = certificateView({
      api: this.api,
      token: this.certificateToken,
      onScan: () => void this.startScan(),
      offsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (await this.swap(view.root, 'certificate', focus)) this.live = view;
    else view.dispose();
  }

  /** The address names a certificate (back, forward, an edited fragment): show it, unless it is the one on show. */
  private onCertificateAddress(): void {
    if (this.screen === 'certificate' && certificateTokenOf(location.hash) === this.certificateToken) return;
    if (entryOf(history.state) !== 'certificate') replaceEntry({ screen: 'certificate' }, `${CERTIFICATE_PATH}${location.hash}`);
    void this.showCertificate();
  }

  /**
   * An email's link (lot M1, step M1.19): what its fragment holds, kept in memory, the fragment taken out of the address
   * bar at once (it never stays in the history, nor reaches a bookmark). A page reloaded without it keeps the one read.
   */
  private takeMailLink(route: 'reset' | 'unsubscribe'): void {
    const hash = location.hash;
    if (hash.length > 1) {
      if (route === 'reset') this.resetLink = resetLinkOf(hash);
      else this.unsubscribeToken = unsubscribeTokenOf(hash);
    }
    if (hash) history.replaceState(history.state, '', route === 'reset' ? RESET_PATH : UNSUBSCRIBE_PATH);
  }

  /** An email's link opened again in this tab (only its fragment differs): its page, on its own entry. */
  private openMailLink(route: 'reset' | 'unsubscribe'): void {
    this.takeMailLink(route);
    if (entryOf(history.state) !== route) replaceEntry({ screen: route }, route === 'reset' ? RESET_PATH : UNSUBSCRIBE_PATH);
    void (route === 'reset' ? this.showReset() : this.showUnsubscribe());
  }

  /** SET A NEW PASSWORD (lot M1, E3): RESET BY EMAIL's link, its email and code read from the fragment. */
  private async showReset(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = resetView({
      api: this.api,
      session: this.session,
      link: this.resetLink,
      contact: async () => recoveryContactModel(await this.contactDetails(), '') ?? undefined,
      onSignedIn: () => {
        // Signed in with the new password: MY PIECES in this page's place (back does not return to the link).
        if (this.screen !== 'reset') return;
        this.resetLink = null;
        replaceEntry({ screen: 'pieces', tab: 'pieces' }, PIECES_PATH);
        void this.showPieces();
      },
    });
    if (await this.swap(view.root, 'reset', focus)) this.live = view;
    else view.dispose();
  }

  /** STOP THESE EMAILS (lot M1, E1, E2): an email's link, its token read from the fragment. */
  private async showUnsubscribe(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = unsubscribeView({ api: this.api, token: this.unsubscribeToken });
    if (await this.swap(view.root, 'unsubscribe', focus)) this.live = view;
    else view.dispose();
  }

  private showProblem(kind: ProblemKind): void {
    this.generation++;
    this.stopCamera();
    this.enter();
    const available = (a: ProblemAction) => (a === 'retry-verify' ? this.lastInput !== null : true);
    void this.swap(messageView(PROBLEMS[kind], (a) => this.onAction(a), { available }), 'message');
  }

  private onAction(a: ProblemAction): void {
    if (a === 'retry-scan') void this.startScan();
    else if (a === 'upload') this.pickPhoto();
    else if (a === 'retry-verify' && this.lastInput) void this.retryVerify(this.lastInput, this.lastCeremony);
    else this.goHome();
  }

  private goHome(): void {
    const entry = entryOf(history.state);
    if (entry !== undefined && REPLACEABLE.includes(entry)) history.back();
    else void this.showLanding();
  }

  // ── Camera path ──────────────────────────────────────────────────────────

  private decoderClient(): DecoderClient | null {
    if (!this.decoder) {
      try {
        this.decoder = new DecoderClient(workerUrl());
      } catch {
        this.decoder = null;
      }
    }
    return this.decoder;
  }

  /**
   * The scanner. `gesture`: called from a tap (SCAN ORBES CODE, SCAN AGAIN, TRY AGAIN…), which creates or resumes the
   * sound signature's AudioContext (P-D07) before anything is awaited; false when the scan resumes by itself (the page
   * back in view), where no tap allows it.
   */
  private async startScan(gesture = true): Promise<void> {
    // Desktop (BRIEF §5.4): a computer opens no camera; its SCAN is the page that sends to the phone.
    if (gesture && isDesktop()) return this.openScanPage();
    if (gesture) this.sound.prime();
    const gen = ++this.generation;
    this.stopCamera();
    const decoder = this.decoderClient();
    if (!decoder) return this.showProblem('decoder-failed');
    this.enter();
    this.zoomed = false;
    this.zoomLevel = null;

    const view = scanView({
      onClose: () => this.goHome(),
      onUpload: () => this.pickPhoto(),
      onTorch: () => void this.toggleTorch(),
      onZoom: () => void this.toggleZoom(),
    });
    if (!(await this.swap(view.root, 'scan'))) return;

    try {
      const caps = await this.camera.start(view.video);
      if (gen !== this.generation) return this.camera.stop();
      view.setTorch(caps.torch, false);
      // About 2× by default: small codes read from a distance the camera can focus at.
      const level = defaultZoomLevel(caps.zoom);
      this.zoomLevel = level;
      if (level !== null && caps.zoom) {
        this.zoomed = await this.camera.setZoom(level);
        if (gen !== this.generation) return this.camera.stop();
        view.setZoom(true, this.zoomed ? zoomLabel(caps.zoom.min) : zoomLabel(level), this.zoomed);
      } else {
        view.setZoom(false, '', false);
      }
    } catch (e) {
      if (gen === this.generation) this.showProblem(e instanceof CameraError ? e.kind : 'camera-failed');
      return;
    }

    let session: ScanSession;
    try {
      session = new ScanSession({ video: view.video, reticleSize: () => view.reticleSize(), zoomState: () => this.zoomState() }, decoder, {
        onDecoded: (reply, ms) => void this.onDecoded(gen, view, reply, ms),
        onHint: (hint) => view.setHint(hint ? HINTS[hint] : null),
        onSeal: (confidence) => gen === this.generation && view.setSeal(confidence),
        onTimeout: () => gen === this.generation && this.showProblem('scan-timeout'),
        onFatal: () => gen === this.generation && this.showProblem('decoder-failed'),
      });
    } catch {
      return this.showProblem('decoder-failed');
    }
    this.scan = { view, session };
    view.setReady(true);
    view.setStatus(STATUS.scanning);
    session.start();
  }

  private async onDecoded(gen: number, view: ScanView, reply: Extract<DecodeReply, { ok: true }>, decodeMs: number): Promise<void> {
    if (gen !== this.generation) return;
    navigator.vibrate?.(12);
    view.setLocked(true);
    view.setStatus(STATUS.found);
    this.camera.stop();
    if (!prefersReducedMotion()) await sleep(LOCK_PAUSE_MS);
    if (gen !== this.generation) return;
    view.setStatus(STATUS.verifying);
    await this.verify(buildVerifyInput(reply.decoded, 'camera', decodeMs), gen);
  }

  private stopCamera(): void {
    this.scan?.session.stop();
    this.scan = null;
    this.camera.stop();
  }

  private async toggleTorch(): Promise<void> {
    const on = !this.camera.torch;
    if (await this.camera.setTorch(on)) this.scan?.view.setTorch(true, on);
  }

  private zoomState(): ZoomState {
    if (this.zoomLevel === null) return 'none';
    return this.zoomed ? 'applied' : 'available';
  }

  /** The zoom control switches between the default level and the camera's widest view. */
  private async toggleZoom(): Promise<void> {
    const z = this.camera.capabilities().zoom;
    const level = this.zoomLevel;
    if (!z || level === null) return;
    const next = !this.zoomed;
    if (await this.camera.setZoom(next ? level : z.min)) {
      this.zoomed = next;
      this.scan?.view.setZoom(true, next ? zoomLabel(z.min) : zoomLabel(level), next);
    }
  }

  private onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      // Release the camera in the background (battery, privacy indicator); resume on return.
      // Only while the camera is live: a code already read keeps verifying in the background.
      if (this.screen === 'scan' && this.scan && this.camera.active) {
        this.generation++;
        this.stopCamera();
        this.resumeScan = true;
      }
    } else if (this.resumeScan) {
      this.resumeScan = false;
      if (this.screen === 'scan') void this.startScan(false);
    }
  }

  // ── Photo path ───────────────────────────────────────────────────────────

  private pickPhoto(): void {
    // Runs inside the user's click: required for the picker to open on iOS, and for the sound's AudioContext (P-D07).
    this.sound.prime();
    this.photoInput.click();
  }

  private async verifyPhoto(file: File): Promise<void> {
    const gen = ++this.generation;
    this.stopCamera();
    const decoder = this.decoderClient();
    if (!decoder) return this.showProblem('decoder-failed');
    this.enter();
    const view = verifyingView(STATUS.reading);
    if (!(await this.swap(view.root, 'verifying'))) return;
    let read: Awaited<ReturnType<typeof readPhoto>>;
    try {
      read = await readPhoto(file, decoder);
    } catch (e) {
      if (gen !== this.generation) return;
      return this.showProblem(e instanceof PhotoError ? e.kind : e instanceof DecoderUnavailableError ? 'decoder-failed' : 'upload-unreadable');
    }
    if (gen !== this.generation) return;
    view.setStatus(STATUS.verifying);
    await this.verify(buildVerifyInput(read.reply.decoded, 'upload', read.decodeMs), gen);
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /** Verify the same code again: TRY AGAIN, VERIFY AGAIN, VIEW AS OWNER (`ceremony`: right after a first registration, P-D01). */
  private async retryVerify(input: VerifyInput, ceremony = false): Promise<void> {
    const gen = ++this.generation;
    if (!(await this.swap(verifyingView(STATUS.verifying).root, 'verifying'))) return;
    await this.verify(input, gen, ceremony);
  }

  /**
   * How ORBES Client Services is reached, read in the collector app only for the email under FORGOTTEN PASSWORD? (plan
   * NEXT-NINE, CS-01: everywhere else, WRITE TO ORBES CLIENT SERVICES; the ORBES Care subscription is gone, plan ORBES
   * CARE, answer 1); never rejects
   * (`{}` when it cannot be read), and never makes a result wait more than CONTACT_WAIT_MS. A read that fails (it gives
   * up after CONTACT_TIMEOUT_MS) is tried again with the next result.
   */
  private contactDetails(): Promise<ClientServices> {
    this.clientServices ??= this.api.clientServices().catch(() => {
      this.clientServices = null;
      return {};
    });
    return settledWithin(this.clientServices, CONTACT_WAIT_MS, {});
  }

  private async verify(input: VerifyInput, gen: number, ceremony = false): Promise<void> {
    this.lastInput = input;
    this.lastCeremony = ceremony;
    const started = performance.now();
    try {
      // Read in parallel with the verification: the contact makes the result wait 1 s at most (CONTACT_WAIT_MS). The
      // time the outcome arrived, on this device's clock: the scan's windows are counted from it (resultViewModel).
      const [{ outcome, receivedAt }, clientServices] = await Promise.all([
        this.api.verify(input).then((o) => ({ outcome: o, receivedAt: Date.now() })),
        this.contactDetails(),
      ]);
      const rest = MIN_VERIFYING_MS - (performance.now() - started);
      if (rest > 0 && !prefersReducedMotion()) await sleep(rest);
      if (gen !== this.generation) return;
      this.lastInput = null;
      this.lastCeremony = false;
      this.stopCamera();
      const vm = resultViewModel(outcome, { offsetMinutes: -new Date().getTimezoneOffset(), clientServices, receivedAt, ceremony });
      const view = resultView(vm, {
        onScanAgain: () => void this.startScan(),
        onRefresh: (opts) => void this.retryVerify(input, opts?.ceremony === true),
        ownership: { api: this.api, session: this.session, onPieces: () => this.openPieces() },
        report: { api: this.api },
        onModel: (slug) => this.openSheet(slug),
      });
      if (await this.swap(view.root, 'result')) {
        this.live = view;
        view.shown();
        // P-D07: the chord, as an AUTHENTIC_* result appears (and for no other).
        this.sound.resultShown(vm.state);
      } else view.dispose();
    } catch (e) {
      if (gen === this.generation) this.showProblem(problemForApiError(e));
    }
  }
}

function boot(): void {
  try {
    new App().start();
  } catch {
    // The page shell itself is broken: say so plainly rather than show nothing.
    document.body.appendChild(h('p', { class: 'boot-error micro', text: 'ORBES AUTHENTICATION IS UNAVAILABLE. PLEASE RELOAD THE PAGE.' }));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
