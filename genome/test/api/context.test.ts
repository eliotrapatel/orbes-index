import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping } from '../../src/server/context.js';
import { migrationStatus } from '../../src/server/db/migrate.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { createManualClock, type Logger } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { PASSWORD } from './support.js';

function captureLog(): Logger & { lines: { level: string; o: unknown; m?: string }[] } {
  const lines: { level: string; o: unknown; m?: string }[] = [];
  return {
    lines,
    info: (o, m) => lines.push({ level: 'info', o, m }),
    warn: (o, m) => lines.push({ level: 'warn', o, m }),
    error: (o, m) => lines.push({ level: 'error', o, m }),
  };
}

describe('createContext', () => {
  it('migrates an empty database in test/development, bootstraps the admin and a signing key', async () => {
    const t = await createTestDb({ migrated: false });
    const log = captureLog();
    const config = testConfig({ bootstrapAdmin: { email: 'root@orbes.test', password: PASSWORD } });
    const ctx = await createContext(config, { db: t.db, log });
    try {
      expect((await migrationStatus(t.db)).every((m) => m.executedAt !== undefined)).toBe(true);
      const admins = await t.db.selectFrom('admin_users').select(['email', 'role']).execute();
      expect(admins).toEqual([{ email: 'root@orbes.test', role: 'ADMIN' }]);
      expect((await ctx.keys.list()).filter((k) => k.status === 'ACTIVE')).toHaveLength(1);
      expect(Object.keys(ctx.services).sort()).toEqual(
        ['anomaly', 'auth', 'authenticators', 'catalog', 'certificates', 'issuance', 'lifecycle', 'owners', 'ownership', 'recovery', 'reports', 'verification', 'warranty'].sort(),
      );
      // Nothing secret in the startup log.
      const text = JSON.stringify(log.lines);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(config.cookieSecret);

      // A second start is idempotent: no second admin, no second key.
      const again = await createContext(config, { db: t.db });
      expect(await t.db.selectFrom('admin_users').select('id').execute()).toHaveLength(1);
      expect((await again.keys.list()).length).toBe(1);
      await again.close();
    } finally {
      await ctx.close();
      await t.close();
    }
  });

  it('production refuses pending migrations unless asked to migrate', async () => {
    const t = await createTestDb({ migrated: false });
    const config = testConfig({ env: 'production' });
    const opts = { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }) };
    try {
      await expect(createContext(config, opts)).rejects.toThrow(/not up to date/);
      const log = captureLog();
      const ctx = await createContext(config, { ...opts, migrate: true, log });
      // No active key in production is not fatal (verification works), but it is reported.
      expect(log.lines.some((l) => l.level === 'error' && /self-test|issuance is unavailable/.test(String(l.m)))).toBe(true);
      expect((await ctx.keys.list()).length).toBe(0);
      await ctx.close();
    } finally {
      await t.close();
    }
  });

  it('closes the database it opened itself, but never an injected one', async () => {
    const t = await createTestDb();
    const injected = await createContext(testConfig(), { db: t.db });
    await injected.close();
    await injected.close(); // idempotent
    await expect(t.db.selectFrom('categories').selectAll().execute()).resolves.toEqual([]);
    await t.close();

    const owned = await createContext(testConfig({ databaseUrl: 'pglite:memory' }));
    expect((await owned.keys.list()).length).toBe(1);
    await owned.close();
    await expect(owned.db.selectFrom('categories').selectAll().execute()).rejects.toThrow();
  });
});

describe('housekeeping', () => {
  it('purges expired sessions and stale scan tokens', async () => {
    const t = await createTestDb();
    const clock = createManualClock('2026-05-01T00:00:00.000Z');
    const ctx = await createContext(testConfig(), { db: t.db, clock: clock.now });
    const hk = startHousekeeping(ctx, { intervalMs: 3_600_000 });
    try {
      const { account, session } = await ctx.services.auth.registerAccount({ email: 'hk@example.com', password: PASSWORD });
      expect(account.email).toBe('hk@example.com');
      expect((await hk.runOnce()).sessions).toBe(0);
      clock.advance(ctx.config.sessionTtlHours.account * 3_600_000 + 1);
      const r = await hk.runOnce();
      expect(r.sessions).toBe(1);
      expect(await ctx.sessions.validate(session.token, 'account')).toBeNull();
    } finally {
      await hk.stop();
      await ctx.close();
      await t.close();
    }
  });

  it('purges scan history older than SCAN_RETENTION_DAYS, dependants first, and keeps everything when unset', async () => {
    // Each seeded scan carries an authentication event; the 120-day and the 1-day ones also carry a customer's
    // report (scan_reports, C-02), the old one closed by an admin: a report goes with its scan, open or closed.
    const t = await createTestDb();
    const clock = createManualClock('2026-05-01T00:00:00.000Z');
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(clock.now().getTime() - daysAgo * day);
    const seed = async (daysAgo: number) => {
      const [scan] = await t.db
        .insertInto('scan_events')
        .values({ occurred_at: at(daysAgo), event_type: 'VERIFY', result_state: 'UNKNOWN' })
        .returning('id')
        .execute();
      await t.db
        .insertInto('authentication_events')
        .values({ scan_event_id: scan.id, signature_valid: false, genome_check: 'NOT_PROVIDED', state: 'UNKNOWN', risk_score: 0, created_at: at(daysAgo) })
        .execute();
      return scan.id;
    };
    const counts = async () => ({
      scans: (await t.db.selectFrom('scan_events').select('id').execute()).length,
      auth: (await t.db.selectFrom('authentication_events').select('id').execute()).length,
      reports: (await t.db.selectFrom('scan_reports').select('id').execute()).length,
    });
    try {
      const ids: Record<number, string> = {};
      for (const daysAgo of [400, 120, 31, 29, 1]) ids[daysAgo] = await seed(daysAgo);
      const admin = await t.db
        .insertInto('admin_users')
        .values({ email: 'cases@orbes.test', email_normalized: 'cases@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.db
        .insertInto('scan_reports')
        .values([
          {
            scan_event_id: ids[120],
            channel: 'ONLINE',
            place: 'a marketplace',
            note: 'Seller in Lyon.',
            created_at: at(120),
            status: 'CLOSED',
            handled_by: admin.id,
            handled_at: at(119),
            resolution_note: 'Listing reported.',
          },
          { scan_event_id: ids[1], channel: 'BOUTIQUE', place: 'Rue de Rivoli', created_at: at(1) },
        ])
        .execute();

      // Unset (the default): nothing is purged.
      const keepAll = await createContext(testConfig(), { db: t.db, clock: clock.now });
      const hk0 = startHousekeeping(keepAll, { intervalMs: 3_600_000 });
      expect((await hk0.runOnce()).scanHistory).toBe(0);
      await hk0.stop();
      expect(await counts()).toEqual({ scans: 5, auth: 5, reports: 2 });

      const log = captureLog();
      const ctx = await createContext(testConfig({ scanRetentionDays: 30 }), { db: t.db, clock: clock.now, log });
      const hk = startHousekeeping(ctx, { intervalMs: 3_600_000, scanHistoryBatchSize: 2 });
      try {
        const r = await hk.runOnce();
        expect(r.scanHistory).toBe(3);
        // The 120-day scan went with its (closed) report; the recent report stays with its scan.
        expect(await counts()).toEqual({ scans: 2, auth: 2, reports: 1 });
        expect(await t.db.selectFrom('scan_reports').select('scan_event_id').execute()).toEqual([{ scan_event_id: ids[1] }]);
        const left = await t.db.selectFrom('scan_events').select('occurred_at').orderBy('occurred_at').execute();
        expect(left.map((x) => new Date(x.occurred_at).getTime())).toEqual([at(29).getTime(), at(1).getTime()]);
        expect(log.lines.some((l) => l.level === 'info' && (l.o as { scanHistory?: number }).scanHistory === 3)).toBe(true);
        expect((await hk.runOnce()).scanHistory).toBe(0);
        // Thirty days later the remaining two age out as well.
        clock.advance(30 * day);
        expect((await hk.runOnce()).scanHistory).toBe(2);
        expect(await counts()).toEqual({ scans: 0, auth: 0, reports: 0 });
      } finally {
        await hk.stop();
        await ctx.close();
      }
      await keepAll.close();
    } finally {
      await t.close();
    }
  });
});
