/**
 * Supplier orders (plan NEXT LOT of 2026-10-07, §3.5.4.2, `#/supplier-orders`): ORBES's own page, under Logistics in the
 * sidebar, never shown to a LOGISTICS login (« The agent has no supplier-orders page »).
 *
 *  - To order: « the console proposes »: per supplier and location, the orders waiting for stock and the stock under its
 *    minimum, less what is expected or in a draft; Add to the draft (OPERATOR); the sizes without a supplier apart.
 *  - Supplier orders: filtered by status and supplier, each to its page (views/supplier-order.ts).
 *  - Suppliers: added and changed by an OPERATOR, read by an AUDITOR.
 */
import { h } from '../../shared/dom.js';
import { can } from '../model/permissions.js';
import { sizeText } from '../model/logistics.js';
import { invoiceCell, LIST_TEXT, listFilters, money, noSupplierLine, piecesLine, PROPOSAL_TEXT, statusOptions, SUPPLIER_ORDER_STATUS_LABELS } from '../model/supplier-orders.js';
import { contactLines, SUPPLIER_ORDERS_TEXT, supplierFormValues, supplierInputOf } from '../model/suppliers.js';
import { href } from '../router.js';
import { formatCount, formatDate } from '../format.js';
import type { Supplier, SupplierOrderListItem, SupplierOrderProposal } from '../types.js';
import { busy, button, emptyState, field, filterBar, pageHeader, section, select, statusMark, table, type Column } from '../ui/components.js';
import { openDialog, type DialogField } from '../ui/dialog.js';
import { notify, notifyError } from '../ui/toast.js';
import type { ViewContext } from './context.js';

/** A supplier's fields in its dialog (the server's bounds, §3.5.5.1). */
function supplierFields(s: Supplier | null): DialogField[] {
  const v = supplierFormValues(s);
  return [
    { name: 'name', label: 'Name', required: true, maxlength: 120, value: v.name },
    { name: 'contactName', label: 'Contact name', maxlength: 120, value: v.contactName },
    { name: 'email', label: 'Email', kind: 'email', maxlength: 254, value: v.email },
    { name: 'phone', label: 'Phone', maxlength: 40, value: v.phone },
    { name: 'address', label: 'Address', kind: 'textarea', maxlength: 500, rows: 3, value: v.address },
    { name: 'currency', label: 'Currency', maxlength: 3, value: v.currency, hint: SUPPLIER_ORDERS_TEXT.currencyHint },
    { name: 'note', label: 'Note', kind: 'textarea', maxlength: 1000, rows: 3, value: v.note },
    { name: 'active', label: 'Active', kind: 'checkbox', value: v.active, hint: SUPPLIER_ORDERS_TEXT.activeHint },
  ];
}

export async function supplierOrdersView(ctx: ViewContext): Promise<HTMLElement> {
  const filters = listFilters(ctx.route.query);
  const [suppliers, proposal, orders] = await Promise.all([ctx.api.suppliers().then((r) => r.items), ctx.api.supplierOrderProposal(), ctx.api.supplierOrders(filters).then((r) => r.items)]);
  const canManage = can(ctx.session.admin.role, 'manageSupplierOrders');

  const act = (p: Promise<unknown>, done: string) =>
    p.then(
      (r) => {
        if (!r) return;
        notify(done);
        ctx.reload();
      },
      (e: unknown) => notifyError(e),
    );

  const add = canManage
    ? button(SUPPLIER_ORDERS_TEXT.add, {
        kind: 'primary',
        testId: 'supplier-create',
        onClick: () =>
          void act(
            openDialog({
              title: SUPPLIER_ORDERS_TEXT.addTitle,
              fields: supplierFields(null),
              confirmLabel: SUPPLIER_ORDERS_TEXT.add,
              submit: async (v) => {
                await ctx.api.createSupplier(supplierInputOf(v));
              },
            }),
            SUPPLIER_ORDERS_TEXT.added,
          ),
      })
    : null;

  const edit = (s: Supplier) =>
    void act(
      openDialog({
        title: SUPPLIER_ORDERS_TEXT.editTitle,
        eyebrow: s.name,
        fields: supplierFields(s),
        confirmLabel: 'Save the supplier',
        submit: async (v) => {
          await ctx.api.updateSupplier(s.id, supplierInputOf(v));
        },
      }),
      SUPPLIER_ORDERS_TEXT.saved,
    );

  const list = suppliers.length
    ? h(
        'div',
        { data: { testid: 'suppliers' } },
        table(
          [
            { label: 'Name', cell: (s) => s.name, kind: ['wide'] },
            {
              label: 'Contact',
              cell: (s) => {
                const c = contactLines(s);
                return h('span', null, c.main, c.sub ? h('span', { class: 'cell-sub' }, c.sub) : null);
              },
            },
            { label: 'Currency', cell: (s) => s.currency ?? '—', kind: ['nowrap'] },
            { label: 'Models', cell: (s) => String(s.models), kind: ['nowrap', 'num'] },
            { label: 'Active', cell: (s) => (s.active ? statusMark('ACTIVE', 'solid') : statusMark('INACTIVE', 'muted')), kind: ['nowrap'] },
            ...(canManage ? [{ label: 'Actions', kind: ['actions'], cell: (s) => button('Edit', { kind: 'ghost', testId: 'supplier-edit', onClick: () => edit(s) }) } satisfies Column<Supplier>] : []),
          ],
          suppliers,
          { empty: SUPPLIER_ORDERS_TEXT.suppliersEmpty, caption: 'Suppliers' },
        ),
      )
    : emptyState(SUPPLIER_ORDERS_TEXT.suppliersEmpty);

  return h(
    'div',
    { class: 'view view--supplier-orders', data: { testid: 'supplier-orders' } },
    pageHeader({ eyebrow: 'Registry', title: 'Supplier orders', lead: SUPPLIER_ORDERS_TEXT.lead, actions: add ? [add] : [] }),
    proposalSection(ctx, proposal, canManage),
    ordersSection(ctx, orders, suppliers, filters),
    section('Suppliers', list, { id: 'suppliers' }),
  );
}

/** To order: one table per supplier and location, Add to the draft; the sizes without a supplier last. */
function proposalSection(ctx: ViewContext, proposal: SupplierOrderProposal, canManage: boolean): HTMLElement {
  const add = (g: SupplierOrderProposal['groups'][number], b: HTMLButtonElement) =>
    void busy(b, async () => {
      try {
        for (const r of g.rows.filter((x) => x.toOrder > 0)) await ctx.api.addToSupplierDraft({ skuId: r.sku.id, locationId: g.location.id, quantity: r.toOrder, from: 'PROPOSAL' });
        notify(PROPOSAL_TEXT.added);
        ctx.reload();
      } catch (e) {
        notifyError(e);
      }
    });
  const groups = proposal.groups.map((g) => {
    const tool = canManage && g.supplier && g.toOrder > 0 ? button(PROPOSAL_TEXT.add, { kind: 'secondary', testId: 'proposal-add' }) : null;
    tool?.addEventListener('click', () => add(g, tool));
    return h(
      'div',
      { class: 'proposal', data: { testid: 'proposal-group' } },
      h(
        'div',
        { class: 'proposal__head' },
        h('h3', { class: 'proposal__title' }, `${g.supplier?.name ?? PROPOSAL_TEXT.noSupplierTitle} · ${g.location.name}`),
        g.draft ? h('a', { class: 'idlink mono', attrs: { href: href('supplierOrder', { supplierOrderId: g.draft.id }) }, data: { testid: 'proposal-draft' } }, g.draft.reference) : null,
        tool,
      ),
      g.supplier
        ? table(
            [
              { label: 'Model', cell: (r) => r.sku.model.name },
              { label: 'Variant', cell: (r) => r.sku.variant ?? '—', kind: ['nowrap'] },
              { label: 'Size', cell: (r) => h('span', null, sizeText(r.sku.sizeLabel), h('span', { class: 'cell-sub mono' }, r.sku.code)), kind: ['nowrap'] },
              { label: 'Waiting orders', cell: (r) => formatCount(r.waiting), kind: ['num'] },
              { label: 'Under the minimum', cell: (r) => formatCount(r.underMinimum), kind: ['num'] },
              { label: 'Expected', cell: (r) => formatCount(r.expected), kind: ['num'] },
              { label: 'In the draft', cell: (r) => formatCount(r.inDraft), kind: ['num'] },
              { label: 'To order', cell: (r) => h('span', { class: 'stock__num', data: { testid: 'proposal-to-order' } }, formatCount(r.toOrder)), kind: ['num'] },
            ],
            g.rows,
            { caption: g.supplier.name },
          )
        : h('ul', { class: 'proposal__none' }, ...g.rows.map((r) => h('li', { class: 'panel__text', data: { testid: 'proposal-no-supplier' } }, h('a', { class: 'idlink', attrs: { href: href('model', { modelId: r.sku.model.id }) } }, noSupplierLine(r.sku))))),
    );
  });
  return section(PROPOSAL_TEXT.title, groups.length ? groups : emptyState(PROPOSAL_TEXT.empty), { id: 'proposal', note: proposal.toOrder > 0 ? `${formatCount(proposal.toOrder)} to order` : undefined });
}

/** The supplier orders, filtered by status and supplier. */
function ordersSection(ctx: ViewContext, orders: SupplierOrderListItem[], suppliers: Supplier[], filters: ReturnType<typeof listFilters>): HTMLElement {
  const status = select('status', statusOptions(), filters.status ?? '');
  status.setAttribute('data-testid', 'supplier-orders-status');
  status.addEventListener('change', () => ctx.setQuery({ status: status.value }));
  const supplier = select('supplierId', [{ value: '', label: 'Every supplier' }, ...suppliers.map((x) => ({ value: x.id, label: x.name }))], filters.supplierId ?? '');
  supplier.addEventListener('change', () => ctx.setQuery({ supplierId: supplier.value }));
  return section(
    LIST_TEXT.title,
    [
      filterBar(field('Status', status), field('Supplier', supplier)),
      table(
        [
          { label: 'Reference', cell: (o) => h('a', { class: 'idlink mono', attrs: { href: href('supplierOrder', { supplierOrderId: o.id }) }, data: { testid: 'supplier-order-link' } }, o.reference), kind: ['nowrap'] },
          { label: 'Supplier', cell: (o) => o.supplier.name },
          { label: 'Deliver to', cell: (o) => o.location.name, kind: ['nowrap'] },
          { label: 'Status', cell: (o) => h('span', { data: { testid: 'supplier-order-status' } }, statusMark(SUPPLIER_ORDER_STATUS_LABELS[o.status], o.status === 'DRAFT' ? 'outline' : o.status === 'CANCELLED' ? 'muted' : 'solid')), kind: ['nowrap'] },
          { label: 'Pieces', cell: (o) => piecesLine(o.pieces), kind: ['num'] },
          { label: 'Total', cell: (o) => money(o.totalMinor, o.currency), kind: ['num', 'nowrap'] },
          { label: 'Expected on', cell: (o) => (o.expectedOn ? formatDate(o.expectedOn) : '—'), kind: ['nowrap'] },
          { label: 'Invoice', cell: (o) => invoiceCell(o.invoice), kind: ['nowrap'] },
        ],
        orders,
        { caption: LIST_TEXT.title, empty: LIST_TEXT.empty },
      ),
    ],
    { id: 'supplier-orders-list' },
  );
}
