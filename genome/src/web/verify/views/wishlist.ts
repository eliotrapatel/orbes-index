/**
 * YOUR WISHLIST (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.10.2; /verify/wishlist), opened from the account
 * sheet's row: the models the collector marked with the heart on their sheet, the latest first, built like THE
 * COLLECTION (its cards, views/lookbook.ts modelCard: the photograph whole, at full width, faded; the words lifted onto
 * its foot). Private: nobody else sees it.
 *
 *   ‹ YOUR ACCOUNT                         the account sheet again
 *   YOUR WISHLIST                          the title and its sentence
 *   The models you marked with the heart…
 *   MONOLITHE IN BLUE is removed from …    the status line, after REMOVE (or why it could not be changed)
 *   [ the photograph, whole, faded ]       a model the reader may open: its photograph (lazy after the first two), its
 *              ORBITAL                     collection, its name, its line (its type, IN BLUE for a variant, THE
 *             MONOLITHE                    PRIVATE SALON, DISCONTINUED · 2026), SEE THE MODEL (its sheet, that dot
 *          BRACELET · IN BLUE              selected) and REMOVE
 *      SEE THE MODEL     REMOVE
 *               ZENITH                     a model it may not open now: its name and variant, NOT IN THE COLLECTION
 *      NOT IN THE COLLECTION NOW           NOW, no photograph and no link, REMOVE
 *               REMOVE
 *
 * ONE MOMENT… while it is read; could not be shown, with the server's words and TRY AGAIN; empty, its sentence and THE
 * COLLECTION; signed out, that the wishlist is kept in the account, and SIGN IN (MY PIECES' sign-in). REMOVE takes the
 * card away at once (one tap: the heart puts it back), the focus to the next card, else to the title; a refusal keeps
 * the card and says why. Read again when the account signs in or out. No count, no limit shown (the heart says it).
 * CSP-safe: h() only, NOCTURNE's pieces, their places by class (verify/styles.css, YOUR WISHLIST).
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { WISHLIST } from '../copy.js';
import type { SessionStore } from '../session.js';
import { wishlistCards, type WishlistCard } from '../wishlist-model.js';
import { LOOKBOOK_PATH, PIECES_PATH, viewRoot, withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { modelCard, quietly } from './lookbook.js';
import { failedState, icon, loadingState, textLink } from './nocturne.js';

type Session = Pick<SessionStore, 'ensure' | 'noteError' | 'subscribe'>;

export interface WishlistDeps {
  api: Pick<ApiClient, 'wishlist' | 'unwish'>;
  session: Session;
  /** ‹ YOUR ACCOUNT: the account sheet (`trigger`: the crumb, the focus comes back to it). */
  onAccount(trigger: HTMLElement): void;
  /** SEE THE MODEL: the model's sheet, that dot selected. */
  onSheet(slug: string): void;
  /** THE COLLECTION, from an empty wishlist. */
  onCollection(): void;
  /** SIGN IN, signed out: MY PIECES' sign-in. */
  onSignIn(): void;
}

export interface WishlistView {
  root: HTMLElement;
  dispose(): void;
}

type Load = { kind: 'loading' } | { kind: 'ready'; cards: WishlistCard[] } | { kind: 'signed-out' } | { kind: 'failed'; message: string };

export function wishlistView(deps: WishlistDeps): WishlistView {
  const page = new WishlistPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class WishlistPage {
  readonly root: HTMLElement;
  private readonly title = h('h1', { class: 'n-g n-t1', id: 'wishlist-title', attrs: { tabindex: -1 }, text: WISHLIST.title });
  /** What REMOVE did: a status (removed) or why it could not (the sentence and the server's words). */
  private readonly status = h('p', { class: 'n-sm n-wishlist__status', attrs: { role: 'status' } });
  private readonly body = h('div', { class: 'n-wishlist__body', attrs: { 'aria-live': 'polite' } });
  private load: Load = { kind: 'loading' };
  private disposed = false;
  private generation = 0;
  /** The address of the card whose REMOVE is under way. */
  private removing: string | null = null;
  private readonly unsubscribe: () => void;
  private signedIn: boolean | null = null;

  constructor(private readonly deps: WishlistDeps) {
    this.root = viewRoot('wishlist', 'wishlist-title');
    this.root.classList.add('n-wishlist');
    const crumb = h(
      'button',
      { class: 'n-g n-crumb n-wishlist__crumb', attrs: { type: 'button' }, on: { click: () => deps.onAccount(crumb) } },
      icon('back', { small: true }),
      WISHLIST.back,
    );
    this.status.hidden = true;
    this.root.append(crumb, h('header', { class: 'n-px n-wishlist__head' }, this.title, h('p', { class: 'n-lead n-wishlist__lead', text: WISHLIST.lead }), this.status), this.body);
    // Signed in or out meanwhile (the account sheet, a sign-in elsewhere): read again.
    this.unsubscribe = deps.session.subscribe((s) => {
      const now = s.status === 'signed-in';
      if (s.status === 'unknown' || this.signedIn === null || now === this.signedIn) return;
      void this.fetch();
    });
    this.render();
    void this.fetch();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  private async fetch(): Promise<void> {
    const gen = ++this.generation;
    const stale = (): boolean => this.disposed || gen !== this.generation;
    this.load = { kind: 'loading' };
    this.say(null);
    this.render();
    let signedIn: boolean | null;
    try {
      signedIn = (await this.deps.session.ensure()).status === 'signed-in';
    } catch {
      signedIn = null;
    }
    if (stale()) return;
    this.signedIn = signedIn;
    if (signedIn === false) {
      this.load = { kind: 'signed-out' };
    } else {
      try {
        this.load = { kind: 'ready', cards: wishlistCards((await this.deps.api.wishlist()).items) };
      } catch (e) {
        if (stale()) return;
        this.deps.session.noteError(e);
        this.load = e instanceof ApiError && e.status === 401 ? { kind: 'signed-out' } : { kind: 'failed', message: messageOf(e) };
      }
    }
    if (stale()) return;
    this.render();
  }

  /** The status line under the sentence: a removal said, or why it could not be done; hidden when there is none. */
  private say(text: string | null, error = false): void {
    this.status.textContent = text ?? '';
    this.status.hidden = text === null;
    this.status.classList.toggle('n-err', error);
  }

  private render(): void {
    const hadFocus = this.body.contains(document.activeElement);
    const l = this.load;
    this.root.dataset.state = l.kind === 'ready' && l.cards.length === 0 ? 'empty' : l.kind;
    if (l.kind === 'loading') {
      this.body.replaceChildren(loadingState(WISHLIST.loading, { extraClass: 'n-wishlist__waiting' }));
      return;
    }
    if (l.kind === 'failed') {
      this.body.replaceChildren(failedState({ sentence: WISHLIST.unreadable, reason: l.message, retry: WISHLIST.retry, onRetry: () => void this.fetch(), retryClass: 'n-wishlist__retry', extraClass: 'n-px n-wishlist__failed' }));
      if (hadFocus) this.body.querySelector<HTMLElement>('.n-wishlist__retry')?.focus();
      return;
    }
    if (l.kind === 'signed-out') {
      this.body.replaceChildren(
        h(
          'div',
          { class: 'n-px n-wishlist__empty n-wishlist__signed-out' },
          h('p', { class: 'n-tx', text: WISHLIST.signedOut }),
          h('p', { class: 'n-wishlist__links' }, textLink(WISHLIST.signIn, { href: PIECES_PATH, onOpen: () => this.deps.onSignIn(), extraClass: 'n-wishlist__sign-in' })),
        ),
      );
      return;
    }
    if (l.cards.length === 0) {
      this.body.replaceChildren(
        h(
          'div',
          { class: 'n-px n-wishlist__empty' },
          h('p', { class: 'n-tx', text: WISHLIST.empty }),
          h('p', { class: 'n-wishlist__links' }, textLink(WISHLIST.collection, { href: LOOKBOOK_PATH, onOpen: () => this.deps.onCollection(), extraClass: 'n-wishlist__collection-link' })),
        ),
      );
      return;
    }
    this.body.replaceChildren(h('div', { class: 'n-wishlist__list' }, ...l.cards.map((c, i) => this.card(c, i))));
  }

  /** A wish: THE COLLECTION's card (a model shown), or its name and NOT IN THE COLLECTION NOW (one it may not open now). */
  private card(c: WishlistCard, i: number): HTMLElement {
    const id = `wishlist-${i}`;
    const busy = this.removing === c.slug;
    const remove = textLink(WISHLIST.remove, { onOpen: () => void this.remove(c), extraClass: 'n-wishlist__remove' });
    remove.setAttribute('aria-describedby', `${id}-name`);
    if (busy) {
      remove.setAttribute('aria-busy', 'true');
      (remove as HTMLButtonElement).disabled = true;
    }
    const name = h('h2', { class: 'n-g n-t2 lookbook-card__name n-wishlist__name', id: `${id}-name` }, ...withNumerals(c.name));
    if (c.kind === 'hidden') {
      return modelCard({
        id,
        image: null,
        following: i > 0,
        extraClass: 'n-wishlist__card n-wishlist__card--hidden',
        data: { wish: c.slug },
        words: [name, h('p', { class: 'n-g n-lb n-lookbook__type n-wishlist__line' }, ...withNumerals(c.line)), h('p', { class: 'n-lookbook__see n-wishlist__actions' }, remove)],
      });
    }
    const see = textLink(WISHLIST.seeModel, { href: c.href, onOpen: () => this.deps.onSheet(c.slug), extraClass: 'n-wishlist__see' });
    see.setAttribute('aria-describedby', `${id}-name`);
    return modelCard({
      id,
      image: c.image,
      eager: i < 2,
      following: i > 0,
      extraClass: 'n-wishlist__card',
      data: { wish: c.slug },
      words: [
        c.collection ? h('p', { class: 'n-g n-lb n-wishlist__collection' }, ...withNumerals(c.collection)) : null,
        name,
        h('p', { class: 'n-g n-lb n-lookbook__type n-wishlist__line' }, ...withNumerals(c.line)),
        h('p', { class: 'n-lookbook__see n-wishlist__actions' }, see, remove),
      ],
    });
  }

  /**
   * REMOVE: one tap (the heart puts it back), busy while it runs; done, the card goes, the status line names the model
   * and the focus goes to the next card's first link, else to the title; refused, the card stays and the line says why.
   * Each redraw is quiet (the list's live region off while it changes): the status line is the only announcement.
   */
  private async remove(c: WishlistCard): Promise<void> {
    if (this.removing !== null || this.load.kind !== 'ready') return;
    this.removing = c.slug;
    this.say(null);
    quietly(this.body, () => this.render());
    try {
      await this.deps.api.unwish(c.slug);
    } catch (e) {
      this.removing = null;
      if (this.disposed) return;
      this.deps.session.noteError(e);
      this.say(`${WISHLIST.failed} ${messageOf(e)}`, true);
      quietly(this.body, () => this.render());
      this.body.querySelector<HTMLElement>(`[data-wish="${CSS.escape(c.slug)}"] .n-wishlist__remove`)?.focus({ preventScroll: true });
      return;
    }
    this.removing = null;
    if (this.disposed || this.load.kind !== 'ready') return;
    const at = this.load.cards.findIndex((x) => x.slug === c.slug);
    this.load = { kind: 'ready', cards: this.load.cards.filter((x) => x.slug !== c.slug) };
    this.say(WISHLIST.removedNamed(c.title));
    quietly(this.body, () => this.render());
    const next = this.body.querySelectorAll<HTMLElement>('.n-wishlist__card')[at];
    const target = next?.querySelector<HTMLElement>('.n-wishlist__see, .n-wishlist__remove') ?? this.title;
    target.focus({ preventScroll: next === undefined });
  }
}
