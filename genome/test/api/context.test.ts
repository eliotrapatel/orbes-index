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
        ['anomaly', 'auth', 'authenticators', 'issuance', 'lifecycle', 'ownership', 'verification', 'warranty'].sort(),
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
});
