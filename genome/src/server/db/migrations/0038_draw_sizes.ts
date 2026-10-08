/**
 * 0038 — Sizes in draws, like a LIVE RELEASE (plan NEXT LOT of 2026-10-07, §3.6.F, step 6.1: « size selection like in
 * live releases, it should not be a diminished version of live releases »; « each size has its own number of pieces at
 * creation (e.g. 16: 3, 17: 5, 18: 4), an entry chooses its size, and the draw ranks every entry once (tier, seniority,
 * seed), then fills each size in that order. One piece per entry »: « Yes, exactly that »).
 *
 * `drop_sizes` (0021, a LIVE RELEASE's sizes) now serves a DRAW too: a draw's sizes are its rows, each `stock` the
 * pieces of that size, 1 to 24 of them as for a LIVE RELEASE; the draw's `quantity` is their sum (kept by
 * services/drops.ts). Its CHECKs already fit: a label of 1 to 12 characters, a position of 1 to 24, 0 to 10 000 pieces.
 *
 * `drop_entries.size_id`: the size an entry chose, a size of its own drop (the composite foreign key
 * `drop_entries_size_fkey` to `drop_sizes (drop_id, id)`, ON DELETE RESTRICT), led by the index
 * `drop_entries_size_idx (drop_id, size_id, status, rank)`, which also serves the counts per size and the draw's fill in
 * rank order. NULL: a draw without sizes (one published before this lot keeps one pool). No CHECK ties a DRAW to sizes:
 * the service requires a size on every entry of a draw that has sizes.
 *
 * No row is written: every entry keeps no size. Compatible with the previous image during the swap: a nullable column it
 * never names. `down` refuses while a published DRAW has sizes (the previous image would draw it as one pool), naming the
 * count, then drops the index, the foreign key and the column: the schema of 0037 exactly (nothing is rolled back in
 * production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside
 * a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `ALTER TABLE drop_entries ADD COLUMN size_id uuid NULL`,
  `ALTER TABLE drop_entries ADD CONSTRAINT drop_entries_size_fkey FOREIGN KEY (drop_id, size_id) REFERENCES drop_sizes (drop_id, id) ON DELETE RESTRICT`,
  `CREATE INDEX drop_entries_size_idx ON drop_entries (drop_id, size_id, status, rank)`,
];

export const DOWN: readonly string[] = [
  // The previous image would draw a published draw with sizes as one pool: refused while any exists.
  `DO $$
   DECLARE draws bigint;
   BEGIN
     SELECT count(*) INTO draws FROM drops d
      WHERE d.mode = 'DRAW' AND d.published_at IS NOT NULL AND EXISTS (SELECT 1 FROM drop_sizes s WHERE s.drop_id = d.id);
     IF draws > 0 THEN
       RAISE EXCEPTION 'migration 0038_draw_sizes cannot be rolled back: % published draws have sizes', draws;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS drop_entries_size_idx`,
  `ALTER TABLE drop_entries DROP CONSTRAINT IF EXISTS drop_entries_size_fkey`,
  `ALTER TABLE drop_entries DROP COLUMN IF EXISTS size_id`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
