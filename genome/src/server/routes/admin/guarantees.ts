/**
 * THE HOUSE'S GUARANTEE in the console (plan NEXT-NINE of 2026-10-06, §3.3 IN-01; API §16.30): a guaranteed place at a
 * coming release, granted to one client from the client sheet, and the Grant dialog's defaults in Orders → Settings.
 *
 *   POST  /api/admin/owners/:id/guarantees     OPERATOR  Grant a guarantee {scope, targetId, pieces, validUntil (a day
 *                                                         in Paris), visible, note?}: 201, set aside for a release or
 *                                                         waiting for the next one
 *   PATCH /api/admin/guarantees/:id            OPERATOR  Change: its pieces, validity, shown, note
 *   POST  /api/admin/guarantees/:id/revoke     OPERATOR  Revoke {note?}: the client's entry stays as an ordinary entry
 *   GET   /api/admin/drops/:id/guarantees      AUDITOR   a release's guarantees (a draw's or a LIVE RELEASE's), the
 *                                                         clients' emails masked for an AUDITOR
 *   GET   /api/admin/settings/guarantees       AUDITOR   the defaults: valid for (days), pieces, shown to the client
 *   PUT   /api/admin/settings/guarantees       ADMIN     those defaults, changed
 *
 * The client sheet (GET /api/admin/owners/:id) lists the account's guarantees. services/guarantees.ts checks, sets aside
 * and audits each change (`guarantee.grant`, `.update`, `.revoke`, `.settings`): ids, pieces, dates, shown, and whether a
 * note was given, never its words.
 */
import type { FastifyPluginAsync } from 'fastify';
import { grantGuaranteeBody, guaranteeParams, guaranteeSettingsBody, ownerParams, parse, revokeGuaranteeBody, updateGuaranteeBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminReleaseGuarantee } from '../../services/guarantees.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

const ADMIN = { guard: { minRole: 'ADMIN' as const } };

function releaseGuaranteeJson(g: AdminReleaseGuarantee, inClear: boolean): AdminReleaseGuarantee {
  return { ...g, account: { ...g.account, email: clientEmail(g.account.email, inClear) } };
}

export const adminGuaranteeRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { guarantees } = ctx.services;

  app.post('/api/admin/owners/:id/guarantees', async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    const b = parse(grantGuaranteeBody, request.body);
    const out = await guarantees.grant(id, { scope: b.scope, targetId: b.targetId, pieces: b.pieces, validUntil: b.validUntil, visible: b.visible, note: b.note ?? null }, adminActor(request));
    reply.code(201);
    return out;
  });

  app.patch('/api/admin/guarantees/:id', async (request) => {
    const { id } = parse(guaranteeParams, request.params);
    const b = parse(updateGuaranteeBody, request.body);
    return {
      guarantee: await guarantees.update(
        id,
        {
          ...(b.pieces !== undefined ? { pieces: b.pieces } : {}),
          ...(b.validUntil !== undefined ? { validUntil: b.validUntil } : {}),
          ...(b.visible !== undefined ? { visible: b.visible } : {}),
          ...(b.note !== undefined ? { note: b.note } : {}),
        },
        adminActor(request),
      ),
    };
  });

  app.post('/api/admin/guarantees/:id/revoke', async (request) => {
    const { id } = parse(guaranteeParams, request.params);
    const b = parse(revokeGuaranteeBody, request.body);
    return { guarantee: await guarantees.revoke(id, b.note ?? null, adminActor(request)) };
  });

  app.get('/api/admin/drops/:id/guarantees', async (request) => {
    const { id } = parse(guaranteeParams, request.params);
    const inClear = readsClientEmails(request);
    return { items: (await guarantees.forRelease(id)).map((g) => releaseGuaranteeJson(g, inClear)) };
  });

  app.get('/api/admin/settings/guarantees', async () => guarantees.settings());

  app.put('/api/admin/settings/guarantees', { config: ADMIN }, async (request) => {
    const b = parse(guaranteeSettingsBody, request.body);
    return guarantees.saveSettings(b, adminActor(request));
  });
};
