/**
 * Who a SKU belongs to (migration 0056, macro scope K48 D1; lot M3 plan §0 and §4.2, steps M3.8 and M3.9): a model's
 * size or an add-on (`skus_owner`, exactly one). The two kinds share one ledger, its minimums, its supplier orders and
 * its receptions, so every reader that lists SKUs names each by its owner:
 *
 *   a model's size   its model (and the model's variant label) and its size, ONE SIZE when it has none; offered while
 *                    the size is not set aside (plan NEXT LOT §3.3).
 *   an add-on's SKU  its add-on, by the name the collector reads (POLISHING CLOTH); no size, no fit, no ORBES CODE;
 *                    offered while its add-on is active (set aside: `addon_items.active` false).
 *
 * The readers that mean a model's sizes (a release's, the salon's, the Generator's, a model's page) keep their inner
 * join to `models`, so an add-on's SKU never appears among them; the readers that list SKUs (Logistics' stock, the
 * corrections, transfers and minimums, the supplier proposal, drafts, orders and their PDF, the receptions) read
 * `skuRefs`, which names either.
 */
import type { Db } from '../db/connection.js';
import { conflict } from '../errors.js';
import { ONE_SIZE_LABEL } from './stock.js';

/** A SKU's owner: a model (its size) or an add-on. */
export type SkuOwner = { kind: 'MODEL'; modelId: string } | { kind: 'ADD_ON'; addonId: string };

/** A SKU row's owner (exactly one of `model_id` and `addon_id`, `skus_owner`). */
export function skuOwnerOf(k: { readonly model_id: string | null; readonly addon_id: string | null }): SkuOwner {
  if (k.model_id !== null) return { kind: 'MODEL', modelId: k.model_id };
  if (k.addon_id !== null) return { kind: 'ADD_ON', addonId: k.addon_id };
  throw new Error('A SKU has a model or an add-on (skus_owner).');
}

/** 409 ADDON_SET_ASIDE: an add-on set aside is offered nowhere (no minimum, no supplier order, no order), named. */
export const addonSetAside = (name: string) => conflict('ADDON_SET_ASIDE', `${name} is set aside. Reinstate it in Catalogue → Add-ons to offer it again.`);

/**
 * A SKU as the supplier orders, the receptions and Logistics name it: a model's size (its model, the model's variant,
 * its size) or an add-on's SKU (its add-on; `model` null, no variant, no size), and its code.
 */
export interface SupplierOrderSku {
  id: string;
  code: string;
  /** The model it is a size of; null for an add-on's SKU. */
  model: { id: string; name: string } | null;
  /** Macro scope K48 D1 (plan MACRO M3 §4.2): the add-on it is; null for a model's size. */
  addon: { id: string; name: string } | null;
  /** The variant's label (BLUE) of a variant model; null otherwise (and for an add-on). */
  variant: string | null;
  /** Its size; null for a model in one size (ONE SIZE) and for an add-on. */
  sizeLabel: string | null;
  /** No longer offered: a size set aside, or an add-on set aside. */
  setAside: boolean;
}

/** A model's size as SupplierOrderSku names it. */
export type ModelSku = SupplierOrderSku & { model: { id: string; name: string } };

/** The SKUs named, by id, each with its owner named (a SKU unknown is absent). */
export async function skuRefs(db: Db, ids: readonly string[]): Promise<Map<string, SupplierOrderSku>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('skus as k')
    .leftJoin('models as m', 'm.id', 'k.model_id')
    .leftJoin('addon_items as a', 'a.id', 'k.addon_id')
    .select(['k.id', 'k.code', 'k.size_label', 'k.set_aside_at', 'k.model_id', 'k.addon_id', 'm.name as model_name', 'm.variant_label', 'a.name as addon_name', 'a.active as addon_active'])
    .where('k.id', 'in', [...new Set(ids)])
    .execute();
  return new Map(
    rows.map((r) => {
      const owner = skuOwnerOf(r);
      const sku: SupplierOrderSku =
        owner.kind === 'MODEL'
          ? { id: r.id, code: r.code, model: { id: owner.modelId, name: r.model_name! }, addon: null, variant: r.variant_label, sizeLabel: r.size_label, setAside: r.set_aside_at !== null }
          : { id: r.id, code: r.code, model: null, addon: { id: owner.addonId, name: r.addon_name! }, variant: null, sizeLabel: null, setAside: r.set_aside_at !== null || r.addon_active !== true };
      return [r.id, sku];
    }),
  );
}

/**
 * A SKU named as the console, its errors and the supplier order's PDF say it: a model's size MONOLITHE · BLUE · 52 (ONE
 * SIZE for a model in one size), an add-on's SKU by its add-on (POLISHING CLOTH).
 */
export function skuWords(s: { model: { name: string } | null; addon?: { name: string } | null; variant: string | null; sizeLabel: string | null }): string {
  if (s.model === null) return s.addon?.name ?? '';
  return [s.model.name, s.variant, s.sizeLabel ?? ONE_SIZE_LABEL].filter((x): x is string => x !== null && x !== '').join(' · ');
}

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/**
 * The add-ons' SKUs after the models' sizes, as a group of their own (by add-on, then code): each list keeps its own
 * order among the models' sizes (`modelOrder`, given two SKUs that both have a model).
 */
export function addonsLast(a: SupplierOrderSku, b: SupplierOrderSku, modelOrder: (a: ModelSku, b: ModelSku) => number): number {
  if (a.model !== null && b.model !== null) return modelOrder(a as ModelSku, b as ModelSku);
  if (a.model !== null) return -1;
  if (b.model !== null) return 1;
  return natural(a.addon?.name ?? '', b.addon?.name ?? '') || a.code.localeCompare(b.code);
}
