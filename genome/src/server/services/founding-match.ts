/**
 * The founding list's match (plan MACRO M1 §3.1, F3): a pre-registration takes the ORBES account with the same address.
 * Apart from services/founding.ts so that AuthService.registerAccount (services/auth.ts) calls it inside the account's
 * own transaction without importing the founding list's service (which reads auth.ts's normalizeEmail).
 *
 *   - At a sign-up: the unmatched row of the same `email_normalized` takes the new account, in the account's transaction
 *     (both commit or neither). At a registration: the account that already has the address, when there is one.
 *   - Never a test entrant's account (TEST ENTRANTS' pool), never a DELETED one.
 *   - Audited `founding.match` with the pre-registration's id and the account's, never the address (the audit log is
 *     permanent: AuthService's rule).
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { Actor } from '../types.js';
import type { AuditService } from './audit.js';

/** Where a match was made: at the account's sign-up, or at once when the address registered with an account already. */
export type FoundingMatchAt = 'SIGN_UP' | 'REGISTER';

/**
 * The pre-registration of `emailNormalized` still unmatched takes `accountId` at `now`, inside `tx`; its id, or null when
 * there is none (or the account is a test entrant's or DELETED). Audited `founding.match`.
 */
export async function matchPreregistration(
  tx: Db,
  audit: Pick<AuditService, 'record'>,
  input: { accountId: string; emailNormalized: string; now: Date; at: FoundingMatchAt },
  actor: Actor,
): Promise<string | null> {
  const r = await sql<{ id: string }>`
    UPDATE preregistrations p SET account_id = ${input.accountId}::uuid, matched_at = ${input.now}::timestamptz
     WHERE p.email_normalized = ${input.emailNormalized} AND p.account_id IS NULL
       AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = ${input.accountId}::uuid AND a.status <> 'DELETED')
       AND NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = ${input.accountId}::uuid)
    RETURNING p.id`.execute(tx);
  const id = r.rows[0]?.id ?? null;
  if (id === null) return null;
  await audit.record(
    { actor, action: 'founding.match', targetType: 'preregistration', targetId: id, details: { preregistrationId: id, accountId: input.accountId, at: input.at } },
    tx,
  );
  return id;
}
