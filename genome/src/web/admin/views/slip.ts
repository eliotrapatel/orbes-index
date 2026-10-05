/**
 * An order's packing slip, `#/orders/:orderId/slip` (plan LIVE RELEASE+, M2): one printable page in English, black on
 * white in the house style, for the box: the order's reference (and the collector's), whom it is for, the piece, its
 * size, its add-ons, the engraving and the surprise. Never a price, so never the declared value either. PRINT prints
 * the page alone (the console's chrome is hidden in print, styles.css). An AUDITOR reads the buyer masked.
 */
import { h } from '../../shared/dom.js';
import { formatDate } from '../format.js';
import { packingSlip } from '../model/orders.js';
import { href } from '../router.js';
import { button, linkButton } from '../ui/components.js';
import type { ViewContext } from './context.js';

export async function packingSlipView(ctx: ViewContext): Promise<HTMLElement> {
  const d = await ctx.api.order(ctx.route.params.orderId ?? '');
  const s = packingSlip(d);
  const print = button('Print', { kind: 'primary', testId: 'slip-print', onClick: () => window.print() });
  const row = (label: string, value: string | null, testid: string) =>
    h('div', { class: 'printdoc__row' }, h('dt', { class: 'printdoc__label' }, label), h('dd', { class: 'printdoc__value', data: { testid } }, value ?? 'None'));
  return h(
    'div',
    { class: 'view view--print' },
    h(
      'div',
      { class: 'printbar' },
      h('p', { class: 'printbar__text' }, 'The packing slip of the order, for its box: the piece and what comes with it, without any price.'),
      h('div', { class: 'printbar__actions' }, linkButton('Back to the order', href('order', { orderId: d.order.id }), 'ghost'), print),
    ),
    h(
      'article',
      { class: 'printdoc', attrs: { lang: 'en', 'aria-label': 'Packing slip' }, data: { testid: 'packing-slip' } },
      h(
        'header',
        { class: 'printdoc__head' },
        h('span', { class: ['wordmark', 'printdoc__wordmark'] }, 'Orbes'),
        h('h1', { class: 'printdoc__title' }, 'Packing slip'),
      ),
      h(
        'dl',
        { class: 'printdoc__refs' },
        row('Order', s.reference, 'slip-reference'),
        ...(s.sourceReference ? [row('Reservation', s.sourceReference, 'slip-source')] : []),
        row('Date', formatDate(ctx.now()), 'slip-date'),
      ),
      h(
        'section',
        { class: 'printdoc__block' },
        h('h2', { class: 'printdoc__heading' }, 'For'),
        h('p', { class: 'printdoc__text', data: { testid: 'slip-buyer-name' } }, s.buyer.name ?? '—'),
        s.buyer.address ? h('p', { class: ['printdoc__text', 'prewrap'], data: { testid: 'slip-buyer-address' } }, s.buyer.address) : null,
      ),
      h(
        'section',
        { class: 'printdoc__block' },
        h('h2', { class: 'printdoc__heading' }, 'In this box'),
        h(
          'dl',
          { class: 'printdoc__list' },
          row('Piece', s.model, 'slip-model'),
          row('Reference', s.piece ?? 'To be linked', 'slip-piece'),
          row('Size', s.size, 'slip-size'),
          row('Add-ons', s.addons.length ? s.addons.join(' · ') : null, 'slip-addons'),
          row('Engraving', s.engraving, 'slip-engraving'),
          row('Surprise', s.surprise, 'slip-surprise'),
        ),
      ),
      h('footer', { class: 'printdoc__foot' }, `${s.release ? `${s.release} · ` : ''}${s.channel} · ORBES Client Services`),
    ),
  );
}
