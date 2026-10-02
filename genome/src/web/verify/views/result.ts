/**
 * Result: the state, then the GENOME, the product lines and the four tabs.
 *
 *          ◯                    tone mark (seal / moon / empty orbit)
 *      A U T H E N T I C        state title, tracked
 *      FIRST REGISTRATION       sub-title when the server title has one
 *   one sentence from the server
 *   ┌                      ┐
 *     GENOME  O26-J-00184
 *     ◔ · ◯ · ◕ · …            core renderGenomeSvg row
 *     G1-E1DC-BE52 · GENOME-01
 *   └                      ┘
 *   MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026
 *   PRODUCT · WARRANTY · CARE · OWNERSHIP
 *
 * Other results show no product lines and no tabs, only a line for ORBES
 * Client Services and, when it is configured, CONTACT ORBES CLIENT SERVICES
 * (an email prefilled with the reference and the result), its phone and
 * hours; UNUSUAL ACTIVITY adds, when the server offers it, the section DO
 * YOU HOLD THE CERTIFICATE CARD? (registration with the claim code); then
 * WHERE DID YOU SEE OR BUY THIS PIECE?, an optional answer attached to the
 * scan. A warranty that no longer applies offers the same contact in its
 * tab, and FORGOTTEN PASSWORD? in the OWNERSHIP panel offers it to a
 * customer who needs a recovery code (C-04).
 *
 * Everything shown comes from the server outcome through resultViewModel().
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { genomeBlock } from '../genome-view.js';
import type { ResultViewModel, TabId } from '../view-model.js';
import { contactBlock, toneMark, viewRoot } from './common.js';
import { OwnershipPanel, type OwnershipDeps } from './ownership.js';
import { carePanel, productPanel, warrantyPanel } from './panels.js';
import { reportSection, type ReportDeps } from './report.js';
import { tabsView } from './tabs.js';

export interface ResultHandlers {
  onScanAgain(): void;
  /** Verify the same code again (after an ownership change). */
  onRefresh?(): void;
  ownership: Omit<OwnershipDeps, 'onRescan'>;
  /** Sends the answer to WHERE DID YOU SEE OR BUY THIS PIECE? (results that were not authentic). */
  report?: ReportDeps;
}

export interface ResultView {
  root: HTMLElement;
  dispose(): void;
}

export function resultView(vm: ResultViewModel, handlers: ResultHandlers): ResultView {
  const root = viewRoot('result', 'result-title');
  root.dataset.state = vm.state;
  root.dataset.tone = vm.tone;
  // Short results (no genome, no tabs) sit in the optical centre instead of hanging from the top.
  if (!vm.genome && vm.tabs.length === 0) root.classList.add('is-compact');
  let ownership: OwnershipPanel | null = null;

  const head = h(
    'header',
    { class: 'result__head' },
    h('span', { class: 'wordmark wordmark--small result__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
    h('div', { class: 'result__mark' }, toneMark(vm.tone)),
    h(
      'h1',
      { class: 'result__title', id: 'result-title' },
      h('span', { class: 'result__title-main', text: vm.titleMain }),
      vm.titleSub ? h('span', { class: 'result__title-sub micro indent-micro', text: vm.titleSub }) : null,
    ),
    vm.message ? h('p', { class: 'result__message prose', text: vm.message }) : null,
    vm.notice ? h('p', { class: 'result__notice', attrs: { role: 'note' }, text: vm.notice }) : null,
  );

  const sections: (HTMLElement | null)[] = [];
  if (vm.genome) sections.push(bracket(h('div', { class: 'result__genome' }, genomeBlock(vm.genome))));
  if (vm.productLines.length > 0) {
    sections.push(
      h(
        'section',
        { class: 'result__lines', attrs: { 'aria-label': 'Product' } },
        h('ul', { class: 'lines' }, ...vm.productLines.map((line) => h('li', { class: 'lines__line', text: line }))),
      ),
    );
  }

  if (vm.tabs.length > 0) {
    const build = (id: TabId): HTMLElement => {
      switch (id) {
        case 'product':
          return productPanel(vm);
        case 'warranty':
          return warrantyPanel(vm);
        case 'care':
          return carePanel(vm);
        case 'ownership':
          ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });
          return h('div', { class: 'panel' }, ownership.root);
      }
    };
    sections.push(tabsView(vm.tabs, build, vm.ownership.kind === 'register' ? 'ownership' : 'product').root);
  } else if (vm.tone !== 'authentic') {
    // The help line, then (when Client Services is configured) the prefilled email, the phone and the hours.
    sections.push(
      h(
        'section',
        { class: 'result__help' },
        h('p', { class: 'prose', text: 'ORBES Client Services can help with any question about this piece. Please quote the reference below.' }),
        vm.contact?.placement === 'help' ? contactBlock(vm.contact) : null,
      ),
    );
    // UNUSUAL ACTIVITY with a registration token (the server's step 10 exception): the buyer holding
    // the certificate card may still register, with its claim code. Sign-in, then the claim code; no product data.
    if (vm.ownership.kind === 'register') {
      ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });
      sections.push(
        h(
          'section',
          { class: 'result__card', attrs: { 'aria-labelledby': 'card-title' } },
          h('h2', { class: 'result__card-title', id: 'card-title', text: 'DO YOU HOLD THE CERTIFICATE CARD?' }),
          h('p', {
            class: 'prose result__card-text',
            text: 'If this piece was delivered to you with its ORBES certificate card, you may register it in your name with the claim code printed under the scratch-off panel.',
          }),
          ownership.root,
        ),
      );
    }
    // Under the contact (and under the certificate-card section when there is one, which follows the help
    // line): where the piece was seen or bought, attached to this scan. Optional.
    if (vm.report && handlers.report) sections.push(reportSection(vm.report, handlers.report));
  }

  const foot = h(
    'footer',
    { class: 'result__foot' },
    h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => handlers.onScanAgain() }, text: vm.tone === 'authentic' ? 'SCAN ANOTHER' : 'SCAN AGAIN' }),
    vm.footnote ? h('p', { class: 'result__footnote', text: vm.footnote }) : null,
    h(
      'p',
      { class: 'result__meta' },
      vm.verifiedAt ? h('span', { text: `VERIFIED ${vm.verifiedAt}` }) : null,
      vm.reference ? h('span', { text: `REF ${vm.reference}` }) : null,
    ),
  );

  root.append(head, ...sections.filter((x): x is HTMLElement => x !== null), foot);
  return { root, dispose: () => (ownership as OwnershipPanel | null)?.dispose() };
}
