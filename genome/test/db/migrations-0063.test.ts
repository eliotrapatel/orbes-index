/**
 * Migration 0063_margin (lot M4, step M4.1; plan §1.2; macro scope K43 N1 and N2, D61): the margin's settings, on PGlite
 * here and on a real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a throwaway database; skipped without it), the
 * same cases on both:
 *  - down to 0062 without rows: exactly the schema of 0062 (PGlite: against a database migrated to 0062 alone), what it
 *    added (four tables, their CHECKs, keys, indexes, guards and stamps, nothing on another table), no row written, and
 *    up again the latest;
 *  - a euro rate per currency, three capital letters, never EUR, above 0 and at most 100 000 with six decimals; a
 *    shipping cost band per country or ALL OTHER COUNTRIES, once per upper limit, 1 to 100 000 g, its cost 0 to
 *    100 000 000; a unit cost per key (the pouch, the card, THE VAULT CARD, a care service and each claim outcome); an
 *    allowance per category of 0 to 10 000 hundredths of a percent; each stamped with its author (an admin or none, never
 *    deleted while named) and its update, its key never changed;
 *  - down refused while any of them exists, naming the four counts.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, PG_ERROR, pgError } from '../../src/server/db/pg-errors.js';
import { WARRANTY_CLAIM_OUTCOMES } from '../../src/server/db/schema.js';
import { createTestDb, type TestDb } from '../support/db.js';

const BEFORE = '0062_vault_rewards';
const NAME = '0063_margin';
const TABLES = ['currency_rates', 'shipping_cost_rates', 'margin_unit_costs', 'category_allowances'] as const;
const pgUrl = process.env.ORBES_TEST_POSTGRES_URL;

/** Every column, index, constraint and trigger of the public schema (as test/db/migrations.test.ts reads it). */
async function snapshotOf(db: Kysely<any>): Promise<string[]> {
  return (
    await sql<{ object: string }>`
      SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
      UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
      UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      ORDER BY 1`.execute(db)
  ).rows.map((r) => r.object);
}

/** Down to 0062 (0063 reverted). */
async function downTo0062(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0063 in a snapshot: the margin's four settings tables. */
const of0063 = (o: string) => /\b(currency_rates|shipping_cost_rates|margin_unit_costs|category_allowances)\b/.test(o);
/** A NOT NULL's own constraint entry: PGlite's PostgreSQL lists it among the constraints, PostgreSQL 16 does not. */
const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);

/**
 * The cases, on a database at the latest migration with no business data. They run in order: the down to 0062 without
 * rows first, then the rows, then the down refused.
 */
function cases(state: { db: () => Db; schemaAt0062: () => Promise<string[] | null> }) {
  const db = () => state.db();
  const run = (q: string) => sql.raw(q).execute(db());
  const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(db())).rows[0] as T;
  const count = async (table: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${table}`)).n);

  it('rolls back to the schema of 0062 exactly without rows, and applies again to the latest', async () => {
    const latest = await snapshotOf(db());
    expect(await downTo0062(db())).toEqual([NAME]);
    const before = await snapshotOf(db());
    const at0062 = await state.schemaAt0062();
    if (at0062) expect(before).toEqual(at0062);
    expect(before.filter(of0063)).toEqual([]);
    // What 0063 added: its four tables and nothing on another table; it took nothing away.
    const added = latest.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !latest.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0063(o))).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table category_allowances allowance_bp integer NO ',
      'table category_allowances category_id smallint NO ',
      'table category_allowances updated_at timestamp with time zone NO now()',
      'table category_allowances updated_by uuid YES ',
      'table currency_rates currency text NO ',
      'table currency_rates eur_rate numeric NO ',
      'table currency_rates updated_at timestamp with time zone NO now()',
      'table currency_rates updated_by uuid YES ',
      'table margin_unit_costs cost_minor bigint NO ',
      'table margin_unit_costs currency text NO ',
      'table margin_unit_costs key text NO ',
      'table margin_unit_costs updated_at timestamp with time zone NO now()',
      'table margin_unit_costs updated_by uuid YES ',
      'table shipping_cost_rates cost_minor bigint NO ',
      'table shipping_cost_rates country character YES ',
      'table shipping_cost_rates currency text NO ',
      'table shipping_cost_rates id uuid NO gen_random_uuid()',
      'table shipping_cost_rates max_weight_g integer NO ',
      'table shipping_cost_rates updated_at timestamp with time zone NO now()',
      'table shipping_cost_rates updated_by uuid YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      'constraint category_allowances category_allowances_allowance_bp_check CHECK (((allowance_bp >= 0) AND (allowance_bp <= 10000)))',
      'constraint category_allowances category_allowances_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT',
      'constraint category_allowances category_allowances_pkey PRIMARY KEY (category_id)',
      'constraint category_allowances category_allowances_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      "constraint currency_rates currency_rates_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))",
      'constraint currency_rates currency_rates_eur_rate_check CHECK (((eur_rate > (0)::numeric) AND (eur_rate <= (100000)::numeric)))',
      "constraint currency_rates currency_rates_not_eur CHECK ((currency <> 'EUR'::text))",
      'constraint currency_rates currency_rates_pkey PRIMARY KEY (currency)',
      'constraint currency_rates currency_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      'constraint margin_unit_costs margin_unit_costs_cost_minor_check CHECK (((cost_minor >= 0) AND (cost_minor <= 100000000)))',
      "constraint margin_unit_costs margin_unit_costs_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))",
      `constraint margin_unit_costs margin_unit_costs_key_check CHECK ((key = ANY (ARRAY[${['POUCH', 'CARD', 'VAULT_CARD', 'CARE_SERVICE', ...WARRANTY_CLAIM_OUTCOMES.map((o) => `CLAIM_${o}`)].map((k) => `'${k}'::text`).join(', ')}])))`,
      'constraint margin_unit_costs margin_unit_costs_pkey PRIMARY KEY (key)',
      'constraint margin_unit_costs margin_unit_costs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      'constraint shipping_cost_rates shipping_cost_rates_cost_minor_check CHECK (((cost_minor >= 0) AND (cost_minor <= 100000000)))',
      "constraint shipping_cost_rates shipping_cost_rates_country_check CHECK ((country ~ '^[A-Z]{2}$'::text))",
      "constraint shipping_cost_rates shipping_cost_rates_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))",
      'constraint shipping_cost_rates shipping_cost_rates_max_weight_g_check CHECK (((max_weight_g >= 1) AND (max_weight_g <= 100000)))',
      'constraint shipping_cost_rates shipping_cost_rates_pkey PRIMARY KEY (id)',
      'constraint shipping_cost_rates shipping_cost_rates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX category_allowances_updated_by_idx ON public.category_allowances USING btree (updated_by)',
      'index CREATE INDEX currency_rates_updated_by_idx ON public.currency_rates USING btree (updated_by)',
      'index CREATE INDEX margin_unit_costs_updated_by_idx ON public.margin_unit_costs USING btree (updated_by)',
      'index CREATE INDEX shipping_cost_rates_updated_by_idx ON public.shipping_cost_rates USING btree (updated_by)',
      'index CREATE UNIQUE INDEX category_allowances_pkey ON public.category_allowances USING btree (category_id)',
      'index CREATE UNIQUE INDEX currency_rates_pkey ON public.currency_rates USING btree (currency)',
      'index CREATE UNIQUE INDEX margin_unit_costs_pkey ON public.margin_unit_costs USING btree (key)',
      "index CREATE UNIQUE INDEX shipping_cost_rates_band_key ON public.shipping_cost_rates USING btree (COALESCE(country, '*'::bpchar), max_weight_g)",
      'index CREATE UNIQUE INDEX shipping_cost_rates_pkey ON public.shipping_cost_rates USING btree (id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger category_allowances category_allowances_immutable_key',
      'trigger category_allowances category_allowances_touch_updated_at',
      'trigger currency_rates currency_rates_immutable_key',
      'trigger currency_rates currency_rates_touch_updated_at',
      'trigger margin_unit_costs margin_unit_costs_immutable_key',
      'trigger margin_unit_costs margin_unit_costs_touch_updated_at',
      'trigger shipping_cost_rates shipping_cost_rates_immutable_key',
      'trigger shipping_cost_rates shipping_cost_rates_touch_updated_at',
    ]);
    // Up again: no row written; each guard holds its key.
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
    expect(await snapshotOf(db())).toEqual(latest);
    for (const table of TABLES) expect(await count(table), table).toBe(0);
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(db())).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args('currency_rates_immutable_key')).toEqual(['currency']);
    expect(await args('shipping_cost_rates_immutable_key')).toEqual(['id']);
    expect(await args('margin_unit_costs_immutable_key')).toEqual(['key']);
    expect(await args('category_allowances_immutable_key')).toEqual(['category_id']);
  });

  it('holds a euro rate per currency, three capital letters, never EUR, above 0 and at most 100 000 with six decimals; a shipping cost band per country or ALL OTHER COUNTRIES, once per upper limit; a unit cost per key (THE VAULT CARD\'s among them); an allowance per category of 0 to 10 000 hundredths of a percent; each stamped, its key never changed, its author never deleted', async () => {
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('margin-0063@orbes.test', 'margin-0063@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const nobody = '00000000-0000-4000-8000-000000000063';
    // A category of its own (this database has no business data; categories are never deleted).
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'M', 'Margin 0063') ON CONFLICT DO NOTHING`);
    const category = (await one<{ id: number }>(`SELECT id FROM categories ORDER BY id LIMIT 1`)).id;

    // ── currency_rates ──
    const rate = (currency: string, eurRate: string, by = `'${admin}'`) => run(`INSERT INTO currency_rates (currency, eur_rate, updated_by) VALUES (${currency}, ${eurRate}, ${by})`);
    await check(rate(`'EUR'`, '1'), 'EUR is 1, never set', 'currency_rates_not_eur');
    for (const [currency, label] of [[`'gbp'`, 'lower case'], [`'GB'`, 'two letters'], [`'GBPX'`, 'four letters'], [`'G1P'`, 'a digit'], [`''`, 'empty']] as const) {
      await check(rate(currency, '1.15'), label, 'currency_rates_currency_check');
    }
    for (const [value, label] of [['0', 'a rate of 0'], ['-1.15', 'a negative rate'], ['100000.000001', 'a rate above 100 000']] as const) {
      await check(rate(`'GBP'`, value), label, 'currency_rates_eur_rate_check');
    }
    await nullRefused(rate(`'GBP'`, 'NULL'), 'no rate');
    await expect(rate(`'GBP'`, '1.15', `'${nobody}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await rate(`'GBP'`, '1.15');
    await rate(`'JPY'`, '0.0061234567', 'NULL');
    await rate(`'CHF'`, '100000');
    await expect(rate(`'GBP'`, '1.2')).rejects.toSatisfy((e) => isUniqueViolation(e, 'currency_rates_pkey'));
    // Six decimals: read as its decimal text, rounded to the sixth.
    expect(await one(`SELECT currency, eur_rate::text AS eur_rate, updated_by FROM currency_rates WHERE currency = 'JPY'`)).toEqual({ currency: 'JPY', eur_rate: '0.006123', updated_by: null });
    expect(await one(`SELECT eur_rate::text AS eur_rate FROM currency_rates WHERE currency = 'GBP'`)).toEqual({ eur_rate: '1.150000' });
    // Its rate changed, its update stamped; its currency never changed.
    await run(`UPDATE currency_rates SET updated_at = '2026-10-01T10:00:00Z' WHERE currency = 'GBP'`);
    await run(`UPDATE currency_rates SET eur_rate = 1.17, updated_by = NULL WHERE currency = 'GBP'`);
    expect(await one(`SELECT eur_rate::text AS eur_rate, updated_by, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM currency_rates WHERE currency = 'GBP'`)).toEqual({ eur_rate: '1.170000', updated_by: null, stamped: true });
    await expect(run(`UPDATE currency_rates SET currency = 'USD' WHERE currency = 'GBP'`), 'a currency changed').rejects.toSatisfy(isGuardViolation);

    // ── shipping_cost_rates ──
    const band = (country: string, maxWeight: string, cost = '690', currency = `'EUR'`) =>
      run(`INSERT INTO shipping_cost_rates (country, max_weight_g, cost_minor, currency, updated_by) VALUES (${country}, ${maxWeight}, ${cost}, ${currency}, '${admin}')`);
    // (char(2): three letters overflow the column before the CHECK reads them.)
    for (const [country, label] of [[`'fr'`, 'a country in lower case'], [`'FRA'`, 'three letters'], [`'F'`, 'one letter'], [`'F1'`, 'a digit']] as const) {
      await expect(band(country, '500'), label).rejects.toSatisfy((e) => isCheckViolation(e, 'shipping_cost_rates_country_check') || pgError(e)?.code === '22001');
    }
    await check(band(`'FR'`, '0'), 'an upper limit of 0 g', 'shipping_cost_rates_max_weight_g_check');
    await check(band(`'FR'`, '100001'), 'an upper limit above a parcel\'s weight', 'shipping_cost_rates_max_weight_g_check');
    await check(band(`'FR'`, '500', '-1'), 'a negative cost', 'shipping_cost_rates_cost_minor_check');
    await check(band(`'FR'`, '500', '100000001'), 'a cost above 100 000 000', 'shipping_cost_rates_cost_minor_check');
    await check(band(`'FR'`, '500', '690', `'eur'`), 'a currency in lower case', 'shipping_cost_rates_currency_check');
    await nullRefused(band(`'FR'`, 'NULL'), 'no upper limit');
    await nullRefused(band(`'FR'`, '500', 'NULL'), 'no cost');
    await nullRefused(band(`'FR'`, '500', '690', 'NULL'), 'no currency');
    // One band per country and limit; ALL OTHER COUNTRIES (NULL) once per limit too, beside a country's.
    await band(`'FR'`, '500');
    await band(`'FR'`, '1000', '890');
    await band('NULL', '500', '1290');
    await band('NULL', '100000', '100000000', `'GBP'`);
    await band(`'GB'`, '1', '0', `'GBP'`);
    await expect(band(`'FR'`, '500', '700'), 'a country\'s band twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'shipping_cost_rates_band_key'));
    await expect(band('NULL', '500', '700'), 'ALL OTHER COUNTRIES\' band twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'shipping_cost_rates_band_key'));
    const fr500 = (await one<{ id: string }>(`SELECT id FROM shipping_cost_rates WHERE country = 'FR' AND max_weight_g = 500`)).id;
    expect(await one(`SELECT country, max_weight_g, cost_minor, currency, updated_by FROM shipping_cost_rates WHERE id = '${fr500}'`)).toEqual({ country: 'FR', max_weight_g: 500, cost_minor: 690, currency: 'EUR', updated_by: admin });
    // A band edited (its country, limit, cost and currency), its update stamped, onto a taken band refused; its id never changed.
    await run(`UPDATE shipping_cost_rates SET updated_at = '2026-10-01T10:00:00Z' WHERE id = '${fr500}'`);
    await run(`UPDATE shipping_cost_rates SET country = 'BE', max_weight_g = 750, cost_minor = 720, currency = 'CHF' WHERE id = '${fr500}'`);
    expect(await one(`SELECT country, max_weight_g, cost_minor, currency, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM shipping_cost_rates WHERE id = '${fr500}'`)).toEqual({
      country: 'BE', max_weight_g: 750, cost_minor: 720, currency: 'CHF', stamped: true,
    });
    await expect(run(`UPDATE shipping_cost_rates SET country = NULL, max_weight_g = 500 WHERE id = '${fr500}'`), 'onto ALL OTHER COUNTRIES\' band').rejects.toSatisfy((e) => isUniqueViolation(e, 'shipping_cost_rates_band_key'));
    await expect(run(`UPDATE shipping_cost_rates SET id = gen_random_uuid() WHERE id = '${fr500}'`), 'an id changed').rejects.toSatisfy(isGuardViolation);

    // ── margin_unit_costs ──
    const cost = (key: string, minor = '150', currency = `'EUR'`) => run(`INSERT INTO margin_unit_costs (key, cost_minor, currency, updated_by) VALUES (${key}, ${minor}, ${currency}, NULL)`);
    for (const key of [`'BOX'`, `'pouch'`, `'VAULT'`, `'THE_VAULT_CARD'`, `'CLAIM_UNKNOWN'`, `'CLAIM_'`, `''`]) await check(cost(key), `the key ${key}`, 'margin_unit_costs_key_check');
    await check(cost(`'POUCH'`, '-1'), 'a negative cost', 'margin_unit_costs_cost_minor_check');
    await check(cost(`'POUCH'`, '100000001'), 'a cost above 100 000 000', 'margin_unit_costs_cost_minor_check');
    await check(cost(`'POUCH'`, '150', `'EURO'`), 'a currency of four letters', 'margin_unit_costs_currency_check');
    await nullRefused(cost(`'POUCH'`, 'NULL'), 'no cost');
    // Every key once: the pouch, the card, THE VAULT CARD (D61), a care service and each claim outcome.
    const keys = ['POUCH', 'CARD', 'VAULT_CARD', 'CARE_SERVICE', ...WARRANTY_CLAIM_OUTCOMES.map((o) => `CLAIM_${o}`)];
    for (const key of keys) await cost(`'${key}'`, key === 'CARD' ? '0' : '100000000');
    expect(await count('margin_unit_costs')).toBe(11);
    await expect(cost(`'POUCH'`), 'a key twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'margin_unit_costs_pkey'));
    await expect(run(`UPDATE margin_unit_costs SET key = 'CARD' WHERE key = 'POUCH'`), 'a key changed').rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE margin_unit_costs SET updated_at = '2026-10-01T10:00:00Z' WHERE key = 'VAULT_CARD'`);
    await run(`UPDATE margin_unit_costs SET cost_minor = 45, currency = 'GBP', updated_by = '${admin}' WHERE key = 'VAULT_CARD'`);
    expect(await one(`SELECT cost_minor, currency, updated_by, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM margin_unit_costs WHERE key = 'VAULT_CARD'`)).toEqual({ cost_minor: 45, currency: 'GBP', updated_by: admin, stamped: true });

    // ── category_allowances ──
    const allowance = (bp: string, id: number | string = category) => run(`INSERT INTO category_allowances (category_id, allowance_bp, updated_by) VALUES (${id}, ${bp}, '${admin}')`);
    await check(allowance('-1'), 'a negative allowance', 'category_allowances_allowance_bp_check');
    await check(allowance('10001'), 'an allowance above 100 %', 'category_allowances_allowance_bp_check');
    await nullRefused(allowance('NULL'), 'no allowance');
    await expect(allowance('250', 0)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await allowance('10000');
    await expect(allowance('0'), 'a category twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'category_allowances_pkey'));
    await run(`UPDATE category_allowances SET updated_at = '2026-10-01T10:00:00Z' WHERE category_id = ${category}`);
    await run(`UPDATE category_allowances SET allowance_bp = 0 WHERE category_id = ${category}`);
    expect(await one(`SELECT allowance_bp, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM category_allowances WHERE category_id = ${category}`)).toEqual({ allowance_bp: 0, stamped: true });
    await expect(run(`UPDATE category_allowances SET category_id = category_id + 1 WHERE category_id = ${category}`), 'a category changed').rejects.toSatisfy(isGuardViolation);
    // A category named by an allowance is never deleted; an admin who set a row neither.
    await expect(run(`DELETE FROM categories WHERE id = ${category}`)).rejects.toThrow();
    await expect(run(`DELETE FROM admin_users WHERE id = '${admin}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
  });

  it('refuses to roll back while a currency rate, a shipping cost band, a unit cost or a category allowance exists, naming the counts', async () => {
    const counts = [await count('currency_rates'), await count('shipping_cost_rates'), await count('margin_unit_costs'), await count('category_allowances')];
    expect(counts).toEqual([3, 5, 11, 1]);
    const lastApplied = async () => (await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1);
    await expect(downTo0062(db())).rejects.toThrow('migration 0063_margin cannot be rolled back: 3 currency rates, 5 shipping cost bands, 11 unit costs and 1 category allowances exist');
    expect(await lastApplied()).toBe(NAME);
    // Each table counts on its own: one unit cost left still refuses.
    await run(`DELETE FROM currency_rates`);
    await run(`DELETE FROM shipping_cost_rates`);
    await run(`DELETE FROM margin_unit_costs WHERE key <> 'VAULT_CARD'`);
    await run(`DELETE FROM category_allowances`);
    await expect(downTo0062(db())).rejects.toThrow('migration 0063_margin cannot be rolled back: 0 currency rates, 0 shipping cost bands, 1 unit costs and 0 category allowances exist');
    expect(await lastApplied()).toBe(NAME);
    // Without rows it goes down, and up again.
    await run(`DELETE FROM margin_unit_costs`);
    expect(await downTo0062(db())).toEqual([NAME]);
    expect((await migrateToLatest(db())).applied).toEqual([NAME]);
  });
}

describe('migration 0063_margin (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0062: async () => {
      const fresh = await createTestDb({ migrated: false });
      try {
        const rs = await createMigrator(fresh.db).migrateTo(BEFORE);
        if (rs.error) throw rs.error;
        return await snapshotOf(fresh.db);
      } finally {
        await fresh.close();
      }
    },
  });
});

describe.skipIf(!pgUrl)('migration 0063_margin (PostgreSQL)', () => {
  let admin: Db;
  let db: Db;
  const dbName = `orbes_t_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(pgUrl!);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(admin);
    const u = new URL(pgUrl!);
    u.pathname = `/${dbName}`;
    db = createDb(u.toString(), { poolMax: 4 });
    await migrateToLatest(db);
  }, 120_000);
  afterAll(async () => {
    if (db) await closeDb(db).catch(() => undefined);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });
  cases({ db: () => db, schemaAt0062: async () => null });
});
