/**
 * Database connection factory: PostgreSQL (pg Pool) in production,
 * PGlite (Postgres compiled to WASM) for dev, tests and the demo.
 *
 * Both drivers are configured to return the SAME JavaScript types (see
 * schema.ts header): int8 → number, date → 'YYYY-MM-DD', bytea → plain
 * Uint8Array, timestamptz → Date. Without this, pg returns int8 as string,
 * bytea as Buffer and date as a local-time Date, and code that passes on
 * PGlite would break on PostgreSQL.
 *
 * PGlite has a single connection. Kysely serialises access to it, so inside
 * a transaction ALWAYS query through the transaction object — a query on
 * the outer `db` would wait for the transaction to finish and deadlock.
 */
import { Kysely, PGliteDialect, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { PGlite, PGliteOptions } from '@electric-sql/pglite';
import type { Database } from './schema.js';
import { isRetryableTxError } from './pg-errors.js';
import { parseDatabaseUrl } from './url.js';
import type { Logger } from '../types.js';

export type Db = Kysely<Database>;

export interface CreateDbOptions {
  /** Receives pg pool errors (idle client failures). Never gets query parameters. */
  log?: Logger;
  /** pg only: maximum pool size (default 10). */
  poolMax?: number;
  /** pg only: server-side statement timeout in ms (default 30 s; 0 disables). */
  statementTimeoutMs?: number;
}

// ── Type normalisation ─────────────────────────────────────────────────────

const OID = { BYTEA: 17, INT8: 20, DATE: 1082 } as const;

/** int8 → number; values beyond 2^53 come back as BigInt rather than being silently rounded. */
export function parseInt8(s: string): number | bigint {
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : BigInt(s);
}

const keepDateText = (s: string): string => s;

function pgTypeOverrides(): pg.CustomTypesConfig {
  const types = new pg.TypeOverrides();
  types.setTypeParser(OID.INT8, parseInt8);
  types.setTypeParser(OID.DATE, keepDateText);
  const parseBytea = pg.types.getTypeParser(OID.BYTEA, 'text') as (s: string) => Buffer;
  // Copy into a plain Uint8Array: Buffers can be views on a shared pool slab.
  types.setTypeParser(OID.BYTEA, (s: string) => new Uint8Array(parseBytea(s)));
  return types;
}

/** PGlite parsers matching the pg overrides above (PGlite already returns Uint8Array for bytea). */
export const PGLITE_PARSERS: NonNullable<PGliteOptions['parsers']> = Object.freeze({
  [OID.INT8]: parseInt8,
  [OID.DATE]: keepDateText,
});

// ── Factories ──────────────────────────────────────────────────────────────

/** The pg pool behind each PostgreSQL database made here: the server's status reads its counts (services/system-status.ts). */
const POOLS = new WeakMap<object, pg.Pool>();

/** The pg pool of a database made by createDb; null for PGlite (one connection, no pool) or a database made elsewhere. */
export function poolOf(db: Kysely<any>): pg.Pool | null {
  return POOLS.get(db) ?? null;
}

/**
 * Create a Kysely instance for `postgres://…`, `postgresql://…`,
 * `pglite:memory` or `pglite:/abs/dir`. Connections are opened lazily on
 * the first query. Call closeDb() on shutdown.
 */
export function createDb(url: string, opts: CreateDbOptions = {}): Db {
  const target = parseDatabaseUrl(url);

  if (target.kind === 'pglite') {
    const dataDir = target.dataDir;
    return new Kysely<Database>({
      dialect: new PGliteDialect({
        // Lazy import: production (pg) never loads the WASM engine.
        pglite: async () => {
          const { PGlite } = await import('@electric-sql/pglite');
          const options: PGliteOptions = { parsers: PGLITE_PARSERS };
          if (dataDir !== null) options.dataDir = dataDir;
          return new PGlite(options);
        },
      }),
    });
  }

  const pool = new pg.Pool({
    connectionString: target.url,
    max: opts.poolMax ?? 10,
    application_name: 'orbes-genome',
    statement_timeout: opts.statementTimeoutMs ?? 30_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    types: pgTypeOverrides(),
  });
  // An idle client error is emitted on the pool; unhandled it would crash the process.
  pool.on('error', (err) => {
    opts.log?.error({ err: { message: err.message, code: (err as { code?: string }).code } }, 'postgres pool error');
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  POOLS.set(db, pool);
  return db;
}

/** Wrap an existing PGlite instance (created with `parsers: PGLITE_PARSERS`). Used by the test helper. */
export function createDbFromPGlite(instance: PGlite): Db {
  return new Kysely<Database>({ dialect: new PGliteDialect({ pglite: instance }) });
}

/** Close the pool / PGlite instance. Safe to call more than once. */
export async function closeDb(db: Kysely<any>): Promise<void> {
  await db.destroy();
}

// ── Transactions & locks ───────────────────────────────────────────────────

/**
 * Run `fn` in a transaction, joining the caller's transaction when `db`
 * already is one (so services compose inside a larger unit of work).
 */
export async function inTransaction<T>(db: Db, fn: (trx: Db) => Promise<T>): Promise<T> {
  if (db.isTransaction) return fn(db);
  return db.transaction().execute((trx) => fn(trx));
}

/** How many times `inRetriedTransaction` runs its work at most. */
export const RETRIED_TRANSACTION_TRIES = 3;

/**
 * `inTransaction`, run again from the start (a fresh transaction) when the database aborted it for a deadlock (40P01)
 * or a serialization failure (40001), at most RETRIED_TRANSACTION_TRIES times. The paths that serve the orders waiting
 * for stock run in it (plan NEXT LOT §3.5.6.7: a cancellation and a size changed onto the same SKU can meet in reverse
 * order). Inside a caller's transaction it only joins it: the caller retries, never a part of it. `fn` must only write
 * to the database (it may run more than once).
 */
export async function inRetriedTransaction<T>(db: Db, fn: (trx: Db) => Promise<T>, tries = RETRIED_TRANSACTION_TRIES): Promise<T> {
  if (db.isTransaction) return fn(db);
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction().execute((trx) => fn(trx));
    } catch (e) {
      if (attempt >= tries || !isRetryableTxError(e)) throw e;
    }
  }
}

/**
 * Advisory lock keys, one namespace for the whole application so services
 * never collide. Add new keys here.
 */
export const ADVISORY_LOCK = Object.freeze({
  AUDIT_CHAIN: 0x4f52_0001,
  CATEGORY_ALLOCATION: 0x4f52_0002,
  SERIAL_ALLOCATION: 0x4f52_0003,
  KEY_ROTATION: 0x4f52_0004,
  /** AnomalyService.recordFinding for product-less findings (VALID_SIGNATURE_UNREGISTERED), which no unique index can deduplicate. */
  ANOMALY_UNREGISTERED: 0x4f52_0101,
  /** AuthService role changes and (de)activation of console users: the last active ADMIN check must see every concurrent change. */
  ADMIN_ROSTER: 0x4f52_0201,
  /** The engine of the LIVE RELEASES (services/live-engine.ts): a session lock, held by the one process that ticks. */
  LIVE_ENGINE: 0x4f52_0301,
  /** The numbers of the invoices and credit notes (services/invoices.ts), with the kind and the year as its second part. */
  INVOICE_NUMBER: 0x4f52_0401,
  /** The ids pasted back from Shopify (services/shopify.ts), with the product id's hash as its second part. */
  SHOPIFY_PRODUCT: 0x4f52_0501,
  /** A reception line's identities issued (services/receptions.ts issuePending), with the line id's first 32 bits as its second part. */
  RECEPTION_LINE: 0x4f52_0601,
  /** An account's saved addresses (services/addresses.ts): its limit and its one default, with the account id's first 32 bits as its second part. */
  ACCOUNT_ADDRESSES: 0x4f52_0701,
});

/**
 * Take a transaction-scoped advisory lock (released at COMMIT/ROLLBACK).
 * Must run inside a transaction: outside one it would be released immediately.
 */
export async function advisoryXactLock(trx: Db, key: number, subKey?: number): Promise<void> {
  if (!trx.isTransaction) throw new Error('advisoryXactLock must be called inside a transaction');
  const isInt4 = (n: number) => Number.isInteger(n) && n >= -0x8000_0000 && n <= 0x7fff_ffff;
  if (subKey === undefined) {
    if (!Number.isSafeInteger(key)) throw new RangeError('advisory lock key must be a safe integer');
    await sql`SELECT pg_advisory_xact_lock(${key}::bigint)`.execute(trx);
  } else {
    if (!isInt4(key) || !isInt4(subKey)) throw new RangeError('two-part advisory lock keys must be int4');
    await sql`SELECT pg_advisory_xact_lock(${key}::int, ${subKey}::int)`.execute(trx);
  }
}
