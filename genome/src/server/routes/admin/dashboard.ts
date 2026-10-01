/**
 * GET /api/admin/dashboard — the console's landing counts: products by
 * status, scans in the last 24 h / 7 d, open anomalies by severity, the
 * active signing key and the most recent scans.
 */
import type { FastifyPluginAsync } from 'fastify';
import { ANOMALY_SEVERITIES, PRODUCT_STATUSES, type AnomalySeverity, type ProductStatus } from '../../db/schema.js';
import type { AdminRouteDeps } from './index.js';

const DAY_MS = 86_400_000;
const RECENT_EVENTS = 10;

export const adminDashboardRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;

  app.get('/api/admin/dashboard', async () => {
    const now = ctx.clock();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    const statusRows = await db
      .selectFrom('products')
      .select((eb) => ['status', eb.fn.countAll<number>().as('n')])
      .groupBy('status')
      .execute();
    const byStatus = Object.fromEntries(PRODUCT_STATUSES.map((s) => [s, 0])) as Record<ProductStatus, number>;
    for (const r of statusRows) byStatus[r.status] = Number(r.n);

    const scans = await db
      .selectFrom('scan_events')
      .select((eb) => [eb.fn.countAll<number>().filterWhere('occurred_at', '>=', dayAgo).as('day'), eb.fn.countAll<number>().as('week')])
      .where('occurred_at', '>=', weekAgo)
      .executeTakeFirstOrThrow();

    const anomalyRows = await db
      .selectFrom('anomalies')
      .select((eb) => ['severity', eb.fn.countAll<number>().as('n')])
      .where('status', 'in', ['OPEN', 'ACKNOWLEDGED'])
      .groupBy('severity')
      .execute();
    const openAnomalies = Object.fromEntries(ANOMALY_SEVERITIES.map((s) => [s, 0])) as Record<AnomalySeverity, number>;
    for (const r of anomalyRows) openAnomalies[r.severity] = Number(r.n);

    const active = (await ctx.keys.list()).find((k) => k.status === 'ACTIVE');

    const recent = await db
      .selectFrom('scan_events as s')
      .leftJoin('products as p', 'p.id', 's.product_id')
      .select(['s.id', 's.occurred_at', 's.event_type', 's.result_state', 's.country', 'p.product_id'])
      .orderBy('s.occurred_at', 'desc')
      .orderBy('s.id')
      .limit(RECENT_EVENTS)
      .execute();

    return {
      generatedAt: now,
      products: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      scans: { last24h: Number(scans.day), last7d: Number(scans.week) },
      anomalies: { open: Object.values(openAnomalies).reduce((a, b) => a + b, 0), openBySeverity: openAnomalies },
      activeKey: active ? { keyId: active.keyId, kid: active.kid, activatedAt: active.activatedAt } : null,
      recentEvents: recent.map((r) => ({
        scanId: r.id,
        occurredAt: r.occurred_at,
        eventType: r.event_type,
        state: r.result_state,
        productId: r.product_id,
        country: r.country?.trim() ?? null,
      })),
    };
  });
};
