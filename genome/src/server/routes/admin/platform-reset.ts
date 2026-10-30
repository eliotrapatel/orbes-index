/**
 * PLATFORM RESET and LOCK RESET in the console (lot PURGE, plan §B.4; services/platform-reset.ts): the reset holder's
 * page, its press and LOCK RESET.
 *
 *   GET  /api/admin/platform-reset        ADMIN  the holder: the state and the preview (read only); anyone else { holder: false }
 *        ?part=holder                    ADMIN  { holder: true | false } and nothing else (the Settings page's link; one read)
 *   POST /api/admin/platform-reset        ADMIN  RESET PLATFORM (phrase, password, code, what the page showed): 202
 *   POST /api/admin/platform-reset/lock   ADMIN  LOCK RESET (phrase, password, code): 200, for good
 *
 * The two presses draw on the `auth` budget, as sign-in does (a code is guessed there). The service checks the phrase,
 * the holder and the database's precheck first, verifies the step-up BEFORE its transaction (a wrong code is counted in
 * its own commit) and consumes it INSIDE it, so a code is used only by a press that commits. Answers 400, 403, 409 and
 * 429 with the console's words, Paris time first; never 401 for a wrong secret (the console signs out on a 401): only a
 * session that ended answers 401.
 *
 * After the reset's 202 is SENT (this route's onResponse, never before, never on a refusal), the route asks
 * `ctx.lifecycle.requestPlatformReset`, which only schedules the shutdown and returns (H4): nothing here awaits it.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { userAgentOf } from '../../http/client.js';
import { parse, platformResetBody, platformResetLockBody } from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { ResetRequested } from '../../services/platform-reset.js';
import type { AdminRouteDeps } from './index.js';

export const adminPlatformResetRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };
  const STEP_UP = { guard: { minRole: 'ADMIN' as const }, rateGroup: 'auth' as const };
  const reset = () => ctx.services.platformReset;
  /** The presses whose 202 is being sent: the lifecycle is asked once it is on the wire. */
  const accepted = new WeakMap<FastifyRequest, ResetRequested>();
  /** Who presses: the ADMIN and the session the step-up checks; the hashed address for its audit rows (never the token). */
  const asking = (request: FastifyRequest) => ({
    asker: { actor: adminActor(request), token: requireAdmin(request).token },
    meta: { ipHash: request.orbes.ipHash, userAgent: userAgentOf(request) },
  });

  app.get('/api/admin/platform-reset', { config: ADMIN }, async (request) => {
    const adminId = requireAdmin(request).admin.id;
    // The Settings page's link: whether he is the holder, without the state's and the preview's reads.
    if ((request.query as Record<string, unknown> | undefined)?.part === 'holder') return { holder: await reset().isHolder(adminId) };
    const state = await reset().state(adminId);
    if (!state.holder) return { holder: false };
    return { ...state, preview: state.launched ? null : await reset().preview(adminId) };
  });

  app.post(
    '/api/admin/platform-reset',
    {
      config: STEP_UP,
      onResponse: async (request, reply) => {
        const asked = accepted.get(request);
        accepted.delete(request);
        // Only after a 202 is on the wire; it schedules the shutdown and returns at once (never awaited here, H4).
        if (asked && reply.statusCode === 202) ctx.lifecycle.requestPlatformReset(asked.adminId, asked.collectorsSeen, asked.collectorsSeenUntil);
      },
    },
    async (request, reply) => {
      const b = parse(platformResetBody, request.body);
      const { asker, meta } = asking(request);
      const asked = await reset().request(b, asker, meta);
      accepted.set(request, asked);
      reply.code(202);
      return { restartsIn: asked.restartsIn };
    },
  );

  app.post('/api/admin/platform-reset/lock', { config: STEP_UP }, async (request) => {
    const b = parse(platformResetLockBody, request.body);
    const { asker, meta } = asking(request);
    return reset().lock(b, asker, meta);
  });
};
