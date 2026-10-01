/**
 * Demo mode (src/server/demo.ts, `src/server/index.ts --demo`): seeded at
 * start on pglite:memory, refused in production, clock following real time
 * after the seed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, testConfig } from '../../src/server/config.js';
import { DEMO_FIRST_REGISTRATION_PRODUCT_ID, DEMO_TIMELINE_START } from '../../src/server/db/seed/demo.js';
import { createDemoClock, demoBanner, DEMO_ADMIN_EMAIL, demoRefusal, DemoModeError, startDemo, type DemoStart } from '../../src/server/demo.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import { createTestDb, type TestDb } from '../support/db.js';

describe('demo clock', () => {
  it('is driven by hand during the seed, then follows real time', () => {
    let real = Date.parse('2026-10-01T12:00:00.000Z');
    const clock = createDemoClock(DEMO_TIMELINE_START, () => real);
    expect(clock.now()).toEqual(DEMO_TIMELINE_START);
    clock.set('2026-03-01T00:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-01T00:00:00.000Z');
    clock.followRealTime();
    expect(clock.now().getTime()).toBe(real);
    real += 5_000;
    expect(clock.now().getTime()).toBe(real);
    expect(() => clock.set(0)).toThrow(DemoModeError);
  });
});

describe('demo refusals', () => {
  it('refuses production and any database other than pglite:memory', async () => {
    expect(demoRefusal(testConfig())).toBeUndefined();
    expect(demoRefusal({ env: 'production', databaseUrl: 'pglite:memory' })).toMatch(/refused in production/);
    expect(demoRefusal({ env: 'development', databaseUrl: 'postgres://u:p@db/orbes' })).toMatch(/pglite:memory only/);
    expect(demoRefusal(loadConfig({ DATABASE_URL: 'pglite:/tmp/orbes-demo' }))).toMatch(/pglite:memory only/);
    await expect(startDemo(testConfig({ env: 'production' }))).rejects.toThrow(DemoModeError);
  });
});

describe('startDemo', () => {
  let t: TestDb;
  let demo: DemoStart;
  let real = Date.parse('2026-10-01T09:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    demo = await startDemo(testConfig(), {
      context: { db: t.db, keyProvider: new MemoryKeyProvider({ env: 'test' }) },
      realNow: () => real,
    });
  }, 240_000);
  afterAll(async () => {
    await demo?.ctx.close();
    await t?.close();
  });

  it('loads the demo dataset and creates a demo admin (password shown once)', async () => {
    expect(demo.seed.products).toBeGreaterThanOrEqual(40);
    expect(demo.admin.email).toBe(DEMO_ADMIN_EMAIL);
    expect(demo.admin.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const login = await demo.ctx.services.auth.adminLogin({ email: DEMO_ADMIN_EMAIL, password: demo.admin.password! });
    expect(login.admin.role).toBe('ADMIN');
    const banner = demoBanner(demo, 'http://localhost:8080');
    expect(banner).toContain('http://localhost:8080/admin');
    expect(banner).toContain(DEMO_FIRST_REGISTRATION_PRODUCT_ID);
  });

  it('hands the clock to real time after seeding', () => {
    expect(demo.ctx.clock().getTime()).toBe(real);
    real += 60_000;
    expect(demo.ctx.clock().getTime()).toBe(real);
  });
});
