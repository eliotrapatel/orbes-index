-- ORBES GENOME CODE: reset to the catalogue (one time, before launch). Schema 0001 to 0039 (commit e7f72e1).
--
-- KEEPS    the catalogue: categories, collections, models and variants, model_images (lookbook), model_pairs,
--          skus (sizes, SKUs, their suppliers);
--          the settings: suppliers, stock_locations (addresses), carriers, retailers (points of sale), club_tiers,
--          club_program_settings (THE PROGRAM, the private salon), shipping_rates, guarantee_settings,
--          order_alert_settings, sku_thresholds, engraving_prices, segments;
--          the console logins: admin_users (passwords and TOTP untouched), admin_user_locations;
--          the signing keys: cryptographic_keys (untouched), and the migration bookkeeping (kysely_migration*).
-- PARTLY   media_objects: only the photographs a kept model or lookbook uses stay;
--          revocations:   only the revocations of keys (target_type = 'KEY') stay;
--          segments:      a segment whose rules name a release (dropId) goes with the releases; the others stay.
-- WIPES    every row of the 67 other tables: pieces, identities, codes, cards, claim codes, stock, orders, invoices,
--          credit notes, gifts, credits, returns, parcels, order cases, releases (draws, LIVE, after-rooms), supplier
--          orders, receptions, every collector account (test entrants included) and their data, messages, circle,
--          care, house guarantees, scans and statistics, analytics, the audit log, the event journal, sessions.
-- NUMBERS  RESTART IDENTITY resets the 4 id counters (audit_logs, event_journal, order_events, stock_movements).
--          Piece serials and invoice numbers are max + 1 over products / invoices: they restart at 1 by themselves.
--
-- HOW      As POSTGRES_USER (the superuser, the schema owner), with the app container STOPPED, through psql:
--            dry run:  psql -X -v ON_ERROR_STOP=1 -v commit=false ... < reset-to-catalogue.sql   (ends in ROLLBACK)
--            for real: psql -X -v ON_ERROR_STOP=1 -v commit=true  ... < reset-to-catalogue.sql   (ends in COMMIT)
--          Without -v commit, it stops before BEGIN. Any value other than true / false is refused.
--
-- SAFETY   One transaction: any error (a guard below, a lock not obtained in 5 s, a check at the end) rolls
--          everything back, and psql stops at the first error (ON_ERROR_STOP).
--          The append-only guards are passed with SET LOCAL session_replication_role = replica, for the TRUNCATE
--          only: no trigger definition is changed (pg_trigger untouched) and the setting dies with the transaction.
--          The TRUNCATE has NO CASCADE: if any kept table referenced a wiped one, PostgreSQL would refuse the whole
--          statement instead of emptying the kept table. TRUNCATE checks foreign keys even in replica mode.
--          The partial deletes run after the role is back to origin: every trigger and foreign key is on for them.
--          Before COMMIT, it proves: each kept table identical row by row (count + md5 of its rows), each wiped
--          table empty, the 81 triggers enabled, the 4 counters restarted, no foreign key pointing at a missing row.
-- LISTS    Before the wipe, read only: the test references per year and category, the segments that go, the keys,
--          and what stays that a test may have made (each SKU and how it came to be, the console logins, the
--          suppliers, points of sale, carriers and stock locations), for the owner to tidy in the console afterwards.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\if :{?commit}
\else
\echo 'reset-to-catalogue: nothing done. Add -v commit=false (dry run, changes nothing) or -v commit=true.'
\quit
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SELECT set_config('orbes_reset.commit', :'commit', true) AS commit_requested;

-- ── 0. The plan: every table of the schema, and what happens to it ────────────────────────────────────────────
CREATE TEMP TABLE reset_plan (tbl text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('KEEP', 'PARTLY', 'WIPE'))) ON COMMIT DROP;
INSERT INTO reset_plan (tbl, kind) VALUES
  -- KEEP (22): untouched, proven identical row by row before COMMIT
  ('categories', 'KEEP'), ('collections', 'KEEP'), ('models', 'KEEP'), ('model_images', 'KEEP'), ('model_pairs', 'KEEP'),
  ('skus', 'KEEP'), ('suppliers', 'KEEP'), ('stock_locations', 'KEEP'), ('carriers', 'KEEP'), ('retailers', 'KEEP'),
  ('club_tiers', 'KEEP'), ('club_program_settings', 'KEEP'), ('shipping_rates', 'KEEP'), ('guarantee_settings', 'KEEP'),
  ('order_alert_settings', 'KEEP'), ('sku_thresholds', 'KEEP'), ('engraving_prices', 'KEEP'), ('admin_users', 'KEEP'),
  ('admin_user_locations', 'KEEP'), ('cryptographic_keys', 'KEEP'), ('kysely_migration', 'KEEP'),
  ('kysely_migration_lock', 'KEEP'),
  -- PARTLY (3): kept, minus the rows that only make sense with the wiped data
  ('media_objects', 'PARTLY'), ('revocations', 'PARTLY'), ('segments', 'PARTLY'),
  -- WIPE (67): emptied by one TRUNCATE
  ('account_addresses', 'WIPE'), ('account_recovery_codes', 'WIPE'), ('account_sizes', 'WIPE'), ('accounts', 'WIPE'),
  ('activity_hourly', 'WIPE'), ('after_room_guests', 'WIPE'), ('anomalies', 'WIPE'), ('audit_logs', 'WIPE'),
  ('authentication_events', 'WIPE'), ('bench_items', 'WIPE'), ('card_prints', 'WIPE'), ('care_requests', 'WIPE'),
  ('circle_daily_visits', 'WIPE'), ('circle_poll_votes', 'WIPE'), ('circle_post_images', 'WIPE'), ('circle_posts', 'WIPE'),
  ('circle_rsvps', 'WIPE'), ('claim_code_renewals', 'WIPE'), ('client_conversations', 'WIPE'), ('client_messages', 'WIPE'),
  ('codes', 'WIPE'), ('credit_uses', 'WIPE'), ('drop_entries', 'WIPE'), ('drop_sizes', 'WIPE'), ('drops', 'WIPE'),
  ('event_journal', 'WIPE'), ('genomes', 'WIPE'), ('house_guarantees', 'WIPE'), ('invoices', 'WIPE'),
  ('live_access_models', 'WIPE'), ('live_addons', 'WIPE'), ('live_entries', 'WIPE'), ('live_entry_addons', 'WIPE'),
  ('live_interest', 'WIPE'), ('live_messages', 'WIPE'), ('live_tier_windows', 'WIPE'), ('order_cases', 'WIPE'),
  ('order_events', 'WIPE'), ('orders', 'WIPE'), ('ownership', 'WIPE'), ('ownership_certificates', 'WIPE'),
  ('ownership_transfers', 'WIPE'), ('product_status_history', 'WIPE'), ('products', 'WIPE'), ('reception_lines', 'WIPE'),
  ('receptions', 'WIPE'), ('release_answers', 'WIPE'), ('returns', 'WIPE'), ('scan_daily_stats', 'WIPE'),
  ('scan_events', 'WIPE'), ('scan_reports', 'WIPE'), ('scan_tokens', 'WIPE'), ('service_records', 'WIPE'),
  ('sessions', 'WIPE'), ('shipment_items', 'WIPE'), ('shipments', 'WIPE'), ('shop_requests', 'WIPE'),
  ('stock_corrections', 'WIPE'), ('stock_movements', 'WIPE'), ('supplier_order_lines', 'WIPE'),
  ('supplier_orders', 'WIPE'), ('supplier_returns', 'WIPE'), ('test_entrants', 'WIPE'), ('test_run_entrants', 'WIPE'),
  ('test_runs', 'WIPE'), ('tier_grants', 'WIPE'), ('warranties', 'WIPE');

-- ── 1. Guards: nothing is written unless every one passes ─────────────────────────────────────────────────────
DO $guard$
DECLARE
  expected_migrations text[] := ARRAY[
    '0001_initial','0002_platform_guards','0003_authentication_events_default','0004_scan_reports',
    '0005_account_recovery','0006_admin_password_change_required','0007_print_batch_indexes','0008_retail_mode',
    '0009_scan_daily_stats','0010_models_active','0011_scan_token_transfer_accept','0012_media',
    '0013_ownership_certificates','0014_model_lookbook','0015_drops','0016_circle','0017_drop_early_access',
    '0018_club_tiers','0019_model_discontinued','0020_private_salon','0021_live_release','0022_orders_stock',
    '0023_releases_collectors','0024_model_variants','0024_z_test_entrants','0025_client_messages',
    '0026_club_program','0027_tier_grants','0028_yearly_care','0029_house_guarantee','0030_account_sizes',
    '0031_model_pairs','0032_growth_indexes','0033_model_sizes','0034_claim_code_renewals',
    '0035_logistics_access','0036_supplier_orders','0037_fulfilment','0038_draw_sizes','0039_order_delivery'];
  commit_value text := current_setting('orbes_reset.commit');
  applied text[];
  last_applied text;
  diff text[];
  n bigint;
  others text;
BEGIN
  IF commit_value NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'reset: -v commit must be true or false, not "%"', commit_value;
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'reset: run as POSTGRES_USER (the superuser), not as %', current_user;
  END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'reset: session_replication_role is already %, expected origin', current_setting('session_replication_role');
  END IF;

  -- The schema this script was written and rehearsed for: migrations 0001 to 0039 exactly, nothing pending, nothing newer.
  SELECT coalesce(array_agg(name ORDER BY name), '{}') INTO applied FROM kysely_migration;
  SELECT name INTO last_applied FROM kysely_migration ORDER BY name DESC LIMIT 1;
  IF last_applied IS DISTINCT FROM '0039_order_delivery' OR applied IS DISTINCT FROM expected_migrations THEN
    RAISE EXCEPTION 'reset: written for migrations 0001_initial to 0039_order_delivery exactly; the database has % migration(s), the last one %',
      cardinality(applied), last_applied;
  END IF;

  -- Exactly the 92 tables of that schema: every one has its line in the plan, and the plan names no missing table.
  SELECT array_agg(x ORDER BY x) INTO diff FROM (
    (SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' EXCEPT SELECT tbl FROM reset_plan)
    UNION ALL
    (SELECT tbl FROM reset_plan EXCEPT SELECT tablename::text FROM pg_tables WHERE schemaname = 'public')) AS d(x);
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'reset: unexpected tables (new or missing): %', diff;
  END IF;
  SELECT count(*) INTO n FROM reset_plan;
  IF n <> 92 THEN RAISE EXCEPTION 'reset: the plan has % tables, expected 92', n; END IF;
  SELECT count(*) INTO n FROM reset_plan WHERE kind = 'WIPE';
  IF n <> 67 THEN RAISE EXCEPTION 'reset: the plan wipes % tables, expected 67', n; END IF;

  -- The same guards and foreign keys as the rehearsal: 81 triggers, all enabled; 240 foreign keys; 4 counters.
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF n <> 81 THEN RAISE EXCEPTION 'reset: % enabled protective triggers, expected 81', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace WHERE s.nspname = 'public' AND c.contype = 'f';
  IF n <> 240 THEN RAISE EXCEPTION 'reset: % foreign keys, expected 240', n; END IF;
  SELECT count(*) INTO n FROM pg_sequences WHERE schemaname = 'public';
  IF n <> 4 THEN RAISE EXCEPTION 'reset: % sequences, expected 4', n; END IF;

  -- Nobody else connected to this database: the app container must be stopped (and no other psql open).
  SELECT string_agg(format('%s (%s, %s)', coalesce(nullif(application_name, ''), 'no name'), usename, coalesce(state, '?')), '; ')
    INTO others
    FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
  IF others IS NOT NULL THEN
    RAISE EXCEPTION 'reset: other connection(s) to this database: %. Stop the app container (docker compose stop app) and any other psql, then run again.', others;
  END IF;
  RAISE NOTICE 'reset: guards passed (superuser %, migrations 0001 to 0039, 92 tables, 81 triggers, 240 foreign keys, no other connection)', current_user;
END
$guard$;

\echo ''
\echo '== where: database, role, time (Paris)'
SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS postgres,
       to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI:SS') AS paris_time,
       to_char(now() AT TIME ZONE 'UTC', 'HH24:MI:SS') AS utc_time;

-- ── 2. Snapshot: the rows of every table now, and a fingerprint of every kept one ────────────────────────────
CREATE TEMP TABLE reset_counts (
  tbl text PRIMARY KEY, kind text NOT NULL,
  rows_before bigint, digest_before text, rows_after bigint, digest_after text
) ON COMMIT DROP;
DO $snapshot$
DECLARE
  r record;
  n bigint;
  h text;
BEGIN
  FOR r IN SELECT tbl, kind FROM reset_plan ORDER BY tbl LOOP
    IF r.kind = 'KEEP' THEN
      EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, %L ORDER BY x::text), %L)) FROM public.%I x', E'\n', '', r.tbl) INTO n, h;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO n;
      h := NULL;
    END IF;
    INSERT INTO reset_counts (tbl, kind, rows_before, digest_before) VALUES (r.tbl, r.kind, n, h);
  END LOOP;
END
$snapshot$;

\echo ''
\echo '== references the tests used (each restarts at 00001 after the reset: destroy every printed test card and tag)'
SELECT p.year, k.code AS category, count(*) AS pieces, min(p.product_id) AS first_reference, max(p.product_id) AS last_reference
  FROM products p JOIN categories k ON k.id = p.category_id
 GROUP BY p.year, k.code ORDER BY 1, 2;

\echo ''
\echo '== segments whose rules name a release (they go with the releases; every other segment stays)'
SELECT name AS segment_removed FROM segments
 WHERE jsonb_path_exists(criteria, 'lax $.**.dropId ? (@.type() == "string")') ORDER BY lower(name);

\echo ''
\echo '== signing keys (unchanged by this script)'
SELECT key_id, kid, status FROM cryptographic_keys ORDER BY key_id;

-- Read only: what stays that a test may have made. Nothing marks it once the audit log is gone, so it is listed here,
-- while the audit log and the pieces, orders and releases that used it still exist. Nothing is changed or deleted.
\echo ''
\echo '== sizes (SKUs) that stay, and how each came to be (review = check: offered, made by a flow on a model with no size type)'
\echo '   declared = ticked in the Catalogue; with the model = made when the model or variant was created;'
\echo '   before the type = made by a flow before you gave the model its size type, kept among its sizes;'
\echo '   by a flow = made by a release, an order, a piece, a reception or a gift on a model with no size type.'
\echo '   After the reset, take off in the Catalogue every "check" size you do not want.'
SELECT m.name || coalesce(' / ' || m.variant_label, '') AS model,
       coalesce(k.size_label, 'ONE SIZE') AS size,
       k.code,
       coalesce(m.size_type, 'to give') AS size_type,
       CASE WHEN k.set_aside_at IS NULL THEN 'offered' ELSE 'set aside' END AS status,
       to_char(k.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS created_paris,
       (SELECT count(*) FROM products x WHERE x.sku_id = k.id) AS pieces,
       (SELECT count(*) FROM orders x WHERE x.sku_id = k.id) AS orders,
       (SELECT count(*) FROM drop_sizes x WHERE x.sku_id = k.id) AS release_sizes,
       (SELECT count(*) FROM stock_movements x WHERE x.sku_id = k.id) AS stock_moves,
       o.how AS how_made,
       CASE WHEN o.how = 'by a flow' AND k.set_aside_at IS NULL THEN 'check' ELSE '' END AS review
  FROM skus k
  JOIN models m ON m.id = k.model_id
  CROSS JOIN LATERAL (SELECT CASE
    WHEN EXISTS (SELECT 1 FROM audit_logs a
                  WHERE a.action = 'model.sizes.declare' AND a.target_id = k.model_id::text
                    AND (jsonb_path_exists(a.details, '$.added[*] ? (@ == $c)', jsonb_build_object('c', k.code))
                      OR jsonb_path_exists(a.details, '$.reinstated[*] ? (@ == $c)', jsonb_build_object('c', k.code))))
      THEN 'declared'
    WHEN EXISTS (SELECT 1 FROM audit_logs a
                  WHERE a.target_id = k.model_id::text
                    AND ((a.action = 'model.create' AND k.size_label IS NULL AND a.details ? 'sizeType')
                      OR (a.action = 'model.variant.create'
                          AND jsonb_path_exists(a.details, '$.sizes[*] ? (@ == $s)', jsonb_build_object('s', coalesce(k.size_label, 'ONE SIZE'))))))
      THEN 'with the model'
    WHEN m.size_type IS NOT NULL THEN 'before the type'
    ELSE 'by a flow' END AS how) o
 ORDER BY lower(m.name), lower(coalesce(m.variant_label, '')), k.created_at, k.code;

\echo ''
\echo '== console logins that stay (passwords and TOTP unchanged; after the reset, disable in Team any login made for a test)'
SELECT a.email, a.role,
       CASE WHEN a.totp_secret_enc IS NULL THEN 'no' ELSE 'yes' END AS totp_set,
       CASE WHEN a.disabled_at IS NULL THEN 'active' ELSE 'disabled' END AS status,
       a.failed_logins,
       to_char(a.locked_until AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS locked_until_paris,
       (SELECT string_agg(l.name, ', ' ORDER BY l.name) FROM admin_user_locations x JOIN stock_locations l ON l.id = x.stock_location_id
         WHERE x.admin_user_id = a.id) AS logistics_locations,
       to_char(a.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS created_paris
  FROM admin_users a
 ORDER BY a.created_at, a.email;

\echo ''
\echo '== suppliers, points of sale, carriers and stock locations that stay (they are never deleted: after the reset,'
\echo '   set inactive or aside any made for a test)'
SELECT kind, name, detail, status, created_paris FROM (
  SELECT 'supplier' AS kind, s.name, NULL::text AS detail, CASE WHEN s.active THEN 'active' ELSE 'inactive' END AS status,
         to_char(s.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS created_paris
    FROM suppliers s
  UNION ALL
  SELECT 'point of sale', r.name, concat_ws(', ', r.city, r.country), CASE WHEN r.active THEN 'active' ELSE 'inactive' END,
         to_char(r.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
    FROM retailers r
  UNION ALL
  SELECT 'carrier', c.name, NULL, CASE WHEN c.active THEN 'offered' ELSE 'set aside' END,
         to_char(c.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
    FROM carriers c
  UNION ALL
  SELECT 'stock location', l.name,
         concat_ws(', ', CASE WHEN l.is_default THEN 'default' END, CASE WHEN l.address IS NULL THEN 'no address' ELSE 'address set' END),
         'stays', to_char(l.created_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
    FROM stock_locations l
) AS settings_kept
 ORDER BY kind, lower(name);

-- ── 3. The wipe: the 67 tables in ONE TRUNCATE, no CASCADE, the guards passed for this transaction only ──────
SET LOCAL session_replication_role = replica;
DO $wipe$
DECLARE
  stmt text;
BEGIN
  SELECT 'TRUNCATE TABLE ' || string_agg(format('public.%I', tbl), ', ' ORDER BY tbl) || ' RESTART IDENTITY'
    INTO stmt FROM reset_plan WHERE kind = 'WIPE';
  IF stmt ~* 'cascade' THEN RAISE EXCEPTION 'reset: refusing a TRUNCATE with CASCADE'; END IF;
  EXECUTE stmt;
  RAISE NOTICE 'reset: 67 tables truncated (RESTART IDENTITY, no CASCADE)';
END
$wipe$;
SET LOCAL session_replication_role = origin;

-- ── 4. The partly kept tables, with every trigger and foreign key back on ─────────────────────────────────────
-- Revocations of test codes and pieces go with them (text ids, no foreign key); those of keys stay with the keys.
DELETE FROM revocations WHERE target_type <> 'KEY';
-- A segment that names a release (TOOK_PART, SECURED_IN, ANSWER, INTEREST in a release) named a release that no
-- longer exists: it would match nobody and could not be saved again (DROP_NOT_FOUND). Segments by tier, model,
-- collection, size, country, activity or participation count stay.
DELETE FROM segments WHERE jsonb_path_exists(criteria, 'lax $.**.dropId ? (@.type() == "string")');
-- Photographs: keep exactly those a kept model (cover) or lookbook gallery uses; piece photos, circle post images
-- and release silhouettes go (MediaService.deleteIfUnused's rule; their other users are now empty).
DELETE FROM media_objects m
 WHERE NOT EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 = m.sha256)
   AND NOT EXISTS (SELECT 1 FROM model_images x WHERE x.sha256 = m.sha256);

-- ── 5. Proof before the end: any failure here rolls everything back ───────────────────────────────────────────
DO $check$
DECLARE
  r record;
  n bigint;
  h text;
  bad text[] := '{}';
BEGIN
  IF current_setting('session_replication_role') <> 'origin' THEN
    bad := bad || format('session_replication_role is %s', current_setting('session_replication_role'));
  END IF;

  FOR r IN SELECT tbl, kind FROM reset_counts ORDER BY tbl LOOP
    IF r.kind = 'KEEP' THEN
      EXECUTE format('SELECT count(*), md5(coalesce(string_agg(x::text, %L ORDER BY x::text), %L)) FROM public.%I x', E'\n', '', r.tbl) INTO n, h;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO n;
      h := NULL;
    END IF;
    UPDATE reset_counts SET rows_after = n, digest_after = h WHERE tbl = r.tbl;
  END LOOP;

  -- Kept tables: same rows, same content.
  FOR r IN SELECT tbl, rows_before, rows_after FROM reset_counts
            WHERE kind = 'KEEP' AND (rows_after IS DISTINCT FROM rows_before OR digest_after IS DISTINCT FROM digest_before) LOOP
    bad := bad || format('kept table %s changed (%s rows before, %s after)', r.tbl, r.rows_before, r.rows_after);
  END LOOP;
  -- Wiped tables: empty.
  FOR r IN SELECT tbl, rows_after FROM reset_counts WHERE kind = 'WIPE' AND rows_after <> 0 LOOP
    bad := bad || format('wiped table %s still has %s rows', r.tbl, r.rows_after);
  END LOOP;
  -- Partly kept tables: never more rows than before, and only what is meant to stay.
  FOR r IN SELECT tbl FROM reset_counts WHERE kind = 'PARTLY' AND rows_after > rows_before LOOP
    bad := bad || format('table %s grew', r.tbl);
  END LOOP;
  SELECT count(*) INTO n FROM media_objects m
   WHERE NOT EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 = m.sha256)
     AND NOT EXISTS (SELECT 1 FROM model_images x WHERE x.sha256 = m.sha256);
  IF n > 0 THEN bad := bad || format('%s photographs used by no kept model', n); END IF;
  SELECT count(*) INTO n FROM models x WHERE x.image_sha256 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM media_objects m WHERE m.sha256 = x.image_sha256);
  IF n > 0 THEN bad := bad || format('%s model covers without their photograph', n); END IF;
  SELECT count(*) INTO n FROM model_images x WHERE NOT EXISTS (SELECT 1 FROM media_objects m WHERE m.sha256 = x.sha256);
  IF n > 0 THEN bad := bad || format('%s lookbook images without their photograph', n); END IF;
  SELECT count(*) INTO n FROM revocations WHERE target_type <> 'KEY';
  IF n > 0 THEN bad := bad || format('%s revocations of codes or pieces left', n); END IF;
  SELECT count(*) INTO n FROM segments WHERE jsonb_path_exists(criteria, 'lax $.**.dropId ? (@.type() == "string")');
  IF n > 0 THEN bad := bad || format('%s segments still name a release', n); END IF;

  -- The guards: the 81 triggers defined and enabled as before.
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF n <> 81 THEN bad := bad || format('%s enabled protective triggers, expected 81', n); END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O';
  IF n <> 0 THEN bad := bad || format('%s triggers not in their normal state', n); END IF;

  -- The 4 id counters restarted (the next id is 1).
  FOR r IN SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL LOOP
    bad := bad || format('sequence %s not restarted (last value %s)', r.sequencename, r.last_value);
  END LOOP;

  -- No foreign key, of the 240, points at a missing row (MATCH SIMPLE: a row with a NULL key column is exempt).
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
           (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS ccols,
           (SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS pcols,
           (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ') FROM unnest(c.conkey) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS notnull
      FROM pg_constraint c JOIN pg_namespace s ON s.oid = c.connamespace
     WHERE s.nspname = 'public' AND c.contype = 'f'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE (%s) = (%s))',
                   r.child, r.notnull, r.parent, r.pcols, r.ccols) INTO n;
    IF n > 0 THEN bad := bad || format('%s rows of %s point at a missing %s (%s)', n, r.child, r.parent, r.conname); END IF;
  END LOOP;

  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'reset: % check(s) failed, nothing is kept: %', cardinality(bad), array_to_string(bad, ' | ');
  END IF;
  RAISE NOTICE 'reset: every check passed (22 kept tables identical, 67 wiped tables empty, 81 triggers enabled, 4 counters at 1, no orphan)';
END
$check$;

\echo ''
\echo '== kept tables: rows before and after (identical = same rows, same content)'
SELECT tbl AS kept_table, kind, rows_before, rows_after,
       CASE WHEN kind = 'KEEP' THEN CASE WHEN digest_after = digest_before THEN 'yes' ELSE 'NO' END ELSE 'partly kept' END AS identical
  FROM reset_counts WHERE kind IN ('KEEP', 'PARTLY') ORDER BY kind DESC, tbl;

\echo ''
\echo '== wiped tables that had rows (all 67 are now empty)'
SELECT tbl AS wiped_table, rows_before, rows_after FROM reset_counts WHERE kind = 'WIPE' AND rows_before > 0 ORDER BY tbl;
SELECT count(*) AS wiped_tables, sum(rows_before) AS rows_removed, sum(rows_after) AS rows_left FROM reset_counts WHERE kind = 'WIPE';

\if :commit
COMMIT;
\echo ''
\echo 'reset-to-catalogue: COMMITTED. Next: the post-check, then start the app.'
\else
ROLLBACK;
\echo ''
\echo 'reset-to-catalogue: dry run, ROLLED BACK. Nothing was changed.'
\endif
