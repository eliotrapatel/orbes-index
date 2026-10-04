/**
 * The tiers of the club (P-X04): the console's Club page, its Tiers tab.
 *
 *   GET   /api/admin/club/tiers         AUDITOR   TITANE, PLATINE and PALLADIUM: the pieces each starts from, its
 *                                                 benefits now and by default, whether the console changed them
 *   PATCH /api/admin/club/tiers/:tier   OPERATOR  a tier's benefits, one per line; null or '' restores the default
 *
 * The thresholds (1, 3 and 5 pieces held now) are a constant of the code and never change here: a setting could
 * contradict the published rule of a draw. services/club.ts validates and audits (`club.tier.update`); these routes
 * parse and shape. Nothing personal is read or written.
 */
import type { FastifyPluginAsync } from 'fastify';
import { clubTierParams, parse, updateClubTierBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

export const adminClubRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { club } = ctx.services;

  app.get('/api/admin/club/tiers', async () => ({ items: await club.tiers() }));

  app.patch('/api/admin/club/tiers/:tier', async (request) => {
    const { tier } = parse(clubTierParams, request.params);
    const b = parse(updateClubTierBody, request.body);
    return club.updateTier(tier, b.benefits, adminActor(request));
  });
};
