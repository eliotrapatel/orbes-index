/**
 * The recording of what the collector looks at (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.9, step 3.8): the glue
 * between the page and seen-model.ts. One recorder for the app (`seen`), started by App.start (main.ts) with the app's
 * ApiClient; until then, and whenever it stays off, every call does nothing.
 *
 *   Off      when `navigator.webdriver` is true (automated browsers: our own captures and end-to-end tests included),
 *            and while the page is prerendered (it starts on `prerenderingchange`).
 *   Hooks    main.ts tells it each screen (`show`, from `swap()`, a variant's dot, MY PIECES' tab, a LIVE RELEASE's
 *            room opening or closing); the account sheet (views/account.ts) and the sign-in and create-account panel
 *            (views/ownership.ts) claim the screen while they cover it (`claim`, `release`).
 *   Events   the page hidden or closing (`visibilitychange`, `pagehide`): the views so far are sent at once; a touch, a
 *            key, a scroll or a pointer: the view counts again after IDLE_MS without any; a timer sends every
 *            30 s ± 10 s while views wait.
 *   Device   `d`, read once: standalone (`display-mode: standalone` or `navigator.standalone`), the touch points, the
 *            screen's short side in CSS pixels.
 *
 *   Arrival  the page load's arrival (arrival.ts, plan §3.4 A.9, step 4.7), handed over once (`arrive`) after the first
 *            screen is drawn: sent at once in the first batch, alone when no view has finished (never during a LIVE
 *            room but on a hide or a close); kept until the recorder starts (a prerendered page), never sent while off.
 *
 * Nothing is drawn, no word added, no storage written here (the arrival's one tab flag is arrival.ts's); the request is
 * same-origin (ApiClient.seen), and its failure is never shown.
 */
import type { ApiClient } from './api.js';
import { pageOf, SeenQueue, ViewClock, type SeenAppState, type SeenArrival, type SeenPageName, type SeenScreen, type SeenView } from './seen-model.js';

/** How often the recorder looks at the clock (the timer's send, the idle limit). */
const TICK_MS = 1_000;

/** The page's clock, in ms (monotonic within the page). */
const nowMs = (): number => performance.timeOrigin + performance.now();

export class SeenRecorder {
  private clock: ViewClock | null = null;
  private queue: SeenQueue | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The last screen told before the recorder started (a prerendered page that becomes visible). */
  private pending: SeenView | null = null;
  /** The page load's arrival handed over before the recorder started. */
  private pendingArrival: SeenArrival | null = null;

  /** Whether it records (tests). */
  get on(): boolean {
    return this.clock !== null;
  }

  /** Start recording for `api` (once; never in an automated browser; after the prerender). */
  start(api: Pick<ApiClient, 'seen'>): void {
    if (this.clock || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (navigator.webdriver === true) return;
    const doc = document as Document & { prerendering?: boolean };
    if (doc.prerendering === true) {
      document.addEventListener('prerenderingchange', () => this.start(api), { once: true });
      return;
    }
    const now = nowMs;
    const queue = new SeenQueue({ device: deviceOf(), send: (batch) => api.seen(batch), now });
    const clock = new ViewClock((v) => queue.push(v, now()), now());
    this.queue = queue;
    this.clock = clock;
    if (document.visibilityState === 'hidden') clock.visibility(false, now());
    if (this.pending) clock.show(this.pending, now());
    this.pending = null;
    if (this.pendingArrival) queue.arrive(this.pendingArrival, now());
    this.pendingArrival = null;
    const input = () => clock.input(now());
    for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(type, input, { capture: true, passive: true });
    window.addEventListener('scroll', input, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      const hidden = document.visibilityState === 'hidden';
      if (hidden) this.sendNow(now());
      clock.visibility(!hidden, now());
    });
    window.addEventListener('pagehide', () => this.sendNow(now()));
    this.timer = setInterval(() => {
      const t = now();
      clock.tick(t);
      void queue.tick(t, clock.front());
    }, TICK_MS);
  }

  /** The screen on show, its view from `pageOf` (null: never recorded). */
  screen(screen: SeenScreen, state: SeenAppState): void {
    this.show(pageOf(screen, state));
  }

  /** A view on show (a variant's dot: the model's sheet, the variant's slug). */
  show(view: SeenView | null): void {
    if (!this.clock) {
      this.pending = view;
      return;
    }
    this.clock.show(view, nowMs());
  }

  /** The page load's arrival (arrival.ts sendArrival): sent at once unless a LIVE room is in front; once per page load. */
  arrive(a: SeenArrival): void {
    if (!this.clock || !this.queue) {
      this.pendingArrival ??= a;
      return;
    }
    const now = nowMs();
    this.queue.arrive(a, now);
    void this.queue.tick(now, this.clock.front());
  }

  /** `owner` covers the screen with `page` while `live()` holds (null: it pauses the screen and records nothing). */
  claim(owner: object, page: SeenPageName | null, live: () => boolean): void {
    this.clock?.claim(owner, page, live, nowMs());
  }

  /** `owner` no longer covers the screen. */
  release(owner: object): void {
    this.clock?.release(owner, nowMs());
  }

  /** The page hidden or closing: every view so far, sent at once (keepalive). */
  private sendNow(now: number): void {
    if (!this.clock || !this.queue) return;
    this.clock.cut(now);
    void this.queue.flush(now);
  }
}

/** The device's own words: standalone, the touch points, the screen's short side. Never thrown. */
function deviceOf(): { s: boolean; t: number; w: number } {
  let s = false;
  try {
    s = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    s = false;
  }
  const t = Number(navigator.maxTouchPoints) || 0;
  const w = Math.min(Number(screen.width) || 0, Number(screen.height) || 0);
  return { s, t, w };
}

/** The app's one recorder. */
export const seen = new SeenRecorder();
