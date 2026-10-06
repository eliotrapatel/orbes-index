/**
 * OWNERSHIP tab: sign in / create an account, register a piece at its first
 * registration (scan token + claim code), create or cancel a transfer code,
 * and receive a piece with a transfer code: for the piece this scan read and
 * with this scan's transfer window (F-03), which the server gives a signed-in
 * reader while a transfer is pending (signed in after the scan: VERIFY AGAIN;
 * the window closed: SCAN AGAIN; a staff scan, which never earns one: STAFF
 * SCAN). The same panel, in its register mode alone, is the certificate-card
 * section of an UNUSUAL ACTIVITY result (`underReview`: the claim code is
 * required), in its registered mode the transfer-code section of such a
 * result (`underReview`: the window the server gave), and, in its account
 * mode, the sign-in of MY PIECES when signed out (F-01) and of a release's
 * page (P-R03, with its own sentence: any account enters a draw).
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
 * A piece registered to someone else shows RECEIVING THIS PIECE, the heading
 * the link under the result's second-hand guidance moves to (J-02).
 *
 * Under CREATE ACCOUNT, one sentence, then TERMS OF USE · PRIVACY POLICY:
 * creating an account means accepting the terms (their article 1), linked at
 * /legal/terms, and the privacy policy says what the account records, at
 * /legal/privacy (J-06).
 *
 * Drawn in NOCTURNE's pieces wherever it stands (plan NOCTURNE, step N4: C9, C13, C14, C15, C36, C37, C39): its state
 * a label (ivory when it says what the piece is), its sentences in ash, the times of the scan's windows as labels,
 * SIGN IN · CREATE ACCOUNT underlined, the fields underlined on the dark, the form's ivory button, the hairline ones for
 * a second action (CREATE TRANSFER CODE, CANCEL TRANSFER, VERIFY AGAIN, SCAN AGAIN), the text links centred.
 *
 * Every action is a same-origin JSON call through ApiClient (session cookie
 * + CSRF token). Server messages are shown as they come: they are written for
 * customers and never carry internal detail. The panel re-renders itself on
 * each state change; typed secrets (passwords, claim codes) are never stored
 * beyond the form fields.
 */
import { h, prefersReducedMotion } from '../../shared/dom.js';
import { ApiError, type ApiClient } from '../api.js';
import type { SessionStore, SessionState } from '../session.js';
import type { OwnershipConfirmation, TransferOffer } from '../types.js';
import { formatDate, formatDateTime, formatDateTimeLong, normalizeCodeInput, registrationOpen, registrationStatus, type ContactModel, type OwnershipMode } from '../view-model.js';
import { ACCOUNT_PASSWORD, CLAIM_HELD, CONTACT, NOT_DELIVERED_NOTE, PIECES, RECEIVING, STAFF_SCAN_NOTE } from '../copy.js';
import { PIECES_PATH, termsNote, withNumerals } from './common.js';
import { FormError, messageOf, MIN_PASSWORD, nocturneForm } from './forms.js';
import { appAnchor, button, contactLines, field, textLink } from './nocturne.js';

export { MIN_PASSWORD } from './forms.js';

export interface OwnershipDeps {
  api: ApiClient;
  session: SessionStore;
  /** Scan again (when the registration window of this scan has closed). */
  onRescan(): void;
  /**
   * Verify the same code again, so the whole result reflects the new ownership. `ceremony` (P-D01): VIEW AS OWNER
   * right after a first registration, whose result opens with the ceremony.
   */
  onRefresh?(opts?: { ceremony?: boolean }): void;
  /** ORBES Client Services under FORGOTTEN PASSWORD? (absent when not configured). */
  contact?: ContactModel;
  /** MY PIECES, from the account line (F-01); without it the link loads the page. */
  onPieces?(): void;
  now?: () => number;
}

/** The id of RECEIVING THIS PIECE, the heading of a piece registered to someone else (J-02 links to it). */
const RECEIVING_ID = 'receiving-title';

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
    this.root = h('div', { class: 'n-own' });
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

  /**
   * Bring RECEIVING THIS PIECE into view and move keyboard focus to it (the link under the second-hand guidance,
   * J-02). Centred on the screen: the selected tab and the status of the piece stay in sight above it, the sign-in
   * or the transfer code below. False when the panel does not show it (the piece was just received, or another mode).
   */
  showReceiving(): boolean {
    const heading = this.root.querySelector<HTMLElement>(`#${RECEIVING_ID}`);
    if (!heading) return false;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return true;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    const s = this.deps.session.state;
    // FORGOTTEN PASSWORD? belongs to the absence of a session: a sign-in elsewhere closes it.
    if (s.status === 'signed-in') this.state.recover = null;
    const hadFocus = typeof document !== 'undefined' && this.root.contains(document.activeElement);
    // A heading focused on purpose (RECEIVING THIS PIECE, FORGOTTEN PASSWORD) keeps the focus if the re-render shows it again.
    const focusedHeading = hadFocus && document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('n-own__heading') ? document.activeElement.id : '';
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
          children.push(this.status('STAFF SCAN'), this.small(STAFF_SCAN_NOTE));
          break;
        case 'account':
          // MY PIECES signed out (or a release's page, P-R03): the sign-in alone. Signed in, the page has its own account line.
          if (s.status !== 'signed-in') children.push(...this.authBlock(m.lead ?? PIECES.signInLead));
          break;
        default:
          // C36: a piece not delivered yet says so in its sentence, instead of the form.
          children.push(this.status('NOT YET DELIVERED'), this.small(NOT_DELIVERED_NOTE));
      }
    }
    if (this.state.notice) children.push(h('p', { class: 'n-err n-own__notice', attrs: { role: 'status' }, text: this.state.notice }));
    if (s.status === 'signed-in' && this.state.mode.kind !== 'account') children.push(this.accountLine(s.account.email));
    this.root.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
    // A re-render replaces the focused control; keep keyboard and screen-reader users in the panel.
    if (hadFocus) {
      const heading = focusedHeading ? this.root.querySelector<HTMLElement>(`#${focusedHeading}`) : null;
      (heading ?? this.root.querySelector<HTMLElement>('input, button:not([disabled])') ?? this.root).focus({ preventScroll: true });
    }
  }

  /** The panel's state line (C9, C13, C14): a label in Gravesend capitals, in ivory where it says what the piece is. */
  private status(text: string, ivory = false): HTMLElement {
    return h('p', { class: ['n-g', 'n-lb', ivory ? 'n-ivc' : null, 'n-own__status'], text });
  }

  /** What has just happened (REGISTERED TO YOU, C36 and C37): a title in ivory. */
  private outcome(text: string): HTMLElement {
    return h('p', { class: 'n-g n-t3 n-ivc n-own__status n-own__status--done', text });
  }

  private text(text: string): HTMLElement {
    return h('p', { class: 'n-tx n-own__text', text });
  }

  /** A shorter sentence (`.sm`): a note under a state, a hint. */
  private small(text: string, extraClass?: string): HTMLElement {
    return h('p', { class: ['n-sm', 'n-own__small', extraClass], text });
  }

  /** A time a window of this scan closes at (REGISTRATION OPEN UNTIL 19:04): a label, its figures in the reading face. */
  private until(text: string, ivory = false): HTMLElement {
    return h('p', { class: ['n-g', 'n-lb', 'n-num', ivory ? 'n-ivc' : null, 'n-own__until'] }, ...withNumerals(text));
  }

  /** A heading of the panel (TRANSFER OF OWNERSHIP, RECEIVING THIS PIECE, FORGOTTEN PASSWORD): an ivory title. */
  private heading(text: string, id?: string): HTMLHeadingElement {
    return h('h3', { class: 'n-g n-t3 n-ivc n-own__heading', id, text });
  }

  /** A button of the panel: the ivory one (its one primary action) or `outline`, the hairline one. */
  private action(label: string, onClick: () => void, opts: { outline?: boolean; busy?: boolean; extraClass?: string } = {}): HTMLButtonElement {
    return button(label, {
      outline: opts.outline,
      onClick: () => onClick(),
      extraClass: ['n-own__action', opts.extraClass].filter(Boolean).join(' '),
      attrs: { disabled: this.state.busy, 'aria-busy': opts.busy ? (this.state.busy ? 'true' : 'false') : undefined },
    });
  }

  private errorLine(): HTMLElement | null {
    return this.state.error ? h('p', { class: 'n-err n-own__error', attrs: { role: 'alert' }, text: this.state.error }) : null;
  }

  private registerBlock(m: Extract<OwnershipMode, { kind: 'register' }>, s: SessionState): (HTMLElement | null)[] {
    const now = this.now();
    const until = timeOf(m.expiresAt);
    if (!registrationOpen(m.expiresAt, now)) {
      const out: (HTMLElement | null)[] = [this.status(registrationStatus(m.expiresAt, now))];
      // On an UNUSUAL ACTIVITY result the foot already offers SCAN AGAIN: the sentence points to it, no second button.
      if (m.underReview) {
        out.push(this.small('The registration window of this scan has closed. Scan the code again, then register this piece with the claim code of its certificate card.'));
        return out;
      }
      out.push(
        this.small('The registration window of this scan has closed. Scan the code again to register this piece.'),
        this.action('SCAN AGAIN', () => this.deps.onRescan(), { outline: true, extraClass: 'n-own__action--after-small' }),
      );
      return out;
    }
    const out: (HTMLElement | null)[] = [];
    if (m.underReview) {
      // C15: under DO YOU HOLD THE CERTIFICATE CARD?, the time the window closes says it is open, in ivory, then why.
      if (until) out.push(this.until(`REGISTRATION OPEN UNTIL ${until}`, true));
      else out.push(this.status(registrationStatus(m.expiresAt, now), true));
      out.push(this.text('While its activity is reviewed, this piece can be registered only with the claim code of its certificate card.'));
    } else {
      out.push(this.status(registrationStatus(m.expiresAt, now), true), this.text('Register this piece in your name to keep its warranty, service history and ownership together.'));
      if (until) out.push(this.until(`REGISTRATION OPEN UNTIL ${until}`));
    }
    if (s.status !== 'signed-in') {
      out.push(...this.authBlock('Sign in or create an ORBES account to continue.'));
      return out;
    }
    out.push(this.claimForm(m));
    return out;
  }

  private yoursBlock(m: Extract<OwnershipMode, { kind: 'yours' }>, s: SessionState): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [this.status('REGISTERED TO YOU', true), this.text('This piece is registered to your ORBES account.')];
    if (s.status !== 'signed-in') {
      out.push(...this.authBlock('Sign in again to manage the ownership of this piece.'));
      return out;
    }
    out.push(this.heading('TRANSFER OF OWNERSHIP'));
    const offer = this.state.offer;
    if (offer) {
      // C37: the code created, shown in the reading face, until when it holds, then CANCEL TRANSFER.
      out.push(
        h('p', { class: 'n-g n-lb n-own__code-label', text: 'TRANSFER CODE' }),
        h('p', { class: 'n-num n-own__code', text: offer.transferCode }),
        this.until(`VALID UNTIL ${formatDateTime(offer.expiresAt, -new Date(offer.expiresAt).getTimezoneOffset()) || formatDate(offer.expiresAt)}`),
        this.small('Give this code only to the new owner. The transfer completes when they enter it in their ORBES account.', 'n-own__small--code'),
        this.errorLine(),
        this.action('CANCEL TRANSFER', () => this.cancelTransfer(m.productId), { outline: true, extraClass: 'n-own__action--after-small' }),
      );
      return out;
    }
    if (m.transferPending) {
      out.push(
        this.text('A transfer of this piece is pending. You may cancel it at any time before it is accepted.'),
        this.errorLine(),
        this.action('CANCEL TRANSFER', () => this.cancelTransfer(m.productId), { outline: true }),
      );
      return out;
    }
    out.push(
      this.text('When this piece changes hands, create a transfer code and give it to its new owner. It remains valid for 7 days.'),
      this.errorLine(),
      this.action('CREATE TRANSFER CODE', () => this.createTransfer(m.productId), { outline: true, busy: true }),
    );
    return out;
  }

  /**
   * A piece registered to someone else: RECEIVING THIS PIECE (F-03). The transfer code is accepted for this piece
   * only, with this scan's transfer window: signed out, the sign-in first; signed in without a window (the scan was
   * made signed out, or by another account), VERIFY AGAIN; no transfer pending, nothing to enter, and VERIFY AGAIN
   * for an owner who signed in after the scan; the window closed, SCAN AGAIN. A staff scan (S-07: a browser signed
   * in to the console) earns no window, here or on a new scan: STAFF SCAN and how to receive a piece of one's own.
   * On an UNUSUAL ACTIVITY result (`underReview`) the same form, under DO YOU HOLD A TRANSFER CODE?, whose page
   * already offers SCAN AGAIN.
   */
  private registeredBlock(m: Extract<OwnershipMode, { kind: 'registered' }>, s: SessionState): (HTMLElement | null)[] {
    // A heading the second-hand guidance's link moves to (J-02, showReceiving).
    const receiving = this.heading(RECEIVING.title, RECEIVING_ID);
    receiving.tabIndex = -1;
    receiving.classList.add('n-own__heading--receiving');
    const out: (HTMLElement | null)[] = [
      this.status(m.staff ? 'STAFF SCAN' : 'REGISTERED TO ITS OWNER', !m.staff),
      this.text(m.transferPending ? 'This piece is registered to an ORBES account. A transfer of its ownership is in progress.' : 'This piece is registered to an ORBES account.'),
      receiving,
    ];
    if (m.staff) {
      // VERIFY AGAIN would repeat the staff scan, and earn no window again.
      out.push(this.text(RECEIVING.staffScan));
      return out;
    }
    if (m.underReview) out.push(this.text(RECEIVING.underReview));
    if (s.status !== 'signed-in') {
      out.push(this.text(RECEIVING.lead), ...this.authBlock(RECEIVING.signIn));
      out.push(this.small(RECEIVING.ownerHint, 'n-own__small--hint'));
      return out;
    }
    // The same code, verified again with the session: the owner's view, or this account's own transfer window.
    const again = this.deps.onRefresh ?? this.deps.onRescan;
    if (!m.transferPending) {
      // C37: no transfer pending, the sentence, then VERIFY AGAIN (a hairline button).
      out.push(this.small(RECEIVING.noTransfer, 'n-own__small--first'), this.small(RECEIVING.ownerAgain), this.action(RECEIVING.verifyAgain, () => again(), { outline: true, extraClass: 'n-own__action--after-small' }));
      return out;
    }
    if (m.transfer) this.windowAccount ??= s.account.email;
    const t = this.windowAccount === s.account.email ? m.transfer : undefined;
    if (!t) {
      // Signed in after the scan, or as another account than the scan's: no window for this account yet.
      out.push(this.text(RECEIVING.verifyAgainLead), this.action(RECEIVING.verifyAgain, () => again(), { outline: true }));
      return out;
    }
    if (!registrationOpen(t.expiresAt, this.now())) {
      // On an UNUSUAL ACTIVITY result the foot already offers SCAN AGAIN: the sentence points to it, no second button.
      out.push(this.text(RECEIVING.closed), m.underReview ? null : this.action('SCAN AGAIN', () => this.deps.onRescan(), { outline: true }));
      return out;
    }
    out.push(this.text(RECEIVING.lead));
    const until = timeOf(t.expiresAt);
    if (until) out.push(this.until(RECEIVING.until(until)));
    out.push(this.transferForm(m.productId, t));
    return out;
  }

  private confirmationBlock(): HTMLElement[] {
    const c = this.state.confirmation!;
    const out = [this.outcome('REGISTERED TO YOU')];
    if (c.via === 'transfer') out.push(this.small(`The ownership of ${c.productId} has been transferred to your ORBES account.`));
    else if (c.verified) out.push(this.small('This piece is now registered to your ORBES account. Ownership verified with its claim code.'));
    else out.push(this.small('This piece is now registered to your ORBES account. ORBES Client Services may ask for a proof of purchase to confirm it.'));
    const refresh = this.deps.onRefresh;
    if (refresh) {
      // A first registration (not a piece received with a transfer code) opens the ceremony (P-D01).
      const ceremony = c.via === 'register';
      out.push(this.action('VIEW AS OWNER', () => refresh({ ceremony }), { extraClass: ceremony ? 'n-own__action--view' : 'n-own__action--after-small' }));
    }
    return out;
  }

  /**
   * SIGNED IN AS …, then MY PIECES (F-01: the owner's pieces) and SIGN OUT, on one line of labels (C14, C36), the
   * links underlined in ivory; the line wraps between its words when it is short.
   */
  private accountLine(email: string): HTMLElement {
    return h(
      'p',
      { class: 'n-g n-lb n-own__account' },
      'SIGNED IN AS ',
      h('span', { class: 'n-own__email', text: email }),
      // Each dot stays with the words before it: a short line wraps after it, never before.
      '\u00a0· ',
      appAnchor(PIECES_PATH, ['n-ivc', 'n-u', 'n-own__link'], this.deps.onPieces, PIECES.link),
      '\u00a0· ',
      h('button', { class: 'n-g n-ivc n-u n-own__link', attrs: { type: 'button', disabled: this.state.busy }, on: { click: () => this.signOut() }, text: 'SIGN OUT' }),
    );
  }

  /** A text link of the panel (`.tl`), centred on its own line: FORGOTTEN PASSWORD?, BACK TO SIGN IN. */
  private textButton(label: string, onClick: () => void, extraClass?: string): HTMLElement {
    const link = textLink(label, { onOpen: onClick, extraClass: 'n-own__tl' }) as HTMLButtonElement;
    link.disabled = this.state.busy;
    return h('p', { class: ['n-ctr', 'n-own__tl-line', extraClass] }, link);
  }

  // ── Forms ────────────────────────────────────────────────────────────────

  private authBlock(lead: string): HTMLElement[] {
    if (this.deps.session.state.status === 'unknown' && !this.sessionUnavailable) {
      // Still asking the server who is signed in: no flash of sign-in forms for an owner.
      return [h('p', { class: 'n-g n-lb n-own__waiting', attrs: { 'aria-busy': 'true' }, text: 'ONE MOMENT…' })];
    }
    if (this.state.recover) return this.recoverBlock(this.state.recover);
    const tab = this.state.authTab;
    // C9: SIGN IN · CREATE ACCOUNT, underlined (`.switch2`), the chosen one pressed.
    const option = (t: AuthTab, label: string) =>
      h('button', { class: 'n-g n-switch2__tab n-own__option', attrs: { type: 'button', 'aria-pressed': tab === t ? 'true' : 'false' }, on: { click: () => this.setAuthTab(t) }, text: label });
    const switcher = h('div', { class: 'n-switch2 n-own__switch', attrs: { role: 'group', 'aria-label': 'Account' } }, option('signin', 'SIGN IN'), option('create', 'CREATE ACCOUNT'));
    const leadLine = h('p', { class: 'n-tx n-own__lead', text: lead });
    // Under CREATE ACCOUNT, the terms of use it accepts (J-06), in a new tab so the form and the scan's window stay.
    if (tab === 'create') return [leadLine, switcher, this.createForm(), termsNote()];
    // Under the sign-in form: a forgotten password goes through ORBES Client Services (C-04).
    return [leadLine, switcher, this.signInForm(), this.textButton(ACCOUNT_PASSWORD.forgotten, () => this.setRecover('contact'), 'n-own__forgotten')];
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
   * FORGOTTEN PASSWORD (C39): how to reach ORBES Client Services (their identity check comes first), then the form
   * with the code they give, as a section under the status of the piece, where the sign-in form was. The
   * contact is the one of the result (C-02); without one, the sentence still names who helps.
   */
  private recoverBlock(step: RecoverStep): HTMLElement[] {
    const back = this.textButton(ACCOUNT_PASSWORD.backToSignIn, () => this.setRecover(null), 'n-own__back');
    const title = this.heading(step === 'contact' ? ACCOUNT_PASSWORD.forgottenTitle : ACCOUNT_PASSWORD.recoverTitle, 'recover-title');
    title.tabIndex = -1;
    title.classList.add('n-own__heading--first');
    if (step === 'contact') {
      return [
        title,
        this.text(ACCOUNT_PASSWORD.forgottenLead),
        this.deps.contact ? contactLines(this.deps.contact, CONTACT) : null,
        this.action(ACCOUNT_PASSWORD.haveCode, () => this.setRecover('code'), { outline: true, extraClass: 'n-own__action--recover' }),
        back,
      ].filter((x): x is HTMLElement => x !== null);
    }
    return [title, this.text(ACCOUNT_PASSWORD.recoverLead), this.recoverForm(), back];
  }

  private field(id: string, label: string, input: HTMLInputElement, hint?: string): HTMLElement {
    return field(id, label, input, hint);
  }

  private form(name: string, fields: HTMLElement[], submitLabel: string, onSubmit: () => Promise<void>): HTMLFormElement {
    return nocturneForm(this.deps.session, name, fields, submitLabel, onSubmit);
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
      class: 'n-num n-own__code-input',
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
