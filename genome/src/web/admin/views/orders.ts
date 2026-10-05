/**
 * The Orders board (Clients), `#/orders` (plan LIVE RELEASE+: choices 7 and 19, The console → Orders): every order of
 * every channel — a LIVE RELEASE's piece, a draw's place confirmed, a private-salon request accepted — in its step:
 * RESERVED, PAID, SHIPPED, DELIVERED, CANCELLED, RETURNED. It replaces the LIVE plan's Client Services list.
 *
 * Each card: its reference (and the collector's LR- for a LIVE RELEASE), its channel and release, the collector (the
 * email masked for an AUDITOR), the model and size, the add-ons, the surprise, whether an engraving is to be done, what
 * it holds (in stock, being made, the size to enter, its piece) and its time in its step; a late one stands out (M3:
 * the delays of the console's settings) with why. A card opens the order's page (views/order.ts), where its steps are
 * taken. The filters (`?channel=&dropId=&locationId=&late=true&q=`) narrow the board and its CSV.
 *
 * SHOPIFY EXPORT (plan LIVE RELEASE+, N3): the priced orders reserved in a period, in Shopify's order format, each
 * collector by email (how the store will match its customers to the accounts); masked for an AUDITOR. Nothing is sent
 * to Shopify.
 */
import { h } from '../../shared/dom.js';
import { formatCount, formatDateTime, humanize } from '../format.js';
import { boardFilters, cardHolds, CHANNEL_LABELS, delaysLine, durationText, LATE_LABELS, lateSentence } from '../model/orders.js';
import { defaultPeriod, periodProblem, SHOPIFY_PERIOD_MAX_DAYS } from '../model/shopify.js';
import { href } from '../router.js';
import { ORDER_CHANNELS, type OrderBoard, type OrderBoardColumn, type OrderCard } from '../types.js';
import { button, checkbox, field, filterBar, input, linkButton, pageHeader, section, select, statusMark } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const LEAD =
  'Every order of every channel, in its step: a piece of a LIVE RELEASE, a place of a draw confirmed, a request of the private salon accepted. Each card shows how long the order has been in its step; a late one stands out. Open a card to take its next step.';

export async function ordersView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = boardFilters(ctx.route.query);
  const board = await ctx.api.orderBoard(filters);
  const now = new Date(board.now);

  const channel = select('channel', [{ value: '', label: 'Every channel' }, ...ORDER_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))], filters.channel ?? '');
  channel.addEventListener('change', () => ctx.setQuery({ channel: channel.value }));
  const release = select('dropId', [{ value: '', label: 'Every release' }, ...board.releases.map((r) => ({ value: r.id, label: r.title }))], filters.dropId ?? '');
  release.addEventListener('change', () => ctx.setQuery({ dropId: release.value }));
  const location = select('locationId', [{ value: '', label: 'Every location' }, ...board.locations.map((l) => ({ value: l.id, label: l.name }))], filters.locationId ?? '');
  location.addEventListener('change', () => ctx.setQuery({ locationId: location.value }));
  const late = checkbox('late', 'Late only', filters.late === true);
  (late.querySelector('input') as HTMLInputElement).addEventListener('change', (e) => ctx.setQuery({ late: (e.target as HTMLInputElement).checked ? 'true' : undefined }));
  const search = input('q', { value: filters.q ?? '', placeholder: 'OR-…, LR-…, a piece, a model', maxlength: 100 });
  const searchFor = () => ctx.setQuery({ q: search.value.trim() });
  search.addEventListener('change', searchFor);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchFor();
  });

  const csv = button('Download CSV', { kind: 'ghost', testId: 'orders-csv' });
  csv.addEventListener('click', async () => {
    csv.disabled = true;
    try {
      saveDownload(await ctx.api.ordersCsv(filters));
    } catch (e) {
      notifyError(e);
    } finally {
      csv.disabled = false;
    }
  });

  // N3: the orders of a period in Shopify's format (the board's filters do not apply).
  const shopify = button('Shopify export', { kind: 'ghost', testId: 'orders-shopify-export' });
  shopify.addEventListener('click', () => {
    const period = defaultPeriod(now);
    void openDialog({
      title: 'Shopify order export',
      eyebrow: 'Orders',
      body: h(
        'p',
        { class: 'dialog__text' },
        `A file in Shopify’s order format: every order reserved in the period and priced, its piece and its add-ons as line items, its steps as Shopify’s statuses, its buyer, and the collector’s email, by which the store will match its customers to the accounts. At most ${SHOPIFY_PERIOD_MAX_DAYS} days, in UTC. Nothing is sent to Shopify.`,
      ),
      fields: [
        { name: 'from', label: 'First day', kind: 'date', required: true, value: period.from },
        { name: 'to', label: 'Last day', kind: 'date', required: true, value: period.to },
      ],
      validate: (v) => periodProblem(v.from, v.to),
      confirmLabel: 'Download',
      submit: async (v) => {
        saveDownload(await ctx.api.shopifyOrdersCsv(v.from, v.to));
      },
    }).then((r) => r && notify('Shopify order export downloaded.'));
  });

  const totals = board.columns.reduce((n, c) => n + c.total, 0);
  const lateTotal = board.columns.reduce((n, c) => n + c.late, 0);

  return h(
    'div',
    { class: 'view view--orders' },
    pageHeader({ eyebrow: 'Clients', title: 'Orders', lead: LEAD, actions: [linkButton('Settings', href('settings'), 'ghost'), shopify, csv] }),
    filterBar(field('Channel', channel), field('Release', release), field('Location', location), field('Search', search), h('div', { class: 'cfield cfield--checks' }, late)),
    h(
      'p',
      { class: 'board__summary', data: { testid: 'orders-summary' } },
      h('span', { class: 'board__figures' }, `${formatCount(totals)} ${totals === 1 ? 'order' : 'orders'} · ${formatCount(lateTotal)} late`),
      h('span', { class: 'board__delays' }, `Late after: ${delaysLine(board.delays)}.`),
    ),
    boardColumns(board, now),
  );
}

/** The six columns, side by side. */
function boardColumns(board: OrderBoard, now: Date): HTMLElement {
  return h('div', { class: 'board', data: { testid: 'orders-board' } }, ...board.columns.map((c) => column(c, board, now)));
}

function column(c: OrderBoardColumn, board: OrderBoard, now: Date): HTMLElement {
  const head = h(
    'header',
    { class: 'board__head' },
    h('h2', { class: 'board__title' }, humanize(c.status)),
    h('span', { class: 'board__count', attrs: { 'aria-label': `${c.total} ${c.total === 1 ? 'order' : 'orders'}` } }, formatCount(c.total)),
    c.late > 0 ? h('span', { class: 'board__late', data: { testid: `late-${c.status}` } }, `${formatCount(c.late)} late`) : null,
  );
  const body =
    c.items.length === 0
      ? h('p', { class: 'board__empty' }, 'None')
      : h('ul', { class: 'board__cards' }, ...c.items.map((x) => h('li', null, card(x, board, now))));
  const more = c.total > c.items.length ? h('p', { class: 'board__more' }, `${formatCount(c.items.length)} of ${formatCount(c.total)} shown: narrow the board with the filters, or download the CSV.`) : null;
  return h('section', { class: ['board__col', `board__col--${c.status.toLowerCase()}`], attrs: { 'aria-label': humanize(c.status) }, data: { testid: `column-${c.status}` } }, head, body, more);
}

function card(x: OrderCard, board: OrderBoard, now: Date): HTMLElement {
  const origin = x.release?.title ?? CHANNEL_LABELS[x.channel];
  const size = x.sizeLabel ?? (x.skuCode ? 'ONE SIZE' : 'Size to enter');
  return h(
    'a',
    {
      class: ['ocard', x.timing.late ? 'ocard--late' : null],
      attrs: { href: href('order', { orderId: x.id }), 'aria-label': `${x.reference}, ${origin}, ${x.model.name}${x.timing.late ? ', late' : ''}` },
      data: { testid: 'order-card', order: x.id },
    },
    h(
      'span',
      { class: 'ocard__top' },
      h('span', { class: 'ocard__ref mono' }, x.reference),
      h('span', { class: 'ocard__channel' }, CHANNEL_LABELS[x.channel]),
    ),
    x.timing.late && x.timing.rule ? h('span', { class: 'ocard__late', attrs: { title: lateSentence(x.timing.rule, board.delays) } }, statusMark(LATE_LABELS[x.timing.rule], 'alert')) : null,
    x.release ? h('span', { class: 'ocard__origin' }, x.release.title) : null,
    h('span', { class: 'ocard__piece' }, `${x.model.name} · ${size}`),
    h('span', { class: 'ocard__who' }, x.account.email),
    x.sourceReference ? h('span', { class: ['ocard__line', 'mono'] }, x.sourceReference) : null,
    x.addons.length ? h('span', { class: 'ocard__line' }, x.addons.map((a) => a.label).join(' · ')) : null,
    x.engraving ? h('span', { class: 'ocard__line' }, 'Engraving entered') : null,
    x.surprise ? h('span', { class: 'ocard__line' }, `Surprise: ${x.surprise}`) : null,
    h('span', { class: 'ocard__holds' }, x.shipment ? `${x.shipment.carrier} · ${x.shipment.trackingNumber}` : cardHolds(x)),
    h(
      'span',
      { class: 'ocard__time', attrs: { title: `Since ${formatDateTime(x.timing.since)}` } },
      `In this step ${durationText(x.timing.since, now)}`,
    ),
  );
}
