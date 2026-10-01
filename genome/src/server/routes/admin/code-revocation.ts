/**
 * Revoking a single code (POST /api/admin/codes/:codeId/revoke and the CODE
 * branch of POST /api/admin/revocations).
 *
 * No service owns this write yet, so it lives next to its routes: one
 * transaction locks the product row then the code row (the same order as
 * code re-issue, so the two cannot deadlock), marks the code REVOKED, opens a
 * `revocations` row and appends the audit entry. A revoked code verifies as
 * REVOKED from then on; the product keeps its identity and can be given a
 * new code with re-issue.
 */
import { inTransaction } from '../../db/connection.js';
import type { CodeRow } from '../../db/schema.js';
import { conflict, notFound } from '../../errors.js';
import { actorLabel } from '../../keys/key-service.js';
import type { AppContext } from '../../context.js';
import type { Actor } from '../../types.js';

export const CODE_REVOKED_REASON_CODE = 'CODE_REVOKED';

export async function revokeCode(ctx: AppContext, codeId: string, reason: string, actor: Actor): Promise<{ code: CodeRow; productId: string }> {
  return inTransaction(ctx.db, async (tx) => {
    const peek = await tx.selectFrom('codes').select('product_id').where('id', '=', codeId).executeTakeFirst();
    if (!peek) throw notFound('Code', 'CODE_NOT_FOUND');
    const product = await tx.selectFrom('products').select(['id', 'product_id']).where('id', '=', peek.product_id).forUpdate().executeTakeFirstOrThrow();
    const code = await tx.selectFrom('codes').selectAll().where('id', '=', codeId).forUpdate().executeTakeFirstOrThrow();
    if (code.status === 'REVOKED') throw conflict('CODE_ALREADY_REVOKED', 'This code is already revoked.');

    const now = ctx.clock();
    const updated = await tx
      .updateTable('codes')
      .set({ status: 'REVOKED', revoked_at: now, revocation_reason: reason })
      .where('id', '=', codeId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('revocations')
      .values({
        target_type: 'CODE',
        target_id: codeId,
        reason_code: CODE_REVOKED_REASON_CODE,
        reason,
        created_by: actorLabel(actor),
        created_at: now,
      })
      .execute();
    await ctx.audit.record(
      {
        actor,
        action: 'code.revoke',
        targetType: 'code',
        targetId: codeId,
        details: { productId: product.product_id, issue: code.issue, keyId: code.key_id, previousStatus: code.status, reason },
      },
      tx,
    );
    return { code: updated, productId: product.product_id };
  });
}
