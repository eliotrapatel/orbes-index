/**
 * The account sheet (plan NOCTURNE, C2), opened by the header's account button (the tier's name and the monogram,
 * decision 11): a plate rising over the page under the header and the rail, the page dimmed above it.
 *
 *   ▬                                     the handle
 *   YOUR ACCOUNT                      ×   CLOSE (and Escape, and a tap on the dimmed page)
 *   SIGNED IN AS
 *   you@example.com
 *   YOUR TIER                             the club's tier (P-X04), moved here from MY PIECES (decision 10): the tier
 *   TITANE                2 pieces held   and the pieces it counts, its ten dots (one per piece up to PALLADIUM,
 *   ● ● ○ ○ ○ ○ ○ ○ ○ ○                   TIER_DOTS), IN USE (plan NEXT-NINE, BP-19 T10: the credit, the yearly
 *   IN USE  CREDIT  € 50 · UNTIL …        care, the welcome gift, when a row exists), the program's lines and the
 *                                         benefits of the tier and of those below it, NEXT and
 *                                         what it adds (PALLADIUM: the highest); without a
 *   – The owners' circle: …               tier, THE CLUB and what a first piece opens; a piece revoked or retired
 *   NEXT: PLATINE                         counts for none (the note); nothing when the status cannot be read
 *   3 more pieces … It adds:
 *   – Priority care …
 *   THE HOUSE’S GUARANTEE                 one block per guarantee shown to the client (plan NEXT-NINE, IN-01), under a
 *   A guaranteed place at …               hairline: what it covers, its RELEASE once set aside (a link to its page; TO BE
 *   RELEASE · …  PIECES · 1               REVEALED before a LIVE RELEASE's name), its pieces, until when, and that it is
 *   VALID UNTIL · 31 DECEMBER 2026        personal; nothing of a guarantee not shown
 *   ─────────────────────────────────
 *   MESSAGES                    NEW ›     the conversation with ORBES Client Services (plan NEXT-NINE, CS-01): NEW
 *                                         while an answer is unread; its view in the sheet (below)
 *   YOUR PROFILE        60% COMPLETE ›    the profile (plan CUSTOMER INTELLIGENCE §3.1 P.8), how complete it is, or
 *                                         COMPLETE; its view in the sheet (below)
 *   YOUR SIZES      RING 52 · WRIST … ›   the sizes saved (plan NEXT-NINE, AC-01), or NOT SET; its view in the sheet
 *   YOUR ADDRESSES          2 SAVED ›     the delivery addresses saved (plan NEXT LOT §3.6.B), or NOT SET; its view
 *   YOUR WISHLIST          3 MODELS ›     the models marked with the heart (plan CUSTOMER INTELLIGENCE §3.2 W.10.2), or
 *                                         NONE YET (nothing when unreadable); it opens its page, /verify/wishlist
 *   SOUND                         (●)     the sound signature (P-D07), as the footer's SOUND ON / OFF
 *   CHANGE PASSWORD                 ›     its form in the sheet (C39): the current password, a new one; CANCEL
 *   MY PIECES                       ›
 *   THE CLUB                        ›     the tiers and what each gives (BP-19 T9), in the app
 *   PRIVACY · TERMS · LEGAL · HELP  ›     the legal pages' index, in a new tab
 *   [            SIGN OUT            ]
 *
 * MESSAGES (CS-01): ‹ YOUR ACCOUNT, the title, the conversation oldest first and scrolled to the latest, each message
 * with its author line (YOU · 6 OCT 2026 · 14:02, or ORBES CLIENT SERVICES: staff are never named), on the collector's
 * the place it concerned (a link to it; a scan has none), the body as written; then YOUR REPLY (YOUR MESSAGE before the
 * first) and SEND. Opening it marks the conversation read. The collector never sees a status.
 *
 * YOUR SIZES (AC-01): the title and its lead, then RING SIZE, BRACELET SIZE, WRIST, FOR WATCHES and
 * NECKLACE LENGTH, each a select (NOT SET, then its range) with its unit as its hint; SAVE (filled) saves them whole and
 * the sheet comes back with 'Your sizes are saved.'; CANCEL comes back unchanged. A failure is said under the fields,
 * with the server's message. The fields open only on the sizes as read for this account: ONE MOMENT… until they are,
 * and, when they cannot be read, the sentence with the server's message, TRY AGAIN and CANCEL, and no SAVE (so that a
 * SAVE never clears a size it was not shown).
 *
 * YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8, §3.2 W.10.3): ‹ YOUR ACCOUNT, the title, its lead and how complete
 * the profile is (what is missing), then five groups: YOU (FIRST NAME, LAST NAME, DATE OF BIRTH: three selects, entered
 * once with a second press, CONFIRM YOUR DATE OF BIRTH, then read only with WRITE TO ORBES CLIENT SERVICES, which opens
 * MESSAGES), WHERE YOU ARE (COUNTRY, CITY, the default address of YOUR ADDRESSES and the way there and back, ‹ YOUR
 * PROFILE, what was typed kept), CONTACT (COUNTRY CODE, which follows COUNTRY, PHONE NUMBER, INSTAGRAM), YOUR TASTES
 * (FAVOURITE PIECES and FAVOURITE FINISHES two by two, a choice no longer in the collection pressed at the end, NO LONGER
 * IN THE COLLECTION under it) and HOW YOU FOUND ORBES; SAVE saves it whole with the version read, CANCEL goes back.
 * Read as it opens (ONE MOMENT…; unreadable, the sentence, the server's message and TRY AGAIN, no field); changed
 * meanwhile (409), it is read again and drawn as it is now, with the sentence.
 *
 * YOUR ADDRESSES (plan NEXT LOT §3.6.B): ‹ YOUR ACCOUNT (‹ YOUR PROFILE when opened from it), the title and its lead, then each address (its name, lines,
 * country and phone, DEFAULT on the default one) with EDIT · MAKE DEFAULT · REMOVE (TAP AGAIN TO REMOVE, then it goes);
 * ADD AN ADDRESS opens the four fields (views/address.ts) with MY DEFAULT ADDRESS, then SAVE and CANCEL; at five, a
 * sentence in its place. Read as it opens (ONE MOMENT…; unreadable, the sentence, the server's message and TRY AGAIN).
 * An order keeps its own copy: nothing here changes an order.
 *
 * A modal dialog: the page under it is inert and holds still; focus goes to its title and comes back to the account
 * button when it closes.
 */
import { h } from '../../shared/dom.js';
import { LEGAL_PATH } from '../../shared/legal.js';
import { ApiError, type ApiClient } from '../api.js';
import { addressesSummary, addressLines, mayAddAddress } from '../addresses-model.js';
import { countryName } from '../../../shared/countries.js';
import { ACCOUNT, ACCOUNT_ADDRESSES, ACCOUNT_PASSWORD, ACCOUNT_PROFILE, ACCOUNT_SIZES, MESSAGES, PIECES, SIGN_UP, SOUND, TASTES, TIER, WISHLIST } from '../copy.js';
import { CLUB_PATH } from '../club-model.js';
import { countryOptions } from '../addresses-model.js';
import { guaranteeBlocks } from '../guarantee-model.js';
import {
  birthDateOf,
  birthDateWords,
  codeOptions,
  completionLine,
  completionRow,
  dobOptions,
  draftOf,
  followCountry,
  heardIsOther,
  profileFromForm,
  refusalField,
  tasteGroups,
  tasteToggle,
  type Option,
  type ProfileDraft,
  type TasteChoice,
} from '../profile-model.js';
import { messageProblem, threadModel, type ConcerningTarget, type ThreadModel } from '../messages-model.js';
import type { SessionStore } from '../session.js';
import { SIZE_FIELDS, sizeFieldValue, sizeOptions, sizesFromForm, sizesSummary } from '../sizes-model.js';
import type { SoundSwitch } from '../sound.js';
import { tierModel } from '../tier-model.js';
import { WISHLIST_PATH, wishlistCount } from '../wishlist-model.js';
import { seen } from '../seen.js';
import { accountPageOf } from '../seen-model.js';
import type { AccountAddresses, AccountProfileView, AccountSizes, ClubStatus, SavedAddress, SizeKind } from '../types.js';
import { addressFields } from './address.js';
import { FormError, messageOf, MIN_PASSWORD, nocturneForm } from './forms.js';
import { button, definitionList, field, finishDot, icon, leadRow, selectField, switchControl, textLink, tierDots } from './nocturne.js';
import { PIECES_PATH, withNumerals } from './common.js';

/** Today in Paris, 'YYYY-MM-DD' (YEAR's latest choice is 13 years before it; the server is the judge). */
function parisToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface AccountSheetDeps {
  api: Pick<
    ApiClient,
    | 'clubStatus'
    | 'products'
    | 'changePassword'
    | 'logout'
    | 'messages'
    | 'writeMessage'
    | 'readMessages'
    | 'messagesUnread'
    | 'sizes'
    | 'saveSizes'
    | 'addresses'
    | 'createAddress'
    | 'updateAddress'
    | 'removeAddress'
    | 'makeDefaultAddress'
    | 'profile'
    | 'saveProfile'
    | 'wishlist'
  >;
  session: SessionStore;
  sound: SoundSwitch;
  /** MY PIECES, in the app. */
  onPieces(): void;
  /** THE CLUB's page, in the app (plan NEXT-NINE, BP-19 T9). */
  onTheClub(): void;
  /** YOUR WISHLIST's page, in the app (plan CUSTOMER INTELLIGENCE §3.2 W.10.2). */
  onWishlist(): void;
  /** The sound was switched here: the footer's SOUND says it too. */
  onSound(): void;
  /** The club's status was read here: the header's tier follows it. */
  onClub(club: ClubStatus | null): void;
  /** What the page holds outside the sheet, made inert while it is open. */
  outside(): HTMLElement[];
  /** A message's place in the app (MESSAGES' CONCERNING link): the sheet closes, the app opens it. */
  onConcerning(target: ConcerningTarget): void;
  /** NEW was read here (MESSAGES opened): NOW's line follows. */
  onRead?(): void;
}

type View = 'account' | 'password' | 'messages' | 'sizes' | 'addresses' | 'profile';

export class AccountSheet {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private trigger: HTMLElement | null = null;
  private view: View = 'account';
  /** The club's status and the pieces listed (for the note of a piece that counts for none); null until read, or unreadable. */
  private club: ClubStatus | null = null;
  private listed = 0;
  private notice: string | null = null;
  private busy = false;
  private readGen = 0;
  private soundInput: HTMLInputElement | null = null;
  /** An answer is unread (MESSAGES' NEW); false until read. */
  private unread = false;
  /** MESSAGES: the conversation as read, null while it reads (or unreadable: `threadError`). */
  private thread: ThreadModel | null = null;
  private threadError: string | null = null;
  private replyDraft = '';
  /**
   * YOUR SIZES (AC-01): the sizes saved, null until read for this opening (or unreadable: the row then says nothing of
   * them, and the view reads them before it shows its fields). Forgotten as the sheet closes: another account may sign in.
   */
  private sizes: AccountSizes | null = null;
  /** The view's own read of the sizes: why it failed (the server's message), null while it reads or once read. */
  private sizesError: string | null = null;
  private sizesGen = 0;
  /**
   * YOUR ADDRESSES (plan NEXT LOT §3.6.B): as read for this opening, null until (or unreadable: `addressesError`);
   * forgotten as the sheet closes, as the sizes are.
   */
  private addresses: AccountAddresses | null = null;
  private addressesError: string | null = null;
  private addressesGen = 0;
  /** The address being written: 'new' (ADD AN ADDRESS), an address's id (EDIT), or none. */
  private editing: string | null = null;
  /** What the view says once done: saved or removed (a status), or a failure (an alert). */
  private addressesNote: { text: string; error: boolean } | null = null;
  /** REMOVE pressed once: the address it would remove, until the second tap or a few seconds. */
  private removeArmed: string | null = null;
  private removeTimer: ReturnType<typeof setTimeout> | null = null;
  private addressBusy = false;
  /** YOUR ADDRESSES opened from YOUR PROFILE: its back link reads ‹ YOUR PROFILE and goes back there. */
  private addressesFromProfile = false;
  /** YOUR ADDRESSES opened on ADD AN ADDRESS (YOUR PROFILE without an address): its form, once the list is read. */
  private addAddressNext = false;
  /**
   * YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8): as read for this opening, null until (or unreadable:
   * `profileError`); forgotten as the sheet closes, as the sizes are.
   */
  private profile: AccountProfileView | null = null;
  private profileError: string | null = null;
  private profileGen = 0;
  /** What the view's fields hold while the sheet is open (as `replyDraft` keeps a reply); forgotten at close and CANCEL. */
  private profileDraft: ProfileDraft | null = null;
  /** A sentence said over the form drawn again (changed meanwhile, the date's refusals): an alert. */
  private profileNote: string | null = null;
  /** SAVE pressed once with a date of birth to enter: CONFIRM YOUR DATE OF BIRTH, until it is pressed again or the date changes. */
  private profileConfirm = false;
  /** YOUR WISHLIST's line (3 MODELS, NONE YET), read as the sheet opens; null until read, or unreadable (no line). */
  private wishCount: string | null = null;

  constructor(private readonly deps: AccountSheetDeps) {
    this.panel = h('section', { class: 'n-account__panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'account-title' } });
    this.el = h('div', { class: 'n-account', attrs: { hidden: true } }, h('div', { class: 'n-account__scrim', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.close() } }), this.panel);
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    });
    deps.session.subscribe((s) => {
      // Signed out here or elsewhere (a 401): the sheet has nothing left to show, and nothing of the account is kept.
      if (s.status !== 'signed-in') {
        if (this.isOpen) this.close();
        this.sizes = null;
        this.addresses = null;
        this.profile = null;
        this.profileDraft = null;
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** The club's status the header read (shown at once, read again as the sheet opens). */
  known(club: ClubStatus | null): void {
    this.club = club;
  }

  /** The sheet, opened on MESSAGES (SEE MESSAGES, NOW's READ); `trigger` gets the focus back when it closes. */
  openMessages(trigger: HTMLElement | null): void {
    if (this.deps.session.state.status !== 'signed-in') return;
    if (!this.isOpen) this.open(trigger ?? document.body);
    this.openThread();
  }

  open(trigger: HTMLElement): void {
    if (this.deps.session.state.status !== 'signed-in') return;
    this.trigger = trigger;
    this.view = 'account';
    this.notice = null;
    this.el.hidden = false;
    document.documentElement.classList.add('n-locked');
    for (const el of this.deps.outside()) el.inert = true;
    this.render();
    this.focusTitle();
    void this.read();
  }

  close(): void {
    if (!this.isOpen) return;
    this.readGen++;
    // The sizes are read again at the next opening, for whichever account is signed in then.
    this.sizesGen++;
    this.sizes = null;
    this.sizesError = null;
    this.addressesGen++;
    this.addresses = null;
    this.addressesError = null;
    this.editing = null;
    this.addressesNote = null;
    this.addressesFromProfile = false;
    this.addAddressNext = false;
    this.disarmRemove();
    this.profileGen++;
    this.profile = null;
    this.profileError = null;
    this.profileDraft = null;
    this.profileNote = null;
    this.profileConfirm = false;
    this.wishCount = null;
    // The sheet's view ends as it closes; the page under it counts again.
    seen.release(this);
    this.el.hidden = true;
    document.documentElement.classList.remove('n-locked');
    for (const el of this.deps.outside()) el.inert = false;
    this.panel.replaceChildren();
    this.soundInput = null;
    const back = this.trigger;
    this.trigger = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  /** The sound was switched elsewhere (the footer): the switch follows. */
  soundChanged(): void {
    if (this.soundInput) this.soundInput.checked = this.deps.sound.on;
  }

  private focusTitle(): void {
    this.panel.querySelector<HTMLElement>('#account-title')?.focus({ preventScroll: true });
  }

  /** The heading of the view open now (MESSAGES, YOUR SIZES): a screen reader says the view changed. */
  private focusView(): void {
    const id =
      this.view === 'messages'
        ? 'account-messages-title'
        : this.view === 'sizes'
          ? 'account-sizes-title'
          : this.view === 'addresses'
            ? 'account-addresses-title'
            : this.view === 'profile'
              ? 'account-profile-title'
              : 'account-title';
    this.panel.querySelector<HTMLElement>(`#${id}`)?.focus({ preventScroll: true });
  }

  /** The club's status and the pieces, read afresh: YOUR TIER as it is now. */
  private async read(): Promise<void> {
    const gen = ++this.readGen;
    const [club, pieces, unread, sizes, addresses, profile, wishlist] = await Promise.all([
      this.deps.api.clubStatus().catch((e: unknown) => {
        this.deps.session.noteError(e);
        return null;
      }),
      this.deps.api.products().catch(() => null),
      this.deps.api.messagesUnread().catch(() => false),
      this.deps.api.sizes().catch(() => null),
      this.deps.api.addresses().catch(() => null),
      this.deps.api.profile().catch(() => null),
      this.deps.api.wishlist().catch(() => null),
    ]);
    if (gen !== this.readGen || !this.isOpen) return;
    this.club = club;
    // Read or saved meanwhile in the sheet's own view: that stands. Read here first: an open view waiting for them shows them.
    if (this.sizes === null && sizes !== null) {
      this.sizes = sizes;
      if (this.view === 'sizes') this.showSizes();
    }
    if (this.addresses === null && addresses !== null) {
      this.addresses = addresses;
      if (this.view === 'addresses') this.showAddresses();
    }
    if (this.profile === null && profile !== null) {
      this.profile = profile;
      if (this.view === 'profile') this.showProfile();
    }
    // MESSAGES opened meanwhile has read it: NEW stays off.
    this.unread = this.view === 'messages' ? false : unread;
    this.listed = pieces?.length ?? 0;
    this.wishCount = wishlistCount(wishlist);
    this.deps.onClub(club);
    if (this.view === 'account') {
      const focused = this.panel.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
      const key = focused?.dataset.key;
      this.render();
      // The control that had the focus has it again, by its key; one without a key (or gone), the sheet's title.
      const again = key ? this.panel.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
      if (again) again.focus({ preventScroll: true });
      else if (focused) this.focusTitle();
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const s = this.deps.session.state;
    if (s.status !== 'signed-in') return;
    // The recording (plan CUSTOMER INTELLIGENCE §3.3 T.9): the sheet and its view cover the page while it is open; the
    // password screen pauses it and records nothing.
    seen.claim(this, accountPageOf(this.view), () => this.isOpen);
    const head = h(
      'div',
      { class: 'n-px n-sb n-account__head' },
      h('h2', { class: 'n-g n-lb', id: 'account-title', attrs: { tabindex: -1 }, text: ACCOUNT.title }),
      h('button', { class: 'n-account__close', attrs: { type: 'button', 'aria-label': ACCOUNT.close }, data: { key: 'close' }, on: { click: () => this.close() } }, icon('close')),
    );
    const body =
      this.view === 'password'
        ? this.passwordView()
        : this.view === 'messages'
          ? this.messagesView()
          : this.view === 'sizes'
            ? this.sizesView()
            : this.view === 'addresses'
              ? this.addressesView()
              : this.view === 'profile'
                ? this.profileView()
                : this.accountView(s.account.email);
    this.panel.replaceChildren(h('div', { class: 'n-handle', attrs: { 'aria-hidden': 'true' } }), head, ...body);
  }

  private accountView(email: string): HTMLElement[] {
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
    const out: (HTMLElement | null)[] = [
      h('div', { class: 'n-px' }, h('p', { class: 'n-g n-lb', text: ACCOUNT.signedInAs }), h('p', { class: 'n-account__email', text: email })),
      this.tierBlock(),
      ...this.guaranteeBlocks(),
      h(
        'div',
        { class: 'n-account__rows' },
        this.messagesRow(),
        this.profileRow(),
        this.sizesRow(),
        this.addressesRow(),
        this.wishlistRow(),
        h('label', { class: 'n-row n-account__sound' }, h('span', { class: 'n-g n-row__label', text: SOUND.label }), sw.el),
        leadRow(ACCOUNT_PASSWORD.change, { onOpen: () => this.openPassword(), attrs: { 'data-key': 'password' } }),
        leadRow(PIECES.link, {
          href: PIECES_PATH,
          onOpen: () => {
            this.close();
            this.deps.onPieces();
          },
          attrs: { 'data-key': 'pieces' },
        }),
        leadRow(TIER.club, {
          href: CLUB_PATH,
          onOpen: () => {
            this.close();
            this.deps.onTheClub();
          },
          attrs: { 'data-key': 'club' },
        }),
        leadRow(ACCOUNT.legal, { href: LEGAL_PATH, newTab: true, attrs: { 'data-key': 'legal' } }),
      ),
      this.notice ? h('p', { class: 'n-err n-account__notice', attrs: { role: 'status' }, text: this.notice }) : null,
      h('div', { class: 'n-px n-account__out' }, button(ACCOUNT.signOut, { outline: true, onClick: () => this.signOut(), attrs: { disabled: this.busy, 'data-key': 'sign-out' } })),
    ];
    return out.filter((x): x is HTMLElement => x !== null);
  }

  /**
   * YOUR TIER (P-X04), moved from MY PIECES (decision 10), as tier-model.ts reads it: the tier and the pieces it counts,
   * its ten dots (TIER_DOTS), the benefits of the tier and of those below it, NEXT and what it adds (PALLADIUM: the highest);
   * without a tier, THE CLUB and what a first piece opens; the note of a piece that counts for none. Nothing when the
   * status could not be read.
   */
  private tierBlock(): HTMLElement | null {
    if (!this.club) return null;
    const m = tierModel(this.club, this.listed);
    const list = (items: string[], extra?: string) =>
      items.length ? h('ul', { class: ['n-account__benefits', extra] }, ...items.map((l) => h('li', { class: 'n-sm n-account__benefit', text: l }))) : null;
    const parts: (HTMLElement | null)[] = [
      h('p', { class: 'n-g n-lb', id: 'account-tier', text: m.label }),
      m.badge
        ? h('div', { class: 'n-sb n-account__badge', data: { tier: m.badge.name } }, h('span', { class: 'n-g n-t2 n-account__tier-name', text: m.badge.name }), h('span', { class: 'n-sm n-account__tier-pieces', text: m.badge.pieces }))
        : null,
      m.meter ? tierDots(m.meter.on, m.meter.of, { start: true }) : null,
      m.inUse
        ? h(
            'div',
            { class: 'n-account__in-use', attrs: { 'aria-labelledby': 'account-in-use' } },
            h('p', { class: 'n-g n-lb n-account__in-use-label', id: 'account-in-use', text: m.inUse.label }),
            definitionList(m.inUse.rows, { kind: 'kv', extraClass: 'n-account__in-use-rows' }),
            m.inUse.note ? h('p', { class: 'n-sm n-account__in-use-note', text: m.inUse.note }) : null,
          )
        : null,
      list(m.benefits),
      m.next
        ? h(
            'div',
            { class: 'n-account__next' },
            m.badge ? h('p', { class: 'n-g n-lb n-account__next-label', text: m.next.label }) : null,
            h('p', { class: 'n-sm n-account__next-way', text: m.next.sentence }),
            list(m.next.benefits, 'n-account__benefits--next'),
          )
        : null,
      m.top ? h('p', { class: 'n-sm n-account__top', text: m.top }) : null,
      m.note ? h('p', { class: 'n-sm n-account__note', text: m.note }) : null,
    ];
    const dots = parts[2];
    dots?.classList.add('n-account__dots');
    return h(
      'section',
      { class: ['n-px', 'n-account__tier', m.badge ? null : 'n-account__club'], attrs: { 'aria-labelledby': 'account-tier' } },
      ...parts.filter((p): p is HTMLElement => p !== null),
    );
  }

  /** THE HOUSE'S GUARANTEE (IN-01): one block per guarantee shown to the client, under YOUR TIER; none without one. */
  private guaranteeBlocks(): HTMLElement[] {
    return guaranteeBlocks(this.club).map((b) =>
      h(
        'section',
        { class: 'n-px n-account__guarantee', attrs: { 'aria-labelledby': `account-guarantee-${b.id}` } },
        h('p', { class: 'n-g n-lb', id: `account-guarantee-${b.id}`, text: b.title }),
        h('p', { class: 'n-sm n-account__guarantee-sentence' }, ...withNumerals(b.sentence)),
        definitionList(
          b.rows.map((r) => [
            r.label,
            r.releaseId
              ? textLink(r.value, { href: r.href, onOpen: () => this.toConcerning({ to: 'release', id: r.releaseId! }), extraClass: 'n-account__guarantee-release' })
              : h('span', null, ...withNumerals(r.value)),
          ]),
          { kind: 'kv', extraClass: 'n-account__guarantee-rows' },
        ),
        h('p', { class: 'n-sm n-account__guarantee-note', text: b.note }),
      ),
    );
  }

  // ── MESSAGES (plan NEXT-NINE, CS-01) ─────────────────────────────────────

  /** The first row: MESSAGES, NEW at its right while an answer is unread (no number, no badge on the header). */
  private messagesRow(): HTMLElement {
    const row = leadRow(MESSAGES.title, { onOpen: () => this.openThread(), attrs: { 'data-key': 'messages' }, extraClass: 'n-account__messages' });
    if (this.unread) row.insertBefore(h('span', { class: 'n-g n-lb n-ivc n-row__new', text: MESSAGES.new }), row.lastChild);
    return row;
  }

  private openThread(): void {
    this.view = 'messages';
    this.notice = null;
    this.thread = null;
    this.threadError = null;
    this.render();
    this.focusView();
    void this.readThread();
  }

  private closeThread(): void {
    this.view = 'account';
    this.render();
    this.panel.querySelector<HTMLElement>('[data-key="messages"]')?.focus({ preventScroll: true });
  }

  /** The conversation, read; then read up to its latest message (NEW and NOW's line go). */
  private async readThread(focusReply = false): Promise<void> {
    const gen = ++this.readGen;
    try {
      const t = await this.deps.api.messages();
      if (gen !== this.readGen || !this.isOpen || this.view !== 'messages') return;
      this.thread = threadModel(t, -new Date().getTimezoneOffset());
      this.threadError = null;
      this.unread = false;
      if (this.thread.readUpTo && t.unread) {
        void this.deps.api.readMessages(this.thread.readUpTo).then(
          () => this.deps.onRead?.(),
          () => undefined,
        );
      }
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.readGen || !this.isOpen) return;
      this.threadError = messageOf(e);
    }
    this.render();
    const list = this.panel.querySelector<HTMLElement>('.n-messages__list');
    list?.lastElementChild?.scrollIntoView({ block: 'end' });
    if (focusReply) this.panel.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true });
    else this.focusView();
  }

  private messagesView(): HTMLElement[] {
    const back = h(
      'button',
      { class: 'n-g n-tl n-messages__back', attrs: { type: 'button' }, data: { key: 'messages-back' }, on: { click: () => this.closeThread() } },
      icon('back', { small: true }),
      MESSAGES.back,
    );
    const t = this.thread;
    const out: (HTMLElement | null)[] = [
      h('div', { class: 'n-px n-messages__head' }, back, h('h3', { class: 'n-g n-t3 n-ivc n-messages__title', id: 'account-messages-title', attrs: { tabindex: -1 }, text: MESSAGES.title })),
    ];
    if (this.threadError) out.push(h('p', { class: 'n-px n-err n-messages__error', attrs: { role: 'alert' }, text: this.threadError }));
    if (!t) {
      if (!this.threadError) out.push(h('p', { class: 'n-px n-g n-lb n-messages__loading', attrs: { role: 'status' }, text: PIECES.loading }));
      return out.filter((x): x is HTMLElement => x !== null);
    }
    if (t.empty) out.push(h('p', { class: 'n-px n-sm n-messages__empty', text: t.empty }));
    if (t.items.length > 0) {
      out.push(
        h(
          'ol',
          { class: 'n-px n-messages__list', attrs: { 'aria-label': MESSAGES.title } },
          ...t.items.map((m) =>
            h(
              'li',
              { class: ['n-messages__item', m.mine ? 'n-messages__item--mine' : null], attrs: { 'data-testid': 'message' } },
              h('p', { class: 'n-g n-lb n-messages__author' }, ...withNumerals(m.author)),
              m.concerning
                ? h(
                    'p',
                    { class: 'n-messages__concerning' },
                    h('span', { class: 'n-g n-lb', text: `${MESSAGES.concerning} ` }),
                    m.concerning.target
                      ? textLink(m.concerning.label, { onOpen: () => this.toConcerning(m.concerning!.target!), extraClass: 'n-messages__link' })
                      : h('span', { class: 'n-g n-lb n-ivc', text: m.concerning.label }),
                  )
                : null,
              h('p', { class: 'n-tx n-messages__body', text: m.body }),
            ),
          ),
        ),
      );
    }
    out.push(this.replyForm(t.replyLabel));
    return out.filter((x): x is HTMLElement => x !== null);
  }

  private toConcerning(target: ConcerningTarget): void {
    this.close();
    this.deps.onConcerning(target);
  }

  /** YOUR REPLY (YOUR MESSAGE before the first) and SEND: a message written from MESSAGES carries no context. */
  private replyForm(label: string): HTMLElement {
    const area = h('textarea', {
      class: 'n-fld__input n-write__area',
      id: 'messages-reply',
      attrs: { name: 'message', rows: 4, maxlength: MESSAGES.max, required: true, 'aria-describedby': 'messages-reply-hint', autocomplete: 'off' },
    });
    area.value = this.replyDraft;
    area.addEventListener('input', () => {
      this.replyDraft = area.value;
    });
    const field = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'messages-reply' } }, h('span', { class: 'n-g n-lab', text: label })),
      area,
      h('p', { class: 'n-sm n-fld__hint', id: 'messages-reply-hint', text: MESSAGES.hint }),
    );
    const form = nocturneForm(this.deps.session, 'reply', [field], MESSAGES.send, async () => {
      const problem = messageProblem(area.value);
      if (problem) {
        area.setAttribute('aria-invalid', 'true');
        throw new FormError(problem);
      }
      await this.deps.api.writeMessage(area.value.replace(/\r\n?/g, '\n').trim(), null);
      this.replyDraft = '';
      await this.readThread(true);
    });
    return h('div', { class: 'n-px n-messages__reply' }, form);
  }

  // ── YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8) ──────────────────

  /** The row after MESSAGES: YOUR PROFILE, its line how complete it is (`60% COMPLETE`, or COMPLETE); nothing while unread. */
  private profileRow(): HTMLElement {
    const row = leadRow(ACCOUNT_PROFILE.row, { onOpen: () => this.openProfile(), attrs: { 'data-key': 'profile' }, extraClass: 'n-account__sizes n-account__profile' });
    if (this.profile) row.insertBefore(h('span', { class: 'n-g n-lb n-row__value n-account__profile-line' }, ...withNumerals(completionRow(this.profile.completion))), row.lastChild);
    return row;
  }

  private openProfile(): void {
    this.view = 'profile';
    this.notice = null;
    this.profileError = null;
    this.profileNote = null;
    this.profileConfirm = false;
    this.render();
    this.focusView();
    // Not read yet (or unreadable): read it before the fields show, ONE MOMENT… meanwhile.
    if (this.profile === null) void this.readProfile();
  }

  /** The profile read for the view: its fields once it is, or the sentence and the server's message. */
  private async readProfile(): Promise<void> {
    const gen = ++this.profileGen;
    try {
      const profile = await this.deps.api.profile();
      if (gen !== this.profileGen || !this.isOpen) return;
      this.profile = profile;
      this.profileError = null;
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.profileGen || !this.isOpen) return;
      this.profileError = messageOf(e);
    }
    if (this.view === 'profile') this.showProfile();
  }

  /** The view drawn again (its profile read, or not), the focus on `focus` when given, else on its title. */
  private showProfile(focus?: string): void {
    this.render();
    const at = focus ? this.panel.querySelector<HTMLElement>(focus) : null;
    if (at) at.focus({ preventScroll: true });
    else this.focusView();
  }

  /** Back to the account view (`notice` said there), the focus on YOUR PROFILE's row. */
  private closeProfile(notice: string | null): void {
    this.view = 'account';
    this.notice = notice;
    this.profileNote = null;
    this.profileConfirm = false;
    this.render();
    this.panel.querySelector<HTMLElement>('[data-key="profile"]')?.focus({ preventScroll: true });
  }

  /**
   * Back from YOUR ADDRESSES to YOUR PROFILE: what was typed is kept (the draft), the address block read again (the
   * default address, how many are saved, how complete the profile is), never the fields.
   */
  private backToProfile(): void {
    this.view = 'profile';
    this.addressesFromProfile = false;
    this.addAddressNext = false;
    this.editing = null;
    this.addressesNote = null;
    this.disarmRemove();
    this.profileNote = null;
    this.profileConfirm = false;
    this.showProfile('[data-key="profile-addresses"]');
    const gen = ++this.profileGen;
    void this.deps.api.profile().then(
      (read) => {
        if (gen !== this.profileGen || !this.isOpen || !this.profile) return;
        this.profile = { ...this.profile, address: read.address, addresses: read.addresses, completion: read.completion };
        if (this.view !== 'profile') return;
        const key = this.panel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
        this.showProfile(key ? `[data-key="${key}"]` : undefined);
      },
      (e: unknown) => this.deps.session.noteError(e),
    );
  }

  /**
   * YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.8.2, P.8.3): the title, its lead, how complete it is, then the five
   * groups and SAVE, CANCEL under it. Until the profile is read, ONE MOMENT…; when it cannot be, the sentence and TRY
   * AGAIN, no field, no SAVE.
   */
  private profileView(): HTMLElement[] {
    const P = ACCOUNT_PROFILE;
    const back = h(
      'button',
      { class: 'n-g n-tl n-messages__back', attrs: { type: 'button' }, data: { key: 'profile-back' }, on: { click: () => this.closeProfile(null) } },
      icon('back', { small: true }),
      MESSAGES.back,
    );
    const cancel = button(P.cancel, {
      outline: true,
      onClick: () => {
        // CANCEL goes back unchanged: what was typed is dropped.
        this.profileDraft = null;
        this.closeProfile(null);
      },
    });
    const head = [
      h('div', { class: 'n-messages__head' }, back, h('h3', { class: 'n-g n-t3 n-ivc n-messages__title', id: 'account-profile-title', attrs: { tabindex: -1 }, text: P.title })),
      h('p', { class: 'n-tx n-profile__lead', text: P.lead }),
    ];
    const section = (...children: (HTMLElement | null)[]) =>
      h('section', { class: 'n-px n-profile', attrs: { 'aria-labelledby': 'account-profile-title' } }, ...head, ...children.filter((c): c is HTMLElement => c !== null));
    const view = this.profile;
    if (view === null) {
      return [
        section(
          ...(this.profileError
            ? [
                h('p', { class: 'n-err n-profile__error', attrs: { role: 'alert' }, text: `${P.unreadable} ${this.profileError}` }),
                h('div', { class: 'n-profile__retry' }, button(P.retry, { outline: true, onClick: () => this.openProfile() })),
              ]
            : [h('p', { class: 'n-g n-lb n-profile__loading', attrs: { role: 'status' }, text: P.loading })]),
          h('div', { class: 'n-profile__cancel' }, cancel),
        ),
      ];
    }
    const d = (this.profileDraft ??= draftOf(view));
    return [
      section(
        h('p', { class: 'n-sm n-ivc n-profile__completion', attrs: { role: 'status' } }, ...withNumerals(completionLine(view.completion))),
        this.profileNote ? h('p', { class: 'n-err n-profile__note', attrs: { role: 'alert', tabindex: -1 }, text: this.profileNote }) : null,
        this.profileForm(view, d),
        h('div', { class: 'n-profile__cancel' }, cancel),
      ),
    ];
  }

  /** A group's label (YOU, WHERE YOU ARE, …): the label face, a hairline over it. */
  private profileGroup(id: string, label: string, ...children: (HTMLElement | null)[]): HTMLElement {
    return h(
      'div',
      { class: 'n-profile__group', attrs: { role: 'group', 'aria-labelledby': id } },
      h('p', { class: 'n-g n-lb n-profile__group-label', id, text: label }),
      ...children.filter((c): c is HTMLElement => c !== null),
    );
  }

  /** A text field of the view, its value the draft's, the draft following what is typed. */
  private profileInput(id: string, label: string, value: string, attrs: Record<string, string | number | boolean>, onInput: (v: string) => void, hint?: string): { el: HTMLElement; input: HTMLInputElement } {
    const input = h('input', { attrs: { type: 'text', ...attrs } });
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return { el: field(id, label, input, hint), input };
  }

  /** A select of the view, the draft following what is chosen. */
  private profileSelect(id: string, label: string, options: readonly Option[], value: string, onChange: (v: string) => void, hint?: string): { el: HTMLElement; select: HTMLSelectElement } {
    const f = selectField(id, label, options, value, hint);
    f.select.addEventListener('change', () => onChange(f.select.value));
    return f;
  }

  private profileForm(view: AccountProfileView, d: ProfileDraft): HTMLFormElement {
    const P = ACCOUNT_PROFILE;
    const p = view.profile;
    const armed = birthDateOf(d.day, d.month, d.year);
    if (armed.kind !== 'date' || p.birthDate !== null || p.birthDateLocked) this.profileConfirm = false;
    const first = this.profileInput('profile-first-name', P.firstName, d.firstName, { name: 'given-name', autocomplete: 'given-name', autocapitalize: 'words', maxlength: 50 }, (v) => (d.firstName = v));
    const last = this.profileInput('profile-last-name', P.lastName, d.lastName, { name: 'family-name', autocomplete: 'family-name', autocapitalize: 'words', maxlength: 50 }, (v) => (d.lastName = v));

    // DATE OF BIRTH: entered once (three selects, then CONFIRM YOUR DATE OF BIRTH), else read only.
    const confirmLine = h('p', { class: 'n-sm n-ivc n-profile__confirm', attrs: { role: 'status', hidden: true } });
    let submit: HTMLButtonElement | null = null;
    const disarm = () => {
      if (!this.profileConfirm) return;
      this.profileConfirm = false;
      confirmLine.hidden = true;
      confirmLine.textContent = '';
      if (submit) submit.textContent = P.save;
    };
    const dobSelects: HTMLSelectElement[] = [];
    let dob: HTMLElement;
    const writeLink = () => {
      const l = textLink(P.write, { onOpen: () => this.openThread(), extraClass: 'n-profile__write' });
      l.dataset.key = 'profile-write';
      return l;
    };
    if (p.birthDate !== null || p.birthDateLocked) {
      dob = h(
        'div',
        { class: 'n-fld-group n-profile__dob-set' },
        h('p', { class: 'n-fld' }, h('span', { class: 'n-g n-lab', id: 'profile-dob-label', text: P.birthDate })),
        p.birthDate !== null ? h('p', { class: 'n-tx n-ivc n-profile__dob-date' }, ...withNumerals(birthDateWords(p.birthDate))) : null,
        h('p', { class: 'n-sm n-fld__hint', text: p.birthDate !== null ? P.birthSet : P.birthCleared }),
        h('p', { class: 'n-profile__write-line' }, writeLink()),
      );
    } else {
      const o = dobOptions(parisToday());
      const part = (id: string, label: string, options: readonly Option[], key: 'day' | 'month' | 'year') => {
        const select = h('select', { class: 'n-fld__input n-fld__select-input n-num', id, attrs: { name: id, 'aria-label': label } }, ...options.map((x) => h('option', { attrs: { value: x.value }, text: x.label })));
        select.value = d[key];
        select.addEventListener('change', () => {
          d[key] = select.value;
          // Any change to the date goes back to SAVE.
          disarm();
        });
        const chevron = icon('chev', { small: true });
        chevron.classList.add('n-fld__chev');
        dobSelects.push(select);
        return h('div', { class: 'n-fld__select' }, select, chevron);
      };
      dob = h(
        'div',
        { class: 'n-fld-group n-profile__dob-group', attrs: { role: 'group', 'aria-labelledby': 'profile-dob-label', 'aria-describedby': 'profile-dob-hint' } },
        h('p', { class: 'n-fld' }, h('span', { class: 'n-g n-lab', id: 'profile-dob-label', text: P.birthDate })),
        h('div', { class: 'n-profile__dob' }, part('profile-dob-day', P.day, o.days, 'day'), part('profile-dob-month', P.month, o.months, 'month'), part('profile-dob-year', P.year, o.years, 'year')),
        h('p', { class: 'n-sm n-fld__hint', id: 'profile-dob-hint', text: P.birthHint }),
      );
    }

    // WHERE YOU ARE: COUNTRY (no empty choice once set), CITY, the default address of YOUR ADDRESSES.
    const countries = countryOptions(SIGN_UP.chooseCountry).filter((o) => !(p.country && o.value === ''));
    const code = this.profileSelect('profile-phone-code', P.phoneCode, codeOptions(), d.phoneCode, (v) => {
      d.phoneCode = v;
      d.codeChanged = true;
    });
    const country = this.profileSelect('profile-country', P.country, countries, d.country, (v) => {
      d.country = v;
      // The phone's code follows the country, while the number is empty or the code was never changed by hand.
      d.phoneCode = followCountry({ code: d.phoneCode, codeChanged: d.codeChanged, number: d.phoneNumber }, v);
      code.select.value = d.phoneCode;
    });
    const city = this.profileInput('profile-city', P.city, d.city, { name: 'city', autocomplete: 'address-level2', maxlength: 80 }, (v) => (d.city = v));
    const address = view.address
      ? h(
          'div',
          { class: 'n-fld-group n-profile__address' },
          h('p', { class: 'n-fld' }, h('span', { class: 'n-g n-lab', text: P.address })),
          h(
            'p',
            { class: 'n-tx n-ivc n-profile__address-line' },
            [view.address.name, view.address.firstLine, countryName(view.address.country)].filter(Boolean).join(' · '),
            ' ',
            h('span', { class: 'n-g n-lb n-profile__address-default', text: P.isDefault }),
          ),
          h('p', { class: 'n-sm n-fld__hint', text: P.addressHint }),
          h('p', { class: 'n-profile__write-line' }, this.profileAddressesLink()),
        )
      : h(
          'div',
          { class: 'n-fld-group n-profile__address' },
          h('p', { class: 'n-fld' }, h('span', { class: 'n-g n-lab', text: P.address })),
          h('p', { class: 'n-sm n-profile__address-none', text: P.addressNone }),
          h(
            'div',
            { class: 'n-profile__address-add' },
            button(P.addressAdd, { outline: true, attrs: { 'data-key': 'profile-addresses' }, onClick: () => this.openAddresses({ fromProfile: true, add: true }) }),
          ),
        );

    // CONTACT: COUNTRY CODE, then PHONE NUMBER, stacked; INSTAGRAM after its fixed @.
    const number = h('input', { attrs: { type: 'tel', name: 'tel-national', inputmode: 'tel', autocomplete: 'tel-national', maxlength: 20 } });
    number.value = d.phoneNumber;
    number.addEventListener('input', () => (d.phoneNumber = number.value));
    const instagram = h('input', { class: 'n-profile__ig-input', attrs: { type: 'text', name: 'instagram', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: 60 } });
    instagram.value = d.instagram;
    instagram.addEventListener('input', () => (d.instagram = instagram.value));
    instagram.id = 'profile-instagram';
    instagram.classList.add('n-fld__input');
    instagram.setAttribute('aria-describedby', 'profile-instagram-hint');
    const instagramField = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'profile-instagram' } }, h('span', { class: 'n-g n-lab', text: P.instagram })),
      h('div', { class: 'n-profile__ig' }, h('span', { class: 'n-profile__at', attrs: { 'aria-hidden': 'true' }, text: '@' }), instagram),
      h('p', { class: 'n-sm n-fld__hint', id: 'profile-instagram-hint', text: P.instagramHint }),
    );

    // HOW YOU FOUND ORBES: the answers offered (the saved one kept when set aside), IN A FEW WORDS with Other only.
    const other = this.profileInput('profile-heard-other', P.other, d.heardOther, { name: 'heard-other', autocomplete: 'off', maxlength: 100 }, (v) => (d.heardOther = v));
    other.el.hidden = !heardIsOther(view, d.heardId);
    const heard = this.profileSelect('profile-heard', P.heard, [{ value: '', label: P.choose }, ...view.options.heard.map((o) => ({ value: o.id, label: o.label }))], d.heardId, (v) => {
      d.heardId = v;
      other.el.hidden = !heardIsOther(view, v);
    });

    const tastes = this.tastesBlock(view, d);
    const byField: Record<string, HTMLElement | undefined> = {
      firstName: first.input,
      lastName: last.input,
      country: country.select,
      city: city.input,
      phoneCode: code.select,
      phoneNumber: number,
      birthDate: dobSelects[0],
      instagram,
      heard: heard.select,
      tastes: tastes?.querySelector<HTMLElement>('.n-opt2__option') ?? undefined,
    };
    const form = nocturneForm(
      this.deps.session,
      'profile',
      [
        this.profileGroup('profile-group-you', P.groups.you, first.el, last.el, dob),
        this.profileGroup('profile-group-where', P.groups.where, country.el, city.el, address),
        this.profileGroup('profile-group-contact', P.groups.contact, code.el, field('profile-phone-number', P.phoneNumber, number, P.phoneHint), instagramField),
        tastes,
        this.profileGroup('profile-group-found', P.groups.found, heard.el, other.el),
        confirmLine,
      ].filter((x): x is HTMLElement => x !== null),
      this.profileConfirm ? P.birthConfirm : P.save,
      async () => {
        const date = birthDateOf(d.day, d.month, d.year);
        if (date.kind === 'partial') {
          dobSelects.find((x) => x.value === '')?.setAttribute('aria-invalid', 'true');
          throw new FormError(P.birthPartial);
        }
        // Entering the date of birth asks a second press: CONFIRM YOUR DATE OF BIRTH.
        if (date.kind === 'date' && p.birthDate === null && !p.birthDateLocked && !this.profileConfirm) {
          this.profileConfirm = true;
          confirmLine.textContent = P.birthConfirmLine(birthDateWords(date.date));
          confirmLine.hidden = false;
          if (submit) submit.textContent = P.birthConfirm;
          return;
        }
        try {
          this.profile = await this.deps.api.saveProfile(profileFromForm(d, view));
        } catch (e) {
          this.deps.session.noteError(e);
          if (e instanceof ApiError && (e.code === 'PROFILE_CHANGED' || e.code === 'BIRTH_DATE_SET' || e.code === 'BIRTH_DATE_ENTERED')) {
            // Read again and drawn as it is now; what was typed is not kept (it may conflict with the change).
            this.profileDraft = null;
            this.profileConfirm = false;
            this.profileNote = e.code === 'PROFILE_CHANGED' ? P.changed : e.message;
            this.profile = null;
            await this.readProfile();
            this.panel.querySelector<HTMLElement>('.n-profile__note')?.focus({ preventScroll: true });
            return;
          }
          if (e instanceof ApiError && e.code === 'HEARD_UNAVAILABLE') {
            // The answer was set aside meanwhile: the answers read again, the saved one put back, what was typed kept.
            const read = await this.deps.api.profile().catch(() => null);
            if (read && this.profile) this.profile = { ...this.profile, options: read.options };
            d.heardId = this.profile?.profile.heard?.optionId ?? '';
            this.profileConfirm = false;
            this.profileNote = `${P.failed} ${e.message}`;
            this.showProfile('#profile-heard');
            return;
          }
          const named = e instanceof ApiError ? refusalField(e.code, e.message) : null;
          if (named) byField[named]?.setAttribute('aria-invalid', 'true');
          throw new FormError(`${P.failed} ${messageOf(e)}`);
        }
        this.profileDraft = null;
        this.closeProfile(P.saved);
      },
    );
    submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    // Drawn again while CONFIRM YOUR DATE OF BIRTH is asked (after YOUR ADDRESSES and back): its line with it.
    if (armed.kind === 'date' && this.profileConfirm) {
      confirmLine.textContent = P.birthConfirmLine(birthDateWords(armed.date));
      confirmLine.hidden = false;
    }
    return form;
  }

  /** YOUR ADDRESSES › from YOUR PROFILE: its view, its back link ‹ YOUR PROFILE. */
  private profileAddressesLink(): HTMLElement {
    const l = textLink(ACCOUNT_PROFILE.addresses, { onOpen: () => this.openAddresses({ fromProfile: true }), extraClass: 'n-profile__addresses' });
    l.dataset.key = 'profile-addresses';
    return l;
  }

  /**
   * YOUR TASTES (plan CUSTOMER INTELLIGENCE §3.2 W.10.3): FAVOURITE PIECES and FAVOURITE FINISHES, two by two, each
   * choice a button pressed or not (a finish with its dot), a choice no longer in the collection at the end with NO LONGER
   * IN THE COLLECTION under it; up to 30 of each ('Up to 30.'). A group with nothing to choose is not shown; neither is
   * the block when both are empty.
   */
  private tastesBlock(view: AccountProfileView, d: ProfileDraft): HTMLElement | null {
    const groups = tasteGroups(view, d);
    if (groups.pieces.length === 0 && groups.finishes.length === 0) return null;
    const group = (kind: 'pieces' | 'finishes', label: string, choices: TasteChoice[]) => {
      if (choices.length === 0) return null;
      const id = `profile-tastes-${kind}`;
      const max = h('p', { class: 'n-sm n-ivc n-profile__tastes-max', attrs: { role: 'status', hidden: true }, text: TASTES.max });
      const cell = (c: TasteChoice) => {
        const retiredId = c.retired ? `profile-taste-${kind}-${c.key.replace(/[^A-Z0-9]+/g, '-').toLowerCase()}-retired` : null;
        const b = h(
          'button',
          {
            class: 'n-g n-opt2__option n-profile__taste',
            attrs: { type: 'button', 'aria-pressed': String(c.pressed), 'aria-describedby': retiredId },
            data: { key: `taste-${kind}-${c.key}` },
            on: {
              click: () => {
                const r = tasteToggle(d[kind], c.key);
                max.hidden = !r.refused;
                d[kind] = r.keys;
                b.setAttribute('aria-pressed', String(r.keys.includes(c.key)));
              },
            },
          },
          kind === 'finishes' && c.swatch ? finishDot(c.swatch, c.label) : c.label,
        );
        return h('div', { class: 'n-profile__taste-cell' }, b, retiredId ? h('p', { class: 'n-sm n-profile__taste-retired', id: retiredId, text: TASTES.retired }) : null);
      };
      return h(
        'div',
        { class: 'n-profile__tastes-group' },
        h('p', { class: 'n-fld' }, h('span', { class: 'n-g n-lab', id, text: label })),
        h('p', { class: 'n-sm n-fld__hint', text: TASTES.hint }),
        h('div', { class: 'n-opt2 n-profile__tastes', attrs: { role: 'group', 'aria-labelledby': id } }, ...choices.map(cell)),
        max,
      );
    };
    return this.profileGroup(
      'profile-group-tastes',
      ACCOUNT_PROFILE.groups.tastes,
      h('p', { class: 'n-sm n-profile__tastes-lead', text: TASTES.lead }),
      group('pieces', TASTES.pieces, groups.pieces),
      group('finishes', TASTES.finishes, groups.finishes),
    );
  }

  // ── YOUR SIZES (plan NEXT-NINE, AC-01) ───────────────────────────────────

  /** The second row: YOUR SIZES, its line the sizes saved (`RING 52 · WRIST 16.5 CM`) or NOT SET; nothing while unread. */
  private sizesRow(): HTMLElement {
    const row = leadRow(ACCOUNT_SIZES.row, { onOpen: () => this.openSizes(), attrs: { 'data-key': 'sizes' }, extraClass: 'n-account__sizes' });
    if (this.sizes) row.insertBefore(h('span', { class: 'n-g n-lb n-row__value n-account__sizes-line' }, ...withNumerals(sizesSummary(this.sizes))), row.lastChild);
    return row;
  }

  private openSizes(): void {
    this.view = 'sizes';
    this.notice = null;
    this.sizesError = null;
    this.render();
    this.focusView();
    // Not read yet (or unreadable): read them before the fields show, ONE MOMENT… meanwhile.
    if (this.sizes === null) void this.readSizes();
  }

  /** The sizes read for the view: its fields once they are, or the sentence and the server's message. */
  private async readSizes(): Promise<void> {
    const gen = ++this.sizesGen;
    try {
      const sizes = await this.deps.api.sizes();
      // Read meanwhile by the sheet's own read (its fields already drawn): those stand.
      if (gen !== this.sizesGen || !this.isOpen || this.sizes !== null) return;
      this.sizes = sizes;
      this.sizesError = null;
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.sizesGen || !this.isOpen || this.sizes !== null) return;
      this.sizesError = messageOf(e);
    }
    if (this.view === 'sizes') this.showSizes();
  }

  /** The view drawn again once its sizes are read (or could not be), the focus on its title. */
  private showSizes(): void {
    this.render();
    this.focusView();
  }

  private closeSizes(notice: string | null): void {
    this.view = 'account';
    this.notice = notice;
    this.render();
    this.panel.querySelector<HTMLElement>('[data-key="sizes"]')?.focus({ preventScroll: true });
  }

  /**
   * The four sizes, each a select (NOT SET, then its range), its unit as its hint; SAVE saves them whole, CANCEL under it
   * goes back. Until the sizes are read, ONE MOMENT…; when they cannot be, the sentence and TRY AGAIN, no field, no SAVE.
   */
  private sizesView(): HTMLElement[] {
    const cancel = button(ACCOUNT_SIZES.cancel, { outline: true, onClick: () => this.closeSizes(null) });
    const head = [h('h3', { class: 'n-g n-t3 n-ivc', id: 'account-sizes-title', attrs: { tabindex: -1 }, text: ACCOUNT_SIZES.title }), h('p', { class: 'n-tx n-account__sizes-lead', text: ACCOUNT_SIZES.lead })];
    const saved = this.sizes;
    if (saved === null) {
      const waiting = this.sizesError
        ? [
            h('p', { class: 'n-err n-account__sizes-error', attrs: { role: 'alert' }, text: `${ACCOUNT_SIZES.unreadable} ${this.sizesError}` }),
            h('div', { class: 'n-account__sizes-retry' }, button(ACCOUNT_SIZES.retry, { outline: true, onClick: () => this.openSizes() })),
          ]
        : [h('p', { class: 'n-g n-lb n-account__sizes-loading', attrs: { role: 'status' }, text: ACCOUNT_SIZES.loading })];
      return [
        h(
          'section',
          { class: 'n-px n-account__sizes-view', attrs: { 'aria-labelledby': 'account-sizes-title' } },
          ...head,
          ...waiting,
          h('div', { class: 'n-account__sizes-cancel' }, cancel),
        ),
      ];
    }
    const fields = SIZE_FIELDS.map((f) => ({ kind: f.kind, ...selectField(`account-size-${f.kind.toLowerCase()}`, f.label, sizeOptions(f.kind), sizeFieldValue(f.kind, saved[f.kind]), f.hint) }));
    const form = nocturneForm(
      this.deps.session,
      'sizes',
      fields.map((f) => f.el),
      ACCOUNT_SIZES.save,
      async () => {
        const values = Object.fromEntries(fields.map((f) => [f.kind, f.select.value])) as Record<SizeKind, string>;
        try {
          this.sizes = await this.deps.api.saveSizes(sizesFromForm(values));
        } catch (e) {
          this.deps.session.noteError(e);
          throw new FormError(`${ACCOUNT_SIZES.failed} ${messageOf(e)}`);
        }
        this.closeSizes(ACCOUNT_SIZES.saved);
      },
    );
    return [
      h(
        'section',
        { class: 'n-px n-account__sizes-view', attrs: { 'aria-labelledby': 'account-sizes-title' } },
        ...head,
        form,
        // SAVE filled, then CANCEL under it, the hairline button.
        h('div', { class: 'n-account__sizes-cancel' }, cancel),
      ),
    ];
  }

  // ── YOUR ADDRESSES (plan NEXT LOT §3.6.B) ────────────────────────────────

  /** YOUR WISHLIST (plan CUSTOMER INTELLIGENCE §3.2 W.10.2): its count at its right, then its page (the sheet closes first). */
  private wishlistRow(): HTMLElement {
    const row = leadRow(WISHLIST.row, {
      href: WISHLIST_PATH,
      onOpen: () => {
        this.close();
        this.deps.onWishlist();
      },
      attrs: { 'data-key': 'wishlist' },
      extraClass: 'n-account__sizes n-account__wishlist',
    });
    if (this.wishCount) row.insertBefore(h('span', { class: 'n-g n-lb n-row__value n-account__wishlist-line' }, ...withNumerals(this.wishCount)), row.lastChild);
    return row;
  }

  /** The row after YOUR SIZES: YOUR ADDRESSES, its line how many are saved (`2 SAVED`) or NOT SET; nothing while unread. */
  private addressesRow(): HTMLElement {
    const row = leadRow(ACCOUNT_ADDRESSES.row, { onOpen: () => this.openAddresses(), attrs: { 'data-key': 'addresses' }, extraClass: 'n-account__sizes n-account__addresses' });
    if (this.addresses) row.insertBefore(h('span', { class: 'n-g n-lb n-row__value n-account__addresses-line' }, ...withNumerals(addressesSummary(this.addresses.addresses))), row.lastChild);
    return row;
  }

  /** YOUR ADDRESSES; from YOUR PROFILE (`fromProfile`) its back link goes back there, and `add` opens ADD AN ADDRESS. */
  private openAddresses(opts: { fromProfile?: boolean; add?: boolean } = {}): void {
    this.view = 'addresses';
    this.notice = null;
    this.addressesError = null;
    this.addressesNote = null;
    this.editing = null;
    this.addressesFromProfile = opts.fromProfile === true;
    this.addAddressNext = opts.add === true;
    this.disarmRemove();
    if (this.addresses === null) {
      this.render();
      this.focusView();
      void this.readAddresses();
    } else this.showAddresses();
  }

  /** The addresses read for the view (again after a change): its list once they are, or the sentence and the server's message. */
  private async readAddresses(): Promise<void> {
    const gen = ++this.addressesGen;
    try {
      const list = await this.deps.api.addresses();
      if (gen !== this.addressesGen || !this.isOpen) return;
      this.addresses = list;
      this.addressesError = null;
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.addressesGen || !this.isOpen) return;
      this.addressesError = messageOf(e);
    }
    if (this.view === 'addresses') this.showAddresses();
  }

  private showAddresses(focus?: string): void {
    // Opened on ADD AN ADDRESS (YOUR PROFILE without an address): its form once the list is read.
    if (this.addAddressNext && this.addresses !== null) {
      this.addAddressNext = false;
      this.editing = 'new';
      this.render();
      this.panel.querySelector<HTMLElement>('.n-account__addresses-view input')?.focus({ preventScroll: true });
      return;
    }
    this.render();
    const at = focus ? this.panel.querySelector<HTMLElement>(focus) : null;
    if (at) at.focus({ preventScroll: true });
    else this.focusView();
  }

  private closeAddresses(): void {
    this.view = 'account';
    this.addressesFromProfile = false;
    this.addAddressNext = false;
    this.editing = null;
    this.addressesNote = null;
    this.disarmRemove();
    this.render();
    this.panel.querySelector<HTMLElement>('[data-key="addresses"]')?.focus({ preventScroll: true });
  }

  private disarmRemove(): void {
    if (this.removeTimer) clearTimeout(this.removeTimer);
    this.removeTimer = null;
    this.removeArmed = null;
  }

  /** A change done: the list read again (its default as the server made it), the note said. */
  private async addressesChanged(note: string, focus?: string): Promise<void> {
    this.editing = null;
    this.addressesNote = { text: note, error: false };
    this.addresses = null;
    this.render();
    await this.readAddresses();
    if (focus && this.view === 'addresses') this.panel.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  }

  private addressesView(): HTMLElement[] {
    const A = ACCOUNT_ADDRESSES;
    // ‹ YOUR PROFILE when opened from YOUR PROFILE (plan CUSTOMER INTELLIGENCE §3.1 P.14), else ‹ YOUR ACCOUNT.
    const fromProfile = this.addressesFromProfile;
    const back = h(
      'button',
      { class: 'n-g n-tl n-messages__back', attrs: { type: 'button' }, data: { key: 'addresses-back' }, on: { click: () => (fromProfile ? this.backToProfile() : this.closeAddresses()) } },
      icon('back', { small: true }),
      fromProfile ? ACCOUNT_PROFILE.backToProfile : MESSAGES.back,
    );
    const head = [
      h('div', { class: 'n-messages__head' }, back, h('h3', { class: 'n-g n-t3 n-ivc n-messages__title', id: 'account-addresses-title', attrs: { tabindex: -1 }, text: A.title })),
      h('p', { class: 'n-tx n-account__addresses-lead', text: A.lead }),
    ];
    const section = (...children: (HTMLElement | null)[]) =>
      h('section', { class: 'n-px n-account__addresses-view', attrs: { 'aria-labelledby': 'account-addresses-title' } }, ...head, ...children.filter((c): c is HTMLElement => c !== null));
    const list = this.addresses;
    if (list === null) {
      return [
        section(
          ...(this.addressesError
            ? [
                h('p', { class: 'n-err n-account__addresses-error', attrs: { role: 'alert' }, text: `${A.unreadable} ${this.addressesError}` }),
                h('div', { class: 'n-account__addresses-retry' }, button(A.retry, { outline: true, onClick: () => this.openAddresses({ fromProfile: this.addressesFromProfile, add: this.addAddressNext }) })),
              ]
            : [h('p', { class: 'n-g n-lb n-account__addresses-loading', attrs: { role: 'status' }, text: A.loading })]),
        ),
      ];
    }
    if (this.editing !== null) return [section(this.addressForm(list))];
    const note = this.addressesNote
      ? h('p', { class: this.addressesNote.error ? 'n-err n-account__addresses-note' : 'n-sm n-ivc n-account__addresses-note', attrs: { role: this.addressesNote.error ? 'alert' : 'status', tabindex: -1 }, text: this.addressesNote.text })
      : null;
    // The default one first, then the others as saved, the oldest first.
    const items = [...list.addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((a) => this.addressItem(a));
    return [
      section(
        note,
        items.length > 0 ? h('ul', { class: 'n-account__addresses-list', attrs: { 'aria-label': A.title } }, ...items) : h('p', { class: 'n-sm n-account__addresses-empty', text: A.empty }),
        mayAddAddress(list.addresses)
          ? h('div', { class: 'n-account__addresses-add' }, button(A.add, { outline: true, attrs: { 'data-key': 'address-add' }, onClick: () => this.editAddress('new') }))
          : h('p', { class: 'n-sm n-account__addresses-limit', text: A.limit }),
      ),
    ];
  }

  /** One saved address: its lines, DEFAULT on the default one, then EDIT · MAKE DEFAULT · REMOVE. */
  private addressItem(a: SavedAddress): HTMLElement {
    const A = ACCOUNT_ADDRESSES;
    const link = (text: string, label: string, key: string, onOpen: () => void) => {
      const l = textLink(text, { onOpen, extraClass: 'n-account__address-link' });
      l.setAttribute('aria-label', label);
      l.dataset.key = key;
      if (this.addressBusy && l instanceof HTMLButtonElement) l.disabled = true;
      return l;
    };
    const armed = this.removeArmed === a.id;
    return h(
      'li',
      { class: 'n-account__address', data: { address: a.id } },
      a.isDefault ? h('p', { class: 'n-g n-lb n-ivc n-account__address-default', text: A.isDefault }) : null,
      h('p', { class: 'n-tx n-account__address-lines' }, ...addressLines(a).flatMap((l, i) => (i === 0 ? [l] : [h('br'), l]))),
      h(
        'p',
        { class: 'n-account__address-links' },
        link(A.edit, A.editLabel(a.name), `address-edit-${a.id}`, () => this.editAddress(a.id)),
        a.isDefault ? null : link(A.makeDefault, A.makeDefaultLabel(a.name), `address-default-${a.id}`, () => void this.makeDefault(a.id)),
        link(armed ? A.removeConfirm : A.remove, armed ? A.removeConfirmLabel(a.name) : A.removeLabel(a.name), `address-remove-${a.id}`, () => void this.removeAddress(a.id)),
      ),
    );
  }

  private editAddress(id: string): void {
    this.editing = id;
    this.addressesNote = null;
    this.disarmRemove();
    this.render();
    this.panel.querySelector<HTMLElement>('.n-account__addresses-view input')?.focus({ preventScroll: true });
  }

  /** ADD AN ADDRESS (with MY DEFAULT ADDRESS) or EDIT: the four fields, SAVE, and CANCEL beside it. */
  private addressForm(list: AccountAddresses): HTMLElement {
    const A = ACCOUNT_ADDRESSES;
    const editing = this.editing === 'new' ? null : (list.addresses.find((a) => a.id === this.editing) ?? null);
    const fields = addressFields('account-address', editing, list.defaultCountry);
    // The first address becomes the default whatever is asked (services/addresses.ts): the switch says so.
    const first = list.addresses.length === 0;
    const isDefault = switchControl({ label: A.defaultSwitch, checked: first, onChange: () => undefined });
    if (first) isDefault.input.disabled = true;
    const cancel = button(A.cancel, {
      outline: true,
      onClick: () => {
        const back = this.editing && this.editing !== 'new' ? `[data-key="address-edit-${this.editing}"]` : '[data-key="address-add"]';
        this.editing = null;
        this.showAddresses(back);
      },
    });
    return nocturneForm(
      this.deps.session,
      'address',
      [...fields.els, ...(editing ? [] : [h('label', { class: 'n-row n-account__address-switch' }, h('span', { class: 'n-g n-row__label', text: A.defaultSwitch }), isDefault.el)])],
      A.save,
      async () => {
        const address = fields.read();
        try {
          if (editing) await this.deps.api.updateAddress(editing.id, address);
          else await this.deps.api.createAddress(address, isDefault.input.checked);
        } catch (e) {
          this.deps.session.noteError(e);
          throw new FormError(`${A.failed} ${messageOf(e)}`);
        }
        await this.addressesChanged(A.saved);
      },
      cancel,
    );
  }

  private async makeDefault(id: string): Promise<void> {
    if (this.addressBusy) return;
    this.addressBusy = true;
    this.disarmRemove();
    try {
      await this.deps.api.makeDefaultAddress(id);
      this.addressBusy = false;
      await this.addressesChanged(ACCOUNT_ADDRESSES.saved, `[data-address="${id}"] [data-key="address-edit-${id}"]`);
    } catch (e) {
      this.addressBusy = false;
      this.deps.session.noteError(e);
      this.addressesNote = { text: `${ACCOUNT_ADDRESSES.failed} ${messageOf(e)}`, error: true };
      this.showAddresses(`[data-key="address-default-${id}"]`);
    }
  }

  /**
   * REMOVE armed or not, written into its link in place: no render and no focus moved, so a keyboard or a screen reader
   * stays where it is; its accessible name keeps the address.
   */
  private paintRemove(id: string, armed: boolean): void {
    const link = this.panel.querySelector<HTMLElement>(`[data-key="address-remove-${id}"]`);
    const name = this.addresses?.addresses.find((a) => a.id === id)?.name;
    if (!link || name === undefined) return;
    const A = ACCOUNT_ADDRESSES;
    link.textContent = armed ? A.removeConfirm : A.remove;
    link.setAttribute('aria-label', armed ? A.removeConfirmLabel(name) : A.removeLabel(name));
  }

  /** REMOVE: a first tap asks for a second (TAP AGAIN TO REMOVE, a few seconds), the second removes it. */
  private async removeAddress(id: string): Promise<void> {
    if (this.addressBusy) return;
    if (this.removeArmed !== id) {
      const before = this.removeArmed;
      this.disarmRemove();
      if (before) this.paintRemove(before, false);
      this.removeArmed = id;
      this.removeTimer = setTimeout(() => {
        if (this.removeArmed !== id) return;
        this.removeArmed = null;
        this.removeTimer = null;
        this.paintRemove(id, false);
      }, 4000);
      if (this.addressesNote) {
        this.addressesNote = null;
        this.panel.querySelector('.n-account__addresses-note')?.remove();
      }
      this.paintRemove(id, true);
      return;
    }
    this.disarmRemove();
    this.addressBusy = true;
    try {
      await this.deps.api.removeAddress(id);
      this.addressBusy = false;
      await this.addressesChanged(ACCOUNT_ADDRESSES.removed, '.n-account__addresses-note');
    } catch (e) {
      this.addressBusy = false;
      this.deps.session.noteError(e);
      this.addressesNote = { text: `${ACCOUNT_ADDRESSES.failed} ${messageOf(e)}`, error: true };
      this.showAddresses(`[data-key="address-remove-${id}"]`);
    }
  }

  // ── CHANGE PASSWORD (C-04, C39) ──────────────────────────────────────────

  private openPassword(): void {
    this.view = 'password';
    this.notice = null;
    this.render();
    this.panel.querySelector<HTMLInputElement>('input')?.focus();
  }

  private closePassword(notice: string | null): void {
    this.view = 'account';
    this.notice = notice;
    this.render();
    this.panel.querySelector<HTMLElement>('[data-key="password"]')?.focus({ preventScroll: true });
  }

  /** The current password, then a new one; this session stays, the others end (a wrong current one is said on its field). */
  private passwordView(): HTMLElement[] {
    const current = h('input', { attrs: { type: 'password', name: 'current-password', autocomplete: 'current-password', required: true, maxlength: 1024 } });
    const next = h('input', { attrs: { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    const cancel = button(ACCOUNT_PASSWORD.cancel, { outline: true, onClick: () => this.closePassword(null) });
    const form = nocturneForm(
      this.deps.session,
      'password',
      [field('account-current-password', ACCOUNT_PASSWORD.currentPassword, current), field('account-new-password', ACCOUNT_PASSWORD.newPassword, next, `At least ${MIN_PASSWORD} characters.`)],
      ACCOUNT_PASSWORD.change,
      async () => {
        if (!current.value) {
          current.setAttribute('aria-invalid', 'true');
          throw new FormError('Enter your current password.');
        }
        if (next.value.length < MIN_PASSWORD) {
          next.setAttribute('aria-invalid', 'true');
          throw new FormError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        try {
          await this.deps.api.changePassword(current.value, next.value);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'CURRENT_PASSWORD_INVALID') {
            current.value = '';
            current.setAttribute('aria-invalid', 'true');
          }
          throw e;
        }
        current.value = '';
        next.value = '';
        // Done: the sheet comes back with the sentence (a status, read out), and focus on CHANGE PASSWORD.
        this.closePassword(ACCOUNT_PASSWORD.changed);
      },
      cancel,
    );
    return [
      h(
        'section',
        { class: 'n-px n-account__password', attrs: { 'aria-labelledby': 'account-password-title' } },
        h('h3', { class: 'n-g n-t3 n-ivc', id: 'account-password-title', text: ACCOUNT_PASSWORD.change }),
        h('p', { class: 'n-tx n-account__password-lead', text: ACCOUNT_PASSWORD.changeLead }),
        form,
      ),
    ];
  }

  // ── SIGN OUT ─────────────────────────────────────────────────────────────

  private signOut(): void {
    if (this.busy) return;
    this.busy = true;
    this.render();
    void (async () => {
      try {
        await this.deps.api.logout();
      } catch {
        // The cookie is cleared by the server when it answers; the page forgets the session either way.
      } finally {
        this.busy = false;
        this.close();
        this.deps.session.signedOut();
      }
    })();
  }
}
