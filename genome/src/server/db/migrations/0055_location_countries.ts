/**
 * 0055 — the countries each location serves (macro scope of 2026-10-20, K11 Z1; lot M3 plan §3.2, step M3.5): when staff
 * order a model by size, a collector counts at the location that serves their country (their default address's, else
 * their profile's), and a country no location serves counts at the default location. Orders → Settings → Locations sets
 * them (M3.7); a future Shopify store routes its orders by country through each location's `shopify_location_id` and
 * follows the same map (S3, S4).
 *
 * `stock_location_countries`: one row per country served.
 *  - `country` (ISO 3166-1 alpha-2, two capital letters) is the primary key: each country is served by one location at
 *    most; moving a country to another location changes its `location_id`, never its country
 *    (`stock_location_countries_immutable_country`);
 *  - `location_id` the location that serves it (`stock_locations`, ON DELETE RESTRICT, indexed);
 *  - `updated_by` the ADMIN who set it last (NULL for a script), `updated_at` stamped on every update
 *    (`orbes_touch_updated_at`).
 *
 * On the previous image (0054) during the roll-out: a table it never reads. No row is inserted: until staff set them,
 * every collector counts at the default location. `down` refuses while a country is served, naming the count; otherwise
 * it drops the table: the schema of 0054 exactly. One statement per array entry (PGlite's extended protocol); Kysely's
 * Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE stock_location_countries (
     country     char(2)     PRIMARY KEY CONSTRAINT stock_location_countries_country_check CHECK (country ~ '^[A-Z]{2}$'),
     location_id uuid        NOT NULL CONSTRAINT stock_location_countries_location_id_fkey REFERENCES stock_locations (id) ON DELETE RESTRICT,
     updated_by  uuid        NULL CONSTRAINT stock_location_countries_updated_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX stock_location_countries_location_idx ON stock_location_countries (location_id)`,
  `CREATE INDEX stock_location_countries_updated_by_idx ON stock_location_countries (updated_by)`,
  `CREATE TRIGGER stock_location_countries_immutable_country BEFORE UPDATE ON stock_location_countries
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('country')`,
  `CREATE TRIGGER stock_location_countries_touch_updated_at BEFORE UPDATE ON stock_location_countries
     FOR EACH ROW EXECUTE FUNCTION orbes_touch_updated_at()`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no country served: refused while any would be lost.
  `DO $$
   DECLARE countries_n bigint;
   BEGIN
     SELECT count(*) INTO countries_n FROM stock_location_countries;
     IF countries_n > 0 THEN
       RAISE EXCEPTION 'migration 0055_location_countries cannot be rolled back: % countries served by a location exist', countries_n;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS stock_location_countries`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
