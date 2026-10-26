/**
 * A demo world told before THE VAULT's deployment (lot Q3, step Q3.6; plan N7, N34, D68 "Sources give from the
 * deployment on"). The seeds (the console's demo, src/server/db/seed/demo.ts; NOCTURNE's, test/support/nocturne-demo.ts)
 * tell a story whose registrations, tiers, profiles and photographs happened before the sources existed: `story` runs
 * with every source switched off, then the tiers held are written in `vault_occasions_before` exactly as migration
 * 0061 wrote them at the deployment (its OCCASIONS_BEFORE_INSERT), and each source is switched back as it was. A
 * status read, an order or a registration afterwards gives a vault only for what happens after, as in production.
 */
import { sql } from 'kysely';
import type { Db } from '../connection.js';
import { OCCASIONS_BEFORE_INSERT } from '../migrations/0061_the_vault.js';

export async function beforeTheVault<T>(db: Db, story: () => Promise<T>): Promise<T> {
  const sources = await db.selectFrom('vault_sources').select(['source', 'enabled']).execute();
  await db.updateTable('vault_sources').set({ enabled: false }).execute();
  try {
    const told = await story();
    await sql.raw(`${OCCASIONS_BEFORE_INSERT} ON CONFLICT DO NOTHING`).execute(db);
    return told;
  } finally {
    for (const s of sources) await db.updateTable('vault_sources').set({ enabled: s.enabled }).where('source', '=', s.source).execute();
  }
}
