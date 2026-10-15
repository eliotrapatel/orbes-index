/**
 * The PRODUCT and ORBES CARE tab panels of a result (OWNERSHIP lives in ownership.ts: it is interactive), in NOCTURNE's
 * pieces: the facts as label and value rows (`.kv`, C35), their sentences in ash. Pure presentation of the view-model.
 */
import { h } from '../../shared/dom.js';
import { ORBES_CARE } from '../copy.js';
import type { ResultViewModel } from '../view-model.js';
import { definitionList } from './nocturne.js';
import { writeButton } from './write.js';

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

/**
 * ORBES CARE on a result (plan ORBES CARE §2(a), answer 6), in the order of MY PIECES' tab: WARRANTY, its rows and its
 * sentence (or the sentence of Client Services when the server sends none); CARING FOR THIS PIECE, its model's care;
 * then how to reach ORBES Client Services. No PRIVATE CARE here: it is a tier benefit of the holder's account, read for
 * the account's own piece, and a scan is public and reads no tier. A warranty that no longer applies sends the
 * customer to Client Services: WRITE TO ORBES CLIENT SERVICES follows its sentence, the scan attached, about its
 * warranty (CS-01); no other button (a scan's WRITE stays where the code allows it).
 */
export function orbesCarePanel(vm: ResultViewModel): HTMLElement {
  const w = vm.warranty;
  return h(
    'div',
    { class: 'n-result__panel n-result__orbes-care' },
    h(
      'section',
      { class: 'n-result__care-section', attrs: { 'aria-labelledby': 'result-warranty' } },
      h('h3', { class: 'n-g n-lb', id: 'result-warranty', text: ORBES_CARE.warranty.label }),
      ...(w
        ? [
            definitionList(w.rows, { kind: 'kv', extraClass: 'n-result__warranty-rows' }),
            h('p', { class: 'n-tx n-result__panel-note', text: w.note }),
            vm.write?.placement === 'warranty' ? writeButton(vm.write.context) : null,
          ]
        : [h('p', { class: 'n-tx n-result__panel-note', text: ORBES_CARE.warranty.none })]),
    ),
    h(
      'section',
      { class: 'n-result__care-guide', attrs: { 'aria-labelledby': 'result-care-guide' } },
      h('h3', { class: 'n-g n-lb', id: 'result-care-guide', text: ORBES_CARE.careLabel }),
      h('p', { class: 'n-tx n-result__care', text: vm.care }),
    ),
    h('p', { class: 'n-tx n-result__care-contact', text: ORBES_CARE.contact }),
  );
}
