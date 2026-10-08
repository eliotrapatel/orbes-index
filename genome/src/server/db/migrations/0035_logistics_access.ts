/**
 * 0035 — LOGISTICS: the agent's access, the locations' addresses and the suppliers (plan NEXT LOT of 2026-10-07, §3.5.5.1,
 * step 5.1: « atelier->logistics page », « LOGISTICS + supplier orders »; « ORBES does not make its pieces: suppliers do »).
 *
 * `admin_users.role` accepts LOGISTICS: one console login per person at the logistics agent, ranked with RETAIL under
 * AUDITOR (http/sessions.ts ROLE_RANK), so the default rule (AUDITOR reads, OPERATOR writes) refuses it everywhere and
 * only the routes that name it (the Logistics routes, its own session, password and second factor) let it in.
 *
 * `admin_user_locations`: the locations a LOGISTICS login works at (one or more), one row per login and location; who tied
 * it (`created_by`, NULL for the shell) and when. Its rows exist only for LOGISTICS logins: the Team service
 * (services/auth.ts) requires at least one for LOGISTICS and deletes them in the same transaction when the role changes
 * away; a rule across two tables, so the service keeps it, with its test, rather than a CHECK.
 *
 * `stock_locations.address`: a location's postal address (1 to 500 characters, trimmed, line breaks kept), printed as
 * « Deliver to » on a supplier order's PDF and given to a collector as the return address. NULL: none yet.
 *
 * `suppliers`: the companies ORBES orders its pieces from. A `name` (1 to 120 characters, unique whatever the case), a
 * contact (`contact_name`, `email`, `phone`, `address`), the `currency` it bills in (an ISO 4217 code; the service accepts
 * only those with two decimals), a `note`, `active` (an inactive supplier stays on its orders and is offered for no new
 * draft), who added it and when. Never deleted (`suppliers_no_delete`): it is set inactive; its id and creation never
 * change.
 *
 * `models.supplier_id`, `skus.supplier_id`: « each model (or each size) has its supplier ». A size's own supplier
 * overrides its model's, and a variant without one uses its main model's (services/suppliers.ts supplierOf). NULL: none.
 *
 * Every foreign key leads an index; ON DELETE RESTRICT like every other. No row is written: no login is LOGISTICS, no
 * location has an address, no supplier exists. Compatible with the previous image: nullable columns and tables it never
 * reads, and a role it ranks 0 (refused everywhere). `down` refuses while a LOGISTICS login exists (the previous image
 * could not hold its role), naming the count, then drops everything this migration added: the schema of 0034 exactly
 * (nothing is rolled back in production). One statement per array entry (PGlite's extended protocol); Kysely's Migrator
 * applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal value lists, kept local on purpose (a migration never changes); test/db/schema.test.ts checks they match schema.ts.
const ROLES_0008 = `'ADMIN','OPERATOR','AUDITOR','RETAIL'`;
const ROLES = `'ADMIN','OPERATOR','AUDITOR','RETAIL','LOGISTICS'`;

/** Text of 1 to n characters, trimmed (line breaks inside kept). */
const trimmed = (column: string, max: number) => `char_length(${column}) BETWEEN 1 AND ${max} AND ${column} = btrim(${column})`;

export const UP: readonly string[] = [
  // ── admin_users: the LOGISTICS role ──────────────────────────────────────
  `ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check`,
  `ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN (${ROLES}))`,

  // ── admin_user_locations: a LOGISTICS login's locations ──────────────────
  `CREATE TABLE admin_user_locations (
     admin_user_id     uuid        NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     stock_location_id uuid        NOT NULL REFERENCES stock_locations (id) ON DELETE RESTRICT,
     created_at        timestamptz NOT NULL DEFAULT now(),
     created_by        uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
     PRIMARY KEY (admin_user_id, stock_location_id)
   )`,
  `CREATE INDEX admin_user_locations_location_idx ON admin_user_locations (stock_location_id)`,
  `CREATE INDEX admin_user_locations_created_by_idx ON admin_user_locations (created_by)`,

  // ── stock_locations: the postal address ─────────────────────────────────
  `ALTER TABLE stock_locations ADD COLUMN address text NULL CONSTRAINT stock_locations_address_check CHECK (${trimmed('address', 500)})`,

  // ── suppliers ────────────────────────────────────────────────────────────
  `CREATE TABLE suppliers (
     id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
     name         text        NOT NULL CHECK (${trimmed('name', 120)}),
     contact_name text        NULL CHECK (${trimmed('contact_name', 120)}),
     email        text        NULL CHECK (${trimmed('email', 254)}),
     phone        text        NULL CHECK (${trimmed('phone', 40)}),
     address      text        NULL CHECK (${trimmed('address', 500)}),
     currency     text        NULL CHECK (currency ~ '^[A-Z]{3}$'),
     note         text        NULL CHECK (${trimmed('note', 1000)}),
     active       boolean     NOT NULL DEFAULT true,
     created_at   timestamptz NOT NULL DEFAULT now(),
     created_by   uuid        NULL REFERENCES admin_users (id) ON DELETE RESTRICT
   )`,
  `CREATE UNIQUE INDEX suppliers_name_key ON suppliers (lower(name))`,
  `CREATE INDEX suppliers_created_by_idx ON suppliers (created_by)`,
  `CREATE TRIGGER suppliers_immutable_identity BEFORE UPDATE ON suppliers
     FOR EACH ROW EXECUTE FUNCTION orbes_guard_immutable_columns('id', 'created_at', 'created_by')`,
  `CREATE TRIGGER suppliers_no_delete BEFORE DELETE ON suppliers
     FOR EACH ROW EXECUTE FUNCTION orbes_reject_mutation('suppliers are set inactive, never deleted')`,
  `CREATE TRIGGER suppliers_no_truncate BEFORE TRUNCATE ON suppliers
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('suppliers are set inactive, never deleted')`,

  // ── a model's supplier, and a size's own ─────────────────────────────────
  `ALTER TABLE models ADD COLUMN supplier_id uuid NULL CONSTRAINT models_supplier_id_fkey REFERENCES suppliers (id) ON DELETE RESTRICT`,
  `CREATE INDEX models_supplier_id_idx ON models (supplier_id)`,
  `ALTER TABLE skus ADD COLUMN supplier_id uuid NULL CONSTRAINT skus_supplier_id_fkey REFERENCES suppliers (id) ON DELETE RESTRICT`,
  `CREATE INDEX skus_supplier_id_idx ON skus (supplier_id)`,
];

export const DOWN: readonly string[] = [
  // The previous image cannot hold a LOGISTICS login: refused while any exists.
  `DO $$
   DECLARE logins bigint;
   BEGIN
     SELECT count(*) INTO logins FROM admin_users WHERE role = 'LOGISTICS';
     IF logins > 0 THEN
       RAISE EXCEPTION 'migration 0035_logistics_access cannot be rolled back: % LOGISTICS logins exist', logins;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS skus_supplier_id_idx`,
  `ALTER TABLE skus DROP COLUMN IF EXISTS supplier_id`,
  `DROP INDEX IF EXISTS models_supplier_id_idx`,
  `ALTER TABLE models DROP COLUMN IF EXISTS supplier_id`,
  `DROP TABLE IF EXISTS suppliers`,
  `ALTER TABLE stock_locations DROP COLUMN IF EXISTS address`,
  `DROP TABLE IF EXISTS admin_user_locations`,
  `ALTER TABLE admin_users DROP CONSTRAINT admin_users_role_check`,
  `ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN (${ROLES_0008}))`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
