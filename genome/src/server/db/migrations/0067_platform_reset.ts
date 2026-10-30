/**
 * 0067 — PLATFORM RESET and LOCK RESET (lot PURGE, plan §B.1 and §B.2; the owner's answers of 27 Oct 2026, answers 1 to
 * 3 and Claude's points 3, 4, 7 and 9): the one button that empties the platform before the launch, "like we did in
 * the past" (the 9 Oct RESET TO CATALOGUE, whose guards and in-transaction proofs are the minimum bar), from the console
 * only (no arm step, no host command), by the reset holder only, until LOCK RESET closes it for good. Nothing here runs
 * by itself: the service, its shutdown path and its routes come in steps PURGE.10 and PURGE.11.
 *
 * `platform_reset_plan`: every table of the schema with its class, KEEP, PARTLY or WIPE (db/reset-plan.ts RESET_PLAN,
 * kept equal by test), written by the migrations' superuser only; the reset reads it, the app never passes a plan.
 *
 * `orbes_reject_mutation` gains a second way through (0066's purge way unchanged): a TRUNCATE of a WIPE table, or a
 * DELETE on a WIPE or PARTLY table, while `orbes.guard_bypass` is `reset` AND the current user is a superuser: only
 * inside the reset's SECURITY DEFINER function, owned by the migrations' superuser. Never an UPDATE, never a kept table,
 * never the app's role (no superuser), no replica mode anywhere. Every other use answers exactly as before (OR001).
 *
 * `platform_reset_gate`: one row (id 1), written by a superuser only (the definer functions; `orbes_platform_reset_gate_guard`):
 *  - `holder_admin_id`: the RESET HOLDER, recorded here, at the deploy, as the oldest active ADMIN with two-factor
 *    authentication (NULL when there is none: every reset is then refused); the app can never change it; once LOCK
 *    RESET is pressed nobody can;
 *  - `launched_at`, `launched_by`: LOCK RESET, one way (never back, never changed once set);
 *  - `last_reset_at`, `last_reset_by`, `resets` (never decreasing), `last_reset_details` (what the reset captured);
 *  - `authorized_by`, `authorized_at`, `authorized_purpose`: the single-use authorization (§B.2 g), written by
 *    `orbes_platform_reset_authorize` only in a transaction that itself consumed the holder's step-up and audited the
 *    request, used once within 5 minutes by `orbes_platform_reset` or `orbes_platform_reset_lock`.
 *
 * The functions (SECURITY DEFINER, `search_path` fixed; EXECUTE stays with PUBLIC: only the app and the owner connect):
 *  - `orbes_platform_reset_precheck(admin, collectorsSeen, collectorsSeenUntil)`: read only, no bypass, no lock
 *    timeout; NULL when a reset is allowed now, otherwise NO_HOLDER, NOT_HOLDER, LOCKED, WINDOW, TEST_RUNNING, LIVE_OPEN
 *    or COLLECTORS_CHANGED;
 *  - `orbes_platform_reset_authorize(admin, purpose)` and `orbes_platform_reset_unauthorize()`;
 *  - `orbes_platform_reset(admin, collectorsSeen, collectorsSeenUntil)`: the reset, in the caller's transaction, every
 *    guard first, then one TRUNCATE and the partial steps with every trigger and foreign key on, then the proofs; any
 *    failure raises (OR011 a refusal, OR020 a proof) and the caller's transaction rolls back whole;
 *  - `orbes_platform_reset_lock(admin)`: LOCK RESET.
 * Refusals raise SQLSTATE OR011 with the reason as the message (RESET_NO_HOLDER, RESET_WINDOW, …), a failed proof OR020
 * RESET_PROOF_FAILED with every failed check in its detail.
 *
 * Every foreign key ON DELETE RESTRICT at the head of an index. On the previous image during the roll-out: tables and
 * functions it never reads. `down` refuses once a reset was done or LOCK RESET pressed, naming them; otherwise it puts
 * back 0066's `orbes_reject_mutation` exactly and drops the rest: the schema of 0066. One statement per array entry
 * (PGlite's extended protocol); Kysely's Migrator applies the migration inside a transaction.
 */
import { sql, type Kysely } from 'kysely';

// Literal lists, kept local on purpose (a migration never changes); test/db/reset-plan.test.ts and
// test/db/migrations-0067.test.ts check they match db/reset-plan.ts, db/connection.ts, schema.ts and the services.

/** Every table with its class (reset-plan.ts RESET_PLAN): KEEP 40, PARTLY 8, WIPE 116. */
const KEEP = [
  'categories', 'collections', 'models', 'model_images', 'model_pairs', 'skus', 'suppliers', 'stock_locations', 'carriers', 'retailers',
  'club_tiers', 'club_program_settings', 'shipping_rates', 'guarantee_settings', 'order_alert_settings', 'sku_thresholds', 'admin_users',
  'admin_user_locations', 'cryptographic_keys', 'kysely_migration', 'kysely_migration_lock', 'heard_options', 'link_channels',
  'email_templates', 'house_moment_settings', 'boxes', 'stock_location_countries', 'addon_items', 'addon_item_prices', 'sets', 'set_models',
  'vault_sources', 'currency_rates', 'shipping_cost_rates', 'margin_unit_costs', 'category_allowances', 'ads_settings',
  'ads_channel_platforms', 'platform_reset_plan', 'purge_delete_tables',
];
const PARTLY = ['media_objects', 'revocations', 'segments', 'vault_rewards', 'preregistrations', 'acquisition_sources', 'links', 'platform_reset_gate'];
const WIPE = [
  'account_addresses', 'account_notes', 'account_profiles', 'account_recovery_codes', 'account_scores', 'account_sizes', 'account_sources',
  'account_tags', 'account_tastes', 'account_wishes', 'accounts', 'acquisition_conversions', 'acquisition_daily', 'acquisition_state',
  'acquisition_touches', 'activity_hourly', 'ad_clicks', 'ad_consents', 'ad_events', 'addon_choices', 'addon_conversions', 'after_room_guests',
  'anomalies', 'audit_logs', 'audit_purge_gaps', 'authentication_events', 'bench_items', 'card_prints', 'care_requests', 'circle_daily_visits',
  'circle_poll_votes', 'circle_post_images', 'circle_posts', 'circle_rsvps', 'claim_code_renewals', 'client_conversations', 'client_messages',
  'codes', 'collector_history', 'collector_places', 'collector_view_months', 'collector_view_totals', 'collector_views', 'credit_uses',
  'device_daily_stats', 'drop_addons', 'drop_entries', 'drop_entry_sizes', 'drop_sizes', 'drops', 'email_outbox', 'email_preferences',
  'email_state', 'engagement_runs', 'event_journal', 'genomes', 'geo_places', 'house_deliveries', 'house_guarantees', 'house_messages',
  'invitations', 'invoices', 'live_access_models', 'live_entries', 'live_entry_sizes', 'live_interest', 'live_interest_sizes', 'live_messages',
  'live_tier_windows', 'model_wish_months', 'order_addon_items', 'order_cases', 'order_events', 'orders', 'ownership', 'ownership_certificates',
  'ownership_transfers', 'partner_experiences', 'partner_invoices', 'partners', 'product_status_history', 'products', 'reception_lines',
  'receptions', 'release_answers', 'returns', 'scan_daily_stats', 'scan_events', 'scan_reports', 'scan_tokens', 'service_records', 'sessions',
  'set_sales', 'shipment_items', 'shipments', 'shop_requests', 'stock_corrections', 'stock_movements', 'supplier_order_lines', 'supplier_orders',
  'supplier_returns', 'test_entrants', 'test_run_entrants', 'test_runs', 'tier_grants', 'tracking_device_accounts', 'tracking_devices',
  'tracking_state', 'vault_gifts', 'vault_occasions_before', 'vaults', 'view_daily_stats', 'warranties', 'warranty_claims',
  'wish_months_counted', 'worn_photos',
];
/** platform_reset_gate.authorized_purpose (reset-plan.ts RESET_PURPOSES; the step-up's purposes). */
const PURPOSES = `'platform.reset','platform.reset.lock'`;
/** The advisory locks, as db/connection.ts ADVISORY_LOCK names them. */
const LOCK = { AUDIT_CHAIN: 0x4f52_0001, CATEGORY_ALLOCATION: 0x4f52_0002, SERIAL_ALLOCATION: 0x4f52_0003, LIVE_ENGINE: 0x4f52_0301, INVOICE_NUMBER: 0x4f52_0401, PARTNER_INVOICE_NUMBER: 0x4f52_0402 } as const;
/** How many kinds each numbering has (schema.ts INVOICE_KINDS, PARTNER_INVOICE_KINDS) and the serials' category indices (0..31). */
const INVOICE_KIND_COUNT = 2;
const PARTNER_INVOICE_KIND_COUNT = 2;
const CATEGORY_INDICES = 32;
/** A LIVE room opens that long before T0 when its release names none (services/live.ts LIVE_ROOM_OPENS_MINUTES.default). */
const ROOM_OPENS_DEFAULT_MINUTES = 5;
/** The gate's columns a reset changes (reset-plan.ts RESET_GATE_CHANGED); every other one is checked unchanged. */
const GATE_CHANGED = ['last_reset_at', 'last_reset_by', 'resets', 'last_reset_details'];

/** The settings each function runs with (each asserted by test, exactly). */
const READ_ONLY = `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp`;
const GATE_WRITER = `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '5s'`;
const RESETTER = `SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '5s' SET orbes.guard_bypass = 'reset'`;

/** A refusal of the reset: SQLSTATE OR011, the reason as the message (the app maps it to its words). */
const refuse = (reason: string, detail: string) => `RAISE EXCEPTION USING ERRCODE = 'OR011', MESSAGE = '${reason}', DETAIL = ${detail}`;
const IS_SUPERUSER = `coalesce((SELECT su.rolsuper FROM pg_catalog.pg_roles su WHERE su.rolname = current_user), false)`;
/** A time as the console and the step-up read it: ISO-8601 in UTC, to the microsecond. */
const iso = (expr: string) => `to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/**
 * The 9 Oct fingerprint of a set of rows (reset-to-catalogue.sql:161-182): their text, sorted, one per line, md5; NULL for
 * no row (every comparison is IS DISTINCT FROM). No quote in it: it is also written inside EXECUTE format('…').
 */
const digest = (text: string) => `md5(string_agg(${text}, chr(10) ORDER BY ${text}))`;

/**
 * The start guards (the 9 Oct bar, reset-to-catalogue.sql:106-111): the migrations' superuser, the origin replication
 * role, and every trigger of public in its normal state (`O`: one disabled, or set to fire in replica mode only, would
 * let a write through unguarded). Needs `v_off text` declared.
 */
const START_GUARDS = `
     IF NOT ${IS_SUPERUSER} THEN
       ${refuse('RESET_NOT_SUPERUSER', `format('the reset runs as the migrations'' superuser, not as %s', current_user)`)};
     END IF;
     IF current_setting('session_replication_role') <> 'origin' THEN
       ${refuse('RESET_REPLICA_MODE', `format('session_replication_role is %s, expected origin', current_setting('session_replication_role'))`)};
     END IF;
     SELECT string_agg(format('%s.%s (%s)', c.relname, t.tgname, t.tgenabled), ', ' ORDER BY c.relname, t.tgname) INTO v_off
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O';
     IF v_off IS NOT NULL THEN
       ${refuse('RESET_TRIGGER_DISABLED', `format('triggers not in their normal state: %s', v_off)`)};
     END IF;`;

/** An active holder: an ADMIN, not disabled, with two-factor authentication (the alias is the gate's). */
const holderActive = (gate: string) =>
  `EXISTS (SELECT 1 FROM public.admin_users h WHERE h.id = ${gate}.holder_admin_id AND h.role = 'ADMIN' AND h.disabled_at IS NULL AND h.totp_secret_enc IS NOT NULL)`;

/** The gate locked, then its holder (D12) and LOCK RESET (D13). Needs `g platform_reset_gate%ROWTYPE` declared. */
const HOLDER = `
     SELECT * INTO g FROM platform_reset_gate WHERE id = 1 FOR UPDATE;
     IF NOT FOUND OR g.holder_admin_id IS NULL OR NOT ${holderActive('g')} THEN
       ${refuse('RESET_NO_HOLDER', `'there is no active reset holder (an ADMIN with two-factor authentication)'`)};
     END IF;
     IF p_admin IS DISTINCT FROM g.holder_admin_id THEN
       ${refuse('RESET_NOT_HOLDER', `'only the reset holder can do this'`)};
     END IF;
     IF g.launched_at IS NOT NULL THEN
       ${refuse('RESET_LOCKED', `format('LOCK RESET was pressed at %s', g.launched_at)`)};
     END IF;`;

/** The single-use authorization for a purpose (§B.2 g): this admin's, under 5 minutes old, newer than the last reset; then cleared. */
const USE_AUTHORIZATION = (purpose: string) => `
     IF g.authorized_by IS DISTINCT FROM p_admin OR g.authorized_purpose IS DISTINCT FROM '${purpose}' OR g.authorized_at IS NULL
        OR g.authorized_at <= now() - interval '5 minutes' OR g.authorized_at > now()
        OR (g.last_reset_at IS NOT NULL AND g.authorized_at <= g.last_reset_at) THEN
       ${refuse('RESET_NOT_AUTHORIZED', `'no authorization of this admin for this, under 5 minutes old, since the last reset'`)};
     END IF;
     UPDATE platform_reset_gate SET authorized_by = NULL, authorized_at = NULL, authorized_purpose = NULL WHERE id = 1;
     g.authorized_by := NULL;
     g.authorized_at := NULL;
     g.authorized_purpose := NULL;`;

/** A LIVE room open now: a LIVE release or its after-room, published, not cancelled, its room opened and not ended. */
const LIVE_OPEN = `EXISTS (SELECT 1 FROM public.drops d
                   WHERE d.mode = 'LIVE' AND d.published_at IS NOT NULL AND d.cancelled_at IS NULL AND d.ended_at IS NULL
                     AND d.opens_at - coalesce(d.room_opens_minutes, ${ROOM_OPENS_DEFAULT_MINUTES}) * interval '1 minute' <= now())`;
/** A counted collector (services/population.ts countedCollector): not DELETED, not a test entrant, not the team's own. */
const COUNTED = (a: string) =>
  `${a}.status <> 'DELETED' AND NOT EXISTS (SELECT 1 FROM public.test_entrants te WHERE te.account_id = ${a}.id)
   AND NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email_normalized = ${a}.email_normalized)`;
/** The collectors changed since the owner looked (D7, G18): more of them, or one signed up after the newest he saw. */
const COLLECTORS_CHANGED = `(p_collectors_seen IS NULL OR p_collectors_seen < 0
     OR (SELECT count(*) FROM public.accounts a WHERE ${COUNTED('a')}) > p_collectors_seen
     OR EXISTS (SELECT 1 FROM public.accounts a WHERE ${COUNTED('a')} AND a.created_at > coalesce(p_collectors_seen_until, '-infinity'::timestamptz)))`;
/** A source the founding list names (kept). */
const SOURCE_KEPT = (s: string) => `EXISTS (SELECT 1 FROM public.preregistrations p WHERE p.source_id = ${s}.id)`;
/** A link a kept source names (kept). */
const LINK_KEPT = (l: string) => `EXISTS (SELECT 1 FROM public.acquisition_sources s WHERE s.link_id = ${l}.id AND ${SOURCE_KEPT('s')})`;
/** A segment that goes: its rules name a release (the 9 Oct rule) or a link that goes. */
const SEGMENT_GOES = (s: string) => `(jsonb_path_exists(${s}.criteria, 'lax $.**.dropId ? (@.type() == "string")')
     OR EXISTS (SELECT 1 FROM jsonb_path_query(${s}.criteria, 'lax $.**.linkIds[*]') AS x (v)
                 WHERE NOT EXISTS (SELECT 1 FROM public.links l WHERE l.id::text = lower(x.v #>> '{}') AND ${LINK_KEPT('l')})))`;
/** A photograph a kept model (its cover) or a lookbook uses (MediaService.deleteIfUnused's rule, the 9 Oct rule). */
const MEDIA_USED = (m: string) =>
  `(EXISTS (SELECT 1 FROM public.models x WHERE x.image_sha256 = ${m}.sha256) OR EXISTS (SELECT 1 FROM public.model_images x WHERE x.sha256 = ${m}.sha256))`;
/** A kept link as the reset leaves it: a link to a release now leads to the releases page (its release goes). */
const LINK_AFTER = (l: string) => `CASE WHEN ${l}.destination = 'RELEASE' THEN to_jsonb(${l}) || '{"destination": "RELEASES", "drop_id": null}'::jsonb ELSE to_jsonb(${l}) END`;

/** 0066's body, put back exactly by `down`. */
const REJECT_0066 = `CREATE OR REPLACE FUNCTION orbes_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     -- The purge's way through: a DELETE on one of its five tables of public, purpose 'purge', by a superuser (the
     -- purge's definer functions). Never an UPDATE, never a TRUNCATE; everything else raises as 0001 did.
     IF TG_OP = 'DELETE'
        AND TG_TABLE_SCHEMA = 'public'
        AND TG_TABLE_NAME IN ('audit_logs','order_events','event_journal','credit_uses','tier_grants')
        AND pg_catalog.current_setting('orbes.guard_bypass', true) = 'purge'
        AND ${IS_SUPERUSER} THEN
       IF TG_LEVEL = 'ROW' THEN
         RETURN OLD;
       END IF;
       RETURN NULL;
     END IF;
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = 'OR001';
   END $$`;

/** With the reset's way through too (§B.2 a). */
const REJECT_0067 = `CREATE OR REPLACE FUNCTION orbes_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     -- The purge's way through: a DELETE on one of its five tables of public, purpose 'purge', by a superuser (the
     -- purge's definer functions). Never an UPDATE, never a TRUNCATE; everything else raises as 0001 did.
     IF TG_OP = 'DELETE'
        AND TG_TABLE_SCHEMA = 'public'
        AND TG_TABLE_NAME IN ('audit_logs','order_events','event_journal','credit_uses','tier_grants')
        AND pg_catalog.current_setting('orbes.guard_bypass', true) = 'purge'
        AND ${IS_SUPERUSER} THEN
       IF TG_LEVEL = 'ROW' THEN
         RETURN OLD;
       END IF;
       RETURN NULL;
     END IF;
     -- The reset's way through (0067): a TRUNCATE of a table its plan wipes, or a DELETE on one it wipes or keeps in
     -- part, purpose 'reset', by a superuser (the reset's definer function). Never an UPDATE, never a kept table.
     IF TG_OP IN ('DELETE', 'TRUNCATE')
        AND TG_TABLE_SCHEMA = 'public'
        AND pg_catalog.current_setting('orbes.guard_bypass', true) = 'reset' THEN
       IF ${IS_SUPERUSER}
          AND EXISTS (SELECT 1 FROM public.platform_reset_plan p
                       WHERE p.tbl = TG_TABLE_NAME AND (p.kind = 'WIPE' OR (TG_OP = 'DELETE' AND p.kind = 'PARTLY'))) THEN
         IF TG_LEVEL = 'ROW' THEN
           RETURN OLD;
         END IF;
         RETURN NULL;
       END IF;
     END IF;
     RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, COALESCE(TG_ARGV[0], 'immutable')
       USING ERRCODE = 'OR001';
   END $$`;

const plan = [...KEEP.map((t) => [t, 'KEEP']), ...PARTLY.map((t) => [t, 'PARTLY']), ...WIPE.map((t) => [t, 'WIPE'])].sort(([a], [b]) => (a! < b! ? -1 : 1));

export const UP: readonly string[] = [
  // ── platform_reset_plan: every table and its class ───────────────────────
  `CREATE TABLE platform_reset_plan (
     tbl  text PRIMARY KEY CONSTRAINT platform_reset_plan_tbl_check CHECK (tbl ~ '^[a-z][a-z0-9_]{0,62}$'),
     kind text NOT NULL CONSTRAINT platform_reset_plan_kind_check CHECK (kind IN ('KEEP','PARTLY','WIPE'))
   )`,
  `INSERT INTO platform_reset_plan (tbl, kind) VALUES ${plan.map(([t, k]) => `('${t}', '${k}')`).join(', ')}`,
  `CREATE TRIGGER platform_reset_plan_superuser BEFORE INSERT OR UPDATE OR DELETE ON platform_reset_plan
     FOR EACH ROW EXECUTE FUNCTION orbes_require_superuser('the reset''s plan is written by the migrations only')`,
  `CREATE TRIGGER platform_reset_plan_no_truncate BEFORE TRUNCATE ON platform_reset_plan
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_require_superuser('the reset''s plan is written by the migrations only')`,

  // ── orbes_reject_mutation: the reset's way through ───────────────────────
  REJECT_0067,

  // ── platform_reset_gate: one row, the superuser's ────────────────────────
  `CREATE TABLE platform_reset_gate (
     id                 smallint    PRIMARY KEY CONSTRAINT platform_reset_gate_id_check CHECK (id = 1),
     holder_admin_id    uuid        NULL CONSTRAINT platform_reset_gate_holder_admin_id_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     launched_at        timestamptz NULL,
     launched_by        uuid        NULL CONSTRAINT platform_reset_gate_launched_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     last_reset_at      timestamptz NULL,
     last_reset_by      uuid        NULL CONSTRAINT platform_reset_gate_last_reset_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     resets             integer     NOT NULL DEFAULT 0 CONSTRAINT platform_reset_gate_resets_check CHECK (resets >= 0),
     last_reset_details jsonb       NULL CONSTRAINT platform_reset_gate_last_reset_details_check CHECK (jsonb_typeof(last_reset_details) = 'object'),
     authorized_by      uuid        NULL CONSTRAINT platform_reset_gate_authorized_by_fkey REFERENCES admin_users (id) ON DELETE RESTRICT,
     authorized_at      timestamptz NULL,
     authorized_purpose text        NULL CONSTRAINT platform_reset_gate_authorized_purpose_check CHECK (authorized_purpose IN (${PURPOSES})),
     CONSTRAINT platform_reset_gate_launched CHECK ((launched_at IS NULL) = (launched_by IS NULL)),
     CONSTRAINT platform_reset_gate_last_reset CHECK (
       (last_reset_at IS NULL) = (last_reset_by IS NULL) AND (last_reset_at IS NULL) = (last_reset_details IS NULL) AND (last_reset_at IS NULL) = (resets = 0)),
     CONSTRAINT platform_reset_gate_authorized CHECK (num_nulls(authorized_by, authorized_at, authorized_purpose) IN (0, 3))
   )`,
  `CREATE INDEX platform_reset_gate_holder_admin_id_idx ON platform_reset_gate (holder_admin_id)`,
  `CREATE INDEX platform_reset_gate_launched_by_idx ON platform_reset_gate (launched_by)`,
  `CREATE INDEX platform_reset_gate_last_reset_by_idx ON platform_reset_gate (last_reset_by)`,
  `CREATE INDEX platform_reset_gate_authorized_by_idx ON platform_reset_gate (authorized_by)`,
  // The holder (D12): the oldest active ADMIN with two-factor authentication now, at the deploy; NULL when none.
  `INSERT INTO platform_reset_gate (id, holder_admin_id)
     SELECT 1, (SELECT a.id FROM admin_users a WHERE a.role = 'ADMIN' AND a.disabled_at IS NULL AND a.totp_secret_enc IS NOT NULL
                 ORDER BY a.created_at, a.id LIMIT 1)`,
  `CREATE FUNCTION orbes_platform_reset_gate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF NOT ${IS_SUPERUSER} THEN
       RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, 'written by the reset functions only' USING ERRCODE = 'OR001';
     END IF;
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, 'the gate is one row, kept for good' USING ERRCODE = 'OR001';
     END IF;
     IF TG_OP = 'UPDATE' THEN
       IF OLD.launched_at IS NOT NULL
          AND (NEW.launched_at IS DISTINCT FROM OLD.launched_at OR NEW.launched_by IS DISTINCT FROM OLD.launched_by
               OR NEW.holder_admin_id IS DISTINCT FROM OLD.holder_admin_id) THEN
         RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, 'LOCK RESET is one way: the lock and the holder never change once it is pressed' USING ERRCODE = 'OR001';
       END IF;
       IF NEW.resets < OLD.resets THEN
         RAISE EXCEPTION '% on % is not allowed (%)', TG_OP, TG_TABLE_NAME, 'the count of resets never goes down' USING ERRCODE = 'OR001';
       END IF;
     END IF;
     RETURN NEW;
   END $$`,
  `CREATE TRIGGER platform_reset_gate_guard BEFORE INSERT OR UPDATE OR DELETE ON platform_reset_gate
     FOR EACH ROW EXECUTE FUNCTION orbes_platform_reset_gate_guard()`,
  `CREATE TRIGGER platform_reset_gate_no_truncate BEFORE TRUNCATE ON platform_reset_gate
     FOR EACH STATEMENT EXECUTE FUNCTION orbes_reject_mutation('the gate is one row, kept for good')`,

  // ── the numbering locks, in the services' own two-part form (G5) ─────────
  // INVOICE_NUMBER and PARTNER_INVOICE_NUMBER: year * 2 + kind (invoices.ts:217, partners.ts:470); SERIAL_ALLOCATION:
  // (year - 2000) * 32 + category index (issuance.ts serialLockKey). The caller's rights; revoked from PUBLIC.
  `CREATE FUNCTION orbes_platform_reset_numbering_locks(p_year int) RETURNS TABLE (key int, sub int) LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
     SELECT ${LOCK.INVOICE_NUMBER}, p_year * 2 + k FROM generate_series(0, ${INVOICE_KIND_COUNT - 1}) AS k
     UNION ALL
     SELECT ${LOCK.PARTNER_INVOICE_NUMBER}, p_year * 2 + k FROM generate_series(0, ${PARTNER_INVOICE_KIND_COUNT - 1}) AS k
     UNION ALL
     SELECT ${LOCK.SERIAL_ALLOCATION}, (p_year - 2000) * 32 + c FROM generate_series(0, ${CATEGORY_INDICES - 1}) AS c
   $$`,

  // ── the precheck: read only, the console's GET and the request before its step-up ──
  `CREATE FUNCTION orbes_platform_reset_precheck(p_admin uuid, p_collectors_seen int DEFAULT NULL, p_collectors_seen_until timestamptz DEFAULT NULL)
     RETURNS text LANGUAGE plpgsql STABLE ${READ_ONLY} AS $$
   DECLARE
     g platform_reset_gate%ROWTYPE;
   BEGIN
     SELECT * INTO g FROM platform_reset_gate WHERE id = 1;
     IF NOT FOUND OR g.holder_admin_id IS NULL OR NOT ${holderActive('g')} THEN
       RETURN 'NO_HOLDER';
     END IF;
     IF p_admin IS DISTINCT FROM g.holder_admin_id THEN
       RETURN 'NOT_HOLDER';
     END IF;
     IF g.launched_at IS NOT NULL THEN
       RETURN 'LOCKED';
     END IF;
     IF orbes_maintenance_window_within(now(), interval '5 minutes') IS NOT NULL THEN
       RETURN 'WINDOW';
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE status = 'RUNNING') THEN
       RETURN 'TEST_RUNNING';
     END IF;
     IF ${LIVE_OPEN} THEN
       RETURN 'LIVE_OPEN';
     END IF;
     IF p_collectors_seen IS NOT NULL AND ${COLLECTORS_CHANGED} THEN
       RETURN 'COLLECTORS_CHANGED';
     END IF;
     RETURN NULL;
   END $$`,

  // ── the authorization (§B.2 g): written only in the step-up's own transaction ──
  `CREATE FUNCTION orbes_platform_reset_authorize(p_admin uuid, p_purpose text) RETURNS void LANGUAGE plpgsql ${GATE_WRITER} AS $$
   DECLARE
     g platform_reset_gate%ROWTYPE;
     v_off text;
     v_xid xid;
     v_step bigint;
   BEGIN
     ${START_GUARDS}
     IF p_purpose IS NULL OR p_purpose NOT IN (${PURPOSES}) THEN
       ${refuse('RESET_NOT_AUTHORIZED', `format('no such purpose: %s', coalesce(p_purpose, 'NULL'))`)};
     END IF;
     ${HOLDER}
     -- This very transaction consumed the holder's step-up for this purpose (its admin_users row updated, its
     -- admin.step_up row written) and then audited the request: both rows' xmin is this transaction's id.
     v_xid := pg_catalog.pg_current_xact_id()::xid;
     IF NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.id = p_admin AND a.xmin = v_xid) THEN
       ${refuse('RESET_NOT_AUTHORIZED', `'no step-up of this admin in this transaction'`)};
     END IF;
     SELECT max(l.id) INTO v_step FROM audit_logs l
      WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.step_up'
        AND l.actor_type = 'admin' AND l.actor_id = p_admin::text AND (l.details ->> 'purpose') = p_purpose AND l.xmin = v_xid;
     IF v_step IS NULL THEN
       ${refuse('RESET_NOT_AUTHORIZED', `format('no step-up of this admin for %s in this transaction', p_purpose)`)};
     END IF;
     IF NOT EXISTS (SELECT 1 FROM audit_logs l
                     WHERE l.id > v_step AND l.action = p_purpose || '.requested'
                       AND l.actor_type = 'admin' AND l.actor_id = p_admin::text AND l.xmin = v_xid) THEN
       ${refuse('RESET_NOT_AUTHORIZED', `format('no %s.requested of this admin after its step-up in this transaction', p_purpose)`)};
     END IF;
     UPDATE platform_reset_gate SET authorized_by = p_admin, authorized_at = now(), authorized_purpose = p_purpose WHERE id = 1;
   END $$`,
  `CREATE FUNCTION orbes_platform_reset_unauthorize() RETURNS void LANGUAGE plpgsql ${GATE_WRITER} AS $$
   BEGIN
     IF NOT ${IS_SUPERUSER} THEN
       ${refuse('RESET_NOT_SUPERUSER', `format('the reset runs as the migrations'' superuser, not as %s', current_user)`)};
     END IF;
     IF current_setting('session_replication_role') <> 'origin' THEN
       ${refuse('RESET_REPLICA_MODE', `format('session_replication_role is %s, expected origin', current_setting('session_replication_role'))`)};
     END IF;
     UPDATE platform_reset_gate SET authorized_by = NULL, authorized_at = NULL, authorized_purpose = NULL
      WHERE id = 1 AND authorized_by IS NOT NULL;
   END $$`,

  // ── LOCK RESET (§B.2 e): one way; allowed in any window ──────────────────
  `CREATE FUNCTION orbes_platform_reset_lock(p_admin uuid) RETURNS timestamptz LANGUAGE plpgsql ${GATE_WRITER} AS $$
   DECLARE
     g platform_reset_gate%ROWTYPE;
     v_off text;
   BEGIN
     ${START_GUARDS}
     ${HOLDER}
     ${USE_AUTHORIZATION('platform.reset.lock')}
     UPDATE platform_reset_gate SET launched_at = now(), launched_by = p_admin WHERE id = 1;
     RETURN now();
   END $$`,

  // ── THE RESET (§B.2 d) ───────────────────────────────────────────────────
  `CREATE FUNCTION orbes_platform_reset(p_admin uuid, p_collectors_seen int, p_collectors_seen_until timestamptz) RETURNS jsonb
     LANGUAGE plpgsql ${RESETTER} AS $$
   DECLARE
     g platform_reset_gate%ROWTYPE;
     g2 platform_reset_gate%ROWTYPE;
     r record;
     v_off text;
     v_kind text;
     v_year int;
     v_n bigint;
     v_h text;
     v_states text;
     v_diff text;
     v_stmt text;
     v_collectors bigint;
     v_bad text[] := '{}';
     v_counts jsonb := '{}';
     v_keep jsonb := '{}';
     v_wiped jsonb := '{}';
     v_kept jsonb := '{}';
     v_partly jsonb := '{}';
     v_seq jsonb := '{}';
     v_restarted jsonb := '[]';
     v_gate jsonb;
     v_triggers bigint;
     v_fks bigint;
     v_capture jsonb;
     v_details jsonb;
     v_head jsonb;
     v_totp jsonb;
     v_step bigint;
     v_request bigint;
     v_recent jsonb;
     v_segments_gone jsonb;
     v_media_h text;
     v_rev_h text;
     v_seg_h text;
     v_vr_ids uuid[];
     v_vr_rest_h text;
     v_vr_zero_ids uuid[];
     v_vr_zero_h text;
     v_pre_n bigint;
     v_pre_h text;
     v_src_h text;
     v_link_h text;
   BEGIN
     -- 1. START GUARDS: the migrations' superuser, origin, every trigger on; the gate, its holder, not launched; the
     -- authorization of this request, used once (a ROLLBACK gives it back: the caller then calls unauthorize).
     ${START_GUARDS}
     ${HOLDER}
     ${USE_AUTHORIZATION('platform.reset')}

     -- 2. Outside every forbidden window with a 5-minute margin; no test running; no LIVE room open.
     v_kind := orbes_maintenance_window_within(now(), interval '5 minutes');
     IF v_kind IS NOT NULL THEN
       ${refuse('RESET_WINDOW', 'v_kind')};
     END IF;
     IF EXISTS (SELECT 1 FROM test_runs WHERE status = 'RUNNING') THEN
       ${refuse('RESET_TEST_RUNNING', `'a test is running'`)};
     END IF;
     IF ${LIVE_OPEN} THEN
       ${refuse('RESET_LIVE_OPEN', `'a LIVE room is open'`)};
     END IF;

     -- 3. The LIVE engine has stopped (its session lock is free); then the chain's and the numbers' locks, in the
     -- services' own forms, for the current and the next UTC year, held to COMMIT.
     IF NOT pg_try_advisory_xact_lock(${LOCK.LIVE_ENGINE}::bigint) THEN
       ${refuse('RESET_LIVE_ENGINE', `'the LIVE engine is still running'`)};
     END IF;
     PERFORM pg_advisory_xact_lock(${LOCK.AUDIT_CHAIN}::bigint);
     PERFORM pg_advisory_xact_lock(${LOCK.CATEGORY_ALLOCATION}::bigint);
     v_year := extract(year FROM now() AT TIME ZONE 'UTC')::int;
     FOR r IN SELECT k.key, k.sub FROM orbes_platform_reset_numbering_locks(v_year) k
              UNION ALL SELECT k.key, k.sub FROM orbes_platform_reset_numbering_locks(v_year + 1) k LOOP
       PERFORM pg_advisory_xact_lock(r.key, r.sub);
     END LOOP;

     -- 4. Nobody else connected to this database, whatever its name or state (the 9 Oct rule, no exception: the
     -- app closes its pool and resets through one dedicated connection).
     SELECT count(*), string_agg(coalesce(a.state, '?'), ', ' ORDER BY coalesce(a.state, '?')) INTO v_n, v_states
       FROM pg_stat_activity a
      WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.backend_type = 'client backend';
     IF v_n > 0 THEN
       ${refuse('RESET_OTHER_CONNECTIONS', `format('%s other connection(s) to this database: %s', v_n, v_states)`)};
     END IF;

     -- 5 and 6. The tables are the plan's, both ways; every table locked before the snapshot (kept ones against any
     -- write, wiped ones whole), then the plan checked again under the locks.
     SELECT string_agg(x, ', ' ORDER BY x) INTO v_diff FROM (
       (SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' EXCEPT SELECT tbl FROM platform_reset_plan)
       UNION ALL
       (SELECT tbl FROM platform_reset_plan EXCEPT SELECT tablename::text FROM pg_tables WHERE schemaname = 'public')) AS d (x);
     IF v_diff IS NOT NULL THEN
       ${refuse('RESET_UNPLANNED_TABLES', `format('tables not in the plan, or in the plan and missing: %s', v_diff)`)};
     END IF;
     FOR r IN SELECT p.tbl, p.kind FROM platform_reset_plan p ORDER BY p.tbl LOOP
       EXECUTE format('LOCK TABLE public.%I IN %s MODE', r.tbl, CASE WHEN r.kind = 'WIPE' THEN 'ACCESS EXCLUSIVE' ELSE 'SHARE ROW EXCLUSIVE' END);
     END LOOP;
     SELECT string_agg(x, ', ' ORDER BY x) INTO v_diff FROM (
       (SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' EXCEPT SELECT tbl FROM platform_reset_plan)
       UNION ALL
       (SELECT tbl FROM platform_reset_plan EXCEPT SELECT tablename::text FROM pg_tables WHERE schemaname = 'public')) AS d (x);
     IF v_diff IS NOT NULL THEN
       ${refuse('RESET_UNPLANNED_TABLES', `format('tables not in the plan, or in the plan and missing: %s', v_diff)`)};
     END IF;

     -- 6a. The collectors the owner saw (D7, G18): no more of them, none signed up after the newest he saw.
     SELECT count(*) INTO v_collectors FROM accounts a WHERE ${COUNTED('a')};
     IF ${COLLECTORS_CHANGED} THEN
       ${refuse('RESET_COLLECTORS_CHANGED', `format('%s accounts neither test nor team now, %s seen until %s', v_collectors, coalesce(p_collectors_seen::text, 'none'), coalesce(p_collectors_seen_until::text, 'none'))`)};
     END IF;

     -- 6b. CAPTURE, read only, before any change: what stays that a test may have made, what goes that has a name, the
     -- old chain's head, the holder's second factor, the request, and the facts the step-up counts for 24 h (H5).
     -- Ids, names of catalogue and settings rows, staff emails, dates and hashes only: no secret, no collector data.
     SELECT jsonb_build_object(
       'skus', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'code', k.code,
                  'model', CASE WHEN m.id IS NOT NULL THEN m.name || coalesce(' / ' || m.variant_label, '') END,
                  'addon', ai.name,
                  'size', coalesce(k.size_label, 'ONE SIZE'),
                  'sizeType', m.size_type,
                  'status', CASE WHEN k.set_aside_at IS NULL THEN 'offered' ELSE 'set aside' END,
                  'createdAt', ${iso('k.created_at')},
                  'pieces', (SELECT count(*) FROM products x WHERE x.sku_id = k.id),
                  'orders', (SELECT count(*) FROM orders x WHERE x.sku_id = k.id),
                  'releaseSizes', (SELECT count(*) FROM drop_sizes x WHERE x.sku_id = k.id),
                  'stockMoves', (SELECT count(*) FROM stock_movements x WHERE x.sku_id = k.id),
                  'how', o.how,
                  'check', (o.how = 'by a flow' AND k.set_aside_at IS NULL))
                  ORDER BY lower(coalesce(m.name, ai.name, '')), lower(coalesce(m.variant_label, '')), k.created_at, k.code), '[]'::jsonb)
                  FROM skus k
                  LEFT JOIN models m ON m.id = k.model_id
                  LEFT JOIN addon_items ai ON ai.id = k.addon_id
                  CROSS JOIN LATERAL (SELECT CASE
                    WHEN k.addon_id IS NOT NULL THEN 'with the add-on'
                    WHEN EXISTS (SELECT 1 FROM audit_logs a
                                  WHERE a.target_type = 'model' AND a.target_id = k.model_id::text AND a.action = 'model.sizes.declare'
                                    AND (jsonb_path_exists(a.details, '$.added[*] ? (@ == $c)', jsonb_build_object('c', k.code))
                                      OR jsonb_path_exists(a.details, '$.reinstated[*] ? (@ == $c)', jsonb_build_object('c', k.code))))
                      THEN 'declared'
                    WHEN EXISTS (SELECT 1 FROM audit_logs a
                                  WHERE a.target_type = 'model' AND a.target_id = k.model_id::text
                                    AND ((a.action = 'model.create' AND k.size_label IS NULL AND a.details ? 'sizeType')
                                      OR (a.action = 'model.variant.create'
                                          AND jsonb_path_exists(a.details, '$.sizes[*] ? (@ == $s)', jsonb_build_object('s', coalesce(k.size_label, 'ONE SIZE'))))))
                      THEN 'with the model'
                    WHEN m.size_type IS NOT NULL THEN 'before the type'
                    ELSE 'by a flow' END AS how) o),
       'logins', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'email', a.email, 'role', a.role, 'totp', a.totp_secret_enc IS NOT NULL,
                    'status', CASE WHEN a.disabled_at IS NULL THEN 'active' ELSE 'disabled' END, 'createdAt', ${iso('a.created_at')})
                    ORDER BY a.created_at, a.email), '[]'::jsonb) FROM admin_users a),
       'suppliers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'name', s.name, 'status', CASE WHEN s.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('s.created_at')})
                       ORDER BY lower(s.name), s.id), '[]'::jsonb) FROM suppliers s),
       'pointsOfSale', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'name', x.name, 'city', x.city, 'country', x.country, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END,
                          'createdAt', ${iso('x.created_at')}) ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM retailers x),
       'carriers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'name', c.name, 'status', CASE WHEN c.active THEN 'offered' ELSE 'set aside' END, 'createdAt', ${iso('c.created_at')})
                      ORDER BY lower(c.name), c.id), '[]'::jsonb) FROM carriers c),
       'stockLocations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'name', l.name, 'default', l.is_default, 'address', l.address IS NOT NULL, 'createdAt', ${iso('l.created_at')})
                            ORDER BY lower(l.name), l.id), '[]'::jsonb) FROM stock_locations l),
       'boxes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'name', b.name, 'status', CASE WHEN b.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('b.created_at')})
                   ORDER BY lower(b.name), b.id), '[]'::jsonb) FROM boxes b),
       'addons', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'name', x.name, 'kind', x.kind, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('x.created_at')})
                    ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM addon_items x),
       'sets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'name', x.name, 'code', x.code, 'status', CASE WHEN x.active THEN 'active' ELSE 'inactive' END, 'createdAt', ${iso('x.created_at')})
                  ORDER BY lower(x.name), x.id), '[]'::jsonb) FROM sets x),
       'vaultRewardsGiven', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                               'id', v.id, 'kind', v.kind, 'given', v.given, 'quantity', v.quantity, 'active', v.active)
                               ORDER BY v.position, v.id), '[]'::jsonb) FROM vault_rewards v WHERE v.given > 0),
       'adsEventsFrom', (SELECT ${iso('x.events_from')} FROM ads_settings x WHERE x.events_from IS NOT NULL ORDER BY x.id LIMIT 1),
       'pieceRanges', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                         'year', q.year, 'category', q.category, 'pieces', q.pieces, 'first', q.first, 'last', q.last)
                         ORDER BY q.year, q.category), '[]'::jsonb)
                         FROM (SELECT p.year, btrim(c.code) AS category, count(*) AS pieces, min(p.product_id) AS first, max(p.product_id) AS last
                                 FROM products p JOIN categories c ON c.id = p.category_id GROUP BY p.year, btrim(c.code)) q),
       'segmentsGone', (SELECT coalesce(jsonb_agg(s.name ORDER BY lower(s.name), s.id), '[]'::jsonb) FROM segments s WHERE ${SEGMENT_GOES('s')}),
       'keys', (SELECT coalesce(jsonb_agg(jsonb_build_object('keyId', k.key_id, 'kid', k.kid, 'status', k.status) ORDER BY k.key_id), '[]'::jsonb)
                  FROM cryptographic_keys k)
     ) INTO v_capture;
     v_segments_gone := v_capture -> 'segmentsGone';

     SELECT jsonb_build_object('id', l.id, 'hash', encode(l.hash, 'hex')) INTO v_head FROM audit_logs l ORDER BY l.id DESC LIMIT 1;
     SELECT jsonb_build_object(
       'enabledAt', (SELECT ${iso('l.occurred_at')} FROM audit_logs l WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.totp.enable' ORDER BY l.id DESC LIMIT 1),
       'enabledBy', (SELECT l.actor_id FROM audit_logs l WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.totp.enable' ORDER BY l.id DESC LIMIT 1),
       'disabledAt', (SELECT ${iso('l.occurred_at')} FROM audit_logs l WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.totp.disable' ORDER BY l.id DESC LIMIT 1),
       'disabledBy', (SELECT l.actor_id FROM audit_logs l WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.totp.disable' ORDER BY l.id DESC LIMIT 1)
     ) INTO v_totp;
     SELECT max(l.id) INTO v_step FROM audit_logs l
      WHERE l.target_type = 'admin' AND l.target_id = p_admin::text AND l.action = 'admin.step_up' AND (l.details ->> 'purpose') = 'platform.reset';
     SELECT max(l.id) INTO v_request FROM audit_logs l
      WHERE l.id > coalesce(v_step, 0) AND l.action = 'platform.reset.requested' AND l.actor_type = 'admin' AND l.actor_id = p_admin::text;
     -- For every console login, the rows of the last 24 h that the step-up's daily limit and its 24-hour rule count
     -- (auth.ts stepUpRecentFacts), and those entry 1 of the current chain still carries from a reset before (§S.2.8).
     SELECT coalesce(jsonb_agg(f.fact ORDER BY f.at, f.ord), '[]'::jsonb) INTO v_recent FROM (
       SELECT l.occurred_at AS at, l.id AS ord, jsonb_strip_nulls(jsonb_build_object(
                'action', l.action, 'targetAdminId', a.id::text, 'occurredAt', ${iso('l.occurred_at')},
                'from', CASE WHEN l.action = 'admin.role_change' THEN l.details ->> 'from' END,
                'to', CASE WHEN l.action = 'admin.role_change' THEN l.details ->> 'to'
                           WHEN l.action = 'admin.create' THEN coalesce(l.details ->> 'to', l.details ->> 'role') END)) AS fact
         FROM admin_users a JOIN audit_logs l ON l.target_type = 'admin' AND l.target_id = a.id::text
        WHERE l.occurred_at > now() - interval '24 hours'
          AND ((l.action = 'admin.login_failed' AND (l.details ->> 'via') = 'step_up')
            OR l.action IN ('admin.totp.enable', 'admin.totp.disable')
            OR (l.action = 'admin.role_change' AND ((l.details ->> 'from') = 'ADMIN' OR (l.details ->> 'to') = 'ADMIN'))
            OR (l.action = 'admin.create' AND coalesce(l.details ->> 'to', l.details ->> 'role') = 'ADMIN'))
       UNION ALL
       SELECT (c.v ->> 'occurredAt')::timestamptz, 0, jsonb_strip_nulls(jsonb_build_object(
                'action', c.v ->> 'action', 'targetAdminId', c.v ->> 'targetAdminId', 'occurredAt', c.v ->> 'occurredAt',
                'from', c.v ->> 'from', 'to', c.v ->> 'to'))
         FROM audit_logs e
         CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.details -> 'recent24h') = 'array' THEN e.details -> 'recent24h' ELSE '[]'::jsonb END) AS c (v)
        WHERE e.id = 1 AND e.action = 'platform.reset'
          AND jsonb_typeof(c.v) = 'object'
          AND (c.v ->> 'action') IN ('admin.login_failed', 'admin.totp.enable', 'admin.totp.disable', 'admin.role_change', 'admin.create')
          AND (c.v ->> 'targetAdminId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (c.v ->> 'occurredAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$'
          AND (c.v ->> 'occurredAt')::timestamptz > now() - interval '24 hours'
     ) AS f;

     -- 6c. SNAPSHOT: every table's rows; every kept table's fingerprint; each partly kept table's rows as they must
     -- stay; the gate (its authorization already cleared); the sequences; the triggers and foreign keys.
     FOR r IN SELECT p.tbl, p.kind FROM platform_reset_plan p ORDER BY p.tbl LOOP
       IF r.kind = 'KEEP' THEN
         EXECUTE format('SELECT count(*), ${digest('x::text')} FROM public.%I x', r.tbl) INTO v_n, v_h;
         v_keep := v_keep || jsonb_build_object(r.tbl, jsonb_build_object('n', v_n, 'h', v_h));
       ELSE
         EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO v_n;
       END IF;
       v_counts := v_counts || jsonb_build_object(r.tbl, v_n);
     END LOOP;
     SELECT ${digest('m::text')} INTO v_media_h FROM media_objects m WHERE ${MEDIA_USED('m')};
     SELECT ${digest('x::text')} INTO v_rev_h FROM revocations x WHERE x.target_type = 'KEY';
     SELECT ${digest('s::text')} INTO v_seg_h FROM segments s WHERE NOT ${SEGMENT_GOES('s')};
     SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}'), ${digest(`(to_jsonb(v) - 'updated_at' - 'given')::text`)} INTO v_vr_ids, v_vr_rest_h FROM vault_rewards v;
     SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}'), ${digest('v::text')} INTO v_vr_zero_ids, v_vr_zero_h FROM vault_rewards v WHERE v.given = 0;
     SELECT count(*), ${digest(`(to_jsonb(p) - 'account_id' - 'matched_at')::text`)} INTO v_pre_n, v_pre_h FROM preregistrations p;
     SELECT ${digest('s::text')} INTO v_src_h FROM acquisition_sources s WHERE ${SOURCE_KEPT('s')};
     SELECT ${digest(`(${LINK_AFTER('l')})::text`)} INTO v_link_h FROM links l WHERE ${LINK_KEPT('l')};
     SELECT to_jsonb(x) INTO v_gate FROM platform_reset_gate x WHERE x.id = 1;
     SELECT coalesce(jsonb_object_agg(s.sequencename, jsonb_build_object('last', s.last_value, 'tbl', o.tbl)), '{}') INTO v_seq
       FROM pg_sequences s
       LEFT JOIN LATERAL (SELECT t.relname::text AS tbl FROM pg_depend d JOIN pg_class q ON q.oid = d.objid JOIN pg_class t ON t.oid = d.refobjid
                            WHERE q.relname = s.sequencename AND q.relkind = 'S' AND q.relnamespace = 'public'::regnamespace AND d.deptype IN ('a', 'i') LIMIT 1) o ON true
      WHERE s.schemaname = 'public';
     SELECT count(*) INTO v_triggers FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O';
     SELECT count(*) INTO v_fks FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f';

     -- 7. ONE TRUNCATE of every wiped table but drops and accounts, no CASCADE, the identities restarted.
     SELECT 'TRUNCATE TABLE ' || string_agg(format('public.%I', p.tbl), ', ' ORDER BY p.tbl) || ' RESTART IDENTITY' INTO v_stmt
       FROM platform_reset_plan p WHERE p.kind = 'WIPE' AND p.tbl NOT IN ('drops', 'accounts');
     IF v_stmt IS NULL OR v_stmt ~* 'cascade' THEN
       ${refuse('RESET_UNPLANNED_TABLES', `'refusing a TRUNCATE with CASCADE, or of nothing'`)};
     END IF;
     EXECUTE v_stmt;

     -- 8. The partial steps, every trigger and foreign key on, IN THIS ORDER (drops.access_segment_id and
     -- drops.silhouette_sha256 are RESTRICT: segments and photographs lose rows only once drops is empty).
     -- (i) the founding list cleared of its accounts;
     UPDATE preregistrations SET account_id = NULL, matched_at = NULL WHERE account_id IS NOT NULL OR matched_at IS NOT NULL;
     -- (ii) every link to a release re-pointed to the releases page (those the founding list does not need go at (v);
     -- until then they would still hold their release);
     UPDATE links SET destination = 'RELEASES', drop_id = NULL WHERE destination = 'RELEASE';
     -- (iii) the releases, after-room children first;
     DELETE FROM drops WHERE parent_drop_id IS NOT NULL;
     DELETE FROM drops;
     -- (iv) every account, in one statement (its own invited_by checked at the statement's end);
     DELETE FROM accounts;
     -- (v) the sources the founding list does not name, then the links no kept source names;
     DELETE FROM acquisition_sources s WHERE NOT ${SOURCE_KEPT('s')};
     DELETE FROM links l WHERE NOT EXISTS (SELECT 1 FROM acquisition_sources s WHERE s.link_id = l.id);
     -- (vi) the segments naming a release or a link that went;
     DELETE FROM segments s WHERE ${SEGMENT_GOES('s')};
     -- (vii) the revocations of codes and pieces (those of keys stay);
     DELETE FROM revocations WHERE target_type IS DISTINCT FROM 'KEY';
     -- (viii) the photographs no kept model or lookbook uses;
     DELETE FROM media_objects m WHERE NOT ${MEDIA_USED('m')};
     -- (ix) the rewards given set back to 0 given, only those (their updated_at moves with them).
     UPDATE vault_rewards SET given = 0 WHERE given > 0;

     -- 9. PROOFS before returning: any failure raises OR020 with every failed check; the caller rolls back.
     FOR r IN SELECT p.tbl, p.kind FROM platform_reset_plan p ORDER BY p.tbl LOOP
       IF r.kind = 'KEEP' THEN
         EXECUTE format('SELECT count(*), ${digest('x::text')} FROM public.%I x', r.tbl) INTO v_n, v_h;
         IF v_n IS DISTINCT FROM (v_keep -> r.tbl ->> 'n')::bigint OR v_h IS DISTINCT FROM (v_keep -> r.tbl ->> 'h') THEN
           v_bad := v_bad || format('kept table %s changed (%s rows before, %s after)', r.tbl, v_keep -> r.tbl ->> 'n', v_n);
         END IF;
         v_kept := v_kept || jsonb_build_object(r.tbl, v_n);
       ELSE
         EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO v_n;
         IF r.kind = 'WIPE' THEN
           IF v_n <> 0 THEN
             v_bad := v_bad || format('wiped table %s still has %s rows', r.tbl, v_n);
           END IF;
           v_wiped := v_wiped || jsonb_build_object(r.tbl, (v_counts ->> r.tbl)::bigint);
         ELSE
           IF v_n > (v_counts ->> r.tbl)::bigint THEN
             v_bad := v_bad || format('table %s grew (%s rows before, %s after)', r.tbl, v_counts ->> r.tbl, v_n);
           END IF;
           v_partly := v_partly || jsonb_build_object(r.tbl, jsonb_build_object('before', (v_counts ->> r.tbl)::bigint, 'after', v_n));
         END IF;
       END IF;
     END LOOP;
     -- media_objects: exactly the photographs a kept model or lookbook used; each cover and lookbook image still has its own.
     SELECT ${digest('m::text')} INTO v_h FROM media_objects m;
     IF v_h IS DISTINCT FROM v_media_h THEN
       v_bad := v_bad || 'media_objects: not exactly the photographs a kept model or lookbook uses'::text;
     END IF;
     IF EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_objects m WHERE m.sha256 = x.image_sha256))
        OR EXISTS (SELECT 1 FROM model_images x WHERE NOT EXISTS (SELECT 1 FROM media_objects m WHERE m.sha256 = x.sha256)) THEN
       v_bad := v_bad || 'media_objects: a model cover or a lookbook image without its photograph'::text;
     END IF;
     -- revocations: exactly those of keys.
     SELECT ${digest('x::text')} INTO v_h FROM revocations x;
     IF v_h IS DISTINCT FROM v_rev_h THEN
       v_bad := v_bad || 'revocations: not exactly the revocations of keys'::text;
     END IF;
     -- segments: exactly those naming no release and no link that went.
     SELECT ${digest('s::text')} INTO v_h FROM segments s;
     IF v_h IS DISTINCT FROM v_seg_h OR EXISTS (SELECT 1 FROM segments s WHERE ${SEGMENT_GOES('s')}) THEN
       v_bad := v_bad || 'segments: not exactly those naming no release and no link that goes'::text;
     END IF;
     -- vault_rewards: the same rewards, every column but updated_at and given unchanged, 0 given everywhere; those
     -- never given byte for byte.
     IF (SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') FROM vault_rewards v) IS DISTINCT FROM v_vr_ids THEN
       v_bad := v_bad || 'vault_rewards: not the same rewards'::text;
     END IF;
     SELECT ${digest(`(to_jsonb(v) - 'updated_at' - 'given')::text`)} INTO v_h FROM vault_rewards v;
     IF v_h IS DISTINCT FROM v_vr_rest_h THEN
       v_bad := v_bad || 'vault_rewards: a column other than given and updated_at changed'::text;
     END IF;
     IF EXISTS (SELECT 1 FROM vault_rewards v WHERE v.given <> 0) THEN
       v_bad := v_bad || 'vault_rewards: a reward still given'::text;
     END IF;
     SELECT ${digest('v::text')} INTO v_h FROM vault_rewards v WHERE v.id = ANY (v_vr_zero_ids);
     IF v_h IS DISTINCT FROM v_vr_zero_h THEN
       v_bad := v_bad || 'vault_rewards: a reward never given changed'::text;
     END IF;
     -- preregistrations: the same founding list, only its accounts cleared.
     SELECT count(*), ${digest(`(to_jsonb(p) - 'account_id' - 'matched_at')::text`)} INTO v_n, v_h FROM preregistrations p;
     IF v_n IS DISTINCT FROM v_pre_n OR v_h IS DISTINCT FROM v_pre_h
        OR EXISTS (SELECT 1 FROM preregistrations p WHERE p.account_id IS NOT NULL OR p.matched_at IS NOT NULL) THEN
       v_bad := v_bad || 'preregistrations: not the same founding list with its accounts cleared'::text;
     END IF;
     -- acquisition_sources: exactly those the founding list names, unchanged.
     SELECT ${digest('s::text')} INTO v_h FROM acquisition_sources s;
     IF v_h IS DISTINCT FROM v_src_h THEN
       v_bad := v_bad || 'acquisition_sources: not exactly the sources the founding list names'::text;
     END IF;
     -- links: exactly those the kept sources name, unchanged but for the re-point.
     SELECT ${digest('to_jsonb(l)::text')} INTO v_h FROM links l;
     IF v_h IS DISTINCT FROM v_link_h THEN
       v_bad := v_bad || 'links: not exactly the links the kept sources name, as they were but for the re-point'::text;
     END IF;
     -- platform_reset_gate: as at the snapshot (G10).
     IF (SELECT to_jsonb(x) FROM platform_reset_gate x WHERE x.id = 1) IS DISTINCT FROM v_gate THEN
       v_bad := v_bad || 'platform_reset_gate: changed before its own step'::text;
     END IF;
     -- The guards: as many triggers enabled, none in another state; as many foreign keys.
     SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O';
     IF v_n <> v_triggers THEN
       v_bad := v_bad || format('%s enabled triggers, expected %s', v_n, v_triggers);
     END IF;
     SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O';
     IF v_n <> 0 THEN
       v_bad := v_bad || format('%s triggers not in their normal state', v_n);
     END IF;
     SELECT count(*) INTO v_n FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f';
     IF v_n <> v_fks THEN
       v_bad := v_bad || format('%s foreign keys, expected %s', v_n, v_fks);
     END IF;
     -- The sequences: those of the wiped tables restarted (the next id is 1), every other one untouched.
     FOR r IN SELECT s.sequencename::text AS seq, s.last_value FROM pg_sequences s WHERE s.schemaname = 'public' ORDER BY 1 LOOP
       IF (SELECT p.kind FROM platform_reset_plan p WHERE p.tbl = v_seq -> r.seq ->> 'tbl') = 'WIPE' THEN
         IF r.last_value IS NOT NULL THEN
           v_bad := v_bad || format('sequence %s not restarted (last value %s)', r.seq, r.last_value);
         END IF;
         v_restarted := v_restarted || to_jsonb(r.seq);
       ELSIF r.last_value IS DISTINCT FROM (v_seq -> r.seq ->> 'last')::bigint OR NOT (v_seq ? r.seq) THEN
         v_bad := v_bad || format('sequence %s of a kept table changed', r.seq);
       END IF;
     END LOOP;
     -- No foreign key points at a missing row (the 9 Oct scan; MATCH SIMPLE: a row with a NULL key column is exempt).
     FOR r IN
       SELECT c.conname, c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
              (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY AS k (attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS ccols,
              (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY AS k (attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS pcols,
              (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ') FROM unnest(c.conkey) AS k (attnum)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS notnull
         FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
     LOOP
       EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE (%s) = (%s))',
                      r.child, r.notnull, r.parent, r.pcols, r.ccols) INTO v_n;
       IF v_n > 0 THEN
         v_bad := v_bad || format('%s rows of %s point at a missing %s (%s)', v_n, r.child, r.parent, r.conname);
       END IF;
     END LOOP;
     IF current_setting('session_replication_role') <> 'origin' THEN
       v_bad := v_bad || format('session_replication_role is %s', current_setting('session_replication_role'));
     END IF;
     IF pg_catalog.current_setting('orbes.guard_bypass', true) IS DISTINCT FROM 'reset' THEN
       v_bad := v_bad || 'the guards'' way through is not the reset''s'::text;
     END IF;
     -- LAST: never inside a window, read on the clock now, not at the transaction's start.
     v_kind := orbes_maintenance_window(clock_timestamp());
     IF v_kind IS NOT NULL THEN
       v_bad := v_bad || format('inside a forbidden window now (%s)', v_kind);
     END IF;
     IF cardinality(v_bad) > 0 THEN
       RAISE EXCEPTION USING ERRCODE = 'OR020', MESSAGE = 'RESET_PROOF_FAILED',
         DETAIL = format('%s check(s) failed, nothing is kept: %s', cardinality(v_bad), array_to_string(v_bad, ' | '));
     END IF;

     -- 10. The gate: only the reset's own four columns change, checked column by column against the snapshot (G10).
     v_details := jsonb_build_object('oldHead', v_head, 'totp', v_totp, 'requestId', v_request, 'stepUpId', v_step,
                                     'recent24h', v_recent, 'capture', v_capture);
     UPDATE platform_reset_gate
        SET last_reset_at = now(), last_reset_by = p_admin, resets = resets + 1, last_reset_details = v_details
      WHERE id = 1
      RETURNING * INTO g2;
     IF (to_jsonb(g2) - ARRAY[${GATE_CHANGED.map((c) => `'${c}'`).join(', ')}]) IS DISTINCT FROM (v_gate - ARRAY[${GATE_CHANGED.map((c) => `'${c}'`).join(', ')}])
        OR g2.holder_admin_id IS DISTINCT FROM (v_gate ->> 'holder_admin_id')::uuid
        OR g2.launched_at IS DISTINCT FROM (v_gate ->> 'launched_at')::timestamptz
        OR g2.launched_by IS DISTINCT FROM (v_gate ->> 'launched_by')::uuid
        OR g2.authorized_by IS NOT NULL OR g2.authorized_at IS NOT NULL OR g2.authorized_purpose IS NOT NULL
        OR g2.resets IS DISTINCT FROM (v_gate ->> 'resets')::int + 1
        OR g2.last_reset_at IS DISTINCT FROM now() OR g2.last_reset_by IS DISTINCT FROM p_admin
        OR g2.last_reset_details IS DISTINCT FROM v_details THEN
       RAISE EXCEPTION USING ERRCODE = 'OR020', MESSAGE = 'RESET_PROOF_FAILED',
         DETAIL = '1 check(s) failed, nothing is kept: platform_reset_gate: a column other than the reset''s own four changed';
     END IF;

     RETURN jsonb_build_object(
       'wiped', v_wiped, 'kept', v_kept, 'partly', v_partly, 'sequencesRestarted', v_restarted, 'at', ${iso('now()')},
       'collectors', v_collectors, 'oldHead', v_head, 'totp', v_totp, 'requestId', v_request, 'stepUpId', v_step,
       'recent24h', v_recent, 'capture', v_capture);
   END $$`,

  // The numbering locks' helper runs only inside the reset; the app keeps the precheck, the authorization, the reset and
  // LOCK RESET (each a definer function that checks its caller's rights itself).
  `REVOKE EXECUTE ON FUNCTION orbes_platform_reset_numbering_locks(int) FROM PUBLIC`,
];

export const DOWN: readonly string[] = [
  // Once a reset was done, or LOCK RESET pressed, the gate is the platform's record of them: never dropped.
  `DO $$
   DECLARE r record;
   BEGIN
     SELECT resets, launched_at INTO r FROM platform_reset_gate WHERE id = 1;
     IF FOUND AND (r.resets > 0 OR r.launched_at IS NOT NULL) THEN
       RAISE EXCEPTION 'migration 0067_platform_reset cannot be rolled back: % platform resets done and LOCK RESET %', r.resets,
         CASE WHEN r.launched_at IS NULL THEN 'not pressed' ELSE 'pressed' END;
     END IF;
   END $$`,
  REJECT_0066,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_lock(uuid)`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset(uuid, int, timestamptz)`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_unauthorize()`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_authorize(uuid, text)`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_precheck(uuid, int, timestamptz)`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_numbering_locks(int)`,
  `DROP TABLE IF EXISTS platform_reset_gate`,
  `DROP FUNCTION IF EXISTS orbes_platform_reset_gate_guard()`,
  `DROP TABLE IF EXISTS platform_reset_plan`,
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of UP) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const statement of DOWN) await sql.raw(statement).execute(db);
}
