/**
 * AnomalyService (contract §2.5): scores a code's recent scan history with the
 * pure rules of anomaly-rules.ts and keeps the `anomalies` table (one OPEN or
 * ACKNOWLEDGED row per product and type; repeats increment `occurrences`).
 *
 * For the console's triage it lists findings (filters, most severe first),
 * counts the OPEN HIGH and CRITICAL ones (the console's badge) and reads the
 * scans around one finding: the timeline, its countries, its distinct
 * devices and the scan that last raised it.
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
  type ScanEventType,
} from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { makePage, noopLogger, pageOffset, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';
import type { AnomalyConfig } from '../config.js';
import type { AuditService } from './audit.js';
import { adminEmailsById } from './auth.js';
import { ANOMALY_TYPES, evaluateRules, horizonMs, type ScanRecord, type ScoredFinding } from './anomaly-rules.js';

export type { AnomalyConfig } from '../config.js';
export { ANOMALY_TYPES, ANOMALY_WEIGHTS, type AnomalyType } from './anomaly-rules.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_NOTE = 2000;
const DEFAULT_HISTORY_LIMIT = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Orders of the admin list: most severe first (the default, then the highest risk), highest risk first, or last seen first. */
export const ANOMALY_SORTS = ['severity', 'risk', 'lastSeen'] as const;
export type AnomalySort = (typeof ANOMALY_SORTS)[number];

/** The severities the console's badge counts among OPEN findings. */
export const ATTENTION_SEVERITIES: readonly AnomalySeverity[] = Object.freeze(['HIGH', 'CRITICAL']);

/** A finding's scans are read from this long before its first occurrence (or its rule's window, when longer)… */
export const CONTEXT_LEAD_MS = DAY_MS;
/** …to this long after its last one. */
export const CONTEXT_TAIL_MS = HOUR_MS;
/** At most this many scans of the window are returned: the latest ones, oldest first. */
export const CONTEXT_MAX_SCANS = 100;

/** Rank of a severity (LOW 0 … CRITICAL 3) for ordering; built from constants only. */
const SEVERITY_RANK = sql<number>`CASE a.severity ${sql.join(
  ANOMALY_SEVERITIES.map((s, i) => sql`WHEN ${sql.lit(s)} THEN ${sql.lit(i)}`),
  sql` `,
)} ELSE -1 END`;
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
  /**
   * A staff scan (ADMIN_TEST, S-07): score the public history as it stands, without the scan
   * `scanEventId` taking part, and record nothing. The console user sees the state a customer would
   * see now, and a staff scan never adds to a history finding.
   */
  observeOnly?: boolean;
}

/** Options of AnomalyService.recordFinding. */
export interface RecordFindingOptions {
  /**
   * At most one occurrence per product and UTC day (S-07, UNSOLD_PIECE_SCAN): the finding is
   * dropped when one of its type was already seen for this product on the day of `f.at`
   * (`last_seen_at` that day), whatever its status: a finding seen today and dismissed is not raised
   * again before tomorrow, while one last seen yesterday and dismissed today is raised again by
   * today's first scan. `occurrences` then counts days. Product findings only.
   */
  oncePerUtcDay?: boolean;
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
  /**
   * Email of the console user whose decision is the latest on this finding (acknowledged,
   * resolved, dismissed or reopened it), from the audit log (`anomaly.update`) and `admin_users`
   * at read time; null while no admin has triaged it.
   */
  actorEmail: string | null;
}

export interface AnomalyFilters {
  /** One anomaly (anomalies.id). */
  id?: string;
  status?: AnomalyStatus;
  severity?: AnomalySeverity;
  type?: string;
  /** products.id (uuid) or canonical product id. */
  productId?: string;
}

/** GET /api/admin/anomalies/summary: what waits for triage. */
export interface AnomalySummary {
  /** OPEN findings (not yet acknowledged) by severity. */
  open: Record<AnomalySeverity, number>;
  /** OPEN findings of severity HIGH or CRITICAL: the console's badge. */
  attention: number;
  /** Every type the service can record (the list's type filter). */
  types: string[];
}

/** One scan around a finding, as the triage panel shows it. */
export interface AnomalyContextScan {
  id: string;
  occurredAt: Date;
  eventType: ScanEventType;
  state: string;
  country: string | null;
  region: string | null;
  deviceHash: string | null;
  userAgentFamily: string | null;
  /** The verification's risk score (null when no authentication record exists). */
  riskScore: number | null;
  /** The scan named by the finding's `details.scanEventId`: the one that last raised it. */
  trigger: boolean;
}

/** GET /api/admin/anomalies/:id/context (the route adds the product's lifecycle). */
export interface AnomalyContext {
  anomaly: AnomalyRecord;
  /** The finding's window (contextWindow): the scans below were made in it. */
  window: { from: Date; to: Date };
  /** The scans of the window, ADMIN_TEST excluded as the rules exclude it: the latest CONTEXT_MAX_SCANS, oldest first. */
  scans: { total: number; truncated: boolean; items: AnomalyContextScan[] };
  /** Scans of the window per country (null: unknown), most first. */
  countries: { country: string | null; scans: number }[];
  /** Distinct device pseudonyms among the window's scans. */
  devices: number;
  /** The scan named by `details.scanEventId`, wherever it falls; null when there is none or it was purged. */
  trigger: AnomalyContextScan | null;
  /** The code the finding names. */
  code: { id: string; issue: number; status: CodeStatus } | null;
}

/**
 * The window of a finding's scans: from CONTEXT_LEAD_MS before its first occurrence (or its rule's
 * window, `details.windowMin` / `details.windowDays`, when longer) to CONTEXT_TAIL_MS after its last.
 */
export function contextWindow(a: Pick<AnomalyRecord, 'firstSeenAt' | 'lastSeenAt' | 'details'>): { from: Date; to: Date } {
  const d = a.details ?? {};
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const rule = positive(d.windowMin) ? d.windowMin * MINUTE_MS : positive(d.windowDays) ? d.windowDays * DAY_MS : 0;
  return {
    from: new Date(a.firstSeenAt.getTime() - Math.max(CONTEXT_LEAD_MS, rule)),
    to: new Date(a.lastSeenAt.getTime() + CONTEXT_TAIL_MS),
  };
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
   * re-counted on every later scan. With `observeOnly` (a staff scan), the
   * scan takes no part and nothing is recorded.
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

    const observeOnly = opts.observeOnly === true;
    const history = await this.loadHistory(db, input.codeId, input.scanEventId, now, !observeOnly);
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
    if (observeOnly) return { riskScore, findings: out };
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
   * `oncePerUtcDay`: see RecordFindingOptions.
   */
  async recordFinding(f: AnomalyFinding, trx?: Db, opts: RecordFindingOptions = {}): Promise<void> {
    const v = validateFinding(f);
    const db = trx ?? this.db;
    let dayStart: Date | undefined;
    if (opts.oncePerUtcDay === true) {
      if (v.productId === null) throw new TypeError('recordFinding: oncePerUtcDay needs a productId');
      dayStart = new Date(Date.UTC(v.at.getUTCFullYear(), v.at.getUTCMonth(), v.at.getUTCDate()));
      const seen = await db
        .selectFrom('anomalies')
        .select('id')
        .where('product_id', '=', v.productId)
        .where('type', '=', v.type)
        .where('last_seen_at', '>=', dayStart)
        .limit(1)
        .executeTakeFirst();
      if (seen) return;
    }
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
        .onConflict((oc) => {
          const update = oc
            .columns(['product_id', 'type'])
            .where('status', 'in', ['OPEN', 'ACKNOWLEDGED'])
            .doUpdateSet({
              occurrences: sql<number>`anomalies.occurrences + 1`,
              last_seen_at: sql<Date>`GREATEST(anomalies.last_seen_at, excluded.last_seen_at)`,
              risk_score: sql<number>`GREATEST(anomalies.risk_score, excluded.risk_score)`,
              details: sql<string>`excluded.details`,
              code_id: sql<string | null>`COALESCE(excluded.code_id, anomalies.code_id)`,
            });
          // Once a day, even against a concurrent scan that passed the check above: the row it
          // created (or updated) today makes this update a no-op.
          return dayStart ? update.where('anomalies.last_seen_at', '<', dayStart) : update;
        })
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

  /**
   * Findings matching the filters. `sort`: `severity` (default: CRITICAL, HIGH, MEDIUM, LOW, then the
   * highest risk), `risk` (highest first, then the most severe) or `lastSeen` (most recent first); ties
   * end on the most recently seen, then the id, so pages never overlap.
   */
  async list(filters: AnomalyFilters = {}, page: PageRequest, sort: AnomalySort = 'severity'): Promise<Page<AnomalyRecord>> {
    if (filters.status !== undefined && !ANOMALY_STATUSES.includes(filters.status)) throw validationError('Unknown anomaly status.');
    if (filters.severity !== undefined && !ANOMALY_SEVERITIES.includes(filters.severity)) throw validationError('Unknown anomaly severity.');
    if (filters.type !== undefined && !TYPE_RE.test(filters.type)) throw validationError('Unknown anomaly type.');
    if (filters.id !== undefined && !UUID_RE.test(filters.id)) throw validationError('Unknown anomaly.');
    if (!ANOMALY_SORTS.includes(sort)) throw validationError('Unknown anomaly order.');
    let q = this.db.selectFrom('anomalies as a').leftJoin('products as p', 'p.id', 'a.product_id');
    if (filters.id) q = q.where('a.id', '=', filters.id.toLowerCase());
    if (filters.status) q = q.where('a.status', '=', filters.status);
    if (filters.severity) q = q.where('a.severity', '=', filters.severity);
    if (filters.type) q = q.where('a.type', '=', filters.type);
    if (filters.productId !== undefined) {
      const ref = String(filters.productId);
      q = UUID_RE.test(ref) ? q.where('a.product_id', '=', ref) : q.where('p.product_id', '=', ref);
    }
    const [{ total }] = await q.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    let rows = q.selectAll('a').select('p.product_id as canonical_id');
    if (sort === 'severity') rows = rows.orderBy(SEVERITY_RANK, 'desc').orderBy('a.risk_score', 'desc');
    if (sort === 'risk') rows = rows.orderBy('a.risk_score', 'desc').orderBy(SEVERITY_RANK, 'desc');
    const found = await rows
      .orderBy('a.last_seen_at', 'desc')
      .orderBy('a.id', 'asc')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(await this.withActors(found.map((r) => toRecord(r, r.canonical_id))), Number(total), page);
  }

  /** OPEN findings by severity, the badge count (OPEN HIGH + CRITICAL) and the known types. */
  async summary(): Promise<AnomalySummary> {
    const rows = await this.db
      .selectFrom('anomalies')
      .select((eb) => ['severity', eb.fn.countAll<number>().as('n')])
      .where('status', '=', 'OPEN')
      .groupBy('severity')
      .execute();
    const open = Object.fromEntries(ANOMALY_SEVERITIES.map((s) => [s, 0])) as Record<AnomalySeverity, number>;
    for (const r of rows) open[r.severity] = Number(r.n);
    return { open, attention: ATTENTION_SEVERITIES.reduce((n, s) => n + open[s], 0), types: [...ANOMALY_TYPES] };
  }

  /**
   * The scans around a finding: its product's scans (or, without a product, those of the scanned
   * identity) in its window, their countries and distinct devices, the scan that last raised it
   * (`details.scanEventId`) and the code it names. ADMIN_TEST scans are left out, as the rules leave them.
   */
  async context(id: string): Promise<AnomalyContext> {
    const anomaly = await this.get(id);
    const window = contextWindow(anomaly);
    const triggerId = typeof anomaly.details.scanEventId === 'string' && UUID_RE.test(anomaly.details.scanEventId) ? anomaly.details.scanEventId.toLowerCase() : null;
    const packed = anomaly.details.packedIdentity;

    const scope = () => {
      const q = this.db.selectFrom('scan_events as s').where('s.event_type', '!=', 'ADMIN_TEST');
      if (anomaly.productUuid) return q.where('s.product_id', '=', anomaly.productUuid);
      if (typeof packed === 'number' && Number.isSafeInteger(packed)) return q.where('s.packed_identity', '=', packed);
      return null;
    };
    const inWindow = () => scope()?.where('s.occurred_at', '>=', window.from).where('s.occurred_at', '<=', window.to) ?? null;
    const columns = (q: NonNullable<ReturnType<typeof scope>>) =>
      q
        .leftJoin('authentication_events as ae', 'ae.scan_event_id', 's.id')
        .select(['s.id', 's.occurred_at', 's.event_type', 's.result_state', 's.country', 's.region', 's.device_hash', 's.user_agent_family', 'ae.risk_score']);
    type Row = Awaited<ReturnType<ReturnType<typeof columns>['execute']>>[number];
    const toScan = (r: Row): AnomalyContextScan => ({
      id: r.id,
      occurredAt: r.occurred_at,
      eventType: r.event_type,
      state: r.result_state,
      country: r.country?.trim() || null,
      region: r.region,
      deviceHash: r.device_hash,
      userAgentFamily: r.user_agent_family,
      riskScore: r.risk_score ?? null,
      trigger: r.id === triggerId,
    });

    let scans: AnomalyContext['scans'] = { total: 0, truncated: false, items: [] };
    let countries: AnomalyContext['countries'] = [];
    let devices = 0;
    const q = inWindow();
    if (q) {
      const totals = await q
        .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.count<number>('s.device_hash').distinct().as('devices')])
        .executeTakeFirstOrThrow();
      const latest = await columns(q).orderBy('s.occurred_at', 'desc').orderBy('s.id', 'desc').limit(CONTEXT_MAX_SCANS).execute();
      const byCountry = await q
        .select((eb) => ['s.country', eb.fn.countAll<number>().as('n')])
        .groupBy('s.country')
        .orderBy('n', 'desc')
        .orderBy('s.country', 'asc')
        .execute();
      const total = Number(totals.n);
      scans = { total, truncated: total > latest.length, items: latest.reverse().map(toScan) };
      countries = byCountry.map((r) => ({ country: r.country?.trim() || null, scans: Number(r.n) }));
      devices = Number(totals.devices);
    }

    let trigger: AnomalyContextScan | null = scans.items.find((s) => s.trigger) ?? null;
    if (!trigger && triggerId) {
      const row = await columns(this.db.selectFrom('scan_events as s')).where('s.id', '=', triggerId).executeTakeFirst();
      trigger = row ? toScan(row) : null;
    }

    const code = anomaly.codeId
      ? ((await this.db.selectFrom('codes').select(['id', 'issue', 'status']).where('id', '=', anomaly.codeId).executeTakeFirst()) ?? null)
      : null;
    return { anomaly, window, scans, countries, devices, trigger, code };
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
    return (await this.withActors([toRecord(row, row.canonical_id)]))[0];
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

  /**
   * Who triaged each finding last: the newest `anomaly.update` audit entry by an admin, per
   * anomaly (served by the audit_logs (target_type, target_id) index), named by its email.
   */
  private async withActors(records: AnomalyRecord[]): Promise<AnomalyRecord[]> {
    if (records.length === 0) return records;
    const latest = await this.db
      .selectFrom('audit_logs')
      .select(['target_id', 'actor_id'])
      .distinctOn('target_id')
      .where('target_type', '=', 'anomaly')
      .where('target_id', 'in', records.map((r) => r.id))
      .where('action', '=', 'anomaly.update')
      .where('actor_type', '=', 'admin')
      .orderBy('target_id')
      .orderBy('id', 'desc')
      .execute();
    const actorOf = new Map(latest.map((r) => [r.target_id, r.actor_id]));
    const emails = await adminEmailsById(this.db, actorOf.values());
    return records.map((r) => {
      const actorId = actorOf.get(r.id);
      return { ...r, actorEmail: actorId ? (emails.get(actorId.toLowerCase()) ?? null) : null };
    });
  }

  /** The code's scans the rules look at; ADMIN_TEST ones never, the scan being verified always when `includeCurrent`. */
  private async loadHistory(db: Db, codeId: string, scanEventId: string, now: Date, includeCurrent: boolean) {
    const since = new Date(now.getTime() - horizonMs(this.config));
    const cols = ['id', 'occurred_at', 'device_hash', 'session_hash', 'ip_hash', 'account_id', 'country', 'lat', 'lon'] as const;
    let q = db
      .selectFrom('scan_events')
      .select(cols)
      .where('code_id', '=', codeId)
      .where('event_type', '!=', 'ADMIN_TEST')
      .where('occurred_at', '>=', since)
      .where('occurred_at', '<=', now);
    if (!includeCurrent) q = q.where('id', '!=', scanEventId);
    const rows = await q.orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(this.historyLimit).execute();
    if (includeCurrent && !rows.some((r) => r.id === scanEventId)) {
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
    actorEmail: null,
  };
}

function actorLabel(actor: Actor): string {
  return actor?.id ? `${actor.type}:${actor.id}` : (actor?.type ?? 'system');
}
