-- ORBES GENOME CODE: post-check of reset-to-catalogue.sql. READ ONLY: the whole file runs in a READ ONLY transaction
-- that ends in ROLLBACK, so it can change nothing. Run it right after the reset, BEFORE starting the app (once the
-- app runs, your sign-in adds a session and audit entries, and "wiped tables empty" no longer holds).
--
--   psql -X -v ON_ERROR_STOP=1 ... < postcheck.sql
--
-- Ends with "postcheck: ALL OK", or with an ERROR naming every check that failed.

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
BEGIN TRANSACTION READ ONLY;

\echo '== kept tables (these numbers must equal the rows_after column the reset printed)'
SELECT 'categories' AS kept_table, count(*) AS rows FROM categories UNION ALL
SELECT 'collections', count(*) FROM collections UNION ALL
SELECT 'models', count(*) FROM models UNION ALL
SELECT 'model_images', count(*) FROM model_images UNION ALL
SELECT 'model_pairs', count(*) FROM model_pairs UNION ALL
SELECT 'skus', count(*) FROM skus UNION ALL
SELECT 'suppliers', count(*) FROM suppliers UNION ALL
SELECT 'stock_locations', count(*) FROM stock_locations UNION ALL
SELECT 'carriers', count(*) FROM carriers UNION ALL
SELECT 'retailers', count(*) FROM retailers UNION ALL
SELECT 'club_tiers', count(*) FROM club_tiers UNION ALL
SELECT 'club_program_settings', count(*) FROM club_program_settings UNION ALL
SELECT 'shipping_rates', count(*) FROM shipping_rates UNION ALL
SELECT 'guarantee_settings', count(*) FROM guarantee_settings UNION ALL
SELECT 'order_alert_settings', count(*) FROM order_alert_settings UNION ALL
SELECT 'sku_thresholds', count(*) FROM sku_thresholds UNION ALL
SELECT 'engraving_prices', count(*) FROM engraving_prices UNION ALL
SELECT 'admin_users', count(*) FROM admin_users UNION ALL
SELECT 'admin_user_locations', count(*) FROM admin_user_locations UNION ALL
SELECT 'cryptographic_keys', count(*) FROM cryptographic_keys UNION ALL
SELECT 'kysely_migration', count(*) FROM kysely_migration UNION ALL
SELECT 'kysely_migration_lock', count(*) FROM kysely_migration_lock UNION ALL
SELECT 'media_objects (partly kept)', count(*) FROM media_objects UNION ALL
SELECT 'revocations (partly kept)', count(*) FROM revocations UNION ALL
SELECT 'segments (partly kept)', count(*) FROM segments;

\echo ''
\echo '== signing keys (exactly one ACTIVE)'
SELECT key_id, kid, status,
       to_char(activated_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS activated_paris,
       to_char(revoked_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD HH24:MI') AS revoked_paris
  FROM cryptographic_keys ORDER BY key_id;

\echo ''
\echo '== the next numbers (computed as the app does: max + 1)'
SELECT format('O%s-%s-%s', to_char(y.year % 100, 'FM00'), k.code,
              lpad(((SELECT coalesce(max(p.serial), 0) FROM products p WHERE p.year = y.year AND p.category_id = k.id) + 1)::text, 5, '0'))
         AS next_piece_reference
  FROM categories k CROSS JOIN (SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS year) y
 WHERE k.active ORDER BY k.code;
SELECT format('%s-%s-%s', CASE kind.k WHEN 'INVOICE' THEN 'INV' ELSE 'CN' END, y.year,
              lpad(((SELECT coalesce(max(i.sequence), 0) FROM invoices i WHERE i.kind = kind.k AND i.year = y.year) + 1)::text, 6, '0'))
         AS next_document_number
  FROM (VALUES ('INVOICE'), ('CREDIT_NOTE')) AS kind(k) CROSS JOIN (SELECT extract(year FROM now() AT TIME ZONE 'UTC')::int AS year) y;

DO $postcheck$
DECLARE
  keep text[] := ARRAY[
    'categories','collections','models','model_images','model_pairs','skus','suppliers','stock_locations','carriers',
    'retailers','club_tiers','club_program_settings','shipping_rates','guarantee_settings','order_alert_settings',
    'sku_thresholds','engraving_prices','admin_users','admin_user_locations','cryptographic_keys','kysely_migration',
    'kysely_migration_lock','media_objects','revocations','segments'];
  r record;
  n bigint;
  last_applied text;
  bad text[] := '{}';
  ok text[] := '{}';
BEGIN
  -- 1. The schema is the one the reset was made for, untouched.
  SELECT count(*), max(name) INTO n, last_applied FROM kysely_migration;
  IF n <> 40 OR last_applied <> '0039_order_delivery' THEN
    bad := bad || format('migrations: %s, last %s (expected 40, last 0039_order_delivery)', n, last_applied);
  ELSE ok := ok || 'migrations 0001 to 0039'::text; END IF;
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'public';
  IF n <> 92 THEN bad := bad || format('%s tables, expected 92', n); ELSE ok := ok || '92 tables'::text; END IF;

  -- 2. The catalogue, the settings and the console logins are there.
  IF NOT EXISTS (SELECT 1 FROM categories) THEN bad := bad || 'no category'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM models) THEN bad := bad || 'no model'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM skus) THEN bad := bad || 'no SKU'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM stock_locations) THEN bad := bad || 'no stock location'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_users) THEN bad := bad || 'no console login'::text; END IF;
  SELECT count(*) INTO n FROM cryptographic_keys WHERE status = 'ACTIVE';
  IF n <> 1 THEN bad := bad || format('%s ACTIVE signing keys, expected 1', n); ELSE ok := ok || 'one ACTIVE key'::text; END IF;

  -- 3. Every other table is empty.
  FOR r IN SELECT tablename::text AS tbl FROM pg_tables WHERE schemaname = 'public' AND tablename::text <> ALL (keep) ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tbl) INTO n;
    IF n <> 0 THEN bad := bad || format('%s has %s rows', r.tbl, n); END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'public' AND tablename::text <> ALL (keep);
  ok := ok || format('%s wiped tables checked', n);

  -- 4. The partly kept tables hold only what is meant to stay.
  SELECT count(*) INTO n FROM media_objects m
   WHERE NOT EXISTS (SELECT 1 FROM models x WHERE x.image_sha256 = m.sha256)
     AND NOT EXISTS (SELECT 1 FROM model_images x WHERE x.sha256 = m.sha256);
  IF n > 0 THEN bad := bad || format('%s photographs used by no model', n); END IF;
  SELECT count(*) INTO n FROM revocations WHERE target_type <> 'KEY';
  IF n > 0 THEN bad := bad || format('%s revocations of codes or pieces', n); END IF;
  SELECT count(*) INTO n FROM segments WHERE jsonb_path_exists(criteria, 'lax $.**.dropId ? (@.type() == "string")');
  IF n > 0 THEN bad := bad || format('%s segments name a release', n); END IF;

  -- 5. The protective triggers are all back: 81, enabled (tgenabled = O).
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF n <> 81 THEN bad := bad || format('%s enabled protective triggers, expected 81', n); ELSE ok := ok || '81 triggers enabled'::text; END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND t.tgenabled <> 'O';
  IF n <> 0 THEN bad := bad || format('%s triggers (internal included) not in their normal state', n); END IF;
  IF current_setting('session_replication_role') <> 'origin' THEN
    bad := bad || format('session_replication_role is %s', current_setting('session_replication_role'));
  END IF;

  -- 6. No foreign key points at a missing row.
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
  ok := ok || 'no orphan row'::text;

  -- 7. The id counters start again at 1, the audit chain from its genesis, piece and invoice numbers at 1.
  FOR r IN SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL LOOP
    bad := bad || format('sequence %s already at %s', r.sequencename, r.last_value);
  END LOOP;
  IF EXISTS (SELECT 1 FROM audit_logs) AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = 1 AND prev_hash = '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea) THEN
    bad := bad || 'the audit chain does not start at id 1 from the genesis hash'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM products) THEN bad := bad || 'products exist: serials do not restart at 1'::text; END IF;
  IF EXISTS (SELECT 1 FROM invoices) THEN bad := bad || 'invoices exist: numbers do not restart at 1'::text; END IF;

  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'postcheck FAILED (% problem(s)): %', cardinality(bad), array_to_string(bad, ' | ');
  END IF;
  RAISE NOTICE 'postcheck: %', array_to_string(ok, ', ');
  RAISE NOTICE 'postcheck: ALL OK';
END
$postcheck$;

ROLLBACK;
