import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createTestDb, type TestDb } from '../support/db.js';
import { isCheckViolation, isForeignKeyViolation, isGuardViolation, isUniqueViolation, PG_ERROR, pgError } from '../../src/server/db/pg-errors.js';
import { createMigrator, migrateDown, migrateToLatest, migrationStatus, MIGRATIONS } from '../../src/server/db/migrate.js';
import {
  CONVERSION_KINDS,
  DEVICE_BROWSERS,
  EMAIL_KINDS,
  EMAIL_STATUSES,
  DEVICE_KINDS,
  DEVICE_SYSTEMS,
  HOUSE_CURRENCIES,
  HOUSE_DELIVERY_SOURCES,
  HOUSE_MESSAGE_STATUSES,
  HOUSE_MOMENTS,
  IN_APPS,
  LINK_DESTINATIONS,
  LINK_VIAS,
  MEDIA_MIME_TYPES,
  OPENED_IN,
  RECOVERY_ISSUED_VIA,
  SCORE_ACT_KINDS,
  SCORE_OTHER_CURRENCIES,
  SOURCE_KINDS,
  SOURCE_SET_BY,
  TEST_RUN_STATUSES,
  VIEW_PAGE_CODES,
  VIEW_PAGE_MAX,
  VIEW_PAGES,
  WORN_REFUSALS,
  WORN_STATUSES,
} from '../../src/server/db/schema.js';
import * as m0007 from '../../src/server/db/migrations/0007_print_batch_indexes.js';
import * as m0009 from '../../src/server/db/migrations/0009_scan_daily_stats.js';
import * as m0011 from '../../src/server/db/migrations/0011_scan_token_transfer_accept.js';
import * as m0035 from '../../src/server/db/migrations/0035_logistics_access.js';
import * as m0036 from '../../src/server/db/migrations/0036_supplier_orders.js';
import * as m0037 from '../../src/server/db/migrations/0037_fulfilment.js';
import * as m0048 from '../../src/server/db/migrations/0048_orbes_care.js';
import * as m0054 from '../../src/server/db/migrations/0054_boxes_weights.js';
import * as m0056 from '../../src/server/db/migrations/0056_addons.js';
import * as m0057 from '../../src/server/db/migrations/0057_sets.js';
import * as m0059 from '../../src/server/db/migrations/0059_addons_one_system.js';
import * as m0060 from '../../src/server/db/migrations/0060_release_addons_converted.js';
import * as m0061 from '../../src/server/db/migrations/0061_the_vault.js';
import * as m0062 from '../../src/server/db/migrations/0062_vault_rewards.js';
import { AddonService } from '../../src/server/services/addons.js';
import { accountLiveData } from '../../src/server/services/live.js';
import { OrderAddonService } from '../../src/server/services/order-addons.js';
import { OrderService } from '../../src/server/services/orders.js';
import { StockService } from '../../src/server/services/stock.js';
import type { Actor } from '../../src/server/types.js';
import { poolDraw } from '../support/draws.js';
import { createAccount, createLiveRelease, legacyLiveAddons, liveFixture, type LiveFixture } from '../support/live.js';

/**
 * THE VAULT's hooks on the paths that make orders (lot Q3: `attachVaultAddons`, `giveTierVaults`, `giveLiveVaults`) and
 * the sales paths' vault-only check (`assertSellable`, `assertSetSellable`) read tables and columns that exist from 0061 on. A case that writes the data of before with today's services at an older schema (0060's
 * "on the data of before") switches them off while it writes, as the image of before had none; everywhere else they run
 * as they are.
 */
const vaultHooks = vi.hoisted(() => ({ off: false }));
vi.mock('../../src/server/services/order-addons.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/services/order-addons.js')>();
  return { ...actual, attachVaultAddons: (...a: Parameters<typeof actual.attachVaultAddons>) => (vaultHooks.off ? Promise.resolve({ unitIds: [], notes: [] }) : actual.attachVaultAddons(...a)) };
});
vi.mock('../../src/server/services/vault.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/services/vault.js')>();
  return {
    ...actual,
    giveTierVaults: (...a: Parameters<typeof actual.giveTierVaults>) => (vaultHooks.off ? Promise.resolve([]) : actual.giveTierVaults(...a)),
    giveLiveVaults: (...a: Parameters<typeof actual.giveLiveVaults>) => (vaultHooks.off ? Promise.resolve([]) : actual.giveLiveVaults(...a)),
  };
});
vi.mock('../../src/server/services/vault-orders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/services/vault-orders.js')>();
  return {
    ...actual,
    assertSellable: (...a: Parameters<typeof actual.assertSellable>) => (vaultHooks.off ? Promise.resolve() : actual.assertSellable(...a)),
    assertSetSellable: (...a: Parameters<typeof actual.assertSetSellable>) => (vaultHooks.off ? Promise.resolve() : actual.assertSetSellable(...a)),
  };
});

/** stock_holds as 0056 wrote it, read back by pg_get_viewdef (whitespace folded). */
const STOCK_HOLDS_0056 =
  "SELECT o.sku_id, o.location_id, o.reservation, o.reserved_at, 'PIECE'::text AS kind, o.id FROM orders o WHERE o.reservation IS NOT NULL UNION ALL SELECT u.sku_id, u.location_id, 'STOCK'::text AS reservation, u.added_at AS reserved_at, 'ADD_ON'::text AS kind, u.id FROM order_addon_items u WHERE u.status = 'HELD'::text;";
/** stock_holds since 0059: the units held at a location only (a service's unit holds no stock). */
const STOCK_HOLDS_0059 =
  "SELECT o.sku_id, o.location_id, o.reservation, o.reserved_at, 'PIECE'::text AS kind, o.id FROM orders o WHERE o.reservation IS NOT NULL UNION ALL SELECT u.sku_id, u.location_id, 'STOCK'::text AS reservation, u.added_at AS reserved_at, 'ADD_ON'::text AS kind, u.id FROM order_addon_items u WHERE u.status = 'HELD'::text AND u.location_id IS NOT NULL;";

const EXPECTED_TABLES = [
  'account_addresses', 'account_notes', 'account_profiles', 'account_recovery_codes', 'account_scores', 'account_sizes', 'account_sources', 'account_tags', 'account_tastes', 'account_wishes', 'accounts', 'acquisition_conversions', 'acquisition_daily', 'acquisition_sources', 'acquisition_state', 'acquisition_touches', 'activity_hourly', 'addon_choices', 'addon_conversions', 'addon_item_prices', 'addon_items', 'admin_user_locations', 'admin_users', 'after_room_guests', 'anomalies', 'audit_logs',
  'authentication_events', 'bench_items', 'boxes', 'card_prints', 'care_requests', 'carriers', 'categories', 'category_allowances', 'circle_daily_visits', 'circle_poll_votes',
  'circle_post_images', 'circle_posts', 'circle_rsvps', 'claim_code_renewals', 'client_conversations', 'client_messages', 'club_program_settings', 'club_tiers', 'codes',
  'collections', 'collector_history', 'collector_places', 'collector_view_months', 'collector_view_totals', 'collector_views', 'credit_uses', 'cryptographic_keys', 'currency_rates', 'device_daily_stats', 'drop_addons', 'drop_entries', 'drop_entry_sizes', 'drop_sizes', 'drops', 'email_outbox', 'email_preferences', 'email_state', 'email_templates', 'engagement_runs', 'event_journal', 'genomes', 'geo_places', 'guarantee_settings', 'heard_options',
  'house_deliveries', 'house_guarantees', 'house_messages', 'house_moment_settings', 'invitations', 'invoices', 'link_channels', 'links', 'live_access_models', 'live_entries', 'live_entry_sizes', 'live_interest', 'live_interest_sizes', 'live_messages',
  'live_tier_windows', 'margin_unit_costs', 'media_objects', 'model_images', 'model_pairs', 'model_wish_months', 'models', 'order_addon_items', 'order_alert_settings', 'order_cases', 'order_events', 'orders', 'ownership',
  'ownership_certificates', 'ownership_transfers', 'partner_experiences', 'partner_invoices', 'partners', 'preregistrations', 'product_status_history', 'products', 'reception_lines', 'receptions', 'release_answers', 'retailers', 'returns', 'revocations',
  'scan_daily_stats', 'scan_events', 'scan_reports', 'scan_tokens', 'segments', 'service_records', 'sessions', 'set_models', 'set_sales', 'sets', 'shipment_items', 'shipments', 'shipping_cost_rates', 'shipping_rates', 'shop_requests',
  'sku_thresholds', 'skus', 'stock_corrections', 'stock_location_countries', 'stock_locations', 'stock_movements', 'supplier_order_lines', 'supplier_orders', 'supplier_returns', 'suppliers', 'test_entrants', 'test_run_entrants', 'test_runs', 'tier_grants', 'tracking_device_accounts', 'tracking_devices', 'tracking_state', 'vault_gifts', 'vault_occasions_before', 'vault_rewards', 'vault_sources', 'vaults', 'view_daily_stats', 'warranties', 'warranty_claims', 'wish_months_counted', 'worn_photos',
];

/**
 * The LIVE releases this suite writes at the latest schema without naming a pace, given one there because 0058's
 * `drops_live_paced` requires it (lot Q1, step Q1.2). Below 0049 no pace exists, and 0049's down refuses a paced release:
 * `down` takes their pace away just before reverting 0049, and `up` gives it back to those still open just before 0058
 * is applied, so every case reads the schemas it always read. Rows written with a pace of their own never change here.
 */
const autoPaced = new Set<string>();

async function down(db: Kysely<any>): Promise<{ reverted: string[] }> {
  if (autoPaced.size > 0) {
    const applied = (await migrationStatus(db)).filter((m) => m.executedAt).map((m) => m.name);
    if (applied.at(-1) === '0049_live_pace') {
      await sql`UPDATE drops SET pace_batch = NULL, pace_minutes = NULL WHERE id IN (${sql.join([...autoPaced])})`.execute(db);
    }
  }
  return migrateDown(db);
}

async function up(db: Kysely<any>): Promise<{ applied: string[] }> {
  const applied: string[] = [];
  const status = await migrationStatus(db);
  const done = (name: string) => status.find((m) => m.name === name)?.executedAt !== undefined;
  if (autoPaced.size > 0 && !done('0058_one_queue')) {
    if (!done('0057_sets')) {
      const rs = await createMigrator(db).migrateTo('0057_sets');
      if (rs.error) throw rs.error;
      applied.push(...(rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName));
    }
    await sql`UPDATE drops SET pace_batch = 250, pace_minutes = 1
               WHERE id IN (${sql.join([...autoPaced])}) AND pace_batch IS NULL AND parent_drop_id IS NULL AND ended_at IS NULL AND cancelled_at IS NULL`.execute(db);
  }
  return { applied: [...applied, ...(await migrateToLatest(db)).applied] };
}

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
  });
  afterAll(() => t.close());

  it('apply to an empty database, then are a no-op', async () => {
    const first = await up(t.db);
    expect(first.applied).toEqual(Object.keys(MIGRATIONS));
    const second = await up(t.db);
    expect(second.applied).toEqual([]);
    const status = await migrationStatus(t.db);
    expect(status.every((m) => m.executedAt instanceof Date)).toBe(true);
  });

  it('create every contract table and the product_overview and stock_holds views', async () => {
    const r = await sql<{ table_name: string; table_type: string }>`
      SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%' ORDER BY table_name`.execute(t.db);
    const tables = r.rows.filter((x) => x.table_type === 'BASE TABLE').map((x) => x.table_name);
    const views = r.rows.filter((x) => x.table_type === 'VIEW').map((x) => x.table_name);
    expect(tables).toEqual(EXPECTED_TABLES);
    expect(views).toEqual(['product_overview', 'stock_holds']);
  });

  it('seed no business data', async () => {
    // 0061 (THE VAULT) inserts its settings, never business data: the seven sources and the I WAS THERE floor.
    const settings: Record<string, number> = { vault_sources: 7, vault_rewards: 1 };
    for (const table of EXPECTED_TABLES) {
      const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(t.db);
      expect(r.rows[0].n, table).toBe(settings[table] ?? 0);
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
    // A size's label once per drop (0021), per drop and piece since 0057 (a set's release gives its sizes per piece).
    expect(has(/UNIQUE INDEX drop_sizes_label_key ON public\.drop_sizes USING btree \(drop_id, piece, label\) NULLS NOT DISTINCT$/)).toBe(true);
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
    // One SKU per model and size (0022), the models' SKUs only since 0056 (an add-on's SKU has neither).
    expect(has(/UNIQUE INDEX skus_model_size_key ON public\.skus USING btree \(model_id, upper\(size_label\)\) NULLS NOT DISTINCT WHERE \(model_id IS NOT NULL\)$/)).toBe(true);
    expect(has(/INDEX products_sku_id_idx ON public\.products USING btree \(sku_id\)$/)).toBe(true);
    expect(has(/INDEX drop_sizes_sku_id_idx ON public\.drop_sizes USING btree \(sku_id\)$/)).toBe(true);
    expect(has(/INDEX drops_stock_location_id_idx ON public\.drops USING btree \(stock_location_id\)$/)).toBe(true);
    expect(has(/INDEX stock_movements_balance_idx ON public\.stock_movements USING btree \(sku_id, location_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX stock_movements_transfer_key ON public\.stock_movements USING btree \(transfer_id, reason\) WHERE \(transfer_id IS NOT NULL\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_live_entry_key ON public\.orders USING btree \(live_entry_id, piece\)$/)).toBe(true);
    // 0029 widened it to one order per entry and piece (a guaranteed place of several pieces).
    expect(has(/UNIQUE INDEX orders_drop_entry_key ON public\.orders USING btree \(drop_entry_id, piece\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_shop_request_key ON public\.orders USING btree \(shop_request_id\)$/)).toBe(true);
    expect(has(/INDEX orders_board_idx ON public\.orders USING btree \(status, reserved_at\)$/)).toBe(true);
    expect(has(/INDEX orders_stock_reservation_idx ON public\.orders USING btree \(sku_id, location_id\) WHERE \(reservation = 'STOCK'::text\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX orders_product_key ON public\.orders USING btree \(product_id\) WHERE \(status = ANY \(ARRAY\['RESERVED'::text, 'PAID'::text, 'SHIPPED'::text, 'DELIVERED'::text\]\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX bench_items_one_open ON public\.bench_items USING btree \(order_id\) WHERE \(status = ANY \(ARRAY\['TO_MAKE'::text, 'IN_PROGRESS'::text\]\)\)$/)).toBe(true);
    // 0039 rebuilt it without the supplementary invoices (below).
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
    // 0029: the house's guarantee. An account's by status; those set aside for a release; those waiting for one; one ACTIVE
    // per account and release; a guarantee used once per entry; a draw's order per piece; every foreign key at the head of
    // an index.
    expect(has(/INDEX house_guarantees_account_idx ON public\.house_guarantees USING btree \(account_id, status\)$/)).toBe(true);
    expect(has(/INDEX house_guarantees_covered_idx ON public\.house_guarantees USING btree \(covered_drop_id\) WHERE \(status = 'ACTIVE'::text\)$/)).toBe(true);
    expect(has(/INDEX house_guarantees_waiting_idx ON public\.house_guarantees USING btree \(scope, model_id, collection_id\) WHERE \(\(status = 'ACTIVE'::text\) AND \(covered_drop_id IS NULL\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX house_guarantees_one_per_release ON public\.house_guarantees USING btree \(account_id, covered_drop_id\) WHERE \(\(status = 'ACTIVE'::text\) AND \(covered_drop_id IS NOT NULL\)\)$/)).toBe(true);
    for (const c of ['drop', 'model', 'collection', 'covered_drop', 'used_drop']) {
      expect(has(new RegExp(`INDEX house_guarantees_${c}_idx ON public\\.house_guarantees USING btree \\(${c}_id\\)$`)), c).toBe(true);
    }
    for (const c of ['revoked_by', 'granted_by', 'updated_by']) expect(has(new RegExp(`INDEX house_guarantees_${c}_idx ON public\\.house_guarantees USING btree \\(${c}\\)$`)), c).toBe(true);
    expect(has(/INDEX guarantee_settings_updated_by_idx ON public\.guarantee_settings USING btree \(updated_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_entries_guarantee_key ON public\.drop_entries USING btree \(guarantee_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX live_entries_guarantee_key ON public\.live_entries USING btree \(guarantee_id\)$/)).toBe(true);
    // 0031: a model's pairs. One per model and place, a model paired once per model; every foreign key at the head of an
    // index.
    expect(has(/UNIQUE INDEX model_pairs_pkey ON public\.model_pairs USING btree \(model_id, "?position"?\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_pairs_model_paired_key ON public\.model_pairs USING btree \(model_id, paired_model_id\)$/)).toBe(true);
    expect(has(/INDEX model_pairs_paired_model_idx ON public\.model_pairs USING btree \(paired_model_id\)$/)).toBe(true);
    expect(has(/INDEX model_pairs_created_by_idx ON public\.model_pairs USING btree \(created_by\)$/)).toBe(true);
    // 0032: GROWTH's readings. The accounts by creation; an account's ownerships in the order they began; an account's
    // paid orders in the order they were paid.
    expect(has(/INDEX accounts_created_at_idx ON public\.accounts USING btree \(created_at\)$/)).toBe(true);
    expect(has(/INDEX ownership_account_started_idx ON public\.ownership USING btree \(account_id, started_at\)$/)).toBe(true);
    expect(has(/INDEX orders_paid_idx ON public\.orders USING btree \(account_id, paid_at\) WHERE \(paid_at IS NOT NULL\)$/)).toBe(true);
    // 0033: a model's offered sizes; who set a size aside, its foreign key at the head of an index.
    expect(has(/INDEX skus_model_offered_idx ON public\.skus USING btree \(model_id\) WHERE \(set_aside_at IS NULL\)$/)).toBe(true);
    expect(has(/INDEX skus_set_aside_by_idx ON public\.skus USING btree \(set_aside_by\)$/)).toBe(true);
    // 0034: a piece's new claim codes in the order they were made, one waiting per piece; the order, the account and the
    // author each at the head of an index.
    expect(has(/INDEX claim_code_renewals_product_idx ON public\.claim_code_renewals USING btree \(product_id, created_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX claim_code_renewals_waiting_key ON public\.claim_code_renewals USING btree \(product_id\) WHERE \(status = 'WAITING'::text\)$/)).toBe(true);
    for (const c of ['order_id', 'account_id', 'created_by']) {
      const name = c === 'created_by' ? 'created_by' : c.replace('_id', '');
      expect(has(new RegExp(`INDEX claim_code_renewals_${name}_idx ON public\\.claim_code_renewals USING btree \\(${c}\\)$`)), c).toBe(true);
    }
    // 0035: a LOGISTICS login's locations, by login (its key) and by location; a supplier's name once whatever the case;
    // each foreign key at the head of an index.
    expect(has(/UNIQUE INDEX admin_user_locations_pkey ON public\.admin_user_locations USING btree \(admin_user_id, stock_location_id\)$/)).toBe(true);
    expect(has(/INDEX admin_user_locations_location_idx ON public\.admin_user_locations USING btree \(stock_location_id\)$/)).toBe(true);
    expect(has(/INDEX admin_user_locations_created_by_idx ON public\.admin_user_locations USING btree \(created_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX suppliers_name_key ON public\.suppliers USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/INDEX suppliers_created_by_idx ON public\.suppliers USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX models_supplier_id_idx ON public\.models USING btree \(supplier_id\)$/)).toBe(true);
    expect(has(/INDEX skus_supplier_id_idx ON public\.skus USING btree \(supplier_id\)$/)).toBe(true);
    // 0036: one draft per supplier and location, one open reception per supplier order, a SKU once per order and per
    // reception; the supplier orders by status and date; every foreign key at the head of an index.
    expect(has(/UNIQUE INDEX supplier_orders_one_draft ON public\.supplier_orders USING btree \(supplier_id, location_id\) WHERE \(status = 'DRAFT'::text\)$/)).toBe(true);
    expect(has(/INDEX supplier_orders_status_idx ON public\.supplier_orders USING btree \(status, expected_on\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX receptions_one_open ON public\.receptions USING btree \(supplier_order_id\) WHERE \(status = ANY \(ARRAY\['TO_CONFIRM'::text, 'SENT_BACK'::text\]\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX supplier_order_lines_order_sku_key ON public\.supplier_order_lines USING btree \(supplier_order_id, sku_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX reception_lines_reception_sku_key ON public\.reception_lines USING btree \(reception_id, sku_id\)$/)).toBe(true);
    expect(has(/INDEX stock_movements_reception_line_idx ON public\.stock_movements USING btree \(reception_line_id\)$/)).toBe(true);
    expect(has(/INDEX products_reception_line_idx ON public\.products USING btree \(reception_line_id\)$/)).toBe(true);
    expect(has(/INDEX card_prints_reception_idx ON public\.card_prints USING btree \(reception_id\)$/)).toBe(true);
    // 0038: an entry's size, with its drop at the head (the composite foreign key), its status and rank for the draw's fill.
    expect(has(/INDEX drop_entries_size_idx ON public\.drop_entries USING btree \(drop_id, size_id, status, rank\)$/)).toBe(true);
    // 0039: an account's saved addresses in the order they were made, one default; one main invoice per order, a
    // supplementary one by the invoice it supplements, credit notes for single lines then one in full; every foreign key
    // at the head of an index (its engraving prices went with 0060).
    expect(has(/INDEX account_addresses_account_idx ON public\.account_addresses USING btree \(account_id, created_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_addresses_one_default ON public\.account_addresses USING btree \(account_id\) WHERE is_default$/)).toBe(true);
    expect(has(/UNIQUE INDEX invoices_one_per_order ON public\.invoices USING btree \(order_id\) WHERE \(\(kind = 'INVOICE'::text\) AND \(supplements_invoice_id IS NULL\)\)$/)).toBe(true);
    expect(has(/INDEX invoices_supplements_idx ON public\.invoices USING btree \(supplements_invoice_id\)$/)).toBe(true);
    expect(has(/INDEX invoices_credits_idx ON public\.invoices USING btree \(credits_invoice_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX invoices_full_credit_key ON public\.invoices USING btree \(credits_invoice_id\) WHERE \(credit_scope = 'FULL'::text\)$/)).toBe(true);
    // 0040: one heard answer per label whatever the case, one Other; a profile's heard answer at the head of its own
    // index; an account's tastes keyed by the account, and by kind and key for Segments and the counts.
    expect(has(/UNIQUE INDEX heard_options_label_key ON public\.heard_options USING btree \(lower\(label\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX heard_options_one_other ON public\.heard_options USING btree \(is_other\) WHERE is_other$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_profiles_pkey ON public\.account_profiles USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX account_profiles_heard_option_idx ON public\.account_profiles USING btree \(heard_option_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_tastes_pkey ON public\.account_tastes USING btree \(account_id, kind, value_key\)$/)).toBe(true);
    expect(has(/INDEX account_tastes_key_idx ON public\.account_tastes USING btree \(kind, value_key\)$/)).toBe(true);
    // 0041: one open wish per account and model; a model's wishes by when they were added (its foreign key at the head);
    // the removed ones for the purge; a model's months.
    expect(has(/UNIQUE INDEX account_wishes_pkey ON public\.account_wishes USING btree \(account_id, model_id, added_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_wishes_open ON public\.account_wishes USING btree \(account_id, model_id\) WHERE \(removed_at IS NULL\)$/)).toBe(true);
    expect(has(/INDEX account_wishes_model_idx ON public\.account_wishes USING btree \(model_id, added_at\)$/)).toBe(true);
    expect(has(/INDEX account_wishes_removed_idx ON public\.account_wishes USING btree \(removed_at\) WHERE \(removed_at IS NOT NULL\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX model_wish_months_pkey ON public\.model_wish_months USING btree \(month, model_id\)$/)).toBe(true);
    expect(has(/INDEX model_wish_months_model_idx ON public\.model_wish_months USING btree \(model_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX wish_months_counted_pkey ON public\.wish_months_counted USING btree \(month\)$/)).toBe(true);
    // 0042: a place once per country and city; a device once per pseudonym, by account, place and last sight; a view by
    // when (a b-tree, not BRIN), by device and by account; each foreign key at the head of a full index.
    expect(has(/UNIQUE INDEX geo_places_key ON public\.geo_places USING btree \(country, city\) NULLS NOT DISTINCT$/)).toBe(true);
    expect(has(/UNIQUE INDEX tracking_devices_device_hash_key ON public\.tracking_devices USING btree \(device_hash\)$/)).toBe(true);
    expect(has(/INDEX tracking_devices_account_idx ON public\.tracking_devices USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX tracking_devices_place_idx ON public\.tracking_devices USING btree \(last_place_id\)$/)).toBe(true);
    expect(has(/INDEX tracking_devices_seen_idx ON public\.tracking_devices USING btree \(last_seen_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX tracking_device_accounts_pkey ON public\.tracking_device_accounts USING btree \(device_id, account_id\)$/)).toBe(true);
    expect(has(/INDEX tracking_device_accounts_account_idx ON public\.tracking_device_accounts USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX collector_views_at_idx ON public\.collector_views USING btree \(at\)$/)).toBe(true);
    expect(has(/INDEX collector_views_device_idx ON public\.collector_views USING btree \(device_id, at\)$/)).toBe(true);
    expect(has(/INDEX collector_views_account_idx ON public\.collector_views USING btree \(account_id, at\)$/)).toBe(true);
    expect(defs.some((d) => /ON public\.collector_views USING brin/.test(d))).toBe(false);
    expect(has(/UNIQUE INDEX view_daily_stats_pkey ON public\.view_daily_stats USING btree \(day, page, subject, country\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX device_daily_stats_pkey ON public\.device_daily_stats USING btree \(day, country, kind, os, browser, opened_in, in_app\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX collector_places_pkey ON public\.collector_places USING btree \(account_id, place_id\)$/)).toBe(true);
    expect(has(/INDEX collector_places_place_idx ON public\.collector_places USING btree \(place_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX collector_view_totals_pkey ON public\.collector_view_totals USING btree \(account_id, page, subject\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX collector_view_months_pkey ON public\.collector_view_months USING btree \(account_id, month\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX tracking_state_pkey ON public\.tracking_state USING btree \(id\)$/)).toBe(true);
    // 0043: a channel's name once whatever its case; a link's address once; a source once by its key; a visit once per
    // device, source and Paris day; a conversion once per act; the watermark's three indexes on existing tables; each
    // foreign key at the head of a full index.
    expect(has(/UNIQUE INDEX link_channels_name_key ON public\.link_channels USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/INDEX link_channels_created_by_idx ON public\.link_channels USING btree \(created_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX links_code_key ON public\.links USING btree \(code\)$/)).toBe(true);
    expect(has(/INDEX links_channel_idx ON public\.links USING btree \(channel_id, created_at\)$/)).toBe(true);
    expect(has(/INDEX links_drop_idx ON public\.links USING btree \(drop_id\)$/)).toBe(true);
    expect(has(/INDEX links_model_idx ON public\.links USING btree \(model_id\)$/)).toBe(true);
    expect(has(/INDEX links_archived_by_idx ON public\.links USING btree \(archived_by\)$/)).toBe(true);
    expect(has(/INDEX links_created_by_idx ON public\.links USING btree \(created_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX acquisition_sources_key ON public\.acquisition_sources USING btree \(key\)$/)).toBe(true);
    expect(has(/INDEX acquisition_sources_link_idx ON public\.acquisition_sources USING btree \(link_id\)$/)).toBe(true);
    expect(has(/INDEX acquisition_sources_created_idx ON public\.acquisition_sources USING btree \(created_at\)$/)).toBe(true);
    expect(has(/INDEX tracking_devices_first_source_idx ON public\.tracking_devices USING btree \(first_source_id, first_seen_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX acquisition_touches_visit ON public\.acquisition_touches USING btree \(device_id, source_id, day\)$/)).toBe(true);
    expect(has(/INDEX acquisition_touches_source_day ON public\.acquisition_touches USING btree \(source_id, day\)$/)).toBe(true);
    expect(has(/INDEX acquisition_touches_account ON public\.acquisition_touches USING btree \(account_id, last_at\)$/)).toBe(true);
    expect(has(/INDEX acquisition_touches_day ON public\.acquisition_touches USING btree \(day\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_sources_pkey ON public\.account_sources USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX account_sources_first_idx ON public\.account_sources USING btree \(first_source_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX acquisition_conversions_ref ON public\.acquisition_conversions USING btree \(kind, ref_id\)$/)).toBe(true);
    expect(has(/INDEX acquisition_conversions_account_idx ON public\.acquisition_conversions USING btree \(account_id, kind\)$/)).toBe(true);
    expect(has(/INDEX acquisition_conversions_last_idx ON public\.acquisition_conversions USING btree \(last_source_id, kind, at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX acquisition_daily_pkey ON public\.acquisition_daily USING btree \(source_id, day\)$/)).toBe(true);
    expect(has(/INDEX acquisition_daily_day_idx ON public\.acquisition_daily USING btree \(day\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX acquisition_state_pkey ON public\.acquisition_state USING btree \(id\)$/)).toBe(true);
    expect(has(/INDEX drop_entries_created_idx ON public\.drop_entries USING btree \(created_at\)$/)).toBe(true);
    expect(has(/INDEX live_entries_joined_idx ON public\.live_entries USING btree \(joined_at\)$/)).toBe(true);
    expect(has(/INDEX orders_reserved_idx ON public\.orders USING btree \(reserved_at\)$/)).toBe(true);
    // 0044: a client's private notes newest first while not removed, and every foreign key at the head of a full index;
    // a tag once per account, and by its words; an account's sign-ins on the audit log; the cities folded.
    expect(has(/INDEX account_notes_account_idx ON public\.account_notes USING btree \(account_id, created_at DESC\) WHERE \(removed_at IS NULL\)$/)).toBe(true);
    expect(has(/INDEX account_notes_account_all_idx ON public\.account_notes USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX account_notes_created_by_idx ON public\.account_notes USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX account_notes_removed_by_idx ON public\.account_notes USING btree \(removed_by\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX account_tags_pkey ON public\.account_tags USING btree \(account_id, tag\)$/)).toBe(true);
    expect(has(/INDEX account_tags_tag_idx ON public\.account_tags USING btree \(tag\)$/)).toBe(true);
    expect(has(/INDEX account_tags_created_by_idx ON public\.account_tags USING btree \(created_by\)$/)).toBe(true);
    expect(has(/INDEX audit_logs_account_login_idx ON public\.audit_logs USING btree \(target_id, occurred_at\) WHERE \(action = 'account\.login'::text\)$/)).toBe(true);
    expect(has(/INDEX account_profiles_city_fold_idx ON public\.account_profiles USING btree \(orbes_fold\(city\)\) WHERE \(city IS NOT NULL\)$/)).toBe(true);
    // 0045: one birthday credit per account and birthday.
    expect(has(/UNIQUE INDEX tier_grants_birthday_key ON public\.tier_grants USING btree \(account_id, birthday_on\) WHERE \(kind = 'BIRTHDAY'::text\)$/)).toBe(true);
    // 0046: a score by its account (the key, which leads the foreign key), the scores by value, a run by its Paris day.
    expect(has(/UNIQUE INDEX account_scores_pkey ON public\.account_scores USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX account_scores_score_idx ON public\.account_scores USING btree \(score\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX engagement_runs_pkey ON public\.engagement_runs USING btree \(day\)$/)).toBe(true);
    // 0047: a collector's history by its account (the key, which leads the foreign key).
    expect(has(/UNIQUE INDEX collector_history_pkey ON public\.collector_history USING btree \(account_id\)$/)).toBe(true);
    // 0048: the claims of a piece, of an original piece, of an account, by status; one live claim per piece; one free
    // replacement per original piece under the lifetime warranty.
    expect(has(/INDEX warranty_claims_product_idx ON public\.warranty_claims USING btree \(product_id, opened_at\)$/)).toBe(true);
    expect(has(/INDEX warranty_claims_root_idx ON public\.warranty_claims USING btree \(root_product_id\)$/)).toBe(true);
    expect(has(/INDEX warranty_claims_account_idx ON public\.warranty_claims USING btree \(account_id, opened_at\)$/)).toBe(true);
    expect(has(/INDEX warranty_claims_status_idx ON public\.warranty_claims USING btree \(status, opened_at\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX warranty_claims_open_once ON public\.warranty_claims USING btree \(product_id\) WHERE \(status = ANY \(ARRAY\['OPEN'::text, 'LABEL_SENT'::text, 'RECEIVED'::text, 'DECIDED'::text\]\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX warranty_claims_free_once ON public\.warranty_claims USING btree \(root_product_id\) WHERE \(\(basis = 'LIFETIME'::text\) AND \(outcome = ANY \(ARRAY\['REPLACEMENT'::text, 'VALUE_CREDIT'::text\]\)\)\)$/)).toBe(true);
    // 0049: the entries waiting for their batch, in the line's order (the guarantees first, then the places).
    expect(has(/INDEX live_entries_waiting_admission ON public\.live_entries USING btree \(drop_id, \(\(guarantee_id IS NULL\)\), "?position"?\) WHERE \(\(status = 'QUEUED'::text\) AND \(admitted_at IS NULL\)\)$/)).toBe(true);
    // 0050: an address once on the founding list; its source and its account each at the head of an index.
    expect(has(/UNIQUE INDEX preregistrations_email_normalized_key ON public\.preregistrations USING btree \(email_normalized\)$/)).toBe(true);
    expect(has(/INDEX preregistrations_source_idx ON public\.preregistrations USING btree \(source_id\)$/)).toBe(true);
    expect(has(/INDEX preregistrations_account_idx ON public\.preregistrations USING btree \(account_id\)$/)).toBe(true);
    // 0051: an email once per key; the sender's due rows; an email's account, its pre-registration and a template's author
    // each at the head of an index.
    expect(has(/UNIQUE INDEX email_outbox_dedupe_key ON public\.email_outbox USING btree \(dedupe_key\)$/)).toBe(true);
    expect(has(/INDEX email_outbox_due ON public\.email_outbox USING btree \(status, not_before\)$/)).toBe(true);
    expect(has(/INDEX email_outbox_account_idx ON public\.email_outbox USING btree \(account_id\)$/)).toBe(true);
    expect(has(/INDEX email_outbox_preregistration_idx ON public\.email_outbox USING btree \(preregistration_id\)$/)).toBe(true);
    expect(has(/INDEX email_templates_updated_by_idx ON public\.email_templates USING btree \(updated_by\)$/)).toBe(true);
    // 0052: a house delivery once per key; an account's messages newest first and its unread ones; a message's deliveries
    // and a moment's; the house sender's due messages.
    expect(has(/UNIQUE INDEX house_deliveries_dedupe_key ON public\.house_deliveries USING btree \(dedupe_key\)$/)).toBe(true);
    expect(has(/INDEX house_deliveries_account_idx ON public\.house_deliveries USING btree \(account_id, delivered_at DESC\)$/)).toBe(true);
    expect(has(/INDEX house_deliveries_unread_idx ON public\.house_deliveries USING btree \(account_id\) WHERE \(read_at IS NULL\)$/)).toBe(true);
    expect(has(/INDEX house_deliveries_message_idx ON public\.house_deliveries USING btree \(house_message_id\)$/)).toBe(true);
    expect(has(/INDEX house_deliveries_moment_idx ON public\.house_deliveries USING btree \(moment, delivered_at\)$/)).toBe(true);
    expect(has(/INDEX house_messages_due ON public\.house_messages USING btree \(status, send_at\)$/)).toBe(true);
    // 0053: one live WORN photograph per piece; a model's published ones newest first; the review queue; an account's
    // photographs over time.
    expect(has(/UNIQUE INDEX worn_photos_live_once ON public\.worn_photos USING btree \(product_id\) WHERE \(status = ANY \(ARRAY\['PENDING'::text, 'PUBLISHED'::text\]\)\)$/)).toBe(true);
    expect(has(/INDEX worn_photos_sheet ON public\.worn_photos USING btree \(model_id, published_at DESC\) WHERE \(status = 'PUBLISHED'::text\)$/)).toBe(true);
    expect(has(/INDEX worn_photos_queue ON public\.worn_photos USING btree \(status, created_at\)$/)).toBe(true);
    expect(has(/INDEX worn_photos_account_idx ON public\.worn_photos USING btree \(account_id, created_at\)$/)).toBe(true);
    // 0054: a box's name once whatever the case.
    expect(has(/UNIQUE INDEX boxes_name_key ON public\.boxes USING btree \(lower\(name\)\)$/)).toBe(true);
    // 0055: one location per country; a location's countries.
    expect(has(/UNIQUE INDEX stock_location_countries_pkey ON public\.stock_location_countries USING btree \(country\)$/)).toBe(true);
    expect(has(/INDEX stock_location_countries_location_idx ON public\.stock_location_countries USING btree \(location_id\)$/)).toBe(true);
    // 0056: an add-on's name once whatever the case; the units held at a location.
    expect(has(/UNIQUE INDEX addon_items_name_key ON public\.addon_items USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/INDEX order_addon_items_held_idx ON public\.order_addon_items USING btree \(sku_id, location_id\) WHERE \(status = 'HELD'::text\)$/)).toBe(true);
    // 0057: a set's name once whatever the case; a release's size label once per piece; a set's releases, a set sale's
    // orders and a set's return cases.
    expect(has(/UNIQUE INDEX sets_name_key ON public\.sets USING btree \(lower\(name\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX drop_sizes_label_key ON public\.drop_sizes USING btree \(drop_id, piece, label\) NULLS NOT DISTINCT$/)).toBe(true);
    expect(has(/INDEX drops_set_id_idx ON public\.drops USING btree \(set_id\)$/)).toBe(true);
    expect(has(/INDEX orders_set_sale_idx ON public\.orders USING btree \(set_sale_id\)$/)).toBe(true);
    expect(has(/INDEX order_cases_group_idx ON public\.order_cases USING btree \(group_id\)$/)).toBe(true);
    // 0060: what was converted, by the add-on it became and by its release; a release's add-on once.
    expect(has(/INDEX addon_conversions_addon_idx ON public\.addon_conversions USING btree \(addon_id\)$/)).toBe(true);
    expect(has(/INDEX addon_conversions_drop_idx ON public\.addon_conversions USING btree \(drop_id\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX addon_conversions_source_key ON public\.addon_conversions USING btree \(source_id\)$/)).toBe(true);
    // 0063: one shipping cost band per country (ALL OTHER COUNTRIES once too) and upper limit.
    expect(has(/UNIQUE INDEX shipping_cost_rates_band_key ON public\.shipping_cost_rates USING btree \(COALESCE\(country, '\*'::bpchar\), max_weight_g\)$/)).toBe(true);
    // 0064: a partner's brand once whatever the case; one invoice per experience; the partner invoices by time of issue; an
    // invitation's experience and an experience's partner each at the head of an index.
    expect(has(/UNIQUE INDEX partners_brand_key ON public\.partners USING btree \(lower\(brand\)\)$/)).toBe(true);
    expect(has(/UNIQUE INDEX partner_invoices_one_per_experience ON public\.partner_invoices USING btree \(experience_id\) WHERE \(kind = 'INVOICE'::text\)$/)).toBe(true);
    expect(has(/INDEX partner_invoices_issued_idx ON public\.partner_invoices USING btree \(issued_at\)$/)).toBe(true);
    expect(has(/INDEX circle_posts_partner_experience_idx ON public\.circle_posts USING btree \(partner_experience_id\)$/)).toBe(true);
    expect(has(/INDEX partner_experiences_partner_idx ON public\.partner_experiences USING btree \(partner_id, event_on\)$/)).toBe(true);
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
      if ((await down(t.db)).reverted[0] === name) withIt = state;
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
    expect((await up(t.db)).applied[0]).toBe('0012_media');
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
    expect((await up(t.db)).applied[0]).toBe('0010_models_active');
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
    expect((await up(t.db)).applied[0]).toBe('0005_account_recovery');
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
    expect((await up(t.db)).applied[0]).toBe('0004_scan_reports');
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
      // 0011 (F-03) re-creates the purpose CHECK after 0008, and 0035 (LOGISTICS) the role CHECK, 0036 hanging from 0035's
      // suppliers and 0037 after it, 0054 (boxes) adds its columns to 0037's parcels, 0056 (add-ons) names 0035's
      // suppliers and 0037's orders, 0057 (sets) adds its columns to 0037's orders and order cases, and 0059 (add-ons one
      // system) picks 0056's add-ons for releases, 0060 (release add-ons converted) records 0056's add-ons, 0061 (THE
      // VAULT) names 0056's add-ons and 0037's orders, and 0062 (the vault's rewards) adds to 0037's orders and 0056's
      // units: they go first, as Kysely would take them down first.
      await m0062.down(tx);
      await m0061.down(tx);
      await m0060.down(tx);
      await m0059.down(tx);
      await m0057.down(tx);
      await m0056.down(tx);
      await m0054.down(tx);
      await m0037.down(tx);
      await m0036.down(tx);
      await m0035.down(tx);
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
      await m0035.up(tx);
      await m0036.up(tx);
      await m0037.up(tx);
      await m0054.up(tx);
      await m0056.up(tx);
      await m0057.up(tx);
      await m0059.up(tx);
      await m0060.up(tx);
      await m0061.up(tx);
      await m0062.up(tx);
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
    for (const name of [...later].reverse()) expect((await down(t.db)).reverted).toEqual([name]);
    expect((await down(t.db)).reverted).toEqual(['0011_scan_token_transfer_accept']);
    expect(await purposeCheck()).toBe("CHECK ((purpose = ANY (ARRAY['FIRST_REGISTRATION'::text, 'SALE_ACTIVATION'::text])))");
    expect(await purposes()).toEqual(['FIRST_REGISTRATION', 'SALE_ACTIVATION']);
    await token(5, 'SALE_ACTIVATION');
    await expect(token(6, 'TRANSFER_ACCEPT')).rejects.toSatisfy((e) => isCheckViolation(e, 'scan_tokens_purpose_check'));

    // Up again: the three purposes, the tokens kept, the schema as before.
    expect((await up(t.db)).applied).toEqual(['0011_scan_token_transfer_accept', ...later]);
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0014_model_lookbook'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0015_drops'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0016_circle'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0017_drop_early_access'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0018_club_tiers'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0019_model_discontinued'));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0020_private_salon'));
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
    // (Its pace: every open LIVE release has one at 0058, taken away below 0049: `down`.)
    const live = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, early_access_hours, published_at,
                         mode, live_min_tier, tier_priority, room_opens_minutes, turn_seconds, pay_minutes, per_account, price_minor, currency, quantity_line,
                         pace_batch, pace_minutes)
      VALUES (${model}, 'Live', 1, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}, 0, now(),
              'LIVE', 0, true, 5, 30, 5, 1, 505000, 'EUR', '1 PIECE', 250, 1) RETURNING id`.execute(t.db)).rows[0].id;
    autoPaced.add(live);
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0021_live_release'));
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
    // A LIVE drop with its pace (0058's drops_live_paced; taken away below 0049: `down`).
    const insert = async (v: Record<string, unknown>) => {
      const auto = v.mode === 'LIVE' && !('pace_batch' in v);
      const cols = { model_id: model, title: 'Live', quantity: 25, opens_at: '2026-12-01T10:00:00Z', closes_at: '2026-12-01T11:00:00Z', seed_enc: sealed, seed_hash: seedHash, ...(auto ? { pace_batch: 250, pace_minutes: 1 } : {}), ...v };
      const r = await sql<{ id: string; mode: string; paused_ms_total: number; live_min_tier: number | null }>`
        INSERT INTO drops (${sql.join(Object.keys(cols).map((k) => sql.id(k)))}) VALUES (${sql.join(Object.values(cols))}) RETURNING id, mode, paused_ms_total, live_min_tier`.execute(t.db);
      if (auto) autoPaced.add(r.rows[0]!.id);
      return r;
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

    // Sizes: a label of 1 to 12 characters, trimmed, unique per drop; positions 1 to 24 (1 to 96 since 0057: 24 per piece
    // of a set); stock ≥ 0; never moved to another drop.
    const size = (dropId: string, label: string, position: number, stock = 2) =>
      sql<{ id: string }>`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES (${dropId}, ${label}, ${position}, ${stock}) RETURNING id`.execute(t.db);
    for (const [label, position, stock] of [['', 1, 1], ['x'.repeat(13), 1, 1], [' 52', 1, 1], ['52', 0, 1], ['52', 97, 1], ['52', 1, -1]] as const) {
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
    // (The release add-ons are 0021's until 0060 converts them and drops their tables: read at 0059, 0060 applied again
    // at the end.)
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
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
    expect((await up(t.db)).applied).toEqual(['0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** The tables 0022 adds, and what names an object of 0022 in a snapshot (the status CHECK of products: its RESERVED form). */
  const TABLES_0022 = [
    'bench_items', 'carriers', 'event_journal', 'invoices', 'order_alert_settings', 'order_cases', 'order_events', 'orders', 'returns', 'sku_thresholds', 'skus', 'stock_locations',
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0022_orders_stock'));
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
      [{ kind: 'CREDIT_NOTE', credit_scope: 'FULL' }, 'invoices_credit'],
      [{ lines: '[]' }, undefined],
      [{ issuer: '[]' }, undefined],
    ] as const) {
      await expect(invoice(sets as Record<string, unknown>), JSON.stringify(sets)).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    }
    const inv = (await invoice({})).rows[0].id;
    await expect(invoice({ sequence: 2 })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_one_per_order'));
    await expect(invoice({ order_id: o2.id })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_number_key'));
    await invoice({ order_id: o2.id, sequence: 2, vat_rate_bp: 2000, vat_minor: 96000, total_minor: 576000 });
    // One credit note in full per invoice (0022's invoices_credits_key, since 0039 invoices_full_credit_key: a credit note
    // says what it credits).
    await invoice({ kind: 'CREDIT_NOTE', credits_invoice_id: inv, credit_scope: 'FULL' });
    await expect(invoice({ kind: 'CREDIT_NOTE', sequence: 2, credits_invoice_id: inv, credit_scope: 'FULL' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_full_credit_key'));
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
    // LATE after 5 days since 0037 (plan NEXT LOT §3.5): its default was 3.
    expect(settings).toEqual({ reserved_days: 2, ready_days: 5, shipped_days: 10, unregistered_days: 30 });
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

  /**
   * A LIVE drop, its settings given, as 0021 to 0023 hold it (`extra`: more columns and their values, SQL). Once 0058's
   * `drops_live_paced` holds (step Q1.2: every LIVE release that is not an after-room carries a pace, unless it has ended
   * or was cancelled), one that would break it is given a pace (250 every minute) unless `extra` names one.
   */
  const liveDrop = async (model: string, extra: Record<string, string> = {}) => {
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const paced = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'drops_live_paced'`.execute(t.db);
    const auto = paced.rows[0]!.n > 0 && !('pace_batch' in extra) && !('parent_drop_id' in extra) && !('ended_at' in extra) && !('cancelled_at' in extra);
    if (auto) extra = { ...extra, pace_batch: '250', pace_minutes: '1' };
    const columns = Object.keys(extra);
    const id = (
      await sql<{ id: string }>`
        INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, early_access_hours,
                           mode, live_min_tier, tier_priority, room_opens_minutes, turn_seconds, pay_minutes, per_account, price_minor, currency, quantity_line
                           ${sql.raw(columns.map((c) => `, ${c}`).join(''))})
        VALUES (${model}, 'Live', 1, '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}, 0,
                'LIVE', 0, true, 5, 30, 5, 1, 505000, 'EUR', '1 PIECE' ${sql.raw(columns.map((c) => `, ${extra[c]}`).join(''))}) RETURNING id`.execute(t.db)
    ).rows[0].id;
    if (auto) autoPaced.add(id);
    return id;
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
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the two releases, written without one
    // as the images before 0049 write them, end before the way up.
    await sql`UPDATE drops SET ended_at = now(), ended_reason = 'CLOSED' WHERE id IN (${parent}, ${otherParent})`.execute(t.db);
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0023_releases_collectors'));
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
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the release, written without one as
    // the images before 0049 write it, is cancelled so that the migrations that follow go up again.
    await setParent(`cancelled_at = now()`);
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
    // Later migrations (0024_z, 0025…) were rolled back first: up again applies them after it.
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0024_model_variants'));
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
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the two, written without one as the
    // images before 0049 write them, are cancelled so that the migrations that follow go up again.
    await run(`UPDATE drops SET cancelled_at = now() WHERE model_id = '${steel}' AND mode = 'LIVE'`);
  });

  /** What names an object of 0024_z in a snapshot: its three tables. */
  const of0024z = (o: string) => /\btest_(entrants|runs|run_entrants)\b/.test(o);

  it('0024_z adds the test entrants (test_entrants, test_runs, test_run_entrants), and nothing else; down restores 0024 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0024_z_test_entrants');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0024z(o))).toEqual([]);
    expect(before.filter(of0024z)).toEqual([]);
    expect(withIt.filter((o) => !of0024z(o))).toEqual(before);
    for (const c of [
      /^index CREATE UNIQUE INDEX test_runs_one_running ON public\.test_runs USING btree \(status\) WHERE \(status = 'RUNNING'::text\)$/,
      /^constraint test_entrants test_entrants_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint test_run_entrants test_run_entrants_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES test_entrants\(account_id\) ON DELETE RESTRICT$/,
      /^index CREATE INDEX test_runs_drop_idx ON public\.test_runs USING btree \(drop_id, created_at\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // The next lot's migrations (0025…) were rolled back first: up again applies them after it.
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0024_z_test_entrants'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0024_z: a test row\'s tier 0 to 3 and seniority 0 to 50; one RUNNING test in the whole database; ENDED with when and by whom, never otherwise; a bot\'s network a /24 of 100.x', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const statuses = await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'test_runs'::regclass AND conname = 'test_runs_status_check'`.execute(t.db);
    expect([...statuses.rows[0].def.matchAll(/'([A-Z]+)'::text/g)].map((m) => m[1]).sort()).toEqual([...TEST_RUN_STATUSES].sort());
    await sql`INSERT INTO categories (id, code, name) VALUES (14, 'L', 'Test entrants') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (14, 'T', 'RING', 'TESTENT') RETURNING id`.execute(t.db)).rows[0].id;
    const drop = await drawDrop(model);
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('te@orbes.test', 'te@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('test-9001@orbes.test', 'test-9001@orbes.test', '!test') RETURNING id`.execute(t.db)).rows[0].id;
    for (const [tier, seniority] of [[-1, 0], [4, 0], [1, -1], [1, 51]]) {
      await check(run(`INSERT INTO test_entrants (account_id, tier, seniority) VALUES ('${account}', ${tier}, ${seniority})`), `${tier} ${seniority}`);
    }
    await run(`INSERT INTO test_entrants (account_id, tier, seniority) VALUES ('${account}', 3, 50)`);
    const testRun = (status: string, extra = '') =>
      sql.raw<{ id: string }>(`INSERT INTO test_runs (drop_id, mode, status, settings, entrants, created_by${extra ? ', ended_at, ended_by' : ''}) VALUES ('${drop}', 'DRAW', '${status}', '[]', 1, '${admin}'${extra}) RETURNING id`).execute(t.db);
    const first = (await testRun('RUNNING')).rows[0].id;
    await expect(testRun('RUNNING')).rejects.toSatisfy((e) => isUniqueViolation(e, 'test_runs_one_running'));
    await testRun('DONE');
    await testRun('STOPPED');
    await check(testRun('ENDED'), 'ENDED without its time', 'test_runs_ended');
    await check(testRun('DONE', `, now(), '${admin}'`), 'a time for a test not ended', 'test_runs_ended');
    await testRun('ENDED', `, now(), '${admin}'`);
    await check(run(`INSERT INTO test_runs (drop_id, mode, settings, entrants, created_by) VALUES ('${drop}', 'DRAW', '{}', 1, '${admin}')`), 'settings not a list');
    await check(run(`INSERT INTO test_runs (drop_id, mode, status, settings, entrants, created_by) VALUES ('${drop}', 'DRAW', 'DONE', '[]', 5001, '${admin}')`), 'more than 5 000');
    for (const network of ['10.0.0.0/24', '100.64.0.1/24', '100.64.0.0/16']) {
      await check(run(`INSERT INTO test_run_entrants (run_id, account_id, network, plan) VALUES ('${first}', '${account}', '${network}', '{}')`), network);
    }
    await run(`INSERT INTO test_run_entrants (run_id, account_id, network, plan) VALUES ('${first}', '${account}', '100.127.255.0/24', '{"tier": 3}')`);
    // The account stays while the pool names it; the test row while a bot does.
    await expect(run(`DELETE FROM test_entrants WHERE account_id = '${account}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0025_client_messages'));
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
      // With the order cases naming a message (0037), both tables in one TRUNCATE: the guard still refuses it.
      `TRUNCATE client_messages, order_cases`,
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0026_club_program'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0026: one row of program at most, its defaults the columns\', each value in its bounds and PALLADIUM\'s window at least PLATINE\'s; one shipping rate per currency and service; a draw\'s PLATINE window within PALLADIUM\'s; an experience on an invitation only', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (15, 'M', 'Program checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    // The row's defaults are the program's: 4 and 2 hours, standard and express, every piece for both (PLATINE's 1 until 0048), PLATINE, € 50 and € 100 in EUR for 12 months, every channel, 2, 3 and 3.
    await run(`INSERT INTO club_program_settings (id) VALUES (1)`);
    const row = (await sql<Record<string, unknown>>`SELECT * FROM club_program_settings`.execute(t.db)).rows[0]!;
    expect({ ...row, updated_at: undefined }).toEqual({
      id: 1, early_access_palladium_hours: 4, early_access_platine_hours: 2, shipping_free_platine: 'STANDARD', shipping_free_palladium: 'EXPRESS', care_pieces_platine: null,
      care_pieces_palladium: null, messages_priority_min_tier: 2, gift_platine_model_id: null, gift_palladium_model_id: null, credit_platine_minor: 5000, credit_palladium_minor: 10000,
      credit_currency: 'EUR', credit_validity_months: 12, credit_channels: ['DRAW', 'LIVE', 'SALON'], experience_members_evening_min_tier: 2, experience_launch_preview_min_tier: 3,
      experience_partner_min_tier: 3, updated_by: null, updated_at: undefined,
      // 0045: the birthday credit, on, € 20 for 30 days.
      birthday_credit_on: true, birthday_credit_minor: 2000, birthday_credit_days: 30,
      // 0048 (plan ORBES CARE): PRIVATE CARE for every piece from PLATINE (above); the warranty credit, 30 %.
      warranty_credit_percent: 30,
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0027_tier_grants'));
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
    // 0027 (0047, 0046, 0045, 0044, 0043, 0042, 0041, 0040, 0039, 0038, 0037, 0036, 0035, 0034, 0033, 0032, 0031, 0030, 0029 and 0028, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    expect((await down(t.db)).reverted).toEqual(['0035_logistics_access']);
    expect((await down(t.db)).reverted).toEqual(['0034_claim_code_renewals']);
    expect((await down(t.db)).reverted).toEqual(['0033_model_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0032_growth_indexes']);
    expect((await down(t.db)).reverted).toEqual(['0031_model_pairs']);
    expect((await down(t.db)).reverted).toEqual(['0030_account_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0029_house_guarantee']);
    expect((await down(t.db)).reverted).toEqual(['0028_yearly_care']);
    await expect(down(t.db)).rejects.toThrow(/0027_tier_grants cannot be rolled back: 1 welcome gift orders and 2 credit uses exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0027_tier_grants')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (the service never deletes either).
    await run(`ALTER TABLE credit_uses DISABLE TRIGGER credit_uses_no_delete`);
    await run(`DELETE FROM credit_uses`);
    await run(`ALTER TABLE credit_uses ENABLE TRIGGER credit_uses_no_delete`);
    await run(`DELETE FROM orders WHERE channel = 'GIFT'`);
    expect((await up(t.db)).applied).toEqual(['0028_yearly_care', '0029_house_guarantee', '0030_account_sizes', '0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0028_yearly_care'));
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
    // The down step refuses while a request or a YEARLY_CARE record exists: neither can be removed, so this database stays at
    // 0028 (0047, 0046, 0045, 0044, 0043, 0042, 0041, 0040, 0039, 0038, 0037, 0036, 0035, 0034, 0033, 0032, 0031, 0030 and 0029, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    expect((await down(t.db)).reverted).toEqual(['0035_logistics_access']);
    expect((await down(t.db)).reverted).toEqual(['0034_claim_code_renewals']);
    expect((await down(t.db)).reverted).toEqual(['0033_model_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0032_growth_indexes']);
    expect((await down(t.db)).reverted).toEqual(['0031_model_pairs']);
    expect((await down(t.db)).reverted).toEqual(['0030_account_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0029_house_guarantee']);
    await expect(down(t.db)).rejects.toThrow(/0028_yearly_care cannot be rolled back: 3 care requests and 1 yearly care records exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0028_yearly_care')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (the service never deletes either).
    await run(`ALTER TABLE care_requests DISABLE TRIGGER care_requests_no_delete`);
    await run(`DELETE FROM care_requests`);
    await run(`ALTER TABLE care_requests ENABLE TRIGGER care_requests_no_delete`);
    await run(`DELETE FROM service_records WHERE type = 'YEARLY_CARE'`);
    expect((await up(t.db)).applied).toEqual(['0029_house_guarantee', '0030_account_sizes', '0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** What names an object of 0029 in a snapshot: its two tables, the entries' new columns and constraints, and its indexes. */
  const of0029 = (o: string) => /\b(house_guarantees\w*|guarantee_settings\w*|guarantee_id|drop_entries_guarantee\w*|drop_entries_pieces\w*|live_entries_guarantee\w*)\b/.test(o) || /^table drop_entries pieces /.test(o);

  it('0029 adds the house\'s guarantees, their settings, the entries\' guarantee and pieces, and a draw\'s order per piece, and nothing else; down restores 0028 exactly (orders_source and orders_drop_entry_key of 0027), and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0029_house_guarantee');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0029 changes only orders_source (a DRAW order may be a second piece) and
    // orders_drop_entry_key (one order per entry and piece), and the drop_entries' standing CHECKs it adds.
    expect(added.filter((o) => !of0029(o)).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual([
      'constraint orders orders_drop_entry_key',
      'constraint orders orders_source',
      'index CREATE UNIQUE',
    ]);
    expect(added).toContainEqual(expect.stringMatching(/^constraint orders orders_drop_entry_key UNIQUE \(drop_entry_id, piece\)$/));
    expect(added).toContainEqual(expect.stringMatching(/^constraint orders orders_source CHECK .*\(channel = ANY \(ARRAY\['LIVE'::text, 'DRAW'::text\]\)\) OR \(piece = 1\)/));
    expect(added).toContainEqual(expect.stringMatching(/^index CREATE UNIQUE INDEX orders_drop_entry_key ON public\.orders USING btree \(drop_entry_id, piece\)$/));
    expect(removed.map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint orders orders_drop_entry_key', 'constraint orders orders_source', 'index CREATE UNIQUE']);
    expect(removed).toContainEqual(expect.stringMatching(/^index CREATE UNIQUE INDEX orders_drop_entry_key ON public\.orders USING btree \(drop_entry_id\)$/));
    expect(removed).toContainEqual(expect.stringMatching(/^constraint orders orders_source CHECK .*\(\(channel = 'LIVE'::text\) OR \(piece = 1\)\)/));
    expect(before.filter((o) => /house_guarantees|guarantee_settings|guarantee_id/.test(o))).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('house_guarantees')).toEqual([
      'account_id', 'closed_at', 'closed_reason', 'collection_id', 'covered_at', 'covered_drop_id', 'drop_id', 'granted_at', 'granted_by', 'id', 'model_id', 'note',
      'pieces', 'revoke_note', 'revoked_by', 'scope', 'status', 'updated_at', 'updated_by', 'used_at', 'used_drop_id', 'valid_until', 'visible',
    ]);
    expect(columns('guarantee_settings')).toEqual(['id', 'pieces', 'updated_at', 'updated_by', 'valid_days', 'visible']);
    expect(columns('drop_entries')).toEqual(['guarantee_id', 'pieces']);
    expect(columns('live_entries')).toEqual(['guarantee_id']);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger house_guarantees house_guarantees_immutable']);
    for (const c of [
      /^constraint house_guarantees house_guarantees_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_collection_id_fkey FOREIGN KEY \(collection_id\) REFERENCES collections\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_covered_drop_id_fkey FOREIGN KEY \(covered_drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_used_drop_id_fkey FOREIGN KEY \(used_drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint house_guarantees house_guarantees_scope CHECK /,
      /^constraint house_guarantees house_guarantees_release_cover CHECK /,
      /^constraint house_guarantees house_guarantees_valid CHECK \(\(valid_until > granted_at\)\)$/,
      /^constraint house_guarantees house_guarantees_cover CHECK \(\(\(covered_drop_id IS NULL\) = \(covered_at IS NULL\)\)\)$/,
      /^constraint house_guarantees house_guarantees_used CHECK /,
      /^constraint house_guarantees house_guarantees_closed CHECK /,
      /^constraint house_guarantees house_guarantees_revoked CHECK \(\(\(status = 'REVOKED'::text\) = \(revoked_by IS NOT NULL\)\)\)$/,
      /^constraint guarantee_settings guarantee_settings_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_guarantee_id_fkey FOREIGN KEY \(guarantee_id\) REFERENCES house_guarantees\(id\) ON DELETE RESTRICT$/,
      /^constraint drop_entries drop_entries_guaranteed CHECK \(\(\(guarantee_id IS NULL\) OR \(\(rank IS NULL\) AND \(tier IS NULL\)\)\)\)$/,
      /^constraint drop_entries drop_entries_pieces CHECK \(\(\(pieces = 1\) OR \(guarantee_id IS NOT NULL\)\)\)$/,
      /^constraint drop_entries drop_entries_guarantee_key UNIQUE \(guarantee_id\)$/,
      /^constraint live_entries live_entries_guarantee_id_fkey FOREIGN KEY \(guarantee_id\) REFERENCES house_guarantees\(id\) ON DELETE RESTRICT$/,
      /^constraint live_entries live_entries_guarantee_key UNIQUE \(guarantee_id\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0029_house_guarantee'));
    expect(await snapshot()).toEqual(latest);
  });

  it('0029: a guarantee of exactly one target matching its scope, its pieces 1 to 5, valid after its grant, set aside both or neither (a chosen release\'s own only), used with its time and release, closed exactly when not ACTIVE, revoked with who; one ACTIVE per account and release; its identity fixed; one settings row; a guaranteed entry never ranked, more than one piece only with a guarantee; a DRAW order per piece; down refused while a DRAW order of a second piece exists', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (22, 'G', 'Guarantee checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('guarantee@example.com', 'guarantee@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const other = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('guarantee2@example.com', 'guarantee2@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('guarantee@orbes.test', 'guarantee@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (22, 'MONOLITHE', 'RING', 'GARCHK') RETURNING id`.execute(t.db)).rows[0].id;
    const collection = (await sql<{ id: string }>`INSERT INTO collections (name) VALUES ('GUARANTEE CHECKS') RETURNING id`.execute(t.db)).rows[0].id;
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name) VALUES ('GUARANTEE CHECKS') RETURNING id`.execute(t.db)).rows[0].id;
    const drop = (
      await sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
        VALUES (${model}, 'GUARANTEE CHECK', 10, now() + interval '1 day', now() + interval '2 days', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${new Uint8Array(32)}) RETURNING id`.execute(t.db)
    ).rows[0].id;
    const other_drop = (
      await sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
        VALUES (${model}, 'GUARANTEE CHECK 2', 10, now() + interval '1 day', now() + interval '2 days', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${new Uint8Array(32)}) RETURNING id`.execute(t.db)
    ).rows[0].id;
    const insert = (cols: Record<string, string>) => {
      const all: Record<string, string> = { account_id: `'${account}'`, scope: `'MODEL'`, model_id: `'${model}'`, valid_until: `now() + interval '90 days'`, granted_by: `'${admin}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO house_guarantees (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    // Exactly one target, matching the scope.
    await check(insert({ model_id: 'NULL' }), 'a MODEL without its model', 'house_guarantees_scope');
    await check(insert({ collection_id: `'${collection}'` }), 'a MODEL with a collection too', 'house_guarantees_scope');
    await check(insert({ scope: `'COLLECTION'` }), 'a COLLECTION naming a model', 'house_guarantees_scope');
    await check(insert({ scope: `'RELEASE'`, model_id: 'NULL' }), 'a RELEASE without its release', 'house_guarantees_scope');
    await check(insert({ scope: `'BOUTIQUE'` }), 'an unknown scope');
    // Pieces 1 to 5; valid after its grant; a note of 1 to 500 characters.
    await check(insert({ pieces: '0' }), 'no piece');
    await check(insert({ pieces: '6' }), 'six pieces');
    await check(insert({ valid_until: `now() - interval '1 day'` }), 'valid until before its grant', 'house_guarantees_valid');
    await check(insert({ note: `'  '` }), 'a blank note');
    await check(insert({ note: `'${'x'.repeat(501)}'` }), 'a note over 500 characters');
    // Set aside both or neither; a chosen release's own release only.
    await check(insert({ covered_drop_id: `'${drop}'` }), 'set aside without its time', 'house_guarantees_cover');
    await check(insert({ covered_at: 'now()' }), 'a time without its release', 'house_guarantees_cover');
    await check(insert({ scope: `'RELEASE'`, model_id: 'NULL', drop_id: `'${drop}'`, covered_drop_id: `'${other_drop}'`, covered_at: 'now()' }), 'a chosen release set aside for another', 'house_guarantees_release_cover');
    // USED exactly with its time and release; closed exactly when not ACTIVE, with its reason; REVOKED exactly with who.
    await check(insert({ status: `'USED'`, closed_at: 'now()', closed_reason: `'USED'` }), 'used without its time', 'house_guarantees_used');
    await check(insert({ used_at: 'now()', used_drop_id: `'${drop}'` }), 'a use on an ACTIVE guarantee', 'house_guarantees_used');
    await check(insert({ status: `'EXPIRED'` }), 'expired without its closing', 'house_guarantees_closed');
    await check(insert({ status: `'EXPIRED'`, closed_at: 'now()' }), 'closed without its reason', 'house_guarantees_closed');
    await check(insert({ closed_at: 'now()', closed_reason: `'REVOKED'` }), 'an ACTIVE guarantee closed', 'house_guarantees_closed');
    await check(insert({ status: `'REVOKED'`, closed_at: 'now()', closed_reason: `'REVOKED'` }), 'revoked without who', 'house_guarantees_revoked');
    await check(insert({ status: `'EXPIRED'`, closed_at: 'now()', closed_reason: `'LOST'` }), 'an unknown reason');
    await insert({ status: `'REVOKED'`, closed_at: 'now()', closed_reason: `'REVOKED'`, revoked_by: `'${admin}'` });
    await insert({ scope: `'COLLECTION'`, model_id: 'NULL', collection_id: `'${collection}'`, status: `'USED'`, used_at: 'now()', used_drop_id: `'${drop}'`, closed_at: 'now()', closed_reason: `'USED'` });
    // One ACTIVE guarantee per account and release set aside; the waiting ones are many.
    const set = (await insert({ scope: `'RELEASE'`, model_id: 'NULL', drop_id: `'${drop}'`, covered_drop_id: `'${drop}'`, covered_at: 'now()', pieces: '2' })).rows[0].id;
    await expect(insert({ covered_drop_id: `'${drop}'`, covered_at: 'now()' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'house_guarantees_one_per_release'));
    await insert({});
    await insert({});
    // Its identity, target and grant never change.
    for (const q of [
      `UPDATE house_guarantees SET account_id = '${other}' WHERE id = '${set}'`,
      `UPDATE house_guarantees SET drop_id = '${other_drop}', covered_drop_id = '${other_drop}' WHERE id = '${set}'`,
      `UPDATE house_guarantees SET granted_at = now() - interval '1 day' WHERE id = '${set}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // One settings row at most; each value in its bounds.
    await check(run(`INSERT INTO guarantee_settings (id) VALUES (2)`), 'a second settings row');
    await check(run(`INSERT INTO guarantee_settings (valid_days) VALUES (731)`), 'valid 731 days');
    await check(run(`INSERT INTO guarantee_settings (pieces) VALUES (6)`), 'six pieces by default');
    await run(`INSERT INTO guarantee_settings (updated_by) VALUES ('${admin}')`);
    await expect(run(`INSERT INTO guarantee_settings (id) VALUES (1)`)).rejects.toSatisfy((e) => isUniqueViolation(e));
    // A guaranteed entry: never ranked nor tiered; more than one piece only with a guarantee; a guarantee used once.
    const entry = (cols: Record<string, string>) => {
      const all: Record<string, string> = { drop_id: `'${drop}'`, account_id: `'${account}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO drop_entries (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(entry({ pieces: '2' }), 'two pieces without a guarantee', 'drop_entries_pieces');
    await check(entry({ pieces: '6', guarantee_id: `'${set}'` }), 'six pieces');
    await check(entry({ guarantee_id: `'${set}'`, status: `'SELECTED'`, tier: '2', seniority: '0', respond_by: 'now()' }), 'a guaranteed entry with a tier', 'drop_entries_guaranteed');
    const held = (await entry({ guarantee_id: `'${set}'`, pieces: '2', status: `'CONFIRMED'`, respond_by: 'now()', handled_at: 'now()' })).rows[0].id;
    await expect(entry({ account_id: `'${other}'`, guarantee_id: `'${set}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_entries_guarantee_key'));
    // A draw's entry gives one order per piece; never a second order of the same piece; a salon order stays one piece.
    const order = (cols: Record<string, string>) => {
      const all: Record<string, string> = { channel: `'DRAW'`, drop_entry_id: `'${held}'`, drop_id: `'${drop}'`, account_id: `'${account}'`, model_id: `'${model}'`, location_id: `'${location}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO orders (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await order({ piece: '1' });
    await order({ piece: '2' });
    await expect(order({ piece: '2' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_drop_entry_key'));
    const request = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES (${account}, ${model}, 'CLOSED', now(), 'ACCEPTED') RETURNING id`.execute(t.db)).rows[0].id;
    await check(order({ channel: `'SALON'`, drop_entry_id: 'NULL', drop_id: 'NULL', shop_request_id: `'${request}'`, piece: '2' }), 'a second piece of a salon order', 'orders_source');
    // The down step refuses while a DRAW order of a second piece exists: it cannot be removed, so this database stays at 0029
    // (0047, 0046, 0045, 0044, 0043, 0042, 0041, 0040, 0039, 0038, 0037, 0036, 0035, 0034, 0033, 0032, 0031 and 0030, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    expect((await down(t.db)).reverted).toEqual(['0035_logistics_access']);
    expect((await down(t.db)).reverted).toEqual(['0034_claim_code_renewals']);
    expect((await down(t.db)).reverted).toEqual(['0033_model_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0032_growth_indexes']);
    expect((await down(t.db)).reverted).toEqual(['0031_model_pairs']);
    expect((await down(t.db)).reverted).toEqual(['0030_account_sizes']);
    await expect(down(t.db)).rejects.toThrow(/0029_house_guarantee cannot be rolled back: 1 draw orders of a second piece or more exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0029_house_guarantee')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow.
    await run(`DELETE FROM orders WHERE drop_entry_id = '${held}'`);
    await run(`DELETE FROM drop_entries WHERE drop_id IN ('${drop}', '${other_drop}')`);
    await run(`DELETE FROM house_guarantees`);
    await run(`DELETE FROM guarantee_settings`);
    expect((await up(t.db)).applied).toEqual(['0030_account_sizes', '0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** What names an object of 0030 in a snapshot: its table, the models' size kind, the SKUs' fit and the requests' size. */
  const of0030 = (o: string) =>
    /\b(account_sizes\w*|models_size_kind\w*|skus_fit|shop_requests_size_label\w*)\b/.test(o) || /^table (models size_kind|skus fit_m(in|ax)_mm|shop_requests size_label) /.test(o);

  it('0030 adds the accounts\' sizes, a model\'s size kind, a size\'s fit and a request\'s size, and the request\'s guard of it, and nothing else; down restores 0029 exactly (0020\'s trigger), and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0030_account_sizes');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0030 only creates shop_requests_immutable_identity again (the same name, size_label guarded too).
    expect(added.filter((o) => !of0030(o))).toEqual([]);
    expect(removed).toEqual([]);
    expect(before.filter(of0030)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table account_sizes ')).map((o) => o.split(' ')[2])).toEqual(['account_id', 'kind', 'updated_at', 'value_mm']);
    expect(added.filter((o) => o.startsWith('table ') && !o.startsWith('table account_sizes '))).toEqual([
      'table models size_kind text YES ',
      'table shop_requests size_label text YES ',
      'table skus fit_max_mm smallint YES ',
      'table skus fit_min_mm smallint YES ',
    ]);
    for (const c of [
      /^constraint account_sizes account_sizes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_sizes account_sizes_pkey PRIMARY KEY \(account_id, kind\)$/,
      /^constraint account_sizes account_sizes_value CHECK /,
      /^constraint account_sizes account_sizes_kind_check CHECK /,
      /^constraint models models_size_kind_check CHECK /,
      /^constraint skus skus_fit CHECK /,
      /^constraint shop_requests shop_requests_size_label_check CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0030_account_sizes', '0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    // The trigger of the same name guards the size in 0030 and not in 0029: its function's arguments say so.
    const args = async () =>
      (
        await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = 'shop_requests_immutable_identity'`.execute(t.db)
      ).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args()).toEqual(['id', 'account_id', 'model_id', 'created_at', 'note', 'size_label']);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    expect((await down(t.db)).reverted).toEqual(['0035_logistics_access']);
    expect((await down(t.db)).reverted).toEqual(['0034_claim_code_renewals']);
    expect((await down(t.db)).reverted).toEqual(['0033_model_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0032_growth_indexes']);
    expect((await down(t.db)).reverted).toEqual(['0031_model_pairs']);
    expect((await down(t.db)).reverted).toEqual(['0030_account_sizes']);
    expect(await args()).toEqual(['id', 'account_id', 'model_id', 'created_at', 'note']);
    expect((await up(t.db)).applied).toEqual(['0030_account_sizes', '0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  it('0030: a size of each kind in its range and step, once per account and kind, cleared by deleting it; a model\'s size kind one of the four; a size\'s fit both or neither, from 1 to 1 000, never reversed; a request\'s size of 1 to 100 characters, trimmed, never changed', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (23, 'H', 'Size checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('sizes@example.com', 'sizes@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const size = (kind: string, mm: number) => run(`INSERT INTO account_sizes (account_id, kind, value_mm) VALUES ('${account}', '${kind}', ${mm})`);
    // Each kind in its range and step (whole millimetres: a French ring size, or centimetres × 10).
    await check(size('RING', 39), 'a ring 39', 'account_sizes_value');
    await check(size('RING', 77), 'a ring 77', 'account_sizes_value');
    await check(size('BRACELET', 139), 'a bracelet under 14 cm', 'account_sizes_value');
    await check(size('BRACELET', 142), 'a bracelet off its half centimetre', 'account_sizes_value');
    await check(size('WRIST', 147), 'a wrist off its half centimetre', 'account_sizes_value');
    await check(size('WRIST', 245), 'a wrist over 24 cm', 'account_sizes_value');
    await check(size('NECKLACE', 355), 'a necklace off its centimetre', 'account_sizes_value');
    await check(size('NECKLACE', 1010), 'a necklace over 1 m', 'account_sizes_value');
    await check(size('ANKLE', 200), 'an unknown kind');
    for (const [kind, mm] of [['RING', 40], ['BRACELET', 240], ['WRIST', 145], ['NECKLACE', 1000]] as const) await size(kind, mm);
    // Once per account and kind; a cleared size is a deleted row.
    await expect(size('RING', 52)).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_sizes_pkey'));
    await run(`UPDATE account_sizes SET value_mm = 76 WHERE account_id = '${account}' AND kind = 'RING'`);
    await run(`DELETE FROM account_sizes WHERE account_id = '${account}' AND kind = 'NECKLACE'`);
    expect((await sql<{ kind: string; value_mm: number }>`SELECT kind, value_mm FROM account_sizes WHERE account_id = ${account} ORDER BY kind`.execute(t.db)).rows).toEqual([
      { kind: 'BRACELET', value_mm: 240 },
      { kind: 'RING', value_mm: 76 },
      { kind: 'WRIST', value_mm: 145 },
    ]);
    // A model's size kind: one of the four, or none.
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, size_kind) VALUES (23, 'MONOLITHE', 'RING', 'SIZCHK', 'RING') RETURNING id`.execute(t.db)).rows[0].id;
    await check(run(`UPDATE models SET size_kind = 'ANKLE' WHERE id = '${model}'`), 'an unknown size kind', 'models_size_kind_check');
    await run(`UPDATE models SET size_kind = NULL WHERE id = '${model}'`);
    // A size's fit: both or neither, 1 to 1 000, the first at most the second; it may change.
    const sku = (await sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, '52', 'SIZCHK-52') RETURNING id`.execute(t.db)).rows[0].id;
    const fit = (min: string, max: string) => run(`UPDATE skus SET fit_min_mm = ${min}, fit_max_mm = ${max} WHERE id = '${sku}'`);
    await check(fit('51', 'NULL'), 'a fit from without to', 'skus_fit');
    await check(fit('NULL', '53'), 'a fit to without from', 'skus_fit');
    await check(fit('53', '51'), 'a fit reversed', 'skus_fit');
    await check(fit('0', '51'), 'a fit from 0', 'skus_fit');
    await check(fit('160', '1001'), 'a fit over 1 000', 'skus_fit');
    await fit('52', '52');
    await fit('160', '175');
    await fit('NULL', 'NULL');
    // A request's size: 1 to 100 characters, trimmed; never changed once asked, nor added after.
    const request = (label: string) => sql.raw<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, size_label) VALUES ('${account}', '${model}', ${label}) RETURNING id`).execute(t.db);
    await check(request(`''`), 'an empty size');
    await check(request(`' 52'`), 'a size not trimmed');
    await check(request(`'${'X'.repeat(101)}'`), 'a size over 100 characters');
    const asked = (await request(`'52'`)).rows[0].id;
    await expect(run(`UPDATE shop_requests SET size_label = '54' WHERE id = '${asked}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE shop_requests SET size_label = NULL WHERE id = '${asked}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE shop_requests SET status = 'CLOSED', handled_at = now(), outcome = 'DECLINED' WHERE id = '${asked}'`);
    const unsized = (await request('NULL')).rows[0].id;
    await expect(run(`UPDATE shop_requests SET size_label = '52' WHERE id = '${unsized}'`)).rejects.toSatisfy(isGuardViolation);
    // Cleared by hand for the roll-backs that follow.
    await run(`DELETE FROM shop_requests WHERE model_id = '${model}'`);
    await run(`DELETE FROM skus WHERE model_id = '${model}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`DELETE FROM account_sizes`);
  });

  it('0031 adds model_pairs, and nothing else; down drops it and restores 0030 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0031_model_pairs');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !/\bmodel_pairs\w*\b/.test(o))).toEqual([]);
    expect(before.filter((o) => o.includes('model_pairs'))).toEqual([]);
    expect(withIt.filter((o) => !o.includes('model_pairs'))).toEqual(before);
    expect(added.filter((o) => o.startsWith('table model_pairs ')).map((o) => o.split(' ')[2])).toEqual(['created_at', 'created_by', 'model_id', 'paired_model_id', 'position']);
    for (const c of [
      /^constraint model_pairs model_pairs_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint model_pairs model_pairs_paired_model_id_fkey FOREIGN KEY \(paired_model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint model_pairs model_pairs_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint model_pairs model_pairs_pkey PRIMARY KEY \(model_id, "?position"?\)$/,
      /^constraint model_pairs model_pairs_model_paired_key UNIQUE \(model_id, paired_model_id\)$/,
      /^constraint model_pairs model_pairs_not_self CHECK \(\(paired_model_id <> model_id\)\)$/,
      /^constraint model_pairs model_pairs_position_check CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0031_model_pairs', '0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  it('0031: a pair in place 1 to 3, once per model and place, a model paired once per model, never with itself; its models and author kept (RESTRICT)', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (24, 'Q', 'Pair checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const model = async (name: string) => (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (24, ${name}, 'RING', ${`PAIR-${name}`}) RETURNING id`.execute(t.db)).rows[0].id;
    const [a, b, c, d] = [await model('A'), await model('B'), await model('C'), await model('D')];
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('pairs@orbes.test', 'pairs@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const pair = (m: string, position: number, paired: string, by = 'NULL') => run(`INSERT INTO model_pairs (model_id, position, paired_model_id, created_by) VALUES ('${m}', ${position}, '${paired}', ${by})`);
    await check(pair(a, 0, b), 'place 0', 'model_pairs_position_check');
    await check(pair(a, 4, b), 'place 4', 'model_pairs_position_check');
    await check(pair(a, 1, a), 'itself', 'model_pairs_not_self');
    await pair(a, 1, b, `'${admin}'`);
    await pair(a, 2, c);
    await pair(a, 3, d);
    await expect(pair(a, 1, d)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_pairs_pkey'));
    await run(`DELETE FROM model_pairs WHERE model_id = '${a}' AND position = 3`);
    await expect(pair(a, 3, b)).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_pairs_model_paired_key'));
    // Another model may pair with the same ones; a model's pairs keep it, the model paired and the author (RESTRICT).
    await pair(b, 1, c);
    await pair(b, 2, a);
    for (const q of [`DELETE FROM models WHERE id = '${a}'`, `DELETE FROM models WHERE id = '${c}'`, `DELETE FROM admin_users WHERE id = '${admin}'`]) {
      await expect(run(q), q).rejects.toSatisfy(isForeignKeyViolation);
    }
    await expect(run(`INSERT INTO model_pairs (model_id, position, paired_model_id) VALUES ('${c}', 1, '00000000-0000-4000-8000-000000000000')`)).rejects.toSatisfy(isForeignKeyViolation);
    // Cleared by hand for the roll-backs that follow.
    await run(`DELETE FROM model_pairs`);
    await run(`DELETE FROM models WHERE category_id = 24`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  it('0032 adds GROWTH\'s three indexes, and nothing else; down drops them and restores 0031 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0032_growth_indexes');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added).toEqual([
      'index CREATE INDEX accounts_created_at_idx ON public.accounts USING btree (created_at)',
      'index CREATE INDEX orders_paid_idx ON public.orders USING btree (account_id, paid_at) WHERE (paid_at IS NOT NULL)',
      'index CREATE INDEX ownership_account_started_idx ON public.ownership USING btree (account_id, started_at)',
    ]);
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0032_growth_indexes', '0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  /** What names an object of 0033 in a snapshot: the models' size type, its two CHECKs, the SKUs' set-aside columns and indexes. */
  const of0033 = (o: string) => /\b(models_size_type\w*|skus_set_aside\w*|skus_model_offered_idx)\b/.test(o) || /^table (models size_type|skus set_aside_(at|by)) /.test(o);

  it('0033 adds a model\'s size type and a size set aside, and nothing else; down drops them and restores 0032 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0033_model_sizes');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0033(o))).toEqual([]);
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0033)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table models size_type text YES ',
      'table skus set_aside_at timestamp with time zone YES ',
      'table skus set_aside_by uuid YES ',
    ]);
    for (const c of [
      /^constraint models models_size_type_check CHECK /,
      /^constraint models models_size_type_kind CHECK /,
      /^constraint skus skus_set_aside CHECK \(\(\(set_aside_by IS NULL\) OR \(set_aside_at IS NOT NULL\)\)\)$/,
      /^constraint skus skus_set_aside_by_fkey FOREIGN KEY \(set_aside_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^index CREATE INDEX skus_set_aside_by_idx ON public\.skus USING btree \(set_aside_by\)$/,
      /^index CREATE INDEX skus_model_offered_idx ON public\.skus USING btree \(model_id\) WHERE \(set_aside_at IS NULL\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added).toHaveLength(9);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    // Existing data: a model and its SKUs written before 0033 are untouched by it: no type ('To give'), every size offered.
    await sql`INSERT INTO categories (id, code, name) VALUES (25, 'Y', 'Sizes before') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, size_kind) VALUES (25, 'BEFORE', 'SIGNET RING', 'SZB-RG', 'RING') RETURNING id`.execute(t.db)).rows[0].id;
    await sql`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, 'SIZE 52', 'SZB-RG-SIZE-52'), (${model}, '54', 'SZB-RG-54'), (${model}, NULL, 'SZB-RG')`.execute(t.db);
    expect((await up(t.db)).applied).toEqual(['0033_model_sizes', '0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect((await sql<{ size_type: string | null; size_kind: string | null }>`SELECT size_type, size_kind FROM models WHERE id = ${model}`.execute(t.db)).rows).toEqual([{ size_type: null, size_kind: 'RING' }]);
    expect(
      (await sql<{ code: string; set_aside_at: Date | null; set_aside_by: string | null }>`SELECT code, set_aside_at, set_aside_by FROM skus WHERE model_id = ${model} ORDER BY code`.execute(t.db)).rows,
    ).toEqual([
      { code: 'SZB-RG', set_aside_at: null, set_aside_by: null },
      { code: 'SZB-RG-54', set_aside_at: null, set_aside_by: null },
      { code: 'SZB-RG-SIZE-52', set_aside_at: null, set_aside_by: null },
    ]);
    // Cleared by hand for the roll-backs that follow.
    await sql`DELETE FROM skus WHERE model_id = ${model}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
  });

  it('0033: a size type one of the five, the saved size it preselects with derived from it (WATCH the wrist, ONE_SIZE none); a size set aside by an admin only with its time, its admin kept (RESTRICT)', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (26, 'Z', 'Size type checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (26, 'TYPED', 'RING', 'SZT-RG') RETURNING id`.execute(t.db)).rows[0].id;
    const type = (sizeType: string, sizeKind: string) => run(`UPDATE models SET size_type = ${sizeType}, size_kind = ${sizeKind} WHERE id = '${model}'`);
    // One of the five; WRIST is a saved size's kind, never a size type.
    await check(type(`'WRIST'`, `'WRIST'`), 'WRIST as a size type', 'models_size_type_check');
    await check(type(`'ANKLE'`, 'NULL'), 'an unknown size type', 'models_size_type_check');
    // The kind follows the type: RING, BRACELET and NECKLACE their own, WATCH the wrist, ONE_SIZE none.
    await check(type(`'RING'`, `'BRACELET'`), 'RING with the kind BRACELET', 'models_size_type_kind');
    await check(type(`'RING'`, 'NULL'), 'RING without its kind', 'models_size_type_kind');
    await check(type(`'WATCH'`, 'NULL'), 'WATCH without WRIST', 'models_size_type_kind');
    await check(type(`'WATCH'`, `'RING'`), 'WATCH with RING', 'models_size_type_kind');
    await check(type(`'ONE_SIZE'`, `'RING'`), 'ONE_SIZE with a kind', 'models_size_type_kind');
    await check(type(`'NECKLACE'`, `'WRIST'`), 'NECKLACE with WRIST', 'models_size_type_kind');
    for (const [t1, k1] of [[`'RING'`, `'RING'`], [`'BRACELET'`, `'BRACELET'`], [`'NECKLACE'`, `'NECKLACE'`], [`'WATCH'`, `'WRIST'`], [`'ONE_SIZE'`, 'NULL']] as const) await type(t1, k1);
    // No type ('To give'): any kind, or none, as before 0033.
    await type('NULL', `'BRACELET'`);
    await type('NULL', 'NULL');
    // A size set aside: by an admin only with its time; by a script with its time alone; offered again with neither.
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('sizes@orbes.test', 'sizes@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`.execute(t.db)).rows[0].id;
    const sku = (await sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, '58', 'SZT-RG-58') RETURNING id`.execute(t.db)).rows[0].id;
    expect((await sql<{ set_aside_at: Date | null }>`SELECT set_aside_at FROM skus WHERE id = ${sku}`.execute(t.db)).rows).toEqual([{ set_aside_at: null }]);
    await check(run(`UPDATE skus SET set_aside_by = '${admin}' WHERE id = '${sku}'`), 'set aside by an admin without its time', 'skus_set_aside');
    await run(`UPDATE skus SET set_aside_at = now() WHERE id = '${sku}'`);
    await run(`UPDATE skus SET set_aside_by = '${admin}' WHERE id = '${sku}'`);
    await expect(run(`DELETE FROM admin_users WHERE id = '${admin}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`UPDATE skus SET set_aside_by = '00000000-0000-4000-8000-000000000000' WHERE id = '${sku}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await run(`UPDATE skus SET set_aside_at = NULL, set_aside_by = NULL WHERE id = '${sku}'`);
    // Its identity stays guarded as before (skus_immutable_identity).
    await expect(run(`UPDATE skus SET size_label = '60' WHERE id = '${sku}'`)).rejects.toSatisfy(isGuardViolation);
    // Cleared by hand for the roll-backs that follow.
    await run(`DELETE FROM skus WHERE model_id = '${model}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  it('0034 adds claim_code_renewals, and nothing else; down drops it and restores 0033 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0034_claim_code_renewals');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !/\bclaim_code_renewals\w*\b/.test(o))).toEqual([]);
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter((o) => o.includes('claim_code_renewals'))).toEqual([]);
    expect(added.filter((o) => o.startsWith('table claim_code_renewals ')).map((o) => o.split(' ')[2])).toEqual([
      'account_id', 'claim_hash', 'created_at', 'created_by', 'id', 'kind', 'order_id', 'product_id', 'read_at', 'reason', 'sealed_code', 'status', 'withdrawn_at', 'withdrawn_reason',
    ]);
    for (const c of [
      /^constraint claim_code_renewals claim_code_renewals_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint claim_code_renewals claim_code_renewals_order_id_fkey FOREIGN KEY \(order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint claim_code_renewals claim_code_renewals_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint claim_code_renewals claim_code_renewals_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint claim_code_renewals claim_code_renewals_target CHECK /,
      /^constraint claim_code_renewals claim_code_renewals_kind_status CHECK /,
      /^constraint claim_code_renewals claim_code_renewals_sealed CHECK /,
      /^constraint claim_code_renewals claim_code_renewals_read CHECK /,
      /^constraint claim_code_renewals claim_code_renewals_withdrawn CHECK /,
      /^constraint claim_code_renewals claim_code_renewals_reason CHECK /,
      /^index CREATE UNIQUE INDEX claim_code_renewals_waiting_key ON public\.claim_code_renewals USING btree \(product_id\) WHERE \(status = 'WAITING'::text\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger claim_code_renewals claim_code_renewals_immutable',
      'trigger claim_code_renewals claim_code_renewals_no_delete',
      'trigger claim_code_renewals claim_code_renewals_no_truncate',
    ]);
    // Existing data: no row is written; every piece keeps its hash.
    expect((await up(t.db)).applied).toEqual(['0034_claim_code_renewals', '0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM claim_code_renewals`.execute(t.db)).rows[0].n)).toBe(0);
  });

  /** What names an object of 0035 in a snapshot: its two tables, the role CHECK, the locations' address, the suppliers of models and sizes. */
  const of0035 = (o: string) =>
    /\b(admin_user_locations\w*|suppliers\w*|stock_locations_address_check|models_supplier_id\w*|skus_supplier_id\w*)\b/.test(o) ||
    /^table (stock_locations address|models supplier_id|skus supplier_id) /.test(o);

  it('0035 adds LOGISTICS, a login\'s locations, a location\'s address, the suppliers and the suppliers of models and sizes, and nothing else; down restores 0034 exactly (0008\'s role CHECK), and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0035_logistics_access');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0035 only rebuilds admin_users_role_check (the same name, LOGISTICS added).
    expect(added.filter((o) => !of0035(o))).toEqual([`constraint admin_users admin_users_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERATOR'::text, 'AUDITOR'::text, 'RETAIL'::text, 'LOGISTICS'::text])))`]);
    expect(removed).toEqual([`constraint admin_users admin_users_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERATOR'::text, 'AUDITOR'::text, 'RETAIL'::text])))`]);
    expect(before.filter(of0035)).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('admin_user_locations')).toEqual(['admin_user_id', 'created_at', 'created_by', 'stock_location_id']);
    expect(columns('suppliers')).toEqual(['active', 'address', 'contact_name', 'created_at', 'created_by', 'currency', 'email', 'id', 'name', 'note', 'phone']);
    expect(added.filter((o) => /^table (stock_locations|models|skus) /.test(o))).toEqual([
      'table models supplier_id uuid YES ',
      'table skus supplier_id uuid YES ',
      'table stock_locations address text YES ',
    ]);
    for (const c of [
      /^constraint admin_user_locations admin_user_locations_pkey PRIMARY KEY \(admin_user_id, stock_location_id\)$/,
      /^constraint admin_user_locations admin_user_locations_admin_user_id_fkey FOREIGN KEY \(admin_user_id\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint admin_user_locations admin_user_locations_stock_location_id_fkey FOREIGN KEY \(stock_location_id\) REFERENCES stock_locations\(id\) ON DELETE RESTRICT$/,
      /^constraint admin_user_locations admin_user_locations_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint stock_locations stock_locations_address_check CHECK /,
      /^constraint suppliers suppliers_name_check CHECK /,
      /^constraint suppliers suppliers_currency_check CHECK /,
      /^constraint suppliers suppliers_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint models models_supplier_id_fkey FOREIGN KEY \(supplier_id\) REFERENCES suppliers\(id\) ON DELETE RESTRICT$/,
      /^constraint skus skus_supplier_id_fkey FOREIGN KEY \(supplier_id\) REFERENCES suppliers\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger suppliers suppliers_immutable_identity',
      'trigger suppliers suppliers_no_delete',
      'trigger suppliers suppliers_no_truncate',
    ]);
    // Existing data: no row is written; every location keeps no address, every model and size no supplier.
    expect((await up(t.db)).applied).toEqual(['0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const table of ['admin_user_locations', 'suppliers']) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0035: LOGISTICS a role; a login tied to a location once, both kept (RESTRICT); an address of 1 to 500 characters, trimmed, line breaks kept; a supplier named once whatever the case, its fields bounded, its currency three capitals, never deleted; down refused while a LOGISTICS login exists', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('boss-0035@orbes.test', 'boss-0035@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const agent = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('agent-0035@orbes.test', 'agent-0035@orbes.test', 'scrypt$x', 'LOGISTICS') RETURNING id`.execute(t.db)).rows[0].id;
    await check(run(`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('x-0035@orbes.test', 'x-0035@orbes.test', 'scrypt$x', 'AGENT')`), 'an unknown role', 'admin_users_role_check');
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name) VALUES ('AGENT WAREHOUSE 0035') RETURNING id`.execute(t.db)).rows[0].id;
    // A login's locations: once each, its login, location and author kept.
    await run(`INSERT INTO admin_user_locations (admin_user_id, stock_location_id, created_by) VALUES ('${agent}', '${location}', '${admin}')`);
    await expect(run(`INSERT INTO admin_user_locations (admin_user_id, stock_location_id) VALUES ('${agent}', '${location}')`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'admin_user_locations_pkey'));
    for (const q of [`DELETE FROM admin_users WHERE id = '${agent}'`, `DELETE FROM admin_users WHERE id = '${admin}'`, `DELETE FROM stock_locations WHERE id = '${location}'`]) {
      await expect(run(q), q).rejects.toSatisfy(isForeignKeyViolation);
    }
    // An address: trimmed, 1 to 500 characters, its line breaks kept.
    await run(`UPDATE stock_locations SET address = E'12 rue de la Paix\\n75002 Paris\\nFrance' WHERE id = '${location}'`);
    expect((await sql<{ address: string }>`SELECT address FROM stock_locations WHERE id = ${location}`.execute(t.db)).rows[0].address).toBe('12 rue de la Paix\n75002 Paris\nFrance');
    for (const [v, label] of [[`''`, 'empty'], [`' 12 rue'`, 'untrimmed'], [`'${'x'.repeat(501)}'`, '501 characters']] as const) {
      await check(run(`UPDATE stock_locations SET address = ${v} WHERE id = '${location}'`), `an address ${label}`, 'stock_locations_address_check');
    }
    await run(`UPDATE stock_locations SET address = '${'x'.repeat(500)}' WHERE id = '${location}'`);
    await run(`UPDATE stock_locations SET address = NULL WHERE id = '${location}'`);
    // A supplier: named once whatever the case; its fields bounded and trimmed; its currency three capitals.
    const supplier = (await sql<{ id: string }>`INSERT INTO suppliers (name, currency, created_by) VALUES ('MAISON 0035', 'EUR', ${admin}) RETURNING id`.execute(t.db)).rows[0].id;
    await expect(run(`INSERT INTO suppliers (name) VALUES ('maison 0035')`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'suppliers_name_key'));
    for (const [column, v] of [
      ['name', `'${'n'.repeat(121)}'`],
      ['name', `' MAISON'`],
      ['contact_name', `'${'c'.repeat(121)}'`],
      ['email', `'${'e'.repeat(255)}'`],
      ['phone', `'${'1'.repeat(41)}'`],
      ['address', `'${'a'.repeat(501)}'`],
      ['note', `'${'w'.repeat(1001)}'`],
      ['note', `''`],
      ['currency', `'eur'`],
      ['currency', `'EURO'`],
    ] as const) {
      await check(run(`UPDATE suppliers SET ${column} = ${v} WHERE id = '${supplier}'`), `${column} = ${v.slice(0, 12)}`, `suppliers_${column}_check`);
    }
    await run(`UPDATE suppliers SET contact_name = 'A. Martin', email = 'orders@maison.example', phone = '+33 1 00 00 00 00', address = E'1 rue\\nParis', currency = 'CHF', note = 'Rings.', active = false WHERE id = '${supplier}'`);
    await expect(run(`UPDATE suppliers SET created_at = now() - interval '1 day' WHERE id = '${supplier}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM suppliers WHERE id = '${supplier}'`)).rejects.toSatisfy(isGuardViolation);
    // A model's supplier and a size's own: kept while named (RESTRICT).
    await sql`INSERT INTO categories (id, code, name) VALUES (27, 'Q', 'Supplier checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix, supplier_id) VALUES (27, 'SUPPLIED', 'RING', 'SUP-RG', ${supplier}) RETURNING id`.execute(t.db)).rows[0].id;
    await run(`INSERT INTO skus (model_id, size_label, code, supplier_id) VALUES ('${model}', '52', 'SUP-RG-52', '${supplier}')`);
    await expect(run(`UPDATE models SET supplier_id = '00000000-0000-4000-8000-000000000000' WHERE id = '${model}'`)).rejects.toSatisfy(isForeignKeyViolation);
    // The down step refuses while a LOGISTICS login exists, and names the count (0047, 0046, 0045, 0044, 0043, 0042, 0041, 0040, 0039, 0038, 0037 and 0036, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    await expect(down(t.db)).rejects.toThrow(/0035_logistics_access cannot be rolled back: 1 LOGISTICS logins exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0035_logistics_access')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (the service never deletes a supplier).
    await run(`DELETE FROM skus WHERE model_id = '${model}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`ALTER TABLE suppliers DISABLE TRIGGER suppliers_no_delete`);
    await run(`DELETE FROM suppliers WHERE id = '${supplier}'`);
    await run(`ALTER TABLE suppliers ENABLE TRIGGER suppliers_no_delete`);
    await run(`DELETE FROM admin_user_locations`);
    await run(`DELETE FROM stock_locations WHERE id = '${location}'`);
    await run(`DELETE FROM admin_users WHERE id IN ('${agent}', '${admin}')`);
    expect((await down(t.db)).reverted).toEqual(['0035_logistics_access']);
    expect((await up(t.db)).applied).toEqual(['0035_logistics_access', '0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** What names an object of 0036 in a snapshot: its seven tables, the ledger's reception line and RECEIVED, the pieces' reception and entry. */
  const TABLES_0036 = ['supplier_orders', 'supplier_order_lines', 'receptions', 'reception_lines', 'card_prints', 'supplier_returns', 'stock_corrections'];
  const of0036 = (o: string) =>
    new RegExp(`\\b(${TABLES_0036.join('|')})\\b`).test(o) ||
    /\b(stock_movements_reception_line\w*|stock_movements_received|products_reception_line\w*)\b/.test(o) ||
    /^table (stock_movements reception_line_id|products (reception_line_id|stock_entered_at)) /.test(o);

  it('0036 adds the supplier orders, receptions, cards, returns to a supplier and corrections, RECEIVED and the pieces\' reception and entry, and nothing else; down restores 0035 exactly (0022\'s ledger CHECKs), and up again with the backfill', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0036_supplier_orders');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0036 rebuilds three CHECKs of the ledger under their names.
    const ledger = ['constraint stock_movements stock_movements_order', 'constraint stock_movements stock_movements_reason_check', 'constraint stock_movements stock_movements_sign'];
    expect(added.filter((o) => !of0036(o)).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(ledger);
    expect(removed.map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(ledger);
    expect(before.filter(of0036)).toEqual([]);
    expect(added.find((o) => o.startsWith('constraint stock_movements stock_movements_reason_check'))).toContain("'RECEIVED'::text");
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('supplier_order_lines')).toEqual(['accepted_quantity', 'created_at', 'credited_quantity', 'id', 'quantity', 'rejected_quantity', 'rest_cancelled_quantity', 'sku_id', 'supplier_order_id', 'unit_price_minor']);
    expect(columns('reception_lines')).toEqual(['accepted', 'id', 'issued', 'note', 'reception_id', 'rejected', 'sku_id', 'supplier_order_line_id']);
    expect(columns('card_prints')).toEqual(['erased_at', 'erased_reason', 'last_printed_at', 'printed_count', 'product_id', 'reception_id', 'sealed_claim_code']);
    expect(columns('stock_corrections')).toEqual(['decided_at', 'decided_by', 'decision_note', 'delta', 'id', 'location_id', 'movement_id', 'proposed_at', 'proposed_by', 'reason', 'sku_id', 'status']);
    expect(columns('supplier_orders')).toHaveLength(24);
    expect(columns('receptions')).toHaveLength(17);
    expect(columns('supplier_returns')).toHaveLength(16);
    expect(added.filter((o) => /^table (stock_movements|products) /.test(o))).toEqual([
      'table products reception_line_id uuid YES ',
      'table products stock_entered_at timestamp with time zone YES ',
      'table stock_movements reception_line_id uuid YES ',
    ]);
    for (const c of [
      /^constraint supplier_orders supplier_orders_sent CHECK /,
      /^constraint supplier_orders supplier_orders_invoice CHECK /,
      /^constraint supplier_orders supplier_orders_supplier_id_fkey FOREIGN KEY \(supplier_id\) REFERENCES suppliers\(id\) ON DELETE RESTRICT$/,
      /^constraint card_prints card_prints_sealed CHECK \(\(\(sealed_claim_code IS NULL\) = \(erased_at IS NOT NULL\)\)\)$/,
      /^constraint reception_lines reception_lines_pieces CHECK \(\(\(accepted \+ rejected\) >= 1\)\)$/,
      /^constraint stock_movements stock_movements_received CHECK \(\(\(reason = 'RECEIVED'::text\) = \(reception_line_id IS NOT NULL\)\)\)$/,
      /^constraint stock_movements stock_movements_reception_line_id_fkey FOREIGN KEY \(reception_line_id\) REFERENCES reception_lines\(id\) ON DELETE RESTRICT$/,
      /^constraint products products_reception_line_id_fkey FOREIGN KEY \(reception_line_id\) REFERENCES reception_lines\(id\) ON DELETE RESTRICT$/,
      /^constraint stock_corrections stock_corrections_movement_id_fkey FOREIGN KEY \(movement_id\) REFERENCES stock_movements\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger card_prints card_prints_immutable_identity',
      'trigger reception_lines reception_lines_immutable_identity',
      'trigger receptions receptions_immutable_identity',
      'trigger stock_corrections stock_corrections_immutable_identity',
      'trigger stock_corrections stock_corrections_no_delete',
      'trigger supplier_order_lines supplier_order_lines_immutable_identity',
      'trigger supplier_orders supplier_orders_immutable_identity',
      'trigger supplier_returns supplier_returns_immutable_identity',
    ]);
    // Existing data: a piece finished by the atelier entered the stock with its PRODUCED movement (its earliest); a count
    // made by hand names no piece, and a piece without PRODUCED (a Generator one-off) gets no entry.
    await sql`INSERT INTO categories (id, code, name) VALUES (29, 'W', 'Stock entry') ON CONFLICT DO NOTHING`.execute(t.db);
    const cat = (await sql<{ id: number }>`SELECT id FROM categories WHERE code = 'W'`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'ENTRY', 'RING', 'ENT-RG') RETURNING id`.execute(t.db)).rows[0].id;
    const sku = (await sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, '52', 'ENT-RG-52') RETURNING id`.execute(t.db)).rows[0].id;
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name) VALUES ('ENTRY STOCK') RETURNING id`.execute(t.db)).rows[0].id;
    const piece = async (serial: number) =>
      (
        await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, sku_id)
          VALUES (${`O26-W-${String(serial).padStart(5, '0')}`}, ${(26 << 25) | (cat << 20) | serial}, 2026, ${cat}, ${serial}, 'ENT-RG-52', ${model}, 'SILVER', ${sku}) RETURNING id`.execute(t.db)
      ).rows[0].id;
    const made = await piece(77001);
    const oneOff = await piece(77002);
    const move = (delta: number, reason: string, productId: string | null, at: string) =>
      sql`INSERT INTO stock_movements (sku_id, location_id, delta, reason, product_id, actor_type, created_at) VALUES (${sku}, ${location}, ${delta}, ${reason}, ${productId}, 'system', ${at})`.execute(t.db);
    await move(1, 'PRODUCED', made, '2026-09-20T10:00:00Z');
    await move(-1, 'ADJUSTED', null, '2026-09-21T10:00:00Z');
    await move(1, 'PRODUCED', made, '2026-09-22T10:00:00Z');
    await move(3, 'ADJUSTED', null, '2026-09-23T10:00:00Z');
    expect((await up(t.db)).applied).toEqual(['0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    const entered = async (id: string) => (await sql<{ at: Date | null; line: string | null }>`SELECT stock_entered_at AS at, reception_line_id AS line FROM products WHERE id = ${id}`.execute(t.db)).rows[0];
    expect(await entered(made)).toEqual({ at: new Date('2026-09-20T10:00:00Z'), line: null });
    expect(await entered(oneOff)).toEqual({ at: null, line: null });
    for (const table of TABLES_0036) expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    // Cleared by hand for the roll-backs that follow (the ledger is append-only).
    await sql`ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_append_only`.execute(t.db);
    await sql`DELETE FROM stock_movements WHERE sku_id = ${sku}`.execute(t.db);
    await sql`ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_append_only`.execute(t.db);
    await sql`DELETE FROM products WHERE model_id = ${model}`.execute(t.db);
    await sql`DELETE FROM skus WHERE id = ${sku}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
    await sql`DELETE FROM stock_locations WHERE id = ${location}`.execute(t.db);
  });

  it('0036: a supplier order\'s status with its times, sent with its currency and date, one draft per supplier and location, its invoice whole; a line once per SKU; one open reception per order, each step with its times; a line\'s pieces and identities issued; a card sealed exactly until erased; a return and its settlement; RECEIVED with its reception line only; a correction decided with its movement or its note, never deleted; down refused while any order, reception or correction exists', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('so-0036@orbes.test', 'so-0036@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('SO 0036') RETURNING id`)).id;
    const supplier = (await one<{ id: string }>(`INSERT INTO suppliers (name) VALUES ('SO SUPPLIER 0036') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (24, 'V', 'Supplier order checks') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'V'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'ORDERED', 'RING', 'SO-RG') RETURNING id`)).id;
    const sku = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${model}', '52', 'SO-RG-52') RETURNING id`)).id;
    const sku54 = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${model}', '54', 'SO-RG-54') RETURNING id`)).id;

    // A supplier order: a draft, one per supplier and location; sent only with its currency and date.
    const order = (await one<{ id: string }>(`INSERT INTO supplier_orders (supplier_id, location_id, created_by) VALUES ('${supplier}', '${location}', '${admin}') RETURNING id`)).id;
    await expect(run(`INSERT INTO supplier_orders (supplier_id, location_id) VALUES ('${supplier}', '${location}')`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'supplier_orders_one_draft'));
    await check(run(`UPDATE supplier_orders SET status = 'SENT', sent_at = now() WHERE id = '${order}'`), 'sent without its currency and date', 'supplier_orders_sent');
    await check(run(`UPDATE supplier_orders SET sent_at = now() WHERE id = '${order}'`), 'a draft with a time sent', 'supplier_orders_draft');
    await check(run(`UPDATE supplier_orders SET currency = 'eur' WHERE id = '${order}'`), 'a currency in small letters', 'supplier_orders_currency_check');
    await check(run(`UPDATE supplier_orders SET shipping_minor = -1 WHERE id = '${order}'`), 'a negative shipping cost', 'supplier_orders_shipping_minor_check');
    await check(run(`UPDATE supplier_orders SET status = 'EXPECTED', sent_at = now(), currency = 'EUR', expected_on = '2026-11-01' WHERE id = '${order}'`), 'expected without its confirmation', 'supplier_orders_confirmed');
    await check(run(`UPDATE supplier_orders SET invoice_number = 'F-1' WHERE id = '${order}'`), 'an invoice without its amount and date', 'supplier_orders_invoice');
    await check(run(`UPDATE supplier_orders SET invoice_paid_at = now() WHERE id = '${order}'`), 'paid without an invoice', 'supplier_orders_invoice_paid');
    // A line once per SKU, 1 to 10 000 pieces.
    const line = (await one<{ id: string }>(`INSERT INTO supplier_order_lines (supplier_order_id, sku_id, quantity) VALUES ('${order}', '${sku}', 10) RETURNING id`)).id;
    await expect(run(`INSERT INTO supplier_order_lines (supplier_order_id, sku_id, quantity) VALUES ('${order}', '${sku}', 1)`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'supplier_order_lines_order_sku_key'));
    await check(run(`INSERT INTO supplier_order_lines (supplier_order_id, sku_id, quantity) VALUES ('${order}', '${sku54}', 0)`), 'no piece', 'supplier_order_lines_quantity_check');
    await expect(run(`UPDATE supplier_order_lines SET sku_id = '${sku54}' WHERE id = '${line}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE supplier_orders SET status = 'SENT', sent_at = now(), sent_by = '${admin}', currency = 'EUR', expected_on = '2026-11-01', shipping_minor = 2500 WHERE id = '${order}'`);
    await run(`UPDATE supplier_orders SET status = 'EXPECTED', supplier_confirmed_at = now(), supplier_confirmed_by = '${admin}' WHERE id = '${order}'`);
    await run(`UPDATE supplier_orders SET invoice_number = 'F-2026-118', invoice_minor = 120000, invoice_date = '2026-10-20' WHERE id = '${order}'`);
    await run(`UPDATE supplier_orders SET invoice_paid_at = now(), invoice_paid_by = '${admin}' WHERE id = '${order}'`);
    await expect(run(`UPDATE supplier_orders SET supplier_id = '${supplier}', location_id = '${location}' WHERE id = '${order}'`)).resolves.toBeDefined();
    await expect(run(`UPDATE supplier_orders SET created_by = NULL WHERE id = '${order}'`)).rejects.toSatisfy(isGuardViolation);
    // A second draft for the same supplier and location may now be made: the first is no longer a draft.
    await run(`INSERT INTO supplier_orders (supplier_id, location_id) VALUES ('${supplier}', '${location}')`);

    // A reception: one open per order; each step with its times; issued only once confirmed, attached only once issued.
    const reception = (await one<{ id: string }>(`INSERT INTO receptions (supplier_order_id, location_id, counted_by) VALUES ('${order}', '${location}', '${admin}') RETURNING id`)).id;
    await expect(run(`INSERT INTO receptions (supplier_order_id, location_id) VALUES ('${order}', '${location}')`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'receptions_one_open'));
    await check(run(`UPDATE receptions SET status = 'SENT_BACK' WHERE id = '${reception}'`), 'sent back without its time and note', 'receptions_sent_back');
    await check(run(`UPDATE receptions SET sent_back_at = now() WHERE id = '${reception}'`), 'a time sent back without its note', 'receptions_sent_back');
    await check(run(`UPDATE receptions SET status = 'CONFIRMED' WHERE id = '${reception}'`), 'confirmed without its time', 'receptions_confirmed');
    await check(run(`UPDATE receptions SET issued_at = now() WHERE id = '${reception}'`), 'issued before it is confirmed', 'receptions_issued');
    await check(run(`UPDATE receptions SET delivery_note = '${'n'.repeat(61)}' WHERE id = '${reception}'`), 'a delivery note of 61 characters', 'receptions_delivery_note_check');
    await run(`UPDATE receptions SET status = 'SENT_BACK', sent_back_at = now(), sent_back_by = '${admin}', sent_back_note = 'Count again.' WHERE id = '${reception}'`);
    await run(`UPDATE receptions SET status = 'TO_CONFIRM', counted_at = now() WHERE id = '${reception}'`);
    // A line: at least one piece; identities issued 0 to accepted; a SKU once.
    const rline = (await one<{ id: string }>(`INSERT INTO reception_lines (reception_id, sku_id, supplier_order_line_id, accepted, rejected) VALUES ('${reception}', '${sku}', '${line}', 8, 2) RETURNING id`)).id;
    await check(run(`INSERT INTO reception_lines (reception_id, sku_id) VALUES ('${reception}', '${sku54}')`), 'no piece counted', 'reception_lines_pieces');
    await check(run(`UPDATE reception_lines SET issued = 9 WHERE id = '${rline}'`), 'more identities than pieces accepted', 'reception_lines_issued');
    await expect(run(`INSERT INTO reception_lines (reception_id, sku_id, accepted) VALUES ('${reception}', '${sku}', 1)`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'reception_lines_reception_sku_key'));
    await run(`INSERT INTO reception_lines (reception_id, sku_id, accepted, note) VALUES ('${reception}', '${sku54}', 1, 'One more, not on the order.')`);
    await run(`UPDATE receptions SET status = 'CONFIRMED', confirmed_at = now(), confirmed_by = '${admin}' WHERE id = '${reception}'`);
    await check(run(`UPDATE receptions SET cards_attached_at = now() WHERE id = '${reception}'`), 'attached before every identity is issued', 'receptions_cards_attached');
    await run(`UPDATE reception_lines SET issued = 8 WHERE id = '${rline}'`);
    await run(`UPDATE receptions SET issued_at = now() WHERE id = '${reception}'`);
    // RECEIVED: a reception line's pieces, positive, no order and no single piece; the reception line only with RECEIVED.
    const ledger = (reason: string, delta: number, extra = '') =>
      run(`INSERT INTO stock_movements (sku_id, location_id, delta, reason, actor_type${extra ? `, ${extra.split('|')[0]}` : ''}) VALUES ('${sku}', '${location}', ${delta}, '${reason}', 'system'${extra ? `, ${extra.split('|')[1]}` : ''})`);
    await check(ledger('RECEIVED', 8), 'RECEIVED without its reception line');
    await check(ledger('RECEIVED', -8, `reception_line_id|'${rline}'`), 'RECEIVED taking away', 'stock_movements_sign');
    await check(ledger('ADJUSTED', 1, `reception_line_id|'${rline}'`), 'a count naming a reception line', 'stock_movements_received');
    await ledger('RECEIVED', 8, `reception_line_id|'${rline}'`);
    // A card: sealed exactly until erased, with why; printed with its time.
    await run(`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, sku_id, reception_line_id, stock_entered_at)
      VALUES ('O26-V-77001', ${(26 << 25) | (cat << 20) | 77001}, 2026, ${cat}, 77001, 'SO-RG-52', '${model}', 'SILVER', '${sku}', '${rline}', now())`);
    const product = (await one<{ id: string }>(`SELECT id FROM products WHERE product_id = 'O26-V-77001'`)).id;
    await check(run(`INSERT INTO card_prints (product_id, reception_id) VALUES ('${product}', '${reception}')`), 'neither sealed nor erased', 'card_prints_sealed');
    await run(`INSERT INTO card_prints (product_id, reception_id, sealed_claim_code) VALUES ('${product}', '${reception}', 'v1.iv.sealed')`);
    await check(run(`UPDATE card_prints SET printed_count = 1 WHERE product_id = '${product}'`), 'printed without its time', 'card_prints_printed');
    await run(`UPDATE card_prints SET printed_count = 1, last_printed_at = now() WHERE product_id = '${product}'`);
    await check(run(`UPDATE card_prints SET erased_at = now(), erased_reason = 'ATTACHED' WHERE product_id = '${product}'`), 'erased with its code kept', 'card_prints_sealed');
    await check(run(`UPDATE card_prints SET sealed_claim_code = NULL, erased_at = now() WHERE product_id = '${product}'`), 'erased without why', 'card_prints_erased');
    await check(run(`UPDATE card_prints SET sealed_claim_code = NULL, erased_at = now(), erased_reason = 'LOST' WHERE product_id = '${product}'`), 'an unknown reason', 'card_prints_erased_reason_check');
    await run(`UPDATE card_prints SET sealed_claim_code = NULL, erased_at = now(), erased_reason = 'ATTACHED' WHERE product_id = '${product}'`);
    // A return to the supplier: returned with its time, its carrier only then; settled with its time, a credit's amount only.
    const ret = (await one<{ id: string }>(`INSERT INTO supplier_returns (supplier_order_id, reception_id, sku_id, quantity) VALUES ('${order}', '${reception}', '${sku}', 2) RETURNING id`)).id;
    await check(run(`UPDATE supplier_returns SET tracking_number = 'XY123456' WHERE id = '${ret}'`), 'a tracking number before it is sent', 'supplier_returns_returned');
    await check(run(`UPDATE supplier_returns SET status = 'RETURNED' WHERE id = '${ret}'`), 'returned without its time', 'supplier_returns_returned');
    await check(run(`UPDATE supplier_returns SET credit_minor = 100 WHERE id = '${ret}'`), 'an amount without a settlement', 'supplier_returns_settled');
    await check(run(`UPDATE supplier_returns SET settlement = 'CREDIT', settled_at = now() WHERE id = '${ret}'`), 'a credit without its amount', 'supplier_returns_settled');
    await check(run(`UPDATE supplier_returns SET settlement = 'REPLACEMENT', settled_at = now(), credit_minor = 100 WHERE id = '${ret}'`), 'a replacement with an amount', 'supplier_returns_settled');
    await run(`UPDATE supplier_returns SET status = 'RETURNED', returned_at = now(), returned_by = '${admin}', tracking_number = 'XY123456' WHERE id = '${ret}'`);
    await run(`UPDATE supplier_returns SET settlement = 'CREDIT', credit_minor = 24000, settled_at = now(), settled_by = '${admin}' WHERE id = '${ret}'`);
    await expect(run(`UPDATE supplier_returns SET quantity = 3 WHERE id = '${ret}'`)).rejects.toSatisfy(isGuardViolation);
    // A correction: never 0; decided with its time; approved with its movement, declined with its note; never deleted.
    await check(run(`INSERT INTO stock_corrections (sku_id, location_id, delta, reason, proposed_by) VALUES ('${sku}', '${location}', 0, 'None.', '${admin}')`), 'a correction of 0', 'stock_corrections_delta_check');
    const correction = (await one<{ id: string }>(`INSERT INTO stock_corrections (sku_id, location_id, delta, reason, proposed_by) VALUES ('${sku}', '${location}', -1, 'One found damaged.', '${admin}') RETURNING id`)).id;
    await check(run(`UPDATE stock_corrections SET status = 'DECLINED', decided_at = now() WHERE id = '${correction}'`), 'declined without its note', 'stock_corrections_declined');
    await check(run(`UPDATE stock_corrections SET status = 'APPROVED', decided_at = now() WHERE id = '${correction}'`), 'approved without its movement', 'stock_corrections_movement');
    await check(run(`UPDATE stock_corrections SET decided_at = now() WHERE id = '${correction}'`), 'a time decided while to approve', 'stock_corrections_decided');
    await ledger('ADJUSTED', -1);
    const movement = (await one<{ id: number }>(`SELECT max(id)::int AS id FROM stock_movements WHERE sku_id = '${sku}'`)).id;
    await run(`UPDATE stock_corrections SET status = 'APPROVED', decided_at = now(), decided_by = '${admin}', movement_id = ${movement} WHERE id = '${correction}'`);
    await expect(run(`UPDATE stock_corrections SET delta = -2 WHERE id = '${correction}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM stock_corrections WHERE id = '${correction}'`)).rejects.toSatisfy(isGuardViolation);
    // What they name stays (RESTRICT).
    for (const q of [`DELETE FROM skus WHERE id = '${sku}'`, `DELETE FROM reception_lines WHERE id = '${rline}'`, `DELETE FROM receptions WHERE id = '${reception}'`, `DELETE FROM supplier_orders WHERE id = '${order}'`]) {
      await expect(run(q), q).rejects.toSatisfy(isForeignKeyViolation);
    }
    // The down step refuses while any supplier order, reception or correction exists, and names the counts (0047 to 0037,
    // which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    await expect(down(t.db)).rejects.toThrow(/0036_supplier_orders cannot be rolled back: 2 supplier orders, 1 receptions and 1 stock corrections exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0036_supplier_orders')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow.
    await run(`ALTER TABLE stock_corrections DISABLE TRIGGER stock_corrections_no_delete`);
    await run(`DELETE FROM stock_corrections`);
    await run(`ALTER TABLE stock_corrections ENABLE TRIGGER stock_corrections_no_delete`);
    await run(`ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_append_only`);
    await run(`DELETE FROM stock_movements WHERE sku_id = '${sku}'`);
    await run(`ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_append_only`);
    for (const q of [
      `DELETE FROM supplier_returns`,
      `DELETE FROM card_prints`,
      `DELETE FROM products WHERE id = '${product}'`,
      `DELETE FROM reception_lines`,
      `DELETE FROM receptions`,
      `DELETE FROM supplier_order_lines`,
      `DELETE FROM supplier_orders`,
      `DELETE FROM skus WHERE model_id = '${model}'`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
    ]) {
      await run(q);
    }
    await run(`ALTER TABLE suppliers DISABLE TRIGGER suppliers_no_delete`);
    await run(`DELETE FROM suppliers WHERE id = '${supplier}'`);
    await run(`ALTER TABLE suppliers ENABLE TRIGGER suppliers_no_delete`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
    expect((await down(t.db)).reverted).toEqual(['0036_supplier_orders']);
    expect((await up(t.db)).applied).toEqual(['0036_supplier_orders', '0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** What names an object of 0037 in a snapshot: its three tables, the orders' new columns and constraints, the queue's index. */
  const of0037 = (o: string) =>
    /\b(shipments|shipment_items|order_cases)\b/.test(o) ||
    /\b(orders_awaiting_idx|orders_exchange_of_order\w*|orders_packing)\b/.test(o) ||
    /^table orders (queue_first|exchange_of_order_id|packing_started_at) /.test(o);

  it('0037 adds AWAITING and the queue, the EXCHANGE channel, the packing lock, the parcels and the order cases, and nothing else; down restores 0036 exactly (0022\'s reservation, 0029\'s channel and source, 0027\'s identity guard, the delay\'s default 3), and up again moving BENCH to AWAITING and cancelling the open pieces to make', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0037_fulfilment');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    // Besides its own objects, 0037 rebuilds three CHECKs of the orders, the identity guard and the delay's default.
    const rebuilt = [
      'column order_alert_settings ready_days',
      'constraint orders orders_channel_check',
      'constraint orders orders_reservation_check',
      'constraint orders orders_source',
    ];
    const head = (o: string) => o.split(' ').slice(0, 3).join(' ');
    expect(added.filter((o) => !of0037(o)).map(head).filter((o) => !o.startsWith('trigger orders')).sort()).toEqual(expect.arrayContaining(rebuilt.filter((r) => !r.startsWith('column'))));
    expect(before.filter(of0037)).toEqual([]);
    expect(added.find((o) => o.startsWith('constraint orders orders_reservation_check'))).toContain("'AWAITING'::text");
    expect(added.find((o) => o.startsWith('constraint orders orders_reservation_check'))).not.toContain("'BENCH'::text");
    expect(removed.find((o) => o.startsWith('constraint orders orders_reservation_check'))).toContain("'BENCH'::text");
    expect(added.find((o) => o.startsWith('constraint orders orders_channel_check'))).toContain("'EXCHANGE'::text");
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('orders')).toEqual(['exchange_of_order_id', 'packing_started_at', 'queue_first']);
    expect(columns('shipment_items')).toEqual(['order_id', 'product_id', 'scan_event_id', 'scanned_at', 'shipment_id']);
    expect(columns('shipments')).toHaveLength(20);
    expect(columns('order_cases')).toHaveLength(26);
    for (const c of [
      /^constraint orders orders_exchange_of_order_id_fkey FOREIGN KEY \(exchange_of_order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint shipments shipments_order_id_fkey FOREIGN KEY \(order_id\) REFERENCES orders\(id\) ON DELETE RESTRICT$/,
      /^constraint order_cases order_cases_message_id_fkey FOREIGN KEY \(message_id\) REFERENCES client_messages\(id\) ON DELETE RESTRICT$/,
      /^constraint order_cases order_cases_exchange_sku_id_fkey FOREIGN KEY \(exchange_sku_id\) REFERENCES skus\(id\) ON DELETE RESTRICT$/,
      /^constraint order_cases order_cases_outcome CHECK /,
      /^constraint shipments shipments_shipped CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger ') && !o.startsWith('trigger orders '))).toEqual([
      'trigger order_cases order_cases_immutable_identity',
      'trigger order_cases order_cases_no_delete',
      'trigger order_cases order_cases_no_truncate',
      'trigger shipment_items shipment_items_immutable_identity',
      'trigger shipments shipments_immutable_identity',
    ]);
    // Existing data: an order holding a piece to make waits for supplier stock; its piece to make is cancelled, its
    // reserved identity left as it is; a stored delay of 3 (the old default) becomes 5.
    await sql`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`.execute(t.db);
    const cat = (await sql<{ id: number }>`SELECT id FROM categories WHERE code = 'K'`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('f-0037@example.com', 'f-0037@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'AWAITED', 'RING', 'AWT-RG') RETURNING id`.execute(t.db)).rows[0].id;
    const sku = (await sql<{ id: string }>`INSERT INTO skus (model_id, size_label, code) VALUES (${model}, '52', 'AWT-RG-52') RETURNING id`.execute(t.db)).rows[0].id;
    const location = (await sql<{ id: string }>`INSERT INTO stock_locations (name) VALUES ('FULFILMENT 0037') RETURNING id`.execute(t.db)).rows[0].id;
    const request = (await sql<{ id: string }>`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES (${account}, ${model}, 'CLOSED', now(), 'ACCEPTED') RETURNING id`.execute(t.db)).rows[0].id;
    const order = (await sql<{ id: string }>`INSERT INTO orders (channel, shop_request_id, account_id, model_id, size_label, sku_id, location_id, reservation) VALUES ('SALON', ${request}, ${account}, ${model}, '52', ${sku}, ${location}, 'BENCH') RETURNING id`.execute(t.db)).rows[0].id;
    const identity = (
      await sql<{ id: string }>`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material, sku_id, status)
        VALUES (${`O26-K-00001`}, ${(26 << 25) | (cat << 20) | 1}, 2026, ${cat}, 1, 'AWT-RG-52', ${model}, 'SILVER', ${sku}, 'RESERVED') RETURNING id`.execute(t.db)
    ).rows[0].id;
    const bench = (await sql<{ id: string }>`INSERT INTO bench_items (order_id, sku_id, location_id, product_id, status, started_at) VALUES (${order}, ${sku}, ${location}, ${identity}, 'IN_PROGRESS', now()) RETURNING id`.execute(t.db)).rows[0].id;
    await sql`INSERT INTO order_alert_settings (id, ready_days) VALUES (1, 3) ON CONFLICT (id) DO UPDATE SET ready_days = 3`.execute(t.db);
    expect((await up(t.db)).applied).toEqual(['0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect((await sql<{ reservation: string; queue_first: boolean }>`SELECT reservation, queue_first FROM orders WHERE id = ${order}`.execute(t.db)).rows[0]).toEqual({ reservation: 'AWAITING', queue_first: false });
    expect((await sql<{ status: string; cancelled: boolean }>`SELECT status, cancelled_at IS NOT NULL AS cancelled FROM bench_items WHERE id = ${bench}`.execute(t.db)).rows[0]).toEqual({ status: 'CANCELLED', cancelled: true });
    expect((await sql<{ status: string }>`SELECT status FROM products WHERE id = ${identity}`.execute(t.db)).rows[0].status).toBe('RESERVED');
    expect((await sql<{ ready_days: number }>`SELECT ready_days FROM order_alert_settings`.execute(t.db)).rows[0].ready_days).toBe(5);
    // Cleared by hand for the roll-backs that follow.
    await sql`DELETE FROM order_alert_settings`.execute(t.db);
    await sql`DELETE FROM bench_items WHERE id = ${bench}`.execute(t.db);
    await sql`DELETE FROM orders WHERE id = ${order}`.execute(t.db);
    await sql`DELETE FROM products WHERE id = ${identity}`.execute(t.db);
    await sql`DELETE FROM shop_requests WHERE id = ${request}`.execute(t.db);
    await sql`DELETE FROM skus WHERE id = ${sku}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
    await sql`DELETE FROM stock_locations WHERE id = ${location}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id = ${account}`.execute(t.db);
  });

  it('0037: AWAITING or STOCK held only; an EXCHANGE order names its original once and no other source; packing only once paid; a parcel\'s status with its times and photo; one open parcel per order; an order case\'s kind with its columns, each step with its times and its outcome as its kind allows, one not ended per order, never deleted; down refused while an AWAITING or EXCHANGE order, a shipment or a case exists', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('f-0037@orbes.test', 'f-0037@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('c-0037@example.com', 'c-0037@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'K'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'PARCEL', 'RING', 'PCL-RG') RETURNING id`)).id;
    const sku = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${model}', '52', 'PCL-RG-52') RETURNING id`)).id;
    const sku54 = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${model}', '54', 'PCL-RG-54') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('PARCELS 0037') RETURNING id`)).id;
    const carrier = (await one<{ id: string }>(`INSERT INTO carriers (name, tracking_url) VALUES ('PARCEL CARRIER 0037', 'https://track.example/{tracking}') RETURNING id`)).id;
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const order = (cols: Record<string, string>) => {
      const all: Record<string, string> = { account_id: `'${account}'`, model_id: `'${model}'`, location_id: `'${location}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO orders (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(order({ channel: `'SALON'`, shop_request_id: `'${request}'`, sku_id: `'${sku}'`, reservation: `'BENCH'` }), 'a piece to make', 'orders_reservation_check');
    const original = (await order({ channel: `'SALON'`, shop_request_id: `'${request}'`, size_label: `'52'`, sku_id: `'${sku}'`, reservation: `'AWAITING'`, price_minor: '1000', currency: `'EUR'` })).rows[0].id;
    // An EXCHANGE: its original once, no other source; never on another channel; never itself.
    await check(order({ channel: `'EXCHANGE'` }), 'an exchange of nothing', 'orders_source');
    await check(order({ channel: `'EXCHANGE'`, exchange_of_order_id: `'${original}'`, shop_request_id: `'${request}'` }), 'an exchange from a request', 'orders_source');
    await check(order({ channel: `'SALON'`, shop_request_id: `'${request}'`, exchange_of_order_id: `'${original}'` }), 'a salon order exchanging another', 'orders_source');
    const exchange = (await order({ channel: `'EXCHANGE'`, exchange_of_order_id: `'${original}'`, size_label: `'54'`, sku_id: `'${sku54}'`, reservation: `'STOCK'` })).rows[0].id;
    await expect(order({ channel: `'EXCHANGE'`, exchange_of_order_id: `'${original}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'orders_exchange_of_order_key'));
    await expect(run(`UPDATE orders SET exchange_of_order_id = '${exchange}' WHERE id = '${exchange}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE orders SET queue_first = true WHERE id = '${original}'`)).resolves.toBeDefined();
    // Packing only once paid, never before its payment.
    await check(run(`UPDATE orders SET packing_started_at = now() WHERE id = '${original}'`), 'packing an order not paid', 'orders_packing');
    await run(`UPDATE orders SET status = 'PAID', paid_at = now(), packing_started_at = now() WHERE id = '${original}'`);
    await check(run(`UPDATE orders SET packing_started_at = paid_at - interval '1 hour' WHERE id = '${original}'`), 'packing before its payment', 'orders_packing');

    // A parcel: its steps with their times, its photo whole, one open per order.
    const shipment = (cols = '') =>
      sql.raw<{ id: string }>(`INSERT INTO shipments (order_id, location_id, packing_started_by${cols ? `, ${cols.split('|')[0]}` : ''}) VALUES ('${original}', '${location}', '${admin}'${cols ? `, ${cols.split('|')[1]}` : ''}) RETURNING id`).execute(t.db);
    await check(shipment(`status|'PACKED'`), 'packed without its time', 'shipments_packed');
    await check(shipment(`packed_at|now()`), 'a time packed while packing', 'shipments_packed');
    await check(shipment(`status, packed_at|'SHIPPED', now()`), 'shipped without its carrier', 'shipments_shipped');
    await check(shipment(`photo|'\\x00ff'::bytea`), 'a photo without its type', 'shipments_photo');
    await check(shipment(`photo, photo_mime, photo_sha256|'\\x00ff'::bytea, 'image/png', '${'a'.repeat(64)}'`), 'a PNG', 'shipments_photo_mime_check');
    await check(shipment(`photo, photo_mime, photo_sha256|decode(repeat('00', 1048577), 'hex'), 'image/jpeg', '${'a'.repeat(64)}'`), 'more than 1 MiB', 'shipments_photo_check');
    await check(shipment(`checklist|'{}'::jsonb`), 'a checklist not a list', 'shipments_checklist_check');
    await check(shipment(`status|'CANCELLED'`), 'cancelled without its time', 'shipments_cancelled');
    const parcel = (await shipment()).rows[0].id;
    await expect(shipment()).rejects.toSatisfy((e) => isUniqueViolation(e, 'shipments_one_open'));
    await run(`UPDATE shipments SET photo = '\\x00ff'::bytea, photo_mime = 'image/jpeg', photo_sha256 = '${'b'.repeat(64)}', checklist = '[{"key":"box","label":"The box and the pouch"}]' WHERE id = '${parcel}'`);
    await expect(run(`UPDATE shipments SET order_id = '${exchange}' WHERE id = '${parcel}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`INSERT INTO shipment_items (shipment_id, order_id) VALUES ('${parcel}', '${original}')`);
    await check(run(`UPDATE shipment_items SET product_id = (SELECT id FROM products LIMIT 1) WHERE shipment_id = '${parcel}'`), 'a piece bound without its scan', 'shipment_items_scanned');
    await run(`UPDATE shipments SET status = 'PACKED', packed_at = now(), packed_by = '${admin}' WHERE id = '${parcel}'`);
    await check(run(`UPDATE shipments SET status = 'SHIPPED', shipped_at = now() WHERE id = '${parcel}'`), 'shipped without its tracking', 'shipments_shipped');
    await run(`UPDATE shipments SET status = 'SHIPPED', shipped_at = now(), shipped_by = '${admin}', carrier_id = '${carrier}', tracking_number = '6A10987654321' WHERE id = '${parcel}'`);
    await check(run(`UPDATE shipments SET status = 'DELIVERED' WHERE id = '${parcel}'`), 'delivered without its time', 'shipments_delivered');
    await check(run(`UPDATE shipments SET photo_erased_at = now() WHERE id = '${parcel}'`), 'erased with its photo kept', 'shipments_photo');

    // An order case: its kind with its columns.
    const kase = (cols: Record<string, string>) => {
      const all: Record<string, string> = { order_id: `'${original}'`, opened_by_type: `'admin'`, opened_by_id: `'${admin}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO order_cases (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(kase({ kind: `'RETURN'` }), 'a return without its reason', 'order_cases_reason');
    await check(kase({ kind: `'LOST'`, reason: `'SIZE'`, shipment_id: `'${parcel}'` }), 'a parcel problem with a reason', 'order_cases_reason');
    await check(kase({ kind: `'LOST'` }), 'a parcel problem without its parcel', 'order_cases_shipment');
    await check(kase({ kind: `'RETURN'`, reason: `'SIZE'`, shipment_id: `'${parcel}'` }), 'a return naming a parcel', 'order_cases_shipment');
    await check(kase({ kind: `'EXCHANGE'`, reason: `'SIZE'` }), 'an exchange without its size', 'order_cases_exchange_size');
    await check(kase({ kind: `'RETURN'`, reason: `'SIZE'`, exchange_sku_id: `'${sku54}'`, exchange_size_label: `'54'` }), 'a return with a size', 'order_cases_exchange_size');
    await check(kase({ kind: `'RETURN'`, reason: `'TOO_LATE'` }), 'an unknown reason', 'order_cases_reason_check');
    await check(kase({ kind: `'RETURN'`, reason: `'SIZE'`, note: `'  '` }), 'an empty note', 'order_cases_note_check');
    await check(kase({ kind: `'RETURN'`, reason: `'SIZE'`, opened_by_type: `'system'` }), 'opened by the system', 'order_cases_opened_by_type_check');
    await check(kase({ kind: `'LOST'`, shipment_id: `'${parcel}'`, status: `'RECEIVED'`, received_at: 'now()', piece_state: `'OK'` }), 'a lost parcel received', 'order_cases_received');
    const ret = (await kase({ kind: `'EXCHANGE'`, reason: `'SIZE'`, exchange_sku_id: `'${sku54}'`, exchange_size_label: `'54'`, note: `'Too small.'` })).rows[0].id;
    await expect(kase({ kind: `'RETURN'`, reason: `'OTHER'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'order_cases_one_open'));
    for (const q of [`UPDATE order_cases SET note = 'Changed.' WHERE id = '${ret}'`, `UPDATE order_cases SET kind = 'RETURN' WHERE id = '${ret}'`, `DELETE FROM order_cases WHERE id = '${ret}'`]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // Each step with its times; the outcome as the kind allows.
    await check(run(`UPDATE order_cases SET status = 'RECEIVED' WHERE id = '${ret}'`), 'received without its time', 'order_cases_received');
    await check(run(`UPDATE order_cases SET received_at = now(), piece_state = 'OK' WHERE id = '${ret}'`), 'a time received while open', 'order_cases_received');
    await run(`UPDATE order_cases SET status = 'RECEIVED', received_at = now(), received_by = '${admin}', piece_state = 'DAMAGED', receive_note = 'A scratch.' WHERE id = '${ret}'`);
    await check(run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now() WHERE id = '${ret}'`), 'closed without its outcome', 'order_cases_closed');
    await check(run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now(), outcome = 'RESHIP' WHERE id = '${ret}'`), 'an exchange reshipped', 'order_cases_outcome');
    await check(run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now(), outcome = 'REFUND', exchange_order_id = '${exchange}' WHERE id = '${ret}'`), 'a refund with an exchange order', 'order_cases_closed');
    await check(run(`UPDATE order_cases SET status = 'CANCELLED', cancelled_at = now() WHERE id = '${ret}'`), 'cancelled without its note', 'order_cases_cancelled');
    await run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now(), closed_by = '${admin}', outcome = 'EXCHANGE', piece_to = 'RESTOCKED', exchange_order_id = '${exchange}', decision_note = 'The other size.' WHERE id = '${ret}'`);
    await expect(kase({ kind: `'RETURN'`, reason: `'OTHER'` })).resolves.toBeDefined();
    await run(`UPDATE order_cases SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = '${admin}', cancel_note = 'Withdrawn.' WHERE order_id = '${original}' AND status = 'OPEN'`);
    const lost = (await kase({ kind: `'LOST'`, shipment_id: `'${parcel}'`, note: `'Never arrived.'` })).rows[0].id;
    await check(run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now(), outcome = 'EXCHANGE' WHERE id = '${lost}'`), 'a lost parcel exchanged', 'order_cases_outcome');
    await run(`UPDATE order_cases SET status = 'CLOSED', closed_at = now(), closed_by = '${admin}', outcome = 'RESHIP', piece_to = 'REVOKED' WHERE id = '${lost}'`);
    // What they name stays (RESTRICT).
    for (const q of [`DELETE FROM shipments WHERE id = '${parcel}'`, `DELETE FROM orders WHERE id = '${exchange}'`, `DELETE FROM skus WHERE id = '${sku54}'`]) {
      await expect(run(q), q).rejects.toSatisfy(isForeignKeyViolation);
    }
    // The down step refuses while an AWAITING or EXCHANGE order, a shipment or a case exists, and names the counts (0047
    // to 0038, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    await expect(down(t.db)).rejects.toThrow(/0037_fulfilment cannot be rolled back: 1 orders awaiting stock, 1 exchange orders, 1 shipments and 3 order cases exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0037_fulfilment')?.executedAt).toBeDefined();
    // Cleared by hand for the roll-backs that follow (cases are never deleted).
    await run(`ALTER TABLE order_cases DISABLE TRIGGER order_cases_no_delete`);
    await run(`DELETE FROM order_cases`);
    await run(`ALTER TABLE order_cases ENABLE TRIGGER order_cases_no_delete`);
    for (const q of [
      `DELETE FROM shipment_items`,
      `DELETE FROM shipments`,
      `DELETE FROM orders WHERE id = '${exchange}'`,
      `DELETE FROM orders WHERE id = '${original}'`,
      `DELETE FROM shop_requests WHERE id = '${request}'`,
      `DELETE FROM skus WHERE model_id = '${model}'`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
      `DELETE FROM carriers WHERE id = '${carrier}'`,
      `DELETE FROM accounts WHERE id = '${account}'`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await run(q);
    }
    expect((await down(t.db)).reverted).toEqual(['0037_fulfilment']);
    expect((await up(t.db)).applied).toEqual(['0037_fulfilment', '0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
  });

  /** What names an object of 0038 in a snapshot: the entries' size, its foreign key and its index. */
  const of0038 = (o: string) => /\bdrop_entries_size_(fkey|idx)\b/.test(o) || /^table drop_entries size_id /.test(o);

  it('0038 adds an entry\'s size, its foreign key to a size of its own drop and its index, and nothing else; down restores 0037 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0038_draw_sizes');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    expect(removed).toEqual([]);
    expect(added.filter((o) => !of0038(o))).toEqual([]);
    expect(before.filter(of0038)).toEqual([]);
    expect(added).toEqual([
      'constraint drop_entries drop_entries_size_fkey FOREIGN KEY (drop_id, size_id) REFERENCES drop_sizes(drop_id, id) ON DELETE RESTRICT',
      'index CREATE INDEX drop_entries_size_idx ON public.drop_entries USING btree (drop_id, size_id, status, rank)',
      'table drop_entries size_id uuid YES ',
    ]);
    // Existing data: every entry keeps no size; a draw published before keeps one pool.
    await sql`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`.execute(t.db);
    const cat = (await sql<{ id: number }>`SELECT id FROM categories WHERE code = 'K'`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('d-0038@orbes.test', 'd-0038@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('d-0038@example.com', 'd-0038@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'POOLED', 'RING', 'POL-RG') RETURNING id`.execute(t.db)).rows[0].id;
    const drop = (
      await sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, created_by, published_at)
        VALUES (${model}, 'ONE POOL', 3, now() + interval '1 day', now() + interval '2 days', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${new Uint8Array(32)}, ${admin}, now()) RETURNING id`.execute(t.db)
    ).rows[0].id;
    const entry = (await sql<{ id: string }>`INSERT INTO drop_entries (drop_id, account_id) VALUES (${drop}, ${account}) RETURNING id`.execute(t.db)).rows[0].id;
    expect((await up(t.db)).applied).toEqual(['0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect((await sql<{ size_id: string | null }>`SELECT size_id FROM drop_entries WHERE id = ${entry}`.execute(t.db)).rows[0].size_id).toBeNull();
    // A published draw without sizes does not hold the down step.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await up(t.db)).applied).toEqual(['0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await sql`DELETE FROM drop_entries WHERE id = ${entry}`.execute(t.db);
    await sql`DELETE FROM drops WHERE id = ${drop}`.execute(t.db);
    await sql`DELETE FROM models WHERE id = ${model}`.execute(t.db);
    await sql`DELETE FROM accounts WHERE id = ${account}`.execute(t.db);
    await sql`DELETE FROM admin_users WHERE id = ${admin}`.execute(t.db);
  });

  it('0038: an entry\'s size is one of its own drop\'s, kept while an entry chose it (RESTRICT), and none in a draw without sizes; down refused while a published draw has sizes, naming the count, a draft with sizes not holding it', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    await sql`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`.execute(t.db);
    const cat = (await sql<{ id: number }>`SELECT id FROM categories WHERE code = 'K'`.execute(t.db)).rows[0].id;
    const admin = (await sql<{ id: string }>`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('s-0038@orbes.test', 's-0038@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`.execute(t.db)).rows[0].id;
    const account = (await sql<{ id: string }>`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('s-0038@example.com', 's-0038@example.com', 'scrypt$x') RETURNING id`.execute(t.db)).rows[0].id;
    const model = (await sql<{ id: string }>`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'SIZED', 'RING', 'SZD-RG') RETURNING id`.execute(t.db)).rows[0].id;
    const newDraw = async (title: string, published: boolean) =>
      (
        await sql<{ id: string }>`INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash, created_by, published_at)
          VALUES (${model}, ${title}, 8, now() + interval '1 day', now() + interval '2 days', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${new Uint8Array(32)}, ${admin}, ${published ? new Date() : null}) RETURNING id`.execute(t.db)
      ).rows[0].id;
    const drop = await newDraw('SIZED DRAW', true);
    const other = await newDraw('OTHER DRAW', false);
    const size = (await sql<{ id: string }>`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES (${drop}, '17', 1, 5) RETURNING id`.execute(t.db)).rows[0].id;
    await run(`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES ('${drop}', '18', 2, 3)`);
    const elsewhere = (await sql<{ id: string }>`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES (${other}, '17', 1, 8) RETURNING id`.execute(t.db)).rows[0].id;
    // A size of its own drop; another drop's size is refused, and none is allowed.
    const entry = (await sql<{ id: string }>`INSERT INTO drop_entries (drop_id, account_id, size_id) VALUES (${drop}, ${account}, ${size}) RETURNING id`.execute(t.db)).rows[0].id;
    await expect(run(`UPDATE drop_entries SET size_id = '${elsewhere}' WHERE id = '${entry}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e, 'drop_entries_size_fkey'));
    await run(`UPDATE drop_entries SET size_id = NULL WHERE id = '${entry}'`);
    await run(`UPDATE drop_entries SET size_id = '${size}' WHERE id = '${entry}'`);
    // The size an entry chose stays (RESTRICT).
    await expect(run(`DELETE FROM drop_sizes WHERE id = '${size}'`)).rejects.toSatisfy(isForeignKeyViolation);
    // The down step refuses while a published draw has sizes, and names the count; the draft with sizes does not count
    // (0047 to 0039, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    await expect(down(t.db)).rejects.toThrow(/0038_draw_sizes cannot be rolled back: 1 published draws have sizes/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0038_draw_sizes')?.executedAt).toBeDefined();
    await run(`DELETE FROM drop_entries WHERE id = '${entry}'`);
    await run(`DELETE FROM drop_sizes WHERE drop_id = '${drop}'`);
    expect((await down(t.db)).reverted).toEqual(['0038_draw_sizes']);
    expect((await up(t.db)).applied).toEqual(['0038_draw_sizes', '0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    for (const q of [`DELETE FROM drop_sizes WHERE drop_id = '${other}'`, `DELETE FROM drops WHERE id IN ('${drop}', '${other}')`, `DELETE FROM models WHERE id = '${model}'`, `DELETE FROM accounts WHERE id = '${account}'`, `DELETE FROM admin_users WHERE id = '${admin}'`]) {
      await run(q);
    }
  });

  /** What names an object of 0039 in a snapshot: its two tables, the orders' and the invoices' new columns, constraints and indexes. */
  const of0039 = (o: string) =>
    /\b(account_addresses|engraving_prices)\w*\b/.test(o) ||
    /\borders_(buyer_country|buyer_phone|address_by|address_changed|address_travels|engraving_minor|engraving_price|engraving_by)\w*\b/.test(o) ||
    /^table orders (buyer_country|buyer_phone|address_by|address_at|address_changed_at|engraving_minor|engraving_by) /.test(o) ||
    /\binvoices_(supplements|credit_scope|credits_idx|full_credit_key|one_per_order|credits_key|invoices_supplements_invoice_id_fkey)\w*\b/.test(o) ||
    /\binvoices_supplements_invoice_id_fkey\b/.test(o) ||
    /^table invoices (supplements_invoice_id|credit_scope) /.test(o);

  it('0039 adds the saved addresses, the order\'s delivery address and engraving, the engraving prices, the supplementary invoice and the credit note for single lines, and nothing else; down restores 0038 exactly, and up again over the data of before', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0039_order_delivery');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    expect(added.filter((o) => !of0039(o))).toEqual([]);
    // Only 0022's invoice keys go: the one invoice per order (rebuilt) and the one credit note per invoice (replaced).
    expect(removed).toEqual([
      "constraint invoices invoices_credits_key UNIQUE (credits_invoice_id)",
      "index CREATE UNIQUE INDEX invoices_credits_key ON public.invoices USING btree (credits_invoice_id)",
      "index CREATE UNIQUE INDEX invoices_one_per_order ON public.invoices USING btree (order_id) WHERE (kind = 'INVOICE'::text)",
    ]);
    for (const c of [
      /^constraint account_addresses account_addresses_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_addresses account_addresses_phone_check CHECK \(\(phone ~ '\^\\\+\[0-9\]\[0-9 \(\)\.-\]\{5,24\}\$'::text\)\)$/,
      /^index CREATE UNIQUE INDEX account_addresses_one_default ON public\.account_addresses USING btree \(account_id\) WHERE is_default$/,
      /^index CREATE INDEX account_addresses_account_idx ON public\.account_addresses USING btree \(account_id, created_at\)$/,
      /^trigger account_addresses account_addresses_immutable_identity$/,
      /^constraint orders orders_address_travels CHECK /,
      /^constraint orders orders_engraving_by CHECK /,
      /^index CREATE INDEX engraving_prices_updated_by_idx ON public\.engraving_prices USING btree \(updated_by\)$/,
      /^index CREATE INDEX invoices_supplements_idx ON public\.invoices USING btree \(supplements_invoice_id\)$/,
      /^index CREATE INDEX invoices_credits_idx ON public\.invoices USING btree \(credits_invoice_id\)$/,
      /^index CREATE UNIQUE INDEX invoices_one_per_order ON public\.invoices USING btree \(order_id\) WHERE \(\(kind = 'INVOICE'::text\) AND \(supplements_invoice_id IS NULL\)\)$/,
      /^index CREATE UNIQUE INDEX invoices_full_credit_key ON public\.invoices USING btree \(credits_invoice_id\) WHERE \(credit_scope = 'FULL'::text\)$/,
      /^table invoices credit_scope text YES $/,
      /^table orders buyer_phone text YES $/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // The invoices' guard is the same trigger before and after (dropped and made again for the credit notes of before).
    expect(withIt.filter((o) => o.startsWith('trigger invoices '))).toEqual(before.filter((o) => o.startsWith('trigger invoices ')));
    // Existing data, at 0038: an order with its buyer entered by Client Services, its engraving; a welcome gift travelling
    // with it, with an old buyer of its own; an order without an address; an invoice and its credit note.
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('d-0039@example.com', 'd-0039@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'K'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'DELIVERY', 'RING', 'DLV-RG') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('DELIVERY 0039') RETURNING id`)).id;
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const grant = (await one<{ id: string }>(`INSERT INTO tier_grants (account_id, tier, kind) VALUES ('${account}', 2, 'GIFT') RETURNING id`)).id;
    const parent = (
      await one<{ id: string }>(
        `INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id, price_minor, currency, engraving_text, buyer_name, buyer_address, reserved_at)
         VALUES ('SALON', '${request}', '${account}', '${model}', '${location}', 1000, 'EUR', 'J.M.', 'Jane Doe', '1 rue de la Paix', '2026-10-01T10:00:00Z') RETURNING id`,
      )
    ).id;
    await run(`INSERT INTO order_events (order_id, action, status, actor_type, created_at) VALUES ('${parent}', 'order.buyer', 'RESERVED', 'system', '2026-10-02T09:00:00Z'), ('${parent}', 'order.buyer', 'RESERVED', 'system', '2026-10-03T09:00:00Z')`);
    const gift = (
      await one<{ id: string }>(
        `INSERT INTO orders (channel, gift_grant_id, with_order_id, account_id, model_id, location_id, buyer_name, buyer_address) VALUES ('GIFT', '${grant}', '${parent}', '${account}', '${model}', '${location}', 'Old buyer', 'Old address') RETURNING id`,
      )
    ).id;
    const invoice = (
      await one<{ id: string }>(
        `INSERT INTO invoices (kind, year, sequence, order_id, issuer, buyer, lines, currency, subtotal_minor, total_minor)
         VALUES ('INVOICE', 2026, 990001, '${parent}', '{}', '{}', '[{"kind":"PIECE","label":"DELIVERY","amountMinor":1000}]', 'EUR', 1000, 1000) RETURNING id`,
      )
    ).id;
    const credit = (
      await one<{ id: string }>(
        `INSERT INTO invoices (kind, year, sequence, order_id, credits_invoice_id, issuer, buyer, lines, currency, subtotal_minor, total_minor)
         VALUES ('CREDIT_NOTE', 2026, 990001, '${parent}', '${invoice}', '{}', '{}', '[{"kind":"PIECE","label":"DELIVERY","amountMinor":1000}]', 'EUR', 1000, 1000) RETURNING id`,
      )
    ).id;
    expect((await up(t.db)).applied).toEqual(['0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    const orderRow = (id: string) =>
      one<Record<string, unknown>>(`SELECT buyer_name, buyer_address, buyer_country, buyer_phone, address_by, address_at, address_changed_at, engraving_text, engraving_minor, engraving_by FROM orders WHERE id = '${id}'`);
    // The order's address entered by STAFF at its latest order.buyer event; its engraving STAFF's, without a price.
    expect(await orderRow(parent)).toEqual({
      buyer_name: 'Jane Doe', buyer_address: '1 rue de la Paix', buyer_country: null, buyer_phone: null,
      address_by: 'STAFF', address_at: new Date('2026-10-03T09:00:00Z'), address_changed_at: null,
      engraving_text: 'J.M.', engraving_minor: null, engraving_by: 'STAFF',
    });
    // The travelling order keeps its old buyer, with no address_by: orders_address_travels holds, the migration passes.
    expect(await orderRow(gift)).toMatchObject({ buyer_name: 'Old buyer', buyer_address: 'Old address', address_by: null, address_at: null, engraving_by: null });
    // The credit note of before credits in full; the invoice has no scope.
    expect((await one<{ credit_scope: string | null }>(`SELECT credit_scope FROM invoices WHERE id = '${credit}'`)).credit_scope).toBe('FULL');
    expect((await one<{ credit_scope: string | null; supplements_invoice_id: string | null }>(`SELECT credit_scope, supplements_invoice_id FROM invoices WHERE id = '${invoice}'`))).toEqual({ credit_scope: null, supplements_invoice_id: null });
    // An order without an address keeps none: an address of before needs its address lines.
    const bare = (await one<{ id: string }>(`INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id) VALUES ('SALON', '${(await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id}', '${account}', '${model}', '${location}') RETURNING id`)).id;
    expect(await orderRow(bare)).toMatchObject({ address_by: null, address_at: null });
    // Down and up again with that data (no supplementary invoice, no credit note for single lines): it passes.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await up(t.db)).applied).toEqual(['0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ credit_scope: string | null }>(`SELECT credit_scope FROM invoices WHERE id = '${credit}'`)).credit_scope).toBe('FULL');
    // Cleared by hand for the roll-backs that follow (an invoice is never deleted).
    await run(`ALTER TABLE invoices DISABLE TRIGGER invoices_immutable`);
    await run(`DELETE FROM invoices WHERE id IN ('${credit}')`);
    await run(`DELETE FROM invoices WHERE id IN ('${invoice}')`);
    await run(`ALTER TABLE invoices ENABLE TRIGGER invoices_immutable`);
    await run(`ALTER TABLE order_events DISABLE TRIGGER order_events_append_only`);
    await run(`DELETE FROM order_events WHERE order_id = '${parent}'`);
    await run(`ALTER TABLE order_events ENABLE TRIGGER order_events_append_only`);
    await run(`DELETE FROM orders WHERE id = '${gift}'`);
    for (const id of [parent, bare]) await run(`DELETE FROM orders WHERE id = '${id}'`);
    await run(`ALTER TABLE tier_grants DISABLE TRIGGER tier_grants_no_delete`);
    await run(`DELETE FROM tier_grants WHERE id = '${grant}'`);
    await run(`ALTER TABLE tier_grants ENABLE TRIGGER tier_grants_no_delete`);
    await run(`DELETE FROM shop_requests WHERE account_id = '${account}'`);
    await run(`DELETE FROM stock_locations WHERE id = '${location}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
  });

  it('0039: a saved address\'s fields and its one default; the order\'s country, phone and their author together, a change never before the first entry, none on a travelling order; an engraving\'s price and author with its words; the engraving prices in the four currencies; a supplementary invoice of an invoice only, one main invoice per order, credit notes for single lines then one in full; down refused while a supplementary invoice or a credit note for single lines exists', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('s-0039@orbes.test', 's-0039@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('s-0039@example.com', 's-0039@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('o-0039@example.com', 'o-0039@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'K'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'ADDRESSED', 'RING', 'ADR-RG') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('ADDRESSES 0039') RETURNING id`)).id;

    // A saved address: its fields, one default per account, its identity kept.
    const address = (cols: Record<string, string>) => {
      const all: Record<string, string> = { account_id: `'${account}'`, name: `'Jane Doe'`, address: `'1 rue de la Paix\n75002 Paris'`, country: `'FR'`, phone: `'+33 6 12 34 56 78'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO account_addresses (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(address({ name: `''` }), 'an empty name', 'account_addresses_name_check');
    await check(address({ name: `' Jane'` }), 'a name not trimmed', 'account_addresses_name_check');
    await check(address({ address: `'${'x'.repeat(1001)}'` }), 'an address of 1001 characters', 'account_addresses_address_check');
    await check(address({ country: `'fr'` }), 'a country in lower case', 'account_addresses_country_check');
    await check(address({ phone: `'06 12 34 56 78'` }), 'a phone without its country code', 'account_addresses_phone_check');
    await check(address({ phone: `'+33'` }), 'a phone too short', 'account_addresses_phone_check');
    const first = (await address({ is_default: 'true' })).rows[0].id;
    await expect(address({ is_default: 'true' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_addresses_one_default'));
    await address({});
    await address({ account_id: `'${other}'`, is_default: 'true' });
    await expect(run(`UPDATE account_addresses SET account_id = '${other}' WHERE id = '${first}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE account_addresses SET name = 'Jane Martin', is_default = false WHERE id = '${first}'`);
    await run(`DELETE FROM account_addresses WHERE id = '${first}'`);

    // The order's delivery address.
    const request = async () => (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const order = async (cols: Record<string, string>) => {
      const all: Record<string, string> = { channel: `'SALON'`, shop_request_id: `'${await request()}'`, account_id: `'${account}'`, model_id: `'${model}'`, location_id: `'${location}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO orders (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(order({ buyer_country: `'FRA'` }), 'a country of three letters', 'orders_buyer_country_check');
    await check(order({ buyer_phone: `'0612345678'` }), 'a phone without its country code', 'orders_buyer_phone_check');
    await check(order({ address_by: `'AGENT'`, address_at: 'now()' }), 'an unknown author', 'orders_address_by_check');
    await check(order({ address_by: `'COLLECTOR'` }), 'an author without its time', 'orders_address_by');
    await check(order({ address_at: 'now()' }), 'a time without its author', 'orders_address_by');
    await check(order({ address_changed_at: 'now()' }), 'a change of no address', 'orders_address_changed');
    await check(order({ address_by: `'COLLECTOR'`, address_at: 'now()', address_changed_at: `now() - interval '1 hour'` }), 'a change before the first entry', 'orders_address_changed');
    const parent = (await order({ buyer_name: `'Jane Doe'`, buyer_address: `'1 rue de la Paix'`, buyer_country: `'FR'`, buyer_phone: `'+33 6 12 34 56 78'`, address_by: `'COLLECTOR'`, address_at: 'now()', price_minor: '1000', currency: `'EUR'` })).rows[0].id;
    await run(`UPDATE orders SET address_changed_at = now() + interval '1 hour', address_by = 'STAFF' WHERE id = '${parent}'`);
    // A travelling order carries no address of its own; its old name and address may stay.
    await check(order({ with_order_id: `'${parent}'`, buyer_country: `'FR'` }), 'a travelling order\'s country', 'orders_address_travels');
    await check(order({ with_order_id: `'${parent}'`, buyer_phone: `'+33 6 12 34 56 78'` }), 'a travelling order\'s phone', 'orders_address_travels');
    await check(order({ with_order_id: `'${parent}'`, address_by: `'STAFF'`, address_at: 'now()' }), 'a travelling order\'s author', 'orders_address_travels');
    const follower = (await order({ with_order_id: `'${parent}'`, buyer_name: `'Old buyer'`, buyer_address: `'Old address'` })).rows[0].id;
    // The engraving: its price with its words and the order's currency, its author exactly with its words.
    await check(order({ engraving_minor: '3000', currency: `'EUR'`, price_minor: '1000' }), 'a price of no engraving', 'orders_engraving_price');
    await check(order({ engraving_text: `'J.M.'`, engraving_by: `'COLLECTOR'`, engraving_minor: '3000' }), 'a price in no currency', 'orders_engraving_price');
    await check(order({ engraving_text: `'J.M.'`, engraving_by: `'COLLECTOR'`, engraving_minor: '-1', currency: `'EUR'`, price_minor: '1000' }), 'a negative price', 'orders_engraving_minor_check');
    await check(order({ engraving_text: `'J.M.'` }), 'words without their author', 'orders_engraving_by');
    await check(order({ engraving_by: `'STAFF'` }), 'an author of no words', 'orders_engraving_by');
    await check(order({ engraving_text: `'J.M.'`, engraving_by: `'AGENT'` }), 'an unknown author', 'orders_engraving_by_check');
    await run(`UPDATE orders SET engraving_text = 'J.M.', engraving_by = 'COLLECTOR', engraving_minor = 3000 WHERE id = '${parent}'`);

    // The engraving prices: the house's four currencies, 0 to 1 000 000.00 (0039's until 0060 converts them and drops
    // their table: read at 0059).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    await check(run(`INSERT INTO engraving_prices (currency, price_minor) VALUES ('JPY', 3000)`), 'a currency not the house\'s', 'engraving_prices_currency_check');
    await check(run(`INSERT INTO engraving_prices (currency, price_minor) VALUES ('EUR', -1)`), 'a negative price', 'engraving_prices_price_minor_check');
    await check(run(`INSERT INTO engraving_prices (currency, price_minor) VALUES ('EUR', 100000001)`), 'a price above 1 000 000.00', 'engraving_prices_price_minor_check');
    await run(`INSERT INTO engraving_prices (currency, price_minor, updated_by) VALUES ('EUR', 3000, '${admin}'), ('CHF', 0, '${admin}')`);
    await expect(run(`INSERT INTO engraving_prices (currency, price_minor) VALUES ('EUR', 2000)`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'engraving_prices_pkey'));

    // The invoices: one main invoice per order, a supplementary one naming it, credit notes for single lines, then one in full.
    const doc = (kind: string, sequence: number, cols: Record<string, string> = {}) => {
      const all: Record<string, string> = {
        kind: `'${kind}'`, year: '2026', sequence: String(sequence), order_id: `'${parent}'`, issuer: `'{}'`, buyer: `'{}'`,
        lines: `'[{"kind":"PIECE","label":"ADDRESSED","amountMinor":1000}]'`, currency: `'EUR'`, subtotal_minor: '1000', total_minor: '1000', ...cols,
      };
      return sql.raw<{ id: string }>(`INSERT INTO invoices (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    const main = (await doc('INVOICE', 990101)).rows[0].id;
    await expect(doc('INVOICE', 990102)).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_one_per_order'));
    const supplement = (await doc('INVOICE', 990103, { supplements_invoice_id: `'${main}'` })).rows[0].id;
    await check(doc('CREDIT_NOTE', 990101, { credits_invoice_id: `'${main}'`, credit_scope: `'LINES'`, supplements_invoice_id: `'${main}'` }), 'a credit note supplementing', 'invoices_supplements');
    await check(doc('CREDIT_NOTE', 990101, { credits_invoice_id: `'${main}'` }), 'a credit note with no scope', 'invoices_credit_scope');
    await check(doc('INVOICE', 990104, { supplements_invoice_id: `'${main}'`, credit_scope: `'FULL'` }), 'an invoice with a scope', 'invoices_credit_scope');
    await check(doc('CREDIT_NOTE', 990101, { credits_invoice_id: `'${main}'`, credit_scope: `'SOME'` }), 'an unknown scope', 'invoices_credit_scope_check');
    await doc('CREDIT_NOTE', 990101, { credits_invoice_id: `'${supplement}'`, credit_scope: `'LINES'` });
    await doc('CREDIT_NOTE', 990102, { credits_invoice_id: `'${main}'`, credit_scope: `'LINES'` });
    await doc('CREDIT_NOTE', 990103, { credits_invoice_id: `'${main}'`, credit_scope: `'LINES'` });
    await doc('CREDIT_NOTE', 990104, { credits_invoice_id: `'${main}'`, credit_scope: `'FULL'` });
    await expect(doc('CREDIT_NOTE', 990105, { credits_invoice_id: `'${main}'`, credit_scope: `'FULL'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'invoices_full_credit_key'));
    await expect(run(`UPDATE invoices SET credit_scope = 'FULL' WHERE id = '${supplement}'`)).rejects.toSatisfy(isGuardViolation);
    // What they name stays (RESTRICT).
    await expect(run(`DELETE FROM accounts WHERE id = '${other}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM admin_users WHERE id = '${admin}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // The down step refuses while a supplementary invoice or a credit note for single lines exists, and names the counts.
    // 0047, 0046, 0045, 0044, 0043, 0042, 0041 and 0040, which hold nothing here, go down first.
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    await expect(down(t.db)).rejects.toThrow(/0039_order_delivery cannot be rolled back: 1 supplementary invoices and 3 credit notes for single lines exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0039_order_delivery')?.executedAt).toBeDefined();
    // Cleared by hand (an invoice is never deleted): the down step then passes, and up again.
    await run(`ALTER TABLE invoices DISABLE TRIGGER invoices_immutable`);
    await run(`DELETE FROM invoices WHERE kind = 'CREDIT_NOTE' AND order_id = '${parent}'`);
    await run(`DELETE FROM invoices WHERE id = '${supplement}'`);
    await run(`DELETE FROM invoices WHERE id = '${main}'`);
    await run(`ALTER TABLE invoices ENABLE TRIGGER invoices_immutable`);
    await run(`DELETE FROM engraving_prices`);
    await run(`DELETE FROM account_addresses`);
    await run(`DELETE FROM orders WHERE id = '${follower}'`);
    await run(`DELETE FROM orders WHERE id = '${parent}'`);
    expect((await down(t.db)).reverted).toEqual(['0039_order_delivery']);
    expect((await up(t.db)).applied).toEqual(['0039_order_delivery', '0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    for (const q of [
      `DELETE FROM shop_requests WHERE account_id = '${account}'`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM accounts WHERE id IN ('${account}', '${other}')`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await run(q);
    }
  });

  /** What names an object of 0040 in a snapshot: its three tables and their objects. */
  const of0040 = (o: string) => /\b(heard_options|account_profiles|account_tastes)\w*\b/.test(o);

  it('0040 adds the heard answers, the profiles and the tastes, and nothing else; down drops them and restores 0039 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0040_account_profiles');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0040(o))).toEqual([]);
    // No ALTER TABLE accounts, nothing of before removed.
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0040)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table heard_options ')).map((o) => o.split(' ')[2])).toEqual(['active', 'created_at', 'id', 'is_other', 'label', 'position', 'updated_at']);
    expect(added.filter((o) => o.startsWith('table account_profiles ')).map((o) => o.split(' ')[2])).toEqual([
      'account_id', 'birth_date', 'birth_date_at', 'birth_date_by', 'birth_date_collector_at', 'city', 'created_at', 'first_name', 'heard_at', 'heard_option_id', 'heard_other',
      'instagram', 'last_name', 'phone', 'phone_country', 'updated_at', 'updated_by', 'version',
    ]);
    expect(added.filter((o) => o.startsWith('table account_tastes ')).map((o) => o.split(' ')[2])).toEqual(['account_id', 'created_at', 'kind', 'label', 'value_key']);
    for (const c of [
      /^constraint account_profiles account_profiles_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_profiles account_profiles_heard_option_id_fkey FOREIGN KEY \(heard_option_id\) REFERENCES heard_options\(id\) ON DELETE RESTRICT$/,
      /^constraint account_tastes account_tastes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_profiles account_profiles_pkey PRIMARY KEY \(account_id\)$/,
      /^constraint account_tastes account_tastes_pkey PRIMARY KEY \(account_id, kind, value_key\)$/,
      /^constraint account_profiles account_profiles_phone_pair CHECK /,
      /^constraint account_profiles account_profiles_birth_pair CHECK /,
      /^constraint account_profiles account_profiles_heard_other_option CHECK /,
      /^constraint account_profiles account_profiles_heard_at CHECK /,
      /^constraint account_tastes account_tastes_key CHECK /,
      /^constraint account_tastes account_tastes_label CHECK /,
      /^constraint heard_options heard_options_label_check CHECK /,
      /^index CREATE UNIQUE INDEX heard_options_one_other ON public\.heard_options USING btree \(is_other\) WHERE is_other$/,
      /^index CREATE INDEX account_tastes_key_idx ON public\.account_tastes USING btree \(kind, value_key\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger account_profiles account_profiles_immutable_identity',
      'trigger account_profiles account_profiles_touch_updated_at',
      'trigger heard_options heard_options_immutable_identity',
      'trigger heard_options heard_options_touch_updated_at',
    ]);
    // Existing data: no row is written, no account is changed.
    expect((await up(t.db)).applied).toEqual(['0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const table of ['heard_options', 'account_profiles', 'account_tastes']) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0040: a heard answer of 1 to 40 trimmed characters, unique whatever the case, one Other, placed 1 to 100, its id and Other mark fixed; a profile\'s names, phone with its country, date of birth with who and when, city, Instagram, heard answer with its time, version and author each in their bounds; a taste\'s kind, its key in capitals and single spaces, its label normalising to the key; what they name kept (RESTRICT)', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('p-0040@example.com', 'p-0040@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('o-0040@example.com', 'o-0040@example.com', 'scrypt$x') RETURNING id`)).id;

    // A heard answer.
    const heard = (cols: Record<string, string>) => {
      const all: Record<string, string> = { label: `'Instagram'`, position: '1', ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO heard_options (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    await check(heard({ label: `''` }), 'an empty label', 'heard_options_label_check');
    await check(heard({ label: `'${'x'.repeat(41)}'` }), 'a label of 41 characters', 'heard_options_label_check');
    await check(heard({ label: `' Instagram'` }), 'a label not trimmed', 'heard_options_label_check');
    await check(heard({ label: `'In<b>'` }), 'a label with < >', 'heard_options_label_check');
    await check(heard({ label: `E'Insta\\tgram'` }), 'a label with a control character', 'heard_options_label_check');
    await check(heard({ position: '0' }), 'position 0', 'heard_options_position_check');
    await check(heard({ position: '101' }), 'position 101', 'heard_options_position_check');
    const instagram = (await heard({ label: `'${'x'.repeat(40)}'` })).rows[0].id;
    await run(`UPDATE heard_options SET label = 'Instagram' WHERE id = '${instagram}'`);
    await expect(heard({ label: `'INSTAGRAM'`, position: '2' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'heard_options_label_key'));
    const otherOption = (await heard({ label: `'Other'`, is_other: 'true', position: '8' })).rows[0].id;
    await expect(heard({ label: `'Something else'`, is_other: 'true', position: '9' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'heard_options_one_other'));
    // Not unique: a reorder rewrites the positions in one transaction.
    await run(`UPDATE heard_options SET position = 8 WHERE id = '${instagram}'`);
    await expect(run(`UPDATE heard_options SET is_other = true WHERE id = '${instagram}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE heard_options SET is_other = false WHERE id = '${otherOption}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE heard_options SET id = gen_random_uuid() WHERE id = '${instagram}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE heard_options SET active = false, label = 'Instagram ads' WHERE id = '${instagram}'`);

    // A profile.
    const profile = (cols: Record<string, string>, who = account) => {
      const all: Record<string, string> = { account_id: `'${who}'`, ...cols };
      return run(`INSERT INTO account_profiles (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    };
    await check(profile({ first_name: `'${'x'.repeat(51)}'` }), 'a first name of 51 characters', 'account_profiles_first_name_check');
    await check(profile({ last_name: `'${'x'.repeat(51)}'` }), 'a last name of 51 characters', 'account_profiles_last_name_check');
    await check(profile({ first_name: `''` }), 'an empty first name', 'account_profiles_first_name_check');
    await check(profile({ last_name: `'Doe '` }), 'a last name not trimmed', 'account_profiles_last_name_check');
    await check(profile({ first_name: `E'Jane\\nDoe'` }), 'a name with a line break', 'account_profiles_first_name_check');
    await check(profile({ city: `'Lyon <b>'` }), 'a city with <', 'account_profiles_city_check');
    await check(profile({ city: `'${'x'.repeat(81)}'` }), 'a city of 81 characters', 'account_profiles_city_check');
    await check(profile({ phone: `'0612'`, phone_country: `'FR'` }), 'the phone 0612', 'account_profiles_phone_check');
    await check(profile({ phone: `'+33 6 12 34 56 78'`, phone_country: `'FR'` }), 'a phone not in E.164', 'account_profiles_phone_check');
    await check(profile({ phone: `'+0612345678'`, phone_country: `'FR'` }), 'a code starting with 0', 'account_profiles_phone_check');
    await check(profile({ phone: `'+3361234567812345'`, phone_country: `'FR'` }), 'a phone of 16 digits', 'account_profiles_phone_check');
    await check(profile({ phone: `'+33612345678'` }), 'a phone without its country', 'account_profiles_phone_pair');
    await check(profile({ phone_country: `'FR'` }), 'a country without a phone', 'account_profiles_phone_pair');
    await check(profile({ phone: `'+33612345678'`, phone_country: `'fr'` }), 'a phone country in lower case', 'account_profiles_phone_country_check');
    await check(profile({ birth_date: `'1899-12-31'`, birth_date_by: `'COLLECTOR'`, birth_date_at: 'now()' }), 'a date in 1899', 'account_profiles_birth_date_check');
    await check(profile({ birth_date: `'1990-05-01'` }), 'a date without its _by', 'account_profiles_birth_pair');
    await check(profile({ birth_date: `'1990-05-01'`, birth_date_by: `'COLLECTOR'` }), 'a date without its time', 'account_profiles_birth_pair');
    await check(profile({ birth_date_by: `'STAFF'`, birth_date_at: 'now()' }), 'who without a date', 'account_profiles_birth_pair');
    await check(profile({ birth_date: `'1990-05-01'`, birth_date_by: `'FRIEND'`, birth_date_at: 'now()' }), 'an unknown author of the date', 'account_profiles_birth_date_by_check');
    await check(profile({ instagram: `'@eliot.r'` }), 'an Instagram with @', 'account_profiles_instagram_check');
    await check(profile({ instagram: `'Eliot.R'` }), 'an Instagram in capitals', 'account_profiles_instagram_check');
    await check(profile({ instagram: `'${'a'.repeat(31)}'` }), 'an Instagram of 31 characters', 'account_profiles_instagram_check');
    await check(profile({ heard_other: `'At a shop'` }), 'heard_other without an option', 'account_profiles_heard_other_option');
    await check(profile({ heard_option_id: `'${otherOption}'` }), 'an answer without its time', 'account_profiles_heard_at');
    await check(profile({ heard_option_id: `'${otherOption}'`, heard_at: 'now()', heard_other: `'${'x'.repeat(101)}'` }), 'Other\'s words of 101 characters', 'account_profiles_heard_other_check');
    await check(profile({ version: '0' }), 'version 0', 'account_profiles_version_check');
    await check(profile({ updated_by: `'SCRIPT'` }), 'an unknown author', 'account_profiles_updated_by_check');
    await expect(profile({ heard_option_id: 'gen_random_uuid()', heard_at: 'now()' })).rejects.toSatisfy(isForeignKeyViolation);
    // Names in any script; a full profile.
    await profile({
      first_name: `'Zoë'`, last_name: `'Ле Галль'`, phone: `'+33612345678'`, phone_country: `'FR'`, birth_date: `'1900-01-01'`, birth_date_by: `'COLLECTOR'`, birth_date_at: 'now()',
      birth_date_collector_at: 'now()', city: `'Saint-Étienne'`, instagram: `'eliot.r_1'`, heard_option_id: `'${otherOption}'`, heard_other: `'Saw it at a shop in Milan'`, heard_at: 'now()',
    });
    expect(await one(`SELECT version, updated_by, birth_date FROM account_profiles WHERE account_id = '${account}'`)).toEqual({ version: 1, updated_by: 'COLLECTOR', birth_date: '1900-01-01' });
    await expect(profile({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_profiles_pkey'));
    await expect(run(`UPDATE account_profiles SET account_id = '${other}' WHERE account_id = '${account}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE account_profiles SET created_at = now() - interval '1 day' WHERE account_id = '${account}'`)).rejects.toSatisfy(isGuardViolation);
    // Cleared by staff: the date goes, the collector's one entry stays.
    await run(`UPDATE account_profiles SET birth_date = NULL, birth_date_by = NULL, birth_date_at = NULL, version = version + 1, updated_by = 'STAFF' WHERE account_id = '${account}'`);
    expect(await one(`SELECT birth_date, birth_date_collector_at IS NOT NULL AS entered FROM account_profiles WHERE account_id = '${account}'`)).toEqual({ birth_date: null, entered: true });
    // What it names stays.
    await expect(run(`DELETE FROM heard_options WHERE id = '${otherOption}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A taste.
    const taste = (kind: string, key: string, label: string, who = account) => run(`INSERT INTO account_tastes (account_id, kind, value_key, label) VALUES ('${who}', ${kind}, ${key}, ${label})`);
    await check(taste(`'TYPE'`, `'RING'`, `'RING'`), 'an unknown kind', 'account_tastes_kind_check');
    await check(taste(`'PIECE'`, `'ring'`, `'ring'`), 'a key in lower case', 'account_tastes_key');
    await check(taste(`'PIECE'`, `' RING'`, `'RING'`), 'a key not trimmed', 'account_tastes_key');
    await check(taste(`'PIECE'`, `'SIGNET  RING'`, `'SIGNET  RING'`), 'a key with two spaces', 'account_tastes_key');
    await check(taste(`'PIECE'`, `''`, `''`), 'an empty key', 'account_tastes_key');
    await check(taste(`'PIECE'`, `'${'X'.repeat(61)}'`, `'${'X'.repeat(61)}'`), 'a key of 61 characters', 'account_tastes_key');
    await check(taste(`'FINISH'`, `'GOLD'`, `'Silver'`), 'a label that does not normalise to its key', 'account_tastes_label');
    await check(taste(`'FINISH'`, `'ROSE GOLD'`, `'Rose-gold'`), 'a label with other words', 'account_tastes_label');
    await taste(`'FINISH'`, `'GOLD'`, `'Gold'`);
    await taste(`'FINISH'`, `'ROSE GOLD'`, `' Rose   gold '`);
    await taste(`'PIECE'`, `'SIGNET RING'`, `'SIGNET RING'`);
    await taste(`'FINISH'`, `'GOLD'`, `'Gold'`, other);
    await expect(taste(`'FINISH'`, `'GOLD'`, `'GOLD'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_tastes_pkey'));
    await run(`DELETE FROM account_tastes WHERE account_id = '${account}' AND value_key = 'ROSE GOLD'`);
    await expect(run(`DELETE FROM accounts WHERE id = '${other}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // Down and up again: the three tables go and come back empty.
    await run(`DELETE FROM account_tastes`);
    await run(`DELETE FROM account_profiles`);
    await run(`DELETE FROM heard_options`);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await down(t.db)).reverted).toEqual(['0040_account_profiles']);
    expect((await up(t.db)).applied).toEqual(['0040_account_profiles', '0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
  });

  /** What names an object of 0041 in a snapshot: its three tables and their objects. */
  const of0041 = (o: string) => /\b(account_wishes|model_wish_months|wish_months_counted)\w*\b/.test(o);

  it('0041 adds the wishes, the wish months and the months counted, and nothing else; down drops them and restores 0040 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0041_account_wishes');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0041(o))).toEqual([]);
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0041)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table account_wishes ')).map((o) => o.split(' ')[2])).toEqual(['account_id', 'added_at', 'model_id', 'removed_at']);
    expect(added.filter((o) => o.startsWith('table model_wish_months ')).map((o) => o.split(' ')[2])).toEqual(['added', 'counted_at', 'model_id', 'month', 'removed', 'wished_end']);
    expect(added.filter((o) => o.startsWith('table wish_months_counted ')).map((o) => o.split(' ')[2])).toEqual(['counted_at', 'month']);
    for (const c of [
      /^constraint account_wishes account_wishes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_wishes account_wishes_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint model_wish_months model_wish_months_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint account_wishes account_wishes_pkey PRIMARY KEY \(account_id, model_id, added_at\)$/,
      /^constraint model_wish_months model_wish_months_pkey PRIMARY KEY \(month, model_id\)$/,
      /^constraint wish_months_counted wish_months_counted_pkey PRIMARY KEY \(month\)$/,
      /^constraint account_wishes account_wishes_removed CHECK /,
      /^constraint model_wish_months model_wish_months_month_check CHECK /,
      /^constraint wish_months_counted wish_months_counted_month_check CHECK /,
      /^index CREATE UNIQUE INDEX account_wishes_open ON public\.account_wishes USING btree \(account_id, model_id\) WHERE \(removed_at IS NULL\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger account_wishes account_wishes_immutable']);
    // Existing data: no row is written.
    expect((await up(t.db)).applied).toEqual(['0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const table of ['account_wishes', 'model_wish_months', 'wish_months_counted']) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0041: a wish removed never before it was added, one open wish per account and model, only its removal changing, its account and model kept; a month on its first day with counts of 0 or more, once per model; a month counted once, on its first day', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('w-0041@example.com', 'w-0041@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('o-0041@example.com', 'o-0041@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'K'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'WISHED', 'RING', 'WSH-RG') RETURNING id`)).id;
    const second = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'WISHED TOO', 'CUFF', 'WSH-CF') RETURNING id`)).id;

    // A wish.
    const wish = (cols: Record<string, string>) => {
      const all: Record<string, string> = { account_id: `'${account}'`, model_id: `'${model}'`, ...cols };
      return run(`INSERT INTO account_wishes (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    };
    await check(wish({ added_at: `'2026-10-09T10:00:00Z'`, removed_at: `'2026-10-09T09:59:59Z'` }), 'removed before it was added', 'account_wishes_removed');
    await wish({ added_at: `'2026-10-01T10:00:00Z'`, removed_at: `'2026-10-01T10:00:00Z'` });
    await wish({ added_at: `'2026-10-02T10:00:00Z'`, removed_at: `'2026-10-03T10:00:00Z'` });
    await wish({ added_at: `'2026-10-04T10:00:00Z'` });
    await expect(wish({ added_at: `'2026-10-05T10:00:00Z'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_wishes_open'));
    await expect(wish({ added_at: `'2026-10-04T10:00:00Z'`, removed_at: `'2026-10-06T10:00:00Z'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_wishes_pkey'));
    await wish({ model_id: `'${second}'` });
    await wish({ account_id: `'${other}'` });
    await expect(wish({ model_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(wish({ account_id: 'gen_random_uuid()', model_id: `'${second}'` })).rejects.toSatisfy(isForeignKeyViolation);
    // Only the removal changes: set, and cleared by the re-add.
    await run(`UPDATE account_wishes SET removed_at = '2026-10-07T10:00:00Z' WHERE account_id = '${account}' AND model_id = '${model}' AND removed_at IS NULL`);
    await run(`UPDATE account_wishes SET removed_at = NULL WHERE account_id = '${account}' AND model_id = '${model}' AND added_at = '2026-10-04T10:00:00Z'`);
    await expect(run(`UPDATE account_wishes SET added_at = '2026-10-04T09:00:00Z' WHERE account_id = '${account}' AND model_id = '${model}' AND removed_at IS NULL`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE account_wishes SET model_id = '${second}' WHERE account_id = '${other}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE account_wishes SET account_id = '${other}' WHERE account_id = '${account}' AND model_id = '${second}'`)).rejects.toSatisfy(isGuardViolation);
    await check(run(`UPDATE account_wishes SET removed_at = '2026-10-04T09:00:00Z' WHERE account_id = '${account}' AND model_id = '${model}' AND removed_at IS NULL`), 'a removal set before the addition', 'account_wishes_removed');
    // What it names stays.
    await expect(run(`DELETE FROM models WHERE id = '${model}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM accounts WHERE id = '${other}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A model's month.
    const month = (cols: Record<string, string>) => {
      const all: Record<string, string> = { month: `'2026-10-01'`, model_id: `'${model}'`, added: '3', removed: '1', wished_end: '2', ...cols };
      return run(`INSERT INTO model_wish_months (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    };
    await check(month({ month: `'2026-10-02'` }), 'a month not on day 1', 'model_wish_months_month_check');
    await check(month({ added: '-1' }), 'added below 0', 'model_wish_months_added_check');
    await check(month({ removed: '-1' }), 'removed below 0', 'model_wish_months_removed_check');
    await check(month({ wished_end: '-1' }), 'wished_end below 0', 'model_wish_months_wished_end_check');
    await month({});
    await month({ model_id: `'${second}'`, added: '0', removed: '0', wished_end: '0' });
    await month({ month: `'2026-09-01'` });
    await expect(month({ added: '4' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'model_wish_months_pkey'));
    await expect(month({ model_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM models WHERE id = '${second}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A month counted.
    await check(run(`INSERT INTO wish_months_counted (month) VALUES ('2026-10-15')`), 'a month counted not on day 1', 'wish_months_counted_month_check');
    await run(`INSERT INTO wish_months_counted (month) VALUES ('2026-10-01')`);
    await expect(run(`INSERT INTO wish_months_counted (month) VALUES ('2026-10-01')`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'wish_months_counted_pkey'));

    // Down and up again: the three tables go and come back empty.
    await run(`DELETE FROM wish_months_counted`);
    await run(`DELETE FROM model_wish_months`);
    await run(`DELETE FROM account_wishes`);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await down(t.db)).reverted).toEqual(['0041_account_wishes']);
    expect((await up(t.db)).applied).toEqual(['0041_account_wishes', '0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM models WHERE id IN ('${model}', '${second}')`);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
  });

  /** What names an object of 0042 in a snapshot: its ten tables and their objects. */
  const of0042 = (o: string) =>
    /\b(geo_places|tracking_devices|tracking_device_accounts|collector_views|view_daily_stats|device_daily_stats|collector_places|collector_view_totals|collector_view_months|tracking_state)\w*\b/.test(o);
  /** The tables of 0042, in the order its down drops them (newest first). */
  const TABLES_0042 = ['tracking_state', 'collector_view_months', 'collector_view_totals', 'collector_places', 'device_daily_stats', 'view_daily_stats', 'collector_views', 'tracking_device_accounts', 'tracking_devices', 'geo_places'];

  it('0042 adds the places, the devices, their accounts, the views, the daily totals, the summaries and the recording\'s state, and nothing else; down drops them and restores 0041 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0042_collector_views');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0042(o))).toEqual([]);
    // Nothing of before changed or removed: the previous image never names these tables.
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0042)).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('geo_places')).toEqual(['city', 'country', 'id']);
    expect(columns('tracking_devices')).toEqual(['account_id', 'browser', 'device_hash', 'first_seen_at', 'id', 'in_app', 'kind', 'last_place_id', 'last_seen_at', 'linked_at', 'opened_in', 'os', 'staff_at']);
    expect(columns('tracking_device_accounts')).toEqual(['account_id', 'device_id', 'first_linked_at', 'first_via', 'last_linked_at', 'links']);
    expect(columns('collector_views')).toEqual(['account_id', 'at', 'device_id', 'id', 'page', 'place_id', 'seconds', 'subject']);
    expect(columns('view_daily_stats')).toEqual(['country', 'day', 'devices', 'page', 'seconds', 'signed_in_views', 'subject', 'views']);
    expect(columns('device_daily_stats')).toEqual(['browser', 'country', 'day', 'devices', 'in_app', 'kind', 'new_devices', 'opened_in', 'os', 'signed_in_devices']);
    expect(columns('collector_places')).toEqual(['account_id', 'days', 'first_day', 'last_day', 'place_id']);
    expect(columns('collector_view_totals')).toEqual(['account_id', 'first_at', 'last_at', 'page', 'seconds', 'subject', 'views']);
    expect(columns('collector_view_months')).toEqual(['account_id', 'active_days', 'month', 'scans', 'seconds', 'views']);
    expect(columns('tracking_state')).toEqual(['id', 'scans_after_at', 'scans_after_id', 'scans_backfilled_at', 'started_at']);
    // Compact keys: integer identities for places and devices, a bigint one for the views; no foreign key on a view's
    // place nor its subject (a log).
    for (const c of [
      /^table geo_places id integer NO $/,
      /^table tracking_devices id integer NO $/,
      /^table collector_views id bigint NO $/,
      /^table collector_views page smallint NO $/,
      /^table collector_views seconds smallint NO $/,
      /^table collector_views place_id integer YES $/,
      /^table collector_views subject uuid YES $/,
      /^table geo_places country character NO $/,
      /^table view_daily_stats subject uuid NO '00000000-0000-0000-0000-000000000000'::uuid$/,
      /^table collector_view_totals seconds bigint NO $/,
      /^table tracking_state id smallint NO 1$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => /^constraint collector_views \S+ FOREIGN KEY/.test(o)).map((o) => o.split(' ')[2]).sort()).toEqual(['collector_views_account_id_fkey', 'collector_views_device_id_fkey']);
    for (const c of [
      /^constraint tracking_devices tracking_devices_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint tracking_devices tracking_devices_last_place_id_fkey FOREIGN KEY \(last_place_id\) REFERENCES geo_places\(id\) ON DELETE RESTRICT$/,
      /^constraint tracking_device_accounts tracking_device_accounts_device_id_fkey FOREIGN KEY \(device_id\) REFERENCES tracking_devices\(id\) ON DELETE RESTRICT$/,
      /^constraint tracking_device_accounts tracking_device_accounts_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_views collector_views_device_id_fkey FOREIGN KEY \(device_id\) REFERENCES tracking_devices\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_views collector_views_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_places collector_places_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_places collector_places_place_id_fkey FOREIGN KEY \(place_id\) REFERENCES geo_places\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_view_totals collector_view_totals_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_view_months collector_view_months_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint geo_places geo_places_key UNIQUE NULLS NOT DISTINCT \(country, city\)$/,
      /^constraint tracking_devices tracking_devices_app CHECK /,
      /^constraint tracking_devices tracking_devices_linked CHECK /,
      /^constraint tracking_devices tracking_devices_seen CHECK /,
      /^constraint collector_views collector_views_timed CHECK /,
      /^constraint tracking_state tracking_state_keyset CHECK /,
      /^index CREATE INDEX collector_views_at_idx ON public\.collector_views USING btree \(at\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger tracking_devices tracking_devices_immutable']);
    // The migration's literal lists are schema.ts's.
    const checkOf = async (constraint: string) =>
      [...((await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${constraint}`.execute(t.db)).rows[0]?.def ?? '').matchAll(/'([A-Z_]+)'::text/g)]
        .map((m) => m[1])
        .sort();
    // Up again: the database as it was, and no row written (tracking_state's row is the first boot's, never the migration's).
    expect((await up(t.db)).applied).toEqual(['0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const [constraint, values] of [
      ['tracking_devices_kind_check', DEVICE_KINDS],
      ['tracking_devices_os_check', DEVICE_SYSTEMS],
      ['tracking_devices_browser_check', DEVICE_BROWSERS],
      ['tracking_devices_opened_in_check', OPENED_IN],
      ['tracking_devices_in_app_check', IN_APPS],
      ['tracking_device_accounts_first_via_check', LINK_VIAS],
      ['device_daily_stats_kind_check', DEVICE_KINDS],
      ['device_daily_stats_os_check', DEVICE_SYSTEMS],
      ['device_daily_stats_browser_check', DEVICE_BROWSERS],
      ['device_daily_stats_opened_in_check', OPENED_IN],
      ['device_daily_stats_in_app_check', [...IN_APPS, 'NONE']],
    ] as const) {
      expect(await checkOf(constraint), constraint).toEqual([...values].sort());
    }
    // The page codes: permanent, unique, within the CHECK's 1..60, the inverse map exact.
    const codes = Object.keys(VIEW_PAGES).map(Number);
    expect(codes).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(codes.every((c) => c >= 1 && c <= VIEW_PAGE_MAX)).toBe(true);
    expect(VIEW_PAGE_MAX).toBe(60);
    expect(new Set(Object.values(VIEW_PAGES)).size).toBe(codes.length);
    expect(VIEW_PAGES[1]).toBe('SCAN');
    for (const [code, name] of Object.entries(VIEW_PAGES)) expect(VIEW_PAGE_CODES[name], name).toBe(Number(code));
    for (const table of TABLES_0042) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0042: a place once per country and city, a country alone once; a device by its 43-character pseudonym, its class in the lists, its app exactly when opened in one, linked with when, seen in order, its identity fixed; a link once per device and account; a view of a page 1 to 60, timed but for a SCAN; the daily totals, places and summaries in bounds; one state row with its watermark whole', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('v-0042@example.com', 'v-0042@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('o-0042@example.com', 'o-0042@example.com', 'scrypt$x') RETURNING id`)).id;
    const insert = (table: string, all: Record<string, string>) => run(`INSERT INTO ${table} (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);

    // A place.
    const place = (country: string, city: string) => insert('geo_places', { country, city });
    await check(place(`'fr'`, 'NULL'), 'a country in lower case', 'geo_places_country_check');
    await check(place(`'F'`, 'NULL'), 'one letter', 'geo_places_country_check');
    await check(place(`'FR'`, `''`), 'an empty city', 'geo_places_city_check');
    await check(place(`'FR'`, `' Paris'`), 'an untrimmed city', 'geo_places_city_check');
    await check(place(`'FR'`, `'${'a'.repeat(81)}'`), 'a city of 81 characters', 'geo_places_city_check');
    const paris = (await one<{ id: number }>(`INSERT INTO geo_places (country, city) VALUES ('FR', 'Paris') RETURNING id`)).id;
    const france = (await one<{ id: number }>(`INSERT INTO geo_places (country, city) VALUES ('FR', NULL) RETURNING id`)).id;
    await place(`'FR'`, `'${'é'.repeat(80)}'`);
    expect(typeof paris).toBe('number');
    await expect(place(`'FR'`, `'Paris'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'geo_places_key'));
    await expect(place(`'FR'`, 'NULL')).rejects.toSatisfy((e) => isUniqueViolation(e, 'geo_places_key'));
    // Idempotent under concurrency: ON CONFLICT (country, city) DO NOTHING finds the key, a null city included.
    expect((await sql.raw(`INSERT INTO geo_places (country, city) VALUES ('FR', NULL) ON CONFLICT (country, city) DO NOTHING RETURNING id`).execute(t.db)).rows).toEqual([]);
    await expect(run(`INSERT INTO geo_places (id, country) VALUES (999, 'DE')`), 'an identity GENERATED ALWAYS').rejects.toBeDefined();

    // A device.
    const hash = (c: string) => `'${c.repeat(43)}'`;
    const device = (cols: Record<string, string>) => insert('tracking_devices', { device_hash: hash('a'), ...cols });
    await check(device({ device_hash: `'${'a'.repeat(42)}'` }), 'a pseudonym of 42 characters', 'tracking_devices_device_hash_check');
    await check(device({ device_hash: `'${'a'.repeat(42)}+'` }), 'a pseudonym out of base64url', 'tracking_devices_device_hash_check');
    await check(device({ kind: `'WATCH'` }), 'an unknown kind', 'tracking_devices_kind_check');
    await check(device({ os: `'SYMBIAN'` }), 'an unknown system', 'tracking_devices_os_check');
    await check(device({ browser: `'NETSCAPE'` }), 'an unknown browser', 'tracking_devices_browser_check');
    await check(device({ opened_in: `'KIOSK'` }), 'an unknown opening', 'tracking_devices_opened_in_check');
    await check(device({ opened_in: `'IN_APP'`, in_app: `'MYSPACE'` }), 'an unknown app', 'tracking_devices_in_app_check');
    await check(device({ opened_in: `'IN_APP'` }), 'in an app without the app', 'tracking_devices_app');
    await check(device({ in_app: `'INSTAGRAM'` }), 'an app in a browser', 'tracking_devices_app');
    await check(device({ opened_in: `'HOME_SCREEN'`, in_app: `'TIKTOK'` }), 'an app on the home screen', 'tracking_devices_app');
    await check(device({ account_id: `'${account}'` }), 'linked without when', 'tracking_devices_linked');
    await check(device({ linked_at: 'now()' }), 'a when without the account', 'tracking_devices_linked');
    await check(device({ first_seen_at: `'2026-10-09T10:00:00Z'`, last_seen_at: `'2026-10-09T09:59:59Z'` }), 'last seen before first seen', 'tracking_devices_seen');
    await expect(device({ account_id: 'gen_random_uuid()', linked_at: 'now()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(device({ last_place_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    const defaults = await one<Record<string, unknown>>(`INSERT INTO tracking_devices (device_hash) VALUES (${hash('b')}) RETURNING kind, os, browser, opened_in, in_app, account_id, linked_at, staff_at, last_place_id`);
    expect(defaults).toEqual({ kind: 'UNKNOWN', os: 'OTHER', browser: 'OTHER', opened_in: 'BROWSER', in_app: null, account_id: null, linked_at: null, staff_at: null, last_place_id: null });
    const phone = (
      await one<{ id: number }>(
        `INSERT INTO tracking_devices (device_hash, kind, os, browser, opened_in, in_app, account_id, linked_at, last_place_id, first_seen_at, last_seen_at)
         VALUES (${hash('-')}, 'PHONE', 'IOS', 'WEBVIEW', 'IN_APP', 'INSTAGRAM', '${account}', now(), ${paris}, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z') RETURNING id`,
      )
    ).id;
    await expect(device({ device_hash: hash('-') })).rejects.toSatisfy((e) => isUniqueViolation(e, 'tracking_devices_device_hash_key'));
    // Its class, account, place, mark and last sight change; its identity, pseudonym and first sight never do.
    await run(`UPDATE tracking_devices SET os = 'ANDROID', opened_in = 'BROWSER', in_app = NULL, browser = 'CHROME', account_id = '${other}', linked_at = now(), last_place_id = ${france}, staff_at = now(), last_seen_at = '2026-10-02T10:00:00Z' WHERE id = ${phone}`);
    await expect(run(`UPDATE tracking_devices SET device_hash = ${hash('c')} WHERE id = ${phone}`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE tracking_devices SET first_seen_at = '2026-09-01T10:00:00Z' WHERE id = ${phone}`)).rejects.toSatisfy(isGuardViolation);
    await check(run(`UPDATE tracking_devices SET last_seen_at = '2026-09-30T10:00:00Z' WHERE id = ${phone}`), 'last sight moved before the first', 'tracking_devices_seen');
    await expect(run(`DELETE FROM geo_places WHERE id = ${france}`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM accounts WHERE id = '${other}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A link between a device and an account.
    const link = (cols: Record<string, string>) =>
      insert('tracking_device_accounts', { device_id: String(phone), account_id: `'${account}'`, first_via: `'SIGN_UP'`, first_linked_at: `'2026-10-01T10:00:00Z'`, last_linked_at: `'2026-10-01T10:00:00Z'`, ...cols });
    await check(link({ first_via: `'MAGIC'` }), 'an unknown way', 'tracking_device_accounts_first_via_check');
    await check(link({ last_linked_at: `'2026-09-30T10:00:00Z'` }), 'last linked before first', 'tracking_device_accounts_linked');
    await check(link({ links: '0' }), 'no link', 'tracking_device_accounts_links_check');
    await link({});
    await link({ account_id: `'${other}'`, first_via: `'SESSION'`, links: '2', last_linked_at: `'2026-10-03T10:00:00Z'` });
    await expect(link({ first_via: `'SIGN_IN'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'tracking_device_accounts_pkey'));
    await expect(link({ device_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    expect((await one<{ links: number }>(`SELECT links FROM tracking_device_accounts WHERE account_id = '${account}'`)).links).toBe(1);

    // A view.
    const view = (cols: Record<string, string>) => insert('collector_views', { at: `'2026-10-01T10:00:00Z'`, device_id: String(phone), page: '2', seconds: '12', ...cols });
    await check(view({ page: '0' }), 'page 0', 'collector_views_page_check');
    await check(view({ page: '61' }), 'page 61', 'collector_views_page_check');
    await check(view({ seconds: '-1' }), 'negative seconds', 'collector_views_seconds_check');
    await check(view({ seconds: '10801' }), 'over 3 hours', 'collector_views_seconds_check');
    await check(view({ seconds: '0' }), 'a view of no second', 'collector_views_timed');
    await view({ page: '1', seconds: '0', subject: 'gen_random_uuid()', place_id: String(france) }); // a SCAN, no duration
    await view({ page: '14', seconds: '10800', account_id: `'${account}'`, subject: 'gen_random_uuid()' }); // a LIVE room, 3 hours
    await view({ page: '60', seconds: '1', place_id: '2147483647' }); // a place is not a foreign key: the log keeps it
    await expect(view({ device_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(view({ account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM tracking_devices WHERE id = ${phone}`)).rejects.toSatisfy(isForeignKeyViolation);

    // The daily totals.
    const day = (cols: Record<string, string>) => insert('view_daily_stats', { day: `'2026-10-01'`, page: '2', country: `'FR'`, views: '3', seconds: '40', devices: '2', signed_in_views: '1', ...cols });
    await check(day({ page: '-1' }), 'page -1', 'view_daily_stats_page_check');
    await check(day({ page: '61' }), 'page 61', 'view_daily_stats_page_check');
    await check(day({ country: `'zz'` }), 'a country in lower case', 'view_daily_stats_country_check');
    await check(day({ views: '-1', signed_in_views: '0' }), 'negative views'); // views_check, or signed_in (0 is not between 0 and -1)
    await check(day({ seconds: '-1' }), 'negative seconds', 'view_daily_stats_seconds_check');
    await check(day({ devices: '-1' }), 'negative devices', 'view_daily_stats_devices_check');
    await check(day({ signed_in_views: '4' }), 'more signed-in views than views', 'view_daily_stats_signed_in');
    await check(day({ signed_in_views: '-1' }), 'negative signed-in views', 'view_daily_stats_signed_in');
    await day({});
    await day({ page: '0', country: `'ZZ'`, views: '0', seconds: '0', devices: '0', signed_in_views: '0' }); // the day's marker
    await expect(day({ views: '9', signed_in_views: '0' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'view_daily_stats_pkey'));
    expect((await one<{ subject: string }>(`SELECT subject FROM view_daily_stats WHERE page = 0`)).subject).toBe('00000000-0000-0000-0000-000000000000');
    const devices = (cols: Record<string, string>) =>
      insert('device_daily_stats', { day: `'2026-10-01'`, country: `'FR'`, kind: `'PHONE'`, os: `'IOS'`, browser: `'SAFARI'`, opened_in: `'BROWSER'`, in_app: `'NONE'`, devices: '5', new_devices: '2', signed_in_devices: '3', ...cols });
    await check(devices({ kind: `'WATCH'` }), 'an unknown kind', 'device_daily_stats_kind_check');
    await check(devices({ in_app: `'MYSPACE'` }), 'an unknown app', 'device_daily_stats_in_app_check');
    await check(devices({ new_devices: '6' }), 'more new devices than devices', 'device_daily_stats_new');
    await check(devices({ signed_in_devices: '6' }), 'more signed-in devices than devices', 'device_daily_stats_signed_in');
    await check(devices({ devices: '-1', new_devices: '0', signed_in_devices: '0' }), 'negative devices'); // devices_check, or new and signed_in (0 is not between 0 and -1)
    await devices({});
    await devices({ opened_in: `'IN_APP'`, in_app: `'TIKTOK'` });
    await expect(devices({ devices: '9' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'device_daily_stats_pkey'));

    // A collector's places and summaries.
    const places = (cols: Record<string, string>) => insert('collector_places', { account_id: `'${account}'`, place_id: String(paris), days: '3', first_day: `'2026-09-01'`, last_day: `'2026-10-01'`, ...cols });
    await check(places({ days: '0' }), 'no day', 'collector_places_days_check');
    await check(places({ last_day: `'2026-08-31'` }), 'last day before the first', 'collector_places_days_order');
    await places({});
    await expect(places({ days: '4' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'collector_places_pkey'));
    await expect(places({ place_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM geo_places WHERE id = ${paris}`)).rejects.toSatisfy(isForeignKeyViolation);
    const totals = (cols: Record<string, string>) =>
      insert('collector_view_totals', { account_id: `'${account}'`, page: '10', views: '4', seconds: '120', first_at: `'2025-01-01T10:00:00Z'`, last_at: `'2025-02-01T10:00:00Z'`, ...cols });
    await check(totals({ page: '0' }), 'page 0', 'collector_view_totals_page_check');
    await check(totals({ views: '-1' }), 'negative views', 'collector_view_totals_views_check');
    await check(totals({ seconds: '-1' }), 'negative seconds', 'collector_view_totals_seconds_check');
    await check(totals({ last_at: `'2024-12-31T10:00:00Z'` }), 'last before first', 'collector_view_totals_seen');
    await totals({ seconds: '5000000000' }); // bigint: beyond an integer
    await expect(totals({ views: '5' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'collector_view_totals_pkey'));
    await totals({ subject: 'gen_random_uuid()' });
    const months = (cols: Record<string, string>) => insert('collector_view_months', { account_id: `'${account}'`, month: `'2026-09-01'`, views: '4', seconds: '120', scans: '1', active_days: '3', ...cols });
    await check(months({ month: `'2026-09-02'` }), 'a month not on day 1', 'collector_view_months_month_check');
    await check(months({ active_days: '32' }), '32 active days', 'collector_view_months_active_days_check');
    await check(months({ active_days: '-1' }), 'negative active days', 'collector_view_months_active_days_check');
    await check(months({ scans: '-1' }), 'negative scans', 'collector_view_months_scans_check');
    await check(months({ views: '-1' }), 'negative views', 'collector_view_months_views_check');
    await check(months({ seconds: '-1' }), 'negative seconds', 'collector_view_months_seconds_check');
    await months({});
    await expect(months({ views: '5' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'collector_view_months_pkey'));
    await expect(months({ account_id: 'gen_random_uuid()', month: `'2026-08-01'` })).rejects.toSatisfy(isForeignKeyViolation);

    // The one state row.
    await check(run(`INSERT INTO tracking_state (id, started_at) VALUES (2, now())`), 'a second row', 'tracking_state_id_check');
    await check(run(`INSERT INTO tracking_state (started_at, scans_after_at) VALUES (now(), now())`), 'half a watermark', 'tracking_state_keyset');
    await check(run(`INSERT INTO tracking_state (started_at, scans_after_id) VALUES (now(), gen_random_uuid())`), 'the other half', 'tracking_state_keyset');
    await run(`INSERT INTO tracking_state (started_at) VALUES ('2026-10-09T08:00:00Z')`);
    expect((await sql.raw(`INSERT INTO tracking_state (started_at) VALUES (now()) ON CONFLICT (id) DO NOTHING RETURNING id`).execute(t.db)).rows).toEqual([]);
    await run(`UPDATE tracking_state SET scans_after_at = now(), scans_after_id = gen_random_uuid()`);
    expect(await one(`SELECT id, started_at FROM tracking_state`)).toEqual({ id: 1, started_at: new Date('2026-10-09T08:00:00Z') });

    // Down and up again: the ten tables go and come back empty.
    for (const table of TABLES_0042) await run(`DELETE FROM ${table}`);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await down(t.db)).reverted).toEqual(['0042_collector_views']);
    expect((await up(t.db)).applied).toEqual(['0042_collector_views', '0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
  });

  /** What names an object of 0043 in a snapshot: its eight tables, the device's first source and the three indexes. */
  const TABLE_0043 = '(link_channels|links|acquisition_sources|acquisition_touches|account_sources|acquisition_conversions|acquisition_daily|acquisition_state)';
  const of0043 = (o: string) =>
    new RegExp(`^(table|constraint|trigger) ${TABLE_0043} `).test(o) ||
    new RegExp(`ON public\\.${TABLE_0043} `).test(o) ||
    /\bfirst_source_id\b|tracking_devices_first_source/.test(o) ||
    /\b(drop_entries_created_idx|live_entries_joined_idx|orders_reserved_idx)\b/.test(o);
  /** The tables of 0043, in the order its down drops them (newest first). */
  const TABLES_0043 = ['acquisition_state', 'acquisition_daily', 'acquisition_conversions', 'account_sources', 'acquisition_touches', 'acquisition_sources', 'links', 'link_channels'];

  it('0043 adds the channels, the links, the sources, the device\'s first source, the visits, the first sources, the conversions, the daily visits, the state and three indexes on existing tables, and nothing else; down restores 0042 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0043_acquisition');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0043(o))).toEqual([]);
    // Nothing of before changed or removed: the previous image never names these.
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0043)).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('link_channels')).toEqual(['created_at', 'created_by', 'id', 'name', 'position']);
    expect(columns('links')).toEqual(['archived_at', 'archived_by', 'channel_id', 'code', 'cost_currency', 'cost_minor', 'created_at', 'created_by', 'destination', 'drop_id', 'id', 'model_id', 'name', 'note', 'updated_at']);
    expect(columns('acquisition_sources')).toEqual(['created_at', 'id', 'key', 'kind', 'link_id', 'site', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term']);
    expect(columns('tracking_devices')).toEqual(['first_source_id']);
    expect(columns('acquisition_touches')).toEqual(['account_id', 'arrivals', 'day', 'device_id', 'first_at', 'id', 'last_at', 'source_id']);
    expect(columns('account_sources')).toEqual(['account_id', 'first_seen_at', 'first_source_id', 'set_at', 'set_by']);
    expect(columns('acquisition_conversions')).toEqual(['account_id', 'at', 'created_at', 'id', 'kind', 'last_source_id', 'ref_id']);
    expect(columns('acquisition_daily')).toEqual(['arrivals', 'day', 'first_visits', 'source_id', 'visits']);
    expect(columns('acquisition_state')).toEqual(['catch_up_on', 'conversions_until', 'daily_until', 'id', 'tracking_started_at']);
    for (const c of [
      /^table acquisition_sources id integer NO $/,
      /^table acquisition_touches id bigint NO $/,
      /^table acquisition_conversions id bigint NO $/,
      /^table acquisition_conversions ref_id uuid NO $/,
      /^table tracking_devices first_source_id integer YES $/,
      /^table links cost_minor bigint YES $/,
      /^table link_channels position smallint NO 0$/,
      /^table acquisition_touches arrivals integer NO 1$/,
      /^table acquisition_touches day date NO $/,
      /^table acquisition_state id smallint NO 1$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // ref_id names four tables: no foreign key on it.
    expect(added.filter((o) => /^constraint acquisition_conversions \S+ FOREIGN KEY/.test(o)).map((o) => o.split(' ')[2]).sort()).toEqual(['acquisition_conversions_account_id_fkey', 'acquisition_conversions_last_source_id_fkey']);
    for (const c of [
      /^constraint link_channels link_channels_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_channel_id_fkey FOREIGN KEY \(channel_id\) REFERENCES link_channels\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_drop_id_fkey FOREIGN KEY \(drop_id\) REFERENCES drops\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_archived_by_fkey FOREIGN KEY \(archived_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_sources acquisition_sources_link_id_fkey FOREIGN KEY \(link_id\) REFERENCES links\(id\) ON DELETE RESTRICT$/,
      /^constraint tracking_devices tracking_devices_first_source_id_fkey FOREIGN KEY \(first_source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_touches acquisition_touches_device_id_fkey FOREIGN KEY \(device_id\) REFERENCES tracking_devices\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_touches acquisition_touches_source_id_fkey FOREIGN KEY \(source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_touches acquisition_touches_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_sources account_sources_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_sources account_sources_first_source_id_fkey FOREIGN KEY \(first_source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_conversions acquisition_conversions_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_conversions acquisition_conversions_last_source_id_fkey FOREIGN KEY \(last_source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint acquisition_daily acquisition_daily_source_id_fkey FOREIGN KEY \(source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint links links_destination CHECK /,
      /^constraint links links_cost CHECK /,
      /^constraint links links_archived CHECK /,
      /^constraint links links_code_check CHECK /,
      /^constraint acquisition_sources acquisition_sources_shape CHECK /,
      /^constraint acquisition_touches acquisition_touches_times CHECK /,
      /^constraint acquisition_state acquisition_state_id_check CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger links links_immutable']);
    // The migration's literal lists are schema.ts's.
    const checkOf = async (constraint: string) =>
      [...((await sql<{ def: string }>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${constraint}`.execute(t.db)).rows[0]?.def ?? '').matchAll(/'([A-Z_]+)'::text/g)]
        .map((m) => m[1])
        .sort();
    // Up again: the database as it was, and no row written (the presets and the state row are the first boot's).
    expect((await up(t.db)).applied).toEqual(['0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const [constraint, values] of [
      ['links_destination_check', LINK_DESTINATIONS],
      ['links_cost_currency_check', HOUSE_CURRENCIES],
      ['acquisition_sources_kind_check', SOURCE_KINDS],
      ['account_sources_set_by_check', SOURCE_SET_BY],
      ['acquisition_conversions_kind_check', CONVERSION_KINDS],
    ] as const) {
      expect(await checkOf(constraint), constraint).toEqual([...values].sort());
    }
    for (const table of TABLES_0043) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0043: a channel named once whatever its case; a link\'s address of 3 to 32 lower-case letters, figures or dashes, once, never changed, its destination naming exactly its release or model, its cost and currency both or neither, archived with who; a source with exactly the columns of its kind, its tags trimmed and in lower case; a device\'s first source; a visit once per device, source and day, in order; one first source per account; a conversion once per act; the daily visits counted from 0; one state row', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const insert = (table: string, all: Record<string, string>) => run(`INSERT INTO ${table} (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('links-0043@orbes.test', 'links-0043@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('a-0043@example.com', 'a-0043@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (31, 'K', 'Fulfilment') ON CONFLICT DO NOTHING`);
    const cat = (await one<{ id: number }>(`SELECT id FROM categories WHERE code = 'K'`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'LINKED', 'RING', 'LNK-RG') RETURNING id`)).id;

    // A channel.
    await check(insert('link_channels', { name: `''` }), 'an empty name', 'link_channels_name_check');
    await check(insert('link_channels', { name: `' Instagram'` }), 'an untrimmed name', 'link_channels_name_check');
    await check(insert('link_channels', { name: `'${'a'.repeat(41)}'` }), 'a name of 41 characters', 'link_channels_name_check');
    await check(insert('link_channels', { name: `'Press'`, position: '1000' }), 'a position over 999', 'link_channels_position_check');
    await check(insert('link_channels', { name: `'Press'`, position: '-1' }), 'a negative position', 'link_channels_position_check');
    const channel = (await one<{ id: string }>(`INSERT INTO link_channels (name, position) VALUES ('Instagram', 10) RETURNING id`)).id;
    await expect(insert('link_channels', { name: `'INSTAGRAM'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'link_channels_name_key'));
    await expect(insert('link_channels', { name: `'Press'`, created_by: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await insert('link_channels', { name: `'Press'`, created_by: `'${admin}'` });

    // A link.
    const link = (cols: Record<string, string>) => insert('links', { code: `'instagram-bio'`, name: `'Instagram bio'`, channel_id: `'${channel}'`, destination: `'NOW'`, created_by: `'${admin}'`, ...cols });
    for (const [code, label] of [
      ['ab', 'two characters'],
      [`${'a'.repeat(33)}`, '33 characters'],
      ['-abc', 'a leading dash'],
      ['abc-', 'a trailing dash'],
      ['Abc', 'a capital'],
      ['a_bc', 'an underscore'],
      ['a bc', 'a space'],
    ] as const) {
      await check(link({ code: `'${code}'` }), label, 'links_code_check');
    }
    await check(link({ name: `''` }), 'an empty name', 'links_name_check');
    await check(link({ name: `'${'a'.repeat(81)}'` }), 'a name of 81 characters', 'links_name_check');
    await check(link({ destination: `'SALON'` }), 'an unknown destination', 'links_destination_check');
    await check(link({ destination: `'MODEL'` }), 'a model\'s sheet without its model', 'links_destination');
    await check(link({ destination: `'RELEASE'` }), 'a release without its release', 'links_destination');
    await check(link({ model_id: `'${model}'` }), 'a model named for NOW', 'links_destination');
    await check(link({ cost_minor: '200000' }), 'a cost without its currency', 'links_cost');
    await check(link({ cost_currency: `'EUR'` }), 'a currency without its cost', 'links_cost');
    await check(link({ cost_minor: '-1', cost_currency: `'EUR'` }), 'a negative cost', 'links_cost_minor_check');
    await check(link({ cost_minor: '100000000001', cost_currency: `'EUR'` }), 'a cost over the ceiling', 'links_cost_minor_check');
    await check(link({ cost_minor: '100', cost_currency: `'JPY'` }), 'a currency not the house\'s', 'links_cost_currency_check');
    await check(link({ note: `'${'n'.repeat(501)}'` }), 'a note of 501 characters', 'links_note_check');
    await check(link({ archived_at: 'now()' }), 'archived without who', 'links_archived');
    await check(link({ archived_by: `'${admin}'` }), 'who without when', 'links_archived');
    await expect(link({ channel_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(link({ destination: `'MODEL'`, model_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(link({ created_by: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    const bio = (await one<{ id: string }>(`INSERT INTO links (code, name, channel_id, destination, model_id, cost_minor, cost_currency, created_by) VALUES ('instagram-bio', 'Instagram bio', '${channel}', 'MODEL', '${model}', 200000, 'EUR', '${admin}') RETURNING id`)).id;
    await link({ code: `'${'a'.repeat(32)}'`, note: `'${'n'.repeat(500)}'` });
    await link({ code: `'a-1'` });
    await expect(link({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'links_code_key'));
    // Its name, channel, destination, cost, note and archive change; its address, author and birth never do.
    await run(`UPDATE links SET name = 'Bio', destination = 'NOW', model_id = NULL, cost_minor = NULL, cost_currency = NULL, note = 'n', archived_at = now(), archived_by = '${admin}' WHERE id = '${bio}'`);
    await expect(run(`UPDATE links SET code = 'instagram-bio-2' WHERE id = '${bio}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE links SET created_by = '${admin}', created_at = now() - interval '1 day' WHERE id = '${bio}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM link_channels WHERE id = '${channel}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM models WHERE id = '${model}'`)).resolves.toBeDefined();
    const model2 = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (${cat}, 'LINKED TOO', 'CUFF', 'LNK-CF') RETURNING id`)).id;
    await run(`UPDATE links SET destination = 'MODEL', model_id = '${model2}' WHERE id = '${bio}'`);
    await expect(run(`DELETE FROM models WHERE id = '${model2}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A source.
    const source = (cols: Record<string, string>) => insert('acquisition_sources', { key: `'k'`, ...cols });
    await check(source({ kind: `'PIXEL'` }), 'an unknown kind', 'acquisition_sources_kind_check');
    await check(source({ kind: `'LINK'` }), 'a link source without its link', 'acquisition_sources_shape');
    await check(source({ kind: `'LINK'`, link_id: `'${bio}'`, site: `'instagram.com'` }), 'a link source with a site', 'acquisition_sources_shape');
    await check(source({ kind: `'LINK'`, link_id: `'${bio}'`, utm_source: `'ig'` }), 'a link source with a tag', 'acquisition_sources_shape');
    await check(source({ kind: `'CAMPAIGN'`, utm_medium: `'story'` }), 'a campaign without its source or campaign', 'acquisition_sources_shape');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'ig'`, site: `'instagram.com'` }), 'a campaign with a site', 'acquisition_sources_shape');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'ig'`, link_id: `'${bio}'` }), 'a campaign with a link', 'acquisition_sources_shape');
    await check(source({ kind: `'SITE'` }), 'a site without its host', 'acquisition_sources_shape');
    await check(source({ kind: `'SITE'`, site: `'instagram.com'`, utm_campaign: `'drop'` }), 'a site with a tag', 'acquisition_sources_shape');
    for (const kind of ['DIRECT', 'BEFORE', 'STAFF']) {
      await check(source({ kind: `'${kind}'`, site: `'instagram.com'` }), `${kind} with a site`, 'acquisition_sources_shape');
      await check(source({ kind: `'${kind}'`, utm_term: `'x'` }), `${kind} with a tag`, 'acquisition_sources_shape');
      await check(source({ kind: `'${kind}'`, link_id: `'${bio}'` }), `${kind} with a link`, 'acquisition_sources_shape');
    }
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'IG'` }), 'a tag in capitals', 'acquisition_sources_utm_source_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `' ig'` }), 'an untrimmed tag', 'acquisition_sources_utm_source_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `''` }), 'an empty tag', 'acquisition_sources_utm_source_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_campaign: `'${'c'.repeat(101)}'` }), 'a tag of 101 characters', 'acquisition_sources_utm_campaign_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'ig'`, utm_medium: `'Story'` }), 'a medium in capitals', 'acquisition_sources_utm_medium_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'ig'`, utm_content: `'a '` }), 'an untrimmed content', 'acquisition_sources_utm_content_check');
    await check(source({ kind: `'CAMPAIGN'`, utm_source: `'ig'`, utm_term: `'T'` }), 'a term in capitals', 'acquisition_sources_utm_term_check');
    await check(source({ kind: `'SITE'`, site: `'Instagram.com'` }), 'a host in capitals', 'acquisition_sources_site_check');
    await check(source({ kind: `'SITE'`, site: `'.instagram.com'` }), 'a host starting with a dot', 'acquisition_sources_site_check');
    await check(source({ kind: `'SITE'`, site: `'insta gram.com'` }), 'a host with a space', 'acquisition_sources_site_check');
    await check(source({ kind: `'SITE'`, site: `'a${'b'.repeat(253)}'` }), 'a host of 254 characters', 'acquisition_sources_site_check');
    await check(source({ kind: `'DIRECT'`, key: `'${'k'.repeat(601)}'` }), 'a key of 601 characters', 'acquisition_sources_key_check');
    await expect(source({ kind: `'LINK'`, link_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    const direct = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, key) VALUES ('DIRECT', 'DIRECT') RETURNING id`)).id;
    const viaBio = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, key, link_id) VALUES ('LINK', 'L:${bio}', '${bio}') RETURNING id`)).id;
    const campaign = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, key, utm_source, utm_medium, utm_campaign) VALUES ('CAMPAIGN', 'C:ig\u001fstory\u001fdrop-14\u001f\u001f', 'ig', 'story', 'drop-14') RETURNING id`)).id;
    await source({ kind: `'CAMPAIGN'`, key: `'C:only-campaign'`, utm_campaign: `'drop'` });
    await source({ kind: `'SITE'`, key: `'S:android-app:x'`, site: `'android-app:com.instagram.android'` });
    await source({ kind: `'DIRECT'`, key: `'${'k'.repeat(600)}'` });
    await expect(source({ kind: `'DIRECT'`, key: `'DIRECT'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'acquisition_sources_key'));
    expect((await sql.raw(`INSERT INTO acquisition_sources (kind, key) VALUES ('DIRECT', 'DIRECT') ON CONFLICT (key) DO NOTHING RETURNING id`).execute(t.db)).rows).toEqual([]);
    await expect(run(`INSERT INTO acquisition_sources (id, kind, key) VALUES (999, 'STAFF', 'STAFF')`), 'an identity GENERATED ALWAYS').rejects.toBeDefined();
    await expect(run(`DELETE FROM links WHERE id = '${bio}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A device's first source.
    const device = (await one<{ id: number }>(`INSERT INTO tracking_devices (device_hash, first_seen_at, last_seen_at) VALUES ('${'q'.repeat(43)}', '2026-10-09T08:00:00Z', '2026-10-09T08:00:00Z') RETURNING id`)).id;
    expect(await one(`SELECT first_source_id FROM tracking_devices WHERE id = ${device}`)).toEqual({ first_source_id: null });
    await expect(run(`UPDATE tracking_devices SET first_source_id = 2147483647 WHERE id = ${device}`)).rejects.toSatisfy(isForeignKeyViolation);
    await run(`UPDATE tracking_devices SET first_source_id = ${viaBio} WHERE id = ${device} AND first_source_id IS NULL`);
    await run(`UPDATE tracking_devices SET first_source_id = ${direct} WHERE id = ${device} AND first_source_id IS NULL`);
    expect(await one(`SELECT first_source_id FROM tracking_devices WHERE id = ${device}`)).toEqual({ first_source_id: viaBio });
    await expect(run(`DELETE FROM acquisition_sources WHERE id = ${viaBio}`)).rejects.toSatisfy(isForeignKeyViolation);

    // A visit.
    const touch = (cols: Record<string, string>) =>
      insert('acquisition_touches', { device_id: String(device), source_id: String(campaign), day: `'2026-10-09'`, first_at: `'2026-10-09T08:00:00Z'`, last_at: `'2026-10-09T09:00:00Z'`, ...cols });
    await check(touch({ last_at: `'2026-10-09T07:59:59Z'` }), 'its last arrival before its first', 'acquisition_touches_times');
    await check(touch({ arrivals: '0' }), 'no arrival', 'acquisition_touches_arrivals_check');
    await expect(touch({ device_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(touch({ source_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(touch({ account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await touch({});
    await touch({ day: `'2026-10-10'` });
    await touch({ source_id: String(viaBio), account_id: `'${account}'` });
    await expect(touch({ arrivals: '3' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'acquisition_touches_visit'));
    await run(`INSERT INTO acquisition_touches (device_id, source_id, day, first_at, last_at) VALUES (${device}, ${campaign}, '2026-10-09', '2026-10-09T10:00:00Z', '2026-10-09T10:00:00Z')
               ON CONFLICT (device_id, source_id, day) DO UPDATE SET last_at = greatest(acquisition_touches.last_at, EXCLUDED.last_at), arrivals = acquisition_touches.arrivals + 1`);
    expect(await one(`SELECT arrivals, last_at FROM acquisition_touches WHERE device_id = ${device} AND source_id = ${campaign} AND day = '2026-10-09'`)).toEqual({ arrivals: 2, last_at: new Date('2026-10-09T10:00:00Z') });
    await expect(run(`DELETE FROM tracking_devices WHERE id = ${device}`)).rejects.toSatisfy(isForeignKeyViolation);

    // A collector's first source, once.
    const first = (cols: Record<string, string>) => insert('account_sources', { account_id: `'${account}'`, first_source_id: String(viaBio), first_seen_at: 'now()', set_at: 'now()', set_by: `'SIGN_UP'`, ...cols });
    await check(first({ set_by: `'ADMIN'` }), 'an unknown writer', 'account_sources_set_by_check');
    await expect(first({ first_source_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(first({ account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await first({});
    await expect(first({ set_by: `'JOB'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_sources_pkey'));
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A conversion, once per act.
    const conversion = (cols: Record<string, string>) => insert('acquisition_conversions', { kind: `'SIGNUP'`, ref_id: `'${account}'`, account_id: `'${account}'`, at: 'now()', last_source_id: String(viaBio), ...cols });
    await check(conversion({ kind: `'VISIT'` }), 'an unknown kind', 'acquisition_conversions_kind_check');
    await expect(conversion({ last_source_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await conversion({});
    // No foreign key on ref_id: it names four tables.
    await conversion({ kind: `'ORDER'`, ref_id: 'gen_random_uuid()' });
    await conversion({ kind: `'DRAW_ENTRY'`, ref_id: `'${account}'` });
    await conversion({ kind: `'LIVE_ENTRY'`, ref_id: `'${account}'`, last_source_id: String(direct) });
    await expect(conversion({ last_source_id: String(direct) })).rejects.toSatisfy((e) => isUniqueViolation(e, 'acquisition_conversions_ref'));
    expect((await sql.raw(`INSERT INTO acquisition_conversions (kind, ref_id, account_id, at, last_source_id) VALUES ('SIGNUP', '${account}', '${account}', now(), ${direct}) ON CONFLICT (kind, ref_id) DO NOTHING RETURNING id`).execute(t.db)).rows).toEqual([]);

    // The daily visits.
    const daily = (cols: Record<string, string>) => insert('acquisition_daily', { source_id: String(campaign), day: `'2026-10-09'`, visits: '1', first_visits: '1', arrivals: '2', ...cols });
    await check(daily({ visits: '-1' }), 'negative visits', 'acquisition_daily_visits_check');
    await check(daily({ first_visits: '-1' }), 'negative first visits', 'acquisition_daily_first_visits_check');
    await check(daily({ arrivals: '-1' }), 'negative arrivals', 'acquisition_daily_arrivals_check');
    await expect(daily({ source_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await daily({});
    await daily({ source_id: String(direct), visits: '0', first_visits: '0', arrivals: '0' });
    await expect(daily({ visits: '5' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'acquisition_daily_pkey'));

    // The one state row.
    await check(run(`INSERT INTO acquisition_state (id, tracking_started_at, conversions_until) VALUES (2, now(), now())`), 'a second row', 'acquisition_state_id_check');
    await run(`INSERT INTO acquisition_state (tracking_started_at, conversions_until) VALUES ('2026-10-09T08:00:00Z', '2026-10-09T08:00:00Z')`);
    expect((await sql.raw(`INSERT INTO acquisition_state (id, tracking_started_at, conversions_until) VALUES (1, now(), now()) ON CONFLICT (id) DO NOTHING RETURNING id`).execute(t.db)).rows).toEqual([]);
    await run(`UPDATE acquisition_state SET catch_up_on = '2026-10-09', daily_until = '2026-10-08'`);
    expect(await one(`SELECT id, tracking_started_at, catch_up_on, daily_until FROM acquisition_state`)).toEqual({ id: 1, tracking_started_at: new Date('2026-10-09T08:00:00Z'), catch_up_on: '2026-10-09', daily_until: '2026-10-08' });

    // Down and up again: the eight tables and the column go and come back empty.
    for (const table of TABLES_0043.slice(0, 5)) await run(`DELETE FROM ${table}`);
    await run(`UPDATE tracking_devices SET first_source_id = NULL`);
    await run(`DELETE FROM acquisition_sources`);
    await run(`DELETE FROM links`);
    await run(`DELETE FROM link_channels`);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await down(t.db)).reverted).toEqual(['0043_acquisition']);
    expect((await up(t.db)).applied).toEqual(['0043_acquisition', '0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM link_channels`)).n).toBe(0);
    await run(`DELETE FROM tracking_devices WHERE id = ${device}`);
    await run(`DELETE FROM models WHERE id = '${model2}'`);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  /** What names an object of 0044 in a snapshot: its two tables, the sign-ins' index and the cities' index. */
  const of0044 = (o: string) =>
    /^(table|constraint|trigger) (account_notes|account_tags) /.test(o) || /ON public\.(account_notes|account_tags) /.test(o) || /\b(audit_logs_account_login_idx|account_profiles_city_fold_idx)\b/.test(o);
  const foldFunctions = async () =>
    (await sql<{ volatile: string; strict: boolean }>`SELECT provolatile AS volatile, proisstrict AS strict FROM pg_proc WHERE proname = 'orbes_fold'`.execute(t.db)).rows;

  it('0044 adds the private notes, the tags, the sign-ins\' index on the audit log, orbes_fold and the cities\' index, and nothing else; down restores 0043 exactly, and up again', async () => {
    const latest = await snapshot();
    expect(await foldFunctions()).toEqual([{ volatile: 'i', strict: true }]);
    const { with: withIt, without: before } = await rollBackTo('0044_client_notes');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0044(o))).toEqual([]);
    // Nothing of before changed or removed: the previous image never names these.
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0044)).toEqual([]);
    expect(await foldFunctions()).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('account_notes')).toEqual(['account_id', 'body', 'created_at', 'created_by', 'id', 'removed_at', 'removed_by']);
    expect(columns('account_tags')).toEqual(['account_id', 'created_at', 'created_by', 'tag']);
    for (const c of [
      /^constraint account_notes account_notes_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_notes account_notes_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint account_notes account_notes_removed_by_fkey FOREIGN KEY \(removed_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint account_tags account_tags_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_tags account_tags_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint account_notes account_notes_pkey PRIMARY KEY \(id\)$/,
      /^constraint account_tags account_tags_pkey PRIMARY KEY \(account_id, tag\)$/,
      /^constraint account_notes account_notes_body CHECK /,
      /^constraint account_notes account_notes_removed CHECK /,
      /^constraint account_tags account_tags_tag CHECK /,
      /^index CREATE INDEX audit_logs_account_login_idx ON public\.audit_logs USING btree \(target_id, occurred_at\) WHERE \(action = 'account\.login'::text\)$/,
      /^index CREATE INDEX account_profiles_city_fold_idx ON public\.account_profiles USING btree \(orbes_fold\(city\)\) WHERE \(city IS NOT NULL\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger account_notes account_notes_immutable']);
    // Up again: the database as it was, orbes_fold IMMUTABLE and STRICT, and no row written.
    expect((await up(t.db)).applied).toEqual(['0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await foldFunctions()).toEqual([{ volatile: 'i', strict: true }]);
    for (const table of ['account_notes', 'account_tags']) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0044: a note of 1 to 2,000 characters with no space at either end, never edited, removed once with who and never before it was written, its account and writers kept; a tag in capitals, 1 to 32 letters of any script, figures, single spaces and & \' ’ . -, once per account; orbes_fold lower-cases and takes the accents off', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('notes-0044@orbes.test', 'notes-0044@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('n-0044@example.com', 'n-0044@example.com', 'scrypt$x') RETURNING id`)).id;

    // A private note.
    const note = (body: string, cols = '', values = '') =>
      sql.raw<{ id: string }>(`INSERT INTO account_notes (account_id, body, created_by${cols}) VALUES ('${account}', ${body}, '${admin}'${values}) RETURNING id`).execute(t.db);
    await check(note(`''`), 'an empty note', 'account_notes_body');
    await check(note(`'   '`), 'a note of spaces', 'account_notes_body');
    await check(note(`' Called the client.'`), 'a note not trimmed', 'account_notes_body');
    await check(note(`'${'x'.repeat(2001)}'`), 'a note of 2,001 characters', 'account_notes_body');
    await check(note(`'Called.'`, ', removed_at', ', now()'), 'removed without who', 'account_notes_removed');
    await check(note(`'Called.'`, ', removed_by', `, '${admin}'`), 'who without the removal', 'account_notes_removed');
    await check(note(`'Called.'`, ', created_at, removed_at, removed_by', `, now(), now() - interval '1 minute', '${admin}'`), 'removed before it was written', 'account_notes_removed');
    await note(`'${'é'.repeat(2000)}'`);
    const written = (await note(`E'Called the client.\\nShe prefers the evening.'`)).rows[0].id;
    expect(await one(`SELECT body, removed_at FROM account_notes WHERE id = '${written}'`)).toEqual({ body: 'Called the client.\nShe prefers the evening.', removed_at: null });
    const script = (await sql.raw<{ id: string }>(`INSERT INTO account_notes (account_id, body) VALUES ('${account}', 'Imported.') RETURNING id`).execute(t.db)).rows[0].id;
    expect(await one(`SELECT created_by FROM account_notes WHERE id = '${script}'`)).toEqual({ created_by: null });
    // Never edited: only the removal changes it.
    await expect(run(`UPDATE account_notes SET body = 'Called the client twice.' WHERE id = '${written}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE account_notes SET created_by = NULL WHERE id = '${written}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`UPDATE account_notes SET account_id = account_id, created_at = now() - interval '1 day' WHERE id = '${written}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE account_notes SET removed_at = now(), removed_by = '${admin}' WHERE id = '${written}'`);
    // What it names stays.
    await expect(run(`DELETE FROM admin_users WHERE id = '${admin}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // A tag.
    const tag = (value: string) => run(`INSERT INTO account_tags (account_id, tag, created_by) VALUES ('${account}', ${value}, '${admin}')`);
    await check(tag(`'vip'`), 'a tag in lower case', 'account_tags_tag');
    await check(tag(`''`), 'an empty tag', 'account_tags_tag');
    await check(tag(`' VIP'`), 'a tag not trimmed', 'account_tags_tag');
    await check(tag(`'FRIEND  OF THE HOUSE'`), 'a tag with two spaces', 'account_tags_tag');
    await check(tag(`'${'X'.repeat(33)}'`), 'a tag of 33 characters', 'account_tags_tag');
    await check(tag(`'VIP!'`), 'a tag with !', 'account_tags_tag');
    await check(tag(`'<VIP>'`), 'a tag with < >', 'account_tags_tag');
    await check(tag(`E'VIP\\tPRESS'`), 'a tag with a tab', 'account_tags_tag');
    for (const ok of [`'VIP'`, `'${'X'.repeat(32)}'`, `'FRIEND OF THE HOUSE’S'`, `'FRIEND OF THE HOUSE''S'`, `'A & B'`, `'PRESS - 2026'`, `'ST. JOHN'`, `'ÉCRIVAIN'`, `'ПРЕСС'`]) await tag(ok);
    await expect(tag(`'VIP'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_tags_pkey'));
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('t-0044@example.com', 't-0044@example.com', 'scrypt$x') RETURNING id`)).id;
    await run(`INSERT INTO account_tags (account_id, tag) VALUES ('${other}', 'VIP')`);
    await expect(run(`DELETE FROM accounts WHERE id = '${other}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // orbes_fold.
    expect(await one(`SELECT orbes_fold('Saint-Étienne') AS a, orbes_fold('SAINT-ETIENNE') AS b, orbes_fold('Łódź') AS c, orbes_fold('São Paulo') AS d, orbes_fold(NULL) AS e`)).toEqual({ a: 'saint-etienne', b: 'saint-etienne', c: 'lodz', d: 'sao paulo', e: null });

    // Down and up again: the two tables go and come back empty.
    await run(`DELETE FROM account_tags`);
    await run(`DELETE FROM account_notes`);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await down(t.db)).reverted).toEqual(['0044_client_notes']);
    expect((await up(t.db)).applied).toEqual(['0044_client_notes', '0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM account_notes`)).n).toBe(0);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  /** What names an object of 0045 in a snapshot: THE PROGRAM's three columns and their CHECKs, the grants' birthday, its CHECK and key. */
  const of0045 = (o: string) => /\bbirthday_\w+|\btier_grants_birthday\w*/.test(o);
  /** The columns tier_grants_immutable guards, as its function's arguments name them. */
  const grantGuard = async () =>
    (
      await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = 'tier_grants_immutable'`.execute(t.db)
    ).rows[0]!.args.split('\\000').filter(Boolean);

  it('0045 adds THE PROGRAM\'s birthday credit and the kind BIRTHDAY of the grants (a tier left out, the birthday, its key, the credit\'s CHECK and the guard re-created), and nothing else; down restores 0044 exactly (0027\'s kind and credit CHECKs, the tier NOT NULL and the guard), and up again', async () => {
    const latest = await snapshot();
    // (0062, the vault's rewards, adds a VAULT grant's vault and its use while no piece to the guard.)
    expect(await grantGuard()).toEqual(['id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at', 'birthday_on', 'vault_id', 'usable_while_no_piece']);
    const { with: withIt, without: before } = await rollBackTo('0045_birthday_credit');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names each NOT NULL column's too: they come and
    // go with the columns' NOT NULL, which the column rows below already show.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    // Besides its own objects, 0045 changes only the kind CHECK (with BIRTHDAY), the credit CHECK (an amount on a
    // BIRTHDAY grant too) and the tier's NOT NULL; the guard keeps its name and gains birthday_on.
    expect(added.filter((o) => !of0045(o))).toEqual([
      "constraint tier_grants tier_grants_credit CHECK ((((kind = ANY (ARRAY['CREDIT'::text, 'BIRTHDAY'::text])) = (amount_minor IS NOT NULL)) AND ((amount_minor IS NULL) = (currency IS NULL)) AND ((amount_minor IS NULL) = (expires_at IS NULL))))",
      "constraint tier_grants tier_grants_kind_check CHECK ((kind = ANY (ARRAY['GIFT'::text, 'CREDIT'::text, 'BIRTHDAY'::text])))",
      'table tier_grants tier smallint YES ',
    ]);
    expect(removed).toEqual([
      "constraint tier_grants tier_grants_credit CHECK ((((kind = 'CREDIT'::text) = (amount_minor IS NOT NULL)) AND ((amount_minor IS NULL) = (currency IS NULL)) AND ((amount_minor IS NULL) = (expires_at IS NULL))))",
      "constraint tier_grants tier_grants_kind_check CHECK ((kind = ANY (ARRAY['GIFT'::text, 'CREDIT'::text])))",
      'table tier_grants tier smallint NO ',
    ]);
    expect(added.filter(of0045)).toEqual([
      'constraint club_program_settings club_program_settings_birthday_credit_days_check CHECK (((birthday_credit_days >= 1) AND (birthday_credit_days <= 365)))',
      'constraint club_program_settings club_program_settings_birthday_credit_minor_check CHECK (((birthday_credit_minor >= 1) AND (birthday_credit_minor <= 100000000)))',
      "constraint tier_grants tier_grants_birthday CHECK ((((kind = 'BIRTHDAY'::text) = (tier IS NULL)) AND ((kind = 'BIRTHDAY'::text) = (birthday_on IS NOT NULL))))",
      "index CREATE UNIQUE INDEX tier_grants_birthday_key ON public.tier_grants USING btree (account_id, birthday_on) WHERE (kind = 'BIRTHDAY'::text)",
      'table club_program_settings birthday_credit_days smallint NO 30',
      'table club_program_settings birthday_credit_minor integer NO 2000',
      'table club_program_settings birthday_credit_on boolean NO true',
      'table tier_grants birthday_on date YES ',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    expect(await grantGuard()).toEqual(['id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at']);
    // Up again: the database as it was, and no row written.
    expect((await up(t.db)).applied).toEqual(['0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await grantGuard()).toEqual(['id', 'account_id', 'tier', 'kind', 'granted_at', 'amount_minor', 'currency', 'expires_at', 'birthday_on', 'vault_id', 'usable_while_no_piece']);
    expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM tier_grants WHERE kind = 'BIRTHDAY'`.execute(t.db)).rows[0].n)).toBe(0);
  });

  it('0045: THE PROGRAM\'s birthday credit on by default, € 20 for 30 days, 1 to 100 000 000 and 1 to 365 days; a BIRTHDAY grant with no tier, its birthday, amount, currency and expiry, every other kind with a tier and no birthday; one per account and birthday; its birthday fixed; down refused while a BIRTHDAY grant exists, naming the count, and exact without one', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));

    // THE PROGRAM: a row of before takes the defaults; each value in its bounds, none NULL.
    const had = await one<{ n: number }>(`SELECT count(*)::int AS n FROM club_program_settings`);
    if (had.n === 0) await run(`INSERT INTO club_program_settings (id) VALUES (1)`);
    expect(await one(`SELECT birthday_credit_on AS "on", birthday_credit_minor AS minor, birthday_credit_days AS days FROM club_program_settings`)).toEqual({ on: true, minor: 2000, days: 30 });
    await check(run(`UPDATE club_program_settings SET birthday_credit_minor = 0`), 'a birthday credit of 0', 'club_program_settings_birthday_credit_minor_check');
    await check(run(`UPDATE club_program_settings SET birthday_credit_minor = 100000001`), 'a birthday credit above 100 000 000', 'club_program_settings_birthday_credit_minor_check');
    await check(run(`UPDATE club_program_settings SET birthday_credit_days = 0`), 'valid 0 days', 'club_program_settings_birthday_credit_days_check');
    await check(run(`UPDATE club_program_settings SET birthday_credit_days = 366`), 'valid 366 days', 'club_program_settings_birthday_credit_days_check');
    for (const c of ['birthday_credit_on', 'birthday_credit_minor', 'birthday_credit_days']) {
      await expect(run(`UPDATE club_program_settings SET ${c} = NULL`), c).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    }
    await run(`UPDATE club_program_settings SET birthday_credit_on = false, birthday_credit_minor = 100000000, birthday_credit_days = 365`);
    await run(`UPDATE club_program_settings SET birthday_credit_on = true, birthday_credit_minor = 1, birthday_credit_days = 1`);
    if (had.n === 0) await run(`DELETE FROM club_program_settings`);
    else await run(`UPDATE club_program_settings SET birthday_credit_on = true, birthday_credit_minor = 2000, birthday_credit_days = 30`);

    // The grants.
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('b-0045@example.com', 'b-0045@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('c-0045@example.com', 'c-0045@example.com', 'scrypt$x') RETURNING id`)).id;
    const grant = (who: string, cols: string, values: string) => sql.raw<{ id: string }>(`INSERT INTO tier_grants (account_id, ${cols}) VALUES ('${who}', ${values}) RETURNING id`).execute(t.db);
    const birthday = (who: string, on: string, extra = { cols: '', values: '' }) =>
      grant(who, `tier, kind, amount_minor, currency, expires_at, birthday_on${extra.cols}`, `NULL, 'BIRTHDAY', 2000, 'EUR', now() + interval '30 days', '${on}'${extra.values}`);
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at, birthday_on', `2, 'BIRTHDAY', 2000, 'EUR', now() + interval '30 days', '2026-03-14'`), 'a BIRTHDAY grant with a tier', 'tier_grants_birthday');
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at', `NULL, 'BIRTHDAY', 2000, 'EUR', now() + interval '30 days'`), 'a BIRTHDAY grant without its birthday', 'tier_grants_birthday');
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at, birthday_on', `2, 'CREDIT', 5000, 'EUR', now() + interval '1 year', '2026-03-14'`), 'a CREDIT with a birthday', 'tier_grants_birthday');
    await check(grant(account, 'tier, kind', `NULL, 'GIFT'`), 'a GIFT without its tier', 'tier_grants_birthday');
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at', `NULL, 'CREDIT', 5000, 'EUR', now() + interval '1 year'`), 'a CREDIT without its tier', 'tier_grants_birthday');
    await check(grant(account, 'tier, kind, birthday_on', `NULL, 'BIRTHDAY', '2026-03-14'`), 'a BIRTHDAY grant without its amount', 'tier_grants_credit');
    await check(grant(account, 'tier, kind, amount_minor, expires_at, birthday_on', `NULL, 'BIRTHDAY', 2000, now() + interval '30 days', '2026-03-14'`), 'a BIRTHDAY grant without its currency', 'tier_grants_credit');
    await check(grant(account, 'tier, kind, amount_minor, currency, birthday_on', `NULL, 'BIRTHDAY', 2000, 'EUR', '2026-03-14'`), 'a BIRTHDAY grant without its expiry', 'tier_grants_credit');
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at, birthday_on', `NULL, 'BIRTHDAY', 0, 'EUR', now() + interval '30 days', '2026-03-14'`), 'a BIRTHDAY grant of 0');
    await check(grant(account, 'tier, kind, amount_minor, currency, expires_at, birthday_on', `NULL, 'BIRTHDAY', 2000, 'EUR', now() - interval '1 day', '2026-03-14'`), 'an expiry before the grant', 'tier_grants_expiry');
    await check(grant(account, 'tier, kind', `2, 'ANNIVERSARY'`), 'another kind', 'tier_grants_kind_check');
    const first = (await birthday(account, '2026-03-14')).rows[0].id;
    // One per account and birthday; another birthday, or another account, is another grant; the tiers' grants beside them.
    await expect(birthday(account, '2026-03-14')).rejects.toSatisfy((e) => isUniqueViolation(e, 'tier_grants_birthday_key'));
    await birthday(account, '2027-03-14');
    await birthday(other, '2026-03-14');
    await grant(account, 'tier, kind, amount_minor, currency, expires_at', `2, 'CREDIT', 5000, 'EUR', now() + interval '1 year'`);
    await grant(account, 'tier, kind', `2, 'GIFT'`);
    await expect(grant(account, 'tier, kind', `2, 'GIFT'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'tier_grants_once'));
    // Its birthday, kind, tier and amount fixed; never deleted.
    for (const q of [
      `UPDATE tier_grants SET birthday_on = '2026-03-15' WHERE id = '${first}'`,
      `UPDATE tier_grants SET amount_minor = 3000 WHERE id = '${first}'`,
      `UPDATE tier_grants SET expires_at = expires_at + interval '1 day' WHERE id = '${first}'`,
      `DELETE FROM tier_grants WHERE id = '${first}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    expect(await one(`SELECT tier, kind, amount_minor, currency, birthday_on FROM tier_grants WHERE id = '${first}'`)).toEqual({ tier: null, kind: 'BIRTHDAY', amount_minor: 2000, currency: 'EUR', birthday_on: '2026-03-14' });

    // The down step refuses while a BIRTHDAY grant exists, naming the count; this database stays at 0045 (0047 and 0046,
    // which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    await expect(down(t.db)).rejects.toThrow(/0045_birthday_credit cannot be rolled back: 3 birthday credits exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0045_birthday_credit')?.executedAt).toBeDefined();
    // Without one (the rows taken away, as only a test does), it passes, and up again.
    await run(`ALTER TABLE tier_grants DISABLE TRIGGER tier_grants_no_delete`);
    await run(`DELETE FROM tier_grants WHERE account_id IN ('${account}', '${other}')`);
    await run(`ALTER TABLE tier_grants ENABLE TRIGGER tier_grants_no_delete`);
    expect((await down(t.db)).reverted).toEqual(['0045_birthday_credit']);
    expect((await up(t.db)).applied).toEqual(['0045_birthday_credit', '0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
  });

  /** What names an object of 0046 in a snapshot: its two tables with their constraints and indexes. */
  const of0046 = (o: string) => /^(table|constraint|trigger) (account_scores|engagement_runs) /.test(o) || /ON public\.(account_scores|engagement_runs) /.test(o);

  it('0046 adds the scores and the daily runs, and nothing else; down drops them and restores 0045 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0046_engagement_scores');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0046(o))).toEqual([]);
    // Nothing of before changed or removed: the previous image never names these.
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0046)).toEqual([]);
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ')[2]);
    expect(columns('account_scores')).toEqual([
      'account_id', 'active_days', 'attendance_points', 'changed_at', 'formula', 'frequency_points', 'last_act_at', 'last_act_kind', 'other_currencies', 'purchases', 'recency_points',
      'releases_open', 'releases_taken', 'score', 'speed_minutes', 'speed_points', 'speed_releases', 'spend_eur_minor', 'spend_points', 'unpriced',
    ]);
    expect(columns('engagement_runs')).toEqual(['accounts', 'bands', 'changed', 'day', 'duration_ms', 'finished_at', 'formula', 'started_at']);
    for (const c of [
      /^table account_scores score smallint NO $/,
      /^table account_scores spend_eur_minor bigint NO $/,
      /^table account_scores other_currencies ARRAY NO '\{\}'::text\[\]$/,
      /^table account_scores last_act_at timestamp with time zone YES $/,
      /^table account_scores speed_minutes integer YES $/,
      /^table account_scores changed_at timestamp with time zone NO $/,
      /^table engagement_runs day date NO $/,
      /^table engagement_runs bands ARRAY YES $/,
      /^table engagement_runs finished_at timestamp with time zone YES $/,
      /^constraint account_scores account_scores_pkey PRIMARY KEY \(account_id\)$/,
      /^constraint account_scores account_scores_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint account_scores account_scores_sum CHECK \(\(score = \(\(\(\(recency_points \+ frequency_points\) \+ spend_points\) \+ speed_points\) \+ attendance_points\)\)\)$/,
      /^constraint account_scores account_scores_last_act CHECK \(\(\(last_act_at IS NULL\) = \(last_act_kind IS NULL\)\)\)$/,
      /^constraint account_scores account_scores_speed CHECK \(\(\(speed_minutes IS NULL\) = \(speed_releases = 0\)\)\)$/,
      /^constraint account_scores account_scores_priced CHECK \(\(unpriced <= purchases\)\)$/,
      /^constraint account_scores account_scores_releases CHECK \(\(releases_taken <= releases_open\)\)$/,
      /^constraint account_scores account_scores_last_act_kind_check CHECK /,
      /^constraint account_scores account_scores_other_currencies_check CHECK /,
      /^constraint engagement_runs engagement_runs_pkey PRIMARY KEY \(day\)$/,
      /^constraint engagement_runs engagement_runs_bands_check CHECK /,
      /^constraint engagement_runs engagement_runs_finished CHECK \(\(finished_at >= started_at\)\)$/,
      /^constraint engagement_runs engagement_runs_done CHECK \(\(\(\(finished_at IS NULL\) = \(accounts IS NULL\)\) AND \(\(finished_at IS NULL\) = \(bands IS NULL\)\)\)\)$/,
      /^index CREATE INDEX account_scores_score_idx ON public\.account_scores USING btree \(score\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Two indexes on the scores (the key and the score), one on the runs; derived data: no trigger, no guard.
    expect(added.filter((o) => o.startsWith('index '))).toHaveLength(3);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    // The last-act kinds are the code's (schema.ts SCORE_ACT_KINDS), the other currencies the house's but EUR.
    const literals = (name: string) => [...added.find((o) => o.includes(` ${name} `))!.matchAll(/'([A-Z]+)'::text/g)].map((m) => m[1]);
    expect(literals('account_scores_last_act_kind_check').sort()).toEqual([...SCORE_ACT_KINDS].sort());
    expect(literals('account_scores_other_currencies_check').sort()).toEqual([...SCORE_OTHER_CURRENCIES].sort());
    expect([...SCORE_OTHER_CURRENCIES].sort()).toEqual(HOUSE_CURRENCIES.filter((c) => c !== 'EUR').sort());
    // Up again: the database as it was, and no row written.
    expect((await up(t.db)).applied).toEqual(['0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    for (const table of ['account_scores', 'engagement_runs']) {
      expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n), table).toBe(0);
    }
  });

  it('0046: a score from 0 to 100 that is the sum of its five parts, each in its bounds; the latest act with its kind or neither; the unpriced within the purchases, the other currencies among GBP, USD and CHF; a median exactly when there is a release; the releases taken within those open; one score per account, its account kept; a run once per Paris day, finished exactly with its accounts and its ten bands of 0 or more, never before it started', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('s-0046@example.com', 's-0046@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('t-0046@example.com', 't-0046@example.com', 'scrypt$x') RETURNING id`)).id;

    // A score: 72 = 20 + 12 + 18 + 9 + 13, with the figures behind each part.
    const GOOD: Record<string, string> = {
      formula: '1', score: '72', recency_points: '20', frequency_points: '12', spend_points: '18', speed_points: '9', attendance_points: '13',
      last_act_at: `now() - interval '12 days'`, last_act_kind: `'DRAW'`, active_days: '6', spend_eur_minor: '41000', purchases: '2', unpriced: '0',
      other_currencies: `ARRAY['GBP']`, speed_minutes: '4', speed_releases: '5', releases_taken: '3', releases_open: '8', changed_at: 'now()',
    };
    const score = (who: string, over: Record<string, string | undefined> = {}) => {
      const row = Object.entries({ ...GOOD, ...over }).filter((e): e is [string, string] => e[1] !== undefined);
      return run(`INSERT INTO account_scores (account_id, ${row.map(([k]) => k).join(', ')}) VALUES ('${who}', ${row.map(([, v]) => v).join(', ')})`);
    };
    await check(score(account, { score: '71' }), 'a sum that does not add up', 'account_scores_sum');
    await check(score(account, { score: '73' }), 'a sum one above its parts', 'account_scores_sum');
    await check(score(account, { score: '101', recency_points: '25', frequency_points: '20', spend_points: '25', speed_points: '10', attendance_points: '21' }), 'a score above 100');
    await check(score(account, { score: '-1', recency_points: '-1', frequency_points: '0', spend_points: '0', speed_points: '0', attendance_points: '0' }), 'a score below 0');
    for (const [part, max] of [['recency_points', 25], ['frequency_points', 20], ['spend_points', 25], ['speed_points', 10], ['attendance_points', 20]] as const) {
      // The part one above its most, the score moved with it: only the part's own CHECK refuses.
      const base = Number(GOOD.score) - Number(GOOD[part]);
      await check(score(account, { [part]: String(max + 1), score: String(base + max + 1) }), `${part} above ${max}`, `account_scores_${part}_check`);
      await check(score(account, { [part]: '-1', score: String(base - 1) }), `${part} below 0`, `account_scores_${part}_check`);
    }
    await check(score(account, { formula: '0' }), 'a formula 0', 'account_scores_formula_check');
    await check(score(account, { last_act_kind: `'VIEW'` }), 'a page view as an act', 'account_scores_last_act_kind_check');
    await check(score(account, { last_act_kind: 'NULL' }), 'an act without its kind', 'account_scores_last_act');
    await check(score(account, { last_act_at: 'NULL' }), 'a kind without its act', 'account_scores_last_act');
    await check(score(account, { active_days: '367' }), '367 active days', 'account_scores_active_days_check');
    await check(score(account, { active_days: '-1' }), '-1 active days', 'account_scores_active_days_check');
    await check(score(account, { spend_eur_minor: '-1' }), 'a spend below 0', 'account_scores_spend_eur_minor_check');
    await check(score(account, { purchases: '-1', unpriced: '-1' }), 'purchases below 0');
    await check(score(account, { unpriced: '3' }), 'more unpriced than purchases', 'account_scores_priced');
    await check(score(account, { unpriced: '-1' }), 'unpriced below 0', 'account_scores_unpriced_check');
    await check(score(account, { other_currencies: `ARRAY['EUR']` }), 'EUR as another currency', 'account_scores_other_currencies_check');
    await check(score(account, { other_currencies: `ARRAY['GBP', 'JPY']` }), 'a currency not the house\'s', 'account_scores_other_currencies_check');
    await check(score(account, { speed_minutes: 'NULL' }), 'releases without their median', 'account_scores_speed');
    await check(score(account, { speed_releases: '0' }), 'a median without a release', 'account_scores_speed');
    await check(score(account, { speed_minutes: '-1' }), 'a median below 0', 'account_scores_speed_minutes_check');
    await check(score(account, { speed_minutes: 'NULL', speed_releases: '-1' }), 'releases below 0');
    await check(score(account, { releases_taken: '9' }), 'more releases taken than open', 'account_scores_releases');
    await check(score(account, { releases_taken: '-1' }), 'releases taken below 0', 'account_scores_releases_taken_check');
    for (const c of ['formula', 'score', 'recency_points', 'frequency_points', 'spend_points', 'speed_points', 'attendance_points', 'active_days', 'spend_eur_minor', 'purchases', 'unpriced', 'speed_releases', 'releases_taken', 'releases_open', 'changed_at']) {
      await expect(score(account, { [c]: 'NULL' }), c).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    }
    await score(account);
    // One score per account; the account it names stays.
    await expect(score(account)).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_scores_pkey'));
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy(isForeignKeyViolation);
    // The least and the most; the other currencies empty by default; no act, no release, no purchase.
    await score(other, {
      score: '0', recency_points: '0', frequency_points: '0', spend_points: '0', speed_points: '0', attendance_points: '0', last_act_at: 'NULL', last_act_kind: 'NULL',
      active_days: '0', spend_eur_minor: '0', purchases: '0', unpriced: '0', other_currencies: undefined, speed_minutes: 'NULL', speed_releases: '0', releases_taken: '0', releases_open: '0',
    });
    expect(await one(`SELECT score, other_currencies, last_act_kind, speed_minutes FROM account_scores WHERE account_id = '${other}'`)).toEqual({ score: 0, other_currencies: [], last_act_kind: null, speed_minutes: null });
    await run(`UPDATE account_scores SET score = 100, recency_points = 25, frequency_points = 20, spend_points = 25, speed_points = 10, attendance_points = 20, active_days = 366,
                 last_act_at = now(), last_act_kind = 'REGISTRATION', other_currencies = ARRAY['CHF', 'GBP', 'USD'], speed_minutes = 0, speed_releases = 1, releases_taken = 1, releases_open = 1
                WHERE account_id = '${other}'`);
    // Derived data: the job rewrites and removes its rows freely (no guard, no delete trigger).
    await check(run(`UPDATE account_scores SET score = 99 WHERE account_id = '${other}'`), 'a score changed without its parts', 'account_scores_sum');
    await run(`DELETE FROM account_scores WHERE account_id = '${other}'`);

    // A run: claimed, then finished with its accounts and its ten bands.
    const BANDS = `ARRAY[4, 0, 1, 0, 0, 2, 0, 0, 0, 1]`;
    const claim = (day: string, cols = '', values = '') => run(`INSERT INTO engagement_runs (day, formula, started_at${cols}) VALUES ('${day}', 1, now()${values})`);
    await claim('2026-11-02');
    await expect(claim('2026-11-02')).rejects.toSatisfy((e) => isUniqueViolation(e, 'engagement_runs_pkey'));
    await check(run(`INSERT INTO engagement_runs (day, formula, started_at) VALUES ('2026-11-03', 0, now())`), 'a formula 0', 'engagement_runs_formula_check');
    await check(claim('2026-11-03', ', finished_at', ', now()'), 'finished without its accounts and bands', 'engagement_runs_done');
    await check(claim('2026-11-03', ', finished_at, accounts', ', now(), 8'), 'finished without its bands', 'engagement_runs_done');
    await check(claim('2026-11-03', ', finished_at, bands', `, now(), ${BANDS}`), 'finished without its accounts', 'engagement_runs_done');
    await check(claim('2026-11-03', ', accounts, bands', `, 8, ${BANDS}`), 'accounts and bands without the end', 'engagement_runs_done');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now(), 8, ARRAY[4, 0, 1, 0, 0, 2, 0, 0, 1]`), 'a band array of 9', 'engagement_runs_bands_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now(), 8, ARRAY[4, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0]`), 'a band array of 11', 'engagement_runs_bands_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now(), 8, ARRAY[4, 0, 1, 0, 0, 2, 0, 0, -1, 1]`), 'a band below 0', 'engagement_runs_bands_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now(), 8, ARRAY[4, 0, 1, 0, 0, 2, 0, 0, NULL, 1]`), 'a band left out', 'engagement_runs_bands_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now() - interval '1 second', 8, ${BANDS}`), 'finished before it started', 'engagement_runs_finished');
    await check(claim('2026-11-03', ', finished_at, accounts, bands', `, now(), -1, ${BANDS}`), 'accounts below 0', 'engagement_runs_accounts_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands, changed', `, now(), 8, ${BANDS}, -1`), 'changed below 0', 'engagement_runs_changed_check');
    await check(claim('2026-11-03', ', finished_at, accounts, bands, duration_ms', `, now(), 8, ${BANDS}, -1`), 'a duration below 0', 'engagement_runs_duration_ms_check');
    await run(`UPDATE engagement_runs SET finished_at = started_at, accounts = 8, changed = 3, bands = ${BANDS}, duration_ms = 412 WHERE day = '2026-11-02'`);
    expect(await one(`SELECT day, formula, accounts, changed, bands, duration_ms FROM engagement_runs`)).toEqual({ day: '2026-11-02', formula: 1, accounts: 8, changed: 3, bands: [4, 0, 1, 0, 0, 2, 0, 0, 0, 1], duration_ms: 412 });

    // Down with its rows (derived data: nothing refuses) and up again: the two tables come back empty.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await down(t.db)).reverted).toEqual(['0046_engagement_scores']);
    expect((await up(t.db)).applied).toEqual(['0046_engagement_scores', '0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ n: number }>(`SELECT (SELECT count(*) FROM account_scores)::int + (SELECT count(*) FROM engagement_runs)::int AS n`)).n).toBe(0);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
  });

  /** What names an object of 0047 in a snapshot: its table with its constraints and index. */
  const of0047 = (o: string) => /^(table|constraint|trigger) collector_history /.test(o) || /ON public\.collector_history /.test(o);

  it('0047 adds the collectors\' monthly history, and nothing else; down drops it and restores 0046 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0047_collector_history');
    const added = withIt.filter((o) => !before.includes(o));
    expect(added.filter((o) => !of0047(o))).toEqual([]);
    expect(before.filter((o) => !withIt.includes(o))).toEqual([]);
    expect(before.filter(of0047)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table collector_history ')).map((o) => o.split(' ')[2])).toEqual(['account_id', 'active', 'first_month', 'last_month', 'scores', 'tiers']);
    for (const c of [
      /^table collector_history first_month date NO $/,
      /^table collector_history scores ARRAY NO '\{\}'::smallint\[\]$/,
      /^table collector_history tiers ARRAY NO '\{\}'::smallint\[\]$/,
      /^table collector_history active ARRAY NO '\{\}'::boolean\[\]$/,
      /^table collector_history last_month date YES $/,
      /^constraint collector_history collector_history_pkey PRIMARY KEY \(account_id\)$/,
      /^constraint collector_history collector_history_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint collector_history collector_history_month CHECK /,
      /^constraint collector_history collector_history_lengths CHECK /,
      /^constraint collector_history collector_history_span CHECK /,
      /^constraint collector_history collector_history_scores_check CHECK /,
      /^constraint collector_history collector_history_tiers_check CHECK /,
      /^constraint collector_history collector_history_active_check CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // One index (the key); derived data: no trigger.
    expect(added.filter((o) => o.startsWith('index '))).toHaveLength(1);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM collector_history`.execute(t.db)).rows[0].n)).toBe(0);
  });

  it('0047: a month starts on day 1; three arrays of one length, at most 36, ending at last_month; scores 0..100 or not measured, tiers 0..3 and activity never left out; one row per account, its account kept', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('h-0047@example.com', 'h-0047@example.com', 'scrypt$x') RETURNING id`)).id;
    const row = (o: { first?: string; scores?: string; tiers?: string; active?: string; last?: string }) =>
      run(`INSERT INTO collector_history (account_id, first_month, scores, tiers, active, last_month) VALUES ('${account}', '${o.first ?? '2026-08-01'}', ${o.scores ?? `'{NULL,54}'`}, ${o.tiers ?? `'{0,1}'`}, ${o.active ?? `'{f,t}'`}, ${o.last === undefined ? `'2026-09-01'` : o.last})`);
    await check(row({ first: '2026-08-02', last: `'2026-09-02'` }), 'a month not on day 1', 'collector_history_month');
    await check(row({ scores: `'{54}'` }), 'arrays of two lengths', 'collector_history_lengths');
    await check(row({ last: `'2026-10-01'` }), 'last_month past the last element', 'collector_history_span');
    await check(row({ last: 'NULL' }), 'elements without a last month', 'collector_history_span');
    await check(row({ scores: `'{}'`, tiers: `'{}'`, active: `'{}'`, last: `'2026-08-01'` }), 'a last month without an element', 'collector_history_span');
    await check(row({ scores: `'{NULL,101}'` }), 'a score above 100', 'collector_history_scores_check');
    await check(row({ scores: `'{-1,54}'` }), 'a score below 0', 'collector_history_scores_check');
    await check(row({ tiers: `'{0,4}'` }), 'a tier above 3', 'collector_history_tiers_check');
    await check(row({ tiers: `'{NULL,1}'` }), 'a tier left out', 'collector_history_tiers_check');
    await check(row({ active: `'{NULL,t}'` }), 'an activity left out', 'collector_history_active_check');
    const n = 37;
    const months = (k: number) => `'{${Array.from({ length: k }, () => 'NULL').join(',')}}'`;
    await check(row({ first: '2023-09-01', scores: months(n), tiers: `'{${Array(n).fill(0).join(',')}}'`, active: `'{${Array(n).fill('f').join(',')}}'`, last: `'2026-09-01'` }), '37 months', 'collector_history_lengths');
    // 36 months exactly, then the good row: two months, the first not measured.
    await row({ first: '2023-10-01', scores: months(36), tiers: `'{${Array(36).fill(0).join(',')}}'`, active: `'{${Array(36).fill('f').join(',')}}'`, last: `'2026-09-01'` });
    await run(`DELETE FROM collector_history`);
    await row({});
    expect(await one(`SELECT first_month::text AS first_month, scores, tiers, active, last_month::text AS last_month FROM collector_history`)).toEqual({ first_month: '2026-08-01', scores: [null, 54], tiers: [0, 1], active: [false, true], last_month: '2026-09-01' });
    await expect(row({})).rejects.toSatisfy((e) => isUniqueViolation(e, 'collector_history_pkey'));
    await expect(run(`DELETE FROM accounts WHERE id = '${account}'`)).rejects.toSatisfy((e) => isForeignKeyViolation(e));
    // Down with its rows (derived data: nothing refuses) and up again: the table comes back empty.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await down(t.db)).reverted).toEqual(['0047_collector_history']);
    expect((await up(t.db)).applied).toEqual(['0047_collector_history', '0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM collector_history`)).n).toBe(0);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
  });

  /** What names an object of 0048's own table in a snapshot: warranty_claims with its constraints, indexes and triggers. */
  const of0048 = (o: string) => /^(table|constraint|trigger) warranty_claims /.test(o) || /ON public\.warranty_claims /.test(o);
  const claimGuard = async () =>
    (
      await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = 'warranty_claims_immutable'`.execute(t.db)
    ).rows[0]!.args.split('\\000').filter(Boolean);

  it('0048 adds the warranty of each model and of each piece (its CHECK, its trigger warranties_kind), PLATINE\'s every piece, the warranty credit, the grants\' kind WARRANTY and warranty_claims, and nothing else; down restores 0047 exactly, and up again', async () => {
    const latest = await snapshot();
    const fn = async () => Number((await sql<{ n: string }>`SELECT count(*) AS n FROM pg_proc WHERE proname = 'orbes_warranty_kind'`.execute(t.db)).rows[0].n);
    expect(await fn()).toBe(1);
    expect(await claimGuard()).toEqual(['id', 'product_id', 'root_product_id', 'account_id', 'conversation_id', 'basis', 'opened_at', 'opened_by', 'continues_claim_id']);
    const { with: withIt, without: before } = await rollBackTo('0048_orbes_care');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names each NOT NULL column's too: they come and go
    // with the columns' NOT NULL, which the column rows below already show.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    // Besides its table: two columns and a CHECK and a trigger on the warranties' side, PLATINE's allowance nullable with
    // no default, the warranty credit's column, and the grants' three CHECKs widened to WARRANTY (their names kept).
    expect(added.filter((o) => !of0048(o))).toEqual([
      'constraint club_program_settings club_program_settings_warranty_credit_percent_check CHECK (((warranty_credit_percent >= 1) AND (warranty_credit_percent <= 100)))',
      "constraint tier_grants tier_grants_birthday CHECK ((((kind = ANY (ARRAY['BIRTHDAY'::text, 'WARRANTY'::text])) = (tier IS NULL)) AND ((kind = 'BIRTHDAY'::text) = (birthday_on IS NOT NULL))))",
      "constraint tier_grants tier_grants_credit CHECK ((((kind = ANY (ARRAY['CREDIT'::text, 'BIRTHDAY'::text, 'WARRANTY'::text])) = (amount_minor IS NOT NULL)) AND ((amount_minor IS NULL) = (currency IS NULL)) AND ((amount_minor IS NULL) = (expires_at IS NULL))))",
      "constraint tier_grants tier_grants_kind_check CHECK ((kind = ANY (ARRAY['GIFT'::text, 'CREDIT'::text, 'BIRTHDAY'::text, 'WARRANTY'::text])))",
      'constraint warranties warranties_lifetime_open CHECK (((NOT lifetime) OR (end_date IS NULL)))',
      'table club_program_settings care_pieces_platine smallint YES ',
      'table club_program_settings warranty_credit_percent smallint NO 30',
      'table models warranty_lifetime boolean NO false',
      'table warranties lifetime boolean NO ',
      'trigger warranties warranties_kind',
    ]);
    expect(removed).toEqual([
      "constraint tier_grants tier_grants_birthday CHECK ((((kind = 'BIRTHDAY'::text) = (tier IS NULL)) AND ((kind = 'BIRTHDAY'::text) = (birthday_on IS NOT NULL))))",
      "constraint tier_grants tier_grants_credit CHECK ((((kind = ANY (ARRAY['CREDIT'::text, 'BIRTHDAY'::text])) = (amount_minor IS NOT NULL)) AND ((amount_minor IS NULL) = (currency IS NULL)) AND ((amount_minor IS NULL) = (expires_at IS NULL))))",
      "constraint tier_grants tier_grants_kind_check CHECK ((kind = ANY (ARRAY['GIFT'::text, 'CREDIT'::text, 'BIRTHDAY'::text])))",
      'table club_program_settings care_pieces_platine smallint NO 1',
    ]);
    expect(before.filter(of0048)).toEqual([]);
    const columns = added.filter((o) => o.startsWith('table warranty_claims ')).map((o) => o.split(' ')[2]);
    expect(columns).toEqual([
      'account_id', 'basis', 'cancelled_at', 'continues_claim_id', 'conversation_id', 'credit_percent', 'currency', 'decided_at', 'decided_by', 'done_at', 'grant_id', 'id', 'label_at',
      'label_carrier_id', 'label_pdf', 'label_tracking', 'note', 'opened_at', 'opened_by', 'other_size', 'outcome', 'product_id', 'received_at', 'refusal_reason', 'replacement_product_id',
      'return_carrier_id', 'return_shipped_at', 'return_tracking', 'root_product_id', 'service_record_id', 'status', 'value_minor',
    ]);
    for (const c of [
      /^table warranty_claims status text NO 'OPEN'::text$/,
      /^table warranty_claims opened_at timestamp with time zone NO now\(\)$/,
      /^table warranty_claims other_size boolean NO false$/,
      /^table warranty_claims account_id uuid YES $/,
      /^constraint warranty_claims warranty_claims_steps CHECK /,
      /^constraint warranty_claims warranty_claims_times CHECK /,
      /^constraint warranty_claims warranty_claims_label CHECK /,
      /^constraint warranty_claims warranty_claims_return CHECK /,
      /^constraint warranty_claims warranty_claims_received CHECK /,
      /^constraint warranty_claims warranty_claims_continues CHECK /,
      /^constraint warranty_claims warranty_claims_decided CHECK /,
      /^constraint warranty_claims warranty_claims_claimant CHECK /,
      /^constraint warranty_claims warranty_claims_refusal CHECK /,
      /^constraint warranty_claims warranty_claims_value CHECK /,
      /^constraint warranty_claims warranty_claims_credit CHECK /,
      /^constraint warranty_claims warranty_claims_replacement CHECK /,
      /^constraint warranty_claims warranty_claims_basis_outcome CHECK /,
      /^constraint warranty_claims warranty_claims_basis_refusal CHECK /,
      /^constraint warranty_claims warranty_claims_label_tracking_check CHECK \(\(label_tracking ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9 -\]\{2,39\}\$'::text\)\)$/,
      /^constraint warranty_claims warranty_claims_return_tracking_check CHECK \(\(return_tracking ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9 -\]\{2,39\}\$'::text\)\)$/,
      /^constraint warranty_claims warranty_claims_label_pdf_check CHECK \(\(\(octet_length\(label_pdf\) >= 1\) AND \(octet_length\(label_pdf\) <= 2097152\)\)\)$/,
      /^constraint warranty_claims warranty_claims_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint warranty_claims warranty_claims_root_product_id_fkey FOREIGN KEY \(root_product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint warranty_claims warranty_claims_conversation_id_fkey FOREIGN KEY \(conversation_id\) REFERENCES client_conversations\(id\) ON DELETE RESTRICT$/,
      /^constraint warranty_claims warranty_claims_service_record_id_fkey FOREIGN KEY \(service_record_id\) REFERENCES service_records\(id\) ON DELETE RESTRICT$/,
      /^constraint warranty_claims warranty_claims_grant_id_fkey FOREIGN KEY \(grant_id\) REFERENCES tier_grants\(id\) ON DELETE RESTRICT$/,
      /^constraint warranty_claims warranty_claims_continues_claim_id_fkey FOREIGN KEY \(continues_claim_id\) REFERENCES warranty_claims\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    // Twelve foreign keys, each at the head of an index: eight of its own, four unique columns; the status for the Claims
    // tab; one live claim per piece; one free replacement per original piece; the key. Two guards.
    expect(added.filter((o) => o.startsWith('constraint warranty_claims ') && o.includes(' FOREIGN KEY '))).toHaveLength(12);
    expect(added.filter((o) => o.startsWith('index '))).toHaveLength(16);
    expect(added.filter((o) => o.startsWith('trigger warranty_claims '))).toEqual(['trigger warranty_claims warranty_claims_immutable', 'trigger warranty_claims warranty_claims_no_delete']);
    // Its function dropped with its trigger; up again: the database as it was, and no row written.
    expect(await fn()).toBe(0);
    expect((await up(t.db)).applied).toEqual(['0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await fn()).toBe(1);
    expect(await claimGuard()).toEqual(['id', 'product_id', 'root_product_id', 'account_id', 'conversation_id', 'basis', 'opened_at', 'opened_by', 'continues_claim_id']);
    expect(Number((await sql<{ n: string }>`SELECT count(*) AS n FROM warranty_claims`.execute(t.db)).rows[0].n)).toBe(0);
  });

  it('0048: a claim\'s steps with the columns each needs, outcome by outcome (a refusal from OPEN, a credit of value or a refund kept by ORBES, every other outcome returned); its times in order; its label, return, receipt, decision, claimant, refusal, value, credit and replacement whole; each basis its outcomes and reasons; one live claim per piece, one free replacement per original piece under the lifetime warranty; its identity fixed, never deleted; a WARRANTY grant with no tier; THE PROGRAM\'s two settings; down refused while a claim or a WARRANTY grant exists', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('claim-0048@example.com', 'claim-0048@example.com', 'scrypt$x') RETURNING id`)).id;
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email, email_normalized, password_hash, role) VALUES ('claims-0048@orbes.test', 'claims-0048@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const conversation = (await one<{ id: string }>(`INSERT INTO client_conversations (account_id, status, last_message_at) VALUES ('${account}', 'ANSWERED', now()) RETURNING id`)).id;
    const carrier = (await one<{ id: string }>(`INSERT INTO carriers (name, tracking_url) VALUES ('Claim checks', 'https://track.example/{tracking}') RETURNING id`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'HALO', 'RING', 'CLAIMCHK') RETURNING id`)).id;
    const piece = async (n: number) =>
      (await one<{ id: string }>(`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-C-${String(n).padStart(5, '0')}', ${(26 << 25) | (13 << 20) | n}, 2026, 13, ${n}, 'CLAIMCHK-${n}', '${model}', 'SILVER') RETURNING id`)).id;
    const pieces: string[] = [];
    for (let n = 1; n <= 16; n++) pieces.push(await piece(n));
    const record = async (p: string) => (await one<{ id: string }>(`INSERT INTO service_records (product_id, type, location) VALUES ('${p}', 'INSPECTION', 'ORBES') RETURNING id`)).id;
    const grant = async (amount = 12000) =>
      (await one<{ id: string }>(`INSERT INTO tier_grants (account_id, tier, kind, amount_minor, currency, expires_at) VALUES ('${account}', NULL, 'WARRANTY', ${amount}, 'EUR', now() + interval '12 months') RETURNING id`)).id;
    const T = (h: number) => `'2026-10-01 ${String(8 + h).padStart(2, '0')}:00:00+00'`;
    const claim = (p: string, cols: Record<string, string> = {}) => {
      const all: Record<string, string> = { product_id: `'${p}'`, root_product_id: `'${p}'`, account_id: `'${account}'`, conversation_id: `'${conversation}'`, basis: `'LIFETIME'`, opened_at: T(0), opened_by: `'${admin}'`, ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO warranty_claims (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
    const r0 = await record(pieces[0]);
    const LABEL = { status: `'LABEL_SENT'`, label_at: T(1), label_carrier_id: `'${carrier}'`, label_tracking: `'6A12345678901'`, label_pdf: `'\\x255044462d'::bytea` };
    const RECEIVED = (rec: string) => ({ ...LABEL, status: `'RECEIVED'`, received_at: T(2), service_record_id: `'${rec}'` });
    const DECISION = (outcome: string) => ({ outcome: `'${outcome}'`, decided_at: T(3), decided_by: `'${admin}'` });
    const RETURN = { return_carrier_id: `'${carrier}'`, return_tracking: `'6A99887766'`, return_shipped_at: T(4) };
    const DONE = { status: `'DONE'`, done_at: T(5) };
    const REFUSED_FROM_OPEN = (reason: string) => ({ ...DECISION('REFUSED'), refusal_reason: `'${reason}'`, ...DONE });

    // Its own values: basis, status, outcome, reason, currency, percent, value, tracking, note, PDF.
    await check(claim(pieces[0], { basis: `'ACCIDENT'` }), 'another basis', 'warranty_claims_basis_check');
    await check(claim(pieces[0], { status: `'WAITING'` }), 'another status', 'warranty_claims_status_check');
    await check(claim(pieces[0], { note: `'   '` }), 'a blank note', 'warranty_claims_note_check');
    await check(claim(pieces[0], { note: `'${'x'.repeat(501)}'` }), 'a note over 500 characters', 'warranty_claims_note_check');
    await check(claim(pieces[0], { ...LABEL, label_pdf: `''::bytea` }), 'an empty PDF', 'warranty_claims_label_pdf_check');
    await check(claim(pieces[0], { ...LABEL, label_tracking: `'!'` }), 'a label tracking number off the pattern', 'warranty_claims_label_tracking_check');

    // OPEN: nothing but the claim.
    await check(claim(pieces[0], { ...LABEL, status: `'OPEN'` }), 'OPEN with a label', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...DECISION('REFUSED'), refusal_reason: `'SCRATCHED'` }), 'OPEN with a decision', 'warranty_claims_steps');
    await check(claim(pieces[0], { done_at: T(5) }), 'OPEN with done_at', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RETURN, return_shipped_at: T(0) }), 'OPEN with a return', 'warranty_claims_steps');
    // LABEL_SENT: the label, no receipt.
    await check(claim(pieces[0], { status: `'LABEL_SENT'` }), 'LABEL_SENT without its label', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), status: `'LABEL_SENT'` }), 'LABEL_SENT with a receipt', 'warranty_claims_steps');
    // RECEIVED: the label and the receipt with its record, no decision.
    await check(claim(pieces[0], { status: `'RECEIVED'`, received_at: T(2), service_record_id: `'${r0}'` }), 'RECEIVED without its label', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), received_at: 'NULL', service_record_id: 'NULL' }), 'RECEIVED without its receipt', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[15]}'` }), 'RECEIVED with a decision', 'warranty_claims_steps');
    // DECIDED: received and decided, an outcome after which the piece goes back, no return yet.
    await check(claim(pieces[0], { ...LABEL, ...DECISION('REFUSED'), refusal_reason: `'SCRATCHED'`, status: `'DECIDED'` }), 'DECIDED without its receipt', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), status: `'DECIDED'` }), 'DECIDED without its decision', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[15]}'`, status: `'DECIDED'`, ...RETURN }), 'DECIDED with a return', 'warranty_claims_steps');
    const g0 = await grant();
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('VALUE_CREDIT'), value_minor: '12000', currency: `'EUR'`, grant_id: `'${g0}'`, status: `'DECIDED'` }), 'DECIDED on a credit of value (ORBES keeps the piece)', 'warranty_claims_steps');
    // DONE: decided and done, in one of three shapes.
    await check(claim(pieces[0], { ...LABEL, ...REFUSED_FROM_OPEN('SCRATCHED') }), 'refused with a label but no receipt', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('VALUE_CREDIT'), value_minor: '12000', currency: `'EUR'`, grant_id: `'${g0}'`, ...RETURN, ...DONE }), 'a credit of value with a return', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[15]}'`, ...DONE }), 'a replacement done without its return', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[15]}'`, ...RETURN, status: `'DONE'` }), 'DONE without done_at', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), status: `'DECIDED'` }), 'refused from OPEN left DECIDED without its receipt', 'warranty_claims_steps');
    // CANCELLED: no record, no decision, no return; a label and a receipt time kept.
    await check(claim(pieces[0], { status: `'CANCELLED'` }), 'CANCELLED without its time', 'warranty_claims_steps');
    await check(claim(pieces[0], { cancelled_at: T(1) }), 'a time of cancellation on an open claim', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...RECEIVED(r0), status: `'CANCELLED'`, cancelled_at: T(3) }), 'CANCELLED with its record', 'warranty_claims_steps');
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), status: `'CANCELLED'`, cancelled_at: T(5) }), 'CANCELLED after a decision', 'warranty_claims_steps');

    // The times, in order.
    await check(claim(pieces[0], { ...LABEL, label_at: `'2026-09-30 08:00:00+00'` }), 'a label before the opening', 'warranty_claims_times');
    await check(claim(pieces[0], { ...RECEIVED(r0), received_at: `'2026-10-01 08:30:00+00'` }), 'received before the label', 'warranty_claims_times');
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), decided_at: `'2026-10-01 07:00:00+00'` }), 'decided before the opening', 'warranty_claims_times');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, status: `'DECIDED'`, decided_at: `'2026-10-01 09:30:00+00'` }), 'decided before the receipt', 'warranty_claims_times');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, ...RETURN, return_shipped_at: `'2026-10-01 10:30:00+00'`, ...DONE }), 'returned before the decision', 'warranty_claims_times');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, ...RETURN, ...DONE, done_at: `'2026-10-01 11:30:00+00'` }), 'done before the return', 'warranty_claims_times');
    await check(claim(pieces[0], { status: `'CANCELLED'`, cancelled_at: `'2026-10-01 07:00:00+00'` }), 'cancelled before the opening', 'warranty_claims_times');
    // The label and the return whole; the receipt with its record.
    await check(claim(pieces[0], { label_pdf: `'\\x25'::bytea` }), 'a PDF without its label', 'warranty_claims_label');
    await check(claim(pieces[0], { label_carrier_id: `'${carrier}'` }), 'a label carrier without its time', 'warranty_claims_label');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, status: `'DECIDED'`, return_carrier_id: `'${carrier}'` }), 'a return carrier without its time', 'warranty_claims_return');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, ...RETURN, return_tracking: `'!'`, ...DONE }), 'a return tracking number off the pattern', 'warranty_claims_return_tracking_check');
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), service_record_id: `'${r0}'` }), 'a record without its receipt', 'warranty_claims_received');
    // The decision whole; the claimant; the refusal, the value, the credit and the replacement with their outcome only.
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), decided_by: 'NULL' }), 'a decision without who', 'warranty_claims_decided');
    await check(claim(pieces[0], { conversation_id: 'NULL' }), 'an account without its conversation', 'warranty_claims_claimant');
    await check(claim(pieces[0], { account_id: 'NULL', conversation_id: 'NULL', note: `'Receipt 4411, ORBES Paris.'` }), 'an ORBES warranty claim without its registered owner', 'warranty_claims_claimant');
    await check(claim(pieces[0], { account_id: 'NULL', conversation_id: 'NULL', basis: `'LEGAL'` }), 'a buyer without an account and no receipt in the note', 'warranty_claims_claimant');
    await check(claim(pieces[0], { ...DECISION('REFUSED'), ...DONE }), 'a refusal without its reason', 'warranty_claims_refusal');
    await check(claim(pieces[0], { refusal_reason: `'SCRATCHED'` }), 'a reason without a decision', 'warranty_claims_refusal');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('VALUE_CREDIT'), grant_id: `'${g0}'`, ...DONE }), 'a credit of value without its value', 'warranty_claims_value');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('VALUE_CREDIT'), grant_id: `'${g0}'`, value_minor: '12000', ...DONE }), 'a value without its currency', 'warranty_claims_value');
    await check(claim(pieces[0], { value_minor: '12000', currency: `'EUR'` }), 'a value without a decision', 'warranty_claims_value');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, value_minor: '12000', currency: `'EUR'`, status: `'DECIDED'` }), 'a value on a repair', 'warranty_claims_value');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('VALUE_CREDIT'), value_minor: '12000', currency: `'EUR'`, ...DONE }), 'a credit of value without its grant', 'warranty_claims_credit');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('PART_CREDIT'), value_minor: '12000', currency: `'EUR'`, grant_id: `'${g0}'`, status: `'DECIDED'` }), 'a part credit without its percent', 'warranty_claims_credit');
    await check(claim(pieces[0], { grant_id: `'${g0}'` }), 'a grant without a decision', 'warranty_claims_credit');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[15]}'`, credit_percent: '30', status: `'DECIDED'` }), 'a percent on a replacement', 'warranty_claims_credit');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), status: `'DECIDED'` }), 'a replacement without its piece', 'warranty_claims_replacement');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPLACEMENT'), replacement_product_id: `'${pieces[0]}'`, status: `'DECIDED'` }), 'replaced by itself', 'warranty_claims_replacement');
    await check(claim(pieces[0], { other_size: 'true' }), 'another size without a replacement', 'warranty_claims_replacement');
    await check(claim(pieces[0], { replacement_product_id: `'${pieces[15]}'` }), 'a replacement piece without a decision', 'warranty_claims_replacement');
    await check(claim(pieces[0], { ...RECEIVED(r0), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, replacement_product_id: `'${pieces[15]}'`, status: `'DECIDED'` }), 'a replacement piece on a repair', 'warranty_claims_replacement');
    await check(claim(pieces[0], { continues_claim_id: `'${crypto.randomUUID()}'`, basis: `'TWO_YEARS'` }), 'a 2-year claim continuing another', 'warranty_claims_continues');
    const self = crypto.randomUUID();
    await check(claim(pieces[0], { id: `'${self}'`, continues_claim_id: `'${self}'`, basis: `'LEGAL'` }), 'a claim continuing itself', 'warranty_claims_continues');

    // Each basis its outcomes (answer 10, D1): the lifetime warranty never a repair nor a legal remedy; the 2-year warranty
    // and the legal guarantee never a credit; the 2-year warranty never a legal remedy.
    const decided = (basis: string, outcome: string, extra: Record<string, string> = {}) => ({ ...RECEIVED(r0), ...DECISION(outcome), basis: `'${basis}'`, status: `'DECIDED'`, ...extra });
    const credit = (pct = false) => ({ value_minor: '12000', currency: `'EUR'`, grant_id: `'${g0}'`, ...(pct ? { credit_percent: '30' } : {}) });
    const money = { value_minor: '12000', currency: `'EUR'` };
    await check(claim(pieces[0], decided('LIFETIME', 'REPAIR')), 'a lifetime repair', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], decided('LIFETIME', 'PRICE_REDUCTION', money)), 'a lifetime price reduction', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], { ...decided('LIFETIME', 'REFUND', money), ...DONE }), 'a lifetime refund', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], decided('TWO_YEARS', 'PART_CREDIT', credit(true))), 'a 2-year part credit', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], { ...decided('TWO_YEARS', 'VALUE_CREDIT', credit()), ...DONE }), 'a 2-year credit of value', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], decided('TWO_YEARS', 'PRICE_REDUCTION', money)), 'a 2-year price reduction', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], { ...decided('TWO_YEARS', 'REFUND', money), ...DONE }), 'a 2-year refund', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], decided('LEGAL', 'PART_CREDIT', credit(true))), 'a legal part credit', 'warranty_claims_basis_outcome');
    await check(claim(pieces[0], { ...decided('LEGAL', 'VALUE_CREDIT', credit()), ...DONE }), 'a legal credit of value', 'warranty_claims_basis_outcome');
    // Each basis its reasons: the lifetime warranty never ends; the 2-year warranty no exclusion of accident; the legal
    // guarantee only no fault, on purpose or by someone else.
    await check(claim(pieces[0], REFUSED_FROM_OPEN('WARRANTY_ENDED')), 'a lifetime warranty ended', 'warranty_claims_basis_refusal');
    for (const reason of ['SCRATCHED', 'DAMAGED_ON_PURPOSE', 'DAMAGED_BY_SOMEONE_ELSE', 'ALTERED_OUTSIDE_ORBES']) {
      await check(claim(pieces[0], { ...REFUSED_FROM_OPEN(reason), basis: `'TWO_YEARS'` }), `a 2-year refusal ${reason}`, 'warranty_claims_basis_refusal');
    }
    for (const reason of ['LOST', 'THEFT_REPORTED', 'SCRATCHED', 'ALTERED_OUTSIDE_ORBES', 'WARRANTY_ENDED', 'WARRANTY_VOID']) {
      await check(claim(pieces[0], { ...REFUSED_FROM_OPEN(reason), basis: `'LEGAL'` }), `a legal refusal ${reason}`, 'warranty_claims_basis_refusal');
    }
    // An unknown reason: no basis lists it either (its own CHECK, warranty_claims_refusal_reason_check, read by schema.test).
    await check(claim(pieces[0], { ...REFUSED_FROM_OPEN('SCRATCHED'), refusal_reason: `'TOO_LATE'` }), 'an unknown reason');
    await check(claim(pieces[0], { ...decided('LIFETIME', 'PART_CREDIT', credit()), credit_percent: '0' }), 'a percent of 0', 'warranty_claims_credit_percent_check');
    await check(claim(pieces[0], { ...decided('LIFETIME', 'PART_CREDIT', credit(true)), value_minor: '0' }), 'a value of 0', 'warranty_claims_value_minor_check');
    await check(claim(pieces[0], { ...decided('LIFETIME', 'PART_CREDIT', credit(true)), currency: `'JPY'` }), 'another currency', 'warranty_claims_currency_check');

    // The shapes accepted: OPEN; refused from OPEN; a lifetime credit of value kept by ORBES; a legal refund; a 2-year
    // repair returned; a LEGAL claim of a buyer without an account; a claim cancelled with its label and receipt time.
    const open = await id(claim(pieces[0]));
    await expect(claim(pieces[0])).rejects.toSatisfy((e) => isUniqueViolation(e, 'warranty_claims_open_once'));
    await check(run(`UPDATE warranty_claims SET status = 'LABEL_SENT' WHERE id = '${open}'`), 'a step skipped', 'warranty_claims_steps');
    await claim(pieces[1], REFUSED_FROM_OPEN('LOST'));
    await claim(pieces[2], { ...RECEIVED(await record(pieces[2])), ...DECISION('VALUE_CREDIT'), ...credit(), ...DONE });
    await claim(pieces[3], { ...RECEIVED(await record(pieces[3])), ...DECISION('REFUND'), ...money, basis: `'LEGAL'`, ...DONE });
    await claim(pieces[4], { ...RECEIVED(await record(pieces[4])), ...DECISION('REPAIR'), basis: `'TWO_YEARS'`, ...RETURN, ...DONE });
    await claim(pieces[5], { account_id: 'NULL', conversation_id: 'NULL', basis: `'LEGAL'`, note: `'Receipt 4411 of 2 OCT 2026, ORBES Paris.'` });
    const moved = await id(claim(pieces[6], { ...RECEIVED(await record(pieces[6])), basis: `'TWO_YEARS'` }));
    // Moved to the legal guarantee: the 2-year claim cancelled with its label and receipt time, its record handed to the
    // LEGAL claim that continues it (the old row first: one live claim per piece, the record once).
    const rec6 = (await one<{ service_record_id: string }>(`SELECT service_record_id FROM warranty_claims WHERE id = '${moved}'`)).service_record_id;
    await run(`UPDATE warranty_claims SET status = 'CANCELLED', cancelled_at = ${T(3)}, service_record_id = NULL WHERE id = '${moved}'`);
    const legal = await id(claim(pieces[6], { ...RECEIVED(rec6), basis: `'LEGAL'`, continues_claim_id: `'${moved}'` }));
    expect(await one(`SELECT status, received_at IS NOT NULL AS received, service_record_id FROM warranty_claims WHERE id = '${moved}'`)).toEqual({ status: 'CANCELLED', received: true, service_record_id: null });
    await expect(claim(pieces[7], { basis: `'LEGAL'`, continues_claim_id: `'${moved}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'warranty_claims_continues_claim_id_key'));

    // One free replacement per original piece under the lifetime warranty: a replacement's claim shares its root; a
    // part credit beside it, a LEGAL replacement and two 2-year replacements on the same root accepted.
    const root = pieces[8];
    // Each decided claim with its own record, all of one original piece.
    const decidedOn = async (p: string, basis: string, outcome: string, extra: Record<string, string>) =>
      claim(p, { ...RECEIVED(await record(p)), ...DECISION(outcome), basis: `'${basis}'`, status: `'DECIDED'`, root_product_id: `'${root}'`, ...extra });
    await decidedOn(pieces[8], 'LIFETIME', 'REPLACEMENT', { replacement_product_id: `'${pieces[9]}'` });
    await expect(decidedOn(pieces[9], 'LIFETIME', 'REPLACEMENT', { replacement_product_id: `'${pieces[10]}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'warranty_claims_free_once'));
    await expect(decidedOn(pieces[9], 'LIFETIME', 'VALUE_CREDIT', { ...credit(), grant_id: `'${await grant()}'`, status: `'DONE'`, done_at: T(5) })).rejects.toSatisfy((e) => isUniqueViolation(e, 'warranty_claims_free_once'));
    await decidedOn(pieces[9], 'LIFETIME', 'PART_CREDIT', { ...credit(true), grant_id: `'${await grant(3600)}'` });
    await decidedOn(pieces[10], 'LEGAL', 'REPLACEMENT', { replacement_product_id: `'${pieces[11]}'` });
    await decidedOn(pieces[11], 'TWO_YEARS', 'REPLACEMENT', { replacement_product_id: `'${pieces[12]}'` });
    await decidedOn(pieces[12], 'TWO_YEARS', 'REPLACEMENT', { replacement_product_id: `'${pieces[13]}'` });
    // A piece replaces one piece only.
    await expect(decidedOn(pieces[13], 'TWO_YEARS', 'REPLACEMENT', { replacement_product_id: `'${pieces[12]}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'warranty_claims_replacement_product_id_key'));
    // One live claim per piece: another after a claim done is accepted.
    await claim(pieces[1]);

    // Its identity fixed; never deleted.
    for (const q of [
      `UPDATE warranty_claims SET basis = 'TWO_YEARS' WHERE id = '${open}'`,
      `UPDATE warranty_claims SET product_id = '${pieces[14]}' WHERE id = '${open}'`,
      `UPDATE warranty_claims SET root_product_id = '${pieces[14]}' WHERE id = '${open}'`,
      `UPDATE warranty_claims SET account_id = NULL, conversation_id = NULL, note = 'x' WHERE id = '${open}'`,
      `UPDATE warranty_claims SET opened_at = opened_at + interval '1 minute' WHERE id = '${open}'`,
      `UPDATE warranty_claims SET continues_claim_id = NULL WHERE id = '${legal}'`,
      `DELETE FROM warranty_claims WHERE id = '${open}'`,
    ]) {
      await expect(run(q), q).rejects.toSatisfy(isGuardViolation);
    }
    // The steps move forward with their columns.
    await run(`UPDATE warranty_claims SET status = 'LABEL_SENT', label_at = ${T(1)}, label_carrier_id = '${carrier}', label_tracking = '6A12345678901', label_pdf = '\\x255044462d'::bytea WHERE id = '${open}'`);
    await run(`UPDATE warranty_claims SET status = 'CANCELLED', cancelled_at = ${T(2)}, note = 'Closed: the collector found the clasp.' WHERE id = '${open}'`);

    // A WARRANTY grant: no tier, no birthday, an amount, a currency and an expiry.
    await check(run(`INSERT INTO tier_grants (account_id, tier, kind, amount_minor, currency, expires_at) VALUES ('${account}', 2, 'WARRANTY', 100, 'EUR', now() + interval '1 year')`), 'a WARRANTY grant with a tier', 'tier_grants_birthday');
    await check(run(`INSERT INTO tier_grants (account_id, tier, kind, amount_minor, currency, expires_at, birthday_on) VALUES ('${account}', NULL, 'WARRANTY', 100, 'EUR', now() + interval '1 year', '2026-03-14')`), 'a WARRANTY grant with a birthday', 'tier_grants_birthday');
    await check(run(`INSERT INTO tier_grants (account_id, tier, kind) VALUES ('${account}', NULL, 'WARRANTY')`), 'a WARRANTY grant without its amount', 'tier_grants_credit');
    await check(run(`INSERT INTO tier_grants (account_id, tier, kind) VALUES ('${account}', 2, 'VOUCHER')`), 'another kind', 'tier_grants_kind_check');
    // Three warranty credits of one account beside each other (no tier, so tier_grants_once never meets them).
    const credits = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM tier_grants WHERE account_id = '${account}' AND kind = 'WARRANTY'`)).n;
    expect(credits).toBe(3);

    // THE PROGRAM: PLATINE every piece (NULL) or 0 to 20; the warranty credit 1 to 100 %, never NULL.
    const had = await one<{ n: number }>(`SELECT count(*)::int AS n FROM club_program_settings`);
    if (had.n === 0) await run(`INSERT INTO club_program_settings (id) VALUES (1)`);
    await run(`UPDATE club_program_settings SET care_pieces_platine = NULL, warranty_credit_percent = 100`);
    await run(`UPDATE club_program_settings SET care_pieces_platine = 20, warranty_credit_percent = 1`);
    await check(run(`UPDATE club_program_settings SET care_pieces_platine = 21`), 'PLATINE over 20', 'club_program_settings_care_pieces_platine_check');
    await check(run(`UPDATE club_program_settings SET warranty_credit_percent = 0`), 'a warranty credit of 0 %', 'club_program_settings_warranty_credit_percent_check');
    await check(run(`UPDATE club_program_settings SET warranty_credit_percent = 101`), 'a warranty credit over 100 %', 'club_program_settings_warranty_credit_percent_check');
    await expect(run(`UPDATE club_program_settings SET warranty_credit_percent = NULL`)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    if (had.n === 0) await run(`DELETE FROM club_program_settings`);
    else await run(`UPDATE club_program_settings SET care_pieces_platine = NULL, warranty_credit_percent = 30`);

    // The down step refuses while a claim or a WARRANTY grant exists, naming the counts; this database stays at 0048.
    const claims = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM warranty_claims`)).n;
    expect(claims).toBe(14);
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    await expect(down(t.db)).rejects.toThrow(new RegExp(`0048_orbes_care cannot be rolled back: ${claims} warranty claims and ${credits} warranty credits exist`));
    expect((await migrationStatus(t.db)).find((m) => m.name === '0048_orbes_care')?.executedAt).toBeDefined();
    // Without them (the rows taken away, as only a test does), it passes, and up again.
    await run(`ALTER TABLE warranty_claims DISABLE TRIGGER warranty_claims_no_delete`);
    await run(`DELETE FROM warranty_claims`);
    await run(`ALTER TABLE warranty_claims ENABLE TRIGGER warranty_claims_no_delete`);
    await expect(down(t.db)).rejects.toThrow(/0048_orbes_care cannot be rolled back: 0 warranty claims and 3 warranty credits exist/);
    await run(`ALTER TABLE tier_grants DISABLE TRIGGER tier_grants_no_delete`);
    await run(`DELETE FROM tier_grants WHERE account_id = '${account}'`);
    await run(`ALTER TABLE tier_grants ENABLE TRIGGER tier_grants_no_delete`);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await up(t.db)).applied).toEqual(['0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM service_records WHERE product_id IN (${pieces.map((p) => `'${p}'`).join(', ')})`);
    await run(`DELETE FROM client_conversations WHERE id = '${conversation}'`);
  });

  it('0048: every model backfilled Lifetime, a model written by plain SQL at 2 years; every warranty not VOID lifetime with no end date, its months kept, a VOID one untouched; a warranty inserted without its kind taking its model\'s, an end date written on a lifetime row cleared, an explicit kind kept; PLATINE\'s saved allowance every piece; PRIVATE CARE\'s place ORBES; down, in its order, giving back each end date, the place and PLATINE\'s 1', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const all = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows as T[];
    // DOWN's order, as written: the trigger, its function and the CHECK first, the end dates second, the columns third.
    const at = (re: RegExp) => m0048.DOWN.findIndex((q) => re.test(q));
    expect(at(/^DROP TRIGGER IF EXISTS warranties_kind ON warranties$/)).toBeGreaterThan(0);
    expect(at(/^DROP TRIGGER IF EXISTS warranties_kind/)).toBeLessThan(at(/^DROP FUNCTION IF EXISTS orbes_warranty_kind\(\)$/));
    expect(at(/^DROP FUNCTION/)).toBeLessThan(at(/DROP CONSTRAINT IF EXISTS warranties_lifetime_open$/));
    expect(at(/DROP CONSTRAINT IF EXISTS warranties_lifetime_open$/)).toBeLessThan(at(/^UPDATE warranties SET end_date/));
    expect(at(/^UPDATE warranties SET end_date/)).toBeLessThan(at(/^ALTER TABLE warranties DROP COLUMN IF EXISTS lifetime$/));
    expect(at(/^ALTER TABLE warranties DROP COLUMN IF EXISTS lifetime$/)).toBeLessThan(at(/^ALTER TABLE models DROP COLUMN IF EXISTS warranty_lifetime$/));

    // The data of before, at 0047.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    await run(`INSERT INTO categories (id, code, name) VALUES (12, 'E', 'Warranty backfill') ON CONFLICT DO NOTHING`);
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (12, 'MONOLITHE', 'RING', 'WBF-RG') RETURNING id`)).id;
    const piece = async (n: number, m = model) =>
      (await one<{ id: string }>(`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-E-${String(n).padStart(5, '0')}', ${(26 << 25) | (12 << 20) | n}, 2026, 12, ${n}, 'WBF-RG-${n}', '${m}', 'SILVER') RETURNING id`)).id;
    const pieces: string[] = [];
    for (let n = 1; n <= 5; n++) pieces.push(await piece(n));
    const warranty = (p: string, values: string) => run(`INSERT INTO warranties (product_id, start_date, duration_months, end_date, voided_at, void_reason) VALUES ('${p}', ${values})`);
    await warranty(pieces[0], `'2026-01-31', 1, '2026-02-28', NULL, NULL`); // started, its end clamped to February's last day
    await warranty(pieces[1], `'2025-06-15', 30, '2027-12-15', NULL, NULL`); // extended by 6 months
    await warranty(pieces[2], `NULL, 24, NULL, NULL, NULL`); // not started
    await warranty(pieces[3], `'2024-03-01', 24, '2026-03-01', now(), 'Sold outside the network.'`); // VOID
    await warranty(pieces[4], `'2020-01-15', 24, '2022-01-15', NULL, NULL`); // EXPIRED
    const care = async (type: string, location: string) =>
      (await one<{ id: string }>(`INSERT INTO service_records (product_id, type, location, performed_by) VALUES ('${pieces[0]}', '${type}', '${location}', '${location}') RETURNING id`)).id;
    const careAtelier = await care('YEARLY_CARE', 'ORBES atelier');
    const careTyped = await care('YEARLY_CARE', 'ORBES Paris');
    const inspection = await care('INSPECTION', 'ORBES atelier');
    const had = await one<{ n: number }>(`SELECT count(*)::int AS n FROM club_program_settings`);
    if (had.n === 0) await run(`INSERT INTO club_program_settings (id) VALUES (1)`);
    await run(`UPDATE club_program_settings SET care_pieces_platine = 1`);
    const ends = () => all<{ product_id: string; lifetime?: boolean; duration_months: number; end_date: string | null }>(
      `SELECT * FROM warranties WHERE product_id IN (${pieces.map((p) => `'${p}'`).join(', ')}) ORDER BY start_date NULLS LAST`,
    );
    const before = (await ends()).map((w) => ({ product_id: w.product_id, duration_months: w.duration_months, end_date: w.end_date }));

    // Up: every model Lifetime; every warranty not VOID lifetime with no end date, its months kept; VOID untouched.
    expect((await up(t.db)).applied).toEqual(['0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM models WHERE NOT warranty_lifetime`)).n).toBe(0);
    const w = (p: string) => one<{ lifetime: boolean; duration_months: number; end_date: string | null; voided: boolean }>(`SELECT lifetime, duration_months, end_date::text AS end_date, voided_at IS NOT NULL AS voided FROM warranties WHERE product_id = '${p}'`);
    expect(await w(pieces[0])).toEqual({ lifetime: true, duration_months: 1, end_date: null, voided: false });
    expect(await w(pieces[1])).toEqual({ lifetime: true, duration_months: 30, end_date: null, voided: false });
    expect(await w(pieces[2])).toEqual({ lifetime: true, duration_months: 24, end_date: null, voided: false });
    expect(await w(pieces[3])).toEqual({ lifetime: false, duration_months: 24, end_date: '2026-03-01', voided: true });
    expect(await w(pieces[4])).toEqual({ lifetime: true, duration_months: 24, end_date: null, voided: false });
    // PRIVATE CARE's place: ORBES; a place typed by staff and another service's left as they are.
    const place = (rec: string) => one<{ location: string; performed_by: string }>(`SELECT location, performed_by FROM service_records WHERE id = '${rec}'`);
    expect(await place(careAtelier)).toEqual({ location: 'ORBES', performed_by: 'ORBES' });
    expect(await place(careTyped)).toEqual({ location: 'ORBES Paris', performed_by: 'ORBES Paris' });
    expect(await place(inspection)).toEqual({ location: 'ORBES atelier', performed_by: 'ORBES atelier' });
    // PLATINE's saved allowance: every piece.
    expect(await one(`SELECT care_pieces_platine FROM club_program_settings WHERE id = 1`)).toEqual({ care_pieces_platine: null });

    // A model written by plain SQL: 2 years (the column's false); its warranty inserted without its kind takes it, its
    // end date kept. On a Lifetime model's piece: lifetime, the end date cleared.
    const twoYears = (await one<{ id: string; warranty_lifetime: boolean }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (12, 'ECLIPSE', 'BAG', 'WBF-BG') RETURNING id, warranty_lifetime`));
    expect(twoYears.warranty_lifetime).toBe(false);
    const leather = await piece(6, twoYears.id);
    const ring = await piece(7);
    await run(`INSERT INTO warranties (product_id, start_date, duration_months, end_date) VALUES ('${leather}', '2026-10-15', 24, '2028-10-15')`);
    await run(`INSERT INTO warranties (product_id, duration_months) VALUES ('${ring}', 24)`);
    expect(await w(leather)).toEqual({ lifetime: false, duration_months: 24, end_date: '2028-10-15', voided: false });
    expect(await w(ring)).toEqual({ lifetime: true, duration_months: 24, end_date: null, voided: false });
    // The previous image's activation (start, months and end written): the end cleared on the lifetime row.
    await run(`UPDATE warranties SET start_date = '2026-10-15', duration_months = 24, end_date = '2028-10-15' WHERE product_id = '${ring}'`);
    expect(await w(ring)).toEqual({ lifetime: true, duration_months: 24, end_date: null, voided: false });
    // An explicit kind is kept: 2 years on a Lifetime model's piece keeps its end; lifetime on a 2-year one clears it.
    const third = await piece(8);
    await run(`INSERT INTO warranties (product_id, start_date, duration_months, end_date, lifetime) VALUES ('${third}', '2026-10-15', 24, '2028-10-15', false)`);
    expect(await w(third)).toEqual({ lifetime: false, duration_months: 24, end_date: '2028-10-15', voided: false });
    await run(`UPDATE warranties SET lifetime = true WHERE product_id = '${leather}'`);
    expect(await w(leather)).toEqual({ lifetime: true, duration_months: 24, end_date: null, voided: false });
    // Without the trigger, the CHECK holds: a lifetime warranty has no end date.
    await run(`ALTER TABLE warranties DISABLE TRIGGER warranties_kind`);
    await expect(run(`UPDATE warranties SET end_date = '2028-10-15' WHERE product_id = '${leather}'`)).rejects.toSatisfy((e) => isCheckViolation(e, 'warranties_lifetime_open'));
    await expect(run(`INSERT INTO warranties (product_id, duration_months) VALUES ('${await piece(9)}', 24)`)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    await run(`ALTER TABLE warranties ENABLE TRIGGER warranties_kind`);

    // Down, in its order: each started lifetime warranty's end date given back from its months (February's last day, the
    // extension kept, the expired one expired again), the not-started one without, the VOID one as it was; the place and
    // PLATINE's 1 given back.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    expect((await down(t.db)).reverted).toEqual(['0048_orbes_care']);
    expect((await ends()).map((x) => ({ product_id: x.product_id, duration_months: x.duration_months, end_date: x.end_date }))).toEqual(before);
    expect((await ends()).every((x) => !('lifetime' in x))).toBe(true);
    const end = (p: string) => one<{ end_date: string | null }>(`SELECT end_date::text AS end_date FROM warranties WHERE product_id = '${p}'`);
    expect(await end(pieces[0])).toEqual({ end_date: '2026-02-28' });
    expect(await end(ring)).toEqual({ end_date: '2028-10-15' });
    expect(await end(leather)).toEqual({ end_date: '2028-10-15' });
    expect(await place(careAtelier)).toEqual({ location: 'ORBES atelier', performed_by: 'ORBES atelier' });
    expect(await place(careTyped)).toEqual({ location: 'ORBES Paris', performed_by: 'ORBES Paris' });
    expect(await one(`SELECT care_pieces_platine FROM club_program_settings WHERE id = 1`)).toEqual({ care_pieces_platine: 1 });

    // Up again, then the rows of this test taken away.
    expect((await up(t.db)).applied).toEqual(['0048_orbes_care', '0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    await run(`DELETE FROM service_records WHERE id IN ('${careAtelier}', '${careTyped}', '${inspection}')`);
    if (had.n === 0) await run(`DELETE FROM club_program_settings`);
  });

  /** What names an object of 0049: the pace's columns and CHECKs on drops, the admission's on live_entries, its index. */
  const of0049 = (o: string) =>
    /^table drops pace_/.test(o) || /^constraint drops drops_pace/.test(o) ||
    /^table live_entries admitted_/.test(o) || /^constraint live_entries live_entries_admitted/.test(o) || /INDEX live_entries_waiting_admission /.test(o);

  it('0049 adds the pace of a LIVE RELEASE (five columns of drops and their CHECKs) and the admission of its entries (two columns, their CHECK and the partial index of the line waiting for its batch), and nothing else; down restores 0048 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0049_live_pace');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names pace_batches' too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0049(o))).toEqual([]);
    expect(before.filter(of0049)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table drops pace_batch integer YES ',
      'table drops pace_batches integer NO 0',
      'table drops pace_minutes smallint YES ',
      'table drops pace_next_at timestamp with time zone YES ',
      'table drops pace_paused_at timestamp with time zone YES ',
      'table live_entries admitted_at timestamp with time zone YES ',
      'table live_entries admitted_batch integer YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      "constraint drops drops_pace CHECK ((((pace_batch IS NULL) = (pace_minutes IS NULL)) AND ((pace_batch IS NULL) OR ((mode = 'LIVE'::text) AND (parent_drop_id IS NULL))) AND ((pace_batches = 0) OR (pace_batch IS NOT NULL))))",
      'constraint drops drops_pace_batch_check CHECK (((pace_batch >= 1) AND (pace_batch <= 5000)))',
      'constraint drops drops_pace_batches_check CHECK ((pace_batches >= 0))',
      'constraint drops drops_pace_minutes_check CHECK (((pace_minutes >= 1) AND (pace_minutes <= 60)))',
      'constraint drops drops_pace_state CHECK (((pace_batch IS NOT NULL) OR ((pace_paused_at IS NULL) AND (pace_next_at IS NULL))))',
      'constraint live_entries live_entries_admitted CHECK ((((admitted_at IS NULL) = (admitted_batch IS NULL)) AND ((admitted_at IS NULL) OR ("position" IS NOT NULL))))',
      'constraint live_entries live_entries_admitted_batch_check CHECK ((admitted_batch >= 0))',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toHaveLength(1);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  it('0049: a pace X 1..5 000 every Y 1..60 minutes, both or neither, on a LIVE release that is not an after-room only; its pause and next batch only with it; batches above 0 only with it; an entry admitted with its batch, both or neither, only with a place; the previous image\'s rows unpaced and not admitted; down refused while a pace or a batch admission exists, naming the counts', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    await run(`INSERT INTO categories (id, code, name) VALUES (14, 'P', 'Pace checks') ON CONFLICT DO NOTHING`);
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (14, 'P', 'RING', 'PACECHK') RETURNING id`)).id;
    const accounts: string[] = [];
    for (let n = 1; n <= 4; n++) accounts.push((await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('pace-${n}@example.com', 'pace-${n}@example.com', 'scrypt$x') RETURNING id`)).id);

    // As the previous image writes them: a DRAW and a LIVE release, no pace, no batch.
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const draw = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
      VALUES (${model}, 'Draw', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}) RETURNING id`.execute(t.db)).rows[0].id;
    // (Cancelled: at 0058 every open LIVE release has a pace, drops_live_paced; 0049's rules hold whatever the release.)
    const live = await liveDrop(model, { published_at: 'now()', cancelled_at: 'now()' });
    const pace = (id: string) => one<Record<string, unknown>>(`SELECT pace_batch, pace_minutes, pace_paused_at, pace_next_at, pace_batches FROM drops WHERE id = '${id}'`);
    for (const id of [draw, live]) expect(await pace(id)).toEqual({ pace_batch: null, pace_minutes: null, pace_paused_at: null, pace_next_at: null, pace_batches: 0 });

    // The pace: X and Y within their bounds, both or neither; never on a DRAW nor an after-room.
    const set = (sets: string, id = live) => run(`UPDATE drops SET ${sets} WHERE id = '${id}'`);
    for (const [sets, constraint] of [
      [`pace_batch = 0, pace_minutes = 1`, 'drops_pace_batch_check'],
      [`pace_batch = 5001, pace_minutes = 1`, 'drops_pace_batch_check'],
      [`pace_batch = 250, pace_minutes = 0`, 'drops_pace_minutes_check'],
      [`pace_batch = 250, pace_minutes = 61`, 'drops_pace_minutes_check'],
      [`pace_batch = 250`, 'drops_pace'],
      [`pace_minutes = 1`, 'drops_pace'],
      [`pace_batches = 1`, 'drops_pace'],
      // Below 0 breaks drops_pace too (a batch without a pace): either may be named first.
      [`pace_batches = -1`, undefined],
      [`pace_next_at = now()`, 'drops_pace_state'],
      [`pace_paused_at = now()`, 'drops_pace_state'],
    ] as const) {
      await check(set(sets), `a LIVE release: ${sets}`, constraint);
    }
    await check(set(`pace_batch = 250, pace_minutes = 1, pace_batches = -1`), 'a paced release, its batches below 0', 'drops_pace_batches_check');
    await expect(set(`pace_batches = NULL`)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    await check(set(`pace_batch = 250, pace_minutes = 1`, draw), 'a DRAW with a pace', 'drops_pace');
    await check(set(`pace_batches = 1`, draw), 'a DRAW with a batch', 'drops_pace');
    const child = await liveDrop(model, { ...AFTER_ROOM(live) });
    await check(set(`pace_batch = 250, pace_minutes = 1`, child), 'an after-room with a pace', 'drops_pace');
    // The bounds, then the release's pace with its next batch, a pause and its batches.
    await set(`pace_batch = 1, pace_minutes = 60`);
    await set(`pace_batch = 5000, pace_minutes = 1`);
    await set(`pace_batch = 2, pace_minutes = 1, pace_next_at = '2026-12-01T10:01:00Z', pace_paused_at = '2026-12-01T10:00:30Z', pace_batches = 1`);
    // A pace that has admitted a batch is never taken away; before its first batch it may be.
    await check(set(`pace_batch = NULL, pace_minutes = NULL, pace_next_at = NULL, pace_paused_at = NULL`), 'a pace taken away after a batch', 'drops_pace');
    const unpaced = await liveDrop(model, { pace_batch: '250', pace_minutes: '1', cancelled_at: 'now()' });
    await set(`pace_batch = NULL, pace_minutes = NULL`, unpaced);

    // The admission: both or neither, a batch of 0 or more, only with a place in the line.
    const size = (await one<{ id: string }>(`INSERT INTO drop_sizes (drop_id, label, position, stock) VALUES ('${live}', '52', 1, 4) RETURNING id`)).id;
    const entry = (account: string, cols: Record<string, string> = {}) =>
      sql.raw<{ id: string; admitted_at: Date | null; admitted_batch: number | null }>(
        `INSERT INTO live_entries (drop_id, account_id, size_id, quantity, tier${Object.keys(cols).map((c) => `, ${c}`).join('')})
         VALUES ('${live}', '${account}', '${size}', 1, 0${Object.values(cols).map((v) => `, ${v}`).join('')}) RETURNING id, admitted_at, admitted_batch`,
      ).execute(t.db);
    // As the previous image enters and queues: not admitted.
    const waiting = (await entry(accounts[0])).rows[0];
    expect([waiting.admitted_at, waiting.admitted_batch]).toEqual([null, null]);
    const queued = { status: `'QUEUED'`, position: '1', queued_at: `'2026-12-01T10:00:00Z'` };
    await check(entry(accounts[1], { admitted_at: `'2026-12-01T10:00:00Z'`, admitted_batch: '0' }), 'admitted without a place', 'live_entries_admitted');
    await check(entry(accounts[1], { ...queued, admitted_at: `'2026-12-01T10:00:00Z'` }), 'admitted without its batch', 'live_entries_admitted');
    await check(entry(accounts[1], { ...queued, admitted_batch: '1' }), 'a batch without its time', 'live_entries_admitted');
    await check(entry(accounts[1], { ...queued, admitted_at: `'2026-12-01T10:00:00Z'`, admitted_batch: '-1' }), 'a batch below 0', 'live_entries_admitted_batch_check');
    const first = (await entry(accounts[1], { ...queued })).rows[0];
    expect([first.admitted_at, first.admitted_batch]).toEqual([null, null]);
    await run(`UPDATE live_entries SET admitted_at = '2026-12-01T10:00:00Z', admitted_batch = 0 WHERE id = '${first.id}'`);
    await entry(accounts[2], { status: `'QUEUED'`, position: '2', queued_at: `'2026-12-01T10:00:05Z'`, admitted_at: `'2026-12-01T10:01:00Z'`, admitted_batch: '1' });
    await entry(accounts[3], { status: `'QUEUED'`, position: '3', queued_at: `'2026-12-01T10:00:06Z'` });
    // The line waiting for its batch is read through the partial index's rows: the QUEUED entries not admitted.
    expect(await one(`SELECT count(*)::int AS n FROM live_entries WHERE drop_id = '${live}' AND status = 'QUEUED' AND admitted_at IS NULL`)).toEqual({ n: 1 });
    await check(run(`UPDATE live_entries SET admitted_at = NULL WHERE id = '${first.id}'`), 'the time taken away, its batch kept', 'live_entries_admitted');

    // Down refuses while a release has a pace or an entry was admitted by a batch, naming the counts; this database stays at 0049.
    // 0053, 0052, 0051 and 0050, which hold nothing here, go down first.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    await expect(down(t.db)).rejects.toThrow(/0049_live_pace cannot be rolled back: 1 paced releases and 1 entries admitted by a batch exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0049_live_pace')?.executedAt).toBeDefined();
    await run(`UPDATE live_entries SET admitted_at = NULL, admitted_batch = NULL WHERE drop_id = '${live}' AND admitted_batch > 0`);
    await expect(down(t.db)).rejects.toThrow(/0049_live_pace cannot be rolled back: 1 paced releases and 0 entries admitted by a batch exist/);
    // Without a pace (taken away, as only a test does) and with batch 0 admissions only, it passes; the admissions go with their columns.
    await set(`pace_batch = NULL, pace_minutes = NULL, pace_next_at = NULL, pace_paused_at = NULL, pace_batches = 0`);
    expect((await down(t.db)).reverted).toEqual(['0049_live_pace']);
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the two releases, without one now,
    // are cancelled before the way up.
    await run(`UPDATE drops SET cancelled_at = now() WHERE id IN ('${live}', '${unpaced}')`);
    expect((await up(t.db)).applied).toEqual(['0049_live_pace', '0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await one(`SELECT count(*)::int AS n FROM live_entries WHERE admitted_at IS NOT NULL`)).toEqual({ n: 0 });
    for (const id of [draw, live, child, unpaced]) expect(await pace(id)).toEqual({ pace_batch: null, pace_minutes: null, pace_paused_at: null, pace_next_at: null, pace_batches: 0 });

    // The rows of this test taken away.
    await run(`DELETE FROM live_entries WHERE drop_id = '${live}'`);
    await run(`DELETE FROM drop_sizes WHERE drop_id = '${live}'`);
    await run(`DELETE FROM drops WHERE id IN ('${child}', '${unpaced}')`);
    await run(`DELETE FROM drops WHERE id IN ('${live}', '${draw}')`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`DELETE FROM accounts WHERE id IN (${accounts.map((a) => `'${a}'`).join(', ')})`);
  });

  it('0050 adds the founding list (preregistrations, its indexes and its identity guard), LANDING to the links\' destinations and a draw\'s segment to drops_draw_plus, and nothing else; down restores 0049 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0050_founding_list');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new table's too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const ofTable = (o: string) => /\bpreregistrations\b/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    expect(before.filter(ofTable)).toEqual([]);
    // Outside the new table, only the two constraints it re-creates changed.
    expect(removed.map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint drops drops_draw_plus', 'constraint links links_destination_check']);
    expect(added.filter((o) => !ofTable(o)).map((o) => o.split(' ').slice(0, 3).join(' '))).toEqual(['constraint drops drops_draw_plus', 'constraint links links_destination_check']);
    // drops_draw_plus: 0023's rule, a draw's segment taken out of it and nothing else.
    const drawPlus = (list: string[]) => list.find((o) => o.startsWith('constraint drops drops_draw_plus '))!;
    expect(drawPlus(removed)).toContain('(access_segment_id IS NULL)');
    expect(drawPlus(added)).not.toContain('access_segment_id');
    expect(drawPlus(added)).toBe(drawPlus(removed).replace(' AND (access_segment_id IS NULL)', ''));
    for (const c of ['parent_drop_id', 'after_room_delay_minutes', 'after_room_length_minutes', 'surprise_enabled', 'surprise_text', 'min_participations', 'access_combine', 'question_enabled', 'question_text', 'question_answers']) {
      expect(drawPlus(added), c).toContain(`(${c} IS NULL)`);
    }
    // links_destination_check: 0043's seven destinations, and LANDING.
    const destinations = (list: string[]) => [...list.find((o) => o.startsWith('constraint links links_destination_check '))!.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(destinations(removed)).toEqual(['CLUB', 'COLLECTION', 'HOW', 'MODEL', 'NOW', 'RELEASE', 'RELEASES']);
    expect(destinations(added)).toEqual([...destinations(removed), 'LANDING'].sort());
    // The table: its columns, its constraints, its four indexes and its guard.
    const table = added.filter((o) => o.startsWith('table preregistrations '));
    expect(table.map((o) => o.split(' ').slice(2).join(' ')).sort()).toEqual([
      'account_id uuid YES ',
      'consent_at timestamp with time zone NO ',
      'consent_version text NO ',
      'country character NO ',
      'created_at timestamp with time zone NO now()',
      'email text NO ',
      'email_normalized text NO ',
      'first_name text NO ',
      'id uuid NO gen_random_uuid()',
      'matched_at timestamp with time zone YES ',
      'source_id integer NO ',
      'unsubscribed_at timestamp with time zone YES ',
    ]);
    for (const c of [
      /^constraint preregistrations preregistrations_pkey PRIMARY KEY \(id\)$/,
      /^constraint preregistrations preregistrations_email_normalized_key UNIQUE \(email_normalized\)$/,
      /^constraint preregistrations preregistrations_email_check CHECK /,
      /^constraint preregistrations preregistrations_email_normalized_check CHECK /,
      /^constraint preregistrations preregistrations_first_name_check CHECK .*80/,
      /^constraint preregistrations preregistrations_country_check CHECK /,
      /^constraint preregistrations preregistrations_consent_version_check CHECK /,
      /^constraint preregistrations preregistrations_matched CHECK \(\(\(account_id IS NULL\) = \(matched_at IS NULL\)\)\)$/,
      /^constraint preregistrations preregistrations_source_id_fkey FOREIGN KEY \(source_id\) REFERENCES acquisition_sources\(id\) ON DELETE RESTRICT$/,
      /^constraint preregistrations preregistrations_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('constraint preregistrations '))).toHaveLength(10);
    expect(added.filter((o) => o.startsWith('index '))).toHaveLength(4);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger preregistrations preregistrations_immutable_identity']);
    expect((await up(t.db)).applied).toEqual(['0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  it('0050: a pre-registration with its address once, a first name of 1 to 80 trimmed characters, a country, its consent and its version, a source, its account and match both or neither, its identity never changed; a LANDING link naming neither a release nor a model; a draw with a segment and still no other LIVE setting, an after-room still without one; down refused while any exists, naming the counts', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const insert = (table: string, all: Record<string, string>) => run(`INSERT INTO ${table} (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    const source = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, site, key) VALUES ('SITE', 'founding-0050.test', 'S:founding-0050.test') RETURNING id`)).id;
    const other = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, site, key) VALUES ('SITE', 'other-0050.test', 'S:other-0050.test') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('lea-0050@example.com', 'lea-0050@example.com', 'scrypt$x') RETURNING id`)).id;

    // A pre-registration, as the founding list writes it.
    const prereg = (cols: Record<string, string> = {}) =>
      insert('preregistrations', {
        email: `'Lea-0050@Example.com'`, email_normalized: `'lea-0050@example.com'`, first_name: `'Léa'`, country: `'FR'`, consent_at: `'2026-10-21T08:00:00Z'`, consent_version: `'2026-10-21'`,
        source_id: `${source}`, ...cols,
      });
    for (const [cols, label, constraint] of [
      [{ email: `''` }, 'an empty address', 'preregistrations_email_check'],
      [{ email: `' lea@example.com'` }, 'an address not trimmed', 'preregistrations_email_check'],
      [{ email: `'${'a'.repeat(243)}@example.com'` }, 'an address of 255 characters', 'preregistrations_email_check'],
      [{ email_normalized: `'ab'` }, 'a lookup key of 2 characters', 'preregistrations_email_normalized_check'],
      [{ first_name: `''` }, 'no first name', 'preregistrations_first_name_check'],
      [{ first_name: `' Léa'` }, 'a first name not trimmed', 'preregistrations_first_name_check'],
      [{ first_name: `'${'é'.repeat(81)}'` }, 'a first name of 81 characters', 'preregistrations_first_name_check'],
      [{ first_name: `'Léa<b>'` }, 'a first name with < >', 'preregistrations_first_name_check'],
      [{ first_name: `'L' || chr(10) || 'a'` }, 'a first name with a line break', 'preregistrations_first_name_check'],
      [{ country: `'fr'` }, 'a country in lower case', 'preregistrations_country_check'],
      [{ country: `'F1'` }, 'a country with a figure', 'preregistrations_country_check'],
      [{ consent_version: `'21/10/2026'` }, 'a consent version not a date', 'preregistrations_consent_version_check'],
      [{ account_id: `'${account}'` }, 'an account without its match', 'preregistrations_matched'],
      [{ matched_at: 'now()' }, 'a match without its account', 'preregistrations_matched'],
    ] as const) {
      await check(prereg(cols), label, constraint);
    }
    for (const column of ['consent_at', 'consent_version', 'source_id', 'first_name', 'country']) {
      await expect(prereg({ [column]: 'NULL' }), `no ${column}`).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    }
    await expect(prereg({ source_id: '2147483647' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(prereg({ account_id: 'gen_random_uuid()', matched_at: 'now()' })).rejects.toSatisfy(isForeignKeyViolation);
    await prereg();
    // The same address again, in any case: refused by its lookup key (the service leaves the row as it was).
    await expect(prereg({ email: `'LEA-0050@EXAMPLE.COM'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'preregistrations_email_normalized_key'));
    // The bounds: 80 characters of any script; a row matched at once to its account.
    await prereg({ email: `'max-0050@example.com'`, email_normalized: `'max-0050@example.com'`, first_name: `'${'é'.repeat(80)}'`, account_id: `'${account}'`, matched_at: 'now()' });
    const row = await one<Record<string, unknown>>(`SELECT id, first_name, country, consent_version, account_id, matched_at, unsubscribed_at, created_at FROM preregistrations WHERE email_normalized = 'lea-0050@example.com'`);
    expect(row).toEqual({ id: expect.any(String), first_name: 'Léa', country: 'FR', consent_version: '2026-10-21', account_id: null, matched_at: null, unsubscribed_at: null, created_at: expect.any(Date) });
    // Matched at the sign-up, then unsubscribed: the row stays; its identity, address, consent, source and creation never change.
    await run(`UPDATE preregistrations SET account_id = '${account}', matched_at = now() WHERE id = '${row.id}'`);
    await run(`UPDATE preregistrations SET unsubscribed_at = now() WHERE id = '${row.id}'`);
    for (const sets of [`email = 'other-0050@example.com'`, `email_normalized = 'other-0050@example.com'`, `consent_at = now()`, `consent_version = '2026-10-22'`, `source_id = ${other}`, `created_at = now()`, `id = gen_random_uuid()`]) {
      await expect(run(`UPDATE preregistrations SET ${sets} WHERE id = '${row.id}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await check(run(`UPDATE preregistrations SET matched_at = NULL WHERE id = '${row.id}'`), 'the match taken away, its account kept', 'preregistrations_matched');

    // A LANDING link: theorbes.com, naming neither a release nor a model.
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('links-0050@orbes.test', 'links-0050@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const channel = (await one<{ id: string }>(`INSERT INTO link_channels (name, position) VALUES ('Founding 0050', 10) RETURNING id`)).id;
    await run(`INSERT INTO categories (id, code, name) VALUES (14, 'P', 'Pace checks') ON CONFLICT DO NOTHING`);
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (14, 'F', 'RING', 'FOUNDCHK') RETURNING id`)).id;
    const link = (cols: Record<string, string>) => insert('links', { code: `'founding-0050'`, name: `'theorbes.com'`, channel_id: `'${channel}'`, destination: `'LANDING'`, created_by: `'${admin}'`, ...cols });
    await check(link({ destination: `'THEORBES'` }), 'an unknown destination', 'links_destination_check');
    await check(link({ model_id: `'${model}'` }), 'a model named for LANDING', 'links_destination');

    // A draw with a segment; its other LIVE-only settings still refused; an after-room still without a segment.
    const segment = (await one<{ id: string }>(`INSERT INTO segments (name, criteria) VALUES ('Founding list 0050', '{"rule":"FOUNDING_LIST"}') RETURNING id`)).id;
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const draw = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
      VALUES (${model}, 'Draw', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}) RETURNING id`.execute(t.db)).rows[0].id;
    const set = (sets: string, id = draw) => run(`UPDATE drops SET ${sets} WHERE id = '${id}'`);
    await expect(set(`access_segment_id = gen_random_uuid()`)).rejects.toSatisfy(isForeignKeyViolation);
    await set(`access_segment_id = '${segment}'`);
    for (const sets of [`access_combine = 'AND'`, `min_participations = 1`, `surprise_enabled = false`, `question_enabled = false`]) {
      await check(set(sets), `a draw: ${sets}`, 'drops_draw_plus');
    }
    const live = await liveDrop(model, { access_segment_id: `'${segment}'` });
    const child = await liveDrop(model, { ...AFTER_ROOM(live) });
    await check(set(`access_segment_id = '${segment}'`, child), 'an after-room with a segment', 'drops_after_room');
    await link({});

    // Down refuses while a pre-registration, a LANDING link or a draw with a segment exists, naming the counts (the LIVE
    // release's segment does not count); this database stays at 0050 (0053, 0052 and 0051, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    await expect(down(t.db)).rejects.toThrow(/0050_founding_list cannot be rolled back: 2 pre-registrations, 1 LANDING links and 1 draws with a segment exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0050_founding_list')?.executedAt).toBeDefined();
    await run(`DELETE FROM preregistrations WHERE source_id = ${source}`);
    await expect(down(t.db)).rejects.toThrow(/0050_founding_list cannot be rolled back: 0 pre-registrations, 1 LANDING links and 1 draws with a segment exist/);
    await run(`DELETE FROM links WHERE code = 'founding-0050'`);
    await expect(down(t.db)).rejects.toThrow(/0050_founding_list cannot be rolled back: 0 pre-registrations, 0 LANDING links and 1 draws with a segment exist/);
    await set(`access_segment_id = NULL`);
    expect((await down(t.db)).reverted).toEqual(['0050_founding_list']);
    // At 0049 again: no LANDING, and a draw's segment refused, as 0043 and 0023 held them.
    await check(link({}), 'LANDING at 0049', 'links_destination_check');
    await check(set(`access_segment_id = '${segment}'`), 'a draw\'s segment at 0049', 'drops_draw_plus');
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the release, written without one,
    // is cancelled before the way up.
    await run(`UPDATE drops SET cancelled_at = now() WHERE id = '${live}'`);
    expect((await up(t.db)).applied).toEqual(['0050_founding_list', '0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    await run(`DELETE FROM drops WHERE id = '${child}'`);
    await run(`DELETE FROM drops WHERE id IN ('${live}', '${draw}')`);
    await run(`DELETE FROM segments WHERE id = '${segment}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    await run(`DELETE FROM link_channels WHERE id = '${channel}'`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
    await run(`DELETE FROM acquisition_sources WHERE id IN (${source}, ${other})`);
  });

  it('0051 adds the emails (email_templates, email_outbox, email_preferences, email_state, their indexes and the outbox\'s guard) and a recovery code sent by email (issued_via, created_by NULL exactly then), and nothing else; down restores 0050 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0051_emails');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new tables' too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const ofTables = (o: string) => /\bemail_(templates|outbox|preferences|state)\b/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    expect(before.filter(ofTables)).toEqual([]);
    // Outside the new tables, only the recovery codes changed: created_by NULL, issued_via and its two CHECKs.
    expect(removed).toEqual(['table account_recovery_codes created_by uuid NO ']);
    expect(added.filter((o) => !ofTables(o))).toEqual([
      'constraint account_recovery_codes account_recovery_codes_issued_by CHECK (((issued_via = \'STAFF\'::text) = (created_by IS NOT NULL)))',
      'constraint account_recovery_codes account_recovery_codes_issued_via_check CHECK ((issued_via = ANY (ARRAY[\'STAFF\'::text, \'EMAIL\'::text])))',
      'table account_recovery_codes created_by uuid YES ',
      'table account_recovery_codes issued_via text NO \'STAFF\'::text',
    ]);
    // The kinds, in both tables: schema.ts's EMAIL_KINDS; the statuses: EMAIL_STATUSES.
    const literals = (name: string) => [...added.find((o) => o.split(' ')[2] === name)!.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
    expect(literals('email_templates_kind_check')).toEqual([...EMAIL_KINDS]);
    expect(literals('email_outbox_kind_check')).toEqual([...EMAIL_KINDS]);
    expect(literals('email_outbox_status_check')).toEqual([...EMAIL_STATUSES]);
    expect(literals('account_recovery_codes_issued_via_check')).toEqual([...RECOVERY_ISSUED_VIA]);
    // The four tables: their columns.
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ').slice(2).join(' ')).sort();
    expect(columns('email_templates')).toEqual([
      'body text YES ',
      'enabled boolean NO false',
      'kind text NO ',
      'subject text YES ',
      'updated_at timestamp with time zone NO now()',
      'updated_by uuid NO ',
    ]);
    expect(columns('email_outbox')).toEqual([
      'account_id uuid YES ',
      'attempts smallint NO 0',
      'body_html text NO ',
      'body_text text NO ',
      'created_at timestamp with time zone NO now()',
      'dedupe_key text NO ',
      'id uuid NO gen_random_uuid()',
      'kind text NO ',
      'last_error text YES ',
      'not_before timestamp with time zone NO now()',
      'preregistration_id uuid YES ',
      'sent_at timestamp with time zone YES ',
      'settled_at timestamp with time zone YES ',
      'status text NO \'QUEUED\'::text',
      'subject text NO ',
      'to_address text NO ',
    ]);
    expect(columns('email_preferences')).toEqual(['account_id uuid NO ', 'changed_at timestamp with time zone NO now()', 'release_notices boolean NO false']);
    expect(columns('email_state')).toEqual(['id smallint NO 1', 'releases_until timestamp with time zone NO ']);
    // Their constraints, indexes and the one guard.
    for (const c of [
      /^constraint email_templates email_templates_pkey PRIMARY KEY \(kind\)$/,
      /^constraint email_templates email_templates_subject_check CHECK .*150/,
      /^constraint email_templates email_templates_body_check CHECK .*5000/,
      /^constraint email_templates email_templates_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint email_outbox email_outbox_pkey PRIMARY KEY \(id\)$/,
      /^constraint email_outbox email_outbox_dedupe_key UNIQUE \(dedupe_key\)$/,
      /^constraint email_outbox email_outbox_dedupe_key_check CHECK .*200/,
      /^constraint email_outbox email_outbox_to_address_check CHECK .*254/,
      /^constraint email_outbox email_outbox_subject_check CHECK .*300/,
      /^constraint email_outbox email_outbox_body_text_check CHECK /,
      /^constraint email_outbox email_outbox_body_html_check CHECK /,
      /^constraint email_outbox email_outbox_attempts_check CHECK \(\(attempts >= 0\)\)$/,
      /^constraint email_outbox email_outbox_last_error_check CHECK .*300/,
      /^constraint email_outbox email_outbox_subject CHECK \(\(num_nonnulls\(account_id, preregistration_id\) <= 1\)\)$/,
      /^constraint email_outbox email_outbox_sent CHECK \(\(\(status = 'SENT'::text\) = \(sent_at IS NOT NULL\)\)\)$/,
      /^constraint email_outbox email_outbox_settled CHECK \(\(\(status = 'QUEUED'::text\) = \(settled_at IS NULL\)\)\)$/,
      /^constraint email_outbox email_outbox_failed CHECK \(\(\(status <> 'FAILED'::text\) OR \(last_error IS NOT NULL\)\)\)$/,
      /^constraint email_outbox email_outbox_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint email_outbox email_outbox_preregistration_id_fkey FOREIGN KEY \(preregistration_id\) REFERENCES preregistrations\(id\) ON DELETE RESTRICT$/,
      /^constraint email_preferences email_preferences_pkey PRIMARY KEY \(account_id\)$/,
      /^constraint email_preferences email_preferences_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint email_state email_state_pkey PRIMARY KEY \(id\)$/,
      /^constraint email_state email_state_id_check CHECK \(\(id = 1\)\)$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('constraint email_templates '))).toHaveLength(5);
    expect(added.filter((o) => o.startsWith('constraint email_outbox '))).toHaveLength(17);
    expect(added.filter((o) => o.startsWith('constraint email_preferences '))).toHaveLength(2);
    expect(added.filter((o) => o.startsWith('constraint email_state '))).toHaveLength(2);
    expect(added.filter((o) => o.startsWith('index ')).map((o) => o.split(' ').find((w, i, all) => all[i - 1] === 'INDEX')).sort()).toEqual([
      'email_outbox_account_idx', 'email_outbox_dedupe_key', 'email_outbox_due', 'email_outbox_pkey', 'email_outbox_preregistration_idx', 'email_preferences_pkey', 'email_state_pkey', 'email_templates_pkey', 'email_templates_updated_by_idx',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger email_outbox email_outbox_immutable_content']);
    expect((await up(t.db)).applied).toEqual(['0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  it('0051: a template per kind, off by default, its subject one trimmed line of 1 to 150 characters and its body of 1 to 5 000, by a console member; an email once per key, for an account or a pre-registration or neither, its address and subject one line, its words never changed, sent and settled exactly with their status, a failure with its error; a collector\'s release notices off by default; one state row; a recovery code by Client Services as the previous image writes it, or by email by no one; down refused while any exists, naming the counts', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const insert = (table: string, all: Record<string, string>) => run(`INSERT INTO ${table} (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('emails-0051@orbes.test', 'emails-0051@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('lea-0051@example.com', 'lea-0051@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('max-0051@example.com', 'max-0051@example.com', 'scrypt$x') RETURNING id`)).id;
    const source = (await one<{ id: number }>(`INSERT INTO acquisition_sources (kind, site, key) VALUES ('SITE', 'emails-0051.test', 'S:emails-0051.test') RETURNING id`)).id;
    const prereg = (
      await one<{ id: string }>(
        `INSERT INTO preregistrations (email, email_normalized, first_name, country, consent_at, consent_version, source_id) VALUES ('ana-0051@example.com', 'ana-0051@example.com', 'Ana', 'PT', now(), '2026-10-21', ${source}) RETURNING id`,
      )
    ).id;

    // A template: one per kind, off and with the default words until the console writes them.
    const template = (cols: Record<string, string> = {}) => insert('email_templates', { kind: `'RELEASE_NOTICE'`, updated_by: `'${admin}'`, ...cols });
    for (const [cols, label, constraint] of [
      [{ kind: `'HOUSE_MESSAGE'` }, 'an unknown kind (E6: house messages have none)', 'email_templates_kind_check'],
      [{ subject: `''` }, 'an empty subject', 'email_templates_subject_check'],
      [{ subject: `' A release'` }, 'a subject not trimmed', 'email_templates_subject_check'],
      [{ subject: `'A release' || chr(13) || chr(10) || 'Bcc: x@example.com'` }, 'a subject with a line break', 'email_templates_subject_check'],
      [{ subject: `'${'é'.repeat(151)}'` }, 'a subject of 151 characters', 'email_templates_subject_check'],
      [{ body: `''` }, 'an empty body', 'email_templates_body_check'],
      [{ body: `'${'é'.repeat(5001)}'` }, 'a body of 5 001 characters', 'email_templates_body_check'],
    ] as const) {
      await check(template(cols), label, constraint);
    }
    await nullRefused(template({ updated_by: 'NULL' }), 'a template by no one');
    await expect(template({ updated_by: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await template();
    expect(await one(`SELECT enabled, subject, body FROM email_templates WHERE kind = 'RELEASE_NOTICE'`)).toEqual({ enabled: false, subject: null, body: null });
    await expect(template()).rejects.toSatisfy((e) => isUniqueViolation(e, 'email_templates_pkey'));
    await template({ kind: `'FOUNDING_ANNOUNCEMENT'`, enabled: 'true', subject: `'${'é'.repeat(150)}'`, body: `'Dear {firstName},' || chr(10) || '${'é'.repeat(4980)}'` });

    // An email in the outbox, rendered at enqueue.
    const email = (cols: Record<string, string> = {}) =>
      insert('email_outbox', {
        kind: `'ORDER_SHIPPED'`, dedupe_key: `'E4:SHIPPED:0051'`, account_id: `'${account}'`, to_address: `'lea-0051@example.com'`, subject: `'Your order is on its way'`, body_text: `'Your order is on its way.'`,
        body_html: `'<p>Your order is on its way.</p>'`, ...cols,
      });
    for (const [cols, label, constraint] of [
      [{ kind: `'HOUSE_MESSAGE'` }, 'an unknown kind', 'email_outbox_kind_check'],
      [{ dedupe_key: `''` }, 'an empty key', 'email_outbox_dedupe_key_check'],
      [{ dedupe_key: `'${'k'.repeat(201)}'` }, 'a key of 201 characters', 'email_outbox_dedupe_key_check'],
      [{ preregistration_id: `'${prereg}'` }, 'for an account and a pre-registration', 'email_outbox_subject'],
      [{ to_address: `''` }, 'no address', 'email_outbox_to_address_check'],
      [{ to_address: `' lea-0051@example.com'` }, 'an address not trimmed', 'email_outbox_to_address_check'],
      [{ to_address: `'lea-0051@example.com' || chr(10) || 'Bcc: x@example.com'` }, 'an address with a line break', 'email_outbox_to_address_check'],
      [{ to_address: `'${'a'.repeat(243)}@example.com'` }, 'an address of 255 characters', 'email_outbox_to_address_check'],
      [{ subject: `''` }, 'an empty subject', 'email_outbox_subject_check'],
      [{ subject: `'On its way' || chr(13) || chr(10) || 'Bcc: x@example.com'` }, 'a subject with a line break', 'email_outbox_subject_check'],
      [{ subject: `'${'é'.repeat(301)}'` }, 'a subject of 301 characters', 'email_outbox_subject_check'],
      [{ body_text: `''` }, 'no plain words', 'email_outbox_body_text_check'],
      [{ body_html: `''` }, 'no HTML words', 'email_outbox_body_html_check'],
      [{ status: `'DRAFT'`, settled_at: 'now()' }, 'an unknown status', 'email_outbox_status_check'],
      [{ attempts: '-1' }, 'attempts below 0', 'email_outbox_attempts_check'],
      [{ last_error: `''` }, 'an empty error', 'email_outbox_last_error_check'],
      [{ last_error: `'${'e'.repeat(301)}'` }, 'an error of 301 characters', 'email_outbox_last_error_check'],
      [{ status: `'SENT'`, settled_at: 'now()' }, 'sent without its time', 'email_outbox_sent'],
      [{ sent_at: 'now()' }, 'a queued email with a sending time', 'email_outbox_sent'],
      [{ settled_at: 'now()' }, 'a queued email settled', 'email_outbox_settled'],
      [{ status: `'CANCELLED'` }, 'cancelled without its time', 'email_outbox_settled'],
      [{ status: `'FAILED'`, settled_at: 'now()' }, 'failed without its error', 'email_outbox_failed'],
    ] as const) {
      await check(email(cols), label, constraint);
    }
    for (const column of ['kind', 'dedupe_key', 'to_address', 'subject', 'body_text', 'body_html']) await nullRefused(email({ [column]: 'NULL' }), `no ${column}`);
    await expect(email({ account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(email({ account_id: 'NULL', preregistration_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await email();
    const queued = await one<Record<string, unknown>>(`SELECT id, status, attempts, last_error, sent_at, settled_at, not_before <= now() AS due FROM email_outbox WHERE dedupe_key = 'E4:SHIPPED:0051'`);
    expect(queued).toEqual({ id: expect.any(String), status: 'QUEUED', attempts: 0, last_error: null, sent_at: null, settled_at: null, due: true });
    // Once per key: the same trigger again is refused (the service writes nothing more).
    await expect(email()).rejects.toSatisfy((e) => isUniqueViolation(e, 'email_outbox_dedupe_key'));
    // For a pre-registration (E1, at the release's opening), and for neither (the console's test to itself).
    await email({ kind: `'FOUNDING_ANNOUNCEMENT'`, dedupe_key: `'E1:0051'`, account_id: 'NULL', preregistration_id: `'${prereg}'`, to_address: `'ana-0051@example.com'`, not_before: `now() + interval '1 day'` });
    await email({ kind: `'RELEASE_NOTICE'`, dedupe_key: `'TEST:0051'`, account_id: 'NULL', to_address: `'emails-0051@orbes.test'` });
    // Tried, retried, then sent; another given up with its error; another cancelled.
    const set = (sets: string, key = 'E4:SHIPPED:0051') => run(`UPDATE email_outbox SET ${sets} WHERE dedupe_key = '${key}'`);
    await set(`attempts = 1, last_error = 'connection refused', not_before = now() + interval '1 minute'`);
    await set(`status = 'SENT', attempts = 2, sent_at = now(), settled_at = now()`);
    await set(`status = 'FAILED', attempts = 5, last_error = '550 mailbox unavailable', settled_at = now()`, 'TEST:0051');
    await set(`status = 'CANCELLED', settled_at = now()`, 'E1:0051');
    await check(set(`sent_at = NULL`), 'a sent email without its time', 'email_outbox_sent');
    await check(set(`status = 'QUEUED', sent_at = NULL`), 'a sent email queued again with its settling', 'email_outbox_settled');
    // What was sent never changes.
    for (const sets of [`subject = 'Other'`, `to_address = 'other-0051@example.com'`, `body_text = 'Other.'`, `body_html = '<p>Other.</p>'`, `kind = 'ORDER_DELIVERED'`, `dedupe_key = 'E4:OTHER'`, `account_id = '${other}'`, `created_at = now()`, `id = gen_random_uuid()`]) {
      await expect(set(sets), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(set(`account_id = NULL, preregistration_id = '${prereg}'`, 'TEST:0051')).rejects.toSatisfy(isGuardViolation);

    // A collector's release notices: opt-in, one row per account.
    await expect(insert('email_preferences', { account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await insert('email_preferences', { account_id: `'${account}'` });
    expect(await one(`SELECT release_notices, changed_at IS NOT NULL AS changed FROM email_preferences WHERE account_id = '${account}'`)).toEqual({ release_notices: false, changed: true });
    await expect(insert('email_preferences', { account_id: `'${account}'`, release_notices: 'true' })).rejects.toSatisfy((e) => isUniqueViolation(e, 'email_preferences_pkey'));
    await run(`UPDATE email_preferences SET release_notices = true, changed_at = now() WHERE account_id = '${account}'`);

    // One state row, the sender's; the migration writes none.
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM email_state`)).n).toBe(0);
    await check(insert('email_state', { id: '2', releases_until: 'now()' }), 'a second state row', 'email_state_id_check');
    await nullRefused(insert('email_state', { releases_until: 'NULL' }), 'no watermark');
    await insert('email_state', { releases_until: 'now()' });
    expect(await one(`SELECT id FROM email_state`)).toEqual({ id: 1 });

    // A recovery code: issued by Client Services as the previous image writes it (STAFF by DEFAULT), or sent by email by no one.
    const code = (who: string, cols: Record<string, string> = {}) =>
      insert('account_recovery_codes', { account_id: `'${who}'`, code_hash: `'scrypt$x'`, expires_at: `now() + interval '30 minutes'`, ...cols });
    await code(account, { created_by: `'${admin}'`, used_at: 'now()' });
    expect(await one(`SELECT issued_via, created_by FROM account_recovery_codes WHERE account_id = '${account}'`)).toEqual({ issued_via: 'STAFF', created_by: admin });
    await check(code(other), 'a code by Client Services without its ADMIN', 'account_recovery_codes_issued_by');
    await check(code(other, { issued_via: `'EMAIL'`, created_by: `'${admin}'` }), 'a code sent by email with an ADMIN', 'account_recovery_codes_issued_by');
    await check(code(other, { issued_via: `'SMS'` }), 'an unknown way', 'account_recovery_codes_issued_via_check');
    await code(other, { issued_via: `'EMAIL'` });
    // One open code per account, whoever issued it (0005's rule).
    await expect(code(other, { created_by: `'${admin}'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'account_recovery_codes_single_open'));

    // Down refuses while a template, an email, a preference or a code sent by email exists, naming the counts; the state
    // row does not count; this database stays at 0051 (0053 and 0052, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    await expect(down(t.db)).rejects.toThrow(/0051_emails cannot be rolled back: 2 email templates, 3 emails, 1 email preferences and 1 recovery codes sent by email exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0051_emails')?.executedAt).toBeDefined();
    await run(`DELETE FROM email_templates`);
    await expect(down(t.db)).rejects.toThrow(/0051_emails cannot be rolled back: 0 email templates, 3 emails, 1 email preferences and 1 recovery codes sent by email exist/);
    // The purge deletes a settled email.
    await run(`DELETE FROM email_outbox`);
    await expect(down(t.db)).rejects.toThrow(/0051_emails cannot be rolled back: 0 email templates, 0 emails, 1 email preferences and 1 recovery codes sent by email exist/);
    await run(`DELETE FROM email_preferences`);
    await expect(down(t.db)).rejects.toThrow(/0051_emails cannot be rolled back: 0 email templates, 0 emails, 0 email preferences and 1 recovery codes sent by email exist/);
    await run(`DELETE FROM account_recovery_codes WHERE issued_via = 'EMAIL'`);
    expect((await down(t.db)).reverted).toEqual(['0051_emails']);
    // At 0050 again: the Client Services code kept with its ADMIN, and a code by no one refused, as 0005 held it.
    expect(await one(`SELECT created_by FROM account_recovery_codes WHERE account_id = '${account}'`)).toEqual({ created_by: admin });
    await nullRefused(code(other), 'a code by no one at 0050');
    expect((await up(t.db)).applied).toEqual(['0051_emails', '0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await one(`SELECT issued_via FROM account_recovery_codes WHERE account_id = '${account}'`)).toEqual({ issued_via: 'STAFF' });

    // The rows of this test taken away.
    await run(`DELETE FROM account_recovery_codes WHERE account_id IN ('${account}', '${other}')`);
    await run(`DELETE FROM preregistrations WHERE id = '${prereg}'`);
    await run(`DELETE FROM acquisition_sources WHERE id = ${source}`);
    await run(`DELETE FROM accounts WHERE id IN ('${account}', '${other}')`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  it('0052 adds house messages (house_moment_settings, house_messages, house_deliveries, their indexes and guards), and nothing else; down restores 0051 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0052_house_messages');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new tables' too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const ofTables = (o: string) => /\bhouse_(moment_settings|messages|deliveries)\b/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    expect(before.filter(ofTables)).toEqual([]);
    // Nothing outside the three tables changed.
    expect(removed).toEqual([]);
    expect(added.filter((o) => !ofTables(o))).toEqual([]);
    // The moments in both tables: schema.ts's HOUSE_MOMENTS; the statuses: HOUSE_MESSAGE_STATUSES; the sources: HOUSE_DELIVERY_SOURCES.
    const literals = (name: string) => [...added.find((o) => o.split(' ')[2] === name)!.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
    expect(literals('house_moment_settings_moment_check')).toEqual([...HOUSE_MOMENTS]);
    expect(literals('house_deliveries_moment_check')).toEqual([...HOUSE_MOMENTS]);
    expect(literals('house_messages_status_check')).toEqual([...HOUSE_MESSAGE_STATUSES]);
    // (0061 adds VAULT to the sources: 0052 wrote the first two.)
    expect(literals('house_deliveries_source_check')).toEqual(HOUSE_DELIVERY_SOURCES.filter((x) => x !== 'VAULT'));
    // The three tables: their columns.
    const columns = (table: string) => added.filter((o) => o.startsWith(`table ${table} `)).map((o) => o.split(' ').slice(2).join(' ')).sort();
    expect(columns('house_moment_settings')).toEqual([
      'body text YES ',
      'enabled boolean NO false',
      'enabled_at timestamp with time zone YES ',
      'moment text NO ',
      'title text YES ',
      'updated_at timestamp with time zone NO now()',
      'updated_by uuid NO ',
    ]);
    expect(columns('house_messages')).toEqual([
      'audience_label text YES ',
      'audience_min_tier smallint YES ',
      'audience_segment_id uuid YES ',
      'body text NO ',
      'cancelled_at timestamp with time zone YES ',
      'cancelled_by uuid YES ',
      'created_at timestamp with time zone NO now()',
      'created_by uuid NO ',
      'id uuid NO gen_random_uuid()',
      'reach integer YES ',
      'send_at timestamp with time zone YES ',
      'sent_at timestamp with time zone YES ',
      'sent_by uuid YES ',
      'status text NO \'DRAFT\'::text',
      'title text NO ',
      'updated_at timestamp with time zone NO now()',
      'updated_by uuid NO ',
    ]);
    expect(columns('house_deliveries')).toEqual([
      'account_id uuid NO ',
      'body text YES ',
      'dedupe_key text NO ',
      'delivered_at timestamp with time zone NO now()',
      'house_message_id uuid YES ',
      'id uuid NO gen_random_uuid()',
      'moment text YES ',
      'piece_ref text YES ',
      'read_at timestamp with time zone YES ',
      'source text NO ',
      'title text YES ',
    ]);
    // Their constraints, indexes and guards.
    for (const c of [
      /^constraint house_moment_settings house_moment_settings_pkey PRIMARY KEY \(moment\)$/,
      /^constraint house_moment_settings house_moment_settings_title_check CHECK .*80/,
      /^constraint house_moment_settings house_moment_settings_body_check CHECK .*2000/,
      /^constraint house_moment_settings house_moment_settings_enabled CHECK \(\(enabled = \(enabled_at IS NOT NULL\)\)\)$/,
      /^constraint house_moment_settings house_moment_settings_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint house_messages house_messages_pkey PRIMARY KEY \(id\)$/,
      /^constraint house_messages house_messages_title_check CHECK .*80/,
      /^constraint house_messages house_messages_body_check CHECK .*2000/,
      /^constraint house_messages house_messages_audience_min_tier_check CHECK \(\(\(audience_min_tier >= 1\) AND \(audience_min_tier <= 3\)\)\)$/,
      /^constraint house_messages house_messages_audience_label_check CHECK .*80/,
      /^constraint house_messages house_messages_reach_check CHECK \(\(reach >= 0\)\)$/,
      /^constraint house_messages house_messages_audience CHECK .*num_nonnulls\(audience_segment_id, audience_min_tier\) = 1/,
      /^constraint house_messages house_messages_label CHECK \(\(\(status <> 'SENT'::text\) OR \(audience_label IS NOT NULL\)\)\)$/,
      /^constraint house_messages house_messages_send_at CHECK /,
      /^constraint house_messages house_messages_sent CHECK /,
      /^constraint house_messages house_messages_cancelled CHECK /,
      /^constraint house_messages house_messages_sent_by CHECK /,
      /^constraint house_messages house_messages_audience_segment_id_fkey FOREIGN KEY \(audience_segment_id\) REFERENCES segments\(id\) ON DELETE RESTRICT$/,
      /^constraint house_messages house_messages_sent_by_fkey FOREIGN KEY \(sent_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint house_messages house_messages_cancelled_by_fkey FOREIGN KEY \(cancelled_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint house_messages house_messages_created_by_fkey FOREIGN KEY \(created_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint house_messages house_messages_updated_by_fkey FOREIGN KEY \(updated_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint house_deliveries house_deliveries_pkey PRIMARY KEY \(id\)$/,
      /^constraint house_deliveries house_deliveries_dedupe_key UNIQUE \(dedupe_key\)$/,
      /^constraint house_deliveries house_deliveries_dedupe_key_check CHECK .*200/,
      /^constraint house_deliveries house_deliveries_title_check CHECK .*400/,
      /^constraint house_deliveries house_deliveries_body_check CHECK .*8000/,
      /^constraint house_deliveries house_deliveries_piece_ref_check CHECK /,
      /^constraint house_deliveries house_deliveries_source CHECK /,
      /^constraint house_deliveries house_deliveries_piece CHECK /,
      /^constraint house_deliveries house_deliveries_read CHECK \(\(read_at >= delivered_at\)\)$/,
      /^constraint house_deliveries house_deliveries_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint house_deliveries house_deliveries_house_message_id_fkey FOREIGN KEY \(house_message_id\) REFERENCES house_messages\(id\) ON DELETE RESTRICT$/,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('constraint house_moment_settings '))).toHaveLength(6);
    expect(added.filter((o) => o.startsWith('constraint house_messages '))).toHaveLength(18);
    expect(added.filter((o) => o.startsWith('constraint house_deliveries '))).toHaveLength(13);
    expect(added.filter((o) => o.startsWith('index ')).map((o) => o.split(' ').find((w, i, all) => all[i - 1] === 'INDEX')).sort()).toEqual([
      'house_deliveries_account_idx', 'house_deliveries_dedupe_key', 'house_deliveries_message_idx', 'house_deliveries_moment_idx', 'house_deliveries_pkey', 'house_deliveries_unread_idx',
      'house_messages_audience_segment_idx', 'house_messages_cancelled_by_idx', 'house_messages_created_by_idx', 'house_messages_due', 'house_messages_pkey', 'house_messages_sent_by_idx',
      'house_messages_updated_by_idx', 'house_moment_settings_pkey', 'house_moment_settings_updated_by_idx',
    ]);
    expect(added.filter((o) => o.startsWith('trigger ')).sort()).toEqual([
      'trigger house_deliveries house_deliveries_immutable',
      'trigger house_deliveries house_deliveries_no_delete',
      'trigger house_deliveries house_deliveries_no_truncate',
      'trigger house_messages house_messages_immutable_identity',
      'trigger house_messages house_messages_no_delete',
      'trigger house_messages house_messages_sent_audience',
      'trigger house_messages house_messages_sent_immutable',
    ]);
    // Up again: a delivery's guard holds every column but read_at; a sent message's every column but its segment.
    const args = async (name: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${name}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    expect((await up(t.db)).applied).toEqual(['0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('house_deliveries_immutable')).toEqual(['id', 'account_id', 'source', 'moment', 'house_message_id', 'title', 'body', 'piece_ref', 'dedupe_key', 'delivered_at']);
    expect((await args('house_messages_sent_immutable')).sort()).toEqual(columns('house_messages').map((c) => c.split(' ')[0]).filter((c) => c !== 'audience_segment_id').sort());
  });

  it('0052: a moment\'s setting off by default, on exactly with its time, its words one trimmed line of 1 to 80 characters and 1 to 2 000, by a console member; a custom message to a segment or a tier, scheduled and sent with its times, reach and audience\'s name, never changed once sent but for its segment cleared, only a draft deleted; a delivery once per key, a moment with its words and its piece for a) and e), a custom message by reference, read never before delivered, never changed but its reading, never deleted; down refused while any exists, naming the counts', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const insert = (table: string, all: Record<string, string>) => run(`INSERT INTO ${table} (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')})`);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('house-0052@orbes.test', 'house-0052@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('lea-0052@example.com', 'lea-0052@example.com', 'scrypt$x') RETURNING id`)).id;
    const segment = (await one<{ id: string }>(`INSERT INTO segments (name, criteria, created_by) VALUES ('House 0052', '{}', '${admin}') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO segments (name, criteria, created_by) VALUES ('Other 0052', '{}', '${admin}') RETURNING id`)).id;

    // A moment's setting: one per moment, off and with the default words until the console writes them.
    const setting = (cols: Record<string, string> = {}) => insert('house_moment_settings', { moment: `'OWNERSHIP_YEAR'`, updated_by: `'${admin}'`, ...cols });
    for (const [cols, label, constraint] of [
      [{ moment: `'ANNIVERSARY'` }, 'an unknown moment', 'house_moment_settings_moment_check'],
      [{ enabled: 'true' }, 'on without its time', 'house_moment_settings_enabled'],
      [{ enabled_at: 'now()' }, 'off with a time', 'house_moment_settings_enabled'],
      [{ title: `''` }, 'an empty title', 'house_moment_settings_title_check'],
      [{ title: `' One year'` }, 'a title not trimmed', 'house_moment_settings_title_check'],
      [{ title: `'One' || chr(10) || 'year'` }, 'a title on two lines', 'house_moment_settings_title_check'],
      [{ title: `'${'é'.repeat(81)}'` }, 'a title of 81 characters', 'house_moment_settings_title_check'],
      [{ body: `''` }, 'empty words', 'house_moment_settings_body_check'],
      [{ body: `'  ' || chr(10) || ' '` }, 'blank words', 'house_moment_settings_body_check'],
      [{ body: `'${'é'.repeat(2001)}'` }, 'words of 2 001 characters', 'house_moment_settings_body_check'],
    ] as const) {
      await check(setting(cols), label, constraint);
    }
    await nullRefused(setting({ updated_by: 'NULL' }), 'a setting by no one');
    await expect(setting({ updated_by: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await setting();
    expect(await one(`SELECT enabled, enabled_at, title, body FROM house_moment_settings WHERE moment = 'OWNERSHIP_YEAR'`)).toEqual({ enabled: false, enabled_at: null, title: null, body: null });
    await expect(setting()).rejects.toSatisfy((e) => isUniqueViolation(e, 'house_moment_settings_pkey'));
    await setting({ moment: `'FIRST_REGISTRATION'`, enabled: 'true', enabled_at: 'now()', title: `'${'é'.repeat(80)}'`, body: `'{piece} is yours.' || chr(10) || chr(10) || '${'é'.repeat(1980)}'` });
    await check(run(`UPDATE house_moment_settings SET enabled = false WHERE moment = 'FIRST_REGISTRATION'`), 'off keeping its time', 'house_moment_settings_enabled');
    await run(`UPDATE house_moment_settings SET enabled = false, enabled_at = NULL WHERE moment = 'FIRST_REGISTRATION'`);

    // A custom message, to a segment or a tier.
    const message = (cols: Record<string, string> = {}) => {
      const all = { title: `'A word from ORBES'`, body: `'Dear {firstName},' || chr(10) || 'thank you.'`, audience_min_tier: '2', created_by: `'${admin}'`, updated_by: `'${admin}'`, ...cols };
      return one<{ id: string }>(`INSERT INTO house_messages (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`);
    };
    const sched = { status: `'SCHEDULED'`, send_at: `now() + interval '1 day'`, sent_by: `'${admin}'` };
    const sent = { status: `'SENT'`, send_at: 'now()', sent_at: 'now()', reach: '0', sent_by: `'${admin}'`, audience_label: `'PLATINE'` };
    for (const [cols, label, constraint] of [
      [{ status: `'ARCHIVED'` }, 'an unknown status', 'house_messages_status_check'],
      [{ audience_min_tier: 'NULL' }, 'a draft to no one', 'house_messages_audience'],
      [{ audience_segment_id: `'${segment}'` }, 'a draft to a segment and a tier', 'house_messages_audience'],
      [{ ...sched, audience_min_tier: 'NULL' }, 'scheduled to no one', 'house_messages_audience'],
      [{ audience_min_tier: '0' }, 'a tier below TITANE', 'house_messages_audience_min_tier_check'],
      [{ audience_min_tier: '4' }, 'a tier above PALLADIUM', 'house_messages_audience_min_tier_check'],
      [{ title: `''` }, 'an empty title', 'house_messages_title_check'],
      [{ title: `'${'é'.repeat(81)}'` }, 'a title of 81 characters', 'house_messages_title_check'],
      [{ body: `'${'é'.repeat(2001)}'` }, 'words of 2 001 characters', 'house_messages_body_check'],
      [{ audience_label: `' PLATINE'` }, 'an audience\'s name not trimmed', 'house_messages_audience_label_check'],
      [{ send_at: 'now()' }, 'a draft with a sending time', 'house_messages_send_at'],
      [{ ...sched, send_at: 'NULL' }, 'scheduled without its time', 'house_messages_send_at'],
      [{ sent_by: `'${admin}'` }, 'a draft sent by someone', 'house_messages_sent_by'],
      [{ ...sched, sent_by: 'NULL' }, 'scheduled by no one', 'house_messages_sent_by'],
      [{ ...sent, sent_at: 'NULL' }, 'sent without its time', 'house_messages_sent'],
      [{ ...sent, reach: 'NULL' }, 'sent without its reach', 'house_messages_sent'],
      [{ ...sent, reach: '-1' }, 'a reach below 0', 'house_messages_reach_check'],
      [{ ...sent, audience_label: 'NULL' }, 'sent without its audience\'s name', 'house_messages_label'],
      [{ reach: '0' }, 'a draft with a reach', 'house_messages_sent'],
      [{ status: `'CANCELLED'` }, 'cancelled without its time', 'house_messages_cancelled'],
      [{ status: `'CANCELLED'`, cancelled_at: 'now()' }, 'cancelled by no one', 'house_messages_cancelled'],
      [{ cancelled_at: 'now()', cancelled_by: `'${admin}'` }, 'a draft cancelled', 'house_messages_cancelled'],
    ] as const) {
      await check(message(cols), label, constraint);
    }
    await nullRefused(run(`INSERT INTO house_messages (body, audience_min_tier, created_by, updated_by) VALUES ('B', 1, '${admin}', '${admin}')`), 'no title');
    await nullRefused(run(`INSERT INTO house_messages (title, audience_min_tier, created_by, updated_by) VALUES ('A', 1, '${admin}', '${admin}')`), 'no words');
    await nullRefused(run(`INSERT INTO house_messages (title, body, audience_min_tier, updated_by) VALUES ('A', 'B', 1, '${admin}')`), 'a message by no one');
    await expect(message({ audience_min_tier: 'NULL', audience_segment_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    const draft = (await message({ audience_min_tier: 'NULL', audience_segment_id: `'${segment}'` })).id;
    expect(await one(`SELECT status, send_at, sent_at, reach, sent_by, audience_label FROM house_messages WHERE id = '${draft}'`)).toEqual({ status: 'DRAFT', send_at: null, sent_at: null, reach: null, sent_by: null, audience_label: null });
    // A draft is edited, moved to a tier, and its identity never changes.
    await run(`UPDATE house_messages SET title = 'A new word', audience_segment_id = NULL, audience_min_tier = 3 WHERE id = '${draft}'`);
    await run(`UPDATE house_messages SET audience_min_tier = NULL, audience_segment_id = '${segment}' WHERE id = '${draft}'`);
    for (const sets of [`created_at = now() - interval '1 day'`, `created_by = '${admin}', id = gen_random_uuid()`]) {
      await expect(run(`UPDATE house_messages SET ${sets} WHERE id = '${draft}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    // A segment named by a draft is not deleted.
    await expect(run(`DELETE FROM segments WHERE id = '${segment}'`)).rejects.toSatisfy(isForeignKeyViolation);
    // Scheduled, then sent: its time, its reach, its audience's name.
    await run(`UPDATE house_messages SET status = 'SCHEDULED', send_at = now() + interval '1 hour', sent_by = '${admin}' WHERE id = '${draft}'`);
    await run(`UPDATE house_messages SET send_at = now() + interval '2 hours' WHERE id = '${draft}'`);
    await check(run(`UPDATE house_messages SET status = 'SENT', sent_at = now(), reach = 1 WHERE id = '${draft}'`), 'sent without its audience\'s name', 'house_messages_label');
    await run(`UPDATE house_messages SET status = 'SENT', send_at = now(), sent_at = now(), reach = 1, audience_label = 'House 0052' WHERE id = '${draft}'`);
    // Once sent, nothing changes; its segment may only be cleared, never replaced; it is never deleted.
    for (const sets of [
      `title = 'Other'`, `body = 'Other.'`, `status = 'CANCELLED', cancelled_at = now(), cancelled_by = '${admin}'`, `reach = 2`, `audience_label = 'Other'`, `send_at = now() + interval '1 day'`,
      `sent_at = now() + interval '1 day'`, `audience_min_tier = 1`, `updated_at = now() + interval '1 day'`, `updated_by = '${admin}', sent_by = NULL`,
    ]) {
      await expect(run(`UPDATE house_messages SET ${sets} WHERE id = '${draft}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`UPDATE house_messages SET audience_segment_id = '${other}' WHERE id = '${draft}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM house_messages WHERE id = '${draft}'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE house_messages SET audience_segment_id = NULL WHERE id = '${draft}'`);
    await run(`DELETE FROM segments WHERE id = '${segment}'`);
    expect(await one(`SELECT status, audience_segment_id, audience_label, reach FROM house_messages WHERE id = '${draft}'`)).toEqual({ status: 'SENT', audience_segment_id: null, audience_label: 'House 0052', reach: 1 });
    // Another scheduled then cancelled, never deleted; a draft deleted.
    const scheduled = (await message(sched)).id;
    await run(`UPDATE house_messages SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = '${admin}', send_at = NULL WHERE id = '${scheduled}'`);
    await expect(run(`DELETE FROM house_messages WHERE id = '${scheduled}'`)).rejects.toSatisfy(isGuardViolation);
    const removed = (await message()).id;
    await run(`DELETE FROM house_messages WHERE id = '${removed}'`);

    // A delivery: a moment with its words, or a custom message by reference.
    const delivery = (cols: Record<string, string> = {}) =>
      insert('house_deliveries', {
        account_id: `'${account}'`, source: `'MOMENT'`, moment: `'OWNERSHIP_YEAR'`, title: `'ONE YEAR'`, body: `'MONOLITHE IN STEEL has been yours for a year today.'`, piece_ref: `'O26-J-00184'`,
        dedupe_key: `'OWNERSHIP_YEAR:0052'`, ...cols,
      });
    for (const [cols, label, constraint] of [
      // (PostgreSQL checks a row's constraints by name: house_deliveries_source comes before its column's _source_check.)
      [{ source: `'PUSH'` }, 'an unknown source', 'house_deliveries_source'],
      [{ moment: `'ANNIVERSARY'` }, 'an unknown moment', 'house_deliveries_moment_check'],
      [{ moment: 'NULL' }, 'a moment without its moment', 'house_deliveries_source'],
      [{ title: 'NULL' }, 'a moment without its title', 'house_deliveries_source'],
      [{ body: 'NULL' }, 'a moment without its words', 'house_deliveries_source'],
      [{ house_message_id: `'${draft}'` }, 'a moment naming a message', 'house_deliveries_source'],
      [{ source: `'CUSTOM'`, moment: 'NULL', title: 'NULL', body: 'NULL', piece_ref: 'NULL' }, 'a custom message without its message', 'house_deliveries_source'],
      [{ source: `'CUSTOM'`, house_message_id: `'${draft}'`, moment: 'NULL', piece_ref: 'NULL' }, 'a custom message with copied words', 'house_deliveries_source'],
      [{ source: `'CUSTOM'`, house_message_id: `'${draft}'`, moment: 'NULL', title: 'NULL', body: 'NULL' }, 'a custom message naming a piece', 'house_deliveries_source'],
      [{ piece_ref: 'NULL' }, 'a year of ownership without its piece', 'house_deliveries_piece'],
      [{ moment: `'BIRTHDAY_CREDIT'` }, 'a birthday credit naming a piece', 'house_deliveries_piece'],
      [{ piece_ref: `'O26-J-184'` }, 'a piece reference of another shape', 'house_deliveries_piece_ref_check'],
      [{ title: `''` }, 'an empty title', 'house_deliveries_title_check'],
      [{ title: `'ONE' || chr(10) || 'YEAR'` }, 'a title on two lines', 'house_deliveries_title_check'],
      [{ title: `'${'é'.repeat(401)}'` }, 'a title of 401 characters', 'house_deliveries_title_check'],
      [{ body: `' '` }, 'blank words', 'house_deliveries_body_check'],
      [{ body: `'${'é'.repeat(8001)}'` }, 'words of 8 001 characters', 'house_deliveries_body_check'],
      [{ dedupe_key: `''` }, 'an empty key', 'house_deliveries_dedupe_key_check'],
      [{ dedupe_key: `'${'k'.repeat(201)}'` }, 'a key of 201 characters', 'house_deliveries_dedupe_key_check'],
      [{ delivered_at: `'2026-10-21T10:00:00Z'`, read_at: `'2026-10-21T09:59:59Z'` }, 'read before its delivery', 'house_deliveries_read'],
    ] as const) {
      await check(delivery(cols), label, constraint);
    }
    for (const column of ['account_id', 'source', 'dedupe_key']) await nullRefused(delivery({ [column]: 'NULL' }), `no ${column}`);
    await expect(delivery({ account_id: 'gen_random_uuid()' })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(delivery({ source: `'CUSTOM'`, house_message_id: 'gen_random_uuid()', moment: 'NULL', title: 'NULL', body: 'NULL', piece_ref: 'NULL' })).rejects.toSatisfy(isForeignKeyViolation);
    await delivery({ title: `'${'é'.repeat(400)}'`, body: `'${'é'.repeat(8000)}'` });
    await expect(delivery()).rejects.toSatisfy((e) => isUniqueViolation(e, 'house_deliveries_dedupe_key'));
    await delivery({ moment: `'NINETY_DAYS'`, title: `'WHAT IS NEW'`, body: `'Since your last visit, THE COLLECTION and THE RELEASES have moved on.'`, piece_ref: 'NULL', dedupe_key: `'NINETY_DAYS:0052:2026-10-21'` });
    await delivery({ source: `'CUSTOM'`, house_message_id: `'${draft}'`, moment: 'NULL', title: 'NULL', body: 'NULL', piece_ref: 'NULL', dedupe_key: `'CUSTOM:${draft}:${account}'` });
    const unread = await one<Record<string, unknown>>(`SELECT read_at, delivered_at <= now() AS delivered FROM house_deliveries WHERE dedupe_key = 'OWNERSHIP_YEAR:0052'`);
    expect(unread).toEqual({ read_at: null, delivered: true });
    // Read: its time, never before its delivery; nothing else ever changes; never deleted nor truncated.
    await run(`UPDATE house_deliveries SET read_at = now() WHERE account_id = '${account}'`);
    await check(run(`UPDATE house_deliveries SET read_at = delivered_at - interval '1 second' WHERE dedupe_key = 'OWNERSHIP_YEAR:0052'`), 'read before its delivery', 'house_deliveries_read');
    for (const sets of [`title = 'Other'`, `body = 'Other.'`, `moment = 'OWNERSHIP_YEAR'`, `piece_ref = 'O26-J-00185'`, `dedupe_key = 'Other'`, `delivered_at = now()`, `account_id = account_id, id = gen_random_uuid()`]) {
      await expect(run(`UPDATE house_deliveries SET ${sets} WHERE dedupe_key = 'NINETY_DAYS:0052:2026-10-21'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM house_deliveries WHERE account_id = '${account}'`)).rejects.toSatisfy(isGuardViolation);
    await expect(run(`TRUNCATE house_deliveries`)).rejects.toSatisfy(isGuardViolation);

    // Down refuses while a setting, a message or a delivery exists, naming the counts; this database stays at 0052.
    // 0053, which holds nothing here, goes down first.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    await expect(down(t.db)).rejects.toThrow(/0052_house_messages cannot be rolled back: 2 moment settings, 2 house messages and 3 house deliveries exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0052_house_messages')?.executedAt).toBeDefined();
    await run(`DELETE FROM house_moment_settings`);
    await expect(down(t.db)).rejects.toThrow(/0052_house_messages cannot be rolled back: 0 moment settings, 2 house messages and 3 house deliveries exist/);
    // Cleared by hand (a delivery and a message that went are never deleted).
    await run(`ALTER TABLE house_deliveries DISABLE TRIGGER house_deliveries_no_delete`);
    await run(`DELETE FROM house_deliveries`);
    await run(`ALTER TABLE house_deliveries ENABLE TRIGGER house_deliveries_no_delete`);
    await expect(down(t.db)).rejects.toThrow(/0052_house_messages cannot be rolled back: 0 moment settings, 2 house messages and 0 house deliveries exist/);
    await run(`ALTER TABLE house_messages DISABLE TRIGGER house_messages_no_delete`);
    await run(`DELETE FROM house_messages`);
    await run(`ALTER TABLE house_messages ENABLE TRIGGER house_messages_no_delete`);
    expect((await down(t.db)).reverted).toEqual(['0052_house_messages']);
    expect((await up(t.db)).applied).toEqual(['0052_house_messages', '0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    await run(`DELETE FROM segments WHERE id = '${other}'`);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  it('0053 adds WORN (worn_photos, its indexes and guards), and nothing else; down restores 0052 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0053_worn');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new table's too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const ofTable = (o: string) => /\bworn_photos\b/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    const removed = before.filter((o) => !withIt.includes(o) && !notNull(o));
    expect(before.filter(ofTable)).toEqual([]);
    // Nothing outside the table changed.
    expect(removed).toEqual([]);
    expect(added.filter((o) => !ofTable(o))).toEqual([]);
    // The statuses: schema.ts's WORN_STATUSES; the refusals: WORN_REFUSALS; the types: MEDIA_MIME_TYPES.
    const literals = (name: string) => [...added.find((o) => o.split(' ')[2] === name)!.matchAll(/'([A-Za-z_/]+)'::text/g)].map((m) => m[1]);
    expect(literals('worn_photos_status_check')).toEqual([...WORN_STATUSES]);
    expect(literals('worn_photos_refusal_check')).toEqual([...WORN_REFUSALS]);
    expect(literals('worn_photos_photo_mime_check')).toEqual([...MEDIA_MIME_TYPES]);
    // Its columns.
    expect(added.filter((o) => o.startsWith('table worn_photos ')).map((o) => o.split(' ').slice(2).join(' ')).sort()).toEqual([
      'account_id uuid NO ',
      'consent_at timestamp with time zone NO ',
      'consent_version text NO ',
      'created_at timestamp with time zone NO now()',
      'credit_country character NO ',
      'credit_first_name text NO ',
      'credit_instagram text YES ',
      'ended_at timestamp with time zone YES ',
      'height integer YES ',
      'id uuid NO gen_random_uuid()',
      'model_id uuid NO ',
      'ownership_id uuid NO ',
      'photo bytea YES ',
      'photo_mime text YES ',
      'photo_sha256 text YES ',
      'product_id uuid NO ',
      'published_at timestamp with time zone YES ',
      'refusal text YES ',
      'reviewed_at timestamp with time zone YES ',
      'reviewed_by uuid YES ',
      'status text NO \'PENDING\'::text',
      'width integer YES ',
    ]);
    // Its constraints, indexes and guards.
    for (const c of [
      /^constraint worn_photos worn_photos_pkey PRIMARY KEY \(id\)$/,
      /^constraint worn_photos worn_photos_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES products\(id\) ON DELETE RESTRICT$/,
      /^constraint worn_photos worn_photos_ownership_id_fkey FOREIGN KEY \(ownership_id\) REFERENCES ownership\(id\) ON DELETE RESTRICT$/,
      /^constraint worn_photos worn_photos_account_id_fkey FOREIGN KEY \(account_id\) REFERENCES accounts\(id\) ON DELETE RESTRICT$/,
      /^constraint worn_photos worn_photos_model_id_fkey FOREIGN KEY \(model_id\) REFERENCES models\(id\) ON DELETE RESTRICT$/,
      /^constraint worn_photos worn_photos_reviewed_by_fkey FOREIGN KEY \(reviewed_by\) REFERENCES admin_users\(id\) ON DELETE RESTRICT$/,
      /^constraint worn_photos worn_photos_photo_check CHECK .*1048576/,
      /^constraint worn_photos worn_photos_photo_sha256_check CHECK /,
      /^constraint worn_photos worn_photos_width_check CHECK .*4096/,
      /^constraint worn_photos worn_photos_height_check CHECK .*4096/,
      /^constraint worn_photos worn_photos_credit_first_name_check CHECK .*50/,
      /^constraint worn_photos worn_photos_credit_country_check CHECK /,
      /^constraint worn_photos worn_photos_credit_instagram_check CHECK /,
      /^constraint worn_photos worn_photos_consent_version_check CHECK /,
      /^constraint worn_photos worn_photos_photo CHECK /,
      /^constraint worn_photos worn_photos_sha256_consistent CHECK \(\(photo_sha256 = encode\(sha256\(photo\), 'hex'::text\)\)\)$/,
      /^constraint worn_photos worn_photos_refusal CHECK /,
      /^constraint worn_photos worn_photos_reviewed CHECK /,
      /^constraint worn_photos worn_photos_published CHECK /,
      /^constraint worn_photos worn_photos_ended CHECK /,
    ]) {
      expect(added.some((o) => c.test(o)), String(c)).toBe(true);
    }
    expect(added.filter((o) => o.startsWith('constraint worn_photos '))).toHaveLength(23);
    expect(added.filter((o) => o.startsWith('index ')).map((o) => o.split(' ').find((w, i, all) => all[i - 1] === 'INDEX')).sort()).toEqual([
      'worn_photos_account_idx', 'worn_photos_live_once', 'worn_photos_model_idx', 'worn_photos_ownership_idx', 'worn_photos_pkey', 'worn_photos_product_idx', 'worn_photos_queue',
      'worn_photos_reviewed_by_idx', 'worn_photos_sheet',
    ]);
    expect(added.filter((o) => o.startsWith('trigger ')).sort()).toEqual([
      'trigger worn_photos worn_photos_forward',
      'trigger worn_photos worn_photos_immutable_identity',
      'trigger worn_photos worn_photos_no_delete',
      'trigger worn_photos worn_photos_no_truncate',
      'trigger worn_photos worn_photos_photo_kept',
      'trigger worn_photos worn_photos_published_kept',
      'trigger worn_photos worn_photos_settled_immutable',
    ]);
    // Up again: the identity's guard holds the piece, the sender, the credit and the consent; a settled row's every column.
    const args = async (name: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${name}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    expect((await up(t.db)).applied).toEqual(['0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('worn_photos_immutable_identity')).toEqual([
      'id', 'product_id', 'ownership_id', 'account_id', 'model_id', 'credit_first_name', 'credit_country', 'credit_instagram', 'consent_at', 'consent_version', 'created_at',
    ]);
    expect((await args('worn_photos_settled_immutable')).sort()).toEqual(
      added.filter((o) => o.startsWith('table worn_photos ')).map((o) => o.split(' ')[2]).sort(),
    );
  });

  it('0053: a WORN photograph with its piece, ownership, sender and model; its bytes, type, hash and sides exactly while PENDING or PUBLISHED, its hash its bytes\', erased and never replaced; the credit (first name, country, Instagram when chosen) and the consent written once; one live per piece; the status only forward, refused or taken down with a reason, reviewed and published with their times, ended when settled, a settled row never changed; never deleted; down refused while any exists, naming the count', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const guarded = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy(isGuardViolation);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('worn-0053@orbes.test', 'worn-0053@orbes.test', 'scrypt$x', 'OPERATOR') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('lea-0053@example.com', 'lea-0053@example.com', 'scrypt$x') RETURNING id`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'HALO', 'RING', 'WORN0053') RETURNING id`)).id;
    const piece = async (n: number) => {
      const product = (await one<{ id: string }>(`INSERT INTO products (product_id, packed_identity, year, category_id, serial, sku, model_id, material)
        VALUES ('O26-C-${String(n).padStart(5, '0')}', ${(26 << 25) | (13 << 20) | n}, 2026, 13, ${n}, 'WORN0053-${n}', '${model}', 'SILVER') RETURNING id`)).id;
      const ownership = (await one<{ id: string }>(`INSERT INTO ownership (product_id, account_id, acquired_via) VALUES ('${product}', '${account}', 'FIRST_REGISTRATION') RETURNING id`)).id;
      return { product, ownership };
    };
    const [p1, p2, p3] = [await piece(901), await piece(902), await piece(903)];
    const bytes = (hex: string) => `decode('${hex}', 'hex')`;
    const JPEG = 'ffd8ffe000104a46494600';
    const PHOTO = { photo: bytes(JPEG), photo_mime: `'image/jpeg'`, photo_sha256: `encode(sha256(${bytes(JPEG)}), 'hex')`, width: '1600', height: '2000' };
    const ERASED = `photo = NULL, photo_mime = NULL, photo_sha256 = NULL, width = NULL, height = NULL`;
    const RESTORED = Object.entries(PHOTO).map(([k, v]) => `${k} = ${v}`).join(', ');
    const sending = (p: { product: string; ownership: string }, cols: Record<string, string> = {}) => {
      const all: Record<string, string> = {
        product_id: `'${p.product}'`, ownership_id: `'${p.ownership}'`, account_id: `'${account}'`, model_id: `'${model}'`, ...PHOTO, credit_first_name: `'Léa'`, credit_country: `'FR'`,
        consent_at: 'now()', consent_version: `'2026-10-22'`, ...cols,
      };
      return sql.raw<{ id: string }>(`INSERT INTO worn_photos (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };
    const set = (id: string, sets: string) => run(`UPDATE worn_photos SET ${sets} WHERE id = '${id}'`);
    const REVIEWED = `reviewed_by = '${admin}', reviewed_at = now()`;

    // A sending: its photograph whole, its credit and consent as their columns hold them.
    for (const [cols, label, constraint] of [
      [{ status: `'DRAFT'`, ended_at: 'now()', photo: 'NULL', photo_mime: 'NULL', photo_sha256: 'NULL', width: 'NULL', height: 'NULL' }, 'an unknown status', 'worn_photos_status_check'],
      [{ photo: 'NULL', photo_mime: 'NULL', photo_sha256: 'NULL', width: 'NULL', height: 'NULL' }, 'in review without its photograph', 'worn_photos_photo'],
      [{ photo_mime: 'NULL' }, 'a photograph without its type', 'worn_photos_photo'],
      [{ width: 'NULL' }, 'a photograph without its width', 'worn_photos_photo'],
      [{ photo_mime: `'image/png'` }, 'a PNG', 'worn_photos_photo_mime_check'],
      [{ photo_sha256: `'${'0'.repeat(64)}'` }, 'a hash not its bytes\'', 'worn_photos_sha256_consistent'],
      [{ photo: `decode(repeat('ab', 1048577), 'hex')`, photo_sha256: `encode(sha256(decode(repeat('ab', 1048577), 'hex')), 'hex')` }, 'a photograph over 1 MiB', 'worn_photos_photo_check'],
      [{ width: '0' }, 'a width of 0', 'worn_photos_width_check'],
      [{ height: '4097' }, 'a height of 4 097', 'worn_photos_height_check'],
      [{ credit_first_name: `''` }, 'an empty first name', 'worn_photos_credit_first_name_check'],
      [{ credit_first_name: `' Léa'` }, 'a first name not trimmed', 'worn_photos_credit_first_name_check'],
      [{ credit_first_name: `'Léa<b>'` }, 'a first name with markup', 'worn_photos_credit_first_name_check'],
      [{ credit_first_name: `'${'é'.repeat(51)}'` }, 'a first name of 51 characters', 'worn_photos_credit_first_name_check'],
      [{ credit_country: `'fr'` }, 'a country in lower case', 'worn_photos_credit_country_check'],
      [{ credit_instagram: `'Lea.M'` }, 'an Instagram name with capitals', 'worn_photos_credit_instagram_check'],
      [{ credit_instagram: `'@lea.m'` }, 'an Instagram name with its @', 'worn_photos_credit_instagram_check'],
      [{ credit_instagram: `'${'l'.repeat(31)}'` }, 'an Instagram name of 31 characters', 'worn_photos_credit_instagram_check'],
      [{ consent_version: `'22/10/2026'` }, 'a consent version not a date', 'worn_photos_consent_version_check'],
      [{ refusal: `'QUALITY'` }, 'a refusal in review', 'worn_photos_refusal'],
      [{ reviewed_by: `'${admin}'`, reviewed_at: 'now()' }, 'reviewed while in review', 'worn_photos_reviewed'],
      [{ published_at: 'now()' }, 'published while in review', 'worn_photos_published'],
      [{ ended_at: 'now()' }, 'ended while in review', 'worn_photos_ended'],
      [{ status: `'PUBLISHED'`, reviewed_by: `'${admin}'`, reviewed_at: 'now()' }, 'published without its time', 'worn_photos_published'],
      [{ status: `'PUBLISHED'`, reviewed_at: 'now()', published_at: 'now()' }, 'reviewed by no one', 'worn_photos_reviewed'],
      [{ status: `'ENDED'`, ended_at: 'now()' }, 'ended with its photograph', 'worn_photos_photo'],
    ] as const) {
      await check(sending(p1, cols), label, constraint);
    }
    await expect(sending(p1, { refusal: `'BLURRY'`, status: `'REFUSED'` }), 'an unknown refusal').rejects.toSatisfy((e) => isCheckViolation(e));
    await expect(sending(p1, { photo_sha256: `'${'A'.repeat(64)}'` }), 'a hash in capitals').rejects.toSatisfy((e) => isCheckViolation(e));
    await nullRefused(sending(p1, { consent_at: 'NULL' }), 'a sending without its consent');
    await nullRefused(sending(p1, { credit_country: 'NULL' }), 'a sending without its country');
    await expect(sending({ product: '00000000-0000-4000-8000-000000000000', ownership: p1.ownership })).rejects.toSatisfy(isForeignKeyViolation);

    // In review: PENDING by default, with its photograph and its credit; one live photograph per piece.
    const first = (await sending(p1, { credit_instagram: `'lea.m'` })).rows[0].id;
    expect(await one(`SELECT status, photo_mime, width, height, octet_length(photo) AS bytes, photo_sha256 = encode(sha256(photo), 'hex') AS hashed, credit_first_name, credit_country, credit_instagram, consent_version, refusal, reviewed_by, published_at, ended_at, created_at <= now() AS created FROM worn_photos WHERE id = '${first}'`)).toEqual({
      status: 'PENDING', photo_mime: 'image/jpeg', width: 1600, height: 2000, bytes: 11, hashed: true, credit_first_name: 'Léa', credit_country: 'FR', credit_instagram: 'lea.m', consent_version: '2026-10-22',
      refusal: null, reviewed_by: null, published_at: null, ended_at: null, created: true,
    });
    await expect(sending(p1)).rejects.toSatisfy((e) => isUniqueViolation(e, 'worn_photos_live_once'));
    // Its identity, its credit and its consent never change; its photograph is erased, never replaced.
    for (const sets of [`credit_first_name = 'Camille'`, `credit_country = 'BE'`, `credit_instagram = NULL`, `consent_version = '2026-10-23'`, `consent_at = now() - interval '1 day'`, `account_id = gen_random_uuid()`, `model_id = gen_random_uuid()`, `product_id = '${p2.product}'`, `ownership_id = '${p2.ownership}'`, `created_at = now() - interval '1 day'`]) {
      await guarded(set(first, sets), sets);
    }
    for (const sets of [`photo = ${bytes('ffd8ffe1')}, photo_sha256 = encode(sha256(${bytes('ffd8ffe1')}), 'hex')`, `photo_mime = 'image/webp'`, `width = 1200`]) {
      await guarded(set(first, sets), sets);
    }
    // Published: reviewed, with its time, its photograph kept.
    await check(set(first, `status = 'PUBLISHED', published_at = now()`), 'published by no one', 'worn_photos_reviewed');
    await check(set(first, `status = 'PUBLISHED', ${REVIEWED}`), 'published without its time', 'worn_photos_published');
    await check(set(first, `status = 'PUBLISHED', ${REVIEWED}, published_at = now(), ${ERASED}`), 'published without its photograph', 'worn_photos_photo');
    await set(first, `status = 'PUBLISHED', ${REVIEWED}, published_at = '2026-10-22T10:00:00Z'`);
    // Only forward: never back in review; never refused once published; its publication kept.
    await guarded(set(first, `status = 'PENDING', reviewed_by = NULL, reviewed_at = NULL, published_at = NULL`), 'back in review');
    await guarded(set(first, `status = 'REFUSED', refusal = 'QUALITY', ended_at = now(), ${ERASED}`), 'refused once published');
    await guarded(set(first, `published_at = '2026-10-22T11:00:00Z'`), 'its publication moved');
    // Withdrawn by its owner: its photograph erased, its publication and review kept.
    await check(set(first, `status = 'WITHDRAWN', ended_at = now()`), 'withdrawn with its photograph', 'worn_photos_photo');
    await check(set(first, `status = 'WITHDRAWN', ${ERASED}`), 'withdrawn without its end', 'worn_photos_ended');
    await set(first, `status = 'WITHDRAWN', ended_at = now(), ${ERASED}`);
    expect(await one(`SELECT status, photo, photo_mime, photo_sha256, width, height, published_at, reviewed_by FROM worn_photos WHERE id = '${first}'`)).toEqual({
      status: 'WITHDRAWN', photo: null, photo_mime: null, photo_sha256: null, width: null, height: null, published_at: new Date('2026-10-22T10:00:00Z'), reviewed_by: admin,
    });
    // Settled: never changed again, not even its status.
    for (const sets of [`status = 'PUBLISHED', ${RESTORED}, ended_at = NULL`, `ended_at = now() + interval '1 day'`, `reviewed_at = now()`, `status = 'TAKEN_DOWN', refusal = 'NOT_SUITABLE'`]) {
      await guarded(set(first, sets), sets);
    }

    // Once withdrawn, the piece sends again; refused in review with its reason: its photograph erased, never published.
    const second = (await sending(p1)).rows[0].id;
    await check(set(second, `status = 'REFUSED', ${REVIEWED}, ended_at = now(), ${ERASED}`), 'refused without its reason', 'worn_photos_refusal');
    await check(set(second, `status = 'REFUSED', refusal = 'QUALITY', ended_at = now(), ${ERASED}`), 'refused by no one', 'worn_photos_reviewed');
    await set(second, `status = 'REFUSED', refusal = 'QUALITY', ${REVIEWED}, ended_at = now(), ${ERASED}`);
    await guarded(set(second, `refusal = 'NOT_SUITABLE'`), 'its reason changed once refused');

    // Taken down only once published, with its reason, by the one who took it down.
    const third = (await sending(p2)).rows[0].id;
    await guarded(set(third, `status = 'TAKEN_DOWN', refusal = 'NOT_SUITABLE', ${REVIEWED}, published_at = now(), ended_at = now(), ${ERASED}`), 'taken down while in review');
    await set(third, `status = 'PUBLISHED', ${REVIEWED}, published_at = now()`);
    await check(set(third, `status = 'TAKEN_DOWN', ended_at = now(), ${ERASED}`), 'taken down without its reason', 'worn_photos_refusal');
    await set(third, `status = 'TAKEN_DOWN', refusal = 'NOT_SUITABLE', ${REVIEWED}, ended_at = now(), ${ERASED}`);

    // Ended in review when its piece left its owner; a refusal only on a refused or taken-down photograph.
    const fourth = (await sending(p3, { photo: bytes('52494646'), photo_mime: `'image/webp'`, photo_sha256: `encode(sha256(${bytes('52494646')}), 'hex')` })).rows[0].id;
    await check(set(fourth, `status = 'ENDED', refusal = 'QUALITY', ended_at = now(), ${ERASED}`), 'ended with a refusal', 'worn_photos_refusal');
    await set(fourth, `status = 'ENDED', ended_at = now(), ${ERASED}`);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM worn_photos WHERE status IN ('PENDING', 'PUBLISHED')`)).n).toBe(0);

    // Never deleted nor truncated: the record stays with the account.
    await guarded(run(`DELETE FROM worn_photos WHERE id = '${first}'`), 'a photograph deleted');
    // (Since 0061 a vault names its photograph, and since 0062 the rewards name the vault: even with CASCADE, the guard
    // still refuses it.)
    await guarded(run(`TRUNCATE worn_photos CASCADE`), 'the photographs truncated');
    await expect(run(`DELETE FROM ownership WHERE id = '${p1.ownership}'`)).rejects.toSatisfy(isForeignKeyViolation);

    // Down refuses while any photograph exists, naming the count; this database stays at 0053.
    // 0057, 0056, 0055 and 0054, which hold nothing here, go down first.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    await expect(down(t.db)).rejects.toThrow(/0053_worn cannot be rolled back: 4 WORN photographs exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0053_worn')?.executedAt).toBeDefined();
    // Cleared by hand (a photograph's record is never deleted).
    await run(`ALTER TABLE worn_photos DISABLE TRIGGER worn_photos_no_delete`);
    await run(`DELETE FROM worn_photos`);
    await run(`ALTER TABLE worn_photos ENABLE TRIGGER worn_photos_no_delete`);
    expect((await down(t.db)).reverted).toEqual(['0053_worn']);
    expect((await up(t.db)).applied).toEqual(['0053_worn', '0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    await run(`DELETE FROM ownership WHERE account_id = '${account}'`);
    await run(`DELETE FROM products WHERE model_id = '${model}'`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
    // (0061, applied again above, wrote the tier this account held then.)
    await run(`DELETE FROM vault_occasions_before WHERE account_id = '${account}'`);
    await run(`DELETE FROM accounts WHERE id = '${account}'`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  /** What names an object of 0054 in a snapshot: the boxes table, the models' box and packed weight, the parcels' box and weight. */
  const of0054 = (o: string) =>
    /\bboxes\b/.test(o) || /^table models (box_id|packed_weight_g) /.test(o) || /\bmodels_(box_id|packed_weight_g)_/.test(o) ||
    /^table shipments (box_id|weight_g|weight_missing) /.test(o) || /\bshipments_(box_id_fkey|box_idx|weight|weight_g_check|weight_missing_check)\b/.test(o);

  it('0054 adds the boxes (their bounds, cost, card rule, name once whatever the case, guards), a model\'s box and packed weight, and a parcel\'s box, weight and missing list, and nothing else; down restores 0053 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0054_boxes_weights');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new table's too, as in 0048's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0054(o))).toEqual([]);
    expect(before.filter(of0054)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table boxes active boolean NO true',
      'table boxes cost_minor bigint YES ',
      'table boxes created_at timestamp with time zone NO now()',
      'table boxes created_by uuid YES ',
      'table boxes currency text YES ',
      'table boxes empty_weight_g integer NO ',
      'table boxes id uuid NO gen_random_uuid()',
      'table boxes inside_height_mm integer NO ',
      'table boxes inside_length_mm integer NO ',
      'table boxes inside_width_mm integer NO ',
      'table boxes name text NO ',
      'table boxes updated_at timestamp with time zone NO now()',
      'table models box_id uuid YES ',
      'table models packed_weight_g integer YES ',
      'table shipments box_id uuid YES ',
      'table shipments weight_g integer YES ',
      'table shipments weight_missing ARRAY YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      'constraint boxes boxes_card_fits CHECK (((GREATEST(inside_length_mm, inside_width_mm) >= 95) AND (LEAST(inside_length_mm, inside_width_mm) >= 62)))',
      'constraint boxes boxes_cost CHECK (((cost_minor IS NULL) = (currency IS NULL)))',
      'constraint boxes boxes_cost_minor_check CHECK (((cost_minor >= 0) AND (cost_minor <= 100000000)))',
      'constraint boxes boxes_created_by_fkey FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
      "constraint boxes boxes_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))",
      'constraint boxes boxes_empty_weight_g_check CHECK (((empty_weight_g >= 1) AND (empty_weight_g <= 30000)))',
      'constraint boxes boxes_inside_height_mm_check CHECK (((inside_height_mm >= 1) AND (inside_height_mm <= 2000)))',
      'constraint boxes boxes_inside_length_mm_check CHECK (((inside_length_mm >= 1) AND (inside_length_mm <= 2000)))',
      'constraint boxes boxes_inside_width_mm_check CHECK (((inside_width_mm >= 1) AND (inside_width_mm <= 2000)))',
      'constraint boxes boxes_name_check CHECK ((((length(name) >= 1) AND (length(name) <= 60)) AND (name = btrim(name))))',
      'constraint boxes boxes_pkey PRIMARY KEY (id)',
      'constraint models models_box_id_fkey FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE RESTRICT',
      'constraint models models_packed_weight_g_check CHECK (((packed_weight_g >= 1) AND (packed_weight_g <= 30000)))',
      'constraint shipments shipments_box_id_fkey FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE RESTRICT',
      'constraint shipments shipments_weight CHECK ((((packed_at IS NOT NULL) OR ((weight_g IS NULL) AND (weight_missing IS NULL))) AND ((weight_g IS NULL) OR (weight_missing IS NULL))))',
      'constraint shipments shipments_weight_g_check CHECK (((weight_g >= 1) AND (weight_g <= 100000)))',
      'constraint shipments shipments_weight_missing_check CHECK ((((cardinality(weight_missing) >= 1) AND (cardinality(weight_missing) <= 64)) AND (array_position(weight_missing, NULL::text) IS NULL)))',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX boxes_created_by_idx ON public.boxes USING btree (created_by)',
      'index CREATE INDEX models_box_id_idx ON public.models USING btree (box_id)',
      'index CREATE INDEX shipments_box_idx ON public.shipments USING btree (box_id)',
      'index CREATE UNIQUE INDEX boxes_name_key ON public.boxes USING btree (lower(name))',
      'index CREATE UNIQUE INDEX boxes_pkey ON public.boxes USING btree (id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger boxes boxes_immutable_identity', 'trigger boxes boxes_touch_updated_at']);
    // Up again: the identity's guard holds the id, the creation and its author.
    expect((await up(t.db)).applied).toEqual(['0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = 'boxes_immutable_identity'`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean),
    ).toEqual(['id', 'created_at', 'created_by']);
  });

  it('0054: a box named once whatever the case, 1 to 60 characters trimmed, its inside sides 1 to 2 000 mm taking the 95 × 62 mm card flat in either orientation, its empty weight 1 to 30 000 g, its cost 0 to 100 000 000 with its currency, both or neither, active by default, its identity fixed and its update stamped; a model\'s box and packed weight 1 to 30 000 g; a parcel\'s box, its weight 1 to 100 000 g or what was missing, only once packed and never both; a box named is never deleted; the previous image\'s rows have none; down refused while a box exists or is named, or a weight is kept, naming the counts', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('box-0054@orbes.test', 'box-0054@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('box-0054@example.com', 'box-0054@example.com', 'scrypt$x') RETURNING id`)).id;
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'HALO', 'RING', 'BOX0054') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('BOXES 0054') RETURNING id`)).id;
    const box = (cols: Record<string, string> = {}) => {
      const all: Record<string, string> = { name: `'SMALL'`, inside_length_mm: '100', inside_width_mm: '70', inside_height_mm: '40', empty_weight_g: '85', ...cols };
      return sql.raw<{ id: string }>(`INSERT INTO boxes (${Object.keys(all).join(', ')}) VALUES (${Object.values(all).join(', ')}) RETURNING id`).execute(t.db);
    };

    // The previous image's rows: a model and a parcel with neither box nor weight.
    expect(await one(`SELECT box_id, packed_weight_g FROM models WHERE id = '${model}'`)).toEqual({ box_id: null, packed_weight_g: null });

    // A box: its bounds, its cost both or neither, the card flat in either orientation.
    for (const [cols, label, constraint] of [
      [{ name: `''` }, 'an empty name', 'boxes_name_check'],
      [{ name: `' SMALL'` }, 'a name not trimmed', 'boxes_name_check'],
      [{ name: `'${'B'.repeat(61)}'` }, 'a name of 61 characters', 'boxes_name_check'],
      [{ inside_length_mm: '2001' }, 'a length of 2 001 mm', 'boxes_inside_length_mm_check'],
      [{ inside_width_mm: '2001' }, 'a width of 2 001 mm', 'boxes_inside_width_mm_check'],
      [{ inside_height_mm: '0' }, 'a height of 0', 'boxes_inside_height_mm_check'],
      [{ inside_height_mm: '2001' }, 'a height of 2 001 mm', 'boxes_inside_height_mm_check'],
      [{ empty_weight_g: '0' }, 'an empty weight of 0', 'boxes_empty_weight_g_check'],
      [{ empty_weight_g: '30001' }, 'an empty weight of 30 001 g', 'boxes_empty_weight_g_check'],
      [{ cost_minor: '-1', currency: `'EUR'` }, 'a cost below 0', 'boxes_cost_minor_check'],
      [{ cost_minor: '100000001', currency: `'EUR'` }, 'a cost above 100 000 000', 'boxes_cost_minor_check'],
      [{ cost_minor: '120', currency: `'eur'` }, 'a currency in lower case', 'boxes_currency_check'],
      [{ cost_minor: '120' }, 'a cost without its currency', 'boxes_cost'],
      [{ currency: `'EUR'` }, 'a currency without its cost', 'boxes_cost'],
      [{ inside_length_mm: '94', inside_width_mm: '62' }, 'a longer side of 94 mm', 'boxes_card_fits'],
      [{ inside_length_mm: '62', inside_width_mm: '94' }, 'a longer side of 94 mm, turned', 'boxes_card_fits'],
      [{ inside_length_mm: '94', inside_width_mm: '94' }, 'a square of 94 mm', 'boxes_card_fits'],
      [{ inside_length_mm: '200', inside_width_mm: '61' }, 'a shorter side of 61 mm', 'boxes_card_fits'],
      [{ inside_length_mm: '61', inside_width_mm: '200' }, 'a shorter side of 61 mm, turned', 'boxes_card_fits'],
    ] as const) {
      await check(box(cols), label, constraint);
    }
    // A side of 0 is refused (by the card rule first, which PostgreSQL checks before the side's own CHECK by name).
    for (const side of ['inside_length_mm', 'inside_width_mm']) await check(box({ [side]: '0' }), `a ${side} of 0`);
    await nullRefused(box({ inside_height_mm: 'NULL' }), 'a box without its height');
    await nullRefused(box({ empty_weight_g: 'NULL' }), 'a box without its empty weight');
    // The card exactly, in both orientations; the largest box; a cost of 0.
    const small = (await box({ inside_length_mm: '95', inside_width_mm: '62', inside_height_mm: '1', empty_weight_g: '1' })).rows[0].id;
    const turned = (await box({ name: `'TURNED'`, inside_length_mm: '62', inside_width_mm: '95', inside_height_mm: '2000', empty_weight_g: '30000', cost_minor: '0', currency: `'EUR'` })).rows[0].id;
    const large = (await box({ name: `'LARGE'`, inside_length_mm: '2000', inside_width_mm: '2000', cost_minor: '100000000', currency: `'JPY'`, created_by: `'${admin}'` })).rows[0].id;
    await expect(box({ name: `'small'` })).rejects.toSatisfy((e) => isUniqueViolation(e, 'boxes_name_key'));
    expect(await one(`SELECT name, inside_length_mm, inside_width_mm, inside_height_mm, empty_weight_g, cost_minor, currency, active, created_by, created_at = updated_at AS fresh FROM boxes WHERE id = '${large}'`)).toEqual({
      name: 'LARGE', inside_length_mm: 2000, inside_width_mm: 2000, inside_height_mm: 40, empty_weight_g: 85, cost_minor: 100000000, currency: 'JPY', active: true, created_by: admin, fresh: true,
    });
    // Set aside and edited: its identity fixed, its update stamped.
    await run(`UPDATE boxes SET active = false, name = 'LARGE BOX', updated_at = created_at - interval '1 day' WHERE id = '${large}'`);
    await run(`UPDATE boxes SET inside_height_mm = 41 WHERE id = '${large}'`);
    expect(await one(`SELECT active, name, updated_at > created_at AS stamped FROM boxes WHERE id = '${large}'`)).toEqual({ active: false, name: 'LARGE BOX', stamped: true });
    for (const sets of [`created_by = NULL`, `created_at = now() - interval '1 day'`, `id = gen_random_uuid()`]) {
      await expect(run(`UPDATE boxes SET ${sets} WHERE id = '${large}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await check(run(`UPDATE boxes SET inside_width_mm = 60 WHERE id = '${small}'`), 'a box made too small for the card', 'boxes_card_fits');

    // A model's box and packed weight.
    await check(run(`UPDATE models SET packed_weight_g = 0 WHERE id = '${model}'`), 'a packed weight of 0', 'models_packed_weight_g_check');
    await check(run(`UPDATE models SET packed_weight_g = 30001 WHERE id = '${model}'`), 'a packed weight of 30 001 g', 'models_packed_weight_g_check');
    await expect(run(`UPDATE models SET box_id = '00000000-0000-4000-8000-000000000000' WHERE id = '${model}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await run(`UPDATE models SET box_id = '${small}', packed_weight_g = 30000 WHERE id = '${model}'`);
    await expect(run(`DELETE FROM boxes WHERE id = '${small}'`), 'a box named by a model deleted').rejects.toSatisfy(isForeignKeyViolation);

    // A parcel: its box while packing; its weight or what was missing only once packed, never both.
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const order = (await one<{ id: string }>(`INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id, price_minor, currency) VALUES ('SALON', '${request}', '${account}', '${model}', '${location}', 1000, 'EUR') RETURNING id`)).id;
    await run(`UPDATE orders SET status = 'PAID', paid_at = now(), packing_started_at = now() WHERE id = '${order}'`);
    const parcel = (await one<{ id: string }>(`INSERT INTO shipments (order_id, location_id, packing_started_by) VALUES ('${order}', '${location}', '${admin}') RETURNING id`)).id;
    expect(await one(`SELECT box_id, weight_g, weight_missing FROM shipments WHERE id = '${parcel}'`)).toEqual({ box_id: null, weight_g: null, weight_missing: null });
    await run(`UPDATE shipments SET box_id = '${turned}' WHERE id = '${parcel}'`);
    await check(run(`UPDATE shipments SET weight_g = 120 WHERE id = '${parcel}'`), 'a weight while packing', 'shipments_weight');
    await check(run(`UPDATE shipments SET weight_missing = ARRAY['box'] WHERE id = '${parcel}'`), 'what was missing while packing', 'shipments_weight');
    const packed = `status = 'PACKED', packed_at = now(), packed_by = '${admin}'`;
    for (const [sets, label, constraint] of [
      [`weight_g = 0`, 'a weight of 0', 'shipments_weight_g_check'],
      [`weight_g = 100001`, 'a weight of 100 001 g', 'shipments_weight_g_check'],
      [`weight_missing = ARRAY[]::text[]`, 'nothing missing listed', 'shipments_weight_missing_check'],
      [`weight_missing = ARRAY['HALO', NULL]`, 'a missing entry NULL', 'shipments_weight_missing_check'],
      [`weight_missing = array_fill('HALO'::text, ARRAY[65])`, '65 missing entries', 'shipments_weight_missing_check'],
      [`weight_g = 1200, weight_missing = ARRAY['HALO']`, 'a weight and what was missing', 'shipments_weight'],
    ] as const) {
      await check(run(`UPDATE shipments SET ${packed}, ${sets} WHERE id = '${parcel}'`), label, constraint);
    }
    await run(`UPDATE shipments SET ${packed}, weight_missing = ARRAY['HALO', 'box'] WHERE id = '${parcel}'`);
    expect(await one(`SELECT box_id, weight_g, weight_missing FROM shipments WHERE id = '${parcel}'`)).toEqual({ box_id: turned, weight_g: null, weight_missing: ['HALO', 'box'] });
    await run(`UPDATE shipments SET weight_g = 100000, weight_missing = NULL WHERE id = '${parcel}'`);
    await expect(run(`DELETE FROM boxes WHERE id = '${turned}'`), 'a box named by a parcel deleted').rejects.toSatisfy(isForeignKeyViolation);
    // A box named by nothing may go (the service sets boxes aside instead).
    await run(`DELETE FROM boxes WHERE id = '${large}'`);

    // Down refuses while a box exists or is named, or a weight is kept, naming the counts; this database stays at 0054
    // (0057, 0056 and 0055, which hold nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    await expect(down(t.db)).rejects.toThrow(/0054_boxes_weights cannot be rolled back: 2 boxes, 1 models with a box or a packed weight and 1 shipments with a box or a weight exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0054_boxes_weights')?.executedAt).toBeDefined();
    await run(`UPDATE models SET box_id = NULL WHERE id = '${model}'`);
    await run(`UPDATE shipments SET box_id = NULL, weight_g = NULL WHERE id = '${parcel}'`);
    await run(`DELETE FROM boxes`);
    // A packed weight alone, or what was missing alone, still holds it.
    await run(`UPDATE shipments SET weight_missing = ARRAY['box'] WHERE id = '${parcel}'`);
    await expect(down(t.db)).rejects.toThrow(/cannot be rolled back: 0 boxes, 1 models with a box or a packed weight and 1 shipments with a box or a weight exist/);
    await run(`UPDATE shipments SET weight_missing = NULL WHERE id = '${parcel}'`);
    await run(`UPDATE models SET packed_weight_g = NULL WHERE id = '${model}'`);
    expect((await down(t.db)).reverted).toEqual(['0054_boxes_weights']);
    expect((await up(t.db)).applied).toEqual(['0054_boxes_weights', '0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    for (const q of [
      `DELETE FROM shipments WHERE id = '${parcel}'`,
      `DELETE FROM orders WHERE id = '${order}'`,
      `DELETE FROM shop_requests WHERE id = '${request}'`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
      `DELETE FROM accounts WHERE id = '${account}'`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await run(q);
    }
  });

  /** What names an object of 0055 in a snapshot: the countries each location serves. */
  const of0055 = (o: string) => /\bstock_location_countries\b/.test(o);

  it('0055 adds the countries each location serves (one location per country, its country fixed, its update stamped), and nothing else; down restores 0054 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0055_location_countries');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new table's too, as in 0054's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL \w+$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0055(o))).toEqual([]);
    expect(before.filter(of0055)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table stock_location_countries country character NO ',
      'table stock_location_countries location_id uuid NO ',
      'table stock_location_countries updated_at timestamp with time zone NO now()',
      'table stock_location_countries updated_by uuid YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      "constraint stock_location_countries stock_location_countries_country_check CHECK ((country ~ '^[A-Z]{2}$'::text))",
      'constraint stock_location_countries stock_location_countries_location_id_fkey FOREIGN KEY (location_id) REFERENCES stock_locations(id) ON DELETE RESTRICT',
      'constraint stock_location_countries stock_location_countries_pkey PRIMARY KEY (country)',
      'constraint stock_location_countries stock_location_countries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE RESTRICT',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX stock_location_countries_location_idx ON public.stock_location_countries USING btree (location_id)',
      'index CREATE INDEX stock_location_countries_updated_by_idx ON public.stock_location_countries USING btree (updated_by)',
      'index CREATE UNIQUE INDEX stock_location_countries_pkey ON public.stock_location_countries USING btree (country)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger stock_location_countries stock_location_countries_immutable_country',
      'trigger stock_location_countries stock_location_countries_touch_updated_at',
    ]);
    // Up again: the guard holds the country.
    expect((await up(t.db)).applied).toEqual(['0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = 'stock_location_countries_immutable_country'`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean),
    ).toEqual(['country']);
  });

  it('0055: a country served by one location at most, two capital letters, moved by its location and never changed itself, its update stamped and its author an admin or none; a location serving a country is never deleted; down refused while a country is served, naming the count', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('countries-0055@orbes.test', 'countries-0055@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const france = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('COUNTRIES 0055 FR') RETURNING id`)).id;
    const usa = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('COUNTRIES 0055 US') RETURNING id`)).id;
    const serve = (country: string, location: string, by: string = `'${admin}'`) =>
      run(`INSERT INTO stock_location_countries (country, location_id, updated_by) VALUES (${country}, '${location}', ${by})`);

    // Two capital letters, a location, an author that is an admin or none.
    for (const [country, label] of [[`'fr'`, 'a country in lower case'], [`'FRA'`, 'three letters'], [`'F'`, 'one letter'], [`'F1'`, 'a digit'], [`''`, 'an empty country']] as const) {
      await expect(serve(country, france), label).rejects.toSatisfy((e) => isCheckViolation(e, 'stock_location_countries_country_check') || pgError(e)?.code === '22001');
    }
    await nullRefused(serve('NULL', france), 'no country');
    await nullRefused(run(`INSERT INTO stock_location_countries (country) VALUES ('FR')`), 'no location');
    await expect(serve(`'FR'`, '00000000-0000-4000-8000-000000000000')).rejects.toSatisfy(isForeignKeyViolation);
    await expect(serve(`'FR'`, france, `'00000000-0000-4000-8000-000000000000'`)).rejects.toSatisfy(isForeignKeyViolation);

    // One location per country.
    await serve(`'FR'`, france);
    await serve(`'BE'`, france, 'NULL');
    await serve(`'US'`, usa);
    await expect(serve(`'FR'`, usa), 'a country served twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'stock_location_countries_pkey'));
    expect(await one(`SELECT country, location_id, updated_by, updated_at <= now() AS stamped FROM stock_location_countries WHERE country = 'BE'`)).toEqual({ country: 'BE', location_id: france, updated_by: null, stamped: true });

    // Moved by its location, its update stamped; the country itself never changes.
    await run(`UPDATE stock_location_countries SET updated_at = '2026-10-01T10:00:00Z' WHERE country = 'BE'`);
    await run(`UPDATE stock_location_countries SET location_id = '${usa}', updated_by = '${admin}' WHERE country = 'BE'`);
    expect(await one(`SELECT location_id, updated_by, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM stock_location_countries WHERE country = 'BE'`)).toEqual({ location_id: usa, updated_by: admin, stamped: true });
    await expect(run(`UPDATE stock_location_countries SET country = 'NL' WHERE country = 'BE'`), 'a country changed').rejects.toSatisfy(isGuardViolation);
    // A location serving a country is never deleted.
    await expect(run(`DELETE FROM stock_locations WHERE id = '${usa}'`)).rejects.toSatisfy(isForeignKeyViolation);
    await run(`DELETE FROM stock_location_countries WHERE country = 'US'`);

    // Down refuses while a country is served, naming the count; this database stays at 0055 (0057 and 0056, which hold
    // nothing here, go down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    await expect(down(t.db)).rejects.toThrow(/0055_location_countries cannot be rolled back: 2 countries served by a location exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0055_location_countries')?.executedAt).toBeDefined();
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM stock_location_countries`)).n)).toBe(2);
    await run(`DELETE FROM stock_location_countries`);
    expect((await down(t.db)).reverted).toEqual(['0055_location_countries']);
    expect((await up(t.db)).applied).toEqual(['0055_location_countries', '0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    await run(`DELETE FROM stock_locations WHERE id IN ('${france}', '${usa}')`);
    await run(`DELETE FROM admin_users WHERE id = '${admin}'`);
  });

  /** What names an object of 0056 in a snapshot: the add-ons, their prices, SKUs, units, choices, the ledger's unit and stock_holds. */
  const of0056 = (o: string) =>
    /\b(addon_items|addon_item_prices|addon_choices|order_addon_items|stock_holds)\b/.test(o) || /^table skus (model_id|addon_id) /.test(o) ||
    /\bskus_(addon_id_fkey|addon_id_key|addon_sku_key|owner|addon_plain|model_size_key)\b/.test(o) || /\bstock_movements_order_addon_item(_fkey|_idx)?\b/.test(o) ||
    /^table stock_movements order_addon_item_id /.test(o);

  it('0056 adds the add-ons (their prices, their SKUs owned by an add-on or a model, the units on orders, the choices before an order, the ledger\'s unit and the stock_holds view), and nothing else; down restores 0055 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0056_addons');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new tables' too, as in 0054's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL "?\w+"?$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    // What 0056 changes of 0055: skus.model_id NULL-able, and its one SKU per model and size on the models' SKUs only.
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([
      'index CREATE UNIQUE INDEX skus_model_size_key ON public.skus USING btree (model_id, upper(size_label)) NULLS NOT DISTINCT',
      'table skus model_id uuid NO ',
    ]);
    expect(added.filter((o) => !of0056(o))).toEqual([]);
    expect(before.filter((o) => of0056(o) && !/skus_model_size_key|^table skus model_id /.test(o))).toEqual([]);
    expect(added.filter((o) => o.startsWith('table ')).map((o) => o.split(' ').slice(1, 3).join(' '))).toEqual([
      'addon_choices addon_id', 'addon_choices chosen_at', 'addon_choices drop_entry_id', 'addon_choices id', 'addon_choices live_entry_id', 'addon_choices shop_request_id', 'addon_choices units',
      'addon_item_prices addon_id', 'addon_item_prices currency', 'addon_item_prices price_minor', 'addon_item_prices updated_at', 'addon_item_prices updated_by',
      'addon_items active', 'addon_items created_at', 'addon_items created_by', 'addon_items id', 'addon_items line', 'addon_items name', 'addon_items position', 'addon_items shopify_product_id',
      'addon_items supplier_id', 'addon_items updated_at', 'addon_items weight_g',
      'order_addon_items added_at', 'order_addon_items added_by', 'order_addon_items added_by_type', 'order_addon_items addon_id', 'order_addon_items cancelled_at', 'order_addon_items currency',
      'order_addon_items id', 'order_addon_items invoice_id', 'order_addon_items location_id', 'order_addon_items order_id', 'order_addon_items price_minor', 'order_addon_items removed_at',
      'order_addon_items returned_at', 'order_addon_items returned_to_stock', 'order_addon_items shipped_at', 'order_addon_items shopify_line_item_id', 'order_addon_items sku_id', 'order_addon_items status',
      'skus addon_id', 'skus model_id',
      'stock_holds id', 'stock_holds kind', 'stock_holds location_id', 'stock_holds reservation', 'stock_holds reserved_at', 'stock_holds sku_id',
      'stock_movements order_addon_item_id',
    ]);
    expect(added).toContain('table skus model_id uuid YES ');
    expect(added).toContain("table order_addon_items status text NO 'HELD'::text");
    expect(added).toContain('table addon_items position smallint NO 0');
    expect(added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(1, 3).join(' '))).toEqual([
      'addon_choices addon_choices_addon_id_fkey', 'addon_choices addon_choices_drop_entry_id_fkey', 'addon_choices addon_choices_drop_entry_key', 'addon_choices addon_choices_live_entry_id_fkey',
      'addon_choices addon_choices_live_entry_key', 'addon_choices addon_choices_owner', 'addon_choices addon_choices_pkey', 'addon_choices addon_choices_shop_request_id_fkey',
      'addon_choices addon_choices_shop_request_key', 'addon_choices addon_choices_units_check',
      'addon_item_prices addon_item_prices_addon_id_fkey', 'addon_item_prices addon_item_prices_currency_check', 'addon_item_prices addon_item_prices_pkey', 'addon_item_prices addon_item_prices_price_minor_check',
      'addon_item_prices addon_item_prices_updated_by_fkey',
      'addon_items addon_items_created_by_fkey', 'addon_items addon_items_line_check', 'addon_items addon_items_name_check', 'addon_items addon_items_pkey', 'addon_items addon_items_position_check',
      'addon_items addon_items_shopify_product_id_check', 'addon_items addon_items_shopify_product_key', 'addon_items addon_items_supplier_id_fkey', 'addon_items addon_items_weight_g_check',
      'order_addon_items order_addon_items_added_by', 'order_addon_items order_addon_items_added_by_type_check', 'order_addon_items order_addon_items_addon_id_fkey', 'order_addon_items order_addon_items_currency_check',
      'order_addon_items order_addon_items_invoice_id_fkey', 'order_addon_items order_addon_items_location_id_fkey', 'order_addon_items order_addon_items_order_id_fkey', 'order_addon_items order_addon_items_pkey',
      'order_addon_items order_addon_items_price_minor_check', 'order_addon_items order_addon_items_returned', 'order_addon_items order_addon_items_shopify_line_item_id_check',
      'order_addon_items order_addon_items_shopify_line_item_key', 'order_addon_items order_addon_items_sku_fkey', 'order_addon_items order_addon_items_status_check', 'order_addon_items order_addon_items_status_times',
      'order_addon_items order_addon_items_times', 'order_addon_items order_addon_items_unit_key',
      'skus skus_addon_id_fkey', 'skus skus_addon_id_key', 'skus skus_addon_plain', 'skus skus_addon_sku_key', 'skus skus_owner',
      'stock_movements stock_movements_order_addon_item', 'stock_movements stock_movements_order_addon_item_fkey',
    ]);
    for (const def of [
      'constraint skus skus_owner CHECK ((num_nonnulls(model_id, addon_id) = 1))',
      'constraint skus skus_addon_plain CHECK (((addon_id IS NULL) OR ((size_label IS NULL) AND (fit_min_mm IS NULL) AND (fit_max_mm IS NULL))))',
      'constraint skus skus_addon_sku_key UNIQUE (addon_id, id)',
      'constraint order_addon_items order_addon_items_sku_fkey FOREIGN KEY (addon_id, sku_id) REFERENCES skus(addon_id, id) ON DELETE RESTRICT',
      'constraint order_addon_items order_addon_items_returned CHECK (((returned_to_stock IS NOT NULL) = (status = \'RETURNED\'::text)))',
      'constraint order_addon_items order_addon_items_times CHECK (((removed_at >= added_at) AND (cancelled_at >= added_at) AND (shipped_at >= added_at) AND (returned_at >= shipped_at)))',
      'constraint addon_choices addon_choices_owner CHECK ((num_nonnulls(live_entry_id, drop_entry_id, shop_request_id) = 1))',
      'constraint addon_choices addon_choices_units_check CHECK (((units >= 1) AND (units <= 3)))',
      "constraint stock_movements stock_movements_order_addon_item CHECK (((order_addon_item_id IS NULL) OR ((reason = ANY (ARRAY['SHIPPED'::text, 'RETURNED'::text])) AND (order_id IS NOT NULL) AND (product_id IS NULL))))",
      'constraint stock_movements stock_movements_order_addon_item_fkey FOREIGN KEY (order_addon_item_id, order_id, sku_id) REFERENCES order_addon_items(id, order_id, sku_id) ON DELETE RESTRICT',
    ]) {
      expect(added, def).toContain(def);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX addon_choices_addon_idx ON public.addon_choices USING btree (addon_id)',
      'index CREATE INDEX addon_item_prices_updated_by_idx ON public.addon_item_prices USING btree (updated_by)',
      'index CREATE INDEX addon_items_created_by_idx ON public.addon_items USING btree (created_by)',
      'index CREATE INDEX addon_items_supplier_idx ON public.addon_items USING btree (supplier_id)',
      'index CREATE INDEX order_addon_items_addon_idx ON public.order_addon_items USING btree (addon_id)',
      "index CREATE INDEX order_addon_items_held_idx ON public.order_addon_items USING btree (sku_id, location_id) WHERE (status = 'HELD'::text)",
      'index CREATE INDEX order_addon_items_invoice_idx ON public.order_addon_items USING btree (invoice_id)',
      'index CREATE INDEX order_addon_items_location_idx ON public.order_addon_items USING btree (location_id)',
      'index CREATE INDEX order_addon_items_order_idx ON public.order_addon_items USING btree (order_id)',
      'index CREATE INDEX stock_movements_order_addon_item_idx ON public.stock_movements USING btree (order_addon_item_id)',
      'index CREATE UNIQUE INDEX addon_choices_drop_entry_key ON public.addon_choices USING btree (drop_entry_id, addon_id)',
      'index CREATE UNIQUE INDEX addon_choices_live_entry_key ON public.addon_choices USING btree (live_entry_id, addon_id)',
      'index CREATE UNIQUE INDEX addon_choices_pkey ON public.addon_choices USING btree (id)',
      'index CREATE UNIQUE INDEX addon_choices_shop_request_key ON public.addon_choices USING btree (shop_request_id, addon_id)',
      'index CREATE UNIQUE INDEX addon_item_prices_pkey ON public.addon_item_prices USING btree (addon_id, currency)',
      'index CREATE UNIQUE INDEX addon_items_name_key ON public.addon_items USING btree (lower(name))',
      'index CREATE UNIQUE INDEX addon_items_pkey ON public.addon_items USING btree (id)',
      'index CREATE UNIQUE INDEX addon_items_shopify_product_key ON public.addon_items USING btree (shopify_product_id)',
      'index CREATE UNIQUE INDEX order_addon_items_pkey ON public.order_addon_items USING btree (id)',
      'index CREATE UNIQUE INDEX order_addon_items_shopify_line_item_key ON public.order_addon_items USING btree (shopify_line_item_id)',
      'index CREATE UNIQUE INDEX order_addon_items_unit_key ON public.order_addon_items USING btree (id, order_id, sku_id)',
      'index CREATE UNIQUE INDEX skus_addon_id_key ON public.skus USING btree (addon_id)',
      'index CREATE UNIQUE INDEX skus_addon_sku_key ON public.skus USING btree (addon_id, id)',
      'index CREATE UNIQUE INDEX skus_model_size_key ON public.skus USING btree (model_id, upper(size_label)) NULLS NOT DISTINCT WHERE (model_id IS NOT NULL)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger addon_choices addon_choices_immutable_identity',
      'trigger addon_item_prices addon_item_prices_immutable_identity',
      'trigger addon_item_prices addon_item_prices_touch_updated_at',
      'trigger addon_items addon_items_immutable_identity',
      'trigger addon_items addon_items_touch_updated_at',
      'trigger order_addon_items order_addon_items_immutable_identity',
    ]);
    // The SKU's identity guard of 0022, without the add-on; with it once up again.
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args('skus_immutable_identity')).toEqual(['id', 'model_id', 'size_label', 'created_at']);
    expect((await up(t.db)).applied).toEqual(['0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('skus_immutable_identity')).toEqual(['id', 'model_id', 'addon_id', 'size_label', 'created_at']);
    // 0059 (ADD-ONS ONE SYSTEM) fixes an add-on's kind at its creation too.
    expect(await args('addon_items_immutable_identity')).toEqual(['id', 'created_at', 'created_by', 'kind']);
    // 0062 (the vault's rewards) fixes a VAULT unit's vault too.
    expect(await args('order_addon_items_immutable_identity')).toEqual(['id', 'order_id', 'addon_id', 'sku_id', 'price_minor', 'currency', 'added_at', 'added_by_type', 'added_by', 'vault_id']);
    expect(await args('addon_choices_immutable_identity')).toEqual(['id', 'live_entry_id', 'drop_entry_id', 'shop_request_id', 'addon_id']);
    // The view: the orders' holds UNION ALL the units held (since 0059, the units held at a location).
    expect(
      (await sql<{ def: string }>`SELECT pg_get_viewdef('stock_holds'::regclass, true) AS def`.execute(t.db)).rows[0]!.def.replace(/\s+/g, ' ').trim(),
    ).toBe(STOCK_HOLDS_0059);
  });

  it('0056: an add-on named once whatever the case, priced per house currency, with one SKU of its own (no model, no size, no fit) beside the models\' SKUs, which keep theirs; a unit on an order of its add-on\'s SKU only, each state with its own time and in order, who added it, back in stock only when returned, its identity fixed; a choice on exactly one owner, 1 to 3 units, once per add-on; the ledger moves a unit of its order only, never with a piece; stock_holds reads the orders\' holds and the units held; down refused while an add-on, a SKU, a unit or a choice exists, naming the counts', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const all = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows as T[];
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const insert = (table: string, cols: Record<string, string>) =>
      sql.raw<{ id: string }>(`INSERT INTO ${table} (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')}) RETURNING ${table === 'addon_item_prices' ? 'addon_id AS id' : 'id'}`).execute(t.db);
    const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

    // The previous image's SKU: it keeps its model, and has no add-on.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'ADDON HALO', 'RING', 'ADD0056') RETURNING id`)).id;
    const sized = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${model}', '52', 'ADD0056-52') RETURNING id`)).id;
    expect((await up(t.db)).applied).toEqual(['0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await one(`SELECT model_id, addon_id FROM skus WHERE id = '${sized}'`)).toEqual({ model_id: model, addon_id: null });

    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('addons-0056@orbes.test', 'addons-0056@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('addons-0056@example.com', 'addons-0056@example.com', 'scrypt$x') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('ADD-ONS 0056') RETURNING id`)).id;
    const supplier = (await one<{ id: string }>(`INSERT INTO suppliers (name) VALUES ('ADD-ONS 0056 SUPPLIER') RETURNING id`)).id;

    // An add-on: its name and line, weight, position, Shopify product.
    const addon = (cols: Record<string, string> = {}) => insert('addon_items', { name: `'POLISHING CLOTH'`, ...cols });
    for (const [cols, label, constraint] of [
      [{ name: `''` }, 'an empty name', 'addon_items_name_check'],
      [{ name: `' CLOTH'` }, 'a name not trimmed', 'addon_items_name_check'],
      [{ name: `'${'C'.repeat(41)}'` }, 'a name of 41 characters', 'addon_items_name_check'],
      [{ line: `''` }, 'an empty line', 'addon_items_line_check'],
      [{ line: `'${'L'.repeat(121)}'` }, 'a line of 121 characters', 'addon_items_line_check'],
      [{ weight_g: '0' }, 'a weight of 0', 'addon_items_weight_g_check'],
      [{ weight_g: '30001' }, 'a weight of 30 001 g', 'addon_items_weight_g_check'],
      [{ position: '-1' }, 'a position below 0', 'addon_items_position_check'],
      [{ position: '10001' }, 'a position above 10 000', 'addon_items_position_check'],
      [{ shopify_product_id: `'abc'` }, 'a Shopify id not a number', 'addon_items_shopify_product_id_check'],
    ] as const) {
      await check(addon(cols), label, constraint);
    }
    await nullRefused(addon({ name: 'NULL' }), 'an add-on without a name');
    await expect(addon({ supplier_id: `'00000000-0000-4000-8000-000000000000'` })).rejects.toSatisfy(isForeignKeyViolation);
    const cloth = await id(addon({ line: `'Keeps the metal bright.'`, supplier_id: `'${supplier}'`, weight_g: '30000', position: '10000', shopify_product_id: `'12345678901234567890'`, created_by: `'${admin}'` }));
    const pouch = await id(addon({ name: `'TRAVEL POUCH'` }));
    await expect(addon({ name: `'polishing cloth'` }), 'a name twice whatever the case').rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_items_name_key'));
    await expect(run(`UPDATE addon_items SET shopify_product_id = '12345678901234567890' WHERE id = '${pouch}'`)).rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_items_shopify_product_key'));
    expect(await one(`SELECT name, line, weight_g, position, active, created_by, created_at = updated_at AS fresh FROM addon_items WHERE id = '${pouch}'`)).toEqual({
      name: 'TRAVEL POUCH', line: null, weight_g: null, position: 0, active: true, created_by: null, fresh: true,
    });
    // Set aside and renamed: its identity fixed, its update stamped.
    await run(`UPDATE addon_items SET updated_at = created_at - interval '1 day' WHERE id = '${pouch}'`);
    await run(`UPDATE addon_items SET active = false, name = 'TRAVEL POUCH S' WHERE id = '${pouch}'`);
    expect(await one(`SELECT active, updated_at > created_at AS stamped FROM addon_items WHERE id = '${pouch}'`)).toEqual({ active: false, stamped: true });
    for (const sets of [`created_by = '${admin}'`, `created_at = now() - interval '1 day'`, `id = gen_random_uuid()`]) {
      await expect(run(`UPDATE addon_items SET ${sets} WHERE id = '${pouch}'`), sets).rejects.toSatisfy(isGuardViolation);
    }

    // Its prices: a house currency each, once.
    const price = (currency: string, minor: string, addonId = cloth) => insert('addon_item_prices', { addon_id: `'${addonId}'`, currency: `'${currency}'`, price_minor: minor, updated_by: `'${admin}'` });
    await check(price('JPY', '1500'), 'a currency the house does not sell in', 'addon_item_prices_currency_check');
    await check(price('EUR', '-1'), 'a price below 0', 'addon_item_prices_price_minor_check');
    await check(price('EUR', '100000001'), 'a price above 100 000 000', 'addon_item_prices_price_minor_check');
    for (const [currency, minor] of [['EUR', '1500'], ['GBP', '1300'], ['USD', '0'], ['CHF', '100000000']]) await price(currency, minor);
    await expect(price('EUR', '1600'), 'a currency priced twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_item_prices_pkey'));
    await expect(run(`UPDATE addon_item_prices SET currency = 'GBP' WHERE addon_id = '${cloth}' AND currency = 'EUR'`)).rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE addon_item_prices SET updated_at = '2026-10-01T10:00:00Z' WHERE addon_id = '${cloth}' AND currency = 'EUR'`);
    await run(`UPDATE addon_item_prices SET price_minor = 1600 WHERE addon_id = '${cloth}' AND currency = 'EUR'`);
    expect(await one(`SELECT price_minor, updated_at > '2026-10-01T10:00:00Z' AS stamped FROM addon_item_prices WHERE addon_id = '${cloth}' AND currency = 'EUR'`)).toEqual({ price_minor: 1600, stamped: true });

    // Its SKU: owned by the add-on alone, no size, no fit, one per add-on; two add-ons' SKUs side by side.
    const sku = (cols: Record<string, string>) => insert('skus', cols);
    await check(sku({ code: `'BOTH-0056'`, model_id: `'${model}'`, addon_id: `'${cloth}'` }), 'a SKU of a model and an add-on', 'skus_owner');
    await check(sku({ code: `'NONE-0056'` }), 'a SKU of no one', 'skus_owner');
    await check(sku({ code: `'SIZED-0056'`, addon_id: `'${cloth}'`, size_label: `'M'` }), 'an add-on\'s SKU with a size', 'skus_addon_plain');
    await check(sku({ code: `'FIT-0056'`, addon_id: `'${cloth}'`, fit_min_mm: '50', fit_max_mm: '52' }), 'an add-on\'s SKU with a fit', 'skus_addon_plain');
    const clothSku = await id(sku({ code: `'CLOTH-0056'`, addon_id: `'${cloth}'` }));
    const pouchSku = await id(sku({ code: `'POUCH-0056'`, addon_id: `'${pouch}'` }));
    await expect(sku({ code: `'CLOTH-0056-B'`, addon_id: `'${cloth}'` }), 'a second SKU of an add-on').rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_addon_id_key'));
    await expect(sku({ code: `'ADD0056-52B'`, model_id: `'${model}'`, size_label: `'52'` }), 'a model\'s size twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'skus_model_size_key'));
    for (const sets of [`addon_id = '${pouch}'`, `addon_id = NULL, model_id = '${model}'`]) {
      await expect(run(`UPDATE skus SET ${sets} WHERE id = '${clothSku}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`UPDATE skus SET addon_id = '${cloth}' WHERE id = '${sized}'`), 'a model\'s SKU given an add-on').rejects.toSatisfy(isGuardViolation);
    await expect(run(`DELETE FROM addon_items WHERE id = '${pouch}'`), 'an add-on with its SKU deleted').rejects.toSatisfy(isForeignKeyViolation);

    // An order: its piece is a model's SKU, never an add-on's.
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const order = (await one<{ id: string }>(`INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id, price_minor, currency) VALUES ('SALON', '${request}', '${account}', '${model}', '${location}', 1000, 'EUR') RETURNING id`)).id;
    await expect(run(`UPDATE orders SET sku_id = '${clothSku}' WHERE id = '${order}'`), 'an add-on\'s SKU as an order\'s piece').rejects.toSatisfy(isForeignKeyViolation);
    await run(`UPDATE orders SET sku_id = '${sized}', reservation = 'STOCK' WHERE id = '${order}'`);
    const other = (await one<{ id: string }>(`INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id) VALUES ('SALON', '${(await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id}', '${account}', '${model}', '${location}') RETURNING id`)).id;

    // A unit: of its add-on's SKU, at a location, priced in a house currency; each state with its own time.
    const unit = (cols: Record<string, string> = {}) =>
      insert('order_addon_items', { order_id: `'${order}'`, addon_id: `'${cloth}'`, sku_id: `'${clothSku}'`, location_id: `'${location}'`, price_minor: '1500', currency: `'EUR'`, added_by_type: `'PURCHASE'`, ...cols });
    await expect(unit({ sku_id: `'${pouchSku}'` }), 'a unit of another add-on\'s SKU').rejects.toSatisfy(isForeignKeyViolation);
    await expect(unit({ sku_id: `'${sized}'` }), 'a unit of a model\'s SKU').rejects.toSatisfy(isForeignKeyViolation);
    await expect(unit({ invoice_id: `'00000000-0000-4000-8000-000000000000'` })).rejects.toSatisfy(isForeignKeyViolation);
    for (const [cols, label, constraint] of [
      [{ price_minor: '-1' }, 'a price below 0', 'order_addon_items_price_minor_check'],
      [{ price_minor: '100000001' }, 'a price above 100 000 000', 'order_addon_items_price_minor_check'],
      [{ currency: `'JPY'` }, 'a currency the house does not sell in', 'order_addon_items_currency_check'],
      [{ status: `'LOST'` }, 'a state of no one', 'order_addon_items_status_check'],
      [{ added_by_type: `'GUEST'` }, 'an author of no kind', 'order_addon_items_added_by_type_check'],
      [{ shopify_line_item_id: `'0'` }, 'a Shopify line item of 0', 'order_addon_items_shopify_line_item_id_check'],
      [{ removed_at: 'now()' }, 'held with a removal', 'order_addon_items_status_times'],
      [{ status: `'REMOVED'` }, 'removed without its time', 'order_addon_items_status_times'],
      [{ status: `'CANCELLED'`, cancelled_at: 'now()', shipped_at: 'now()' }, 'cancelled and shipped', 'order_addon_items_status_times'],
      [{ status: `'SHIPPED'` }, 'shipped without its time', 'order_addon_items_status_times'],
      [{ status: `'RETURNED'`, returned_at: 'now()', returned_to_stock: 'true' }, 'returned without being shipped', 'order_addon_items_status_times'],
      [{ status: `'REMOVED'`, added_at: `'2026-10-02T10:00:00Z'`, removed_at: `'2026-10-01T10:00:00Z'` }, 'removed before it was added', 'order_addon_items_times'],
      [{ status: `'RETURNED'`, shipped_at: `'2026-10-02T10:00:00Z'`, returned_at: `'2026-10-01T10:00:00Z'`, returned_to_stock: 'true' }, 'returned before it was shipped', 'order_addon_items_times'],
      [{ status: `'RETURNED'`, shipped_at: 'now()', returned_at: 'now()' }, 'returned without saying where it goes', 'order_addon_items_returned'],
      [{ returned_to_stock: 'false' }, 'held and kept out of stock', 'order_addon_items_returned'],
      [{ added_by: `'${account}'` }, 'at the purchase with someone named', 'order_addon_items_added_by'],
      [{ added_by_type: `'COLLECTOR'` }, 'by the collector without their account', 'order_addon_items_added_by'],
    ] as const) {
      await check(unit(cols), label, constraint);
    }
    const first = await id(unit());
    const second = await id(unit({ added_by_type: `'COLLECTOR'`, added_by: `'${account}'`, shopify_line_item_id: `'4242'` }));
    const removed = await id(unit({ added_by_type: `'STAFF'`, added_by: `'${admin}'`, status: `'REMOVED'`, removed_at: 'now()' }));
    const byScript = await id(unit({ added_by_type: `'STAFF'`, price_minor: '0', currency: `'CHF'` }));
    await expect(unit({ shopify_line_item_id: `'4242'` }), 'a Shopify line item twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'order_addon_items_shopify_line_item_key'));
    expect(await one(`SELECT status, added_at <= now() AS added, returned_to_stock, invoice_id FROM order_addon_items WHERE id = '${first}'`)).toEqual({ status: 'HELD', added: true, returned_to_stock: null, invoice_id: null });
    for (const sets of [`price_minor = 1400`, `currency = 'GBP'`, `order_id = '${other}'`, `addon_id = '${pouch}', sku_id = '${pouchSku}'`, `added_by_type = 'STAFF'`, `added_by = '${admin}'`, `added_at = now() - interval '1 day'`]) {
      await expect(run(`UPDATE order_addon_items SET ${sets} WHERE id = '${second}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    // Its location moves with its order's.
    const away = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('ADD-ONS 0056 AWAY') RETURNING id`)).id;
    await run(`UPDATE order_addon_items SET location_id = '${away}' WHERE id = '${byScript}'`);
    await run(`UPDATE order_addon_items SET location_id = '${location}' WHERE id = '${byScript}'`);

    // stock_holds: the order's piece and the units held, nothing else.
    const holds = async () =>
      all<{ kind: string; id: string; sku_id: string; reservation: string; held_since_added: boolean }>(
        `SELECT h.kind, h.id, h.sku_id, h.reservation, h.reserved_at = coalesce(u.added_at, o.reserved_at) AS held_since_added
           FROM stock_holds h LEFT JOIN order_addon_items u ON u.id = h.id LEFT JOIN orders o ON o.id = h.id
          WHERE h.location_id = '${location}' ORDER BY h.kind DESC, h.id`,
      );
    const held = (unitId: string) => ({ kind: 'ADD_ON', id: unitId, sku_id: clothSku, reservation: 'STOCK', held_since_added: true });
    expect(await holds()).toEqual([
      { kind: 'PIECE', id: order, sku_id: sized, reservation: 'STOCK', held_since_added: true },
      ...[first, second, byScript].sort().map(held),
    ]);
    expect((await holds()).map((h) => h.id)).not.toContain(removed);
    // The order's other states: AWAITING is a hold too; none once it no longer holds.
    await run(`UPDATE orders SET reservation = 'AWAITING' WHERE id = '${order}'`);
    expect((await holds())[0]).toMatchObject({ kind: 'PIECE', reservation: 'AWAITING' });
    await run(`UPDATE orders SET reservation = NULL WHERE id = '${order}'`);

    // Shipped with its movement, of its order and SKU only, never with a piece; then returned.
    await run(`UPDATE order_addon_items SET status = 'SHIPPED', shipped_at = now() WHERE id = '${first}'`);
    const move = (cols: Record<string, string>) =>
      insert('stock_movements', { sku_id: `'${clothSku}'`, location_id: `'${location}'`, delta: '-1', reason: `'SHIPPED'`, order_id: `'${order}'`, actor_type: `'system'`, ...cols });
    await expect(move({ order_addon_item_id: `'${first}'`, order_id: `'${other}'` }), 'a unit moved for another order').rejects.toSatisfy(isForeignKeyViolation);
    await expect(move({ order_addon_item_id: `'${first}'`, sku_id: `'${sized}'` }), 'a unit moved as another SKU').rejects.toSatisfy(isForeignKeyViolation);
    await check(move({ order_addon_item_id: `'${first}'`, delta: '1', reason: `'ADJUSTED'`, order_id: 'NULL' }), 'a unit adjusted');
    await check(move({ order_addon_item_id: `'${first}'`, reason: `'TRANSFER_OUT'`, transfer_id: 'gen_random_uuid()', order_id: 'NULL' }), 'a unit transferred');
    await move({ order_addon_item_id: `'${first}'` });
    await run(`UPDATE order_addon_items SET status = 'RETURNED', returned_at = now(), returned_to_stock = true WHERE id = '${first}'`);
    await move({ order_addon_item_id: `'${first}'`, delta: '1', reason: `'RETURNED'` });
    expect(Number((await one<{ n: string }>(`SELECT sum(delta) AS n FROM stock_movements WHERE order_addon_item_id = '${first}'`)).n)).toBe(0);
    expect((await holds()).map((h) => h.id)).not.toContain(first);
    await expect(run(`DELETE FROM order_addon_items WHERE id = '${first}'`), 'a unit moved deleted').rejects.toSatisfy(isForeignKeyViolation);

    // A choice: on exactly one owner, 1 to 3 units, once per owner and add-on.
    const choice = (cols: Record<string, string>) => insert('addon_choices', { shop_request_id: `'${request}'`, addon_id: `'${cloth}'`, units: '1', ...cols });
    await check(choice({ shop_request_id: 'NULL' }), 'a choice on no one', 'addon_choices_owner');
    await check(choice({ live_entry_id: `'00000000-0000-4000-8000-000000000000'` }), 'a choice on two owners', 'addon_choices_owner');
    await check(choice({ units: '0' }), 'no unit', 'addon_choices_units_check');
    await check(choice({ units: '4' }), 'four units', 'addon_choices_units_check');
    for (const owner of ['live_entry_id', 'drop_entry_id']) {
      await expect(choice({ shop_request_id: 'NULL', [owner]: `'00000000-0000-4000-8000-000000000000'` }), owner).rejects.toSatisfy(isForeignKeyViolation);
    }
    const chosen = await id(choice({ units: '3' }));
    await choice({ addon_id: `'${pouch}'` });
    await expect(choice({}), 'an add-on chosen twice on one request').rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_choices_shop_request_key'));
    await run(`UPDATE addon_choices SET units = 2, chosen_at = now() WHERE id = '${chosen}'`);
    for (const sets of [`addon_id = '${pouch}'`, `shop_request_id = NULL`, `id = gen_random_uuid()`]) {
      await expect(run(`UPDATE addon_choices SET ${sets} WHERE id = '${chosen}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM shop_requests WHERE id = '${request}'`), 'a request with its choices deleted').rejects.toSatisfy(isForeignKeyViolation);

    // Down refuses while an add-on, a SKU, a unit or a choice exists, naming the counts; this database stays at 0056
    // (0057, which holds nothing here, goes down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    await expect(down(t.db)).rejects.toThrow(/0056_addons cannot be rolled back: 2 add-ons, 2 add-on SKUs, 4 add-on units on orders and 2 add-on choices exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0056_addons')?.executedAt).toBeDefined();
    await run(`DELETE FROM addon_choices`);
    await run(`ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_append_only`);
    await run(`DELETE FROM stock_movements WHERE order_addon_item_id IS NOT NULL`);
    await run(`ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_append_only`);
    await run(`DELETE FROM order_addon_items`);
    await expect(down(t.db)).rejects.toThrow(/cannot be rolled back: 2 add-ons, 2 add-on SKUs, 0 add-on units on orders and 0 add-on choices exist/);
    await run(`DELETE FROM skus WHERE addon_id IS NOT NULL`);
    await run(`DELETE FROM addon_item_prices`);
    await expect(down(t.db)).rejects.toThrow(/cannot be rolled back: 2 add-ons, 0 add-on SKUs, 0 add-on units on orders and 0 add-on choices exist/);
    await run(`DELETE FROM addon_items`);
    expect((await down(t.db)).reverted).toEqual(['0056_addons']);
    expect(await one(`SELECT model_id FROM skus WHERE id = '${sized}'`)).toEqual({ model_id: model });
    expect((await up(t.db)).applied).toEqual(['0056_addons', '0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    for (const q of [
      `DELETE FROM orders WHERE id IN ('${order}', '${other}')`,
      `DELETE FROM shop_requests WHERE account_id = '${account}'`,
      `DELETE FROM skus WHERE id = '${sized}'`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM stock_locations WHERE id IN ('${location}', '${away}')`,
      `DELETE FROM accounts WHERE id = '${account}'`,
      `ALTER TABLE suppliers DISABLE TRIGGER suppliers_no_delete`,
      `DELETE FROM suppliers WHERE id = '${supplier}'`,
      `ALTER TABLE suppliers ENABLE TRIGGER suppliers_no_delete`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await run(q);
    }
  });

  /**
   * What names an object of 0057 in a snapshot: sets, their pieces, the entries' and interests' sizes per piece, set sales,
   * and what it adds to drops, drop_sizes, the entries, orders and order cases.
   */
  const of0057 = (o: string) =>
    /\b(sets|set_models|set_sales|drop_entry_sizes|live_entry_sizes|live_interest_sizes)\b/.test(o) ||
    /^table (drops (model_id|set_id)|drop_sizes piece|orders (set_sale_id|set_piece)|order_cases group_id) /.test(o) ||
    /\b(drops_(set_id_fkey|set_id_idx|set_key|one_offer|set_no_after_room)|drop_sizes_(piece_check|piece_key|position_check|label_key)|(drop|live)_entries_entry_drop_key|orders_(piece_check|set_piece_check|set_sale|set_sale_fkey|set_sale_idx)|order_cases_group(_idx)?)\b/.test(o);
  /** The identity guards 0057 widens, as 0037 (orders, order cases) and 0021 (drop sizes) left them. */
  const ORDER_IDENTITY_0037 = ['id', 'channel', 'live_entry_id', 'piece', 'drop_entry_id', 'shop_request_id', 'drop_id', 'account_id', 'model_id', 'reserved_at', 'with_order_id', 'gift_grant_id', 'exchange_of_order_id'];
  const ORDER_CASE_IDENTITY_0037 = ['id', 'order_id', 'shipment_id', 'kind', 'opened_by_type', 'opened_by_id', 'opened_at', 'reason', 'note', 'exchange_sku_id', 'exchange_size_label', 'message_id'];

  it('0057 adds THE SET (sets and their pieces, a release of a model or a set, its sizes per piece, the entries\' and interests\' sizes per piece, set sales, an order\'s set sale and piece, a return case\'s group), and nothing else; down restores 0056 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0057_sets');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new tables' too, as in 0054's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL "?\w+"?$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    // What 0057 changes of 0056: drops.model_id NULL-able, a size's label once per piece, its position up to 96, an
    // order's piece up to 20 on a set sale's (T4).
    const changed = [
      'constraint drop_sizes drop_sizes_label_key UNIQUE (drop_id, label)',
      'constraint drop_sizes drop_sizes_position_check CHECK ((("position" >= 1) AND ("position" <= 24)))',
      'constraint orders orders_piece_check CHECK (((piece >= 1) AND (piece <= 5)))',
      'index CREATE UNIQUE INDEX drop_sizes_label_key ON public.drop_sizes USING btree (drop_id, label)',
      'table drops model_id uuid NO ',
    ];
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual(changed);
    expect(added.filter((o) => !of0057(o))).toEqual([]);
    expect(before.filter((o) => of0057(o) && !notNull(o))).toEqual(changed);
    expect(added.filter((o) => o.startsWith('table ')).map((o) => o.split(' ').slice(1, 3).join(' '))).toEqual([
      'drop_entry_sizes drop_id', 'drop_entry_sizes entry_id', 'drop_entry_sizes piece', 'drop_entry_sizes size_id',
      'drop_sizes piece', 'drops model_id', 'drops set_id',
      'live_entry_sizes drop_id', 'live_entry_sizes entry_id', 'live_entry_sizes piece', 'live_entry_sizes size_id',
      'live_interest_sizes account_id', 'live_interest_sizes drop_id', 'live_interest_sizes piece', 'live_interest_sizes size_id',
      'order_cases group_id', 'orders set_piece', 'orders set_sale_id',
      'set_models model_id', 'set_models position', 'set_models set_id',
      'set_sales account_id', 'set_sales created_at', 'set_sales currency', 'set_sales drop_id', 'set_sales id', 'set_sales price_minor', 'set_sales set_id', 'set_sales shopify_line_item_id',
      'sets active', 'sets base_currency', 'sets base_price_minor', 'sets code', 'sets created_at', 'sets created_by', 'sets id', 'sets name', 'sets shopify_product_id', 'sets updated_at',
    ]);
    expect(added).toContain('table drops model_id uuid YES ');
    expect(added).toContain('table sets active boolean NO true');
    expect(added).toContain('table set_sales drop_id uuid YES ');
    expect(added.filter((o) => o.startsWith('constraint ')).map((o) => o.split(' ').slice(1, 3).join(' '))).toEqual([
      'drop_entries drop_entries_entry_drop_key',
      'drop_entry_sizes drop_entry_sizes_entry_fkey', 'drop_entry_sizes drop_entry_sizes_piece_check', 'drop_entry_sizes drop_entry_sizes_pkey', 'drop_entry_sizes drop_entry_sizes_size_fkey',
      'drop_sizes drop_sizes_label_key', 'drop_sizes drop_sizes_piece_check', 'drop_sizes drop_sizes_piece_key', 'drop_sizes drop_sizes_position_check',
      'drops drops_one_offer', 'drops drops_set_id_fkey', 'drops drops_set_key', 'drops drops_set_no_after_room',
      'live_entries live_entries_entry_drop_key',
      'live_entry_sizes live_entry_sizes_entry_fkey', 'live_entry_sizes live_entry_sizes_piece_check', 'live_entry_sizes live_entry_sizes_pkey', 'live_entry_sizes live_entry_sizes_size_fkey',
      'live_interest_sizes live_interest_sizes_interest_fkey', 'live_interest_sizes live_interest_sizes_piece_check', 'live_interest_sizes live_interest_sizes_pkey', 'live_interest_sizes live_interest_sizes_size_fkey',
      'order_cases order_cases_group', 'orders orders_piece_check', 'orders orders_set_piece_check', 'orders orders_set_sale', 'orders orders_set_sale_fkey',
      'set_models set_models_model_id_fkey', 'set_models set_models_model_key', 'set_models set_models_pkey', 'set_models set_models_position_check', 'set_models set_models_set_id_fkey',
      'set_sales set_sales_account_id_fkey', 'set_sales set_sales_currency_check', 'set_sales set_sales_drop_fkey', 'set_sales set_sales_pkey', 'set_sales set_sales_price', 'set_sales set_sales_price_minor_check',
      'set_sales set_sales_sale_account_key', 'set_sales set_sales_set_id_fkey', 'set_sales set_sales_shopify_line_item_id_check', 'set_sales set_sales_shopify_line_item_key',
      'sets sets_base_currency_check', 'sets sets_base_price', 'sets sets_base_price_minor_check', 'sets sets_code_check', 'sets sets_code_key', 'sets sets_created_by_fkey', 'sets sets_name_check', 'sets sets_pkey',
      'sets sets_shopify_product_id_check', 'sets sets_shopify_product_key',
    ]);
    for (const def of [
      'constraint drops drops_one_offer CHECK ((num_nonnulls(model_id, set_id) = 1))',
      'constraint drops drops_set_no_after_room CHECK (((set_id IS NULL) OR (parent_drop_id IS NULL)))',
      'constraint drop_sizes drop_sizes_label_key UNIQUE NULLS NOT DISTINCT (drop_id, piece, label)',
      'constraint drop_sizes drop_sizes_position_check CHECK ((("position" >= 1) AND ("position" <= 96)))',
      'constraint drop_entry_sizes drop_entry_sizes_entry_fkey FOREIGN KEY (entry_id, drop_id) REFERENCES drop_entries(id, drop_id) ON DELETE RESTRICT',
      'constraint drop_entry_sizes drop_entry_sizes_size_fkey FOREIGN KEY (size_id, drop_id, piece) REFERENCES drop_sizes(id, drop_id, piece) ON DELETE RESTRICT',
      'constraint live_interest_sizes live_interest_sizes_interest_fkey FOREIGN KEY (drop_id, account_id) REFERENCES live_interest(drop_id, account_id) ON DELETE RESTRICT',
      'constraint set_sales set_sales_drop_fkey FOREIGN KEY (drop_id, set_id) REFERENCES drops(id, set_id) ON DELETE RESTRICT',
      'constraint set_sales set_sales_price CHECK (((price_minor IS NULL) = (currency IS NULL)))',
      'constraint orders orders_set_sale CHECK (((set_sale_id IS NULL) = (set_piece IS NULL)))',
      'constraint orders orders_piece_check CHECK ((((piece >= 1) AND (piece <= 20)) AND ((piece <= 5) OR (set_sale_id IS NOT NULL))))',
      'constraint orders orders_set_sale_fkey FOREIGN KEY (set_sale_id, account_id) REFERENCES set_sales(id, account_id) ON DELETE RESTRICT',
      "constraint order_cases order_cases_group CHECK (((group_id IS NULL) OR (kind = 'RETURN'::text)))",
      "constraint sets sets_code_check CHECK ((code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'::text))",
      'constraint sets sets_name_check CHECK ((((length(name) >= 1) AND (length(name) <= 60)) AND (name = btrim(name))))',
    ]) {
      expect(added, def).toContain(def);
    }
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX drop_entry_sizes_size_idx ON public.drop_entry_sizes USING btree (size_id)',
      'index CREATE INDEX drops_set_id_idx ON public.drops USING btree (set_id)',
      'index CREATE INDEX live_entry_sizes_size_idx ON public.live_entry_sizes USING btree (size_id)',
      'index CREATE INDEX live_interest_sizes_size_idx ON public.live_interest_sizes USING btree (size_id)',
      'index CREATE INDEX order_cases_group_idx ON public.order_cases USING btree (group_id)',
      'index CREATE INDEX orders_set_sale_idx ON public.orders USING btree (set_sale_id)',
      'index CREATE INDEX set_models_model_idx ON public.set_models USING btree (model_id)',
      'index CREATE INDEX set_sales_account_idx ON public.set_sales USING btree (account_id)',
      'index CREATE INDEX set_sales_drop_idx ON public.set_sales USING btree (drop_id)',
      'index CREATE INDEX set_sales_set_idx ON public.set_sales USING btree (set_id)',
      'index CREATE INDEX sets_created_by_idx ON public.sets USING btree (created_by)',
      'index CREATE UNIQUE INDEX drop_entries_entry_drop_key ON public.drop_entries USING btree (id, drop_id)',
      'index CREATE UNIQUE INDEX drop_entry_sizes_pkey ON public.drop_entry_sizes USING btree (entry_id, piece)',
      'index CREATE UNIQUE INDEX drop_sizes_label_key ON public.drop_sizes USING btree (drop_id, piece, label) NULLS NOT DISTINCT',
      'index CREATE UNIQUE INDEX drop_sizes_piece_key ON public.drop_sizes USING btree (id, drop_id, piece)',
      'index CREATE UNIQUE INDEX drops_set_key ON public.drops USING btree (id, set_id)',
      'index CREATE UNIQUE INDEX live_entries_entry_drop_key ON public.live_entries USING btree (id, drop_id)',
      'index CREATE UNIQUE INDEX live_entry_sizes_pkey ON public.live_entry_sizes USING btree (entry_id, piece)',
      'index CREATE UNIQUE INDEX live_interest_sizes_pkey ON public.live_interest_sizes USING btree (drop_id, account_id, piece)',
      'index CREATE UNIQUE INDEX set_models_model_key ON public.set_models USING btree (set_id, model_id)',
      'index CREATE UNIQUE INDEX set_models_pkey ON public.set_models USING btree (set_id, "position")',
      'index CREATE UNIQUE INDEX set_sales_pkey ON public.set_sales USING btree (id)',
      'index CREATE UNIQUE INDEX set_sales_sale_account_key ON public.set_sales USING btree (id, account_id)',
      'index CREATE UNIQUE INDEX set_sales_shopify_line_item_key ON public.set_sales USING btree (shopify_line_item_id)',
      'index CREATE UNIQUE INDEX sets_code_key ON public.sets USING btree (code)',
      'index CREATE UNIQUE INDEX sets_name_key ON public.sets USING btree (lower(name))',
      'index CREATE UNIQUE INDEX sets_pkey ON public.sets USING btree (id)',
      'index CREATE UNIQUE INDEX sets_shopify_product_key ON public.sets USING btree (shopify_product_id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger drop_entry_sizes drop_entry_sizes_immutable_identity',
      'trigger live_entry_sizes live_entry_sizes_immutable_identity',
      'trigger live_interest_sizes live_interest_sizes_immutable_identity',
      'trigger set_sales set_sales_immutable_identity',
      'trigger sets sets_immutable_identity',
      'trigger sets sets_touch_updated_at',
    ]);
    // The identity guards of 0021 and 0037, without the set's columns; with them once up again.
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    expect(await args('drop_sizes_immutable_identity')).toEqual(['id', 'drop_id']);
    expect(await args('orders_immutable_identity')).toEqual(ORDER_IDENTITY_0037);
    expect(await args('order_cases_immutable_identity')).toEqual(ORDER_CASE_IDENTITY_0037);
    expect((await up(t.db)).applied).toEqual(['0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('drop_sizes_immutable_identity')).toEqual(['id', 'drop_id', 'piece']);
    // (0062, the vault's rewards, adds a VAULT order's vault.)
    expect(await args('orders_immutable_identity')).toEqual([...ORDER_IDENTITY_0037, 'set_sale_id', 'set_piece', 'vault_id']);
    expect(await args('order_cases_immutable_identity')).toEqual([...ORDER_CASE_IDENTITY_0037, 'group_id']);
    expect(await args('sets_immutable_identity')).toEqual(['id', 'created_at', 'created_by']);
    expect(await args('set_sales_immutable_identity')).toEqual(['id', 'set_id', 'drop_id', 'account_id', 'created_at']);
    for (const table of ['drop_entry_sizes', 'live_entry_sizes']) expect(await args(`${table}_immutable_identity`), table).toEqual(['entry_id', 'drop_id', 'piece']);
    expect(await args('live_interest_sizes_immutable_identity')).toEqual(['drop_id', 'account_id', 'piece']);
  });

  it('0057: a set named once whatever the case, its code once, its base price with its currency, its Shopify product once, its identity fixed and its update stamped; its pieces at positions 1 to 4, each model once; a release of a model or a set, exactly one, a set\'s never an after-room; a size per piece, its label once per piece, positions to 96, its piece fixed; an entry\'s and an interest\'s size of their own release and piece, one per piece, changed but never moved; a set sale of a release of its set or of none, its price with its currency, its Shopify line item once, its identity fixed; an order\'s set sale and piece both or neither, of its own account, fixed; a group on return cases only, fixed; the previous image\'s rows have none; down refused while a set, a set release, a set sale, a grouped case or a size per piece exists, naming the counts', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const fk = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isForeignKeyViolation(e, constraint));
    const insert = (table: string, cols: Record<string, string>, returning = 'id') =>
      sql.raw<{ id: string }>(`INSERT INTO ${table} (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')}) RETURNING ${returning} AS id`).execute(t.db);
    const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;
    const seedHash = `'\\x${'00'.repeat(32)}'::bytea`;
    const draw = (cols: Record<string, string>) =>
      insert('drops', { title: `'SET 0057'`, quantity: '4', opens_at: `'2026-12-01T10:00:00Z'`, closes_at: `'2026-12-02T10:00:00Z'`, seed_enc: `'v1.${'A'.repeat(16)}.${'B'.repeat(64)}'`, seed_hash: seedHash, ...cols });

    // The previous image's release, size, entry, order and case: a model's, with none of the set's.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    const ring = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'SET RING', 'RING', 'SET0057R') RETURNING id`)).id;
    const chain = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'SET CHAIN', 'NECKLACE', 'SET0057C') RETURNING id`)).id;
    const cuff = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'SET CUFF', 'BRACELET', 'SET0057B') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('sets-0057@example.com', 'sets-0057@example.com', 'scrypt$x') RETURNING id`)).id;
    const other = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('sets-0057-b@example.com', 'sets-0057-b@example.com', 'scrypt$x') RETURNING id`)).id;
    const admin = (await one<{ id: string }>(`INSERT INTO admin_users (email_normalized, email, password_hash, role) VALUES ('sets-0057@orbes.test', 'sets-0057@orbes.test', 'scrypt$x', 'ADMIN') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('SETS 0057') RETURNING id`)).id;
    const modelDraw = await id(draw({ model_id: `'${ring}'` }));
    const modelSize = await id(insert('drop_sizes', { drop_id: `'${modelDraw}'`, label: `'52'`, position: '24', stock: '2' }));
    const modelEntry = await id(insert('drop_entries', { drop_id: `'${modelDraw}'`, account_id: `'${account}'`, size_id: `'${modelSize}'` }));
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${ring}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id;
    const salonOrder = await id(insert('orders', { channel: `'SALON'`, shop_request_id: `'${request}'`, account_id: `'${account}'`, model_id: `'${ring}'`, location_id: `'${location}'` }));
    const salonCase = await id(insert('order_cases', { order_id: `'${salonOrder}'`, kind: `'RETURN'`, reason: `'SIZE'`, opened_by_type: `'admin'`, opened_by_id: `'${admin}'` }));
    expect((await up(t.db)).applied).toEqual(['0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await one(`SELECT model_id, set_id FROM drops WHERE id = '${modelDraw}'`)).toEqual({ model_id: ring, set_id: null });
    expect(await one(`SELECT piece, position FROM drop_sizes WHERE id = '${modelSize}'`)).toEqual({ piece: null, position: 24 });
    expect(await one(`SELECT set_sale_id, set_piece FROM orders WHERE id = '${salonOrder}'`)).toEqual({ set_sale_id: null, set_piece: null });
    expect(await one(`SELECT group_id FROM order_cases WHERE id = '${salonCase}'`)).toEqual({ group_id: null });

    // A set: its name, code, base price and Shopify product.
    const set = (cols: Record<string, string> = {}) => insert('sets', { name: `'THE PAIR'`, code: `'THE-PAIR'`, ...cols });
    for (const [cols, label, constraint] of [
      [{ name: `''` }, 'an empty name', 'sets_name_check'],
      [{ name: `' THE PAIR'` }, 'a name not trimmed', 'sets_name_check'],
      [{ name: `'${'P'.repeat(61)}'` }, 'a name of 61 characters', 'sets_name_check'],
      [{ code: `'the-pair'` }, 'a code in lower case', 'sets_code_check'],
      [{ code: `'-PAIR'` }, 'a code starting with a hyphen', 'sets_code_check'],
      [{ code: `'P'` }, 'a code of one character', 'sets_code_check'],
      [{ code: `'${'P'.repeat(41)}'` }, 'a code of 41 characters', 'sets_code_check'],
      [{ code: `'THE PAIR'` }, 'a code with a space', 'sets_code_check'],
      [{ base_price_minor: '90000' }, 'a price without its currency', 'sets_base_price'],
      [{ base_currency: `'EUR'` }, 'a currency without its price', 'sets_base_price'],
      [{ base_price_minor: '-1', base_currency: `'EUR'` }, 'a price below 0', 'sets_base_price_minor_check'],
      [{ base_price_minor: '100000001', base_currency: `'EUR'` }, 'a price above 100 000 000', 'sets_base_price_minor_check'],
      [{ base_price_minor: '90000', base_currency: `'eur'` }, 'a currency in lower case', 'sets_base_currency_check'],
      [{ shopify_product_id: `'0'` }, 'a Shopify product of 0', 'sets_shopify_product_id_check'],
    ] as const) {
      await check(set(cols), label, constraint);
    }
    await expect(set({ created_by: `'00000000-0000-4000-8000-000000000000'` })).rejects.toSatisfy(isForeignKeyViolation);
    const pair = await id(set({ base_price_minor: '90000', base_currency: `'EUR'`, shopify_product_id: `'12345678901234567890'`, created_by: `'${admin}'` }));
    const trio = await id(set({ name: `'THE TRIO'`, code: `'THE-TRIO-3'` }));
    await expect(set({ name: `'the pair'`, code: `'OTHER'` }), 'a name twice whatever the case').rejects.toSatisfy((e) => isUniqueViolation(e, 'sets_name_key'));
    await expect(set({ name: `'OTHER'` }), 'a code twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'sets_code_key'));
    await expect(run(`UPDATE sets SET shopify_product_id = '12345678901234567890' WHERE id = '${trio}'`), 'a Shopify product twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'sets_shopify_product_key'));
    expect(await one(`SELECT active, base_price_minor, base_currency, created_by, created_at = updated_at AS fresh FROM sets WHERE id = '${trio}'`)).toEqual({ active: true, base_price_minor: null, base_currency: null, created_by: null, fresh: true });
    // Set aside, renamed and recoded: its identity fixed, its update stamped.
    await run(`UPDATE sets SET updated_at = created_at - interval '1 day' WHERE id = '${trio}'`);
    await run(`UPDATE sets SET active = false, name = 'THE TRIO II', code = 'THE-TRIO-II' WHERE id = '${trio}'`);
    expect(await one(`SELECT active, updated_at > created_at AS stamped FROM sets WHERE id = '${trio}'`)).toEqual({ active: false, stamped: true });
    for (const sets of [`created_by = '${admin}'`, `created_at = now() - interval '1 day'`, `id = gen_random_uuid()`]) {
      await expect(run(`UPDATE sets SET ${sets} WHERE id = '${trio}'`), sets).rejects.toSatisfy(isGuardViolation);
    }

    // Its pieces: positions 1 to 4, each model once.
    const piece = (setId: string, position: string, model: string) => run(`INSERT INTO set_models (set_id, position, model_id) VALUES ('${setId}', ${position}, '${model}')`);
    await check(piece(pair, '0', ring), 'a position of 0', 'set_models_position_check');
    await check(piece(pair, '5', ring), 'a fifth piece', 'set_models_position_check');
    await fk(piece(pair, '1', '00000000-0000-4000-8000-000000000000'), 'a model of no one', 'set_models_model_id_fkey');
    await piece(pair, '1', ring);
    await piece(pair, '2', chain);
    await expect(piece(pair, '3', ring), 'a model twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'set_models_model_key'));
    await expect(piece(pair, '2', cuff), 'a position twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'set_models_pkey'));
    for (const [position, model] of [['1', ring], ['2', chain], ['3', cuff]] as const) await piece(trio, position, model);
    await fk(run(`DELETE FROM models WHERE id = '${cuff}'`), 'a model of a set deleted');

    // A release sells a model or a set, exactly one; a set's is never an after-room.
    await check(draw({}), 'a release of nothing', 'drops_one_offer');
    await check(draw({ model_id: `'${ring}'`, set_id: `'${pair}'` }), 'a release of a model and a set', 'drops_one_offer');
    await fk(draw({ set_id: `'00000000-0000-4000-8000-000000000000'` }), 'a set of no one', 'drops_set_id_fkey');
    const setDraw = await id(draw({ set_id: `'${pair}'` }));
    expect(await one(`SELECT model_id, set_id FROM drops WHERE id = '${setDraw}'`)).toEqual({ model_id: null, set_id: pair });
    const setLive = await liveDrop(ring);
    await run(`UPDATE drops SET model_id = NULL, set_id = '${pair}' WHERE id = '${setLive}'`);
    const liveParent = await liveDrop(ring);
    const afterRoom = await liveDrop(ring, AFTER_ROOM(liveParent));
    await check(run(`UPDATE drops SET model_id = NULL, set_id = '${pair}' WHERE id = '${afterRoom}'`), 'a set\'s after-room', 'drops_set_no_after_room');
    await fk(run(`DELETE FROM sets WHERE id = '${pair}'`), 'a set with its release deleted');

    // Its sizes per piece: 1 to 4, positions to 96, a label once per piece, the piece fixed.
    const size = (drop: string, cols: Record<string, string>) => insert('drop_sizes', { drop_id: `'${drop}'`, stock: '2', ...cols });
    await check(size(setDraw, { piece: '0', label: `'52'`, position: '1' }), 'a piece 0', 'drop_sizes_piece_check');
    await check(size(setDraw, { piece: '5', label: `'52'`, position: '1' }), 'a fifth piece', 'drop_sizes_piece_check');
    await check(size(setDraw, { piece: '1', label: `'52'`, position: '97' }), 'a 97th size', 'drop_sizes_position_check');
    const ring52 = await id(size(setDraw, { piece: '1', label: `'52'`, position: '1' }));
    const ring54 = await id(size(setDraw, { piece: '1', label: `'54'`, position: '2' }));
    const chain52 = await id(size(setDraw, { piece: '2', label: `'52'`, position: '25' }));
    const chain45 = await id(size(setDraw, { piece: '2', label: `'45'`, position: '96' }));
    await expect(size(setDraw, { piece: '2', label: `'45'`, position: '26' }), 'a label twice in a piece').rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_sizes_label_key'));
    await expect(size(modelDraw, { label: `'52'`, position: '1' }), 'a label twice in a model\'s release').rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_sizes_label_key'));
    const modelSize25 = await id(size(modelDraw, { label: `'56'`, position: '25' }));
    await expect(run(`UPDATE drop_sizes SET piece = 2 WHERE id = '${ring54}'`), 'a size moved to another piece').rejects.toSatisfy(isGuardViolation);
    await run(`UPDATE drop_sizes SET stock = 3, label = '53' WHERE id = '${ring54}'`);

    // A draw entry's sizes: one per piece, of its release and that piece; changed, never moved.
    const setEntry = await id(insert('drop_entries', { drop_id: `'${setDraw}'`, account_id: `'${account}'` }));
    const entrySize = (cols: Record<string, string>) => insert('drop_entry_sizes', { entry_id: `'${setEntry}'`, drop_id: `'${setDraw}'`, ...cols }, 'size_id');
    await check(entrySize({ piece: '5', size_id: `'${ring52}'` }), 'a fifth piece', 'drop_entry_sizes_piece_check');
    await fk(entrySize({ piece: '2', size_id: `'${ring52}'` }), 'a size of another piece', 'drop_entry_sizes_size_fkey');
    await fk(entrySize({ piece: '1', size_id: `'${modelSize}'` }), 'a size of another release', 'drop_entry_sizes_size_fkey');
    await fk(insert('drop_entry_sizes', { entry_id: `'${modelEntry}'`, drop_id: `'${setDraw}'`, piece: '1', size_id: `'${ring52}'` }, 'size_id'), 'an entry of another release', 'drop_entry_sizes_entry_fkey');
    await entrySize({ piece: '1', size_id: `'${ring52}'` });
    await entrySize({ piece: '2', size_id: `'${chain45}'` });
    await expect(entrySize({ piece: '1', size_id: `'${ring54}'` }), 'a piece twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_entry_sizes_pkey'));
    await run(`UPDATE drop_entry_sizes SET size_id = '${ring54}' WHERE entry_id = '${setEntry}' AND piece = 1`);
    for (const sets of [`piece = 3`, `entry_id = '${modelEntry}'`, `drop_id = '${modelDraw}'`]) {
      await expect(run(`UPDATE drop_entry_sizes SET ${sets} WHERE entry_id = '${setEntry}' AND piece = 2`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await fk(run(`DELETE FROM drop_sizes WHERE id = '${chain45}'`), 'a size chosen deleted');

    // A LIVE entry's and an interest's sizes: one per piece, of their release and that piece; the first piece's in size_id.
    const liveRing = await id(size(setLive, { piece: '1', label: `'52'`, position: '1' }));
    const liveChain = await id(size(setLive, { piece: '2', label: `'45'`, position: '25' }));
    const liveEntry = (await one<{ id: string }>(`INSERT INTO live_entries (drop_id, account_id, size_id, quantity, tier) VALUES ('${setLive}', '${account}', '${liveRing}', 1, 0) RETURNING id`)).id;
    const liveSize = (cols: Record<string, string>) => insert('live_entry_sizes', { entry_id: `'${liveEntry}'`, drop_id: `'${setLive}'`, ...cols }, 'size_id');
    await fk(liveSize({ piece: '1', size_id: `'${ring52}'` }), 'a size of another release', 'live_entry_sizes_size_fkey');
    await fk(liveSize({ piece: '2', size_id: `'${liveRing}'` }), 'a size of another piece', 'live_entry_sizes_size_fkey');
    await liveSize({ piece: '1', size_id: `'${liveRing}'` });
    await liveSize({ piece: '2', size_id: `'${liveChain}'` });
    await expect(run(`UPDATE live_entry_sizes SET piece = 3 WHERE entry_id = '${liveEntry}' AND piece = 2`)).rejects.toSatisfy(isGuardViolation);
    await run(`INSERT INTO live_interest (drop_id, account_id, size_id) VALUES ('${setLive}', '${other}', '${liveRing}')`);
    const interestSize = (cols: Record<string, string>) => insert('live_interest_sizes', { drop_id: `'${setLive}'`, account_id: `'${other}'`, ...cols }, 'size_id');
    await fk(interestSize({ account_id: `'${account}'`, piece: '1', size_id: `'${liveRing}'` }), 'the size of no interest', 'live_interest_sizes_interest_fkey');
    await check(interestSize({ piece: '0', size_id: `'${liveRing}'` }), 'a piece 0', 'live_interest_sizes_piece_check');
    await interestSize({ piece: '1', size_id: `'${liveRing}'` });
    await interestSize({ piece: '2', size_id: `'${liveChain}'` });
    await expect(run(`UPDATE live_interest_sizes SET account_id = '${account}' WHERE account_id = '${other}' AND piece = 1`)).rejects.toSatisfy(isGuardViolation);
    // I'LL BE THERE withdrawn: its sizes go first (RESTRICT, as every foreign key).
    await fk(run(`DELETE FROM live_interest WHERE drop_id = '${setLive}' AND account_id = '${other}'`), 'an interest with its sizes deleted', 'live_interest_sizes_interest_fkey');

    // A set sale: of a release of its set, or of none (a sale on the store); its price with its currency; its line item once.
    const sale = (cols: Record<string, string> = {}) => insert('set_sales', { set_id: `'${pair}'`, drop_id: `'${setDraw}'`, account_id: `'${account}'`, price_minor: '90000', currency: `'EUR'`, ...cols });
    for (const [cols, label, constraint] of [
      [{ currency: 'NULL' }, 'a price without its currency', 'set_sales_price'],
      [{ price_minor: 'NULL' }, 'a currency without its price', 'set_sales_price'],
      [{ price_minor: '-1' }, 'a price below 0', 'set_sales_price_minor_check'],
      [{ price_minor: '100000001' }, 'a price above 100 000 000', 'set_sales_price_minor_check'],
      [{ currency: `'EURO'` }, 'a currency of four letters', 'set_sales_currency_check'],
      [{ shopify_line_item_id: `'x1'` }, 'a Shopify line item not a number', 'set_sales_shopify_line_item_id_check'],
    ] as const) {
      await check(sale(cols), label, constraint);
    }
    await fk(sale({ set_id: `'${trio}'` }), 'a release of another set', 'set_sales_drop_fkey');
    await fk(sale({ drop_id: `'${modelDraw}'` }), 'a model\'s release', 'set_sales_drop_fkey');
    const sold = await id(sale({ shopify_line_item_id: `'4242'` }));
    const unpriced = await id(sale({ price_minor: 'NULL', currency: 'NULL' }));
    const store = await id(sale({ drop_id: 'NULL', set_id: `'${trio}'`, account_id: `'${other}'` }));
    await expect(sale({ shopify_line_item_id: `'4242'` }), 'a line item twice').rejects.toSatisfy((e) => isUniqueViolation(e, 'set_sales_shopify_line_item_key'));
    await run(`UPDATE set_sales SET price_minor = 85000, currency = 'EUR' WHERE id = '${unpriced}'`);
    for (const sets of [`set_id = '${trio}'`, `drop_id = NULL`, `account_id = '${other}'`, `created_at = now() - interval '1 day'`]) {
      await expect(run(`UPDATE set_sales SET ${sets} WHERE id = '${sold}'`), sets).rejects.toSatisfy(isGuardViolation);
    }

    // Its orders: one per piece, its set sale and piece both or neither, of the buyer's account, fixed.
    await run(`UPDATE drop_entries SET status = 'CONFIRMED', tier = 0, seniority = 0, rank = 1, respond_by = now(), handled_at = now() WHERE id = '${setEntry}'`);
    const order = (cols: Record<string, string>) =>
      insert('orders', { channel: `'DRAW'`, drop_entry_id: `'${setEntry}'`, drop_id: `'${setDraw}'`, account_id: `'${account}'`, model_id: `'${ring}'`, location_id: `'${location}'`, price_minor: '50000', currency: `'EUR'`, ...cols });
    await check(order({ piece: '1', set_sale_id: `'${sold}'` }), 'a set sale without its piece', 'orders_set_sale');
    await check(order({ piece: '1', set_piece: '1' }), 'a piece without its set sale', 'orders_set_sale');
    await check(order({ piece: '1', set_sale_id: `'${sold}'`, set_piece: '5' }), 'a fifth piece', 'orders_set_piece_check');
    await fk(order({ piece: '1', set_sale_id: `'${store}'`, set_piece: '1' }), 'another account\'s set sale', 'orders_set_sale_fkey');
    const first = await id(order({ piece: '1', set_sale_id: `'${sold}'`, set_piece: '1' }));
    const second = await id(order({ piece: '2', model_id: `'${chain}'`, price_minor: '40000', set_sale_id: `'${sold}'`, set_piece: '2', with_order_id: `'${first}'` }));
    for (const sets of [`set_sale_id = '${unpriced}'`, `set_piece = 1`, `set_sale_id = NULL, set_piece = NULL`]) {
      await expect(run(`UPDATE orders SET ${sets} WHERE id = '${second}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await fk(run(`DELETE FROM set_sales WHERE id = '${sold}'`), 'a set sale with its orders deleted');
    // A LIVE entry's orders: pieces 1 to 5, to 20 on a set sale's (T4: up to 5 sets of up to 4 pieces).
    const liveOrder = (cols: Record<string, string>) =>
      insert('orders', { channel: `'LIVE'`, live_entry_id: `'${liveEntry}'`, drop_id: `'${setLive}'`, account_id: `'${account}'`, model_id: `'${ring}'`, location_id: `'${location}'`, price_minor: '50000', currency: `'EUR'`, ...cols });
    await check(liveOrder({ piece: '6' }), 'a sixth piece without a set sale', 'orders_piece_check');
    await check(liveOrder({ piece: '21', set_sale_id: `'${sold}'`, set_piece: '1' }), 'a 21st piece', 'orders_piece_check');
    await check(liveOrder({ piece: '0', set_sale_id: `'${sold}'`, set_piece: '1' }), 'a piece 0', 'orders_piece_check');
    const twentieth = await id(liveOrder({ piece: '20', set_sale_id: `'${sold}'`, set_piece: '4' }));
    await run(`DELETE FROM orders WHERE id = '${twentieth}'`);

    // Its return: the pieces' cases in one group, RETURN only, the group fixed.
    const group = '00000000-0000-4000-8000-000000000057';
    const kase = (cols: Record<string, string>) => insert('order_cases', { opened_by_type: `'account'`, opened_by_id: `'${account}'`, reason: `'SIZE'`, ...cols });
    const sku54 = (await one<{ id: string }>(`INSERT INTO skus (model_id, size_label, code) VALUES ('${ring}', '54', 'SET0057R-54') RETURNING id`)).id;
    await check(kase({ order_id: `'${first}'`, kind: `'EXCHANGE'`, exchange_sku_id: `'${sku54}'`, exchange_size_label: `'54'`, group_id: `'${group}'` }), 'an exchange in a group', 'order_cases_group');
    const firstCase = await id(kase({ order_id: `'${first}'`, kind: `'RETURN'`, group_id: `'${group}'` }));
    await kase({ order_id: `'${second}'`, kind: `'RETURN'`, group_id: `'${group}'` });
    await expect(run(`UPDATE order_cases SET group_id = NULL WHERE id = '${firstCase}'`)).rejects.toSatisfy(isGuardViolation);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM order_cases WHERE group_id = '${group}'`)).n)).toBe(2);

    // Down refuses while a set, a set release, a set sale, a grouped case or a size per piece exists, naming the counts;
    // this database stays at 0057.
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);
    await expect(down(t.db)).rejects.toThrow(/0057_sets cannot be rolled back: 2 sets, 2 set releases, 3 set sales, 2 grouped return cases and 7 release sizes given per piece exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0057_sets')?.executedAt).toBeDefined();
    await run(`ALTER TABLE order_cases DISABLE TRIGGER order_cases_no_delete`);
    await run(`DELETE FROM order_cases WHERE id = '${salonCase}' OR group_id = '${group}'`);
    await run(`ALTER TABLE order_cases ENABLE TRIGGER order_cases_no_delete`);
    await run(`DELETE FROM orders WHERE id IN ('${second}', '${first}', '${salonOrder}')`);
    await run(`DELETE FROM set_sales`);
    await run(`DELETE FROM live_interest_sizes`);
    await run(`DELETE FROM live_entry_sizes`);
    await run(`DELETE FROM drop_entry_sizes`);
    await run(`DELETE FROM live_interest WHERE drop_id = '${setLive}'`);
    await run(`DELETE FROM live_entries WHERE id = '${liveEntry}'`);
    await run(`DELETE FROM drop_entries WHERE drop_id IN ('${setDraw}', '${modelDraw}')`);
    await expect(down(t.db)).rejects.toThrow(/cannot be rolled back: 2 sets, 2 set releases, 0 set sales, 0 grouped return cases and 7 release sizes given per piece exist/);
    await run(`DELETE FROM drop_sizes WHERE drop_id IN ('${setDraw}', '${setLive}')`);
    await run(`DELETE FROM drops WHERE id IN ('${setDraw}', '${setLive}')`);
    await expect(down(t.db)).rejects.toThrow(/cannot be rolled back: 2 sets, 0 set releases, 0 set sales, 0 grouped return cases and 1 release sizes given per piece exist/);
    await run(`DELETE FROM drop_sizes WHERE id = '${modelSize25}'`);
    await run(`DELETE FROM set_models`);
    await run(`DELETE FROM sets`);
    expect((await down(t.db)).reverted).toEqual(['0057_sets']);
    // 0058 refuses an open LIVE release without a pace (the owner is asked first): the model's release, written without
    // one, is cancelled before the way up.
    await run(`UPDATE drops SET cancelled_at = now() WHERE id = '${liveParent}'`);
    expect(await one(`SELECT model_id FROM drops WHERE id = '${modelDraw}'`)).toEqual({ model_id: ring });
    expect((await up(t.db)).applied).toEqual(['0057_sets', '0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // The rows of this test taken away.
    for (const q of [
      `DELETE FROM drops WHERE parent_drop_id IS NOT NULL AND model_id = '${ring}'`,
      `DELETE FROM drop_sizes WHERE drop_id IN (SELECT id FROM drops WHERE model_id = '${ring}')`,
      `DELETE FROM drops WHERE model_id = '${ring}'`,
      `DELETE FROM shop_requests WHERE id = '${request}'`,
      `DELETE FROM skus WHERE model_id = '${ring}'`,
      `DELETE FROM models WHERE id IN ('${ring}', '${chain}', '${cuff}')`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
      `DELETE FROM accounts WHERE id IN ('${account}', '${other}')`,
      `DELETE FROM admin_users WHERE id = '${admin}'`,
    ]) {
      await run(q);
    }
  });

  /** What names an object of 0058 in a snapshot: the hold's column and its two CHECKs, every LIVE release paced, and the NEXT BATCH NOW batches' count and its CHECK. */
  const of0058 = (o: string) => /\b(pace_hold_minutes|drops_pace_hold(_minutes_check)?|drops_live_paced|pace_extra_batches|drops_pace_extra_batches)\b/.test(o);

  it('0058 adds ONE QUEUE\'s hold after the opening (one column of drops and its two CHECKs), every LIVE release paced (one CHECK) and the count of NEXT BATCH NOW batches (one column, one CHECK), and nothing else; down restores 0057 exactly, and up again', async () => {
    const latest = await snapshot();
    const { with: withIt, without: before } = await rollBackTo('0058_one_queue');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names pace_hold_minutes' too, as in 0049's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL "?\w+"?$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual([]);
    expect(added.filter((o) => !of0058(o))).toEqual([]);
    expect(before.filter(of0058)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual(['table drops pace_extra_batches integer NO 0', 'table drops pace_hold_minutes smallint NO 0']);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      "constraint drops drops_live_paced CHECK (((mode <> 'LIVE'::text) OR (parent_drop_id IS NOT NULL) OR (pace_batch IS NOT NULL) OR (ended_at IS NOT NULL) OR (cancelled_at IS NOT NULL)))",
      'constraint drops drops_pace_extra_batches CHECK (((pace_extra_batches >= 0) AND (pace_extra_batches <= pace_batches)))',
      'constraint drops drops_pace_hold CHECK (((pace_hold_minutes = 0) OR (pace_batch IS NOT NULL)))',
      'constraint drops drops_pace_hold_minutes_check CHECK (((pace_hold_minutes >= 0) AND (pace_hold_minutes <= 120)))',
    ]);
    // live_entries does not change: 0049's admission columns and index now mean the batch that gave the turn.
    expect(added.filter((o) => o.startsWith('index ') || o.startsWith('trigger '))).toEqual([]);
    expect((await up(t.db)).applied).toEqual(['0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
  });

  it('0058: a hold of 0 to 120 minutes, 0 by default, only with a pace (never on a DRAW, an after-room or an unpaced release); every open LIVE release that is not an after-room paced; NEXT BATCH NOW\'s batches 0 by default, never more than the batches; down refused while a hold exists, naming the count; up refused while an open LIVE release has no pace, naming the count (an after-room, an ended or a cancelled release never counts)', async () => {
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    await run(`INSERT INTO categories (id, code, name) VALUES (14, 'P', 'Pace checks') ON CONFLICT DO NOTHING`);
    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (14, 'H', 'RING', 'HOLDCHK') RETURNING id`)).id;
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const draw = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
      VALUES (${model}, 'Draw', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}) RETURNING id`.execute(t.db)).rows[0].id;
    const paced = await liveDrop(model, { published_at: 'now()', pace_batch: '250', pace_minutes: '1' });
    const child = await liveDrop(model, { ...AFTER_ROOM(paced) });
    // History the previous image could write: LIVE releases without a pace, ended or cancelled; and a paced one ended.
    const ended = await liveDrop(model, { published_at: 'now()', ended_at: 'now()', ended_reason: `'CLOSED'` });
    const cancelled = await liveDrop(model, { cancelled_at: 'now()' });
    const endedPaced = await liveDrop(model, { published_at: 'now()', pace_batch: '40', pace_minutes: '2', ended_at: 'now()', ended_reason: `'CLOSED'` });
    const hold = (id: string) => one<{ pace_hold_minutes: number }>(`SELECT pace_hold_minutes FROM drops WHERE id = '${id}'`);
    for (const id of [draw, paced, child, ended, cancelled, endedPaced]) expect(await hold(id)).toEqual({ pace_hold_minutes: 0 });

    // Every open LIVE release that is not an after-room carries a pace (drops_live_paced): written without one, or its
    // pace taken away, refused; an after-room, an ended or a cancelled release never needs one.
    await check(liveDrop(model, { pace_batch: 'NULL', pace_minutes: 'NULL' }), 'an open LIVE release without a pace', 'drops_live_paced');
    await check(liveDrop(model, { published_at: 'now()', pace_batch: 'NULL', pace_minutes: 'NULL' }), 'a published LIVE release without a pace', 'drops_live_paced');
    const set = (sets: string, id = paced) => run(`UPDATE drops SET ${sets} WHERE id = '${id}'`);
    await check(set(`pace_batch = NULL, pace_minutes = NULL`), 'an open release\'s pace taken away', 'drops_live_paced');
    await check(set(`ended_at = NULL, ended_reason = NULL`, ended), 'an unpaced release ended, opened again', 'drops_live_paced');

    // The hold: 0 to 120 minutes, never NULL, only with a pace.
    await check(set(`pace_hold_minutes = -1`), 'a hold below 0', 'drops_pace_hold_minutes_check');
    await check(set(`pace_hold_minutes = 121`), 'a hold above 120', 'drops_pace_hold_minutes_check');
    await expect(set(`pace_hold_minutes = NULL`)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    for (const [id, label] of [[draw, 'a DRAW'], [child, 'an after-room'], [ended, 'a LIVE release without a pace']] as const) {
      await check(set(`pace_hold_minutes = 10`, id), `${label} with a hold`, 'drops_pace_hold');
    }
    await set(`pace_hold_minutes = 120`);
    await set(`pace_hold_minutes = 0`);
    await set(`pace_hold_minutes = 15`);
    // A pace that holds its opening is never taken away with its hold left (an ended release, which needs no pace).
    await set(`pace_hold_minutes = 15`, endedPaced);
    await check(set(`pace_batch = NULL, pace_minutes = NULL`, endedPaced), 'a pace taken away, its hold kept', 'drops_pace_hold');
    await set(`pace_hold_minutes = 0`, endedPaced);

    // The batches given by NEXT BATCH NOW (step Q1.2): 0 by default, never NULL, some of the batches given, never more.
    const extra = (id: string) => one<{ pace_extra_batches: number }>(`SELECT pace_extra_batches FROM drops WHERE id = '${id}'`);
    for (const id of [draw, paced, child, ended, cancelled, endedPaced]) expect(await extra(id)).toEqual({ pace_extra_batches: 0 });
    await check(set(`pace_extra_batches = 1`), 'an extra batch with no batch given', 'drops_pace_extra_batches');
    await check(set(`pace_batches = 2, pace_extra_batches = -1`), 'a count below 0', 'drops_pace_extra_batches');
    await expect(set(`pace_extra_batches = NULL`)).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    await set(`pace_batches = 2, pace_extra_batches = 2`);
    await check(set(`pace_batches = 1`), 'fewer batches than NEXT BATCH NOW gave', 'drops_pace_extra_batches');
    await set(`pace_batches = 0, pace_extra_batches = 0`);

    // Down refuses while a release has a hold, naming the count; this database stays at 0058 (0059, which holds nothing
    // here, goes down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    await expect(down(t.db)).rejects.toThrow(/0058_one_queue cannot be rolled back: 1 releases with a hold after the opening exist/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0058_one_queue')?.executedAt).toBeDefined();
    await set(`pace_hold_minutes = 0`);
    expect((await down(t.db)).reverted).toEqual(['0058_one_queue']);

    // Up refuses while an open LIVE release has no pace (D56: the owner is asked first), naming the count; the after-room,
    // the ended and the cancelled releases and the DRAW never count. Nothing of 0058 is applied.
    const open = await liveDrop(model, { published_at: 'now()' });
    const second = await liveDrop(model);
    await expect(up(t.db)).rejects.toThrow(/0058_one_queue cannot be applied: 2 open LIVE releases have no pace/);
    expect((await migrationStatus(t.db)).find((m) => m.name === '0058_one_queue')?.executedAt).toBeUndefined();
    expect(await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'drops' AND column_name = 'pace_hold_minutes'`)).toEqual({ n: 0 });
    await set(`pace_batch = 40, pace_minutes = 2`, open);
    await expect(up(t.db)).rejects.toThrow(/0058_one_queue cannot be applied: 1 open LIVE releases have no pace/);
    await set(`cancelled_at = now()`, second);
    expect((await up(t.db)).applied).toEqual(['0058_one_queue', '0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    for (const id of [draw, paced, child, open, ended, cancelled, second, endedPaced]) expect(await hold(id)).toEqual({ pace_hold_minutes: 0 });

    // The rows of this test taken away.
    await run(`DELETE FROM drops WHERE id = '${child}'`);
    await run(`DELETE FROM drops WHERE id IN ('${draw}', '${paced}', '${open}', '${ended}', '${cancelled}', '${second}', '${endedPaced}')`);
    await run(`DELETE FROM models WHERE id = '${model}'`);
  });

  /**
   * What names an object of 0059 in a snapshot: an add-on's kind, moments, engraving and most characters with their
   * CHECKs and index, a release's pick, a choice's words, the unit's kind guard.
   */
  const of0059 = (o: string) =>
    /\b(drop_addons\w*|addon_items_(kind_check|service_plain|engraving_service|engraving_key|text_max_check)|addon_choices_text_check|order_addon_items_kind_guard)\b/.test(o) ||
    /^table (addon_items (kind|offer_live|offer_draw|offer_salon|offer_orders|engraving|text_max)|addon_choices text) /.test(o);

  it('0059 adds ADD-ONS ONE SYSTEM (an add-on\'s kind, its four moments, the engraving and its most characters; a release\'s pick; a choice\'s words; a unit held nowhere and its kind guard; stock_holds reading the units held at a location), and nothing else; down restores 0058 exactly, and up again', async () => {
    const latest = await snapshot();
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    const view = async () => (await sql<{ def: string }>`SELECT pg_get_viewdef('stock_holds'::regclass, true) AS def`.execute(t.db)).rows[0]!.def.replace(/\s+/g, ' ').trim();
    const { with: withIt, without: before } = await rollBackTo('0059_addons_one_system');
    // A PostgreSQL that lists NOT NULL as a constraint (PGlite's does) names the new columns' and table's too, as in 0054's test.
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL "?\w+"?$/.test(o);
    const added = withIt.filter((o) => !before.includes(o) && !notNull(o));
    // What 0059 changes of 0058: a unit's location NULL-able (its NOT NULL, where listed, goes with it).
    expect(before.filter((o) => !withIt.includes(o) && !notNull(o))).toEqual(['table order_addon_items location_id uuid NO ']);
    expect(before.filter((o) => !withIt.includes(o) && notNull(o) && !/^constraint order_addon_items order_addon_items_location_id_not_null /.test(o))).toEqual([]);
    expect(added.filter((o) => !of0059(o))).toEqual(['table order_addon_items location_id uuid YES ']);
    expect(before.filter(of0059)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table addon_choices text text YES ',
      'table addon_items engraving boolean NO false',
      'table addon_items kind text NO \'PRODUCT\'::text',
      'table addon_items offer_draw boolean NO true',
      'table addon_items offer_live boolean NO true',
      'table addon_items offer_orders boolean NO true',
      'table addon_items offer_salon boolean NO true',
      'table addon_items text_max smallint NO 20',
      'table drop_addons addon_id uuid NO ',
      'table drop_addons drop_id uuid NO ',
      'table drop_addons position smallint NO ',
      'table order_addon_items location_id uuid YES ',
    ]);
    expect(added.filter((o) => o.startsWith('constraint '))).toEqual([
      "constraint addon_choices addon_choices_text_check CHECK ((((length(text) >= 1) AND (length(text) <= 120)) AND (text = btrim(text))))",
      "constraint addon_items addon_items_engraving_service CHECK (((NOT engraving) OR (kind = 'SERVICE'::text)))",
      "constraint addon_items addon_items_kind_check CHECK ((kind = ANY (ARRAY['PRODUCT'::text, 'SERVICE'::text])))",
      "constraint addon_items addon_items_service_plain CHECK (((kind = 'PRODUCT'::text) OR (supplier_id IS NULL)))",
      'constraint addon_items addon_items_text_max_check CHECK (((text_max >= 1) AND (text_max <= 20)))',
      'constraint drop_addons drop_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES addon_items(id) ON DELETE RESTRICT',
      'constraint drop_addons drop_addons_drop_id_fkey FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE RESTRICT',
      'constraint drop_addons drop_addons_pkey PRIMARY KEY (drop_id, addon_id)',
      'constraint drop_addons drop_addons_position_check CHECK ((("position" >= 1) AND ("position" <= 100)))',
      'constraint drop_addons drop_addons_position_key UNIQUE (drop_id, "position")',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX drop_addons_addon_idx ON public.drop_addons USING btree (addon_id)',
      'index CREATE UNIQUE INDEX addon_items_engraving_key ON public.addon_items USING btree ((true)) WHERE (engraving AND active)',
      'index CREATE UNIQUE INDEX drop_addons_pkey ON public.drop_addons USING btree (drop_id, addon_id)',
      'index CREATE UNIQUE INDEX drop_addons_position_key ON public.drop_addons USING btree (drop_id, "position")',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual([
      'trigger drop_addons drop_addons_immutable_identity',
      'trigger order_addon_items order_addon_items_kind_guard',
    ]);
    // 0058's guard of an add-on's identity and its view, exactly; 0059's once up again.
    expect(await args('addon_items_immutable_identity')).toEqual(['id', 'created_at', 'created_by']);
    expect(await view()).toBe(STOCK_HOLDS_0056);
    expect((await up(t.db)).applied).toEqual(['0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('addon_items_immutable_identity')).toEqual(['id', 'created_at', 'created_by', 'kind']);
    expect(await args('drop_addons_immutable_identity')).toEqual(['drop_id', 'addon_id']);
    expect(await view()).toBe(STOCK_HOLDS_0059);
  });

  it('0059: an add-on a PRODUCT by default (offered at the four moments, not the engraving, 20 characters), or a SERVICE without a supplier, its kind fixed; the engraving a service, one active at a time, its most characters 1 to 20; a release\'s pick at positions 1 to 100, each add-on and position once, its release and add-on fixed; a choice\'s words 1 to 120, trimmed; a product\'s unit at a location, a service\'s at none, and only those at a location in stock_holds; down refused while a service, an engraving, a pick, a choice\'s words or a unit without a location exists, naming the counts', async () => {
    await sql`INSERT INTO categories (id, code, name) VALUES (13, 'C', 'Claim checks') ON CONFLICT DO NOTHING`.execute(t.db);
    const run = (q: string) => sql.raw(q).execute(t.db);
    const one = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows[0] as T;
    const all = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows as T[];
    const check = (p: Promise<unknown>, label: string, constraint?: string) => expect(p, label).rejects.toSatisfy((e) => isCheckViolation(e, constraint));
    const nullRefused = (p: Promise<unknown>, label: string) => expect(p, label).rejects.toSatisfy((e) => pgError(e)?.code === PG_ERROR.NOT_NULL_VIOLATION);
    const insert = (table: string, cols: Record<string, string>) =>
      sql.raw<{ id: string }>(`INSERT INTO ${table} (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')}) RETURNING ${table === 'drop_addons' ? 'addon_id AS id' : 'id'}`).execute(t.db);
    const id = async (p: Promise<{ rows: { id: string }[] }>) => (await p).rows[0].id;

    const model = (await one<{ id: string }>(`INSERT INTO models (category_id, name, type, sku_prefix) VALUES (13, 'ONE SYSTEM', 'RING', 'ADD0059') RETURNING id`)).id;
    const account = (await one<{ id: string }>(`INSERT INTO accounts (email, email_normalized, password_hash) VALUES ('addons-0059@example.com', 'addons-0059@example.com', 'scrypt$x') RETURNING id`)).id;
    const location = (await one<{ id: string }>(`INSERT INTO stock_locations (name) VALUES ('ADD-ONS 0059') RETURNING id`)).id;
    const supplier = (await one<{ id: string }>(`INSERT INTO suppliers (name) VALUES ('ADD-ONS 0059 SUPPLIER') RETURNING id`)).id;
    const seedHash = createHash('sha256').update(new Uint8Array(32)).digest();
    const drop = (await sql<{ id: string }>`
      INSERT INTO drops (model_id, title, quantity, opens_at, closes_at, seed_enc, seed_hash)
      VALUES (${model}, 'Draw 0059', 1, '2026-12-01T10:00:00Z', '2026-12-02T10:00:00Z', ${`v1.${'A'.repeat(16)}.${'B'.repeat(64)}`}, ${seedHash}) RETURNING id`.execute(t.db)).rows[0].id;
    const live = await liveDrop(model);

    // An add-on written as the previous image writes it: a product, offered at the four moments, not the engraving, 20.
    const addon = (cols: Record<string, string> = {}) => insert('addon_items', { name: `'CARE KIT'`, ...cols });
    const kit = await id(addon({ supplier_id: `'${supplier}'` }));
    const shape = `kind, offer_live, offer_draw, offer_salon, offer_orders, engraving, text_max`;
    expect(await one(`SELECT ${shape} FROM addon_items WHERE id = '${kit}'`)).toEqual({ kind: 'PRODUCT', offer_live: true, offer_draw: true, offer_salon: true, offer_orders: true, engraving: false, text_max: 20 });
    for (const [cols, label, constraint] of [
      [{ kind: `'BOX'` }, 'a kind not known', 'addon_items_kind_check'],
      [{ kind: `'SERVICE'`, supplier_id: `'${supplier}'` }, 'a service with a supplier', 'addon_items_service_plain'],
      [{ engraving: 'true' }, 'a product engraving', 'addon_items_engraving_service'],
      [{ kind: `'SERVICE'`, text_max: '0' }, 'at most 0 characters', 'addon_items_text_max_check'],
      [{ kind: `'SERVICE'`, text_max: '21' }, 'at most 21 characters', 'addon_items_text_max_check'],
    ] as const) {
      await check(addon({ name: `'REFUSED'`, ...cols }), label, constraint);
    }
    for (const column of ['kind', 'offer_live', 'offer_draw', 'offer_salon', 'offer_orders', 'engraving', 'text_max']) {
      await nullRefused(addon({ name: `'REFUSED'`, [column]: 'NULL' }), `${column} NULL`);
    }
    await check(run(`UPDATE addon_items SET engraving = true WHERE id = '${kit}'`), 'a product made the engraving', 'addon_items_engraving_service');
    // A service: no supplier, its moments switched one by one; the engraving, one active at a time, 1 to 20 characters.
    const wrapping = await id(addon({ name: `'GIFT WRAPPING'`, kind: `'SERVICE'`, offer_draw: 'false', offer_salon: 'false', offer_orders: 'false' }));
    await check(run(`UPDATE addon_items SET supplier_id = '${supplier}' WHERE id = '${wrapping}'`), 'a service given a supplier', 'addon_items_service_plain');
    const engraving = await id(addon({ name: `'ENGRAVING'`, kind: `'SERVICE'`, engraving: 'true', text_max: '12' }));
    expect(await one(`SELECT ${shape} FROM addon_items WHERE id = '${engraving}'`)).toEqual({ kind: 'SERVICE', offer_live: true, offer_draw: true, offer_salon: true, offer_orders: true, engraving: true, text_max: 12 });
    await expect(addon({ name: `'ENGRAVING II'`, kind: `'SERVICE'`, engraving: 'true' }), 'a second engraving offered').rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_items_engraving_key'));
    const aside = await id(addon({ name: `'ENGRAVING II'`, kind: `'SERVICE'`, engraving: 'true', active: 'false' }));
    await expect(run(`UPDATE addon_items SET active = true WHERE id = '${aside}'`), 'a second engraving offered again').rejects.toSatisfy((e) => isUniqueViolation(e, 'addon_items_engraving_key'));
    await run(`UPDATE addon_items SET text_max = 1 WHERE id = '${engraving}'`);
    await run(`UPDATE addon_items SET text_max = 20 WHERE id = '${engraving}'`);
    await check(run(`UPDATE addon_items SET text_max = 21 WHERE id = '${engraving}'`), 'at most 21 characters', 'addon_items_text_max_check');
    await run(`UPDATE addon_items SET text_max = 12, offer_orders = false WHERE id = '${engraving}'`);
    // Its kind is fixed at its creation, either way.
    for (const [addonId, kind] of [[kit, 'SERVICE'], [wrapping, 'PRODUCT']] as const) {
      await expect(run(`UPDATE addon_items SET kind = '${kind}' WHERE id = '${addonId}'`), kind).rejects.toSatisfy(isGuardViolation);
    }

    // A release's pick: positions 1 to 100, each add-on and each position once, its release and add-on fixed, kept while it names them.
    const pick = (cols: Record<string, string>) => insert('drop_addons', { drop_id: `'${drop}'`, addon_id: `'${kit}'`, position: '1', ...cols });
    await check(pick({ position: '0' }), 'a position 0', 'drop_addons_position_check');
    await check(pick({ position: '101' }), 'a position 101', 'drop_addons_position_check');
    await nullRefused(pick({ position: 'NULL' }), 'a pick without a position');
    await expect(pick({ drop_id: `'00000000-0000-4000-8000-000000000000'` })).rejects.toSatisfy(isForeignKeyViolation);
    await expect(pick({ addon_id: `'00000000-0000-4000-8000-000000000000'` })).rejects.toSatisfy(isForeignKeyViolation);
    await pick({});
    await pick({ addon_id: `'${engraving}'`, position: '100' });
    await pick({ drop_id: `'${live}'`, addon_id: `'${wrapping}'` });
    await expect(pick({ position: '2' }), 'an add-on picked twice by a release').rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_addons_pkey'));
    await expect(pick({ addon_id: `'${wrapping}'` }), 'a position twice in a release').rejects.toSatisfy((e) => isUniqueViolation(e, 'drop_addons_position_key'));
    await run(`UPDATE drop_addons SET position = 2 WHERE drop_id = '${drop}' AND addon_id = '${engraving}'`);
    for (const sets of [`drop_id = '${live}'`, `addon_id = '${wrapping}'`]) {
      await expect(run(`UPDATE drop_addons SET ${sets} WHERE drop_id = '${drop}' AND addon_id = '${engraving}'`), sets).rejects.toSatisfy(isGuardViolation);
    }
    await expect(run(`DELETE FROM addon_items WHERE id = '${wrapping}'`), 'a picked add-on deleted').rejects.toSatisfy(isForeignKeyViolation);
    expect(await all(`SELECT drop_id, addon_id, position FROM drop_addons ORDER BY drop_id = '${drop}' DESC, position`)).toEqual([
      { drop_id: drop, addon_id: kit, position: 1 },
      { drop_id: drop, addon_id: engraving, position: 2 },
      { drop_id: live, addon_id: wrapping, position: 1 },
    ]);

    // A choice's words: 1 to 120 characters, trimmed; none by default.
    const request = (await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id) VALUES ('${account}', '${model}') RETURNING id`)).id;
    const choice = (cols: Record<string, string> = {}) => insert('addon_choices', { shop_request_id: `'${request}'`, addon_id: `'${engraving}'`, units: '1', ...cols });
    for (const [text, label] of [[`''`, 'empty words'], [`' M. B.'`, 'words not trimmed'], [`'${'W'.repeat(121)}'`, 'words of 121 characters']] as const) {
      await check(choice({ text }), label, 'addon_choices_text_check');
    }
    const kitChoice = await id(choice({ addon_id: `'${kit}'` }));
    const words = await id(choice({ text: `'${'W'.repeat(120)}'` }));
    await run(`UPDATE addon_choices SET text = 'M. B.' WHERE id = '${words}'`);
    expect(await all(`SELECT id, text FROM addon_choices WHERE shop_request_id = '${request}' ORDER BY text NULLS FIRST`)).toEqual([{ id: kitChoice, text: null }, { id: words, text: 'M. B.' }]);

    // A unit: a product's at a location, a service's at none, either way kept on a move; only those at a location hold stock.
    const order = (await one<{ id: string }>(`INSERT INTO orders (channel, shop_request_id, account_id, model_id, location_id, price_minor, currency) VALUES ('SALON', '${(await one<{ id: string }>(`INSERT INTO shop_requests (account_id, model_id, status, handled_at, outcome) VALUES ('${account}', '${model}', 'CLOSED', now(), 'ACCEPTED') RETURNING id`)).id}', '${account}', '${model}', '${location}', 1000, 'EUR') RETURNING id`)).id;
    const skuOf = (addonId: string, code: string) => id(insert('skus', { addon_id: `'${addonId}'`, code: `'${code}'` }));
    const kitSku = await skuOf(kit, 'KIT-0059');
    const wrapSku = await skuOf(wrapping, 'WRAP-0059');
    const unit = (addonId: string, skuId: string, cols: Record<string, string> = {}) =>
      insert('order_addon_items', { order_id: `'${order}'`, addon_id: `'${addonId}'`, sku_id: `'${skuId}'`, location_id: `'${location}'`, price_minor: '1500', currency: `'EUR'`, added_by_type: `'PURCHASE'`, ...cols });
    await check(unit(kit, kitSku, { location_id: 'NULL' }), 'a product\'s unit at no location', 'order_addon_items_kind_guard');
    await check(unit(wrapping, wrapSku), 'a service\'s unit at a location', 'order_addon_items_kind_guard');
    const kitUnit = await id(unit(kit, kitSku));
    const wrapUnit = await id(unit(wrapping, wrapSku, { location_id: 'NULL' }));
    await check(run(`UPDATE order_addon_items SET location_id = NULL WHERE id = '${kitUnit}'`), 'a product\'s unit moved nowhere', 'order_addon_items_kind_guard');
    await check(run(`UPDATE order_addon_items SET location_id = '${location}' WHERE id = '${wrapUnit}'`), 'a service\'s unit moved to a location', 'order_addon_items_kind_guard');
    await run(`UPDATE order_addon_items SET location_id = NULL WHERE id = '${wrapUnit}'`);
    expect(await all(`SELECT h.kind, h.id FROM stock_holds h WHERE h.id IN ('${kitUnit}', '${wrapUnit}')`)).toEqual([{ kind: 'ADD_ON', id: kitUnit }]);
    // Removed, then cancelled: a service's unit keeps its states and times as a product's does.
    await run(`UPDATE order_addon_items SET status = 'REMOVED', removed_at = now() WHERE id = '${wrapUnit}'`);
    expect(await one(`SELECT status, location_id FROM order_addon_items WHERE id = '${wrapUnit}'`)).toEqual({ status: 'REMOVED', location_id: null });

    // Down refuses while a service, an engraving, a pick, a choice's words or a unit without a location exists, naming
    // the counts; this database stays at 0059 (0060, which converted nothing here, goes down first).
    expect((await down(t.db)).reverted).toEqual(['0064_partners']);
    expect((await down(t.db)).reverted).toEqual(['0063_margin']);
    expect((await down(t.db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await down(t.db)).reverted).toEqual(['0061_the_vault']);
    expect((await down(t.db)).reverted).toEqual(['0060_release_addons_converted']);
    const refused = (counts: string) =>
      expect(down(t.db)).rejects.toThrow(new RegExp(`0059_addons_one_system cannot be rolled back: ${counts} exist`));
    await refused('3 service add-ons, 2 engraving add-ons, 3 add-ons picked by releases, 1 add-on choices with words and 1 add-on units without a location');
    expect((await migrationStatus(t.db)).find((m) => m.name === '0059_addons_one_system')?.executedAt).toBeDefined();
    await run(`DELETE FROM order_addon_items WHERE id = '${wrapUnit}'`);
    await refused('3 service add-ons, 2 engraving add-ons, 3 add-ons picked by releases, 1 add-on choices with words and 0 add-on units without a location');
    await run(`UPDATE addon_choices SET text = NULL WHERE id = '${words}'`);
    await refused('3 service add-ons, 2 engraving add-ons, 3 add-ons picked by releases, 0 add-on choices with words and 0 add-on units without a location');
    await run(`DELETE FROM drop_addons`);
    await refused('3 service add-ons, 2 engraving add-ons, 0 add-ons picked by releases, 0 add-on choices with words and 0 add-on units without a location');
    await run(`DELETE FROM addon_choices WHERE shop_request_id = '${request}'`);
    await run(`DELETE FROM skus WHERE id = '${wrapSku}'`);
    await run(`DELETE FROM addon_items WHERE id IN ('${engraving}', '${aside}')`);
    await refused('1 service add-ons, 0 engraving add-ons, 0 add-ons picked by releases, 0 add-on choices with words and 0 add-on units without a location');
    await run(`DELETE FROM addon_items WHERE id = '${wrapping}'`);
    // Without them it restores 0058, the product and its unit kept as they were (at its location, holding stock).
    expect((await down(t.db)).reverted).toEqual(['0059_addons_one_system']);
    expect(await one(`SELECT name FROM addon_items WHERE id = '${kit}'`)).toEqual({ name: 'CARE KIT' });
    expect(await all(`SELECT h.kind, h.id FROM stock_holds h WHERE h.id = '${kitUnit}'`)).toEqual([{ kind: 'ADD_ON', id: kitUnit }]);
    await nullRefused(unit(kit, kitSku, { location_id: 'NULL' }), 'at 0058, a unit at no location');
    expect((await up(t.db)).applied).toEqual(['0059_addons_one_system', '0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await one(`SELECT ${shape} FROM addon_items WHERE id = '${kit}'`)).toEqual({ kind: 'PRODUCT', offer_live: true, offer_draw: true, offer_salon: true, offer_orders: true, engraving: false, text_max: 20 });

    // The rows of this test taken away (0060, up again, picked the product for every release still open as its pick may
    // hold it: the draw without a price, not the LIVE release in EUR, where the product has no price).
    expect(await all(`SELECT drop_id, addon_id, position FROM drop_addons WHERE drop_id IN ('${drop}', '${live}') ORDER BY drop_id = '${drop}' DESC`)).toEqual([
      { drop_id: drop, addon_id: kit, position: 1 },
    ]);
    for (const q of [
      `DELETE FROM drop_addons WHERE addon_id = '${kit}'`,
      `DELETE FROM order_addon_items WHERE order_id = '${order}'`,
      `DELETE FROM orders WHERE id = '${order}'`,
      `DELETE FROM shop_requests WHERE account_id = '${account}'`,
      `DELETE FROM skus WHERE id = '${kitSku}'`,
      `DELETE FROM addon_items WHERE id = '${kit}'`,
      `DELETE FROM drops WHERE id IN ('${drop}', '${live}')`,
      `DELETE FROM models WHERE id = '${model}'`,
      `DELETE FROM stock_locations WHERE id = '${location}'`,
      `DELETE FROM accounts WHERE id = '${account}'`,
      `ALTER TABLE suppliers DISABLE TRIGGER suppliers_no_delete`,
      `DELETE FROM suppliers WHERE id = '${supplier}'`,
      `ALTER TABLE suppliers ENABLE TRIGGER suppliers_no_delete`,
    ]) {
      await run(q);
    }
  });

  /** What names an object of 0060 in a snapshot: the record of what was converted; and the three tables 0060 drops. */
  const of0060 = (o: string) => /\baddon_conversions\w*\b/.test(o);
  const droppedBy0060 = (o: string) => /\b(live_addons|live_entry_addons|engraving_prices)\w*\b/.test(o);

  it('0060 adds the record of what was converted (addon_conversions, its CHECKs, key, indexes and guard) and drops the release add-ons, their choices and the engraving prices, and nothing else; down re-creates the three, empty, as 0021 and 0039 made them, and drops the record; up again', async () => {
    const latest = await snapshot();
    const args = async (trigger: string) =>
      (await sql<{ args: string }>`SELECT encode(tgargs, 'escape') AS args FROM pg_trigger WHERE tgname = ${trigger}`.execute(t.db)).rows[0]!.args.split('\\000').filter(Boolean);
    const { with: withIt, without: before } = await rollBackTo('0060_release_addons_converted');
    const added = withIt.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !withIt.includes(o));
    expect(added.filter((o) => !of0060(o))).toEqual([]);
    expect(removed.filter((o) => !droppedBy0060(o))).toEqual([]);
    expect(before.filter(of0060)).toEqual([]);
    expect(withIt.filter(droppedBy0060)).toEqual([]);
    expect(added.filter((o) => o.startsWith('table '))).toEqual([
      'table addon_conversions addon_id uuid NO ',
      'table addon_conversions converted_at timestamp with time zone NO now()',
      'table addon_conversions currency text YES ',
      'table addon_conversions drop_id uuid YES ',
      'table addon_conversions id uuid NO gen_random_uuid()',
      'table addon_conversions price_minor integer YES ',
      'table addon_conversions source text NO ',
      'table addon_conversions source_id uuid YES ',
    ]);
    const notNull = (o: string) => /^constraint \S+ \S+_not_null NOT NULL "?\w+"?$/.test(o);
    expect(added.filter((o) => o.startsWith('constraint ') && !notNull(o))).toEqual([
      "constraint addon_conversions addon_conversions_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES addon_items(id) ON DELETE RESTRICT",
      "constraint addon_conversions addon_conversions_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))",
      "constraint addon_conversions addon_conversions_drop_id_fkey FOREIGN KEY (drop_id) REFERENCES drops(id) ON DELETE RESTRICT",
      "constraint addon_conversions addon_conversions_pkey PRIMARY KEY (id)",
      "constraint addon_conversions addon_conversions_price CHECK (((price_minor IS NULL) OR (currency = ANY (ARRAY['EUR'::text, 'GBP'::text, 'USD'::text, 'CHF'::text]))))",
      'constraint addon_conversions addon_conversions_price_minor_check CHECK (((price_minor >= 0) AND (price_minor <= 100000000)))',
      "constraint addon_conversions addon_conversions_source_check CHECK ((source = ANY (ARRAY['LIVE_ADDON'::text, 'ENGRAVING_PRICES'::text])))",
      "constraint addon_conversions addon_conversions_source_fields CHECK (\nCASE source\n    WHEN 'LIVE_ADDON'::text THEN ((source_id IS NOT NULL) AND (drop_id IS NOT NULL))\n    ELSE ((source_id IS NULL) AND (drop_id IS NULL) AND (currency IS NOT NULL))\nEND)",
      'constraint addon_conversions addon_conversions_source_key UNIQUE (source_id)',
    ]);
    expect(added.filter((o) => o.startsWith('index '))).toEqual([
      'index CREATE INDEX addon_conversions_addon_idx ON public.addon_conversions USING btree (addon_id)',
      'index CREATE INDEX addon_conversions_drop_idx ON public.addon_conversions USING btree (drop_id)',
      'index CREATE UNIQUE INDEX addon_conversions_pkey ON public.addon_conversions USING btree (id)',
      'index CREATE UNIQUE INDEX addon_conversions_source_key ON public.addon_conversions USING btree (source_id)',
    ]);
    expect(added.filter((o) => o.startsWith('trigger '))).toEqual(['trigger addon_conversions addon_conversions_immutable']);
    // The three tables of before, back empty with their columns, keys, index and guard (0021's and 0039's).
    expect(removed.filter((o) => o.startsWith('table ')).map((o) => o.split(' ').slice(1, 3).join(' '))).toEqual([
      'engraving_prices currency',
      'engraving_prices price_minor',
      'engraving_prices updated_at',
      'engraving_prices updated_by',
      'live_addons drop_id',
      'live_addons id',
      'live_addons label',
      'live_addons line',
      'live_addons position',
      'live_addons price_minor',
      'live_entry_addons addon_id',
      'live_entry_addons entry_id',
      'live_entry_addons price_minor',
    ]);
    expect(removed.filter((o) => o.startsWith('trigger '))).toEqual(['trigger live_addons live_addons_immutable_identity']);
    for (const table of ['live_addons', 'live_entry_addons', 'engraving_prices']) {
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(t.db)).rows[0].n, table).toBe(0);
    }
    expect(await args('live_addons_immutable_identity')).toEqual(['id', 'drop_id']);
    expect((await up(t.db)).applied).toEqual(['0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
    expect(await snapshot()).toEqual(latest);
    expect(await args('addon_conversions_immutable')).toEqual(['id', 'source', 'source_id', 'drop_id', 'addon_id', 'currency', 'price_minor', 'converted_at']);
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
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS).filter((n) => n >= '0013_ownership_certificates'));
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
      // TEST ENTRANTS (2026-10-07): the pool, the tests and their bots; 0024_z sorts after 0024 and before the next lot's 0025.
      '0024_z_test_entrants',
      // The next nine (plan of 2026-10-06), deployment G: the messages with ORBES Client Services; the club's program; the tiers' grants; the yearly care; the house's guarantee.
      '0025_client_messages',
      '0026_club_program',
      '0027_tier_grants',
      '0028_yearly_care',
      // THE HOUSE'S GUARANTEE.
      '0029_house_guarantee',
      // YOUR SIZES.
      '0030_account_sizes',
      // PAIRS WELL WITH.
      '0031_model_pairs',
      // GROWTH.
      '0032_growth_indexes',
      // The next lot (plan of 2026-10-07), deployment H1: sizes per model and per variant.
      '0033_model_sizes',
      // New claim code.
      '0034_claim_code_renewals',
      // Deployment H2: LOGISTICS, the agent's access and the suppliers.
      '0035_logistics_access',
      // Supplier orders, receptions, the cards to print, returns to a supplier, corrections.
      '0036_supplier_orders',
      // Fulfilment: orders awaiting stock, the size exchange, the parcels and the order cases.
      '0037_fulfilment',
      // Sizes in draws, like a LIVE RELEASE.
      '0038_draw_sizes',
      // The delivery address, YOUR ADDRESSES and the engraving, the collector's own.
      '0039_order_delivery',
      // The customer intelligence lot (plan of 2026-10-08), deployment I1: the profile, its heard answers and the tastes.
      '0040_account_profiles',
      // The wishlist.
      '0041_account_wishes',
      // What they look at, the device and the place.
      '0042_collector_views',
      // Where they come from: the links, the sources, the visits and the attribution.
      '0043_acquisition',
      // The client sheet's private notes and tags, the sign-ins' index and orbes_fold for the cities.
      '0044_client_notes',
      // Deployment I2: the birthday credit, in THE PROGRAM and the tiers' grants.
      '0045_birthday_credit',
      // The engagement score: each account's score and the daily runs.
      '0046_engagement_scores',
      // The monthly history of each collector.
      '0047_collector_history',
      // ORBES CARE (plan of 2026-10-15): the warranty per model, PRIVATE CARE from PLATINE, the warranty credit and the claims.
      '0048_orbes_care',
      // The macro scope of 2026-10-20, lot M1: the LIVE waiting room's pace.
      '0049_live_pace',
      // The founding list: the pre-registrations, the LANDING destination and a draw's segment.
      '0050_founding_list',
      // The emails, prepared and switched off: the templates, the outbox, the release notices and a code sent by email.
      '0051_emails',
      // Lot M2: house messages, the moments' settings, the custom messages and their deliveries.
      '0052_house_messages',
      // WORN, the owners' gallery: the photographs sent from a piece.
      '0053_worn',
      // Lot M3: standard boxes, a model's box and packed weight, a parcel's box and weight.
      '0054_boxes_weights',
      // The countries each location serves, for supplier orders by size.
      '0055_location_countries',
      // Add-ons: the catalogue items with real stock, their prices and SKUs, the units on orders and the choices.
      '0056_addons',
      // THE SET: 2 to 4 models sold at one price as their own release, its sizes per piece, its sales and grouped returns.
      '0057_sets',
      // Lot Q1, ONE QUEUE: a LIVE release's hold after the opening.
      '0058_one_queue',
      // Lot Q2, ADD-ONS ONE SYSTEM: an add-on's kind, moments and engraving, a release's pick, a choice's words, a unit held nowhere.
      '0059_addons_one_system',
      // The release add-ons and the settings' engraving converted to catalogue add-ons, their tables dropped.
      '0060_release_addons_converted',
      // Lot Q3, THE VAULT: its sources, its one house table, the vaults, the tiers held at the migration, the invitations.
      '0061_the_vault',
      // The vault's rewards in the systems that deliver them: VAULT credits, orders, LIVE guarantees, add-on units, credits to give.
      '0062_vault_rewards',
      // Lot M4: the margin's settings, the euro rates, the shipping cost bands, the unit costs and the allowances.
      '0063_margin',
      // Partner-paid experiences: the partners, their experiences, their invoices, the invitations linked and the names shared.
      '0064_partners',
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
      expect((await down(t.db)).reverted).toEqual([names[i]]);
      expect(await snapshot(), `${names[i]} down`).toEqual(built.get(names[i - 1]));
    }
    expect((await up(t.db)).applied).toEqual(names.slice(first));
    expect(await snapshot()).toEqual(latest);
  });

  it('are named with digits, underscores and lower-case letters only, so Kysely\'s order, the C order and a locale\'s order agree', () => {
    // The 0024a → 0024_z lesson (plan CUSTOMER INTELLIGENCE §3.0 (a)): psql and `ls | sort` in en_US must list them as Kysely runs them.
    const names = Object.keys(MIGRATIONS);
    for (const n of names) expect(n, n).toMatch(/^[0-9]{4}_[a-z0-9_]+$/);
    expect([...names].sort()).toEqual(names);
    expect([...names].sort(new Intl.Collator('en-US').compare)).toEqual(names);
    expect([...names].sort(new Intl.Collator('fr-FR').compare)).toEqual(names);
    // Ignoring the underscores, as a glibc locale's first pass does.
    expect([...names].sort((a, b) => (a.replace(/_/g, '') < b.replace(/_/g, '') ? -1 : 1))).toEqual(names);
  });

  it('roll back cleanly and re-apply', async () => {
    // One migration per call, newest first, until none is applied.
    const reverted: string[] = [];
    for (let i = 0; i < Object.keys(MIGRATIONS).length; i++) reverted.push(...(await down(t.db)).reverted);
    expect(reverted).toEqual(Object.keys(MIGRATIONS).reverse());
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name NOT LIKE 'kysely_%'`.execute(t.db);
    expect(r.rows[0].n).toBe(0);
    expect((await up(t.db)).applied).toEqual(Object.keys(MIGRATIONS));
  });
});

/**
 * Migration 0060 on the data of before (lot Q2, step Q2.6, D5 "The existing release add-ons: CONVERTED to catalogue items
 * before the field goes"; N4, N6, N8, N15): a database at 0059 holding two LIVE releases with their own add-ons (an
 * ended one in EUR with ENGRAVING and GIFT BOX, its CONFIRMED entries and their orders; an open one in GBP with Engraving
 * and Gift box, an entry SECURED there), a draft in a currency that is not the house's, a draw, M3's catalogue add-ons
 * (GIFT BOX among them) and Orders → Settings' engraving prices in EUR and CHF, written as the previous image wrote them.
 */
describe('migration 0060_release_addons_converted on the data of before', () => {
  let t: TestDb;
  let f: LiveFixture;
  const MINUTE = 60_000;
  const rows = async <T,>(q: string) => (await sql.raw<T>(q).execute(t.db)).rows as T[];

  beforeAll(async () => {
    t = await createTestDb({ migrated: false });
    const r = await createMigrator(t.db).migrateTo('0059_addons_one_system');
    expect(r.error).toBeUndefined();
    f = await liveFixture(t.db, '2026-11-01T09:00:00.000Z');
  });
  afterAll(() => t.close());
  afterEach(() => {
    vaultHooks.off = false;
  });

  /** The release add-ons a release sets, as 0021 holds them (label, line, price per piece, position): their ids. */
  async function releaseAddons(dropId: string, addons: readonly { label: string; line: string | null; priceMinor: number }[]): Promise<string[]> {
    const ids: string[] = [];
    for (const [i, a] of addons.entries()) {
      ids.push((await sql<{ id: string }>`INSERT INTO live_addons (drop_id, label, line, price_minor, position) VALUES (${dropId}, ${a.label}, ${a.line}, ${a.priceMinor}, ${i + 1}) RETURNING id`.execute(t.db)).rows[0]!.id);
    }
    return ids;
  }

  /** Entries of `accounts` given their turn at the release's opening and SECURED (one piece each, its size 52). */
  async function secured(dropId: string, sizeId: string, opensAt: Date, accounts: readonly { id: string; actor: Actor }[]): Promise<string[]> {
    f.clock.set(new Date(opensAt.getTime() - MINUTE));
    for (const a of accounts) await f.live.enter(a.id, dropId, { sizeId, quantity: 1 }, a.actor);
    f.clock.set(opensAt);
    await f.live.advance(dropId);
    const tokens = [];
    for (const a of accounts) {
      const token = (await f.live.entry(a.id, dropId))!.turn!.token!;
      await f.live.press(a.id, dropId, token);
      tokens.push(token);
    }
    f.clock.advance(1500);
    for (const [i, a] of accounts.entries()) await f.live.secure(a.id, dropId, tokens[i]!, a.actor);
    return Promise.all(accounts.map(async (a) => (await t.db.selectFrom('live_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', a.id).executeTakeFirstOrThrow()).id));
  }

  it('refuses while a release add-on is chosen on a held piece, then converts each label into one catalogue add-on with its prices (the settings\' engraving winning), records every conversion, gives every release not ended its pick, keeps the orders\' history and YOUR ORDERS\' offer, drops the three tables, and refuses to go down', async () => {
    const db = t.db;
    // The data of before, written at 0059 without THE VAULT's hooks (its tables come with 0061).
    vaultHooks.off = true;
    const stock = new StockService({ db, audit: f.audit, clock: f.clock.now });
    const france = (await db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;

    // M3's catalogue add-ons, as the previous image wrote them: products offered everywhere, in stock; one set aside.
    const m3 = async (name: string, position: number, code: string, prices: Record<string, number>, active = true) => {
      const id = (await db.insertInto('addon_items').values({ name, position, active }).returning('id').executeTakeFirstOrThrow()).id;
      const sku = (await db.insertInto('skus').values({ addon_id: id, code }).returning('id').executeTakeFirstOrThrow()).id;
      for (const [currency, price_minor] of Object.entries(prices)) await db.insertInto('addon_item_prices').values({ addon_id: id, currency: currency as 'EUR', price_minor }).execute();
      if (active) await stock.adjust({ skuId: sku, locationId: france, delta: 10, note: 'Counted.' }, f.admin);
      return id;
    };
    const giftBox = await m3('GIFT BOX', 0, 'BOX-M3', { EUR: 2500 });
    const careKit = await m3('CARE KIT', 1, 'KIT-M3', { EUR: 3000, GBP: 2600 });
    // Set aside, its SKU holding the code a converted add-on would take first.
    const pouch = await m3('TRAVEL POUCH', 2, 'ADD-GIFT-WRAPPING', { EUR: 900 }, false);

    // The ended release, in EUR (1 November): ENGRAVING and GIFT BOX; A took both, B the box; their orders hold them as sold.
    const ended = await createLiveRelease(f, { opensAt: new Date('2026-11-01T18:00:00Z'), sizes: [{ label: '52', stock: 2 }] });
    const [endedEngraving, endedBox] = await releaseAddons(ended.id, [
      { label: 'ENGRAVING', line: 'Your initials, engraved.', priceMinor: 4_000 },
      { label: 'GIFT BOX', line: 'In the house’s box.', priceMinor: 1_500 },
    ]);
    const a = await createAccount(db);
    const b = await createAccount(db);
    const [entryA, entryB] = await secured(ended.id, ended.sizes[0]!.id, new Date('2026-11-01T18:00:00Z'), [a, b]);
    await db.insertInto('live_entry_addons' as never).values([
      { entry_id: entryA, addon_id: endedEngraving, price_minor: 4_000 },
      { entry_id: entryA, addon_id: endedBox, price_minor: 1_500 },
      { entry_id: entryB, addon_id: endedBox, price_minor: 1_500 },
    ] as never).execute();
    await f.live.confirm(a.id, ended.id, a.actor);
    await f.live.confirm(b.id, ended.id, b.actor);
    await legacyLiveAddons(db, ended.id, a.id, [{ label: 'ENGRAVING', priceMinor: 4_000 }, { label: 'GIFT BOX', priceMinor: 1_500 }]);
    await legacyLiveAddons(db, ended.id, b.id, [{ label: 'GIFT BOX', priceMinor: 1_500 }]);
    await db.updateTable('drops').set({ ended_at: new Date('2026-11-01T19:00:00Z'), ended_reason: 'CLOSED' }).where('id', '=', ended.id).execute();
    const orderOf = async (entryId: string) => (await db.selectFrom('orders').select(['id', 'addons']).where('live_entry_id', '=', entryId).executeTakeFirstOrThrow());

    // The open release, in GBP (10 November): Engraving and Gift box, written in other cases; C's piece SECURED with the box.
    const open = await createLiveRelease(f, { opensAt: new Date('2026-11-10T18:00:00Z'), sizes: [{ label: '52', stock: 2 }] });
    await db.updateTable('drops').set({ currency: 'GBP' }).where('id', '=', open.id).execute();
    const [openEngraving, openBox] = await releaseAddons(open.id, [
      { label: 'Engraving', line: 'Up to 20 characters, engraved by ORBES.', priceMinor: 3_500 },
      { label: 'Gift box', line: null, priceMinor: 1_200 },
    ]);
    const c = await createAccount(db);
    const [entryC] = await secured(open.id, open.sizes[0]!.id, new Date('2026-11-10T18:00:00Z'), [c]);
    await db.insertInto('live_entry_addons' as never).values({ entry_id: entryC, addon_id: openBox, price_minor: 1_200 } as never).execute();

    // A draft in JPY (not a house currency) with its own GIFT WRAPPING; a draw not drawn yet (its pick the draws' default).
    const draft = await createLiveRelease(f, { opensAt: new Date('2026-12-01T18:00:00Z'), published: false });
    await db.updateTable('drops').set({ currency: 'JPY' }).where('id', '=', draft.id).execute();
    const [draftWrapping] = await releaseAddons(draft.id, [{ label: 'GIFT WRAPPING', line: 'In the house’s paper, with a card in your words.', priceMinor: 900 }]);
    const draw = await poolDraw(f.drops, db, { modelId: f.modelId, title: 'DRAW', quantity: 1, opensAt: new Date('2026-12-05T10:00:00Z'), closesAt: new Date('2026-12-06T10:00:00Z'), earlyAccessHours: 0 }, f.admin, { publish: false });
    const picks = async (dropId: string) =>
      (await db.selectFrom('drop_addons as x').innerJoin('addon_items as i', 'i.id', 'x.addon_id').select(['i.name', 'x.position']).where('x.drop_id', '=', dropId).orderBy('x.position').execute()).map((x) => `${x.position} ${x.name}`);
    expect(await picks(draw.id)).toEqual(['1 GIFT BOX', '2 CARE KIT']);

    // Orders → Settings, Engraving: EUR and CHF.
    await sql`INSERT INTO engraving_prices (currency, price_minor, updated_by) VALUES ('EUR', 3000, ${f.admin.id}), ('CHF', 2800, ${f.admin.id})`.execute(db);

    // 1. Refused while a release add-on is chosen on a piece held (C's), naming the count; nothing changed.
    vaultHooks.off = false;
    await expect(migrateToLatest(db)).rejects.toThrow(/0060_release_addons_converted cannot be applied: 1 release add-ons are chosen on entries in TURN or SECURED/);
    expect((await migrationStatus(db)).find((m) => m.name === '0060_release_addons_converted')?.executedAt).toBeUndefined();
    expect((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM addon_items`))[0]!.n).toBe(3);
    // C's hold lapses (the service deletes its choices), then it applies.
    await sql`DELETE FROM live_entry_addons WHERE entry_id = ${entryC}`.execute(db);
    expect((await migrateToLatest(db)).applied).toEqual(['0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);

    // 3. One catalogue add-on per label: GIFT BOX (both releases') is M3's, untouched; ENGRAVING a new SERVICE named as its
    // newest release writes it, the engraving, LIVE and (5) YOUR ORDERS; GIFT WRAPPING a new SERVICE, LIVE only, its SKU
    // numbered past the code the pouch holds.
    const catalogue = await rows<Record<string, unknown>>(`
      SELECT a.name, a.kind, a.line, a.position, a.active, a.offer_live, a.offer_draw, a.offer_salon, a.offer_orders, a.engraving, a.text_max, a.supplier_id, a.weight_g, k.code
        FROM addon_items a JOIN skus k ON k.addon_id = a.id ORDER BY a.position`);
    const item = (name: string, kind: string, line: string | null, position: number, active: boolean, offer: [boolean, boolean, boolean, boolean], engraving: boolean, code: string) => ({
      name, kind, line, position, active, offer_live: offer[0], offer_draw: offer[1], offer_salon: offer[2], offer_orders: offer[3], engraving, text_max: 20, supplier_id: null, weight_g: null, code,
    });
    expect(catalogue).toEqual([
      item('GIFT BOX', 'PRODUCT', null, 0, true, [true, true, true, true], false, 'BOX-M3'),
      item('CARE KIT', 'PRODUCT', null, 1, true, [true, true, true, true], false, 'KIT-M3'),
      item('TRAVEL POUCH', 'PRODUCT', null, 2, false, [true, true, true, true], false, 'ADD-GIFT-WRAPPING'),
      item('GIFT WRAPPING', 'SERVICE', 'In the house’s paper, with a card in your words.', 3, true, [true, false, false, false], false, 'ADD-GIFT-WRAPPING-2'),
      item('Engraving', 'SERVICE', 'Up to 20 characters, engraved by ORBES.', 4, true, [true, false, false, true], true, 'ADD-ENGRAVING'),
    ]);
    const id = async (name: string) => (await db.selectFrom('addon_items').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
    const engraving = await id('Engraving');
    const wrapping = await id('GIFT WRAPPING');

    // 4 and 5. Prices: GIFT BOX keeps its EUR and gains the open release's GBP; the engraving takes the newest release's GBP
    // and the settings' EUR (over the ended release's) and CHF; nothing in JPY.
    expect(await rows(`SELECT a.name, p.currency, p.price_minor FROM addon_item_prices p JOIN addon_items a ON a.id = p.addon_id ORDER BY a.position, p.currency`)).toEqual([
      { name: 'GIFT BOX', currency: 'EUR', price_minor: 2500 },
      { name: 'GIFT BOX', currency: 'GBP', price_minor: 1200 },
      { name: 'CARE KIT', currency: 'EUR', price_minor: 3000 },
      { name: 'CARE KIT', currency: 'GBP', price_minor: 2600 },
      { name: 'TRAVEL POUCH', currency: 'EUR', price_minor: 900 },
      { name: 'Engraving', currency: 'CHF', price_minor: 2800 },
      { name: 'Engraving', currency: 'EUR', price_minor: 3000 },
      { name: 'Engraving', currency: 'GBP', price_minor: 3500 },
    ]);
    expect((await db.selectFrom('addon_item_prices').select('updated_by').where('addon_id', '=', engraving).where('currency', '=', 'EUR').executeTakeFirstOrThrow()).updated_by).toBe(f.admin.id);

    // 2. The record, row by row: each release add-on with the price it gave (none: a newer one's, the settings' or JPY),
    // and one per currency of the settings.
    expect(
      await rows(`SELECT c.source, c.source_id, c.drop_id, a.name, c.currency, c.price_minor FROM addon_conversions c JOIN addon_items a ON a.id = c.addon_id
                   ORDER BY c.source DESC, c.currency, a.name`),
    ).toEqual([
      { source: 'LIVE_ADDON', source_id: endedEngraving, drop_id: ended.id, name: 'Engraving', currency: 'EUR', price_minor: null },
      { source: 'LIVE_ADDON', source_id: endedBox, drop_id: ended.id, name: 'GIFT BOX', currency: 'EUR', price_minor: null },
      { source: 'LIVE_ADDON', source_id: openEngraving, drop_id: open.id, name: 'Engraving', currency: 'GBP', price_minor: 3500 },
      { source: 'LIVE_ADDON', source_id: openBox, drop_id: open.id, name: 'GIFT BOX', currency: 'GBP', price_minor: 1200 },
      { source: 'LIVE_ADDON', source_id: draftWrapping, drop_id: draft.id, name: 'GIFT WRAPPING', currency: 'JPY', price_minor: null },
      { source: 'ENGRAVING_PRICES', source_id: null, drop_id: null, name: 'Engraving', currency: 'CHF', price_minor: 2800 },
      { source: 'ENGRAVING_PRICES', source_id: null, drop_id: null, name: 'Engraving', currency: 'EUR', price_minor: 3000 },
    ]);
    const addons = new AddonService({ db, audit: f.audit, clock: f.clock.now });
    expect((await addons.get(engraving)).convertedFrom).toEqual([
      { source: 'LIVE_ADDON', release: { id: ended.id, title: 'LIVE' }, convertedAt: expect.any(Date) },
      { source: 'LIVE_ADDON', release: { id: open.id, title: 'LIVE' }, convertedAt: expect.any(Date) },
      { source: 'ENGRAVING_PRICES', release: null, convertedAt: expect.any(Date) },
    ]);
    expect((await addons.get(giftBox)).convertedFrom.map((x) => x.release?.id)).toEqual([ended.id, open.id]);
    expect((await addons.get(careKit)).convertedFrom).toEqual([]);
    expect((await addons.get(pouch)).convertedFrom).toEqual([]);

    // 6. The picks: every release not ended, M3's add-ons offered now first, then its converted ones in their old order;
    // the draw keeps its pick; the ended release has none.
    expect(await picks(open.id)).toEqual(['1 GIFT BOX', '2 CARE KIT', '3 Engraving']);
    expect(await picks(draft.id)).toEqual(['1 GIFT BOX', '2 CARE KIT', '3 GIFT WRAPPING']);
    expect(await picks(draw.id)).toEqual(['1 GIFT BOX', '2 CARE KIT']);
    expect(await picks(ended.id)).toEqual([]);
    expect(wrapping).toBeDefined();

    // 7. The three tables gone; the orders keep what they were sold (N15), and the export reads it from them.
    const tables = (await rows<{ name: string }>(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'`)).map((x) => x.name);
    for (const gone of ['live_addons', 'live_entry_addons', 'engraving_prices']) expect(tables, gone).not.toContain(gone);
    const orderA = await orderOf(entryA);
    const orderB = await orderOf(entryB);
    expect(orderA.addons).toEqual([expect.objectContaining({ label: 'ENGRAVING', priceMinor: 4_000 }), expect.objectContaining({ label: 'GIFT BOX', priceMinor: 1_500 })]);
    expect((await accountLiveData(db, a.id)).entries.find((e) => e.dropId === ended.id)!.addons).toEqual([{ label: 'ENGRAVING', priceMinor: 4_000 }, { label: 'GIFT BOX', priceMinor: 1_500 }]);

    // N8: an order of the ended release, not yet packed, is offered in YOUR ORDERS every add-on its ORDERS switch offers
    // (M3's, in stock, priced in EUR) and the converted engraving at the settings' price; A's engraving stays its release's.
    const orders = new OrderService({ db, audit: f.audit, clock: f.clock.now });
    const orderAddons = new OrderAddonService({ db, audit: f.audit, clock: f.clock.now });
    const offerB = await orderAddons.offerForAccount(b.id, orderB.id);
    expect(offerB).toMatchObject({ canAdd: true, currency: 'EUR' });
    expect(offerB.offer.map((x) => [x.name, x.priceMinor])).toEqual([['GIFT BOX', 2500], ['CARE KIT', 3000]]);
    expect((await orders.accountOrder(b.id, orderB.id)).engravingOffer).toEqual({ priceMinor: 3000, included: false, maxLength: 20 });
    expect((await orders.accountOrder(a.id, orderA.id)).engravingOffer).toEqual({ priceMinor: null, included: true, maxLength: 20 });

    // Down refused while a conversion is recorded, naming the count; this database stays at 0060.
    expect((await migrateDown(db)).reverted).toEqual(['0064_partners']);
    expect((await migrateDown(db)).reverted).toEqual(['0063_margin']);
    expect((await migrateDown(db)).reverted).toEqual(['0062_vault_rewards']);
    expect((await migrateDown(db)).reverted).toEqual(['0061_the_vault']);
    await expect(migrateDown(db)).rejects.toThrow(/0060_release_addons_converted cannot be rolled back: 7 add-on conversions exist/);
    expect((await migrationStatus(db)).find((m) => m.name === '0060_release_addons_converted')?.executedAt).toBeDefined();
    // A record never changes.
    await expect(sql`UPDATE addon_conversions SET price_minor = 1 WHERE source_id = ${endedBox}`.execute(db)).rejects.toSatisfy(isGuardViolation);
  });

  it('makes no engraving when no label holds the word and Orders → Settings has no price: each label a plain service, LIVE only, picked by its open release after M3\'s (none here)', async () => {
    const other = await createTestDb({ migrated: false });
    try {
      expect((await createMigrator(other.db).migrateTo('0059_addons_one_system')).error).toBeUndefined();
      // The data of before, written at 0059 without THE VAULT's hooks (its tables and columns come with 0061).
      vaultHooks.off = true;
      const g = await liveFixture(other.db, '2026-11-01T09:00:00.000Z');
      const release = await createLiveRelease(g, { opensAt: new Date('2026-11-20T18:00:00Z') });
      for (const [label, line, price, position] of [['Gift wrapping', 'In the house’s paper.', 1500, 1], ['CARD', null, 0, 2]] as const) {
        await sql`INSERT INTO live_addons (drop_id, label, line, price_minor, position) VALUES (${release.id}, ${label}, ${line}, ${price}, ${position})`.execute(other.db);
      }
      vaultHooks.off = false;
      expect((await migrateToLatest(other.db)).applied).toEqual(['0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
      expect(
        (await sql.raw(`SELECT a.name, a.kind, a.line, a.offer_live, a.offer_orders, a.engraving, k.code, x.position AS picked, p.price_minor
                          FROM addon_items a JOIN skus k ON k.addon_id = a.id JOIN drop_addons x ON x.addon_id = a.id
                          LEFT JOIN addon_item_prices p ON p.addon_id = a.id AND p.currency = 'EUR' ORDER BY a.position`).execute(other.db)).rows,
      ).toEqual([
        { name: 'Gift wrapping', kind: 'SERVICE', line: 'In the house’s paper.', offer_live: true, offer_orders: false, engraving: false, code: 'ADD-GIFT-WRAPPING', picked: 1, price_minor: 1500 },
        { name: 'CARD', kind: 'SERVICE', line: null, offer_live: true, offer_orders: false, engraving: false, code: 'ADD-CARD', picked: 2, price_minor: 0 },
      ]);
      expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM addon_conversions WHERE source = 'LIVE_ADDON' AND price_minor IS NOT NULL`.execute(other.db)).rows[0]!.n).toBe(2);
      expect((await migrateDown(other.db)).reverted).toEqual(['0064_partners']);
      expect((await migrateDown(other.db)).reverted).toEqual(['0063_margin']);
      expect((await migrateDown(other.db)).reverted).toEqual(['0062_vault_rewards']);
      expect((await migrateDown(other.db)).reverted).toEqual(['0061_the_vault']);
      await expect(migrateDown(other.db)).rejects.toThrow(/0060_release_addons_converted cannot be rolled back: 2 add-on conversions exist/);
    } finally {
      await other.close();
    }
  });

  it('picks for an open release only what its pick may hold (as checkPick): an M3 add-on without a price in the release\'s currency or with its LIVE switch off is left out, and a converted add-on set aside (merged by name) too', async () => {
    const other = await createTestDb({ migrated: false });
    try {
      expect((await createMigrator(other.db).migrateTo('0059_addons_one_system')).error).toBeUndefined();
      // The data of before, written at 0059 without THE VAULT's hooks (its tables and columns come with 0061).
      vaultHooks.off = true;
      const g = await liveFixture(other.db, '2026-11-01T09:00:00.000Z');
      const m3 = async (name: string, position: number, prices: Record<string, number>, cols: { active?: boolean; offer_live?: boolean } = {}) => {
        const id = (await other.db.insertInto('addon_items').values({ name, position, ...cols }).returning('id').executeTakeFirstOrThrow()).id;
        await other.db.insertInto('skus').values({ addon_id: id, code: `M3-${position}` }).execute();
        for (const [currency, price_minor] of Object.entries(prices)) await other.db.insertInto('addon_item_prices').values({ addon_id: id, currency: currency as 'EUR', price_minor }).execute();
        return id;
      };
      await m3('GIFT BOX', 0, { EUR: 2500 });
      await m3('CARE KIT', 1, { GBP: 2600 });
      await m3('POLISHING CLOTH', 2, { EUR: 500 }, { offer_live: false });
      const card = await m3('CARD', 3, { EUR: 300 }, { active: false });
      const release = await createLiveRelease(g, { opensAt: new Date('2026-11-20T18:00:00Z') });
      expect((await other.db.selectFrom('drops').select('currency').where('id', '=', release.id).executeTakeFirstOrThrow()).currency).toBe('EUR');
      for (const [label, price, position] of [['Card', 200, 1], ['Gift wrapping', 1500, 2]] as const) {
        await sql`INSERT INTO live_addons (drop_id, label, line, price_minor, position) VALUES (${release.id}, ${label}, ${null}, ${price}, ${position})`.execute(other.db);
      }
      vaultHooks.off = false;
      expect((await migrateToLatest(other.db)).applied).toEqual(['0060_release_addons_converted', '0061_the_vault', '0062_vault_rewards', '0063_margin', '0064_partners']);
      // CARD (set aside) took the release's Card, untouched; the pick holds GIFT BOX, then Gift wrapping.
      expect((await sql<{ name: string }>`SELECT a.name FROM addon_conversions c JOIN addon_items a ON a.id = c.addon_id ORDER BY a.position`.execute(other.db)).rows.map((x) => x.name)).toEqual(['CARD', 'Gift wrapping']);
      expect((await other.db.selectFrom('addon_items').select('active').where('id', '=', card).executeTakeFirstOrThrow()).active).toBe(false);
      expect(
        (await sql<{ name: string; position: number }>`SELECT a.name, x.position FROM drop_addons x JOIN addon_items a ON a.id = x.addon_id WHERE x.drop_id = ${release.id} ORDER BY x.position`.execute(other.db)).rows,
      ).toEqual([{ name: 'GIFT BOX', position: 1 }, { name: 'Gift wrapping', position: 2 }]);
    } finally {
      await other.close();
    }
  });
});
