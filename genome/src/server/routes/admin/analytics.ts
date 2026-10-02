/**
 * GET /api/admin/analytics?from&to (or ?days): the daily scan statistics of
 * a window of UTC days, at most 366 (API §16.10). AUDITOR, like every read.
 *
 * Read from `scan_daily_stats` (services/scan-stats.ts), never from the scan
 * history: the figures are the same before and after a purge
 * (SCAN_RETENTION_DAYS), they cover complete days up to yesterday, and staff
 * scans (ADMIN_TEST) are never in them.
 */
import type { FastifyPluginAsync } from 'fastify';
import { analyticsQuery, parse } from '../../http/schemas.js';
import { analyticsWindow, scanStatsReport } from '../../services/scan-stats.js';
import type { AdminRouteDeps } from './index.js';

export const adminAnalyticsRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  app.get('/api/admin/analytics', async (request) => {
    const now = ctx.clock();
    const window = analyticsWindow(parse(analyticsQuery, request.query), now);
    return scanStatsReport(ctx.db, window, now);
  });
};
