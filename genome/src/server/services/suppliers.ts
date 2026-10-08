/**
 * The suppliers (plan NEXT LOT of 2026-10-07, §3.5.6.2; migration 0035, table `suppliers`; API §16.32, DATABASE §5.77):
 * « ORBES does not make its pieces: suppliers do », several from the start, and « each model (or each size) has its
 * supplier ».
 *
 *   a supplier   its name (1 to 120 characters, unique whatever the case: 409 SUPPLIER_NAME_TAKEN), its contact (name,
 *                email, phone, address), the currency it bills in, a note, `active`. The currency is an ISO 4217 code
 *                with two decimals: every amount of a supplier order is kept and printed in hundredths, so a zero- or
 *                three-decimal currency (`UNSUPPORTED_CURRENCIES`) would print 100 times too small or ten times too
 *                big, and is refused (400 'This currency is not supported: choose one with cents.'). A supplier is
 *                never deleted: set inactive, it stays on its models and orders and is offered for no new draft.
 *                `create` and `update` (OPERATOR), audited `supplier.create` (its name, currency and state) and
 *                `supplier.update` (`{ fields }`: the names of the fields changed, never the contact's words).
 *   a model's    `models.supplier_id`, and a size's own `skus.supplier_id`, which wins over its model's; a variant
 *                without one uses its main model's (`supplierOf`: the size's, else the model's, else the main
 *                model's). `setModelSupplier` (OPERATOR) under the model's row lock (FOR NO KEY UPDATE, as the sizes'
 *                writes), audited `model.supplier` (the ids before and after).
 *
 * Nothing here is ever read by a LOGISTICS login: the routes are AUDITOR's to read and OPERATOR's to write.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { JsonObject, SupplierRow } from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Control characters (line breaks are allowed in the multi-line fields only). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The bounds of a supplier's fields (as the CHECKs of migration 0035). */
export const SUPPLIER_LIMITS = Object.freeze({ name: 120, contactName: 120, email: 254, phone: 40, address: 500, note: 1000 });

/**
 * ISO 4217 codes without two decimals (plan NEXT LOT §3.5.6.3): zero decimals (BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW,
 * PYG, RWF, UGX, UYI, VND, VUV, XAF, XOF, XPF) and three (BHD, IQD, JOD, KWD, LYD, OMR, TND). Every amount is kept and
 * printed in hundredths, so these are refused for a supplier and a supplier order.
 */
export const UNSUPPORTED_CURRENCIES: readonly string[] = Object.freeze([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

export const CURRENCY_NOT_SUPPORTED = 'This currency is not supported: choose one with cents.';

/** A supplier's currency (and a supplier order's): three capitals, two decimals; null clears it. */
export function cleanCurrency(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw validationError('The currency is a three-letter code, such as EUR.');
  const code = v.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw validationError('The currency is a three-letter code, such as EUR.');
  if (UNSUPPORTED_CURRENCIES.includes(code)) throw validationError(CURRENCY_NOT_SUPPORTED);
  return code;
}

const supplierNotFound = () => notFound('Supplier', 'SUPPLIER_NOT_FOUND');
const nameTaken = () => conflict('SUPPLIER_NAME_TAKEN', 'Another supplier has this name.');
const modelNotFound = () => notFound('Model', 'MODEL_NOT_FOUND');
const skuNotFound = () => notFound('SKU', 'SKU_NOT_FOUND');

/** A supplier as the console reads it (Supplier orders → Suppliers). */
export interface SupplierView {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string | null;
  note: string | null;
  active: boolean;
  /** How many models name it as their supplier (a variant counts as its own model). */
  models: number;
  createdAt: Date;
}

/** A supplier named on a model's page. */
export interface SupplierRef {
  id: string;
  name: string;
  active: boolean;
}

/**
 * A model's supplier, as its Sizes section shows it (plan NEXT LOT §3.5.4.5): its own, or a variant's main model's;
 * and each size's own (by SKU id; a size absent uses the model's).
 */
export interface ModelSupplier {
  /** The model's own supplier; null: none. */
  own: SupplierRef | null;
  /** A variant without its own: its main model's, and that model's name; else null. */
  inherited: (SupplierRef & { from: string }) | null;
  /** A size's own supplier, by its SKU id; a size not listed uses the model's. */
  sizes: Record<string, SupplierRef>;
}

/** What a supplier is created or changed with; `undefined` leaves a field as it is, `null` clears an optional one. */
export interface SupplierInput {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  currency?: string | null;
  note?: string | null;
  active?: boolean;
}

/** The fields of a supplier and their columns, in the order an audit entry lists them. */
const FIELDS = [
  ['name', 'name'],
  ['contactName', 'contact_name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['currency', 'currency'],
  ['note', 'note'],
  ['active', 'active'],
] as const;

type SupplierColumns = { name?: string; contact_name?: string | null; email?: string | null; phone?: string | null; address?: string | null; currency?: string | null; note?: string | null; active?: boolean };

/** Text as the console types it: trimmed; one line unless `lines`; 1 to `max` characters; '' or null clears an optional one. */
function cleanText(v: unknown, max: number, label: string, opts: { lines?: boolean; required?: boolean } = {}): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) throw validationError(`${label} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw validationError(`${label} must be text.`);
  const s = opts.lines ? v.replace(/\r\n?/g, '\n').trim() : v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s) || (!opts.lines && s.includes('\n'))) throw validationError(`${label} contains invalid characters.`);
  if ([...s].length > max) throw validationError(`${label} must be at most ${max} characters.`);
  return s;
}

/** The columns a supplier input sets, checked; only the fields given. */
function columnsOf(input: SupplierInput, creating: boolean): SupplierColumns {
  const out: SupplierColumns = {};
  if (creating || input.name !== undefined) out.name = cleanText(input.name, SUPPLIER_LIMITS.name, 'The name', { required: true })!;
  if (input.contactName !== undefined) out.contact_name = cleanText(input.contactName, SUPPLIER_LIMITS.contactName, 'The contact name');
  if (input.email !== undefined) {
    const email = cleanText(input.email, SUPPLIER_LIMITS.email, 'The email');
    if (email !== null && !EMAIL_RE.test(email)) throw validationError('Enter a valid email address.');
    out.email = email;
  }
  if (input.phone !== undefined) out.phone = cleanText(input.phone, SUPPLIER_LIMITS.phone, 'The phone');
  if (input.address !== undefined) out.address = cleanText(input.address, SUPPLIER_LIMITS.address, 'The address', { lines: true });
  if (input.currency !== undefined) out.currency = cleanCurrency(input.currency);
  if (input.note !== undefined) out.note = cleanText(input.note, SUPPLIER_LIMITS.note, 'The note', { lines: true });
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') throw validationError('Active is true or false.');
    out.active = input.active;
  }
  return out;
}

const view = (r: SupplierRow & { models: number }): SupplierView => ({
  id: r.id,
  name: r.name,
  contactName: r.contact_name,
  email: r.email,
  phone: r.phone,
  address: r.address,
  currency: r.currency,
  note: r.note,
  active: r.active,
  models: Number(r.models ?? 0),
  createdAt: r.created_at,
});

/** The suppliers with how many models name each, by name (`where` narrows to one). */
async function supplierRows(db: Db, id?: string): Promise<SupplierView[]> {
  let q = db
    .selectFrom('suppliers as s')
    .selectAll('s')
    .select((eb) => eb.selectFrom('models as m').select((e) => e.fn.countAll<number>().as('n')).whereRef('m.supplier_id', '=', 's.id').as('models'));
  if (id !== undefined) q = q.where('s.id', '=', id);
  const rows = await q.orderBy(sql`lower(s.name)`).execute();
  return rows.map((r) => view(r as SupplierRow & { models: number }));
}

/**
 * The supplier of a size (plan NEXT LOT §3.5.6.2): the size's own (`skus.supplier_id`), else its model's, else, for a
 * variant, its main model's; null when none is set. Read in `tx` (a supplier order's draft, the proposal).
 */
export async function supplierOf(tx: Db, skuId: string): Promise<string | null> {
  const r = await sql<{ supplier_id: string | null }>`
    SELECT coalesce(k.supplier_id, m.supplier_id, main.supplier_id) AS supplier_id
      FROM skus k
      JOIN models m ON m.id = k.model_id
      LEFT JOIN models main ON main.id = m.variant_of
     WHERE k.id = ${skuId}`.execute(tx);
  return r.rows[0]?.supplier_id ?? null;
}

/** A model's supplier, its main model's when a variant has none, and its sizes' own (the Sizes section, §3.5.4.5). */
export async function modelSupplier(db: Db, modelId: string): Promise<ModelSupplier> {
  const m = await db
    .selectFrom('models as m')
    .leftJoin('suppliers as own', 'own.id', 'm.supplier_id')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .leftJoin('suppliers as up', 'up.id', 'main.supplier_id')
    .select(['own.id as own_id', 'own.name as own_name', 'own.active as own_active', 'up.id as up_id', 'up.name as up_name', 'up.active as up_active', 'main.name as main_name'])
    .where('m.id', '=', modelId)
    .executeTakeFirst();
  const sizes = await db
    .selectFrom('skus as k')
    .innerJoin('suppliers as s', 's.id', 'k.supplier_id')
    .select(['k.id as sku_id', 's.id', 's.name', 's.active'])
    .where('k.model_id', '=', modelId)
    .execute();
  return {
    own: m?.own_id ? { id: m.own_id, name: m.own_name!, active: m.own_active! } : null,
    inherited: m && !m.own_id && m.up_id ? { id: m.up_id, name: m.up_name!, active: m.up_active!, from: m.main_name! } : null,
    sizes: Object.fromEntries(sizes.map((r) => [r.sku_id, { id: r.id, name: r.name, active: r.active }])),
  };
}

export interface SupplierServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class SupplierService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: SupplierServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every supplier, by name, with how many models name it (GET /api/admin/suppliers, AUDITOR). */
  list(): Promise<SupplierView[]> {
    return supplierRows(this.db);
  }

  /** One supplier (404 SUPPLIER_NOT_FOUND). */
  async get(supplierId: string): Promise<SupplierView> {
    const id = knownId(supplierId, supplierNotFound);
    const row = (await supplierRows(this.db, id))[0];
    if (!row) throw supplierNotFound();
    return row;
  }

  /** A supplier added (POST /api/admin/suppliers, OPERATOR). Audited `supplier.create` with its name, currency and state. */
  async create(input: SupplierInput, actor: Actor): Promise<SupplierView> {
    assertStaff(actor);
    const columns = columnsOf(input ?? {}, true);
    const id = await this.named(() =>
      inTransaction(this.db, async (tx) => {
        const row = await tx
          .insertInto('suppliers')
          .values({ ...columns, name: columns.name!, created_by: actor.type === 'admin' ? actor.id : null, created_at: this.clock() })
          .returning(['id', 'name', 'currency', 'active'])
          .executeTakeFirstOrThrow();
        await this.audit.record({ actor, action: 'supplier.create', targetType: 'supplier', targetId: row.id, details: { name: row.name, currency: row.currency, active: row.active } }, tx);
        return row.id;
      }),
    );
    return this.get(id);
  }

  /**
   * A supplier changed (PATCH /api/admin/suppliers/:id, OPERATOR): the fields given, under its row lock. Audited
   * `supplier.update` with the names of the fields changed only, never the contact's words; nothing changed, nothing
   * written.
   */
  async update(supplierId: string, input: SupplierInput, actor: Actor): Promise<SupplierView> {
    assertStaff(actor);
    const id = knownId(supplierId, supplierNotFound);
    const columns = columnsOf(input ?? {}, false);
    await this.named(() =>
      inTransaction(this.db, async (tx) => {
        const before = await tx.selectFrom('suppliers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!before) throw supplierNotFound();
        const changed = FIELDS.filter(([, column]) => column in columns && columns[column] !== before[column]);
        if (changed.length === 0) return;
        await tx
          .updateTable('suppliers')
          .set(Object.fromEntries(changed.map(([, column]) => [column, columns[column]])))
          .where('id', '=', id)
          .execute();
        await this.audit.record({ actor, action: 'supplier.update', targetType: 'supplier', targetId: id, details: { fields: changed.map(([field]) => field) } }, tx);
      }),
    );
    return this.get(id);
  }

  /**
   * A model's supplier and its sizes' own (PUT /api/admin/models/:id/supplier, OPERATOR; plan NEXT LOT §3.5.4.5):
   * `supplierId` when given (null: none), and each size listed in `sizes` (a SKU of this model: 404 SKU_NOT_FOUND
   * otherwise; null: its model's), a size not listed left as it is. Every supplier named exists (404
   * SUPPLIER_NOT_FOUND). Under the model's row FOR NO KEY UPDATE, as the sizes' writes. Audited `model.supplier` with
   * the ids before and after; nothing changed, nothing written.
   */
  async setModelSupplier(modelId: string, input: { supplierId?: string | null; sizes?: Readonly<Record<string, string | null>> }, actor: Actor): Promise<ModelSupplier> {
    assertStaff(actor);
    const id = knownId(modelId, modelNotFound);
    const own = input?.supplierId === undefined ? undefined : input.supplierId === null ? null : knownId(input.supplierId, supplierNotFound);
    const sizes = Object.entries(input?.sizes ?? {}).map(([skuId, supplierId]) => ({
      skuId: knownId(skuId, skuNotFound),
      supplierId: supplierId === null ? null : knownId(supplierId, supplierNotFound),
    }));
    await inTransaction(this.db, async (tx) => {
      const m = await tx.selectFrom('models').select(['id', 'supplier_id']).where('id', '=', id).forNoKeyUpdate().executeTakeFirst();
      if (!m) throw modelNotFound();
      const named = [...new Set([own, ...sizes.map((z) => z.supplierId)].filter((x): x is string => typeof x === 'string'))];
      if (named.length > 0) {
        const found = await tx.selectFrom('suppliers').select('id').where('id', 'in', named).forShare().execute();
        if (found.length !== named.length) throw supplierNotFound();
      }
      const skus =
        sizes.length > 0
          ? await tx
              .selectFrom('skus')
              .select(['id', 'supplier_id'])
              .where('model_id', '=', id)
              .where(
                'id',
                'in',
                sizes.map((z) => z.skuId),
              )
              .orderBy('id')
              .forUpdate()
              .execute()
          : [];
      if (skus.length !== new Set(sizes.map((z) => z.skuId)).size) throw skuNotFound();
      const details: JsonObject = {};
      if (own !== undefined && own !== m.supplier_id) {
        await tx.updateTable('models').set({ supplier_id: own }).where('id', '=', id).execute();
        details.supplierId = { from: m.supplier_id, to: own };
      }
      const sizeChanges: JsonObject = {};
      for (const z of sizes) {
        const before = skus.find((k) => k.id === z.skuId)!.supplier_id;
        if (before === z.supplierId) continue;
        await tx.updateTable('skus').set({ supplier_id: z.supplierId }).where('id', '=', z.skuId).execute();
        sizeChanges[z.skuId] = { from: before, to: z.supplierId };
      }
      if (Object.keys(sizeChanges).length > 0) details.sizes = sizeChanges;
      if (Object.keys(details).length === 0) return;
      await this.audit.record({ actor, action: 'model.supplier', targetType: 'model', targetId: id, details }, tx);
    });
    return modelSupplier(this.db, id);
  }

  /** Two suppliers named alike at the same moment: one wins, the other is told (409 SUPPLIER_NAME_TAKEN). */
  private async named<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e, 'suppliers_name_key')) throw nameTaken();
      throw e;
    }
  }
}

function knownId(v: unknown, missing: () => Error): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw missing();
  return v.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change the suppliers.');
}
