/**
 * SHARE TO STORIES (plan NEXT-NINE of 2026-10-06, §3.8 BP-10): the button and the story card's preview.
 *
 * The button is full column width and a hairline button, never filled (NOCTURNE's `n-btn--ol`; on the ivory CONFIRMED
 * screen the house's full-width `btn`). It shows only once its card is ready (story-card.ts: drawn before any tap), with
 * a 0.4 s rise (a fade under reduced motion); a card that cannot be made (no photograph, no face) leaves no button.
 *
 *   ×                                      CLOSE, on the right of the header row (and Escape)
 *   ┌───────────┐
 *   │           │                          the card, 9:16, as an image of its blob: URL, with a hairline; its
 *   │   card    │                          alternative text its words joined by '. '
 *   │           │
 *   └───────────┘
 *   [          SHARE          ]            filled ivory: the phone's share sheet, the file alone
 *   [       SAVE IMAGE        ]            hairline: the file saved (IMAGE SAVED for 3 s)
 *
 * A full-screen NOCTURNE modal (role=dialog, aria-modal, named 'Your story card'): the page under it inert, the focus on
 * CLOSE, then back on the button that opened it. Where the browser cannot share a file, SHARE is not shown, SAVE IMAGE
 * is the filled button and one ash line says so. A share sheet closed leaves the preview as it is; a share refused saves
 * the file. The object URL is revoked on close. Nothing is sent to ORBES.
 */
import { h } from '../../shared/dom.js';
import { saveDownload } from '../../shared/download.js';
import { STORY } from '../copy.js';
import type { ShareNavigator } from '../share-image.js';
import { canShareStory, shareStoryCard, storyWords, type PreparedStory, type StoryCardModel } from '../story-card.js';
import { button, icon } from './nocturne.js';

/** How long SAVE IMAGE reads IMAGE SAVED. */
export const STORY_SAVED_MS = 3_000;

/**
 * SHARE TO STORIES for `card`: hidden until its PNG is ready (at once when it already is), then rising into place; never
 * shown when there is none. `house`: the house's full-width hairline `btn` (the ivory CONFIRMED screen).
 */
export function storyButton(card: PreparedStory, m: StoryCardModel, opts: { house?: boolean } = {}): HTMLButtonElement {
  const open = (ev: MouseEvent): void => {
    if (card.blob) openStoryPreview(card.blob, m, ev.currentTarget as HTMLElement);
  };
  const attrs = { type: 'button', 'aria-haspopup': 'dialog', hidden: true };
  const b = opts.house
    ? h('button', { class: ['btn', 'btn--block', 'n-story__open'], attrs, on: { click: open }, text: STORY.button })
    : button(STORY.button, { outline: true, onClick: open, extraClass: 'n-story__open', attrs });
  if (card.blob) b.hidden = false;
  else if (card.blob === undefined) {
    void card.ready.then((blob) => {
      if (!blob) return;
      b.classList.add('is-rising');
      b.hidden = false;
    });
  }
  return b;
}

let current: StoryPreview | null = null;

/** Close the preview, if one is open (another screen shown). */
export function closeStoryPreview(): void {
  current?.close();
}

/** Open the preview of a ready card; `trigger` gets the focus back when it closes. */
export function openStoryPreview(blob: Blob, m: StoryCardModel, trigger: HTMLElement | null, nav: ShareNavigator = navigator): void {
  current?.close();
  current = new StoryPreview(blob, m, trigger, nav);
}

class StoryPreview {
  readonly el: HTMLElement;
  private readonly url: string;
  private readonly inerted: HTMLElement[] = [];
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  /** IMAGE SAVED, said to a screen reader (visually hidden). */
  private readonly status = h('p', { class: 'visually-hidden n-story__status', attrs: { role: 'status' } });
  private closed = false;

  constructor(
    private readonly blob: Blob,
    m: StoryCardModel,
    private readonly trigger: HTMLElement | null,
    private readonly nav: ShareNavigator,
  ) {
    this.url = URL.createObjectURL(blob);
    const close = h('button', { class: 'n-account__close n-story__close', attrs: { type: 'button', 'aria-label': STORY.close }, on: { click: () => this.close() } }, icon('close'));
    const canShare = canShareStory(blob, nav);
    const save = button(STORY.save, { outline: canShare, extraClass: 'n-story__save', onClick: () => this.save(save) });
    const share = canShare ? button(STORY.share, { extraClass: 'n-story__share', onClick: () => this.share(save) }) : null;
    this.el = h(
      'div',
      { class: 'n-story', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': STORY.label } },
      h('div', { class: 'n-story__head' }, close),
      h('img', { class: 'n-story__card', attrs: { src: this.url, alt: STORY.alt(...storyWords(m)), width: 1080, height: 1920, decoding: 'async' } }),
      h('div', { class: 'n-story__actions' }, share, save),
      canShare ? null : h('p', { class: 'n-sm n-story__note', text: STORY.cannotShare }),
      this.status,
    );
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.close();
      }
    });
    for (const child of [...document.body.children]) {
      if (child instanceof HTMLElement && !child.inert) {
        child.inert = true;
        this.inerted.push(child);
      }
    }
    document.body.append(this.el);
    document.documentElement.classList.add('n-locked');
    close.focus({ preventScroll: true });
  }

  /** SHARE: the share sheet within the tap; a share the browser refused saved the file instead. */
  private share(save: HTMLButtonElement): void {
    void shareStoryCard(this.blob, this.nav).then((r) => {
      if (r === 'saved') this.saved(save);
    });
  }

  private save(save: HTMLButtonElement): void {
    saveDownload({ blob: this.blob, filename: STORY.filename });
    this.saved(save);
  }

  /** SAVE IMAGE reads IMAGE SAVED for 3 s, said by the status line too (a focused button's new words are not always read). */
  private saved(save: HTMLButtonElement): void {
    if (this.closed) return;
    save.textContent = STORY.saved;
    this.status.textContent = STORY.saved;
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => {
      save.textContent = STORY.save;
      this.status.textContent = '';
      this.savedTimer = null;
    }, STORY_SAVED_MS);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.el.remove();
    for (const el of this.inerted) el.inert = false;
    document.documentElement.classList.remove('n-locked');
    URL.revokeObjectURL(this.url);
    if (current === this) current = null;
    if (this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
  }
}
