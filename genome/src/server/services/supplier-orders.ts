/**
 * The supplier orders (plan NEXT LOT of 2026-10-07, §3.5.6.3 and §3.5.6.4; migration 0036; API §16.33, DATABASE §5.78
 * to §5.83): « The console proposes, ORBES confirms ». ORBES's own page, never a LOGISTICS login's: the agent sees a
 * supplier order's lines without their prices, during a reception only (services/receptions.ts).
 *
 *   the proposal  per offered size (a size set aside is left out entirely, its waiting orders and its minimum alike:
 *                 the owner's rule, question 7) and location: `waiting`, the orders waiting for supplier stock there
 *                 (reservation AWAITING); `underMinimum`, max(0, minimum − available); `expected`, what the sent
 *                 supplier orders to that location still owe (SENT, EXPECTED, PARTLY_RECEIVED); `inDraft`, what a draft
 *                 to that location already holds; `toOrder` = max(0, waiting + underMinimum − expected − inDraft), so a
 *                 shortfall is never ordered twice. Grouped by supplier (the size's, else its model's, else its main
 *                 model's: services/suppliers.ts supplierOf; an inactive supplier counts as none) and location; the sizes
 *                 without a supplier apart. Test orders count like real ones (the owner: test entrants count everywhere).
 *   the draft     one per supplier and location (`supplier_orders_one_draft`): `addToDraft` (the proposal's Add to the
 *                 draft, a release's Add to supplier order) creates it in its supplier's currency and adds the pieces
 *                 to the SKU's line, its unit price prefilled from the last sent line of that SKU with that supplier;
 *                 `updateDraft` changes its lines, currency (two decimals only), shipping (NULL: none, printed « — »),
 *                 expected date and note; `discardDraft` deletes it (a draft never left ORBES).
 *   its steps     DRAFT → SENT (`send`: at least one line, every unit price, its currency and its expected date; its
 *                 lines and prices then never change) → EXPECTED (`supplierConfirmed`, optional: the supplier confirmed
 *                 the order and its date, question 11) → PARTLY_RECEIVED → RECEIVED (`refreshStatus`, after a reception
 *                 or a credit); `cancelRest` ends what has not come (RECEIVED if anything was accepted, else CANCELLED),
 *                 refused while a reception of the order waits for ORBES.
 *   its invoice   the supplier's invoice (`setInvoice`: number, amount, date; replaced until paid) and its payment
 *                 (`markInvoicePaid`).
 *   returns       the supplier's answer to rejected pieces (`settleReturn`): a REPLACEMENT keeps them expected; a CREDIT
 *                 (its amount) stops expecting them (the line's `credited_quantity`).
 *   its PDF       render/supplier-order.ts: ORBES sends it to the supplier itself (the console sends no email).
 *
 * Audited `supplier_order.create`, `.draft`, `.update` (the fields' names), `.discard`, `.send`, `.confirm`,
 * `.cancel_rest`, `.invoice`, `.invoice_paid`, `supplier_return.settle`, by ids, counts and amounts, never a note's words
 * nor a supplier's contact; journaled `supplier_order.*` (the order as it stands, its lines and prices: the journal is
 * internal). Lock order: the supplier order, then its lines, then a reception (services/receptions.ts takes the order
 * first too).
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { JsonObject, SupplierOrderRow, SupplierOrderStatus, SupplierReturnSettlement } from '../db/schema.js';
import { SUPPLIER_ORDER_STATUSES } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { renderSupplierOrderPdf, type SupplierOrderDocument } from '../render/supplier-order.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { INVOICE_ISSUER } from './invoices.js';
import { writeJournal } from './journal.js';
import { assertSkuOffered } from './sizes.js';
import { cleanCurrency } from './suppliers.js';
import { ONE_SIZE_LABEL } from './stock.js';

// ── Rules ──────────────────────────────────────────────────────────────────

/** The statuses in which a supplier order still owes pieces to its location. */
export const SUPPLIER_ORDER_OPEN: readonly SupplierOrderStatus[] = Object.freeze(['SENT', 'EXPECTED', 'PARTLY_RECEIVED']);
/** The bounds of a supplier order's fields (the CHECKs of migration 0036). */
export const SUPPLIER_ORDER_LIMITS = Object.freeze({
  quantity: 10_000,
  amountMinor: 100_000_000,
  invoiceMinor: 100_000_000_000,
  note: 1000,
  invoiceNumber: 60,
  returnNote: 500,
  /** Lines a supplier order holds, at most (one per SKU). */
  lines: 500,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A supplier order's reference: `SO-` and the first eight hexadecimal figures of its id, in capitals (as `orderReference`). */
export function supplierOrderReference(id: string): string {
  return `SO-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** What a supplier order line still expects: max(0, quantity − accepted − credited − rest cancelled). */
export function lineExpected(l: { quantity: number; accepted_quantity: number; credited_quantity: number; rest_cancelled_quantity: number }): number {
  return Math.max(0, l.quantity - l.accepted_quantity - l.credited_quantity - l.rest_cancelled_quantity);
}

/** The proposal's arithmetic (pure): what to order so that every waiting order and every minimum is covered once. */
export function toOrderOf(p: { waiting: number; underMinimum: number; expected: number; inDraft: number }): number {
  return Math.max(0, p.waiting + p.underMinimum - p.expected - p.inDraft);
}

// ── Errors ─────────────────────────────────────────────────────────────────

export const supplierOrderNotFound = () => notFound('Supplier order', 'SUPPLIER_ORDER_NOT_FOUND');
const notDraft = () => conflict('SUPPLIER_ORDER_NOT_DRAFT', 'A sent order no longer changes: cancel the rest, or start another order.');
export const supplierOrderClosed = () => conflict('SUPPLIER_ORDER_CLOSED', 'This supplier order expects nothing more.');
const notSent = () => conflict('SUPPLIER_ORDER_NOT_SENT', 'This supplier order is not sent yet.');
export const receptionOpen = () => conflict('RECEPTION_OPEN', 'A reception of this order is already waiting for ORBES.');
const incomplete = () =>
  new DomainError('SUPPLIER_ORDER_INCOMPLETE', 422, 'Before it is sent, an order needs at least one line, a unit price on each, its currency and its expected delivery date.');
const invoicePaid = () => conflict('SUPPLIER_INVOICE_PAID', 'This invoice is paid: it no longer changes.');
const noInvoice = () => conflict('SUPPLIER_INVOICE_MISSING', 'Enter the supplier’s invoice first.');
const returnNotFound = () => notFound('Supplier return', 'SUPPLIER_RETURN_NOT_FOUND');
const returnSettled = () => conflict('SUPPLIER_RETURN_SETTLED', 'The supplier’s answer is already noted.');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');
const locationNotFound = () => notFound('Location', 'STOCK_LOCATION_NOT_FOUND');

// ── Views ──────────────────────────────────────────────────────────────────

/** A size as the supplier orders name it: its model, the model's variant, its size and its SKU code. */
export interface SupplierOrderSku {
  id: string;
  code: string;
  model: { id: string; name: string };
  /** The variant's label (BLUE) of a variant model; null otherwise. */
  variant: string | null;
  /** Its size; null for a model in one size (ONE SIZE). */
  sizeLabel: string | null;
  setAside: boolean;
}

/** A line of a supplier order. */
export interface SupplierOrderLineView {
  id: string;
  sku: SupplierOrderSku;
  quantity: number;
  unitPriceMinor: number | null;
  /** quantity × unit price; null without a price. */
  lineTotalMinor: number | null;
  /** From its CONFIRMED receptions: accepted, rejected. */
  received: number;
  rejected: number;
  credited: number;
  restCancelled: number;
  expected: number;
  /** For a draft's line: what the sent orders of this size to this location still owe (« Expected on other supplier orders »). */
  expectedElsewhere: number;
}

/** A confirmed reception line with no order line: extra pieces, or a size not ordered (« Not on the order »). */
export interface SupplierOrderExtra {
  sku: SupplierOrderSku;
  received: number;
  rejected: number;
  /** The agent's notes, as written (ORBES's page only). */
  notes: string[];
}

/** A reception of the order, as ORBES's page lists it. */
export interface SupplierOrderReception {
  id: string;
  status: string;
  countedAt: Date;
  accepted: number;
  rejected: number;
  confirmedAt: Date | null;
  confirmedBy: string | null;
}

/** Rejected pieces sent back to the supplier, and the supplier's answer. */
export interface SupplierReturnView {
  id: string;
  sku: SupplierOrderSku;
  quantity: number;
  status: string;
  returnedAt: Date | null;
  settlement: SupplierReturnSettlement | null;
  creditMinor: number | null;
  settledAt: Date | null;
  note: string | null;
}

/** A supplier order as ORBES's page reads it. */
export interface SupplierOrderView {
  id: string;
  reference: string;
  status: SupplierOrderStatus;
  supplier: { id: string; name: string; active: boolean; currency: string | null };
  location: { id: string; name: string; address: string | null };
  currency: string | null;
  shippingMinor: number | null;
  /** YYYY-MM-DD. */
  expectedOn: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  supplierConfirmedAt: Date | null;
  receivedAt: Date | null;
  restCancelled: { at: Date; note: string } | null;
  invoice: { number: string; amountMinor: number; date: string; paidAt: Date | null } | null;
  lines: SupplierOrderLineView[];
  extras: SupplierOrderExtra[];
  receptions: SupplierOrderReception[];
  returns: SupplierReturnView[];
  /** Pieces ordered, accepted, still expected; the lines' total (null while a price is missing), the total with shipping. */
  pieces: { ordered: number; received: number; expected: number };
  linesTotalMinor: number | null;
  totalMinor: number | null;
  history: { action: string; at: Date; by: string | null }[];
}

/** A supplier order in the list. */
export interface SupplierOrderListItem {
  id: string;
  reference: string;
  status: SupplierOrderStatus;
  supplier: { id: string; name: string };
  location: { id: string; name: string };
  pieces: { ordered: number; received: number };
  currency: string | null;
  totalMinor: number | null;
  expectedOn: string | null;
  invoice: { number: string; paid: boolean } | null;
  createdAt: Date;
}

/** A size the proposal names, at a location. */
export interface ProposalRow {
  sku: SupplierOrderSku;
  waiting: number;
  underMinimum: number;
  expected: number;
  inDraft: number;
  toOrder: number;
}

/** The proposal for one supplier (null: the sizes without a supplier) and one location. */
export interface ProposalGroup {
  supplier: { id: string; name: string } | null;
  location: { id: string; name: string };
  /** The supplier's draft to that location, when one exists. */
  draft: { id: string; reference: string } | null;
  rows: ProposalRow[];
  toOrder: number;
}

export interface SupplierOrderProposal {
  groups: ProposalGroup[];
  /** Pieces to order in all (the sizes without a supplier included). */
  toOrder: number;
}

export interface DraftLineInput {
  skuId: string;
  quantity: number;
  /** Hundredths; null: not set yet. Omitted: kept (or prefilled for a new line). */
  unitPriceMinor?: number | null;
}

export interface DraftInput {
  lines?: DraftLineInput[];
  currency?: string | null;
  shippingMinor?: number | null;
  expectedOn?: string | null;
  note?: string | null;
}

// ── Checks ─────────────────────────────────────────────────────────────────

function known(id: unknown, notFoundError: () => DomainError): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFoundError();
  return id.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) throw forbidden('Only ORBES staff change a supplier order.');
}

function cleanQuantity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > SUPPLIER_ORDER_LIMITS.quantity) throw validationError(`A line orders 1 to ${SUPPLIER_ORDER_LIMITS.quantity} pieces.`);
  return v;
}

function cleanAmount(v: unknown, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) throw validationError(`${label} is a whole number of hundredths, 0 to ${max}.`);
  return v;
}

function cleanDate(v: unknown, label: string): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw validationError(`${label} is a date (YYYY-MM-DD).`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || v < '2000-01-01') throw validationError(`${label} is not a valid date.`);
  return v;
}

function cleanNote(v: unknown, max: number, label: string, required: boolean): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_CHARS.test(s)) throw validationError(`${label} contains invalid characters.`);
  if (s.length > max) throw validationError(`${label} has at most ${max} characters.`);
  return s;
}

const dateOf = (d: Date | string | null): string | null => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** A size named as the console and its errors say it: MONOLITHE · BLUE · 52 (ONE SIZE for a model in one size). */
export function skuWords(s: { model: { name: string }; variant: string | null; sizeLabel: string | null }): string {
  return [s.model.name, s.variant, s.sizeLabel ?? ONE_SIZE_LABEL].filter((x): x is string => x !== null && x !== '').join(' · ');
}

const noSupplier = (s: SupplierOrderSku) => conflict('SKU_NO_SUPPLIER', `Set the supplier of ${skuWords(s)} on its model's page first.`);

/** The supplier order as the journal says it (prices included: the journal is internal). */
async function journalPayload(tx: Db, o: SupplierOrderRow): Promise<JsonObject> {
  const lines = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).orderBy('created_at').orderBy('id').execute();
  return {
    id: o.id,
    reference: supplierOrderReference(o.id),
    supplierId: o.supplier_id,
    locationId: o.location_id,
    status: o.status,
    currency: o.currency,
    shippingMinor: o.shipping_minor,
    expectedOn: dateOf(o.expected_on ),
    invoice: o.invoice_number ? { number: o.invoice_number, amountMinor: Number(o.invoice_minor), date: dateOf(o.invoice_date ), paid: o.invoice_paid_at !== null } : null,
    lines: lines.map((l) => ({
      skuId: l.sku_id,
      quantity: l.quantity,
      unitPriceMinor: l.unit_price_minor,
      accepted: l.accepted_quantity,
      rejected: l.rejected_quantity,
      credited: l.credited_quantity,
      restCancelled: l.rest_cancelled_quantity,
    })),
  };
}

/** One change of a supplier order: its journal entry, and its audit entry returned for the caller to write last. */
async function recordOrderChange(tx: Db, o: SupplierOrderRow, action: string, details: JsonObject, actor: Actor, now: Date): Promise<AuditRecordInput> {
  await writeJournal(tx, [{ type: action, entityType: 'supplier_order', entityId: o.id, payload: await journalPayload(tx, o) }], now);
  return { actor, action, targetType: 'supplier_order', targetId: o.id, details: { reference: supplierOrderReference(o.id), ...details } };
}

/** The SKUs named, with their model, variant and size. */
async function skusOf(db: Db, ids: readonly string[]): Promise<Map<string, SupplierOrderSku>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('skus as k')
    .innerJoin('models as m', 'm.id', 'k.model_id')
    .select(['k.id', 'k.code', 'k.size_label', 'k.set_aside_at', 'm.id as model_id', 'm.name', 'm.variant_label'])
    .where('k.id', 'in', [...new Set(ids)])
    .execute();
  return new Map(
    rows.map((r) => [r.id, { id: r.id, code: r.code, model: { id: r.model_id, name: r.name }, variant: r.variant_label, sizeLabel: r.size_label, setAside: r.set_aside_at !== null }]),
  );
}

/**
 * Settle a supplier order's status after a reception or a credit (§3.5.6.3), in the caller's transaction, the order's row
 * locked: while open, RECEIVED when nothing is expected any more, PARTLY_RECEIVED when something was accepted. Returns the
 * row after it.
 */
export async function refreshStatus(tx: Db, supplierOrderId: string, now: Date): Promise<SupplierOrderRow> {
  const o = await tx.selectFrom('supplier_orders').selectAll().where('id', '=', supplierOrderId).executeTakeFirstOrThrow();
  if (!SUPPLIER_ORDER_OPEN.includes(o.status)) return o;
  const lines = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).execute();
  const expected = lines.reduce((n, l) => n + lineExpected(l), 0);
  const accepted = lines.reduce((n, l) => n + l.accepted_quantity, 0);
  const status: SupplierOrderStatus = expected === 0 ? 'RECEIVED' : accepted > 0 ? 'PARTLY_RECEIVED' : o.status;
  if (status === o.status) return o;
  return tx
    .updateTable('supplier_orders')
    .set({ status, updated_at: now, ...(status === 'RECEIVED' ? { received_at: now } : {}) })
    .where('id', '=', o.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** What the sent supplier orders to a location still owe per SKU (SENT, EXPECTED, PARTLY_RECEIVED), at most `skuIds`. */
export async function expectedBySku(db: Db, filter: { locationId?: string; skuIds?: readonly string[]; exceptOrderId?: string } = {}): Promise<Map<string, number>> {
  const rows = await sql<{ sku_id: string; location_id: string; expected: number }>`
    SELECT l.sku_id, o.location_id,
           sum(greatest(0, l.quantity - l.accepted_quantity - l.credited_quantity - l.rest_cancelled_quantity))::int AS expected
      FROM supplier_order_lines l
      JOIN supplier_orders o ON o.id = l.supplier_order_id
     WHERE o.status IN ('SENT', 'EXPECTED', 'PARTLY_RECEIVED')
       AND (${filter.locationId ?? null}::uuid IS NULL OR o.location_id = ${filter.locationId ?? null}::uuid)
       AND (${filter.exceptOrderId ?? null}::uuid IS NULL OR o.id <> ${filter.exceptOrderId ?? null}::uuid)
     GROUP BY l.sku_id, o.location_id`.execute(db);
  const out = new Map<string, number>();
  for (const r of rows.rows) {
    if (filter.skuIds && !filter.skuIds.includes(r.sku_id)) continue;
    const key = filter.locationId ? r.sku_id : `${r.sku_id}:${r.location_id}`;
    out.set(key, (out.get(key) ?? 0) + Number(r.expected));
  }
  return out;
}

// ── Service ────────────────────────────────────────────────────────────────

export interface SupplierOrderServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class SupplierOrderService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: SupplierOrderServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  // ── The proposal ─────────────────────────────────────────────────────────

  /**
   * The proposal (§3.5.6.4): every offered size of a location where an order waits for supplier stock or the stock is
   * under its minimum, with what is expected and what a draft already holds, grouped by supplier and location; the
   * sizes without an active supplier apart. Narrowed to a location or a supplier.
   */
  async proposal(filter: { locationId?: string; supplierId?: string } = {}): Promise<SupplierOrderProposal> {
    const locationId = filter.locationId === undefined ? null : known(filter.locationId, locationNotFound);
    const supplierId = filter.supplierId === undefined ? null : known(filter.supplierId, () => notFound('Supplier', 'SUPPLIER_NOT_FOUND'));
    const rows = await sql<{
      sku_id: string;
      location_id: string;
      location: string;
      waiting: number;
      on_hand: number;
      reserved: number;
      minimum: number | null;
      expected: number;
      in_draft: number;
      supplier_id: string | null;
      supplier: string | null;
    }>`
      WITH waiting AS (SELECT sku_id, location_id, count(*)::int AS n FROM orders WHERE reservation = 'AWAITING' GROUP BY sku_id, location_id),
           moved AS (SELECT sku_id, location_id, sum(delta)::int AS n FROM stock_movements GROUP BY sku_id, location_id),
           held AS (SELECT sku_id, location_id, count(*)::int AS n FROM orders WHERE reservation = 'STOCK' GROUP BY sku_id, location_id),
           expected AS (SELECT l.sku_id, o.location_id,
                               sum(greatest(0, l.quantity - l.accepted_quantity - l.credited_quantity - l.rest_cancelled_quantity))::int AS n
                          FROM supplier_order_lines l JOIN supplier_orders o ON o.id = l.supplier_order_id
                         WHERE o.status IN ('SENT', 'EXPECTED', 'PARTLY_RECEIVED') GROUP BY l.sku_id, o.location_id),
           drafted AS (SELECT l.sku_id, o.location_id, sum(l.quantity)::int AS n
                         FROM supplier_order_lines l JOIN supplier_orders o ON o.id = l.supplier_order_id
                        WHERE o.status = 'DRAFT' GROUP BY l.sku_id, o.location_id),
           pairs AS (SELECT sku_id, location_id FROM waiting UNION SELECT sku_id, location_id FROM sku_thresholds)
      SELECT p.sku_id, p.location_id, loc.name AS location,
             coalesce(w.n, 0) AS waiting, coalesce(mv.n, 0) AS on_hand, coalesce(h.n, 0) AS reserved, t.minimum,
             coalesce(e.n, 0) AS expected, coalesce(d.n, 0) AS in_draft,
             s.id AS supplier_id, s.name AS supplier
        FROM pairs p
        JOIN skus k ON k.id = p.sku_id
        JOIN models m ON m.id = k.model_id
        LEFT JOIN models main ON main.id = m.variant_of
        JOIN stock_locations loc ON loc.id = p.location_id
        LEFT JOIN waiting w ON w.sku_id = p.sku_id AND w.location_id = p.location_id
        LEFT JOIN moved mv ON mv.sku_id = p.sku_id AND mv.location_id = p.location_id
        LEFT JOIN held h ON h.sku_id = p.sku_id AND h.location_id = p.location_id
        LEFT JOIN sku_thresholds t ON t.sku_id = p.sku_id AND t.location_id = p.location_id
        LEFT JOIN expected e ON e.sku_id = p.sku_id AND e.location_id = p.location_id
        LEFT JOIN drafted d ON d.sku_id = p.sku_id AND d.location_id = p.location_id
        LEFT JOIN suppliers s ON s.id = coalesce(k.supplier_id, m.supplier_id, main.supplier_id) AND s.active
       WHERE k.set_aside_at IS NULL
         AND (${locationId}::uuid IS NULL OR p.location_id = ${locationId}::uuid)
         AND (${supplierId}::uuid IS NULL OR s.id = ${supplierId}::uuid)`.execute(this.db);
    const skus = await skusOf(this.db, rows.rows.map((r) => r.sku_id));
    const drafts = await this.db.selectFrom('supplier_orders').select(['id', 'supplier_id', 'location_id']).where('status', '=', 'DRAFT').execute();
    const groups = new Map<string, ProposalGroup>();
    for (const r of rows.rows) {
      const available = Number(r.on_hand) - Number(r.reserved);
      const underMinimum = r.minimum === null ? 0 : Math.max(0, Number(r.minimum) - available);
      const waiting = Number(r.waiting);
      if (waiting === 0 && underMinimum === 0) continue;
      const expected = Number(r.expected);
      const inDraft = Number(r.in_draft);
      const key = `${r.supplier_id ?? ''}:${r.location_id}`;
      let g = groups.get(key);
      if (!g) {
        const draft = r.supplier_id ? drafts.find((d) => d.supplier_id === r.supplier_id && d.location_id === r.location_id) : undefined;
        g = {
          supplier: r.supplier_id ? { id: r.supplier_id, name: r.supplier! } : null,
          location: { id: r.location_id, name: r.location },
          draft: draft ? { id: draft.id, reference: supplierOrderReference(draft.id) } : null,
          rows: [],
          toOrder: 0,
        };
        groups.set(key, g);
      }
      const toOrder = toOrderOf({ waiting, underMinimum, expected, inDraft });
      g.rows.push({ sku: skus.get(r.sku_id)!, waiting, underMinimum, expected, inDraft, toOrder });
      g.toOrder += toOrder;
    }
    const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
    const out = [...groups.values()];
    for (const g of out) g.rows.sort((a, b) => natural(a.sku.model.name, b.sku.model.name) || natural(a.sku.variant ?? '', b.sku.variant ?? '') || natural(a.sku.sizeLabel ?? '', b.sku.sizeLabel ?? '') || a.sku.code.localeCompare(b.sku.code));
    // The suppliers by name, the sizes without a supplier last; then the location.
    out.sort((a, b) => (a.supplier === null ? 1 : 0) - (b.supplier === null ? 1 : 0) || natural(a.supplier?.name ?? '', b.supplier?.name ?? '') || natural(a.location.name, b.location.name));
    return { groups: out, toOrder: out.reduce((n, g) => n + g.toOrder, 0) };
  }

  // ── The draft ────────────────────────────────────────────────────────────

  /**
   * `quantity` pieces of a size added to its supplier's draft to a location (the proposal's Add to the draft, a release's
   * Add to supplier order): an offered size (409 SIZE_SET_ASIDE), with an active supplier (409 SKU_NO_SUPPLIER); the
   * draft created when there is none (in the supplier's currency, `supplier_order.create`), the pieces added to the SKU's
   * line (created when there is none, its unit price prefilled from the last sent line of that SKU with that supplier).
   * Audited `supplier_order.draft` with where it came from.
   */
  async addToDraft(input: { skuId: string; locationId: string; quantity: number; from?: 'PROPOSAL' | 'RELEASE' }, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const skuId = known(input?.skuId, skuNotFound);
    const locationId = known(input?.locationId, locationNotFound);
    const quantity = cleanQuantity(input?.quantity);
    const from = input?.from ?? 'PROPOSAL';
    if (from !== 'PROPOSAL' && from !== 'RELEASE') throw validationError('A draft line comes from the proposal or from a release.');
    const id = await this.retryDraft(() =>
      inTransaction(this.db, async (tx) => {
        const now = this.clock();
        const loc = await tx.selectFrom('stock_locations').select('id').where('id', '=', locationId).executeTakeFirst();
        if (!loc) throw locationNotFound();
        await assertSkuOffered(tx, skuId);
        const sku = (await skusOf(tx, [skuId])).get(skuId);
        if (!sku) throw skuNotFound();
        const supplier = await sql<{ id: string | null; currency: string | null }>`
          SELECT s.id, s.currency FROM skus k JOIN models m ON m.id = k.model_id LEFT JOIN models main ON main.id = m.variant_of
            LEFT JOIN suppliers s ON s.id = coalesce(k.supplier_id, m.supplier_id, main.supplier_id) AND s.active
           WHERE k.id = ${skuId}`.execute(tx);
        const s = supplier.rows[0];
        if (!s?.id) throw noSupplier(sku);
        const notes: AuditRecordInput[] = [];
        let o = await tx.selectFrom('supplier_orders').selectAll().where('supplier_id', '=', s.id).where('location_id', '=', locationId).where('status', '=', 'DRAFT').forUpdate().executeTakeFirst();
        if (!o) {
          o = await tx
            .insertInto('supplier_orders')
            .values({ supplier_id: s.id, location_id: locationId, currency: s.currency, created_by: actor.id!, created_at: now, updated_at: now })
            .returningAll()
            .executeTakeFirstOrThrow();
          notes.push(await recordOrderChange(tx, o, 'supplier_order.create', { supplierId: s.id, locationId, currency: s.currency }, actor, now));
        }
        const line = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).where('sku_id', '=', skuId).forUpdate().executeTakeFirst();
        if (line) {
          if (line.quantity + quantity > SUPPLIER_ORDER_LIMITS.quantity) throw validationError(`A line orders at most ${SUPPLIER_ORDER_LIMITS.quantity} pieces.`);
          await tx.updateTable('supplier_order_lines').set({ quantity: line.quantity + quantity }).where('id', '=', line.id).execute();
        } else {
          const count = await tx.selectFrom('supplier_order_lines').select((eb) => eb.fn.countAll<number>().as('n')).where('supplier_order_id', '=', o.id).executeTakeFirstOrThrow();
          if (Number(count.n) >= SUPPLIER_ORDER_LIMITS.lines) throw validationError(`A supplier order holds at most ${SUPPLIER_ORDER_LIMITS.lines} lines.`);
          await tx.insertInto('supplier_order_lines').values({ supplier_order_id: o.id, sku_id: skuId, quantity, unit_price_minor: await this.lastPrice(tx, s.id, skuId), created_at: now }).execute();
        }
        o = await tx.updateTable('supplier_orders').set({ updated_at: now }).where('id', '=', o.id).returningAll().executeTakeFirstOrThrow();
        notes.push(await recordOrderChange(tx, o, 'supplier_order.draft', { skuId, quantity, from }, actor, now));
        for (const n of notes) await this.audit.record(n, tx);
        return o.id;
      }),
    );
    return this.get(id);
  }

  /**
   * A draft changed (409 SUPPLIER_ORDER_NOT_DRAFT once sent): its lines (the list given becomes its lines: each SKU once,
   * offered, 1 to 10 000 pieces, its unit price given, kept, or prefilled for a new one), its currency (two decimals
   * only), its shipping cost (null: none), its expected date and its note. Audited `supplier_order.update` with the
   * fields changed.
   */
  async updateDraft(supplierOrderId: string, input: DraftInput, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    if (!input || typeof input !== 'object') throw validationError('Nothing to change.');
    const has = (k: keyof DraftInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
    const currency = has('currency') ? cleanCurrency(input.currency) : undefined;
    const shipping = has('shippingMinor') ? (input.shippingMinor === null ? null : cleanAmount(input.shippingMinor, SUPPLIER_ORDER_LIMITS.amountMinor, 'The shipping cost')) : undefined;
    const expectedOn = has('expectedOn') ? (input.expectedOn === null ? null : cleanDate(input.expectedOn, 'The expected date')) : undefined;
    const note = has('note') ? cleanNote(input.note, SUPPLIER_ORDER_LIMITS.note, 'The note', false) : undefined;
    let lines: { skuId: string; quantity: number; unitPriceMinor?: number | null }[] | undefined;
    if (has('lines')) {
      if (!Array.isArray(input.lines) || input.lines.length > SUPPLIER_ORDER_LIMITS.lines) throw validationError(`A supplier order holds at most ${SUPPLIER_ORDER_LIMITS.lines} lines.`);
      lines = input.lines.map((l) => ({
        skuId: known(l?.skuId, skuNotFound),
        quantity: cleanQuantity(l?.quantity),
        ...(l?.unitPriceMinor === undefined ? {} : { unitPriceMinor: l.unitPriceMinor === null ? null : cleanAmount(l.unitPriceMinor, SUPPLIER_ORDER_LIMITS.amountMinor, 'A unit price') }),
      }));
      if (new Set(lines.map((l) => l.skuId)).size !== lines.length) throw validationError('Each size is one line of the order.');
    }
    if (currency === undefined && shipping === undefined && expectedOn === undefined && note === undefined && lines === undefined) throw validationError('Nothing to change.');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status !== 'DRAFT') throw notDraft();
      const fields: string[] = [];
      const set: Record<string, unknown> = {};
      if (currency !== undefined && currency !== o.currency) {
        set.currency = currency;
        fields.push('currency');
      }
      if (shipping !== undefined && shipping !== o.shipping_minor) {
        set.shipping_minor = shipping;
        fields.push('shipping');
      }
      if (expectedOn !== undefined && expectedOn !== dateOf(o.expected_on )) {
        set.expected_on = expectedOn;
        fields.push('expectedOn');
      }
      if (note !== undefined && note !== o.note) {
        set.note = note;
        fields.push('note');
      }
      if (lines !== undefined) {
        const before = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).forUpdate().execute();
        let changed = false;
        for (const l of lines) {
          const old = before.find((b) => b.sku_id === l.skuId);
          if (!old) {
            await assertSkuOffered(tx, l.skuId);
            const price = l.unitPriceMinor !== undefined ? l.unitPriceMinor : await this.lastPrice(tx, o.supplier_id, l.skuId);
            await tx.insertInto('supplier_order_lines').values({ supplier_order_id: o.id, sku_id: l.skuId, quantity: l.quantity, unit_price_minor: price, created_at: now }).execute();
            changed = true;
          } else {
            const price = l.unitPriceMinor !== undefined ? l.unitPriceMinor : old.unit_price_minor;
            if (old.quantity !== l.quantity || old.unit_price_minor !== price) {
              await tx.updateTable('supplier_order_lines').set({ quantity: l.quantity, unit_price_minor: price }).where('id', '=', old.id).execute();
              changed = true;
            }
          }
        }
        const gone = before.filter((b) => !lines!.some((l) => l.skuId === b.sku_id)).map((b) => b.id);
        if (gone.length) {
          await tx.deleteFrom('supplier_order_lines').where('id', 'in', gone).execute();
          changed = true;
        }
        if (changed) fields.push('lines');
      }
      if (fields.length === 0) throw validationError('Nothing to change.');
      const after = await tx.updateTable('supplier_orders').set({ ...set, updated_at: now }).where('id', '=', o.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(await recordOrderChange(tx, after, 'supplier_order.update', { fields }, actor, now), tx);
    });
    return this.get(id);
  }

  /** A draft discarded (deleted: it never left ORBES; 409 SUPPLIER_ORDER_NOT_DRAFT once sent). Audited `supplier_order.discard`. */
  async discardDraft(supplierOrderId: string, actor: Actor): Promise<void> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status !== 'DRAFT') throw notDraft();
      const lines = await tx.deleteFrom('supplier_order_lines').where('supplier_order_id', '=', o.id).returning('quantity').execute();
      await tx.deleteFrom('supplier_orders').where('id', '=', o.id).execute();
      await writeJournal(tx, [{ type: 'supplier_order.discard', entityType: 'supplier_order', entityId: o.id, payload: { id: o.id, reference: supplierOrderReference(o.id), status: 'DISCARDED' } }], now);
      await this.audit.record(
        { actor, action: 'supplier_order.discard', targetType: 'supplier_order', targetId: o.id, details: { reference: supplierOrderReference(o.id), supplierId: o.supplier_id, locationId: o.location_id, lines: lines.length, pieces: lines.reduce((n, l) => n + l.quantity, 0) } },
        tx,
      );
    });
  }

  // ── The steps ────────────────────────────────────────────────────────────

  /**
   * DRAFT → SENT (409 SUPPLIER_ORDER_NOT_DRAFT otherwise): at least one line, a unit price on each, its currency and its
   * expected date (422 SUPPLIER_ORDER_INCOMPLETE). Its lines and prices then never change. Audited `supplier_order.send`.
   */
  async send(supplierOrderId: string, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status !== 'DRAFT') throw notDraft();
      const lines = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).execute();
      if (lines.length === 0 || lines.some((l) => l.unit_price_minor === null) || o.currency === null || o.expected_on === null) throw incomplete();
      const after = await tx.updateTable('supplier_orders').set({ status: 'SENT', sent_at: now, sent_by: actor.id!, updated_at: now }).where('id', '=', o.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(
        await recordOrderChange(tx, after, 'supplier_order.send', { lines: lines.length, pieces: lines.reduce((n, l) => n + l.quantity, 0), currency: after.currency, expectedOn: dateOf(after.expected_on ) }, actor, now),
        tx,
      );
    });
    return this.get(id);
  }

  /**
   * SENT → EXPECTED (question 11, an optional step): the supplier confirmed the order and its delivery date, which may
   * change here. 409 SUPPLIER_ORDER_NOT_SENT for a draft, SUPPLIER_ORDER_CLOSED once received or cancelled. Audited
   * `supplier_order.confirm`.
   */
  async supplierConfirmed(supplierOrderId: string, input: { expectedOn?: string | null }, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    const expectedOn = input?.expectedOn === undefined || input.expectedOn === null ? undefined : cleanDate(input.expectedOn, 'The expected date');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status === 'DRAFT') throw notSent();
      if (o.status === 'RECEIVED' || o.status === 'CANCELLED') throw supplierOrderClosed();
      if (o.status !== 'SENT') throw conflict('SUPPLIER_ORDER_CONFIRMED', 'The supplier has already confirmed this order.');
      const after = await tx
        .updateTable('supplier_orders')
        .set({ status: 'EXPECTED', supplier_confirmed_at: now, supplier_confirmed_by: actor.id!, updated_at: now, ...(expectedOn ? { expected_on: expectedOn } : {}) })
        .where('id', '=', o.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(await recordOrderChange(tx, after, 'supplier_order.confirm', { expectedOn: dateOf(after.expected_on ) }, actor, now), tx);
    });
    return this.get(id);
  }

  /**
   * What has not arrived stops being expected (`Cancel the rest`, a note required): each line's expected pieces move to
   * its `rest_cancelled_quantity`; RECEIVED if anything was accepted, CANCELLED otherwise. Refused while a reception of
   * the order waits for ORBES (409 RECEPTION_OPEN), for a draft (409 SUPPLIER_ORDER_NOT_SENT: discard it) and once closed
   * (409 SUPPLIER_ORDER_CLOSED). The orders waiting for those pieces go back into the next proposal. Audited
   * `supplier_order.cancel_rest` (the pieces cancelled), never the note's words.
   */
  async cancelRest(supplierOrderId: string, input: { note: string }, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    const note = cleanNote(input?.note, SUPPLIER_ORDER_LIMITS.note, 'The note', true)!;
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status === 'DRAFT') throw notSent();
      if (!SUPPLIER_ORDER_OPEN.includes(o.status)) throw supplierOrderClosed();
      const open = await tx.selectFrom('receptions').select('id').where('supplier_order_id', '=', o.id).where('status', 'in', ['TO_CONFIRM', 'SENT_BACK']).executeTakeFirst();
      if (open) throw receptionOpen();
      const lines = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).forUpdate().execute();
      let cancelled = 0;
      for (const l of lines) {
        const rest = lineExpected(l);
        if (rest === 0) continue;
        cancelled += rest;
        await tx.updateTable('supplier_order_lines').set({ rest_cancelled_quantity: l.rest_cancelled_quantity + rest }).where('id', '=', l.id).execute();
      }
      const accepted = lines.reduce((n, l) => n + l.accepted_quantity, 0);
      const status: SupplierOrderStatus = accepted > 0 ? 'RECEIVED' : 'CANCELLED';
      const after = await tx
        .updateTable('supplier_orders')
        .set({ status, rest_cancelled_at: now, rest_cancelled_by: actor.id!, rest_cancelled_note: note, updated_at: now, ...(status === 'RECEIVED' ? { received_at: now } : {}) })
        .where('id', '=', o.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(await recordOrderChange(tx, after, 'supplier_order.cancel_rest', { pieces: cancelled, to: status, noted: true }, actor, now), tx);
    });
    return this.get(id);
  }

  // ── The supplier's invoice ───────────────────────────────────────────────

  /**
   * The supplier's invoice (its number, amount in the order's currency, date), entered or replaced until it is paid (409
   * SUPPLIER_INVOICE_PAID), on a sent order (409 SUPPLIER_ORDER_NOT_SENT for a draft). Audited `supplier_order.invoice`.
   */
  async setInvoice(supplierOrderId: string, input: { number: string; amountMinor: number; date: string }, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    const number = cleanNote(input?.number, SUPPLIER_ORDER_LIMITS.invoiceNumber, 'The invoice number', true)!;
    if (number.includes('\n')) throw validationError('The invoice number is one line.');
    const amount = cleanAmount(input?.amountMinor, SUPPLIER_ORDER_LIMITS.invoiceMinor, 'The amount');
    const date = cleanDate(input?.date, 'The invoice date');
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.status === 'DRAFT') throw notSent();
      if (o.invoice_paid_at !== null) throw invoicePaid();
      const after = await tx
        .updateTable('supplier_orders')
        .set({ invoice_number: number, invoice_minor: amount, invoice_date: date, updated_at: now })
        .where('id', '=', o.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(await recordOrderChange(tx, after, 'supplier_order.invoice', { number, amountMinor: amount, date, replaced: o.invoice_number !== null }, actor, now), tx);
    });
    return this.get(id);
  }

  /** ORBES has paid the supplier's invoice (409 SUPPLIER_INVOICE_MISSING before it is entered, SUPPLIER_INVOICE_PAID twice). Audited `supplier_order.invoice_paid`. */
  async markInvoicePaid(supplierOrderId: string, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierOrderId, supplierOrderNotFound);
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const o = await this.lockOrder(tx, id);
      if (o.invoice_number === null) throw noInvoice();
      if (o.invoice_paid_at !== null) throw invoicePaid();
      const after = await tx.updateTable('supplier_orders').set({ invoice_paid_at: now, invoice_paid_by: actor.id!, updated_at: now }).where('id', '=', o.id).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(await recordOrderChange(tx, after, 'supplier_order.invoice_paid', { number: o.invoice_number, amountMinor: Number(o.invoice_minor) }, actor, now), tx);
    });
    return this.get(id);
  }

  // ── Rejected pieces: the supplier's answer ───────────────────────────────

  /**
   * The supplier's answer to rejected pieces, noted by ORBES once (409 SUPPLIER_RETURN_SETTLED): a REPLACEMENT (no amount:
   * the pieces stay expected on the order) or a CREDIT (its amount, in the order's currency: the pieces are credited on
   * their line, no longer expected, then the order's status settled). Audited `supplier_return.settle`, never the note's
   * words.
   */
  async settleReturn(supplierReturnId: string, input: { settlement: SupplierReturnSettlement; creditMinor?: number | null; note?: string | null }, actor: Actor): Promise<SupplierOrderView> {
    assertStaff(actor);
    const id = known(supplierReturnId, returnNotFound);
    const settlement = input?.settlement;
    if (settlement !== 'REPLACEMENT' && settlement !== 'CREDIT') throw validationError('The supplier sends new pieces (REPLACEMENT) or credits them (CREDIT).');
    const credit = settlement === 'CREDIT' ? cleanAmount(input.creditMinor, SUPPLIER_ORDER_LIMITS.amountMinor, 'The credit') : null;
    if (settlement === 'REPLACEMENT' && input.creditMinor !== undefined && input.creditMinor !== null) throw validationError('A replacement carries no amount.');
    const note = cleanNote(input?.note, SUPPLIER_ORDER_LIMITS.returnNote, 'The note', false);
    let orderId = '';
    await inTransaction(this.db, async (tx) => {
      const now = this.clock();
      const peek = await tx.selectFrom('supplier_returns').select('supplier_order_id').where('id', '=', id).executeTakeFirst();
      if (!peek) throw returnNotFound();
      orderId = peek.supplier_order_id;
      const o = await this.lockOrder(tx, orderId);
      const r = await tx.selectFrom('supplier_returns').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (r.settlement !== null) throw returnSettled();
      await tx
        .updateTable('supplier_returns')
        .set({ settlement, credit_minor: credit, settled_at: now, settled_by: actor.id!, ...(note !== null ? { note } : {}) })
        .where('id', '=', r.id)
        .execute();
      if (settlement === 'CREDIT') {
        const line = await tx.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', o.id).where('sku_id', '=', r.sku_id).forUpdate().executeTakeFirst();
        if (line) await tx.updateTable('supplier_order_lines').set({ credited_quantity: line.credited_quantity + r.quantity }).where('id', '=', line.id).execute();
      }
      const after = await refreshStatus(tx, o.id, now);
      await writeJournal(tx, [{ type: 'supplier_return.settle', entityType: 'supplier_order', entityId: o.id, payload: await journalPayload(tx, after) }], now);
      await this.audit.record(
        {
          actor,
          action: 'supplier_return.settle',
          targetType: 'supplier_order',
          targetId: o.id,
          details: { reference: supplierOrderReference(o.id), supplierReturnId: r.id, skuId: r.sku_id, quantity: r.quantity, settlement, ...(credit !== null ? { creditMinor: credit } : {}), status: after.status, ...(note ? { noted: true } : {}) },
        },
        tx,
      );
    });
    return this.get(orderId);
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** The supplier orders, the latest first, narrowed by status and supplier. */
  async list(filter: { status?: SupplierOrderStatus; supplierId?: string } = {}): Promise<SupplierOrderListItem[]> {
    if (filter.status !== undefined && !(SUPPLIER_ORDER_STATUSES as readonly string[]).includes(filter.status)) throw validationError('Unknown status.');
    const supplierId = filter.supplierId === undefined ? null : known(filter.supplierId, () => notFound('Supplier', 'SUPPLIER_NOT_FOUND'));
    const rows = await sql<{
      id: string;
      status: SupplierOrderStatus;
      supplier_id: string;
      supplier: string;
      location_id: string;
      location: string;
      currency: string | null;
      shipping_minor: number | null;
      expected_on: string | Date | null;
      invoice_number: string | null;
      invoice_paid_at: Date | null;
      created_at: Date;
      ordered: number;
      received: number;
      lines_total: number | null;
      unpriced: number;
    }>`
      SELECT o.id, o.status, o.supplier_id, s.name AS supplier, o.location_id, loc.name AS location, o.currency, o.shipping_minor,
             o.expected_on, o.invoice_number, o.invoice_paid_at, o.created_at,
             coalesce(sum(l.quantity), 0)::int AS ordered, coalesce(sum(l.accepted_quantity), 0)::int AS received,
             sum(l.quantity::bigint * l.unit_price_minor)::bigint AS lines_total,
             count(l.id) FILTER (WHERE l.unit_price_minor IS NULL)::int AS unpriced
        FROM supplier_orders o
        JOIN suppliers s ON s.id = o.supplier_id
        JOIN stock_locations loc ON loc.id = o.location_id
        LEFT JOIN supplier_order_lines l ON l.supplier_order_id = o.id
       WHERE (${filter.status ?? null}::text IS NULL OR o.status = ${filter.status ?? null}::text)
         AND (${supplierId}::uuid IS NULL OR o.supplier_id = ${supplierId}::uuid)
       GROUP BY o.id, s.name, loc.name
       ORDER BY o.created_at DESC, o.id`.execute(this.db);
    return rows.rows.map((r) => {
      const lines = r.lines_total === null || Number(r.unpriced) > 0 ? null : Number(r.lines_total);
      return {
        id: r.id,
        reference: supplierOrderReference(r.id),
        status: r.status,
        supplier: { id: r.supplier_id, name: r.supplier },
        location: { id: r.location_id, name: r.location },
        pieces: { ordered: Number(r.ordered), received: Number(r.received) },
        currency: r.currency,
        totalMinor: lines === null ? null : lines + (r.shipping_minor ?? 0),
        expectedOn: dateOf(r.expected_on),
        invoice: r.invoice_number ? { number: r.invoice_number, paid: r.invoice_paid_at !== null } : null,
        createdAt: r.created_at,
      };
    });
  }

  /** One supplier order, its lines, the pieces received not on it, its receptions, its returns and its history (404 SUPPLIER_ORDER_NOT_FOUND). */
  async get(supplierOrderId: string): Promise<SupplierOrderView> {
    const id = known(supplierOrderId, supplierOrderNotFound);
    const o = await this.db
      .selectFrom('supplier_orders as o')
      .innerJoin('suppliers as s', 's.id', 'o.supplier_id')
      .innerJoin('stock_locations as loc', 'loc.id', 'o.location_id')
      .selectAll('o')
      .select(['s.name as supplier_name', 's.active as supplier_active', 's.currency as supplier_currency', 'loc.name as location_name', 'loc.address as location_address'])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!o) throw supplierOrderNotFound();
    const lines = await this.db.selectFrom('supplier_order_lines').selectAll().where('supplier_order_id', '=', id).orderBy('created_at').orderBy('id').execute();
    const extrasRows = await this.db
      .selectFrom('reception_lines as rl')
      .innerJoin('receptions as r', 'r.id', 'rl.reception_id')
      .select(['rl.sku_id', 'rl.accepted', 'rl.rejected', 'rl.note'])
      .where('r.supplier_order_id', '=', id)
      .where('r.status', '=', 'CONFIRMED')
      .where('rl.supplier_order_line_id', 'is', null)
      .orderBy('r.confirmed_at')
      .orderBy('rl.id')
      .execute();
    const receptions = await this.db
      .selectFrom('receptions as r')
      .leftJoin('admin_users as u', 'u.id', 'r.confirmed_by')
      .leftJoin('reception_lines as rl', 'rl.reception_id', 'r.id')
      .select(['r.id', 'r.status', 'r.counted_at', 'r.confirmed_at', 'u.email'])
      .select((eb) => [eb.fn.coalesce(eb.fn.sum<number>('rl.accepted'), eb.lit(0)).as('accepted'), eb.fn.coalesce(eb.fn.sum<number>('rl.rejected'), eb.lit(0)).as('rejected')])
      .where('r.supplier_order_id', '=', id)
      .groupBy(['r.id', 'u.email'])
      .orderBy('r.counted_at')
      .orderBy('r.id')
      .execute();
    const returns = await this.db.selectFrom('supplier_returns').selectAll().where('supplier_order_id', '=', id).orderBy('created_at').orderBy('id').execute();
    const skus = await skusOf(this.db, [...lines.map((l) => l.sku_id), ...extrasRows.map((e) => e.sku_id), ...returns.map((r) => r.sku_id)]);
    const elsewhere = o.status === 'DRAFT' ? await expectedBySku(this.db, { locationId: o.location_id, skuIds: lines.map((l) => l.sku_id), exceptOrderId: id }) : new Map<string, number>();
    const history = await this.db
      .selectFrom('audit_logs as a')
      .leftJoin('admin_users as u', (j) => j.on(sql`u.id::text`, '=', sql.ref('a.actor_id')))
      .select(['a.action', 'a.occurred_at', 'u.email'])
      .where('a.target_type', '=', 'supplier_order')
      .where('a.target_id', '=', id)
      .orderBy('a.id')
      .execute();
    // In the order they were added, then by SKU code (lines added together).
    lines.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || skus.get(a.sku_id)!.code.localeCompare(skus.get(b.sku_id)!.code));
    const lineViews: SupplierOrderLineView[] = lines.map((l) => ({
      id: l.id,
      sku: skus.get(l.sku_id)!,
      quantity: l.quantity,
      unitPriceMinor: l.unit_price_minor,
      lineTotalMinor: l.unit_price_minor === null ? null : l.quantity * l.unit_price_minor,
      received: l.accepted_quantity,
      rejected: l.rejected_quantity,
      credited: l.credited_quantity,
      restCancelled: l.rest_cancelled_quantity,
      expected: o.status === 'DRAFT' || o.status === 'CANCELLED' ? 0 : lineExpected(l),
      expectedElsewhere: elsewhere.get(l.sku_id) ?? 0,
    }));
    const extras = new Map<string, SupplierOrderExtra>();
    for (const e of extrasRows) {
      const x = extras.get(e.sku_id) ?? { sku: skus.get(e.sku_id)!, received: 0, rejected: 0, notes: [] };
      x.received += e.accepted;
      x.rejected += e.rejected;
      if (e.note) x.notes.push(e.note);
      extras.set(e.sku_id, x);
    }
    const linesTotal = lineViews.length === 0 || lineViews.some((l) => l.lineTotalMinor === null) ? null : lineViews.reduce((n, l) => n + l.lineTotalMinor!, 0);
    return {
      id: o.id,
      reference: supplierOrderReference(o.id),
      status: o.status,
      supplier: { id: o.supplier_id, name: o.supplier_name, active: o.supplier_active, currency: o.supplier_currency },
      location: { id: o.location_id, name: o.location_name, address: o.location_address },
      currency: o.currency,
      shippingMinor: o.shipping_minor,
      expectedOn: dateOf(o.expected_on ),
      note: o.note,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
      sentAt: o.sent_at,
      supplierConfirmedAt: o.supplier_confirmed_at,
      receivedAt: o.received_at,
      restCancelled: o.rest_cancelled_at ? { at: o.rest_cancelled_at, note: o.rest_cancelled_note! } : null,
      invoice: o.invoice_number ? { number: o.invoice_number, amountMinor: Number(o.invoice_minor), date: dateOf(o.invoice_date )!, paidAt: o.invoice_paid_at } : null,
      lines: lineViews,
      extras: [...extras.values()],
      receptions: receptions.map((r) => ({
        id: r.id,
        status: r.status,
        countedAt: r.counted_at,
        accepted: Number(r.accepted),
        rejected: Number(r.rejected),
        confirmedAt: r.confirmed_at,
        confirmedBy: r.email ?? null,
      })),
      returns: returns.map((r) => ({
        id: r.id,
        sku: skus.get(r.sku_id)!,
        quantity: r.quantity,
        status: r.status,
        returnedAt: r.returned_at,
        settlement: r.settlement,
        creditMinor: r.credit_minor,
        settledAt: r.settled_at,
        note: r.note,
      })),
      pieces: { ordered: lineViews.reduce((n, l) => n + l.quantity, 0), received: lineViews.reduce((n, l) => n + l.received, 0), expected: lineViews.reduce((n, l) => n + l.expected, 0) },
      linesTotalMinor: linesTotal,
      totalMinor: linesTotal === null ? null : linesTotal + (o.shipping_minor ?? 0),
      history: history.map((h) => ({ action: h.action, at: h.occurred_at, by: h.email ?? null })),
    };
  }

  /**
   * The supplier order's PDF (render/supplier-order.ts): from INVOICE_ISSUER, to the supplier, delivered to the location
   * (its address), its date (sent, or last changed for a draft), its expected date, its lines with their prices, its
   * shipping, its total and its note. ORBES sends it to the supplier itself.
   */
  async pdf(supplierOrderId: string): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
    return renderSupplierOrderPdf(await this.document(supplierOrderId));
  }

  /** What the supplier order's PDF prints (render/supplier-order.ts), never a contact's email nor phone. */
  async document(supplierOrderId: string): Promise<SupplierOrderDocument> {
    const v = await this.get(supplierOrderId);
    const supplier = await this.db.selectFrom('suppliers').select(['name', 'address']).where('id', '=', v.supplier.id).executeTakeFirstOrThrow();
    const doc: SupplierOrderDocument = {
      reference: v.reference,
      date: v.sentAt ?? v.updatedAt,
      expectedOn: v.expectedOn,
      from: { name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] },
      to: { name: supplier.name, address: supplier.address },
      deliverTo: { name: v.location.name, address: v.location.address },
      currency: v.currency,
      lines: v.lines.map((l) => ({ description: skuWords(l.sku), sku: l.sku.code, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor })),
      shippingMinor: v.shippingMinor,
      note: v.note,
    };
    return doc;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** A supplier order's row FOR UPDATE (404 SUPPLIER_ORDER_NOT_FOUND). */
  private async lockOrder(tx: Db, id: string): Promise<SupplierOrderRow> {
    const o = await tx.selectFrom('supplier_orders').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!o) throw supplierOrderNotFound();
    return o;
  }

  /** The unit price of the last sent line of a SKU with a supplier (Default (mine), §3.5.6.3), or null. */
  private async lastPrice(tx: Db, supplierId: string, skuId: string): Promise<number | null> {
    const r = await tx
      .selectFrom('supplier_order_lines as l')
      .innerJoin('supplier_orders as o', 'o.id', 'l.supplier_order_id')
      .select('l.unit_price_minor')
      .where('o.supplier_id', '=', supplierId)
      .where('l.sku_id', '=', skuId)
      .where('o.sent_at', 'is not', null)
      .where('l.unit_price_minor', 'is not', null)
      .orderBy('o.sent_at', 'desc')
      .orderBy('o.id')
      .limit(1)
      .executeTakeFirst();
    return r?.unit_price_minor ?? null;
  }

  /** Two drafts of one supplier and location created at once: the second retries and adds to the first. */
  private async retryDraft<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e, 'supplier_orders_one_draft')) return fn();
      throw e;
    }
  }
}
