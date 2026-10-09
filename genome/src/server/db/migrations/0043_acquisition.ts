/**
 * 0043 — Where they come from: the links, the sources, the visits and the attribution (plan CUSTOMER INTELLIGENCE of
 * 2026-10-08, §3.4 A.6, step 4.1): the lot's fourth migration, after 0042_collector_views. Eight tables the previous
 * image never names, one column and its index on `tracking_devices`, and three indexes on existing tables. No row
 * inserted: the channels' presets, the DIRECT, BEFORE and STAFF sources and the one `acquisition_state` row are written
 * by AcquisitionService.prepare at the first boot (§3.4 A.6 items 1, 3 and 9), never here.
 *
 * `link_channels`: what the console's links are grouped by (Instagram, TikTok, Influencers…), a name once whatever its
 * case (`link_channels_name_key`), in an order.
 *
 * `links`: a console link, `verify.theorbes.com/go/<code>`. Its address (`code`, 3 to 32 lower-case letters, figures or
 * dashes, no dash at either end) never changes once made, so a posted link never breaks (`links_immutable`); its name,
 * channel, destination (a page of the app; a release or a model named exactly when it goes to one,
 * `links_destination`), cost (an amount in one of the house's four currencies, both or neither, `links_cost`) and note
 * may. Archived with who did it, both or neither (`links_archived`); an archived link keeps redirecting and counting.
 *
 * `acquisition_sources`: each distinct source once, by its key (`L:<link id>`, `C:<five tags joined by U+001F>`,
 * `S:<host>`, `DIRECT`, `BEFORE`, `STAFF`), with exactly the columns of its kind (`acquisition_sources_shape`); the tags
 * trimmed and in lower case, the site a host. An integer identity, so the visits stay small.
 *
 * `tracking_devices.first_source_id`: the source of the device's first arrival, set once by the app (NULL while it made
 * none, read as Direct); its index leads the foreign key and serves the first visits by source and over time.
 *
 * `acquisition_touches`: a visit, one device from one source on one Paris day (`acquisition_touches_visit`), its
 * repeats counted in `arrivals`; never a DIRECT source (the code writes none). Kept 13 months, then summarised.
 *
 * `account_sources`: a collector's first source, kept for good. `acquisition_conversions`: each sign-up, draw entry,
 * LIVE entry and order once (`acquisition_conversions_ref`), with its last link; `ref_id` has no foreign key, as it
 * names four tables. `acquisition_daily`: the visits by source and Paris day once the raw rows are gone, kept for good.
 * `acquisition_state`: one row, the recording's start and the job's watermarks.
 *
 * `drop_entries (created_at)`, `live_entries (joined_at)`, `orders (reserved_at)`: the conversions job's watermark reads
 * the rows by when they were written (§3.4 A.8), small b-trees rather than a scan of three tables every 10 minutes.
 * Built inside the migration's transaction, as every index of the house (no CONCURRENTLY).
 *
 * Every foreign key leads a full index (no predicate), ON DELETE RESTRICT like every other. `down` drops the three
 * indexes, the column and its index, then the eight tables newest first: the schema of 0042 exactly (nothing is rolled
 * back in production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts and migrations.test.ts
// check they match schema.ts.
const LINK_DESTINATIONS = `'NOW','RELEASES','RELEASE','COLLECTION','MODEL','CLUB','HOW'`;
const HOUSE_CURRENCIES = `'EUR','GBP','USD','CHF'`;
const SOURCE_KINDS = `'LINK','CAMPAIGN','SITE','DIRECT','BEFORE','STAFF'`;
const SOURCE_SET_BY = `'SIGN_UP','SIGN_IN','JOB'`;
const CONVERSION_KINDS = `'SIGNUP','DRAW_ENTRY','LIVE_ENTRY','ORDER'`;

/** A campaign tag: 1 to 100 characters, trimmed and in lower case. */
const tag = (column: string) => `char_length(${column}) BETWEEN 1 AND 100 AND ${column} = lower(btrim(${column}))`;
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const noTags = UTM.map((c) => `${c} IS NULL`).join(' AND ');

export const UP: readonly string[] = [
  // ── link_channels ────────────────────────────────────────────────────────
  `CREATE TABLE link_channels (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL CONSTRAINT link_channels_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 40),
     position   smallint    NOT NULL DEFAULT 0 CONSTRAINT link_channels_position_check CHECK (position BETWEEN 0 AND 999),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX link_channels_name_key ON link_channels (lower(name))`,
  `CREATE INDEX link_channels_created_by_idx ON link_channels (created_by)`,

  // ── links ────────────────────────────────────────────────────────────────
  `CREATE TABLE links (
     id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     code          text        NOT NULL CONSTRAINT links_code_check CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
     name          text        NOT NULL CONSTRAINT links_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
     channel_id    uuid        NOT NULL REFERENCES link_channels (id) ON DELETE RESTRICT,
     destination   text        NOT NULL CONSTRAINT links_destination_check CHECK (destination IN (${LINK_DESTINATIONS})),
     drop_id       uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     model_id      uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     cost_minor    bigint      NULL CONSTRAINT links_cost_minor_check CHECK (cost_minor BETWEEN 0 AND 100000000000),
     cost_currency text        NULL CONSTRAINT links_cost_currency_check CHECK (cost_currency IN (${HOUSE_CURRENCIES})),
     note          text        NULL CONSTRAINT links_note_check CHECK (char_length(note) <= 500),
     archived_at   timestamptz NULL,
     archived_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_by    uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT links_destination CHECK ((destination = 'RELEASE') = (drop_id IS NOT NULL) AND (destination = 'MODEL') = (model_id IS NOT NULL)),
     CONSTRAINT links_cost CHECK ((cost_minor IS NULL) = (cost_currency IS NULL)),
     CONSTRAINT links_archived CHECK ((archived_at IS NULL) = (archived_by IS NULL))
   )`,
  `CREATE UNIQUE INDEX links_code_key ON links (code)`,
  `CREATE INDEX links_channel_idx ON links (channel_id, created_at)`,
  `CREATE INDEX links_drop_idx ON links (drop_id)`,
  `CREATE INDEX links_model_idx ON links (model_id)`,
  `CREATE INDEX links_archived_by_idx ON links (archived_by)`,
  `CREATE INDEX links_created_by_idx ON links (created_by)`,
  // A link's address never changes once made: a posted or printed link never breaks.
  `CREATE TRIGGER links_immutable BEFORE UPDATE ON links
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'code', 'created_by', 'created_at')`,

  // ── acquisition_sources ──────────────────────────────────────────────────
  `CREATE TABLE acquisition_sources (
     id           integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     kind         text        NOT NULL CONSTRAINT acquisition_sources_kind_check CHECK (kind IN (${SOURCE_KINDS})),
     link_id      uuid        NULL REFERENCES links (id) ON DELETE RESTRICT,
     utm_source   text        NULL CONSTRAINT acquisition_sources_utm_source_check CHECK (${tag('utm_source')}),
     utm_medium   text        NULL CONSTRAINT acquisition_sources_utm_medium_check CHECK (${tag('utm_medium')}),
     utm_campaign text        NULL CONSTRAINT acquisition_sources_utm_campaign_check CHECK (${tag('utm_campaign')}),
     utm_content  text        NULL CONSTRAINT acquisition_sources_utm_content_check CHECK (${tag('utm_content')}),
     utm_term     text        NULL CONSTRAINT acquisition_sources_utm_term_check CHECK (${tag('utm_term')}),
     site         text        NULL CONSTRAINT acquisition_sources_site_check CHECK (site ~ '^[a-z0-9][a-z0-9.:-]{0,252}$'),
     key          text        NOT NULL CONSTRAINT acquisition_sources_key_check CHECK (char_length(key) <= 600),
     created_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT acquisition_sources_shape CHECK (CASE kind
       WHEN 'LINK' THEN link_id IS NOT NULL AND ${noTags} AND site IS NULL
       WHEN 'CAMPAIGN' THEN link_id IS NULL AND site IS NULL AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
       WHEN 'SITE' THEN link_id IS NULL AND ${noTags} AND site IS NOT NULL
       ELSE link_id IS NULL AND ${noTags} AND site IS NULL
     END)
   )`,
  `CREATE UNIQUE INDEX acquisition_sources_key ON acquisition_sources (key)`,
  `CREATE INDEX acquisition_sources_link_idx ON acquisition_sources (link_id)`,
  // The day's cap of new campaign and site sources.
  `CREATE INDEX acquisition_sources_created_idx ON acquisition_sources (created_at)`,

  // ── tracking_devices.first_source_id ─────────────────────────────────────
  `ALTER TABLE tracking_devices ADD COLUMN first_source_id integer NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT`,
  // First visits by source and over time; it leads the foreign key.
  `CREATE INDEX tracking_devices_first_source_idx ON tracking_devices (first_source_id, first_seen_at)`,

  // ── acquisition_touches ──────────────────────────────────────────────────
  `CREATE TABLE acquisition_touches (
     id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     device_id  integer     NOT NULL REFERENCES tracking_devices (id) ON DELETE RESTRICT,
     source_id  integer     NOT NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT,
     day        date        NOT NULL,
     first_at   timestamptz NOT NULL,
     last_at    timestamptz NOT NULL,
     arrivals   integer     NOT NULL DEFAULT 1 CONSTRAINT acquisition_touches_arrivals_check CHECK (arrivals >= 1),
     account_id uuid        NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     CONSTRAINT acquisition_touches_times CHECK (last_at >= first_at)
   )`,
  // One visit per device, source and Paris day; it leads the device's foreign key.
  `CREATE UNIQUE INDEX acquisition_touches_visit ON acquisition_touches (device_id, source_id, day)`,
  // The daily summary; it leads the source's foreign key.
  `CREATE INDEX acquisition_touches_source_day ON acquisition_touches (source_id, day)`,
  // The last link; a full index (every foreign key leads one with no predicate).
  `CREATE INDEX acquisition_touches_account ON acquisition_touches (account_id, last_at)`,
  // The purge.
  `CREATE INDEX acquisition_touches_day ON acquisition_touches (day)`,

  // ── account_sources ──────────────────────────────────────────────────────
  `CREATE TABLE account_sources (
     account_id      uuid        PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
     first_source_id integer     NOT NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT,
     first_seen_at   timestamptz NOT NULL,
     set_at          timestamptz NOT NULL,
     set_by          text        NOT NULL CONSTRAINT account_sources_set_by_check CHECK (set_by IN (${SOURCE_SET_BY}))
   )`,
  `CREATE INDEX account_sources_first_idx ON account_sources (first_source_id)`,

  // ── acquisition_conversions ──────────────────────────────────────────────
  `CREATE TABLE acquisition_conversions (
     id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     kind           text        NOT NULL CONSTRAINT acquisition_conversions_kind_check CHECK (kind IN (${CONVERSION_KINDS})),
     ref_id         uuid        NOT NULL,
     account_id     uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     at             timestamptz NOT NULL,
     last_source_id integer     NOT NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT,
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX acquisition_conversions_ref ON acquisition_conversions (kind, ref_id)`,
  `CREATE INDEX acquisition_conversions_account_idx ON acquisition_conversions (account_id, kind)`,
  `CREATE INDEX acquisition_conversions_last_idx ON acquisition_conversions (last_source_id, kind, at)`,

  // ── acquisition_daily ────────────────────────────────────────────────────
  `CREATE TABLE acquisition_daily (
     source_id    integer NOT NULL REFERENCES acquisition_sources (id) ON DELETE RESTRICT,
     day          date    NOT NULL,
     visits       integer NOT NULL CONSTRAINT acquisition_daily_visits_check CHECK (visits >= 0),
     first_visits integer NOT NULL CONSTRAINT acquisition_daily_first_visits_check CHECK (first_visits >= 0),
     arrivals     integer NOT NULL CONSTRAINT acquisition_daily_arrivals_check CHECK (arrivals >= 0),
     PRIMARY KEY (source_id, day)
   )`,
  `CREATE INDEX acquisition_daily_day_idx ON acquisition_daily (day)`,

  // ── acquisition_state ────────────────────────────────────────────────────
  `CREATE TABLE acquisition_state (
     id                  smallint    PRIMARY KEY DEFAULT 1 CONSTRAINT acquisition_state_id_check CHECK (id = 1),
     tracking_started_at timestamptz NOT NULL,
     conversions_until   timestamptz NOT NULL,
     catch_up_on         date        NULL,
     daily_until         date        NULL
   )`,

  // ── The conversions job's watermark, on existing tables ──────────────────
  `CREATE INDEX drop_entries_created_idx ON drop_entries (created_at)`,
  `CREATE INDEX live_entries_joined_idx ON live_entries (joined_at)`,
  `CREATE INDEX orders_reserved_idx ON orders (reserved_at)`,
];

export const DOWN: readonly string[] = [
  `DROP INDEX IF EXISTS orders_reserved_idx`,
  `DROP INDEX IF EXISTS live_entries_joined_idx`,
  `DROP INDEX IF EXISTS drop_entries_created_idx`,
  `DROP TABLE IF EXISTS acquisition_state`,
  `DROP TABLE IF EXISTS acquisition_daily`,
  `DROP TABLE IF EXISTS acquisition_conversions`,
  `DROP TABLE IF EXISTS account_sources`,
  `DROP TABLE IF EXISTS acquisition_touches`,
  `DROP INDEX IF EXISTS tracking_devices_first_source_idx`,
  `ALTER TABLE tracking_devices DROP COLUMN IF EXISTS first_source_id`,
  `DROP TABLE IF EXISTS acquisition_sources`,
  `DROP TABLE IF EXISTS links`,
  `DROP TABLE IF EXISTS link_channels`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
