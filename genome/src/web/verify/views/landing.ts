/**
 * Landing: the monogram over the wordmark, AUTHENTICATION, one hairline
 * button and a discreet photo-upload link. The orbit reticle rests, very
 * faint, behind them; it becomes the live reticle once scanning starts. The
 * heading reads ORBES AUTHENTICATION, from its typed words: the monogram
 * beside them is decorative (shared/monogram.ts).
 *
 * Under UPLOAD A PHOTO, MY PIECES (F-01), a second discreet link, once the
 * session is known (`session.ensure()`): signed in, it opens the owner's
 * pieces; signed out, the same page signs in first, so an owner whose piece
 * is lost or stolen reaches it without scanning it. Its place is kept while
 * the session is asked for, so nothing moves when it appears; it stays
 * hidden if the account service cannot be reached.
 *
 * At the foot (J-06), under the centre and in the page's flow, so a short
 * screen scrolls to them rather than covering the actions: the legal pages,
 * PRIVACY · TERMS · LEGAL · HELP, and DB-IP's attribution, then the
 * decorative line © ORBES · GENOME CODE · PARIS.
 */
import { h } from '../../shared/dom.js';
import { monogramSvg } from '../../shared/monogram.js';
import type { SessionStore } from '../session.js';
import { legalLinks, orbitReticle, piecesLink, viewRoot } from './common.js';

export interface LandingHandlers {
  onScan(): void;
  onUpload(): void;
  /** Asked once for the session, before MY PIECES shows. */
  session?: Pick<SessionStore, 'ensure'>;
  onPieces?(): void;
}

export function landingView(handlers: LandingHandlers): HTMLElement {
  const root = viewRoot('landing', 'landing-title');
  const pieces = handlers.session ? piecesLink(handlers.onPieces, 'landing__pieces') : null;
  if (pieces && handlers.session) {
    // Kept out of sight and out of the tab order until the session is known.
    pieces.classList.add('is-pending');
    pieces.setAttribute('aria-hidden', 'true');
    pieces.tabIndex = -1;
    handlers.session.ensure().then(
      () => {
        pieces.classList.remove('is-pending');
        pieces.removeAttribute('aria-hidden');
        pieces.removeAttribute('tabindex');
      },
      () => {
        // Offline: no way to the account from here; the link stays hidden.
      },
    );
  }
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
          monogramSvg({ class: 'landing__monogram', decorative: true }),
          h('span', { class: 'wordmark landing__wordmark', text: 'ORBES' }),
          h('span', { class: 'landing__sub micro indent-label', text: 'AUTHENTICATION' }),
        ),
      ),
      h(
        'div',
        { class: 'landing__actions' },
        h('button', { class: 'btn landing__scan', attrs: { type: 'button' }, data: { autofocus: '' }, on: { click: () => handlers.onScan() }, text: 'SCAN ORBES CODE' }),
        h('button', { class: 'textlink landing__upload', attrs: { type: 'button' }, on: { click: () => handlers.onUpload() }, text: 'UPLOAD A PHOTO' }),
        pieces,
      ),
    ),
    h(
      'footer',
      { class: 'landing__foot' },
      legalLinks({ extraClass: 'landing__legal' }),
      h('div', { class: 'landing__meta nano' }, h('span', { text: '© ORBES' }), h('span', { text: 'GENOME CODE' }), h('span', { text: 'PARIS' })),
    ),
  );
  return root;
}
