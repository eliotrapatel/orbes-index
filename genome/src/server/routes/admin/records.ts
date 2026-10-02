/**
 * Registry views for the console: scan & authentication events, owners,
 * warranties and anomalies (with triage).
 *
 * These are the only places internal verification facts (reasons, risk
 * scores, authenticator results) leave the database, and only to an
 * authenticated admin session.
 */
import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { anomalyListQuery, anomalyParams, anomalyPatchBody, pageOf, parse, scanListQuery, warrantyListQuery } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { adminEmailsById } from '../../services/auth.js';
import { findProduct } from '../../services/lifecycle.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';

export const adminRecordRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;
  const { warranty, anomaly } = ctx.services;

  app.get('/api/admin/scans', async (request) => {
    const f = parse(scanListQuery, request.query);
    const page = pageOf(request.query);
    let q = db
      .selectFrom('scan_events as s')
      .leftJoin('authentication_events as a', 'a.scan_event_id', 's.id')
      .leftJoin('products as p', 'p.id', 's.product_id');
    if (f.productId !== undefined) {
      const product = await findProduct(db, f.productId);
      if (!product) return makePage([], 0, page);
      q = q.where('s.product_id', '=', product.id);
    }
    if (f.state !== undefined) q = q.where('s.result_state', '=', f.state);
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
      ])
      .orderBy('s.occurred_at', 'desc')
      .orderBy('s.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    // A staff scan (ADMIN_TEST, the sale mode) names its console user, by email at display time.
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
      })),
      Number(total.n),
      page,
    );
  });

  app.get('/api/admin/owners', async (request) => {
    const page = pageOf(request.query);
    const total = await db.selectFrom('accounts').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await db
      .selectFrom('accounts as a')
      .leftJoin('ownership as o', 'o.account_id', 'a.id')
      .select([
        'a.id',
        'a.email',
        'a.display_name',
        'a.country',
        'a.status',
        'a.created_at',
        sql<number>`count(o.id) FILTER (WHERE o.ended_at IS NULL)`.as('current_products'),
        sql<number>`count(o.id)`.as('total_products'),
      ])
      .groupBy(['a.id', 'a.email', 'a.display_name', 'a.country', 'a.status', 'a.created_at'])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        country: r.country?.trim() ?? null,
        status: r.status,
        createdAt: r.created_at,
        products: Number(r.current_products),
        productsEver: Number(r.total_products),
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
    const f = parse(anomalyListQuery, request.query);
    return anomaly.list({ ...(f.status ? { status: f.status } : {}), ...(f.severity ? { severity: f.severity } : {}) }, pageOf(request.query));
  });

  app.patch('/api/admin/anomalies/:id', async (request) => {
    const { id } = parse(anomalyParams, request.params);
    const b = parse(anomalyPatchBody, request.body);
    return anomaly.updateStatus(id, { status: b.status, note: b.note ?? null }, adminActor(request));
  });
};
