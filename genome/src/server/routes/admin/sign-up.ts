/**
 * The console's Sign-up page (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.10, step 1.7; API §16.38): the answers to
 * « How did you hear about ORBES? », asked at sign-up and in YOUR PROFILE.
 *
 *   GET   /api/admin/heard-options          AUDITOR  every answer, offered or set aside, in its order (Other last),
 *                                                    with how many counted collectors gave it (test entrants and the
 *                                                    team's own accounts left out)
 *   POST  /api/admin/heard-options          ADMIN    an answer added, last before Other           heard_option.create
 *   PATCH /api/admin/heard-options/:id      ADMIN    renamed, set aside or offered again          heard_option.update
 *   PUT   /api/admin/heard-options/order    ADMIN    the order of every answer but Other          heard_option.order
 *
 * Each answers the whole list as GET reads it. An answer is never deleted, only set aside, so the answers given keep
 * their meaning; Other always stays offered and last; at most 12 are offered at once (services/profiles.ts). The
 * labels are house words, not personal data: their audits carry them.
 */
import type { FastifyPluginAsync } from 'fastify';
import { heardOptionBody, heardOptionParams, heardOptionUpdateBody, heardOrderBody, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

export const adminSignUpRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { profiles } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/heard-options', async () => ({ options: await profiles.heardOptions({ withCounts: true }) }));

  app.post('/api/admin/heard-options', { config: ADMIN }, async (request, reply) => {
    const b = parse(heardOptionBody, request.body);
    const options = await profiles.createHeard({ label: b.label }, adminActor(request));
    reply.code(201);
    return { options };
  });

  app.put('/api/admin/heard-options/order', { config: ADMIN }, async (request) => {
    const b = parse(heardOrderBody, request.body);
    return { options: await profiles.orderHeard(b.ids, adminActor(request)) };
  });

  app.patch('/api/admin/heard-options/:id', { config: ADMIN }, async (request) => {
    const { id } = parse(heardOptionParams, request.params);
    const b = parse(heardOptionUpdateBody, request.body);
    return { options: await profiles.updateHeard(id, b, adminActor(request)) };
  });
};
