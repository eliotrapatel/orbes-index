/**
 * Recognise PostgreSQL errors by SQLSTATE, identically for pg and PGlite
 * (both surface the server's `code`, `constraint` and `table` fields).
 */

export const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  /** Raised for ON DELETE RESTRICT foreign keys. */
  RESTRICT_VIOLATION: '23001',
  /** Custom: raised by the schema's guard triggers (append-only audit log, immutable columns). */
  GUARD_VIOLATION: 'OR001',
  /** Custom: a refusal of the test purge's database functions (migration 0066); the reason is the message. */
  PURGE_REFUSED: 'OR010',
  /** Custom: a refusal of the platform reset's database functions (migration 0067); the reason is the message. */
  RESET_REFUSED: 'OR011',
  /** Custom: a proof of the platform reset failed before COMMIT (migration 0067); every failed check is in the detail. */
  RESET_PROOF_FAILED: 'OR020',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  RAISE_EXCEPTION: 'P0001',
});

export interface PgErrorInfo {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
}

/** Extract the SQLSTATE info from an error thrown by either driver, or undefined. */
export function pgError(e: unknown): PgErrorInfo | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.code !== 'string' || !/^[0-9A-Z]{5}$/.test(o.code)) return undefined;
  const info: PgErrorInfo = { code: o.code };
  if (typeof o.constraint === 'string') info.constraint = o.constraint;
  if (typeof o.table === 'string') info.table = o.table;
  if (typeof o.column === 'string') info.column = o.column;
  return info;
}

function is(code: string, e: unknown, constraint?: string): boolean {
  const info = pgError(e);
  return !!info && info.code === code && (constraint === undefined || info.constraint === constraint);
}

export const isUniqueViolation = (e: unknown, constraint?: string): boolean => is(PG_ERROR.UNIQUE_VIOLATION, e, constraint);
/** Missing referenced row (23503) or delete of a still-referenced row under ON DELETE RESTRICT (23001). */
export const isForeignKeyViolation = (e: unknown, constraint?: string): boolean =>
  is(PG_ERROR.FOREIGN_KEY_VIOLATION, e, constraint) || is(PG_ERROR.RESTRICT_VIOLATION, e, constraint);
export const isCheckViolation = (e: unknown, constraint?: string): boolean => is(PG_ERROR.CHECK_VIOLATION, e, constraint);
export const isGuardViolation = (e: unknown): boolean => is(PG_ERROR.GUARD_VIOLATION, e);
export const isRetryableTxError = (e: unknown): boolean =>
  is(PG_ERROR.SERIALIZATION_FAILURE, e) || is(PG_ERROR.DEADLOCK_DETECTED, e);

/**
 * The reason a test purge function refused (SQLSTATE OR010, migration 0066: `PURGE_WINDOW`, `PURGE_NOT_TEST`, …), or
 * undefined for any other error.
 */
export function purgeRefusal(e: unknown): string | undefined {
  if (pgError(e)?.code !== PG_ERROR.PURGE_REFUSED) return undefined;
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

/**
 * The reason a platform reset function refused (SQLSTATE OR011, migration 0067: `RESET_NO_HOLDER`, `RESET_WINDOW`, …) or
 * `RESET_PROOF_FAILED` when one of its proofs failed (OR020, every failed check in the error's detail), or undefined
 * for any other error.
 */
export function resetRefusal(e: unknown): string | undefined {
  const code = pgError(e)?.code;
  if (code !== PG_ERROR.RESET_REFUSED && code !== PG_ERROR.RESET_PROOF_FAILED) return undefined;
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}
