/**
 * ORBES verification app (PLATFORM-CONTRACTS §4, spec §19–20).
 *
 *   landing ──SCAN──▶ scanner ──code read──▶ VERIFYING… ──▶ result
 *      ├──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ result
 *      └──MY PIECES──▶ the owner's pieces (/verify/pieces, F-01)
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
 *   anything else    the landing, its address put back to /verify.
 *
 * History: the landing screen is the base entry and every other screen shares
 * one entry above it, MY PIECES and the certificate included (with their own
 * URL), so the back button (or CLOSE) always returns to the landing screen and
 * releases the camera. Opened directly, MY PIECES or a certificate puts a
 * landing entry under itself, so back still leads to the landing rather than
 * out of the app; a reload keeps the entry it is on. A certificate's fragment
 * edited in place reads the certificate again.
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
import { resultViewModel } from './view-model.js';
import { certificateView } from './views/certificate.js';
import { CERTIFICATE_PATH, LANDING_PATH, PIECES_PATH } from './views/common.js';
import { landingView } from './views/landing.js';
import { messageView } from './views/message.js';
import { piecesView } from './views/pieces.js';
import { resultView } from './views/result.js';
import { scanView, type ScanView } from './views/scanning.js';
import { verifyingView } from './views/verifying.js';

type Screen = 'landing' | 'scan' | 'verifying' | 'result' | 'message' | 'pieces' | 'certificate';

/** What a history entry of the app holds: the landing, a screen of a scan, MY PIECES, or a certificate. */
type Entry = 'landing' | 'app' | 'pieces' | 'certificate';

/**
 * The route of a path under /verify: MY PIECES, a certificate, or the landing (also for a path the app does not know).
 * In any case: the certificate's PDF letters its address in capitals (the server redirects those to /verify/c).
 */
function routeOf(pathname: string): 'landing' | 'pieces' | 'certificate' {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === PIECES_PATH) return 'pieces';
  return path === CERTIFICATE_PATH ? 'certificate' : 'landing';
}

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

  start(): void {
    this.photoInput.addEventListener('change', () => {
      const file = this.photoInput.files?.[0];
      this.photoInput.value = '';
      if (file) void this.verifyPhoto(file);
    });
    window.addEventListener('popstate', (ev) => {
      // Back or forward onto MY PIECES or a certificate shows it again; onto the landing, or onto a scan's entry (its
      // screen is gone), the landing.
      const entry = entryOf(ev.state);
      const route = routeOf(location.pathname);
      if (entry === 'pieces' || route === 'pieces') {
        if (this.screen !== 'pieces') void this.showPieces();
      } else if (entry === 'certificate' || route === 'certificate') this.onCertificateAddress();
      else if (this.screen !== 'landing') this.showLanding();
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
    if (entry === 'pieces' || entry === 'certificate') history.replaceState({ screen: 'app' }, '', LANDING_PATH);
    else if (entry !== 'app') history.pushState({ screen: 'app' }, '', LANDING_PATH);
  }

  /** MY PIECES, from the landing (an entry above it) or from a result (in the scan's entry): back returns to the landing. */
  private openPieces(): void {
    const entry = entryOf(history.state);
    if (entry === 'app' || entry === 'pieces') history.replaceState({ screen: 'pieces' }, '', PIECES_PATH);
    else history.pushState({ screen: 'pieces' }, '', PIECES_PATH);
    void this.showPieces();
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
    const view = landingView({ onScan: () => void this.startScan(), onUpload: () => this.pickPhoto(), session: this.session, onPieces: () => this.openPieces() });
    void this.swap(view, 'landing', focus);
  }

  /** MY PIECES (F-01): the signed-in owner's pieces, or the sign-in when signed out. */
  private async showPieces(focus = true): Promise<void> {
    this.generation++;
    this.stopCamera();
    const view = piecesView({ api: this.api, session: this.session, onScan: () => void this.startScan(), clientServices: () => this.contactDetails() });
    if (await this.swap(view.root, 'pieces', focus)) this.live = view;
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
    if (entry === 'app' || entry === 'pieces' || entry === 'certificate') history.back();
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
