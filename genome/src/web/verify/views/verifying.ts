/**
 * Verifying (the photo path, and VERIFY AGAIN or VIEW AS OWNER): the scanner's orbit taken up (P-D10; C12), at its
 * size and in its place, its ring and moons at the weight the lock leaves them, the arc travelling while the photo is
 * read and the server answers; READING PHOTO… or VERIFYING…, one status line where the scanner's stands. ORBES at the
 * top, as on the scanner; no rail, no SCAN ring. No transition is played between the screens.
 */
import { h } from '../../shared/dom.js';
import { STATUS } from '../copy.js';
import { viewRoot } from './common.js';
import { cameraHeader, cameraOrbit } from './scanning.js';

export interface VerifyingView {
  root: HTMLElement;
  setStatus(text: string): void;
}

export function verifyingView(initial: string = STATUS.verifying): VerifyingView {
  const root = viewRoot('verifying', 'verifying-title');
  root.classList.add('n-cam', 'n-cam--still', 'is-ready', 'is-locked', 'is-verifying');
  const status = h('p', { class: 'n-g n-t3 n-ivc n-cam__line', id: 'verifying-title', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text: initial });
  root.append(cameraOrbit().orbit, cameraHeader(), h('div', { class: 'n-ctr n-cam__status' }, status));
  return {
    root,
    setStatus: (text) => {
      if (status.textContent !== text) status.textContent = text;
    },
  };
}
