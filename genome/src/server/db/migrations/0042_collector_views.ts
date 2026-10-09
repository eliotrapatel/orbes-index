/**
 * 0042 — What they look at, the device and the place (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.6, step 3.1): the
 * lot's third migration, after 0041_account_wishes. Ten tables the previous image never names; no row inserted (the one
 * row of `tracking_state` is written by TrackingService.prepare at the first boot, never here).
 *
 * `geo_places`: the dictionary of places from the connection, a country with or without a city (one row each,
 * `geo_places_key`, NULLS NOT DISTINCT), never deleted. An integer identity, so the raw rows stay small.
 *
 * `tracking_devices`: one row per remembered device, keyed by the pseudonym of the existing `__Host-orbes_device` cookie
 * (`pseudonymize(IP_HASH_PEPPER, 'device', id)`, 43 characters, as `scan_events.device_hash` holds it; the id itself
 * never reaches the database). Its class (kind, system, browser, opened in and the app, in_app exactly when IN_APP), the
 * account it was last linked to (with when, both or neither), its last place, its console mark `staff_at`, its first
 * and last sight. Its identity, hash and first sight never change (`tracking_devices_immutable`).
 *
 * `tracking_device_accounts`: every account a device was linked to, how first (SIGN_UP, SIGN_IN, SESSION), when first
 * and last, and how many times. Kept for good.
 *
 * `collector_views`: the raw views and scans, kept 13 months then folded. A bigint identity; the view's start (server
 * clock), its device, its account (the session's, or the one it was linked to later), its page code (1 to 60; the codes
 * are schema.ts `VIEW_PAGES`, 1 = SCAN), its subject (a model, a release or a post: a log, so no foreign key), its
 * seconds (0 to 10 800; a SCAN has none, every other view 1 or more: `collector_views_timed`) and its place (no foreign
 * key: places are never deleted). A b-tree on `at`, not BRIN: once the purge frees old pages and new rows reuse them, a
 * BRIN range would span the whole 13 months and every day's read would scan the table.
 *
 * `view_daily_stats` and `device_daily_stats`: the anonymous daily totals by Paris day, kept for good (as
 * `scan_daily_stats`); page 0 is a day's marker row. `collector_places`: each collector's places, by Paris days, kept for
 * good. `collector_view_totals`: the per-collector summary of what is past 13 months. `collector_view_months`: the
 * per-collector summary by Paris month. `tracking_state`: one row, the recording's start and the past scans' keyset
 * watermark (`scans_after_at` and `scans_after_id` both or neither).
 *
 * Every foreign key leads a full index, ON DELETE RESTRICT like every other. No partition: the app's role cannot create
 * or drop tables. `down` drops the ten tables, newest first: the schema of 0041 exactly (nothing is rolled back in
 * production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts and migrations.test.ts
// check they match schema.ts.
const DEVICE_KINDS = `'PHONE','TABLET','COMPUTER','UNKNOWN'`;
const DEVICE_SYSTEMS = `'IOS','ANDROID','MACOS','WINDOWS','CHROMEOS','LINUX','OTHER'`;
const DEVICE_BROWSERS = `'SAFARI','CHROME','FIREFOX','EDGE','SAMSUNG','OPERA','WEBVIEW','OTHER'`;
const OPENED_IN = `'BROWSER','IN_APP','HOME_SCREEN'`;
const IN_APPS = `'INSTAGRAM','TIKTOK','FACEBOOK','THREADS','SNAPCHAT','PINTEREST','LINKEDIN','GOOGLE','WECHAT','LINE','OTHER'`;
const LINK_VIAS = `'SIGN_UP','SIGN_IN','SESSION'`;
/** The nil uuid: no subject, in the summaries' keys. */
const NIL_UUID = `'00000000-0000-0000-0000-000000000000'`;
const COUNTRY = (column: string) => `${column} ~ '^[A-Z]{2}$'`;

export const UP: readonly string[] = [
  // ── geo_places ───────────────────────────────────────────────────────────
  `CREATE TABLE geo_places (
     id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     country char(2) NOT NULL CONSTRAINT geo_places_country_check CHECK (${COUNTRY('country')}),
     city    text    NULL CONSTRAINT geo_places_city_check CHECK (city IS NULL OR (char_length(city) BETWEEN 1 AND 80 AND city = btrim(city))),
     CONSTRAINT geo_places_key UNIQUE NULLS NOT DISTINCT (country, city)
   )`,

  // ── tracking_devices ─────────────────────────────────────────────────────
  `CREATE TABLE tracking_devices (
     id            integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     device_hash   text        NOT NULL CONSTRAINT tracking_devices_device_hash_key UNIQUE
                               CONSTRAINT tracking_devices_device_hash_check CHECK (device_hash ~ '^[A-Za-z0-9_-]{43}$'),
     kind          text        NOT NULL DEFAULT 'UNKNOWN' CONSTRAINT tracking_devices_kind_check CHECK (kind IN (${DEVICE_KINDS})),
     os            text        NOT NULL DEFAULT 'OTHER' CONSTRAINT tracking_devices_os_check CHECK (os IN (${DEVICE_SYSTEMS})),
     browser       text        NOT NULL DEFAULT 'OTHER' CONSTRAINT tracking_devices_browser_check CHECK (browser IN (${DEVICE_BROWSERS})),
     opened_in     text        NOT NULL DEFAULT 'BROWSER' CONSTRAINT tracking_devices_opened_in_check CHECK (opened_in IN (${OPENED_IN})),
     in_app        text        NULL CONSTRAINT tracking_devices_in_app_check CHECK (in_app IN (${IN_APPS})),
     account_id    uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     linked_at     timestamptz NULL,
     last_place_id integer     NULL REFERENCES geo_places (id) ON DELETE RESTRICT,
     staff_at      timestamptz NULL,
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT tracking_devices_app    CHECK ((opened_in = 'IN_APP') = (in_app IS NOT NULL)),
     CONSTRAINT tracking_devices_linked CHECK ((account_id IS NULL) = (linked_at IS NULL)),
     CONSTRAINT tracking_devices_seen   CHECK (last_seen_at >= first_seen_at)
   )`,
  `CREATE INDEX tracking_devices_account_idx ON tracking_devices (account_id)`,
  `CREATE INDEX tracking_devices_place_idx ON tracking_devices (last_place_id)`,
  // The 13-month purge of unlinked devices.
  `CREATE INDEX tracking_devices_seen_idx ON tracking_devices (last_seen_at)`,
  `CREATE TRIGGER tracking_devices_immutable BEFORE UPDATE ON tracking_devices
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'device_hash', 'first_seen_at')`,

  // ── tracking_device_accounts ─────────────────────────────────────────────
  `CREATE TABLE tracking_device_accounts (
     device_id       integer     NOT NULL REFERENCES tracking_devices (id) ON DELETE RESTRICT,
     account_id      uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     first_via       text        NOT NULL CONSTRAINT tracking_device_accounts_first_via_check CHECK (first_via IN (${LINK_VIAS})),
     first_linked_at timestamptz NOT NULL,
     last_linked_at  timestamptz NOT NULL,
     links           integer     NOT NULL DEFAULT 1 CONSTRAINT tracking_device_accounts_links_check CHECK (links >= 1),
     PRIMARY KEY (device_id, account_id),
     CONSTRAINT tracking_device_accounts_linked CHECK (last_linked_at >= first_linked_at)
   )`,
  `CREATE INDEX tracking_device_accounts_account_idx ON tracking_device_accounts (account_id)`,

  // ── collector_views ──────────────────────────────────────────────────────
  `CREATE TABLE collector_views (
     id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     at         timestamptz NOT NULL,
     device_id  integer     NOT NULL REFERENCES tracking_devices (id) ON DELETE RESTRICT,
     account_id uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     page       smallint    NOT NULL CONSTRAINT collector_views_page_check CHECK (page BETWEEN 1 AND 60),
     subject    uuid        NULL,
     seconds    smallint    NOT NULL CONSTRAINT collector_views_seconds_check CHECK (seconds BETWEEN 0 AND 10800),
     place_id   integer     NULL,
     CONSTRAINT collector_views_timed CHECK (page = 1 OR seconds >= 1)
   )`,
  // The daily count, the monthly fold, the purge, the panels: a b-tree, not BRIN.
  `CREATE INDEX collector_views_at_idx ON collector_views (at)`,
  // The link (a device's anonymous rows), the foreign key.
  `CREATE INDEX collector_views_device_idx ON collector_views (device_id, at)`,
  // The client sheet, Segments, the export, the foreign key.
  `CREATE INDEX collector_views_account_idx ON collector_views (account_id, at)`,

  // ── view_daily_stats ─────────────────────────────────────────────────────
  `CREATE TABLE view_daily_stats (
     day             date     NOT NULL,
     page            smallint NOT NULL CONSTRAINT view_daily_stats_page_check CHECK (page BETWEEN 0 AND 60),
     subject         uuid     NOT NULL DEFAULT ${NIL_UUID},
     country         char(2)  NOT NULL CONSTRAINT view_daily_stats_country_check CHECK (${COUNTRY('country')}),
     views           integer  NOT NULL CONSTRAINT view_daily_stats_views_check CHECK (views >= 0),
     seconds         integer  NOT NULL CONSTRAINT view_daily_stats_seconds_check CHECK (seconds >= 0),
     devices         integer  NOT NULL CONSTRAINT view_daily_stats_devices_check CHECK (devices >= 0),
     signed_in_views integer  NOT NULL,
     PRIMARY KEY (day, page, subject, country),
     CONSTRAINT view_daily_stats_signed_in CHECK (signed_in_views BETWEEN 0 AND views)
   )`,

  // ── device_daily_stats ───────────────────────────────────────────────────
  `CREATE TABLE device_daily_stats (
     day               date    NOT NULL,
     country           char(2) NOT NULL CONSTRAINT device_daily_stats_country_check CHECK (${COUNTRY('country')}),
     kind              text    NOT NULL CONSTRAINT device_daily_stats_kind_check CHECK (kind IN (${DEVICE_KINDS})),
     os                text    NOT NULL CONSTRAINT device_daily_stats_os_check CHECK (os IN (${DEVICE_SYSTEMS})),
     browser           text    NOT NULL CONSTRAINT device_daily_stats_browser_check CHECK (browser IN (${DEVICE_BROWSERS})),
     opened_in         text    NOT NULL CONSTRAINT device_daily_stats_opened_in_check CHECK (opened_in IN (${OPENED_IN})),
     in_app            text    NOT NULL CONSTRAINT device_daily_stats_in_app_check CHECK (in_app IN (${IN_APPS},'NONE')),
     devices           integer NOT NULL CONSTRAINT device_daily_stats_devices_check CHECK (devices >= 0),
     new_devices       integer NOT NULL,
     signed_in_devices integer NOT NULL,
     PRIMARY KEY (day, country, kind, os, browser, opened_in, in_app),
     CONSTRAINT device_daily_stats_new CHECK (new_devices BETWEEN 0 AND devices),
     CONSTRAINT device_daily_stats_signed_in CHECK (signed_in_devices BETWEEN 0 AND devices)
   )`,

  // ── collector_places ─────────────────────────────────────────────────────
  `CREATE TABLE collector_places (
     account_id uuid    NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     place_id   integer NOT NULL REFERENCES geo_places (id) ON DELETE RESTRICT,
     days       integer NOT NULL CONSTRAINT collector_places_days_check CHECK (days >= 1),
     first_day  date    NOT NULL,
     last_day   date    NOT NULL,
     PRIMARY KEY (account_id, place_id),
     CONSTRAINT collector_places_days_order CHECK (last_day >= first_day)
   )`,
  `CREATE INDEX collector_places_place_idx ON collector_places (place_id)`,

  // ── collector_view_totals ────────────────────────────────────────────────
  `CREATE TABLE collector_view_totals (
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     page       smallint    NOT NULL CONSTRAINT collector_view_totals_page_check CHECK (page BETWEEN 1 AND 60),
     subject    uuid        NOT NULL DEFAULT ${NIL_UUID},
     views      integer     NOT NULL CONSTRAINT collector_view_totals_views_check CHECK (views >= 0),
     seconds    bigint      NOT NULL CONSTRAINT collector_view_totals_seconds_check CHECK (seconds >= 0),
     first_at   timestamptz NOT NULL,
     last_at    timestamptz NOT NULL,
     PRIMARY KEY (account_id, page, subject),
     CONSTRAINT collector_view_totals_seen CHECK (last_at >= first_at)
   )`,

  // ── collector_view_months ────────────────────────────────────────────────
  `CREATE TABLE collector_view_months (
     account_id  uuid     NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     month       date     NOT NULL CONSTRAINT collector_view_months_month_check CHECK (extract(day FROM month) = 1),
     views       integer  NOT NULL CONSTRAINT collector_view_months_views_check CHECK (views >= 0),
     seconds     bigint   NOT NULL CONSTRAINT collector_view_months_seconds_check CHECK (seconds >= 0),
     scans       integer  NOT NULL CONSTRAINT collector_view_months_scans_check CHECK (scans >= 0),
     active_days smallint NOT NULL CONSTRAINT collector_view_months_active_days_check CHECK (active_days BETWEEN 0 AND 31),
     PRIMARY KEY (account_id, month)
   )`,

  // ── tracking_state ───────────────────────────────────────────────────────
  `CREATE TABLE tracking_state (
     id                  smallint    PRIMARY KEY DEFAULT 1 CONSTRAINT tracking_state_id_check CHECK (id = 1),
     started_at          timestamptz NOT NULL,
     scans_after_at      timestamptz NULL,
     scans_after_id      uuid        NULL,
     scans_backfilled_at timestamptz NULL,
     CONSTRAINT tracking_state_keyset CHECK ((scans_after_at IS NULL) = (scans_after_id IS NULL))
   )`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS tracking_state`,
  `DROP TABLE IF EXISTS collector_view_months`,
  `DROP TABLE IF EXISTS collector_view_totals`,
  `DROP TABLE IF EXISTS collector_places`,
  `DROP TABLE IF EXISTS device_daily_stats`,
  `DROP TABLE IF EXISTS view_daily_stats`,
  `DROP TABLE IF EXISTS collector_views`,
  `DROP TABLE IF EXISTS tracking_device_accounts`,
  `DROP TABLE IF EXISTS tracking_devices`,
  `DROP TABLE IF EXISTS geo_places`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
