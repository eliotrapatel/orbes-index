/**
 * The photographs of an authentic piece (F-04), on an ivory plate above the
 * GENOME: the piece's own (taken by ORBES at issuance), then its model's
 * reference photograph, each in a square frame with its caption, and one
 * sentence asking the customer to compare them with the piece in hand.
 *
 *   ┌                      ┐
 *     [ photo ]  [ photo ]       object-fit: contain, never cropped
 *     THIS PIECE  THE MODEL
 *   └                      ┘
 *   Photographed by ORBES. Compare them with the piece in your hands.
 *
 * Every image has its alternative text (view-model.ts). A photograph that
 * cannot be loaded (removed meanwhile) takes its frame with it, and the
 * plate goes when none is left: never a broken image. Shared with the
 * owner's list of pieces.
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { PHOTOS } from '../copy.js';
import type { PhotoModel } from '../view-model.js';

export function photoPlate(photos: readonly PhotoModel[], extraClass?: string): HTMLElement | null {
  if (photos.length === 0) return null;
  const note = h('p', { class: 'photos__note', text: PHOTOS.note(photos.length) });
  const figures = photos.map((p) => {
    const img = h('img', { class: 'photo__img', attrs: { src: p.src, alt: p.alt, decoding: 'async' } });
    return h('figure', { class: 'photo', data: { kind: p.kind } }, img, h('figcaption', { class: 'photo__caption', text: p.caption }));
  });
  const grid = bracket(h('div', { class: ['photos__plate', `photos__plate--${figures.length > 1 ? 'pair' : 'single'}`] }, ...figures));
  const plate = h('section', { class: ['result__photos', extraClass], attrs: { 'aria-label': PHOTOS.label } }, grid, note);
  for (const figure of figures) {
    figure.querySelector('img')?.addEventListener(
      'error',
      () => {
        figure.hidden = true;
        const shown = figures.filter((f) => !f.hidden).length;
        if (shown === 0) plate.hidden = true;
        else {
          grid.classList.replace('photos__plate--pair', 'photos__plate--single');
          note.textContent = PHOTOS.note(shown);
        }
      },
      { once: true },
    );
  }
  return plate;
}
