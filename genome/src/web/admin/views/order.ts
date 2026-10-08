/**
 * An order's page, `#/orders/:orderId` (plan LIVE RELEASE+, The console → Orders), from its card on the board.
 *
 *  - Its step: RESERVED → PAID → SHIPPED → DELIVERED with the time each was reached (or CANCELLED, or RETURNED), its
 *    time in its step, and whether it is late (M3) and why; the next steps (OPERATOR): MARK PAID (once priced: its
 *    invoice is issued), MARK DELIVERED (an order shipped before Logistics packed its parcel), CANCEL (with a note; a
 *    credit note once paid).
 *  - The order: its channel, release, the collector (the email masked for an AUDITOR) and the reference they hold, the
 *    model, size, price, add-ons, surprise and engraving text; EDIT (OPERATOR): a draw's or a salon's size, price and
 *    currency, any order's engraving text (decision 31).
 *  - Its welcome gifts and its credit (plan NEXT-NINE, BP-19 T5): the GIFT orders travelling with it, one row each (a
 *    size to choose: MARK PAID waits for it), the client's credit usable now and the credit taken off it; APPLY CREDIT and
 *    REMOVE CREDIT (OPERATOR, while RESERVED). A GIFT order says its tier and the order it travels with; its size, To be
 *    confirmed, is chosen among its model's (CHOOSE SIZE). An order travelling with another ships in that order's parcel
 *    (plan NEXT LOT §3.5.6.6): its Shipping section is the parcel's.
 *  - Its buyer: the name and address entered by Client Services (masked for an AUDITOR); EDIT (OPERATOR).
 *  - Its piece: the location it is served from (CHANGE: what it holds moves), what it holds (In stock at …, or
 *    Awaiting stock), the piece bound to it by the agent's packing scan (plan NEXT LOT §3.5.4.4).
 *  - Shipping (plan NEXT LOT §3.5.4.4): the agent's steps on its parcel (views/shipping.ts): Start packing, the
 *    checklist, the card's scan, the photo (View the photo), Packed, Ship with a declared value per order of the parcel
 *    (ORBES only), Mark delivered, Report a parcel problem, the parcel's steps; the declared value kept.
 *  - Order case (§3.5.4.4, §3.6.D): its returns, size exchanges and parcel problems; OPEN A RETURN (a return or a size
 *    exchange, sizes in stock only, a reason and a note); DECIDE once the agent has the parcel back (a lost parcel by an
 *    ADMIN as it stands): refund, ship the other size or another piece, the piece back to stock at a location or, by an
 *    ADMIN, to the archive; back to stock, the claim code of the piece's new card shown once, with its card to
 *    download; CANCEL THE ORDER CASE with a note.
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
  giftRows,
  giftSavedSizeHint,
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
  shipWaitsFor,
  sizeText,
  shippingLine,
  termsChange,
  termsProblem,
  termsValues,
  viewHolds,
} from '../model/orders.js';
import {
  canOpenReturn,
  CASE_REASON_LABELS,
  CASE_STATUS_LABELS,
  CASE_TEXT,
  caseActions,
  caseLines,
  decideInput,
  decideProblem,
  decidesPiece,
  openCaseInput,
  openCaseProblem,
  ORDER_CASE_LIMITS,
  outcomeOptions,
  pastReturnWindow,
} from '../model/order-cases.js';
import { CASE_KIND_LABELS } from '../model/logistics.js';
import { can } from '../model/permissions.js';
import { noCardNotice, orderClaimCodeRow } from '../model/product.js';
import { toneOf } from '../model/tone.js';
import { href, productHref } from '../router.js';
import { ORDER_CURRENCIES, type OrderCaseRecord, type OrderDetail, type OrderDocument, type OrderStatus, type OrderTransitionInput, type ShippingOrderView, type StockLocation } from '../types.js';
import { button, defList, linkButton, mono, pageHeader, section, statusMark, table, type DefRow } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { claimCodeDialog } from '../ui/claim-code.js';
import { saveDownload } from '../ui/download.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';
import { parcelSections } from './shipping.js';

/** A return's new claim code, as its dialog has always said it (ui/claim-code.ts; plan NEXT LOT §3.4 keeps it unchanged). */
export const RETURN_CLAIM_TEXT = 'The piece’s next buyer registers it with this code; the card that left with it no longer does. Shown once: download its certificate card now. Only its hash is kept.';

/** The steps in order, as the strip shows them. */
const STEPS: readonly OrderStatus[] = ['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED'];

export async function orderView(ctx: ViewContext): Promise<HTMLElement> {
  const id = ctx.route.params.orderId ?? '';
  const [d, locations, parcel] = await Promise.all([ctx.api.order(id), ctx.api.locations(), ctx.api.parcel(id)]);
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
        o.reservation === 'STOCK'
          ? 'The order reads CANCELLED. The piece it holds in stock is free again, and goes to the next order waiting for it.'
          : 'The order reads CANCELLED.',
      ),
      fields: [noteField(true, 'Why, for Client Services: kept in the order’s history.')],
      validate: (v) => noteProblem(v.note, true),
      live: () => (o.status === 'PAID' ? h('p', { class: 'dialog__text' }, 'It was paid: a credit note cancels its invoice.') : []),
      confirmLabel: 'Cancel the order',
      submit: async (v) => step({ to: 'CANCELLED', note: v.note.trim() }),
    }).then(done('Order cancelled.'));
  const stepTools = [
    acts.pay ? button('Mark paid', { kind: 'primary', testId: 'order-pay', onClick: pay }) : null,
    // Shipped before Logistics packed its parcel: delivered from here; a parcel's own Mark delivered is in Shipping.
    acts.deliver && !parcel.shipment ? button('Mark delivered', { kind: 'primary', testId: 'order-deliver', onClick: deliver }) : null,
    acts.cancel ? button('Cancel', { kind: 'danger', testId: 'order-cancel', onClick: cancel }) : null,
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
      fields.push({ name: 'engraving', label: 'Engraving text', maxlength: ORDER_LIMITS.engraving, value: v.engraving, hint: 'As it is to be engraved, on one line; empty for none. The agent engraves it at packing, as the packing slip says.' });
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
      body: [
        h('p', { class: 'dialog__text' }, 'The welcome gift’s size, confirmed with the collector. The order then holds a piece of that size, or one is made for it.'),
        // AC-01: the collector's saved size, a hint only: nothing is chosen for Client Services.
        giftSavedSizeHint(o) ? h('p', { class: 'dialog__text', data: { testid: 'order-gift-saved-size' } }, giftSavedSizeHint(o)) : null,
      ],
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
    ...giftRows(o).map((g) => ({ label: g.label, value: h('a', { class: 'idlink', attrs: { href: href('order', { orderId: g.id }) }, data: { testid: 'order-gift' } }, g.line) })),
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
          ? 'The piece it holds is released here and one is taken at the new location, or the order waits there for supplier stock.'
          : o.reservation === 'AWAITING'
            ? 'The order takes a piece at the new location, or waits there for supplier stock.'
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
  const pieceRows: DefRow[] = [
    { label: 'Location', value: o.location.name },
    ...(o.status === 'RESERVED' || o.status === 'PAID' ? [{ label: 'Holds', value: h('span', { data: { testid: 'order-holds' } }, viewHolds(o)) }] : []),
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
    // NEW CLAIM CODE (plan NEXT LOT §3.4): Client Services answers the buyer from here; never the code.
    ...(d.claimCode
      ? [
          {
            label: 'Claim code',
            value: h('span', { data: { testid: 'order-claim-code' } }, statusMark(orderClaimCodeRow(d.claimCode).value, d.claimCode.status === 'WITHDRAWN' ? 'muted' : 'outline')),
            note: orderClaimCodeRow(d.claimCode).note,
          },
        ]
      : []),
  ];
  const pieceTools = [
    acts.location ? button('Change location', { kind: 'ghost', testId: 'order-location', onClick: moveTo }) : null,
  ].filter((b): b is HTMLButtonElement => b !== null);
  // Read from the piece (claimCard), so an order with no new claim code of its own shows it too (§3.4.3, §3.4.7).
  const noCard = d.claimCard?.cardNeeded && d.claimCard.cardNeededOrder ? h('p', { class: 'notice', data: { testid: 'order-claim-notice' } }, noCardNotice(d.claimCard.cardNeededOrder.reference)) : null;
  const pieceSection = section('Piece', noCard ? [noCard, defList(pieceRows)] : defList(pieceRows), { id: 'order-piece', tools: pieceTools });

  // ── Shipping (plan NEXT LOT §3.5.4.4) ───────────────────────────────────
  // The agent's steps on the order's parcel, from here for ORBES; a declared value per order of the parcel, in its currency.
  const declared = await declaredOf(ctx, o, parcel);
  // An order shipped before Logistics (no parcel's shipment, §3.5.8) keeps its Shipment section as it was: its carrier,
  // its tracking number with its link and its declared value.
  const shippingSections = !parcel.shipment && o.shipment
    ? [
        section(
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
        ),
      ]
    : parcel.shipment || parcel.step === 'READY_TO_PACK' || o.status === 'SHIPPED' || o.status === 'DELIVERED'
      ? parcelSections(ctx, parcel, {
          only: 'shipping',
          ...(can(ctx.session.admin.role, 'manageOrders') ? { declared } : {}),
          rows: o.shipment ? [{ label: 'Declared value', value: h('span', { data: { testid: 'order-declared' } }, o.shipment.declaredValueMinor !== null && o.currency ? formatMoney(o.shipment.declaredValueMinor, o.currency) : 'None') }] : [],
        })
      : [];

  // ── Order case (§3.5.4.4, §3.6.D) ───────────────────────────────────────
  const caseSection = orderCaseSection(ctx, d, locations.items, eyebrow);

  // ── The return ───────────────────────────────────────────────────────────
  const r = o.return;
  const returnSection = r
    ? section(
        'Return',
        defList([
          { label: 'The piece', value: h('span', { data: { testid: 'return-outcome' } }, r.location ? `${RETURN_LABELS[r.outcome]} · ${r.location.name}` : RETURN_LABELS[r.outcome]) },
          { label: 'Ownership', value: r.ownershipReclaimed ? 'Taken back by ORBES from its buyer' : 'Not registered by its buyer' },
          // Withheld (null) from an AUDITOR when the return was decided from an order case.
          ...(r.note !== null ? [{ label: 'Note', value: h('span', { class: 'prewrap' }, r.note) }] : []),
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

  const sections: Child[] = [stepSection, orderSection, buyerSection, pieceSection, ...shippingSections, caseSection, returnSection, documentsSection, historySection];
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

/** The declared value's fields of Ship: one per order of the parcel, each in its own order's currency (ORBES only). */
async function declaredOf(ctx: ViewContext, o: OrderDetail['order'], parcel: ShippingOrderView): Promise<{ orderId: string; reference: string; currency: string | null }[]> {
  if (parcel.shipment?.status !== 'PACKED') return [];
  const others = await Promise.all(parcel.orders.filter((x) => x.orderId !== o.id).map((x) => ctx.api.order(x.orderId)));
  const byId = new Map([[o.id, o.currency], ...others.map((x) => [x.order.id, x.order.currency] as const)]);
  return parcel.orders.map((x) => ({ orderId: x.orderId, reference: x.reference, currency: byId.get(x.orderId) ?? null }));
}

/** The Order case section: each case of the order, the newest first, with Decide and Cancel; Open a return. */
function orderCaseSection(ctx: ViewContext, d: OrderDetail, locations: StockLocation[], eyebrow: string): HTMLElement {
  const role = ctx.session.admin.role;
  const o = d.order;
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };
  const locationOptions = [{ value: '', label: 'Choose a location' }, ...locations.map((l) => ({ value: l.id, label: l.name }))];
  const open = () =>
    void openDialog({
      title: CASE_TEXT.open,
      eyebrow,
      body: [
        h('p', { class: 'dialog__text' }, CASE_TEXT.openText),
        pastReturnWindow(o.deliveredAt, ctx.now()) ? h('p', { class: 'dialog__text', data: { testid: 'case-late' } }, CASE_TEXT.late) : null,
      ],
      fields: [
        {
          name: 'kind',
          label: 'Kind',
          kind: 'select',
          required: true,
          options: [
            { value: 'RETURN', label: 'Return' },
            ...(d.exchangeSizes.length ? [{ value: 'EXCHANGE', label: 'Size exchange' }] : []),
          ],
          value: 'RETURN',
        },
        {
          name: 'exchangeSkuId',
          label: 'New size',
          kind: 'select',
          options: [{ value: '', label: 'Choose a size' }, ...d.exchangeSizes.map((x) => ({ value: x.skuId, label: x.selectable ? `${x.label} · ${x.available} in stock` : `${x.label} · ${CASE_TEXT.sizeOut}`, disabled: !x.selectable }))],
          value: '',
          hint: 'Only the sizes in stock can be chosen.',
          shown: (v) => v.kind === 'EXCHANGE',
        },
        { name: 'reason', label: 'Reason', kind: 'select', required: true, options: [{ value: '', label: 'Choose' }, ...Object.entries(CASE_REASON_LABELS).map(([value, label]) => ({ value, label }))], value: '' },
        { name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: ORDER_CASE_LIMITS.note, hint: 'Client Services’ words: what the collector asked.' },
      ],
      validate: (v) => openCaseProblem(v, d.exchangeSizes),
      confirmLabel: CASE_TEXT.open,
      submit: async (v) => {
        await ctx.api.openOrderCase(o.id, openCaseInput(v));
      },
    }).then(done(CASE_TEXT.opened));
  // The sizes out of stock stay listed, never chosen.
  const decide = (c: OrderCaseRecord) => {
    let result: Awaited<ReturnType<typeof ctx.api.decideOrderCase>> | null = null;
    const archive = can(role, 'archiveReturn');
    void openDialog({
      title: CASE_TEXT.decide,
      eyebrow: `${eyebrow} · ${CASE_KIND_LABELS[c.kind]}`,
      body: [
        c.received ? h('p', { class: 'dialog__text', data: { testid: 'case-received-state' } }, `The agent recorded the piece: ${c.received.pieceState === 'OK' ? 'OK' : 'Damaged'}.${c.received.note ? ` ${c.received.note}` : ''}`) : null,
        c.kind === 'LOST' ? h('p', { class: 'dialog__text' }, CASE_TEXT.lostText) : null,
      ],
      fields: [
        { name: 'decision', label: 'Outcome', kind: 'select', required: true, options: [{ value: '', label: 'Choose' }, ...outcomeOptions(c.kind)], value: '' },
        ...(decidesPiece(c.kind)
          ? [
              {
                name: 'pieceTo',
                label: 'The piece',
                kind: 'select' as const,
                required: true,
                options: [{ value: '', label: 'Choose' }, { value: 'RESTOCKED', label: RETURN_LABELS.RESTOCKED }, ...(archive ? [{ value: 'ARCHIVED', label: RETURN_LABELS.ARCHIVED }] : [])],
                value: '',
              },
              { name: 'locationId', label: 'Location', kind: 'select' as const, options: locationOptions, value: o.location.id, hint: 'Back to stock: where it is counted again.', shown: (v: Record<string, string>) => v.pieceTo === 'RESTOCKED' },
            ]
          : []),
        { name: 'note', label: 'Note', kind: 'textarea', maxlength: ORDER_CASE_LIMITS.decisionNote, required: c.kind === 'RETURN' || c.kind === 'EXCHANGE' },
      ],
      live: (v) => (v.decision === 'RESHIP' && (c.kind === 'LOST' || c.kind === 'DAMAGED') ? h('p', { class: 'dialog__text' }, CASE_TEXT.reshipText) : []),
      danger: (v) => v.pieceTo === 'ARCHIVED' || c.kind === 'LOST',
      phrase: (v) => (v.pieceTo === 'ARCHIVED' ? 'ARCHIVE' : null),
      validate: (v) => decideProblem(c, v),
      confirmLabel: CASE_TEXT.decide,
      submit: async (v) => {
        result = await ctx.api.decideOrderCase(c.id, decideInput(c, v));
      },
    }).then(async (v) => {
      const r = result as Awaited<ReturnType<typeof ctx.api.decideOrderCase>> | null;
      if (!v || !r) return;
      // Back to stock: each piece's new claim code, once (only its hash is kept), with its card to download.
      const codes = r.claimCode && r.productId ? [{ productId: r.productId, claimCode: r.claimCode }] : (r.claimCodes ?? []);
      for (const x of codes) await claimCodeDialog(ctx, { productId: x.productId, code: x.claimCode, text: RETURN_CLAIM_TEXT, testId: 'return-card' });
      done(CASE_TEXT.decided)(true);
    });
  };
  const cancel = (c: OrderCaseRecord) =>
    void openDialog({
      title: CASE_TEXT.cancel,
      eyebrow: `${eyebrow} · ${CASE_KIND_LABELS[c.kind]}`,
      body: h('p', { class: 'dialog__text' }, CASE_TEXT.cancelText),
      fields: [{ name: 'note', label: 'Note', kind: 'textarea', required: true, maxlength: ORDER_CASE_LIMITS.cancelNote }],
      validate: (v) => noteProblem(v.note, true),
      confirmLabel: CASE_TEXT.cancel,
      submit: async (v) => {
        await ctx.api.cancelOrderCase(c.id, v.note.trim());
      },
    }).then(done(CASE_TEXT.cancelled));
  const blocks = d.orderCases.map((c) => {
    const a = caseActions(c, role);
    return h(
      'div',
      { class: 'order-case', data: { testid: 'order-case' } },
      h(
        'div',
        { class: 'proposal__head' },
        h('span', { data: { testid: 'order-case-kind' } }, statusMark(CASE_KIND_LABELS[c.kind], c.kind === 'LOST' || c.kind === 'DAMAGED' || c.kind === 'BACK_TO_SENDER' ? 'alert' : 'outline')),
        h('span', { data: { testid: 'order-case-status' } }, statusMark(CASE_STATUS_LABELS[c.status], c.status === 'CLOSED' || c.status === 'CANCELLED' ? 'muted' : 'solid')),
        h(
          'span',
          { class: 'row-actions' },
          a.decide ? button(CASE_TEXT.decide, { kind: 'primary', testId: 'order-case-decide', onClick: () => decide(c) }) : null,
          a.cancel ? button(CASE_TEXT.cancel, { kind: 'ghost', testId: 'order-case-cancel', onClick: () => cancel(c) }) : null,
        ),
      ),
      defList(caseLines(c).map((l) => ({ label: l.label, value: h('span', { class: 'prewrap' }, l.value) }))),
    );
  });
  return section(CASE_TEXT.title, blocks.length ? blocks : h('p', { class: 'panel__text' }, CASE_TEXT.empty), {
    id: 'order-case',
    tools: canOpenReturn(o, d.orderCases, role) ? [button(CASE_TEXT.open, { kind: 'secondary', testId: 'order-return', onClick: open })] : [],
  });
}
