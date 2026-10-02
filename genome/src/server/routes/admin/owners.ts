/**
 * Owners: customer accounts for ORBES Client Services (C-04).
 *
 *   GET  /api/admin/owners                    AUDITOR  accounts, newest first, with their product counts,
 *                                                      a transfer pause after a recovery and an open code
 *   POST /api/admin/owners/:id/recovery-code  ADMIN    a one-time recovery code, after an identity check
 *
 * The recovery code is in the response once and nowhere else: only its
 * scrypt hash is stored, and the audit entry (`account.recovery_code.issue`)
 * names the account and the code's id. The customer enters it on /verify
 * (POST /api/v1/account/recover, services/account-recovery.ts).
 */
import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { emptyBody, ownerParams, pageOf, parse } from '../../http/schemas.js';
import { adminActor } from '../../http/sessions.js';
import { makePage, pageOffset } from '../../types.js';
import type { AdminRouteDeps } from './index.js';

export const adminOwnerRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { db, clock } = ctx;
  const { recovery } = ctx.services;
  const ADMIN = { guard: { minRole: 'ADMIN' as const } };

  app.get('/api/admin/owners', async (request) => {
    const page = pageOf(request.query);
    const now = clock();
    const total = await db.selectFrom('accounts').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await db
      .selectFrom('accounts as a')
      .leftJoin('ownership as o', 'o.account_id', 'a.id')
      .select([
        'a.id',
        'a.email',
        'a.display_name',
        'a.country',
        'a.status',
        'a.created_at',
        'a.transfers_frozen_until',
        sql<number>`count(o.id) FILTER (WHERE o.ended_at IS NULL)`.as('current_products'),
        sql<number>`count(o.id)`.as('total_products'),
        // The open recovery code's expiry, while it can still be used (one at most per account).
        sql<Date | null>`(SELECT r.expires_at FROM account_recovery_codes r
                           WHERE r.account_id = a.id AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ${now})`.as('recovery_expires_at'),
      ])
      .groupBy(['a.id', 'a.email', 'a.display_name', 'a.country', 'a.status', 'a.created_at', 'a.transfers_frozen_until'])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id')
      .limit(page.pageSize)
      .offset(pageOffset(page))
      .execute();
    return makePage(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        country: r.country?.trim() ?? null,
        status: r.status,
        createdAt: r.created_at,
        products: Number(r.current_products),
        productsEver: Number(r.total_products),
        // After an assisted recovery: new transfers out of the account are refused until then.
        transfersPausedUntil: r.transfers_frozen_until && r.transfers_frozen_until.getTime() > now.getTime() ? r.transfers_frozen_until : null,
        recoveryCodeExpiresAt: r.recovery_expires_at === null ? null : new Date(r.recovery_expires_at),
      })),
      Number(total.n),
      page,
    );
  });

  app.post('/api/admin/owners/:id/recovery-code', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(ownerParams, request.params);
    parse(emptyBody, request.body);
    const issued = await recovery.issue(id, adminActor(request));
    reply.code(201);
    return { recoveryCode: issued.recoveryCode, expiresAt: issued.expiresAt };
  });
};
