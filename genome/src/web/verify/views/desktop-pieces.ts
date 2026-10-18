/**
 * MY PIECES on a computer (desktop, BRIEF §10.16, §10.18): a piece's tile leads to its page from its
 * photograph and its name too, as every photo tile does on a computer (YOUR PIECES, PAIRS WELL WITH, YOUR WISHLIST),
 * not only from SEE THE PIECE (shared/desktop.ts watchBar applies it each time the list is drawn, and undoes it on a
 * phone).
 *
 * The photograph takes a link over it and the name's words a link inside its heading, both to SEE THE PIECE's address:
 * a plain click is SEE THE PIECE's (the piece's page, in the app), a click that opens a new tab is left to the browser.
 * They stay out of the Tab order and the photograph's out of the accessibility tree: SEE THE PIECE remains the tile's one
 * link for the keyboard and for a screen reader. The piece's serial beside the name stays text, selected whole in one
 * click (§10.19).
 *
 * And a page of the step that has no title of its own on a phone (a piece or a post that could not be shown, a post's
 * address that leads nowhere, THE CIRCLE closed to an account without a piece, reached by a post's address): its
 * sentence is the page's h1 on a computer (§10.32), the same words, id and focus; put back on a phone.
 */
import { h } from '../../shared/dom.js';
import type { Arrangement } from '../../shared/desktop.js';

const TILE = '.view--pieces .n-pieces__piece';
const OPEN = 'd-ptile__open';
const NAME = 'd-ptile__name';

/** A plain click follows SEE THE PIECE (its own handler keeps it in the app); any other is the browser's. */
function follow(see: HTMLAnchorElement): (ev: Event) => void {
  return (ev: Event) => {
    const m = ev as MouseEvent;
    if (m.defaultPrevented || m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
    ev.preventDefault();
    see.click();
  };
}

function arrangeTile(tile: HTMLElement): void {
  const see = tile.querySelector<HTMLAnchorElement>('a.n-pieces__see');
  const href = see?.getAttribute('href');
  if (!see || !href) return;
  const photo = tile.querySelector<HTMLElement>(':scope > .n-ph');
  if (photo && !photo.querySelector(`:scope > .${OPEN}`)) {
    photo.append(h('a', { class: OPEN, attrs: { href, tabindex: -1, 'aria-hidden': 'true' }, on: { click: follow(see) } }));
  }
  const name = tile.querySelector<HTMLElement>('.n-pieces__name');
  if (name && !name.querySelector(`:scope > .${NAME}`)) {
    name.append(h('a', { class: NAME, attrs: { href, tabindex: -1 }, on: { click: follow(see) } }, ...name.childNodes));
  }
}

/** The sentences that name a page without a title, by their page. */
const UNTITLED = '.view--piece .n-piece__failed .n-failed__sentence, .view--circle-post .n-post__failed .n-failed__sentence, .view--circle-post .n-post__head--bare > p.n-quiet';
const TITLE = 'd-untitled__h1';

/** Each sentence set as an h1 on a computer, and the element it stood as. */
const headed = new Map<HTMLElement, HTMLElement>();

function headUntitled(root: ParentNode): void {
  for (const head of headed.keys()) if (!head.isConnected) headed.delete(head);
  for (const line of root.querySelectorAll<HTMLElement>(UNTITLED)) {
    // A page that has an h1 already (its own title, the signed-out page's) keeps it alone.
    if (line.closest('main')?.querySelector('h1')) continue;
    const head = h('h1', { class: [...line.classList, TITLE], attrs: { id: line.id || undefined, tabindex: line.getAttribute('tabindex') ?? undefined, role: line.getAttribute('role') ?? undefined } }, ...line.childNodes);
    const focused = document.activeElement === line;
    line.replaceWith(head);
    headed.set(head, line);
    if (focused) head.focus({ preventScroll: true });
  }
}

export const piecesArrangement: Arrangement = {
  apply(root) {
    for (const tile of root.querySelectorAll<HTMLElement>(TILE)) arrangeTile(tile);
    headUntitled(root);
  },
  undo() {
    for (const open of document.querySelectorAll(`.${OPEN}`)) open.remove();
    for (const link of document.querySelectorAll<HTMLElement>(`.${NAME}`)) link.replaceWith(...link.childNodes);
    for (const [head, line] of headed) {
      if (!head.isConnected) continue;
      const focused = document.activeElement === head;
      line.replaceChildren(...head.childNodes);
      head.replaceWith(line);
      if (focused) line.focus({ preventScroll: true });
    }
    headed.clear();
  },
};
