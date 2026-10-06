/**
 * THE RELEASES (P-R03; plan NOCTURNE, screen 6, step N7: C7, C19, C25): the releases ORBES announces,
 * /verify/releases, and a draw's page, /verify/releases/<id> (a LIVE RELEASE's is views/live.ts), in NOCTURNE's pieces.
 *
 *   THE RELEASES                                 the title and its sentence (on PAST, signed in: « You have taken part
 *   Pieces released in a limited number. …       in N releases. », C25)
 *   LIVE   PAST                                  the underlined tabs (plan LIVE RELEASE+, choice 5)
 *   [the photograph, whole, faded]               each release at the column's full width, its words lifted onto it:
 *   LIVE RELEASE                                 a LIVE RELEASE (C7): where it stands, its title, its day and hour in
 *   MONOLITHE IN BLUE                            Paris (then on this phone), its price, OPENS IN and its countdown on
 *   THURSDAY 8 OCTOBER · 21:00 PARIS             the server's clock (addition 4), its quantity, limit and rule, the
 *   OPENS IN  02 : 06 : 12                       reveals still to come, N COLLECTORS WILL BE THERE; one not revealed
 *   25 PIECES · ONE PER COLLECTOR · FOR OWNERS   yet on its seal (the monogram); a draw: DRAW · its state, its title,
 *   [ SEE THE RELEASE ]                          its model, its price (addition 5), its pieces and close in UTC. The
 *                                                first release's SEE THE RELEASE is the page's one filled button.
 *
 * LIVE  the releases to come and under way: the LIVE RELEASES first, then the draws (neither drawn nor cancelled): the
 *       release calendar. The list is read again at each moment that changes a LIVE RELEASE's card, on the server's
 *       clock (a stage, its room, T0, its end), and every BANNER_REFRESH_MS while a room is open or a release live: each
 *       stage shows at its time, and the release leaves LIVE for PAST at its end, within a minute when it comes early
 *       (sold out, or ended by ORBES). Each countdown is drawn again every second, silently (never read aloud).
 * PAST  every release ended, the newest first, LIVE RELEASES and draws together (never a cancelled one nor an
 *       after-room), PAST_PAGE_SIZE at a time (SHOW MORE): each with its photograph, LIVE RELEASE or DRAW and its date,
 *       its title, its model, its quantity as announced (no end figure), SEE THE RELEASE (its page in its final state,
 *       decision 30); signed in, YOU TOOK PART or YOU SECURED A PIECE on each release concerned. Read when the tab is
 *       first shown. The tab shown is kept with the page's place in the history (back from a release returns to it).
 *
 * A draw's page (C19): ‹ THE RELEASES; the model's photograph, faded; its collection (or model), its title, its state
 * (with an early access, P-X02: PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …, in UTC); once drawn, the account's
 * part in it (YOU TOOK PART, YOU SECURED A PIECE) and THIS RELEASE IS OVER on a plate (as C29). THE RELEASE: its
 * description, its model with SEE THE MODEL, its facts (PRICE, PIECES, the times in UTC then on this phone, the early
 * access, how long a place drawn is held, the places reserved directly), the paragraph on the early access. YOUR ENTRY:
 * signed out the sign-in and CREATE ACCOUNT of the OWNERSHIP panel (any account may enter); signed in what the entry
 * means now, ENTER THE DRAW (the page's filled button) or RESERVE A PLACE (PLATINE and PALLADIUM during the early
 * access), WITHDRAW, and for a place held the contact of ORBES Client Services. THE DRAW: what a place drawn obliges to,
 * its rule word for word, its commitment, the seed's fingerprint; once drawn the seed, checked on this phone against the
 * fingerprint, and the entries by rank, the account's own marked, a hundred at a time, never said how many. After a
 * reservation the page is read again: its places. The scan is the SCAN ring's, THE RELEASES the crumb's and the rail's.
 *
 * Every action is a same-origin JSON call through ApiClient (the session cookie, the CSRF token); server messages are
 * shown as they come. A 401 ends the session on the page, which then offers the sign-in again. CSP-safe: h() and s()
 * only, styles by class (verify/styles.css, THE RELEASES).
 */
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { CONTACT, LIVE, LOOKBOOK, RELEASES } from '../copy.js';
import { CHANGE_RETRY_MS, countdown as countdownGroups, liveCards, measureClock, nextChange, type LiveCardModel } from '../live-model.js';
import {
  drawLines,
  entryModel,
  participationModel,
  pastCards,
  PastPages,
  PAST_PAGE_SIZE,
  releaseCards,
  releaseSheet,
  type EntryModel,
  type ParticipationModel,
  type PastCardModel,
  type ReleaseCardModel,
  type ReleaseRow,
  type ReleaseSheetModel,
} from '../releases-model.js';
import type { SessionStore } from '../session.js';
import type { ClientServices, ClubEntry, DrawEntry } from '../types.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import { dayAndHour, RELEASES_PATH, viewRoot, withNumerals } from './common.js';
import { appAnchor, button, contactLines, countdown, fadedPhoto, failedState, icon, loadingState, modelTitle, monogram, quietLine, textLink } from './nocturne.js';
import { messageOf } from './forms.js';
import { BANNER_REFRESH_MS } from './live-banner.js';
import { OwnershipPanel } from './ownership.js';
import { tabsView } from './tabs.js';

export interface ReleasesView {
  root: HTMLElement;
  dispose(): void;
}

/** THE RELEASES' tabs (plan LIVE RELEASE+, choice 5). */
export type ReleasesTab = 'live' | 'past';
export const RELEASES_TABS: readonly ReleasesTab[] = ['live', 'past'];

export interface ReleasesDeps {
  api: ApiClient;
  /** PAST: signed in, the account's part in each release. */
  session: SessionStore;
  /** The tab shown first (the one the page's place in the history kept). */
  tab: ReleasesTab;
  /** A tab chosen: the page's place in the history keeps it. */
  onTab(tab: ReleasesTab): void;
  /** Open a release's page in the app. */
  onRelease(id: string): void;
  /** This phone's time zone: a LIVE RELEASE's opening is said in Paris, then here when it differs. */
  localZone: string;
}

export interface ReleaseDeps {
  api: ApiClient;
  session: SessionStore;
  /** The release's id; null when the address names none (the page says the release is not known). */
  id: string | null;
  onScan(): void;
  /** THE RELEASES: back to the list. */
  onReleases(): void;
  /** SEE THE MODEL: its sheet in THE COLLECTION. */
  onModel(slug: string): void;
  /** How ORBES Client Services is reached (`{}` when not configured); never rejects. */
  clientServices(): Promise<ClientServices>;
  /** Minutes east of UTC of this phone's clock. */
  offsetMinutes: number;
}

export function releasesView(deps: ReleasesDeps): ReleasesView {
  const page = new ListPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

export function releaseView(deps: ReleaseDeps): ReleasesView {
  const page = new ReleasePage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** The first word of a model's line (`MONOLITHE` of `MONOLITHE · BRACELET`): a draw's title sets it on a line of its own. */
function modelName(line: string): string | null {
  const w = line.split(' · ')[0]?.trim();
  return w ? w : null;
}

/** `12 PIECES · ENTRIES CLOSE 11 OCT 2026 · 18:00 UTC`: its date never parted from its hour (the canvas's `.nw`). */
function timedLine(line: string, cls: (string | null)[]): HTMLParagraphElement {
  const m = /^(.*?)\s*(\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC)$/.exec(line);
  if (!m) return h('p', { class: cls }, ...withNumerals(line));
  return h('p', { class: cls }, ...withNumerals(m[1]!), m[1] ? ' ' : null, h('span', { class: 'n-nw' }, ...withNumerals(m[2]!)));
}

/**
 * A release's photograph, whole and faded, and its words lifted onto its foot; without one (or once it cannot be
 * loaded) the words open where it would have been, never a broken image.
 */
function photographed(image: { src: string; alt: string } | null, words: HTMLElement, opts: { eager?: boolean; extraClass?: string; imgClass?: string; bare: string }): HTMLElement[] {
  if (!image) {
    words.classList.add(opts.bare);
    return [words];
  }
  const photo = fadedPhoto(image.src, image.alt, { eager: opts.eager, extraClass: opts.extraClass });
  photo.dataset.photo = '';
  if (opts.imgClass) photo.querySelector('img')?.classList.add(opts.imgClass);
  photo.querySelector('img')?.addEventListener(
    'error',
    () => {
      photo.remove();
      words.classList.add(opts.bare);
    },
    { once: true },
  );
  return [photo, words];
}

/** OPENS IN and its countdown, on the server's clock, while T0 is ahead; nothing once it has come. */
interface Clock {
  at: number;
  el: HTMLElement;
  key: string;
}

function drawClock(c: Clock, now: number): void {
  const ahead = Number.isFinite(c.at) && now < c.at;
  const groups = ahead ? countdownGroups(c.at - now) : [];
  const key = groups.map((g) => `${g.value}${g.unit}`).join(':');
  if (key === c.key) return;
  c.key = key;
  c.el.replaceChildren(
    ...(ahead
      ? [
          h('p', { class: 'n-g n-lb n-releases__opens', text: LIVE.opensIn }),
          countdown(
            groups.map((g) => [g.value, g.unit] as const),
            { label: `${LIVE.opensIn} ${groups.map((g) => `${g.value} ${g.unit}`).join(' ')}` },
          ),
        ]
      : []),
  );
}

// ── The list ───────────────────────────────────────────────────────────────

/** `liveFailed`: the LIVE half could not be read (a refusal of its own rate group, an error): the draws show all the same. */
type ListLoad = { kind: 'loading' } | { kind: 'ready'; live: LiveCardModel[]; liveFailed: boolean; cards: ReleaseCardModel[] } | { kind: 'failed'; message: string };

/** THE RELEASES reads its releases again at the next moment that changes a LIVE RELEASE's card, this long after it. */
const CHANGE_MARGIN_MS = 600;
/** …and at the latest this often while it is open. */
const CHANGE_MAX_MS = 6 * 3_600_000;
/** A quiet read that changed the list draws it with its live region off, turned back on this long after. */
const QUIET_DRAW_MS = 1000;
/** The countdowns are drawn again this often (their seconds within the last day). */
const PULSE_MS = 1000;

/** What a list on show is drawn from (its models are plain data), null while none is. */
function keyOf(l: ListLoad): string | null {
  return l.kind === 'ready' ? JSON.stringify({ live: l.live, liveFailed: l.liveFailed, cards: l.cards }) : null;
}

class ListPage {
  readonly root: HTMLElement;
  /** The page's sentence; on PAST, signed in, how many releases the account took part in (C25). */
  private readonly lead = h('p', { class: 'n-lead n-releases__lead releases__lead', text: RELEASES.lead });
  private readonly body = h('div', { class: 'releases__body n-releases__body', attrs: { 'aria-live': 'polite' } });
  private load: ListLoad = { kind: 'loading' };
  private disposed = false;
  /** The server's clock against this phone's, once measured (the moments of the LIVE RELEASES are the server's). */
  private offset: number | null = null;
  /** A moment of a LIVE RELEASE is near: the next read measures the server's clock again, the cards drawn meanwhile on the last offset known. */
  private remeasure = false;
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the list on show was drawn from: a quiet read bringing the same leaves it as it is, its nodes and its reader. */
  private drawn: string | null = null;
  private politeTimer: ReturnType<typeof setTimeout> | null = null;
  /** OPENS IN on each LIVE RELEASE's card (addition 4), drawn again every PULSE_MS. */
  private clocks: Clock[] = [];
  private pulse: ReturnType<typeof setInterval> | null = null;
  private tab: ReleasesTab;

  /** PAST, built when its tab is first shown. */
  private past: PastList | null = null;

  constructor(private readonly deps: ReleasesDeps) {
    this.root = viewRoot('releases', 'releases-title');
    this.root.classList.add('n-releases');
    this.tab = RELEASES_TABS.includes(deps.tab) ? deps.tab : 'live';
    const tabs = tabsView<ReleasesTab>(
      RELEASES_TABS,
      (tab) => {
        if (tab === 'live') return this.body;
        this.past = new PastList(deps, () => this.drawLead());
        return this.past.root;
      },
      this.tab,
      {
        labels: { live: RELEASES.tabs.live, past: RELEASES.tabs.past },
        idPrefix: 'releases-',
        label: RELEASES.tabs.label,
        regionLabel: RELEASES.tabs.label,
        kind: 'tabs',
        onSelect: (tab) => {
          this.tab = tab;
          this.drawLead();
          deps.onTab(tab);
        },
      },
    );
    tabs.root.classList.add('releases__tabs', 'n-releases__tabs');
    tabs.root.querySelector('[role="tablist"]')?.classList.add('n-px');
    this.root.append(h('header', { class: 'n-px releases__head n-releases__head' }, h('h1', { class: 'n-g n-t1 releases__title', id: 'releases-title', text: RELEASES.title }), this.lead), tabs.root);
    this.drawLead();
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    if (this.politeTimer) clearTimeout(this.politeTimer);
    if (this.pulse) clearInterval(this.pulse);
    this.past?.dispose();
  }

  /** The head's sentence: the page's, or on PAST, signed in, « You have taken part in N releases. » once read (C25). */
  private drawLead(): void {
    const taken = this.tab === 'past' ? (this.past?.taken ?? null) : null;
    const text = taken ?? RELEASES.lead;
    if (this.lead.textContent !== text) this.lead.textContent = text;
    this.lead.classList.toggle('releases__taken', taken !== null);
  }

  /**
   * The releases. `quiet`: read again at a moment of a LIVE RELEASE (a stage, its room, T0, its end, or the watch of a
   * room open or a release live), the list kept on show meanwhile and kept as it was should the read fail; the release that has ended leaves it then.
   */
  private async fetch(quiet = false): Promise<void> {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    if (!quiet) {
      this.load = { kind: 'loading' };
      this.render();
    }
    try {
      // The two halves read apart: the LIVE one failing (its own rate group, an error) leaves the draws on show, said above
      // them; the draws failing is the failure of the page.
      const [drops, live] = await Promise.all([this.deps.api.drops(), this.deps.api.liveReleases().catch(() => null)]);
      if (this.disposed) return;
      if (live && live.length > 0 && (this.offset === null || this.remeasure)) {
        const measured = await measureClock(() => this.deps.api.liveClock(), 1);
        if (measured) {
          this.offset = measured.offset;
          this.remeasure = false;
        }
      }
      if (this.disposed) return;
      this.load = { kind: 'ready', live: live ? liveCards(live, this.deps.localZone) : [], liveFailed: live === null, cards: releaseCards(drops) };
      if (live) this.schedule(live);
    } catch (e) {
      if (this.disposed) return;
      if (quiet && this.load.kind === 'ready') {
        this.changeTimer = setTimeout(() => void this.fetch(true), 60_000);
        return;
      }
      this.load = { kind: 'failed', message: messageOf(e) };
    }
    if (quiet && this.drawn !== null && keyOf(this.load) === this.drawn) return;
    this.render(quiet);
  }

  /**
   * The next read: at the next moment that changes a LIVE RELEASE's card, on the server's clock; within
   * BANNER_REFRESH_MS while a room is open or a release live (sold out or ended by ORBES, it leaves the list then, as it
   * leaves the banner). A moment passed that the answer still holds ahead says this phone's estimate of the server's
   * clock may be off: it is measured again with that read.
   */
  private schedule(live: Parameters<typeof nextChange>[0]): void {
    const now = this.now();
    const next = nextChange(live, now, BANNER_REFRESH_MS);
    if (next === null) return;
    if (next - now <= CHANGE_RETRY_MS) this.remeasure = true;
    this.changeTimer = setTimeout(() => void this.fetch(true), Math.min(CHANGE_MAX_MS, next - now + CHANGE_MARGIN_MS));
  }

  private now(): number {
    return Date.now() + (this.offset ?? 0);
  }

  /**
   * `quiet`: a quiet read that changed the list (a stage reached, a release gone): the link the keyboard was on keeps
   * it, when it is still there; and the live region is off for that draw, so a screen reader is not read the whole list
   * again for one card changed (it is polite again QUIET_DRAW_MS later, for the next read asked for).
   */
  private render(quiet = false): void {
    const hadFocus = this.body.contains(document.activeElement);
    const focused = quiet && hadFocus ? (document.activeElement as HTMLElement).getAttribute('href') : null;
    if (this.politeTimer) clearTimeout(this.politeTimer);
    this.politeTimer = null;
    this.body.setAttribute('aria-live', quiet ? 'off' : 'polite');
    this.draw(hadFocus);
    this.drawn = keyOf(this.load);
    if (focused) this.body.querySelector<HTMLElement>(`a[href="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    if (quiet) {
      this.politeTimer = setTimeout(() => {
        this.politeTimer = null;
        this.body.setAttribute('aria-live', 'polite');
      }, QUIET_DRAW_MS);
    }
  }

  private draw(hadFocus: boolean): void {
    const l = this.load;
    this.clocks = [];
    if (this.pulse) clearInterval(this.pulse);
    this.pulse = null;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(RELEASES.loading, { extraClass: 'releases__waiting n-releases__state' }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(h('div', { class: 'n-px n-releases__state' }, failedState({ sentence: RELEASES.loadFailed, reason: l.message, retry: RELEASES.retry, onRetry: () => void this.fetch(), retryClass: 'releases__retry' })));
      if (hadFocus) this.body.querySelector<HTMLElement>('.releases__retry')?.focus();
      return;
    }
    const partial = l.liveFailed
      ? h(
          'div',
          { class: 'n-px n-releases__state releases__partial' },
          h('p', { class: 'n-sm n-ivc form__error', attrs: { role: 'alert' }, text: RELEASES.liveFailed }),
          h('p', { class: 'n-releases__retry-line' }, textLink(RELEASES.retry, { onOpen: () => void this.fetch(), extraClass: 'releases__retry' })),
        )
      : null;
    if (l.cards.length === 0 && l.live.length === 0) {
      // Nothing to show: no release announced, or none known while the LIVE half could not be read.
      this.body.replaceChildren(partial ?? h('div', { class: 'n-px n-releases__state' }, quietLine(RELEASES.empty, 'releases__empty')));
      if (hadFocus) this.body.querySelector<HTMLElement>('.releases__retry')?.focus();
      return;
    }
    // The first release's SEE THE RELEASE is the page's one filled button; the others are hairline buttons.
    let first = true;
    const primary = () => {
      const was = first;
      first = false;
      return was;
    };
    this.body.replaceChildren(
      ...(partial ? [partial] : []),
      h(
        'ul',
        { class: 'releases__list n-releases__list' },
        ...l.live.map((c) => h('li', { class: 'releases__item n-releases__item' }, this.liveCard(c, primary()))),
        ...l.cards.map((c) => h('li', { class: 'releases__item n-releases__item' }, this.card(c, primary()))),
      ),
    );
    if (this.clocks.length > 0) {
      this.tick();
      this.pulse = setInterval(() => this.tick(), PULSE_MS);
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const c of this.clocks) drawClock(c, now);
  }

  /** SEE THE RELEASE: a link to its page, said of which release; filled for the page's first release, else a hairline. */
  private see(id: string, href: string, titleId: string, primary: boolean, extra: string): HTMLAnchorElement {
    const link = appAnchor(href, ['n-g', 'n-btn', primary ? null : 'n-btn--ol', 'n-releases__see', extra], () => this.deps.onRelease(id), RELEASES.see);
    link.setAttribute('aria-describedby', titleId);
    return link;
  }

  /**
   * A LIVE RELEASE (C7): its photograph (its silhouette before), else its seal; where it stands, its title, its day and
   * hour in Paris (then on this phone), its price, OPENS IN and its countdown, its lines, the reveals still to come, N
   * COLLECTORS WILL BE THERE, SEE THE RELEASE.
   */
  private liveCard(c: LiveCardModel, primary: boolean): HTMLElement {
    const titleId = `release-${c.id}-title`;
    const clock: Clock = { at: c.opensAt, el: h('div', { class: 'n-releases__clock', attrs: { 'aria-live': 'off' } }), key: '' };
    this.clocks.push(clock);
    const words = h(
      'div',
      { class: 'n-px n-ctr n-releases__words' },
      h('p', { class: 'n-g n-lb live-card__kind', text: c.kind }),
      h('h2', { class: 'n-g n-t1 n-releases__title live-card__title', id: titleId }, ...withNumerals(c.title)),
      h('p', { class: 'n-num n-releases__price live-card__price', text: c.price }),
      h('p', { class: 'n-g n-lb n-releases__when live-card__when' }, ...withNumerals(c.when.paris)),
      c.when.local ? h('p', { class: 'n-g n-lb n-releases__local live-card__when live-card__when--local' }, ...withNumerals(c.when.local)) : null,
      clock.el,
      h('div', { class: 'n-lines n-releases__lines live-card__line' }, ...c.lines.map((l, i) => h('span', { class: ['n-g', 'n-lines__line', i === 0 ? 'n-ivc' : null] }, ...withNumerals(l)))),
      // The calendar of the reveals still to come: each stage's time, never what it shows.
      c.reveals.length
        ? h(
            'div',
            { class: 'n-releases__reveals live-card__reveals', attrs: { role: 'group', 'aria-labelledby': `${titleId}-reveals` } },
            h('p', { class: 'n-g n-lb n-ivc n-releases__reveals-title', id: `${titleId}-reveals`, text: LIVE.reveals }),
            h(
              'div',
              { class: 'n-lines n-releases__reveals-lines' },
              ...c.reveals.map((d) => h('span', { class: 'n-g n-lines__line live-card__reveal' }, h('span', { class: 'live-card__reveal-stage', text: d.label }), ' · ', dayAndHour(d.when, 'live-card__reveal-when'))),
            ),
          )
        : null,
      c.interest ? h('p', { class: 'n-g n-lb n-releases__interest live-card__interest' }, ...withNumerals(c.interest)) : null,
      this.see(c.id, c.href, titleId, primary, 'live-card__link'),
    );
    const article = h('article', { class: 'live-card n-releases__release', attrs: { 'aria-labelledby': titleId } });
    if (c.picture) {
      words.classList.add('n-lift');
      const photo = fadedPhoto(c.picture.src, c.picture.alt, { extraClass: ['n-releases__photo', c.picture.kind === 'silhouette' ? 'n-releases__photo--silhouette' : null].filter(Boolean).join(' ') });
      photo.querySelector('img')?.classList.add('live-card__img', `live-card__img--${c.picture.kind}`);
      // A picture that cannot be loaded gives way to the seal.
      photo.querySelector('img')?.addEventListener('error', () => {
        photo.replaceWith(this.seal());
        words.classList.remove('n-lift');
        words.classList.add('n-releases__sealed');
      }, { once: true });
      article.append(photo, words);
    } else {
      words.classList.add('n-releases__sealed');
      article.append(this.seal(), words);
    }
    return article;
  }

  /** A release not revealed yet: the monogram on its seal (C7), never the ORBES code (only the camera shows one). */
  private seal(): HTMLElement {
    return h('div', { class: 'n-ctr n-releases__seal-line' }, h('div', { class: 'n-seal live-card__seal' }, monogram(54)));
  }

  /** A draw (C7): DRAW · its state, its title, its model, its price, its pieces and the time that matters in UTC. */
  private card(c: ReleaseCardModel, primary: boolean): HTMLElement {
    const titleId = `release-${c.id}-title`;
    const words = h(
      'div',
      { class: 'n-px n-ctr n-lift n-releases__words' },
      h('p', { class: 'n-g n-lb release-card__state', text: `${RELEASES.past.kind.DRAW} · ${c.stateLabel}` }),
      (() => {
        const t = modelTitle('h2', ['n-g', 'n-t1', 'n-releases__title', 'n-releases__title--draw', 'release-card__title'], c.title, modelName(c.model));
        t.id = titleId;
        return t;
      })(),
      c.model ? h('p', { class: 'n-g n-lb n-releases__model release-card__model' }, ...withNumerals(c.model)) : null,
      c.price ? h('p', { class: 'n-num n-releases__draw-price release-card__price', text: c.price }) : null,
      timedLine(c.line, ['n-g', 'n-lb', 'n-ivc', 'n-num', 'n-releases__line', 'release-card__line']),
      this.see(c.id, c.href, titleId, primary, 'release-card__link'),
    );
    return h(
      'article',
      { class: 'release-card n-releases__release', data: { state: c.state }, attrs: { 'aria-labelledby': titleId } },
      ...photographed(c.image, words, { bare: 'n-releases__bare', extraClass: 'n-releases__photo release-card__frame', imgClass: 'release-card__img' }),
    );
  }
}

// ── PAST ───────────────────────────────────────────────────────────────────

/** The account's part in the releases: not asked (signed out), being read, read, or unreadable. */
type TakenLoad = { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; model: ParticipationModel } | { kind: 'failed' };

/**
 * THE RELEASES' PAST (plan LIVE RELEASE+, choice 5; C25): the releases ended, a page at a time. The cards already shown
 * stay as they are when more come (SHOW MORE appends them, the keyboard moved to the first of them) and when the
 * account's part in them arrives (each card's mark filled in place): nothing is read again to a screen reader that it
 * has read. « You have taken part in N releases. » is the head's sentence while PAST shows (`onTaken`).
 */
class PastList {
  readonly root: HTMLElement;
  /** Why the account's part could not be read, signed in. */
  private readonly takenError = h('p', { class: 'n-px n-sm n-ivc form__error n-releases__state', attrs: { role: 'alert', hidden: true }, text: RELEASES.past.takenFailed });
  /** ONE MOMENT…, NO RELEASE HAS ENDED YET, or why the releases could not be shown. */
  private readonly status = h('div', { class: 'releases__past-status', attrs: { 'aria-live': 'polite' } });
  private readonly list = h('ul', { class: 'releases__list releases__past-list n-releases__list', attrs: { hidden: true } });
  private readonly more = h('div', { class: 'releases__past-more n-releases__more' });
  /** Each card's mark (YOU TOOK PART, YOU SECURED A PIECE), by release. */
  private readonly marks = new Map<string, HTMLElement>();
  /** The releases shown and the pages read: SHOW MORE asks for the next page counted (a release ended meanwhile moves the others). */
  private readonly pages = new PastPages();
  private busy = false;
  private part: TakenLoad = { kind: 'none' };
  /** Bumped at each read of the account's part: an older answer is dropped. */
  private partGen = 0;
  private unsubscribe: (() => void) | null;
  private disposed = false;

  constructor(
    private readonly deps: ReleasesDeps,
    private readonly onTaken: () => void,
  ) {
    this.root = h('div', { class: 'releases__past' }, this.takenError, this.status, this.list, this.more);
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    void this.load();
    void deps.session
      .ensure()
      .catch(() => undefined)
      .then(() => this.onSession());
  }

  /** « You have taken part in N releases. », once read for the account signed in; null otherwise. */
  get taken(): string | null {
    return this.part.kind === 'ready' ? this.part.model.taken : null;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** The first page, or the next one (SHOW MORE). */
  private async load(next = false): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    const page = this.pages.next;
    if (next) this.drawMore('loading');
    else this.drawStatus(loadingState(RELEASES.loading, { extraClass: 'releases__waiting n-releases__state' }));
    try {
      const r = await this.deps.api.pastReleases(page, PAST_PAGE_SIZE);
      if (this.disposed) return;
      // A release ended between two pages moves the others down: one already shown is not shown twice.
      const fresh = this.pages.add(page, pastCards(r.items, this.deps.localZone), r.total);
      this.busy = false;
      this.append(fresh, next);
    } catch (e) {
      if (this.disposed) return;
      this.busy = false;
      if (next) this.drawMore('failed', messageOf(e));
      else {
        this.drawStatus(h('div', { class: 'n-px n-releases__state' }, failedState({ sentence: RELEASES.past.loadFailed, reason: messageOf(e), retry: RELEASES.retry, onRetry: () => void this.load(), retryClass: 'releases__retry' })));
      }
    }
  }

  private append(fresh: PastCardModel[], next: boolean): void {
    const first = this.pages.cards.length - fresh.length;
    if (this.pages.cards.length === 0) {
      this.drawStatus(h('div', { class: 'n-px n-releases__state' }, quietLine(RELEASES.past.empty, 'releases__empty')));
      this.drawMore('idle');
      return;
    }
    this.drawStatus();
    this.list.hidden = false;
    this.list.append(...fresh.map((c) => h('li', { class: 'releases__item n-releases__item' }, this.card(c))));
    this.drawMarks();
    this.drawMore('idle');
    // SHOW MORE: the keyboard on the first release it brought.
    if (next && fresh.length > 0) this.list.children[first]?.querySelector<HTMLElement>('a')?.focus();
  }

  private drawStatus(...children: HTMLElement[]): void {
    const hadFocus = this.status.contains(document.activeElement);
    this.status.replaceChildren(...children);
    if (hadFocus) this.status.querySelector<HTMLElement>('button')?.focus();
  }

  /** SHOW MORE while releases remain; ONE MOMENT… as they are read; why they could not be, and SHOW MORE again. */
  private drawMore(state: 'idle' | 'loading' | 'failed', message = ''): void {
    const hadFocus = this.more.contains(document.activeElement);
    const out: HTMLElement[] = [];
    if (state === 'loading') out.push(h('p', { class: 'n-g n-lb n-ivc n-ctr releases__waiting', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
    if (state === 'failed') out.push(h('p', { class: 'n-px n-sm n-ivc n-ctr form__error', attrs: { role: 'alert' }, text: `${RELEASES.past.moreFailed} ${message}` }));
    if (state !== 'loading' && this.pages.more) out.push(h('p', { class: 'n-ctr n-releases__more-line' }, textLink(RELEASES.past.more, { onOpen: () => void this.load(true), extraClass: 'releases__more' })));
    this.more.replaceChildren(...out);
    this.more.hidden = out.length === 0;
    if (hadFocus && state === 'failed') this.more.querySelector<HTMLElement>('button')?.focus();
  }

  /** A release ended (C25): its photograph, its kind and date, its title, its model, its quantity, its mark, SEE THE RELEASE. */
  private card(c: PastCardModel): HTMLElement {
    const titleId = `past-${c.id}-title`;
    const link = textLink(RELEASES.see, { href: c.href, onOpen: () => this.deps.onRelease(c.id), extraClass: 'release-card__link' });
    link.setAttribute('aria-describedby', titleId);
    const mark = h('p', { class: 'n-state n-releases__mark release-card__mark', attrs: { hidden: true } });
    this.marks.set(c.id, mark);
    const words = h(
      'div',
      { class: 'n-px n-lift n-releases__words' },
      h('p', { class: 'n-g n-lb release-card__state' }, ...withNumerals([c.kind, c.date].filter(Boolean).join(' · '))),
      h('h2', { class: 'n-g n-t2 n-releases__past-title release-card__title', id: titleId }, ...withNumerals(c.title)),
      c.model ? h('p', { class: 'n-g n-lb n-releases__past-model release-card__model' }, ...withNumerals(c.model)) : null,
      h('p', { class: 'n-g n-lb n-ivc n-releases__past-pieces release-card__line' }, ...withNumerals(c.pieces)),
      mark,
      h('p', { class: 'n-releases__see-line' }, link),
    );
    return h('article', { class: 'release-card release-card--past n-releases__release', attrs: { 'aria-labelledby': titleId } }, ...photographed(c.image, words, { bare: 'n-releases__bare', extraClass: 'n-releases__photo release-card__frame', imgClass: 'release-card__img' }));
  }

  // ── The account's part ──────────────────────────────────────────────────

  /** Signed in: its part in the releases, read again for each account signed in; signed out: none. */
  private onSession(): void {
    if (this.disposed) return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      if (this.part.kind === 'none') void this.readPart();
      return;
    }
    if (s.status === 'anonymous') {
      this.partGen++;
      this.part = { kind: 'none' };
      this.drawPart();
    }
  }

  private async readPart(): Promise<void> {
    const gen = ++this.partGen;
    this.part = { kind: 'loading' };
    try {
      const p = await this.deps.api.participation();
      if (gen !== this.partGen || this.disposed) return;
      this.part = { kind: 'ready', model: participationModel(p) };
    } catch (e) {
      if (gen !== this.partGen || this.disposed) return;
      this.deps.session.noteError(e);
      this.part = this.deps.session.state.status === 'signed-in' ? { kind: 'failed' } : { kind: 'none' };
    }
    this.drawPart();
  }

  private drawPart(): void {
    this.takenError.hidden = this.part.kind !== 'failed';
    this.onTaken();
    this.drawMarks();
  }

  /** Each mark: YOU SECURED A PIECE with its check, or YOU TOOK PART; nothing signed out or for a release not taken part in. */
  private drawMarks(): void {
    const marks = this.part.kind === 'ready' ? this.part.model.marks : null;
    for (const [id, el] of this.marks) {
      const text = marks?.get(id) ?? '';
      if (el.dataset.text !== text) {
        el.dataset.text = text;
        el.replaceChildren(...(text === RELEASES.past.secured ? [icon('check', { small: true })] : []), text);
      }
      el.hidden = text === '';
    }
  }
}

// ── A release ──────────────────────────────────────────────────────────────

type ReleaseLoad = { kind: 'loading' } | { kind: 'ready'; sheet: ReleaseSheetModel } | { kind: 'missing' } | { kind: 'failed'; message: string };
/** The account's entry in this release: not asked yet (signed out), being read, read (null: none), or unreadable. */
type EntryLoad = { kind: 'none' } | { kind: 'loading' } | { kind: 'ready'; entry: ClubEntry | null } | { kind: 'failed'; message: string };
type DrawList = { kind: 'idle' } | { kind: 'loading'; items: DrawEntry[] } | { kind: 'ready'; items: DrawEntry[]; total: number } | { kind: 'failed'; items: DrawEntry[]; message: string };

/** Entries of the draw's list read at a time. */
const DRAW_PAGE = 100;

/**
 * The facts of a release as label and value rows (C19's `.kv`): a label in the display face, its value in the reading
 * face; a time is said in UTC, then on this phone's clock under it.
 */
function releaseRows(rows: readonly ReleaseRow[]): HTMLDListElement {
  return h(
    'dl',
    { class: 'n-release__rows release__rows' },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'n-kv__row n-release__row release__row' },
        h('dt', { class: 'n-g n-kv__label n-release__label release__label', text: r.label }),
        h('dd', { class: 'n-kv__value n-release__value' }, h('span', { class: 'n-num release__utc', text: r.value }), r.local ? h('br') : null, r.local ? h('span', { class: 'n-sm n-num release__local', text: r.local }) : null),
      ),
    ),
  );
}

class ReleasePage {
  readonly root: HTMLElement;
  /** The release's photograph and its words lifted onto it: its collection, its title, its state. */
  private readonly hero = h('section', { class: 'release__head n-release__hero' });
  private readonly body = h('div', { class: 'release__body n-release__body', attrs: { 'aria-live': 'polite' } });
  private readonly entrySection = h('section', { class: 'n-px n-sec n-release__section release__section release__entry', attrs: { 'aria-labelledby': 'release-entry' } });
  private readonly drawSection = h('section', { class: 'n-px n-sec n-release__section release__section release__draw', attrs: { 'aria-labelledby': 'release-draw' } });
  private load: ReleaseLoad = { kind: 'loading' };
  private entry: EntryLoad = { kind: 'none' };
  private draw: DrawList = { kind: 'idle' };
  /** The seed checked on this phone against its fingerprint: null until known. */
  private seedMatches: boolean | null = null;
  private signIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private contacts: ClientServices = {};
  private busy = false;
  private actionError: string | null = null;
  private disposed = false;
  /** Bumped on each read of the account's entry: an older answer is dropped. */
  private entryGen = 0;
  /** The account's tier now, read with its entry (the club's status): PLATINE and PALLADIUM reserve during the early access. */
  private tier = 0;
  /** Drawn: the account's part in the release, read with its entry; null when none (or when it could not be read). */
  private part: string | null = null;
  /** What the hero was drawn from: drawn again only when it changes (the photograph is not loaded again). */
  private heroKey = '';

  constructor(private readonly deps: ReleaseDeps) {
    this.root = viewRoot('release', 'release-title');
    this.root.classList.add('n-release');
    const crumb = appAnchor(RELEASES_PATH, ['n-g', 'n-crumb', 'release__crumb'], () => deps.onReleases(), icon('back', { small: true }), RELEASES.link);
    this.root.append(crumb, this.hero, this.body);
    this.unsubscribe = deps.session.subscribe(() => this.onSession());
    this.render();
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signIn?.dispose();
    this.signIn = null;
  }

  private async start(): Promise<void> {
    const id = this.deps.id;
    if (id === null) {
      this.load = { kind: 'missing' };
      this.render();
      return;
    }
    if (this.load.kind !== 'loading') {
      this.load = { kind: 'loading' };
      this.render();
    }
    try {
      const [sheet, contacts] = await Promise.all([this.deps.api.drop(id), this.deps.clientServices()]);
      if (this.disposed) return;
      this.contacts = contacts;
      this.load = { kind: 'ready', sheet: releaseSheet(sheet, this.deps.offsetMinutes) };
    } catch (e) {
      if (this.disposed) return;
      this.load = e instanceof ApiError && e.status === 404 ? { kind: 'missing' } : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    if (s.drawn) {
      void this.checkSeed(s);
      void this.moreEntries();
    }
    await this.deps.session.ensure().catch(() => undefined);
    if (!this.disposed) this.onSession();
  }

  /** The session changed (signed in with this page's form, elsewhere, or ended): the account's entry follows. */
  private onSession(): void {
    if (this.disposed || this.load.kind !== 'ready') return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      this.signIn?.dispose();
      this.signIn = null;
      if (this.entry.kind === 'none') void this.readEntry();
    } else {
      this.entryGen++;
      this.entry = { kind: 'none' };
      this.tier = 0;
      this.part = null;
      this.actionError = null;
    }
    this.render();
  }

  private async readEntry(): Promise<void> {
    if (this.load.kind !== 'ready') return;
    const id = this.load.sheet.id;
    const gen = ++this.entryGen;
    this.entry = { kind: 'loading' };
    this.render();
    try {
      // Drawn, the release is over: the account's part in it too (left unsaid should it not be read).
      const [status, part] = await Promise.all([this.deps.api.clubStatus(), this.load.sheet.drawn ? this.deps.api.participation().catch(() => null) : null]);
      if (gen !== this.entryGen || this.disposed) return;
      this.part = part ? (participationModel(part).marks.get(id) ?? null) : null;
      this.tier = Number(status.tier?.level) || 0;
      this.entry = { kind: 'ready', entry: status.entries.find((e) => e.dropId === id) ?? null };
    } catch (e) {
      if (gen !== this.entryGen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.entry = { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /** The draw's list, a hundred entries more at each SHOW MORE. */
  private async moreEntries(): Promise<void> {
    if (this.load.kind !== 'ready' || this.draw.kind === 'loading') return;
    const id = this.load.sheet.id;
    const items = this.draw.kind === 'idle' ? [] : this.draw.items;
    this.draw = { kind: 'loading', items };
    this.renderDraw();
    try {
      const page = await this.deps.api.drawEntries(id, Math.floor(items.length / DRAW_PAGE) + 1, DRAW_PAGE);
      if (this.disposed) return;
      this.draw = { kind: 'ready', items: [...items, ...page.items], total: page.total };
    } catch (e) {
      if (this.disposed) return;
      this.draw = { kind: 'failed', items, message: messageOf(e) };
    }
    this.renderDraw();
  }

  /** The seed's SHA-256, computed on this phone, against the fingerprint published with the release. */
  private async checkSeed(s: ReleaseSheetModel): Promise<void> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !s.seedHex || !s.seedHashHex) return;
    try {
      const bytes = new Uint8Array(s.seedHex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)));
      const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
      if (this.disposed) return;
      this.seedMatches = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('') === s.seedHashHex;
    } catch {
      return;
    }
    this.renderDraw();
  }

  private async act(kind: 'enter' | 'withdraw' | 'reserve'): Promise<void> {
    if (this.busy || this.load.kind !== 'ready') return;
    const id = this.load.sheet.id;
    this.busy = true;
    this.actionError = null;
    this.renderEntry();
    try {
      const api = this.deps.api;
      const entry = kind === 'enter' ? await api.enterDrop(id) : kind === 'withdraw' ? await api.withdrawDrop(id) : await api.reserveDrop(id);
      if (this.disposed) return;
      this.entry = { kind: 'ready', entry };
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.actionError = messageOf(e);
    } finally {
      this.busy = false;
    }
    // A reservation, made or refused (every piece held, the early access over), changes the release's places: read again.
    if (kind === 'reserve') await this.refreshSheet();
    if (this.disposed) return;
    this.render();
    // Keyboard focus on what the page now says of the entry.
    this.root.querySelector<HTMLElement>('#release-entry')?.focus({ preventScroll: true });
  }

  /** The release read again (its places, its state), the page as it was otherwise; kept as it was if it cannot be read. */
  private async refreshSheet(): Promise<void> {
    if (this.load.kind !== 'ready') return;
    try {
      const sheet = await this.deps.api.drop(this.load.sheet.id);
      if (this.disposed || this.load.kind !== 'ready') return;
      this.load = { kind: 'ready', sheet: releaseSheet(sheet, this.deps.offsetMinutes) };
    } catch {
      return;
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    if (l.kind !== 'ready') {
      this.heroKey = l.kind;
      // The page's title while there is no release to name yet: THE RELEASES, and its state under it (C40). An address that
      // leads nowhere has none: its sentence alone names the page, as a model's and a post's do (C40, state 4).
      if (l.kind === 'missing') this.hero.replaceChildren();
      else this.hero.replaceChildren(h('div', { class: 'n-px n-release__plain' }, h('h1', { class: 'n-g n-t1 release__title', id: 'release-title', text: RELEASES.title })));
    }
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(RELEASES.loading, { extraClass: 'releases__waiting n-releases__state' }));
      return;
    }
    if (l.kind === 'missing') {
      // C40: the sentence alone on the margin, 22 px under ‹ THE RELEASES.
      const line = quietLine(RELEASES.notFound, 'release__missing');
      line.id = 'release-title';
      this.body.replaceChildren(h('div', { class: 'n-px n-release__missing' }, line));
      // The focus the page's title had (gone with it) comes to the sentence, never taken from the chrome.
      const active = document.activeElement;
      if (active === null || active === document.body || this.root.contains(active)) {
        line.tabIndex = -1;
        line.focus({ preventScroll: true });
      }
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(h('div', { class: 'n-px n-releases__state' }, failedState({ sentence: RELEASES.loadFailed, reason: l.message, retry: RELEASES.retry, onRetry: () => void this.start(), retryClass: 'release__retry' })));
      if (hadFocus) this.body.querySelector<HTMLElement>('.release__retry')?.focus();
      return;
    }
    const s = l.sheet;
    this.root.dataset.release = s.state.toLowerCase();
    this.renderHero(s);

    const sections: (HTMLElement | null)[] = [];
    // Drawn, the release is over (decision 30): said on a plate under its title, as a LIVE RELEASE's final page (C29).
    if (s.drawn) sections.push(h('div', { class: 'n-nx n-release__over' }, h('p', { class: 'n-g n-t3 n-ivc release__state', text: RELEASES.over })));
    const description = storyBlock(s.description, { className: 'n-release__description release__description', paragraphClass: 'n-tx release__paragraph' });
    const see = s.lookbookSlug ? appAnchor(lookbookSheetPath(s.lookbookSlug), ['n-release__see', 'release__see-model'], () => this.deps.onModel(s.lookbookSlug!), LOOKBOOK.seeModel) : null;
    sections.push(
      h(
        'section',
        { class: 'n-px n-sec n-release__section release__section', attrs: { 'aria-labelledby': 'release-facts' } },
        h('h2', { class: 'n-g n-t3', id: 'release-facts', text: RELEASES.section.release }),
        description,
        h('p', { class: 'n-g n-lb n-release__model release__model' }, ...withNumerals(s.model), see ? '   ' : null, see),
        releaseRows(s.rows),
        s.earlyNote ? h('p', { class: 'n-sm n-release__early release__early', text: s.earlyNote }) : null,
      ),
    );
    sections.push(this.entrySection, this.drawSection);
    this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
    this.renderEntry();
    this.renderDraw();
  }

  /**
   * The hero (C19): the model's photograph, faded; its collection (or model), its title (the model's name on a line of
   * its own), its state and, with an early access, its two openings in UTC; drawn, the account's part in it (C29).
   */
  private renderHero(s: ReleaseSheetModel): void {
    const key = JSON.stringify([s.id, s.image, s.eyebrow, s.title, s.stateLabel, s.access, s.drawn, this.part]);
    if (key === this.heroKey) return;
    this.heroKey = key;
    const title = modelTitle('h1', ['n-g', 'n-t1', 'n-release__title', 'release__title'], s.title, modelName(s.model));
    title.id = 'release-title';
    const words = h(
      'div',
      { class: 'n-px n-ctr n-lift n-release__words' },
      h('p', { class: 'n-g n-lb release__eyebrow' }, ...withNumerals(s.eyebrow)),
      title,
      s.drawn ? null : h('p', { class: 'n-g n-lb n-ivc n-release__state release__state', text: s.stateLabel }),
      s.access ? timedAccess(s.access) : null,
      s.drawn && this.part ? h('p', { class: 'n-state n-release__part release__part' }, ...(this.part === RELEASES.past.secured ? [icon('check', { small: true })] : []), this.part) : null,
    );
    this.hero.replaceChildren(...photographed(s.image, words, { eager: true, bare: 'n-release__bare', extraClass: 'n-release__photo release__photo', imgClass: 'release__img' }));
  }

  /** YOUR ENTRY: the sign-in when signed out, else what the entry means now and the one action it allows. */
  private renderEntry(): void {
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    if (s.drawn) this.renderHero(s);
    const hadFocus = this.entrySection.contains(document.activeElement);
    const session = this.deps.session.state;
    const heading = h('h2', { class: 'n-g n-t3', id: 'release-entry', text: RELEASES.section.entry });
    heading.tabIndex = -1;
    const out: (HTMLElement | null)[] = [heading];
    if (session.status !== 'signed-in') {
      // No account needed to read; ENTER THE DRAW needs one (any): the OWNERSHIP panel's sign-in and CREATE ACCOUNT.
      if (s.state === 'OPEN' || s.state === 'UPCOMING') {
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: RELEASES.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        out.push(h('div', { class: 'n-release__signin release__signin' }, this.signIn.root));
      } else {
        out.push(this.sentence(entryModel(this.releaseOf(s), null, this.entryOpts())));
      }
    } else if (this.entry.kind === 'loading' || this.entry.kind === 'none') {
      out.push(h('p', { class: 'n-g n-lb n-ivc n-release__waiting', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
    } else if (this.entry.kind === 'failed') {
      out.push(
        h('p', { class: 'n-sm n-ivc n-release__error form__error', attrs: { role: 'alert' }, text: `${RELEASES.entryFailed} ${this.entry.message}` }),
        h('p', { class: 'n-release__retry-line' }, textLink(RELEASES.retry, { onOpen: () => void this.readEntry(), extraClass: 'release__retry-entry' })),
      );
    } else {
      const m = entryModel(this.releaseOf(s), this.entry.entry, this.entryOpts());
      out.push(this.sentence(m));
      if (m.entryId) out.push(h('p', { class: 'n-sm n-num n-release__entry-id release__entry-id', text: RELEASES.entryId(m.entryId) }));
      if (this.actionError) out.push(h('p', { class: 'n-sm n-ivc n-release__error form__error', attrs: { role: 'alert' }, text: this.actionError }));
      // The one filled button of the page: ENTER THE DRAW, or RESERVE A PLACE (P-X02, a PLATINE or PALLADIUM account
      // during the early access); should both be offered, the second is a hairline button.
      let filled = true;
      const action = (label: string, cls: string, run: () => void, outline = false) => {
        const b = button(label, { outline: outline || !filled, extraClass: `n-release__action ${cls}`, onClick: run, attrs: { disabled: this.busy, 'aria-busy': this.busy ? 'true' : 'false' } });
        if (!outline) filled = false;
        return b;
      };
      if (m.canEnter) out.push(action(RELEASES.enter, 'release__enter', () => void this.act('enter')));
      if (m.canReserve) out.push(action(RELEASES.reserve, 'release__reserve', () => void this.act('reserve')));
      if (m.canWithdraw) out.push(action(RELEASES.withdraw, 'release__withdraw', () => void this.act('withdraw'), true));
      if (m.contact) out.push(contactLines(m.contact, { action: CONTACT.action, call: CONTACT.call }));
    }
    this.entrySection.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    if (hadFocus && !this.entrySection.contains(document.activeElement)) (this.entrySection.querySelector<HTMLElement>('input, button:not([disabled])') ?? heading).focus({ preventScroll: true });
  }

  /** What the entry means now: its status (ENTERED, PLACE HELD…) in ivory capitals, then its sentence. */
  private sentence(m: EntryModel): HTMLElement {
    return h('div', { class: 'n-release__status release__status' }, m.label ? h('p', { class: 'n-g n-t3 n-ivc n-release__status-label ownership__status', text: m.label }) : null, h('p', { class: 'n-tx n-release__sentence release__sentence', text: m.sentence }));
  }

  private releaseOf(s: ReleaseSheetModel) {
    return { id: s.id, title: s.title, state: s.state, opensAt: s.opensAt, earlyAccess: s.earlyAccess, full: s.full };
  }

  private entryOpts() {
    return { offsetMinutes: this.deps.offsetMinutes, clientServices: this.contacts, tier: this.tier };
  }

  /** THE DRAW: what a place drawn obliges to, its rule and commitment, the seed's fingerprint; once drawn, the seed, the phone's check and the entries by rank. */
  private renderDraw(): void {
    if (this.load.kind !== 'ready') return;
    const s = this.load.sheet;
    const hadFocus = this.drawSection.contains(document.activeElement);
    const facts: { label: string; value: string }[] = [{ label: RELEASES.seedHash, value: s.seedHashHex }];
    if (s.seedHex) facts.push({ label: RELEASES.seed, value: s.seedHex });
    const out: (HTMLElement | null)[] = [
      h('h2', { class: 'n-g n-t3', id: 'release-draw', text: RELEASES.section.draw }),
      h('p', { class: 'n-sm n-release__para release__obligation', text: RELEASES.noObligation }),
      h('p', { class: 'n-sm n-release__para release__rule', text: RELEASES.rule }),
      h('p', { class: 'n-sm n-release__para release__commitment', text: RELEASES.commitment }),
      h(
        'dl',
        { class: 'n-release__seed release__seed' },
        ...facts.map((f) => h('div', { class: 'n-release__seed-fact' }, h('dt', { class: 'n-g n-lb n-release__seed-label', text: f.label }), h('dd', { class: 'n-sm n-num n-release__hex release__hex', text: f.value }))),
      ),
    ];
    if (s.drawn && this.seedMatches !== null) {
      out.push(h('p', { class: 'n-sm n-ivc n-release__check release__check', attrs: { role: 'status' }, text: this.seedMatches ? RELEASES.seedChecked : RELEASES.seedMismatch }));
    }
    if (s.drawn) out.push(...this.drawList());
    this.drawSection.replaceChildren(...out.filter((x): x is HTMLElement => x !== null));
    if (hadFocus && !this.drawSection.contains(document.activeElement)) this.drawSection.querySelector<HTMLElement>('.release__more, .release__retry-draw')?.focus({ preventScroll: true });
  }

  /** THE ENTRIES: every entry the draw ranked, in its order, the account's own marked YOURS; SHOW MORE a hundred at a time. */
  private drawList(): HTMLElement[] {
    const d = this.draw;
    const items = d.kind === 'idle' ? [] : d.items;
    const yours = this.entry.kind === 'ready' && this.entry.entry ? this.entry.entry.id : null;
    const lines = drawLines(items, yours);
    const out: HTMLElement[] = [h('h3', { class: 'n-g n-t3 n-release__entries', id: 'release-entries', text: RELEASES.section.entries }), h('p', { class: 'n-sm n-release__para release__entries-lead', text: RELEASES.entriesLead })];
    if (lines.length > 0) {
      out.push(
        h(
          'ol',
          { class: 'n-release__list release__list', attrs: { 'aria-labelledby': 'release-entries' } },
          ...lines.map((l) =>
            h(
              'li',
              { class: ['n-release__item', 'release__item', l.yours ? 'is-yours' : null], data: { rank: String(l.rank) } },
              h('span', { class: 'n-g n-lb n-release__item-line release__item-line' }, ...withNumerals(l.line)),
              h('span', { class: 'n-sm n-num n-release__item-id release__item-id', text: l.id }),
              l.yours ? h('span', { class: 'n-g n-lb n-ivc n-release__item-yours release__item-yours', text: RELEASES.yours }) : null,
            ),
          ),
        ),
      );
    }
    if (d.kind === 'loading') out.push(h('p', { class: 'n-g n-lb n-ivc n-release__waiting', attrs: { 'aria-busy': 'true' }, text: RELEASES.loading }));
    if (d.kind === 'failed') {
      out.push(
        h('p', { class: 'n-sm n-ivc n-release__error form__error', attrs: { role: 'alert' }, text: `${RELEASES.entriesFailed} ${d.message}` }),
        h('p', { class: 'n-release__retry-line' }, textLink(RELEASES.retry, { onOpen: () => void this.moreEntries(), extraClass: 'release__retry-draw' })),
      );
    }
    if (d.kind === 'ready' && d.items.length < d.total) {
      out.push(h('p', { class: 'n-release__more-line' }, textLink(RELEASES.more, { onOpen: () => void this.moreEntries(), extraClass: 'release__more' })));
    }
    return out;
  }
}

/** P-X02's line under the state: its times in UTC, each kept whole on its line. */
function timedAccess(line: string): HTMLParagraphElement {
  const parts = line.split(/(\d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2})/);
  return h('p', { class: 'n-g n-lb n-num n-release__access release__access' }, ...parts.flatMap((p, i) => (p === '' ? [] : i % 2 === 1 ? [h('span', { class: 'n-nw' }, ...withNumerals(p))] : withNumerals(p))));
}
