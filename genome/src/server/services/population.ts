/**
 * Who is counted: the customer intelligence lot's one rule (plan CUSTOMER INTELLIGENCE §3.0 (d), §3.6 C.3, step 0.2).
 *
 *   notTestEntrant(column)   the account is not one of the test entrants' pool (`test_entrants`). Moved here from
 *               `growth.ts`, which imports it: the same SQL, GROWTH's figures unchanged.
 *   houseAccount(column)     the account is one of the team's own: its `email_normalized` is the `email_normalized` of
 *               a console login (`admin_users`, active or disabled). `HouseAccounts` keeps the same set of emails in
 *               memory for 5 minutes (HOUSE_ACCOUNTS_CACHE_MS), for the paths that must not read the database each
 *               time (the recording's ingestion).
 *   countedCollector(column) a counted collector: not DELETED, not a test entrant, not a team account. LOCKED accounts
 *               are counted (they are still collectors, as GROWTH counts them).
 *
 * Every figure of the lot reads `countedCollector`. Segments keep today's rule (ACTIVE accounts, test entrants and
 * team accounts included: a segment is not a figure), a client sheet shows everything, and GROWTH is unchanged (it
 * reads `notTestEntrant` only, and still counts the team's accounts).
 *
 * `column` names a column holding an account id (`accounts.id`, `o.account_id`…), as `sql.ref` reads it.
 */
import { sql, type RawBuilder } from 'kysely';
import type { Db } from '../db/connection.js';
import { systemClock, type Clock } from '../types.js';

/** How long `HouseAccounts` keeps the console logins' emails before reading them again. */
export const HOUSE_ACCOUNTS_CACHE_MS = 5 * 60_000;

/** The account in `column` is not one of the test entrants' pool (TEST ENTRANTS: never counted by GROWTH). */
export const notTestEntrant = (column: string): RawBuilder<unknown> => sql`NOT EXISTS (SELECT 1 FROM test_entrants te WHERE te.account_id = ${sql.ref(column)})`;

/** The account in `column` is one of the team's own: its email is a console login's, active or disabled. */
export const houseAccount = (column: string): RawBuilder<unknown> =>
  sql`EXISTS (SELECT 1 FROM accounts ha JOIN admin_users hau ON hau.email_normalized = ha.email_normalized WHERE ha.id = ${sql.ref(column)})`;

/** The account in `column` is a counted collector: not DELETED, not a test entrant, not one of the team's own. */
export const countedCollector = (column: string): RawBuilder<unknown> =>
  sql`(EXISTS (SELECT 1 FROM accounts ca WHERE ca.id = ${sql.ref(column)} AND ca.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM admin_users cau WHERE cau.email_normalized = ca.email_normalized)) AND ${notTestEntrant(column)})`;

/**
 * The console logins' normalized emails (active or disabled), read at most once every HOUSE_ACCOUNTS_CACHE_MS. A
 * failed read is not kept: the next call reads again. Two calls while a read runs share it.
 */
export class HouseAccounts {
  private emails: ReadonlySet<string> | null = null;
  private readAt = 0;
  private reading: Promise<ReadonlySet<string>> | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock = systemClock,
  ) {}

  /** The set, read again once it is HOUSE_ACCOUNTS_CACHE_MS old. */
  async all(): Promise<ReadonlySet<string>> {
    if (this.emails && this.clock().getTime() - this.readAt < HOUSE_ACCOUNTS_CACHE_MS) return this.emails;
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  /** Whether an account's `email_normalized` is a console login's: one of the team's own accounts. */
  async isHouseEmail(emailNormalized: string): Promise<boolean> {
    return (await this.all()).has(emailNormalized);
  }

  /** Forget the set: the next call reads it again. */
  invalidate(): void {
    this.emails = null;
  }

  private async read(): Promise<ReadonlySet<string>> {
    const at = this.clock().getTime();
    const rows = await this.db.selectFrom('admin_users').select('email_normalized').execute();
    this.emails = new Set(rows.map((r) => r.email_normalized));
    this.readAt = at;
    return this.emails;
  }
}
