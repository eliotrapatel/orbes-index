/**
 * The PRODUCT, WARRANTY and CARE tab panels of a result (OWNERSHIP lives in ownership.ts: it is interactive), in
 * NOCTURNE's pieces: the facts as label and value rows (`.kv`, C35), their sentences in ash. Pure presentation of the
 * view-model.
 */
import { h } from '../../shared/dom.js';
import { CONTACT } from '../copy.js';
import type { ResultViewModel } from '../view-model.js';
import { contactLines, definitionList } from './nocturne.js';

/** Product facts, then what the verification established. */
export function productPanel(vm: ResultViewModel): HTMLElement {
  return h(
    'div',
    { class: 'n-result__panel' },
    definitionList(vm.productRows, { kind: 'kv' }),
    vm.verificationRows.length > 0 ? h('h3', { class: 'n-g n-lb n-result__panel-label', text: 'VERIFICATION' }) : null,
    vm.verificationRows.length > 0 ? definitionList(vm.verificationRows, { kind: 'kv' }) : null,
    vm.assuranceNote ? h('p', { class: 'n-sm n-result__panel-note', text: vm.assuranceNote }) : null,
  );
}

export function warrantyPanel(vm: ResultViewModel): HTMLElement {
  if (!vm.warranty) {
    return h('div', { class: 'n-result__panel' }, h('p', { class: 'n-tx', text: 'Warranty details for this piece are available from ORBES Client Services.' }));
  }
  // A warranty that no longer applies sends the customer to Client Services: the contact follows the note.
  return h(
    'div',
    { class: 'n-result__panel' },
    definitionList(vm.warranty.rows, { kind: 'kv' }),
    h('p', { class: 'n-tx n-result__panel-note', text: vm.warranty.note }),
    vm.contact?.placement === 'warranty' ? contactLines(vm.contact, CONTACT) : null,
  );
}

export function carePanel(vm: ResultViewModel): HTMLElement {
  return h('div', { class: 'n-result__panel' }, h('p', { class: 'n-tx n-result__care', text: vm.care }));
}
