/**
 * 0016 — the owners' circle (P-X01): what the console publishes for the
 * owners of an ORBES piece, read on /verify/circle by tier.
 *
 * `circle_posts`: one post, created by the console (OPERATOR) and published or
 * withdrawn from the circle (`published_at`, NULL while it is not shown).
 *  - `kind`: NOTE (text and photographs), INVITATION (an event: `event_at`,
 *    its `event_place` and its `capacity`, the places answered YES; NULL: no
 *    limit) or POLL (2 to 6 `poll_options`); the fields of one kind are never
 *    set on another (`circle_posts_invitation`, `circle_posts_invitation_only`,
 *    `circle_posts_poll`). A post never changes kind
 *    (`circle_posts_immutable_identity`).
 *  - `title` (at most 120 characters) and `body` (plain paragraphs, at most
 *    6 000);
 *  - `min_tier`: the lowest tier of the club that reads it, 1 TITANE (every
 *    owner, the default), 2 PLATINE or 3 PALLADIUM (services/club.ts);
 *  - its links, each optional: a drop (`drop_id`), a model of the lookbook
 *    (`model_id`) and an address in https (`external_url`, at most 500
 *    characters; the hosts it may name are the service's list).
 *
 * `circle_post_images`: the photographs of a post, at most 4 (`position` 1 to
 * 4, unique per post, deferred so a reorder may swap two positions inside its
 * transaction), each a `media_objects` row stored by MediaService, with its
 * alternative text (NULL: the post's default). A row never changes post,
 * photograph or author (`circle_post_images_immutable_identity`).
 *
 * `circle_rsvps`: an account's answer to an invitation, YES or NO, one per
 * account and post (the primary key); a new answer changes the row
 * (`updated_at`), never its post, account or creation
 * (`circle_rsvps_immutable_identity`). The YES are counted under the post's
 * row lock (FOR UPDATE), so they never pass its capacity.
 *
 * `circle_poll_votes`: an account's vote in a poll, one per account and post
 * (the primary key), by the index of its option (0 to 5); a vote is final
 * (`circle_poll_votes_final`).
 *
 * `circle_daily_visits`: the visits of the circle per UTC day, a count and
 * nothing else: no account, no address, no device.
 *
 * Every foreign key leads an index (the primary keys `post_id` first,
 * `circle_posts_drop_id_idx`, `circle_posts_model_id_idx`,
 * `circle_posts_created_by_idx`, `circle_post_images_sha256_idx`,
 * `circle_post_images_created_by_idx`, `circle_rsvps_account_idx`,
 * `circle_poll_votes_account_idx`); ON DELETE RESTRICT like every other.
 * Nothing in an older image reads or writes these tables. One statement per
 * array entry (PGlite's extended protocol); Kysely's Migrator applies the
 * migration inside a transaction. The down step drops the five tables: the
 * schema of 0015.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const POST_KINDS = `'NOTE','INVITATION','POLL'`;
const RSVP_ANSWERS = `'YES','NO'`;

export const UP: readonly string[] = [
  `CREATE TABLE circle_posts (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     kind         text        NOT NULL CHECK (kind IN (${POST_KINDS})),
     title        text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
     body         text        NULL CHECK (length(btrim(body)) BETWEEN 1 AND 6000),
     min_tier     smallint    NOT NULL DEFAULT 1 CHECK (min_tier BETWEEN 1 AND 3),
     event_at     timestamptz NULL,
     event_place  text        NULL CHECK (length(btrim(event_place)) BETWEEN 1 AND 200),
     capacity     int         NULL CHECK (capacity BETWEEN 1 AND 10000),
     poll_options text[]      NULL,
     drop_id      uuid        NULL REFERENCES drops (id) ON DELETE RESTRICT,
     model_id     uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     external_url text        NULL CHECK (external_url ~ '^https://[^\\s]+$' AND length(external_url) <= 500),
     published_at timestamptz NULL,
     created_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT circle_posts_invitation CHECK ((kind = 'INVITATION') = (event_at IS NOT NULL)),
     CONSTRAINT circle_posts_invitation_only CHECK (kind = 'INVITATION' OR (event_place IS NULL AND capacity IS NULL)),
     CONSTRAINT circle_posts_poll CHECK ((kind = 'POLL') = (poll_options IS NOT NULL)),
     CONSTRAINT circle_posts_poll_options CHECK (poll_options IS NULL OR (cardinality(poll_options) BETWEEN 2 AND 6 AND array_position(poll_options, NULL) IS NULL))
   )`,
  `CREATE INDEX circle_posts_drop_id_idx ON circle_posts (drop_id)`,
  `CREATE INDEX circle_posts_model_id_idx ON circle_posts (model_id)`,
  `CREATE INDEX circle_posts_created_by_idx ON circle_posts (created_by)`,
  // The feed: the posts published, the latest first.
  `CREATE INDEX circle_posts_published_idx ON circle_posts (published_at) WHERE published_at IS NOT NULL`,
  `CREATE TRIGGER circle_posts_immutable_identity BEFORE UPDATE ON circle_posts
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'kind', 'created_by', 'created_at')`,

  `CREATE TABLE circle_post_images (
     post_id    uuid        NOT NULL REFERENCES circle_posts (id) ON DELETE RESTRICT,
     sha256     text        NOT NULL REFERENCES media_objects (sha256) ON DELETE RESTRICT,
     position   smallint    NOT NULL CHECK (position BETWEEN 1 AND 4),
     alt        text        NULL CHECK (length(btrim(alt)) BETWEEN 1 AND 200),
     created_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (post_id, sha256),
     CONSTRAINT circle_post_images_position_key UNIQUE (post_id, position) DEFERRABLE INITIALLY DEFERRED
   )`,
  `CREATE INDEX circle_post_images_sha256_idx ON circle_post_images (sha256)`,
  `CREATE INDEX circle_post_images_created_by_idx ON circle_post_images (created_by)`,
  `CREATE TRIGGER circle_post_images_immutable_identity BEFORE UPDATE ON circle_post_images
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('post_id', 'sha256', 'created_by', 'created_at')`,

  `CREATE TABLE circle_rsvps (
     post_id    uuid        NOT NULL REFERENCES circle_posts (id) ON DELETE RESTRICT,
     account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     answer     text        NOT NULL CHECK (answer IN (${RSVP_ANSWERS})),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (post_id, account_id),
     CHECK (updated_at >= created_at)
   )`,
  `CREATE INDEX circle_rsvps_account_idx ON circle_rsvps (account_id, created_at)`,
  `CREATE TRIGGER circle_rsvps_immutable_identity BEFORE UPDATE ON circle_rsvps
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('post_id', 'account_id', 'created_at')`,

  `CREATE TABLE circle_poll_votes (
     post_id      uuid        NOT NULL REFERENCES circle_posts (id) ON DELETE RESTRICT,
     account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
     option_index smallint    NOT NULL CHECK (option_index BETWEEN 0 AND 5),
     created_at   timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (post_id, account_id)
   )`,
  `CREATE INDEX circle_poll_votes_account_idx ON circle_poll_votes (account_id, created_at)`,
  `CREATE TRIGGER circle_poll_votes_final BEFORE UPDATE ON circle_poll_votes
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('a vote is final')`,

  `CREATE TABLE circle_daily_visits (
     day    date PRIMARY KEY,
     visits int  NOT NULL DEFAULT 0 CHECK (visits >= 0)
   )`,
];

export const DOWN: readonly string[] = [
  `DROP TABLE IF EXISTS circle_daily_visits`,
  `DROP TABLE IF EXISTS circle_poll_votes`,
  `DROP TABLE IF EXISTS circle_rsvps`,
  `DROP TABLE IF EXISTS circle_post_images`,
  `DROP TABLE IF EXISTS circle_posts`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
