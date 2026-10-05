import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/server/config.js';
import { createContext, startHousekeeping, startLiveEngine } from '../../src/server/context.js';
import { migrationStatus } from '../../src/server/db/migrate.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { createManualClock, type Logger } from '../../src/server/types.js';
import { createTestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, liveFixture } from '../support/live.js';
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
        ['activity', 'anomaly', 'atelier', 'auth', 'authenticators', 'catalog', 'certificates', 'circle', 'club', 'drops', 'fulfilment', 'invoices', 'issuance', 'lifecycle', 'live', 'liveConsole', 'liveInsights', 'liveRoom', 'lookbook', 'media', 'orders', 'owners', 'ownership', 'ownershipCertificates', 'pastReleases', 'questions', 'recovery', 'reports', 'retailers', 'sale', 'salon', 'segments', 'stock', 'verification', 'warranty'].sort(),
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

describe('the LIVE RELEASES\' engine', () => {
  it('starts with the context, on PGlite\'s one connection: forms the line at T0 and gives the turns, then stops and hands its lock back', async () => {
    const t = await createTestDb();
    const f = await liveFixture(t.db, '2026-12-01T09:00:00.000Z');
    const ctx = await createContext(testConfig(), { db: t.db, clock: f.clock.now });
    const opensAt = new Date('2026-12-01T10:00:00.000Z');
    const r = await createLiveRelease(f, { opensAt, sizes: [{ label: '52', stock: 1 }] });
    const [a, b] = [await accountOfTier(f, 3), await accountOfTier(f, 0)];
    f.clock.set('2026-12-01T09:58:00.000Z');
    for (const x of [a, b]) await ctx.services.live.enter(x.id, r.id, { sizeId: r.sizes[0]!.id }, x.actor);
    f.clock.set(opensAt);
    const engine = startLiveEngine(ctx, { tickMs: 20, standbyMs: 50 });
    try {
      const statuses = async () => (await t.db.selectFrom('live_entries').select(['account_id', 'status']).where('drop_id', '=', r.id).orderBy('position').execute()).map((e) => [e.account_id, e.status]);
      for (let i = 0; i < 200 && (await statuses()).join() !== [[a.id, 'TURN'], [b.id, 'QUEUED']].join(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await statuses()).toEqual([[a.id, 'TURN'], [b.id, 'QUEUED']]);
      expect(engine.leading).toBe(true);
    } finally {
      await engine.stop();
      await ctx.close();
      await t.close();
    }
    expect(engine.leading).toBe(false);
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
      const first = await hk.runOnce();
      expect(first.sessions).toBe(0);
      // The LIVE RELEASES' network hashes are erased 30 days after their release (services/live.ts): none here.
      expect(first.liveNetworks).toBe(0);
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

  it('purges scan history older than SCAN_RETENTION_DAYS, dependants first, after counting it, and keeps everything when unset', async () => {
    // Each seeded scan carries an authentication event; the 120-day and the 1-day ones also carry a customer's
    // report (scan_reports, C-02), the old one closed by an admin: a report goes with its scan, open or closed.
    // The daily statistics (A-09) count every complete day before the purge, and the purge never lowers them.
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
    /** The scans counted by the daily statistics: their total, and the days counted. */
    const counted = async () => {
      const rows = await t.db.selectFrom('scan_daily_stats').select(['day', 'country', 'result_state', 'event_type', 'n']).execute();
      for (const r of rows) expect([r.country, r.result_state, r.event_type]).toEqual(['ZZ', 'UNKNOWN', 'VERIFY']);
      return { scans: rows.reduce((n, r) => n + Number(r.n), 0), days: rows.length };
    };
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
      const first = await hk0.runOnce();
      expect(first.scanHistory).toBe(0);
      // Midnight UTC: yesterday is not complete yet (ten minutes after midnight), so the 1-day scan waits.
      expect(first.scanStats).toBe(4);
      await hk0.stop();
      expect(await counts()).toEqual({ scans: 5, auth: 5, reports: 2 });
      expect(await counted()).toEqual({ scans: 4, days: 4 });

      const log = captureLog();
      const ctx = await createContext(testConfig({ scanRetentionDays: 30 }), { db: t.db, clock: clock.now, log });
      const hk = startHousekeeping(ctx, { intervalMs: 3_600_000, scanHistoryBatchSize: 2 });
      try {
        const r = await hk.runOnce();
        expect(r.scanHistory).toBe(3);
        // The 120-day scan went with its (closed) report; the recent report stays with its scan.
        expect(await counts()).toEqual({ scans: 2, auth: 2, reports: 1 });
        // The purged scans stay counted: the statistics ran first and the purge never touches them.
        expect(await counted()).toEqual({ scans: 4, days: 4 });
        expect(await t.db.selectFrom('scan_reports').select('scan_event_id').execute()).toEqual([{ scan_event_id: ids[1] }]);
        const left = await t.db.selectFrom('scan_events').select('occurred_at').orderBy('occurred_at').execute();
        expect(left.map((x) => new Date(x.occurred_at).getTime())).toEqual([at(29).getTime(), at(1).getTime()]);
        expect(log.lines.some((l) => l.level === 'info' && (l.o as { scanHistory?: number }).scanHistory === 3)).toBe(true);
        expect((await hk.runOnce()).scanHistory).toBe(0);
        // Thirty days later the remaining two age out as well.
        clock.advance(30 * day);
        expect((await hk.runOnce()).scanHistory).toBe(2);
        expect(await counts()).toEqual({ scans: 0, auth: 0, reports: 0 });
        // The 1-day scan, now in a complete day, was counted in the same pass, before its purge.
        expect(await counted()).toEqual({ scans: 5, days: 5 });
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
