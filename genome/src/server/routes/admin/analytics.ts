/**
 * GET /api/admin/analytics?from&to (or ?days): the daily scan statistics of
 * a window of UTC days, at most 366 (API §16.16). AUDITOR, like every read.
 *
 * Read from `scan_daily_stats` (services/scan-stats.ts), never from the scan
 * history: the figures are the same before and after a purge
 * (SCAN_RETENTION_DAYS), they cover complete days up to yesterday, and staff
 * scans (ADMIN_TEST) are never in them.
 *
 * The route first counts the complete days housekeeping has not counted yet
 * (the same idempotent pass, `aggregateScanStats`: in the minutes after
 * midnight UTC, or after a restart, before the next pass), so the figures
 * reach yesterday. A count that fails is logged and the report still answers:
 * its `through` then says the last day really counted (`countedThrough`), and
 * the console says the days after it are not counted yet.
 *
 * GET /api/admin/analytics/circle?from&to (or ?days), the same window: the
 * panel The Circle (P-X01). The members of the club by tier now (the ACTIVE
 * accounts that hold a piece, as the club counts them), and the visits of the
 * circle on each UTC day of the window: a count per day, which names no
 * account (services/circle.ts). AUDITOR.
 */
import type { FastifyPluginAsync } from 'fastify';
import { analyticsQuery, parse } from '../../http/schemas.js';
import { aggregateScanStats, analyticsWindow, scanStatsReport } from '../../services/scan-stats.js';
import type { AdminRouteDeps } from './index.js';

export const adminAnalyticsRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  app.get('/api/admin/analytics', async (request) => {
    const now = ctx.clock();
    const window = analyticsWindow(parse(analyticsQuery, request.query), now);
    try {
      await aggregateScanStats(ctx.db, now);
    } catch (e) {
      request.log.error({ err: { message: (e as Error)?.message } }, 'scan statistics could not be counted before the report');
    }
    return scanStatsReport(ctx.db, window, now);
  });

  app.get('/api/admin/analytics/circle', async (request) => {
    const window = analyticsWindow(parse(analyticsQuery, request.query), ctx.clock());
    return ctx.services.circle.stats(window);
  });
};
