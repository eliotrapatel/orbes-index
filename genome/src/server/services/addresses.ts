/**
 * YOUR ADDRESSES (plan NEXT LOT of 2026-10-07, §3.6.B; migration 0039; API §10.21, DATABASE §5.88): the delivery
 * addresses a collector keeps in its account, « one or more, one by default, picked on each order, still changeable on
 * the order until packing ». Each is a name, the address lines as typed, a country (ISO 3166-1 alpha-2,
 * src/shared/countries.ts) and a phone with its country code; at most ADDRESS_LIMITS.saved (5).
 *
 *   list        GET /api/v1/account/addresses: the account's addresses, the oldest first, and its registration country
 *               (`defaultCountry`, `accounts.country`), which preselects COUNTRY in a new address.
 *   create      the first address is the default; `isDefault` makes a new one the default; 409 ADDRESS_LIMIT at five.
 *   update      its four fields, whole.
 *   remove      a deleted row (the collector's own data, as YOUR SIZES); the default removed, the oldest left becomes the
 *               default. An order keeps its own copy: removing an address never changes an order.
 *   makeDefault one default per account (`account_addresses_one_default`).
 *   setDefaultByStaff  Client Services' Edit the address on the client sheet (plan CUSTOMER INTELLIGENCE §3.1 P.6.6):
 *               the default address changed in place, or created as the default when there is none; a LOCKED account
 *               included, a DELETED one refused (409 ACCOUNT_DELETED). The other saved addresses are never touched.
 *
 * Each write takes the account FOR SHARE (403 ACCOUNT_LOCKED for a locked account) and then the account's addresses
 * lock (ADVISORY_LOCK.ACCOUNT_ADDRESSES), so two writes at once keep the limit and the one default. Audited
 * `account.address.create`, `.update`, `.remove`, `.default` with the address's id and country only, never its words
 * (`by: 'staff'` added when Client Services wrote it).
 * The order's own address is OrderService.setAddress's (services/orders.ts), which may save a new address here too.
 */
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import type { AccountAddressRow } from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { isCountryCode, PHONE_RE } from '../../shared/countries.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditRecordInput, AuditService } from './audit.js';
import { customerAccountLocked } from './auth.js';
import { accountDeleted } from './profiles.js';

/** The bounds of a saved address (migration 0039's CHECKs) and how many an account keeps. */
export const ADDRESS_LIMITS = Object.freeze({ saved: 5, name: 200, address: 1000 });

/** A delivery address: a name, the lines as typed, a country (ISO 3166-1 alpha-2) and a phone with its country code. */
export interface DeliveryAddress {
  name: string;
  address: string;
  country: string;
  phone: string;
}

/** A saved address as the collector reads it. */
export interface SavedAddress extends DeliveryAddress {
  id: string;
  isDefault: boolean;
}

/** YOUR ADDRESSES (GET /api/v1/account/addresses): the addresses, the oldest first, and the registration country. */
export interface AccountAddresses {
  addresses: SavedAddress[];
  /** The account's registration country (`accounts.country`), which preselects COUNTRY; null without one. */
  defaultCountry: string | null;
}

/** A saved address as the right of access exports it. */
export interface ExportedAddress extends SavedAddress {
  createdAt: Date;
  updatedAt: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

// ── Errors ─────────────────────────────────────────────────────────────────

export const addressNotFound = () => notFound('Address', 'ADDRESS_NOT_FOUND');
export const addressLimit = () => conflict('ADDRESS_LIMIT', `You may keep up to ${ADDRESS_LIMITS.saved} addresses.`);
const nameAndAddress = () => validationError('Enter the name and the address.');
const chooseCountry = () => validationError('Choose a country.');
const phoneWithCode = () => validationError('Enter a phone number with its country code.');

// ── Checks ─────────────────────────────────────────────────────────────────

/** One field's text: trimmed, line breaks as \n where allowed, bounded; null when empty. */
function clean(v: unknown, max: number, multiline: boolean): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw nameAndAddress();
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s === '') return null;
  if (CONTROL_CHARS.test(s) || (!multiline && s.includes('\n'))) throw validationError('The address contains invalid characters.');
  if (s.length > max) throw validationError(multiline ? `The address must be at most ${max} characters.` : `The name must be at most ${max} characters.`);
  return s;
}

/** A country as stored: one of COUNTRY_CODES (400 'Choose a country.'). */
export function checkCountry(v: unknown): string {
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!isCountryCode(c)) throw chooseCountry();
  return c;
}

/** A phone as stored: trimmed, with its country code (400 'Enter a phone number with its country code.'). */
export function checkPhone(v: unknown): string {
  const p = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!PHONE_RE.test(p)) throw phoneWithCode();
  return p;
}

/**
 * A delivery address as the collector gives it, all four fields required (the name and the address: 400 'Enter the
 * name and the address.'; the country and the phone, as `checkCountry` and `checkPhone`).
 */
export function checkAddress(input: unknown): DeliveryAddress {
  if (!input || typeof input !== 'object') throw nameAndAddress();
  const x = input as Record<string, unknown>;
  const name = clean(x.name, ADDRESS_LIMITS.name, false);
  const address = clean(x.address, ADDRESS_LIMITS.address, true);
  if (name === null || address === null) throw nameAndAddress();
  return { name, address, country: checkCountry(x.country), phone: checkPhone(x.phone) };
}

function knownAccount(accountId: unknown): string {
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  return accountId.toLowerCase();
}

function knownAddress(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw addressNotFound();
  return id.toLowerCase();
}

const savedOf = (r: AccountAddressRow): SavedAddress => ({ id: r.id, name: r.name, address: r.address, country: r.country, phone: r.phone, isDefault: r.is_default });

/** The account's addresses lock, in the caller's transaction (after the account's row). */
async function lockAddresses(tx: Db, accountId: string): Promise<void> {
  await advisoryXactLock(tx, ADVISORY_LOCK.ACCOUNT_ADDRESSES, Number.parseInt(accountId.replace(/-/g, '').slice(0, 8), 16) | 0);
}

/** The account FOR SHARE, ACTIVE (403 ACCOUNT_LOCKED otherwise), then its addresses' lock. */
export async function lockAccountAddresses(tx: Db, accountId: string): Promise<void> {
  const a = await tx.selectFrom('accounts').select('status').where('id', '=', accountId).forShare().executeTakeFirst();
  if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
  if (a.status !== 'ACTIVE') throw customerAccountLocked();
  await lockAddresses(tx, accountId);
}

/**
 * Save a new address for the account, in the caller's transaction, under `lockAccountAddresses`: 409 ADDRESS_LIMIT at
 * five; the first one, or one asked as the default, is the default. Returns the row and its audit entry.
 */
export async function insertAddress(tx: Db, accountId: string, a: DeliveryAddress, isDefault: boolean, actor: Actor, now: Date): Promise<{ row: AccountAddressRow; note: AuditRecordInput }> {
  const existing = await tx.selectFrom('account_addresses').select(['id', 'is_default']).where('account_id', '=', accountId).execute();
  if (existing.length >= ADDRESS_LIMITS.saved) throw addressLimit();
  const makeDefault = isDefault || existing.length === 0;
  if (makeDefault) await tx.updateTable('account_addresses').set({ is_default: false, updated_at: now }).where('account_id', '=', accountId).where('is_default', '=', true).execute();
  const row = await tx
    .insertInto('account_addresses')
    .values({ account_id: accountId, name: a.name, address: a.address, country: a.country, phone: a.phone, is_default: makeDefault, created_at: now, updated_at: now })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { row, note: { actor, action: 'account.address.create', targetType: 'account', targetId: accountId, details: { addressId: row.id, country: row.country, isDefault: makeDefault } } };
}

/** The account's default address, or none (the order's creation copies it: services/orders.ts createOrder). */
export async function defaultAddress(db: Db, accountId: string): Promise<DeliveryAddress | null> {
  const r = await db.selectFrom('account_addresses').select(['name', 'address', 'country', 'phone']).where('account_id', '=', accountId).where('is_default', '=', true).executeTakeFirst();
  return r ?? null;
}

/** The account's saved addresses as the right of access exports them, the oldest first. */
export async function exportedAddresses(db: Db, accountId: string): Promise<ExportedAddress[]> {
  const rows = await db.selectFrom('account_addresses').selectAll().where('account_id', '=', accountId).orderBy('created_at').orderBy('id').execute();
  return rows.map((r) => ({ ...savedOf(r), createdAt: r.created_at, updatedAt: r.updated_at }));
}

// ── Service ────────────────────────────────────────────────────────────────

export interface AddressServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class AddressService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: AddressServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** YOUR ADDRESSES: the account's addresses, the oldest first, and its registration country. */
  async list(accountId: string, db: Db = this.db): Promise<AccountAddresses> {
    const id = knownAccount(accountId);
    const a = await db.selectFrom('accounts').select('country').where('id', '=', id).executeTakeFirst();
    if (!a) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
    const rows = await db.selectFrom('account_addresses').selectAll().where('account_id', '=', id).orderBy('created_at').orderBy('id').execute();
    const country = a.country?.trim() ?? null;
    return { addresses: rows.map(savedOf), defaultCountry: country && isCountryCode(country) ? country : null };
  }

  /** ADD AN ADDRESS: see the header. Audited `account.address.create`. */
  async create(accountId: string, input: unknown, actor: Actor): Promise<AccountAddresses> {
    const id = knownAccount(accountId);
    const a = checkAddress(input);
    const isDefault = (input as { isDefault?: unknown })?.isDefault === true;
    await inTransaction(this.db, async (tx) => {
      await lockAccountAddresses(tx, id);
      const { note } = await insertAddress(tx, id, a, isDefault, actor, this.clock());
      await this.audit.record(note, tx);
    });
    return this.list(id);
  }

  /** EDIT: an address's four fields, whole (404 ADDRESS_NOT_FOUND for another account's). Audited `account.address.update`. */
  async update(accountId: string, addressId: string, input: unknown, actor: Actor): Promise<AccountAddresses> {
    const id = knownAccount(accountId);
    const addr = knownAddress(addressId);
    const a = checkAddress(input);
    await inTransaction(this.db, async (tx) => {
      await lockAccountAddresses(tx, id);
      const row = await tx.selectFrom('account_addresses').selectAll().where('id', '=', addr).where('account_id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw addressNotFound();
      const fields = (['name', 'address', 'country', 'phone'] as const).filter((k) => row[k] !== a[k]);
      if (fields.length === 0) return;
      await tx.updateTable('account_addresses').set({ ...a, updated_at: this.clock() }).where('id', '=', addr).execute();
      await this.audit.record({ actor, action: 'account.address.update', targetType: 'account', targetId: id, details: { addressId: addr, country: a.country, fields } }, tx);
    });
    return this.list(id);
  }

  /** REMOVE: the address deleted; the default removed, the oldest left becomes the default. Audited `account.address.remove`. */
  async remove(accountId: string, addressId: string, actor: Actor): Promise<void> {
    const id = knownAccount(accountId);
    const addr = knownAddress(addressId);
    await inTransaction(this.db, async (tx) => {
      await lockAccountAddresses(tx, id);
      const row = await tx.selectFrom('account_addresses').selectAll().where('id', '=', addr).where('account_id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw addressNotFound();
      await tx.deleteFrom('account_addresses').where('id', '=', addr).execute();
      let nextDefault: string | null = null;
      if (row.is_default) {
        const oldest = await tx.selectFrom('account_addresses').select('id').where('account_id', '=', id).orderBy('created_at').orderBy('id').limit(1).executeTakeFirst();
        if (oldest) {
          await tx.updateTable('account_addresses').set({ is_default: true, updated_at: this.clock() }).where('id', '=', oldest.id).execute();
          nextDefault = oldest.id;
        }
      }
      await this.audit.record(
        { actor, action: 'account.address.remove', targetType: 'account', targetId: id, details: { addressId: addr, country: row.country, ...(row.is_default ? { defaultNow: nextDefault } : {}) } },
        tx,
      );
    });
  }

  /**
   * Client Services' Edit the address (PUT /api/admin/owners/:id/default-address, OPERATOR): the account's default
   * address takes the four fields in place, or, without one, a new address is saved as the default (409 ADDRESS_LIMIT
   * stays as a guard at five). The account FOR SHARE whatever its status but DELETED (409 ACCOUNT_DELETED), then its
   * addresses' lock. Audited `account.address.update` / `.create` as the collector's, with `by: 'staff'`; the same
   * fields again change nothing.
   */
  async setDefaultByStaff(accountId: string, input: unknown, actor: Actor): Promise<AccountAddresses> {
    const id = knownAccount(accountId);
    const a = checkAddress(input);
    await inTransaction(this.db, async (tx) => {
      const account = await tx.selectFrom('accounts').select('status').where('id', '=', id).forShare().executeTakeFirst();
      if (!account) throw notFound('Account', 'ACCOUNT_NOT_FOUND');
      if (account.status === 'DELETED') throw accountDeleted();
      await lockAddresses(tx, id);
      const row = await tx.selectFrom('account_addresses').selectAll().where('account_id', '=', id).where('is_default', '=', true).forUpdate().executeTakeFirst();
      if (!row) {
        const { note } = await insertAddress(tx, id, a, true, actor, this.clock());
        await this.audit.record({ ...note, details: { ...note.details, by: 'staff' } }, tx);
        return;
      }
      const fields = (['name', 'address', 'country', 'phone'] as const).filter((k) => row[k] !== a[k]);
      if (fields.length === 0) return;
      await tx.updateTable('account_addresses').set({ ...a, updated_at: this.clock() }).where('id', '=', row.id).execute();
      await this.audit.record({ actor, action: 'account.address.update', targetType: 'account', targetId: id, details: { addressId: row.id, country: a.country, fields, by: 'staff' } }, tx);
    });
    return this.list(id);
  }

  /** MAKE DEFAULT: one default per account. Audited `account.address.default`; already the default, nothing changes. */
  async makeDefault(accountId: string, addressId: string, actor: Actor): Promise<void> {
    const id = knownAccount(accountId);
    const addr = knownAddress(addressId);
    await inTransaction(this.db, async (tx) => {
      await lockAccountAddresses(tx, id);
      const row = await tx.selectFrom('account_addresses').selectAll().where('id', '=', addr).where('account_id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw addressNotFound();
      if (row.is_default) return;
      const now = this.clock();
      await tx.updateTable('account_addresses').set({ is_default: false, updated_at: now }).where('account_id', '=', id).where('is_default', '=', true).execute();
      await tx.updateTable('account_addresses').set({ is_default: true, updated_at: now }).where('id', '=', addr).execute();
      await this.audit.record({ actor, action: 'account.address.default', targetType: 'account', targetId: id, details: { addressId: addr, country: row.country } }, tx);
    });
  }
}
