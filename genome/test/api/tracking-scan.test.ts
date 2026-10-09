/**
 * Scans in the recording (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.3 T.8.3 recordScan, T.6 table 10, T.11 and T.14
 * « tracking-scan.test.ts », step 3.6; the plan's test/server/ folder is test/api/ here):
 *
 *  - a scan writes a SCAN row (page 1, its piece's model, 0 seconds, its place) for its device, after its answer: the
 *    answer never waits for it;
 *  - a staff scan (ADMIN_TEST) writes none and marks the device; a test entrants' network and an automated agent none;
 *  - a signed-in scan carries its account; an anonymous scan is attached at a later CREATE ACCOUNT;
 *  - prepare() creates the one `tracking_state` row once; backfillScans() turns the 13 months of scans before it into
 *    devices and SCAN rows by keyset batches: run twice, the same counts and the second does nothing; a failure after
 *    the first batch resumes after it on the next boot, with no scan written twice or skipped; scans from the start on
 *    are left to recordScan; staff scans, robots, scans without a device, scans older than 13 months, the team's own
 *    account's scans and a browser marked staff's (before the batch is read, or while it is written) are left out.
 * The verify route's own tests (public.test.ts, verification/) are unchanged.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { pseudonymize } from '../../src/server/http/client.js';
import { TrackingService } from '../../src/server/services/tracking.js';
import { accountClient, createAdmin, createHarness, issue, PASSWORD, seedCatalog, type Catalog, type Client, type Harness } from './support.js';

describe('recordScan and the past scans (plan CUSTOMER INTELLIGENCE §3.3 T.8.3, T.11)', () => {
  let h: Harness;
  let catalog: Catalog;
  /** recordScan, watched: the route calls it from onResponse, after the answer, so a test waits for the call. */
  let recorded: MockInstance<TrackingService['recordScan']>;

  beforeAll(async () => {
    h = await createHarness({ config: { trustProxy: true, geo: { mode: 'cloudflare' } } });
    h.clock.set('2026-10-09T10:00:00.000Z');
    catalog = await seedCatalog(h.ctx);
    recorded = vi.spyOn(h.ctx.services.tracking, 'recordScan');
  });
  afterAll(() => h?.close());

  const tracking = () => h.ctx.services.tracking;
  /** A scan by `c`, answered; then, unless `wait` is false, its recording ended. */
  const scan = async (c: Client, headers: Record<string, string> = {}, wait = true) => {
    const piece = await issue(h.ctx, catalog);
    const calls = recorded.mock.calls.length;
    const res = await c.request('POST', '/api/v1/verify', { body: { code: piece.code.data }, headers: { 'cf-ipcountry': 'IT', 'cf-ipcity': 'Milan', ...headers } });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(() => expect(recorded.mock.calls.length).toBe(calls + 1));
    if (wait) await tracking().idle();
    return (res.json() as { scanId: string }).scanId;
  };
  const deviceHashOf = (c: Client) => pseudonymize(h.ctx.config.ipHashPepper, 'device', h.app.unsignCookie(c.cookies.get('orbes_device')!).value!);
  const scanRows = async () =>
    h.ctx.db
      .selectFrom('collector_views as v')
      .innerJoin('tracking_devices as d', 'd.id', 'v.device_id')
      .select(['v.at', 'v.page', 'v.subject', 'v.seconds', 'v.account_id', 'v.place_id', 'd.device_hash'])
      .where('v.page', '=', VIEW_PAGE_CODES.SCAN)
      .orderBy('v.id')
      .execute();

  it('writes a SCAN row with its model, its device and its place once the scan is answered, the answer never waiting for it', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    const original = TrackingService.prototype.recordScan;
    recorded.mockImplementationOnce(async function (this: TrackingService, id, meta) {
      await gate;
      return original.call(tracking(), id, meta);
    });
    {
      const c = h.client({ ip: '198.51.100.80' });
      const scanId = await scan(c, {}, false);
      // Answered, while the row waits.
      const call = recorded.mock.calls.length - 1;
      expect(recorded.mock.calls[call]![0]).toBe(scanId);
      expect(await scanRows()).toEqual([]);
      open();
      await recorded.mock.results[call]!.value;
      const occurred = (await h.ctx.db.selectFrom('scan_events').select('occurred_at').where('id', '=', scanId).executeTakeFirstOrThrow()).occurred_at;
      const place = await h.ctx.db.selectFrom('geo_places').select('id').where('country', '=', 'IT').where('city', '=', 'Milan').executeTakeFirstOrThrow();
      expect(await scanRows()).toEqual([{ at: occurred, page: 1, subject: catalog.modelId, seconds: 0, account_id: null, place_id: place.id, device_hash: deviceHashOf(c) }]);
      expect(await h.ctx.db.selectFrom('tracking_devices').select(['kind', 'os', 'browser']).where('device_hash', '=', deviceHashOf(c)).executeTakeFirstOrThrow()).toEqual({ kind: 'PHONE', os: 'IOS', browser: 'SAFARI' });
      // scan_events carries no city.
      expect(Object.keys(await h.ctx.db.selectFrom('scan_events').selectAll().where('id', '=', scanId).executeTakeFirstOrThrow())).not.toContain('city');
    }
  });

  it('writes none for a staff scan (ADMIN_TEST) and marks the device; none from the test entrants’ networks or an automated agent', async () => {
    const before = (await scanRows()).length;
    const c = h.client({ ip: '198.51.100.81' });
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    expect((await c.post('/api/admin/auth/login', { email: admin.email, password: PASSWORD })).statusCode).toBe(200);
    const staffScan = await scan(c);
    expect((await h.ctx.db.selectFrom('scan_events').select('event_type').where('id', '=', staffScan).executeTakeFirstOrThrow()).event_type).toBe('ADMIN_TEST');
    await scan(h.client({ ip: '100.64.1.2' }));
    await scan(h.client({ ip: '198.51.100.82' }), { 'user-agent': 'curl/8.4.0' });
    expect(await scanRows()).toHaveLength(before);
    expect((await h.ctx.db.selectFrom('tracking_devices').select('staff_at').where('device_hash', '=', deviceHashOf(c)).executeTakeFirstOrThrow()).staff_at).not.toBeNull();
  });

  it('carries the account of a signed-in scan, and attaches an anonymous scan at a later CREATE ACCOUNT', async () => {
    const { client, email } = await accountClient(h, { ip: '198.51.100.83' });
    const me = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
    const mine = await scan(client);
    const anon = h.client({ ip: '198.51.100.84' });
    const theirs = await scan(anon);
    // Each device's SCAN rows (the manual clock gives every scan here the same instant).
    const rowsOf = async (c: Client) => (await scanRows()).filter((r) => r.device_hash === deviceHashOf(c)).map((r) => r.account_id);
    expect(mine).not.toBe(theirs);
    expect(await rowsOf(client)).toEqual([me]);
    expect(await rowsOf(anon)).toEqual([null]);
    h.clock.advance(60_000);
    const res = await anon.post('/api/v1/account/register', { email: `scan-${randomUUID().slice(0, 8)}@example.com`, password: PASSWORD, firstName: 'Scan', lastName: 'Test', country: 'IT' });
    expect(res.statusCode).toBe(201);
    const them = (await h.ctx.db.selectFrom('tracking_devices').select('account_id').where('device_hash', '=', deviceHashOf(anon)).executeTakeFirstOrThrow()).account_id;
    expect(them).not.toBeNull();
    expect(await rowsOf(anon)).toEqual([them]);
  });

  describe('prepare() and the past scans', () => {
    const START = new Date('2026-10-09T08:00:00.000Z');
    let accountId: string;
    let teamId: string;
    let productId: string;
    const ids: Record<string, string> = {};

    async function past(key: string, o: { at: string; device?: string | null; type?: 'VERIFY' | 'ADMIN_TEST'; family?: string | null; country?: string | null; account?: boolean | string }) {
      ids[key] = (
        await h.ctx.db
          .insertInto('scan_events')
          .values({
            occurred_at: new Date(o.at),
            product_id: productId,
            event_type: o.type ?? 'VERIFY',
            device_hash: o.device === undefined ? `${key.toUpperCase().padEnd(43, 'x')}`.slice(0, 43) : o.device,
            account_id: typeof o.account === 'string' ? o.account : o.account ? accountId : null,
            country: o.country === undefined ? 'FR' : o.country,
            user_agent_family: o.family === undefined ? 'Safari/iOS' : o.family,
            result_state: 'AUTHENTIC',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    const pastRows = async () =>
      h.ctx.db
        .selectFrom('collector_views as v')
        .innerJoin('tracking_devices as d', 'd.id', 'v.device_id')
        .leftJoin('geo_places as g', 'g.id', 'v.place_id')
        .select(['v.at', 'v.subject', 'v.account_id', 'v.seconds', 'g.country', 'g.city', 'd.device_hash', 'd.kind', 'd.os', 'd.browser'])
        .where('v.page', '=', VIEW_PAGE_CODES.SCAN)
        .where('v.at', '<', START)
        .orderBy('v.at')
        .execute();

    beforeAll(async () => {
      const { email } = await accountClient(h, { ip: '198.51.100.85' });
      accountId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
      productId = (await issue(h.ctx, catalog)).product.id;
      // The team's own account: its email is a console login's.
      const team = await accountClient(h, { ip: '198.51.100.86' });
      await h.ctx.db.insertInto('admin_users').values({ email: team.email, email_normalized: team.email.toLowerCase(), password_hash: 'scrypt$x', role: 'AUDITOR' }).execute();
      teamId = (await h.ctx.db.selectFrom('accounts').select('id').where('email', '=', team.email).executeTakeFirstOrThrow()).id;
      // A browser already marked staff (it opened the console).
      await tracking().markStaff('MARKED'.padEnd(43, 'x'), new Date('2026-10-08T10:00:00.000Z'));
      // The harness's boot (createContext) wrote the row at its own start; the recording here starts at START instead.
      expect(await h.ctx.db.selectFrom('tracking_state').select(['id', 'scans_backfilled_at']).execute()).toEqual([{ id: 1, scans_backfilled_at: null }]);
      await h.ctx.db.deleteFrom('tracking_state').execute();
      await past('a1', { at: '2026-10-01T10:00:00.000Z' });
      await past('a2', { at: '2026-10-02T10:00:00.000Z', device: 'A1'.padEnd(43, 'x') }); // the same device as a1
      await past('b1', { at: '2026-09-15T10:00:00.000Z', family: 'Chrome/Android', country: 'DE', account: true });
      await past('c1', { at: '2025-09-09T10:00:00.000Z', family: null, country: null }); // the oldest day kept: 9 Sep 2025
      await past('d1', { at: '2026-08-01T10:00:00.000Z' });
      await past('staff', { at: '2026-10-03T10:00:00.000Z', type: 'ADMIN_TEST', device: null });
      await past('bot', { at: '2026-10-03T11:00:00.000Z', family: 'Bot/Linux' });
      await past('nodevice', { at: '2026-10-03T12:00:00.000Z', device: null });
      await past('old', { at: '2025-09-08T21:00:00.000Z' }); // 23:00 Paris on 8 Sep 2025: before the 13 months
      await past('after', { at: '2026-10-09T09:00:00.000Z' }); // after the start: recordScan's
      await past('team', { at: '2026-10-04T10:00:00.000Z', account: teamId }); // the team's own account
      await past('marked', { at: '2026-10-04T11:00:00.000Z', device: 'MARKED'.padEnd(43, 'x') }); // a browser marked staff
      await past('late', { at: '2026-10-05T10:00:00.000Z', country: 'NL' }); // marked staff while its batch is written
    });

    it('creates the one tracking_state row once, at the first boot', async () => {
      expect(await tracking().prepare(START)).toEqual({ startedAt: START });
      expect(await tracking().prepare(new Date('2026-10-10T08:00:00Z'))).toEqual({ startedAt: START });
      expect(await h.ctx.db.selectFrom('tracking_state').selectAll().execute()).toEqual([{ id: 1, started_at: START, scans_after_at: null, scans_after_id: null, scans_backfilled_at: null }]);
    });

    it('turns them into devices and SCAN rows by keyset batches, resumes after a failure without writing a scan twice or skipping one, and runs once', async () => {
      // The first boot fails on its second batch (its place cannot be read): the first batch is kept, with the watermark.
      let failDe = true;
      const places = {
        idOf: async (country: string | null | undefined, city?: string | null) => {
          if (country === 'DE' && failDe) throw new Error('database unavailable');
          // Between the batch's read and its transaction, the browser of « late » opens the console.
          if (country === 'NL') await tracking().markStaff('LATE'.padEnd(43, 'x'));
          return h.ctx.services.places.idOf(country, city);
        },
      };
      const firstBoot = new TrackingService({ db: h.ctx.db, places, clock: h.clock.now });
      await expect(firstBoot.backfillScans({ batchSize: 2 })).rejects.toThrow('database unavailable');
      // The first batch (c1, d1) is written; the second (b1 in DE, a1) failed before its transaction.
      expect((await pastRows()).map((r) => r.at.toISOString())).toEqual(['2025-09-09T10:00:00.000Z', '2026-08-01T10:00:00.000Z']);
      const state = await h.ctx.db.selectFrom('tracking_state').selectAll().executeTakeFirstOrThrow();
      expect(state.scans_after_id).toBe(ids.d1);
      expect(state.scans_backfilled_at).toBeNull();

      // The next boot resumes after it.
      failDe = false;
      const nextBoot = new TrackingService({ db: h.ctx.db, places, clock: h.clock.now });
      // b1 and a1, then a2 and « late » (read, then left out), then an empty batch: done.
      expect(await nextBoot.backfillScans({ batchSize: 2 })).toEqual({ batches: 3, scans: 4, done: true });
      const rows = await pastRows();
      expect(rows.map((r) => ({ at: r.at.toISOString(), account: r.account_id, subject: r.subject, seconds: r.seconds, country: r.country, city: r.city, device: r.device_hash.slice(0, 2), class: [r.kind, r.os, r.browser] }))).toEqual([
        { at: '2025-09-09T10:00:00.000Z', account: null, subject: catalog.modelId, seconds: 0, country: null, city: null, device: 'C1', class: ['UNKNOWN', 'OTHER', 'OTHER'] },
        { at: '2026-08-01T10:00:00.000Z', account: null, subject: catalog.modelId, seconds: 0, country: 'FR', city: null, device: 'D1', class: ['UNKNOWN', 'IOS', 'SAFARI'] },
        { at: '2026-09-15T10:00:00.000Z', account: accountId, subject: catalog.modelId, seconds: 0, country: 'DE', city: null, device: 'B1', class: ['UNKNOWN', 'ANDROID', 'CHROME'] },
        { at: '2026-10-01T10:00:00.000Z', account: null, subject: catalog.modelId, seconds: 0, country: 'FR', city: null, device: 'A1', class: ['UNKNOWN', 'IOS', 'SAFARI'] },
        { at: '2026-10-02T10:00:00.000Z', account: null, subject: catalog.modelId, seconds: 0, country: 'FR', city: null, device: 'A1', class: ['UNKNOWN', 'IOS', 'SAFARI'] },
      ]);
      // One device for a1 and a2, first and last seen at its scans.
      expect(await h.ctx.db.selectFrom('tracking_devices').select(['first_seen_at', 'last_seen_at']).where('device_hash', '=', 'A1'.padEnd(43, 'x')).executeTakeFirstOrThrow()).toEqual({
        first_seen_at: new Date('2026-10-01T10:00:00.000Z'),
        last_seen_at: new Date('2026-10-02T10:00:00.000Z'),
      });
      // The scan after the start is recordScan's: never backfilled.
      expect((await h.ctx.db.selectFrom('collector_views').select('id').where('at', '=', new Date('2026-10-09T09:00:00.000Z')).execute())).toEqual([]);
      const done = await h.ctx.db.selectFrom('tracking_state').selectAll().executeTakeFirstOrThrow();
      expect(done.scans_after_id).toBe(ids.late);
      // The team's own account, a browser marked staff before and one marked while its batch was written: no row.
      const left = await h.ctx.db
        .selectFrom('collector_views as v')
        .innerJoin('tracking_devices as d', 'd.id', 'v.device_id')
        .select('d.device_hash')
        .where((eb) => eb.or([eb('v.account_id', '=', teamId), eb('d.device_hash', 'in', ['TEAM'.padEnd(43, 'x'), 'MARKED'.padEnd(43, 'x'), 'LATE'.padEnd(43, 'x')])]))
        .execute();
      expect(left).toEqual([]);
      expect((await h.ctx.db.selectFrom('tracking_devices').select('staff_at').where('device_hash', '=', 'LATE'.padEnd(43, 'x')).executeTakeFirstOrThrow()).staff_at).not.toBeNull();
      expect(done.scans_backfilled_at).toEqual(h.clock.now());

      // A later boot does nothing.
      const later = new TrackingService({ db: h.ctx.db, places: h.ctx.services.places, clock: h.clock.now });
      expect(await later.backfillScans({ batchSize: 2 })).toEqual({ batches: 0, scans: 0, done: true });
      expect(await pastRows()).toHaveLength(5);
    });

    it('is attached with the browsing at a later sign-in: the past anonymous scan of a device becomes its account’s', async () => {
      const a1 = 'A1'.padEnd(43, 'x');
      await tracking().link(a1, accountId, 'SIGN_IN');
      expect((await pastRows()).filter((r) => r.device_hash === a1).map((r) => r.account_id)).toEqual([accountId, accountId]);
    });
  });
});
