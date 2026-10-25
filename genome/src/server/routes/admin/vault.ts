/**
 * THE VAULT in the console (lot Q3, step Q3.9; plan §2.9, §4; vault/SCOPE.md E12 "Console: CLUB > THE VAULT: the
 * table, a switch per source, GIVE A VAULT (collector or segment), the switch on each LIVE release, the report"),
 * services/vault.ts holding every rule:
 *
 *   GET  /api/admin/vault/settings              AUDITOR   the seven sources, the house table in its order, the odds'
 *                                                          sum (`partsGiven` of 1 000 000) and I WAS THERE's published odds
 *   PUT  /api/admin/vault/sources/:source       ADMIN     a source's switch, vaults per occasion and cap (D27, OP-29)
 *                                                                                  vault.settings
 *   POST /api/admin/vault/rewards               OPERATOR  a row of the table (201)  vault.reward.create
 *   PUT  /api/admin/vault/rewards/:id           OPERATOR  a row whole for its kind  vault.reward.update
 *   POST /api/admin/vault/rewards/:id/deactivate OPERATOR a row set aside (never deleted once given)
 *                                                                                  vault.reward.deactivate
 *   POST /api/admin/vault/rewards/order         OPERATOR  every row once, in its new order
 *                                                                                  vault.reward.order
 *   POST /api/admin/vault/give                  OPERATOR  GIVE A VAULT to one collector; to a segment an ADMIN; `dryRun`:
 *                                                          the reach and the left out (test entrants, inactive), nothing
 *                                                          given                       vault.give (each vault)
 *   GET  /api/admin/vault/report?from&to        AUDITOR   the period's vaults by source and state, the rewards won by kind
 *                                                          and by row with their value and cost, the quantities left
 *   GET  /api/admin/vault/vaults?account=       AUDITOR   a client's vaults for the client sheet, read-only
 *
 * The switch on each LIVE release is PUT /api/admin/live/:id/vault (routes/admin/live.ts) and a model's VAULT ONLY PUT
 * /api/admin/models/:id/vault-only (routes/admin/catalog.ts). No route takes a vault back (N36): only a returned piece
 * does (services/order-cases.ts, `vault.revoke`, the system as actor); POST /api/admin/vault/vaults/:id/revoke answers
 * 404 as any unknown route. Errors: 404 VAULT_SOURCE_NOT_FOUND, VAULT_REWARD_NOT_FOUND, ACCOUNT_NOT_FOUND,
 * SEGMENT_NOT_FOUND, MODEL_NOT_FOUND, ADDON_NOT_FOUND; 409 VAULT_ODDS_OVER, VAULT_REWARD_SERVICE (a SERVICE add-on as a
 * reward), VAULT_EDITION_MODEL, VAULT_ONLY_PRODUCT, VAULT_FLOOR_FIXED, VAULT_SOURCE_OFF; 422 PERIOD_INVALID; each in
 * the console's words. No reply carries a client's email (the client sheet names the account); the staff member who
 * gave a vault reads as every console login does. Never stored by a cache. RETAIL and LOGISTICS get 403. Every mutation
 * needs the CSRF token and a same-origin request, and is audited by the service: never a note, never an email.
 */
import type { FastifyPluginAsync } from 'fastify';
import { forbidden } from '../../errors.js';
import { adminVaultsQuery, emptyBody, parse, vaultGiveBody, vaultReportQuery, vaultRewardBody, vaultRewardOrderBody, vaultRewardParams, vaultRewardUpdateBody, vaultSourceBody, vaultSourceParams } from '../../http/schemas.js';
import { adminActor, hasRole, requireAdmin } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };
const ADMIN = { guard: { minRole: 'ADMIN' as const } };

export const adminVaultRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { vault } = ctx.services;
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/api/admin/vault/settings', async () => vault.settings());

  app.put('/api/admin/vault/sources/:source', { config: ADMIN }, async (request) => {
    const { source } = parse(vaultSourceParams, request.params);
    const b = parse(vaultSourceBody, request.body);
    return vault.setSource(source, b, adminActor(request));
  });

  app.post('/api/admin/vault/rewards', { config: OPERATOR }, async (request, reply) => {
    const b = parse(vaultRewardBody, request.body);
    const settings = await vault.createReward(b, adminActor(request));
    reply.code(201);
    return settings;
  });

  app.put('/api/admin/vault/rewards/:id', { config: OPERATOR }, async (request) => {
    const { id } = parse(vaultRewardParams, request.params);
    const b = parse(vaultRewardUpdateBody, request.body);
    return vault.updateReward(id, b, adminActor(request));
  });

  app.post('/api/admin/vault/rewards/:id/deactivate', { config: OPERATOR }, async (request) => {
    const { id } = parse(vaultRewardParams, request.params);
    parse(emptyBody, request.body);
    return vault.deactivateReward(id, adminActor(request));
  });

  app.post('/api/admin/vault/rewards/order', { config: OPERATOR }, async (request) => {
    const b = parse(vaultRewardOrderBody, request.body);
    return vault.orderRewards(b.ids, adminActor(request));
  });

  // GIVE A VAULT (§4.4; D3 (7)): one collector by an OPERATOR, a segment by an ADMIN (as the house messages' audience).
  app.post('/api/admin/vault/give', { config: OPERATOR }, async (request) => {
    const b = parse(vaultGiveBody, request.body);
    if (b.segmentId !== undefined && !hasRole(requireAdmin(request).admin.role, 'ADMIN')) throw forbidden('Only an ADMIN gives a vault to a segment.');
    return vault.giveFromHouse(b, adminActor(request));
  });

  app.get('/api/admin/vault/report', async (request) => vault.report(parse(vaultReportQuery, request.query)));

  app.get('/api/admin/vault/vaults', async (request) => {
    const { account } = parse(adminVaultsQuery, request.query);
    return { items: await vault.forConsole(account) };
  });
};
