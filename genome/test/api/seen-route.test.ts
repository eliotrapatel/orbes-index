/**
 * POST /api/v1/seen and TrackingService.ingest (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.8.3, T.8.5, T.8.7 and
 * T.14 « seen-route.test.ts », step 3.4; the plan's test/server/ folder is test/api/ here):
 *
 *  - 204 and the device cookie set on a first request; the rows in `collector_views` after flush(), with the device,
 *    its class and its place;
 *  - 403 from another origin (and from a client that names none, as `curl` does); 400 for an unknown key, 51 events, a
 *    SCAN page, a negative `ago`, no view without an arrival;
 *  - the page load's arrival `a` (plan §3.4 A.7.2, step 4.2): alone with `e: []`, or with views, 204; its views
 *    recorded either way;
 *  - the `seen` budget separate from `api`;
 *  - the 30-second session cache: one session read for two batches 10 s apart; a revoked session leaves the recording
 *    within 30 s; at most 5 000 entries;
 *  - dropped with 204: a console session (the device marked, its earlier rows deleted), the team's own account, a test
 *    entrant's session, an address in 100.64.0.0/10, HeadlessChrome, a prefetch, a view begun 24 hours ago;
 *  - seconds capped at 1 800, and 10 800 for LIVE; under a second not recorded;
 *  - subjects: a slug → its model, a variant's slug → the variant, an unknown slug → null, a serial → its model, a
 *    release's id → itself and a random uuid → null;
 *  - the daily cap of 2 000 rows a device; a full buffer drops the oldest with one warning a minute; a flush put off
 *    while the pool has requests waiting, then written; the shutdown writes what is left; a flush failing for the
 *    database down keeps every row however many times it fails, and only rows PostgreSQL refuses for their data are
 *    dropped after FLUSH_MAX_ATTEMPTS failures in a row.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { SEEN_SESSION_CACHE_MAX, SEEN_SESSION_CACHE_MS, SeenSessions } from '../../src/server/routes/seen.js';
import { BUFFER_FLUSH_AT, DEVICE_DAILY_CAP, FLUSH_MAX_ATTEMPTS, inTestNetwork, isDataRejection, TrackingService, ViewBuffer, type BufferedView, type SeenBatch, type SeenMeta } from '../../src/server/services/tracking.js';
import type { Db } from '../../src/server/db/connection.js';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { pseudonymize } from '../../src/server/http/client.js';
import type { AppContext } from '../../src/server/context.js';
import type { Logger } from '../../src/server/types.js';
import { accountClient, createAdmin, createHarness, errorOf, issue, ORIGIN, PASSWORD, seedCatalog, type Client, type Harness } from './support.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const HEADLESS = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36';
const DEVICE = { s: false, t: 5, w: 390 };

const batch = (e: SeenBatch['e'], d = DEVICE): SeenBatch => ({ v: 1, d, e });
const view = (p: SeenBatch['e'][number]['p'], ms = 5_000, extra: { s?: string; ago?: number } = {}) => ({ p, ms, ago: extra.ago ?? 0, ...(extra.s !== undefined ? { s: extra.s } : {}) });

describe('POST /api/v1/seen (plan CUSTOMER INTELLIGENCE §3.3 T.8.7)', () => {
  let h: Harness;
  const CF = { 'cf-ipcountry': 'FR', 'cf-ipcity': 'Paris' };

  beforeAll(async () => {
    h = await createHarness({ config: { trustProxy: true, geo: { mode: 'cloudflare' }, rateLimits: { apiPerMinute: 1_000 } } });
    h.clock.set('2026-10-09T10:00:00.000Z');
  });
  afterAll(() => h?.close());

  const seen = (c: Client, body: unknown, headers: Record<string, string> = {}, opts: { origin?: string | null } = {}) =>
    c.request('POST', '/api/v1/seen', { body, headers: { ...CF, ...headers }, ...opts });
  const deviceHashOf = (c: Client) => {
    const raw = c.cookies.get('orbes_device')!;
    const id = h.app.unsignCookie(raw).value!;
    return pseudonymize(h.ctx.config.ipHashPepper, 'device', id);
  };
  const rowsOf = async (c: Client) => {
    await h.ctx.services.tracking.buffer.flush();
    const device = await h.ctx.db.selectFrom('tracking_devices').selectAll().where('device_hash', '=', deviceHashOf(c)).executeTakeFirst();
    if (!device) return { device: undefined, rows: [] };
    const rows = await h.ctx.db.selectFrom('collector_views').selectAll().where('device_id', '=', device.id).orderBy('id').execute();
    return { device, rows };
  };

  it('answers 204, sets the device cookie on a first request, and writes the rows with the device, its class and its place once flushed', async () => {
    const c = h.client({ ip: '198.51.100.30' });
    const res = await seen(c, batch([view('NOW', 12_400, { ago: 30_000 }), view('COLLECTION', 3_000)]));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    const cookie = res.cookies.find((x) => x.name === 'orbes_device');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    // Nothing is written before the buffer is flushed.
    const device = await h.ctx.db.selectFrom('tracking_devices').selectAll().where('device_hash', '=', deviceHashOf(c)).executeTakeFirstOrThrow();
    expect(await h.ctx.db.selectFrom('collector_views').select('id').where('device_id', '=', device.id).execute()).toEqual([]);
    const { rows } = await rowsOf(c);
    const place = await h.ctx.db.selectFrom('geo_places').selectAll().where('id', '=', device.last_place_id!).executeTakeFirstOrThrow();
    expect(place).toMatchObject({ country: 'FR', city: 'Paris' });
    expect(device).toMatchObject({ kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'BROWSER', in_app: null, account_id: null, staff_at: null });
    expect(rows.map((r) => ({ at: r.at.toISOString(), page: r.page, subject: r.subject, seconds: r.seconds, account: r.account_id, place: r.place_id }))).toEqual([
      { at: '2026-10-09T09:59:30.000Z', page: VIEW_PAGE_CODES.NOW, subject: null, seconds: 12, account: null, place: place.id },
      { at: '2026-10-09T10:00:00.000Z', page: VIEW_PAGE_CODES.COLLECTION, subject: null, seconds: 3, account: null, place: place.id },
    ]);
    // A second batch keeps the cookie and the device.
    const again = await seen(c, batch([view('CLUB')]));
    expect(again.statusCode).toBe(204);
    expect(again.cookies.find((x) => x.name === 'orbes_device')).toBeUndefined();
    expect((await rowsOf(c)).rows).toHaveLength(3);
  });

  it('records a signed-in batch under its account, an in-app browser as such, and the home screen from the page', async () => {
    const { client, email } = await accountClient(h);
    const me = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const instagram = `${IPHONE} Instagram 305.0.0.0`;
    expect((await seen(client, batch([view('MY_PIECES')]), { 'user-agent': instagram })).statusCode).toBe(204);
    const { device, rows } = await rowsOf(client);
    expect(device).toMatchObject({ opened_in: 'IN_APP', in_app: 'INSTAGRAM' });
    expect(rows.map((r) => r.account_id)).toEqual([me.id]);
    // The page says it runs from the home screen: the class is written again.
    await seen(client, batch([view('NOW')], { s: true, t: 5, w: 390 }));
    expect((await rowsOf(client)).device).toMatchObject({ opened_in: 'HOME_SCREEN', in_app: null });
  });

  it('refuses another origin and a client naming none with 403, and a malformed body with 400', async () => {
    const c = h.client({ ip: '198.51.100.31' });
    const foreign = await seen(c, batch([view('NOW')]), {}, { origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(errorOf(foreign).code).toBe('CSRF_FAILED');
    // curl sends no Origin and no Sec-Fetch-Site.
    const curl = await seen(c, batch([view('NOW')]), {}, { origin: null });
    expect(curl.statusCode).toBe(403);
    // The browser's own same-origin fetch without Origin passes.
    expect((await seen(c, batch([view('NOW')]), { 'sec-fetch-site': 'same-origin' }, { origin: null })).statusCode).toBe(204);
    for (const body of [
      { ...batch([view('NOW')]), x: 1 },
      { ...batch([view('NOW')]), d: { ...DEVICE, x: 1 } },
      { ...batch([{ ...view('NOW'), x: 1 } as never]) },
      batch(Array.from({ length: 51 }, () => view('NOW'))),
      batch([view('SCAN' as never)]),
      batch([view('BOARD' as never)]),
      batch([view('NOW', 5_000, { ago: -1 })]),
      batch([view('NOW', 5_000, { ago: 86_400_001 })]),
      batch([view('NOW', -1)]),
      batch([view('MODEL', 5_000, { s: 'x'.repeat(81) })]),
      batch([]),
      { v: 2, d: DEVICE, e: [view('NOW')] },
      { v: 1, e: [view('NOW')] },
    ]) {
      const res = await seen(c, body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('takes the page load\'s arrival, `a`: alone with no view yet (`e: []`) or with views, 204; `e: []` without it is still refused', async () => {
    const c = h.client({ ip: '198.51.100.32' });
    expect((await seen(c, { ...batch([]), a: { path: '/verify', referrer: 'https://www.instagram.com/' } })).statusCode).toBe(204);
    expect((await rowsOf(c)).rows).toEqual([]);
    expect((await seen(c, { ...batch([view('NOW')]), a: { link: 'no-such-link' } })).statusCode).toBe(204);
    const { device, rows } = await rowsOf(c);
    expect(rows.map((r) => r.page)).toEqual([VIEW_PAGE_CODES.NOW]);
    expect(device?.first_source_id).toEqual(expect.any(Number));
    const refused = await seen(c, batch([]));
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused).code).toBe('VALIDATION_FAILED');
  });

  it('draws on its own budget, `seen`, twice the `api` one and separate from it', async () => {
    const small = await createHarness({ config: { rateLimits: { apiPerMinute: 2 } } });
    try {
      const c = small.client({ ip: '198.51.100.40' });
      // Four batches (2 × 2) pass, the fifth is refused; the api budget is untouched.
      for (let i = 0; i < 4; i++) expect((await c.post('/api/v1/seen', batch([view('NOW')]))).statusCode).toBe(204);
      const limited = await c.post('/api/v1/seen', batch([view('NOW')]));
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
      expect((await c.get('/api/v1/categories')).statusCode).toBe(200);
      expect((await c.get('/api/v1/categories')).statusCode).toBe(200);
      expect((await c.get('/api/v1/categories')).statusCode).toBe(429);
      // And the other way round: a client whose api budget is spent still records its views.
      const d = small.client({ ip: '198.51.100.41' });
      for (let i = 0; i < 3; i++) await d.get('/api/v1/categories');
      expect((await d.post('/api/v1/seen', batch([view('NOW')]))).statusCode).toBe(204);
    } finally {
      await small.close();
    }
  });

  it('reads a session once for batches 10 s apart, and a revoked session leaves the recording within 30 s', async () => {
    const { client, email } = await accountClient(h);
    const me = await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const reads = vi.spyOn(h.ctx.services.auth, 'authenticateAccount');
    try {
      await seen(client, batch([view('NOW')]));
      h.clock.advance(10_000);
      await seen(client, batch([view('CLUB')]));
      expect(reads).toHaveBeenCalledTimes(1);
      // Revoked: the cache still holds it for the rest of its 30 seconds, then the batch is anonymous.
      await h.ctx.sessions.revoke(client.cookies.get('orbes_session')!);
      h.clock.advance(10_000);
      await seen(client, batch([view('RELEASES')]));
      h.clock.advance(SEEN_SESSION_CACHE_MS);
      await seen(client, batch([view('HOW')]));
      expect(reads).toHaveBeenCalledTimes(2);
      const { rows } = await rowsOf(client);
      expect(rows.map((r) => [r.page, r.account_id])).toEqual([
        [VIEW_PAGE_CODES.NOW, me.id],
        [VIEW_PAGE_CODES.CLUB, me.id],
        [VIEW_PAGE_CODES.RELEASES, me.id],
        [VIEW_PAGE_CODES.HOW, null],
      ]);
    } finally {
      reads.mockRestore();
    }
  });

  it('keeps at most 5 000 sessions in its cache, the least recently used going first', async () => {
    let reads = 0;
    const ctx = {
      config: { env: 'test' },
      clock: () => new Date('2026-10-09T10:00:00Z'),
      services: { auth: { authenticateAccount: async () => (reads++, null), authenticateAdmin: async () => null } },
    } as unknown as AppContext;
    const sessions = new SeenSessions(ctx);
    const req = (token: string) => ({ cookies: { orbes_session: token }, orbes: {} }) as unknown as FastifyRequest;
    for (let i = 0; i <= SEEN_SESSION_CACHE_MAX; i++) await sessions.of(req(`token-${i}`));
    expect(sessions.size).toBe(SEEN_SESSION_CACHE_MAX);
    expect(reads).toBe(SEEN_SESSION_CACHE_MAX + 1);
    await sessions.of(req(`token-${SEEN_SESSION_CACHE_MAX}`)); // the newest is held
    expect(reads).toBe(SEEN_SESSION_CACHE_MAX + 1);
    await sessions.of(req('token-0')); // the oldest went
    expect(reads).toBe(SEEN_SESSION_CACHE_MAX + 2);
  });

  it('drops a console session’s batch with 204, marks the device and deletes its earlier rows once', async () => {
    const c = h.client({ ip: '198.51.100.32' });
    await seen(c, batch([view('NOW'), view('COLLECTION')]));
    expect((await rowsOf(c)).rows).toHaveLength(2);
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    expect((await c.post('/api/admin/auth/login', { email: admin.email, password: PASSWORD })).statusCode).toBe(200);
    expect((await seen(c, batch([view('CLUB')]))).statusCode).toBe(204);
    const marked = await rowsOf(c);
    expect(marked.device!.staff_at).toEqual(h.clock.now());
    expect(marked.rows).toEqual([]);
    // Signed out of the console, the device stays staff's.
    c.cookies.delete('orbes_admin');
    expect((await seen(c, batch([view('NOW')]))).statusCode).toBe(204);
    expect((await rowsOf(c)).rows).toEqual([]);
    // A fresh process (an empty cache) reads the mark from the row.
    const fresh = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places });
    const meta = metaOf(deviceHashOf(c));
    expect(await fresh.ingest(batch([view('NOW')]), meta)).toEqual({ recorded: 0, dropped: 'STAFF' });
  });

  it('drops the team’s own account, a test entrant’s session and the test entrants’ networks, with 204', async () => {
    // The team's own account: its email is a console login's.
    const { client: team, email } = await accountClient(h);
    await h.ctx.db.insertInto('admin_users').values({ email, email_normalized: email.toLowerCase(), password_hash: 'scrypt$x', role: 'AUDITOR' }).execute();
    // A test entrant.
    const { client: entrant, email: entrantEmail } = await accountClient(h);
    const entrantId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', entrantEmail).executeTakeFirstOrThrow()).id;
    await h.ctx.db.insertInto('test_entrants').values({ account_id: entrantId }).execute();
    h.clock.advance(5 * 60_000 + 1); // both sets are read again after 5 minutes
    for (const c of [team, entrant]) {
      expect((await seen(c, batch([view('NOW')]))).statusCode).toBe(204);
      expect((await rowsOf(c)).rows).toEqual([]);
    }
    const bot = h.client({ ip: '100.64.3.7' });
    expect((await seen(bot, batch([view('NOW')]))).statusCode).toBe(204);
    expect((await rowsOf(bot)).rows).toEqual([]);
    expect(inTestNetwork('100.64.0.1')).toBe(true);
    expect(inTestNetwork('100.127.255.254')).toBe(true);
    expect(inTestNetwork('::ffff:100.64.0.1')).toBe(true);
    expect(inTestNetwork('100.128.0.1')).toBe(false);
    expect(inTestNetwork('2001:db8::1')).toBe(false);
  });

  it('drops HeadlessChrome and prefetches with 204, and a view begun 24 hours ago or one under a second', async () => {
    const headless = h.client({ ip: '198.51.100.33' });
    expect((await seen(headless, batch([view('NOW')]), { 'user-agent': HEADLESS })).statusCode).toBe(204);
    expect((await rowsOf(headless)).rows).toEqual([]);
    const prefetch = h.client({ ip: '198.51.100.34' });
    expect((await seen(prefetch, batch([view('NOW')]), { 'sec-purpose': 'prefetch' })).statusCode).toBe(204);
    expect((await rowsOf(prefetch)).rows).toEqual([]);
    const c = h.client({ ip: '198.51.100.35' });
    expect((await seen(c, batch([view('NOW', 5_000, { ago: 86_400_000 }), view('CLUB', 999), view('HOW', 1_000, { ago: 86_399_999 })]))).statusCode).toBe(204);
    expect((await rowsOf(c)).rows.map((r) => [r.page, r.seconds])).toEqual([[VIEW_PAGE_CODES.HOW, 1]]);
  });

  it('caps a view at 1 800 seconds, and a LIVE room at 10 800', async () => {
    const c = h.client({ ip: '198.51.100.36' });
    await seen(c, batch([view('NOW', 7_200_000), view('LIVE', 10_800_000), view('LIVE', 4_000_000), view('MODEL', 1_800_499)]));
    expect((await rowsOf(c)).rows.map((r) => [r.page, r.seconds])).toEqual([
      [VIEW_PAGE_CODES.NOW, 1_800],
      [VIEW_PAGE_CODES.LIVE, 10_800],
      [VIEW_PAGE_CODES.LIVE, 4_000],
      [VIEW_PAGE_CODES.MODEL, 1_800],
    ]);
  });

  it('resolves the subjects: a slug, a variant’s slug, a serial, a release; anything unknown is kept without one', async () => {
    const catalog = await seedCatalog(h.ctx);
    const slug = `seen-${randomUUID().slice(0, 8)}`;
    await h.ctx.db.updateTable('models').set({ slug, lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z'), variant_label: 'Steel', variant_swatch: '#8A8D8F' }).where('id', '=', catalog.modelId).execute();
    const variant = await h.ctx.db
      .insertInto('models')
      .values({ category_id: (await h.ctx.categories.getByCode('J'))!.index, name: 'MONOLITHE', type: 'RING', sku_prefix: `SV-${randomUUID().slice(0, 6)}`, slug: `${slug}-blue`, lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z'), variant_of: catalog.modelId, variant_label: 'Blue', variant_swatch: '#1F3A93' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const serial = (await issue(h.ctx, catalog)).product.productId;
    const drop = await h.ctx.db
      .insertInto('drops')
      .values({ model_id: catalog.modelId, title: 'SEEN 0042', quantity: 8, opens_at: new Date('2026-11-01T10:00:00Z'), closes_at: new Date('2026-11-02T10:00:00Z'), seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(32) })
      .returning('id')
      .executeTakeFirstOrThrow();
    // The subject maps are read again every 5 minutes: move past the earlier tests' reads.
    h.clock.advance(5 * 60_000 + 1);
    const c = h.client({ ip: '198.51.100.37' });
    await seen(
      c,
      batch([
        view('MODEL', 2_000, { s: slug }),
        view('MODEL', 2_000, { s: `${slug}-blue` }),
        view('MODEL', 2_000, { s: 'no-such-model' }),
        view('PIECE', 2_000, { s: serial.toLowerCase() }),
        view('RELEASE', 2_000, { s: drop.id.toUpperCase() }),
        view('LIVE', 2_000, { s: randomUUID() }),
        view('POST', 2_000, { s: 'not-a-uuid' }),
        view('NOW', 2_000, { s: slug }),
      ]),
    );
    expect((await rowsOf(c)).rows.map((r) => r.subject)).toEqual([catalog.modelId, variant.id, null, catalog.modelId, drop.id, null, null, null]);
  });

  it('keeps at most 2 000 rows a device a Paris day, then drops the rest', async () => {
    const tracking = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now });
    const meta = metaOf('C'.repeat(43));
    let recorded = 0;
    for (let i = 0; i < 41; i++) recorded += (await tracking.ingest(batch(Array.from({ length: 50 }, () => view('NOW'))), meta)).recorded;
    expect(recorded).toBe(DEVICE_DAILY_CAP);
    expect(await tracking.ingest(batch([view('NOW')]), meta)).toEqual({ recorded: 0, dropped: 'CAP' });
    // The next Paris day (midnight Paris is 22:00 UTC in October), the device records again.
    expect((await tracking.ingest(batch([view('NOW')]), { ...meta, now: new Date('2026-10-09T22:00:00.000Z') })).recorded).toBe(1);
    await tracking.stop();
    const device = await h.ctx.db.selectFrom('tracking_devices').select('id').where('device_hash', '=', 'C'.repeat(43)).executeTakeFirstOrThrow();
    expect(Number((await h.ctx.db.selectFrom('collector_views').select((eb) => eb.fn.countAll().as('n')).where('device_id', '=', device.id).executeTakeFirstOrThrow()).n)).toBe(DEVICE_DAILY_CAP + 1);
  });

  it('puts a flush off while the pool has requests waiting, drops the oldest past its bound with one warning a minute, and writes what is left at shutdown', async () => {
    let waiting = true;
    const warnings: string[] = [];
    const log: Logger = { info: () => {}, warn: (_o, msg) => void warnings.push(String(msg)), error: () => {} };
    const tracking = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now, log, waiting: () => waiting, bufferMaxRows: 3 });
    const meta = metaOf('D'.repeat(43));
    await tracking.ingest(batch([view('NOW', 1_000), view('CLUB', 2_000)]), meta);
    expect(await tracking.buffer.flush()).toEqual({ written: 0, deferred: true, failed: false });
    await tracking.ingest(batch([view('HOW', 3_000), view('RELEASES', 4_000)]), meta);
    expect(tracking.buffer.peek().map((r) => r.seconds)).toEqual([2, 3, 4]);
    await tracking.ingest(batch([view('CIRCLE', 5_000)]), meta);
    expect(tracking.buffer.peek().map((r) => r.seconds)).toEqual([3, 4, 5]);
    expect(warnings).toEqual(['views buffer full; oldest rows dropped']);
    h.clock.advance(60_000);
    await tracking.ingest(batch([view('NOW', 6_000)]), meta);
    expect(warnings).toHaveLength(2);
    const device = await h.ctx.db.selectFrom('tracking_devices').select('id').where('device_hash', '=', 'D'.repeat(43)).executeTakeFirstOrThrow();
    const count = async () => (await h.ctx.db.selectFrom('collector_views').select('seconds').where('device_id', '=', device.id).orderBy('id').execute()).map((r) => r.seconds);
    expect(await count()).toEqual([]);
    // The pool is free again: the next flush writes.
    waiting = false;
    expect(await tracking.buffer.flush()).toEqual({ written: 3, deferred: false, failed: false });
    expect(await count()).toEqual([4, 5, 6]);
    // The shutdown writes even while the pool waits.
    waiting = true;
    await tracking.ingest(batch([view('NOW', 7_000)]), meta);
    await tracking.stop();
    expect(await count()).toEqual([4, 5, 6, 7]);
    expect(BUFFER_FLUSH_AT).toBe(500);
  });

  it('keeps every row through a database that is down, however many flushes fail, and drops only rows PostgreSQL refuses for their data', async () => {
    const tracking = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now });
    await tracking.ingest(batch([view('NOW')]), metaOf('E'.repeat(43)));
    await tracking.stop();
    const device = await h.ctx.db.selectFrom('tracking_devices').select('id').where('device_hash', '=', 'E'.repeat(43)).executeTakeFirstOrThrow();
    // The INSERT of `collector_views` throws `fail()` while `failing` is above 0; everything else is the real database.
    let failing = 0;
    let fail: () => Error = () => new Error('unset');
    const db = new Proxy(h.ctx.db, {
      get(target, prop) {
        if (prop === 'insertInto')
          return (table: 'collector_views') => {
            const qb = target.insertInto(table);
            return {
              values: (v: Parameters<typeof qb.values>[0]) => {
                const q = qb.values(v);
                return { execute: async () => (failing-- > 0 ? Promise.reject(fail()) : q.execute()) };
              },
            };
          };
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as Db;
    const errors: string[] = [];
    const log: Logger = { info: () => {}, warn: () => {}, error: (_o, msg) => void errors.push(String(msg)) };
    const buffer = new ViewBuffer({ db, clock: h.clock.now, log, waiting: () => false });
    const row = (seconds: number): BufferedView => ({ at: h.clock.now(), deviceId: device.id, accountId: null, page: VIEW_PAGE_CODES.NOW, subject: null, seconds, placeId: null });
    const written = async () => (await h.ctx.db.selectFrom('collector_views').select('seconds').where('device_id', '=', device.id).where('seconds', '>=', 100).orderBy('seconds').execute()).map((r) => r.seconds);

    // The database down (a refused connection, as pg throws it) six times in a row: every row is kept, then written.
    fail = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    buffer.push([row(101), row(102), row(103)]);
    failing = FLUSH_MAX_ATTEMPTS + 1;
    for (let i = 0; i < FLUSH_MAX_ATTEMPTS + 1; i++) expect(await buffer.flush()).toEqual({ written: 0, deferred: false, failed: true });
    expect(buffer.size).toBe(3);
    // An administrator's shutdown of the server (57P01) is not the rows' fault either.
    fail = () => Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    failing = FLUSH_MAX_ATTEMPTS;
    for (let i = 0; i < FLUSH_MAX_ATTEMPTS; i++) await buffer.flush();
    expect(buffer.size).toBe(3);
    expect(await buffer.flush()).toEqual({ written: 3, deferred: false, failed: false });
    expect(await written()).toEqual([101, 102, 103]);
    expect(errors).toEqual([]);

    // Rows PostgreSQL refuses (a foreign key violation, 23503): kept FLUSH_MAX_ATTEMPTS − 1 times, then dropped, logged.
    fail = () => Object.assign(new Error('insert or update on table "collector_views" violates foreign key constraint'), { code: '23503' });
    buffer.push([row(104)]);
    failing = FLUSH_MAX_ATTEMPTS;
    for (let i = 0; i < FLUSH_MAX_ATTEMPTS - 1; i++) await buffer.flush();
    expect(buffer.size).toBe(1);
    await buffer.flush();
    expect(buffer.size).toBe(0);
    expect(errors).toEqual(['views flush failed; rows dropped']);
    expect(await written()).toEqual([101, 102, 103]);

    // Which errors count as the rows' own: SQLSTATE classes 22 and 23 only.
    expect(['22001', '22P02', '23505', '23514'].map((code) => isDataRejection({ code }))).toEqual([true, true, true, true]);
    expect(['57P01', '08006', '53300', 'ECONNREFUSED', 'ETIMEDOUT'].map((code) => isDataRejection({ code }))).toEqual([false, false, false, false, false]);
    expect(isDataRejection(new Error('Connection terminated unexpectedly'))).toBe(false);
  });

  /** A request's meta for TrackingService.ingest called directly: an iPhone in Paris, no session. */
  function metaOf(deviceHash: string): SeenMeta {
    return { deviceHash, account: null, staff: false, ip: '198.51.100.50', userAgent: IPHONE, headers: {}, place: { country: 'FR', city: 'Paris' }, now: h.clock.now() };
  }

  it('names its origin as the app does', () => {
    expect(ORIGIN).toBe(h.ctx.config.publicOrigin);
  });
});
