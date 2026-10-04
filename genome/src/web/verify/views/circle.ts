/**
 * THE CIRCLE (P-X01): what ORBES publishes for the owners of a piece,
 * /verify/circle, and a post, /verify/circle/<id>.
 *
 *              ORBES                         small wordmark
 *            T H E   C I R C L E             the page's title
 *   For the owners of an ORBES piece: …
 *   EARLY ACCESS                             the privilege of PLATINE and PALLADIUM in the
 *   PLATINE and PALLADIUM owners reserve …   releases (P-X02), recalled above the feed
 *   ┌                              ┐
 *     [ photo ]                              ivory plates, one per post: its
 *     INVITATION · PLATINE AND PALLADIUM     kind (and the tiers it is kept
 *     DINNER AT THE ATELIER                  for), its title, its day, an
 *     3 OCT 2026                             invitation's event (UTC), what
 *     12 OCT 2026 · 19:00 UTC · PARIS        the reader did, and its one
 *     YOU ANSWERED YES                       text link
 *     SEE THE INVITATION
 *   └                              ┘
 *               SHOW MORE                    the next page of the feed
 *            [ SCAN ORBES CODE ]
 *   THE RELEASES · THE COLLECTION · MY PIECES
 *   PRIVACY · TERMS · LEGAL · HELP
 *
 * Signed out, the OWNERSHIP panel's sign-in (its account mode) under one
 * sentence; signed in without a piece, the sentence that the circle opens
 * once a piece is registered (403 OWNERS_ONLY). The feed carries no body: a
 * post does.
 *
 * A post: its kind (and tiers), its title and day; its photographs on an
 * ivory plate (the first loaded at once, the others lazily); its text (plain
 * paragraphs, shared/lookbook.ts); THE INVITATION (WHEN in UTC then on this
 * phone, WHERE, PLACES), then YOUR ANSWER: YES · NO, pressed like the
 * sign-in's options (.auth__option), changed until the event begins; THE POLL:
 * its options, one chosen then VOTE (the page's hairline button while it is
 * offered: a vote is final), then the results; TO SEE: a release's page, a
 * model's sheet, a link to another site with its host beside it (a new tab,
 * noopener noreferrer). At the foot, THE CIRCLE, back to the feed.
 *
 * Every action is a same-origin JSON call through ApiClient (the session
 * cookie, the CSRF token); server messages are shown as they come. A 401 ends
 * the session on the page, which then offers the sign-in again.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { circleCards, circlePostModel, type CircleCardModel, type CirclePhotoModel, type CirclePostModel } from '../circle-model.js';
import { CIRCLE, RELEASES } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { CircleAnswer, CircleCard } from '../types.js';
import { circleLink, legalLinks, lookbookLink, piecesLink, releasesLink, sectionLabel, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { OwnershipPanel } from './ownership.js';

export interface CircleView {
  root: HTMLElement;
  dispose(): void;
}

export interface CircleDeps {
  api: ApiClient;
  session: SessionStore;
  /** SCAN ORBES CODE, the page's hairline button. */
  onScan(): void;
  /** Open a post in the app. */
  onPost(id: string): void;
  onReleases(): void;
  onCollection(): void;
  onPieces(): void;
}

export interface CirclePostDeps {
  api: ApiClient;
  session: SessionStore;
  /** The post's id; null when the address names none (the page says it is not in the circle). */
  id: string | null;
  onScan(): void;
  /** THE CIRCLE: back to the feed. */
  onCircle(): void;
  /** SEE THE RELEASE: a release's page. */
  onRelease(id: string): void;
  /** SEE THE MODEL: its sheet in THE COLLECTION. */
  onModel(slug: string): void;
  /** Minutes east of UTC of this phone's clock. */
  offsetMinutes: number;
}

export function circleView(deps: CircleDeps): CircleView {
  const page = new FeedPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

export function circlePostView(deps: CirclePostDeps): CircleView {
  const page = new PostPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

/** The small wordmark that opens every page of the app but the landing. */
const wordmark = (extraClass: string) => h('span', { class: `wordmark wordmark--small ${extraClass}`, attrs: { 'aria-hidden': 'true' }, text: 'ORBES' });

/** A photograph of a post: contained, never cropped; one that cannot be loaded takes its frame with it, and the plate when none is left. */
function photo(p: CirclePhotoModel, className: string, eager = false): HTMLImageElement {
  const img = h('img', { class: className, attrs: { src: p.src, alt: p.alt, decoding: 'async', loading: eager ? 'eager' : 'lazy' } });
  img.addEventListener(
    'error',
    () => {
      img.closest<HTMLElement>('[data-photo]')?.setAttribute('hidden', '');
      const plate = img.closest<HTMLElement>('[data-photos]');
      if (plate && !plate.querySelector('[data-photo]:not([hidden])')) plate.hidden = true;
    },
    { once: true },
  );
  return img;
}

/** The kind of a post, and the tiers it is kept for when they are not every owner's. */
const kindLine = (m: { kindLabel: string; reach: string | null }) => [m.kindLabel, m.reach].filter(Boolean).join(' · ');

// ── The feed ───────────────────────────────────────────────────────────────

type FeedLoad =
  | { kind: 'waiting' }
  | { kind: 'signed-out' }
  | { kind: 'owners-only' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: CircleCard[]; total: number; more: 'idle' | 'loading' | 'failed' }
  | { kind: 'failed'; message: string };

/** Posts read at a time. */
const FEED_PAGE = 20;

class FeedPage {
  readonly root: HTMLElement;
  private readonly body = h('div', { class: 'circle__body', attrs: { 'aria-live': 'polite' } });
  private load: FeedLoad = { kind: 'waiting' };
  private signIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private disposed = false;
  /** Bumped on each read of the feed: an older answer is dropped. */
  private gen = 0;

  constructor(private readonly deps: CircleDeps) {
    this.root = viewRoot('circle', 'circle-title');
    this.root.append(
      h('header', { class: 'circle__head' }, wordmark('circle__wordmark'), h('h1', { class: 'circle__title', id: 'circle-title', text: CIRCLE.title }), h('p', { class: 'prose circle__lead', text: CIRCLE.lead })),
      this.body,
      h(
        'footer',
        { class: 'circle__foot' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => deps.onScan() }, text: CIRCLE.scan }),
        releasesLink(() => deps.onReleases(), { extraClass: 'circle__releases' }),
        lookbookLink(() => deps.onCollection(), { extraClass: 'circle__collection' }),
        piecesLink(() => deps.onPieces(), 'circle__pieces'),
        legalLinks({ newTab: true, extraClass: 'circle__legal' }),
      ),
    );
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
    await this.deps.session.ensure().catch(() => undefined);
    if (!this.disposed) this.onSession();
  }

  /**
   * Signed in (here or elsewhere): the feed; signed out, or a session that could not be read (offline: the panel says
   * so when its form is sent): the sign-in.
   */
  private onSession(): void {
    if (this.disposed) return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      this.signIn?.dispose();
      this.signIn = null;
      if (this.load.kind === 'waiting' || this.load.kind === 'signed-out') void this.fetch();
      return;
    }
    this.gen++;
    this.load = { kind: 'signed-out' };
    this.render();
  }

  private async fetch(): Promise<void> {
    const gen = ++this.gen;
    this.load = { kind: 'loading' };
    this.render();
    try {
      const feed = await this.deps.api.circle(1, FEED_PAGE);
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'ready', items: feed.items, total: feed.total, more: 'idle' };
    } catch (e) {
      if (gen !== this.gen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = e instanceof ApiError && e.code === 'OWNERS_ONLY' ? { kind: 'owners-only' } : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /** SHOW MORE: the next page, after the posts already shown. */
  private async more(): Promise<void> {
    const l = this.load;
    if (l.kind !== 'ready' || l.more === 'loading') return;
    const gen = this.gen;
    this.load = { ...l, more: 'loading' };
    this.render();
    try {
      const feed = await this.deps.api.circle(Math.floor(l.items.length / FEED_PAGE) + 1, FEED_PAGE);
      if (gen !== this.gen || this.disposed) return;
      const known = new Set(l.items.map((c) => c.id));
      this.load = { kind: 'ready', items: [...l.items, ...feed.items.filter((c) => !known.has(c.id))], total: feed.total, more: 'idle' };
    } catch (e) {
      if (gen !== this.gen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load = { ...l, more: 'failed' };
    }
    this.render();
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    switch (l.kind) {
      case 'waiting':
      case 'loading':
        this.body.replaceChildren(h('p', { class: 'circle__waiting micro', attrs: { 'aria-busy': 'true' }, text: CIRCLE.loading }));
        return;
      case 'signed-out':
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: CIRCLE.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        this.body.replaceChildren(h('div', { class: 'circle__signin' }, this.signIn.root));
        return;
      case 'owners-only':
        this.body.replaceChildren(h('p', { class: 'prose circle__closed', text: CIRCLE.ownersOnly }));
        return;
      case 'failed':
        this.body.replaceChildren(
          h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${CIRCLE.loadFailed} ${l.message}` }),
          h('button', { class: 'textlink circle__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: CIRCLE.retry }),
        );
        if (hadFocus) this.body.querySelector<HTMLElement>('.circle__retry')?.focus();
        return;
      default: {
        const cards = circleCards(l.items);
        // P-X02: the early access of PLATINE and PALLADIUM in the releases, recalled to the owners above their feed.
        const out: HTMLElement[] = [
          h(
            'section',
            { class: 'circle__early', attrs: { 'aria-labelledby': 'circle-early' } },
            sectionLabel(RELEASES.earlyAccess.label, 'circle-early'),
            h('p', { class: 'prose circle__early-text', text: RELEASES.earlyAccess.recall }),
          ),
        ];
        if (cards.length === 0) out.push(h('p', { class: 'prose circle__empty', text: CIRCLE.empty }));
        else out.push(h('ul', { class: 'circle__list' }, ...cards.map((c) => h('li', { class: 'circle__item' }, this.card(c)))));
        if (l.more === 'failed') out.push(h('p', { class: 'form__error', attrs: { role: 'alert' }, text: CIRCLE.moreFailed }));
        if (l.more === 'loading') out.push(h('p', { class: 'circle__waiting micro', attrs: { 'aria-busy': 'true' }, text: CIRCLE.loading }));
        else if (l.items.length < l.total) out.push(h('button', { class: 'textlink circle__more', attrs: { type: 'button' }, on: { click: () => void this.more() }, text: l.more === 'failed' ? CIRCLE.retry : CIRCLE.more }));
        this.body.replaceChildren(...out);
        if (hadFocus && !this.body.contains(document.activeElement)) this.body.querySelector<HTMLElement>('.circle__more, .circle__item:last-child .circle-card__link')?.focus({ preventScroll: true });
      }
    }
  }

  private card(c: CircleCardModel): HTMLElement {
    const id = `circle-${c.id}`;
    const link = circleLink(() => this.deps.onPost(c.id), { id: c.id, label: c.linkLabel, extraClass: 'circle-card__link' });
    // Which post a link opens: its title, for a screen reader moving from link to link.
    link.setAttribute('aria-describedby', `${id}-title`);
    return bracket(
      h(
        'article',
        { class: 'circle-card', data: { kind: c.kind.toLowerCase() }, attrs: { 'aria-labelledby': `${id}-title` } },
        c.image ? h('div', { class: 'circle-card__frame', data: { photo: '' } }, photo(c.image, 'circle-card__img')) : null,
        h('p', { class: 'circle-card__kind', text: kindLine(c) }),
        h('h2', { class: 'circle-card__title', id: `${id}-title` }, ...withNumerals(c.title)),
        h('p', { class: 'circle-card__date micro', text: c.date }),
        c.event ? h('p', { class: 'circle-card__event micro', text: c.event }) : null,
        c.mine ? h('p', { class: 'circle-card__mine micro', text: c.mine }) : null,
        link,
      ),
    );
  }
}

// ── A post ─────────────────────────────────────────────────────────────────

type PostLoad =
  | { kind: 'waiting' }
  | { kind: 'signed-out' }
  | { kind: 'owners-only' }
  | { kind: 'loading' }
  | { kind: 'ready'; post: CirclePostModel }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string };

class PostPage {
  readonly root: HTMLElement;
  private readonly eyebrow = h('p', { class: 'circle-post__kind', attrs: { hidden: true } });
  private readonly title = h('h1', { class: 'circle-post__title', id: 'circle-post-title', text: CIRCLE.title });
  private readonly date = h('p', { class: 'circle-post__date micro', attrs: { hidden: true } });
  private readonly body = h('div', { class: 'circle-post__body', attrs: { 'aria-live': 'polite' } });
  private readonly foot = h('footer', { class: 'circle-post__foot' });
  private load: PostLoad = { kind: 'waiting' };
  private signIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private disposed = false;
  private busy = false;
  private actionError: string | null = null;
  /** The option chosen before VOTE. */
  private choice: number | null = null;
  private gen = 0;

  constructor(private readonly deps: CirclePostDeps) {
    this.root = viewRoot('circle-post', 'circle-post-title');
    this.root.append(h('header', { class: 'circle-post__head' }, wordmark('circle-post__wordmark'), this.eyebrow, this.title, this.date), this.body, this.foot);
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
    if (this.deps.id === null) {
      this.load = { kind: 'missing' };
      this.render();
      return;
    }
    await this.deps.session.ensure().catch(() => undefined);
    if (!this.disposed) this.onSession();
  }

  /** As the feed's: signed in, the post; otherwise the sign-in. */
  private onSession(): void {
    if (this.disposed || this.load.kind === 'missing') return;
    const s = this.deps.session.state;
    if (s.status === 'signed-in') {
      this.signIn?.dispose();
      this.signIn = null;
      if (this.load.kind === 'waiting' || this.load.kind === 'signed-out') void this.fetch();
      return;
    }
    this.gen++;
    this.load = { kind: 'signed-out' };
    this.actionError = null;
    this.render();
  }

  private async fetch(): Promise<void> {
    const id = this.deps.id;
    if (id === null) return;
    const gen = ++this.gen;
    this.load = { kind: 'loading' };
    this.render();
    try {
      const post = circlePostModel(await this.deps.api.circlePost(id), this.deps.offsetMinutes);
      if (gen !== this.gen || this.disposed) return;
      this.load = { kind: 'ready', post };
    } catch (e) {
      if (gen !== this.gen || this.disposed) return;
      this.deps.session.noteError(e);
      if (this.deps.session.state.status !== 'signed-in') return;
      this.load =
        e instanceof ApiError && e.code === 'OWNERS_ONLY'
          ? { kind: 'owners-only' }
          : e instanceof ApiError && e.status === 404
            ? { kind: 'missing' }
            : { kind: 'failed', message: messageOf(e) };
    }
    this.render();
  }

  /** YES or NO to the invitation, or the vote: one request at a time, then the post as the server now holds it. */
  private async act(kind: 'answer' | 'vote', value: CircleAnswer | number): Promise<void> {
    const l = this.load;
    if (this.busy || l.kind !== 'ready') return;
    this.busy = true;
    this.actionError = null;
    this.render();
    let refresh = false;
    try {
      const post = kind === 'answer' ? await this.deps.api.circleAnswer(l.post.id, value as CircleAnswer) : await this.deps.api.circleVote(l.post.id, value as number);
      if (this.disposed) return;
      this.load = { kind: 'ready', post: circlePostModel(post, this.deps.offsetMinutes) };
      this.choice = null;
    } catch (e) {
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.actionError = messageOf(e);
      // Refused by what changed meanwhile (the places taken, the event begun, a vote cast elsewhere): read the post again.
      refresh = e instanceof ApiError && e.status === 409;
    } finally {
      this.busy = false;
    }
    if (refresh && this.deps.id) {
      try {
        const post = circlePostModel(await this.deps.api.circlePost(this.deps.id), this.deps.offsetMinutes);
        if (!this.disposed) this.load = { kind: 'ready', post };
      } catch (e) {
        this.deps.session.noteError(e);
      }
    }
    if (this.disposed) return;
    this.render();
    // Keyboard focus on what the page now says of the answer or the vote.
    this.root.querySelector<HTMLElement>(kind === 'answer' ? '#circle-answer' : '#circle-poll')?.focus({ preventScroll: true });
  }

  private choose(index: number): void {
    this.choice = index;
    this.actionError = null;
    this.render();
    this.root.querySelector<HTMLElement>(`.circle-post__options [data-option="${index}"]`)?.focus();
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind;
    let offersVote = false;
    if (l.kind !== 'ready') {
      this.eyebrow.hidden = true;
      this.date.hidden = true;
      this.title.textContent = CIRCLE.title;
    }
    switch (l.kind) {
      case 'waiting':
      case 'loading':
        this.body.replaceChildren(h('p', { class: 'circle__waiting micro', attrs: { 'aria-busy': 'true' }, text: CIRCLE.loading }));
        break;
      case 'signed-out':
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: CIRCLE.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        this.body.replaceChildren(h('div', { class: 'circle__signin' }, this.signIn.root));
        break;
      case 'owners-only':
        this.body.replaceChildren(h('p', { class: 'prose circle__closed', text: CIRCLE.ownersOnly }));
        break;
      case 'missing':
        this.body.replaceChildren(h('p', { class: 'prose circle-post__missing', text: CIRCLE.notFound }));
        break;
      case 'failed':
        this.body.replaceChildren(
          h('p', { class: 'form__error', attrs: { role: 'alert' }, text: `${CIRCLE.loadFailed} ${l.message}` }),
          h('button', { class: 'textlink circle-post__retry', attrs: { type: 'button' }, on: { click: () => void this.fetch() }, text: CIRCLE.retry }),
        );
        if (hadFocus) this.body.querySelector<HTMLElement>('.circle-post__retry')?.focus();
        break;
      default: {
        const p = l.post;
        this.root.dataset.kind = p.kind.toLowerCase();
        this.eyebrow.textContent = kindLine(p);
        this.eyebrow.hidden = false;
        this.title.replaceChildren(...withNumerals(p.title));
        this.date.textContent = p.date;
        this.date.hidden = p.date === '';
        const sections: (HTMLElement | null)[] = [];
        if (p.photos.length > 0) {
          sections.push(
            h(
              'section',
              { class: 'circle-post__photos', attrs: { 'aria-label': CIRCLE.photosLabel(p.title) }, data: { photos: '' } },
              bracket(
                h(
                  'div',
                  { class: ['circle-post__plate', p.photos.length > 1 ? 'circle-post__plate--many' : null] },
                  ...p.photos.map((ph, i) => h('figure', { class: 'circle-photo', data: { photo: '' } }, photo(ph, 'circle-photo__img', i === 0))),
                ),
              ),
            ),
          );
        }
        sections.push(storyBlock(p.body, { className: 'circle-post__text', paragraphClass: 'prose circle-post__paragraph' }));
        if (p.invitation) sections.push(...this.invitation(p));
        if (p.poll) {
          const poll = this.poll(p);
          offersVote = poll.offersVote;
          sections.push(poll.section);
        }
        sections.push(this.links(p));
        this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
      }
    }
    // One hairline button on the page: VOTE while it is offered, SCAN ORBES CODE otherwise.
    this.foot.replaceChildren(
      h('button', { class: `${offersVote ? 'textlink' : 'btn'} circle-post__scan`, attrs: { type: 'button' }, on: { click: () => this.deps.onScan() }, text: CIRCLE.scan }),
      circleLink(() => this.deps.onCircle(), { extraClass: 'circle-post__back' }),
      legalLinks({ newTab: true, extraClass: 'circle-post__legal' }),
    );
    if (hadFocus && !this.body.contains(document.activeElement)) (this.body.querySelector<HTMLElement>('button:not([disabled])') ?? this.body.querySelector<HTMLElement>('.section-label'))?.focus({ preventScroll: true });
  }

  private errorLine(): HTMLElement | null {
    return this.actionError ? h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.actionError }) : null;
  }

  /** THE INVITATION, then YOUR ANSWER: YES · NO while answers are taken. */
  private invitation(p: CirclePostModel): HTMLElement[] {
    const inv = p.invitation!;
    const facts = h(
      'section',
      { class: 'circle-post__section', attrs: { 'aria-labelledby': 'circle-invitation' } },
      sectionLabel(CIRCLE.section.invitation, 'circle-invitation'),
      h(
        'dl',
        { class: 'rows circle-post__rows' },
        ...inv.rows.map((r) =>
          h('div', { class: 'rows__row' }, h('dt', { class: 'rows__label', text: r.label }), h('dd', { class: 'rows__value' }, h('span', { class: 'circle-post__utc', text: r.value }), r.local ? h('span', { class: 'circle-post__local', text: r.local }) : null)),
        ),
      ),
    );
    const heading = sectionLabel(CIRCLE.section.answer, 'circle-answer');
    heading.tabIndex = -1;
    const option = (answer: CircleAnswer, label: string) =>
      h('button', {
        class: 'auth__option circle-post__answer',
        attrs: { type: 'button', 'aria-pressed': inv.answer === answer ? 'true' : 'false', disabled: this.busy || (answer === 'YES' && inv.full) },
        data: { answer },
        on: { click: () => void this.act('answer', answer) },
        text: label,
      });
    const answer = h(
      'section',
      { class: 'circle-post__section circle-post__reply', attrs: { 'aria-labelledby': 'circle-answer' } },
      heading,
      h('p', { class: 'prose circle-post__sentence', text: inv.sentence }),
      inv.open
        ? h(
            'div',
            { class: 'auth__switch circle-post__choice', attrs: { role: 'group', 'aria-label': CIRCLE.answerChoice } },
            option('YES', CIRCLE.yes),
            h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
            option('NO', CIRCLE.no),
          )
        : null,
      this.errorLine(),
    );
    return [facts, answer];
  }

  /** THE POLL: one option chosen, then VOTE (final); once voted, the results, the reader's own marked. */
  private poll(p: CirclePostModel): { section: HTMLElement; offersVote: boolean } {
    const poll = p.poll!;
    const heading = sectionLabel(CIRCLE.section.poll, 'circle-poll');
    heading.tabIndex = -1;
    const out: (HTMLElement | null)[] = [heading, h('p', { class: 'prose circle-post__sentence', text: poll.sentence })];
    let offersVote = false;
    if (poll.results) {
      out.push(
        h(
          'ul',
          { class: 'circle-post__results', attrs: { 'aria-label': CIRCLE.section.poll } },
          ...poll.results.map((r) =>
            h(
              'li',
              { class: ['circle-post__result', r.mine ? 'is-mine' : null] },
              h('span', { class: 'circle-post__result-label' }, ...withNumerals(r.label)),
              h('span', { class: 'circle-post__result-votes', text: `${r.votes} · ${r.share}` }),
              r.mine ? h('span', { class: 'circle-post__result-mine', text: CIRCLE.yourVote }) : null,
            ),
          ),
        ),
      );
    } else {
      offersVote = true;
      out.push(
        h(
          'div',
          { class: 'circle-post__options', attrs: { role: 'group', 'aria-label': CIRCLE.pollChoice } },
          ...poll.options.map((o) =>
            h(
              'button',
              {
                class: 'auth__option circle-post__option',
                attrs: { type: 'button', 'aria-pressed': this.choice === o.index ? 'true' : 'false', disabled: this.busy },
                data: { option: String(o.index) },
                on: { click: () => this.choose(o.index) },
              },
              ...withNumerals(o.label),
            ),
          ),
        ),
        this.errorLine(),
        h('button', {
          class: 'btn circle-post__vote',
          attrs: { type: 'button', disabled: this.busy || this.choice === null, 'aria-busy': this.busy ? 'true' : 'false' },
          on: {
            click: () => {
              if (this.choice !== null) void this.act('vote', this.choice);
            },
          },
          text: CIRCLE.vote,
        }),
      );
    }
    return { section: h('section', { class: 'circle-post__section circle-post__poll', attrs: { 'aria-labelledby': 'circle-poll' } }, ...out.filter((x): x is HTMLElement => x !== null)), offersVote };
  }

  /** TO SEE: a release's page, a model's sheet, a link to another site with its host. */
  private links(p: CirclePostModel): HTMLElement | null {
    const { release, model, external } = p.links;
    if (!release && !model && !external) return null;
    const items: HTMLElement[] = [];
    if (release) items.push(h('li', { class: 'circle-post__link' }, h('span', { class: 'circle-post__link-title' }, ...withNumerals(release.title)), releasesLink(() => this.deps.onRelease(release.id), { id: release.id })));
    if (model) items.push(h('li', { class: 'circle-post__link' }, h('span', { class: 'circle-post__link-title' }, ...withNumerals(model.title)), lookbookLink(() => this.deps.onModel(model.slug), { slug: model.slug })));
    if (external) {
      items.push(
        h(
          'li',
          { class: 'circle-post__link' },
          h('a', { class: 'textlink circle-post__external', attrs: { href: external.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': CIRCLE.externalLabel(external.host) }, text: CIRCLE.openLink }),
          h('span', { class: 'circle-post__host', text: external.host }),
        ),
      );
    }
    return h('section', { class: 'circle-post__section', attrs: { 'aria-labelledby': 'circle-links' } }, sectionLabel(CIRCLE.section.links, 'circle-links'), h('ul', { class: 'circle-post__links' }, ...items));
  }
}
