/**
 * An order's packing slip, `#/orders/:orderId/slip` (plan LIVE RELEASE+, M2): one printable page in English, black on
 * white in the house style, for the box: the order's reference (and the collector's), whom it is for, the piece, its
 * size, its add-ons, the engraving and the surprise. Never a price, so never the declared value either. PRINT prints
 * the page alone (the console's chrome is hidden in print, styles.css). An AUDITOR reads the buyer masked.
 *
 * The agent's slip of a parcel, `#/logistics/orders/:orderId/slip` (plan NEXT LOT §3.5.3): built from the parcel's own
 * reply (ShippingOrderView, no price, no email), the same rows without Channel, Release and Source, one block per
 * piece of the parcel. A LOGISTICS login reads only this one.
 */
import { h } from '../../shared/dom.js';
import { formatDate } from '../format.js';
import { shippingSlip, type SlipBuyer } from '../model/logistics.js';
import { packingSlip } from '../model/orders.js';
import { href } from '../router.js';
import { button, linkButton, statusMark } from '../ui/components.js';
import type { ViewContext } from './context.js';

/**
 * The For block (plan NEXT LOT §3.6.B, §1.1 (d)): ADDRESS CHANGED with its line while the address was replaced after
 * it was first entered and the parcel has not shipped; the name, the address lines, the country's English name and the
 * phone ('Not entered' without one).
 */
function forBlock(b: SlipBuyer): (HTMLElement | null)[] {
  return [
    h('h2', { class: 'printdoc__heading' }, 'For'),
    b.changed ? h('p', { class: 'printdoc__text', data: { testid: 'slip-address-changed' } }, statusMark('ADDRESS CHANGED', 'alert'), ' ', b.changed) : null,
    h('p', { class: 'printdoc__text', data: { testid: 'slip-buyer-name' } }, b.name ?? '—'),
    b.address ? h('p', { class: ['printdoc__text', 'prewrap'], data: { testid: 'slip-buyer-address' } }, b.address) : null,
    b.country ? h('p', { class: 'printdoc__text', data: { testid: 'slip-buyer-country' } }, b.country) : null,
    h('p', { class: 'printdoc__text', data: { testid: 'slip-buyer-phone' } }, `Phone: ${b.phone}`),
  ];
}

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
        ...forBlock(s.buyer),
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

export async function shippingSlipView(ctx: ViewContext): Promise<HTMLElement> {
  const view = await ctx.api.parcel(ctx.route.params.orderId ?? '');
  const s = shippingSlip(view);
  const print = button('Print', { kind: 'primary', testId: 'slip-print', onClick: () => window.print() });
  const row = (label: string, value: string | null, testid: string) =>
    h('div', { class: 'printdoc__row' }, h('dt', { class: 'printdoc__label' }, label), h('dd', { class: 'printdoc__value', data: { testid } }, value ?? 'None'));
  return h(
    'div',
    { class: 'view view--print' },
    h(
      'div',
      { class: 'printbar' },
      h('p', { class: 'printbar__text' }, 'The packing slip of the parcel, for its box: each piece and what comes with it, without any price.'),
      h('div', { class: 'printbar__actions' }, linkButton('Back to the parcel', href('logisticsOrder', { orderId: view.id }), 'ghost'), print),
    ),
    h(
      'article',
      { class: 'printdoc', attrs: { lang: 'en', 'aria-label': 'Packing slip' }, data: { testid: 'packing-slip' } },
      h('header', { class: 'printdoc__head' }, h('span', { class: ['wordmark', 'printdoc__wordmark'] }, 'Orbes'), h('h1', { class: 'printdoc__title' }, 'Packing slip')),
      h('dl', { class: 'printdoc__refs' }, row('Order', s.reference, 'slip-reference'), row('Date', formatDate(ctx.now()), 'slip-date')),
      h(
        'section',
        { class: 'printdoc__block' },
        ...forBlock(s.buyer),
      ),
      ...s.pieces.map((p) =>
        h(
          'section',
          { class: 'printdoc__block', data: { testid: 'slip-piece-block' } },
          h('h2', { class: 'printdoc__heading' }, s.pieces.length > 1 ? `In this box · ${p.reference}` : 'In this box'),
          h(
            'dl',
            { class: 'printdoc__list' },
            row('Piece', p.piece, 'slip-model'),
            row('Reference', p.serial ?? 'To be scanned', 'slip-piece'),
            row('Size', p.size, 'slip-size'),
            row('Add-ons', p.addons.length ? p.addons.join(' · ') : null, 'slip-addons'),
            row('Engraving', p.engraving, 'slip-engraving'),
            row('Surprise', p.surprise, 'slip-surprise'),
          ),
        ),
      ),
      h('footer', { class: 'printdoc__foot' }, 'ORBES Client Services'),
    ),
  );
}
