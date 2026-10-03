/**
 * Scan tokens: short-lived, single-use proofs that a client has just scanned
 * a genuine code (contract §2.4 step 10, §2.7).
 *
 * The verification service mints one with an AUTHENTIC_FIRST_REGISTRATION
 * result; OwnershipService.registerFirst consumes it. This ties a first
 * registration to a fresh, successful scan of THAT product instead of just
 * knowing its product id. The same holds for the other purposes: a sale
 * lookup's SALE_ACTIVATION token (SaleService, A-08) and the TRANSFER_ACCEPT
 * token of a signed-in reader's scan of a piece whose transfer is pending
 * (OwnershipService.acceptTransfer, F-03). A token of one purpose is refused
 * for another.
 *
 * - Token: 32 random bytes, base64url (43 chars), handed to the client once.
 * - Stored: sha256(token bytes) only, so a database reader cannot use them.
 * - Lifetime: 15 minutes by default; `used_at` makes them single-use, set by
 *   one conditional UPDATE so two concurrent consumers can never both win.
 */
import { createHash, randomBytes } from 'node:crypto';
import { fromBase64Url, toBase64Url } from '../../core/bytes.js';
import type { Db } from '../db/connection.js';
import { SCAN_TOKEN_PURPOSES, type ScanTokenPurpose } from '../db/schema.js';
import { systemClock } from '../types.js';

export const SCAN_TOKEN_BYTES = 32;
export const SCAN_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Lifetime of a TRANSFER_ACCEPT token (F-03): the time between the recipient's scan and the transfer code they enter. */
export const TRANSFER_TOKEN_TTL_MS = SCAN_TOKEN_TTL_MS;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateScanTokenInput {
  /** products.id (uuid) the token is bound to. */
  productId: string;
  /** scan_events.id of the scan that earned the token. */
  scanEventId: string;
  purpose?: ScanTokenPurpose;
  /** Issue time (inject the service clock). */
  now?: Date;
  ttlMs?: number;
}

export interface CreatedScanToken {
  token: string;
  expiresAt: Date;
}

export type ScanTokenFailure = 'MALFORMED' | 'NOT_FOUND' | 'USED' | 'EXPIRED' | 'WRONG_PURPOSE' | 'WRONG_PRODUCT';

export type ScanTokenResult =
  | { ok: true; productId: string; scanEventId: string; expiresAt: Date }
  | { ok: false; reason: ScanTokenFailure };

export interface ScanTokenCheckOptions {
  purpose?: ScanTokenPurpose;
  now?: Date;
  /** When set, the token must be bound to this products.id. */
  productId?: string;
}

/** sha256 of the token bytes, or undefined when `token` is not well-formed. */
export function hashScanToken(token: unknown): Uint8Array | undefined {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return undefined;
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(token);
  } catch {
    return undefined;
  }
  if (raw.length !== SCAN_TOKEN_BYTES) return undefined;
  return new Uint8Array(createHash('sha256').update(raw).digest());
}

/** Mint a token for a product. Pass the verification transaction as `db` to commit it with the scan event. */
export async function createScanToken(db: Db, input: CreateScanTokenInput): Promise<CreatedScanToken> {
  if (!UUID_RE.test(input.productId)) throw new TypeError('createScanToken: productId must be a products.id uuid');
  if (!UUID_RE.test(input.scanEventId)) throw new TypeError('createScanToken: scanEventId must be a scan_events.id uuid');
  const purpose = input.purpose ?? 'FIRST_REGISTRATION';
  if (!SCAN_TOKEN_PURPOSES.includes(purpose)) throw new TypeError('createScanToken: unknown purpose');
  const ttlMs = input.ttlMs ?? SCAN_TOKEN_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_TTL_MS) throw new RangeError('createScanToken: ttlMs out of range');

  const now = input.now ?? systemClock();
  const token = toBase64Url(randomBytes(SCAN_TOKEN_BYTES));
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db
    .insertInto('scan_tokens')
    .values({
      id_hash: hashScanToken(token)!,
      product_id: input.productId,
      scan_event_id: input.scanEventId,
      purpose,
      expires_at: expiresAt,
      created_at: now,
    })
    .execute();
  return { token, expiresAt };
}

/**
 * Check a token without using it up (e.g. to look up its product before an
 * expensive claim-code check). Never a substitute for `consumeScanToken`.
 */
export async function inspectScanToken(db: Db, token: unknown, opts: ScanTokenCheckOptions = {}): Promise<ScanTokenResult> {
  const idHash = hashScanToken(token);
  if (!idHash) return { ok: false, reason: 'MALFORMED' };
  const row = await db.selectFrom('scan_tokens').selectAll().where('id_hash', '=', idHash).executeTakeFirst();
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  const now = opts.now ?? systemClock();
  if (row.purpose !== (opts.purpose ?? 'FIRST_REGISTRATION')) return { ok: false, reason: 'WRONG_PURPOSE' };
  if (opts.productId !== undefined && row.product_id !== opts.productId) return { ok: false, reason: 'WRONG_PRODUCT' };
  if (row.used_at !== null) return { ok: false, reason: 'USED' };
  if (row.expires_at.getTime() <= now.getTime()) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, productId: row.product_id, scanEventId: row.scan_event_id, expiresAt: row.expires_at };
}

/**
 * Atomically use up a token. Exactly one concurrent caller can succeed; the
 * others get USED. Run it inside the transaction of the action the token
 * authorises, so a failed action leaves the token usable.
 */
export async function consumeScanToken(db: Db, token: unknown, opts: ScanTokenCheckOptions = {}): Promise<ScanTokenResult> {
  const idHash = hashScanToken(token);
  if (!idHash) return { ok: false, reason: 'MALFORMED' };
  const now = opts.now ?? systemClock();
  let q = db
    .updateTable('scan_tokens')
    .set({ used_at: now })
    .where('id_hash', '=', idHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .where('purpose', '=', opts.purpose ?? 'FIRST_REGISTRATION');
  if (opts.productId !== undefined) q = q.where('product_id', '=', opts.productId);
  const row = await q.returning(['product_id', 'scan_event_id', 'expires_at']).executeTakeFirst();
  if (row) return { ok: true, productId: row.product_id, scanEventId: row.scan_event_id, expiresAt: row.expires_at };
  // Nothing consumed: classify why (same rules as inspect, so the answer is consistent).
  const why = await inspectScanToken(db, token, opts);
  return why.ok ? { ok: false, reason: 'USED' } : why;
}

/** Housekeeping: delete tokens that expired before `before`. */
export async function purgeScanTokens(db: Db, before: Date): Promise<number> {
  const r = await db.deleteFrom('scan_tokens').where('expires_at', '<', before).executeTakeFirst();
  return Number(r.numDeletedRows);
}
