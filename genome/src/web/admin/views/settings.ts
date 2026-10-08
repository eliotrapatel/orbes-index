/**
 * The settings of the orders, `#/settings` (plan LIVE RELEASE+: choices 16, 17 and 19, The console → Locations and
 * carriers), reached from the Orders board and Logistics: everyone who reads the console sees them; an ADMIN
 * changes them, each change audited.
 *
 *  - Late orders (M3; the order alerts of the API and the audit, a word the console never shows): the delays after
 *    which an order stands out on the board (RESERVED 2 days, paid and ready 5 (plan NEXT LOT §3.5.4.5), shipped 10,
 *    delivered and not registered 30 by default), and who set them.
 *  - Locations: FRANCE WAREHOUSE and LOGISTICS WAREHOUSE from the first boot, more added; renamed; one is the default,
 *    where the orders of draws and of the private salon go; each with its postal address (plan NEXT LOT §3.5.4.5), the
 *    Deliver to of its supplier orders' PDF.
 *  - Carriers: Colissimo, Chronopost, DHL Express and UPS from the first boot, more added; each with its tracking link,
 *    `{tracking}` where the number goes (an example shown); set aside (never offered for a shipment again) or offered
 *    again.
 *  - SHIPPING (plan NEXT-NINE, BP-19 T2), optional: what an order's delivery costs below the free shipping of PLATINE
 *    and PALLADIUM, per currency and service, '—' for none (none preset: the order then carries no shipping, as
 *    before, unless Client Services enters a fee on it). Edit shipping (ADMIN) sets them whole, audited
 *    `order.shipping_rates.update`.
 *  - Engraving (plan NEXT LOT §3.6.C): what an engraving costs per currency, for the orders without their release's
 *    ENGRAVING add-on, '—' for none (no engraving offered to clients in that currency; none preset). Edit engraving
 *    (ADMIN) sets them whole, audited `order.engraving_prices.update`; an order keeps the price it took.
 *  - House guarantee (plan NEXT-NINE, IN-01): the Grant dialog's defaults, valid for 90 days (1 to 730), 1 piece (1 to
 *    5), shown to the client; who set them and when. Changed by an ADMIN, audited `guarantee.settings`.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import { alertsInput, alertsProblem, ALERT_LIMITS, carrierProblem, engravingPricesInput, engravingPricesProblem, engravingPricesValues, engravingPriceText, LOGISTICS_LIMITS, locationProblem, TRACKING_PLACEHOLDER, trackingLink } from '../model/orders.js';
import { GUARANTEE_LIMITS, PIECES_OPTIONS, piecesText, settingsInput, settingsProblem, settingsValues } from '../model/guarantees.js';
import { can } from '../model/permissions.js';
import { rateField, rateText, ratesChanged, ratesInput, ratesProblem, ratesValues, SHIPPING_SERVICE_LABELS } from '../model/program.js';
import { HOUSE_CURRENCIES, SHIPPING_SERVICES, type Carrier, type EngravingPricesSheet, type GuaranteeSettings, type HouseCurrency, type OrderAlertSettings, type ShippingRatesSheet, type StockLocation } from '../types.js';
import { href } from '../router.js';
import { button, defList, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The number a tracking link's example reads. */
const EXAMPLE_TRACKING = '6A12345678901';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export async function settingsView(ctx: ViewContext): Promise<HTMLElement> {
  const [alerts, locations, carriers, rates, engraving, guarantee] = await Promise.all([
    ctx.api.orderAlerts(),
    ctx.api.locations(),
    ctx.api.carriers(),
    ctx.api.shippingRates(),
    ctx.api.engravingPrices(),
    ctx.api.guaranteeSettings(),
  ]);
  const admin = can(ctx.session.admin.role, 'manageLogistics');
  const done = (msg: string) => (v: unknown) => {
    if (!v) return;
    notify(msg);
    ctx.reload();
  };
  return h(
    'div',
    { class: 'view view--settings' },
    pageHeader({
      eyebrow: 'Clients · Orders',
      title: 'Settings',
      lead: 'How the orders are followed: when one stands out as late, where pieces are kept, which carriers ship them. Everyone reads these settings; an ADMIN changes them.',
      actions: [linkButton('Orders', href('orders'), 'ghost'), linkButton('Logistics', href('logistics'), 'ghost')],
    }),
    alertsSection(ctx, alerts, admin, done),
    locationsSection(ctx, locations.items, admin, done),
    carriersSection(ctx, carriers.items, admin, done),
    shippingSection(ctx, rates, admin, done),
    engravingSection(ctx, engraving, admin, done),
    guaranteeSection(ctx, guarantee, can(ctx.session.admin.role, 'manageGuaranteeSettings'), done),
  );
}

/**
 * ENGRAVING (plan NEXT LOT §3.6.C), beside Shipping and like it: one price per currency for the orders without their
 * release's ENGRAVING add-on; an ADMIN sets them, an AUDITOR reads them.
 */
function engravingSection(ctx: ViewContext, sheet: EngravingPricesSheet, admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const values = engravingPricesValues(sheet);
  const edit = () =>
    void openDialog({
      title: 'Engraving',
      eyebrow: 'Settings · Engraving',
      body: h('p', { class: 'dialog__text' }, 'An amount in units for each currency, or empty for none. An order keeps the price it took.'),
      fields: HOUSE_CURRENCIES.map((c) => ({ name: c, label: c, maxlength: 12, value: values[c] ?? '' })),
      validate: (v) => engravingPricesProblem(v) ?? (HOUSE_CURRENCIES.every((c) => (v[c] ?? '').trim() === (values[c] ?? '')) ? 'Nothing has changed.' : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setEngravingPrices(engravingPricesInput(v));
      },
    }).then(done('Engraving prices saved.'));
  return section(
    'Engraving',
    [
      h('p', { class: 'notice' }, 'What an engraving costs, per currency. A currency without a price offers no engraving to clients.'),
      table<HouseCurrency>(
        [
          { label: 'Currency', cell: (c) => c, kind: ['nowrap'] },
          { label: 'Price', cell: (c: HouseCurrency) => h('span', { data: { testid: `engraving-${c}` } }, engravingPriceText(sheet, c)), kind: ['nowrap' as const] },
        ],
        [...HOUSE_CURRENCIES],
        { caption: 'Engraving prices' },
      ),
      sheet.updatedAt ? h('p', { class: 'notice' }, `Set ${formatDateTime(sheet.updatedAt)}${sheet.updatedBy ? ` by ${sheet.updatedBy.email}` : ''}.`) : null,
    ],
    { id: 'settings-engraving', tools: admin ? [button('Edit engraving', { kind: 'ghost', testId: 'engraving-edit', onClick: edit })] : [] },
  );
}

/** IN-01: the Grant dialog's defaults, each grant setting its own terms. */
function guaranteeSection(ctx: ViewContext, g: GuaranteeSettings, admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const edit = () =>
    void openDialog({
      title: 'House guarantee',
      eyebrow: 'Settings · House guarantee',
      body: h('p', { class: 'dialog__text' }, 'The starting values of Grant a guarantee on the client sheet. Each grant may set its own.'),
      fields: [
        {
          name: 'validDays',
          label: 'Valid for (days)',
          required: true,
          maxlength: 3,
          value: settingsValues(g).validDays,
          hint: `${GUARANTEE_LIMITS.validDays.min} to ${GUARANTEE_LIMITS.validDays.max}: from the day it is granted.`,
        },
        { name: 'pieces', label: 'Pieces', kind: 'select', options: [...PIECES_OPTIONS], value: settingsValues(g).pieces },
        { name: 'visible', label: 'Shown to the client', kind: 'checkbox', value: settingsValues(g).visible },
      ],
      validate: (v) => settingsProblem(v) ?? (JSON.stringify(settingsInput(v)) === JSON.stringify({ validDays: g.validDays, pieces: g.pieces, visible: g.visible }) ? 'Nothing has changed.' : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setGuaranteeSettings(settingsInput(v));
      },
    }).then(done('House guarantee saved.'));
  return section(
    'House guarantee',
    defList([
      { label: 'Valid for', value: h('span', { data: { testid: 'guarantee-valid-days' } }, days(g.validDays)), note: 'A guarantee covers a release that opens by its date.' },
      { label: 'Pieces', value: h('span', { data: { testid: 'guarantee-pieces' } }, piecesText(g.pieces)) },
      { label: 'Shown to the client', value: h('span', { data: { testid: 'guarantee-visible' } }, g.visible ? 'Yes' : 'No') },
      { label: 'Set', value: g.updatedAt ? `${formatDateTime(g.updatedAt)}${g.updatedBy ? ` · ${g.updatedBy.email}` : ''}` : 'The defaults' },
    ]),
    { id: 'settings-guarantee', tools: admin ? [button('Edit', { kind: 'ghost', testId: 'guarantee-settings-edit', onClick: edit })] : [] },
  );
}

function alertsSection(ctx: ViewContext, a: OrderAlertSettings, admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const edit = () =>
    void openDialog({
      title: 'Late orders',
      eyebrow: 'Settings',
      body: h('p', { class: 'dialog__text' }, 'An order stands out on the board once it has spent longer than this in its step.'),
      fields: [
        { name: 'reservedDays', label: 'Reserved, not paid (days)', required: true, maxlength: 3, value: String(a.reservedDays), hint: `${ALERT_LIMITS.reservedDays.min} to ${ALERT_LIMITS.reservedDays.max}.` },
        { name: 'readyDays', label: 'Paid, its piece ready, not shipped (days)', required: true, maxlength: 3, value: String(a.readyDays), hint: `${ALERT_LIMITS.readyDays.min} to ${ALERT_LIMITS.readyDays.max}.` },
        { name: 'shippedDays', label: 'Shipped, not delivered (days)', required: true, maxlength: 3, value: String(a.shippedDays), hint: `${ALERT_LIMITS.shippedDays.min} to ${ALERT_LIMITS.shippedDays.max}.` },
        {
          name: 'unregisteredDays',
          label: 'Delivered, not registered by its buyer (days)',
          required: true,
          maxlength: 3,
          value: String(a.unregisteredDays),
          hint: `${ALERT_LIMITS.unregisteredDays.min} to ${ALERT_LIMITS.unregisteredDays.max}.`,
        },
      ],
      validate: alertsProblem,
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setOrderAlerts(alertsInput(v));
      },
    }).then(done('Delays saved.'));
  return section(
    'Late orders',
    defList([
      { label: 'Reserved, not paid', value: h('span', { data: { testid: 'alert-reserved' } }, `Over ${days(a.reservedDays)}`) },
      { label: 'Paid, ready, not shipped', value: h('span', { data: { testid: 'alert-ready' } }, `Over ${days(a.readyDays)}`), note: 'From when it was both paid and ready.' },
      { label: 'Shipped, not delivered', value: h('span', { data: { testid: 'alert-shipped' } }, `Over ${days(a.shippedDays)}`) },
      { label: 'Delivered, not registered', value: h('span', { data: { testid: 'alert-unregistered' } }, `Over ${days(a.unregisteredDays)}`), note: 'Its piece not registered by its buyer.' },
      { label: 'Set', value: a.updatedAt ? `${formatDateTime(a.updatedAt)}${a.updatedBy ? ` · ${a.updatedBy.email}` : ''}` : 'The defaults' },
    ]),
    { id: 'settings-alerts', tools: admin ? [button('Edit', { kind: 'ghost', testId: 'alerts-edit', onClick: edit })] : [] },
  );
}

function locationsSection(ctx: ViewContext, items: StockLocation[], admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const nameDialog = (title: string, value: string, submit: (name: string) => Promise<unknown>, msg: string) =>
    void openDialog({
      title,
      eyebrow: 'Settings · Locations',
      fields: [{ name: 'name', label: 'Name', required: true, maxlength: LOGISTICS_LIMITS.locationName, value, hint: 'As the team says it: PARIS ATELIER.' }],
      validate: (v) => locationProblem(v.name) ?? (v.name.trim() === value ? 'Nothing has changed.' : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        await submit(v.name.trim());
      },
    }).then(done(msg));
  const addressDialog = (l: StockLocation) =>
    void openDialog({
      title: 'The location’s address',
      eyebrow: l.name,
      body: h('p', { class: 'dialog__text' }, 'Its postal address: printed as Deliver to on the PDF of its supplier orders.'),
      fields: [{ name: 'address', label: 'Address', kind: 'textarea', rows: 4, maxlength: 500, value: l.address ?? '', hint: 'As it is written on a parcel, one line each. Empty to clear.' }],
      validate: (v) => ((v.address.trim() || null) === (l.address ?? null) ? 'Nothing has changed.' : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.updateLocation(l.id, { address: v.address.trim() || null });
      },
    }).then(done('Address saved.'));
  const makeDefault = (l: StockLocation) =>
    void openDialog({
      title: 'Make it the default',
      eyebrow: l.name,
      body: h('p', { class: 'dialog__text' }, 'The orders of draws and of the private salon go to the default location from now on. The orders already placed stay where they are.'),
      confirmLabel: 'Make default',
      submit: async () => {
        await ctx.api.updateLocation(l.id, { isDefault: true });
      },
    }).then(done('Default location changed.'));
  return section(
    'Locations',
    table<StockLocation>(
      [
        { label: 'Location', cell: (l) => h('span', { data: { testid: 'location-name' } }, l.name), kind: ['wide'] },
        { label: 'Address', cell: (l) => h('span', { class: 'prewrap', data: { testid: 'location-address' } }, l.address ?? '—') },
        { label: 'Default', cell: (l) => (l.isDefault ? statusMark('DEFAULT', 'solid') : '—'), kind: ['nowrap'] },
        { label: 'Shopify', cell: (l) => (l.shopifyLocationId ? mono(l.shopifyLocationId) : '—'), kind: ['nowrap'] },
        {
          label: '',
          cell: (l) =>
            admin
              ? h(
                  'span',
                  { class: 'row-actions' },
                  button('Rename', { kind: 'ghost', testId: 'location-rename', onClick: () => nameDialog('Rename the location', l.name, (name) => ctx.api.updateLocation(l.id, { name }), 'Location renamed.') }),
                  button('Address', { kind: 'ghost', testId: 'location-address-edit', onClick: () => addressDialog(l) }),
                  l.isDefault ? null : button('Make default', { kind: 'ghost', testId: 'location-default', onClick: () => makeDefault(l) }),
                )
              : null,
          kind: ['actions'],
        },
      ],
      items,
      { caption: 'Locations', empty: 'No location yet: they are created at the first boot.' },
    ),
    {
      id: 'settings-locations',
      tools: admin ? [button('Add location', { kind: 'ghost', testId: 'location-add', onClick: () => nameDialog('Add a location', '', (name) => ctx.api.createLocation(name), 'Location added.') })] : [],
    },
  );
}

function carriersSection(ctx: ViewContext, items: Carrier[], admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const example = (url: string) => {
    try {
      return carrierProblem({ name: 'x', trackingUrl: url }) ? null : trackingLink(url, EXAMPLE_TRACKING);
    } catch {
      return null;
    }
  };
  const edit = (c: Carrier | null) =>
    void openDialog({
      title: c ? 'Edit the carrier' : 'Add a carrier',
      eyebrow: 'Settings · Carriers',
      fields: [
        { name: 'name', label: 'Name', required: true, maxlength: LOGISTICS_LIMITS.carrierName, value: c?.name ?? '' },
        {
          name: 'trackingUrl',
          label: 'Tracking link',
          required: true,
          maxlength: LOGISTICS_LIMITS.trackingUrl,
          value: c?.trackingUrl ?? '',
          hint: `https, with ${TRACKING_PLACEHOLDER} where the tracking number goes.`,
        },
      ],
      live: (v) => {
        const link = example(v.trackingUrl ?? '');
        return h('p', { class: 'dialog__text', data: { testid: 'carrier-example' } }, link ? `With ${EXAMPLE_TRACKING}: ${link}` : 'The example appears once the link is valid.');
      },
      validate: (v) => carrierProblem(v) ?? (c && v.name.trim() === c.name && v.trackingUrl.trim() === c.trackingUrl ? 'Nothing has changed.' : null),
      confirmLabel: 'Save',
      submit: async (v) => {
        const input = { name: v.name.trim(), trackingUrl: v.trackingUrl.trim() };
        if (c) await ctx.api.updateCarrier(c.id, { ...(input.name !== c.name ? { name: input.name } : {}), ...(input.trackingUrl !== c.trackingUrl ? { trackingUrl: input.trackingUrl } : {}) });
        else await ctx.api.createCarrier(input);
      },
    }).then(done(c ? 'Carrier saved.' : 'Carrier added.'));
  const toggle = (c: Carrier) =>
    void openDialog({
      title: c.active ? 'Set the carrier aside' : 'Offer the carrier again',
      eyebrow: c.name,
      body: h(
        'p',
        { class: 'dialog__text' },
        c.active ? 'It is no longer offered when an order ships. The orders it shipped keep it, and their tracking links.' : 'It is offered again when an order ships.',
      ),
      confirmLabel: c.active ? 'Set aside' : 'Offer again',
      submit: async () => {
        await ctx.api.updateCarrier(c.id, { active: !c.active });
      },
    }).then(done(c.active ? 'Carrier set aside.' : 'Carrier offered again.'));
  return section(
    'Carriers',
    table<Carrier>(
      [
        { label: 'Carrier', cell: (c) => h('span', { data: { testid: 'carrier-name' } }, c.name), kind: ['nowrap'] },
        { label: 'Tracking link', cell: (c) => h('span', { class: 'mono breakall' }, c.trackingUrl), kind: ['wide'] },
        { label: 'Status', cell: (c) => statusMark(c.active ? 'OFFERED' : 'SET ASIDE', c.active ? 'solid' : 'muted'), kind: ['nowrap'] },
        {
          label: '',
          cell: (c) =>
            admin
              ? h(
                  'span',
                  { class: 'row-actions' },
                  button('Edit', { kind: 'ghost', testId: 'carrier-edit', onClick: () => edit(c) }),
                  button(c.active ? 'Set aside' : 'Offer again', { kind: 'ghost', testId: 'carrier-toggle', onClick: () => toggle(c) }),
                )
              : null,
          kind: ['actions'],
        },
      ],
      items,
      { caption: 'Carriers', empty: 'No carrier yet: they are created at the first boot.' },
    ),
    { id: 'settings-carriers', tools: admin ? [button('Add carrier', { kind: 'ghost', testId: 'carrier-add', onClick: () => edit(null) })] : [] },
  );
}

function shippingSection(ctx: ViewContext, sheet: ShippingRatesSheet, admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const rates = sheet.items;
  const edit = () =>
    void openDialog({
      title: 'Shipping rates',
      eyebrow: 'Settings · Shipping',
      body: h('p', { class: 'dialog__text' }, 'An amount in units for each rate the house charges, or empty for none. PLATINE and PALLADIUM orders keep their free shipping.'),
      fields: HOUSE_CURRENCIES.flatMap((c) =>
        SHIPPING_SERVICES.map((sv) => ({ name: rateField(c, sv), label: `${c} · ${SHIPPING_SERVICE_LABELS[sv]}`, maxlength: 12, value: ratesValues(rates)[rateField(c, sv)] })),
      ),
      validate: (v) => ratesProblem(v) ?? (ratesChanged(rates, ratesInput(v)) ? null : 'Nothing has changed.'),
      confirmLabel: 'Save',
      submit: async (v) => {
        await ctx.api.setShippingRates(ratesInput(v));
      },
    }).then(done('Shipping rates saved.'));
  return section(
    'Shipping',
    [
      h(
        'p',
        { class: 'notice' },
        'Optional. What an order’s delivery costs below the free shipping of PLATINE and PALLADIUM (Club → Tiers). A rate set here is added to each new order in its currency. Empty: the order carries no shipping, as today, and Client Services may enter a fee on the order.',
      ),
      table<HouseCurrency>(
        [
          { label: 'Currency', cell: (c) => c, kind: ['nowrap'] },
          ...SHIPPING_SERVICES.map((sv) => ({ label: SHIPPING_SERVICE_LABELS[sv], cell: (c: HouseCurrency) => h('span', { data: { testid: `rate-${rateField(c, sv)}` } }, rateText(rates, c, sv)), kind: ['nowrap' as const] })),
        ],
        [...HOUSE_CURRENCIES],
        { caption: 'Shipping rates' },
      ),
    ],
    { id: 'settings-shipping', tools: admin ? [button('Edit shipping', { kind: 'ghost', testId: 'shipping-edit', onClick: edit })] : [] },
  );
}
