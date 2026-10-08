/**
 * Draws in the tests and the demo (plan NEXT LOT §3.6.F, step 6.2). DropService.create now takes a draw's sizes and their
 * pieces and refuses a quantity; a DRAFT without sizes is no longer published.
 *
 * `poolDraw` makes a draw as one created before this lot reads, one pool and no sizes (the case every test written before
 * the sizes means, and the demo's draws: « draws published before this lot keep one pool »): created through the service
 * with one size holding its quantity, published when asked (before its size is taken away, as publication now requires
 * sizes), then its size removed, and the SKU its size created for the model removed too, so that nothing else about the
 * model changes. A DRAFT made so (`publish: false`) is a draft of before this lot: it is never published.
 *
 * `oneSizeOf` gives the label of one of a model's sizes, for a draw with sizes in a test: its first offered size, or
 * ONE SIZE for a model of one size or without a type.
 */
import type { Db } from '../../src/server/db/connection.js';
import type { AdminDrop, CreateDropInput, DropService } from '../../src/server/services/drops.js';
import { offeredSizes } from '../../src/server/services/sizes.js';
import { ONE_SIZE_LABEL } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';

export type PoolDrawInput = Omit<CreateDropInput, 'sizes' | 'quantity'> & { quantity: number };

/** A label of one of the model's sizes: its first offered size, else ONE SIZE (a model without a type takes any). */
export async function oneSizeOf(db: Db, modelId: string): Promise<string> {
  const m = await db.selectFrom('models').select('size_type').where('id', '=', modelId).executeTakeFirstOrThrow();
  if (m.size_type === null) return ONE_SIZE_LABEL;
  const first = (await offeredSizes(db, modelId))[0];
  return first?.label ?? ONE_SIZE_LABEL;
}

/** A draw of one pool, as created before this lot (see the header): published unless `publish` is false. */
export async function poolDraw(drops: DropService, db: Db, input: PoolDrawInput, actor: Actor, opts: { publish?: boolean } = {}): Promise<AdminDrop> {
  const { quantity, ...rest } = input;
  const before = new Set((await db.selectFrom('skus').select('id').where('model_id', '=', input.modelId).execute()).map((r) => r.id));
  const d = await drops.create({ ...rest, sizes: [{ label: await oneSizeOf(db, input.modelId), pieces: quantity }] }, actor);
  if (opts.publish !== false) await drops.publish(d.id, actor);
  await db.deleteFrom('drop_sizes').where('drop_id', '=', d.id).execute();
  const created = (await db.selectFrom('skus').select('id').where('model_id', '=', input.modelId).execute()).map((r) => r.id).filter((id) => !before.has(id));
  if (created.length > 0) await db.deleteFrom('skus').where('id', 'in', created).execute();
  return drops.get(d.id);
}
