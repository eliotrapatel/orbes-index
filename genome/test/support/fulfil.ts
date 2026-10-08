/**
 * Fulfilment in tests and fixtures (plan NEXT LOT of 2026-10-07, §3.5.10, « the shared helper »): the real paths, so
 * that tests and fixtures exercise what staff and the agent do.
 *
 *   stockPiece   (step 5.5) the piece of an order that used to be made for it at the atelier: a piece issued by the
 *                Generator with the batch and the time asked (so serials follow the same order as before), then bound
 *                to the order with Link a piece (AtelierService.linkFromStock): an order waiting for supplier stock
 *                (AWAITING) takes it, the piece counted in with the order when nothing is available at its location
 *                (PRODUCED, +1), as Link a piece does. It goes with the atelier in step 5.13, once `stockPieces` and
 *                `packAndShip` (step 5.9) serve every fixture.
 */
import type { AppContext } from '../../src/server/context.js';
import type { AtelierService } from '../../src/server/services/atelier.js';
import type { Actor, ManualClock } from '../../src/server/types.js';

/** A piece issued for a fixture: its row id, reference, code and claim code (shown once at issue). */
export interface StockedPiece {
  uuid: string;
  productId: string;
  codeId: string;
  /** The code's data, base64url, as the Generator returns it. */
  data: string;
  glyphs: number[];
  claimCode?: string;
}

export interface StockPieceInput {
  orderId: string;
  /** The production batch printed on the piece (B-2026-09-DRAW in the demo). */
  productionBatch?: string;
  /** When the piece is issued and linked: the clock is set there first. */
  at?: Date | string;
  clock?: ManualClock;
  /** Its material; the model's default material, or its latest piece's, otherwise. */
  material?: string;
  /** The service that links it, on a clock of its own (scripts/capture-ui.ts's past); the context's otherwise. */
  atelier?: Pick<AtelierService, 'linkFromStock'>;
}

/**
 * A Generator piece of the order's model in the order's size, issued with the batch asked at the time asked, then bound
 * to the order with Link a piece; the order then holds it in stock.
 */
export async function stockPiece(ctx: AppContext, input: StockPieceInput, admin: Actor): Promise<StockedPiece> {
  if (input.at !== undefined) {
    if (!input.clock) throw new Error('stockPiece: a time asked needs the clock');
    input.clock.set(input.at);
  }
  const order = await ctx.db
    .selectFrom('orders as o')
    .innerJoin('models as m', 'm.id', 'o.model_id')
    .innerJoin('categories as c', 'c.id', 'm.category_id')
    .select(['o.id', 'o.model_id', 'o.size_label', 'o.sku_id', 'm.default_material', 'c.code as category'])
    .where('o.id', '=', input.orderId)
    .executeTakeFirstOrThrow();
  if (order.sku_id === null) throw new Error(`stockPiece: order ${input.orderId} has no size yet`);
  // As an identity reserved for a piece to make took it (issuance.ts reserveIdentity): the model's, or its latest piece's.
  const latest = await ctx.db.selectFrom('products').select('material').where('model_id', '=', order.model_id).where('status', '!=', 'RESERVED').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  const material = input.material ?? (order.default_material?.trim() || latest?.material);
  if (!material) throw new Error('stockPiece: the model names no material');
  const issued = await ctx.services.issuance.issueProduct(
    {
      categoryCode: order.category.trim(),
      modelId: order.model_id,
      ...(order.size_label !== null ? { variant: order.size_label } : {}),
      material,
      ...(input.productionBatch ? { productionBatch: input.productionBatch } : {}),
      withClaimSecret: true,
    },
    admin,
  );
  await (input.atelier ?? ctx.services.atelier).linkFromStock(order.id, issued.product.productId, admin);
  return {
    uuid: issued.product.id,
    productId: issued.product.productId,
    codeId: issued.code.id,
    data: issued.code.data,
    glyphs: [...issued.genome.glyphs],
    ...(issued.claimCode ? { claimCode: issued.claimCode } : {}),
  };
}
