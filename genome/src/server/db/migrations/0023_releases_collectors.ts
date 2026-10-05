/**
 * 0023 — releases and collectors (plan LIVE RELEASE+ of 2026-10-04, steps S5 to S9): the after-room, the surprise, the
 * access by participation and by segment and how a release's rules combine, the question after, the segments, and the
 * activity by hour the best time to open is read from.
 *
 * On `drops`, LIVE only (`drops_draw_plus`: every one NULL for a DRAW):
 *  - `parent_drop_id`: an after-room (A3) is a child LIVE RELEASE of the release it follows, one at most per release
 *    (`drops_parent_drop_id_key`), never its own parent; `after_room_delay_minutes` (1 to 60: it opens that long after
 *    the parent's sell-out, 10 by default) and `after_room_length_minutes` (5 to 120: open that long, 15 by default),
 *    both exactly with a parent (`drops_after_room`). Until the parent sells out it is a DRAFT whose times say the latest
 *    it could open; at the sell-out it is published (`published_at` the sell-out, `opens_at` that plus its delay,
 *    `closes_at` that plus its length) for the guests remembered then, or cancelled when the parent ends otherwise. Its
 *    access is its guest list alone, and it inherits the parent's surprise and asks no question: `drops_after_room`
 *    keeps it at tier 0, without a model or collection rule, a staged reveal, a board link, a surprise of its own, a
 *    participation or segment rule, a way to combine rules, or a question (`surprise_enabled` and `question_enabled`
 *    false);
 *  - `surprise_enabled` and `surprise_text` (A4): one surprise in every box, its description internal (1 to 500
 *    characters, as `orders.surprise` and `bench_items.surprise` keep it), required once enabled (`drops_surprise`);
 *  - `min_participations` (A5): the releases (1 to 100) a collector has taken part in to enter; `access_segment_id`
 *    (N5): a segment whose members may enter; `access_combine`: AND or OR, how every rule of the release combines;
 *  - `question_enabled`, `question_text` (1 to 120 characters) and `question_answers` (2 to 6, none NULL), the question
 *    after (G4), the text and the answers both or neither (`drops_question`; neither: the default question).
 * NULL on a LIVE drop reads as the setting's default (no surprise, no participation or segment rule, AND, the default
 * question): the previous image creates LIVE drops without these columns.
 *
 * `after_room_guests`: the parent's entries still WAITING or QUEUED at its sell-out (the ones the sell-out ENDED), each
 * remembered once (`after_room_guests_entry_key`) with its `position` in the after-room's line (1, 2, 3…, unique per
 * after-room: their order in the parent's line), when (`remembered_at`). Never changed.
 *
 * `release_answers`: a collector's answer to a release's question after (G4), one per account and release, its
 * `answer` the position of the answer chosen (1 to 6), changeable: `answered_at` is the latest.
 *
 * `segments` (N5): a saved group of collectors, by `name` (1 to 60 characters, unique whatever the case), its
 * `criteria` a rule tree (a JSON object), who created it and when, `updated_at`; `circle_posts.segment_id`: a post shown
 * to a segment's members.
 *
 * `activity_hourly` (G3): the sign-ins and the scans counted per hour (`hour`, a whole UTC hour), country (two capital
 * letters, ZZ unknown, as scan_daily_stats) and tier (0 to 3): aggregates, no account id.
 *
 * Every foreign key leads an index (`drops_parent_drop_id_key`, `drops_access_segment_id_idx`, the primary keys,
 * `after_room_guests_entry_key`, `release_answers_account_idx`, `segments_created_by_idx`,
 * `circle_posts_segment_id_idx`); ON DELETE RESTRICT like every other. Compatible with the previous image: new nullable
 * columns it never names (it inserts drops and posts without them and reads them column by column), new tables it never
 * reads. No row is inserted. `down` cancels the after-rooms that have not ended (the previous image would show them as
 * releases of their own), drops the five tables, then the columns and constraints this migration added: the schema of
 * 0022 exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration
 * inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value list, kept local on purpose (a migration never changes); test/db/schema.test.ts checks it matches schema.ts.
const ACCESS_COMBINES = `'AND','OR'`;

/** Text of 1 to n characters once trimmed. */
const words = (column: string, max: number) => `length(btrim(${column})) BETWEEN 1 AND ${max}`;

/** The columns of `drops` this migration adds, every one LIVE only. */
const LIVE_ONLY = [
  'parent_drop_id', 'after_room_delay_minutes', 'after_room_length_minutes', 'surprise_enabled', 'surprise_text', 'min_participations', 'access_segment_id',
  'access_combine', 'question_enabled', 'question_text', 'question_answers',
];

export const UP: readonly string[] = [
  // ── segments ─────────────────────────────────────────────────────────────
  `CREATE TABLE segments (
     id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 60 AND name = btrim(name)),
     criteria   jsonb       NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT segments_updated_after CHECK (updated_at >= created_at)
   )`,
  `CREATE UNIQUE INDEX segments_name_key ON segments (lower(name))`,
  `CREATE INDEX segments_created_by_idx ON segments (created_by)`,
  `CREATE TRIGGER segments_immutable_identity BEFORE UPDATE ON segments
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_by', 'created_at')`,

  // ── drops: the after-room, the surprise, the access rules, the question after ──
  `ALTER TABLE drops ADD COLUMN parent_drop_id uuid NULL CONSTRAINT drops_parent_drop_id_fkey REFERENCES drops (id) ON DELETE RESTRICT`,
  `ALTER TABLE drops ADD COLUMN after_room_delay_minutes smallint NULL CONSTRAINT drops_after_room_delay_minutes_check CHECK (after_room_delay_minutes BETWEEN 1 AND 60)`,
  `ALTER TABLE drops ADD COLUMN after_room_length_minutes smallint NULL CONSTRAINT drops_after_room_length_minutes_check CHECK (after_room_length_minutes BETWEEN 5 AND 120)`,
  `ALTER TABLE drops ADD COLUMN surprise_enabled boolean NULL`,
  `ALTER TABLE drops ADD COLUMN surprise_text text NULL CONSTRAINT drops_surprise_text_check CHECK (${words('surprise_text', 500)})`,
  `ALTER TABLE drops ADD COLUMN min_participations smallint NULL CONSTRAINT drops_min_participations_check CHECK (min_participations BETWEEN 1 AND 100)`,
  `ALTER TABLE drops ADD COLUMN access_segment_id uuid NULL CONSTRAINT drops_access_segment_id_fkey REFERENCES segments (id) ON DELETE RESTRICT`,
  `ALTER TABLE drops ADD COLUMN access_combine text NULL CONSTRAINT drops_access_combine_check CHECK (access_combine IN (${ACCESS_COMBINES}))`,
  `ALTER TABLE drops ADD COLUMN question_enabled boolean NULL`,
  `ALTER TABLE drops ADD COLUMN question_text text NULL CONSTRAINT drops_question_text_check CHECK (${words('question_text', 120)})`,
  `ALTER TABLE drops ADD COLUMN question_answers text[] NULL CONSTRAINT drops_question_answers_check CHECK (cardinality(question_answers) BETWEEN 2 AND 6 AND array_position(question_answers, NULL) IS NULL)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_draw_plus CHECK (mode = 'LIVE' OR (${LIVE_ONLY.map((c) => `${c} IS NULL`).join(' AND ')}))`,
  `ALTER TABLE drops ADD CONSTRAINT drops_after_room CHECK (
     (parent_drop_id IS NULL) = (after_room_delay_minutes IS NULL)
     AND (parent_drop_id IS NULL) = (after_room_length_minutes IS NULL)
     AND (parent_drop_id IS NULL OR (
       parent_drop_id <> id AND live_min_tier = 0 AND access_collection_id IS NULL
       AND announce_at IS NULL AND silhouette_at IS NULL AND name_at IS NULL AND photo_at IS NULL AND silhouette_sha256 IS NULL
       AND board_token_hash IS NULL
       AND surprise_enabled IS FALSE AND surprise_text IS NULL
       AND min_participations IS NULL AND access_segment_id IS NULL AND access_combine IS NULL
       AND question_enabled IS FALSE AND question_text IS NULL AND question_answers IS NULL)))`,
  `ALTER TABLE drops ADD CONSTRAINT drops_surprise CHECK (surprise_enabled IS NOT TRUE OR surprise_text IS NOT NULL)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_question CHECK ((question_text IS NULL) = (question_answers IS NULL))`,
  // One after-room per release, found from its parent.
  `CREATE UNIQUE INDEX drops_parent_drop_id_key ON drops (parent_drop_id)`,
  `CREATE INDEX drops_access_segment_id_idx ON drops (access_segment_id)`,

  // ── after_room_guests ────────────────────────────────────────────────────
  `CREATE TABLE after_room_guests (
     drop_id       uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     entry_id      uuid        NOT NULL REFERENCES live_entries (id) ON DELETE RESTRICT,
     position      integer     NOT NULL CHECK (position >= 1),
     remembered_at timestamptz NOT NULL,
     PRIMARY KEY (drop_id, entry_id),
     CONSTRAINT after_room_guests_position_key UNIQUE (drop_id, position),
     CONSTRAINT after_room_guests_entry_key UNIQUE (entry_id)
   )`,
  `CREATE TRIGGER after_room_guests_immutable BEFORE UPDATE ON after_room_guests
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('an after-room''s guests never change')`,

  // ── release_answers ──────────────────────────────────────────────────────
  `CREATE TABLE release_answers (
     drop_id     uuid        NOT NULL REFERENCES drops (id) ON DELETE RESTRICT,
     account_id  uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     answer      smallint    NOT NULL CHECK (answer BETWEEN 1 AND 6),
     answered_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (drop_id, account_id)
   )`,
  `CREATE INDEX release_answers_account_idx ON release_answers (account_id)`,
  `CREATE TRIGGER release_answers_immutable_identity BEFORE UPDATE ON release_answers
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('drop_id', 'account_id')`,

  // ── circle_posts: a post for a segment ───────────────────────────────────
  `ALTER TABLE circle_posts ADD COLUMN segment_id uuid NULL CONSTRAINT circle_posts_segment_id_fkey REFERENCES segments (id) ON DELETE RESTRICT`,
  `CREATE INDEX circle_posts_segment_id_idx ON circle_posts (segment_id)`,

  // ── activity_hourly ──────────────────────────────────────────────────────
  `CREATE TABLE activity_hourly (
     hour     timestamptz NOT NULL CHECK (extract(epoch FROM hour) % 3600 = 0),
     country  char(2)     NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
     tier     smallint    NOT NULL CHECK (tier BETWEEN 0 AND 3),
     sign_ins integer     NOT NULL DEFAULT 0 CHECK (sign_ins >= 0),
     scans    integer     NOT NULL DEFAULT 0 CHECK (scans >= 0),
     PRIMARY KEY (hour, country, tier)
   )`,
];

const DROPS_CONSTRAINTS = ['drops_question', 'drops_surprise', 'drops_after_room', 'drops_draw_plus'];

export const DOWN: readonly string[] = [
  // The previous image reads an after-room as a release of its own: one that has not ended is cancelled, so it never
  // shows in THE RELEASES nor in the console as a draft to publish there.
  `UPDATE drops SET cancelled_at = now() WHERE parent_drop_id IS NOT NULL AND cancelled_at IS NULL AND ended_at IS NULL`,
  `DROP TABLE IF EXISTS activity_hourly`,
  `DROP INDEX IF EXISTS circle_posts_segment_id_idx`,
  `ALTER TABLE circle_posts DROP COLUMN IF EXISTS segment_id`,
  `DROP TABLE IF EXISTS release_answers`,
  `DROP TABLE IF EXISTS after_room_guests`,
  `DROP INDEX IF EXISTS drops_access_segment_id_idx`,
  `DROP INDEX IF EXISTS drops_parent_drop_id_key`,
  ...DROPS_CONSTRAINTS.map((c) => `ALTER TABLE drops DROP CONSTRAINT IF EXISTS ${c}`),
  ...[...LIVE_ONLY].reverse().map((c) => `ALTER TABLE drops DROP COLUMN IF EXISTS ${c}`),
  `DROP TABLE IF EXISTS segments`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
