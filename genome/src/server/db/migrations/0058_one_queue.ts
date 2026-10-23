/**
 * 0058 — ONE QUEUE (lot Q1, step Q1.1; ANSWERS CURRENT STATE B1: "Every LIVE release has a pace (X people per batch,
 * every Y min) and a hold after the opening (minutes, 0 = none), both required at creation. Exception: the after-room
 * has no pace."): the single waiting line of a LIVE RELEASE, where each batch of the pace gives TURNS.
 *
 * `drops` gains the hold after the opening:
 *  - `pace_hold_minutes` (smallint NOT NULL DEFAULT 0, 0 to 120: schema.ts LIVE_HOLD_MINUTES; 0, no hold): how long
 *    after T0 the first batch waits, everyone included (`drops_pace_hold_minutes_check`); a hold only with a pace
 *    (`drops_pace_hold`), so never on an after-room and never on a DRAW;
 *  - every LIVE release that is not an after-room carries a pace (`drops_live_paced`; step Q1.2, with the engine and the
 *    console's creation that require one), unless it has ended or was cancelled: those rows of history stay as they are.
 *
 * `live_entries` does not change: 0049's `admitted_at` and `admitted_batch` now mean "given its turn by batch N at the
 * batch's logical time" (0 with no pace, i.e. an after-room; LET IN: the batches so far), and its partial index
 * `live_entries_waiting_admission` (QUEUED and not given a turn yet, in the turns' order) is the waiting queue itself.
 *
 * `up` refuses, naming the count, while an open LIVE release (not an after-room, not ended, not cancelled) has no pace:
 * no unpaced LIVE release existed on 21 Oct, and "if a LIVE release was created on M1 without a pace, ask him" (ANSWERS
 * r8); the owner's runbook checks it read-only before the deploy. On the previous image during the roll-out: it never
 * names `pace_hold_minutes` (its DEFAULT 0 applies). No row is inserted. `down` refuses, naming the count, while a
 * release has a hold (above 0); otherwise it drops the three CHECKs and the column: the schema of 0057 exactly. One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** The hold after the opening, in minutes (schema.ts LIVE_HOLD_MINUTES). */
const HOLD_MIN = 0;
const HOLD_MAX = 120;

/** A hold only with a pace. */
const HOLD = `pace_hold_minutes = 0 OR pace_batch IS NOT NULL`;
/** Every LIVE release that is not an after-room carries a pace, unless it has ended or was cancelled. */
const PACED = `mode <> 'LIVE' OR parent_drop_id IS NOT NULL OR pace_batch IS NOT NULL OR ended_at IS NOT NULL OR cancelled_at IS NOT NULL`;

export const UP: readonly string[] = [
  // An open LIVE release without a pace is not given one here: the owner is asked first (ANSWERS r8).
  `DO $$
   DECLARE unpaced bigint;
   BEGIN
     SELECT count(*) INTO unpaced FROM drops
      WHERE mode = 'LIVE' AND parent_drop_id IS NULL AND pace_batch IS NULL AND ended_at IS NULL AND cancelled_at IS NULL;
     IF unpaced > 0 THEN
       RAISE EXCEPTION 'migration 0058_one_queue cannot be applied: % open LIVE releases have no pace', unpaced;
     END IF;
   END $$`,
  `ALTER TABLE drops ADD COLUMN pace_hold_minutes smallint NOT NULL DEFAULT 0 CONSTRAINT drops_pace_hold_minutes_check CHECK (pace_hold_minutes BETWEEN ${HOLD_MIN} AND ${HOLD_MAX})`,
  `ALTER TABLE drops ADD CONSTRAINT drops_pace_hold CHECK (${HOLD})`,
  `ALTER TABLE drops ADD CONSTRAINT drops_live_paced CHECK (${PACED})`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no hold: refused while a release has one.
  `DO $$
   DECLARE held bigint;
   BEGIN
     SELECT count(*) INTO held FROM drops WHERE pace_hold_minutes > 0;
     IF held > 0 THEN
       RAISE EXCEPTION 'migration 0058_one_queue cannot be rolled back: % releases with a hold after the opening exist', held;
     END IF;
   END $$`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_live_paced`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_pace_hold`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_hold_minutes`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
