/**
 * WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE of 2026-10-06, §3.1 CS-01): the button every place of the app shows
 * where it showed an email address, a phone number or opening hours, and the write sheet it opens. Nothing is emailed:
 * the message goes to ORBES Client Services' Messages board, and their answer appears in the account, under MESSAGES.
 *
 *   ▬                                         the handle
 *   WRITE TO ORBES CLIENT SERVICES        ×   CLOSE (and Escape, and a tap on the dimmed page)
 *   CONCERNING                                what the place attaches (not shown without one)
 *   MONOLITHE · O26-J-00184
 *   YOUR MESSAGE                              an underlined textarea, 2,000 characters at most
 *   ________________________________
 *   Please leave out passwords and card numbers.
 *   [            SEND            ]            the ivory button
 *   CANCEL                                    a text link
 *   The answer will appear in your account, under MESSAGES.
 *
 * Sent: MESSAGE SENT, its sentence, SEE MESSAGES (the account sheet on MESSAGES) and CLOSE. Signed out: the sentence,
 * then the sign-in of the OWNERSHIP panel (SIGN IN · CREATE ACCOUNT · FORGOTTEN PASSWORD?); once signed in, the form,
 * its context kept. A modal dialog, as the account sheet is: the page under it inert, focus on its title, back on the
 * button that opened it when it closes.
 *
 * The button (`writeButton`) is NOCTURNE's hairline button; on the ivory LIVE CONFIRMED screen it takes the house's
 * full-width hairline `btn` (`house`). The app registers the sheet once (registerWriteSheet); the views only draw the
 * button with its context (messages-model.ts).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { MESSAGES } from '../copy.js';
import { contextInput, messageProblem, type WriteContext } from '../messages-model.js';
import type { SessionStore } from '../session.js';
import type { ContactModel } from '../view-model.js';
import { FormError, nocturneForm } from './forms.js';
import { button, icon, textLink } from './nocturne.js';
import { OwnershipPanel } from './ownership.js';

type Opener = (context: WriteContext | null, trigger: HTMLElement) => void;
let opener: Opener | null = null;
let messagesOpener: ((trigger: HTMLElement | null) => void) | null = null;

/** The app's write sheet, which every WRITE TO ORBES CLIENT SERVICES opens (null: none, the button does nothing). */
export function registerWriteSheet(open: Opener | null): void {
  opener = open;
}

/** The account sheet on MESSAGES (SEE MESSAGES, NOW's READ). */
export function registerMessages(open: ((trigger: HTMLElement | null) => void) | null): void {
  messagesOpener = open;
}

/** Open the account sheet on MESSAGES, `trigger` getting the focus back when it closes. */
export function openMessages(trigger: HTMLElement | null): void {
  messagesOpener?.(trigger);
}

/**
 * WRITE TO ORBES CLIENT SERVICES, with what it attaches (null: nothing): NOCTURNE's hairline button, or the house's
 * full-width hairline `btn` on the ivory CONFIRMED screen (`house`).
 */
export function writeButton(context: WriteContext | null, opts: { house?: boolean; extraClass?: string } = {}): HTMLButtonElement {
  const open = (ev: MouseEvent) => opener?.(context, ev.currentTarget as HTMLElement);
  const b = opts.house
    ? h('button', { class: ['btn', 'btn--block', 'write__open', opts.extraClass], attrs: { type: 'button', 'aria-haspopup': 'dialog' }, on: { click: open }, text: MESSAGES.write })
    : button(MESSAGES.write, { outline: true, onClick: open, extraClass: ['n-write__open', opts.extraClass].filter(Boolean).join(' '), attrs: { 'aria-haspopup': 'dialog' } });
  if (context) {
    b.dataset.context = context.kind;
    b.dataset.contextId = context.id;
    if (context.about) b.dataset.contextAbout = context.about;
  }
  return b;
}

export interface WriteSheetDeps {
  api: ApiClient;
  session: SessionStore;
  /** What the page holds outside the sheet, made inert while it is open. */
  outside(): HTMLElement[];
  /** FORGOTTEN PASSWORD? under the sign-in: ORBES Client Services' email (the one place it remains). */
  recoveryContact(): Promise<ContactModel | undefined>;
  /** SEE MESSAGES: the account sheet on MESSAGES, `trigger` (the button that opened this sheet) getting the focus back. */
  onMessages(trigger: HTMLElement | null): void;
}

export class WriteSheet {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private trigger: HTMLElement | null = null;
  private context: WriteContext | null = null;
  private sent = false;
  /** The words being written, kept while the sheet re-renders (a sign-in in it). */
  private draft = '';
  private signIn: OwnershipPanel | null = null;
  private contact: ContactModel | undefined;
  private unsubscribe: (() => void) | null = null;
  private signedIn: boolean | null = null;

  constructor(private readonly deps: WriteSheetDeps) {
    this.panel = h('section', { class: 'n-account__panel n-write__panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'write-title' } });
    this.el = h('div', { class: 'n-account n-write', attrs: { hidden: true } }, h('div', { class: 'n-account__scrim', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.close() } }), this.panel);
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(context: WriteContext | null, trigger: HTMLElement): void {
    this.trigger = trigger;
    this.context = context;
    this.sent = false;
    this.draft = '';
    this.el.hidden = false;
    document.documentElement.classList.add('n-locked');
    for (const el of this.deps.outside()) el.inert = true;
    this.signedIn = this.deps.session.state.status === 'signed-in';
    // Signed in or out while open (here, or elsewhere): the form, or the sign-in, its context kept.
    this.unsubscribe = this.deps.session.subscribe((s) => {
      const now = s.status === 'signed-in';
      if (s.status === 'unknown' || now === this.signedIn) return;
      this.signedIn = now;
      this.render();
      (this.panel.querySelector<HTMLElement>('textarea') ?? this.title())?.focus({ preventScroll: true });
    });
    this.render();
    this.title()?.focus({ preventScroll: true });
    if (this.deps.session.state.status === 'unknown') void this.deps.session.ensure().catch(() => undefined);
    // FORGOTTEN PASSWORD? under the sign-in reads it when it opens (its deps.contact is read live, signedOutView), and is
    // drawn again if it is already open when the email arrives: a first open shows it as a second one does.
    void this.deps.recoveryContact().then((c) => {
      this.contact = c;
      if (c) this.signIn?.contactArrived();
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.signIn?.dispose();
    this.signIn = null;
    this.el.hidden = true;
    document.documentElement.classList.remove('n-locked');
    for (const el of this.deps.outside()) el.inert = false;
    this.panel.replaceChildren();
    const back = this.trigger;
    this.trigger = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  private title(): HTMLElement | null {
    return this.panel.querySelector<HTMLElement>('#write-title');
  }

  private render(): void {
    const head = h(
      'div',
      { class: 'n-px n-sb n-account__head' },
      h('h2', { class: 'n-g n-lb n-write__title', id: 'write-title', attrs: { tabindex: -1 }, text: MESSAGES.write }),
      h('button', { class: 'n-account__close', attrs: { type: 'button', 'aria-label': MESSAGES.close }, on: { click: () => this.close() } }, icon('close')),
    );
    const s = this.deps.session.state;
    const body = this.sent ? this.sentView() : s.status === 'signed-in' ? this.formView() : this.signedOutView();
    this.panel.replaceChildren(h('div', { class: 'n-handle', attrs: { 'aria-hidden': 'true' } }), head, ...body);
  }

  private concerning(): HTMLElement | null {
    if (!this.context) return null;
    return h(
      'div',
      { class: 'n-px n-write__concerning' },
      h('p', { class: 'n-g n-lb', text: MESSAGES.concerning }),
      h('p', { class: 'n-g n-ivc n-write__label', attrs: { 'data-testid': 'write-concerning' }, text: this.context.label }),
    );
  }

  /** The signed-out sheet: the sentence, then the sign-in of the OWNERSHIP panel in its account mode. */
  private signedOutView(): HTMLElement[] {
    this.signIn?.dispose();
    const current = (): ContactModel | undefined => this.contact;
    this.signIn = new OwnershipPanel(
      { kind: 'account', lead: MESSAGES.signedOut },
      {
        api: this.deps.api,
        session: this.deps.session,
        onRescan: () => this.close(),
        // Read when FORGOTTEN PASSWORD is drawn, not now: the email may arrive after this view (deps.recoveryContact).
        get contact() {
          return current();
        },
      },
    );
    return [h('div', { class: 'n-px n-write__signin' }, this.signIn.root)];
  }

  private formView(): HTMLElement[] {
    this.signIn?.dispose();
    this.signIn = null;
    const area = h('textarea', {
      class: 'n-fld__input n-write__area',
      id: 'write-body',
      attrs: { name: 'message', rows: 6, maxlength: MESSAGES.max, required: true, 'aria-describedby': 'write-body-hint', autocomplete: 'off' },
    });
    area.value = this.draft;
    area.addEventListener('input', () => {
      this.draft = area.value;
    });
    const field = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'write-body' } }, h('span', { class: 'n-g n-lab', text: MESSAGES.yourMessage })),
      area,
      h('p', { class: 'n-sm n-fld__hint', id: 'write-body-hint', text: MESSAGES.hint }),
    );
    const form = nocturneForm(this.deps.session, 'write', [field], MESSAGES.send, async () => {
      const problem = messageProblem(area.value);
      if (problem) {
        area.setAttribute('aria-invalid', 'true');
        throw new FormError(problem);
      }
      await this.deps.api.writeMessage(area.value.replace(/\r\n?/g, '\n').trim(), contextInput(this.context));
      this.draft = '';
      this.sent = true;
      this.render();
      this.title()?.focus({ preventScroll: true });
    });
    return [
      this.concerning(),
      h(
        'div',
        { class: 'n-px n-write__form' },
        form,
        textLink(MESSAGES.cancel, { onOpen: () => this.close(), extraClass: 'n-write__cancel' }),
        h('p', { class: 'n-sm n-write__where', text: MESSAGES.where }),
      ),
    ].filter((x): x is HTMLElement => x !== null);
  }

  private sentView(): HTMLElement[] {
    return [
      h(
        'div',
        { class: 'n-px n-write__sent', attrs: { role: 'status' } },
        h('p', { class: 'n-g n-t3 n-ivc n-write__sent-title', text: MESSAGES.sent }),
        h('p', { class: 'n-tx n-write__sent-text', text: MESSAGES.sentText }),
        button(MESSAGES.seeMessages, {
          outline: true,
          extraClass: 'n-write__see',
          onClick: () => {
            const back = this.trigger;
            this.close();
            this.deps.onMessages(back);
          },
        }),
        textLink(MESSAGES.done, { onOpen: () => this.close(), extraClass: 'n-write__done' }),
      ),
    ];
  }
}
