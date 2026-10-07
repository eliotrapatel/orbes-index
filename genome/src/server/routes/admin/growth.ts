/**
 * GROWTH (plan NEXT-NINE of 2026-10-06, §3.9 BP-29; API §16.31; services/growth.ts). Reads only, AUDITOR and up like
 * every read of the console (RETAIL gets 403 from the guard); nothing is audited, nothing is cached.
 *
 *   GET /api/admin/growth?months=12|24&currency=EUR|GBP|USD|CHF   the report: the window, lifetime value, repeat
 *        buying, the funnel from a scan to PALLADIUM, the revenue. It names no account. The scan days not counted yet
 *        are counted first (`aggregateScanStats`, the housekeeping's idempotent pass, as Analytics does); a count that
 *        fails is logged and the report still answers.
 *   GET /api/admin/growth/collectors?currency=&page=              COLLECTORS BY VALUE, 25 a page: each collector's
 *        account, email, tier now, country, pieces counted, value and first piece; the email masked for an AUDITOR
 *        (`clientEmail`, as on the owners' list), in clear for OPERATOR and ADMIN.
 *   GET /api/admin/growth/releases                                the 6 latest releases past their opening.
 *
 * Validation: `growthQuery`, `growthCollectorsQuery` (http/schemas.ts): 400 VALIDATION_FAILED.
 */
import type { FastifyPluginAsync } from 'fastify';
import { growthCollectorsQuery, growthQuery, parse } from '../../http/schemas.js';
import { aggregateScanStats } from '../../services/scan-stats.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

export const adminGrowthRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  app.get('/api/admin/growth', async (request) => {
    const q = parse(growthQuery, request.query);
    try {
      await aggregateScanStats(ctx.db, ctx.clock());
    } catch (e) {
      request.log.error({ err: { message: (e as Error)?.message } }, 'scan statistics could not be counted before the growth report');
    }
    return ctx.services.growth.report({ months: q.months, currency: q.currency });
  });

  app.get('/api/admin/growth/collectors', async (request) => {
    const q = parse(growthCollectorsQuery, request.query);
    const inClear = readsClientEmails(request);
    const page = await ctx.services.growth.collectors({ currency: q.currency, page: q.page });
    return { ...page, items: page.items.map((c) => ({ ...c, email: clientEmail(c.email, inClear) })) };
  });

  app.get('/api/admin/growth/releases', async () => ({ items: await ctx.services.growth.releases() }));
};
