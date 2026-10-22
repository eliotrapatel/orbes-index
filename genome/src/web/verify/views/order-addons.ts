/**
 * An order's ADD-ONS in YOUR ORDERS (plan MACRO M3 §4.4, D2), under its terms on a phone's card and in its own part of
 * the order's page on a computer:
 *
 *   POLISHING CLOTH × 2                         REMOVE      each add-on removable now (held, before packing): a first
 *   CHAIN EXTENDER                              REMOVE      press arms it (TAP AGAIN TO REMOVE, a few seconds; once
 *   Your order is paid: a credit note …                     paid, the credit note's line), the second removes it
 *   ADD AN ADD-ON                                           while the server offers it: the sheet (a phone) or the
 *                                                           page part (a computer) of views/order-sheet.ts
 *   Packing has begun. Add-ons can no longer be added.      in place of all that, once packing has begun
 *
 * The add-ons and their prices are among the card's terms (orders-model.ts orderRows); here only what may be done.
 * A removal sends one request; its answer (the order) is drawn by the card, the focus on ADD AN ADD-ON; a refusal is
 * said under the add-ons, the sentence then the server's words.
 */
import { h } from '../../shared/dom.js';
import { ORDERS } from '../copy.js';
import type { OrderModel } from '../orders-model.js';
import { withNumerals } from './common.js';
import { messageOf } from './forms.js';
import { textLink } from './nocturne.js';
import type { OrderDeps } from './pieces.js';

/** How long REMOVE stays armed for its second press. */
const ARMED_MS = 4000;

export interface OrderAddonsOptions {
  order: OrderModel;
  deps: OrderDeps;
  /** ADD AN ADD-ON pressed: its sheet (a phone) or its page part (a computer), `trigger` the link. */
  onAdd(trigger: HTMLElement): void;
  /** On a computer: the part's lead first, the link without a dialog's popup. */
  desktop?: boolean;
}

/** The add-ons' block of an order (its model's `addons`); none when the order has nothing to do nor say of them. */
export function orderAddonsBlock(o: OrderAddonsOptions): HTMLElement[] {
  const a = o.order.addons;
  if (!a) return [];
  const A = ORDERS.addons;
  if (a.locked) return [h('p', { class: 'n-sm n-pieces__addons-locked pieces__addons-locked', text: a.locked })];
  const note = h('p', { class: 'n-sm n-pieces__addons-note', attrs: { role: 'status', hidden: true } });
  const error = h('p', { class: 'n-err n-pieces__addons-error', attrs: { role: 'alert', hidden: true } });
  let armed: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  const links = new Map<string, HTMLButtonElement>();
  const paint = () => {
    for (const r of a.removable) {
      const link = links.get(r.addonId);
      if (!link) continue;
      const on = armed === r.addonId;
      link.textContent = on ? A.removeConfirm : A.remove;
      link.setAttribute('aria-label', on ? A.removeConfirmLabel(r.words) : r.label);
      link.disabled = busy;
    }
    note.textContent = armed && a.removeNote ? a.removeNote : '';
    note.hidden = !(armed && a.removeNote);
  };
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    armed = null;
  };
  const remove = async (addonId: string) => {
    if (busy) return;
    error.hidden = true;
    if (armed !== addonId) {
      disarm();
      armed = addonId;
      timer = setTimeout(() => {
        if (armed !== addonId) return;
        armed = null;
        timer = null;
        paint();
      }, ARMED_MS);
      paint();
      return;
    }
    disarm();
    busy = true;
    paint();
    try {
      const order = await o.deps.api.removeOrderAddon(o.order.id, addonId);
      busy = false;
      const focus = o.deps.onChanged?.(order, 'addons') ?? null;
      focus?.focus({ preventScroll: true });
    } catch (e) {
      busy = false;
      o.deps.session.noteError(e);
      error.textContent = `${A.removeFailed} ${messageOf(e)}`;
      error.hidden = false;
      paint();
      links.get(addonId)?.focus({ preventScroll: true });
    }
  };
  const list =
    a.removable.length > 0
      ? h(
          'ul',
          { class: 'n-pieces__addon-list pieces__addons', attrs: { 'aria-label': A.title } },
          ...a.removable.map((r) => {
            const link = textLink(A.remove, { extraClass: 'n-pieces__addon-remove pieces__addon-remove', onOpen: () => void remove(r.addonId) }) as HTMLButtonElement;
            link.dataset.focus = `addon-${r.addonId}`;
            link.setAttribute('aria-label', r.label);
            links.set(r.addonId, link);
            return h('li', { class: 'n-pieces__addon', data: { addon: r.addonId } }, h('span', { class: 'n-g n-lb n-pieces__addon-words' }, ...withNumerals(r.words)), link);
          }),
        )
      : null;
  let add: HTMLElement | null = null;
  if (a.canAdd) {
    const link: HTMLElement = textLink(A.add, { extraClass: 'n-pieces__addons-add-link pieces__addons-add', onOpen: () => o.onAdd(link) });
    link.dataset.focus = 'addons';
    if (!o.desktop) link.setAttribute('aria-haspopup', 'dialog');
    add = h('p', { class: o.desktop ? 'd-order__do n-pieces__addons-add' : 'n-pieces__addons-add' }, link);
  }
  paint();
  // On a phone, its label above the add-ons removable (a computer's part is labelled by its row).
  const label = list && !o.desktop ? h('p', { class: 'n-g n-lb n-pieces__addons-label', text: A.title }) : null;
  return [label, list, note, error, add].filter((x): x is HTMLElement => x !== null);
}
