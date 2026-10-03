/**
 * Owners: customer accounts for ORBES Client Services (C-04, A-06).
 *
 *   GET  /api/admin/owners                    AUDITOR  accounts, newest first, with their product counts,
 *                                                      a transfer pause after a recovery and an open code;
 *                                                      ?email= one exact email, ?ref= the accounts behind
 *                                                      the REF printed under a result, with its scans
 *   GET  /api/admin/owners/:id                AUDITOR  the owner's sheet: pieces, transfers in progress,
 *                                                      20 latest scans
 *   POST /api/admin/owners/:id/recovery-code  ADMIN    a one-time recovery code, after an identity check
 *   POST /api/admin/owners/:id/lock           ADMIN    LOCKED: sessions end, pending transfers cancelled,
 *                                                      certificate links and open entries in the drops
 *                                                      withdrawn, the open recovery code revoked
 *   POST /api/admin/owners/:id/unlock         ADMIN    ACTIVE again
 *   GET  /api/admin/owners/:id/export         ADMIN    everything held about the account (right of
 *                                                      access), a JSON attachment
 *
 * An AUDITOR reads customers' emails masked (`j***@example.com`); OPERATOR
 * and ADMIN read them in clear (serialize.ts `clientEmail`).
 *
 * The recovery code is in the response once and nowhere else: only its
 * scrypt hash is stored, and the audit entry (`account.recovery_code.issue`)
 * names the account and the code's id. The customer enters it on /verify
 * (POST /api/v1/account/recover, services/account-recovery.ts). The lock,
 * the unlock and the export are audited by services/owners.ts.
 */
import type { FastifyPluginAsync } from 'fastify';
import { emptyBody, ownerListQuery, ownerParams, pageOf, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import type { OwnerSummary } from '../../services/owners.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

function ownerJson(o: OwnerSummary, inClear: boolean) {
  return {
    id: o.id,
    email: clientEmail(o.email, inClear),
    displayName: o.displayName,
    country: o.country,
    status: o.status,
    createdAt: o.createdAt,
    products: o.products,
    productsEver: o.productsEver,
    transfersPausedUntil: o.transfersPausedUntil,
    recoveryCodeExpiresAt: o.recoveryCodeExpiresAt,
    recoveryCodeThrottledUntil: o.recoveryCodeThrottledUntil,
  };
}

export const adminOwnerRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { recovery, owners } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/owners', async (request) => {
    const filter = parse(ownerListQuery, request.query);
    const list = await owners.list(filter, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...list, items: list.items.map((o) => ownerJson(o, inClear)) };
  });

  app.get('/api/admin/owners/:id', async (request) => {
    const { id } = parse(ownerParams, request.params);
    const sheet = await owners.sheet(id);
    return { ...sheet, owner: ownerJson(sheet.owner, readsClientEmails(request)) };
  });

  app.post('/api/admin/owners/:id/recovery-code', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    parse(emptyBody, request.body);
    const issued = await recovery.issue(id, adminActor(request));
    reply.code(201);
    return { recoveryCode: issued.recoveryCode, expiresAt: issued.expiresAt };
  });

  app.post('/api/admin/owners/:id/lock', { config: ADMIN }, async (request) => {
    const { id } = parse(ownerParams, request.params);
    parse(emptyBody, request.body);
    const r = await owners.lock(id, adminActor(request));
    return {
      status: 'LOCKED' as const,
      sessionsRevoked: r.sessionsRevoked,
      transfersCancelled: r.transfersCancelled.length,
      recoveryCodesRevoked: r.recoveryCodesRevoked,
      certificatesRevoked: r.certificatesRevoked,
      dropEntriesWithdrawn: r.dropEntriesWithdrawn,
    };
  });

  app.post('/api/admin/owners/:id/unlock', { config: ADMIN }, async (request) => {
    const { id } = parse(ownerParams, request.params);
    parse(emptyBody, request.body);
    await owners.unlock(id, adminActor(request));
    return { status: 'ACTIVE' as const };
  });

  app.get('/api/admin/owners/:id/export', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    const data = await owners.exportData(id, adminActor(request));
    const day = data.exportedAt.toISOString().slice(0, 10);
    reply
      .header('cache-control', 'no-store')
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="orbes-account-${id.slice(0, 8)}-${day}.json"`);
    return data;
  });
};
