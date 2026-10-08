/**
 * Supplier orders (plan NEXT LOT of 2026-10-07, §3.5.4.2, `#/supplier-orders`): ORBES's own page, under Logistics in the
 * sidebar, never shown to a LOGISTICS login (« The agent has no supplier-orders page »). For now it holds its
 * **Suppliers** section: the suppliers ORBES orders its pieces from, added and changed by an OPERATOR, read by an
 * AUDITOR. To order (the proposal) and the supplier orders themselves come with step 5.11d.
 */
import { h } from '../../shared/dom.js';
import { can } from '../model/permissions.js';
import { contactLines, SUPPLIER_ORDERS_TEXT, supplierFormValues, supplierInputOf } from '../model/suppliers.js';
import type { Supplier } from '../types.js';
import { button, emptyState, pageHeader, section, statusMark, table, type Column } from '../ui/components.js';
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
  const suppliers = (await ctx.api.suppliers()).items;
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
    section('Suppliers', list, { id: 'suppliers' }),
  );
}
