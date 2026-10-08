/**
 * The event journal (plan LIVE RELEASE+ of 2026-10-04, N1; migration 0022): every change of an order, the stock, a piece
 * or an invoice, written once, in the transaction of the change, for the connections to come (Shopify, Whop, the
 * accountant) to read. Nothing calls them in this lot.
 *
 * An entry names its change (`type`, the audit action of the change: `order.pay`, `stock.move`, `bench.create`,
 * `product.issue`, `product.transition`, `product.reserve`…) and the entity it concerns (`entityType`, `entityId`), with
 * the entity as it stands after the change (`payload`): read in order of `id`, the journal replays the state
 * (`replayJournal`): each order, piece to make and piece as its last entry says, and the stock of each SKU at each
 * location as the sum of its movements. The payloads carry ids and facts, never personal data (an order says whether
 * the buyer's details and an engraving text were entered, never what they are; a piece never names its owner).
 *
 * The entries of one entity follow the order of its changes (each change holds the entity's row lock until it
 * commits); entries of different entities may commit out of the order of their ids, so a connection reads what it has
 * not consumed yet (`readJournal` with `unconsumedBy`) and records what it consumed (`acknowledgeJournal`, the only
 * change an entry ever takes). An entry is never deleted.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import { jsonText, type JsonObject, type ProductRow } from '../db/schema.js';
import { validationError } from '../errors.js';

/** The entities the journal names; since plan NEXT LOT §3.5 (step 5.6), a supplier order too (its lines and prices: internal). */
export const JOURNAL_ENTITY_TYPES = Object.freeze(['order', 'stock_movement', 'bench_item', 'product', 'invoice', 'supplier_order'] as const);
export type JournalEntityType = (typeof JOURNAL_ENTITY_TYPES)[number];

/** A connection that reads the journal names itself so: lower case, 1 to 32 characters. */
const CONSUMER_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** The entries one read returns, at most. */
export const JOURNAL_READ_MAX = 1000;

export interface JournalEvent {
  type: string;
  entityType: JournalEntityType;
  entityId: string;
  payload: JsonObject;
}

export interface JournalEntry extends JournalEvent {
  id: number;
  createdAt: Date;
  consumedBy: string[];
}

/**
 * A piece as the journal says it after a change of its status (`product.issue`, `product.transition`,
 * `product.reinstate`, `product.reserve`, `product.retire`): its identity, status, model, SKU and size; never its owner.
 */
export function productPayload(p: Pick<ProductRow, 'id' | 'product_id' | 'status' | 'model_id' | 'sku_id' | 'variant'>, at: Date): JsonObject {
  return { id: p.id, productId: p.product_id, status: p.status, modelId: p.model_id, skuId: p.sku_id, sizeLabel: p.variant, at: at.toISOString() };
}

/** Write the entries of a change, in its transaction (never outside one: a change and its entry commit together). */
export async function writeJournal(tx: Db, events: readonly JournalEvent[], at: Date): Promise<void> {
  if (!tx.isTransaction) throw new Error('the event journal is written in the transaction of its change');
  if (events.length === 0) return;
  await tx
    .insertInto('event_journal')
    .values(events.map((e) => ({ type: e.type, entity_type: e.entityType, entity_id: e.entityId, payload: jsonText(e.payload), created_at: at })))
    .execute();
}

/**
 * The entries after `afterId` (0: from the start), in order of id, at most `limit` (1 to JOURNAL_READ_MAX); with
 * `unconsumedBy`, only those that connection has not acknowledged.
 */
export async function readJournal(db: Db, opts: { afterId?: number; limit?: number; unconsumedBy?: string } = {}): Promise<JournalEntry[]> {
  const afterId = opts.afterId ?? 0;
  const limit = opts.limit ?? JOURNAL_READ_MAX;
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw validationError('A journal position is a whole number.');
  if (!Number.isInteger(limit) || limit < 1 || limit > JOURNAL_READ_MAX) throw validationError(`Read 1 to ${JOURNAL_READ_MAX} entries at a time.`);
  if (opts.unconsumedBy !== undefined && !CONSUMER_RE.test(opts.unconsumedBy)) throw validationError('Unknown journal reader.');
  const rows = await db
    .selectFrom('event_journal')
    .selectAll()
    .where('id', '>', afterId)
    .$if(opts.unconsumedBy !== undefined, (q) => q.where(sql<boolean>`NOT (${opts.unconsumedBy!} = ANY (consumed_by))`))
    .orderBy('id')
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type,
    entityType: r.entity_type as JournalEntityType,
    entityId: r.entity_id,
    payload: r.payload,
    createdAt: r.created_at,
    consumedBy: r.consumed_by,
  }));
}

/** A connection records the entries it consumed (each once); returns how many it had not acknowledged before. */
export async function acknowledgeJournal(db: Db, consumer: string, ids: readonly number[]): Promise<number> {
  if (!CONSUMER_RE.test(consumer)) throw validationError('Unknown journal reader.');
  const unique = [...new Set(ids)];
  if (unique.length === 0) return 0;
  if (unique.length > JOURNAL_READ_MAX || unique.some((id) => !Number.isSafeInteger(id) || id < 1)) throw validationError('Unknown journal entries.');
  const r = await db
    .updateTable('event_journal')
    .set({ consumed_by: sql<string[]>`array_append(consumed_by, ${consumer})` })
    .where('id', 'in', unique)
    .where(sql<boolean>`NOT (${consumer} = ANY (consumed_by))`)
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}

/** What the journal says now: each entity as its last entry, and the stock on hand of each `${skuId}:${locationId}`. */
export interface ReplayedState {
  orders: Map<string, JsonObject>;
  benchItems: Map<string, JsonObject>;
  products: Map<string, JsonObject>;
  /** Each invoice and credit note as issued (`invoice.issue`, `invoice.credit`: never its buyer). */
  invoices: Map<string, JsonObject>;
  stock: Map<string, number>;
}

/** The key of a SKU at a location in ReplayedState.stock. */
export const stockKey = (skuId: string, locationId: string): string => `${skuId}:${locationId}`;

/** Replay entries in order of id (pure): each entity's last payload, the movements summed. */
export function replayJournal(entries: Iterable<Pick<JournalEntry, 'entityType' | 'entityId' | 'payload'>>): ReplayedState {
  const state: ReplayedState = { orders: new Map(), benchItems: new Map(), products: new Map(), invoices: new Map(), stock: new Map() };
  for (const e of entries) {
    switch (e.entityType) {
      case 'order':
        state.orders.set(e.entityId, e.payload);
        break;
      case 'bench_item':
        state.benchItems.set(e.entityId, e.payload);
        break;
      case 'product':
        state.products.set(e.entityId, e.payload);
        break;
      case 'invoice':
        state.invoices.set(e.entityId, e.payload);
        break;
      case 'stock_movement': {
        const key = stockKey(String(e.payload.skuId), String(e.payload.locationId));
        state.stock.set(key, (state.stock.get(key) ?? 0) + Number(e.payload.delta));
        break;
      }
    }
  }
  return state;
}
