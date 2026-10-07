/**
 * 0031 — PAIRS WELL WITH (plan NEXT-NINE of 2026-10-06, §3.7 BP-34, step 7.1: « Staff pick 2 or 3 models per model in
 * the console … It sits only at the END of the model's page, like a shop's "see more" »).
 *
 * `model_pairs`: the models a model's sheet shows at its very end, in their order. One row per model and place
 * (PRIMARY KEY (model_id, position), which leads with the model's foreign key), `position` 1 to 3; a model paired once
 * per model (`model_pairs_model_paired_key`), never with itself (`model_pairs_not_self`); who picked it and when. Every
 * other foreign key leads an index of its own (`paired_model_id`, `created_by`). The rules a CHECK cannot hold live in
 * the service (services/catalog.ts setPairs): `model_id` is a main model or a model alone, a pair is never of its own
 * variant group, and a model has 0, 2 or 3 rows.
 *
 * Compatible with the previous image: a table it never reads. No row is inserted. `down` drops it: the schema of 0030
 * exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a
 * transaction.
 */
import { sql, type Kysely } from 'kysely';

export const UP: readonly string[] = [
  `CREATE TABLE model_pairs (
     model_id        uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     position        smallint    NOT NULL CONSTRAINT model_pairs_position_check CHECK (position BETWEEN 1 AND 3),
     paired_model_id uuid        NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
     created_at      timestamptz NOT NULL DEFAULT now(),
     created_by      uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     PRIMARY KEY (model_id, position),
     CONSTRAINT model_pairs_not_self CHECK (paired_model_id <> model_id),
     CONSTRAINT model_pairs_model_paired_key UNIQUE (model_id, paired_model_id)
   )`,
  `CREATE INDEX model_pairs_paired_model_idx ON model_pairs (paired_model_id)`,
  `CREATE INDEX model_pairs_created_by_idx ON model_pairs (created_by)`,
];

export const DOWN: readonly string[] = [`DROP TABLE IF EXISTS model_pairs`];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
