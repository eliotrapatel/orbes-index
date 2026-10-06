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
 * Under them, THE COLLECTION (P-R02), the lookbook of the models: a third
 * discreet link, shown at once (it needs no session); then THE RELEASES
 * (P-R03), the drops ORBES announces, a fourth (entering one needs an
 * account, reading them none).
 *
 * Its foot is NOCTURNE's footer (views/shell.ts, under every screen): SOUND
 * ON / OFF (P-D07), the legal pages (J-06), DB-IP's attribution and © ORBES ·
 * PARIS.
 */
import { h } from '../../shared/dom.js';
import { monogramSvg } from '../../shared/monogram.js';
import type { SessionStore } from '../session.js';
import { lookbookLink, orbitReticle, piecesLink, releasesLink, viewRoot } from './common.js';

export interface LandingHandlers {
  onScan(): void;
  onUpload(): void;
  /** Asked once for the session, before MY PIECES shows. */
  session?: Pick<SessionStore, 'ensure'>;
  onPieces?(): void;
  /** THE COLLECTION (P-R02): the lookbook, in the app. */
  onCollection?(): void;
  /** THE RELEASES (P-R03): the drops, in the app. */
  onReleases?(): void;
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
        lookbookLink(handlers.onCollection, { extraClass: 'landing__collection' }),
        releasesLink(handlers.onReleases, { extraClass: 'landing__releases' }),
      ),
    ),
  );
  return root;
}
