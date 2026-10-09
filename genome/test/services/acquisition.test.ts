/**
 * AcquisitionService (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.7.1 and A.15 « acquisition.test.ts »):
 *
 *  - prepare() (step 4.1): the seven channels, the DIRECT, BEFORE and STAFF sources and the one state row, once,
 *    whether it runs twice or twice at once; a channel staff removed is not made again, nor any once all are; a
 *    second boot never moves the recording's start; the boot of the app (context.ts) runs it.
 *  - the arrival (step 4.2): classify's order (link > tags > site > direct); an unknown link, an archived one; tags in
 *    lower case; one visit per device, source and Paris day, its arrivals counted and its last arrival moved; Direct
 *    writes no visit; a first arrival sets the device's first source once; the account kept once known; the cap of 100
 *    new sources a Paris day (the 101st falls back to its site, then Direct); through TrackingService.ingest, a
 *    console session records nothing and marks the device, a robot records nothing, a failing arrival leaves the views.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AcquisitionService, CHANNEL_PRESETS, classify, FIXED_SOURCES, SOURCES_PER_DAY, TAG_SEPARATOR } from '../../src/server/services/acquisition.js';
import { PlaceService } from '../../src/server/services/places.js';
import { TrackingService, type SeenBatch, type SeenMeta } from '../../src/server/services/tracking.js';
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

describe('the arrival: classify (§3.4 A.5)', () => {
  const OWN = 'verify.theorbes.com';
  it('tries the link, then the tags, then the site, then Direct, always last', () => {
    expect(classify({ link: 'Instagram-Bio', utm: { source: 'IG', campaign: 'Drop' }, referrer: 'https://l.instagram.com/' }, OWN)).toEqual([
      { kind: 'LINK', code: 'instagram-bio' },
      { kind: 'CAMPAIGN', key: `C:ig${TAG_SEPARATOR}${TAG_SEPARATOR}drop${TAG_SEPARATOR}${TAG_SEPARATOR}`, tags: { source: 'ig', medium: null, campaign: 'drop', content: null, term: null } },
      { kind: 'SITE', key: 'S:instagram.com', site: 'instagram.com' },
      { kind: 'DIRECT', key: 'DIRECT' },
    ]);
    expect(classify({ utm: { medium: 'story', content: 'x' } }, OWN)).toEqual([{ kind: 'DIRECT', key: 'DIRECT' }]);
    expect(classify({ utm: { campaign: ' Drop-14 ' } }, OWN)[0]).toMatchObject({ kind: 'CAMPAIGN', tags: { campaign: 'drop-14' } });
    expect(classify({ referrer: 'https://verify.theorbes.com/verify' }, OWN)).toEqual([{ kind: 'DIRECT', key: 'DIRECT' }]);
    expect(classify({ link: 'x', referrer: 'javascript:1' }, OWN)).toEqual([{ kind: 'DIRECT', key: 'DIRECT' }]);
    expect(classify({}, OWN)).toEqual([{ kind: 'DIRECT', key: 'DIRECT' }]);
  });
});

describe('AcquisitionService.arrive (§3.4 A.7.1, step 4.2)', () => {
  let t: TestDb;
  let service: AcquisitionService;
  let admin: string;
  let channel: string;
  let seq = 0;
  const OWN = 'https://verify.theorbes.com';
  const NOW = new Date('2026-10-12T08:00:00.000Z');

  beforeAll(async () => {
    t = await createTestDb();
    service = new AcquisitionService({ db: t.db, publicOrigin: OWN, clock: () => NOW });
    await service.prepare();
    admin = (await t.db.insertInto('admin_users').values({ email: 'acq@orbes.test', email_normalized: 'acq@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id;
    channel = (await t.db.selectFrom('link_channels').select('id').where('name', '=', 'Instagram').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => t?.close());

  const device = async () => (await t.db.insertInto('tracking_devices').values({ device_hash: `${String(++seq).padStart(4, '0')}${'d'.repeat(39)}`, first_seen_at: NOW, last_seen_at: NOW }).returning('id').executeTakeFirstOrThrow()).id;
  const makeLink = async (code: string, archived = false) => {
    const link = await t.db
      .insertInto('links')
      .values({ code, name: code, channel_id: channel, destination: 'NOW', created_by: admin, ...(archived ? { archived_at: NOW, archived_by: admin } : {}) })
      .returning('id')
      .executeTakeFirstOrThrow();
    const source = await t.db.insertInto('acquisition_sources').values({ kind: 'LINK', link_id: link.id, key: `L:${link.id}` }).returning('id').executeTakeFirstOrThrow();
    return { linkId: link.id, sourceId: source.id };
  };
  const sourceRow = (id: number) => t.db.selectFrom('acquisition_sources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const touchesOf = (deviceId: number) => t.db.selectFrom('acquisition_touches').selectAll().where('device_id', '=', deviceId).orderBy('id').execute();
  const firstSourceOf = async (deviceId: number) => (await t.db.selectFrom('tracking_devices').select('first_source_id').where('id', '=', deviceId).executeTakeFirstOrThrow()).first_source_id;
  const directId = async () => (await t.db.selectFrom('acquisition_sources').select('id').where('key', '=', 'DIRECT').executeTakeFirstOrThrow()).id;
  const countNew = async () =>
    Number((await t.db.selectFrom('acquisition_sources').select((eb) => eb.fn.countAll().as('n')).where('kind', 'in', ['CAMPAIGN', 'SITE']).executeTakeFirstOrThrow()).n);

  it('a link wins over the tags and the site; an archived link still counts; its code read in any case', async () => {
    const bio = await makeLink('instagram-bio');
    const old = await makeLink('old-story', true);
    const d = await device();
    const r = await service.arrive({ deviceId: d, accountId: null, link: 'INSTAGRAM-BIO', utm: { source: 'ig', campaign: 'drop' }, referrer: 'https://l.instagram.com/', now: NOW });
    expect(r).toEqual({ sourceId: bio.sourceId, kind: 'LINK', firstSource: true, touch: true });
    expect(await firstSourceOf(d)).toBe(bio.sourceId);
    // The tags and the site were not made into sources.
    expect(await countNew()).toBe(0);
    expect((await service.arrive({ deviceId: d, accountId: null, link: 'old-story', now: NOW })).sourceId).toBe(old.sourceId);
  });

  it('an unknown link falls to the tags, the tags to the site, the site to Direct', async () => {
    const d = await device();
    const viaTags = await service.arrive({ deviceId: d, accountId: null, link: 'no-such-link', utm: { source: ' Instagram ', medium: 'Story', campaign: 'Drop-14', content: 'story-2', term: 'Rings' }, referrer: 'https://www.google.fr/', now: NOW });
    expect(viaTags.kind).toBe('CAMPAIGN');
    expect(await sourceRow(viaTags.sourceId)).toMatchObject({
      kind: 'CAMPAIGN',
      link_id: null,
      site: null,
      utm_source: 'instagram',
      utm_medium: 'story',
      utm_campaign: 'drop-14',
      utm_content: 'story-2',
      utm_term: 'rings',
      key: ['C:instagram', 'story', 'drop-14', 'story-2', 'rings'].join(TAG_SEPARATOR),
    });
    // The same tags in another case are the same campaign.
    expect((await service.arrive({ deviceId: d, accountId: null, utm: { source: 'INSTAGRAM', medium: 'story', campaign: 'DROP-14', content: 'Story-2', term: 'rings' }, now: NOW })).sourceId).toBe(viaTags.sourceId);
    const viaSite = await service.arrive({ deviceId: d, accountId: null, utm: { medium: 'story' }, referrer: 'https://www.google.fr/search', now: NOW });
    expect(viaSite.kind).toBe('SITE');
    expect(await sourceRow(viaSite.sourceId)).toMatchObject({ kind: 'SITE', site: 'google.com', key: 'S:google.com' });
    const direct = await service.arrive({ deviceId: d, accountId: null, referrer: 'https://verify.theorbes.com/verify/releases', now: NOW });
    expect(direct).toEqual({ sourceId: await directId(), kind: 'DIRECT', firstSource: false, touch: false });
    // The device's first source stayed its first arrival's.
    expect(await firstSourceOf(d)).toBe(viaTags.sourceId);
  });

  it('one visit per device, source and Paris day: its arrivals counted, its last arrival moved, the account kept once known; Direct writes none', async () => {
    const d = await device();
    const account = (await t.db.insertInto('accounts').values({ email: 'arr@example.com', email_normalized: 'arr@example.com', password_hash: 'scrypt$x' }).returning('id').executeTakeFirstOrThrow()).id;
    const at = (iso: string) => new Date(iso);
    const site = { referrer: 'https://www.vogue.fr/article' };
    await service.arrive({ deviceId: d, accountId: null, ...site, now: at('2026-10-12T06:00:00.000Z') });
    await service.arrive({ deviceId: d, accountId: account, ...site, now: at('2026-10-12T09:00:00.000Z') });
    await service.arrive({ deviceId: d, accountId: null, ...site, now: at('2026-10-12T21:59:59.000Z') });
    // 22:00 UTC is midnight in Paris: the next day, a new visit.
    await service.arrive({ deviceId: d, accountId: null, ...site, now: at('2026-10-12T22:00:00.000Z') });
    const rows = await touchesOf(d);
    expect(rows.map((r) => ({ day: r.day, first: r.first_at.toISOString(), last: r.last_at.toISOString(), arrivals: r.arrivals, account: r.account_id }))).toEqual([
      { day: '2026-10-12', first: '2026-10-12T06:00:00.000Z', last: '2026-10-12T21:59:59.000Z', arrivals: 3, account },
      { day: '2026-10-13', first: '2026-10-12T22:00:00.000Z', last: '2026-10-12T22:00:00.000Z', arrivals: 1, account: null },
    ]);
    // Direct writes no visit, but a device's first arrival sets its first source, Direct included.
    const quiet = await device();
    const r = await service.arrive({ deviceId: quiet, accountId: null, now: NOW });
    expect(r).toMatchObject({ kind: 'DIRECT', firstSource: true, touch: false });
    expect(await touchesOf(quiet)).toEqual([]);
    expect(await firstSourceOf(quiet)).toBe(await directId());
    // A later link never changes it.
    const later = await makeLink('later-link');
    expect(await service.arrive({ deviceId: quiet, accountId: null, link: 'later-link', now: NOW })).toMatchObject({ sourceId: later.sourceId, firstSource: false, touch: true });
    expect(await firstSourceOf(quiet)).toBe(await directId());
  });

  it('makes at most 100 new campaign and site sources a Paris day: the 101st falls back to its site, then to Direct', async () => {
    const day = new Date('2026-10-20T10:00:00.000Z');
    const fresh = new AcquisitionService({ db: t.db, publicOrigin: OWN, clock: () => day });
    const d = await device();
    const before = await countNew();
    for (let i = 0; i < SOURCES_PER_DAY; i++) await fresh.arrive({ deviceId: d, accountId: null, utm: { campaign: `junk-${i}` }, now: day });
    expect((await countNew()) - before).toBe(SOURCES_PER_DAY);
    // The 101st new campaign falls back to its site: google.com, made on another day, is still found.
    const known = await fresh.arrive({ deviceId: d, accountId: null, utm: { campaign: 'junk-new' }, referrer: 'https://www.google.com/', now: day });
    expect(known.kind).toBe('SITE');
    expect((await sourceRow(known.sourceId)).site).toBe('google.com');
    // A new site past the cap: Direct.
    expect((await fresh.arrive({ deviceId: d, accountId: null, utm: { campaign: 'junk-new-2' }, referrer: 'https://new-site.example/', now: day })).kind).toBe('DIRECT');
    expect(await t.db.selectFrom('acquisition_sources').select('id').where('key', '=', 'S:new-site.example').execute()).toEqual([]);
    // A campaign already known is still found past the cap.
    expect((await fresh.arrive({ deviceId: d, accountId: null, utm: { campaign: 'junk-3' }, now: day })).kind).toBe('CAMPAIGN');
    // The next Paris day (22:00 UTC is midnight in Paris), new sources are made again.
    expect((await fresh.arrive({ deviceId: d, accountId: null, referrer: 'https://new-site.example/', now: new Date('2026-10-20T22:30:00.000Z') })).kind).toBe('SITE');
  });

  it('through TrackingService.ingest: recorded after the exclusions; a console session or a robot records nothing; a failing arrival leaves the views', async () => {
    const lines: { level: string; msg: string }[] = [];
    const log = { info: () => undefined, warn: () => undefined, error: (_o: unknown, msg?: string) => void lines.push({ level: 'error', msg: msg ?? '' }) };
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const trackingWith = (arrive: (input: Parameters<AcquisitionService['arrive']>[0]) => Promise<unknown>) =>
      new TrackingService({ db: t.db, places: new PlaceService({ db: t.db }), clock: () => NOW, log, houseAccounts: { isHouseEmail: async () => false }, testEntrants: { has: async () => false }, arrive });
    const tracking = trackingWith((input) => service.arrive(input));
    const meta = (hash: string, extra: Partial<SeenMeta> = {}): SeenMeta => ({ deviceHash: hash, account: null, staff: false, ip: '198.51.100.7', userAgent: IPHONE, headers: {}, place: null, now: NOW, ...extra });
    const batch = (a: SeenBatch['a'], e: SeenBatch['e'] = []): SeenBatch => ({ v: 1, d: { s: false, t: 5, w: 390 }, ...(a ? { a } : {}), e });
    const hashOf = (c: string) => c.repeat(43);
    const deviceOf = (hash: string) => t.db.selectFrom('tracking_devices').selectAll().where('device_hash', '=', hash).executeTakeFirst();

    // An arrival alone (no view finished yet): the device, its first source, the visit.
    expect(await tracking.ingest(batch({ referrer: 'https://www.vogue.fr/' }), meta(hashOf('v')))).toEqual({ recorded: 0, arrived: true });
    const vogue = (await deviceOf(hashOf('v')))!;
    expect(await touchesOf(vogue.id)).toHaveLength(1);
    expect((await sourceRow(vogue.first_source_id!)).site).toBe('vogue.fr');
    // With views: both.
    expect(await tracking.ingest(batch({ link: 'instagram-bio' }, [{ p: 'NOW', ms: 3_000, ago: 0 }]), meta(hashOf('w')))).toEqual({ recorded: 1, arrived: true });
    // A console session: nothing, and the device is staff's.
    expect(await tracking.ingest(batch({ link: 'instagram-bio' }), meta(hashOf('s'), { staff: true }))).toEqual({ recorded: 0, dropped: 'STAFF' });
    const staff = await deviceOf(hashOf('s'));
    expect(staff?.staff_at).toEqual(expect.any(Date));
    expect(staff?.first_source_id ?? null).toBeNull();
    // A robot, a test network: nothing at all.
    expect(await tracking.ingest(batch({ link: 'instagram-bio' }), meta(hashOf('r'), { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36' }))).toEqual({ recorded: 0, dropped: 'AUTOMATED' });
    expect(await tracking.ingest(batch({ link: 'instagram-bio' }), meta(hashOf('n'), { ip: '100.64.1.2' }))).toEqual({ recorded: 0, dropped: 'TEST_NETWORK' });
    expect(await deviceOf(hashOf('r'))).toBeUndefined();
    expect(await deviceOf(hashOf('n'))).toBeUndefined();
    // A failing arrival is logged; the views go on.
    const failing = trackingWith(async () => {
      throw new Error('down');
    });
    expect(await failing.ingest(batch({ link: 'instagram-bio' }, [{ p: 'CLUB', ms: 2_000, ago: 0 }]), meta(hashOf('f')))).toEqual({ recorded: 1, arrived: false });
    expect(failing.buffer.size).toBe(1);
    expect(lines).toEqual([{ level: 'error', msg: 'arrival not recorded' }]);
    await failing.buffer.flush();
    await tracking.buffer.flush();
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
