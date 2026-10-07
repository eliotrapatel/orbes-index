/**
 * 0026 — the club's program (plan NEXT-NINE of 2026-10-06, §3.2 BP-19 T2, T3 and T7, step 2.2: « Every value below is a
 * console setting »): the figures of the tiers' benefits, set in the console's Club → Tiers, THE PROGRAM; the optional
 * shipping rates of Orders → Settings, SHIPPING; a draw's early access by tier; a circle invitation's experience.
 *
 * `club_program_settings`: one row at most (`id` 1), none inserted: the defaults are the columns', as
 * `order_alert_settings` (0022). Each value, its default and its bounds:
 *   - the early access by default of a new draw, in hours before entries open to everyone: PALLADIUM 4 and PLATINE 2,
 *     each 0 (none) to 336, PALLADIUM's window at least PLATINE's (`club_program_settings_early_access`);
 *   - the free shipping of PLATINE (STANDARD) and PALLADIUM (EXPRESS): NONE, STANDARD or EXPRESS;
 *   - the yearly care: PLATINE 1 piece a year (0: none), PALLADIUM every piece (NULL) or a number, 0 to 20;
 *   - the tier from which the Messages board puts a conversation first and marks it: 2 PLATINE, 3 PALLADIUM, 0 off;
 *   - the welcome gift of PLATINE and of PALLADIUM: a model of the catalogue, or none (NULL, the default);
 *   - the credit of PLATINE (5000: € 50.00) and PALLADIUM (10000), 0 (none) to 100 000 000 in minor units, in one
 *     currency (EUR, GBP, USD or CHF), valid 12 months (1 to 60), on the channels named (DRAW, LIVE, SALON: at least one);
 *   - the lowest tier invited to the members' evening (2), the launch previews (3) and the partner experiences (3), 1 to 3;
 *   - who changed them last (`updated_by`) and when.
 *
 * `shipping_rates`: what an order's delivery costs below the free shipping of PLATINE and PALLADIUM, per currency (the
 * four of an order) and service (STANDARD, EXPRESS), 0 to 100 000 000 in minor units; optional, none inserted (an order
 * then carries no shipping, as before). One row per currency and service (the primary key).
 *
 * `drops.early_access_platine_hours`: PLATINE's early access of a draw, 0 to 336 hours, never longer than PALLADIUM's
 * (`early_access_hours`, which becomes PALLADIUM's window; its column default stays 48 for the previous image): NULL is
 * « from the same time as PALLADIUM », so every drop published before keeps its behaviour (`drops_platine_window`).
 * Never on a LIVE RELEASE (`drops_live_platine`).
 *
 * `circle_posts.experience`: what an invitation of the circle is (MEMBERS_EVENING, LAUNCH_PREVIEW, PARTNER_EXPERIENCE),
 * or NULL; on an INVITATION only (`circle_posts_experience`).
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. Compatible with the previous image: two tables
 * it never reads, and nullable columns it never names (it inserts drops and posts without them and reads them column by
 * column). No row is inserted. `down` drops the constraints, the columns and the two tables: the schema of 0025
 * exactly. One statement per array entry (PGlite's extended protocol); Kysely's Migrator applies the migration inside a
 * transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const SHIPPING_FREE = `'NONE','STANDARD','EXPRESS'`;
const SHIPPING_SERVICES = `'STANDARD','EXPRESS'`;
const CURRENCIES = `'EUR','GBP','USD','CHF'`;
const CREDIT_CHANNELS = `'DRAW','LIVE','SALON'`;
const EXPERIENCES = `'MEMBERS_EVENING','LAUNCH_PREVIEW','PARTNER_EXPERIENCE'`;

/** An amount, as an order's (0022): 0 to 1 000 000.00 in minor units. */
const AMOUNT_MAX = 100_000_000;
/** An early access, as 0017's: 0 to 336 hours (14 days). */
const HOURS_MAX = 336;

export const UP: readonly string[] = [
  // ── club_program_settings ────────────────────────────────────────────────
  `CREATE TABLE club_program_settings (
     id                                  smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     early_access_palladium_hours        smallint    NOT NULL DEFAULT 4 CHECK (early_access_palladium_hours BETWEEN 0 AND ${HOURS_MAX}),
     early_access_platine_hours          smallint    NOT NULL DEFAULT 2 CHECK (early_access_platine_hours BETWEEN 0 AND ${HOURS_MAX}),
     shipping_free_platine               text        NOT NULL DEFAULT 'STANDARD' CHECK (shipping_free_platine IN (${SHIPPING_FREE})),
     shipping_free_palladium             text        NOT NULL DEFAULT 'EXPRESS' CHECK (shipping_free_palladium IN (${SHIPPING_FREE})),
     care_pieces_platine                 smallint    NOT NULL DEFAULT 1 CHECK (care_pieces_platine BETWEEN 0 AND 20),
     care_pieces_palladium               smallint    NULL DEFAULT NULL CHECK (care_pieces_palladium BETWEEN 0 AND 20),
     messages_priority_min_tier          smallint    NOT NULL DEFAULT 2 CHECK (messages_priority_min_tier IN (0, 2, 3)),
     gift_platine_model_id               uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     gift_palladium_model_id             uuid        NULL REFERENCES models (id) ON DELETE RESTRICT,
     credit_platine_minor                integer     NOT NULL DEFAULT 5000 CHECK (credit_platine_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     credit_palladium_minor              integer     NOT NULL DEFAULT 10000 CHECK (credit_palladium_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     credit_currency                     text        NOT NULL DEFAULT 'EUR' CHECK (credit_currency IN (${CURRENCIES})),
     credit_validity_months              smallint    NOT NULL DEFAULT 12 CHECK (credit_validity_months BETWEEN 1 AND 60),
     credit_channels                     text[]      NOT NULL DEFAULT '{DRAW,LIVE,SALON}'
                                                     CHECK (credit_channels <@ ARRAY[${CREDIT_CHANNELS}]::text[] AND cardinality(credit_channels) >= 1),
     experience_members_evening_min_tier smallint    NOT NULL DEFAULT 2 CHECK (experience_members_evening_min_tier BETWEEN 1 AND 3),
     experience_launch_preview_min_tier  smallint    NOT NULL DEFAULT 3 CHECK (experience_launch_preview_min_tier BETWEEN 1 AND 3),
     experience_partner_min_tier         smallint    NOT NULL DEFAULT 3 CHECK (experience_partner_min_tier BETWEEN 1 AND 3),
     updated_by                          uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at                          timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT club_program_settings_early_access CHECK (early_access_platine_hours <= early_access_palladium_hours)
   )`,
  `CREATE INDEX club_program_settings_gift_platine_model_id_idx ON club_program_settings (gift_platine_model_id)`,
  `CREATE INDEX club_program_settings_gift_palladium_model_id_idx ON club_program_settings (gift_palladium_model_id)`,
  `CREATE INDEX club_program_settings_updated_by_idx ON club_program_settings (updated_by)`,

  // ── shipping_rates ───────────────────────────────────────────────────────
  `CREATE TABLE shipping_rates (
     currency   text        NOT NULL CHECK (currency IN (${CURRENCIES})),
     service    text        NOT NULL CHECK (service IN (${SHIPPING_SERVICES})),
     fee_minor  integer     NOT NULL CHECK (fee_minor BETWEEN 0 AND ${AMOUNT_MAX}),
     updated_by uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT shipping_rates_pkey PRIMARY KEY (currency, service)
   )`,
  `CREATE INDEX shipping_rates_updated_by_idx ON shipping_rates (updated_by)`,

  // ── drops: PLATINE's early access ────────────────────────────────────────
  `ALTER TABLE drops ADD COLUMN early_access_platine_hours smallint NULL CHECK (early_access_platine_hours BETWEEN 0 AND ${HOURS_MAX})`,
  `ALTER TABLE drops ADD CONSTRAINT drops_platine_window CHECK (early_access_platine_hours <= early_access_hours)`,
  `ALTER TABLE drops ADD CONSTRAINT drops_live_platine CHECK (mode = 'DRAW' OR early_access_platine_hours IS NULL)`,

  // ── circle_posts: an invitation's experience ─────────────────────────────
  `ALTER TABLE circle_posts ADD COLUMN experience text NULL CHECK (experience IN (${EXPERIENCES}))`,
  `ALTER TABLE circle_posts ADD CONSTRAINT circle_posts_experience CHECK (experience IS NULL OR kind = 'INVITATION')`,
];

export const DOWN: readonly string[] = [
  `ALTER TABLE circle_posts DROP CONSTRAINT IF EXISTS circle_posts_experience`,
  `ALTER TABLE circle_posts DROP COLUMN IF EXISTS experience`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_live_platine`,
  `ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_platine_window`,
  `ALTER TABLE drops DROP COLUMN IF EXISTS early_access_platine_hours`,
  `DROP TABLE IF EXISTS shipping_rates`,
  `DROP TABLE IF EXISTS club_program_settings`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
