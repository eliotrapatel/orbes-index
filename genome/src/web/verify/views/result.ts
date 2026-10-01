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
 * Everything shown comes from the server outcome through resultViewModel().
 */
import { bracket } from '../../shared/corners.js';
import { h } from '../../shared/dom.js';
import { CLIENT_SERVICES } from '../copy.js';
import { genomeBlock } from '../genome-view.js';
import type { ResultViewModel, TabId } from '../view-model.js';
import { rows, sectionLabel, toneMark, viewRoot } from './common.js';
import { OwnershipPanel, type OwnershipDeps } from './ownership.js';
import { tabsView } from './tabs.js';

export interface ResultHandlers {
  onScanAgain(): void;
  ownership: Omit<OwnershipDeps, 'onRescan'>;
}

export interface ResultView {
  root: HTMLElement;
  dispose(): void;
}

export function resultView(vm: ResultViewModel, handlers: ResultHandlers): ResultView {
  const root = viewRoot('result', 'result-title');
  root.dataset.state = vm.state;
  root.dataset.tone = vm.tone;
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
          return h(
            'div',
            { class: 'panel' },
            rows(vm.productRows),
            vm.verificationRows.length > 0 ? sectionLabel('VERIFICATION') : null,
            vm.verificationRows.length > 0 ? rows(vm.verificationRows) : null,
            vm.assuranceNote ? h('p', { class: 'prose panel__note', text: vm.assuranceNote }) : null,
          );
        case 'warranty':
          return vm.warranty
            ? h('div', { class: 'panel' }, rows(vm.warranty.rows), h('p', { class: 'prose panel__note', text: vm.warranty.note }))
            : h('div', { class: 'panel' }, h('p', { class: 'prose', text: `Warranty details for this piece are available from ${titleCase(CLIENT_SERVICES)}.` }));
        case 'care':
          return h('div', { class: 'panel' }, h('p', { class: 'prose panel__care', text: vm.care }));
        case 'ownership':
          ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain });
          return h('div', { class: 'panel' }, ownership.root);
      }
    };
    sections.push(tabsView(vm.tabs, build, vm.ownership.kind === 'register' ? 'ownership' : 'product').root);
  } else if (vm.tone !== 'authentic') {
    sections.push(
      h(
        'section',
        { class: 'result__help' },
        h('p', { class: 'prose', text: `${titleCase(CLIENT_SERVICES)} can help with any question about this piece. Please quote the reference below.` }),
      ),
    );
  }

  const foot = h(
    'footer',
    { class: 'result__foot' },
    h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => handlers.onScanAgain() }, text: vm.tone === 'authentic' ? 'SCAN ANOTHER' : 'SCAN AGAIN' }),
    vm.footnote ? h('p', { class: 'result__footnote', text: vm.footnote }) : null,
    h(
      'p',
      { class: 'result__meta nano soft' },
      vm.verifiedAt ? h('span', { text: `VERIFIED ${vm.verifiedAt}` }) : null,
      vm.reference ? h('span', { text: `REF ${vm.reference}` }) : null,
    ),
  );

  root.append(head, ...sections.filter((x): x is HTMLElement => x !== null), foot);
  return { root, dispose: () => (ownership as OwnershipPanel | null)?.dispose() };
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w === 'orbes' ? 'ORBES' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
