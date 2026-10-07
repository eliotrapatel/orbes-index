import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, PG_ERROR, pgError } from '../../src/server/db/pg-errors.js';
import { createMigrator, migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';
import * as m0007 from '../../src/server/db/migrations/0007_print_batch_indexes.js';
import * as m0009 from '../../src/server/db/migrations/0009_scan_daily_stats.js';
import * as m0011 from '../../src/server/db/migrations/0011_scan_token_transfer_accept.js';

const EXPECTED_TABLES = [
  'account_recovery_codes', 'accounts', 'activity_hourly', 'admin_users', 'after_room_guests', 'anomalies', 'audit_logs', 'authentication_events',
  'bench_items', 'care_requests', 'carriers', 'categories', 'circle_daily_visits', 'circle_poll_votes', 'circle_post_images', 'circle_posts', 'circle_rsvps',
  'client_conversations', 'client_messages', 'club_program_settings', 'club_tiers', 'codes', 'collections', 'credit_uses', 'cryptographic_keys', 'drop_entries', 'drop_sizes', 'drops',
  'event_journal', 'genomes', 'invoices', 'live_access_models', 'live_addons', 'live_entries', 'live_entry_addons', 'live_interest', 'live_messages',
  'live_tier_windows', 'media_objects', 'model_images', 'models', 'order_alert_settings', 'order_events', 'orders', 'ownership', 'ownership_certificates',
  'ownership_transfers', 'product_status_history', 'products', 'release_answers', 'retailers', 'returns', 'revocations', 'scan_daily_stats', 'scan_events',
  'scan_reports', 'scan_tokens', 'segments', 'service_records', 'sessions', 'shipping_rates', 'shop_requests', 'sku_thresholds', 'skus', 'stock_locations', 'stock_movements',
  'tier_grants', 'warranties',
];

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
  });
  afterAll(() => t.close());

  it('apply to an empty database, then are a no-op', async () => {
    const first = await migrateToLatest(t.db);
    expect(first.applied).toEqual(Object.keys(MIGRATIONS));
    const second = await migrateToLatest(t.db);
    expect(second.applied).toEqual([]);
    const status = await migrationStatus(t.db);
    expect(status.every((m) => m.executedAt instanceof Date)).toBe(true);
  });

  it('create every contract table and the product_overview view', async () => {
    const r = await sql<{ table_name: string; table_type: string }>`
      SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%' ORDER BY table_name`.execute(t.db);
    const tables = r.rows.filter((x) => x.table_type === 'BASE TABLE').map((x) => x.table_name);
    const views = r.rows.filter((x) => x.table_type === 'VIEW').map((x) => x.table_name);
    expect(tables).toEqual(EXPECTED_TABLES);
    expect(views).toEqual(['product_overview']);
  });

  it('seed no business data', async () => {
    for (const table of EXPECTED_TABLES) {
      const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(t.db);
      expect(r.rows[0].n, table).toBe(0);
    }
  });

  it('use ON DELETE RESTRICT for every foreign key, and index every FK column', async () => {
    const fks = await sql<{ table: string; columns: string; delete_rule: string }>`
      SELECT c.conrelid::regclass::text AS table,
             (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
             c.confdeltype AS delete_rule
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`.execute(t.db);
    expect(fks.rows.length).toBeGreaterThanOrEqual(25);
    for (const fk of fks.rows) expect(fk.delete_rule, `${fk.table}.${fk.columns}`).toBe('r');

    const idx = await sql<{ table: string; first_col: string }>`
      SELECT i.indrelid::regclass::text AS table, a.attname AS first_col
      FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indpred IS NULL`.execute(t.db);
    const leading = new Set(idx.rows.map((r) => `${r.table}.${r.first_col}`));
    for (const fk of fks.rows) expect(leading.has(`${fk.table}.${fk.columns.split(',')[0]}`), `${fk.table}.${fk.columns}`).toBe(true);
  });

  it('create the contract indexes', async () => {
    const r = await sql<{ indexdef: string }>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`.execute(t.db);
    const defs = r.rows.map((x) => x.indexdef.replace(/\s+/g, ' '));
    const has = (re: RegExp) => defs.some((d) => re.test(d));
    expect(has(/ON public\.scan_events USING btree \(product_id, occurred_at\)/)).toBe(true);
    expect(has(/ON public\.scan_events USING btree \(code_id, occurred_at\)/)).toBe(true);
    expect(has(/ON public\.anomalies USING btree \(status, severity\)/)).toBe(true);
    expect(has(/ON public\.audit_logs USING btree \(occurred_at\)/)).toBe(true);
    // Partial unique indexes.
    expect(has(/UNIQUE INDEX .* ON public\.cryptographic_keys .*\(status\) WHERE \(status = 'ACTIVE'::text\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.ownership .*\(product_id\) WHERE \(ended_at IS NULL\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.ownership_transfers .*\(product_id\) WHERE \(status = 'PENDING'::text\)/)).toBe(true);
    expect(has(/UNIQUE INDEX .* ON public\.anomalies .*\(product_id, type\) WHERE \(status = ANY/)).toBe(true);
    // 0004: one report per scan, the admin who closed a case, the Cases queue.
    expect(has(/UNIQUE INDEX scan_reports_scan_event_id_key ON public\.scan_reports USING btree \(scan_event_id\)/)).toBe(true);
    expect(has(/INDEX scan_reports_handled_by_idx ON public\.scan_reports USING btree \(handled_by\)/)).toBe(true);
    expect(has(/INDEX scan_reports_status_created_idx ON public\.scan_reports USING btree \(status, created_at\)/)).toBe(true);
    // 0005: one open recovery code per account, and the full indexes that lead with its foreign keys.
    expect(
      has(/UNIQUE INDEX account_recovery_codes_single_open ON public\.account_recovery_codes USING btree \(account_id\) WHERE \(\(used_at IS NULL\) AND \(revoked_at IS NULL\)\)/),
    ).toBe(true);
    expect(has(/INDEX account_recovery_codes_account_idx ON public\.account_recovery_codes USING btree \(account_id, created_at\)/)).toBe(true);
    expect(has(/INDEX account_recovery_codes_created_by_idx ON public\.account_recovery_codes USING btree \(created_by\)/)).toBe(true);
    // 0007: printing by production batch, codes by issue day.
    expect(has(/INDEX products_production_batch_idx ON public\.products USING btree \(production_batch\)$/)).toBe(true);
    expect(has(/INDEX codes_created_at_idx ON public\.codes USING btree \(created_at\)$/)).toBe(true);
    // 0012: the photographs, each foreign key at the head of its own index.
    expect(has(/INDEX models_image_sha256_idx ON public\.models USING btree \(image_sha256\)$/)).toBe(true);
    expect(has(/INDEX products_photo_sha256_idx ON public\.products USING btree \(photo_sha256\)$/)).toBe(true);
    expect(has(/INDEX media_objects_created_by_idx ON public\.media_objects USING btree \(created_by\)$/)).toBe(true);
    // 0013: one certificate per token hash; a piece's certificates, an ownership period's.
    expect(has(/UNIQUE INDEX ownership_certificates_token_hash_key ON public\.ownership_certificates USING btree \(token_hash\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_product_idx ON public\.ownership_certificates USING btree \(product_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX ownership_certificates_ownership_idx ON public\.ownership_certificates USING btree \(ownership_id, created_at\)$/)).toBe(true);
    // 0014: one model per address; a gallery keyed by its model, then by each foreign key at the head of its own index.
    expect(has(/UNIQUE INDEX models_slug_key ON public\.models USING btree \(slug\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_images_pkey ON public\.model_images USING btree \(model_id, sha256\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_images_position_key ON public\.model_images USING btree \(model_id, "?position"?\)$/)).toBe(true);
    expect(has(/INDEX model_images_sha256_idx ON public\.model_images USING btree \(sha256\)$/)).toBe(true);
    expect(has(/INDEX model_images_created_by_idx ON public\.model_images USING btree \(created_by\)$/)).toBe(true);
    // 0015: a drop's model and author, each foreign key at the head of its own index; one entry per account and drop;
    // an account's entries; the entries of a drop by status and rank.
    expect(has(/INDEX drops_model_id_idx ON public\.drops USING btree \(model_id\)$/)).toBe(true);
    expect(has(/INDEX drops_created_by_idx ON public\.drops USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX drops_published_opens_idx ON public\.drops USING btree \(opens_at\) WHERE \(published_at IS NOT NULL\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_entries_drop_account_key ON public\.drop_entries USING btree \(drop_id, account_id\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_account_idx ON public\.drop_entries USING btree \(account_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_handled_by_idx ON public\.drop_entries USING btree \(handled_by\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_drop_status_idx ON public\.drop_entries USING btree \(drop_id, status, rank\)$/)).toBe(true);
    // 0018: one row per tier at most, the console user who wrote it at the head of its own index.
    expect(has(/UNIQUE INDEX club_tiers_pkey ON public\.club_tiers USING btree \(tier\)$/)).toBe(true);
    expect(has(/INDEX club_tiers_updated_by_idx ON public\.club_tiers USING btree \(updated_by\)$/)).toBe(true);
    // 0019: the console user who discontinued a model, at the head of its own index.
    expect(has(/INDEX models_discontinued_by_idx ON public\.models USING btree \(discontinued_by\)$/)).toBe(true);
    // 0020: a request's account, model and closer, each foreign key at the head of its own index; the queue; one open
    // request per account and model.
    expect(has(/INDEX shop_requests_account_idx ON public\.shop_requests USING btree \(account_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX shop_requests_model_idx ON public\.shop_requests USING btree \(model_id\)$/)).toBe(true);
    expect(has(/INDEX shop_requests_handled_by_idx ON public\.shop_requests USING btree \(handled_by\)$/)).toBe(true);
    expect(has(/INDEX shop_requests_queue_idx ON public\.shop_requests USING btree \(status, created_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX shop_requests_one_open ON public\.shop_requests USING btree \(account_id, model_id\) WHERE \(status = 'OPEN'::text\)$/)).toBe(true);
    // 0021: the LIVE RELEASE. A release's silhouette, collection and board link; a size, an entry and an interest of
    // their own drop; the line and its head; the pieces held per size; an account's entries; every console user named.
    expect(has(/INDEX drops_silhouette_sha256_idx ON public\.drops USING btree \(silhouette_sha256\)$/)).toBe(true);
    expect(has(/INDEX drops_access_collection_id_idx ON public\.drops USING btree \(access_collection_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drops_board_token_hash_key ON public\.drops USING btree \(board_token_hash\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_sizes_label_key ON public\.drop_sizes USING btree \(drop_id, label\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_sizes_position_key ON public\.drop_sizes USING btree \(drop_id, "?position"?\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_sizes_drop_size_key ON public\.drop_sizes USING btree \(drop_id, id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_entries_drop_account_key ON public\.live_entries USING btree \(drop_id, account_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_entries_drop_position_key ON public\.live_entries USING btree \(drop_id, "?position"?\)$/)).toBe(true);
    expect(has(/INDEX live_entries_line_idx ON public\.live_entries USING btree \(drop_id, status, "?position"?\)$/)).toBe(true);
    expect(has(/INDEX live_entries_size_status_idx ON public\.live_entries USING btree \(drop_id, size_id, status\)$/)).toBe(true);
    expect(has(/INDEX live_entries_account_idx ON public\.live_entries USING btree \(account_id, joined_at\)$/)).toBe(true);
    for (const by of ['let_in_by', 'removed_by', 'handled_by']) expect(has(new RegExp(`INDEX live_entries_${by}_idx ON public\\.live_entries USING btree \\(${by}\\)$`)), by).toBe(true);
    expect(has(/UNIQUE INDEX live_access_models_pkey ON public\.live_access_models USING btree \(drop_id, model_id\)$/)).toBe(true);
    expect(has(/INDEX live_access_models_model_idx ON public\.live_access_models USING btree \(model_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_addons_position_key ON public\.live_addons USING btree \(drop_id, "?position"?\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_entry_addons_pkey ON public\.live_entry_addons USING btree \(entry_id, addon_id\)$/)).toBe(true);
    expect(has(/INDEX live_entry_addons_addon_idx ON public\.live_entry_addons USING btree \(addon_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_interest_pkey ON public\.live_interest USING btree \(drop_id, account_id\)$/)).toBe(true);
    expect(has(/INDEX live_interest_account_idx ON public\.live_interest USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX live_interest_size_idx ON public\.live_interest USING btree \(drop_id, size_id\)$/)).toBe(true);
    expect(has(/INDEX live_messages_drop_idx ON public\.live_messages USING btree \(drop_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX live_messages_created_by_idx ON public\.live_messages USING btree \(created_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_tier_windows_pkey ON public\.live_tier_windows USING btree \(drop_id, tier\)$/)).toBe(true);
    // 0022: orders, stock and operations. A location by its name whatever the case, one default; a SKU per model and
    // size; the pieces and sizes on sale by SKU; the ledger's balances; an order once per source, its board, its pieces
    // reserved per SKU and location, one open order per piece; one open piece to make per order; a transfer's halves
    // once each; one invoice per order; an entity's events in the journal; every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX stock_locations_name_key ON public\.stock_locations USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX stock_locations_one_default ON public\.stock_locations USING btree \(is_default\) WHERE is_default$/)).toBe(true);
    expect(has(/UNIQUE INDEX skus_model_size_key ON public\.skus USING btree \(model_id, upper\(size_label\)\) NULLS NOT DISTINCT$/)).toBe(true);
    expect(has(/INDEX products_sku_id_idx ON public\.products USING btree \(sku_id\)$/)).toBe(true);
    expect(has(/INDEX drop_sizes_sku_id_idx ON public\.drop_sizes USING btree \(sku_id\)$/)).toBe(true);
    expect(has(/INDEX drops_stock_location_id_idx ON public\.drops USING btree \(stock_location_id\)$/)).toBe(true);
    expect(has(/INDEX stock_movements_balance_idx ON public\.stock_movements USING btree \(sku_id, location_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX stock_movements_transfer_key ON public\.stock_movements USING btree \(transfer_id, reason\) WHERE \(transfer_id IS NOT NULL\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_live_entry_key ON public\.orders USING btree \(live_entry_id, piece\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_drop_entry_key ON public\.orders USING btree \(drop_entry_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_shop_request_key ON public\.orders USING btree \(shop_request_id\)$/)).toBe(true);
    expect(has(/INDEX orders_board_idx ON public\.orders USING btree \(status, reserved_at\)$/)).toBe(true);
    expect(has(/INDEX orders_stock_reservation_idx ON public\.orders USING btree \(sku_id, location_id\) WHERE \(reservation = 'STOCK'::text\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_product_key ON public\.orders USING btree \(product_id\) WHERE \(status = ANY \(ARRAY\['RESERVED'::text, 'PAID'::text, 'SHIPPED'::text, 'DELIVERED'::text\]\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX bench_items_one_open ON public\.bench_items USING btree \(order_id\) WHERE \(status = ANY \(ARRAY\['TO_MAKE'::text, 'IN_PROGRESS'::text\]\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX invoices_one_per_order ON public\.invoices USING btree \(order_id\) WHERE \(kind = 'INVOICE'::text\)$/)).toBe(true);
    expect(has(/INDEX event_journal_entity_idx ON public\.event_journal USING btree \(entity_type, entity_id, id\)$/)).toBe(true);
    expect(has(/INDEX order_events_order_idx ON public\.order_events USING btree \(order_id, id\)$/)).toBe(true);
    // 0023: releases and collectors. One after-room per release; a guest once, its place unique per after-room; one
    // answer per account and release; a segment by its name whatever the case; the activity by hour, country and tier;
    // every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX drops_parent_drop_id_key ON public\.drops USING btree \(parent_drop_id\)$/)).toBe(true);
    expect(has(/INDEX drops_access_segment_id_idx ON public\.drops USING btree \(access_segment_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX after_room_guests_pkey ON public\.after_room_guests USING btree \(drop_id, entry_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX after_room_guests_position_key ON public\.after_room_guests USING btree \(drop_id, "?position"?\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX after_room_guests_entry_key ON public\.after_room_guests USING btree \(entry_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX release_answers_pkey ON public\.release_answers USING btree \(drop_id, account_id\)$/)).toBe(true);
    expect(has(/INDEX release_answers_account_idx ON public\.release_answers USING btree \(account_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX segments_name_key ON public\.segments USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/INDEX segments_created_by_idx ON public\.segments USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX circle_posts_segment_id_idx ON public\.circle_posts USING btree \(segment_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX activity_hourly_pkey ON public\.activity_hourly USING btree \(hour, country, tier\)$/)).toBe(true);
    // 0025: the messages. One conversation per account; the board by status, waiting time and latest message; a
    // conversation's messages oldest first; the scans the retention clears; every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX client_conversations_account_key ON public\.client_conversations USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX client_conversations_board_idx ON public\.client_conversations USING btree \(status, waiting_since, last_message_at\)$/)).toBe(true);
    for (const by of ['answered_by', 'closed_by']) expect(has(new RegExp(`INDEX client_conversations_${by}_idx ON public\\.client_conversations USING btree \\(${by}\\)$`)), by).toBe(true);
    expect(has(/INDEX client_messages_conversation_idx ON public\.client_messages USING btree \(conversation_id, created_at\)$/)).toBe(true);
    for (const c of ['admin_id', 'product_id', 'order_id', 'drop_id', 'model_id', 'shop_request_id']) {
      expect(has(new RegExp(`INDEX client_messages_${c}_idx ON public\\.client_messages USING btree \\(${c}\\)$`)), c).toBe(true);
    }
    expect(has(/INDEX client_messages_scan_event_idx ON public\.client_messages USING btree \(scan_event_id\) WHERE \(scan_event_id IS NOT NULL\)$/)).toBe(true);
    // 0026: the club's program. One row of settings; the shipping rates by currency and service; every foreign key at
    // the head of an index.
    expect(has(/UNIQUE INDEX club_program_settings_pkey ON public\.club_program_settings USING btree \(id\)$/)).toBe(true);
    for (const c of ['gift_platine_model_id', 'gift_palladium_model_id', 'updated_by']) {
      expect(has(new RegExp(`INDEX club_program_settings_${c}_idx ON public\\.club_program_settings USING btree \\(${c}\\)$`)), c).toBe(true);
    }
    expect(has(/UNIQUE INDEX shipping_rates_pkey ON public\.shipping_rates USING btree \(currency, service\)$/)).toBe(true);
    expect(has(/INDEX shipping_rates_updated_by_idx ON public\.shipping_rates USING btree \(updated_by\)$/)).toBe(true);
    // 0027: the grants and the orders' shipping. One grant of a kind per tier and account; one open GIFT order per
    // grant; one open use per grant and order; every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX tier_grants_once ON public\.tier_grants USING btree \(account_id, tier, kind\)$/)).toBe(true);
    expect(has(/INDEX tier_grants_model_id_idx ON public\.tier_grants USING btree \(model_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_gift_grant_key ON public\.orders USING btree \(gift_grant_id\) WHERE \(status <> 'CANCELLED'::text\)$/)).toBe(true);
    expect(has(/INDEX orders_with_order_idx ON public\.orders USING btree \(with_order_id\)$/)).toBe(true);
    expect(has(/INDEX orders_gift_grant_idx ON public\.orders USING btree \(gift_grant_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX credit_uses_open_key ON public\.credit_uses USING btree \(grant_id, order_id\) WHERE \(released_at IS NULL\)$/)).toBe(true);
    for (const c of ['grant', 'order', 'applied_by', 'released_by']) {
      expect(has(new RegExp(`INDEX credit_uses_${c}_idx ON public\\.credit_uses USING btree \\(${c === 'grant' || c === 'order' ? `${c}_id` : c}\\)$`)), c).toBe(true);
    }    // 0028: the yearly care. One request per piece and year not cancelled; an account's by year; the board by status and
    // time; every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX care_requests_once ON public\.care_requests USING btree \(product_id, year\) WHERE \(status <> 'CANCELLED'::text\)$/)).toBe(true);
    expect(has(/INDEX care_requests_account_idx ON public\.care_requests USING btree \(account_id, year\)$/)).toBe(true);
    expect(has(/INDEX care_requests_status_idx ON public\.care_requests USING btree \(status, requested_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX care_requests_service_record_id_key ON public\.care_requests USING btree \(service_record_id\)$/)).toBe(true);
    for (const [idx, c] of [['product', 'product_id'], ['label_carrier', 'label_carrier_id'], ['return_carrier', 'return_carrier_id'], ['handled_by', 'handled_by']]) {
      expect(has(new RegExp(`INDEX care_requests_${idx}_idx ON public\\.care_requests USING btree \\(${c}\\)$`)), c).toBe(true);
    }
  });

  /**
   * Every column, index, constraint and trigger of the public schema. Not the column positions: PostgreSQL
   * never reuses the number of a dropped column, so a column dropped and added again comes back one further.
   */
  const snapshotOf = async (db: Kysely<any>) =>
    (
      await sql<{ object: string }>`
        SELECT 'table ' || table_name || ' ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS object
          FROM information_schema.columns WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'
        UNION ALL SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename NOT LIKE 'kysely_%'
        UNION ALL SELECT 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
          FROM pg_constraint WHERE connamespace = 'public'::regnamespace
        UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
        ORDER BY 1`.execute(db)
    ).rows.map((r) => r.object);
  const snapshot = () => snapshotOf(t.db);

  /** Roll back until `name` is reverted: the schema with it applied, and without it. */
  async function rollBackTo(name: string): Promise<{ with: string[]; without: string[] }> {
    let withIt: string[] | undefined;
    for (let i = 0; i < Object.keys(MIGRATIONS).length && !withIt; i++) {
      const state = await snapshot();
      if ((await migrateDown(t.db)).reverted[0] === name) withIt = state;
    }
    expect(withIt, name).toBeDefined();
    return { with: withIt!, without: await snapshot() };
  }

  it('0012 down drops media_objects, models.image_sha256 and products.photo_sha256, and nothing else; up again restores them', async () => {
    const latest = await snapshot();
    const { with: withMedia, without: before } = await rollBackTo('0012_media');
    const touched = (o: string) => o.includes('media_objects') || o.includes('image_sha256') || o.includes('photo_sha256');
    const added = withMedia.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table ') && !o.startsWith('table media_objects '))).toEqual([
      'table models image_sha256 text YES ',
      'table products photo_sha256 text YES ',
    ]);
    expect(added.filter((o) => o.startsWith('table media_objects ')).map((o) => o.split(' ')[2])).toEqual(['bytes', 'created_at', 'created_by', 'height', 'mime', 'sha256', 'width']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger media_objects media_objects_immutable']);
    // Nothing of 0012 is left, and nothing else changed.
    expect(before.filter(touched)).toEqual([]);
    expect(withMedia.filter((o) => !touched(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0012_media');
    expect(await snapshot()).toEqual(latest);
  });

  it('0012: a photograph is named by the SHA-256 of its bytes, JPEG or WebP of at most 1 MiB and 4 096 px, never changed, and kept while a model or a piece uses it', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const insert = (v: Partial<{ sha256: string; mime: string; bytes: Uint8Array; width: number; height: number }> = {}) =>
      sql`INSERT INTO media_objects (sha256, mime, bytes, width, height)
          VALUES (${v.sha256 ?? sha}, ${v.mime ?? 'image/jpeg'}, ${v.bytes ?? bytes}, ${v.width ?? 10}, ${v.height ?? 10})`.execute(t.db);
    await expect(insert({ sha256: 'ab'.repeat(32) })).rejects.toSatisfy((e) => isCheckViolation(e, 'media_objects_sha256_consistent'));
    await expect(insert({ sha256: sha.toUpperCase() })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ mime: 'image/svg+xml' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ width: 4097 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ height: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    const big = new Uint8Array(1024 * 1024 + 1);
    await expect(insert({ bytes: big, sha256: createHash('sha256').update(big).digest('hex') })).rejects.toSatisfy((e) => isCheckViolation(e));
    await insert();
    await expect(insert()).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE media_objects SET width = 11`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // Used by a model: the photograph cannot be deleted under it.
    await sql`INSERT INTO categories (id, code, name) VALUES (29, 'P', 'Media test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, image_sha256) VALUES (29, 'M', 'RING', 'MEDIA', ${sha}) RETURNING id`.execute(t.db)).rows[0];
    await expect(sql`DELETE FROM media_objects`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`UPDATE models SET image_sha256 = ${'cd'.repeat(32)} WHERE id = ${model.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`UPDATE models SET image_sha256 = NULL WHERE id = ${model.id}`.execute(t.db);
    await sql`DELETE FROM media_objects`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0010 down drops models.active and the guard on a model\'s identity, and nothing else; up again restores them', async () => {
    const latest = await snapshot();
    // Later migrations (0011…) are rolled back first, then 0010 alone.
    const { with: withActive, without: before } = await rollBackTo('0010_models_active');
    // PGlite's PostgreSQL also lists a NOT NULL as a constraint (models_active_not_null); PostgreSQL 16 does not.
    const added = withActive.filter((o) => !before.includes(o) && o !== 'constraint models models_active_not_null NOT NULL active');
    expect(added).toEqual(['table models active boolean NO true', 'trigger models models_immutable_identity']);
    expect(before.filter((o) => !withActive.includes(o))).toEqual([]);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0010_models_active');
    expect(await snapshot()).toEqual(latest);
  });

  it('0005 down restores the schema of 0004 exactly, and up again re-creates the recovery codes and the transfer pause', async () => {
    const latest = await snapshot();
    // Later migrations (0006…) are rolled back first, then 0005 alone.
    const { with: withRecovery, without: before } = await rollBackTo('0005_account_recovery');
    const added = withRecovery.filter((o) => !before.includes(o));
    expect(added.some((o) => o.startsWith('table account_recovery_codes '))).toBe(true);
    expect(added.filter((o) => o.startsWith('table accounts '))).toEqual(['table accounts transfers_frozen_until timestamp with time zone YES ']);
    // Nothing of 0005 is left, and nothing else changed.
    expect(before.filter((o) => o.includes('account_recovery_codes') || o.includes('transfers_frozen_until'))).toEqual([]);
    expect(withRecovery.filter((o) => !o.includes('account_recovery_codes') && !o.includes('transfers_frozen_until'))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0005_account_recovery');
    expect(await snapshot()).toEqual(latest);
  });

  it('0004 down restores the schema of 0003 exactly, and up again re-creates scan_reports', async () => {
    // Later migrations (0005…) are rolled back first, then 0004 alone.
    const latest = await snapshot();
    const { with: withReports, without: before } = await rollBackTo('0004_scan_reports');
    expect(withReports.some((o) => o.startsWith('table scan_reports '))).toBe(true);
    expect(before.filter((o) => o.includes('scan_reports'))).toEqual([]);
    // Only scan_reports went: everything else is as 0004 found it.
    expect(withReports.filter((o) => !o.includes('scan_reports'))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied[0]).toBe('0004_scan_reports');
    expect(await snapshot()).toEqual(latest);
  });

  it('0007: adds the two print-batch indexes, and its down step drops exactly them', async () => {
    const indexes = async () =>
      (await sql<{ name: string; def: string }>`SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`.execute(t.db)).rows;
    const added = ['codes_created_at_idx', 'products_production_batch_idx'];
    const before = await indexes();
    expect(before.map((i) => i.name)).toEqual(expect.arrayContaining(added));
    await m0007.down(t.db);
    expect((await indexes()).map((i) => i.name)).toEqual(before.map((i) => i.name).filter((n) => !added.includes(n)));
    await m0007.up(t.db);
    expect(await indexes()).toEqual(before);
    expect(MIGRATIONS['0007_print_batch_indexes']).toBe(m0007);
  });

  it('0009: creates scan_daily_stats keyed by day, country, state and event type, and its down step drops exactly it', async () => {
    const columns = async () =>
      (
        await sql<{ table: string; column: string; type: string; nullable: string }>`
          SELECT table_name AS table, column_name AS column, data_type AS type, is_nullable AS nullable
          FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`.execute(t.db)
      ).rows;
    const before = await columns();
    expect(before.filter((c) => c.table === 'scan_daily_stats').map((c) => [c.column, c.type, c.nullable])).toEqual([
      ['day', 'date', 'NO'],
      ['country', 'character', 'NO'],
      ['result_state', 'text', 'NO'],
      ['event_type', 'text', 'NO'],
      ['n', 'integer', 'NO'],
    ]);
    const pk = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'scan_daily_stats'::regclass AND contype = 'p'`.execute(t.db);
    expect(pk.rows.map((r) => r.def)).toEqual(['PRIMARY KEY (day, country, result_state, event_type)']);
    // n ≥ 0, a two-letter country, never a staff scan.
    const insert = (v: Record<string, unknown>) =>
      sql`INSERT INTO scan_daily_stats (day, country, result_state, event_type, n)
          VALUES (${v.day ?? '2026-10-01'}, ${v.country ?? 'FR'}, ${v.state ?? 'AUTHENTIC'}, ${v.type ?? 'VERIFY'}, ${v.n ?? 1})`.execute(t.db);
    await expect(insert({ n: -1 })).rejects.toThrow(/check/i);
    await expect(insert({ country: 'fr' })).rejects.toThrow(/check/i);
    await expect(insert({ type: 'ADMIN_TEST' })).rejects.toThrow(/check/i);
    await expect(insert({ state: 'PENDING' })).rejects.toThrow(/check/i);
    await insert({ n: 0 });
    await expect(insert({ n: 2 })).rejects.toThrow(/duplicate key/i);
    await sql`DELETE FROM scan_daily_stats`.execute(t.db);

    await m0009.down(t.db);
    expect(await columns()).toEqual(before.filter((c) => c.table !== 'scan_daily_stats'));
    await m0009.up(t.db);
    expect(await columns()).toEqual(before);
    expect(MIGRATIONS['0009_scan_daily_stats']).toBe(m0009);
  });

  it('0006 adds admin_users.password_change_required (NOT NULL, false by default); its down step disables the accounts on a temporary password, then drops it', async () => {
    const column = async (db: Kysely<any> = t.db) =>
      (
        await sql<{ data_type: string; is_nullable: string; column_default: string | null }>`
          SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'admin_users' AND column_name = 'password_change_required'`.execute(db)
      ).rows;
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    // A row written by code that does not know the column (the previous image) gets false.
    const row = await sql<{ password_change_required: boolean }>`
      INSERT INTO admin_users (email_normalized, email, password_hash, role)
      VALUES ('old@orbes.test', 'old@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING password_change_required`.execute(t.db);
    expect(row.rows[0].password_change_required).toBe(false);
    // A staff account still on its temporary password, signed in, and one disabled earlier: without the column, the
    // first would use its full role with a password an ADMIN was shown, for good.
    const staff = (
      await sql<{ id: string }>`
        INSERT INTO admin_users (email_normalized, email, password_hash, role, password_change_required)
        VALUES ('temp@orbes.test', 'temp@orbes.test', 'scrypt$x', 'OPERATOR', true) RETURNING id`.execute(t.db)
    ).rows[0];
    const earlier = new Date('2026-09-01T00:00:00.000Z');
    await sql`
      INSERT INTO admin_users (email_normalized, email, password_hash, role, password_change_required, disabled_at)
      VALUES ('gone@orbes.test', 'gone@orbes.test', 'scrypt$x', 'AUDITOR', true, ${earlier})`.execute(t.db);
    await sql`INSERT INTO sessions (id_hash, subject_type, subject_id, csrf_token, expires_at) VALUES (decode(repeat('cd', 32), 'hex'), 'admin', ${staff.id}, 'c', now() + interval '1 hour')`.execute(t.db);
    const state = async (db: Kysely<any>) =>
      (
        await sql<{ email_normalized: string; disabled_at: Date | null }>`
          SELECT email_normalized, disabled_at FROM admin_users WHERE email_normalized IN ('old@orbes.test', 'temp@orbes.test', 'gone@orbes.test') ORDER BY email_normalized`.execute(db)
      ).rows;
    // Down then up, run directly: later migrations of other features do not touch this column.
    const m = MIGRATIONS['0006_admin_password_change_required']!;
    expect(m.down).toBeTypeOf('function');
    await t.db.transaction().execute(async (tx) => {
      await m.down!(tx);
      expect(await column(tx)).toEqual([]);
      const after = await state(tx);
      expect(after.map((r) => [r.email_normalized, r.disabled_at !== null])).toEqual([
        ['gone@orbes.test', true],
        ['old@orbes.test', false],
        ['temp@orbes.test', true],
      ]);
      // An earlier date is kept.
      expect(after[0].disabled_at?.getTime()).toBe(earlier.getTime());
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sessions WHERE subject_id = ${staff.id}`.execute(tx)).rows[0].n).toBe(0);
      await m.up(tx);
    });
    expect(await column()).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    await sql`DELETE FROM admin_users WHERE email_normalized IN ('old@orbes.test', 'temp@orbes.test', 'gone@orbes.test')`.execute(t.db);
  });

  it('0008 adds RETAIL, the points of sale, warranties.retailer_id, scan_events.admin_id and SALE_ACTIVATION; its down step restores 0006', async () => {
    const roleCheck = async (db: Kysely<any> = t.db) =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'admin_users_role_check'`.execute(db)).rows[0]?.def ?? '';
    const purposeCheck = async (db: Kysely<any> = t.db) =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'scan_tokens_purpose_check'`.execute(db)).rows[0]?.def ?? '';
    const columns = async (table: string, db: Kysely<any> = t.db) =>
      (await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY column_name`.execute(db)).rows.map((r) => r.column_name);
    const tables = async (db: Kysely<any> = t.db) =>
      (await sql<{ table_name: string }>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(db)).rows.map((r) => r.table_name);

    expect(await roleCheck()).toContain("'RETAIL'::text");
    expect(await purposeCheck()).toContain("'SALE_ACTIVATION'::text");
    expect(await columns('retailers')).toEqual(['active', 'city', 'country', 'created_at', 'id', 'name', 'updated_at']);
    expect(await columns('warranties')).toContain('retailer_id');
    expect(await columns('scan_events')).toContain('admin_id');

    // Only an ADMIN_TEST scan names a console user.
    const admin = (
      await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('seller@orbes.test', 'seller@orbes.test', 'scrypt$x', 'RETAIL') RETURNING id`.execute(t.db)
    ).rows[0];
    const scan = (rows: string) => sql.raw(`INSERT INTO scan_events (event_type, result_state, admin_id) VALUES ${rows}`).execute(t.db);
    await expect(scan(`('VERIFY', 'AUTHENTIC', '${admin.id}')`)).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_events_admin_id_admin_test'));
    await scan(`('ADMIN_TEST', 'AUTHENTIC', '${admin.id}')`);
    // Points of sale: one per name and city, ignoring case; never deleted.
    await sql`INSERT INTO retailers (name, city, country) VALUES ('ORBES Paris', 'Paris', 'FR')`.execute(t.db);
    await expect(sql`INSERT INTO retailers (name, city) VALUES ('orbes paris', 'PARIS')`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'retailers_name_city_unique'));
    await expect(sql`INSERT INTO retailers (name, country) VALUES ('X', 'fr')`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(sql`DELETE FROM retailers`.execute(t.db)).rejects.toSatisfy(isGuardViolation);

    const m = MIGRATIONS['0008_retail_mode']!;
    expect(m.down).toBeTypeOf('function');
    // A warranty named by its point of sale keeps the name as text; a seller's sessions end, the account stays, disabled.
    const shop = (await sql<{ id: string }>`SELECT id FROM retailers WHERE name = 'ORBES Paris'`.execute(t.db)).rows[0];
    await sql`INSERT INTO categories (id, code, name) VALUES (30, 'Q', 'Down test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (30, 'M', 'RING', 'DOWN') RETURNING id`.execute(t.db)).rows[0];
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-Q-00001', ${(26 << 25) | (30 << 20) | 1}, 2026, 30, 1, 'DOWN-1', ${model.id}, 'SILVER') RETURNING id`.execute(t.db)
    ).rows[0];
    await sql`INSERT INTO warranties (product_id, duration_months, start_date, retailer_id) VALUES (${product.id}, 24, '2026-10-01', ${shop.id})`.execute(t.db);
    await sql`INSERT INTO sessions (id_hash, subject_type, subject_id, csrf_token, expires_at) VALUES (decode(repeat('ab', 32), 'hex'), 'admin', ${admin.id}, 'c', now() + interval '1 hour')`.execute(t.db);
    await t.db.transaction().execute(async (tx) => {
      // Another table pointing to the seller with ON DELETE RESTRICT, as 0004 scan_reports.handled_by and
      // 0005 account_recovery_codes.created_by do on the integration branch: the rollback must not trip on it.
      await sql`CREATE TABLE down_test_ref (admin_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT)`.execute(tx);
      await sql`INSERT INTO down_test_ref (admin_id) VALUES (${admin.id})`.execute(tx);
      // 0011 (F-03) re-creates the purpose CHECK after 0008: it goes first, as Kysely would take it down first.
      await m0011.down(tx);
      await m.down!(tx);
      const seller = (await sql<{ role: string; disabled: boolean }>`SELECT role, disabled_at IS NOT NULL AS disabled FROM admin_users WHERE email_normalized = 'seller@orbes.test'`.execute(tx)).rows;
      expect(seller).toEqual([{ role: 'AUDITOR', disabled: true }]);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM sessions`.execute(tx)).rows[0].n).toBe(0);
      await sql`DROP TABLE down_test_ref`.execute(tx);
      expect((await sql<{ retailer: string | null }>`SELECT retailer FROM warranties WHERE product_id = ${product.id}`.execute(tx)).rows[0].retailer).toBe('ORBES Paris');
      expect(await roleCheck(tx)).toBe("CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERATOR'::text, 'AUDITOR'::text])))");
      // As 0001 wrote it (PostgreSQL normalises a one-value IN to an equality).
      expect(await purposeCheck(tx)).toBe("CHECK ((purpose = 'FIRST_REGISTRATION'::text))");
      expect(await tables(tx)).not.toContain('retailers');
      expect(await columns('warranties', tx)).not.toContain('retailer_id');
      expect(await columns('scan_events', tx)).not.toContain('admin_id');
      await m.up(tx);
      await m0011.up(tx);
    });
    expect(await roleCheck()).toContain("'RETAIL'::text");
    expect(await purposeCheck()).toContain("'TRANSFER_ACCEPT'::text");
    expect(await tables()).toContain('retailers');
    await sql`DELETE FROM scan_events`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE email_normalized = 'seller@orbes.test'`.execute(t.db);
  });

  it('0011 adds TRANSFER_ACCEPT to the scan token purposes; its down step restores the CHECK of 0008, SALE_ACTIVATION working, and up again', async () => {
    const purposeCheck = async () =>
      (await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'scan_tokens_purpose_check'`.execute(t.db)).rows[0]?.def ?? '';
    const latest = await snapshot();
    expect(await purposeCheck()).toBe("CHECK ((purpose = ANY (ARRAY['FIRST_REGISTRATION'::text, 'SALE_ACTIVATION'::text, 'TRANSFER_ACCEPT'::text])))");

    // A piece, a scan and one token of each purpose.
    await sql`INSERT INTO categories (id, code, name) VALUES (28, 'T', 'Purpose test')`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (28, 'M', 'RING', 'PURP') RETURNING id`.execute(t.db)).rows[0];
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-T-00001', ${(26 << 25) | (28 << 20) | 1}, 2026, 28, 1, 'PURP-1', ${model.id}, 'SILVER') RETURNING id`.execute(t.db)
    ).rows[0];
    const scan = (await sql<{ id: string }>`INSERT INTO scan_events (event_type, result_state, product_id) VALUES ('VERIFY', 'AUTHENTIC_REGISTERED', ${product.id}) RETURNING id`.execute(t.db)).rows[0];
    const token = (n: number, purpose: string) =>
      sql`INSERT INTO scan_tokens (id_hash, product_id, scan_event_id, purpose, expires_at) VALUES (decode(repeat(${n.toString(16).padStart(2, '0')}, 32), 'hex'), ${product.id}, ${scan.id}, ${purpose}, now() + interval '15 minutes')`.execute(t.db);
    const purposes = async () =>
      (await sql<{ purpose: string }>`SELECT purpose FROM scan_tokens WHERE product_id = ${product.id} ORDER BY purpose`.execute(t.db)).rows.map((r) => r.purpose);
    await token(1, 'FIRST_REGISTRATION');
    await token(2, 'SALE_ACTIVATION');
    await token(3, 'TRANSFER_ACCEPT');
    await expect(token(4, 'OTHER')).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_tokens_purpose_check'));

    // Down (the migrations after it first, as Kysely takes them down): the outstanding transfer tokens go, the CHECK
    // is 0008's again, and a sale token still goes in.
    const later = Object.keys(MIGRATIONS).filter((n) => n > '0011_scan_token_transfer_accept');
    for (const name of [...later].reverse()) expect((await migrateDown(t.db)).reverted).toEqual([name]);
    expect((await migrateDown(t.db)).reverted).toEqual(['0011_scan_token_transfer_accept']);
    expect(await purposeCheck()).toBe("CHECK ((purpose = ANY (ARRAY['FIRST_REGISTRATION'::text, 'SALE_ACTIVATION'::text])))");
    expect(await purposes()).toEqual(['FIRST_REGISTRATION', 'SALE_ACTIVATION']);
    await token(5, 'SALE_ACTIVATION');
    await expect(token(6, 'TRANSFER_ACCEPT')).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_tokens_purpose_check'));

    // Up again: the three purposes, the tokens kept, the schema as before.
    expect((await migrateToLatest(t.db)).applied).toEqual(['0011_scan_token_transfer_accept', ...later]);
    await token(7, 'TRANSFER_ACCEPT');
    await token(8, 'SALE_ACTIVATION');
    expect(await purposes()).toEqual(['FIRST_REGISTRATION', 'SALE_ACTIVATION', 'SALE_ACTIVATION', 'SALE_ACTIVATION', 'TRANSFER_ACCEPT']);
    expect(await snapshot()).toEqual(latest);

    await sql`DELETE FROM scan_tokens WHERE product_id = ${product.id}`.execute(t.db);
    await sql`DELETE FROM scan_events WHERE id = ${scan.id}`.execute(t.db);
  });

  it('0014 adds the lookbook of a model and its gallery, and nothing else; down restores 0013 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withLookbook, without: before } = await rollBackTo('0014_model_lookbook');
    // What 0014 adds names the new table or one of the five new columns (PGlite's PostgreSQL also lists a NOT NULL as a
    // constraint, models_lookbook_not_null; PostgreSQL 16 does not).
    const of0014 = (o: string) => o.includes('model_images') || /\b(slug|lookbook|story|specs|published_at)\b/.test(o);
    const added = withLookbook.filter((o) => !before.includes(o));
    const columns = added.filter((o) => o.startsWith('table models '));
    expect(columns).toEqual([
      "table models lookbook text NO 'HIDDEN'::text",
      'table models published_at timestamp with time zone YES ',
      'table models slug text YES ',
      'table models specs text YES ',
      'table models story text YES ',
    ]);
    expect(added.filter((o) => o.startsWith('table model_images ')).map((o) => o.split(' ')[2])).toEqual(['alt', 'created_at', 'created_by', 'model_id', 'position', 'sha256']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger model_images model_images_immutable_identity']);
    for (const c of [
      /^constraint models models_slug_format CHECK \(\(\(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'::text\) AND \(length\(slug\) <= 80\)\)\)$/,
      /^constraint models models_slug_key UNIQUE \(slug\)$/,
      /^constraint models models_lookbook_slug CHECK \(\(\(lookbook = 'HIDDEN'::text\) OR \(slug IS NOT NULL\)\)\)$/,
      /^constraint models models_published_slug CHECK \(\(\(published_at IS NULL\) OR \(slug IS NOT NULL\)\)\)$/,
      /^constraint model_images model_images_position_key UNIQUE \(model_id, "?position"?\) DEFERRABLE INITIALLY DEFERRED$/,
      /^constraint model_images model_images_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint model_images model_images_sha256_fkey FOREIGN KEY \(sha256\) REFERENCES media_objects\(sha256\) ON DELETE RESTRICT$/,
      /^constraint model_images model_images_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Nothing of 0014 is left, and nothing else changed.
    expect(before.filter(of0014)).toEqual([]);
    expect(added.filter((o) => !of0014(o))).toEqual([]);
    expect(withLookbook.filter((o) => !of0014(o))).toEqual(before);
    // Later migrations (0015…) were rolled back first: up again applies them after it.
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0014_model_lookbook'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0014: every model stays HIDDEN without an address; a model shown has one, unique and lower-case; at most 8 photographs a gallery, in positions 1 to 8', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (27, 'U', 'Lookbook test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string; lookbook: string; slug: string | null }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (27, 'M', 'RING', 'LOOK') RETURNING id, lookbook, slug`.execute(t.db)).rows[0];
    expect([model.lookbook, model.slug]).toEqual(['HIDDEN', null]);
    const set = (assignments: string) => sql.raw(`UPDATE models SET ${assignments} WHERE id = '${model.id}'`).execute(t.db);
    await expect(set(`lookbook = 'PUBLIC'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_lookbook_slug'));
    await expect(set(`lookbook = 'SHOWN', slug = 'm'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const slug of ['Monolithe', 'mono--lithe', '-mono', 'mono-', 'mono lithe', 'é', 'a'.repeat(81)]) {
      await expect(set(`slug = '${slug}'`), slug).rejects.toSatisfy((e) => isCheckViolation(e, 'models_slug_format'));
    }
    await expect(set(`published_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_published_slug'));
    await set(`slug = 'monolithe-ring', lookbook = 'RESERVED', published_at = now()`);
    await expect(set(`slug = NULL`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`story = '   '`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`story = '${'x'.repeat(4001)}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`specs = '${'x'.repeat(1001)}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await set(`story = '${'x'.repeat(4000)}', specs = 'Metal: silver'`);
    const other = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (27, 'N', 'RING', 'LOOK2') RETURNING id`.execute(t.db)).rows[0];
    await expect(sql`UPDATE models SET slug = 'monolithe-ring' WHERE id = ${other.id}`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'models_slug_key'));

    // The gallery: photographs of media_objects, positions 1 to 8, each once per model; never moved to another model.
    const photo = async (n: number) => {
      const bytes = new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]);
      const sha = createHash('sha256').update(bytes).digest('hex');
      await sql`INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES (${sha}, 'image/jpeg', ${bytes}, 10, 10)`.execute(t.db);
      return sha;
    };
    const shas = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(photo));
    const add = (sha: string, position: number, modelId = model.id) => sql`INSERT INTO model_images (model_id, sha256, position) VALUES (${modelId}, ${sha}, ${position})`.execute(t.db);
    for (const [i, sha] of shas.slice(0, 8).entries()) await add(sha, i + 1);
    await expect(add(shas[8]!, 9)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[8]!, 0)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[8]!, 3)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_images_position_key'));
    await expect(add(shas[0]!, 8, model.id)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`INSERT INTO model_images (model_id, sha256, position) VALUES (${model.id}, ${'ab'.repeat(32)}, 1)`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`UPDATE model_images SET alt = '  ' WHERE model_id = ${model.id} AND position = 1`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    // Two positions swapped in one transaction: the uniqueness is checked at commit.
    await t.db.transaction().execute(async (tx) => {
      await sql`UPDATE model_images SET position = 2 WHERE model_id = ${model.id} AND sha256 = ${shas[0]!}`.execute(tx);
      await sql`UPDATE model_images SET position = 1 WHERE model_id = ${model.id} AND sha256 = ${shas[1]!}`.execute(tx);
    });
    await expect(sql`UPDATE model_images SET position = 1 WHERE model_id = ${model.id} AND sha256 = ${shas[2]!}`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_images_position_key'));
    await expect(sql`UPDATE model_images SET model_id = ${other.id} WHERE model_id = ${model.id} AND position = 1`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // A photograph of a gallery cannot be deleted under it, nor its model.
    await expect(sql`DELETE FROM media_objects WHERE sha256 = ${shas[0]!}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM model_images WHERE model_id = ${model.id}`.execute(t.db);
    await sql`DELETE FROM media_objects WHERE sha256 IN (${sql.join(shas)})`.execute(t.db);
    await sql`DELETE FROM models WHERE id IN (${model.id}, ${other.id})`.execute(t.db);
  });

  it('0015 adds drops and drop_entries, and nothing else; down drops them alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withDrops, without: before } = await rollBackTo('0015_drops');
    const of0015 = (o: string) => /\bdrops\b|\bdrop_entries\b/.test(o);
    const added = withDrops.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0015(o))).toEqual([]);
    expect(before.filter(of0015)).toEqual([]);
    expect(withDrops.filter((o) => !of0015(o))).toEqual(before);
    expect(added.filter((o) => o.startsWith('table drops ')).map((o) => o.split(' ')[2])).toEqual([
      'cancelled_at', 'closes_at', 'created_at', 'created_by', 'description', 'drawn_at', 'id', 'model_id', 'opens_at', 'published_at',
      'purchase_window_hours', 'quantity', 'seed', 'seed_enc', 'seed_hash', 'title',
    ]);
    expect(added.filter((o) => o.startsWith('table drop_entries ')).map((o) => o.split(' ')[2])).toEqual([
      'account_id', 'created_at', 'drop_id', 'handled_at', 'handled_by', 'id', 'note', 'rank', 'respond_by', 'seniority', 'status', 'tier',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger drop_entries drop_entries_immutable_identity', 'trigger drops drops_immutable_seed']);
    for (const c of [
      /^constraint drops drops_window CHECK \(\(closes_at > opens_at\)\)$/,
      /^constraint drops drops_seed CHECK \(\(\(seed IS NULL\) OR \(\(octet_length\(seed\) = 32\) AND \(seed_hash = sha256\(seed\)\)\)\)\)$/,
      /^constraint drops drops_drawn CHECK \(\(\(drawn_at IS NULL\) = \(seed IS NULL\)\)\)$/,
      /^constraint drops drops_drawn_after_close CHECK /,
      /^constraint drops drops_cancelled_before_draw CHECK \(\(\(cancelled_at IS NULL\) OR \(drawn_at IS NULL\)\)\)$/,
      /^constraint drops drops_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_drop_account_key UNIQUE \(drop_id, account_id\)$/,
      /^constraint drop_entries drop_entries_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_handled_by_fkey FOREIGN KEY \(handled_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_lapsed CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0015_drops'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0015: a seed sealed and committed, written in clear by the draw only; one entry per account and drop, its identity fixed, its status consistent', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (26, 'Z', 'Drop test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (26, 'D', 'RING', 'DROPT') RETURNING id`.execute(t.db)).rows[0];
    const seed = new Uint8Array(32).fill(7);
    const seedHash = createHash('sha256').update(seed).digest();
    const sealed = `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`;
    const insert = (v: Record<string, unknown> = {}) =>
      sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
          VALUES (${v.model ?? model.id}, ${v.title ?? 'Release'}, ${v.quantity ?? 2}, ${v.opens ?? '2026-11-01T10:00:00Z'}, ${v.closes ?? '2026-11-03T10:00:00Z'},
                  ${v.sealed ?? sealed}, ${v.hash ?? seedHash}) RETURNING id`.execute(t.db);
    await expect(insert({ quantity: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ closes: '2026-11-01T10:00:00Z' })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_window'));
    await expect(insert({ title: '  ' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ sealed: 'plain seed' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ hash: new Uint8Array(31) })).rejects.toSatisfy((e) => isCheckViolation(e));
    const drop = (await insert()).rows[0];
    const row = (await sql<{ purchase_window_hours: number; seed: Uint8Array | null }>`SELECT purchase_window_hours, seed FROM drops WHERE id = ${drop.id}`.execute(t.db)).rows[0];
    expect(row).toEqual({ purchase_window_hours: 48, seed: null });
    const set = (assignments: string) => sql.raw(`UPDATE drops SET ${assignments} WHERE id = '${drop.id}'`).execute(t.db);
    for (const hours of [0, 337]) await expect(set(`purchase_window_hours = ${hours}`), String(hours)).rejects.toSatisfy((e) => isCheckViolation(e));
    // The seed and its commitment never change; the seed in clear only with the draw, and only the one committed.
    await expect(set(`seed_hash = decode(repeat('00', 32), 'hex')`)).rejects.toSatisfy(isGuardViolation);
    await expect(set(`seed_enc = 'v1.${'C'.repeat(16)}.${'D'.repeat(64)}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(set(`seed = decode(repeat('07', 32), 'hex')`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn'));
    await expect(set(`drawn_at = '2026-11-04T10:00:00Z'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn'));
    await expect(set(`seed = decode(repeat('08', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z', published_at = '2026-10-30T10:00:00Z'`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_seed'),
    );
    // A draw needs a publication and a close behind it; a cancellation forbids it.
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_drawn_after_close'));
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-02T10:00:00Z', published_at = '2026-10-30T10:00:00Z'`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_drawn_after_close'),
    );
    await expect(set(`seed = decode(repeat('07', 32), 'hex'), drawn_at = '2026-11-04T10:00:00Z', published_at = '2026-10-30T10:00:00Z', cancelled_at = now()`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drops_cancelled_before_draw'),
    );

    // Entries: one per account and drop; the identity of a row never changes.
    const account = async (n: number) =>
      (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES (${`drop${n}@example.com`}, ${`drop${n}@example.com`}, 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const [a1, a2] = [await account(1), await account(2)];
    const enter = (accountId: string, v: Record<string, unknown> = {}) =>
      sql<{ id: string; status: string }>`INSERT INTO drop_entries (drop_id, account_id, status, tier, seniority, rank, respond_by)
          VALUES (${drop.id}, ${accountId}, ${v.status ?? 'ENTERED'}, ${v.tier ?? null}, ${v.seniority ?? null}, ${v.rank ?? null}, ${v.respondBy ?? null}) RETURNING id, status`.execute(t.db);
    const e1 = (await enter(a1)).rows[0];
    expect(e1.status).toBe('ENTERED');
    await expect(enter(a1)).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_entries_drop_account_key'));
    await expect(enter(a2, { status: 'DRAWN' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(enter(a2, { tier: 1, seniority: 0, rank: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_entered'));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 1, seniority: 0 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_waitlisted'));
    await expect(enter(a2, { status: 'SELECTED', tier: 1, seniority: 0, rank: 1 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_held'));
    await expect(enter(a2, { status: 'WITHDRAWN', tier: 1, seniority: 0, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_withdrawn'));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 4, seniority: 0, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(enter(a2, { status: 'WAITLISTED', tier: 1, rank: 2 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_standing'));
    for (const col of ['id', 'drop_id', 'account_id', 'created_at']) {
      const value = col === 'created_at' ? `now() + interval '1 day'` : col === 'account_id' ? `'${a2}'` : `gen_random_uuid()`;
      await expect(sql.raw(`UPDATE drop_entries SET ${col} = ${value} WHERE id = '${e1.id}'`).execute(t.db), col).rejects.toSatisfy(isGuardViolation);
    }
    // A concluded entry names when; a lapse comes after the place held.
    const respondBy = new Date(Date.now() + 3 * 86_400_000);
    await sql`UPDATE drop_entries SET status = 'SELECTED', tier = 1, seniority = 0, rank = 1, respond_by = ${respondBy} WHERE id = ${e1.id}`.execute(t.db);
    await expect(sql`UPDATE drop_entries SET status = 'CONFIRMED' WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e, 'drop_entries_handled'));
    await expect(sql`UPDATE drop_entries SET status = 'LAPSED', handled_at = ${new Date(respondBy.getTime() - 1000)} WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'drop_entries_lapsed'),
    );
    await sql`UPDATE drop_entries SET status = 'LAPSED', handled_at = ${respondBy} WHERE id = ${e1.id}`.execute(t.db);
    await expect(sql`UPDATE drop_entries SET note = ' ' WHERE id = ${e1.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    // A drop and an account stay while an entry names them.
    await expect(sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM accounts WHERE id = ${a1}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM drop_entries WHERE drop_id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id IN (${a1}, ${a2})`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0016 adds the five tables of the circle, and nothing else; down drops them alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withCircle, without: before } = await rollBackTo('0016_circle');
    const of0016 = (o: string) => /\bcircle_(posts|post_images|rsvps|poll_votes|daily_visits)\b/.test(o);
    const added = withCircle.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0016(o))).toEqual([]);
    expect(before.filter(of0016)).toEqual([]);
    expect(withCircle.filter((o) => !of0016(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('circle_posts')).toEqual([
      'body', 'capacity', 'created_at', 'created_by', 'drop_id', 'event_at', 'event_place', 'external_url', 'id', 'kind', 'min_tier', 'model_id', 'poll_options',
      'published_at', 'title',
    ]);
    expect(columns('circle_post_images')).toEqual(['alt', 'created_at', 'created_by', 'position', 'post_id', 'sha256']);
    expect(columns('circle_rsvps')).toEqual(['account_id', 'answer', 'created_at', 'post_id', 'updated_at']);
    expect(columns('circle_poll_votes')).toEqual(['account_id', 'created_at', 'option_index', 'post_id']);
    // The visits of a day: a count, and no account.
    expect(columns('circle_daily_visits')).toEqual(['day', 'visits']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger circle_poll_votes circle_poll_votes_final',
      'trigger circle_post_images circle_post_images_immutable_identity',
      'trigger circle_posts circle_posts_immutable_identity',
      'trigger circle_rsvps circle_rsvps_immutable_identity',
    ]);
    for (const c of [
      /^constraint circle_posts circle_posts_invitation CHECK /,
      /^constraint circle_posts circle_posts_invitation_only CHECK /,
      /^constraint circle_posts circle_posts_poll CHECK /,
      /^constraint circle_posts circle_posts_poll_options CHECK /,
      /^constraint circle_posts circle_posts_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_posts circle_posts_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_posts circle_posts_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_post_images circle_post_images_position_key UNIQUE \(post_id, "?position"?\) DEFERRABLE INITIALLY DEFERRED$/,
      /^constraint circle_post_images circle_post_images_sha256_fkey FOREIGN KEY \(sha256\) REFERENCES media_objects\(sha256\) ON DELETE RESTRICT$/,
      /^constraint circle_rsvps circle_rsvps_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint circle_poll_votes circle_poll_votes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^index CREATE INDEX circle_posts_published_idx ON public\.circle_posts USING btree \(published_at\) WHERE \(published_at IS NOT NULL\)$/,
      /^index CREATE INDEX circle_rsvps_account_idx ON public\.circle_rsvps USING btree \(account_id, created_at\)$/,
      /^index CREATE INDEX circle_poll_votes_account_idx ON public\.circle_poll_votes USING btree \(account_id, created_at\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0016_circle'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0016: a post holds the fields of its kind only, never changes kind; its photographs 1 to 4; one answer and one final vote per account; visits without an account', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (25, 'Y', 'Circle test') ON CONFLICT DO NOTHING`.execute(t.db);
    const insert = (v: Record<string, unknown> = {}) =>
      sql<{ id: string; min_tier: number; published_at: Date | null }>`INSERT INTO circle_posts (kind, title, body, event_at, event_place, capacity, poll_options, external_url)
          VALUES (${v.kind ?? 'NOTE'}, ${v.title ?? 'A note'}, ${v.body ?? null}, ${v.eventAt ?? null}, ${v.place ?? null}, ${v.capacity ?? null},
                  ${v.options ?? null}::text[], ${v.url ?? null}) RETURNING id, min_tier, published_at`.execute(t.db);
    await expect(insert({ kind: 'NEWS' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ title: '  ' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ title: 'x'.repeat(121) })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ body: 'x'.repeat(6001) })).rejects.toSatisfy((e) => isCheckViolation(e));
    // An invitation has its event; nothing else has an event, a place or a capacity; a poll has 2 to 6 options, a poll only.
    await expect(insert({ kind: 'INVITATION' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation'));
    await expect(insert({ eventAt: '2026-11-01T19:00:00Z' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation'));
    await expect(insert({ place: 'Paris' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation_only'));
    await expect(insert({ capacity: 10 })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_invitation_only'));
    await expect(insert({ kind: 'INVITATION', eventAt: '2026-11-01T19:00:00Z', capacity: 0 })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ kind: 'POLL' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll'));
    await expect(insert({ options: '{a,b}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll'));
    await expect(insert({ kind: 'POLL', options: '{a}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ kind: 'POLL', options: '{a,b,c,d,e,f,g}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ kind: 'POLL', options: '{a,NULL}' })).rejects.toSatisfy((e) => isCheckViolation(e, 'circle_posts_poll_options'));
    await expect(insert({ url: 'http://youtube.com/watch' })).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert({ url: `https://theorbes.com/${'x'.repeat(480)}` })).rejects.toSatisfy((e) => isCheckViolation(e));
    const note = (await insert({ body: 'Two paragraphs.\n\nThe second.', url: 'https://www.youtube.com/watch?v=x' })).rows[0];
    expect([note.min_tier, note.published_at]).toEqual([1, null]);
    const invitation = (await insert({ kind: 'INVITATION', title: 'A dinner', eventAt: '2026-11-01T19:00:00Z', place: 'Paris', capacity: 2 })).rows[0];
    const poll = (await insert({ kind: 'POLL', title: 'A poll', options: '{"Paris, at night","Milan"}' })).rows[0];
    expect((await sql<{ poll_options: string[] }>`SELECT poll_options FROM circle_posts WHERE id = ${poll.id}`.execute(t.db)).rows[0].poll_options).toEqual(['Paris, at night', 'Milan']);
    for (const tier of [0, 4]) await expect(sql`UPDATE circle_posts SET min_tier = ${tier} WHERE id = ${note.id}`.execute(t.db), String(tier)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const [col, value] of [['kind', `'POLL'`], ['id', 'gen_random_uuid()'], ['created_at', `now() + interval '1 day'`]] as const) {
      await expect(sql.raw(`UPDATE circle_posts SET ${col} = ${value} WHERE id = '${note.id}'`).execute(t.db), col).rejects.toSatisfy(isGuardViolation);
    }

    // Photographs: positions 1 to 4, each once per post, never moved to another post.
    const photo = async (n: number) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0x70 + n, 0xff, 0xd9]);
      const sha = createHash('sha256').update(bytes).digest('hex');
      await sql`INSERT INTO media_objects (sha256, mime, bytes, width, height) VALUES (${sha}, 'image/jpeg', ${bytes}, 10, 10)`.execute(t.db);
      return sha;
    };
    const shas = await Promise.all([1, 2, 3, 4, 5].map(photo));
    const add = (sha: string, position: number, postId = note.id) => sql`INSERT INTO circle_post_images (post_id, sha256, position) VALUES (${postId}, ${sha}, ${position})`.execute(t.db);
    for (const [i, sha] of shas.slice(0, 4).entries()) await add(sha, i + 1);
    await expect(add(shas[4]!, 5)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(add(shas[4]!, 2)).rejects.toSatisfy((e) => isUniqueViolation(e, 'circle_post_images_position_key'));
    await expect(add(shas[0]!, 4, note.id)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE circle_post_images SET post_id = ${poll.id} WHERE post_id = ${note.id} AND position = 1`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await expect(sql`DELETE FROM media_objects WHERE sha256 = ${shas[0]!}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // Answers: YES or NO, one per account and post, changed in place; votes: one per account, final.
    const account = async (n: number) =>
      (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES (${`circle${n}@example.com`}, ${`circle${n}@example.com`}, 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const [a1, a2] = [await account(1), await account(2)];
    const answer = (accountId: string, value: string) => sql`INSERT INTO circle_rsvps (post_id, account_id, answer) VALUES (${invitation.id}, ${accountId}, ${value})`.execute(t.db);
    await expect(answer(a1, 'MAYBE')).rejects.toSatisfy((e) => isCheckViolation(e));
    await answer(a1, 'YES');
    await expect(answer(a1, 'NO')).rejects.toSatisfy((e) => isUniqueViolation(e));
    await sql`UPDATE circle_rsvps SET answer = 'NO', updated_at = now() + interval '1 minute' WHERE post_id = ${invitation.id} AND account_id = ${a1}`.execute(t.db);
    await expect(sql`UPDATE circle_rsvps SET account_id = ${a2} WHERE post_id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await expect(sql`UPDATE circle_rsvps SET updated_at = created_at - interval '1 minute' WHERE post_id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    const vote = (accountId: string, option: number) => sql`INSERT INTO circle_poll_votes (post_id, account_id, option_index) VALUES (${poll.id}, ${accountId}, ${option})`.execute(t.db);
    await expect(vote(a1, 6)).rejects.toSatisfy((e) => isCheckViolation(e));
    await vote(a1, 1);
    await expect(vote(a1, 0)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE circle_poll_votes SET option_index = 0 WHERE post_id = ${poll.id}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    // A post and an account stay while an answer or a vote names them.
    await expect(sql`DELETE FROM circle_posts WHERE id = ${invitation.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM accounts WHERE id = ${a1}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // The visits of a day: one row per day, a count of zero or more.
    await expect(sql`INSERT INTO circle_daily_visits (day, visits) VALUES ('2026-10-04', -1)`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    await sql`INSERT INTO circle_daily_visits (day, visits) VALUES ('2026-10-04', 3)`.execute(t.db);
    await expect(sql`INSERT INTO circle_daily_visits (day) VALUES ('2026-10-04')`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e));

    await sql`DELETE FROM circle_daily_visits`.execute(t.db);
    await sql`DELETE FROM circle_poll_votes`.execute(t.db);
    await sql`DELETE FROM circle_rsvps`.execute(t.db);
    await sql`DELETE FROM circle_post_images`.execute(t.db);
    await sql`DELETE FROM media_objects WHERE sha256 IN (${sql.join(shas)})`.execute(t.db);
    await sql`DELETE FROM circle_posts`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id IN (${a1}, ${a2})`.execute(t.db);
  });

  it('0017 adds drops.early_access_hours, and nothing else; down restores 0016 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withEarly, without: before } = await rollBackTo('0017_drop_early_access');
    // What 0017 adds names its column (PGlite's PostgreSQL also lists its NOT NULL as a constraint; PostgreSQL 16 does not).
    const of0017 = (o: string) => o.includes('early_access_hours');
    const added = withEarly.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table drops early_access_hours smallint NO 48']);
    expect(added.some((o) => /^constraint drops drops_early_access_hours_check CHECK \(\(\(early_access_hours >= 0\) AND \(early_access_hours <= 336\)\)\)$/.test(o))).toBe(true);
    expect(added.filter((o) => !of0017(o))).toEqual([]);
    expect(before.filter(of0017)).toEqual([]);
    expect(withEarly.filter((o) => !of0017(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0017_drop_early_access'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0017: the early access of a drop, 48 hours by default, 0 (none) to 336; a direct reservation is an entry SELECTED with its tier and no rank', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (24, 'X', 'Early access test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (24, 'E', 'RING', 'EARLY') RETURNING id`.execute(t.db)).rows[0];
    const seedHash = createHash('sha256').update(new Uint8Array(32).fill(5)).digest();
    const drop = (
      await sql<{ id: string; early_access_hours: number }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
          VALUES (${model.id}, 'Release', 2, '2026-11-01T10:00:00Z', '2026-11-03T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash})
          RETURNING id, early_access_hours`.execute(t.db)
    ).rows[0];
    expect(drop.early_access_hours).toBe(48);
    const set = (hours: number) => sql`UPDATE drops SET early_access_hours = ${hours} WHERE id = ${drop.id}`.execute(t.db);
    for (const hours of [-1, 337]) await expect(set(hours), String(hours)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const hours of [0, 336, 48]) await set(hours);
    // The reservation of the early access: SELECTED at once, held until its time, the tier of the request, never a rank.
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('early@example.com', 'early@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    await sql`INSERT INTO drop_entries (drop_id, account_id, status, tier, seniority, respond_by) VALUES (${drop.id}, ${account}, 'SELECTED', 2, 0, '2026-10-31T10:00:00Z')`.execute(t.db);
    await sql`DELETE FROM drop_entries WHERE drop_id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${drop.id}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id = ${account}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0018 adds club_tiers, and nothing else; down restores 0017 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withTiers, without: before } = await rollBackTo('0018_club_tiers');
    const of0018 = (o: string) => o.includes('club_tiers');
    const added = withTiers.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table club_tiers benefits text NO ',
      'table club_tiers tier text NO ',
      'table club_tiers updated_at timestamp with time zone NO now()',
      'table club_tiers updated_by uuid YES ',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger club_tiers club_tiers_immutable_tier']);
    expect(added.some((o) => /^constraint club_tiers club_tiers_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/.test(o))).toBe(true);
    expect(added.filter((o) => !of0018(o))).toEqual([]);
    expect(before.filter(of0018)).toEqual([]);
    expect(withTiers.filter((o) => !of0018(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0018_club_tiers'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0018: a tier\'s benefits, one row per tier at most, 1 to 600 characters; its tier never changes; its author stays while named', async () => {
    const insert = (tier: string, benefits: string, by: string | null = null) =>
      sql`INSERT INTO club_tiers (tier, benefits, updated_by) VALUES (${tier}, ${benefits}, ${by})`.execute(t.db);
    await expect(insert('GOLD', 'A benefit.')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert('TITANE', '   ')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert('TITANE', 'x'.repeat(601))).rejects.toSatisfy((e) => isCheckViolation(e));
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('tiers@orbes.test', 'tiers@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    await insert('TITANE', 'x'.repeat(600), admin);
    await expect(insert('TITANE', 'Again.')).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(sql`UPDATE club_tiers SET tier = 'PLATINE' WHERE tier = 'TITANE'`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    await sql`UPDATE club_tiers SET benefits = 'The circle.' WHERE tier = 'TITANE'`.execute(t.db);
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM club_tiers`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
  });

  it('0019 adds models.discontinued_at and discontinued_by, and nothing else; down restores 0018 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withDiscontinued, without: before } = await rollBackTo('0019_model_discontinued');
    const of0019 = (o: string) => o.includes('discontinued');
    const added = withDiscontinued.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table models discontinued_at timestamp with time zone YES ', 'table models discontinued_by uuid YES ']);
    for (const c of [
      /^constraint models models_discontinued_by_fkey FOREIGN KEY \(discontinued_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint models models_discontinued_inactive CHECK \(\(\(discontinued_at IS NULL\) OR \(NOT active\)\)\)$/,
      /^constraint models models_discontinued_by_when CHECK \(\(\(discontinued_by IS NULL\) OR \(discontinued_at IS NOT NULL\)\)\)$/,
      /^index CREATE INDEX models_discontinued_by_idx ON public\.models USING btree \(discontinued_by\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => !of0019(o))).toEqual([]);
    expect(before.filter(of0019)).toEqual([]);
    expect(withDiscontinued.filter((o) => !of0019(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0019_model_discontinued'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0019: a model discontinued is never active; its author only with its date, and stays while named; reinstated, both cleared', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (25, 'Y', 'Discontinued test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string; discontinued_at: Date | null; discontinued_by: string | null }>`
      INSERT INTO models (category_id, name, type, sku_prefix) VALUES (25, 'D', 'RING', 'DISC') RETURNING id, discontinued_at, discontinued_by`.execute(t.db)).rows[0];
    // Every model starts as it was: not discontinued.
    expect([model.discontinued_at, model.discontinued_by]).toEqual([null, null]);
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('disc@orbes.test', 'disc@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const set = (sets: string) => sql.raw(`UPDATE models SET ${sets} WHERE id = '${model.id}'`).execute(t.db);
    // Discontinued while active, an author without a date, an active discontinued model: refused.
    await expect(set(`discontinued_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_inactive'));
    await expect(set(`discontinued_by = '${admin}', active = false`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_by_when'));
    await set(`discontinued_at = now(), discontinued_by = '${admin}', active = false`);
    await expect(set(`active = true`)).rejects.toSatisfy((e) => isCheckViolation(e, 'models_discontinued_inactive'));
    // A script discontinues without an author.
    await set(`discontinued_by = NULL`);
    await set(`discontinued_by = '${admin}'`);
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    // Reinstated: both cleared, active again.
    await set(`discontinued_at = NULL, discontinued_by = NULL, active = true`);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  it('0020 adds models.price_label and private_min_tier and the table shop_requests, and nothing else; down restores 0019 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withSalon, without: before } = await rollBackTo('0020_private_salon');
    // What 0020 adds names its columns or its table (PGlite's PostgreSQL also lists a NOT NULL as a constraint; PostgreSQL 16 does not).
    const of0020 = (o: string) => /price_label|private_min_tier|shop_requests/.test(o);
    const added = withSalon.filter((o) => !before.includes(o));
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table models price_label text YES ',
      'table models private_min_tier smallint NO 1',
      'table shop_requests account_id uuid NO ',
      'table shop_requests created_at timestamp with time zone NO now()',
      'table shop_requests handled_at timestamp with time zone YES ',
      'table shop_requests handled_by uuid YES ',
      'table shop_requests id uuid NO gen_random_uuid()',
      'table shop_requests model_id uuid NO ',
      'table shop_requests note text YES ',
      'table shop_requests resolution_note text YES ',
      "table shop_requests status text NO 'OPEN'::text",
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger shop_requests shop_requests_immutable_identity']);
    for (const c of [
      /^constraint models models_price_label_check CHECK \(\(\(length\(btrim\(price_label\)\) >= 1\) AND \(length\(btrim\(price_label\)\) <= 60\)\)\)$/,
      /^constraint models models_private_min_tier_check CHECK \(\(\(private_min_tier >= 1\) AND \(private_min_tier <= 3\)\)\)$/,
      /^constraint shop_requests shop_requests_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint shop_requests shop_requests_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint shop_requests shop_requests_handled_by_fkey FOREIGN KEY \(handled_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint shop_requests shop_requests_closed CHECK /,
      /^constraint shop_requests shop_requests_handled CHECK /,
      /^constraint shop_requests shop_requests_resolution CHECK /,
      /^constraint shop_requests shop_requests_handled_after CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => !of0020(o))).toEqual([]);
    expect(before.filter(of0020)).toEqual([]);
    expect(withSalon.filter((o) => !of0020(o))).toEqual(before);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0020_private_salon'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0020: a model shown from TITANE by default, its price 1 to 60 characters; one open request per account and model, closed with its date, its identity and note fixed', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (26, 'Z', 'Salon test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string; price_label: string | null; private_min_tier: number }>`
      INSERT INTO models (category_id, name, type, sku_prefix) VALUES (26, 'S', 'RING', 'SALON') RETURNING id, price_label, private_min_tier`.execute(t.db)).rows[0];
    // A model inserted as the previous image inserts it: no price, from TITANE.
    expect([model.price_label, model.private_min_tier]).toEqual([null, 1]);
    const setModel = (sets: string) => sql.raw(`UPDATE models SET ${sets} WHERE id = '${model.id}'`).execute(t.db);
    for (const bad of [`price_label = '   '`, `price_label = '${'x'.repeat(61)}'`, `private_min_tier = 0`, `private_min_tier = 4`]) {
      await expect(setModel(bad), bad).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    await setModel(`price_label = '${'x'.repeat(60)}', private_min_tier = 3`);
    await setModel(`price_label = '€ 4 800', private_min_tier = 2`);

    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('salon@example.com', 'salon@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('salon@orbes.test', 'salon@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const insert = (note: string | null) =>
      sql<{ id: string; status: string }>`INSERT INTO shop_requests (account_id, model_id, note) VALUES (${account}, ${model.id}, ${note}) RETURNING id, status`.execute(t.db);
    await expect(insert('   ')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(insert('x'.repeat(501))).rejects.toSatisfy((e) => isCheckViolation(e));
    const first = (await insert('A size 52, please.')).rows[0];
    expect(first.status).toBe('OPEN');
    await expect(insert(null)).rejects.toSatisfy((e) => isUniqueViolation(e, 'shop_requests_one_open'));
    const setRequest = (sets: string, id = first.id) => sql.raw(`UPDATE shop_requests SET ${sets} WHERE id = '${id}'`).execute(t.db);
    // Closed without its date, a date while open, a closer without a date, a note while open, a date before its creation: refused.
    await expect(setRequest(`status = 'CLOSED'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'shop_requests_closed'));
    await expect(setRequest(`handled_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'shop_requests_closed'));
    await expect(setRequest(`resolution_note = 'Called.'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'shop_requests_resolution'));
    await expect(setRequest(`status = 'CLOSED', handled_at = created_at - interval '1 second'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'shop_requests_handled_after'));
    await expect(setRequest(`status = 'PENDING'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    // Its identity and its note never change.
    for (const sets of [`note = 'Another.'`, `model_id = '${model.id}', account_id = '${admin}'`, `created_at = now() + interval '1 day'`]) {
      await expect(setRequest(sets), sets).rejects.toSatisfy(isGuardViolation);
    }
    await setRequest(`status = 'CLOSED', handled_at = now(), handled_by = '${admin}', resolution_note = 'Called the client.'`);
    // Closed, another may follow; a lock closes one without a closer's note.
    const second = (await insert(null)).rows[0];
    await setRequest(`status = 'CLOSED', handled_at = now(), handled_by = '${admin}'`, second.id);
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await sql`DELETE FROM shop_requests WHERE account_id = ${account}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id = ${account}`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model.id}`.execute(t.db);
  });

  /** The columns 0021 adds to drops, and what names an object of 0021 in a snapshot. */
  const DROPS_0021 = [
    'access_collection_id', 'announce_at', 'board_token_hash', 'board_token_issued_at', 'currency', 'ended_at', 'ended_reason', 'live_min_tier', 'mode',
    'name_at', 'paused_at', 'paused_ms_total', 'pay_minutes', 'per_account', 'photo_at', 'price_minor', 'quantity_line', 'room_opens_minutes',
    'silhouette_at', 'silhouette_sha256', 'tier_priority', 'turn_seconds',
  ];
  const of0021 = (o: string) =>
    /\b(drop_sizes|live_entries|live_access_models|live_addons|live_entry_addons|live_interest|live_messages|live_tier_windows)\b/.test(o) ||
    DROPS_0021.some((c) => o.startsWith(`table drops ${c} `) || o.startsWith(`constraint drops drops_${c}_`)) ||
    /^constraint drops drops_(draw_fields|live_fields|live_stages|live_ended|live_paused|board_token) /.test(o) ||
    /^index CREATE (UNIQUE )?INDEX drops_(silhouette_sha256_idx|access_collection_id_idx|board_token_hash_key) /.test(o);

  it('0021 adds the LIVE RELEASE (drops\' mode and settings, the sizes, entries, access, add-ons, interest, messages, per-tier windows), and nothing else; down cancels the LIVE drops, withdraws their posts still to come, and restores 0020 exactly, and up again', async () => {
    const latest = await snapshot();
    // A LIVE drop published before the rollback: the previous image would read it as a draw, so the down step cancels it.
    await sql`INSERT INTO categories (id, code, name) VALUES (24, 'X', 'Live test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (24, 'L', 'RING', 'LIVEDOWN') RETURNING id`.execute(t.db)).rows[0].id;
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const live = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, early_access_hours, published_at,
                         mode, live_min_tier, tier_priority, room_opens_minutes, turn_seconds, pay_minutes, per_account, price_minor, currency, quantity_line)
      VALUES (${model}, 'Live', 1, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}, 0, now(),
              'LIVE', 0, true, 5, 30, 5, 1, 505000, 'EUR', '1 PIECE') RETURNING id`.execute(t.db)).rows[0].id;
    // Its posts of the circle: one shown already, one still to come (the previous image would show it at its time).
    const post = async (at: string) =>
      (await sql<{ id: string }>`INSERT INTO circle_posts (kind, title, body, drop_id, published_at) VALUES ('NOTE', 'LIVE RELEASE', 'The room opens.', ${live}, ${at}::timestamptz) RETURNING id`.execute(t.db)).rows[0].id;
    const shown = await post('2020-01-01T10:00:00Z');
    const coming = await post('2099-01-01T10:00:00Z');
    const { with: withLive, without: before } = await rollBackTo('0021_live_release');
    const added = withLive.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0021(o))).toEqual([]);
    expect(before.filter(of0021)).toEqual([]);
    expect(withLive.filter((o) => !of0021(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('drops')).toEqual(DROPS_0021);
    expect(added.filter((o) => o.startsWith('table drops '))).toContain("table drops mode text NO 'DRAW'::text");
    expect(added.filter((o) => o.startsWith('table drops '))).toContain('table drops paused_ms_total bigint NO 0');
    expect(columns('drop_sizes')).toEqual(['drop_id', 'id', 'label', 'position', 'stock']);
    expect(columns('live_entries')).toEqual([
      'account_id', 'confirmed_at', 'country', 'drop_id', 'ended_at', 'gesture_ms', 'handled_at', 'handled_by', 'hold_expires_at', 'id', 'joined_at', 'let_in_by',
      'network_hash', 'position', 'press_started_at', 'quantity', 'queued_at', 'removed_at', 'removed_by', 'resolution', 'resolution_note', 'secured_at', 'size_id',
      'status', 'tier', 'turn_at', 'turn_expires_at', 'turn_token_hash',
    ]);
    expect(columns('live_access_models')).toEqual(['drop_id', 'model_id']);
    expect(columns('live_addons')).toEqual(['drop_id', 'id', 'label', 'line', 'position', 'price_minor']);
    expect(columns('live_entry_addons')).toEqual(['addon_id', 'entry_id', 'price_minor']);
    expect(columns('live_interest')).toEqual(['account_id', 'created_at', 'drop_id', 'size_id']);
    expect(columns('live_messages')).toEqual(['created_at', 'created_by', 'drop_id', 'id', 'text']);
    expect(columns('live_tier_windows')).toEqual(['drop_id', 'pay_minutes', 'tier', 'turn_seconds']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger drop_sizes drop_sizes_immutable_identity',
      'trigger live_addons live_addons_immutable_identity',
      'trigger live_entries live_entries_immutable_identity',
      'trigger live_messages live_messages_immutable',
    ]);
    for (const c of [
      /^constraint drops drops_mode_check CHECK \(\(mode = ANY \(ARRAY\['DRAW'::text, 'LIVE'::text\]\)\)\)$/,
      /^constraint drops drops_ended_reason_check CHECK \(\(ended_reason = ANY \(ARRAY\['SOLD_OUT'::text, 'CLOSED'::text, 'ENDED'::text\]\)\)\)$/,
      /^constraint drops drops_draw_fields CHECK \(\(\(mode = 'LIVE'::text\) OR /,
      /^constraint drops drops_live_fields CHECK \(\(\(mode = 'DRAW'::text\) OR .*\(early_access_hours = 0\) AND \(drawn_at IS NULL\)\)\)\)$/,
      /^constraint drops drops_live_stages CHECK /,
      /^constraint drops drops_live_ended CHECK /,
      /^constraint drops drops_board_token CHECK \(\(\(board_token_hash IS NULL\) = \(board_token_issued_at IS NULL\)\)\)$/,
      /^constraint drops drops_silhouette_sha256_fkey FOREIGN KEY \(silhouette_sha256\) REFERENCES media_objects\(sha256\) ON DELETE RESTRICT$/,
      /^constraint drops drops_access_collection_id_fkey FOREIGN KEY \(access_collection_id\) REFERENCES collections\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_sizes drop_sizes_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint live_entries live_entries_size_fkey FOREIGN KEY \(drop_id, size_id\) REFERENCES drop_sizes\(drop_id, id\) ON DELETE RESTRICT$/,
      /^constraint live_entries live_entries_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint live_entries live_entries_status_check CHECK \(\(status = ANY \(ARRAY\['WAITING'::text, 'QUEUED'::text, 'TURN'::text, 'SECURED'::text, 'CONFIRMED'::text, 'MISSED'::text, 'EXPIRED'::text, 'RELEASED'::text, 'LEFT'::text, 'REMOVED'::text, 'ENDED'::text\]\)\)\)$/,
      /^constraint live_entries live_entries_gesture_ms_check CHECK \(\(gesture_ms >= 1400\)\)$/,
      /^constraint live_interest live_interest_size_fkey FOREIGN KEY \(drop_id, size_id\) REFERENCES drop_sizes\(drop_id, id\) ON DELETE RESTRICT$/,
      /^constraint live_entry_addons live_entry_addons_entry_id_fkey FOREIGN KEY \(entry_id\) REFERENCES live_entries\(id\) ON DELETE RESTRICT$/,
      /^constraint live_entry_addons live_entry_addons_addon_id_fkey FOREIGN KEY \(addon_id\) REFERENCES live_addons\(id\) ON DELETE RESTRICT$/,
      /^constraint live_messages live_messages_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint live_tier_windows live_tier_windows_some CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    for (const status of ['waiting', 'queued', 'turn', 'secured', 'confirmed', 'missed', 'returned', 'left', 'removed']) {
      expect(added.some((o) => o.startsWith(`constraint live_entries live_entries_status_${status} CHECK `)), status).toBe(true);
    }
    expect((await sql<{ cancelled: boolean }>`SELECT cancelled_at IS NOT NULL AS cancelled FROM drops WHERE id = ${live}`.execute(t.db)).rows[0].cancelled).toBe(true);
    const posts = (await sql<{ id: string; published_at: Date | null }>`SELECT id, published_at FROM circle_posts WHERE drop_id = ${live}`.execute(t.db)).rows;
    expect(new Map(posts.map((p) => [p.id, p.published_at?.toISOString() ?? null]))).toEqual(new Map([[shown, '2020-01-01T10:00:00.000Z'], [coming, null]]));
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0021_live_release'));
    expect(await snapshot()).toEqual(latest);
    // Up again, it is a DRAW (cancelled): the LIVE settings went with the down step.
    expect((await sql<{ mode: string }>`SELECT mode FROM drops WHERE id = ${live}`.execute(t.db)).rows[0].mode).toBe('DRAW');
    await sql`DELETE FROM circle_posts WHERE drop_id = ${live}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${live}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
  });

  it('0021: a LIVE drop has every setting and no draw, a DRAW none; stages in order before the room; an end with its reason; sizes, entries, interest and add-ons of their own drop, each status with its columns; a message never changes', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (24, 'X', 'Live test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (24, 'L', 'RING', 'LIVECHK') RETURNING id`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('live@example.com', 'live@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const other = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('live2@example.com', 'live2@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('live@orbes.test', 'live@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const sealed = `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`;
    const LIVE: Record<string, unknown> = {
      mode: 'LIVE', live_min_tier: 0, tier_priority: true, room_opens_minutes: 5, turn_seconds: 30, pay_minutes: 5, per_account: 1, price_minor: 505000,
      currency: 'EUR', quantity_line: '25 PIECES', early_access_hours: 0,
    };
    const insert = (v: Record<string, unknown>) => {
      const cols = { model_id: model, title: 'Live', quantity: 25, opens_at: '2026-12-01T10:00:00Z', closes_at: '2026-12-01T11:00:00Z', seed_enc: sealed, seed_hash: seedHash, ...v };
      return sql<{ id: string; mode: string; paused_ms_total: number; live_min_tier: number | null }>`
        INSERT INTO drops (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id, mode, paused_ms_total, live_min_tier`.execute(t.db);
    };
    // As the previous image inserts a drop: a DRAW, nothing of a LIVE RELEASE.
    const draw = (await insert({})).rows[0];
    expect([draw.mode, draw.paused_ms_total, draw.live_min_tier]).toEqual(['DRAW', 0, null]);
    for (const [k, v] of Object.entries({ live_min_tier: 0, tier_priority: true, quantity_line: '1', announce_at: '2026-11-30T10:00:00Z', ended_at: '2026-12-01T11:00:00Z', paused_ms_total: 1 })) {
      await expect(insert({ [k]: v }), k).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_draw_fields'));
    }
    // A LIVE drop: every setting, no early access, never drawn.
    const ok = (await insert(LIVE)).rows[0];
    expect(ok.mode).toBe('LIVE');
    for (const k of ['live_min_tier', 'tier_priority', 'room_opens_minutes', 'turn_seconds', 'pay_minutes', 'per_account', 'price_minor', 'currency', 'quantity_line']) {
      await expect(insert({ ...LIVE, [k]: null }), k).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_fields'));
    }
    await expect(insert({ ...LIVE, early_access_hours: 48 })).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_fields'));
    await expect(insert({ ...LIVE, mode: 'AUCTION' })).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const [k, v] of Object.entries({ live_min_tier: 4, room_opens_minutes: 61, turn_seconds: 9, pay_minutes: 0, per_account: 6, price_minor: -1, currency: 'eur', quantity_line: ' ' })) {
      await expect(insert({ ...LIVE, [k]: v }), k).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    await expect(insert({ ...LIVE, quantity_line: 'x'.repeat(41) })).rejects.toSatisfy((e) => isCheckViolation(e));
    // The stages in order (a NULL stage is the announcement), all before the room opens (T0 − 5 min).
    for (const bad of [
      { announce_at: '2026-11-30T12:00:00Z', silhouette_at: '2026-11-30T11:00:00Z' },
      { silhouette_at: '2026-11-30T12:00:00Z', name_at: '2026-11-30T11:00:00Z' },
      { announce_at: '2026-11-30T10:00:00Z', silhouette_at: '2026-11-30T12:00:00Z' },
      { name_at: '2026-11-30T12:00:00Z', photo_at: '2026-11-30T11:00:00Z' },
      { photo_at: '2026-12-01T09:55:00.001Z' },
    ]) {
      await expect(insert({ ...LIVE, ...bad }), JSON.stringify(bad)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_stages'));
    }
    await insert({ ...LIVE, announce_at: '2026-11-28T10:00:00Z', silhouette_at: '2026-11-29T10:00:00Z', name_at: '2026-11-30T10:00:00Z', photo_at: '2026-12-01T09:55:00Z' });
    await insert({ ...LIVE, announce_at: '2026-11-28T10:00:00Z', photo_at: '2026-11-29T10:00:00Z' });
    // The end with its reason, once published; a pause once published; the board's link, its hash unique.
    const set = (sets: string, id = ok.id) => sql.raw(`UPDATE drops SET ${sets} WHERE id = '${id}'`).execute(t.db);
    await expect(set(`ended_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_ended'));
    await expect(set(`ended_at = now(), ended_reason = 'ENDED'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_ended'));
    await expect(set(`paused_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_live_paused'));
    await set(`published_at = '2026-11-28T10:00:00Z'`);
    await expect(set(`ended_at = now(), ended_reason = 'GONE'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await set(`paused_at = now(), paused_ms_total = 1500`);
    await expect(set(`board_token_hash = '\\x00'::bytea, board_token_issued_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(set(`board_token_hash = sha256('x')`)).rejects.toSatisfy((e) => isCheckViolation(e, 'drops_board_token'));
    await set(`board_token_hash = sha256('x'), board_token_issued_at = now()`);
    const second = (await insert(LIVE)).rows[0];
    await expect(set(`board_token_hash = sha256('x'), board_token_issued_at = now()`, second.id)).rejects.toSatisfy((e) => isUniqueViolation(e, 'drops_board_token_hash_key'));

    // Sizes: a label of 1 to 12 characters, trimmed, unique per drop; positions 1 to 24; stock ≥ 0; never moved to another drop.
    const size = (dropId: string, label: string, position: number, stock = 2) =>
      sql<{ id: string }>`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES (${dropId}, ${label}, ${position}, ${stock}) RETURNING id`.execute(t.db);
    for (const [label, position, stock] of [['', 1, 1], ['x'.repeat(13), 1, 1], [' 52', 1, 1], ['52', 0, 1], ['52', 25, 1], ['52', 1, -1]] as const) {
      await expect(size(ok.id, label, position, stock), `${label} ${position} ${stock}`).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const s52 = (await size(ok.id, '52', 1)).rows[0].id;
    await expect(size(ok.id, '52', 2)).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_sizes_label_key'));
    await expect(size(ok.id, '54', 1)).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_sizes_position_key'));
    const elsewhere = (await size(second.id, '52', 1)).rows[0].id;
    await expect(sql`UPDATE drop_sizes SET drop_id = ${second.id} WHERE id = ${s52}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);

    // Entries: a size of their own drop, one per account, a place unique per drop, each status with its columns.
    const entry = (sets: Record<string, unknown>) => {
      const cols = { drop_id: ok.id, account_id: account, size_id: s52, quantity: 1, tier: 0, ...sets };
      return sql<{ id: string; status: string }>`INSERT INTO live_entries (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id, status`.execute(t.db);
    };
    await expect(entry({ size_id: elsewhere })).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    for (const bad of [{ quantity: 0 }, { quantity: 6 }, { tier: 4 }, { country: 'fr' }, { network_hash: new Uint8Array(31) }, { status: 'PAID' }]) {
      await expect(entry(bad), JSON.stringify(bad)).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const e1 = (await entry({ country: 'FR', network_hash: new Uint8Array(32) })).rows[0];
    expect(e1.status).toBe('WAITING');
    await expect(entry({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'live_entries_drop_account_key'));
    const upd = (sets: string, id = e1.id) => sql.raw(`UPDATE live_entries SET ${sets} WHERE id = '${id}'`).execute(t.db);
    const T = `joined_at + interval '1 minute'`;
    const cases: [string, string][] = [
      [`position = 1`, 'live_entries_line'],
      [`ended_at = now()`, 'live_entries_status_waiting'],
      [`status = 'QUEUED'`, 'live_entries_status_queued'],
      [`status = 'QUEUED', position = 1, queued_at = joined_at - interval '1 second'`, 'live_entries_line'],
      [`status = 'TURN', position = 1, queued_at = joined_at`, 'live_entries_status_turn'],
      [`status = 'TURN', position = 1, queued_at = joined_at, turn_at = ${T}, turn_expires_at = ${T} + interval '30 seconds'`, 'live_entries_turn_fields'],
      [`status = 'TURN', position = 1, queued_at = joined_at, turn_at = ${T}, turn_expires_at = ${T}, turn_token_hash = sha256('t')`, 'live_entries_turn_fields'],
      [`status = 'MISSED', position = 1, queued_at = joined_at, turn_at = ${T}, turn_expires_at = ${T} + interval '30 seconds', turn_token_hash = sha256('t')`, 'live_entries_status_missed'],
      [`status = 'LEFT'`, 'live_entries_status_left'],
      [`status = 'REMOVED', ended_at = now()`, 'live_entries_status_removed'],
      [`status = 'REMOVED', removed_at = now(), ended_at = now() + interval '1 second'`, 'live_entries_removed_fields'],
      [`status = 'CONFIRMED'`, 'live_entries_status_confirmed'],
      [`let_in_by = '${admin}'`, 'live_entries_let_in_turn'],
      [`resolution = 'CONCLUDED', handled_at = now()`, 'live_entries_handled_fields'],
      [`press_started_at = now()`, 'live_entries_press_after_turn'],
    ];
    for (const [sets, constraint] of cases) await expect(upd(sets), sets).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    // Into the line, its turn, the seal held 1.4 s at least, confirmed, concluded by Client Services.
    await upd(`status = 'QUEUED', position = 1, queued_at = joined_at`);
    const e2 = (await entry({ account_id: other, status: 'QUEUED', position: 2, queued_at: new Date(Date.now() + 1000) })).rows[0];
    await expect(upd(`position = 1`, e2.id)).rejects.toSatisfy((e) => isUniqueViolation(e, 'live_entries_drop_position_key'));
    await upd(`status = 'TURN', turn_at = ${T}, turn_expires_at = ${T} + interval '30 seconds', turn_token_hash = sha256('t'), press_started_at = ${T}`);
    const held = `secured_at = ${T} + interval '2 seconds', hold_expires_at = ${T} + interval '5 minutes'`;
    await expect(upd(`status = 'SECURED', ${held}, gesture_ms = 1399`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(upd(`status = 'SECURED', ${held}`)).rejects.toSatisfy((e) => isCheckViolation(e, 'live_entries_secured_fields'));
    await expect(upd(`status = 'SECURED', secured_at = ${T} - interval '1 second', hold_expires_at = ${T} + interval '5 minutes', gesture_ms = 1500`)).rejects.toSatisfy((e) =>
      isCheckViolation(e),
    );
    await upd(`status = 'SECURED', ${held}, gesture_ms = 2000`);
    await expect(upd(`status = 'ENDED', ended_at = now() + interval '1 hour'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'live_entries_status_left'));
    await upd(`status = 'CONFIRMED', confirmed_at = ${T} + interval '1 minute'`);
    await expect(upd(`resolution = 'REFUNDED', handled_at = now()`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(upd(`resolution_note = 'Called.'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'live_entries_handled_fields'));
    await expect(upd(`resolution = 'CONCLUDED', handled_at = now(), resolution_note = '${'x'.repeat(501)}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await upd(`resolution = 'CONCLUDED', handled_at = now() + interval '2 hours', handled_by = '${admin}', resolution_note = 'Concluded by phone.'`);
    await expect(upd(`account_id = '${other}'`)).rejects.toSatisfy(isGuardViolation);
    await upd(`status = 'REMOVED', removed_by = '${admin}', removed_at = now() + interval '3 minutes', ended_at = now() + interval '3 minutes'`, e2.id);

    // Interest: a size of its own drop, one per account and drop. Add-ons: 1 to 6, each once per entry.
    const interest = (sizeId: string) => sql`INSERT INTO live_interest (drop_id, account_id, size_id) VALUES (${ok.id}, ${account}, ${sizeId})`.execute(t.db);
    await expect(interest(elsewhere)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await interest(s52);
    await expect(interest(s52)).rejects.toSatisfy((e) => isUniqueViolation(e));
    const addon = (label: string, position: number, price = 1500) =>
      sql<{ id: string }>`INSERT INTO live_addons (drop_id, label, price_minor, position) VALUES (${ok.id}, ${label}, ${price}, ${position}) RETURNING id`.execute(t.db);
    for (const [label, position, price] of [['', 1, 1], ['x'.repeat(41), 1, 1], ['GIFT BOX', 7, 1], ['GIFT BOX', 1, -1]] as const) {
      await expect(addon(label, position, price)).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const box = (await addon('GIFT BOX', 1)).rows[0].id;
    await expect(addon('ENGRAVING', 1)).rejects.toSatisfy((e) => isUniqueViolation(e, 'live_addons_position_key'));
    await sql`INSERT INTO live_entry_addons (entry_id, addon_id, price_minor) VALUES (${e1.id}, ${box}, 1500)`.execute(t.db);
    await expect(sql`INSERT INTO live_entry_addons (entry_id, addon_id, price_minor) VALUES (${e1.id}, ${box}, 1500)`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e));

    // Messages: one line of 1 to 140 characters, never changed. Per-tier windows: one of the two at least, within bounds.
    const message = (text: string) => sql<{ id: string }>`INSERT INTO live_messages (drop_id, text, created_by) VALUES (${ok.id}, ${text}, ${admin}) RETURNING id`.execute(t.db);
    await expect(message('  ')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(message('x'.repeat(141))).rejects.toSatisfy((e) => isCheckViolation(e));
    const m = (await message('The room opens in five minutes.')).rows[0].id;
    await expect(sql`UPDATE live_messages SET text = 'Changed' WHERE id = ${m}`.execute(t.db)).rejects.toSatisfy(isGuardViolation);
    const window = (tier: number, turn: number | null, pay: number | null) =>
      sql`INSERT INTO live_tier_windows (drop_id, tier, turn_seconds, pay_minutes) VALUES (${ok.id}, ${tier}, ${turn}, ${pay})`.execute(t.db);
    await expect(window(3, null, null)).rejects.toSatisfy((e) => isCheckViolation(e, 'live_tier_windows_some'));
    for (const [tier, turn, pay] of [[4, 30, null], [3, 9, null], [3, null, 61]] as const) await expect(window(tier, turn, pay)).rejects.toSatisfy((e) => isCheckViolation(e));
    await window(3, null, 10);
    await expect(window(3, 60, null)).rejects.toSatisfy((e) => isUniqueViolation(e));

    // Everything a release holds keeps it, and its console users and accounts, from being deleted.
    await expect(sql`DELETE FROM drops WHERE id = ${ok.id}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    for (const table of ['live_tier_windows', 'live_entry_addons', 'live_interest']) await sql`DELETE FROM ${sql.table(table)}`.execute(t.db);
    await sql`DELETE FROM live_messages WHERE drop_id = ${ok.id}`.execute(t.db);
    await sql`DELETE FROM live_addons WHERE drop_id = ${ok.id}`.execute(t.db);
    await sql`DELETE FROM live_entries WHERE drop_id = ${ok.id}`.execute(t.db);
    await sql`DELETE FROM drop_sizes`.execute(t.db);
    await sql`DELETE FROM drops WHERE model_id = ${model}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id IN (${account}, ${other})`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
  });

  /** The tables 0022 adds, and what names an object of 0022 in a snapshot (the status CHECK of products: its RESERVED form). */
  const TABLES_0022 = [
    'bench_items', 'carriers', 'event_journal', 'invoices', 'order_alert_settings', 'order_events', 'orders', 'returns', 'sku_thresholds', 'skus', 'stock_locations',
    'stock_movements',
  ];
  const statusCheck = (o: string) => o.startsWith('constraint products products_status_check ');
  const of0022 = (o: string) =>
    new RegExp(`\\b(${TABLES_0022.join('|')})\\b`).test(o) ||
    /^table (products|drop_sizes) sku_id |^table drops stock_location_id |^table shop_requests outcome |^table models (base_price_minor|base_currency|care_guide) |^table accounts shopify_customer_id /.test(o) ||
    /^constraint (accounts accounts_shopify_customer_(id_check|key)|products products_reserved|drop_sizes drop_sizes_sku_id_fkey|drops drops_stock_location_id_fkey|shop_requests shop_requests_outcome_(check|closed)|models models_(base_price|base_price_minor_check|base_currency_check|care_guide_check)) /.test(o) ||
    (statusCheck(o) && o.includes("'RESERVED'")) ||
    /^index CREATE INDEX (products_sku_id_idx|drop_sizes_sku_id_idx|drops_stock_location_id_idx) |^index CREATE UNIQUE INDEX accounts_shopify_customer_key /.test(o);

  it('0022 adds the stock, the orders and the journal (twelve tables, the SKUs of pieces and sizes, RESERVED, the salon\'s outcome, a model\'s base price and care guide, a release\'s location), and nothing else; down retires the identities still RESERVED and restores 0021 exactly, and up again', async () => {
    const latest = await snapshot();
    // At 0022: an identity RESERVED for a piece to make, in its SKU, and a movement of the ledger.
    await sql`INSERT INTO categories (id, code, name) VALUES (23, 'W', 'Stock test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (23, 'S', 'RING', 'STOCKDOWN') RETURNING id`.execute(t.db)).rows[0].id;
    const sku = (await sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, '52', 'STOCKDOWN-52') RETURNING id`.execute(t.db)).rows[0].id;
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name, is_default) VALUES ('DOWN WAREHOUSE', true) RETURNING id`.execute(t.db)).rows[0].id;
    const reserved = (await sql<{ id: string }>`
      INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, variant, material, status, sku_id)
      VALUES ('O26-W-00001', ${(26 << 25) | (23 << 20) | 1}, 2026, 23, 1, 'STOCKDOWN-52', ${model}, '52', '925 STERLING SILVER', 'RESERVED', ${sku}) RETURNING id`.execute(t.db)).rows[0].id;
    await sql`INSERT INTO stock_movements (sku_id, location_id, delta, reason, actor_type) VALUES (${sku}, ${location}, 3, 'ADJUSTED', 'system')`.execute(t.db);
    const { with: withStock, without: before } = await rollBackTo('0022_orders_stock');
    const added = withStock.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0022(o))).toEqual([]);
    expect(before.filter(of0022)).toEqual([]);
    // Nothing else changed, but the status CHECK of products, which gains RESERVED.
    expect(withStock.filter((o) => !of0022(o))).toEqual(before.filter((o) => !statusCheck(o)));
    expect(before.filter(statusCheck)).toEqual([
      "constraint products products_status_check CHECK ((status = ANY (ARRAY['ISSUED'::text, 'ACTIVATED'::text, 'REGISTERED'::text, 'OWNED'::text, 'TRANSFERRED'::text, 'SERVICED'::text, 'RESOLD'::text, 'RETIRED'::text, 'REVOKED'::text, 'COUNTERFEIT_FLAGGED'::text, 'LOST'::text, 'STOLEN'::text])))",
    ]);
    expect(withStock.filter(statusCheck)).toEqual([
      "constraint products products_status_check CHECK ((status = ANY (ARRAY['RESERVED'::text, 'ISSUED'::text, 'ACTIVATED'::text, 'REGISTERED'::text, 'OWNED'::text, 'TRANSFERRED'::text, 'SERVICED'::text, 'RESOLD'::text, 'RETIRED'::text, 'REVOKED'::text, 'COUNTERFEIT_FLAGGED'::text, 'LOST'::text, 'STOLEN'::text])))",
    ]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('products')).toEqual(['sku_id']);
    expect(columns('drop_sizes')).toEqual(['sku_id']);
    expect(columns('drops')).toEqual(['stock_location_id']);
    expect(columns('shop_requests')).toEqual(['outcome']);
    expect(columns('models')).toEqual(['base_currency', 'base_price_minor', 'care_guide']);
    expect(columns('accounts')).toEqual(['shopify_customer_id']);
    expect(columns('stock_locations')).toEqual(['created_at', 'id', 'is_default', 'name', 'shopify_location_id']);
    expect(columns('skus')).toEqual(['code', 'created_at', 'id', 'model_id', 'shopify_product_id', 'shopify_variant_id', 'size_label']);
    expect(columns('stock_movements')).toEqual(['actor_id', 'actor_type', 'created_at', 'delta', 'id', 'location_id', 'note', 'order_id', 'product_id', 'reason', 'sku_id', 'transfer_id']);
    expect(columns('sku_thresholds')).toEqual(['location_id', 'minimum', 'sku_id', 'updated_at', 'updated_by']);
    expect(columns('carriers')).toEqual(['active', 'created_at', 'id', 'name', 'tracking_url']);
    expect(columns('orders')).toEqual([
      'account_id', 'addons', 'buyer_address', 'buyer_name', 'cancelled_at', 'carrier_id', 'channel', 'currency', 'declared_value_minor', 'delivered_at', 'drop_entry_id',
      'drop_id', 'engraving_text', 'id', 'live_entry_id', 'location_id', 'model_id', 'paid_at', 'piece', 'price_minor', 'product_id', 'reservation', 'reserved_at',
      'returned_at', 'shipped_at', 'shop_request_id', 'shopify_order_id', 'size_label', 'sku_id', 'status', 'surprise', 'tracking_number',
    ]);
    expect(columns('order_events')).toEqual(['action', 'actor_id', 'actor_type', 'created_at', 'details', 'id', 'note', 'order_id', 'status']);
    expect(columns('bench_items')).toEqual([
      'cancelled_at', 'created_at', 'done_at', 'drop_id', 'engraving_text', 'id', 'location_id', 'order_id', 'product_id', 'sku_id', 'started_at', 'status', 'surprise',
    ]);
    expect(columns('returns')).toEqual(['created_at', 'created_by', 'id', 'location_id', 'note', 'order_id', 'outcome', 'ownership_id']);
    expect(columns('invoices')).toEqual([
      'buyer', 'credits_invoice_id', 'currency', 'id', 'issued_at', 'issuer', 'kind', 'lines', 'order_id', 'sequence', 'subtotal_minor', 'total_minor', 'vat_minor',
      'vat_rate_bp', 'year',
    ]);
    expect(columns('event_journal')).toEqual(['consumed_by', 'created_at', 'entity_id', 'entity_type', 'id', 'payload', 'type']);
    expect(columns('order_alert_settings')).toEqual(['id', 'ready_days', 'reserved_days', 'shipped_days', 'unregistered_days', 'updated_at', 'updated_by']);
    expect(added.filter((o) => o.startsWith('table order_alert_settings ')).map((o) => o.split(' ').slice(2).join(' '))).toEqual(
      expect.arrayContaining(['reserved_days smallint NO 2', 'ready_days smallint NO 3', 'shipped_days smallint NO 10', 'unregistered_days smallint NO 30']),
    );
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger bench_items bench_items_immutable_identity',
      'trigger carriers carriers_immutable_identity',
      'trigger event_journal event_journal_immutable',
      'trigger event_journal event_journal_no_delete',
      'trigger invoices invoices_immutable',
      'trigger order_events order_events_append_only',
      'trigger orders orders_immutable_identity',
      'trigger returns returns_immutable',
      'trigger skus skus_immutable_identity',
      'trigger stock_locations stock_locations_immutable_identity',
      'trigger stock_movements stock_movements_append_only',
    ]);
    for (const c of [
      /^constraint products products_sku_fkey FOREIGN KEY \(model_id, sku_id\) REFERENCES skus\(model_id, id\) ON DELETE RESTRICT$/,
      /^constraint products products_reserved CHECK \(\(\(status <> 'RESERVED'::text\) OR \(claim_secret_hash IS NULL\)\)\)$/,
      /^constraint drop_sizes drop_sizes_sku_id_fkey FOREIGN KEY \(sku_id\) REFERENCES skus\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_stock_location_id_fkey FOREIGN KEY \(stock_location_id\) REFERENCES stock_locations\(id\) ON DELETE RESTRICT$/,
      /^constraint shop_requests shop_requests_outcome_check CHECK \(\(outcome = ANY \(ARRAY\['ACCEPTED'::text, 'DECLINED'::text\]\)\)\)$/,
      /^constraint accounts accounts_shopify_customer_id_check CHECK \(\(shopify_customer_id ~ '\^\[1-9\]\[0-9\]\{0,19\}\$'::text\)\)$/,
      /^constraint accounts accounts_shopify_customer_key UNIQUE \(shopify_customer_id\)$/,
      /^constraint orders orders_sku_fkey FOREIGN KEY \(model_id, sku_id\) REFERENCES skus\(model_id, id\) ON DELETE RESTRICT$/,
      /^constraint orders orders_status_check CHECK \(\(status = ANY \(ARRAY\['RESERVED'::text, 'PAID'::text, 'SHIPPED'::text, 'DELIVERED'::text, 'CANCELLED'::text, 'RETURNED'::text\]\)\)\)$/,
      /^constraint orders orders_channel_check CHECK \(\(channel = ANY \(ARRAY\['LIVE'::text, 'DRAW'::text, 'SALON'::text\]\)\)\)$/,
      /^constraint orders orders_live_entry_id_fkey FOREIGN KEY \(live_entry_id\) REFERENCES live_entries\(id\) ON DELETE RESTRICT$/,
      /^constraint orders orders_drop_entry_id_fkey FOREIGN KEY \(drop_entry_id\) REFERENCES drop_entries\(id\) ON DELETE RESTRICT$/,
      /^constraint orders orders_shop_request_id_fkey FOREIGN KEY \(shop_request_id\) REFERENCES shop_requests\(id\) ON DELETE RESTRICT$/,
      /^constraint stock_movements stock_movements_reason_check CHECK \(\(reason = ANY \(ARRAY\['PRODUCED'::text, 'ADJUSTED'::text, 'TRANSFER_OUT'::text, 'TRANSFER_IN'::text, 'SHIPPED'::text, 'RETURNED'::text\]\)\)\)$/,
      /^constraint bench_items bench_items_status_check CHECK \(\(status = ANY \(ARRAY\['TO_MAKE'::text, 'IN_PROGRESS'::text, 'DONE'::text, 'CANCELLED'::text\]\)\)\)$/,
      /^constraint invoices invoices_kind_check CHECK \(\(kind = ANY \(ARRAY\['INVOICE'::text, 'CREDIT_NOTE'::text\]\)\)\)$/,
      /^constraint invoices invoices_credits_invoice_id_fkey FOREIGN KEY \(credits_invoice_id\) REFERENCES invoices\(id\) ON DELETE RESTRICT$/,
      /^constraint returns returns_outcome_check CHECK \(\(outcome = ANY \(ARRAY\['RESTOCKED'::text, 'ARCHIVED'::text\]\)\)\)$/,
      /^constraint returns returns_ownership_id_fkey FOREIGN KEY \(ownership_id\) REFERENCES ownership\(id\) ON DELETE RESTRICT$/,
      /^constraint returns returns_ownership_key UNIQUE \(ownership_id\)$/,
      /^constraint order_alert_settings order_alert_settings_id_check CHECK \(\(id = 1\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    for (const status of ['reserved', 'paid', 'shipped', 'delivered', 'cancelled', 'returned']) {
      expect(added.some((o) => o.startsWith(`constraint orders orders_status_${status} CHECK `)), status).toBe(true);
    }
    // Down: the identity still RESERVED is retired (the previous image has no RESERVED), its history started there.
    expect((await sql<{ status: string }>`SELECT status FROM products WHERE id = ${reserved}`.execute(t.db)).rows[0].status).toBe('RETIRED');
    expect((await sql<{ from_status: string | null; to_status: string; actor_type: string; reason: string }>`
      SELECT from_status, to_status, actor_type, reason FROM product_status_history WHERE product_id = ${reserved}`.execute(t.db)).rows).toEqual([
      { from_status: null, to_status: 'RETIRED', actor_type: 'system', reason: 'Reserved identity retired: migration 0022 rolled back' },
    ]);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0022_orders_stock'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0022: locations, SKUs and Shopify customers unique, one default; a RESERVED identity unclaimable and never in the history; each order\'s source, price, holding, steps and shipment consistent, its identity fixed; the ledger, the events, the returns, the invoices and the journal append-only (the journal\'s readers aside); one settings row', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (22, 'V', 'Orders test') ON CONFLICT DO NOTHING`.execute(t.db);
    const modelOf = async (prefix: string) => (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (22, 'O', 'RING', ${prefix}) RETURNING id`.execute(t.db)).rows[0].id;
    const model = await modelOf('ORDCHK');
    const other = await modelOf('ORDCHK2');
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('orders@example.com', 'orders@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('orders@orbes.test', 'orders@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const run = (q: string) => sql.raw(q).execute(t.db);

    // Locations: a trimmed name, unique whatever the case; one default at most; a Shopify id in decimal, unique.
    const location = (name: string, extra = '') =>
      sql.raw<{ id: string }>(`INSERT INTO stock_locations (name${extra ? ', is_default, shopify_location_id' : ''}) VALUES ('${name}'${extra}) RETURNING id`).execute(t.db);
    for (const bad of [' PARIS', '', 'x'.repeat(61)]) await expect(location(bad), bad).rejects.toSatisfy((e) => isCheckViolation(e));
    const paris = (await location('PARIS STOCK', `, true, '7012345'`)).rows[0].id;
    await expect(location('paris stock')).rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_locations_name_key'));
    await expect(location('LONDON STOCK', `, true, NULL`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_locations_one_default'));
    await expect(location('LONDON STOCK', `, false, '7012345'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_locations_shopify_key'));
    await expect(location('LONDON STOCK', `, false, 'gid://shopify/Location/1'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    const london = (await location('LONDON STOCK')).rows[0].id;
    await run(`UPDATE stock_locations SET name = 'LONDON VAULT' WHERE id = '${london}'`);
    await expect(run(`UPDATE stock_locations SET created_at = now() + interval '1 day' WHERE id = '${london}'`)).rejects.toSatisfy(isGuardViolation);

    // SKUs: one per model and size whatever its case, one size (NULL) once too; a code of the SKU grammar, unique; its model and size fixed.
    const skuOf = (modelId: string, size: string | null, code: string) =>
      sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${modelId}, ${size}, ${code}) RETURNING id`.execute(t.db);
    const s52 = (await skuOf(model, '52', 'ORDCHK-52')).rows[0].id;
    const one = (await skuOf(model, null, 'ORDCHK')).rows[0].id;
    await expect(skuOf(model, '52', 'ORDCHK-52B')).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_model_size_key'));
    const small = (await skuOf(model, 'Small', 'ORDCHK-S')).rows[0].id;
    await expect(skuOf(model, 'SMALL', 'ORDCHK-S2')).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_model_size_key'));
    await run(`DELETE FROM skus WHERE id = '${small}'`);
    await expect(skuOf(model, null, 'ORDCHK-ONE')).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_model_size_key'));
    await expect(skuOf(model, '54', 'ORDCHK-52')).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_code_key'));
    for (const [size, code] of [[' 54', 'ORDCHK-54'], ['54', '-ORDCHK-54'], ['54', 'ORDCHK<54>']] as const) {
      await expect(skuOf(model, size, code), `${size} ${code}`).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const otherSku = (await skuOf(other, '52', 'ORDCHK2-52')).rows[0].id;
    await expect(run(`UPDATE skus SET size_label = '54' WHERE id = '${s52}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE skus SET shopify_product_id = '8001', shopify_variant_id = '9001' WHERE id = '${s52}'`);
    await expect(run(`UPDATE skus SET shopify_variant_id = '9001' WHERE id = '${one}'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_shopify_variant_key'));

    // An account's Shopify customer: decimal, one account each.
    const customer = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('customer@example.com', 'customer@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    await run(`UPDATE accounts SET shopify_customer_id = '6001' WHERE id = '${account}'`);
    await expect(run(`UPDATE accounts SET shopify_customer_id = '6001' WHERE id = '${customer}'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'accounts_shopify_customer_key'));
    await expect(run(`UPDATE accounts SET shopify_customer_id = 'gid://shopify/Customer/1' WHERE id = '${customer}'`)).rejects.toSatisfy((e) => isCheckViolation(e));

    // A piece of its model's SKU only; RESERVED never claimable, never written in the history.
    let serial = 0;
    const piece = (sets: Record<string, unknown>) => {
      serial++;
      const cols = {
        product_id: `O26-V-${String(serial).padStart(5, '0')}`, packed_identity: (26 << 25) | (22 << 20) | serial, year: 2026, category_id: 22, serial, sku: 'ORDCHK-52',
        model_id: model, variant: '52', material: '925 STERLING SILVER', ...sets,
      };
      return sql<{ id: string }>`INSERT INTO products (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id`.execute(t.db);
    };
    await expect(piece({ sku_id: otherSku })).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'products_sku_fkey'));
    await expect(piece({ status: 'RESERVED', claim_secret_hash: 'scrypt$x' })).rejects.toSatisfy((e) => isCheckViolation(e, 'products_reserved'));
    const reservedPiece = (await piece({ status: 'RESERVED', sku_id: s52 })).rows[0].id;
    const issuedPiece = (await piece({ sku_id: s52 })).rows[0].id;
    await expect(sql`INSERT INTO product_status_history (product_id, from_status, to_status, actor_type) VALUES (${reservedPiece}, NULL, 'RESERVED', 'system')`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));

    // Carriers: an https link with {tracking}, a name unique whatever the case.
    const carrier = (name: string, url: string) => sql<{ id: string }>`INSERT INTO carriers (name, tracking_url) VALUES (${name}, ${url}) RETURNING id`.execute(t.db);
    for (const url of ['http://track.example/{tracking}', 'https://track.example/', 'https://track example/{tracking}']) {
      await expect(carrier('Courier', url), url).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const courier = (await carrier('Courier', 'https://track.example/{tracking}')).rows[0].id;
    await expect(carrier('COURIER', 'https://track.example/{tracking}')).rejects.toSatisfy((e) => isUniqueViolation(e, 'carriers_name_key'));

    // Orders: a request of the salon closed as ACCEPTED is the source of one; its outcome only once closed.
    const request = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id) VALUES (${account}, ${model}) RETURNING id`.execute(t.db)).rows[0].id;
    await expect(run(`UPDATE shop_requests SET outcome = 'ACCEPTED' WHERE id = '${request}'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'shop_requests_outcome_closed'));
    await expect(run(`UPDATE shop_requests SET status = 'CLOSED', handled_at = now(), outcome = 'MAYBE' WHERE id = '${request}'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await run(`UPDATE shop_requests SET status = 'CLOSED', handled_at = now(), handled_by = '${admin}', outcome = 'ACCEPTED' WHERE id = '${request}'`);
    const order = (sets: Record<string, unknown>) => {
      const cols = { channel: 'SALON', shop_request_id: request, account_id: account, model_id: model, location_id: paris, ...sets };
      return sql<{ id: string; status: string; piece: number; addons: unknown }>`
        INSERT INTO orders (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id, status, piece, addons`.execute(t.db);
    };
    const hourAgo = new Date(Date.now() - 3_600_000);
    for (const [sets, constraint] of [
      [{ channel: 'LIVE' }, 'orders_source'],
      [{ piece: 2 }, 'orders_source'],
      [{ price_minor: 480000 }, 'orders_price'],
      [{ reservation: 'STOCK' }, 'orders_reservation'],
      [{ sku_id: s52, reservation: 'STOCK', status: 'CANCELLED', reserved_at: hourAgo, cancelled_at: new Date() }, 'orders_reservation'],
      [{ status: 'PAID' }, 'orders_status_paid'],
      [{ status: 'SHIPPED', reserved_at: hourAgo, paid_at: new Date() }, 'orders_status_shipped'],
      [{ status: 'CANCELLED' }, 'orders_status_cancelled'],
      [{ status: 'RETURNED' }, 'orders_status_returned'],
      [{ status: 'DELIVERED' }, 'orders_status_delivered'],
      [{ carrier_id: courier }, 'orders_shipment'],
      [{ declared_value_minor: 100 }, 'orders_shipment'],
      [{ paid_at: new Date(Date.now() - 86_400_000), status: 'PAID' }, 'orders_times'],
    ] as const) {
      await expect(order(sets as Record<string, unknown>), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    await expect(order({ sku_id: otherSku })).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'orders_sku_fkey'));
    for (const sets of [{ currency: 'eur', price_minor: 1 }, { addons: '{}' }, { tracking_number: 'x' }, { status: 'LOST' }, { engraving_text: 'x'.repeat(121) }, { piece: 6 }]) {
      await expect(order(sets), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    const o1 = (await order({ sku_id: s52, size_label: '52', price_minor: 480000, currency: 'EUR', reservation: 'STOCK', product_id: issuedPiece })).rows[0];
    expect([o1.status, o1.piece, o1.addons]).toEqual(['RESERVED', 1, []]);
    await expect(order({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_shop_request_key'));
    const set = (sets: string, id = o1.id) => run(`UPDATE orders SET ${sets} WHERE id = '${id}'`);
    // Step by step, each status with its columns: PAID, then SHIPPED with its carrier and number, then DELIVERED.
    await expect(set(`status = 'SHIPPED', shipped_at = now(), carrier_id = '${courier}', tracking_number = '6A12345678901'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await set(`status = 'PAID', paid_at = reserved_at + interval '1 hour'`);
    await expect(set(`status = 'SHIPPED', shipped_at = paid_at + interval '1 day', reservation = NULL`)).rejects.toSatisfy((e) => isCheckViolation(e, 'orders_shipment'));
    await expect(set(`status = 'SHIPPED', shipped_at = paid_at + interval '1 day', carrier_id = '${courier}', tracking_number = '6A12345678901'`)).rejects.toSatisfy((e) =>
      isCheckViolation(e, 'orders_reservation'),
    );
    await expect(set(`status = 'SHIPPED', shipped_at = paid_at - interval '1 second', reservation = NULL, carrier_id = '${courier}', tracking_number = '6A12345678901'`)).rejects.toSatisfy(
      (e) => isCheckViolation(e, 'orders_times'),
    );
    await set(`status = 'SHIPPED', shipped_at = paid_at + interval '1 day', reservation = NULL, carrier_id = '${courier}', tracking_number = '6A12345678901', declared_value_minor = 480000`);
    await expect(set(`status = 'CANCELLED', cancelled_at = now() + interval '2 days'`)).rejects.toSatisfy((e) => isCheckViolation(e));
    await set(`status = 'DELIVERED', delivered_at = shipped_at + interval '3 days'`);
    await set(`status = 'RETURNED', returned_at = delivered_at + interval '1 day'`);
    // Its identity never changes; one open order per piece (a returned one frees it).
    for (const sets of [`channel = 'DRAW'`, `account_id = '${account}', model_id = '${other}'`, `reserved_at = now()`, `piece = 2`]) {
      await expect(set(sets), sets).rejects.toSatisfy((e) => isGuardViolation(e) || isCheckViolation(e));
    }
    const request2 = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES (${account}, ${model}, 'CLOSED', now(), 'ACCEPTED') RETURNING id`.execute(t.db)).rows[0].id;
    const o2 = (await order({ shop_request_id: request2, sku_id: s52, product_id: issuedPiece })).rows[0];
    const request3 = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES (${account}, ${model}, 'CLOSED', now(), 'ACCEPTED') RETURNING id`.execute(t.db)).rows[0].id;
    await expect(order({ shop_request_id: request3, product_id: issuedPiece })).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_product_key'));

    // Its history: an order's action, the status after it; append-only.
    const event = (action: string, status = 'RESERVED') =>
      sql<{ id: number }>`INSERT INTO order_events (order_id, action, status, actor_type) VALUES (${o2.id}, ${action}, ${status}, 'admin') RETURNING id`.execute(t.db);
    for (const action of ['pay', 'order.', 'Order.Pay', 'stock.move']) await expect(event(action), action).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(event('order.pay', 'LOST')).rejects.toSatisfy((e) => isCheckViolation(e));
    const ev = (await event('order.create')).rows[0].id;
    await expect(run(`UPDATE order_events SET note = 'x' WHERE id = ${ev}`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM order_events WHERE id = ${ev}`)).rejects.toSatisfy(isGuardViolation);

    // A piece to make: its reserved identity once, one open per order, each status with its time; its identity fixed.
    const bench = (sets: Record<string, unknown>) => {
      const cols = { order_id: o2.id, sku_id: s52, location_id: paris, product_id: reservedPiece, ...sets };
      return sql<{ id: string }>`INSERT INTO bench_items (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id`.execute(t.db);
    };
    for (const [sets, constraint] of [
      [{ status: 'IN_PROGRESS' }, 'bench_items_status_in_progress'],
      [{ status: 'DONE' }, 'bench_items_status_done'],
      [{ status: 'CANCELLED' }, 'bench_items_status_cancelled'],
      [{ started_at: new Date(Date.now() + 3_600_000) }, 'bench_items_status_to_make'],
    ] as const) {
      await expect(bench(sets as Record<string, unknown>), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    const b1 = (await bench({})).rows[0].id;
    await expect(bench({ product_id: issuedPiece })).rejects.toSatisfy((e) => isUniqueViolation(e, 'bench_items_one_open'));
    await expect(bench({ order_id: null })).rejects.toSatisfy((e) => isUniqueViolation(e, 'bench_items_product_key'));
    await expect(run(`UPDATE bench_items SET status = 'IN_PROGRESS', started_at = created_at - interval '1 second' WHERE id = '${b1}'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'bench_items_times'));
    await run(`UPDATE bench_items SET status = 'IN_PROGRESS', started_at = created_at, location_id = '${london}' WHERE id = '${b1}'`);
    await expect(run(`UPDATE bench_items SET sku_id = '${one}' WHERE id = '${b1}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE bench_items SET status = 'CANCELLED', cancelled_at = started_at WHERE id = '${b1}'`);
    // Cancelled, another piece to make may follow for the order (with another identity).
    await bench({ product_id: (await piece({ status: 'RESERVED', sku_id: s52 })).rows[0].id });

    // The ledger: the sign of each reason, a transfer's halves paired once each, an order's shipment or return, a piece one at a time; append-only.
    const move = (sets: Record<string, unknown>) => {
      const cols = { sku_id: s52, location_id: paris, actor_type: 'admin', actor_id: admin, ...sets };
      return sql<{ id: number }>`INSERT INTO stock_movements (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id`.execute(t.db);
    };
    const transfer = '6f1c1c56-5a5e-4c4b-9a41-0f5b9d8a1c11';
    for (const [sets, constraint] of [
      [{ delta: 0, reason: 'ADJUSTED' }, undefined],
      [{ delta: 10_001, reason: 'ADJUSTED' }, undefined],
      [{ delta: -1, reason: 'TRANSFER_IN', transfer_id: transfer }, 'stock_movements_sign'],
      [{ delta: 1, reason: 'TRANSFER_OUT', transfer_id: transfer }, 'stock_movements_sign'],
      [{ delta: 1, reason: 'PRODUCED' }, 'stock_movements_order'],
      [{ delta: 1, reason: 'TRANSFER_IN' }, 'stock_movements_transfer'],
      [{ delta: 1, reason: 'ADJUSTED', transfer_id: transfer }, 'stock_movements_transfer'],
      [{ delta: -1, reason: 'SHIPPED' }, 'stock_movements_order'],
      [{ delta: -2, reason: 'SHIPPED', order_id: o2.id }, 'stock_movements_order'],
      [{ delta: 1, reason: 'ADJUSTED', order_id: o2.id }, 'stock_movements_order'],
      [{ delta: 2, reason: 'ADJUSTED', product_id: issuedPiece }, 'stock_movements_piece'],
      [{ delta: 1, reason: 'ADJUSTED', actor_type: 'robot' }, undefined],
    ] as const) {
      await expect(move(sets as Record<string, unknown>), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    await move({ delta: -2, reason: 'TRANSFER_OUT', transfer_id: transfer });
    await move({ delta: 2, reason: 'TRANSFER_IN', transfer_id: transfer, location_id: london });
    await expect(move({ delta: 2, reason: 'TRANSFER_IN', transfer_id: transfer, location_id: london })).rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_movements_transfer_key'));
    const produced = (await move({ delta: 1, reason: 'PRODUCED', product_id: issuedPiece })).rows[0].id;
    await move({ delta: -1, reason: 'SHIPPED', order_id: o2.id, product_id: issuedPiece });
    await expect(run(`UPDATE stock_movements SET delta = 2 WHERE id = ${produced}`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM stock_movements WHERE id = ${produced}`)).rejects.toSatisfy(isGuardViolation);

    // Thresholds: 1 to 10 000, one per SKU and location.
    const threshold = (minimum: number) => sql`INSERT INTO sku_thresholds (sku_id, location_id, minimum, updated_by) VALUES (${s52}, ${paris}, ${minimum}, ${admin})`.execute(t.db);
    for (const m of [0, 10_001]) await expect(threshold(m)).rejects.toSatisfy((e) => isCheckViolation(e));
    await threshold(3);
    await expect(threshold(4)).rejects.toSatisfy((e) => isUniqueViolation(e));

    // Returns: back to stock at a location, or archived without one, with a note; once per order; never changed.
    const ret = (outcome: string, locationId: string | null, orderId = o1.id, note: string | null = 'Returned unworn.') =>
      sql<{ id: string }>`INSERT INTO returns (order_id, outcome, location_id, note, created_by) VALUES (${orderId}, ${outcome}, ${locationId}, ${note}, ${admin}) RETURNING id`.execute(t.db);
    await expect(ret('ARCHIVED', null, o1.id, null)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    await expect(ret('ARCHIVED', null, o1.id, ' ')).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(ret('RESTOCKED', null)).rejects.toSatisfy((e) => isCheckViolation(e, 'returns_location'));
    await expect(ret('ARCHIVED', paris)).rejects.toSatisfy((e) => isCheckViolation(e, 'returns_location'));
    await expect(ret('LOST', null)).rejects.toSatisfy((e) => isCheckViolation(e));
    const r1 = (await ret('RESTOCKED', paris)).rows[0].id;
    await expect(ret('ARCHIVED', null)).rejects.toSatisfy((e) => isUniqueViolation(e, 'returns_order_key'));
    await expect(run(`UPDATE returns SET note = 'x' WHERE id = '${r1}'`)).rejects.toSatisfy(isGuardViolation);

    // Invoices: numbered per kind and year; one invoice per order; a credit note credits one invoice, once; the total is
    // the subtotal plus the VAT (none: both NULL); never changed.
    const invoice = (sets: Record<string, unknown>) => {
      const cols = {
        kind: 'INVOICE', year: 2026, sequence: 1, order_id: o1.id, issuer: '{"name":"CONGLOMERAT LLC"}', buyer: '{"name":"A buyer"}', lines: '[{"label":"MONOLITHE","amountMinor":480000}]',
        currency: 'EUR', subtotal_minor: 480000, total_minor: 480000, ...sets,
      };
      return sql<{ id: string }>`INSERT INTO invoices (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id`.execute(t.db);
    };
    for (const [sets, constraint] of [
      [{ total_minor: 1 }, 'invoices_total'],
      [{ vat_rate_bp: 2000 }, 'invoices_vat'],
      [{ kind: 'CREDIT_NOTE' }, 'invoices_credit'],
      [{ lines: '[]' }, undefined],
      [{ issuer: '[]' }, undefined],
    ] as const) {
      await expect(invoice(sets as Record<string, unknown>), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    const inv = (await invoice({})).rows[0].id;
    await expect(invoice({ sequence: 2 })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_one_per_order'));
    await expect(invoice({ order_id: o2.id })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_number_key'));
    await invoice({ order_id: o2.id, sequence: 2, vat_rate_bp: 2000, vat_minor: 96000, total_minor: 576000 });
    await invoice({ kind: 'CREDIT_NOTE', credits_invoice_id: inv });
    await expect(invoice({ kind: 'CREDIT_NOTE', sequence: 2, credits_invoice_id: inv })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_credits_key'));
    await expect(run(`UPDATE invoices SET total_minor = 0, subtotal_minor = 0 WHERE id = '${inv}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM invoices WHERE id = '${inv}'`)).rejects.toSatisfy(isGuardViolation);

    // The journal: a dotted type, an object; only its readers change; never deleted.
    const journal = (type: string, payload = '{}') => sql<{ id: number }>`INSERT INTO event_journal (type, entity_type, entity_id, payload) VALUES (${type}, 'order', ${o1.id}, ${payload}) RETURNING id`.execute(t.db);
    for (const [type, payload] of [['order', '{}'], ['Order.Pay', '{}'], ['order.pay', '[]']] as const) await expect(journal(type, payload)).rejects.toSatisfy((e) => isCheckViolation(e));
    const j = (await journal('order.pay', '{"status":"PAID"}')).rows[0].id;
    await run(`UPDATE event_journal SET consumed_by = array_append(consumed_by, 'shopify') WHERE id = ${j}`);
    for (const sets of [`payload = '{}'`, `type = 'order.ship'`, `entity_id = 'x'`, `created_at = now() + interval '1 day'`]) {
      await expect(run(`UPDATE event_journal SET ${sets} WHERE id = ${j}`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM event_journal WHERE id = ${j}`)).rejects.toSatisfy(isGuardViolation);

    // The delays of the order alerts: one row, its defaults 2, 3, 10 and 30 days, each within its bounds.
    const settings = (await sql<Record<string, number>>`INSERT INTO order_alert_settings DEFAULT VALUES RETURNING reserved_days, ready_days, shipped_days, unregistered_days`.execute(t.db)).rows[0];
    expect(settings).toEqual({ reserved_days: 2, ready_days: 3, shipped_days: 10, unregistered_days: 30 });
    await expect(sql`INSERT INTO order_alert_settings (id) VALUES (2)`.execute(t.db)).rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(sql`INSERT INTO order_alert_settings DEFAULT VALUES`.execute(t.db)).rejects.toSatisfy((e) => isUniqueViolation(e));
    for (const sets of ['reserved_days = 0', 'shipped_days = 91', 'unregistered_days = 366']) await expect(run(`UPDATE order_alert_settings SET ${sets}`), sets).rejects.toSatisfy((e) => isCheckViolation(e));

    // A model's base price with its currency (both or neither), its care guide 1 to 8 000 characters; a release's location.
    const setModel = (sets: string) => run(`UPDATE models SET ${sets} WHERE id = '${model}'`);
    for (const sets of [`base_price_minor = 480000`, `base_currency = 'EUR'`, `base_price_minor = -1, base_currency = 'EUR'`, `base_price_minor = 1, base_currency = 'eur'`, `care_guide = ' '`]) {
      await expect(setModel(sets), sets).rejects.toSatisfy((e) => isCheckViolation(e));
    }
    await setModel(`base_price_minor = 480000, base_currency = 'EUR', care_guide = 'Wipe with a soft cloth.'`);
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    await expect(
      sql`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, stock_location_id)
          VALUES (${model}, 'Draw', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6')`.execute(t.db),
    ).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'drops_stock_location_id_fkey'));

    // What the stock and the orders hold keeps their locations, SKUs, carriers, pieces, accounts and console users.
    for (const q of [
      `DELETE FROM stock_locations WHERE id = '${paris}'`,
      `DELETE FROM skus WHERE id = '${s52}'`,
      `DELETE FROM carriers WHERE id = '${courier}'`,
      `DELETE FROM products WHERE id = '${issuedPiece}'`,
      `DELETE FROM accounts WHERE id = '${account}'`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy((e) => isForeignKeyViolation(e) || isGuardViolation(e));
    }
  });

  /** The tables 0023 adds, the columns it adds to drops and circle_posts, and what names an object of 0023 in a snapshot. */
  const TABLES_0023 = ['activity_hourly', 'after_room_guests', 'release_answers', 'segments'];
  const DROPS_0023 = [
    'access_combine', 'access_segment_id', 'after_room_delay_minutes', 'after_room_length_minutes', 'min_participations', 'parent_drop_id', 'question_answers',
    'question_enabled', 'question_text', 'surprise_enabled', 'surprise_text',
  ];
  const of0023 = (o: string) =>
    new RegExp(`\\b(${TABLES_0023.join('|')})\\b`).test(o) ||
    DROPS_0023.some((c) => o.startsWith(`table drops ${c} `) || o.startsWith(`constraint drops drops_${c}_`)) ||
    /^constraint drops drops_(draw_plus|after_room|surprise|question) /.test(o) ||
    /^index CREATE (UNIQUE )?INDEX drops_(parent_drop_id_key|access_segment_id_idx) /.test(o) ||
    /^table circle_posts segment_id |^constraint circle_posts circle_posts_segment_id_fkey |^index CREATE INDEX circle_posts_segment_id_idx /.test(o);

  /** A LIVE drop, its settings given, as 0021 to 0023 hold it (`extra`: more columns and their values, SQL). */
  const liveDrop = async (model: string, extra: Record<string, string> = {}) => {
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const columns = Object.keys(extra);
    return (
      await sql<{ id: string }>`
        INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, early_access_hours,
                           mode, live_min_tier, tier_priority, room_opens_minutes, turn_seconds, pay_minutes, per_account, price_minor, currency, quantity_line
                           ${sql.raw(columns.map((c) => `, ${c}`).join(''))})
        VALUES (${model}, 'Live', 1, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}, 0,
                'LIVE', 0, true, 5, 30, 5, 1, 505000, 'EUR', '1 PIECE' ${sql.raw(columns.map((c) => `, ${extra[c]}`).join(''))}) RETURNING id`.execute(t.db)
    ).rows[0].id;
  };
  /** What an after-room's row carries beyond a LIVE drop's settings. */
  const AFTER_ROOM = (parent: string) => ({ parent_drop_id: `'${parent}'`, after_room_delay_minutes: '10', after_room_length_minutes: '15', surprise_enabled: 'false', question_enabled: 'false' });

  it('0023 adds the after-room, the surprise, the access and question settings, the guests, the answers, the segments and the activity by hour, and nothing else; down cancels the after-rooms not ended and restores 0022 exactly, and up again', async () => {
    const latest = await snapshot();
    await sql`INSERT INTO categories (id, code, name) VALUES (19, 'S', 'Collectors test') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (19, 'C', 'RING', 'COLLDOWN') RETURNING id`.execute(t.db)).rows[0].id;
    // A release with its after-room opened (published, not ended), another whose after-room has ended: the previous image
    // would show the first as a release of its own, so the down step cancels it; the second stays as it ended.
    const parent = await liveDrop(model, { published_at: 'now()' });
    const open = await liveDrop(model, { ...AFTER_ROOM(parent), published_at: 'now()' });
    const otherParent = await liveDrop(model, { published_at: 'now()' });
    const ended = await liveDrop(model, { ...AFTER_ROOM(otherParent), published_at: 'now()', ended_at: 'now()', ended_reason: `'SOLD_OUT'` });
    const { with: withIt, without: before } = await rollBackTo('0023_releases_collectors');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0023(o))).toEqual([]);
    expect(before.filter(of0023)).toEqual([]);
    expect(withIt.filter((o) => !of0023(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('drops')).toEqual(DROPS_0023);
    expect(columns('circle_posts')).toEqual(['segment_id']);
    expect(columns('after_room_guests')).toEqual(['drop_id', 'entry_id', 'position', 'remembered_at']);
    expect(columns('release_answers')).toEqual(['account_id', 'answer', 'answered_at', 'drop_id']);
    expect(columns('segments')).toEqual(['created_at', 'created_by', 'criteria', 'id', 'name', 'updated_at']);
    expect(columns('activity_hourly')).toEqual(['country', 'hour', 'scans', 'sign_ins', 'tier']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger after_room_guests after_room_guests_immutable',
      'trigger release_answers release_answers_immutable_identity',
      'trigger segments segments_immutable_identity',
    ]);
    for (const c of [
      /^constraint drops drops_parent_drop_id_fkey FOREIGN KEY \(parent_drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_access_segment_id_fkey FOREIGN KEY \(access_segment_id\) REFERENCES segments\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_access_combine_check CHECK \(\(access_combine = ANY \(ARRAY\['AND'::text, 'OR'::text\]\)\)\)$/,
      /^constraint circle_posts circle_posts_segment_id_fkey FOREIGN KEY \(segment_id\) REFERENCES segments\(id\) ON DELETE RESTRICT$/,
      /^constraint after_room_guests after_room_guests_entry_id_fkey FOREIGN KEY \(entry_id\) REFERENCES live_entries\(id\) ON DELETE RESTRICT$/,
      /^constraint release_answers release_answers_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    for (const name of ['draw_plus', 'after_room', 'surprise', 'question']) expect(added.some((o) => o.startsWith(`constraint drops drops_${name} CHECK `)), name).toBe(true);
    // Down: the after-room not ended cancelled; the one that ended, and the releases, as they were.
    const state = async (id: string) => (await sql<{ cancelled_at: Date | null; ended_at: Date | null }>`SELECT cancelled_at, ended_at FROM drops WHERE id = ${id}`.execute(t.db)).rows[0];
    expect((await state(open)).cancelled_at).not.toBeNull();
    expect(await state(ended)).toMatchObject({ cancelled_at: null, ended_at: expect.any(Date) });
    for (const id of [parent, otherParent]) expect((await state(id)).cancelled_at).toBeNull();
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0023_releases_collectors'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0023: the after-room a LIVE child without rules, reveals, board or question of its own, one per release, never its own parent; LIVE-only settings; a surprise with its words, a question with its answers; guests once and never changed; one answer per account and release; segments named once; the activity by whole hour', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (18, 'R', 'Collectors checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (18, 'K', 'RING', 'COLLCHK') RETURNING id`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('collectors@example.com', 'collectors@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('collectors@orbes.test', 'collectors@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e));

    // A DRAW carries none of it.
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const draw = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
      VALUES (${model}, 'Draw', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}) RETURNING id`.execute(t.db)).rows[0].id;
    const parent = await liveDrop(model);
    for (const sets of [`surprise_enabled = false`, `min_participations = 3`, `access_combine = 'OR'`, `question_enabled = true`, `parent_drop_id = '${parent}', after_room_delay_minutes = 10, after_room_length_minutes = 15`]) {
      await check(run(`UPDATE drops SET ${sets} WHERE id = '${draw}'`), `a draw: ${sets}`);
    }
    // A LIVE release: each setting within its bounds; a surprise enabled with its words; a question's text and answers together.
    const setParent = (sets: string) => run(`UPDATE drops SET ${sets} WHERE id = '${parent}'`);
    for (const sets of [
      `surprise_enabled = true`, `surprise_text = ' '`, `surprise_text = '${'x'.repeat(501)}'`, `min_participations = 0`, `min_participations = 101`, `access_combine = 'XOR'`,
      `question_text = 'WHAT WOULD YOU HAVE WANTED?'`, `question_answers = ARRAY['ONE','TWO']`, `question_text = 'Q', question_answers = ARRAY['ONLY']`,
      `question_text = 'Q', question_answers = ARRAY['A','B','C','D','E','F','G']`, `question_text = 'Q', question_answers = ARRAY['A', NULL]`, `question_text = '${'x'.repeat(121)}', question_answers = ARRAY['A','B']`,
    ]) {
      await check(setParent(sets), sets);
    }
    await setParent(`surprise_enabled = true, surprise_text = 'A silk pouch.', min_participations = 3, access_combine = 'OR', question_enabled = true, question_text = 'WHAT WOULD YOU HAVE WANTED?', question_answers = ARRAY['ANOTHER SIZE','ANOTHER FINISH','ANOTHER PRICE BAND']`);
    // Its after-room: delay 1 to 60, length 5 to 120, both exactly with a parent; no rule, reveal, board, surprise or question of its own.
    const child = await liveDrop(model, AFTER_ROOM(parent));
    await expect(liveDrop(model, AFTER_ROOM(parent))).rejects.toSatisfy((e) => isUniqueViolation(e, 'drops_parent_drop_id_key'));
    const setChild = (sets: string) => run(`UPDATE drops SET ${sets} WHERE id = '${child}'`);
    for (const sets of [
      `after_room_delay_minutes = 0`, `after_room_delay_minutes = 61`, `after_room_length_minutes = 4`, `after_room_length_minutes = 121`, `after_room_delay_minutes = NULL`,
      `parent_drop_id = NULL`, `parent_drop_id = '${child}'`, `live_min_tier = 1`, `access_collection_id = (SELECT id FROM collections LIMIT 1)`, `announce_at = '2026-11-01T10:00:00Z'`,
      `name_at = '2026-11-01T10:00:00Z'`, `board_token_hash = '\\x${'00'.repeat(32)}', board_token_issued_at = now()`, `surprise_enabled = true, surprise_text = 'x'`,
      `surprise_enabled = NULL`, `min_participations = 1`, `access_combine = 'AND'`, `question_enabled = true`, `question_enabled = NULL`,
    ]) {
      if (sets.includes('collections') && (await sql`SELECT 1 FROM collections LIMIT 1`.execute(t.db)).rows.length === 0) continue;
      await check(setChild(sets), `an after-room: ${sets}`);
    }
    await expect(run(`UPDATE drops SET parent_drop_id = '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' WHERE id = '${child}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'drops_parent_drop_id_fkey'));

    // Its guests: entries of the release, once each, a place 1 or more unique per after-room; never changed.
    const size = (await sql<{ id: string }>`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES (${parent}, '52', 1, 1) RETURNING id`.execute(t.db)).rows[0].id;
    const entry = (await sql<{ id: string }>`INSERT INTO live_entries (drop_id, account_id, size_id, quantity, tier) VALUES (${parent}, ${account}, ${size}, 1, 0) RETURNING id`.execute(t.db)).rows[0].id;
    const guest = (position: number, entryId = entry) => sql`INSERT INTO after_room_guests (drop_id, entry_id, position, remembered_at) VALUES (${child}, ${entryId}, ${position}, now())`.execute(t.db);
    await check(guest(0), 'place 0');
    await guest(1);
    await expect(guest(2)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await expect(run(`UPDATE after_room_guests SET position = 2 WHERE entry_id = '${entry}'`)).rejects.toSatisfy(isGuardViolation);

    // An answer: one per account and release, the position of an answer 1 to 6; its release and account never change.
    const answer = (n: number) => sql`INSERT INTO release_answers (drop_id, account_id, answer) VALUES (${parent}, ${account}, ${n})`.execute(t.db);
    for (const n of [0, 7]) await check(answer(n), `answer ${n}`);
    await answer(2);
    await expect(answer(3)).rejects.toSatisfy((e) => isUniqueViolation(e));
    await run(`UPDATE release_answers SET answer = 3, answered_at = now() WHERE drop_id = '${parent}'`);
    await expect(run(`UPDATE release_answers SET drop_id = '${draw}' WHERE drop_id = '${parent}'`)).rejects.toSatisfy(isGuardViolation);

    // A segment: a trimmed name of 1 to 60, unique whatever the case; its criteria an object; its identity fixed.
    const segment = (name: string, criteria = '{}') => sql.raw<{ id: string }>(`INSERT INTO segments (name, criteria, created_by) VALUES ('${name}', '${criteria}', '${admin}') RETURNING id`).execute(t.db);
    for (const bad of [' REGULARS', '', 'x'.repeat(61)]) await check(segment(bad), bad);
    await check(segment('LISTS', '[]'), 'criteria a list');
    const regulars = (await segment('REGULARS', '{"all":[]}')).rows[0].id;
    await expect(segment('regulars')).rejects.toSatisfy((e) => isUniqueViolation(e, 'segments_name_key'));
    await expect(run(`UPDATE segments SET created_by = NULL WHERE id = '${regulars}'`)).rejects.toSatisfy(isGuardViolation);
    await setParent(`access_segment_id = '${regulars}'`);
    await run(`INSERT INTO circle_posts (kind, title, segment_id) VALUES ('NOTE', 'For some', '${regulars}')`);
    await expect(run(`DELETE FROM segments WHERE id = '${regulars}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // The activity: whole UTC hours, a country (ZZ unknown), a tier, counts of 0 or more; one row per hour, country and tier.
    const activity = (hour: string, country = 'FR', tier = 0, signIns = 0) => sql`INSERT INTO activity_hourly (hour, country, tier, sign_ins) VALUES (${hour}::timestamptz, ${country}, ${tier}, ${signIns})`.execute(t.db);
    for (const [hour, country, tier, n] of [['2026-11-01T10:30:00Z', 'FR', 0, 0], ['2026-11-01T10:00:00Z', 'fr', 0, 0], ['2026-11-01T10:00:00Z', 'FR', 4, 0], ['2026-11-01T10:00:00Z', 'FR', 0, -1]] as const) {
      await check(activity(hour, country, tier, n), `${hour} ${country} ${tier} ${n}`);
    }
    await activity('2026-11-01T10:00:00Z', 'ZZ', 2, 3);
    await expect(activity('2026-11-01T10:00:00Z', 'ZZ', 2)).rejects.toSatisfy((e) => isUniqueViolation(e));
  });

  /** What names an object of 0024 in a snapshot: the variants' columns, constraints, indexes and trigger; a draw's price. */
  const of0024 = (o: string) =>
    /^table models variant_(of|label|swatch) /.test(o) ||
    /^constraint models models_variant_/.test(o) ||
    /^index CREATE (UNIQUE )?INDEX models_variant_/.test(o) ||
    o === 'trigger models models_variant_rules' ||
    /^constraint drops drops_draw_(fields|price) /.test(o);
  /** A draw's row as 0015 to 0024 hold it (`extra`: more columns and their values, SQL). */
  const drawDrop = async (model: string, extra: Record<string, string> = {}) => {
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const columns = Object.keys(extra);
    return (
      await sql<{ id: string }>`
        INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash ${sql.raw(columns.map((c) => `, ${c}`).join(''))})
        VALUES (${model}, 'Draw', 12, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash} ${sql.raw(columns.map((c) => `, ${extra[c]}`).join(''))})
        RETURNING id`.execute(t.db)
    ).rows[0].id;
  };

  it('0024 adds the variants of a model (variant_of, variant_label, variant_swatch and their rules) and a draw\'s price, and nothing else; down clears the draws\' prices and restores 0023 exactly, and up again', async () => {
    const latest = await snapshot();
    await sql`INSERT INTO categories (id, code, name) VALUES (16, 'N', 'Variants test') ON CONFLICT DO NOTHING`.execute(t.db);
    const main = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, variant_label, variant_swatch) VALUES (16, 'V', 'RING', 'VARDOWN', 'Steel', '#9D9B96') RETURNING id`.execute(t.db)).rows[0].id;
    const variant = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, variant_of, variant_label, variant_swatch) VALUES (16, 'V', 'RING', 'VARDOWN-BL', ${main}, 'Blue', '#16224A') RETURNING id`.execute(t.db)).rows[0].id;
    // A draw priced: the previous image's drops_draw_fields refuses its price, so the down step clears it.
    const priced = await drawDrop(variant, { price_minor: '420000', currency: `'EUR'` });
    const { with: withIt, without: before } = await rollBackTo('0024_model_variants');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    expect(added.filter((o) => !of0024(o))).toEqual([]);
    expect(withIt.filter((o) => !of0024(o))).toEqual(before.filter((o) => !of0024(o)));
    // drops_draw_fields of 0021, its price included; 0024's without it, and a draw's price both or neither.
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^constraint drops drops_draw_fields CHECK .*\(price_minor IS NULL\) AND \(currency IS NULL\)/);
    const fields = added.find((o) => o.startsWith('constraint drops drops_draw_fields '))!;
    expect(fields).toBeDefined();
    expect(fields).not.toMatch(/price_minor|currency/);
    expect(fields).toMatch(/per_account IS NULL/);
    expect(added.some((o) => /^constraint drops drops_draw_price CHECK \(\(\(mode = 'LIVE'::text\) OR \(\(price_minor IS NULL\) = \(currency IS NULL\)\)\)\)$/.test(o))).toBe(true);
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table models variant_label text YES ', 'table models variant_of uuid YES ', 'table models variant_swatch text YES ']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger models models_variant_rules']);
    for (const c of [
      /^constraint models models_variant_of_fkey FOREIGN KEY \(variant_of\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint models models_variant_label_check CHECK \(\(\(\(length\(variant_label\) >= 1\) AND \(length\(variant_label\) <= 40\)\) AND \(variant_label = btrim\(variant_label\)\)\)\)$/,
      /^constraint models models_variant_swatch_check CHECK \(\(variant_swatch ~ '\^#\[0-9A-F\]\{6\}\$'::text\)\)$/,
      /^constraint models models_variant_self CHECK \(\(variant_of <> id\)\)$/,
      /^constraint models models_variant_labelled CHECK \(\(\(variant_of IS NULL\) OR \(variant_label IS NOT NULL\)\)\)$/,
      /^constraint models models_variant_dot CHECK \(\(\(variant_label IS NULL\) = \(variant_swatch IS NULL\)\)\)$/,
      /^index CREATE INDEX models_variant_of_idx ON public\.models USING btree \(variant_of\)$/,
      /^index CREATE UNIQUE INDEX models_variant_label_key ON public\.models USING btree \(COALESCE\(variant_of, id\), lower\(variant_label\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Down: the draw's price cleared; the variant a model of its own (its row kept), the rules' function gone.
    expect((await sql<{ price_minor: number | null; currency: string | null }>`SELECT price_minor, currency FROM drops WHERE id = ${priced}`.execute(t.db)).rows[0]).toEqual({ price_minor: null, currency: null });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM models WHERE id IN (${main}, ${variant})`.execute(t.db)).rows[0].n).toBe(2);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'orbes_models_variant_rules'`.execute(t.db)).rows[0].n).toBe(0);
    // Later migrations (0025…) were rolled back first: up again applies them after it.
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0024_model_variants'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0024: a variant names its main model, never a variant nor itself; a label of 1 to 40 characters on a variant and on a model with variants, unique among them whatever the case, with its colour #RRGGBB; a draw priced both or neither, a LIVE RELEASE as before', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (15, 'M', 'Variants checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const model = async (sku: string, columns: Record<string, string> = {}) => {
      const names = Object.keys(columns);
      return (
        await sql.raw<{ id: string }>(
          `INSERT INTO models (category_id, name, type, sku_prefix${names.map((c) => `, ${c}`).join('')}) VALUES (15, 'MONOLITHE', 'BRACELET', '${sku}'${names.map((c) => `, ${columns[c]}`).join('')}) RETURNING id`,
        ).execute(t.db)
      ).rows[0].id;
    };
    const dot = (label: string, swatch: string, of?: string) => ({ variant_label: `'${label}'`, variant_swatch: `'${swatch}'`, ...(of ? { variant_of: `'${of}'` } : {}) });

    const steel = await model('VCHK-ST', dot('Steel', '#9D9B96'));
    const plain = await model('VCHK-PL');
    // A main model carries its own label; a variant its label and colour, together, in their forms.
    await check(model('VCHK-X1', dot('Blue', '#16224A', plain)), 'the main model without its label', 'models_variant_main_labelled');
    await check(model('VCHK-X2', { variant_of: `'${steel}'` }), 'a variant without its label', 'models_variant_labelled');
    await check(model('VCHK-X3', { variant_of: `'${steel}'`, variant_label: `'Blue'` }), 'a label without its colour', 'models_variant_dot');
    await check(model('VCHK-X4', { variant_swatch: `'#16224A'` }), 'a colour without its label', 'models_variant_dot');
    for (const [i, [label, swatch]] of [[' Blue', '#16224A'], ['', '#16224A'], ['x'.repeat(41), '#16224A'], ['Blue', '#16224a'], ['Blue', '16224A'], ['Blue', '#16224']].entries()) {
      await check(model(`VCHK-X5-${i}`, dot(label, swatch, steel)), `${label} ${swatch}`);
    }
    const blue = await model('VCHK-BL', dot('Blue', '#16224A', steel));
    await model('VCHK-GD', dot('x'.repeat(40), '#B88A3A', steel));
    // One label per dot of a model and its variants, whatever its case; another model's variants may use it.
    await expect(model('VCHK-B2', dot('blue', '#16224A', steel))).rejects.toSatisfy((e) => isUniqueViolation(e, 'models_variant_label_key'));
    await expect(model('VCHK-S2', dot('STEEL', '#9D9B96', steel))).rejects.toSatisfy((e) => isUniqueViolation(e, 'models_variant_label_key'));
    const other = await model('VCHK-O', dot('Steel', '#9D9B96'));
    await model('VCHK-OB', dot('Blue', '#16224A', other));
    // Never chained: a variant's main model is no variant; a model with variants never becomes one.
    await check(model('VCHK-X6', dot('Night', '#0A0A0A', blue)), 'a variant of a variant', 'models_variant_no_chain');
    await check(run(`UPDATE models SET variant_of = '${other}' WHERE id = '${steel}'`), 'a main model made a variant', 'models_variant_no_chain');
    await check(run(`UPDATE models SET variant_of = '${blue}' WHERE id = '${other}'`), 'onto a variant', 'models_variant_no_chain');
    // Never its own; an unknown main model is a foreign key's refusal.
    const alone = await model('VCHK-AL', dot('Alone', '#A7A29A'));
    await check(run(`UPDATE models SET variant_of = '${alone}' WHERE id = '${alone}'`), 'its own variant', 'models_variant_self');
    await expect(run(`UPDATE models SET variant_of = '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6' WHERE id = '${alone}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'models_variant_of_fkey'));
    // A label changes; it is never cleared on a variant, nor on a model with variants; a model alone may drop its own.
    await run(`UPDATE models SET variant_label = 'Silver', variant_swatch = '#D7D5D0' WHERE id = '${steel}'`);
    await run(`UPDATE models SET variant_label = 'Night blue' WHERE id = '${blue}'`);
    await check(run(`UPDATE models SET variant_label = NULL, variant_swatch = NULL WHERE id = '${blue}'`), 'a variant unlabelled', 'models_variant_labelled');
    await check(run(`UPDATE models SET variant_label = NULL, variant_swatch = NULL WHERE id = '${steel}'`), 'a main model unlabelled', 'models_variant_main_labelled');
    await run(`UPDATE models SET variant_label = NULL, variant_swatch = NULL WHERE id = '${alone}'`);
    // A main model is kept while a variant names it.
    await expect(run(`DELETE FROM models WHERE id = '${steel}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));

    // A draw's price: both or neither, a whole amount of 0 or more in three capital letters; nothing else of a LIVE RELEASE.
    await drawDrop(steel);
    await drawDrop(steel, { price_minor: '420000', currency: `'EUR'` });
    await check(drawDrop(steel, { price_minor: '420000' }), 'a price without its currency', 'drops_draw_price');
    await check(drawDrop(steel, { currency: `'EUR'` }), 'a currency without its price', 'drops_draw_price');
    await check(drawDrop(steel, { price_minor: '-1', currency: `'EUR'` }), 'a negative price', 'drops_price_minor_check');
    await check(drawDrop(steel, { price_minor: '420000', currency: `'eur'` }), 'a currency in small letters', 'drops_currency_check');
    for (const [column, value] of [['per_account', '1'], ['quantity_line', `'12 PIECES'`], ['live_min_tier', '0'], ['announce_at', `'2026-11-01T10:00:00Z'`]]) {
      await check(drawDrop(steel, { price_minor: '420000', currency: `'EUR'`, [column]: value }), `a draw with ${column}`, 'drops_draw_fields');
    }
    // A LIVE RELEASE keeps its price required.
    await expect(liveDrop(steel)).resolves.toEqual(expect.any(String));
    await check(
      (async () => {
        const id = await liveDrop(steel);
        await run(`UPDATE drops SET price_minor = NULL, currency = NULL WHERE id = '${id}'`);
      })(),
      'a LIVE RELEASE without its price',
      'drops_live_fields',
    );
  });

  /** What names an object of 0025 in a snapshot: its two tables, their constraints, indexes and triggers. */
  const of0025 = (o: string) => /\bclient_(conversations|messages)\b/.test(o);

  it('0025 adds client_conversations and client_messages, and nothing else; down drops them and restores 0024 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0025_client_messages');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0025(o))).toEqual([]);
    expect(before.filter(of0025)).toEqual([]);
    expect(withIt.filter((o) => !of0025(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('client_conversations')).toEqual([
      'account_id', 'answered_by', 'closed_at', 'closed_by', 'collector_read_at', 'created_at', 'id', 'last_message_at', 'status', 'waiting_since',
    ]);
    expect(columns('client_messages')).toEqual([
      'admin_id', 'author', 'body', 'context_kind', 'context_label', 'conversation_id', 'created_at', 'drop_id', 'id', 'model_id', 'order_id', 'product_id',
      'scan_event_id', 'scan_ref', 'shop_request_id',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger client_conversations client_conversations_immutable_identity',
      'trigger client_messages client_messages_immutable',
      'trigger client_messages client_messages_no_delete',
      'trigger client_messages client_messages_no_truncate',
    ]);
    for (const c of [
      /^constraint client_conversations client_conversations_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint client_conversations client_conversations_answered_by_fkey FOREIGN KEY \(answered_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint client_conversations client_conversations_closed_by_fkey FOREIGN KEY \(closed_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint client_conversations client_conversations_status_check CHECK \(\(status = ANY \(ARRAY\['TO_ANSWER'::text, 'ANSWERED'::text, 'CLOSED'::text\]\)\)\)$/,
      /^constraint client_conversations client_conversations_waiting CHECK /,
      /^constraint client_conversations client_conversations_closed CHECK /,
      /^constraint client_messages client_messages_conversation_id_fkey FOREIGN KEY \(conversation_id\) REFERENCES client_conversations\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_order_id_fkey FOREIGN KEY \(order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_shop_request_id_fkey FOREIGN KEY \(shop_request_id\) REFERENCES shop_requests\(id\) ON DELETE RESTRICT$/,
      /^constraint client_messages client_messages_author_check CHECK \(\(author = ANY \(ARRAY\['COLLECTOR'::text, 'STAFF'::text\]\)\)\)$/,
      /^constraint client_messages client_messages_context_kind_check CHECK \(\(context_kind = ANY \(ARRAY\['PIECE'::text, 'ORDER'::text, 'RELEASE'::text, 'SCAN'::text, 'MODEL'::text\]\)\)\)$/,
      /^constraint client_messages client_messages_body_check CHECK \(\(\(length\(btrim\(body\)\) >= 1\) AND \(length\(btrim\(body\)\) <= 4000\)\)\)$/,
      /^constraint client_messages client_messages_context_label_check CHECK \(\(\(length\(btrim\(context_label\)\) >= 1\) AND \(length\(btrim\(context_label\)\) <= 120\)\)\)$/,
      /^constraint client_messages client_messages_scan_ref_check CHECK \(\(scan_ref ~ '\^\[0-9A-F\]\{8\}\$'::text\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // No scan_event_id foreign key: the scan retention clears it.
    expect(added.some((o) => /client_messages_scan_event_id_fkey/.test(o))).toBe(false);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0025_client_messages'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0025: one conversation per account, waiting exactly while TO_ANSWER and closed with who closed it; a message by its collector or a staff member, of 1 to 4 000 characters, its context and label together and naming exactly its row, never on a staff answer; never changed but its scan, never deleted', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (14, 'L', 'Messages checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = async (n: string) =>
      (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES (${`msg${n}@example.com`}, ${`msg${n}@example.com`}, 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('answers@orbes.test', 'answers@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (14, 'ECLIPSE', 'RING', 'MSGCHK') RETURNING id`.execute(t.db)).rows[0].id;
    const drop = await drawDrop(model);

    const a = await account('a');
    const conversation = async (acc: string, columns: Record<string, string> = {}) => {
      const names = Object.keys(columns);
      return (
        await sql.raw<{ id: string }>(
          `INSERT INTO client_conversations (account_id, last_message_at${names.map((c) => `, ${c}`).join('')}) VALUES ('${acc}', now()${names.map((c) => `, ${columns[c]}`).join('')}) RETURNING id`,
        ).execute(t.db)
      ).rows[0].id;
    };
    // TO_ANSWER by default, waiting since a time; ANSWERED without; CLOSED with its time and who closed it.
    await check(conversation(a), 'to answer without its waiting time', 'client_conversations_waiting');
    await check(conversation(a, { status: `'ANSWERED'`, waiting_since: 'now()' }), 'answered and waiting', 'client_conversations_waiting');
    await check(conversation(a, { status: `'CLOSED'`, closed_at: 'now()' }), 'closed without who', 'client_conversations_closed');
    await check(conversation(a, { status: `'ANSWERED'`, closed_at: 'now()', closed_by: `'${admin}'` }), 'answered and closed', 'client_conversations_closed');
    await check(conversation(a, { status: `'OPEN'`, waiting_since: 'now()' }), 'an unknown status');
    const c = await conversation(a, { waiting_since: 'now()' });
    await expect(conversation(a, { waiting_since: 'now()' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'client_conversations_account_key'));
    await run(`UPDATE client_conversations SET status = 'CLOSED', waiting_since = NULL, closed_at = now(), closed_by = '${admin}', answered_by = '${admin}' WHERE id = '${c}'`);
    await expect(run(`UPDATE client_conversations SET account_id = '${await account('b')}' WHERE id = '${c}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE client_conversations SET created_at = now() - interval '1 day' WHERE id = '${c}'`)).rejects.toSatisfy(isGuardViolation);

    const message = async (columns: Record<string, string>) => {
      const all: Record<string, string> = { conversation_id: `'${c}'`, author: `'COLLECTOR'`, body: `'A question.'`, ...columns };
      const names = Object.keys(all);
      return (await sql.raw<{ id: string }>(`INSERT INTO client_messages (${names.join(', ')}) VALUES (${names.map((n) => all[n]).join(', ')}) RETURNING id`).execute(t.db)).rows[0].id;
    };
    // The author: a staff answer names its staff member, a collector's never does.
    await check(message({ author: `'STAFF'` }), 'a staff answer without its author', 'client_messages_author');
    await check(message({ admin_id: `'${admin}'` }), 'a collector with a staff member', 'client_messages_author');
    await check(message({ author: `'CLIENT'` }), 'an unknown author');
    // The body: 1 to 4 000 characters once trimmed.
    await check(message({ body: `'   '` }), 'an empty body');
    await check(message({ body: `'${'x'.repeat(4001)}'` }), 'a body too long');
    await message({ body: `'${'x'.repeat(4000)}'` });
    // The context: a kind and its label together, the label 1 to 120 characters, never on a staff answer.
    await check(message({ context_kind: `'MODEL'`, model_id: `'${model}'` }), 'a kind without its label', 'client_messages_label');
    await check(message({ context_label: `'ECLIPSE'` }), 'a label without its kind', 'client_messages_label');
    await check(message({ context_kind: `'MODEL'`, context_label: `'${'x'.repeat(121)}'`, model_id: `'${model}'` }), 'a label too long');
    await check(message({ context_kind: `'PLACE'`, context_label: `'X'` }), 'an unknown kind');
    await check(
      message({ author: `'STAFF'`, admin_id: `'${admin}'`, context_kind: `'MODEL'`, context_label: `'ECLIPSE'`, model_id: `'${model}'` }),
      'a staff answer with a context',
      'client_messages_staff_plain',
    );
    // Each kind names exactly its row: a PIECE its piece, an ORDER its order, a RELEASE its drop, a MODEL its model (and
    // its salon request), a SCAN its REF (with its scan and piece, either cleared); no kind names nothing.
    const label = `'X'`;
    for (const [kind, columns, what] of [
      ['PIECE', {}, 'a piece without its product'],
      ['ORDER', {}, 'an order without its order'],
      ['RELEASE', {}, 'a release without its drop'],
      ['SCAN', {}, 'a scan without its REF'],
      ['MODEL', {}, 'a model without its model'],
      ['RELEASE', { drop_id: `'${drop}'`, model_id: `'${model}'` }, 'a release naming a model too'],
      ['MODEL', { model_id: `'${model}'`, drop_id: `'${drop}'` }, 'a model naming a release too'],
      ['SCAN', { scan_ref: `'5A864AF8'`, model_id: `'${model}'` }, 'a scan naming a model'],
      [null, { model_id: `'${model}'` }, 'no kind naming a model'],
      [null, { scan_ref: `'5A864AF8'` }, 'no kind naming a scan'],
    ] as const) {
      await check(message({ ...(kind ? { context_kind: `'${kind}'`, context_label: label } : {}), ...columns }), what, 'client_messages_context');
    }
    await check(message({ context_kind: `'SCAN'`, context_label: label, scan_ref: `'5a864af8'` }), 'a REF in small letters', 'client_messages_scan_ref_check');
    await message({ context_kind: `'RELEASE'`, context_label: `'DRAW · PLACE HELD'`, drop_id: `'${drop}'` });
    await message({ context_kind: `'MODEL'`, context_label: `'ECLIPSE · PRIVATE SALON REQUEST'`, model_id: `'${model}'` });
    const scanned = await message({ context_kind: `'SCAN'`, context_label: `'REF 5A864AF8 · INVALID SIGNATURE'`, scan_ref: `'5A864AF8'`, scan_event_id: `'5a864af8-1b2c-4d3e-8f90-a1b2c3d4e5f6'` });
    await message({ context_kind: `'SCAN'`, context_label: `'REF 5A864AF8 · INVALID SIGNATURE'`, scan_ref: `'5A864AF8'` });
    const answer = await message({ author: `'STAFF'`, admin_id: `'${admin}'`, body: `'An answer.'` });
    // A message never changes but its scan, which the retention clears; it is never deleted nor truncated.
    await run(`UPDATE client_messages SET scan_event_id = NULL WHERE id = '${scanned}'`);
    for (const q of [
      `UPDATE client_messages SET body = 'Another' WHERE id = '${answer}'`,
      `UPDATE client_messages SET scan_ref = '00000000' WHERE id = '${scanned}'`,
      `UPDATE client_messages SET context_label = 'Y' WHERE id = '${scanned}'`,
      `DELETE FROM client_messages WHERE id = '${answer}'`,
      `TRUNCATE client_messages`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // What a message names keeps its conversation, account, staff member and model.
    for (const q of [`DELETE FROM client_conversations WHERE id = '${c}'`, `DELETE FROM admin_users WHERE id = '${admin}'`, `DELETE FROM models WHERE id = '${model}'`, `DELETE FROM accounts WHERE id = '${a}'`]) {
      await expect(run(q), q).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    }
  });

  /** What names an object of 0026 in a snapshot: its two tables, the columns and constraints it adds to drops and circle_posts. */
  const of0026 = (o: string) => /\b(club_program_settings|shipping_rates|early_access_platine_hours|drops_platine_window|drops_live_platine|circle_posts_experience\w*)\b/.test(o) || /^table circle_posts experience /.test(o);

  it('0026 adds the club\'s program, the shipping rates, a draw\'s PLATINE window and an invitation\'s experience, and nothing else; down restores 0025 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0026_club_program');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0026(o))).toEqual([]);
    expect(before.filter(of0026)).toEqual([]);
    expect(withIt.filter((o) => !of0026(o))).toEqual(before);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('club_program_settings')).toEqual([
      'care_pieces_palladium', 'care_pieces_platine', 'credit_channels', 'credit_currency', 'credit_palladium_minor', 'credit_platine_minor', 'credit_validity_months',
      'early_access_palladium_hours', 'early_access_platine_hours', 'experience_launch_preview_min_tier', 'experience_members_evening_min_tier', 'experience_partner_min_tier',
      'gift_palladium_model_id', 'gift_platine_model_id', 'id', 'messages_priority_min_tier', 'shipping_free_palladium', 'shipping_free_platine', 'updated_at', 'updated_by',
    ]);
    expect(columns('shipping_rates')).toEqual(['currency', 'fee_minor', 'service', 'updated_at', 'updated_by']);
    expect(columns('drops')).toEqual(['early_access_platine_hours']);
    expect(columns('circle_posts')).toEqual(['experience']);
    // Nullable, without a default: a drop and a post written by the previous image carry none.
    expect(added).toContain('table drops early_access_platine_hours smallint YES ');
    expect(added).toContain('table circle_posts experience text YES ');
    for (const c of [
      /^constraint club_program_settings club_program_settings_early_access CHECK \(\(early_access_platine_hours <= early_access_palladium_hours\)\)$/,
      /^constraint club_program_settings club_program_settings_gift_platine_model_id_fkey FOREIGN KEY \(gift_platine_model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint club_program_settings club_program_settings_gift_palladium_model_id_fkey FOREIGN KEY \(gift_palladium_model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint club_program_settings club_program_settings_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint club_program_settings club_program_settings_messages_priority_min_tier_check CHECK /,
      /^constraint club_program_settings club_program_settings_credit_channels_check CHECK /,
      /^constraint shipping_rates shipping_rates_pkey PRIMARY KEY \(currency, service\)$/,
      /^constraint shipping_rates shipping_rates_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drops drops_platine_window CHECK \(\(early_access_platine_hours <= early_access_hours\)\)$/,
      /^constraint drops drops_live_platine CHECK \(\(\(mode = 'DRAW'::text\) OR \(early_access_platine_hours IS NULL\)\)\)$/,
      /^constraint circle_posts circle_posts_experience CHECK \(\(\(experience IS NULL\) OR \(kind = 'INVITATION'::text\)\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // drops.early_access_hours keeps its default of 48 for the previous image.
    expect(withIt.filter((o) => o.startsWith('table drops early_access_hours '))).toEqual(['table drops early_access_hours smallint NO 48']);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0026_club_program'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0026: one row of program at most, its defaults the columns\', each value in its bounds and PALLADIUM\'s window at least PLATINE\'s; one shipping rate per currency and service; a draw\'s PLATINE window within PALLADIUM\'s; an experience on an invitation only', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (15, 'M', 'Program checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    // The row's defaults are the program's: 4 and 2 hours, standard and express, 1 and every piece, PLATINE, € 50 and € 100 in EUR for 12 months, every channel, 2, 3 and 3.
    await run(`INSERT INTO club_program_settings (id) VALUES (1)`);
    const row = (await sql<Record<string, unknown>>`SELECT * FROM club_program_settings`.execute(t.db)).rows[0]!;
    expect({ ...row, updated_at: undefined }).toEqual({
      id: 1, early_access_palladium_hours: 4, early_access_platine_hours: 2, shipping_free_platine: 'STANDARD', shipping_free_palladium: 'EXPRESS', care_pieces_platine: 1,
      care_pieces_palladium: null, messages_priority_min_tier: 2, gift_platine_model_id: null, gift_palladium_model_id: null, credit_platine_minor: 5000, credit_palladium_minor: 10000,
      credit_currency: 'EUR', credit_validity_months: 12, credit_channels: ['DRAW', 'LIVE', 'SALON'], experience_members_evening_min_tier: 2, experience_launch_preview_min_tier: 3,
      experience_partner_min_tier: 3, updated_by: null, updated_at: undefined,
    });
    await expect(run(`INSERT INTO club_program_settings (id) VALUES (2)`)).rejects.toSatisfy((e) => isCheckViolation(e));
    for (const [set, what, constraint] of [
      [`early_access_platine_hours = 5`, 'PLATINE before PALLADIUM', 'club_program_settings_early_access'],
      [`early_access_palladium_hours = 337`, 'over 336 hours', undefined],
      [`early_access_platine_hours = -1`, 'negative hours', undefined],
      [`shipping_free_platine = 'FAST'`, 'an unknown shipping', undefined],
      [`care_pieces_palladium = 21`, 'care over 20', undefined],
      [`messages_priority_min_tier = 1`, 'priority from TITANE', undefined],
      [`credit_platine_minor = 100000001`, 'a credit over the bound', undefined],
      [`credit_currency = 'JPY'`, 'another currency', undefined],
      [`credit_validity_months = 0`, 'no validity', undefined],
      [`credit_channels = '{}'`, 'no channel', undefined],
      [`credit_channels = '{DRAW,STORE}'`, 'an unknown channel', undefined],
      [`experience_partner_min_tier = 4`, 'an experience above PALLADIUM', undefined],
    ] as [string, string, string | undefined][]) {
      await check(run(`UPDATE club_program_settings SET ${set} WHERE id = 1`), what, constraint);
    }
    await run(`UPDATE club_program_settings SET early_access_palladium_hours = 3, early_access_platine_hours = 3, care_pieces_palladium = 0, messages_priority_min_tier = 0, credit_channels = '{SALON}' WHERE id = 1`);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (15, 'ECLIPSE', 'RING', 'PRGCHK') RETURNING id`.execute(t.db)).rows[0].id;
    await run(`UPDATE club_program_settings SET gift_platine_model_id = '${model}' WHERE id = 1`);
    await expect(run(`DELETE FROM models WHERE id = '${model}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await run(`DELETE FROM club_program_settings`);
    // One rate per currency and service, 0 to 1 000 000.00, in the house's currencies.
    await run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('EUR', 'STANDARD', 2000)`);
    await expect(run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('EUR', 'STANDARD', 2500)`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'shipping_rates_pkey'));
    await run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('EUR', 'EXPRESS', 0)`);
    await check(run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('JPY', 'STANDARD', 2000)`), 'another currency');
    await check(run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('GBP', 'OVERNIGHT', 2000)`), 'an unknown service');
    await check(run(`INSERT INTO shipping_rates (currency, service, fee_minor) VALUES ('GBP', 'STANDARD', -1)`), 'a negative fee');
    await run(`DELETE FROM shipping_rates`);
    // A draw's PLATINE window: NULL (PALLADIUM's time), or 0 to PALLADIUM's.
    const drop = await drawDrop(model, { early_access_hours: '4' });
    await run(`UPDATE drops SET early_access_platine_hours = 2 WHERE id = '${drop}'`);
    await run(`UPDATE drops SET early_access_platine_hours = 4 WHERE id = '${drop}'`);
    await check(run(`UPDATE drops SET early_access_platine_hours = 5 WHERE id = '${drop}'`), 'PLATINE before PALLADIUM', 'drops_platine_window');
    await check(run(`UPDATE drops SET early_access_platine_hours = -1 WHERE id = '${drop}'`), 'negative hours');
    await run(`UPDATE drops SET early_access_platine_hours = NULL WHERE id = '${drop}'`);
    // An experience on an invitation only.
    const post = async (kind: string, extra: string) => run(`INSERT INTO circle_posts (kind, title, ${extra ? 'event_at, ' : ''}experience) VALUES ('${kind}', 'Evening', ${extra ? `${extra}, ` : ''}'MEMBERS_EVENING')`);
    await post('INVITATION', `now()`);
    await check(post('NOTE', ''), 'an experience on a note', 'circle_posts_experience');
    await check(run(`INSERT INTO circle_posts (kind, title, event_at, experience) VALUES ('INVITATION', 'Evening', now(), 'GALA')`), 'an unknown experience');
  });

  /** What names an object of 0027 in a snapshot: its two tables, the orders' new columns and constraints, its indexes, the orders' re-created guard. */
  const of0027 = (o: string) =>
    /\b(tier_grants\w*|credit_uses\w*|with_order_id|gift_grant_id|shipping_service|shipping_minor|shipping_benefit|orders_shipping\w*|orders_with_order\w*|orders_gift_grant\w*)\b/.test(o);

  it('0027 adds the grants, the credit uses, the orders\' shipping and GIFT channel, and nothing else; down restores 0026 exactly (the channel CHECK, orders_source and the identity guard of 0022), and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0027_tier_grants');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0027 changes only the channel CHECK and orders_source (re-created with GIFT, the latter
    // naming the new columns); the guard keeps its name.
    expect(added.filter((o) => !of0027(o)).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint orders orders_channel_check']);
    expect(added).toContainEqual(expect.stringMatching(/^constraint orders orders_source CHECK .*\(channel = ANY \(ARRAY\['SALON'::text, 'GIFT'::text\]\)\) = \(drop_id IS NULL\).*gift_grant_id IS NOT NULL.*with_order_id IS NOT NULL/));
    expect(removed.map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint orders orders_channel_check', 'constraint orders orders_source']);
    expect(added).toContainEqual(expect.stringMatching(/^constraint orders orders_channel_check CHECK \(\(channel = ANY \(ARRAY\['LIVE'::text, 'DRAW'::text, 'SALON'::text, 'GIFT'::text\]\)\)\)$/));
    expect(removed).toContainEqual(expect.stringMatching(/^constraint orders orders_channel_check CHECK \(\(channel = ANY \(ARRAY\['LIVE'::text, 'DRAW'::text, 'SALON'::text\]\)\)\)$/));
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('tier_grants')).toEqual(['account_id', 'amount_minor', 'currency', 'expires_at', 'granted_at', 'id', 'kind', 'model_id', 'tier']);
    expect(columns('credit_uses')).toEqual(['amount_minor', 'applied_at', 'applied_by', 'grant_id', 'id', 'order_id', 'released_at', 'released_by', 'released_reason']);
    expect(columns('orders')).toEqual(['gift_grant_id', 'shipping_benefit', 'shipping_minor', 'shipping_service', 'with_order_id']);
    for (const c of ['gift_grant_id', 'shipping_benefit', 'shipping_minor', 'shipping_service', 'with_order_id']) expect(added.some((o) => o.startsWith(`table orders ${c} `) && o.includes(' YES ')), c).toBe(true);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger credit_uses credit_uses_immutable',
      'trigger credit_uses credit_uses_no_delete',
      'trigger tier_grants tier_grants_immutable',
      'trigger tier_grants tier_grants_no_delete',
    ]);
    for (const c of [
      /^constraint tier_grants tier_grants_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint tier_grants tier_grants_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint tier_grants tier_grants_once UNIQUE \(account_id, tier, kind\)$/,
      /^constraint tier_grants tier_grants_credit CHECK /,
      /^constraint tier_grants tier_grants_gift CHECK \(\(\(kind = 'GIFT'::text\) OR \(model_id IS NULL\)\)\)$/,
      /^constraint credit_uses credit_uses_grant_id_fkey FOREIGN KEY \(grant_id\) REFERENCES tier_grants\(id\) ON DELETE RESTRICT$/,
      /^constraint credit_uses credit_uses_order_id_fkey FOREIGN KEY \(order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint credit_uses credit_uses_released CHECK /,
      /^constraint orders orders_with_order_id_fkey FOREIGN KEY \(with_order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint orders orders_gift_grant_id_fkey FOREIGN KEY \(gift_grant_id\) REFERENCES tier_grants\(id\) ON DELETE RESTRICT$/,
      /^constraint orders orders_shipping CHECK \(\(\(shipping_minor IS NULL\) = \(shipping_service IS NULL\)\)\)$/,
      /^constraint orders orders_shipping_benefit CHECK \(\(\(shipping_benefit IS NULL\) OR \(shipping_minor = 0\)\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0027_tier_grants'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0027: a grant of a kind once per tier and account, ever, never deleted, its amount fixed; a credit with its amount, currency and expiry, a gift with neither; a use released with its reason; an order\'s shipping both or neither, free only at 0; a GIFT order with its grant and the order it travels with, one open per grant; down refused while a GIFT order or a credit use exists', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (16, 'N', 'Grant checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('grants@example.com', 'grants@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('grants@orbes.test', 'grants@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (16, 'ECLIPSE', 'RING', 'GRTCHK') RETURNING id`.execute(t.db)).rows[0].id;
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name) VALUES ('GRANT CHECKS') RETURNING id`.execute(t.db)).rows[0].id;
    const grant = (cols: string) => sql.raw<{ id: string }>(`INSERT INTO tier_grants (account_id, ${cols.split('|')[0]}) VALUES ('${account}', ${cols.split('|')[1]}) RETURNING id`).execute(t.db);
    // A CREDIT has its amount, currency and expiry; a GIFT none; tiers 2 and 3 only; an expiry after the grant.
    await check(grant(`tier, kind|2, 'CREDIT'`), 'a credit without its amount', 'tier_grants_credit');
    await check(grant(`tier, kind, amount_minor, currency, expires_at|2, 'GIFT', 5000, 'EUR', now() + interval '1 year'`), 'a gift with an amount', 'tier_grants_credit');
    await check(grant(`tier, kind, amount_minor, currency, expires_at, model_id|2, 'CREDIT', 5000, 'EUR', now() + interval '1 year', '${model}'`), 'a credit with a model', 'tier_grants_gift');
    await check(grant(`tier, kind|1, 'GIFT'`), 'a TITANE grant');
    await check(grant(`tier, kind, amount_minor, currency, expires_at|2, 'CREDIT', 0, 'EUR', now() + interval '1 year'`), 'a credit of 0');
    await check(grant(`tier, kind, amount_minor, currency, expires_at|2, 'CREDIT', 5000, 'EUR', now() - interval '1 day'`), 'an expiry before the grant', 'tier_grants_expiry');
    const credit = (await grant(`tier, kind, amount_minor, currency, expires_at|2, 'CREDIT', 5000, 'EUR', now() + interval '1 year'`)).rows[0].id;
    const gift = (await grant(`tier, kind|2, 'GIFT'`)).rows[0].id;
    // Once per tier and account, ever: never deleted, its identity and amount fixed; a gift's model set later.
    await expect(grant(`tier, kind|2, 'GIFT'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'tier_grants_once'));
    await run(`UPDATE tier_grants SET model_id = '${model}' WHERE id = '${gift}'`);
    for (const q of [
      `UPDATE tier_grants SET amount_minor = 9000 WHERE id = '${credit}'`,
      `UPDATE tier_grants SET expires_at = now() + interval '2 years' WHERE id = '${credit}'`,
      `UPDATE tier_grants SET tier = 3 WHERE id = '${gift}'`,
      `DELETE FROM tier_grants WHERE id = '${gift}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // An order: shipping both or neither, a benefit at 0 only; a GIFT with its grant and the order it travels with.
    const request = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES (${account}, ${model}, 'CLOSED', now(), 'ACCEPTED') RETURNING id`.execute(t.db)).rows[0].id;
    const order = (cols: Record<string, string>) => {
      const all: Record<string, string> = { channel: `'SALON'`, account_id: `'${account}'`, model_id: `'${model}'`, location_id: `'${location}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO orders (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(order({ shop_request_id: `'${request}'`, shipping_service: `'STANDARD'` }), 'a service without its fee', 'orders_shipping');
    await check(order({ shop_request_id: `'${request}'`, shipping_minor: '2000' }), 'a fee without its service', 'orders_shipping');
    await check(order({ shop_request_id: `'${request}'`, shipping_service: `'STANDARD'`, shipping_minor: '2000', shipping_benefit: '2' }), 'a free shipping with a fee', 'orders_shipping_benefit');
    await check(order({ shop_request_id: `'${request}'`, shipping_service: `'OVERNIGHT'`, shipping_minor: '0' }), 'an unknown service');
    await check(order({ shop_request_id: `'${request}'`, shipping_service: `'EXPRESS'`, shipping_minor: '0', shipping_benefit: '1' }), 'a free shipping of TITANE');
    const parent = (await order({ shop_request_id: `'${request}'`, shipping_service: `'STANDARD'`, shipping_minor: '0', shipping_benefit: '2' })).rows[0].id;
    await check(order({ channel: `'GIFT'`, with_order_id: `'${parent}'` }), 'a GIFT without its grant', 'orders_source');
    await check(order({ channel: `'GIFT'`, gift_grant_id: `'${gift}'` }), 'a GIFT travelling with nothing', 'orders_source');
    await check(order({ channel: `'SALON'`, shop_request_id: `'${request}'`, gift_grant_id: `'${gift}'` }), 'a grant on a salon order', 'orders_source');
    const giftOrder = (await order({ channel: `'GIFT'`, gift_grant_id: `'${gift}'`, with_order_id: `'${parent}'`, price_minor: '0', currency: `'EUR'`, shipping_service: `'STANDARD'`, shipping_minor: '0' })).rows[0].id;
    await expect(order({ channel: `'GIFT'`, gift_grant_id: `'${gift}'`, with_order_id: `'${parent}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_gift_grant_key'));
    await expect(run(`UPDATE orders SET with_order_id = NULL WHERE id = '${giftOrder}'`)).rejects.toSatisfy(isGuardViolation);
    // A credit taken off the order: more than 0, released with its reason, both or neither; never deleted; one open per grant and order.
    const use = (cols = '') => sql.raw<{ id: string }>(`INSERT INTO credit_uses (grant_id, order_id, amount_minor, applied_by${cols ? `, ${cols.split('|')[0]}` : ''}) VALUES ('${credit}', '${parent}', 2000, '${admin}'${cols ? `, ${cols.split('|')[1]}` : ''}) RETURNING id`).execute(t.db);
    await check(use(`released_at|now()`), 'released without its reason', 'credit_uses_released');
    await check(use(`released_reason|'REMOVED'`), 'a reason without its time', 'credit_uses_released');
    await check(use(`released_at, released_reason|now(), 'LOST'`), 'an unknown reason');
    await check(sql.raw(`INSERT INTO credit_uses (grant_id, order_id, amount_minor) VALUES ('${credit}', '${parent}', 0)`).execute(t.db), 'an amount of 0');
    const open = (await use()).rows[0].id;
    await expect(use()).rejects.toSatisfy((e) => isUniqueViolation(e, 'credit_uses_open_key'));
    await expect(run(`UPDATE credit_uses SET amount_minor = 1000 WHERE id = '${open}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE credit_uses SET released_at = now(), released_reason = 'REMOVED', released_by = '${admin}' WHERE id = '${open}'`);
    await use();
    await expect(run(`DELETE FROM credit_uses WHERE id = '${open}'`)).rejects.toSatisfy(isGuardViolation);
    // The down step refuses while a GIFT order or a credit use exists: neither can be removed, so this database stays at
    // 0027 (0028, which holds nothing here, goes down first).
    expect((await migrateDown(t.db)).reverted).toEqual(['0028_yearly_care']);
    await expect(migrateDown(t.db)).rejects.toThrow(/0027_tier_grants cannot be rolled back: 1 welcome gift orders and 2 credit uses exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0027_tier_grants')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (the service never deletes either).
    await run(`ALTER TABLE credit_uses DISABLE TRIGGER credit_uses_no_delete`);
    await run(`DELETE FROM credit_uses`);
    await run(`ALTER TABLE credit_uses ENABLE TRIGGER credit_uses_no_delete`);
    await run(`DELETE FROM orders WHERE channel = 'GIFT'`);
    expect((await migrateToLatest(t.db)).applied).toEqual(['0028_yearly_care']);
  });

  /** What names an object of 0028 in a snapshot: its table and its objects. */
  const of0028 = (o: string) => /\bcare_requests\w*\b/.test(o);

  it('0028 adds the care requests and YEARLY_CARE to the service types, and nothing else; down restores 0027 exactly (0001\'s type CHECK), and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0028_yearly_care');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own table, 0028 changes only the service records' type CHECK (re-created with YEARLY_CARE).
    expect(added.filter((o) => !of0028(o)).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint service_records service_records_type_check']);
    expect(removed.map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint service_records service_records_type_check']);
    expect(added).toContainEqual(expect.stringMatching(/^constraint service_records service_records_type_check CHECK .*'AUTHENTICATION'::text, 'YEARLY_CARE'::text\]/));
    expect(removed).toContainEqual(expect.stringMatching(/^constraint service_records service_records_type_check CHECK .*'AUTHENTICATION'::text\]\)\)\)$/));
    expect(before.filter(of0028)).toEqual([]);
    const columns = added.filter((o) => o.startsWith('table care_requests ')).map((o) => o.split(' ')[2]);
    expect(columns).toEqual([
      'account_id', 'cancelled_at', 'cancelled_by', 'done_at', 'handled_by', 'id', 'label_at', 'label_carrier_id', 'label_pdf', 'label_tracking', 'note', 'product_id',
      'received_at', 'requested_at', 'return_address', 'return_carrier_id', 'return_name', 'return_shipped_at', 'return_tracking', 'service_record_id', 'status', 'tier', 'year',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger care_requests care_requests_immutable', 'trigger care_requests care_requests_no_delete']);
    for (const c of [
      /^constraint care_requests care_requests_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_service_record_id_fkey FOREIGN KEY \(service_record_id\) REFERENCES service_records\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_label_carrier_id_fkey FOREIGN KEY \(label_carrier_id\) REFERENCES carriers\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_return_carrier_id_fkey FOREIGN KEY \(return_carrier_id\) REFERENCES carriers\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_handled_by_fkey FOREIGN KEY \(handled_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint care_requests care_requests_steps CHECK /,
      /^constraint care_requests care_requests_label CHECK /,
      /^constraint care_requests care_requests_return CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0028_yearly_care'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0028: a request of a piece and a year, its tier and its address; each step with the columns it needs; once per piece and year unless cancelled; its identity and address fixed, never deleted; YEARLY_CARE a service type; down refused while a request or a YEARLY_CARE record exists', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (21, 'H', 'Care checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('care@example.com', 'care@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (21, 'HALO', 'RING', 'CARECHK') RETURNING id`.execute(t.db)).rows[0].id;
    const product = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-H-00001', ${(26 << 25) | (21 << 20) | 1}, 2026, 21, 1, 'CARECHK-1', ${model}, 'SILVER') RETURNING id`.execute(t.db)
    ).rows[0];
    const carrier = (await sql<{ id: string }>`INSERT INTO carriers (name, tracking_url) VALUES ('Care checks', 'https://track.example/{tracking}') RETURNING id`.execute(t.db)).rows[0].id;
    const record = (await sql<{ id: string }>`INSERT INTO service_records (product_id, type) VALUES (${product.id}, 'YEARLY_CARE') RETURNING id`.execute(t.db)).rows[0].id;
    await check(run(`INSERT INTO service_records (product_id, type) VALUES ('${product.id}', 'GILDING')`), 'an unknown service type');
    const insert = (cols: Record<string, string>) => {
      const all: Record<string, string> = { account_id: `'${account}'`, product_id: `'${product.id}'`, year: '2026', tier: '2', return_name: `'Camille Martin'`, return_address: `'12 rue de la Paix, Paris'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO care_requests (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    const label = { status: `'LABEL_SENT'`, label_at: 'now()', label_carrier_id: `'${carrier}'`, label_tracking: `'6A12345678901'`, label_pdf: `'\\x255044462d'::bytea` };
    await check(insert({ year: '2025' }), 'a year before 2026');
    await check(insert({ tier: '1' }), 'a TITANE request');
    await check(insert({ return_name: `'   '` }), 'a blank name');
    await check(insert({ return_address: `'${'x'.repeat(1001)}'` }), 'an address over 1 000 characters');
    await check(insert({ status: `'LABEL_SENT'` }), 'a label sent without its label', 'care_requests_steps');
    await check(insert({ ...label, label_tracking: `'!'` }), 'a malformed tracking number');
    await check(insert({ ...label, label_carrier_id: 'NULL' }), 'a label without its carrier');
    await check(insert({ ...label, status: `'RECEIVED'`, received_at: 'now()' }), 'received without its record');
    await check(insert({ status: `'CANCELLED'` }), 'cancelled without its time', 'care_requests_steps');
    await check(insert({ status: `'CANCELLED'`, cancelled_at: 'now()' }), 'cancelled without who');
    await check(insert({ cancelled_at: 'now()', cancelled_by: `'account'` }), 'a time of cancellation on an open request', 'care_requests_steps');
    await check(insert({ label_pdf: `'\\x25'::bytea` }), 'a PDF without its label', 'care_requests_label');
    await check(insert({ status: `'CANCELLED'`, cancelled_at: 'now()', cancelled_by: `'robot'` }), 'an unknown canceller');
    await check(insert({ note: `''` }), 'an empty note');
    // A request through its steps; once per piece and year while not cancelled.
    const id = (await insert({})).rows[0].id;
    await expect(insert({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'care_requests_once'));
    await run(`UPDATE care_requests SET status = 'LABEL_SENT', label_at = now(), label_carrier_id = '${carrier}', label_tracking = '6A12345678901', label_pdf = '\\x255044462d'::bytea WHERE id = '${id}'`);
    await run(`UPDATE care_requests SET status = 'RECEIVED', received_at = now(), service_record_id = '${record}' WHERE id = '${id}'`);
    await check(run(`UPDATE care_requests SET status = 'DONE', done_at = now() WHERE id = '${id}'`), 'done before it is shipped back', 'care_requests_steps');
    await run(`UPDATE care_requests SET status = 'RETURNING', return_carrier_id = '${carrier}', return_tracking = '6A12345678902', return_shipped_at = now() WHERE id = '${id}'`);
    await check(run(`UPDATE care_requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'admin' WHERE id = '${id}'`), 'cancelled once shipped back', 'care_requests_steps');
    await run(`UPDATE care_requests SET status = 'DONE', done_at = now() WHERE id = '${id}'`);
    // The label's PDF may be erased (the housekeeping); the identity, year, tier and address never change; never deleted.
    await run(`UPDATE care_requests SET label_pdf = NULL WHERE id = '${id}'`);
    for (const q of [
      `UPDATE care_requests SET return_address = 'Elsewhere' WHERE id = '${id}'`,
      `UPDATE care_requests SET year = 2027 WHERE id = '${id}'`,
      `UPDATE care_requests SET tier = 3 WHERE id = '${id}'`,
      `DELETE FROM care_requests WHERE id = '${id}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // A cancelled request gives the year back.
    const other = (await insert({ year: '2027' })).rows[0].id;
    await run(`UPDATE care_requests SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'account' WHERE id = '${other}'`);
    await insert({ year: '2027' });
    // The down step refuses while a request or a YEARLY_CARE record exists: neither can be removed, so this database stays at 0028.
    await expect(migrateDown(t.db)).rejects.toThrow(/0028_yearly_care cannot be rolled back: 3 care requests and 1 yearly care records exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0028_yearly_care')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (the service never deletes either).
    await run(`ALTER TABLE care_requests DISABLE TRIGGER care_requests_no_delete`);
    await run(`DELETE FROM care_requests`);
    await run(`ALTER TABLE care_requests ENABLE TRIGGER care_requests_no_delete`);
    await run(`DELETE FROM service_records WHERE type = 'YEARLY_CARE'`);
  });

  it('0013 adds ownership_certificates, bound to a piece and an ownership period, and nothing else; down drops it alone, and up again', async () => {
    const latest = await snapshot();
    const { with: withCertificates, without: before } = await rollBackTo('0013_ownership_certificates');
    const added = withCertificates.filter((o) => !before.includes(o));
    expect(added.filter((o) => !o.includes('ownership_certificates'))).toEqual([]);
    expect(before.filter((o) => o.includes('ownership_certificates'))).toEqual([]);
    expect(withCertificates.filter((o) => !o.includes('ownership_certificates'))).toEqual(before);
    // The token's hash (32 bytes, unique), the piece, the ownership period, at most 90 days, withdrawn after creation.
    for (const c of [
      /^constraint ownership_certificates ownership_certificates_lifetime CHECK \(\(\(expires_at > created_at\) AND \(\(expires_at - created_at\) <= '90 days'::interval\)\)\)$/,
      /^constraint ownership_certificates ownership_certificates_token_hash_check CHECK \(\(octet_length\(token_hash\) = 32\)\)$/,
      /^constraint ownership_certificates ownership_certificates_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint ownership_certificates ownership_certificates_ownership_id_fkey FOREIGN KEY \(ownership_id\) REFERENCES ownership\(id\) ON DELETE RESTRICT$/,
      /^constraint ownership_certificates ownership_certificates_check CHECK \(\(\(revoked_at IS NULL\) OR \(revoked_at >= created_at\)\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Later migrations (0014…) were rolled back first: up again applies them after it.
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0013_ownership_certificates'));
    expect(await snapshot()).toEqual(latest);
  });

  it('each migration of the 2026-10-02 plan (0004 to 0013) and of the 2026-10-03 one (0014 on) goes down to exactly the schema a fresh database has one migration earlier', async () => {
    // The tracks wrote them apart; deployed together, every down step must still land on its predecessor's schema.
    const names = Object.keys(MIGRATIONS);
    const first = names.indexOf('0004_scan_reports');
    expect(names.slice(first)).toEqual([
      '0004_scan_reports',
      '0005_account_recovery',
      '0006_admin_password_change_required',
      '0007_print_batch_indexes',
      '0008_retail_mode',
      '0009_scan_daily_stats',
      '0010_models_active',
      '0011_scan_token_transfer_accept',
      '0012_media',
      '0013_ownership_certificates',
      // The « Potentiel » plan of 2026-10-03 (docs/launch/DEPLOY-POTENTIEL-2026-10.md): deployment A.
      '0014_model_lookbook',
      '0015_drops',
      '0016_circle',
      '0017_drop_early_access',
      '0018_club_tiers',
      // Deployment B+C.
      '0019_model_discontinued',
      '0020_private_salon',
      // Deployment D: the LIVE RELEASE (plan of 2026-10-04).
      '0021_live_release',
      // LIVE RELEASE+ (plan of 2026-10-04): orders, stock and operations; releases and collectors.
      '0022_orders_stock',
      '0023_releases_collectors',
      // NOCTURNE (plan of 2026-10-05): the variants of a model and a draw's price.
      '0024_model_variants',
      // The next nine (plan of 2026-10-06), deployment G: the messages with ORBES Client Services; the club's program; the tiers' grants; the yearly care.
      '0025_client_messages',
      '0026_club_program',
      '0027_tier_grants',
      '0028_yearly_care',
    ]);
    // A fresh database migrated one step at a time: the schema after each migration, as a deployment builds it.
    const built = new Map<string, string[]>();
    const fresh = await createTestDb({ migrated: false });
    try {
      const migrator = createMigrator(fresh.db);
      for (const name of names) {
        const r = await migrator.migrateUp();
        expect(r.error, name).toBeUndefined();
        expect(r.results?.map((x) => x.migrationName)).toEqual([name]);
        built.set(name, await snapshotOf(fresh.db));
      }
    } finally {
      await fresh.close();
    }
    const latest = await snapshot();
    expect(latest).toEqual(built.get(names[names.length - 1]));
    // This database rolled back one migration at a time: each step lands on the fresh schema of the one before.
    for (let i = names.length - 1; i >= first; i--) {
      expect((await migrateDown(t.db)).reverted).toEqual([names[i]]);
      expect(await snapshot(), `${names[i]} down`).toEqual(built.get(names[i - 1]));
    }
    expect((await migrateToLatest(t.db)).applied).toEqual(names.slice(first));
    expect(await snapshot()).toEqual(latest);
  });

  it('roll back cleanly and re-apply', async () => {
    // One migration per call, newest first, until none is applied.
    const reverted: string[] = [];
    for (let i = 0; i < Object.keys(MIGRATIONS).length; i++) reverted.push(...(await migrateDown(t.db)).reverted);
    expect(reverted).toEqual(Object.keys(MIGRATIONS).reverse());
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'`.execute(t.db);
    expect(r.rows[0].n).toBe(0);
    expect((await migrateToLatest(t.db)).applied).toEqual(Object.keys(MIGRATIONS));
  });
});
