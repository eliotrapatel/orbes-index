/**
 * The frame of the pages an email opens (lot M1, step M1.19): SET A NEW PASSWORD (/verify/reset, views/reset.ts) and
 * STOP THESE EMAILS (/verify/unsubscribe, views/unsubscribe.ts). In NOCTURNE's chrome, as every page of the app.
 *
 *   phone                                  a computer (the sign-in page's frame, views/desktop-signin.ts)
 *   SET A NEW PASSWORD                     ┌── the newest model's photograph ─────────────┬──── 440 ─┐
 *   For the ORBES account you@….           │                                               │ the panel │
 *   the panel: a form, a sentence, …       │ SET A NEW PASSWORD                             │           │
 *                                          │ For the ORBES account you@….                   │           │
 *                                          └───────────────────────────────────────────────┴───────────┘
 *
 * The title and its line (`head`) and what the panel holds (`body`) change with the page's state; the panel's top is set
 * once, where the first state's panel stands in the middle of the window, so it never moves as the page changes (as the
 * sign-in page's). A window that crosses the desktop's width draws the frame of the other again with the same elements.
 */
import { h } from '../../shared/dom.js';
import { isDesktop, onDesktopChange } from '../../shared/desktop.js';
import type { ApiClient } from '../api.js';
import { PHOTOS } from '../copy.js';
import { viewRoot } from './common.js';
import { newest } from './desktop-signin.js';

export interface MailFrame {
  root: HTMLElement;
  /** The page's title and the line under it (none: no line). */
  head(title: string, lead: string | null): void;
  /** What the panel holds now. */
  body(...children: (HTMLElement | null)[]): void;
  /** The title, for the focus. */
  readonly title: HTMLElement;
  dispose(): void;
}

export function mailFrame(api: Pick<ApiClient, 'lookbook'>, name: 'reset' | 'unsubscribe'): MailFrame {
  const id = `${name}-title`;
  const root = viewRoot(name, id);
  root.classList.add('n-mail');
  const title = h('h1', { id, attrs: { tabindex: -1 } });
  const lead = h('p', {});
  const content = h('div', { class: 'n-mail__content' });
  let disposed = false;

  // A computer's frame: the photograph, its words, the panel.
  const img = h('img', { class: 'd-signin__img', attrs: { alt: '', decoding: 'async', loading: 'eager' } });
  const photo = h('div', { class: 'd-frame-photo d-signin__photo' }, img);
  const box = h('div', { class: 'd-signin__panel n-mail__panel' });
  const over = h('div', { class: 'd-signin__over', attrs: { 'aria-hidden': 'true' } });
  const words = h('div', { class: 'd-signin__words d-on-photo' });
  const frame = h('section', { class: 'd-signin n-mail__frame' }, over, photo, words, box);
  let photoRead = false;
  const readPhoto = () => {
    if (photoRead) return;
    photoRead = true;
    void api
      .lookbook()
      .then((cards) => {
        if (disposed) return;
        const c = newest(cards);
        if (!c?.imageUrl) {
          photo.classList.add('is-bare');
          return;
        }
        img.alt = PHOTOS.modelAlt(c.name.toUpperCase(), c.type.toUpperCase(), c.variant?.label ?? null);
        img.src = c.imageUrl;
      })
      .catch(() => photo.classList.add('is-bare'));
  };
  // The words' height (the light photograph ends 24 px above them, shared/desktop-account.css).
  const wordsSeen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
    if (words.offsetHeight > 0) frame.style.setProperty('--d-signin-words-h', `${Math.round(words.offsetHeight)}px`);
  });
  wordsSeen?.observe(words);
  // The panel's top: the first state's panel in the middle of the window under the bar, set once (and again when the
  // window's height changes); the panel shows only then (`is-placed`).
  let reference: number | null = null;
  const place = () => {
    if (disposed || !root.isConnected || !isDesktop()) return;
    if (reference === null) {
      if (box.offsetHeight === 0 || content.childElementCount === 0) return;
      reference = box.offsetHeight;
    }
    const room = Math.max(window.innerHeight, 640) - 84;
    frame.style.setProperty('--d-signin-top', `${Math.max(72, Math.round((room - reference) / 2))}px`);
    box.classList.add('is-placed');
  };
  const boxSeen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
  boxSeen?.observe(box);
  window.addEventListener('resize', place);

  const arrange = (desktop: boolean) => {
    if (desktop) {
      title.className = 'n-g d-signin__title';
      lead.className = 'n-lead d-signin__lead';
      words.replaceChildren(title, lead);
      box.replaceChildren(content);
      root.replaceChildren(frame);
      root.classList.add('n-mail--desk');
      readPhoto();
    } else {
      title.className = 'n-g n-t1 n-mail__title';
      lead.className = 'n-tx n-mail__lead';
      root.replaceChildren(h('div', { class: 'n-px n-mail__head' }, title, lead), h('div', { class: 'n-px n-mail__body' }, content));
      root.classList.remove('n-mail--desk');
    }
  };
  arrange(isDesktop());
  const stop = onDesktopChange((desktop) => {
    arrange(desktop);
    requestAnimationFrame(place);
  });

  return {
    root,
    title,
    head(t, l) {
      title.textContent = t;
      lead.textContent = l ?? '';
      lead.hidden = !l;
    },
    body(...children) {
      content.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
      requestAnimationFrame(place);
    },
    dispose() {
      disposed = true;
      stop();
      wordsSeen?.disconnect();
      boxSeen?.disconnect();
      window.removeEventListener('resize', place);
    },
  };
}
