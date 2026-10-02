/**
 * Audit log (AUDITOR): the hash-chained entries, newest first, and a full
 * re-computation of the chain.
 *
 * Each entry also carries `actorEmail`, the email of the console user who
 * acted (null for customers and the system), and `targetEmail` when the
 * target is a console user (the Team page's actions), read from
 * `admin_users` at display time: the log itself names ids only and never
 * changes (A-02).
 */
import type { FastifyPluginAsync } from 'fastify';
import { auditListQuery, pageOf, parse } from '../../http/schemas.js';
import { adminEmailsById } from '../../services/auth.js';
import type { AdminRouteDeps } from './index.js';

export const adminAuditRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { audit, db } = ctx;

  app.get('/api/admin/audit', async (request) => {
    const f = parse(auditListQuery, request.query);
    const page = await audit.list(
      {
        ...(f.action ? { action: f.action } : {}),
        ...(f.actorType ? { actorType: f.actorType } : {}),
        ...(f.actorId ? { actorId: f.actorId } : {}),
        ...(f.targetType ? { targetType: f.targetType } : {}),
        ...(f.targetId ? { targetId: f.targetId } : {}),
      },
      pageOf(request.query),
    );
    const adminActorId = (e: (typeof page.items)[number]) => (e.actorType === 'admin' ? e.actorId : null);
    const adminTargetId = (e: (typeof page.items)[number]) => (e.targetType === 'admin' ? e.targetId : null);
    const emails = await adminEmailsById(db, page.items.flatMap((e) => [adminActorId(e), adminTargetId(e)]));
    const emailOf = (id: string | null) => (id ? (emails.get(id.toLowerCase()) ?? null) : null);
    return { ...page, items: page.items.map((e) => ({ ...e, actorEmail: emailOf(adminActorId(e)), targetEmail: emailOf(adminTargetId(e)) })) };
  });

  app.get('/api/admin/audit/verify', async () => {
    const result = await audit.verifyChain();
    // The head hash is what operators export to WORM storage: it detects truncation of the newest entries.
    return { ...result, head: await audit.head() };
  });
};
