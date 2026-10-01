/**
 * Audit log (AUDITOR): the hash-chained entries, newest first, and a full
 * re-computation of the chain.
 */
import type { FastifyPluginAsync } from 'fastify';
import { auditListQuery, pageOf, parse } from '../../http/schemas.js';
import type { AdminRouteDeps } from './index.js';

export const adminAuditRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { audit } = ctx;

  app.get('/api/admin/audit', async (request) => {
    const f = parse(auditListQuery, request.query);
    return audit.list(
      {
        ...(f.action ? { action: f.action } : {}),
        ...(f.actorType ? { actorType: f.actorType } : {}),
        ...(f.actorId ? { actorId: f.actorId } : {}),
        ...(f.targetType ? { targetType: f.targetType } : {}),
        ...(f.targetId ? { targetId: f.targetId } : {}),
      },
      pageOf(request.query),
    );
  });

  app.get('/api/admin/audit/verify', async () => {
    const result = await audit.verifyChain();
    // The head hash is what operators export to WORM storage: it detects truncation of the newest entries.
    return { ...result, head: await audit.head() };
  });
};
