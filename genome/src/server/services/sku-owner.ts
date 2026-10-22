/**
 * Who a SKU belongs to (migration 0056, macro scope K48 D1; lot M3 plan §0 and §4.2, step M3.8): a model's size or an
 * add-on (`skus_owner`, exactly one). Until the add-on catalogue exists (M3.9), no flow creates an add-on's SKU, so the
 * readers that mean a model's size read its model through `skuModelId`, which refuses the other owner rather than pass
 * on a NULL; M3.9 replaces each with an owner-aware read.
 */

/** The model a SKU is a size of; throws on an add-on's SKU (no model), which these readers never meet yet. */
export function skuModelId(k: { readonly model_id: string | null }): string {
  if (k.model_id === null) throw new Error('This SKU is an add-on’s, not a model’s size.');
  return k.model_id;
}
