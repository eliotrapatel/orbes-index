/**
 * OWNERSHIP tab: sign in / create an account, register a piece at its first
 * registration (scan token + claim code), create or cancel a transfer code,
 * and receive a piece with a transfer code. The same panel, in its register
 * mode alone, is the certificate-card section of an UNUSUAL ACTIVITY result
 * (`underReview`: the claim code is required).
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
import { formatDate, normalizeCodeInput, registrationOpen, registrationStatus, type OwnershipMode } from '../view-model.js';
import { CLAIM_HELD } from '../copy.js';
import { sectionLabel } from './common.js';

export interface OwnershipDeps {
  api: ApiClient;
  session: SessionStore;
  /** Scan again (when the registration window of this scan has closed). */
  onRescan(): void;
  /** Verify the same code again, so the whole result reflects the new ownership. */
  onRefresh?(): void;
  now?: () => number;
}

/** Minimum password length (PLATFORM-CONTRACTS §2.9). */
export const MIN_PASSWORD = 12;


type AuthTab = 'signin' | 'create';

interface PanelState {
  mode: OwnershipMode;
  authTab: AuthTab;
  offer: TransferOffer | null;
  confirmation: { verified: boolean; via: 'register' | 'transfer'; productId: string } | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
}

function messageOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return 'The ORBES service could not be reached. Check your connection, then try again.';
    if (e.status === 429) return 'Too many attempts. Please wait a moment, then try again.';
    if (e.status === 401) return 'Your session has ended. Please sign in again.';
    if (e.status >= 500) return 'This could not be completed just now. Please try again in a moment.';
    return e.message;
  }
  return 'This could not be completed. Please try again.';
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

  constructor(
    mode: OwnershipMode,
    private readonly deps: OwnershipDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.state = { mode, authTab: 'signin', offer: null, confirmation: null, error: null, notice: null, busy: false };
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
        default:
          children.push(
            this.status('NOT YET REGISTERED'),
            this.text('Registration opens once this piece has been delivered by an ORBES boutique or an authorised retailer.'),
          );
      }
    }
    if (this.state.notice) children.push(h('p', { class: 'form__notice', attrs: { role: 'status' }, text: this.state.notice }));
    if (s.status === 'signed-in') children.push(this.accountLine(s.account.email));
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

  private registeredBlock(m: Extract<OwnershipMode, { kind: 'registered' }>, s: SessionState): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [
      this.status('REGISTERED TO ITS OWNER'),
      this.text(m.transferPending ? 'This piece is registered to an ORBES account. A transfer of its ownership is in progress.' : 'This piece is registered to an ORBES account.'),
      sectionLabel('RECEIVING THIS PIECE'),
      this.text('If its owner has given you a transfer code, enter it to register this piece in your name.'),
    ];
    if (s.status !== 'signed-in') {
      out.push(...this.authBlock('Sign in or create an ORBES account to receive it.'));
      out.push(h('p', { class: 'ownership__meta prose', text: 'If this piece is already registered to you, sign in and scan it again to see it as its owner.' }));
      return out;
    }
    out.push(this.transferForm());
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

  private accountLine(email: string): HTMLElement {
    return h(
      'div',
      { class: 'ownership__account' },
      h('p', { class: 'ownership__who micro soft' }, 'SIGNED IN AS ', h('span', { class: 'ownership__email', text: email })),
      this.textButton('SIGN OUT', () => this.signOut()),
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
    const tab = this.state.authTab;
    const switcher = h(
      'div',
      { class: 'auth__switch', attrs: { role: 'group', 'aria-label': 'Account' } },
      h('button', { class: 'auth__option', attrs: { type: 'button', 'aria-pressed': tab === 'signin' ? 'true' : 'false' }, on: { click: () => this.setAuthTab('signin') }, text: 'SIGN IN' }),
      h('span', { class: 'tabs__dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
      h('button', { class: 'auth__option', attrs: { type: 'button', 'aria-pressed': tab === 'create' ? 'true' : 'false' }, on: { click: () => this.setAuthTab('create') }, text: 'CREATE ACCOUNT' }),
    );
    return [this.text(lead), switcher, tab === 'signin' ? this.signInForm() : this.createForm()];
  }

  private setAuthTab(t: AuthTab): void {
    if (this.state.authTab === t) return;
    this.state.authTab = t;
    this.state.error = null;
    this.render();
    this.root.querySelector<HTMLInputElement>('input')?.focus();
  }

  private field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
    input.id = id;
    input.classList.add('field__input');
    const hintEl = hint ? h('span', { class: 'field__hint', id: `${id}-hint`, text: hint }) : null;
    if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
    return h('div', { class: 'field' }, h('label', { class: 'field__label', attrs: { for: id }, text: label }), input, hintEl);
  }

  private form(name: string, fields: HTMLElement[], submitLabel: string, onSubmit: () => Promise<void>): HTMLFormElement {
    const error = h('p', { class: 'form__error', attrs: { role: 'alert', hidden: true } });
    const submit = h('button', { class: 'btn btn--block', attrs: { type: 'submit', 'aria-busy': 'false' }, text: submitLabel });
    const form = h('form', { class: `form form--${name}`, attrs: { novalidate: true, 'aria-label': submitLabel.toLowerCase() } }, ...fields, error, submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (submit.disabled) return;
      void (async () => {
        error.hidden = true;
        error.textContent = '';
        for (const f of Array.from(form.querySelectorAll('[aria-invalid]'))) f.removeAttribute('aria-invalid');
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        try {
          await onSubmit();
        } catch (e) {
          this.deps.session.noteError(e);
          error.textContent = e instanceof FormError ? e.message : messageOf(e);
          error.hidden = false;
          (form.querySelector<HTMLElement>('[aria-invalid="true"]') ?? submit).focus();
        } finally {
          submit.disabled = false;
          submit.setAttribute('aria-busy', 'false');
        }
      })();
    });
    return form;
  }

  private signInForm(): HTMLFormElement {
    const email = h('input', { attrs: { type: 'email', name: 'email', autocomplete: 'username', inputmode: 'email', required: true, maxlength: 254, spellcheck: 'false', autocapitalize: 'none' } });
    const password = h('input', { attrs: { type: 'password', name: 'password', autocomplete: 'current-password', required: true, maxlength: 1024 } });
    return this.form('signin', [this.field('auth-email', 'EMAIL', email), this.field('auth-password', 'PASSWORD', password)], 'SIGN IN', async () => {
      if (!email.value.trim() || !password.value) throw new FormError('Enter your email and password.');
      const s = await this.deps.api.login(email.value.trim(), password.value);
      password.value = '';
      this.deps.session.signedIn(s);
    });
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

  private transferForm(): HTMLFormElement {
    const code = this.codeInput('transfer-code');
    return this.form('transfer', [this.field('transfer-code', 'TRANSFER CODE', code)], 'RECEIVE THIS PIECE', async () => {
      if (normalizeCodeInput(code.value).length !== 14) {
        code.setAttribute('aria-invalid', 'true');
        throw new FormError('Enter the 12 characters of the transfer code.');
      }
      const r = await this.deps.api.acceptTransfer(code.value);
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

class FormError extends Error {}
