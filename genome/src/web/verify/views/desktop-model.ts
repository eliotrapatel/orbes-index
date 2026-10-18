/**
 * A model's sheet on a computer (desktop, BRIEF decision 1, §10.21, §10.22, §10.27): what the desktop layout
 * changes in the sheet's page, not only in its styles (shared/desktop.ts watchBar applies it each time the sheet is
 * drawn, and undoes it on a phone).
 *
 * - THE PRIVATE SALON: its words (the label, the price and the tier, its sentence) on the left columns, beside them its
 *   form (YOUR SIZE, the note, REQUEST THIS PIECE) or, once requested, REQUESTED and WRITE TO ORBES CLIENT SERVICES on the
 *   right ones, both from the top of their labels (`d-salon__side`, `d-salon__form`).
 * - The gallery: after the story, the specifications and the care that stand beside it (the page in the eye's order),
 *   a grid of square tiles, each a button that enlarges its photograph in the viewer: the window filled by the mode's
 *   ground, the photograph whole (never larger than its file), PREVIOUS and NEXT on the edges, CLOSE at the top right,
 *   where it stands at the foot; ←, → and Escape; a click on the ground closes, one on the photograph does nothing; the
 *   focus kept inside while it is open and given back to its tile after. Its changes are opacity alone (200 ms; at once
 *   under reduced motion), its neighbours read ahead, and the page behind does not move.
 */
import { h, prefersReducedMotion } from '../../shared/dom.js';
import { moveAfter, type Arrangement } from '../../shared/desktop.js';
import { DESKTOP } from '../copy.js';
import { icon } from './nocturne.js';

const SALON = '.view--sheet .n-model__salon';
const SIDE = 'd-salon__side';
const FORM = 'd-salon__form';
/** The salon's words that stand on the left: its label, its price and tier, its sentence. */
const SIDE_ITEMS = ':scope > :is(.n-model__heading, .sheet__salon-rows, .n-model__salon-lead)';

const GALLERY = '.view--sheet .n-model__gallery';
const TILE = 'n-model__gallery-photo';
const OPEN = 'd-gallery__open';

function arrangeSalon(salon: HTMLElement): void {
  if (salon.querySelector(`:scope > .${SIDE}`)) return;
  const side = [...salon.querySelectorAll<HTMLElement>(SIDE_ITEMS)];
  const form = [...salon.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !side.includes(el));
  // The two wrappers keep the phone's order (side, then form): undone by putting their children back in their place.
  salon.append(h('div', { class: SIDE }, ...side), h('div', { class: FORM }, ...form));
  salon.classList.add('d-salon');
}

function undoSalon(): void {
  for (const salon of document.querySelectorAll<HTMLElement>('.d-salon')) {
    for (const box of salon.querySelectorAll<HTMLElement>(`:scope > .${SIDE}, :scope > .${FORM}`)) box.replaceWith(...box.childNodes);
    salon.classList.remove('d-salon');
  }
}

/** Each photograph of the gallery a tile: a button over it that opens the viewer at it. */
function arrangeGallery(gallery: HTMLElement): void {
  const tiles = [...gallery.querySelectorAll<HTMLElement>(`:scope > .${TILE}:not([hidden])`)];
  gallery.classList.add('d-gallery');
  tiles.forEach((tile, i) => {
    const label = DESKTOP.viewer.enlarge(i + 1, tiles.length);
    let open = tile.querySelector<HTMLButtonElement>(`:scope > .${OPEN}`);
    if (!open) {
      open = h('button', { class: OPEN, attrs: { type: 'button' }, on: { click: () => openViewer(gallery, tile) } });
      tile.append(open);
    }
    if (open.getAttribute('aria-label') !== label) open.setAttribute('aria-label', label);
  });
}

function undoGallery(): void {
  closeViewer(false);
  for (const open of document.querySelectorAll(`.${OPEN}`)) open.remove();
  for (const g of document.querySelectorAll('.d-gallery')) g.classList.remove('d-gallery');
}

export const modelArrangement: Arrangement = {
  apply(root) {
    const salon = root.querySelector<HTMLElement>(SALON);
    if (salon) arrangeSalon(salon);
    const gallery = root.querySelector<HTMLElement>(GALLERY);
    if (gallery) {
      // After the story's pair: the care, else the specifications, else the story itself.
      const body = gallery.parentElement;
      const pair = body ? [...body.querySelectorAll<HTMLElement>(':scope > .sheet__section:is(:has(.n-model__care), :has(.n-model__facts):not(.n-model__salon), :has(.n-model__story))')] : [];
      const after = pair[pair.length - 1];
      if (after) moveAfter(gallery, after);
      arrangeGallery(gallery);
    }
  },
  undo() {
    undoSalon();
    undoGallery();
  },
};

// ── The viewer (§10.21) ──────────────────────────────────────────────────────

interface Shown {
  root: HTMLElement;
  stage: HTMLElement;
  photos: { src: string; alt: string }[];
  at: number;
  position: HTMLElement;
  opener: HTMLElement | null;
  buttons: HTMLButtonElement[];
}

let shown: Shown | null = null;
const FADE_MS = 200;

function photosOf(gallery: HTMLElement): { tiles: HTMLElement[]; photos: { src: string; alt: string }[] } {
  const tiles = [...gallery.querySelectorAll<HTMLElement>(`:scope > .${TILE}:not([hidden])`)];
  const photos = tiles.map((t) => {
    const img = t.querySelector('img');
    return { src: img?.currentSrc || img?.getAttribute('src') || '', alt: img?.getAttribute('alt') ?? '' };
  });
  return { tiles, photos };
}

function photo(p: { src: string; alt: string }): HTMLImageElement {
  return h('img', { class: 'd-viewer__photo', attrs: { src: p.src, alt: p.alt, decoding: 'async' } });
}

/** The photographs on either side, read ahead so PREVIOUS and NEXT show theirs at once. */
function readAhead(v: Shown): void {
  const n = v.photos.length;
  for (const k of [v.at - 1, v.at + 1]) {
    const p = v.photos[((k % n) + n) % n];
    if (p && p.src) new Image().src = p.src;
  }
}

function openViewer(gallery: HTMLElement, tile: HTMLElement): void {
  if (shown) return;
  const { tiles, photos } = photosOf(gallery);
  const at = Math.max(0, tiles.indexOf(tile));
  const first = photos[at];
  if (!first) return;
  const many = photos.length > 1;
  const stage = h('div', { class: 'd-viewer__stage' }, photo(first));
  const position = h('p', { class: 'n-num d-viewer__position', attrs: { 'aria-live': 'polite' }, text: DESKTOP.viewer.position(at + 1, photos.length) });
  const previous = h('button', { class: 'n-g d-viewer__nav d-viewer__previous', attrs: { type: 'button' }, on: { click: () => step(-1) } }, icon('back', { small: true }), h('span', { text: DESKTOP.viewer.previous }));
  const next = h('button', { class: 'n-g d-viewer__nav d-viewer__next', attrs: { type: 'button' }, on: { click: () => step(1) } }, h('span', { text: DESKTOP.viewer.next }), icon('chev', { small: true }));
  const close = h('button', { class: 'n-g d-viewer__close', attrs: { type: 'button' }, on: { click: () => closeViewer(true) } }, h('span', { text: DESKTOP.viewer.close }), icon('close', { small: true }));
  const buttons = many ? [previous, next, close] : [close];
  const root = h(
    'div',
    {
      class: 'd-viewer',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': gallery.getAttribute('aria-label') ?? '' },
      on: {
        // A click on the ground closes; on the photograph, or a control, it does nothing more.
        click: (ev: Event) => {
          const t = ev.target as HTMLElement;
          if (t === root || t === stage) closeViewer(true);
        },
      },
    },
    stage,
    ...(many ? [previous, next] : []),
    close,
    ...(many ? [position] : []),
  );
  shown = { root, stage, photos, at, position, opener: tile.querySelector<HTMLElement>(`.${OPEN}`), buttons };
  document.documentElement.classList.add('d-viewer-open');
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  readAhead(shown);
  close.focus({ preventScroll: true });
  if (prefersReducedMotion()) root.classList.add('is-open');
  else requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
}

function step(by: number): void {
  const v = shown;
  if (!v || v.photos.length < 2) return;
  const n = v.photos.length;
  v.at = (((v.at + by) % n) + n) % n;
  const next = photo(v.photos[v.at]!);
  const old = [...v.stage.querySelectorAll<HTMLElement>('.d-viewer__photo')];
  v.position.textContent = DESKTOP.viewer.position(v.at + 1, n);
  if (prefersReducedMotion()) {
    v.stage.replaceChildren(next);
  } else {
    // The new photograph over the old one, from transparent; the old one goes once it is covered.
    next.classList.add('is-entering');
    v.stage.append(next);
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.remove('is-entering')));
    window.setTimeout(() => {
      for (const o of old) o.remove();
    }, FADE_MS);
  }
  readAhead(v);
}

function onKey(ev: KeyboardEvent): void {
  const v = shown;
  if (!v) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    closeViewer(true);
  } else if (ev.key === 'ArrowLeft') {
    ev.preventDefault();
    step(-1);
  } else if (ev.key === 'ArrowRight') {
    ev.preventDefault();
    step(1);
  } else if (ev.key === 'Tab') {
    // The focus cycles among the viewer's controls (from wherever a click left it).
    const list = v.buttons;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = ev.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1;
    ev.preventDefault();
    list[to]?.focus();
  }
}

/** Closes the viewer (fading, unless at once), its tile's button focused again when `back`. */
function closeViewer(back: boolean): void {
  const v = shown;
  if (!v) return;
  shown = null;
  document.removeEventListener('keydown', onKey, true);
  document.documentElement.classList.remove('d-viewer-open');
  v.root.classList.remove('is-open');
  const done = () => v.root.remove();
  if (prefersReducedMotion() || !back) done();
  else window.setTimeout(done, FADE_MS);
  if (back && v.opener?.isConnected) v.opener.focus({ preventScroll: true });
}
