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
 *   A REQUEST          for an exchange THE NEW SIZE (the sizes in stock; the others greyed out; the size YOUR SIZES
 *                      suggests preselected with SIZE 52 · FROM YOUR SIZES and the sentence to check it, until another is
 *                      tapped: plan CUSTOMER INTELLIGENCE §3.7), REASON (one of four), YOUR NOTE (500 characters); who
 *                      decides; SEND THE REQUEST, CANCEL.
 *
 * Each sends one request at a time (its filled button disabled and busy meanwhile); a failure is said under the fields,
 * the sheet's sentence then the server's own words. Done: the sheet closes and its order's card is drawn again from the
 * order the server answered. The app holds one sheet (registerOrderSheet); a card only asks for it (openOrderSheet).
 */
import { h } from '../../shared/dom.js';
import type { ApiClient } from '../api.js';
import { mayAddAddress, sameAddress, savedChoice } from '../addresses-model.js';
import { addonSheet, addonPrice, rowsChoice, rowsLimit, rowsTotal, withUnits, type AddonRowModel, type AddonSheetModel } from '../addons-model.js';
import { ACCOUNT_ADDRESSES, LIVE, MESSAGES, ORDERS, PIECES, SETS } from '../copy.js';
import { savedSizeLine, type OrderEngravingModel, type OrderModel, type OrderReturnsModel } from '../orders-model.js';
import type { SessionStore } from '../session.js';
import type { AccountAddresses, AccountOrder, OrderCaseRequest } from '../types.js';
import { addressFields } from './address.js';
import { addonRowsList, focusedStep, refocusStep } from './addon-rows.js';
import { withNumerals } from './common.js';
import { FormError, messageOf, nocturneForm } from './forms.js';
import { button, icon, selectField, sizeButtons, switchControl, textLink } from './nocturne.js';

/** What a card asks a sheet for: its kind, its order, the control that opened it, and what to do with the order the server answers. */
export type OrderSheetRequest =
  | { kind: 'address'; order: OrderModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null }
  | { kind: 'engraving'; order: OrderModel; engraving: OrderEngravingModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null }
  | { kind: 'addons'; order: OrderModel; trigger: HTMLElement; onDone(order: AccountOrder): HTMLElement | null }
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
  api: Pick<ApiClient, 'addresses' | 'setOrderAddress' | 'setEngraving' | 'requestOrderCase' | 'orderAddonOffer' | 'addOrderAddon'>;
  session: SessionStore;
  /** What the page holds outside the sheet, made inert while it is open. */
  outside(): HTMLElement[];
  /**
   * Desktop (decision 5: an order's edits are forms of its page, never a sheet): the form drawn in its
   * section of the order's page (views/desktop-order.ts), which is told when it closes (`focus`: what takes the keyboard
   * focus, else the section's own control); none on a phone.
   */
  inline?: { closed(focus: HTMLElement | null): void; drawn?(panel: HTMLElement): void };
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
  /** The new size of an exchange: YOUR SIZES' preselected as it opens (plan CUSTOMER INTELLIGENCE §3.7), then the one tapped. */
  private size: string | null = null;
  /** A size tapped in THE NEW SIZE: YOUR SIZES' lines go. */
  private sizeTapped = false;
  private busy = false;
  /**
   * ADD AN ADD-ON (plan MACRO M3 §4.4, D2): what the order may take, as read when the sheet opened (null while read;
   * `offerError` when it could not be), the units chosen, and an order the server answered for add-ons already added
   * when a later one was refused (drawn on its card when the sheet closes).
   */
  private offer: AddonSheetModel | null = null;
  private offerError: string | null = null;
  private addonUnits = new Map<string, number>();
  private addedOrder: AccountOrder | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: OrderSheetDeps) {
    if (deps.inline) {
      // Desktop: a form of the order's page, in its section (no plate, no scrim, no dialog).
      this.panel = h('div', { class: 'd-oform' });
      this.el = this.panel;
      this.el.hidden = true;
    } else {
      this.panel = h('section', { class: 'n-account__panel n-write__panel n-osheet__panel', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'order-sheet-title' } });
      this.el = h('div', { class: 'n-account n-write n-osheet', attrs: { hidden: true } }, h('div', { class: 'n-account__scrim', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.close() } }), this.panel);
    }
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
    // EXCHANGE THE SIZE opens on the size YOUR SIZES suggests, in stock (none: nothing chosen); the sheet keeps what it read.
    this.size = req.kind === 'EXCHANGE' ? req.returns.savedSize : null;
    this.sizeTapped = false;
    this.busy = false;
    this.choice = 'new';
    this.offer = null;
    this.offerError = null;
    this.addonUnits = new Map();
    this.addedOrder = null;
    this.el.hidden = false;
    if (!this.deps.inline) {
      document.documentElement.classList.add('n-locked');
      for (const el of this.deps.outside()) el.inert = true;
    }
    // Signed out here or elsewhere: the order is no longer this page's to change.
    this.unsubscribe = this.deps.session.subscribe((s) => {
      if (s.status === 'anonymous') this.close();
    });
    this.render();
    this.focusStart();
    if (req.kind === 'address') void this.readSaved();
    if (req.kind === 'addons') void this.readOffer();
  }

  /** The keyboard focus on the sheet's title; in a page's section (desktop), on its heading or first field. */
  private focusStart(): void {
    const target = this.title() ?? (this.deps.inline ? this.panel.querySelector<HTMLElement>('input:checked, input:not([type="radio"]), select, textarea, button') : null);
    target?.focus({ preventScroll: true });
  }

  /** Closed: the focus back on `focus` (the card drawn again), else on the control that opened it. */
  close(focus: HTMLElement | null = null): void {
    if (!this.isOpen) return;
    // Add-ons added before one was refused: the card drawn with them as the sheet closes.
    const added = this.addedOrder;
    this.addedOrder = null;
    if (added && this.req && focus === null) focus = this.req.onDone(added);
    this.readGen++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.el.hidden = true;
    if (this.deps.inline) {
      this.panel.replaceChildren();
      this.req = null;
      this.deps.inline.closed(focus);
      return;
    }
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
    const title =
      req.kind === 'address'
        ? ORDERS.address.title
        : req.kind === 'engraving'
          ? ORDERS.engraving.title
          : req.kind === 'addons'
            ? ORDERS.addons.add
            : req.kind === 'RETURN'
              ? req.returns.set
                ? SETS.orders.returnSet
                : ORDERS.returns.requestReturn
              : ORDERS.returns.exchange;
    const concerning = req.kind === 'RETURN' || req.kind === 'EXCHANGE' ? req.returns.concerning : req.order.concerning;
    const head = h(
      'div',
      { class: 'n-px n-sb n-account__head' },
      h('h2', { class: 'n-g n-lb n-write__title', id: 'order-sheet-title', attrs: { tabindex: -1 }, text: title }),
      h('button', { class: 'n-account__close', attrs: { type: 'button', 'aria-label': MESSAGES.close }, on: { click: () => this.close() } }, icon('close')),
    );
    const about = h('div', { class: 'n-px n-write__concerning' }, h('p', { class: 'n-g n-ivc n-write__label n-osheet__concerning', attrs: { 'data-testid': 'order-sheet-concerning' } }, ...withNumerals(concerning)));
    const body =
      req.kind === 'address' ? this.addressView() : req.kind === 'engraving' ? this.engravingView(req.engraving) : req.kind === 'addons' ? this.addonsView() : this.requestView(req.kind, req.returns);
    if (this.deps.inline) {
      // Desktop: the form in its section, under the section's own label (the page is the order's: what it
      // concerns goes without saying); a request titled by what it asks; CANCEL beside the main action (§10.22).
      const heading = req.kind === 'RETURN' || req.kind === 'EXCHANGE' ? h('h3', { class: 'n-g d-oform__title', id: 'order-sheet-title', attrs: { tabindex: -1 }, text: title }) : null;
      this.panel.replaceChildren(...(heading ? [heading] : []), ...body);
      const actions = this.panel.querySelector<HTMLElement>('form > .n-form__actions');
      const cancel = this.panel.querySelector<HTMLElement>(':scope > .n-osheet__cancel');
      if (actions && cancel) {
        actions.classList.add('n-duo');
        actions.append(cancel);
      }
      this.deps.inline.drawn?.(this.panel);
      return;
    }
    this.panel.replaceChildren(h('div', { class: 'n-handle', attrs: { 'aria-hidden': 'true' } }), head, about, h('div', { class: 'n-px n-osheet__body' }, ...body));
  }

  private cancel(): HTMLElement {
    // Desktop: in the order's page, the hairline button beside the form's main one.
    if (this.deps.inline) return button(ORDERS.address.cancel, { outline: true, onClick: () => this.close(), extraClass: 'n-osheet__cancel' });
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
    this.focusStart();
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
    // SAVE IT TO YOUR ADDRESSES only once the saved ones are read and another may be kept; at the limit, the limit's
    // sentence in its place and nothing saved.
    const save = this.saved !== null && mayAddAddress(list) ? switchControl({ label: A.save, checked: list.length === 0, onChange: () => undefined }) : null;
    const saveLine = save
      ? h('label', { class: 'n-row n-osheet__save' }, h('span', { class: 'n-g n-row__label', text: A.save }), save.el)
      : this.saved !== null
        ? h('p', { class: 'n-sm n-osheet__save-limit', text: ACCOUNT_ADDRESSES.limit })
        : null;
    const choices =
      list.length > 0
        ? h(
            'fieldset',
            { class: 'n-osheet__choices' },
            h('legend', { class: 'n-g n-lab n-osheet__legend', text: A.saved }),
            ...[...list.map((a) => ({ id: a.id, words: savedChoice(a), isDefault: a.isDefault })), { id: 'new', words: A.newAddress, isDefault: false }].map((c) => {
              // NOCTURNE's option row (.n-opt): the radio itself kept for its name, value, arrows and checked state, out of
              // sight; its hairline ring drawn by .n-opt__mark.
              const radio = h('input', { class: 'n-opt__input', attrs: { type: 'radio', name: 'order-address-choice', value: c.id } });
              radio.checked = this.choice === c.id;
              radio.addEventListener('change', () => {
                if (!radio.checked) return;
                this.choice = c.id;
                this.render();
                this.panel.querySelector<HTMLElement>(`input[name="order-address-choice"][value="${c.id}"]`)?.focus({ preventScroll: true });
              });
              return h(
                'label',
                { class: ['n-opt', 'n-osheet__choice', c.id === 'new' ? 'n-osheet__choice--new' : null], data: { address: c.id } },
                radio,
                h('i', { class: 'n-opt__mark', attrs: { 'aria-hidden': 'true' } }),
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
        ...(typing ? [...fields.els, ...(saveLine ? [saveLine] : [])] : []),
      ],
      A.confirm,
      async () => {
        const choice = typing ? { address: fields.read(), save: save?.input.checked ?? false } : { addressId: this.choice };
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
      h('p', { class: 'n-sm n-fld__hint', id: 'order-engraving-hint', text: E.hint(m.maxLength) }),
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
        throw new FormError(E.invalid(m.maxLength));
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

  // ── ADD AN ADD-ON (plan MACRO M3 §4.4, D2) ───────────────────────────────

  /** What the order may take now, read once as the sheet opens (TRY AGAIN reads it again). */
  private async readOffer(): Promise<void> {
    const req = this.req;
    if (!req || req.kind !== 'addons') return;
    const gen = ++this.readGen;
    this.offer = null;
    this.offerError = null;
    this.render();
    try {
      const offer = await this.deps.api.orderAddonOffer(req.order.id);
      if (gen !== this.readGen || !this.isOpen) return;
      this.offer = addonSheet(offer);
    } catch (e) {
      this.deps.session.noteError(e);
      if (gen !== this.readGen || !this.isOpen) return;
      this.offerError = messageOf(e);
    }
    this.render();
    this.focusStart();
  }

  /**
   * The add-ons the order may take: ONE MOMENT… while they are read; could not be shown (the server's words, TRY AGAIN);
   * none available, or packing begun; else their rows, the total they add, once paid that each has its own invoice, ADD
   * and CANCEL.
   */
  private addonsView(): HTMLElement[] {
    const A = ORDERS.addons;
    const req = this.req;
    if (!req || req.kind !== 'addons') return [];
    const lead = h('p', { class: 'n-tx n-osheet__lead', text: A.lead });
    if (this.offer === null && this.offerError === null) return [lead, h('p', { class: 'n-g n-lb n-osheet__loading', attrs: { role: 'status' }, text: A.loading }), this.cancel()];
    if (this.offerError !== null) {
      return [
        lead,
        h('p', { class: 'n-err n-osheet__unreadable', attrs: { role: 'alert' }, text: `${A.loadFailed} ${this.offerError}` }),
        h('p', { class: 'n-osheet__retry' }, textLink(PIECES.retry, { onOpen: () => void this.readOffer(), extraClass: 'n-osheet__retry-link' })),
        this.cancel(),
      ];
    }
    const m = this.offer!;
    if (m.empty !== null) return [lead, h('p', { class: 'n-tx n-osheet__none', attrs: { role: 'status' }, text: m.empty }), this.cancel()];
    const list = h('div', { class: 'n-osheet__addons' });
    const total = h('p', { class: 'n-g n-lb n-addons-total', attrs: { 'aria-live': 'polite' } });
    const limit = h('p', { class: 'n-sm n-addons-note', attrs: { hidden: true } });
    const draw = () => {
      const rows = this.addonRowsNow(m);
      const focus = focusedStep(list);
      list.replaceChildren(addonRowsList({ rows, label: A.choices, idPrefix: 'order-addon', disabled: this.busy, onChange: (id, n) => this.setUnits(rows, id, n, draw) }));
      if (focus) refocusStep(list, focus.addonId, focus.which);
      const minor = rowsTotal(rows);
      total.replaceChildren(h('span', { text: A.total }), h('span', { class: 'n-num n-addons-total__value', text: minor > 0 && m.currency ? addonPrice(minor, m.currency) : '—' }));
      const note = rowsLimit(rows);
      limit.textContent = note ?? '';
      limit.hidden = note === null;
    };
    draw();
    const form = nocturneForm(
      this.deps.session,
      'order-addons',
      [list, limit, total, ...(m.paidNote ? [h('p', { class: 'n-sm n-osheet__note', text: m.paidNote })] : [])],
      A.save,
      async () => {
        const chosen = rowsChoice(this.addonRowsNow(m));
        if (chosen.length === 0) {
          list.querySelector<HTMLElement>('.n-step__btn[data-step="more"]:not(:disabled)')?.setAttribute('aria-invalid', 'true');
          throw new FormError(A.choose);
        }
        this.busy = true;
        draw();
        let order: AccountOrder | null = null;
        try {
          // One add-on at a time, as the server takes them; each added is kept, should a later one be refused.
          for (const c of chosen) {
            order = await this.deps.api.addOrderAddon(req.order.id, c.addonId, c.units);
            this.addedOrder = order;
            this.addonUnits.delete(c.addonId);
          }
        } catch (e) {
          this.deps.session.noteError(e);
          this.busy = false;
          draw();
          throw new FormError(`${A.failed} ${messageOf(e)}`);
        }
        this.busy = false;
        this.addedOrder = null;
        if (order) this.done(order);
      },
    );
    return [lead, form, this.cancel()];
  }

  private addonRowsNow(m: AddonSheetModel): AddonRowModel[] {
    return m.rows.map((r) => ({ ...r, units: Math.min(r.max, this.addonUnits.get(r.addonId) ?? 0) }));
  }

  private setUnits(rows: readonly AddonRowModel[], addonId: string, units: number, draw: () => void): void {
    if (this.busy) return;
    for (const r of withUnits(rows, addonId, units)) this.addonUnits.set(r.addonId, r.units);
    this.panel.querySelector('.n-step__btn[aria-invalid="true"]')?.removeAttribute('aria-invalid');
    draw();
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
            this.sizeTapped = true;
            for (const b of group.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.textContent === id));
            // Chosen by the collector now: YOUR SIZES' lines go, as in the LIVE room and the salon.
            yours?.remove();
          },
        },
      );
      group.classList.add('n-osheet__sizes');
      // Plan CUSTOMER INTELLIGENCE §3.7: the size YOUR SIZES suggests, preselected while it stands untapped.
      const yours =
        !this.sizeTapped && m.savedSize !== null && this.size === m.savedSize
          ? h(
              'div',
              { class: 'n-osheet__yours' },
              h('p', { class: 'n-g n-lb n-osheet__yours-size' }, ...withNumerals(savedSizeLine(m.savedSize))),
              h('p', { class: 'n-sm n-osheet__yours-check', text: LIVE.there.checkSize }),
            )
          : null;
      sizes.push(
        h('p', { class: 'n-g n-lab n-osheet__size-label', text: R.newSize }),
        group,
        ...(yours ? [yours] : []),
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
    // Macro scope K44 T3: a set is returned whole, said before its reason.
    const whole = kind === 'RETURN' && m.set ? [h('p', { class: 'n-sm n-osheet__whole', text: SETS.orders.returnWhole })] : [];
    const form = nocturneForm(
      this.deps.session,
      'order-request',
      [...whole, ...sizes, reason.el, noteField, h('p', { class: 'n-sm n-osheet__decides', text: R.decides })],
      R.send,
      async () => {
        if (kind === 'EXCHANGE' && (this.size === null || !inStock.some((z) => z.label === this.size))) {
          // The focus goes to the sizes the message is about: their first one in stock.
          this.panel.querySelector<HTMLElement>('.n-osheet__sizes button:not(:disabled)')?.setAttribute('aria-invalid', 'true');
          throw new FormError(R.sizeMissing);
        }
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
