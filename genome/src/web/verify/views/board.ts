/**
 * The boutique board of a LIVE RELEASE (plan of 2026-10-04, The experience 11, choice 31): /verify/releases/<id>/board#
 * <secret>, a full-screen display for a screen in a boutique or at an event, landscape, in the vault.
 *
 *   ORBES                                                              ● LIVE
 *   ┌──────────────────────────┐   LIVE RELEASE · THE ROOM IS OPEN · LIVE NOW
 *   │  the door, its lock the  │   MONOLITHE (or TO BE REVEALED)
 *   │  seal; at T0 it opens on │   25 PIECES
 *   │  the piece, lit          │   OPENS IN  02 : 14 : 09    (before T0)
 *   └──────────────────────────┘   16  OF 25 LEFT  ▮▮▮▮▯▯▯…   (the pieces left overall)
 *                                  SUNDAY 11 OCTOBER · 19:00 PARIS
 *                                                                   FULL SCREEN
 *
 * Reachable only by its secret link, which the console issues and revokes (a public live view of the room was
 * declined): the secret travels from the fragment in a POST body, never in an address; the page is never indexed (the
 * server's X-Robots-Tag, and its own robots meta). Without its secret, with a wrong, replaced or revoked one, or for a
 * release not announced: THIS BOARD IS NOT AVAILABLE. No person, no count of the room, no host message, no size: the
 * server sends a board none of them.
 *
 * Real time: its stream (a POST read as Server-Sent Events) while it runs; the board read every LIVE_POLL_MS while it
 * cannot, the stream tried again later. Every countdown counts on the server's clock (three round trips). The lock's
 * orbits turn back into alignment during the last minute; at T0 the lock aligns and the door opens on the piece. No
 * sound: no one at a boutique's screen asked for one. Reduced motion: the door fades, no orbit turns, no sweep.
 */
import { bracket } from '../../shared/corners.js';
import { h, prefersReducedMotion } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { boardModel, boardOf, SseParser, type BoardModel } from '../board-model.js';
import { LIVE } from '../copy.js';
import { lockAngle, measureClock, type LivePicture } from '../live-model.js';
import { sealSvg, turnRings } from '../live-seal.js';
import type { LiveBoard } from '../types.js';
import { viewRoot, withNumerals } from './common.js';
import { LIVE_POLL_MS, LIVE_STREAM_RETRY_MS } from './live.js';

/** The board's own pulse: its countdown and the lock. */
const PULSE_MS = 250;
/** The lock clicks into alignment, then the door opens. */
const DOOR_DELAY_MS = 420;

export interface BoardDeps {
  api: ApiClient;
  /** The release, from the address. */
  id: string;
  /** The link's secret, from the fragment; null when it holds none. */
  token: string | null;
}

export interface BoardView {
  root: HTMLElement;
  dispose(): void;
}

export function boardView(deps: BoardDeps): BoardView {
  const page = new BoardPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

type State = 'loading' | 'shown' | 'unavailable';

class BoardPage {
  readonly root: HTMLElement;
  private readonly status = h('p', { class: 'board__status' }, h('span', { class: 'live__dot board__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'board__status-text' }));
  private readonly body = h('div', { class: 'board__body' });
  private readonly full: HTMLButtonElement;
  private board: LiveBoard | null = null;
  private offset: number | null = null;
  private state: State = 'loading';
  private connection: 'live' | 'reconnecting' = 'reconnecting';
  private abort: AbortController | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private view: { el: HTMLElement; update(m: BoardModel): void; picture: string } | null = null;
  /** The pulse runs: the first look is done, the stream asked for. */
  private started = false;
  private robots: HTMLMetaElement | null = null;
  private disposed = false;

  constructor(private readonly deps: BoardDeps) {
    this.root = viewRoot('board', 'board-title');
    this.root.classList.add('vault');
    this.full = h('button', { class: 'textlink board__full', attrs: { type: 'button' }, on: { click: () => void this.fullScreen() }, text: LIVE.board.fullScreen });
    this.root.append(
      h('header', { class: 'board__head' }, h('span', { class: 'wordmark wordmark--small board__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }), this.status),
      this.body,
      h('footer', { class: 'board__foot' }, this.full),
    );
    // Never indexed nor followed (the server says so too, X-Robots-Tag): the board is reachable by its secret link only.
    if (!document.head.querySelector('meta[name="robots"]')) {
      this.robots = h('meta', { attrs: { name: 'robots', content: 'noindex, nofollow' } });
      document.head.append(this.robots);
    }
    document.addEventListener('fullscreenchange', this.onFullScreen);
    this.onFullScreen();
    this.render();
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.stopStream();
    this.stopPolling();
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.robots?.remove();
    document.removeEventListener('fullscreenchange', this.onFullScreen);
  }

  private now(): number {
    return Date.now() + (this.offset ?? 0);
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  private async start(): Promise<void> {
    if (!this.deps.token) {
      this.state = 'unavailable';
      this.render();
      return;
    }
    const [read] = await Promise.all([this.read(), this.sync()]);
    if (this.disposed || !read) return;
    this.started = true;
    this.pulseTimer = setInterval(() => this.tick(), PULSE_MS);
    void this.follow();
  }

  /** The server's clock: three round trips, tried again later when they fail. */
  private async sync(): Promise<void> {
    const best = await measureClock(() => this.deps.api.liveClock());
    if (this.disposed) return;
    if (best) this.offset = best.offset;
    else setTimeout(() => void this.sync(), 10_000);
  }

  /** The board once (the page's first look, and the polling): whether it is still on show. */
  private async read(): Promise<boolean> {
    try {
      const board = await this.deps.api.liveBoard(this.deps.id, this.deps.token!);
      if (this.disposed) return false;
      if (this.offset === null) this.offset = Date.parse(board.now) - Date.now();
      this.apply(board);
      return true;
    } catch (e) {
      if (this.disposed) return false;
      if (e instanceof ApiError && e.status === 404) this.closed();
      else {
        // Unreachable for now: what it showed stays; the polling (or the next try) reads it again.
        this.connection = 'reconnecting';
        if (this.state === 'loading') this.startPolling();
        this.render();
      }
      return this.state !== 'unavailable' && !this.board?.over;
    }
  }

  /**
   * The link answers no more. The release has ended: its last board stays on show, the end said (SOLD OUT, or THE RELEASE
   * HAS ENDED). Otherwise the link was replaced or revoked: THIS BOARD IS NOT AVAILABLE.
   */
  private closed(): void {
    const b = this.board;
    if (b && (b.over || b.phase === 'ENDED' || this.now() >= Date.parse(b.closesAt))) this.board = { ...b, phase: 'ENDED', over: true };
    else this.state = 'unavailable';
    this.stopStream();
    this.stopPolling();
    this.render();
  }

  private apply(board: LiveBoard): void {
    this.board = board;
    this.state = 'shown';
    // Read while its stream is not running (the polling): the stream asked for again a little later.
    if (this.started && !this.abort && !this.retryTimer && !board.over) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.follow();
      }, LIVE_STREAM_RETRY_MS);
    }
    this.render();
  }

  /** The stream: `board` events as the server sends them (only on a change); polled while it cannot run. */
  private async follow(): Promise<void> {
    if (this.disposed || this.abort || this.state !== 'shown' || this.board?.over) return;
    const abort = new AbortController();
    this.abort = abort;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const body = await this.deps.api.liveBoardStream(this.deps.id, this.deps.token!, abort.signal);
      if (this.disposed || this.abort !== abort) return;
      if (!body) {
        // The release is over: its last board, read once.
        this.abort = null;
        await this.read();
        return;
      }
      this.connection = 'live';
      this.stopPolling();
      this.render();
      reader = body.getReader();
      const parser = new SseParser();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || this.abort !== abort) break;
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          if (ev.event !== 'board') continue;
          const board = boardOf(ev.data);
          if (board) this.apply(board);
        }
      }
    } catch (e) {
      if (this.disposed || this.abort !== abort) return;
      if (e instanceof ApiError && e.status === 404) {
        this.abort = null;
        this.closed();
        return;
      }
    } finally {
      void reader?.cancel().catch(() => undefined);
    }
    if (this.disposed || this.abort !== abort) return;
    // The stream ended (the release over, the link replaced or revoked, the network): the board read again says which,
    // and is read every LIVE_POLL_MS until the stream runs again.
    this.abort = null;
    this.connection = 'reconnecting';
    this.render();
    if ((await this.read()) && !this.disposed) this.startPolling();
  }

  private stopStream(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startPolling(): void {
    if (this.pollTimer || this.disposed) return;
    this.pollTimer = setInterval(() => {
      void this.read().then((on) => {
        if (!on || this.board?.over) this.stopPolling();
      });
    }, LIVE_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // ── Showing ──────────────────────────────────────────────────────────────

  private tick(): void {
    if (this.state === 'shown' && this.board && this.view) this.view.update(boardModel(this.board, this.now()));
  }

  private render(): void {
    if (this.disposed) return;
    const over = this.board?.over === true;
    const live = this.state === 'shown' && this.connection === 'live' && !over;
    const text = this.status.lastElementChild as HTMLElement;
    const word = this.state === 'shown' && !over ? (live ? LIVE.board.live : LIVE.board.reconnecting) : '';
    if (text.textContent !== word) text.textContent = word;
    this.status.classList.toggle('is-live', live);
    this.status.hidden = word === '';
    this.root.dataset.state = this.state;
    switch (this.state) {
      case 'loading':
        if (this.body.dataset.kind !== 'loading') {
          this.body.dataset.kind = 'loading';
          this.view = null;
          this.body.replaceChildren(h('h1', { class: 'visually-hidden', id: 'board-title', text: LIVE.kind }), h('p', { class: 'live__overline', attrs: { 'aria-busy': 'true' }, text: LIVE.loading }));
        }
        return;
      case 'unavailable': {
        const copy = LIVE.board.unavailable;
        if (this.body.dataset.kind === 'unavailable') return;
        this.body.dataset.kind = 'unavailable';
        this.view = null;
        this.body.replaceChildren(
          h(
            'section',
            { class: 'board__edge' },
            h('p', { class: 'live__overline', text: LIVE.kind }),
            h('h1', { class: 'board__title', id: 'board-title', text: copy.title }),
            h('p', { class: 'live__note board__note', text: copy.text }),
          ),
        );
        return;
      }
      default: {
        const m = boardModel(this.board!, this.now());
        const picture = m.picture?.src ?? '';
        if (this.body.dataset.kind !== 'shown' || !this.view || this.view.picture !== picture) {
          this.body.dataset.kind = 'shown';
          this.view = this.build(m);
          this.body.replaceChildren(this.view.el);
        }
        this.view.update(m);
      }
    }
  }

  /** The board on show: the door on one side, the release, its countdown and its pieces on the other. */
  private build(first: BoardModel): { el: HTMLElement; update(m: BoardModel): void; picture: string } {
    const lock = sealSvg('live-door__seal');
    const door = h(
      'div',
      { class: 'live-door board__door', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'live-door__inside' }, this.piece(first.picture)),
      h('div', { class: 'live-door__leaf live-door__leaf--left' }),
      h('div', { class: 'live-door__leaf live-door__leaf--right' }),
      h('div', { class: 'live-door__lock' }, lock),
    );
    // Opened before the board was (a page loaded after T0, or the piece's picture changed): open at once, unmoving.
    if (first.door === 'open') door.classList.add('is-aligned', 'is-open', 'is-still');
    const overline = h('p', { class: 'live__overline board__overline' });
    const title = h('h1', { class: 'board__title', id: 'board-title' });
    const quantity = h('p', { class: 'live__fact board__quantity' });
    const label = h('p', { class: 'live__overline board__count-label', id: 'board-count' });
    const units = Array.from({ length: 3 }, () => ({ value: h('span', { class: 'board__digits' }), unit: h('span', { class: 'live__unit-label' }) }));
    const clock = h(
      'div',
      { class: 'board__countdown', attrs: { role: 'timer', 'aria-labelledby': 'board-count' } },
      ...units.flatMap((u, i) => [i > 0 ? h('span', { class: 'board__colon', attrs: { 'aria-hidden': 'true' }, text: ':' }) : null, h('span', { class: 'live__unit' }, u.value, u.unit)]),
    );
    const count = h('div', { class: 'board__count' }, label, clock);
    const leftValue = h('span', { class: 'board__left-value' });
    const leftOf = h('span', { class: 'live__fact board__left-of' });
    const meter = h('div', { class: 'live__meter board__meter', attrs: { 'aria-hidden': 'true' } });
    const left = h('div', { class: 'board__left', attrs: { role: 'status' } }, h('p', { class: 'board__left-line' }, leftValue, leftOf), meter);
    const when = h('p', { class: 'live__fact board__when' });
    const info = h('div', { class: 'board__info' }, overline, title, quantity, h('hr', { class: 'live__rule board__rule' }), count, left, when);
    const el = h('section', { class: 'board__stage' }, h('div', { class: 'board__door-wrap' }, bracket(door)), info);
    let cells = '';
    let opened = first.door === 'open';
    const update = (m: BoardModel): void => {
      setText(overline, m.overline);
      setText(title, m.name);
      setText(quantity, m.quantityLine);
      quantity.hidden = m.quantityLine === '';
      count.hidden = m.countdown === null;
      if (m.countdown) {
        setText(label, m.countdown.label);
        m.countdown.units.forEach((p, i) => {
          if (units[i]!.value.textContent !== p.value) units[i]!.value.textContent = p.value;
          if (units[i]!.unit.textContent !== p.unit) units[i]!.unit.textContent = p.unit;
        });
      }
      if (leftValue.textContent !== m.left.value) leftValue.textContent = m.left.value;
      setText(leftOf, m.left.of);
      const key = m.cells ? m.cells.join('') : `bar:${m.taken.toFixed(3)}`;
      if (key !== cells) {
        cells = key;
        meter.classList.toggle('live__meter--bar', m.cells === null);
        if (m.cells) {
          meter.style.setProperty('--cells', String(m.cells.length));
          meter.replaceChildren(...m.cells.map((c) => h('span', { class: `live__cell live__cell--${c}` })));
        } else {
          const bar = h('span', { class: 'live__bar' });
          bar.style.transform = `scaleX(${m.taken})`;
          meter.replaceChildren(bar);
        }
      }
      setText(when, m.when);
      // The lock: the last minute its orbits turn back into alignment; at T0 it clicks, and the door opens.
      if (!opened && !prefersReducedMotion()) turnRings(lock, (k) => lockAngle(k, m.untilOpening));
      if (!opened && m.door === 'open') {
        opened = true;
        door.classList.add('is-aligned');
        setTimeout(() => door.classList.add('is-open'), prefersReducedMotion() ? 0 : DOOR_DELAY_MS);
      }
      this.root.dataset.phase = m.phase;
    };
    return { el, update, picture: first.picture?.src ?? '' };
  }

  /** The piece behind the door: its photograph, else its silhouette, else the seal; lit by the sweep as the door opens. */
  private piece(picture: LivePicture | null): HTMLElement {
    const plate = h('div', { class: 'live__plate board__plate' });
    const seal = () => sealSvg('live__plate-seal');
    if (picture) {
      const img = h('img', { class: ['live__img', `live__img--${picture.kind}`], attrs: { src: picture.src, alt: '', decoding: 'async' } });
      img.addEventListener('error', () => img.replaceWith(seal()), { once: true });
      const light = h('span', { class: 'live__sweep', attrs: { 'aria-hidden': 'true' } });
      light.style.setProperty('--piece', `url("${picture.src}")`);
      plate.append(img, light);
    } else plate.append(seal());
    return plate;
  }

  // ── Full screen ──────────────────────────────────────────────────────────

  private async fullScreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Refused (a browser without it, or a policy): the page stays as it is.
    }
  }

  private readonly onFullScreen = (): void => {
    this.full.hidden = !document.fullscreenEnabled || document.fullscreenElement !== null;
  };
}

/** A line's words, its figures in the reading face; untouched when the same. */
function setText(el: HTMLElement, text: string): void {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.replaceChildren(...withNumerals(text));
}
