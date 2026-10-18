/**
 * YOUR WISHLIST on a computer (desktop, BRIEF §10.16, §10.18): a wish the collector may open leads to its
 * model from its photograph and its name too, as every photo tile does on a computer (YOUR PIECES, PAIRS WELL WITH, THE
 * COLLECTION's frames), not only from SEE THE MODEL (shared/desktop.ts watchBar applies it each time the list is drawn,
 * and undoes it on a phone).
 *
 * The photograph takes a link over it and the name's words a link inside its heading, both to SEE THE MODEL's address:
 * a plain click is SEE THE MODEL's (its sheet, that dot selected, in the app), a click that opens a new tab is left to
 * the browser. They stay out of the Tab order and the photograph's out of the accessibility tree: SEE THE MODEL remains
 * the wish's one link for the keyboard and for a screen reader. A model not in the collection now (no SEE THE MODEL)
 * stays as it is.
 */
import { h } from '../../shared/dom.js';
import type { Arrangement } from '../../shared/desktop.js';

const CARD = '.view--wishlist .n-wishlist__card:not(.n-wishlist__card--hidden)';
const WISH = 'd-wish';
const OPEN = 'd-wish__open';
const NAME = 'd-wish__name';

/** A plain click follows SEE THE MODEL (its own handler keeps it in the app); any other is the browser's. */
function follow(see: HTMLAnchorElement): (ev: Event) => void {
  return (ev: Event) => {
    const m = ev as MouseEvent;
    if (m.defaultPrevented || m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
    ev.preventDefault();
    see.click();
  };
}

function arrangeWish(card: HTMLElement): void {
  const see = card.querySelector<HTMLAnchorElement>('a.n-wishlist__see');
  const href = see?.getAttribute('href');
  if (!see || !href) return;
  if (!card.classList.contains(WISH)) card.classList.add(WISH);
  const photo = card.querySelector<HTMLElement>(':scope > .n-ph');
  if (photo && !photo.querySelector(`:scope > .${OPEN}`)) {
    photo.append(h('a', { class: OPEN, attrs: { href, tabindex: -1, 'aria-hidden': 'true' }, on: { click: follow(see) } }));
  }
  const name = card.querySelector<HTMLElement>('.n-wishlist__name');
  if (name && !name.querySelector(`:scope > .${NAME}`)) {
    name.append(h('a', { class: NAME, attrs: { href, tabindex: -1 }, on: { click: follow(see) } }, ...name.childNodes));
  }
}

export const wishlistArrangement: Arrangement = {
  apply(root) {
    for (const card of root.querySelectorAll<HTMLElement>(CARD)) arrangeWish(card);
  },
  undo() {
    for (const open of document.querySelectorAll(`.${OPEN}`)) open.remove();
    for (const link of document.querySelectorAll<HTMLElement>(`.${NAME}`)) link.replaceWith(...link.childNodes);
    for (const card of document.querySelectorAll(`.${WISH}`)) card.classList.remove(WISH);
  },
};
