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
import * as m0007 from './migrations/0007_print_batch_indexes.js';
import * as m0009 from './migrations/0009_scan_daily_stats.js';

/** Ordered by name; append new migrations here. Never edit an applied one. */
export const MIGRATIONS: Readonly<Record<string, Migration>> = Object.freeze({
  '0001_initial': m0001,
  '0002_platform_guards': m0002,
  '0003_authentication_events_default': m0003,
  '0007_print_batch_indexes': m0007,
  '0009_scan_daily_stats': m0009,
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
