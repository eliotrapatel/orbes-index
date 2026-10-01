/**
 * Landing: the wordmark, AUTHENTICATION, one hairline button and a discreet
 * photo-upload link. The orbit reticle rests, very faint, behind the
 * wordmark; it becomes the live reticle once scanning starts.
 */
import { h } from '../../shared/dom.js';
import { orbitReticle, viewRoot } from './common.js';

export interface LandingHandlers {
  onScan(): void;
  onUpload(): void;
}

export function landingView(handlers: LandingHandlers): HTMLElement {
  const root = viewRoot('landing', 'landing-title');
  root.append(
    h(
      'div',
      { class: 'landing__center' },
      h(
        'div',
        { class: 'landing__emblem' },
        h('div', { class: 'landing__orbit', attrs: { 'aria-hidden': 'true' } }, orbitReticle('reticle--rest')),
        h(
          'h1',
          { class: 'landing__title', id: 'landing-title' },
          h('span', { class: 'wordmark landing__wordmark', text: 'ORBES' }),
          h('span', { class: 'landing__sub micro indent-label', text: 'AUTHENTICATION' }),
        ),
      ),
      h(
        'div',
        { class: 'landing__actions' },
        h('button', { class: 'btn landing__scan', attrs: { type: 'button' }, data: { autofocus: '' }, on: { click: () => handlers.onScan() }, text: 'SCAN ORBES CODE' }),
        h('button', { class: 'textlink landing__upload', attrs: { type: 'button' }, on: { click: () => handlers.onUpload() }, text: 'UPLOAD A PHOTO' }),
      ),
    ),
    h(
      'footer',
      { class: 'landing__meta nano' },
      h('span', { text: '© ORBES' }),
      h('span', { text: 'GENOME CODE' }),
      h('span', { text: 'PARIS' }),
    ),
  );
  return root;
}
