/**
 * AnomalyService (contract §2.5): scores a code's recent scan history with the
 * pure rules of anomaly-rules.ts and keeps the `anomalies` table (one OPEN or
 * ACKNOWLEDGED row per product and type; repeats increment `occurrences`).
 *
 * Everything here is internal: risk scores, thresholds and finding details
 * are for the admin console only and never part of a public response.
 */
import { sql } from 'kysely';
import { advisoryXactLock, ADVISORY_LOCK, inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  jsonText,
  type AnomalyRow,
  type AnomalySeverity,
  type AnomalyStatus,
  type CodeStatus,
  type JsonObject,
  type ProductStatus,
} from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { makePage, noopLogger, pageOffset, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';
import type { AnomalyConfig } from '../config.js';
import type { AuditService } from './audit.js';
import { evaluateRules, horizonMs, type ScanRecord, type ScoredFinding } from './anomaly-rules.js';

export type { AnomalyConfig } from '../config.js';
export { ANOMALY_WEIGHTS, type AnomalyType } from './anomaly-rules.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_NOTE = 2000;
const DEFAULT_HISTORY_LIMIT = 1000;
/**
 * Serialises recording of product-less findings (VALID_SIGNATURE_UNREGISTERED):
 * the partial unique index cannot deduplicate NULL product ids. Defined with
 * every other lock key in ADVISORY_LOCK (db/connection.ts); kept here as an alias.
 */
export const ANOMALY_UNREGISTERED_LOCK = ADVISORY_LOCK.ANOMALY_UNREGISTERED;

/** A finding to record (rule or service level). */
export interface AnomalyFinding {
  type: string;
  severity: AnomalySeverity;
  /** Nominal weight of the type (0..100). */
  weight: number;
  /** Decayed contribution stored on the anomaly row (0..100). */
  riskScore: number;
  /** products.id (uuid), or null when the identity is not registered. */
  productId: string | null;
  /** codes.id (uuid), or null. */
  codeId: string | null;
  at: Date;
  details: JsonObject;
}

export interface EvaluateInput {
  /** products.id (uuid). */
  productId: string;
  /** codes.id (uuid). */
  codeId: string;
  /** scan_events.id of the scan being verified (already inserted). */
  scanEventId: string;
  accountIsOwner: boolean;
}

/** Optional extras: run inside the caller's transaction and skip lookups the caller already did. */
export interface EvaluateOptions {
  trx?: Db;
  productStatus?: ProductStatus;
  codeStatus?: CodeStatus;
  /** Current owner's account id (null = no owner). Loaded when undefined. */
  ownerAccountId?: string | null;
}

export interface EvaluateResult {
  riskScore: number;
  findings: AnomalyFinding[];
}

export interface AnomalyRecord {
  id: string;
  /** Canonical product id, when known. */
  productId: string | null;
  productUuid: string | null;
  codeId: string | null;
  type: string;
  severity: AnomalySeverity;
  riskScore: number;
  details: JsonObject;
  status: AnomalyStatus;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}

export interface AnomalyFilters {
  status?: AnomalyStatus;
  severity?: AnomalySeverity;
  type?: string;
  /** products.id (uuid) or canonical product id. */
  productId?: string;
}

export interface AnomalyServiceDeps {
  db: Db;
  config: AnomalyConfig;
  audit?: AuditService;
  clock?: Clock;
  log?: Logger;
  /** Max scans loaded per evaluation (newest first). Default 1000. */
  historyLimit?: number;
}

export class AnomalyService {
  private readonly db: Db;
  private readonly config: AnomalyConfig;
  private readonly audit: AuditService | undefined;
  private readonly clock: Clock;
  private readonly log: Logger;
  private readonly historyLimit: number;

  constructor(deps: AnomalyServiceDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
    this.historyLimit = Math.max(10, Math.min(100_000, deps.historyLimit ?? DEFAULT_HISTORY_LIMIT));
  }

  /**
   * Score the code's recent history, which includes the scan `scanEventId`.
   * Findings that involve this scan are recorded (upserted); older ones only
   * contribute their decayed weight to the score, so one past burst is not
   * re-counted on every later scan.
   */
  async evaluate(input: EvaluateInput, opts: EvaluateOptions = {}): Promise<EvaluateResult> {
    for (const [k, v] of [['productId', input?.productId], ['codeId', input?.codeId], ['scanEventId', input?.scanEventId]] as const) {
      if (typeof v !== 'string' || !UUID_RE.test(v)) throw new TypeError(`AnomalyService.evaluate: ${k} must be a uuid`);
    }
    const db = opts.trx ?? this.db;
    const now = this.clock();

    let productStatus = opts.productStatus;
    let codeStatus = opts.codeStatus;
    if (productStatus === undefined || codeStatus === undefined) {
      const row = await db
        .selectFrom('codes as c')
        .innerJoin('products as p', 'p.id', 'c.product_id')
        .select(['p.status as productStatus', 'c.status as codeStatus'])
        .where('c.id', '=', input.codeId)
        .where('p.id', '=', input.productId)
        .executeTakeFirst();
      if (!row) throw new TypeError('AnomalyService.evaluate: code does not belong to product');
      productStatus ??= row.productStatus;
      codeStatus ??= row.codeStatus;
    }
    let ownerAccountId = opts.ownerAccountId;
    if (ownerAccountId === undefined) {
      const owner = await db
        .selectFrom('ownership')
        .select('account_id')
        .where('product_id', '=', input.productId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      ownerAccountId = owner?.account_id ?? null;
    }

    const history = await this.loadHistory(db, input.codeId, input.scanEventId, now);
    const records: ScanRecord[] = history.map((r) => ({
      id: r.id,
      at: r.occurred_at,
      deviceHash: r.device_hash,
      sessionHash: r.session_hash,
      ipHash: r.ip_hash,
      accountId: r.account_id,
      byOwner:
        (r.id === input.scanEventId && input.accountIsOwner === true) ||
        (ownerAccountId !== null && r.account_id !== null && r.account_id === ownerAccountId),
      country: r.country,
      lat: r.lat,
      lon: r.lon,
    }));

    const { riskScore, findings } = evaluateRules(records, now, this.config, {
      currentScanId: input.scanEventId,
      productStatus,
      codeStatus,
    });

    const out = findings.map((f) => toFinding(f, input.productId, input.codeId));
    for (let i = 0; i < findings.length; i++) {
      if (findings[i].scanIds.includes(input.scanEventId)) {
        await this.recordFinding({ ...out[i], details: { ...out[i].details, scanEventId: input.scanEventId } }, db);
      }
    }
    return { riskScore, findings: out };
  }

  /**
   * Upsert a finding: a new OPEN anomaly, or `occurrences + 1` on the open
   * (or acknowledged) one of the same product and type. The stored risk score
   * keeps its maximum; details and code follow the latest occurrence.
   */
  async recordFinding(f: AnomalyFinding, trx?: Db): Promise<void> {
    const v = validateFinding(f);
    const db = trx ?? this.db;
    const values = {
      product_id: v.productId,
      code_id: v.codeId,
      type: v.type,
      severity: v.severity,
      risk_score: v.riskScore,
      details: jsonText(v.details),
      first_seen_at: v.at,
      last_seen_at: v.at,
    };

    if (v.productId !== null) {
      await db
        .insertInto('anomalies')
        .values(values)
        .onConflict((oc) =>
          oc
            .columns(['product_id', 'type'])
            .where('status', 'in', ['OPEN', 'ACKNOWLEDGED'])
            .doUpdateSet({
              occurrences: sql<number>`anomalies.occurrences + 1`,
              last_seen_at: sql<Date>`GREATEST(anomalies.last_seen_at, excluded.last_seen_at)`,
              risk_score: sql<number>`GREATEST(anomalies.risk_score, excluded.risk_score)`,
              details: sql<string>`excluded.details`,
              code_id: sql<string | null>`COALESCE(excluded.code_id, anomalies.code_id)`,
            }),
        )
        .execute();
      return;
    }

    // No product: deduplicate by type and the scanned identity, under a lock (NULLs never conflict in an index).
    const packed = typeof v.details.packedIdentity === 'number' ? v.details.packedIdentity : null;
    await inTransaction(db, async (tx) => {
      await advisoryXactLock(tx, ADVISORY_LOCK.ANOMALY_UNREGISTERED);
      let q = tx
        .selectFrom('anomalies')
        .select(['id'])
        .where('product_id', 'is', null)
        .where('type', '=', v.type)
        .where('status', 'in', ['OPEN', 'ACKNOWLEDGED']);
      q = packed === null ? q.where(sql`details->'packedIdentity'`, 'is', null) : q.where(sql`(details->>'packedIdentity')::bigint`, '=', packed);
      const existing = await q.orderBy('first_seen_at', 'asc').limit(1).executeTakeFirst();
      if (!existing) {
        await tx.insertInto('anomalies').values(values).execute();
        return;
      }
      await tx
        .updateTable('anomalies')
        .set({
          occurrences: sql<number>`occurrences + 1`,
          last_seen_at: sql<Date>`GREATEST(last_seen_at, ${v.at})`,
          risk_score: sql<number>`GREATEST(risk_score, ${v.riskScore})`,
          details: values.details,
        })
        .where('id', '=', existing.id)
        .execute();
    });
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async list(filters: AnomalyFilters = {}, page: PageRequest): Promise<Page<AnomalyRecord>> {
    if (filters.status !== undefined && !ANOMALY_STATUSES.includes(filters.status)) throw validationError('Unknown anomaly status.');
    if (filters.severity !== undefined && !ANOMALY_SEVERITIES.includes(filters.severity)) throw validationError('Unknown anomaly severity.');
    if (filters.type !== undefined && !TYPE_RE.test(filters.type)) throw validationError('Unknown anomaly type.');
    let q = this.db.selectFrom('anomalies as a').leftJoin('products as p', 'p.id', 'a.product_id');
    if (filters.status) q = q.where('a.status', '=', filters.status);
    if (filters.severity) q = q.where('a.severity', '=', filters.severity);
    if (filters.type) q = q.where('a.type', '=', filters.type);
    if (filters.productId !== undefined) {
      const ref = String(filters.productId);
      q = UUID_RE.test(ref) ? q.where('a.product_id', '=', ref) : q.where('p.product_id', '=', ref);
    }
    const [{ total }] = await q.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    const rows = await q
      .selectAll('a')
      .select('p.product_id as canonical_id')
      .orderBy('a.last_seen_at', 'desc')
      .orderBy('a.id', 'asc')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(rows.map((r) => toRecord(r, r.canonical_id)), Number(total), page);
  }

  async get(id: string): Promise<AnomalyRecord> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Anomaly', 'ANOMALY_NOT_FOUND');
    const row = await this.db
      .selectFrom('anomalies as a')
      .leftJoin('products as p', 'p.id', 'a.product_id')
      .selectAll('a')
      .select('p.product_id as canonical_id')
      .where('a.id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('Anomaly', 'ANOMALY_NOT_FOUND');
    return toRecord(row, row.canonical_id);
  }

  /** Admin triage (PATCH /api/admin/anomalies/:id). RESOLVED / DISMISSED record who and when; OPEN reopens. */
  async updateStatus(id: string, input: { status: AnomalyStatus; note?: string | null }, actor: Actor): Promise<AnomalyRecord> {
    if (!ANOMALY_STATUSES.includes(input?.status)) throw validationError('Unknown anomaly status.');
    const note = input.note === undefined || input.note === null ? null : String(input.note).trim();
    if (note !== null && note.length > MAX_NOTE) throw validationError(`The note may be at most ${MAX_NOTE} characters.`);
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Anomaly', 'ANOMALY_NOT_FOUND');
    const now = this.clock();
    const closing = input.status === 'RESOLVED' || input.status === 'DISMISSED';
    try {
      await inTransaction(this.db, async (tx) => {
        const row = await tx.selectFrom('anomalies').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!row) throw notFound('Anomaly', 'ANOMALY_NOT_FOUND');
        if (row.status === input.status && note === null) return;
        await tx
          .updateTable('anomalies')
          .set({
            status: input.status,
            resolved_by: closing ? actorLabel(actor) : null,
            resolved_at: closing ? now : null,
            resolution_note: note ?? (closing ? row.resolution_note : null),
          })
          .where('id', '=', id)
          .execute();
        await this.audit?.record(
          {
            actor,
            action: 'anomaly.update',
            targetType: 'anomaly',
            targetId: id,
            details: { type: row.type, from: row.status, to: input.status, ...(note ? { note } : {}) },
          },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw conflict('ANOMALY_ALREADY_OPEN', 'Another open anomaly of this type exists for this product.');
      }
      throw e;
    }
    this.log.info({ anomalyId: id, status: input.status }, 'anomaly status changed');
    return this.get(id);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async loadHistory(db: Db, codeId: string, scanEventId: string, now: Date) {
    const since = new Date(now.getTime() - horizonMs(this.config));
    const cols = ['id', 'occurred_at', 'device_hash', 'session_hash', 'ip_hash', 'account_id', 'country', 'lat', 'lon'] as const;
    const rows = await db
      .selectFrom('scan_events')
      .select(cols)
      .where('code_id', '=', codeId)
      .where('event_type', '!=', 'ADMIN_TEST')
      .where('occurred_at', '>=', since)
      .where('occurred_at', '<=', now)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(this.historyLimit)
      .execute();
    if (!rows.some((r) => r.id === scanEventId)) {
      // Beyond the limit or stamped in the future by a skewed clock: the current scan always takes part.
      const current = await db.selectFrom('scan_events').select(cols).where('id', '=', scanEventId).executeTakeFirst();
      if (current) rows.push({ ...current, occurred_at: current.occurred_at.getTime() > now.getTime() ? now : current.occurred_at });
    }
    return rows;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toFinding(f: ScoredFinding, productId: string, codeId: string): AnomalyFinding {
  return {
    type: f.type,
    severity: f.severity,
    weight: f.weight,
    riskScore: f.riskScore,
    productId,
    codeId,
    at: f.at,
    details: { ...f.details, weight: f.weight, decay: Math.round(f.decay * 1000) / 1000 },
  };
}

function validateFinding(f: AnomalyFinding): AnomalyFinding {
  if (!f || typeof f !== 'object') throw new TypeError('recordFinding: finding required');
  if (typeof f.type !== 'string' || !TYPE_RE.test(f.type)) throw new TypeError('recordFinding: invalid type');
  if (!ANOMALY_SEVERITIES.includes(f.severity)) throw new TypeError('recordFinding: invalid severity');
  if (f.productId !== null && (typeof f.productId !== 'string' || !UUID_RE.test(f.productId))) throw new TypeError('recordFinding: invalid productId');
  if (f.codeId !== null && (typeof f.codeId !== 'string' || !UUID_RE.test(f.codeId))) throw new TypeError('recordFinding: invalid codeId');
  if (!(f.at instanceof Date) || Number.isNaN(f.at.getTime())) throw new TypeError('recordFinding: invalid time');
  const riskScore = Number.isFinite(f.riskScore) ? Math.min(100, Math.max(0, Math.round(f.riskScore))) : 0;
  const details = f.details && typeof f.details === 'object' && !Array.isArray(f.details) ? f.details : {};
  return { ...f, riskScore, details };
}

function toRecord(r: AnomalyRow, canonicalId: string | null): AnomalyRecord {
  return {
    id: r.id,
    productId: canonicalId,
    productUuid: r.product_id,
    codeId: r.code_id,
    type: r.type,
    severity: r.severity,
    riskScore: r.risk_score,
    details: r.details,
    status: r.status,
    occurrences: r.occurrences,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    resolutionNote: r.resolution_note,
  };
}

function actorLabel(actor: Actor): string {
  return actor?.id ? `${actor.type}:${actor.id}` : (actor?.type ?? 'system');
}
