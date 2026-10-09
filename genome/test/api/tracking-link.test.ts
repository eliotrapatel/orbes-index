/**
 * Linking a device to an account (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.8.3, T.8.4 and T.14
 * « tracking-link.test.ts », steps 3.5 and 3.7; the plan's test/server/ folder is test/api/ here):
 *
 *  - CREATE ACCOUNT (SIGN_UP) attaches the device's anonymous views and scans (SCAN rows), and SIGN IN (SIGN_IN) its
 *    anonymous rows since; rows older than 13 months stay anonymous; the device cookie is set when there was none;
 *  - a second account on the same device gets only the rows since the first's link;
 *  - a collector signed in before this lot (a session, the device never linked) is linked once, SESSION;
 *  - two logins at once on one device: the rows attached once, `links` = 2;
 *  - a failed link leaves the sign-in answered 200; test entrants' networks and automated agents are never linked;
 *  - with the pool reporting requests waiting (every flush put off): the rows buffered before a login reach the table
 *    carrying the account; a batch from before the link sent after it takes the account; a device marked staff with
 *    rows still buffered leaves none in the table;
 *  - the acquisition's attach hook runs in the link's transaction, and its failure rolls the link back;
 *  - the 13 months are calendar months in Paris (viewHistoryCutoff);
 *  - the recount cases (step 3.7, T.8.4 step 5): `collector_places` gains the days already counted and not the others,
 *    a written month gains the attached rows and a month not written does not; the daily job then counts the rest;
 *    the total equals a recount from scratch; a test entrant's link counts nothing.
 * The sign-up's and sign-in's own tests (account.test.ts, auth.test.ts) are unchanged.
 *
 * Two PostgreSQL halves run in genome-ci with ORBES_TEST_POSTGRES_URL: two links of one device racing on a real pool,
 * and links racing the daily job (the advisory lock), equal to a recount from scratch.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { pseudonymize } from '../../src/server/http/client.js';
import { parisDayStart } from '../../src/server/services/schedule.js';
import { TrackingService, viewHistoryCutoff, type SeenBatch } from '../../src/server/services/tracking.js';
import { aggregateViews } from '../../src/server/services/tracking-jobs.js';
import { PlaceService } from '../../src/server/services/places.js';
import { PASSWORD, type Client, type Harness, createHarness } from './support.js';

const DEVICE = { s: false, t: 5, w: 390 };
const batch = (...pages: SeenBatch['e'][number]['p'][]): SeenBatch => ({ v: 1, d: DEVICE, e: pages.map((p) => ({ p, ms: 4_000, ago: 0 })) });

describe('TrackingService.link (plan CUSTOMER INTELLIGENCE §3.3 T.8.4)', () => {
  let h: Harness;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-09T10:00:00.000Z');
  });
  afterAll(() => h?.close());

  const tracking = () => h.ctx.services.tracking;
  /** Put another TrackingService behind the routes (they read ctx.services.tracking at each request); returns the undo. */
  const swapTracking = (t: TrackingService) => {
    const original = h.ctx.services.tracking;
    h.ctx.services.tracking = t;
    return { mockRestore: () => void (h.ctx.services.tracking = original) };
  };
  const register = async (c: Client) => {
    n += 1;
    const email = `link-${n}-${randomBytes(3).toString('hex')}@example.com`;
    const res = await c.post('/api/v1/account/register', { email, password: PASSWORD, firstName: 'Link', lastName: 'Test', country: 'FR' });
    expect(res.statusCode).toBe(201);
    return { email, id: (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id };
  };
  const signIn = (c: Client, email: string) => c.post('/api/v1/account/login', { email, password: PASSWORD });
  const deviceHashOf = (c: Client) => pseudonymize(h.ctx.config.ipHashPepper, 'device', h.app.unsignCookie(c.cookies.get('orbes_device')!).value!);
  const deviceOf = async (c: Client) => h.ctx.db.selectFrom('tracking_devices').selectAll().where('device_hash', '=', deviceHashOf(c)).executeTakeFirstOrThrow();
  const rowsOf = async (c: Client) => {
    await tracking().buffer.flush();
    const d = await deviceOf(c);
    return (await h.ctx.db.selectFrom('collector_views').select(['page', 'account_id', 'at']).where('device_id', '=', d.id).orderBy('id').execute()).map((r) => [r.page, r.account_id]);
  };
  const linksOf = async (c: Client) => {
    const d = await deviceOf(c);
    return h.ctx.db.selectFrom('tracking_device_accounts').select(['account_id', 'first_via', 'links']).where('device_id', '=', d.id).orderBy('first_linked_at').execute();
  };
  /** An anonymous scan's SCAN row, as the server writes it (step 3.6), for this client's device. */
  const scanRow = async (c: Client, at: Date) => {
    const d = await deviceOf(c);
    await h.ctx.db.insertInto('collector_views').values({ at, device_id: d.id, account_id: null, page: VIEW_PAGE_CODES.SCAN, subject: null, seconds: 0, place_id: null }).execute();
  };

  it('CREATE ACCOUNT attaches the device’s anonymous views and scans (SIGN_UP); rows older than 13 months stay anonymous', async () => {
    const c = h.client({ ip: '198.51.100.60' });
    expect((await c.post('/api/v1/seen', batch('NOW', 'COLLECTION'))).statusCode).toBe(204);
    await tracking().buffer.flush();
    await scanRow(c, new Date('2026-10-09T09:00:00.000Z'));
    await scanRow(c, new Date('2025-09-07T12:00:00.000Z')); // before 8 Sep 2025, the oldest day kept on 9 Oct 2026: not attached
    await c.post('/api/v1/seen', batch('SIGN_UP'));
    const me = await register(c);
    expect(await rowsOf(c)).toEqual([
      [VIEW_PAGE_CODES.NOW, me.id],
      [VIEW_PAGE_CODES.COLLECTION, me.id],
      [VIEW_PAGE_CODES.SCAN, me.id],
      [VIEW_PAGE_CODES.SCAN, null],
      [VIEW_PAGE_CODES.SIGN_UP, me.id],
    ]);
    expect(await linksOf(c)).toEqual([{ account_id: me.id, first_via: 'SIGN_UP', links: 1 }]);
    expect(await deviceOf(c)).toMatchObject({ account_id: me.id, linked_at: h.clock.now() });
    // No audit entry of its own: the sign-up's is the record.
    expect(await h.ctx.db.selectFrom('audit_logs').select('action').where('action', 'like', '%link%').execute()).toEqual([]);
  });

  it('sets the device cookie at a sign-up on a device that had none, and links it with nothing to attach', async () => {
    const c = h.client({ ip: '198.51.100.61' });
    const me = await register(c);
    expect(c.cookies.get('orbes_device')).toBeTruthy();
    expect(await deviceOf(c)).toMatchObject({ account_id: me.id, kind: 'PHONE', os: 'IOS', browser: 'SAFARI' });
    expect(await linksOf(c)).toEqual([{ account_id: me.id, first_via: 'SIGN_UP', links: 1 }]);
  });

  it('SIGN IN attaches what the device did since its previous link; a second account gets only the rows since the first’s link', async () => {
    const c = h.client({ ip: '198.51.100.62' });
    const first = await register(c);
    h.clock.advance(60_000);
    await c.post('/api/v1/seen', batch('NOW'));
    await c.post('/api/v1/account/logout', {});
    h.clock.advance(60_000);
    await c.post('/api/v1/seen', batch('CLUB'));
    // Someone else signs up on the same device: the CLUB view (after the sign-out) is theirs, nothing before the first's link.
    const second = await register(h.client({ ip: '198.51.100.63' }));
    await c.post('/api/v1/account/logout', {});
    h.clock.advance(60_000);
    expect((await signIn(c, second.email)).statusCode).toBe(200);
    expect(await rowsOf(c)).toEqual([
      [VIEW_PAGE_CODES.NOW, first.id],
      [VIEW_PAGE_CODES.CLUB, second.id],
    ]);
    expect(await linksOf(c)).toEqual([
      { account_id: first.id, first_via: 'SIGN_UP', links: 1 },
      { account_id: second.id, first_via: 'SIGN_IN', links: 1 },
    ]);
    // The first signs in again: only what came after the second's link would be theirs; there is nothing.
    await c.post('/api/v1/account/logout', {});
    h.clock.advance(60_000);
    expect((await signIn(c, first.email)).statusCode).toBe(200);
    expect(await rowsOf(c)).toEqual([
      [VIEW_PAGE_CODES.NOW, first.id],
      [VIEW_PAGE_CODES.CLUB, second.id],
    ]);
    expect((await linksOf(c)).find((l) => l.account_id === first.id)).toEqual({ account_id: first.id, first_via: 'SIGN_UP', links: 2 });
  });

  it('links a collector signed in before this lot once, SESSION, on their first batch', async () => {
    const c = h.client({ ip: '198.51.100.64' });
    const me = await register(c);
    // As if the session predated the recording: the device's link is undone.
    const d = await deviceOf(c);
    await h.ctx.db.deleteFrom('tracking_device_accounts').where('device_id', '=', d.id).execute();
    await h.ctx.db.updateTable('tracking_devices').set({ account_id: null, linked_at: null }).where('id', '=', d.id).execute();
    const fresh = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now });
    const swap = swapTracking(fresh);
    try {
      await c.post('/api/v1/seen', batch('NOW'));
      h.clock.advance(30_000);
      await c.post('/api/v1/seen', batch('CLUB'));
      await fresh.stop();
      expect(await h.ctx.db.selectFrom('tracking_device_accounts').select(['account_id', 'first_via', 'links']).where('device_id', '=', d.id).execute()).toEqual([{ account_id: me.id, first_via: 'SESSION', links: 1 }]);
      expect((await h.ctx.db.selectFrom('collector_views').select('account_id').where('device_id', '=', d.id).execute()).map((r) => r.account_id)).toEqual([me.id, me.id]);
    } finally {
      swap.mockRestore();
    }
  });

  it('two logins at once on one device attach the rows once and count two links', async () => {
    const c = h.client({ ip: '198.51.100.65' });
    const me = await register(c);
    await c.post('/api/v1/account/logout', {});
    h.clock.advance(60_000);
    await c.post('/api/v1/seen', batch('NOW', 'HOW'));
    h.clock.advance(1_000);
    const [a, b] = await Promise.all([signIn(c, me.email), signIn(c, me.email)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(await rowsOf(c)).toEqual([
      [VIEW_PAGE_CODES.NOW, me.id],
      [VIEW_PAGE_CODES.HOW, me.id],
    ]);
    expect(await linksOf(c)).toEqual([{ account_id: me.id, first_via: 'SIGN_UP', links: 3 }]);
  });

  it('answers the sign-in 200 when the link fails, and never links a test entrants’ network or an automated agent', async () => {
    const c = h.client({ ip: '198.51.100.66' });
    const me = await register(c);
    await c.post('/api/v1/account/logout', {});
    const failing = vi.spyOn(tracking(), 'link').mockRejectedValueOnce(new Error('database unavailable'));
    try {
      expect((await signIn(c, me.email)).statusCode).toBe(200);
      expect(failing).toHaveBeenCalledTimes(1);
    } finally {
      failing.mockRestore();
    }
    const link = vi.spyOn(tracking(), 'link');
    try {
      const bot = h.client({ ip: '100.64.9.9' });
      expect((await signIn(bot, me.email)).statusCode).toBe(200);
      expect((await bot.post('/api/v1/account/login', { email: me.email, password: PASSWORD }, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0' } })).statusCode).toBe(200);
      expect(link).not.toHaveBeenCalled();
    } finally {
      link.mockRestore();
    }
  });

  describe('with the pool reporting requests waiting (every flush put off)', () => {
    let busy: TrackingService;
    let swap: { mockRestore(): void };
    beforeAll(() => {
      busy = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now, waiting: () => true });
      swap = swapTracking(busy);
    });
    afterAll(() => swap.mockRestore());
    const rowsNow = async (c: Client) => {
      const d = await deviceOf(c);
      return (await h.ctx.db.selectFrom('collector_views').select(['page', 'account_id']).where('device_id', '=', d.id).orderBy('id').execute()).map((r) => [r.page, r.account_id]);
    };

    it('the rows buffered before a login reach the table carrying the account', async () => {
      const c = h.client({ ip: '198.51.100.67' });
      await c.post('/api/v1/seen', batch('NOW', 'MODEL'));
      expect(busy.buffer.size).toBe(2);
      const me = await register(c);
      expect(await rowsNow(c)).toEqual([]); // still in memory, the pool busy
      const d = await deviceOf(c);
      expect(busy.buffer.peek().filter((r) => r.deviceId === d.id).map((r) => r.accountId)).toEqual([me.id, me.id]);
      await busy.buffer.flush({ force: true });
      expect(await rowsNow(c)).toEqual([
        [VIEW_PAGE_CODES.NOW, me.id],
        [VIEW_PAGE_CODES.MODEL, me.id],
      ]);
    });

    it('a batch from before the link, sent after it without the session, takes the account', async () => {
      const c = h.client({ ip: '198.51.100.68' });
      await c.post('/api/v1/seen', batch('NOW'));
      const me = await register(c);
      // The page's last batch, in flight at the sign-up: its views began before it, and it carries no session.
      const anonymous = h.client({ ip: '198.51.100.68' });
      anonymous.cookies.set('orbes_device', c.cookies.get('orbes_device')!);
      h.clock.advance(5_000);
      await anonymous.post('/api/v1/seen', { v: 1, d: DEVICE, e: [{ p: 'SIGN_UP', ms: 4_000, ago: 8_000 }, { p: 'NOW', ms: 2_000, ago: 2_000 }] });
      await busy.buffer.flush({ force: true });
      expect(await rowsNow(c)).toEqual([
        [VIEW_PAGE_CODES.NOW, me.id],
        [VIEW_PAGE_CODES.SIGN_UP, me.id],
        [VIEW_PAGE_CODES.NOW, null], // begun after the sign-up, without a session: anonymous until the next link
      ]);
    });

    it('a device marked staff with rows still buffered leaves none in the table', async () => {
      const c = h.client({ ip: '198.51.100.69' });
      await c.post('/api/v1/seen', batch('NOW', 'CLUB'));
      expect(busy.buffer.size).toBeGreaterThan(0);
      await busy.markStaff(deviceHashOf(c));
      await busy.buffer.flush({ force: true });
      expect(await rowsNow(c)).toEqual([]);
      expect((await deviceOf(c)).staff_at).not.toBeNull();
    });
  });

  it('runs the acquisition’s attach in the link’s transaction, and its failure rolls the link back', async () => {
    const calls: unknown[] = [];
    let fail = false;
    const hooked = new TrackingService({
      db: h.ctx.db,
      places: h.ctx.services.places,
      clock: h.clock.now,
      attach: async (tx, deviceId, accountId, via) => {
        const d = await tx.selectFrom('tracking_devices').select('account_id').where('id', '=', deviceId).executeTakeFirstOrThrow();
        calls.push({ via, linkedInTx: d.account_id === accountId });
        if (fail) throw new Error('attach failed');
      },
    });
    const c = h.client({ ip: '198.51.100.70' });
    const me = await register(c);
    const other = await register(h.client({ ip: '198.51.100.71' }));
    const hash = deviceHashOf(c);
    await hooked.link(hash, me.id, 'SIGN_IN');
    expect(calls).toEqual([{ via: 'SIGN_IN', linkedInTx: true }]);
    fail = true;
    await expect(hooked.link(hash, other.id, 'SIGN_IN')).rejects.toThrow('attach failed');
    expect((await deviceOf(c)).account_id).toBe(me.id);
    expect((await linksOf(c)).map((l) => l.account_id)).toEqual([me.id]);
  });

  it('counts the 13 months in Paris calendar months', () => {
    expect(viewHistoryCutoff(new Date('2026-10-08T10:00:00Z'))).toEqual(parisDayStart('2025-09-08'));
    // 23:30 UTC on 8 October is 9 October in Paris.
    expect(viewHistoryCutoff(new Date('2026-10-08T22:30:00Z'))).toEqual(parisDayStart('2025-09-09'));
    expect(viewHistoryCutoff(new Date('2027-03-31T10:00:00Z'))).toEqual(parisDayStart('2026-02-28'));
    expect(parisDayStart('2025-09-08').toISOString()).toBe('2025-09-07T22:00:00.000Z');
  });
});

// ── The recount cases (step 3.7): the link's catch-up of the days and months already counted ─────────────────────

/** The per-collector figures the link and the daily job write, sorted (the recount's comparison). */
async function counted(db: Db) {
  const places = await db.selectFrom('collector_places').select(['account_id', 'place_id', 'days', 'first_day', 'last_day']).orderBy('account_id').orderBy('place_id').execute();
  const months = await db.selectFrom('collector_view_months').select(['account_id', 'month', 'views', 'seconds', 'scans', 'active_days']).orderBy('account_id').orderBy('month').execute();
  const days = await db.selectFrom('view_daily_stats').select(['day', 'page', 'subject', 'country', 'views', 'seconds', 'devices']).orderBy('day').orderBy('page').orderBy('subject').orderBy('country').execute();
  return { places, months, days };
}

/** Everything the daily job wrote, counted again from the raw rows as they are now. */
async function recount(db: Db, now: Date) {
  await db.deleteFrom('collector_places').execute();
  await db.deleteFrom('collector_view_months').execute();
  await db.deleteFrom('view_daily_stats').execute();
  await db.deleteFrom('device_daily_stats').execute();
  await aggregateViews(db, now, { maxDays: 1_000 });
  return counted(db);
}

describe('TrackingService.link and the daily job (plan CUSTOMER INTELLIGENCE §3.3 T.8.4 step 5, T.10)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await h.t.db.updateTable('tracking_state').set({ started_at: new Date('2026-09-01T06:00:00Z'), scans_backfilled_at: new Date('2026-09-01T06:00:00Z') }).where('id', '=', 1).execute();
  });
  afterAll(() => h?.close());

  const account = async () => (await h.t.db.insertInto('accounts').values({ email: `${randomBytes(6).toString('hex')}@example.com`, email_normalized: `${randomBytes(6).toString('hex')}@example.com`, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id;
  const device = async (hash: string) => (await h.t.db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: new Date('2026-09-01T06:00:00Z'), last_seen_at: new Date('2026-09-01T06:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
  const view = (deviceId: number, at: string, accountId: string | null, placeId: number | null, page: keyof typeof VIEW_PAGE_CODES = 'NOW') =>
    h.t.db.insertInto('collector_views').values({ at: new Date(at), device_id: deviceId, account_id: accountId, page: VIEW_PAGE_CODES[page], subject: null, seconds: page === 'SCAN' ? 0 : 10, place_id: placeId }).execute();

  it('adds the attached rows of the days already counted and of the months written, leaves the others to the job, and equals a recount from scratch', async () => {
    const a = await account();
    const paris = (await h.ctx.services.places.idOf('FR', 'Paris'))!;
    const lyon = (await h.ctx.services.places.idOf('FR', 'Lyon'))!;
    const hash = 'L'.repeat(43);
    const anon = await device(hash);
    const own = await device('O'.repeat(43));
    // The device, anonymous: 10 and 20 September (Paris, Lyon), a scan on 2 October, 6 October in Paris.
    await view(anon, '2026-09-10T10:00:00Z', null, paris);
    await view(anon, '2026-09-20T10:00:00Z', null, lyon);
    await view(anon, '2026-10-02T10:00:00Z', null, paris, 'SCAN');
    await view(anon, '2026-10-06T10:00:00Z', null, paris);
    // The collector's own device, signed in: 10 September and 3 October in Paris.
    await view(own, '2026-09-10T12:00:00Z', a, paris);
    await view(own, '2026-10-03T12:00:00Z', a, paris);
    // 5 October, 08:00 UTC: counted through 4 October; September written (its last day counted), October not.
    expect(await aggregateViews(h.t.db, new Date('2026-10-05T08:00:00Z'), { maxDays: 1_000 })).toEqual({ days: 34, months: 1 });
    expect((await counted(h.t.db)).places).toEqual([{ account_id: a, place_id: paris, days: 2, first_day: '2026-09-10', last_day: '2026-10-03' }]);
    expect((await counted(h.t.db)).months).toEqual([{ account_id: a, month: '2026-09-01', views: 1, seconds: 10, scans: 0, active_days: 1 }]);

    // The sign-in on the device, the same morning: its anonymous rows (13 months) take the account.
    h.clock.set('2026-10-05T09:00:00.000Z');
    expect(await h.ctx.services.tracking.link(hash, a, 'SIGN_IN')).toEqual({ attached: 4 });
    const after = await counted(h.t.db);
    // Paris: 10 September was already the collector's, 2 October is new; 6 October is not counted yet. Lyon: 20 September.
    expect(after.places).toEqual(
      [
        { account_id: a, place_id: paris, days: 3, first_day: '2026-09-10', last_day: '2026-10-03' },
        { account_id: a, place_id: lyon, days: 1, first_day: '2026-09-20', last_day: '2026-09-20' },
      ].sort((p, q) => p.place_id - q.place_id),
    );
    // September gains the two views and one new active day (20 September); October is not written: nothing there yet.
    expect(after.months).toEqual([{ account_id: a, month: '2026-09-01', views: 3, seconds: 30, scans: 0, active_days: 2 }]);
    // The daily totals are anonymous: the link changes none.
    expect(after.days).toEqual((await counted(h.t.db)).days);

    // The job then counts the rest: 6 October to 1 November, and October with its last day.
    await view(own, '2026-10-20T12:00:00Z', a, lyon);
    const now = new Date('2026-11-02T08:00:00Z');
    expect(await aggregateViews(h.t.db, now, { maxDays: 1_000 })).toEqual({ days: 28, months: 1 });
    const total = await counted(h.t.db);
    expect(total.places).toEqual(
      [
        { account_id: a, place_id: paris, days: 4, first_day: '2026-09-10', last_day: '2026-10-06' },
        { account_id: a, place_id: lyon, days: 2, first_day: '2026-09-20', last_day: '2026-10-20' },
      ].sort((p, q) => p.place_id - q.place_id),
    );
    expect(total.months).toEqual([
      { account_id: a, month: '2026-09-01', views: 3, seconds: 30, scans: 0, active_days: 2 },
      { account_id: a, month: '2026-10-01', views: 3, seconds: 30, scans: 1, active_days: 4 },
    ]);
    // A recount from scratch of the same rows gives the same figures.
    expect(await recount(h.t.db, now)).toEqual(total);
  });

  it('counts nothing for a test entrant’s link', async () => {
    const t = await account();
    await h.t.db.insertInto('test_entrants').values({ account_id: t }).execute();
    const hash = 'T'.repeat(43);
    const d = await device(hash);
    const paris = (await h.ctx.services.places.idOf('FR', 'Paris'))!;
    await view(d, '2026-09-15T10:00:00Z', null, paris);
    const before = await counted(h.t.db);
    await h.ctx.services.tracking.link(hash, t, 'SIGN_IN', new Date('2026-11-03T09:00:00Z'));
    expect(await counted(h.t.db)).toEqual(before);
  });
});

// ── PostgreSQL: two links of one device racing on a real pool ─────────────────────────────────────────────────────
const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('TrackingService.link on PostgreSQL', () => {
  let admin: Db;
  let db: Db;
  const name = `orbes_link_${randomBytes(6).toString('hex')}`;
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

  it('attaches the rows once and counts every link when sign-ins of one device race, each process with its own cache', async () => {
    const account = await db.insertInto('accounts').values({ email: 'race@example.com', email_normalized: 'race@example.com', password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow();
    const hash = 'R'.repeat(43);
    const now = new Date();
    const device = await db.insertInto('tracking_devices').values({ device_hash: hash }).returning('id').executeTakeFirstOrThrow();
    await db
      .insertInto('collector_views')
      .values(Array.from({ length: 20 }, (_, i) => ({ at: new Date(now.getTime() - (i + 1) * 60_000), device_id: device.id, account_id: null, page: VIEW_PAGE_CODES.NOW, subject: null, seconds: 3, place_id: null })))
      .execute();
    const services = Array.from({ length: 6 }, () => new TrackingService({ db, places: new PlaceService({ db }) }));
    const results = await Promise.all(services.map((t) => t.link(hash, account.id, 'SIGN_IN', now)));
    expect(results.reduce((sum, r) => sum + r.attached, 0)).toBe(20);
    expect(await db.selectFrom('tracking_device_accounts').select(['links', 'first_via']).execute()).toEqual([{ links: 6, first_via: 'SIGN_IN' }]);
    expect(Number((await db.selectFrom('collector_views').select((eb) => eb.fn.countAll().as('n')).where('account_id', '=', account.id).executeTakeFirstOrThrow()).n)).toBe(20);
  });

  it('counts every row once when links race the daily job: the advisory lock, equal to a recount from scratch', async () => {
    await db.insertInto('tracking_state').values({ id: 1, started_at: new Date('2026-09-01T06:00:00Z'), scans_backfilled_at: new Date('2026-09-01T06:00:00Z') }).onConflict((oc) => oc.doNothing()).execute();
    const place = (await new PlaceService({ db }).idOf('FR', 'Paris'))!;
    const accounts = await Promise.all(
      Array.from({ length: 6 }, async (_, i) => (await db.insertInto('accounts').values({ email: `racer-${i}@example.com`, email_normalized: `racer-${i}@example.com`, password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()).id),
    );
    const hashes = accounts.map((_, i) => `${String.fromCharCode(65 + i)}`.repeat(43));
    for (const hash of hashes) {
      const d = await db.insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: new Date('2026-09-01T06:00:00Z'), last_seen_at: new Date('2026-09-01T06:00:00Z') }).returning('id').executeTakeFirstOrThrow();
      await db
        .insertInto('collector_views')
        .values(Array.from({ length: 40 }, (_, k) => ({ at: new Date(Date.parse('2026-09-02T10:00:00Z') + k * 86_400_000), device_id: d.id, account_id: null, page: VIEW_PAGE_CODES.NOW, subject: null, seconds: 5, place_id: place })))
        .execute();
    }
    const now = new Date('2026-10-20T08:00:00Z');
    // Half the days counted first, then the links and the rest of the count at once.
    await aggregateViews(db, new Date('2026-09-25T08:00:00Z'), { maxDays: 1_000 });
    await Promise.all([
      ...accounts.map((a, i) => new TrackingService({ db, places: new PlaceService({ db }) }).link(hashes[i]!, a, 'SIGN_IN', now)),
      aggregateViews(db, now, { maxDays: 1_000 }),
    ]);
    await aggregateViews(db, now, { maxDays: 1_000 });
    const raced = await counted(db);
    expect(raced.places.filter((p) => accounts.includes(p.account_id))).toHaveLength(6);
    expect(await recount(db, now)).toEqual(raced);
  });
});
