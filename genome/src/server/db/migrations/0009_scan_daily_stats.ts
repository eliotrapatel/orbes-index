/**
 * 0009 — daily scan statistics (recommendation A-09; DATABASE §5.22 and §10,
 * API §16.10).
 *
 * `scan_daily_stats` counts the scans of each complete UTC day by country,
 * verification state and event type. It is anonymous (no code, product,
 * account, device, IP or session: only the four keys and the count), so it
 * outlives the scan history: housekeeping aggregates every complete day
 * before it purges anything (SCAN_RETENTION_DAYS), and the console's
 * Analytics view reads the trends and the countries from here.
 *
 * - `country`: the scan's ISO 3166-1 alpha-2 country, `ZZ` when unknown;
 * - `result_state`: one of the nine public verification states;
 * - `event_type`: VERIFY, REGISTER or TRANSFER. A staff scan (ADMIN_TEST) is
 *   never counted, so the CHECK leaves it out;
 * - `n`: the number of scans (≥ 0).
 *
 * The primary key leads with `day`, the range every read filters on. No
 * foreign key. An addition the previous application version ignores. One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction. The down step drops the table
 * and nothing else: the schema of the previous migration.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE scan_daily_stats (
     day          date     NOT NULL,
     country      char(2)  NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
     result_state text     NOT NULL CHECK (result_state IN ('AUTHENTIC','AUTHENTIC_FIRST_REGISTRATION','AUTHENTIC_REGISTERED','AUTHENTIC_OWNERSHIP_VERIFIED','SUSPICIOUS_ACTIVITY','REVOKED','UNKNOWN','INVALID_SIGNATURE','MALFORMED_CODE')),
     event_type   text     NOT NULL CHECK (event_type IN ('VERIFY','REGISTER','TRANSFER')),
     n            integer  NOT NULL CHECK (n >= 0),
     PRIMARY KEY (day, country, result_state, event_type)
   )`,
];

export const DOWN: readonly string[] = [`DROP TABLE scan_daily_stats`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
