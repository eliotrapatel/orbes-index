/**
 * Sign in and create account on a computer (desktop, BRIEF decision 6, §10.30; /verify/sign-in): a page of its
 * own over a photograph, the forms in a solid panel of 440 px on the right columns, then back to where the collector was.
 *
 *   ┌────────────────────────────── the newest model's photograph, as a page frame ──────────────────────────────┐
 *   │                                                                   ┌──────────────── 440 ─┐                  │
 *   │                                                                   │ SIGN IN  CREATE ACCOUNT                  │
 *   │                                                                   │ EMAIL                │                  │
 *   │                                                                   │ PASSWORD             │                  │
 *   │ YOUR ACCOUNT                                                      │ [      SIGN IN     ] │                  │
 *   │ Sign in to see the pieces registered to your ORBES account. …    │ FORGOTTEN PASSWORD?  │                  │
 *   └───────────────────────────────────────────────────────────────────┴──────────────────────┴──────────────────┘
 *
 * The panel is the OWNERSHIP panel's own sign-in (views/ownership.ts, its `page` mode): SIGN IN · CREATE ACCOUNT, the
 * forms, FORGOTTEN PASSWORD and its steps (with ORBES Client Services' email, the one place it remains), every field's
 * autocomplete; the lead of the place it was opened from stands under the page's title. Its steps swap inside the panel,
 * whose top is the SIGN IN form's place in the middle of the window, whatever form it opens on. The photograph runs from
 * the window's left edge to under the panel and dissolves into the ground beside it, so the piece stands whole beside
 * the panel (shared/desktop-account.css). Signed in (or an account created), the page gives way to the one it was
 * opened from (main.ts keeps it, as it was). Everywhere the phone embeds that sign-in, a computer shows its lead and a
 * line with SIGN IN and CREATE ACCOUNT (`signInLine`), which open this page on that form.
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { ACCOUNT, DESKTOP, PHOTOS } from '../copy.js';
import type { SessionStore } from '../session.js';
import type { ContactModel } from '../view-model.js';
import { viewRoot } from './common.js';
import { appAnchor } from './nocturne.js';
import { OwnershipPanel, type AuthTab } from './ownership.js';

export const SIGN_IN_PATH = '/verify/sign-in';

export function isSignInPath(path: string): boolean {
  return path.replace(/\/+$/, '').toLowerCase() === SIGN_IN_PATH;
}

export type SignInTab = AuthTab;

/** What opens the page: its form, and the sentence of the place it is opened from (DESKTOP.signIn.lead otherwise). */
export interface SignInRequest {
  tab?: SignInTab;
  lead?: string;
}

let opener: ((request: SignInRequest) => void) | null = null;

/** The app's way to the page (main.ts): the place it is opened from is kept, as it is, to come back to. */
export function registerSignInPage(open: (request: SignInRequest) => void): void {
  opener = open;
}

export function openSignInPage(request: SignInRequest): void {
  opener?.(request);
}

/**
 * The line that stands where the phone embeds the sign-in: SIGN IN (the filled button) and CREATE ACCOUNT (the outlined
 * one) side by side, each opening the page on its form. In the room (`vault`), the room's own buttons.
 */
export function signInLine(lead: string, opts: { look?: 'nocturne' | 'vault' } = {}): HTMLElement {
  const vault = opts.look === 'vault';
  const words = DESKTOP.signIn;
  const signIn = appAnchor(SIGN_IN_PATH, vault ? ['btn', 'live__primary', 'd-signin-line__in'] : ['n-g', 'n-btn', 'd-signin-line__in'], () => openSignInPage({ tab: 'signin', lead }), words.signIn);
  const create = appAnchor(SIGN_IN_PATH, vault ? ['btn', 'live__action', 'd-signin-line__create'] : ['n-g', 'n-btn', 'n-btn--ol', 'd-signin-line__create'], () => openSignInPage({ tab: 'create', lead }), words.create);
  return h('div', { class: ['d-signin-line', vault ? 'd-signin-line--vault' : null] }, signIn, create);
}

export interface SignInPageDeps {
  api: ApiClient;
  session: SessionStore;
  tab: SignInTab;
  lead: string;
  /** ORBES Client Services' email, for FORGOTTEN PASSWORD (read once the page is drawn). */
  contact(): Promise<ContactModel | undefined>;
  /** The form shown changed: the page's entry keeps it (back, a reload). */
  onTab(tab: SignInTab): void;
  /** Signed in, or an account created: back to where the collector was. */
  onDone(): void;
}

export interface SignInPageView {
  root: HTMLElement;
  /** The form its entry names (back, forward). */
  showTab(tab: SignInTab): void;
  dispose(): void;
}

/** The newest model of the collection with a photograph, as NOW leads with it: the page's photograph. */
function newest(cards: readonly { name: string; type: string; imageUrl: string | null; publishedAt?: string | null; variant?: { label: string } | null }[]) {
  const shown = cards.filter((c) => c.imageUrl);
  return [...shown].sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))[0] ?? null;
}

export function signInPageView(deps: SignInPageDeps): SignInPageView {
  const root = viewRoot('signin', 'signin-title');
  let contact: ContactModel | undefined;
  /** The form shown (SIGN IN or CREATE ACCOUNT). */
  let tab: SignInTab = deps.tab;
  const panel = new OwnershipPanel(
    { kind: 'account', lead: deps.lead },
    {
      api: deps.api,
      session: deps.session,
      onRescan: () => undefined,
      page: {
        tab: deps.tab,
        onTab: (t) => {
          tab = t;
          deps.onTab(t);
        },
      },
      get contact() {
        return contact;
      },
    },
  );
  const img = h('img', { class: 'd-signin__img', attrs: { alt: '', decoding: 'async', loading: 'eager', fetchpriority: 'high' } });
  const photo = h('div', { class: 'd-frame-photo d-signin__photo' }, img);
  const box = h('div', { class: 'd-signin__panel' }, panel.root);
  // The top bar's mark (shared/desktop.ts OPENING_FRAMES): from the page's top to the photograph's foot or the panel's
  // top, whichever is higher; the bar has no ground until it has passed (§10.14).
  const over = h('div', { class: 'd-signin__over', attrs: { 'aria-hidden': 'true' } });
  const words = h('div', { class: 'd-signin__words d-on-photo' }, h('h1', { class: 'n-g d-signin__title', id: 'signin-title', attrs: { tabindex: -1 }, text: ACCOUNT.title }), h('p', { class: 'n-lead d-signin__lead', text: deps.lead }));
  const frame = h('section', { class: 'd-signin' }, over, photo, words, box);
  root.append(frame);
  // The words' height (the light photograph ends 24 px above them, its foot dissolving there, shared/desktop-account.css).
  const wordsSeen = new ResizeObserver(() => {
    if (words.offsetHeight > 0) frame.style.setProperty('--d-signin-words-h', `${Math.round(words.offsetHeight)}px`);
  });
  wordsSeen.observe(words);

  // The panel's top: where the SIGN IN form (the page's first and shortest step) stands in the middle of the window
  // under the bar, whatever form the page opens on, so the panel stands in one place for every way in; CREATE ACCOUNT
  // and FORGOTTEN PASSWORD's steps grow the page downward from it (§10.30). The form's height is read once it is drawn
  // (not while the session is asked), before the panel is first painted, which shows only then (`is-placed`): it never
  // moves as the page loads. Set again only when the window's height changes (the form's height does not).
  let reference: number | null = null;
  const signInHeight = (): number => {
    if (tab === 'signin') return box.offsetHeight;
    // Opened on CREATE ACCOUNT: SIGN IN drawn for the reading, then CREATE ACCOUNT again, in the same frame.
    panel.showTab('signin');
    const height = box.offsetHeight;
    panel.showTab(tab);
    return height;
  };
  const place = () => {
    if (!root.isConnected) return;
    if (reference === null) {
      if (!box.querySelector('form')) return;
      reference = signInHeight();
      seen?.disconnect();
      seen = null;
    }
    const room = Math.max(window.innerHeight, 640) - 84;
    frame.style.setProperty('--d-signin-top', `${Math.max(72, Math.round((room - reference) / 2))}px`);
    box.classList.add('is-placed');
  };
  let seen: ResizeObserver | null = new ResizeObserver(() => place());
  seen.observe(box);
  window.addEventListener('resize', place);

  let disposed = false;
  void deps.api
    .lookbook()
    .then((cards) => {
      if (disposed) return;
      const c = newest(cards);
      if (!c?.imageUrl) {
        photo.classList.add('is-bare');
        return;
      }
      img.alt = PHOTOS.modelAlt(c.name.toUpperCase(), c.type.toUpperCase(), c.variant?.label ?? null);
      img.src = c.imageUrl;
    })
    .catch(() => photo.classList.add('is-bare'));
  void deps
    .contact()
    .then((c) => {
      if (disposed) return;
      contact = c;
      panel.contactArrived();
    })
    .catch(() => undefined);

  // Signed in here (or already): the page gives way.
  let done = false;
  const unsubscribe = deps.session.subscribe((s) => {
    if (s.status !== 'signed-in' || done || disposed) return;
    done = true;
    deps.onDone();
  });
  // Reached signed in (forward through history, an address typed): nothing to sign in to, back at once.
  if (deps.session.state.status === 'signed-in') {
    done = true;
    queueMicrotask(() => {
      if (!disposed) deps.onDone();
    });
  }
  return {
    root,
    showTab: (t) => {
      tab = t;
      panel.showTab(t);
    },
    dispose: () => {
      disposed = true;
      unsubscribe();
      panel.dispose();
      window.removeEventListener('resize', place);
      seen?.disconnect();
      wordsSeen.disconnect();
    },
  };
}
