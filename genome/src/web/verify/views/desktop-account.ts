/**
 * The account as pages on a computer (desktop, BRIEF decision 5, §10.22, §10.30): never a sheet, a side panel
 * or a dialog. The header's account button opens /verify/account; each of its cards opens its own page.
 *
 *   YOUR ACCOUNT                                                      TITANE                  2 pieces held
 *   SIGNED IN AS you@example.com                                      ● ● ○ ○ ○ ○ ○ ○ ○ ○
 *   ┌ YOUR PROFILE          › ┐ ┌ YOUR SIZES            › ┐ ┌ YOUR ADDRESSES        › ┐   six hairline cards, three
 *   │ 0% COMPLETE             │ │ NOT SET                 │ │ 2 SAVED                 │   to a row (two below 1200
 *   ┌ YOUR WISHLIST         › ┐ ┌ THE VAULT             › ┐ ┌ MESSAGES              › ┐   px), each one link, its
 *   │ NONE YET                │ │ 2                       │ │ 1 UNREAD                │   line from the account's data
 *   ┌ CHANGE PASSWORD       › ┐                                                         (THE VAULT, lot Q3: seven cards)
 *   SOUND               (●)     LIGHT MODE           (○)                    [ SIGN OUT ]   the settings, then SIGN OUT
 *   YOUR TIER                              NEXT: PLATINE                                   what the tier gives (IN USE,
 *   – The owners' circle …                 3 more pieces … It adds: …                      its benefits), beside NEXT
 *   THE HOUSE'S GUARANTEE …                THE HOUSE'S GUARANTEE …                         two to a row
 *   MY PIECES             ›     THE CLUB             ›      PRIVACY · TERMS · LEGAL · HELP ›
 *
 *   ‹ YOUR ACCOUNT
 *   YOUR SIZES                                  Your sizes preselect the size of a release …   a section's page: its
 *                                               [ RING SIZE      ] [ BRACELET SIZE  ]           title on the left, its
 *                                               [ WRIST          ] [ NECKLACE       ]           lead and its form (440 px
 *                                               [   SAVE   ] [  CANCEL  ]                       at most) on the right
 *
 * The pages are the account sheet's own views (views/account.ts: their reads, their forms, their words and their
 * states), each at its address: /verify/account/profile, /sizes, /addresses, /password; YOUR WISHLIST is its page
 * (/verify/account/wishlist); MESSAGES its own page in two parts (/verify/messages, views/desktop-messages.ts). A move
 * inside the account (a card, the crumb, SAVE, CANCEL) changes the address as a page of the app does: back returns to
 * the page under it. Reached signed out, the sign-in page takes its place and gives it back once signed
 * in (main.ts). The sheet stays the phone's.
 */
import { h } from '../../shared/dom.js';
import { LEGAL_PATH } from '../../shared/legal.js';
import type { ApiClient } from '../api.js';
import { addressesSummary } from '../addresses-model.js';
import { ACCOUNT, ACCOUNT_ADDRESSES, ACCOUNT_PASSWORD, ACCOUNT_PROFILE, ACCOUNT_SIZES, DESKTOP, MESSAGES, MODE, PIECES, SOUND, TIER, VAULT, WISHLIST } from '../copy.js';
import { CLUB_PATH } from '../club-model.js';
import { completionRow } from '../profile-model.js';
import { seen } from '../seen.js';
import { accountPageOf } from '../seen-model.js';
import { sizesSummary } from '../sizes-model.js';
import { AccountSheet, type AccountSheetDeps, type AccountSheetView } from './account.js';
import { listLine, PIECES_PATH } from './common.js';
import { appAnchor, button, icon, leadRow, loadingState, switchControl } from './nocturne.js';

export type AccountView = AccountSheetView;

export const ACCOUNT_PATH = '/verify/account';
/** MESSAGES' page, in two parts (views/desktop-messages.ts). */
export const MESSAGES_PAGE_PATH = '/verify/messages';
/** YOUR WISHLIST, its card's address (the same page as /verify/wishlist). */
export const ACCOUNT_WISHLIST_PATH = '/verify/account/wishlist';
/** THE VAULT, its card's address (lot Q3 §3.5, D41: its own page; the same page as /verify/vault). */
export const ACCOUNT_VAULT_PATH = '/verify/account/vault';

const PATHS: Readonly<Record<AccountView, string>> = Object.freeze({
  account: ACCOUNT_PATH,
  profile: `${ACCOUNT_PATH}/profile`,
  sizes: `${ACCOUNT_PATH}/sizes`,
  addresses: `${ACCOUNT_PATH}/addresses`,
  password: `${ACCOUNT_PATH}/password`,
  messages: MESSAGES_PAGE_PATH,
});

/** Each page's title (the page's h1), as the sheet's views name them. */
const TITLES: Readonly<Record<AccountView, string>> = Object.freeze({
  account: 'account-title',
  profile: 'account-profile-title',
  sizes: 'account-sizes-title',
  addresses: 'account-addresses-title',
  password: 'account-password-title',
  messages: 'account-messages-title',
});

export function accountPath(view: AccountView): string {
  return PATHS[view];
}

/** The account's page an address names; an address under /verify/account that is none: YOUR ACCOUNT. */
export function accountRouteOf(pathname: string): AccountView | 'wishlist' | 'vault' | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === ACCOUNT_WISHLIST_PATH) return 'wishlist';
  if (path === ACCOUNT_VAULT_PATH) return 'vault';
  for (const [view, p] of Object.entries(PATHS) as [AccountView, string][]) if (path === p) return view;
  return path.startsWith(`${ACCOUNT_PATH}/`) ? 'account' : null;
}

export interface AccountPageHost {
  /** The page moved by itself (a card, the crumb, SAVE, CANCEL): its address follows (main.ts). */
  navigate(view: AccountView): void;
  /** YOUR WISHLIST's card: its page, over the account's. */
  openWishlist(): void;
  /** THE VAULT's card (lot Q3 §3.6): its page, over the account's. */
  openVault(): void;
  /** SIGN OUT pressed: NOW. */
  signedOut(): void;
  /** Reached (or left) signed out, not by SIGN OUT here: the sign-in page in its place, this page once signed in. */
  signIn(view: AccountView): void;
  /** MESSAGES' card: its page in two parts, on the newest subject. */
  openMessages(): void;
}

/** Whether a value names one of the account's pages (a history entry's). */
export function isAccountView(v: unknown): v is AccountView {
  return typeof v === 'string' && Object.hasOwn(PATHS, v);
}

export interface AccountPageDeps extends AccountSheetDeps {
  api: AccountSheetDeps['api'] & Pick<ApiClient, 'messagesUnreadCount'>;
  host: AccountPageHost;
}

/** Two fields that pair (first and last name, country and city…) side by side (§10.22). */
function pair(scope: ParentNode, a: string, b: string): void {
  const one = scope.querySelector(a)?.closest<HTMLElement>('.n-fld-group');
  const two = scope.querySelector(b)?.closest<HTMLElement>('.n-fld-group');
  if (!one || !two || one.parentElement !== two.parentElement || one.parentElement?.classList.contains('d-acct__pair')) return;
  const box = h('div', { class: 'd-acct__pair' });
  one.before(box);
  box.append(one, two);
}

export class AccountPage extends AccountSheet {
  /** The view the address names (null: not shown). */
  private shown: AccountView | null = null;
  /** How many answers are unread (MESSAGES' card), null until read. */
  private unreadCount: number | null = null;
  /** SIGN OUT pressed here (NOW follows, not the sign-in page). */
  private signingOut = false;
  /**
   * Shown at a load (an address typed, a reload, a link from elsewhere): the sheet's habit of moving the focus to its
   * view's title (or first field) is left out until the collector acts in the page, so Tab starts at the top bar as on
   * every page (§10.17: the wordmark, the menu, SCAN, the account, then the page). Moves inside the app keep it.
   */
  private quiet = false;
  private readonly host: AccountPageHost;
  private readonly countApi: Pick<ApiClient, 'messagesUnreadCount'>;

  constructor(deps: AccountPageDeps) {
    super(deps, true);
    this.host = deps.host;
    this.countApi = deps.api;
    const act = () => {
      this.quiet = false;
    };
    this.el.addEventListener('pointerdown', act, { capture: true });
    this.el.addEventListener('keydown', act, { capture: true });
    // Signed in meanwhile (the sign-in page opened from here, another tab): the page drawn again with the account's data.
    deps.session.subscribe((s) => {
      if (s.status === 'signed-in' && this.isOpen) this.go(this.view, this.addressesFromProfile);
    });
  }

  get root(): HTMLElement {
    return this.el;
  }

  /**
   * Shown at its address (the router, back, forward): that view, read as it opens; nothing to do when it is shown.
   * `focus` false: shown at a load, the focus left where the page starts (above).
   */
  arrive(view: AccountView, under?: AccountView, focus = true): void {
    this.quiet = !focus;
    if (this.isOpen && this.shown === view && this.view === view) return;
    this.el.hidden = false;
    this.shown = view;
    this.view = view;
    if (this.deps.session.state.status !== 'signed-in') {
      this.render();
      if (this.deps.session.state.status === 'unknown') void this.deps.session.ensure().catch(() => undefined);
      return;
    }
    this.go(view, under === 'profile');
  }

  /** The page left for another screen: what it read is forgotten, as the sheet forgets it as it closes. */
  left(): void {
    this.close();
    this.shown = null;
  }

  private go(view: AccountView, fromProfile = false): void {
    this.shown = view;
    if (view === 'account') {
      this.view = 'account';
      this.render();
      this.focusTitle();
      void this.read();
    } else if (view === 'sizes') this.openSizes();
    else if (view === 'profile') this.openProfile();
    else if (view === 'addresses') this.openAddresses({ fromProfile });
    else if (view === 'password') this.openPassword();
    else this.openThread();
  }

  protected override focusTitle(): void {
    if (!this.quiet) super.focusTitle();
  }

  /** CHANGE PASSWORD, its first field taking the focus as the sheet's does, except at a load (above). */
  protected override openPassword(): void {
    if (!this.quiet) {
      super.openPassword();
      return;
    }
    this.view = 'password';
    this.notice = null;
    this.render();
  }

  protected override focusView(): void {
    if (!this.quiet) super.focusView();
  }

  /**
   * Signed out while the page is shown (the session read as none, or ended elsewhere): the sign-in page takes its place,
   * and gives this page back once signed in (main.ts); after SIGN OUT here, NOW.
   */
  protected override leave(): void {
    if (!this.isOpen) return;
    this.render();
    if (!this.signingOut && this.deps.session.state.status === 'anonymous') this.host.signIn(this.view);
  }

  /** The account's data read afresh, with how many answers are unread (MESSAGES' card). */
  protected override async read(): Promise<void> {
    let done = false;
    const count = this.countApi.messagesUnreadCount().then(
      (n) => n,
      () => null,
    );
    void count.then((n) => {
      const changed = n !== this.unreadCount;
      this.unreadCount = n;
      if (done && changed && this.isOpen && this.view === 'account') this.redraw();
    });
    await super.read();
    done = true;
  }

  /** Drawn again where it stands, the focus kept on the control that had it (by its key). */
  private redraw(): void {
    const focused = this.panel.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const key = focused?.dataset.key;
    this.render();
    const again = key ? this.panel.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
    if (again) again.focus({ preventScroll: true });
  }

  protected override signOut(): void {
    if (this.busy) return;
    this.busy = true;
    this.render();
    this.signingOut = true;
    void (async () => {
      try {
        await this.deps.api.logout();
      } catch {
        // The cookie is cleared by the server when it answers; the page forgets the session either way.
      } finally {
        this.busy = false;
        this.deps.session.signedOut();
        this.signingOut = false;
        this.host.signedOut();
      }
    })();
  }

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────────────────────────────

  protected override render(): void {
    const s = this.deps.session.state;
    if (s.status !== 'signed-in') {
      // Not signed in: ONE MOMENT… while the session is read, or while the sign-in page (or NOW) takes the page's place.
      seen.release(this);
      this.el.setAttribute('aria-labelledby', TITLES.account);
      this.panel.replaceChildren(loadingState(PIECES.loading, { extraClass: 'd-acct__loading' }));
      return;
    }
    // The recording, as the sheet's views have it (plan CUSTOMER INTELLIGENCE §3.3 T.9): nothing new is recorded.
    seen.claim(this, accountPageOf(this.view), () => this.isOpen);
    this.el.setAttribute('aria-labelledby', TITLES[this.view]);
    this.panel.replaceChildren(...(this.view === 'account' ? this.accountPage(s.account.email) : this.sectionPage(this.view)));
    this.follow();
  }

  /** The view changed by the page itself: its address follows, the page from its top; YOUR ACCOUNT read afresh. */
  private follow(): void {
    const from = this.shown;
    if (from === this.view) return;
    this.shown = this.view;
    if (from === null) return;
    this.host.navigate(this.view);
    window.scrollTo(0, 0);
    if (this.view === 'account') void this.read();
  }

  // ── YOUR ACCOUNT ───────────────────────────────────────────────────────────────────────────────────────────────────

  private accountPage(email: string): HTMLElement[] {
    // YOUR TIER as the sheet draws it, its parts placed: the tier's name, its pieces and its dots on top; what it gives
    // in two columns lower in the page (tierSection).
    const tier = this.tierBlock();
    const badge = tier?.querySelector<HTMLElement>(':scope > .n-account__badge') ?? null;
    const dots = tier?.querySelector<HTMLElement>(':scope > .n-account__dots') ?? null;
    const top = badge ? h('div', { class: 'd-acct__tier', attrs: { role: 'group', 'aria-labelledby': 'account-tier' } }, badge, dots) : null;
    const head = h(
      'header',
      { class: 'd-acct__head' },
      h(
        'div',
        { class: 'd-acct__who' },
        h('h1', { class: 'n-g d-acct__title', id: 'account-title', attrs: { tabindex: -1 }, text: ACCOUNT.title }),
        h('p', { class: 'n-g n-lb d-acct__as', text: ACCOUNT.signedInAs }),
        h('p', { class: 'n-tx n-account__email d-acct__email', text: email }),
      ),
      top,
    );
    const notice = this.notice ? h('p', { class: 'n-err n-account__notice d-acct__notice', attrs: { role: 'status' }, text: this.notice }) : null;
    return [
      head,
      notice,
      this.cards(),
      this.settings(),
      tier ? this.tierSection(tier) : null,
      this.guarantees(),
      this.links(),
    ].filter((x): x is HTMLElement => x !== null);
  }

  /**
   * What the tier gives, the sheet's YOUR TIER block placed in two columns as YOUR PROFILE's rows stand (the left on
   * columns 1–5, the right on 7–12), aligned at the top (§10.27), so the window is filled across whatever the tier (§3:
   * never one column on one side). One layout for every tier: YOUR TIER across the two columns; on the left the tier's
   * benefits, always (and the note of a piece that counts for none); on the right IN USE with its rows when the account
   * has any, then NEXT: … with its sentence and what it adds when there is one (PALLADIUM, the highest: its sentence in
   * NEXT's place). Each block keeps its own label (IN USE, NEXT: …). TITANE reads benefits | NEXT, PLATINE benefits |
   * IN USE and NEXT, PALLADIUM benefits | IN USE. Without a tier: THE CLUB's sentence across, with what a first piece
   * opens under it, two to a row. Every part is the sheet's own (its words, its order inside each block); in the reading
   * order the left column comes first.
   */
  private tierSection(tier: HTMLElement): HTMLElement {
    const part = (sel: string) => tier.querySelector<HTMLElement>(`:scope > ${sel}`);
    const label = part('#account-tier');
    const inUse = part('.n-account__in-use');
    const benefits = part('.n-account__benefits');
    const next = part('.n-account__next');
    const top = part('.n-account__top');
    const note = part('.n-account__note');
    const nextLabel = next?.querySelector<HTMLElement>(':scope > .n-account__next-label') ?? null;
    const nextWay = next?.querySelector<HTMLElement>(':scope > .n-account__next-way') ?? null;
    const nextBenefits = next?.querySelector<HTMLElement>(':scope > .n-account__benefits') ?? null;
    const cell = (place: string, kids: (HTMLElement | null)[]) => {
      const shown = kids.filter((k): k is HTMLElement => k !== null);
      return shown.length > 0 ? h('div', { class: ['d-acct__more-cell', `d-acct__more-cell--${place}`] }, ...shown) : null;
    };
    // No tier yet (NEXT without its label): the sentence (ending on its colon) and the list it opens stay together.
    if (next && !nextLabel) {
      return h(
        'section',
        { class: ['d-acct__more', 'd-acct__more--club'], attrs: { 'aria-labelledby': 'account-tier' } },
        cell('l1', [label]),
        cell('l2', [nextWay, nextBenefits, inUse, benefits, top, note]),
      );
    }
    return h(
      'section',
      { class: ['d-acct__more', 'd-acct__more--headed'], attrs: { 'aria-labelledby': 'account-tier' } },
      cell('l2', [label, benefits, note]),
      cell('r2', [inUse, next, top]),
    );
  }

  /** The seven cards (THE VAULT the seventh, lot Q3): each one link to its page, its line from the account's data (none while unread, as the rows). */
  private cards(): HTMLElement {
    const card = (key: string, label: string, line: string | null, href: string, onOpen: () => void) => {
      const a = appAnchor(
        href,
        ['d-acct__card'],
        onOpen,
        h('span', { class: 'd-acct__card-top' }, h('span', { class: 'n-g d-acct__card-title', text: label }), icon('chev', { small: true })),
        // A long line (YOUR SIZES with four sizes) takes a second line, each value held whole (§10.9).
        h('span', { class: 'n-g n-lb d-acct__card-line' }, ...listLine(line ?? '')),
      );
      a.dataset.key = key;
      return h('li', { class: 'd-acct__cell' }, a);
    };
    const unread = this.unreadCount !== null ? (this.unreadCount > 0 ? DESKTOP.account.unread(this.unreadCount) : null) : this.unread || this.houseUnread ? MESSAGES.new : null;
    return h(
      'ul',
      { class: 'd-acct__cards', attrs: { 'aria-label': ACCOUNT.title } },
      card('profile', ACCOUNT_PROFILE.row, this.profile ? completionRow(this.profile.completion) : null, PATHS.profile, () => this.openProfile()),
      card('sizes', ACCOUNT_SIZES.row, this.sizes ? sizesSummary(this.sizes) : null, PATHS.sizes, () => this.openSizes()),
      card('addresses', ACCOUNT_ADDRESSES.row, this.addresses ? addressesSummary(this.addresses.addresses) : null, PATHS.addresses, () => this.openAddresses()),
      card('wishlist', WISHLIST.row, this.wishCount, ACCOUNT_WISHLIST_PATH, () => this.host.openWishlist()),
      // THE VAULT (lot Q3 §3.6, N32): a seventh card right after YOUR WISHLIST, its line the quiet number (none when nothing waits).
      card('vault', VAULT.row, this.vaultCount, ACCOUNT_VAULT_PATH, () => this.host.openVault()),
      card('messages', MESSAGES.title, unread, MESSAGES_PAGE_PATH, () => this.host.openMessages()),
      card('password', ACCOUNT_PASSWORD.change, null, PATHS.password, () => this.openPassword()),
    );
  }

  /** SOUND and LIGHT MODE, switches on the page itself (LIGHT MODE after SOUND, as on the phone), then SIGN OUT. */
  private settings(): HTMLElement {
    const sw = switchControl({
      label: SOUND.label,
      checked: this.deps.sound.on,
      onChange: (on) => {
        this.deps.sound.set(on);
        this.deps.onSound();
      },
    });
    sw.input.dataset.key = 'sound';
    this.soundInput = sw.input;
    const mode = switchControl({ label: MODE.label, checked: this.deps.mode.light, onChange: (light) => this.deps.mode.set(light) });
    mode.input.dataset.key = 'mode';
    return h(
      'div',
      { class: 'd-acct__settings' },
      h('label', { class: 'n-row n-account__sound d-acct__switch' }, h('span', { class: 'n-g n-row__label', text: SOUND.label }), sw.el),
      h('label', { class: 'n-row n-account__mode d-acct__switch' }, h('span', { class: 'n-g n-row__label', text: MODE.label }), mode.el),
      h('div', { class: 'd-acct__out' }, button(ACCOUNT.signOut, { outline: true, onClick: () => this.signOut(), attrs: { disabled: this.busy, 'data-key': 'sign-out' } })),
    );
  }

  /** THE HOUSE'S GUARANTEE (IN-01): one block per guarantee shown, side by side on the cards' columns. */
  private guarantees(): HTMLElement | null {
    const blocks = this.guaranteeBlocks();
    if (blocks.length === 0) return null;
    for (const b of blocks) b.classList.remove('n-px');
    return h('div', { class: 'd-acct__guarantees' }, ...blocks);
  }

  /** MY PIECES, THE CLUB and the legal pages, the sheet's last rows, on the cards' columns. */
  private links(): HTMLElement {
    return h(
      'nav',
      { class: 'd-acct__links', attrs: { 'aria-label': ACCOUNT.title } },
      leadRow(PIECES.link, { href: PIECES_PATH, onOpen: () => this.deps.onPieces(), attrs: { 'data-key': 'pieces' } }),
      leadRow(TIER.club, { href: CLUB_PATH, onOpen: () => this.deps.onTheClub(), attrs: { 'data-key': 'club' } }),
      leadRow(ACCOUNT.legal, { href: LEGAL_PATH, newTab: true, attrs: { 'data-key': 'legal' } }),
    );
  }

  // ── A section's page ───────────────────────────────────────────────────────────────────────────────────────────────

  /** Back from a section, as the sheet's back and CANCEL do (YOUR ADDRESSES opened from YOUR PROFILE: back there). */
  private back(view: AccountView): void {
    if (view === 'sizes') this.closeSizes(null);
    else if (view === 'password') this.closePassword(null);
    else if (view === 'profile') this.closeProfile(null);
    else if (view === 'addresses') {
      if (this.addressesFromProfile) this.backToProfile();
      else this.closeAddresses();
    } else this.closeThread();
  }

  /**
   * The sheet's view of a section, laid out as a page: the crumb under the bar; its title on the left, its lead and what
   * it says now on the right; then its form (or list, or conversation) on the right's columns, 440 px at most for a
   * form; YOUR PROFILE's groups each a row, its label on the left and its fields on the right. Every element is the
   * view's own (its handlers, its states), only placed.
   */
  private sectionPage(view: AccountView): HTMLElement[] {
    const toProfile = view === 'addresses' && this.addressesFromProfile;
    const crumb = appAnchor(toProfile ? PATHS.profile : ACCOUNT_PATH, ['n-g', 'n-crumb', 'd-acct__crumb'], () => this.back(view), icon('back', { small: true }), toProfile ? ACCOUNT_PROFILE.backToProfile : MESSAGES.back);
    crumb.dataset.key = `${view}-back`;
    const built = view === 'sizes' ? this.sizesView() : view === 'password' ? this.passwordView() : view === 'profile' ? this.profileView() : view === 'addresses' ? this.addressesView() : this.messagesView();
    const parts: HTMLElement[] = built.length === 1 && built[0]!.tagName === 'SECTION' ? [...built[0]!.children].filter((c): c is HTMLElement => c instanceof HTMLElement) : built;

    // The title: the view's heading as the page's h1.
    const heading = parts.flatMap((p) => (p.matches('h3') ? [p] : [...p.querySelectorAll<HTMLElement>('h3[id]')]))[0] ?? null;
    const title = h('h1', { class: 'n-g d-acct__t1', id: heading?.id || TITLES[view], attrs: { tabindex: -1 }, text: heading?.textContent ?? '' });
    // Its own back (the crumb's place now) and the heading leave; what remains is placed.
    const rest = parts.filter((p) => !p.matches('h3, .n-messages__head'));
    const intro: HTMLElement[] = [];
    const body: HTMLElement[] = [];
    let form: HTMLFormElement | null = null;
    let cancel: HTMLElement | null = null;
    for (const p of rest) {
      if (p.matches('.n-account__sizes-lead, .n-account__password-lead, .n-profile__lead, .n-account__addresses-lead, .n-profile__completion, .n-profile__note, .n-account__addresses-note')) intro.push(p);
      else if (p.matches('.n-account__sizes-cancel, .n-profile__cancel')) cancel = p;
      else {
        if (p instanceof HTMLFormElement) form = p;
        // MESSAGES' reply, its form inside its box.
        else form ??= p.querySelector('form');
        body.push(p);
      }
    }
    // CANCEL beside SAVE, in one row (§10.22); without a form (ONE MOMENT…, could not be read), in the row of TRY AGAIN.
    if (cancel) {
      const b = cancel.querySelector('button');
      const actions = form?.querySelector<HTMLElement>(':scope > .n-form__actions');
      if (b && actions) {
        actions.classList.add('n-duo');
        actions.append(b);
      } else {
        const retry = body.find((p) => p.matches('.n-account__sizes-retry, .n-profile__retry'));
        if (b && retry) retry.append(b);
        else body.push(cancel);
      }
    }
    if (form) this.placeForm(view, form);
    const rows = view === 'profile' && form ? form : null;
    return [
      h('div', { class: 'd-acct__crumb-line' }, crumb),
      h(
        'section',
        { class: ['d-acct__sub', `d-acct__sub--${view}`], attrs: { 'aria-labelledby': title.id } },
        h('div', { class: 'd-acct__subhead' }, title, intro.length > 0 ? h('div', { class: 'd-acct__intro' }, ...intro) : null),
        h('div', { class: ['d-acct__body', rows ? 'd-acct__body--rows' : null] }, ...body),
      ),
    ];
  }

  /** A section's form laid out: its fields that pair side by side; YOUR PROFILE's groups each a row of the page. */
  private placeForm(view: AccountView, form: HTMLFormElement): void {
    form.classList.add('d-acct__form');
    // Every field its autocomplete (§10.22): COUNTRY's values are ISO codes (`country`), the date of birth in its three
    // parts, the phone's country code; the sizes and the question have none to fill.
    const autocomplete: Record<string, string> = {
      'profile-country': 'country',
      'profile-dob-day': 'bday-day',
      'profile-dob-month': 'bday-month',
      'profile-dob-year': 'bday-year',
      'profile-phone-code': 'tel-country-code',
      'profile-heard': 'off',
    };
    for (const select of form.querySelectorAll<HTMLSelectElement>('select')) {
      if (!select.hasAttribute('autocomplete')) select.setAttribute('autocomplete', autocomplete[select.id] ?? 'off');
    }
    if (view === 'sizes') {
      const fields = [...form.querySelectorAll<HTMLElement>(':scope > .n-fld-group')];
      if (fields.length > 0) {
        const grid = h('div', { class: 'd-acct__grid2' });
        fields[0]!.before(grid);
        grid.append(...fields);
      }
    } else if (view === 'addresses') {
      pair(form, '#account-address-country', '#account-address-phone');
    } else if (view === 'profile') {
      form.classList.add('d-acct__rows');
      pair(form, '#profile-first-name', '#profile-last-name');
      pair(form, '#profile-country', '#profile-city');
      pair(form, '#profile-phone-code', '#profile-phone-number');
      for (const group of form.querySelectorAll<HTMLElement>(':scope > .n-profile__group')) {
        const side = [group.querySelector(':scope > .n-profile__group-label'), group.querySelector(':scope > .n-profile__tastes-lead')].filter((x): x is Element => x !== null);
        const fields = [...group.children].filter((c) => !side.includes(c));
        group.classList.add('d-acct__row');
        group.replaceChildren(h('div', { class: 'd-acct__row-side' }, ...side), h('div', { class: 'd-acct__row-fields' }, ...fields));
      }
      // The confirmation of the date of birth, the form's failure and its actions: a last row, on the fields' side.
      const end = [...form.children].filter((c) => !c.classList.contains('n-profile__group'));
      if (end.length > 0) form.append(h('div', { class: 'd-acct__row d-acct__row--end' }, h('div', { class: 'd-acct__row-side' }), h('div', { class: 'd-acct__row-fields' }, ...end)));
    }
  }
}
