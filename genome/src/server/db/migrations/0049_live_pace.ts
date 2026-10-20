/**
 * 0049 — the LIVE waiting room's pace (macro scope of 2026-10-20, W4; lot M1, step M1.1): a LIVE RELEASE may admit its
 * line at a fixed pace, X buyers every Y minutes, counted across the whole release; inside the room, the turns per size,
 * the holds and the pay windows do not change.
 *
 * `drops` gains the pace, LIVE only:
 *  - `pace_batch` (1 to 5 000, the X) and `pace_minutes` (1 to 60, the Y): both or neither (`drops_pace`); neither is
 *    no pace, everyone admitted at T0 as before this migration; set only on a LIVE release that is not an after-room
 *    (an after-room's guests have their own line);
 *  - `pace_paused_at`, the pace's own pause in progress, and `pace_next_at`, when the next batch is due: only with a
 *    pace (`drops_pace_state`);
 *  - `pace_batches` (≥ 0, NOT NULL DEFAULT 0): the batches admitted so far; above 0 only with a pace, so a pace that has
 *    admitted a batch is never taken away (`drops_pace`).
 *
 * `live_entries` gains its admission: `admitted_at` (the batch's logical time, or the line's time with no pace) and
 * `admitted_batch` (≥ 0: 0 with no pace or before the first batch, by LET IN), both or neither, and only for an entry
 * with a place in the line (`live_entries_admitted`). `live_entries_waiting_admission` (drop, guarantee first, place),
 * partial on the QUEUED entries not admitted yet, serves the next batch in the line's order (`guarantee_id IS NULL,
 * position`, the order of the turns) and the queue's place and figures.
 *
 * On the previous image during the roll-out: it never names the new columns, so a release it writes has no pace and
 * `pace_batches` 0, and an entry it writes is not admitted; it gives turns without reading the admission, as with no
 * pace. No row is inserted. `down` refuses, naming the counts, while any release has a pace or any entry has been
 * admitted by a batch (above 0); otherwise it drops the index, the CHECKs and the seven columns: the schema of 0048
 * exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside
 * a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
/** X, the buyers admitted per batch (schema.ts LIVE_PACE_BATCH). */
const BATCH_MIN = 1;
const BATCH_MAX = 5000;
/** Y, the minutes between two batches (schema.ts LIVE_PACE_MINUTES). */
const MINUTES_MIN = 1;
const MINUTES_MAX = 60;

/** X and Y both or neither; a pace on a LIVE release that is not an after-room only; batches admitted only with a pace. */
const PACE = `(pace_batch IS NULL) = (pace_minutes IS NULL)
     AND (pace_batch IS NULL OR (mode = 'LIVE' AND parent_drop_id IS NULL))
     AND (pace_batches = 0 OR pace_batch IS NOT NULL)`;
/** The pace's pause and its next batch only with a pace. */
const PACE_STATE = `pace_batch IS NOT NULL OR (pace_paused_at IS NULL AND pace_next_at IS NULL)`;
/** Admitted with its batch, both or neither, and only with a place in the line. */
const ADMITTED = `(admitted_at IS NULL) = (admitted_batch IS NULL) AND (admitted_at IS NULL OR position IS NOT NULL)`;

export const UP: readonly string[] = [
  // ── drops: the pace ──────────────────────────────────────────────────────
  `ALTER TABLE drops ADD COLUMN pace_batch integer NULL CONSTRAINT drops_pace_batch_check CHECK (pace_batch BETWEEN ${BATCH_MIN} AND ${BATCH_MAX})`,
  `ALTER TABLE drops ADD COLUMN pace_minutes smallint NULL CONSTRAINT drops_pace_minutes_check CHECK (pace_minutes BETWEEN ${MINUTES_MIN} AND ${MINUTES_MAX})`,
  `ALTER TABLE drops ADD COLUMN pace_paused_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN pace_next_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN pace_batches integer NOT NULL DEFAULT 0 CONSTRAINT drops_pace_batches_check CHECK (pace_batches >= 0)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_pace CHECK (${PACE})`,
  `ALTER TABLE drops ADD CONSTRAINT drops_pace_state CHECK (${PACE_STATE})`,

  // ── live_entries: the admission ──────────────────────────────────────────
  `ALTER TABLE live_entries ADD COLUMN admitted_at timestamptz NULL`,
  `ALTER TABLE live_entries ADD COLUMN admitted_batch integer NULL CONSTRAINT live_entries_admitted_batch_check CHECK (admitted_batch >= 0)`,
  `ALTER TABLE live_entries ADD CONSTRAINT live_entries_admitted CHECK (${ADMITTED})`,
  // The next batch, in the line's order: the guarantees first, then the places.
  `CREATE INDEX live_entries_waiting_admission ON live_entries (drop_id, (guarantee_id IS NULL), position) WHERE status = 'QUEUED' AND admitted_at IS NULL`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no pace: refused while a release has one or an entry was admitted by a batch.
  `DO $$
   DECLARE paced bigint; admitted bigint;
   BEGIN
     SELECT count(*) INTO paced FROM drops WHERE pace_batch IS NOT NULL;
     SELECT count(*) INTO admitted FROM live_entries WHERE admitted_batch > 0;
     IF paced > 0 OR admitted > 0 THEN
       RAISE EXCEPTION 'migration 0049_live_pace cannot be rolled back: % paced releases and % entries admitted by a batch exist', paced, admitted;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS live_entries_waiting_admission`,
  `ALTER TABLE live_entries DROP CONSTRAINT IF EXISTS live_entries_admitted`,
  `ALTER TABLE live_entries DROP COLUMN IF EXISTS admitted_batch`,
  `ALTER TABLE live_entries DROP COLUMN IF EXISTS admitted_at`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_pace_state`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_pace`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_batches`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_next_at`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_paused_at`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_minutes`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS pace_batch`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
