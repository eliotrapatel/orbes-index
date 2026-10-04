/**
 * ORBES verification app (PLATFORM-CONTRACTS §4, spec §19–20).
 *
 *   landing ──SCAN──▶ scanner ──code read──▶ VERIFYING… ──▶ result
 *      ├──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ result
 *      ├──MY PIECES──▶ the owner's pieces (/verify/pieces, F-01)
 *      ├──THE COLLECTION──▶ the lookbook (/verify/lookbook, P-R02) ──SEE THE MODEL──▶ a sheet
 *      └──THE RELEASES──▶ the releases (/verify/releases, P-R03) ──SEE THE RELEASE──▶ a release's page
 *   MY PIECES ──THE CIRCLE──▶ the owners' circle (/verify/circle, P-X01) ──SEE THE …──▶ a post
 *   result ──SEE THE MODEL──▶ its model's sheet (/verify/lookbook/<slug>), the lookbook under it
 *   a shared link ──▶ an ownership certificate (/verify/c#token, F-06)
 *   any step ──problem──▶ message (camera declined, no code, offline…)
 *
 * The page only reads the code; the server verifies it. Nothing secret lives
 * here: no keys, no thresholds.
 *
 * Paths (a small router; static.ts serves the shell at /verify and /verify/*):
 *   /verify          the landing, and every screen of a scan (one URL);
 *   /verify/pieces   MY PIECES, which a link, a reload or a bookmark opens directly;
 *   /verify/c#…      the ownership certificate of a link an owner shared: its token
 *                    is the fragment, which no request line or proxy log holds;
 *   /verify/lookbook          THE COLLECTION, the lookbook of the models (P-R02);
 *   /verify/lookbook/<slug>   a model's sheet (an address that is none: the lookbook);
 *   /verify/releases          THE RELEASES, the drops ORBES announces (P-R03);
 *   /verify/releases/<id>     a release's page, its entry and its draw (an address that is none: the list);
 *   /verify/circle            THE CIRCLE, the owners' feed (P-X01);
 *   /verify/circle/<id>       a post, its answer or its vote (an address that is none: the feed);
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
import { ApiClient, settledWithin } from './api.js';
import { buildVerifyInput, defaultZoomLevel, zoomLabel, type ZoomState } from './capture.js';
import { HINTS, PROBLEMS, problemForApiError, STATUS, type ProblemAction, type ProblemKind } from './copy.js';
import type { DecodeReply } from './protocol.js';
import { Camera, CameraError, DecoderClient, DecoderUnavailableError, PhotoError, readPhoto, ScanSession, workerUrl } from './scanner.js';
import { SessionStore } from './session.js';
import type { ClientServices, VerifyInput } from './types.js';
import { certificateTokenOf } from './certificate-model.js';
import { CIRCLE_PATH, circlePostPath, circleRouteOf } from './circle-model.js';
import { lookbookRouteOf, lookbookSheetPath } from './lookbook-model.js';
import { releasePath, releasesRouteOf, RELEASES_PATH } from './releases-model.js';
import { resultViewModel } from './view-model.js';
import { certificateView } from './views/certificate.js';
import { circlePostView, circleView } from './views/circle.js';
import { CERTIFICATE_PATH, LANDING_PATH, LOOKBOOK_PATH, PIECES_PATH } from './views/common.js';
import { landingView } from './views/landing.js';
import { lookbookView, sheetView } from './views/lookbook.js';
import { messageView } from './views/message.js';
import { piecesView } from './views/pieces.js';
import { releasesView, releaseView } from './views/releases.js';
import { resultView } from './views/result.js';
import { scanView, type ScanView } from './views/scanning.js';
import { verifyingView } from './views/verifying.js';

type Screen = 'landing' | 'scan' | 'verifying' | 'result' | 'message' | 'pieces' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'circle' | 'circlePost';

/**
 * What a history entry of the app holds: the landing, a screen of a scan, MY PIECES, a certificate, the lookbook or a
 * sheet, the releases or a release's page, the circle or a post.
 */
type Entry = 'landing' | 'app' | 'pieces' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'circle' | 'circlePost';

/** The entries above the landing that a scan, MY PIECES or a list takes the place of (their own address goes with them). */
const REPLACEABLE: readonly Entry[] = ['app', 'pieces', 'certificate', 'lookbook', 'sheet', 'releases', 'release', 'circle', 'circlePost'];

/**
 * The route of a path under /verify: MY PIECES, a certificate, the lookbook, a model's sheet, the releases, a
 * release's page, the circle, a post, or the landing (also for a path the app does not know). In any case: the
 * certificate's PDF letters its address in capitals (the server redirects those to /verify/c).
 */
function routeOf(pathname: string): 'landing' | 'pieces' | 'certificate' | 'lookbook' | 'sheet' | 'releases' | 'release' | 'circle' | 'circlePost' {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === PIECES_PATH) return 'pieces';
  const lookbook = lookbookRouteOf(path);
  if (lookbook) return lookbook.sheet ? 'sheet' : 'lookbook';
  const releases = releasesRouteOf(path);
  if (releases) return releases.release ? 'release' : 'releases';
  const circle = circleRouteOf(path);
  if (circle) return circle.post ? 'circlePost' : 'circle';
  return path === CERTIFICATE_PATH ? 'certificate' : 'landing';
}

/** The address of the sheet a path names, or null. */
const sheetSlugOf = (pathname: string): string | null => lookbookRouteOf(pathname)?.sheet ?? null;

/** The id of the release a path names, or null. */
const releaseIdOf = (pathname: string): string | null => releasesRouteOf(pathname)?.release ?? null;

/** The id of the post a path names, or null. */
const postIdOf = (pathname: string): string | null => circleRouteOf(pathname)?.post ?? null;

const entryOf = (state: unknown): Entry | undefined => (state as { screen?: Entry } | null)?.screen;

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class App {
  private readonly host = byId('app');
  private readonly photoInput = byId<HTMLInputElement>('photo-input');
  private readonly api = new ApiClient();
  private readonly session = new SessionStore(this.api);
  private readonly camera = new Camera();
  private decoder: DecoderClient | null = null;
  private scan: { view: ScanView; session: ScanSession } | null = null;
  /** The screen on show that holds listeners (a result, MY PIECES): released when another takes its place. */
  private live: { dispose(): void } | null = null;
  private screen: Screen = 'landing';
  /** Bumped on every navigation; async work started under an older value is dropped. */
  private generation = 0;
  /** The last verify request, for TRY AGAIN after a connection problem. */
  private lastInput: VerifyInput | null = null;
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
  /** The id of the post on show (P-X01), to tell another post from the same one. */
  private postId: string | null = null;

  start(): void {
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
      if (entry === 'pieces' || route === 'pieces') {
        if (this.screen !== 'pieces') void this.showPieces();
      } else if (entry === 'certificate' || route === 'certificate') this.onCertificateAddress();
      else if (entry === 'sheet' || route === 'sheet') {
        const slug = sheetSlugOf(location.pathname);
        if (!(this.screen === 'sheet' && this.sheetSlug === slug)) void this.showSheet(slug);
      } else if (entry === 'lookbook' || route === 'lookbook') {
        if (this.screen !== 'lookbook') void this.showLookbook();
      } else if (entry === 'release' || route === 'release') {
        const id = releaseIdOf(location.pathname);
        if (!(this.screen === 'release' && this.releaseId === id)) void this.showRelease(id);
      } else if (entry === 'releases' || route === 'releases') {
        if (this.screen !== 'releases') void this.showReleases();
      } else if (entry === 'circlePost' || route === 'circlePost') {
        const id = postIdOf(location.pathname);
        if (!(this.screen === 'circlePost' && this.postId === id)) void this.showCirclePost(id);
      } else if (entry === 'circle' || route === 'circle') {
        if (this.screen !== 'circle') void this.showCircle();
      } else if (this.screen !== 'landing') this.showLanding();
    });
    // A certificate's fragment changed in place (pasted, edited): the certificate of the new one.
    window.addEventListener('hashchange', () => {
      if (routeOf(location.pathname) === 'certificate') this.onCertificateAddress();
    });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.stopCamera());

    document.body.prepend(viewportCorners());
    const route = routeOf(location.pathname);
    if (route === 'pieces') {
      // A reload keeps its entry; a direct visit (a link, a bookmark) puts the landing under MY PIECES.
      if (entryOf(history.state) !== 'pieces') {
        history.replaceState({ screen: 'landing' }, '', LANDING_PATH);
        history.pushState({ screen: 'pieces' }, '', PIECES_PATH);
      }
      void this.showPieces(false);
    } else if (route === 'certificate') {
      // The same for a certificate, its fragment kept in its own address (the landing's has none).
      if (entryOf(history.state) !== 'certificate') {
        const address = `${CERTIFICATE_PATH}${location.hash}`;
        history.replaceState({ screen: 'landing' }, '', LANDING_PATH);
        history.pushState({ screen: 'certificate' }, '', address);
      }
      void this.showCertificate(false);
    } else if (route === 'lookbook' || route === 'sheet') {
      // The lookbook (P-R02) over the landing; a sheet over both, so back from it returns to the lookbook. An address
      // under /verify/lookbook that is none shows the lookbook, its own address put back.
      const slug = sheetSlugOf(location.pathname);
      if (entryOf(history.state) !== (slug ? 'sheet' : 'lookbook')) {
        history.replaceState({ screen: 'landing' }, '', LANDING_PATH);
        history.pushState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
        if (slug) history.pushState({ screen: 'sheet' }, '', lookbookSheetPath(slug));
      } else if (!slug && location.pathname !== LOOKBOOK_PATH) history.replaceState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
      if (slug) void this.showSheet(slug, false);
      else void this.showLookbook(false);
    } else if (route === 'releases' || route === 'release') {
      // The releases (P-R03) over the landing; a release's page over both, so back from it returns to the list. An
      // address under /verify/releases that is none shows the list, its own address put back.
      const id = releaseIdOf(location.pathname);
      if (entryOf(history.state) !== (id ? 'release' : 'releases')) {
        history.replaceState({ screen: 'landing' }, '', LANDING_PATH);
        history.pushState({ screen: 'releases' }, '', RELEASES_PATH);
        if (id) history.pushState({ screen: 'release' }, '', releasePath(id));
      } else if (!id && location.pathname !== RELEASES_PATH) history.replaceState({ screen: 'releases' }, '', RELEASES_PATH);
      if (id) void this.showRelease(id, false);
      else void this.showReleases(false);
    } else if (route === 'circle' || route === 'circlePost') {
      // The circle (P-X01) over the landing; a post over both, so back from it returns to the feed. An address under
      // /verify/circle that is none shows the feed, its own address put back.
      const id = postIdOf(location.pathname);
      if (entryOf(history.state) !== (id ? 'circlePost' : 'circle')) {
        history.replaceState({ screen: 'landing' }, '', LANDING_PATH);
        history.pushState({ screen: 'circle' }, '', CIRCLE_PATH);
        if (id) history.pushState({ screen: 'circlePost' }, '', circlePostPath(id));
      } else if (!id && location.pathname !== CIRCLE_PATH) history.replaceState({ screen: 'circle' }, '', CIRCLE_PATH);
      if (id) void this.showCirclePost(id, false);
      else void this.showCircle(false);
    } else {
      history.replaceState({ screen: 'landing' }, '', location.pathname === LANDING_PATH ? undefined : LANDING_PATH);
      this.showLanding(false);
    }
    // Boot the decoder worker and warm the decoder (one synthetic decode) while the visitor reads the landing screen.
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
    if (entry !== undefined && entry !== 'app' && REPLACEABLE.includes(entry)) history.replaceState({ screen: 'app' }, '', LANDING_PATH);
    else if (entry !== 'app') history.pushState({ screen: 'app' }, '', LANDING_PATH);
  }

  /** MY PIECES, from the landing (an entry above it) or from a result (in the scan's entry): back returns to the landing. */
  private openPieces(): void {
    const entry = entryOf(history.state);
    if (entry === 'app' || entry === 'pieces') history.replaceState({ screen: 'pieces' }, '', PIECES_PATH);
    else history.pushState({ screen: 'pieces' }, '', PIECES_PATH);
    void this.showPieces();
  }

  /**
   * THE COLLECTION (P-R02), from the landing (an entry above it), from MY PIECES (in its entry), or from a sheet (the
   * lookbook is the entry under it: back to it).
   */
  private openLookbook(): void {
    const entry = entryOf(history.state);
    if (entry === 'sheet') {
      history.back();
      return;
    }
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') history.replaceState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
    else history.pushState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
    void this.showLookbook();
  }

  /**
   * THE RELEASES (P-R03), from the landing (an entry above it), from MY PIECES or the lookbook (in their entry), or
   * from a release's page (the list is the entry under it: back to it).
   */
  private openReleases(): void {
    const entry = entryOf(history.state);
    if (entry === 'release') {
      history.back();
      return;
    }
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') history.replaceState({ screen: 'releases' }, '', RELEASES_PATH);
    else history.pushState({ screen: 'releases' }, '', RELEASES_PATH);
    void this.showReleases();
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
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate' || entry === 'lookbook' || entry === 'releases' || entry === 'circle') history.replaceState({ screen: 'circle' }, '', CIRCLE_PATH);
    else history.pushState({ screen: 'circle' }, '', CIRCLE_PATH);
    void this.showCircle();
  }

  /** A post of the circle, over the feed's entry (from a post of the feed). Back from it returns to the feed. */
  private openCirclePost(id: string): void {
    const entry = entryOf(history.state);
    const address = circlePostPath(id);
    if (entry === 'circlePost') history.replaceState({ screen: 'circlePost' }, '', address);
    else {
      if (entry !== 'circle') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') history.replaceState({ screen: 'circle' }, '', CIRCLE_PATH);
        else history.pushState({ screen: 'circle' }, '', CIRCLE_PATH);
      }
      history.pushState({ screen: 'circlePost' }, '', address);
    }
    void this.showCirclePost(id);
  }

  /**
   * A release's page, over the list's entry: from the list (SEE THE RELEASE), or from MY PIECES (an entry's release: its
   * entry becomes the list's). Back from it returns to the list, never straight to the landing.
   */
  private openRelease(id: string): void {
    const entry = entryOf(history.state);
    const address = releasePath(id);
    if (entry === 'release') history.replaceState({ screen: 'release' }, '', address);
    else {
      if (entry !== 'releases') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') history.replaceState({ screen: 'releases' }, '', RELEASES_PATH);
        else history.pushState({ screen: 'releases' }, '', RELEASES_PATH);
      }
      history.pushState({ screen: 'release' }, '', address);
    }
    void this.showRelease(id);
  }

  /**
   * A model's sheet, over the lookbook's entry: from the lookbook (a card's SEE THE MODEL), or from a result (SEE THE
   * MODEL: the scan's entry becomes the lookbook's). Back from it returns to the lookbook, never straight to the landing.
   */
  private openSheet(slug: string): void {
    const entry = entryOf(history.state);
    const address = lookbookSheetPath(slug);
    if (entry === 'sheet') history.replaceState({ screen: 'sheet' }, '', address);
    else {
      if (entry !== 'lookbook') {
        if (entry === 'app' || entry === 'pieces' || entry === 'certificate') history.replaceState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
        else history.pushState({ screen: 'lookbook' }, '', LOOKBOOK_PATH);
      }
      history.pushState({ screen: 'sheet' }, '', address);
    }
    void this.showSheet(slug);
  }

  private async swap(next: HTMLElement, screen: Screen, focus = true): Promise<boolean> {
    const gen = this.generation;
    const old = this.host.firstElementChild as HTMLElement | null;
    if (old && !prefersReducedMotion()) {
      old.classList.add('is-leaving');
      await sleep(LEAVE_MS);
      if (gen !== this.generation) return false;
    }
    this.live?.dispose();
    this.live = null;
    document.body.dataset.screen = screen;
    this.host.replaceChildren(next);
    this.screen = screen;
    window.scrollTo(0, 0);
    if (focus) focusFirst(next);
    return true;
  }

  private showLanding(focus = true): void {
    this.generation++;
    this.stopCamera();
    const view = landingView({
      onScan: () => void this.startScan(),
      onUpload: () => this.pickPhoto(),
      session: this.session,
      onPieces: () => this.openPieces(),
      onCollection: () => this.openLookbook(),
      onReleases: () => this.openReleases(),
    });
    void this.swap(view, 'landing', focus);
  }

  /** MY PIECES (F-01): the signed-in owner's pieces, or the sign-in when signed out. */
  private async showPieces(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = piecesView({
      api: this.api,
      session: this.session,
      onScan: () => void this.startScan(),
      clientServices: () => this.contactDetails(),
      onCollection: () => this.openLookbook(),
      onReleases: () => this.openReleases(),
      onRelease: (id) => this.openRelease(id),
      onCircle: () => this.openCircle(),
    });
    if (await this.swap(view.root, 'pieces', focus)) this.live = view;
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
      onReleases: () => this.openReleases(),
      onCollection: () => this.openLookbook(),
      onPieces: () => this.openPieces(),
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

  /** THE COLLECTION (P-R02): the lookbook of the models; an owner signed in also sees the reserved ones. */
  private async showLookbook(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.sheetSlug = null;
    const view = lookbookView({ api: this.api, session: this.session, onScan: () => void this.startScan(), onSheet: (slug) => this.openSheet(slug) });
    if (await this.swap(view.root, 'lookbook', focus)) this.live = view;
    else view.dispose();
  }

  /** A model's sheet (P-R02); `slug` null: an address that is none, said as a model not in the collection. */
  private async showSheet(slug: string | null, focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.sheetSlug = slug;
    const view = sheetView({ api: this.api, session: this.session, slug, onCollection: () => this.openLookbook() });
    if (await this.swap(view.root, 'sheet', focus)) this.live = view;
    else view.dispose();
  }

  /** THE RELEASES (P-R03): the drops ORBES announces, each with its page. */
  private async showReleases(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.releaseId = null;
    const view = releasesView({ api: this.api, onScan: () => void this.startScan(), onRelease: (id) => this.openRelease(id), onCollection: () => this.openLookbook() });
    if (await this.swap(view.root, 'releases', focus)) this.live = view;
    else view.dispose();
  }

  /** A release's page (P-R03): its entry for a signed-in account, its draw; `id` null: an address that is none. */
  private async showRelease(id: string | null, focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    this.releaseId = id;
    const view = releaseView({
      api: this.api,
      session: this.session,
      id,
      onScan: () => void this.startScan(),
      onReleases: () => this.openReleases(),
      onModel: (slug) => this.openSheet(slug),
      clientServices: () => this.contactDetails(),
      offsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (await this.swap(view.root, 'release', focus)) this.live = view;
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
    if (entryOf(history.state) !== 'certificate') history.replaceState({ screen: 'certificate' }, '', `${CERTIFICATE_PATH}${location.hash}`);
    void this.showCertificate();
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
    else if (a === 'retry-verify' && this.lastInput) void this.retryVerify(this.lastInput);
    else this.goHome();
  }

  private goHome(): void {
    const entry = entryOf(history.state);
    if (entry !== undefined && REPLACEABLE.includes(entry)) history.back();
    else this.showLanding();
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

  private async startScan(): Promise<void> {
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
      if (this.screen === 'scan') void this.startScan();
    }
  }

  // ── Photo path ───────────────────────────────────────────────────────────

  private pickPhoto(): void {
    // Runs inside the user's click: required for the picker to open on iOS.
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

  private async retryVerify(input: VerifyInput): Promise<void> {
    const gen = ++this.generation;
    if (!(await this.swap(verifyingView(STATUS.verifying).root, 'verifying'))) return;
    await this.verify(input, gen);
  }

  /**
   * How ORBES Client Services is reached; never rejects (`{}`, so no contact, when it cannot be
   * read), and never makes a result wait more than CONTACT_WAIT_MS. A read that fails (it gives
   * up after CONTACT_TIMEOUT_MS) is tried again with the next result.
   */
  private contactDetails(): Promise<ClientServices> {
    this.clientServices ??= this.api.clientServices().catch(() => {
      this.clientServices = null;
      return {};
    });
    return settledWithin(this.clientServices, CONTACT_WAIT_MS, {});
  }

  private async verify(input: VerifyInput, gen: number): Promise<void> {
    this.lastInput = input;
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
      this.stopCamera();
      const vm = resultViewModel(outcome, { offsetMinutes: -new Date().getTimezoneOffset(), clientServices, receivedAt });
      const view = resultView(vm, {
        onScanAgain: () => void this.startScan(),
        onRefresh: () => void this.retryVerify(input),
        ownership: { api: this.api, session: this.session, onPieces: () => this.openPieces() },
        report: { api: this.api },
        onModel: (slug) => this.openSheet(slug),
      });
      if (await this.swap(view.root, 'result')) this.live = view;
      else view.dispose();
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
