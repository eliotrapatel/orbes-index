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
 *   stockPieces  (step 5.9) pieces of a size in stock at a location: issued by the Generator with the batch and the time
 *                asked (so serials follow the same order as before), counted in (LogisticsService.countIn), then the
 *                count corrected up by ORBES there, which serves the orders waiting there, the oldest first. With
 *                `forOrderIds`, it checks that those orders now hold STOCK, so a fixture never ships an order that an
 *                older waiting order of the same size overtook.
 *   packAndShip  (step 5.9) an order's parcel packed and shipped through the agent's steps, as ORBES staff: a fixture
 *                address first when its first order has none (name 'Test buyer', address '1 rue de Test\n75001 Paris'),
 *                Start packing, each order's piece scanned by its ORBES CODE (the piece already bound to it, the one
 *                named in `pieces`, or its size's first piece in stock by serial), a fixture photo, every line ticked,
 *                the optional `beforeShip` (a warranty started by hand, which SHIP then leaves as it is), then Ship.
 */
import { toBase64Url } from '../../src/core/bytes.js';
import type { AppContext } from '../../src/server/context.js';
import type { AtelierService } from '../../src/server/services/atelier.js';
import { parcelKeyOf } from '../../src/server/services/parcels.js';
import type { Actor, ManualClock } from '../../src/server/types.js';
import { jpegPhoto } from './images.js';

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

export interface StockPiecesInput {
  skuId: string;
  locationId: string;
  count: number;
  /** The production batch printed on the pieces. */
  productionBatch?: string;
  /** When the pieces are issued and counted: the clock is set there first. */
  at?: Date | string;
  clock?: ManualClock;
  /** Its material; the model's default material, or its latest piece's, otherwise. */
  material?: string;
  /** Orders that must hold STOCK once the count is up (the fixture's own). */
  forOrderIds?: readonly string[];
}

/** Pieces of a size in stock at a location, through the real paths: issued, counted in, the count corrected up. */
export async function stockPieces(ctx: AppContext, input: StockPiecesInput, admin: Actor): Promise<StockedPiece[]> {
  if (input.at !== undefined) {
    if (!input.clock) throw new Error('stockPieces: a time asked needs the clock');
    input.clock.set(input.at);
  }
  const sku = await ctx.db
    .selectFrom('skus as k')
    .innerJoin('models as m', 'm.id', 'k.model_id')
    .innerJoin('categories as c', 'c.id', 'm.category_id')
    .select(['k.id', 'k.model_id', 'k.size_label', 'm.default_material', 'c.code as category'])
    .where('k.id', '=', input.skuId)
    .executeTakeFirstOrThrow();
  const latest = await ctx.db.selectFrom('products').select('material').where('model_id', '=', sku.model_id).where('status', '!=', 'RESERVED').orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  const material = input.material ?? (sku.default_material?.trim() || latest?.material);
  if (!material) throw new Error('stockPieces: the model names no material');
  const out: StockedPiece[] = [];
  for (let i = 0; i < input.count; i++) {
    const issued = await ctx.services.issuance.issueProduct(
      {
        categoryCode: sku.category.trim(),
        modelId: sku.model_id,
        ...(sku.size_label !== null ? { variant: sku.size_label } : {}),
        material,
        ...(input.productionBatch ? { productionBatch: input.productionBatch } : {}),
        withClaimSecret: true,
      },
      admin,
    );
    out.push({
      uuid: issued.product.id,
      productId: issued.product.productId,
      codeId: issued.code.id,
      data: issued.code.data,
      glyphs: [...issued.genome.glyphs],
      ...(issued.claimCode ? { claimCode: issued.claimCode } : {}),
    });
  }
  await ctx.services.logistics.countIn(input.skuId, { productRefs: out.map((p) => p.productId), note: 'Pieces on the shelf.' }, admin);
  await ctx.services.logistics.proposeCorrection({ skuId: input.skuId, locationId: input.locationId, delta: input.count, reason: 'Pieces counted in.' }, admin, null);
  for (const id of input.forOrderIds ?? []) {
    const o = await ctx.db.selectFrom('orders').select('reservation').where('id', '=', id).executeTakeFirstOrThrow();
    if (o.reservation !== 'STOCK') throw new Error(`stockPieces: order ${id} does not hold its piece (${o.reservation}): an older order of its size took it`);
  }
  return out;
}

/** The fixture address packAndShip enters when a parcel's first order has none. */
export const FIXTURE_BUYER = Object.freeze({ name: 'Test buyer', address: '1 rue de Test\n75001 Paris' });

export interface PackAndShipInput {
  carrierId: string;
  trackingNumber: string;
  /** The value declared for the order named (ORBES staff). */
  declaredValueMinor?: number | null;
  /** When it ships: the clock is set there first (packing happens at that time too). */
  at?: Date | string;
  clock?: ManualClock;
  /** The piece (its serial or row id) to scan for an order, by order id; its size's first piece in stock otherwise. */
  pieces?: Readonly<Record<string, string>>;
  /** Run after Packed, before Ship (a warranty started by hand: SHIP leaves it as it is). */
  beforeShip?: () => Promise<void>;
}

/** An order's parcel packed and shipped through the agent's steps, as ORBES staff (`actor`). */
export async function packAndShip(ctx: AppContext, orderId: string, input: PackAndShipInput, actor: Actor): Promise<void> {
  if (input.at !== undefined) {
    if (!input.clock) throw new Error('packAndShip: a time asked needs the clock');
    input.clock.set(input.at);
  }
  const lg = ctx.services.logistics;
  const key = await parcelKeyOf(ctx.db, orderId);
  if (!key) throw new Error(`packAndShip: no order ${orderId}`);
  const first = await ctx.db.selectFrom('orders').select(['buyer_name', 'buyer_address']).where('id', '=', key).executeTakeFirstOrThrow();
  if (first.buyer_name === null || first.buyer_address === null) await ctx.services.orders.setBuyer(key, { ...FIXTURE_BUYER }, actor);
  let view = await lg.startPacking(key, actor, null);
  const taken = new Set<string>();
  for (const o of view.orders) {
    const row = await ctx.db.selectFrom('orders').select(['product_id', 'sku_id']).where('id', '=', o.orderId).executeTakeFirstOrThrow();
    const named = input.pieces?.[o.orderId];
    let piece: string | undefined = row.product_id ?? undefined;
    if (!piece && named) piece = (await ctx.db.selectFrom('products').select('id').where((eb) => eb.or([eb('product_id', '=', named.toUpperCase()), eb('id', '=', named.toLowerCase())])).executeTakeFirstOrThrow()).id;
    if (!piece) {
      const free = await ctx.db
        .selectFrom('products as p')
        .select(['p.id'])
        .where('p.sku_id', '=', row.sku_id!)
        .where('p.stock_entered_at', 'is not', null)
        .where('p.status', 'in', ['ISSUED', 'RESOLD'])
        .where('p.ownership_state', '=', 'UNREGISTERED')
        .where((eb) => eb.not(eb.exists(eb.selectFrom('orders as x').select('x.id').whereRef('x.product_id', '=', 'p.id').where('x.status', 'not in', ['CANCELLED', 'RETURNED']))))
        .orderBy('p.product_id')
        .execute();
      piece = free.find((p) => !taken.has(p.id))?.id;
      if (!piece) throw new Error(`packAndShip: no piece in stock for order ${o.orderId}`);
    }
    taken.add(piece);
    const code = await ctx.db.selectFrom('codes').select('id').where('product_id', '=', piece).where('status', '=', 'ACTIVE').executeTakeFirstOrThrow();
    const data = await ctx.services.issuance.verifiedActiveCode(code.id);
    view = (await lg.scanCard(key, { code: toBase64Url(data.data) }, actor, {}, null)).parcel;
  }
  await lg.setPhoto(key, { mime: 'image/jpeg', bytes: jpegPhoto(16, 12) }, actor, null);
  view = await lg.parcel(key, null);
  await lg.checkPacked(key, { ticked: view.checklist.filter((l) => !l.byScan).map((l) => l.key) }, actor, null);
  if (input.beforeShip) await input.beforeShip();
  await lg.ship(
    key,
    {
      carrierId: input.carrierId,
      trackingNumber: input.trackingNumber,
      ...(input.declaredValueMinor !== undefined ? { declaredValues: [{ orderId, minor: input.declaredValueMinor }] } : {}),
    },
    actor,
    null,
  );
}
