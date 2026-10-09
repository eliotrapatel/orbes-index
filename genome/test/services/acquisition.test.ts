/**
 * AcquisitionService (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.7.1 and A.15 « acquisition.test.ts »):
 *
 *  - prepare() (step 4.1): the seven channels, the DIRECT, BEFORE and STAFF sources and the one state row, once,
 *    whether it runs twice or twice at once; a channel staff removed is not made again, nor any once all are; a second boot never moves the
 *    recording's start; the boot of the app (context.ts) runs it.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AcquisitionService, CHANNEL_PRESETS, FIXED_SOURCES } from '../../src/server/services/acquisition.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { createHarness } from '../api/support.js';

const ORIGIN = 'https://verify.theorbes.com';

const channelsOf = (db: Db) => db.selectFrom('link_channels').select(['name', 'position', 'created_by']).orderBy('position').execute();
const sourcesOf = (db: Db) => db.selectFrom('acquisition_sources').select(['kind', 'key', 'link_id', 'site']).orderBy('id').execute();

describe('AcquisitionService.prepare (§3.4 A.6, step 4.1)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t?.close());

  it('makes the seven channels, the three fixed sources and the state row once, at the first boot\'s time', async () => {
    const first = new Date('2026-10-12T07:00:00.000Z');
    const service = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => first });
    expect(service.publicHost).toBe('verify.theorbes.com');
    expect(await service.trackingStartedAt()).toBeNull();
    const done = await service.prepare();
    expect(done).toEqual({ channels: CHANNEL_PRESETS.map(([n]) => n), sources: [...FIXED_SOURCES], started: first });
    expect(await channelsOf(t.db)).toEqual([
      { name: 'Instagram', position: 10, created_by: null },
      { name: 'TikTok', position: 20, created_by: null },
      { name: 'Influencers', position: 30, created_by: null },
      { name: 'Press', position: 40, created_by: null },
      { name: 'Shops', position: 50, created_by: null },
      { name: 'Search', position: 60, created_by: null },
      { name: 'Other', position: 70, created_by: null },
    ]);
    expect(await sourcesOf(t.db)).toEqual(FIXED_SOURCES.map((k) => ({ kind: k, key: k, link_id: null, site: null })));
    expect(await t.db.selectFrom('acquisition_state').selectAll().execute()).toEqual([{ id: 1, tracking_started_at: first, conversions_until: first, catch_up_on: null, daily_until: null }]);
    expect(await service.trackingStartedAt()).toEqual(first);
  });

  it('a second boot, and two at once, make nothing more and never move the start', async () => {
    const later = new Date('2026-10-20T07:00:00.000Z');
    const again = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => later });
    const other = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => later });
    const runs = await Promise.all([again.prepare(), other.prepare(), again.prepare()]);
    for (const r of runs) expect(r).toEqual({ channels: [], sources: [], started: null });
    expect(await channelsOf(t.db)).toHaveLength(7);
    expect(await sourcesOf(t.db)).toHaveLength(3);
    expect((await t.db.selectFrom('acquisition_state').select('tracking_started_at').executeTakeFirstOrThrow()).tracking_started_at).toEqual(new Date('2026-10-12T07:00:00.000Z'));
  });

  it('never makes again a channel staff removed, nor the presets once any channel exists; a missing fixed source comes back', async () => {
    await t.db.deleteFrom('link_channels').where('name', '=', 'Press').execute();
    await t.db.deleteFrom('acquisition_sources').where('key', '=', 'STAFF').execute();
    const service = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => new Date('2026-10-21T07:00:00.000Z') });
    expect(await service.prepare()).toEqual({ channels: [], sources: ['STAFF'], started: null });
    expect((await channelsOf(t.db)).map((c) => c.name)).toEqual(['Instagram', 'TikTok', 'Influencers', 'Shops', 'Search', 'Other']);
    // Even once staff removed every channel, a later boot makes none: the presets are the first boot's only.
    await t.db.deleteFrom('link_channels').execute();
    expect(await service.prepare()).toEqual({ channels: [], sources: [], started: null });
    expect(await channelsOf(t.db)).toEqual([]);
  });

  it('reads the host of the app\'s own origin in lower case, without its port', () => {
    expect(new AcquisitionService({ db: t.db, publicOrigin: 'http://LOCALHOST:3000' }).publicHost).toBe('localhost');
    expect(new AcquisitionService({ db: t.db, publicOrigin: 'not an origin' }).publicHost).toBe('');
  });
});

describe('the boot runs AcquisitionService.prepare (context.ts)', () => {
  it('a new context has the channels, the fixed sources and the recording\'s start', async () => {
    const h = await createHarness();
    try {
      expect(await channelsOf(h.ctx.db)).toHaveLength(7);
      expect((await sourcesOf(h.ctx.db)).map((s) => s.key)).toEqual(['DIRECT', 'BEFORE', 'STAFF']);
      expect(await h.ctx.services.acquisition.trackingStartedAt()).toEqual(expect.any(Date));
    } finally {
      await h.close();
    }
  });
});

// ── PostgreSQL: two boots at once for real (§3.4 A.6 « two processes at once create one set ») ─────────────────────
// PGlite above runs on one connection, so its « at once » is in turn; here a pool of 8 lets several services prepare
// in parallel transactions. Runs in genome-ci with ORBES_TEST_POSTGRES_URL; skipped without it.
const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('AcquisitionService.prepare on PostgreSQL', () => {
  let admin: Db;
  let db: Db;
  const name = `orbes_acquisition_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
  }, 120_000);
  afterAll(async () => {
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  it('makes one set of channels, sources and state when six processes boot at once', async () => {
    const services = Array.from({ length: 6 }, (_, i) => new AcquisitionService({ db, publicOrigin: ORIGIN, clock: () => new Date(Date.UTC(2026, 9, 12, 7, 0, i)) }));
    const runs = await Promise.all(services.map((s) => s.prepare()));
    expect(runs.filter((r) => r.started !== null)).toHaveLength(1);
    expect(await channelsOf(db)).toHaveLength(7);
    expect((await sourcesOf(db)).map((s) => s.key).sort()).toEqual(['BEFORE', 'DIRECT', 'STAFF']);
    expect(await db.selectFrom('acquisition_state').select('id').execute()).toEqual([{ id: 1 }]);
  });
});
