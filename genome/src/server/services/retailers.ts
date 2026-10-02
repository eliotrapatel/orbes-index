/**
 * RetailerService — the register of points of sale (A-08).
 *
 * A warranty names its point of sale by `retailer_id` instead of free text,
 * so the console offers a list (the product page's Activate warranty dialog
 * and the sale mode of a seller's phone) and the same boutique is never
 * spelt three ways. An ADMIN keeps the register (create, rename, move,
 * deactivate); a retailer is never deleted (warranties point to it, and the
 * database refuses it), it is made inactive and leaves the lists.
 *
 * Names are unique per city, ignoring case (`retailers_name_city_unique`):
 * a second "ORBES Paris" in Paris is a 409, in Lyon it is another shop.
 * Every write is audited with the values before and after.
 */
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import type { RetailerRow } from '../db/schema.js';
import { conflict, DomainError, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';

export const RETAILER_NAME_MAX = 120;
export const RETAILER_CITY_MAX = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RetailerRecord {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRetailerInput {
  name: string;
  city?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
}

export interface UpdateRetailerInput {
  name?: string;
  city?: string | null;
  country?: string | null;
  active?: boolean;
}

export const retailerNotFound = () => notFound('Point of sale', 'RETAILER_NOT_FOUND');
export const retailerInactive = () => new DomainError('RETAILER_INACTIVE', 409, 'This point of sale is no longer active.');
const retailerExists = () => conflict('RETAILER_EXISTS', 'A point of sale with this name already exists in this city.');

export function toRetailerRecord(r: RetailerRow): RetailerRecord {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    country: r.country?.trim() ?? null,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The point of sale of `id`, active or not, inside `db` (a transaction when it must not change meanwhile). */
export async function findRetailer(db: Db, id: string, opts: { forShare?: boolean } = {}): Promise<RetailerRow | undefined> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return undefined;
  let q = db.selectFrom('retailers').selectAll().where('id', '=', id.toLowerCase());
  if (opts.forShare) q = q.forShare();
  return q.executeTakeFirst();
}

/** An active point of sale, locked against deactivation until the transaction ends (404 / 409 otherwise). */
export async function requireActiveRetailer(tx: Db, id: string): Promise<RetailerRow> {
  const r = await findRetailer(tx, id, { forShare: tx.isTransaction });
  if (!r) throw retailerNotFound();
  if (!r.active) throw retailerInactive();
  return r;
}

export class RetailerService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: { db: Db; audit: AuditService; clock?: Clock }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** By name, then city; `activeOnly` for the lists a sale is chosen from. */
  async list(opts: { activeOnly?: boolean } = {}): Promise<RetailerRecord[]> {
    let q = this.db.selectFrom('retailers').selectAll();
    if (opts.activeOnly) q = q.where('active', '=', true);
    const rows = await q.orderBy('name').orderBy('city').orderBy('id').execute();
    return rows.map(toRetailerRecord);
  }

  async get(id: string): Promise<RetailerRecord> {
    const r = await findRetailer(this.db, id);
    if (!r) throw retailerNotFound();
    return toRetailerRecord(r);
  }

  async create(input: CreateRetailerInput, actor: Actor): Promise<RetailerRecord> {
    const name = requiredText(input?.name, 'Name', RETAILER_NAME_MAX);
    const city = optionalText(input?.city, 'City', RETAILER_CITY_MAX);
    const country = cleanCountry(input?.country);
    const now = this.clock();
    try {
      return await inTransaction(this.db, async (tx) => {
        const row = await tx.insertInto('retailers').values({ name, city, country, created_at: now, updated_at: now }).returningAll().executeTakeFirstOrThrow();
        const rec = toRetailerRecord(row);
        await this.audit.record(
          { actor, action: 'retailer.create', targetType: 'retailer', targetId: rec.id, details: { name: rec.name, city: rec.city, country: rec.country } },
          tx,
        );
        return rec;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw retailerExists();
      throw e;
    }
  }

  /** Rename, move or (de)activate. Fields left out are kept; a change that changes nothing is not audited. */
  async update(id: string, input: UpdateRetailerInput, actor: Actor): Promise<RetailerRecord> {
    const patch: { name?: string; city?: string | null; country?: string | null; active?: boolean } = {};
    if (input?.name !== undefined) patch.name = requiredText(input.name, 'Name', RETAILER_NAME_MAX);
    if (input?.city !== undefined) patch.city = optionalText(input.city, 'City', RETAILER_CITY_MAX);
    if (input?.country !== undefined) patch.country = cleanCountry(input.country);
    if (input?.active !== undefined) {
      if (typeof input.active !== 'boolean') throw validationError('Active must be true or false.');
      patch.active = input.active;
    }
    if (Object.keys(patch).length === 0) throw validationError('Nothing to change.');
    try {
      return await inTransaction(this.db, async (tx) => {
        const before = await findRetailer(tx, id);
        if (!before) throw retailerNotFound();
        const was = toRetailerRecord(before);
        const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== was[k]);
        if (changed.length === 0) return was;
        const row = await tx
          .updateTable('retailers')
          .set({ ...patch, updated_at: this.clock() })
          .where('id', '=', before.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        const now = toRetailerRecord(row);
        await this.audit.record(
          {
            actor,
            action: 'retailer.update',
            targetType: 'retailer',
            targetId: now.id,
            details: {
              before: Object.fromEntries(changed.map((k) => [k, was[k]])),
              after: Object.fromEntries(changed.map((k) => [k, now[k]])),
            },
          },
          tx,
        );
        return now;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw retailerExists();
      throw e;
    }
  }
}

// ── Validation (the HTTP schemas check shapes; the service owns the rules) ──

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function requiredText(v: unknown, label: string, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > max || CONTROL.test(s)) throw validationError(`${label} must be 1–${max} characters.`);
  return s;
}

function optionalText(v: unknown, label: string, max: number): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string' || v.trim().length > max || CONTROL.test(v.trim())) throw validationError(`${label} must be at most ${max} characters.`);
  return v.trim();
}

function cleanCountry(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z]{2}$/.test(v.trim())) throw validationError('Country must be an ISO 3166-1 alpha-2 code.');
  return v.trim().toUpperCase();
}
