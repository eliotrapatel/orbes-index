/**
 * The catalogue add-ons' rows (plan MACRO M3 §4.4, D2), one list wherever they are chosen: the LIVE hold (in the room's
 * look, `room`), a draw's PLACE HELD, a salon request and ADD AN ADD-ON (NOCTURNE's).
 *
 *   POLISHING CLOTH                         (−)  2  (+)
 *   A soft cloth for the metal of your piece.
 *   + € 15
 *
 * Each row: its name in Gravesend capitals (wrapped, never cut), its line, its price per unit in the reading face; on
 * the right its stepper, − and + each a 44 px target, its figure between them read out as it changes (0 to what may be
 * taken, + then disabled; − disabled at 0). A row with units is marked (its hairline in ivory). Pressing a button calls
 * `onChange` with the row's new units: the caller sends it, or keeps it until its form is sent, then draws the rows again.
 * CSP-safe: h() and the line icons only.
 */
import { h } from '../../shared/dom.js';
import type { AddonRowModel } from '../addons-model.js';
import { ADDONS } from '../copy.js';
import { withNumerals } from './common.js';
import { icon } from './nocturne.js';

export interface AddonRowsOptions {
  rows: readonly AddonRowModel[];
  /** The list's accessible name. */
  label: string;
  /** Prefixes the rows' element ids (each page draws one list at a time under it). */
  idPrefix: string;
  /** Every button disabled (a request under way). */
  disabled?: boolean;
  /** The room's look (house.css): the hold of a LIVE RELEASE; NOCTURNE's otherwise. */
  room?: boolean;
  onChange(addonId: string, units: number): void;
}

/** The rows as a list; the element is drawn again by its caller after each change. */
export function addonRowsList(o: AddonRowsOptions): HTMLElement {
  return h(
    'ul',
    { class: ['n-addons', o.room ? 'n-addons--room' : null], attrs: { 'aria-label': o.label } },
    ...o.rows.map((r) => addonRow(r, o)),
  );
}

function addonRow(r: AddonRowModel, o: AddonRowsOptions): HTMLElement {
  const nameId = `${o.idPrefix}-${r.addonId}`;
  const step = (delta: -1 | 1) => {
    const next = r.units + delta;
    const b = h(
      'button',
      {
        class: ['n-step__btn', delta < 0 ? 'n-step__btn--less' : 'n-step__btn--more'],
        attrs: {
          type: 'button',
          'aria-label': delta < 0 ? ADDONS.fewer(r.name) : ADDONS.more(r.name),
          disabled: o.disabled === true || next < 0 || next > r.max,
          'aria-describedby': nameId,
        },
        on: { click: () => o.onChange(r.addonId, next) },
      },
      icon(delta < 0 ? 'minus' : 'plus', { small: true }),
    );
    b.dataset.step = delta < 0 ? 'less' : 'more';
    return b;
  };
  return h(
    'li',
    { class: ['n-addons__item', r.units > 0 ? 'is-chosen' : null], data: { addon: r.addonId } },
    h(
      'div',
      { class: 'n-addons__words' },
      h('p', { class: 'n-g n-addons__name', id: nameId }, ...withNumerals(r.name)),
      r.line ? h('p', { class: 'n-sm n-addons__line', text: r.line }) : null,
      r.price ? h('p', { class: 'n-num n-addons__price', text: r.price }) : null,
    ),
    h(
      'div',
      { class: 'n-step', attrs: { role: 'group', 'aria-labelledby': nameId } },
      step(-1),
      h('output', { class: 'n-num n-step__count', attrs: { 'aria-live': 'polite', 'aria-label': ADDONS.count(r.name, r.units) }, text: String(r.units) }),
      step(1),
    ),
  );
}

/**
 * The keyboard focus back on a row's button once the rows are drawn again (`which`: the one pressed), or on its other
 * button when that one is now disabled (+ at the most, − at 0); nothing when the focus had left the rows.
 */
export function refocusStep(root: ParentNode, addonId: string, which: 'less' | 'more'): void {
  const row = root.querySelector<HTMLElement>(`.n-addons__item[data-addon="${CSS.escape(addonId)}"]`);
  if (!row) return;
  const pressed = row.querySelector<HTMLButtonElement>(`.n-step__btn[data-step="${which}"]`);
  const other = row.querySelector<HTMLButtonElement>(`.n-step__btn[data-step="${which === 'less' ? 'more' : 'less'}"]`);
  (pressed && !pressed.disabled ? pressed : other && !other.disabled ? other : pressed)?.focus({ preventScroll: true });
}

/** Which of a row's buttons holds the keyboard focus now, to give it back once drawn again (null: none of the rows'). */
export function focusedStep(root: ParentNode): { addonId: string; which: 'less' | 'more' } | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLButtonElement) || !active.classList.contains('n-step__btn')) return null;
  const row = active.closest<HTMLElement>('.n-addons__item');
  if (!row || !(root as Node).contains(row) || !row.dataset.addon) return null;
  return { addonId: row.dataset.addon, which: active.dataset.step === 'less' ? 'less' : 'more' };
}
