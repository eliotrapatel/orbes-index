/**
 * The views' daily work (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.10 and T.14 « tracking-jobs.test.ts », step
 * 3.7; services/tracking-jobs.ts and TrackingService.purgeDevices; the plan's test/server/ folder is test/services/ here):
 *
 *  - complete Paris days only, nothing before 07:30 UTC, nothing before the past scans' backfill is done; a day's
 *    totals (pages, subjects, countries, devices, signed-in views), its devices (class, new, signed in) and the
 *    collectors' places; a day without views gets its marker; a repeated pass gives the same figures;
 *  - test entrants and the team's own accounts left out; 25 October 2026, a 25-hour Paris day, counted once;
 *  - `viewMonths` writes a month once, with its last day's count (views, seconds, scans, active Paris days);
 *  - the purge waits for the count and for the month; the 13-month cut-off on calendar months (on 8 Oct 2026 the
 *    first day kept is 8 Sep 2025, Paris and UTC around midnight); the fold equals the sum of the deleted rows;
 *    anonymous rows deleted without a fold; at most its days a pass;
 *  - unlinked old devices purged, linked, staff, recent ones, those with rows and those a visit still names
 *    (`acquisition_touches`, step 4.5) kept;
 *  - housekeeping's order and `result` keys; no purge in a pass where the count failed; the `intelligence sizes` line
 *    once a Paris day.
 * The link's recount cases (the link plus the daily job equal a recount from scratch) are in test/api/tracking-link.test.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousekeeping } from '../../src/server/context.js';
import { VIEW_PAGE_CODES, type DeviceKind } from '../../src/server/db/schema.js';
import { aggregateViews, intelligenceSizes, purgeViews } from '../../src/server/services/tracking-jobs.js';
import { NIL_UUID, viewsCountedThrough } from '../../src/server/services/tracking.js';
import type { Logger } from '../../src/server/types.js';
import { createHarness, type Harness } from '../api/support.js';
import { createAccount } from '../support/live.js';

type Line = { level: string; o: unknown; msg: unknown };

/** One harness, its log lines, and the helpers that write devices and rows as the pipeline does. */
async function setUp(): Promise<{ h: Harness; lines: Line[] }> {
  const lines: Line[] = [];
  const log: Logger = {
    info: (o, msg) => lines.push({ level: 'info', o, msg }),
    warn: (o, msg) => lines.push({ level: 'warn', o, msg }),
    error: (o, msg) => lines.push({ level: 'error', o, msg }),
  };
  return { h: await createHarness({ context: { log } }), lines };
}

function helpers(h: Harness) {
  const db = () => h.t.db;
  return {
    async state(startedAt: string, backfilled: boolean) {
      await db().updateTable('tracking_state').set({ started_at: new Date(startedAt), scans_backfilled_at: backfilled ? new Date(startedAt) : null }).where('id', '=', 1).execute();
    },
    async device(o: { kind?: DeviceKind; firstSeen?: string; lastSeen?: string; account?: string; staff?: boolean } = {}): Promise<number> {
      const first = new Date(o.firstSeen ?? '2026-01-01T00:00:00Z');
      return (
        await db()
          .insertInto('tracking_devices')
          .values({
            device_hash: randomBytes(32).toString('base64url').slice(0, 43),
            kind: o.kind ?? 'PHONE',
            os: 'IOS',
            browser: 'SAFARI',
            account_id: o.account ?? null,
            linked_at: o.account ? first : null,
            staff_at: o.staff ? first : null,
            first_seen_at: first,
            last_seen_at: new Date(o.lastSeen ?? o.firstSeen ?? '2026-01-01T00:00:00Z'),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    },
    async view(device: number, at: string, o: { account?: string | null; page?: keyof typeof VIEW_PAGE_CODES; subject?: string | null; seconds?: number; place?: number | null } = {}) {
      const page = o.page ?? 'NOW';
      await db()
        .insertInto('collector_views')
        .values({ at: new Date(at), device_id: device, account_id: o.account ?? null, page: VIEW_PAGE_CODES[page], subject: o.subject ?? null, seconds: o.seconds ?? (page === 'SCAN' ? 0 : 10), place_id: o.place ?? null })
        .execute();
    },
    place: (country: string, city: string | null) => h.ctx.services.places.idOf(country, city) as Promise<number>,
    async dayStats(day: string) {
      return (
        await db().selectFrom('view_daily_stats').select(['page', 'subject', 'country', 'views', 'seconds', 'devices', 'signed_in_views']).where('day', '=', day).orderBy('page').orderBy('subject').orderBy('country').execute()
      ).map((r) => ({ ...r, subject: r.subject === NIL_UUID ? null : r.subject }));
    },
    async days() {
      return (await db().selectFrom('view_daily_stats').select('day').where('page', '=', 0).orderBy('day').execute()).map((r) => r.day);
    },
    async placesOf(account: string) {
      return db().selectFrom('collector_places').select(['place_id', 'days', 'first_day', 'last_day']).where('account_id', '=', account).orderBy('place_id').execute();
    },
    async rows() {
      return Number((await db().selectFrom('collector_views').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    },
  };
}

describe('viewStats: the complete Paris days (plan CUSTOMER INTELLIGENCE §3.3 T.10)', () => {
  let h: Harness;
  let x: ReturnType<typeof helpers>;
  const ids: Record<string, string> = {};
  let phone: number;
  let laptop: number;
  let paris: number;
  let lyon: number;
  const MODEL = randomUUID();

  beforeAll(async () => {
    ({ h } = await setUp());
    x = helpers(h);
    for (const k of ['a', 'entrant', 'team']) ids[k] = (await createAccount(h.t.db)).id;
    await h.t.db.insertInto('test_entrants').values({ account_id: ids.entrant! }).execute();
    const team = await h.t.db.selectFrom('accounts').select('email_normalized').where('id', '=', ids.team!).executeTakeFirstOrThrow();
    await h.t.db.insertInto('admin_users').values({ email: team.email_normalized, email_normalized: team.email_normalized, password_hash: 'scrypt$x', role: 'OPERATOR' }).execute();
    paris = await x.place('FR', 'Paris');
    lyon = await x.place('FR', 'Lyon');
    phone = await x.device({ kind: 'PHONE', firstSeen: '2026-10-05T07:00:00Z' });
    laptop = await x.device({ kind: 'COMPUTER', firstSeen: '2026-09-01T07:00:00Z', lastSeen: '2026-10-08T07:00:00Z' });
    // 5 October (Paris): the phone, anonymous then signed in; the laptop from Lyon.
    await x.view(phone, '2026-10-05T08:00:00Z', { page: 'MODEL', subject: MODEL, seconds: 20, place: paris });
    await x.view(phone, '2026-10-05T08:01:00Z', { page: 'MODEL', subject: MODEL, seconds: 5, place: paris, account: ids.a! });
    await x.view(phone, '2026-10-05T08:02:00Z', { page: 'SCAN', subject: MODEL, place: paris, account: ids.a! });
    await x.view(laptop, '2026-10-05T09:00:00Z', { page: 'NOW', seconds: 30, place: lyon });
    // 23:30 UTC on 5 October is 6 October in Paris; a row with no place reads ZZ.
    await x.view(phone, '2026-10-05T22:30:00Z', { page: 'NOW', seconds: 7, account: ids.a! });
    // Never counted: a test entrant's row and one of the team's own (they never reach the table, but whatever came before).
    await x.view(laptop, '2026-10-06T10:00:00Z', { page: 'NOW', account: ids.entrant!, place: paris });
    await x.view(laptop, '2026-10-06T10:05:00Z', { page: 'NOW', account: ids.team!, place: paris });
    // 7 October: nothing. 8 October: Lyon for the collector.
    await x.view(phone, '2026-10-08T12:00:00Z', { page: 'CLUB', seconds: 3, place: lyon, account: ids.a! });
    // 9 October, today: not complete.
    await x.view(phone, '2026-10-09T06:00:00Z', { page: 'NOW', seconds: 3, place: paris, account: ids.a! });
  });
  afterAll(() => h?.close());

  it('waits for the morning window and for the past scans, then counts each complete Paris day once, with its marker', async () => {
    await x.state('2026-10-05T07:00:00Z', false);
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      h.clock.set('2026-10-09T07:29:00.000Z');
      expect(await hk.runOnce()).toMatchObject({ viewStats: 0, viewMonths: 0, viewPurge: 0, devicePurge: 0, sizes: 0 });
      h.clock.set('2026-10-09T07:30:00.000Z');
      // The backfill of the past scans is not done: their days could still gain rows.
      expect((await hk.runOnce()).viewStats).toBe(0);
      expect(await x.days()).toEqual([]);
      await x.state('2026-10-05T07:00:00Z', true);
      expect(await hk.runOnce()).toMatchObject({ viewStats: 4, viewMonths: 0 });
      expect((await hk.runOnce()).viewStats).toBe(0);
    } finally {
      await hk.stop();
    }
    expect(await x.days()).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(await viewsCountedThrough(h.t.db)).toBe('2026-10-08');
    const ordered = <T extends { page: number; subject: string | null; country: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.page - b.page || String(a.subject).localeCompare(String(b.subject)) || a.country.localeCompare(b.country));
    expect(await x.dayStats('2026-10-05')).toEqual(
      ordered([
        { page: 0, subject: null, country: 'ZZ', views: 0, seconds: 0, devices: 0, signed_in_views: 0 },
        { page: VIEW_PAGE_CODES.SCAN, subject: MODEL, country: 'FR', views: 1, seconds: 0, devices: 1, signed_in_views: 1 },
        { page: VIEW_PAGE_CODES.NOW, subject: null, country: 'FR', views: 1, seconds: 30, devices: 1, signed_in_views: 0 },
        { page: VIEW_PAGE_CODES.MODEL, subject: MODEL, country: 'FR', views: 2, seconds: 25, devices: 1, signed_in_views: 1 },
      ]),
    );
    // 6 October: the collector's row after midnight Paris, with no place; the test entrant and the team left out.
    expect(await x.dayStats('2026-10-06')).toEqual([
      { page: 0, subject: null, country: 'ZZ', views: 0, seconds: 0, devices: 0, signed_in_views: 0 },
      { page: VIEW_PAGE_CODES.NOW, subject: null, country: 'ZZ', views: 1, seconds: 7, devices: 1, signed_in_views: 1 },
    ]);
    // A day without a view: its marker only.
    expect(await x.dayStats('2026-10-07')).toEqual([{ page: 0, subject: null, country: 'ZZ', views: 0, seconds: 0, devices: 0, signed_in_views: 0 }]);
    expect(await x.dayStats('2026-10-09')).toEqual([]);
    // The devices of 5 October: the phone new that day and signed in, the laptop neither.
    expect(
      await h.t.db.selectFrom('device_daily_stats').select(['country', 'kind', 'in_app', 'devices', 'new_devices', 'signed_in_devices']).where('day', '=', '2026-10-05').orderBy('kind').execute(),
    ).toEqual([
      { country: 'FR', kind: 'COMPUTER', in_app: 'NONE', devices: 1, new_devices: 0, signed_in_devices: 0 },
      { country: 'FR', kind: 'PHONE', in_app: 'NONE', devices: 1, new_devices: 1, signed_in_devices: 1 },
    ]);
    // The team's and the test entrant's rows of 6 October leave no device behind either.
    expect(await h.t.db.selectFrom('device_daily_stats').select(['country', 'kind', 'devices']).where('day', '=', '2026-10-06').execute()).toEqual([{ country: 'ZZ', kind: 'PHONE', devices: 1 }]);
    // The collector's places: Paris on 5 October, Lyon on 8 October; nobody else has any.
    expect(await x.placesOf(ids.a!)).toEqual(
      [
        { place_id: paris, days: 1, first_day: '2026-10-05', last_day: '2026-10-05' },
        { place_id: lyon, days: 1, first_day: '2026-10-08', last_day: '2026-10-08' },
      ].sort((p, q) => p.place_id - q.place_id),
    );
    expect(await h.t.db.selectFrom('collector_places').select('account_id').where('account_id', 'in', [ids.entrant!, ids.team!]).execute()).toEqual([]);
  });

  it('gives the same figures when a pass repeats, and counts a day already counted by another pass only once', async () => {
    const before = await h.t.db.selectFrom('view_daily_stats').selectAll().orderBy('day').orderBy('page').orderBy('subject').orderBy('country').execute();
    const places = await x.placesOf(ids.a!);
    expect(await aggregateViews(h.t.db, new Date('2026-10-09T09:00:00Z'))).toEqual({ days: 0, months: 0 });
    // Another process's pass that read the same newest day before this one wrote it: the marker stops it inside the lock.
    await h.t.db.deleteFrom('view_daily_stats').where('day', '=', '2026-10-08').where('page', '<>', 0).execute();
    expect(await aggregateViews(h.t.db, new Date('2026-10-09T09:00:00Z'))).toEqual({ days: 0, months: 0 });
    await h.t.db.deleteFrom('view_daily_stats').where('day', '=', '2026-10-08').execute();
    expect(await aggregateViews(h.t.db, new Date('2026-10-09T09:00:00Z'))).toEqual({ days: 1, months: 0 });
    expect(await h.t.db.selectFrom('view_daily_stats').selectAll().orderBy('day').orderBy('page').orderBy('subject').orderBy('country').execute()).toEqual(before);
    // Counting 8 October again never adds a second day to Lyon.
    expect(await x.placesOf(ids.a!)).toEqual(places);
  });
});

describe('viewStats around the change to winter time: 25 October 2026, a 25-hour Paris day, counted once', () => {
  let h: Harness;
  let x: ReturnType<typeof helpers>;
  beforeAll(async () => {
    ({ h } = await setUp());
    x = helpers(h);
    await x.state('2026-10-24T08:00:00Z', true);
    const d = await x.device({ firstSeen: '2026-10-24T08:00:00Z' });
    // 22:30 UTC on 24 October is 00:30 on 25 October in Paris (summer time); 22:30 UTC on 25 October is 23:30 the
    // same Paris day (winter time); 23:30 UTC on 25 October is 26 October.
    await x.view(d, '2026-10-24T21:59:00Z', { seconds: 1 });
    await x.view(d, '2026-10-24T22:30:00Z', { seconds: 2 });
    await x.view(d, '2026-10-25T22:30:00Z', { seconds: 3 });
    await x.view(d, '2026-10-25T23:30:00Z', { seconds: 4 });
  });
  afterAll(() => h?.close());

  it('puts each row in its Paris day', async () => {
    expect(await aggregateViews(h.t.db, new Date('2026-10-27T08:30:00Z'))).toEqual({ days: 3, months: 0 });
    const seconds = async (day: string) => (await x.dayStats(day)).filter((r) => r.page !== 0).map((r) => [r.views, r.seconds]);
    expect(await seconds('2026-10-24')).toEqual([[1, 1]]);
    expect(await seconds('2026-10-25')).toEqual([[2, 5]]);
    expect(await seconds('2026-10-26')).toEqual([[1, 4]]);
  });
});

describe('viewMonths, viewPurge and devicePurge (plan CUSTOMER INTELLIGENCE §3.3 T.10)', () => {
  let h: Harness;
  let lines: Line[];
  let x: ReturnType<typeof helpers>;
  let a: string;
  let b: string;
  let d: number;
  const X = randomUUID();
  const NOW = new Date('2026-10-08T08:00:00Z');

  beforeAll(async () => {
    ({ h, lines } = await setUp());
    x = helpers(h);
    a = (await createAccount(h.t.db)).id;
    b = (await createAccount(h.t.db)).id;
    await x.state('2025-09-05T08:00:00Z', true);
    d = await x.device({ firstSeen: '2025-09-05T08:00:00Z', lastSeen: '2026-10-01T08:00:00Z' });
    const paris = await x.place('FR', 'Paris');
    await x.view(d, '2025-09-06T10:00:00Z', { page: 'SCAN', subject: X, account: a, place: paris });
    await x.view(d, '2025-09-07T10:00:00Z', { page: 'MODEL', subject: X, seconds: 20, account: a, place: paris });
    await x.view(d, '2025-09-07T12:00:00Z', { page: 'NOW', seconds: 9 });
    // 21:59:59 UTC on 7 September 2025 is 23:59:59 in Paris: the last instant before the first day kept on 8 October 2026.
    await x.view(d, '2025-09-07T21:59:59Z', { page: 'MODEL', subject: X, seconds: 10, account: a, place: paris });
    // 22:00 UTC is 00:00 on 8 September in Paris: kept.
    await x.view(d, '2025-09-07T22:00:00Z', { page: 'MODEL', subject: X, seconds: 5, account: a, place: paris });
    await x.view(d, '2025-10-02T10:00:00Z', { page: 'CLUB', seconds: 4, account: b });
  });
  afterAll(() => h?.close());

  const totals = async () =>
    (await h.t.db.selectFrom('collector_view_totals').select(['account_id', 'page', 'subject', 'views', 'seconds', 'first_at', 'last_at']).orderBy('page').execute()).map((r) => ({
      ...r,
      subject: r.subject === NIL_UUID ? null : r.subject,
    }));
  const months = async () => h.t.db.selectFrom('collector_view_months').select(['account_id', 'month', 'views', 'seconds', 'scans', 'active_days']).orderBy('month').orderBy('account_id').execute();

  it('purges nothing before the days are counted, nor a day of a month not written yet', async () => {
    expect(await purgeViews(h.t.db, NOW)).toBe(0);
    expect(await aggregateViews(h.t.db, NOW, { maxDays: 2 })).toEqual({ days: 2, months: 0 }); // 5 and 6 September 2025
    expect(await viewsCountedThrough(h.t.db)).toBe('2025-09-06');
    // 6 September is counted, but September is written only with its last day.
    expect(await purgeViews(h.t.db, NOW)).toBe(0);
    expect(await x.rows()).toBe(6);
    expect(await months()).toEqual([]);
  });

  it('writes each Paris month once, with its last day: views, seconds, scans and active Paris days', async () => {
    // From 7 September 2025 to 7 October 2026: September 2025 to September 2026 are written.
    const r = await aggregateViews(h.t.db, NOW, { maxDays: 1_000 });
    expect(r).toEqual({ days: 396, months: 13 });
    expect(await months()).toEqual(
      [
        { account_id: a, month: '2025-09-01', views: 3, seconds: 35, scans: 1, active_days: 3 },
        { account_id: b, month: '2025-10-01', views: 1, seconds: 4, scans: 0, active_days: 1 },
      ].sort((p, q) => p.month.localeCompare(q.month)),
    );
    expect(await aggregateViews(h.t.db, NOW, { maxDays: 1_000 })).toEqual({ days: 0, months: 0 });
  });

  it('then folds and deletes each counted day older than 13 Paris months, one at a time, anonymous rows without a fold', async () => {
    // The scan of 6 September (Paris) goes first, alone.
    expect(await purgeViews(h.t.db, NOW, { maxDays: 1 })).toBe(1);
    expect(await totals()).toEqual([{ account_id: a, page: VIEW_PAGE_CODES.SCAN, subject: X, views: 1, seconds: 0, first_at: new Date('2025-09-06T10:00:00Z'), last_at: new Date('2025-09-06T10:00:00Z') }]);
    // 7 September (Paris) goes whole, its anonymous row without a fold; 00:00 on 8 September stays.
    expect(await purgeViews(h.t.db, NOW, { maxDays: 1 })).toBe(3);
    expect(await totals()).toEqual([
      { account_id: a, page: VIEW_PAGE_CODES.SCAN, subject: X, views: 1, seconds: 0, first_at: new Date('2025-09-06T10:00:00Z'), last_at: new Date('2025-09-06T10:00:00Z') },
      { account_id: a, page: VIEW_PAGE_CODES.MODEL, subject: X, views: 2, seconds: 30, first_at: new Date('2025-09-07T10:00:00Z'), last_at: new Date('2025-09-07T21:59:59Z') },
    ]);
    expect(await h.t.db.selectFrom('collector_views').select('at').orderBy('at').execute()).toEqual([{ at: new Date('2025-09-07T22:00:00Z') }, { at: new Date('2025-10-02T10:00:00Z') }]);
    expect(await purgeViews(h.t.db, NOW)).toBe(0);
    // A day later (9 October 2026), 8 September 2025 goes too, folded into the same totals.
    expect(await purgeViews(h.t.db, new Date('2026-10-09T08:00:00Z'))).toBe(1);
    expect((await totals()).find((t) => t.page === VIEW_PAGE_CODES.MODEL)).toMatchObject({ views: 3, seconds: 35, last_at: new Date('2025-09-07T22:00:00Z') });
    // The fold equals the sum of the rows deleted, and the months are not touched by the purge.
    expect((await totals()).reduce((n, t) => n + t.views, 0)).toBe(4);
    expect((await months()).find((m) => m.account_id === a)).toMatchObject({ views: 3, seconds: 35, scans: 1 });
  });

  it('purges at most its days a pass', async () => {
    const e = await x.device({ firstSeen: '2025-01-01T08:00:00Z' });
    for (const day of ['01', '02', '03']) await x.view(e, `2025-08-${day}T10:00:00Z`);
    await h.t.db.deleteFrom('view_daily_stats').execute();
    await x.state('2025-08-01T08:00:00Z', true);
    expect((await aggregateViews(h.t.db, NOW, { maxDays: 1_000 })).days).toBeGreaterThan(400);
    expect(await purgeViews(h.t.db, NOW, { maxDays: 2 })).toBe(2);
    expect(await purgeViews(h.t.db, NOW, { maxDays: 2 })).toBe(1);
  });

  it('deletes the devices never linked, unseen for 13 months and with no row; keeps the linked, the staff’s, the recent, those with rows and those a visit names', async () => {
    const gone = await x.device({ firstSeen: '2025-06-01T08:00:00Z' });
    const goneToo = await x.device({ firstSeen: '2025-07-01T08:00:00Z', lastSeen: '2025-09-07T21:59:59Z' });
    const linked = await x.device({ firstSeen: '2025-06-01T08:00:00Z', account: a });
    const staff = await x.device({ firstSeen: '2025-06-01T08:00:00Z', staff: true });
    const recent = await x.device({ firstSeen: '2025-06-01T08:00:00Z', lastSeen: '2025-09-07T22:00:00Z' });
    const withRows = await x.device({ firstSeen: '2025-06-01T08:00:00Z' });
    await x.view(withRows, '2026-01-10T10:00:00Z');
    const once = await x.device({ firstSeen: '2025-06-01T08:00:00Z' });
    await h.t.db.insertInto('tracking_device_accounts').values({ device_id: once, account_id: b, first_via: 'SIGN_IN', first_linked_at: new Date('2025-06-01T08:00:00Z'), last_linked_at: new Date('2025-06-01T08:00:00Z') }).execute();
    // None while a visit names it (§3.4 A.8): the acquisition's purge takes the visit first, then the device may go.
    const visited = await x.device({ firstSeen: '2025-06-01T08:00:00Z' });
    const site = (await h.t.db.insertInto('acquisition_sources').values({ kind: 'SITE', site: 'purge.example', key: 'S:purge.example' }).returning('id').executeTakeFirstOrThrow()).id;
    await h.t.db.insertInto('acquisition_touches').values({ device_id: visited, source_id: site, day: '2025-06-01', first_at: new Date('2025-06-01T08:00:00Z'), last_at: new Date('2025-06-01T08:00:00Z') }).execute();
    expect(await h.ctx.services.tracking.purgeDevices(NOW, { max: 1 })).toBe(1);
    expect(await h.ctx.services.tracking.purgeDevices(NOW)).toBeGreaterThanOrEqual(1);
    const left = new Set((await h.t.db.selectFrom('tracking_devices').select('id').execute()).map((r) => r.id));
    expect([gone, goneToo].filter((id) => left.has(id))).toEqual([]);
    expect([linked, staff, recent, withRows, once, visited, d].every((id) => left.has(id))).toBe(true);
    expect(await h.ctx.services.tracking.purgeDevices(NOW)).toBe(0);
    await h.t.db.deleteFrom('acquisition_touches').where('device_id', '=', visited).execute();
    expect(await h.ctx.services.tracking.purgeDevices(NOW)).toBe(1);
  });

  it('runs in the order of §3.0 (f), returns every key, purges nothing in a pass where the count failed, and logs the sizes once a Paris day', async () => {
    const e = await x.device({ firstSeen: '2025-01-01T08:00:00Z' });
    await x.view(e, '2025-09-01T10:00:00Z');
    await h.t.db.deleteFrom('view_daily_stats').where('day', '>=', '2026-10-01').execute();
    await sql`CREATE FUNCTION view_stats_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the count failed'; END $$`.execute(h.t.db);
    await sql`CREATE TRIGGER view_stats_fail BEFORE INSERT ON view_daily_stats FOR EACH ROW EXECUTE FUNCTION view_stats_fail()`.execute(h.t.db);
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      h.clock.set('2026-10-08T08:00:00.000Z');
      lines.length = 0;
      const failed = await hk.runOnce();
      expect(Object.keys(failed)).toEqual([
        'sessions', 'transfers', 'scanTokens', 'scanStats', 'activity', 'acquisitionConversions', 'viewStats', 'viewMonths', 'acquisitionDaily', 'wishMonths', 'scanHistory', 'viewPurge', 'acquisitionPurge', 'wishHistory', 'devicePurge', 'liveNetworks', 'careLabels', 'packingPhotos', 'sizes',
      ]);
      expect(failed).toMatchObject({ viewStats: 0, viewPurge: 0 });
      expect(lines.some((l) => l.level === 'error' && (l.o as { job?: string }).job === 'viewStats')).toBe(true);
      // The row of 1 September 2025 is past 13 months and its day counted, yet stays: nothing is purged in this pass.
      expect(await h.t.db.selectFrom('collector_views').select('id').where('device_id', '=', e).execute()).toHaveLength(1);
      const sizes = lines.filter((l) => l.msg === 'intelligence sizes');
      expect(sizes).toHaveLength(1);
      expect(Object.keys((sizes[0]!.o as { tables: Record<string, number> }).tables)).toEqual(['collector_views', 'tracking_devices', 'view_daily_stats', 'acquisition_touches', 'acquisition_conversions', 'account_wishes', 'account_profiles', 'account_tastes']);
      expect(failed.sizes).toBe(8);
      await sql`DROP TRIGGER view_stats_fail ON view_daily_stats`.execute(h.t.db);
      await sql`DROP FUNCTION view_stats_fail()`.execute(h.t.db);
      lines.length = 0;
      const pass = await hk.runOnce();
      expect(pass.viewStats).toBeGreaterThan(0);
      expect(pass.viewPurge).toBe(1);
      // The sizes are written once a Paris day.
      expect(pass.sizes).toBe(0);
      expect(lines.filter((l) => l.msg === 'intelligence sizes')).toHaveLength(0);
      h.clock.set('2026-10-09T07:30:00.000Z');
      expect((await hk.runOnce()).sizes).toBe(8);
    } finally {
      await hk.stop();
    }
  });

  it('measures the lot’s tables that exist (the acquisition’s since 0043)', async () => {
    const sizes = await intelligenceSizes(h.t.db);
    expect(Object.keys(sizes)).toEqual(['collector_views', 'tracking_devices', 'view_daily_stats', 'acquisition_touches', 'acquisition_conversions', 'account_wishes', 'account_profiles', 'account_tastes']);
    expect(Object.values(sizes).every((n) => Number.isInteger(n) && n > 0)).toBe(true);
  });
});
