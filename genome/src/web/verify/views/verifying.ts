/**
 * Verifying (the photo path, and VERIFY AGAIN or VIEW AS OWNER): the scanner's
 * ring taken up (P-D10), the same orbit reticle and its four moons at the
 * weight the lock leaves them, its arc travelling while the photo is read and
 * the server answers. No transition is played between the screens: the ring
 * simply stands at the scanner's size, in its centre.
 */
import { h } from '../../shared/dom.js';
import { STATUS } from '../copy.js';
import { orbitReticle, viewRoot } from './common.js';

export interface VerifyingView {
  root: HTMLElement;
  setStatus(text: string): void;
}

export function verifyingView(initial: string = STATUS.verifying): VerifyingView {
  const root = viewRoot('verifying', 'verifying-title');
  const status = h('p', { class: 'verifying__status micro indent-micro', id: 'verifying-title', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text: initial });
  root.append(h('div', { class: 'verifying__orbit', attrs: { 'aria-hidden': 'true' } }, orbitReticle('reticle--verifying')), status);
  return {
    root,
    setStatus: (text) => {
      if (status.textContent !== text) status.textContent = text;
    },
  };
}
