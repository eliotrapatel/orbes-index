/**
 * OWNERSHIP tab: sign in / create an account, register a piece at its first
 * registration (scan token + claim code), create or cancel a transfer code,
 * and receive a piece with a transfer code: for the piece this scan read and
 * with this scan's transfer window (F-03), which the server gives a signed-in
 * reader while a transfer is pending (signed in after the scan: VERIFY AGAIN;
 * the window closed: SCAN AGAIN). The same panel, in its register
 * mode alone, is the certificate-card section of an UNUSUAL ACTIVITY result
 * (`underReview`: the claim code is required), and, in its account mode, the
 * sign-in of MY PIECES when signed out (F-01).
 *
 * The password (C-04): under SIGN IN, FORGOTTEN PASSWORD? leads to ORBES
 * Client Services (the contact of C-02), who check the customer's identity
 * and give a one-time recovery code; then I HAVE A RECOVERY CODE opens the
 * form (email, code, new password). Signed in, the account line reads
 * SIGNED IN AS … · MY PIECES · SIGN OUT: CHANGE PASSWORD is in MY PIECES.
 *
 *   SIGN IN form ── FORGOTTEN PASSWORD? ──▶ FORGOTTEN PASSWORD (contact)
 *        ▲                                     │ I HAVE A RECOVERY CODE
 *        └──── BACK TO SIGN IN / recovered ◀── SET A NEW PASSWORD (form)
 *
 * Every action is a same-origin JSON call through ApiClient (session cookie
 * + CSRF token). Server messages are shown as they come: they are written for
 * customers and never carry internal detail. The panel re-renders itself on
 * each state change; typed secrets (passwords, claim codes) are never stored
 * beyond the form fields.
 */
import { h } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import type { SessionStore, SessionState } from '../session.js';
import type { OwnershipConfirmation, TransferOffer } from '../types.js';
import { formatDate, formatDateTimeLong, normalizeCodeInput, registrationOpen, registrationStatus, type ContactModel, type OwnershipMode } from '../view-model.js';
import { ACCOUNT_PASSWORD, CLAIM_HELD, NOT_DELIVERED_NOTE, PIECES, RECEIVING, STAFF_SCAN_NOTE } from '../copy.js';
import { contactBlock, piecesLink, sectionLabel } from './common.js';
import { accountForm, field, FormError, messageOf, MIN_PASSWORD } from './forms.js';

export { MIN_PASSWORD } from './forms.js';

export interface OwnershipDeps {
  api: ApiClient;
  session: SessionStore;
  /** Scan again (when the registration window of this scan has closed). */
  onRescan(): void;
  /** Verify the same code again, so the whole result reflects the new ownership. */
  onRefresh?(): void;
  /** ORBES Client Services under FORGOTTEN PASSWORD? (absent when not configured). */
  contact?: ContactModel;
  /** MY PIECES, from the account line (F-01); without it the link loads the page. */
  onPieces?(): void;
  now?: () => number;
}


type AuthTab = 'signin' | 'create';
/** A forgotten password: first how to reach ORBES Client Services, then the recovery form. */
type RecoverStep = 'contact' | 'code';

interface PanelState {
  mode: OwnershipMode;
  authTab: AuthTab;
  /** Signed out: the steps of FORGOTTEN PASSWORD?, instead of the sign-in switch. */
  recover: RecoverStep | null;
  /** The email of a recovered account, put back in the sign-in form (never a password). */
  signInEmail: string;
  offer: TransferOffer | null;
  confirmation: { verified: boolean; via: 'register' | 'transfer'; productId: string } | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
}

function timeOf(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export class OwnershipPanel {
  readonly root: HTMLElement;
  private readonly state: PanelState;
  private readonly now: () => number;
  private unsubscribe: (() => void) | null = null;
  /** The session probe could not be reached: offer the sign-in forms rather than wait forever. */
  private sessionUnavailable = false;
  /**
   * The account (its email) whose signed-in scan earned this result's transfer window (F-03): the first one this
   * panel sees signed in. The server takes the window from that account only, so another account signed in on the
   * same result is asked to verify the piece again, which earns it a window of its own.
   */
  private windowAccount: string | null = null;

  constructor(
    mode: OwnershipMode,
    private readonly deps: OwnershipDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.state = { mode, authTab: 'signin', recover: null, signInEmail: '', offer: null, confirmation: null, error: null, notice: null, busy: false };
    // No live region on the whole panel (a re-render would read it all out); status and alert lines carry their own roles.
    this.root = h('div', { class: 'ownership' });
    this.unsubscribe = deps.session.subscribe(() => this.render());
    this.render();
    if (deps.session.state.status === 'unknown') {
      deps.session.ensure().catch(() => {
        // Offline: offer sign-in anyway; the error appears if the user tries.
        this.sessionUnavailable = true;
        this.render();
      });
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const s = this.deps.session.state;
    // FORGOTTEN PASSWORD? belongs to the absence of a session: a sign-in elsewhere closes it.
    if (s.status === 'signed-in') this.state.recover = null;
    const hadFocus = typeof document !== 'undefined' && this.root.contains(document.activeElement);
    const children: (HTMLElement | null)[] = [];
    if (this.state.confirmation) children.push(...this.confirmationBlock());
    else {
      const m = this.state.mode;
      switch (m.kind) {
        case 'register':
          children.push(...this.registerBlock(m, s));
          break;
        case 'yours':
          children.push(...this.yoursBlock(m, s));
          break;
        case 'registered':
          children.push(...this.registeredBlock(m, s));
          break;
        case 'staff':
          children.push(this.status('STAFF SCAN'), this.text(STAFF_SCAN_NOTE));
          break;
        case 'account':
          // MY PIECES signed out: the sign-in alone. Signed in, the page lists the pieces and has its own account line.
          if (s.status !== 'signed-in') children.push(...this.authBlock(PIECES.signInLead));
          break;
        default:
          children.push(this.status('NOT YET DELIVERED'), this.text(NOT_DELIVERED_NOTE));
      }
    }
    if (this.state.notice) children.push(h('p', { class: 'form__notice', attrs: { role: 'status' }, text: this.state.notice }));
    if (s.status === 'signed-in' && this.state.mode.kind !== 'account') children.push(this.accountLine(s.account.email));
    this.root.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
    // A re-render replaces the focused control; keep keyboard and screen-reader users in the panel.
    if (hadFocus) (this.root.querySelector<HTMLElement>('input, button:not([disabled])') ?? this.root).focus({ preventScroll: true });
  }

  private status(text: string): HTMLElement {
    return h('p', { class: 'ownership__status', text });
  }

  private text(text: string): HTMLElement {
    return h('p', { class: 'prose ownership__text', text });
  }

  private errorLine(): HTMLElement | null {
    return this.state.error ? h('p', { class: 'form__error', attrs: { role: 'alert' }, text: this.state.error }) : null;
  }

  private registerBlock(m: Extract<OwnershipMode, { kind: 'register' }>, s: SessionState): (HTMLElement | null)[] {
    const now = this.now();
    const out: (HTMLElement | null)[] = [this.status(registrationStatus(m.expiresAt, now))];
    if (!registrationOpen(m.expiresAt, now)) {
      // On an UNUSUAL ACTIVITY result the foot already offers SCAN AGAIN: the sentence points to it, no second button.
      if (m.underReview) {
        out.push(this.text('The registration window of this scan has closed. Scan the code again, then register this piece with the claim code of its certificate card.'));
        return out;
      }
      out.push(
        this.text('The registration window of this scan has closed. Scan the code again to register this piece.'),
        h('div', { class: 'ownership__actions' }, h('button', { class: 'btn btn--block', attrs: { type: 'button' }, on: { click: () => this.deps.onRescan() }, text: 'SCAN AGAIN' })),
      );
      return out;
    }
    out.push(
      this.text(
        m.underReview
          ? 'While its activity is reviewed, this piece can be registered only with the claim code of its certificate card.'
          : 'Register this piece in your name to keep its warranty, service history and ownership together.',
      ),
    );
    const until = timeOf(m.expiresAt);
    if (until) out.push(h('p', { class: 'ownership__meta micro soft', text: `REGISTRATION OPEN UNTIL ${until}` }));
    if (s.status !== 'signed-in') {
      out.push(...this.authBlock('Sign in or create an ORBES account to continue.'));
      return out;
    }
    out.push(this.claimForm(m));
    return out;
  }

  private yoursBlock(m: Extract<OwnershipMode, { kind: 'yours' }>, s: SessionState): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [this.status('REGISTERED TO YOU'), this.text('This piece is registered to your ORBES account.')];
    if (s.status !== 'signed-in') {
      out.push(...this.authBlock('Sign in again to manage the ownership of this piece.'));
      return out;
    }
    out.push(sectionLabel('TRANSFER OF OWNERSHIP'));
    const offer = this.state.offer;
    if (offer) {
      out.push(
        h(
          'div',
          { class: 'transfer-code' },
          h('p', { class: 'transfer-code__label micro soft', text: 'TRANSFER CODE' }),
          h('p', { class: 'transfer-code__value', text: offer.transferCode }),
          h('p', { class: 'transfer-code__label micro soft', text: `VALID UNTIL ${formatDate(offer.expiresAt)}` }),
        ),
        this.text('Give this code only to the new owner. The transfer completes when they enter it in their ORBES account.'),
        this.errorLine(),
        h('div', { class: 'ownership__actions' }, this.textButton('CANCEL TRANSFER', () => this.cancelTransfer(m.productId))),
      );
      return out;
    }
    if (m.transferPending) {
      out.push(
        this.text('A transfer of this piece is pending. You may cancel it at any time before it is accepted.'),
        this.errorLine(),
        h('div', { class: 'ownership__actions' }, this.textButton('CANCEL TRANSFER', () => this.cancelTransfer(m.productId))),
      );
      return out;
    }
    out.push(
      this.text('When this piece changes hands, create a transfer code and give it to its new owner. It remains valid for 7 days.'),
      this.errorLine(),
      h(
        'div',
        { class: 'ownership__actions' },
        h('button', { class: 'btn btn--block', attrs: { type: 'button', 'aria-busy': this.state.busy ? 'true' : 'false', disabled: this.state.busy }, on: { click: () => this.createTransfer(m.productId) }, text: 'CREATE TRANSFER CODE' }),
      ),
    );
    return out;
  }

  /**
   * A piece registered to someone else: RECEIVING THIS PIECE (F-03). The transfer code is accepted for this piece
   * only, with this scan's transfer window: signed out, the sign-in first; signed in without a window (the scan was
   * made signed out, or by another account), VERIFY AGAIN; no transfer pending, nothing to enter, and VERIFY AGAIN
   * for an owner who signed in after the scan; the window closed, SCAN AGAIN.
   */
  private registeredBlock(m: Extract<OwnershipMode, { kind: 'registered' }>, s: SessionState): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [
      this.status('REGISTERED TO ITS OWNER'),
      this.text(m.transferPending ? 'This piece is registered to an ORBES account. A transfer of its ownership is in progress.' : 'This piece is registered to an ORBES account.'),
      sectionLabel(RECEIVING.title),
    ];
    if (s.status !== 'signed-in') {
      out.push(this.text(RECEIVING.lead), ...this.authBlock(RECEIVING.signIn));
      out.push(h('p', { class: 'ownership__meta prose', text: RECEIVING.ownerHint }));
      return out;
    }
    // The same code, verified again with the session: the owner's view, or this account's own transfer window.
    const again = this.deps.onRefresh ?? this.deps.onRescan;
    if (!m.transferPending) {
      out.push(
        this.text(RECEIVING.noTransfer),
        h('p', { class: 'ownership__meta prose', text: RECEIVING.ownerAgain }),
        h('div', { class: 'ownership__actions' }, this.textButton(RECEIVING.verifyAgain, () => again())),
      );
      return out;
    }
    if (m.transfer) this.windowAccount ??= s.account.email;
    const t = this.windowAccount === s.account.email ? m.transfer : undefined;
    if (!t) {
      // Signed in after the scan, or as another account than the scan's: no window for this account yet.
      out.push(
        this.text(RECEIVING.verifyAgainLead),
        h('div', { class: 'ownership__actions' }, h('button', { class: 'btn btn--block', attrs: { type: 'button' }, on: { click: () => again() }, text: RECEIVING.verifyAgain })),
      );
      return out;
    }
    if (!registrationOpen(t.expiresAt, this.now())) {
      out.push(
        this.text(RECEIVING.closed),
        h('div', { class: 'ownership__actions' }, h('button', { class: 'btn btn--block', attrs: { type: 'button' }, on: { click: () => this.deps.onRescan() }, text: 'SCAN AGAIN' })),
      );
      return out;
    }
    out.push(this.text(RECEIVING.lead));
    const until = timeOf(t.expiresAt);
    if (until) out.push(h('p', { class: 'ownership__meta micro soft', text: RECEIVING.until(until) }));
    out.push(this.transferForm(m.productId, t));
    return out;
  }

  private confirmationBlock(): HTMLElement[] {
    const c = this.state.confirmation!;
    const out = [this.status('REGISTERED TO YOU')];
    if (c.via === 'transfer') out.push(this.text(`The ownership of ${c.productId} has been transferred to your ORBES account.`));
    else if (c.verified) out.push(this.text('This piece is now registered to your ORBES account. Ownership verified with its claim code.'));
    else out.push(this.text('This piece is now registered to your ORBES account. ORBES Client Services may ask for a proof of purchase to confirm it.'));
    const refresh = this.deps.onRefresh;
    if (refresh) {
      out.push(h('div', { class: 'ownership__actions' }, h('button', { class: 'btn btn--block', attrs: { type: 'button' }, on: { click: () => refresh() }, text: 'VIEW AS OWNER' })));
    }
    return out;
  }

  /**
   * SIGNED IN AS …, then MY PIECES (F-01: the owner's pieces, where CHANGE PASSWORD now is) and SIGN OUT, which wrap
   * under it when the line is short.
   */
  private accountLine(email: string): HTMLElement {
    return h(
      'div',
      { class: 'ownership__account' },
      h('p', { class: 'ownership__who micro soft' }, 'SIGNED IN AS ', h('span', { class: 'ownership__email', text: email })),
      h('div', { class: 'ownership__links' }, piecesLink(this.deps.onPieces), this.textButton('SIGN OUT', () => this.signOut())),
    );
  }

  private textButton(label: string, onClick: () => void): HTMLButtonElement {
    return h('button', { class: 'textlink', attrs: { type: 'button', disabled: this.state.busy }, on: { click: onClick }, text: label });
  }

  // ── Forms ────────────────────────────────────────────────────────────────

  private authBlock(lead: string): HTMLElement[] {
    if (this.deps.session.state.status === 'unknown' && !this.sessionUnavailable) {
      // Still asking the server who is signed in: no flash of sign-in forms for an owner.
      return [h('p', { class: 'ownership__meta micro soft', attrs: { 'aria-busy': 'true' }, text: 'ONE MOMENT…' })];
    }
    if (this.state.recover) return this.recoverBlock(this.state.recover);
    const tab = this.state.authTab;
    const switcher = h(
      'div',
      { class: 'auth__switch', attrs: { role: 'group', 'aria-label': 'Account' } },
      h('button', { class: 'auth__option', attrs: { type: 'button', 'aria-pressed': tab === 'signin' ? 'true' : 'false' }, on: { click: () => this.setAuthTab('signin') }, text: 'SIGN IN' }),
      h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
      h('button', { class: 'auth__option', attrs: { type: 'button', 'aria-pressed': tab === 'create' ? 'true' : 'false' }, on: { click: () => this.setAuthTab('create') }, text: 'CREATE ACCOUNT' }),
    );
    if (tab === 'create') return [this.text(lead), switcher, this.createForm()];
    // Under the sign-in form: a forgotten password goes through ORBES Client Services (C-04).
    return [
      this.text(lead),
      switcher,
      this.signInForm(),
      h('div', { class: 'ownership__actions' }, this.textButton(ACCOUNT_PASSWORD.forgotten, () => this.setRecover('contact'))),
    ];
  }

  private setAuthTab(t: AuthTab): void {
    if (this.state.authTab === t) return;
    this.state.authTab = t;
    this.state.error = null;
    this.render();
    this.root.querySelector<HTMLInputElement>('input')?.focus();
  }

  /** Move between the steps of FORGOTTEN PASSWORD? (null: back to the sign-in form); keyboard focus follows. */
  private setRecover(step: RecoverStep | null): void {
    this.state.recover = step;
    this.state.error = null;
    this.state.notice = null;
    this.render();
    this.root.querySelector<HTMLElement>(step === 'contact' ? '#recover-title' : 'input')?.focus();
  }

  /**
   * FORGOTTEN PASSWORD: how to reach ORBES Client Services (their identity check comes first), then the form
   * with the code they give, as a section under the status of the piece, where the sign-in form was. The
   * contact is the one of the result (C-02); without one, the sentence still names who helps.
   */
  private recoverBlock(step: RecoverStep): HTMLElement[] {
    const back = this.textButton(ACCOUNT_PASSWORD.backToSignIn, () => this.setRecover(null));
    const title = sectionLabel(step === 'contact' ? ACCOUNT_PASSWORD.forgottenTitle : ACCOUNT_PASSWORD.recoverTitle, 'recover-title');
    title.tabIndex = -1;
    if (step === 'contact') {
      return [
        title,
        this.text(ACCOUNT_PASSWORD.forgottenLead),
        this.deps.contact ? contactBlock(this.deps.contact) : null,
        h('div', { class: 'ownership__actions ownership__actions--stack' }, this.textButton(ACCOUNT_PASSWORD.haveCode, () => this.setRecover('code')), back),
      ].filter((x): x is HTMLElement => x !== null);
    }
    return [
      title,
      this.text(ACCOUNT_PASSWORD.recoverLead),
      this.recoverForm(),
      h('div', { class: 'ownership__actions' }, back),
    ];
  }

  private field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
    return field(id, label, input, hint);
  }

  private form(name: string, fields: HTMLElement[], submitLabel: string, onSubmit: () => Promise<void>): HTMLFormElement {
    return accountForm(this.deps.session, name, fields, submitLabel, onSubmit);
  }

  private signInForm(): HTMLFormElement {
    const email = h('input', { attrs: { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true, maxlength: 254, spellcheck: 'false', autocapitalize: 'none' } });
    // After a recovery, the account's email is already there: only the new password is typed.
    if (this.state.signInEmail) email.value = this.state.signInEmail;
    const password = h('input', { attrs: { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 1024 } });
    return this.form('signin', [this.field('auth-email', 'EMAIL', email), this.field('auth-password', 'PASSWORD', password)], 'SIGN IN', async () => {
      if (!email.value.trim() || !password.value) throw new FormError('Enter your email and password.');
      const s = await this.deps.api.login(email.value.trim(), password.value);
      password.value = '';
      this.state.signInEmail = '';
      this.state.notice = null;
      this.deps.session.signedIn(s);
    });
  }

  /** The recovery form (session-less): email, the code of ORBES Client Services, a new password. */
  private recoverForm(): HTMLFormElement {
    const email = h('input', { attrs: { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true, maxlength: 254, spellcheck: 'false', autocapitalize: 'none' } });
    const code = this.codeInput('recovery-code');
    const password = h('input', { attrs: { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    return this.form(
      'recover',
      [
        this.field('recover-email', 'EMAIL', email),
        this.field('recovery-code', ACCOUNT_PASSWORD.recoveryCode, code, ACCOUNT_PASSWORD.recoveryCodeHint),
        this.field('recover-password', ACCOUNT_PASSWORD.newPassword, password, `At least ${MIN_PASSWORD} characters.`),
      ],
      ACCOUNT_PASSWORD.recover,
      async () => {
        if (!email.value.trim()) throw new FormError('Enter the email of your ORBES account.');
        if (normalizeCodeInput(code.value).length !== 14) {
          code.setAttribute('aria-invalid', 'true');
          throw new FormError(ACCOUNT_PASSWORD.codeIncomplete);
        }
        if (password.value.length < MIN_PASSWORD) {
          password.setAttribute('aria-invalid', 'true');
          throw new FormError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        const r = await this.deps.api.recoverAccount(email.value.trim(), code.value, password.value);
        password.value = '';
        code.value = '';
        // Every session of the account has ended: back to SIGN IN, the email filled in, with what happened.
        this.state.signInEmail = email.value.trim();
        this.state.authTab = 'signin';
        this.state.recover = null;
        // The offset at the end of the pause, 72 hours ahead: a change to or from summer time may fall in between.
        this.state.notice = ACCOUNT_PASSWORD.recovered(formatDateTimeLong(r.transfersPausedUntil, -new Date(r.transfersPausedUntil).getTimezoneOffset()));
        this.render();
        this.root.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      },
    );
  }

  private createForm(): HTMLFormElement {
    const name = h('input', { attrs: { type: 'text', name: 'name', autocomplete: 'name', maxlength: 80 } });
    const email = h('input', { attrs: { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', required: true, maxlength: 254, spellcheck: 'false', autocapitalize: 'none' } });
    const password = h('input', { attrs: { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD, maxlength: 1024 } });
    return this.form(
      'create',
      [
        this.field('auth-name', 'NAME (OPTIONAL)', name),
        this.field('auth-email', 'EMAIL', email),
        this.field('auth-password', 'PASSWORD', password, `At least ${MIN_PASSWORD} characters.`),
      ],
      'CREATE ACCOUNT',
      async () => {
        if (!email.value.trim()) throw new FormError('Enter your email address.');
        if (password.value.length < MIN_PASSWORD) {
          password.setAttribute('aria-invalid', 'true');
          throw new FormError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
        }
        const s = await this.deps.api.register(email.value.trim(), password.value, name.value);
        password.value = '';
        this.deps.session.signedIn(s);
      },
    );
  }

  private codeInput(name: string): HTMLInputElement {
    const input = h('input', {
      class: 'field__input--code',
      attrs: { type: 'text', name, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text', maxlength: 14, placeholder: 'XXXX-XXXX-XXXX' },
    });
    input.addEventListener('input', () => {
      const next = normalizeCodeInput(input.value);
      if (next !== input.value) input.value = next;
    });
    return input;
  }

  private claimForm(m: Extract<OwnershipMode, { kind: 'register' }>): HTMLFormElement {
    const fields: HTMLElement[] = [];
    let claim: HTMLInputElement | null = null;
    if (m.claimCodeRequired) {
      claim = this.codeInput('claim-code');
      fields.push(this.field('claim-code', 'CLAIM CODE', claim, 'Printed on the ORBES certificate card delivered with your piece.'));
    }
    return this.form('claim', fields, 'REGISTER THIS PIECE', async () => {
      if (claim && normalizeCodeInput(claim.value).length !== 14) {
        claim.setAttribute('aria-invalid', 'true');
        throw new FormError('Enter the 12 characters of your claim code.');
      }
      if (!registrationOpen(m.expiresAt, this.now())) {
        this.render();
        return;
      }
      let r: OwnershipConfirmation;
      try {
        r = await this.deps.api.registerProduct(m.token, claim ? claim.value : undefined);
      } catch (e) {
        if (claim && e instanceof ApiError && e.status === 429) throw new FormError(CLAIM_HELD);
        throw e;
      }
      this.state.confirmation = { verified: r.verified, via: 'register', productId: r.productId };
      this.state.mode = { kind: 'yours', productId: r.productId, transferPending: false };
      this.render();
    });
  }

  /** The transfer code, sent for this piece with this scan's window (F-03): the server refuses a code of another piece. */
  private transferForm(productId: string, scan: { token: string; expiresAt: string }): HTMLFormElement {
    const code = this.codeInput('transfer-code');
    return this.form('transfer', [this.field('transfer-code', RECEIVING.code, code, RECEIVING.codeHint)], RECEIVING.submit, async () => {
      if (normalizeCodeInput(code.value).length !== 14) {
        code.setAttribute('aria-invalid', 'true');
        throw new FormError(RECEIVING.codeIncomplete);
      }
      if (!registrationOpen(scan.expiresAt, this.now())) {
        this.render();
        return;
      }
      const r = await this.deps.api.acceptTransfer(code.value, productId, scan.token);
      this.state.confirmation = { verified: r.verified, via: 'transfer', productId: r.productId };
      this.state.mode = { kind: 'yours', productId: r.productId, transferPending: false };
      this.render();
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.error = null;
    this.state.notice = null;
    this.render();
    try {
      await action();
    } catch (e) {
      this.deps.session.noteError(e);
      this.state.error = messageOf(e);
    } finally {
      this.state.busy = false;
      this.render();
    }
  }

  private createTransfer(productId: string): void {
    void this.run(async () => {
      this.state.offer = await this.deps.api.initiateTransfer(productId);
    });
  }

  private cancelTransfer(productId: string): void {
    void this.run(async () => {
      await this.deps.api.cancelTransfer(productId);
      this.state.offer = null;
      if (this.state.mode.kind === 'yours') this.state.mode = { ...this.state.mode, transferPending: false };
      this.state.notice = 'The transfer has been cancelled.';
    });
  }

  private signOut(): void {
    void this.run(async () => {
      try {
        await this.deps.api.logout();
      } finally {
        this.state.offer = null;
        this.deps.session.signedOut();
      }
    });
  }
}
