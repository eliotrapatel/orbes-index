/**
 * The Collectors page (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.6, C.9; API §16.37; services/collector-insights.ts):
 * reads only, AUDITOR and up like every read of the console (RETAIL and LOGISTICS get 403 from the guard); nothing is
 * audited. Every route sits in the `admin` rate group (no group of its own: the cache and the load guard bound the
 * database's work).
 *
 *   GET /api/admin/collectors/options   the filters' choices, the currencies, `recordingSince` and `snapshotsSince`.
 *   GET /api/admin/collectors/report    one panel's figures: ?panel=overview|who|origin|likes|devices|engagement|trends, the
 *        period (p=7d|30d|90d|12m|custom, with from and to for custom), cmp, scope=all|active|new, the five filters (c, s,
 *        t, sc, ft), currency, fresh; for trends its figure (collectors|new|firstvisits|active|medianscore|wishes|views|
 *        buyers) and split (none|country|source|tier|age|device).
 *        The figures name no one: counts, medians and groups, so an AUDITOR reads them as they are. 503 INSIGHTS_BUSY
 *        while two readings run and another has waited 10 s; 503 INSIGHTS_TIMEOUT for a reading past 8 s.
 *
 * Validation: `collectorsOptionsQuery`, `collectorsReportQuery` (http/schemas.ts; unknown keys refused), then the service's
 * checks of the period and the filters: 400 VALIDATION_FAILED.
 */
import type { FastifyPluginAsync } from 'fastify';
import { collectorsOptionsQuery, collectorsReportQuery, parse } from '../../http/schemas.js';
import type { AdminRouteDeps } from './index.js';

export const adminCollectorRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { collectorInsights } = ctx.services;

  app.get('/api/admin/collectors/options', async (request) => {
    parse(collectorsOptionsQuery, request.query);
    return collectorInsights.options();
  });

  app.get('/api/admin/collectors/report', async (request) => {
    const q = parse(collectorsReportQuery, request.query);
    return collectorInsights.report(q);
  });
};
