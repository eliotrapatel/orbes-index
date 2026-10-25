/**
 * The add-ons in the console (macro scope of 2026-10-20, K48 D1 and D2; lot M3 plan §4.3, step M3.11), the parts other
 * pages place:
 *
 *  - Catalogue → Add-ons (views/catalogue.ts, after Models): the table (name and line, SKU code, the ENGRAVING mark and
 *    what it was converted from, its type WITH STOCK or SERVICE, prices, where it is offered, how many releases pick it,
 *    supplier, weight, available and minimum per location or No stock, ACTIVE / SET ASIDE with its Shopify link); New
 *    add-on and Edit (its type at the creation only, a service without supplier; name, line, SKU code at the creation
 *    only, supplier, weight, a price per house currency, the four switches, the engraving and its most characters on a
 *    service; lot Q2, step Q2.7, D3, D4, D12, N3), Set aside / Reinstate, Shopify (the ids pasted back, as a model's).
 *    OPERATOR writes; every role that reads the catalogue reads.
 *  - A release's pick (lot Q2, step Q2.7, D3, N7): the Add-ons offered tick boxes of a LIVE RELEASE, its after-room and a
 *    draw (views/live.ts, views/club.ts, views/drop.ts), from the add-ons the release may offer and why not.
 *  - The order page's Add-ons (views/order.ts): each unit grouped (name × units, price, who added it, status, a
 *    service's held nowhere), Add an add-on (the add-ons in stock at the order's location in its currency and the
 *    services, 1 to 3 units, the total) and Remove one unit (OPERATOR, until the parcel is packed); after PAID, their
 *    invoice and credit notes in Documents.
 *  - A SKU's first cell in Logistics and the supplier orders: its model, or its add-on marked ADD-ON.
 *  - The draw's Confirm and the salon's Accept: the collector's choices, and after, what was left out.
 * The words are in model/addons.ts; the server audits each change.
 */
import { h, type Child } from '../../shared/dom.js';
import {
  ADDON_KIND_LABELS,
  ADDON_KIND_OPTIONS,
  ADDON_LIMITS,
  ADDON_SKU_TEXT,
  ADDON_SWITCHES,
  ADDON_STATUS_LABELS,
  addAddonProblem,
  addAddonTotal,
  addedByText,
  addonChange,
  addonConvertedLines,
  addonCreateInput,
  addonEngravingText,
  addonFormValues,
  addonGroups,
  addonStockLines,
  addonOfferOptions,
  addonOfferedMarks,
  addonPricesText,
  addonProblem,
  addonReleasesText,
  ADDONS_TEXT,
  addonShopifyInput,
  addonShopifyProblem,
  addonShopifyStatus,
  addonShopifyValues,
  addonState,
  addonSupplierOptions,
  addonUnchanged,
  addonWeightText,
  canAddAddon,
  canRemoveAddon,
  CHOICES_TEXT,
  choiceLines,
  groupPriceText,
  heldLine,
  isAddonSku,
  isEngravingForm,
  isServiceForm,
  leftOutLines,
  noOfferText,
  ORDER_ADDONS_TEXT,
  orderTakesAddons,
  PICK_TEXT,
  pickOptions,
  pickTicked,
  removeAddonText,
  returnedLine,
  skuOwnerName,
  UNIT_OPTIONS,
  unitsWords,
  type AddonForm,
  type AddonGroup,
  type PickMoment,
} from '../model/addons.js';
import { parisDateTime } from '../model/links.js';
import { can } from '../model/permissions.js';
import { HOUSE_CURRENCIES, type AddonPickable, type AddonView, type ChosenAddon, type LeftOutAddon, type LogisticsSku, type OrderAddonOffer, type OrderDetail, type PickedAddon, type Supplier } from '../types.js';
import { button, section, statusMark, table, type Column } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

const lines = (items: readonly string[], testid?: string): HTMLElement =>
  h('span', { class: 'addon-lines', data: testid ? { testid } : undefined }, ...items.map((x) => h('span', { class: 'addon-lines__line' }, x)));

// ── Catalogue → Add-ons ────────────────────────────────────────────────────

/** The Add-ons section of the Catalogue. */
export function addonsSection(ctx: ViewContext, addons: readonly AddonView[], suppliers: readonly Supplier[]): HTMLElement {
  const role = ctx.session.admin.role;
  const canEdit = can(role, 'editCatalog');
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  const edit = (a: AddonView | null) => {
    const values = addonFormValues(a);
    // Fields and prices go by two routes: once the fields are saved, a refusal of the prices does not send them again.
    let patched: string | null = null;
    // Lot Q2, step Q2.7 (D4, N13): the type is chosen at the creation only; an edit reads the add-on's.
    const typed = (v: Record<string, string>): Record<string, string> => (a ? { ...v, kind: a.kind } : v);
    const service = (v: Record<string, string>) => isServiceForm(typed(v));
    const fields: DialogField[] = [
      ...(a ? [] : [{ name: 'kind', label: 'Type', kind: 'select' as const, required: true, options: ADDON_KIND_OPTIONS.map((x) => ({ ...x })), value: values.kind, hint: ADDONS_TEXT.kindHint }]),
      { name: 'name', label: 'Name', required: true, maxlength: ADDON_LIMITS.name, value: values.name, hint: ADDONS_TEXT.nameHint },
      { name: 'line', label: 'Line', maxlength: ADDON_LIMITS.line, value: values.line, hint: ADDONS_TEXT.lineHint },
      ...(a ? [] : [{ name: 'skuCode', label: 'SKU code', required: true, maxlength: ADDON_LIMITS.skuCode, value: values.skuCode, hint: ADDONS_TEXT.skuHint }]),
      // A service has no supplier, no stock and no warehouse (D4): its Supplier is hidden.
      { name: 'supplierId', label: 'Supplier', kind: 'select' as const, options: addonSupplierOptions(suppliers, a), value: values.supplierId, hint: ADDONS_TEXT.supplierHint, shown: (v) => !service(v) },
      // The label in the display face carries no figure: the unit is said in the hint.
      { name: 'weightG', label: 'Weight', maxlength: 6, value: values.weightG, hint: ADDONS_TEXT.weightHint },
      ...HOUSE_CURRENCIES.map((c, i) => ({ name: c, label: `Price in ${c}`, maxlength: 12, value: values[c], hint: ADDONS_TEXT.priceHint(c, i === 0) })),
      // D3: the four moments it is offered at, on by default.
      ...ADDON_SWITCHES.map((x, i) => ({
        name: x.key,
        label: x.label,
        kind: 'checkbox' as const,
        value: values[x.key],
        ...(i === 0 ? { hint: ADDONS_TEXT.offeredHint } : x.key === 'orders' ? { hint: ADDONS_TEXT.ordersHint } : {}),
      })),
      // D4, D12, N3: the engraving, a service's, and the most characters its words take.
      { name: 'engraving', label: ADDONS_TEXT.engraving, kind: 'checkbox', value: values.engraving, hint: ADDONS_TEXT.engravingHint, shown: service },
      { name: 'textMax', label: ADDONS_TEXT.textMax, maxlength: 2, value: values.textMax, hint: ADDONS_TEXT.textMaxHint, shown: (v) => isEngravingForm(typed(v)) },
    ];
    void openDialog({
      title: a ? ADDONS_TEXT.editTitle : ADDONS_TEXT.addTitle,
      eyebrow: a ? a.name : ADDONS_TEXT.eyebrow,
      body: a
        ? [
            h('p', { class: 'dialog__text', data: { testid: 'addon-sku-fixed' } }, ADDONS_TEXT.skuFixed(a.sku.code)),
            h('p', { class: 'dialog__text', data: { testid: 'addon-kind-fixed' } }, ADDONS_TEXT.kindFixed(ADDON_KIND_LABELS[a.kind])),
          ]
        : undefined,
      fields,
      validate: (v) => addonProblem(typed(v), !a) ?? (a && addonUnchanged(addonChange(a, v as AddonForm)) ? ADDONS_TEXT.unchanged : null),
      confirmLabel: a ? 'Save' : 'Add',
      submit: async (v) => {
        if (!a) {
          await ctx.api.createAddon(addonCreateInput(v as AddonForm));
          return;
        }
        const change = addonChange(a, v as AddonForm);
        const sent = JSON.stringify(change.fields);
        if (Object.keys(change.fields).length > 0 && sent !== patched) {
          await ctx.api.updateAddon(a.id, change.fields);
          patched = sent;
        }
        if (Object.keys(change.prices).length > 0) await ctx.api.setAddonPrices(a.id, change.prices);
      },
    }).then(done(a ? ADDONS_TEXT.saved : ADDONS_TEXT.added));
  };

  const toggle = (a: AddonView) =>
    void openDialog({
      title: a.active ? ADDONS_TEXT.setAsideTitle : ADDONS_TEXT.reinstateTitle,
      eyebrow: a.name,
      body: h('p', { class: 'dialog__text' }, a.active ? ADDONS_TEXT.setAsideText : ADDONS_TEXT.reinstateText),
      confirmLabel: a.active ? ADDONS_TEXT.setAside : ADDONS_TEXT.reinstate,
      submit: async () => {
        if (a.active) await ctx.api.setAddonAside(a.id);
        else await ctx.api.reinstateAddon(a.id);
      },
    }).then(done(a.active ? ADDONS_TEXT.setAsideDone : ADDONS_TEXT.reinstateDone));

  // S5: one Shopify product of one variant per add-on, its ids pasted back.
  const shopify = (a: AddonView) =>
    void openDialog({
      title: ADDONS_TEXT.shopifyTitle,
      eyebrow: a.name,
      body: h('p', { class: 'dialog__text' }, ADDONS_TEXT.shopifyText(a.sku.code)),
      fields: [
        { name: 'productId', label: 'Product', maxlength: 300, value: addonShopifyValues(a).productId, hint: 'Empty: the add-on is no longer linked.' },
        { name: 'variantId', label: 'Variant', maxlength: 300, value: addonShopifyValues(a).variantId, hint: `SKU ${a.sku.code}` },
      ],
      validate: (v) => addonShopifyProblem(a, v),
      confirmLabel: 'Save the ids',
      submit: async (v) => {
        await ctx.api.linkAddonShopify(a.id, addonShopifyInput(v));
      },
    }).then(done(ADDONS_TEXT.shopifySaved));

  const columns: Column<AddonView>[] = [
    // Its name, its SKU code under it (as Logistics names a SKU), the ENGRAVING mark, its line, what it was converted from.
    {
      label: 'Add-on',
      cell: (a) => {
        const engraving = addonEngravingText(a);
        const converted = addonConvertedLines(a);
        return h(
          'span',
          null,
          h('span', { data: { testid: 'addon-name' } }, a.name),
          h('span', { class: 'cell-sub mono', data: { testid: 'addon-sku' } }, a.sku.code),
          engraving ? h('span', { class: 'cell-sub', data: { testid: 'addon-engraving' } }, statusMark(engraving, 'outline')) : null,
          a.line ? h('span', { class: 'cell-details', data: { testid: 'addon-line' } }, a.line) : null,
          ...converted.map((x) => h('span', { class: 'cell-details', data: { testid: 'addon-converted' } }, x)),
        );
      },
      kind: ['wide'],
    },
    { label: 'Type', cell: (a) => h('span', { data: { testid: 'addon-kind' } }, ADDON_KIND_LABELS[a.kind]), kind: ['nowrap'] },
    { label: 'Prices', cell: (a) => lines(addonPricesText(a), 'addon-prices'), kind: ['nowrap'] },
    { label: 'Offered', cell: (a) => h('span', { class: a.active ? undefined : 'soft' }, lines(addonOfferedMarks(a), 'addon-offered')), kind: ['nowrap'] },
    { label: 'Releases', cell: (a) => h('span', { class: a.releases > 0 ? undefined : 'soft', data: { testid: 'addon-releases' } }, addonReleasesText(a)), kind: ['num'] },
    { label: 'Supplier', cell: (a) => (a.supplier ? a.supplier.name : h('span', { class: 'soft' }, 'None')) },
    { label: 'Weight', cell: (a) => h('span', { class: a.weightG === null ? 'soft' : undefined, data: { testid: 'addon-weight' } }, addonWeightText(a)), kind: ['nowrap'] },
    {
      label: 'Available · minimum',
      cell: (a) => (a.kind === 'SERVICE' ? h('span', { class: 'soft', data: { testid: 'addon-stock' } }, ADDONS_TEXT.noStock) : lines(addonStockLines(a), 'addon-stock')),
      kind: ['nowrap'],
    },
    {
      label: 'Status · Shopify',
      cell: (a) =>
        h(
          'span',
          null,
          h('span', { data: { testid: 'addon-state' } }, statusMark(addonState(a), a.active ? 'solid' : 'muted')),
          h('span', { class: 'cell-sub', data: { testid: 'addon-shopify' } }, addonShopifyStatus(a)),
        ),
      kind: ['nowrap'],
    },
    ...(canEdit
      ? [
          {
            label: '',
            cell: (a: AddonView) =>
              h(
                'span',
                { class: 'row-actions' },
                button('Edit', { kind: 'ghost', testId: 'addon-edit', onClick: () => edit(a) }),
                button(ADDONS_TEXT.shopify, { kind: 'ghost', testId: 'addon-shopify-ids', onClick: () => shopify(a) }),
                button(a.active ? ADDONS_TEXT.setAside : ADDONS_TEXT.reinstate, { kind: 'ghost', testId: 'addon-toggle', onClick: () => toggle(a) }),
              ),
            kind: ['actions' as const, 'wrap' as const],
          },
        ]
      : []),
  ];

  return section(
    ADDONS_TEXT.title,
    [h('p', { class: 'panel__text' }, ADDONS_TEXT.lead), h('div', { class: 'addons__table', data: { testid: 'addons-table' } }, table(columns, [...addons], { empty: ADDONS_TEXT.empty, caption: ADDONS_TEXT.title }))],
    { id: 'addons', tools: canEdit ? [button(ADDONS_TEXT.add, { kind: 'ghost', testId: 'addon-add', onClick: () => edit(null) })] : [] },
  );
}

// ── A release's pick ───────────────────────────────────────────────────────

/**
 * A release's Add-ons offered tick boxes (lot Q2, step Q2.7, D3, N7): its pick first, then the other active add-ons, the
 * ones it cannot offer disabled with why; for a new release (`picked` null), every one it may offer ticked.
 */
export function pickField(
  name: string,
  pickable: readonly AddonPickable[],
  picked: readonly PickedAddon[] | null,
  moment: PickMoment,
  currency: string | null,
  shown?: (v: Record<string, string>) => boolean,
): DialogField {
  const options = pickOptions(pickable, picked, moment, currency);
  return {
    name,
    label: PICK_TEXT.label,
    kind: 'checklist',
    options,
    value: pickTicked(pickable, picked, currency),
    hint: options.length ? (moment === 'LIVE' ? PICK_TEXT.liveHint : PICK_TEXT.drawHint) : PICK_TEXT.empty,
    ...(shown ? { shown } : {}),
  };
}

// ── A SKU's first cell ─────────────────────────────────────────────────────

/** A SKU's model, or its add-on with a line under it (ADD-ON, or what is said of it there). */
export function skuOwnerCell(sku: Pick<LogisticsSku, 'model' | 'addon'>, sub: string = ADDON_SKU_TEXT.mark): Child {
  if (!isAddonSku(sku)) return skuOwnerName(sku);
  return h('span', { data: { testid: 'sku-addon' } }, skuOwnerName(sku), h('span', { class: 'cell-sub', data: { testid: 'sku-addon-sub' } }, sub));
}

// ── The order page's Add-ons ───────────────────────────────────────────────

/** The order page's Add-ons part; null on an order that takes none and holds none (a welcome gift, a size exchange, a Shopify order). */
export function orderAddonsSection(ctx: ViewContext, d: OrderDetail, eyebrow: string): HTMLElement | null {
  const o = d.order;
  const units = o.addonItems ?? [];
  if (units.length === 0 && !orderTakesAddons(o)) return null;
  const manage = can(ctx.session.admin.role, 'manageOrders');
  const groups = addonGroups(units);
  const invoiceNumber = (id: string | null) => (id ? (o.invoices.find((i) => i.id === id)?.number ?? null) : null);
  const done = (msg: string) => (r: unknown) => {
    if (!r) return;
    notify(msg);
    ctx.reload();
  };

  const add = async (b: HTMLButtonElement) => {
    let offer: OrderAddonOffer;
    b.disabled = true;
    try {
      offer = await ctx.api.orderAddonOffer(o.id);
    } catch (e) {
      notifyError(e);
      return;
    } finally {
      b.disabled = false;
    }
    if (offer.offer.length === 0) {
      void openDialog({
        title: ORDER_ADDONS_TEXT.noneTitle,
        eyebrow,
        body: h('p', { class: 'dialog__text', data: { testid: 'order-addon-none' } }, noOfferText(offer, o.location.name)),
        confirmLabel: ORDER_ADDONS_TEXT.close,
        noCancel: true,
      });
      return;
    }
    void openDialog({
      title: ORDER_ADDONS_TEXT.add,
      eyebrow,
      body: h('p', { class: 'dialog__text' }, ORDER_ADDONS_TEXT.addText, offer.paid ? h('span', { data: { testid: 'order-addon-paid' } }, ` ${ORDER_ADDONS_TEXT.paidAdd}`) : null),
      fields: [
        { name: 'addonId', label: 'Add-on', kind: 'select', required: true, options: [{ value: '', label: 'Choose an add-on' }, ...addonOfferOptions(offer)], value: offer.offer.length === 1 ? offer.offer[0]!.addonId : '' },
        { name: 'units', label: 'Units', kind: 'select', required: true, options: UNIT_OPTIONS.map((x) => ({ ...x })), value: '1' },
      ],
      live: (v) => {
        const total = addAddonTotal(offer, v);
        return total ? h('p', { class: 'dialog__text', data: { testid: 'order-addon-total' } }, `Total: ${total}`) : [];
      },
      validate: (v) => addAddonProblem(offer, v),
      confirmLabel: 'Add',
      submit: async (v) => {
        await ctx.api.addOrderAddon(o.id, { addonId: v.addonId, units: Number(v.units) });
      },
    }).then(done(ORDER_ADDONS_TEXT.added));
  };

  const remove = (g: AddonGroup) =>
    void openDialog({
      title: ORDER_ADDONS_TEXT.removeTitle,
      eyebrow: `${eyebrow} · ${g.name}`,
      body: h('p', { class: 'dialog__text' }, removeAddonText(g), o.status === 'PAID' ? h('span', { data: { testid: 'order-addon-paid-remove' } }, ` ${ORDER_ADDONS_TEXT.paidRemove}`) : null),
      confirmLabel: ORDER_ADDONS_TEXT.remove,
      submit: async () => {
        await ctx.api.removeOrderAddon(o.id, g.unitIds[g.unitIds.length - 1]!);
      },
    }).then(done(ORDER_ADDONS_TEXT.removed));

  const columns: Column<AddonGroup>[] = [
    {
      label: 'Add-on',
      cell: (g) => h('span', null, h('span', { data: { testid: 'order-addon-name' } }, unitsWords(g.name, g.units)), h('span', { class: 'cell-sub mono' }, g.skuCode)),
      kind: ['wide'],
    },
    { label: 'Price', cell: (g) => h('span', { data: { testid: 'order-addon-price' } }, groupPriceText(g)), kind: ['nowrap'] },
    {
      label: 'Added by',
      cell: (g) => h('span', null, h('span', { data: { testid: 'order-addon-by' } }, addedByText(g.addedBy, d.actors)), h('span', { class: 'cell-sub' }, parisDateTime(g.addedAt))),
    },
    {
      label: 'Status',
      cell: (g) => {
        const invoice = invoiceNumber(g.invoiceId);
        const returned = returnedLine(g);
        return h(
          'span',
          null,
          h('span', { data: { testid: 'order-addon-status' } }, statusMark(ADDON_STATUS_LABELS[g.status], g.status === 'HELD' ? 'outline' : g.status === 'SHIPPED' ? 'solid' : 'muted')),
          g.status === 'HELD' ? h('span', { class: 'cell-sub', data: { testid: 'order-addon-held' } }, heldLine(g)) : null,
          returned ? h('span', { class: 'cell-sub' }, returned) : null,
          invoice ? h('span', { class: 'cell-sub', data: { testid: 'order-addon-invoice' } }, `Its invoice ${invoice}`) : null,
        );
      },
      kind: ['nowrap'],
    },
    ...(manage
      ? [
          {
            label: '',
            cell: (g: AddonGroup) => (canRemoveAddon(o, g, manage) ? button(ORDER_ADDONS_TEXT.remove, { kind: 'ghost', testId: 'order-addon-remove', onClick: () => remove(g) }) : null),
            kind: ['actions' as const],
          },
        ]
      : []),
  ];
  const addButton = canAddAddon(o, manage) ? button(ORDER_ADDONS_TEXT.add, { kind: 'ghost', testId: 'order-addon-add' }) : null;
  addButton?.addEventListener('click', () => void add(addButton));
  return section(
    ORDER_ADDONS_TEXT.title,
    [h('p', { class: 'panel__text' }, ORDER_ADDONS_TEXT.lead), table(columns, groups, { caption: ORDER_ADDONS_TEXT.title, empty: ORDER_ADDONS_TEXT.empty })],
    { id: 'order-addons', tools: addButton ? [addButton] : [] },
  );
}

// ── The draw's Confirm and the salon's Accept ──────────────────────────────

/** The collector's choices in a dialog: its lead, a line per add-on, the rule; nothing without a choice. */
export function choicesBlock(choices: readonly ChosenAddon[], currency: string | null, lead: string): HTMLElement | null {
  if (choices.length === 0) return null;
  return h(
    'div',
    { class: 'addon-choices', data: { testid: 'addon-choices' } },
    h('p', { class: 'dialog__text' }, lead),
    h('ul', { class: 'addon-choices__list' }, ...choiceLines(choices, currency).map((l) => h('li', { class: 'addon-choices__line', data: { testid: 'addon-choice' } }, l))),
    h('p', { class: 'dialog__text' }, CHOICES_TEXT.rule),
  );
}

/** After the sale: what was left out, in a dialog of its own (nothing when every choice was added). */
export async function leftOutDialog(left: readonly LeftOutAddon[] | undefined, eyebrow: string): Promise<void> {
  if (!left || left.length === 0) return;
  await openDialog({
    title: CHOICES_TEXT.leftOutTitle,
    eyebrow,
    body: [
      h('p', { class: 'dialog__text' }, CHOICES_TEXT.leftOutLead),
      h('ul', { class: 'addon-choices__list' }, ...leftOutLines(left).map((l) => h('li', { class: 'addon-choices__line', data: { testid: 'addon-left-out' } }, l))),
      h('p', { class: 'dialog__text' }, CHOICES_TEXT.leftOutAfter),
    ],
    confirmLabel: ORDER_ADDONS_TEXT.close,
    noCancel: true,
  });
}
