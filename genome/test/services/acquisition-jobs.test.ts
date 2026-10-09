/**
 * Where they come from, the daily work (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.8 and A.15
 * « acquisition-jobs.test.ts », step 4.5; services/acquisition-jobs.ts, run by the housekeeping):
 *
 *  - acquisitionConversions: a conversion for each sign-up, draw entry, LIVE RELEASE entry and LIVE, DRAW and SALON
 *    order, judged at the act's moment (an order of a draw at its entry, of a LIVE RELEASE at its room entry, of the
 *    salon at its request, the LIVE entry's second piece at its entry); a GIFT order never; a salon request accepted
 *    three days after it was made gets its conversion at the next pass, judged at the request; a request made before
 *    the recording started reads BEFORE; a test entrant never; a sign-up only once 5 minutes old, with its first source
 *    written by JOB (Direct) when the attach wrote none (the safety net of a failed attach), never over the attach's;
 *    a pass repeated writes nothing; a row that committed within the hour behind the watermark is found; an order made
 *    with a past reservation behind the watermark is caught by the daily catch-up (morning window, once a Paris day)
 *    and not before; a backlog over 1,000 resumes across passes, the watermark at the last row written;
 *  - acquisitionDaily, then acquisitionPurge: the complete Paris days' visits, arrivals and first visits (Direct
 *    included, a device first seen at 22:30 UTC in its Paris day) in `acquisition_daily`, at most 31 days a pass, a day
 *    repeated giving the same figures; a visit past 13 months purged only once its day is summarised; the devices
 *    purged only after their visits;
 *  - the housekeeping: its keys in the order of §3.0 (f), the jobs' counts, and no purge in a pass whose summary failed.
 * The EXCHANGE order's last link and the supplementary invoices are step 4.11's cases.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHousekeeping } from '../../src/server/context.js';
import type { Db } from '../../src/server/db/connection.js';
import { CONVERSIONS_BATCH, DAILY_MAX_DAYS, recordConversions, summariseDays, purgeTouches } from '../../src/server/services/acquisition-jobs.js';
import { AcquisitionService } from '../../src/server/services/acquisition.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { GrowthWorld } from '../support/growth.js';
import { createHarness, type Harness } from '../api/support.js';

const ORIGIN = 'https://verify.theorbes.com';
const START = new Date('2026-06-01T08:00:00.000Z');
const z = (iso: string) => new Date(iso);

/** A link and its source, a site's source, a device: as the app leaves them. */
function fixtures(db: () => Db) {
  let seq = 0;
  return {
    async admin(): Promise<string> {
      const email = `jobs-${++seq}@orbes.test`;
      return (await db().insertInto('admin_users').values({ email, email_normalized: email, password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id;
    },
    async link(code: string, admin: string): Promise<number> {
      const channel = (await db().selectFrom('link_channels').select('id').orderBy('position').executeTakeFirstOrThrow()).id;
      const l = await db().insertInto('links').values({ code, name: code, channel_id: channel, destination: 'NOW', created_by: admin }).returning('id').executeTakeFirstOrThrow();
      return (await db().insertInto('acquisition_sources').values({ kind: 'LINK', link_id: l.id, key: `L:${l.id}` }).returning('id').executeTakeFirstOrThrow()).id;
    },
    async site(host: string): Promise<number> {
      return (await db().insertInto('acquisition_sources').values({ kind: 'SITE', site: host, key: `S:${host}` }).returning('id').executeTakeFirstOrThrow()).id;
    },
    async fixed(key: string): Promise<number> {
      return (await db().selectFrom('acquisition_sources').select('id').where('key', '=', key).executeTakeFirstOrThrow()).id;
    },
    async device(firstSeen: Date, firstSource: number | null = null): Promise<number> {
      const hash = `${String(++seq).padStart(6, '0')}${'j'.repeat(37)}`;
      return (await db().insertInto('tracking_devices').values({ device_hash: hash, first_seen_at: firstSeen, last_seen_at: firstSeen, first_source_id: firstSource }).returning('id').executeTakeFirstOrThrow()).id;
    },
    async touch(device: number, source: number, day: string, at: Date, account: string | null = null, arrivals = 1): Promise<void> {
      await db().insertInto('acquisition_touches').values({ device_id: device, source_id: source, day, first_at: at, last_at: at, arrivals, account_id: account }).execute();
    },
  };
}

describe('acquisitionConversions (§3.4 A.5, A.8 item 1)', () => {
  let t: TestDb;
  let w: GrowthWorld;
  const x = fixtures(() => t.db);
  const ids: Record<string, string> = {};
  const src: Record<string, number> = {};

  beforeAll(async () => {
    t = await createTestDb();
    await new AcquisitionService({ db: t.db, publicOrigin: ORIGIN, clock: () => START }).prepare();
    w = await new GrowthWorld(t.db).prepare();
    const admin = await x.admin();
    src.bio = await x.link('jobs-bio', admin);
    src.story = await x.link('jobs-story', admin);
    src.vogue = await x.site('vogue.fr');
    src.direct = await x.fixed('DIRECT');
    src.before = await x.fixed('BEFORE');
    const model = await w.model('MONOLITHE', { price: [48_000, 'EUR'] });
    // A, created 2 June at 12:00 UTC: Instagram bio that morning, Vogue on 4 June, the story on 9 June.
    ids.a = await w.account('2026-06-02', 'FR');
    const phone = await x.device(z('2026-06-02T09:00:00Z'), src.bio);
    await x.touch(phone, src.bio, '2026-06-02', z('2026-06-02T09:00:00Z'), ids.a);
    await x.touch(phone, src.vogue, '2026-06-04', z('2026-06-04T12:00:00Z'), ids.a);
    await x.touch(phone, src.story, '2026-06-09', z('2026-06-09T09:00:00Z'), ids.a);
    // B: its attach wrote its first source and SIGNUP already.
    ids.b = await w.account('2026-06-02', 'FR');
    await t.db.insertInto('account_sources').values({ account_id: ids.b, first_source_id: src.story, first_seen_at: z('2026-06-02T11:00:00Z'), set_at: z('2026-06-02T12:00:00Z'), set_by: 'SIGN_UP' }).execute();
    await t.db.insertInto('acquisition_conversions').values({ kind: 'SIGNUP', ref_id: ids.b, account_id: ids.b, at: z('2026-06-02T12:00:00Z'), last_source_id: src.story }).execute();
    // A test entrant, with an entry.
    ids.entrant = await w.account('2026-06-02', null);
    await t.db.insertInto('test_entrants').values({ account_id: ids.entrant }).execute();
    // A draw: A enters on 3 June; its order is confirmed on 6 June, after Vogue.
    const draw = await w.drop({ mode: 'DRAW', modelId: model, title: 'DRAW', opens: '2026-06-03', quantity: 10 });
    ids.drawEntry = await w.drawEntry(draw.id, ids.a, 'CONFIRMED', '2026-06-03');
    ids.drawOrder = await w.order({ accountId: ids.a, modelId: model, channel: 'DRAW', dropId: draw.id, dropEntryId: ids.drawEntry, paid: '2026-06-06', total: 48_000, currency: 'EUR' });
    ids.entrantEntry = await w.drawEntry(draw.id, ids.entrant, 'ENTERED', '2026-06-03');
    // A welcome gift travelling with the draw's order: never a conversion.
    const grant = await w.giftGrant(ids.a, model, '2026-06-06');
    ids.gift = await w.order({ accountId: ids.a, modelId: model, channel: 'GIFT', withOrderId: ids.drawOrder, giftGrantId: grant, paid: '2026-06-06', total: 0, currency: 'EUR' });
    // A LIVE RELEASE: A joins its room on 5 June at 11:50 UTC (after Vogue), two pieces.
    const live = await w.drop({ mode: 'LIVE', modelId: model, title: 'LIVE', opens: '2026-06-05', quantity: 3 });
    ids.liveEntry = await w.liveEntry(live, ids.a, '2026-06-05');
    ids.liveOrder = await w.order({ accountId: ids.a, modelId: model, channel: 'LIVE', dropId: live.id, liveEntryId: ids.liveEntry, paid: '2026-06-05', total: 48_000, currency: 'EUR' });
    // Its second piece travels with the first (as LiveService leaves it: the same entry, piece 2).
    ids.liveSecond = (
      await sql<{ id: string }>`
        INSERT INTO orders (channel, live_entry_id, piece, drop_id, account_id, model_id, price_minor, currency, status, reserved_at, paid_at, location_id, with_order_id)
        SELECT channel, live_entry_id, 2, drop_id, account_id, model_id, price_minor, currency, status, reserved_at, paid_at, location_id, id FROM orders WHERE id = ${ids.liveOrder}
        RETURNING id`.execute(t.db)
    ).rows[0]!.id;
    // The salon: a request on 7 June accepted on 10 June (the story came between); a request before the recording.
    ids.salon = await salonOrder(ids.a, model, z('2026-06-07T12:00:00Z'), z('2026-06-10T11:00:00Z'));
    ids.salonBefore = await salonOrder(ids.a, model, z('2026-05-30T12:00:00Z'), z('2026-06-10T11:00:00Z'));
    // C signs up at 22:20 UTC on 10 June and its attach failed: the job's safety net.
    ids.c = (await t.db.insertInto('accounts').values({ email: 'c@example.com', email_normalized: 'c@example.com', password_hash: 'x', created_at: z('2026-06-10T22:20:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    ids.model = model;
  });
  afterAll(() => t?.close());

  /** A salon order of `account`, its request made at `requested` and accepted (the order reserved) at `reserved`. */
  const salonOrder = async (account: string, model: string, requested: Date, reserved: Date): Promise<string> => {
    const request = await t.db
      .insertInto('shop_requests')
      .values({ account_id: account, model_id: model, status: 'CLOSED', created_at: requested, handled_at: reserved, outcome: 'ACCEPTED' })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (
      await t.db
        .insertInto('orders')
        .values({ channel: 'SALON', account_id: account, model_id: model, shop_request_id: request.id, price_minor: 12_000, currency: 'EUR', status: 'PAID', reserved_at: reserved, paid_at: new Date(reserved.getTime() + 3_600_000), location_id: w.location })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  };
  const conversion = async (kind: string, ref: string) =>
    t.db.selectFrom('acquisition_conversions').select(['account_id', 'at', 'last_source_id']).where('kind', '=', kind as 'ORDER').where('ref_id', '=', ref).executeTakeFirst();
  const state = () => t.db.selectFrom('acquisition_state').selectAll().executeTakeFirstOrThrow();

  it('writes each act once, judged at its moment, at the first pass after it was written; never a GIFT order nor a test entrant\'s', async () => {
    // 22:23 UTC on 10 June: 00:23 in Paris, outside the morning window (no catch-up).
    const first = await recordConversions(t.db, z('2026-06-10T22:23:00Z'));
    expect(first.catchUp).toBe(false);
    expect(await conversion('SIGNUP', ids.a!)).toEqual({ account_id: ids.a, at: z('2026-06-02T12:00:00Z'), last_source_id: src.bio });
    expect(await conversion('DRAW_ENTRY', ids.drawEntry!)).toEqual({ account_id: ids.a, at: z('2026-06-03T12:00:00Z'), last_source_id: src.bio });
    // The draw's order is judged at its entry (3 June), not at its confirmation after Vogue.
    expect(await conversion('ORDER', ids.drawOrder!)).toEqual({ account_id: ids.a, at: z('2026-06-03T12:00:00Z'), last_source_id: src.bio });
    expect(await conversion('LIVE_ENTRY', ids.liveEntry!)).toEqual({ account_id: ids.a, at: z('2026-06-05T11:50:00Z'), last_source_id: src.vogue });
    expect(await conversion('ORDER', ids.liveOrder!)).toEqual({ account_id: ids.a, at: z('2026-06-05T11:50:00Z'), last_source_id: src.vogue });
    expect(await conversion('ORDER', ids.liveSecond!)).toEqual({ account_id: ids.a, at: z('2026-06-05T11:50:00Z'), last_source_id: src.vogue });
    // The salon order accepted 3 days after its request: judged at the request (Vogue), not at its acceptance (the story).
    expect(await conversion('ORDER', ids.salon!)).toEqual({ account_id: ids.a, at: z('2026-06-07T12:00:00Z'), last_source_id: src.vogue });
    // A request made before the recording started: Before tracking.
    expect(await conversion('ORDER', ids.salonBefore!)).toEqual({ account_id: ids.a, at: z('2026-05-30T12:00:00Z'), last_source_id: src.before });
    expect(await conversion('ORDER', ids.gift!)).toBeUndefined();
    expect(await conversion('SIGNUP', ids.entrant!)).toBeUndefined();
    expect(await conversion('DRAW_ENTRY', ids.entrantEntry!)).toBeUndefined();
    // B's attach wrote its own: kept as it was.
    expect(await conversion('SIGNUP', ids.b!)).toEqual({ account_id: ids.b, at: z('2026-06-02T12:00:00Z'), last_source_id: src.story });
    // C is 3 minutes old: the attach's to write, not yet the job's.
    expect(await conversion('SIGNUP', ids.c!)).toBeUndefined();
    // A's sign-up, its two entries and five orders.
    expect(first.written).toBe(8);
    expect((await state()).conversions_until).toEqual(z('2026-06-10T22:22:00Z'));
  });

  it('writes a sign-up its attach missed once 5 minutes old, with its first source by JOB (Direct), never over the attach\'s', async () => {
    const pass = await recordConversions(t.db, z('2026-06-10T22:30:00Z'));
    expect(pass.written).toBe(1);
    expect(await conversion('SIGNUP', ids.c!)).toEqual({ account_id: ids.c, at: z('2026-06-10T22:20:00Z'), last_source_id: src.direct });
    const sources = await t.db.selectFrom('account_sources').select(['account_id', 'first_source_id', 'set_by']).where('account_id', 'in', [ids.a!, ids.b!, ids.c!]).orderBy('set_by').execute();
    expect(sources).toEqual(
      expect.arrayContaining([
        { account_id: ids.a, first_source_id: src.direct, set_by: 'JOB' },
        { account_id: ids.b, first_source_id: src.story, set_by: 'SIGN_UP' },
        { account_id: ids.c, first_source_id: src.direct, set_by: 'JOB' },
      ]),
    );
    // A pass repeated writes nothing.
    expect(await recordConversions(t.db, z('2026-06-10T22:31:00Z'))).toEqual({ written: 0, caughtUp: 0, catchUp: false });
  });

  it('finds a row that committed within the hour behind the watermark; an order with a past reservation waits for the daily catch-up, once a Paris day', async () => {
    const draw = await w.drop({ mode: 'DRAW', modelId: ids.model!, title: 'LATE', opens: '2026-06-10', quantity: 10 });
    const late = (await t.db.insertInto('drop_entries').values({ drop_id: draw.id, account_id: ids.a!, created_at: z('2026-06-10T22:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    const past = await salonOrder(ids.a!, ids.model!, z('2026-06-01T12:00:00Z'), z('2026-06-02T11:00:00Z'));
    // 06:00 UTC on 11 June: outside the morning window. The entry 30 minutes behind the watermark is found; the order
    // reserved on 2 June, far behind it, is not.
    expect(await recordConversions(t.db, z('2026-06-11T06:00:00Z'))).toEqual({ written: 1, caughtUp: 0, catchUp: false });
    expect(await conversion('DRAW_ENTRY', late)).toMatchObject({ last_source_id: src.story });
    expect(await conversion('ORDER', past)).toBeUndefined();
    // 08:00 UTC: the morning window; the catch-up finds it, judged at its request (1 June, 12:00 UTC: after the start,
    // before any visit of A's: Direct).
    const morning = await recordConversions(t.db, z('2026-06-11T08:00:00Z'));
    expect(morning).toEqual({ written: 0, caughtUp: 1, catchUp: true });
    expect(await conversion('ORDER', past)).toMatchObject({ at: z('2026-06-01T12:00:00Z'), last_source_id: src.direct });
    expect((await state()).catch_up_on).toBe('2026-06-11');
    // Once a Paris day.
    expect((await recordConversions(t.db, z('2026-06-11T09:00:00Z'))).catchUp).toBe(false);
  });

  it('a backlog over 1,000 resumes across passes, the watermark at the last row written', async () => {
    const b = await createTestDb();
    try {
      await new AcquisitionService({ db: b.db, publicOrigin: ORIGIN, clock: () => START }).prepare();
      await sql`
        INSERT INTO accounts (email, email_normalized, password_hash, created_at)
        SELECT 'bulk-' || g || '@example.com', 'bulk-' || g || '@example.com', 'x', ${START}::timestamptz + make_interval(secs => g)
          FROM generate_series(1, ${CONVERSIONS_BATCH + 5}) g`.execute(b.db);
      const first = await recordConversions(b.db, z('2026-06-01T22:30:00Z'));
      expect(first.written).toBe(CONVERSIONS_BATCH);
      const watermark = (await b.db.selectFrom('acquisition_state').select('conversions_until').executeTakeFirstOrThrow()).conversions_until;
      expect(watermark).toEqual(new Date(START.getTime() + CONVERSIONS_BATCH * 1000));
      const second = await recordConversions(b.db, z('2026-06-01T22:40:00Z'));
      expect(second.written).toBe(5);
      expect((await b.db.selectFrom('acquisition_state').select('conversions_until').executeTakeFirstOrThrow()).conversions_until).toEqual(z('2026-06-01T22:39:00Z'));
      expect(Number((await b.db.selectFrom('acquisition_conversions').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n)).toBe(CONVERSIONS_BATCH + 5);
    } finally {
      await b.close();
    }
  });

  it('does nothing before the recording\'s state row exists', async () => {
    const b = await createTestDb();
    try {
      expect(await recordConversions(b.db, z('2026-06-11T08:00:00Z'))).toEqual({ written: 0, caughtUp: 0, catchUp: false });
      expect(await summariseDays(b.db, z('2026-06-11T08:00:00Z'))).toBe(0);
      expect(await purgeTouches(b.db, z('2026-06-11T08:00:00Z'))).toBe(0);
    } finally {
      await b.close();
    }
  });
});

describe('acquisitionDaily, acquisitionPurge and the housekeeping (§3.4 A.8 items 2 and 3, §3.0 (f))', () => {
  let h: Harness;
  const x = fixtures(() => h.t.db);
  const NOW = z('2026-10-09T08:00:00Z');
  const devices: Record<string, number> = {};
  const src: Record<string, number> = {};

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW);
    await h.t.db.updateTable('acquisition_state').set({ tracking_started_at: z('2025-08-01T08:00:00Z'), conversions_until: z('2025-08-01T08:00:00Z'), daily_until: null, catch_up_on: null }).execute();
    src.bio = await x.link('daily-bio', await x.admin());
    src.vogue = await x.site('vogue.fr');
    src.direct = await x.fixed('DIRECT');
    // 2 August 2025 (Paris): a device through the link, three arrivals; one from Vogue at 22:00 Paris.
    devices.one = await x.device(z('2025-08-02T10:00:00Z'), src.bio);
    await x.touch(devices.one, src.bio, '2025-08-02', z('2025-08-02T10:00:00Z'), null, 3);
    devices.two = await x.device(z('2025-08-02T20:00:00Z'), src.vogue);
    await x.touch(devices.two, src.vogue, '2025-08-02', z('2025-08-02T20:00:00Z'));
    // 22:30 UTC on 2 August is 3 August in Paris: a Direct first visit, no visit row.
    devices.three = await x.device(z('2025-08-02T22:30:00Z'), src.direct);
    // A visit on 5 September 2025 (past 13 months on 9 October 2026: the first day kept is 9 September 2025), one on 20 September.
    await x.touch(devices.one, src.bio, '2025-09-05', z('2025-09-05T10:00:00Z'));
    await x.touch(devices.two, src.vogue, '2025-09-20', z('2025-09-20T10:00:00Z'));
  });
  afterAll(() => h?.close());

  const daily = async () =>
    (await h.t.db.selectFrom('acquisition_daily').selectAll().where('day', '<=', '2025-08-31').orderBy('day').orderBy('source_id').execute()).map((r) => ({ ...r }));
  const touchDays = async () => (await h.t.db.selectFrom('acquisition_touches').select('day').orderBy('day').execute()).map((r) => r.day);
  const deviceIds = async () => new Set((await h.t.db.selectFrom('tracking_devices').select('id').execute()).map((r) => r.id));

  it('summarises each complete Paris day once, at most 31 a pass, the same figures when repeated; nothing before 07:30 UTC', async () => {
    expect(await summariseDays(h.t.db, z('2026-10-09T07:29:00Z'))).toBe(0);
    expect(await summariseDays(h.t.db, NOW)).toBe(DAILY_MAX_DAYS);
    expect((await h.t.db.selectFrom('acquisition_state').select('daily_until').executeTakeFirstOrThrow()).daily_until).toBe('2025-08-31');
    const expected = [
      { source_id: src.bio, day: '2025-08-02', visits: 1, first_visits: 1, arrivals: 3 },
      { source_id: src.vogue, day: '2025-08-02', visits: 1, first_visits: 1, arrivals: 1 },
      { source_id: src.direct, day: '2025-08-03', visits: 0, first_visits: 1, arrivals: 0 },
    ].sort((a, b) => a.day.localeCompare(b.day) || a.source_id - b.source_id);
    expect(await daily()).toEqual(expected);
    // A day summarised again gives the same figures.
    await h.t.db.updateTable('acquisition_state').set({ daily_until: '2025-08-01' }).execute();
    expect(await summariseDays(h.t.db, NOW, { maxDays: 1 })).toBe(1);
    expect(await daily()).toEqual(expected);
    await h.t.db.updateTable('acquisition_state').set({ daily_until: '2025-08-31' }).execute();
  });

  it('purges a visit past 13 months only once its day is summarised, and the devices only after their visits', async () => {
    expect(await purgeTouches(h.t.db, NOW)).toBe(2);
    // 5 September is past 13 months but not summarised yet: kept.
    expect(await touchDays()).toEqual(['2025-09-05', '2025-09-20']);
    // The Direct device has no visit: it goes; the others are still named by a visit.
    expect(await h.ctx.services.tracking.purgeDevices(NOW)).toBe(1);
    const left = await deviceIds();
    expect([devices.one, devices.two].every((id) => left.has(id!))).toBe(true);
    expect(left.has(devices.three!)).toBe(false);
    // Summarised through yesterday, over several passes.
    while ((await summariseDays(h.t.db, NOW)) > 0);
    expect((await h.t.db.selectFrom('acquisition_state').select('daily_until').executeTakeFirstOrThrow()).daily_until).toBe('2026-10-08');
    expect(await purgeTouches(h.t.db, NOW, { batch: 1 })).toBe(1);
    expect(await touchDays()).toEqual(['2025-09-20']);
    expect(await h.ctx.services.tracking.purgeDevices(NOW)).toBe(1);
    expect((await deviceIds()).has(devices.one!)).toBe(false);
    // The summary keeps what the visits were.
    expect(await daily()).toHaveLength(3);
  });

  it('runs every pass in the order of §3.0 (f) with the jobs\' counts, and purges no visit in a pass whose summary failed', async () => {
    const old = await x.device(z('2025-08-10T10:00:00Z'), src.bio);
    await x.touch(old, src.bio, '2025-08-10', z('2025-08-10T10:00:00Z'));
    const account = (await h.t.db.insertInto('accounts').values({ email: 'hk@example.com', email_normalized: 'hk@example.com', password_hash: 'x', created_at: z('2026-10-09T07:00:00Z') }).returning('id').executeTakeFirstOrThrow()).id;
    const acquisition = h.ctx.services.acquisition;
    const original = acquisition.summariseDays;
    acquisition.summariseDays = async () => {
      throw new Error('the summary failed');
    };
    const hk = startHousekeeping(h.ctx, { intervalMs: 3_600_000 });
    try {
      const failed = await hk.runOnce();
      expect(Object.keys(failed)).toEqual([
        'sessions', 'transfers', 'scanTokens', 'scanStats', 'activity', 'acquisitionConversions', 'viewStats', 'viewMonths', 'acquisitionDaily', 'wishMonths', 'scanHistory', 'viewPurge', 'acquisitionPurge', 'wishHistory', 'devicePurge', 'liveNetworks', 'careLabels', 'packingPhotos', 'sizes',
      ]);
      expect(failed).toMatchObject({ acquisitionDaily: 0, acquisitionPurge: 0 });
      // The conversions run every pass: the new account's SIGNUP.
      expect(failed.acquisitionConversions).toBeGreaterThanOrEqual(1);
      expect(await h.t.db.selectFrom('acquisition_conversions').select('ref_id').where('kind', '=', 'SIGNUP').where('ref_id', '=', account).execute()).toHaveLength(1);
      expect(await h.t.db.selectFrom('acquisition_touches').select('id').where('device_id', '=', old).execute()).toHaveLength(1);
      acquisition.summariseDays = original;
      const pass = await hk.runOnce();
      expect(pass.acquisitionPurge).toBe(1);
      expect(await h.t.db.selectFrom('acquisition_touches').select('id').where('device_id', '=', old).execute()).toEqual([]);
    } finally {
      acquisition.summariseDays = original;
      await hk.stop();
    }
  });
});
