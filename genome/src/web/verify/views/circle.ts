/**
 * THE CIRCLE (P-X01; plan NOCTURNE, screen 7, step N8): what ORBES publishes for the owners of a piece,
 * /verify/circle, and a post, /verify/circle/<id>, in NOCTURNE's pieces as C8, C22 and C34 draw them.
 *
 *   THE CIRCLE                                   the page's title and its sentence
 *   For the owners of an ORBES piece: …
 *   ──────────────────────────────────
 *   EARLY ACCESS                                 the privilege of PLATINE and PALLADIUM in the releases (P-X02),
 *   PLATINE and PALLADIUM owners reserve …       recalled above the feed between two hairlines
 *   ──────────────────────────────────
 *   [ its photograph, whole, faded ]             each post: its photograph when it has one, its words lifted onto
 *   INVITATION                                   its foot (views/invitation.ts, N3's card on NOW): its kind (and the
 *   AN EVENING AT THE ATELIER                    tiers it is kept for), its title, its day; an invitation's event in
 *   3 OCT 2026                                   UTC, N LEFT OF C and YES / NO, the reader's answer pressed
 *   12 OCT 2026 · 17:00 UTC · PARIS              (addition 6); an invitation without a photograph on a plate card,
 *   3 LEFT OF 12                                 another post on the margin; its one text link
 *   [ YES ]  [  NO  ]
 *   SEE THE INVITATION
 *                 SHOW MORE                      the next page of the feed
 *
 * Signed out, the OWNERSHIP panel's sign-in (its account mode) under its sentence; signed in without a piece, the
 * sentence that the circle opens once a piece is registered (403 OWNERS_ONLY). The rail's CIRCLE and the SCAN ring
 * stand for the page's own foot of before (SCAN ORBES CODE, THE RELEASES, THE COLLECTION, MY PIECES).
 *
 * A post, under ‹ THE CIRCLE: its photographs whole at the column's width, unfaded (the first at once, the others
 * lazily, two side by side under it); its kind, its title, its day and its text (plain paragraphs, shared/lookbook.ts);
 * THE INVITATION (WHEN in UTC then on this phone, WHERE, PLACES), then YOUR ANSWER: its sentence and YES / NO, changed
 * until the event begins; THE POLL: its options, one chosen then VOTE (final), then the results, each with its bar;
 * TO SEE: a release's page, a model's sheet, a link to another site with its host under it (a new tab, noopener
 * noreferrer), each a row that leads on.
 *
 * Every action is a same-origin JSON call through ApiClient (the session cookie, the CSRF token); server messages are
 * shown as they come. A 401 ends the session on the page, which then offers the sign-in again. CSP-safe: h() only,
 * its places by class (verify/styles.css, THE CIRCLE).
 */
import { h } from '../../shared/dom.js';
import { storyBlock } from '../../shared/lookbook.js';
import { ApiError, type ApiClient } from '../api.js';
import { CIRCLE_PATH, circleCards, circlePostModel, type CircleCardModel, type CirclePhotoModel, type CirclePostModel } from '../circle-model.js';
import { CIRCLE, LOOKBOOK, RELEASES } from '../copy.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import { releasePath } from '../releases-model.js';
import type { SessionStore } from '../session.js';
import type { CircleAnswer, CircleCard } from '../types.js';
import { viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { CircleCardLines, kindLine } from './invitation.js';
import { accLink, appAnchor, button, failedState, fadedPhoto, icon, lift, loadingState, plateCard, quietLine } from './nocturne.js';
import { OwnershipPanel } from './ownership.js';

export interface CircleView {
  root: HTMLElement;
  dispose(): void;
}

export interface CircleDeps {
  api: ApiClient;
  session: SessionStore;
  /** The sign-in panel's way back to the scan. */
  onScan(): void;
  /** Open a post in the app. */
  onPost(id: string): void;
}

export interface CirclePostDeps {
  api: ApiClient;
  session: SessionStore;
  /** The post's id; null when the address names none (the page says it is not in the circle). */
  id: string | null;
  onScan(): void;
  /** ‹ THE CIRCLE: back to the feed. */
  onCircle(): void;
  /** A release's page (TO SEE). */
  onRelease(id: string): void;
  /** A model's sheet in THE COLLECTION (TO SEE). */
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

/**
 * A photograph of a post, whole at the column's width (never cropped): faded in the feed, unfaded on the post. One that
 * cannot be loaded takes its frame with it (`onGone`).
 */
function postPhoto(p: CirclePhotoModel, opts: { height: number; fade: boolean; eager?: boolean; extraClass: string; imgClass: string; onGone?: () => void }): HTMLElement {
  const box = fadedPhoto(p.src, p.alt, { height: opts.height, fade: opts.fade, eager: opts.eager, extraClass: opts.extraClass });
  box.dataset.photo = '';
  const img = box.querySelector('img')!;
  img.classList.add(opts.imgClass);
  img.addEventListener(
    'error',
    () => {
      box.hidden = true;
      opts.onGone?.();
    },
    { once: true },
  );
  return box;
}

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
  private readonly body = h('div', { class: 'n-circle__body circle__body', attrs: { 'aria-live': 'polite' } });
  private load: FeedLoad = { kind: 'waiting' };
  private signIn: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null;
  private disposed = false;
  /** Bumped on each read of the feed: an older answer is dropped. */
  private gen = 0;
  /** Each post's card, kept while the feed is the same read (an answer given on one stays when SHOW MORE adds others). */
  private cards = new Map<string, { el: HTMLElement; lines: CircleCardLines }>();

  constructor(private readonly deps: CircleDeps) {
    this.root = viewRoot('circle', 'circle-title');
    this.root.classList.add('n-circle');
    this.root.append(
      h('header', { class: 'n-px n-circle__head' }, h('h1', { class: 'n-g n-t1 circle__title', id: 'circle-title', text: CIRCLE.title }), h('p', { class: 'n-lead n-circle__lead circle__lead', text: CIRCLE.lead })),
      this.body,
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
    this.forget();
  }

  private forget(): void {
    for (const c of this.cards.values()) c.lines.dispose();
    this.cards.clear();
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
    this.forget();
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
      this.forget();
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
        this.body.replaceChildren(loadingState(CIRCLE.loading, { extraClass: 'circle__waiting' }));
        return;
      case 'signed-out':
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: CIRCLE.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        this.body.replaceChildren(h('div', { class: 'n-px circle__signin' }, this.signIn.root));
        return;
      case 'owners-only':
        this.body.replaceChildren(h('div', { class: 'n-px n-circle__quiet' }, quietLine(CIRCLE.ownersOnly, 'circle__closed')));
        return;
      case 'failed':
        this.body.replaceChildren(h('div', { class: 'n-px n-circle__failed' }, failedState({ sentence: CIRCLE.loadFailed, reason: l.message, retry: CIRCLE.retry, onRetry: () => void this.fetch(), retryClass: 'circle__retry' })));
        if (hadFocus) this.body.querySelector<HTMLElement>('.circle__retry')?.focus();
        return;
      default: {
        const cards = circleCards(l.items);
        // P-X02: the early access of PLATINE and PALLADIUM in the releases, recalled to the owners above their feed.
        const out: HTMLElement[] = [
          h(
            'section',
            { class: 'n-px n-circle__early circle__early', attrs: { 'aria-labelledby': 'circle-early' } },
            h('p', { class: 'n-g n-lb circle__early-label', id: 'circle-early', text: RELEASES.earlyAccess.label }),
            h('p', { class: 'n-sm n-circle__early-text circle__early-text', text: RELEASES.earlyAccess.recall }),
          ),
        ];
        if (cards.length === 0) out.push(h('div', { class: 'n-px n-circle__quiet' }, quietLine(CIRCLE.empty, 'circle__empty')));
        else out.push(h('ul', { class: 'n-circle__list circle__list', attrs: { 'aria-label': CIRCLE.postsLabel } }, ...cards.map((c, i) => h('li', { class: ['n-circle__item', 'circle__item', i > 0 ? 'n-sec' : null] }, this.card(c)))));
        if (l.more === 'failed') out.push(h('p', { class: 'n-px n-err form__error n-circle__more-failed', attrs: { role: 'alert' }, text: CIRCLE.moreFailed }));
        if (l.more === 'loading') out.push(h('p', { class: 'n-g n-lb n-ivc n-ctr n-sec circle__waiting', attrs: { role: 'status' }, text: CIRCLE.loading }));
        else if (l.items.length < l.total) {
          out.push(
            h(
              'p',
              { class: 'n-sec n-ctr n-circle__more' },
              h('button', { class: 'n-g n-tl circle__more', attrs: { type: 'button' }, on: { click: () => void this.more() }, text: l.more === 'failed' ? CIRCLE.retry : CIRCLE.more }),
            ),
          );
        }
        this.body.replaceChildren(...out);
        if (hadFocus && !this.body.contains(document.activeElement)) this.body.querySelector<HTMLElement>('.circle__more, .circle__item:last-child .circle-card__link')?.focus({ preventScroll: true });
      }
    }
  }

  /**
   * A post's card: on its photograph (faded, its words lifted onto its foot) when it has one; else an invitation on a
   * plate card (NOW's), another post on the margin. Its lines are views/invitation.ts's, an invitation answered there.
   */
  private card(c: CircleCardModel): HTMLElement {
    const kept = this.cards.get(c.id);
    if (kept) return kept.el;
    const titleId = `circle-${c.id}-title`;
    let host: HTMLElement;
    const parts: HTMLElement[] = [];
    if (c.image) {
      host = lift([], { extraClass: 'n-circle-card__words' });
      // A photograph that cannot be loaded: the words stand on the margin, as a post without one.
      parts.push(postPhoto(c.image, { height: 390, fade: true, extraClass: 'n-circle-card__photo', imgClass: 'circle-card__img', onGone: () => host.classList.remove('n-lift') }), host);
    } else if (c.kind === 'INVITATION') {
      host = plateCard([], { left: true, extraClass: 'n-circle-card__plate' });
      parts.push(host);
    } else {
      host = h('div', { class: 'n-px n-circle-card__words' });
      parts.push(host);
    }
    const el = h('article', { class: 'n-circle-card circle-card', data: { kind: c.kind.toLowerCase() }, attrs: { 'aria-labelledby': titleId } }, ...parts);
    const lines = new CircleCardLines(c, host, { api: this.deps.api, session: this.deps.session, onPost: (id) => this.deps.onPost(id) }, { heading: 'h2', titleId });
    this.cards.set(c.id, { el, lines });
    return el;
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
  private readonly body = h('div', { class: 'n-post__body circle-post__body', attrs: { 'aria-live': 'polite' } });
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
    this.root.classList.add('n-post');
    this.root.append(appAnchor(CIRCLE_PATH, ['n-g', 'n-crumb', 'n-post__crumb', 'circle-post__back'], () => deps.onCircle(), icon('back', { small: true }), CIRCLE.link), this.body);
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
    delete this.root.dataset.kind;
    switch (l.kind) {
      case 'waiting':
      case 'loading':
        this.body.replaceChildren(loadingState(CIRCLE.loading, { extraClass: 'circle__waiting' }));
        break;
      case 'signed-out':
        this.signIn ??= new OwnershipPanel({ kind: 'account', lead: CIRCLE.signIn }, { api: this.deps.api, session: this.deps.session, onRescan: () => this.deps.onScan() });
        this.body.replaceChildren(h('div', { class: 'n-px n-post__head n-post__head--bare' }, h('h1', { class: 'n-g n-t1 n-post__title', id: 'circle-post-title', text: CIRCLE.title }), h('div', { class: 'circle__signin' }, this.signIn.root)));
        break;
      case 'owners-only':
        this.body.replaceChildren(this.quiet(CIRCLE.ownersOnly, 'circle__closed'));
        break;
      case 'missing':
        this.body.replaceChildren(this.quiet(CIRCLE.notFound, 'circle-post__missing'));
        break;
      case 'failed':
        this.body.replaceChildren(h('div', { class: 'n-px n-post__failed' }, failedState({ sentence: CIRCLE.loadFailed, reason: l.message, retry: CIRCLE.retry, onRetry: () => void this.fetch(), retryClass: 'circle-post__retry' })));
        if (hadFocus) this.body.querySelector<HTMLElement>('.circle-post__retry')?.focus();
        break;
      default: {
        const p = l.post;
        this.root.dataset.kind = p.kind.toLowerCase();
        const photos = this.photos(p);
        const sections: (HTMLElement | null)[] = [
          photos,
          h(
            'div',
            { class: ['n-px', 'n-post__head', photos ? null : 'n-post__head--bare'] },
            h('p', { class: 'n-g n-lb circle-post__kind', text: kindLine(p) }),
            p.experience ? h('p', { class: 'n-g n-lb circle-post__experience', text: p.experience }) : null,
            h('h1', { class: 'n-g n-t1 n-post__title circle-post__title', id: 'circle-post-title' }, ...withNumerals(p.title)),
            p.date ? h('p', { class: 'n-sm n-num n-post__date circle-post__date', text: p.date }) : null,
            storyBlock(p.body, { className: 'n-post__text circle-post__text', paragraphClass: 'n-art circle-post__paragraph' }),
          ),
        ];
        if (p.invitation) sections.push(this.invitation(p));
        if (p.poll) sections.push(this.poll(p));
        sections.push(this.links(p));
        this.body.replaceChildren(...sections.filter((x): x is HTMLElement => x !== null));
      }
    }
    if (hadFocus && !this.body.contains(document.activeElement)) (this.body.querySelector<HTMLElement>('button:not([disabled])') ?? this.body.querySelector<HTMLElement>('h2'))?.focus({ preventScroll: true });
  }

  /** A sentence alone on the margin under ‹ THE CIRCLE (C40): it names the page. */
  private quiet(text: string, extraClass: string): HTMLElement {
    const line = quietLine(text, extraClass);
    line.id = 'circle-post-title';
    return h('div', { class: 'n-px n-post__head n-post__head--bare' }, line);
  }

  /** The post's photographs (C22): the first whole across the column, loaded at once; the others two side by side under it. */
  private photos(p: CirclePostModel): HTMLElement | null {
    if (p.photos.length === 0) return null;
    const section = h('section', { class: 'n-post__photos circle-post__photos', attrs: { 'aria-label': CIRCLE.photosLabel(p.title) }, data: { photos: '' } });
    // Every photograph that cannot be loaded gone, the section goes with them.
    const gone = () => {
      if (!section.querySelector('[data-photo]:not([hidden])')) section.hidden = true;
    };
    const one = (ph: CirclePhotoModel, i: number, height: number) => postPhoto(ph, { height, fade: false, eager: i === 0, extraClass: 'n-post__photo', imgClass: 'circle-photo__img', onGone: gone });
    const [first, ...rest] = p.photos;
    section.append(one(first!, 0, 390));
    for (let i = 0; i < rest.length; i += 2) {
      // A pair side by side (C22's `.two`, 195 px each); one left alone runs the column's width.
      if (i + 1 < rest.length) section.append(h('div', { class: 'n-two n-post__pair' }, one(rest[i]!, i + 1, 195), one(rest[i + 1]!, i + 2, 195)));
      else section.append(h('div', { class: 'n-post__pair' }, one(rest[i]!, i + 1, 390)));
    }
    return section;
  }

  private errorLine(): HTMLElement | null {
    return this.actionError ? h('p', { class: 'n-err form__error circle-post__error', attrs: { role: 'alert' }, text: this.actionError }) : null;
  }

  /** THE INVITATION (WHEN, WHERE, PLACES), then YOUR ANSWER: its sentence, YES / NO while answers are taken (C22). */
  private invitation(p: CirclePostModel): HTMLElement {
    const inv = p.invitation!;
    const heading = h('h2', { class: 'n-g n-t3 n-post__answer-title', id: 'circle-answer', attrs: { tabindex: -1 }, text: CIRCLE.section.answer });
    const option = (answer: CircleAnswer, label: string) =>
      button(label, {
        outline: inv.answer !== answer,
        onClick: () => void this.act('answer', answer),
        extraClass: 'circle-post__answer',
        attrs: { 'aria-pressed': inv.answer === answer ? 'true' : 'false', disabled: this.busy || (answer === 'YES' && inv.full), 'data-answer': answer },
      });
    return h(
      'section',
      { class: 'n-px n-post__section circle-post__section', attrs: { 'aria-labelledby': 'circle-invitation' } },
      h('h2', { class: 'n-g n-t3', id: 'circle-invitation', text: CIRCLE.section.invitation }),
      h(
        'dl',
        { class: 'n-post__rows circle-post__rows' },
        ...inv.rows.map((r) =>
          h(
            'div',
            { class: 'n-kv__row n-post__row' },
            h('dt', { class: 'n-g n-kv__label n-post__label', text: r.label }),
            h(
              'dd',
              { class: 'n-kv__value n-post__value' },
              h('span', { class: 'n-num circle-post__utc' }, ...withNumerals(r.value)),
              r.local ? h('br') : null,
              r.local ? h('span', { class: 'n-sm n-num circle-post__local', text: r.local }) : null,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'n-post__reply circle-post__reply', attrs: { role: 'group', 'aria-labelledby': 'circle-answer' } },
        heading,
        h('p', { class: 'n-sm n-post__sentence circle-post__sentence', text: inv.sentence }),
        inv.open ? h('div', { class: 'n-duo n-post__choice circle-post__choice', attrs: { role: 'group', 'aria-label': CIRCLE.answerChoice } }, option('YES', CIRCLE.yes), option('NO', CIRCLE.no)) : null,
        this.errorLine(),
      ),
    );
  }

  /** THE POLL (C34): one option chosen, then VOTE (final); once voted, the results, the reader's own marked. */
  private poll(p: CirclePostModel): HTMLElement {
    const poll = p.poll!;
    const out: (HTMLElement | null)[] = [h('h2', { class: 'n-g n-t3', id: 'circle-poll', attrs: { tabindex: -1 }, text: CIRCLE.section.poll })];
    if (poll.results) {
      out.push(
        h('p', { class: 'n-tx n-post__sentence circle-post__sentence', text: poll.sentence }),
        h(
          'ul',
          { class: 'n-post__results circle-post__results', attrs: { 'aria-label': CIRCLE.section.poll } },
          ...poll.results.map((r) => {
            const fill = h('i', { class: 'n-bar2__fill' });
            fill.style.width = r.share;
            return h(
              'li',
              { class: ['n-post__result', 'circle-post__result', r.mine ? 'is-mine' : null] },
              h(
                'div',
                { class: 'n-sb' },
                h(
                  'span',
                  { class: 'n-g n-t3 n-ivc n-post__result-label' },
                  h('span', { class: 'circle-post__result-label' }, ...withNumerals(r.label)),
                  // A word space, then 8 px, before YOUR VOTE (C34).
                  ...(r.mine ? [' ', h('span', { class: 'n-lb n-post__mine circle-post__result-mine', text: CIRCLE.yourVote })] : []),
                ),
                h('span', { class: 'n-sm n-num n-post__votes circle-post__result-votes', text: `${r.votes} · ${r.share}` }),
              ),
              h('div', { class: 'n-bar2', attrs: { 'aria-hidden': 'true' } }, fill),
            );
          }),
        ),
      );
    } else {
      out.push(
        h('p', { class: 'n-sm n-post__sentence circle-post__sentence', text: poll.sentence }),
        h(
          'div',
          { class: 'n-opt2 n-post__options circle-post__options', attrs: { role: 'group', 'aria-label': CIRCLE.pollChoice } },
          ...poll.options.map((o) =>
            h(
              'button',
              {
                class: 'n-g n-opt2__option circle-post__option',
                attrs: { type: 'button', 'aria-pressed': this.choice === o.index ? 'true' : 'false', disabled: this.busy },
                data: { option: String(o.index) },
                on: { click: () => this.choose(o.index) },
              },
              ...withNumerals(o.label),
            ),
          ),
        ),
        this.errorLine(),
        button(CIRCLE.vote, {
          extraClass: 'n-post__vote circle-post__vote',
          attrs: { disabled: this.busy || this.choice === null, 'aria-busy': this.busy ? 'true' : 'false' },
          onClick: () => {
            if (this.choice !== null) void this.act('vote', this.choice);
          },
        }),
      );
    }
    return h('section', { class: 'n-px n-post__section n-post__section--poll circle-post__section circle-post__poll', attrs: { 'aria-labelledby': 'circle-poll' } }, ...out.filter((x): x is HTMLElement => x !== null));
  }

  /** TO SEE (C22): a release's page, a model's sheet, a link to another site with its host; each a row that leads on. */
  private links(p: CirclePostModel): HTMLElement | null {
    const { release, model, external } = p.links;
    if (!release && !model && !external) return null;
    const rows: HTMLElement[] = [];
    if (release) rows.push(accLink(h('span', { class: 'circle-post__link-title' }, ...withNumerals(release.title)), { line: RELEASES.see, lineKind: 'lb', href: releasePath(release.id), onOpen: () => this.deps.onRelease(release.id), extraClass: 'circle-post__link' }));
    if (model) rows.push(accLink(h('span', { class: 'circle-post__link-title' }, ...withNumerals(model.title)), { line: LOOKBOOK.seeModel, lineKind: 'lb', href: lookbookSheetPath(model.slug), onOpen: () => this.deps.onModel(model.slug), extraClass: 'circle-post__link' }));
    if (external) {
      const a = accLink(CIRCLE.openLink, { line: external.host, lineKind: 'sm', href: external.href, newTab: true, label: CIRCLE.externalLabel(external.host), extraClass: 'circle-post__link circle-post__external' });
      a.setAttribute('rel', 'noopener noreferrer');
      a.querySelector('.n-acc__line')?.classList.add('circle-post__host');
      rows.push(a);
    }
    return h(
      'section',
      { class: 'n-px n-post__section circle-post__section', attrs: { 'aria-labelledby': 'circle-links' } },
      h('h2', { class: 'n-g n-t3', id: 'circle-links', text: CIRCLE.section.links }),
      h('div', { class: 'n-post__links circle-post__links' }, ...rows),
    );
  }
}
