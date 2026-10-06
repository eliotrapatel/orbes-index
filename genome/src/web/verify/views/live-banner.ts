/**
 * The banner of the LIVE RELEASES (plan of 2026-10-04, The experience: the banner), on /verify and MY PIECES: a strip
 * under the rail of chapters, a link to the release's page. NOCTURNE draws it as the canvas does (C3): a plate, the
 * live dot at its left, its line, the chevron at its right.
 *
 *   LIVE RELEASE · MONOLITHE · OPENS IN 02:14:09      announced (its hours past 24 a day or more ahead: 73:14:09)
 *   LIVE RELEASE · MONOLITHE · THE ROOM IS OPEN       from the room's opening
 *   LIVE RELEASE · MONOLITHE · LIVE NOW               from T0 to the end; then hidden
 *
 * The release is the server's pick (GET /api/v1/live/next: the one live now, else the room open, else the next
 * announced), its name only once revealed. Its phase follows the release's own times on the server's clock (one round
 * trip to /api/v1/live/clock), so it changes on the second; the release is read again every BANNER_REFRESH_MS (a
 * sell-out or an end decided by ORBES hides it then), and at its name's stage. Hidden whenever there is none, while the
 * page is on another screen, or when the release cannot be read.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { bannerModel, measureClock, type BannerModel } from '../live-model.js';
import type { LiveBanner } from '../types.js';
import { withNumerals } from './common.js';
import { icon } from './nocturne.js';

/** The release is read again this often while the banner is on show. */
export const BANNER_REFRESH_MS = 60_000;
/** The banner's own pulse (its countdown). */
const PULSE_MS = 250;
/** Once its release has ended, the next is read; again no sooner than this while the server still names the same. */
const ENDED_READ_MS = 3000;

export interface LiveBannerDeps {
  api: Pick<ApiClient, 'liveNext' | 'liveClock'>;
  /** The release's page, in the app (a plain click; another tab or window is the browser's). */
  onRelease(id: string): void;
}

export interface LiveBannerView {
  /** The strip; hidden until there is a release to say. */
  el: HTMLElement;
  /** On show with the landing and MY PIECES; off on every other screen (it then reads and counts nothing). */
  show(on: boolean): void;
  dispose(): void;
}

export function liveBannerView(deps: LiveBannerDeps): LiveBannerView {
  return new Banner(deps);
}

class Banner implements LiveBannerView {
  readonly el: HTMLElement;
  private readonly link: HTMLAnchorElement;
  private readonly lead = h('span', { class: 'live-banner__lead' });
  private readonly state = h('span', { class: 'live-banner__state' });
  private readonly clock = h('span', { class: 'live-banner__clock' });
  private release: LiveBanner | null = null;
  private offset: number | null = null;
  private on = false;
  private readAt = 0;
  private reading = false;
  private pulse: ReturnType<typeof setInterval> | null = null;
  private refresh: ReturnType<typeof setTimeout> | null = null;
  private shown: BannerModel | null = null;
  private disposed = false;

  constructor(private readonly deps: LiveBannerDeps) {
    this.link = h(
      'a',
      {
        class: 'live-banner',
        attrs: { href: '/verify/releases' },
        on: {
          click: (ev) => {
            if (!this.shown || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
            ev.preventDefault();
            this.deps.onRelease(this.shown.id);
          },
        },
      },
      h('i', { class: 'n-live live-banner__live', attrs: { 'aria-hidden': 'true' } }),
      // One line on one baseline: the countdown's figures in the reading face, on the labels' own.
      h('span', { class: 'live-banner__line' }, this.lead, h('span', { class: 'live-banner__dot', attrs: { 'aria-hidden': 'true' }, text: ' · ' }), this.state, this.clock),
      icon('chev', { small: true }),
    );
    this.el = h('div', { class: 'live-banner-host', attrs: { hidden: true } }, this.link);
  }

  show(on: boolean): void {
    if (this.disposed || on === this.on) return;
    this.on = on;
    if (!on) {
      this.stop();
      this.draw();
      return;
    }
    this.pulse = setInterval(() => this.draw(), PULSE_MS);
    // Read again when it was read long enough ago; drawn at once from what was read meanwhile.
    if (Date.now() - this.readAt >= BANNER_REFRESH_MS || this.offset === null) void this.read();
    else this.schedule();
    this.draw();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.el.remove();
  }

  private stop(): void {
    if (this.pulse) clearInterval(this.pulse);
    if (this.refresh) clearTimeout(this.refresh);
    this.pulse = null;
    this.refresh = null;
  }

  private now(): number {
    return Date.now() + (this.offset ?? 0);
  }

  private async read(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const [release, clock] = await Promise.all([this.deps.api.liveNext(), this.offset === null ? measureClock(() => this.deps.api.liveClock(), 1) : Promise.resolve(null)]);
      if (this.disposed) return;
      if (clock) this.offset = clock.offset;
      this.release = release;
      this.readAt = Date.now();
    } catch {
      // Unreachable for now: the banner stays as it was, hidden if it never showed; the next read tries again.
      this.readAt = Date.now();
    } finally {
      this.reading = false;
    }
    if (this.on) this.schedule();
    this.draw();
  }

  /** The next read: in BANNER_REFRESH_MS, or at the name's stage when it comes before. */
  private schedule(): void {
    if (this.refresh) clearTimeout(this.refresh);
    let wait = Math.max(0, BANNER_REFRESH_MS - (Date.now() - this.readAt));
    const nameAt = this.release && this.release.name === null ? Date.parse(this.release.nameAt) - this.now() : NaN;
    if (Number.isFinite(nameAt) && nameAt >= 0 && nameAt < wait) wait = nameAt + 500;
    this.refresh = setTimeout(() => {
      this.refresh = null;
      if (this.on) void this.read();
    }, wait);
  }

  private draw(): void {
    const m = this.on ? bannerModel(this.release, this.now()) : null;
    // Its release has just ended: the next one, if any, read at once (a few seconds apart while the server disagrees).
    if (this.on && !m && this.release && !this.reading && Date.now() - this.readAt > ENDED_READ_MS) void this.read();
    const was = this.shown;
    this.shown = m;
    this.el.hidden = m === null;
    if (m) document.body.dataset.banner = '';
    else delete document.body.dataset.banner;
    if (!m) return;
    if (was?.id !== m.id) this.link.setAttribute('href', m.href);
    if (this.lead.dataset.text !== m.lead) {
      this.lead.dataset.text = m.lead;
      this.lead.replaceChildren(...withNumerals(m.lead));
    }
    if (this.state.textContent !== m.state) this.state.replaceChildren(...withNumerals(m.state));
    const clock = m.clock ?? '';
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    this.clock.hidden = m.clock === null;
    this.el.dataset.phase = m.phase;
  }
}
