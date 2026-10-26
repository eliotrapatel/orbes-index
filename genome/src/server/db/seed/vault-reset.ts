/**
 * `db reset-demo` and THE VAULT (lot Q3, step Q3.A). reset-demo rolls every migration back, newest first; the down
 * steps of 0062_vault_rewards and 0061_the_vault refuse while anything the previous image cannot keep exists (VAULT
 * credits, VAULT orders, LIVE guarantees, VAULT add-on units, credits to give, offers; vaults, invitations, invited
 * accounts, VAULT house messages, rewards other than the I WAS THERE floor, sources away from OP-29's defaults,
 * releases with their vault on, vault-only models). The demo seed itself writes the reference's example rewards (D26),
 * so a demo database always holds some.
 *
 * Production keeps those guards as they are. reset-demo, once its demo (or --force) check has passed and just before
 * its rollbacks, clears here exactly what they count, in one transaction: each counted row is deleted with every row
 * that refers to it (found through the schema's foreign keys, so a VAULT order's events, invoices or stock movements
 * go with it), in one statement (a vault and what it gave refer to each other); an invited account forgets its
 * inviter; the sources go back to OP-29's defaults, each release's switch and each model's VAULT ONLY off. The tables'
 * own guards (no delete, written once) are switched off for that transaction only; their foreign keys stay checked.
 * Everything cleared would be dropped by the rollbacks that follow anyway.
 */
import { sql } from 'kysely';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';

const THE_VAULT = '0061_the_vault';
const VAULT_REWARDS = '0062_vault_rewards';

/** What 0061's down guard counts as rows (its settings are put back below). */
const SEEDS_0061: readonly (readonly [table: string, where: string])[] = [
  ['vaults', 'true'],
  ['invitations', 'true'],
  ['house_deliveries', `source = 'VAULT'`],
  ['vault_rewards', `kind <> 'I_WAS_THERE'`],
];
/** What 0062's down guard counts (its vault offers go with the vaults). */
const SEEDS_0062: readonly (readonly [table: string, where: string])[] = [
  ['tier_grants', `kind = 'VAULT'`],
  ['orders', `channel = 'VAULT'`],
  ['house_guarantees', `scope = 'LIVE'`],
  ['order_addon_items', `added_by_type = 'VAULT'`],
  ['vault_gifts', 'true'],
];

interface ForeignKey {
  src: string;
  dst: string;
  pairs: string[];
}

/** Clears what THE VAULT's down guards count, when its migrations are applied (`applied`: the names applied). */
export async function clearTheVaultForReset(db: Db, applied: readonly string[]): Promise<{ deleted: Record<string, number> }> {
  if (!applied.includes(THE_VAULT)) return { deleted: {} };
  const seeds = [...SEEDS_0061, ...(applied.includes(VAULT_REWARDS) ? SEEDS_0062 : [])];
  return inTransaction(db, async (tx) => {
    await sql`CREATE TEMP TABLE reset_vault_doomed (tbl text NOT NULL, tid tid NOT NULL, PRIMARY KEY (tbl, tid)) ON COMMIT DROP`.execute(tx);
    for (const [table, where] of seeds) {
      await sql.raw(`INSERT INTO reset_vault_doomed (tbl, tid) SELECT '${table}', ctid FROM ${table} WHERE ${where} ON CONFLICT DO NOTHING`).execute(tx);
    }

    // Every row that refers to a row going, until none is left out.
    const fks = (
      await sql<ForeignKey>`
        SELECT c.conrelid::regclass::text AS src, c.confrelid::regclass::text AS dst,
               array_agg(format('s.%I = d.%I', a.attname, b.attname) ORDER BY k.i) AS pairs
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace AND n.nspname = current_schema()
          CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(src_att, dst_att, i)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.src_att
          JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.dst_att
         WHERE c.contype = 'f'
         GROUP BY c.oid, c.conrelid, c.confrelid`.execute(tx)
    ).rows;
    for (let pass = 0; pass < 100; pass++) {
      let added = 0;
      const going = new Set((await sql<{ tbl: string }>`SELECT DISTINCT tbl FROM reset_vault_doomed`.execute(tx)).rows.map((r) => r.tbl));
      for (const fk of fks) {
        if (!going.has(fk.dst)) continue;
        const r = await sql
          .raw(
            `INSERT INTO reset_vault_doomed (tbl, tid)
             SELECT '${fk.src}', s.ctid FROM ${fk.src} s JOIN ${fk.dst} d ON ${fk.pairs.join(' AND ')}
              WHERE d.ctid IN (SELECT tid FROM reset_vault_doomed WHERE tbl = '${fk.dst}')
             ON CONFLICT DO NOTHING RETURNING 1`,
          )
          .execute(tx);
        added += r.rows.length;
      }
      if (added === 0) break;
      if (pass === 99) throw new Error('reset-demo: the rows referring to THE VAULT’s could not be gathered');
    }

    const counts = (await sql<{ tbl: string; n: string | number }>`SELECT tbl, count(*) AS n FROM reset_vault_doomed GROUP BY tbl ORDER BY tbl`.execute(tx)).rows;
    const touched = [...new Set([...counts.map((c) => c.tbl), 'accounts', 'vault_sources', 'drops', 'models'])];
    for (const table of touched) await sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER USER`).execute(tx);
    if (counts.length > 0) {
      // One statement: a vault and what it gave refer to each other, so neither can go first.
      const ctes = counts.map((c, i) => `d${i} AS (DELETE FROM ${c.tbl} WHERE ctid IN (SELECT tid FROM reset_vault_doomed WHERE tbl = '${c.tbl}'))`);
      await sql.raw(`WITH ${ctes.join(', ')} SELECT 1`).execute(tx);
    }
    await sql`UPDATE accounts SET invited_by = NULL, invited_at = NULL WHERE invited_by IS NOT NULL`.execute(tx);
    await sql`UPDATE vault_sources SET enabled = true, per_occasion = 1, cap = CASE WHEN source = 'HOUSE' THEN NULL ELSE 1 END
               WHERE NOT enabled OR per_occasion <> 1 OR cap IS DISTINCT FROM (CASE WHEN source = 'HOUSE' THEN NULL ELSE 1 END)`.execute(tx);
    await sql`UPDATE drops SET vault_on = false WHERE vault_on`.execute(tx);
    await sql`UPDATE models SET vault_only = false WHERE vault_only`.execute(tx);
    for (const table of touched) await sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER USER`).execute(tx);
    return { deleted: Object.fromEntries(counts.map((c) => [c.tbl, Number(c.n)])) };
  });
}
