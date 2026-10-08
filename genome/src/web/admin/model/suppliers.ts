/**
 * The suppliers in the console (plan NEXT LOT of 2026-10-07, §3.5.4.2 and §3.5.4.5): the words of the Supplier orders
 * page (its Suppliers section for now; To order and the supplier orders come with step 5.11d), a supplier's form, and a
 * model's Supplier row and column in its Sizes section. Pure: the views render these; the server stays the authority
 * (409 SUPPLIER_NAME_TAKEN, the currency's decimals, 404 SKU_NOT_FOUND).
 */
import type { ModelSizeRow, ModelSizes, ModelSupplier, ModelSupplierChange, Supplier, SupplierInput, SupplierRef } from '../types.js';

export const SUPPLIER_ORDERS_TEXT = Object.freeze({
  lead: 'What ORBES orders from its suppliers. The console adds up what is missing (the orders waiting for stock and the stock under its minimum) into a draft per supplier; you adjust it, mark it sent, and send its PDF to the supplier yourself: the console sends no email.',
  suppliersEmpty: 'No supplier yet: add the first one.',
  add: 'Add a supplier',
  addTitle: 'Add a supplier',
  editTitle: 'Edit the supplier',
  added: 'Supplier added.',
  saved: 'Supplier saved.',
  currencyHint: 'Any currency with cents, such as EUR, GBP, USD or CHF.',
  activeHint: 'An inactive supplier stays on its models and orders and is offered for no new draft.',
});

export const MODEL_SUPPLIER_TEXT = Object.freeze({
  none: 'No supplier yet.',
  title: 'Supplier',
  text: 'The supplier that makes this model’s pieces. A size may have its own; a size left on the model’s uses this one.',
  modelOption: 'None',
  sizeOption: 'The model’s',
  saved: 'Supplier saved.',
  unchanged: 'Nothing has changed.',
});

/** Its name, and ' · INACTIVE' when it is set inactive. */
export function supplierName(s: Pick<SupplierRef, 'name' | 'active'>): string {
  return s.active ? s.name : `${s.name} · INACTIVE`;
}

/**
 * A model's Supplier row (§3.5.4.5): 'No supplier yet.', its own supplier's name, or a variant's main model's with the
 * note 'Reads its supplier from MONOLITHE.'.
 */
export function supplierLine(s: ModelSupplier): { value: string; note: string | null } {
  if (s.own) return { value: supplierName(s.own), note: null };
  if (s.inherited) return { value: supplierName(s.inherited), note: `Reads its supplier from ${s.inherited.from}.` };
  return { value: MODEL_SUPPLIER_TEXT.none, note: null };
}

/** A size's Supplier cell: its own supplier's name; empty when it uses its model's. */
export function sizeSupplierText(s: ModelSupplier, row: Pick<ModelSizeRow, 'skuId'>): string {
  const own = s.sizes[row.skuId];
  return own ? supplierName(own) : '';
}

/**
 * The suppliers a select offers: the active ones by name, and those already chosen even when inactive (so a choice
 * kept is not lost); `empty` first, its value ''.
 */
export function supplierOptions(suppliers: readonly Supplier[], chosen: readonly (string | null | undefined)[], empty: string): { value: string; label: string }[] {
  const keep = new Set(chosen.filter((x): x is string => typeof x === 'string'));
  return [{ value: '', label: empty }, ...suppliers.filter((s) => s.active || keep.has(s.id)).map((s) => ({ value: s.id, label: supplierName(s) }))];
}

/** The field of a size's supplier in the Supplier dialog. */
export const sizeSupplierField = (skuId: string) => `size_${skuId}`;

/** The change the Supplier dialog's values make, only what differs from the section; null when nothing does. */
export function modelSupplierChange(sizing: Pick<ModelSizes, 'sizes' | 'supplier'>, values: Record<string, string>): ModelSupplierChange | null {
  const out: ModelSupplierChange = {};
  const own = values.supplier ? values.supplier : null;
  if (own !== (sizing.supplier.own?.id ?? null)) out.supplierId = own;
  const sizes: Record<string, string | null> = {};
  for (const row of sizing.sizes) {
    const v = values[sizeSupplierField(row.skuId)];
    if (v === undefined) continue;
    const next = v ? v : null;
    if (next !== (sizing.supplier.sizes[row.skuId]?.id ?? null)) sizes[row.skuId] = next;
  }
  if (Object.keys(sizes).length > 0) out.sizes = sizes;
  return Object.keys(out).length > 0 ? out : null;
}

/** A supplier's form values, as the dialog opens: its fields, '' for those it has not. */
export function supplierFormValues(s: Supplier | null): Record<'name' | 'contactName' | 'email' | 'phone' | 'address' | 'currency' | 'note' | 'active', string> {
  return {
    name: s?.name ?? '',
    contactName: s?.contactName ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    address: s?.address ?? '',
    currency: s?.currency ?? '',
    note: s?.note ?? '',
    active: s === null || s.active ? 'true' : '',
  };
}

/** What the supplier dialog sends: every field, an empty one as null (cleared), the currency in capitals. */
export function supplierInputOf(values: Record<string, string>): SupplierInput {
  const opt = (k: string) => (values[k] ?? '').trim() || null;
  return {
    name: (values.name ?? '').trim(),
    contactName: opt('contactName'),
    email: opt('email'),
    phone: opt('phone'),
    address: opt('address'),
    currency: opt('currency')?.toUpperCase() ?? null,
    note: opt('note'),
    active: values.active === 'true',
  };
}

/** The Contact cell of the Suppliers table: the contact's name, then the email and phone under it. */
export function contactLines(s: Pick<Supplier, 'contactName' | 'email' | 'phone'>): { main: string; sub: string } {
  const sub = [s.email, s.phone].filter((x): x is string => !!x).join(' · ');
  return { main: s.contactName ?? (sub ? '' : '—'), sub };
}
