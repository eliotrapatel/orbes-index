/**
 * Schema migrations. The provider is static (imports, not a directory scan)
 * so it keeps working when the server is bundled.
 *
 * Kysely 0.29's Migrator runs ALL pending migrations of one call inside ONE
 * transaction (PostgreSQL has transactional DDL), under an advisory lock: a
 * failing migration rolls back every migration of that run, not just itself,
 * and concurrent instances starting together apply each migration exactly
 * once. Write migrations so that they can share a transaction (no
 * CREATE INDEX CONCURRENTLY, no VACUUM).
 */
import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider, type MigrationResultSet } from 'kysely/migration';
import * as m0001 from './migrations/0001_initial.js';
import * as m0002 from './migrations/0002_platform_guards.js';
import * as m0003 from './migrations/0003_authentication_events_default.js';
import * as m0004 from './migrations/0004_scan_reports.js';
import * as m0005 from './migrations/0005_account_recovery.js';
import * as m0006 from './migrations/0006_admin_password_change_required.js';
import * as m0007 from './migrations/0007_print_batch_indexes.js';
import * as m0008 from './migrations/0008_retail_mode.js';
import * as m0009 from './migrations/0009_scan_daily_stats.js';
import * as m0010 from './migrations/0010_models_active.js';
import * as m0011 from './migrations/0011_scan_token_transfer_accept.js';
import * as m0012 from './migrations/0012_media.js';
import * as m0013 from './migrations/0013_ownership_certificates.js';
import * as m0014 from './migrations/0014_model_lookbook.js';
import * as m0015 from './migrations/0015_drops.js';
import * as m0016 from './migrations/0016_circle.js';
import * as m0017 from './migrations/0017_drop_early_access.js';
import * as m0018 from './migrations/0018_club_tiers.js';
import * as m0019 from './migrations/0019_model_discontinued.js';
import * as m0020 from './migrations/0020_private_salon.js';
import * as m0021 from './migrations/0021_live_release.js';
import * as m0022 from './migrations/0022_orders_stock.js';
import * as m0023 from './migrations/0023_releases_collectors.js';
import * as m0024 from './migrations/0024_model_variants.js';
import * as m0024z from './migrations/0024_z_test_entrants.js';
import * as m0025 from './migrations/0025_client_messages.js';
import * as m0026 from './migrations/0026_club_program.js';
import * as m0027 from './migrations/0027_tier_grants.js';
import * as m0028 from './migrations/0028_yearly_care.js';
import * as m0029 from './migrations/0029_house_guarantee.js';
import * as m0030 from './migrations/0030_account_sizes.js';
import * as m0031 from './migrations/0031_model_pairs.js';
import * as m0032 from './migrations/0032_growth_indexes.js';
import * as m0033 from './migrations/0033_model_sizes.js';
import * as m0034 from './migrations/0034_claim_code_renewals.js';
import * as m0035 from './migrations/0035_logistics_access.js';
import * as m0036 from './migrations/0036_supplier_orders.js';
import * as m0037 from './migrations/0037_fulfilment.js';
import * as m0038 from './migrations/0038_draw_sizes.js';
import * as m0039 from './migrations/0039_order_delivery.js';
import * as m0040 from './migrations/0040_account_profiles.js';
import * as m0041 from './migrations/0041_account_wishes.js';
import * as m0042 from './migrations/0042_collector_views.js';

/** Ordered by name; append new migrations here. Never edit an applied one. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_initial': m0001,
  '0002_platform_guards': m0002,
  '0003_authentication_events_default': m0003,
  '0004_scan_reports': m0004,
  '0005_account_recovery': m0005,
  '0006_admin_password_change_required': m0006,
  '0007_print_batch_indexes': m0007,
  '0008_retail_mode': m0008,
  '0009_scan_daily_stats': m0009,
  '0010_models_active': m0010,
  '0011_scan_token_transfer_accept': m0011,
  '0012_media': m0012,
  '0013_ownership_certificates': m0013,
  '0014_model_lookbook': m0014,
  '0015_drops': m0015,
  '0016_circle': m0016,
  '0017_drop_early_access': m0017,
  '0018_club_tiers': m0018,
  '0019_model_discontinued': m0019,
  '0020_private_salon': m0020,
  '0021_live_release': m0021,
  '0022_orders_stock': m0022,
  '0023_releases_collectors': m0023,
  '0024_model_variants': m0024,
  '0024_z_test_entrants': m0024z,
  '0025_client_messages': m0025,
  '0026_club_program': m0026,
  '0027_tier_grants': m0027,
  '0028_yearly_care': m0028,
  '0029_house_guarantee': m0029,
  '0030_account_sizes': m0030,
  '0031_model_pairs': m0031,
  '0032_growth_indexes': m0032,
  '0033_model_sizes': m0033,
  '0034_claim_code_renewals': m0034,
  '0035_logistics_access': m0035,
  '0036_supplier_orders': m0036,
  '0037_fulfilment': m0037,
  '0038_draw_sizes': m0038,
  '0039_order_delivery': m0039,
  '0040_account_profiles': m0040,
  '0041_account_wishes': m0041,
  '0042_collector_views': m0042,
});

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...MIGRATIONS };
  }
}

export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({ db, provider: new StaticMigrationProvider() });
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

function unwrap(rs: MigrationResultSet): string[] {
  if (rs.error) {
    const failed = rs.results?.find((r) => r.status === 'Error')?.migrationName;
    throw new MigrationError(`migration ${failed ?? '(unknown)'} failed: ${(rs.error as Error)?.message ?? String(rs.error)}`, {
      cause: rs.error,
    });
  }
  return (rs.results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** Apply all pending migrations. Returns the names applied by this call. Throws MigrationError on failure. */
export async function migrateToLatest(db: Kysely<any>): Promise<{ applied: string[] }> {
  return { applied: unwrap(await createMigrator(db).migrateToLatest()) };
}

/** Roll back the most recent migration (dev tooling only). */
export async function migrateDown(db: Kysely<any>): Promise<{ reverted: string[] }> {
  return { reverted: unwrap(await createMigrator(db).migrateDown()) };
}

/** Which migrations exist and which are applied. */
export async function migrationStatus(db: Kysely<any>): Promise<{ name: string; executedAt?: Date }[]> {
  const list = await createMigrator(db).getMigrations();
  return list.map((m) => (m.executedAt ? { name: m.name, executedAt: m.executedAt } : { name: m.name }));
}
