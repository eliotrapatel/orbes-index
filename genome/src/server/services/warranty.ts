/**
 * WarrantyService — warranty activation, status, void/extend, and service
 * records (contract §2.8).
 *
 * Dates are calendar dates ('YYYY-MM-DD') evaluated in UTC: `today` is the
 * UTC date of the injected clock. The end date is the start date plus the
 * category's warranty months, with month arithmetic clamped to the end of
 * the month (2026-01-31 + 1 month = 2026-02-28; 2024-02-29 + 12 = 2025-02-28).
 * Coverage includes the end date.
 *
 * Status is computed, never stored:
 *   VOID         voided_at is set (wins over everything)
 *   NOT_STARTED  no warranty row, no start date, or start date in the future
 *   EXPIRED      today > end date, or a 0-month warranty (no coverage)
 *   ACTIVE       otherwise
 *
 * Opening a service moves the product to SERVICED; completing (or
 * cancelling) the last open service returns it to its pre-service status via
 * LifecycleService, which derives that status from the status history.
 *
 * Point of sale (A-08): an activation names it by `retailerId`, an active
 * entry of the register (services/retailers.ts), whose country is the
 * purchase country unless another is given. The free-text `retailer` is still
 * accepted (history, API callers); a record's `retailer` is the register's
 * name when `retailerId` is set, the free text otherwise.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { SERVICE_TYPES, type ProductRow, type ProductStatus, type ServiceType, type WarrantyRow } from '../db/schema.js';
import { DomainError, notFound, validationError } from '../errors.js';
import { makePage, pageOffset, systemClock, type Actor, type Clock, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';
import { actorLabel, cleanReason, isPreSaleService, requireProduct, type LifecycleService, type StatusChange } from './lifecycle.js';
import { requireActiveRetailer } from './retailers.js';

export const WARRANTY_STATUSES = ['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** Product statuses in which the warranty can start without a status change (ISSUED moves to ACTIVATED). */
export const ACTIVATABLE_STATUSES: readonly ProductStatus[] = Object.freeze([
  'ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD',
]);

const MAX_EXTEND_MONTHS = 120;
const MAX_DURATION_MONTHS = 1200; // DB CHECK
const MIN_PURCHASE_DATE = '2000-01-01';
const MAX_TEXT = 200;
const MAX_NOTES = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

// ── Date helpers (pure, UTC) ───────────────────────────────────────────────

/** The UTC calendar date of an instant, 'YYYY-MM-DD'. */
export function utcDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new RangeError('invalid date');
  return d.toISOString().slice(0, 10);
}

/** Strictly parse a real calendar date 'YYYY-MM-DD' (rejects 2026-02-30); undefined otherwise. */
export function parseCalendarDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = DATE_RE.exec(v);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return undefined;
  if (d > daysInMonth(y, mo)) return undefined;
  return v;
}

function daysInMonth(year: number, month1: number): number {
  // Day 0 of the next month is the last day of this one.
  const t = new Date(0);
  t.setUTCFullYear(year, month1, 0);
  return t.getUTCDate();
}

/** `date` plus `months` calendar months, clamped to the last day of the target month. */
export function addMonthsClamped(date: string, months: number): string {
  const d = parseCalendarDate(date);
  if (d === undefined) throw new RangeError(`invalid calendar date: ${String(date)}`);
  if (!Number.isInteger(months)) throw new RangeError('months must be an integer');
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  if (ny < 1 || ny > 9999) throw new RangeError('resulting date is out of range');
  const nd = Math.min(day, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

type WarrantyDates = Pick<WarrantyRow, 'start_date' | 'end_date' | 'voided_at' | 'duration_months'>;

/** Computed warranty status at UTC date `today` ('YYYY-MM-DD'). */
export function computeWarrantyStatus(w: WarrantyDates | null | undefined, today: string): WarrantyStatus {
  if (!w) return 'NOT_STARTED';
  if (w.voided_at !== null) return 'VOID';
  if (w.start_date === null || w.start_date > today) return 'NOT_STARTED';
  if (w.duration_months === 0) return 'EXPIRED';
  if (w.end_date !== null && w.end_date < today) return 'EXPIRED';
  return 'ACTIVE';
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface WarrantyRecord {
  productId: string;
  purchaseDate: string | null;
  /** The point of sale's name: from the register when `retailerId` is set, else the free text. */
  retailer: string | null;
  /** The point of sale in the register (A-08), or null (none, or recorded as free text). */
  retailerId: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number;
  voidedAt: Date | null;
  voidReason: string | null;
  status: WarrantyStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The public shape used in verification results and owner views. */
export interface WarrantySummary {
  status: WarrantyStatus;
  startDate?: string;
  endDate?: string;
}

export interface ActivateWarrantyInput {
  /** 'YYYY-MM-DD'; defaults to today (UTC). */
  purchaseDate?: string;
  /** Free text, kept for the history and API callers; the console sends `retailerId`. */
  retailer?: string | null;
  /** An active point of sale of the register (A-08); its country is the default purchase country. */
  retailerId?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
}

type WarrantyRowWithRetailer = WarrantyRow & { retailer_name: string | null };

export interface ServiceRecord {
  id: string;
  productId: string;
  type: ServiceType;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  location: string | null;
  notes: string | null;
  openedAt: Date;
  closedAt: Date | null;
  performedBy: string | null;
}

export interface OpenServiceInput {
  type: ServiceType;
  location?: string | null;
  notes?: string | null;
  /** Workshop / technician; defaults to the acting user. */
  performedBy?: string | null;
}

export interface ServiceClosure {
  service: ServiceRecord;
  /** The return to the pre-service status, or null when the product was not (only) in this service. */
  statusChange: StatusChange | null;
}

// ── Service ────────────────────────────────────────────────────────────────

export class WarrantyService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly lifecycle: LifecycleService;
  private readonly clock: Clock;

  constructor(deps: { db: Db; audit: AuditService; lifecycle: LifecycleService; clock?: Clock }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.lifecycle = deps.lifecycle;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * The sale mode's facts, again under the product's row lock (SaleService.activate): no client account holds the
   * piece (409 ALREADY_REGISTERED: it has been sold), it is not in a service (409 WARRANTY_ACTIVATION_NOT_ALLOWED:
   * at the workshop, not at the counter), and the code the seller scanned is still its ACTIVE code (the same 409: a
   * code revoked meanwhile, ORBES reviews the piece first). The console's warranty dialog (OPERATOR) is not bound by
   * them: it may start the warranty of a registered piece, deliberately.
   */
  private async assertStillForSale(tx: Db, product: { id: string; status: ProductStatus }, saleScanId: string): Promise<void> {
    const owner = await tx.selectFrom('ownership').select('id').where('product_id', '=', product.id).where('ended_at', 'is', null).executeTakeFirst();
    if (owner) throw new DomainError('ALREADY_REGISTERED', 409, 'This piece is registered to a client: it has been sold. Contact ORBES.');
    const notForSale = (detail: string) =>
      new DomainError('WARRANTY_ACTIVATION_NOT_ALLOWED', 409, 'The status of this piece does not allow a sale. Contact ORBES.', { detail });
    if (product.status === 'SERVICED') throw notForSale('in a service');
    const scan = await tx
      .selectFrom('scan_events as s')
      .leftJoin('codes as c', 'c.id', 's.code_id')
      .select(['s.code_id', 'c.status as code_status', 'c.product_id as code_product'])
      .where('s.id', '=', saleScanId)
      .executeTakeFirst();
    if (!scan?.code_id || scan.code_product !== product.id || scan.code_status !== 'ACTIVE') throw notForSale('the scanned code is no longer the active code of the piece');
  }

  /**
   * Retailer/admin activation: start the warranty on the purchase date for
   * the category's warranty months. An ISSUED product moves to ACTIVATED; a
   * product in a pre-sale service (ISSUED → SERVICED) is refused until the
   * service is closed (409 WARRANTY_ACTIVATION_NOT_ALLOWED).
   * `opts.tx` runs it inside the caller's transaction (the sale mode uses up
   * its scan token in the same one); `opts.saleScanId`, the staff scan that
   * token came from, is recorded in the audit entry, and the sale's facts
   * are checked again (assertStillForSale).
   */
  async activate(
    productId: string,
    input: ActivateWarrantyInput,
    actor: Actor,
    opts: { tx?: Db; saleScanId?: string } = {},
  ): Promise<{ warranty: WarrantyRecord; statusChange: StatusChange | null }> {
    const now = this.clock();
    const today = utcDate(now);
    const purchaseDate = input.purchaseDate === undefined ? today : parseCalendarDate(input.purchaseDate);
    if (purchaseDate === undefined) throw validationError('Purchase date must be a valid YYYY-MM-DD date.');
    // One day of slack: a shop in UTC+14 can already be "tomorrow".
    if (purchaseDate < MIN_PURCHASE_DATE || purchaseDate > utcDate(new Date(now.getTime() + DAY_MS))) {
      throw validationError('Purchase date is out of range.');
    }
    const retailer = cleanText(input.retailer, 'Retailer', MAX_TEXT);
    const givenCountry = cleanCountry(input.country);

    return inTransaction(opts.tx ?? this.db, async (tx) => {
      const pointOfSale = input.retailerId === undefined || input.retailerId === null ? null : await requireActiveRetailer(tx, input.retailerId);
      const country = givenCountry ?? pointOfSale?.country?.trim() ?? null;
      const product = await requireProduct(tx, productId, { forUpdate: true });
      const existing = await tx.selectFrom('warranties').selectAll().where('product_id', '=', product.id).executeTakeFirst();
      if (existing?.voided_at) throw new DomainError('WARRANTY_VOID', 409, 'The warranty of this product has been voided.');
      if (existing?.start_date) throw new DomainError('WARRANTY_ALREADY_ACTIVATED', 409, 'The warranty of this product is already activated.');
      if (!ACTIVATABLE_STATUSES.includes(product.status)) {
        throw new DomainError('WARRANTY_ACTIVATION_NOT_ALLOWED', 409, 'The warranty of this product cannot be activated.', {
          detail: `status ${product.status}`,
        });
      }
      // A pre-sale service (ISSUED → SERVICED: inspection, quality control) is not a sale: the piece
      // would stay SERVICED with ISSUED as its return target, so closing the service would bring it
      // back to ISSUED with a started warranty. The service is closed first, then the piece is sold.
      if (await isPreSaleService(tx, product)) {
        throw new DomainError('WARRANTY_ACTIVATION_NOT_ALLOWED', 409, 'The warranty of this product cannot be activated.', {
          detail: 'pre-sale service: complete or cancel the service first',
        });
      }
      // The sale mode (A-08): the token was minted on facts of the scan (no client holds the piece, not in a service,
      // its code in force) that may have changed during its 10 minutes; checked again under the row lock.
      if (opts.saleScanId !== undefined) await this.assertStillForSale(tx, product, opts.saleScanId);

      const months = await this.categoryMonths(tx, product.category_id);
      const endDate = addMonthsClamped(purchaseDate, months);
      const values = {
        purchase_date: purchaseDate,
        retailer,
        retailer_id: pointOfSale?.id ?? null,
        country,
        start_date: purchaseDate,
        duration_months: months,
        end_date: endDate,
        updated_at: now,
      };
      const row = existing
        ? await tx.updateTable('warranties').set(values).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto('warranties').values({ product_id: product.id, ...values, created_at: now }).returningAll().executeTakeFirstOrThrow();

      const statusChange =
        product.status === 'ISSUED'
          ? await this.lifecycle.applyForService(tx, product, 'ACTIVATED', { reason: 'warranty activated', via: 'warranty.activate' }, actor)
          : null;

      await this.audit.record(
        {
          actor,
          action: 'warranty.activate',
          targetType: 'product',
          targetId: product.product_id,
          details: {
            purchaseDate,
            startDate: purchaseDate,
            endDate,
            durationMonths: months,
            retailer: pointOfSale?.name ?? retailer,
            ...(pointOfSale ? { retailerId: pointOfSale.id } : {}),
            country,
            ...(opts.saleScanId ? { saleScanId: opts.saleScanId } : {}),
          },
        },
        tx,
      );
      return { warranty: toRecord({ ...row, retailer_name: pointOfSale?.name ?? null }, product.product_id, today), statusChange };
    });
  }

  /** NOT_STARTED, ACTIVE, EXPIRED or VOID at `now` (default: the clock). */
  async status(productId: string, now?: Date): Promise<WarrantyStatus> {
    return (await this.summary(productId, now)).status;
  }

  /** Status plus dates, in the public shape (verification results, owner pages). */
  async summary(productId: string, now?: Date): Promise<WarrantySummary> {
    const w = await this.get(productId, now);
    if (!w) return { status: 'NOT_STARTED' };
    return {
      status: w.status,
      ...(w.startDate ? { startDate: w.startDate } : {}),
      ...(w.endDate ? { endDate: w.endDate } : {}),
    };
  }

  /** The full warranty record (admin), or null when none exists yet. */
  async get(productId: string, now?: Date): Promise<WarrantyRecord | null> {
    const product = await requireProduct(this.db, productId);
    const row = await this.db
      .selectFrom('warranties as w')
      .leftJoin('retailers as r', 'r.id', 'w.retailer_id')
      .selectAll('w')
      .select('r.name as retailer_name')
      .where('w.product_id', '=', product.id)
      .executeTakeFirst();
    return row ? toRecord(row, product.product_id, utcDate(now ?? this.clock())) : null;
  }

  /** Void the warranty (e.g. unauthorised modification). Works before activation too. */
  async void(productId: string, reason: string | null | undefined, actor: Actor): Promise<WarrantyRecord> {
    const why = cleanReason(reason);
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const product = await requireProduct(tx, productId, { forUpdate: true });
      const existing = await tx.selectFrom('warranties').selectAll().where('product_id', '=', product.id).executeTakeFirst();
      if (existing?.voided_at) throw new DomainError('WARRANTY_ALREADY_VOID', 409, 'The warranty of this product is already void.');
      const row = existing
        ? await tx
            .updateTable('warranties')
            .set({ voided_at: now, void_reason: why, updated_at: now })
            .where('id', '=', existing.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await tx
            .insertInto('warranties')
            .values({
              product_id: product.id,
              duration_months: await this.categoryMonths(tx, product.category_id),
              voided_at: now,
              void_reason: why,
              created_at: now,
              updated_at: now,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      await this.audit.record(
        { actor, action: 'warranty.void', targetType: 'product', targetId: product.product_id, details: why === null ? {} : { reason: why } },
        tx,
      );
      return toRecord(await withRetailerName(tx, row), product.product_id, utcDate(now));
    });
  }

  /** Alias of `void` for callers that avoid the reserved word. */
  voidWarranty(productId: string, reason: string | null | undefined, actor: Actor): Promise<WarrantyRecord> {
    return this.void(productId, reason, actor);
  }

  /** Add months to an activated warranty (goodwill, paid extension). The end date is recomputed from the start. */
  async extend(productId: string, months: number, actor: Actor): Promise<WarrantyRecord> {
    if (!Number.isInteger(months) || months < 1 || months > MAX_EXTEND_MONTHS) {
      throw validationError(`Extension must be 1 to ${MAX_EXTEND_MONTHS} months.`);
    }
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const product = await requireProduct(tx, productId, { forUpdate: true });
      const w = await tx.selectFrom('warranties').selectAll().where('product_id', '=', product.id).executeTakeFirst();
      if (w?.voided_at) throw new DomainError('WARRANTY_VOID', 409, 'The warranty of this product has been voided.');
      if (!w?.start_date) throw new DomainError('WARRANTY_NOT_STARTED', 409, 'The warranty of this product has not been activated.');
      const duration = w.duration_months + months;
      if (duration > MAX_DURATION_MONTHS) throw validationError('The warranty cannot be extended that far.');
      // From the start, not from the old end: clamping must not compound (Jan 31 → Feb 28 → Mar 28).
      const endDate = addMonthsClamped(w.start_date, duration);
      const row = await tx
        .updateTable('warranties')
        .set({ duration_months: duration, end_date: endDate, updated_at: now })
        .where('id', '=', w.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor,
          action: 'warranty.extend',
          targetType: 'product',
          targetId: product.product_id,
          details: { months, durationMonths: duration, previousEndDate: w.end_date, endDate },
        },
        tx,
      );
      return toRecord(await withRetailerName(tx, row), product.product_id, utcDate(now));
    });
  }

  // ── Service records ──────────────────────────────────────────────────────

  /** Open a service record and move the product to SERVICED. */
  async openService(productId: string, input: OpenServiceInput, actor: Actor): Promise<ServiceRecord> {
    if (!SERVICE_TYPES.includes(input.type)) throw validationError('Unknown service type.');
    const location = cleanText(input.location, 'Location', MAX_TEXT);
    const notes = cleanText(input.notes, 'Notes', MAX_NOTES, true);
    const performedBy = cleanText(input.performedBy, 'Performed by', MAX_TEXT) ?? actorLabel(actor);
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const product = await requireProduct(tx, productId, { forUpdate: true });
      await this.lifecycle.applyForService(
        tx,
        product,
        'SERVICED',
        { reason: `service opened (${input.type})`, via: 'warranty.openService' },
        actor,
      );
      const row = await tx
        .insertInto('service_records')
        .values({ product_id: product.id, type: input.type, status: 'OPEN', location, notes, opened_at: now, performed_by: performedBy })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(
        {
          actor,
          action: 'service.open',
          targetType: 'product',
          targetId: product.product_id,
          details: { serviceId: row.id, type: input.type, location },
        },
        tx,
      );
      return toService(row, product.product_id);
    });
  }

  /** Complete an open service; the last one to close returns the product to its pre-service status. */
  async completeService(serviceId: string, input: { notes?: string | null } = {}, actor: Actor): Promise<ServiceClosure> {
    const notes = cleanText(input.notes, 'Notes', MAX_NOTES, true);
    return this.closeService(serviceId, 'COMPLETED', notes, actor);
  }

  /** Cancel an open service (opened by mistake, client withdrew); same status return as completion. */
  async cancelService(serviceId: string, input: { reason: string }, actor: Actor): Promise<ServiceClosure> {
    const reason = cleanReason(input.reason, 'Reason', true)!;
    return this.closeService(serviceId, 'CANCELLED', `Cancelled: ${reason}`, actor);
  }

  /** Service records of a product, oldest first. */
  async services(productId: string): Promise<ServiceRecord[]> {
    const product = await requireProduct(this.db, productId);
    const rows = await this.db
      .selectFrom('service_records')
      .selectAll()
      .where('product_id', '=', product.id)
      .orderBy('opened_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((r) => toService(r, product.product_id));
  }

  /** Admin list, newest first, optionally filtered by computed status. */
  async list(filters: { status?: WarrantyStatus } = {}, page: PageRequest = { page: 1, pageSize: 50 }): Promise<Page<WarrantyRecord>> {
    if (filters.status !== undefined && !WARRANTY_STATUSES.includes(filters.status)) throw validationError('Unknown warranty status.');
    const today = utcDate(this.clock());
    // Same rules as computeWarrantyStatus, in SQL so filtering and paging happen in the database.
    const statusExpr = sql<WarrantyStatus>`CASE
      WHEN w.voided_at IS NOT NULL THEN 'VOID'
      WHEN w.start_date IS NULL OR w.start_date > ${today}::date THEN 'NOT_STARTED'
      WHEN w.duration_months = 0 OR w.end_date < ${today}::date THEN 'EXPIRED'
      ELSE 'ACTIVE' END`;
    let q = this.db.selectFrom('warranties as w').innerJoin('products as p', 'p.id', 'w.product_id');
    if (filters.status !== undefined) q = q.where(statusExpr, '=', filters.status);
    const [rows, count] = await Promise.all([
      q
        .leftJoin('retailers as r', 'r.id', 'w.retailer_id')
        .selectAll('w')
        .select(['p.product_id as canonical_id', 'r.name as retailer_name'])
        .orderBy('w.created_at', 'desc')
        .orderBy('w.id')
        .limit(page.pageSize)
        .offset(pageOffset(page))
        .execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return makePage(rows.map((r) => toRecord(r, r.canonical_id, today)), Number(count.n), page);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async closeService(serviceId: string, status: 'COMPLETED' | 'CANCELLED', notes: string | null, actor: Actor): Promise<ServiceClosure> {
    if (typeof serviceId !== 'string' || !UUID_RE.test(serviceId)) throw notFound('Service record', 'SERVICE_NOT_FOUND');
    const now = this.clock();
    return inTransaction(this.db, async (tx) => {
      const peek = await tx.selectFrom('service_records').select('product_id').where('id', '=', serviceId).executeTakeFirst();
      if (!peek) throw notFound('Service record', 'SERVICE_NOT_FOUND');
      // Lock order product → service, the same as openService, so concurrent calls cannot deadlock.
      const product = await requireProduct(tx, peek.product_id, { forUpdate: true });
      const service = await tx.selectFrom('service_records').selectAll().where('id', '=', serviceId).forUpdate().executeTakeFirstOrThrow();
      if (service.status !== 'OPEN') throw new DomainError('SERVICE_NOT_OPEN', 409, 'This service record is already closed.');

      const updated = await tx
        .updateTable('service_records')
        .set({
          status,
          closed_at: now < service.opened_at ? service.opened_at : now,
          notes: notes === null ? service.notes : service.notes ? `${service.notes}\n\n${notes}` : notes,
        })
        .where('id', '=', serviceId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const statusChange = await this.returnFromService(tx, product, serviceId, status, actor);
      await this.audit.record(
        {
          actor,
          action: status === 'COMPLETED' ? 'service.complete' : 'service.cancel',
          targetType: 'product',
          targetId: product.product_id,
          details: { serviceId, type: service.type, returnedTo: statusChange?.to ?? null },
        },
        tx,
      );
      return { service: toService(updated, product.product_id), statusChange };
    });
  }

  /** Return a SERVICED product to its pre-service status once no service is open any more. */
  private async returnFromService(tx: Db, product: ProductRow, serviceId: string, status: string, actor: Actor): Promise<StatusChange | null> {
    if (product.status !== 'SERVICED') return null; // moved on meanwhile (incident, revocation, first registration)
    const open = await tx
      .selectFrom('service_records')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('product_id', '=', product.id)
      .where('status', '=', 'OPEN')
      .where('id', '!=', serviceId)
      .executeTakeFirstOrThrow();
    if (Number(open.n) > 0) return null;
    const target = await this.lifecycle.previousStatus(product.id, tx);
    // Unknown pre-service status (history edited outside the service): leave SERVICED for an admin to resolve.
    if (target === null) return null;
    return this.lifecycle.applyForService(
      tx,
      product,
      target,
      { reason: status === 'COMPLETED' ? 'service completed' : 'service cancelled', via: 'warranty.closeService' },
      actor,
    );
  }

  private async categoryMonths(tx: Db, categoryId: number): Promise<number> {
    const c = await tx.selectFrom('categories').select('warranty_months').where('id', '=', categoryId).executeTakeFirstOrThrow();
    return c.warranty_months;
  }
}

// ── Mapping & validation ───────────────────────────────────────────────────

/** A warranty row with the name of its point of sale (null when it has none in the register). */
async function withRetailerName(db: Db, r: WarrantyRow): Promise<WarrantyRowWithRetailer> {
  if (r.retailer_id === null) return { ...r, retailer_name: null };
  const p = await db.selectFrom('retailers').select('name').where('id', '=', r.retailer_id).executeTakeFirst();
  return { ...r, retailer_name: p?.name ?? null };
}

function toRecord(r: WarrantyRowWithRetailer, productId: string, today: string): WarrantyRecord {
  return {
    productId,
    purchaseDate: r.purchase_date,
    retailer: r.retailer_name ?? r.retailer,
    retailerId: r.retailer_id,
    country: r.country,
    startDate: r.start_date,
    endDate: r.end_date,
    durationMonths: r.duration_months,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    status: computeWarrantyStatus(r, today),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toService(
  r: { id: string; type: ServiceType; status: ServiceRecord['status']; location: string | null; notes: string | null; opened_at: Date; closed_at: Date | null; performed_by: string | null },
  productId: string,
): ServiceRecord {
  return {
    id: r.id,
    productId,
    type: r.type,
    status: r.status,
    location: r.location,
    notes: r.notes,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    performedBy: r.performed_by,
  };
}

function cleanText(v: unknown, field: string, max: number, multiline = false): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw validationError(`${field} must be text.`);
  const s = v.trim();
  if (s === '') return null;
  if (s.length > max) throw validationError(`${field} is too long.`);
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (forbidden.test(s)) throw validationError(`${field} contains invalid characters.`);
  return s;
}

function cleanCountry(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v.trim())) throw validationError('Country must be an ISO 3166-1 alpha-2 code.');
  return v.trim().toUpperCase();
}
