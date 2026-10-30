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
 * UPDATE/DELETE/TRUNCATE are rejected by a database trigger (the test purge
 * alone deletes a test's own rows, leaving a tombstone for each: below).
 *
 * Limitation: the chain detects edits and deletions inside the log, not
 * removal of the newest entries. Anchor `head()` externally (e.g. in an
 * off-site log) to cover truncation of the tail.
 *
 * Tombstones (migration 0066, the test purge): when the purge deletes a test's
 * audit rows it writes, in the same statement, each one's id, prev_hash and
 * hash into `audit_purge_gaps`. The chain is then both tables merged in id
 * order. A live row is re-hashed as above; a tombstone cannot be (its content
 * is gone), but its prev_hash must equal the running hash and its stored hash
 * becomes the running hash, which the next entry must link to. An auditor's
 * plain export is therefore `audit_logs` plus `audit_purge_gaps` (id, prev_hash,
 * hash), walked in id order with that one rule for tombstones. The chain is
 * broken by a missing id with no tombstone (the next entry does not link), by
 * an id present in both tables, and by a tombstone nothing links to after it
 * (the newest entry deleted: the purge never deletes the chain's tail). With
 * no tombstone the walk and its verdict are exactly those of the log alone.
 */
import { createHash } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
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
  /**
   * Tombstones stepped over (entries the test purge deleted, each one's link checked), up to the verdict. Present
   * only when there is at least one, so a chain without tombstones answers exactly as it always has.
   */
  purged?: number;
}

/** One entry of the chain as `verifyChain` reads it: a live row of `audit_logs` or a tombstone of `audit_purge_gaps`. */
type ChainItem =
  | (AuditLogRow & { gap: false; shadowed: boolean })
  | { gap: true; shadowed: boolean; id: number | string; prev_hash: Uint8Array; hash: Uint8Array };

const ACTION_RE = /^[A-Za-z][A-Za-z0-9_]*(?:[.:][A-Za-z0-9_-]+)*$/;
const MAX_ACTION = 200;
const MAX_FIELD = 500;
// Audit details describe a change; they are not a document store. API bodies are capped at 16 KB.
const MAX_DETAILS_BYTES = 64 * 1024;

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

/** An entry checked and normalised, as it is hashed and stored (its id, time and links aside). */
function prepareEntry(entry: AuditRecordInput) {
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
  if (Buffer.byteLength(detailsText, 'utf8') > MAX_DETAILS_BYTES) throw validationError('Audit details are too large.');
  return { row, detailsText };
}

type PreparedRow = ReturnType<typeof prepareEntry>['row'];

/** The `audit_logs` row of a prepared entry. */
function auditRow(id: number, occurredAt: Date, row: PreparedRow, detailsText: string, prevHash: Uint8Array, hash: Uint8Array) {
  return {
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
  };
}

/** The rows `recordAll` inserts per statement (11 parameters each, far under PostgreSQL's 65 535). */
const AUDIT_BATCH_ROWS = 500;

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
    const { row, detailsText } = prepareEntry(entry);

    return inTransaction(trx ?? this.db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.AUDIT_CHAIN);
      const last = await tx.selectFrom('audit_logs').select('hash').orderBy('id', 'desc').limit(1).executeTakeFirst();
      const prevHash = last ? toBytes(last.hash) : AUDIT_GENESIS_HASH;
      // Allocate the id under the lock: it is part of the hashed entry, and ids then follow chain order.
      const seq = await sql<{ id: number }>`SELECT nextval(pg_get_serial_sequence('audit_logs', 'id')) AS id`.execute(tx);
      const id = Number(seq.rows[0].id);
      const occurredAt = new Date(this.clock().getTime());
      const hash = computeAuditHash(prevHash, { id, occurredAt, ...row });

      await tx.insertInto('audit_logs').values(auditRow(id, occurredAt, row, detailsText, prevHash, hash)).execute();

      return { id, occurredAt, ...row, prevHash: toHex(prevHash), hash: toHex(hash) };
    });
  }

  /**
   * Append several entries, in their order, under one hold of the chain's lock: the head read once, their ids
   * allocated together (in chain order), the rows inserted AUDIT_BATCH_ROWS a statement. The same entries, links and
   * hashes as `record` called for each in turn, for a caller with many to write in one transaction (a LIVE sell-out's
   * `vault.give`, one per collector in the line): a few statements instead of four per entry. Every entry is checked
   * before anything is written.
   */
  async recordAll(entries: readonly AuditRecordInput[], trx?: Db): Promise<void> {
    if (entries.length === 0) return;
    if (entries.length === 1) {
      await this.record(entries[0]!, trx);
      return;
    }
    const prepared = entries.map((e) => prepareEntry(e));

    await inTransaction(trx ?? this.db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.AUDIT_CHAIN);
      const last = await tx.selectFrom('audit_logs').select('hash').orderBy('id', 'desc').limit(1).executeTakeFirst();
      let prevHash = last ? toBytes(last.hash) : AUDIT_GENESIS_HASH;
      const seq = await sql<{ id: number | string }>`SELECT nextval(pg_get_serial_sequence('audit_logs', 'id')) AS id FROM generate_series(1, ${prepared.length}::int)`.execute(tx);
      const ids = seq.rows.map((r) => Number(r.id)).sort((a, b) => a - b);
      const rows = prepared.map(({ row, detailsText }, i) => {
        const id = ids[i]!;
        const occurredAt = new Date(this.clock().getTime());
        const hash = computeAuditHash(prevHash, { id, occurredAt, ...row });
        const out = auditRow(id, occurredAt, row, detailsText, prevHash, hash);
        prevHash = hash;
        return out;
      });
      for (let i = 0; i < rows.length; i += AUDIT_BATCH_ROWS) await tx.insertInto('audit_logs').values(rows.slice(i, i + AUDIT_BATCH_ROWS)).execute();
    });
  }

  /**
   * Recompute every hash and link, oldest first, in batches. Reports the
   * first entry that does not match (edited, inserted out of chain, or
   * following a deleted entry).
   *
   * The entries are `audit_logs` and the purge's tombstones (`audit_purge_gaps`) merged in id order (header). Each
   * batch is read in ONE statement, so it sees one snapshot of both tables: a purge batch committing between two
   * batches only turns ids above the cursor into tombstones, which the next statement sees consistently (never two
   * cursors, one per table, that could each see a different moment). Each table's primary key is walked from the
   * cursor, bounded to the batch, and the two merged (`chainBatch`), so a batch costs the same at any depth of the
   * log. Each entry also says whether its id is in the other table too, so an id present in both is BROKEN whichever
   * of the two comes first and wherever a batch ends. `betweenBatches` (tests only) runs after each
   * full batch, before the next is read.
   */
  async verifyChain(opts: { batchSize?: number; betweenBatches?: (afterId: number) => Promise<void> } = {}): Promise<ChainVerification> {
    const batchSize = Math.max(1, Math.min(opts.batchSize ?? 1000, 10_000));
    let prev = AUDIT_GENESIS_HASH;
    let checked = 0;
    let purged = 0;
    let afterId = 0;
    let lastWasGap = false;
    let lastId = 0;
    const verdict = (firstBadId?: number): ChainVerification => ({
      ok: firstBadId === undefined,
      checked,
      ...(firstBadId === undefined ? {} : { firstBadId }),
      ...(purged > 0 ? { purged } : {}),
    });
    for (;;) {
      const { rows } = await chainBatch(afterId, batchSize).execute(this.db);
      for (const r of rows) {
        const id = Number(r.id);
        if (r.shadowed) return verdict(id);
        const storedPrev = toBytes(r.prev_hash);
        if (!bytesEqual(storedPrev, prev)) return verdict(id);
        const stored = toBytes(r.hash);
        if (r.gap) {
          // A tombstone: its content is gone, so only its link is checked; its hash carries the chain on.
          purged++;
        } else {
          const expected = computeAuditHash(prev, fromRow(r));
          if (!bytesEqual(expected, stored)) return verdict(id);
          checked++;
        }
        prev = stored;
        lastWasGap = r.gap;
        lastId = id;
      }
      if (rows.length < batchSize) {
        // A tombstone after the newest live entry: the chain's tail was deleted, which the purge never does.
        return lastWasGap ? verdict(lastId) : verdict();
      }
      afterId = Number(rows[rows.length - 1]!.id);
      if (opts.betweenBatches) await opts.betweenBatches(afterId);
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

/**
 * One batch of `verifyChain`: the next `n` entries above `afterId`, live rows and tombstones merged in id order, in
 * ONE statement (one snapshot of both tables). Each leaf walks its own primary key from the cursor and stops at `n`
 * (`ORDER BY id LIMIT n`) BEFORE anything else, then looks up each of its rows' twin in the other table by that table's
 * primary key (`LEFT JOIN LATERAL ... WHERE t.id = ... LIMIT 1`: one index probe per row, never a merge join that
 * walks the other table from its start, nor a hashed scan of all of it). A batch thus reads about 4n index entries
 * whatever the log's size or the cursor's depth, and the whole check stays linear: never an Append of every row above
 * the cursor sorted to keep n. The first n of the merge are within the first n of each leaf, so the outer `ORDER BY id LIMIT n` gives the
 * same entries as one unbounded merge would. Exported for the plan test (audit.test.ts).
 */
export function chainBatch(afterId: number, n: number): RawBuilder<ChainItem> {
  return sql<ChainItem>`
    (SELECT false AS gap, l.id, l.occurred_at, l.actor_type, l.actor_id, l.action, l.target_type, l.target_id,
            l.details, l.ip_hash, l.prev_hash, l.hash, (s.id IS NOT NULL) AS shadowed
       FROM (SELECT * FROM audit_logs WHERE id > ${afterId} ORDER BY id LIMIT ${n}) l
       LEFT JOIN LATERAL (SELECT t.id FROM audit_purge_gaps t WHERE t.id = l.id LIMIT 1) s ON true
      ORDER BY l.id)
    UNION ALL
    (SELECT true AS gap, g.id, NULL::timestamptz, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
            NULL::jsonb, NULL::text, g.prev_hash, g.hash, (s.id IS NOT NULL) AS shadowed
       FROM (SELECT id, prev_hash, hash FROM audit_purge_gaps WHERE id > ${afterId} ORDER BY id LIMIT ${n}) g
       LEFT JOIN LATERAL (SELECT t.id FROM audit_logs t WHERE t.id = g.id LIMIT 1) s ON true
      ORDER BY g.id)
    ORDER BY id
    LIMIT ${n}`;
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
