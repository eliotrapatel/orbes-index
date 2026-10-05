/**
 * The settings of the orders, `#/settings` (plan LIVE RELEASE+: choices 16, 17 and 19, The console → Locations and
 * carriers), reached from the Orders board and the Atelier: everyone who reads the console sees them; an ADMIN
 * changes them, each change audited.
 *
 *  - Order alerts (M3): the delays after which an order stands out on the board (RESERVED 2 days, paid and ready 3,
 *    shipped 10, delivered and not registered 30 by default), and who set them.
 *  - Locations: FRANCE WAREHOUSE and LOGISTICS WAREHOUSE from the first boot, more added; renamed; one is the default,
 *    where the orders of draws and of the private salon go.
 *  - Carriers: Colissimo, Chronopost, DHL Express and UPS from the first boot, more added; each with its tracking link,
 *    `{tracking}` where the number goes (an example shown); set aside (never offered for a shipment again) or offered
 *    again.
 */
import { h } from '../../shared/dom.js';
import { formatDateTime } from '../format.js';
import { alertsInput, alertsProblem, ALERT_LIMITS, carrierProblem, LOGISTICS_LIMITS, locationProblem, TRACKING_PLACEHOLDER, trackingLink } from '../model/orders.js';
import { can } from '../model/permissions.js';
import type { Carrier, OrderAlertSettings, StockLocation } from '../types.js';
import { href } from '../router.js';
import { button, defList, linkButton, mono, pageHeader, section, statusMark, table } from '../ui/components.js';
import { openDialog } from '../ui/dialog.js';
import { notify } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** The number a tracking link's example reads. */
const EXAMPLE_TRACKING = '6A12345678901';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

export async function settingsView(ctx: ViewContext): Promise<HTMLElement> {
  const [alerts, locations, carriers] = await Promise.all([ctx.api.orderAlerts(), ctx.api.locations(), ctx.api.carriers()]);
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
      actions: [linkButton('Orders', href('orders'), 'ghost'), linkButton('Atelier', href('atelier'), 'ghost')],
    }),
    alertsSection(ctx, alerts, admin, done),
    locationsSection(ctx, locations.items, admin, done),
    carriersSection(ctx, carriers.items, admin, done),
  );
}

function alertsSection(ctx: ViewContext, a: OrderAlertSettings, admin: boolean, done: (msg: string) => (v: unknown) => void): HTMLElement {
  const edit = () =>
    void openDialog({
      title: 'Order alerts',
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
    }).then(done('Alerts saved.'));
  return section(
    'Order alerts',
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
