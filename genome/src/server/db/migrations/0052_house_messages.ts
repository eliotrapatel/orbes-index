/**
 * 0052 — house messages (macro scope of 2026-10-20, D24 M1 and M2; lot M2 plan §1.4, step M2.1): the messages ORBES
 * writes to its collectors, read-only, delivered only in MESSAGES and on NOW's unread line (M3, M4). Two sources: six
 * automatic moments, each with its own switch and words, and custom messages written by staff to a segment or a tier.
 * They never enter `client_conversations` / `client_messages`.
 *
 * `house_moment_settings`: one row per moment the console has touched (`moment`, one of HOUSE_MOMENTS); no row is the
 * default: off, with the default words (0051's `email_templates` pattern). `enabled` (DEFAULT false: every moment starts
 * off) and `enabled_at`, set exactly while enabled (`house_moment_settings_enabled`) and moved to now at each switch-on:
 * a moment delivers only what falls due from then on, never the past. `title` (one line of 1 to 80 characters, trimmed,
 * no control character) and `body` (1 to 2 000 characters, plain paragraphs), each NULL for the default words;
 * `updated_by` (the console member, NOT NULL: a row exists only once the console wrote it) and `updated_at`.
 *
 * `house_messages`: the custom messages.
 *  - `title` and `body` as above; `status` DRAFT, SCHEDULED, SENT or CANCELLED (DEFAULT DRAFT);
 *  - the audience: `audience_segment_id` (a saved segment) or `audience_min_tier` (1 TITANE, 2 PLATINE, 3 PALLADIUM,
 *    read as "this tier and above"), exactly one of them while DRAFT or SCHEDULED (`house_messages_audience`);
 *    `audience_label`, the segment's or the tier's name written at sending (one line of 1 to 80 characters), NOT NULL
 *    once SENT (`house_messages_label`), so a sent message keeps its audience's name;
 *  - `send_at` exactly while SCHEDULED or SENT (`house_messages_send_at`); `sent_at` and `reach` (≥ 0) exactly when SENT
 *    (`house_messages_sent`); `cancelled_at` and `cancelled_by` exactly when CANCELLED (`house_messages_cancelled`);
 *  - `created_by`, `created_at`, `updated_by`, `updated_at`, and `sent_by`, who scheduled or sent it: none on a DRAFT,
 *    set on a SCHEDULED or SENT message (`house_messages_sent_by`);
 *  - `id`, `created_by` and `created_at` never change (`house_messages_immutable_identity`). Once SENT nothing changes
 *    (`house_messages_sent_immutable`), but the segment's id may be cleared (to NULL, never to another segment:
 *    `house_messages_sent_audience`), so a segment can be deleted after its messages went: its name stays in
 *    `audience_label`. Only a DRAFT is ever deleted (`house_messages_no_delete`): a scheduled one is cancelled, a sent
 *    one is kept with its deliveries;
 *  - `house_messages_due` (status, send_at) serves the sender loop; each foreign key leads its own index.
 *
 * `house_deliveries`: one row per message an account received.
 *  - `account_id`, `source` MOMENT or CUSTOM (`house_deliveries_source`): a MOMENT names its `moment` and holds its
 *    `title` and `body` rendered at delivery (an edit of the words changes the next deliveries, never these), with the
 *    piece's reference `piece_ref` (O26-J-00184, products.product_id's shape) exactly for a first registration and a
 *    year of ownership (`house_deliveries_piece`); a CUSTOM names its `house_message_id` only, its words being read from
 *    the message (never copied to every account);
 *  - `dedupe_key` (one line of 1 to 200 characters, once: `house_deliveries_dedupe_key`), so a moment or a message is
 *    never delivered twice, whatever the passes, restarts or processes;
 *  - `delivered_at`, and `read_at` when its collector opened it, never before its delivery (`house_deliveries_read`);
 *  - every column but `read_at` never changes (`house_deliveries_immutable`); never deleted nor truncated: house
 *    messages are kept with the account, as messages are;
 *  - indexes: an account's messages newest first, its unread ones, a message's deliveries (its reach and reads), a
 *    moment's deliveries over time.
 *
 * Every foreign key leads a full index, ON DELETE RESTRICT like every other (a segment named by a sent message is
 * cleared from it by the service before the segment is deleted). On the previous image (lot M1) during the roll-out:
 * three tables it never reads; nothing it writes changes. No row is inserted. `down` refuses, naming the counts, while
 * any setting, message or delivery exists; otherwise it drops the three tables: the schema of 0051 exactly. One
 * statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists and bounds, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they
// match schema.ts.
/** The six moments (schema.ts HOUSE_MOMENTS), M1 a) to f) (lot M2 plan §1.2). */
const HOUSE_MOMENTS = `'FIRST_REGISTRATION','BIRTHDAY_CREDIT','CREDIT_EXPIRING','PRIVATE_CARE','OWNERSHIP_YEAR','NINETY_DAYS'`;
/** The moments whose message names a piece (a and e). */
const PIECE_MOMENTS = `'FIRST_REGISTRATION','OWNERSHIP_YEAR'`;
/** A custom message's status (schema.ts HOUSE_MESSAGE_STATUSES). */
const HOUSE_MESSAGE_STATUSES = `'DRAFT','SCHEDULED','SENT','CANCELLED'`;
/** Where a delivery comes from (schema.ts HOUSE_DELIVERY_SOURCES). */
const HOUSE_DELIVERY_SOURCES = `'MOMENT','CUSTOM'`;
/** The words the console writes, at most (schema.ts HOUSE_TITLE_MAX, HOUSE_BODY_MAX). */
const TITLE_MAX = 80;
const BODY_MAX = 2000;
/** An audience's name as written at sending (schema.ts HOUSE_AUDIENCE_LABEL_MAX). */
const LABEL_MAX = 80;
/** A moment's words as delivered, placeholders rendered, at most (schema.ts HOUSE_DELIVERED_TITLE_MAX, HOUSE_DELIVERED_BODY_MAX). */
const DELIVERED_TITLE_MAX = 400;
const DELIVERED_BODY_MAX = 8000;
/** A delivery's key (schema.ts HOUSE_DEDUPE_MAX). */
const DEDUPE_MAX = 200;

/** One line of 1 to n characters, trimmed, with no control character. */
const line = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;
/** Plain paragraphs of at most n characters, not blank (a character other than a space or a line break). */
const words = (column: string, max: number) => `char_length(${column}) <= ${max} AND ${column} ~ '[^[:space:]]'`;

/** Every column of a custom message but its segment's id, frozen once SENT. */
const SENT_COLUMNS = [
  'id', 'title', 'body', 'status', 'audience_min_tier', 'audience_label', 'send_at', 'sent_at', 'reach', 'sent_by', 'cancelled_at', 'cancelled_by', 'created_by',
  'created_at', 'updated_by', 'updated_at',
];
/** Every column of a delivery but `read_at`. */
const DELIVERY_COLUMNS = ['id', 'account_id', 'source', 'moment', 'house_message_id', 'title', 'body', 'piece_ref', 'dedupe_key', 'delivered_at'];

const quoted = (columns: readonly string[]) => columns.map((c) => `'${c}'`).join(', ');

export const UP: readonly string[] = [
  // ── house_moment_settings ────────────────────────────────────────────────
  `CREATE TABLE house_moment_settings (
     moment      text        PRIMARY KEY CONSTRAINT house_moment_settings_moment_check CHECK (moment IN (${HOUSE_MOMENTS})),
     enabled     boolean     NOT NULL DEFAULT false,
     enabled_at  timestamptz NULL,
     title       text        NULL CONSTRAINT house_moment_settings_title_check CHECK (${line('title', TITLE_MAX)}),
     body        text        NULL CONSTRAINT house_moment_settings_body_check CHECK (${words('body', BODY_MAX)}),
     updated_by  uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT house_moment_settings_enabled CHECK (enabled = (enabled_at IS NOT NULL))
   )`,
  `CREATE INDEX house_moment_settings_updated_by_idx ON house_moment_settings (updated_by)`,

  // ── house_messages ───────────────────────────────────────────────────────
  `CREATE TABLE house_messages (
     id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     title               text        NOT NULL CONSTRAINT house_messages_title_check CHECK (${line('title', TITLE_MAX)}),
     body                text        NOT NULL CONSTRAINT house_messages_body_check CHECK (${words('body', BODY_MAX)}),
     status              text        NOT NULL DEFAULT 'DRAFT' CONSTRAINT house_messages_status_check CHECK (status IN (${HOUSE_MESSAGE_STATUSES})),
     audience_segment_id uuid        NULL REFERENCES segments (id) ON DELETE RESTRICT,
     audience_min_tier   smallint    NULL CONSTRAINT house_messages_audience_min_tier_check CHECK (audience_min_tier BETWEEN 1 AND 3),
     audience_label      text        NULL CONSTRAINT house_messages_audience_label_check CHECK (${line('audience_label', LABEL_MAX)}),
     send_at             timestamptz NULL,
     sent_at             timestamptz NULL,
     reach               integer     NULL CONSTRAINT house_messages_reach_check CHECK (reach >= 0),
     sent_by             uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     cancelled_at        timestamptz NULL,
     cancelled_by        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_by          uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at          timestamptz NOT NULL DEFAULT now(),
     updated_by          uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at          timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT house_messages_audience CHECK (status NOT IN ('DRAFT', 'SCHEDULED') OR num_nonnulls(audience_segment_id, audience_min_tier) = 1),
     CONSTRAINT house_messages_label CHECK (status <> 'SENT' OR audience_label IS NOT NULL),
     CONSTRAINT house_messages_send_at CHECK ((status IN ('SCHEDULED', 'SENT')) = (send_at IS NOT NULL)),
     CONSTRAINT house_messages_sent CHECK ((status = 'SENT') = (sent_at IS NOT NULL) AND (status = 'SENT') = (reach IS NOT NULL)),
     CONSTRAINT house_messages_cancelled CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL) AND (cancelled_at IS NULL) = (cancelled_by IS NULL)),
     CONSTRAINT house_messages_sent_by CHECK (CASE status WHEN 'DRAFT' THEN sent_by IS NULL WHEN 'SCHEDULED' THEN sent_by IS NOT NULL WHEN 'SENT' THEN sent_by IS NOT NULL ELSE true END)
   )`,
  // The sender loop: the SCHEDULED messages due, oldest first.
  `CREATE INDEX house_messages_due ON house_messages (status, send_at)`,
  // Each foreign key leads its own index (a segment's messages: SEGMENT_IN_USE).
  `CREATE INDEX house_messages_audience_segment_idx ON house_messages (audience_segment_id)`,
  `CREATE INDEX house_messages_sent_by_idx ON house_messages (sent_by)`,
  `CREATE INDEX house_messages_cancelled_by_idx ON house_messages (cancelled_by)`,
  `CREATE INDEX house_messages_created_by_idx ON house_messages (created_by)`,
  `CREATE INDEX house_messages_updated_by_idx ON house_messages (updated_by)`,
  `CREATE TRIGGER house_messages_immutable_identity BEFORE UPDATE ON house_messages
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_by', 'created_at')`,
  `CREATE TRIGGER house_messages_sent_immutable BEFORE UPDATE ON house_messages
     FOR EACH ROW WHEN (OLD.status = 'SENT') EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(SENT_COLUMNS)})`,
  `CREATE TRIGGER house_messages_sent_audience BEFORE UPDATE ON house_messages
     FOR EACH ROW WHEN (OLD.status = 'SENT' AND NEW.audience_segment_id IS NOT NULL AND NEW.audience_segment_id IS DISTINCT FROM OLD.audience_segment_id)
     EXECUTE FUNCTION orbes_reject_mutation('a sent house message keeps its audience')`,
  `CREATE TRIGGER house_messages_no_delete BEFORE DELETE ON house_messages
     FOR EACH ROW WHEN (OLD.status <> 'DRAFT') EXECUTE FUNCTION orbes_reject_mutation('only a draft house message is deleted')`,

  // ── house_deliveries ─────────────────────────────────────────────────────
  `CREATE TABLE house_deliveries (
     id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     account_id       uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     source           text        NOT NULL CONSTRAINT house_deliveries_source_check CHECK (source IN (${HOUSE_DELIVERY_SOURCES})),
     moment           text        NULL CONSTRAINT house_deliveries_moment_check CHECK (moment IN (${HOUSE_MOMENTS})),
     house_message_id uuid        NULL REFERENCES house_messages (id) ON DELETE RESTRICT,
     title            text        NULL CONSTRAINT house_deliveries_title_check CHECK (${line('title', DELIVERED_TITLE_MAX)}),
     body             text        NULL CONSTRAINT house_deliveries_body_check CHECK (${words('body', DELIVERED_BODY_MAX)}),
     piece_ref        text        NULL CONSTRAINT house_deliveries_piece_ref_check CHECK (piece_ref ~ '^O[0-9]{2}-[A-Z]-[0-9]{5,6}$'),
     dedupe_key       text        NOT NULL CONSTRAINT house_deliveries_dedupe_key_check CHECK (${line('dedupe_key', DEDUPE_MAX)}),
     delivered_at     timestamptz NOT NULL DEFAULT now(),
     read_at          timestamptz NULL,
     CONSTRAINT house_deliveries_dedupe_key UNIQUE (dedupe_key),
     CONSTRAINT house_deliveries_source CHECK (
       (source = 'MOMENT' AND moment IS NOT NULL AND title IS NOT NULL AND body IS NOT NULL AND house_message_id IS NULL)
       OR (source = 'CUSTOM' AND house_message_id IS NOT NULL AND moment IS NULL AND title IS NULL AND body IS NULL AND piece_ref IS NULL)),
     CONSTRAINT house_deliveries_piece CHECK (source <> 'MOMENT' OR (moment IN (${PIECE_MOMENTS})) = (piece_ref IS NOT NULL)),
     CONSTRAINT house_deliveries_read CHECK (read_at >= delivered_at)
   )`,
  // An account's messages, newest first (MESSAGES), and its unread ones (NOW's line, the counts).
  `CREATE INDEX house_deliveries_account_idx ON house_deliveries (account_id, delivered_at DESC)`,
  `CREATE INDEX house_deliveries_unread_idx ON house_deliveries (account_id) WHERE read_at IS NULL`,
  // A message's deliveries (its reach and reads); a moment's over time (the console's figures).
  `CREATE INDEX house_deliveries_message_idx ON house_deliveries (house_message_id)`,
  `CREATE INDEX house_deliveries_moment_idx ON house_deliveries (moment, delivered_at)`,
  `CREATE TRIGGER house_deliveries_immutable BEFORE UPDATE ON house_deliveries
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns(${quoted(DELIVERY_COLUMNS)})`,
  `CREATE TRIGGER house_deliveries_no_delete BEFORE DELETE ON house_deliveries
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('house messages are kept with the account')`,
  `CREATE TRIGGER house_deliveries_no_truncate BEFORE TRUNCATE ON house_deliveries
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('house messages are kept with the account')`,
];

export const DOWN: readonly string[] = [
  // The previous image knows no house message: refused while any setting, message or delivery exists.
  `DO $$
   DECLARE settings bigint; messages bigint; deliveries bigint;
   BEGIN
     SELECT count(*) INTO settings FROM house_moment_settings;
     SELECT count(*) INTO messages FROM house_messages;
     SELECT count(*) INTO deliveries FROM house_deliveries;
     IF settings > 0 OR messages > 0 OR deliveries > 0 THEN
       RAISE EXCEPTION 'migration 0052_house_messages cannot be rolled back: % moment settings, % house messages and % house deliveries exist', settings, messages, deliveries;
     END IF;
   END $$`,
  `DROP TABLE IF EXISTS house_deliveries`,
  `DROP TABLE IF EXISTS house_messages`,
  `DROP TABLE IF EXISTS house_moment_settings`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
