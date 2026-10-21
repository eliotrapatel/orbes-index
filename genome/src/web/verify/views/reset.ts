/**
 * SET A NEW PASSWORD, the page of RESET BY EMAIL's link (macro scope E3; lot M1 plan §4.4, step M1.19; /verify/reset).
 * The link (`#<email>/<code>`, reset-model.ts) is read by main.ts and taken out of the address bar before the page is
 * drawn: it is never kept but in memory, and a reload shows the page without it.
 *
 *   SET A NEW PASSWORD
 *   For the ORBES account you@example.com.
 *   NEW PASSWORD            At least 12 characters.
 *   NEW PASSWORD, AGAIN     The same password, to be sure of it.
 *   [ SAVE ]                the code checked by the server (POST /api/v1/account/recover, the recovery's own rules)
 *
 *   refused (expired, used, or replaced by a newer link): ACCOUNT_RESET.refused (said of the link), then SEND A NEW
 *   LINK to the address of the link (RESET BY EMAIL's request, the same sentence for any address); a link without its
 *   address and code says it is incomplete and asks for the address. While RESET BY EMAIL is not offered, ORBES Client
 *   Services' way in its place (FORGOTTEN PASSWORD's sentence and their email).
 *   saved: SIGN IN, the account's email in it, and what the recovery did said under it (every session ended, the
 *   transfers paused); signed in there, MY PIECES.
 *
 * Every word in copy.ts (ACCOUNT_RESET, ACCOUNT_PASSWORD); CSP-safe: h() only.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import { ACCOUNT_PASSWORD, ACCOUNT_RESET, CONTACT } from '../copy.js';
import { readResetOffer, type ResetLink } from '../reset-model.js';
import type { SessionStore } from '../session.js';
import { formatDateTimeLong, type ContactModel } from '../view-model.js';
import { FormError, MIN_PASSWORD, nocturneForm } from './forms.js';
import { mailFrame } from './mail-frame.js';
import { contactLines, field } from './nocturne.js';
import { OwnershipPanel } from './ownership.js';

export interface ResetDeps {
  api: ApiClient;
  session: SessionStore;
  /** The link's email and code (null: opened without them). */
  link: ResetLink | null;
  /** ORBES Client Services' email, for FORGOTTEN PASSWORD's way (read once the page is drawn). */
  contact(): Promise<ContactModel | undefined>;
  /** Signed in after the new password: MY PIECES. */
  onSignedIn(): void;
}

export interface ResetView {
  root: HTMLElement;
  dispose(): void;
}

type State =
  | { kind: 'form' }
  /** The link refused by the server (ACCOUNT_RESET.refused), or incomplete (`words` null). */
  | { kind: 'refused'; words: string | null }
  | { kind: 'sent' }
  | { kind: 'done' };

export function resetView(deps: ResetDeps): ResetView {
  const page = new ResetPage(deps);
  return { root: page.root, dispose: () => page.dispose() };
}

class ResetPage {
  private readonly frame;
  private state: State;
  private contact: ContactModel | undefined;
  /** RESET BY EMAIL offered (read once a page load, reset-model.ts): SEND A NEW LINK, or ORBES Client Services' way. */
  private offered: boolean | null = null;
  private panel: OwnershipPanel | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly deps: ResetDeps) {
    this.frame = mailFrame(deps.api, 'reset');
    this.state = deps.link ? { kind: 'form' } : { kind: 'refused', words: null };
    this.render();
    void deps
      .contact()
      .then((c) => {
        if (this.disposed) return;
        this.contact = c;
        if (this.state.kind === 'refused' && this.offered === false) this.render();
      })
      .catch(() => undefined);
    void readResetOffer(deps.api).then((on) => {
      if (this.disposed) return;
      this.offered = on;
      if (this.state.kind === 'refused') this.render();
    });
  }

  get root(): HTMLElement {
    return this.frame.root;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.panel?.dispose();
    this.frame.dispose();
  }

  private render(): void {
    const s = this.state;
    const link = this.deps.link;
    switch (s.kind) {
      case 'form':
        this.frame.head(ACCOUNT_RESET.title, ACCOUNT_RESET.pageLead(link!.email));
        this.frame.body(h('div', { class: 'n-mail__part' }, this.passwordForm(link!)));
        return;
      case 'refused':
        this.frame.head(ACCOUNT_RESET.title, ACCOUNT_RESET.againLead);
        this.frame.body(
          h(
            'div',
            { class: 'n-mail__part' },
            h('p', { class: 'n-err n-mail__refused', attrs: { role: 'alert' }, text: s.words ?? ACCOUNT_RESET.incomplete }),
            ...this.againPart(),
          ),
        );
        return;
      case 'sent':
        this.frame.head(ACCOUNT_RESET.title, ACCOUNT_RESET.againLead);
        this.frame.body(h('div', { class: 'n-mail__part' }, h('p', { class: 'n-tx n-ivc n-mail__sent', attrs: { role: 'status', tabindex: -1 }, text: ACCOUNT_RESET.sent })));
        return;
      case 'done':
        this.frame.head(ACCOUNT_RESET.title, ACCOUNT_RESET.doneLead);
        if (this.panel) this.frame.body(this.panel.root);
    }
  }

  /** The new password, twice, then SAVE: the link's code checked by the server. */
  private passwordForm(link: ResetLink): HTMLFormElement {
    const password = h('input', { attrs: { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    const again = h('input', { attrs: { type: 'password', name: 'new-password-again', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    // The account the link is for, for a password manager (never shown twice: the line over the form names it).
    const username = h('input', { class: 'n-mail__username', attrs: { type: 'email', name: 'email', autocomplete: 'username', tabindex: -1, 'aria-hidden': 'true', readonly: true } });
    username.value = link.email;
    return nocturneForm(
      this.deps.session,
      'reset',
      [
        field('reset-password', ACCOUNT_RESET.newPassword, password, `At least ${MIN_PASSWORD} characters.`),
        field('reset-password-again', ACCOUNT_RESET.confirm, again, ACCOUNT_RESET.confirmHint),
        username,
      ],
      ACCOUNT_RESET.save,
      async () => {
        if (password.value.length < MIN_PASSWORD) {
          password.setAttribute('aria-invalid', 'true');
          throw new FormError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        if (again.value !== password.value) {
          again.setAttribute('aria-invalid', 'true');
          throw new FormError(ACCOUNT_RESET.mismatch);
        }
        let until: string;
        try {
          const r = await this.deps.api.recoverAccount(link.email, link.code, password.value);
          until = r.transfersPausedUntil;
        } catch (e) {
          // Expired, used or replaced: said of the link (the server's words speak of a typed code), and a new link
          // offered in the form's place.
          if (e instanceof ApiError && e.code === 'RECOVERY_CODE_INVALID') {
            password.value = '';
            again.value = '';
            this.show({ kind: 'refused', words: ACCOUNT_RESET.refused });
            return;
          }
          throw e;
        }
        password.value = '';
        again.value = '';
        this.done(link.email, until);
      },
    );
  }

  /** Under a refused or incomplete link: SEND A NEW LINK to its address (or the one typed); else ORBES Client Services. */
  private againPart(): HTMLElement[] {
    if (this.offered === null) return [];
    if (!this.offered) {
      return [h('p', { class: 'n-tx n-mail__text', text: ACCOUNT_PASSWORD.forgottenLead }), ...(this.contact ? [contactLines(this.contact, CONTACT)] : [])];
    }
    const email = h('input', { attrs: { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true, maxlength: 254, spellcheck: 'false', autocapitalize: 'none' } });
    if (this.deps.link) email.value = this.deps.link.email;
    return [
      nocturneForm(this.deps.session, 'reset-request', [field('reset-email', 'EMAIL', email)], ACCOUNT_RESET.again, async () => {
        if (!email.value.trim()) {
          email.setAttribute('aria-invalid', 'true');
          throw new FormError(ACCOUNT_RESET.noEmail);
        }
        try {
          await this.deps.api.requestReset(email.value.trim());
        } catch (e) {
          // Switched off since it was read: ORBES Client Services' way in its place.
          if (e instanceof ApiError && e.code === 'EMAIL_OFF') {
            this.offered = false;
            this.render();
            return;
          }
          throw e;
        }
        this.show({ kind: 'sent' });
      }),
    ];
  }

  /** The state drawn, the focus on what it says (the sentence, or the title). */
  private show(state: State): void {
    this.state = state;
    this.render();
    const at = this.frame.root.querySelector<HTMLElement>('.n-mail__sent, .n-mail__refused') ?? this.frame.title;
    if (at.matches('.n-mail__refused')) at.setAttribute('tabindex', '-1');
    at.focus({ preventScroll: true });
  }

  /**
   * Saved: every session of the account has ended (this page's too, when it was that account's), so SIGN IN, its email
   * in the form, with what the recovery did; signed in there, MY PIECES.
   */
  private done(email: string, until: string): void {
    const s = this.deps.session.state;
    if (s.status === 'signed-in' && s.account.email.toLowerCase() === email.toLowerCase()) this.deps.session.signedOut();
    const page = this;
    this.panel = new OwnershipPanel(
      { kind: 'account' },
      {
        api: this.deps.api,
        session: this.deps.session,
        onRescan: () => undefined,
        page: { tab: 'signin' },
        get contact() {
          return page.contact;
        },
      },
    );
    // The offset at the end of the pause, 72 hours ahead: a change to or from summer time may fall in between.
    this.panel.recovered(email, ACCOUNT_PASSWORD.recovered(formatDateTimeLong(until, -new Date(until).getTimezoneOffset())));
    this.unsubscribe = this.deps.session.subscribe((st) => {
      if (st.status === 'signed-in' && !this.disposed) this.deps.onSignedIn();
    });
    this.show({ kind: 'done' });
    this.frame.root.querySelector<HTMLInputElement>('input[name="password"]')?.focus({ preventScroll: true });
  }
}
