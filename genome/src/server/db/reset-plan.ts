/**
 * The PLATFORM RESET's plan (lot PURGE, plan §B.1; the owner's answers of 27 Oct 2026, answer 2): what a reset keeps,
 * what it keeps in part and what it wipes, table by table. Migration 0067_platform_reset holds the same plan in the
 * database (`platform_reset_plan`, written by the migration's superuser only), which the reset function reads: the app
 * never passes a plan. test/db/reset-plan.test.ts keeps the three equal (this file, the database's plan and the tables
 * the migrations create), so a future migration that adds a table fails CI until both plans class it (M17).
 *
 *   KEEP    the catalogue, the settings, the console logins and the signing keys (as on 9 Oct), proven identical row by
 *           row (count and md5) before COMMIT.
 *   PARTLY  kept, minus what only made sense with the wiped data, or with the columns that named it cleared; each one's
 *           rule (RESET_PARTLY_RULES) is proven before COMMIT. The founding list stays (ANSWERS 2), with the sources
 *           and links it needs.
 *   WIPE    emptied: one TRUNCATE, no CASCADE, except `drops` and `accounts` (RESET_DELETE_AFTER_TRUNCATE), which a
 *           kept table still references (`links.drop_id`, `preregistrations.account_id`): PostgreSQL refuses to
 *           TRUNCATE a table referenced from outside the statement, so they are emptied by DELETE after the TRUNCATE.
 */

/** A table's class in the reset (see the header). */
export type ResetClass = 'KEEP' | 'PARTLY' | 'WIPE';

/** The classes, in the database's CHECK order (platform_reset_plan.kind). */
export const RESET_CLASSES: readonly ResetClass[] = Object.freeze(['KEEP', 'PARTLY', 'WIPE']);

/** KEEP (40): whole, proven identical. */
const KEEP = [
  'categories', 'collections', 'models', 'model_images', 'model_pairs', 'skus', 'suppliers', 'stock_locations', 'carriers', 'retailers',
  'club_tiers', 'club_program_settings', 'shipping_rates', 'guarantee_settings', 'order_alert_settings', 'sku_thresholds', 'admin_users',
  'admin_user_locations', 'cryptographic_keys', 'kysely_migration', 'kysely_migration_lock', 'heard_options', 'link_channels',
  'email_templates', 'house_moment_settings', 'boxes', 'stock_location_countries', 'addon_items', 'addon_item_prices', 'sets', 'set_models',
  'vault_sources', 'currency_rates', 'shipping_cost_rates', 'margin_unit_costs', 'category_allowances', 'ads_settings',
  'ads_channel_platforms', 'platform_reset_plan', 'purge_delete_tables',
] as const;

/** PARTLY (8): kept by rule, each rule proven. */
const PARTLY = ['media_objects', 'revocations', 'segments', 'vault_rewards', 'preregistrations', 'acquisition_sources', 'links', 'platform_reset_gate'] as const;

/** WIPE (116): emptied. */
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
] as const;

/** Every table of the schema (the migrations' and Kysely's two) with its class: KEEP 40 + PARTLY 8 + WIPE 116 = 164. */
export const RESET_PLAN: Readonly<Record<string, ResetClass>> = Object.freeze(
  Object.fromEntries(
    [...KEEP.map((t) => [t, 'KEEP'] as const), ...PARTLY.map((t) => [t, 'PARTLY'] as const), ...WIPE.map((t) => [t, 'WIPE'] as const)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ),
);

/**
 * The wiped tables emptied by DELETE after the TRUNCATE, in this order: a kept table references each one (`links.drop_id`
 * is re-pointed first, `preregistrations.account_id` cleared first). `drops` loses its after-room children first; the
 * whole of `accounts` goes in one statement (its own `invited_by` is checked at the statement's end).
 */
export const RESET_DELETE_AFTER_TRUNCATE: readonly string[] = Object.freeze(['drops', 'accounts']);

/**
 * The columns of `platform_reset_gate` a reset changes (step 10), and only these: its time, its admin, the count (+1)
 * and what it captured. Every other column is checked unchanged, the authorization cleared, column by column.
 */
export const RESET_GATE_CHANGED: readonly string[] = Object.freeze(['last_reset_at', 'last_reset_by', 'resets', 'last_reset_details']);
/** The gate's columns a reset never changes (its authorization is cleared at step 1 and stays NULL). */
export const RESET_GATE_UNCHANGED: readonly string[] = Object.freeze(['id', 'holder_admin_id', 'launched_at', 'launched_by', 'authorized_by', 'authorized_at', 'authorized_purpose']);

/** Each partly kept table's rule, in words (the console's preview, the docs); the reset function proves each one. */
export const RESET_PARTLY_RULES: Readonly<Record<(typeof PARTLY)[number], string>> = Object.freeze({
  media_objects: 'Only the photographs a kept model (its cover) or a lookbook uses stay; piece photos, Circle post images and release silhouettes go.',
  revocations: 'Only the revocations of signing keys stay; those of codes and pieces go with them.',
  segments:
    'A segment whose rules name a release, or a link that goes, goes with them; every other segment stays unchanged.',
  vault_rewards: 'Every reward stays; those given are set back to 0 given (their updated_at moves), every other column unchanged; a reward never given stays byte for byte.',
  preregistrations: 'The founding list stays whole; only the account each address had matched, and when, are cleared (the accounts go).',
  acquisition_sources: 'Only the sources the founding list names stay, unchanged; the boot adds the fixed ones again.',
  links: 'Only the links those sources name stay, unchanged, except that a link to a release now leads to the releases page (its release goes).',
  platform_reset_gate:
    'The one row stays: the authorization is cleared first (used once); then only last_reset_at, last_reset_by, resets (+1) and last_reset_details change; the holder and LOCK RESET (launched_at, launched_by) never do, checked column by column.',
});

/** The purposes the reset functions authorize (platform_reset_gate.authorized_purpose; the step-up's purposes). */
export const RESET_PURPOSES = Object.freeze(['platform.reset', 'platform.reset.lock'] as const);
export type ResetPurpose = (typeof RESET_PURPOSES)[number];

/** How long an authorization lasts (written in the step-up's transaction, used once by the reset or LOCK RESET). */
export const RESET_AUTHORIZATION_MS = 5 * 60_000;

/** What `orbes_platform_reset_precheck` answers when the reset is refused now (NULL: allowed). */
export const RESET_PRECHECK_REASONS = Object.freeze(['NO_HOLDER', 'NOT_HOLDER', 'LOCKED', 'WINDOW', 'TEST_RUNNING', 'LIVE_OPEN', 'COLLECTORS_CHANGED'] as const);
export type ResetPrecheckReason = (typeof RESET_PRECHECK_REASONS)[number];
