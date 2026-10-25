/**
 * 5b, SECURED with add-ons (lot Q2, step Q2.8; MK #secured-addons, gen.mjs 229–262; D11, D12, D37, N1–N3): the hold's
 * add-ons as rows you tap to choose, drawn in the group `box` (views/live.ts securedScreen) from live-model.ts
 * securedAddons at each change of the entry. Each row: a button (`aria-pressed`) with its mark, its name and `+ € 15`, its
 * one line under it (the button's description); ENGRAVING chosen, YOUR TEXT under its line: the words, named by the
 * visible YOUR TEXT and the row's name (no sentence of its own), described by the row's line and the count, at most the
 * engraving's own most characters (`maxlength`), saved when it is left (its change) and before PAY.
 *
 * The rows are drawn again only when their set changes (an add-on offered or no longer, the engraving's field shown or
 * not); otherwise each keeps its elements and only its state changes, so YOUR TEXT keeps its words and its focus while
 * the room's state is read. CSP-safe: shared/dom.ts h(), no inline style.
 */
import { h } from '../../shared/dom.js';
import { LIVE } from '../copy.js';
import type { SecuredAddonRow } from '../live-model.js';
import { withNumerals } from './common.js';

export interface SecuredAddonsHandlers {
  /** A row tapped: chosen, or let go. */
  choose(addonId: string): void;
  /** YOUR TEXT's words as they are typed. */
  typed(addonId: string, value: string): void;
  /** YOUR TEXT left (its change, or Enter): its words saved. */
  save(addonId: string): void;
}

interface RowParts {
  item: HTMLElement;
  button: HTMLButtonElement;
  input: HTMLInputElement | null;
  count: HTMLElement | null;
}

export class SecuredAddonsView {
  private key = '';
  private readonly parts = new Map<string, RowParts>();
  /** The row whose button was last pressed: its button keeps the focus when the rows are drawn again. */
  private pressed: string | null = null;

  constructor(
    private readonly box: HTMLElement,
    private readonly on: SecuredAddonsHandlers,
  ) {}

  /** The rows as they stand now; every row's button disabled while a choice is being sent (`busy`); `invalid`: the engraving whose words cannot be engraved. */
  draw(rows: readonly SecuredAddonRow[], busy: boolean, invalid: string | null = null): void {
    const key = JSON.stringify(rows.map((r) => [r.addonId, r.name, r.line, r.price, r.text ? r.text.max : null]));
    if (key !== this.key) {
      const active = document.activeElement;
      const within = active === document.body || active === null || this.box.contains(active);
      let focus: { addonId: string; input: boolean } | null = null;
      for (const [addonId, p] of this.parts) {
        if (p.input && p.input === active) focus = { addonId, input: true };
        else if (p.button === active) focus = { addonId, input: false };
      }
      if (!focus && within && this.pressed) focus = { addonId: this.pressed, input: false };
      this.key = key;
      this.parts.clear();
      this.box.replaceChildren(...rows.map((r) => this.row(r)));
      const again = focus ? this.parts.get(focus.addonId) : undefined;
      if (focus && again) (focus.input && again.input ? again.input : again.button).focus({ preventScroll: true });
    }
    for (const r of rows) {
      const p = this.parts.get(r.addonId);
      if (!p) continue;
      p.item.classList.toggle('is-on', r.chosen);
      p.button.setAttribute('aria-pressed', String(r.chosen));
      p.button.disabled = busy;
      if (p.input && r.text) {
        if (document.activeElement !== p.input && p.input.value !== r.text.value) p.input.value = r.text.value;
        if (p.count && p.count.textContent !== r.text.count) p.count.textContent = r.text.count;
        if (invalid === r.addonId) p.input.setAttribute('aria-invalid', 'true');
        else p.input.removeAttribute('aria-invalid');
      }
    }
  }

  private row(r: SecuredAddonRow): HTMLElement {
    const base = `live-addon-${r.addonId}`;
    const lineId = `${base}-line`;
    const button = h(
      'button',
      {
        class: 'btn live__addon',
        attrs: { type: 'button', 'aria-pressed': String(r.chosen), 'aria-describedby': r.line ? lineId : null },
        on: {
          click: () => {
            this.pressed = r.addonId;
            this.on.choose(r.addonId);
          },
        },
      },
      h('span', { class: 'live__addon-mark', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'live__addon-label', id: `${base}-label` }, ...withNumerals(r.name)),
      ' ',
      h('span', { class: 'live__addon-price', text: r.price }),
    );
    const line = r.line ? h('p', { class: 'live__addon-line', id: lineId, text: r.line }) : null;
    let input: HTMLInputElement | null = null;
    let count: HTMLElement | null = null;
    let field: HTMLElement | null = null;
    if (r.text) {
      const countId = `${base}-count`;
      count = h('span', { class: 'ao-text__count', id: countId, attrs: { 'aria-live': 'polite' }, text: r.text.count });
      const inputEl = h('input', {
        class: 'ao-text__input',
        attrs: {
          type: 'text',
          maxlength: String(r.text.max),
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: 'false',
          'aria-labelledby': `${base}-text-label ${base}-label`,
          'aria-describedby': [r.line ? lineId : null, countId].filter(Boolean).join(' '),
        },
        on: {
          input: () => this.on.typed(r.addonId, inputEl.value),
          change: () => this.on.save(r.addonId),
          keydown: (ev) => {
            if (ev.key === 'Enter') this.on.save(r.addonId);
          },
        },
      });
      inputEl.value = r.text.value;
      input = inputEl;
      field = h('label', { class: 'ao-text' }, h('span', { class: 'ao-text__label', id: `${base}-text-label`, text: LIVE.addonText.label }), inputEl, count);
    }
    const item = h('div', { class: ['live__addon-item', r.chosen ? 'is-on' : null] }, button, line, field);
    this.parts.set(r.addonId, { item, button, input, count });
    return item;
  }
}
