/**
 * AuditService — append-only, hash-chained audit log (contract §2.10).
 *
 *   hash = sha256(prev_hash ‖ utf8(canonicalJson(entry without hash)))
 *
 * where the entry is the row as stored, keyed by column name:
 *   { action, actor_id, actor_type, details, id, ip_hash, occurred_at, target_id, target_type }
 * (`occurred_at` as ISO-8601 UTC with milliseconds, absent values as null).
 * The genesis prev_hash is 32 zero bytes. Using column names lets an auditor
 * recompute the chain from a plain SQL export, without this code.
 *
 * Appends are serialised by a transaction-scoped advisory lock, so ids and
 * prev_hash links follow commit order even across server instances; a
 * UNIQUE index on prev_hash makes a forked chain impossible to insert.
 * UPDATE/DELETE/TRUNCATE are rejected by a database trigger.
 *
 * Limitation: the chain detects edits and deletions inside the log, not
 * removal of the newest entries. Anchor `head()` externally (e.g. in an
 * off-site log) to cover truncation of the tail.
 */
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { jsonText, toBytes, type AuditLogRow, type JsonObject, type JsonValue } from '../db/schema.js';
import { validationError } from '../errors.js';
import { ACTOR_TYPES, makePage, pageOffset, systemClock, type Actor, type ActorType, type Clock, type Page, type PageRequest } from '../types.js';
import { toHex } from '../../core/bytes.js';

export const AUDIT_GENESIS_HASH: Uint8Array = new Uint8Array(32);

export interface AuditRecordInput {
  actor: Actor;
  /** Dotted lowercase verb, e.g. 'category.create', 'key.rotate', 'product.transition'. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Free-form JSON object. Never put secrets, raw IPs or private keys here. */
  details?: Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  occurredAt: Date;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: JsonObject;
  ipHash: string | null;
  prevHash: string; // hex
  hash: string;     // hex
}

export interface AuditFilters {
  action?: string;
  actorType?: ActorType;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;  // inclusive
  to?: Date;    // exclusive
}

export interface ChainVerification {
  ok: boolean;
  /** Entries verified before the first failure (all entries when ok). */
  checked: number;
  /** First entry whose stored hash or link does not match. */
  firstBadId?: number;
}

const ACTION_RE = /^[A-Za-z][A-Za-z0-9_]*(?:[.:][A-Za-z0-9_-]+)*$/;
const MAX_ACTION = 200;
const MAX_FIELD = 500;

// ── Canonical JSON ─────────────────────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted by UTF-16 code units, no
 * whitespace, ECMAScript number formatting (same rules as RFC 8785 for the
 * values we store). Throws on values JSON cannot represent faithfully.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

/** Hash of one stored entry, given its predecessor's hash. */
export function computeAuditHash(
  prevHash: Uint8Array,
  e: {
    id: number;
    occurredAt: Date;
    actorType: string;
    actorId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    details: JsonValue;
    ipHash: string | null;
  },
): Uint8Array {
  const canonical = canonicalJson({
    action: e.action,
    actor_id: e.actorId,
    actor_type: e.actorType,
    details: e.details,
    id: e.id,
    ip_hash: e.ipHash,
    occurred_at: e.occurredAt.toISOString(),
    target_id: e.targetId,
    target_type: e.targetType,
  });
  return new Uint8Array(createHash('sha256').update(prevHash).update(canonical, 'utf8').digest());
}

// ── Input normalisation ────────────────────────────────────────────────────

// Postgres text/jsonb cannot store NUL or unpaired surrogates. Replace them so
// the value we hash is exactly the value that round-trips through the database.
const UNSAFE_CHARS = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const sanitize = (s: string): string => s.replace(UNSAFE_CHARS, '�');

function normaliseJson(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 32) throw validationError('Audit details are nested too deeply.');
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw validationError('Audit details contain an invalid date.');
    return value.toISOString();
  }
  if (value instanceof Uint8Array) return toHex(value);
  switch (typeof value) {
    case 'string':
      return sanitize(value);
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw validationError('Audit details contain a non-finite number.');
      return Object.is(value, -0) ? 0 : value;
    case 'bigint':
      // Exact decimal text; a number could silently lose precision.
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    case 'object': {
      if (Array.isArray(value)) return value.map((v) => normaliseJson(v, depth + 1) ?? null);
      const out: JsonObject = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const n = normaliseJson(v, depth + 1);
        if (n !== undefined) out[sanitize(k)] = n;
      }
      return out;
    }
    default:
      return undefined;
  }
}

function optionalText(v: string | null | undefined, field: string, max = MAX_FIELD): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw validationError(`Audit ${field} must be a string.`);
  const s = sanitize(v);
  if (s.length > max) throw validationError(`Audit ${field} is too long.`);
  return s;
}

// ── Service ────────────────────────────────────────────────────────────────

export class AuditService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: { db: Db; clock?: Clock }) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Append one entry. Pass the caller's transaction as `trx` so the audit
   * entry commits (or rolls back) with the change it describes. Note: the
   * chain lock is then held until that transaction ends.
   */
  async record(entry: AuditRecordInput, trx?: Db): Promise<AuditEntry> {
    const actor = entry.actor;
    if (!actor || !ACTOR_TYPES.includes(actor.type)) throw validationError('Audit actor is invalid.');
    if (typeof entry.action !== 'string' || entry.action.length > MAX_ACTION || !ACTION_RE.test(entry.action)) {
      throw validationError('Audit action is invalid.');
    }
    if (entry.details !== undefined && (entry.details === null || typeof entry.details !== 'object' || Array.isArray(entry.details))) {
      throw validationError('Audit details must be an object.');
    }
    const details = (normaliseJson(entry.details ?? {}) ?? {}) as JsonObject;
    const row = {
      actorType: actor.type,
      actorId: optionalText(actor.id, 'actor id'),
      action: entry.action,
      targetType: optionalText(entry.targetType, 'target type', MAX_ACTION),
      targetId: optionalText(entry.targetId, 'target id'),
      details,
      ipHash: optionalText(actor.ipHash, 'ip hash'),
    };
    const detailsText = jsonText(details);

    return inTransaction(trx ?? this.db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.AUDIT_CHAIN);
      const last = await tx.selectFrom('audit_logs').select('hash').orderBy('id', 'desc').limit(1).executeTakeFirst();
      const prevHash = last ? toBytes(last.hash) : AUDIT_GENESIS_HASH;
      // Allocate the id under the lock: it is part of the hashed entry, and ids then follow chain order.
      const seq = await sql<{ id: number }>`SELECT nextval(pg_get_serial_sequence('audit_logs', 'id')) AS id`.execute(tx);
      const id = Number(seq.rows[0].id);
      const occurredAt = new Date(this.clock().getTime());
      const hash = computeAuditHash(prevHash, { id, occurredAt, ...row });

      await tx
        .insertInto('audit_logs')
        .values({
          id,
          occurred_at: occurredAt,
          actor_type: row.actorType,
          actor_id: row.actorId,
          action: row.action,
          target_type: row.targetType,
          target_id: row.targetId,
          details: detailsText,
          ip_hash: row.ipHash,
          prev_hash: prevHash,
          hash,
        })
        .execute();

      return { id, occurredAt, ...row, prevHash: toHex(prevHash), hash: toHex(hash) };
    });
  }

  /**
   * Recompute every hash and link, oldest first, in batches. Reports the
   * first entry that does not match (edited, inserted out of chain, or
   * following a deleted entry).
   */
  async verifyChain(opts: { batchSize?: number } = {}): Promise<ChainVerification> {
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 1000, 10_000));
    let prev = AUDIT_GENESIS_HASH;
    let checked = 0;
    let afterId = 0;
    for (;;) {
      const rows = await this.db
        .selectFrom('audit_logs')
        .selectAll()
        .where('id', '>', afterId)
        .orderBy('id', 'asc')
        .limit(batchSize)
        .execute();
      for (const r of rows) {
        const storedPrev = toBytes(r.prev_hash);
        if (!bytesEqual(storedPrev, prev)) return { ok: false, checked, firstBadId: Number(r.id) };
        const expected = computeAuditHash(prev, fromRow(r));
        const stored = toBytes(r.hash);
        if (!bytesEqual(expected, stored)) return { ok: false, checked, firstBadId: Number(r.id) };
        prev = stored;
        checked++;
      }
      if (rows.length < batchSize) return { ok: true, checked };
      afterId = Number(rows[rows.length - 1].id);
    }
  }

  /** The newest entry's id and hash, for anchoring the chain outside the database. */
  async head(): Promise<{ id: number; hash: string } | null> {
    const r = await this.db.selectFrom('audit_logs').select(['id', 'hash']).orderBy('id', 'desc').limit(1).executeTakeFirst();
    return r ? { id: Number(r.id), hash: toHex(toBytes(r.hash)) } : null;
  }

  /** Newest first. */
  async list(filters: AuditFilters = {}, page: PageRequest = { page: 1, pageSize: 50 }): Promise<Page<AuditEntry>> {
    let q = this.db.selectFrom('audit_logs');
    if (filters.action !== undefined) q = q.where('action', '=', filters.action);
    if (filters.actorType !== undefined) q = q.where('actor_type', '=', filters.actorType);
    if (filters.actorId !== undefined) q = q.where('actor_id', '=', filters.actorId);
    if (filters.targetType !== undefined) q = q.where('target_type', '=', filters.targetType);
    if (filters.targetId !== undefined) q = q.where('target_id', '=', filters.targetId);
    if (filters.from !== undefined) q = q.where('occurred_at', '>=', filters.from);
    if (filters.to !== undefined) q = q.where('occurred_at', '<', filters.to);

    const [rows, count] = await Promise.all([
      q.selectAll().orderBy('id', 'desc').limit(page.pageSize).offset(pageOffset(page)).execute(),
      q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return makePage(
      rows.map((r) => {
        const e = fromRow(r);
        return { ...e, prevHash: toHex(toBytes(r.prev_hash)), hash: toHex(toBytes(r.hash)) };
      }),
      Number(count.n),
      page,
    );
  }
}

function fromRow(r: AuditLogRow): Omit<AuditEntry, 'prevHash' | 'hash'> {
  return {
    id: Number(r.id),
    occurredAt: r.occurred_at,
    actorType: r.actor_type,
    actorId: r.actor_id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    ipHash: r.ip_hash,
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
