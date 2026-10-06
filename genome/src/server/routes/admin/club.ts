/**
 * The club in the console (Club page): its Tiers tab (P-X04) and its Requests tab (P-X08, the private salon).
 *
 *   GET   /api/admin/club/tiers                AUDITOR   TITANE, PLATINE and PALLADIUM: the pieces each starts from, its
 *                                                        benefits now and by default, whether the console changed them
 *   PATCH /api/admin/club/tiers/:tier          OPERATOR  a tier's benefits, one per line; null or '' restores the default
 *   GET   /api/admin/club/requests             AUDITOR   the requests of THE PRIVATE SALON, OPEN first, then the newest;
 *                                                        `?status=` OPEN or CLOSED
 *   POST  /api/admin/club/requests/:id/close   OPERATOR  CLOSED, with a note (what was done for the client) and the
 *                                                        outcome: ACCEPTED (its order is created) or DECLINED
 *
 * The thresholds (1, 5 and 10 pieces held now) are a constant of the code and never change here: a setting could
 * contradict the published rule of a draw. services/club.ts validates and audits the tiers (`club.tier.update`),
 * services/salon.ts the requests (`shop.request.close`); these routes parse and shape. An AUDITOR reads the clients'
 * emails masked (`j***@example.com`); OPERATOR and ADMIN read them in clear (serialize.ts `clientEmail`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { closeShopRequestBody, clubTierParams, pageOf, parse, shopRequestParams, shopRequestsQuery, updateClubTierBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminShopRequest } from '../../services/salon.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

function requestJson(r: AdminShopRequest, inClear: boolean) {
  return { ...r, account: { ...r.account, email: clientEmail(r.account.email, inClear) } };
}

export const adminClubRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { club, salon } = ctx.services;

  app.get('/api/admin/club/tiers', async () => ({ items: await club.tiers() }));

  app.patch('/api/admin/club/tiers/:tier', async (request) => {
    const { tier } = parse(clubTierParams, request.params);
    const b = parse(updateClubTierBody, request.body);
    return club.updateTier(tier, b.benefits, adminActor(request));
  });

  // P-X08: the requests of the private salon.
  app.get('/api/admin/club/requests', async (request) => {
    const q = parse(shopRequestsQuery, request.query);
    const page = await salon.list(q.status ? { status: q.status } : {}, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((r) => requestJson(r, inClear)) };
  });

  app.post('/api/admin/club/requests/:id/close', async (request) => {
    const { id } = parse(shopRequestParams, request.params);
    const b = parse(closeShopRequestBody, request.body);
    return requestJson(await salon.close(id, { note: b.note, outcome: b.outcome }, adminActor(request)), readsClientEmails(request));
  });
};
