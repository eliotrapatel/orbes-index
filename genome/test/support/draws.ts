/**
 * Draws in the tests and the demo (plan NEXT LOT §3.6.F, step 6.2). DropService.create now takes a draw's sizes and their
 * pieces and refuses a quantity; a DRAFT without sizes is no longer published.
 *
 * `poolDraw` makes a draw as one created before this lot reads, one pool and no sizes (the case every test written before
 * the sizes means, and the demo's draws: « draws published before this lot keep one pool »): created through the service
 * with one size holding its quantity, published when asked (before its size is taken away, as publication now requires
 * sizes), then its size removed, and the SKU its size created for the model removed too, so that nothing else about the
 * model changes. A DRAFT made so (`publish: false`) is a draft of before this lot: it is never published. A model with no
 * size type, which a draw now refuses (409 DROP_MODEL_SIZES_MISSING), is given ONE SIZE for the creation and the
 * publication only, with a SKU of no size when it has none, then gets its own type and kind back.
 *
 * `oneSizeOf` gives the label of one of a model's sizes, for a draw with sizes in a test: its first offered size, or
 * ONE SIZE for a model of one size or without a type.
 *
 * A draw's sizes are its model's offered sizes (plan NEXT LOT §3.6.F, §5.1 #20): a model with no size type takes no
 * draw (409 DROP_MODEL_SIZES_MISSING). `giveSizes` gives a model its type and its sizes for good, as the Catalogue
 * declares them; `withDrawSizes` gives them to a model of no type for one creation and publication only, then gives it
 * back its own type and kind (its SKUs kept), for the tests whose other flows read that model as a model of no type.
 * `poolDraw` does the same with ONE SIZE.
 */
import type { Db } from '../../src/server/db/connection.js';
import type { SizeType } from '../../src/server/db/schema.js';
import type { AdminDrop, CreateDropInput, DropService } from '../../src/server/services/drops.js';
import { offeredSizes, SIZE_TYPE_KIND } from '../../src/server/services/sizes.js';
import { ensureSku, ONE_SIZE_LABEL, sizeLabelOf } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';

export type PoolDrawInput = Omit<CreateDropInput, 'sizes' | 'quantity'> & { quantity: number };

/** A label of one of the model's sizes: its first offered size, else ONE SIZE (a model without a type takes any). */
export async function oneSizeOf(db: Db, modelId: string): Promise<string> {
  const m = await db.selectFrom('models').select('size_type').where('id', '=', modelId).executeTakeFirstOrThrow();
  if (m.size_type === null) return ONE_SIZE_LABEL;
  const first = (await offeredSizes(db, modelId))[0];
  return first?.label ?? ONE_SIZE_LABEL;
}

/**
 * Give a model its size type and the sizes `labels`, each its own SKU (created when missing): ONE SIZE alone makes it a
 * model of one size (ONE_SIZE), other sizes a model of `type` (RING by default), its kind the type's.
 */
export async function giveSizes(db: Db, modelId: string, labels: readonly string[] = [ONE_SIZE_LABEL], type: SizeType = 'RING'): Promise<void> {
  const sizeType: SizeType = labels.every((l) => sizeLabelOf(l) === null) ? 'ONE_SIZE' : type;
  await db.updateTable('models').set({ size_type: sizeType, size_kind: SIZE_TYPE_KIND[sizeType] }).where('id', '=', modelId).execute();
  for (const l of labels) await ensureSku(db, modelId, l);
}

/**
 * `make` (a draw's creation, and its publication) run while the model has its sizes: a model of no type is given them
 * (`giveSizes`) for `make` only, then gets back its own type and kind, the SKUs made for them kept; a typed model is left
 * as it is.
 */
export async function withDrawSizes<T>(db: Db, modelId: string, labels: readonly string[], make: () => Promise<T>, type: SizeType = 'RING'): Promise<T> {
  const model = await db.selectFrom('models').select(['size_type', 'size_kind']).where('id', '=', modelId).executeTakeFirstOrThrow();
  if (model.size_type !== null) return make();
  await giveSizes(db, modelId, labels, type);
  try {
    return await make();
  } finally {
    await db.updateTable('models').set({ size_type: null, size_kind: model.size_kind }).where('id', '=', modelId).execute();
  }
}

/** A draw of one pool, as created before this lot (see the header): published unless `publish` is false. */
export async function poolDraw(drops: DropService, db: Db, input: PoolDrawInput, actor: Actor, opts: { publish?: boolean } = {}): Promise<AdminDrop> {
  const { quantity, ...rest } = input;
  const before = new Set((await db.selectFrom('skus').select('id').where('model_id', '=', input.modelId).execute()).map((r) => r.id));
  const label = await oneSizeOf(db, input.modelId);
  const d = await withDrawSizes(db, input.modelId, [label], async () => {
    const created = await drops.create({ ...rest, sizes: [{ label, pieces: quantity }] }, actor);
    if (opts.publish !== false) await drops.publish(created.id, actor);
    return created;
  });
  await db.deleteFrom('drop_sizes').where('drop_id', '=', d.id).execute();
  const created = (await db.selectFrom('skus').select('id').where('model_id', '=', input.modelId).execute()).map((r) => r.id).filter((id) => !before.has(id));
  if (created.length > 0) await db.deleteFrom('skus').where('id', 'in', created).execute();
  return drops.get(d.id);
}
