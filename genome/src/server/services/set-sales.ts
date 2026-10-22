/**
 * THE SET sold (macro scope of 2026-10-20, K44 T1 to T3; lot M3 plan §5.1 and §5.2, step M3.14; migration 0057): each set
 * sold is a set sale, with one order per piece.
 *
 *   the set sale   one row per set sold (`set_sales`): its set, its release, its account, the one price and currency (both
 *                  or neither: a draw without a price has none until Client Services enters each order's), and its future
 *                  Shopify line item (S5). A set sale from the store (S2) will name no release.
 *   its orders     one per piece, in the set's order (`set_piece`, its position), each of its piece's model in the size
 *                  the entry chose for that piece (the release's size, its SKU its piece's model's), all travelling in one
 *                  parcel with the entry's first order (`with_order_id`): T2, each piece then takes its own ORBES identity
 *                  at packing (its card's scan binds it, as any order's) and counts toward the tier once registered,
 *                  with no change to the club's counting.
 *   the price      the set's one price shared over its pieces' orders (§15 note 11, `setShares`): in proportion to their
 *                  models' base prices in the release's currency when each has one (a variant's own, else its main
 *                  model's), otherwise equally; each share floored, the remainder on the first piece. Each order carries
 *                  its share as its price, so each piece's invoice, return and exchange keep working as any order's, and
 *                  its invoice says it is « Part of THE SET <name> » (services/invoices.ts). The collector reads one
 *                  price: the set's (YOUR ORDERS' `set`, services/orders.ts forAccount).
 *   on the first   the shipping (THE PROGRAM's free shipping or its fee) is on the entry's first order, the others travel
 *                  with it, as a LIVE entry of several pieces; a release add-on (`live_addons`) of a set's release is per
 *                  set, on its first piece's order.
 *   cancel         a set sold is cancelled whole (§15 note 12): cancelling one of its orders cancels its set's other open
 *                  orders in the same transaction, refused (409 SET_SHIPPED) once one of them has shipped
 *                  (services/orders.ts transition).
 *   return         a set is returned whole (T3): a RETURN asked on one of its pieces opens one for each piece still
 *                  shipped or delivered, as one group, decided together once every piece is back (services/order-cases.ts);
 *                  a size exchange of one piece stays possible, its EXCHANGE order joining the set sale in its piece's
 *                  place (`createExchangeOrder` carries `set_sale_id` and `set_piece`).
 *
 * `ordersForSetSale` is the core the set's draw (services/drops.ts via orders.ts `orderForDrawEntry`, M3.15) and its LIVE
 * RELEASE (services/live.ts via orders.ts `ordersForLiveEntry`, M3.16) call in the transaction that confirms an entry;
 * the welcome gift and the catalogue add-ons chosen go on the entry's first order there, as for a model's entry.
 */
import type { Db } from '../db/connection.js';
import type { OrderAddonSnapshot, OrderRow, SetSaleRow } from '../db/schema.js';
import type { Actor } from '../types.js';
import type { AuditRecordInput } from './audit.js';
import { createOrder, orderReference, shippingFor, travellingShipping } from './orders.js';
import { setPieces } from './release-offer.js';
import { offeredSku } from './sizes.js';
import { sizeLabelOf } from './stock.js';

/**
 * The set's price shared over its pieces (§15 note 11): by `bases` (each piece's model's base price in the sale's
 * currency) when every piece has one and they add up to more than 0, otherwise equally; each share floored, the
 * remainder on the first piece, so the shares add up to `priceMinor` exactly. Pure.
 */
export function setShares(priceMinor: number, bases: readonly (number | null)[]): number[] {
  const n = bases.length;
  if (n === 0) return [];
  const known = bases.every((b): b is number => b !== null && b >= 0);
  const total = known ? bases.reduce<number>((t, b) => t + (b ?? 0), 0) : 0;
  const shares =
    known && total > 0
      ? bases.map((b) => Number((BigInt(priceMinor) * BigInt(b!)) / BigInt(total)))
      : bases.map(() => Math.floor(priceMinor / n));
  shares[0] = shares[0]! + priceMinor - shares.reduce((t, s) => t + s, 0);
  return shares;
}

/** Each piece model's base price in `currency` (a variant's own, else its main model's), in the pieces' order; null without one. */
async function baseShares(tx: Db, modelIds: readonly string[], currency: string): Promise<(number | null)[]> {
  const rows = await tx
    .selectFrom('models as m')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .select(['m.id', 'm.base_price_minor', 'm.base_currency', 'main.base_price_minor as main_price', 'main.base_currency as main_currency'])
    .where('m.id', 'in', [...modelIds])
    .execute();
  return modelIds.map((id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return null;
    if (r.base_price_minor !== null && r.base_currency !== null) return r.base_currency === currency ? r.base_price_minor : null;
    if (r.main_price !== null && r.main_currency !== null) return r.main_currency === currency ? r.main_price : null;
    return null;
  });
}

/** Where a set sale comes from: a draw's entry (one set), or a LIVE entry's `set`-th set (1 to its quantity). */
export type SetSaleSource = { channel: 'DRAW'; dropEntryId: string } | { channel: 'LIVE'; liveEntryId: string; set: number };

export interface SetSaleInput {
  setId: string;
  dropId: string;
  accountId: string;
  source: SetSaleSource;
  /** The size chosen for each piece: a size of the release (`drop_sizes.id`) given for that piece, one per piece. */
  sizes: readonly { piece: number; sizeId: string }[];
  /** The one price and currency (both or neither). */
  priceMinor: number | null;
  currency: string | null;
  /** Where its orders are served from (the release's location, else the default). */
  locationId: string;
  /** The release's add-ons as sold with this set (`live_addons`), on its first piece's order. */
  addons?: readonly OrderAddonSnapshot[];
  /** The release's surprise, on each of its orders (as on each piece of a LIVE entry). */
  surprise?: string | null;
  /** The entry's first order when this set is not its first: every order travels with it. */
  parent?: OrderRow | null;
  /** When the sale was made, for orders created after it. */
  reservedAt?: Date;
  /** Take what each order holds (false: a reservation cancelled before its orders existed). */
  hold?: boolean;
}

/**
 * One set sold (see the header), in the caller's transaction (the entry and the release held): the set sale, then one
 * order per piece in the set's order, each its share of the price, its piece's model and size, travelling with the
 * entry's first order (the shipping on it). Returns the sale, its orders and the audit entries to write last. Throws on
 * a size that is not of this release and piece, or a piece without a size: the callers check the entry's sizes first.
 */
export async function ordersForSetSale(
  tx: Db,
  input: SetSaleInput,
  actor: Actor,
  now: Date,
): Promise<{ sale: SetSaleRow; orders: OrderRow[]; notes: AuditRecordInput[] }> {
  const pieces = await setPieces(tx, input.setId);
  if (pieces.length === 0) throw new Error(`ordersForSetSale: set ${input.setId} has no piece`);
  const sizes = await tx
    .selectFrom('drop_sizes')
    .select(['id', 'piece', 'label', 'sku_id'])
    .where('drop_id', '=', input.dropId)
    .where('id', 'in', input.sizes.map((s) => s.sizeId))
    .execute();
  const chosen = pieces.map((p) => {
    const asked = input.sizes.filter((s) => s.piece === p.piece);
    const size = asked.length === 1 ? sizes.find((z) => z.id === asked[0]!.sizeId && z.piece === p.piece) : undefined;
    if (!size) throw new Error(`ordersForSetSale: piece ${String(p.piece)} has no size of release ${input.dropId}`);
    return { piece: p.piece!, modelId: p.model.id, size };
  });
  if (input.sizes.length !== pieces.length) throw new Error('ordersForSetSale: one size per piece');
  const priced = input.priceMinor !== null && input.currency !== null;
  const shares = priced ? setShares(input.priceMinor!, await baseShares(tx, chosen.map((c) => c.modelId), input.currency!)) : chosen.map(() => null);
  const sale = await tx
    .insertInto('set_sales')
    .values({ set_id: input.setId, drop_id: input.dropId, account_id: input.accountId, price_minor: priced ? input.priceMinor : null, currency: priced ? input.currency : null, created_at: input.reservedAt && input.reservedAt < now ? input.reservedAt : now })
    .returningAll()
    .executeTakeFirstOrThrow();
  const notes: AuditRecordInput[] = [];
  const orders: OrderRow[] = [];
  let parent = input.parent ?? null;
  for (const [k, c] of chosen.entries()) {
    // The size was offered when the release was made: a size set aside since stays its own.
    let skuId = c.size.sku_id;
    if (skuId === null) {
      skuId = (await offeredSku(tx, c.modelId, c.size.label, { allowSetAside: true })).skuId;
      await tx.updateTable('drop_sizes').set({ sku_id: skuId }).where('id', '=', c.size.id).execute();
    }
    const source =
      input.source.channel === 'DRAW'
        ? { channel: 'DRAW' as const, dropEntryId: input.source.dropEntryId, piece: c.piece }
        : { channel: 'LIVE' as const, liveEntryId: input.source.liveEntryId, piece: (input.source.set - 1) * chosen.length + c.piece };
    const created = await createOrder(
      tx,
      {
        ...source,
        dropId: input.dropId,
        accountId: input.accountId,
        modelId: c.modelId,
        sizeLabel: sizeLabelOf(c.size.label),
        skuId,
        priceMinor: shares[k] ?? null,
        currency: priced ? input.currency : null,
        // A release add-on of a set's release is per set: on its first piece's order.
        addons: k === 0 ? [...(input.addons ?? [])] : [],
        surprise: input.surprise ?? null,
        locationId: input.locationId,
        reservedAt: input.reservedAt,
        shipping: parent ? travellingShipping(parent) : await shippingFor(tx, input.accountId, priced ? input.currency : null, now),
        withOrderId: parent?.id ?? null,
        setSaleId: sale.id,
        setPiece: c.piece,
      },
      { hold: input.hold ?? true },
      actor,
      now,
      notes,
    );
    orders.push(created);
    if (parent === null) parent = created;
  }
  notes.push({
    actor,
    action: 'set.sale',
    targetType: 'set',
    targetId: input.setId,
    details: { setSaleId: sale.id, dropId: input.dropId, accountId: input.accountId, priceMinor: sale.price_minor, currency: sale.currency, orders: orders.map((o) => o.id), shares: shares.map((s) => s) },
  });
  return { sale, orders, notes };
}

/**
 * The sizes chosen per piece by entries of a set's release (macro scope K44 T1), by entry id: each piece and its size's
 * label in the piece's order (the account's export, a draw's or a LIVE entry's, an interest's by release). Reads only.
 */
export async function entryPieceSizes(db: Db, table: 'drop_entry_sizes' | 'live_entry_sizes', entryIds: readonly string[]): Promise<Map<string, { piece: number; size: string }[]>> {
  const out = new Map<string, { piece: number; size: string }[]>();
  if (entryIds.length === 0) return out;
  const rows = await db
    .selectFrom(`${table} as x`)
    .innerJoin('drop_sizes as s', 's.id', 'x.size_id')
    .select(['x.entry_id', 'x.piece', 's.label'])
    .where('x.entry_id', 'in', [...entryIds])
    .orderBy('x.entry_id')
    .orderBy('x.piece')
    .execute();
  for (const r of rows) out.set(r.entry_id, [...(out.get(r.entry_id) ?? []), { piece: r.piece, size: r.label }]);
  return out;
}

/** A set sale in the account's right-of-access export: its set, release, one price, when, and its orders' references. */
export interface ExportedSetSale {
  set: string;
  release: string | null;
  priceMinor: number | null;
  currency: string | null;
  soldAt: Date;
  orders: string[];
}

/** The account's set sales, oldest first, for its right-of-access export (OwnerService.exportData). Reads only. */
export async function accountSetSales(db: Db, accountId: string): Promise<ExportedSetSale[]> {
  const sales = await db
    .selectFrom('set_sales as s')
    .innerJoin('sets as t', 't.id', 's.set_id')
    .leftJoin('drops as d', 'd.id', 's.drop_id')
    .select(['s.id', 't.name', 'd.title', 's.price_minor', 's.currency', 's.created_at'])
    .where('s.account_id', '=', accountId)
    .orderBy('s.created_at')
    .orderBy('s.id')
    .execute();
  if (sales.length === 0) return [];
  const orders = await db.selectFrom('orders').select(['id', 'set_sale_id']).where('set_sale_id', 'in', sales.map((x) => x.id)).orderBy('set_piece').orderBy('reserved_at').orderBy('id').execute();
  return sales.map((x) => ({
    set: x.name,
    release: x.title ?? null,
    priceMinor: x.price_minor,
    currency: x.currency,
    soldAt: x.created_at,
    orders: orders.filter((o) => o.set_sale_id === x.id).map((o) => orderReference(o.id)),
  }));
}
