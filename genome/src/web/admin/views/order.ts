/**
 * An order's page, `#/orders/:orderId` (plan LIVE RELEASE+, The console → Orders), from its card on the board.
 *
 *  - Its step: RESERVED → PAID → SHIPPED → DELIVERED with the time each was reached (or CANCELLED, or RETURNED), its
 *    time in its step, and whether it is late (M3) and why; the next steps (OPERATOR): MARK PAID (once priced: its
 *    invoice is issued), SHIP (a carrier of the settings, the tracking number, the value declared for the insurance),
 *    MARK DELIVERED, CANCEL (with a note; a credit note once paid), OPEN A RETURN (choice 20: back to stock at a
 *    location, or, by an ADMIN, to the archive, with a note; ORBES takes back its buyer's ownership if they registered
 *    it; back to stock, the claim code of the piece's new card is shown once, with its card to download).
 *  - The order: its channel, release, the collector (the email masked for an AUDITOR) and the reference they hold, the
 *    model, size, price, add-ons, surprise and engraving text; EDIT (OPERATOR): a draw's or a salon's size, price and
 *    currency, any order's engraving text (decision 31).
 *  - Its welcome gift and its credit (plan NEXT-NINE, BP-19 T5): the GIFT order travelling with it (its size to
 *    choose: MARK PAID waits for it), the client's credit usable now and the credit taken off it; APPLY CREDIT and
 *    REMOVE CREDIT (OPERATOR, while RESERVED). A GIFT order says its tier and the order it travels with; its size, To be
 *    confirmed, is chosen among its model's (CHOOSE SIZE). An order travelling with another ships with SHIP WITH ITS
 *    ORDER, prefilled with that order's carrier and tracking number.
 *  - Its buyer: the name and address entered by Client Services (masked for an AUDITOR); EDIT (OPERATOR).
 *  - Its piece: the location it is served from (CHANGE: what it holds moves), what it holds (a piece in stock, a piece
 *    being made at the atelier), the piece that fulfils it (LINK A PIECE picked from the stock, also in place of a
 *    piece to make still being made: that piece to make is then cancelled).
 *  - Its shipment: the carrier, the tracking number and its link, the declared value.
 *  - Its return: where the piece went, the note, whether ORBES took the ownership back.
 *  - Its documents (M7): the invoice and the credit note, each with its PDF.
 *  - Its history: each change, its note, who made it.
 * PACKING SLIP opens the printable slip (views/slip.ts). Each request is audited by the server; the page is read again.
 */
import { h, type Child } from '../../shared/dom.js';
import { formatDateTime, humanize } from '../format.js';
import { formatMoney, parseMoney } from '../model/live.js';
import {
  addonsLine,
  buyerInput,
  canChooseGiftSize,
  buyerProblem,
  CHANNEL_LABELS,
  creditActions,
  creditAppliedLine,
  creditAvailableLine,
  creditProblem,
  creditValue,
  DOCUMENT_LABELS,
  giftHeaderLine,
  giftLine,
  giftSizeOptions,
  durationText,
  EVENT_LABELS,
  eventActor,
  GIFT_SIZE_TERMS,
  lateSentence,
  noteProblem,
  ORDER_LIMITS,
  orderActions,
  priceLine,
  RETURN_LABELS,
  returnInput,
  returnProblem,
  shipInput,
  shipProblem,
  shipWaitsFor,
  sizeText,
  shippingLine,
  termsChange,
  termsProblem,
  termsValues,
  viewHolds,
} from '../model/orders.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { ORDER_CURRENCIES, type OrderDocument, type OrderReturned, type OrderStatus, type OrderTransitionInput } from '../types.js';
import { button, copyButton, defList, linkButton, mono, pageHeader, section, statusMark, table, type DefRow } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The steps in order, as the strip shows them. */
const STEPS: readonly OrderStatus[] = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED'];

export async function orderView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.orderId ?? '';
  const [d, carriers, locations] = await Promise.all([ctx.api.order(id), ctx.api.carriers(), ctx.api.locations()]);
  const o = d.order;
  const now = ctx.now();
  const acts = orderActions(o, ctx.session.admin.role);
  const credits = creditActions(o, ctx.session.admin.role);
  const eyebrow = `${o.reference} · ${CHANNEL_LABELS[o.channel]}`;
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };
  const step = (input: OrderTransitionInput) => ctx.api.transitionOrder(o.id, input).then(() => undefined);

  // ── The step ─────────────────────────────────────────────────────────────
  const noteField = (required: boolean, hint: string): DialogField => ({ name: 'note', label: 'Note', kind: 'textarea', maxlength: ORDER_LIMITS.note, required, hint });
  const pay = () =>
    void openDialog({
      title: 'Mark paid',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'ORBES Client Services received the payment of this order: it reads PAID, with the time, and its invoice is issued by CONGLOMERAT LLC to the buyer entered on the order.'),
      fields: [noteField(false, 'How it was paid, for Client Services: kept in the order’s history. Optional.')],
      validate: (v) => noteProblem(v.note, false),
      // An invoice is never changed: one issued before the buyer is entered carries the account's email only.
      live: () => {
        const missing = !o.buyer.name && !o.buyer.address ? 'No buyer is entered on the order: its invoice will carry the account’s email only.' : !o.buyer.name ? 'The buyer’s name is not entered: its invoice will be issued without it.' : !o.buyer.address ? 'The buyer’s address is not entered: its invoice will be issued without it.' : null;
        return missing ? h('p', { class: 'dialog__text', data: { testid: 'pay-no-buyer' } }, `${missing} An invoice is never changed: enter the buyer first.`) : [];
      },
      confirmLabel: 'Mark paid',
      submit: async (v) => step({ to: 'PAID', ...(v.note.trim() ? { note: v.note.trim() } : {}) }),
    }).then(done('Order paid.'));
  const active = carriers.items.filter((c) => c.active);
  // SHIP WITH ITS ORDER (BP-19 T5): an order travelling with another (a welcome gift, a LIVE entry's next pieces).
  const shipLabel = o.withOrder ? 'Ship with its order' : 'Ship';
  const ship = () =>
    void openDialog({
      title: shipLabel,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `The piece leaves ${o.location.name}: the order reads SHIPPED, with its carrier and tracking number, which the collector reads with its link.`),
      // SHIP WITH ITS ORDER (BP-19 T5): an order travelling with another, prefilled with that order's carrier and tracking number.
      fields: [
        {
          name: 'carrierId',
          label: 'Carrier',
          kind: 'select',
          required: true,
          options: [{ value: '', label: 'Choose a carrier' }, ...active.map((c) => ({ value: c.id, label: c.name }))],
          value: o.withOrder?.shipment && active.some((c) => c.id === o.withOrder!.shipment!.carrierId) ? o.withOrder.shipment.carrierId : '',
        },
        {
          name: 'trackingNumber',
          label: 'Tracking number',
          required: true,
          maxlength: 40,
          value: o.withOrder?.shipment?.trackingNumber ?? '',
          ...(o.withOrder?.shipment ? { hint: `As ${o.withOrder.reference} shipped: it travels with it.` } : {}),
        },
        {
          name: 'declaredValue',
          label: 'Declared value',
          maxlength: 12,
          hint: o.currency ? `For the insurance, in ${o.currency}: 4800, or 4800.50. Kept on the shipment, never on the packing slip. Optional.` : 'Enter the order’s price first to declare a value.',
        },
        noteField(false, 'Optional.'),
      ],
      validate: (v) => shipProblem(v, o.currency),
      confirmLabel: shipLabel,
      submit: async (v) => step(shipInput(v)),
    }).then(done('Order shipped.'));
  const deliver = () =>
    void openDialog({
      title: 'Mark delivered',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'The piece reached its buyer. An order shipped is also delivered by itself when its buyer registers the piece.'),
      fields: [noteField(false, 'Optional.')],
      validate: (v) => noteProblem(v.note, false),
      confirmLabel: 'Mark delivered',
      submit: async (v) => step({ to: 'DELIVERED', ...(v.note.trim() ? { note: v.note.trim() } : {}) }),
    }).then(done('Order delivered.'));
  const cancel = () =>
    void openDialog({
      title: 'Cancel the order',
      eyebrow,
      danger: true,
      body: h(
        'p',
        { class: 'dialog__text' },
        o.reservation === 'BENCH'
          ? 'The order reads CANCELLED. Its piece to make is cancelled at the atelier, and the ORBES identity reserved for it is retired: its serial is never used again.'
          : o.reservation === 'STOCK'
            ? 'The order reads CANCELLED. The piece it holds in stock is free again.'
            : 'The order reads CANCELLED.',
      ),
      fields: [noteField(true, 'Why, for Client Services: kept in the order’s history.')],
      validate: (v) => noteProblem(v.note, true),
      live: () => (o.status === 'PAID' ? h('p', { class: 'dialog__text' }, 'It was paid: a credit note cancels its invoice.') : []),
      confirmLabel: 'Cancel the order',
      submit: async (v) => step({ to: 'CANCELLED', note: v.note.trim() }),
    }).then(done('Order cancelled.'));
  const returned = () => {
    let result: OrderReturned | null = null;
    void openDialog({
      title: 'Open a return',
      eyebrow,
      danger: (v) => v.outcome === 'ARCHIVED',
      phrase: (v) => (v.outcome === 'ARCHIVED' ? 'ARCHIVE' : null),
      body: h('p', { class: 'dialog__text' }, `The piece ${o.productId ?? ''} came back to ORBES: the order reads RETURNED, and a credit note cancels its invoice.`),
      fields: [
        {
          name: 'outcome',
          label: 'The piece goes',
          kind: 'select',
          required: true,
          // The archive retires the piece: ADMIN's alone (an OPERATOR takes it back to stock).
          options: [{ value: '', label: 'Choose' }, { value: 'RESTOCKED', label: RETURN_LABELS.RESTOCKED }, ...(acts.archive ? [{ value: 'ARCHIVED', label: RETURN_LABELS.ARCHIVED }] : [])],
          value: '',
        },
        {
          name: 'locationId',
          label: 'Location',
          kind: 'select',
          options: [{ value: '', label: 'Choose a location' }, ...locations.items.map((l) => ({ value: l.id, label: l.name }))],
          value: '',
          hint: 'Back to stock: where it is counted again.',
        },
        noteField(true, 'Why, and the state of the piece: kept in the order’s history.'),
      ],
      validate: returnProblem,
      live: (v) =>
        v.outcome === 'RESTOCKED'
          ? h(
              'p',
              { class: 'dialog__text' },
              'The piece is counted again in stock, ready to be sold, with a new claim code for its new certificate card, shown once: the card that left with it no longer registers it. If its buyer registered it, ORBES takes the ownership back.',
            )
          : v.outcome === 'ARCHIVED'
            ? h('p', { class: 'dialog__text' }, 'The piece leaves circulation: it is retired, and its code answers as a retired piece. If its buyer registered it, ORBES takes the ownership back.')
            : [],
      confirmLabel: 'Open the return',
      submit: async (v) => {
        result = await ctx.api.returnOrder(o.id, returnInput(v));
      },
    }).then((v) => {
      const r = result as OrderReturned | null;
      if (!v || !r) return;
      if (r.claimCode) void claimCodeDialog(r.productId, r.claimCode).then(() => done('Order returned.')(true));
      else done('Order returned.')(true);
    });
  };
  /** The new card's claim code, shown once (only its hash is kept), with the card to download. */
  const claimCodeDialog = (productId: string, code: string) => {
    const card = button('Download certificate card', { kind: 'ghost', testId: 'return-card' });
    card.addEventListener('click', async () => {
      card.disabled = true;
      try {
        saveDownload(await ctx.api.certificates([{ productId, claimCode: code }], { format: 'pdf', layout: 'card' }));
      } catch (e) {
        notifyError(e, 'The certificate card could not be produced.');
      } finally {
        card.disabled = false;
      }
    });
    return openDialog({
      title: 'Its new claim code',
      eyebrow: productId,
      body: [
        h('p', { class: 'dialog__text' }, 'The piece’s next buyer registers it with this code; the card that left with it no longer does. Shown once: download its certificate card now. Only its hash is kept.'),
        h('p', { class: 'claimcode', data: { testid: 'claim-code' } }, mono(code)),
        h('div', { class: 'row-actions' }, copyButton(code, 'Copy the claim code'), card),
      ],
      confirmLabel: 'Done',
      cancelLabel: 'Close',
    });
  };

  const stepTools = [
    acts.pay ? button('Mark paid', { kind: 'primary', testId: 'order-pay', onClick: pay }) : null,
    acts.ship ? button(shipLabel, { kind: 'primary', testId: 'order-ship', onClick: ship }) : null,
    acts.deliver ? button('Mark delivered', { kind: 'primary', testId: 'order-deliver', onClick: deliver }) : null,
    acts.cancel ? button('Cancel', { kind: 'danger', testId: 'order-cancel', onClick: cancel }) : null,
    acts.return ? button('Open a return', { kind: 'secondary', testId: 'order-return', onClick: returned }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);

  const reachedAt: Record<OrderStatus, string | null> = {
    RESERVED: o.reservedAt,
    PAID: o.paidAt,
    SHIPPED: o.shippedAt,
    DELIVERED: o.deliveredAt,
    CANCELLED: o.cancelledAt,
    RETURNED: o.returnedAt,
  };
  const ending: OrderStatus[] = o.status === 'CANCELLED' ? ['CANCELLED'] : o.status === 'RETURNED' ? ['RETURNED'] : [];
  const strip = h(
    'ol',
    { class: 'osteps', data: { testid: 'order-steps' } },
    ...[...STEPS, ...ending].map((s) =>
      h(
        'li',
        { class: ['osteps__step', reachedAt[s] ? 'is-reached' : null, s === o.status ? 'is-current' : null], attrs: { 'aria-current': s === o.status ? 'step' : null } },
        h('span', { class: 'osteps__label' }, humanize(s)),
        h('span', { class: 'osteps__time' }, reachedAt[s] ? formatDateTime(reachedAt[s]) : '—'),
      ),
    ),
  );
  const waits = shipWaitsFor(o);
  const stepRows: DefRow[] = [
    { label: 'Step', value: statusMark(humanize(o.status), toneOf('order', o.status)) },
    { label: 'In this step', value: durationText(d.timing.since, now), note: `Since ${formatDateTime(d.timing.since)}` },
    {
      label: 'Late',
      value: d.timing.late && d.timing.rule ? h('span', { data: { testid: 'order-late' } }, statusMark('LATE', 'alert'), ' ', lateSentence(d.timing.rule, d.delays)) : 'No',
      ...(d.timing.dueAt && !d.timing.late ? { note: `Stands out from ${formatDateTime(d.timing.dueAt)}` } : {}),
    },
    ...(waits ? [{ label: 'Waiting', value: waits }] : []),
  ];
  const stepSection = section('Step', [strip, defList(stepRows)], { id: 'order-step', tools: stepTools });

  // ── The order ────────────────────────────────────────────────────────────
  // A welcome gift's size is chosen in its own dialog, CHOOSE SIZE (BP-19 T5): EDIT holds the rest of its terms.
  const terms = o.channel === 'GIFT' ? { ...acts.terms, size: false } : acts.terms;
  const editTerms = () => {
    const v = termsValues(o);
    const fields: DialogField[] = [];
    if (terms.size) {
      fields.push(
        { name: 'size', label: 'Size', maxlength: ORDER_LIMITS.size, value: v.size, hint: 'As the model’s sizes are named: 52, M. The order then holds a piece of that size, or one is made for it.' },
        { name: 'oneSize', label: 'One size', kind: 'checkbox', value: v.oneSize, hint: 'The model has no sizes.' },
      );
    }
    if (acts.terms.price) {
      fields.push(
        { name: 'price', label: 'Price of the piece', maxlength: 12, value: v.price, hint: 'In units: 4800, or 4800.50. It is fixed once the order is paid.' },
        { name: 'currency', label: 'Currency', kind: 'select', options: ORDER_CURRENCIES.map((c) => ({ value: c, label: c })), value: v.currency },
      );
    }
    if (acts.terms.shipping) {
      fields.push(
        {
          name: 'shippingService',
          label: 'Shipping service',
          kind: 'select',
          options: [
            { value: 'STANDARD', label: 'Standard' },
            { value: 'EXPRESS', label: 'Express' },
          ],
          value: v.shippingService,
        },
        {
          name: 'shippingFee',
          label: 'Shipping fee',
          maxlength: 12,
          value: v.shippingFee,
          hint: 'In units: 20, or 20.50; 0 for free. Empty: no shipping line. A PLATINE or PALLADIUM order keeps its free shipping; express below PALLADIUM is paid at the fee entered.',
        },
      );
    }
    if (acts.terms.engraving) {
      fields.push({ name: 'engraving', label: 'Engraving text', maxlength: ORDER_LIMITS.engraving, value: v.engraving, hint: 'As it is to be engraved, on one line; empty for none. Its piece to make carries it to the atelier.' });
    }
    void openDialog({
      title: 'The order’s terms',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, o.channel === 'LIVE' ? 'The size and the price of a LIVE RELEASE order are its release’s: only the engraving text is entered here.' : 'Entered by ORBES Client Services with the collector.'),
      fields,
      validate: (values) => termsProblem(o, values, terms),
      confirmLabel: 'Save',
      submit: async (values) => {
        await ctx.api.setOrderTerms(o.id, termsChange(o, values, terms));
      },
    }).then(done('Order saved.'));
  };
  const chooseSize = () =>
    void openDialog({
      title: 'Choose size',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'The welcome gift’s size, confirmed with the collector. The order then holds a piece of that size, or one is made for it.'),
      fields: [
        {
          name: 'giftSize',
          label: 'Size',
          kind: 'select',
          required: true,
          options: [{ value: '', label: 'Choose a size' }, ...giftSizeOptions(o)],
          value: termsValues(o).giftSize,
          hint: 'Among the gift model’s sizes, with the pieces available.',
        },
      ],
      validate: (values) => (values.giftSize ? termsProblem(o, values, GIFT_SIZE_TERMS) : 'Choose a size.'),
      confirmLabel: 'Choose size',
      submit: async (values) => {
        await ctx.api.setOrderTerms(o.id, termsChange(o, values, GIFT_SIZE_TERMS));
      },
    }).then(done('Size chosen.'));
  const releaseLink = o.release
    ? h('a', { class: 'idlink', attrs: { href: o.channel === 'LIVE' ? href('liveRelease', { dropId: o.release.id }) : href('drop', { dropId: o.release.id }) } }, o.release.title)
    : 'The private salon';
  // ── The credit (BP-19 T5) ────────────────────────────────────────────────
  const applyCredit = () =>
    void openDialog({
      title: 'Apply credit',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'A tier’s credit taken off this order’s invoice, in its currency. It is given back if the order is cancelled or returned, with its expiry unchanged.'),
      fields: [{ name: 'amount', label: 'Amount', maxlength: 12, value: creditValue(o), hint: `In ${o.currency ?? 'its currency'}, in units: 50, or 50.50. Available: ${creditAvailableLine(o)}.` }],
      validate: (v) => creditProblem(o, v),
      confirmLabel: 'Apply credit',
      submit: async (v) => {
        await ctx.api.applyOrderCredit(o.id, parseMoney(v.amount)!);
      },
    }).then(done('Credit applied.'));
  const removeCredit = () =>
    void openDialog({
      title: 'Remove credit',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, `The credit taken off this order (${creditAppliedLine(o)}) is given back to the client, with its expiry unchanged.`),
      confirmLabel: 'Remove credit',
      submit: async () => {
        await ctx.api.removeOrderCredit(o.id);
      },
    }).then(done('Credit removed.'));
  const gift = giftLine(o);
  const orderRows: DefRow[] = [
    { label: 'Channel', value: CHANNEL_LABELS[o.channel] },
    ...(o.channel === 'GIFT' && o.withOrder
      ? [{ label: 'Travels with', value: h('a', { class: 'idlink', attrs: { href: href('order', { orderId: o.withOrder.id }) }, data: { testid: 'order-gift-parent' } }, o.withOrder.reference) }]
      : []),
    { label: 'Release', value: releaseLink },
    ...(d.sourceReference ? [{ label: 'Collector’s reference', value: mono(d.sourceReference), note: o.source.piece > 1 ? `Piece ${o.source.piece} of the reservation` : undefined }] : []),
    { label: 'Collector', value: h('a', { class: 'idlink', attrs: { href: href('owner', { accountId: d.account.id }) }, data: { testid: 'order-collector' } }, d.account.email) },
    { label: 'Model', value: o.model.name },
    { label: 'Size', value: h('span', { data: { testid: 'order-size' } }, sizeText({ sizeLabel: o.sizeLabel, skuKnown: o.skuId !== null, gift: o.channel === 'GIFT' })) },
    { label: 'Price', value: priceLine(o) },
    { label: 'Add-ons', value: addonsLine(o) },
    { label: 'Shipping', value: h('span', { data: { testid: 'order-shipping' } }, shippingLine(o)) },
    ...(gift && o.gift ? [{ label: 'Welcome gift', value: h('a', { class: 'idlink', attrs: { href: href('order', { orderId: o.gift.id }) }, data: { testid: 'order-gift' } }, gift) }] : []),
    ...(o.channel !== 'GIFT'
      ? [
          { label: 'Credit available', value: h('span', { data: { testid: 'order-credit-available' } }, creditAvailableLine(o)) },
          { label: 'Credit applied', value: h('span', { data: { testid: 'order-credit-applied' } }, creditAppliedLine(o)) },
        ]
      : []),
    { label: 'Engraving', value: o.engravingText ?? 'None' },
    { label: 'Surprise', value: o.surprise ?? 'None' },
  ];
  const termsTool = [
    ...(canChooseGiftSize(o, acts.terms) ? [button('Choose size', { kind: 'ghost', testId: 'order-gift-size', onClick: chooseSize })] : []),
    ...(terms.size || terms.price || terms.engraving || terms.shipping ? [button('Edit', { kind: 'ghost', testId: 'order-terms', onClick: editTerms })] : []),
    ...(credits.apply ? [button('Apply credit', { kind: 'ghost', testId: 'order-credit-apply', onClick: applyCredit })] : []),
    ...(credits.remove ? [button('Remove credit', { kind: 'ghost', testId: 'order-credit-remove', onClick: removeCredit })] : []),
  ];
  const orderSection = section('Order', defList(orderRows), { id: 'order-facts', tools: termsTool });

  // ── The buyer ────────────────────────────────────────────────────────────
  const editBuyer = () =>
    void openDialog({
      title: 'The buyer',
      eyebrow,
      body: h('p', { class: 'dialog__text' }, 'Entered by ORBES Client Services with the collector: kept on the order for its shipment and its documents, never in the audit log.'),
      fields: [
        { name: 'name', label: 'Name', maxlength: ORDER_LIMITS.buyerName, value: o.buyer.name ?? '', hint: 'Empty to clear.' },
        { name: 'address', label: 'Address', kind: 'textarea', rows: 4, maxlength: ORDER_LIMITS.buyerAddress, value: o.buyer.address ?? '', hint: 'As it is written on the parcel, one line each. Empty to clear.' },
      ],
      validate: (v) => buyerProblem(o, v),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setOrderBuyer(o.id, buyerInput(v));
      },
    }).then(done('Buyer saved.'));
  const buyerSection = section(
    'Buyer',
    defList([
      { label: 'Name', value: h('span', { data: { testid: 'buyer-name' } }, o.buyer.name ?? 'Not entered') },
      { label: 'Address', value: h('span', { class: 'prewrap', data: { testid: 'buyer-address' } }, o.buyer.address ?? 'Not entered') },
    ]),
    { id: 'order-buyer', tools: acts.buyer ? [button('Edit', { kind: 'ghost', testId: 'order-buyer', onClick: editBuyer })] : [] },
  );

  // ── The piece ────────────────────────────────────────────────────────────
  const moveTo = () =>
    void openDialog({
      title: 'Change the location',
      eyebrow,
      body: h(
        'p',
        { class: 'dialog__text' },
        o.reservation === 'STOCK'
          ? 'The piece it holds is released here and one is taken at the new location, or made for it there.'
          : o.reservation === 'BENCH'
            ? 'Its piece to make goes to the new location, where the atelier sends it once finished.'
            : 'The order is served from the new location.',
      ),
      fields: [
        {
          name: 'locationId',
          label: 'Location',
          kind: 'select',
          required: true,
          options: [{ value: '', label: 'Choose a location' }, ...locations.items.filter((l) => l.id !== o.location.id).map((l) => ({ value: l.id, label: l.name }))],
          value: '',
        },
      ],
      validate: (v) => (v.locationId ? null : 'Choose a location.'),
      confirmLabel: 'Change',
      submit: async (v) => {
        await ctx.api.changeOrderLocation(o.id, v.locationId);
      },
    }).then(done('Location changed.'));
  const linkPiece = () =>
    void openDialog({
      title: 'Link a piece from stock',
      eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, `A piece issued of ${o.model.name} in ${sizeText({ sizeLabel: o.sizeLabel, skuKnown: true })}, at ${o.location.name}, never registered: it fulfils this order, which then holds it until it ships.`),
        o.reservation === 'BENCH' && o.bench
          ? h(
              'p',
              { class: 'dialog__text', data: { testid: 'link-replaces-bench' } },
              `Its piece to make, ${o.bench.productId}, is then cancelled at the atelier, and the ORBES identity reserved for it retired: its serial is never used again. A finished piece never counted in the stock is counted in with this order.`,
            )
          : null,
      ],
      fields: [{ name: 'productId', label: 'Piece reference', required: true, maxlength: 20, hint: 'As engraved and printed: O26-J-00184.' }],
      validate: (v) => (/^O\d{2}-[A-Z]-\d{5,6}$/i.test(v.productId.trim()) ? null : 'A piece reference reads O26-J-00184.'),
      confirmLabel: 'Link the piece',
      submit: async (v) => {
        await ctx.api.linkOrderPiece(o.id, v.productId.trim().toUpperCase());
      },
    }).then(done('Piece linked.'));
  const pieceRows: DefRow[] = [
    { label: 'Location', value: o.location.name },
    ...(o.status === 'RESERVED' || o.status === 'PAID' ? [{ label: 'Holds', value: h('span', { data: { testid: 'order-holds' } }, viewHolds(o)) }] : []),
    ...(o.bench
      ? [
          {
            label: 'Piece to make',
            value: h('a', { class: 'idlink', attrs: { href: href('atelier', {}, { skuId: o.skuId ?? undefined }) } }, `${humanize(o.bench.status)} · ${o.bench.productId}`),
            note: 'Its ORBES identity is reserved; the atelier issues it once finished.',
          },
        ]
      : []),
    ...(d.piece
      ? [
          {
            label: 'Piece',
            value: h('a', { class: 'idlink', attrs: { href: productHref(d.piece.productId) } }, d.piece.productId),
            note: o.return?.ownershipReclaimed
              ? 'Registered by its buyer, then taken back by ORBES with its return.'
              : d.piece.registered
                ? 'Registered by its buyer.'
                : o.return
                  ? 'Never registered by its buyer.'
                  : 'Not registered by its buyer yet.',
          },
        ]
      : []),
  ];
  const pieceTools = [
    acts.location ? button('Change location', { kind: 'ghost', testId: 'order-location', onClick: moveTo }) : null,
    acts.linkPiece ? button('Link a piece', { kind: 'ghost', testId: 'order-link', onClick: linkPiece }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  const pieceSection = section('Piece', defList(pieceRows), { id: 'order-piece', tools: pieceTools });

  // ── The shipment ─────────────────────────────────────────────────────────
  const shipmentSection = o.shipment
    ? section(
        'Shipment',
        defList([
          { label: 'Carrier', value: o.shipment.carrier.name },
          {
            label: 'Tracking number',
            value: h('a', { class: 'idlink', attrs: { href: o.shipment.trackingUrl, target: '_blank', rel: 'noopener noreferrer' }, data: { testid: 'order-tracking' } }, o.shipment.trackingNumber),
          },
          { label: 'Declared value', value: o.shipment.declaredValueMinor !== null && o.currency ? formatMoney(o.shipment.declaredValueMinor, o.currency) : 'None' },
        ]),
        { id: 'order-shipment' },
      )
    : null;

  // ── The return ───────────────────────────────────────────────────────────
  const r = o.return;
  const returnSection = r
    ? section(
        'Return',
        defList([
          { label: 'The piece', value: h('span', { data: { testid: 'return-outcome' } }, r.location ? `${RETURN_LABELS[r.outcome]} · ${r.location.name}` : RETURN_LABELS[r.outcome]) },
          { label: 'Ownership', value: r.ownershipReclaimed ? 'Taken back by ORBES from its buyer' : 'Not registered by its buyer' },
          { label: 'Note', value: h('span', { class: 'prewrap' }, r.note) },
          { label: 'When', value: formatDateTime(r.at) },
        ]),
        { id: 'order-return' },
      )
    : null;

  // ── The documents ────────────────────────────────────────────────────────
  const pdf = (doc: OrderDocument) => {
    const b = button('PDF', { kind: 'ghost', testId: 'document-pdf' });
    b.setAttribute('aria-label', `${DOCUMENT_LABELS[doc.kind]} ${doc.number}, PDF`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        saveDownload(await ctx.api.invoicePdf(doc.id));
      } catch (e) {
        notifyError(e, 'The document could not be produced.');
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const documentsSection = section(
    'Documents',
    table(
      [
        { label: 'Number', cell: (x) => mono(x.number), kind: ['nowrap'] },
        { label: 'Document', cell: (x) => DOCUMENT_LABELS[x.kind] },
        { label: 'Issued', cell: (x) => formatDateTime(x.issuedAt), kind: ['nowrap'] },
        { label: 'Total', cell: (x) => formatMoney(x.totalMinor, x.currency), kind: ['nowrap', 'num'] },
        { label: '', cell: (x) => pdf(x), kind: ['actions'] },
      ],
      o.invoices,
      { caption: 'Documents', empty: o.status === 'RESERVED' ? 'Its invoice is issued once it is paid.' : 'No document.' },
    ),
    { id: 'order-documents', tools: [linkButton('All invoices', href('invoices'), 'ghost')] },
  );

  // ── The history ──────────────────────────────────────────────────────────
  const historySection = section(
    'History',
    table(
      [
        { label: 'When', cell: (e) => formatDateTime(e.at), kind: ['nowrap'] },
        { label: 'Change', cell: (e) => EVENT_LABELS[e.action] ?? e.action },
        { label: 'Step', cell: (e) => statusMark(humanize(e.status), toneOf('order', e.status)), kind: ['nowrap'] },
        { label: 'Note', cell: (e) => (e.note ? h('span', { class: 'prewrap' }, e.note) : '—'), kind: ['wide'] },
        { label: 'By', cell: (e) => eventActor(e, d.actors), kind: ['nowrap'] },
      ],
      [...o.events].reverse(),
      { caption: 'History', empty: 'No change yet.' },
    ),
    { id: 'order-history' },
  );

  const sections: Child[] = [stepSection, orderSection, buyerSection, pieceSection, shipmentSection, returnSection, documentsSection, historySection];
  return h(
    'div',
    { class: 'view view--order' },
    pageHeader({
      eyebrow: 'Clients · Orders',
      title: o.reference,
      identifier: true,
      lead: giftHeaderLine(o) ?? `${o.release?.title ?? CHANNEL_LABELS[o.channel]} · ${o.model.name} · ${d.account.email}`,
      actions: [linkButton('Packing slip', href('packingSlip', { orderId: o.id }), 'secondary'), linkButton('All orders', href('orders'), 'ghost')],
    }),
    ...sections,
  );
}
