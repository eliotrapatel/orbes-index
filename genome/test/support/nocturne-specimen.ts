/**
 * NOCTURNE's pieces that no screen holds yet (each step from N3 places them on its screens), built by their own view
 * code (src/web/verify/views/nocturne.ts) into a real screen of the app, under its own stylesheet: the computed-style
 * test (test/web/nocturne.styles.e2e.test.ts) bundles this file (esbuild), serves it from the stage's origin (the
 * page's CSP allows its own scripts) and reads each piece's computed style against the rulebook.
 *
 * Browser code: it renders into the column in place of the screen, each piece in a section named by data-piece.
 */
import { h } from '../../src/web/shared/dom.js';
import { TIER_DOTS } from '../../src/web/verify/tier-model.js';
import {
  accLink,
  accordionRow,
  button,
  countdown,
  definitionList,
  fadedPhoto,
  field,
  finishDot,
  lift,
  orderSteps,
  plateCard,
  sizeButtons,
  tabs,
  textLink,
  tierDots,
  variantDots,
} from '../../src/web/verify/views/nocturne.js';

/** A photograph of 1 × 1 transparent pixel: the piece's box is what is read, not the image. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const piece = (name: string, ...children: (Node | null)[]) => h('section', { class: 'n-px n-specimen', data: { piece: name } }, ...children);

function render(): void {
  const host = document.getElementById('app');
  if (!host) throw new Error('specimen: no #app');
  const input = h('input', { attrs: { type: 'email', autocomplete: 'off' } });
  host.replaceChildren(
    h(
      'main',
      { class: 'view n-specimens' },
      piece('buttons', button('SEE THE RELEASE'), button('TRY AGAIN', { outline: true }), h('p', null, textLink('THE COLLECTION', { href: '/verify/lookbook' }))),
      piece('tabs', tabs([{ id: 'pieces', label: 'PIECES', count: 2 }, { id: 'orders', label: 'ORDERS', count: 2 }, { id: 'releases', label: 'RELEASES', count: 3 }], { selected: 'pieces', label: 'My pieces', idPrefix: 'sp-tabs', onSelect: () => {} })),
      piece('tabsx', tabs([{ id: 'product', label: 'PRODUCT' }, { id: 'warranty', label: 'WARRANTY' }, { id: 'care', label: 'CARE' }, { id: 'ownership', label: 'OWNERSHIP' }], { selected: 'ownership', label: 'The piece', idPrefix: 'sp-tabsx', kind: 'tabsx', onSelect: () => {} })),
      piece('switch2', tabs([{ id: 'in', label: 'SIGN IN' }, { id: 'create', label: 'CREATE ACCOUNT' }], { selected: 'in', label: 'Your ORBES account', idPrefix: 'sp-sw2', kind: 'switch2', onSelect: () => {} })),
      piece('accordion', accordionRow('WHERE DID YOU SEE OR BUY THIS PIECE?', h('p', { class: 'n-sm', text: 'Optional.' }), { id: 'sp-acc', line: 'Optional. Your answer stays with this reference, for ORBES Client Services.' }), accLink('THE DRAW OF 14 SEPTEMBER', { line: 'SEE THE RELEASE', lineKind: 'lb', href: '/verify/releases' })),
      piece('dl', definitionList([['SINCE', '3 OCT 2026'], ['ACQUIRED', 'FIRST REGISTRATION']])),
      piece('kv', definitionList([['STATUS', 'ACTIVE'], ['UNTIL', '22 SEP 2028']], { kind: 'kv' })),
      piece('field', field('sp-email', 'EMAIL', input, 'At least 12 characters.')),
      piece('card', plateCard([h('p', { class: 'n-g n-lb', text: 'INVITATION' }), h('h3', { class: 'n-g n-t2', text: 'AN EVENING AT THE ATELIER' })], { left: true })),
      h('section', { class: 'n-specimen', data: { piece: 'photo' } }, fadedPhoto(PIXEL, 'A model, photographed by ORBES', { eager: true }), lift([h('h2', { class: 'n-g n-t1', text: 'MONOLITHE' })], { center: true })),
      piece('countdown', countdown([['02', 'DAYS'], ['06', 'HOURS'], ['12', 'MINUTES']], { label: 'Opens in 2 days, 6 hours and 12 minutes' })),
      piece('dots', tierDots(2, TIER_DOTS)),
      piece(
        'variants',
        variantDots(
          [
            { id: 'steel', label: 'Steel', swatch: '#9D9B96' },
            { id: 'gold', label: 'Gold', swatch: '#B88A3A' },
            { id: 'blue', label: 'Blue', swatch: '#16224A' },
          ],
          { selected: 'steel', label: 'Its variants', onSelect: () => {} },
        ),
        h('div', { class: 'n-fin' }, finishDot('#9D9B96', 'Steel'), finishDot('#B88A3A', 'Gold')),
      ),
      piece('sizes', sizeButtons([{ id: '16', label: '16' }, { id: '17', label: '17' }, { id: '18', label: '18' }], { selected: '17', label: 'Your size', onSelect: () => {} })),
      piece(
        'steps',
        orderSteps(
          [
            { label: 'RESERVED', date: '5 OCT 2026', done: true, current: false },
            { label: 'PAID', date: '6 OCT 2026', done: true, current: true },
            { label: 'SHIPPED', date: null, done: false, current: false },
            { label: 'DELIVERED', date: null, done: false, current: false },
          ],
          { label: 'Steps of this order' },
        ),
      ),
    ),
  );
  document.documentElement.dataset.specimen = 'ready';
}

render();
