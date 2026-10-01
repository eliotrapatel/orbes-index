/**
 * Revocations (ADMIN): the register of revoked codes, products and keys,
 * and one entry point that dispatches to the owning service:
 *
 *   CODE    → IssuanceService.revokeCode                     targetId: code uuid
 *   PRODUCT → LifecycleService.transition(…, 'REVOKED')      targetId: canonical id or uuid
 *   KEY     → KeyService.revoke (no compromise time)         targetId: key id 1..255
 *
 * Each writes its own `revocations` row and audit entry.
 */
import type { FastifyPluginAsync } from 'fastify';
import { validationError } from '../../errors.js';
import { createRevocationBody, pageOf, parse, productRef, uuid } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { RevocationRow, RevocationTargetType } from '../../db/schema.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';

function revocationJson(r: RevocationRow) {
  return {
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reasonCode: r.reason_code,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    liftedAt: r.lifted_at,
    liftedBy: r.lifted_by,
  };
}

export const adminRevocationRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db } = ctx;

  app.get('/api/admin/revocations', async (request) => {
    const page = pageOf(request.query);
    const total = await db.selectFrom('revocations').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await db
      .selectFrom('revocations')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(rows.map(revocationJson), Number(total.n), page);
  });

  app.post('/api/admin/revocations', { config: { guard: { minRole: 'ADMIN' } } }, async (request, reply) => {
    const b = parse(createRevocationBody, request.body);
    const actor = adminActor(request);
    let target: { type: RevocationTargetType; id: string };
    switch (b.targetType) {
      case 'CODE': {
        const codeId = parse(uuid, b.targetId);
        await ctx.services.issuance.revokeCode(codeId, b.reason, actor);
        target = { type: 'CODE', id: codeId };
        break;
      }
      case 'PRODUCT': {
        const ref = parse(productRef, b.targetId);
        const change = await ctx.services.lifecycle.transition(ref, 'REVOKED', { reason: b.reason }, actor);
        target = { type: 'PRODUCT', id: change.productId };
        break;
      }
      case 'KEY': {
        if (!/^\d{1,3}$/.test(b.targetId) || Number(b.targetId) < 1 || Number(b.targetId) > 255) {
          throw validationError('targetId: a key id is a number from 1 to 255.');
        }
        await ctx.keys.revoke(Number(b.targetId), { reason: b.reason }, actor);
        target = { type: 'KEY', id: String(Number(b.targetId)) };
        break;
      }
    }
    const row = await db
      .selectFrom('revocations')
      .selectAll()
      .where('target_type', '=', target.type)
      .where('target_id', '=', target.id)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirstOrThrow();
    reply.code(201);
    return revocationJson(row);
  });
};
