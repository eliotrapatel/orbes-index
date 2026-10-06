/**
 * Problem screens of the scan (plan NOCTURNE, screen 2; C17): camera declined, no code found, connection lost… ORBES
 * centred at the top (no rail, no SCAN ring), then the empty ring, the title, one calm sentence and at most two
 * actions: the first an ivory button, the second a text link under it.
 */
import { h } from '../../shared/dom.js';
import { ACTION_LABELS, type ProblemAction, type ProblemCopy } from '../copy.js';
import { viewRoot } from './common.js';
import { button, textLink, toneMark } from './nocturne.js';
import { cameraHeader } from './scanning.js';

export function messageView(copy: ProblemCopy, onAction: (a: ProblemAction) => void, opts: { available?: (a: ProblemAction) => boolean } = {}): HTMLElement {
  const ok = opts.available ?? (() => true);
  const root = viewRoot('message', 'message-title');
  root.classList.add('n-message');
  const secondary = copy.secondary && ok(copy.secondary) ? copy.secondary : undefined;
  root.append(
    cameraHeader(),
    h(
      'section',
      { class: 'n-px n-ctr n-message__body', attrs: { 'aria-live': 'polite' } },
      toneMark('void'),
      h('h1', { class: 'n-g n-t2 n-message__title', id: 'message-title', text: copy.title }),
      h('p', { class: 'n-tx n-message__text', text: copy.message }),
      h(
        'div',
        { class: 'n-message__actions' },
        button(ACTION_LABELS[copy.primary], { onClick: () => onAction(copy.primary) }),
        secondary ? h('p', { class: 'n-message__second' }, textLink(ACTION_LABELS[secondary], { onOpen: () => onAction(secondary) })) : null,
      ),
    ),
  );
  return root;
}
