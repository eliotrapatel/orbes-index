/**
 * ScanReportService (C-02, phase 2): where a customer saw or bought a piece
 * whose scan was not authentic, attached to that scan, and the Cases queue
 * of the console that follows the reports up.
 *
 *   submit  POST /api/v1/reports (public, rate group verify): one report per
 *           scan, only for a scan that was not authentic and is less than
 *           24 hours old; audited `scan.report` with the scan id alone.
 *   list    GET /api/admin/reports (AUDITOR): each case with its scan, the
 *           anomaly the scan took part in, and its piece.
 *   close   PATCH /api/admin/reports/:id (OPERATOR): closed with a note,
 *           audited `scan.report.close`.
 *
 * The place and the note are the customer's own words: personal data, kept
 * exactly as long as the scan (scan-retention.ts deletes the report with
 * it) and never copied into the audit log, which is permanent. The
 * resolution note stays with the case for the same reason.
 *
 * A scan took part in an anomaly when the anomaly was recorded by that scan
 * (`details.scanEventId`) or when the scan is of the same piece (its product,
 * or for an identity that is not registered its packed identity) and was
 * made while the anomaly was being seen, between its first and last
 * sighting (SCAN_IN_ANOMALY). A case shows one: the most severe of those
 * its scan recorded, else of those it was seen during.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import {
  REPORT_CHANNELS,
  REPORT_STATUSES,
  type AnomalySeverity,
  type AnomalyStatus,
  type ReportChannel,
  type ReportStatus,
  type VerificationState,
} from '../db/schema.js';
import { conflict, notFound, validationError } from '../errors.js';
import { makePage, noopLogger, pageOffset, systemClock, type Actor, type Clock, type Logger, type Page, type PageRequest } from '../types.js';
import type { AuditService } from './audit.js';

/** A report is accepted within 24 hours of its scan. */
export const REPORT_WINDOW_MS = 24 * 60 * 60_000;

/** Lengths, in characters, after trimming (also CHECK constraints of migration 0004). */
export const REPORT_LIMITS = Object.freeze({ place: 200, note: 500, resolutionNote: 2000 });

/** The results a customer may report on: every state that is not authentic (API §9.3). */
export const REPORTABLE_STATES: readonly VerificationState[] = Object.freeze([
  'SUSPICIOUS_ACTIVITY',
  'REVOKED',
  'UNKNOWN',
  'INVALID_SIGNATURE',
  'MALFORMED_CODE',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Least severe first, as `array_position` read it. */
const ANOMALY_SEVERITY_ORDER: readonly string[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Scan `s` (scan_events) took part in anomaly `a` (anomalies) of its piece: recorded by it, or made between the
 * anomaly's first and last sighting. A finding is always recorded with the product of the scan that raised it, so
 * `a.product_id = s.product_id` holds for both, and the join runs on anomalies_product_id_idx.
 */
const SCAN_IN_PRODUCT_ANOMALY = sql<boolean>`(
  a.product_id = s.product_id
  AND (a.details->>'scanEventId' = s.id::text OR s.occurred_at BETWEEN a.first_seen_at AND a.last_seen_at))`;

/**
 * The same for a scan of no registered piece (VALID_SIGNATURE_UNREGISTERED): an anomaly without a product, recorded by
 * the scan or of the same signed identity (`details.packedIdentity`) during its sightings. `product_id IS NULL` is
 * served by the same index.
 */
const SCAN_IN_UNREGISTERED_ANOMALY = sql<boolean>`(
  a.product_id IS NULL AND s.product_id IS NULL
  AND (a.details->>'scanEventId' = s.id::text
       OR (s.occurred_at BETWEEN a.first_seen_at AND a.last_seen_at AND a.details->'packedIdentity' = to_jsonb(s.packed_identity))))`;

/**
 * Scan `s` took part in anomaly `a`: recorded by it, or a scan of the same piece (or, without one, of the same signed
 * identity) made between the anomaly's first and last sighting.
 */
export const SCAN_IN_ANOMALY = sql<boolean>`(${SCAN_IN_PRODUCT_ANOMALY} OR ${SCAN_IN_UNREGISTERED_ANOMALY})`;

export interface ReportInput {
  /** scan_events.id, the `scanId` of the verification. */
  scanId: string;
  channel: ReportChannel;
  /** Where: the boutique, the website, the city (≤ 200 characters). */
  place?: string | null;
  /** Anything else the customer wants to say (≤ 500 characters). */
  note?: string | null;
}

/** A report as the scans and anomalies lists show it. */
export interface ReportSummary {
  id: string;
  channel: ReportChannel;
  place: string | null;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
}

/** A case of the Cases queue: the report, its scan, the anomaly the scan took part in, its piece. */
export interface ScanReportRecord extends ReportSummary {
  scanId: string;
  handledBy: { id: string; email: string } | null;
  handledAt: Date | null;
  resolutionNote: string | null;
  scan: {
    occurredAt: Date;
    state: string;
    /** Canonical product id of the piece, when the signed identity is registered. */
    productId: string | null;
    country: string | null;
    region: string | null;
  };
  anomaly: { id: string; type: string; severity: AnomalySeverity; status: AnomalyStatus } | null;
}

/** The reports on the scans that took part in one anomaly. */
export interface AnomalyReports {
  count: number;
  open: number;
  latest: ReportSummary;
}

export interface ReportFilters {
  status?: ReportStatus;
  /** scan_events.id */
  scanId?: string;
  /** anomalies.id: the reports on the scans that took part in it. */
  anomalyId?: string;
}

export interface ScanReportServiceDeps {
  db: Db;
  audit?: AuditService;
  clock?: Clock;
  log?: Logger;
}

const notAllowed = () =>
  conflict('REPORT_NOT_ALLOWED', 'A report can be sent only within 24 hours of a result that was not authentic. Please scan the piece again.');
/**
 * A staff scan (S-07: the browser carried a console session, so the scan is ADMIN_TEST) takes no report: a customer's
 * words belong to a customer's scan. Scanning again would only record another staff scan, so the answer says why.
 * Only the browser that scanned holds the scan's random id, so this tells no one else anything.
 */
const staffScanNotAllowed = () =>
  conflict(
    'REPORT_NOT_ALLOWED',
    'This browser is signed in to the ORBES console, so this scan was recorded as a staff test and takes no report. Sign out of the console, or use another browser, to report as a customer.',
  );

export class ScanReportService {
  private readonly db: Db;
  private readonly audit: AuditService | undefined;
  private readonly clock: Clock;
  private readonly log: Logger;

  constructor(deps: ScanReportServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
    this.log = deps.log ?? noopLogger;
  }

  /**
   * Attach a report to a scan (POST /api/v1/reports). Unknown scans, authentic results, scans of
   * another kind and scans 24 hours old or older answer alike (409 REPORT_NOT_ALLOWED); a staff scan
   * (ADMIN_TEST) answers the same code with a message that says why; a second report on the same scan
   * answers 409 REPORT_ALREADY_SENT.
   */
  async submit(input: ReportInput, actor: Actor): Promise<{ createdAt: Date }> {
    const scanId = typeof input?.scanId === 'string' && UUID_RE.test(input.scanId) ? input.scanId.toLowerCase() : null;
    if (!scanId) throw notAllowed();
    if (!REPORT_CHANNELS.includes(input.channel)) throw validationError('Unknown channel.');
    const place = cleanText(input.place, REPORT_LIMITS.place, 'place');
    const note = cleanText(input.note, REPORT_LIMITS.note, 'note');
    const now = this.clock();
    try {
      await inTransaction(this.db, async (tx) => {
        const scan = await tx.selectFrom('scan_events').select(['id', 'occurred_at', 'event_type', 'result_state']).where('id', '=', scanId).executeTakeFirst();
        const age = scan ? now.getTime() - scan.occurred_at.getTime() : Number.POSITIVE_INFINITY;
        if (scan?.event_type === 'ADMIN_TEST') throw staffScanNotAllowed();
        if (!scan || scan.event_type !== 'VERIFY' || !REPORTABLE_STATES.includes(scan.result_state as VerificationState) || age >= REPORT_WINDOW_MS) {
          throw notAllowed();
        }
        const existing = await tx.selectFrom('scan_reports').select('id').where('scan_event_id', '=', scanId).executeTakeFirst();
        if (existing) throw alreadySent();
        // created_at from the service clock, so a case is never closed "before" it was reported.
        await tx.insertInto('scan_reports').values({ scan_event_id: scanId, channel: input.channel, place, note, created_at: now }).execute();
        // The scan id alone: the customer's words never enter the permanent audit log.
        await this.audit?.record({ actor, action: 'scan.report', targetType: 'scan', targetId: scanId }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw alreadySent();
      throw e;
    }
    this.log.info({ scanId, channel: input.channel }, 'scan report received');
    return { createdAt: now };
  }

  // ── Cases (console) ──────────────────────────────────────────────────────

  async list(filters: ReportFilters = {}, page: PageRequest): Promise<Page<ScanReportRecord>> {
    if (filters.status !== undefined && !REPORT_STATUSES.includes(filters.status)) throw validationError('Unknown case status.');
    for (const [k, v] of [['scanId', filters.scanId], ['anomalyId', filters.anomalyId]] as const) {
      if (v !== undefined && !UUID_RE.test(v)) throw validationError(`${k} must be a UUID.`);
    }
    let q = this.base();
    if (filters.status) q = q.where('r.status', '=', filters.status);
    if (filters.scanId) q = q.where('r.scan_event_id', '=', filters.scanId.toLowerCase());
    if (filters.anomalyId) {
      const anomalyId = filters.anomalyId.toLowerCase();
      q = q.where((eb) => eb.exists(eb.selectFrom('anomalies as a').select(eb.lit(1).as('one')).where('a.id', '=', anomalyId).where(SCAN_IN_ANOMALY)));
    }
    const [{ total }] = await q.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    const rows = await this.select(q)
      // The queue: open cases first, then the newest.
      .orderBy(sql`r.status = 'OPEN'`, 'desc')
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    const anomalies = await this.anomaliesOf(rows.map((r) => r.scan_event_id));
    return makePage(rows.map((r) => toRecord(r, anomalies.get(r.scan_event_id) ?? null)), Number(total), page);
  }

  async get(id: string): Promise<ScanReportRecord> {
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Case', 'REPORT_NOT_FOUND');
    const row = await this.select(this.base()).where('r.id', '=', id.toLowerCase()).executeTakeFirst();
    if (!row) throw notFound('Case', 'REPORT_NOT_FOUND');
    const anomalies = await this.anomaliesOf([row.scan_event_id]);
    return toRecord(row, anomalies.get(row.scan_event_id) ?? null);
  }

  /** Close a case with a note (PATCH /api/admin/reports/:id). Only an admin closes a case. */
  async close(id: string, input: { note: string }, actor: Actor): Promise<ScanReportRecord> {
    if (actor?.type !== 'admin' || typeof actor.id !== 'string' || !UUID_RE.test(actor.id)) {
      throw new TypeError('ScanReportService.close: actor must be an admin');
    }
    const note = cleanText(input?.note, REPORT_LIMITS.resolutionNote, 'note');
    if (note === null) throw validationError('Explain the decision in the note.');
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw notFound('Case', 'REPORT_NOT_FOUND');
    const reportId = id.toLowerCase();
    const now = this.clock();
    await inTransaction(this.db, async (tx) => {
      const row = await tx.selectFrom('scan_reports').select(['id', 'scan_event_id', 'status', 'created_at']).where('id', '=', reportId).forUpdate().executeTakeFirst();
      if (!row) throw notFound('Case', 'REPORT_NOT_FOUND');
      if (row.status === 'CLOSED') throw conflict('REPORT_ALREADY_CLOSED', 'This case is already closed.');
      const at = now.getTime() < row.created_at.getTime() ? row.created_at : now;
      await tx
        .updateTable('scan_reports')
        .set({ status: 'CLOSED', handled_by: actor.id!, handled_at: at, resolution_note: note })
        .where('id', '=', reportId)
        .execute();
      // Targets the scan, as `scan.report` does, so the audit log reads a case's two entries together.
      await this.audit?.record({ actor, action: 'scan.report.close', targetType: 'scan', targetId: row.scan_event_id, details: { reportId } }, tx);
    });
    this.log.info({ reportId }, 'case closed');
    return this.get(reportId);
  }

  /** The reports on the scans that took part in each anomaly (the Anomalies view's column). */
  async forAnomalies(anomalyIds: readonly string[]): Promise<Map<string, AnomalyReports>> {
    const ids = [...new Set(anomalyIds.filter((x) => typeof x === 'string' && UUID_RE.test(x)))];
    const out = new Map<string, AnomalyReports>();
    if (ids.length === 0) return out;
    // From the reports (few) to their scans, then to the anomalies they took part in.
    const rows = await this.db
      .selectFrom('scan_reports as r')
      .innerJoin('scan_events as s', 's.id', 'r.scan_event_id')
      .innerJoin('anomalies as a', (join) => join.on(SCAN_IN_ANOMALY))
      .select(['a.id as anomaly_id', 'r.id', 'r.channel', 'r.place', 'r.note', 'r.status', 'r.created_at'])
      .where('a.id', 'in', ids)
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id')
      .execute();
    for (const r of rows) {
      const summary: ReportSummary = { id: r.id, channel: r.channel, place: r.place, note: r.note, status: r.status, createdAt: r.created_at };
      const seen = out.get(r.anomaly_id);
      if (!seen) out.set(r.anomaly_id, { count: 1, open: r.status === 'OPEN' ? 1 : 0, latest: summary });
      else {
        seen.count++;
        if (r.status === 'OPEN') seen.open++;
      }
    }
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private base() {
    return this.db
      .selectFrom('scan_reports as r')
      .innerJoin('scan_events as s', 's.id', 'r.scan_event_id')
      .leftJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('admin_users as u', 'u.id', 'r.handled_by');
  }

  private select(q: ReturnType<ScanReportService['base']>) {
    return q.select([
      'r.id',
      'r.scan_event_id',
      'r.channel',
      'r.place',
      'r.note',
      'r.status',
      'r.created_at',
      'r.handled_by',
      'r.handled_at',
      'r.resolution_note',
      'u.email as handled_by_email',
      's.occurred_at',
      's.result_state',
      's.country',
      's.region',
      'p.product_id',
    ]);
  }

  /**
   * For each scan, the anomaly it took part in: among those it recorded, else among those it was seen
   * during, the most severe (then the highest risk score, then the latest seen).
   */
  private async anomaliesOf(scanIds: readonly string[]): Promise<Map<string, NonNullable<ScanReportRecord['anomaly']>>> {
    const out = new Map<string, NonNullable<ScanReportRecord['anomaly']>>();
    if (scanIds.length === 0) return out;
    const ids = [...new Set(scanIds)];
    // Two joins, each on an index (the scan's primary key, then anomalies' product_id), rather than one OR that no
    // index serves: the anomalies table is never purged, so a page of cases must not read all of it.
    const branch = (on: typeof SCAN_IN_ANOMALY) =>
      this.db
        .selectFrom('scan_events as s')
        .innerJoin('anomalies as a', (join) => join.on(on))
        .select([
          's.id as scan_id',
          'a.id',
          'a.type',
          'a.severity',
          'a.status',
          'a.risk_score',
          'a.last_seen_at',
          sql<boolean>`COALESCE(a.details->>'scanEventId' = s.id::text, false)`.as('recorded'),
        ])
        .where('s.id', 'in', ids);
    const rows = [...(await branch(SCAN_IN_PRODUCT_ANOMALY).execute()), ...(await branch(SCAN_IN_UNREGISTERED_ANOMALY).execute())];
    // Per scan: the anomaly it recorded first, then the most severe, the highest risk, the latest seen.
    const rank = (v: string) => ANOMALY_SEVERITY_ORDER.indexOf(v);
    rows.sort(
      (x, y) =>
        (x.scan_id < y.scan_id ? -1 : x.scan_id > y.scan_id ? 1 : 0) ||
        Number(y.recorded) - Number(x.recorded) ||
        rank(y.severity) - rank(x.severity) ||
        y.risk_score - x.risk_score ||
        y.last_seen_at.getTime() - x.last_seen_at.getTime() ||
        (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    );
    for (const r of rows) if (!out.has(r.scan_id)) out.set(r.scan_id, { id: r.id, type: r.type, severity: r.severity, status: r.status });
    return out;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function alreadySent() {
  return conflict('REPORT_ALREADY_SENT', 'A report has already been sent for this reference.');
}

/** Trimmed text, null when empty; refuses control characters (other than tab and newlines) and overlong text. */
function cleanText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw validationError(`${field}: Must be text.`);
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > max) throw validationError(`${field}: At most ${max} characters.`);
  if (CONTROL_CHARS.test(t)) throw validationError(`${field}: Contains invalid characters.`);
  return t;
}

interface ReportRow {
  id: string;
  scan_event_id: string;
  channel: ReportChannel;
  place: string | null;
  note: string | null;
  status: ReportStatus;
  created_at: Date;
  handled_by: string | null;
  handled_at: Date | null;
  resolution_note: string | null;
  handled_by_email: string | null;
  occurred_at: Date;
  result_state: string;
  country: string | null;
  region: string | null;
  product_id: string | null;
}

function toRecord(r: ReportRow, anomaly: ScanReportRecord['anomaly']): ScanReportRecord {
  return {
    id: r.id,
    scanId: r.scan_event_id,
    channel: r.channel,
    place: r.place,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
    handledBy: r.handled_by ? { id: r.handled_by, email: r.handled_by_email ?? '' } : null,
    handledAt: r.handled_at,
    resolutionNote: r.resolution_note,
    scan: { occurredAt: r.occurred_at, state: r.result_state, productId: r.product_id, country: r.country?.trim() ?? null, region: r.region },
    anomaly,
  };
}
