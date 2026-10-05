/**
 * The best time to open (plan LIVE RELEASE+, choice 10; services/activity.ts), with known figures:
 *
 *  - the count: the sign-ins (the audit log's account.login and account.register) and the scans of the public
 *    verification (never a staff scan) of every complete UTC hour, by country (the account's for a sign-in, the scan's
 *    own; ZZ unknown) and tier (the account's when the hour is counted; none for a scan without an account), no account
 *    in the table; each hour once, a pass repeated writing nothing new, an hour not complete left for later; a job of
 *    the housekeeping, before any purge of the scans;
 *  - the reading: by hour of the day in Paris time (summer and winter time alike), for a tier and above, everywhere
 *    or in one country; by tier; by country with its busiest hour; the past releases' presence at T0 by the hour they
 *    opened; the suggested hour and its share, the past presence breaking a tie; a release's T0 beside it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateActivity, ActivityService, bestTime, lastCompleteHour, parisHour, type ActivityCell } from '../../src/server/services/activity.js';
import { AuditService } from '../../src/server/services/audit.js';
import { createManualClock, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { accountOfTier, createLiveRelease, liveFixture, type LiveFixture } from '../support/live.js';

const H = 3_600_000;

describe('the hours of Paris and the hours counted', () => {
  it('reads a UTC instant as its hour in Paris, summer time and winter time', () => {
    expect(parisHour(new Date('2026-10-20T17:30:00Z'))).toBe(19); // CEST, UTC+2
    expect(parisHour(new Date('2026-11-03T18:10:00Z'))).toBe(19); // CET, UTC+1
    expect(parisHour(new Date('2026-03-29T00:30:00Z'))).toBe(1);
    expect(parisHour(new Date('2026-03-29T01:30:00Z'))).toBe(3); // the clocks went forward
    expect(parisHour(new Date('2026-10-25T23:00:00Z'))).toBe(0);
  });

  it('counts an hour once it ended ten minutes ago', () => {
    expect(lastCompleteHour(new Date('2026-11-10T12:09:59Z'))).toEqual(new Date('2026-11-10T11:00:00Z'));
    expect(lastCompleteHour(new Date('2026-11-10T12:10:00Z'))).toEqual(new Date('2026-11-10T12:00:00Z'));
  });
});

describe('the reading (pure)', () => {
  const window = { days: 1, from: new Date('2026-11-04T00:00:00Z'), to: new Date('2026-11-05T00:00:00Z') };
  const cell = (iso: string, country: string, tier: number, signIns: number, scans: number): ActivityCell => ({ hour: new Date(iso), country, tier, signIns, scans });

  it('suggests the busiest hour of the tiers chosen; on equal activity the hour where more were present at past T0s, then the earlier', () => {
    const cells = [cell('2026-11-04T07:00:00Z', 'FR', 1, 2, 0), cell('2026-11-04T18:00:00Z', 'FR', 1, 1, 1), cell('2026-11-04T09:00:00Z', 'FR', 0, 9, 0)];
    // 08:00 and 19:00 Paris tie at 2 for TITANE and above; a past release opened at 19:00 with one present breaks it.
    const past = [{ opensAt: new Date('2026-10-01T17:00:00Z'), presentByTier: [5, 1, 0, 0] }];
    const r = bestTime({ ...window, minTier: 1, country: null, cells, past });
    expect(r.total).toBe(4);
    expect(r.suggested).toEqual({ hour: 19, activity: 2, share: 0.5 });
    expect(r.hours[19]).toEqual({ hour: 19, signIns: 1, scans: 1, activity: 2, byTier: [0, 2, 0, 0], past: { releases: 1, present: 1 } });
    expect(r.hours[10]).toMatchObject({ activity: 0, byTier: [9, 0, 0, 0] });
    // Without the past release: the earlier hour.
    expect(bestTime({ ...window, minTier: 1, country: null, cells, past: [] }).suggested).toEqual({ hour: 8, activity: 2, share: 0.5 });
    // Everyone: 10:00 Paris (9 sign-ins of collectors without a tier).
    expect(bestTime({ ...window, minTier: 0, country: null, cells, past }).suggested).toEqual({ hour: 10, activity: 9, share: 9 / 13 });
    // Nothing counted: no suggestion.
    const none = bestTime({ ...window, minTier: 3, country: null, cells, past });
    expect(none.suggested).toBeNull();
    expect(none.reasoning).toContain('No activity counted in these days: no hour stands out yet.');
    // Outside the window: not read.
    expect(bestTime({ ...window, minTier: 0, country: null, cells: [cell('2026-11-05T00:00:00Z', 'FR', 0, 1, 0)], past: [] }).total).toBe(0);
  });
});

describe('the hourly activity', () => {
  let t: TestDb;
  let f: LiveFixture;
  let clock: ManualClock;
  let audit: AuditService;
  let service: ActivityService;
  let platine: { id: string };
  let titane: { id: string };
  let none: { id: string };

  const signIn = async (accountId: string, iso: string, action = 'account.login') => {
    clock.set(iso);
    await audit.record({ actor: { type: 'account', id: accountId }, action, targetType: 'account', targetId: accountId });
  };
  const scan = (iso: string, o: { accountId?: string | null; country?: string | null; eventType?: 'VERIFY' | 'REGISTER' | 'TRANSFER' | 'ADMIN_TEST' }) =>
    t.db
      .insertInto('scan_events')
      .values({ occurred_at: new Date(iso), event_type: o.eventType ?? 'VERIFY', account_id: o.accountId ?? null, country: o.country ?? null, result_state: 'AUTHENTIC' })
      .execute();

  beforeAll(async () => {
    t = await createTestDb();
    f = await liveFixture(t.db, '2026-10-01T09:00:00.000Z');
    clock = createManualClock('2026-10-01T09:00:00.000Z');
    audit = new AuditService({ db: t.db, clock: clock.now });
    service = new ActivityService({ db: t.db, clock: clock.now });
    platine = await accountOfTier(f, 2);
    titane = await accountOfTier(f, 1);
    none = await accountOfTier(f, 0);
    await t.db.updateTable('accounts').set({ country: 'FR' }).where('id', '=', platine.id).execute();
    await t.db.updateTable('accounts').set({ country: 'US' }).where('id', '=', titane.id).execute();

    await signIn(platine.id, '2026-09-01T08:00:00Z'); // before the reading's window, counted all the same
    await signIn(platine.id, '2026-10-20T17:30:00Z'); // 19:00 Paris (summer time)
    await signIn(platine.id, '2026-11-03T18:10:00Z'); // 19:00 Paris (winter time)
    await scan('2026-11-03T18:20:00Z', { accountId: platine.id, country: 'FR' });
    await signIn(titane.id, '2026-11-04T07:05:00Z', 'account.register'); // 08:00 Paris
    await scan('2026-11-04T07:40:00Z', { accountId: titane.id, country: 'US' });
    await signIn(none.id, '2026-11-04T07:15:00Z'); // no country: ZZ
    await scan('2026-11-05T07:30:00Z', { country: 'DE' }); // no account: no tier
    await scan('2026-11-05T07:31:00Z', { country: 'DE', eventType: 'ADMIN_TEST' }); // staff: never counted
    await signIn(none.id, '2026-11-05T07:32:00Z', 'account.login_failed'); // not a sign-in
    await signIn(titane.id, '2026-11-10T11:55:00Z'); // an hour not complete yet at 12:05
  });
  afterAll(() => t.close());

  it('counts each complete hour once by country and tier, never an account, staff scans and failed sign-ins left out', async () => {
    const now = new Date('2026-11-10T12:05:00Z');
    expect(await aggregateActivity(t.db, now)).toBe(6);
    const rows = await t.db.selectFrom('activity_hourly').selectAll().orderBy('hour').orderBy('country').orderBy('tier').execute();
    expect(rows.map((r) => [new Date(r.hour).toISOString(), r.country.trim(), r.tier, r.sign_ins, r.scans])).toEqual([
      ['2026-09-01T08:00:00.000Z', 'FR', 2, 1, 0],
      ['2026-10-20T17:00:00.000Z', 'FR', 2, 1, 0],
      ['2026-11-03T18:00:00.000Z', 'FR', 2, 1, 1],
      ['2026-11-04T07:00:00.000Z', 'US', 1, 1, 1],
      ['2026-11-04T07:00:00.000Z', 'ZZ', 0, 1, 0],
      ['2026-11-05T07:00:00.000Z', 'DE', 0, 0, 1],
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['country', 'hour', 'scans', 'sign_ins', 'tier']);
    // Counted once: a pass again writes nothing; the hour of 11:00 once it is complete.
    expect(await aggregateActivity(t.db, now)).toBe(0);
    expect(await aggregateActivity(t.db, new Date('2026-11-10T12:10:00Z'))).toBe(1);
    expect(await aggregateActivity(t.db, new Date('2026-11-10T13:10:00Z'))).toBe(0);
    expect(Number((await t.db.selectFrom('activity_hourly').select((eb) => eb.fn.sum<number>('sign_ins').as('n')).executeTakeFirstOrThrow()).n)).toBe(6);
  });

  it('reads the hours in Paris time by tier and country, the past releases’ presence, the suggested hour, a release’s own T0', async () => {
    // A past release opened at 19:00 Paris (18:00 UTC in November), two in the line at T0: a PLATINE and a TITANE.
    f.clock.set('2026-11-01T12:00:00.000Z');
    const past = await createLiveRelease(f, { opensAt: new Date('2026-11-01T18:00:00Z'), sizes: [{ label: '52', stock: 5 }] });
    f.clock.set('2026-11-01T17:58:00Z');
    const [p2, p1] = [await accountOfTier(f, 2), await accountOfTier(f, 1)];
    for (const p of [p2, p1]) await f.live.enter(p.id, past.id, { sizeId: past.sizes[0]!.id }, p.actor);
    f.clock.set('2026-11-01T18:00:00Z');
    await f.live.advance(past.id);
    f.clock.set('2026-11-01T19:30:00Z');
    await f.live.advance(past.id);
    // The release to open: from PLATINE, T0 at 20:00 Paris.
    f.clock.set('2026-11-10T09:00:00Z');
    const next = await createLiveRelease(f, { opensAt: new Date('2026-11-20T19:00:00Z'), minTier: 2 });

    clock.set('2026-11-10T13:15:00Z');
    const all = await service.bestTime({ days: 30 });
    expect(all.from).toEqual(new Date('2026-10-11T13:00:00Z'));
    expect(all.to).toEqual(new Date('2026-11-10T13:00:00Z'));
    // 19:00: PLATINE's two sign-ins and scan; 08:00: TITANE's sign-in and scan, the sign-in without a country, the
    // anonymous scan; 12:00: TITANE's late sign-in (11:00 UTC). The 1 September sign-in is outside the window.
    expect(all.total).toBe(8);
    expect(all.hours[19]).toEqual({ hour: 19, signIns: 2, scans: 1, activity: 3, byTier: [0, 0, 3, 0], past: { releases: 1, present: 2 } });
    expect(all.hours[8]).toEqual({ hour: 8, signIns: 2, scans: 2, activity: 4, byTier: [2, 2, 0, 0], past: { releases: 0, present: 0 } });
    expect(all.hours[12]).toMatchObject({ activity: 1, byTier: [0, 1, 0, 0] });
    expect(all.suggested).toEqual({ hour: 8, activity: 4, share: 0.5 });
    expect(all.countries).toEqual([
      { country: 'FR', activity: 3, peakHour: 19 },
      { country: 'US', activity: 3, peakHour: 8 },
      { country: 'DE', activity: 1, peakHour: 8 },
      { country: 'ZZ', activity: 1, peakHour: 8 },
    ]);
    expect(all.pastReleases).toBe(1);
    expect(all.release).toBeNull();

    // From TITANE: 19:00 (3) over 08:00 (2) and 12:00 (1).
    const titaneUp = await service.bestTime({ days: 30, minTier: 1 });
    expect(titaneUp.suggested).toEqual({ hour: 19, activity: 3, share: 0.5 });
    expect(titaneUp.hours[19]!.past).toEqual({ releases: 1, present: 2 });
    // In the United States: TITANE's two at 08:00, its sign-in at 12:00.
    const us = await service.bestTime({ days: 30, country: 'us' });
    expect(us).toMatchObject({ country: 'US', total: 3, suggested: { hour: 8, activity: 2 } });
    expect(us.hours[8]!.byTier).toEqual([0, 2, 0, 0]);

    // The release's tiers (PLATINE and above) and its T0 at 20:00 Paris; the past presence from PLATINE only.
    const own = await service.forRelease(next.id);
    expect(own.minTier).toBe(2);
    expect(own.suggested).toEqual({ hour: 19, activity: 3, share: 1 });
    expect(own.release).toEqual({ hour: 20, activity: 0, share: 0 });
    expect(own.hours[19]!.past).toEqual({ releases: 1, present: 1 });
    expect(own.reasoning).toEqual([
      'The sign-ins and scans counted by hour over the last 30 days, without any account: 3 from collectors from PLATINE, each at the tier its account held when its hour was counted (a scan without an account is no tier).',
      'The busiest hour, Paris time: 19:00, with 100 % of that activity (3).',
      'Past releases by the hour they opened, Paris time, and their line at T0 from these tiers: 19:00 1 release, 1 present. On equal activity, the hour where more were present wins.',
      'This release opens at 20:00, Paris time: 0 % of that activity.',
    ]);
    await expect(service.bestTime({ days: 0 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.forRelease('00000000-0000-4000-8000-000000000009')).rejects.toMatchObject({ code: 'DROP_NOT_FOUND' });
  });
});

describe('the housekeeping', () => {
  it('counts the hourly activity in its pass, before any purge', async () => {
    const { createContext, startHousekeeping } = await import('../../src/server/context.js');
    const { testConfig } = await import('../../src/server/config.js');
    const t = await createTestDb();
    const clock = createManualClock('2026-05-01T10:00:00.000Z');
    const ctx = await createContext(testConfig(), { db: t.db, clock: clock.now });
    const hk = startHousekeeping(ctx, { intervalMs: H });
    try {
      await ctx.services.auth.registerAccount({ email: 'hourly@example.com', password: 'correct horse battery staple' });
      clock.advance(H + 10 * 60_000);
      expect((await hk.runOnce()).activity).toBe(1);
      expect((await hk.runOnce()).activity).toBe(0);
      const row = await t.db.selectFrom('activity_hourly').selectAll().executeTakeFirstOrThrow();
      expect([new Date(row.hour).toISOString(), row.country.trim(), row.tier, row.sign_ins, row.scans]).toEqual(['2026-05-01T10:00:00.000Z', 'ZZ', 0, 1, 0]);
    } finally {
      await hk.stop();
      await ctx.close();
      await t.close();
    }
  });
});
