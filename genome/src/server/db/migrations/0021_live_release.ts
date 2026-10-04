/**
 * 0021 — the LIVE RELEASE (plan of 2026-10-04, deployment D): an instant drop lived in real time, a room before its
 * opening, a fair line at T0, a turn to hold the seal, a hold to press PAY, a second chance for the next in line.
 *
 * `drops` gains `mode`, DRAW (the draw of 0015, the default: every drop before this migration) or LIVE, and the
 * settings of a LIVE RELEASE, each required for LIVE and NULL for DRAW (`drops_live_fields`, `drops_draw_fields`):
 *  - `live_min_tier`: who may enter, 0 (any ORBES account) to 3 (PALLADIUM), the club's tiers of services/club.ts;
 *    narrowed further by `live_access_models` and `access_collection_id` (the owners of a model or of a collection);
 *  - `tier_priority`: the line at T0 ordered by tier first (PALLADIUM, PLATINE, TITANE, then the others);
 *  - `room_opens_minutes` (1 to 60): the room opens that long before `opens_at`, which is T0; `closes_at` ends the
 *    sales; `turn_seconds` (10 to 300) to hold the seal once it is one's turn, then `pay_minutes` (1 to 60) to press
 *    PAY; `per_account` (1 to 5) pieces per person; `price_minor` (≥ 0) in `currency` (three capital letters);
 *  - the staged reveals, `announce_at` (NULL: at the publication) ≤ `silhouette_at` ≤ `name_at` ≤ `photo_at` (each
 *    NULL: at the announcement) ≤ the room's opening (`drops_live_stages`); `silhouette_sha256`, an uploaded
 *    silhouette (media_objects); `quantity_line`, the quantity as the announcement says it (1 to 40 characters);
 *  - the live state: `paused_at` (a pause in progress), `paused_ms_total` (every pause, in milliseconds; 0 for a
 *    DRAW), `ended_at` and `ended_reason` (SOLD_OUT, CLOSED or ENDED by an ADMIN: set together, once published);
 *  - the boutique board's secret link, stored as the SHA-256 of its secret (`board_token_hash`, unique) with the time
 *    it was issued (`board_token_issued_at`), both or neither.
 * A LIVE drop is never drawn and has no early access (`early_access_hours` 0): its sealed seed orders the line within
 * a tier and is never revealed. Its `quantity` is the sum of its sizes' stock (kept by the services).
 *
 * `drop_sizes`: the sizes of a LIVE drop, 1 to 24 (`position` 1 to 24), each a `label` (1 to 12 characters, unique per
 * drop) and its `stock` (≥ 0). Its id and drop never change; `(drop_id, id)` is unique so that an entry and an
 * interest name a size of their own drop (composite foreign keys).
 *
 * `live_entries`: one per account and drop (`live_entries_drop_account_key`), in a size, for 1 to 5 pieces. Its
 * `status`, each with the columns it requires (the `live_entries_status_*` CHECKs):
 *   WAITING   in the room before T0 (no place yet);
 *   QUEUED    in the line: its `position` (unique per drop) and `queued_at`, at T0 by tier then the seed, or behind on
 *             arrival after T0;
 *   TURN      its turn: `turn_at`, `turn_expires_at` and the SHA-256 of the turn's secret (`turn_token_hash`);
 *             `press_started_at`, the press of the seal on the server's clock;
 *   SECURED   the seal held at least 1.4 s (`gesture_ms` ≥ 1 400, kept for the console's bot radar): `secured_at`,
 *             `hold_expires_at`;
 *   CONFIRMED PAY pressed (`confirmed_at`): a reservation ORBES Client Services concludes (`resolution` CONCLUDED or
 *             CANCELLED, `handled_by`, `handled_at`, `resolution_note` of at most 500 characters);
 *   MISSED    a turn that ran out; EXPIRED a hold that ran out (or freed by the console); RELEASED a place given back;
 *   LEFT      left by its account; REMOVED by the console (`removed_by`, `removed_at`); ENDED by the end of the
 *             release. These six carry `ended_at`, a REMOVED one equal to `removed_at`.
 * `tier` is the club's tier at entry, read again for the line at T0; `let_in_by` the console user who let the entry
 * take its turn out of order; `network_hash` a keyed SHA-256 of the network's prefix (erased 30 days after the end),
 * `country` the entry's country (two capital letters). id, drop and account never change.
 *
 * `live_access_models` (the models whose owners may enter), `live_addons` (engraving, gift box, ORBES Care…: at most
 * 6, `position` 1 to 6, a `label` of 40 characters, a `line` of 120, a price), `live_entry_addons` (the add-ons of an
 * entry with their price at the time, dropped with an ended hold), `live_interest` (I'LL BE THERE: one per account and
 * drop, with a size of that drop), `live_messages` (the host's lines, 1 to 140 characters, never changed) and
 * `live_tier_windows` (optional per-tier turn and pay windows, at least one of the two).
 *
 * Every foreign key leads an index (`drops_silhouette_sha256_idx`, `drops_access_collection_id_idx`, the unique
 * `(drop_id, …)` keys, `live_entries_account_idx`, `live_entries_let_in_by_idx`, `live_entries_removed_by_idx`,
 * `live_entries_handled_by_idx`, `live_access_models_model_idx`, `live_entry_addons_addon_idx`,
 * `live_interest_account_idx`, `live_interest_size_idx`, `live_messages_created_by_idx`); ON DELETE RESTRICT like every
 * other. `live_entries_line_idx` (drop, status, position) serves the line and its head; `live_entries_size_status_idx`
 * (drop, size, status) the pieces held per size.
 *
 * Compatible with the previous image: `mode` has a constant default (DRAW) and `paused_ms_total` 0, every other column
 * of `drops` is NULL, which it never names (it inserts drops without them and reads them column by column), and new
 * tables it never reads. No row is inserted. `down` cancels the LIVE drops first (the previous image would read them as
 * draws), drops the eight tables, then the constraints, indexes and columns of `drops`: the schema of 0020 exactly. One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const MODES = `'DRAW','LIVE'`;
const END_REASONS = `'SOLD_OUT','CLOSED','ENDED'`;
const ENTRY_STATUSES = `'WAITING','QUEUED','TURN','SECURED','CONFIRMED','MISSED','EXPIRED','RELEASED','LEFT','REMOVED','ENDED'`;
const RESOLUTIONS = `'CONCLUDED','CANCELLED'`;

/** The settings every LIVE drop has, and no DRAW (`drops_live_fields`, `drops_draw_fields`). */
const LIVE_SETTINGS = ['live_min_tier', 'tier_priority', 'room_opens_minutes', 'turn_seconds', 'pay_minutes', 'per_account', 'price_minor', 'currency', 'quantity_line'];
/** What only a LIVE drop may carry, beyond its settings. */
const LIVE_ONLY = ['announce_at', 'silhouette_at', 'name_at', 'photo_at', 'silhouette_sha256', 'access_collection_id', 'paused_at', 'ended_at', 'board_token_hash'];

export const UP: readonly string[] = [
  // ── drops ────────────────────────────────────────────────────────────────
  `ALTER TABLE drops ADD COLUMN mode text NOT NULL DEFAULT 'DRAW' CONSTRAINT drops_mode_check CHECK (mode IN (${MODES}))`,
  `ALTER TABLE drops ADD COLUMN live_min_tier smallint NULL CONSTRAINT drops_live_min_tier_check CHECK (live_min_tier BETWEEN 0 AND 3)`,
  `ALTER TABLE drops ADD COLUMN tier_priority boolean NULL`,
  `ALTER TABLE drops ADD COLUMN room_opens_minutes smallint NULL CONSTRAINT drops_room_opens_minutes_check CHECK (room_opens_minutes BETWEEN 1 AND 60)`,
  `ALTER TABLE drops ADD COLUMN turn_seconds smallint NULL CONSTRAINT drops_turn_seconds_check CHECK (turn_seconds BETWEEN 10 AND 300)`,
  `ALTER TABLE drops ADD COLUMN pay_minutes smallint NULL CONSTRAINT drops_pay_minutes_check CHECK (pay_minutes BETWEEN 1 AND 60)`,
  `ALTER TABLE drops ADD COLUMN per_account smallint NULL CONSTRAINT drops_per_account_check CHECK (per_account BETWEEN 1 AND 5)`,
  `ALTER TABLE drops ADD COLUMN price_minor integer NULL CONSTRAINT drops_price_minor_check CHECK (price_minor >= 0)`,
  `ALTER TABLE drops ADD COLUMN currency text NULL CONSTRAINT drops_currency_check CHECK (currency ~ '^[A-Z]{3}$')`,
  `ALTER TABLE drops ADD COLUMN announce_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN silhouette_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN name_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN photo_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN silhouette_sha256 text NULL CONSTRAINT drops_silhouette_sha256_fkey REFERENCES media_objects (sha256) ON DELETE RESTRICT`,
  `ALTER TABLE drops ADD COLUMN access_collection_id uuid NULL CONSTRAINT drops_access_collection_id_fkey REFERENCES collections (id) ON DELETE RESTRICT`,
  `ALTER TABLE drops ADD COLUMN quantity_line text NULL CONSTRAINT drops_quantity_line_check CHECK (length(btrim(quantity_line)) BETWEEN 1 AND 40)`,
  `ALTER TABLE drops ADD COLUMN paused_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN paused_ms_total bigint NOT NULL DEFAULT 0 CONSTRAINT drops_paused_ms_total_check CHECK (paused_ms_total >= 0)`,
  `ALTER TABLE drops ADD COLUMN ended_at timestamptz NULL`,
  `ALTER TABLE drops ADD COLUMN ended_reason text NULL CONSTRAINT drops_ended_reason_check CHECK (ended_reason IN (${END_REASONS}))`,
  `ALTER TABLE drops ADD COLUMN board_token_hash bytea NULL CONSTRAINT drops_board_token_hash_check CHECK (octet_length(board_token_hash) = 32)`,
  `ALTER TABLE drops ADD COLUMN board_token_issued_at timestamptz NULL`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_fields CHECK (mode = 'LIVE' OR (${[...LIVE_SETTINGS, ...LIVE_ONLY].map((c) => `${c} IS NULL`).join(' AND ')} AND paused_ms_total = 0))`,
  `ALTER TABLE drops ADD CONSTRAINT drops_live_fields CHECK (mode = 'DRAW' OR (${LIVE_SETTINGS.map((c) => `${c} IS NOT NULL`).join(' AND ')} AND early_access_hours = 0 AND drawn_at IS NULL))`,
  // NULL stages read as the announcement, a NULL announcement as the publication (unknown here: the services check it).
  `ALTER TABLE drops ADD CONSTRAINT drops_live_stages CHECK (
     coalesce(silhouette_at, announce_at) >= announce_at
     AND coalesce(name_at, announce_at) >= coalesce(silhouette_at, announce_at)
     AND coalesce(photo_at, announce_at) >= coalesce(name_at, announce_at)
     AND greatest(announce_at, silhouette_at, name_at, photo_at) <= opens_at - room_opens_minutes * interval '1 minute')`,
  `ALTER TABLE drops ADD CONSTRAINT drops_live_ended CHECK ((ended_at IS NULL) = (ended_reason IS NULL) AND (ended_at IS NULL OR published_at IS NOT NULL))`,
  `ALTER TABLE drops ADD CONSTRAINT drops_live_paused CHECK (paused_at IS NULL OR published_at IS NOT NULL)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_board_token CHECK ((board_token_hash IS NULL) = (board_token_issued_at IS NULL))`,
  `CREATE INDEX drops_silhouette_sha256_idx ON drops (silhouette_sha256)`,
  `CREATE INDEX drops_access_collection_id_idx ON drops (access_collection_id)`,
  // The boutique board finds its release by the SHA-256 of its link's secret.
  `CREATE UNIQUE INDEX drops_board_token_hash_key ON drops (board_token_hash)`,

  // ── drop_sizes ───────────────────────────────────────────────────────────
  `CREATE TABLE drop_sizes (
     id       uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id  uuid     NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     label    text     NOT NULL CHECK (length(label) BETWEEN 1 AND 12 AND label = btrim(label)),
     position smallint NOT NULL CHECK (position BETWEEN 1 AND 24),
     stock    integer  NOT NULL CHECK (stock BETWEEN 0 AND 10000),
     CONSTRAINT drop_sizes_label_key UNIQUE (drop_id, label),
     CONSTRAINT drop_sizes_position_key UNIQUE (drop_id, position),
     CONSTRAINT drop_sizes_drop_size_key UNIQUE (drop_id, id)
   )`,
  `CREATE TRIGGER drop_sizes_immutable_identity BEFORE UPDATE ON drop_sizes
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'drop_id')`,

  // ── live_entries ─────────────────────────────────────────────────────────
  `CREATE TABLE live_entries (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id          uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     account_id       uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     size_id          uuid        NOT NULL,
     quantity         smallint    NOT NULL CHECK (quantity BETWEEN 1 AND 5),
     status           text        NOT NULL DEFAULT 'WAITING' CHECK (status IN (${ENTRY_STATUSES})),
     tier             smallint    NOT NULL CHECK (tier BETWEEN 0 AND 3),
     position         integer     NULL CHECK (position >= 1),
     joined_at        timestamptz NOT NULL DEFAULT now(),
     queued_at        timestamptz NULL,
     turn_at          timestamptz NULL,
     turn_expires_at  timestamptz NULL,
     turn_token_hash  bytea       NULL CHECK (octet_length(turn_token_hash) = 32),
     press_started_at timestamptz NULL,
     gesture_ms       integer     NULL CHECK (gesture_ms >= 1400),
     secured_at       timestamptz NULL,
     hold_expires_at  timestamptz NULL,
     confirmed_at     timestamptz NULL,
     ended_at         timestamptz NULL,
     let_in_by        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     removed_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     removed_at       timestamptz NULL,
     handled_by       uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     handled_at       timestamptz NULL,
     resolution       text        NULL CHECK (resolution IN (${RESOLUTIONS})),
     resolution_note  text        NULL CHECK (length(btrim(resolution_note)) BETWEEN 1 AND 500),
     network_hash     bytea       NULL CHECK (octet_length(network_hash) = 32),
     country          text        NULL CHECK (country ~ '^[A-Z]{2}$'),
     CONSTRAINT live_entries_drop_account_key UNIQUE (drop_id, account_id),
     CONSTRAINT live_entries_drop_position_key UNIQUE (drop_id, position),
     CONSTRAINT live_entries_size_fkey FOREIGN KEY (drop_id, size_id) REFERENCES drop_sizes (drop_id, id) ON DELETE RESTRICT,
     CONSTRAINT live_entries_line CHECK ((position IS NULL) = (queued_at IS NULL) AND (queued_at IS NULL OR queued_at >= joined_at)),
     CONSTRAINT live_entries_turn_fields CHECK (
       (turn_at IS NULL) = (turn_expires_at IS NULL) AND (turn_at IS NULL) = (turn_token_hash IS NULL)
       AND (turn_at IS NULL OR (queued_at IS NOT NULL AND turn_at >= queued_at AND turn_expires_at > turn_at))),
     CONSTRAINT live_entries_press_after_turn CHECK (press_started_at IS NULL OR (turn_at IS NOT NULL AND press_started_at >= turn_at)),
     CONSTRAINT live_entries_secured_fields CHECK (
       (secured_at IS NULL) = (hold_expires_at IS NULL) AND (secured_at IS NULL) = (gesture_ms IS NULL)
       AND (secured_at IS NULL OR (press_started_at IS NOT NULL AND secured_at >= press_started_at AND hold_expires_at > secured_at))),
     CONSTRAINT live_entries_confirmed_after CHECK (confirmed_at IS NULL OR (secured_at IS NOT NULL AND confirmed_at >= secured_at)),
     CONSTRAINT live_entries_let_in_turn CHECK (let_in_by IS NULL OR turn_at IS NOT NULL),
     CONSTRAINT live_entries_removed_fields CHECK ((removed_at IS NULL OR ended_at = removed_at) AND (removed_by IS NULL OR removed_at IS NOT NULL)),
     CONSTRAINT live_entries_ended_after_join CHECK (ended_at IS NULL OR ended_at >= joined_at),
     CONSTRAINT live_entries_handled_fields CHECK (
       (resolution IS NULL) = (handled_at IS NULL) AND (handled_by IS NULL OR handled_at IS NOT NULL)
       AND (resolution IS NULL OR confirmed_at IS NOT NULL) AND (resolution_note IS NULL OR resolution IS NOT NULL)
       AND (handled_at IS NULL OR handled_at >= confirmed_at)),
     CONSTRAINT live_entries_status_waiting CHECK (status <> 'WAITING' OR (queued_at IS NULL AND ended_at IS NULL)),
     CONSTRAINT live_entries_status_queued CHECK (status <> 'QUEUED' OR (queued_at IS NOT NULL AND turn_at IS NULL AND ended_at IS NULL)),
     CONSTRAINT live_entries_status_turn CHECK (status <> 'TURN' OR (turn_at IS NOT NULL AND secured_at IS NULL AND ended_at IS NULL)),
     CONSTRAINT live_entries_status_secured CHECK (status <> 'SECURED' OR (secured_at IS NOT NULL AND confirmed_at IS NULL AND ended_at IS NULL)),
     CONSTRAINT live_entries_status_confirmed CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL) AND (status <> 'CONFIRMED' OR ended_at IS NULL)),
     CONSTRAINT live_entries_status_missed CHECK (status <> 'MISSED' OR (turn_at IS NOT NULL AND secured_at IS NULL AND ended_at IS NOT NULL)),
     CONSTRAINT live_entries_status_returned CHECK (status NOT IN ('EXPIRED', 'RELEASED') OR (secured_at IS NOT NULL AND ended_at IS NOT NULL)),
     CONSTRAINT live_entries_status_left CHECK (status NOT IN ('LEFT', 'ENDED') OR (secured_at IS NULL AND ended_at IS NOT NULL)),
     CONSTRAINT live_entries_status_removed CHECK ((status = 'REMOVED') = (removed_at IS NOT NULL))
   )`,
  // The line and its head: a drop's entries by status and place.
  `CREATE INDEX live_entries_line_idx ON live_entries (drop_id, status, position)`,
  // The pieces held per size (and the composite foreign key to drop_sizes).
  `CREATE INDEX live_entries_size_status_idx ON live_entries (drop_id, size_id, status)`,
  `CREATE INDEX live_entries_account_idx ON live_entries (account_id, joined_at)`,
  `CREATE INDEX live_entries_let_in_by_idx ON live_entries (let_in_by)`,
  `CREATE INDEX live_entries_removed_by_idx ON live_entries (removed_by)`,
  `CREATE INDEX live_entries_handled_by_idx ON live_entries (handled_by)`,
  `CREATE TRIGGER live_entries_immutable_identity BEFORE UPDATE ON live_entries
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'drop_id', 'account_id')`,

  // ── access, add-ons, interest, messages, per-tier windows ────────────────
  `CREATE TABLE live_access_models (
     drop_id  uuid NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     model_id uuid NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     PRIMARY KEY (drop_id, model_id)
   )`,
  `CREATE INDEX live_access_models_model_idx ON live_access_models (model_id)`,

  `CREATE TABLE live_addons (
     id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id     uuid     NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     label       text     NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
     line        text     NULL CHECK (length(btrim(line)) BETWEEN 1 AND 120),
     price_minor integer  NOT NULL CHECK (price_minor >= 0),
     position    smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
     CONSTRAINT live_addons_position_key UNIQUE (drop_id, position)
   )`,
  `CREATE TRIGGER live_addons_immutable_identity BEFORE UPDATE ON live_addons
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'drop_id')`,

  `CREATE TABLE live_entry_addons (
     entry_id    uuid    NOT NULL REFERENCES live_entries (id) ON DELETE RESTRICT,
     addon_id    uuid    NOT NULL REFERENCES live_addons (id) ON DELETE RESTRICT,
     price_minor integer NOT NULL CHECK (price_minor >= 0),
     PRIMARY KEY (entry_id, addon_id)
   )`,
  `CREATE INDEX live_entry_addons_addon_idx ON live_entry_addons (addon_id)`,

  `CREATE TABLE live_interest (
     drop_id    uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     size_id    uuid        NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (drop_id, account_id),
     CONSTRAINT live_interest_size_fkey FOREIGN KEY (drop_id, size_id) REFERENCES drop_sizes (drop_id, id) ON DELETE RESTRICT
   )`,
  `CREATE INDEX live_interest_account_idx ON live_interest (account_id)`,
  // The interest by size (the console's planner and radar).
  `CREATE INDEX live_interest_size_idx ON live_interest (drop_id, size_id)`,

  `CREATE TABLE live_messages (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     drop_id    uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     text       text        NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 140),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // A release's lines, the latest first.
  `CREATE INDEX live_messages_drop_idx ON live_messages (drop_id, created_at)`,
  `CREATE INDEX live_messages_created_by_idx ON live_messages (created_by)`,
  `CREATE TRIGGER live_messages_immutable BEFORE UPDATE ON live_messages
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a host message never changes')`,

  `CREATE TABLE live_tier_windows (
     drop_id      uuid     NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     tier         smallint NOT NULL CHECK (tier BETWEEN 0 AND 3),
     turn_seconds smallint NULL CHECK (turn_seconds BETWEEN 10 AND 300),
     pay_minutes  smallint NULL CHECK (pay_minutes BETWEEN 1 AND 60),
     PRIMARY KEY (drop_id, tier),
     CONSTRAINT live_tier_windows_some CHECK (turn_seconds IS NOT NULL OR pay_minutes IS NOT NULL)
   )`,
];

const DROPS_CONSTRAINTS = ['drops_board_token', 'drops_live_paused', 'drops_live_ended', 'drops_live_stages', 'drops_live_fields', 'drops_draw_fields'];
const DROPS_COLUMNS = [
  'board_token_issued_at', 'board_token_hash', 'ended_reason', 'ended_at', 'paused_ms_total', 'paused_at', 'quantity_line', 'access_collection_id',
  'silhouette_sha256', 'photo_at', 'name_at', 'silhouette_at', 'announce_at', 'currency', 'price_minor', 'per_account', 'pay_minutes', 'turn_seconds',
  'room_opens_minutes', 'tier_priority', 'live_min_tier', 'mode',
];

export const DOWN: readonly string[] = [
  // The previous image reads every drop as a draw: a LIVE one is cancelled, so nobody enters it nor draws it there.
  `UPDATE drops SET cancelled_at = now() WHERE mode = 'LIVE' AND cancelled_at IS NULL`,
  `DROP TABLE IF EXISTS live_tier_windows`,
  `DROP TABLE IF EXISTS live_messages`,
  `DROP TABLE IF EXISTS live_interest`,
  `DROP TABLE IF EXISTS live_entry_addons`,
  `DROP TABLE IF EXISTS live_addons`,
  `DROP TABLE IF EXISTS live_access_models`,
  `DROP TABLE IF EXISTS live_entries`,
  `DROP TABLE IF EXISTS drop_sizes`,
  `DROP INDEX IF EXISTS drops_board_token_hash_key`,
  `DROP INDEX IF EXISTS drops_access_collection_id_idx`,
  `DROP INDEX IF EXISTS drops_silhouette_sha256_idx`,
  ...DROPS_CONSTRAINTS.map((c) => `ALTER TABLE drops DROP CONSTRAINT IF EXISTS ${c}`),
  ...DROPS_COLUMNS.map((c) => `ALTER TABLE drops DROP COLUMN IF EXISTS ${c}`),
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
