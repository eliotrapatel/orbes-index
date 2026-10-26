/**
 * Migration 0064_partners (lot M4, step M4.5; plan §2.2; macro scope K49 P1 to P4): the partners, their experiences, their
 * invoices in their own series, an invitation's experience and a guest's name shared, on PGlite here and on a real
 * PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a throwaway database; skipped without it), the same cases on both:
 *  - down to 0063 without rows: exactly the schema of 0063 (PGlite: against a database migrated to 0063 alone), what it
 *    added (three tables with their CHECKs, keys, indexes and guards; circle_posts.partner_experience_id; circle_rsvps'
 *    share_name and share_name_at; nothing else), no row written, and up again the latest;
 *  - a partner's brand of one line, 1 to 80 characters, once whatever the case, its contact, billing details and note
 *    within their bounds, set aside and never deleted; an experience's title, date, amount of 1 to 100 000 000 in a house
 *    currency, DRAFT → INVOICED → PAID or CANCELLED each with its own times, never deleted; a partner invoice or credit
 *    note numbered per kind and UTC year apart from the collectors', one invoice per experience, a credit note once per
 *    invoice, as issued and never changed; an invitation linked to a PARTNER_EXPERIENCE only; a name shared on a YES
 *    only, with its time;
 *  - down refused while a partner, an experience, a partner invoice, a linked invitation or a shared name exists, naming
 *    the counts.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, PG_ERROR, pgError } from '../../src/server/db/pg-errors.js';
import { createTestDb, type TestDb } from '../support/db.js';

const BEFORE = '0063_margin';
const NAME = '0064_partners';
/** The migration after it (lot M4, step M4.9: the ad conversions), taken down first and applied again with it. */
const LATER = '0065_ad_conversions';
const TABLES = ['partners', 'partner_experiences', 'partner_invoices'] as const;
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

/** Down to 0063 (0065, then 0064, reverted). */
async function downTo0063(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0064 in a snapshot: its three tables, the invitations' experience and the answers' shared name. */
const of0064 = (o: string) =>
  /\b(partners|partner_experiences|partner_invoices|partner_experience_id|circle_posts_partner_experience|circle_posts_partner_experience_id_fkey|circle_posts_partner_experience_idx|share_name|share_name_at|circle_rsvps_share_name|circle_rsvps_share_name_yes)\b/.test(o);
/** A NOT NULL's own constraint entry: PGlite's PostgreSQL lists it among the constraints, PostgreSQL 16 does not. */
const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);

/**
 * The cases, on a database at the latest migration with no business data. They run in order: the down to 0063 without
 * rows first, then the rows, then the down refused.
 */
function cases(state: { db: () => Db; schemaAt0063: () => Promise<string[] | null> }) {
  const db = () => state.db();
  const run = (q: string) => sql.raw(q).execute(db());
  const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(db())).rows[0] as T;
  const count = async (from: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`)).n);

  it('rolls back to the schema of 0063 exactly without rows: what 0064 added (three tables, an invitation\'s experience, an answer\'s shared name), nothing else; and applies again to the latest', async () => {
    const latest = await snapshotOf(db());
    // 0065 down first: the schema 0064 left, which this case reads.
    const rs = await createMigrator(db()).migrateTo(NAME);
    if (rs.error) throw rs.error;
    const withIt = await snapshotOf(db());
    expect(await downTo0063(db())).toEqual([NAME]);
    const before = await snapshotOf(db());
    const at0063 = await state.schemaAt0063();
    if (at0063) expect(before).toEqual(at0063);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0064(o))).toEqual([]);
    expect(before.filter(of0064)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table circle_posts partner_experience_id uuid YES ',
      'table circle_rsvps share_name boolean NO false',
      'table circle_rsvps share_name_at timestamp with time zone YES ',
      'table partner_experiences amount_minor bigint NO ',
      'table partner_experiences cancelled_at timestamp with time zone YES ',
      'table partner_experiences cancelled_by uuid YES ',
      'table partner_experiences created_at timestamp with time zone NO now()',
      'table partner_experiences created_by uuid YES ',
      'table partner_experiences currency text NO ',
      'table partner_experiences event_on date NO ',
      'table partner_experiences id uuid NO gen_random_uuid()',
      'table partner_experiences invoiced_at timestamp with time zone YES ',
      'table partner_experiences note text YES ',
      'table partner_experiences paid_on date YES ',
      'table partner_experiences paid_recorded_at timestamp with time zone YES ',
      'table partner_experiences paid_recorded_by uuid YES ',
      'table partner_experiences partner_id uuid NO ',
      "table partner_experiences status text NO 'DRAFT'::text",
      'table partner_experiences title text NO ',
      'table partner_experiences updated_at timestamp with time zone NO now()',
      'table partner_invoices buyer jsonb NO ',
      'table partner_invoices credits_invoice_id uuid YES ',
      'table partner_invoices currency text NO ',
      'table partner_invoices experience_id uuid NO ',
      'table partner_invoices id uuid NO gen_random_uuid()',
      'table partner_invoices issued_at timestamp with time zone NO now()',
      'table partner_invoices issued_by uuid YES ',
      'table partner_invoices issuer jsonb NO ',
      'table partner_invoices kind text NO ',
      'table partner_invoices lines jsonb NO ',
      'table partner_invoices sequence integer NO ',
      'table partner_invoices total_minor bigint NO ',
      'table partner_invoices year smallint NO ',
      'table partners active boolean NO true',
      'table partners billing_address text YES ',
      'table partners billing_country character YES ',
      'table partners billing_name text YES ',
      'table partners brand text NO ',
      'table partners company_number text YES ',
      'table partners contact_email text YES ',
      'table partners contact_name text YES ',
      'table partners contact_phone text YES ',
      'table partners created_at timestamp with time zone NO now()',
      'table partners created_by uuid YES ',
      'table partners id uuid NO gen_random_uuid()',
      'table partners note text YES ',
      'table partners updated_at timestamp with time zone NO now()',
    ]);
    const constraints = added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(0, 3).join(' '));
    expect(constraints).toEqual([
      'constraint circle_posts circle_posts_partner_experience',
      'constraint circle_posts circle_posts_partner_experience_id_fkey',
      'constraint circle_rsvps circle_rsvps_share_name',
      'constraint circle_rsvps circle_rsvps_share_name_yes',
      'constraint partner_experiences partner_experiences_amount_minor_check',
      'constraint partner_experiences partner_experiences_by',
      'constraint partner_experiences partner_experiences_cancelled_by_fkey',
      'constraint partner_experiences partner_experiences_created_by_fkey',
      'constraint partner_experiences partner_experiences_currency_check',
      'constraint partner_experiences partner_experiences_note_check',
      'constraint partner_experiences partner_experiences_paid',
      'constraint partner_experiences partner_experiences_paid_recorded_by_fkey',
      'constraint partner_experiences partner_experiences_partner_id_fkey',
      'constraint partner_experiences partner_experiences_pkey',
      'constraint partner_experiences partner_experiences_status_check',
      'constraint partner_experiences partner_experiences_status_times',
      'constraint partner_experiences partner_experiences_times',
      'constraint partner_experiences partner_experiences_title_check',
      'constraint partner_invoices partner_invoices_buyer_check',
      'constraint partner_invoices partner_invoices_credit',
      'constraint partner_invoices partner_invoices_credits_invoice_id_fkey',
      'constraint partner_invoices partner_invoices_credits_key',
      'constraint partner_invoices partner_invoices_currency_check',
      'constraint partner_invoices partner_invoices_experience_id_fkey',
      'constraint partner_invoices partner_invoices_issued_by_fkey',
      'constraint partner_invoices partner_invoices_issuer_check',
      'constraint partner_invoices partner_invoices_kind_check',
      'constraint partner_invoices partner_invoices_lines_check',
      'constraint partner_invoices partner_invoices_number_key',
      'constraint partner_invoices partner_invoices_pkey',
      'constraint partner_invoices partner_invoices_sequence_check',
      'constraint partner_invoices partner_invoices_total_minor_check',
      'constraint partner_invoices partner_invoices_year_check',
      'constraint partners partners_billing_address_check',
      'constraint partners partners_billing_country_check',
      'constraint partners partners_billing_name_check',
      'constraint partners partners_brand_check',
      'constraint partners partners_company_number_check',
      'constraint partners partners_contact_email_check',
      'constraint partners partners_contact_name_check',
      'constraint partners partners_contact_phone_check',
      'constraint partners partners_created_by_fkey',
      'constraint partners partners_note_check',
      'constraint partners partners_pkey',
    ]);
    // The rules that hold the data, as PostgreSQL reads them back.
    for (const c of [
      "constraint circle_posts circle_posts_partner_experience CHECK (((partner_experience_id IS NULL) OR (NOT (experience IS DISTINCT FROM 'PARTNER_EXPERIENCE'::text))))",
      'constraint circle_posts circle_posts_partner_experience_id_fkey FOREIGN KEY (partner_experience_id) REFERENCES partner_experiences(id) ON DELETE RESTRICT',
      'constraint circle_rsvps circle_rsvps_share_name CHECK ((share_name = (share_name_at IS NOT NULL)))',
      "constraint circle_rsvps circle_rsvps_share_name_yes CHECK (((NOT share_name) OR (answer = 'YES'::text)))",
      'constraint partner_experiences partner_experiences_amount_minor_check CHECK (((amount_minor >= 1) AND (amount_minor <= 100000000)))',
      'constraint partner_experiences partner_experiences_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT',
      'constraint partner_invoices partner_invoices_number_key UNIQUE (kind, year, sequence)',
      'constraint partner_invoices partner_invoices_credits_key UNIQUE (credits_invoice_id)',
      "constraint partner_invoices partner_invoices_credit CHECK (((kind = 'CREDIT_NOTE'::text) = (credits_invoice_id IS NOT NULL)))",
      'constraint partner_invoices partner_invoices_credits_invoice_id_fkey FOREIGN KEY (credits_invoice_id) REFERENCES partner_invoices(id) ON DELETE RESTRICT',
      'constraint partner_invoices partner_invoices_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES partner_experiences(id) ON DELETE RESTRICT',
      'constraint partners partners_created_by_fkey FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      "constraint partners partners_billing_country_check CHECK ((billing_country ~ '^[A-Z]{2}$'::text))",
    ]) {
      expect(added, c).toContain(c);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX circle_posts_partner_experience_idx ON public.circle_posts USING btree (partner_experience_id)',
      'index CREATE INDEX partner_experiences_cancelled_by_idx ON public.partner_experiences USING btree (cancelled_by)',
      'index CREATE INDEX partner_experiences_created_by_idx ON public.partner_experiences USING btree (created_by)',
      'index CREATE INDEX partner_experiences_paid_on_idx ON public.partner_experiences USING btree (paid_on) WHERE (paid_on IS NOT NULL)',
      'index CREATE INDEX partner_experiences_paid_recorded_by_idx ON public.partner_experiences USING btree (paid_recorded_by)',
      'index CREATE INDEX partner_experiences_partner_idx ON public.partner_experiences USING btree (partner_id, event_on)',
      'index CREATE INDEX partner_invoices_experience_idx ON public.partner_invoices USING btree (experience_id)',
      'index CREATE INDEX partner_invoices_issued_by_idx ON public.partner_invoices USING btree (issued_by)',
      'index CREATE INDEX partner_invoices_issued_idx ON public.partner_invoices USING btree (issued_at)',
      'index CREATE INDEX partners_created_by_idx ON public.partners USING btree (created_by)',
      'index CREATE UNIQUE INDEX partner_experiences_pkey ON public.partner_experiences USING btree (id)',
      'index CREATE UNIQUE INDEX partner_invoices_credits_key ON public.partner_invoices USING btree (credits_invoice_id)',
      'index CREATE UNIQUE INDEX partner_invoices_number_key ON public.partner_invoices USING btree (kind, year, sequence)',
      "index CREATE UNIQUE INDEX partner_invoices_one_per_experience ON public.partner_invoices USING btree (experience_id) WHERE (kind = 'INVOICE'::text)",
      'index CREATE UNIQUE INDEX partner_invoices_pkey ON public.partner_invoices USING btree (id)',
      'index CREATE UNIQUE INDEX partners_brand_key ON public.partners USING btree (lower(brand))',
      'index CREATE UNIQUE INDEX partners_pkey ON public.partners USING btree (id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger partner_experiences partner_experiences_immutable_identity',
      'trigger partner_experiences partner_experiences_no_delete',
      'trigger partner_experiences partner_experiences_no_truncate',
      'trigger partner_experiences partner_experiences_touch_updated_at',
      'trigger partner_invoices partner_invoices_immutable',
      'trigger partner_invoices partner_invoices_no_truncate',
      'trigger partners partners_immutable_identity',
      'trigger partners partners_no_delete',
      'trigger partners partners_no_truncate',
      'trigger partners partners_touch_updated_at',
    ]);
    // Up again: no row written, no invitation linked, no answer shares a name; each guard holds its columns.
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER]);
    expect(await snapshotOf(db())).toEqual(latest);
    for (const table of TABLES) expect(await count(table), table).toBe(0);
    expect(await count('circle_posts WHERE partner_experience_id IS NOT NULL')).toBe(0);
    expect(await count('circle_rsvps WHERE share_name')).toBe(0);
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(db())).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args('partners_immutable_identity')).toEqual(['id', 'created_at', 'created_by']);
    expect(await args('partner_experiences_immutable_identity')).toEqual(['id', 'partner_id', 'created_at', 'created_by']);
  });

  it('holds a partner\'s brand of one line, 1 to 80 characters, once whatever the case, its contact, billing details and note within their bounds, set aside and never deleted; an experience\'s title, date, amount of 1 to 100 000 000 in a house currency, DRAFT → INVOICED → PAID or CANCELLED each with its own times; a partner invoice or credit note numbered per kind and year apart from the collectors\', one invoice per experience, a credit note once per invoice, as issued and never changed; an invitation linked to a PARTNER_EXPERIENCE only; a name shared on a YES only, with its time', async () => {
    const id = async (q: string) => (await one<{ id: string }>(`${q} RETURNING id`)).id;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const admin = await id(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('partners-0064@orbes.test', 'partners-0064@orbes.test', 'scrypt$x', 'ADMIN')`);
    const nobody = '00000000-0000-4000-8000-000000000064';

    // ── partners ──
    const partner = (cols: Record<string, string>) => {
      const all = { brand: `'MAISON X'`, ...cols };
      return run(`INSERT INTO partners (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    };
    for (const [brand, label] of [[`''`, 'an empty brand'], [`' MAISON'`, 'a brand untrimmed'], [`'${'B'.repeat(81)}'`, 'a brand of 81'], [`E'MAISON\\nX'`, 'a brand on two lines']] as const) {
      await check(partner({ brand }), label, 'partners_brand_check');
    }
    await nullRefused(partner({ brand: 'NULL' }), 'no brand');
    await check(partner({ contact_name: `'${'C'.repeat(121)}'` }), 'a contact of 121', 'partners_contact_name_check');
    await check(partner({ contact_email: `'a@'` }), 'an email of 2', 'partners_contact_email_check');
    await check(partner({ contact_email: `'${'e'.repeat(250)}@x.fr'` }), 'an email of 255', 'partners_contact_email_check');
    await check(partner({ contact_email: `' a@b.fr'` }), 'an email untrimmed', 'partners_contact_email_check');
    await check(partner({ contact_phone: `'${'1'.repeat(41)}'` }), 'a phone of 41', 'partners_contact_phone_check');
    await check(partner({ billing_name: `E'MAISON\\tX'` }), 'a billing name with a tab', 'partners_billing_name_check');
    await check(partner({ billing_address: `'${'A'.repeat(1001)}'` }), 'an address of 1 001', 'partners_billing_address_check');
    await expect(partner({ billing_country: `'fr'` }), 'a country in lower case').rejects.toSatisfy((e) => isCheckViolation(e, 'partners_billing_country_check'));
    await expect(partner({ billing_country: `'FRA'` }), 'three letters').rejects.toSatisfy((e) => pgError(e)?.code === '22001');
    await check(partner({ company_number: `'${'9'.repeat(61)}'` }), 'a company number of 61', 'partners_company_number_check');
    await check(partner({ note: `'${'n'.repeat(2001)}'` }), 'a note of 2 001', 'partners_note_check');
    await expect(partner({ created_by: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    const maison = await id(`INSERT INTO partners (brand, contact_name, contact_email, contact_phone, billing_name, billing_address, billing_country, company_number, note, created_by)
      VALUES ('${'B'.repeat(80)}', 'Camille Martin', 'camille@maison.example', '+33 1 23 45 67 89', 'MAISON X SAS', E'12 rue de la Paix\\n75002 Paris', 'FR', 'RCS Paris 123 456 789', E'Dinner partner.\\nTwo lines.', '${admin}')`);
    expect(await one(`SELECT active, billing_address, updated_at = created_at AS fresh FROM partners WHERE id = '${maison}'`)).toEqual({ active: true, billing_address: '12 rue de la Paix\n75002 Paris', fresh: true });
    await expect(partner({ brand: `'${'b'.repeat(80)}'` }), 'the same brand in lower case').rejects.toSatisfy((e) => isUniqueViolation(e, 'partners_brand_key'));
    const other = await id(`INSERT INTO partners (brand) VALUES ('HOUSE Y')`);
    // Set aside, its update stamped; its identity never changed; never deleted.
    await run(`UPDATE partners SET updated_at = '2026-10-01T10:00:00Z' WHERE id = '${other}'`);
    await run(`UPDATE partners SET active = false, brand = 'HOUSE Z' WHERE id = '${other}'`);
    expect(await one(`SELECT active, brand, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM partners WHERE id = '${other}'`)).toEqual({ active: false, brand: 'HOUSE Z', stamped: true });
    for (const sets of [`id = gen_random_uuid()`, `created_at = now() - interval '1 day'`, `created_by = '${admin}'`]) {
      await expect(run(`UPDATE partners SET ${sets} WHERE id = '${other}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM partners WHERE id = '${other}'`)).rejects.toSatisfy(isGuardViolation);

    // ── partner_experiences ──
    const experience = (cols: Record<string, string>) => {
      const all = { partner_id: `'${maison}'`, title: `'DINNER'`, event_on: `'2026-11-12'`, amount_minor: '1200000', currency: `'EUR'`, ...cols };
      return run(`INSERT INTO partner_experiences (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    };
    await check(experience({ title: `''` }), 'an empty title', 'partner_experiences_title_check');
    await check(experience({ title: `'${'T'.repeat(121)}'` }), 'a title of 121', 'partner_experiences_title_check');
    await check(experience({ amount_minor: '0' }), 'an amount of 0', 'partner_experiences_amount_minor_check');
    await check(experience({ amount_minor: '100000001' }), 'an amount above 100 000 000', 'partner_experiences_amount_minor_check');
    await check(experience({ currency: `'JPY'` }), 'a currency the house does not price in', 'partner_experiences_currency_check');
    await check(experience({ status: `'OPEN'` }), 'an unknown state', 'partner_experiences_status_check');
    await check(experience({ note: `'${'n'.repeat(2001)}'` }), 'a note of 2 001', 'partner_experiences_note_check');
    await nullRefused(experience({ event_on: 'NULL' }), 'no date');
    await expect(experience({ partner_id: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    // Each state with its own times, and only its own.
    const at = `'2026-10-20T10:00:00Z'`;
    for (const [cols, label] of [
      [{ invoiced_at: at }, 'a DRAFT invoiced'],
      [{ status: `'INVOICED'` }, 'an INVOICED without its time'],
      [{ status: `'INVOICED'`, invoiced_at: at, paid_on: `'2026-10-25'`, paid_recorded_at: at }, 'an INVOICED paid'],
      [{ status: `'PAID'`, invoiced_at: at }, 'a PAID without its date'],
      [{ status: `'PAID'`, invoiced_at: at, paid_on: `'2026-10-25'`, paid_recorded_at: at, cancelled_at: at }, 'a PAID cancelled'],
      [{ status: `'CANCELLED'` }, 'a CANCELLED without its time'],
      [{ status: `'CANCELLED'`, cancelled_at: at, paid_on: `'2026-10-25'`, paid_recorded_at: at }, 'a CANCELLED paid but never invoiced'],
    ] as const) {
      await check(experience({ created_at: `'2026-10-01T10:00:00Z'`, ...cols }), label, 'partner_experiences_status_times');
    }
    await check(experience({ status: `'PAID'`, invoiced_at: at, paid_on: `'2026-10-25'`, created_at: `'2026-10-01T10:00:00Z'` }), 'a paid date never recorded', 'partner_experiences_paid');
    await check(experience({ cancelled_by: `'${admin}'` }), 'a canceller without a cancellation', 'partner_experiences_by');
    await check(experience({ paid_recorded_by: `'${admin}'` }), 'a recorder without a payment', 'partner_experiences_by');
    await check(experience({ status: `'INVOICED'`, invoiced_at: `'2026-09-30T10:00:00Z'`, created_at: `'2026-10-01T10:00:00Z'` }), 'invoiced before it existed', 'partner_experiences_times');
    await check(
      experience({ status: `'PAID'`, invoiced_at: at, paid_on: `'2026-10-25'`, paid_recorded_at: `'2026-10-19T10:00:00Z'`, created_at: `'2026-10-01T10:00:00Z'` }),
      'a payment recorded before the invoice', 'partner_experiences_times',
    );
    // Its life: DRAFT, INVOICED, PAID, a paid date corrected, CANCELLED keeping its invoice time and paid date.
    const dinner = await id(`INSERT INTO partner_experiences (partner_id, title, event_on, amount_minor, currency, created_by, created_at) VALUES ('${maison}', 'DINNER', '2026-11-12', 1200000, 'EUR', '${admin}', '2026-10-01T10:00:00Z')`);
    expect(await one(`SELECT status, amount_minor, updated_at FROM partner_experiences WHERE id = '${dinner}'`)).toEqual({ status: 'DRAFT', amount_minor: 1200000, updated_at: expect.any(Date) });
    await run(`UPDATE partner_experiences SET status = 'INVOICED', invoiced_at = ${at} WHERE id = '${dinner}'`);
    await run(`UPDATE partner_experiences SET status = 'PAID', paid_on = '2026-10-25', paid_recorded_at = '2026-10-26T10:00:00Z', paid_recorded_by = '${admin}' WHERE id = '${dinner}'`);
    await run(`UPDATE partner_experiences SET paid_on = '2026-10-24' WHERE id = '${dinner}'`);
    await run(`UPDATE partner_experiences SET status = 'CANCELLED', cancelled_at = '2026-10-27T10:00:00Z', cancelled_by = '${admin}' WHERE id = '${dinner}'`);
    expect(await one(`SELECT status, invoiced_at IS NOT NULL AS invoiced, paid_on::text AS paid_on FROM partner_experiences WHERE id = '${dinner}'`)).toEqual({ status: 'CANCELLED', invoiced: true, paid_on: '2026-10-24' });
    // A DRAFT cancelled at once; another kept for the invitations.
    await experience({ status: `'CANCELLED'`, cancelled_at: 'now()', title: `'PREVIEW'` });
    const gala = await id(`INSERT INTO partner_experiences (partner_id, title, event_on, amount_minor, currency) VALUES ('${maison}', '${'G'.repeat(120)}', '2026-12-01', 100000000, 'CHF')`);
    for (const sets of [`id = gen_random_uuid()`, `partner_id = '${other}'`, `created_at = now() - interval '1 day'`, `created_by = '${admin}'`]) {
      await expect(run(`UPDATE partner_experiences SET ${sets} WHERE id = '${gala}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM partner_experiences WHERE id = '${gala}'`)).rejects.toSatisfy(isGuardViolation);

    // ── partner_invoices ──
    const document = (cols: Record<string, string>) => {
      const all = {
        kind: `'INVOICE'`, year: '2026', sequence: '1', experience_id: `'${dinner}'`, issuer: `'{"name":"CONGLOMERAT LLC","address":[]}'`,
        buyer: `'{"name":"MAISON X SAS","address":["12 rue de la Paix"],"country":"FR"}'`, lines: `'[{"label":"Partner experience · DINNER · 12 NOV","amountMinor":1200000}]'`,
        currency: `'EUR'`, total_minor: '1200000', issued_by: `'${admin}'`, ...cols,
      };
      return one<{ id: string }>(`INSERT INTO partner_invoices (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`);
    };
    await check(document({ kind: `'RECEIPT'` }), 'an unknown kind', 'partner_invoices_kind_check');
    await check(document({ year: '1999' }), 'a year before 2000', 'partner_invoices_year_check');
    await check(document({ sequence: '0' }), 'a sequence of 0', 'partner_invoices_sequence_check');
    await check(document({ issuer: `'[]'` }), 'an issuer not an object', 'partner_invoices_issuer_check');
    await check(document({ buyer: `'"MAISON X"'` }), 'a buyer not an object', 'partner_invoices_buyer_check');
    await check(document({ lines: `'[]'` }), 'no line', 'partner_invoices_lines_check');
    await check(document({ lines: `'{}'` }), 'lines not an array', 'partner_invoices_lines_check');
    await check(document({ currency: `'JPY'` }), 'a currency the house does not price in', 'partner_invoices_currency_check');
    await check(document({ total_minor: '0' }), 'a total of 0', 'partner_invoices_total_minor_check');
    await check(document({ total_minor: '100000001' }), 'a total above 100 000 000', 'partner_invoices_total_minor_check');
    await expect(document({ experience_id: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(document({ issued_by: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    const invoice = (await document({})).id;
    // One invoice per experience; the number once per kind and year, a collector invoice's never in the way.
    await expect(document({ sequence: '2' }), 'a second invoice for the experience').rejects.toSatisfy((e) => isUniqueViolation(e, 'partner_invoices_one_per_experience'));
    await expect(document({ experience_id: `'${gala}'` }), 'P-2026-0001 twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'partner_invoices_number_key'));
    const nextYear = (await document({ experience_id: `'${gala}'`, year: '2027', currency: `'CHF'`, total_minor: '100000000', issued_by: 'NULL' })).id;
    // A credit note names its invoice, once; an invoice names none.
    await check(document({ kind: `'CREDIT_NOTE'` }), 'a credit note without its invoice', 'partner_invoices_credit');
    await check(document({ experience_id: `'${gala}'`, sequence: '2', credits_invoice_id: `'${invoice}'` }), 'an invoice naming one', 'partner_invoices_credit');
    await expect(document({ kind: `'CREDIT_NOTE'`, credits_invoice_id: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    const credit = (await document({ kind: `'CREDIT_NOTE'`, credits_invoice_id: `'${invoice}'` })).id;
    await expect(document({ kind: `'CREDIT_NOTE'`, sequence: '2', credits_invoice_id: `'${invoice}'` }), 'a second credit note').rejects.toSatisfy((e) => isUniqueViolation(e, 'partner_invoices_credits_key'));
    expect(await one(`SELECT kind, year, sequence, total_minor, buyer->>'name' AS buyer, jsonb_array_length(lines) AS lines FROM partner_invoices WHERE id = '${credit}'`)).toEqual({
      kind: 'CREDIT_NOTE', year: 2026, sequence: 1, total_minor: 1200000, buyer: 'MAISON X SAS', lines: 1,
    });
    // Never changed nor deleted.
    await expect(run(`UPDATE partner_invoices SET total_minor = 1 WHERE id = '${invoice}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM partner_invoices WHERE id = '${credit}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`TRUNCATE partner_invoices`)).rejects.toSatisfy(isGuardViolation);

    // ── circle_posts: an invitation for an experience ──
    const post = (experienceKind: string, link: string) =>
      id(`INSERT INTO circle_posts (kind, title, event_at, experience, partner_experience_id) VALUES ('INVITATION', 'Dinner', '2026-11-12T19:00:00Z', ${experienceKind}, ${link})`);
    await check(post(`'MEMBERS_EVENING'`, `'${gala}'`), 'a members\' evening linked', 'circle_posts_partner_experience');
    await check(post('NULL', `'${gala}'`), 'an invitation without its experience linked', 'circle_posts_partner_experience');
    await check(run(`INSERT INTO circle_posts (kind, title, partner_experience_id) VALUES ('NOTE', 'News', '${gala}')`), 'a note linked', 'circle_posts_partner_experience');
    await expect(post(`'PARTNER_EXPERIENCE'`, `'${nobody}'`)).rejects.toSatisfy(isForeignKeyViolation);
    const linked = await post(`'PARTNER_EXPERIENCE'`, `'${gala}'`);
    const second = await post(`'PARTNER_EXPERIENCE'`, `'${gala}'`);
    const unlinked = await post(`'PARTNER_EXPERIENCE'`, 'NULL');
    await check(run(`UPDATE circle_posts SET experience = 'LAUNCH_PREVIEW' WHERE id = '${linked}'`), 'a linked invitation\'s experience changed', 'circle_posts_partner_experience');
    await run(`UPDATE circle_posts SET partner_experience_id = NULL WHERE id = '${second}'`);

    // ── circle_rsvps: a name shared on a YES only ──
    const account = await id(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('partners-0064@example.com', 'partners-0064@example.com', 'scrypt$x')`);
    const guest = await id(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('partners-0064-b@example.com', 'partners-0064-b@example.com', 'scrypt$x')`);
    const rsvp = (postId: string, accountId: string, answer: string, share: string, shareAt: string) =>
      run(`INSERT INTO circle_rsvps (post_id, account_id, answer, share_name, share_name_at) VALUES ('${postId}', '${accountId}', '${answer}', ${share}, ${shareAt})`);
    await check(rsvp(linked, account, 'YES', 'true', 'NULL'), 'shared without its time', 'circle_rsvps_share_name');
    await check(rsvp(linked, account, 'YES', 'false', 'now()'), 'a time without the choice', 'circle_rsvps_share_name');
    await check(rsvp(linked, account, 'NO', 'true', 'now()'), 'shared on a NO', 'circle_rsvps_share_name_yes');
    // The previous image's answer: no name shared, by default.
    await run(`INSERT INTO circle_rsvps (post_id, account_id, answer) VALUES ('${unlinked}', '${account}', 'YES')`);
    expect(await one(`SELECT share_name, share_name_at FROM circle_rsvps WHERE post_id = '${unlinked}'`)).toEqual({ share_name: false, share_name_at: null });
    await rsvp(linked, account, 'YES', 'true', 'now()');
    await rsvp(linked, guest, 'YES', 'false', 'NULL');
    // A NO with the name still shared refused; with it cleared, accepted.
    await check(run(`UPDATE circle_rsvps SET answer = 'NO' WHERE post_id = '${linked}' AND account_id = '${account}'`), 'a NO keeping the name', 'circle_rsvps_share_name_yes');
    await run(`UPDATE circle_rsvps SET answer = 'NO', share_name = false, share_name_at = NULL WHERE post_id = '${linked}' AND account_id = '${guest}'`);
    // An experience with invitations, a partner with experiences: never deleted (their guards, then their foreign keys).
    await expect(run(`DELETE FROM partners WHERE id = '${maison}'`)).rejects.toSatisfy(isGuardViolation);
    // The year's restart: P-2027-0001.
    expect(await one(`SELECT year, sequence FROM partner_invoices WHERE id = '${nextYear}'`)).toEqual({ year: 2027, sequence: 1 });
  });

  it('refuses to roll back while a partner, an experience, a partner invoice, a linked invitation or a shared name exists, naming the counts; without them it goes down, the previous image\'s invitations and answers kept, and up again', async () => {
    const counts = [
      await count('partners'), await count('partner_experiences'), await count('partner_invoices'),
      await count('circle_posts WHERE partner_experience_id IS NOT NULL'), await count('circle_rsvps WHERE share_name'),
    ];
    expect(counts).toEqual([2, 3, 3, 1, 1]);
    const lastApplied = async () => (await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1);
    const refused = (n: readonly number[]) =>
      `migration 0064_partners cannot be rolled back: ${n[0]} partners, ${n[1]} partner experiences, ${n[2]} partner invoices, ${n[3]} invitations linked to an experience and ${n[4]} names shared exist`;
    await expect(downTo0063(db())).rejects.toThrow(refused(counts));
    expect(await lastApplied()).toBe(LATER);
    // Each counts on its own: the names unshared and the invitations unlinked, the partners, experiences and invoices still refuse.
    await run(`UPDATE circle_rsvps SET share_name = false, share_name_at = NULL WHERE share_name`);
    await run(`UPDATE circle_posts SET partner_experience_id = NULL WHERE partner_experience_id IS NOT NULL`);
    await expect(downTo0063(db())).rejects.toThrow(refused([2, 3, 3, 0, 0]));
    // Taken away by hand (a partner invoice, an experience and a partner are never deleted): the partners alone still refuse.
    await run(`ALTER TABLE partner_invoices DISABLE TRIGGER partner_invoices_immutable`);
    await run(`DELETE FROM partner_invoices WHERE kind = 'CREDIT_NOTE'`);
    await run(`DELETE FROM partner_invoices`);
    await run(`ALTER TABLE partner_invoices ENABLE TRIGGER partner_invoices_immutable`);
    await run(`ALTER TABLE partner_experiences DISABLE TRIGGER partner_experiences_no_delete`);
    await run(`DELETE FROM partner_experiences`);
    await run(`ALTER TABLE partner_experiences ENABLE TRIGGER partner_experiences_no_delete`);
    await expect(downTo0063(db())).rejects.toThrow(refused([2, 0, 0, 0, 0]));
    expect(await lastApplied()).toBe(LATER);
    await run(`ALTER TABLE partners DISABLE TRIGGER partners_no_delete`);
    await run(`DELETE FROM partners`);
    await run(`ALTER TABLE partners ENABLE TRIGGER partners_no_delete`);
    // Without them it goes down, the invitations and answers of the previous image kept; and up again.
    const posts = await count('circle_posts');
    const answers = await count('circle_rsvps');
    expect(answers).toBeGreaterThanOrEqual(3);
    expect(await downTo0063(db())).toEqual([LATER, NAME]);
    expect([await count('circle_posts'), await count('circle_rsvps')]).toEqual([posts, answers]);
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER]);
  });
}

describe('migration 0064_partners (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0063: async () => {
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

describe.skipIf(!pgUrl)('migration 0064_partners (PostgreSQL)', () => {
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
  cases({ db: () => db, schemaAt0063: async () => null });
});
