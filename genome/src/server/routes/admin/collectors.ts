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
 *        The figures name no one: counts, medians and groups, so an AUDITOR reads them as they are, except the who
 *        panel's cities (§3.0 (h): empty, with `citiesWithheld`, since a narrowed population's city of one would tie a
 *        person to it). 503 INSIGHTS_BUSY
 *        while two readings run and another has waited 10 s; 503 INSIGHTS_TIMEOUT for a reading past 8 s.
 *   GET /api/admin/collectors/list      the collectors behind one figure: the report's query with `slice`
 *        (<dimension>[:<value>], §3.6 C.6.5) and `page`; 50 a page ordered by email, never a score; an AUDITOR reads
 *        the emails masked (serialize.ts clientEmail) and no city. Never cached; under the same load guard.
 *   GET /api/admin/collectors/export.csv  ADMIN only (an OPERATOR or AUDITOR gets 403): one CSV row per counted
 *        collector of the page's five filters (c, s, t, sc, ft; not the period nor the scope), the 76 columns of
 *        services/collector-export.ts, emails in clear. Audited `collectors.export` (counts and filters only) before the
 *        body is sent; 409 EXPORT_RUNNING while another export is being made. `cache-control: no-store`, an attachment
 *        named orbes-collectors-<Paris day>.csv, and `x-orbes-rows` (the rows, for the console's « Exported N
 *        collectors. »). Never written to disk.
 *
 * Validation: `collectorsOptionsQuery`, `collectorsReportQuery`, `collectorsListQuery`, `collectorsExportQuery` (http/schemas.ts; unknown keys refused), then the service's
 * checks of the period and the filters: 400 VALIDATION_FAILED.
 */
import { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import { collectorsExportQuery, collectorsListQuery, collectorsOptionsQuery, collectorsReportQuery, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { clientEmail, readsClientEmails } from './serialize.js';
import type { AdminRouteDeps } from './index.js';

export const adminCollectorRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { collectorInsights } = ctx.services;

  app.get('/api/admin/collectors/options', async (request) => {
    parse(collectorsOptionsQuery, request.query);
    return collectorInsights.options();
  });

  app.get('/api/admin/collectors/report', async (request) => {
    const q = parse(collectorsReportQuery, request.query);
    const report = await collectorInsights.report(q);
    // §3.0 (h): an AUDITOR reads countries, not cities. Masked here, after the shared cache, which keeps every figure.
    if (report.panel !== 'who' || readsClientEmails(request)) return report;
    const none = { rows: [], groups: 0 };
    return { ...report, figures: { ...report.figures, cities: { given: none, connection: none }, citiesWithheld: true as const } };
  });

  app.get('/api/admin/collectors/list', async (request) => {
    const q = parse(collectorsListQuery, request.query);
    const inClear = readsClientEmails(request);
    const list = await collectorInsights.list(q, { withCities: inClear });
    return { ...list, rows: list.rows.map((r) => ({ ...r, email: clientEmail(r.email, inClear) })) };
  });

  app.get('/api/admin/collectors/export.csv', { config: { guard: { minRole: 'ADMIN' as const } } }, async (request, reply) => {
    const q = parse(collectorsExportQuery, request.query);
    const file = await collectorInsights.exportCsv(q, adminActor(request));
    reply.header('cache-control', 'no-store');
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    reply.header('x-orbes-rows', String(file.rows));
    return reply.type(file.contentType).send(Readable.from(file.body));
  });
};
