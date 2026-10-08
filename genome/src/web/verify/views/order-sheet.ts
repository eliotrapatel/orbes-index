/**
 * The sheets of an order in YOUR ORDERS (plan NEXT LOT §3.6.B to D): the plate rising over the dimmed page, as the
 * write sheet (views/write.ts) rises, Escape and the scrim closing it, the keyboard focus on its title, then back on the
 * control that opened it (or on its order's card, drawn again with what the server answered).
 *
 *   ▬                                       the handle
 *   DELIVERY ADDRESS                     ×  ENGRAVING, REQUEST A RETURN or EXCHANGE THE SIZE
 *   ORDER OR-3F9A21C4 · MONOLITHE IN BLUE   what it concerns (a request adds the order's size)
 *
 *   DELIVERY ADDRESS   YOUR ADDRESSES, one choice each (its name, first line and country, DEFAULT on the default one),
 *                      the one on the order chosen; A NEW ADDRESS opens the four fields (views/address.ts) and the switch
 *                      SAVE IT TO YOUR ADDRESSES (on when none is saved); CONFIRM, then the text link CANCEL.
 *   ENGRAVING          'Engraved on your piece before it is shipped.', YOUR ENGRAVING (up to 20 characters), its price
 *                      line (or that the release's add-on paid for it), once paid what the documents will say; SAVE,
 *                      REMOVE THE ENGRAVING (a priced one), CANCEL.
 *   A REQUEST          for an exchange THE NEW SIZE (the sizes in stock; the others greyed out), REASON (one of four),
 *                      YOUR NOTE (500 characters); who decides; SEND THE REQUEST, CANCEL.
 *
 * Each sends one request at a time (its filled button disabled and busy meanwhile); a failure is said under the fields,
 * the sheet's sentence then the server's own words. Done: the sheet closes and its order's card is drawn again from the
 * order the server answered. The app holds one sheet (registerOrderSheet); a card only asks for it (openOrderSheet).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { sameAddress, savedChoice } from '../addresses-model.js';
import { ACCOUNT_ADDRESSES, MESSAGES, ORDERS } from '../copy.js';
import type { OrderEngravingModel, OrderModel, OrderReturnsModel } from '../orders-model.js';
import type { SessionStore } from '../session.js';
import type { AccountAddresses, AccountOrder, OrderCaseRequest } from '../types.js';
import { addressFields } from './address.js';
import { FormError, messageOf, nocturneForm } from './forms.js';
import { icon, selectField, sizeButtons, switchControl, textLink } from './nocturne.js';

/** What a card asks a sheet for: its kind, its order, the control that opened it, and what to do with the order the server answers. */
export type OrderSheetRequest =
  | { kind: 'address'; order: OrderModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null }
  | { kind: 'engraving'; order: OrderModel; engraving: OrderEngravingModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null }
  | { kind: 'RETURN' | 'EXCHANGE'; order: OrderModel; returns: OrderReturnsModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null };

let opener: ((r: OrderSheetRequest) => void) | null = null;

/** The app's order sheet, which every order card opens (null: none, the card's links do nothing). */
export function registerOrderSheet(open: ((r: OrderSheetRequest) => void) | null): void {
  opener = open;
}

/** Open the order sheet for `r` (views/pieces.ts). */
export function openOrderSheet(r: OrderSheetRequest): void {
  opener?.(r);
}

export interface OrderSheetDeps {
  api: Pick<ApiClient, 'addresses' | 'setOrderAddress' | 'setEngraving' | 'requestOrderCase'>;
  session: SessionStore;
  /** What the page holds outside the sheet, made inert while it is open. */
  outside(): HTMLElement[];
}

const REASONS = ['SIZE', 'NOT_AS_EXPECTED', 'DAMAGED', 'OTHER'] as const;
/** The words an engraving may hold (services/orders.ts ENGRAVING_RE): letters, figures, spaces and . & ' ’ -. */
const ENGRAVING_WORDS = /^[\p{L}\p{M}0-9 .&'’-]+$/u;

export class OrderSheet {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private req: OrderSheetRequest | null = null;
  /** The address sheet: the saved addresses as read when it opened; null while read (or unreadable: `savedError`). */
  private saved: AccountAddresses | null = null;
  private savedError: string | null = null;
  private readGen = 0;
  /** The address chosen: a saved one's id, or 'new'. */
  private choice: string = 'new';
  /** The new size of an exchange. */
  private size: string | null = null;
  private busy = false;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: OrderSheetDeps) {
    this.panel = h('section', { class: 'n-account__panel n-write__panel n-osheet__panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'order-sheet-title' } });
    this.el = h('div', { class: 'n-account n-write n-osheet', attrs: { hidden: true } }, h('div', { class: 'n-account__scrim', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.close() } }), this.panel);
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

  open(req: OrderSheetRequest): void {
    this.req = req;
    this.saved = null;
    this.savedError = null;
    this.size = null;
    this.busy = false;
    this.choice = 'new';
    this.el.hidden = false;
    document.documentElement.classList.add('n-locked');
    for (const el of this.deps.outside()) el.inert = true;
    // Signed out here or elsewhere: the order is no longer this page's to change.
    this.unsubscribe = this.deps.session.subscribe((s) => {
      if (s.status === 'anonymous') this.close();
    });
    this.render();
    this.title()?.focus({ preventScroll: true });
    if (req.kind === 'address') void this.readSaved();
  }

  /** Closed: the focus back on `focus` (the card drawn again), else on the control that opened it. */
  close(focus: HTMLElement | null = null): void {
    if (!this.isOpen) return;
    this.readGen++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.el.hidden = true;
    document.documentElement.classList.remove('n-locked');
    for (const el of this.deps.outside()) el.inert = false;
    this.panel.replaceChildren();
    const back = focus ?? this.req?.trigger ?? null;
    this.req = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  }

  private title(): HTMLElement | null {
    return this.panel.querySelector<HTMLElement>('#order-sheet-title');
  }

  /** The order the server answered: the card drawn again, the sheet closed, the focus on what the card says now. */
  private done(order: AccountOrder): void {
    const req = this.req;
    if (!req) return;
    const focus = req.onDone(order);
    this.close(focus);
  }

  private render(): void {
    const req = this.req;
    if (!req) return;
    const title = req.kind === 'address' ? ORDERS.address.title : req.kind === 'engraving' ? ORDERS.engraving.title : req.kind === 'RETURN' ? ORDERS.returns.requestReturn : ORDERS.returns.exchange;
    const concerning = req.kind === 'RETURN' || req.kind === 'EXCHANGE' ? req.returns.concerning : req.order.concerning;
    const head = h(
      'div',
      { class: 'n-px n-sb n-account__head' },
      h('h2', { class: 'n-g n-lb n-write__title', id: 'order-sheet-title', attrs: { tabindex: -1 }, text: title }),
      h('button', { class: 'n-account__close', attrs: { type: 'button', 'aria-label': MESSAGES.close }, on: { click: () => this.close() } }, icon('close')),
    );
    const about = h('div', { class: 'n-px n-write__concerning' }, h('p', { class: 'n-g n-ivc n-write__label n-osheet__concerning', attrs: { 'data-testid': 'order-sheet-concerning' }, text: concerning }));
    const body = req.kind === 'address' ? this.addressView() : req.kind === 'engraving' ? this.engravingView(req.engraving) : this.requestView(req.kind, req.returns);
    this.panel.replaceChildren(h('div', { class: 'n-handle', attrs: { 'aria-hidden': 'true' } }), head, about, h('div', { class: 'n-px n-osheet__body' }, ...body));
  }

  private cancel(): HTMLElement {
    return textLink(ORDERS.address.cancel, { onOpen: () => this.close(), extraClass: 'n-write__cancel n-osheet__cancel' });
  }

  // ── DELIVERY ADDRESS (§3.6.B) ────────────────────────────────────────────

  private async readSaved(): Promise<void> {
    const gen = ++this.readGen;
    try {
      const saved = await this.deps.api.addresses();
      if (gen !== this.readGen || !this.isOpen) return;
      this.saved = saved;
      const req = this.req;
      const current = req?.kind === 'address' ? (req.order.address?.current ?? null) : null;
      // The one on the order chosen; else, with saved ones and none on the order, the default one; else A NEW ADDRESS.
      const same = saved.addresses.find((a) => sameAddress(a, current));
      this.choice = same?.id ?? (current ? 'new' : (saved.addresses.find((a) => a.isDefault)?.id ?? 'new'));
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.readGen || !this.isOpen) return;
      this.savedError = messageOf(e);
    }
    this.render();
    this.title()?.focus({ preventScroll: true });
  }

  private addressView(): HTMLElement[] {
    const A = ORDERS.address;
    const req = this.req;
    if (!req || req.kind !== 'address') return [];
    if (this.saved === null && this.savedError === null) return [h('p', { class: 'n-g n-lb n-osheet__loading', attrs: { role: 'status' }, text: ACCOUNT_ADDRESSES.loading }), this.cancel()];
    const list = this.saved?.addresses ?? [];
    const current = req.order.address?.current ?? null;
    // A NEW ADDRESS is filled with the order's own address when it is none of the saved ones.
    const fields = addressFields('order-address', this.choice === 'new' && current && !list.some((a) => sameAddress(a, current)) ? current : null, this.saved?.defaultCountry ?? null);
    const save = switchControl({ label: A.save, checked: list.length === 0 && this.savedError === null, onChange: () => undefined });
    const choices =
      list.length > 0
        ? h(
            'fieldset',
            { class: 'n-osheet__choices' },
            h('legend', { class: 'n-g n-lab n-osheet__legend', text: A.saved }),
            ...[...list.map((a) => ({ id: a.id, words: savedChoice(a), isDefault: a.isDefault })), { id: 'new', words: A.newAddress, isDefault: false }].map((c) => {
              const radio = h('input', { class: 'n-osheet__radio', attrs: { type: 'radio', name: 'order-address-choice', value: c.id } });
              radio.checked = this.choice === c.id;
              radio.addEventListener('change', () => {
                if (!radio.checked) return;
                this.choice = c.id;
                this.render();
                this.panel.querySelector<HTMLElement>(`input[name="order-address-choice"][value="${c.id}"]`)?.focus({ preventScroll: true });
              });
              return h(
                'label',
                { class: ['n-row', 'n-osheet__choice', c.id === 'new' ? 'n-osheet__choice--new' : null], data: { address: c.id } },
                radio,
                h('span', { class: c.id === 'new' ? 'n-g n-row__label' : 'n-sm n-osheet__choice-words' }, c.words),
                c.isDefault ? h('span', { class: 'n-g n-lb n-ivc n-osheet__default', text: A.isDefault }) : null,
              );
            }),
          )
        : null;
    const unreadable = this.savedError ? h('p', { class: 'n-err n-osheet__unreadable', attrs: { role: 'alert' }, text: `${ACCOUNT_ADDRESSES.unreadable} ${this.savedError}` }) : null;
    const typing = this.choice === 'new';
    const form = nocturneForm(
      this.deps.session,
      'order-address',
      [
        ...(choices ? [choices] : []),
        ...(typing ? [...fields.els, h('label', { class: 'n-row n-osheet__save' }, h('span', { class: 'n-g n-row__label', text: A.save }), save.el)] : []),
      ],
      A.confirm,
      async () => {
        const choice = typing ? { address: fields.read(), save: save.input.checked } : { addressId: this.choice };
        let order: AccountOrder;
        try {
          order = await this.deps.api.setOrderAddress(req.order.id, choice);
        } catch (e) {
          this.deps.session.noteError(e);
          throw new FormError(`${A.failed} ${messageOf(e)}`);
        }
        this.done(order);
      },
    );
    return [unreadable, form, this.cancel()].filter((x): x is HTMLElement => x !== null);
  }

  // ── ENGRAVING (§3.6.C) ───────────────────────────────────────────────────

  private engravingView(m: OrderEngravingModel): HTMLElement[] {
    const E = ORDERS.engraving;
    const req = this.req;
    if (!req || req.kind !== 'engraving') return [];
    const input = h('input', { class: 'n-fld__input', id: 'order-engraving', attrs: { type: 'text', name: 'engraving', maxlength: m.maxLength, autocomplete: 'off', required: true, 'aria-describedby': 'order-engraving-hint', spellcheck: 'false' } });
    input.value = m.text;
    const field = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'order-engraving' } }, h('span', { class: 'n-g n-lab', text: E.field })),
      input,
      h('p', { class: 'n-sm n-fld__hint', id: 'order-engraving-hint', text: E.hint }),
    );
    const lines: HTMLElement[] = [];
    if (m.priceLine) lines.push(h('p', { class: m.included ? 'n-sm n-osheet__price' : 'n-g n-lb n-ivc n-osheet__price', text: m.priceLine }));
    if (m.addNote) lines.push(h('p', { class: 'n-sm n-osheet__note', text: m.addNote }));
    const form = nocturneForm(this.deps.session, 'order-engraving', [field, ...lines], E.save, async () => {
      const text = input.value.replace(/\s+/g, ' ').trim();
      if (!text) {
        input.setAttribute('aria-invalid', 'true');
        throw new FormError(E.empty);
      }
      if ([...text].length > m.maxLength || !ENGRAVING_WORDS.test(text)) {
        input.setAttribute('aria-invalid', 'true');
        throw new FormError(E.invalid);
      }
      await this.sendEngraving(req.order.id, text);
    });
    const removeError = h('p', { class: 'n-err n-osheet__remove-error', attrs: { role: 'alert', hidden: true } });
    let remove: HTMLElement | null = null;
    if (m.removable) {
      remove = textLink(E.remove, {
        extraClass: 'n-osheet__remove',
        onOpen: () => {
          if (this.busy || !(remove instanceof HTMLButtonElement)) return;
          const b = remove;
          this.busy = true;
          b.disabled = true;
          b.setAttribute('aria-busy', 'true');
          removeError.hidden = true;
          void this.sendEngraving(req.order.id, null)
            .catch((e: unknown) => {
              removeError.textContent = e instanceof Error ? e.message : E.failed;
              removeError.hidden = false;
              b.focus({ preventScroll: true });
            })
            .finally(() => {
              this.busy = false;
              b.disabled = false;
              b.setAttribute('aria-busy', 'false');
            });
        },
      });
    }
    return [
      h('p', { class: 'n-tx n-osheet__lead', text: E.lead }),
      form,
      ...(remove && m.removeNote ? [h('p', { class: 'n-sm n-osheet__note', text: m.removeNote })] : []),
      ...(remove ? [remove, removeError] : []),
      this.cancel(),
    ];
  }

  /** The engraving saved (its words) or removed (null); a failure as the sheet's sentence and the server's words. */
  private async sendEngraving(orderId: string, text: string | null): Promise<void> {
    let order: AccountOrder;
    try {
      order = await this.deps.api.setEngraving(orderId, text);
    } catch (e) {
      this.deps.session.noteError(e);
      throw new FormError(`${ORDERS.engraving.failed} ${messageOf(e)}`);
    }
    this.done(order);
  }

  // ── REQUEST A RETURN, EXCHANGE THE SIZE (§3.6.D) ─────────────────────────

  private requestView(kind: 'RETURN' | 'EXCHANGE', m: OrderReturnsModel): HTMLElement[] {
    const R = ORDERS.returns;
    const req = this.req;
    if (!req) return [];
    const inStock = m.sizes.filter((z) => z.available);
    const sizes: HTMLElement[] = [];
    if (kind === 'EXCHANGE') {
      const group = sizeButtons(
        m.sizes.map((z) => ({ id: z.label, label: z.label })),
        {
          selected: this.size,
          label: R.newSize,
          unavailable: new Set(m.sizes.filter((z) => !z.available).map((z) => z.label)),
          unavailableLabel: R.sizeOut,
          onSelect: (id) => {
            this.size = id;
            for (const b of group.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.textContent === id));
          },
        },
      );
      group.classList.add('n-osheet__sizes');
      sizes.push(
        h('p', { class: 'n-g n-lab n-osheet__size-label', text: R.newSize }),
        group,
        h('p', { class: 'n-sm n-osheet__size-note', text: inStock.length > 0 ? R.onlyInStock : R.noneInStock }),
      );
      // No size in stock: nothing to send.
      if (inStock.length === 0) return [...sizes, this.cancel()];
    }
    const reason = selectField('order-request-reason', R.reason, [{ value: '', label: R.chooseReason }, ...REASONS.map((r) => ({ value: r, label: R.reasons[r] }))], '');
    const note = h('textarea', { class: 'n-fld__input n-write__area', id: 'order-request-note', attrs: { name: 'note', rows: 3, maxlength: 500, autocomplete: 'off', 'aria-describedby': 'order-request-note-hint' } });
    const noteField = h(
      'div',
      { class: 'n-fld-group' },
      h('label', { class: 'n-fld', attrs: { for: 'order-request-note' } }, h('span', { class: 'n-g n-lab', text: R.note })),
      note,
      h('p', { class: 'n-sm n-fld__hint', id: 'order-request-note-hint', text: R.noteHint }),
    );
    const form = nocturneForm(
      this.deps.session,
      'order-request',
      [...sizes, reason.el, noteField, h('p', { class: 'n-sm n-osheet__decides', text: R.decides })],
      R.send,
      async () => {
        if (kind === 'EXCHANGE' && (this.size === null || !inStock.some((z) => z.label === this.size))) throw new FormError(R.sizeMissing);
        const why = reason.select.value as OrderCaseRequest['reason'] | '';
        if (!why) {
          reason.select.setAttribute('aria-invalid', 'true');
          throw new FormError(R.reasonMissing);
        }
        const words = note.value.replace(/\r\n?/g, '\n').trim();
        let order: AccountOrder;
        try {
          order = await this.deps.api.requestOrderCase(req.order.id, { kind, reason: why, note: words || null, ...(kind === 'EXCHANGE' ? { sizeLabel: this.size } : {}) });
        } catch (e) {
          this.deps.session.noteError(e);
          throw new FormError(`${R.failed} ${messageOf(e)}`);
        }
        this.done(order);
      },
    );
    return [form, this.cancel()];
  }
}
