/**
 * The engagement score's figures and rows (plan CUSTOMER INTELLIGENCE §3.5 SB.3.1, SB.3.3, SB.3.5, SB.3.7, step 7.3;
 * services/engagement.ts `inputsFor` and `scoreBatch`, participation.ts `releaseEntries`, growth.ts `purchaseRows`), on
 * PGlite with the clock fixed at 2 November 2026, 09:00 Paris:
 *
 *  - each act counted from its own table: a scan from its SCAN row (an anonymous one once attached to the account), a
 *    draw entry whatever its status, a LIVE RELEASE entry, I'LL BE THERE, an order (a cancelled one too), a piece
 *    registered; a GIFT or EXCHANGE order, a piece given by ORBES and a page view never; two acts at one instant;
 *    the window's edges (exactly 365 days old: outside);
 *  - the active days on the Paris calendar (23:59 and 00:01 Paris are two days; the 25-hour day is one);
 *  - the spend from paid orders less credit notes, a registered piece at its base price, a piece without a price,
 *    pounds converted, a cancelled or returned order and a purchase before the window left out;
 *  - the release speed: a place reserved before the opening and a room joined before T0 count 0, whole minutes, the
 *    median over an even and an odd count, an after-room with its own opening under its release;
 *  - the attendance: a restricted release counted only when taken, none open, an account created mid-window;
 *  - `releaseEntries` gives the pairs `participationRows` gives;
 *  - `scoreBatch`: ACTIVE accounts only, never a test entrant; a LOCKED account's row untouched; an unchanged row keeps
 *    its `changed_at`; a row of another formula is rewritten; a batch larger than one statement.
 * The daily job (`runIfDue`: the claim, the clean-up, the bands) is test/services/engagement-job.test.ts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jsonText, VIEW_PAGE_CODES } from '../../src/server/db/schema.js';
import { ENGAGEMENT_FORMULA, scoreOf, type EngagementInputs } from '../../src/server/services/engagement-formula.js';
import { ENGAGEMENT_BATCH, windowStart, type EngagementService } from '../../src/server/services/engagement.js';
import { participationRows, releaseEntries } from '../../src/server/services/participation.js';
import { createHarness, type Harness } from '../api/support.js';
import { GrowthWorld } from '../support/growth.js';

const NOW = new Date('2026-11-02T08:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('the engagement score\'s figures (plan CUSTOMER INTELLIGENCE §3.5 SB.3.1)', () => {
  let h: Harness;
  let w: GrowthWorld;
  let svc: EngagementService;
  const db = () => h.t.db;
  const m: Record<string, string> = {};
  const d: Record<string, { id: string; sizeId: string | null }> = {};
  const positions = new Map<string, number>();
  let invoiceSeq = 700_000;

  const account = (created = '2025-01-01', status: 'ACTIVE' | 'LOCKED' | 'DELETED' = 'ACTIVE') => w.account(created, 'FR', status);
  const inputs = async (id: string, now: Date = NOW): Promise<EngagementInputs> => {
    const i = (await svc.inputsFor(db(), [id], now)).get(id);
    expect(i, id).toBeDefined();
    return i!;
  };
  const device = async (): Promise<{ id: number; hash: string }> => {
    const hash = randomBytes(32).toString('base64url').slice(0, 43);
    const row = await db().insertInto('tracking_devices').values({ device_hash: hash, kind: 'PHONE', os: 'IOS', browser: 'SAFARI', opened_in: 'BROWSER', in_app: null, first_seen_at: at('2026-01-01T10:00:00Z'), last_seen_at: at('2026-01-01T10:00:00Z') }).returning('id').executeTakeFirstOrThrow();
    return { id: row.id, hash };
  };
  const view = async (deviceId: number, accountId: string | null, iso: string, page: number = VIEW_PAGE_CODES.SCAN) => {
    await db().insertInto('collector_views').values({ at: at(iso), device_id: deviceId, account_id: accountId, page, subject: null, seconds: page === VIEW_PAGE_CODES.SCAN ? 0 : 30, place_id: null }).execute();
  };
  /** A scan of the account at `iso`, on a device of its own. */
  const scan = async (accountId: string, iso: string) => view((await device()).id, accountId, iso);
  /** A draw's entry made at `iso`: ENTERED, WITHDRAWN, or a place reserved directly in the early access (SELECTED at once). */
  const drawEntry = async (drop: { id: string }, accountId: string, status: 'ENTERED' | 'WITHDRAWN' | 'SELECTED', iso: string) => {
    const reserved = status === 'SELECTED';
    await db().insertInto('drop_entries').values({ drop_id: drop.id, account_id: accountId, created_at: at(iso), status, tier: reserved ? 2 : null, seniority: reserved ? 0 : null, respond_by: reserved ? new Date(at(iso).getTime() + 2 * 86_400_000) : null }).execute();
  };
  /** A LIVE RELEASE's entry joined at `iso`: in the line (its place given), WAITING without a place, or REMOVED from the line. */
  const liveEntry = async (drop: { id: string; sizeId: string | null }, accountId: string, iso: string, state: 'LINE' | 'WAITING' | 'REMOVED' = 'LINE') => {
    const joined = at(iso);
    const position = (positions.get(drop.id) ?? 0) + 1;
    positions.set(drop.id, position);
    const later = new Date(joined.getTime() + 60_000);
    await db()
      .insertInto('live_entries')
      .values({
        drop_id: drop.id, account_id: accountId, size_id: drop.sizeId!, quantity: 1, tier: 0, joined_at: joined,
        ...(state === 'WAITING' ? { status: 'WAITING' as const, position: null } : { position, queued_at: later }),
        ...(state === 'LINE' ? { status: 'QUEUED' as const } : {}),
        ...(state === 'REMOVED' ? { status: 'REMOVED' as const, removed_at: later, ended_at: later } : {}),
      })
      .execute();
  };
  /** A draw opened at 12:00 UTC of `opens`, published the day before and already run (its seed revealed): an entry still in it took part. */
  const drawnDraw = async (title: string, opens: string): Promise<{ id: string; sizeId: null }> => {
    const seed = randomBytes(32);
    const opensAt = at(`${opens}T12:00:00.000Z`);
    const closesAt = new Date(opensAt.getTime() + 3_600_000);
    const row = await db()
      .insertInto('drops')
      .values({
        model_id: m.ring!, title, quantity: 50, opens_at: opensAt, closes_at: closesAt, mode: 'DRAW', early_access_hours: 48, published_at: new Date(opensAt.getTime() - 86_400_000),
        seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`, seed_hash: new Uint8Array(createHash('sha256').update(seed).digest()), seed: new Uint8Array(seed), drawn_at: new Date(closesAt.getTime() + 60_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id, sizeId: null };
  };
  const invoice = async (orderId: string, kind: 'INVOICE' | 'CREDIT_NOTE', issued: Date, total: number, more: { credits?: string; scope?: 'FULL' | 'LINES'; currency?: string } = {}) =>
    (
      await db()
        .insertInto('invoices')
        .values({
          kind, year: issued.getUTCFullYear(), sequence: ++invoiceSeq, order_id: orderId, credits_invoice_id: more.credits ?? null, credit_scope: kind === 'CREDIT_NOTE' ? (more.scope ?? 'FULL') : null,
          issuer: jsonText({ name: 'CONGLOMERAT LLC' }), buyer: jsonText({ name: null }), lines: jsonText([{ kind: 'PIECE', label: 'LINE', detail: null, amountMinor: total }]),
          currency: more.currency ?? 'EUR', subtotal_minor: total, total_minor: total, issued_at: issued,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(NOW.toISOString());
    svc = h.ctx.services.engagement;
    w = await new GrowthWorld(db()).prepare();
    m.ring = await w.model('MONOLITHE', { price: [30_000, 'EUR'] });
    m.pound = await w.model('AURA', { price: [10_000, 'GBP'] });
    m.bare = await w.model('ORBIT');
    const collection = (await db().insertInto('collections').values({ name: 'ORBITAL' }).returning('id').executeTakeFirstOrThrow()).id;

    // The releases of this file, each opened at 12:00 UTC (the draws D1, D2 and the one before the window have run): in
    // the window, three are open to every collector.
    d.old = await drawnDraw('BEFORE THE WINDOW', '2025-10-01');
    d.D1 = await drawnDraw('D1', '2026-06-01');
    d.L1 = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'L1', opens: '2026-07-01', quantity: 50 });
    d.AR = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'L1 AFTER-ROOM', opens: '2026-07-01', quantity: 50, parentId: d.L1.id });
    d.tier = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'PLATINE ONLY', opens: '2026-08-01', quantity: 50 });
    d.part = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'ONE RELEASE BEFORE', opens: '2026-08-10', quantity: 50 });
    d.models = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'OWNERS OF A MODEL', opens: '2026-08-20', quantity: 50 });
    d.coll = await w.drop({ mode: 'LIVE', modelId: m.ring!, title: 'OWNERS OF A COLLECTION', opens: '2026-08-25', quantity: 50 });
    d.draft = await w.drop({ mode: 'DRAW', modelId: m.ring!, title: 'DRAFT', opens: '2026-09-01', quantity: 5, published: false });
    d.cancelled = await w.drop({ mode: 'DRAW', modelId: m.ring!, title: 'CANCELLED', opens: '2026-09-05', quantity: 5, cancelled: true });
    d.D2 = await drawnDraw('D2', '2026-10-01');
    d.ahead = await w.drop({ mode: 'DRAW', modelId: m.ring!, title: 'AHEAD', opens: '2026-12-01', quantity: 5 });
    await db().updateTable('drops').set({ opens_at: at('2026-07-01T13:00:00Z'), closes_at: at('2026-07-01T13:15:00Z') }).where('id', '=', d.AR.id).execute();
    await db().updateTable('drops').set({ live_min_tier: 2 }).where('id', '=', d.tier.id).execute();
    await db().updateTable('drops').set({ min_participations: 1 }).where('id', '=', d.part.id).execute();
    await db().insertInto('live_access_models').values({ drop_id: d.models.id, model_id: m.ring! }).execute();
    await db().updateTable('drops').set({ access_collection_id: collection }).where('id', '=', d.coll.id).execute();
  });
  afterAll(() => h?.close());

  it('reads the releases open to every collector once: published, never cancelled, in the window, no after-room, no access rule', async () => {
    const open = await svc.openReleases(db(), NOW);
    expect(open.map((o) => o.id)).toEqual([d.D1!.id, d.L1!.id, d.D2!.id]);
    expect(open[0]!.opensAt).toEqual(at('2026-06-01T12:00:00Z'));
    expect(windowStart(NOW)).toEqual(at('2025-11-02T08:00:00.000Z'));
    expect(ENGAGEMENT_BATCH).toBe(500);
    // Nothing asked, nothing read; an unknown account has no figures.
    expect((await svc.inputsFor(db(), [], NOW)).size).toBe(0);
    expect((await svc.inputsFor(db(), ['5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6'], NOW)).size).toBe(0);
  });

  it('counts each act from its own table, the latest with its kind', async () => {
    const a: Record<string, string> = {};
    for (const k of ['scan', 'draw', 'live', 'interest', 'order', 'registration', 'nothing']) a[k] = await account();
    await scan(a.scan!, '2026-10-30T10:00:00Z');
    await drawEntry(d.D1!, a.draw!, 'WITHDRAWN', '2026-06-02T09:00:00Z'); // entering is the act, even withdrawn
    await liveEntry(d.L1!, a.live!, '2026-07-01T11:58:00Z', 'WAITING');
    await db().insertInto('live_interest').values({ drop_id: d.L1!.id, account_id: a.interest!, size_id: d.L1!.sizeId!, created_at: at('2026-06-28T09:00:00Z') }).execute();
    await w.order({ accountId: a.order!, modelId: m.ring!, channel: 'SALON', paid: '2026-05-10', total: 30_000, currency: 'EUR', status: 'CANCELLED', ended: '2026-05-12' });
    await w.own(a.registration!, await w.piece(m.bare!), 'RESALE', '2026-04-04');

    expect(await inputs(a.scan!)).toMatchObject({ lastActAt: at('2026-10-30T10:00:00Z'), lastActKind: 'SCAN', activeDays: 1 });
    expect(await inputs(a.draw!)).toMatchObject({ lastActAt: at('2026-06-02T09:00:00Z'), lastActKind: 'DRAW', activeDays: 1, speedReleases: 0, releasesTaken: 0 });
    expect(await inputs(a.live!)).toMatchObject({ lastActAt: at('2026-07-01T11:58:00Z'), lastActKind: 'LIVE', activeDays: 1, speedReleases: 0, releasesTaken: 0 });
    expect(await inputs(a.interest!)).toMatchObject({ lastActAt: at('2026-06-28T09:00:00Z'), lastActKind: 'INTEREST', activeDays: 1 });
    // An order cancelled after its reservation: still an act (reserved an hour before it was paid), never a purchase.
    expect(await inputs(a.order!)).toMatchObject({ lastActAt: at('2026-05-10T11:00:00Z'), lastActKind: 'ORDER', activeDays: 1, purchases: 0, spendEurMinor: 0 });
    // A piece bought from another collector is registered (an act), and is no purchase from ORBES.
    expect(await inputs(a.registration!)).toMatchObject({ lastActAt: at('2026-04-04T12:00:00Z'), lastActKind: 'REGISTRATION', activeDays: 1, purchases: 0 });
    expect(await inputs(a.nothing!)).toEqual({
      lastActAt: null, lastActKind: null, activeDays: 0, spendEurMinor: 0, purchases: 0, unpriced: 0, otherCurrencies: [], speedMinutes: null, speedReleases: 0, releasesTaken: 0, releasesOpen: 3,
    });
  });

  it('never counts a GIFT or EXCHANGE order, a piece given by ORBES, a page view or what is not the account\'s', async () => {
    const a = await account();
    const other = await account();
    const piece = await w.piece(m.ring!);
    const salon = await w.order({ accountId: a, modelId: m.ring!, channel: 'SALON', paid: '2026-03-01', total: 30_000, currency: 'EUR', productId: piece });
    const grant = await w.giftGrant(a, m.bare!, '2026-03-05');
    await w.order({ accountId: a, modelId: m.bare!, channel: 'GIFT', paid: '2026-03-10', total: 0, currency: 'EUR', withOrderId: salon, giftGrantId: grant });
    const original = await db().selectFrom('orders').selectAll().where('id', '=', salon).executeTakeFirstOrThrow();
    await db()
      .insertInto('orders')
      .values({ channel: 'EXCHANGE', exchange_of_order_id: original.id, drop_id: null, account_id: a, model_id: original.model_id, price_minor: original.price_minor, currency: original.currency, status: 'RESERVED', reserved_at: at('2026-03-20T10:00:00Z'), location_id: original.location_id })
      .execute();
    await w.own(a, await w.piece(m.bare!), 'ADMIN', '2026-03-25');
    const dev = await device();
    await view(dev.id, a, '2026-03-30T10:00:00Z', VIEW_PAGE_CODES.MODEL);
    await scan(other, '2026-04-02T10:00:00Z');
    // Only the salon order's reservation is an act.
    expect(await inputs(a)).toMatchObject({ lastActAt: at('2026-03-01T11:00:00Z'), lastActKind: 'ORDER', activeDays: 1 });
  });

  it('counts an anonymous scan once it is attached to the account, at sign-up or sign-in', async () => {
    const a = await account('2026-10-01');
    const dev = await device();
    await view(dev.id, null, '2026-10-28T18:00:00Z');
    expect(await inputs(a)).toMatchObject({ lastActAt: null, lastActKind: null, activeDays: 0 });
    await h.ctx.services.tracking.link(dev.hash, a, 'SIGN_IN', NOW);
    expect(await inputs(a)).toMatchObject({ lastActAt: at('2026-10-28T18:00:00Z'), lastActKind: 'SCAN', activeDays: 1 });
  });

  it('settles two acts at one instant in the order SCAN, DRAW, LIVE, INTEREST, ORDER, REGISTRATION', async () => {
    const a = await account();
    const b = await account();
    await w.own(a, await w.piece(m.bare!), 'TRANSFER', '2026-09-09'); // 12:00 UTC
    await scan(a, '2026-09-09T12:00:00Z');
    expect(await inputs(a)).toMatchObject({ lastActAt: at('2026-09-09T12:00:00Z'), lastActKind: 'SCAN', activeDays: 1 });
    await w.order({ accountId: b, modelId: m.ring!, channel: 'SALON', paid: '2026-09-09', total: 30_000, currency: 'EUR', status: 'CANCELLED', ended: '2026-09-10' }); // reserved 11:00 UTC
    await drawEntry(d.D2!, b, 'WITHDRAWN', '2026-09-09T11:00:00Z');
    expect(await inputs(b)).toMatchObject({ lastActAt: at('2026-09-09T11:00:00Z'), lastActKind: 'DRAW', activeDays: 1 });
  });

  it('looks only inside the 12 months: an act exactly 365 days old is outside, one a millisecond later inside, one after now not yet', async () => {
    const edge = await account();
    const inside = await account();
    const ahead = await account();
    await scan(edge, '2025-11-02T08:00:00.000Z');
    await scan(inside, '2025-11-02T08:00:00.001Z');
    await scan(ahead, '2026-11-02T08:00:00.001Z');
    expect(await inputs(edge)).toMatchObject({ lastActAt: null, activeDays: 0 });
    expect(await inputs(inside)).toMatchObject({ lastActAt: at('2025-11-02T08:00:00.001Z'), lastActKind: 'SCAN', activeDays: 1 });
    expect(await inputs(ahead)).toMatchObject({ lastActAt: null, activeDays: 0 });
    // The same act, read a day later: 365 days and a day old, outside.
    expect(await inputs(inside, new Date(NOW.getTime() + 86_400_000))).toMatchObject({ lastActAt: null, activeDays: 0 });
    // Recency: the latest act 3 days before the run gives 25, and the score is the sum.
    const recent = await account();
    await scan(recent, '2026-10-30T08:00:00Z');
    expect(scoreOf(await inputs(recent), NOW).parts).toMatchObject({ recency: 25, frequency: 4 });
  });

  it('counts the active days on the Paris calendar', async () => {
    const two = await account();
    const one = await account();
    const long = await account();
    const many = await account();
    // 20 October 2026, summer time: 23:59 Paris and 00:01 Paris the next day are two days, two minutes apart.
    await scan(two, '2026-10-20T21:59:00Z');
    await scan(two, '2026-10-20T22:01:00Z');
    expect(await inputs(two)).toMatchObject({ activeDays: 2, lastActAt: at('2026-10-20T22:01:00Z') });
    // 28 October 2026, winter time: 00:30 Paris and 23:30 Paris are one day, on two UTC days.
    await scan(one, '2026-10-27T23:30:00Z');
    await scan(one, '2026-10-28T22:30:00Z');
    expect(await inputs(one)).toMatchObject({ activeDays: 1 });
    // 25 October 2026, the 25-hour day: 00:30 and 23:30 Paris are one day.
    await scan(long, '2026-10-24T22:30:00Z');
    await scan(long, '2026-10-25T22:30:00Z');
    expect(await inputs(long)).toMatchObject({ activeDays: 1 });
    // Several kinds of act on one day are one day; 12 days give the whole part.
    for (let day = 1; day <= 12; day++) await scan(many, `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`);
    await w.own(many, await w.piece(m.bare!), 'TRANSFER', '2026-09-12');
    const i = await inputs(many);
    expect(i.activeDays).toBe(12);
    expect(scoreOf(i, NOW).parts.frequency).toBe(20);
  });

  it('reads the spend as GROWTH counts purchases, in euros', async () => {
    const paid = await account();
    const registered = await account();
    const pounds = await account();
    const unpriced = await account();
    const before = await account();
    // A paid order of € 300 less a credit note of € 50 for a line; a returned order and a cancelled one beside it.
    const order = await w.order({ accountId: paid, modelId: m.ring!, channel: 'SALON', paid: '2026-02-01', total: 30_000, currency: 'EUR' });
    const main = await db().selectFrom('invoices').select('id').where('order_id', '=', order).where('kind', '=', 'INVOICE').executeTakeFirstOrThrow();
    await invoice(order, 'CREDIT_NOTE', at('2026-02-10T12:00:00Z'), 5_000, { credits: main.id, scope: 'LINES' });
    await w.order({ accountId: paid, modelId: m.ring!, channel: 'SALON', paid: '2026-02-15', total: 30_000, currency: 'EUR', status: 'RETURNED', ended: '2026-02-25' });
    await w.order({ accountId: paid, modelId: m.ring!, channel: 'SALON', paid: '2026-02-20', total: 30_000, currency: 'EUR', status: 'CANCELLED', ended: '2026-02-21' });
    expect(await inputs(paid)).toMatchObject({ spendEurMinor: 25_000, purchases: 1, unpriced: 0, otherCurrencies: [] });
    expect(scoreOf(await inputs(paid), NOW).parts.spend).toBe(13);
    // A piece registered with no order naming it: at its model's base price; one without a price is a purchase of € 0.
    await w.own(registered, await w.piece(m.ring!), 'FIRST_REGISTRATION', '2026-03-01');
    await w.own(registered, await w.piece(m.bare!), 'FIRST_REGISTRATION', '2026-03-02');
    expect(await inputs(registered)).toMatchObject({ spendEurMinor: 30_000, purchases: 2, unpriced: 1, otherCurrencies: [] });
    // £ 100 at 1.17 and € 70: € 187.
    await w.order({ accountId: pounds, modelId: m.pound!, channel: 'SALON', paid: '2026-04-01', total: 10_000, currency: 'GBP' });
    await w.order({ accountId: pounds, modelId: m.ring!, channel: 'SALON', paid: '2026-04-02', total: 7_000, currency: 'EUR' });
    expect(await inputs(pounds)).toMatchObject({ spendEurMinor: 18_700, purchases: 2, unpriced: 0, otherCurrencies: ['GBP'] });
    expect(scoreOf(await inputs(pounds), NOW).parts.spend).toBe(13);
    // Only a piece without a price: a purchase, 8 points.
    await w.own(unpriced, await w.piece(m.bare!), 'FIRST_REGISTRATION', '2026-05-05');
    const u = await inputs(unpriced);
    expect(u).toMatchObject({ spendEurMinor: 0, purchases: 1, unpriced: 1 });
    expect(scoreOf(u, NOW).parts.spend).toBe(8);
    // A purchase paid before the window: none.
    await w.order({ accountId: before, modelId: m.ring!, channel: 'SALON', paid: '2025-10-01', total: 30_000, currency: 'EUR' });
    expect(await inputs(before)).toMatchObject({ spendEurMinor: 0, purchases: 0, lastActAt: null });
  });

  it('reads the release speed: before the opening 0, whole minutes, the median, an after-room under its release', async () => {
    const early = await account();
    const even = await account();
    const odd = await account();
    const afterOnly = await account();
    const both = await account();
    // A place reserved in the early access, the day before T0, and the room joined two minutes before T0: 0 and 0.
    await drawEntry(d.D1!, early, 'SELECTED', '2026-05-31T12:00:00Z');
    await liveEntry(d.L1!, early, '2026-07-01T11:58:00Z');
    expect(await inputs(early)).toMatchObject({ speedMinutes: 0, speedReleases: 2 });
    expect(scoreOf(await inputs(early), NOW).parts.speed).toBe(10);
    // 4 minutes 30 (4 whole minutes) and 31 minutes 10 (31): the median of an even count is the middle of the two, 17.5, rounded.
    await drawEntry(d.D1!, even, 'ENTERED', '2026-06-01T12:04:30Z');
    await liveEntry(d.L1!, even, '2026-07-01T12:31:10Z');
    expect(await inputs(even)).toMatchObject({ speedMinutes: 18, speedReleases: 2 });
    expect(scoreOf(await inputs(even), NOW).parts.speed).toBe(7);
    // 2 minutes, 10 minutes and 3 hours: the middle one.
    await drawEntry(d.D1!, odd, 'ENTERED', '2026-06-01T12:02:00Z');
    await liveEntry(d.L1!, odd, '2026-07-01T12:10:00Z');
    await drawEntry(d.D2!, odd, 'ENTERED', '2026-10-01T15:00:00Z');
    expect(await inputs(odd)).toMatchObject({ speedMinutes: 10, speedReleases: 3 });
    // The after-room alone: its own opening (13:00), counted as the release it follows.
    await liveEntry(d.AR!, afterOnly, '2026-07-01T13:02:59Z');
    expect(await inputs(afterOnly)).toMatchObject({ speedMinutes: 2, speedReleases: 1, releasesTaken: 1 });
    // The room and its after-room: one release, by its earliest entry (5 minutes after the room's T0).
    await liveEntry(d.L1!, both, '2026-07-01T12:05:00Z');
    await liveEntry(d.AR!, both, '2026-07-01T13:01:00Z');
    expect(await inputs(both)).toMatchObject({ speedMinutes: 5, speedReleases: 1, releasesTaken: 1 });
  });

  it('reads the attendance: the releases taken out of those open to the collector', async () => {
    const one = await account();
    const restricted = await account();
    const waiting = await account();
    const mid = await account('2026-09-15');
    const late = await account('2026-10-15');
    const joinedLater = await account('2026-06-15');
    // One of the three releases open to all: a restricted release not taken never counts.
    await drawEntry(d.D1!, one, 'ENTERED', '2026-06-01T12:30:00Z');
    const i = await inputs(one);
    expect(i).toMatchObject({ releasesTaken: 1, releasesOpen: 3 });
    expect(scoreOf(i, NOW).parts.attendance).toBe(13);
    // A restricted release taken counts on both sides: 2 of 4. Each kind of restriction is one.
    await liveEntry(d.tier!, restricted, '2026-08-01T12:01:00Z');
    await drawEntry(d.D2!, restricted, 'ENTERED', '2026-10-01T12:01:00Z');
    expect(await inputs(restricted)).toMatchObject({ releasesTaken: 2, releasesOpen: 4 });
    expect(scoreOf(await inputs(restricted), NOW).parts.attendance).toBe(20);
    await liveEntry(d.part!, restricted, '2026-08-10T12:01:00Z');
    await liveEntry(d.models!, restricted, '2026-08-20T12:01:00Z');
    await liveEntry(d.coll!, restricted, '2026-08-25T12:01:00Z');
    expect(await inputs(restricted)).toMatchObject({ releasesTaken: 5, releasesOpen: 7 });
    // In the room without a place, removed from the line, withdrawn from a draw, or entered in a cancelled one: not taken.
    await liveEntry(d.L1!, waiting, '2026-07-01T11:50:00Z', 'WAITING');
    await liveEntry(d.tier!, waiting, '2026-08-01T12:00:00Z', 'REMOVED');
    await drawEntry(d.D2!, waiting, 'WITHDRAWN', '2026-10-01T12:10:00Z');
    await drawEntry(d.cancelled!, waiting, 'ENTERED', '2026-09-05T12:10:00Z');
    expect(await inputs(waiting)).toMatchObject({ releasesTaken: 0, releasesOpen: 3, speedReleases: 0, speedMinutes: null });
    // Created mid-window: only the releases opened since. Created after the last one: none open, no points.
    expect(await inputs(mid)).toMatchObject({ releasesTaken: 0, releasesOpen: 1 });
    const none = await inputs(late);
    expect(none).toMatchObject({ releasesTaken: 0, releasesOpen: 0 });
    expect(scoreOf(none, NOW).parts.attendance).toBe(0);
    // A draw opened before the account existed, entered since: it counts for the speed of entering, and on neither side
    // of the attendance (it was not among the releases opened to this account).
    await drawEntry(d.D1!, joinedLater, 'ENTERED', '2026-06-16T12:00:00Z');
    expect(await inputs(joinedLater)).toMatchObject({ releasesTaken: 0, releasesOpen: 2, speedReleases: 1, speedMinutes: 15 * 24 * 60 });
  });

  it('releaseEntries gives the same (account, release) pairs as participationRows, on every entry of this file', async () => {
    // One more, before the window: participationRows counts it, and so does releaseEntries from the beginning of time.
    const old = await account('2024-01-01');
    await drawEntry(d.old!, old, 'ENTERED', '2025-10-01T12:05:00Z');
    const accounts = (await db().selectFrom('accounts').select('id').execute()).map((r) => r.id);
    const pairs = (rows: { account_id: string; release_id: string }[]) => rows.map((r) => `${r.account_id} ${r.release_id}`).sort();
    const rule = pairs(await db().selectFrom(participationRows(db(), NOW).as('p')).select(['p.account_id', 'p.release_id']).execute());
    const all = await releaseEntries(db(), accounts, new Date(0), NOW);
    expect(pairs(all)).toEqual(rule);
    expect(rule.length).toBeGreaterThanOrEqual(15);
    expect(new Set(rule).size).toBe(rule.length);
    // An after-room's pair names the release it follows, never the after-room.
    expect(all.some((e) => e.release_id === d.AR!.id)).toBe(false);
    expect(all.find((e) => e.release_id === d.L1!.id && e.opens_at.getTime() === at('2026-07-01T13:00:00Z').getTime())?.release_opens_at).toEqual(at('2026-07-01T12:00:00Z'));
    // Inside the window: the same pairs but the release opened before it.
    const windowed = await releaseEntries(db(), accounts, windowStart(NOW), NOW);
    expect(pairs(windowed)).toEqual(rule.filter((p) => !p.endsWith(d.old!.id)));
    expect(windowed.length).toBe(all.length - 1);
    expect(await releaseEntries(db(), [], new Date(0), NOW)).toEqual([]);
    // The old release is outside every part of its account's score.
    expect(await inputs(old)).toMatchObject({ speedReleases: 0, releasesTaken: 0, releasesOpen: 3, lastActAt: null });
  });

  describe('scoreBatch (§3.5 SB.3.3)', () => {
    const rowOf = (id: string) => db().selectFrom('account_scores').selectAll().where('account_id', '=', id).executeTakeFirst();

    it('writes the score of each ACTIVE account that is not a test entrant, with the figures behind its five parts', async () => {
      const a = await account();
      const locked = await account('2025-01-01', 'LOCKED');
      const deleted = await account('2025-01-01', 'DELETED');
      const entrant = await account();
      await db().insertInto('test_entrants').values({ account_id: entrant }).execute();
      for (const id of [a, locked, deleted, entrant]) await scan(id, '2026-10-21T17:30:00Z');
      await drawEntry(d.D2!, a, 'ENTERED', '2026-10-01T12:04:00Z');
      await w.order({ accountId: a, modelId: m.pound!, channel: 'SALON', paid: '2026-10-05', total: 40_000, currency: 'GBP' });
      const r = await svc.scoreBatch([a, locked, deleted, entrant, '5a8f0f8e-1b2c-4d3e-8f90-a1b2c3d4e5f6'], NOW);
      // 20 (12 days ago) + 8 (3 days) + 18 (£ 400 = € 468) + 9 (4 minutes) + 13 (1 of 3).
      expect([...r.scores]).toEqual([[a, 68]]);
      expect(r.changed).toBe(1);
      expect(await rowOf(a)).toEqual({
        account_id: a, formula: ENGAGEMENT_FORMULA, score: 68, recency_points: 20, frequency_points: 8, spend_points: 18, speed_points: 9, attendance_points: 13,
        last_act_at: at('2026-10-21T17:30:00Z'), last_act_kind: 'SCAN', active_days: 3, spend_eur_minor: 46_800, purchases: 1, unpriced: 0, other_currencies: ['GBP'],
        speed_minutes: 4, speed_releases: 1, releases_taken: 1, releases_open: 3, changed_at: NOW,
      });
      for (const id of [locked, deleted, entrant]) expect(await rowOf(id), id).toBeUndefined();
      expect(await svc.scoreBatch([], NOW)).toEqual({ scores: new Map(), changed: 0 });

      // A row that did not change is not written: its changed_at stays; one that changed is rewritten alone.
      const b = await account();
      const later = new Date(NOW.getTime() + 3_600_000);
      expect((await svc.scoreBatch([a, b], later)).changed).toBe(1); // b's first row
      expect((await rowOf(a))!.changed_at).toEqual(NOW);
      expect((await rowOf(b))!).toMatchObject({ score: 0, last_act_at: null, last_act_kind: null, speed_minutes: null, other_currencies: [], releases_open: 3, changed_at: later });
      await scan(b, '2026-11-02T08:30:00Z');
      const third = new Date(NOW.getTime() + 7_200_000);
      const again = await svc.scoreBatch([a, b], third);
      expect(again.changed).toBe(1);
      expect([...again.scores]).toEqual([[a, 68], [b, 29]].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)));
      expect((await rowOf(a))!.changed_at).toEqual(NOW);
      expect((await rowOf(b))!).toMatchObject({ score: 29, recency_points: 25, frequency_points: 4, last_act_kind: 'SCAN', changed_at: third });

      // A LOCKED account keeps its row as it was: it is not recalculated.
      await db().updateTable('accounts').set({ status: 'LOCKED' }).where('id', '=', b).execute();
      await scan(b, '2026-11-01T10:00:00Z');
      const frozen = await svc.scoreBatch([a, b], third);
      expect(frozen).toEqual({ scores: new Map([[a, 68]]), changed: 0 });
      expect((await rowOf(b))!).toMatchObject({ score: 29, active_days: 1, changed_at: third });
      await db().updateTable('accounts').set({ status: 'ACTIVE' }).where('id', '=', b).execute();

      // A row made by another formula differs: the next batch rewrites it, whatever its values.
      await db().updateTable('account_scores').set({ formula: ENGAGEMENT_FORMULA + 1 }).where('account_id', '=', a).execute();
      const fourth = new Date(NOW.getTime() + 7_300_000);
      const bumped = await svc.scoreBatch([a], fourth);
      expect(bumped.changed).toBe(1);
      expect((await rowOf(a))!).toMatchObject({ formula: ENGAGEMENT_FORMULA, score: 68, changed_at: fourth });
    });

    it('writes a batch larger than one statement, each account once', async () => {
      const ids: string[] = [];
      for (let n = 0; n < 230; n++) ids.push(await account('2026-10-20'));
      await scan(ids[229]!, '2026-11-01T10:00:00Z');
      const r = await svc.scoreBatch(ids, NOW);
      expect(r.scores.size).toBe(230);
      expect(r.changed).toBe(230);
      const rows = await db().selectFrom('account_scores').select(['account_id', 'score']).where('account_id', 'in', ids).execute();
      expect(rows).toHaveLength(230);
      expect(rows.filter((x) => x.score === 0)).toHaveLength(229);
      expect(rows.find((x) => x.account_id === ids[229])!.score).toBe(29);
      expect((await svc.scoreBatch(ids, NOW)).changed).toBe(0);
    });
  });
});
