/**
 * The recording's reads (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.4, T.8.6 and T.14 « tracking-reads.test.ts »,
 * step 3.9; services/tracking-reads.ts through TrackingService; the plan's test/server/ folder is test/services/ here):
 *
 *  - the client sheet's every line: last seen, active days, views and the summary older than 13 months, « Before the
 *    account » in its four forms, scans, pages, the most viewed models and releases with the summary added, devices
 *    (never one marked staff), places; an AUDITOR without cities;
 *  - the Collectors page's figures from the daily totals with no filter and from the detail with a collectors' filter
 *    (the console's tier filter stands for it), the 13-month note, the previous period; devices by every device, by
 *    collectors and by visits; places by the usual place;
 *  - the click-through lists, a page at a time, by time or by email, the city only for a reader who sees cities;
 *  - activity per account; the four BROWSING criteria of Segments, `not` included, and their bounds;
 *  - the export's tracking columns; test entrants, the team's own and DELETED accounts left out of every figure, list
 *    and column.
 * The right-of-access `browsing` is in test/api/owners.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VIEW_PAGE_CODES, type DeviceBrowser, type DeviceKind, type DeviceSystem, type InApp, type OpenedIn } from '../../src/server/db/schema.js';
import { aggregateViews } from '../../src/server/services/tracking-jobs.js';
import { browsingCondition, checkWindow, deviceWords, pageShares, previousWindow, TRACKING_EXPORT_COLUMNS, type BrowsingRule } from '../../src/server/services/tracking-reads.js';
import { createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

const NOW = '2026-10-09T10:00:00.000Z';

describe('the recording\'s reads (plan CUSTOMER INTELLIGENCE §3.3 T.8.6)', () => {
  let h: Harness;
  let w: GrowthWorld;
  const acc: Record<string, string> = {};
  const dev: Record<string, number> = {};
  const place: Record<string, number> = {};
  let main: string;
  let blue: string;
  let solo: string;
  let drop: string;
  const db = () => h.t.db;
  const tracking = () => h.ctx.services.tracking;

  async function device(o: { kind?: DeviceKind; os?: DeviceSystem; browser?: DeviceBrowser; openedIn?: OpenedIn; app?: InApp | null; first: string; last?: string; account?: string; staff?: boolean }): Promise<number> {
    return (
      await db()
        .insertInto('tracking_devices')
        .values({
          device_hash: randomBytes(32).toString('base64url').slice(0, 43),
          kind: o.kind ?? 'PHONE',
          os: o.os ?? 'IOS',
          browser: o.browser ?? 'SAFARI',
          opened_in: o.openedIn ?? 'BROWSER',
          in_app: o.app ?? null,
          account_id: o.account ?? null,
          linked_at: o.account ? new Date(o.first) : null,
          staff_at: o.staff ? new Date(o.first) : null,
          first_seen_at: new Date(o.first),
          last_seen_at: new Date(o.last ?? o.first),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  }
  /** An account created at that instant (GrowthWorld's are created at noon UTC of a day). */
  async function account(created: string, country: string, status: 'ACTIVE' | 'DELETED' = 'ACTIVE'): Promise<string> {
    const id = await w.account(created.slice(0, 10), country, status);
    await db().updateTable('accounts').set({ created_at: new Date(created) }).where('id', '=', id).execute();
    return id;
  }
  async function link(deviceId: number, account: string, via: 'SIGN_UP' | 'SIGN_IN' | 'SESSION', first: string, last = first) {
    await db().insertInto('tracking_device_accounts').values({ device_id: deviceId, account_id: account, first_via: via, first_linked_at: new Date(first), last_linked_at: new Date(last) }).execute();
  }
  async function view(deviceId: number, at: string, o: { account?: string | null; page?: keyof typeof VIEW_PAGE_CODES; subject?: string | null; seconds?: number; place?: number | null } = {}) {
    const page = o.page ?? 'NOW';
    await db()
      .insertInto('collector_views')
      .values({ at: new Date(at), device_id: deviceId, account_id: o.account ?? null, page: VIEW_PAGE_CODES[page], subject: o.subject ?? null, seconds: o.seconds ?? (page === 'SCAN' ? 0 : 10), place_id: o.place ?? null })
      .execute();
  }

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    w = await new GrowthWorld(db()).prepare();
    await db().updateTable('tracking_state').set({ started_at: new Date('2026-09-01T00:00:00Z'), scans_backfilled_at: new Date('2026-09-01T00:00:00Z') }).where('id', '=', 1).execute();
    main = await w.model('MONOLITHE', { label: 'Steel', swatch: '#8A8D91' });
    blue = await w.model('MONOLITHE', { variantOf: main, label: 'Blue', swatch: '#1F3A93' });
    solo = await w.model('ORBITE');
    drop = (await w.drop({ mode: 'LIVE', modelId: main, title: 'MONOLITHE NOIR', opens: '2026-10-08', quantity: 10 })).id;
    acc.a = await account('2026-09-20T10:00:00Z', 'FR');
    acc.b = await account('2026-10-01T12:00:00Z', 'IT');
    acc.c = await account('2026-10-02T09:00:00Z', 'FR');
    acc.d = await account('2026-08-01T09:00:00Z', 'FR');
    acc.entrant = await account('2026-09-01T09:00:00Z', 'FR');
    acc.team = await account('2026-09-01T09:00:00Z', 'FR');
    acc.deleted = await account('2026-09-01T09:00:00Z', 'FR', 'DELETED');
    await db().insertInto('test_entrants').values({ account_id: acc.entrant }).execute();
    const team = await db().selectFrom('accounts').select('email_normalized').where('id', '=', acc.team).executeTakeFirstOrThrow();
    await db().insertInto('admin_users').values({ email: team.email_normalized, email_normalized: team.email_normalized, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();
    place.paris = (await h.ctx.services.places.idOf('FR', 'Paris'))!;
    place.lyon = (await h.ctx.services.places.idOf('FR', 'Lyon'))!;
    place.milan = (await h.ctx.services.places.idOf('IT', 'Milan'))!;

    // A: browsed two days before signing up (11 and 15 September), then signed up on its iPhone, later an Instagram browser.
    dev.aPhone = await device({ first: '2026-09-11T08:00:00Z', last: '2026-10-08T19:00:00Z', account: acc.a });
    await link(dev.aPhone, acc.a, 'SIGN_UP', '2026-09-20T10:00:00Z');
    dev.aInsta = await device({ browser: 'WEBVIEW', openedIn: 'IN_APP', app: 'INSTAGRAM', first: '2026-10-09T08:50:00Z', account: acc.a });
    await link(dev.aInsta, acc.a, 'SIGN_IN', '2026-10-09T08:55:00Z');
    // A device of A's that opened the console: never listed.
    dev.aStaff = await device({ kind: 'COMPUTER', os: 'MACOS', browser: 'CHROME', first: '2026-10-01T08:00:00Z', staff: true });
    await link(dev.aStaff, acc.a, 'SIGN_IN', '2026-10-01T08:00:00Z');
    await view(dev.aPhone, '2026-09-11T08:00:00Z', { account: acc.a, page: 'NOW', seconds: 30, place: place.paris });
    await view(dev.aPhone, '2026-09-11T08:05:00Z', { account: acc.a, page: 'MODEL', subject: main, seconds: 60, place: place.paris });
    await view(dev.aPhone, '2026-09-15T08:00:00Z', { account: acc.a, page: 'SCAN', subject: main, place: place.paris });
    await view(dev.aPhone, '2026-10-08T08:00:00Z', { account: acc.a, page: 'MODEL', subject: blue, seconds: 100, place: place.lyon });
    await view(dev.aPhone, '2026-10-08T18:10:00Z', { account: acc.a, page: 'RELEASE', subject: drop, seconds: 40, place: place.lyon });
    await view(dev.aPhone, '2026-10-08T19:00:00Z', { account: acc.a, page: 'LIVE', subject: drop, seconds: 300, place: place.lyon });
    await view(dev.aInsta, '2026-10-09T09:00:00Z', { account: acc.a, page: 'NOW', seconds: 10, place: place.paris });
    // A's summary of what passed 13 months.
    await db()
      .insertInto('collector_view_totals')
      .values([
        { account_id: acc.a, page: VIEW_PAGE_CODES.MODEL, subject: solo, views: 3, seconds: 900, first_at: new Date('2025-01-01T10:00:00Z'), last_at: new Date('2025-03-01T10:00:00Z') },
        { account_id: acc.a, page: VIEW_PAGE_CODES.SCAN, subject: solo, views: 1, seconds: 0, first_at: new Date('2025-02-01T10:00:00Z'), last_at: new Date('2025-02-01T10:00:00Z') },
      ])
      .execute();
    // B: two views 20 and 5 minutes before signing up: one visit.
    dev.b = await device({ kind: 'COMPUTER', os: 'WINDOWS', browser: 'EDGE', first: '2026-10-01T11:40:00Z', last: '2026-10-05T10:00:00Z', account: acc.b });
    await link(dev.b, acc.b, 'SIGN_UP', '2026-10-01T12:00:00Z');
    await view(dev.b, '2026-10-01T11:40:00Z', { account: acc.b, page: 'COLLECTION', seconds: 20, place: place.milan });
    await view(dev.b, '2026-10-01T11:55:00Z', { account: acc.b, page: 'MODEL', subject: solo, seconds: 30, place: place.milan });
    await view(dev.b, '2026-10-05T10:00:00Z', { account: acc.b, page: 'MODEL', subject: main, seconds: 50, place: place.milan });
    // C: nothing before its account. D: older than the recording.
    dev.c = await device({ first: '2026-10-03T10:00:00Z', account: acc.c });
    await link(dev.c, acc.c, 'SIGN_IN', '2026-10-03T10:00:00Z');
    await view(dev.c, '2026-10-03T10:00:00Z', { account: acc.c, page: 'MODEL', subject: blue, seconds: 20, place: place.paris });
    dev.d = await device({ first: '2026-10-04T10:00:00Z', account: acc.d });
    await link(dev.d, acc.d, 'SESSION', '2026-10-04T10:00:00Z');
    await view(dev.d, '2026-10-04T10:00:00Z', { account: acc.d, page: 'NOW', seconds: 15 });
    // Never counted: a test entrant's, a team account's and a DELETED account's rows (the last stays in the anonymous
    // totals counted before its deletion, never in a collector's figure).
    dev.x = await device({ first: '2026-10-05T09:00:00Z' });
    await view(dev.x, '2026-10-05T09:00:00Z', { account: acc.entrant, page: 'MODEL', subject: main, seconds: 70, place: place.paris });
    await view(dev.x, '2026-10-05T09:05:00Z', { account: acc.team, page: 'MODEL', subject: main, seconds: 70, place: place.paris });
    await view(dev.x, '2026-10-05T09:10:00Z', { account: acc.deleted, page: 'MODEL', subject: main, seconds: 70, place: place.paris });
    // An anonymous visitor on 6 October.
    dev.anon = await device({ kind: 'TABLET', first: '2026-10-06T09:00:00Z' });
    await view(dev.anon, '2026-10-06T09:00:00Z', { page: 'MODEL', subject: main, seconds: 25, place: place.paris });
    await view(dev.anon, '2026-10-06T09:40:00Z', { page: 'NOW', seconds: 5, place: place.paris });

    // The daily totals and the collectors' places, as the morning's jobs write them.
    // From 1 September (the recording's start) to 8 October: two passes of at most 31 days.
    expect((await aggregateViews(db(), new Date(NOW))).days).toBe(31);
    expect((await aggregateViews(db(), new Date(NOW))).days).toBe(7);
    // The places the jobs counted for the deleted and the team accounts would not be read anyway; the test entrant has none.
  });
  afterAll(() => h?.close());

  describe('the client sheet (T.4.1)', () => {
    it('reads every line for a collector who browsed before signing up', async () => {
      const b = await tracking().collectorBrowsing(acc.a!, { withCities: true });
      expect(b.recordingSince).toEqual(new Date('2026-09-01T00:00:00Z'));
      expect(b.keptFrom).toBe('2025-09-09');
      expect(b.lastSeen).toEqual({ at: new Date('2026-10-09T09:00:00Z'), device: { kind: 'PHONE', system: 'IOS', browser: 'WEBVIEW', openedIn: 'IN_APP', app: 'INSTAGRAM' }, place: { country: 'FR', city: 'Paris' } });
      // Paris days 11 and 15 September, 8 and 9 October: the last 30 days begin on 10 September.
      expect(b.activeDays).toEqual({ last30: 4, last90: 4 });
      expect(b.views).toEqual({ count: 6, seconds: 540 });
      expect(b.older).toEqual({ before: '2025-09-09', views: 3, seconds: 900 });
      expect(b.beforeAccount).toEqual({ kind: 'BROWSED', days: 2, from: new Date('2026-09-11T08:00:00Z'), views: 2, scans: 1 });
      expect(b.scans).toEqual({ count: 2, beforeAccount: 1, firstAt: new Date('2025-02-01T10:00:00Z') });
      expect(b.pages).toEqual([
        { page: 'LIVE', seconds: 300, share: 56 },
        { page: 'MODEL', seconds: 160, share: 30 },
        { page: 'NOW', seconds: 40, share: 7 },
        { page: 'RELEASE', seconds: 40, share: 7 },
      ]);
      // The summary's ORBITE adds to the 13 months' models; the most time first.
      expect(b.models.map((m) => [m.name, m.variant, m.views, m.seconds])).toEqual([
        ['ORBITE', null, 3, 900],
        ['MONOLITHE', 'Blue', 1, 100],
        ['MONOLITHE', 'Steel', 1, 60],
      ]);
      expect(b.modelsViewed).toBe(3);
      expect(b.releases).toEqual([{ dropId: drop, title: 'MONOLITHE NOIR', live: true, views: 2, seconds: 340, liveSeconds: 300, lastAt: new Date('2026-10-08T19:00:00Z') }]);
      // The device that opened the console is never listed; the latest first.
      expect(b.devices.map((d) => [deviceWords(d, ' · '), d.openedIn, d.app, d.firstVia])).toEqual([
        ['iPhone', 'IN_APP', 'INSTAGRAM', 'SIGN_IN'],
        ['iPhone · Safari', 'BROWSER', null, 'SIGN_UP'],
      ]);
      expect(b.devices[1]!.lastSeenAt).toEqual(new Date('2026-10-08T19:00:00Z'));
      // The days counted so far (9 October is not): Paris on 11 and 15 September, Lyon on 8 October.
      expect(b.places).toEqual([
        { country: 'FR', city: 'Paris', days: 2, lastDay: '2026-09-15' },
        { country: 'FR', city: 'Lyon', days: 1, lastDay: '2026-10-08' },
      ]);
      expect(b.citiesWithheld).toBe(false);
    });

    it('withholds every city from an AUDITOR: the last place and Places read the country only', async () => {
      const b = await tracking().collectorBrowsing(acc.a!, { withCities: false });
      expect(b.lastSeen!.place).toEqual({ country: 'FR', city: null });
      expect(b.places).toEqual([{ country: 'FR', city: null, days: 3, lastDay: '2026-10-08' }]);
      expect(b.citiesWithheld).toBe(true);
      expect(JSON.stringify(b)).not.toMatch(/Paris|Lyon/);
    });

    it('reads « Before the account » in its four forms', async () => {
      expect((await tracking().collectorBrowsing(acc.b!, { withCities: true })).beforeAccount).toEqual({ kind: 'FIRST_VISIT' });
      expect((await tracking().collectorBrowsing(acc.c!, { withCities: true })).beforeAccount).toEqual({ kind: 'NOTHING' });
      expect((await tracking().collectorBrowsing(acc.d!, { withCities: true })).beforeAccount).toEqual({ kind: 'OLDER', startedAt: new Date('2026-09-01T00:00:00Z') });
    });

    it('gives every model viewed for « Show all » (plan §3.6 C.11), the most time first, in its one answer: the sheet pages it 50 at a time', async () => {
      expect((await tracking().collectorBrowsing(acc.a!, { withCities: true })).models.map((m) => [m.name, m.variant, m.seconds])).toEqual([
        ['ORBITE', null, 900],
        ['MONOLITHE', 'Blue', 100],
        ['MONOLITHE', 'Steel', 60],
      ]);
      // A collector with 60 models viewed (models since withdrawn: no name), all of them, more than five and than a page.
      const many = await account('2026-09-02T09:00:00Z', 'FR');
      const subjects = Array.from({ length: 60 }, () => randomUUID());
      await db()
        .insertInto('collector_view_totals')
        .values(subjects.map((subject, i) => ({ account_id: many, page: VIEW_PAGE_CODES.MODEL, subject, views: 1, seconds: 1_000 - i, first_at: new Date('2025-01-01T10:00:00Z'), last_at: new Date('2025-01-01T10:00:00Z') })))
        .execute();
      try {
        const b = await tracking().collectorBrowsing(many, { withCities: true });
        expect(b.modelsViewed).toBe(60);
        expect(b.models.map((m) => m.modelId)).toEqual(subjects);
        expect(b.models.every((m) => m.name === null)).toBe(true);
      } finally {
        await db().deleteFrom('collector_view_totals').where('account_id', '=', many).execute();
      }
    });

    it('reads nothing for an account with nothing recorded, and 404 for an unknown one', async () => {
      const none = await account('2026-10-01T09:00:00Z', 'FR');
      const b = await tracking().collectorBrowsing(none, { withCities: true });
      expect(b).toMatchObject({ lastSeen: null, activeDays: { last30: 0, last90: 0 }, views: { count: 0, seconds: 0 }, older: null, beforeAccount: { kind: 'NOTHING' }, pages: [], models: [], releases: [], devices: [], places: [] });
      await expect(tracking().collectorBrowsing('5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6', { withCities: true })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      await expect(tracking().collectorBrowsing('nope', { withCities: true })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    });
  });

  describe('the Collectors page (T.4.2)', () => {
    const counted = (ids: string[]) => (column: string) => sql`${sql.ref(column)} IN (${sql.join(ids)})`;

    it('reads the daily totals with no filter: every visitor, anonymous included, the team and the test entrant never', async () => {
      const r = await tracking().viewsReport({ from: '2026-10-05', to: '2026-10-08' });
      expect(r.source).toBe('DAILY');
      expect(r.through).toBe('2026-10-08');
      expect(r.reachesBackTo).toBeNull();
      // 5 Oct: B 50 + the deleted account's 70 (counted before its deletion); 6 Oct: the visitor 25 + 5; 8 Oct: A 100 + 40 + 300.
      expect(r.current).toMatchObject({ views: 7, seconds: 590, scans: 0, collectors: null });
      expect(r.current.byDay).toEqual([
        { day: '2026-10-05', views: 2 },
        { day: '2026-10-06', views: 2 },
        { day: '2026-10-07', views: 0 },
        { day: '2026-10-08', views: 3 },
      ]);
      expect(r.current.models.map((m) => [m.modelId === blue ? 'blue' : 'main', m.mainModelId === main, m.views, m.seconds, m.collectors])).toEqual([
        ['main', true, 3, 145, null],
        ['blue', true, 1, 100, null],
      ]);
      expect(r.current.releases).toEqual([expect.objectContaining({ dropId: drop, title: 'MONOLITHE NOIR', views: 2, seconds: 340, liveSeconds: 300 })]);
      expect(r.current.pages[0]).toEqual({ page: 'LIVE', views: 1, seconds: 300, share: 51 });
      // Devices a day: B and the deleted account's device on the 5th, the visitor on the 6th, A's phone on the 8th.
      expect(r.current.devices).toBe(4);
      expect(r.previous).toBeNull();
      // The connection's country only.
      const it = await tracking().viewsReport({ from: '2026-10-05', to: '2026-10-08' }, { countries: ['IT'] });
      expect(it.current).toMatchObject({ views: 1, seconds: 50 });
    });

    it('reads the detail with a collectors\' filter: counted collectors only, distinct collectors, and the previous period', async () => {
      const r = await tracking().viewsReport({ from: '2026-10-05', to: '2026-10-08' }, { accounts: counted([acc.a!, acc.b!, acc.entrant!, acc.team!, acc.deleted!]) }, { compare: true });
      expect(r.source).toBe('DETAIL');
      expect(r.reachesBackTo).toBeNull();
      expect(r.current).toMatchObject({ views: 4, seconds: 490, collectors: 2, devices: 2 });
      expect(r.current.models.map((m) => [m.modelId === blue ? 'blue' : 'main', m.views, m.collectors])).toEqual([
        ['blue', 1, 1],
        ['main', 1, 1],
      ]);
      expect(r.previous!.window).toEqual({ from: '2026-10-01', to: '2026-10-04' });
      expect(r.previous).toMatchObject({ views: 2, seconds: 50, collectors: 1 });
    });

    it('counts a period reaching past 13 months from the first day kept, and says so', async () => {
      const r = await tracking().viewsReport({ from: '2025-06-01', to: '2026-10-08' }, { accounts: counted([acc.a!]) });
      expect(r.reachesBackTo).toBe('2025-09-09');
      expect(r.current.window).toEqual({ from: '2025-09-09', to: '2026-10-08' });
      expect(r.current.views).toBe(5);
      const old = await tracking().viewsReport({ from: '2025-01-01', to: '2025-03-01' }, { accounts: counted([acc.a!]) });
      expect(old.current).toMatchObject({ views: 0, collectors: 0 });
      // The daily totals are kept for good: no note.
      expect((await tracking().viewsReport({ from: '2025-06-01', to: '2026-10-08' })).reachesBackTo).toBeNull();
    });

    it('checks the period', async () => {
      await expect(tracking().viewsReport({ from: '2026-10-08', to: '2026-10-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(tracking().viewsReport({ from: '2026-02-30', to: '2026-03-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(checkWindow({ from: '2026-10-25', to: '2026-10-25' })).toEqual({ from: '2026-10-25', to: '2026-10-25' });
      expect(previousWindow({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-01-29', to: '2026-02-28' });
    });

    it('reads the devices by every device, by collectors and by visits', async () => {
      const all = await tracking().devicesReport({ from: '2026-10-05', to: '2026-10-09' });
      expect(all.source).toBe('DAILY');
      // The 9th is not counted yet.
      expect(all.current.kinds).toMatchObject({ PHONE: 2, TABLET: 1, COMPUTER: 1 });
      expect(all.current.systems).toMatchObject({ IOS: 2, IPAD: 1, WINDOWS: 1 });
      const byCollectors = await tracking().devicesReport({ from: '2026-10-01', to: '2026-10-09' }, undefined, { by: 'COLLECTORS' });
      expect(byCollectors.source).toBe('DETAIL');
      // A's main device is its iPhone (440 s against 10), B a Windows computer, C and D iPhones.
      expect(byCollectors.current).toMatchObject({ total: 4, kinds: { PHONE: 3, COMPUTER: 1 }, openedIn: { BROWSER: 4, IN_APP: 0 } });
      const byVisits = await tracking().devicesReport({ from: '2026-10-01', to: '2026-10-09' }, { accounts: counted([acc.a!, acc.b!]) }, { by: 'VISITS' });
      // A: 8 Oct 08:00, 18:10 and 19:00 (three visits) and Instagram on the 9th; B: 1 Oct (one visit, 15 min apart) and 5 Oct.
      expect(byVisits.current).toMatchObject({ total: 6, apps: { INSTAGRAM: 1 }, openedIn: { BROWSER: 5, IN_APP: 1 } });
    });

    it('reads the places by each collector\'s usual place, with those without one', async () => {
      const r = await tracking().placesReport();
      // A: Paris (3 days), B: Milan, C: Paris; D has no place (its row had none); the excluded accounts never.
      expect(r.countries).toEqual([
        { country: 'FR', collectors: 2 },
        { country: 'IT', collectors: 1 },
      ]);
      expect(r.cities.map((c) => [c.city, c.collectors])).toEqual([
        ['Paris', 2],
        ['Milan', 1],
      ]);
      expect(r.unknown).toBeGreaterThanOrEqual(1);
      expect((await tracking().placesReport({ countries: ['IT'] })).countries).toEqual([{ country: 'IT', collectors: 1 }]);
    });

    it('opens the collectors behind a figure, a page at a time, the most time first or by email; cities only in clear', async () => {
      const win = { from: '2026-10-01', to: '2026-10-09' };
      const byTime = await tracking().collectorsFor({ kind: 'MODEL', id: main }, win, undefined, { withCities: true });
      // MONOLITHE with its variant: A (Blue 100 s), C (Blue 20 s), B (50 s); never the test entrant, the team or the deleted.
      expect(byTime.rows.map((r) => [r.accountId, r.seconds])).toEqual([
        [acc.a, 100],
        [acc.b, 50],
        [acc.c, 20],
      ]);
      expect(byTime.total).toBe(3);
      expect(byTime.rows[0]!.city).toBe('Paris');
      const variantOnly = await tracking().collectorsFor({ kind: 'MODEL', id: blue }, win, undefined, { withCities: false, order: 'EMAIL', pageSize: 1, page: 2 });
      expect(variantOnly.total).toBe(2);
      expect(variantOnly.rows).toHaveLength(1);
      expect(variantOnly.rows[0]!.city).toBeNull();
      const emails = (await db().selectFrom('accounts').select(['id', 'email_normalized']).where('id', 'in', [acc.a!, acc.c!]).execute()).sort((x, y) => x.email_normalized.localeCompare(y.email_normalized));
      expect(variantOnly.rows[0]!.accountId).toBe(emails[1]!.id);
      expect((await tracking().collectorsFor({ kind: 'RELEASE', id: drop }, win, undefined, { withCities: true })).rows.map((r) => r.accountId)).toEqual([acc.a]);
      expect((await tracking().collectorsFor({ kind: 'APP', id: 'INSTAGRAM' }, win, undefined, { withCities: true })).total).toBe(0);
      expect((await tracking().collectorsFor({ kind: 'DEVICE', id: 'COMPUTER' }, win, undefined, { withCities: true })).rows.map((r) => r.accountId)).toEqual([acc.b]);
      expect((await tracking().collectorsFor({ kind: 'SYSTEM', id: 'WINDOWS' }, win, undefined, { withCities: true })).total).toBe(1);
      expect((await tracking().collectorsFor({ kind: 'CITY', id: place.paris! }, win, undefined, { withCities: true })).total).toBe(2);
      expect((await tracking().collectorsFor({ kind: 'COUNTRY', id: 'IT' }, win, undefined, { withCities: true })).rows.map((r) => r.accountId)).toEqual([acc.b]);
      expect((await tracking().collectorsFor({ kind: 'PAGE', id: 'LIVE' }, win, undefined, { withCities: true })).rows.map((r) => [r.accountId, r.seconds])).toEqual([[acc.a, 300]]);
    });
  });

  it('reads each account\'s activity: views, seconds, active Paris days and visits', async () => {
    const r = await tracking().activityOf([acc.a!, acc.b!, acc.c!, 'nope'], { from: '2026-10-01', to: '2026-10-09' });
    expect(r.byAccount.get(acc.a!)).toEqual({ views: 4, seconds: 450, activeDays: 2, visits: 4 });
    expect(r.byAccount.get(acc.b!)).toEqual({ views: 3, seconds: 100, activeDays: 2, visits: 2 });
    expect(r.byAccount.get(acc.c!)).toEqual({ views: 1, seconds: 20, activeDays: 1, visits: 1 });
    expect(r.reachesBackTo).toBeNull();
  });

  describe('Segments\' BROWSING criteria (T.4.3)', () => {
    const members = async (rule: BrowsingRule, not = false) =>
      (
        await db()
          .selectFrom('accounts as a')
          .select('a.id')
          .where('a.id', 'in', [acc.a!, acc.b!, acc.c!, acc.d!])
          .where((eb) => {
            const c = browsingCondition(rule, eb.ref('a.id'), new Date(NOW));
            return not ? sql<boolean>`NOT (${c})` : c;
          })
          .execute()
      )
        .map((r) => r.id)
        .sort();
    const sorted = (...ids: string[]) => [...ids].sort();

    it('VIEWED_MODEL: a main model with its variants, a variant only itself, at least `min` times in the last `days`', async () => {
      expect(await members({ kind: 'VIEWED_MODEL', modelIds: [main], min: 1, days: 30 })).toEqual(sorted(acc.a!, acc.b!, acc.c!));
      expect(await members({ kind: 'VIEWED_MODEL', modelIds: [blue], min: 1, days: 30 })).toEqual(sorted(acc.a!, acc.c!));
      expect(await members({ kind: 'VIEWED_MODEL', modelIds: [main], min: 2, days: 395 })).toEqual([acc.a!]);
      expect(await members({ kind: 'VIEWED_MODEL', modelIds: [main], min: 1, days: 2 })).toEqual([acc.a!]);
      expect(await members({ kind: 'VIEWED_MODEL', modelIds: [main], min: 1, days: 30 }, true)).toEqual([acc.d!]);
    });

    it('VIEWED_RELEASE, DEVICE and PLACE', async () => {
      expect(await members({ kind: 'VIEWED_RELEASE', dropId: drop, min: 2 })).toEqual([acc.a!]);
      expect(await members({ kind: 'VIEWED_RELEASE', dropId: drop, min: 3 })).toEqual([]);
      expect(await members({ kind: 'DEVICE', kinds: ['PHONE'], openedIn: ['IN_APP'], apps: ['INSTAGRAM'], days: 90 })).toEqual([acc.a!]);
      expect(await members({ kind: 'DEVICE', systems: ['WINDOWS'], days: 90 })).toEqual([acc.b!]);
      // The device that opened the console is never A's.
      expect(await members({ kind: 'DEVICE', kinds: ['COMPUTER'], systems: ['MACOS'], days: 90 })).toEqual([]);
      expect(await members({ kind: 'DEVICE', kinds: ['PHONE'], days: 90 }, true)).toEqual([acc.b!]);
      expect(await members({ kind: 'PLACE', countries: ['IT'], days: 90 })).toEqual([acc.b!]);
      expect(await members({ kind: 'PLACE', placeIds: [place.lyon!], days: 90 })).toEqual([acc.a!]);
      expect(await members({ kind: 'PLACE', placeIds: [place.paris!], days: 1 })).toEqual([]);
    });

    it('refuses a rule out of its bounds', () => {
      const a = sql<string>`a.id`;
      const now = new Date(NOW);
      expect(() => browsingCondition({ kind: 'VIEWED_MODEL', modelIds: [main], min: 1, days: 396 }, a, now)).toThrow(/from 1 to 395/);
      expect(() => browsingCondition({ kind: 'VIEWED_MODEL', modelIds: [main], min: 101, days: 30 }, a, now)).toThrow(/from 1 to 100/);
      expect(() => browsingCondition({ kind: 'VIEWED_MODEL', modelIds: [], min: 1, days: 30 }, a, now)).toThrow(/at least one model/);
      expect(() => browsingCondition({ kind: 'DEVICE', days: 30 }, a, now)).toThrow(/tick at least one/);
      expect(() => browsingCondition({ kind: 'PLACE', days: 30 }, a, now)).toThrow(/at least one place/);
    });
  });

  it('gives the export\'s tracking columns, counted collectors only', async () => {
    const cols = await tracking().exportColumns([acc.a!, acc.b!, acc.entrant!, acc.team!, acc.deleted!]);
    expect([...cols.keys()].sort()).toEqual([acc.a!, acc.b!].sort());
    const a = cols.get(acc.a!)!;
    expect(Object.keys(a)).toEqual([...TRACKING_EXPORT_COLUMNS]);
    expect(a).toEqual({
      first_visit_at: new Date('2025-01-01T10:00:00Z'),
      days_browsing_before_sign_up: 2,
      views_13_months: 6,
      minutes_13_months: 9,
      active_days_30: 4,
      active_days_90: 4,
      last_seen_at: new Date('2026-10-09T09:00:00Z'),
      top_models: 'ORBITE; MONOLITHE BLUE; MONOLITHE STEEL',
      releases_viewed: 1,
      scans: 2,
      scans_before_account: 1,
      devices: 'iPhone; iPhone Safari',
      main_device: 'Phone iOS',
      opened_in_apps: 'Instagram',
      usual_country: 'FR',
      usual_city: 'Paris',
      other_cities: 'Lyon',
      views_before_13_months: 3,
      minutes_before_13_months: 15,
    });
    expect(cols.get(acc.b!)).toMatchObject({ days_browsing_before_sign_up: 1, devices: 'Computer Windows Edge', main_device: 'Computer Windows', opened_in_apps: '', usual_country: 'IT', other_cities: '' });
  });

  it('shares the pages of the sheet: the four largest, then the rest as Other', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((p, i) => ({ page: p + 1, seconds: 100 - i * 10 }));
    expect(pageShares(rows).map((p) => p.page)).toEqual(['NOW', 'RESULT', 'MY_PIECES', 'MY_ORDERS', 'OTHER']);
    expect(pageShares([])).toEqual([]);
  });
});
