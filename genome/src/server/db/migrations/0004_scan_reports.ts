/**
 * 0004 — `scan_reports`: where a customer saw or bought a piece whose scan
 * was not authentic, and the Cases queue of the console that follows it up
 * (C-02, phase 2; API §8.5 and §16.8).
 *
 * One report per scan (`scan_event_id` UNIQUE, which is also the index that
 * leads with the foreign key). The customer gives a channel and, optionally,
 * a place (≤ 200 characters) and a note (≤ 500): free text, hence personal
 * data, kept as long as the scan itself and deleted with it by the
 * scan-history purge (scan-retention.ts deletes reports first: the foreign
 * key is ON DELETE RESTRICT like every other).
 *
 * Case handling: `status` OPEN or CLOSED; a CLOSED case names the admin who
 * closed it (`handled_by`, FK to `admin_users`, indexed), when, and the
 * resolution note. An OPEN case carries none of the three.
 *
 * One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction. The down step drops
 * the table (and its indexes and constraints with it): the schema of 0003.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes with the code);
// test/db/schema.test.ts checks they match REPORT_CHANNELS and REPORT_STATUSES in schema.ts.
const REPORT_CHANNEL = `'BOUTIQUE','ONLINE','PRIVATE','OTHER'`;
const REPORT_STATUS = `'OPEN','CLOSED'`;

export const UP: readonly string[] = [
  `CREATE TABLE scan_reports (
     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     scan_event_id   uuid        NOT NULL UNIQUE REFERENCES scan_events (id) ON DELETE RESTRICT,
     channel         text        NOT NULL CHECK (channel IN (${REPORT_CHANNEL})),
     place           text        NULL CHECK (char_length(place) BETWEEN 1 AND 200),
     note            text        NULL CHECK (char_length(note) BETWEEN 1 AND 500),
     created_at      timestamptz NOT NULL DEFAULT now(),
     status          text        NOT NULL DEFAULT 'OPEN' CHECK (status IN (${REPORT_STATUS})),
     handled_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     handled_at      timestamptz NULL,
     resolution_note text        NULL CHECK (char_length(resolution_note) BETWEEN 1 AND 2000),
     CONSTRAINT scan_reports_handled_consistent CHECK (
       (status = 'OPEN' AND handled_by IS NULL AND handled_at IS NULL AND resolution_note IS NULL)
       OR (status = 'CLOSED' AND handled_by IS NOT NULL AND handled_at IS NOT NULL)
     ),
     CHECK (handled_at IS NULL OR handled_at >= created_at)
   )`,
  `CREATE INDEX scan_reports_handled_by_idx ON scan_reports (handled_by)`,
  // The Cases queue: OPEN (or CLOSED) cases, newest first.
  `CREATE INDEX scan_reports_status_created_idx ON scan_reports (status, created_at)`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS scan_reports`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
