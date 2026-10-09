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
 *  - attach (step 4.4), through TrackingService.link as context.ts wires it: at a sign-up, the device's visits take the
 *    account, its first source is the device's first visit (Console device on a device marked staff's, Direct on a
 *    device that made no arrival), its SIGNUP conversion names the last non-direct visit within 90 days (a Direct
 *    return keeps the link; a link 91 days old gives Direct); lastSourceAt's rule; at a sign-in, the anonymous visits
 *    since take the account and the first source is checked again (an earlier device wins; a later one, one another
 *    account uses or one marked staff's never does; an account made before the recording never gets one); a failing
 *    attach rolls the link back, is logged, and leaves the account.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AcquisitionService, CHANNEL_PRESETS, classify, FIXED_SOURCES, LAST_LINK_DAYS, SOURCES_PER_DAY, TAG_SEPARATOR } from '../../src/server/services/acquisition.js';
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

describe('AcquisitionService.attach (§3.4 A.4, A.5, step 4.4)', () => {
  let t: TestDb;
  let acquisition: AcquisitionService;
  let tracking: TrackingService;
  let admin: string;
  let channel: string;
  let seq = 0;
  const lines: string[] = [];
  const log = { info: () => undefined, warn: () => undefined, error: (_o: unknown, msg?: string) => void lines.push(msg ?? '') };
  const START = new Date('2026-06-01T08:00:00.000Z');
  const day = (n: number) => new Date(START.getTime() + n * 86_400_000);

  beforeAll(async () => {
    t = await createTestDb();
    acquisition = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => START, log });
    await acquisition.prepare();
    // As context.ts wires it: the link runs the attach in its transaction.
    tracking = new TrackingService({
      db: t.db,
      places: new PlaceService({ db: t.db }),
      clock: () => START,
      houseAccounts: { isHouseEmail: async () => false },
      testEntrants: { has: async () => false },
      attach: async (tx, deviceId, accountId, via, now) => void (await acquisition.attach(tx, deviceId, accountId, via, now)),
    });
    admin = (await t.db.insertInto('admin_users').values({ email: 'attach@orbes.test', email_normalized: 'attach@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id;
    channel = (await t.db.selectFrom('link_channels').select('id').where('name', '=', 'Influencers').executeTakeFirstOrThrow()).id;
  });
  afterAll(() => t?.close());

  const hash = () => `${String(++seq).padStart(4, '0')}${'a'.repeat(39)}`;
  const device = async (h: string, firstSeen: Date) =>
    (await t.db.insertInto('tracking_devices').values({ device_hash: h, first_seen_at: firstSeen, last_seen_at: firstSeen }).returning('id').executeTakeFirstOrThrow()).id;
  const account = async (created: Date) => {
    const email = `attach-${++seq}@example.com`;
    return (await t.db.insertInto('accounts').values({ email, email_normalized: email, password_hash: 'scrypt$x', created_at: created }).returning('id').executeTakeFirstOrThrow()).id;
  };
  const link = async (code: string) => {
    const l = await t.db.insertInto('links').values({ code, name: code, channel_id: channel, destination: 'NOW', created_by: admin }).returning('id').executeTakeFirstOrThrow();
    return (await t.db.insertInto('acquisition_sources').values({ kind: 'LINK', link_id: l.id, key: `L:${l.id}` }).returning('id').executeTakeFirstOrThrow()).id;
  };
  const fixed = async (key: string) => (await t.db.selectFrom('acquisition_sources').select('id').where('key', '=', key).executeTakeFirstOrThrow()).id;
  const firstOf = (accountId: string) => t.db.selectFrom('account_sources').select(['first_source_id', 'first_seen_at', 'set_at', 'set_by']).where('account_id', '=', accountId).executeTakeFirst();
  const signupOf = (accountId: string) => t.db.selectFrom('acquisition_conversions').select(['kind', 'ref_id', 'account_id', 'at', 'last_source_id']).where('kind', '=', 'SIGNUP').where('ref_id', '=', accountId).executeTakeFirst();
  const touchAccounts = async (deviceId: number) => (await t.db.selectFrom('acquisition_touches').select('account_id').where('device_id', '=', deviceId).orderBy('id').execute()).map((r) => r.account_id);

  it('at a sign-up: the visits take the account, the first source is the device\'s first visit, the SIGNUP names the last non-direct visit', async () => {
    const bio = await link('attach-bio');
    const story = await link('attach-story');
    const h = hash();
    const d = await device(h, day(1));
    await acquisition.arrive({ deviceId: d, accountId: null, link: 'attach-bio', now: day(1) });
    await acquisition.arrive({ deviceId: d, accountId: null, link: 'attach-story', now: day(5) });
    // A direct return after the link: no visit, so the link stays the last one.
    await acquisition.arrive({ deviceId: d, accountId: null, now: day(6) });
    const a = await account(day(7));
    await tracking.link(h, a, 'SIGN_UP', day(7));
    expect(await touchAccounts(d)).toEqual([a, a]);
    expect(await firstOf(a)).toEqual({ first_source_id: bio, first_seen_at: day(1), set_at: day(7), set_by: 'SIGN_UP' });
    expect(await signupOf(a)).toEqual({ kind: 'SIGNUP', ref_id: a, account_id: a, at: day(7), last_source_id: story });
    expect(await acquisition.lastSourceAt(t.db, a, day(7))).toBe(story);
    // Judged at a moment: before the second link, the first; before any visit, Direct.
    expect(await acquisition.lastSourceAt(t.db, a, day(3))).toBe(bio);
    expect(await acquisition.lastSourceAt(t.db, a, new Date(day(1).getTime() - 1))).toBe(await fixed('DIRECT'));
  });

  it('a link more than 90 days before the sign-up gives Direct as its last link, and stays the first source', async () => {
    const old = await link('attach-old');
    const h = hash();
    const d = await device(h, day(0));
    await acquisition.arrive({ deviceId: d, accountId: null, link: 'attach-old', now: day(0) });
    const late = await account(day(LAST_LINK_DAYS + 1));
    await tracking.link(h, late, 'SIGN_UP', day(LAST_LINK_DAYS + 1));
    expect((await signupOf(late))?.last_source_id).toBe(await fixed('DIRECT'));
    expect((await firstOf(late))?.first_source_id).toBe(old);
    // Exactly 90 days before still counts.
    expect(await acquisition.lastSourceAt(t.db, late, day(LAST_LINK_DAYS))).toBe(old);
  });

  it('a sign-up on a device that made no arrival reads Direct; on a device marked staff\'s, Console device', async () => {
    const plain = hash();
    await device(plain, day(2));
    const a = await account(day(2));
    await tracking.link(plain, a, 'SIGN_UP', day(2));
    expect((await firstOf(a))?.first_source_id).toBe(await fixed('DIRECT'));
    const staffHash = hash();
    await tracking.markStaff(staffHash, day(2));
    const b = await account(day(2));
    await tracking.link(staffHash, b, 'SIGN_UP', day(2));
    expect((await firstOf(b))?.first_source_id).toBe(await fixed('STAFF'));
    expect((await signupOf(b))?.last_source_id).toBe(await fixed('DIRECT'));
  });

  it('at a sign-in: the anonymous visits since take the account; an earlier device becomes the discovery, never a later one, one another account uses or one marked staff\'s', async () => {
    const tiktok = await link('attach-tiktok');
    // The account signs up on its phone on day 20, first seen there on day 18 (Direct).
    const phone = hash();
    const p = await device(phone, day(18));
    await acquisition.arrive({ deviceId: p, accountId: null, now: day(18) });
    const a = await account(day(20));
    await tracking.link(phone, a, 'SIGN_UP', day(20));
    expect((await firstOf(a))?.first_source_id).toBe(await fixed('DIRECT'));
    // Instagram's own browser, first seen on day 10 through the link, signs in on day 25: the earlier discovery wins.
    const inApp = hash();
    const i = await device(inApp, day(10));
    await acquisition.arrive({ deviceId: i, accountId: null, link: 'attach-tiktok', now: day(10) });
    await acquisition.arrive({ deviceId: i, accountId: null, link: 'attach-tiktok', now: day(24) });
    await tracking.link(inApp, a, 'SIGN_IN', day(25));
    expect(await touchAccounts(i)).toEqual([a, a]);
    expect(await firstOf(a)).toEqual({ first_source_id: tiktok, first_seen_at: day(10), set_at: day(25), set_by: 'SIGN_IN' });
    // The SIGNUP conversion is written once and never changed.
    expect((await signupOf(a))?.last_source_id).toBe(await fixed('DIRECT'));
    // A device first seen later never rewrites it.
    const later = hash();
    const l = await device(later, day(12));
    await acquisition.arrive({ deviceId: l, accountId: null, referrer: 'https://www.vogue.fr/', now: day(12) });
    await tracking.link(later, a, 'SIGN_IN', day(26));
    expect((await firstOf(a))?.first_source_id).toBe(tiktok);
    // A family tablet another account already uses, first seen earliest of all: never the discovery.
    const tablet = hash();
    const tb = await device(tablet, day(3));
    await acquisition.arrive({ deviceId: tb, accountId: null, referrer: 'https://www.google.com/', now: day(3) });
    const other = await account(day(4));
    await tracking.link(tablet, other, 'SIGN_UP', day(4));
    await tracking.link(tablet, a, 'SIGN_IN', day(27));
    expect((await firstOf(a))?.first_source_id).toBe(tiktok);
    // A device marked staff's, first seen early: never the discovery either.
    const desk = hash();
    await tracking.markStaff(desk, day(1));
    await tracking.link(desk, a, 'SESSION', day(28));
    expect((await firstOf(a))?.first_source_id).toBe(tiktok);
    // A signed-in visit's link (SESSION) checks it again too.
    const tab = hash();
    const tbb = await device(tab, day(2));
    await acquisition.arrive({ deviceId: tbb, accountId: null, referrer: 'https://www.vogue.fr/', now: day(2) });
    await tracking.link(tab, a, 'SESSION', day(29));
    expect(await firstOf(a)).toMatchObject({ first_seen_at: day(2), set_by: 'SIGN_IN' });
  });

  it('an account made before the recording started reads Before tracking: a sign-in writes it no first source', async () => {
    const before = await account(new Date(START.getTime() - 86_400_000));
    const h = hash();
    // A device known from a scan before the account was made (the past scans' backfill).
    const d = await device(h, new Date(START.getTime() - 2 * 86_400_000));
    await acquisition.arrive({ deviceId: d, accountId: null, referrer: 'https://www.vogue.fr/', now: day(1) });
    await tracking.link(h, before, 'SIGN_IN', day(1));
    expect(await firstOf(before)).toBeUndefined();
    expect(await touchAccounts(d)).toEqual([before]);
  });

  it('a failing attach rolls the link back and is logged; the account stays', async () => {
    const h = hash();
    const d = await device(h, day(30));
    await acquisition.arrive({ deviceId: d, accountId: null, link: 'attach-bio', now: day(30) });
    const a = await account(day(30));
    const original = acquisition.attach.bind(acquisition);
    acquisition.attach = async (tx, ...rest) => {
      await original(tx, ...rest);
      throw new Error('forced');
    };
    try {
      await expect(tracking.link(h, a, 'SIGN_UP', day(30))).rejects.toThrow('forced');
    } finally {
      acquisition.attach = original;
    }
    expect(await firstOf(a)).toBeUndefined();
    expect(await signupOf(a)).toBeUndefined();
    expect(await touchAccounts(d)).toEqual([null]);
    expect((await t.db.selectFrom('tracking_devices').select('account_id').where('id', '=', d).executeTakeFirstOrThrow()).account_id).toBeNull();
    expect(await t.db.selectFrom('accounts').select('id').where('id', '=', a).execute()).toEqual([{ id: a }]);
    // A failure inside the attach itself is logged in its words.
    lines.length = 0;
    const broken = new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, log });
    await expect(t.db.transaction().execute((tx) => broken.attach(tx, d, '00000000-0000-0000-0000-000000000000', 'SIGN_UP', day(30)))).rejects.toThrow();
    expect(lines).toEqual(['acquisition attach failed']);
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
