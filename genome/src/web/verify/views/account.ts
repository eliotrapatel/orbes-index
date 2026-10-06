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
 *   ● ● ○ ○ ○ ○ ○ ○ ○ ○                   TIER_DOTS), the benefits of the tier and of those below it, NEXT and
 *                                         what it adds (PALLADIUM: the highest); without a
 *   – The owners' circle: …               tier, THE CLUB and what a first piece opens; a piece revoked or retired
 *   NEXT: PLATINE                         counts for none (the note); nothing when the status cannot be read
 *   3 more pieces … It adds:
 *   – Priority care …
 *   ─────────────────────────────────
 *   MESSAGES                    NEW ›     the conversation with ORBES Client Services (plan NEXT-NINE, CS-01): NEW
 *                                         while an answer is unread; its view in the sheet (below)
 *   SOUND                         (●)     the sound signature (P-D07), as the footer's SOUND ON / OFF
 *   CHANGE PASSWORD                 ›     its form in the sheet (C39): the current password, a new one; CANCEL
 *   MY PIECES                       ›
 *   PRIVACY · TERMS · LEGAL · HELP  ›     the legal pages' index, in a new tab
 *   [            SIGN OUT            ]
 *
 * MESSAGES (CS-01): ‹ YOUR ACCOUNT, the title, the conversation oldest first and scrolled to the latest, each message
 * with its author line (YOU · 6 OCT 2026 · 14:02, or ORBES CLIENT SERVICES: staff are never named), on the collector's
 * the place it concerned (a link to it; a scan has none), the body as written; then YOUR REPLY (YOUR MESSAGE before the
 * first) and SEND. Opening it marks the conversation read. The collector never sees a status.
 *
 * A modal dialog: the page under it is inert and holds still; focus goes to its title and comes back to the account
 * button when it closes.
 */
import { h } from '../../shared/dom.js';
import { LEGAL_PATH } from '../../shared/legal.js';
import { ApiError, type ApiClient } from '../api.js';
import { ACCOUNT, ACCOUNT_PASSWORD, MESSAGES, PIECES, SOUND } from '../copy.js';
import { messageProblem, threadModel, type ConcerningTarget, type ThreadModel } from '../messages-model.js';
import type { SessionStore } from '../session.js';
import type { SoundSwitch } from '../sound.js';
import { tierModel } from '../tier-model.js';
import type { ClubStatus } from '../types.js';
import { FormError, messageOf, MIN_PASSWORD, nocturneForm } from './forms.js';
import { button, field, icon, leadRow, switchControl, textLink, tierDots } from './nocturne.js';
import { PIECES_PATH, withNumerals } from './common.js';

export interface AccountSheetDeps {
  api: Pick<ApiClient, 'clubStatus' | 'products' | 'changePassword' | 'logout' | 'messages' | 'writeMessage' | 'readMessages' | 'messagesUnread'>;
  session: SessionStore;
  sound: SoundSwitch;
  /** MY PIECES, in the app. */
  onPieces(): void;
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

type View = 'account' | 'password' | 'messages';

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
      // Signed out here or elsewhere (a 401): the sheet has nothing left to show.
      if (s.status !== 'signed-in' && this.isOpen) this.close();
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

  /** The club's status and the pieces, read afresh: YOUR TIER as it is now. */
  private async read(): Promise<void> {
    const gen = ++this.readGen;
    const [club, pieces, unread] = await Promise.all([
      this.deps.api.clubStatus().catch((e: unknown) => {
        this.deps.session.noteError(e);
        return null;
      }),
      this.deps.api.products().catch(() => null),
      this.deps.api.messagesUnread().catch(() => false),
    ]);
    if (gen !== this.readGen || !this.isOpen) return;
    this.club = club;
    // MESSAGES opened meanwhile has read it: NEW stays off.
    this.unread = this.view === 'messages' ? false : unread;
    this.listed = pieces?.length ?? 0;
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
    const head = h(
      'div',
      { class: 'n-px n-sb n-account__head' },
      h('h2', { class: 'n-g n-lb', id: 'account-title', attrs: { tabindex: -1 }, text: ACCOUNT.title }),
      h('button', { class: 'n-account__close', attrs: { type: 'button', 'aria-label': ACCOUNT.close }, data: { key: 'close' }, on: { click: () => this.close() } }, icon('close')),
    );
    const body = this.view === 'password' ? this.passwordView() : this.view === 'messages' ? this.messagesView() : this.accountView(s.account.email);
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
      h(
        'div',
        { class: 'n-account__rows' },
        this.messagesRow(),
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
    this.focusTitle();
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
    else this.focusTitle();
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
      h('div', { class: 'n-px n-messages__head' }, back, h('h3', { class: 'n-g n-t3 n-ivc n-messages__title', text: MESSAGES.title })),
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
