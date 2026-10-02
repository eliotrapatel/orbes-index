/**
 * The Cases queue (C-02, phase 2): customers' reports on scans that were not
 * authentic, each with its scan, the anomaly the scan took part in and its
 * piece. AUDITOR reads; OPERATOR closes a case with a note (audited
 * `scan.report.close`).
 *
 * The place and note are the customer's own words: they reach an
 * authenticated admin session only, never a public response or the audit
 * log.
 */
import type { FastifyPluginAsync } from 'fastify';
import { pageOf, parse, reportListQuery, reportParams, reportPatchBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

export const adminReportRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { reports } = ctx.services;

  app.get('/api/admin/reports', async (request) => {
    const f = parse(reportListQuery, request.query);
    return reports.list(
      { ...(f.status ? { status: f.status } : {}), ...(f.scanId ? { scanId: f.scanId } : {}), ...(f.anomalyId ? { anomalyId: f.anomalyId } : {}) },
      pageOf(request.query),
    );
  });

  app.patch('/api/admin/reports/:id', async (request) => {
    const { id } = parse(reportParams, request.params);
    const b = parse(reportPatchBody, request.body);
    return reports.close(id, { note: b.note }, adminActor(request));
  });
};
