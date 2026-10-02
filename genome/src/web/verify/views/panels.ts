/**
 * The PRODUCT, WARRANTY and CARE tab panels (OWNERSHIP lives in
 * ownership.ts: it is interactive). Pure presentation of the view-model.
 */
import { h } from '../../shared/dom.js';
import type { ResultViewModel } from '../view-model.js';
import { contactBlock, rows, sectionLabel } from './common.js';

/** Product facts, then what the verification established. */
export function productPanel(vm: ResultViewModel): HTMLElement {
  return h(
    'div',
    { class: 'panel' },
    rows(vm.productRows),
    vm.verificationRows.length > 0 ? sectionLabel('VERIFICATION') : null,
    vm.verificationRows.length > 0 ? rows(vm.verificationRows) : null,
    vm.assuranceNote ? h('p', { class: 'prose panel__note', text: vm.assuranceNote }) : null,
  );
}

export function warrantyPanel(vm: ResultViewModel): HTMLElement {
  if (!vm.warranty) {
    return h('div', { class: 'panel' }, h('p', { class: 'prose panel__note', text: 'Warranty details for this piece are available from ORBES Client Services.' }));
  }
  // A warranty that no longer applies sends the customer to Client Services: the contact follows the note.
  return h(
    'div',
    { class: 'panel' },
    rows(vm.warranty.rows),
    h('p', { class: 'prose panel__note', text: vm.warranty.note }),
    vm.contact?.placement === 'warranty' ? contactBlock(vm.contact) : null,
  );
}

export function carePanel(vm: ResultViewModel): HTMLElement {
  return h('div', { class: 'panel' }, h('p', { class: 'prose panel__care', text: vm.care }));
}
