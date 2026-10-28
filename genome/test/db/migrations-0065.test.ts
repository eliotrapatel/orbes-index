/**
 * Migration 0065_ad_conversions (lot M4, step M4.9; plan §3.2; macro scope K27 A1, A3 and A4): the switch and its
 * settings, the channels mapped to a platform, the advertising choices, the click ids and the outbox of events per
 * platform, built and switched off, on PGlite here and on a real PostgreSQL in genome-ci (ORBES_TEST_POSTGRES_URL, a
 * throwaway database; skipped without it), the same cases on both:
 *  - down to 0064 without rows: exactly the schema of 0064 (PGlite: against a database migrated to 0064 alone), what it
 *    added (five tables with their CHECKs, keys, indexes and guards; nothing on another table), no row written (no
 *    switch row: off), and up again the latest;
 *  - the switch row once, off by default, on only from a first switch on whose time never moves, a switch with its
 *    time, the test codes and Google actions within their bounds; a channel mapped once per platform; a choice on a
 *    device, an account or both, a user agent with a GRANTED one only, never changed; a click id of printable
 *    characters, once per device, kind and id, taking the account; an event once per platform, conversion and act, its
 *    reason exactly when SKIPPED, its times exactly with its state, an error on a FAILED one;
 *  - down refused while the switch is on or a choice, a click id or an event exists, naming the counts; a switch row
 *    that is off and the channels mapped go down with the tables.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { createMigrator, migrateToLatest } from '../../src/server/db/migrate.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, PG_ERROR, pgError } from '../../src/server/db/pg-errors.js';
import { createTestDb, type TestDb } from '../support/db.js';

const BEFORE = '0064_partners';
const NAME = '0065_ad_conversions';
/** The migration after it (lot PURGE, step PURGE.2: the test purge), taken down first and applied again with it. */
const LATER = '0066_test_purge';
const TABLES = ['ads_settings', 'ads_channel_platforms', 'ad_consents', 'ad_clicks', 'ad_events'] as const;
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

/** Down to 0064 (0066, then 0065, reverted). */
async function downTo0064(db: Db): Promise<string[]> {
  const rs = await createMigrator(db).migrateTo(BEFORE);
  if (rs.error) throw rs.error;
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** What names an object of 0065 in a snapshot: its five tables. */
const of0065 = (o: string) => /\b(ads_settings|ads_channel_platforms|ad_consents|ad_clicks|ad_events)\b/.test(o);
/** A NOT NULL's own constraint entry: PGlite's PostgreSQL lists it among the constraints, PostgreSQL 16 does not. */
const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);

/**
 * The cases, on a database at the latest migration with no business data. They run in order: the down to 0064 without
 * rows first, then the rows, then the down refused.
 */
function cases(state: { db: () => Db; schemaAt0064: () => Promise<string[] | null> }) {
  const db = () => state.db();
  const run = (q: string) => sql.raw(q).execute(db());
  const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(db())).rows[0] as T;
  const count = async (from: string) => Number((await one<{ n: string | number }>(`SELECT count(*) AS n FROM ${from}`)).n);

  it('rolls back to the schema of 0064 exactly without rows: what 0065 added (five tables), nothing else; and applies again to the latest, writing no row (no switch row: off)', async () => {
    const latest = await snapshotOf(db());
    // 0066 down first: the schema 0065 left, which this case reads.
    const rs = await createMigrator(db()).migrateTo(NAME);
    if (rs.error) throw rs.error;
    const withIt = await snapshotOf(db());
    expect(await downTo0064(db())).toEqual([NAME]);
    const before = await snapshotOf(db());
    const at0064 = await state.schemaAt0064();
    if (at0064) expect(before).toEqual(at0064);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0065(o))).toEqual([]);
    expect(before.filter(of0065)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table ad_clicks account_id uuid YES ',
      'table ad_clicks click_id text NO ',
      'table ad_clicks clicked_at timestamp with time zone NO ',
      'table ad_clicks device_id integer NO ',
      'table ad_clicks id bigint NO ',
      'table ad_clicks kind text NO ',
      'table ad_consents account_id uuid YES ',
      'table ad_consents choice text NO ',
      'table ad_consents chosen_at timestamp with time zone NO now()',
      'table ad_consents device_id integer YES ',
      'table ad_consents id bigint NO ',
      'table ad_consents source text NO ',
      'table ad_consents text_version text NO ',
      'table ad_consents user_agent text YES ',
      'table ad_events attempts smallint NO 0',
      'table ad_events conversion_id bigint NO ',
      'table ad_events created_at timestamp with time zone NO now()',
      'table ad_events id bigint NO ',
      'table ad_events kind text NO ',
      'table ad_events last_error text YES ',
      'table ad_events not_before timestamp with time zone NO now()',
      'table ad_events platform text NO ',
      'table ad_events sent_at timestamp with time zone YES ',
      'table ad_events settled_at timestamp with time zone YES ',
      'table ad_events skip_reason text YES ',
      "table ad_events status text NO 'QUEUED'::text",
      'table ads_channel_platforms channel_id uuid NO ',
      'table ads_channel_platforms platform text NO ',
      'table ads_settings enabled boolean NO false',
      'table ads_settings enqueued_until timestamp with time zone YES ',
      'table ads_settings events_from timestamp with time zone YES ',
      'table ads_settings google_action_draw_entry text YES ',
      'table ads_settings google_action_live_entry text YES ',
      'table ads_settings google_action_paid_order text YES ',
      'table ads_settings google_action_signup text YES ',
      'table ads_settings id smallint NO 1',
      'table ads_settings meta_test_event_code text YES ',
      'table ads_settings switched_at timestamp with time zone YES ',
      'table ads_settings switched_by uuid YES ',
      'table ads_settings tiktok_test_event_code text YES ',
      'table ads_settings updated_at timestamp with time zone NO now()',
      'table ads_settings updated_by uuid YES ',
    ]);
    const constraints = added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(0, 3).join(' '));
    expect(constraints).toEqual([
      'constraint ad_clicks ad_clicks_account_id_fkey',
      'constraint ad_clicks ad_clicks_click_id_check',
      'constraint ad_clicks ad_clicks_click_key',
      'constraint ad_clicks ad_clicks_device_id_fkey',
      'constraint ad_clicks ad_clicks_kind_check',
      'constraint ad_clicks ad_clicks_pkey',
      'constraint ad_consents ad_consents_account_id_fkey',
      'constraint ad_consents ad_consents_choice_check',
      'constraint ad_consents ad_consents_device_id_fkey',
      'constraint ad_consents ad_consents_pkey',
      'constraint ad_consents ad_consents_source_check',
      'constraint ad_consents ad_consents_subject',
      'constraint ad_consents ad_consents_text_version_check',
      'constraint ad_consents ad_consents_user_agent',
      'constraint ad_consents ad_consents_user_agent_check',
      'constraint ad_events ad_events_attempts_check',
      'constraint ad_events ad_events_conversion_id_fkey',
      'constraint ad_events ad_events_failed',
      'constraint ad_events ad_events_key',
      'constraint ad_events ad_events_kind_check',
      'constraint ad_events ad_events_last_error_check',
      'constraint ad_events ad_events_pkey',
      'constraint ad_events ad_events_platform_check',
      'constraint ad_events ad_events_sent',
      'constraint ad_events ad_events_settled',
      'constraint ad_events ad_events_skip_reason_check',
      'constraint ad_events ad_events_skipped',
      'constraint ad_events ad_events_status_check',
      'constraint ads_channel_platforms ads_channel_platforms_channel_id_fkey',
      'constraint ads_channel_platforms ads_channel_platforms_pkey',
      'constraint ads_channel_platforms ads_channel_platforms_platform_check',
      'constraint ads_settings ads_settings_google_action_draw_entry_check',
      'constraint ads_settings ads_settings_google_action_live_entry_check',
      'constraint ads_settings ads_settings_google_action_paid_order_check',
      'constraint ads_settings ads_settings_google_action_signup_check',
      'constraint ads_settings ads_settings_id_check',
      'constraint ads_settings ads_settings_meta_test_event_code_check',
      'constraint ads_settings ads_settings_on',
      'constraint ads_settings ads_settings_pkey',
      'constraint ads_settings ads_settings_switched',
      'constraint ads_settings ads_settings_switched_by_fkey',
      'constraint ads_settings ads_settings_tiktok_test_event_code_check',
      'constraint ads_settings ads_settings_times',
      'constraint ads_settings ads_settings_updated_by_fkey',
    ]);
    // The rules that hold the data, as PostgreSQL reads them back.
    for (const c of [
      'constraint ads_settings ads_settings_on CHECK (((NOT enabled) OR (events_from IS NOT NULL)))',
      'constraint ads_settings ads_settings_times CHECK ((switched_at >= events_from))',
      "constraint ads_settings ads_settings_google_action_paid_order_check CHECK ((google_action_paid_order ~ '^customers/[0-9]{1,12}/conversionActions/[0-9]{1,20}$'::text))",
      'constraint ads_settings ads_settings_switched_by_fkey FOREIGN KEY (switched_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      'constraint ads_channel_platforms ads_channel_platforms_pkey PRIMARY KEY (channel_id, platform)',
      'constraint ads_channel_platforms ads_channel_platforms_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES link_channels(id) ON DELETE RESTRICT',
      'constraint ad_consents ad_consents_subject CHECK ((num_nonnulls(device_id, account_id) >= 1))',
      "constraint ad_consents ad_consents_user_agent CHECK (((user_agent IS NULL) OR (choice = 'GRANTED'::text)))",
      'constraint ad_consents ad_consents_device_id_fkey FOREIGN KEY (device_id) REFERENCES tracking_devices(id) ON DELETE RESTRICT',
      'constraint ad_consents ad_consents_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT',
      'constraint ad_clicks ad_clicks_click_key UNIQUE (device_id, kind, click_id)',
      'constraint ad_clicks ad_clicks_device_id_fkey FOREIGN KEY (device_id) REFERENCES tracking_devices(id) ON DELETE RESTRICT',
      'constraint ad_events ad_events_key UNIQUE (platform, conversion_id, kind)',
      'constraint ad_events ad_events_conversion_id_fkey FOREIGN KEY (conversion_id) REFERENCES acquisition_conversions(id) ON DELETE RESTRICT',
      "constraint ad_events ad_events_skipped CHECK (((status = 'SKIPPED'::text) = (skip_reason IS NOT NULL)))",
      "constraint ad_events ad_events_sent CHECK (((status = 'SENT'::text) = (sent_at IS NOT NULL)))",
      "constraint ad_events ad_events_settled CHECK (((status = 'QUEUED'::text) = (settled_at IS NULL)))",
      "constraint ad_events ad_events_failed CHECK (((status <> 'FAILED'::text) OR (last_error IS NOT NULL)))",
    ]) {
      expect(added, c).toContain(c);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX ad_clicks_account_idx ON public.ad_clicks USING btree (account_id)',
      'index CREATE INDEX ad_consents_account_idx ON public.ad_consents USING btree (account_id, chosen_at DESC)',
      'index CREATE INDEX ad_consents_device_idx ON public.ad_consents USING btree (device_id, chosen_at DESC)',
      'index CREATE INDEX ad_events_conversion_idx ON public.ad_events USING btree (conversion_id)',
      'index CREATE INDEX ad_events_due ON public.ad_events USING btree (status, not_before)',
      'index CREATE INDEX ads_settings_switched_by_idx ON public.ads_settings USING btree (switched_by)',
      'index CREATE INDEX ads_settings_updated_by_idx ON public.ads_settings USING btree (updated_by)',
      'index CREATE UNIQUE INDEX ad_clicks_click_key ON public.ad_clicks USING btree (device_id, kind, click_id)',
      'index CREATE UNIQUE INDEX ad_clicks_pkey ON public.ad_clicks USING btree (id)',
      'index CREATE UNIQUE INDEX ad_consents_pkey ON public.ad_consents USING btree (id)',
      'index CREATE UNIQUE INDEX ad_events_key ON public.ad_events USING btree (platform, conversion_id, kind)',
      'index CREATE UNIQUE INDEX ad_events_pkey ON public.ad_events USING btree (id)',
      'index CREATE UNIQUE INDEX ads_channel_platforms_pkey ON public.ads_channel_platforms USING btree (channel_id, platform)',
      'index CREATE UNIQUE INDEX ads_settings_pkey ON public.ads_settings USING btree (id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger ad_clicks ad_clicks_immutable_identity',
      'trigger ad_consents ad_consents_immutable',
      'trigger ad_events ad_events_immutable_identity',
      'trigger ads_settings ads_settings_events_from',
      'trigger ads_settings ads_settings_touch_updated_at',
    ]);
    // Up again: no row written (no switch row: off); each guard holds its columns.
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER]);
    expect(await snapshotOf(db())).toEqual(latest);
    for (const table of TABLES) expect(await count(table), table).toBe(0);
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(db())).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args('ad_clicks_immutable_identity')).toEqual(['id', 'device_id', 'kind', 'click_id', 'clicked_at']);
    expect(await args('ad_events_immutable_identity')).toEqual(['id', 'platform', 'conversion_id', 'kind', 'created_at']);
  });

  it('holds the switch row once, off by default, on only from a first switch on that never moves, its test codes and Google actions within their bounds; a channel mapped once per platform; a choice on a device or an account, a user agent with a GRANTED one only, never changed; a click id of printable characters once per device, kind and id, taking the account; an event once per platform, conversion and act, with its reason, times and error by its state', async () => {
    const id = async (q: string) => (await one<{ id: string }>(`${q} RETURNING id`)).id;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const admin = await id(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('ads-0065@orbes.test', 'ads-0065@orbes.test', 'scrypt$x', 'ADMIN')`);
    const nobody = '00000000-0000-4000-8000-000000000065';

    // ── ads_settings ──
    const settings = (cols: Record<string, string>) => {
      const keys = Object.keys(cols);
      return run(`INSERT INTO ads_settings (${keys.length ? keys.join(', ') : 'id'}) VALUES (${keys.length ? Object.values(cols).join(', ') : '1'})`);
    };
    await check(settings({ id: '2' }), 'a second row', 'ads_settings_id_check');
    await check(settings({ enabled: 'true' }), 'on without a first switch on', 'ads_settings_on');
    await check(settings({ events_from: 'now()' }), 'a start without a switch', 'ads_settings_switched');
    await check(settings({ switched_by: `'${admin}'` }), 'an author without a switch', 'ads_settings_switched');
    await check(settings({ events_from: `'2026-11-02T10:00:00Z'`, switched_at: `'2026-11-02T09:00:00Z'` }), 'a switch before the start', 'ads_settings_times');
    for (const [column, value, label] of [
      ['meta_test_event_code', `''`, 'an empty Meta code'],
      ['meta_test_event_code', `'${'T'.repeat(41)}'`, 'a Meta code of 41'],
      ['tiktok_test_event_code', `' TEST1'`, 'a TikTok code untrimmed'],
      ['tiktok_test_event_code', `E'TEST\\n1'`, 'a TikTok code on two lines'],
    ] as const) {
      await check(settings({ [column]: value }), label, `ads_settings_${column}_check`);
    }
    for (const act of ['signup', 'draw_entry', 'live_entry', 'paid_order']) {
      for (const value of ['customers/123/conversionActions/', 'customers/1234567890123/conversionActions/1', 'customers/1/conversionActions/1 ', '123/456']) {
        await check(settings({ [`google_action_${act}`]: `'${value}'` }), `${act}: ${value}`, `ads_settings_google_action_${act}_check`);
      }
    }
    await expect(settings({ switched_by: `'${nobody}'`, switched_at: 'now()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(settings({ updated_by: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    // The first save: off, every setting optional.
    await settings({ meta_test_event_code: `'${'T'.repeat(40)}'`, google_action_signup: `'customers/123456789012/conversionActions/12345678901234567890'`, updated_by: `'${admin}'` });
    expect(await one(`SELECT id, enabled, events_from, switched_at, tiktok_test_event_code, google_action_paid_order FROM ads_settings`)).toEqual({
      id: 1, enabled: false, events_from: null, switched_at: null, tiktok_test_event_code: null, google_action_paid_order: null,
    });
    await expect(settings({}), 'a second row').rejects.toSatisfy((e) => isUniqueViolation(e, 'ads_settings_pkey'));
    // The first switch on sets the start; off and on again never move it; the update stamped.
    await run(`UPDATE ads_settings SET updated_at = '2026-10-01T10:00:00Z'`);
    await run(`UPDATE ads_settings SET enabled = true, events_from = '2026-11-02T09:00:00Z', switched_at = '2026-11-02T09:00:00Z', switched_by = '${admin}'`);
    expect(await one(`SELECT updated_at > '2026-10-01T10:00:00Z' AS stamped FROM ads_settings`)).toEqual({ stamped: true });
    await run(`UPDATE ads_settings SET enabled = false, switched_at = '2026-11-03T09:00:00Z'`);
    await run(`UPDATE ads_settings SET enabled = true, switched_at = '2026-11-04T09:00:00Z', events_from = '2026-11-02T09:00:00Z'`);
    for (const value of [`'2026-11-04T09:00:00Z'`, `'2026-11-01T09:00:00Z'`, 'NULL']) {
      await expect(run(`UPDATE ads_settings SET events_from = ${value}`), `events_from = ${value}`).rejects.toSatisfy(isGuardViolation);
    }
    await check(run(`UPDATE ads_settings SET switched_at = NULL`), 'a switch forgotten', 'ads_settings_switched');

    // ── ads_channel_platforms ──
    const channel = await id(`INSERT INTO link_channels (name) VALUES ('Ads 0065')`);
    await check(run(`INSERT INTO ads_channel_platforms (channel_id, platform) VALUES ('${channel}', 'SNAPCHAT')`), 'Snapchat', 'ads_channel_platforms_platform_check');
    await expect(run(`INSERT INTO ads_channel_platforms (channel_id, platform) VALUES ('${nobody}', 'META')`)).rejects.toSatisfy(isForeignKeyViolation);
    await run(`INSERT INTO ads_channel_platforms (channel_id, platform) VALUES ('${channel}', 'META'), ('${channel}', 'TIKTOK'), ('${channel}', 'GOOGLE')`);
    await expect(run(`INSERT INTO ads_channel_platforms (channel_id, platform) VALUES ('${channel}', 'META')`), 'META twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'ads_channel_platforms_pkey'));
    // A channel mapped is never deleted under its mapping.
    await expect(run(`DELETE FROM link_channels WHERE id = '${channel}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // ── ad_consents ──
    const account = await id(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('ads-0065@example.com', 'ads-0065@example.com', 'scrypt$x')`);
    const device = Number(await id(`INSERT INTO tracking_devices (device_hash) VALUES ('${'D'.repeat(43)}')`));
    const consent = (cols: Record<string, string>) => {
      const all = { device_id: `${device}`, choice: `'GRANTED'`, source: `'BANNER'`, text_version: `'2026-11-02'`, ...cols };
      return one<{ id: string }>(`INSERT INTO ad_consents (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`);
    };
    await check(consent({ device_id: 'NULL' }), 'a choice of no one', 'ad_consents_subject');
    await check(consent({ choice: `'MAYBE'` }), 'an unknown choice', 'ad_consents_choice_check');
    await check(consent({ source: `'EMAIL'` }), 'an unknown source', 'ad_consents_source_check');
    await check(consent({ text_version: `'v1'` }), 'a version not a date', 'ad_consents_text_version_check');
    await check(consent({ user_agent: `''` }), 'an empty user agent', 'ad_consents_user_agent_check');
    await check(consent({ user_agent: `'${'U'.repeat(401)}'` }), 'a user agent of 401', 'ad_consents_user_agent_check');
    await check(consent({ choice: `'DECLINED'`, user_agent: `'Mozilla/5.0'` }), 'a user agent with a DECLINED choice', 'ad_consents_user_agent');
    await nullRefused(consent({ text_version: 'NULL' }), 'no version');
    await expect(consent({ device_id: '2147483000' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(consent({ device_id: 'NULL', account_id: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    const granted = (await consent({ user_agent: `'${'U'.repeat(400)}'` })).id;
    const onAccount = (await consent({ account_id: `'${account}'`, source: `'ACCOUNT'`, choice: `'DECLINED'`, chosen_at: `now() + interval '1 minute'` })).id;
    await consent({ device_id: 'NULL', account_id: `'${account}'`, source: `'ACCOUNT'`, chosen_at: `now() + interval '2 minutes'` });
    expect(Number(onAccount)).toBeGreaterThan(Number(granted));
    // Never changed: a new choice is a new row; the latest of the account read first.
    for (const sets of [`choice = 'DECLINED', user_agent = NULL`, `account_id = '${account}'`, `chosen_at = now()`]) {
      await expect(run(`UPDATE ad_consents SET ${sets} WHERE id = ${granted}`), sets).rejects.toSatisfy(isGuardViolation);
    }
    expect(await one(`SELECT choice, source, device_id FROM ad_consents WHERE account_id = '${account}' ORDER BY chosen_at DESC LIMIT 1`)).toEqual({ choice: 'GRANTED', source: 'ACCOUNT', device_id: null });

    // ── ad_clicks ──
    const click = (cols: Record<string, string>) => {
      const all = { device_id: `${device}`, kind: `'GCLID'`, click_id: `'Cj0KCQjw-abc_123.xyz~'`, clicked_at: 'now()', ...cols };
      return one<{ id: string }>(`INSERT INTO ad_clicks (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`);
    };
    await check(click({ kind: `'SCCLID'` }), 'a Snapchat click id', 'ad_clicks_kind_check');
    await check(click({ click_id: `''` }), 'an empty click id', 'ad_clicks_click_id_check');
    await check(click({ click_id: `'${'c'.repeat(501)}'` }), 'a click id of 501', 'ad_clicks_click_id_check');
    await check(click({ click_id: `'abc def'` }), 'a click id with a space', 'ad_clicks_click_id_check');
    await check(click({ click_id: `E'abc\\tdef'` }), 'a click id with a tab', 'ad_clicks_click_id_check');
    await check(click({ click_id: `'abcé'` }), 'a click id with a letter outside ASCII', 'ad_clicks_click_id_check');
    await nullRefused(click({ device_id: 'NULL' }), 'a click id without its device');
    await nullRefused(click({ clicked_at: 'NULL' }), 'a click id without its time');
    await expect(click({ account_id: `'${nobody}'` })).rejects.toSatisfy(isForeignKeyViolation);
    const gclid = (await click({})).id;
    await expect(click({}), 'the same click id twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'ad_clicks_click_key'));
    await click({ kind: `'GBRAID'` });
    await click({ kind: `'FBCLID'`, click_id: `'${'c'.repeat(500)}'` });
    // It takes the account; its id, device, kind, click id and time never change.
    await run(`UPDATE ad_clicks SET account_id = '${account}' WHERE device_id = ${device}`);
    for (const sets of [`id = 999999`, `device_id = ${device} + 1`, `kind = 'WBRAID'`, `click_id = 'other'`, `clicked_at = now() - interval '1 day'`]) {
      await expect(run(`UPDATE ad_clicks SET ${sets} WHERE id = ${gclid}`), sets).rejects.toSatisfy((e) => isGuardViolation(e) || pgError(e)?.code === '428C9');
    }
    // A device with a choice or a click id is never deleted under them.
    await expect(run(`DELETE FROM tracking_devices WHERE id = ${device}`)).rejects.toSatisfy(isForeignKeyViolation);

    // ── ad_events ──
    const source = Number(await id(`INSERT INTO acquisition_sources (kind, key) VALUES ('DIRECT', 'ads-0065')`));
    const conversion = Number(await id(`INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id) VALUES ('SIGNUP', '${account}', '${account}', now(), ${source})`));
    const event = (cols: Record<string, string>) => {
      const all = { platform: `'META'`, conversion_id: `${conversion}`, kind: `'SIGNUP'`, ...cols };
      return one<{ id: string }>(`INSERT INTO ad_events (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`);
    };
    await check(event({ platform: `'SNAPCHAT'` }), 'Snapchat', 'ad_events_platform_check');
    await check(event({ kind: `'ORDER'` }), 'an order not paid', 'ad_events_kind_check');
    await check(event({ status: `'DONE'`, settled_at: 'now()' }), 'an unknown state', 'ad_events_status_check');
    await check(event({ status: `'SKIPPED'`, skip_reason: `'SPAM'`, settled_at: 'now()' }), 'an unknown reason', 'ad_events_skip_reason_check');
    await check(event({ attempts: '-1' }), 'attempts below 0', 'ad_events_attempts_check');
    await check(event({ last_error: `''` }), 'an empty error', 'ad_events_last_error_check');
    await check(event({ last_error: `'${'e'.repeat(301)}'` }), 'an error of 301', 'ad_events_last_error_check');
    await check(event({ status: `'SKIPPED'`, settled_at: 'now()' }), 'skipped without its reason', 'ad_events_skipped');
    await check(event({ skip_reason: `'TOO_OLD'` }), 'a reason on a QUEUED one', 'ad_events_skipped');
    await check(event({ status: `'SENT'`, settled_at: 'now()' }), 'sent without its time', 'ad_events_sent');
    await check(event({ sent_at: 'now()' }), 'a time sent on a QUEUED one', 'ad_events_sent');
    await check(event({ settled_at: 'now()' }), 'a QUEUED one settled', 'ad_events_settled');
    await check(event({ status: `'CANCELLED'` }), 'a CANCELLED one not settled', 'ad_events_settled');
    await check(event({ status: `'FAILED'`, settled_at: 'now()' }), 'a FAILED one without its error', 'ad_events_failed');
    await expect(event({ conversion_id: '999999999' })).rejects.toSatisfy(isForeignKeyViolation);
    const queued = (await event({})).id;
    expect(await one(`SELECT status, attempts, skip_reason, sent_at, settled_at, not_before <= now() AS due FROM ad_events WHERE id = ${queued}`)).toEqual({
      status: 'QUEUED', attempts: 0, skip_reason: null, sent_at: null, settled_at: null, due: true,
    });
    await expect(event({}), 'META once per conversion and act').rejects.toSatisfy((e) => isUniqueViolation(e, 'ad_events_key'));
    // Other platforms of the same act: one each, here skipped and failed.
    await event({ platform: `'GOOGLE'`, status: `'SKIPPED'`, skip_reason: `'NO_CLICK_ID'`, settled_at: 'now()' });
    await event({ platform: `'TIKTOK'`, status: `'FAILED'`, attempts: '5', last_error: `'${'e'.repeat(300)}'`, settled_at: 'now()' });
    // Retried, then sent; its identity never changes.
    await run(`UPDATE ad_events SET attempts = 1, not_before = now() + interval '1 minute', last_error = '503 Service Unavailable' WHERE id = ${queued}`);
    await run(`UPDATE ad_events SET status = 'SENT', attempts = 2, sent_at = now(), settled_at = now() WHERE id = ${queued}`);
    for (const sets of [`platform = 'TIKTOK'`, `conversion_id = ${conversion} + 1`, `kind = 'LIVE_ENTRY'`, `created_at = now() - interval '1 day'`]) {
      await expect(run(`UPDATE ad_events SET ${sets} WHERE id = ${queued}`), sets).rejects.toSatisfy(isGuardViolation);
    }
    // A conversion with its events is never deleted under them.
    await expect(run(`DELETE FROM acquisition_conversions WHERE id = ${conversion}`)).rejects.toSatisfy(isForeignKeyViolation);
  });

  it('refuses to roll back while the switch is on or a choice, a click id or an event exists, naming the counts; a switch row that is off and the channels mapped go down with the tables, and up again', async () => {
    const counts = [await count('ads_settings WHERE enabled'), await count('ad_consents'), await count('ad_clicks'), await count('ad_events')];
    expect(counts).toEqual([1, 3, 3, 3]);
    const lastApplied = async () => (await createMigrator(db()).getMigrations()).filter((m) => m.executedAt).map((m) => m.name).at(-1);
    const refused = (n: readonly number[]) =>
      `migration 0065_ad_conversions cannot be rolled back: ${n[0]} switches on, ${n[1]} advertising choices, ${n[2]} click ids and ${n[3]} ad events exist`;
    await expect(downTo0064(db())).rejects.toThrow(refused(counts));
    expect(await lastApplied()).toBe(LATER);
    // Each counts on its own: switched off, the choices, click ids and events still refuse; then the events alone.
    await run(`UPDATE ads_settings SET enabled = false, switched_at = switched_at + interval '1 day'`);
    await expect(downTo0064(db())).rejects.toThrow(refused([0, 3, 3, 3]));
    await run(`DELETE FROM ad_consents`);
    await run(`DELETE FROM ad_clicks`);
    await expect(downTo0064(db())).rejects.toThrow(refused([0, 0, 0, 3]));
    expect(await lastApplied()).toBe(LATER);
    await run(`DELETE FROM ad_events`);
    // Without them it goes down, the switch row that is off and the channels mapped with their tables; the channels,
    // devices and conversions of the previous image kept; and up again.
    expect([await count('ads_settings'), await count('ads_channel_platforms')]).toEqual([1, 3]);
    const kept = [await count('link_channels'), await count('tracking_devices'), await count('acquisition_conversions')];
    expect(await downTo0064(db())).toEqual([LATER, NAME]);
    expect([await count('link_channels'), await count('tracking_devices'), await count('acquisition_conversions')]).toEqual(kept);
    expect((await migrateToLatest(db())).applied).toEqual([NAME, LATER]);
    for (const table of TABLES) expect(await count(table), table).toBe(0);
  });
}

describe('migration 0065_ad_conversions (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });
  cases({
    db: () => t.db,
    schemaAt0064: async () => {
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

describe.skipIf(!pgUrl)('migration 0065_ad_conversions (PostgreSQL)', () => {
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
  cases({ db: () => db, schemaAt0064: async () => null });
});
