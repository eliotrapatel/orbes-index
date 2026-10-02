/**
 * Registry views for the console: scan & authentication events, warranties
 * and anomalies (with triage: filters, the badge's summary and the scans
 * around one finding). Owners have their own routes (owners.ts).
 *
 * These are the only places internal verification facts (reasons, risk
 * scores, authenticator results) leave the database, and only to an
 * authenticated admin session. A scan carries the customer's report on it
 * (C-02: channel, place, note and the state of its case), and an anomaly the
 * reports on the scans that took part in it (the Cases queue: reports.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { anomalyListQuery, anomalyParams, anomalyPatchBody, pageOf, parse, scanListQuery, warrantyListQuery } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { adminEmailsById } from '../../services/auth.js';
import { findProduct } from '../../services/lifecycle.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';

export const adminRecordRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;
  const { warranty, anomaly, lifecycle, reports } = ctx.services;

  app.get('/api/admin/scans', async (request) => {
    const f = parse(scanListQuery, request.query);
    const page = pageOf(request.query);
    let q = db
      .selectFrom('scan_events as s')
      .leftJoin('authentication_events as a', 'a.scan_event_id', 's.id')
      .leftJoin('products as p', 'p.id', 's.product_id')
      .leftJoin('scan_reports as r', 'r.scan_event_id', 's.id');
    if (f.productId !== undefined) {
      const product = await findProduct(db, f.productId);
      if (!product) return makePage([], 0, page);
      q = q.where('s.product_id', '=', product.id);
    }
    if (f.state !== undefined) q = q.where('s.result_state', '=', f.state);
    if (f.scanId !== undefined) q = q.where('s.id', '=', f.scanId);
    if (f.from !== undefined) q = q.where('s.occurred_at', '>=', f.from);
    if (f.to !== undefined) q = q.where('s.occurred_at', '<=', f.to);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        's.id',
        's.occurred_at',
        's.event_type',
        's.result_state',
        's.code_id',
        's.packed_identity',
        's.account_id',
        's.admin_id',
        's.device_hash',
        's.country',
        's.region',
        's.lat',
        's.lon',
        's.user_agent_family',
        's.client_metrics',
        's.latency_ms',
        'p.product_id',
        'a.id as auth_id',
        'a.signature_valid',
        'a.genome_check',
        'a.key_id',
        'a.reasons',
        'a.risk_score',
        'a.authenticators',
        'r.id as report_id',
        'r.channel as report_channel',
        'r.place as report_place',
        'r.note as report_note',
        'r.status as report_status',
        'r.created_at as report_created_at',
      ])
      .orderBy('s.occurred_at', 'desc')
      .orderBy('s.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    // A staff scan (ADMIN_TEST: the sale mode, or /verify with a console session) names its console user, by email at display time.
    const staff = await adminEmailsById(db, rows.map((r) => r.admin_id));
    return makePage(
      rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        eventType: r.event_type,
        state: r.result_state,
        productId: r.product_id,
        codeId: r.code_id,
        packedIdentity: r.packed_identity,
        accountId: r.account_id,
        adminEmail: r.admin_id ? (staff.get(r.admin_id) ?? null) : null,
        deviceHash: r.device_hash,
        country: r.country?.trim() ?? null,
        region: r.region,
        lat: r.lat,
        lon: r.lon,
        userAgentFamily: r.user_agent_family,
        clientMetrics: r.client_metrics,
        latencyMs: r.latency_ms,
        authentication: r.auth_id
          ? {
              signatureValid: r.signature_valid,
              genomeCheck: r.genome_check,
              keyId: r.key_id,
              reasons: r.reasons,
              riskScore: r.risk_score,
              authenticators: r.authenticators,
            }
          : null,
        // The customer's report on this scan, and the state of its case.
        report: r.report_id
          ? {
              id: r.report_id,
              channel: r.report_channel,
              place: r.report_place,
              note: r.report_note,
              status: r.report_status,
              createdAt: r.report_created_at,
            }
          : null,
      })),
      Number(total.n),
      page,
    );
  });

  app.get('/api/admin/warranties', async (request) => {
    const f = parse(warrantyListQuery, request.query);
    return warranty.list(f.status ? { status: f.status } : {}, pageOf(request.query));
  });

  app.get('/api/admin/anomalies', async (request) => {
    const { sort, ...filters } = parse(anomalyListQuery, request.query);
    const list = await anomaly.list(filters, pageOf(request.query), sort);
    // What customers said about the scans that took part in each finding (count, open cases, the latest).
    const byAnomaly = await reports.forAnomalies(list.items.map((a) => a.id));
    return { ...list, items: list.items.map((a) => ({ ...a, reports: byAnomaly.get(a.id) ?? null })) };
  });

  // The console's badge (OPEN HIGH + CRITICAL), polled every minute while a console tab is visible.
  app.get('/api/admin/anomalies/summary', async () => anomaly.summary());

  app.get('/api/admin/anomalies/:id/context', async (request) => {
    const { id } = parse(anomalyParams, request.params);
    const c = await anomaly.context(id);
    // The product's lifecycle, so the console offers only the marks its status allows.
    const product = c.anomaly.productUuid ? { productId: c.anomaly.productId, lifecycle: await lifecycle.snapshot(c.anomaly.productUuid) } : null;
    return { ...c, product };
  });

  app.patch('/api/admin/anomalies/:id', async (request) => {
    const { id } = parse(anomalyParams, request.params);
    const b = parse(anomalyPatchBody, request.body);
    return anomaly.updateStatus(id, { status: b.status, note: b.note ?? null }, adminActor(request));
  });
};
