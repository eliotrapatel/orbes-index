/**
 * Signing keys (reads AUDITOR, every change ADMIN). Private keys never pass
 * through here: KeyService talks to the custody provider and only public
 * keys and registry metadata come back.
 */
import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '../../errors.js';
import { emptyBody, keyParams, parse, revokeKeyBody, rotateKeyBody } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { AdminRouteDeps } from './index.js';
import { itemsOf, keyJson } from './serialize.js';

export const adminKeyRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { keys } = ctx;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  const current = async (keyId: number) => {
    const k = await keys.publicKey(keyId);
    if (!k) throw notFound('Key', 'KEY_NOT_FOUND');
    return keyJson(k);
  };

  app.get('/api/admin/keys', async () => itemsOf((await keys.list()).map(keyJson)));

  app.post('/api/admin/keys/rotate', { config: ADMIN }, async (request, reply) => {
    const b = parse(rotateKeyBody, request.body);
    const k = await keys.rotate(adminActor(request), b.kid);
    reply.code(201);
    return keyJson(k);
  });

  app.post('/api/admin/keys/:keyId/retire', { config: ADMIN }, async (request) => {
    const { keyId } = parse(keyParams, request.params);
    parse(emptyBody, request.body);
    await keys.retire(keyId, adminActor(request));
    return current(keyId);
  });

  app.post('/api/admin/keys/:keyId/revoke', { config: ADMIN }, async (request) => {
    const { keyId } = parse(keyParams, request.params);
    const b = parse(revokeKeyBody, request.body);
    await keys.revoke(keyId, { reason: b.reason, ...(b.compromisedAt ? { compromisedAt: b.compromisedAt } : {}) }, adminActor(request));
    return current(keyId);
  });
};
