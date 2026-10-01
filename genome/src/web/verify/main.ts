/**
 * ORBES verification app (PLATFORM-CONTRACTS §4, spec §19–20).
 *
 *   landing ──SCAN──▶ scanner ──code read──▶ VERIFYING… ──▶ result
 *      └──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ result
 *   any step ──problem──▶ message (camera declined, no code, offline…)
 *
 * The page only reads the code; the server verifies it. Nothing secret lives
 * here: no keys, no thresholds. History: the landing screen is the base
 * entry and every other screen shares one entry above it, so the back button
 * (or CLOSE) always returns to the landing screen and releases the camera.
 */
import { viewportCorners } from '../shared/corners.js';
import { byId, focusFirst, h, prefersReducedMotion } from '../shared/dom.js';
import { ApiClient } from './api.js';
import { buildVerifyInput, defaultZoomLevel, zoomLabel, type ZoomState } from './capture.js';
import { HINTS, PROBLEMS, problemForApiError, STATUS, type ProblemAction, type ProblemKind } from './copy.js';
import type { DecodeReply } from './protocol.js';
import { Camera, CameraError, DecoderClient, DecoderUnavailableError, PhotoError, readPhoto, ScanSession, workerUrl } from './scanner.js';
import { SessionStore } from './session.js';
import type { VerifyInput } from './types.js';
import { resultViewModel } from './view-model.js';
import { landingView } from './views/landing.js';
import { messageView } from './views/message.js';
import { resultView, type ResultView } from './views/result.js';
import { scanView, type ScanView } from './views/scanning.js';
import { verifyingView } from './views/verifying.js';

type Screen = 'landing' | 'scan' | 'verifying' | 'result' | 'message';

/** Minimum time VERIFYING… stays visible, so a fast answer never reads as a flicker. */
const MIN_VERIFYING_MS = 650;
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
  private result: ResultView | null = null;
  private screen: Screen = 'landing';
  /** Bumped on every navigation; async work started under an older value is dropped. */
  private generation = 0;
  /** The last verify request, for TRY AGAIN after a connection problem. */
  private lastInput: VerifyInput | null = null;
  private zoomed = false;
  /** The default zoom level of the open camera (≈ 2×), null when it has no useful zoom. */
  private zoomLevel: number | null = null;
  private resumeScan = false;

  start(): void {
    this.photoInput.addEventListener('change', () => {
      const file = this.photoInput.files?.[0];
      this.photoInput.value = '';
      if (file) void this.verifyPhoto(file);
    });
    window.addEventListener('popstate', () => {
      if (this.screen !== 'landing') this.showLanding();
    });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.stopCamera());

    document.body.prepend(viewportCorners());
    history.replaceState({ screen: 'landing' }, '');
    this.showLanding(false);
    // Boot the decoder worker and warm the decoder (one synthetic decode) while the visitor reads the landing screen.
    const warm = () => void this.decoderClient()?.warm();
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle.call(window, warm);
    else setTimeout(warm, 400);
  }

  // ── Screens ──────────────────────────────────────────────────────────────

  /** Leave the landing entry (once) so back returns to it. */
  private enter(): void {
    if ((history.state as { screen?: string } | null)?.screen !== 'app') history.pushState({ screen: 'app' }, '');
  }

  private async swap(next: HTMLElement, screen: Screen, focus = true): Promise<boolean> {
    const gen = this.generation;
    const old = this.host.firstElementChild as HTMLElement | null;
    if (old && !prefersReducedMotion()) {
      old.classList.add('is-leaving');
      await sleep(LEAVE_MS);
      if (gen !== this.generation) return false;
    }
    this.result?.dispose();
    this.result = null;
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
    void this.swap(landingView({ onScan: () => void this.startScan(), onUpload: () => this.pickPhoto() }), 'landing', focus);
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
    if ((history.state as { screen?: string } | null)?.screen === 'app') history.back();
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

  private async verify(input: VerifyInput, gen: number): Promise<void> {
    this.lastInput = input;
    const started = performance.now();
    try {
      const outcome = await this.api.verify(input);
      const rest = MIN_VERIFYING_MS - (performance.now() - started);
      if (rest > 0 && !prefersReducedMotion()) await sleep(rest);
      if (gen !== this.generation) return;
      this.lastInput = null;
      this.stopCamera();
      const vm = resultViewModel(outcome, { offsetMinutes: -new Date().getTimezoneOffset() });
      const view = resultView(vm, {
        onScanAgain: () => void this.startScan(),
        onRefresh: () => void this.retryVerify(input),
        ownership: { api: this.api, session: this.session },
      });
      if (await this.swap(view.root, 'result')) this.result = view;
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
