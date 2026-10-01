/**
 * Problem screens (camera declined, no code found, connection lost…): the
 * empty orbit, a tracked title, one calm sentence and at most two actions.
 */
import { h } from '../../shared/dom.js';
import { ACTION_LABELS, type ProblemAction, type ProblemCopy } from '../copy.js';
import { toneMark, viewRoot } from './common.js';

export function messageView(copy: ProblemCopy, onAction: (a: ProblemAction) => void, opts: { available?: (a: ProblemAction) => boolean } = {}): HTMLElement {
  const ok = opts.available ?? (() => true);
  const root = viewRoot('message', 'message-title');
  const secondary = copy.secondary && ok(copy.secondary) ? copy.secondary : undefined;
  root.append(
    h(
      'div',
      { class: 'message__body' },
      toneMark('void'),
      h('h1', { class: 'message__title', id: 'message-title', text: copy.title }),
      h('p', { class: 'message__text prose', text: copy.message }),
      h(
        'div',
        { class: 'message__actions' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => onAction(copy.primary) }, text: ACTION_LABELS[copy.primary] }),
        secondary ? h('button', { class: 'textlink', attrs: { type: 'button' }, on: { click: () => onAction(secondary) }, text: ACTION_LABELS[secondary] }) : null,
      ),
    ),
  );
  return root;
}
