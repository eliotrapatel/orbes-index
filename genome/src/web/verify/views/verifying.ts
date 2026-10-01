/**
 * Verifying (photo path): a single moon travelling a hairline orbit while
 * the photo is read and the server answers.
 */
import { h, s } from '../../shared/dom.js';
import { STATUS } from '../copy.js';
import { viewRoot } from './common.js';

export interface VerifyingView {
  root: HTMLElement;
  setStatus(text: string): void;
}

export function verifyingView(initial: string = STATUS.verifying): VerifyingView {
  const root = viewRoot('verifying', 'verifying-title');
  const status = h('p', { class: 'verifying__status micro indent-micro', id: 'verifying-title', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, text: initial });
  root.append(
    h(
      'div',
      { class: 'verifying__orbit', attrs: { 'aria-hidden': 'true' } },
      s(
        'svg',
        { class: 'loader', viewBox: '-60 -60 120 120', focusable: 'false' },
        s('circle', { class: 'loader__ring', cx: 0, cy: 0, r: 44 }),
        s('circle', { class: 'loader__core', cx: 0, cy: 0, r: 3 }),
        s('g', { class: 'loader__moon' }, s('circle', { cx: 0, cy: -44, r: 3 })),
      ),
    ),
    status,
  );
  return {
    root,
    setStatus: (text) => {
      if (status.textContent !== text) status.textContent = text;
    },
  };
}
