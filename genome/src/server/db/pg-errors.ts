/**
 * Recognise PostgreSQL errors by SQLSTATE, identically for pg and PGlite
 * (both surface the server's `code`, `constraint` and `table` fields).
 */

export const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  /** Raised by the schema's guard triggers (append-only audit log, immutable columns). */
  RESTRICT_VIOLATION: '23001',
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
export const isForeignKeyViolation = (e: unknown, constraint?: string): boolean => is(PG_ERROR.FOREIGN_KEY_VIOLATION, e, constraint);
export const isCheckViolation = (e: unknown, constraint?: string): boolean => is(PG_ERROR.CHECK_VIOLATION, e, constraint);
export const isGuardViolation = (e: unknown): boolean => is(PG_ERROR.RESTRICT_VIOLATION, e);
export const isRetryableTxError = (e: unknown): boolean =>
  is(PG_ERROR.SERIALIZATION_FAILURE, e) || is(PG_ERROR.DEADLOCK_DETECTED, e);
