/**
 * Photographs in the console (F-04): the dialog that sets or removes a
 * model's reference photograph or the photograph of a piece, the canvas
 * that re-encodes what the operator chooses, and the thumbnails of the
 * catalogue and the product page.
 *
 * Re-encoding: the chosen file is decoded by the browser (createImageBitmap,
 * EXIF orientation applied), drawn on white at most PHOTO_MAX_SIDE pixels on
 * its longer side, and sent as a JPEG whose quality steps down until it fits
 * the server's 1 MiB (the packing photo: smaller sides in turn too, until it
 * fits the edge's 64 KB, model/logistics.ts PACKING_PHOTO_LIMITS). What is
 * sent is previewed, with its size, before it is saved. CSP-safe: the
 * preview is a blob: URL (img-src allows it), released when the dialog closes.
 */
import { h, mount, type Child } from '../../shared/dom.js';
import { ApiError } from '../api.js';
import { encodeAttempts, PHOTO_LIMITS, PHOTO_SENT_AS, photoFacts, type PhotoLimits } from '../model/photo.js';
import { button } from './components.js';
import { openDialog } from './dialog.js';

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Decode `file`, draw it at each longer side of `limits` in turn (by default PHOTO_MAX_SIDE; the packing photo's
 * 1 600 px down to 1 024 px, plan NEXT LOT §3.5.3) and encode it as a JPEG whose quality steps down at each side,
 * until it fits `limits.maxBytes`; refused with `limits.tooLarge` otherwise, before anything is sent.
 */
export async function reencodePhoto(file: Blob, limits: PhotoLimits = PHOTO_LIMITS): Promise<EncodedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ApiError(0, 'PHOTO_UNREADABLE', 'This file could not be opened as a photograph. Choose a JPEG, PNG or WebP image.');
  }
  try {
    const attempts = encodeAttempts(bitmap.width, bitmap.height, limits);
    if (attempts.length === 0) throw new ApiError(0, 'PHOTO_UNREADABLE', 'This photograph is empty.');
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    if (!g) throw new ApiError(0, 'PHOTO_UNREADABLE', 'This browser cannot prepare the photograph.');
    let drawn = '';
    for (const { width, height, quality } of attempts) {
      if (drawn !== `${width}x${height}`) {
        drawn = `${width}x${height}`;
        canvas.width = width;
        canvas.height = height;
        // A JPEG has no transparency: a cut-out piece sits on white paper.
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, width, height);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(bitmap, 0, 0, width, height);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= limits.maxBytes) return { blob, width, height };
    }
    throw new ApiError(0, 'PHOTO_TOO_LARGE', limits.tooLarge);
  } finally {
    bitmap.close();
  }
}

/** A square thumbnail of a stored photograph (catalogue, product page), or a dash. */
export function photoThumb(url: string | null, alt: string, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  if (!url) return h('span', { class: ['photo-thumb', `photo-thumb--${size}`, 'photo-thumb--empty'], attrs: { 'aria-label': 'No photograph' } }, '—');
  return h('img', { class: ['photo-thumb', `photo-thumb--${size}`], attrs: { src: url, alt, decoding: 'async', loading: 'lazy' } });
}

export interface PhotoDialogOptions {
  title: string;
  /** The model or the piece it belongs to. */
  eyebrow: string;
  /** What the photograph reaches, said first. */
  impact: string;
  /** The photograph in place, if any. */
  current: string | null;
  currentAlt: string;
  save(photo: Blob): Promise<void>;
  remove(): Promise<void>;
}

/**
 * Choose a photograph (previewed as it will be sent), or tick the box that removes the one in place. Resolves with
 * what was done, null on cancel; a refusal of the server is shown in the dialog, nothing chosen is lost.
 */
export async function photoDialog(o: PhotoDialogOptions): Promise<'saved' | 'removed' | null> {
  let chosen: Promise<EncodedPhoto> | null = null;
  let preview: string | null = null;
  const release = () => {
    if (preview) URL.revokeObjectURL(preview);
    preview = null;
  };
  const shown = h('div', { class: 'photo-dialog__shown', data: { testid: 'photo-current' } }, current(o));
  const facts = h('p', { class: 'photo-dialog__facts', attrs: { 'aria-live': 'polite' }, data: { testid: 'photo-facts' } });
  const file = h('input', { class: 'photo-dialog__file', attrs: { type: 'file', accept: 'image/*', hidden: true, 'data-testid': 'photo-file' } });
  const choose = button(o.current ? 'Choose another photograph' : 'Choose a photograph', { kind: 'ghost', testId: 'photo-choose' });
  choose.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    // A refusal said before the choice (no photograph yet) no longer applies.
    const refusal = file.closest('form')?.querySelector('.dialog__error');
    if (refusal) refusal.textContent = '';
    facts.textContent = 'Preparing…';
    const pending = reencodePhoto(f);
    chosen = pending;
    pending.then(
      (p) => {
        if (chosen !== pending) return;
        release();
        preview = URL.createObjectURL(p.blob);
        mount(shown, h('img', { class: 'photo-dialog__img', attrs: { src: preview, alt: 'The photograph as it will be sent' } }));
        facts.textContent = `To be sent: ${photoFacts(p.width, p.height, p.blob.size)}`;
      },
      (e: unknown) => {
        if (chosen !== pending) return;
        chosen = null;
        file.value = '';
        facts.textContent = e instanceof ApiError ? e.message : 'This photograph could not be prepared.';
      },
    );
  });
  let done: 'saved' | 'removed' | null = null;
  const r = await openDialog({
    title: o.title,
    eyebrow: o.eyebrow,
    body: [
      h('p', { class: 'dialog__text', data: { testid: 'photo-impact' } }, o.impact),
      h('div', { class: 'photo-dialog' }, shown, h('div', { class: 'photo-dialog__tools' }, choose, file, facts, h('p', { class: 'photo-dialog__note' }, PHOTO_SENT_AS))),
    ],
    fields: o.current ? [{ name: 'remove', label: 'Remove the current photograph', kind: 'checkbox', hint: 'It is no longer shown on /verify once saved.' }] : [],
    danger: (v) => v.remove === 'true' && !chosen,
    confirmLabel: 'Save photograph',
    submit: async (v) => {
      if (chosen) {
        const p = await chosen;
        await o.save(p.blob);
        done = 'saved';
      } else if (v.remove === 'true') {
        await o.remove();
        done = 'removed';
      } else {
        throw new ApiError(0, 'NO_PHOTO', o.current ? 'Choose a photograph, or tick the box to remove the current one.' : 'Choose a photograph first.');
      }
    },
  });
  release();
  return r ? done : null;
}

function current(o: PhotoDialogOptions): Child {
  return o.current ? h('img', { class: 'photo-dialog__img', attrs: { src: o.current, alt: o.currentAlt } }) : h('p', { class: 'photo-dialog__none' }, 'No photograph yet.');
}
